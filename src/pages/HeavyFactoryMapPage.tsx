import { useCallback } from "react";
import MapView from "../components/MapView";
import type { HeavyFactory, MapOffice } from "../types";
import { getDataUrl } from "../utils/kakaoMap";

export default function HeavyFactoryMapPage() {
  const normalizeItem = useCallback((_factory: HeavyFactory): MapOffice | null => {
    return null;
  }, []);

  return (
    <MapView
      title="전국 고중량 공장 지도"
      description="생산품 기준 고중량 화물 발생 가능성이 높은 공장 후보 위치를 확인합니다."
      dataUrl={getDataUrl("heavy-factory-map-base.json")}
      emptyMessage="고중량 공장은 지도 위의 표시 버튼으로 확인할 수 있습니다."
      searchPlaceholder="회사명, 생산품, 주소 검색"
      normalizeItem={normalizeItem}
      showCheckpointToggle={false}
      currentLayer="heavy-factories"
    />
  );
}
