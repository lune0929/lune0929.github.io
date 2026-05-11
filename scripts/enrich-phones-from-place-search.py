#!/usr/bin/env python
"""Enrich missing phone numbers from Kakao/Naver place search."""

from __future__ import annotations

import argparse
import html
import json
import math
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "public" / "data"
TARGETS = {
    "scale": DATA_DIR / "scale-offices.json",
    "highway": DATA_DIR / "highway-toll-offices.json",
}
FAILED_OUTPUT = DATA_DIR / "phone-enrich-failed.json"
KAKAO_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"
NAVER_LOCAL_URL = "https://openapi.naver.com/v1/search/local.json"
MISSING_PHONE_VALUES = {"", "전화번호 정보 없음", "정보 없음", "없음", "unknown", "none", "null"}
HIGHWAY_NAME_TOKENS = [
    "TG",
    "T/G",
    "톨게이트",
    "요금소",
    "영업소",
    "하이패스",
]


@dataclass
class Candidate:
    source: str
    query: str
    name: str
    address: str
    road_address: str
    phone: str
    latitude: float | None = None
    longitude: float | None = None
    score: int = 0
    distance_m: float | None = None


@dataclass
class DatasetStats:
    dataset: str
    path: Path
    total: int = 0
    candidates: int = 0
    success: int = 0
    failed: int = 0
    skipped: int = 0
    kakao_success: int = 0
    naver_success: int = 0
    failures: list[dict[str, Any]] = field(default_factory=list)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Use Kakao/Naver local search to fill missing phone numbers.",
    )
    parser.add_argument("--target", choices=["scale", "highway", "all"], default="all")
    parser.add_argument("--dry-run", action="store_true", help="Only count items; do not call APIs or save files.")
    parser.add_argument("--limit", type=int, default=None, help="Limit processed candidate items.")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing phone fields.")
    parser.add_argument("--source", choices=["kakao", "naver", "both"], default="both")
    parser.add_argument("--delay", type=float, default=0.2, help="Delay between API calls in seconds.")
    parser.add_argument("--min-score", type=int, default=80, help="Minimum score for automatic adoption.")
    return parser.parse_args()


def load_json(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as file:
        data = json.load(file)
    if not isinstance(data, list):
        raise ValueError(f"{path} must contain a JSON array.")
    return [item for item in data if isinstance(item, dict)]


def save_json(path: Path, data: Any) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
        file.write("\n")


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return " ".join(clean_text(part) for part in value if clean_text(part))
    return " ".join(str(value).strip().split())


def strip_html(value: Any) -> str:
    return clean_text(re.sub(r"<[^>]+>", "", html.unescape(clean_text(value))))


def parse_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(str(value).replace(",", "").strip())
    except ValueError:
        return None


def valid_coordinate(item: dict[str, Any]) -> tuple[float | None, float | None]:
    lat = parse_float(item.get("latitude"))
    lng = parse_float(item.get("longitude"))
    if lat is None or lng is None:
        return None, None
    if 30 <= lat <= 45 and 120 <= lng <= 135:
        return lat, lng
    return None, None


def is_missing_phone(value: Any) -> bool:
    return clean_text(value).lower() in MISSING_PHONE_VALUES


def phone_fields(dataset: str, item: dict[str, Any]) -> list[str]:
    if dataset == "scale":
        return ["phone", "office_phone"]
    fields = ["phone", "office_phone", "telephone"]
    return [field for field in fields if field in item or field == "phone"]


def should_enrich(dataset: str, item: dict[str, Any], overwrite: bool) -> bool:
    if overwrite:
        return True
    return not any(not is_missing_phone(item.get(field)) for field in phone_fields(dataset, item))


def target_phone_field(dataset: str, item: dict[str, Any], overwrite: bool) -> str:
    fields = phone_fields(dataset, item)
    if "phone" in fields:
        return "phone"
    for field_name in fields:
        if overwrite or is_missing_phone(item.get(field_name)):
            return field_name
    return fields[0]


def normalize_name(value: str, dataset: str) -> str:
    text = strip_html(value)
    text = re.sub(r"\([^)]*\)", "", text)
    text = re.sub(r"\[[^]]*\]", "", text)
    text = re.sub(r"주식회사|\(주\)|㈜", "", text)
    if dataset == "highway":
        for token in HIGHWAY_NAME_TOKENS:
            text = re.sub(re.escape(token), "", text, flags=re.IGNORECASE)
        text = re.sub(r"(상행|하행|진입|진출|입구|출구|방면)$", "", text)
        text = re.sub(r"[상하]$", "", text)
    return re.sub(r"\s+", "", text).lower()


def compact_address(value: str) -> str:
    return re.sub(r"\s+", "", clean_text(value)).lower()


def item_name(dataset: str, item: dict[str, Any]) -> str:
    if dataset == "scale":
        return clean_text(item.get("business_name") or item.get("normalized_name"))
    return clean_text(item.get("office_name") or item.get("search_name"))


def item_key(dataset: str, item: dict[str, Any]) -> str:
    if dataset == "scale":
        return clean_text(item.get("management_id") or item.get("id"))
    return clean_text(item.get("office_code") or item.get("id"))


def build_queries(dataset: str, item: dict[str, Any]) -> list[str]:
    queries: list[str] = []
    if dataset == "scale":
        name = item_name(dataset, item)
        parts = [
            item.get("address"),
            item.get("road_address"),
            item.get("sigungu"),
            "",
        ]
        queries = [f"{name} {clean_text(part)}".strip() for part in parts if name]
    else:
        name = item_name(dataset, item)
        parts = [
            item.get("address"),
            item.get("road_address"),
            item.get("route_name"),
            "영업소",
            "요금소",
            "톨게이트",
            "TG",
        ]
        queries = [f"{name} {clean_text(part)}".strip() for part in parts if name]

    deduped: list[str] = []
    for query in queries:
        if query and query not in deduped:
            deduped.append(query)
    return deduped


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius_m = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lng2 - lng1)
    a = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    return radius_m * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def score_candidate(dataset: str, item: dict[str, Any], candidate: Candidate) -> Candidate:
    original_name = item_name(dataset, item)
    original_norm = normalize_name(original_name, dataset)
    candidate_norm = normalize_name(candidate.name, dataset)
    score = 0

    if original_norm and candidate_norm and original_norm == candidate_norm:
        score += 60
    elif original_norm and candidate_norm and (original_norm in candidate_norm or candidate_norm in original_norm):
        score += 40

    source_addresses = [
        compact_address(clean_text(item.get("address"))),
        compact_address(clean_text(item.get("road_address"))),
        compact_address(clean_text(item.get("sigungu"))),
    ]
    candidate_addresses = [
        compact_address(candidate.address),
        compact_address(candidate.road_address),
    ]
    if any(src and cand and (src in cand or cand in src) for src in source_addresses for cand in candidate_addresses):
        score += 30

    sido = compact_address(clean_text(item.get("sido")))
    sigungu = compact_address(clean_text(item.get("sigungu")))
    joined_candidate_address = compact_address(f"{candidate.address} {candidate.road_address}")
    if (sido and sido in joined_candidate_address) or (sigungu and sigungu in joined_candidate_address):
        score += 20

    lat, lng = valid_coordinate(item)
    if lat is not None and lng is not None and candidate.latitude is not None and candidate.longitude is not None:
        distance_m = haversine_m(lat, lng, candidate.latitude, candidate.longitude)
        candidate.distance_m = round(distance_m, 1)
        if distance_m <= 500:
            score += 30
        elif distance_m <= 2000:
            score += 10

    if candidate.phone:
        score += 30

    candidate.score = score
    return candidate


def candidate_summary(candidate: Candidate) -> dict[str, Any]:
    return {
        "source": candidate.source,
        "query": candidate.query,
        "name": candidate.name,
        "address": candidate.address,
        "road_address": candidate.road_address,
        "phone": candidate.phone,
        "score": candidate.score,
        "distance_m": candidate.distance_m,
    }


def is_adoptable(dataset: str, item: dict[str, Any], candidate: Candidate, min_score: int) -> bool:
    if not candidate.phone or candidate.score < min_score:
        return False
    original_norm = normalize_name(item_name(dataset, item), dataset)
    candidate_norm = normalize_name(candidate.name, dataset)
    return bool(original_norm and candidate_norm and (original_norm == candidate_norm or original_norm in candidate_norm or candidate_norm in original_norm))


def http_json(request: urllib.request.Request) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {raw}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(str(exc.reason)) from exc


def search_kakao(api_key: str, query: str) -> list[Candidate]:
    params = urllib.parse.urlencode({"query": query, "size": 5})
    request = urllib.request.Request(
        f"{KAKAO_KEYWORD_URL}?{params}",
        headers={"Authorization": f"KakaoAK {api_key}"},
        method="GET",
    )
    payload = http_json(request)
    candidates: list[Candidate] = []
    for doc in payload.get("documents", []):
        if not isinstance(doc, dict):
            continue
        candidates.append(
            Candidate(
                source="kakao_keyword",
                query=query,
                name=clean_text(doc.get("place_name")),
                address=clean_text(doc.get("address_name")),
                road_address=clean_text(doc.get("road_address_name")),
                phone=clean_text(doc.get("phone")),
                latitude=parse_float(doc.get("y")),
                longitude=parse_float(doc.get("x")),
            ),
        )
    return candidates


def parse_naver_coordinate(value: Any) -> float | None:
    number_value = parse_float(value)
    if number_value is None:
        return None
    if abs(number_value) > 1000000:
        return number_value / 10000000
    return number_value


def search_naver(client_id: str, client_secret: str, query: str) -> list[Candidate]:
    params = urllib.parse.urlencode({"query": query, "display": 5})
    request = urllib.request.Request(
        f"{NAVER_LOCAL_URL}?{params}",
        headers={
            "X-Naver-Client-Id": client_id,
            "X-Naver-Client-Secret": client_secret,
        },
        method="GET",
    )
    payload = http_json(request)
    candidates: list[Candidate] = []
    for item in payload.get("items", []):
        if not isinstance(item, dict):
            continue
        candidates.append(
            Candidate(
                source="naver_local",
                query=query,
                name=strip_html(item.get("title")),
                address=clean_text(item.get("address")),
                road_address=clean_text(item.get("roadAddress")),
                phone=clean_text(item.get("telephone")),
                latitude=parse_naver_coordinate(item.get("mapy")),
                longitude=parse_naver_coordinate(item.get("mapx")),
            ),
        )
    return candidates


def find_best_candidate(
    dataset: str,
    item: dict[str, Any],
    queries: list[str],
    args: argparse.Namespace,
    kakao_key: str,
    naver_id: str,
    naver_secret: str,
) -> tuple[Candidate | None, list[dict[str, Any]], str]:
    all_candidates: list[Candidate] = []
    errors: list[str] = []

    if args.source in {"kakao", "both"}:
        for query in queries:
            try:
                candidates = [score_candidate(dataset, item, c) for c in search_kakao(kakao_key, query)]
                all_candidates.extend(candidates)
                phone_candidates = [c for c in candidates if c.phone]
                if phone_candidates:
                    best = max(phone_candidates, key=lambda c: c.score)
                    if is_adoptable(dataset, item, best, args.min_score):
                        return best, [candidate_summary(c) for c in all_candidates], ""
            except Exception as exc:  # noqa: BLE001 - external API failure is reported.
                errors.append(f"kakao:{type(exc).__name__}")
            if args.delay > 0:
                time.sleep(args.delay)

    if args.source in {"naver", "both"}:
        for query in queries:
            try:
                candidates = [score_candidate(dataset, item, c) for c in search_naver(naver_id, naver_secret, query)]
                all_candidates.extend(candidates)
                phone_candidates = [c for c in candidates if c.phone]
                if phone_candidates:
                    best = max(phone_candidates, key=lambda c: c.score)
                    if is_adoptable(dataset, item, best, args.min_score):
                        return best, [candidate_summary(c) for c in all_candidates], ""
            except Exception as exc:  # noqa: BLE001 - external API failure is reported.
                errors.append(f"naver:{type(exc).__name__}")
            if args.delay > 0:
                time.sleep(args.delay)

    summaries = [candidate_summary(candidate) for candidate in all_candidates]
    if errors and not all_candidates:
        return None, summaries, "api_error"
    if not all_candidates:
        return None, summaries, "no_candidate"
    if not any(candidate.phone for candidate in all_candidates):
        return None, summaries, "no_phone_candidate"
    return None, summaries, "low_score_or_name_mismatch"


def apply_phone(dataset: str, item: dict[str, Any], candidate: Candidate, overwrite: bool, timestamp: str) -> None:
    field_name = target_phone_field(dataset, item, overwrite)
    item[field_name] = candidate.phone
    item["phone_status"] = "success"
    item["phone_source"] = candidate.source
    item["phone_updated_at"] = timestamp
    item["phone_candidate"] = candidate_summary(candidate)


def mark_phone_failure(item: dict[str, Any]) -> None:
    item["phone_status"] = "failed"


def failure_record(
    dataset: str,
    item: dict[str, Any],
    tried_queries: list[str],
    candidates: list[dict[str, Any]],
    fail_reason: str,
) -> dict[str, Any]:
    return {
        "dataset": dataset,
        "id": item_key(dataset, item),
        "name": item_name(dataset, item),
        "address": clean_text(item.get("address")),
        "road_address": clean_text(item.get("road_address")),
        "latitude": item.get("latitude"),
        "longitude": item.get("longitude"),
        "tried_queries": tried_queries,
        "candidates": candidates,
        "fail_reason": fail_reason,
    }


def selected_targets(target: str) -> list[tuple[str, Path]]:
    if target == "all":
        return list(TARGETS.items())
    return [(target, TARGETS[target])]


def count_candidates(dataset: str, items: list[dict[str, Any]], overwrite: bool) -> tuple[int, int]:
    candidates = 0
    skipped = 0
    for item in items:
        if should_enrich(dataset, item, overwrite):
            candidates += 1
        else:
            skipped += 1
    return candidates, skipped


def process_dataset(
    dataset: str,
    path: Path,
    args: argparse.Namespace,
    kakao_key: str,
    naver_id: str,
    naver_secret: str,
) -> tuple[DatasetStats, list[dict[str, Any]]]:
    items = load_json(path)
    stats = DatasetStats(dataset=dataset, path=path, total=len(items))
    stats.candidates, stats.skipped = count_candidates(dataset, items, args.overwrite)

    print(f"\n대상 파일: {path}")
    print(f"전체 건수: {stats.total}")
    print(f"전화번호 보강 대상 건수: {stats.candidates}")
    print(f"건너뜀 건수: {stats.skipped}")

    if args.dry_run:
        return stats, items

    processed = 0
    timestamp = datetime.now(timezone.utc).isoformat()
    for item in items:
        if not should_enrich(dataset, item, args.overwrite):
            continue
        if args.limit is not None and processed >= args.limit:
            break
        processed += 1

        queries = build_queries(dataset, item)
        if not queries:
            stats.failed += 1
            mark_phone_failure(item)
            stats.failures.append(failure_record(dataset, item, queries, [], "no_query"))
            continue

        candidate, candidates, fail_reason = find_best_candidate(
            dataset,
            item,
            queries,
            args,
            kakao_key,
            naver_id,
            naver_secret,
        )
        if candidate:
            apply_phone(dataset, item, candidate, args.overwrite, timestamp)
            stats.success += 1
            if candidate.source == "kakao_keyword":
                stats.kakao_success += 1
            elif candidate.source == "naver_local":
                stats.naver_success += 1
        else:
            stats.failed += 1
            mark_phone_failure(item)
            stats.failures.append(failure_record(dataset, item, queries, candidates, fail_reason))

    return stats, items


def validate_keys(args: argparse.Namespace, kakao_key: str, naver_id: str, naver_secret: str) -> bool:
    if args.dry_run:
        return True
    if args.source in {"kakao", "both"} and not kakao_key:
        print("KAKAO_REST_API_KEY 환경변수가 필요합니다.", file=sys.stderr)
        return False
    if args.source in {"naver", "both"} and (not naver_id or not naver_secret):
        print("NAVER_CLIENT_ID와 NAVER_CLIENT_SECRET 환경변수가 필요합니다.", file=sys.stderr)
        return False
    return True


def main() -> int:
    args = parse_args()
    load_dotenv(PROJECT_ROOT / ".env")

    kakao_key = clean_text(os.getenv("KAKAO_REST_API_KEY"))
    naver_id = clean_text(os.getenv("NAVER_CLIENT_ID"))
    naver_secret = clean_text(os.getenv("NAVER_CLIENT_SECRET"))
    if not validate_keys(args, kakao_key, naver_id, naver_secret):
        return 2

    all_failures: list[dict[str, Any]] = []
    results: list[tuple[DatasetStats, Path, list[dict[str, Any]]]] = []
    for dataset, path in selected_targets(args.target):
        stats, items = process_dataset(dataset, path, args, kakao_key, naver_id, naver_secret)
        all_failures.extend(stats.failures)
        results.append((stats, path, items))

    if args.dry_run:
        print("\ndry-run입니다. API 호출과 파일 저장을 하지 않았습니다.")
        return 0

    for stats, path, items in results:
        backup = path.with_name(path.name.replace(".json", ".phone.backup.json"))
        shutil.copy2(path, backup)
        save_json(path, items)
        print(f"\n저장 위치: {path}")
        print(f"백업 위치: {backup}")
        print(f"성공 건수: {stats.success}")
        print(f"실패 건수: {stats.failed}")
        print(f"건너뜀 건수: {stats.skipped}")
        print(f"Kakao 성공 건수: {stats.kakao_success}")
        print(f"Naver 성공 건수: {stats.naver_success}")

    save_json(FAILED_OUTPUT, all_failures)
    print(f"실패 목록 저장 위치: {FAILED_OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
