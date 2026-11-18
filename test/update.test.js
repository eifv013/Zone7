/*
 * Updater 단위 테스트 — 버전 비교와 새 버전 확인(가짜 fetch 사용).
 * 실제로 앱이 새 파일로 바뀌는 과정은 브라우저에서만 확인할 수 있다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../src/update.js');
const notes = require('../src/notes.js');
const pkg = require('../package.json');

const respond = (body, ok = true) => async () => ({ ok, json: async () => body });

test('버전 비교: 자리마다 숫자로 비교한다', () => {
  assert.equal(U.isNewer('0.3.6', '0.3.5'), true);
  assert.equal(U.isNewer('0.3.10', '0.3.9'), true, '문자열 비교가 아니다');
  assert.equal(U.isNewer('0.4', '0.3.9'), true);
  assert.equal(U.isNewer('1.0.0', '0.9.9'), true);
  assert.equal(U.isNewer('0.3.5', '0.3.5'), false);
  assert.equal(U.isNewer('0.3.5', '0.3.5.0'), false, '끝의 0 은 같은 버전');
  assert.equal(U.isNewer('0.3.4', '0.3.5'), false, '예전 버전으로는 권하지 않는다');
});

test('읽을 수 없는 버전은 새 버전으로 보지 않는다', () => {
  for (const bad of ['', 'v0.3.6', '0.3.x', '알파 0.3.6', null, undefined, 36, '1..2']) {
    assert.equal(U.isNewer(bad, '0.3.5'), false, String(bad));
    assert.equal(U.isNewer('0.3.6', bad), false, String(bad));
  }
  assert.deepEqual(U.parse(' 0.3.6 '), [0, 3, 6]);
});

test('새 버전 확인: 새 버전이면 이름과 내용을 돌려준다', async () => {
  const r = await U.checkRemote(respond({ version: '0.4.0', name: '알파 0.4', title: '새 구역', items: ['가', 7, '나'] }), 'version.json', '0.3.6');
  assert.deepEqual(r, { available: true, info: { version: '0.4.0', name: '알파 0.4', title: '새 구역', items: ['가', '나'] } });
});

test('새 버전 확인: 같거나 예전 버전, 깨진 응답, 오프라인은 모두 "없음"이고 오류를 던지지 않는다', async () => {
  const none = { available: false };
  assert.deepEqual(await U.checkRemote(respond({ version: '0.3.6' }), 'v', '0.3.6'), none);
  assert.deepEqual(await U.checkRemote(respond({ version: '0.3.1' }), 'v', '0.3.6'), none);
  assert.deepEqual(await U.checkRemote(respond({ version: '0.9.0' }, false), 'v', '0.3.6'), none, '서버 오류 응답');
  assert.deepEqual(await U.checkRemote(respond(null), 'v', '0.3.6'), none);
  assert.deepEqual(await U.checkRemote(respond('<html>'), 'v', '0.3.6'), none);
  assert.deepEqual(await U.checkRemote(async () => { throw new Error('offline'); }, 'v', '0.3.6'), none);
  assert.deepEqual(await U.checkRemote(async () => ({ ok: true, json: async () => { throw new Error('not json'); } }), 'v', '0.3.6'), none);
});

test('새 버전 확인은 저장해 둔 예전 응답을 받지 않도록 요청한다', async () => {
  let seen;
  await U.checkRemote(async (url, opt) => { seen = [url, opt]; return { ok: false }; }, 'version.json', '0.3.6');
  assert.match(seen[0], /^version\.json\?t=\d+$/);
  assert.deepEqual(seen[1], { cache: 'no-store' });
});

test('패치노트의 맨 위 버전이 package.json 의 버전과 같다', () => {
  assert.ok(Array.isArray(notes) && notes.length > 0);
  assert.ok(notes[0].ver.endsWith(' ' + pkg.version), `${notes[0].ver} vs ${pkg.version}`);
  notes.forEach(n => { assert.ok(n.ver && n.date && n.title && n.items.length > 0, n.ver); });
  // 낸 시각: 있으면 '연-월-일 시:분:초' 이고 날짜와 같은 날이며 실제로 있는 시각이다. 맨 위(현재 버전)에는 반드시 있다.
  assert.ok(notes[0].at, '현재 버전에는 낸 시각을 적는다');
  notes.forEach(n => {
    assert.match(n.date, /^\d{4}-\d{2}-\d{2}$/, n.ver);
    if (n.at === undefined) return;
    assert.match(n.at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, n.ver);
    assert.ok(n.at.startsWith(n.date + ' '), n.ver);
    const [h, m, sec] = n.at.slice(11).split(':').map(Number);
    assert.ok(h < 24 && m < 60 && sec < 60, n.ver);
  });
  const stamped = notes.filter(n => n.at).map(n => n.at);
  assert.deepEqual(stamped, stamped.slice().sort().reverse(), '시각은 위에서부터 최신 순이다');
  const versions = notes.map(n => n.ver.split(' ').pop());
  for (let i = 1; i < versions.length; i++) assert.equal(U.isNewer(versions[i - 1], versions[i]), true, '위에 있을수록 새 버전');
});

test('버전 번호: 끝자리는 9까지만 쓴다(0.x.9 다음은 가운데 자리가 오른다)', () => {
  const notes = require('../src/notes.js');
  for (const n of notes) {
    const parts = n.ver.replace('알파 ', '').split('.');
    if (parts.length === 3) { assert.ok(Number(parts[2]) <= 9, n.ver); if (Number(parts[0]) >= 1) assert.ok(Number(parts[1]) <= 9, n.ver + ': 가운데 자리도 9까지만(1.9.x 다음은 2.0.0). 0.x 때의 옛 번호는 그대로 둔다'); }
  }
  assert.equal(new Set(notes.map((n) => n.ver)).size, notes.length, '같은 번호가 둘 있으면 안 된다');
});
