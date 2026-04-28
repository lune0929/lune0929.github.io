import { MapPin, Phone, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  KakaoMarkerClusterer,
  KakaoInfoWindow,
  KakaoMap,
  KakaoMarker,
  HighwayTollOfficeFailed,
  ScaleOffice,
} from "./types";

const DEFAULT_CENTER = { latitude: 36.5, longitude: 127.8 };
const ALL = "전체";
const STATUS_LABELS = {
  open: "영업",
  closed: "폐업",
  other: "기타",
} as const;

type StatusCategory = keyof typeof STATUS_LABELS;
type MapViewType = "roadmap" | "skyview";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) {
    return value;
  }
  if (digits.startsWith("02")) {
    if (digits.length === 9) {
      return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    }
    if (digits.length === 10) {
      return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
    }
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  return value;
}

function getAddress(office: ScaleOffice) {
  return office.road_address || office.address || "주소 정보 없음";
}

function getStatusCategory(status: string): StatusCategory {
  const normalized = status.replace(/\s/g, "");
  if (normalized.includes("폐업") || normalized.includes("취소") || normalized.includes("말소")) {
    return "closed";
  }
  if (
    normalized.includes("영업/정상") ||
    normalized.includes("정상") ||
    normalized.includes("영업중") ||
    normalized.includes("운영")
  ) {
    return "open";
  }
  return "other";
}

function getMarkerSvg(color: string) {
  return encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42">
      <path fill="${color}" d="M17 0C7.6 0 0 7.5 0 16.7c0 12.5 17 25.3 17 25.3s17-12.8 17-25.3C34 7.5 26.4 0 17 0Z"/>
      <circle cx="17" cy="16.5" r="6.2" fill="white"/>
    </svg>
  `);
}

function getMarkerColor(category: StatusCategory) {
  if (category === "open") {
    return "#16875f";
  }
  if (category === "closed") {
    return "#7b8794";
  }
  return "#d97706";
}

function loadKakaoMapScript(key: string) {
  if (window.kakao?.maps) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-kakao-map-sdk="true"]',
    );

    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("카카오 지도 SDK 로드 실패")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.dataset.kakaoMapSdk = "true";
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false&libraries=clusterer`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("카카오 지도 SDK 로드 실패"));
    document.head.appendChild(script);
  });
}

export default function App() {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const markersRef = useRef<KakaoMarker[]>([]);
  const markerByIdRef = useRef<Map<string, KakaoMarker>>(new Map());
  const clustererRef = useRef<KakaoMarkerClusterer | null>(null);
  const infoWindowRef = useRef<KakaoInfoWindow | null>(null);
  const officeRefs = useRef<Map<string, HTMLElement>>(new Map());
  const suppressNextMapClickRef = useRef(false);
  const markerImagesRef = useRef<Partial<Record<StatusCategory, unknown>>>({});

  const [offices, setOffices] = useState<ScaleOffice[]>([]);
  const [query, setQuery] = useState("");
  const [sido, setSido] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [selectedOfficeId, setSelectedOfficeId] = useState<string | null>(null);
  const [mapViewType, setMapViewType] = useState<MapViewType>("roadmap");
  const [failedHighwayOffices, setFailedHighwayOffices] = useState<HighwayTollOfficeFailed[]>([]);
  const [showFailedHighway, setShowFailedHighway] = useState(false);
  const kakaoKey = import.meta.env.VITE_KAKAO_JAVASCRIPT_KEY as string | undefined;

  const closeInfoWindow = useCallback(() => {
    infoWindowRef.current?.close();
    infoWindowRef.current = null;
  }, []);

  const createInfoWindowContent = useCallback((office: ScaleOffice) => {
    const category = getStatusCategory(office.status);
    return `
      <div class="map-info-window">
        <div class="info-title">${escapeHtml(office.business_name || "이름 없음")}</div>
        <div class="info-row">
          <span class="info-label">주소</span>
          <span class="info-value address">${escapeHtml(getAddress(office))}</span>
        </div>
        <div class="info-row">
          <span class="info-label">전화</span>
          <span class="info-value">${escapeHtml(normalizePhone(office.phone) || "전화번호 정보 없음")}</span>
        </div>
        <div class="info-row">
          <span class="info-label">상태</span>
          <span class="info-badge ${category}">${escapeHtml(office.status || "상태 미상")}</span>
        </div>
      </div>
    `;
  }, []);

  const getMarkerImage = useCallback((category: StatusCategory) => {
    if (!window.kakao) {
      return undefined;
    }

    if (!markerImagesRef.current[category]) {
      markerImagesRef.current[category] = new window.kakao.maps.MarkerImage(
        `data:image/svg+xml;charset=UTF-8,${getMarkerSvg(getMarkerColor(category))}`,
        new window.kakao.maps.Size(34, 42),
      );
    }

    return markerImagesRef.current[category] as ConstructorParameters<
      typeof window.kakao.maps.Marker
    >[0]["image"];
  }, []);

  const selectOffice = useCallback(
    (
      office: ScaleOffice,
      options: { panMap?: boolean; scrollList?: boolean; fromMarker?: boolean } = {},
    ) => {
      const map = mapRef.current;
      const marker = markerByIdRef.current.get(office.id);
      if (!map || !window.kakao || !marker) {
        return;
      }

      setSelectedOfficeId(office.id);

      if (options.fromMarker) {
        suppressNextMapClickRef.current = true;
        window.setTimeout(() => {
          suppressNextMapClickRef.current = false;
        }, 0);
      }

      const position = new window.kakao.maps.LatLng(office.latitude, office.longitude);
      if (options.panMap) {
        if (map.getLevel() > 5) {
          map.setLevel(5);
        }
        map.panTo(position);
      }

      closeInfoWindow();
      const infoWindow = new window.kakao.maps.InfoWindow({
        content: createInfoWindowContent(office),
        removable: true,
      });
      infoWindow.open(map, marker);
      infoWindowRef.current = infoWindow;

      if (options.scrollList) {
        officeRefs.current.get(office.id)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    },
    [closeInfoWindow, createInfoWindowContent],
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/data/scale-offices.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`JSON 로드 실패: ${response.status}`);
        }
        return response.json() as Promise<ScaleOffice[]>;
      })
      .then((data) => {
        if (!cancelled) {
          setOffices(data.filter((item) => item.longitude && item.latitude));
        }
      })
      .catch((exc: Error) => {
        if (!cancelled) {
          setError(exc.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/highway-toll-offices-failed.json")
      .then((response) => {
        if (!response.ok) {
          return [];
        }
        return response.json() as Promise<HighwayTollOfficeFailed[]>;
      })
      .then((data) => {
        if (!cancelled) {
          setFailedHighwayOffices(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailedHighwayOffices([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mapNodeRef.current || !kakaoKey || mapRef.current) {
      return;
    }

    let cancelled = false;
    loadKakaoMapScript(kakaoKey)
      .then(() => {
        window.kakao?.maps.load(() => {
          if (cancelled || !mapNodeRef.current || !window.kakao) {
            return;
          }
          const center = new window.kakao.maps.LatLng(
            DEFAULT_CENTER.latitude,
            DEFAULT_CENTER.longitude,
          );
          mapRef.current = new window.kakao.maps.Map(mapNodeRef.current, {
            center,
            level: 13,
          });
          window.kakao.maps.event.addListener(mapRef.current, "click", () => {
            if (suppressNextMapClickRef.current) {
              suppressNextMapClickRef.current = false;
              return;
            }
            closeInfoWindow();
            setSelectedOfficeId(null);
          });
          setMapReady(true);
        });
      })
      .catch((exc: Error) => setMapError(exc.message));

    return () => {
      cancelled = true;
    };
  }, [kakaoKey]);

  const sidoOptions = useMemo(() => {
    const values = offices.map((office) => office.sido).filter(Boolean);
    return [ALL, ...Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "ko"))];
  }, [offices]);

  const statusOptions = useMemo(() => {
    const values = offices.map((office) => office.status || "상태 미상");
    return [ALL, ...Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "ko"))];
  }, [offices]);

  const filteredOffices = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return offices.filter((office) => {
      const statusValue = office.status || "상태 미상";
      const text = [
        office.business_name,
        office.status,
        office.phone,
        office.address,
        office.road_address,
        office.sido,
        office.sigungu,
      ]
        .join(" ")
        .toLowerCase();

      return (
        (!keyword || text.includes(keyword)) &&
        (sido === ALL || office.sido === sido) &&
        (status === ALL || statusValue === status)
      );
    });
  }, [offices, query, sido, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !window.kakao) {
      return;
    }

    markersRef.current.forEach((marker) => marker.setMap(null));
    clustererRef.current?.clear();
    markersRef.current = [];
    markerByIdRef.current.clear();
    infoWindowRef.current?.close();
    infoWindowRef.current = null;

    if (filteredOffices.length === 0) {
      setSelectedOfficeId(null);
      return;
    }

    const clusterer = new window.kakao.maps.MarkerClusterer({
      map,
      averageCenter: true,
      minLevel: 7,
      disableClickZoom: false,
    });
    const bounds = new window.kakao.maps.LatLngBounds();
    const nextMarkers = filteredOffices.map((office) => {
      const position = new window.kakao!.maps.LatLng(office.latitude, office.longitude);
      bounds.extend(position);

      const marker = new window.kakao!.maps.Marker({
        position,
        title: office.business_name,
        image: getMarkerImage(getStatusCategory(office.status)),
      });
      markerByIdRef.current.set(office.id, marker);

      window.kakao!.maps.event.addListener(marker, "click", () => {
        selectOffice(office, { scrollList: true, fromMarker: true });
      });

      return marker;
    });

    clusterer.addMarkers(nextMarkers);
    clustererRef.current = clusterer;
    if (filteredOffices.length === 1) {
      map.setCenter(new window.kakao.maps.LatLng(filteredOffices[0].latitude, filteredOffices[0].longitude));
    } else {
      map.setBounds(bounds);
    }
    markersRef.current = nextMarkers;
  }, [closeInfoWindow, filteredOffices, mapReady, selectOffice]);

  useEffect(() => {
    if (
      selectedOfficeId &&
      !filteredOffices.some((office) => office.id === selectedOfficeId)
    ) {
      closeInfoWindow();
      setSelectedOfficeId(null);
    }
  }, [closeInfoWindow, filteredOffices, selectedOfficeId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !window.kakao) {
      return;
    }

    map.setMapTypeId(
      mapViewType === "skyview"
        ? window.kakao.maps.MapTypeId.SKYVIEW
        : window.kakao.maps.MapTypeId.ROADMAP,
    );
  }, [mapReady, mapViewType]);

  const visibleCount = filteredOffices.length.toLocaleString("ko-KR");
  const totalCount = offices.length.toLocaleString("ko-KR");

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-icon" aria-hidden="true">
            <MapPin size={24} />
          </div>
          <div>
            <h1>전국 민간계량소 지도</h1>
            <p>CSV에서 변환한 정적 JSON 데이터를 카카오 지도에 표시합니다.</p>
          </div>
        </div>

        <section className="controls" aria-label="검색 및 필터">
          <label className="search-box">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="사업장명, 주소, 전화번호 검색"
            />
          </label>

          <label>
            시도
            <select value={sido} onChange={(event) => setSido(event.target.value)}>
              {sidoOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label>
            영업상태
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </section>

        <div className="result-summary">
          <strong>{visibleCount}</strong>
          <span>/ {totalCount}개 표시</span>
        </div>

        {failedHighwayOffices.length > 0 && (
          <section className="failed-highway-panel">
            <button
              type="button"
              onClick={() => setShowFailedHighway((value) => !value)}
              aria-expanded={showFailedHighway}
            >
              <span>고속도로 영업소 좌표 미확인</span>
              <strong>{failedHighwayOffices.length.toLocaleString("ko-KR")}건</strong>
            </button>
            {showFailedHighway && (
              <div className="failed-highway-list">
                {failedHighwayOffices.slice(0, 80).map((office, index) => (
                  <article key={`${office.route_name}-${office.office_name}-${index}`}>
                    <h2>{office.office_name || "이름 없음"}</h2>
                    <p>{office.route_name || "노선 정보 없음"}</p>
                    <span>{office.fail_reason || "좌표 미제공/확인 필요"}</span>
                  </article>
                ))}
                {failedHighwayOffices.length > 80 && (
                  <p className="failed-highway-more">상위 80건만 표시합니다. 전체 목록은 JSON 파일에서 확인하세요.</p>
                )}
              </div>
            )}
          </section>
        )}

        <section className="office-list" aria-label="민간계량소 목록">
          {loading && <p className="status-text">데이터를 불러오는 중입니다.</p>}
          {error && <p className="status-text error">{error}</p>}
          {!loading && !error && filteredOffices.length === 0 && (
            <p className="status-text">조건에 맞는 계량소가 없습니다.</p>
          )}
          {filteredOffices.map((office) => (
            <article
              className={[
                "office-card",
                getStatusCategory(office.status),
                selectedOfficeId === office.id ? "selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={office.id}
              ref={(node) => {
                if (node) {
                  officeRefs.current.set(office.id, node);
                } else {
                  officeRefs.current.delete(office.id);
                }
              }}
              role="button"
              tabIndex={0}
              onClick={() => selectOffice(office, { panMap: true })}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectOffice(office, { panMap: true });
                }
              }}
            >
              <h2>{office.business_name || "이름 없음"}</h2>
              <p>{getAddress(office)}</p>
              <div className="office-meta">
                <span className={`status-chip ${getStatusCategory(office.status)}`}>
                  {office.status || "상태 미상"}
                </span>
                {office.phone && (
                  <span className="phone">
                    <Phone size={14} aria-hidden="true" />
                    {normalizePhone(office.phone)}
                  </span>
                )}
              </div>
            </article>
          ))}
        </section>
      </aside>

      <section className="map-panel" aria-label="카카오 지도">
        {mapReady && (
          <div className="map-type-control" aria-label="지도 보기 방식">
            <button
              className={mapViewType === "roadmap" ? "active" : ""}
              type="button"
              onClick={() => setMapViewType("roadmap")}
            >
              일반지도
            </button>
            <button
              className={mapViewType === "skyview" ? "active" : ""}
              type="button"
              onClick={() => setMapViewType("skyview")}
            >
              항공사진
            </button>
          </div>
        )}
        {!kakaoKey && (
          <div className="map-overlay">
            <strong>카카오 지도 키가 필요합니다.</strong>
            <span>.env 파일에 VITE_KAKAO_JAVASCRIPT_KEY를 설정하세요.</span>
          </div>
        )}
        {kakaoKey && mapError && (
          <div className="map-overlay">
            <strong>카카오 지도를 불러오지 못했습니다.</strong>
            <span>{mapError}</span>
          </div>
        )}
        {kakaoKey && !mapReady && !mapError && (
          <div className="map-overlay">
            <strong>지도를 불러오는 중입니다.</strong>
            <span>계속 흰 화면이면 카카오 앱 키의 Web 도메인 등록을 확인하세요.</span>
          </div>
        )}
        <div ref={mapNodeRef} className="map-node" />
      </section>
    </main>
  );
}
