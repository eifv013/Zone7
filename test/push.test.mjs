/*
 * 알림 서버(push/worker.js)의 순수한 계산을 검사한다. Cloudflare 없이 Node 에서 돈다.
 * 실제로 푸시가 나가는지, Durable Object 의 알람이 울리는지는 여기서 볼 수 없다(배포한 뒤 폰으로 확인해야 한다).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../push/worker.js';

test('알림 주소: 알려진 푸시 서비스의 https 주소만 받는다', () => {
  assert.equal(W.validEndpoint('https://web.push.apple.com/QGk2abc'), true);
  assert.equal(W.validEndpoint('https://fcm.googleapis.com/fcm/send/abc'), true);
  assert.equal(W.validEndpoint('https://api.sub.web.push.apple.com/x'), true);
  for (const bad of ['http://web.push.apple.com/x', 'https://evil.example/x', 'https://web.push.apple.com.evil.example/x', 'https://user:pw@web.push.apple.com/x',
    'not a url', '', null, undefined, 42, 'https://localhost/x', 'https://' + 'a'.repeat(3000) + '.fcm.googleapis.com/']) assert.equal(W.validEndpoint(bad), false, String(bad).slice(0, 40));
});

test('시각 목록: 지금 이후 3일 안의 숫자만, 이른 순으로 4개까지', () => {
  const now = 1_000_000;
  assert.deepEqual(W.cleanTimes([now + 5000, now + 1000, now + 1000, now - 1, 'x', NaN, now + W.MAX_AHEAD_MS + 1], now), [now + 1000, now + 5000]);
  assert.deepEqual(W.cleanTimes([1, 2, 3, 4, 5, 6].map((k) => now + k * 1000.7), now).length, 4);
  for (const bad of [null, undefined, 'x', {}, 5]) assert.deepEqual(W.cleanTimes(bad, now), []);
});

test('CORS: 게임 사이트에서 온 요청에만 그 주소를 돌려준다', () => {
  assert.equal(W.corsHeaders('https://eifv013.github.io')['Access-Control-Allow-Origin'], 'https://eifv013.github.io');
  assert.equal(W.corsHeaders('https://evil.example')['Access-Control-Allow-Origin'], 'https://eifv013.github.io');
});

test('서명(VAPID): 만든 열쇠로 서명한 것이 공개 키로 검증된다', async () => {
  const keys = await W.makeKeys();
  assert.equal(Buffer.from(keys.publicKey, 'base64url').length, 65);
  const now = Date.now(), endpoint = 'https://web.push.apple.com/abc';
  const header = await W.vapidHeader(endpoint, keys.privateJwk, keys.publicKey, now);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
  assert.ok(m, header);
  assert.equal(m[4], keys.publicKey);
  const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString());
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.ok(claims.exp > now / 1000 && claims.exp <= now / 1000 + 24 * 3600, '유효 기간은 24시간을 넘지 않는다');
  assert.ok(claims.sub.startsWith('https://'));
  const pub = await crypto.subtle.importKey('raw', Buffer.from(keys.publicKey, 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, Buffer.from(m[3], 'base64url'), Buffer.from(m[1] + '.' + m[2]));
  assert.equal(ok, true);
});

test('서버: 주소마다 올바로 답하고, 잘못된 요청은 거절한다(Durable Object 는 흉내 낸 것)', async () => {
  const calls = [];
  const env = { NOTICE: { idFromName: (n) => n, get: (id) => ({ fetch: async (u, init) => { calls.push([id.length > 10 ? 'sub' : id, new URL(u).pathname, init && init.body]); return Response.json({ publicKey: 'PUB', privateJwk: {} }); } }) } };
  const call = (path, init) => W.default.fetch(new Request('https://x.workers.dev' + path, init), env);
  assert.equal((await call('/')).status, 200);
  assert.deepEqual(await (await call('/key')).json(), { key: 'PUB' });
  assert.equal((await call('/nothing')).status, 404);
  assert.equal((await call('/schedule', { method: 'OPTIONS' })).status, 204);
  const post = (path, body) => call(path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { Origin: 'https://eifv013.github.io' } });
  assert.equal((await post('/schedule', '{broken')).status, 400);
  assert.equal((await post('/schedule', { endpoint: 'https://evil.example/x', times: [Date.now() + 5000] })).status, 400);
  assert.equal((await post('/schedule', { endpoint: 'https://web.push.apple.com/x', times: [1] })).status, 400);
  const ok = await post('/schedule', { endpoint: 'https://web.push.apple.com/x', times: [Date.now() + 5000, Date.now() + 9000] });
  assert.deepEqual(await ok.json(), { ok: true, count: 2 });
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://eifv013.github.io');
  assert.equal((await post('/cancel', { endpoint: 'https://web.push.apple.com/x' })).status, 200);
  assert.deepEqual(calls.map((c) => c[1]), ['/keys', '/schedule', '/cancel']);
});
