#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convert truck accident hotspot CSV to map-ready JSON and GeoJSON."""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
INPUT_CSV = PROJECT_ROOT / "data" / "한국도로교통공단_화물차 교통사고 다발지역.csv"
OUTPUT_JSON = PROJECT_ROOT / "public" / "data" / "truck-accident-hotspots.json"
OUTPUT_GEOJSON = PROJECT_ROOT / "public" / "data" / "truck-accident-hotspots.geojson"


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).strip().split())


def parse_int(value: Any) -> int:
    text = clean_text(value).replace(",", "")
    if not text:
        return 0
    return int(float(text))


def parse_float(value: Any) -> float:
    return float(clean_text(value).replace(",", ""))


def validate_korea_coordinate(longitude: float, latitude: float, row_no: int) -> None:
    if not (124 <= longitude <= 132 and 33 <= latitude <= 39):
        raise ValueError(f"{row_no}행 좌표가 대한민국 범위를 벗어났습니다: {longitude}, {latitude}")


def validate_polygon(geometry: Any, row_no: int) -> dict[str, Any]:
    if not isinstance(geometry, dict) or geometry.get("type") != "Polygon":
        raise ValueError(f"{row_no}행 다발지역폴리곤이 Polygon이 아닙니다.")
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or not coordinates:
        raise ValueError(f"{row_no}행 다발지역폴리곤 좌표가 비어 있습니다.")
    for ring in coordinates:
        if not isinstance(ring, list) or len(ring) < 4:
            raise ValueError(f"{row_no}행 Polygon ring이 올바르지 않습니다.")
        for point in ring:
            if not isinstance(point, list) or len(point) < 2:
                raise ValueError(f"{row_no}행 Polygon 좌표 형식이 올바르지 않습니다.")
            lon = float(point[0])
            lat = float(point[1])
            validate_korea_coordinate(lon, lat, row_no)
    return geometry


def main() -> int:
    try:
        with INPUT_CSV.open(encoding="cp949", newline="") as file:
            rows = list(csv.DictReader(file))

        json_items: list[dict[str, Any]] = []
        features: list[dict[str, Any]] = []
        for index, row in enumerate(rows, start=1):
            longitude = parse_float(row.get("경도"))
            latitude = parse_float(row.get("위도"))
            validate_korea_coordinate(longitude, latitude, index)

            item = {
                "id": f"truck-accident-hotspot-{clean_text(row.get('사고다발지fid')) or index}",
                "hotspot_id": clean_text(row.get("사고다발지id")),
                "legal_dong_code": clean_text(row.get("법정동코드")),
                "spot_code": clean_text(row.get("지점코드")),
                "region_name": clean_text(row.get("시도시군구명")),
                "spot_name": clean_text(row.get("지점명")),
                "accident_count": parse_int(row.get("사고건수")),
                "casualty_count": parse_int(row.get("사상자수")),
                "death_count": parse_int(row.get("사망자수")),
                "serious_injury_count": parse_int(row.get("중상자수")),
                "minor_injury_count": parse_int(row.get("경상자수")),
                "reported_injury_count": parse_int(row.get("부상신고자수")),
                "longitude": longitude,
                "latitude": latitude,
                "source": "koroad-truck-accident-hotspots-csv",
            }
            geometry = validate_polygon(json.loads(clean_text(row.get("다발지역폴리곤"))), index)
            json_items.append(item)
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        key: item[key]
                        for key in [
                            "id",
                            "hotspot_id",
                            "region_name",
                            "spot_name",
                            "accident_count",
                            "casualty_count",
                            "death_count",
                            "serious_injury_count",
                            "minor_injury_count",
                            "reported_injury_count",
                            "longitude",
                            "latitude",
                            "source",
                        ]
                    },
                    "geometry": geometry,
                },
            )

        OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
        with OUTPUT_JSON.open("w", encoding="utf-8", newline="\n") as file:
            json.dump(json_items, file, ensure_ascii=False, indent=2)
            file.write("\n")
        with OUTPUT_GEOJSON.open("w", encoding="utf-8", newline="\n") as file:
            json.dump({"type": "FeatureCollection", "features": features}, file, ensure_ascii=False, separators=(",", ":"))
            file.write("\n")

        print(f"입력 CSV: {INPUT_CSV}")
        print(f"JSON 건수: {len(json_items)}")
        print(f"GeoJSON Feature 건수: {len(features)}")
        print(f"JSON 저장: {OUTPUT_JSON}")
        print(f"GeoJSON 저장: {OUTPUT_GEOJSON}")
        return 0
    except Exception as exc:
        print(f"화물차 사고다발지역 변환 실패: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
