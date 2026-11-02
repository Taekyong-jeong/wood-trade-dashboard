// WIDI 회원 관리 앱 설치용 서비스 워커 — 캐시하지 않고 항상 네트워크에서 받음 (승인 목록은 늘 최신이어야 함)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  // 같은 사이트의 GET만 그대로 전달 (로그인·Firestore 등 다른 주소 요청은 건드리지 않음)
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request));
});
