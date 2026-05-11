import { useCallback } from "react";
import MapView from "../components/MapView";
import type { MapOffice, TruckAccidentHotspot } from "../types";
import { getDataUrl } from "../utils/kakaoMap";

function getSido(regionName: string) {
  return regionName.replace(/\d+$/, "").split(" ")[0] || "";
}

export default function TruckAccidentHotspotMapPage() {
  const normalizeItem = useCallback((hotspot: TruckAccidentHotspot, index: number): MapOffice | null => {
    if (typeof hotspot.longitude !== "number" || typeof hotspot.latitude !== "number") {
      return null;
    }

    return {
      id: hotspot.id || `truck-accident-hotspot-${index + 1}`,
      business_name: hotspot.spot_name || `화물차 사고다발지역 ${index + 1}`,
      status: "화물차 사고다발지역",
      phone: "",
      address: hotspot.region_name,
      road_address: "",
      longitude: hotspot.longitude,
      latitude: hotspot.latitude,
      sido: getSido(hotspot.region_name),
      sigungu: hotspot.region_name,
      search_text: [hotspot.hotspot_id, hotspot.legal_dong_code, hotspot.spot_code].join(" "),
      accident_count: hotspot.accident_count,
      casualty_count: hotspot.casualty_count,
      death_count: hotspot.death_count,
      serious_injury_count: hotspot.serious_injury_count,
      minor_injury_count: hotspot.minor_injury_count,
      reported_injury_count: hotspot.reported_injury_count,
      hotspot_id: hotspot.hotspot_id,
      region_name: hotspot.region_name,
      spot_code: hotspot.spot_code,
    };
  }, []);

  return (
    <MapView
      title="전국 화물차 사고다발지역 지도"
      description="화물차 교통사고 다발지역의 중심점과 다발지역 폴리곤을 지도에 표시합니다."
      dataUrl={getDataUrl("truck-accident-hotspots.json")}
      emptyMessage="화물차 사고다발지역 지도 데이터 준비 중입니다."
      searchPlaceholder="지점명, 지역명, 지점코드 검색"
      normalizeItem={normalizeItem}
      markerVariant="truck-accident"
      currentLayer="truck-accident-hotspots"
    />
  );
}
