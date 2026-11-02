// WIDI 회원 관리 앱 설치용 서비스 워커 — 캐시하지 않고 항상 네트워크에서 받음 (승인 목록은 늘 최신이어야 함)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => e.respondWith(fetch(e.request)));
