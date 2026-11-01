"""WIDI 변동 해설용 — 키가 필요한 외부 지표 원자료 수집. 화면에는 쓰지 않음.
- UN Comtrade (COMTRADE_KEY): ① 칠레·뉴질랜드·캐나다·핀란드·스웨덴·독일·러시아 제재목(HS 4407) 수출 실적(월) → 산지별 수출단가
                               ② 전 세계 보고국의 러시아산 제재목 수입(월) → 러시아 수출 흐름 우회 추정
  → data/external/comtrade_4407.json
- e-Stat (ESTAT_APP_ID): 일본 목재가격통계(製材品 가격) 표 검색·수집 → data/external/estat_wood_price.json
키 값은 로그에 출력하지 않음."""
import json, os, time, urllib.parse, urllib.request
from pathlib import Path

OUT = Path("data/external")
CT = os.environ.get("COMTRADE_KEY", "").strip()
ES = os.environ.get("ESTAT_APP_ID", "").strip()
print("키 확인:", "Comtrade 있음" if CT else "Comtrade 없음", "/", "e-Stat 있음" if ES else "e-Stat 없음")


def get(url, headers=None, timeout=180):
    req = urllib.request.Request(url, headers={"User-Agent": "WIDI data fetch", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


KEEP = ("period", "reporterCode", "reporterDesc", "partnerCode", "partnerDesc", "flowCode", "cmdCode",
        "primaryValue", "netWgt", "qty", "qtyUnitAbbr", "altQty", "altQtyUnitAbbr")


def comtrade(params):
    base = "https://comtradeapi.un.org/data/v1/get/C/M/HS?"
    for a in range(4):
        try:
            j = get(base + urllib.parse.urlencode(params), {"Ocp-Apim-Subscription-Key": CT}, timeout=300)
            if j.get("error"):
                print("   응답 오류", j.get("error")); return []
            return [{k: d.get(k) for k in KEEP} for d in j.get("data") or []
                    if d.get("motCode") in (0, None) and d.get("customsCode") in ("C00", None) and d.get("partner2Code") in (0, None)]
        except Exception as e:
            print("   재시도", type(e).__name__, str(e)[:80]); time.sleep(5 * (a + 1))
    return []


if CT:
    res = {"exports": [], "imports_from_ru": []}
    exporters = "152,554,124,246,752,276,643"  # 칠레, 뉴질랜드, 캐나다, 핀란드, 스웨덴, 독일, 러시아
    for y in range(2016, 2025):
        periods = ",".join(f"{y}{m:02d}" for m in range(1, 13))
        rows = comtrade({"reporterCode": exporters, "partnerCode": "0", "cmdCode": "4407", "flowCode": "X", "period": periods})
        res["exports"] += rows; print(f" 수출 {y}: {len(rows)}행"); time.sleep(2)
        rows = comtrade({"partnerCode": "643", "cmdCode": "4407", "flowCode": "M", "period": periods})
        res["imports_from_ru"] += rows; print(f" 러시아산 수입 {y}: {len(rows)}행"); time.sleep(2)
    (OUT / "comtrade_4407.json").write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")

if ES:
    found, data = [], {}
    for word in ["木材価格", "製材品 価格"]:
        try:
            j = get("https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList?" + urllib.parse.urlencode({"appId": ES, "searchWord": word, "limit": 50}))
            tl = j["GET_STATS_LIST"]["DATALIST_INF"].get("TABLE_INF", [])
            tl = tl if isinstance(tl, list) else [tl]
            for t in tl:
                title = t.get("TITLE"); title = title.get("$") if isinstance(title, dict) else title
                stat = t.get("STAT_NAME", {}).get("$")
                cyc = t.get("CYCLE")
                found.append({"id": t.get("@id"), "stat": stat, "title": title, "cycle": cyc, "survey": t.get("SURVEY_DATE"), "open": t.get("OPEN_DATE")})
                print(f"  [{word}] {t.get('@id')} | {stat} | {title} | {cyc}")
        except Exception as e:
            print(f"[{word}] 검색 오류 {type(e).__name__} {str(e)[:80]}")
    seen = set()
    for f in found:
        t = f["title"] or ""
        if f["id"] in seen or "木材統計" not in (f["stat"] or "") or "月別" not in t:
            continue
        seen.add(f["id"])
        if not any(w in t for w in ("木材製品卸売価格", "製材用素材価格")):
            continue
        try:
            j = get("https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData?" + urllib.parse.urlencode({"appId": ES, "statsDataId": f["id"], "limit": 100000}))
            sd = j["GET_STATS_DATA"]["STATISTICAL_DATA"]
            data[f["id"]] = {"meta": f, "class": sd.get("CLASS_INF"), "values": sd.get("DATA_INF", {}).get("VALUE", [])}
            print(f"  {f['id']} {f['title']}: {len(data[f['id']]['values'])}값")
        except Exception as e:
            print(f"  {f['id']} 오류 {type(e).__name__} {str(e)[:80]}")
        if len(data) >= 30:
            break
        time.sleep(1)
    (OUT / "estat_wood_price.json").write_text(json.dumps({"search": found, "data": data}, ensure_ascii=False), encoding="utf-8")
