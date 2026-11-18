/*
 * 서비스 워커 — 설치형(홈 화면) 버전을 인터넷 없이도 열 수 있게 한다.
 *
 * 전략: "네트워크 먼저, 안 되면 저장해 둔 것"
 *   - 온라인이면 항상 최신 파일을 받아 오고, 받은 것을 저장소에 넣어 둔다(새 버전이 바로 반영된다).
 *   - 오프라인이거나 서버가 응답하지 않으면 마지막으로 저장해 둔 파일로 연다.
 * 게임 진행(저장 데이터)은 여기서 다루지 않는다. 그것은 페이지의 localStorage 에 있다.
 *
 * 1.10.2 은 빌드할 때 게임 버전으로 바뀐다. 버전이 달라지면 예전 저장소를 지운다.
 */
const CACHE = 'zone7-1.10.2';
const NOTICE_CACHE = 'zone7-notice', NOTICE_PLAN = './notice-plan';      // 게임(ui.js)이 알림 목록을 적어 두는 곳
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== NOTICE_CACHE).map((k) => caches.delete(k))))      // 알림 목록은 지우지 않는다
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

/*
 * 알림(푸시): 알림 서버가 정해진 시각에 빈 푸시를 보내면 여기가 깨어난다.
 * 무슨 글을 띄울지는 게임이 닫힐 때 적어 둔 목록(NOTICE_PLAN)에서 고른다: 시각이 된 것 가운데 아직 안 띄운 가장 이른 것.
 * 목록이 없거나 읽지 못하면 기본 글을 띄운다(푸시를 받고 아무것도 띄우지 않으면 아이폰이 알림 허락을 거둬 간다).
 */
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let text = '거점에서 소식이 왔어요.';
    try {
      const box = await caches.open(NOTICE_CACHE), hit = await box.match(NOTICE_PLAN);
      if (hit) {
        const plan = await hit.json(), now = Date.now();
        const due = (plan.items || []).filter((it) => !it.shown && it.at <= now + 5 * 60000).sort((a, b) => a.at - b.at)[0];
        if (due) {
          text = due.text; due.shown = true;
          await box.put(NOTICE_PLAN, new Response(JSON.stringify(plan), { headers: { 'Content-Type': 'application/json' } }));
        }
      }
    } catch (e) { /* 기본 글을 쓴다 */ }
    await self.registration.showNotification('7구역', { body: text, icon: './icon-192.png', badge: './icon-192.png', tag: 'zone7' });
  })());
});

/* 알림을 누르면 게임을 연다: 이미 열려 있으면 그 창을 앞으로, 없으면 새로 연다. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) if ('focus' in w) return w.focus();
    return self.clients.openWindow('./');
  })());
});
