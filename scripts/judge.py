"""
판정과 엮은 분석 (config/criteria.yaml 규칙만 사용)

① 공급 위험      : 최근 12개월 품목별 최대 공급국 점유율·HHI → 취약/주의/안정
                   (산업부 산업 공급망 3050 전략 2023, DOJ·FTC 2010)
② 수입 의존      : 원목 수입침투율 = 100 − 원목자급률, Mann-Kendall 추세 검정 (OECD STAN; Mann 1945; Kendall 1975)
③ 가격 이상      : FAO IFPA 방법을 월별 수입 단가에 적용 (SDG 2.c.1)
④ 변화 요인      : 최근 12개월 vs 직전 12개월 수입액 변화를 HS6 단위 LMDI로 물량·단가 효과 분해 (Ang 2005)
⑤ 자급-수입 구조 : 원목 수입의존도와 수입 중 가공제품 비중의 연도별 변화
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parents[1]
CRIT = yaml.safe_load((ROOT / "config" / "criteria.yaml").read_text(encoding="utf-8"))


# ── 공통 ─────────────────────────────────────────────────────
def _r(x, nd=1):
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else round(float(x), nd)


def mann_kendall(values: list[float | None]) -> dict | None:
    """Mann-Kendall 추세 검정 (동순위 보정) + Sen 기울기."""
    x = [v for v in values if v is not None]
    n = len(x)
    if n < 4:
        return None
    s = 0
    slopes = []
    for i in range(n - 1):
        for j in range(i + 1, n):
            s += np.sign(x[j] - x[i])
            slopes.append((x[j] - x[i]) / (j - i))
    _, counts = np.unique(x, return_counts=True)
    var = (n * (n - 1) * (2 * n + 5) - sum(c * (c - 1) * (2 * c + 5) for c in counts)) / 18
    if var <= 0:
        return None
    z = (s - 1) / math.sqrt(var) if s > 0 else (s + 1) / math.sqrt(var) if s < 0 else 0.0
    p = 2 * (1 - 0.5 * (1 + math.erf(abs(z) / math.sqrt(2))))
    return {"n": n, "S": int(s), "z": _r(z, 3), "p": _r(p, 4), "sen_slope": _r(float(np.median(slopes)), 3)}


# ── ① 공급 위험 ──────────────────────────────────────────────
def supply_risk(long: pd.DataFrame, months: list[str], items: list[tuple[str, str, str]], names: dict) -> list[dict]:
    c = CRIT["supply_risk"]
    last12 = months[-12:]
    cur = long[long["month"].isin(last12)]
    out = []
    for axis, key, label in items:
        g = cur[(cur["axis"] == axis) & (cur["key"] == key)].groupby("cnty")["imp_usd"].sum()
        g = g[g > 0]
        tot = float(g.sum())
        if tot <= 0:
            continue
        share = g / tot * 100
        hhi = float((share ** 2).sum())
        top = share.idxmax()
        top_share = float(share.max())
        top3 = float(share.nlargest(3).sum())
        if tot < c["vulnerable"]["min_import_usd"]:
            grade, reason = "판정 제외", f"연 수입액 {tot/1e6:,.2f}백만 달러 < 1백만 (산업부 기준의 최소 규모 미달)"
        elif top_share >= c["vulnerable"]["top_country_share_pct"]:
            grade, reason = "취약", f"연 수입액 {tot/1e6:,.1f}백만 달러 ≥ 1백만, {names.get(top, top)} {top_share:.0f}% ≥ 50%"
        elif hhi >= c["caution_hhi"]:
            grade, reason = "주의", f"HHI {hhi:,.0f} ≥ {c['caution_hhi']:,}"
        else:
            grade, reason = "안정", f"특정국 {top_share:.0f}% < 50%, HHI {hhi:,.0f} < {c['caution_hhi']:,}"
        out.append({"axis": axis, "key": key, "label": label, "imp_usd": round(tot), "top": top,
                    "top_name": names.get(top, top), "top_share": _r(top_share), "top3": _r(top3),
                    "hhi": _r(hhi, 0), "n_countries": int(len(g)), "grade": grade, "reason": reason})
    order = {"취약": 0, "주의": 1, "안정": 2, "판정 제외": 3}
    out.sort(key=lambda d: (order[d["grade"]], -d["imp_usd"]))
    return out


# ── ② 수입 의존 (원목) ───────────────────────────────────────
def import_penetration(supply_csv: Path) -> dict | None:
    if not supply_csv.exists():
        return None
    t = pd.read_csv(supply_csv).dropna(subset=["log_self_sufficiency_pct"])
    years = [int(y) for y in t["year"]]
    dep = [round(100 - float(v), 1) for v in t["log_self_sufficiency_pct"]]
    c = CRIT["import_penetration"]
    k = c["trend_years"]
    mk = mann_kendall(dep[-k:])
    if mk is None:
        verdict = "판정 보류"
    elif mk["p"] < c["alpha"]:
        verdict = "하락 추세" if mk["S"] < 0 else "상승 추세"
    else:
        verdict = "뚜렷한 추세 없음"
    return {"years": years, "log_import_dependence": dep, "latest_year": years[-1], "latest": dep[-1],
            "trend_window": [years[-k], years[-1]] if len(years) >= k else [years[0], years[-1]],
            "mk": mk, "verdict": verdict}


# ── ③ 가격 이상 (IFPA 방법) ──────────────────────────────────
def price_anomaly(series: dict, months: list[str], label_of) -> list[dict]:
    c = CRIT["price_anomaly"]
    g = c["gamma"]
    out = []
    for spec in c["items"]:
        axis, key = spec.split(":")
        e = series.get(axis, {}).get(key)
        if not e:
            continue
        n = len(months)
        p = [(u / k if (u or 0) >= c["min_month_import_usd"] and k else None) for u, k in zip(e["imp_usd"], e["imp_kg"])]

        def cgr(t, lag):
            if t - lag < 0 or p[t] is None or p[t - lag] is None:
                return None
            return (p[t] / p[t - lag]) ** (1 / lag) - 1

        cq = [cgr(t, 3) for t in range(n)]
        ca = [cgr(t, 12) for t in range(n)]

        def zscore(arr, t):
            if arr[t] is None:
                return None, 0
            past = [arr[s] for s in range(t - 12, -1, -12) if arr[s] is not None]   # 과거 같은 달
            if len(past) < c["min_past_years"]:
                return None, len(past)
            sd = float(np.std(past))
            if sd == 0:
                return None, len(past)
            return (arr[t] - float(np.mean(past))) / sd, len(past)

        ifpa, npast = [], []
        for t in range(n):
            zq, nq = zscore(cq, t)
            za, na = zscore(ca, t)
            npast.append(min(nq, na))
            ifpa.append(None if zq is None or za is None else g * zq + (1 - g) * za)

        def band(v):
            if v is None:
                return "판정 보류"
            b = c["bands"]
            if v >= b["abnormal"]:
                return "비정상 상승"
            if v >= b["moderate"]:
                return "다소 높음"
            if c.get("symmetric_low") and v <= -b["abnormal"]:
                return "비정상 하락"
            if c.get("symmetric_low") and v <= -b["moderate"]:
                return "다소 낮음"
            return "정상"

        latest = ifpa[-1]
        yoy = (p[-1] / p[-13] - 1) * 100 if n > 12 and p[-1] and p[-13] else None
        out.append({"axis": axis, "key": key, "label": label_of(axis, key), "ifpa": _r(latest, 2), "band": band(latest),
                    "past_obs": npast[-1], "need_obs": c["min_past_years"], "yoy_pct": _r(yoy),
                    "ifpa_series": [_r(v, 2) for v in ifpa[-24:]], "months": months[-24:]})
    return out


# ── ④ 변화 요인 (LMDI) ──────────────────────────────────────
def _L(a: float, b: float) -> float:
    if a == b:
        return a
    return (a - b) / (math.log(a) - math.log(b))


def decomposition(df: pd.DataFrame, months: list[str], group_of, group_names: dict) -> dict:
    if len(months) < 24:
        return {"available": False}
    cur, prv = months[-12:], months[-24:-12]
    d = df.assign(hs6=df["hs"].str[:6])
    v1 = d[d["month"].isin(cur)].groupby("hs6")[["imp_usd", "imp_kg"]].sum()
    v0 = d[d["month"].isin(prv)].groupby("hs6")[["imp_usd", "imp_kg"]].sum()
    allk = sorted(set(v1.index) | set(v0.index))
    rows = []
    for h in allk:
        V1, Q1 = (float(v1.loc[h, "imp_usd"]), float(v1.loc[h, "imp_kg"])) if h in v1.index else (0.0, 0.0)
        V0, Q0 = (float(v0.loc[h, "imp_usd"]), float(v0.loc[h, "imp_kg"])) if h in v0.index else (0.0, 0.0)
        grp = group_of(h)
        if V0 > 0 and V1 > 0 and Q0 > 0 and Q1 > 0:
            L = _L(V1, V0)
            vol = L * math.log(Q1 / Q0)
            pri = L * math.log((V1 / Q1) / (V0 / Q0))
            rows.append((grp, V0, V1, vol, pri, 0.0))
        else:
            rows.append((grp, V0, V1, 0.0, 0.0, V1 - V0))   # 신규·중단 품목
    t = pd.DataFrame(rows, columns=["group", "V0", "V1", "volume", "price", "entry_exit"])
    dom = CRIT["decomposition"]["dominant_share"]

    def pack(sub, label, key):
        V0, V1 = sub["V0"].sum(), sub["V1"].sum()
        vol, pri, ee = sub["volume"].sum(), sub["price"].sum(), sub["entry_exit"].sum()
        denom = abs(vol) + abs(pri)
        if denom == 0:
            driver = "변화 없음"
        elif abs(vol) / denom >= dom:
            driver = "물량 주도"
        elif abs(pri) / denom >= dom:
            driver = "단가 주도"
        else:
            driver = "물량·단가 혼합"
        return {"key": key, "label": label, "V0": round(V0), "V1": round(V1), "dV": round(V1 - V0),
                "pct": _r((V1 / V0 - 1) * 100 if V0 else None), "volume": round(vol), "price": round(pri),
                "entry_exit": round(ee), "driver": driver}

    groups = [pack(t[t["group"] == k], n, k) for k, n in group_names.items() if (t["group"] == k).any()]
    return {"available": True, "period": [f"{prv[0]}~{prv[-1]}", f"{cur[0]}~{cur[-1]}"],
            "total": pack(t, "목재류 전체", "all"), "groups": groups}


# ── ⑤ 자급-수입 구조 ────────────────────────────────────────
def structure(series: dict, months: list[str], pen: dict | None, stages: dict) -> dict:
    years = sorted({m[:4] for m in months})
    full = [y for y in years if sum(1 for m in months if m.startswith(y)) == 12]
    def yearsum(axis, key, y):
        e = series.get(axis, {}).get(key)
        if not e:
            return 0.0
        return sum((v or 0) for m, v in zip(months, e["imp_usd"]) if m.startswith(y))
    proc_share = []
    for y in full:
        raw = yearsum("group", "raw", y)
        proc = sum(yearsum("group", k, y) for k in stages["processed"])
        proc_share.append(_r(proc / (raw + proc) * 100 if raw + proc else None))
    dep = None
    if pen:
        mp = dict(zip([str(v) for v in pen["years"]], pen["log_import_dependence"]))
        dep = [mp.get(y) for y in full]
    return {"years": full, "processed_share": proc_share, "log_import_dependence": dep}


# ── ⑥ 국내 공급 여력 (목재이용실태조사) ─────────────────────
def domestic_supply(survey_csv: Path, sr: list[dict], labels: dict) -> dict | None:
    """품목별 수입 비중(물량)·추세, 가동률, 여유 생산능력 ÷ 수입량. 관세청 수입 집중 판정과 결합."""
    if not survey_csv.exists():
        return None
    s = pd.read_csv(survey_csv)
    c = CRIT["domestic_supply"]
    sr_by = {(d["axis"], d["key"]): d for d in sr}

    def get(prod, metric):
        t = s[(s["product"] == prod) & (s["metric"] == metric)]
        return {int(y): float(v) for y, v in zip(t["year"], t["value"])}, (t["unit"].iloc[0] if len(t) else None), \
               (t["note"].fillna("").iloc[-1] if len(t) else "")

    rows = []
    prods = [p for p in s["product"].unique() if p != "total"]
    for prod in prods + ["logs"]:
        if prod == "logs":                       # 원목: 국산 원목 이용량 vs 수입 원목 이용량
            pr, unit, _ = get("total", "log_use_domestic")
            im, _, _ = get("total", "log_use_imported")
            ut, un, cap = {}, "", {}
            axis, key, label = "heading", "4403", "원목"
        else:
            pr, unit, _ = get(prod, "production")
            im, _, _ = get(prod, "imports")
            ut, _, un = get(prod, "utilization_pct")
            axis, key, label = "product", prod, labels.get(prod, prod)
        years = sorted(set(pr) & set(im))
        if not years:
            continue
        share = {y: (im[y] / (pr[y] + im[y]) * 100 if pr[y] + im[y] > 0 else None) for y in years}
        ys = [share[y] for y in years]
        mk = mann_kendall(ys) if len(years) >= c["trend_min_years"] else None
        if len(years) < c["trend_min_years"]:
            trend = f"판정 보류({len(years)}개년)"
        elif mk is None:
            trend = "판정 보류"
        elif mk["p"] < c["alpha"]:
            trend = "상승 추세" if mk["S"] > 0 else "하락 추세"
        else:
            trend = "뚜렷한 추세 없음"
        y0 = years[-1]
        u = ut.get(y0)
        spare = pr[y0] * (100 / u - 1) if u and u > 0 else None
        cover = spare / im[y0] * 100 if spare is not None and im[y0] > 0 else None
        if pr[y0] == 0:
            cover, spare = 0.0, 0.0
        risk = sr_by.get((axis, key))
        rows.append({
            "axis": axis, "key": key, "label": label, "year": y0, "unit": unit,
            "production": round(pr[y0]), "imports": round(im[y0]),
            "import_share": _r(share[y0]), "share_years": years, "share_series": [_r(v) for v in ys],
            "trend": trend, "mk": mk,
            "utilization": _r(u), "util_note": un, "util_years": sorted(ut), "util_series": [_r(ut[y]) for y in sorted(ut)],
            "spare": None if spare is None else round(spare), "spare_cover": _r(cover),
            "risk_grade": risk["grade"] if risk else None,
            "top_name": risk["top_name"] if risk else None, "top_share": risk["top_share"] if risk else None,
        })
    rows.sort(key=lambda d: (d["unit"] != "m3", -d["imports"]))
    tot, _, _ = get("total", "wood_use_total")
    imp, _, _ = get("total", "imported_products")
    ld, _, _ = get("total", "log_use_domestic")
    li, _, _ = get("total", "log_use_imported")
    ty = sorted(tot)
    overall = [{"year": y, "total": tot[y], "imported_products": imp.get(y), "log_imported": li.get(y), "log_domestic": ld.get(y),
                "import_share": _r((imp.get(y, 0) + li.get(y, 0)) / tot[y] * 100)} for y in ty]
    return {"rows": rows, "overall": overall, "source": c["source"], "line": c["spare_cover_line"]}


def calibrate_density(df: pd.DataFrame, survey_csv: Path, units: dict) -> list[dict]:
    """관세청 kg ÷ 실태조사 ㎥ → 밀도(t/㎥). config/criteria.yaml density_calibration."""
    if not survey_csv.exists():
        return []
    c = CRIT["density_calibration"]
    s = pd.read_csv(survey_csv)
    months = sorted(df["month"].unique())
    full = [y for y in sorted({m[:4] for m in months}) if sum(1 for m in months if m.startswith(y)) == 12]
    out = []
    for item, prefixes in c["items"].items():
        sk = c["survey_key"][item]
        metric = (c.get("survey_metric") or {}).get(item, "imports")
        sub = df[df["hs"].str.startswith(tuple(prefixes))]
        imp = s[(s["product"] == sk) & (s["metric"] == metric)]
        m3 = {str(int(y)): float(v) for y, v in zip(imp["year"], imp["value"])}
        usd = s[(s["product"] == sk) & (s["metric"] == "imports_usd_k")]
        usd = {str(int(y)): float(v) * 1000 for y, v in zip(usd["year"], usd["value"])}
        per_year = []
        for y in full:
            if y not in m3:
                continue
            ys = sub[sub["month"].str.startswith(y)]
            kg, dl = float(ys["imp_kg"].sum()), float(ys["imp_usd"].sum())
            if y in usd and abs(dl / usd[y] - 1) * 100 > c["scope_check_pct"]:
                continue                                   # 범위 불일치
            per_year.append({"year": y, "density": kg / 1000 / m3[y]})
        method = "kg÷㎥" + ("(이용량 기준)" if metric != "imports" else "")
        if not per_year and "2023" in usd and "2023" in m3:   # 대체: 2023 단가 비율
            ys = sub[sub["month"].str.startswith("2023")]
            kg, dl = float(ys["imp_kg"].sum()), float(ys["imp_usd"].sum())
            if kg > 0:
                per_year.append({"year": "2023", "density": (usd["2023"] / m3["2023"]) / (dl / kg) / 1000})
                method = "단가 비율(2023)"
        if not per_year:
            continue
        # 고정 환산계수 연도 걸러내기: 실태조사(임산물수출입통계) ㎥가 중량 ÷ 고정계수로 만들어진 해는
        # kg÷㎥가 해마다 똑같은 값(소수 셋째 자리)으로 나옴 → 측정값이 아니라 산림청 환산계수임
        vals = [round(p["density"], 3) for p in per_year]
        from collections import Counter
        cnt = Counter(round(v, 2) for v in vals)
        fixed = {v for v, n in cnt.items() if n >= c.get("fixed_factor_min_years", 3)}
        measured = [p for p in per_year if round(p["density"], 2) not in fixed]
        factor = None
        if fixed:
            factor = max(fixed, key=lambda v: cnt[v])
        if len(measured) >= 2:
            d = float(np.median([p["density"] for p in measured]))
            method = method + " (신고 수량 연도)" if metric == "imports" else method
            used = measured
        elif factor is not None:
            d = factor
            method = "산림청 환산계수 (실태조사 ㎥ = 중량 ÷ 계수)"
            used = [p for p in per_year if round(p["density"], 2) == factor]
        else:
            d = float(np.median([p["density"] for p in per_year]))
            used = per_year
        prov = (units.get("items") or {}).get(item, {}).get("density")
        out.append({"item": item, "density": round(d, 3), "provisional": prov, "method": method, "metric": metric,
                    "years": [p["year"] for p in used], "by_year": [round(p["density"], 3) for p in used],
                    "all_years": [p["year"] for p in per_year], "all_by_year": vals, "fixed_factor": factor})
    return out


# ── ⑦ 국산·수입 가격 수준 (참고) ────────────────────────────
def domestic_price(df: pd.DataFrame, months: list[str], price_csv: Path, units: dict) -> dict | None:
    if not price_csv.exists():
        return None
    c = CRIT["domestic_price"]
    t = pd.read_csv(price_csv)
    fx = float(c["fx_krw_per_usd"])
    t["m3"] = t["T"].astype(float) * t["W"].astype(float) * t["L"].astype(float) / 1e9
    t["krw_m3"] = t["price_krw"] / t["m3"]
    last12 = months[-12:]
    cur = df[df["month"].isin(last12)]
    items = units.get("items") or {}
    out = []
    for pr in c["pairs"]:
        d = t[(t["category"] == pr["domestic"]["category"]) & (t["treatment"] == pr["domestic"]["treatment"]) & t["m3"].notna()]
        if d.empty:
            continue
        usd_m3 = d["krw_m3"] / fx
        dom = {"median": round(float(usd_m3.median())), "min": round(float(usd_m3.min())), "max": round(float(usd_m3.max())),
               "krw_m3_median": round(float(d["krw_m3"].median())), "n": int(len(d)), "year": int(d["year"].iloc[0])}
        imps = []
        for im in pr["imports"]:
            if "survey" in im:                         # 실태조사(임산물수출입통계) 신고 ㎥ 기준 단가
                sv = pd.read_csv(price_csv.parent / "wood_use_survey.csv")
                g = lambda m: sv[(sv["product"] == im["survey"]) & (sv["metric"] == m) & (sv["year"] == im["survey_year"])]["value"]
                m3, uk = g("imports"), g("imports_usd_k")
                if len(m3) and len(uk):
                    pm3 = float(uk.iloc[0]) * 1000 / float(m3.iloc[0])
                    imps.append({"label": im["label"], "usd": round(float(uk.iloc[0]) * 1000), "usd_t": None, "usd_m3": round(pm3),
                                 "density": None, "calibrated": None, "basis": "신고 ㎥", "ratio": round(dom["median"] / pm3, 2)})
                continue
            s = cur[cur["hs"].str.startswith(tuple(im["hs"]))]
            kg, usd = float(s["imp_kg"].sum()), float(s["imp_usd"].sum())
            if kg <= 0 or usd < c["min_import_usd"]:
                imps.append({"label": im["label"], "usd": round(usd), "small": True})
                continue
            it = items.get(im["density_item"], {})
            dens = it.get("density")
            per_t = usd * 1000 / kg
            per_m3 = per_t * dens if dens else None
            imps.append({"label": im["label"], "usd": round(usd), "usd_t": round(per_t), "usd_m3": None if per_m3 is None else round(per_m3),
                         "density": dens, "calibrated": bool(it.get("calibrated")),
                         "ratio": None if not per_m3 else round(dom["median"] / per_m3, 2)})
        out.append({"label": pr["label"], "domestic": dom, "imports": imps})
    return {"pairs": out, "fx": fx, "fx_basis": c["fx_basis"], "period": f"{last12[0]}~{last12[-1]}", "note": c["note"],
            "species_note": c.get("species_note"), "survey_note": c.get("survey_note"), "source": c["source"]}


# ── ⑧ 목재산업 규모 (목재이용실태조사 공표값, 원자료) ─────────
def industry(survey_csv: Path, labels: dict) -> dict | None:
    if not survey_csv.exists():
        return None
    s = pd.read_csv(survey_csv)
    t = s[s["product"] == "total"]
    def ser(m):
        x = t[t["metric"] == m].sort_values("year")
        return [int(y) for y in x["year"]], [float(v) for v in x["value"]]
    years, tot = ser("sales_100m_krw")
    if not years:
        return None
    _, dom = ser("sales_domestic_100m_krw")
    _, imp = ser("sales_import_100m_krw")
    _, emp = ser("employees")
    p = s[(s["product"] != "total") & s["metric"].isin(["sales_100m_krw", "sales_domestic_100m_krw", "sales_import_100m_krw", "employees"])]
    y0 = int(p["year"].max())
    q = p[p["year"] == y0].pivot_table(index="product", columns="metric", values="value", aggfunc="first")
    extra = {"sawdust": "톱밥·목분", "firewood": "장작", "pulp": "펄프"}
    prods = []
    for k, r in q.iterrows():
        prods.append({"key": k, "label": labels.get(k, extra.get(k, k)), "is_product": k in labels,
                      "sales": _r(r.get("sales_100m_krw"), 0), "domestic": _r(r.get("sales_domestic_100m_krw"), 0),
                      "import": _r(r.get("sales_import_100m_krw"), 0), "employees": _r(r.get("employees"), 0)})
    prods.sort(key=lambda d: -(d["sales"] or 0))
    return {"years": years, "sales": tot, "domestic": dom, "imports": imp, "employees": emp, "year": y0, "products": prods,
            "source": "산림청·한국임업진흥원 목재이용실태조사 표2-4 (2020년은 2021년 기준 보고서 수정치)",
            "scope": "목재생산업 등록업체(21개 목재제품의 국내 생산업체 + 수입·유통업체) 매출. 가구·건축·종이 제외. 수입·유통업체 값은 가중치 추정"}


def _prod_dep_text(ds) -> str:
    """목재제품별 수입의존도 요약 (실태조사 최신 연도): 수입액 기준 상위 품목 + 유의한 추세."""
    if not ds or not ds.get("rows"):
        return ""
    rows = [d for d in ds["rows"] if d["axis"] == "product" and d["import_share"] is not None]
    if not rows:
        return ""
    yr = max(d["year"] for d in rows)
    main = [d for d in rows if d["key"] in ("p01", "p06", "p07", "p08", "p11")]
    sig = [f"{d['label']} {d['trend'].replace(' 추세', '')}" for d in rows if d["trend"] in ("상승 추세", "하락 추세")]
    t = f" · 제품({yr}): " + ", ".join(f"{d['label']} {d['import_share']:.0f}%" for d in main)
    return t + (f" · 유의한 변화: {', '.join(sig)}" if sig else " · 유의한 변화 없음")


# ── 요약 카드 ────────────────────────────────────────────────
def summary_cards(sr, pen, pa, dec, ds=None) -> list[dict]:
    cards = []
    vul = [d for d in sr if d["grade"] == "취약"]
    cau = [d for d in sr if d["grade"] == "주의"]
    cards.append({
        "id": "supply", "title": "수입 집중",
        "badge": f"취약 {len(vul)}개" if vul else ("주의" if cau else "안정"),
        "level": "hi" if vul else ("mid" if cau else "lo"),
        "text": ("정부 공급망 기준(연 100만 달러↑·특정국 50%↑)에 해당: " +
                 ", ".join(f"{d['label']}({d['top_name']} {d['top_share']:.0f}%)" for d in vul[:3]) +
                 (f" 외 {len(vul) - 3}개" if len(vul) > 3 else "")) if vul else
                ("특정국 50%↑ 품목은 없으나 HHI 2,500↑ 고집중 품목 " + ", ".join(d["label"] for d in cau[:3]) if cau else
                 "정부 공급망 기준에 해당하는 품목 없음"),
        "refs": CRIT["supply_risk"]["refs"]})
    if ds and ds["rows"]:
        vul = {(d["axis"], d["key"]) for d in sr if d["grade"] == "취약"}
        rows = [d for d in ds["rows"] if (d["axis"], d["key"]) in vul and d["spare_cover"] is not None]
        low = [d for d in rows if d["spare_cover"] < ds["line"]]
        ok = [d for d in rows if d["spare_cover"] >= ds["line"]]
        yr = max(d["year"] for d in ds["rows"])
        if rows:
            txt = ("수입 집중 '취약' 품목 중 국내 여유 생산능력으로 수입량을 못 채우는 품목: " +
                   ", ".join(f"{d['label']}({d['spare_cover']:.0f}%)" for d in sorted(low, key=lambda d: d['spare_cover'])) if low else
                   "수입 집중 '취약' 품목 모두 국내 여유 생산능력이 수입량 이상")
            if ok:
                txt += " · 여유능력 ≥ 수입량: " + ", ".join(d["label"] for d in ok)
        else:
            txt = "수입 집중 '취약' 품목에 대응하는 국내 생산·가동률 자료 없음"
        cards.append({"id": "domestic", "title": "국내 대체 여력",
                      "badge": f"부족 {len(low)}개" if low else "충분", "level": "hi" if low else "lo",
                      "text": txt + f" ({yr}년 실태조사, 여유능력÷수입량)", "refs": CRIT["domestic_supply"]["refs"]})
    if pen:
        mk = pen["mk"] or {}
        cards.append({
            "id": "penetration", "title": "수입 의존",
            "badge": f"원목 {pen['verdict']}", "level": "lo" if pen["verdict"] == "하락 추세" else ("hi" if pen["verdict"] == "상승 추세" else "mid"),
            "text": f"원목 {pen['latest']:.1f}% ({pen['latest_year']}년, 연 {mk.get('sen_slope', 0):+.1f}%p, MK p={mk.get('p', float('nan')):.3f})" + _prod_dep_text(ds),
            "refs": CRIT["import_penetration"]["refs"]})
    ready = [d for d in pa if d["band"] != "판정 보류"]
    hot = [d for d in ready if d["band"] in ("비정상 상승", "다소 높음")]
    cold = [d for d in ready if d["band"] in ("비정상 하락", "다소 낮음")]
    if not ready:
        need = max((d["need_obs"] - d["past_obs"]) for d in pa) if pa else 0
        cards.append({"id": "price", "title": "가격 이상", "badge": "판정 보류", "level": "na",
                      "text": f"과거 같은 달 비교 자료가 부족함 (품목당 최소 {CRIT['price_anomaly']['min_past_years']}년 필요). 과거 데이터 수집이 끝나면 자동 판정",
                      "refs": CRIT["price_anomaly"]["refs"]})
    else:
        lvl = "hi" if any(d["band"] == "비정상 상승" for d in hot) else ("mid" if hot or cold else "lo")
        cards.append({"id": "price", "title": "가격 이상",
                      "badge": f"상승 이상 {len(hot)}개" if hot else ("하락 이상 " + str(len(cold)) + "개" if cold else "정상"),
                      "level": lvl,
                      "text": ("; ".join(f"{d['label']} {d['band']}({d['ifpa']:+.1f}σ)" for d in (hot + cold)[:3])
                               if hot or cold else f"판정 가능 {len(ready)}개 품목 모두 과거 같은 달 대비 정상 범위(±0.5σ)"),
                      "refs": CRIT["price_anomaly"]["refs"]})
    if dec.get("available"):
        tt = dec["total"]
        cards.append({"id": "drivers", "title": "변화 요인",
                      "badge": tt["driver"], "level": "mid",
                      "text": f"최근 12개월 수입액 {tt['pct']:+.1f}% — 물량 효과 {tt['volume']/1e8:+.2f}억, 단가 효과 {tt['price']/1e8:+.2f}억 달러"
                              + (f", 신규·중단 품목 {tt['entry_exit']/1e8:+.2f}억" if abs(tt["entry_exit"]) >= 5e6 else ""),
                      "refs": CRIT["decomposition"]["refs"]})
    return cards
