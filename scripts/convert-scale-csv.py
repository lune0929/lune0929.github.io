#!/usr/bin/env python
"""Convert private scale office CSV rows into static WGS84 JSON."""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path
from typing import Iterable

from pyproj import Transformer


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = PROJECT_ROOT / "public" / "data" / "scale-offices.json"
DEFAULT_INPUT_DIRS = [
    PROJECT_ROOT / "scripts" / "input",
    PROJECT_ROOT / "data" / "raw",
]

COLUMN_CANDIDATES = {
    "business_name": [
        "사업장명",
        "업소명",
        "상호",
        "상호명",
        "계량소명",
        "민간계량소명",
        "업체명",
    ],
    "status": [
        "영업상태",
        "영업상태명",
        "상태",
        "상세영업상태명",
        "영업상태구분",
    ],
    "phone": [
        "전화번호",
        "소재지전화",
        "소재지전화번호",
        "연락처",
        "사업장전화번호",
    ],
    "address": [
        "소재지주소",
        "지번주소",
        "소재지전체주소",
        "주소",
        "사업장소재지",
    ],
    "road_address": [
        "도로명주소",
        "도로명전체주소",
        "도로명소재지주소",
        "소재지도로명주소",
    ],
    "x": [
        "좌표정보(X)",
        "좌표정보x",
        "좌표정보 X",
        "좌표X",
        "X좌표",
        "x",
        "X",
    ],
    "y": [
        "좌표정보(Y)",
        "좌표정보y",
        "좌표정보 Y",
        "좌표Y",
        "Y좌표",
        "y",
        "Y",
    ],
}


def normalize_header(value: str) -> str:
    return re.sub(r"[\s_()\[\]{}./-]+", "", value or "").lower()


def find_column(headers: Iterable[str], candidates: Iterable[str]) -> str | None:
    normalized = {normalize_header(header): header for header in headers}
    for candidate in candidates:
        match = normalized.get(normalize_header(candidate))
        if match:
            return match
    return None


def pick(row: dict[str, str], header_map: dict[str, str | None], key: str) -> str:
    column = header_map.get(key)
    if not column:
        return ""
    return clean_text(row.get(column, ""))


def clean_text(value: str | None) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def parse_number(value: str) -> float | None:
    cleaned = clean_text(value).replace(",", "")
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def format_phone(value: str) -> str:
    text = clean_text(value)
    if not text:
        return ""
    digits = re.sub(r"\D", "", text)
    if not digits:
        return text
    if digits.startswith("82"):
        digits = "0" + digits[2:]
    if digits.startswith("02"):
        if len(digits) == 9:
            return f"{digits[:2]}-{digits[2:5]}-{digits[5:]}"
        if len(digits) == 10:
            return f"{digits[:2]}-{digits[2:6]}-{digits[6:]}"
    if len(digits) == 10:
        return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"
    if len(digits) == 11:
        return f"{digits[:3]}-{digits[3:7]}-{digits[7:]}"
    return text


def extract_region(address: str, road_address: str) -> tuple[str, str]:
    source = road_address or address
    parts = source.split()
    sido = parts[0] if len(parts) >= 1 else ""
    sigungu = parts[1] if len(parts) >= 2 else ""
    if len(parts) >= 3 and parts[1].endswith("시") and parts[2].endswith(("구", "군")):
        sigungu = f"{parts[1]} {parts[2]}"
    return sido, sigungu


def read_csv(path: Path) -> tuple[list[dict[str, str]], list[str]]:
    encodings = ["utf-8-sig", "cp949", "euc-kr"]
    last_error: Exception | None = None
    for encoding in encodings:
        try:
            with path.open("r", encoding=encoding, newline="") as csv_file:
                sample = csv_file.read(4096)
                csv_file.seek(0)
                dialect = csv.Sniffer().sniff(sample) if sample else csv.excel
                reader = csv.DictReader(csv_file, dialect=dialect)
                rows = [dict(row) for row in reader]
                return rows, reader.fieldnames or []
        except UnicodeDecodeError as exc:
            last_error = exc
        except csv.Error:
            with path.open("r", encoding=encoding, newline="") as csv_file:
                reader = csv.DictReader(csv_file)
                rows = [dict(row) for row in reader]
                return rows, reader.fieldnames or []
    raise RuntimeError(f"CSV 파일을 읽을 수 없습니다: {path}") from last_error


def find_default_csv() -> Path:
    csv_files: list[Path] = []
    for input_dir in DEFAULT_INPUT_DIRS:
        if input_dir.exists():
            csv_files.extend(sorted(input_dir.glob("*.csv")))
    if not csv_files:
        searched = ", ".join(str(path.relative_to(PROJECT_ROOT)) for path in DEFAULT_INPUT_DIRS)
        raise FileNotFoundError(f"CSV 파일을 찾지 못했습니다. 다음 폴더 중 하나에 넣어주세요: {searched}")
    if len(csv_files) > 1:
        names = ", ".join(str(path.relative_to(PROJECT_ROOT)) for path in csv_files)
        raise ValueError(f"CSV 파일이 여러 개입니다. --input으로 하나를 지정해주세요: {names}")
    return csv_files[0]


def convert(input_path: Path, output_path: Path) -> int:
    rows, headers = read_csv(input_path)
    header_map = {
        key: find_column(headers, candidates)
        for key, candidates in COLUMN_CANDIDATES.items()
    }
    missing = [key for key in ("business_name", "x", "y") if not header_map.get(key)]
    if missing:
        raise ValueError(f"필수 컬럼을 찾지 못했습니다: {', '.join(missing)}")

    transformer = Transformer.from_crs("EPSG:5174", "EPSG:4326", always_xy=True)
    converted = []
    skipped = 0

    for index, row in enumerate(rows, start=1):
        x = parse_number(pick(row, header_map, "x"))
        y = parse_number(pick(row, header_map, "y"))
        if x is None or y is None:
            skipped += 1
            continue

        longitude, latitude = transformer.transform(x, y)
        if not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
            skipped += 1
            continue

        address = pick(row, header_map, "address")
        road_address = pick(row, header_map, "road_address")
        sido, sigungu = extract_region(address, road_address)
        business_name = pick(row, header_map, "business_name")

        converted.append(
            {
                "id": str(index),
                "business_name": business_name,
                "status": pick(row, header_map, "status"),
                "phone": format_phone(pick(row, header_map, "phone")),
                "address": address,
                "road_address": road_address,
                "longitude": round(longitude, 7),
                "latitude": round(latitude, 7),
                "sido": sido,
                "sigungu": sigungu,
            }
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(converted, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"입력: {input_path}")
    print(f"출력: {output_path}")
    print(f"변환 완료: {len(converted)}건, 제외: {skipped}건")
    return len(converted)


def main() -> int:
    parser = argparse.ArgumentParser(description="민간계량소 CSV를 정적 지도용 JSON으로 변환합니다.")
    parser.add_argument(
        "--input",
        type=Path,
        default=None,
        help="원본 CSV 경로. 생략하면 scripts/input 또는 data/raw의 CSV 1개를 사용합니다.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="생성할 JSON 경로.",
    )
    args = parser.parse_args()

    input_path = args.input or find_default_csv()
    output_path = args.output
    if not input_path.is_absolute():
        input_path = PROJECT_ROOT / input_path
    if not output_path.is_absolute():
        output_path = PROJECT_ROOT / output_path

    try:
        convert(input_path, output_path)
    except Exception as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
