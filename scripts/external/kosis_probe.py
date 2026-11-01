"""KOSIS 통계표 메타(항목·분류) 확인 — 목재 관련 항목만 추려 data/external/kosis_meta.json 에 저장.
키는 환경변수 KOSIS_API_KEY (로그에 출력하지 않음)."""
import json, os, sys, urllib.parse, urllib.request
from pathlib import Path

KEY = os.environ.get("KOSIS_API_KEY", "").strip()
if not KEY:
    sys.exit("KOSIS_API_KEY 없음")
WOOD = ("목재", "나무", "제재", "합판", "보드", "섬유판", "집성", "직교", "CLT", "펠릿", "원목", "칩", "단판", "마루", "목탄", "숯", "방부", "LVL", "16")
TABLES = [("101", "DT_1FP1124A", "광업제조업조사 품목편 2024"), ("301", "DT_404Y016", "생산자물가지수(품목별)"),
          ("301", "DT_401Y017", "수입물가지수(품목별)"), ("136", "DT_136034_2024_J018", "집성재 생산업체 생산량 및 판매량"),
          ("136", "DT_136034_2024_A031", "제재목 국산 원목 이용 제품생산량 및 판매량"), ("101", "DT_1FS1101", "광업제조업조사 주요지표"),
          ("101", "DT_1F32001", "제조업 생산능력 및 가동률지수")]

def meta(org, tbl, typ):
    q = urllib.parse.urlencode({"method": "getMeta", "type": typ, "apiKey": KEY, "orgId": org, "tblId": tbl, "format": "json", "jsonVD": "Y"})
    with urllib.request.urlopen("https://kosis.kr/openapi/statisticsData.do?" + q, timeout=90) as r:
        return json.loads(r.read().decode("utf-8", "replace"))

out = {}
for org, tbl, nm in TABLES:
    try:
        itm = meta(org, tbl, "ITM")
    except Exception as e:
        print(f"[{tbl}] 오류 {type(e).__name__}"); continue
    if isinstance(itm, dict):
        print(f"[{tbl}] 응답 오류 {itm.get('err')} {itm.get('errMsg')}"); continue
    try:
        prd = meta(org, tbl, "PRD")
    except Exception:
        prd = []
    items = [r for r in itm if r.get("OBJ_ID") == "ITEM"]
    cls = [r for r in itm if r.get("OBJ_ID") != "ITEM" and any(w in (r.get("ITM_NM") or "") for w in WOOD)]
    objs = sorted({(r.get("OBJ_ID"), r.get("OBJ_NM")) for r in itm})
    print(f"[{tbl}] {nm} — 분류축 {objs}")
    print("  항목:", " | ".join(f"{r.get('ITM_ID')}:{r.get('ITM_NM')}({r.get('UNIT_NM') or ''})" for r in items[:40]))
    for r in cls[:80]:
        print(f"  {r.get('OBJ_ID')} {r.get('ITM_ID')} {r.get('ITM_NM')} (상위 {r.get('UP_ITM_ID')})")
    if isinstance(prd, list) and prd:
        print("  기간:", ", ".join(sorted({str(p.get('PRD_SE')) + ':' + str(p.get('PRD_DE')) for p in prd}))[:300])
    out[tbl] = {"name": nm, "org": org, "objs": objs, "items": items, "wood_classes": cls}
Path("data/external/kosis_meta.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
