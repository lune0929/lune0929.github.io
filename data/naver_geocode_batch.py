#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Address batch geocoder for overload checkpoint map data.

The script reads a CSV file, geocodes address rows through Naver Cloud Platform
Maps Geocoding API when credentials are present, and writes both CSV and map-ready
JSON outputs. API keys are read only from environment variables and are never
printed.
"""

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

API_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode"
ADDRESS_COLUMNS = ("정규화주소", "주소", "원문")
OUTPUT_JSON = Path("public/data/overload-checkpoints.json")
FAILED_JSON = Path("public/data/overload-checkpoints-failed.json")
SOURCE = "manual-address-csv"


def pick_address(row: dict[str, str]) -> str:
    for column in ADDRESS_COLUMNS:
        value = (row.get(column) or "").strip()
        if value:
            return value
    return ""


def parse_float(value: str | None) -> float | None:
    if value is None:
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


def extract_region(result: dict[str, Any], fallback_address: str) -> tuple[str, str]:
    sido = ""
    sigungu = ""
    for element in result.get("addressElements", []):
        types = element.get("types", [])
        long_name = element.get("longName", "")
        if "SIDO" in types:
            sido = compact_sido(long_name)
        elif "SIGUGUN" in types:
            sigungu = long_name

    fallback_sido, fallback_sigungu = split_region(fallback_address)
    return sido or fallback_sido, sigungu or fallback_sigungu


def geocode_naver(query: str, key_id: str, key: str) -> dict[str, Any] | None:
    url = API_URL + "?query=" + urllib.parse.quote(query)
    req = urllib.request.Request(url)
    req.add_header("X-NCP-APIGW-API-KEY-ID", key_id)
    req.add_header("X-NCP-APIGW-API-KEY", key)
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    addresses = data.get("addresses", [])
    if not addresses:
        return None
    return addresses[0]


def checkpoint_from_row(row: dict[str, str], index: int, result: dict[str, Any] | None) -> dict[str, Any] | None:
    query = pick_address(row)
    latitude = parse_float(row.get("위도(lat)"))
    longitude = parse_float(row.get("경도(lng)"))
    road_address = (row.get("도로명주소") or "").strip()
    matched_address = (row.get("매칭주소") or "").strip()

    if result:
        latitude = parse_float(result.get("y"))
        longitude = parse_float(result.get("x"))
        road_address = result.get("roadAddress") or ""
        matched_address = result.get("jibunAddress") or result.get("roadAddress") or query

    if latitude is None or longitude is None:
        return None

    region_source = road_address or matched_address or query
    sido, sigungu = extract_region(result, region_source) if result else split_region(region_source)
    business_name = (row.get("명칭") or "").strip() or f"과적검문소 {index}"

    return {
        "id": f"checkpoint-{index}",
        "business_name": business_name,
        "status": "좌표확인",
        "phone": "",
        "address": query,
        "road_address": road_address,
        "longitude": longitude,
        "latitude": latitude,
        "sido": sido,
        "sigungu": sigungu,
        "source": SOURCE,
        "geocode_status": "success",
    }


def failed_row(row: dict[str, str], index: int, reason: str) -> dict[str, Any]:
    return {
        "id": f"checkpoint-{index}",
        "fail_reason": reason,
        "original_address": (row.get("원문") or "").strip(),
        "normalized_address": (row.get("정규화주소") or "").strip(),
        "address": (row.get("주소") or "").strip(),
        "query": pick_address(row),
        "source": SOURCE,
        "geocode_status": "failed",
    }


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    fieldnames: list[str] = []
    for row in rows:
        for key in row.keys():
            if key not in fieldnames:
                fieldnames.append(key)

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_json(path: Path, payload: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main() -> int:
    if len(sys.argv) < 3:
        print("사용법: python data/naver_geocode_batch.py input.csv output.csv")
        return 1

    root = Path(__file__).resolve().parents[1]
    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    if not input_path.is_absolute():
        input_path = root / input_path
    if not output_path.is_absolute():
        output_path = root / output_path

    key_id = os.getenv("NCP_MAPS_KEY_ID")
    key = os.getenv("NCP_MAPS_KEY")
    can_geocode = bool(key_id and key)
    if not can_geocode:
        print("NCP_MAPS_KEY_ID 또는 NCP_MAPS_KEY가 없어 API 호출 없이 기존 좌표만 변환합니다.")

    with input_path.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    checkpoints: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    for index, row in enumerate(rows, start=1):
        query = pick_address(row)
        result: dict[str, Any] | None = None
        reason = ""

        if not query:
            reason = "주소 컬럼이 비어 있음"
        elif can_geocode:
            try:
                result = geocode_naver(query, key_id or "", key or "")
                if not result:
                    reason = "검색결과 없음"
            except urllib.error.HTTPError as exc:
                reason = f"HTTP 오류 {exc.code}"
            except Exception as exc:
                reason = str(exc)[:200]
            time.sleep(0.05)
        else:
            reason = "NCP 지도 API 환경변수 미설정"

        checkpoint = checkpoint_from_row(row, index, result)
        if checkpoint:
            checkpoints.append(checkpoint)
            row["위도(lat)"] = str(checkpoint["latitude"])
            row["경도(lng)"] = str(checkpoint["longitude"])
            row["매칭주소"] = result.get("jibunAddress", "") if result else row.get("매칭주소", "")
            row["도로명주소"] = checkpoint["road_address"]
            row["지번주소"] = result.get("jibunAddress", "") if result else row.get("지번주소", "")
            row["상태"] = "성공"
            row["비고"] = ""
        else:
            failed.append(failed_row(row, index, reason or "좌표 없음"))
            row["상태"] = "실패"
            row["비고"] = reason or "좌표 없음"

    write_csv(output_path, rows)
    write_json(root / OUTPUT_JSON, checkpoints)
    write_json(root / FAILED_JSON, failed)

    print(f"CSV 저장: {output_path}")
    print(f"성공 JSON 저장: {root / OUTPUT_JSON} ({len(checkpoints)}건)")
    print(f"실패 JSON 저장: {root / FAILED_JSON} ({len(failed)}건)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
