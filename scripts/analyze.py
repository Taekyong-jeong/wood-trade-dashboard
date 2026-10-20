"""
지표 계산 → docs/data/*.json, *.csv

입력 : data/raw/YYYY/YYYYMM.csv (44류 국가×HSK10), config/classification.yaml
출력 :
  docs/data/meta.json       기준월, 갱신일, 수집 범위, 검증 결과, 분류 정의
  docs/data/series.json     분류별 월별 수출입 (금액·중량) + 집중도(HHI, 상위3국)
  docs/data/countries.json  분류별 국가별 연간·최근12개월 수입 (금액·중량)
  docs/data/insights.json   이번 달 요약 문구, 주의 표시 항목
  docs/data/*.csv           다운로드용

종료 코드: 0 정상 / 3 검증 실패 (meta.json만 '갱신 지연'으로 갱신, 나머지 파일 유지)
"""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
OUT_DIR = ROOT / "docs" / "data"
CFG = yaml.safe_load((ROOT / "config" / "classification.yaml").read_text(encoding="utf-8"))
SET = yaml.safe_load((ROOT / "config" / "settings.yaml").read_text(encoding="utf-8"))
KST = dt.timezone(dt.timedelta(hours=9))
MEASURES = ["imp_usd", "imp_kg", "exp_usd", "exp_kg"]

HEADING_NAMES = {
    "4401": "연료용 목재·칩·톱밥·펠릿", "4402": "목탄", "4403": "원목", "4404": "후프우드 등",
    "4405": "목모·목분", "4406": "침목", "4407": "제재목", "4408": "단판",
    "4409": "성형목재(마루재 등)", "4410": "파티클보드·OSB", "4411": "섬유판",
    "4412": "합판·LVL 등", "4413": "강화목재", "4414": "액자", "4415": "포장용기·팔레트",
    "4416": "통", "4417": "공구·자루", "4418": "건축용 목제품", "4419": "식탁·주방용품",
    "4420": "장식품·소품", "4421": "기타 목제품",
}


# ── 분류 ──────────────────────────────────────────────────────
def longest_match(code: str, rules: list[tuple[str, object]]):
    best, best_len = None, -1
    for prefix, val in rules:
        if code.startswith(prefix) and len(prefix) > best_len:
            best, best_len = val, len(prefix)
    return best


def build_classifier():
    group_rules = [(p, g["key"]) for g in CFG["groups"] for p in g["prefixes"]]
    species_rules = [(s["prefix"], (s["level1"], s["level2"])) for s in CFG["species"]]
    product_rules = [(p["key"], p["prefixes"]) for p in CFG["products"]]

    def classify(code: str) -> dict:
        sp = longest_match(code, species_rules) if code[:4] in CFG["species_scope"] else None
        return {
            "group": longest_match(code, group_rules) or "consumer",
            "products": [k for k, ps in product_rules if any(code.startswith(p) for p in ps)],
            "sp1": sp[0] if sp else None,
            "sp2": sp[1] if sp else None,
            "heading": code[:4],
        }
    return classify


# ── 데이터 적재 ──────────────────────────────────────────────
def load_raw() -> pd.DataFrame:
    files = sorted(p for p in RAW_DIR.glob("*/??????.csv"))
    if not files:
        return pd.DataFrame(columns=["yyyymm", "cnty", "cnty_name", "hs", "name"] + MEASURES)
    # keep_default_na=False: 나미비아 국가코드 'NA'가 결측으로 읽히는 것 방지
    df = pd.concat([pd.read_csv(p, dtype=str, keep_default_na=False) for p in files], ignore_index=True)
    for m in MEASURES:
        df[m] = pd.to_numeric(df[m], errors="coerce").fillna(0.0)
    df["month"] = df["yyyymm"].str[:4] + "-" + df["yyyymm"].str[4:]
    return df


def expand_categories(df: pd.DataFrame) -> pd.DataFrame:
    """한 행이 여러 분류축에 속하므로 (axis, key) 긴 형식으로 펼친다."""
    classify = build_classifier()
    cls = {code: classify(code) for code in df["hs"].unique()}
    parts = [df.assign(axis="total", key="all")]
    parts.append(df.assign(axis="group", key=df["hs"].map(lambda c: cls[c]["group"])))
    parts.append(df.assign(axis="heading", key=df["hs"].map(lambda c: cls[c]["heading"])))
    sp1 = df["hs"].map(lambda c: cls[c]["sp1"])
    sp2 = df["hs"].map(lambda c: cls[c]["sp2"])
    parts.append(df[sp1.notna()].assign(axis="species1", key=sp1[sp1.notna()]))
    parts.append(df[sp2.notna()].assign(axis="species2", key=sp2[sp2.notna()]))
    prod = df["hs"].map(lambda c: cls[c]["products"])
    pdf = df.assign(key=prod).explode("key")
    parts.append(pdf[pdf["key"].notna()].assign(axis="product"))
    return pd.concat(parts, ignore_index=True)


# ── 지표 ─────────────────────────────────────────────────────
def hhi_and_top3(share: pd.Series) -> tuple[float, float]:
    s = share[share > 0]
    if s.empty:
        return (np.nan, np.nan)
    return (float((s ** 2).sum() * 10000), float(s.nlargest(3).sum() * 100))


def rolling_concentration(cat: pd.DataFrame, months: list[str]) -> dict:
    """최근 12개월 누적 수입액 기준 HHI·상위3국 점유율 (월별 시계열)."""
    piv = cat.pivot_table(index="month", columns="cnty", values="imp_usd", aggfunc="sum").reindex(months).fillna(0)
    roll = piv.rolling(12, min_periods=12).sum()
    hhi, top3 = [], []
    for m in months:
        row = roll.loc[m]
        tot = row.sum()
        if not np.isfinite(tot) or tot <= 0:
            hhi.append(None); top3.append(None); continue
        h, t = hhi_and_top3(row / tot)
        hhi.append(round(h, 1)); top3.append(round(t, 2))
    return {"hhi": hhi, "top3": top3}


def r(x, nd=0):
    return None if x is None or (isinstance(x, float) and not np.isfinite(x)) else round(float(x), nd)


def build_outputs(df: pd.DataFrame):
    months = sorted(df["month"].unique())
    long = expand_categories(df)

    # 분류별 월별 합계 + 집중도
    series = {}
    for (axis, key), cat in long.groupby(["axis", "key"]):
        g = cat.groupby("month")[MEASURES].sum().reindex(months).fillna(0)
        entry = {m: [r(v) for v in g[m].tolist()] for m in MEASURES}
        entry.update(rolling_concentration(cat, months))
        series.setdefault(axis, {})[key] = entry

    # 분류별 국가별 연간 + 최근 12개월
    last12 = months[-12:]
    long["year"] = long["month"].str[:4]
    countries = {}
    names = df.drop_duplicates("cnty").set_index("cnty")["cnty_name"].to_dict()
    for (axis, key), g in long.groupby(["axis", "key"]):
        yearly = g.groupby(["cnty", "year"])[["imp_usd", "imp_kg", "exp_usd"]].sum()
        l12 = g[g["month"].isin(last12)].groupby("cnty")[["imp_usd", "imp_kg", "exp_usd"]].sum()
        prev12 = g[g["month"].isin(months[-24:-12])].groupby("cnty")[["imp_usd", "imp_kg"]].sum()
        rows = {}
        for c in sorted(set(yearly.index.get_level_values(0))):
            y = yearly.loc[c]
            if y["imp_usd"].sum() <= 0 and y["exp_usd"].sum() <= 0:
                continue
            rows[c] = {
                "y": {yr: [r(v["imp_usd"]), r(v["imp_kg"]), r(v["exp_usd"])] for yr, v in y.iterrows()},
                "l12": [r(l12.loc[c, "imp_usd"]) if c in l12.index else 0,
                        r(l12.loc[c, "imp_kg"]) if c in l12.index else 0,
                        r(l12.loc[c, "exp_usd"]) if c in l12.index else 0],
                "p12": [r(prev12.loc[c, "imp_usd"]) if c in prev12.index else 0,
                        r(prev12.loc[c, "imp_kg"]) if c in prev12.index else 0],
            }
        countries.setdefault(axis, {})[key] = rows

    # HSK 10단위 품목명 (최신 명칭)
    hs_names = (df.sort_values("month").drop_duplicates("hs", keep="last")
                  .set_index("hs")["name"].to_dict())
    return months, series, countries, names, hs_names, long


# ── 요약·알림 ─────────────────────────────────────────────────
def label_of(axis: str, key: str) -> str:
    if axis == "total":
        return "목재류(44류) 전체"
    if axis == "group":
        return next(g["name"] for g in CFG["groups"] if g["key"] == key)
    if axis == "product":
        return next(p["name"] for p in CFG["products"] if p["key"] == key)
    if axis == "heading":
        return f"{key} {HEADING_NAMES.get(key, '')}".strip()
    return key


def pct(a, b):
    return (a / b - 1) * 100 if b else None


def fmt_usd(v):
    if v >= 1e8:
        return f"{v/1e8:,.1f}억 달러"
    if v >= 1e4:
        return f"{v/1e4:,.0f}만 달러"
    return f"{v:,.0f}달러"


def build_insights(months, series, long, names):
    a = CFG["alerts"]
    m0 = months[-1]
    i0 = len(months) - 1
    out = {"month": m0, "summary": [], "alerts": []}
    tot = series["total"]["all"]
    imp = tot["imp_usd"]

    # 1) 전체 규모
    line = f"{m0[:4]}년 {int(m0[5:])}월 목재류 수입액은 {fmt_usd(imp[i0])}"
    if i0 >= 12 and imp[i0 - 12]:
        line += f", 전년 동월 대비 {pct(imp[i0], imp[i0 - 12]):+.1f}%임."
    else:
        line += "임."
    out["summary"].append(line)
    if i0 >= 11:
        s12 = sum(v or 0 for v in imp[i0 - 11:i0 + 1])
        txt = f"최근 12개월 누적 수입액은 {fmt_usd(s12)}"
        if i0 >= 23:
            p12 = sum(v or 0 for v in imp[i0 - 23:i0 - 11])
            txt += f", 직전 12개월 대비 {pct(s12, p12):+.1f}%임."
        else:
            txt += "임."
        out["summary"].append(txt)

    # 2) 품목군 변화 (최근 12개월 vs 직전 12개월)
    if i0 >= 23:
        chg = []
        for k, e in series["group"].items():
            s12 = sum(v or 0 for v in e["imp_usd"][i0 - 11:i0 + 1])
            p12 = sum(v or 0 for v in e["imp_usd"][i0 - 23:i0 - 11])
            if p12 > 1e6:
                chg.append((pct(s12, p12), k))
        if chg:
            chg.sort()
            lo, hi = chg[0], chg[-1]
            out["summary"].append(
                f"최근 12개월 기준 증가율이 가장 높은 품목군은 {label_of('group', hi[1])}({hi[0]:+.1f}%), "
                f"가장 낮은 품목군은 {label_of('group', lo[1])}({lo[0]:+.1f}%)임.")

    # 3) 최대 공급국
    last12 = months[-12:]
    t = long[(long["axis"] == "total") & (long["month"].isin(last12))].groupby("cnty")["imp_usd"].sum()
    if t.sum() > 0:
        top = t.sort_values(ascending=False)
        c1, sh1 = top.index[0], top.iloc[0] / t.sum() * 100
        h = series["total"]["all"]["hhi"][i0]
        level = "" if not h else (" (고집중)" if h >= 2500 else " (중간 집중)" if h >= 1500 else " (분산)")
        out["summary"].append(
            f"최근 12개월 최대 공급국은 {names.get(c1, c1)}(점유율 {sh1:.1f}%)이고, "
            f"공급국 집중도 HHI는 {h:,.0f}{level}임." if h else
            f"최근 12개월 최대 공급국은 {names.get(c1, c1)}(점유율 {sh1:.1f}%)임.")

    # 알림 대상: 전체 + 품목군 + 목재제품
    targets = [("total", "all")] + [("group", g["key"]) for g in CFG["groups"]] + \
              [("product", p["key"]) for p in CFG["products"] if p["prefixes"]]
    cur = long[long["month"] == m0]
    prv = long[long["month"] == (months[-2] if len(months) > 1 else None)]
    hist = long[long["month"].isin(months[-13:-1])]
    for axis, key in targets:
        if key not in series.get(axis, {}):
            continue
        e = series[axis][key]
        lab = label_of(axis, key)
        v0 = e["imp_usd"][i0] or 0
        if v0 < a["min_import_usd"]:
            continue
        c0 = cur[(cur.axis == axis) & (cur.key == key)].groupby("cnty")["imp_usd"].sum()
        sh0 = c0 / c0.sum() * 100 if c0.sum() else c0
        # 점유율 변동
        if len(months) > 1:
            c1 = prv[(prv.axis == axis) & (prv.key == key)].groupby("cnty")["imp_usd"].sum()
            if c1.sum() >= a["min_import_usd"]:
                sh1 = c1 / c1.sum() * 100
                d = sh0.subtract(sh1, fill_value=0)
                for c, dv in d.items():
                    if abs(dv) >= a["share_change_pp"]:
                        out["alerts"].append({"type": "share", "cat": lab, "axis": axis, "key": key,
                            "cnty": c, "cnty_name": names.get(c, c), "value": round(float(dv), 1),
                            "text": f"{lab}: {names.get(c, c)} 점유율 {sh1.get(c, 0):.1f}% → {sh0.get(c, 0):.1f}% ({dv:+.1f}%p, 전월 대비)"})
        # 단가 변동 (전년 동월)
        if i0 >= 12:
            k0, u12, k12 = e["imp_kg"][i0], e["imp_usd"][i0 - 12], e["imp_kg"][i0 - 12]
            if k0 and k12 and u12 and u12 >= a["min_import_usd"]:
                p0, p12 = v0 / k0, u12 / k12
                ch = pct(p0, p12)
                if abs(ch) >= a["price_change_pct"]:
                    out["alerts"].append({"type": "price", "cat": lab, "axis": axis, "key": key, "value": round(ch, 1),
                        "text": f"{lab}: 수입 단가 {p12:,.2f} → {p0:,.2f} USD/kg ({ch:+.1f}%, 전년 동월 대비)"})
        # 신규 공급국
        hc = hist[(hist.axis == axis) & (hist.key == key)].groupby("cnty")["imp_usd"].sum()
        for c, s in sh0.items():
            if s >= a["new_supplier_share"] and hc.get(c, 0) <= 0 and len(months) >= 13:
                out["alerts"].append({"type": "new", "cat": lab, "axis": axis, "key": key, "cnty": c,
                    "cnty_name": names.get(c, c), "value": round(float(s), 1),
                    "text": f"{lab}: 신규 공급국 {names.get(c, c)} 등장 (점유율 {s:.1f}%, 직전 12개월 수입 없음)"})

    out["alerts"].sort(key=lambda x: -abs(x["value"]))
    out["alerts"] = out["alerts"][:20]
    n = len(out["alerts"])
    out["summary"].append(f"이번 달 주의 표시 항목은 {n}건임." if n else "이번 달 주의 표시 항목은 없음.")
    return out


# ── 검증 ─────────────────────────────────────────────────────
def validate(months, series) -> tuple[bool, str]:
    if not months:
        return False, "수집된 데이터 없음"
    imp = series["total"]["all"]["imp_usd"]
    if not imp[-1]:
        return False, f"{months[-1]} 수입 합계가 0"
    if len(imp) > 1 and imp[-2]:
        ch = pct(imp[-1], imp[-2])
        if abs(ch) > SET["validation"]["max_mom_change_pct"]:
            return False, f"{months[-1]} 수입 합계가 전월 대비 {ch:+.1f}% 변동 (기준 ±{SET['validation']['max_mom_change_pct']}%)"
    return True, "정상"


# ── 메인 ─────────────────────────────────────────────────────
def write_json(name, obj):
    (OUT_DIR / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    now = dt.datetime.now(KST).isoformat(timespec="minutes")
    progress_file = ROOT / "data" / "state" / "progress.json"
    progress = json.loads(progress_file.read_text(encoding="utf-8")) if progress_file.exists() else {}

    df = load_raw()
    meta_path = OUT_DIR / "meta.json"
    old_meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}

    if df.empty:
        write_json("meta.json", {**old_meta, "status": "collecting", "status_msg": "첫 데이터 수집 중", "checked_at": now})
        print("데이터 없음 — meta만 기록")
        return 0

    months, series, countries, names, hs_names, long = build_outputs(df)
    ok, msg = validate(months, series)

    target_start = SET["start_month"][:4] + "-" + SET["start_month"][4:]
    complete = sorted(m for m, s in progress.items() if s.get("complete"))
    meta = {
        "status": "ok" if ok else "delayed",
        "status_msg": msg,
        "latest_month": months[-1],
        "first_month": months[0],
        "target_start": target_start,
        "months_available": len(months),
        "months_complete": len(complete),
        "updated_at": now,
        "checked_at": now,
        "source": "관세청 품목별 국가별 수출입실적(GW), 공공데이터포털 15100475",
        "hs_revisions": CFG["hs_revisions"],
        "groups": [{k: g[k] for k in ("key", "name", "desc", "prefixes")} for g in CFG["groups"]],
        "products": [{k: p.get(k) for k in ("key", "num", "name", "status", "since", "note", "prefixes")} for p in CFG["products"]],
        "headings": HEADING_NAMES,
        "processing_stages": CFG["processing_stages"],
        "countries": names,
    }

    if not ok:
        write_json("meta.json", {**old_meta, "status": "delayed", "status_msg": msg, "checked_at": now})
        print(f"검증 실패: {msg} — 기존 페이지 유지")
        return 3

    insights = build_insights(months, series, long, names)
    write_json("meta.json", meta)
    write_json("series.json", {"months": months, "series": series})
    write_json("countries.json", countries)
    write_json("insights.json", insights)
    write_json("hs_names.json", hs_names)

    # 다운로드용 CSV
    agg = long.groupby(["axis", "key", "month"], as_index=False)[MEASURES].sum()
    agg["label"] = [label_of(a, k) for a, k in zip(agg["axis"], agg["key"])]
    agg[["axis", "key", "label", "month"] + MEASURES].to_csv(OUT_DIR / "monthly_by_category.csv", index=False, encoding="utf-8-sig")
    yr = long.assign(year=long["month"].str[:4]).groupby(["axis", "key", "cnty", "year"], as_index=False)[MEASURES].sum()
    yr["label"] = [label_of(a, k) for a, k in zip(yr["axis"], yr["key"])]
    yr["cnty_name"] = yr["cnty"].map(names)
    yr[["axis", "key", "label", "cnty", "cnty_name", "year"] + MEASURES].to_csv(
        OUT_DIR / "yearly_by_category_country.csv", index=False, encoding="utf-8-sig")
    df[df["month"].isin(months[-12:])][["month", "cnty", "cnty_name", "hs", "name"] + MEASURES].to_csv(
        OUT_DIR / "raw_last12m.csv", index=False, encoding="utf-8-sig")

    print(f"완료: {months[0]}~{months[-1]} ({len(months)}개월), 요약 {len(insights['summary'])}줄, 알림 {len(insights['alerts'])}건")
    return 0


if __name__ == "__main__":
    sys.exit(main())
