"""목재산업 화면용 — 통계청(KOSIS) 산업 통계 수집 (원자료 그대로, 목재 업종·품목만 남김).
- DT_1FS1101 광업제조업조사 주요지표 (연): C16 목재 및 나무제품 제조업과 하위 업종 — 사업체수·종사자수·급여액·출하액·주요생산비·부가가치·유형자산
  (C16 전체는 시도별까지, 하위 업종은 전국만)
- DT_1F02001 시도/산업별 광공업생산지수 (월): C16·C161·C162, 전국 — 생산·출하·재고 지수
- DT_1F32001 제조업 생산능력 및 가동률지수 (월): C16·C161·C162
- DT_1F02012 품목별 광공업 생산·출하·재고·내수·수출량 (월): 목재 품목만
- 광업제조업조사 품목편 (연, 표가 해마다 따로): 목재 품목 생산액·출하액
결과: data/external/kosis_industry.json  키: 환경변수 KOSIS_API_KEY (로그에 출력하지 않음)."""
import json, os, sys, time, urllib.parse, urllib.request
from pathlib import Path

KEY = os.environ.get("KOSIS_API_KEY", "").strip()
if not KEY:
    sys.exit("KOSIS_API_KEY 없음")
OUT = Path("data/external/kosis_industry.json")
WOOD = ("목재", "나무", "제재", "합판", "보드", "섬유판", "MDF", "집성", "단판", "마루", "칩", "펠릿", "방부", "적재판", "깔판", "팔레트", "파렛트")


def kosis(url, params, tries=3):
    q = urllib.parse.urlencode({**params, "apiKey": KEY, "format": "json", "jsonVD": "Y"})
    for a in range(tries):
        try:
            with urllib.request.urlopen(url + "?" + q, timeout=180) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:
            print("   재시도", type(e).__name__); time.sleep(5 * (a + 1))
    return {"err": "network"}


def meta(org, tid):
    m = kosis("https://kosis.kr/openapi/statisticsData.do", {"method": "getMeta", "type": "ITM", "orgId": org, "tblId": tid})
    return m if isinstance(m, list) else []


def data(org, tid, prd_se, a, b, objs, itm="ALL"):
    p = {"method": "getList", "orgId": org, "tblId": tid, "itmId": itm, "prdSe": prd_se, "startPrdDe": a, "endPrdDe": b}
    for k, v in enumerate(objs, 1):
        p[f"objL{k}"] = v
    d = kosis("https://kosis.kr/openapi/Param/statisticsParameterData.do", p)
    if isinstance(d, dict):
        multi = [i for i, v in enumerate(objs) if "+" in v]
        if multi:   # 여러 코드 한꺼번에 안 되면 하나씩
            i = multi[0]; rows = []
            for c in objs[i].split("+"):
                rows += data(org, tid, prd_se, a, b, objs[:i] + [c] + objs[i + 1:], itm)
            return rows
        print(f"    {tid} {a}~{b} {objs}: {d.get('err')} {d.get('errMsg')}")
        return []
    time.sleep(0.4)
    return [{k: r.get(k) for k in ("PRD_DE", "ITM_ID", "ITM_NM", "UNIT_NM", "C1", "C1_NM", "C2", "C2_NM", "C3", "C3_NM", "DT")} for r in d]


def axes_of(m):
    ax = {}
    for r in m:
        if r.get("OBJ_ID") != "ITEM":
            ax.setdefault(r["OBJ_ID"], {"name": r.get("OBJ_NM"), "sn": int(r.get("OBJ_ID_SN") or 0), "items": []})["items"].append((r["ITM_ID"], r.get("ITM_NM") or ""))
    return dict(sorted(ax.items(), key=lambda kv: kv[1]["sn"]))


def pick_total(items):
    for c, n in items:
        if n.strip() in ("전국", "계", "합계", "전체"):
            return c
    return items[0][0]


out = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}


def save(tid, name, rows, note=""):
    if rows:
        out[tid] = {"name": name, "note": note, "rows": rows}
        print(f"  {tid} {name}: {len(rows)}행")
        OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    else:
        print(f"  {tid} {name}: 0행 (기존 유지)")


def years_m(y0):
    import datetime
    y1 = datetime.date.today().year
    return [(f"{y}01", f"{y}12") for y in range(y0, y1 + 1)]


# 1) 광업제조업조사 주요지표 (연)
tid = "DT_1FS1101"; m = meta("101", tid); ax = axes_of(m)
if ax:
    keys = list(ax)
    reg = [k for k in keys if "시도" in ax[k]["name"] or "행정" in ax[k]["name"]]
    ind = [k for k in keys if "산업" in ax[k]["name"]]
    print(tid, {k: ax[k]["name"] for k in keys})
    if reg and ind:
        nat = pick_total(ax[reg[0]]["items"])
        codes = [c for c, _ in ax[ind[0]]["items"] if c.startswith("C16")]
        rows = []
        for c in codes:
            objs = ["ALL" if c == "C16" else nat, c] if keys.index(reg[0]) < keys.index(ind[0]) else [c, "ALL" if c == "C16" else nat]
            rows += data("101", tid, "Y", "2006", "2026", objs)
        save(tid, "광업제조업조사 주요지표 (C16 목재 및 나무제품 제조업)", rows, "C16은 시도별, 하위 업종은 전국")

# 2) 시도/산업별 광공업생산지수 (월)  3) 생산능력·가동률지수 (월)
for tid, nm in (("DT_1F02001", "시도/산업별 광공업생산지수(2020=100)"), ("DT_1F32001", "제조업 생산능력 및 가동률지수")):
    m = meta("101", tid); ax = axes_of(m)
    if not ax:
        print(tid, "메타 없음"); continue
    print(tid, {k: (v["name"], len(v["items"])) for k, v in ax.items()})
    objs = []
    for k, v in ax.items():
        if "산업" in v["name"]:
            objs.append("+".join(c for c, _ in v["items"] if c in ("C16", "C161", "C162")) or "ALL")
        else:
            objs.append(pick_total(v["items"]))
    rows = []
    for a, b in years_m(2010):
        rows += data("101", tid, "M", a, b, objs)
    save(tid, nm, rows, "C16·C161·C162, 전국")

# 4) 품목별 광공업 생산·출하·재고·내수·수출량 (월) — 목재 품목만
tid = "DT_1F02012"; m = meta("101", tid); ax = axes_of(m)
if ax:
    print(tid, {k: (v["name"], len(v["items"])) for k, v in ax.items()})
    objs = []
    for k, v in ax.items():
        if "품목" in v["name"]:
            w = [c for c, n in v["items"] if any(x in n for x in WOOD)]
            print("   목재 품목:", [n for c, n in v["items"] if c in w])
            objs.append("+".join(w) if w else "")
        else:
            objs.append(pick_total(v["items"]))
    if all(objs):
        rows = []
        for a, b in years_m(2010):
            rows += data("101", tid, "M", a, b, objs)
        save(tid, "품목별 광공업 생산·출하·재고·내수·수출량 (목재 품목)", rows)

# 5) 광업제조업조사 품목편 (연) — 표 ID를 검색으로 찾음
srch = kosis("https://kosis.kr/openapi/statisticsSearch.do", {"method": "getList", "searchNm": "광업제조업조사 품목편", "sort": "RANK", "startCount": 1, "resultCount": 60})
pts = sorted({(x["TBL_ID"], x.get("TBL_NM")) for x in (srch if isinstance(srch, list) else []) if str(x.get("ORG_ID")) == "101" and "품목" in (x.get("TBL_NM") or "")})
print("품목편 후보:", pts[:20])
for tid, nm in pts:
    m = meta("101", tid); ax = axes_of(m)
    if not ax:
        continue
    objs, ok = [], True
    for k, v in ax.items():
        if "품목" in v["name"]:
            w = [c for c, n in v["items"] if c.startswith("C16") or (any(x in n for x in ("숯", "목탄", "펠릿")) and c.startswith("C"))]
            objs.append("+".join(w)); ok = ok and bool(w)
        else:
            objs.append(pick_total(v["items"]))
    if ok:
        save(tid, nm, data("101", tid, "Y", "2006", "2026", objs), "목재 품목(C16 계열 + 숯·펠릿), 전국")
print("완료")
