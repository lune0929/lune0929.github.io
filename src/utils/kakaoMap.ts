export function loadKakaoMapScript(key: string) {
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
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false&libraries=clusterer,services`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("카카오 지도 SDK 로드 실패"));
    document.head.appendChild(script);
  });
}

export function getDataUrl(fileName: string) {
  return `${import.meta.env.BASE_URL}data/${fileName}`.replace(/\/{2,}/g, "/");
}
