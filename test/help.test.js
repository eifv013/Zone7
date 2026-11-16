/* Help 단위 테스트 — 도움말 글이 비지 않는지, 숫자가 게임 규칙(GameCore 상수)과 같은지 검사한다. */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../src/help.js');
const C = require('../src/core.js');
const find = id => H.sections(C).find(s => s.id === id).items.join(' ');

test('도움말: 모든 항목에 제목과 글이 있고 빈 값이 섞이지 않는다', () => {
  const list = H.sections(C);
  assert.ok(list.length >= 8);
  assert.equal(new Set(list.map(s => s.id)).size, list.length);
  for (const s of list) {
    assert.ok(s.title && s.items.length >= 2, s.id);
    for (const line of s.items) { assert.ok(line.length > 5); assert.ok(!/undefined|NaN|null|\[object/.test(line), line); }
  }
});

test('도움말: 숫자가 규칙의 상수와 같다', () => {
  assert.ok(find('night').includes('물자의 ' + Math.round(C.BREACH_LOSS * 100) + '%'));
  assert.ok(find('night').includes(C.BOSS_EVERY + '번째 밤마다'));
  assert.ok(find('night').includes((C.DAY_SECONDS - C.BATTLE_SECONDS) + '초가 지나면'));
  assert.ok(find('trade').includes(C.PRICE_FLOOR + ' ~ ' + C.PRICE_CEIL));
  assert.ok(find('trade').includes('시세 ' + C.PEAK_PRICE + ' 이상'));
  assert.ok(find('line').includes('가동률 ' + Math.round(C.STEADY_AT * 100) + '% 이상'));
  assert.ok(find('line').includes('산출이 ' + Math.round(C.STEADY_BONUS * 100) + '% 늘어나요'));
  for (const m of C.MACHINES) assert.ok(find('line').includes(m.name + ' ' + m.rate), m.id);
  for (const r of C.ROUTES) assert.ok(find('rail').includes(r.name + '(') && find('rail').includes('화물 ×' + r.mult), r.id);
  assert.ok(find('rail').includes('열차 ' + C.ROUTE_SLOTS + '대가'));
  assert.ok(find('retreat').includes('물자 ' + C.formatNumber(C.RETREAT_MIN)));
  assert.ok(find('away').includes('최대 ' + C.OFFLINE_CAP / 3600 + '시간치'));
  assert.ok(find('signal').includes(C.SIGNAL_WINDOW + '초 안에'));
  for (const t of C.TRAITS) assert.ok(find('trait').includes(t.name), t.id);
  for (const p of C.PERKS) assert.ok(find('trait').includes(p.name), p.id);
});

test('도움말: 만들어진 구역과 다음 구역을 정의표에서 읽어 적는다', () => {
  const flow = find('flow');
  C.ZONES.filter(z => z.kind !== 'soon').forEach(z => assert.ok(flow.includes(z.no + '구역 ' + z.name), z.name));
  const next = C.ZONES.find(z => z.kind === 'soon');
  assert.ok(flow.includes(next.no + '구역 ' + next.name));
});

test('도움말: 규칙 모듈이 없거나 상수가 빠지면 오류를 낸다', () => {
  assert.throws(() => H.sections(null), /GameCore/);
  assert.throws(() => H.sections({}), /상수/);
  assert.throws(() => H.sections(Object.assign({}, C, { PRICE_STEP: undefined })), /PRICE_STEP/);
  assert.equal(H.pct(0.15), '15%');
  assert.equal(H.span(14400), '4시간');
  assert.equal(H.span(90), '90초');
});

test('도움말: 받침에 따라 은/는을 고른다', () => {
  assert.equal(H.topic('환승역'), '환승역은');
  assert.equal(H.topic('주택가'), '주택가는');
  assert.equal(H.topic('대학 병원'), '대학 병원은');
  assert.equal(H.topic('송신탑'), '송신탑은');
  assert.equal(H.topic('Zone'), 'Zone는');
  assert.doesNotThrow(() => H.topic(''));
  const next = C.ZONES.find(z => z.kind === 'soon');
  assert.ok(find('flow').includes(H.topic(next.name) + ' 문 앞까지만'));
});
