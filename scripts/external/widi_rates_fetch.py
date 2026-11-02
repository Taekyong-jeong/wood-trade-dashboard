"""WIDI 변동 해설용 — 금리·건설공사비 원자료 수집 (KOSIS). 화면에는 쓰지 않음.
(widi_domestic_fetch.py와 같은 방식)
- 한국은행 생산자물가지수·수입물가지수(기본분류, 월): 목재 관련 품목만 남김 (+ 총지수·공산품)
- 통계청 광업제조업동향조사 산업별 생산·출하·재고지수(월): 목재 관련 업종만 남김
- 산림청 가격 관련 표(목재·원목·제재목 가격): 있으면 원자료 그대로
결과: data/external/kosis_rates.json (표별 원자료), data/external/kosis_rates_search.json (검색 기록)
키: 환경변수 KOSIS_API_KEY (로그에 출력하지 않음)."""
import json, os, sys, time, urllib.parse, urllib.request
from pathlib import Path

OUT = Path("data/external")
KEY = os.environ.get("KOSIS_API_KEY", "").strip()
if not KEY:
    sys.exit("KOSIS_API_KEY 없음")

WOOD = ("목재", "제재", "합판", "원목", "나무", "집성", "보드", "섬유판", "베니어", "단판", "펠릿", "칩")
BASE = ("총지수", "공산품")


def kosis(url, params, tries=3):
    q = urllib.parse.urlencode({**params, "apiKey": KEY, "format": "json", "jsonVD": "Y"})
    for a in range(tries):
        try:
            with urllib.request.urlopen(url + "?" + q, timeout=180) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:
            print("   재시도", type(e).__name__); time.sleep(5 * (a + 1))
    return {"err": "network"}


def search(term, n=60):
    d = kosis("https://kosis.kr/openapi/statisticsSearch.do", {"method": "getList", "searchNm": term, "sort": "RANK", "startCount": 1, "resultCount": n})
    return d if isinstance(d, list) else []


def periods(org, tid):
    prd = kosis("https://kosis.kr/openapi/statisticsData.do", {"method": "getMeta", "type": "PRD", "orgId": org, "tblId": tid})
    return sorted({str(p.get("PRD_SE")) for p in prd}) if isinstance(prd, list) else []


def fetch(org, tid, prd_se, keep=None):
    meta = kosis("https://kosis.kr/openapi/statisticsData.do", {"method": "getMeta", "type": "ITM", "orgId": org, "tblId": tid})
    if isinstance(meta, dict):
        raise RuntimeError(str(meta.get("err")))
    axes = sorted({m["OBJ_ID"] for m in meta if m.get("OBJ_ID") != "ITEM"})
    spans = [(f"{y}01", f"{y}12") for y in range(2016, 2027)] if prd_se == "M" else [("2010", "2026")]
    rows = []
    for a, b in spans:
        p = {"method": "getList", "orgId": org, "tblId": tid, "itmId": "ALL", "prdSe": prd_se, "startPrdDe": a, "endPrdDe": b}
        for k in range(1, len(axes) + 1):
            p[f"objL{k}"] = "ALL"
        data = kosis("https://kosis.kr/openapi/Param/statisticsParameterData.do", p)
        if isinstance(data, dict):
            print(f"    {tid} {a}: {data.get('err')} {data.get('errMsg')}"); continue
        for r in data:
            names = " ".join(str(r.get(k) or "") for k in ("C1_NM", "C2_NM", "C3_NM", "ITM_NM"))
            if keep and not any(w in names for w in keep):
                continue
            rows.append({k: r.get(k) for k in ("PRD_DE", "ITM_NM", "UNIT_NM", "C1", "C1_NM", "C2_NM", "C3_NM", "C1_OBJ_NM", "C2_OBJ_NM", "DT")})
        time.sleep(0.5)
    return {"axes": axes, "rows": rows}


log, out = {}, {}
RATE = ("기준금리", "국고채(3년)", "회사채", "주택담보대출", "CD(91일)")
plan = [  # (검색어, 기관(None=전체), 표 이름에 꼭 있어야 할 말, 남길 행 키워드, 최대 표 수)
    ("한국은행 기준금리", "301", ("금리",), RATE, 2),
    ("시장금리", "301", ("금리",), RATE, 2),
    ("예금은행 대출금리", "301", ("대출",), RATE, 1),
    ("건설공사비지수", None, ("공사비",), None, 2),
    ("원/달러 환율", "301", ("환율",), ("미국달러", "원/미국", "USD"), 2),
    ("주요국 통화의 대원화환율", "301", ("환율",), ("미국달러", "원/미국", "USD"), 2),
]
for term, org, must, keep, nmax in plan:
    res = search(term)
    log[term] = [{k: x.get(k) for k in ("ORG_ID", "ORG_NM", "TBL_ID", "TBL_NM", "STRT_PRD_DE", "END_PRD_DE", "PRD_SE")} for x in res]
    for x in res:
        print(f"  [{term}] {x.get('ORG_NM')}({x.get('ORG_ID')}) | {x.get('TBL_ID')} | {x.get('TBL_NM')} | {x.get('STRT_PRD_DE')}~{x.get('END_PRD_DE')}")
    cands = [x for x in res if (org is None or str(x.get("ORG_ID")) == org) and all(m in (x.get("TBL_NM") or "") for m in must) and x["TBL_ID"] not in out]
    cands.sort(key=lambda x: (-("기본분류" in (x.get("TBL_NM") or "")), -("산업별" in (x.get("TBL_NM") or ""))))
    got = 0
    for x in cands:
        if got >= nmax:
            break
        tid, nm = x["TBL_ID"], x.get("TBL_NM"); o = str(x.get("ORG_ID"))
        ses = periods(o, tid)
        se = "M" if ("M" in ses or "월" in ses) else ("Y" if ("Y" in ses or "년" in ses) else None)
        if se != "M":
            print(f"  {tid} {nm}: 월별 없음 {ses}"); continue
        if not se:
            continue
        try:
            t = fetch(o, tid, se, keep)
            if t["rows"]:
                out[tid] = {"org": o, "name": nm, "prd_se": se, **t}
                got += 1
                print(f"  → {tid} {nm}: {len(t['rows'])}행 저장 ({se})")
            else:
                print(f"  {tid} {nm}: 해당 행 없음")
        except Exception as e:
            print(f"  {tid} {nm}: 오류 {type(e).__name__} {str(e)[:80]}")

(OUT / "kosis_rates_search.json").write_text(json.dumps(log, ensure_ascii=False, indent=1), encoding="utf-8")
(OUT / "kosis_rates.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
print("저장 표:", {k: (v["name"], len(v["rows"])) for k, v in out.items()})
