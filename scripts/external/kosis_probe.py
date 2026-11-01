"""KOSIS 통합검색으로 목재 관련 통계표 목록 확인 (키는 환경변수 KOSIS_API_KEY, 로그에 출력하지 않음).
결과는 data/external/kosis_probe.json 에 저장 — 표 이름·기관·기간만 담음."""
import json, os, sys, urllib.parse, urllib.request
from pathlib import Path

KEY = os.environ.get("KOSIS_API_KEY", "").strip()
if not KEY:
    sys.exit("KOSIS_API_KEY 없음")
TERMS = ["목재 및 나무제품 제조업", "제재목", "합판", "파티클보드", "섬유판", "집성재", "목재펠릿",
         "광업제조업조사 품목", "생산자물가지수 목재", "수입물가지수 목재"]
out = {}
for term in TERMS:
    q = urllib.parse.urlencode({"method": "getList", "apiKey": KEY, "searchNm": term, "sort": "RANK",
                                "startCount": 1, "resultCount": 30, "format": "json", "jsonVD": "Y"})
    try:
        with urllib.request.urlopen("https://kosis.kr/openapi/statisticsSearch.do?" + q, timeout=60) as r:
            raw = r.read().decode("utf-8", "replace")
        data = json.loads(raw)
    except Exception as e:  # 오류 메시지에 URL(키 포함)이 섞이지 않게 종류만 기록
        out[term] = {"error": type(e).__name__}
        print(f"[{term}] 오류 {type(e).__name__}")
        continue
    if isinstance(data, dict):            # 오류 응답 {"err": "...", "errMsg": "..."}
        out[term] = {"error": {k: v for k, v in data.items() if k in ("err", "errMsg")}}
        print(f"[{term}] 응답 오류 {out[term]['error']}")
        continue
    rows = [{k: d.get(k) for k in ("ORG_ID", "ORG_NM", "TBL_ID", "TBL_NM", "STAT_ID", "STAT_NM", "STRT_PRD_DE", "END_PRD_DE", "PRD_SE")} for d in data]
    out[term] = rows
    print(f"[{term}] {len(rows)}건")
    for d in rows:
        print(f"  {d['ORG_NM']} | {d['TBL_ID']} | {d['TBL_NM']} | {d.get('STRT_PRD_DE')}~{d.get('END_PRD_DE')}")
Path("data/external/kosis_probe.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
