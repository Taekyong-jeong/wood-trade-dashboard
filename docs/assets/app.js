/* 대한민국 목재 수급·공급망 진단 — 화면 로직 */
(function () {
  const C = window.Charts;
  const $ = (s, r = document) => r.querySelector(s);
  const D = {};
  const S = {
    tab: "product", measure: "imp_usd", agg: "r12", start: null,
    group: "raw", product: "p01", sp1: null, sp2: null, country: null, pu: "m3",
  };
  const UNIT = { imp_usd: "백만 달러", imp_kg: "천 톤", price: "USD/t" };
  const MLABEL = { imp_usd: "금액", imp_kg: "물량", price: "단가" };

  // ── 숫자 형식 ───────────────────────────────────────────
  const nf = (v, d = 0) => v == null || !isFinite(v) ? "–" : v.toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
  function usd(v) {
    if (v == null || !isFinite(v)) return "–";
    const a = Math.abs(v);
    if (a >= 1e8) return nf(v / 1e8, 2) + "억 달러";
    if (a >= 1e6) return nf(v / 1e6, 1) + "백만 달러";
    if (a >= 1e3) return nf(v / 1e3, 0) + "천 달러";
    return nf(v, 0) + "달러";
  }
  function ton(kg) {
    if (kg == null || !isFinite(kg)) return "–";
    if (kg >= 1e7) return nf(kg / 1e7, 1) + "만 톤";
    return nf(kg / 1e3, 0) + "톤";
  }
  const price = (u, k) => (k ? u / k : null);
  // 품목별 단가 단위 (config/units.yaml): m3=밀도 환산 추정, t=톤, 표에 없는 혼합 분류도 t
  function unitOf(axis, key, raw) {
    const U = (D.meta && D.meta.units) || {};
    const it = (U.items || {})[`${axis}:${key}`];
    if (!it) return { unit: "t", mixed: true };   // 혼합 분류(품목군·수종 등)는 밀도 환산 없이 톤 액면
    if (!raw && it.unit === "m3" && S.pu === "t") return { unit: "t", from: it };   // 톤 액면 보기
    return { ...it, provisional: !it.calibrated && U.status !== "confirmed" };
  }
  function pconv(axis, key) {
    const u = unitOf(axis, key);
    if (u.unit === "m3") return (usd, kg) => (kg ? (usd * u.density * 1000) / kg : null);
    if (u.unit === "t") return (usd, kg) => (kg ? (usd * 1000) / kg : null);
    return (usd, kg) => (kg ? usd / kg : null);
  }
  const plabel = (axis, key) => ({ m3: "USD/㎥", t: "USD/t", kg: "USD/kg" }[unitOf(axis, key).unit]);
  const pfmt = (axis, key) => (v) => (unitOf(axis, key).unit === "kg" ? nf(v, 2) : nf(v, 0));
  // ㎥ 환산 배지: 산림청 계수(임산물수출입통계 환산계수) / 잠정(대표값). 툴팁에 공식·밀도 출처
  const pest = (axis, key) => { const u = unitOf(axis, key); if (u.unit !== "m3") return "";
    const f = `USD/㎥ = USD/t × 밀도 ${nf(u.density, 2)} t/㎥ · ${u.basis || ""}`;
    return u.calibrated ? ` <span class="badge" title="${f}">${/산림청 환산계수/.test(u.basis || "") ? "산림청 계수" : "보정"}</span>` : ` <span class="badge" title="${f}">잠정</span>`; };
  // 같은 값의 다른 단위 (㎥ 환산 ↔ 톤 액면)
  function ptwin(axis, key, usdv, kg) {
    const b = unitOf(axis, key, true);
    if (b.unit !== "m3" || !kg) return "";
    return S.pu === "t" ? `≈ ${nf((usdv * b.density * 1000) / kg, 0)} USD/㎥(${b.calibrated ? "산림청 계수" : "잠정"})` : `= ${nf((usdv * 1000) / kg, 0)} USD/t (액면)`;
  }
  function delta(cur, prev, unit = "%") {
    if (!prev || cur == null) return `<span class="delta">비교 불가</span>`;
    const p = (cur / prev - 1) * 100;
    const cls = p > 0 ? "up" : p < 0 ? "down" : "";
    return `<span class="${cls}">${p > 0 ? "▲" : p < 0 ? "▼" : "–"} ${nf(Math.abs(p), 1)}${unit}</span>`;
  }
  const ym = (m) => `${m.slice(0, 4)}.${m.slice(5)}`;
  const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);

  // ── 데이터 접근 ─────────────────────────────────────────
  const months = () => D.series.months;
  const entry = (axis, key) => (D.series.series[axis] || {})[key];
  const iLast = () => months().length - 1;
  function sinceOf(axis, key) {
    if (axis !== "product") return null;
    const p = D.meta.products.find((x) => x.key === key);
    return p && p.since ? p.since : null;
  }
  function labelOf(axis, key) {
    if (axis === "total") return "목재류(44류) 전체";
    if (axis === "group") return (D.meta.groups.find((g) => g.key === key) || {}).name || key;
    if (axis === "product") return (D.meta.products.find((p) => p.key === key) || {}).name || key;
    if (axis === "heading") return `${key} ${D.meta.headings[key] || ""}`;
    return key;
  }
  const cname = (c) => (D.meta.countries || {})[c] || c;

  /** 측정값·집계 방식에 따른 시계열. dir: 'imp' | 'exp' */
  function seriesOf(e, dir, measure, agg, since, ak) {
    const ms = months();
    let u = e[dir + "_usd"].slice(), k = e[dir + "_kg"].slice();
    if (since) ms.forEach((m, i) => { if (m < since) { u[i] = null; k[i] = null; } });
    let x = ms.slice(), U = u, K = k;
    if (agg === "year") {
      const ys = [...new Set(ms.map((m) => m.slice(0, 4)))];
      const lastM = +ms[ms.length - 1].slice(5);
      const firstM = +ms[0].slice(5);
      x = ys.map((y, j) => (j === ys.length - 1 && lastM < 12 ? `${y}(~${lastM}월)` : j === 0 && firstM > 1 ? `${y}(${firstM}월~)` : y));
      U = ys.map((y) => { const v = ms.map((m, i) => (m.startsWith(y) ? u[i] : null)).filter((v) => v != null); return v.length ? sum(v) : null; });
      K = ys.map((y) => { const v = ms.map((m, i) => (m.startsWith(y) ? k[i] : null)).filter((v) => v != null); return v.length ? sum(v) : null; });
    } else if (agg === "r12") {
      U = ms.map((_, i) => (i < 11 || u.slice(i - 11, i + 1).some((v) => v == null) ? null : sum(u.slice(i - 11, i + 1))));
      K = ms.map((_, i) => (i < 11 || k.slice(i - 11, i + 1).some((v) => v == null) ? null : sum(k.slice(i - 11, i + 1))));
    }
    let vals;
    if (measure === "imp_usd") vals = U.map((v) => (v == null ? null : v / 1e6));
    else if (measure === "imp_kg") vals = K.map((v) => (v == null ? null : v / 1e6));
    else { const cv = ak ? pconv(ak[0], ak[1]) : (a, b) => a / b; vals = U.map((v, i) => (v == null || !K[i] ? null : cv(v, K[i]))); }
    // 기간 필터
    if (S.start) {
      const keep = x.map((lab) => lab.slice(0, 4) >= S.start);
      return { x: x.filter((_, i) => keep[i]), v: vals.filter((_, i) => keep[i]) };
    }
    return { x, v: vals };
  }
  const yFmt = (measure) => (v) => measure === "price" ? nf(v, v >= 100 ? 0 : 2) : nf(v, v >= 100 ? 0 : 1);
  function revMarkers(x) {
    return (D.meta.hs_revisions || []).filter((r) => x.includes(r.month)).map((r) => ({ x: r.month, label: r.name }));
  }
  const xFmt = (lab, full) => (/^\d{4}-\d{2}$/.test(lab) ? (full ? ym(lab) : (lab.endsWith("-01") ? lab.slice(0, 4) : ym(lab).slice(2))) : lab);

  // 최근 12개월·직전 12개월 합계
  function l12(e, field = "imp_usd") {
    const a = e[field], i = iLast();
    return { cur: i >= 11 ? sum(a.slice(i - 11, i + 1)) : null, prev: i >= 23 ? sum(a.slice(i - 23, i - 11)) : null };
  }
  function topSuppliers(axis, key, n = 10) {
    const rows = (D.countries[axis] || {})[key] || {};
    const tot = sum(Object.values(rows).map((r) => r.l12[0]));
    return Object.entries(rows)
      .map(([c, r]) => ({ c, imp: r.l12[0], kg: r.l12[1], prev: r.p12[0], share: tot ? (r.l12[0] / tot) * 100 : 0 }))
      .filter((r) => r.imp > 0).sort((a, b) => b.imp - a.imp).slice(0, n);
  }

  // ── 공통 렌더 ───────────────────────────────────────────
  // 자료 구분: 원자료(공표 통계 수치 그대로·합계) / 분석(본 페이지가 계산한 비율·지수·환산·판정)
  const KIND_ANA = /^(제품별 자급률|품목별 수입 위험|수입 집중|품목별 판정|품목별 국내 공급 구조|원목 수입의존도|자급-수입 구조|목재제품별 수입의존도|가격 이상 판정|공급국 가격대 지도|수입 단가 지수|단가 지수|국산·수입 가격 수준|수입액 변화 분해|공급국별 수입 단가|공급국 집중도|공급국 쏠림 정도|목재제품별 수입과 점유율|품목군 구성|산림청 공표치 대조)/;
  const KIND_MIX = /^(한 해 쓰는 목재|국내 설비 가동률 추이|국내 생산능력과 생산량)/;
  const KIND_RAW = /^(목재류 수입·수출 추이|품목별 수입액|제품별 원자재 출처|제품별 매출 구조|최대 수입국|최대 수입 품목|수입·수출 추이|주요 공급국|대분류별 원목|세부 수종|.+산 목재류 수입|목재산업 매출|목재제품별 매출|목재는 어디서 와서 무엇이 되나|어디서 사오나)/;
  function kindOf(title, hint) {
    const t = title.replace(/<[^>]+>/g, "").trim();
    if (/^수입·수출 추이/.test(t) && /단가/.test(hint || "")) return "ana";
    if (KIND_ANA.test(t)) return "ana";
    if (KIND_MIX.test(t)) return "mix";
    if (KIND_RAW.test(t)) return "raw";
    return "";
  }
  const KTAG = { raw: `<span class="ktag raw" title="공표 통계 수치를 그대로(또는 합계만) 보여줌">원자료</span>`,
    ana: `<span class="ktag ana" title="공표 통계로 본 페이지가 계산한 비율·지수·환산·판정">분석</span>`,
    mix: `<span class="ktag mix" title="공표값 그대로인 수치와 공표 항목으로 산출한 수치가 함께 있음 (예: 생산량은 공표값, 생산능력은 업체 수 × 업체 평균 최대 생산가능량으로 산출)">원자료·일부 산출</span>` };
  function card(title, hint, body = "", cls = "", lead = "") {
    const k = kindOf(title, hint);
    return `<div class="card ${cls}"><div class="card-head"><h3 class="one-line">${title}${k ? KTAG[k] : ""}</h3>${hint ? `<span class="hint">${hint}</span>` : ""}</div>` +
      `${lead ? `<div class="lead" title="${lead.replace(/<[^>]+>/g, "")}">${lead}</div>` : ""}${body}</div>`;
  }
  // 용어 설명 (물음표에 마우스를 올리거나 누르면 표시)
  const TIP = {
    hhi: "HHI = 수입이 몇몇 나라에 얼마나 몰려 있는지. 나라별 점유율(%)을 제곱해 더한 값으로, 10,000 ÷ HHI = 비슷한 크기의 나라 몇 곳에서 나눠 사오는 것과 같은지. 예) 1개국 100% = 10,000, 4개국 25%씩 = 2,500, 10개국 10%씩 = 1,000. 1,500 미만 분산 · 1,500~2,500 보통 · 2,500 이상 집중 (미국 법무부 시장집중도 기준).",
    dep: "공급국 의존도: 수입이 특정 국가에 얼마나 몰려 있는지. 최대 공급국 점유율 50% 이상 또는 HHI 2,500 이상이면 '높음', HHI 1,500~2,500이면 '보통', 그 미만이면 '낮음'.",
    logdep: "원목 수입의존도 = 100 − 원목자급률. 국내에서 쓰는 원목(㎥) 중 수입산의 비율. 산림청 목재수급통계(연 1회 공표).",
    price: "수입 단가 = 수입액 ÷ 수입량. 운임·보험료가 포함된 도착 가격(CIF). 목재제품은 USD/㎥(중량을 밀도로 환산 — 산림청 임산물수출입통계와 같은 환산계수를 쓴 품목은 ‘산림청 계수’, 나머지는 ‘잠정’), 연료형과 혼합 분류(품목군·수종 등)는 USD/t(톤 액면). 같은 품목도 수종·규격 구성이 바뀌면 달라짐.",
    r12: "12개월 누적: 해당 월까지 최근 12개월 합계. 계절에 따른 들쭉날쭉함을 없애고 추세를 볼 때 씀.",
    share: "점유율: 해당 품목 전체 수입액 중 그 나라가 차지하는 비율.",
    gap: "무역수지 = 수출액 − 수입액. 음수면 수입이 더 많음. 수입은 CIF, 수출은 FOB 기준.",
    ishare: "목재제품별 수입의존도 = 수입량 ÷ (국내 생산량 + 수입량). ㎥ 또는 톤 등 물량 기준(수출은 물량 자료가 없어 제외 — OECD 수입침투율의 근사). 국내 생산량은 산림청 목재이용실태조사(연 1회), 수입량은 실태조사 수록 임산물수출입통계.",
    util: "가동률 = 연 생산량 ÷ 최대 생산가능량. 목재이용실태조사 응답업체 기준. 공표값이 없는 품목은 실태조사 항목(일평균 생산량·가동일·최대 생산가능량)으로 산출.",
    cover: "대체 여력 = 국내 여유 생산능력 ÷ 수입량. 여유 생산능력 = 생산량 × (100 ÷ 가동률 − 1). 100% 이상이면 지금 남는 국내 설비만으로 수입량 전부를 만들 수 있다는 뜻. 원료 조달·품질·가격은 반영하지 않은 물리적 상한.",
    idx: "수입 단가 지수: 비교 시작 시점의 12개월 평균 수입 단가(CIF)를 100으로 놓고 환산한 값. 단위가 다른 품목의 가격 변화 속도를 한 그래프에서 비교하기 위함.",
  };
  const q = (k) => `<button class="q" type="button" aria-label="설명" data-tip="${TIP[k]}">?</button>`;
  // HHI를 '나라 몇 곳에서 나눠 사오는 수준'으로 보여주는 눈금 (1곳=10,000 … 10곳=1,000)
  function hhiScale(h) {
    const n = 10000 / h, pos = (v) => (Math.log(Math.min(Math.max(v, 1), 15)) / Math.log(15)) * 100;
    const ticks = [[1, "1곳"], [2, "2곳"], [4, "4곳"], [6.7, "6.7곳"], [10, "10곳"], [15, "15곳+"]];
    return `<div class="hhi-scale" aria-label="나라 ${nf(n, 1)}곳에서 나눠 사오는 수준">
      <div class="hs-bar"><span class="z hi" style="left:0;width:${pos(4)}%"></span><span class="z mid" style="left:${pos(4)}%;width:${pos(6.67) - pos(4)}%"></span><span class="z lo" style="left:${pos(6.67)}%;right:0"></span>
        <i class="hs-mk" style="left:${pos(n)}%"><b>${nf(n, 1)}곳</b></i></div>
      <div class="hs-tk">${ticks.map(([v, l]) => `<span style="left:${pos(v)}%">${l}</span>`).join("")}</div>
      <div class="hs-ends"><span>◀ 한두 나라에 몰림 (집중)</span><span>여러 나라에 고르게 (분산) ▶</span></div></div>`;
  }
  function depGrade(topShare, hhi) {
    if (topShare >= 50 || hhi >= 2500) return { cls: "hi", label: "높음" };
    if (hhi >= 1500) return { cls: "mid", label: "보통" };
    return { cls: "lo", label: "낮음" };
  }
  function periodL12() { const ms = months(), n = ms.length; return n >= 12 ? `${ym(ms[n - 12])}~${ym(ms[n - 1])}` : ""; }
  const SRC = "관세청 수출입실적";
  function kpi(label, value, sub) {
    return `<div class="card kpi"><div class="label one-line">${label}</div><div class="value one-line num">${value}</div><div class="delta one-line">${sub || "&nbsp;"}</div></div>`;
  }
  function trendTitle(ak) {
    const a = { month: "월별", year: "연간", r12: "12개월 누적" }[S.agg];
    const u = S.measure === "price" && ak ? plabel(ak[0], ak[1]) : UNIT[S.measure];
    return `${a} ${MLABEL[S.measure]} (${u})`;
  }

  function renderHeader() {
    const m = D.meta;
    const status = m.status || "collecting";
    const label = { ok: "정상 갱신", delayed: "갱신 지연", collecting: "수집 중" }[status] || status;
    $("#chips").innerHTML =
      `<span class="chip"><span class="dot ${status}"></span>${label}</span>` +
      (m.latest_month ? `<span class="chip">기준월 <b>${ym(m.latest_month)}</b></span>` : "") +
      (m.first_month ? `<span class="chip">범위 <b>${ym(m.first_month)}~${ym(m.latest_month)}</b></span>` : "") +
      (m.updated_at ? `<span class="chip">갱신 <b>${m.updated_at.slice(0, 10)}</b></span>` : "");
    const b = $("#banner");
    const msgs = [];
    if (status === "delayed") msgs.push(`<div class="banner warn">⚠ 최근 갱신이 검증을 통과하지 못해 이전 데이터를 표시 중임. 사유: ${m.status_msg}</div>`);
    if (m.first_month && m.target_start && m.first_month > m.target_start)
      msgs.push(`<div class="banner">과거 데이터를 매일 자동으로 채우는 중임 (목표 ${ym(m.target_start)}부터, 현재 ${m.months_available}개월 확보).</div>`);
    b.innerHTML = msgs.join("");
  }

  function openDetail(axis, key) {
    if (axis === "group") return;   // 품목군 탭은 없앰 (품목군은 내부 집계용)
    if (axis === "product") { S.product = key; go("product"); }
    else if (axis === "species2") { S.sp2 = key; go("species"); }
    else if (axis === "heading") { if (key === "4407") { S.product = "p01"; go("product"); } else go("species"); }
  }

  // ── 레퍼런스 짧은 표기 ─────────────────────────────────
  const REF = { motie2023: "산업부(2023) 산업 공급망 3050 전략", doj2010: "미국 DOJ·FTC(2010)", doj2023: "DOJ·FTC(2023)",
    oecd_stan: "OECD STAN", mann1945: "Mann(1945)", kendall1975: "Kendall(1975)", fao_ifpa: "FAO IFPA(SDG 2.c.1)", ang2005: "Ang(2005) LMDI",
    kfs_wus: "산림청 목재이용실태조사", kfcf2026: "산림조합 판매단가표", bok_fx: "한국은행 환율" };
  const refs = (ks) => (ks || []).filter((k) => k !== "doj2023").map((k) => REF[k] || k).join(" · ");
  const GRADE_CLS = { "취약": "hi", "주의": "mid", "안정": "lo", "판정 제외": "ex", "비정상 상승": "hi", "다소 높음": "mid", "정상": "lo",
    "다소 낮음": "mid", "비정상 하락": "hi", "판정 보류": "na" };
  const badge = (t) => `<span class="grade ${GRADE_CLS[t] || "lo"}">${t}</span>`;
  const rule = (html) => `<div class="rule">${html}</div>`;

  // ── 판정 요약 ──────────────────────────────────────────
  function renderVerdicts() {
    const J = D.judg;
    $("#v-hint").innerHTML = `${KTAG.ana} ${ym(J.month)} 기준`;
    const ORD = ["penetration", "supply", "domestic", "price", "drivers"], GO = { penetration: "sec-risk", supply: "sec-risk", domestic: "sec-domestic", price: "sec-price", drivers: "sec-drivers" };
    $("#verdicts").innerHTML = [...J.cards].filter((c) => c.id !== "drivers").sort((a, b) => ORD.indexOf(a.id) - ORD.indexOf(b.id)).map((c) =>
      `<button class="vcard ${c.level}" data-go="${GO[c.id] || "sec-" + c.id}"><span class="vt">${c.title}</span><span class="vb">${c.badge}</span>` +
      `<span class="vx">${c.text}</span><span class="vr">기준: ${refs(c.refs)}</span></button>`).join("");
    $("#verdicts").querySelectorAll(".vcard").forEach((b) => b.onclick = () => goSec(b.dataset.go));
  }

  function goSec(id) {
    let tg = document.getElementById(id); if (!tg) return;
    let d = tg; while (d) { if (d.tagName === "DETAILS") d.open = true; d = d.parentElement; }
    setTimeout(() => {
      tg = document.getElementById(id); if (!tg) return;          // 펼칠 때 다시 그려지므로 새로 찾음
      const box = tg.closest(".card") || tg;
      window.scrollTo({ top: box.getBoundingClientRect().top + scrollY - 80, behavior: "smooth" });
      if (box.classList.contains("card")) { box.classList.remove("sr-flash"); void box.offsetWidth; box.classList.add("sr-flash"); }
    }, 120);
  }
  // 가로 누적 막대 (pct: 비율 막대) — rows [{label, values, text, onClick}], parts [{name, color}]
  function stackRows(host, rows, parts, pct) {
    const mx = Math.max(...rows.map((r) => sum(r.values))) || 1;
    host.innerHTML = `<div class="legend">${parts.map((pt) => `<span><i style="background:${pt.color}"></i>${pt.name}</span>`).join("")}</div>` +
      `<div class="sk-rows">${rows.map((r, i) => { const tt = sum(r.values) || 1;
        return `<div class="sk-row${r.onClick ? " click" : ""}" data-i="${i}"><span class="sk-l">${r.label}</span><span class="sk-bar" style="width:${pct ? 100 : (tt / mx) * 100}%">` +
          r.values.map((v, k) => v > 0 ? `<i style="width:${(v / tt) * 100}%;background:${parts[k].color}" title="${parts[k].name} ${nf(pct ? (v / tt) * 100 : v, 0)}${pct ? "%" : ""}"></i>` : "").join("") +
          `</span><span class="sk-t">${r.text || ""}</span></div>`; }).join("")}</div>`;
    host.querySelectorAll(".sk-row.click").forEach((el) => el.onclick = () => rows[+el.dataset.i].onClick());
  }

  // ── 수입 위험 (수입의존도 + 특정국 의존) ─────────────────
  function renderRisk() {
    const host = $("#a-risk"); if (!host) return;
    const sr = D.judg.supply_risk, per = periodL12(), P = D.judg.penetration, DS = D.judg.domestic_supply;
    const dep = {}; ((DS && DS.rows) || []).forEach((r) => { dep[`${r.axis}:${r.key}`] = r; });
    const GO = { "취약": 0, "주의": 1, "안정": 2, "판정 제외": 3 };
    const rows = [...sr].sort((a, b) => (GO[a.grade] - GO[b.grade]) || (b.imp_usd - a.imp_usd));
    const nV = sr.filter((d) => d.grade === "취약").length, nC = sr.filter((d) => d.grade === "주의").length;
    const col = { "취약": C.color(7), "주의": C.color(3), "안정": C.color(0), "판정 제외": getComputedStyle(document.documentElement).getPropertyValue("--other").trim() };
    const yr = DS && DS.rows.length ? Math.max(...DS.rows.map((d) => d.year)) : "";
    const mk = (P && P.mk) || {};
    const SH = D.judg.supply_hist;
    const DR = ((DS && DS.rows) || []).filter((r) => r.share_years && r.share_years.length);
    const depYrs = [...new Set(DR.flatMap((r) => r.share_years))].sort((a, b) => a - b);
    const lastOf = (r) => r.share_series[r.share_series.length - 1];
    const DSER = DR.map((r) => ({ key: `${r.axis}:${r.key}`, name: r.label.replace(/\(.+\)/, ""), full: r.label,
      v: depYrs.map((y) => { const j = r.share_years.indexOf(y); return j >= 0 ? r.share_series[j] : null; }), last: lastOf(r), long: r.share_years[0] === depYrs[0] }))
      .sort((a, b) => b.last - a.last);
    if (!S.dph) S.dph = new Set(DSER.filter((s) => s.long).map((s) => s.key));
    const drawDep = () => {
      const box = $("#dp-line"), chips = $("#dp-chips"); if (!box || !DSER.length) return;
      const hl = S.dph, pal = {}; let ci = 0; DSER.forEach((s) => { if (hl.has(s.key)) pal[s.key] = C.color(ci++); });
      chips.innerHTML = DSER.map((s) => `<button type="button" class="dp-chip${hl.has(s.key) ? " on" : ""}" data-k="${s.key}"${hl.has(s.key) ? ` style="--c:${pal[s.key]}"` : ""}><i></i>${s.name} <b>${nf(s.last, 0)}%</b></button>`).join("") +
        `<button type="button" class="dp-chip dp-all" data-k="*">${hl.size ? "강조 해제" : "6개 제품 강조"}</button>`;
      chips.querySelectorAll(".dp-chip").forEach((b) => b.onclick = () => { const k = b.dataset.k;
        if (k === "*") S.dph = hl.size ? new Set() : new Set(DSER.filter((s) => s.long).map((s) => s.key)); else hl.has(k) ? hl.delete(k) : hl.add(k); drawDep(); });
      const W = Math.max(600, box.clientWidth || 1100), H = 300, L = 40, R = 120, T = 10, B = 26;
      const x = (i) => L + (i / (depYrs.length - 1)) * (W - L - R), y = (v) => T + (1 - v / 100) * (H - T - B);
      const path = (s) => { let d = "", pen = false; s.v.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1); pen = true; }); return d; };
      const grid = [0, 25, 50, 75, 100].map((g) => `<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" class="dp-grid"/><text x="${L - 6}" y="${y(g) + 4}" class="dp-ax" text-anchor="end">${g}%</text>`).join("") +
        depYrs.map((yy, i) => `<text x="${x(i)}" y="${H - 6}" class="dp-ax" text-anchor="middle">${yy}</text>`).join("");
      const bg = DSER.filter((s) => !hl.has(s.key)).map((s) => `<path d="${path(s)}" class="dp-bg" data-k="${s.key}"/>`).join("");
      const fg = DSER.filter((s) => hl.has(s.key)).map((s) => `<path d="${path(s)}" class="dp-fg" style="stroke:${pal[s.key]}"/>` +
        s.v.map((v, i) => v == null ? "" : `<circle cx="${x(i)}" cy="${y(v)}" r="2.6" style="fill:${pal[s.key]}"/>`).join("")).join("");
      // 오른쪽 끝 이름표 (겹치면 아래로 밀어냄)
      const lab = DSER.filter((s) => hl.has(s.key)).map((s) => ({ s, yy: y(s.last) })).sort((a, b) => a.yy - b.yy);
      lab.forEach((l, i) => { if (i && l.yy - lab[i - 1].yy < 13) l.yy = lab[i - 1].yy + 13; });
      const tags = lab.map((l) => `<text x="${W - R + 8}" y="${l.yy + 4}" class="dp-tag" style="fill:${pal[l.s.key]}">${l.s.name} ${nf(l.s.last, 0)}%</text>`).join("");
      box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">${grid}${bg}${fg}${tags}<line class="dp-cross" y1="${T}" y2="${H - B}" style="display:none"/></svg><div class="tip"></div>`;
      const svg = box.querySelector("svg"), tip = box.querySelector(".tip"), cr = box.querySelector(".dp-cross");
      svg.onmousemove = (ev) => { const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width;
        const i = Math.max(0, Math.min(depYrs.length - 1, Math.round((px - L) / (W - L - R) * (depYrs.length - 1))));
        cr.setAttribute("x1", x(i)); cr.setAttribute("x2", x(i)); cr.style.display = "";
        const rows = DSER.filter((s) => s.v[i] != null).sort((a, b) => b.v[i] - a.v[i]);
        tip.innerHTML = `<div class="tt">${depYrs[i]}년 수입의존도</div>` + rows.map((s) => `<div class="tr"${hl.has(s.key) ? "" : ' style="opacity:.6"'}><span>${hl.has(s.key) ? `<i style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;background:${pal[s.key]}"></i>` : ""}${s.name}</span><b>${nf(s.v[i], 1)}%</b></div>`).join("");
        tip.style.display = "block"; const bw = box.clientWidth, tw = tip.offsetWidth; let lft = (x(i) * r.width / W) + 14; if (lft + tw > bw) lft = (x(i) * r.width / W) - tw - 14;
        tip.style.left = Math.max(0, lft) + "px"; tip.style.top = "0px"; };
      svg.onmouseleave = () => { tip.style.display = "none"; cr.style.display = "none"; };
      svg.querySelectorAll(".dp-bg").forEach((pth) => pth.onclick = () => { hl.add(pth.dataset.k); drawDep(); });
    };
    host.innerHTML =
      card(`품목별 수입 위험 ${q("dep")}`, "행을 누르면 상세",
        `<div class="tbl-wrap" id="rk-tbl"></div>` +
        rule(`<b>수입의존도</b> = 수입량 ÷ (국내 생산량 + 수입량), 물량 기준 (산림청 목재이용실태조사, OECD 수입침투율의 근사) · <b>공급망 판정</b>: 취약 = 연 수입액 100만 달러 이상 + 특정국 의존 50% 이상 (산업부 산업 공급망 3050 전략, 2023) · 주의 = HHI 2,500 이상 (미국 DOJ·FTC, 2010) · 100만 달러 미만은 판정 제외 · 판정·공급국·HHI·수입액 = 선택한 해 1~12월 수입액 기준, 수입의존도 = 그 해 실태조사 값(공표 전이면 –) · 출처: ${SRC}(${SH.years[0]}~${SH.years[SH.years.length - 1]}), 산림청 목재이용실태조사`), "span-2",
        `취약 ${nV}개 · 주의 ${nC}개 <span class="sub">${nV ? sr.filter((d) => d.grade === "취약").map((d) => d.label.replace(/\(.+\)/, "")).join(" · ") : ""}</span>`) +
      card(`목재제품별 수입의존도 ${q("dep")}`, `${depYrs[0]}~${depYrs[depYrs.length - 1]} · 물량 기준 % · 이름을 누르면 강조`, `<div id="dp-chips" class="dp-chips"></div><div id="dp-line" class="dp-line"></div>` +
        rule(`수입의존도 = 수입량 ÷ (국내 생산량 + 수입량), 물량 기준 · 출처: 산림청 목재이용실태조사(2016~2019는 6개 제품만 공표, 2020~ 전 제품) · 원목은 실태조사 기준이라 산림청 목재수급통계의 원목 수입의존도(100 − 원목자급률)와 값이 다름`), "span-2",
        `2016년부터 자료가 있는 6개 제품 강조 · 마우스를 올리면 그 해 전 제품 값`);
    drawDep();
    // 표: 기간 선택(최근 12개월 / 연도) + 머리글을 누르면 그 항목 내림차순, 다시 누르면 기본(공급망 판정 순)
    const RULE = { "취약": "연 수입액 ≥ 100만 달러, 특정국 ≥ 50%", "주의": "HHI ≥ 2,500", "안정": "특정국 < 50%, HHI < 2,500", "판정 제외": "연 수입액 < 100만 달러" };
    const view = (y) => {
      const i = SH.years.indexOf(y), list = [], none = [];
      sr.forEach((d) => { const h = SH.items[`${d.axis}:${d.key}`], g = h && h.grade[i], tp = h && h.top[i];
        const r = dep[`${d.axis}:${d.key}`], j = r && r.share_years ? r.share_years.map(String).indexOf(y) : -1;
        if (!g) { none.push(d.label); return; }
        list.push({ axis: d.axis, key: d.key, label: d.label, top_name: tp[0], top_share: tp[1], hhi: h.hhi[i], imp_usd: tp[2], grade: g,
          prev: i > 0 ? h.grade[i - 1] : null, reason: `${y}년 ${g}: ${RULE[g]}`, dep: j >= 0 ? r.share_series[j] : null }); });
      return { list, none, per: `${y}년` };
    };
    const val = (d, k) => k === "dep" ? (d.dep != null ? d.dep : -1) : k === "top" ? d.top_share : k === "hhi" ? d.hhi : k === "usd" ? d.imp_usd : 0;
    const fullYears = SH ? [...SH.years].reverse() : [];
    // 기본 연도 = 수입의존도(실태조사)가 있는 가장 최근 연도 — 실태조사가 새로 공표되면 자동으로 다음 해로 넘어감
    const depYs = new Set(Object.values(dep).flatMap((r) => (r.share_years || []).map(String)));
    const defY = fullYears.find((yy) => depYs.has(yy)) || fullYears[0];
    const drawTbl = () => {
      const k = S.rks || "grade", y = S.rky || defY, V = view(y);
      const rs = [...V.list].sort(k === "grade" ? (a, b) => (GO[a.grade] - GO[b.grade]) || (b.imp_usd - a.imp_usd) : (a, b) => val(b, k) - val(a, k));
      const th = (key, html, cls = "") => `<th class="sortable${cls}${k === key ? " on" : ""}" data-s="${key}">${html}${k === key ? " ▼" : ""}</th>`;
      const nV2 = V.list.filter((d) => d.grade === "취약"), nC2 = V.list.filter((d) => d.grade === "주의").length;
      const ld = host.querySelector(".card .lead");
      if (ld) ld.innerHTML = `${y}년 · 취약 ${nV2.length}개 · 주의 ${nC2}개 <span class="sub">${nV2.map((d) => d.label.replace(/\(.+\)/, "")).join(" · ")}</span>`;
      $("#rk-tbl").innerHTML =
        `<div class="rk-per"><select id="rk-yr" class="mini-sel">${fullYears.map((yy) => `<option value="${yy}"${y === yy ? " selected" : ""}>${yy}년</option>`).join("")}</select>` +
        `<span class="sub">회색 글씨 = 전년(${+y - 1}년) 판정, 전년과 바뀐 품목만 표시</span></div>` +
        `<table><thead><tr><th class="l">품목</th>` +
        th("dep", `수입의존도<br><span class="sub">물량 · ${V.per}</span>`) + th("top", `최대 공급국<br><span class="sub">점유율 · ${V.per}</span>`, " l") +
        th("hhi", "HHI") + th("grade", "공급망 판정") + th("usd", `수입액<br><span class="sub">${V.per}</span>`) + `</tr></thead><tbody>` +
        rs.map((d) => `<tr class="click" data-axis="${d.axis}" data-key="${d.key}" title="${d.reason}"><td class="l">${d.label}</td><td>${d.dep != null ? nf(d.dep, 0) + "%" : "–"}</td>` +
            `<td class="l">${d.top_name} ${nf(d.top_share, 0)}%</td><td>${nf(d.hhi, 0)}</td><td>${d.prev && d.prev !== d.grade ? `<span class="rk-prev">${d.prev}</span><span class="rk-arr">→</span>` : ""}${badge(d.grade)}</td><td>${usd(d.imp_usd)}</td></tr>`).join("") +
        (V.none.length ? `<tr class="rk-none"><td class="l" colspan="6">${y}년 수입 없음 또는 전용 HS 코드 신설 전: ${V.none.join(" · ")}</td></tr>` : "") + `</tbody></table>`;
      $("#rk-tbl").querySelectorAll("th.sortable").forEach((h) => h.onclick = () => { const s = h.dataset.s; S.rks = S.rks === s && s !== "grade" ? "grade" : s; drawTbl(); });
      $("#rk-tbl").querySelectorAll("tr[data-axis]").forEach((tr) => tr.onclick = () => openDetail(tr.dataset.axis, tr.dataset.key));
      $("#rk-yr").onchange = (ev) => { S.rky = ev.target.value; drawTbl(); };
    };
    drawTbl();
  }

  // ── 국내 유통 라인 (목재이용실태조사) ───────────────────
  function renderDist() {
    const host = $("#a-dist"); if (!host) return;
    const G = D.judg.glance, I = D.judg.industry;
    if (!G || !G.products) { host.innerHTML = card("국내 유통 라인", "", `<div class="empty">실태조사 자료 없음</div>`, "span-2"); return; }
    const EX = { pulp: "펄프", sawdust: "톱밥·목분", firewood: "장작", mushroom_log: "버섯 원목" };
    const SHN = { p09: "OSB", p04: "목재플라스틱(WPC)", p10: "목질바닥재" };
    const nm = (k) => { const p = D.meta.products.find((x) => x.key === k); return SHN[k] || (p ? p.name.replace(/\(.+\)/, "") : EX[k] || k); };
    const isP = (k) => !!D.meta.products.find((x) => x.key === k);
    const SRCS = [["use_log_domestic", "국산 원목", C.color(2)], ["use_other_raw", "원목 외 원자재", C.color(3)], ["use_log_imported", "수입 원목", C.color(1)], ["use_imported_products", "수입 제품", C.color(0)]];
    const pr = G.products.filter((d) => d.total >= 1e4);
    host.innerHTML =
      card("제품별 원자재 출처", `${G.year}년 · 막대 = 비율 · 오른쪽 = 이용량`, `<div id="ds-src"></div>` +
        rule(`국산 원목·수입 원목으로 국내에서 만든 몫과, 제품째 수입한 몫 (실태조사 「국내 목재 이용 현황」 표 그대로 옮김) · 원목 외 원자재 = 폐목재·부산물·칩 등 · 단위 ㎥ (펠릿 수입은 톤×1.67, 그 밖의 톤 단위 제품은 1:1, 실태조사 방식) · 출처: ${G.source}`), "",
        (() => { const top = pr.slice(0, 3).map((d) => `${nm(d.key)} 수입 ${nf(((d.flows.use_log_imported + d.flows.use_imported_products) / d.total) * 100, 0)}%`); return top.join(" · "); })()) +
      (I ? card("제품별 매출 구조", `${I.year}년 · 억 원`, `<div id="ds-sales"></div>` +
        rule(`국내 생산업체 = 국내에서 제품을 만든 업체 매출 · 수입·유통업체 = 수입해서 파는 업체 매출(실태조사 가중치 추정) · 출처: ${I.source}`), "",
        `국내 생산 ${nf(I.domestic[I.years.length - 1] / 1e4, 1)}조 · 수입·유통 ${nf(I.imports[I.years.length - 1] / 1e4, 1)}조 원`) : "");
    stackRows($("#ds-src"), pr.map((d) => ({ label: nm(d.key), values: SRCS.map(([k]) => d.flows[k] || 0),
      text: `${nf(d.total / 1e4, d.total >= 1e5 ? 0 : 1)}만 ㎥`, onClick: isP(d.key) ? () => openDetail("product", d.key) : null })), SRCS.map(([, n, c]) => ({ name: n, color: c })), true);
    if (I) stackRows($("#ds-sales"), I.products.filter((d) => d.sales >= 100).slice(0, 15).map((d) => ({ label: d.label.replace(/\(.+\)/, "").replace("배향성스트랜드보드", "OSB").replace("목재플라스틱복합재", "목재플라스틱(WPC)"), values: [d.domestic || 0, d.import || 0],
      text: `${nf(d.sales, 0)}억`, onClick: d.is_product ? () => openDetail("product", d.key) : null })), [{ name: "국내 생산업체", color: C.color(2) }, { name: "수입·유통업체", color: C.color(0) }], false);
  }

  // ── 국내 공급 여력 (목재이용실태조사) ──────────────────
  function renderDomestic() {
    const DS = D.judg.domestic_supply, host = $("#a-domestic");
    if (!host) return;
    if (!DS) { host.innerHTML = card("국내 공급 여력", "", `<div class="empty">실태조사 자료 없음</div>`, "span-2"); return; }
    const rows = DS.rows, yr = Math.max(...rows.map((d) => d.year)), per = periodL12();
    const ov = DS.overall[DS.overall.length - 1];
    const u = (d) => (d.unit === "t" ? "톤" : "㎥");
    const big = (v) => (v >= 1e4 ? nf(v / 1e4, 0) + "만" : nf(v, 0));
    const col = { "취약": C.color(7), "주의": C.color(3), "안정": C.color(0) };
    const CAP = 300;
    const pts = rows.filter((d) => d.top_share != null && d.spare_cover != null && d.risk_grade !== "판정 제외");
    const short = (l) => l.replace(/\(.+\)/, "");
    const low = rows.filter((d) => d.risk_grade === "취약" && d.spare_cover != null && d.spare_cover < DS.line);
    host.innerHTML =
      card(`수입 집중 × 국내 대체 여력 ${q("cover")}`, `가로 ${per} 관세청 · 세로 ${yr}년 실태조사`, `<div id="ds-map"></div>` +
        rule(`세로 100% 선 = 국내 여유 생산능력이 현재 수입량과 같아지는 경계 (정의상) · 가로 50% 선 = 산업부 특정국 의존 기준 · <b>왼쪽 아래보다 오른쪽 아래</b>(쏠렸고 국내로 못 메움)가 실제 공급 차질 위험이 큰 품목`), "",
        low.length ? `쏠렸고 국내로 못 메움: ${low.map((d) => `${short(d.label)} ${nf(d.spare_cover, 0)}%`).join(" · ")}` : "수입 집중 취약 품목 모두 국내 여유능력으로 대체 가능") +
      card(`품목별 국내 공급 구조 ${q("ishare")}`, `${yr}년 · 행을 누르면 상세`,
        `<div class="tbl-wrap"><table><thead><tr><th class="l">품목</th><th>수입의존도</th><th>추세</th><th>가동률 ${q("util")}</th><th>대체 여력</th><th>수입 집중</th></tr></thead><tbody>` +
        rows.map((d) => `<tr class="click" data-axis="${d.axis}" data-key="${d.key}" title="국내 생산 ${big(d.production)}${u(d)} · 수입 ${big(d.imports)}${u(d)}${d.util_note ? " · 가동률: " + d.util_note : ""}">` +
          `<td class="l">${short(d.label)}</td><td>${nf(d.import_share, 0)}%</td><td>${badge(d.trend.startsWith("판정 보류") ? "판정 보류" : d.trend)}</td>` +
          `<td>${d.utilization == null ? "–" : nf(d.utilization, 0) + "%" + (/참고치/.test(d.util_note) ? "*" : "")}</td>` +
          `<td>${d.spare_cover == null ? "–" : nf(d.spare_cover, 0) + "%"}</td><td>${d.risk_grade ? badge(d.risk_grade) : "–"}</td></tr>`).join("") +
        `</tbody></table></div><div class="foot">수입 비중 = 수입량 ÷ (국내 생산 + 수입), 물량 기준 · 추세: Mann-Kendall(5개년 이상) · * 참고치(전국 생산량 ÷ 최대 생산가능량 합계) · 출처: 산림청 목재이용실태조사(${yr}년 기준), 수입 집중은 ${SRC}</div>`, "",
        `국내 목재 이용량 중 수입(제품+원목) ${nf(ov.import_share, 1)}% <span class="sub">(${ov.year}년, 총 ${nf(ov.total / 1e6, 1)}백만 ㎥)</span>`);
    const UTIL_KEYS = ["p01", "p06", "p07", "p08", "p10", "p12"];   // 업체 수가 적은 소량 품목(집성재·WPC·난연)은 해마다 출렁여 제외
    const utilRows = rows.filter((d) => UTIL_KEYS.includes(d.key) && d.util_years.length >= 8);
    const uy = [...new Set(utilRows.flatMap((d) => d.util_years))].sort();
    host.insertAdjacentHTML("beforeend",
      card(`국내 설비 가동률 추이 ${q("util")}`, `${uy[0]}~${uy[uy.length - 1]} · %`, `<div id="ds-util"></div>` +
        rule(`가동률 = 연 생산량 ÷ 최대 생산가능량 (실태조사 정의, 응답업체 기준) · 제재목·목재칩은 일평균 생산량 × 월 가동일 × 12로 산출 · 합판 3개·파티클보드 2개·섬유판 5개 업체라 해마다 출렁임 · 집성재·WPC·난연목재는 표에만 표시`), "",
        utilRows.map((d) => `${short(d.label)} ${nf(d.utilization, 0)}%`).join(" · ")));
    const CAPS = DS.capacity || [];
    if (CAPS.length) {
      const chg = CAPS.map((c) => ({ c, r: c.capacity[c.capacity.length - 1] / c.capacity[0] - 1 }));
      const down = chg.filter((x) => x.r <= -0.15).sort((a, b) => a.r - b.r), up = chg.filter((x) => x.r >= 0.15);
      const cy0 = CAPS[0].years[0], cy1 = CAPS[0].years[CAPS[0].years.length - 1];
      const leadCap = [down.length ? `설비 감소 ${down.slice(0, 3).map((x) => `${short(x.c.label)} ${nf(x.r * 100, 0)}%`).join(" · ")}` : "",
        up.length ? `증가 ${up.map((x) => `${short(x.c.label)} ${x.r >= 1 ? nf(x.r + 1, 0) + "배" : "+" + nf(x.r * 100, 0) + "%"}`).join(" · ")}` : ""].filter(Boolean).join(" / ");
      host.insertAdjacentHTML("beforeend",
        card(`국내 생산능력과 생산량`, `${cy0}~${cy1} · 업체 수 × 업체 평균 최대 생산가능량`,
          `<div class="legend"><span><i class="line" style="background:${C.color(7)}"></i>생산능력</span><span><i class="line" style="background:${C.color(0)}"></i>생산량</span><span class="sub">두 선 사이 = 놀고 있는 설비</span></div>` +
          `<div class="cap-grid">${CAPS.map((c, i) => { const f0 = c.firms[0], f1 = c.firms[c.firms.length - 1];
            return `<div class="cap-m"><div class="cap-t one-line"><b>${short(c.label)}</b> <span class="sub">업체 ${f0 === f1 ? f1 : `${f0}→${f1}`}개 · ${c.unit === "t" ? "만 톤" : "만 ㎥"}</span></div><div id="cap-${i}"></div></div>`; }).join("")}</div>` +
          rule(`가동률은 생산량 ÷ 생산능력이라 생산량이 그대로여도 공장이 문을 닫으면(생산능력 감소) 올라감 — 가동률 변화는 이 그림과 함께 읽을 것 · 생산능력 = 업체 수 × 업체 평균 최대 생산가능량(실태조사 응답업체 기준), 생산량 = 전국 추계라 비율이 왼쪽 가동률과 다를 수 있음(제재목) · 출처: 산림청 목재이용실태조사(2024년 기준)`),
          "", leadCap));
      CAPS.forEach((c, i) => C.lineChart($(`#cap-${i}`), { x: c.years.map((y) => "’" + String(y).slice(2)), noLegend: true, height: 128, ticks: 2,
        series: [{ name: "생산능력", values: c.capacity.map((v) => v / 1e4), color: C.color(7) }, { name: "생산량", values: c.production.map((v) => v / 1e4), color: C.color(0) }],
        yFmt: (v) => nf(v, 0), tipFmt: (v) => nf(v, 1) + (c.unit === "t" ? "만 톤" : "만 ㎥") }));
    }
    C.scatterChart($("#ds-map"), {
      points: pts.map((d) => ({ x: d.top_share, y: Math.min(d.spare_cover, CAP), label: short(d.label), color: col[d.risk_grade] || C.color(0),
        size: 7, labelOn: d.risk_grade === "취약" || d.spare_cover >= 30 || d.top_share >= 50, onClick: () => openDetail(d.axis, d.key), d })),
      xMin: 0, xMax: 100, height: 540, xTitle: "최대 공급국 점유율 (%, 관세청)", yTitle: "국내 대체 여력 (%, 300 이상은 300)",
      xFmt: (v) => v + "%", yFmt: (v) => v + "%", refX: [{ v: 50, label: "특정국 50%" }], refY: [{ v: DS.line, label: "여유능력 = 수입량" }],
      tip: (p) => `<div class="tt">${p.d.label} ${p.d.risk_grade ? badge(p.d.risk_grade) : ""}</div>` +
        `<div class="tr"><span>최대 공급국</span><b>${p.d.top_name} ${nf(p.d.top_share, 0)}%</b></div>` +
        `<div class="tr"><span>수입의존도(물량)</span><b>${nf(p.d.import_share, 0)}%</b></div>` +
        `<div class="tr"><span>가동률</span><b>${p.d.utilization == null ? "–" : nf(p.d.utilization, 0) + "%"}</b></div>` +
        `<div class="tr"><span>대체 여력</span><b>${nf(p.d.spare_cover, 0)}%</b></div>` });
    C.lineChart($("#ds-util"), { x: uy.map(String), series: utilRows.map((d) => ({ name: short(d.label),
      values: uy.map((y) => { const i = d.util_years.indexOf(y); return i < 0 ? null : d.util_series[i]; }) })),
      yFmt: (v) => nf(v, 0) + "%", tipFmt: (v) => nf(v, 1) + "%", height: 300 });
    host.querySelectorAll("tr[data-axis]").forEach((tr) => tr.onclick = () => openDetail(tr.dataset.axis, tr.dataset.key));
  }

  // ── 목재산업 규모 (목재이용실태조사 공표값) ────────────
  // ── 가격 ───────────────────────────────────────────────
  const PU_RULE = "<b>톤 단가</b> = 수입액 ÷ 순중량 (관세청 액면, 환산 없음) · <b>㎥ 단가</b> = 톤 단가 × 밀도(t/㎥) — 밀도: 원목·제재목·단판·합판·파티클보드·섬유판은 <b>산림청 환산계수</b>(산림청 임산물수출입통계 수입 ㎥ = 관세청 중량 ÷ 계수임을 2016~2025년 전 연도에서 확인 — 원목 0.855·제재목 0.60·단판 0.50·합판 0.65·파티클보드 0.65·섬유판 0.70), 나머지는 <b>잠정</b> 대표값 · 수입 단가 지수·이상 판정은 단위와 무관";
  function renderPuSeg() {
    const el = $("#pu-seg"); if (!el) return;
    el.querySelectorAll("button").forEach((b) => { b.classList.toggle("on", b.dataset.pu === S.pu);
      b.onclick = () => { S.pu = b.dataset.pu; setHash(); renderPuSeg(); renderPrice(); if ($("#explore").open) renderTab(); }; });
  }
  function renderPrice() {
    renderPuSeg();
    const PA = D.judg.price_anomaly, ms = months();
    const ready = PA.filter((d) => d.band !== "판정 보류");
    // 지도 품목 = 이상 판정 품목 + 국산 가격이 있는 구조용 집성재·CLT (월 수입이 작아 이상 판정은 하지 않음)
    const opts = [...PA.map((d) => [d.axis, d.key, d.label]), ...["p05", "p16"].map((k) => D.meta.products.find((p) => p.key === k)).filter((p) => p && entry("product", p.key))
      .map((p) => ["product", p.key, p.key === "p05" ? "구조용 집성재" : p.name])];
    if (!S.pmap || !opts.find((o) => `${o[0]}:${o[1]}` === S.pmap)) S.pmap = "product:p11";
    // 단가 지수 (12개월 평균, 시작=100)
    const pitems = [["heading", "4403", "원목"], ["heading", "4407", "제재목"], ["product", "p06", "합판"], ["product", "p11", "목재펠릿"]].filter(([a, k]) => entry(a, k));
    const r12p = (e) => ms.map((_, i) => { if (i < 11) return null; const u = sum(e.imp_usd.slice(i - 11, i + 1)), k = sum(e.imp_kg.slice(i - 11, i + 1)); return k ? u / k : null; });
    const pser = pitems.map(([a, k, n]) => { const v = r12p(entry(a, k)); const b = v.find((x) => x != null); return { name: n, raw: v, values: v.map((x) => (x == null || !b ? null : (x / b) * 100)), a, k }; });
    const now = pser.map((p) => { const i = ms.length - 1; return { n: p.name, v: p.raw[i] != null ? pconv(p.a, p.k)(p.raw[i], 1) : null, u: plabel(p.a, p.k), f: pfmt(p.a, p.k) }; });
    $("#a-price").innerHTML =
      card(`가격 이상 판정 ${q("price")}`, `${ym(ms[ms.length - 1])} 기준`,
        `<div class="tbl-wrap"><table><thead><tr><th class="l">품목</th><th>판정</th><th>단가 1년 전 대비</th><th>비교 기준</th></tr></thead><tbody>` +
        PA.map((d) => `<tr class="click" data-axis="${d.axis}" data-key="${d.key}" title="이상 점수 ${d.ifpa != null ? (d.ifpa > 0 ? "+" : "") + nf(d.ifpa, 2) + "σ" : "–"} (±0.5 안이면 정상)"><td class="l">${d.label}</td><td>${badge(d.band)}</td>` +
          `<td>${d.yoy_pct != null ? (d.yoy_pct > 0 ? "+" : "") + nf(d.yoy_pct, 1) + "%" : "–"}</td>` +
          `<td class="sub">${d.past_obs >= d.need_obs ? `지난 ${d.past_obs}년 같은 달` : `${d.past_obs}년치뿐 (${d.need_obs}년 필요)`}</td></tr>`).join("") + `</tbody></table></div>` +
        rule(`판정 = 이번 달 단가 오름폭이 지난 몇 년 같은 달의 보통 오름폭에서 얼마나 벗어났는지 · 비교 기준 = 그 비교에 쓴 과거 연수(3년 이상이어야 판정, LVL은 2022년 코드 신설로 3년치) · 행에 마우스를 올리면 이상 점수(σ) 표시 · FAO 식품가격 이상 지표(IFPA, SDG 2.c.1) 방법: 분기·연간 단가 상승률을 과거 같은 달의 평균·표준편차로 표준화, 분기 가중 0.4 · ±0.5σ 정상, 0.5~1σ 다소 높음, 1σ 이상 비정상 (하락은 대칭 적용) · 과거 같은 달 3년 이상 필요`), "",
        ready.length ? `판정 ${ready.length}개 품목 중 비정상 ${ready.filter((d) => /비정상/.test(d.band)).length}개 · 다소 높음·낮음 ${ready.filter((d) => /다소/.test(d.band)).length}개 · 정상 ${ready.filter((d) => d.band === "정상").length}개` : `판정 보류 <span class="sub">과거 데이터 수집 후 자동 판정</span>`) +
      card(`공급국 가격대 지도 ${q("price")}`, `${periodL12()}`,
        `<div class="inline-sel"><span class="ctl-label">품목</span><select id="pmapSel">${opts.map(([a, k, n]) => `<option value="${a}:${k}" ${`${a}:${k}` === S.pmap ? "selected" : ""}>${n}</option>`).join("")}</select></div>` +
        `<div id="pmap"></div>` + rule(`점 = 공급국 (최근 12개월 점유율 1% 이상) · 가로 = 점유율, 세로 = 단가 · 빨간 점선 = 수입 평균 · <b>주황 실선·띠 = 같은 품목 국산 판매가</b>(산림조합 A급 중앙값·규격별 범위, 면세 — 수입 CIF와 유통 단계가 달라 수준 참고용 · 제재목은 2026 단가표, 구조용 집성재·CLT는 2026 단가 공란이라 2024 중부목재유통센터 낙엽송 단가 · 그 밖의 품목은 국산 공표가 없어 기준선 없음) · ${PU_RULE}`), "", `<span id="pmap-lead"></span>`) +
      card(`수입 단가 지수 ${q("idx")}`, "12개월 평균 CIF 단가, 시작 = 100", `<div id="pidx"></div>` +
        `<div class="foot">현재 수입 단가: ${now.filter((x) => x.v != null).map((x) => `${x.n} ${x.f(x.v)} ${x.u}`).join(" · ")}</div>` + rule(PU_RULE), "",
        (() => { const y = pser.map((p) => { const i = ms.length - 1; const a = p.raw[i], b = p.raw[i - 12]; return { n: p.name, p: a && b ? (a / b - 1) * 100 : null }; }).filter((x) => x.p != null).sort((a, b) => b.p - a.p);
          return y.length ? `전년 대비 ${y.map((x) => `${x.n} ${x.p > 0 ? "+" : ""}${nf(x.p, 1)}%`).join(" · ")}` : ""; })());
    const DP = D.judg.domestic_price;
    if (DP && DP.pairs.length) {
      const cDom = C.color(1), cImp = C.color(0);
      const ratioOf = (pr) => (pr.imports.find((x) => x.ratio != null) || {}).ratio;
      const DPMAX = Math.max(...DP.pairs.filter((pr) => pr.domestic).map((pr) => pr.domestic.max));  // 모든 품목 같은 눈금 → 품목 간 막대 길이 비교 가능
      const pairHtml = (pr) => {
        const ok = pr.imports.filter((im) => !im.small && im.usd_m3), small = pr.imports.filter((im) => im.small);
        const mx = Math.max(DPMAX, ...ok.map((im) => im.usd_m3)) * 1.04, D0 = pr.domestic;
        const w = (v) => `${(v / mx) * 100}%`, r = ratioOf(pr);
        const bar = (lab, sub, v, col, val, extra = "") => `<div class="dp-r"><div class="dp-l"><b>${lab}</b>${sub ? `<span>${sub}</span>` : ""}</div>` +
          `<div class="dp-t"><i style="width:${w(v)};background:${col}"></i>${extra}</div><div class="dp-v">${val}</div></div>`;
        return `<div class="dp-pair"><div class="dp-h"><b>${pr.label}</b>${r ? `<span class="dp-x">국산이 수입의 <b>${nf(r, 1)}배</b></span>` : `<span class="dp-x sub">${D0 ? "비교할 수입 규모 없음" : "수입 단가만 · 국산 공표가 없음"}</span>`}</div>` +
          (!D0 ? `<div class="dp-r"><div class="dp-l"><b>국산</b><span>공표 판매가 없음</span></div><div class="dp-t dp-none">${pr.domestic_missing || "국산 공표 판매가 없음"}</div><div class="dp-v">–</div></div>` : bar("국산", pr.domestic.desc || `A급 ${pr.domestic.n}규격 중앙값`, pr.domestic.median, cDom, `<b>${nf(pr.domestic.median, 0)}<small> USD/㎥</small></b><span>${nf(pr.domestic.krw_m3_median / 1e4, 0)}만 원/㎥</span>`,
            pr.domestic.max > pr.domestic.min ? `<s style="left:${w(pr.domestic.min)};width:${(((pr.domestic.max - pr.domestic.min) / mx) * 100)}%" title="규격별 범위 ${nf(pr.domestic.min, 0)}~${nf(pr.domestic.max, 0)} USD/㎥"></s>` : "")) +
          ok.map((im) => bar("수입", im.label.replace(/^수입\s*/, ""), im.usd_m3, cImp,
            `<b>${nf(im.usd_m3, 0)}<small> USD/㎥</small></b><span>≈ ${nf((im.usd_m3 * DP.fx) / 1e4, 0)}만 원/㎥</span><span>${im.basis ? "산림청 발표 ㎥" : im.calibrated ? "산림청 환산 비율" : "밀도 잠정"}</span>`)).join("") +
          ok.filter((im) => im.supply).map((im) => { const [a, k] = im.supply.split(":"), tp = topSuppliers(a, k, 3);
            return tp.length ? `<div class="dp-n">수입 주요 공급국 (최근 12개월): ${tp.map((s) => `${cname(s.c)} ${nf(s.share, 0)}%`).join(" · ")} — 관세청 코드에 수종 구분이 없어 수입재 수종은 알 수 없음 · 국산은 낙엽송</div>` : ""; }).join("") +
          (small.length ? `<div class="dp-n">${small.map((im) => `${im.label}: 최근 12개월 ${usd(im.usd)} — 100만 달러 미만이라 비교 제외`).join(" · ")}</div>` : "") + `</div>`;
      };
      const lead = DP.pairs.filter((pr) => ratioOf(pr)).map((pr) => `${pr.label.replace(/\(.+\)/, "")} ${nf(ratioOf(pr), 1)}배${pr.domestic.desc ? `<span class="sub">(${pr.domestic.year} 단가)</span>` : ""}`).join(" · ");
      $("#a-price").insertAdjacentHTML("beforeend", card("국산·수입 가격 수준", `USD/㎥ · 국산 ${[...new Set(DP.pairs.filter((x) => x.domestic).map((x) => x.domestic.year))].sort().reverse().join("·")} 단가 · 수입 ${ym(DP.period.slice(0, 7))}~${ym(DP.period.slice(8))}`,
        `<div class="legend"><span><i style="background:${cDom}"></i>국산 (산림조합 판매가, 면세)</span><span><i style="background:${cImp}"></i>수입 (도착 가격 CIF)</span><span class="sub">회색 띠 = 국산 규격별 범위</span></div>` +
        DP.pairs.map(pairHtml).join("") +
        rule(`국산 = 산림조합중앙회 목재유통센터 판매단가(A급·면세) ÷ 규격 부피(T×W×L), 원/달러 ${nf(DP.fx, 0)} (${DP.fx_basis.replace(/^.*?\(/, "").replace(/\)$/, "")}) · 수입 = CIF 단가(원화는 같은 환율로 환산한 참고값) — 관세·통관·내륙운송·유통 마진 전이라 같은 단계 가격이 아님. 가격 수준 참고용이며 경쟁력 판정에 쓰지 않음 · ${DP.note.replace(/^.*?쓰지 않음\.\s*/, "")} · ${DP.species_note} · ${DP.survey_note || ""}`), "",
        lead ? `국산이 수입보다 비쌈: ${lead}` : ""));
    }
    const pi = pser.length ? pser[0].values.findIndex((v) => v != null) : 0;
    C.lineChart($("#pidx"), { x: ms.slice(pi), series: pser.map((p) => ({ name: p.name, values: p.values.slice(pi) })), yFmt: (v) => nf(v, 0), tipFmt: (v) => nf(v, 1), yMin0: false, height: 230, xLabelFmt: xFmt });
    $("#a-price").querySelectorAll("tr[data-axis]").forEach((tr) => tr.onclick = () => openDetail(tr.dataset.axis, tr.dataset.key));
    const drawMap = () => {
      const [a, k] = S.pmap.split(":"); const rows = (D.countries[a] || {})[k] || {};
      const tot = sum(Object.values(rows).map((r) => r.l12[0]));
      const cv = pconv(a, k), pf = pfmt(a, k), pl = plabel(a, k);
      const pts = Object.entries(rows).filter(([, r]) => r.l12[0] > 0 && r.l12[1] > 0 && tot && r.l12[0] / tot >= 0.01)
        .map(([c, r]) => ({ c, share: (r.l12[0] / tot) * 100, price: cv(r.l12[0], r.l12[1]), imp: r.l12[0] }));
      const avg = tot ? cv(tot, sum(Object.values(rows).map((r) => r.l12[1]))) : null;
      // 국산 기준선: 같은 품목의 국산 판매가(산림조합, USD/㎥) — ㎥ 단위일 때만 (톤 단위는 국산 밀도를 몰라 환산 불가)
      const DOMMAP = { "heading:4407": "낙엽송 제재목", "product:p01": "낙엽송 제재목", "product:p05": "구조용 집성재", "product:p16": "CLT(직교적층재)" };
      const dp = (D.judg.domestic_price || {}).pairs || [], dl = DOMMAP[S.pmap];
      const dom = dl && pl === "USD/㎥" ? dp.find((x) => x.label === dl) : null;
      const domNote = dl && !dom ? " · 국산 기준선은 ㎥ 환산 단위에서만 표시" : "";
      C.scatterChart($("#pmap"), { points: pts.map((p) => ({ x: p.share, y: p.price, label: cname(p.c), size: 4 + Math.sqrt(p.share) * 1.6, labelOn: p.share >= 8,
          color: C.color(0), d: p })), xMin: 0, xMax: Math.max(10, Math.ceil((Math.max(...pts.map((p) => p.share), 10) * 1.25) / 10) * 10), height: 270,
        xTitle: "점유율 (%)", yTitle: pl, xFmt: (v) => v + "%", yFmt: pf, refY: [...(avg ? [{ v: avg, label: `수입 평균 ${pf(avg)}`, below: true }] : []), ...(dom ? [{ v: dom.domestic.median, band: [dom.domestic.min, dom.domestic.max], color: C.color(1), solid: true, label: `국산 ${dom.label.replace(/\(.+\)/, "")}${dom.domestic.desc ? ` (${dom.domestic.year})` : ""} ${pf(dom.domestic.median)}` }] : [])],
        tip: (p) => `<div class="tt">${p.label}</div><div class="tr"><span>점유율</span><b>${nf(p.d.share, 1)}%</b></div><div class="tr"><span>단가</span><b>${pf(p.d.price)} ${pl}</b></div><div class="tr"><span>수입액</span><b>${usd(p.d.imp)}</b></div>` });
      const big = pts.filter((p) => p.share >= 5).sort((x, y) => x.price - y.price);
      $("#pmap-lead").innerHTML = (big.length >= 2 ? `점유율 5%↑ 중 최저 ${cname(big[0].c)} ${pf(big[0].price)} · 최고 ${cname(big[big.length - 1].c)} ${pf(big[big.length - 1].price)}` : "") +
        (dom ? ` · 국산 ${dom.label.replace(/\(.+\)/, "")}${dom.domestic.desc ? ` (${dom.domestic.year} 단가)` : ""} ${pf(dom.domestic.median)}` : "") + ` <span class="sub">${pl}${domNote}</span>`;
    };
    drawMap();
    $("#pmapSel").onchange = (ev) => { S.pmap = ev.target.value; drawMap(); };
  }

  // ── 변화 요인 ──────────────────────────────────────────
  function renderDrivers() {
    const DC = D.judg.decomposition, host = $("#a-drivers"); if (!host) return;
    if (!DC.available) { host.innerHTML = card("변화 요인", "", `<div class="empty">24개월 이상 자료 필요</div>`); return; }
    const t0 = DC.total, b = (v) => `${v > 0 ? "+" : ""}${nf(v / 1e8, 2)}억`;
    const steps = [{ l: "직전 12개월 수입액", v: t0.V0, tot: true }, { l: "들여온 양이 변한 몫", v: t0.volume }, { l: "값(단가)이 변한 몫", v: t0.price }];
    if (Math.abs(t0.entry_exit || 0) >= 1e6) steps.push({ l: "새로 들어오거나 끊긴 품목", v: t0.entry_exit });
    steps.push({ l: "최근 12개월 수입액", v: t0.V1, tot: true });
    host.innerHTML = card("수입액은 왜 바뀌었나", `${DC.period[1]} vs ${DC.period[0]} · 억 달러`, `<div id="dc-wf"></div>` +
      `<div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th class="l">품목군</th><th>수입액 변화</th><th>양이 변한 몫</th><th>값이 변한 몫</th></tr></thead><tbody>` +
      DC.groups.filter((g) => Math.abs(g.dV) >= 1e6).sort((a, c) => Math.abs(c.dV) - Math.abs(a.dV)).map((g) =>
        `<tr><td class="l">${g.label}</td><td>${b(g.dV)} (${g.pct > 0 ? "+" : ""}${nf(g.pct, 1)}%)</td><td>${b(g.volume)}</td><td>${b(g.price)}</td></tr>`).join("") + `</tbody></table></div>` +
      rule(`막대 세로축은 0에서 시작하지 않음(변화를 잘 보이게) · 양이 변한 몫 = 수입량(톤) 변화가 수입액에 준 영향 · 값이 변한 몫 = 톤당 금액 변화가 준 영향 · 계산: 로그평균 디비지아 지수분해(LMDI, Ang 2005), HS 6단위 품목별로 나눈 뒤 합산 · 원인(수요·환율 등)은 판단하지 않음`), "span-2",
      `${b(t0.dV)} (${t0.pct > 0 ? "+" : ""}${nf(t0.pct, 1)}%) = 양 ${b(t0.volume)} + 값 ${b(t0.price)}`);
    waterfall($("#dc-wf"), steps);
  }
  // 폭포형 막대: 시작 합계 → 증감 → 끝 합계
  function waterfall(host, steps) {
    const W = Math.max(host.clientWidth, 320), H = 230, pl = 8, pr = 8, pt = 22, pb = 40;
    let run = 0; const bars = steps.map((s) => { let a, c; if (s.tot) { a = 0; c = s.v; run = s.v; } else { a = run; c = run + s.v; run = c; } return { ...s, lo: Math.min(a, c), hi: Math.max(a, c) }; });
    const lo = Math.min(...bars.map((x) => x.lo)), hi = Math.max(...bars.map((x) => x.hi));
    const base = Math.max(0, lo - (hi - lo) * 0.6), Y = (v) => pt + (H - pt - pb) * (1 - (v - base) / (hi - base || 1));
    const bw = (W - pl - pr) / bars.length;
    const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="수입액 변화 폭포 그래프">`;
    bars.forEach((x, i) => {
      const xx = pl + i * bw + bw * 0.18, w = bw * 0.64, col = x.tot ? css("--s1") : x.v < 0 ? C.color(7) : C.color(2);
      svg += `<rect x="${xx}" y="${Y(x.hi)}" width="${w}" height="${Math.max(1.5, Y(x.lo) - Y(x.hi))}" rx="3" fill="${col}" opacity="${x.tot ? 0.85 : 0.9}"/>`;
      svg += `<text x="${xx + w / 2}" y="${Y(x.hi) - 6}" text-anchor="middle" style="font-size:12px;font-weight:700;fill:${css("--ink")}">${x.tot ? nf(x.v / 1e8, 1) : (x.v > 0 ? "+" : "") + nf(x.v / 1e8, 2)}</text>`;
      svg += `<foreignObject x="${pl + i * bw}" y="${H - pb + 6}" width="${bw}" height="${pb}"><div xmlns="http://www.w3.org/1999/xhtml" style="font-size:11.5px;color:${css("--ink-2")};text-align:center;line-height:1.3;letter-spacing:-0.03em">${x.l}</div></foreignObject>`;
      if (i < bars.length - 1) { const yv = Y(x.tot ? x.v : (x.v < 0 ? x.lo : x.hi)); svg += `<line x1="${xx + w}" x2="${pl + (i + 1) * bw + bw * 0.18}" y1="${yv}" y2="${yv}" stroke="${css("--axis")}" stroke-dasharray="3 3"/>`; }
    });
    host.innerHTML = svg + `</svg>`;
  }

  function renderBasic() {
    const host = $("#a-basic"); if (!host) return;
    const per = periodL12(), tot = entry("total", "all"), L = l12(tot), Lk = l12(tot, "imp_kg"), Lexp = l12(tot, "exp_usd").cur;
    const ms = months(), I = D.judg.industry, G = D.judg.glance;
    const r12 = (f) => ms.map((_, i) => (i < 11 ? null : sum(tot[f].slice(i - 11, i + 1))));
    const ru = r12("imp_usd"), re = r12("exp_usd");
    const pk = ru.map((v) => v != null).indexOf(true);
    // 목재 이용량 (실태조사): 국산 = 전체 − 수입 원목 − 수입 제품
    const U = I && I.use_years && I.use_years.length ? I.use_years.map((y, k) => {
      const li = (I.log_years || []).indexOf(y), lim = li >= 0 ? I.log_imported[li] : 0, ip = I.use_imp_products[k] || 0, tt = I.use_total[k];
      return { y, tt, dom: tt - lim - ip, lim, ip, share: ((lim + ip) / tt) * 100 }; }) : [];
    const u1 = U[U.length - 1], u0 = U[0];
    // 목재제품별 수입액 (최근 12개월)
    const pr = D.meta.products.filter((p) => p.status !== "pending").map((p) => { const e = entry("product", p.key); const a = e ? l12(e) : {};
      return { k: p.key, n: p.name.replace(/\(.+\)/, ""), v: a.cur || 0, pv: a.prev || 0 }; }).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    const ptot = sum(pr.map((x) => x.v));
    // 제품별 자급률 (국산재 기준, 연도 선택) — KOSIS 실태조사 제품별 원자재 이용량
    const SF = D.judg.self_suff;
    if (SF && (!S.ssy || !SF.rows[S.ssy])) S.ssy = String(SF.years[SF.years.length - 1]);
    host.innerHTML =
      (U.length ? card("한 해 쓰는 목재", `${u0.y}~${u1.y} · 만 ㎥`, `<div id="bs-use"></div>` +
        rule(`국산 = 전체 이용량 − 수입 원목 − 수입 목재제품 · 수입 비중 = 수입 ÷ 전체, 100에서 뺀 값이 산림청 공표 목재자급률 · 펠릿 수입은 톤×1.67, 그 밖의 톤 단위 제품은 1:1 (실태조사 방식) · 2023년 조사부터 국산 이용량 산정 기준이 벌채 허가량 → 실제 이용량으로 바뀌어 2022년 이전과 단순 비교 주의 · 출처: 산림청·한국임업진흥원 목재이용실태조사 국내 목재 이용 현황 (연도별 보고서, 2023년은 2024년 기준 보고서 수정치)`), "",
        `${u1.y}년 ${nf(u1.tt / 1e4, 0)}만 ㎥ · 그중 수입 ${nf(u1.share, 1)}% <span class="sub">목재자급률 ${nf(100 - u1.share, 1)}% · ${u0.y}년 ${nf(u0.tt / 1e4, 0)}만 ㎥, 수입 ${nf(u0.share, 1)}%</span>`) : "") +
      (SF ? card("제품별 자급률 (국산재 기준)", `<span class="yr-seg" id="ss-yr">${SF.years.map((y) => `<button type="button" data-y="${y}"${String(y) === S.ssy ? ' class="on"' : ""}>${y}</button>`).join("")}</span> · ㎥`,
        `<div class="ssl" id="bs-ss"></div>` +
        rule(`국산 원료(국산 원목·국산 제재목 등 + 폐목재·부산물 등 국내 발생 원료)로 만든 양 ÷ (국내 생산 원료 + 수입 제품) · 수입 원료로 만든 양은 수입으로 셈 · 출처: 산림청 목재이용실태조사(KOSIS 제품별 원자재 이용량)`)) : "") +
      card("목재류 수입·수출 추이", "12개월 누적 · 억 달러", `<div id="bs-trade"></div>` +
        rule(`HS 44류 전체 · 수입 CIF, 수출 FOB · 출처: ${SRC}`), "",
        `최근 12개월 수입 ${nf(L.cur / 1e8, 1)}억 달러 · ${nf(Lk.cur / 1e9, 1)}백만 톤 <span class="sub">수출 ${nf(Lexp / 1e8, 1)}억 달러</span>`) +
      card("품목별 수입액", `<span class="yr-seg" id="pr-per"><button type="button" data-p="l12"${(S.prp || "l12") === "l12" ? ' class="on"' : ""}>최근 1년</button></span> <select id="pr-yr" class="mini-sel"><option value="">연도 선택</option>${[...new Set(months().map((m) => m.slice(0, 4)))].filter((y) => months().filter((m) => m.startsWith(y)).length === 12).reverse().map((y) => `<option value="${y}"${S.prp === y ? " selected" : ""}>${y}년</option>`).join("")}</select>`, `<div id="bs-prod-lead" class="lead"></div><div id="bs-prod"></div>` +
        rule(`목재이용법 15종 + CLT + LVL 기준 HS 코드 합계 + 원목(HS 4403) · 점선 아래 = 상위 10위 밖이지만 함께 보는 품목(구조용 집성재·CLT), 점선을 누르면 사이 순위도 펼침 · 괄호 = 바로 앞 같은 기간 대비 · 펄프 제외 · 출처: ${SRC}`), "");
    if (U.length) {
      C.barChart($("#bs-use"), { x: U.map((d) => String(d.y)), series: [{ name: "국산", values: U.map((d) => d.dom / 1e4), color: C.color(2) }, { name: "수입 원목", values: U.map((d) => d.lim / 1e4), color: C.color(1) },
        { name: "수입 목재제품", values: U.map((d) => d.ip / 1e4), color: C.color(0) }], stacked: true, yFmt: (v) => nf(v, 0), tipFmt: (v) => nf(v, 0) + "만 ㎥", height: 250 });
      // 막대 위 수입 비중 표시
      $("#bs-use").insertAdjacentHTML("beforeend", `<div class="foot" style="display:flex;justify-content:space-around;margin-top:2px">${U.map((d) => `<span>${d.y} 수입 <b>${nf(d.share, 1)}%</b></span>`).join("")}</div>`);
    }
    const drawSS = () => {
      const el = $("#bs-ss"); if (!el || !SF) return;
      const SS = SF.rows[S.ssy] || [];
      const f = (v) => nf(v / 1e4, v >= 1e5 ? 0 : 1);
      el.innerHTML = SS.map((d, k) => `<div class="ss-r" data-k="${k}" title="${d.label} ${S.ssy}년: 국산 원료 ${f(d.dom)}만 ㎥ · 수입 원료 ${f(d.imp_raw)}만 · 수입 제품 ${f(d.imp_prod)}만${d.unknown ? ` · 출처 미상 ${f(d.unknown)}만` : ""} ㎥">` +
        `<span class="ss-l">${d.label}</span><span class="ss-t"><i style="width:${Math.max(0, Math.min(100, d.ss))}%"></i></span><span class="ss-v">${nf(d.ss, d.ss > 0 && d.ss < 1 ? 1 : 0)}% <span class="sub">(${f(d.dom)}만 / ${f(d.total)}만 ㎥)</span></span></div>`).join("");
      el.querySelectorAll(".ss-r").forEach((r) => r.onclick = () => { const d = SS[+r.dataset.k]; openDetail(d.axis, d.key); });
    };
    drawSS();
    $("#ss-yr") && $("#ss-yr").querySelectorAll("button").forEach((b) => b.onclick = () => { S.ssy = b.dataset.y; $("#ss-yr").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); drawSS(); });
    C.lineChart($("#bs-trade"), { x: ms.slice(pk), series: [{ name: "수입액", values: ru.slice(pk).map((v) => v / 1e8) }, { name: "수출액", values: re.slice(pk).map((v) => v / 1e8) }],
      yFmt: (v) => nf(v, 0), tipFmt: (v) => nf(v, 2) + "억 달러", diffFmt: (v) => (v > 0 ? "+" : "") + nf(v, 2) + "억 달러", height: 250, xLabelFmt: xFmt, pin: true });
    // 품목별 수입액 — 기간: 최근 1년(기본) 또는 연도. 상위 10개 + 원목·구조용 집성재·CLT(순위 밖이어도), 점선을 누르면 사이 순위 펼침
    const drawProd = () => {
      const ms = months(), P = S.prp || "l12";
      const sumIdx = (arr, idx) => idx.reduce((s, i) => s + (arr[i] || 0), 0);
      let cur, prev, perLab;
      if (P === "l12") { const n = ms.length; cur = [...Array(12).keys()].map((k) => n - 12 + k); prev = cur.map((i) => i - 12); perLab = periodL12(); }
      else { cur = ms.map((m, i) => (m.startsWith(P) ? i : -1)).filter((i) => i >= 0); prev = ms.map((m, i) => (m.startsWith(String(+P - 1)) ? i : -1)).filter((i) => i >= 0); perLab = `${P}년 (전년 ${+P - 1}년 대비)`; }
      const val = (e) => ({ v: sumIdx(e.imp_usd, cur), pv: prev.length === cur.length ? sumIdx(e.imp_usd, prev) : 0 });
      const prs = D.meta.products.filter((p) => p.status !== "pending").map((p) => { const e = entry("product", p.key); return e ? { k: p.key, n: p.name.replace(/\(.+\)/, ""), ...val(e) } : null; }).filter((x) => x && x.v > 0);
      const ew = entry("heading", "4403");
      const all = [...prs, ...(ew ? [{ k: "4403", ax: "heading", n: "원목", raw: true, ...val(ew) }] : [])].filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
      const MUST = ["4403", "p05", "p16"], top = all.slice(0, 10), extra = all.filter((x) => MUST.includes(x.k) && !top.includes(x));
      const lastRk = extra.length ? Math.max(...extra.map((x) => all.indexOf(x))) : 9;
      const mid = all.slice(10, lastRk + 1).filter((x) => !extra.includes(x));   // 점선 사이 순위 (평소 접힘)
      const nmB = (x) => ({ p05: "구조용 집성재", p16: "CLT", p09: "OSB", p17: "LVL", p04: "목재플라스틱(WPC)" }[x.k] || x.n) + (x.raw ? " (원자재)" : "");
      const row = (x) => ({ rk: all.indexOf(x) + 1, label: nmB(x), value: x.v,
        text: `${nf(x.v / 1e8, 2)}억 달러 <span class="sub">(${x.pv ? ((g) => (g >= 0 ? "+" : "") + nf(g, Math.abs(g) < 10 ? 1 : 0) + "%")((x.v / x.pv - 1) * 100) : "–"})</span>`, onClick: () => openDetail(x.ax || "product", x.k) });
      const after = S.prx ? all.slice(10, lastRk + 1) : extra;
      const rows = [...top.map(row), ...after.map(row)];
      if (after.length) rows[top.length] = { ...rows[top.length], sep: true, sepLabel: mid.length ? (S.prx ? `▾ 접기` : `▸ ${mid.map((x) => all.indexOf(x) + 1).join("·")}위 펼치기`) : "", sepClick: mid.length ? () => { S.prx = !S.prx; drawProd(); } : null };
      C.hbars($("#bs-prod"), rows, { max: all[0] ? all[0].v : 1 });
      const pt = sum(prs.map((x) => x.v)), p0 = [...prs].sort((a, b) => b.v - a.v);
      $("#bs-prod-lead").innerHTML = p0.length ? `1위 ${p0[0].n} ${nf((p0[0].v / pt) * 100, 0)}% <span class="sub">상위 3개 ${nf((sum(p0.slice(0, 3).map((x) => x.v)) / pt) * 100, 0)}% · ${perLab}</span>` : "";
    };
    drawProd();
    $("#pr-per").querySelector("button").onclick = () => { S.prp = "l12"; $("#pr-yr").value = ""; $("#pr-per button").classList.add("on"); drawProd(); };
    $("#pr-yr").onchange = (ev) => { if (!ev.target.value) return; S.prp = ev.target.value; $("#pr-per button").classList.remove("on"); drawProd(); };
  }
  function renderAlerts() {
    const al = D.insights.alerts;
    $("#alerts-body").innerHTML = `<div class="note" style="margin-bottom:6px">점유율 전월 대비 ±5%p, 단가 전년 동월 대비 ±20%, 신규 공급국 1%↑ (월 수입액 100만 달러↑ 분류만). 레퍼런스가 있는 기준이 아니라 참고용으로만 표시함.</div>` +
      (al.length ? `<ul class="alerts" style="max-height:none">${al.map((a) => `<li><span class="tag">${{ share: "점유율", price: "단가", new: "신규국" }[a.type]}</span><span>${a.text}</span></li>`).join("")}</ul>` : `<div class="empty">해당 없음</div>`);
  }

  function renderIntro() {
    const ds = D.judg && D.judg.domestic_supply, el = $("#intro-lead");
    if (!el || !ds || !ds.overall || !ds.overall.length) return;
    const o = ds.overall[ds.overall.length - 1];
    el.innerHTML = `<span class="one-line">국내 목재 이용량의 <b>${nf(o.import_share, 0)}%</b>는 수입재입니다 <span class="sub">(${o.year}년, 목재제품·원목 기준, 산림청 목재이용실태조사)</span></span>` +
      `<span class="one-line">본 페이지는 목재 수입의 <b>특정국 의존도</b>와 <b>국내 대체 생산 여력</b>을 공인 기준에 따라 매월 진단합니다</span>`;
  }

  // ── 한눈에 보기 (시안: ?v=2) ───────────────────────────────
  const V2 = new URLSearchParams(location.search).get("v") !== "1";   // 한눈에 보기 + 자세히 보기 구조가 기본 (?v=1 = 예전 화면)
  // 한눈에 보기 — 목재산업 실태 한 줄 (목재이용실태조사 시계열, 각 항목에 추세선)
  function indStrip() {
    const I = (D.judg || {}).industry;
    if (!I || I.years.length < 2) return "";
    const n = I.years.length - 1, y0 = I.years[0], y1 = I.years[n];
    const sp = (vals) => `<span class="gi-sp">${C.sparkline(vals, 90, 26)}</span>`;
    const chg = (a, b) => `${b >= a ? "+" : ""}${nf((b / a - 1) * 100, 0)}%`;
    const it = (lab, val, from, sub, vals, href) => `<a class="gi" href="${href}"><span class="gi-l">${lab}</span><span class="gi-v">${val}</span>${sp(vals)}<span class="gi-s">${from}<br>${sub}</span></a>`;
    let logs = "";
    if (I.log_years && I.log_years.length >= 2) {
      const m = I.log_years.length - 1;
      logs = it("국산 원목 이용량", `${nf(I.log_domestic[m] / 1e4, 0)}만 ㎥`, `${I.log_years[0]}년 ${nf(I.log_domestic[0] / 1e4, 0)}만 ㎥ · ${chg(I.log_domestic[0], I.log_domestic[m])}`,
        `수입 원목 ${nf(I.log_imported[m] / 1e4, 0)}만 ㎥ (${I.log_years[0]}년 ${nf(I.log_imported[0] / 1e4, 0)}만)`, I.log_domestic, "#sec-basic");
    }
    return `<div class="g-ind"><div class="gi-h"><b>목재산업 규모 및 실태</b><span>연도별 추이 · 산림청 목재이용실태조사 공표값</span></div><div class="gi-row">` +
      it("매출", `${nf(I.sales[n] / 1e4, 1)}조 원`, `${y0}년 ${nf(I.sales[0] / 1e4, 1)}조 · ${chg(I.sales[0], I.sales[n])}`, "국내 생산 + 수입·유통업체", I.sales, "#sec-dist") +
      it("국내 생산업체 매출", `${nf(I.domestic[n] / 1e4, 1)}조 원`, `${y0}년 ${nf(I.domestic[0] / 1e4, 1)}조 · ${chg(I.domestic[0], I.domestic[n])}`, `수입·유통업체 ${nf(I.imports[n] / 1e4, 1)}조 원`, I.domestic, "#sec-dist") +
      it("종사자", `${nf(I.employees[n], 0)}명`, `${y0}년 ${nf(I.employees[0], 0)}명 · ${chg(I.employees[0], I.employees[n])}`, "국내 생산 + 수입·유통업체", I.employees, "#sec-dist") +
      logs + `</div><div class="gi-f">매출·종사자 ${y0}~${y1}, 원목 ${(I.log_years || [y0])[0]}~${y1} · 조사 범위·가중치가 해마다 조정돼 연도 간 비교는 참고 (2023년은 2024년 기준 보고서 수정치) · 누르면 자세히 보기로 이동</div></div>`;
  }
  function renderGlance() {
    const host = $("#glance");
    if (!host || !V2) return;
    const J = D.judg || {}, G = J.glance, IND = J.industry, DS = J.domestic_supply, DC = J.decomposition, PA = J.price_anomaly || [];
    if (!G) { host.innerHTML = ""; return; }
    const man = (v) => `${nf(v / 1e4, 0)}만 ㎥`;
    const tot = entry("total", "all"), L = l12(tot), per = periodL12(), m0 = ym(months()[months().length - 1]);
    const yoy = L.prev ? ((L.cur / L.prev) - 1) * 100 : null;
    const sv = (k) => (G.sources.find((s) => s.key === k) || {}).total || 0;
    const impLog = sv("use_log_imported"), impProd = sv("use_imported_products");
    const big = [...G.groups].sort((a, b) => b.total - a.total);
    const pct = (v) => Math.round((v / G.total) * 100);
    // 1) 핵심 숫자
    const tile = (lab, val, sub, src, go) => `<a class="g-tile go" href="#${go}" data-go="${go}"><div class="g-lab">${lab}<span class="g-go">자세히 →</span></div><div class="g-val num">${val}</div><div class="g-sub">${sub}</div><div class="g-src">${src}</div></a>`;
    const indY = IND ? IND.year : null, indI = IND ? IND.years.indexOf(indY) : -1;
    const tiles = tile("한 해 쓰는 목재", `${nf(G.total / 1e4, 0)}<small>만 ㎥</small>`, `국산 ${nf((G.total - impLog - impProd) / 1e4, 0)}만 + 수입 ${nf((impLog + impProd) / 1e4, 0)}만 ㎥`, `${G.year}년 · 산림청 목재이용실태조사`, "bs-use") +
      tile("그중 수입", `${nf(G.import_share, 1)}<small>%</small>`, `${nf(G.total / 1e4, 0)}만 ㎥ 중 <b>${nf((impLog + impProd) / 1e4, 0)}만 ㎥</b> (원목 ${nf(impLog / 1e4, 0)}만 + 제품 ${nf(impProd / 1e4, 0)}만)`, `${G.year}년 · 산림청 목재이용실태조사`, "bs-use") +
      tile("목재류 수입액", `${nf(L.cur / 1e8, 1)}<small>억 달러</small>`, yoy == null ? "최근 12개월" : `최근 12개월 · 1년 전보다 <b class="${yoy < 0 ? "dn" : "up"}">${yoy > 0 ? "+" : ""}${nf(yoy, 1)}%</b>`, `${per} · 관세청`, "bs-trade") +
      (() => {   // 가장 많이 사오는 목재제품 (수입액, 최근 12개월)
        const pr = D.meta.products.filter((p) => p.status !== "pending").map((p) => { const e = entry("product", p.key); return { n: p.name.replace(/\(.+\)/, ""), v: e ? l12(e).cur || 0 : 0 }; })
          .sort((a, b) => b.v - a.v);
        if (!pr.length || !pr[0].v) return "";
        return tile("가장 많이 사오는 제품", `${pr[0].n} <small>${nf(pr[0].v / 1e8, 1)}억 달러</small>`, `2위 ${pr[1].n} ${nf(pr[1].v / 1e8, 1)}억 · 3위 ${pr[2].n} ${nf(pr[2].v / 1e8, 1)}억 달러`, `${per} · 관세청 · 목재제품 17종 기준`, "bs-prod");
      })();
    // 2) 지금 주의할 점 (4개)
    const sig = (lv, ic, title, body, href) => `<a class="g-sig ${lv}" href="${href}"><span class="g-ic" aria-hidden="true">${ic}</span><span><b>${title}</b><span class="g-sb">${body}</span></span></a>`;
    const unitQ = (r) => (/^p1[1-5]$/.test(r.key) ? "톤" : "㎥");
    const depHi = DS ? DS.rows.filter((r) => r.axis === "product" && r.import_share != null && r.import_share >= 50 && r.imports).sort((a, b) => b.imports - a.imports).slice(0, 3) : [];
    const SR = (J.supply_risk || []).filter((d) => d.grade === "취약").sort((a, b) => b.imp_usd - a.imp_usd);
    const abn = PA.filter((x) => /비정상/.test(x.band || ""));
    const ut = DS ? DS.rows.filter((r) => r.axis === "product" && r.utilization != null).sort((a, b) => b.utilization - a.utilization).slice(0, 3) : [];
    const sh = (l) => l.replace(/\(.+\)/, "");
    const sigs =
      sig(depHi.length ? "hi" : "lo", depHi.length ? "!" : "✓", "많이 들여오고 수입에 기대는 품목",
        depHi.length ? depHi.map((r) => `${sh(r.label)} ${nf(r.import_share, 0)}% (${nf(r.imports / 1e4, 0)}만 ${unitQ(r)})`).join(" · ") + ` <span class="sub">수입의존도 · ${depHi[0].year}년</span>` : "수입의존도 절반 넘는 품목 없음", "#sec-risk") +
      sig(SR.length ? "hi" : "lo", SR.length ? "!" : "✓", SR.length ? `한 나라에 쏠린 품목 ${SR.length}개` : "한 나라에 쏠린 품목 없음",
        SR.length ? SR.slice(0, 3).map((d) => `${sh(d.label)}(${d.top_name} ${nf(d.top_share, 0)}%)`).join(" · ") + (SR.length > 3 ? ` 외 ${SR.length - 3}개` : "") + ` <span class="sub">특정국 50%↑ · 산업부 기준</span>` : "특정국 50% 넘는 품목 없음", "#sec-risk") +
      sig(abn.length ? "mid" : "lo", abn.length ? "↕" : "✓", abn.length ? `가격이 평소와 크게 다른 품목 ${abn.length}개` : "수입 가격 평소 범위",
        abn.length ? abn.map((x) => `${sh(x.label)} ${x.band.replace("비정상 ", "")}`).join(" · ") + ` <span class="sub">과거 같은 달 대비 · FAO 방법</span>` : "주요 품목 모두 과거 같은 달 대비 정상·다소 높음", "#sec-price") +
      sig(ut.length && ut[0].utilization >= 80 ? "mid" : "lo", ut.length && ut[0].utilization >= 80 ? "▲" : "✓", "국내 공장 가동률이 높은 품목",
        ut.length ? ut.map((r) => `${sh(r.label)} ${nf(r.utilization, 0)}%`).join(" · ") + ` <span class="sub">가동률 · ${ut[0].year}년 · 여유가 적으면 수입을 대신하기 어려움</span>` : "가동률 자료 없음", "#sec-domestic");
    const lead = `우리가 쓰는 목재 <b>100㎥ 중 ${nf(G.import_share, 1)}㎥는 수입</b>이고, ${big.slice(0, 3).map((g) => `${g.label.replace(/\(.+\)/, "")} ${pct(g.total)}%`).join(" · ")} 순으로 쓰입니다`;
    host.innerHTML = `<div class="g-head"><h2 class="one-line">대한민국 목재산업·유통을 한눈에</h2><span class="hint">기준월 ${m0} · 목재이용실태조사 ${G.year}년</span></div>
      <p class="g-lead one-line">${lead}</p>
      ${indStrip()}
      <div class="g-tiles">${tiles}</div>
      <div class="g-main">
        <div class="card g-flow"><div class="card-head"><h3 class="one-line">목재는 어디서 와서 무엇이 되나</h3><span class="hint">${G.year}년 · 띠 굵기 = 물량(㎥)</span></div>
          <div id="g-sankey"></div>
          <div class="foot">왼쪽 = 원자재 출처, 오른쪽 = 만들어지거나 쓰이는 제품. 띠에 마우스를 올리면 물량 표시 · ${G.note} · 출처: ${G.source}</div></div>
        <div class="card g-cty"><div class="card-head"><h3 class="one-line">어디서 사오나</h3><span class="hint">수입액 · 최근 12개월</span></div>
          <div class="g-chips" id="g-chips">${GCTY.map((g, i) => `<button type="button" data-i="${i}"${i === (S.gc || 0) ? ' aria-pressed="true"' : ""}>${g[2]}</button>`).join("")}</div>
          <div id="g-cty-lead"></div><div id="g-cty"></div><div class="foot">${per} · 출처: 관세청 수출입실적 · 품목 버튼이나 흐름도 오른쪽 제품 이름을 누르면 바뀜 · 국가를 누르면 상세</div></div>
      </div>
      <div class="g-sigs-h"><b>지금 주의할 점</b><span>누르면 자세히 보기의 해당 부분으로 이동</span></div>
      <div class="g-sigs">${sigs}</div>
      <div class="feedback">추가·수정·삭제 의견은 언제든 메일(<a href="mailto:jty2533@naver.com">jty2533@naver.com</a>)로 주세요. 필요에 따라 의견 주신 분의 소속·성함을 함께 넣어드릴 수 있습니다.</div>
      <div class="g-more">아래 '자세히 보기'는 목재 유통 — 수급·공급망 진단: 기본 현황 · 수입 위험 · 국내 공급 여력 · 국내 유통 라인 · 가격</div>`;
    const col = { use_log_domestic: C.color(2), use_other_raw: C.color(3), use_log_imported: C.color(1), use_imported_products: C.color(0) };
    const srcSub = (g) => { const im = g.flows.use_log_imported + g.flows.use_imported_products; return `수입 ${Math.round((im / g.total) * 100)}%`; };
    C.sankey($("#g-sankey"), {
      sources: G.sources.map((s) => ({ key: s.key, label: s.label, value: s.total, color: col[s.key] })),
      targets: G.groups.map((g) => ({ key: g.key, label: g.label, value: g.total, sub: srcSub(g) })),
      links: G.groups.flatMap((g) => Object.entries(g.flows).map(([s, v]) => ({ s, t: g.key, value: v }))),
      fmt: man, aria: "목재 원자재 출처에서 제품으로 가는 흐름",
      tip: (l, s, t) => `<div class="tt">${s.label} → ${t.label}</div>${man(l.value)} <span class="sub">(${t.label.replace(/\(.+\)/, "")}의 ${Math.round((l.value / t.value) * 100)}%)</span>`,
    });
    drawGCty();
    $("#g-chips").querySelectorAll("button").forEach((b) => b.onclick = () => { S.gc = +b.dataset.i; drawGCty(); });
    // 흐름도 오른쪽 제품 → 해당 품목 수입국으로 전환
    const G2C = { sawn: 2, panel: 3, pellet: 6, chip: 7 };
    $("#g-sankey").querySelectorAll("[data-tkey]").forEach((n) => { if (G2C[n.dataset.tkey] != null) { n.style.cursor = "pointer"; n.onclick = () => { S.gc = G2C[n.dataset.tkey]; drawGCty(); }; } });
  }
  // 어디서 사오나: 품목별 (축, 키, 이름)
  const GCTY = [["total", "all", "목재류 전체"], ["heading", "4403", "원목"], ["product", "p01", "제재목"], ["product", "p06", "합판"],
    ["product", "p07", "파티클보드"], ["product", "p08", "섬유판"], ["product", "p11", "목재펠릿"], ["product", "p12", "목재칩"]];
  function drawGCty() {
    const g = GCTY[S.gc || 0], tops = topSuppliers(g[0], g[1], 10), t3 = sum(tops.slice(0, 3).map((x) => x.share));
    const all = l12(entry(g[0], g[1]) || entry("total", "all")).cur;
    $("#g-chips").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.i === (S.gc || 0))));
    $("#g-cty-lead").innerHTML = `<div class="lead">${g[2]} ${nf(all / 1e8, 1)}억 달러 · 상위 3개국 ${nf(t3, 0)}% <span class="sub">${tops.slice(0, 3).map((x) => cname(x.c)).join(" · ")}</span></div>`;
    C.hbars($("#g-cty"), tops.map((x) => ({ label: cname(x.c), value: x.imp, text: `${nf(x.share, 0)}% · ${x.imp >= 1e7 ? nf(x.imp / 1e8, 2) + "억" : nf(x.imp / 1e6, 1) + "백만"} 달러`,
      onClick: () => { if (g[0] === "total") { S.country = x.c; go("country"); } else openDetail(g[0], g[1]); } })));
  }
  function renderAll() { renderGlance(); renderIntro(); renderVerdicts(); renderBasic(); renderRisk(); renderDomestic(); renderDist(); renderPrice(); }

  function renderControls() {
    const years = [...new Set(months().map((m) => m.slice(0, 4)))];
    const seg = (name, opts, cur) => `<div class="seg" role="group">${opts.map(([v, l]) =>
      `<button data-${name}="${v}" aria-pressed="${v === cur}">${l}</button>`).join("")}</div>`;
    $("#controls").innerHTML =
      seg("measure", [["imp_usd", "금액"], ["imp_kg", "물량"], ["price", "단가"]], S.measure) +
      seg("agg", [["month", "월별"], ["r12", "12개월 누적"], ["year", "연간"]], S.agg) +
      `<span class="ctl-label">시작</span><select id="startSel">${years.map((y) => `<option ${y === S.start ? "selected" : ""}>${y}</option>`).join("")}</select>`;
    $("#controls").querySelectorAll("[data-measure]").forEach((b) => b.onclick = () => { S.measure = b.dataset.measure; renderControls(); renderTab(); });
    $("#controls").querySelectorAll("[data-agg]").forEach((b) => b.onclick = () => { S.agg = b.dataset.agg; renderControls(); renderTab(); });
    $("#startSel").onchange = (ev) => { S.start = ev.target.value; renderTab(); };
  }

  // ── 상세 (품목군·제품·수종 공통) ────────────────────────
  function renderDetail(host, axis, key, extraNote) {
    const e = entry(axis, key);
    const since = sinceOf(axis, key);
    const prod = axis === "product" ? D.meta.products.find((p) => p.key === key) : null;
    const grp = axis === "group" ? D.meta.groups.find((g) => g.key === key) : null;
    if (!e) {
      host.innerHTML = card(labelOf(axis, key), "", `<div class="note box">${prod && prod.note ? prod.note : "해당 기간 교역 실적 없음"}</div>`);
      return;
    }
    const i = iLast(), L = l12(e), Lk = l12(e, "imp_kg");
    const tops = topSuppliers(axis, key, 10);
    const cv = pconv(axis, key), pl = plabel(axis, key), pf = pfmt(axis, key);
    const p0 = L.cur && Lk.cur ? cv(L.cur, Lk.cur) : null, pp = L.prev && Lk.prev ? cv(L.prev, Lk.prev) : null;
    const note = [grp && grp.desc, prod && prod.note, since && `${ym(since)} 이전에는 별도 HS 코드가 없어 값을 표시하지 않음`, extraNote].filter(Boolean);
    host.innerHTML =
      `<div class="detail-head"><h2 class="one-line">${labelOf(axis, key)}</h2>${prod ? `<span class="badge">목재제품 ${prod.num}</span>` : ""}</div>` +
      (note.length ? `<div class="note box">${note.join(" · ")}</div>` : "") +
      `<div class="grid g-5">` +
      kpi(`${ym(months()[i])} 수입액`, usd(e.imp_usd[i]), `전년 동월 ${delta(e.imp_usd[i], i >= 12 ? e.imp_usd[i - 12] : null)}`) +
      kpi("최근 12개월 수입액", usd(L.cur), `직전 대비 ${delta(L.cur, L.prev)}`) +
      kpi("최근 12개월 수입량", ton(Lk.cur), `직전 대비 ${delta(Lk.cur, Lk.prev)}`) +
      kpi(`평균 수입 단가${pest(axis, key)}`, p0 ? `${pf(p0)} <small>${pl}</small>` : "–", `${delta(p0, pp)} <span class="sub">${ptwin(axis, key, L.cur || 0, Lk.cur || 0) || "직전 12개월 대비"}</span>`) +
      kpi("최대 공급국", tops[0] ? `${cname(tops[0].c)} <small>${nf(tops[0].share, 1)}%</small>` : "–", e.hhi[i] != null ? `HHI ${nf(e.hhi[i], 0)}` : "") +
      `</div><div class="grid g-2" style="margin-top:12px">` +
      card(`수입·수출 추이`, trendTitle([axis, key]), `<div id="d-trend"></div>`, "span-2",
        L.prev ? `최근 12개월 수입 ${usd(L.cur)} <span class="sub">직전 12개월 대비 ${delta(L.cur, L.prev)}</span>` : `최근 12개월 수입 ${usd(L.cur)}`) +
      card(`주요 공급국 ${q("share")}`, "최근 12개월 · 점유율 · 전년 대비", `<div id="d-sup"></div>`, "",
        tops[0] ? `1위 ${cname(tops[0].c)} ${nf(tops[0].share, 1)}% <span class="sub">상위 3개국 ${nf(sum(tops.slice(0, 3).map((t) => t.share)), 0)}%</span>` : "") +
      card(`공급국별 수입 단가 ${q("price")}`, `연간 · 상위 5개국 · ${pl}`, `<div id="d-price"></div>`, "", "<span id='d-price-lead'></span>") +
      card(`공급국 집중도 (HHI) ${q("hhi")}`, "12개월 누적", (e.hhi[i] != null ? hhiScale(e.hhi[i]) : "") + `<div id="d-hhi"></div>` +
        rule(`HHI(허핀달-허쉬만 지수) = 공급국별 점유율(%)을 제곱해 더한 값 — 1개국이 100%면 10,000, 2개국이 반반이면 5,000, 4개국이 25%씩이면 2,500, 10개국이 10%씩이면 1,000 · <b>10,000 ÷ HHI = 같은 크기 나라 몇 곳에서 나눠 사오는 것과 같은지</b> · 1,500 미만 분산 · 1,500~2,500 보통 · 2,500 이상 집중 (미국 법무부·FTC 2010 기준)`), "span-2",
        e.hhi[i] != null ? `비슷한 크기의 나라 <b>${nf(10000 / e.hhi[i], 1)}곳</b>에서 나눠 사오는 수준 · ${e.hhi[i] >= 2500 ? "집중" : e.hhi[i] >= 1500 ? "보통" : "분산"} <span class="sub">HHI ${nf(e.hhi[i], 0)} · 1위 ${tops[0] ? cname(tops[0].c) + " " + nf(tops[0].share, 0) + "%" : "–"}</span>` : "") +

      `</div>`;

    const a = seriesOf(e, "imp", S.measure, S.agg, since, [axis, key]), b = seriesOf(e, "exp", S.measure, S.agg, since, [axis, key]);
    C.lineChart($("#d-trend"), { x: a.x, series: [{ name: "수입", values: a.v }, { name: "수출", values: b.v }],
      yFmt: S.measure === "price" ? pf : yFmt(S.measure), markers: S.agg === "year" ? [] : revMarkers(a.x), xLabelFmt: xFmt, height: 260 });
    C.hbars($("#d-sup"), tops.map((t) => ({ label: cname(t.c), value: t.imp,
      text: `${usd(t.imp)} · ${nf(t.share, 1)}% · ${t.prev ? ((t.imp / t.prev - 1) * 100 >= 0 ? "▲" : "▼") + nf(Math.abs((t.imp / t.prev - 1) * 100), 0) + "%" : "신규"}`,
      onClick: () => { S.country = t.c; go("country"); } })));
    // 국가별 단가 (연간)
    const rows = (D.countries[axis] || {})[key] || {};
    const top5 = tops.slice(0, 5).map((t) => t.c);
    const years = [...new Set(months().map((m) => m.slice(0, 4)))].filter((y) => !S.start || y >= S.start);
    const pSeries = top5.map((c) => ({ name: cname(c),
      values: years.map((y) => { const r = rows[c] && rows[c].y[y]; return r && r[1] ? cv(r[0], r[1]) : null; }) }));
    C.lineChart($("#d-price"), { x: years, series: pSeries, yFmt: pf, height: 220, yMin0: false });
    const lastP = pSeries.map((p) => ({ n: p.name, v: p.values[p.values.length - 1] })).filter((x) => x.v != null).sort((a, b) => b.v - a.v);
    if (lastP.length > 1) $("#d-price-lead").innerHTML = `${years[years.length - 1]}년 최고 ${lastP[0].n} ${pf(lastP[0].v)} <span class="sub">최저 ${lastP[lastP.length - 1].n} ${pf(lastP[lastP.length - 1].v)} ${pl}</span>`;
    const ms = months(), keep = ms.map((m) => !S.start || m.slice(0, 4) >= S.start);
    const fx = ms.filter((_, j) => keep[j]);
    C.lineChart($("#d-hhi"), { x: fx, series: [{ name: "HHI", values: e.hhi.filter((_, j) => keep[j]) }], yFmt: (v) => nf(v, 0), height: 200, xLabelFmt: xFmt, area: true, bandLine: true, yMaxMin: 3000,
      tipFmt: (v) => `${nf(v, 0)} (≈ ${nf(10000 / v, 1)}개국)`,
      bands: [{ from: 0, to: 1500, color: C.color(5), label: "분산" }, { from: 1500, to: 2500, color: C.color(3), label: "보통" }, { from: 2500, to: 10000, color: C.color(7), label: "집중" }] });

  }

  // ── 탭 ─────────────────────────────────────────────────
  function tabGroup(host) {
    host.innerHTML = `<div class="pills">${D.meta.groups.map((g) => `<button class="pill" data-k="${g.key}" aria-pressed="${g.key === S.group}">${g.name}</button>`).join("")}</div><div id="g-detail"></div>`;
    host.querySelectorAll(".pill").forEach((b) => b.onclick = () => { S.group = b.dataset.k; setHash(); tabGroup(host); });
    renderDetail($("#g-detail"), "group", S.group);
  }

  function tabProduct(host) {
    const cards = D.meta.products.map((p) => {
      const e = entry("product", p.key);
      const disabled = p.status === "pending";
      let body = `<div class="pd">${disabled ? "무역통계로 추적 불가" : "실적 없음"}</div>`;
      if (e && !disabled) {
        const L = l12(e);
        const since = p.since;
        const vals = e.imp_usd.map((v, i) => (since && months()[i] < since ? null : v));
        const K = l12(e, "imp_kg").cur, pv = K ? pconv("product", p.key)(L.cur, K) : null;
        body = `<div class="pv num">${usd(L.cur)}</div><div class="pd">최근 12개월 · ${delta(L.cur, L.prev)}</div>` +
          `<div class="pd">단가 ${pv ? pfmt("product", p.key)(pv) + " " + plabel("product", p.key) : "–"}${unitOf("product", p.key).unit === "m3" ? (unitOf("product", p.key).calibrated ? " (산림청 계수)" : " (잠정)") : ""}</div>${C.sparkline(vals.slice(-60))}`;
      }
      const badge = p.status === "partial" ? `<span class="badge" title="${(p.note || "").replace(/"/g, "&quot;")}">일부만 집계</span>` : p.since ? `<span class="badge" title="${p.since.slice(0, 4)}년 HS 개정으로 전용 코드가 생긴 뒤부터 집계">${p.since.slice(0, 4)}~</span>` : "";
      return `<button class="pcard ${disabled ? "disabled" : ""}" data-k="${p.key}" aria-pressed="${p.key === S.product}">` +
        `<div class="pn">${p.num}. ${badge}</div><div class="pt one-line">${p.name}</div>${body}</button>`;
    }).join("");
    host.innerHTML = `<div class="note" style="margin-bottom:8px">「목재의 지속가능한 이용에 관한 법률」 규격·품질 기준 15종 + CLT + LVL. 카드를 누르면 상세가 아래에 표시됨.<br><b>일부만 집계</b> = 무역통계 코드로 일부 수종만 구분됨(방부목재 = 약제 처리 원목 + 적송·가문비·SPF 방부 제재목, 난연목재 = 적송·가문비·SPF 난연 제재목만 — 그 밖의 수종은 일반 제재목과 같은 코드라 분리 불가, 2022~) · <b>2022~</b> = 2022년 HS 개정으로 전용 코드가 생겨 그때부터 집계 · 목재플라스틱복합재는 전용 코드가 없어 추적 불가</div>` +
      `<div class="pcards">${cards}</div><div id="p-detail" style="margin-top:16px"></div>`;
    host.querySelectorAll(".pcard").forEach((b) => b.onclick = () => { S.product = b.dataset.k; setHash(); tabProduct(host); $("#p-detail").scrollIntoView({ behavior: "smooth", block: "start" }); });
    renderDetail($("#p-detail"), "product", S.product);
  }

  function tabSpecies(host) {
    const s1 = Object.keys(D.series.series.species1 || {});
    const s2all = Object.keys(D.series.series.species2 || {});
    if (!s1.length) { host.innerHTML = `<div class="empty">수종 데이터 없음</div>`; return; }
    const order = ["침엽수", "열대 활엽수", "온대 활엽수", "처리목"].filter((k) => s1.includes(k));
    const yr = (axis, k) => seriesOf(entry(axis, k), "imp", S.measure === "price" ? "imp_usd" : S.measure, "year");
    const base = yr("species1", order[0]);
    const rows = s2all.map((k) => {
      const e = entry("species2", k), L = l12(e), K = l12(e, "imp_kg");
      return { k, cur: L.cur, prev: L.prev, kg: K.cur, top: topSuppliers("species2", k, 1)[0] };
    }).sort((a, b) => (b.cur || 0) - (a.cur || 0));
    if (!S.sp2 || !s2all.includes(S.sp2)) S.sp2 = rows[0].k;
    host.innerHTML = `<div class="note" style="margin-bottom:8px">원목(4403)·제재목(4407)만 HS 코드에 수종이 구분되어 있음. 낙엽송·편백 등 세부 수종은 HSK 10단위 기준.</div>` +
      `<div class="grid g-2">` +
      card("대분류별 원목·제재목 수입 (연간)", S.measure === "imp_kg" ? "천 톤" : "백만 달러", `<div id="s-1"></div>`) +
      card("세부 수종 (최근 12개월)", "클릭하면 상세", `<div class="tbl-wrap" style="max-height:290px;overflow:auto" id="s-2"></div>`) +
      `</div><div id="s-detail" style="margin-top:16px"></div>`;
    C.barChart($("#s-1"), { x: base.x, stacked: true, series: order.map((k) => ({ name: k, values: yr("species1", k).v })), yFmt: (v) => nf(v, 0), tipFmt: (v) => nf(v, 1), height: 260 });
    $("#s-2").innerHTML = `<table><thead><tr><th>수종</th><th>수입액</th><th>수입량</th><th>전년 대비<br><span class="sub">수입액</span></th><th>단가<br><span class="sub">USD/t</span></th><th class="l">최대 공급국</th></tr></thead><tbody>` +
      rows.map((r) => `<tr class="click" data-k="${r.k}"><td>${r.k}</td><td>${usd(r.cur)}</td><td>${r.kg ? ton(r.kg) : "–"}</td><td>${delta(r.cur, r.prev)}</td><td>${r.kg ? nf((r.cur / r.kg) * 1000, 0) : "–"}</td><td class="l">${r.top ? cname(r.top.c) : "–"}</td></tr>`).join("") + `</tbody></table>`;
    $("#s-2").querySelectorAll("tr[data-k]").forEach((tr) => tr.onclick = () => { S.sp2 = tr.dataset.k; setHash(); renderDetail($("#s-detail"), "species2", S.sp2); $("#s-detail").scrollIntoView({ behavior: "smooth" }); });
    renderDetail($("#s-detail"), "species2", S.sp2, "원목+제재목 합계");
  }

  function tabCountry(host) {
    const all = topSuppliers("total", "all", 999);
    if (!all.length) { host.innerHTML = `<div class="empty">데이터 없음</div>`; return; }
    if (!S.country || !all.find((r) => r.c === S.country)) S.country = all[0].c;
    const me = all.find((r) => r.c === S.country);
    const rank = all.indexOf(me) + 1;
    const rec = D.countries.total.all[S.country];
    const years = Object.keys(rec.y).sort().filter((y) => !S.start || y >= S.start);
    host.innerHTML = `<div class="controls" style="margin-top:0"><span class="ctl-label">국가</span><select id="cSel">${all.map((r) =>
      `<option value="${r.c}" ${r.c === S.country ? "selected" : ""}>${cname(r.c)} (${nf(r.share, 1)}%)</option>`).join("")}</select></div>` +
      `<div class="grid g-4">` +
      kpi("최근 12개월 수입액", usd(me.imp), `직전 대비 ${delta(me.imp, me.prev)}`) +
      kpi("목재류 수입 점유율", `${nf(me.share, 1)}%`, `공급국 순위 ${rank}위 / ${all.length}개국`) +
      kpi("최근 12개월 수입량", ton(me.kg), "") +
      kpi("평균 수입 단가", me.kg ? `${nf((me.imp / me.kg) * 1000, 0)} <small>USD/t</small>` : "–", "목재류 전체 · 톤 액면") +
      `</div><div class="grid g-2" style="margin-top:12px">` +
      card(`${cname(S.country)}산 목재류 수입 (연간)`, "백만 달러 · 천 톤", `<div id="c-yr"></div>`) +
      card("품목군 구성 (최근 12개월)", "수입액", `<div id="c-grp"></div>`) +
      card("목재제품별 수입과 점유율 (최근 12개월)", "해당 제품 전체 수입 중 이 나라 비중", `<div class="tbl-wrap" id="c-prod"></div>`, "span-2") +
      `</div>`;
    $("#cSel").onchange = (ev) => { S.country = ev.target.value; setHash(); tabCountry(host); };
    C.barChart($("#c-yr"), { x: years, series: [{ name: "수입액(백만 달러)", values: years.map((y) => rec.y[y][0] / 1e6) },
      { name: "수입량(천 톤)", values: years.map((y) => rec.y[y][1] / 1e6) }], stacked: false, yFmt: (v) => nf(v, 0), tipFmt: (v) => nf(v, 1), height: 240 });
    const grows = D.meta.groups.map((g) => { const r = ((D.countries.group || {})[g.key] || {})[S.country]; return { label: g.name, value: r ? r.l12[0] : 0 }; })
      .filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
    const gt = sum(grows.map((r) => r.value));
    C.hbars($("#c-grp"), grows.map((r) => ({ ...r, text: `${usd(r.value)} · ${nf((r.value / gt) * 100, 1)}%` })));
    const prow = D.meta.products.filter((p) => p.status !== "pending").map((p) => {
      const rows = (D.countries.product || {})[p.key] || {};
      const tot = sum(Object.values(rows).map((r) => r.l12[0]));
      const r = rows[S.country];
      return { p, imp: r ? r.l12[0] : 0, kg: r ? r.l12[1] : 0, share: tot && r ? (r.l12[0] / tot) * 100 : 0 };
    }).filter((x) => x.imp > 0).sort((a, b) => b.imp - a.imp);
    $("#c-prod").innerHTML = prow.length ? `<table><thead><tr><th>제품</th><th>수입액</th><th>수입량</th><th>단가</th><th>점유율</th></tr></thead><tbody>` +
      prow.map((x) => `<tr class="click" data-k="${x.p.key}"><td>${x.p.num}. ${x.p.name}</td><td>${usd(x.imp)}</td><td>${ton(x.kg)}</td><td>${x.kg ? pfmt("product", x.p.key)(pconv("product", x.p.key)(x.imp, x.kg)) + " " + plabel("product", x.p.key) : "–"}</td><td>${nf(x.share, 1)}%</td></tr>`).join("") + `</tbody></table>`
      : `<div class="empty">목재제품 수입 실적 없음</div>`;
    $("#c-prod").querySelectorAll("tr[data-k]").forEach((tr) => tr.onclick = () => { S.product = tr.dataset.k; go("product"); });
  }

  function tabData(host) {
    const m = D.meta;
    const CR = (D.judg && D.judg.criteria) || {}, R = CR.references || {};
    const crit = card("판정 기준과 레퍼런스", "", `<div class="tbl-wrap"><table><thead><tr><th class="l">판정</th><th class="l">규칙</th><th class="l">레퍼런스</th></tr></thead><tbody>
        <tr><td class="l">수입 집중</td><td class="l" style="white-space:normal">취약: 연 수입액 100만 달러↑ + 특정국 50%↑ · 주의: HHI 2,500↑ · 100만 달러 미만 판정 제외 (최근 12개월)</td><td class="l" style="white-space:normal">${[R.motie2023, R.doj2010].filter(Boolean).join("<br>")}</td></tr>
        <tr><td class="l">수입 의존</td><td class="l" style="white-space:normal">수입침투율 = 수입 ÷ (생산 − 수출 + 수입). 원목 = 100 − 원목자급률. 최근 10년 Mann-Kendall 검정 p&lt;0.05면 상승/하락</td><td class="l" style="white-space:normal">${[R.oecd_stan, R.mann1945, R.kendall1975].filter(Boolean).join("<br>")}</td></tr>
        <tr><td class="l">가격 이상</td><td class="l" style="white-space:normal">IFPA = 0.4·z(분기 성장률) + 0.6·z(연간 성장률), z는 과거 같은 달 기준 표준화. ±0.5σ 정상 · 0.5~1σ 다소 높음 · 1σ↑ 비정상 (하락 대칭). 과거 3년↑, 월 수입액 100만 달러↑</td><td class="l" style="white-space:normal">${R.fao_ifpa || ""}</td></tr>
        <tr><td class="l">국내 공급 여력</td><td class="l" style="white-space:normal">수입 비중 = 수입량 ÷ (국내 생산 + 수입), 물량 기준, 5개년↑ Mann-Kendall · 가동률 = 연 생산량 ÷ 최대 생산가능량 · 대체 여력 = 생산량 × (100 ÷ 가동률 − 1) ÷ 수입량, 100% 선은 정의상 경계 · 등급 없이 수치만 제시</td><td class="l" style="white-space:normal">${[R.kfs_wus, R.oecd_stan].filter(Boolean).join("<br>")}</td></tr>
        <tr><td class="l">부피 환산 밀도</td><td class="l" style="white-space:normal">연도별 관세청 수입 순중량(t) ÷ 산림청 임산물수출입통계 수입 물량(㎥)의 중앙값 = 산림청 환산계수 (2016~2025년 모든 연도에서 같은 값 확인). 수입액이 ±2% 넘게 다른 해는 제외. 원목은 실태조사 수입 원목 이용량 기준값을 검증용으로 병기</td><td class="l" style="white-space:normal">${[R.kfs_trade, R.kfs_wus].filter(Boolean).join("<br>")}</td></tr>
        <tr><td class="l">산림청 공표치 대조</td><td class="l" style="white-space:normal">관세청 수집값의 연간 수입액을 산림청 임산물수출입통계(품목별현황)와 HS 4단위로 대조, ±1% 이내면 일치 · 판정 아님(수집 검증)</td><td class="l" style="white-space:normal">${R.kfs_trade || ""}</td></tr>
        <tr><td class="l">국산·수입 가격 수준</td><td class="l" style="white-space:normal">국산 ㎥ 가격 = 판매단가 ÷ (두께×폭×길이), 규격별 중앙값, 원/달러 2025년 연평균 · 수입 = 최근 12개월 CIF ㎥ 단가(산림청 환산계수) 및 2025년 산림청 공표 ㎥ 단가 · 수입 100만 달러 미만 비교 제외 · 판정 없음(참고)</td><td class="l" style="white-space:normal">${[R.kfcf2026, R.bok_fx].filter(Boolean).join("<br>")}</td></tr>
        <tr><td class="l">분석 도구</td><td class="l" style="white-space:normal">수집 scripts/fetch.py · 지표 계산 scripts/analyze.py · 판정 scripts/judge.py · 화면 scripts/build.py (Python 3: pandas, NumPy, PyYAML) · 차트 web/assets/charts.js (자체 SVG) · 실행 GitHub Actions(매월 20일 갱신) · 게시 GitHub Pages · 판정 규칙 config/criteria.yaml</td><td class="l" style="white-space:normal">–</td></tr>
        <tr><td class="l">변화 요인</td><td class="l" style="white-space:normal">ΔV = Σ L(V₁,V₀)·ln(Q₁/Q₀) + Σ L(V₁,V₀)·ln(P₁/P₀), HS6 단위. 한 효과 60%↑면 '주도'</td><td class="l" style="white-space:normal">${R.ang2005 || ""}</td></tr>
      </tbody></table></div>`, "span-2");
    const KC = D.judg && D.judg.kfs_check;
    const kcCard = KC && KC.rows.length ? (() => {
      const hs = [...new Set(KC.rows.map((r) => r.hs))];
      const body = hs.map((h) => { const rr = KC.rows.filter((r) => r.hs === h), ok = rr.filter((r) => r.match), bad = rr.filter((r) => !r.match);
        const mx = ok.length ? Math.max(...ok.map((r) => Math.abs(r.gap_pct))) : null;
        return `<tr><td class="l">${h} ${m.headings[h] || ""}</td><td>${ok.length}/${rr.length}</td><td>${mx == null ? "–" : nf(mx, 2) + "%"}</td><td class="l" style="white-space:normal">${bad.map((r) => `<b>${r.year}년 ${r.gap_pct > 0 ? "+" : ""}${nf(r.gap_pct, 1)}%</b> — ${r.note || "원인 확인 중"}`).join("<br>") || "–"}</td></tr>`; }).join("");
      return card("산림청 공표치 대조", `${KC.years[0]}~${KC.years[1]}년 · ${KC.n_match}/${KC.n} 일치(±${KC.tol_pct}%)`,
        `<div class="tbl-wrap"><table><thead><tr><th class="l">HS</th><th>일치 연도</th><th>최대 차이</th><th class="l">불일치 연도와 원인</th></tr></thead><tbody>${body}</tbody></table></div>
        <div class="foot">관세청 수집값(본 페이지) vs 산림청 임산물수출입통계 품목별현황 수입액(연 누계). 4418 = 산림청 건축목공 + 마루판 · 출처: 산림청 누리집 산림통계(2026-11-01 조회)</div>`, "span-2"); })() : "";
    host.innerHTML = `<div class="grid g-2">` + crit + kcCard +
      card("용어", "", `<div class="note" style="line-height:1.8">
        <b>HHI(허핀달-허쉬만 지수)</b>: 공급국별 점유율(%) 제곱의 합. 1,500 미만 분산, 1,500~2,500 중간 집중, 2,500 이상 고집중.<br>
        <b>상위 3개국 점유율</b>: 수입액 상위 3개 공급국의 합계 비중.<br>
        <b>수입 단가</b>: 수입액 ÷ 수입량. 목재제품은 USD/㎥(산림청 환산계수 또는 잠정 밀도로 환산), 연료형과 혼합 분류(품목군·수종 등)는 USD/t(톤 액면). 품목 구성이 바뀌면 단가도 바뀌므로 해석에 주의.<br>
        <b>12개월 누적</b>: 해당 월을 포함한 직전 12개월 합계. 계절성을 없애고 추세를 볼 때 사용.<br>
        <b>HS 개정</b>: ${(m.hs_revisions || []).map((r) => `${r.name}(${ym(r.month)})`).join(", ")} — 개정 시점에 일부 품목의 코드가 나뉘거나 합쳐져 시계열이 끊길 수 있음.</div>`, "span-2") +
      card("목재제품 분류 기준", "목재이용법 15종 + CLT + LVL", `<div class="tbl-wrap"><table><thead><tr><th>No.</th><th class="l">제품</th><th class="l">HS/HSK 코드</th><th class="l">비고</th></tr></thead><tbody>` +
        m.products.map((p) => `<tr><td>${p.num}</td><td class="l">${p.name}</td><td class="l">${(p.prefixes || []).join(", ") || "–"}</td><td class="l" style="white-space:normal">${p.note || ""}</td></tr>`).join("") + `</tbody></table></div>`, "span-2") +
      (() => { const U = m.units || { items: {} }; const nameOf = (k) => { const [ax, ky] = k.split(":");
          return ax === "heading" ? `${ky} ${m.headings[ky] || ""}` : ax === "product" ? (m.products.find((p) => p.key === ky) || {}).name : ax === "group" ? (m.groups.find((g) => g.key === ky) || {}).name : k; };
        const rows = Object.entries(U.items || {});
        return card("단가 단위와 기준 밀도", U.status === "confirmed" ? "확정" : "6개 품목 산림청 환산계수 · 나머지 잠정",
          `<div class="note" style="margin-bottom:8px">관세청 자료는 금액과 순중량(kg)만 있음. <b>톤 단가</b> = 수입액 ÷ 순중량 × 1,000 (액면, 환산 없음). <b>㎥ 단가</b> = 톤 단가 × 밀도(t/㎥).<br>
            밀도 출처: ① <b>산림청 환산계수</b> — 산림청 임산물수출입통계의 수입 물량(천㎥)이 2016~2025년 모든 연도에서 ‘관세청 순중량 ÷ 고정 계수’와 일치함을 확인(원목 0.855·제재목 0.60·단판 0.50·합판 0.65·파티클보드 0.65·섬유판 0.70). 공표 ㎥ 자체가 환산값이므로 같은 계수를 써서 ㎥ 기준을 공표 통계와 맞춤. 원목은 목재이용실태조사 수입 원목 이용량 기준값(0.84)과 1.5% 차이 ② <b>잠정</b> — 대표값, FAO·ITTO·UNECE(2020) Forest product conversion factors와 대조 전<br>
            가격 섹션의 ‘㎥ 환산 / 톤 액면’ 버튼으로 단위를 바꿔 볼 수 있음. 밀도가 10% 다르면 ㎥ 단가도 약 10% 달라지지만 오르내림(추세)과 이상 판정은 단위와 무관함.</div>` +
          `<div class="tbl-wrap"><table><thead><tr><th class="l">분류</th><th>단위</th><th>기준 밀도(t/㎥)</th><th class="l">기준 상태</th></tr></thead><tbody>` +
          rows.map(([k, v]) => `<tr><td class="l">${nameOf(k)}</td><td>${{ m3: "USD/㎥", t: "USD/t", kg: "USD/kg" }[v.unit]}</td><td>${v.density != null ? nf(v.density, 2) : "–"}</td><td class="l" style="white-space:normal">${v.basis || (v.unit === "t" ? "중량 그대로 (환산 없음)" : "")}</td></tr>`).join("") +
          `</tbody></table></div><div class="foot">표에 없는 품목군·수종 등 혼합 분류는 USD/t(톤 액면)로 표시 (원목 생재와 제품 기건이 섞여 밀도 하나로 환산하면 왜곡됨)</div>`, "span-2"); })() +
      card("품목군 분류 기준 (내부 집계용)", "HS 코드 접두어 · 긴 코드 우선", `<div class="tbl-wrap"><table><thead><tr><th class="l">품목군</th><th class="l">FAO·UNECE JFSQ 대응</th><th class="l">HS 코드</th><th class="l">설명</th></tr></thead><tbody>` +
        m.groups.map((g) => `<tr><td class="l">${g.name}</td><td class="l" style="white-space:normal">${g.jfsq || "–"}</td><td class="l" style="white-space:normal">${(g.prefixes || []).join(", ")}</td><td class="l" style="white-space:normal">${g.desc}</td></tr>`).join("") + `</tbody></table></div>` +
        `<div class="foot">품목군은 화면에 따로 보여주지 않고 자급-수입 구조(가공제품 비중)·변화 요인 분해·국가별 구성 집계에만 씀 · 대응 분류: FAO·ITTO·UNECE·Eurostat 「Joint Forest Sector Questionnaire(JFSQ)」 정의 — 1차 임산물(원목·제재목·목질 패널·펠릿 등)과 2차 가공 목제품(SPWP)</div>`, "span-2") +
      `</div>`;
  }

  const TABS = { product: tabProduct, species: tabSpecies, country: tabCountry, data: tabData };

  function renderTab() {
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", t.dataset.tab === S.tab));
    $("#controls").classList.toggle("hidden", S.tab === "data" || S.tab === "country");
    TABS[S.tab]($("#panel"));
  }
  function go(tab) { S.tab = tab; $("#explore").open = true; setHash(); renderTab(); window.scrollTo({ top: $("#explore").offsetTop - 70, behavior: "smooth" }); }

  // URL 해시로 상태 공유 (강의 자료에 특정 화면 링크 가능)
  function setHash() {
    const p = new URLSearchParams({ tab: S.tab });
    if (S.tab === "product") p.set("k", S.product);
    if (S.tab === "species" && S.sp2) p.set("k", S.sp2);
    if (S.tab === "country" && S.country) p.set("k", S.country);
    if (S.pu === "t") p.set("pu", "t");
    history.replaceState(null, "", "#" + p.toString());
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const t = p.get("tab"), k = p.get("k");
    if (t && TABS[t]) S.tab = t;
    if (p.get("pu") === "t") S.pu = "t";
    if (k) ({ group: () => (S.group = k), product: () => (S.product = k), species: () => (S.sp2 = k), country: () => (S.country = k) }[S.tab] || (() => {}))();
  }


  // 시안: 한눈에 보기 아래로 기존 분석을 '자세히 보기'에 접어 넣음
  function setupV2() {
    const main = $("#main"), g = $("#glance"), ex = $("#explore");
    if (!main || !g || $("#deep")) return;
    g.hidden = false;
    const det = document.createElement("details");
    det.className = "fold deep"; det.id = "deep";
    det.innerHTML = `<summary>자세히 보기 — 목재 유통 · 수급·공급망 진단 <span class="hint">기본 현황 · 수입 위험 · 국내 공급 여력 · 국내 유통 라인 · 가격</span></summary><div class="fold-body" id="deep-body"></div>`;
    main.insertBefore(det, ex);
    const body = $("#deep-body", det);
    let n = g.nextElementSibling;
    while (n && n !== det) { const nx = n.nextElementSibling; body.appendChild(n); n = nx; }
    // 안쪽 구역(판정 요약·수입 집중·…)도 각각 접기 — 처음엔 모두 접힘, 제목을 누르면 펼침
    [...body.querySelectorAll(":scope > .sec-title")].filter((st) => !(st.nextElementSibling && st.nextElementSibling.id === "verdicts")).forEach((st) => {   // 판정 요약은 접지 않고 고정
      const sub = document.createElement("details"); sub.className = "sub-fold";
      const sm = document.createElement("summary");
      st.parentNode.insertBefore(sub, st);
      let x = st.nextElementSibling; const part = [];
      while (x && !x.classList.contains("sec-title")) { part.push(x); x = x.nextElementSibling; }
      sm.appendChild(st); sub.appendChild(sm);
      const bd = document.createElement("div"); bd.className = "sub-body"; part.forEach((e) => bd.appendChild(e)); sub.appendChild(bd);
      sm.addEventListener("click", (e) => { if (e.target.closest("button, a, select, .q")) e.preventDefault(); });   // 제목 줄 안의 버튼(㎥/톤 전환 등)은 접기 대신 버튼 동작
      sub.addEventListener("toggle", () => { if (sub.open) renderAll(); });   // 접힌 상태에서는 차트 폭을 잴 수 없어 펼칠 때 다시 그림
    });
    const openTo = (el) => { let d = el; while (d) { if (d.tagName === "DETAILS") d.open = true; d = d.parentElement; } };
    document.addEventListener("click", (ev) => { const a = ev.target.closest("a[href^='#sec-'], a.go"); if (!a) return; ev.preventDefault();
      goSec(a.getAttribute("href").slice(1)); });
    det.addEventListener("toggle", () => { if (det.open) { renderAll(); } });
  }


  // ── 페이지 안 찾기: 화면(카드·구역 제목·본문) + 목재제품 · 품목군 · 수종 · 국가 ──
  // 찾기 대상은 아래 지정 항목만 (추천 검색어 = 지정 항목). 항목 추가는 여기에만
  const SR_ITEMS = [
    { label: "수입의존도", sub: "원목·목재제품별 수입의존도 · 추세 · 자급-수입 구조", alias: "수입 의존 의존도 자급률 수입비중 수입침투율", target: "#sec-risk" },
    { label: "가동률", sub: "국내 설비 가동률 · 생산능력과 생산량", alias: "가동 설비 생산능력 캐파 공급여력 국내 공급 여력", target: "#sec-domestic" },
    { label: "목재산업 규모", sub: "매출액 · 종사자 (목재이용실태조사)", alias: "산업규모 매출 종사자 고용 산업", target: "#sec-dist" },
    { label: "품목별 정보", sub: "상세 탐색 — 목재제품 탭 (제품별 수입·공급국·단가)", alias: "품목 제품 목재제품 합판 제재목 CLT 집성재 펠릿", tab: "product" },
    { label: "수종별 정보", sub: "상세 탐색 — 수종 탭 (원목·제재목 세부 수종)", alias: "수종 나무 원목 제재목 소나무 라디에타 낙엽송 삼나무", tab: "species" },
  ];
  function setupSearch() {
    const q = $("#sr-q"), res = $("#sr-res"), sug = $("#sr-sug");
    if (!q || q.dataset.ready) return;
    q.dataset.ready = 1;
    const norm = (s) => (s || "").toLowerCase().replace(/[\s·()\[\]\-\/,.:'"‘’“”]/g, "");
    const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    let sel = 0, cur = [];
    const reveal = (el) => {
      let d = el.parentElement; while (d) { if (d.tagName === "DETAILS") d.open = true; d = d.parentElement; }
      setTimeout(() => {
        window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - 90, behavior: "smooth" });
        const box = el.classList.contains("sec-title") ? el : el.closest(".card, .g-sig, .g-head") || el;
        box.classList.remove("sr-flash"); void box.offsetWidth; box.classList.add("sr-flash");
      }, 60);
    };
    const close = () => { res.hidden = true; };
    const run = () => {
      const n = norm(q.value);
      if (!n) { close(); return; }
      cur = SR_ITEMS.map((it) => { const k = norm(it.label), a = it.alias.split(" ").map(norm);
        return { ...it, score: k.startsWith(n) ? 3 : k.includes(n) ? 2 : a.some((x) => x.includes(n) || (n.length >= 2 && n.includes(x))) ? 1 : 0 }; })
        .filter((it) => it.score).sort((a, b) => b.score - a.score);
      sel = 0;
      res.innerHTML = cur.length ? cur.map((h, i) => `<button type="button" class="sr-it${i === 0 ? " on" : ""}" data-i="${i}"><span class="sr-b"><b>${esc(h.label)}</b><span>${esc(h.sub)}</span></span></button>`).join("")
        : `<div class="sr-none">‘${esc(q.value)}’ 결과 없음 — 찾을 수 있는 항목: ${SR_ITEMS.map((x) => x.label).join(" · ")}</div>`;
      res.hidden = false;
    };
    const pick = (i) => { const h = cur[i]; if (!h) return; close(); q.blur();
      if (h.tab) { go(h.tab); return; }
      const el = document.querySelector(h.target); if (el) reveal(el); };
    q.addEventListener("input", run);
    q.addEventListener("focus", () => { if (q.value) run(); });
    q.addEventListener("keydown", (e) => {
      const its = res.querySelectorAll(".sr-it");
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!its.length) return; sel = (sel + (e.key === "ArrowDown" ? 1 : its.length - 1)) % its.length; its.forEach((b, i) => b.classList.toggle("on", i === sel)); its[sel].scrollIntoView({ block: "nearest" }); }
      else if (e.key === "Enter") { e.preventDefault(); pick(sel); }
      else if (e.key === "Escape") { close(); q.blur(); }
    });
    res.addEventListener("mousedown", (e) => { const b = e.target.closest(".sr-it"); if (b) { e.preventDefault(); pick(+b.dataset.i); } });
    document.addEventListener("click", (e) => { if (!e.target.closest("#search")) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); q.focus(); } });
    sug.insertAdjacentHTML("beforeend", SR_ITEMS.map((s, i) => `<button type="button" data-i="${i}">${s.label}</button>`).join(""));
    sug.querySelectorAll("button").forEach((b) => b.onclick = () => { cur = [SR_ITEMS[+b.dataset.i]]; pick(0); });
  }

  async function init() {
    const get = (f) => fetch(`data/${f}?v=${window.BUILD_ID || ""}`).then((r) => (r.ok ? r.json() : null));
    const [meta, series, countries, insights, supply, judg] = await Promise.all(["meta.json", "series.json", "countries.json", "insights.json", "supply.json", "judgments.json"].map(get));
    D.meta = meta || { status: "collecting" };
    renderHeader();
    if (!series || !series.months || !series.months.length) {
      $("#main").innerHTML = `<div class="loading">첫 데이터를 수집하는 중임. 수집이 끝나면 자동으로 표시됨.</div>`;
      return;
    }
    Object.assign(D, { series, countries, insights, supply, judg });
    const years = [...new Set(series.months.map((m) => m.slice(0, 4)))];
    S.start = years[0];
    readHash();
    if (V2) setupV2();
    renderAll();
    renderControls();
    document.querySelectorAll(".tab").forEach((t) => t.onclick = () => go(t.dataset.tab));
    renderTab();
    setupSearch();
    let w = window.innerWidth;
    window.addEventListener("resize", () => { if (Math.abs(window.innerWidth - w) > 40) { w = window.innerWidth; renderAll(); renderTab(); } });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { renderAll(); renderTab(); });
    $("#explore").addEventListener("toggle", () => { if ($("#explore").open) renderTab(); });
    // 상세 탐색은 처음엔 접어 둠 — 특정 품목·국가를 가리키는 링크(#…&k=…)로 들어왔을 때만 펼침
    if (/[#&]k=/.test(location.hash)) { $("#explore").open = true; setTimeout(() => goSec("explore"), 300); }
  }
  init();
})();
