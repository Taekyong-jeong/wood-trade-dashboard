"""KOSIS 목재이용실태조사(산림청 136, DT_136034_2024_*) 제품별 원자재 이용량 표를 모두 받아 저장.
키: 환경변수 KOSIS_API_KEY (로그에 출력하지 않음). 결과: data/external/kosis_wus_raw.json (원자료 그대로)."""
import json, os, sys, urllib.parse, urllib.request
from pathlib import Path

KEY = os.environ.get("KOSIS_API_KEY", "").strip()
if not KEY:
    sys.exit("KOSIS_API_KEY 없음")
def get(url, params):
    q = urllib.parse.urlencode({**params, "apiKey": KEY, "format": "json", "jsonVD": "Y"})
    with urllib.request.urlopen(url + "?" + q, timeout=120) as r:
        return json.loads(r.read().decode("utf-8", "replace"))
TERMS = ["원자재 이용량", "원목 이용량", "원자재 투입량", "원목 외 원자재", "국산-수입 원목", "폐목재"]
tbls = {}
for term in TERMS:
    try:
        d = get("https://kosis.kr/openapi/statisticsSearch.do", {"method": "getList", "searchNm": term, "sort": "RANK", "startCount": 1, "resultCount": 100})
    except Exception as e:
        print(f"[{term}] 검색 오류 {type(e).__name__}"); continue
    if isinstance(d, dict): print(f"[{term}] 응답 오류 {d.get('err')}"); continue
    for x in d:
        if str(x.get("TBL_ID", "")).startswith("DT_136034_2024_"):
            tbls[x["TBL_ID"]] = x.get("TBL_NM")
print(f"표 {len(tbls)}개")
out = {}
for tid, nm in sorted(tbls.items()):
    try:
        meta = get("https://kosis.kr/openapi/statisticsData.do", {"method": "getMeta", "type": "ITM", "orgId": "136", "tblId": tid})
        if isinstance(meta, dict): raise RuntimeError(str(meta.get("err")))
        axes = sorted({m["OBJ_ID"] for m in meta if m.get("OBJ_ID") != "ITEM"})
        p = {"method": "getList", "orgId": "136", "tblId": tid, "itmId": "ALL", "prdSe": "Y", "startPrdDe": "2020", "endPrdDe": "2025"}
        for k in range(1, len(axes) + 1):
            p[f"objL{k}"] = "ALL"
        data = get("https://kosis.kr/openapi/Param/statisticsParameterData.do", p)
        if isinstance(data, dict): raise RuntimeError(str(data.get("err")) + " " + str(data.get("errMsg")))
        rows = [{k: r.get(k) for k in ("PRD_DE", "ITM_NM", "UNIT_NM", "C1_NM", "C2_NM", "C3_NM", "C1_OBJ_NM", "C2_OBJ_NM", "C3_OBJ_NM", "DT")} for r in data]
        out[tid] = {"name": nm, "axes": axes, "rows": rows}
        print(f"  {tid} {nm}: {len(rows)}행")
    except Exception as e:
        print(f"  {tid} {nm}: 오류 {type(e).__name__} {str(e)[:80]}")
Path("data/external/kosis_wus_raw.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
