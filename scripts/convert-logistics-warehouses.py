#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convert logistics warehouse CSV to map-ready JSON."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any

from pyproj import Transformer

PROJECT_ROOT = Path(__file__).resolve().parents[1]
INPUT_CSV = PROJECT_ROOT / "data" / "기타_물류창고업체.csv"
OUTPUT_JSON = PROJECT_ROOT / "public" / "data" / "logistics-warehouses.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert logistics warehouse CSV to JSON.")
    parser.add_argument("--input", type=Path, default=INPUT_CSV)
    parser.add_argument("--output", type=Path, default=OUTPUT_JSON)
    parser.add_argument(
        "--source-epsg",
        type=int,
        default=2097,
        help="Source coordinate EPSG for 좌표정보(X/Y). LocalData CSV samples match EPSG:2097.",
    )
    return parser.parse_args()


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).strip().split())


def parse_float(value: Any) -> float:
    text = clean_text(value).replace(",", "")
    if not text:
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


def parse_optional_float(value: Any) -> float | None:
    text = clean_text(value).replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def size_class(total_area: float) -> str:
    if total_area >= 20000:
        return "대형"
    if total_area >= 5000:
        return "중형"
    return "소형"


def main() -> int:
    args = parse_args()
    input_path = args.input if args.input.is_absolute() else PROJECT_ROOT / args.input
    output_path = args.output if args.output.is_absolute() else PROJECT_ROOT / args.output
    transformer = Transformer.from_crs(args.source_epsg, 4326, always_xy=True)

    with input_path.open(encoding="cp949", newline="") as file:
        rows = list(csv.DictReader(file))

    payload: list[dict[str, Any]] = []
    skipped_status = 0
    missing_coords = 0
    transformed_coords = 0

    for index, row in enumerate(rows, start=1):
        status = clean_text(row.get("영업상태명"))
        if status != "영업/정상":
            skipped_status += 1
            continue

        general_area = parse_float(row.get("일반창고면적"))
        cold_area = parse_float(row.get("냉동냉장창고면적"))
        storage_area = parse_float(row.get("보관장소면적"))
        total_area = general_area + cold_area + storage_area
        x = parse_optional_float(row.get("좌표정보(X)"))
        y = parse_optional_float(row.get("좌표정보(Y)"))

        latitude: float | None = None
        longitude: float | None = None
        coordinate_status = "missing"
        if x is not None and y is not None:
            longitude, latitude = transformer.transform(x, y)
            longitude = round(float(longitude), 8)
            latitude = round(float(latitude), 8)
            coordinate_status = f"transformed_epsg_{args.source_epsg}_to_4326"
            transformed_coords += 1
        else:
            missing_coords += 1

        payload.append(
            {
                "id": f"logistics-warehouse-{index}",
                "business_name": clean_text(row.get("사업장명")),
                "status": status,
                "road_address": clean_text(row.get("도로명주소")),
                "jibun_address": clean_text(row.get("지번주소")),
                "total_warehouse_area": round(total_area, 2),
                "general_warehouse_area": round(general_area, 2),
                "cold_storage_area": round(cold_area, 2),
                "storage_place_area": round(storage_area, 2),
                "warehouse_size_class": size_class(total_area),
                "is_mega": total_area >= 50000,
                "business_storage": clean_text(row.get("업태보관및창고업")),
                "business_transport": clean_text(row.get("업태운송및택배업")),
                "latitude": latitude,
                "longitude": longitude,
                "source": "localdata-logistics-warehouse-csv",
                "coordinate_status": coordinate_status,
            },
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")

    print(f"입력 CSV: {input_path}")
    print(f"전체 행 수: {len(rows)}")
    print(f"영업/정상 출력 건수: {len(payload)}")
    print(f"영업/정상 외 제외 건수: {skipped_status}")
    print(f"좌표 변환 건수: {transformed_coords}")
    print(f"좌표 누락 건수: {missing_coords}")
    print(f"출력 JSON: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
