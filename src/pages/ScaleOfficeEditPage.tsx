import ManualMapEditor from "../components/ManualMapEditor";
import { getDataUrl } from "../utils/kakaoMap";

export default function ScaleOfficeEditPage() {
  return (
    <ManualMapEditor
      datasetType="scale"
      title="전국 민간계량소 편집"
      mapHref="#/scale-offices"
      dataUrl={getDataUrl("scale-offices.json")}
      downloadFileName="scale-offices.json"
      localStorageKey="scale-offices-manual-edits"
    />
  );
}
