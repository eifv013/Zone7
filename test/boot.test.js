/* 시작 화면(Boot) 계산부 테스트. 실행: node --test test/boot.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const Boot = require('../src/boot.js');

const all = b => Boot.STAGES.forEach(s => b.mark(s.id));

test('단계는 순서대로 커지고 마지막은 100%다', () => {
  let prev = 0;
  for (const s of Boot.STAGES) { assert.ok(s.upTo > prev && s.text); prev = s.upTo; }
  assert.equal(prev, 1);
});

test('막대는 실제 진행을 넘지 않는다', () => {
  const b = Boot.createBoot({ now: 1000 });
  assert.equal(b.shown(1000 + 60000), 0);              // 아무것도 안 끝났으면 시간이 흘러도 0
  b.mark('page');
  assert.equal(b.shown(1000 + 60000), 0.25);
  b.mark('code');
  assert.equal(b.shown(1000 + 60000), 0.55);
});

test('준비가 순식간에 끝나도 최소 시간 동안 차오른다', () => {
  const b = Boot.createBoot({ now: 0, minMs: 1000 });
  all(b);
  assert.equal(b.shown(0), 0);
  assert.equal(b.shown(500), 0.5);
  assert.equal(b.shown(1000), 1);
  assert.equal(b.shown(5000), 1);
  assert.equal(b.canClose(999), false);
  assert.equal(b.canClose(1000), true);
});

test('준비가 안 끝나면 최소 시간이 지나도 닫지 않는다', () => {
  const b = Boot.createBoot({ now: 0, minMs: 1000, maxMs: 8000 });
  b.mark('page'); b.mark('code'); b.mark('save');
  assert.equal(b.canClose(5000), false);
  b.mark('ready');
  assert.equal(b.canClose(5000), true);
});

test('끝내 준비되지 않아도 최대 시간이 지나면 닫는다', () => {
  const b = Boot.createBoot({ now: 0, minMs: 1000, maxMs: 8000 });
  b.mark('page');
  assert.equal(b.canClose(7999), false);
  assert.equal(b.timedOut(7999), false);
  assert.equal(b.canClose(8000), true);
  assert.equal(b.timedOut(8000), true);
  const ok = Boot.createBoot({ now: 0 }); all(ok);
  assert.equal(ok.timedOut(99999), false);             // 준비가 끝난 경우는 시간 초과가 아니다
});

test('skip 은 당장 닫게 한다', () => {
  const b = Boot.createBoot({ now: 0 });
  assert.equal(b.canClose(1), false);
  b.skip();
  assert.equal(b.canClose(1), true);
  assert.equal(b.timedOut(1), false);
});

test('뒤 단계를 마치면 앞 단계도 마친 것이고, 진행은 뒤로 가지 않는다', () => {
  const b = Boot.createBoot({ now: 0, minMs: 0 });
  b.mark('save');
  assert.equal(b.shown(0), 0.85);
  b.mark('page');
  assert.equal(b.shown(0), 0.85);
});

test('문구는 막대가 닿지 못한 첫 단계의 것이다', () => {
  const b = Boot.createBoot({ now: 0, minMs: 1000 });
  all(b);
  assert.equal(b.text(0), Boot.STAGES[0].text);
  assert.equal(b.text(300), Boot.STAGES[1].text);
  assert.equal(b.text(600), Boot.STAGES[2].text);
  assert.equal(b.text(900), Boot.STAGES[3].text);
  assert.equal(b.text(1000), Boot.STAGES[3].text);
});

test('이상한 입력에도 예외를 던지지 않는다', () => {
  for (const opts of [undefined, null, {}, { now: NaN, minMs: -5, maxMs: 'x' }, { now: 10, minMs: 500, maxMs: 100 }]) {
    const b = Boot.createBoot(opts);
    b.mark('없는 단계'); b.mark(null); b.mark();
    for (const now of [undefined, NaN, -1, 0, 1e15, 'x']) {
      const p = b.shown(now);
      assert.ok(p >= 0 && p <= 1);
      assert.equal(typeof b.text(now), 'string');
      assert.equal(typeof b.canClose(now), 'boolean');
    }
  }
  // maxMs 가 minMs 보다 작게 들어오면 minMs 로 올린다: 최소 시간 전에 시간 초과로 닫히지 않는다.
  const b = Boot.createBoot({ now: 0, minMs: 500, maxMs: 100 });
  assert.equal(b.canClose(200), false);
  assert.equal(b.canClose(500), true);
});

test('도움말은 언제나 목록 안의 한 줄이다', () => {
  for (const r of [() => 0, () => 0.5, () => 0.999999, () => 1, () => -3, () => NaN, null, undefined, () => 'x']) {
    assert.ok(Boot.TIPS.includes(Boot.pickTip(r)));
  }
  assert.equal(Boot.pickTip(() => 0), Boot.TIPS[0]);
  assert.equal(Boot.pickTip(() => 0.999999), Boot.TIPS[Boot.TIPS.length - 1]);
});

test('mount: 시작 화면이 없는 페이지에서도 같은 모양의 객체를 준다', () => {
  for (const doc of [null, undefined, { getElementById: () => null }, { getElementById: () => { throw new Error('x'); } }]) {
    const m = Boot.mount(doc, {});
    m.mark('ready'); m.skip();
  }
});
