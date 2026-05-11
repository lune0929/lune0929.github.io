import { useCallback } from "react";
import MapView from "../components/MapView";
import type { MapOffice } from "../types";
import { getDataUrl } from "../utils/kakaoMap";

export default function IndustrialComplexBoundaryMapPage() {
  const normalizeItem = useCallback((): MapOffice | null => {
    return null;
  }, []);

  return (
    <MapView
      title="전국 산업단지 경계 지도"
      description="국가·일반·도시첨단·농공 산업단지 경계를 면형으로 확인합니다."
      dataUrl={getDataUrl("heavy-factory-map-base.json")}
      emptyMessage="산업단지 경계는 지도 위의 표시 버튼으로 확인할 수 있습니다."
      searchPlaceholder="산업단지 검색"
      normalizeItem={normalizeItem}
      showCheckpointToggle={false}
      showIndustrialComplexBoundaryLayer
      currentLayer="industrial-complex-boundaries"
    />
  );
}
