export interface ScaleOffice {
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
    MapTypeId: {
      ROADMAP: KakaoMapTypeId;
      SKYVIEW: KakaoMapTypeId;
    };
    event: {
      addListener: (target: KakaoMarker | KakaoMap, type: "click", handler: () => void) => void;
    };
  };
}

export interface KakaoLatLng {}

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
