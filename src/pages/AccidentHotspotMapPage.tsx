import { useCallback } from "react";
import MapView from "../components/MapView";
import type { AccidentHotspot, MapOffice } from "../types";
import { getDataUrl } from "../utils/kakaoMap";

export default function AccidentHotspotMapPage() {
  const normalizeItem = useCallback(
    (hotspot: AccidentHotspot, index: number): MapOffice | null => {
      if (!hotspot.longitude || !hotspot.latitude) {
        return null;
      }

      const accidentSummary = [
        hotspot.accident_year,
        hotspot.accident_type,
        hotspot.region_name,
        hotspot.accident_count ? `사고 ${hotspot.accident_count}건` : "",
        hotspot.casualty_count ? `사상 ${hotspot.casualty_count}명` : "",
      ]
        .filter(Boolean)
        .join(" / ");

      return {
        id: hotspot.id || `accident-hotspot-${index + 1}`,
        business_name: hotspot.business_name || `사고다발지역 ${index + 1}`,
        status: hotspot.status || hotspot.accident_type || "사고다발지역",
        phone: hotspot.phone || "",
        address: hotspot.address || accidentSummary,
        road_address: hotspot.road_address || "",
        longitude: hotspot.longitude,
        latitude: hotspot.latitude,
        sido: hotspot.sido || "",
        sigungu: hotspot.sigungu || "",
        search_text: [
          hotspot.hotspot_id,
          hotspot.accident_year,
          hotspot.accident_type,
          hotspot.region_name,
          hotspot.location_code,
          hotspot.accident_count,
          hotspot.casualty_count,
          hotspot.fatality_count,
          hotspot.search_text,
        ]
          .filter(Boolean)
          .join(" "),
      };
    },
    [],
  );

  return (
    <MapView
      title="전국 사고다발지역 지도"
      description="어린이·노인·보행자 등 교통사고 다발지역 표준 데이터를 지도에 표시합니다."
      dataUrl={getDataUrl("accident-hotspots.json")}
      emptyMessage="사고다발지역 지도 데이터 준비 중입니다."
      searchPlaceholder="사고유형, 위치명, 시군구 검색"
      normalizeItem={normalizeItem}
      currentLayer="accident-hotspots"
    />
  );
}
