/* 목재류 무역통계 대시보드 — 화면 로직 */
(function () {
  const C = window.Charts;
  const $ = (s, r = document) => r.querySelector(s);
  const D = {};
  const S = {
    tab: "overview", measure: "imp_usd", agg: "r12", start: null,
    group: "raw", product: "p01", sp1: null, sp2: null, country: null,
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
  function seriesOf(e, dir, measure, agg, since) {
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
    else vals = U.map((v, i) => (v == null || !K[i] ? null : v / K[i]));
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
    price: "수입 단가 = 수입액 ÷ 순중량 (USD/kg). 운임·보험료가 포함된 도착 가격(CIF). 같은 품목도 수종·규격 구성이 바뀌면 달라짐.",
    r12: "12개월 누적: 해당 월까지 최근 12개월 합계. 계절에 따른 들쭉날쭉함을 없애고 추세를 볼 때 씀.",
    share: "점유율: 해당 품목 전체 수입액 중 그 나라가 차지하는 비율.",
    gap: "무역수지 = 수출액 − 수입액. 음수면 수입이 더 많음. 수입은 CIF, 수출은 FOB 기준.",
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
  function trendTitle(dir) {
    const a = { month: "월별", year: "연간", r12: "12개월 누적" }[S.agg];
    return `${a} ${MLABEL[S.measure]} (${UNIT[S.measure]})`;
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

  function renderTop() {
    const e = entry("total", "all"), i = iLast(), ms = months();
    const v0 = e.imp_usd[i], vy = i >= 12 ? e.imp_usd[i - 12] : null;
    const L = l12(e);
    const top = topSuppliers("total", "all", 1)[0];
    const h = e.hhi[i], t3 = e.top3[i];
    const g = depGrade(top ? top.share : 0, h || 0);
    $("#kpis").innerHTML =
      kpi(`${ym(ms[i])} 수입액`, usd(v0), `전년 동월 ${delta(v0, vy)}`) +
      kpi("최근 12개월 수입액", usd(L.cur), `직전 12개월 ${delta(L.cur, L.prev)}`) +
      kpi("최대 수입국", top ? `${cname(top.c)} <small>${nf(top.share, 1)}%</small>` : "–", top ? `최근 12개월 ${usd(top.imp)}` : "") +
      `<div class="card kpi"><div class="label one-line">공급국 의존도 ${q("dep")}</div><div class="value one-line">${h != null ? g.label : "–"}</div>` +
      `<div class="delta one-line">${h != null ? `HHI ${nf(h, 0)} · 상위 3개국 ${nf(t3, 0)}%` : "12개월 이상 데이터 필요"}</div></div>`;

    const ins = D.insights;
    // 눈여겨볼 3가지: 점수순, 같은 국가·같은 사건 중복 제거
    const seen = new Set(), picks = [];
    for (const a of ins.alerts) {
      const k = a.type === "price" ? `p:${a.cat}` : `${a.type}:${a.cnty}:${Math.sign(a.value)}`;
      if (seen.has(k)) continue;
      seen.add(k); picks.push(a);
      if (picks.length === 3) break;
    }
    const head = (a) => a.type === "price" ? `${a.cat} · 수입 단가 ${a.value > 0 ? "급등" : "급락"}`
      : a.type === "new" ? `${a.cat} · 신규 공급국 ${a.cnty_name}`
      : `${a.cat} · ${a.cnty_name} 점유율 ${a.value > 0 ? "급증" : "급감"}`;
    const det = (a) => a.type === "price" ? `${nf(a.from, 2)} → ${nf(a.to, 2)} USD/kg (전년 동월 대비 ${a.value > 0 ? "+" : ""}${nf(a.value, 1)}%)`
      : a.type === "new" ? `점유율 ${nf(a.value, 1)}% · 직전 12개월 수입 없음`
      : `${nf(a.from, 1)}% → ${nf(a.to, 1)}% (전월 대비 ${a.value > 0 ? "+" : ""}${nf(a.value, 1)}%p)`;
    const rest = ins.alerts.filter((a) => !picks.includes(a));
    $("#summary").innerHTML =
      card(`이번 달 요약 <span class="badge" style="margin-left:6px">${ym(ins.month)}</span>`, "자동 작성",
        `<ol>${ins.summary.filter((t) => !t.startsWith("이번 달 주의")).map((t) => `<li>${t}</li>`).join("")}</ol>` +
        `<div class="foot">출처: ${SRC} · 원인 판단은 포함하지 않음</div>`) +
      card("이번 달 눈여겨볼 3가지", `${ym(ins.month)} 기준`,
        picks.length ? `<div class="notables">${picks.map((a, j) =>
          `<button class="notable" data-axis="${a.axis}" data-key="${a.key}"><span class="n">${j + 1}</span>` +
          `<span class="h">${head(a)}</span><span class="d">${det(a)}</span></button>`).join("")}</div>` +
          (rest.length ? `<details class="more"><summary>나머지 ${rest.length}건 보기</summary><ul class="alerts">${rest.map((a) =>
            `<li><span class="tag">${{ share: "점유율", price: "단가", new: "신규국" }[a.type]}</span><span>${a.text}</span></li>`).join("")}</ul></details>` : "")
          : `<div class="empty">기준(점유율 ±5%p, 단가 ±20%, 신규 공급국 1%↑)을 넘는 변화 없음</div>`);
    $("#summary").querySelectorAll(".notable").forEach((b) => b.onclick = () => openDetail(b.dataset.axis, b.dataset.key));
  }

  function openDetail(axis, key) {
    if (axis === "group") { S.group = key; go("group"); }
    else if (axis === "product") { S.product = key; go("product"); }
    else if (axis === "species2") { S.sp2 = key; go("species"); }
    else go("overview");
  }

  // ── 한눈에 보기 ─────────────────────────────────────────
  function renderStory() {
    const per = periodL12();
    const foot = (extra = "") => `<div class="foot">${extra ? extra + " · " : ""}출처: ${SRC}</div>`;
    const tot = entry("total", "all");
    const Ltot = l12(tot);

    // 1) 최대 수입국
    const tops = topSuppliers("total", "all", 8);
    const top3 = sum(tops.slice(0, 3).map((t) => t.share));
    // 2) 최대 수입 품목 (HS 4단위)
    const heads = Object.entries(D.series.series.heading || {}).map(([k, e]) => ({ k, usd: l12(e).cur || 0, kg: l12(e, "imp_kg").cur || 0 }));
    const byUsd = [...heads].sort((a, b) => b.usd - a.usd).slice(0, 5);
    const byKg = [...heads].sort((a, b) => b.kg - a.kg).slice(0, 5);
    const SHORT = { "4401": "연료재·펠릿·칩", "4402": "목탄", "4403": "원목", "4407": "제재목", "4408": "단판", "4409": "마루재·성형목재",
      "4410": "PB·OSB", "4411": "섬유판(MDF)", "4412": "합판·LVL", "4415": "팔레트·포장재", "4418": "건축용 목제품", "4419": "주방용품", "4421": "기타 목제품" };
    const hname = (k) => SHORT[k] || D.meta.headings[k] || k;
    // 3) 수출입 격차
    const Lexp = l12(tot, "exp_usd").cur;
    const ratio = Lexp ? Ltot.cur / Lexp : null;
    // 4) 증감 품목 (품목군, 최근 12개월 vs 직전 12개월)
    const chg = D.meta.groups.map((g) => { const ge = entry("group", g.key); if (!ge) return null; const L = l12(ge);
      return L.prev ? { name: g.name, key: g.key, p: (L.cur / L.prev - 1) * 100, cur: L.cur } : null; })
      .filter(Boolean).sort((a, b) => b.p - a.p);
    // 5) 수입 단가 추이 (12개월 평균 단가 지수)
    const pitems = [["heading", "4403", "원목"], ["heading", "4407", "제재목"], ["product", "p06", "합판"], ["product", "p11", "목재펠릿"]]
      .filter(([a, k]) => entry(a, k));
    const ms = months();
    const r12p = (e) => ms.map((_, i) => { if (i < 11) return null; const u = sum(e.imp_usd.slice(i - 11, i + 1)), k = sum(e.imp_kg.slice(i - 11, i + 1)); return k ? u / k : null; });
    const pser = pitems.map(([a, k, n]) => { const v = r12p(entry(a, k)); const b = v.find((x) => x != null);
      return { name: n, raw: v, values: v.map((x) => (x == null || !b ? null : (x / b) * 100)) }; });
    const yoyP = pser.map((p) => { const i = ms.length - 1; const a = p.raw[i], b = p.raw[i - 12]; return { name: p.name, now: a, p: a && b ? (a / b - 1) * 100 : null }; });
    const upMost = [...yoyP].filter((x) => x.p != null).sort((a, b) => b.p - a.p)[0];
    // 6) 수입의존도
    const sup = D.supply;
    const depKeys = [["heading", "4403", "원목"], ["heading", "4407", "제재목"], ["product", "p06", "합판"], ["product", "p11", "목재펠릿"],
      ["product", "p12", "목재칩"], ["product", "p08", "섬유판(MDF 등)"], ["product", "p07", "파티클보드"], ["product", "p09", "OSB"],
      ["product", "p05", "집성재"], ["product", "p16", "CLT"], ["product", "p17", "LVL"], ["product", "p15", "목탄"]];
    const deps = depKeys.map(([a, k, n]) => { const e = entry(a, k); if (!e) return null; const t = topSuppliers(a, k, 3);
      if (!t.length) return null; const h = e.hhi[ms.length - 1]; const t3 = sum(t.map((x) => x.share));
      return { a, k, n, imp: l12(e).cur, top: t[0], t3, h, g: depGrade(t[0].share, h || 0) }; }).filter(Boolean);
    const rank = { hi: 0, mid: 1, lo: 2 };
    deps.sort((x, y) => rank[x.g.cls] - rank[y.g.cls] || y.top.share - x.top.share);
    const nHi = deps.filter((d) => d.g.cls === "hi").length;

    let logLead = "", logNote = "";
    if (sup) {
      const yrs = sup.years, dep = sup.log_ssr.map((v) => (v == null ? null : +(100 - v).toFixed(1)));
      const li = dep.length - 1, i16 = yrs.indexOf("2016");
      logLead = `원목 수입의존도 ${nf(dep[li], 1)}% <span class="sub">${yrs[li]}년 기준${i16 >= 0 ? `, ${yrs[i16]}년 ${nf(dep[i16], 1)}%에서 ${dep[li] < dep[i16] ? "하락" : "상승"}` : ""}</span>`;
      const w = sup.wood_ssr.map((v, j) => [yrs[j], v]).filter(([, v]) => v != null).pop();
      if (w) logNote = `목재 전체 자급률은 ${w[0]}년 ${nf(w[1], 1)}% (수입의존도 약 ${nf(100 - w[1], 0)}%)`;
    }

    $("#story").innerHTML = `<div class="grid g-2">` +
      card(`최대 수입국 ${q("share")}`, `최근 12개월 수입액`, `<div id="st-cty"></div>` + foot(per), "",
        tops.length ? `${cname(tops[0].c)} ${nf(tops[0].share, 1)}% <span class="sub">상위 3개국 ${nf(top3, 0)}%</span>` : "") +
      card("최대 수입 품목", "HS 4단위 · 최근 12개월",
        `<div class="twin"><div><h4>금액 기준</h4><div id="st-hu"></div></div><div><h4>물량 기준</h4><div id="st-hk"></div></div></div>` + foot(per), "",
        byUsd.length ? `금액 1위 ${hname(byUsd[0].k)} <span class="sub">물량 1위 ${hname(byKg[0].k)}</span>` : "") +
      card(`수출입 격차 ${q("gap")}`, "연간 · 백만 달러", `<div id="st-gap"></div>` + foot(), "",
        ratio ? `수입이 수출의 ${nf(ratio, 0)}배 <span class="sub">무역수지 ${usd(Lexp - Ltot.cur)} (최근 12개월)</span>` : "") +
      card(`증감 품목 ${q("r12")}`, "최근 12개월 vs 직전 12개월", `<div id="st-chg"></div>` + foot(per), "",
        chg.length ? `증가 1위 ${chg[0].name} ${chg[0].p > 0 ? "+" : ""}${nf(chg[0].p, 1)}% <span class="sub">감소 1위 ${chg[chg.length - 1].name} ${nf(chg[chg.length - 1].p, 1)}%</span>` : "직전 12개월 비교에 24개월 이상 데이터 필요") +
      card(`수입 단가 추이 ${q("idx")}`, "12개월 평균 단가 지수 (시작=100)", `<div id="st-price"></div>` + foot("단가 = 수입액÷순중량(CIF)"), "",
        upMost ? `전년 대비 상승 폭 최대 ${upMost.name} ${upMost.p > 0 ? "+" : ""}${nf(upMost.p, 1)}% <span class="sub">${nf(upMost.now, 2)} USD/kg</span>` : "") +
      card(`원목 수입의존도 ${q("logdep")}`, "연간 · %", `<div id="st-log"></div>` +
        `<div class="foot">${logNote ? logNote + " · " : ""}출처: 산림청 목재수급통계</div>`, "", logLead) +
      card(`공급국 의존도 ${q("dep")}${q("hhi")}`, "주요 품목 · 최근 12개월",
        `<div class="tbl-wrap"><table><thead><tr><th class="l">품목</th><th>수입액</th><th class="l">최대 공급국</th><th>상위 3개국</th><th>HHI</th><th>의존도</th></tr></thead><tbody>` +
        deps.map((d) => `<tr class="click" data-axis="${d.a}" data-key="${d.k}"><td class="l">${d.n}</td><td>${usd(d.imp)}</td>` +
          `<td class="l">${cname(d.top.c)} ${nf(d.top.share, 0)}%</td><td>${nf(d.t3, 0)}%</td><td>${d.h != null ? nf(d.h, 0) : "–"}</td>` +
          `<td><span class="grade ${d.g.cls}">${d.g.label}</span></td></tr>`).join("") +
        `</tbody></table></div>` + foot(`${per} · 행을 누르면 상세`), "span-2",
        `의존도 높음 ${nHi}개 품목 <span class="sub">/ 주요 ${deps.length}개 품목 중 (특정국 50%↑ 또는 HHI 2,500↑)</span>`) +
      `</div>`;

    C.hbars($("#st-cty"), tops.map((t) => ({ label: cname(t.c), value: t.imp, text: `${nf(t.share, 1)}% · ${usd(t.imp)}`,
      onClick: () => { S.country = t.c; go("country"); } })));
    C.hbars($("#st-hu"), byUsd.map((h) => ({ label: hname(h.k), value: h.usd, text: usd(h.usd) })));
    C.hbars($("#st-hk"), byKg.map((h) => ({ label: hname(h.k), value: h.kg, text: ton(h.kg) })), { color: C.color(2) });
    const yu = seriesOf(tot, "imp", "imp_usd", "year"), ye = seriesOf(tot, "exp", "imp_usd", "year");
    C.barChart($("#st-gap"), { x: yu.x, stacked: false, series: [{ name: "수입", values: yu.v }, { name: "수출", values: ye.v }],
      yFmt: (v) => nf(v, 0), tipFmt: (v) => nf(v, 1) + "백만 달러", height: 210 });
    const mx = Math.max(...chg.map((c) => Math.abs(c.p)), 1);
    $("#st-chg").innerHTML = `<div class="dbars">${chg.map((c) =>
      `<div class="db" style="cursor:pointer" data-k="${c.key}"><span class="nm">${c.name}</span><span class="track">` +
      `<i class="${c.p >= 0 ? "pos" : "neg"}" style="width:${(Math.abs(c.p) / mx) * 50}%"></i></span>` +
      `<span class="vl ${c.p >= 0 ? "up" : "down"}">${c.p > 0 ? "+" : ""}${nf(c.p, 1)}%</span></div>`).join("")}</div>`;
    $("#st-chg").querySelectorAll(".db").forEach((d) => d.onclick = () => openDetail("group", d.dataset.k));
    const pi = pser.length ? pser[0].values.findIndex((v) => v != null) : 0;
    C.lineChart($("#st-price"), { x: ms.slice(pi), series: pser.map((p) => ({ name: p.name, values: p.values.slice(pi) })),
      yFmt: (v) => nf(v, 0), tipFmt: (v) => nf(v, 1), yMin0: false, height: 220, xLabelFmt: xFmt });
    if (sup) {
      const dep = sup.log_ssr.map((v) => (v == null ? null : 100 - v));
      C.lineChart($("#st-log"), { x: sup.years, series: [{ name: "원목 수입의존도", values: dep }], yFmt: (v) => nf(v, 0) + "%",
        tipFmt: (v) => nf(v, 1) + "%", height: 220, area: true });
    } else $("#st-log").innerHTML = `<div class="empty">자료 없음</div>`;
    $("#story").querySelectorAll("tr[data-axis]").forEach((tr) => tr.onclick = () => {
      const a = tr.dataset.axis, k = tr.dataset.key;
      if (a === "heading") { S.group = k === "4403" ? "raw" : "primary"; go("group"); } else openDetail(a, k);
    });
  }

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
    const p0 = price(L.cur, Lk.cur), pp = price(L.prev, Lk.prev);
    const note = [grp && grp.desc, prod && prod.note, since && `${ym(since)} 이전에는 별도 HS 코드가 없어 값을 표시하지 않음`, extraNote].filter(Boolean);
    host.innerHTML =
      `<div class="detail-head"><h2 class="one-line">${labelOf(axis, key)}</h2>${prod ? `<span class="badge">목재제품 ${prod.num}</span>` : ""}</div>` +
      (note.length ? `<div class="note box">${note.join(" · ")}</div>` : "") +
      `<div class="grid g-5">` +
      kpi(`${ym(months()[i])} 수입액`, usd(e.imp_usd[i]), `전년 동월 ${delta(e.imp_usd[i], i >= 12 ? e.imp_usd[i - 12] : null)}`) +
      kpi("최근 12개월 수입액", usd(L.cur), `직전 대비 ${delta(L.cur, L.prev)}`) +
      kpi("최근 12개월 수입량", ton(Lk.cur), `직전 대비 ${delta(Lk.cur, Lk.prev)}`) +
      kpi("평균 수입 단가", p0 ? `${nf(p0, 2)} <small>USD/kg</small>` : "–", `직전 대비 ${delta(p0, pp)}`) +
      kpi("최대 공급국", tops[0] ? `${cname(tops[0].c)} <small>${nf(tops[0].share, 1)}%</small>` : "–", e.hhi[i] != null ? `HHI ${nf(e.hhi[i], 0)}` : "") +
      `</div><div class="grid g-2" style="margin-top:12px">` +
      card(`수입·수출 추이`, trendTitle(), `<div id="d-trend"></div>`, "span-2",
        L.prev ? `최근 12개월 수입 ${usd(L.cur)} <span class="sub">직전 12개월 대비 ${delta(L.cur, L.prev)}</span>` : `최근 12개월 수입 ${usd(L.cur)}`) +
      card(`주요 공급국 ${q("share")}`, "최근 12개월 · 점유율 · 전년 대비", `<div id="d-sup"></div>`, "",
        tops[0] ? `1위 ${cname(tops[0].c)} ${nf(tops[0].share, 1)}% <span class="sub">상위 3개국 ${nf(sum(tops.slice(0, 3).map((t) => t.share)), 0)}%</span>` : "") +
      card(`공급국별 수입 단가 ${q("price")}`, "연간 · 상위 5개국 · USD/kg", `<div id="d-price"></div>`, "", "<span id='d-price-lead'></span>") +
      card(`공급국 집중도 HHI ${q("hhi")}`, "12개월 누적", `<div id="d-hhi"></div>`, "",
        e.hhi[i] != null ? `HHI ${nf(e.hhi[i], 0)} <span class="sub">${e.hhi[i] >= 2500 ? "집중" : e.hhi[i] >= 1500 ? "보통" : "분산"} · 의존도 ${depGrade(tops[0] ? tops[0].share : 0, e.hhi[i]).label}</span>` : "") +
      card("상위 3개국 점유율", "12개월 누적 · %", `<div id="d-top3"></div>`, "",
        e.top3[i] != null ? `상위 3개국이 ${nf(e.top3[i], 0)}% 공급` : "") +
      `</div>`;

    const a = seriesOf(e, "imp", S.measure, S.agg, since), b = seriesOf(e, "exp", S.measure, S.agg, since);
    C.lineChart($("#d-trend"), { x: a.x, series: [{ name: "수입", values: a.v }, { name: "수출", values: b.v }],
      yFmt: yFmt(S.measure), markers: S.agg === "year" ? [] : revMarkers(a.x), xLabelFmt: xFmt, height: 260 });
    C.hbars($("#d-sup"), tops.map((t) => ({ label: cname(t.c), value: t.imp,
      text: `${usd(t.imp)} · ${nf(t.share, 1)}% · ${t.prev ? ((t.imp / t.prev - 1) * 100 >= 0 ? "▲" : "▼") + nf(Math.abs((t.imp / t.prev - 1) * 100), 0) + "%" : "신규"}`,
      onClick: () => { S.country = t.c; go("country"); } })));
    // 국가별 단가 (연간)
    const rows = (D.countries[axis] || {})[key] || {};
    const top5 = tops.slice(0, 5).map((t) => t.c);
    const years = [...new Set(months().map((m) => m.slice(0, 4)))].filter((y) => !S.start || y >= S.start);
    const pSeries = top5.map((c) => ({ name: cname(c),
      values: years.map((y) => { const r = rows[c] && rows[c].y[y]; return r && r[1] ? r[0] / r[1] : null; }) }));
    C.lineChart($("#d-price"), { x: years, series: pSeries, yFmt: (v) => nf(v, 2), height: 220, yMin0: false });
    const lastP = pSeries.map((p) => ({ n: p.name, v: p.values[p.values.length - 1] })).filter((x) => x.v != null).sort((a, b) => b.v - a.v);
    if (lastP.length > 1) $("#d-price-lead").innerHTML = `${years[years.length - 1]}년 최고 ${lastP[0].n} ${nf(lastP[0].v, 2)} <span class="sub">최저 ${lastP[lastP.length - 1].n} ${nf(lastP[lastP.length - 1].v, 2)} USD/kg</span>`;
    const ms = months(), keep = ms.map((m) => !S.start || m.slice(0, 4) >= S.start);
    const fx = ms.filter((_, j) => keep[j]);
    C.lineChart($("#d-hhi"), { x: fx, series: [{ name: "HHI", values: e.hhi.filter((_, j) => keep[j]) }], yFmt: (v) => nf(v, 0), height: 180, xLabelFmt: xFmt, area: true });
    C.lineChart($("#d-top3"), { x: fx, series: [{ name: "상위 3개국", values: e.top3.filter((_, j) => keep[j]), color: C.color(2) }], yFmt: (v) => nf(v, 0) + "%", height: 180, xLabelFmt: xFmt });
  }

  // ── 탭 ─────────────────────────────────────────────────
  function tabOverview(host) {
    const e = entry("total", "all");
    const groups = D.meta.groups;
    host.innerHTML = `<div class="grid g-2">` +
      card("목재류 수입·수출 추이", trendTitle(), `<div id="o-trend"></div>`, "span-2",
        `최근 12개월 수입 ${usd(l12(e).cur)} <span class="sub">직전 12개월 대비 ${delta(l12(e).cur, l12(e).prev)}</span>`) +
      card("품목군별 수입 구성", `연간 · ${S.measure === "imp_kg" ? "천 톤" : "백만 달러"}`, `<div id="o-groups"></div>`, "", "<span id='o-groups-lead'></span>") +
      card("가공 단계별 수입 비중", "연간 · 원자재→1차 가공→보드→공학목재", `<div id="o-stage"></div>`, "", "<span id='o-stage-lead'></span>") +
      card(`주요 공급국 ${q("share")}`, "최근 12개월 · 클릭하면 국가 상세", `<div id="o-sup"></div>`) +
      card(`공급국 집중도 ${q("hhi")}`, "12개월 누적 HHI", `<div id="o-hhi"></div>`, "",
        e.hhi[iLast()] != null ? `HHI ${nf(e.hhi[iLast()], 0)} <span class="sub">${e.hhi[iLast()] >= 2500 ? "집중" : e.hhi[iLast()] >= 1500 ? "보통" : "분산"}</span>` : "") +
      card("품목군 요약", "최근 12개월 · 클릭하면 상세", `<div class="tbl-wrap" id="o-tbl"></div>`, "span-2") +
      `</div>`;
    const a = seriesOf(e, "imp", S.measure, S.agg), b = seriesOf(e, "exp", S.measure, S.agg);
    C.lineChart($("#o-trend"), { x: a.x, series: [{ name: "수입", values: a.v }, { name: "수출", values: b.v }],
      yFmt: yFmt(S.measure), markers: S.agg === "year" ? [] : revMarkers(a.x), xLabelFmt: xFmt, height: 270 });
    const m2 = S.measure === "price" ? "imp_usd" : S.measure;
    const yr = (k) => seriesOf(entry("group", k) || { imp_usd: [], imp_kg: [], exp_usd: [], exp_kg: [] }, "imp", m2, "year");
    const base = yr(groups[0].key);
    C.barChart($("#o-groups"), { x: base.x, stacked: true,
      series: groups.map((g) => ({ name: g.name, values: entry("group", g.key) ? yr(g.key).v : base.x.map(() => 0) })),
      yFmt: (v) => nf(v, 0), tipFmt: (v) => nf(v, 1), height: 250 });
    const st = D.meta.processing_stages;
    const stSeries = st.map((k) => ({ name: labelOf("group", k), values: entry("group", k) ? yr(k).v : base.x.map(() => 0) }));
    C.barChart($("#o-stage"), { x: base.x, percent: true, series: stSeries, tipFmt: (v) => nf(v, 1), height: 250 });
    // 결론 문장: 최근 연도 최대 품목군, 가공 단계 중 원자재 비중 변화
    const gl = groups.map((g, j) => ({ n: g.name, v: entry("group", g.key) ? yr(g.key).v.slice(-1)[0] || 0 : 0 })).sort((a, b) => b.v - a.v);
    const gsum = sum(gl.map((x) => x.v));
    if (gsum) $("#o-groups-lead").innerHTML = `${base.x.slice(-1)[0]} 최대 ${gl[0].n} ${nf((gl[0].v / gsum) * 100, 0)}% <span class="sub">2위 ${gl[1].n} ${nf((gl[1].v / gsum) * 100, 0)}%</span>`;
    const shareAt = (j) => { const t = sum(stSeries.map((s2) => s2.values[j] || 0)); return t ? ((stSeries[0].values[j] || 0) / t) * 100 : null; };
    const a0 = shareAt(0), a1 = shareAt(base.x.length - 1);
    if (a0 != null && a1 != null) $("#o-stage-lead").innerHTML = `원자재 비중 ${base.x[0]} ${nf(a0, 0)}% → ${base.x.slice(-1)[0]} ${nf(a1, 0)}%`;
    const tops = topSuppliers("total", "all", 10);
    C.hbars($("#o-sup"), tops.map((t) => ({ label: cname(t.c), value: t.imp,
      text: `${usd(t.imp)} · ${nf(t.share, 1)}%`, onClick: () => { S.country = t.c; go("country"); } })));
    const ms = months().filter((m) => !S.start || m.slice(0, 4) >= S.start);
    const off = months().length - ms.length;
    C.lineChart($("#o-hhi"), { x: ms, series: [{ name: "HHI", values: e.hhi.slice(off) }],
      yFmt: (v) => nf(v, 0), height: 220, xLabelFmt: xFmt, area: true });
    // 요약표
    const tot = l12(e).cur;
    const rows = groups.map((g) => {
      const ge = entry("group", g.key);
      if (!ge) return `<tr><td>${g.name}</td><td colspan="6" class="l">실적 없음</td></tr>`;
      const L = l12(ge), K = l12(ge, "imp_kg"), t = topSuppliers("group", g.key, 1)[0];
      return `<tr class="click" data-g="${g.key}"><td>${g.name}</td><td>${usd(L.cur)}</td><td>${delta(L.cur, L.prev)}</td>` +
        `<td>${tot ? nf((L.cur / tot) * 100, 1) + "%" : "–"}</td><td>${ton(K.cur)}</td><td>${K.cur ? nf(L.cur / K.cur, 2) : "–"}</td>` +
        `<td class="l">${t ? `${cname(t.c)} ${nf(t.share, 0)}%` : "–"}</td></tr>`;
    }).join("");
    $("#o-tbl").innerHTML = `<table><thead><tr><th>품목군</th><th>수입액</th><th>전년 대비</th><th>비중</th><th>수입량</th><th>단가(USD/kg)</th><th class="l">최대 공급국</th></tr></thead><tbody>${rows}</tbody></table>`;
    $("#o-tbl").querySelectorAll("tr[data-g]").forEach((tr) => tr.onclick = () => { S.group = tr.dataset.g; go("group"); });
  }

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
        body = `<div class="pv num">${usd(L.cur)}</div><div class="pd">최근 12개월 · ${delta(L.cur, L.prev)}</div>${C.sparkline(vals.slice(-60))}`;
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
    $("#c-prod").innerHTML = prow.length ? `<table><thead><tr><th>제품</th><th>수입액</th><th>수입량</th><th>단가(USD/kg)</th><th>점유율</th></tr></thead><tbody>` +
      prow.map((x) => `<tr class="click" data-k="${x.p.key}"><td>${x.p.num}. ${x.p.name}</td><td>${usd(x.imp)}</td><td>${ton(x.kg)}</td><td>${x.kg ? nf(x.imp / x.kg, 2) : "–"}</td><td>${nf(x.share, 1)}%</td></tr>`).join("") + `</tbody></table>`
      : `<div class="empty">목재제품 수입 실적 없음</div>`;
    $("#c-prod").querySelectorAll("tr[data-k]").forEach((tr) => tr.onclick = () => { S.product = tr.dataset.k; go("product"); });
  }

  function tabData(host) {
    const m = D.meta;
    host.innerHTML = `<div class="grid g-2">` +
      card("데이터 내려받기", "CSV (엑셀에서 바로 열림)", `<div class="downloads">
        <a href="data/monthly_by_category.csv" download>⬇ 분류별 월별 수출입</a>
        <a href="data/yearly_by_category_country.csv" download>⬇ 분류별·국가별 연간</a>
        <a href="data/raw_last12m.csv" download>⬇ 최근 12개월 원자료 (국가×HSK10)</a></div>
        <div class="note">금액: 미국 달러 (수입 CIF, 수출 FOB) · 중량: 순중량 kg · 출처: ${m.source}</div>`) +
      card("용어", "", `<div class="note" style="line-height:1.8">
        <b>HHI(허핀달-허쉬만 지수)</b>: 공급국별 점유율(%) 제곱의 합. 1,500 미만 분산, 1,500~2,500 중간 집중, 2,500 이상 고집중.<br>
        <b>상위 3개국 점유율</b>: 수입액 상위 3개 공급국의 합계 비중.<br>
        <b>수입 단가</b>: 수입액 ÷ 순중량 (USD/kg). 품목 구성이 바뀌면 단가도 바뀌므로 해석에 주의.<br>
        <b>12개월 누적</b>: 해당 월을 포함한 직전 12개월 합계. 계절성을 없애고 추세를 볼 때 사용.<br>
        <b>HS 개정</b>: ${(m.hs_revisions || []).map((r) => `${r.name}(${ym(r.month)})`).join(", ")} — 개정 시점에 일부 품목의 코드가 나뉘거나 합쳐져 시계열이 끊길 수 있음.</div>`) +
      card("목재제품 분류 기준", "목재이용법 15종 + CLT + LVL", `<div class="tbl-wrap"><table><thead><tr><th>No.</th><th class="l">제품</th><th class="l">HS/HSK 코드</th><th class="l">비고</th></tr></thead><tbody>` +
        m.products.map((p) => `<tr><td>${p.num}</td><td class="l">${p.name}</td><td class="l">${(p.prefixes || []).join(", ") || "–"}</td><td class="l" style="white-space:normal">${p.note || ""}</td></tr>`).join("") + `</tbody></table></div>`, "span-2") +
      card("품목군 분류 기준", "HS 코드 접두어 · 긴 코드 우선", `<div class="tbl-wrap"><table><thead><tr><th class="l">품목군</th><th class="l">HS 코드</th><th class="l">설명</th></tr></thead><tbody>` +
        m.groups.map((g) => `<tr><td class="l">${g.name}</td><td class="l" style="white-space:normal">${(g.prefixes || []).join(", ")}</td><td class="l" style="white-space:normal">${g.desc}</td></tr>`).join("") + `</tbody></table></div>`, "span-2") +
      `</div>`;
  }

  const TABS = { overview: tabOverview, group: tabGroup, product: tabProduct, species: tabSpecies, country: tabCountry, data: tabData };

  function renderTab() {
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", t.dataset.tab === S.tab));
    $("#controls").classList.toggle("hidden", S.tab === "data" || S.tab === "country");
    TABS[S.tab]($("#panel"));
  }
  function go(tab) { S.tab = tab; setHash(); renderTab(); window.scrollTo({ top: $("#explore").offsetTop - 70, behavior: "smooth" }); }

  // URL 해시로 상태 공유 (강의 자료에 특정 화면 링크 가능)
  function setHash() {
    const p = new URLSearchParams({ tab: S.tab });
    if (S.tab === "group") p.set("k", S.group);
    if (S.tab === "product") p.set("k", S.product);
    if (S.tab === "species" && S.sp2) p.set("k", S.sp2);
    if (S.tab === "country" && S.country) p.set("k", S.country);
    history.replaceState(null, "", "#" + p.toString());
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const t = p.get("tab"), k = p.get("k");
    if (t && TABS[t]) S.tab = t;
    if (k) ({ group: () => (S.group = k), product: () => (S.product = k), species: () => (S.sp2 = k), country: () => (S.country = k) }[S.tab] || (() => {}))();
  }

  async function init() {
    const get = (f) => fetch(`data/${f}?v=${window.BUILD_ID || ""}`).then((r) => (r.ok ? r.json() : null));
    const [meta, series, countries, insights, supply] = await Promise.all(["meta.json", "series.json", "countries.json", "insights.json", "supply.json"].map(get));
    D.meta = meta || { status: "collecting" };
    renderHeader();
    if (!series || !series.months || !series.months.length) {
      $("#main").innerHTML = `<div class="loading">첫 데이터를 수집하는 중임. 수집이 끝나면 자동으로 표시됨.</div>`;
      return;
    }
    Object.assign(D, { series, countries, insights, supply });
    const years = [...new Set(series.months.map((m) => m.slice(0, 4)))];
    S.start = years[0];
    readHash();
    renderTop();
    renderStory();
    renderControls();
    document.querySelectorAll(".tab").forEach((t) => t.onclick = () => go(t.dataset.tab));
    renderTab();
    let w = window.innerWidth;
    window.addEventListener("resize", () => { if (Math.abs(window.innerWidth - w) > 40) { w = window.innerWidth; renderStory(); renderTab(); } });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { renderStory(); renderTab(); });
  }
  init();
})();
