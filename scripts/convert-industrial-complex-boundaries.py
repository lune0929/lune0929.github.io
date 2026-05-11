#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convert industrial complex boundary SHP to WGS84 GeoJSON."""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from pathlib import Path
from typing import Any

from pyproj import CRS, Transformer

PROJECT_ROOT = Path(__file__).resolve().parents[1]
INPUT_DIR = PROJECT_ROOT / "data" / "DAM_DAN"
OUTPUT_GEOJSON = PROJECT_ROOT / "public" / "data" / "industrial-complex-boundaries.geojson"
TARGET_CRS = CRS.from_epsg(4326)
TYPE_NAMES = {
    "1": "국가산업단지",
    "2": "일반산업단지",
    "3": "도시첨단산업단지",
    "4": "농공단지",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert DAM_DAN industrial complex polygons to GeoJSON.")
    parser.add_argument("--input-dir", type=Path, default=INPUT_DIR)
    parser.add_argument("--output", type=Path, default=OUTPUT_GEOJSON)
    parser.add_argument(
        "--simplify",
        type=float,
        default=0,
        help="Optional Douglas-Peucker tolerance in EPSG:4326 degrees. Default keeps original geometry.",
    )
    return parser.parse_args()


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).strip().split())


def find_shp(input_dir: Path) -> Path:
    shp_files = sorted(input_dir.glob("*.shp"))
    if not shp_files:
        raise FileNotFoundError(f"SHP 파일을 찾지 못했습니다: {input_dir}")
    shp = shp_files[0]
    missing = [ext for ext in [".shx", ".dbf", ".prj"] if not shp.with_suffix(ext).exists()]
    if missing:
        raise FileNotFoundError(f"SHP 세트가 불완전합니다: {shp.name}, 누락 파일: {', '.join(missing)}")
    return shp


def read_encoding(shp: Path) -> str:
    cpg = shp.with_suffix(".cpg")
    if not cpg.exists():
        return "cp949"
    value = cpg.read_text(encoding="ascii", errors="ignore").strip()
    if value.upper() in {"EUC-KR", "CP949", "MS949"}:
        return "cp949"
    return value or "cp949"


def read_crs(shp: Path) -> CRS:
    prj = shp.with_suffix(".prj")
    if not prj.exists():
        raise RuntimeError(f".prj 파일이 없어 좌표계를 식별할 수 없습니다: {prj}")
    try:
        return CRS.from_wkt(prj.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RuntimeError(f"좌표계 WKT를 읽지 못했습니다: {prj} ({exc})") from exc


def shape_type_name(shape_type: int) -> str:
    return {
        1: "Point",
        3: "LineString",
        5: "Polygon",
        8: "MultiPoint",
        11: "PointZ",
        13: "LineStringZ",
        15: "PolygonZ",
        21: "PointM",
        23: "LineStringM",
        25: "PolygonM",
    }.get(shape_type, f"Unknown({shape_type})")


def validate_shape_type(shp: Path) -> int:
    with shp.open("rb") as file:
        header = file.read(100)
    if len(header) < 100:
        raise RuntimeError(f"SHP 헤더가 올바르지 않습니다: {shp}")
    shape_type = struct.unpack("<i", header[32:36])[0]
    if shape_type in {1, 8, 11, 21}:
        raise RuntimeError("이 파일은 경계가 아니라 점형 데이터입니다.")
    if shape_type in {3, 13, 23}:
        raise RuntimeError("이 파일은 경계 폴리곤이 아니라 선형 데이터입니다.")
    if shape_type not in {5, 15, 25}:
        raise RuntimeError(f"Polygon 계열 SHP만 지원합니다. 감지된 도형 유형: {shape_type_name(shape_type)}")
    return shape_type


def decode_field(raw: bytes, encoding: str) -> str:
    return raw.rstrip(b"\x00 ").decode(encoding, errors="replace").strip()


def parse_dbf_value(raw: bytes, field_type: str, encoding: str) -> Any:
    text = raw.decode(encoding, errors="replace").strip()
    if text == "":
        return ""
    if field_type in {"N", "F"}:
        try:
            return float(text) if "." in text else int(text)
        except ValueError:
            return text
    return text


def read_dbf(dbf: Path, encoding: str) -> tuple[list[dict[str, Any]], list[str]]:
    with dbf.open("rb") as file:
        header = file.read(32)
        record_count = struct.unpack("<I", header[4:8])[0]
        header_length = struct.unpack("<H", header[8:10])[0]
        record_length = struct.unpack("<H", header[10:12])[0]
        fields: list[tuple[str, str, int]] = []
        while True:
            descriptor = file.read(32)
            if not descriptor or descriptor[0] == 0x0D:
                break
            fields.append((decode_field(descriptor[:11], encoding), chr(descriptor[11]), descriptor[16]))

        file.seek(header_length)
        records: list[dict[str, Any]] = []
        for _ in range(record_count):
            record = file.read(record_length)
            if len(record) < record_length or record[:1] == b"*":
                continue
            offset = 1
            item: dict[str, Any] = {}
            for name, field_type, length in fields:
                item[name] = parse_dbf_value(record[offset : offset + length], field_type, encoding)
                offset += length
            records.append(item)
        return records, [field[0] for field in fields]


def source_value(row: dict[str, Any], *keys: str) -> str:
    lower_map = {key.lower(): key for key in row.keys()}
    for key in keys:
        source_key = lower_map.get(key.lower())
        if source_key:
            value = clean_text(row.get(source_key))
            if value:
                return value
    return ""


def standard_properties(row: dict[str, Any], index: int) -> dict[str, Any]:
    dan_id = source_value(row, "DAN_ID", "Dan_ID")
    name = source_value(row, "DAN_NAME", "Dan_name")
    short_name = source_value(row, "DANJI_SNM", "Danji_snm") or name
    type_code = source_value(row, "DANJI_TYPE", "Dan_Type", "DAN_TYPE")
    return {
        "id": dan_id or f"industrial-complex-{index + 1}",
        "dan_id": dan_id,
        "name": name,
        "short_name": short_name,
        "complex_type_code": type_code,
        "complex_type_name": TYPE_NAMES.get(type_code, "기타"),
        "source": "DAM_DAN_shp",
        "coordinate_status": "transformed_to_epsg_4326",
    }


def ring_area(ring: list[list[float]]) -> float:
    return sum(ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1] for i in range(len(ring) - 1)) / 2


def point_in_ring(point: list[float], ring: list[list[float]]) -> bool:
    x, y = point
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def perpendicular_distance(point: list[float], start: list[float], end: list[float]) -> float:
    x, y = point
    x1, y1 = start
    x2, y2 = end
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    return abs(dy * x - dx * y + x2 * y1 - y2 * x1) / math.hypot(dx, dy)


def douglas_peucker(points: list[list[float]], tolerance: float) -> list[list[float]]:
    if len(points) <= 2:
        return points
    max_distance = 0.0
    split_index = 0
    for index in range(1, len(points) - 1):
        distance = perpendicular_distance(points[index], points[0], points[-1])
        if distance > max_distance:
            max_distance = distance
            split_index = index
    if max_distance > tolerance:
        return douglas_peucker(points[: split_index + 1], tolerance)[:-1] + douglas_peucker(points[split_index:], tolerance)
    return [points[0], points[-1]]


def simplify_ring(ring: list[list[float]], tolerance: float) -> list[list[float]]:
    if tolerance <= 0 or len(ring) <= 4:
        return ring
    open_ring = ring[:-1] if ring[0] == ring[-1] else ring
    simplified = douglas_peucker(open_ring, tolerance)
    if simplified[0] != simplified[-1]:
        simplified.append(simplified[0])
    return simplified if len(simplified) >= 4 else ring


def close_ring(points: list[list[float]]) -> list[list[float]]:
    if points and points[0] != points[-1]:
        points.append(points[0])
    return points


def group_rings(rings: list[list[list[float]]]) -> list[list[list[list[float]]]]:
    candidates = [ring for ring in rings if len(ring) >= 4 and abs(ring_area(ring)) > 0]
    candidates.sort(key=lambda ring: abs(ring_area(ring)), reverse=True)
    outers: list[dict[str, Any]] = []
    for ring in candidates:
        containers = [outer for outer in candidates if outer is not ring and point_in_ring(ring[0], outer)]
        if len(containers) % 2 == 0:
            outers.append({"outer": ring, "holes": []})
        else:
            parent = min(
                (outer for outer in outers if point_in_ring(ring[0], outer["outer"])),
                key=lambda outer: abs(ring_area(outer["outer"])),
                default=None,
            )
            if parent:
                parent["holes"].append(ring)
    return [[item["outer"], *item["holes"]] for item in outers] or ([[candidates[0]]] if candidates else [])


def read_shapes(shp: Path, transformer: Transformer, tolerance: float) -> tuple[list[dict[str, Any]], list[float]]:
    geometries: list[dict[str, Any]] = []
    bounds = [180.0, 90.0, -180.0, -90.0]
    with shp.open("rb") as file:
        file.seek(100)
        while True:
            header = file.read(8)
            if not header:
                break
            _record_number, content_length_words = struct.unpack(">2i", header)
            content = file.read(content_length_words * 2)
            shape_type = struct.unpack("<i", content[:4])[0]
            if shape_type == 0:
                geometries.append({"type": None, "coordinates": None})
                continue
            if shape_type not in {5, 15, 25}:
                raise RuntimeError(f"Polygon 계열 레코드만 지원합니다. 감지: {shape_type_name(shape_type)}")
            num_parts, num_points = struct.unpack("<2i", content[36:44])
            parts_offset = 44
            points_offset = parts_offset + num_parts * 4
            parts = list(struct.unpack(f"<{num_parts}i", content[parts_offset:points_offset]))
            points: list[list[float]] = []
            for index in range(num_points):
                raw_x, raw_y = struct.unpack("<2d", content[points_offset + index * 16 : points_offset + (index + 1) * 16])
                lon, lat = transformer.transform(raw_x, raw_y)
                lon = round(float(lon), 8)
                lat = round(float(lat), 8)
                bounds[0] = min(bounds[0], lon)
                bounds[1] = min(bounds[1], lat)
                bounds[2] = max(bounds[2], lon)
                bounds[3] = max(bounds[3], lat)
                points.append([lon, lat])
            rings: list[list[list[float]]] = []
            for part_index, start in enumerate(parts):
                end = parts[part_index + 1] if part_index + 1 < len(parts) else len(points)
                ring = simplify_ring(close_ring(points[start:end]), tolerance)
                if len(ring) >= 4:
                    rings.append(ring)
            polygons = group_rings(rings)
            if len(polygons) == 1:
                geometries.append({"type": "Polygon", "coordinates": polygons[0]})
            else:
                geometries.append({"type": "MultiPolygon", "coordinates": polygons})
    return geometries, bounds


def validate_korea_bounds(bounds: list[float]) -> None:
    min_lon, min_lat, max_lon, max_lat = bounds
    if min_lon < 123 or max_lon > 133 or min_lat < 32 or max_lat > 40:
        raise RuntimeError(
            "좌표 변환 결과가 대한민국 범위를 벗어났습니다: "
            f"lon {min_lon:.5f}~{max_lon:.5f}, lat {min_lat:.5f}~{max_lat:.5f}",
        )


def main() -> int:
    args = parse_args()
    try:
        input_dir = args.input_dir if args.input_dir.is_absolute() else PROJECT_ROOT / args.input_dir
        shp = find_shp(input_dir)
        shape_type = validate_shape_type(shp)
        source_crs = read_crs(shp)
        transformer = Transformer.from_crs(source_crs, TARGET_CRS, always_xy=True)
        encoding = read_encoding(shp)
        records, fields = read_dbf(shp.with_suffix(".dbf"), encoding)
        geometries, bounds = read_shapes(shp, transformer, max(args.simplify, 0))
        validate_korea_bounds(bounds)

        features = []
        for index, geometry in enumerate(geometries):
            if not geometry["type"] or not geometry["coordinates"]:
                continue
            features.append(
                {
                    "type": "Feature",
                    "properties": standard_properties(records[index] if index < len(records) else {}, index),
                    "geometry": geometry,
                },
            )
        output = args.output if args.output.is_absolute() else PROJECT_ROOT / args.output
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("w", encoding="utf-8", newline="\n") as file:
            json.dump({"type": "FeatureCollection", "name": shp.stem, "features": features}, file, ensure_ascii=False, separators=(",", ":"))
            file.write("\n")

        print(f"입력 SHP: {shp}")
        print(f"도형 유형: {shape_type_name(shape_type)}")
        print(f"속성 필드: {', '.join(fields)}")
        print(f"원본 좌표계: {source_crs.to_string()}")
        print("출력 좌표계: EPSG:4326")
        print(f"좌표 범위: lon {bounds[0]:.5f}~{bounds[2]:.5f}, lat {bounds[1]:.5f}~{bounds[3]:.5f}")
        print(f"Feature 건수: {len(features)}")
        print(f"GeoJSON 저장: {output}")
        return 0
    except Exception as exc:
        print(f"산업단지 경계 SHP 변환 실패: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
