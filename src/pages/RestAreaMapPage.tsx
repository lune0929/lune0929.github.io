import { useCallback } from "react";
import MapView from "../components/MapView";
import type { MapOffice, RestArea } from "../types";
import { getDataUrl } from "../utils/kakaoMap";

export default function RestAreaMapPage() {
  const normalizeItem = useCallback((restArea: RestArea, index: number): MapOffice | null => {
    if (!restArea.longitude || !restArea.latitude) {
      return null;
    }

    return {
      id: restArea.id || `rest-area-${index + 1}`,
      business_name: restArea.business_name || restArea.rest_area_name || `휴게소 ${index + 1}`,
      status: restArea.status || "휴게소",
      phone: restArea.phone || "",
      address: restArea.address || [restArea.route_name, restArea.direction].filter(Boolean).join(" / "),
      road_address: restArea.road_address || "",
      longitude: restArea.longitude,
      latitude: restArea.latitude,
      sido: restArea.sido || "",
      sigungu: restArea.sigungu || "",
      search_text: [
        restArea.route_name,
        restArea.direction,
        restArea.road_number,
        restArea.road_type,
        restArea.signature_food,
        restArea.search_text,
      ]
        .filter(Boolean)
        .join(" "),
    };
  }, []);

  return (
    <MapView
      title="전국 휴게소 지도"
      description="전국 휴게소 표준데이터의 위경도 좌표를 카카오 지도에 표시합니다."
      dataUrl={getDataUrl("rest-areas.json")}
      emptyMessage="휴게소 지도 데이터 준비 중입니다."
      searchPlaceholder="휴게소명, 노선명, 대표음식 검색"
      normalizeItem={normalizeItem}
      currentLayer="rest-areas"
    />
  );
}
