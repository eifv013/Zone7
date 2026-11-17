/*
 * 7구역 알림 서버 — 아이폰(홈 화면에 추가한 웹 앱)에 알림을 보내기 위한 작은 서버.
 * ------------------------------------------------------------------------------
 * 왜 필요한가
 *   안드로이드 앱은 폰 안에서 "4시간 뒤에 알려 줘"를 스스로 예약한다. 웹 앱은 그럴 수 없고,
 *   바깥 서버가 그 시각에 "푸시"를 보내 주어야 한다. 이 파일이 그 서버다.
 *
 * 하는 일(주소 네 개)
 *   GET  /key       이 서버의 공개 키. 게임이 알림을 구독할 때 쓴다.
 *   POST /schedule  { endpoint, times: [시각(ms), ...] }  그 시각들에 알림을 보내 달라고 맡긴다(게임을 닫을 때).
 *   POST /cancel    { endpoint }                           맡긴 것을 취소한다(게임을 다시 열 때).
 *   GET  /          살아 있는지 확인용.
 *
 * 구조
 *   - 예약 하나가 Durable Object(Notice) 하나다. 이름은 알림 주소(endpoint)의 해시.
 *     시각이 되면 alarm() 이 불려서 푸시를 보내고, 남은 시각이 있으면 다음 알람을 건다.
 *   - 푸시에는 내용을 싣지 않는다(빈 푸시). 무슨 글을 띄울지는 폰의 서비스 워커(sw.js)가 정한다.
 *     내용을 실으려면 암호화가 필요한데, 무료 요금제의 계산 시간(한 번에 10ms)을 아끼려고 뺐다.
 *     덕분에 서버에는 "어디로, 언제"만 남고 게임 진행이나 이름 같은 것은 올라오지 않는다.
 *   - 서버의 열쇠(VAPID)는 처음 쓸 때 스스로 만들어 'keys' 라는 Durable Object 에 넣어 둔다.
 *     사람이 열쇠를 만들거나 어디에 붙여 넣을 필요가 없고, 저장소에도 올라가지 않는다.
 *
 * 막아 둔 것
 *   - 알림 주소는 알려진 푸시 서비스(애플, 구글, 모질라)의 https 주소만 받는다. 이 서버를 남의 주소를 두드리는 데 쓰지 못하게 한다.
 *   - 시각은 지금부터 MAX_AHEAD_MS(3일) 안의 것만, 한 번에 MAX_TIMES(4)개까지만 받는다.
 *   - 게임 사이트(ALLOWED_ORIGINS)에서 온 요청에만 CORS 를 허용한다.
 */
export const ALLOWED_ORIGINS = ['https://eifv013.github.io'];
export const PUSH_HOSTS = ['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com'];
export const MAX_TIMES = 4;
export const MAX_AHEAD_MS = 3 * 24 * 60 * 60 * 1000;
export const CONTACT = 'https://eifv013.github.io/Zone7/';      // 푸시 서비스가 문제를 알릴 때 쓰는 연락처(VAPID 의 sub)

/* ---------- 순수한 계산(테스트가 검사한다) ---------- */
const enc = new TextEncoder();
export function b64url(bytes) {
  let s = '';
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** 알림 주소가 받아도 되는 것인가: https 이고, 알려진 푸시 서비스의 주소여야 한다. */
export function validEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 2000) return false;
  let u;
  try { u = new URL(endpoint); } catch (e) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  return PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
}
/** 받은 시각 목록을 다듬는다: 숫자이고, 지금 이후 3일 안이며, 이른 순으로 4개까지. 잘못된 것은 버린다. */
export function cleanTimes(times, now) {
  if (!Array.isArray(times)) return [];
  return times
    .filter((t) => typeof t === 'number' && isFinite(t) && t > now && t <= now + MAX_AHEAD_MS)
    .map((t) => Math.floor(t))
    .sort((a, b) => a - b)
    .filter((t, i, all) => i === 0 || t !== all[i - 1])
    .slice(0, MAX_TIMES);
}
export function corsHeaders(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
/** 알림 주소로 Durable Object 의 이름을 만든다(주소 자체를 이름으로 쓰지 않으려고 해시한다). */
export async function nameFor(endpoint) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(endpoint)));
}
/**
 * 푸시 서비스에 낼 서명(VAPID). aud 는 알림 주소의 사이트, exp 는 12시간 뒤.
 * privateJwk 는 P-256 개인 키, publicKey 는 base64url 로 적은 공개 키(65바이트).
 */
export async function vapidHeader(endpoint, privateJwk, publicKey, nowMs) {
  const head = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 60 * 60, sub: CONTACT })));
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body));
  return 'vapid t=' + head + '.' + body + '.' + b64url(sig) + ', k=' + publicKey;
}
/** 새 열쇠 한 벌을 만든다 { privateJwk, publicKey }. */
export async function makeKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey), publicKey: b64url(await crypto.subtle.exportKey('raw', pair.publicKey)) };
}

/* ---------- 서버 ---------- */
function json(data, status, origin) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } });
}
async function keysOf(env) {
  const stub = env.NOTICE.get(env.NOTICE.idFromName('keys'));
  const res = await stub.fetch('https://do/keys');
  return res.json();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), origin = request.headers.get('Origin') || '';
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
      if (request.method === 'GET' && url.pathname === '/') return json({ ok: true, name: 'zone7-push' }, 200, origin);
      if (request.method === 'GET' && url.pathname === '/key') return json({ key: (await keysOf(env)).publicKey }, 200, origin);
      if (request.method === 'POST' && (url.pathname === '/schedule' || url.pathname === '/cancel')) {
        let body = null;
        try { body = await request.json(); } catch (e) { return json({ ok: false, reason: 'json' }, 400, origin); }
        if (!body || !validEndpoint(body.endpoint)) return json({ ok: false, reason: 'endpoint' }, 400, origin);
        const stub = env.NOTICE.get(env.NOTICE.idFromName(await nameFor(body.endpoint)));
        if (url.pathname === '/cancel') { await stub.fetch('https://do/cancel', { method: 'POST' }); return json({ ok: true }, 200, origin); }
        const times = cleanTimes(body.times, Date.now());
        if (!times.length) return json({ ok: false, reason: 'times' }, 400, origin);
        await stub.fetch('https://do/schedule', { method: 'POST', body: JSON.stringify({ endpoint: body.endpoint, times }) });
        return json({ ok: true, count: times.length }, 200, origin);
      }
      return json({ ok: false, reason: 'not-found' }, 404, origin);
    } catch (e) {
      return json({ ok: false, reason: 'error' }, 500, origin);
    }
  }
};

/**
 * 예약 하나(또는 'keys' 라는 이름일 때는 서버의 열쇠 보관함).
 * 저장하는 것: endpoint(알림 주소), times(남은 시각들). 열쇠 보관함은 privateJwk, publicKey.
 */
export class Notice {
  constructor(state, env) { this.state = state; this.env = env; }

  async fetch(request) {
    const path = new URL(request.url).pathname, store = this.state.storage;
    if (path === '/keys') {
      let keys = await store.get('keys');
      if (!keys) { keys = await makeKeys(); await store.put('keys', keys); }      // 처음 한 번만 만든다
      return Response.json(keys);
    }
    if (path === '/cancel') { await store.deleteAll(); await store.deleteAlarm(); return Response.json({ ok: true }); }
    if (path === '/schedule') {
      const body = await request.json();
      await store.put({ endpoint: body.endpoint, times: body.times });
      await store.setAlarm(body.times[0]);
      return Response.json({ ok: true });
    }
    return new Response('not found', { status: 404 });
  }

  /** 맡은 시각이 됐다: 푸시를 보내고, 남은 시각이 있으면 다음 알람을 건다. */
  async alarm() {
    const store = this.state.storage;
    const endpoint = await store.get('endpoint'), times = (await store.get('times')) || [];
    if (!endpoint || !times.length) { await store.deleteAll(); return; }
    const now = Date.now(), rest = times.filter((t) => t > now + 30000);      // 지금 보낼 것(지난 것과 30초 안의 것)을 빼고 남긴다
    let gone = false;
    try {
      const keys = await keysOf(this.env);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: await vapidHeader(endpoint, keys.privateJwk, keys.publicKey, now), TTL: '43200', Urgency: 'normal', 'Content-Length': '0' }
      });
      gone = res.status === 404 || res.status === 410;      // 구독이 사라졌다(앱을 지웠거나 알림을 껐다): 더 보내지 않는다
    } catch (e) { /* 이번 것은 놓친다. 남은 시각은 그대로 시도한다. */ }
    if (gone || !rest.length) { await store.deleteAll(); return; }
    await store.put('times', rest);
    await store.setAlarm(rest[0]);
  }
}
