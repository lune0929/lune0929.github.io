import { useCallback } from "react";
import MapView from "../components/MapView";
import type { MapOffice, OverloadCheckpoint } from "../types";
import { getDataUrl } from "../utils/kakaoMap";

export default function OverloadCheckpointMapPage() {
  const normalizeItem = useCallback(
    (checkpoint: OverloadCheckpoint, index: number): MapOffice | null => {
      if (!checkpoint.longitude || !checkpoint.latitude) {
        return null;
      }

      return {
        id: checkpoint.id || `checkpoint-${index + 1}`,
        business_name: checkpoint.business_name || `과적검문소 ${index + 1}`,
        status: checkpoint.status || "좌표확인",
        phone: checkpoint.phone || "",
        address: checkpoint.address || "",
        road_address: checkpoint.road_address || "",
        longitude: checkpoint.longitude,
        latitude: checkpoint.latitude,
        sido: checkpoint.sido || "",
        sigungu: checkpoint.sigungu || "",
      };
    },
    [],
  );

  return (
    <MapView
      title="전국 과적검문소 지도"
      description="네이버 지오코딩으로 변환한 과적검문소 위치를 카카오 지도에 표시합니다."
      dataUrl={getDataUrl("overload-checkpoints.json")}
      emptyMessage="과적검문소 좌표 데이터 준비 중입니다."
      searchPlaceholder="과적검문소명, 주소 검색"
      normalizeItem={normalizeItem}
      markerVariant="checkpoint"
      showCheckpointToggle={false}
    />
  );
}
