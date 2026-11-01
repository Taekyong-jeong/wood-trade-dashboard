"""KOSIS 국토교통부 건축 착공 통계(월별)를 찾아 원자료 그대로 저장 — WIDI 변동 해설(국내 건설경기 요인)용.
키: 환경변수 KOSIS_API_KEY (로그에 출력하지 않음).
결과: data/external/kosis_construction_search.json (검색 결과), data/external/kosis_construction_raw.json (월별 원자료)."""
import json, os, sys, urllib.parse, urllib.request
from pathlib import Path

KEY = os.environ.get("KOSIS_API_KEY", "").strip()
if not KEY:
    sys.exit("KOSIS_API_KEY 없음")
START, END = "201601", "202612"


def get(url, params):
    q = urllib.parse.urlencode({**params, "apiKey": KEY, "format": "json", "jsonVD": "Y"})
    with urllib.request.urlopen(url + "?" + q, timeout=120) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


# 1) 통합검색으로 착공 관련 표 찾기 (국토교통부 orgId 116)
cands = {}
search = {}
for term in ["건축착공", "착공 현황", "건축물 착공", "용도별 착공", "구조별 착공"]:
    try:
        d = get("https://kosis.kr/openapi/statisticsSearch.do",
                {"method": "getList", "searchNm": term, "sort": "RANK", "startCount": 1, "resultCount": 60})
    except Exception as e:
        print(f"[{term}] 검색 오류 {type(e).__name__}"); continue
    if isinstance(d, dict):
        print(f"[{term}] 응답 오류 {d.get('err')}"); continue
    search[term] = d
    for x in d:
        nm, org, tid = x.get("TBL_NM") or "", str(x.get("ORG_ID")), x.get("TBL_ID")
        print(f"  [{term}] {x.get('ORG_NM')}({org}) | {tid} | {nm} | {x.get('STRT_PRD_DE')}~{x.get('END_PRD_DE')}")
        if org == "116" and "착공" in nm:
            cands[tid] = nm
Path("data/external/kosis_construction_search.json").write_text(json.dumps(search, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"후보 표 {len(cands)}개")

# 2) 후보 표 중 월별(M) 자료가 있는 표의 원자료 받기
out = {}
for tid, nm in sorted(cands.items()):
    try:
        prd = get("https://kosis.kr/openapi/statisticsData.do", {"method": "getMeta", "type": "PRD", "orgId": "116", "tblId": tid})
        ses = sorted({str(p.get("PRD_SE")) for p in prd}) if isinstance(prd, list) else []
        if "M" not in ses and "월" not in ses:
            print(f"  {tid} {nm}: 월별 없음 {ses}"); continue
        meta = get("https://kosis.kr/openapi/statisticsData.do", {"method": "getMeta", "type": "ITM", "orgId": "116", "tblId": tid})
        if isinstance(meta, dict):
            raise RuntimeError(str(meta.get("err")))
        axes = sorted({m["OBJ_ID"] for m in meta if m.get("OBJ_ID") != "ITEM"})
        items = sorted({(m.get("ITM_ID"), m.get("ITM_NM"), m.get("UNIT_NM")) for m in meta if m.get("OBJ_ID") == "ITEM"})
        rows = []
        for y in range(int(START[:4]), int(END[:4]) + 1):  # 셀 수 제한 때문에 연도별로 나눠 받음
            p = {"method": "getList", "orgId": "116", "tblId": tid, "itmId": "ALL", "prdSe": "M",
                 "startPrdDe": f"{y}01", "endPrdDe": f"{y}12"}
            for k in range(1, len(axes) + 1):
                p[f"objL{k}"] = "ALL"
            data = get("https://kosis.kr/openapi/Param/statisticsParameterData.do", p)
            if isinstance(data, dict):
                print(f"    {tid} {y}: {data.get('err')} {data.get('errMsg')}"); continue
            rows += [{k: r.get(k) for k in ("PRD_DE", "ITM_NM", "UNIT_NM", "C1_NM", "C2_NM", "C3_NM",
                                              "C1_OBJ_NM", "C2_OBJ_NM", "C3_OBJ_NM", "DT")} for r in data]
        out[tid] = {"name": nm, "axes": axes, "items": items, "rows": rows}
        print(f"  {tid} {nm}: {len(rows)}행, 축 {axes}")
    except Exception as e:
        print(f"  {tid} {nm}: 오류 {type(e).__name__} {str(e)[:80]}")
Path("data/external/kosis_construction_raw.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
