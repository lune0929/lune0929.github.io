# 전국 민간계량소 정적 지도

CSV 파일에 들어 있는 전국 민간계량소 좌표를 EPSG:5174에서 WGS84(EPSG:4326) 경도/위도로 변환해 정적 JSON으로 저장하고, Vite React 앱에서 카카오 지도 마커로 표시하는 프로젝트입니다.

FastAPI, SQLite, Supabase, API 서버를 사용하지 않습니다. 배포 결과물은 정적 파일만 포함합니다.

## 준비

```bash
npm install
python -m pip install pyproj
```

카카오 지도 JavaScript 키를 `.env`에 설정합니다.

```bash
VITE_KAKAO_JAVASCRIPT_KEY=your_kakao_javascript_key_here
```

카카오 개발자 콘솔에서 배포 도메인과 로컬 개발 도메인을 JavaScript 키의 플랫폼 Web 사이트 도메인에 등록해야 합니다.

## CSV 변환

원본 CSV 파일을 다음 폴더 중 하나에 넣습니다.

```text
scripts/input/
data/raw/
```

CSV 파일이 하나만 있으면 아래 명령으로 자동 감지합니다.

```bash
npm run convert
```

CSV 파일을 직접 지정할 수도 있습니다.

```bash
python scripts/convert-scale-csv.py --input scripts/input/scale-offices.csv
```

변환 결과는 `public/data/scale-offices.json`에 저장됩니다. React 앱은 이 파일을 `fetch("/data/scale-offices.json")`로 읽습니다.

변환 스크립트는 `좌표정보(X)`, `좌표정보(Y)`를 EPSG:5174 좌표로 보고 pyproj로 EPSG:4326 경도/위도로 변환합니다. 컬럼명은 `사업장명`, `업소명`, `상호`, `전화번호`, `소재지주소`, `도로명주소`, `좌표정보(X)`, `좌표정보(Y)` 등 여러 후보명을 처리합니다.

## 개발 실행

```bash
npm run dev
```

브라우저에서 Vite가 안내하는 로컬 주소를 엽니다.

## 빌드

```bash
npm run build
```

빌드 결과는 `dist/`에 생성됩니다.

## 배포

### Vercel

1. 이 폴더를 Git 저장소로 푸시합니다.
2. Vercel에서 프로젝트를 Import합니다.
3. Framework Preset은 Vite를 선택합니다.
4. Environment Variables에 `VITE_KAKAO_JAVASCRIPT_KEY`를 등록합니다.
5. Build Command는 `npm run build`, Output Directory는 `dist`를 사용합니다.

### GitHub Pages

```bash
npm run build
```

`dist/` 폴더를 GitHub Pages에 배포합니다. `fetch("/data/scale-offices.json")`를 사용하므로 GitHub Pages 프로젝트 하위 경로가 아닌 루트 도메인 또는 커스텀 도메인 배포에 맞습니다.

## JSON 필드

`public/data/scale-offices.json`에는 다음 필드가 포함됩니다.

```json
{
  "id": "1",
  "business_name": "사업장명",
  "status": "영업상태",
  "phone": "000-0000-0000",
  "address": "지번 주소",
  "road_address": "도로명 주소",
  "longitude": 127.0,
  "latitude": 37.0,
  "sido": "서울특별시",
  "sigungu": "중구"
}
```
