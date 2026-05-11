export interface ScaleOffice {
  id: string;
  management_id?: string;
  business_name: string;
  normalized_name?: string;
  status: string;
  detail_status?: string;
  phone: string;
  office_phone?: string;
  address: string;
  road_address: string;
  longitude: number;
  latitude: number;
  sido: string;
  sigungu: string;
  coordinate_note?: string;
  manual_note?: string;
  geocode_status?: string;
  geocode_source?: string;
  source?: string;
}

export interface HighwayTollOffice {
  id: string;
  office_code: string;
  office_name: string;
  normalized_office_name?: string;
  search_name?: string;
  direction: string;
  route_name: string;
  sido: string;
  sigungu: string;
  address: string;
  road_address?: string;
  latitude: number | null;
  longitude: number | null;
  operation_type: string;
  entrance_exit_type: string;
  install_type: string;
  phone: string;
  source: string;
  geocode_status: string;
  geocode_source: string;
  geocode_query: string;
  coordinate_note?: string;
  manual_note?: string;
  tried_queries?: string[];
  fail_reason?: string;
  resolved?: boolean;
  [key: string]: unknown;
}

export interface HighwayFailedOffice {
  id?: string;
  office_code?: string;
  office_name?: string;
  search_name?: string;
  normalized_office_name?: string;
  route_name?: string;
  direction?: string;
  sido?: string;
  sigungu?: string;
  address?: string;
  road_address?: string;
  geocode_query?: string;
  tried_queries?: string[];
  fail_reason?: string;
  resolved?: boolean;
  [key: string]: unknown;
}

export interface OverloadCheckpoint {
  id: string;
  business_name: string;
  status: string;
  phone?: string;
  address: string;
  road_address: string;
  longitude: number | null;
  latitude: number | null;
  sido: string;
  sigungu: string;
  source?: string;
  geocode_status?: string;
}

export interface RestArea {
  id: string;
  rest_area_name: string;
  business_name: string;
  status: string;
  phone: string;
  address: string;
  road_address: string;
  longitude: number | null;
  latitude: number | null;
  sido: string;
  sigungu: string;
  road_type?: string;
  road_number?: string;
  route_name?: string;
  direction?: string;
  open_time?: string;
  close_time?: string;
  parking_spaces?: string;
  has_gas_station?: string;
  has_lpg?: string;
  has_ev_charger?: string;
  signature_food?: string;
  source?: string;
  data_date?: string;
  search_text?: string;
}

export interface AccidentHotspot {
  id: string;
  hotspot_id?: string;
  business_name: string;
  status: string;
  phone: string;
  address: string;
  road_address: string;
  longitude: number | null;
  latitude: number | null;
  sido: string;
  sigungu: string;
  accident_year?: string;
  location_code?: string;
  region_name?: string;
  accident_type?: string;
  accident_count?: string;
  casualty_count?: string;
  fatality_count?: string;
  serious_injury_count?: string;
  minor_injury_count?: string;
  reported_injury_count?: string;
  source?: string;
  data_date?: string;
  search_text?: string;
}

export interface TruckAccidentHotspot {
  id: string;
  hotspot_id: string;
  legal_dong_code: string;
  spot_code: string;
  region_name: string;
  spot_name: string;
  accident_count: number;
  casualty_count: number;
  death_count: number;
  serious_injury_count: number;
  minor_injury_count: number;
  reported_injury_count: number;
  longitude: number;
  latitude: number;
  source: string;
}

export interface HeavyFactory {
  id: string;
  company_name: string;
  product: string;
  factory_address: string;
  complex_name: string;
  heavy_class: "고중량 후보 강" | "고중량 후보 중" | "일반/저중량" | "확인 필요" | string;
  heavy_score: number;
  reason_keywords: string[];
  map_include: boolean;
  latitude: number | null;
  longitude: number | null;
  geocode_status: string;
  geocode_provider: string;
  matched_address: string;
  road_address: string;
  jibun_address: string;
}

export interface LogisticsWarehouse {
  id: string;
  business_name: string;
  status: string;
  road_address: string;
  jibun_address: string;
  total_warehouse_area: number;
  general_warehouse_area: number;
  cold_storage_area: number;
  storage_place_area: number;
  warehouse_size_class: "대형" | "중형" | "소형" | string;
  is_mega: boolean;
  business_storage: string;
  business_transport: string;
  latitude: number | null;
  longitude: number | null;
  source: string;
  coordinate_status: string;
}

export interface MapOffice {
  id: string;
  business_name: string;
  status: string;
  phone: string;
  address: string;
  road_address: string;
  longitude: number;
  latitude: number;
  sido: string;
  sigungu: string;
  search_text?: string;
  total_warehouse_area?: number;
  general_warehouse_area?: number;
  cold_storage_area?: number;
  storage_place_area?: number;
  warehouse_size_class?: string;
  is_mega?: boolean;
  business_storage?: string;
  business_transport?: string;
  accident_count?: number;
  casualty_count?: number;
  death_count?: number;
  serious_injury_count?: number;
  minor_injury_count?: number;
  reported_injury_count?: number;
  hotspot_id?: string;
  region_name?: string;
  spot_code?: string;
}

declare global {
  interface Window {
    kakao?: KakaoNamespace;
  }
}

export interface KakaoNamespace {
  maps: {
    load: (callback: () => void) => void;
    LatLng: new (latitude: number, longitude: number) => KakaoLatLng;
    Map: new (container: HTMLElement, options: KakaoMapOptions) => KakaoMap;
    Marker: new (options: KakaoMarkerOptions) => KakaoMarker;
    Polygon: new (options: KakaoPolygonOptions) => KakaoPolygon;
    MarkerImage: new (src: string, size: KakaoSize) => KakaoMarkerImage;
    InfoWindow: new (options: KakaoInfoWindowOptions) => KakaoInfoWindow;
    LatLngBounds: new () => KakaoLatLngBounds;
    Size: new (width: number, height: number) => KakaoSize;
    MarkerClusterer: new (options: KakaoMarkerClustererOptions) => KakaoMarkerClusterer;
    services?: {
      Geocoder: new () => KakaoGeocoder;
      Status: {
        OK: string;
      };
    };
    MapTypeId: {
      ROADMAP: KakaoMapTypeId;
      SKYVIEW: KakaoMapTypeId;
    };
    event: {
      addListener: (
        target: KakaoMarker | KakaoMap | KakaoPolygon,
        type: string,
        handler: (event: KakaoMouseEvent) => void,
      ) => void;
    };
  };
}

export interface KakaoLatLng {
  getLat: () => number;
  getLng: () => number;
}

export interface KakaoMouseEvent {
  latLng: KakaoLatLng;
}

export interface KakaoMapOptions {
  center: KakaoLatLng;
  level: number;
}

export interface KakaoMap {
  setCenter: (latLng: KakaoLatLng) => void;
  panTo: (latLng: KakaoLatLng) => void;
  setBounds: (bounds: KakaoLatLngBounds) => void;
  setLevel: (level: number) => void;
  getLevel: () => number;
  getCenter: () => KakaoLatLng;
  setMapTypeId: (mapTypeId: KakaoMapTypeId) => void;
}

export interface KakaoMarkerOptions {
  map?: KakaoMap | null;
  position: KakaoLatLng;
  title?: string;
  image?: KakaoMarkerImage;
}

export interface KakaoMarker {
  setMap: (map: KakaoMap | null) => void;
  setPosition?: (latLng: KakaoLatLng) => void;
  getPosition: () => KakaoLatLng;
  setDraggable: (draggable: boolean) => void;
}

export interface KakaoPolygonOptions {
  map?: KakaoMap | null;
  path?: KakaoLatLng[] | KakaoLatLng[][];
  strokeWeight?: number;
  strokeColor?: string;
  strokeOpacity?: number;
  strokeStyle?: string;
  fillColor?: string;
  fillOpacity?: number;
}

export interface KakaoPolygon {
  setMap: (map: KakaoMap | null) => void;
}

export interface KakaoSize {}

export interface KakaoMarkerImage {}

export interface KakaoMapTypeId {}

export interface KakaoInfoWindowOptions {
  content: string;
  removable?: boolean;
  position?: KakaoLatLng;
}

export interface KakaoInfoWindow {
  open: (map: KakaoMap, marker?: KakaoMarker) => void;
  close: () => void;
}

export interface KakaoLatLngBounds {
  extend: (latLng: KakaoLatLng) => void;
}

export interface KakaoMarkerClustererOptions {
  map: KakaoMap;
  averageCenter?: boolean;
  minLevel?: number;
  disableClickZoom?: boolean;
}

export interface KakaoMarkerClusterer {
  addMarkers: (markers: KakaoMarker[]) => void;
  clear: () => void;
}

export interface KakaoAddressResult {
  address?: {
    address_name?: string;
    region_1depth_name?: string;
    region_2depth_name?: string;
  };
  road_address?: {
    address_name?: string;
    region_1depth_name?: string;
    region_2depth_name?: string;
  };
}

export interface KakaoGeocoder {
  coord2Address: (
    longitude: number,
    latitude: number,
    callback: (result: KakaoAddressResult[], status: string) => void,
  ) => void;
}
