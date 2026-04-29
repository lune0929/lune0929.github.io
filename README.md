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
