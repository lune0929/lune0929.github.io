import { useCallback } from "react";
import MapView from "../components/MapView";
import type { HighwayTollOffice, MapOffice } from "../types";
import { getDataUrl } from "../utils/kakaoMap";

export default function HighwayTollOfficeMapPage() {
  const normalizeItem = useCallback((office: HighwayTollOffice, index: number): MapOffice | null => {
    if (!office.longitude || !office.latitude) {
      return null;
    }

    return {
      id: office.id || office.office_code || `highway-${index}`,
      business_name: office.office_name || "이름 없음",
      status: office.geocode_status?.startsWith("success")
        ? office.operation_type || "좌표확인"
        : "좌표 미확인",
      phone: office.phone || "",
      address: office.address || "",
      road_address: office.road_address || "",
      longitude: office.longitude,
      latitude: office.latitude,
      sido: office.sido || "",
      sigungu: office.sigungu || "",
      search_text: [office.route_name, office.office_code, office.entrance_exit_type, office.install_type]
        .filter(Boolean)
        .join(" "),
    };
  }, []);

  return (
    <MapView
      title="전국 영업소 지도"
      description="한국도로공사 영업소 위치정보를 정적 JSON 데이터로 표시합니다."
      dataUrl={getDataUrl("highway-toll-offices.json")}
      emptyMessage="전국 영업소 지도 데이터 준비 중입니다."
      searchPlaceholder="영업소명, 주소, 노선명 검색"
      normalizeItem={normalizeItem}
      currentLayer="highway-toll-offices"
    />
  );
}
