#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Classify factories and optionally geocode heavy freight candidates with Kakao."""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
INPUT_CSV = PROJECT_ROOT / "data" / "한국산업단지공단_전국등록공장현황_등록공장현황자료_20241231.csv"
OUTPUT_CSV = PROJECT_ROOT / "data" / "factory_heavy_classified.csv"
PARTIAL_CSV = PROJECT_ROOT / "data" / "factory_heavy_classified.partial.csv"
OUTPUT_JSON = PROJECT_ROOT / "public" / "data" / "heavy-factories.json"
PARTIAL_JSON = PROJECT_ROOT / "public" / "data" / "heavy-factories.partial.json"
FAILED_JSON = PROJECT_ROOT / "public" / "data" / "heavy-factories-failed.json"
PARTIAL_FAILED_JSON = PROJECT_ROOT / "public" / "data" / "heavy-factories-failed.partial.json"
GEOCODE_CACHE = PROJECT_ROOT / "data" / "geocode-cache-kakao.json"
KAKAO_ADDRESS_URL = "https://dapi.kakao.com/v2/local/search/address.json"

CERTAIN_KEYWORDS = [
    "레미콘",
    "콘크리트",
    "시멘트",
    "아스콘",
    "아스팔트",
    "골재",
    "쇄석",
    "석재",
    "철근",
    "강판",
    "철판",
    "강관",
    "형강",
    "H빔",
    "코일",
    "파일",
    "전주",
    "흄관",
    "대형구조물",
    "대형 구조물",
]

POSSIBLE_KEYWORDS = [
    "산업기계",
    "자동차부품",
    "금속가공",
    "금속제품",
    "철강",
    "주물",
    "주조",
    "단조",
    "압연",
    "모래",
    "자갈",
    "맨홀",
    "블록",
    "벽돌",
    "타일",
    "유리",
    "탱크",
    "보일러",
    "컨테이너",
    "선박",
    "조선",
    "대형기계",
    "건설기계",
    "화학제품",
    "플라스틱원료",
    "식품 원료",
    "기계",
    "빔",
    "파이프",
    "배관",
    "밸브",
    "펌프",
    "수지",
    "고무",
    "비료",
    "사료",
    "목재",
    "합판",
    "판지",
    "종이",
    "펄프",
    "곡물",
    "밀가루",
    "설탕",
    "소금",
    "금속",
]

LIGHT_KEYWORDS = [
    "반도체부품",
    "전자부품",
    "통신장비",
    "소프트웨어",
    "섬유제품",
    "의료기기",
    "인쇄",
    "책자",
    "라벨",
    "스티커",
    "의류",
    "봉제",
    "화장품",
    "의약품",
    "마스크",
    "문구",
    "완구",
    "광고물",
    "간판",
    "모형",
    "전시물",
    "귀금속",
    "주얼리",
    "장신구",
    "보석",
]

LIGHT_EXCEPTIONS = ["귀금속", "주얼리", "장신구", "보석"]
VAGUE_VALUES = {"", "제품", "부품", "기타", "자재"}
CSV_FIELDNAMES = [
    "순번",
    "회사명",
    "단지명",
    "생산품",
    "공장주소",
    "heavy_class",
    "heavy_score",
    "reason_keywords",
    "map_include",
    "latitude",
    "longitude",
    "geocode_status",
    "geocode_provider",
    "matched_address",
    "road_address",
    "jibun_address",
    "fail_reason",
]


class RateLimitError(RuntimeError):
    pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Classify and geocode heavy freight factories.")
    parser.add_argument("--geocode", action="store_true", help="Call Kakao geocoding using cache.")
    parser.add_argument("--limit", type=int, default=100, help="Maximum new unique addresses to geocode.")
    parser.add_argument("--all", action="store_true", help="Geocode every uncached unique target address.")
    parser.add_argument("--sido", default="", help="Limit geocoding targets by factory address sido, e.g. 부산, 경남.")
    parser.add_argument("--heavy-class", default="", help='Limit geocoding targets, e.g. "고중량 후보 강".')
    parser.add_argument("--delay", type=float, default=0.08, help="Delay between Kakao API requests.")
    parser.add_argument("--max-retries", type=int, default=3, help="Retry count for 5xx responses.")
    return parser.parse_args()


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).strip().split())


def normalize_sido(value: str) -> str:
    normalized = clean_text(value).replace(" ", "")
    mapping = {
        "서울": "서울",
        "서울특별시": "서울",
        "부산": "부산",
        "부산광역시": "부산",
        "대구": "대구",
        "대구광역시": "대구",
        "인천": "인천",
        "인천광역시": "인천",
        "광주": "광주",
        "광주광역시": "광주",
        "대전": "대전",
        "대전광역시": "대전",
        "울산": "울산",
        "울산광역시": "울산",
        "세종": "세종",
        "세종특별자치시": "세종",
        "경기": "경기",
        "경기도": "경기",
        "강원": "강원",
        "강원도": "강원",
        "강원특별자치도": "강원",
        "충북": "충북",
        "충청북도": "충북",
        "충남": "충남",
        "충청남도": "충남",
        "전북": "전북",
        "전라북도": "전북",
        "전북특별자치도": "전북",
        "전남": "전남",
        "전라남도": "전남",
        "경북": "경북",
        "경상북도": "경북",
        "경남": "경남",
        "경상남도": "경남",
        "제주": "제주",
        "제주특별자치도": "제주",
    }
    return mapping.get(normalized, normalized)


def address_sido(address: str) -> str:
    first = clean_text(address).split(" ")[0] if clean_text(address) else ""
    return normalize_sido(first)


def normalize_product(value: str) -> str:
    return re.sub(r"[\s,./·ㆍ\-\(\)\[\]{}]+", "", clean_text(value)).lower()


def keyword_matches(product: str, keywords: list[str]) -> list[str]:
    normalized = normalize_product(product)
    return [keyword for keyword in keywords if normalize_product(keyword) in normalized]


def classify_product(product: str) -> tuple[str, int, list[str]]:
    text = clean_text(product)
    normalized = normalize_product(text)
    if normalized in {normalize_product(value) for value in VAGUE_VALUES}:
        return "확인 필요", 0, []

    light_exception_matches = keyword_matches(text, LIGHT_EXCEPTIONS)
    if light_exception_matches:
        return "일반/저중량", 0, light_exception_matches

    light_matches = keyword_matches(text, LIGHT_KEYWORDS)
    if light_matches:
        return "일반/저중량", 0, light_matches

    certain_matches = keyword_matches(text, CERTAIN_KEYWORDS)
    if certain_matches:
        return "고중량 후보 강", 100, certain_matches

    possible_matches = keyword_matches(text, POSSIBLE_KEYWORDS)
    if possible_matches:
        return "고중량 후보 중", 60, possible_matches

    return "확인 필요", 0, []


def parse_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(str(value).strip())
    except ValueError:
        return None


def load_source_rows() -> list[dict[str, str]]:
    with INPUT_CSV.open(encoding="cp949", newline="") as file:
        return list(csv.DictReader(file))


def build_base_items(source_rows: list[dict[str, str]]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    items: list[dict[str, Any]] = []
    counts: dict[str, int] = {}
    for index, row in enumerate(source_rows, start=1):
        heavy_class, heavy_score, reason_keywords = classify_product(row.get("생산품", ""))
        map_include = heavy_class in {"고중량 후보 강", "고중량 후보 중"}
        counts[heavy_class] = counts.get(heavy_class, 0) + 1
        items.append(
            {
                "id": f"heavy-factory-{index}",
                "source_no": clean_text(row.get("순번")),
                "company_name": clean_text(row.get("회사명")),
                "product": clean_text(row.get("생산품")),
                "factory_address": clean_text(row.get("공장주소")),
                "complex_name": clean_text(row.get("단지명")),
                "heavy_class": heavy_class,
                "heavy_score": heavy_score,
                "reason_keywords": reason_keywords,
                "map_include": map_include,
                "latitude": None,
                "longitude": None,
                "geocode_status": "pending" if map_include else "skipped",
                "geocode_provider": "kakao" if map_include else "",
                "matched_address": "",
                "road_address": "",
                "jibun_address": "",
                "fail_reason": "",
            },
        )
    return items, counts


def load_cache() -> dict[str, dict[str, Any]]:
    if not GEOCODE_CACHE.exists():
        return {}
    with GEOCODE_CACHE.open("r", encoding="utf-8") as file:
        data = json.load(file)
    return data if isinstance(data, dict) else {}


def save_cache(cache: dict[str, dict[str, Any]]) -> None:
    GEOCODE_CACHE.parent.mkdir(parents=True, exist_ok=True)
    with GEOCODE_CACHE.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(cache, file, ensure_ascii=False, indent=2, sort_keys=True)
        file.write("\n")


def save_json(path: Path, payload: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")


def csv_row(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "순번": item["source_no"],
        "회사명": item["company_name"],
        "단지명": item["complex_name"],
        "생산품": item["product"],
        "공장주소": item["factory_address"],
        "heavy_class": item["heavy_class"],
        "heavy_score": item["heavy_score"],
        "reason_keywords": ",".join(item["reason_keywords"]),
        "map_include": item["map_include"],
        "latitude": item["latitude"] or "",
        "longitude": item["longitude"] or "",
        "geocode_status": item["geocode_status"],
        "geocode_provider": item["geocode_provider"],
        "matched_address": item["matched_address"],
        "road_address": item["road_address"],
        "jibun_address": item["jibun_address"],
        "fail_reason": item["fail_reason"],
    }


def save_csv(path: Path, items: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=CSV_FIELDNAMES)
        writer.writeheader()
        for item in items:
            writer.writerow(csv_row(item))


def public_item(item: dict[str, Any]) -> dict[str, Any]:
    return {
        key: item[key]
        for key in [
            "id",
            "company_name",
            "product",
            "factory_address",
            "complex_name",
            "heavy_class",
            "heavy_score",
            "reason_keywords",
            "map_include",
            "latitude",
            "longitude",
            "geocode_status",
            "geocode_provider",
            "matched_address",
            "road_address",
            "jibun_address",
        ]
    }


def failed_record(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item["id"],
        "original_address": item["factory_address"],
        "company_name": item["company_name"],
        "product": item["product"],
        "heavy_class": item["heavy_class"],
        "fail_reason": item["fail_reason"],
    }


def apply_cache(items: list[dict[str, Any]], cache: dict[str, dict[str, Any]]) -> tuple[int, list[dict[str, Any]]]:
    reused = 0
    failed: list[dict[str, Any]] = []
    for item in items:
        if not item["map_include"]:
            continue
        address = item["factory_address"]
        cached = cache.get(address)
        if not cached:
            continue
        reused += 1
        if cached.get("status") == "success":
            item["latitude"] = cached.get("latitude")
            item["longitude"] = cached.get("longitude")
            item["matched_address"] = clean_text(cached.get("matched_address"))
            item["road_address"] = clean_text(cached.get("road_address"))
            item["jibun_address"] = clean_text(cached.get("jibun_address"))
            item["geocode_status"] = "success"
        else:
            item["geocode_status"] = "failed"
            item["fail_reason"] = clean_text(cached.get("fail_reason"))
            failed.append(failed_record(item))
    return reused, failed


def save_outputs(
    items: list[dict[str, Any]],
    failed: list[dict[str, Any]],
    cache: dict[str, dict[str, Any]],
    partial: bool,
) -> None:
    save_cache(cache)
    save_csv(PARTIAL_CSV if partial else OUTPUT_CSV, items)
    save_json(PARTIAL_JSON if partial else OUTPUT_JSON, [public_item(item) for item in items if item["map_include"]])
    save_json(PARTIAL_FAILED_JSON if partial else FAILED_JSON, failed)


def kakao_address_search(api_key: str, query: str, max_retries: int) -> dict[str, Any]:
    params = urllib.parse.urlencode({"query": query, "size": 1})
    request = urllib.request.Request(
        f"{KAKAO_ADDRESS_URL}?{params}",
        headers={"Authorization": f"KakaoAK {api_key}"},
        method="GET",
    )

    for attempt in range(max_retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                payload = json.loads(response.read().decode("utf-8"))
            documents = payload.get("documents", [])
            if not documents:
                return {"status": "failed", "fail_reason": "검색결과 없음"}
            item = documents[0]
            if not isinstance(item, dict):
                return {"status": "failed", "fail_reason": "응답 형식 오류"}
            longitude = parse_float(item.get("x"))
            latitude = parse_float(item.get("y"))
            if longitude is None or latitude is None:
                return {"status": "failed", "fail_reason": "좌표 없음"}
            address = item.get("address") if isinstance(item.get("address"), dict) else {}
            road_address = item.get("road_address") if isinstance(item.get("road_address"), dict) else {}
            return {
                "status": "success",
                "latitude": latitude,
                "longitude": longitude,
                "matched_address": clean_text(item.get("address_name")),
                "road_address": clean_text(road_address.get("address_name")),
                "jibun_address": clean_text(address.get("address_name")),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                raise RateLimitError("HTTP 오류 429")
            if 500 <= exc.code <= 599 and attempt < max_retries:
                time.sleep(0.7 * (attempt + 1))
                continue
            return {"status": "failed", "fail_reason": f"HTTP 오류 {exc.code}"}
        except Exception as exc:
            return {"status": "failed", "fail_reason": str(exc)[:200]}
    return {"status": "failed", "fail_reason": "재시도 초과"}


def eta_text(started_at: float, completed: int, total: int) -> tuple[str, str]:
    elapsed = max(time.time() - started_at, 0.001)
    speed = completed / elapsed if completed else 0
    if not speed:
        return "0.00건/초", "계산 중"
    remaining = max(total - completed, 0)
    eta_seconds = int(remaining / speed)
    return f"{speed:.2f}건/초", f"{eta_seconds // 3600:02d}:{(eta_seconds % 3600) // 60:02d}:{eta_seconds % 60:02d}"


def log_progress(
    started_at: float,
    completed: int,
    total: int,
    success: int,
    failed_count: int,
    cache_reused: int,
    planned_calls: int,
) -> None:
    speed, eta = eta_text(started_at, completed, total)
    print(
        "진행률 "
        f"완료={completed}/{total}, 성공={success}, 실패={failed_count}, "
        f"캐시재사용={cache_reused}, 실제API호출예정={planned_calls}, "
        f"평균처리속도={speed}, ETA={eta}",
        flush=True,
    )


def target_addresses(items: list[dict[str, Any]]) -> list[str]:
    seen: set[str] = set()
    addresses: list[str] = []
    for item in items:
        if not item["map_include"] or not item["factory_address"]:
            continue
        if item["factory_address"] not in seen:
            seen.add(item["factory_address"])
            addresses.append(item["factory_address"])
    return addresses


def matches_filters(item: dict[str, Any], sido_filter: str, heavy_class_filter: str) -> bool:
    if not item["map_include"] or not item["factory_address"]:
        return False
    if heavy_class_filter and item["heavy_class"] != heavy_class_filter:
        return False
    if sido_filter and address_sido(item["factory_address"]) != normalize_sido(sido_filter):
        return False
    return True


def filtered_target_addresses(
    items: list[dict[str, Any]],
    sido_filter: str,
    heavy_class_filter: str,
) -> list[str]:
    seen: set[str] = set()
    addresses: list[str] = []
    for item in items:
        if not matches_filters(item, sido_filter, heavy_class_filter):
            continue
        address = item["factory_address"]
        if address not in seen:
            seen.add(address)
            addresses.append(address)
    return addresses


def print_summary(
    total_rows: int,
    counts: dict[str, int],
    high_target_count: int,
    target_address_count: int,
    unique_count: int,
    filtered_target_count: int,
    filtered_unique_count: int,
    cache_reused: int,
    planned_calls: int,
    completed: int = 0,
    success: int = 0,
    failed_count: int = 0,
) -> None:
    print(f"전체 공장 건수: {total_rows}")
    print(f"고중량 후보 강/중 대상 건수: {high_target_count}")
    print(f"고중량 후보 강: {counts.get('고중량 후보 강', 0)}")
    print(f"고중량 후보 중: {counts.get('고중량 후보 중', 0)}")
    print(f"중복 제거 전 주소 건수: {target_address_count}")
    print(f"중복 제거 후 고유 주소 건수: {unique_count}")
    print(f"필터 적용 예상 대상 건수: {filtered_target_count}")
    print(f"필터 적용 고유 주소 건수: {filtered_unique_count}")
    print(f"캐시 재사용 건수: {cache_reused}")
    print(f"실제 API 호출 예정 건수: {planned_calls}")
    print(f"완료 건수: {completed}")
    print(f"성공 건수: {success}")
    print(f"실패 건수: {failed_count}")


def main() -> int:
    args = parse_args()
    source_rows = load_source_rows()
    items, counts = build_base_items(source_rows)
    addresses = target_addresses(items)
    filtered_addresses = filtered_target_addresses(items, args.sido, args.heavy_class)
    cache = load_cache()
    cache_reused, failed = apply_cache(items, cache)
    high_target_count = sum(1 for item in items if item["map_include"])
    target_address_count = sum(1 for item in items if item["map_include"] and item["factory_address"])
    filtered_target_count = sum(
        1 for item in items if matches_filters(item, args.sido, args.heavy_class)
    )
    uncached_addresses = [address for address in filtered_addresses if address not in cache]
    planned_addresses = uncached_addresses if args.all else uncached_addresses[: max(args.limit, 0)]

    if not args.geocode:
        print_summary(
            len(source_rows),
            counts,
            high_target_count,
            target_address_count,
            len(addresses),
            filtered_target_count,
            len(filtered_addresses),
            cache_reused,
            0,
            success=sum(1 for item in items if item["geocode_status"] == "success"),
            failed_count=len(failed),
        )
        save_outputs(items, failed, cache, partial=False)
        print(f"분류 CSV 저장: {OUTPUT_CSV}")
        print(f"지도 JSON 저장: {OUTPUT_JSON}")
        print(f"실패 JSON 저장: {FAILED_JSON}")
        return 0

    load_env_file(PROJECT_ROOT / ".env")
    api_key = clean_text(os.getenv("KAKAO_REST_API_KEY"))
    if not api_key:
        print("KAKAO_REST_API_KEY 환경변수가 필요합니다.", file=sys.stderr)
        return 2

    print_summary(
        len(source_rows),
        counts,
        high_target_count,
        target_address_count,
        len(addresses),
        filtered_target_count,
        len(filtered_addresses),
        cache_reused,
        len(planned_addresses),
    )
    started_at = time.time()
    last_log_at = started_at
    completed = 0

    try:
        for address in planned_addresses:
            result = kakao_address_search(api_key, address, args.max_retries)
            cache[address] = result
            completed += 1
            cache_reused, failed = apply_cache(items, cache)
            success = sum(1 for item in items if item["geocode_status"] == "success")
            failed_count = len(failed)

            now = time.time()
            if completed % 100 == 0 or now - last_log_at >= 30:
                log_progress(started_at, completed, len(planned_addresses), success, failed_count, cache_reused, len(planned_addresses))
                last_log_at = now
            if completed % 500 == 0:
                save_outputs(items, failed, cache, partial=True)
                print("partial 저장 완료", flush=True)
            if args.delay > 0:
                time.sleep(args.delay)
    except RateLimitError as exc:
        cache_reused, failed = apply_cache(items, cache)
        save_outputs(items, failed, cache, partial=True)
        print(f"429 응답으로 중단: {exc}", file=sys.stderr)
        print("현재 캐시와 partial 파일을 저장했습니다.", file=sys.stderr)
        return 3
    except KeyboardInterrupt:
        cache_reused, failed = apply_cache(items, cache)
        save_outputs(items, failed, cache, partial=True)
        success = sum(1 for item in items if item["geocode_status"] == "success")
        log_progress(
            started_at,
            completed,
            len(planned_addresses),
            success,
            len(failed),
            cache_reused,
            len(planned_addresses),
        )
        print("사용자 중단으로 현재 캐시와 partial 파일을 저장했습니다.", file=sys.stderr)
        return 130

    cache_reused, failed = apply_cache(items, cache)
    save_outputs(items, failed, cache, partial=False)
    success = sum(1 for item in items if item["geocode_status"] == "success")
    log_progress(started_at, completed, len(planned_addresses), success, len(failed), cache_reused, len(planned_addresses))
    print(f"분류 CSV 저장: {OUTPUT_CSV}")
    print(f"지도 JSON 저장: {OUTPUT_JSON}")
    print(f"실패 JSON 저장: {FAILED_JSON}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
