// WIDI 앱 설치(PWA): 서비스 워커 등록 + 머리말 「⬇ 앱 설치」 버튼
// - 크롬·엣지(안드로이드·PC): 설치 창을 바로 띄움
// - 카카오톡·네이버 등 앱 안 브라우저: 설치가 막혀 있으므로 바깥 브라우저(크롬·Safari)로 다시 엶
// - 아이폰 Safari·삼성 인터넷 등: 홈 화면 추가 방법 안내
(function () {
  var root = new URL("../", document.currentScript.src); // 사이트 루트 (assets/의 상위)
  var standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register(new URL("sw.js", root), { scope: root.pathname }).catch(function () {});
  if (standalone) return;
  var ua = navigator.userAgent;
  var ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var android = /android/i.test(ua);
  var mobile = ios || android;
  var kakao = /KAKAOTALK/i.test(ua);
  var inapp = kakao || /NAVER\(inapp|NAVER|Instagram|FBAN|FBAV|FB_IAB|Line\/|DaumApps|everytimeApp|BAND\/|Whale\/.*inapp|; wv\)/i.test(ua);
  var samsung = /SamsungBrowser/i.test(ua);
  var dp = null, btn = null;

  function makeBtn() {
    if (btn) return btn;
    btn = document.createElement("button");
    btn.type = "button"; btn.className = "theme-btn"; btn.id = "install-btn";
    btn.textContent = "⬇ 앱 설치"; btn.title = "WIDI를 휴대폰·PC에 앱으로 설치"; btn.style.display = "none";
    var t = document.getElementById("theme-btn");
    if (t && t.parentNode) t.parentNode.insertBefore(btn, t); else (document.querySelector("header") || document.body).appendChild(btn);
    btn.addEventListener("click", onClick);
    return btn;
  }
  function show() { makeBtn().style.display = ""; }

  function openOutside() {
    var url = location.href;
    if (kakao) { location.href = "kakaotalk://web/openExternal?url=" + encodeURIComponent(url); return true; }
    if (android) {
      location.href = "intent://" + url.replace(/^https?:\/\//, "") + "#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=" + encodeURIComponent(url) + ";end";
      return true;
    }
    return false;
  }

  function onClick() {
    if (dp) { dp.prompt(); dp.userChoice.finally(function () { dp = null; btn.style.display = "none"; }); return; }
    if (inapp) {
      if (openOutside()) {
        hint(ios ? "Safari에서 열린 화면의 <b>공유(□↑)</b> → <b>홈 화면에 추가</b>를 누르면 설치됨."
                 : "크롬에서 열리면 다시 <b>「⬇ 앱 설치」</b>를 누르면 됨.");
        return;
      }
      hint(ios ? "이 앱 안에서는 설치가 안 됨. 오른쪽 아래·위 메뉴에서 <b>Safari로 열기</b> → <b>공유(□↑)</b> → <b>홈 화면에 추가</b>."
               : "이 앱 안에서는 설치가 안 됨. 메뉴에서 <b>다른 브라우저로 열기</b>(크롬) 후 다시 「⬇ 앱 설치」.");
      return;
    }
    if (ios) return hint("Safari 아래 <b>공유(□↑)</b> → <b>홈 화면에 추가</b>를 누르면 WIDI가 앱처럼 설치됨.");
    if (samsung) return hint("아래 메뉴(≡) → <b>현재 페이지 추가</b> → <b>홈 화면</b>을 누르면 설치됨.");
    hint("브라우저 메뉴(⋮) → <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 누르면 설치됨.");
  }

  function hint(html) {
    var old = document.getElementById("install-hint"); if (old) old.remove();
    var d = document.createElement("div"); d.id = "install-hint";
    d.style.cssText = "position:fixed;left:12px;right:12px;bottom:16px;z-index:9999;padding:12px 40px 12px 14px;border-radius:10px;background:#E3A456;color:#141917;font-size:14px;line-height:1.55;box-shadow:0 4px 16px rgba(0,0,0,.3)";
    d.innerHTML = html + "<span style='position:absolute;right:12px;top:10px;cursor:pointer;font-weight:700;font-size:16px'>✕</span>";
    d.querySelector("span").onclick = function () { d.remove(); };
    document.body.appendChild(d);
  }

  addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); dp = e; show(); });
  addEventListener("appinstalled", function () { if (btn) btn.style.display = "none"; var h = document.getElementById("install-hint"); if (h) h.remove(); });
  // 휴대폰은 설치 창 지원 여부와 관계없이 버튼을 보여 줌 (PC는 설치 가능할 때만)
  if (mobile) { document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", show) : show(); }
})();
