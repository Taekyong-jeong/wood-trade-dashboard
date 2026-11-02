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
    if (!opts.noLegend) legend(container, series, "line");
    if (opts.pin) { let lg = container.querySelector(".legend"); if (!lg) { lg = document.createElement("div"); lg.className = "legend"; container.appendChild(lg); }
      lg.insertAdjacentHTML("beforeend", `<span class="pin-note">👆 그래프를 누르면 그 달 고정 · 두 달을 누르면 기간 증감(%) 비교</span>`); }
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
    let ymax = Math.max(...vals, opts.yMaxMin || -Infinity);
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
    // 기준 구간 띠 (예: HHI 분산·보통·집중)
    (opts.bands || []).forEach((b) => {
      const y1 = Y(Math.min(b.to, ymax)), y0 = Y(Math.max(b.from, ymin));
      if (y0 <= y1) return;
      el("rect", { x: pad.l, y: y1, width: iw, height: y0 - y1, fill: b.color, "fill-opacity": 0.09 }, g);
      el("text", { x: pad.l + iw - 4, y: y1 + 13, "text-anchor": "end", style: `fill:${b.color};font-size:11px;font-weight:600` }, g).textContent = b.label;
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
      // 구간별 색 (bandLine): 꺾은선·아래 면적을 구간(분산·보통·집중) 색으로 — 구간마다 잘라 그림
      if (opts.bandLine && opts.bands && series.length === 1) {
        const first = s.values.findIndex((v) => v != null), uid = "bl" + Math.random().toString(36).slice(2, 8);
        const defs = el("defs", {}, svg);
        const base = Y(Math.max(0, ymin));
        const bandOf = (v) => { const k = opts.bands.findIndex((b) => v >= b.from && v < b.to); return k >= 0 ? k : (v >= opts.bands[opts.bands.length - 1].to ? opts.bands.length - 1 : -1); };
        // 아래 면적 경로: 값이 이어진 구간마다 바닥까지 닫음 (중간에 빈 달이 있어도 사선이 생기지 않게)
        let areaD = "", run = [];
        const flush = () => { if (run.length) { areaD += `M${X(run[0][0]).toFixed(1)},${base}` + run.map(([i, v]) => `L${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("") + `L${X(run[run.length - 1][0]).toFixed(1)},${base}Z`; run = []; } };
        s.values.forEach((v, i) => { if (v == null || !isFinite(v)) flush(); else run.push([i, v]); }); flush();
        // 아래 면적: 그 시점 값이 속한 구간 색으로 바닥까지 칠함 (가로 구간별로 자름) — 첫 구간(분산)은 옅게
        if (opts.area) {
          const xr = opts.bands.map(() => []);
          s.values.forEach((v, i) => {
            if (v == null || !isFinite(v)) return;
            const a = i > 0 ? (X(i - 1) + X(i)) / 2 : X(i), b2 = i < n - 1 ? (X(i) + X(i + 1)) / 2 : X(i);
            const k = bandOf(v); if (k >= 0) xr[k].push([a, b2]);
          });
          xr.forEach((rs, k) => {
            if (!rs.length) return;
            const cp = el("clipPath", { id: `${uid}-a${k}` }, defs);
            rs.forEach(([a, b2]) => el("rect", { x: a - 0.3, y: 0, width: b2 - a + 0.6, height: H }, cp));
            el("path", { d: areaD, fill: opts.bands[k].color, opacity: k === 0 ? 0.10 : 0.20, "clip-path": `url(#${uid}-a${k})` }, g);
          });
        }
        // 꺾은선: 값의 높이가 속한 구간 색
        opts.bands.forEach((b, k) => {
          const y1 = Y(Math.min(b.to, ymax)), y0 = k === 0 ? base + 1 : Y(Math.max(b.from, ymin));
          if (y0 <= y1) return;
          const cp = el("clipPath", { id: `${uid}-${k}` }, defs);
          el("rect", { x: 0, y: y1, width: W, height: y0 - y1 }, cp);
          el("path", { d, fill: "none", stroke: b.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: 0.85, "clip-path": `url(#${uid}-${k})` }, g);
        });
        return;
      }
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
    // 같은 달 고정 (opts.pinMonth, x = "YYYY-MM"): 한 달을 누르면 해마다 같은 달이 함께 고정되고 연도별 값·전년 대비 표시
    const monthMode = opts.pinMonth && opts.x.length && /^\d{4}-\d{2}$/.test(opts.x[0]);
    if (monthMode) {
      const layer = el("g", {}, svg); svg.appendChild(hit);
      const box = document.createElement("div"); box.className = "pin-box pm-box"; container.appendChild(box);
      let mm = null;
      const draw = () => {
        layer.innerHTML = "";
        box.style.display = mm ? "" : "none";
        if (!mm) { box.innerHTML = ""; return; }
        const idx = opts.x.map((x, i) => (x.slice(5) === mm ? i : -1)).filter((i) => i >= 0);
        idx.forEach((i) => {
          el("line", { x1: X(i), x2: X(i), y1: pad.t, y2: pad.t + ih, stroke: css("--ink"), "stroke-width": 1, "stroke-dasharray": "3 3", opacity: 0.55 }, layer);
          series.forEach((s) => { const v = s.values[i]; if (v != null) el("circle", { cx: X(i), cy: Y(v), r: 4, fill: s.color, stroke: css("--surface"), "stroke-width": 2 }, layer); });
          const tx = el("text", { x: X(i), y: pad.t + 11, "text-anchor": "middle", style: `fill:${css("--ink")};font-size:10.5px;font-weight:700` }, layer);
          tx.textContent = "’" + opts.x[i].slice(2, 4);
        });
        const head = `<tr><th class="l">${+mm}월</th>${idx.map((i) => `<th>${opts.x[i].slice(0, 4)}</th>`).join("")}</tr>`;
        const rows = series.map((s) => `<tr><td class="l"><i style="background:${s.color}"></i>${s.name}</td>` + idx.map((i, k) => {
          const v = s.values[i], pv = k ? s.values[idx[k - 1]] : null, pc = v != null && pv ? (v / pv - 1) * 100 : null;
          return `<td><b>${v == null ? "–" : tfmt(v)}</b>${pc == null ? "" : `<em class="${pc < 0 ? "dn" : "up"}">${pc > 0 ? "▲" : "▼"}${Math.abs(pc).toFixed(0)}%</em>`}</td>`; }).join("") + `</tr>`).join("");
        box.innerHTML = `<div class="pm-wrap"><table class="pm-t">${head}${rows}</table></div><div class="pm-foot"><span class="sub">▲▼ = 전년 같은 달 대비 · 다른 달을 누르면 바뀜</span><button type="button" class="pin-clear">고정 해제</button></div>`;
        box.querySelector(".pin-clear").onclick = () => { mm = null; draw(); };
      };
      svg.addEventListener("click", (ev) => {
        const rect = svg.getBoundingClientRect();
        const px = (ev.clientX - rect.left) * (W / rect.width);
        const i = Math.max(0, Math.min(n - 1, Math.round(((px - pad.l) / iw) * (n - 1))));
        const m2 = opts.x[i].slice(5); mm = mm === m2 ? null : m2; draw();
      });
      svg.style.cursor = "pointer";
      let lg = container.querySelector(".legend"); if (!lg) { lg = document.createElement("div"); lg.className = "legend"; container.insertBefore(lg, container.firstChild); }
      lg.insertAdjacentHTML("beforeend", `<span class="pin-note">👆 한 달을 누르면 해마다 같은 달이 함께 고정</span>`);
      draw();
    }
    // 누르면 고정 (opts.pin): 한 번 = 그 달 고정, 다른 달 = 두 달 고정하고 증감 표시, 고정된 달 다시 누르면 해제
    if (opts.pin && !monthMode) {
      const pins = [], layer = el("g", {}, svg);
      svg.appendChild(hit);   // 클릭 영역을 맨 위로
      const box = document.createElement("div"); box.className = "pin-box"; container.appendChild(box);
      const dfmt = opts.diffFmt || ((v) => (v > 0 ? "+" : "") + tfmt(v));
      const draw = () => {
        layer.innerHTML = "";
        pins.forEach((i, k) => {
          el("line", { x1: X(i), x2: X(i), y1: pad.t, y2: pad.t + ih, stroke: css("--ink"), "stroke-width": 1.2, "stroke-dasharray": k ? "4 3" : "none", opacity: 0.7 }, layer);
          series.forEach((s) => { const v = s.values[i]; if (v != null) el("circle", { cx: X(i), cy: Y(v), r: 4.5, fill: s.color, stroke: css("--surface"), "stroke-width": 2 }, layer); });
          const near = pins.length === 2 && Math.abs(X(pins[1]) - X(pins[0])) < 90;   // 두 달이 가까우면 B 라벨을 한 줄 아래로
          const tx = el("text", { x: X(i), y: pad.t + 11 + (near && k ? 14 : 0), "text-anchor": X(i) > W - 60 ? "end" : X(i) < pad.l + 40 ? "start" : "middle", style: `fill:${css("--ink")};font-size:11px;font-weight:700` }, layer);
          tx.textContent = (k ? "B " : "A ") + xfmt(opts.x[i], true);
        });
        box.style.display = pins.length ? "" : "none";
        if (!pins.length) { box.innerHTML = ""; return; }
        const [a, b] = pins;
        box.innerHTML = series.map((s) => {
          const va = s.values[a], vb = b != null ? s.values[b] : null;
          let r = `<span class="pin-s"><i style="background:${s.color}"></i>${s.name} <b>${xfmt(opts.x[a], true)} ${va == null ? "–" : tfmt(va)}</b>`;
          if (b != null) {
            r += ` → <b>${xfmt(opts.x[b], true)} ${vb == null ? "–" : tfmt(vb)}</b>`;
            if (va != null && vb != null) { const d = vb - va, pc = va ? (d / va) * 100 : null;
              r += ` <em class="${d < 0 ? "dn" : "up"}">${dfmt(d)}${pc == null ? "" : ` (${pc > 0 ? "+" : ""}${pc.toFixed(1)}%)`}</em>`; }
          }
          return r + `</span>`; }).join("") + `<button type="button" class="pin-clear">고정 해제</button>`;
        box.querySelector(".pin-clear").onclick = () => { pins.length = 0; draw(); };
      };
      svg.addEventListener("click", (ev) => {   // 그래프 영역 전체(오른쪽 끝 포함)
        const rect = svg.getBoundingClientRect();
        const px = (ev.clientX - rect.left) * (W / rect.width);
        const i = Math.max(0, Math.min(n - 1, Math.round(((px - pad.l) / iw) * (n - 1))));
        const k = pins.indexOf(i);
        if (k >= 0) pins.splice(k, 1); else if (pins.length < 2) pins.push(i); else pins[1] = i;
        pins.sort((x, y) => x - y);
        draw();
      });
      svg.style.cursor = "pointer";
      draw();
    }
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
    const max = opts.max || Math.max(...rows.map((r) => r.value || 0)) || 1;
    const wrap = document.createElement("div");
    wrap.className = "hbars";
    rows.forEach((r, i) => {
      if (r.sep) { const s = document.createElement("div"); s.className = "hb-sep" + (r.sepClick ? " click" : "");
        if (r.sepLabel) s.innerHTML = `<span>${r.sepLabel}</span>`;
        if (r.sepClick) s.addEventListener("click", r.sepClick);
        wrap.appendChild(s); }
      const d = document.createElement("div");
      d.className = "hb";
      d.innerHTML = `<span class="rk">${r.rk != null ? r.rk : i + 1}</span><span class="nm" title="${r.label}">${r.label}</span>` +
        `<span class="bar"><i style="width:${((r.value || 0) / max) * 100}%;background:${r.color || opts.color || css("--s1")}"></i></span>` +
        `<span class="vl">${r.text}</span>`;
      if (r.onClick) { d.querySelectorAll("span").forEach((s) => (s.style.cursor = "pointer")); d.addEventListener("click", r.onClick); }
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
    const refVals = (opts.refY || []).flatMap((r) => [r.v, ...(r.band || [])]);
    let yLo = Math.min(...ys.map(ly), ...refVals.map(ly)), yHi = Math.max(...ys.map(ly), ...refVals.map(ly));
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
      const rc = r.color || css("--s8");
      if (r.band) el("rect", { x: pad.l, width: W - pad.l - pad.r, y: Y(r.band[1]), height: Math.max(1, Y(r.band[0]) - Y(r.band[1])), fill: rc, "fill-opacity": 0.13 }, g);
      el("line", { x1: pad.l, x2: W - pad.r, y1: Y(r.v), y2: Y(r.v), stroke: rc, "stroke-dasharray": r.solid ? "" : "4 3", "stroke-width": r.solid ? 2 : 1, opacity: 0.9 }, g);
      el("text", { x: W - pad.r - 2, y: r.below ? Y(r.v) + 13 : Y(r.v) - 4, "text-anchor": "end", style: `fill:${rc};font-weight:${r.solid ? 700 : 400}` }, g).textContent = r.label; });
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
      if (r.onClick) { d.querySelectorAll("span").forEach((s) => (s.style.cursor = "pointer")); d.addEventListener("click", r.onClick); }
      wrap.appendChild(d);
    });
    container.appendChild(wrap);
  }


  /**
   * 흐름도(생키): { sources:[{key,label,value,color}], targets:[{key,label,value,sub?}], links:[{s,t,value}],
   *               fmt:(v)=>str, height, tip:(link)=>html }
   * 왼쪽 = 출처, 오른쪽 = 쓰임. 띠 두께 = 물량. 띠 색 = 출처.
   */
  function sankey(container, o) {
    container.innerHTML = "";
    container.classList.add("chart");
    const W = Math.max(container.clientWidth, 300), narrow = W < 560;
    const H = o.height || (narrow ? 380 : 360);
    const L = narrow ? 92 : 132, R = narrow ? 128 : 230, nw = 10, gap = narrow ? 8 : 10;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": o.aria || "흐름도" }, container);
    const tip = tooltip(container);
    const tot = o.sources.reduce((a, s) => a + s.value, 0) || 1;
    const sc = (H - gap * (Math.max(o.sources.length, o.targets.length) - 1) - 4) / tot;
    const place = (nodes) => { let y = 2; const sp = (H - 4 - tot * sc) / Math.max(nodes.length - 1, 1); nodes.forEach((n) => { n.y = y; n.h = Math.max(n.value * sc, 1); n.off = 0; y += n.h + sp; }); };
    place(o.sources); place(o.targets);
    const x0 = L, x1 = W - R, xm = (x0 + nw + x1) / 2;
    const S = Object.fromEntries(o.sources.map((s) => [s.key, s])), T = Object.fromEntries(o.targets.map((t) => [t.key, t]));
    const tIdx = Object.fromEntries(o.targets.map((t, i) => [t.key, i])), sIdx = Object.fromEntries(o.sources.map((s, i) => [s.key, i]));
    const links = o.links.filter((l) => l.value > 0);
    // 출처 쪽은 쓰임 순서, 쓰임 쪽은 출처 순서로 쌓아 교차를 줄임
    const bySrc = [...links].sort((a, b) => sIdx[a.s] - sIdx[b.s] || tIdx[a.t] - tIdx[b.t]);
    bySrc.forEach((l) => { const s = S[l.s]; l.sy = s.y + s.off; s.off += l.value * sc; });
    const byTgt = [...links].sort((a, b) => tIdx[a.t] - tIdx[b.t] || sIdx[a.s] - sIdx[b.s]);
    byTgt.forEach((l) => { const t = T[l.t]; l.ty = t.y + t.off; t.off += l.value * sc; });
    const gL = el("g", {}, svg);
    links.forEach((l) => {
      const h = Math.max(l.value * sc, 0.8), a = x0 + nw, b = x1;
      const d = `M${a},${l.sy}C${xm},${l.sy} ${xm},${l.ty} ${b},${l.ty}L${b},${l.ty + h}C${xm},${l.ty + h} ${xm},${l.sy + h} ${a},${l.sy + h}Z`;
      const p = el("path", { d, fill: S[l.s].color, "fill-opacity": 0.38, class: "sk-link" }, gL);
      const on = (ev) => { gL.querySelectorAll("path").forEach((q) => q.setAttribute("fill-opacity", q === p ? 0.72 : 0.14));
        const r = container.getBoundingClientRect(); tip.innerHTML = o.tip ? o.tip(l, S[l.s], T[l.t]) : `${S[l.s].label} → ${T[l.t].label}: ${o.fmt(l.value)}`;
        placeTip(tip, container, ev.clientX - r.left, ev.clientY - r.top); };
      p.addEventListener("mousemove", on); p.addEventListener("touchstart", (ev) => on(ev.touches[0]), { passive: true });
      p.addEventListener("mouseleave", () => { tip.style.display = "none"; gL.querySelectorAll("path").forEach((q) => q.setAttribute("fill-opacity", 0.38)); });
    });
    const ink = css("--ink"), ink2 = css("--ink-2"), fs = narrow ? 11 : 12.5;
    o.sources.forEach((s) => {
      el("rect", { x: x0, y: s.y, width: nw, height: s.h, rx: 2, fill: s.color }, svg);
      const cy = s.y + s.h / 2;
      const t1 = el("text", { x: x0 - 8, y: cy - 2, "text-anchor": "end", "font-size": fs, "font-weight": 700, fill: ink }, svg); t1.textContent = s.label;
      const t2 = el("text", { x: x0 - 8, y: cy + fs, "text-anchor": "end", "font-size": fs - 1.5, fill: ink2 }, svg); t2.textContent = o.fmt(s.value) + ` · ${Math.round((s.value / tot) * 100)}%`;
    });
    const tc = css("--ink-2");
    o.targets.forEach((t) => {
      const tg = el("g", { "data-tkey": t.key }, svg);
      el("rect", { x: x1, y: t.y, width: nw, height: t.h, rx: 2, fill: tc }, tg);
      const cy = t.y + t.h / 2;
      const vtxt = `${o.fmt(t.value)} · ${Math.round((t.value / tot) * 100)}%`;
      const t1 = el("text", { x: x1 + nw + 8, y: cy - 2, "font-size": fs, "font-weight": 700, fill: ink }, tg);
      t1.textContent = narrow ? t.label.replace(/\(.+\)/, "") : t.label + "  ";
      if (!narrow) { const v = el("tspan", { "font-weight": 400, fill: ink2, "font-size": fs - 1 }, t1); v.textContent = vtxt; }
      const t2 = el("text", { x: x1 + nw + 8, y: cy + fs, "font-size": fs - 1.5, fill: ink2 }, tg);
      el("rect", { x: x1 - 2, y: t.y - 2, width: R + nw, height: Math.max(t.h, fs * 2.4) + 4, fill: "transparent" }, tg);
      t2.textContent = narrow ? `${vtxt}${t.sub ? " · " + t.sub : ""}` : (t.sub || "");
    });
  }

  global.Charts = { lineChart, barChart, sparkline, hbars, scatterChart, decompBars, sankey, color };
})(window);
