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
      x = ys.map((y, j) => (j === ys.length - 1 && lastM < 12 ? `${y}(~${lastM}월)` : y));
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
  function card(title, hint, body = "", cls = "") {
    return `<div class="card ${cls}"><div class="card-head"><h3 class="one-line">${title}</h3>${hint ? `<span class="hint">${hint}</span>` : ""}</div>${body}</div>`;
  }
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
    $("#kpis").innerHTML =
      kpi(`${ym(ms[i])} 수입액`, usd(v0), `전년 동월 ${delta(v0, vy)}`) +
      kpi("최근 12개월 수입액", usd(L.cur), `직전 대비 ${delta(L.cur, L.prev)}`) +
      kpi("최대 공급국 (최근 12개월)", top ? `${cname(top.c)} <small>${nf(top.share, 1)}%</small>` : "–", top ? usd(top.imp) : "") +
      kpi("공급국 집중도 HHI", h != null ? nf(h, 0) : "–", t3 != null ? `상위 3개국 ${nf(t3, 1)}% · ${h >= 2500 ? "고집중" : h >= 1500 ? "중간 집중" : "분산"}` : "12개월 이상 데이터 필요");
    const ins = D.insights;
    $("#summary").innerHTML =
      card(`이번 달 요약 <span class="badge">${ym(ins.month)}</span>`, "규칙 기반 자동 작성",
        `<ol>${ins.summary.map((s) => `<li>${s}</li>`).join("")}</ol>`) +
      card("주의 표시", `${ins.alerts.length}건`,
        ins.alerts.length ? `<ul class="alerts">${ins.alerts.map((a) =>
          `<li><span class="tag">${{ share: "점유율", price: "단가", new: "신규국" }[a.type]}</span><span>${a.text}</span></li>`).join("")}</ul>`
          : `<div class="empty">기준(점유율 ±5%p, 단가 ±20%, 신규 공급국 1%↑)을 넘는 변화 없음</div>`);
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
      card(`수입·수출 추이`, trendTitle(), `<div id="d-trend"></div>`, "span-2") +
      card("주요 공급국 (최근 12개월 수입액)", "점유율 · 전년 대비", `<div id="d-sup"></div>`) +
      card("공급국별 수입 단가 (연간, 상위 5개국)", "USD/kg", `<div id="d-price"></div>`) +
      card("공급국 집중도 HHI (12개월 누적)", "1,500↑ 중간 · 2,500↑ 고집중", `<div id="d-hhi"></div>`) +
      card("상위 3개국 점유율 (12개월 누적)", "%", `<div id="d-top3"></div>`) +
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
    C.lineChart($("#d-price"), { x: years, series: top5.map((c) => ({ name: cname(c),
      values: years.map((y) => { const r = rows[c] && rows[c].y[y]; return r && r[1] ? r[0] / r[1] : null; }) })),
      yFmt: (v) => nf(v, 2), height: 220, yMin0: false });
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
      card("목재류 수입·수출 추이", trendTitle(), `<div id="o-trend"></div>`, "span-2") +
      card("품목군별 수입 구성 (연간)", S.measure === "imp_kg" ? "천 톤" : "백만 달러", `<div id="o-groups"></div>`) +
      card("가공 단계별 수입 비중 (연간)", "원자재→1차 가공→보드→공학목재", `<div id="o-stage"></div>`) +
      card("주요 공급국 (최근 12개월)", "클릭하면 국가 상세", `<div id="o-sup"></div>`) +
      card("공급국 집중도 (12개월 누적)", "HHI", `<div id="o-hhi"></div>`) +
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
    C.barChart($("#o-stage"), { x: base.x, percent: true,
      series: st.map((k) => ({ name: labelOf("group", k), values: entry("group", k) ? yr(k).v : base.x.map(() => 0) })),
      tipFmt: (v) => nf(v, 1), height: 250 });
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
    const [meta, series, countries, insights] = await Promise.all(["meta.json", "series.json", "countries.json", "insights.json"].map(get));
    D.meta = meta || { status: "collecting" };
    renderHeader();
    if (!series || !series.months || !series.months.length) {
      $("#main").innerHTML = `<div class="loading">첫 데이터를 수집하는 중임. 수집이 끝나면 자동으로 표시됨.</div>`;
      return;
    }
    Object.assign(D, { series, countries, insights });
    const years = [...new Set(series.months.map((m) => m.slice(0, 4)))];
    S.start = years[0];
    readHash();
    renderTop();
    renderControls();
    document.querySelectorAll(".tab").forEach((t) => t.onclick = () => go(t.dataset.tab));
    renderTab();
    let w = window.innerWidth;
    window.addEventListener("resize", () => { if (Math.abs(window.innerWidth - w) > 40) { w = window.innerWidth; renderTab(); } });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderTab);
  }
  init();
})();
