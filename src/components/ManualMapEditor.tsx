import {
  ArrowLeft,
  Clipboard,
  Download,
  MapPin,
  RotateCcw,
  Save,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  HighwayFailedOffice,
  HighwayTollOffice,
  KakaoInfoWindow,
  KakaoMap,
  KakaoMarker,
  MapOffice,
  ScaleOffice,
} from "../types";
import { loadKakaoMapScript } from "../utils/kakaoMap";

type DatasetType = "scale" | "highway";
type EditableItem = ScaleOffice | HighwayTollOffice;
type EditableRecord = Record<string, string | number | null | string[] | boolean | undefined>;
type ChangeKind = "add" | "update" | "resolve";
type FieldErrors = Record<string, string>;

interface EditorConfig {
  datasetType: DatasetType;
  title: string;
  mapHref: string;
  dataUrl: string;
  failedDataUrl?: string;
  downloadFileName: string;
  failedDownloadFileName?: string;
  localStorageKey: string;
}

interface ManualEdit {
  id: string;
  kind: ChangeKind;
  itemId?: string;
  failedKey?: string;
  before?: EditableItem;
  after?: EditableItem;
  failedBefore?: HighwayFailedOffice;
  failedAfter?: HighwayFailedOffice;
  createdAt: string;
}

interface FormField {
  name: string;
  label: string;
  type?: "number" | "textarea";
  className?: string;
  required?: boolean;
  recommended?: boolean;
  readOnly?: boolean;
  options?: Array<{ value: string; label: string }>;
  helpText?: string;
}

interface ContextMenuState {
  latitude: number;
  longitude: number;
  x: number;
  y: number;
}

const SCALE_STATUS_OPTIONS = ["영업/정상", "폐업", "휴업", "취소/말소", "정보 없음"];
const SCALE_DETAIL_STATUS_OPTIONS = [
  "영업/정상",
  "폐업",
  "휴업",
  "제외/삭제/전출",
  "취소/말소",
  "정보 없음",
];
const SCALE_GEOCODE_STATUS_OPTIONS = [
  "success_from_csv_coordinate",
  "success_from_kakao_address",
  "success_from_kakao_keyword",
  "manual_added",
  "manual_corrected",
  "failed",
  "information_missing",
];
const SCALE_GEOCODE_SOURCE_OPTIONS = [
  "csv_coordinate",
  "kakao_address",
  "kakao_keyword",
  "manual_map_click",
  "manual_map_right_click",
  "unknown",
];
const SCALE_SOURCE_OPTIONS = ["local_csv", "manual", "unknown"];

const HIGHWAY_DIRECTION_OPTIONS = [
  { value: "", label: "없음" },
  ..."상행 하행 서울방면 부산방면 목포방면 대전방면 천안방면 순천방면 진입 진출 입구 출구"
    .split(" ")
    .map((value) => ({ value, label: value })),
];
const HIGHWAY_GEOCODE_STATUS_OPTIONS = [
  "success_from_api_coordinate",
  "success_from_kakao_local",
  "success_from_naver_local",
  "manual_added",
  "manual_corrected",
  "failed_no_exact_match",
  "failed_no_candidate",
  "information_missing",
];
const HIGHWAY_GEOCODE_SOURCE_OPTIONS = [
  "ex_api_coordinate",
  "kakao_local",
  "naver_local",
  "manual_map_click",
  "manual_map_right_click",
  "manual_required",
  "unknown",
];
const HIGHWAY_SOURCE_OPTIONS = ["한국도로공사_영업소 위치정보 OpenAPI", "manual", "unknown"];

function toOptions(values: string[]) {
  return values.map((value) => ({ value, label: value }));
}

const SCALE_FIELDS: FormField[] = [
  { name: "id", label: "id", readOnly: true, helpText: "비어 있으면 자동 생성" },
  { name: "management_id", label: "management_id" },
  { name: "business_name", label: "business_name", required: true },
  { name: "normalized_name", label: "normalized_name", readOnly: true },
  { name: "status", label: "status", recommended: true, options: toOptions(SCALE_STATUS_OPTIONS) },
  {
    name: "detail_status",
    label: "detail_status",
    recommended: true,
    options: toOptions(SCALE_DETAIL_STATUS_OPTIONS),
  },
  { name: "phone", label: "phone", recommended: true },
  { name: "office_phone", label: "office_phone" },
  { name: "sido", label: "sido", className: "half", recommended: true },
  { name: "sigungu", label: "sigungu", className: "half", recommended: true },
  { name: "address", label: "address", type: "textarea", className: "full", required: true },
  { name: "road_address", label: "road_address", type: "textarea", className: "full", required: true },
  { name: "latitude", label: "latitude", type: "number", className: "half", required: true },
  { name: "longitude", label: "longitude", type: "number", className: "half", required: true },
  { name: "coordinate_note", label: "coordinate_note", type: "textarea", className: "full" },
  { name: "manual_note", label: "manual_note", type: "textarea", className: "full" },
  {
    name: "geocode_status",
    label: "geocode_status",
    className: "half",
    options: toOptions(SCALE_GEOCODE_STATUS_OPTIONS),
  },
  {
    name: "geocode_source",
    label: "geocode_source",
    className: "half",
    options: toOptions(SCALE_GEOCODE_SOURCE_OPTIONS),
  },
  { name: "source", label: "source", options: toOptions(SCALE_SOURCE_OPTIONS) },
];

const HIGHWAY_FIELDS: FormField[] = [
  { name: "id", label: "id", readOnly: true, helpText: "비어 있으면 자동 생성" },
  { name: "office_code", label: "office_code", recommended: true },
  { name: "office_name", label: "office_name", required: true },
  { name: "normalized_office_name", label: "normalized_office_name", recommended: true, readOnly: true },
  { name: "route_name", label: "route_name", required: true },
  { name: "direction", label: "direction", recommended: true, options: HIGHWAY_DIRECTION_OPTIONS },
  { name: "sido", label: "sido", className: "half", recommended: true },
  { name: "sigungu", label: "sigungu", className: "half", recommended: true },
  { name: "address", label: "address", type: "textarea", className: "full", recommended: true },
  { name: "road_address", label: "road_address", type: "textarea", className: "full", recommended: true },
  { name: "latitude", label: "latitude", type: "number", className: "half", required: true },
  { name: "longitude", label: "longitude", type: "number", className: "half", required: true },
  {
    name: "geocode_status",
    label: "geocode_status",
    className: "half",
    options: toOptions(HIGHWAY_GEOCODE_STATUS_OPTIONS),
  },
  {
    name: "geocode_source",
    label: "geocode_source",
    className: "half",
    options: toOptions(HIGHWAY_GEOCODE_SOURCE_OPTIONS),
  },
  { name: "geocode_query", label: "geocode_query" },
  { name: "coordinate_note", label: "coordinate_note", type: "textarea", className: "full" },
  { name: "manual_note", label: "manual_note", type: "textarea", className: "full" },
  { name: "source", label: "source", options: toOptions(HIGHWAY_SOURCE_OPTIONS) },
];

const DEFAULT_CENTER = { latitude: 36.5, longitude: 127.8 };

function emptyForm(datasetType: DatasetType): EditableRecord {
  const fields = datasetType === "scale" ? SCALE_FIELDS : HIGHWAY_FIELDS;
  return Object.fromEntries(fields.map((field) => [field.name, ""]));
}

function asText(value: unknown) {
  if (Array.isArray(value)) {
    return value.join("\n");
  }
  return value == null ? "" : String(value);
}

function toNumber(value: unknown) {
  if (value === "" || value == null) {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeHighwayOfficeName(value: string) {
  return value
    .replace(/\bTG\b/gi, "")
    .replace(/톨게이트|요금소|상행|하행|상|하/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function validateCoordinate(value: unknown, fieldName: "latitude" | "longitude") {
  const label = fieldName === "latitude" ? "위도" : "경도";
  const min = fieldName === "latitude" ? -90 : -180;
  const max = fieldName === "latitude" ? 90 : 180;
  const numberValue = toNumber(value);
  if (asText(value).trim() === "") {
    return `${label}는 필수입니다.`;
  }
  if (numberValue == null) {
    return `${label} 값이 올바르지 않습니다.`;
  }
  if (numberValue < min || numberValue > max) {
    return `${label}는 ${min}~${max} 범위여야 합니다.`;
  }
  return "";
}

function isValidItemForDownload(datasetType: DatasetType, item: EditableItem) {
  const latitudeError = validateCoordinate(item.latitude, "latitude");
  const longitudeError = validateCoordinate(item.longitude, "longitude");
  if (latitudeError || longitudeError) {
    return false;
  }
  if (datasetType === "scale" && "business_name" in item) {
    const scale = item as ScaleOffice;
    return Boolean(
      scale.business_name.trim() && (scale.address.trim() || scale.road_address.trim()),
    );
  }
  if (datasetType === "highway" && "office_name" in item) {
    const highway = item as HighwayTollOffice;
    return Boolean(highway.office_name.trim() && highway.route_name.trim());
  }
  return false;
}

function createManualId(datasetType: DatasetType, form: EditableRecord) {
  if (datasetType === "scale") {
    return `manual-scale-${slugify(`${asText(form.business_name)}-${asText(form.address)}`) || Date.now()}`;
  }

  const base =
    asText(form.office_code) ||
    `${asText(form.office_name)}-${asText(form.route_name)}-${asText(form.direction)}`;
  return `manual-highway-${slugify(base) || Date.now()}`;
}

function getItemId(item: EditableItem, index: number) {
  if ("business_name" in item) {
    return item.id || `scale-${index}`;
  }
  return item.id || item.office_code || `highway-${index}`;
}

function getItemName(item: EditableItem) {
  return "office_name" in item
    ? asText((item as HighwayTollOffice).office_name)
    : asText((item as ScaleOffice).business_name);
}

function getItemStatus(item: EditableItem) {
  if ("office_name" in item) {
    return asText((item as HighwayTollOffice).geocode_status);
  }
  const scale = item as ScaleOffice;
  return scale.geocode_status || scale.status || "";
}

function getItemPhone(item: EditableItem) {
  if ("office_name" in item) {
    return asText((item as HighwayTollOffice).phone);
  }
  const scale = item as ScaleOffice;
  return scale.phone || scale.office_phone || "";
}

function getFailedKey(item: HighwayFailedOffice, index: number) {
  return (
    item.id ||
    item.office_code ||
    [item.office_name, item.route_name, item.direction, item.fail_reason].filter(Boolean).join("|") ||
    `failed-${index}`
  );
}

function normalizeMapOffice(item: EditableItem, index: number): MapOffice | null {
  const latitude = toNumber(item.latitude);
  const longitude = toNumber(item.longitude);
  if (latitude == null || longitude == null) {
    return null;
  }

  return {
    id: getItemId(item, index),
    business_name: getItemName(item) || "이름 없음",
    status: getItemStatus(item) || "좌표확인",
    phone: getItemPhone(item),
    address: asText(item.address),
    road_address: asText(item.road_address),
    latitude,
    longitude,
    sido: item.sido || "",
    sigungu: item.sigungu || "",
    search_text:
      "office_name" in item
          ? [item.office_code, item.route_name, item.direction].filter(Boolean).join(" ")
          : [
              (item as ScaleOffice).management_id,
              (item as ScaleOffice).normalized_name,
            ].filter(Boolean).join(" "),
  };
}

function applyEdits(items: EditableItem[], edits: ManualEdit[]) {
  let next = [...items];
  edits.forEach((edit) => {
    if (edit.kind === "add" && edit.after) {
      next = [...next, edit.after];
      return;
    }
    if (edit.kind === "update" && edit.itemId && edit.after) {
      next = next.map((item, index) => (getItemId(item, index) === edit.itemId ? edit.after! : item));
    }
  });
  return next;
}

function applyFailedEdits(items: HighwayFailedOffice[], edits: ManualEdit[]) {
  return items.map((item, index) => {
    const key = getFailedKey(item, index);
    const resolutions = edits.filter(
      (edit) => edit.kind === "resolve" && edit.failedKey === key && edit.failedAfter,
    );
    const resolution = resolutions[resolutions.length - 1];
    return resolution?.failedAfter || item;
  });
}

function downloadJson(fileName: string, data: unknown) {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function markerSvg(color: string) {
  return encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42">
      <path fill="${color}" d="M17 0C7.6 0 0 7.5 0 16.7c0 12.5 17 25.3 17 25.3s17-12.8 17-25.3C34 7.5 26.4 0 17 0Z"/>
      <circle cx="17" cy="16.5" r="6.2" fill="white"/>
    </svg>
  `);
}

export default function ManualMapEditor({
  datasetType,
  title,
  mapHref,
  dataUrl,
  failedDataUrl,
  downloadFileName,
  failedDownloadFileName,
  localStorageKey,
}: EditorConfig) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const markersRef = useRef<KakaoMarker[]>([]);
  const markerByIdRef = useRef<Map<string, KakaoMarker>>(new Map());
  const tempMarkerRef = useRef<KakaoMarker | null>(null);
  const infoWindowRef = useRef<KakaoInfoWindow | null>(null);
  const editModeRef = useRef(false);
  const contextPointerRef = useRef<{ x: number; y: number } | null>(null);
  const fieldRefs = useRef<Map<string, HTMLElement>>(new Map());

  const fields = datasetType === "scale" ? SCALE_FIELDS : HIGHWAY_FIELDS;
  const kakaoKey = import.meta.env.VITE_KAKAO_JAVASCRIPT_KEY as string | undefined;

  const [baseItems, setBaseItems] = useState<EditableItem[]>([]);
  const [failedItems, setFailedItems] = useState<HighwayFailedOffice[]>([]);
  const [edits, setEdits] = useState<ManualEdit[]>([]);
  const [form, setForm] = useState<EditableRecord>(() => emptyForm(datasetType));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFailedKey, setSelectedFailedKey] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [message, setMessage] = useState("");
  const [copyState, setCopyState] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [formErrors, setFormErrors] = useState<FieldErrors>({});

  useEffect(() => {
    editModeRef.current = editMode;
    if (!editMode) {
      setContextMenu(null);
    }
  }, [editMode]);

  const mergedItems = useMemo(() => applyEdits(baseItems, edits), [baseItems, edits]);
  const mergedFailedItems = useMemo(
    () => applyFailedEdits(failedItems, edits),
    [edits, failedItems],
  );
  const mapOffices = useMemo(
    () =>
      mergedItems
        .map((item, index) => normalizeMapOffice(item, index))
        .filter((item): item is MapOffice => Boolean(item)),
    [mergedItems],
  );

  const filteredOffices = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return mapOffices;
    }
    return mapOffices.filter((office) =>
      [
        office.business_name,
        office.status,
        office.address,
        office.road_address,
        office.sido,
        office.sigungu,
        office.search_text,
      ]
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    );
  }, [mapOffices, query]);

  const unresolvedFailedItems = useMemo(
    () => mergedFailedItems.filter((item) => !item.resolved),
    [mergedFailedItems],
  );

  const setFormFromItem = useCallback(
    (item: EditableItem) => {
      const next = emptyForm(datasetType);
      fields.forEach((field) => {
        next[field.name] = asText((item as EditableRecord)[field.name]);
      });
      setForm(next);
      setFormErrors({});
    },
    [datasetType, fields],
  );

  const updateFormField = useCallback(
    (fieldName: string, value: string) => {
      setForm((current) => {
        const next = { ...current, [fieldName]: value };
        if (datasetType === "scale" && fieldName === "business_name" && !asText(current.normalized_name)) {
          next.normalized_name = value;
        }
        if (
          datasetType === "highway" &&
          fieldName === "office_name" &&
          !asText(current.normalized_office_name)
        ) {
          next.normalized_office_name = normalizeHighwayOfficeName(value);
        }
        return next;
      });
      setFormErrors((current) => {
        if (!current[fieldName]) {
          if (fieldName !== "address" && fieldName !== "road_address") {
            return current;
          }
        }
        if (fieldName === "address" || fieldName === "road_address") {
          const { address: _address, road_address: _roadAddress, ...rest } = current;
          return rest;
        }
        const { [fieldName]: _removed, ...rest } = current;
        return rest;
      });
    },
    [datasetType],
  );

  const validateForm = useCallback(() => {
    const errors: FieldErrors = {};
    if (datasetType === "scale") {
      if (!asText(form.business_name).trim()) {
        errors.business_name = "사업장명은 필수입니다.";
      }
      if (!asText(form.address).trim() && !asText(form.road_address).trim()) {
        errors.address = "주소 또는 도로명주소 중 하나는 필수입니다.";
        errors.road_address = "주소 또는 도로명주소 중 하나는 필수입니다.";
      }
    } else {
      if (!asText(form.office_name).trim()) {
        errors.office_name = "영업소명은 필수입니다.";
      }
      if (!asText(form.route_name).trim()) {
        errors.route_name = "노선명은 필수입니다.";
      }
    }

    const latitudeError = validateCoordinate(form.latitude, "latitude");
    const longitudeError = validateCoordinate(form.longitude, "longitude");
    if (latitudeError) {
      errors.latitude = latitudeError;
    }
    if (longitudeError) {
      errors.longitude = longitudeError;
    }

    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      setMessage("필수 항목을 확인해 주세요.");
      const firstField = Object.keys(errors)[0];
      fieldRefs.current.get(firstField)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    return true;
  }, [datasetType, form]);

  const selectOffice = useCallback(
    (office: MapOffice, panMap = true) => {
      const item = mergedItems.find((candidate, index) => getItemId(candidate, index) === office.id);
      if (!item) {
        return;
      }
      setSelectedId(office.id);
      setSelectedFailedKey(null);
      setContextMenu(null);
      setFormFromItem(item);

      const map = mapRef.current;
      const marker = markerByIdRef.current.get(office.id);
      if (map && marker && window.kakao) {
        const position = new window.kakao.maps.LatLng(office.latitude, office.longitude);
        if (panMap) {
          if (map.getLevel() > 5) {
            map.setLevel(5);
          }
          map.panTo(position);
        }
        infoWindowRef.current?.close();
        const infoWindow = new window.kakao.maps.InfoWindow({
          content: `<div class="map-info-window"><div class="info-title">${office.business_name}</div><div class="info-row"><span class="info-label">주소</span><span class="info-value address">${office.road_address || office.address || "주소 정보 없음"}</span></div></div>`,
          removable: true,
        });
        infoWindow.open(map, marker);
        infoWindowRef.current = infoWindow;
      }
    },
    [mergedItems, setFormFromItem],
  );

  const showTempMarker = useCallback((latitude: number, longitude: number) => {
    const map = mapRef.current;
    if (!map || !window.kakao) {
      return;
    }
    const position = new window.kakao.maps.LatLng(latitude, longitude);
    if (!tempMarkerRef.current) {
      tempMarkerRef.current = new window.kakao.maps.Marker({
        map,
        position,
        title: "선택한 좌표",
        image: new window.kakao.maps.MarkerImage(
          `data:image/svg+xml;charset=UTF-8,${markerSvg("#dc2626")}`,
          new window.kakao.maps.Size(34, 42),
        ),
      });
    } else {
      tempMarkerRef.current.setPosition?.(position);
      tempMarkerRef.current.setMap(map);
    }
  }, []);

  const fillAddressFromCoordinate = useCallback((latitude: number, longitude: number) => {
    if (!window.kakao?.maps.services) {
      return;
    }
    const geocoder = new window.kakao.maps.services.Geocoder();
    geocoder.coord2Address(longitude, latitude, (result, status) => {
      if (status !== window.kakao?.maps.services?.Status.OK || !result[0]) {
        return;
      }
      const road = result[0].road_address;
      const address = result[0].address;
      setForm((current) => ({
        ...current,
        road_address: current.road_address || road?.address_name || "",
        address: current.address || address?.address_name || "",
        sido: current.sido || road?.region_1depth_name || address?.region_1depth_name || "",
        sigungu: current.sigungu || road?.region_2depth_name || address?.region_2depth_name || "",
      }));
    });
  }, []);

  const startAddAtCoordinate = useCallback(
    (latitude: number, longitude: number) => {
      setSelectedId(null);
      setContextMenu(null);
      showTempMarker(latitude, longitude);
      setForm((current) => ({
        ...(selectedFailedKey ? current : emptyForm(datasetType)),
        latitude: latitude.toFixed(7),
        longitude: longitude.toFixed(7),
        geocode_status: "manual_added",
        geocode_source: "manual_map_right_click",
        source: asText(form.source) || "manual",
      }));
      setFormErrors((current) => {
        const { latitude: _lat, longitude: _lng, geocode_status: _status, geocode_source: _source, ...rest } = current;
        return rest;
      });
      fillAddressFromCoordinate(latitude, longitude);
      setMessage("우클릭 위치를 새 항목 좌표로 입력했습니다.");
    },
    [datasetType, fillAddressFromCoordinate, selectedFailedKey, showTempMarker],
  );

  const moveSelectedToCoordinate = useCallback(
    (latitude: number, longitude: number) => {
      if (!selectedId) {
        return;
      }
      setContextMenu(null);
      showTempMarker(latitude, longitude);
      setForm((current) => ({
        ...current,
        latitude: latitude.toFixed(7),
        longitude: longitude.toFixed(7),
        geocode_status: "manual_corrected",
        geocode_source: "manual_map_right_click",
      }));
      setFormErrors((current) => {
        const { latitude: _lat, longitude: _lng, geocode_status: _status, geocode_source: _source, ...rest } = current;
        return rest;
      });
      fillAddressFromCoordinate(latitude, longitude);
      setMessage("선택 항목 좌표를 우클릭 위치로 옮겼습니다. 저장하려면 선택 항목 좌표 수정을 누르세요.");
    },
    [fillAddressFromCoordinate, selectedId, showTempMarker],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(dataUrl).then((response) => (response.ok ? response.json() : [])),
      failedDataUrl ? fetch(failedDataUrl).then((response) => (response.ok ? response.json() : [])) : [],
    ])
      .then(([items, failed]) => {
        if (cancelled) {
          return;
        }
        setBaseItems(Array.isArray(items) ? (items as EditableItem[]) : []);
        setFailedItems(Array.isArray(failed) ? (failed as HighwayFailedOffice[]) : []);
      })
      .catch((error: Error) => setMessage(error.message))
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dataUrl, failedDataUrl]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(localStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as ManualEdit[];
        if (Array.isArray(parsed)) {
          setEdits(parsed);
        }
      }
    } catch {
      setMessage("임시 저장 데이터를 읽지 못했습니다.");
    }
  }, [localStorageKey]);

  useEffect(() => {
    window.localStorage.setItem(localStorageKey, JSON.stringify(edits));
  }, [edits, localStorageKey]);

  useEffect(() => {
    if (!mapNodeRef.current || !kakaoKey || mapRef.current) {
      return;
    }
    let cancelled = false;
    loadKakaoMapScript(kakaoKey)
      .then(() => {
        window.kakao?.maps.load(() => {
          if (cancelled || !mapNodeRef.current || !window.kakao) {
            return;
          }
          mapRef.current = new window.kakao.maps.Map(mapNodeRef.current, {
            center: new window.kakao.maps.LatLng(DEFAULT_CENTER.latitude, DEFAULT_CENTER.longitude),
            level: 13,
          });
          setMapReady(true);
        });
      })
      .catch((error: Error) => setMapError(error.message));

    return () => {
      cancelled = true;
    };
  }, [kakaoKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !window.kakao) {
      return;
    }

    window.kakao.maps.event.addListener(map, "click", () => {
      setContextMenu(null);
    });

    window.kakao.maps.event.addListener(map, "rightclick", (event) => {
      if (!editModeRef.current) {
        setContextMenu(null);
        return;
      }
      const latitude = event.latLng.getLat();
      const longitude = event.latLng.getLng();
      const pointer = contextPointerRef.current;
      const mapRect = mapNodeRef.current?.getBoundingClientRect();
      setContextMenu({
        latitude,
        longitude,
        x: pointer && mapRect ? pointer.x - mapRect.left + 8 : 20,
        y: pointer && mapRect ? pointer.y - mapRect.top + 8 : 20,
      });
    });
  }, [mapReady]);

  useEffect(() => {
    const node = mapNodeRef.current;
    if (!node) {
      return;
    }

    const handleContextMenu = (event: MouseEvent) => {
      if (!editModeRef.current) {
        return;
      }
      event.preventDefault();
      contextPointerRef.current = { x: event.clientX, y: event.clientY };
    };

    node.addEventListener("contextmenu", handleContextMenu);
    return () => node.removeEventListener("contextmenu", handleContextMenu);
  }, [mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !window.kakao) {
      return;
    }
    markersRef.current.forEach((marker) => marker.setMap(null));
    markerByIdRef.current.clear();

    if (filteredOffices.length === 0) {
      markersRef.current = [];
      return;
    }

    const bounds = new window.kakao.maps.LatLngBounds();
    const markers = filteredOffices.map((office) => {
      const position = new window.kakao!.maps.LatLng(office.latitude, office.longitude);
      bounds.extend(position);
      const marker = new window.kakao!.maps.Marker({
        map,
        position,
        title: office.business_name,
        image: new window.kakao!.maps.MarkerImage(
          `data:image/svg+xml;charset=UTF-8,${markerSvg("#1d6f65")}`,
          new window.kakao!.maps.Size(34, 42),
        ),
      });
      markerByIdRef.current.set(office.id, marker);
      window.kakao!.maps.event.addListener(marker, "click", () => selectOffice(office, false));
      return marker;
    });

    markersRef.current = markers;
    if (filteredOffices.length === 1) {
      map.setCenter(
        new window.kakao.maps.LatLng(filteredOffices[0].latitude, filteredOffices[0].longitude),
      );
    } else {
      map.setBounds(bounds);
    }
  }, [filteredOffices, mapReady, selectOffice]);

  const createItemFromForm = useCallback((): EditableItem | null => {
    const latitude = toNumber(form.latitude);
    const longitude = toNumber(form.longitude);
    if (latitude == null || longitude == null) {
      setMessage("latitude와 longitude를 입력해야 합니다.");
      return null;
    }

    if (datasetType === "scale") {
      return {
        id: asText(form.id) || createManualId(datasetType, form),
        management_id: asText(form.management_id),
        business_name: asText(form.business_name),
        normalized_name: asText(form.normalized_name),
        status: asText(form.status),
        detail_status: asText(form.detail_status),
        phone: asText(form.phone),
        office_phone: asText(form.office_phone),
        sido: asText(form.sido),
        sigungu: asText(form.sigungu),
        address: asText(form.address),
        road_address: asText(form.road_address),
        latitude,
        longitude,
        coordinate_note: asText(form.coordinate_note),
        manual_note: asText(form.manual_note),
        geocode_status: asText(form.geocode_status) || "manual_added",
        geocode_source: asText(form.geocode_source) || "manual_map_right_click",
        source: "manual",
      };
    }

    return {
      id: asText(form.id) || createManualId(datasetType, form),
      office_code: asText(form.office_code),
      office_name: asText(form.office_name),
      normalized_office_name: asText(form.normalized_office_name),
      route_name: asText(form.route_name),
      direction: asText(form.direction),
      sido: asText(form.sido),
      sigungu: asText(form.sigungu),
      address: asText(form.address),
      road_address: asText(form.road_address),
      latitude,
      longitude,
      operation_type: "",
      entrance_exit_type: "",
      install_type: "",
      phone: "",
      source: asText(form.source) || "manual",
      geocode_status: asText(form.geocode_status) || "manual_added",
      geocode_source: asText(form.geocode_source) || "manual_map_right_click",
      geocode_query: asText(form.geocode_query),
      coordinate_note: asText(form.coordinate_note),
      manual_note: asText(form.manual_note),
    };
  }, [datasetType, form]);

  const findDuplicate = useCallback(
    (item: EditableItem) => {
      return mergedItems.find((candidate, index) => {
        if (selectedId && getItemId(candidate, index) === selectedId) {
          return false;
        }
        if (datasetType === "scale" && "business_name" in item && "business_name" in candidate) {
          const scaleItem = item as ScaleOffice;
          const scaleCandidate = candidate as ScaleOffice;
          if (scaleItem.management_id && scaleCandidate.management_id === scaleItem.management_id) {
            return true;
          }
          return (
            !scaleItem.management_id &&
            scaleItem.business_name.trim() === scaleCandidate.business_name.trim() &&
            ((Boolean(scaleItem.address.trim()) &&
              scaleItem.address.trim() === scaleCandidate.address.trim()) ||
              (Boolean(scaleItem.road_address.trim()) &&
                scaleItem.road_address.trim() === scaleCandidate.road_address.trim()))
          );
        }
        if (datasetType === "highway" && "office_name" in item && "office_name" in candidate) {
          const highwayItem = item as HighwayTollOffice;
          const highwayCandidate = candidate as HighwayTollOffice;
          if (highwayItem.office_code && highwayCandidate.office_code === highwayItem.office_code) {
            return true;
          }
          return (
            !highwayItem.office_code &&
            highwayItem.office_name.trim() === highwayCandidate.office_name.trim() &&
            highwayItem.route_name.trim() === highwayCandidate.route_name.trim() &&
            highwayItem.direction.trim() === highwayCandidate.direction.trim()
          );
        }
        return false;
      });
    },
    [datasetType, mergedItems, selectedId],
  );

  const addItem = useCallback(() => {
    if (!validateForm()) {
      return;
    }
    const item = createItemFromForm();
    if (!item) {
      return;
    }
    const duplicate = findDuplicate(item);
    if (duplicate) {
      setMessage(
        `중복 가능 항목이 있습니다: ${getItemName(duplicate)}. 기존 항목을 선택한 뒤 선택 항목 좌표 수정을 사용하세요.`,
      );
      return;
    }

    const now = new Date().toISOString();
    const nextEdits: ManualEdit[] = [
      {
        id: `edit-${now}-${Math.random().toString(36).slice(2)}`,
        kind: "add",
        itemId: getItemId(item, mergedItems.length),
        after: item,
        createdAt: now,
      },
    ];

    if (datasetType === "highway" && selectedFailedKey) {
      const failedIndex = mergedFailedItems.findIndex(
        (failed, index) => getFailedKey(failed, index) === selectedFailedKey,
      );
      const failed = mergedFailedItems[failedIndex];
      if (failed) {
        nextEdits.push({
          id: `resolve-${now}-${Math.random().toString(36).slice(2)}`,
          kind: "resolve",
          failedKey: selectedFailedKey,
          failedBefore: failed,
          failedAfter: { ...failed, resolved: true },
          createdAt: now,
        });
      }
    }

    setEdits((current) => [...current, ...nextEdits]);
    setSelectedId(getItemId(item, mergedItems.length));
    setFormErrors({});
    setMessage(selectedFailedKey ? "좌표 미확인 항목을 추가하고 해결 처리했습니다." : "새 항목을 추가했습니다.");
  }, [
    createItemFromForm,
    datasetType,
    findDuplicate,
    mergedFailedItems,
    mergedItems.length,
    selectedFailedKey,
    validateForm,
  ]);

  const updateItem = useCallback(() => {
    if (!selectedId) {
      setMessage("수정할 기존 항목을 먼저 선택하세요.");
      return;
    }
    if (!validateForm()) {
      return;
    }
    const item = createItemFromForm();
    if (!item) {
      return;
    }
    const before = mergedItems.find((candidate, index) => getItemId(candidate, index) === selectedId);
    if (!before) {
      setMessage("선택한 항목을 찾지 못했습니다.");
      return;
    }
    const after = { ...before, ...item, source: before.source } as EditableItem;
    const now = new Date().toISOString();
    setEdits((current) => [
      ...current,
      {
        id: `edit-${now}-${Math.random().toString(36).slice(2)}`,
        kind: "update",
        itemId: selectedId,
        before,
        after,
        createdAt: now,
      },
    ]);
    setFormErrors({});
    setMessage("선택 항목 좌표 수정을 변경사항에 추가했습니다.");
  }, [createItemFromForm, mergedItems, selectedId, validateForm]);

  const selectFailed = useCallback(
    (failed: HighwayFailedOffice, index: number) => {
      const key = getFailedKey(failed, index);
      setSelectedFailedKey(key);
      setSelectedId(null);
      setForm({
        ...emptyForm(datasetType),
        id: asText(failed.id || failed.office_code),
        office_code: asText(failed.office_code),
        office_name: asText(failed.office_name || failed.search_name),
        normalized_office_name: asText(failed.normalized_office_name || failed.search_name),
        route_name: asText(failed.route_name),
        direction: asText(failed.direction),
        sido: asText(failed.sido),
        sigungu: asText(failed.sigungu),
        address: asText(failed.address),
        road_address: asText(failed.road_address),
        geocode_query: asText(failed.tried_queries),
        geocode_status: "manual_added",
        geocode_source: "manual_map_right_click",
        source: "manual",
      });
      setFormErrors({});
      setMessage("좌표 미확인 항목을 불러왔습니다. 편집 모드에서 지도를 우클릭해 좌표를 선택하세요.");
    },
    [datasetType],
  );

  const revertEdit = useCallback((editId: string) => {
    setEdits((current) => current.filter((edit) => edit.id !== editId));
  }, []);

  const resetEdits = useCallback(() => {
    setEdits([]);
    setSelectedId(null);
    setSelectedFailedKey(null);
    setForm(emptyForm(datasetType));
    setMessage("임시 변경사항을 초기화했습니다.");
  }, [datasetType]);

  const finalFailedForDownload = useMemo(
    () => mergedFailedItems.filter((item) => !item.resolved),
    [mergedFailedItems],
  );
  const validMergedItems = useMemo(
    () => mergedItems.filter((item) => isValidItemForDownload(datasetType, item)),
    [datasetType, mergedItems],
  );

  const copyJson = useCallback(() => {
    navigator.clipboard
      .writeText(`${JSON.stringify(validMergedItems, null, 2)}\n`)
      .then(() => setCopyState("클립보드에 복사했습니다."))
      .catch(() => setCopyState("클립보드 복사에 실패했습니다."));
  }, [validMergedItems]);

  const additions = edits.filter((edit) => edit.kind === "add");
  const updates = edits.filter((edit) => edit.kind === "update");
  const resolutions = edits.filter((edit) => edit.kind === "resolve");

  return (
    <main className="editor-shell">
      <section className="editor-sidebar" aria-label={`${title} 편집 패널`}>
        <div className="editor-nav">
          <a className="home-link" href="#/">
            <ArrowLeft size={17} aria-hidden="true" />
            처음으로
          </a>
          <a className="home-link" href={mapHref}>
            일반 지도 보기
          </a>
        </div>

        <div className="brand-block editor-brand">
          <div className="brand-icon" aria-hidden="true">
            <MapPin size={24} />
          </div>
          <div>
            <h1>{title}</h1>
            <p>편집 모드에서 지도를 우클릭해 좌표를 선택하고 최종 JSON으로 다운로드합니다.</p>
          </div>
        </div>

        <div className="editor-toolbar">
          <button
            className={editMode ? "primary active" : "primary"}
            type="button"
            onClick={() => setEditMode((current) => !current)}
          >
            편집 모드 {editMode ? "ON" : "OFF"}
          </button>
          {editMode && <span className="edit-badge">편집 모드 ON · 우클릭으로 좌표 선택</span>}
        </div>

        <label className="search-box editor-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="이름, 주소, 상태 검색"
          />
        </label>

        {message && <p className="status-text">{message}</p>}
        {copyState && <p className="status-text">{copyState}</p>}

        <section className="editor-list" aria-label="좌표 보유 목록">
          <div className="editor-section-heading">
            <strong>지도 데이터</strong>
            <span>{filteredOffices.length.toLocaleString("ko-KR")}개</span>
          </div>
          {loading && <p className="status-text">데이터를 불러오는 중입니다.</p>}
          {filteredOffices.map((office) => (
            <button
              className={selectedId === office.id ? "editor-list-item selected" : "editor-list-item"}
              key={office.id}
              type="button"
              onClick={() => selectOffice(office)}
            >
              <strong>{office.business_name}</strong>
              <span>{office.road_address || office.address || "주소 정보 없음"}</span>
            </button>
          ))}
        </section>

        {datasetType === "highway" && (
          <section className="editor-list failed-list" aria-label="좌표 미확인 목록">
            <div className="editor-section-heading">
              <strong>좌표 미확인 목록</strong>
              <span>{unresolvedFailedItems.length.toLocaleString("ko-KR")}개</span>
            </div>
            {unresolvedFailedItems.map((failed, index) => {
              const key = getFailedKey(failed, index);
              return (
                <button
                  className={
                    selectedFailedKey === key ? "editor-list-item selected" : "editor-list-item"
                  }
                  key={key}
                  type="button"
                  onClick={() => selectFailed(failed, index)}
                >
                  <strong>{failed.office_name || failed.search_name || "이름 없음"}</strong>
                  <span>{[failed.route_name, failed.direction, failed.fail_reason].filter(Boolean).join(" / ")}</span>
                </button>
              );
            })}
          </section>
        )}
      </section>

      <section className="editor-main">
        <section className="editor-map-panel" aria-label="편집 지도">
          {editMode && <div className="map-edit-badge">편집 모드 ON · 우클릭으로 좌표 선택</div>}
          {!kakaoKey && (
            <div className="map-overlay">
              <strong>카카오 지도 키가 필요합니다.</strong>
              <span>.env 파일에 VITE_KAKAO_JAVASCRIPT_KEY를 설정하세요.</span>
            </div>
          )}
          {kakaoKey && mapError && (
            <div className="map-overlay">
              <strong>카카오 지도를 불러오지 못했습니다.</strong>
              <span>{mapError}</span>
            </div>
          )}
          {contextMenu && (
            <div
              className="map-context-menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              role="menu"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => startAddAtCoordinate(contextMenu.latitude, contextMenu.longitude)}
              >
                여기에 새 항목 추가
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!selectedId}
                onClick={() =>
                  moveSelectedToCoordinate(contextMenu.latitude, contextMenu.longitude)
                }
              >
                선택 항목 좌표를 여기로 이동
              </button>
              <button type="button" role="menuitem" onClick={() => setContextMenu(null)}>
                메뉴 닫기
              </button>
            </div>
          )}
          <div ref={mapNodeRef} className="map-node" />
        </section>

        <section className="editor-bottom">
          <form className="editor-form" onSubmit={(event) => event.preventDefault()}>
            <div className="editor-section-heading">
              <strong>{selectedId ? "선택 항목 수정" : selectedFailedKey ? "좌표 미확인 항목 확정" : "새 항목 추가"}</strong>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setSelectedFailedKey(null);
                  setForm(emptyForm(datasetType));
                  setFormErrors({});
                }}
              >
                폼 비우기
              </button>
            </div>

            <div className="field-grid">
              {fields.map((field) => (
                <label
                  key={field.name}
                  ref={(node) => {
                    if (node) {
                      fieldRefs.current.set(field.name, node);
                    } else {
                      fieldRefs.current.delete(field.name);
                    }
                  }}
                  className={[
                    "form-field",
                    field.className || "",
                    formErrors[field.name] ? "invalid" : "",
                    field.readOnly ? "readonly" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span className="field-label">
                    {field.label}
                    {field.required && <span className="required-mark">*</span>}
                    {field.recommended && <span className="recommended-badge">권장</span>}
                  </span>
                  {field.options ? (
                    <select
                      value={asText(form[field.name])}
                      onChange={(event) => updateFormField(field.name, event.target.value)}
                      disabled={field.readOnly}
                    >
                      {!field.required && field.name !== "direction" && <option value="">선택</option>}
                      {field.options.map((option) => (
                        <option key={`${field.name}-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea
                      readOnly={field.readOnly}
                      value={asText(form[field.name])}
                      onChange={(event) => updateFormField(field.name, event.target.value)}
                    />
                  ) : (
                    <input
                      readOnly={field.readOnly}
                      type={field.type === "number" ? "number" : "text"}
                      step={field.type === "number" ? "0.0000001" : undefined}
                      value={asText(form[field.name])}
                      placeholder={field.helpText}
                      onChange={(event) => updateFormField(field.name, event.target.value)}
                    />
                  )}
                  {field.helpText && !formErrors[field.name] && (
                    <span className="field-help">{field.helpText}</span>
                  )}
                  {formErrors[field.name] && (
                    <span className="field-error">{formErrors[field.name]}</span>
                  )}
                </label>
              ))}
            </div>

            <div className="editor-actions">
              <button className="primary" type="button" onClick={addItem}>
                <Save size={16} aria-hidden="true" />
                새 항목 추가
              </button>
              <button type="button" onClick={updateItem}>
                선택 항목 좌표 수정
              </button>
              <button type="button" onClick={resetEdits}>
                <RotateCcw size={16} aria-hidden="true" />
                임시 변경사항 초기화
              </button>
              <button type="button" onClick={() => downloadJson(downloadFileName, validMergedItems)}>
                <Download size={16} aria-hidden="true" />
                최종 JSON 다운로드
              </button>
              <button type="button" onClick={copyJson}>
                <Clipboard size={16} aria-hidden="true" />
                최종 JSON 복사
              </button>
              {datasetType === "highway" && failedDownloadFileName && (
                <button
                  type="button"
                  onClick={() => downloadJson(failedDownloadFileName, finalFailedForDownload)}
                >
                  <Download size={16} aria-hidden="true" />
                  실패 목록 JSON 다운로드
                </button>
              )}
            </div>
          </form>

          <section className="changes-panel" aria-label="변경사항">
            <div className="editor-section-heading">
              <strong>변경사항</strong>
              <span>{edits.length.toLocaleString("ko-KR")}건</span>
            </div>
            {[
              ["추가", additions],
              ["수정", updates],
              ["해결", resolutions],
            ].map(([label, items]) => (
              <div className="change-group" key={label as string}>
                <h2>
                  {label as string} <span>{(items as ManualEdit[]).length}</span>
                </h2>
                {(items as ManualEdit[]).length === 0 && <p>변경 없음</p>}
                {(items as ManualEdit[]).map((edit) => (
                  <div className="change-item" key={edit.id}>
                    <span>
                      {edit.after
                        ? getItemName(edit.after)
                        : edit.failedAfter?.office_name || edit.failedAfter?.search_name || "해결 항목"}
                    </span>
                    <button type="button" onClick={() => revertEdit(edit.id)}>
                      되돌리기
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </section>

          <p className="static-save-note">
            정적 GitHub Pages 환경에서는 JSON 파일을 직접 저장할 수 없습니다. 다운로드한 JSON
            파일을 public/data 폴더에 덮어쓴 뒤 git commit/push 해주세요.
          </p>
        </section>
      </section>
    </main>
  );
}
