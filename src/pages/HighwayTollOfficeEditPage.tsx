import ManualMapEditor from "../components/ManualMapEditor";
import { getDataUrl } from "../utils/kakaoMap";

export default function HighwayTollOfficeEditPage() {
  return (
    <ManualMapEditor
      datasetType="highway"
      title="전국 영업소 편집"
      mapHref="#/highway-toll-offices"
      dataUrl={getDataUrl("highway-toll-offices.json")}
      failedDataUrl={getDataUrl("highway-toll-offices-failed.json")}
      downloadFileName="highway-toll-offices.json"
      failedDownloadFileName="highway-toll-offices-failed.json"
      localStorageKey="highway-toll-offices-manual-edits"
    />
  );
}
