import { ArrowLeft, MapPin, Phone, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type {
  AccidentHotspot,
  HeavyFactory,
  HighwayTollOffice,
  KakaoInfoWindow,
  KakaoMap,
  KakaoMarkerImage,
  KakaoMarker,
  KakaoMarkerClusterer,
  KakaoPolygon,
  LogisticsWarehouse,
  MapOffice,
  OverloadCheckpoint,
  RestArea,
  ScaleOffice,
  TruckAccidentHotspot,
} from "../types";
import { getDataUrl, loadKakaoMapScript } from "../utils/kakaoMap";

const DEFAULT_CENTER = { latitude: 36.5, longitude: 127.8 };
const ALL = "전체";
const HEAVY_FACTORY_CLASS_OPTIONS = [ALL, "고중량 후보 강", "고중량 후보 중"] as const;
const WAREHOUSE_SIZE_OPTIONS = [ALL, "대형", "중형", "소형", "초대형"] as const;
const TRUCK_ACCIDENT_COUNT_OPTIONS = [ALL, "4건 이상", "5건 이상", "7건 이상", "10건 이상"] as const;
const TRUCK_DEATH_COUNT_OPTIONS = [ALL, "사망자 있음", "사망자 2명 이상"] as const;
const TRUCK_SERIOUS_INJURY_OPTIONS = [ALL, "중상자 5명 이상", "중상자 10명 이상"] as const;
const INDUSTRIAL_COMPLEX_TYPE_OPTIONS = [
  ALL,
  "국가산업단지",
  "일반산업단지",
  "도시첨단산업단지",
  "농공단지",
] as const;
const STATUS_LABELS = {
  open: "영업",
  closed: "폐업",
  other: "기타",
} as const;
const OVERLAY_MARKER_LAYERS = [
  { id: "scale-offices", label: "민간계량소", dataFile: "scale-offices.json", color: "#16875f" },
  {
    id: "highway-toll-offices",
    label: "영업소",
    dataFile: "highway-toll-offices.json",
    color: "#2563eb",
  },
  { id: "rest-areas", label: "휴게소", dataFile: "rest-areas.json", color: "#7c3aed" },
  {
    id: "accident-hotspots",
    label: "사고다발지역",
    dataFile: "accident-hotspots.json",
    color: "#d97706",
  },
  {
    id: "logistics-warehouses",
    label: "물류창고",
    dataFile: "logistics-warehouses.json",
    color: "#be123c",
  },
] as const;

type StatusCategory = keyof typeof STATUS_LABELS;
type MapViewType = "roadmap" | "skyview";
type LayerId =
  | "scale-offices"
  | "highway-toll-offices"
  | "overload-checkpoints"
  | "heavy-factories"
  | "rest-areas"
  | "accident-hotspots"
  | "logistics-warehouses"
  | "truck-accident-hotspots"
  | "port-areas"
  | "industrial-complex-boundaries";
type OverlayMarkerLayerId = (typeof OVERLAY_MARKER_LAYERS)[number]["id"];
type GeoJsonPosition = [number, number];
type GeoJsonPolygonCoordinates = GeoJsonPosition[][];
type GeoJsonMultiPolygonCoordinates = GeoJsonPolygonCoordinates[];

interface PortAreaFeature {
  type: "Feature";
  properties?: Record<string, unknown>;
  geometry?: {
    type: "Polygon" | "MultiPolygon" | string;
    coordinates: GeoJsonPolygonCoordinates | GeoJsonMultiPolygonCoordinates;
  };
}

interface PortAreaFeatureCollection {
  type: "FeatureCollection";
  features?: PortAreaFeature[];
}

interface MapViewProps<T> {
  title: string;
  description: string;
  dataUrl: string;
  emptyMessage: string;
  searchPlaceholder: string;
  normalizeItem: (item: T, index: number) => MapOffice | null;
  markerVariant?: "default" | "checkpoint" | "warehouse" | "truck-accident";
  showCheckpointToggle?: boolean;
  showIndustrialComplexBoundaryLayer?: boolean;
  currentLayer?: LayerId;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) {
    return value;
  }
  if (digits.startsWith("02")) {
    if (digits.length === 9) {
      return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    }
    if (digits.length === 10) {
      return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
    }
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  return value;
}

function getAddress(office: MapOffice) {
  return office.road_address || office.address || "주소 정보 없음";
}

function getStatusCategory(status: string): StatusCategory {
  const normalized = status.replace(/\s/g, "");
  if (normalized.includes("폐업") || normalized.includes("취소") || normalized.includes("말소")) {
    return "closed";
  }
  if (
    normalized.includes("영업/정상") ||
    normalized.includes("정상") ||
    normalized.includes("영업중") ||
    normalized.includes("운영") ||
    normalized.includes("좌표확인")
  ) {
    return "open";
  }
  return "other";
}

function getMarkerSvg(color: string) {
  return encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42">
      <path fill="${color}" d="M17 0C7.6 0 0 7.5 0 16.7c0 12.5 17 25.3 17 25.3s17-12.8 17-25.3C34 7.5 26.4 0 17 0Z"/>
      <circle cx="17" cy="16.5" r="6.2" fill="white"/>
    </svg>
  `);
}

function getCheckpointMarkerSvg() {
  return encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
      <path fill="#b42318" d="M18 0C8.1 0 0 8 0 17.8 0 31.1 18 44 18 44s18-12.9 18-26.2C36 8 27.9 0 18 0Z"/>
      <path fill="white" d="M10 14.2h10.7v8.7H10zM21.9 17.1h3.3l2.8 3.2v2.6h-6.1z"/>
      <circle cx="14" cy="25.1" r="2" fill="white"/>
      <circle cx="25" cy="25.1" r="2" fill="white"/>
    </svg>
  `);
}

function getHeavyFactoryMarkerSvg(color: string) {
  return encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
      <path fill="${color}" d="M18 0C8.1 0 0 8 0 17.8 0 31.1 18 44 18 44s18-12.9 18-26.2C36 8 27.9 0 18 0Z"/>
      <path fill="white" d="M9 14h18v11H9z"/>
      <path fill="${color}" d="M12 17h3v8h-3zM17 17h3v8h-3zM22 17h3v8h-3z"/>
      <path fill="white" d="M12 10h5v4h-5zM19 8h5v6h-5z"/>
    </svg>
  `);
}

function getWarehouseMarkerSvg(color: string, scale: number) {
  const width = Math.round(34 * scale);
  const height = Math.round(42 * scale);
  return encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 34 42">
      <path fill="${color}" d="M17 0C7.6 0 0 7.5 0 16.7c0 12.5 17 25.3 17 25.3s17-12.8 17-25.3C34 7.5 26.4 0 17 0Z"/>
      <path fill="white" d="M9 14h16v10H9z"/>
      <path fill="${color}" d="M12 17h3v7h-3zM16 17h3v7h-3zM20 17h3v7h-3z"/>
      <path fill="white" d="M8 11h18v4H8z"/>
    </svg>
  `);
}

function getTruckAccidentMarkerSvg() {
  return encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
      <path fill="#991b1b" d="M18 0C8.1 0 0 8 0 17.8 0 31.1 18 44 18 44s18-12.9 18-26.2C36 8 27.9 0 18 0Z"/>
      <path fill="white" d="M9 15h11v7H9zM21 17h4l3 3.2V22h-7z"/>
      <circle cx="13" cy="24.5" r="2" fill="white"/>
      <circle cx="25" cy="24.5" r="2" fill="white"/>
      <path fill="#991b1b" d="M17 8h2v5h-2zM17 26h2v2h-2z"/>
    </svg>
  `);
}

function getMarkerColor(category: StatusCategory) {
  if (category === "open") {
    return "#16875f";
  }
  if (category === "closed") {
    return "#7b8794";
  }
  return "#d97706";
}

function isGeoJsonPosition(value: unknown): value is GeoJsonPosition {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

function polygonCoordinateSets(feature: PortAreaFeature): GeoJsonPolygonCoordinates[] {
  const geometry = feature.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) {
    return [];
  }
  if (geometry.type === "Polygon") {
    return [geometry.coordinates as GeoJsonPolygonCoordinates];
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates as GeoJsonMultiPolygonCoordinates;
  }
  return [];
}

function industrialComplexStyle(typeName: string) {
  if (typeName === "국가산업단지") {
    return { strokeColor: "#1d4ed8", fillColor: "#3b82f6" };
  }
  if (typeName === "일반산업단지") {
    return { strokeColor: "#15803d", fillColor: "#22c55e" };
  }
  if (typeName === "도시첨단산업단지") {
    return { strokeColor: "#7c3aed", fillColor: "#a855f7" };
  }
  if (typeName === "농공단지") {
    return { strokeColor: "#b45309", fillColor: "#f59e0b" };
  }
  return { strokeColor: "#475569", fillColor: "#94a3b8" };
}

function overlayMarkerImageSvg(color: string) {
  return encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
      <path fill="${color}" d="M16 0C7.2 0 0 7.1 0 15.9 0 27.8 16 40 16 40s16-12.2 16-24.1C32 7.1 24.8 0 16 0Z"/>
      <circle cx="16" cy="15.8" r="5.4" fill="white"/>
    </svg>
  `);
}

function overlayLayerItemToOffice(
  layerId: OverlayMarkerLayerId,
  item: ScaleOffice | HighwayTollOffice | RestArea | AccidentHotspot | LogisticsWarehouse,
  index: number,
): MapOffice | null {
  if (layerId === "scale-offices") {
    const office = item as ScaleOffice;
    if (typeof office.longitude !== "number" || typeof office.latitude !== "number") {
      return null;
    }
    return {
      id: office.id || `scale-overlay-${index + 1}`,
      business_name: office.business_name || "민간계량소",
      status: office.status || "상태 미상",
      phone: office.phone || "",
      address: office.address || "",
      road_address: office.road_address || "",
      longitude: office.longitude,
      latitude: office.latitude,
      sido: office.sido || "",
      sigungu: office.sigungu || "",
    };
  }

  if (layerId === "highway-toll-offices") {
    const office = item as HighwayTollOffice;
    if (typeof office.longitude !== "number" || typeof office.latitude !== "number") {
      return null;
    }
    return {
      id: office.id || office.office_code || `highway-overlay-${index + 1}`,
      business_name: office.office_name || "영업소",
      status: office.operation_type || "영업소",
      phone: office.phone || "",
      address: office.address || "",
      road_address: office.road_address || "",
      longitude: office.longitude,
      latitude: office.latitude,
      sido: office.sido || "",
      sigungu: office.sigungu || "",
      search_text: [office.route_name, office.office_code].filter(Boolean).join(" "),
    };
  }

  if (layerId === "rest-areas") {
    const restArea = item as RestArea;
    if (typeof restArea.longitude !== "number" || typeof restArea.latitude !== "number") {
      return null;
    }
    return {
      id: restArea.id || `rest-overlay-${index + 1}`,
      business_name: restArea.business_name || restArea.rest_area_name || "휴게소",
      status: restArea.status || "휴게소",
      phone: restArea.phone || "",
      address: restArea.address || [restArea.route_name, restArea.direction].filter(Boolean).join(" / "),
      road_address: restArea.road_address || "",
      longitude: restArea.longitude,
      latitude: restArea.latitude,
      sido: restArea.sido || "",
      sigungu: restArea.sigungu || "",
      search_text: [restArea.route_name, restArea.direction, restArea.signature_food].filter(Boolean).join(" "),
    };
  }

  if (layerId === "accident-hotspots") {
    const hotspot = item as AccidentHotspot;
    if (typeof hotspot.longitude !== "number" || typeof hotspot.latitude !== "number") {
      return null;
    }
    return {
      id: hotspot.id || `accident-overlay-${index + 1}`,
      business_name: hotspot.business_name || "사고다발지역",
      status: hotspot.status || hotspot.accident_type || "사고다발지역",
      phone: hotspot.phone || "",
      address: hotspot.address || hotspot.region_name || "",
      road_address: hotspot.road_address || "",
      longitude: hotspot.longitude,
      latitude: hotspot.latitude,
      sido: hotspot.sido || "",
      sigungu: hotspot.sigungu || "",
      search_text: [hotspot.accident_year, hotspot.accident_type, hotspot.accident_count].filter(Boolean).join(" "),
    };
  }

  const warehouse = item as LogisticsWarehouse;
  if (
    warehouse.status !== "영업/정상" ||
    typeof warehouse.longitude !== "number" ||
    typeof warehouse.latitude !== "number"
  ) {
    return null;
  }
  return {
    id: warehouse.id || `warehouse-overlay-${index + 1}`,
    business_name: warehouse.business_name || "물류창고",
    status: warehouse.status,
    phone: "",
    address: warehouse.jibun_address || warehouse.road_address,
    road_address: warehouse.road_address,
    longitude: warehouse.longitude,
    latitude: warehouse.latitude,
    sido: (warehouse.jibun_address || warehouse.road_address).split(" ")[0] || "",
    sigungu: "",
    total_warehouse_area: warehouse.total_warehouse_area,
    general_warehouse_area: warehouse.general_warehouse_area,
    cold_storage_area: warehouse.cold_storage_area,
    storage_place_area: warehouse.storage_place_area,
    warehouse_size_class: warehouse.warehouse_size_class,
    is_mega: warehouse.is_mega,
  };
}

export default function MapView<T>({
  title,
  description,
  dataUrl,
  emptyMessage,
  searchPlaceholder,
  normalizeItem,
  markerVariant = "default",
  showCheckpointToggle = true,
  showIndustrialComplexBoundaryLayer = false,
  currentLayer,
}: MapViewProps<T>) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const markersRef = useRef<KakaoMarker[]>([]);
  const markerByIdRef = useRef<Map<string, KakaoMarker>>(new Map());
  const clustererRef = useRef<KakaoMarkerClusterer | null>(null);
  const infoWindowRef = useRef<KakaoInfoWindow | null>(null);
  const checkpointMarkersRef = useRef<KakaoMarker[]>([]);
  const checkpointMarkerImageRef = useRef<KakaoMarkerImage | null>(null);
  const heavyFactoryMarkersRef = useRef<KakaoMarker[]>([]);
  const heavyFactoryClustererRef = useRef<KakaoMarkerClusterer | null>(null);
  const heavyFactoryMarkerImagesRef = useRef<
    Partial<Record<"certain" | "possible", KakaoMarkerImage>>
  >({});
  const portAreaPolygonsRef = useRef<KakaoPolygon[]>([]);
  const industrialComplexPolygonsRef = useRef<KakaoPolygon[]>([]);
  const truckAccidentPolygonsRef = useRef<KakaoPolygon[]>([]);
  const truckAccidentMarkerImageRef = useRef<KakaoMarkerImage | null>(null);
  const [truckAccidentGeoJson, setTruckAccidentGeoJson] = useState<PortAreaFeatureCollection | null>(null);
  const overlayMarkerLayersRef = useRef<
    Map<OverlayMarkerLayerId, { markers: KakaoMarker[]; clusterer: KakaoMarkerClusterer | null }>
  >(new Map());
  const overlayMarkerImagesRef = useRef<Partial<Record<OverlayMarkerLayerId, KakaoMarkerImage>>>({});
  const officeRefs = useRef<Map<string, HTMLElement>>(new Map());
  const suppressNextMapClickRef = useRef(false);
  const markerImagesRef = useRef<Partial<Record<StatusCategory, unknown>>>({});

  const [offices, setOffices] = useState<MapOffice[]>([]);
  const [query, setQuery] = useState("");
  const [sido, setSido] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [selectedOfficeId, setSelectedOfficeId] = useState<string | null>(null);
  const [mapViewType, setMapViewType] = useState<MapViewType>("roadmap");
  const [checkpointsVisible, setCheckpointsVisible] = useState(false);
  const [checkpointsLoading, setCheckpointsLoading] = useState(false);
  const [checkpointsError, setCheckpointsError] = useState("");
  const [heavyFactoriesVisible, setHeavyFactoriesVisible] = useState(false);
  const [heavyFactoriesLoading, setHeavyFactoriesLoading] = useState(false);
  const [heavyFactoriesError, setHeavyFactoriesError] = useState("");
  const [heavyFactoryClassFilter, setHeavyFactoryClassFilter] = useState<string>(ALL);
  const [portAreasVisible, setPortAreasVisible] = useState(false);
  const [portAreasLoading, setPortAreasLoading] = useState(false);
  const [portAreasError, setPortAreasError] = useState("");
  const [warehouseSizeFilter, setWarehouseSizeFilter] = useState<string>("대형");
  const [industrialComplexesVisible, setIndustrialComplexesVisible] = useState(false);
  const [industrialComplexesLoading, setIndustrialComplexesLoading] = useState(false);
  const [industrialComplexesError, setIndustrialComplexesError] = useState("");
  const [industrialComplexTypeFilter, setIndustrialComplexTypeFilter] = useState<string>(ALL);
  const [truckAccidentCountFilter, setTruckAccidentCountFilter] = useState<string>(ALL);
  const [truckDeathCountFilter, setTruckDeathCountFilter] = useState<string>(ALL);
  const [truckSeriousInjuryFilter, setTruckSeriousInjuryFilter] = useState<string>(ALL);
  const [overlayLayerVisible, setOverlayLayerVisible] = useState<Partial<Record<OverlayMarkerLayerId, boolean>>>({});
  const [overlayLayerLoading, setOverlayLayerLoading] = useState<Partial<Record<OverlayMarkerLayerId, boolean>>>({});
  const [overlayLayerError, setOverlayLayerError] = useState<Partial<Record<OverlayMarkerLayerId, string>>>({});
  const kakaoKey = import.meta.env.VITE_KAKAO_JAVASCRIPT_KEY as string | undefined;

  const closeInfoWindow = useCallback(() => {
    infoWindowRef.current?.close();
    infoWindowRef.current = null;
  }, []);

  const createInfoWindowContent = useCallback((office: MapOffice) => {
    if (markerVariant === "checkpoint") {
      const coordinates = `${office.latitude.toFixed(6)}, ${office.longitude.toFixed(6)}`;
      return `
        <div class="map-info-window checkpoint">
          <div class="info-title">${escapeHtml(office.business_name || "과적검문소")}</div>
          <div class="info-row">
            <span class="info-label">주소</span>
            <span class="info-value address">${escapeHtml(office.address || "주소 정보 없음")}</span>
          </div>
          <div class="info-row">
            <span class="info-label">도로명</span>
            <span class="info-value address">${escapeHtml(office.road_address || "도로명주소 정보 없음")}</span>
          </div>
          <div class="info-row">
            <span class="info-label">좌표</span>
            <span class="info-value">${escapeHtml(coordinates)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">상태</span>
            <span class="info-badge checkpoint">${escapeHtml(office.status || "상태 미상")}</span>
          </div>
        </div>
      `;
    }

    if (markerVariant === "warehouse") {
      const totalArea = office.total_warehouse_area ?? 0;
      const classLabel = office.is_mega ? "초대형" : office.warehouse_size_class || "규모 미상";
      return `
        <div class="map-info-window warehouse">
          <div class="info-title">${escapeHtml(office.business_name || "물류창고")}</div>
          <div class="info-row">
            <span class="info-label">규모</span>
            <span class="info-badge warehouse">${escapeHtml(classLabel)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">총면적</span>
            <span class="info-value">${escapeHtml(totalArea.toLocaleString("ko-KR"))}㎡</span>
          </div>
          <div class="info-row">
            <span class="info-label">일반</span>
            <span class="info-value">${escapeHtml(String(office.general_warehouse_area ?? 0))}㎡</span>
          </div>
          <div class="info-row">
            <span class="info-label">냉동냉장</span>
            <span class="info-value">${escapeHtml(String(office.cold_storage_area ?? 0))}㎡</span>
          </div>
          <div class="info-row">
            <span class="info-label">보관장소</span>
            <span class="info-value">${escapeHtml(String(office.storage_place_area ?? 0))}㎡</span>
          </div>
          <div class="info-row">
            <span class="info-label">도로명</span>
            <span class="info-value address">${escapeHtml(office.road_address || "도로명주소 정보 없음")}</span>
          </div>
          <div class="info-row">
            <span class="info-label">지번</span>
            <span class="info-value address">${escapeHtml(office.address || "지번주소 정보 없음")}</span>
          </div>
          <div class="info-row">
            <span class="info-label">상태</span>
            <span class="info-badge open">${escapeHtml(office.status || "상태 미상")}</span>
          </div>
        </div>
      `;
    }

    if (markerVariant === "truck-accident") {
      const coordinates = `${office.latitude.toFixed(6)}, ${office.longitude.toFixed(6)}`;
      return `
        <div class="map-info-window truck-accident">
          <div class="info-title">${escapeHtml(office.business_name || "화물차 사고다발지역")}</div>
          <div class="info-row"><span class="info-label">지역</span><span class="info-value">${escapeHtml(office.region_name || office.sido || "지역 정보 없음")}</span></div>
          <div class="info-row"><span class="info-label">사고</span><span class="info-value">${escapeHtml(String(office.accident_count ?? 0))}건</span></div>
          <div class="info-row"><span class="info-label">사상자</span><span class="info-value">${escapeHtml(String(office.casualty_count ?? 0))}명</span></div>
          <div class="info-row"><span class="info-label">사망</span><span class="info-value">${escapeHtml(String(office.death_count ?? 0))}명</span></div>
          <div class="info-row"><span class="info-label">중상</span><span class="info-value">${escapeHtml(String(office.serious_injury_count ?? 0))}명</span></div>
          <div class="info-row"><span class="info-label">경상</span><span class="info-value">${escapeHtml(String(office.minor_injury_count ?? 0))}명</span></div>
          <div class="info-row"><span class="info-label">부상신고</span><span class="info-value">${escapeHtml(String(office.reported_injury_count ?? 0))}명</span></div>
          <div class="info-row"><span class="info-label">좌표</span><span class="info-value">${escapeHtml(coordinates)}</span></div>
        </div>
      `;
    }

    const category = getStatusCategory(office.status);
    return `
      <div class="map-info-window">
        <div class="info-title">${escapeHtml(office.business_name || "이름 없음")}</div>
        <div class="info-row">
          <span class="info-label">주소</span>
          <span class="info-value address">${escapeHtml(getAddress(office))}</span>
        </div>
        <div class="info-row">
          <span class="info-label">전화</span>
          <span class="info-value">${escapeHtml(normalizePhone(office.phone) || "전화번호 정보 없음")}</span>
        </div>
        <div class="info-row">
          <span class="info-label">상태</span>
          <span class="info-badge ${category}">${escapeHtml(office.status || "상태 미상")}</span>
        </div>
      </div>
    `;
  }, [markerVariant]);

  const createCheckpointInfoWindowContent = useCallback((checkpoint: OverloadCheckpoint) => {
    const coordinates =
      checkpoint.latitude !== null && checkpoint.longitude !== null
        ? `${checkpoint.latitude.toFixed(6)}, ${checkpoint.longitude.toFixed(6)}`
        : "좌표 정보 없음";

    return `
      <div class="map-info-window checkpoint">
        <div class="info-title">${escapeHtml(checkpoint.business_name || "과적검문소")}</div>
        <div class="info-row">
          <span class="info-label">주소</span>
          <span class="info-value address">${escapeHtml(checkpoint.address || "주소 정보 없음")}</span>
        </div>
        <div class="info-row">
          <span class="info-label">도로명</span>
          <span class="info-value address">${escapeHtml(checkpoint.road_address || "도로명주소 정보 없음")}</span>
        </div>
        <div class="info-row">
          <span class="info-label">좌표</span>
          <span class="info-value">${escapeHtml(coordinates)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">상태</span>
          <span class="info-badge checkpoint">${escapeHtml(checkpoint.status || "상태 미상")}</span>
        </div>
      </div>
    `;
  }, []);

  const createHeavyFactoryInfoWindowContent = useCallback((factory: HeavyFactory) => {
    const coordinates =
      typeof factory.latitude === "number" && typeof factory.longitude === "number"
        ? `${factory.latitude.toFixed(6)}, ${factory.longitude.toFixed(6)}`
        : "좌표 정보 없음";
    const reasonKeywords = factory.reason_keywords?.length
      ? factory.reason_keywords.join(", ")
      : "분류 키워드 없음";

    return `
      <div class="map-info-window heavy-factory">
        <div class="info-title">${escapeHtml(factory.company_name || "회사명 없음")}</div>
        <div class="info-row">
          <span class="info-label">생산품</span>
          <span class="info-value address">${escapeHtml(factory.product || "생산품 정보 없음")}</span>
        </div>
        <div class="info-row">
          <span class="info-label">주소</span>
          <span class="info-value address">${escapeHtml(factory.factory_address || "주소 정보 없음")}</span>
        </div>
        <div class="info-row">
          <span class="info-label">단지명</span>
          <span class="info-value">${escapeHtml(factory.complex_name || "단지 정보 없음")}</span>
        </div>
        <div class="info-row">
          <span class="info-label">분류</span>
          <span class="info-badge heavy">${escapeHtml(factory.heavy_class || "분류 없음")}</span>
        </div>
        <div class="info-row">
          <span class="info-label">점수</span>
          <span class="info-value">${escapeHtml(String(factory.heavy_score ?? ""))}</span>
        </div>
        <div class="info-row">
          <span class="info-label">사유</span>
          <span class="info-value address">${escapeHtml(reasonKeywords)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">좌표</span>
          <span class="info-value">${escapeHtml(coordinates)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">매칭</span>
          <span class="info-value address">${escapeHtml(factory.matched_address || "매칭주소 없음")}</span>
        </div>
        <div class="info-row">
          <span class="info-label">도로명</span>
          <span class="info-value address">${escapeHtml(factory.road_address || "도로명주소 없음")}</span>
        </div>
        <div class="info-row">
          <span class="info-label">지번</span>
          <span class="info-value address">${escapeHtml(factory.jibun_address || "지번주소 없음")}</span>
        </div>
        <div class="info-row">
          <span class="info-label">제공자</span>
          <span class="info-value">${escapeHtml(factory.geocode_provider || "kakao")}</span>
        </div>
      </div>
    `;
  }, []);

  const createPortAreaInfoWindowContent = useCallback((properties: Record<string, unknown>) => {
    const preferredKeys = [
      "항만명",
      "항만구역명",
      "시설명",
      "관리기관",
      "코드",
      "PRT_NM",
      "PORT_NM",
      "HRBARE_NM",
      "FCLTY_NM",
      "MNG_INST_NM",
      "CODE",
      "nobjnm",
      "objnam",
      "pbinst",
      "enc_no",
      "objnum",
    ];
    const entries = Object.entries(properties).filter(([, value]) => value !== null && value !== "");
    const preferredEntries = preferredKeys
      .map((key) => entries.find(([entryKey]) => entryKey === key))
      .filter((entry): entry is [string, unknown] => Boolean(entry));
    const rows = (preferredEntries.length ? preferredEntries : entries).slice(0, 12);

    return `
      <div class="map-info-window port-area">
        <div class="info-title">${escapeHtml(String(rows[0]?.[1] || "항만구역"))}</div>
        ${
          rows.length
            ? rows
                .map(
                  ([key, value]) => `
                    <div class="info-row">
                      <span class="info-label">${escapeHtml(key)}</span>
                      <span class="info-value address">${escapeHtml(String(value))}</span>
                    </div>
                  `,
                )
                .join("")
            : `<div class="info-row"><span class="info-value">속성 정보 없음</span></div>`
        }
      </div>
    `;
  }, []);

  const createIndustrialComplexInfoWindowContent = useCallback((properties: Record<string, unknown>) => {
    return `
      <div class="map-info-window industrial-complex">
        <div class="info-title">${escapeHtml(String(properties.name || "산업단지"))}</div>
        <div class="info-row">
          <span class="info-label">유형</span>
          <span class="info-badge industrial">${escapeHtml(String(properties.complex_type_name || "기타"))}</span>
        </div>
        <div class="info-row">
          <span class="info-label">단지 ID</span>
          <span class="info-value">${escapeHtml(String(properties.dan_id || properties.id || ""))}</span>
        </div>
        <div class="info-row">
          <span class="info-label">약칭</span>
          <span class="info-value address">${escapeHtml(String(properties.short_name || "정보 없음"))}</span>
        </div>
        <div class="info-row">
          <span class="info-label">좌표</span>
          <span class="info-value">${escapeHtml(String(properties.coordinate_status || "EPSG:4326"))}</span>
        </div>
      </div>
    `;
  }, []);

  const createTruckAccidentInfoWindowContent = useCallback((properties: Record<string, unknown>) => {
    const longitude = properties.longitude ? Number(properties.longitude).toFixed(6) : "";
    const latitude = properties.latitude ? Number(properties.latitude).toFixed(6) : "";
    return `
      <div class="map-info-window truck-accident">
        <div class="info-title">${escapeHtml(String(properties.spot_name || "화물차 사고다발지역"))}</div>
        <div class="info-row"><span class="info-label">지역</span><span class="info-value">${escapeHtml(String(properties.region_name || "지역 정보 없음"))}</span></div>
        <div class="info-row"><span class="info-label">사고</span><span class="info-value">${escapeHtml(String(properties.accident_count ?? 0))}건</span></div>
        <div class="info-row"><span class="info-label">사상자</span><span class="info-value">${escapeHtml(String(properties.casualty_count ?? 0))}명</span></div>
        <div class="info-row"><span class="info-label">사망</span><span class="info-value">${escapeHtml(String(properties.death_count ?? 0))}명</span></div>
        <div class="info-row"><span class="info-label">중상</span><span class="info-value">${escapeHtml(String(properties.serious_injury_count ?? 0))}명</span></div>
        <div class="info-row"><span class="info-label">경상</span><span class="info-value">${escapeHtml(String(properties.minor_injury_count ?? 0))}명</span></div>
        <div class="info-row"><span class="info-label">부상신고</span><span class="info-value">${escapeHtml(String(properties.reported_injury_count ?? 0))}명</span></div>
        <div class="info-row"><span class="info-label">좌표</span><span class="info-value">${escapeHtml(latitude && longitude ? `${latitude}, ${longitude}` : "좌표 정보 없음")}</span></div>
      </div>
    `;
  }, []);

  const createOverlayInfoWindowContent = useCallback((layerLabel: string, office: MapOffice) => {
    if (office.total_warehouse_area !== undefined) {
      const classLabel = office.is_mega ? "초대형" : office.warehouse_size_class || "규모 미상";
      return `
        <div class="map-info-window warehouse">
          <div class="info-title">${escapeHtml(office.business_name || layerLabel)}</div>
          <div class="info-row"><span class="info-label">레이어</span><span class="info-value">${escapeHtml(layerLabel)}</span></div>
          <div class="info-row"><span class="info-label">규모</span><span class="info-badge warehouse">${escapeHtml(classLabel)}</span></div>
          <div class="info-row"><span class="info-label">총면적</span><span class="info-value">${escapeHtml((office.total_warehouse_area || 0).toLocaleString("ko-KR"))}㎡</span></div>
          <div class="info-row"><span class="info-label">도로명</span><span class="info-value address">${escapeHtml(office.road_address || "도로명주소 정보 없음")}</span></div>
          <div class="info-row"><span class="info-label">지번</span><span class="info-value address">${escapeHtml(office.address || "지번주소 정보 없음")}</span></div>
        </div>
      `;
    }

    const category = getStatusCategory(office.status);
    return `
      <div class="map-info-window">
        <div class="info-title">${escapeHtml(office.business_name || layerLabel)}</div>
        <div class="info-row"><span class="info-label">레이어</span><span class="info-value">${escapeHtml(layerLabel)}</span></div>
        <div class="info-row"><span class="info-label">주소</span><span class="info-value address">${escapeHtml(getAddress(office))}</span></div>
        <div class="info-row"><span class="info-label">전화</span><span class="info-value">${escapeHtml(normalizePhone(office.phone) || "전화번호 정보 없음")}</span></div>
        <div class="info-row"><span class="info-label">상태</span><span class="info-badge ${category}">${escapeHtml(office.status || "상태 미상")}</span></div>
      </div>
    `;
  }, []);

  const getMarkerImage = useCallback((category: StatusCategory) => {
    if (!window.kakao) {
      return undefined;
    }

    if (!markerImagesRef.current[category]) {
      markerImagesRef.current[category] = new window.kakao.maps.MarkerImage(
        `data:image/svg+xml;charset=UTF-8,${getMarkerSvg(getMarkerColor(category))}`,
        new window.kakao.maps.Size(34, 42),
      );
    }

    return markerImagesRef.current[category] as ConstructorParameters<
      typeof window.kakao.maps.Marker
    >[0]["image"];
  }, []);

  const getCheckpointMarkerImage = useCallback(() => {
    if (!window.kakao) {
      return undefined;
    }

    if (!checkpointMarkerImageRef.current) {
      checkpointMarkerImageRef.current = new window.kakao.maps.MarkerImage(
        `data:image/svg+xml;charset=UTF-8,${getCheckpointMarkerSvg()}`,
        new window.kakao.maps.Size(36, 44),
      );
    }

    return checkpointMarkerImageRef.current;
  }, []);

  const getHeavyFactoryMarkerImage = useCallback((heavyClass: string) => {
    if (!window.kakao) {
      return undefined;
    }

    const variant = heavyClass === "고중량 후보 강" ? "certain" : "possible";
    const color = variant === "certain" ? "#7f1d1d" : "#f97316";
    if (!heavyFactoryMarkerImagesRef.current[variant]) {
      heavyFactoryMarkerImagesRef.current[variant] = new window.kakao.maps.MarkerImage(
        `data:image/svg+xml;charset=UTF-8,${getHeavyFactoryMarkerSvg(color)}`,
        new window.kakao.maps.Size(36, 44),
      );
    }

    return heavyFactoryMarkerImagesRef.current[variant];
  }, []);

  const getWarehouseMarkerImage = useCallback((office: MapOffice) => {
    if (!window.kakao) {
      return undefined;
    }
    const scale = office.is_mega ? 1.25 : 1;
    const color =
      office.warehouse_size_class === "대형"
        ? "#be123c"
        : office.warehouse_size_class === "중형"
          ? "#ea580c"
          : "#2563eb";
    return new window.kakao.maps.MarkerImage(
      `data:image/svg+xml;charset=UTF-8,${getWarehouseMarkerSvg(color, scale)}`,
      new window.kakao.maps.Size(Math.round(34 * scale), Math.round(42 * scale)),
    );
  }, []);

  const getTruckAccidentMarkerImage = useCallback(() => {
    if (!window.kakao) {
      return undefined;
    }
    if (!truckAccidentMarkerImageRef.current) {
      truckAccidentMarkerImageRef.current = new window.kakao.maps.MarkerImage(
        `data:image/svg+xml;charset=UTF-8,${getTruckAccidentMarkerSvg()}`,
        new window.kakao.maps.Size(36, 44),
      );
    }
    return truckAccidentMarkerImageRef.current;
  }, []);

  const getOverlayMarkerImage = useCallback((layerId: OverlayMarkerLayerId, color: string) => {
    if (!window.kakao) {
      return undefined;
    }
    if (!overlayMarkerImagesRef.current[layerId]) {
      overlayMarkerImagesRef.current[layerId] = new window.kakao.maps.MarkerImage(
        `data:image/svg+xml;charset=UTF-8,${overlayMarkerImageSvg(color)}`,
        new window.kakao.maps.Size(32, 40),
      );
    }
    return overlayMarkerImagesRef.current[layerId];
  }, []);

  const clearCheckpointMarkers = useCallback(() => {
    checkpointMarkersRef.current.forEach((marker) => marker.setMap(null));
    checkpointMarkersRef.current = [];
  }, []);

  const clearHeavyFactoryMarkers = useCallback(() => {
    heavyFactoryClustererRef.current?.clear();
    heavyFactoryMarkersRef.current.forEach((marker) => marker.setMap(null));
    heavyFactoryMarkersRef.current = [];
    heavyFactoryClustererRef.current = null;
  }, []);

  const clearPortAreaPolygons = useCallback(() => {
    portAreaPolygonsRef.current.forEach((polygon) => polygon.setMap(null));
    portAreaPolygonsRef.current = [];
  }, []);

  const clearIndustrialComplexPolygons = useCallback(() => {
    industrialComplexPolygonsRef.current.forEach((polygon) => polygon.setMap(null));
    industrialComplexPolygonsRef.current = [];
  }, []);

  const clearTruckAccidentPolygons = useCallback(() => {
    truckAccidentPolygonsRef.current.forEach((polygon) => polygon.setMap(null));
    truckAccidentPolygonsRef.current = [];
  }, []);

  const clearOverlayMarkerLayer = useCallback((layerId: OverlayMarkerLayerId) => {
    const layer = overlayMarkerLayersRef.current.get(layerId);
    layer?.clusterer?.clear();
    layer?.markers.forEach((marker) => marker.setMap(null));
    overlayMarkerLayersRef.current.delete(layerId);
  }, []);

  const selectOffice = useCallback(
    (
      office: MapOffice,
      options: { panMap?: boolean; scrollList?: boolean; fromMarker?: boolean } = {},
    ) => {
      const map = mapRef.current;
      const marker = markerByIdRef.current.get(office.id);
      if (!map || !window.kakao || !marker) {
        return;
      }

      setSelectedOfficeId(office.id);

      if (options.fromMarker) {
        suppressNextMapClickRef.current = true;
        window.setTimeout(() => {
          suppressNextMapClickRef.current = false;
        }, 0);
      }

      const position = new window.kakao.maps.LatLng(office.latitude, office.longitude);
      if (options.panMap) {
        if (map.getLevel() > 5) {
          map.setLevel(5);
        }
        map.panTo(position);
      }

      closeInfoWindow();
      const infoWindow = new window.kakao.maps.InfoWindow({
        content: createInfoWindowContent(office),
        removable: true,
      });
      infoWindow.open(map, marker);
      infoWindowRef.current = infoWindow;

      if (options.scrollList) {
        officeRefs.current.get(office.id)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    },
    [closeInfoWindow, createInfoWindowContent],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    fetch(dataUrl)
      .then((response) => {
        if (!response.ok) {
          return [];
        }
        return response.json() as Promise<T[]>;
      })
      .then((data) => {
        if (cancelled) {
          return;
        }
        const items = Array.isArray(data) ? data : [];
        setOffices(
          items
            .map((item, index) => normalizeItem(item, index))
            .filter((item): item is MapOffice => Boolean(item?.longitude && item?.latitude)),
        );
      })
      .catch((exc: Error) => {
        if (!cancelled) {
          setError(exc.message);
          setOffices([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dataUrl, normalizeItem]);

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
          const center = new window.kakao.maps.LatLng(
            DEFAULT_CENTER.latitude,
            DEFAULT_CENTER.longitude,
          );
          mapRef.current = new window.kakao.maps.Map(mapNodeRef.current, {
            center,
            level: 13,
          });
          window.kakao.maps.event.addListener(mapRef.current, "click", () => {
            if (suppressNextMapClickRef.current) {
              suppressNextMapClickRef.current = false;
              return;
            }
            closeInfoWindow();
            setSelectedOfficeId(null);
          });
          setMapReady(true);
        });
      })
      .catch((exc: Error) => setMapError(exc.message));

    return () => {
      cancelled = true;
    };
  }, [closeInfoWindow, kakaoKey]);

  useEffect(() => {
    if (markerVariant !== "truck-accident") {
      return;
    }
    let cancelled = false;
    fetch(getDataUrl("truck-accident-hotspots.geojson"))
      .then((response) => {
        if (!response.ok) {
          throw new Error("화물차 사고다발지역 폴리곤 데이터를 불러오지 못했습니다.");
        }
        return response.json() as Promise<PortAreaFeatureCollection>;
      })
      .then((geojson) => {
        if (!cancelled) {
          setTruckAccidentGeoJson(geojson);
        }
      })
      .catch((exc: Error) => {
        if (!cancelled) {
          setError(exc.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [markerVariant]);

  const toggleCheckpoints = useCallback(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !window.kakao) {
      return;
    }

    if (checkpointsVisible) {
      clearCheckpointMarkers();
      closeInfoWindow();
      setCheckpointsVisible(false);
      return;
    }

    setCheckpointsLoading(true);
    setCheckpointsError("");
    fetch(getDataUrl("overload-checkpoints.json"))
      .then((response) => {
        if (!response.ok) {
          throw new Error("과적검문소 데이터를 불러오지 못했습니다.");
        }
        return response.json() as Promise<OverloadCheckpoint[]>;
      })
      .then((data) => {
        const items = Array.isArray(data) ? data : [];
        const validCheckpoints = items.filter(
          (item) => typeof item.latitude === "number" && typeof item.longitude === "number",
        );

        clearCheckpointMarkers();
        const nextMarkers = validCheckpoints.map((checkpoint) => {
          const position = new window.kakao!.maps.LatLng(
            checkpoint.latitude as number,
            checkpoint.longitude as number,
          );
          const marker = new window.kakao!.maps.Marker({
            map,
            position,
            title: checkpoint.business_name || "과적검문소",
            image: getCheckpointMarkerImage(),
          });

          window.kakao!.maps.event.addListener(marker, "click", () => {
            suppressNextMapClickRef.current = true;
            window.setTimeout(() => {
              suppressNextMapClickRef.current = false;
            }, 0);
            closeInfoWindow();
            const infoWindow = new window.kakao!.maps.InfoWindow({
              content: createCheckpointInfoWindowContent(checkpoint),
              removable: true,
            });
            infoWindow.open(map, marker);
            infoWindowRef.current = infoWindow;
          });

          return marker;
        });

        checkpointMarkersRef.current = nextMarkers;
        setCheckpointsVisible(true);
      })
      .catch((exc: Error) => {
        clearCheckpointMarkers();
        setCheckpointsVisible(false);
        setCheckpointsError(exc.message);
      })
      .finally(() => setCheckpointsLoading(false));
  }, [
    checkpointsVisible,
    clearCheckpointMarkers,
    closeInfoWindow,
    createCheckpointInfoWindowContent,
    getCheckpointMarkerImage,
    mapReady,
  ]);

  const toggleOverlayMarkerLayer = useCallback(
    (layerConfig: (typeof OVERLAY_MARKER_LAYERS)[number]) => {
      const map = mapRef.current;
      if (!mapReady || !map || !window.kakao) {
        return;
      }

      if (overlayLayerVisible[layerConfig.id]) {
        clearOverlayMarkerLayer(layerConfig.id);
        closeInfoWindow();
        setOverlayLayerVisible((prev) => ({ ...prev, [layerConfig.id]: false }));
        return;
      }

      setOverlayLayerLoading((prev) => ({ ...prev, [layerConfig.id]: true }));
      setOverlayLayerError((prev) => ({ ...prev, [layerConfig.id]: "" }));
      fetch(getDataUrl(layerConfig.dataFile))
        .then((response) => {
          if (!response.ok) {
            throw new Error(`${layerConfig.label} 데이터를 불러오지 못했습니다.`);
          }
          return response.json() as Promise<Array<ScaleOffice | HighwayTollOffice | RestArea | AccidentHotspot | LogisticsWarehouse>>;
        })
        .then((data) => {
          const offices = (Array.isArray(data) ? data : [])
            .map((item, index) => overlayLayerItemToOffice(layerConfig.id, item, index))
            .filter((item): item is MapOffice => Boolean(item));

          clearOverlayMarkerLayer(layerConfig.id);
          const clusterer = new window.kakao!.maps.MarkerClusterer({
            map,
            averageCenter: true,
            minLevel: 7,
            disableClickZoom: false,
          });
          const markers = offices.map((office) => {
            const marker = new window.kakao!.maps.Marker({
              position: new window.kakao!.maps.LatLng(office.latitude, office.longitude),
              title: office.business_name,
              image:
                layerConfig.id === "logistics-warehouses"
                  ? getWarehouseMarkerImage(office)
                  : getOverlayMarkerImage(layerConfig.id, layerConfig.color),
            });

            window.kakao!.maps.event.addListener(marker, "click", () => {
              suppressNextMapClickRef.current = true;
              window.setTimeout(() => {
                suppressNextMapClickRef.current = false;
              }, 0);
              closeInfoWindow();
              const infoWindow = new window.kakao!.maps.InfoWindow({
                content: createOverlayInfoWindowContent(layerConfig.label, office),
                removable: true,
              });
              infoWindow.open(map, marker);
              infoWindowRef.current = infoWindow;
            });
            return marker;
          });

          clusterer.addMarkers(markers);
          overlayMarkerLayersRef.current.set(layerConfig.id, { markers, clusterer });
          setOverlayLayerVisible((prev) => ({ ...prev, [layerConfig.id]: true }));
        })
        .catch((exc: Error) => {
          clearOverlayMarkerLayer(layerConfig.id);
          setOverlayLayerVisible((prev) => ({ ...prev, [layerConfig.id]: false }));
          setOverlayLayerError((prev) => ({ ...prev, [layerConfig.id]: exc.message }));
        })
        .finally(() => {
          setOverlayLayerLoading((prev) => ({ ...prev, [layerConfig.id]: false }));
        });
    },
    [
      clearOverlayMarkerLayer,
      closeInfoWindow,
      createOverlayInfoWindowContent,
      getOverlayMarkerImage,
      getWarehouseMarkerImage,
      mapReady,
      overlayLayerVisible,
    ],
  );

  const toggleHeavyFactories = useCallback(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !window.kakao) {
      return;
    }

    if (heavyFactoriesVisible) {
      clearHeavyFactoryMarkers();
      closeInfoWindow();
      setHeavyFactoriesVisible(false);
      return;
    }

    setHeavyFactoriesLoading(true);
    setHeavyFactoriesError("");
    fetch(getDataUrl("heavy-factories.json"))
      .then((response) => {
        if (!response.ok) {
          throw new Error("고중량 공장 데이터를 불러오지 못했습니다.");
        }
        return response.json() as Promise<HeavyFactory[]>;
      })
      .then((data) => {
        const factories = (Array.isArray(data) ? data : []).filter(
          (factory) =>
            factory.map_include &&
            (factory.heavy_class === "고중량 후보 강" || factory.heavy_class === "고중량 후보 중") &&
            (heavyFactoryClassFilter === ALL || factory.heavy_class === heavyFactoryClassFilter) &&
            typeof factory.latitude === "number" &&
            typeof factory.longitude === "number",
        );

        clearHeavyFactoryMarkers();
        const clusterer = new window.kakao!.maps.MarkerClusterer({
          map,
          averageCenter: true,
          minLevel: 7,
          disableClickZoom: false,
        });
        const nextMarkers = factories.map((factory) => {
          const position = new window.kakao!.maps.LatLng(
            factory.latitude as number,
            factory.longitude as number,
          );
          const marker = new window.kakao!.maps.Marker({
            position,
            title: factory.company_name || "고중량 공장",
            image: getHeavyFactoryMarkerImage(factory.heavy_class),
          });

          window.kakao!.maps.event.addListener(marker, "click", () => {
            suppressNextMapClickRef.current = true;
            window.setTimeout(() => {
              suppressNextMapClickRef.current = false;
            }, 0);
            closeInfoWindow();
            const infoWindow = new window.kakao!.maps.InfoWindow({
              content: createHeavyFactoryInfoWindowContent(factory),
              removable: true,
            });
            infoWindow.open(map, marker);
            infoWindowRef.current = infoWindow;
          });

          return marker;
        });

        clusterer.addMarkers(nextMarkers);
        heavyFactoryClustererRef.current = clusterer;
        heavyFactoryMarkersRef.current = nextMarkers;
        setHeavyFactoriesVisible(true);
      })
      .catch((exc: Error) => {
        clearHeavyFactoryMarkers();
        setHeavyFactoriesVisible(false);
        setHeavyFactoriesError(exc.message);
      })
      .finally(() => setHeavyFactoriesLoading(false));
  }, [
    clearHeavyFactoryMarkers,
    closeInfoWindow,
    createHeavyFactoryInfoWindowContent,
    getHeavyFactoryMarkerImage,
    heavyFactoryClassFilter,
    heavyFactoriesVisible,
    mapReady,
  ]);

  const togglePortAreas = useCallback(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !window.kakao) {
      return;
    }

    if (portAreasVisible) {
      clearPortAreaPolygons();
      closeInfoWindow();
      setPortAreasVisible(false);
      return;
    }

    setPortAreasLoading(true);
    setPortAreasError("");
    fetch(getDataUrl("port-areas.geojson"))
      .then((response) => {
        if (!response.ok) {
          throw new Error("항만구역 데이터를 불러오지 못했습니다.");
        }
        return response.json() as Promise<PortAreaFeatureCollection>;
      })
      .then((geojson) => {
        const features = Array.isArray(geojson.features) ? geojson.features : [];
        const nextPolygons: KakaoPolygon[] = [];

        features.forEach((feature) => {
          polygonCoordinateSets(feature).forEach((polygonCoordinates) => {
            const paths = polygonCoordinates
              .map((ring) =>
                ring
                  .filter(isGeoJsonPosition)
                  .map(([longitude, latitude]) => new window.kakao!.maps.LatLng(latitude, longitude)),
              )
              .filter((path) => path.length >= 3);

            if (!paths.length) {
              return;
            }

            const polygon = new window.kakao!.maps.Polygon({
              map,
              path: paths.length === 1 ? paths[0] : paths,
              strokeWeight: 2,
              strokeColor: "#0f766e",
              strokeOpacity: 0.9,
              strokeStyle: "solid",
              fillColor: "#14b8a6",
              fillOpacity: 0.22,
            });

            window.kakao!.maps.event.addListener(polygon, "click", (event) => {
              suppressNextMapClickRef.current = true;
              window.setTimeout(() => {
                suppressNextMapClickRef.current = false;
              }, 0);
              closeInfoWindow();
              const infoWindow = new window.kakao!.maps.InfoWindow({
                content: createPortAreaInfoWindowContent(feature.properties || {}),
                position: event.latLng,
                removable: true,
              });
              infoWindow.open(map);
              infoWindowRef.current = infoWindow;
            });

            nextPolygons.push(polygon);
          });
        });

        clearPortAreaPolygons();
        portAreaPolygonsRef.current = nextPolygons;
        setPortAreasVisible(true);
      })
      .catch((exc: Error) => {
        clearPortAreaPolygons();
        setPortAreasVisible(false);
        setPortAreasError(exc.message);
      })
      .finally(() => setPortAreasLoading(false));
  }, [
    clearPortAreaPolygons,
    closeInfoWindow,
    createPortAreaInfoWindowContent,
    mapReady,
    portAreasVisible,
  ]);

  const toggleIndustrialComplexes = useCallback(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !window.kakao) {
      return;
    }

    if (industrialComplexesVisible) {
      clearIndustrialComplexPolygons();
      closeInfoWindow();
      setIndustrialComplexesVisible(false);
      return;
    }

    setIndustrialComplexesLoading(true);
    setIndustrialComplexesError("");
    fetch(getDataUrl("industrial-complex-boundaries.geojson"))
      .then((response) => {
        if (!response.ok) {
          throw new Error("산업단지 경계 데이터를 불러오지 못했습니다.");
        }
        return response.json() as Promise<PortAreaFeatureCollection>;
      })
      .then((geojson) => {
        const features = Array.isArray(geojson.features) ? geojson.features : [];
        const nextPolygons: KakaoPolygon[] = [];

        features
          .filter((feature) => {
            const typeName = String(feature.properties?.complex_type_name || "");
            return industrialComplexTypeFilter === ALL || typeName === industrialComplexTypeFilter;
          })
          .forEach((feature) => {
            const typeName = String(feature.properties?.complex_type_name || "");
            const style = industrialComplexStyle(typeName);
            polygonCoordinateSets(feature).forEach((polygonCoordinates) => {
              const paths = polygonCoordinates
                .map((ring) =>
                  ring
                    .filter(isGeoJsonPosition)
                    .map(([longitude, latitude]) => new window.kakao!.maps.LatLng(latitude, longitude)),
                )
                .filter((path) => path.length >= 3);

              if (!paths.length) {
                return;
              }

              const polygon = new window.kakao!.maps.Polygon({
                map,
                path: paths.length === 1 ? paths[0] : paths,
                strokeWeight: 2,
                strokeColor: style.strokeColor,
                strokeOpacity: 0.86,
                strokeStyle: "solid",
                fillColor: style.fillColor,
                fillOpacity: 0.18,
              });

              window.kakao!.maps.event.addListener(polygon, "click", (event) => {
                suppressNextMapClickRef.current = true;
                window.setTimeout(() => {
                  suppressNextMapClickRef.current = false;
                }, 0);
                closeInfoWindow();
                const infoWindow = new window.kakao!.maps.InfoWindow({
                  content: createIndustrialComplexInfoWindowContent(feature.properties || {}),
                  position: event.latLng,
                  removable: true,
                });
                infoWindow.open(map);
                infoWindowRef.current = infoWindow;
              });

              nextPolygons.push(polygon);
            });
          });

        clearIndustrialComplexPolygons();
        industrialComplexPolygonsRef.current = nextPolygons;
        setIndustrialComplexesVisible(true);
      })
      .catch((exc: Error) => {
        clearIndustrialComplexPolygons();
        setIndustrialComplexesVisible(false);
        setIndustrialComplexesError(exc.message);
      })
      .finally(() => setIndustrialComplexesLoading(false));
  }, [
    clearIndustrialComplexPolygons,
    closeInfoWindow,
    createIndustrialComplexInfoWindowContent,
    industrialComplexesVisible,
    industrialComplexTypeFilter,
    mapReady,
  ]);

  const sidoOptions = useMemo(() => {
    const values = offices.map((office) => office.sido).filter(Boolean);
    return [ALL, ...Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "ko"))];
  }, [offices]);

  const statusOptions = useMemo(() => {
    const values = offices.map((office) => office.status || "상태 미상");
    return [ALL, ...Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "ko"))];
  }, [offices]);

  const filteredOffices = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return offices.filter((office) => {
      if (markerVariant === "warehouse") {
        if (warehouseSizeFilter === "초대형" && !office.is_mega) {
          return false;
        }
        if (
          warehouseSizeFilter !== ALL &&
          warehouseSizeFilter !== "초대형" &&
          office.warehouse_size_class !== warehouseSizeFilter
        ) {
          return false;
        }
        if (
          warehouseSizeFilter === ALL &&
          !office.is_mega &&
          office.warehouse_size_class !== "대형" &&
          office.warehouse_size_class !== "중형" &&
          office.warehouse_size_class !== "소형"
        ) {
          return false;
        }
      }
      if (markerVariant === "truck-accident") {
        const accidentCount = office.accident_count ?? 0;
        const deathCount = office.death_count ?? 0;
        const seriousInjuryCount = office.serious_injury_count ?? 0;
        if (truckAccidentCountFilter === "4건 이상" && accidentCount < 4) {
          return false;
        }
        if (truckAccidentCountFilter === "5건 이상" && accidentCount < 5) {
          return false;
        }
        if (truckAccidentCountFilter === "7건 이상" && accidentCount < 7) {
          return false;
        }
        if (truckAccidentCountFilter === "10건 이상" && accidentCount < 10) {
          return false;
        }
        if (truckDeathCountFilter === "사망자 있음" && deathCount < 1) {
          return false;
        }
        if (truckDeathCountFilter === "사망자 2명 이상" && deathCount < 2) {
          return false;
        }
        if (truckSeriousInjuryFilter === "중상자 5명 이상" && seriousInjuryCount < 5) {
          return false;
        }
        if (truckSeriousInjuryFilter === "중상자 10명 이상" && seriousInjuryCount < 10) {
          return false;
        }
      }
      const statusValue = office.status || "상태 미상";
      const text = [
        office.business_name,
        office.status,
        office.phone,
        office.address,
        office.road_address,
        office.sido,
        office.sigungu,
        office.search_text,
      ]
        .join(" ")
        .toLowerCase();

      return (
        (!keyword || text.includes(keyword)) &&
        (sido === ALL || office.sido === sido) &&
        (status === ALL || statusValue === status)
      );
    });
  }, [
    markerVariant,
    offices,
    query,
    sido,
    status,
    truckAccidentCountFilter,
    truckDeathCountFilter,
    truckSeriousInjuryFilter,
    warehouseSizeFilter,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !window.kakao) {
      return;
    }

    markersRef.current.forEach((marker) => marker.setMap(null));
    clustererRef.current?.clear();
    markersRef.current = [];
    markerByIdRef.current.clear();
    infoWindowRef.current?.close();
    infoWindowRef.current = null;

    if (filteredOffices.length === 0) {
      setSelectedOfficeId(null);
      return;
    }

    const clusterer = new window.kakao.maps.MarkerClusterer({
      map,
      averageCenter: true,
      minLevel: 7,
      disableClickZoom: false,
    });
    const bounds = new window.kakao.maps.LatLngBounds();
    const nextMarkers = filteredOffices.map((office) => {
      const position = new window.kakao!.maps.LatLng(office.latitude, office.longitude);
      bounds.extend(position);

      const marker = new window.kakao!.maps.Marker({
        position,
        title: office.business_name,
        image:
          markerVariant === "checkpoint"
            ? getCheckpointMarkerImage()
            : markerVariant === "warehouse"
              ? getWarehouseMarkerImage(office)
              : markerVariant === "truck-accident"
                ? getTruckAccidentMarkerImage()
              : getMarkerImage(getStatusCategory(office.status)),
      });
      markerByIdRef.current.set(office.id, marker);

      window.kakao!.maps.event.addListener(marker, "click", () => {
        selectOffice(office, { scrollList: true, fromMarker: true });
      });

      return marker;
    });

    clusterer.addMarkers(nextMarkers);
    clustererRef.current = clusterer;
    if (filteredOffices.length === 1) {
      map.setCenter(
        new window.kakao.maps.LatLng(filteredOffices[0].latitude, filteredOffices[0].longitude),
      );
    } else {
      map.setBounds(bounds);
    }
    markersRef.current = nextMarkers;
  }, [
    filteredOffices,
    getCheckpointMarkerImage,
    getMarkerImage,
    getTruckAccidentMarkerImage,
    getWarehouseMarkerImage,
    mapReady,
    markerVariant,
    selectOffice,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (markerVariant !== "truck-accident" || !mapReady || !map || !window.kakao || !truckAccidentGeoJson) {
      return;
    }

    clearTruckAccidentPolygons();
    const visibleIds = new Set(filteredOffices.map((office) => office.id));
    const nextPolygons: KakaoPolygon[] = [];
    const features = Array.isArray(truckAccidentGeoJson.features) ? truckAccidentGeoJson.features : [];

    features
      .filter((feature) => visibleIds.has(String(feature.properties?.id || "")))
      .forEach((feature) => {
        polygonCoordinateSets(feature).forEach((polygonCoordinates) => {
          const paths = polygonCoordinates
            .map((ring) =>
              ring
                .filter(isGeoJsonPosition)
                .map(([longitude, latitude]) => new window.kakao!.maps.LatLng(latitude, longitude)),
            )
            .filter((path) => path.length >= 3);

          if (!paths.length) {
            return;
          }

          const polygon = new window.kakao!.maps.Polygon({
            map,
            path: paths.length === 1 ? paths[0] : paths,
            strokeWeight: 2,
            strokeColor: "#991b1b",
            strokeOpacity: 0.9,
            strokeStyle: "solid",
            fillColor: "#ef4444",
            fillOpacity: 0.2,
          });

          window.kakao!.maps.event.addListener(polygon, "click", (event) => {
            suppressNextMapClickRef.current = true;
            window.setTimeout(() => {
              suppressNextMapClickRef.current = false;
            }, 0);
            closeInfoWindow();
            const infoWindow = new window.kakao!.maps.InfoWindow({
              content: createTruckAccidentInfoWindowContent(feature.properties || {}),
              position: event.latLng,
              removable: true,
            });
            infoWindow.open(map);
            infoWindowRef.current = infoWindow;
          });

          nextPolygons.push(polygon);
        });
      });

    truckAccidentPolygonsRef.current = nextPolygons;

    return () => {
      clearTruckAccidentPolygons();
    };
  }, [
    clearTruckAccidentPolygons,
    closeInfoWindow,
    createTruckAccidentInfoWindowContent,
    filteredOffices,
    mapReady,
    markerVariant,
    truckAccidentGeoJson,
  ]);

  useEffect(() => {
    if (
      selectedOfficeId &&
      !filteredOffices.some((office) => office.id === selectedOfficeId)
    ) {
      closeInfoWindow();
      setSelectedOfficeId(null);
    }
  }, [closeInfoWindow, filteredOffices, selectedOfficeId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !window.kakao) {
      return;
    }

    map.setMapTypeId(
      mapViewType === "skyview"
        ? window.kakao.maps.MapTypeId.SKYVIEW
        : window.kakao.maps.MapTypeId.ROADMAP,
    );
  }, [mapReady, mapViewType]);

  const visibleCount = filteredOffices.length.toLocaleString("ko-KR");
  const totalCount = offices.length.toLocaleString("ko-KR");
  const showEmptyMessage = !loading && !error && offices.length === 0;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="home-link" href="#/">
          <ArrowLeft size={17} aria-hidden="true" />
          처음으로
        </a>

        <div className="brand-block">
          <div className="brand-icon" aria-hidden="true">
            <MapPin size={24} />
          </div>
          <div>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
        </div>

        <section className="controls" aria-label="검색 및 필터">
          <label className="search-box">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
            />
          </label>

          <label>
            시도
            <select value={sido} onChange={(event) => setSido(event.target.value)}>
              {sidoOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label>
            상태
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          {markerVariant === "warehouse" && (
            <label>
              창고 규모
              <select value={warehouseSizeFilter} onChange={(event) => setWarehouseSizeFilter(event.target.value)}>
                {WAREHOUSE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          )}

          {markerVariant === "truck-accident" && (
            <>
              <label>
                사고건수
                <select
                  value={truckAccidentCountFilter}
                  onChange={(event) => setTruckAccidentCountFilter(event.target.value)}
                >
                  {TRUCK_ACCIDENT_COUNT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                사망자수
                <select
                  value={truckDeathCountFilter}
                  onChange={(event) => setTruckDeathCountFilter(event.target.value)}
                >
                  {TRUCK_DEATH_COUNT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                중상자수
                <select
                  value={truckSeriousInjuryFilter}
                  onChange={(event) => setTruckSeriousInjuryFilter(event.target.value)}
                >
                  {TRUCK_SERIOUS_INJURY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </section>

        <section className="layer-controls" aria-label="지도 레이어">
          <div className="layer-controls-heading">
            <strong>지도 레이어</strong>
            <span>필요한 레이어만 켜고 끕니다.</span>
          </div>
          <div className="layer-chip-grid">
          {showCheckpointToggle && (
            <button
              className={checkpointsVisible ? "layer-chip checkpoint active" : "layer-chip checkpoint"}
              type="button"
              disabled={!mapReady || checkpointsLoading}
              onClick={toggleCheckpoints}
            >
              {checkpointsLoading
                ? "과적검문소 로딩"
                : checkpointsVisible
                  ? "과적검문소 숨김"
                  : "과적검문소 표시"}
            </button>
          )}

          {OVERLAY_MARKER_LAYERS.filter((layer) => layer.id !== currentLayer).map((layer) => (
              <button
                className={overlayLayerVisible[layer.id] ? "layer-chip active" : "layer-chip"}
                style={{ "--layer-color": layer.color } as CSSProperties}
                type="button"
                disabled={!mapReady || Boolean(overlayLayerLoading[layer.id])}
                onClick={() => toggleOverlayMarkerLayer(layer)}
              >
                {overlayLayerLoading[layer.id]
                  ? `${layer.label} 로딩`
                  : overlayLayerVisible[layer.id]
                    ? `${layer.label} 숨김`
                    : `${layer.label} 표시`}
              </button>
          ))}

          <div className="layer-chip-with-filter">
            <label>
              고중량
              <select
                value={heavyFactoryClassFilter}
                onChange={(event) => {
                  setHeavyFactoryClassFilter(event.target.value);
                  if (heavyFactoriesVisible) {
                    clearHeavyFactoryMarkers();
                    closeInfoWindow();
                    setHeavyFactoriesVisible(false);
                  }
                }}
              >
                {HEAVY_FACTORY_CLASS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={
                heavyFactoriesVisible ? "layer-chip heavy active" : "layer-chip heavy"
              }
              type="button"
              disabled={!mapReady || heavyFactoriesLoading}
              onClick={toggleHeavyFactories}
            >
              {heavyFactoriesLoading
                ? "고중량 공장 로딩"
                : heavyFactoriesVisible
                  ? "고중량 공장 숨김"
                  : "고중량 공장 표시"}
            </button>
          </div>

            <button
              className={portAreasVisible ? "layer-chip port active" : "layer-chip port"}
              type="button"
              disabled={!mapReady || portAreasLoading}
              onClick={togglePortAreas}
            >
              {portAreasLoading
                ? "항만구역 로딩"
                : portAreasVisible
                  ? "항만구역 숨김"
                  : "항만구역 표시"}
            </button>

          <div className="layer-chip-with-filter">
            <label>
              산업단지
              <select
                value={industrialComplexTypeFilter}
                onChange={(event) => {
                  setIndustrialComplexTypeFilter(event.target.value);
                  if (industrialComplexesVisible) {
                    clearIndustrialComplexPolygons();
                    closeInfoWindow();
                    setIndustrialComplexesVisible(false);
                  }
                }}
              >
                {INDUSTRIAL_COMPLEX_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={
                industrialComplexesVisible
                  ? "layer-chip industrial active"
                  : "layer-chip industrial"
              }
              type="button"
              disabled={!mapReady || industrialComplexesLoading}
              onClick={toggleIndustrialComplexes}
            >
              {industrialComplexesLoading
                ? "산업단지 경계 로딩"
                : industrialComplexesVisible
                  ? "산업단지 경계 숨김"
                  : "산업단지 경계 표시"}
            </button>
          </div>
          </div>
          {[
            checkpointsError,
            ...Object.values(overlayLayerError),
            heavyFactoriesError,
            portAreasError,
            industrialComplexesError,
          ]
            .filter(Boolean)
            .map((message) => (
              <span className="layer-error" key={message}>
                {message}
              </span>
            ))}
        </section>

        <div className="result-summary">
          <strong>{visibleCount}</strong>
          <span>/ {totalCount}개 표시</span>
        </div>

        <section className="office-list" aria-label={`${title} 목록`}>
          {loading && <p className="status-text">데이터를 불러오는 중입니다.</p>}
          {error && <p className="status-text error">{error}</p>}
          {showEmptyMessage && <p className="status-text">{emptyMessage}</p>}
          {!loading && !error && offices.length > 0 && filteredOffices.length === 0 && (
            <p className="status-text">조건에 맞는 항목이 없습니다.</p>
          )}
          {filteredOffices.map((office) => (
            <article
              className={[
                "office-card",
                getStatusCategory(office.status),
                selectedOfficeId === office.id ? "selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={office.id}
              ref={(node) => {
                if (node) {
                  officeRefs.current.set(office.id, node);
                } else {
                  officeRefs.current.delete(office.id);
                }
              }}
              role="button"
              tabIndex={0}
              onClick={() => selectOffice(office, { panMap: true })}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectOffice(office, { panMap: true });
                }
              }}
            >
              <h2>{office.business_name || "이름 없음"}</h2>
              <p>{getAddress(office)}</p>
              <div className="office-meta">
                <span className={`status-chip ${getStatusCategory(office.status)}`}>
                  {office.status || "상태 미상"}
                </span>
                {office.phone && (
                  <span className="phone">
                    <Phone size={14} aria-hidden="true" />
                    {normalizePhone(office.phone)}
                  </span>
                )}
              </div>
            </article>
          ))}
        </section>
      </aside>

      <section className="map-panel" aria-label="카카오 지도">
        {mapReady && (
          <div className="map-type-control" aria-label="지도 보기 방식">
            <button
              className={mapViewType === "roadmap" ? "active" : ""}
              type="button"
              onClick={() => setMapViewType("roadmap")}
            >
              일반지도
            </button>
            <button
              className={mapViewType === "skyview" ? "active" : ""}
              type="button"
              onClick={() => setMapViewType("skyview")}
            >
              항공사진
            </button>
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
        {kakaoKey && !mapReady && !mapError && (
          <div className="map-overlay">
            <strong>지도를 불러오는 중입니다.</strong>
            <span>계속 흰 화면이면 카카오 앱 키의 Web 도메인 등록을 확인하세요.</span>
          </div>
        )}
        <div ref={mapNodeRef} className="map-node" />
      </section>
    </main>
  );
}
