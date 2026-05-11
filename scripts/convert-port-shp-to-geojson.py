#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convert port area Shapefile data under data/ to WGS84 GeoJSON."""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from pyproj import CRS, Transformer

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
DEFAULT_OUTPUT = PROJECT_ROOT / "public" / "data" / "port-areas.geojson"
TARGET_CRS = CRS.from_epsg(4326)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert port area SHP to GeoJSON EPSG:4326.")
    parser.add_argument("--input", type=Path, default=None, help="Optional .shp, .zip, or folder path.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Output GeoJSON path.")
    parser.add_argument(
        "--simplify",
        type=float,
        default=0,
        help="Optional Douglas-Peucker tolerance in EPSG:4326 degrees. Default keeps original geometry.",
    )
    return parser.parse_args()


def find_port_source(input_path: Path | None) -> tuple[Path, tempfile.TemporaryDirectory[str] | None]:
    if input_path:
        source = input_path if input_path.is_absolute() else PROJECT_ROOT / input_path
        return resolve_source(source)

    candidates = sorted(DATA_DIR.rglob("*.shp")) + sorted(DATA_DIR.rglob("*.zip"))
    port_candidates = [path for path in candidates if "항만" in str(path) or "port" in str(path).lower()]
    for candidate in port_candidates + candidates:
        try:
            return resolve_source(candidate)
        except FileNotFoundError:
            continue
    raise FileNotFoundError("data 폴더에서 변환 가능한 SHP 세트 또는 zip 파일을 찾지 못했습니다.")


def resolve_source(source: Path) -> tuple[Path, tempfile.TemporaryDirectory[str] | None]:
    if source.is_dir():
        shp_files = sorted(source.glob("*.shp"))
        if not shp_files:
            raise FileNotFoundError(f"SHP 파일이 없습니다: {source}")
        shp = shp_files[0]
        validate_shp_set(shp)
        return shp, None
    if source.suffix.lower() == ".zip":
        temp_dir = tempfile.TemporaryDirectory()
        with zipfile.ZipFile(source) as archive:
            archive.extractall(temp_dir.name)
        shp_files = sorted(Path(temp_dir.name).rglob("*.shp"))
        if not shp_files:
            temp_dir.cleanup()
            raise FileNotFoundError(f"zip 안에 SHP 파일이 없습니다: {source}")
        shp = shp_files[0]
        validate_shp_set(shp)
        return shp, temp_dir
    if source.suffix.lower() == ".shp":
        validate_shp_set(source)
        return source, None
    raise FileNotFoundError(f"지원하지 않는 입력입니다: {source}")


def validate_shp_set(shp: Path) -> None:
    missing = [ext for ext in [".shx", ".dbf", ".prj"] if not shp.with_suffix(ext).exists()]
    if missing:
        raise FileNotFoundError(f"SHP 세트가 불완전합니다: {shp.name}, 누락 파일: {', '.join(missing)}")


def read_crs(shp: Path) -> CRS:
    prj = shp.with_suffix(".prj")
    if not prj.exists():
        raise RuntimeError(f".prj 파일이 없어 좌표계를 식별할 수 없습니다: {prj}")
    try:
        return CRS.from_wkt(prj.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RuntimeError(f"좌표계 WKT를 읽지 못했습니다: {prj} ({exc})") from exc


def read_encoding(shp: Path) -> str:
    cpg = shp.with_suffix(".cpg")
    if not cpg.exists():
        return "cp949"
    value = cpg.read_text(encoding="ascii", errors="ignore").strip()
    if value.upper() in {"EUC-KR", "CP949", "MS949"}:
        return "cp949"
    return value or "cp949"


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
    if field_type == "L":
        return text.upper() in {"Y", "T"}
    return text


def read_dbf(dbf: Path, encoding: str) -> list[dict[str, Any]]:
    with dbf.open("rb") as file:
        header = file.read(32)
        if len(header) < 32:
            raise RuntimeError(f"DBF 헤더가 올바르지 않습니다: {dbf}")
        record_count = struct.unpack("<I", header[4:8])[0]
        header_length = struct.unpack("<H", header[8:10])[0]
        record_length = struct.unpack("<H", header[10:12])[0]

        fields: list[tuple[str, str, int, int]] = []
        while True:
            descriptor = file.read(32)
            if not descriptor or descriptor[0] == 0x0D:
                break
            name = decode_field(descriptor[:11], encoding)
            field_type = chr(descriptor[11])
            length = descriptor[16]
            decimal = descriptor[17]
            fields.append((name, field_type, length, decimal))

        file.seek(header_length)
        records: list[dict[str, Any]] = []
        for _ in range(record_count):
            record = file.read(record_length)
            if len(record) < record_length or record[:1] == b"*":
                continue
            offset = 1
            item: dict[str, Any] = {}
            for name, field_type, length, _decimal in fields:
                item[name] = parse_dbf_value(record[offset : offset + length], field_type, encoding)
                offset += length
            records.append(item)
        return records


def ring_area(ring: list[list[float]]) -> float:
    area = 0.0
    for index in range(len(ring) - 1):
        x1, y1 = ring[index]
        x2, y2 = ring[index + 1]
        area += x1 * y2 - x2 * y1
    return area / 2


def point_in_ring(point: list[float], ring: list[list[float]]) -> bool:
    x, y = point
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        intersects = (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi
        if intersects:
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
        left = douglas_peucker(points[: split_index + 1], tolerance)
        right = douglas_peucker(points[split_index:], tolerance)
        return left[:-1] + right
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
    if not points:
        return points
    if points[0] != points[-1]:
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
        elif outers:
            parent = min(
                (outer for outer in outers if point_in_ring(ring[0], outer["outer"])),
                key=lambda outer: abs(ring_area(outer["outer"])),
                default=None,
            )
            if parent:
                parent["holes"].append(ring)

    if not outers and candidates:
        return [[candidates[0]]]
    return [[item["outer"], *item["holes"]] for item in outers]


def read_shapes(shp: Path, transformer: Transformer, simplify: float) -> list[dict[str, Any]]:
    shapes: list[dict[str, Any]] = []
    with shp.open("rb") as file:
        file.seek(100)
        while True:
            record_header = file.read(8)
            if not record_header:
                break
            if len(record_header) < 8:
                raise RuntimeError(f"SHP 레코드 헤더가 올바르지 않습니다: {shp}")
            _record_number, content_length_words = struct.unpack(">2i", record_header)
            content = file.read(content_length_words * 2)
            if len(content) < 4:
                continue
            shape_type = struct.unpack("<i", content[:4])[0]
            if shape_type == 0:
                shapes.append({"type": None, "coordinates": None})
                continue
            if shape_type not in {5, 15, 25}:
                raise RuntimeError(f"Polygon 계열 SHP만 지원합니다. 감지된 shapeType={shape_type}")
            if len(content) < 44:
                continue
            num_parts, num_points = struct.unpack("<2i", content[36:44])
            parts_offset = 44
            points_offset = parts_offset + num_parts * 4
            parts = list(struct.unpack(f"<{num_parts}i", content[parts_offset:points_offset]))
            points: list[list[float]] = []
            for index in range(num_points):
                raw_x, raw_y = struct.unpack("<2d", content[points_offset + index * 16 : points_offset + (index + 1) * 16])
                lon, lat = transformer.transform(raw_x, raw_y)
                if math.isfinite(lon) and math.isfinite(lat):
                    points.append([round(lon, 8), round(lat, 8)])
                else:
                    points.append([lon, lat])

            rings: list[list[list[float]]] = []
            for part_index, start in enumerate(parts):
                end = parts[part_index + 1] if part_index + 1 < len(parts) else len(points)
                ring = close_ring(points[start:end])
                ring = simplify_ring(ring, simplify)
                if len(ring) >= 4:
                    rings.append(ring)

            polygons = group_rings(rings)
            if len(polygons) == 1:
                shapes.append({"type": "Polygon", "coordinates": polygons[0]})
            else:
                shapes.append({"type": "MultiPolygon", "coordinates": polygons})
    return shapes


def main() -> int:
    args = parse_args()
    temp_dir: tempfile.TemporaryDirectory[str] | None = None
    try:
        shp, temp_dir = find_port_source(args.input)
        source_crs = read_crs(shp)
        transformer = Transformer.from_crs(source_crs, TARGET_CRS, always_xy=True)
        encoding = read_encoding(shp)
        records = read_dbf(shp.with_suffix(".dbf"), encoding)
        shapes = read_shapes(shp, transformer, max(args.simplify, 0))

        features = []
        for index, geometry in enumerate(shapes):
            if not geometry["type"] or not geometry["coordinates"]:
                continue
            properties = records[index] if index < len(records) else {}
            features.append(
                {
                    "type": "Feature",
                    "properties": properties,
                    "geometry": geometry,
                },
            )

        payload = {
            "type": "FeatureCollection",
            "name": shp.stem,
            "crs": {"type": "name", "properties": {"name": "EPSG:4326"}},
            "features": features,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("w", encoding="utf-8", newline="\n") as file:
            json.dump(payload, file, ensure_ascii=False, separators=(",", ":"))
            file.write("\n")

        print(f"입력 SHP: {shp}")
        print(f"원본 좌표계: {source_crs.to_string()}")
        print(f"출력 좌표계: EPSG:4326")
        print(f"Feature 건수: {len(features)}")
        print(f"GeoJSON 저장: {args.output}")
        return 0
    except Exception as exc:
        print(f"항만구역 SHP 변환 실패: {exc}", file=sys.stderr)
        return 1
    finally:
        if temp_dir:
            temp_dir.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
