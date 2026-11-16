/*
 * Help 단위 테스트 — 도움말 글이 비지 않는지, 숫자가 게임 규칙(GameCore 상수)과 같은지 검사한다.
 * 화면에 어떻게 보이는지는 브라우저에서만 확인할 수 있다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../src/help.js');
const C = require('../src/core.js');

const all = () => H.sections(C);
const find = id => all().find(s => s.id === id);

test('도움말: 모든 항목에 제목과 글이 있다', () => {
  const list = all();
  assert.ok(list.length >= 8);
  assert.equal(new Set(list.map(s => s.id)).size, list.length, '항목 id 가 겹치지 않는다');
  for (const s of list) {
    assert.ok(s.title && typeof s.title === 'string');
    assert.ok(s.items.length >= 2, s.id);
    for (const line of s.items) {
      assert.equal(typeof line, 'string');
      assert.ok(line.length > 5);
      assert.ok(!/undefined|NaN|null|\[object/.test(line), '빈 값이 글에 섞였다: ' + line);
    }
  }
});

test('도움말: 구조 신호의 보상 설명이 실제 규칙과 같다', () => {
  const text = find('signal').items.join(' ');
  assert.ok(text.includes(C.SIGNAL_WINDOW + '초 안에'));
  assert.ok(text.includes(H.span(C.SIGNAL_SUPPLY_SECONDS) + '치 물자'));
  assert.ok(text.includes('최소 ' + C.SIGNAL_SUPPLY_MIN));
  assert.ok(text.includes(H.span(C.BUFF_SECONDS) + ' 동안 생산 ' + C.BUFF_MULT + '배'));
  assert.ok(text.includes(C.SIGNAL_MIN + '~' + (C.SIGNAL_MIN + C.SIGNAL_SPREAD) + '초마다'));
  // 실제로 응답했을 때 나오는 두 가지와 같은지
  const s = C.createState(0); s.signalLeft = 5;
  assert.equal(C.answerSignal(s, () => 0.9).seconds, C.BUFF_SECONDS);
});

test('도움말: 밤·자리 비움·이주의 숫자가 상수와 같다', () => {
  assert.ok(find('night').items.join(' ').includes('물자의 ' + Math.round(C.BREACH_LOSS * 100) + '%'));
  assert.ok(find('night').items.join(' ').includes(C.BOSS_EVERY + '번째 밤마다'));
  const away = find('away').items.join(' ');
  assert.ok(away.includes('최대 ' + C.OFFLINE_CAP / 3600 + '시간치'));
  assert.ok(away.includes(Math.round(C.OFFLINE_RATE * 100) + '% 효율'));
  assert.ok(find('move').items.join(' ').includes('생산이 ' + Math.round(C.ANTIBODY_BONUS * 100) + '%'));
  const gear = id => C.GEAR.find(g => g.id === id).baseCost;
  const auto = find('auto').items.join(' ');
  for (const id of ['warden', 'builder', 'operator']) assert.ok(auto.includes('부품 ' + gear(id) + '개'), id);
});

test('도움말: 표기 도우미', () => {
  assert.equal(H.pct(0.15), '15%');
  assert.equal(H.pct(0.1 + 0.2), '30%');
  assert.equal(H.span(14400), '4시간');
  assert.equal(H.span(600), '10분');
  assert.equal(H.span(90), '90초');
  assert.equal(H.span(60), '1분');
});

test('도움말: 규칙 모듈이 없거나 상수가 빠지면 조용히 넘어가지 않고 오류를 낸다', () => {
  assert.throws(() => H.sections(null), /GameCore/);
  assert.throws(() => H.sections({}), /상수/);
  const broken = Object.assign({}, C, { SIGNAL_WINDOW: undefined });
  assert.throws(() => H.sections(broken), /SIGNAL_WINDOW/);
  const noGear = Object.assign({}, C, { GEAR: [] });
  assert.throws(() => H.sections(noGear), /operator|warden|builder/);
});
