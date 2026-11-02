// 대시보드 → 회원 전용 「WIDI 변동 해설」 연결 버튼.
// app.js를 건드리지 않고, 화면이 그려진 뒤 해당 품목 자리에 버튼만 덧붙임. 목록: assets/insights.json
(function () {
  const css = `.ins-btn{display:inline-flex;align-items:center;gap:4px;margin-left:8px;padding:1px 8px;border-radius:999px;border:1px solid var(--accent,#B8741F);color:var(--accent,#B8741F);font-size:11.5px;font-weight:700;text-decoration:none;white-space:nowrap;vertical-align:middle;background:transparent}
.ins-btn:hover{background:rgba(184,116,31,.1)}
.ins-foot{margin-top:6px;font-size:12.5px}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const lock = `<svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`;
  let LIST = [];
  const btn = (it) => `<a class="ins-btn" href="${it.url}" title="${it.title} (회원 전용)" data-ins="${it.id}">${lock}${it.short}</a>`;
  function apply() {
    LIST.forEach((it) => {
      // 가격 이상 판정 표는 선택한 기준월이 해설 기간(period, 예 "2021~2022") 안일 때만 버튼 표시
      const ph = document.querySelector("#pa-hint"), sy = ph ? +((ph.textContent.match(/(\d{4})/) || [])[1]) : NaN;
      const pr = String(it.period || "").match(/(\d{4})(?:\s*~\s*(\d{4}))?/), y0 = pr ? +pr[1] : NaN, y1 = pr ? +(pr[2] || pr[1]) : NaN;
      const inP = !isNaN(sy) && !isNaN(y0) && sy >= y0 && sy <= y1;
      if (!inP) document.querySelectorAll(`#a-price td.l [data-ins="${it.id}"]`).forEach((a) => a.remove());
      else it.keys.forEach((k) => {
        // 1) 가격 이상 판정 표의 해당 품목 행
        document.querySelectorAll(`#a-price tr[data-key="${k}"] td.l`).forEach((td) => {
          if (td.querySelector(`[data-ins="${it.id}"]`)) return;
          td.insertAdjacentHTML("beforeend", btn(it));
        });
      });
      // 2) 수입 단가 지수 카드 아래 (제재목 포함)
      const pidx = document.querySelector("#pidx");
      const card = pidx && pidx.closest(".card");
      if (card && !card.querySelector(`.ins-foot[data-ins="${it.id}"]`)) {
        card.insertAdjacentHTML("beforeend", `<div class="ins-foot" data-ins="${it.id}">제재목 ${it.period} 변동 원인 ${btn(it)}</div>`);
      }
    });
  }
  document.addEventListener("click", (e) => { const a = e.target.closest && e.target.closest(".ins-btn"); if (a) e.stopPropagation(); }, true);
  fetch("assets/insights.json?v=" + (window.BUILD_ID || "")).then((r) => r.json()).then((j) => {
    LIST = j || [];
    apply();
    let t = null;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(apply, 120); }).observe(document.body, { childList: true, subtree: true });
  }).catch(() => {});
})();
