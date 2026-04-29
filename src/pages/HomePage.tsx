import { Map, Route } from "lucide-react";

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
          <a className="home-edit-link" href="#/scale-offices/edit">
            전국 민간계량소 편집
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
          <a className="home-edit-link" href="#/highway-toll-offices/edit">
            전국 영업소 편집
          </a>
        </nav>
      </section>
    </main>
  );
}
