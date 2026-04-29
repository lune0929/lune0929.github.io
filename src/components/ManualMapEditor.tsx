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
  KakaoMarkerClusterer,
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
  type?: ChangeKind;
  kind: ChangeKind;
  datasetType?: DatasetType;
  itemKey?: string;
  displayName?: string;
  timestamp?: string;
  itemId?: string;
  failedKey?: string;
  before?: EditableItem;
  after?: EditableItem;
  failedBefore?: HighwayFailedOffice;
  failedAfter?: HighwayFailedOffice;
  changedFields?: ChangedField[];
  createdAt: string;
}

interface ChangedField {
  key: string;
  label: string;
  before: unknown;
  after: unknown;
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
const FIELD_LABELS: Record<string, string> = {
  id: "ID",
  management_id: "관리번호",
  business_name: "사업장명",
  normalized_name: "정규화명",
  status: "상태",
  detail_status: "상세 상태",
  phone: "전화번호",
  office_phone: "사무실 전화",
  office_code: "영업소 코드",
  office_name: "영업소명",
  normalized_office_name: "정규화 영업소명",
  route_name: "노선명",
  direction: "방향",
  sido: "시도",
  sigungu: "시군구",
  address: "주소",
  road_address: "도로명주소",
  latitude: "위도",
  longitude: "경도",
  geocode_status: "좌표 상태",
  geocode_source: "좌표 출처",
  geocode_query: "좌표 검색어",
  coordinate_note: "좌표 메모",
  manual_note: "수동 메모",
  source: "데이터 출처",
  tried_queries: "시도한 검색어",
  fail_reason: "실패 사유",
  resolved: "해결 여부",
};

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

function formatDiffValue(value: unknown) {
  if (value == null || value === "") {
    return "(없음)";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(7).replace(/0+$/, "").replace(/\.$/, "");
  }
  if (Array.isArray(value)) {
    return value.join("\n");
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function toNumber(value: unknown) {
  if (value === "" || value == null) {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function formatCoordinate(value: number) {
  return value.toFixed(6);
}

function readKakaoLatLng(event: { latLng?: { getLat?: () => number; getLng?: () => number } }) {
  const lat = event.latLng?.getLat?.();
  const lng = event.latLng?.getLng?.();
  if (typeof lat !== "number" || typeof lng !== "number") {
    return null;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
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
  const koreaMin = fieldName === "latitude" ? 30 : 120;
  const koreaMax = fieldName === "latitude" ? 45 : 135;
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
  if (numberValue < koreaMin || numberValue > koreaMax) {
    return `${label}가 대한민국 지도 범위(${koreaMin}~${koreaMax})를 벗어났습니다.`;
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

function normalizeForCompare(value: unknown) {
  if (typeof value === "number") {
    return Number(value.toFixed(7));
  }
  if (Array.isArray(value)) {
    return value.join("\n");
  }
  return value == null ? "" : value;
}

function buildChangedFields(kind: ChangeKind, before?: EditableItem, after?: EditableItem) {
  const keys = Array.from(
    new Set([
      ...Object.keys((before || {}) as Record<string, unknown>),
      ...Object.keys((after || {}) as Record<string, unknown>),
    ]),
  ).filter((key) => !["raw_item", "chosen_candidate", "kakao_candidates", "naver_candidates", "rejected_candidates", "top_candidate_but_rejected"].includes(key));

  return keys
    .map((key) => {
      const beforeValue = before ? (before as Record<string, unknown>)[key] : undefined;
      const afterValue = after ? (after as Record<string, unknown>)[key] : undefined;
      return {
        key,
        label: FIELD_LABELS[key] || key,
        before: kind === "add" ? undefined : beforeValue,
        after: afterValue,
      };
    })
    .filter((field) => {
      if (kind === "add") {
        return field.after !== undefined && field.after !== "";
      }
      return JSON.stringify(normalizeForCompare(field.before)) !== JSON.stringify(normalizeForCompare(field.after));
    });
}

function buildResolveFields(before?: HighwayFailedOffice, after?: HighwayFailedOffice) {
  const fields: ChangedField[] = [];
  ["office_name", "route_name", "direction", "tried_queries", "fail_reason"].forEach((key) => {
    const value = before?.[key];
    if (value != null && value !== "") {
      fields.push({ key, label: FIELD_LABELS[key] || key, before: value, after: value });
    }
  });
  fields.push({
    key: "resolved",
    label: FIELD_LABELS.resolved,
    before: before?.resolved || false,
    after: after?.resolved || true,
  });
  return fields;
}

function getEditFields(edit: ManualEdit) {
  if (edit.changedFields?.length) {
    return edit.changedFields;
  }
  if (edit.kind === "resolve") {
    return buildResolveFields(edit.failedBefore, edit.failedAfter);
  }
  return buildChangedFields(edit.kind, edit.before, edit.after);
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

function getItemKey(datasetType: DatasetType, item?: EditableItem) {
  if (!item) {
    return "";
  }
  if (datasetType === "scale" && "business_name" in item) {
    const scale = item as ScaleOffice;
    return asText(scale.management_id || scale.id);
  }
  if (datasetType === "highway" && "office_name" in item) {
    const highway = item as HighwayTollOffice;
    return asText(highway.office_code || highway.id);
  }
  return "";
}

function getSupportText(item?: EditableItem, failed?: HighwayFailedOffice) {
  if (item && "business_name" in item) {
    return item.address || item.road_address || "";
  }
  if (item && "office_name" in item) {
    return [item.route_name, item.direction, item.address || item.road_address]
      .filter(Boolean)
      .join(" / ");
  }
  if (failed) {
    return [failed.route_name, failed.direction, failed.address || failed.road_address]
      .filter(Boolean)
      .join(" / ");
  }
  return "";
}

function getEditName(edit: ManualEdit) {
  if (edit.displayName) {
    return edit.displayName;
  }
  if (edit.after) {
    return getItemName(edit.after);
  }
  if (edit.before) {
    return getItemName(edit.before);
  }
  return edit.failedAfter?.office_name || edit.failedAfter?.search_name || "해결 항목";
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
  const clustererRef = useRef<KakaoMarkerClusterer | null>(null);
  const selectedMarkerRef = useRef<KakaoMarker | null>(null);
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
  const [selectedEdit, setSelectedEdit] = useState<ManualEdit | null>(null);
  const [isMarkerDragEditMode, setIsMarkerDragEditMode] = useState(false);
  const [activeDragItemKey, setActiveDragItemKey] = useState<string | null>(null);

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

  const getValidationErrors = useCallback((record: EditableRecord) => {
    const errors: FieldErrors = {};
    if (datasetType === "scale") {
      if (!asText(record.business_name).trim()) {
        errors.business_name = "사업장명은 필수입니다.";
      }
      if (!asText(record.address).trim() && !asText(record.road_address).trim()) {
        errors.address = "주소 또는 도로명주소 중 하나는 필수입니다.";
        errors.road_address = "주소 또는 도로명주소 중 하나는 필수입니다.";
      }
    } else {
      if (!asText(record.office_name).trim()) {
        errors.office_name = "영업소명은 필수입니다.";
      }
      if (!asText(record.route_name).trim()) {
        errors.route_name = "노선명은 필수입니다.";
      }
    }

    const latitudeError = validateCoordinate(record.latitude, "latitude");
    const longitudeError = validateCoordinate(record.longitude, "longitude");
    if (latitudeError) {
      errors.latitude = latitudeError;
    }
    if (longitudeError) {
      errors.longitude = longitudeError;
    }
    return errors;
  }, [datasetType]);

  const validateForm = useCallback(() => {
    const errors = getValidationErrors(form);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      setMessage("필수 항목을 확인해 주세요.");
      const firstField = Object.keys(errors)[0];
      fieldRefs.current.get(firstField)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    return true;
  }, [form, getValidationErrors]);

  const selectOffice = useCallback(
    (office: MapOffice, panMap = true) => {
      const item = mergedItems.find((candidate, index) => getItemId(candidate, index) === office.id);
      if (!item) {
        return;
      }
      setSelectedId(office.id);
      setSelectedFailedKey(null);
      setContextMenu(null);
      setIsMarkerDragEditMode(false);
      setActiveDragItemKey(null);
      setFormFromItem(item);

      const map = mapRef.current;
      const marker = markerByIdRef.current.get(office.id);
      if (map && marker && window.kakao) {
        const position = new window.kakao.maps.LatLng(office.latitude, office.longitude);
        if (panMap) {
          if (map.getLevel() > 4) {
            map.setLevel(4);
          }
          map.panTo(position);
        }
        selectedMarkerRef.current?.setMap(null);
        selectedMarkerRef.current = new window.kakao.maps.Marker({
          map,
          position,
          title: office.business_name,
          image: new window.kakao.maps.MarkerImage(
            `data:image/svg+xml;charset=UTF-8,${markerSvg("#dc2626")}`,
            new window.kakao.maps.Size(42, 52),
          ),
        });
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
        latitude: formatCoordinate(latitude),
        longitude: formatCoordinate(longitude),
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
      if (!selectedId && !selectedFailedKey) {
        return;
      }
      setContextMenu(null);
      showTempMarker(latitude, longitude);
      setForm((current) => ({
        ...current,
        latitude: formatCoordinate(latitude),
        longitude: formatCoordinate(longitude),
        geocode_status: selectedFailedKey ? "manual_added" : "manual_corrected",
        geocode_source: "manual_map_right_click",
        source: "manual",
      }));
      setFormErrors((current) => {
        const { latitude: _lat, longitude: _lng, geocode_status: _status, geocode_source: _source, ...rest } = current;
        return rest;
      });
      fillAddressFromCoordinate(latitude, longitude);
      setMessage("선택 항목 좌표를 우클릭 위치로 입력했습니다. 저장하려면 선택 항목 좌표 수정을 누르세요.");
    },
    [fillAddressFromCoordinate, selectedFailedKey, selectedId, showTempMarker],
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
    window.kakao.maps.event.addListener(map, "dragstart", () => {
      setContextMenu(null);
    });
    window.kakao.maps.event.addListener(map, "zoom_changed", () => {
      setContextMenu(null);
    });

    window.kakao.maps.event.addListener(map, "rightclick", (event) => {
      if (!editModeRef.current) {
        setContextMenu(null);
        return;
      }
      const coordinate = readKakaoLatLng(event);
      if (!coordinate) {
        setMessage("우클릭 좌표를 읽지 못했습니다. 다시 시도해 주세요.");
        setContextMenu(null);
        return;
      }
      const latitude = coordinate.lat;
      const longitude = coordinate.lng;
      console.log("rightclick lat/lng", latitude, longitude);
      showTempMarker(latitude, longitude);
      const pointer = contextPointerRef.current;
      const mapRect = mapNodeRef.current?.getBoundingClientRect();
      setContextMenu({
        latitude,
        longitude,
        x: pointer && mapRect ? pointer.x - mapRect.left + 8 : 20,
        y: pointer && mapRect ? pointer.y - mapRect.top + 8 : 20,
      });
    });
  }, [mapReady, showTempMarker]);

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

    node.addEventListener("contextmenu", handleContextMenu, { capture: true });
    return () => node.removeEventListener("contextmenu", handleContextMenu, { capture: true });
  }, [mapReady]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest(".map-context-menu")) {
        return;
      }
      setContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !window.kakao) {
      return;
    }
    markersRef.current.forEach((marker) => marker.setMap(null));
    clustererRef.current?.clear();
    markerByIdRef.current.clear();

    if (filteredOffices.length === 0) {
      markersRef.current = [];
      return;
    }

    const bounds = new window.kakao.maps.LatLngBounds();
    const clusterer = new window.kakao.maps.MarkerClusterer({
      map,
      averageCenter: true,
      minLevel: 6,
      disableClickZoom: false,
    });
    const markers = filteredOffices.map((office) => {
      const position = new window.kakao!.maps.LatLng(office.latitude, office.longitude);
      bounds.extend(position);
      const marker = new window.kakao!.maps.Marker({
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

    clusterer.addMarkers(markers);
    clustererRef.current = clusterer;
    markersRef.current = markers;
    if (filteredOffices.length === 1) {
      map.setCenter(
        new window.kakao.maps.LatLng(filteredOffices[0].latitude, filteredOffices[0].longitude),
      );
    } else {
      map.setBounds(bounds);
    }
  }, [filteredOffices, mapReady, selectOffice]);

  const createItemFromRecord = useCallback((record: EditableRecord): EditableItem | null => {
    const latitude = toNumber(record.latitude);
    const longitude = toNumber(record.longitude);
    if (latitude == null || longitude == null) {
      setMessage("latitude와 longitude를 입력해야 합니다.");
      return null;
    }

    if (datasetType === "scale") {
      return {
        id: asText(record.id) || createManualId(datasetType, record),
        management_id: asText(record.management_id),
        business_name: asText(record.business_name),
        normalized_name: asText(record.normalized_name),
        status: asText(record.status),
        detail_status: asText(record.detail_status),
        phone: asText(record.phone),
        office_phone: asText(record.office_phone),
        sido: asText(record.sido),
        sigungu: asText(record.sigungu),
        address: asText(record.address),
        road_address: asText(record.road_address),
        latitude,
        longitude,
        coordinate_note: asText(record.coordinate_note),
        manual_note: asText(record.manual_note),
        geocode_status: asText(record.geocode_status) || "manual_added",
        geocode_source: asText(record.geocode_source) || "manual_map_right_click",
        source: asText(record.source) || "manual",
      };
    }

    return {
      id: asText(record.id) || createManualId(datasetType, record),
      office_code: asText(record.office_code),
      office_name: asText(record.office_name),
      normalized_office_name: asText(record.normalized_office_name),
      route_name: asText(record.route_name),
      direction: asText(record.direction),
      sido: asText(record.sido),
      sigungu: asText(record.sigungu),
      address: asText(record.address),
      road_address: asText(record.road_address),
      latitude,
      longitude,
      operation_type: "",
      entrance_exit_type: "",
      install_type: "",
      phone: "",
      source: asText(record.source) || "manual",
      geocode_status: asText(record.geocode_status) || "manual_added",
      geocode_source: asText(record.geocode_source) || "manual_map_right_click",
      geocode_query: asText(record.geocode_query),
      coordinate_note: asText(record.coordinate_note),
      manual_note: asText(record.manual_note),
    };
  }, [datasetType]);

  const createItemFromForm = useCallback((): EditableItem | null => {
    return createItemFromRecord(form);
  }, [createItemFromRecord, form]);

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

  const upsertUpdateEdit = useCallback(
    (edit: ManualEdit) => {
      setEdits((current) => [
        ...current.filter(
          (existing) =>
            !(
              existing.kind === "update" &&
              ((edit.itemId && existing.itemId === edit.itemId) ||
                (edit.itemKey && existing.itemKey === edit.itemKey))
            ),
        ),
        edit,
      ]);
    },
    [],
  );

  const commitDraggedCoordinate = useCallback(
    (latitude: number, longitude: number) => {
      const nextForm = {
        ...form,
        latitude: formatCoordinate(latitude),
        longitude: formatCoordinate(longitude),
        geocode_status: "manual_corrected",
        geocode_source: "manual_marker_drag",
        coordinate_note: asText(form.coordinate_note) || "마커 드래그로 좌표 수정",
        source: "manual",
      };
      setForm(nextForm);

      const errors = getValidationErrors(nextForm);
      setFormErrors(errors);
      if (Object.keys(errors).length > 0) {
        setMessage("좌표 범위와 필수 항목을 확인해 주세요.");
        return;
      }

      const item = createItemFromRecord(nextForm);
      if (!item) {
        return;
      }
      const now = new Date().toISOString();

      if (selectedFailedKey && !selectedId) {
        const duplicate = findDuplicate(item);
        if (duplicate) {
          setMessage(
            `중복 가능 항목이 있습니다: ${getItemName(duplicate)}. 기존 항목을 선택한 뒤 다시 수정하세요.`,
          );
          return;
        }
        const failedIndex = mergedFailedItems.findIndex(
          (failed, index) => getFailedKey(failed, index) === selectedFailedKey,
        );
        const failed = mergedFailedItems[failedIndex];
        const addEdit: ManualEdit = {
          id: `edit-${now}-${Math.random().toString(36).slice(2)}`,
          type: "add",
          kind: "add",
          datasetType,
          itemKey: getItemKey(datasetType, item),
          displayName: getItemName(item),
          timestamp: now,
          itemId: getItemId(item, mergedItems.length),
          after: item,
          changedFields: buildChangedFields("add", undefined, item),
          createdAt: now,
        };
        const resolveEdit: ManualEdit | null = failed
          ? {
              id: `resolve-${now}-${Math.random().toString(36).slice(2)}`,
              type: "resolve",
              kind: "resolve",
              datasetType,
              itemKey: selectedFailedKey,
              displayName: failed.office_name || failed.search_name || "좌표 미확인 항목",
              timestamp: now,
              failedKey: selectedFailedKey,
              failedBefore: failed,
              failedAfter: { ...failed, resolved: true },
              changedFields: buildResolveFields(failed, { ...failed, resolved: true }),
              createdAt: now,
            }
          : null;
        setEdits((current) => [
          ...current.filter(
            (existing) =>
              existing.failedKey !== selectedFailedKey &&
              existing.itemKey !== getItemKey(datasetType, item),
          ),
          addEdit,
          ...(resolveEdit ? [resolveEdit] : []),
        ]);
        setSelectedId(getItemId(item, mergedItems.length));
        setSelectedFailedKey(null);
      } else if (selectedId) {
        const before = mergedItems.find(
          (candidate, index) => getItemId(candidate, index) === selectedId,
        );
        if (!before) {
          setMessage("선택한 항목을 찾지 못했습니다.");
          return;
        }
        const after = { ...before, ...item, source: before.source } as EditableItem;
        upsertUpdateEdit({
          id: `edit-${now}-${Math.random().toString(36).slice(2)}`,
          type: "update",
          kind: "update",
          datasetType,
          itemKey: getItemKey(datasetType, after),
          displayName: getItemName(after),
          timestamp: now,
          itemId: selectedId,
          before,
          after,
          changedFields: buildChangedFields("update", before, after),
          createdAt: now,
        });
      }

      setIsMarkerDragEditMode(false);
      setActiveDragItemKey(null);
      selectedMarkerRef.current?.setDraggable(false);
      tempMarkerRef.current?.setDraggable(false);
      setMessage("좌표가 수정되었습니다. 최종 JSON 다운로드로 저장하세요.");
    },
    [
      createItemFromRecord,
      datasetType,
      findDuplicate,
      form,
      getValidationErrors,
      mergedFailedItems,
      mergedItems,
      selectedFailedKey,
      selectedId,
      upsertUpdateEdit,
    ],
  );

  const startMarkerDragEdit = useCallback(() => {
    if (!selectedId && !selectedFailedKey) {
      setMessage("좌표를 수정할 항목을 먼저 선택하세요.");
      return;
    }
    const map = mapRef.current;
    if (!map || !window.kakao) {
      setMessage("지도가 준비된 뒤 다시 시도하세요.");
      return;
    }

    let marker = selectedMarkerRef.current;
    const latitude = toNumber(form.latitude);
    const longitude = toNumber(form.longitude);

    if (!marker && latitude != null && longitude != null) {
      const position = new window.kakao.maps.LatLng(latitude, longitude);
      marker = new window.kakao.maps.Marker({
        map,
        position,
        title: "좌표 수정 대상",
        image: new window.kakao.maps.MarkerImage(
          `data:image/svg+xml;charset=UTF-8,${markerSvg("#dc2626")}`,
          new window.kakao.maps.Size(42, 52),
        ),
      });
      selectedMarkerRef.current = marker;
      map.panTo(position);
    }

    if (!marker) {
      const center = map.getCenter();
      const latitudeFromCenter = center.getLat();
      const longitudeFromCenter = center.getLng();
      marker = new window.kakao.maps.Marker({
        map,
        position: center,
        title: "좌표 미확인 항목 임시 마커",
        image: new window.kakao.maps.MarkerImage(
          `data:image/svg+xml;charset=UTF-8,${markerSvg("#dc2626")}`,
          new window.kakao.maps.Size(42, 52),
        ),
      });
      tempMarkerRef.current = marker;
      setForm((current) => ({
        ...current,
        latitude: formatCoordinate(latitudeFromCenter),
        longitude: formatCoordinate(longitudeFromCenter),
        geocode_status: "manual_corrected",
        geocode_source: "manual_marker_drag",
        source: "manual",
      }));
      setMessage("좌표가 없는 항목입니다. 현재 지도 중심의 임시 마커를 원하는 위치로 끌어 주세요.");
    }

    if (map.getLevel() > 4) {
      map.setLevel(4);
    }
    map.panTo(marker.getPosition());
    marker.setMap(map);
    marker.setDraggable(true);
    setIsMarkerDragEditMode(true);
    setActiveDragItemKey(selectedId || selectedFailedKey);
    setContextMenu(null);
    window.kakao.maps.event.addListener(marker, "dragend", () => {
      const position = marker!.getPosition();
      commitDraggedCoordinate(position.getLat(), position.getLng());
    });
  }, [commitDraggedCoordinate, form.latitude, form.longitude, selectedFailedKey, selectedId]);

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
        type: "add",
        kind: "add",
        datasetType,
        itemKey: getItemKey(datasetType, item),
        displayName: getItemName(item),
        timestamp: now,
        itemId: getItemId(item, mergedItems.length),
        after: item,
        changedFields: buildChangedFields("add", undefined, item),
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
          type: "resolve",
          kind: "resolve",
          datasetType,
          itemKey: selectedFailedKey,
          displayName: failed.office_name || failed.search_name || "좌표 미확인 항목",
          timestamp: now,
          failedKey: selectedFailedKey,
          failedBefore: failed,
          failedAfter: { ...failed, resolved: true },
          changedFields: buildResolveFields(failed, { ...failed, resolved: true }),
          createdAt: now,
        });
      }
    }

    setEdits((current) => [...current, ...nextEdits]);
    setSelectedId(getItemId(item, mergedItems.length));
    if (selectedFailedKey) {
      setSelectedFailedKey(null);
    }
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
    if (selectedFailedKey && !selectedId) {
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
      const failedIndex = mergedFailedItems.findIndex(
        (failed, index) => getFailedKey(failed, index) === selectedFailedKey,
      );
      const failed = mergedFailedItems[failedIndex];
      const now = new Date().toISOString();
      const nextEdits: ManualEdit[] = [
        {
          id: `edit-${now}-${Math.random().toString(36).slice(2)}`,
          type: "add",
          kind: "add",
          datasetType,
          itemKey: getItemKey(datasetType, item),
          displayName: getItemName(item),
          timestamp: now,
          itemId: getItemId(item, mergedItems.length),
          after: item,
          changedFields: buildChangedFields("add", undefined, item),
          createdAt: now,
        },
      ];
      if (failed) {
        nextEdits.push({
          id: `resolve-${now}-${Math.random().toString(36).slice(2)}`,
          type: "resolve",
          kind: "resolve",
          datasetType,
          itemKey: selectedFailedKey,
          displayName: failed.office_name || failed.search_name || "좌표 미확인 항목",
          timestamp: now,
          failedKey: selectedFailedKey,
          failedBefore: failed,
          failedAfter: { ...failed, resolved: true },
          changedFields: buildResolveFields(failed, { ...failed, resolved: true }),
          createdAt: now,
        });
      }
      setEdits((current) => [...current, ...nextEdits]);
      setSelectedId(getItemId(item, mergedItems.length));
      setSelectedFailedKey(null);
      setFormErrors({});
      setMessage("좌표 미확인 항목 좌표를 반영하고 해결 처리했습니다.");
      return;
    }

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
        type: "update",
        kind: "update",
        datasetType,
        itemKey: getItemKey(datasetType, after),
        displayName: getItemName(after),
        timestamp: now,
        itemId: selectedId,
        before,
        after,
        changedFields: buildChangedFields("update", before, after),
        createdAt: now,
      },
    ]);
    setFormErrors({});
    setMessage("선택 항목 좌표 수정을 변경사항에 추가했습니다.");
  }, [
    createItemFromForm,
    datasetType,
    findDuplicate,
    mergedFailedItems,
    mergedItems.length,
    selectedFailedKey,
    selectedId,
    validateForm,
  ]);

  const selectFailed = useCallback(
    (failed: HighwayFailedOffice, index: number) => {
      const key = getFailedKey(failed, index);
      setSelectedFailedKey(key);
      setSelectedId(null);
      setIsMarkerDragEditMode(false);
      setActiveDragItemKey(null);
      selectedMarkerRef.current?.setMap(null);
      selectedMarkerRef.current = null;
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
    setSelectedEdit(null);
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
  const selectedEditFields = selectedEdit ? getEditFields(selectedEdit) : [];
  const hasSelectedTarget = Boolean(selectedId || selectedFailedKey);

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
        <section
          className="editor-map-panel"
          aria-label="편집 지도"
          onContextMenu={(event) => {
            if (editModeRef.current) {
              event.preventDefault();
            }
          }}
        >
          {editMode && <div className="map-edit-badge">편집 모드 ON · 우클릭으로 좌표 선택</div>}
          {isMarkerDragEditMode && (
            <div className="marker-drag-badge">
              좌표 이동 모드 ON - 마커를 끌어서 위치를 수정하세요
            </div>
          )}
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
              {hasSelectedTarget ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() =>
                    moveSelectedToCoordinate(contextMenu.latitude, contextMenu.longitude)
                  }
                >
                  이 위치를 선택 항목 좌표로 사용
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => startAddAtCoordinate(contextMenu.latitude, contextMenu.longitude)}
                >
                  여기에 새 항목 추가
                </button>
              )}
              <button type="button" role="menuitem" onClick={() => setContextMenu(null)}>
                닫기
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
                  setIsMarkerDragEditMode(false);
                  setActiveDragItemKey(null);
                  selectedMarkerRef.current?.setDraggable(false);
                  tempMarkerRef.current?.setDraggable(false);
                  setForm(emptyForm(datasetType));
                  setFormErrors({});
                }}
              >
                폼 비우기
              </button>
            </div>
            {selectedFailedKey && (
              <p className="form-hint">지도에서 우클릭하여 이 항목의 좌표를 선택할 수 있습니다.</p>
            )}

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
                      type="text"
                      inputMode={field.type === "number" ? "decimal" : undefined}
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
              <button
                className={isMarkerDragEditMode ? "primary active" : ""}
                type="button"
                onClick={startMarkerDragEdit}
              >
                선택 마커 이동으로 좌표 수정
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
                    <div className="change-summary">
                      <strong>{getEditName(edit)}</strong>
                      <span>
                        {getSupportText(edit.after || edit.before, edit.failedAfter || edit.failedBefore)}
                      </span>
                    </div>
                    <span className={`change-badge ${edit.kind}`}>
                      {edit.kind === "add" ? "추가" : edit.kind === "update" ? "수정" : "해결"}
                    </span>
                    <button type="button" onClick={() => setSelectedEdit(edit)}>
                      확인
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </section>

          {selectedEdit && (
            <div className="modal-backdrop" role="presentation" onClick={() => setSelectedEdit(null)}>
              <section
                className="change-modal"
                role="dialog"
                aria-modal="true"
                aria-label="변경사항 확인"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="modal-header">
                  <div>
                    <h2>변경사항 확인</h2>
                    <p>{getEditName(selectedEdit)}</p>
                  </div>
                  <button type="button" onClick={() => setSelectedEdit(null)}>
                    닫기
                  </button>
                </div>
                <dl className="modal-meta">
                  <div>
                    <dt>변경 유형</dt>
                    <dd>
                      {selectedEdit.kind === "add"
                        ? "추가"
                        : selectedEdit.kind === "update"
                          ? "수정"
                          : "해결"}
                    </dd>
                  </div>
                  <div>
                    <dt>기준 키</dt>
                    <dd>
                      {selectedEdit.itemKey ||
                        getItemKey(datasetType, selectedEdit.after || selectedEdit.before) ||
                        selectedEdit.failedKey ||
                        "(없음)"}
                    </dd>
                  </div>
                  <div>
                    <dt>임시 변경 시각</dt>
                    <dd>{selectedEdit.timestamp || selectedEdit.createdAt}</dd>
                  </div>
                </dl>

                {selectedEdit.kind === "resolve" && (
                  <p className="resolve-note">
                    이 항목은 좌표 미확인 목록에서 해결 처리되며, 다운로드용 failed JSON에서는 제거됩니다.
                  </p>
                )}

                <div className="diff-table-wrap">
                  <table className="diff-table">
                    <thead>
                      <tr>
                        <th>field</th>
                        <th>before</th>
                        <th>after</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedEditFields.length === 0 && (
                        <tr>
                          <td colSpan={3}>변경된 필드가 없습니다.</td>
                        </tr>
                      )}
                      {selectedEditFields.map((field) => (
                        <tr key={`${selectedEdit.id}-${field.key}`}>
                          <th>{field.label}</th>
                          <td>{formatDiffValue(field.before)}</td>
                          <td>{formatDiffValue(field.after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="modal-actions">
                  <button type="button" onClick={() => setSelectedEdit(null)}>
                    닫기
                  </button>
                  <button
                    className="danger"
                    type="button"
                    onClick={() => {
                      if (window.confirm("이 변경사항을 되돌리시겠습니까?")) {
                        revertEdit(selectedEdit.id);
                      }
                    }}
                  >
                    되돌리기
                  </button>
                </div>
              </section>
            </div>
          )}

          <p className="static-save-note">
            정적 GitHub Pages 환경에서는 JSON 파일을 직접 저장할 수 없습니다. 다운로드한 JSON
            파일을 public/data 폴더에 덮어쓴 뒤 git commit/push 해주세요.
          </p>
        </section>
      </section>
    </main>
  );
}
