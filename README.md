# 전국 민간계량소/영업소 정적 지도

전국 민간계량소와 고속도로 영업소 좌표 데이터를 정적 JSON으로 저장하고, Vite React 앱에서 카카오 지도 마커로 표시하는 프로젝트입니다.

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

## 화면 경로

- 메인: `#/`
- 전국 민간계량소 지도: `#/scale-offices`
- 전국 민간계량소 편집: `#/scale-offices/edit`
- 전국 영업소 지도: `#/highway-toll-offices`
- 전국 영업소 편집: `#/highway-toll-offices/edit`

GitHub Pages 새로고침 문제를 피하기 위해 해시 기반 라우팅을 사용합니다.

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

변환 결과는 `public/data/scale-offices.json`에 저장됩니다.

## 고속도로 영업소 데이터 갱신

```bash
npm run fetch:highway
```

성공 데이터는 `public/data/highway-toll-offices.json`, 좌표 확인 실패 데이터는 `public/data/highway-toll-offices-failed.json`에 저장됩니다.

## 과적검문소 네이버 지오코딩

`data/naver_geocode_input_addresses.csv`의 주소 목록을 네이버 클라우드 플랫폼 지도 Geocoding API로 좌표화합니다. 주소는 `정규화주소`, `주소`, `원문` 순서로 사용합니다. API 키는 코드에 넣지 말고 환경변수로만 설정합니다.

Windows PowerShell:

```powershell
$env:NCP_MAPS_KEY_ID="your_naver_cloud_maps_key_id_here"
$env:NCP_MAPS_KEY="your_naver_cloud_maps_key_here"
```

macOS/Linux:

```bash
export NCP_MAPS_KEY_ID="your_naver_cloud_maps_key_id_here"
export NCP_MAPS_KEY="your_naver_cloud_maps_key_here"
```

실행:

```bash
npm run geocode:checkpoints
```

변환 결과 CSV는 `data/naver_geocoded_output.csv`에 저장됩니다. 지도에서 바로 사용하는 성공 JSON은 `public/data/overload-checkpoints.json`, 실패 목록은 `public/data/overload-checkpoints-failed.json`에 저장됩니다.

지도 화면의 검색/필터 영역에서 `과적검문소 표시` 버튼을 누르면 좌표가 있는 과적검문소가 기존 민간계량소 또는 고속도로 영업소 마커와 함께 표시됩니다. 다시 누르면 과적검문소 마커만 숨겨집니다.

## 전화번호 자동 보강

전화번호가 비어 있는 항목은 Kakao Local 키워드 검색과 Naver Local Search fallback으로 보강할 수 있습니다. API 키는 `.env` 또는 PowerShell 환경변수로 설정합니다. 실행 로그에는 키 값을 출력하지 않습니다.

```bash
KAKAO_REST_API_KEY=your_kakao_rest_api_key_here
NAVER_CLIENT_ID=your_naver_client_id_here
NAVER_CLIENT_SECRET=your_naver_client_secret_here
```

먼저 dry-run으로 대상 건수를 확인합니다.

```bash
python scripts/enrich-phones-from-place-search.py --target scale --dry-run
python scripts/enrich-phones-from-place-search.py --target highway --dry-run
```

소량 테스트 후 전체 실행합니다.

```bash
python scripts/enrich-phones-from-place-search.py --target scale --limit 10
python scripts/enrich-phones-from-place-search.py --target all --limit 20
python scripts/enrich-phones-from-place-search.py --target all
```

실패 목록은 `public/data/phone-enrich-failed.json`에 저장됩니다. 실제 저장 시 원본은 `public/data/*.phone.backup.json`으로 백업되며, 최종 반영은 사용자가 직접 확인한 뒤 `git add`, `git commit`, `git push`로 진행합니다.

## 편집 JSON 반영 절차

정적 GitHub Pages 환경에서는 브라우저가 `public/data/*.json` 파일을 직접 저장할 수 없습니다. 편집 화면에서 다운로드한 JSON 파일을 직접 교체한 뒤 커밋합니다.

1. 편집 화면에서 수정된 JSON 다운로드
2. 다운로드한 JSON 파일을 public/data 폴더에 덮어쓰기
3. git add public/data/*.json
4. git commit -m "Update manual map data"
5. git push

편집 중 변경사항은 브라우저 localStorage에 임시 저장됩니다.

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

### GitHub Pages

```bash
npm run build
```

`dist/` 폴더를 GitHub Pages에 배포합니다.

### Vercel

1. 이 폴더를 Git 저장소로 푸시합니다.
2. Vercel에서 프로젝트를 Import합니다.
3. Framework Preset은 Vite를 선택합니다.
4. Environment Variables에 `VITE_KAKAO_JAVASCRIPT_KEY`를 등록합니다.
5. Build Command는 `npm run build`, Output Directory는 `dist`를 사용합니다.

## JSON 필드

`public/data/scale-offices.json`에는 다음 주요 필드가 포함됩니다.

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
