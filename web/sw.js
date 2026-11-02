// WIDI 앱 설치용 서비스 워커 — 저장(캐시)하지 않고 항상 최신 자료를 네트워크에서 받음
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  // 같은 사이트의 GET만 그대로 전달 (로그인·Firestore 등 다른 주소 요청은 건드리지 않음)
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request));
});
