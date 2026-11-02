// WIDI 앱 설치(PWA): 서비스 워커 등록 + 머리말에 「앱 설치」 버튼 (안드로이드·PC 크롬/엣지), 아이폰은 홈 화면 추가 안내
(function () {
  var root = new URL("../", document.currentScript.src); // 사이트 루트 (assets/의 상위)
  var standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register(new URL("sw.js", root), { scope: root.pathname }).catch(function () {});
  if (standalone) return;
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var dp = null, btn = null;
  function makeBtn() {
    if (btn) return btn;
    btn = document.createElement("button");
    btn.type = "button"; btn.className = "theme-btn"; btn.id = "install-btn";
    btn.textContent = "⬇ 앱 설치"; btn.title = "WIDI를 휴대폰·PC에 앱으로 설치"; btn.style.display = "none";
    var t = document.getElementById("theme-btn");
    if (t && t.parentNode) t.parentNode.insertBefore(btn, t); else (document.querySelector("header") || document.body).appendChild(btn);
    btn.addEventListener("click", function () {
      if (dp) { dp.prompt(); dp.userChoice.finally(function () { dp = null; btn.style.display = "none"; }); }
      else if (ios) hint();
    });
    return btn;
  }
  function hint() {
    if (document.getElementById("install-hint")) return;
    var d = document.createElement("div"); d.id = "install-hint";
    d.style.cssText = "position:fixed;left:12px;right:12px;bottom:16px;z-index:9999;padding:12px 14px;border-radius:10px;background:#E3A456;color:#141917;font-size:14px;line-height:1.5;box-shadow:0 4px 16px rgba(0,0,0,.3)";
    d.innerHTML = "Safari 아래 <b>공유(□↑)</b> → <b>홈 화면에 추가</b>를 누르면 WIDI가 앱처럼 설치됨. <span style='float:right;cursor:pointer;font-weight:700'>✕</span>";
    d.querySelector("span").onclick = function () { d.remove(); };
    document.body.appendChild(d);
  }
  addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); dp = e; makeBtn().style.display = ""; });
  addEventListener("appinstalled", function () { if (btn) btn.style.display = "none"; });
  if (ios) { var go = function () { makeBtn().style.display = ""; }; document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", go) : go(); }
})();
