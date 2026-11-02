// WIDI 휴대폰 화면 보정 — app.js를 고치지 않고 덧붙임.
// 휴대폰 폭(≤640px)에서 가로로 넘치는 표(.tbl-wrap table)를 카드형으로 바꿈:
//   첫 칸(품목)과 판정 배지를 한 줄에, 나머지 값은 '머리글 이름 + 값' 2칸 격자로.
// 표 머리글이 숨으므로 정렬은 표 위 「정렬」 선택 상자로 대신함(머리글 클릭을 그대로 흉내 냄).
(function () {
  var MQ = matchMedia("(max-width: 640px)");
  var busy = false;
  function label(th) {
    // 머리글은 '제목<br><span class="sub">보조</span>' 모양 → "제목 (보조)". (thead를 숨긴 뒤에도 읽히도록 innerText 대신 노드로 읽음)
    var main = "", sub = "", afterBr = false;
    th.childNodes.forEach(function (n) {
      if (n.nodeName === "BR") { afterBr = true; return; }
      var t = (n.textContent || "");
      if (afterBr || (n.classList && n.classList.contains("sub"))) sub += " " + t; else main += t;
    });
    var clean = function (x) { return x.replace(/[?▲▼↕]/g, "").replace(/\s+/g, " ").trim(); };
    main = clean(main); sub = clean(sub);
    return sub ? main + " (" + sub + ")" : main;
  }
  function cardify(tbl) {
    var wrap = tbl.parentElement;
    var heads = tbl.tHead && tbl.tHead.rows[0] ? [...tbl.tHead.rows[0].cells] : [];
    if (!heads.length) return;
    var labels = []; var col = 0;
    heads.forEach(function (th) { var n = th.colSpan || 1; for (var i = 0; i < n; i++) labels[col++] = label(th); });
    [...tbl.tBodies].forEach(function (tb) {
      [...tb.rows].forEach(function (tr) {
        var c = 0, badgeDone = false;
        [...tr.cells].forEach(function (td, i) {
          td.setAttribute("data-label", labels[c] || "");
          td.classList.toggle("m-name", i === 0);
          var isBadge = !badgeDone && i > 0 && td.querySelector(".grade, .badge") && (/판정/.test(labels[c] || "") || td.innerText.trim().length <= 12);
          if (isBadge) badgeDone = true;
          td.classList.toggle("m-badge", !!isBadge);
          td.classList.toggle("m-empty", i > 0 && !isBadge && /^[\s–-]*$/.test(td.innerText) && !td.querySelector("svg,button,a"));
          c += td.colSpan || 1;
        });
      });
    });
    tbl.classList.add("m-cards");
    if (wrap) wrap.classList.add("m-cards-wrap");
    sortBox(tbl, heads);
  }
  function sortBox(tbl, heads) {
    var wrap = tbl.parentElement; if (!wrap) return;
    var sortable = heads.filter(function (th) { return th.classList.contains("sortable"); });
    var box = wrap.previousElementSibling && wrap.previousElementSibling.classList.contains("m-sort") ? wrap.previousElementSibling : null;
    if (sortable.length < 2) { if (box) box.remove(); return; }
    var opts = sortable.map(function (th, i) { return '<option value="' + i + '">' + label(th) + "</option>"; }).join("");
    if (!box) { box = document.createElement("div"); box.className = "m-sort"; wrap.parentNode.insertBefore(box, wrap); }
    var cur = sortable.findIndex(function (th) { return th.classList.contains("on"); });
    if (box.getAttribute("data-opts") !== opts) {
      box.setAttribute("data-opts", opts);
      box.innerHTML = '정렬 <select aria-label="표 정렬">' + opts + "</select>";
    }
    var sel = box.querySelector("select");
    if (cur >= 0) sel.value = String(cur);
    sel.onchange = function () { var th = sortable[+sel.value]; if (th && !th.classList.contains("on")) th.click(); };
  }
  function uncardify(tbl) {
    tbl.classList.remove("m-cards");
    if (tbl.parentElement) tbl.parentElement.classList.remove("m-cards-wrap");
    var box = tbl.parentElement && tbl.parentElement.previousElementSibling;
    if (box && box.classList.contains("m-sort")) box.remove();
  }
  function scan() {
    if (busy) return; busy = true;
    try {
      document.querySelectorAll(".tbl-wrap > table").forEach(function (tbl) {
        if (!MQ.matches) { if (tbl.classList.contains("m-cards")) uncardify(tbl); return; }
        var wrap = tbl.parentElement;
        if (tbl.classList.contains("m-cards") || tbl.scrollWidth > wrap.clientWidth + 2) cardify(tbl);
      });
      document.querySelectorAll(".vc-scroll").forEach(function (v) {
        var need = MQ.matches && v.scrollWidth > v.clientWidth + 2;
        var h = v.previousElementSibling && v.previousElementSibling.classList.contains("m-swipe") ? v.previousElementSibling : null;
        if (need && !h) { h = document.createElement("div"); h.className = "m-swipe"; h.textContent = "← 옆으로 밀어서 보기 →"; v.parentNode.insertBefore(h, v); }
        if (!need && h) h.remove();
      });
    } finally { busy = false; }
  }
  var t = null;
  function later() { clearTimeout(t); t = setTimeout(scan, 120); }
  new MutationObserver(function (ms) {
    if (ms.every(function (m) { return m.target.closest && m.target.closest(".m-sort"); })) return;
    later();
  }).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("resize", later);
  if (MQ.addEventListener) MQ.addEventListener("change", later);
  document.addEventListener("toggle", later, true);
  later();
})();
