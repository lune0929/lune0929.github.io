#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Geocode overload checkpoint CSV rows with Kakao Local address search."""

from __future__ import annotations

import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
API_URL = "https://dapi.kakao.com/v2/local/search/address.json"
ADDRESS_COLUMNS = ("정규화주소", "주소", "원문")
INPUT_CSV = PROJECT_ROOT / "data" / "naver_geocode_input_addresses.csv"
OUTPUT_CSV = PROJECT_ROOT / "data" / "kakao_geocoded_output.csv"
OUTPUT_JSON = PROJECT_ROOT / "public" / "data" / "overload-checkpoints.json"
FAILED_JSON = PROJECT_ROOT / "public" / "data" / "overload-checkpoints-failed.json"
SOURCE = "manual-address-csv-kakao"


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


def pick_address(row: dict[str, str]) -> str:
    for column in ADDRESS_COLUMNS:
        value = clean_text(row.get(column))
        if value:
            return value
    return ""


def parse_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(str(value).strip())
    except ValueError:
        return None


def compact_sido(value: str) -> str:
    mapping = {
        "서울특별시": "서울",
        "부산광역시": "부산",
        "대구광역시": "대구",
        "인천광역시": "인천",
        "광주광역시": "광주",
        "대전광역시": "대전",
        "울산광역시": "울산",
        "세종특별자치시": "세종",
        "경기도": "경기",
        "강원특별자치도": "강원",
        "강원도": "강원",
        "충청북도": "충북",
        "충청남도": "충남",
        "전라북도": "전북",
        "전북특별자치도": "전북",
        "전라남도": "전남",
        "경상북도": "경북",
        "경상남도": "경남",
        "제주특별자치도": "제주",
    }
    return mapping.get(value, value)


def split_region(address: str) -> tuple[str, str]:
    parts = address.split()
    sido = compact_sido(parts[0]) if parts else ""
    sigungu = parts[1] if len(parts) > 1 else ""
    return sido, sigungu


def kakao_address_search(api_key: str, query: str) -> dict[str, Any] | None:
    params = urllib.parse.urlencode({"query": query, "size": 1})
    request = urllib.request.Request(
        f"{API_URL}?{params}",
        headers={"Authorization": f"KakaoAK {api_key}"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        payload = json.loads(response.read().decode("utf-8"))
    documents = payload.get("documents", [])
    if not documents:
        return None
    item = documents[0]
    if not isinstance(item, dict):
        return None
    return item


def checkpoint_from_result(row: dict[str, str], index: int, query: str, result: dict[str, Any]) -> dict[str, Any] | None:
    road_address = result.get("road_address") if isinstance(result.get("road_address"), dict) else None
    address = result.get("address") if isinstance(result.get("address"), dict) else None
    longitude = parse_float(result.get("x"))
    latitude = parse_float(result.get("y"))
    if longitude is None or latitude is None:
        return None

    road_address_name = clean_text((road_address or {}).get("address_name"))
    address_name = clean_text((address or {}).get("address_name") or result.get("address_name") or query)
    region_source = road_address_name or address_name or query
    sido = compact_sido(clean_text((address or {}).get("region_1depth_name")))
    sigungu = clean_text((address or {}).get("region_2depth_name"))
    fallback_sido, fallback_sigungu = split_region(region_source)
    business_name = clean_text(row.get("명칭")) or f"과적검문소 {index}"

    return {
        "id": f"checkpoint-{index}",
        "business_name": business_name,
        "status": "좌표확인",
        "phone": "",
        "address": query,
        "road_address": road_address_name,
        "longitude": longitude,
        "latitude": latitude,
        "sido": sido or fallback_sido,
        "sigungu": sigungu or fallback_sigungu,
        "source": SOURCE,
        "geocode_status": "success",
    }


def failed_row(row: dict[str, str], index: int, reason: str) -> dict[str, Any]:
    return {
        "id": f"checkpoint-{index}",
        "fail_reason": reason,
        "original_address": clean_text(row.get("원문")),
        "normalized_address": clean_text(row.get("정규화주소")),
        "address": clean_text(row.get("주소")),
        "query": pick_address(row),
        "source": SOURCE,
        "geocode_status": "failed",
    }


def write_json(path: Path, payload: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    fieldnames: list[str] = []
    for row in rows:
        for key in row:
            if key not in fieldnames:
                fieldnames.append(key)

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    load_env_file(PROJECT_ROOT / ".env")
    api_key = clean_text(os.getenv("KAKAO_REST_API_KEY"))
    if not api_key:
        print("KAKAO_REST_API_KEY 환경변수가 필요합니다.", file=sys.stderr)
        return 2

    input_path = Path(sys.argv[1]) if len(sys.argv) >= 2 else INPUT_CSV
    output_csv = Path(sys.argv[2]) if len(sys.argv) >= 3 else OUTPUT_CSV
    if not input_path.is_absolute():
        input_path = PROJECT_ROOT / input_path
    if not output_csv.is_absolute():
        output_csv = PROJECT_ROOT / output_csv

    with input_path.open(encoding="utf-8-sig", newline="") as file:
        rows = list(csv.DictReader(file))

    checkpoints: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    for index, row in enumerate(rows, start=1):
        query = pick_address(row)
        if not query:
            failed.append(failed_row(row, index, "주소 컬럼이 비어 있음"))
            row["상태"] = "실패"
            row["비고"] = "주소 컬럼이 비어 있음"
            continue

        try:
            result = kakao_address_search(api_key, query)
            if not result:
                failed.append(failed_row(row, index, "검색결과 없음"))
                row["상태"] = "실패"
                row["비고"] = "검색결과 없음"
            else:
                checkpoint = checkpoint_from_result(row, index, query, result)
                if checkpoint:
                    checkpoints.append(checkpoint)
                    row["위도(lat)"] = str(checkpoint["latitude"])
                    row["경도(lng)"] = str(checkpoint["longitude"])
                    row["매칭주소"] = clean_text(result.get("address_name"))
                    row["도로명주소"] = checkpoint["road_address"]
                    row["지번주소"] = clean_text(
                        (result.get("address") or {}).get("address_name")
                        if isinstance(result.get("address"), dict)
                        else "",
                    )
                    row["상태"] = "성공"
                    row["비고"] = ""
                else:
                    failed.append(failed_row(row, index, "좌표 없음"))
                    row["상태"] = "실패"
                    row["비고"] = "좌표 없음"
        except urllib.error.HTTPError as exc:
            failed.append(failed_row(row, index, f"HTTP 오류 {exc.code}"))
            row["상태"] = "실패"
            row["비고"] = f"HTTP 오류 {exc.code}"
        except Exception as exc:
            reason = str(exc)[:200]
            failed.append(failed_row(row, index, reason))
            row["상태"] = "실패"
            row["비고"] = reason

        time.sleep(0.05)

    write_csv(output_csv, rows)
    write_json(OUTPUT_JSON, checkpoints)
    write_json(FAILED_JSON, failed)

    print(f"CSV 저장: {output_csv}")
    print(f"성공 JSON 저장: {OUTPUT_JSON} ({len(checkpoints)}건)")
    print(f"실패 JSON 저장: {FAILED_JSON} ({len(failed)}건)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
