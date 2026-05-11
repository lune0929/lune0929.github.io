#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convert traffic accident hotspot CSV data to map-ready JSON."""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
INPUT_CSV = PROJECT_ROOT / "data" / "전국교통사고다발지역표준데이터.csv"
OUTPUT_JSON = PROJECT_ROOT / "public" / "data" / "accident-hotspots.json"


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).strip().split())


def parse_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(str(value).strip())
    except ValueError:
        return None


def valid_coordinate(latitude: float | None, longitude: float | None) -> bool:
    return latitude is not None and longitude is not None and 30 <= latitude <= 45 and 120 <= longitude <= 135


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


def split_region(value: str) -> tuple[str, str]:
    text = re.sub(r"\d+$", "", clean_text(value))
    parts = text.split()
    sido = compact_sido(parts[0]) if parts else ""
    sigungu = parts[1] if len(parts) > 1 else ""
    return sido, sigungu


def convert_row(row: dict[str, str], index: int) -> dict[str, Any] | None:
    latitude = parse_float(row.get("위도"))
    longitude = parse_float(row.get("경도"))
    if not valid_coordinate(latitude, longitude):
        return None

    accident_type = clean_text(row.get("사고유형구분"))
    location_name = clean_text(row.get("사고지역위치명"))
    region_name = clean_text(row.get("사고다발지역시도시군구"))
    sido, sigungu = split_region(region_name or location_name)
    accident_count = clean_text(row.get("사고건수"))
    casualty_count = clean_text(row.get("사상자수"))
    fatality_count = clean_text(row.get("사망자수"))

    return {
        "id": f"accident-hotspot-{index}",
        "hotspot_id": clean_text(row.get("사고지역관리번호")),
        "business_name": f"{accident_type} 사고다발지역 {index}",
        "status": accident_type or "사고다발지역",
        "phone": "",
        "address": location_name,
        "road_address": "",
        "longitude": longitude,
        "latitude": latitude,
        "sido": sido,
        "sigungu": sigungu,
        "accident_year": clean_text(row.get("사고연도")),
        "location_code": clean_text(row.get("위치코드")),
        "region_name": region_name,
        "accident_type": accident_type,
        "accident_count": accident_count,
        "casualty_count": casualty_count,
        "fatality_count": fatality_count,
        "serious_injury_count": clean_text(row.get("중상자수")),
        "minor_injury_count": clean_text(row.get("경상자수")),
        "reported_injury_count": clean_text(row.get("부상신고자수")),
        "source": "national-accident-hotspot-csv",
        "data_date": clean_text(row.get("데이터기준일자")),
        "search_text": " ".join(
            part
            for part in [
                accident_type,
                location_name,
                region_name,
                accident_count,
                casualty_count,
                fatality_count,
            ]
            if part
        ),
    }


def main() -> int:
    with INPUT_CSV.open(encoding="cp949", newline="") as file:
        rows = list(csv.DictReader(file))

    converted = [
        item
        for index, row in enumerate(rows, start=1)
        if (item := convert_row(row, index)) is not None
    ]

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_JSON.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(converted, file, ensure_ascii=False, indent=2)
        file.write("\n")

    print(f"사고다발지역 JSON 저장: {OUTPUT_JSON} ({len(converted)}건)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
