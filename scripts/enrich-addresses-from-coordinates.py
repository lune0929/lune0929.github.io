#!/usr/bin/env python
"""Enrich static map JSON address fields from latitude/longitude coordinates."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "public" / "data"
TARGETS = {
    "highway": DATA_DIR / "highway-toll-offices.json",
    "scale": DATA_DIR / "scale-offices.json",
}
FAILED_OUTPUT = DATA_DIR / "address-enrich-failed.json"
KAKAO_COORD2ADDRESS_URL = "https://dapi.kakao.com/v2/local/geo/coord2address.json"
KAKAO_COORD2REGIONCODE_URL = "https://dapi.kakao.com/v2/local/geo/coord2regioncode.json"
MISSING_ADDRESS_VALUES = {"", "주소 정보 없음", "주소정보없음", "unknown", "none", "null"}
NEARBY_OFFSETS = (
    (0.00045, 0.0),
    (-0.00045, 0.0),
    (0.0, 0.00055),
    (0.0, -0.00055),
    (0.0009, 0.0),
    (-0.0009, 0.0),
    (0.0, 0.0011),
    (0.0, -0.0011),
)


class KakaoApiError(RuntimeError):
    def __init__(self, reason: str, raw_response: Any | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.raw_response = raw_response


@dataclass
class DatasetStats:
    dataset: str
    path: Path
    total: int = 0
    candidates: int = 0
    success: int = 0
    failed: int = 0
    skipped: int = 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Use Kakao Local REST API to fill address fields from coordinates.",
    )
    parser.add_argument("--target", choices=["highway", "scale", "all"], required=True)
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing address fields.")
    parser.add_argument("--dry-run", action="store_true", help="Only print candidate counts.")
    parser.add_argument("--limit", type=int, default=None, help="Limit API calls for testing.")
    parser.add_argument("--delay", type=float, default=0.2, help="Delay between API calls in seconds.")
    parser.add_argument(
        "--nearby-retry",
        action="store_true",
        help="Retry coord2address around the original coordinate before region fallback.",
    )
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


def parse_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(str(value).replace(",", "").strip())
    except ValueError:
        return None


def valid_korea_coordinate(latitude: Any, longitude: Any) -> tuple[float | None, float | None]:
    lat = parse_float(latitude)
    lng = parse_float(longitude)
    if lat is None or lng is None:
        return None, None
    if not (30 <= lat <= 45 and 120 <= lng <= 135):
        return None, None
    return lat, lng


def coordinate_issue(latitude: Any, longitude: Any) -> str | None:
    lat = parse_float(latitude)
    lng = parse_float(longitude)
    if lat is None or lng is None:
        return "invalid_coordinate"
    if 120 <= lat <= 135 and 30 <= lng <= 45:
        return "suspected_lat_lng_swapped"
    if not (30 <= lat <= 45 and 120 <= lng <= 135):
        return "invalid_coordinate"
    return None


def clean_text(value: Any) -> str:
    return "" if value is None else " ".join(str(value).strip().split())


def is_missing_address(value: Any) -> bool:
    return clean_text(value).lower() in MISSING_ADDRESS_VALUES


def needs_address_fields(item: dict[str, Any], overwrite: bool) -> bool:
    if overwrite:
        return True
    return (
        is_missing_address(item.get("address"))
        or is_missing_address(item.get("road_address"))
        or not clean_text(item.get("sido"))
        or not clean_text(item.get("sigungu"))
    )


def should_enrich(item: dict[str, Any], overwrite: bool) -> bool:
    lat, lng = valid_korea_coordinate(item.get("latitude"), item.get("longitude"))
    if lat is None or lng is None:
        return False
    return needs_address_fields(item, overwrite)


def split_region(address: str) -> tuple[str, str]:
    parts = address.split()
    sido = parts[0] if parts else ""
    sigungu = parts[1] if len(parts) >= 2 else ""
    if sido == "세종특별자치시":
        return sido, ""
    if len(parts) >= 3 and parts[1].endswith("시") and parts[2].endswith(("구", "군")):
        sigungu = f"{parts[1]} {parts[2]}"
    return sido, sigungu


def nearby_coordinates(latitude: float, longitude: float) -> list[tuple[float, float]]:
    return [(latitude + lat_offset, longitude + lng_offset) for lat_offset, lng_offset in NEARBY_OFFSETS]


def item_key(dataset: str, item: dict[str, Any]) -> str:
    if dataset == "highway":
        return clean_text(item.get("office_code") or item.get("id"))
    return clean_text(item.get("management_id") or item.get("id"))


def item_name(dataset: str, item: dict[str, Any]) -> str:
    if dataset == "highway":
        return clean_text(item.get("office_name") or item.get("search_name"))
    return clean_text(item.get("business_name") or item.get("normalized_name"))


def kakao_get(api_key: str, url: str, latitude: float, longitude: float) -> dict[str, Any]:
    query = urllib.parse.urlencode({"x": longitude, "y": latitude})
    request = urllib.request.Request(
        f"{url}?{query}",
        headers={"Authorization": f"KakaoAK {api_key}"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        if exc.code in {401, 403}:
            raise KakaoApiError("api_auth_error", raw) from exc
        if exc.code == 429:
            raise KakaoApiError("api_rate_limited", raw) from exc
        raise KakaoApiError("api_network_error", f"HTTP {exc.code}: {raw}") from exc
    except urllib.error.URLError as exc:
        raise KakaoApiError("api_network_error", str(exc.reason)) from exc
    return json.loads(body)


def kakao_coord2address(api_key: str, latitude: float, longitude: float) -> dict[str, Any]:
    return kakao_get(api_key, KAKAO_COORD2ADDRESS_URL, latitude, longitude)


def kakao_coord2regioncode(api_key: str, latitude: float, longitude: float) -> dict[str, Any]:
    return kakao_get(api_key, KAKAO_COORD2REGIONCODE_URL, latitude, longitude)


def apply_address_result(
    item: dict[str, Any],
    payload: dict[str, Any],
    overwrite: bool,
    timestamp: str,
) -> tuple[bool, str]:
    documents = payload.get("documents")
    meta = payload.get("meta") if isinstance(payload, dict) else None
    total_count = meta.get("total_count") if isinstance(meta, dict) else None
    if total_count == 0 or not isinstance(documents, list) or not documents:
        return False, "no_coord2address_document"

    document = documents[0]
    address_obj = document.get("address") if isinstance(document, dict) else None
    road_obj = document.get("road_address") if isinstance(document, dict) else None
    address = clean_text(address_obj.get("address_name")) if isinstance(address_obj, dict) else ""
    road_address = clean_text(road_obj.get("address_name")) if isinstance(road_obj, dict) else ""
    if not address and not road_address:
        return False, "no_coord2address_document"

    region_source = road_address or address
    sido, sigungu = split_region(region_source) if region_source else ("", "")

    updated = False
    if address and (overwrite or is_missing_address(item.get("address"))):
        item["address"] = address
        updated = True
    if road_address and (overwrite or is_missing_address(item.get("road_address"))):
        item["road_address"] = road_address
        updated = True
    if sido and (overwrite or not clean_text(item.get("sido"))):
        item["sido"] = sido
        updated = True
    if (sigungu or sido == "세종특별자치시") and (overwrite or not clean_text(item.get("sigungu"))):
        item["sigungu"] = sigungu
        updated = True

    item["address_geocode_status"] = "success"
    item["address_geocode_source"] = "kakao_coord2address"
    item["address_geocode_note"] = "좌표 기반 주소 자동 보강"
    item["address_updated_at"] = timestamp
    return True, ""


def apply_region_result(
    item: dict[str, Any],
    payload: dict[str, Any],
    overwrite: bool,
    timestamp: str,
) -> tuple[bool, str]:
    documents = payload.get("documents")
    meta = payload.get("meta") if isinstance(payload, dict) else None
    total_count = meta.get("total_count") if isinstance(meta, dict) else None
    if total_count == 0 or not isinstance(documents, list) or not documents:
        return False, "no_regioncode_document"

    region = next(
        (doc for doc in documents if isinstance(doc, dict) and doc.get("region_type") == "H"),
        documents[0],
    )
    if not isinstance(region, dict):
        return False, "no_regioncode_document"

    sido = clean_text(region.get("region_1depth_name"))
    sigungu = clean_text(region.get("region_2depth_name"))
    region_3depth_name = clean_text(region.get("region_3depth_name"))
    if not sido and not sigungu and not region_3depth_name:
        return False, "no_regioncode_document"

    updated = False
    if sido and (overwrite or not clean_text(item.get("sido"))):
        item["sido"] = sido
        updated = True
    if sigungu and (overwrite or not clean_text(item.get("sigungu"))):
        item["sigungu"] = sigungu
        updated = True
    if region_3depth_name and (overwrite or not clean_text(item.get("region_3depth_name"))):
        item["region_3depth_name"] = region_3depth_name
        updated = True

    item["address_geocode_status"] = "partial_success_region_only"
    item["address_geocode_source"] = "kakao_coord2regioncode"
    item["address_geocode_note"] = "좌표 기반 행정구역만 보강됨"
    item["address_updated_at"] = timestamp
    return True, ""


def mark_failure(item: dict[str, Any], reason: str, source: str = "kakao_coord2address") -> None:
    item["address_geocode_status"] = "failed"
    item["address_geocode_source"] = source
    item["address_geocode_note"] = reason


def failure_record(
    dataset: str,
    item: dict[str, Any],
    reason: str,
    raw_response: Any | None = None,
) -> dict[str, Any]:
    record = {
        "dataset": dataset,
        "id": item_key(dataset, item),
        "name": item_name(dataset, item),
        "route_name": clean_text(item.get("route_name")),
        "latitude": item.get("latitude"),
        "longitude": item.get("longitude"),
        "reason": reason,
    }
    if raw_response is not None:
        record["raw_response"] = raw_response
    return record


def selected_targets(target: str) -> list[tuple[str, Path]]:
    if target == "all":
        return list(TARGETS.items())
    return [(target, TARGETS[target])]


def count_candidates(items: list[dict[str, Any]], overwrite: bool) -> tuple[int, int]:
    candidates = 0
    skipped = 0
    for item in items:
        if should_enrich(item, overwrite):
            candidates += 1
        else:
            skipped += 1
    return candidates, skipped


def apply_nearby_address_result(
    item: dict[str, Any],
    payload: dict[str, Any],
    overwrite: bool,
    timestamp: str,
) -> tuple[bool, str]:
    ok, reason = apply_address_result(item, payload, overwrite, timestamp)
    if ok:
        item["address_geocode_status"] = "success_nearby_estimated"
        item["address_geocode_note"] = "좌표 주변 주소 자동 보강"
    return ok, reason


def enrich_item(
    item: dict[str, Any],
    api_key: str,
    lat: float,
    lng: float,
    overwrite: bool,
    timestamp: str,
    nearby_retry: bool,
) -> tuple[bool, str, str, Any | None]:
    raw_response: Any | None = None
    try:
        raw_response = kakao_coord2address(api_key, lat, lng)
        ok, reason = apply_address_result(item, raw_response, overwrite, timestamp)
        if ok:
            return True, "", "kakao_coord2address", raw_response
        if reason != "no_coord2address_document":
            return False, reason, "kakao_coord2address", raw_response

        if nearby_retry:
            for nearby_lat, nearby_lng in nearby_coordinates(lat, lng):
                nearby_response = kakao_coord2address(api_key, nearby_lat, nearby_lng)
                ok, nearby_reason = apply_nearby_address_result(
                    item,
                    nearby_response,
                    overwrite,
                    timestamp,
                )
                if ok:
                    return True, "", "kakao_coord2address", nearby_response
                if nearby_reason != "no_coord2address_document":
                    raw_response = nearby_response
                    reason = nearby_reason
                    break

        region_response = kakao_coord2regioncode(api_key, lat, lng)
        ok, region_reason = apply_region_result(item, region_response, overwrite, timestamp)
        if ok:
            return True, "", "kakao_coord2regioncode", region_response
        return False, region_reason, "kakao_coord2regioncode", region_response
    except KakaoApiError as exc:
        return False, exc.reason, "kakao_api", exc.raw_response


def process_dataset(
    dataset: str,
    path: Path,
    api_key: str,
    overwrite: bool,
    dry_run: bool,
    limit: int | None,
    delay: float,
    nearby_retry: bool,
) -> tuple[DatasetStats, list[dict[str, Any]], list[dict[str, Any]]]:
    items = load_json(path)
    stats = DatasetStats(dataset=dataset, path=path, total=len(items))
    stats.candidates, stats.skipped = count_candidates(items, overwrite)

    print(f"\n대상 파일: {path}")
    print(f"전체 건수: {stats.total}")
    print(f"주소 보강 대상 건수: {stats.candidates}")
    print(f"건너뛴 건수: {stats.skipped}")

    if dry_run:
        return stats, items, []

    failures: list[dict[str, Any]] = []
    processed = 0
    timestamp = datetime.now(timezone.utc).isoformat()

    for item in items:
        if not needs_address_fields(item, overwrite):
            continue
        if limit is not None and processed >= limit:
            break

        lat, lng = valid_korea_coordinate(item.get("latitude"), item.get("longitude"))
        if lat is None or lng is None:
            reason = coordinate_issue(item.get("latitude"), item.get("longitude")) or "invalid_coordinate"
            failures.append(failure_record(dataset, item, reason))
            continue

        processed += 1
        ok, reason, source, raw_response = enrich_item(
            item=item,
            api_key=api_key,
            lat=lat,
            lng=lng,
            overwrite=overwrite,
            timestamp=timestamp,
            nearby_retry=nearby_retry,
        )
        if ok:
            stats.success += 1
        else:
            stats.failed += 1
            mark_failure(item, reason, source)
            failures.append(failure_record(dataset, item, reason, raw_response))

        if delay > 0:
            time.sleep(delay)

    return stats, items, failures


def main() -> int:
    args = parse_args()
    load_dotenv(PROJECT_ROOT / ".env")

    api_key = clean_text(os.getenv("KAKAO_REST_API_KEY"))
    if not args.dry_run and not api_key:
        print("KAKAO_REST_API_KEY 환경변수가 필요합니다.", file=sys.stderr)
        return 2

    all_failures: list[dict[str, Any]] = []
    results: list[tuple[DatasetStats, Path, list[dict[str, Any]]]] = []

    for dataset, path in selected_targets(args.target):
        stats, items, failures = process_dataset(
            dataset=dataset,
            path=path,
            api_key=api_key,
            overwrite=args.overwrite,
            dry_run=args.dry_run,
            limit=args.limit,
            delay=args.delay,
            nearby_retry=args.nearby_retry,
        )
        all_failures.extend(failures)
        results.append((stats, path, items))

    if args.dry_run:
        print("\ndry-run입니다. 파일을 저장하지 않았습니다.")
        return 0

    for stats, path, items in results:
        backup = path.with_name(path.name.replace(".json", ".backup.json"))
        shutil.copy2(path, backup)
        save_json(path, items)
        print(f"\n저장 위치: {path}")
        print(f"백업 위치: {backup}")
        print(f"성공 건수: {stats.success}")
        print(f"실패 건수: {stats.failed}")
        print(f"건너뛴 건수: {stats.skipped}")

    save_json(FAILED_OUTPUT, all_failures)
    print(f"실패 목록 저장 위치: {FAILED_OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
