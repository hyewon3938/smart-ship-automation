const CACHE_NAME = "smart-ship-v2";
const STATIC_ASSETS = ["/manifest.json"];

// 설치: 정적 자산 캐시
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// 활성화: 이전 캐시 정리
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// 페치: Network-first (API/인증은 항상 네트워크, 정적 자산은 캐시 폴백)
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API 요청은 항상 네트워크
  if (url.pathname.startsWith("/api/")) return;

  // 로그인 페이지는 캐시하지 않음
  if (url.pathname === "/login") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 리다이렉트 응답(인증 실패 → /login)은 캐시하지 않음
        if (response.redirected || response.status === 307 || response.status === 302) {
          return response;
        }
        const clone = response.clone();
        caches
          .open(CACHE_NAME)
          .then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
