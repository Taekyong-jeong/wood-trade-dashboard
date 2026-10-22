/* 대한민국 목재 수급·공급망 진단 — 화면 로직 */
(function () {
  const C = window.Charts;
  const $ = (s, r = document) => r.querySelector(s);
  const D = {};
  const S = {
    tab: "group", measure: "imp_usd", agg: "r12", start: null,
    group: "raw", product: "p01", sp1: null, sp2: null, country: null, pu: "m3",
  };
  const UNIT = { imp_usd: "백만 달러", imp_kg: "천 톤", price: "USD/kg" };
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
  // 품목별 단가 단위 (config/units.yaml): m3=밀도 환산 추정, t=톤, 그 외 kg
  function unitOf(axis, key, raw) {
    const U = (D.meta && D.meta.units) || {};
    const it = (U.items || {})[`${axis}:${key}`];
    if (!it) return { unit: "kg" };
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
  // ㎥ 환산 배지: 보정(실태조사) / 잠정(대표값). 툴팁에 공식·밀도 출처
  const pest = (axis, key) => { const u = unitOf(axis, key); if (u.unit !== "m3") return "";
    const f = `USD/㎥ = USD/t × 밀도 ${nf(u.density, 2)} t/㎥ · ${u.basis || ""}`;
    return u.calibrated ? ` <span class="badge" title="${f}">보정</span>` : ` <span class="badge" title="${f}">잠정</span>`; };
  // 같은 값의 다른 단위 (㎥ 환산 ↔ 톤 액면)
  function ptwin(axis, key, usdv, kg) {
    const b = unitOf(axis, key, true);
    if (b.unit !== "m3" || !kg) return "";
    return S.pu === "t" ? `≈ ${nf((usdv * b.density * 1000) / kg, 0)} USD/㎥(${b.calibrated ? "보정" : "잠정"})` : `= ${nf((usdv * 1000) / kg, 0)} USD/t (액면)`;
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
  const yFmt = (measure) => (v) => measure === "price" ? nf(v, 2) : nf(v, v >= 100 ? 0 : 1);
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
  function card(title, hint, body = "", cls = "", lead = "") {
    return `<div class="card ${cls}"><div class="card-head"><h3 class="one-line">${title}</h3>${hint ? `<span class="hint">${hint}</span>` : ""}</div>` +
      `${lead ? `<div class="lead" title="${lead.replace(/<[^>]+>/g, "")}">${lead}</div>` : ""}${body}</div>`;
  }
  // 용어 설명 (물음표에 마우스를 올리거나 누르면 표시)
  const TIP = {
    hhi: "공급국별 수입 점유율(%)을 제곱해 더한 값. 한 나라가 100% 공급하면 10,000, 10개국이 10%씩 나누면 1,000. 1,500 미만 분산 · 1,500~2,500 보통 · 2,500 이상 집중 (미국 법무부 시장집중도 기준).",
    dep: "공급국 의존도: 수입이 특정 국가에 얼마나 몰려 있는지. 최대 공급국 점유율 50% 이상 또는 HHI 2,500 이상이면 '높음', HHI 1,500~2,500이면 '보통', 그 미만이면 '낮음'.",
    logdep: "원목 수입의존도 = 100 − 원목자급률. 국내에서 쓰는 원목(㎥) 중 수입산의 비율. 산림청 목재수급통계(연 1회 공표).",
    price: "수입 단가 = 수입액 ÷ 수입량. 운임·보험료가 포함된 도착 가격(CIF). 목재제품은 USD/㎥(중량을 밀도로 환산 — 실태조사로 보정한 품목은 ‘보정’, 나머지는 ‘추정’), 연료형은 USD/t, 혼합 분류는 USD/kg. 같은 품목도 수종·규격 구성이 바뀌면 달라짐.",
    r12: "12개월 누적: 해당 월까지 최근 12개월 합계. 계절에 따른 들쭉날쭉함을 없애고 추세를 볼 때 씀.",
    share: "점유율: 해당 품목 전체 수입액 중 그 나라가 차지하는 비율.",
    gap: "무역수지 = 수출액 − 수입액. 음수면 수입이 더 많음. 수입은 CIF, 수출은 FOB 기준.",
    ishare: "물량 기준 수입 비중 = 수입량 ÷ (국내 생산량 + 수입량). ㎥ 또는 톤 기준. 목재이용실태조사(산림청, 연 1회).",
    util: "가동률 = 연 생산량 ÷ 최대 생산가능량. 목재이용실태조사 응답업체 기준. 공표값이 없는 품목은 실태조사 항목(일평균 생산량·가동일·최대 생산가능량)으로 산출.",
    cover: "대체 여력 = 국내 여유 생산능력 ÷ 수입량. 여유 생산능력 = 생산량 × (100 ÷ 가동률 − 1). 100% 이상이면 지금 남는 국내 설비만으로 수입량 전부를 만들 수 있다는 뜻. 원료 조달·품질·가격은 반영하지 않은 물리적 상한.",
    idx: "단가 지수: 비교 시작 시점의 12개월 평균 단가를 100으로 놓고 환산한 값. 단위가 다른 품목의 가격 변화 속도를 한 그래프에서 비교하기 위함.",
  };
  const q = (k) => `<button class="q" type="button" aria-label="설명" data-tip="${TIP[k]}">?</button>`;
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
    if (axis === "group") { S.group = key; go("group"); }
    else if (axis === "product") { S.product = key; go("product"); }
    else if (axis === "species2") { S.sp2 = key; go("species"); }
    else if (axis === "heading") { S.group = key === "4403" ? "raw" : "primary"; go("group"); }
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
    $("#v-hint").textContent = `${ym(J.month)} 기준 · 판정 규칙: config/criteria.yaml`;
    $("#verdicts").innerHTML = J.cards.map((c) =>
      `<button class="vcard ${c.level}" data-go="sec-${c.id}"><span class="vt">${c.title}</span><span class="vb">${c.badge}</span>` +
      `<span class="vx">${c.text}</span><span class="vr">기준: ${refs(c.refs)}</span></button>`).join("");
    $("#verdicts").querySelectorAll(".vcard").forEach((b) => b.onclick = () => {
      const t = document.getElementById(b.dataset.go); if (t) window.scrollTo({ top: t.offsetTop - 70, behavior: "smooth" }); });
  }

  // ── 수입 집중 (공급 위험 1차 선별) ─────────────────────
  function renderSupply() {
    const sr = D.judg.supply_risk, per = periodL12();
    const nV = sr.filter((d) => d.grade === "취약").length, nC = sr.filter((d) => d.grade === "주의").length;
    const col = { "취약": C.color(7), "주의": C.color(3), "안정": C.color(0), "판정 제외": getComputedStyle(document.documentElement).getPropertyValue("--other").trim() };
    $("#a-supply").innerHTML =
      card(`수입 집중 지도 ${q("dep")}`, `${per} · 점 = 품목`, `<div id="sr-map"></div>` +
        rule(`<b>취약</b>: 연 수입액 100만 달러 이상 + 특정국 의존도 50% 이상 (산업부 산업 공급망 3050 전략, 2023) · <b>주의</b>: HHI 2,500 이상 (미국 DOJ·FTC, 2010) · 100만 달러 미만은 판정 제외`), "",
        `취약 ${nV}개 · 주의 ${nC}개 <span class="sub">오른쪽 위(빨간 선 바깥)가 크고 쏠린 품목</span>`) +
      card(`품목별 판정 ${q("hhi")}`, "행을 누르면 상세",
        `<div class="tbl-wrap"><table><thead><tr><th class="l">품목</th><th>판정</th><th class="l">최대 공급국</th><th>HHI</th><th>수입액</th></tr></thead><tbody>` +
        sr.map((d) => `<tr class="click" data-axis="${d.axis}" data-key="${d.key}" title="${d.reason}"><td class="l">${d.label}</td><td>${badge(d.grade)}</td>` +
          `<td class="l">${d.top_name} ${nf(d.top_share, 0)}%</td><td>${nf(d.hhi, 0)}</td><td>${usd(d.imp_usd)}</td></tr>`).join("") +
        `</tbody></table></div><div class="foot">${per} · 출처: ${SRC} · 행에 마우스를 올리면 판정 근거</div>`, "",
        nV ? `취약: ${sr.filter((d) => d.grade === "취약").map((d) => d.label.replace(/\(.+\)/, "")).join(" · ")}` : "취약 품목 없음");
    C.scatterChart($("#sr-map"), {
      points: sr.map((d) => ({ x: d.top_share, y: d.imp_usd, label: d.label.replace(/\(.+\)/, ""), color: col[d.grade],
        size: d.grade === "판정 제외" ? 4 : 7, labelOn: d.grade === "취약", onClick: () => openDetail(d.axis, d.key), d })),
      xMin: 0, xMax: 100, logY: true, height: 320, xTitle: "최대 공급국 점유율 (%)", yTitle: "연 수입액 (USD, 로그)",
      xFmt: (v) => v + "%", yFmt: (v) => (v >= 1e8 ? nf(v / 1e8, 0) + "억" : v >= 1e6 ? nf(v / 1e6, 0) + "백만" : nf(v / 1e3, 0) + "천"),
      refX: [{ v: 50, label: "특정국 50%" }], refY: [{ v: 1e6, label: "연 100만 달러" }],
      tip: (p) => `<div class="tt">${p.d.label} ${badge(p.d.grade)}</div><div class="tr"><span>최대 공급국</span><b>${p.d.top_name} ${nf(p.d.top_share, 1)}%</b></div>` +
        `<div class="tr"><span>연 수입액</span><b>${usd(p.d.imp_usd)}</b></div><div class="tr"><span>HHI</span><b>${nf(p.d.hhi, 0)}</b></div>` +
        `<div style="margin-top:4px;color:var(--ink-2);white-space:normal;max-width:240px">${p.d.reason}</div>` });
    $("#a-supply").querySelectorAll("tr[data-axis]").forEach((tr) => tr.onclick = () => openDetail(tr.dataset.axis, tr.dataset.key));
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
        `<div class="tbl-wrap"><table><thead><tr><th class="l">품목</th><th>수입 비중</th><th>추세</th><th>가동률 ${q("util")}</th><th>대체 여력</th><th>수입 집중</th></tr></thead><tbody>` +
        rows.map((d) => `<tr class="click" data-axis="${d.axis}" data-key="${d.key}" title="국내 생산 ${big(d.production)}${u(d)} · 수입 ${big(d.imports)}${u(d)}${d.util_note ? " · 가동률: " + d.util_note : ""}">` +
          `<td class="l">${short(d.label)}</td><td>${nf(d.import_share, 0)}%</td><td>${badge(d.trend.startsWith("판정 보류") ? "판정 보류" : d.trend)}</td>` +
          `<td>${d.utilization == null ? "–" : nf(d.utilization, 0) + "%" + (/참고치/.test(d.util_note) ? "*" : "")}</td>` +
          `<td>${d.spare_cover == null ? "–" : nf(d.spare_cover, 0) + "%"}</td><td>${d.risk_grade ? badge(d.risk_grade) : "–"}</td></tr>`).join("") +
        `</tbody></table></div><div class="foot">수입 비중 = 수입량 ÷ (국내 생산 + 수입), 물량 기준 · 추세: Mann-Kendall(5개년 이상) · * 참고치(전국 생산량 ÷ 최대 생산가능량 합계) · 출처: 산림청 목재이용실태조사(${yr}년 기준), 수입 집중은 ${SRC}</div>`, "",
        `국내 목재 이용량 중 수입(제품+원목) ${nf(ov.import_share, 1)}% <span class="sub">(${ov.year}년, 총 ${nf(ov.total / 1e6, 1)}백만 ㎥)</span>`);
    const shareRows = rows.filter((d) => d.share_years.length >= 5);
    const ys = [...new Set(shareRows.flatMap((d) => d.share_years))].sort();
    const UTIL_KEYS = ["p01", "p06", "p07", "p08", "p10", "p12"];   // 업체 수가 적은 소량 품목(집성재·WPC·난연)은 해마다 출렁여 제외
    const utilRows = rows.filter((d) => UTIL_KEYS.includes(d.key) && d.util_years.length >= 8);
    const uy = [...new Set(utilRows.flatMap((d) => d.util_years))].sort();
    host.insertAdjacentHTML("beforeend",
      card("물량 기준 수입 비중 추이", `${ys[0]}~${ys[ys.length - 1]} · %`, `<div id="ds-share"></div>` +
        rule(`수입량 ÷ (국내 생산량 + 수입량) · 수입량은 임산물수출입통계(실태조사 수록), 국내 생산량은 실태조사 추정치`), "",
        shareRows.map((d) => `${short(d.label)} ${nf(d.share_series[0], 0)}→${nf(d.import_share, 0)}%`).slice(0, 4).join(" · ")) +
      card(`국내 설비 가동률 추이 ${q("util")}`, `${uy[0]}~${uy[uy.length - 1]} · %`, `<div id="ds-util"></div>` +
        rule(`가동률 = 연 생산량 ÷ 최대 생산가능량 (실태조사 정의, 응답업체 기준) · 제재목·목재칩은 일평균 생산량 × 월 가동일 × 12로 산출 · 합판 3개·파티클보드 2개·섬유판 5개 업체라 해마다 출렁임 · 집성재·WPC·난연목재는 표에만 표시`), "",
        utilRows.map((d) => `${short(d.label)} ${nf(d.utilization, 0)}%`).join(" · ")));
    C.scatterChart($("#ds-map"), {
      points: pts.map((d) => ({ x: d.top_share, y: Math.min(d.spare_cover, CAP), label: short(d.label), color: col[d.risk_grade] || C.color(0),
        size: 7, labelOn: d.risk_grade === "취약" || d.spare_cover >= 30 || d.top_share >= 50, onClick: () => openDetail(d.axis, d.key), d })),
      xMin: 0, xMax: 100, height: 540, xTitle: "최대 공급국 점유율 (%, 관세청)", yTitle: "국내 대체 여력 (%, 300 이상은 300)",
      xFmt: (v) => v + "%", yFmt: (v) => v + "%", refX: [{ v: 50, label: "특정국 50%" }], refY: [{ v: DS.line, label: "여유능력 = 수입량" }],
      tip: (p) => `<div class="tt">${p.d.label} ${p.d.risk_grade ? badge(p.d.risk_grade) : ""}</div>` +
        `<div class="tr"><span>최대 공급국</span><b>${p.d.top_name} ${nf(p.d.top_share, 0)}%</b></div>` +
        `<div class="tr"><span>수입 비중(물량)</span><b>${nf(p.d.import_share, 0)}%</b></div>` +
        `<div class="tr"><span>가동률</span><b>${p.d.utilization == null ? "–" : nf(p.d.utilization, 0) + "%"}</b></div>` +
        `<div class="tr"><span>대체 여력</span><b>${nf(p.d.spare_cover, 0)}%</b></div>` });
    C.lineChart($("#ds-share"), { x: ys.map(String), series: shareRows.map((d) => ({ name: short(d.label),
      values: ys.map((y) => { const i = d.share_years.indexOf(y); return i < 0 ? null : d.share_series[i]; }) })),
      yFmt: (v) => nf(v, 0) + "%", tipFmt: (v) => nf(v, 1) + "%", height: 250 });
    C.lineChart($("#ds-util"), { x: uy.map(String), series: utilRows.map((d) => ({ name: short(d.label),
      values: uy.map((y) => { const i = d.util_years.indexOf(y); return i < 0 ? null : d.util_series[i]; }) })),
      yFmt: (v) => nf(v, 0) + "%", tipFmt: (v) => nf(v, 1) + "%", height: 250 });
    host.querySelectorAll("tr[data-axis]").forEach((tr) => tr.onclick = () => openDetail(tr.dataset.axis, tr.dataset.key));
  }

  // ── 수입 의존 ──────────────────────────────────────────
  function renderPenetration() {
    const P = D.judg.penetration, S2 = D.judg.structure;
    if (!P) { $("#a-penetration").innerHTML = card("수입 의존", "", `<div class="empty">자료 없음</div>`, "span-2"); return; }
    const mk = P.mk || {};
    const w = (D.supply && D.supply.wood_ssr) ? D.supply.wood_ssr.map((v, j) => [D.supply.years[j], v]).filter(([, v]) => v != null).pop() : null;
    $("#a-penetration").innerHTML =
      card(`원목 수입의존도 ${q("logdep")}`, `${P.years[0]}~${P.latest_year} · %`, `<div id="pn-line"></div>` +
        rule(`수입침투율 = 수입 ÷ (국내 생산 − 수출 + 수입) (OECD STAN) · 원목 = 100 − 원목자급률 (산림청 목재수급통계, ㎥) · 추세: Mann-Kendall 검정, 최근 10년, 유의수준 5% (Mann 1945; Kendall 1975)`) +
        (w ? `<div class="foot">참고: 목재 전체 자급률 ${w[0]}년 ${nf(w[1], 1)}% (수입의존도 약 ${nf(100 - w[1], 0)}%) — 연도별 자료 확보 후 추가</div>` : ""), "",
        `${nf(P.latest, 1)}% (${P.latest_year}) · ${P.verdict} <span class="sub">연 ${mk.sen_slope > 0 ? "+" : ""}${nf(mk.sen_slope, 1)}%p, p=${nf(mk.p, 3)}</span>`) +
      card("자급-수입 구조", "연간 · %", `<div id="pn-struct"></div>` +
        rule(`가공제품 비중 = (1차 가공재 + 보드·패널 + 공학목재 + 건축용 목제품) ÷ (원자재 + 가공제품), 수입액 기준 · 12개월이 다 찬 연도만 표시`), "",
        S2.years.length >= 2 ? `수입 중 가공제품 ${nf(S2.processed_share[0], 0)}% → ${nf(S2.processed_share[S2.processed_share.length - 1], 0)}% <span class="sub">(${S2.years[0]}→${S2.years[S2.years.length - 1]})</span>` : "연도 자료 축적 중");
    C.lineChart($("#pn-line"), { x: P.years.map(String), series: [{ name: "원목 수입의존도", values: P.log_import_dependence }],
      yFmt: (v) => nf(v, 0) + "%", tipFmt: (v) => nf(v, 1) + "%", height: 230, area: true,
      markers: [{ x: String(P.trend_window[0]), label: "추세 검정 구간" }] });
    C.lineChart($("#pn-struct"), { x: S2.years, series: [{ name: "수입 중 가공제품 비중", values: S2.processed_share },
      { name: "원목 수입의존도", values: S2.log_import_dependence, dash: true }], yFmt: (v) => nf(v, 0) + "%", tipFmt: (v) => nf(v, 1) + "%", height: 230 });
    if (S2.years.length < 3) $("#pn-struct").insertAdjacentHTML("beforeend", `<div class="foot">과거 데이터 수집이 끝나면 2016년부터 표시됨</div>`);
  }

  // ── 가격 ───────────────────────────────────────────────
  const PU_RULE = "<b>톤 단가</b> = 수입액 ÷ 순중량 (관세청 액면, 환산 없음) · <b>㎥ 단가</b> = 톤 단가 × 밀도(t/㎥) — 밀도: 제재목·합판·섬유판·파티클보드는 목재이용실태조사 수입량(㎥)과 관세청 중량의 비로 <b>보정</b>(산림청·한국임업진흥원 2024), 원목은 같은 방식 검증(이용량 기준), 나머지는 <b>잠정</b> 대표값 · 단가 지수·이상 판정은 단위와 무관";
  function renderPuSeg() {
    const el = $("#pu-seg"); if (!el) return;
    el.querySelectorAll("button").forEach((b) => { b.classList.toggle("on", b.dataset.pu === S.pu);
      b.onclick = () => { S.pu = b.dataset.pu; setHash(); renderPuSeg(); renderPrice(); if ($("#explore").open) renderTab(); }; });
  }
  function renderPrice() {
    renderPuSeg();
    const PA = D.judg.price_anomaly, ms = months();
    const ready = PA.filter((d) => d.band !== "판정 보류");
    const opts = PA.map((d) => [d.axis, d.key, d.label]);
    if (!S.pmap || !opts.find((o) => `${o[0]}:${o[1]}` === S.pmap)) S.pmap = "product:p11";
    // 단가 지수 (12개월 평균, 시작=100)
    const pitems = [["heading", "4403", "원목"], ["heading", "4407", "제재목"], ["product", "p06", "합판"], ["product", "p11", "목재펠릿"]].filter(([a, k]) => entry(a, k));
    const r12p = (e) => ms.map((_, i) => { if (i < 11) return null; const u = sum(e.imp_usd.slice(i - 11, i + 1)), k = sum(e.imp_kg.slice(i - 11, i + 1)); return k ? u / k : null; });
    const pser = pitems.map(([a, k, n]) => { const v = r12p(entry(a, k)); const b = v.find((x) => x != null); return { name: n, raw: v, values: v.map((x) => (x == null || !b ? null : (x / b) * 100)), a, k }; });
    const now = pser.map((p) => { const i = ms.length - 1; return { n: p.name, v: p.raw[i] != null ? pconv(p.a, p.k)(p.raw[i], 1) : null, u: plabel(p.a, p.k), f: pfmt(p.a, p.k) }; });
    $("#a-price").innerHTML =
      card(`가격 이상 판정 ${q("price")}`, `${ym(ms[ms.length - 1])} 기준`,
        `<div class="tbl-wrap"><table><thead><tr><th class="l">품목</th><th>판정</th><th>점수(σ)</th><th>단가 전년비</th><th>비교 연수</th></tr></thead><tbody>` +
        PA.map((d) => `<tr class="click" data-axis="${d.axis}" data-key="${d.key}"><td class="l">${d.label}</td><td>${badge(d.band)}</td>` +
          `<td>${d.ifpa != null ? (d.ifpa > 0 ? "+" : "") + nf(d.ifpa, 2) : "–"}</td><td>${d.yoy_pct != null ? (d.yoy_pct > 0 ? "+" : "") + nf(d.yoy_pct, 1) + "%" : "–"}</td>` +
          `<td>${d.past_obs}/${d.need_obs}년</td></tr>`).join("") + `</tbody></table></div>` +
        rule(`FAO 식품가격 이상 지표(IFPA, SDG 2.c.1) 방법: 분기·연간 단가 상승률을 과거 같은 달의 평균·표준편차로 표준화, 분기 가중 0.4 · ±0.5σ 정상, 0.5~1σ 다소 높음, 1σ 이상 비정상 (하락은 대칭 적용) · 과거 같은 달 3년 이상 필요`), "",
        ready.length ? `판정 ${ready.length}개 품목 중 이상 ${ready.filter((d) => !["정상"].includes(d.band)).length}개` : `판정 보류 <span class="sub">과거 데이터 수집 후 자동 판정</span>`) +
      card(`공급국 가격대 지도 ${q("price")}`, `${periodL12()}`,
        `<div class="inline-sel"><span class="ctl-label">품목</span><select id="pmapSel">${opts.map(([a, k, n]) => `<option value="${a}:${k}" ${`${a}:${k}` === S.pmap ? "selected" : ""}>${n}</option>`).join("")}</select></div>` +
        `<div id="pmap"></div>` + rule(`점 = 공급국 (최근 12개월 점유율 1% 이상) · 가로 = 점유율, 세로 = 단가 · ${PU_RULE}`), "", `<span id="pmap-lead"></span>`) +
      card(`단가 지수 ${q("idx")}`, "12개월 평균 단가, 시작 = 100", `<div id="pidx"></div>` +
        `<div class="foot">현재 단가: ${now.filter((x) => x.v != null).map((x) => `${x.n} ${x.f(x.v)} ${x.u}`).join(" · ")}</div>` + rule(PU_RULE), "",
        (() => { const y = pser.map((p) => { const i = ms.length - 1; const a = p.raw[i], b = p.raw[i - 12]; return { n: p.name, p: a && b ? (a / b - 1) * 100 : null }; }).filter((x) => x.p != null).sort((a, b) => b.p - a.p);
          return y.length ? `전년 대비 ${y.map((x) => `${x.n} ${x.p > 0 ? "+" : ""}${nf(x.p, 1)}%`).join(" · ")}` : ""; })());
    const DP = D.judg.domestic_price;
    if (DP && DP.pairs.length) {
      const p0 = DP.pairs[0], ref = (p0.imports || []).find((x) => x.ratio != null);
      $("#a-price").insertAdjacentHTML("beforeend", card("국산·수입 가격 수준", `국산 ${p0.domestic.year} 단가표 · 수입 ${ym(DP.period.slice(0, 7))}~${ym(DP.period.slice(8))}`,
        `<div class="tbl-wrap"><table><thead><tr><th class="l">비교</th><th>USD/㎥</th><th>국산 ÷ 수입</th></tr></thead><tbody>` +
        DP.pairs.map((pr) => `<tr class="grp"><td class="l"><b>국산 ${pr.label}</b> <span class="sub">A급 ${pr.domestic.n}규격 중앙값</span></td><td><b>${nf(pr.domestic.median, 0)}</b> <span class="sub">${nf(pr.domestic.min, 0)}~${nf(pr.domestic.max, 0)}</span></td><td></td></tr>` +
          pr.imports.map((im) => im.small ? `<tr><td class="l">└ ${im.label}</td><td colspan="2" class="sub">수입 ${usd(im.usd)} — 100만 달러 미만, 비교 제외</td></tr>`
            : `<tr><td class="l">└ ${im.label}</td><td>${nf(im.usd_m3, 0)}${im.basis ? "" : (im.calibrated ? " <span class='badge'>보정</span>" : " <span class='badge'>잠정</span>")}</td><td><b>${nf(im.ratio, 1)}배</b></td></tr>`).join("")).join("") +
        `</tbody></table></div>` +
        rule(`국산 = 산림조합중앙회 목재유통센터 판매단가(A급·면세) ÷ 규격 부피(T×W×L), 원/달러 ${nf(DP.fx, 0)} (${DP.fx_basis.replace(/^.*?\(/, "").replace(/\)$/, "")}) · 수입 = CIF 단가 — 관세·통관·내륙운송·유통 마진 전이라 같은 단계 가격이 아님. 가격 수준 참고용이며 경쟁력 판정에 쓰지 않음 · ${DP.species_note}`), "",
        ref ? `국산 ${p0.label} ${nf(p0.domestic.median, 0)} USD/㎥ — 수입 제재목 평균의 ${nf(ref.ratio, 1)}배` : ""));
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
      C.scatterChart($("#pmap"), { points: pts.map((p) => ({ x: p.share, y: p.price, label: cname(p.c), size: 4 + Math.sqrt(p.share) * 1.6, labelOn: p.share >= 8,
          color: C.color(0), d: p })), xMin: 0, xMax: Math.max(10, Math.ceil((Math.max(...pts.map((p) => p.share), 10) * 1.25) / 10) * 10), height: 270,
        xTitle: "점유율 (%)", yTitle: pl, xFmt: (v) => v + "%", yFmt: pf, refY: avg ? [{ v: avg, label: `평균 ${pf(avg)}` }] : [],
        tip: (p) => `<div class="tt">${p.label}</div><div class="tr"><span>점유율</span><b>${nf(p.d.share, 1)}%</b></div><div class="tr"><span>단가</span><b>${pf(p.d.price)} ${pl}</b></div><div class="tr"><span>수입액</span><b>${usd(p.d.imp)}</b></div>` });
      const big = pts.filter((p) => p.share >= 5).sort((x, y) => x.price - y.price);
      $("#pmap-lead").innerHTML = big.length >= 2 ? `점유율 5%↑ 중 최저 ${cname(big[0].c)} ${pf(big[0].price)} · 최고 ${cname(big[big.length - 1].c)} ${pf(big[big.length - 1].price)} <span class="sub">${pl}</span>` : "";
    };
    drawMap();
    $("#pmapSel").onchange = (ev) => { S.pmap = ev.target.value; drawMap(); };
  }

  // ── 변화 요인 ──────────────────────────────────────────
  function renderDrivers() {
    const DC = D.judg.decomposition;
    if (!DC.available) { $("#a-drivers").innerHTML = card("변화 요인", "", `<div class="empty">24개월 이상 자료 필요</div>`); return; }
    const t = DC.total;
    const fmtB = (v) => (Math.abs(v) >= 1e8 ? `${v > 0 ? "+" : ""}${nf(v / 1e8, 2)}억` : `${v > 0 ? "+" : ""}${nf(v / 1e6, 0)}백만`);
    const rows = [t, ...DC.groups].map((g) => ({ label: g.label, a: g.volume, b: g.price, c: g.entry_exit, total: g.dV,
      text: `${fmtB(g.dV)} (${g.pct > 0 ? "+" : ""}${nf(g.pct, 1)}%) ${g.driver.replace("물량·단가 ", "")}`,
      tip: `물량 효과 ${fmtB(g.volume)} · 단가 효과 ${fmtB(g.price)}${g.entry_exit ? ` · 신규·중단 ${fmtB(g.entry_exit)}` : ""} (달러)`,
      onClick: g.key !== "all" ? () => openDetail("group", g.key) : null }));
    $("#a-drivers").innerHTML = card(`수입액 변화 분해`, `${DC.period[1]} vs ${DC.period[0]} · 달러`, `<div id="dc-bars"></div>` +
      rule(`로그평균 디비지아 지수분해(LMDI, Ang 2005) · HS 6단위 품목별로 분해 후 합산 · 물량 = 순중량 변화, 단가 = 중량당 금액 변화(HS6 내부 규격·수종 구성 변화 포함) · 한 효과가 60% 이상이면 '주도'`), "",
      `목재류 수입 ${fmtB(t.dV)} 달러 (${t.pct > 0 ? "+" : ""}${nf(t.pct, 1)}%) · ${t.driver} <span class="sub">물량 ${fmtB(t.volume)} · 단가 ${fmtB(t.price)}</span>`);
    C.decompBars($("#dc-bars"), rows);
  }

  // ── 기본 현황 ──────────────────────────────────────────
  function renderBasic() {
    const per = periodL12(), tot = entry("total", "all"), L = l12(tot), Lexp = l12(tot, "exp_usd").cur;
    const tops = topSuppliers("total", "all", 8), top3 = sum(tops.slice(0, 3).map((t) => t.share));
    const SHORT = { "4401": "연료재·펠릿·칩", "4402": "목탄", "4403": "원목", "4407": "제재목", "4408": "단판", "4409": "마루재·성형목재",
      "4410": "PB·OSB", "4411": "섬유판(MDF)", "4412": "합판·LVL", "4415": "팔레트·포장재", "4418": "건축용 목제품", "4419": "주방용품", "4421": "기타 목제품" };
    const hname = (k) => SHORT[k] || D.meta.headings[k] || k;
    const heads = Object.entries(D.series.series.heading || {}).map(([k, e]) => ({ k, usd: l12(e).cur || 0, kg: l12(e, "imp_kg").cur || 0 }));
    const byUsd = [...heads].sort((a, b) => b.usd - a.usd).slice(0, 5), byKg = [...heads].sort((a, b) => b.kg - a.kg).slice(0, 5);
    $("#a-basic").innerHTML =
      card(`최대 수입국 ${q("share")}`, "최근 12개월 수입액", `<div id="bs-cty"></div>` +
        `<div class="foot">${per} · 목재류 수입 ${usd(L.cur)}, 수출 ${usd(Lexp)} (수입이 수출의 ${Lexp ? nf(L.cur / Lexp, 0) : "–"}배) · 출처: ${SRC}</div>`, "",
        tops.length ? `${cname(tops[0].c)} ${nf(tops[0].share, 1)}% <span class="sub">상위 3개국 ${nf(top3, 0)}%</span>` : "") +
      card("최대 수입 품목", "HS 4단위 · 최근 12개월",
        `<div class="twin"><div><h4>금액 기준</h4><div id="bs-hu"></div></div><div><h4>물량 기준</h4><div id="bs-hk"></div></div></div><div class="foot">${per} · 출처: ${SRC}</div>`, "",
        byUsd.length ? `금액 1위 ${hname(byUsd[0].k)} <span class="sub">물량 1위 ${hname(byKg[0].k)}</span>` : "");
    C.hbars($("#bs-cty"), tops.map((t) => ({ label: cname(t.c), value: t.imp, text: `${nf(t.share, 1)}% · ${usd(t.imp)}`, onClick: () => { S.country = t.c; go("country"); } })));
    C.hbars($("#bs-hu"), byUsd.map((h) => ({ label: hname(h.k), value: h.usd, text: usd(h.usd) })));
    C.hbars($("#bs-hk"), byKg.map((h) => ({ label: hname(h.k), value: h.kg, text: ton(h.kg) })), { color: C.color(2) });
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
  function renderAll() { renderIntro(); renderVerdicts(); renderSupply(); renderDomestic(); renderPenetration(); renderPrice(); renderDrivers(); renderBasic(); renderAlerts(); }

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
      card(`공급국 집중도 HHI ${q("hhi")}`, "12개월 누적", `<div id="d-hhi"></div>`, "span-2",
        e.hhi[i] != null ? `HHI ${nf(e.hhi[i], 0)} <span class="sub">${e.hhi[i] >= 2500 ? "집중" : e.hhi[i] >= 1500 ? "보통" : "분산"} · 의존도 ${depGrade(tops[0] ? tops[0].share : 0, e.hhi[i]).label}</span>` : "") +

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
    C.lineChart($("#d-hhi"), { x: fx, series: [{ name: "HHI", values: e.hhi.filter((_, j) => keep[j]) }], yFmt: (v) => nf(v, 0), height: 180, xLabelFmt: xFmt, area: true });

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
          `<div class="pd">단가 ${pv ? pfmt("product", p.key)(pv) + " " + plabel("product", p.key) : "–"}${unitOf("product", p.key).unit === "m3" ? (unitOf("product", p.key).calibrated ? " (보정)" : " (잠정)") : ""}</div>${C.sparkline(vals.slice(-60))}`;
      }
      const badge = p.status === "partial" ? `<span class="badge">일부</span>` : p.since ? `<span class="badge">${p.since.slice(0, 4)}~</span>` : "";
      return `<button class="pcard ${disabled ? "disabled" : ""}" data-k="${p.key}" aria-pressed="${p.key === S.product}">` +
        `<div class="pn">${p.num}. ${badge}</div><div class="pt one-line">${p.name}</div>${body}</button>`;
    }).join("");
    host.innerHTML = `<div class="note" style="margin-bottom:8px">「목재의 지속가능한 이용에 관한 법률」 규격·품질 기준 15종 + CLT + LVL. 카드를 누르면 상세가 아래에 표시됨.</div>` +
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
    $("#s-2").innerHTML = `<table><thead><tr><th>수종</th><th>수입액</th><th>전년 대비</th><th>단가</th><th class="l">최대 공급국</th></tr></thead><tbody>` +
      rows.map((r) => `<tr class="click" data-k="${r.k}"><td>${r.k}</td><td>${usd(r.cur)}</td><td>${delta(r.cur, r.prev)}</td><td>${r.kg ? nf(r.cur / r.kg, 2) : "–"}</td><td class="l">${r.top ? cname(r.top.c) : "–"}</td></tr>`).join("") + `</tbody></table>`;
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
      kpi("평균 수입 단가", me.kg ? `${nf(me.imp / me.kg, 2)} <small>USD/kg</small>` : "–", "목재류 전체") +
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
    const crit = card("판정 기준과 레퍼런스", "config/criteria.yaml", `<div class="tbl-wrap"><table><thead><tr><th class="l">판정</th><th class="l">규칙</th><th class="l">레퍼런스</th></tr></thead><tbody>
        <tr><td class="l">수입 집중</td><td class="l" style="white-space:normal">취약: 연 수입액 100만 달러↑ + 특정국 50%↑ · 주의: HHI 2,500↑ · 100만 달러 미만 판정 제외 (최근 12개월)</td><td class="l" style="white-space:normal">${[R.motie2023, R.doj2010].filter(Boolean).join("<br>")}</td></tr>
        <tr><td class="l">수입 의존</td><td class="l" style="white-space:normal">수입침투율 = 수입 ÷ (생산 − 수출 + 수입). 원목 = 100 − 원목자급률. 최근 10년 Mann-Kendall 검정 p&lt;0.05면 상승/하락</td><td class="l" style="white-space:normal">${[R.oecd_stan, R.mann1945, R.kendall1975].filter(Boolean).join("<br>")}</td></tr>
        <tr><td class="l">가격 이상</td><td class="l" style="white-space:normal">IFPA = 0.4·z(분기 성장률) + 0.6·z(연간 성장률), z는 과거 같은 달 기준 표준화. ±0.5σ 정상 · 0.5~1σ 다소 높음 · 1σ↑ 비정상 (하락 대칭). 과거 3년↑, 월 수입액 100만 달러↑</td><td class="l" style="white-space:normal">${R.fao_ifpa || ""}</td></tr>
        <tr><td class="l">국내 공급 여력</td><td class="l" style="white-space:normal">수입 비중 = 수입량 ÷ (국내 생산 + 수입), 물량 기준, 5개년↑ Mann-Kendall · 가동률 = 연 생산량 ÷ 최대 생산가능량 · 대체 여력 = 생산량 × (100 ÷ 가동률 − 1) ÷ 수입량, 100% 선은 정의상 경계 · 등급 없이 수치만 제시</td><td class="l" style="white-space:normal">${[R.kfs_wus, R.oecd_stan].filter(Boolean).join("<br>")}</td></tr>
        <tr><td class="l">밀도 보정</td><td class="l" style="white-space:normal">같은 연도 관세청 수입 중량(kg) ÷ 실태조사 수입량(㎥)의 중앙값. 12개월 자료가 없으면 2023년 실태조사 단가(USD/㎥) ÷ 관세청 단가(USD/kg). 수입액 차이 ±10% 넘으면 범위 불일치로 제외</td><td class="l" style="white-space:normal">${R.kfs_wus || ""}</td></tr>
        <tr><td class="l">국산·수입 가격 수준</td><td class="l" style="white-space:normal">국산 ㎥ 가격 = 판매단가 ÷ (두께×폭×길이), 규격별 중앙값, 원/달러 2025년 연평균 · 수입 = 최근 12개월 CIF ㎥ 단가(보정 밀도) 및 2023년 신고 ㎥ 단가 · 수입 100만 달러 미만 비교 제외 · 판정 없음(참고)</td><td class="l" style="white-space:normal">${[R.kfcf2026, R.bok_fx].filter(Boolean).join("<br>")}</td></tr>
        <tr><td class="l">변화 요인</td><td class="l" style="white-space:normal">ΔV = Σ L(V₁,V₀)·ln(Q₁/Q₀) + Σ L(V₁,V₀)·ln(P₁/P₀), HS6 단위. 한 효과 60%↑면 '주도'</td><td class="l" style="white-space:normal">${R.ang2005 || ""}</td></tr>
      </tbody></table></div><div class="downloads" style="margin-top:10px">
        <a href="data/fig_supply_risk.csv" download>⬇ 수입 집중 판정</a><a href="data/fig_price_anomaly.csv" download>⬇ 가격 이상 판정</a>
        <a href="data/fig_decomposition.csv" download>⬇ 변화 요인 분해</a><a href="data/fig_structure.csv" download>⬇ 자급-수입 구조</a>
        <a href="data/fig_domestic_supply.csv" download>⬇ 국내 공급 여력</a><a href="data/kfcf_price.csv" download>⬇ 산림조합 판매단가 전사 자료</a><a href="data/wood_use_survey.csv" download>⬇ 목재이용실태조사 전사 자료</a></div>`, "span-2");
    host.innerHTML = `<div class="grid g-2">` + crit +
      card("데이터 내려받기", "CSV (엑셀에서 바로 열림)", `<div class="downloads">
        <a href="data/monthly_by_category.csv" download>⬇ 분류별 월별 수출입</a>
        <a href="data/yearly_by_category_country.csv" download>⬇ 분류별·국가별 연간</a>
        <a href="data/raw_last12m.csv" download>⬇ 최근 12개월 원자료 (국가×HSK10)</a></div>
        <div class="note">금액: 미국 달러 (수입 CIF, 수출 FOB) · 중량: 순중량 kg · 출처: ${m.source}</div>`) +
      card("용어", "", `<div class="note" style="line-height:1.8">
        <b>HHI(허핀달-허쉬만 지수)</b>: 공급국별 점유율(%) 제곱의 합. 1,500 미만 분산, 1,500~2,500 중간 집중, 2,500 이상 고집중.<br>
        <b>상위 3개국 점유율</b>: 수입액 상위 3개 공급국의 합계 비중.<br>
        <b>수입 단가</b>: 수입액 ÷ 수입량. 목재제품은 USD/㎥(보정 또는 추정), 연료형은 USD/t, 혼합 분류는 USD/kg. 품목 구성이 바뀌면 단가도 바뀌므로 해석에 주의.<br>
        <b>12개월 누적</b>: 해당 월을 포함한 직전 12개월 합계. 계절성을 없애고 추세를 볼 때 사용.<br>
        <b>HS 개정</b>: ${(m.hs_revisions || []).map((r) => `${r.name}(${ym(r.month)})`).join(", ")} — 개정 시점에 일부 품목의 코드가 나뉘거나 합쳐져 시계열이 끊길 수 있음.</div>`) +
      card("목재제품 분류 기준", "목재이용법 15종 + CLT + LVL", `<div class="tbl-wrap"><table><thead><tr><th>No.</th><th class="l">제품</th><th class="l">HS/HSK 코드</th><th class="l">비고</th></tr></thead><tbody>` +
        m.products.map((p) => `<tr><td>${p.num}</td><td class="l">${p.name}</td><td class="l">${(p.prefixes || []).join(", ") || "–"}</td><td class="l" style="white-space:normal">${p.note || ""}</td></tr>`).join("") + `</tbody></table></div>`, "span-2") +
      (() => { const U = m.units || { items: {} }; const nameOf = (k) => { const [ax, ky] = k.split(":");
          return ax === "heading" ? `${ky} ${m.headings[ky] || ""}` : ax === "product" ? (m.products.find((p) => p.key === ky) || {}).name : ax === "group" ? (m.groups.find((g) => g.key === ky) || {}).name : k; };
        const rows = Object.entries(U.items || {});
        return card("단가 단위와 기준 밀도", U.status === "confirmed" ? "확정" : "일부 실태조사 보정 · 나머지 잠정",
          `<div class="note" style="margin-bottom:8px">관세청 자료는 금액과 순중량(kg)만 있음. <b>톤 단가</b> = 수입액 ÷ 순중량 × 1,000 (액면, 환산 없음). <b>㎥ 단가</b> = 톤 단가 × 밀도(t/㎥).<br>
            밀도 출처: ① <b>보정</b> — 같은 연도 관세청 순중량 ÷ 목재이용실태조사 수입량(㎥, 임산물수출입통계)의 중앙값, 12개월 자료가 없으면 2023년 실태조사 수입 단가(USD/㎥) ÷ 관세청 단가(USD/kg). 관세청 수입액이 실태조사와 ±10% 넘게 다르면 범위 불일치로 제외 (산림청·한국임업진흥원 2024, 2023년 기준 목재이용실태조사) ② <b>잠정</b> — 대표값, FAO·ITTO·UNECE(2020) Forest product conversion factors와 대조 전.<br>
            가격 섹션의 ‘㎥ 환산 / 톤 액면’ 버튼으로 단위를 바꿔 볼 수 있음. 밀도가 10% 다르면 ㎥ 단가도 약 10% 달라지지만 오르내림(추세)과 이상 판정은 단위와 무관함.</div>` +
          `<div class="tbl-wrap"><table><thead><tr><th class="l">분류</th><th>단위</th><th>기준 밀도(t/㎥)</th><th class="l">기준 상태</th></tr></thead><tbody>` +
          rows.map(([k, v]) => `<tr><td class="l">${nameOf(k)}</td><td>${{ m3: "USD/㎥", t: "USD/t", kg: "USD/kg" }[v.unit]}</td><td>${v.density != null ? nf(v.density, 2) : "–"}</td><td class="l" style="white-space:normal">${v.basis || (v.unit === "t" ? "중량 그대로 (환산 없음)" : "")}</td></tr>`).join("") +
          `</tbody></table></div><div class="foot">표에 없는 품목군·수종 등 혼합 분류는 USD/kg로 표시 (원목 생재와 제품 기건이 섞여 밀도 하나로 환산하면 왜곡됨)</div>`, "span-2"); })() +
      card("품목군 분류 기준", "HS 코드 접두어 · 긴 코드 우선", `<div class="tbl-wrap"><table><thead><tr><th class="l">품목군</th><th class="l">HS 코드</th><th class="l">설명</th></tr></thead><tbody>` +
        m.groups.map((g) => `<tr><td class="l">${g.name}</td><td class="l" style="white-space:normal">${(g.prefixes || []).join(", ")}</td><td class="l" style="white-space:normal">${g.desc}</td></tr>`).join("") + `</tbody></table></div>`, "span-2") +
      `</div>`;
  }

  const TABS = { group: tabGroup, product: tabProduct, species: tabSpecies, country: tabCountry, data: tabData };

  function renderTab() {
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", t.dataset.tab === S.tab));
    $("#controls").classList.toggle("hidden", S.tab === "data" || S.tab === "country");
    TABS[S.tab]($("#panel"));
  }
  function go(tab) { S.tab = tab; $("#explore").open = true; setHash(); renderTab(); window.scrollTo({ top: $("#explore").offsetTop - 70, behavior: "smooth" }); }

  // URL 해시로 상태 공유 (강의 자료에 특정 화면 링크 가능)
  function setHash() {
    const p = new URLSearchParams({ tab: S.tab });
    if (S.tab === "group") p.set("k", S.group);
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
    renderAll();
    renderControls();
    document.querySelectorAll(".tab").forEach((t) => t.onclick = () => go(t.dataset.tab));
    renderTab();
    let w = window.innerWidth;
    window.addEventListener("resize", () => { if (Math.abs(window.innerWidth - w) > 40) { w = window.innerWidth; renderAll(); renderTab(); } });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { renderAll(); renderTab(); });
    $("#explore").addEventListener("toggle", () => { if ($("#explore").open) renderTab(); });
    if (location.hash) $("#explore").open = true;
  }
  init();
})();
