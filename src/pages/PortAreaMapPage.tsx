import { useCallback } from "react";
import MapView from "../components/MapView";
import type { MapOffice } from "../types";
import { getDataUrl } from "../utils/kakaoMap";

export default function PortAreaMapPage() {
  const normalizeItem = useCallback((): MapOffice | null => {
    return null;
  }, []);

  return (
    <MapView
      title="전국 항만구역 지도"
      description="항만구역 SHP를 변환한 GeoJSON 폴리곤을 카카오 지도에 표시합니다."
      dataUrl={getDataUrl("heavy-factory-map-base.json")}
      emptyMessage="항만구역은 지도 위의 표시 버튼으로 확인할 수 있습니다."
      searchPlaceholder="항만구역 검색"
      normalizeItem={normalizeItem}
      showCheckpointToggle={false}
      currentLayer="port-areas"
    />
  );
}
