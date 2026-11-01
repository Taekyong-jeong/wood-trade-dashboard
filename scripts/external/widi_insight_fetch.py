"""WIDI 변동 해설용 외부 지표(키 불필요 + KOSIS) 원자료 수집. 화면에는 쓰지 않음.
- Eurostat 산업 생산자물가(월, 제재업 NACE C16.1) → data/external/eurostat_ppi_c161.json
- 캐나다 통계청 제재목 생산·출하·재고(월) → data/external/statcan_lumber.csv (캐나다 전체만)
- KOSIS 제재목 용도별 판매량(산림청 실태조사) → data/external/kosis_sawn_use.json
- KOSIS 건설기성액(월) 검색·수집 → data/external/kosis_construction_done.json
KOSIS 키: 환경변수 KOSIS_API_KEY (로그에 출력하지 않음)."""
import csv, io, json, os, urllib.parse, urllib.request, zipfile
from pathlib import Path

OUT = Path("data/external")
UA = {"User-Agent": "Mozilla/5.0 (WIDI data fetch)"}


def http(url, timeout=180):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


# 1) Eurostat — 국내시장 생산자물가, 월별, 제재업
try:
    q = urllib.parse.urlencode([("format", "JSON"), ("lang", "EN"), ("nace_r2", "C161"), ("sinceTimePeriod", "2015-01")])
    raw = http("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sts_inppd_m?" + q)
    (OUT / "eurostat_ppi_c161.json").write_bytes(raw)
    d = json.loads(raw)
    print("Eurostat 차원:", {k: len(v["category"]["index"]) for k, v in d["dimension"].items()}, "값", len(d.get("value", {})))
except Exception as e:
    print("Eurostat 오류", type(e).__name__, str(e)[:120])

# 2) 캐나다 통계청 — 제재목 생산·출하·재고 (표 번호 후보를 차례로 시도)
for pid in ["16100017", "16100045"]:
    try:
        meta = json.loads(http(f"https://www150.statcan.gc.ca/t1/wds/rest/getFullTableDownloadCSV/{pid}/en"))
        url = meta.get("object")
        z = zipfile.ZipFile(io.BytesIO(http(url, timeout=300)))
        name = [n for n in z.namelist() if n.endswith(".csv") and "MetaData" not in n][0]
        rows = list(csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8-sig")))
        keep = [r for r in rows if r.get("GEO") == "Canada" and r.get("REF_DATE", "") >= "2015"]
        if not keep:
            print(f"StatCan {pid}: 캐나다 전체 행 없음"); continue
        cols = [c for c in keep[0].keys() if c not in ("DGUID", "UOM_ID", "SCALAR_ID", "VECTOR", "COORDINATE", "STATUS", "SYMBOL", "TERMINATED", "DECIMALS")]
        with open(OUT / "statcan_lumber.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=["TABLE"] + cols); w.writeheader()
            for r in keep:
                w.writerow({"TABLE": pid, **{c: r[c] for c in cols}})
        print(f"StatCan {pid}: {len(keep)}행, 열 {cols}")
        break
    except Exception as e:
        print(f"StatCan {pid} 오류", type(e).__name__, str(e)[:120])

# 3·4) KOSIS
KEY = os.environ.get("KOSIS_API_KEY", "").strip()


def kosis(url, params):
    q = urllib.parse.urlencode({**params, "apiKey": KEY, "format": "json", "jsonVD": "Y"})
    return json.loads(http(url + "?" + q).decode("utf-8", "replace"))


def kosis_table(org, tid, prd_se, start, end, by_year=False):
    meta = kosis("https://kosis.kr/openapi/statisticsData.do", {"method": "getMeta", "type": "ITM", "orgId": org, "tblId": tid})
    if isinstance(meta, dict):
        raise RuntimeError(str(meta.get("err")))
    axes = sorted({m["OBJ_ID"] for m in meta if m.get("OBJ_ID") != "ITEM"})
    spans = [(f"{y}01", f"{y}12") for y in range(int(start[:4]), int(end[:4]) + 1)] if by_year else [(start, end)]
    rows = []
    for a, b in spans:
        p = {"method": "getList", "orgId": org, "tblId": tid, "itmId": "ALL", "prdSe": prd_se, "startPrdDe": a, "endPrdDe": b}
        for k in range(1, len(axes) + 1):
            p[f"objL{k}"] = "ALL"
        data = kosis("https://kosis.kr/openapi/Param/statisticsParameterData.do", p)
        if isinstance(data, dict):
            print(f"    {tid} {a}: {data.get('err')} {data.get('errMsg')}"); continue
        rows += [{k: r.get(k) for k in ("PRD_DE", "ITM_NM", "UNIT_NM", "C1_NM", "C2_NM", "C3_NM", "C1_OBJ_NM", "C2_OBJ_NM", "DT")} for r in data]
    return {"axes": axes, "rows": rows}


if not KEY:
    print("KOSIS_API_KEY 없음 — KOSIS 단계 건너뜀")
else:
    try:
        t = kosis_table("136", "DT_136034_2024_A050", "Y", "2020", "2025")
        (OUT / "kosis_sawn_use.json").write_text(json.dumps(t, ensure_ascii=False, indent=1), encoding="utf-8")
        print("제재목 용도별 판매량:", len(t["rows"]), "행")
    except Exception as e:
        print("제재목 용도별 판매량 오류", type(e).__name__, str(e)[:120])
    out, found = {}, {}
    for term in ["건설기성액", "건설경기동향조사 기성", "공종별 건설기성"]:
        try:
            d = kosis("https://kosis.kr/openapi/statisticsSearch.do", {"method": "getList", "searchNm": term, "sort": "RANK", "startCount": 1, "resultCount": 40})
        except Exception as e:
            print(f"[{term}] 검색 오류 {type(e).__name__}"); continue
        if isinstance(d, dict):
            continue
        for x in d:
            print(f"  [{term}] {x.get('ORG_NM')}({x.get('ORG_ID')}) | {x.get('TBL_ID')} | {x.get('TBL_NM')} | {x.get('STRT_PRD_DE')}~{x.get('END_PRD_DE')}")
            if "기성" in (x.get("TBL_NM") or "") and str(x.get("ORG_ID")) == "101":
                found[x["TBL_ID"]] = x.get("TBL_NM")
    for tid, nm in list(found.items())[:4]:
        try:
            prd = kosis("https://kosis.kr/openapi/statisticsData.do", {"method": "getMeta", "type": "PRD", "orgId": "101", "tblId": tid})
            ses = sorted({str(p.get("PRD_SE")) for p in prd}) if isinstance(prd, list) else []
            if "M" not in ses and "월" not in ses:
                print(f"  {tid} {nm}: 월별 없음 {ses}"); continue
            t = kosis_table("101", tid, "M", "201601", "202612", by_year=True)
            out[tid] = {"name": nm, **t}
            print(f"  {tid} {nm}: {len(t['rows'])}행")
        except Exception as e:
            print(f"  {tid} {nm}: 오류 {type(e).__name__} {str(e)[:80]}")
    (OUT / "kosis_construction_done.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
