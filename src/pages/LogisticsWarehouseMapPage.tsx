import { useCallback } from "react";
import MapView from "../components/MapView";
import type { LogisticsWarehouse, MapOffice } from "../types";
import { getDataUrl } from "../utils/kakaoMap";

function getSido(address: string) {
  return address.split(" ")[0] || "";
}

export default function LogisticsWarehouseMapPage() {
  const normalizeItem = useCallback((warehouse: LogisticsWarehouse, index: number): MapOffice | null => {
    if (
      warehouse.status !== "영업/정상" ||
      typeof warehouse.longitude !== "number" ||
      typeof warehouse.latitude !== "number"
    ) {
      return null;
    }

    const address = warehouse.jibun_address || warehouse.road_address;
    return {
      id: warehouse.id || `logistics-warehouse-${index + 1}`,
      business_name: warehouse.business_name || `물류창고 ${index + 1}`,
      status: warehouse.status,
      phone: "",
      address,
      road_address: warehouse.road_address,
      longitude: warehouse.longitude,
      latitude: warehouse.latitude,
      sido: getSido(address),
      sigungu: "",
      search_text: [
        warehouse.business_storage,
        warehouse.business_transport,
        warehouse.warehouse_size_class,
        warehouse.is_mega ? "초대형" : "",
      ]
        .filter(Boolean)
        .join(" "),
      total_warehouse_area: warehouse.total_warehouse_area,
      general_warehouse_area: warehouse.general_warehouse_area,
      cold_storage_area: warehouse.cold_storage_area,
      storage_place_area: warehouse.storage_place_area,
      warehouse_size_class: warehouse.warehouse_size_class,
      is_mega: warehouse.is_mega,
      business_storage: warehouse.business_storage,
      business_transport: warehouse.business_transport,
    };
  }, []);

  return (
    <MapView
      title="전국 물류창고 지도"
      description="창고면적 기준 대형·중형·소형 물류창고 위치를 확인합니다."
      dataUrl={getDataUrl("logistics-warehouses.json")}
      emptyMessage="물류창고 지도 데이터 준비 중입니다."
      searchPlaceholder="사업장명, 주소, 업태 검색"
      normalizeItem={normalizeItem}
      markerVariant="warehouse"
      currentLayer="logistics-warehouses"
    />
  );
}
