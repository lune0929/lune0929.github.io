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
        target: KakaoMarker | KakaoMap,
        type: "click",
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
}

export interface KakaoSize {}

export interface KakaoMarkerImage {}

export interface KakaoMapTypeId {}

export interface KakaoInfoWindowOptions {
  content: string;
  removable?: boolean;
}

export interface KakaoInfoWindow {
  open: (map: KakaoMap, marker: KakaoMarker) => void;
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
