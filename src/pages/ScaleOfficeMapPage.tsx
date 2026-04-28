import { useCallback } from "react";
import MapView from "../components/MapView";
import type { MapOffice, ScaleOffice } from "../types";

export default function ScaleOfficeMapPage() {
  const normalizeItem = useCallback((office: ScaleOffice): MapOffice | null => {
    if (!office.longitude || !office.latitude) {
      return null;
    }

    return {
      id: office.id,
      business_name: office.business_name,
      status: office.status,
      phone: office.phone,
      address: office.address,
      road_address: office.road_address,
      longitude: office.longitude,
      latitude: office.latitude,
      sido: office.sido,
      sigungu: office.sigungu,
    };
  }, []);

  return (
    <MapView
      title="전국 민간계량소 지도"
      description="CSV에서 변환한 정적 JSON 데이터를 카카오 지도에 표시합니다."
      dataUrl="/data/scale-offices.json"
      emptyMessage="민간계량소 지도 데이터 준비 중입니다."
      searchPlaceholder="사업장명, 주소, 전화번호 검색"
      normalizeItem={normalizeItem}
    />
  );
}
