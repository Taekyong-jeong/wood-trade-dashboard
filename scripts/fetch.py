"""
관세청 품목별 국가별 수출입실적(GW) 수집기
==========================================

호출 단위: (국가, 월) 1회
  - cntyCd 지정 + hsSgn 생략 → 해당 국가·월의 HSK 10단위 전 품목이 내려온다
  - 그중 44류(목재)만 골라 저장하고, 국가별 전체 총계 행은 따로 저장한다

모드
  probe    : 1회만 호출해 인증키·응답 구조를 확인 (값은 출력하지 않음)
  backfill : 아직 수집하지 않은 달을 최신 → 과거 순으로 채움 (일일 한도 내)
  monthly  : 최신월 전체 국가 수집 + 최근 12개월 재수집 (잠정치→확정치 반영)

저장 구조
  data/raw/YYYY/YYYYMM.csv         44류 국가×HSK10 원본 (완성된 달만)
  data/raw/YYYY/YYYYMM_total.csv   국가별 전 품목 총계
  data/state/progress.json         달별 수집 상태
  data/state/partial/YYYYMM.jsonl  수집 중인 달의 임시 파일 (완성되면 삭제)

인증키는 환경변수 DATA_GO_KR_KEY (공공데이터포털 Decoding 키)로만 받는다.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import requests
import yaml

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
STATE_DIR = ROOT / "data" / "state"
PARTIAL_DIR = STATE_DIR / "partial"
PROGRESS_FILE = STATE_DIR / "progress.json"
RUN_LOG = STATE_DIR / "runs.log"
CONFIG = yaml.safe_load((ROOT / "config" / "classification.yaml").read_text(encoding="utf-8"))
SETTINGS = yaml.safe_load((ROOT / "config" / "settings.yaml").read_text(encoding="utf-8"))

API_URL = "https://apis.data.go.kr/1220000/nitemtrade/getNitemtradeList"
CHAPTER = str(CONFIG["chapter"])
FIELDS = ["yyyymm", "cnty", "cnty_name", "hs", "name", "exp_kg", "exp_usd", "imp_kg", "imp_usd"]
TOTAL_FIELDS = ["yyyymm", "cnty", "cnty_name", "exp_kg", "exp_usd", "imp_kg", "imp_usd"]

# 공공데이터포털 공통 오류 중 "더 호출해도 소용없는" 것들 → 즉시 중단
FATAL_CODES = {
    "20": "서비스 접근 거부",
    "22": "일일 호출 한도 초과",
    "30": "등록되지 않은 인증키 (승인 직후라면 1~2시간 뒤 재시도)",
    "31": "활용기간 만료",
    "32": "등록되지 않은 IP",
}


class FatalAPIError(Exception):
    pass


# ── 유틸 ──────────────────────────────────────────────────────
def log(msg: str) -> None:
    stamp = dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{stamp}] {msg}"
    print(line, flush=True)
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with RUN_LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def num(text: str | None) -> float:
    if text is None:
        return 0.0
    t = str(text).replace(",", "").strip()
    if t in ("", "-"):
        return 0.0
    try:
        return float(t)
    except ValueError:
        return 0.0


def month_list(start: str, end: str) -> list[str]:
    y, m = int(start[:4]), int(start[4:])
    ey, em = int(end[:4]), int(end[4:])
    out = []
    while (y, m) <= (ey, em):
        out.append(f"{y:04d}{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def latest_available_month(today: dt.date | None = None) -> str:
    """관세청은 매월 15일경 전월 자료를 현행화한다 → 16일 이후면 전월, 아니면 전전월."""
    today = today or dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date()
    back = 1 if today.day >= SETTINGS["publish_day"] else 2
    y, m = today.year, today.month - back
    while m <= 0:
        y, m = y - 1, m + 12
    return f"{y:04d}{m:02d}"


def load_countries() -> list[tuple[str, str]]:
    with (ROOT / "config" / "countries.csv").open(encoding="utf-8") as f:
        return [(r["code"], r["name_ko"]) for r in csv.DictReader(f)]


def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        return json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
    return {}


def save_progress(p: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    PROGRESS_FILE.write_text(json.dumps(p, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")


# ── API 호출 ──────────────────────────────────────────────────
def call_api(key: str, yyyymm: str, cnty: str, session: requests.Session) -> list[dict]:
    params = {"serviceKey": key, "strtYymm": yyyymm, "endYymm": yyyymm, "cntyCd": cnty}
    last_err = ""
    for attempt in range(1, SETTINGS["retry_max"] + 1):
        try:
            r = session.get(API_URL, params=params, timeout=SETTINGS["timeout_sec"])
        except requests.RequestException as e:
            last_err = f"network: {type(e).__name__}"
            time.sleep(2 ** attempt)
            continue
        if r.status_code >= 500:
            last_err = f"HTTP {r.status_code}"
            time.sleep(2 ** attempt)
            continue
        body = r.content
        try:
            root = ET.fromstring(body)
        except ET.ParseError:
            text = body[:200].decode("utf-8", "replace")
            if "SERVICE_KEY" in text or "SERVICE ERROR" in text.upper():
                raise FatalAPIError(f"인증 오류 응답: {text}")
            last_err = "XML parse error"
            time.sleep(2 ** attempt)
            continue

        # 게이트웨이 공통 오류 형식 (OpenAPI_ServiceResponse)
        reason = root.findtext(".//returnReasonCode")
        if reason and reason != "00":
            raise FatalAPIError(f"게이트웨이 오류 {reason}: {FATAL_CODES.get(reason, root.findtext('.//returnAuthMsg'))}")

        code = (root.findtext(".//resultCode") or "").strip()
        msg = (root.findtext(".//resultMsg") or "").strip()
        if code in FATAL_CODES:
            raise FatalAPIError(f"오류 {code}: {FATAL_CODES[code]} ({msg})")
        if code not in ("00", "0", ""):
            if code == "03" or "NODATA" in msg.upper():   # 자료 없음
                return []
            last_err = f"resultCode {code} {msg}"
            time.sleep(2 ** attempt)
            continue

        items = []
        for it in root.iter("item"):
            items.append({c.tag: (c.text or "").strip() for c in it})
        return items
    raise RuntimeError(f"{yyyymm} {cnty} 재시도 실패: {last_err}")


def split_items(items: list[dict], yyyymm: str, cnty: str, cnty_name: str):
    """44류 행과 총계 행을 분리."""
    rows, total = [], None
    for it in items:
        hs = it.get("hsCd", "").strip()
        rec = {
            "yyyymm": yyyymm,
            "cnty": it.get("statCd", cnty).strip() or cnty,
            "cnty_name": it.get("statCdCntnKor1", cnty_name).strip() or cnty_name,
            "exp_kg": num(it.get("expWgt")),
            "exp_usd": num(it.get("expDlr")),
            "imp_kg": num(it.get("impWgt")),
            "imp_usd": num(it.get("impDlr")),
        }
        if not hs.isdigit():                       # 총계 행 ('-', '총계' 등)
            total = rec
            continue
        if hs.startswith(CHAPTER):
            rec["hs"] = hs
            rec["name"] = it.get("statKor", "").strip()
            rows.append(rec)
    return rows, total


# ── 수집 루프 ─────────────────────────────────────────────────
def partial_path(yyyymm: str) -> Path:
    return PARTIAL_DIR / f"{yyyymm}.jsonl"


def finalize_month(yyyymm: str, progress: dict) -> None:
    rows, totals = [], []
    with partial_path(yyyymm).open(encoding="utf-8") as f:
        for line in f:
            rec = json.loads(line)
            rows.extend(rec["rows"])
            if rec["total"]:
                totals.append(rec["total"])
    out_dir = RAW_DIR / yyyymm[:4]
    out_dir.mkdir(parents=True, exist_ok=True)
    rows.sort(key=lambda r: (r["cnty"], r["hs"]))
    with (out_dir / f"{yyyymm}.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    totals.sort(key=lambda r: r["cnty"])
    with (out_dir / f"{yyyymm}_total.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=TOTAL_FIELDS)
        w.writeheader()
        w.writerows(totals)
    partial_path(yyyymm).unlink()
    progress[yyyymm] = {
        "complete": True,
        "fetched_at": dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).isoformat(timespec="seconds"),
        "countries": progress.get(yyyymm, {}).get("target_n"),
        "rows": len(rows),
    }
    log(f"{yyyymm} 완료: 44류 {len(rows)}행, 총계 {len(totals)}개국")


DEADLINE = [float("inf")]   # 실행 시간 예산 (time.time() 기준)


def fetch_month(key, yyyymm, countries, progress, budget, session) -> int:
    """한 달을 수집. 사용한 호출 수를 반환. 예산이 다하면 중간 저장 후 반환."""
    st = progress.setdefault(yyyymm, {})
    st["complete"] = False
    done = set(st.get("done", []))
    st["target_n"] = len(countries)
    PARTIAL_DIR.mkdir(parents=True, exist_ok=True)
    if not done and partial_path(yyyymm).exists():
        partial_path(yyyymm).unlink()             # 이전에 버려진 임시 파일 정리
    used = 0
    with partial_path(yyyymm).open("a", encoding="utf-8") as f:
        for code, name in countries:
            if code in done:
                continue
            if used >= budget or time.time() > DEADLINE[0]:
                break
            items = call_api(key, yyyymm, code, session)
            used += 1
            rows, total = split_items(items, yyyymm, code, name)
            f.write(json.dumps({"cnty": code, "rows": rows, "total": total}, ensure_ascii=False) + "\n")
            done.add(code)
            time.sleep(SETTINGS["delay_sec"])
    st["done"] = sorted(done)
    if len(done) >= len(countries):
        st.pop("done", None)
        finalize_month(yyyymm, progress)
    save_progress(progress)
    return used


def active_countries(all_countries, months_back: int = 36) -> list[tuple[str, str]]:
    """최근 N개월 동안 44류 교역이 한 번이라도 있었던 국가 (재수집 대상 축소용)."""
    files = sorted(RAW_DIR.glob("*/??????.csv"))[-months_back:]
    seen = set()
    for p in files:
        with p.open(encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if num(r["imp_usd"]) or num(r["exp_usd"]):
                    seen.add(r["cnty"])
    return [c for c in all_countries if c[0] in seen] or all_countries


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["probe", "backfill", "monthly"], required=True)
    ap.add_argument("--max-calls", type=int, default=SETTINGS["max_calls_per_run"])
    ap.add_argument("--max-minutes", type=float, default=SETTINGS["max_minutes_per_run"])
    args = ap.parse_args()
    DEADLINE[0] = time.time() + args.max_minutes * 60

    key = os.environ.get("DATA_GO_KR_KEY", "").strip()
    if not key:
        log("DATA_GO_KR_KEY 환경변수가 없음 → GitHub Secrets 설정 확인")
        return 2

    countries = load_countries()
    progress = load_progress()
    latest = latest_available_month()
    session = requests.Session()

    try:
        if args.mode == "probe":
            items = call_api(key, latest, "US", session)
            rows, total = split_items(items, latest, "US", "미국")
            log(f"[probe] {latest} 미국: 전체 {len(items)}행, 44류 {len(rows)}행, 총계행 {'있음' if total else '없음'}")
            if items:
                log(f"[probe] 응답 필드: {sorted(items[0].keys())}")
            for r in rows[:5]:
                log(f"[probe] 예시: {r['hs']} {r['name'][:30]}")
            return 0 if items else 1

        budget = args.max_calls
        used_total = 0
        all_months = month_list(SETTINGS["start_month"], latest)

        if args.mode == "monthly":
            # 1) 최신월 미완성이면 전체 국가로 수집
            # 2) 최근 12개월 재수집 (활동 국가만) — refresh 플래그로 진행 관리
            refresh = all_months[-SETTINGS["refresh_months"]:]
            act = active_countries(countries)
            for m in reversed(all_months):
                if budget - used_total <= 0 or time.time() > DEADLINE[0]:
                    break
                st = progress.get(m, {})
                if m == latest and not st.get("complete"):
                    used_total += fetch_month(key, m, countries, progress, budget - used_total, session)
                elif m in refresh and st.get("refreshed_for") != latest:
                    if st.get("complete") and "done" not in st:
                        st["complete"] = False
                    used_total += fetch_month(key, m, act if m != latest else countries,
                                              progress, budget - used_total, session)
                    if progress[m].get("complete"):
                        progress[m]["refreshed_for"] = latest
                        save_progress(progress)

        # backfill (monthly 모드에서도 남은 예산으로 계속 채움)
        for m in reversed(all_months):
            if budget - used_total <= 0 or time.time() > DEADLINE[0]:
                break
            if progress.get(m, {}).get("complete"):
                continue
            used_total += fetch_month(key, m, countries, progress, budget - used_total, session)

    except FatalAPIError as e:
        save_progress(progress)
        log(f"중단: {e}")
        return 3

    complete = sum(1 for m in month_list(SETTINGS["start_month"], latest) if progress.get(m, {}).get("complete"))
    target = len(month_list(SETTINGS["start_month"], latest))
    log(f"{args.mode} 종료: 호출 {used_total}회, 완성 {complete}/{target}개월 (최신 {latest})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
