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
}

const SCALE_FIELDS: FormField[] = [
  { name: "id", label: "id" },
  { name: "management_id", label: "management_id" },
  { name: "business_name", label: "business_name" },
  { name: "normalized_name", label: "normalized_name" },
  { name: "status", label: "status" },
  { name: "detail_status", label: "detail_status" },
  { name: "phone", label: "phone" },
  { name: "office_phone", label: "office_phone" },
  { name: "sido", label: "sido" },
  { name: "sigungu", label: "sigungu" },
  { name: "address", label: "address", type: "textarea" },
  { name: "road_address", label: "road_address", type: "textarea" },
  { name: "latitude", label: "latitude", type: "number" },
  { name: "longitude", label: "longitude", type: "number" },
  { name: "coordinate_note", label: "coordinate_note", type: "textarea" },
  { name: "manual_note", label: "manual_note", type: "textarea" },
  { name: "geocode_status", label: "geocode_status" },
  { name: "geocode_source", label: "geocode_source" },
];

const HIGHWAY_FIELDS: FormField[] = [
  { name: "id", label: "id" },
  { name: "office_code", label: "office_code" },
  { name: "office_name", label: "office_name" },
  { name: "normalized_office_name", label: "normalized_office_name" },
  { name: "route_name", label: "route_name" },
  { name: "direction", label: "direction" },
  { name: "sido", label: "sido" },
  { name: "sigungu", label: "sigungu" },
  { name: "address", label: "address", type: "textarea" },
  { name: "road_address", label: "road_address", type: "textarea" },
  { name: "latitude", label: "latitude", type: "number" },
  { name: "longitude", label: "longitude", type: "number" },
  { name: "geocode_status", label: "geocode_status" },
  { name: "geocode_source", label: "geocode_source" },
  { name: "geocode_query", label: "geocode_query", type: "textarea" },
  { name: "coordinate_note", label: "coordinate_note", type: "textarea" },
  { name: "manual_note", label: "manual_note", type: "textarea" },
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

  useEffect(() => {
    editModeRef.current = editMode;
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
    },
    [datasetType, fields],
  );

  const selectOffice = useCallback(
    (office: MapOffice, panMap = true) => {
      const item = mergedItems.find((candidate, index) => getItemId(candidate, index) === office.id);
      if (!item) {
        return;
      }
      setSelectedId(office.id);
      setSelectedFailedKey(null);
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

    window.kakao.maps.event.addListener(map, "click", (event) => {
      if (!editModeRef.current || !window.kakao) {
        return;
      }
      const latitude = event.latLng.getLat();
      const longitude = event.latLng.getLng();
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
      setForm((current) => ({
        ...current,
        latitude: latitude.toFixed(7),
        longitude: longitude.toFixed(7),
        geocode_status: current.geocode_status || "manual_selected",
        geocode_source: current.geocode_source || "manual_map_click",
      }));

      const geocoder = window.kakao.maps.services ? new window.kakao.maps.services.Geocoder() : null;
      if (!geocoder || !window.kakao.maps.services) {
        return;
      }
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
    });
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
        geocode_source: asText(form.geocode_source) || "manual_map_click",
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
      source: "manual",
      geocode_status: asText(form.geocode_status) || "manual_added",
      geocode_source: asText(form.geocode_source) || "manual_map_click",
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
            scaleItem.address.trim() === scaleCandidate.address.trim()
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
    const item = createItemFromForm();
    if (!item) {
      return;
    }
    const duplicate = findDuplicate(item);
    if (duplicate) {
      setMessage(
        `중복 가능 항목이 있습니다: ${getItemName(duplicate)}. 기존 항목을 선택한 뒤 수정 적용을 사용하세요.`,
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
    setMessage(selectedFailedKey ? "좌표 미확인 항목을 확정 추가했습니다." : "신규 항목을 추가했습니다.");
  }, [
    createItemFromForm,
    datasetType,
    findDuplicate,
    mergedFailedItems,
    mergedItems.length,
    selectedFailedKey,
  ]);

  const updateItem = useCallback(() => {
    if (!selectedId) {
      setMessage("수정할 기존 항목을 먼저 선택하세요.");
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
    const now = new Date().toISOString();
    setEdits((current) => [
      ...current,
      {
        id: `edit-${now}-${Math.random().toString(36).slice(2)}`,
        kind: "update",
        itemId: selectedId,
        before,
        after: item,
        createdAt: now,
      },
    ]);
    setMessage("수정 사항을 적용했습니다.");
  }, [createItemFromForm, mergedItems, selectedId]);

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
        geocode_source: "manual_map_click",
      });
      setMessage("좌표 미확인 항목을 불러왔습니다. 편집 모드에서 지도를 클릭해 좌표를 선택하세요.");
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
    setMessage("임시 저장을 초기화했습니다.");
  }, [datasetType]);

  const finalFailedForDownload = useMemo(
    () => mergedFailedItems.filter((item) => !item.resolved),
    [mergedFailedItems],
  );

  const copyJson = useCallback(() => {
    navigator.clipboard
      .writeText(`${JSON.stringify(mergedItems, null, 2)}\n`)
      .then(() => setCopyState("클립보드에 복사했습니다."))
      .catch(() => setCopyState("클립보드 복사에 실패했습니다."));
  }, [mergedItems]);

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
            <p>지도 클릭으로 누락 좌표를 선택하고 JSON으로 다운로드합니다.</p>
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
          {editMode && <span className="edit-badge">편집 모드 ON - 지도 클릭으로 좌표 선택</span>}
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
          {editMode && <div className="map-edit-badge">편집 모드 ON - 지도 클릭으로 좌표 선택</div>}
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
          <div ref={mapNodeRef} className="map-node" />
        </section>

        <section className="editor-bottom">
          <form className="editor-form" onSubmit={(event) => event.preventDefault()}>
            <div className="editor-section-heading">
              <strong>{selectedId ? "선택 항목 수정" : selectedFailedKey ? "좌표 미확인 항목 확정" : "신규 추가"}</strong>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setSelectedFailedKey(null);
                  setForm(emptyForm(datasetType));
                }}
              >
                폼 비우기
              </button>
            </div>

            <div className="field-grid">
              {fields.map((field) => (
                <label key={field.name} className={field.type === "textarea" ? "wide" : ""}>
                  {field.label}
                  {field.type === "textarea" ? (
                    <textarea
                      value={asText(form[field.name])}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, [field.name]: event.target.value }))
                      }
                    />
                  ) : (
                    <input
                      type={field.type === "number" ? "number" : "text"}
                      step={field.type === "number" ? "0.0000001" : undefined}
                      value={asText(form[field.name])}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, [field.name]: event.target.value }))
                      }
                    />
                  )}
                </label>
              ))}
            </div>

            <div className="editor-actions">
              <button className="primary" type="button" onClick={addItem}>
                <Save size={16} aria-hidden="true" />
                {selectedFailedKey ? "확정 추가" : "신규 추가"}
              </button>
              <button type="button" onClick={updateItem}>
                수정 적용
              </button>
              <button type="button" onClick={resetEdits}>
                <RotateCcw size={16} aria-hidden="true" />
                임시 저장 초기화
              </button>
              <button type="button" onClick={() => downloadJson(downloadFileName, mergedItems)}>
                <Download size={16} aria-hidden="true" />
                수정된 JSON 다운로드
              </button>
              <button type="button" onClick={copyJson}>
                <Clipboard size={16} aria-hidden="true" />
                JSON 클립보드 복사
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
                <h2>{label as string}</h2>
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
