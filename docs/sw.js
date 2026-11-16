/*
 * 서비스 워커 — 설치형(홈 화면) 버전을 인터넷 없이도 열 수 있게 한다.
 *
 * 전략: "네트워크 먼저, 안 되면 저장해 둔 것"
 *   - 온라인이면 항상 최신 파일을 받아 오고, 받은 것을 저장소에 넣어 둔다(새 버전이 바로 반영된다).
 *   - 오프라인이거나 서버가 응답하지 않으면 마지막으로 저장해 둔 파일로 연다.
 * 게임 진행(저장 데이터)은 여기서 다루지 않는다. 그것은 페이지의 localStorage 에 있다.
 *
 * 0.6.4 은 빌드할 때 게임 버전으로 바뀐다. 버전이 달라지면 예전 저장소를 지운다.
 */
const CACHE = 'zone7-0.6.4';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './version.json'];

self.addEventListener('install', (event) => {
  // 일부 파일을 못 받아도 설치 자체는 진행한다(받은 것만 저장).
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(FILES.map((f) => cache.add(f).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // 같은 사이트의 GET 요청만 다룬다. 글꼴 등 다른 사이트 요청은 브라우저에 맡긴다.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html')))
  );
});
