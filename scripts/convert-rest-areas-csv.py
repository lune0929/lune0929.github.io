#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convert national rest area CSV data to map-ready JSON."""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
INPUT_CSV = PROJECT_ROOT / "data" / "전국휴게소정보표준데이터.csv"
OUTPUT_JSON = PROJECT_ROOT / "public" / "data" / "rest-areas.json"


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


def convert_row(row: dict[str, str], index: int) -> dict[str, Any] | None:
    latitude = parse_float(row.get("위도"))
    longitude = parse_float(row.get("경도"))
    if not valid_coordinate(latitude, longitude):
        return None

    route_name = clean_text(row.get("도로노선명"))
    direction = clean_text(row.get("도로노선방향"))
    road_number = clean_text(row.get("도로노선번호"))
    address_parts = [route_name, direction]
    search_parts = [
        route_name,
        direction,
        road_number,
        clean_text(row.get("휴게소종류")),
        clean_text(row.get("휴게소대표음식명")),
        clean_text(row.get("기타편의시설")),
    ]

    return {
        "id": f"rest-area-{index}",
        "rest_area_name": clean_text(row.get("휴게소명")) or f"휴게소 {index}",
        "business_name": clean_text(row.get("휴게소명")) or f"휴게소 {index}",
        "status": clean_text(row.get("휴게소종류")) or "휴게소",
        "phone": clean_text(row.get("휴게소전화번호")),
        "address": " / ".join(part for part in address_parts if part),
        "road_address": "",
        "longitude": longitude,
        "latitude": latitude,
        "sido": "",
        "sigungu": "",
        "road_type": clean_text(row.get("도로종류")),
        "road_number": road_number,
        "route_name": route_name,
        "direction": direction,
        "open_time": clean_text(row.get("휴게소운영시작시각")),
        "close_time": clean_text(row.get("휴게소운영종료시각")),
        "parking_spaces": clean_text(row.get("주차면수")),
        "has_gas_station": clean_text(row.get("주유소유무")),
        "has_lpg": clean_text(row.get("LPG충전소유무")),
        "has_ev_charger": clean_text(row.get("전기차충전소유무")),
        "signature_food": clean_text(row.get("휴게소대표음식명")),
        "source": "national-rest-area-csv",
        "data_date": clean_text(row.get("데이터기준일자")),
        "search_text": " ".join(part for part in search_parts if part),
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

    print(f"휴게소 JSON 저장: {OUTPUT_JSON} ({len(converted)}건)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
