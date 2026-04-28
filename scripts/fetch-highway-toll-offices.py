#!/usr/bin/env python
"""Fetch Korea Expressway toll office location data into a static JSON file."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = PROJECT_ROOT / "public" / "data" / "highway-toll-offices.json"
DEFAULT_FAILED_OUTPUT = PROJECT_ROOT / "public" / "data" / "highway-toll-offices-failed.json"
DEFAULT_API_URL = "https://data.ex.co.kr/openapi/locationinfo/locationinfoUnit"
KAKAO_ADDRESS_URL = "https://dapi.kakao.com/v2/local/search/address.json"
KAKAO_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"
NAVER_LOCAL_URL = "https://openapi.naver.com/v1/search/local.json"
SOURCE_NAME = "한국도로공사_영업소 위치정보 OpenAPI"

FIELD_CANDIDATES = {
    "office_code": ["unitCode", "icCode", "officeCode", "영업소코드", "영업소ID", "code"],
    "office_name": ["unitName", "officeName", "icName", "영업소명", "name"],
    "route_name": ["routeName", "노선명", "route"],
    "sido": ["sido", "시도", "광역시도"],
    "sigungu": ["sigungu", "시군구", "시군구명"],
    "address": ["address", "addr", "주소", "소재지주소"],
    "latitude": ["yValue", "lat", "latitude", "위도", "Y좌표", "y"],
    "longitude": ["xValue", "lng", "lon", "longitude", "경도", "X좌표", "x"],
    "operation_type": ["operationType", "opType", "운영형태", "운영구분"],
    "entrance_exit_type": ["entranceExitType", "inOutType", "출입구구분", "입출구구분"],
    "install_type": ["installType", "설치유형", "설치형태"],
    "phone": ["phone", "tel", "telephone", "전화번호", "연락처"],
}


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", recover_mojibake(str(value))).strip()


def pick(row: dict[str, Any], candidates: list[str]) -> str:
    lowered = {str(key).lower(): key for key in row.keys()}
    for candidate in candidates:
        key = lowered.get(candidate.lower())
        if key is not None:
            return clean_text(row.get(key))
    return ""


def parse_float(value: str) -> float | None:
    text = clean_text(value).replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def split_region(address: str) -> tuple[str, str]:
    parts = address.split()
    sido = parts[0] if len(parts) >= 1 else ""
    sigungu = parts[1] if len(parts) >= 2 else ""
    if len(parts) >= 3 and parts[1].endswith("시") and parts[2].endswith(("구", "군")):
        sigungu = f"{parts[1]} {parts[2]}"
    return sido, sigungu


def normalize_route_for_search(route_name: str) -> str:
    route = clean_text(route_name)
    if re.search(r"선[A-Z]$", route):
        route = route[:-1]
    return route


def normalize_office_name_for_search(office_name: str) -> str:
    office = clean_text(office_name)
    office = re.sub(r"\([^)]*\)", "", office)
    office = re.sub(r"\bT\s*/\s*G\b", "TG", office, flags=re.IGNORECASE)
    office = re.sub(r"\s+", "", office)
    office = re.sub(r"(영업소|요금소|톨게이트|TG)$", "", office, flags=re.IGNORECASE)
    office = re.sub(r"(상행선|하행선|상행|하행|상선|하선|상|하)$", "", office)
    return office


def normalize_name_for_exact_match(value: str) -> str:
    """Normalize tollgate names for strict identity checks only."""
    text = clean_text(value)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\([^)]*\)", "", text)
    text = re.sub(r"\[[^]]*\]", "", text)
    text = re.sub(r"\bT\s*/\s*G\b", "TG", text, flags=re.IGNORECASE)
    remove_tokens = (
        "상행선",
        "하행선",
        "서울방면",
        "목포방면",
        "부산방면",
        "대전방면",
        "천안방면",
        "순천방면",
        "상행",
        "하행",
        "방면",
        "톨게이트",
        "요금소",
        "하이패스",
        "진입",
        "진출",
        "입구",
        "출구",
        "T/G",
        "TG",
        "JCT",
        "JC",
        "IC",
    )
    for token in remove_tokens:
        text = re.sub(re.escape(token), "", text, flags=re.IGNORECASE)
    text = re.sub(r"[\s()/·._-]+", "", text)
    return text.lower()


def extract_direction(office_name: str) -> str:
    office = re.sub(r"\([^)]*\)", "", clean_text(office_name))
    compact = re.sub(r"\s+", "", office)
    if re.search(r"(상행선|상행|상선|상)$", compact):
        return "상행"
    if re.search(r"(하행선|하행|하선|하)$", compact):
        return "하행"
    return ""


def route_search_aliases(route_name: str) -> list[str]:
    base = normalize_route_for_search(route_name)
    aliases = [base]
    extras = {
        "제2영동선": ["광주원주고속도로", "제2영동고속도로"],
        "상주영천선": ["상주영천고속도로"],
        "평택화성선": ["평택화성고속도로", "봉담동탄고속도로"],
        "수도권제2순환선": ["수도권제2순환고속도로"],
        "세종포천선": ["세종포천고속도로", "구리포천고속도로", "안성구리고속도로"],
    }
    aliases.extend(extras.get(base, []))

    deduped: list[str] = []
    for alias in aliases:
        if alias and alias not in deduped:
            deduped.append(alias)
    return deduped


def keyword_candidates(office_name: str, route_name: str) -> list[str]:
    office = normalize_office_name_for_search(office_name)
    routes = route_search_aliases(route_name)
    office_tg = f"{office}TG"
    candidates: list[str] = [
        office_tg,
        f"{office} 톨게이트",
        f"{office} 요금소",
        f"{office}하이패스TG",
        f"{office} 하이패스 요금소",
    ]
    for route in routes:
        candidates.extend([f"{route} {office_tg}", f"{route} {office} 톨게이트"])

    deduped: list[str] = []
    for candidate in candidates:
        text = clean_text(candidate)
        if text and text not in deduped:
            deduped.append(text)
    return deduped


def compact_text(value: str) -> str:
    return re.sub(r"[\s()/·._-]+", "", clean_text(value)).lower()


def compact_place_name(value: str) -> str:
    return re.sub(r"\s+", "", clean_text(value)).lower()


def is_exact_tg_match(place_name: str, search_name: str) -> bool:
    place = compact_place_name(place_name)
    search = compact_place_name(search_name)
    return place in {f"{search}tg", f"{search}하이패스tg"}


def haversine_km(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    radius = 6371.0088
    lat1 = math.radians(a_lat)
    lat2 = math.radians(b_lat)
    d_lat = math.radians(b_lat - a_lat)
    d_lon = math.radians(b_lon - a_lon)
    value = math.sin(d_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(d_lon / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def mostly_same_place(a: dict[str, Any], b: dict[str, Any], office_name: str) -> bool:
    a_name = compact_text(clean_text(a.get("place_name")))
    b_name = compact_text(clean_text(b.get("place_name")))
    office = compact_text(normalize_office_name_for_search(office_name)).replace("tg", "")
    if not a_name or not b_name:
        return False
    return a_name == b_name or (office and office in a_name and office in b_name)


def build_url(base_url: str, params: dict[str, str]) -> str:
    return f"{base_url}?{urllib.parse.urlencode(params)}"


def fetch_bytes(url: str, timeout: int) -> tuple[bytes, str]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
            "User-Agent": "scale-map-static/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        content_type = response.headers.get("Content-Type", "")
        return response.read(), content_type


def fetch_kakao_json(url: str, kakao_key: str, params: dict[str, str], timeout: int) -> dict[str, Any]:
    request_url = build_url(url, params)
    request = urllib.request.Request(
        request_url,
        headers={
            "Authorization": f"KakaoAK {kakao_key}",
            "Accept": "application/json",
            "User-Agent": "scale-map-static/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8-sig"))


def fetch_naver_local_json(
    naver_client_id: str,
    naver_client_secret: str,
    query: str,
    timeout: int,
) -> dict[str, Any]:
    request_url = build_url(NAVER_LOCAL_URL, {"query": query, "display": "5"})
    request = urllib.request.Request(
        request_url,
        headers={
            "X-Naver-Client-Id": naver_client_id,
            "X-Naver-Client-Secret": naver_client_secret,
            "Accept": "application/json",
            "User-Agent": "scale-map-static/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8-sig"))


def parse_kakao_document(document: dict[str, Any]) -> tuple[float | None, float | None, str]:
    longitude = parse_float(clean_text(document.get("x")))
    latitude = parse_float(clean_text(document.get("y")))
    address = (
        clean_text(document.get("road_address_name"))
        or clean_text(document.get("address_name"))
        or clean_text(document.get("place_name"))
    )
    return latitude, longitude, address


def candidate_payload(document: dict[str, Any], query: str, score: int = 0, reasons: list[str] | None = None) -> dict[str, Any]:
    latitude, longitude, address = parse_kakao_document(document)
    place_name = clean_text(document.get("place_name"))
    return {
        "source": "kakao_local",
        "query": query,
        "place_name": place_name,
        "candidate_base_name": normalize_office_name_for_search(place_name),
        "exact_base_name": normalize_name_for_exact_match(place_name),
        "address_name": clean_text(document.get("address_name")),
        "road_address_name": clean_text(document.get("road_address_name")),
        "category_name": clean_text(document.get("category_name")),
        "latitude": latitude,
        "longitude": longitude,
        "score": score,
        "score_reasons": reasons or [],
    }


def strip_html(value: str) -> str:
    return re.sub(r"<[^>]+>", "", clean_text(value))


def parse_naver_coordinate(value: Any) -> float | None:
    text = clean_text(value)
    if not text:
        return None
    try:
        return int(text) / 10000000
    except ValueError:
        return parse_float(text)


def naver_candidate_payload(item: dict[str, Any], query: str) -> dict[str, Any]:
    place_name = strip_html(item.get("title", ""))
    return {
        "source": "naver_local",
        "query": query,
        "place_name": place_name,
        "candidate_base_name": normalize_office_name_for_search(place_name),
        "exact_base_name": normalize_name_for_exact_match(place_name),
        "address_name": clean_text(item.get("address")),
        "road_address_name": clean_text(item.get("roadAddress")),
        "category_name": clean_text(item.get("category")),
        "latitude": parse_naver_coordinate(item.get("mapy")),
        "longitude": parse_naver_coordinate(item.get("mapx")),
    }


def select_exact_candidate(
    candidates: list[dict[str, Any]],
    search_name: str,
) -> dict[str, Any] | None:
    search_key = normalize_name_for_exact_match(search_name)
    for candidate in candidates:
        if candidate.get("latitude") is None or candidate.get("longitude") is None:
            continue
        if clean_text(candidate.get("exact_base_name")) == search_key:
            return candidate
    return None


def build_rejected_candidates(
    kakao_candidates: list[dict[str, Any]],
    naver_candidates: list[dict[str, Any]],
    chosen: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    chosen_key = None
    if chosen:
        chosen_key = (
            chosen.get("source"),
            chosen.get("query"),
            chosen.get("place_name"),
            chosen.get("address_name"),
            chosen.get("road_address_name"),
        )

    rejected: list[dict[str, Any]] = []
    for candidate in [*kakao_candidates, *naver_candidates]:
        key = (
            candidate.get("source"),
            candidate.get("query"),
            candidate.get("place_name"),
            candidate.get("address_name"),
            candidate.get("road_address_name"),
        )
        if key != chosen_key:
            rejected.append(candidate)
    return rejected[:20]


def score_candidate(
    document: dict[str, Any],
    office_name: str,
    route_name: str,
    sido: str,
    sigungu: str,
) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []
    office = normalize_office_name_for_search(office_name)
    office_key = compact_text(office)
    route_key = compact_text(normalize_route_for_search(route_name)).replace("고속도로", "").replace("선", "")
    place = clean_text(document.get("place_name"))
    place_key = compact_text(place)
    candidate_base_name = normalize_office_name_for_search(place)
    candidate_key = compact_text(candidate_base_name)
    address = clean_text(document.get("address_name"))
    road_address = clean_text(document.get("road_address_name"))
    address_text = f"{address} {road_address}"
    address_key = compact_text(address_text)
    category = clean_text(document.get("category_name"))
    category_key = compact_text(category)
    source_text = compact_text(f"{office_name} {route_name}")

    exact_place_variants = {compact_text(f"{office}TG"), compact_text(f"{office} 톨게이트")}
    if candidate_key and candidate_key == office_key:
        score += 100
        reasons.append("candidate base exact match +100")
    if place_key in exact_place_variants:
        score += 100
        reasons.append("place exact TG/tollgate match +100")
    if any(token in place_key for token in ("tg", "톨게이트", "요금소")):
        score += 40
        reasons.append("place contains TG/tollgate +40")
    if "하이패스" in place_key and "하이패스" in source_text:
        score += 20
        reasons.append("hipass matched +20")
    if (sido and sido in address_text) or (sigungu and sigungu in address_text):
        score += 30
        reasons.append("region matched +30")
    if any(token in category_key for token in ("교통", "고속도로", "톨게이트", "요금소", "도로시설")):
        score += 20
        reasons.append("traffic category +20")
    if route_key and (route_key in place_key or route_key in address_key):
        score += 15
        reasons.append("route token matched +15")

    bad_category_tokens = (
        "병원",
        "음식점",
        "카페",
        "학원",
        "회사",
        "아파트",
        "마트",
        "편의점",
        "숙박",
        "부동산",
    )
    if any(token in category_key for token in bad_category_tokens):
        score -= 100
        reasons.append("non-tollgate category -100")
    if candidate_key != office_key and office_key and (
        office_key in candidate_key or candidate_key in office_key or office_key in place_key
    ):
        score -= 20
        reasons.append("partial office name match only -20")
    if sido and sigungu and sido not in address_text and sigungu not in address_text:
        score -= 50
        reasons.append("region clearly different -50")

    return score, reasons


def select_best_candidate(
    candidates: list[dict[str, Any]],
    office_name: str,
) -> tuple[str, dict[str, Any] | None, list[dict[str, Any]], str]:
    valid = [
        candidate
        for candidate in candidates
        if candidate["latitude"] is not None and candidate["longitude"] is not None
    ]
    valid.sort(key=lambda item: item["score"], reverse=True)
    if not valid:
        return "failed_no_candidate", None, [], "Kakao Local API 후보 결과 없음"

    normalized_office = normalize_office_name_for_search(office_name)
    exact_tg_matches = [
        candidate
        for candidate in valid
        if is_exact_tg_match(clean_text(candidate.get("place_name")), normalized_office)
    ]
    exact_tg_matches.sort(key=lambda item: item["score"], reverse=True)
    if exact_tg_matches:
        best_exact_tg = exact_tg_matches[0]
        # Exact {search_name}TG or {search_name}하이패스TG wins immediately.
        # Similar prefixed names such as 북중량TG remain in candidates but are not selected.
        return "success", best_exact_tg, exact_tg_matches, ""

    exact_matches = [
        candidate
        for candidate in valid
        if candidate.get("candidate_base_name") == normalized_office
    ]
    exact_matches.sort(key=lambda item: item["score"], reverse=True)
    if len(exact_matches) == 1:
        return "success", exact_matches[0], exact_matches, ""
    if len(exact_matches) >= 2:
        best_exact = exact_matches[0]
        close_exact = [best_exact]
        far_exact = []
        for candidate in exact_matches[1:]:
            distance = haversine_km(
                best_exact["latitude"],
                best_exact["longitude"],
                candidate["latitude"],
                candidate["longitude"],
            )
            if distance <= 1:
                close_exact.append(candidate)
            else:
                far_exact.append(candidate)
        if far_exact:
            return (
                "ambiguous_multiple_candidates",
                best_exact,
                exact_matches[:8],
                "multiple_exact_matches_far_apart",
            )
        # Exact direction/facility duplicates within 1km are treated as the same tollgate.
        # We keep every close exact candidate in direction_candidates and use the highest-score
        # candidate as the representative coordinate for map display.
        return "success", best_exact, close_exact, ""

    best = valid[0]
    second = valid[1] if len(valid) > 1 else None
    direction_candidates = [best]

    # Direction-specific tollgate results often appear as separate entries.
    # If high-scoring candidates with nearly the same name are within 1km,
    # keep them for audit but use the highest-scoring candidate as the representative coordinate.
    for candidate in valid[1:]:
        if candidate["score"] < max(40, best["score"] - 30):
            continue
        if mostly_same_place(best, candidate, office_name):
            distance = haversine_km(
                best["latitude"],
                best["longitude"],
                candidate["latitude"],
                candidate["longitude"],
            )
            if distance <= 1:
                direction_candidates.append(candidate)
            elif distance > 1 and candidate["score"] >= 80:
                return ("ambiguous_multiple_candidates", best, valid[:8], "multiple_exact_matches_far_apart")

    if len(direction_candidates) >= 2:
        return "success", best, direction_candidates, ""
    if best["score"] >= 80:
        return "success", best, direction_candidates, ""
    if second and best["score"] - second["score"] >= 20:
        return "success", best, direction_candidates, ""
    if len(valid) == 1 and best["score"] >= 50:
        return "success", best, direction_candidates, ""
    if best["score"] < 80:
        if any(
            normalized_office in clean_text(candidate.get("candidate_base_name", ""))
            or clean_text(candidate.get("candidate_base_name", "")) in normalized_office
            for candidate in valid
        ):
            return "failed_low_score", best, valid[:8], "only_partial_name_matches"
        return "failed_low_score", best, valid[:8], "low_score"
    return "ambiguous_multiple_candidates", best, valid[:8], "exact_match_not_selected"


def geocode_address(address: str, kakao_key: str, timeout: int) -> dict[str, Any] | None:
    if not address:
        return None
    data = fetch_kakao_json(KAKAO_ADDRESS_URL, kakao_key, {"query": address}, timeout)
    documents = data.get("documents") or []
    if not documents:
        return None
    latitude, longitude, matched_address = parse_kakao_document(documents[0])
    if latitude is None or longitude is None:
        return None
    return {
        "latitude": latitude,
        "longitude": longitude,
        "address": matched_address,
        "query": address,
        "score": 100,
        "candidate": candidate_payload(documents[0], address, 100, ["address geocode"]),
    }


def geocode_kakao_keyword(
    office_name: str,
    route_name: str,
    kakao_key: str,
    timeout: int,
) -> dict[str, Any]:
    tried_queries: list[str] = []
    candidates: list[dict[str, Any]] = []
    seen_candidates: set[tuple[str, str, str]] = set()
    for keyword in keyword_candidates(office_name, route_name)[:8]:
        tried_queries.append(keyword)
        data = fetch_kakao_json(
            KAKAO_KEYWORD_URL,
            kakao_key,
            {"query": keyword, "size": "5"},
            timeout,
        )
        documents = data.get("documents") or []
        for document in documents:
            latitude, longitude, _ = parse_kakao_document(document)
            if latitude is None or longitude is None:
                continue
            key = (
                clean_text(document.get("place_name")),
                clean_text(document.get("address_name")),
                clean_text(document.get("road_address_name")),
            )
            if key in seen_candidates:
                continue
            seen_candidates.add(key)
            candidates.append(candidate_payload(document, keyword))

    best = select_exact_candidate(candidates, normalize_office_name_for_search(office_name))
    return {
        "status": "success" if best else ("failed_no_exact_match" if candidates else "failed_no_candidate"),
        "best": best,
        "tried_queries": tried_queries,
        "candidates": candidates[:20],
        "fail_reason": "" if best else ("no_exact_kakao_match" if candidates else "no_kakao_candidate"),
    }


def geocode_naver_keyword(
    office_name: str,
    route_name: str,
    naver_client_id: str,
    naver_client_secret: str,
    timeout: int,
) -> dict[str, Any]:
    tried_queries: list[str] = []
    candidates: list[dict[str, Any]] = []
    seen_candidates: set[tuple[str, str, str]] = set()
    for keyword in keyword_candidates(office_name, route_name)[:8]:
        tried_queries.append(keyword)
        data = fetch_naver_local_json(naver_client_id, naver_client_secret, keyword, timeout)
        for item in data.get("items") or []:
            candidate = naver_candidate_payload(item, keyword)
            if candidate["latitude"] is None or candidate["longitude"] is None:
                continue
            key = (
                candidate["place_name"],
                candidate["address_name"],
                candidate["road_address_name"],
            )
            if key in seen_candidates:
                continue
            seen_candidates.add(key)
            candidates.append(candidate)

    best = select_exact_candidate(candidates, normalize_office_name_for_search(office_name))
    return {
        "status": "success" if best else ("failed_no_exact_match" if candidates else "failed_no_candidate"),
        "best": best,
        "tried_queries": tried_queries,
        "candidates": candidates[:20],
        "fail_reason": "" if best else ("no_exact_naver_match" if candidates else "no_naver_candidate"),
    }


def parse_json_payload(data: Any) -> tuple[list[dict[str, Any]], int | None]:
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)], len(data)
    if not isinstance(data, dict):
        return [], None

    code = clean_text(data.get("code"))
    message = clean_text(data.get("message"))
    if code.upper() == "ERROR":
        raise RuntimeError(f"API 오류 응답: {recover_mojibake(message) or code}")

    items = data.get("list") or data.get("items") or data.get("item") or data.get("data")
    if isinstance(items, dict):
        nested = items.get("item") or items.get("list")
        items = nested if nested is not None else [items]
    if isinstance(items, list):
        rows = [item for item in items if isinstance(item, dict)]
    else:
        rows = []

    total = data.get("count") or data.get("totalCount") or data.get("total_count")
    try:
        total_count = int(total) if total is not None else None
    except (TypeError, ValueError):
        total_count = None
    return rows, total_count


def recover_mojibake(value: str) -> str:
    if not value:
        return ""
    try:
        return value.encode("latin1").decode("cp949")
    except UnicodeError:
        return value


def xml_element_to_dict(element: ET.Element) -> dict[str, str]:
    return {child.tag.split("}")[-1]: clean_text(child.text) for child in list(element)}


def parse_xml_payload(payload: bytes) -> tuple[list[dict[str, Any]], int | None]:
    root = ET.fromstring(payload)
    rows: list[dict[str, Any]] = []

    for element in root.iter():
        children = list(element)
        if not children:
            continue
        row = xml_element_to_dict(element)
        if any(name in row for name in ("unitName", "routeName", "xValue", "yValue")):
            rows.append(row)

    total_count = None
    for element in root.iter():
        tag = element.tag.split("}")[-1]
        if tag in {"count", "totalCount", "total_count"}:
            try:
                total_count = int(clean_text(element.text))
            except ValueError:
                total_count = None
            break

    deduped: list[dict[str, Any]] = []
    seen: set[tuple[tuple[str, str], ...]] = set()
    for row in rows:
        key = tuple(sorted((str(k), str(v)) for k, v in row.items()))
        if key not in seen:
            seen.add(key)
            deduped.append(row)
    return deduped, total_count


def parse_payload(payload: bytes, content_type: str) -> tuple[list[dict[str, Any]], int | None]:
    text = payload.decode("utf-8-sig", errors="replace").strip()
    if "json" in content_type.lower() or text.startswith(("{", "[")):
        return parse_json_payload(json.loads(text))
    return parse_xml_payload(payload)


def normalize_row(
    row: dict[str, Any],
    index: int,
    kakao_key: str,
    naver_client_id: str,
    naver_client_secret: str,
    timeout: int,
) -> dict[str, Any]:
    raw_address = pick(row, FIELD_CANDIDATES["address"])
    raw_sido = pick(row, FIELD_CANDIDATES["sido"])
    raw_sigungu = pick(row, FIELD_CANDIDATES["sigungu"])
    derived_sido, derived_sigungu = split_region(raw_address)

    latitude = parse_float(pick(row, FIELD_CANDIDATES["latitude"]))
    longitude = parse_float(pick(row, FIELD_CANDIDATES["longitude"]))
    has_coordinates = latitude is not None and longitude is not None

    office_code = pick(row, FIELD_CANDIDATES["office_code"])
    office_name = pick(row, FIELD_CANDIDATES["office_name"])
    search_name = normalize_office_name_for_search(office_name)
    direction = extract_direction(office_name)
    route_name = pick(row, FIELD_CANDIDATES["route_name"])
    geocode_status = "success_from_api_coordinate" if has_coordinates else ""
    geocode_source = "ex_api_coordinate" if has_coordinates else "manual_required"
    geocode_query = ""
    tried_queries: list[str] = []
    kakao_candidates: list[dict[str, Any]] = []
    naver_candidates: list[dict[str, Any]] = []
    rejected_candidates: list[dict[str, Any]] = []
    chosen_candidate: dict[str, Any] | None = None
    top_candidate_but_rejected: dict[str, Any] | None = None
    fail_reason = ""

    if not has_coordinates and kakao_key:
        kakao_result = geocode_kakao_keyword(office_name, route_name, kakao_key, timeout)
        tried_queries.extend(kakao_result["tried_queries"])
        kakao_candidates = kakao_result["candidates"]
        if kakao_result["best"]:
            best = kakao_result["best"]
            latitude = best["latitude"]
            longitude = best["longitude"]
            raw_address = raw_address or best["road_address_name"] or best["address_name"]
            derived_sido, derived_sigungu = split_region(raw_address)
            has_coordinates = True
            geocode_status = "success_from_kakao_local"
            geocode_source = "kakao_local"
            geocode_query = best["query"]
            chosen_candidate = best
        else:
            fail_reason = kakao_result["fail_reason"]

    if not has_coordinates and naver_client_id and naver_client_secret:
        naver_result = geocode_naver_keyword(
            office_name,
            route_name,
            naver_client_id,
            naver_client_secret,
            timeout,
        )
        for query in naver_result["tried_queries"]:
            if query not in tried_queries:
                tried_queries.append(query)
        naver_candidates = naver_result["candidates"]
        if naver_result["best"]:
            best = naver_result["best"]
            latitude = best["latitude"]
            longitude = best["longitude"]
            raw_address = raw_address or best["road_address_name"] or best["address_name"]
            derived_sido, derived_sigungu = split_region(raw_address)
            has_coordinates = True
            geocode_status = "success_from_naver_local"
            geocode_source = "naver_local"
            geocode_query = best["query"]
            chosen_candidate = best
        else:
            fail_reason = naver_result["fail_reason"] if fail_reason != "no_kakao_candidate" else naver_result["fail_reason"]

    rejected_candidates = build_rejected_candidates(kakao_candidates, naver_candidates, chosen_candidate)
    if not has_coordinates and rejected_candidates:
        top_candidate_but_rejected = rejected_candidates[0]

    if not has_coordinates:
        if not kakao_candidates and not naver_candidates:
            geocode_status = "failed_no_candidate"
            fail_reason = fail_reason or "no_candidate"
        elif not geocode_status:
            geocode_status = "failed_no_exact_match"
            fail_reason = fail_reason or "no_exact_match"

    return {
        "id": office_code or str(index),
        "office_code": office_code,
        "office_name": office_name,
        "search_name": search_name,
        "normalized_office_name": search_name,
        "direction": direction,
        "route_name": route_name,
        "sido": raw_sido or derived_sido,
        "sigungu": raw_sigungu or derived_sigungu,
        "address": raw_address,
        "road_address": chosen_candidate.get("road_address_name", "") if chosen_candidate else "",
        "latitude": latitude,
        "longitude": longitude,
        "operation_type": pick(row, FIELD_CANDIDATES["operation_type"]),
        "entrance_exit_type": pick(row, FIELD_CANDIDATES["entrance_exit_type"]),
        "install_type": pick(row, FIELD_CANDIDATES["install_type"]),
        "phone": pick(row, FIELD_CANDIDATES["phone"]),
        "source": SOURCE_NAME,
        "geocode_status": geocode_status,
        "geocode_source": geocode_source,
        "geocode_query": geocode_query,
        "chosen_candidate": chosen_candidate,
        "tried_queries": tried_queries,
        "kakao_candidates": kakao_candidates,
        "naver_candidates": naver_candidates,
        "rejected_candidates": rejected_candidates,
        "top_candidate_but_rejected": top_candidate_but_rejected,
        "coordinate_note": "" if has_coordinates else "좌표 미제공/확인 필요",
        "raw_item": row,
        "fail_reason": fail_reason,
    }


def fetch_all(api_key: str, api_url: str, response_type: str, timeout: int, sleep: float) -> list[dict[str, Any]]:
    base_params = {"key": api_key, "type": response_type}
    all_rows: list[dict[str, Any]] = []
    seen_rows: set[str] = set()
    total_count: int | None = None

    # The EX location API normally returns the full list without pagination.
    # The loop also supports public-data style pagination if the gateway adds it.
    for page in range(1, 1001):
        params = dict(base_params)
        if page > 1 or total_count is not None:
            params.update({"pageNo": str(page), "numOfRows": "1000"})

        url = build_url(api_url, params)
        payload, content_type = fetch_bytes(url, timeout)
        rows, reported_total = parse_payload(payload, content_type)
        if reported_total is not None:
            total_count = reported_total

        new_count = 0
        for row in rows:
            key = json.dumps(row, ensure_ascii=False, sort_keys=True)
            if key in seen_rows:
                continue
            seen_rows.add(key)
            all_rows.append(row)
            new_count += 1

        print(f"page={page}, rows={len(rows)}, new={new_count}, total={len(all_rows)}")

        if not rows or new_count == 0:
            break
        if total_count is None:
            break
        if len(all_rows) >= total_count:
            break
        time.sleep(sleep)

    return all_rows


def failed_record(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "office_name": item["office_name"],
        "search_name": item["search_name"],
        "route_name": item["route_name"],
        "tried_queries": item["tried_queries"],
        "kakao_candidates": item["kakao_candidates"],
        "naver_candidates": item["naver_candidates"],
        "rejected_candidates": item["rejected_candidates"],
        "top_candidate_but_rejected": item["top_candidate_but_rejected"],
        "fail_reason": item["fail_reason"],
    }


def write_json(
    rows: list[dict[str, Any]],
    output_path: Path,
    failed_output_path: Path,
    kakao_key: str,
    naver_client_id: str,
    naver_client_secret: str,
    timeout: int,
    geocode_workers: int,
) -> None:
    indexed_rows = list(enumerate(rows, start=1))
    normalized: list[dict[str, Any] | None] = [None] * len(indexed_rows)

    if kakao_key or (naver_client_id and naver_client_secret):
        with ThreadPoolExecutor(max_workers=max(1, geocode_workers)) as executor:
            futures = {
                executor.submit(
                    normalize_row,
                    row,
                    index,
                    kakao_key,
                    naver_client_id,
                    naver_client_secret,
                    timeout,
                ): index
                for index, row in indexed_rows
            }
            completed = 0
            for future in as_completed(futures):
                index = futures[future]
                item = future.result()
                normalized[index - 1] = item
                completed += 1
                if item["geocode_status"] != "success_from_api_coordinate":
                    print(
                        f"geocode {completed}/{len(rows)} "
                        f"{item['office_name']} -> {item['geocode_status']}",
                        flush=True,
                    )
    else:
        for index, row in indexed_rows:
            normalized[index - 1] = normalize_row(row, index, kakao_key, naver_client_id, naver_client_secret, timeout)

    normalized_items = [item for item in normalized if item is not None]
    failed = [
        failed_record(item)
        for item in normalized_items
        if not (item["latitude"] is not None and item["longitude"] is not None)
    ]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(normalized_items, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    failed_output_path.parent.mkdir(parents=True, exist_ok=True)
    failed_output_path.write_text(
        json.dumps(failed, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    mappable = len(normalized_items) - len(failed)
    print(f"saved={output_path}")
    print(f"saved_failed={failed_output_path}")
    print(f"records={len(normalized_items)}, mappable={mappable}, geocode_failed={len(failed)}")


def main() -> int:
    env_path = PROJECT_ROOT / ".env"
    load_dotenv(dotenv_path=env_path, override=False)

    parser = argparse.ArgumentParser(description="한국도로공사 영업소 위치정보 OpenAPI를 JSON으로 저장합니다.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="저장할 JSON 경로")
    parser.add_argument("--failed-output", type=Path, default=DEFAULT_FAILED_OUTPUT, help="좌표 미확인 JSON 경로")
    parser.add_argument("--api-url", default=DEFAULT_API_URL, help="OpenAPI 요청 URL")
    parser.add_argument("--type", default="json", choices=["json", "xml"], help="API 응답 포맷")
    parser.add_argument("--timeout", type=int, default=30, help="요청 타임아웃 초")
    parser.add_argument("--sleep", type=float, default=0.2, help="페이지 요청 사이 대기 초")
    parser.add_argument("--geocode-workers", type=int, default=8, help="Kakao geocoding 병렬 요청 수")
    args = parser.parse_args()

    api_key = os.getenv("HIGHWAY_API_KEY", "").strip()
    if not api_key or api_key == "your_highway_public_data_api_key_here":
        print("오류: HIGHWAY_API_KEY 환경변수를 설정해 주세요.", file=sys.stderr)
        return 1
    print(f"HIGHWAY_API_KEY loaded from {env_path} (length={len(api_key)})")
    kakao_key = os.getenv("KAKAO_REST_API_KEY", "").strip()
    if kakao_key and kakao_key != "your_kakao_rest_api_key_here":
        print(f"KAKAO_REST_API_KEY loaded from {env_path} (length={len(kakao_key)})")
    else:
        kakao_key = ""
        print("KAKAO_REST_API_KEY is not set; missing coordinates will remain unresolved.")
    naver_client_id = os.getenv("NAVER_CLIENT_ID", "").strip()
    naver_client_secret = os.getenv("NAVER_CLIENT_SECRET", "").strip()
    if (
        naver_client_id
        and naver_client_secret
        and naver_client_id != "your_naver_client_id_here"
        and naver_client_secret != "your_naver_client_secret_here"
    ):
        print(f"NAVER_CLIENT_ID loaded from {env_path} (length={len(naver_client_id)})")
        print(f"NAVER_CLIENT_SECRET loaded from {env_path} (length={len(naver_client_secret)})")
    else:
        naver_client_id = ""
        naver_client_secret = ""
        print("NAVER_CLIENT_ID/NAVER_CLIENT_SECRET are not set; Naver fallback will be skipped.")

    output_path = args.output
    if not output_path.is_absolute():
        output_path = PROJECT_ROOT / output_path
    failed_output_path = args.failed_output
    if not failed_output_path.is_absolute():
        failed_output_path = PROJECT_ROOT / failed_output_path

    try:
        rows = fetch_all(api_key, args.api_url, args.type, args.timeout, args.sleep)
        write_json(
            rows,
            output_path,
            failed_output_path,
            kakao_key,
            naver_client_id,
            naver_client_secret,
            args.timeout,
            args.geocode_workers,
        )
    except Exception as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
