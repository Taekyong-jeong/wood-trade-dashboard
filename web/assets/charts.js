/* 경량 SVG 차트 — 외부 라이브러리 없음
 * lineChart, barChart(누적·100%), sparkline, hbars
 * 모든 차트: 마우스/터치 호버 시 십자선 + 툴팁
 */
(function (global) {
  const NS = "http://www.w3.org/2000/svg";
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const SLOTS = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7", "--s8"];
  const color = (i) => (i < SLOTS.length ? css(SLOTS[i]) : css("--other"));

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function niceTicks(min, max, count = 5) {
    if (!isFinite(min) || !isFinite(max)) return [0, 1];
    if (min === max) { max = min + 1; }
    const span = max - min;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const out = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
    return out;
  }

  function legend(container, series, kind) {
    if (series.length < 2) return;
    const lg = document.createElement("div");
    lg.className = "legend";
    series.forEach((s) => {
      const sp = document.createElement("span");
      sp.innerHTML = `<i class="${kind === "line" ? "line" : ""}" style="background:${s.color}"></i>${s.name}`;
      lg.appendChild(sp);
    });
    container.appendChild(lg);
  }

  function tooltip(container) {
    const t = document.createElement("div");
    t.className = "tip";
    container.appendChild(t);
    return t;
  }

  function placeTip(tip, container, x, y) {
    const cw = container.clientWidth;
    tip.style.display = "block";
    const tw = tip.offsetWidth;
    let left = x + 14;
    if (left + tw > cw) left = x - tw - 14;
    if (left < 0) left = 0;
    tip.style.left = left + "px";
    tip.style.top = Math.max(0, y - 10) + "px";
  }

  /**
   * opts: { x: [labels], series: [{name, values, color?, dash?}], height, yFmt, tipFmt,
   *         markers: [{x, label}], yMin0: true, area: false, xLabelFmt }
   */
  function lineChart(container, opts) {
    container.innerHTML = "";
    container.classList.add("chart");
    const series = opts.series.map((s, i) => ({ ...s, color: s.color || color(i) }));
    legend(container, series, "line");
    const W = Math.max(container.clientWidth, 280);
    const H = opts.height || 240;
    const pad = { l: 52, r: 12, t: 10, b: 26 };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": opts.title || "line chart" }, container);
    const n = opts.x.length;
    const vals = series.flatMap((s) => s.values.filter((v) => v != null && isFinite(v)));
    if (!vals.length || n === 0) {
      el("text", { x: W / 2, y: H / 2, "text-anchor": "middle" }, svg).textContent = "표시할 데이터 없음";
      return;
    }
    let ymin = opts.yMin0 === false ? Math.min(...vals) : Math.min(0, ...vals);
    let ymax = Math.max(...vals);
    const ticks = niceTicks(ymin, ymax, opts.ticks || 4);
    ymin = ticks[0]; ymax = ticks[ticks.length - 1];
    const fmt = opts.yFmt || ((v) => v.toLocaleString("ko-KR"));
    const longest = Math.max(...ticks.map((t) => fmt(t).length));
    pad.l = Math.min(80, Math.max(34, longest * 6.6 + 10));
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const X = (i) => pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const Y = (v) => pad.t + ih - ((v - ymin) / (ymax - ymin || 1)) * ih;

    const g = el("g", {}, svg);
    ticks.forEach((t) => {
      el("line", { x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t), stroke: t === 0 ? css("--axis") : css("--grid"), "stroke-width": 1 }, g);
      el("text", { x: pad.l - 6, y: Y(t) + 4, "text-anchor": "end" }, g).textContent = fmt(t);
    });
    // x 라벨: 월별(YYYY-MM)이면 1월에만 연도 표시, 그 외에는 균등 간격
    const xfmt = opts.xLabelFmt || ((s) => s);
    const maxLabels = Math.max(3, Math.floor(iw / 56));
    const monthly = n > 0 && /^\d{4}-\d{2}$/.test(opts.x[0]);
    if (monthly && n > 18) {
      const jan = opts.x.map((s, i) => (s.endsWith("-01") ? i : -1)).filter((i) => i >= 0);
      const yStep = Math.max(1, Math.ceil(jan.length / maxLabels));
      jan.forEach((i, j) => {
        if (j % yStep) return;
        el("text", { x: X(i), y: H - 6, "text-anchor": "middle" }, g).textContent = opts.x[i].slice(0, 4);
      });
    } else {
      const step = Math.max(1, Math.ceil(n / maxLabels));
      for (let i = 0; i < n; i += step) {
        el("text", { x: X(i), y: H - 6, "text-anchor": "middle" }, g).textContent = xfmt(opts.x[i]);
      }
    }
    // HS 개정 등 마커
    (opts.markers || []).forEach((m) => {
      const i = opts.x.indexOf(m.x);
      if (i < 0) return;
      el("line", { x1: X(i), x2: X(i), y1: pad.t, y2: pad.t + ih, stroke: css("--axis"), "stroke-dasharray": "3 3" }, g);
      el("text", { x: X(i) + 4, y: pad.t + 10, "text-anchor": "start" }, g).textContent = m.label;
    });
    series.forEach((s) => {
      let d = "", pen = false;
      s.values.forEach((v, i) => {
        if (v == null || !isFinite(v)) { pen = false; return; }
        d += (pen ? "L" : "M") + X(i).toFixed(1) + "," + Y(v).toFixed(1);
        pen = true;
      });
      if (opts.area && series.length === 1) {
        const first = s.values.findIndex((v) => v != null);
        el("path", { d: d + `L${X(n - 1)},${Y(Math.max(0, ymin))}L${X(first)},${Y(Math.max(0, ymin))}Z`, fill: s.color, opacity: 0.10 }, g);
      }
      el("path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round",
        "stroke-dasharray": s.dash ? "5 4" : "none" }, g);
      // 단일 점 표시 (값이 하나뿐일 때)
      const valid = s.values.filter((v) => v != null).length;
      if (valid <= 2) s.values.forEach((v, i) => { if (v != null) el("circle", { cx: X(i), cy: Y(v), r: 4, fill: s.color }, g); });
    });
    // 호버
    const hover = el("g", { opacity: 0 }, svg);
    const vline = el("line", { y1: pad.t, y2: pad.t + ih, stroke: css("--axis"), "stroke-width": 1 }, hover);
    const dots = series.map((s) => el("circle", { r: 4, fill: s.color, stroke: css("--surface"), "stroke-width": 2 }, hover));
    const tip = tooltip(container);
    const tfmt = opts.tipFmt || fmt;
    const hit = el("rect", { x: pad.l, y: pad.t, width: iw, height: ih, fill: "transparent" }, svg);
    function move(ev) {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left) * (W / rect.width);
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - pad.l) / iw) * (n - 1))));
      hover.setAttribute("opacity", 1);
      vline.setAttribute("x1", X(i)); vline.setAttribute("x2", X(i));
      let rows = "";
      series.forEach((s, k) => {
        const v = s.values[i];
        if (v == null) { dots[k].setAttribute("opacity", 0); }
        else { dots[k].setAttribute("opacity", 1); dots[k].setAttribute("cx", X(i)); dots[k].setAttribute("cy", Y(v)); }
        rows += `<div class="tr"><span><i style="background:${s.color}"></i>${s.name}</span><b>${v == null ? "–" : tfmt(v)}</b></div>`;
      });
      tip.innerHTML = `<div class="tt">${xfmt(opts.x[i], true)}</div>${rows}`;
      placeTip(tip, container, (X(i) / W) * rect.width, 0);
    }
    function leave() { hover.setAttribute("opacity", 0); tip.style.display = "none"; }
    hit.addEventListener("mousemove", move);
    hit.addEventListener("touchmove", move, { passive: true });
    hit.addEventListener("mouseleave", leave);
    hit.addEventListener("touchend", leave);
  }

  /**
   * opts: { x, series:[{name, values, color?}], stacked: true, percent: false, height, yFmt, tipFmt }
   */
  function barChart(container, opts) {
    container.innerHTML = "";
    container.classList.add("chart");
    const series = opts.series.map((s, i) => ({ ...s, color: s.color || color(i) }));
    legend(container, series, "bar");
    const W = Math.max(container.clientWidth, 280);
    const H = opts.height || 240;
    const pad = { l: 46, r: 8, t: 8, b: 26 };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img" }, container);
    const n = opts.x.length;
    const totals = opts.x.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
    if (!n || totals.every((t) => !t)) {
      el("text", { x: W / 2, y: H / 2, "text-anchor": "middle" }, svg).textContent = "표시할 데이터 없음";
      return;
    }
    const pct = !!opts.percent;
    const ymax = pct ? 100 : opts.stacked ? Math.max(...totals) : Math.max(...series.flatMap((s) => s.values.map((v) => v || 0)));
    const ticks = pct ? [0, 25, 50, 75, 100] : niceTicks(0, ymax, 4);
    const top = ticks[ticks.length - 1];
    const fmt = pct ? (v) => v + "%" : opts.yFmt || ((v) => v.toLocaleString("ko-KR"));
    pad.l = Math.min(80, Math.max(30, Math.max(...ticks.map((t) => fmt(t).length)) * 6.6 + 10));
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const band = iw / n;
    const bw = Math.max(2, Math.min(44, band * 0.68));
    const Y = (v) => pad.t + ih - (v / (top || 1)) * ih;
    const g = el("g", {}, svg);
    ticks.forEach((t) => {
      el("line", { x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t), stroke: t === 0 ? css("--axis") : css("--grid") }, g);
      el("text", { x: pad.l - 6, y: Y(t) + 4, "text-anchor": "end" }, g).textContent = fmt(t);
    });
    const step = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(iw / 46))));
    for (let i = 0; i < n; i += step) {
      el("text", { x: pad.l + band * (i + 0.5), y: H - 6, "text-anchor": "middle" }, g).textContent = opts.xLabelFmt ? opts.xLabelFmt(opts.x[i]) : opts.x[i];
    }
    const surf = css("--surface");
    for (let i = 0; i < n; i++) {
      let acc = 0;
      const cx = pad.l + band * (i + 0.5);
      if (opts.stacked || pct) {
        series.forEach((s) => {
          let v = s.values[i] || 0;
          if (pct) v = totals[i] ? (v / totals[i]) * 100 : 0;
          if (v <= 0) return;
          const y0 = Y(acc), y1 = Y(acc + v);
          el("rect", { x: cx - bw / 2, y: y1, width: bw, height: Math.max(0, y0 - y1), fill: s.color, stroke: surf, "stroke-width": 1 }, g);
          acc += v;
        });
      } else {
        const sw = bw / series.length;
        series.forEach((s, k) => {
          const v = s.values[i] || 0;
          el("rect", { x: cx - bw / 2 + k * sw, y: Y(v), width: Math.max(1, sw - 1), height: Y(0) - Y(v), fill: s.color, rx: 2 }, g);
        });
      }
    }
    const tip = tooltip(container);
    const hl = el("rect", { y: pad.t, height: ih, width: band, fill: css("--ink"), opacity: 0 }, svg);
    const hit = el("rect", { x: pad.l, y: pad.t, width: iw, height: ih, fill: "transparent" }, svg);
    const tfmt = opts.tipFmt || opts.yFmt || ((v) => v.toLocaleString("ko-KR"));
    function move(ev) {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left) * (W / rect.width);
      const i = Math.max(0, Math.min(n - 1, Math.floor((px - pad.l) / band)));
      hl.setAttribute("x", pad.l + band * i); hl.setAttribute("opacity", 0.05);
      let rows = "";
      [...series].reverse().forEach((s) => {
        const v = s.values[i] || 0;
        const share = totals[i] ? ` <span style="color:var(--muted)">${((v / totals[i]) * 100).toFixed(1)}%</span>` : "";
        rows += `<div class="tr"><span><i style="background:${s.color}"></i>${s.name}</span><b>${tfmt(v)}${(opts.stacked || pct) ? share : ""}</b></div>`;
      });
      if (opts.stacked || pct) rows += `<div class="tr" style="border-top:1px solid var(--grid);margin-top:3px;padding-top:3px"><span>합계</span><b>${tfmt(totals[i])}</b></div>`;
      tip.innerHTML = `<div class="tt">${opts.x[i]}</div>${rows}`;
      placeTip(tip, container, ((pad.l + band * (i + 1)) / W) * rect.width, 0);
    }
    function leave() { hl.setAttribute("opacity", 0); tip.style.display = "none"; }
    hit.addEventListener("mousemove", move);
    hit.addEventListener("touchmove", move, { passive: true });
    hit.addEventListener("mouseleave", leave);
    hit.addEventListener("touchend", leave);
  }

  function sparkline(values, w = 150, h = 30) {
    const v = values.filter((x) => x != null);
    if (v.length < 2) return "";
    const min = Math.min(...v), max = Math.max(...v);
    const pts = values.map((x, i) => x == null ? null : [(i / (values.length - 1)) * w, h - 2 - ((x - min) / (max - min || 1)) * (h - 4)]);
    let d = "", pen = false;
    pts.forEach((p) => { if (!p) { pen = false; return; } d += (pen ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1); pen = true; });
    return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${css("--s1")}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
  }

  /** rows: [{label, value, text, onClick?}] — 값 비례 가로 막대 */
  function hbars(container, rows, opts = {}) {
    container.innerHTML = "";
    if (!rows.length) { container.innerHTML = `<div class="empty">데이터 없음</div>`; return; }
    const max = Math.max(...rows.map((r) => r.value || 0)) || 1;
    const wrap = document.createElement("div");
    wrap.className = "hbars";
    rows.forEach((r, i) => {
      const d = document.createElement("div");
      d.className = "hb";
      d.innerHTML = `<span class="rk">${i + 1}</span><span class="nm" title="${r.label}">${r.label}</span>` +
        `<span class="bar"><i style="width:${((r.value || 0) / max) * 100}%;background:${opts.color || css("--s1")}"></i></span>` +
        `<span class="vl">${r.text}</span>`;
      if (r.onClick) { d.style.cursor = "pointer"; d.addEventListener("click", r.onClick); }
      wrap.appendChild(d);
    });
    container.appendChild(wrap);
  }

  /**
   * 산점도: { points:[{x, y, label, size?, color?, onClick?, labelOn?}], xFmt, yFmt, xTitle, yTitle,
   *          logY, refX:[{v,label}], refY:[{v,label}], xMin, xMax, height, tip:(p)=>html }
   */
  function scatterChart(container, opts) {
    container.innerHTML = "";
    container.classList.add("chart");
    const W = Math.max(container.clientWidth, 280), H = opts.height || 300;
    const pad = { l: 56, r: 14, t: 12, b: 38 };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img" }, container);
    const pts = opts.points.filter((p) => p.x != null && p.y != null && (!opts.logY || p.y > 0));
    if (!pts.length) { el("text", { x: W / 2, y: H / 2, "text-anchor": "middle" }, svg).textContent = "표시할 데이터 없음"; return; }
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const xMin = opts.xMin != null ? opts.xMin : Math.min(...xs), xMax = opts.xMax != null ? opts.xMax : Math.max(...xs);
    const ly = (v) => (opts.logY ? Math.log10(v) : v);
    let yLo = Math.min(...ys.map(ly), ...(opts.refY || []).map((r) => ly(r.v))), yHi = Math.max(...ys.map(ly), ...(opts.refY || []).map((r) => ly(r.v)));
    if (opts.logY) { yLo = Math.floor(yLo); yHi = Math.ceil(yHi); } else { const t = niceTicks(Math.min(0, yLo), yHi, 4); yLo = t[0]; yHi = t[t.length - 1]; }
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const X = (v) => pad.l + ((v - xMin) / (xMax - xMin || 1)) * iw;
    const Y = (v) => pad.t + ih - ((ly(v) - yLo) / (yHi - yLo || 1)) * ih;
    const g = el("g", {}, svg);
    const yt = opts.logY ? Array.from({ length: yHi - yLo + 1 }, (_, i) => Math.pow(10, yLo + i)) : niceTicks(yLo, yHi, 4);
    const yf = opts.yFmt || ((v) => v.toLocaleString("ko-KR"));
    yt.forEach((v) => { el("line", { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), stroke: css("--grid") }, g);
      el("text", { x: pad.l - 6, y: Y(v) + 4, "text-anchor": "end" }, g).textContent = yf(v); });
    const xt = niceTicks(xMin, xMax, 5).filter((v) => v >= xMin && v <= xMax);
    const xf = opts.xFmt || ((v) => v.toLocaleString("ko-KR"));
    xt.forEach((v) => el("text", { x: X(v), y: H - 20, "text-anchor": "middle" }, g).textContent = xf(v));
    el("line", { x1: pad.l, x2: W - pad.r, y1: pad.t + ih, y2: pad.t + ih, stroke: css("--axis") }, g);
    if (opts.xTitle) el("text", { x: pad.l + iw / 2, y: H - 3, "text-anchor": "middle", style: "fill:var(--ink-2)" }, g).textContent = opts.xTitle;
    if (opts.yTitle) el("text", { x: pad.l, y: pad.t - 2, "text-anchor": "start", style: "fill:var(--ink-2)" }, g).textContent = opts.yTitle;
    // 기준선
    (opts.refX || []).forEach((r) => { if (r.v < xMin || r.v > xMax) return;
      el("line", { x1: X(r.v), x2: X(r.v), y1: pad.t, y2: pad.t + ih, stroke: css("--s8"), "stroke-dasharray": "4 3", opacity: 0.8 }, g);
      el("text", { x: X(r.v) + 4, y: pad.t + 11, "text-anchor": "start", style: "fill:var(--s8)" }, g).textContent = r.label; });
    (opts.refY || []).forEach((r) => {
      el("line", { x1: pad.l, x2: W - pad.r, y1: Y(r.v), y2: Y(r.v), stroke: css("--s8"), "stroke-dasharray": "4 3", opacity: 0.8 }, g);
      el("text", { x: W - pad.r - 2, y: Y(r.v) - 4, "text-anchor": "end", style: "fill:var(--s8)" }, g).textContent = r.label; });
    const tip = tooltip(container);
    const surf = css("--surface");
    pts.forEach((p) => {
      const c = el("circle", { cx: X(p.x), cy: Y(p.y), r: p.size || 6, fill: p.color || css("--s1"), "fill-opacity": 0.85, stroke: surf, "stroke-width": 2, style: p.onClick ? "cursor:pointer" : "" }, g);
      if (p.labelOn) el("text", { x: X(p.x) + (p.size || 6) + 3, y: Y(p.y) + 4, "text-anchor": "start", style: "fill:var(--ink-2);font-size:11px" }, g).textContent = p.label;
      const show = (ev) => { const rect = svg.getBoundingClientRect();
        tip.innerHTML = opts.tip ? opts.tip(p) : `<div class="tt">${p.label}</div><div class="tr"><span>x</span><b>${xf(p.x)}</b></div><div class="tr"><span>y</span><b>${yf(p.y)}</b></div>`;
        placeTip(tip, container, (X(p.x) / W) * rect.width, Math.max(0, (Y(p.y) / H) * rect.height - 40)); };
      c.addEventListener("mouseenter", show); c.addEventListener("touchstart", show, { passive: true });
      c.addEventListener("mouseleave", () => (tip.style.display = "none"));
      if (p.onClick) c.addEventListener("click", p.onClick);
    });
  }

  /** 분해 막대: rows [{label, a, b, c?}] — a·b(·c)를 0 기준 좌우로 누적 (물량·단가·신규중단) */
  function decompBars(container, rows, opts = {}) {
    container.innerHTML = "";
    const names = opts.names || ["물량 효과", "단가 효과", "신규·중단"];
    const cols = [css("--s1"), css("--s2"), css("--other")];
    const mx = Math.max(1, ...rows.map((r) => Math.max([r.a, r.b, r.c || 0].filter((v) => v > 0).reduce((x, y) => x + y, 0),
      -[r.a, r.b, r.c || 0].filter((v) => v < 0).reduce((x, y) => x + y, 0))));
    const lg = document.createElement("div"); lg.className = "legend";
    lg.innerHTML = names.map((n, i) => `<span><i style="background:${cols[i]}"></i>${n}</span>`).join("");
    container.appendChild(lg);
    const wrap = document.createElement("div"); wrap.className = "dcmp";
    rows.forEach((r) => {
      const d = document.createElement("div"); d.className = "dc";
      let pos = 0, neg = 0, bars = "";
      [r.a, r.b, r.c || 0].forEach((v, i) => { if (!v) return; const w = (Math.abs(v) / mx) * 50;
        if (v > 0) { bars += `<i style="left:${50 + pos}%;width:${w}%;background:${cols[i]}"></i>`; pos += w; }
        else { neg += w; bars += `<i style="left:${50 - neg}%;width:${w}%;background:${cols[i]}"></i>`; } });
      d.innerHTML = `<span class="nm" title="${r.label}">${r.label}</span><span class="track">${bars}</span><span class="vl ${r.total >= 0 ? "up" : "down"}">${r.text}</span>`;
      if (r.tip) d.title = r.tip;
      if (r.onClick) { d.style.cursor = "pointer"; d.addEventListener("click", r.onClick); }
      wrap.appendChild(d);
    });
    container.appendChild(wrap);
  }

  global.Charts = { lineChart, barChart, sparkline, hbars, scatterChart, decompBars, color };
})(window);
