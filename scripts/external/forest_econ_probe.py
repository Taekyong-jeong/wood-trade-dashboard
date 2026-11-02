"""국립산림과학원 「임업경제동향」 OpenAPI 탐색 (공공데이터포털 15083696)
- 국내 원목 가격: /domesticRoundwoodPrice (year, month, standard 1~20)
- 수입 원목 가격: 작업 이름이 명세 페이지에 없어 후보 이름을 차례로 시도
결과(응답 원문 일부, 상태)를 data/external/forest_econ_probe.json에 저장. 인증키는 저장·출력하지 않음.
"""
import json, os, pathlib, time
import urllib.parse, urllib.request

BASE = "https://apis.data.go.kr/1400377/trendsOnForestryEconomics"
KEY = os.environ.get("FOREST_KEY", "").strip()
OUT = pathlib.Path(__file__).resolve().parents[2] / "data" / "external" / "forest_econ_probe.json"


def call(op, **p):
    q = urllib.parse.urlencode({"serviceKey": KEY, "_type": "json", **p})
    try:
        with urllib.request.urlopen(f"{BASE}/{op}?{q}", timeout=30) as r:
            body = r.read().decode("utf-8", "replace")
            return r.status, body
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return None, f"{type(e).__name__}: {e}"


def main():
    res = {"key_source": os.environ.get("KEY_SOURCE", ""), "key_present": bool(KEY), "domestic": [], "import_candidates": []}
    if KEY:
        for std in range(1, 21):
            st, body = call("domesticRoundwoodPrice", year=2024, month=6, standard=std)
            res["domestic"].append({"standard": std, "status": st, "body": body[:1500]})
            time.sleep(0.3)
        for y, m in [(2003, 1), (2015, 6), (2026, 8)]:
            st, body = call("domesticRoundwoodPrice", year=y, month=m, standard=1)
            res["domestic"].append({"year": y, "month": m, "standard": 1, "status": st, "body": body[:1500]})
        for op in ["importedRoundwoodPrice", "importRoundwoodPrice", "importRoundwoodPriceList", "importedLogPrice",
                   "foreignRoundwoodPrice", "overseasRoundwoodPrice", "importedRoundWoodPrice", "incomeRoundwoodPrice"]:
            st, body = call(op, year=2024, month=6, standard=1)
            res["import_candidates"].append({"op": op, "status": st, "body": body[:800]})
            time.sleep(0.3)
    OUT.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print("저장:", OUT, "키 있음" if KEY else "키 없음")


if __name__ == "__main__":
    main()
