import {
  AlertTriangle,
  Anchor,
  Coffee,
  Factory,
  Layers,
  Map,
  Route,
  ShieldAlert,
  Truck,
  Warehouse,
} from "lucide-react";

export default function HomePage() {
  return (
    <main className="home-page">
      <section className="home-panel" aria-label="지도 선택">
        <div className="home-heading">
          <h1>전국 지도 서비스</h1>
          <p>확인할 지도를 선택하세요.</p>
        </div>

        <nav className="home-actions" aria-label="지도 링크">
          <a className="home-card-button" href="#/scale-offices">
            <span className="home-card-icon" aria-hidden="true">
              <Map size={30} />
            </span>
            <span>
              <strong>전국 민간계량소 지도</strong>
              <small>민간계량소 위치와 영업상태를 확인합니다.</small>
            </span>
          </a>
          <a className="home-card-button" href="#/highway-toll-offices">
            <span className="home-card-icon" aria-hidden="true">
              <Route size={30} />
            </span>
            <span>
              <strong>전국 영업소 지도</strong>
              <small>전국 고속도로 영업소 위치를 확인합니다.</small>
            </span>
          </a>

          <a className="home-card-button" href="#/overload-checkpoints">
            <span className="home-card-icon checkpoint" aria-hidden="true">
              <ShieldAlert size={30} />
            </span>
            <span>
              <strong>전국 과적검문소 지도</strong>
              <small>CSV 주소를 좌표화한 과적검문소 위치를 확인합니다.</small>
            </span>
          </a>

          <a className="home-card-button" href="#/heavy-factories">
            <span className="home-card-icon heavy-factory" aria-hidden="true">
              <Factory size={30} />
            </span>
            <span>
              <strong>전국 고중량 공장 지도</strong>
              <small>생산품 기준 고중량 화물 발생 가능성이 높은 공장 후보 위치를 확인합니다.</small>
            </span>
          </a>

          <a className="home-card-button" href="#/logistics-warehouses">
            <span className="home-card-icon warehouse" aria-hidden="true">
              <Warehouse size={30} />
            </span>
            <span>
              <strong>전국 물류창고 지도</strong>
              <small>창고면적 기준 대형·중형·소형 물류창고 위치를 확인합니다.</small>
            </span>
          </a>

          <a className="home-card-button" href="#/port-areas">
            <span className="home-card-icon port-area" aria-hidden="true">
              <Anchor size={30} />
            </span>
            <span>
              <strong>전국 항만구역 지도</strong>
              <small>항만구역 SHP를 변환한 폴리곤 위치를 확인합니다.</small>
            </span>
          </a>

          <a className="home-card-button" href="#/industrial-complex-boundaries">
            <span className="home-card-icon industrial-complex" aria-hidden="true">
              <Layers size={30} />
            </span>
            <span>
              <strong>전국 산업단지 경계 지도</strong>
              <small>국가·일반·도시첨단·농공 산업단지 경계를 확인합니다.</small>
            </span>
          </a>

          <a className="home-card-button" href="#/rest-areas">
            <span className="home-card-icon rest-area" aria-hidden="true">
              <Coffee size={30} />
            </span>
            <span>
              <strong>전국 휴게소 지도</strong>
              <small>전국 휴게소 위치와 노선 정보를 확인합니다.</small>
            </span>
          </a>

          <a className="home-card-button" href="#/accident-hotspots">
            <span className="home-card-icon accident" aria-hidden="true">
              <AlertTriangle size={30} />
            </span>
            <span>
              <strong>전국 사고다발지역 지도</strong>
              <small>사고유형별 교통사고다발지역을 확인합니다.</small>
            </span>
          </a>

          <a className="home-card-button" href="#/truck-accident-hotspots">
            <span className="home-card-icon truck-accident" aria-hidden="true">
              <Truck size={30} />
            </span>
            <span>
              <strong>전국 화물차 사고다발지역 지도</strong>
              <small>화물차 사망·중상 교통사고 다발지역을 확인합니다.</small>
            </span>
          </a>
        </nav>
      </section>
    </main>
  );
}
