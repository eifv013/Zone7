/*
 * GameCore 단위 테스트 (알파 0.6 의 새 구조)
 * 실행: npm test
 * 화면 코드는 여기서 검사하지 않는다. 화면은 tools/smoke.py 가 브라우저로 돌려 본다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');

/** 새 판. 자동 보조(전력 투입·청신호를 알아서 쓰는 것)는 꺼 둔다: 규칙 하나하나를 따로 재기 위해서다. 자동 보조는 맨 아래에서 따로 시험한다. */
const fresh = () => { const s = C.createState(0); s.autoAssist = false; return s; };
const half = () => 0.5;
/** 1구역 목표를 모두 채우고 2구역을 연 상태. */
function inMarket() {
  const s = fresh();
  C.GOALS[0].forEach(g => { s.goalsDone[g.id] = true; });
  s.supplies = C.ZONES[1].cost;
  assert.ok(C.openZone(s).ok);
  return s;
}
/** 3구역(공단)까지 연 상태. 앞 구역의 목표는 채운 것으로 둔다. */
function inFactory() {
  const s = inMarket();
  C.GOALS[1].forEach(g => { s.goalsDone[g.id] = true; });
  s.zone = 2; s.bestZone = 2;
  return s;
}
/** 4구역(환승역)까지 연 상태. */
function inStation() {
  const s = inFactory();
  C.GOALS[2].forEach(g => { s.goalsDone[g.id] = true; });
  s.zone = 3; s.bestZone = 3;
  return s;
}
/** 5구역(대학 병원)까지 연 상태. */
function inLab() {
  const s = inStation();
  C.GOALS[3].forEach(g => { s.goalsDone[g.id] = true; });
  s.zone = 4; s.bestZone = 4;
  return s;
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-9), `${msg || ''} ${a} ≠ ${b}`);

/* ================= 상태와 저장 ================= */

test('새 게임: 1구역에서 빈손으로 시작한다', () => {
  const s = fresh();
  assert.equal(s.version, C.SAVE_VERSION);
  assert.equal(s.zone, 0);
  assert.equal(s.supplies, 0);
  assert.equal(C.productionPerSec(s), 0);
  assert.equal(C.zoneLabel(s), '1구역 주택가');
  assert.equal(C.ZONES.length, 7);
});

test('저장: 직렬화를 거쳐도 같고, 깨진 값과 모르는 항목을 안전하게 읽는다', () => {
  const s = inMarket();
  s.buildings.scouts = 12; s.stalls = 3; s.goods = 5; s.traits.immune = 2; s.perks.harvest = 1; s.antibodies = 7; s.story['z1-0'] = true;
  s.runLog = [{ zone: 1, seconds: 100, antibodies: 4 }];
  const back = C.deserialize(C.serialize(s), 0);
  assert.deepEqual(back, s);
  const bad = C.sanitizeState({ version: 2, supplies: -5, zone: 99, buildings: { scouts: 'x', nothing: 9 }, stalls: 1e9, price: 999, dayClock: NaN,
    traits: { immune: 9999 }, pendingPerks: ['harvest', 'nothing', 42], goalsDone: { z1a: 1, fake: 1 }, story: { 'z1-0': true, fake: true },
    runLog: [null, { zone: 1, seconds: 5, antibodies: 2 }, 'x'], buff: { mult: 99, left: 1e9 } }, 0);
  assert.equal(bad.supplies, 0);
  assert.equal(bad.zone, 4, '아직 없는 구역에는 들어가 있을 수 없다');
  assert.equal(C.ZONES[5].kind, 'soon');
  assert.equal(bad.buildings.scouts, 0);
  assert.equal(bad.buildings.nothing, undefined);
  assert.equal(bad.stalls, C.COUNT_MAX);
  assert.equal(bad.price, C.PRICE_CEIL);
  assert.equal(bad.dayClock, 0);
  assert.equal(bad.traits.immune, C.TRAITS.find(t => t.id === 'immune').max);
  assert.deepEqual(bad.pendingPerks, ['harvest']);
  assert.deepEqual(Object.keys(bad.goalsDone), ['z1a']);
  assert.deepEqual(Object.keys(bad.story), ['z1-0']);
  assert.equal(bad.runLog.length, 1);
  assert.ok(bad.buff.mult <= 10 && bad.buff.left <= 600);
  for (const junk of [null, 42, 'x', [], undefined]) assert.equal(C.sanitizeState(junk, 0).zone, 0);
});

test('저장: 예전 구조(버전 1)의 저장과 잘못된 글은 거절한다', () => {
  assert.throws(() => C.deserialize(JSON.stringify({ version: 1, relocations: 30 }), 0), /새로 시작/);
  assert.throws(() => C.deserialize('', 0), /비어/);
  assert.throws(() => C.deserialize('{잘린', 0), /읽을 수 없/);
  assert.throws(() => C.deserialize('[1,2]', 0), /형식/);
});

/* ================= 1구역: 수색 ================= */

test('시설: 값은 살 때마다 1.15배, 여러 개를 한 번에 사면 합계를 낸다', () => {
  const s = fresh(); s.supplies = 1e6;
  assert.equal(C.buildingCost(s, 'scouts', 1), 15);
  assert.equal(C.buildingCost(s, 'scouts', 3), Math.ceil(15 * (Math.pow(1.15, 3) - 1) / 0.15));
  assert.ok(C.buyBuilding(s, 'scouts', 3).ok);
  assert.equal(s.buildings.scouts, 3);
  assert.equal(C.buildingCost(s, 'scouts', 1), Math.ceil(15 * Math.pow(1.15, 3)));
  near(C.productionPerSec(s), 1.5);
  const poor = fresh();
  assert.equal(C.buyBuilding(poor, 'scouts', 1).reason, 'supplies');
  assert.equal(C.buyBuilding(poor, 'nothing', 1).ok, false);
  assert.equal(C.buyBuilding(poor, 'scouts', 0).ok, false);
  assert.equal(C.buildingCost(poor, 'scouts', C.COUNT_MAX + 1), Infinity);
});

test('시설: 10·25·50곳에서 그 시설의 생산이 2배씩 된다', () => {
  const s = fresh();
  s.buildings.garden = 9; const nine = C.buildingRate(s, 'garden');
  s.buildings.garden = 10; near(C.buildingRate(s, 'garden'), nine / 9 * 10 * 2);
  s.buildings.garden = 25; near(C.buildingRate(s, 'garden'), 4 * 25 * 4);
  assert.equal(C.milestoneMult(0), 1);
});

test('시설: 살 수 있는 최대 수는 실제로 살 수 있는 수와 같다', () => {
  const s = fresh(); s.supplies = 5000;
  const n = C.maxBuildings(s, 'scouts');
  assert.ok(n > 10);
  assert.ok(C.buildingCost(s, 'scouts', n) <= 5000);
  assert.ok(C.buildingCost(s, 'scouts', n + 1) > 5000);
  assert.equal(C.maxBuildings(s, 'nothing'), 0);
});

test('직접 수색: 수색 배수가 두 배가 될 때마다 실제 배수가 1씩 늘어, 누르기가 방치를 압도하지 못한다', () => {
  const s = fresh();
  assert.equal(C.clickValue(s), 1);
  const r = C.scavenge(s);
  assert.equal(r.gain, 1);
  assert.equal(s.supplies, 1);
  assert.equal(s.clicks, 1);
  s.upgrades.crowbar = 1;
  assert.equal(C.clickPower(s), 2, '첫 쇠지렛대는 2배');
  s.upgrades.crowbar = 12; s.traits.quick = 15; s.perks.hands = 10;
  s.buildings.garden = 100; s.buildings.workshop = 50;
  assert.ok(C.clickPower(s) < 15);
  assert.ok(C.clickValue(s) * 6 < C.productionPerSec(s), '전부 올리고 초당 6번을 눌러도 생산보다 적다');
});

/* ================= 구역 강화와 보너스 ================= */

test('구역 강화: 레벨마다 값이 오르고 효과가 쌓이며, 최대 레벨에서 멈춘다', () => {
  const s = fresh(); s.supplies = 1e30; s.buildings.scouts = 10;
  const base = C.productionPerSec(s);
  assert.equal(C.upgradeCost(s, 'maps'), 400);
  assert.ok(C.buyUpgrade(s, 'maps').ok);
  assert.equal(C.upgradeCost(s, 'maps'), Math.ceil(400 * 2.4));
  near(C.productionPerSec(s), base * 1.25);
  const def = C.UPGRADES.find(u => u.id === 'maps');
  while (C.buyUpgrade(s, 'maps').ok) { /* 끝까지 */ }
  assert.equal(s.upgrades.maps, def.max);
  assert.equal(C.upgradeCost(s, 'maps'), Infinity);
  assert.equal(C.buyUpgrade(s, 'maps').reason, 'max');
  assert.equal(C.buyUpgrade(s, 'nothing').ok, false);
});

test('구역 강화: 아직 열지 않은 구역의 강화는 살 수 없다', () => {
  const s = fresh(); s.supplies = 1e30;
  assert.equal(C.buyUpgrade(s, 'haggle').reason, 'locked');
  assert.equal(C.upgradeCost(s, 'haggle'), Infinity);
  const m = inMarket(); m.supplies = 1e30;
  assert.ok(C.buyUpgrade(m, 'haggle').ok);
});

test('보너스: 할인은 곱으로 쌓이고 80% 아래로는 내려가지 않는다', () => {
  const s = fresh();
  s.upgrades.cart = 2;
  near(C.mods(s).z1cost, 0.96 * 0.96);
  assert.equal(C.buildingCost(s, 'scouts', 1), Math.ceil(15 * 0.96 * 0.96));
  s.perks.frugal = 100; s.traits.thrift = 12;
  assert.equal(C.mods(s).cost, 0.2);
  assert.ok(C.buildingCost(s, 'scouts', 1) >= 1);
});

/* ================= 구역 목표와 다음 구역 ================= */

test('목표: 채우면 달성되고 특전 선택이 걸린다. 고르기 전에는 다음 목표를 달성 처리하지 않는다', () => {
  const s = fresh();
  s.buildings.scouts = 60; s.buildings.garden = 200;      // 목표 둘을 한꺼번에 채웠다
  const ev = C.tick(s, 0.1, half).filter(e => e.type === 'goal');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].id, 'z1a');
  assert.equal(s.pendingPerks.length, C.PERK_CHOICES);
  assert.equal(new Set(s.pendingPerks).size, C.PERK_CHOICES, '겹치지 않는 세 장');
  assert.equal(C.tick(s, 0.1, half).filter(e => e.type === 'goal').length, 0);
  assert.equal(C.choosePerk(s, 'nothing').ok, false);
  const pick = s.pendingPerks[0];
  assert.ok(C.choosePerk(s, pick).ok);
  assert.equal(s.perks[pick], 1);
  assert.deepEqual(s.pendingPerks, []);
  assert.equal(C.tick(s, 0.1, half).filter(e => e.type === 'goal')[0].id, 'z1b');
  const view = C.goals(s, 0);
  assert.deepEqual(view.map(g => g.done), [true, true, false]);
  assert.ok(view[0].value <= view[0].need);
});

test('다음 구역: 목표를 다 채우고 값을 치러야 열리고, 열어도 앞 구역은 그대로 남는다', () => {
  const s = fresh(); s.supplies = 1e12; s.buildings.scouts = 30;
  assert.equal(C.openZone(s).reason, 'goals');
  C.GOALS[0].forEach(g => { s.goalsDone[g.id] = true; });
  const n = C.nextZone(s);
  assert.equal(n.zone.name, '재래시장');
  assert.equal(n.cost, C.ZONES[1].cost);
  s.supplies = 100;
  assert.equal(C.openZone(s).reason, 'supplies');
  s.supplies = C.ZONES[1].cost + 5;
  const before = C.searchRate(s);
  const r = C.openZone(s);
  assert.ok(r.ok && !r.soon);
  assert.equal(s.zone, 1);
  assert.equal(s.supplies, 5);
  assert.equal(s.buildings.scouts, 30, '1구역 시설은 남는다');
  assert.equal(C.searchRate(s), before, '1구역은 계속 번다');
});

test('다음 구역: 아직 만들지 않은 구역은 문 앞까지만 간다', () => {
  const s = inLab();
  C.GOALS[4].forEach(g => { s.goalsDone[g.id] = true; });
  const n = C.nextZone(s);
  assert.equal(n.soon, true);
  s.supplies = n.cost;
  const r = C.openZone(s);
  assert.ok(r.ok && r.soon);
  assert.equal(s.zone, 4, '들어가지는 못한다');
  assert.equal(s.gate, true);
  assert.equal(s.bestZone, 5);
  assert.equal(s.supplies, 0);
  s.supplies = 1e40;
  assert.equal(C.openZone(s).reason, 'soon', '두 번 치르지 않는다');
  s.buildings.scouts = 1; s.defenses.rail = 1e5; s.clicks = 1;
  assert.equal(C.guide(s).id, 'retreat');
});

/* ================= 2구역: 거래 ================= */

test('거래: 2구역을 열기 전에는 좌판도 판매도 없다', () => {
  const s = fresh(); s.supplies = 1e30;
  assert.equal(C.buyStall(s, 1).reason, 'locked');
  assert.equal(C.stallCost(s, 1), Infinity);
  assert.equal(C.sellGoods(s).reason, 'locked');
  assert.equal(C.tradeRate(s), 0);
  s.stalls = 5;
  assert.equal(C.goodsRate(s), 0);
});

test('거래: 좌판이 상품을 만들고 창고가 차면 멈춘다. 팔면 시세만큼 물자가 된다', () => {
  const s = inMarket(); s.supplies = 1e9; s.autoSell = false;
  assert.ok(C.buyStall(s, 4).ok);
  assert.equal(C.goodsRate(s), 4);
  C.tick(s, 5, half);
  near(s.goods, 20);
  C.tick(s, 9999, half);
  assert.equal(s.goods, C.goodsCap(s));
  assert.equal(C.goodsCap(s), 4 * C.GOODS_CAP_SECONDS);
  s.price = 1.5;
  const before = s.supplies, goods = s.goods;
  const r = C.sellGoods(s);
  assert.ok(r.ok);
  near(r.gain, goods * 1.5 * C.goodsValue(s));
  near(s.supplies, before + r.gain);
  assert.equal(s.goods, 0);
  near(s.tradeEarned, r.gain);
  assert.equal(C.sellGoods(s).reason, 'empty');
});

test('거래: 시세는 10초마다 범위 안에서 바뀌고, 강화로 범위가 넓어진다', () => {
  const s = inMarket();
  C.tick(s, C.PRICE_STEP, () => 0);
  assert.equal(s.price, C.PRICE_FLOOR);
  C.tick(s, C.PRICE_STEP, () => 0.999999);
  near(Math.round(s.price * 100) / 100, C.PRICE_CEIL);
  C.tick(s, C.PRICE_STEP - 1, () => 0);
  near(Math.round(s.price * 100) / 100, C.PRICE_CEIL, '10초가 차기 전에는 그대로다');
  s.upgrades.haggle = 3; s.upgrades.regular = 5;
  const r = C.priceRange(s);
  near(r.floor, 0.8); near(r.ceil, 3); near(r.mean, 1.9);
  for (const roll of [0, 0.3, 0.7, 0.999]) { C.tick(s, C.PRICE_STEP, () => roll); assert.ok(s.price >= r.floor - 1e-9 && s.price <= r.ceil + 1e-9); }
});

test('거래: 자동 판매는 창고가 차면 판다. 거간꾼이 있으면 좋은 시세에 미리 판다', () => {
  const s = inMarket(); s.stalls = 10;
  const sold = [];
  for (let i = 0; i < 200; i++) C.tick(s, 1, half).forEach(e => { if (e.type === 'sold') sold.push(e); });
  assert.ok(sold.length >= 2, '가만히 둬도 팔린다');
  sold.forEach(e => assert.equal(e.auto, true));
  assert.ok(s.tradeEarned > 0);
  // 거간꾼: 평균 이상이면 창고의 1/4 만 차도 판다
  const b = inMarket(); b.stalls = 10; b.upgrades.broker = 1; b.price = 1.9; b.goods = C.goodsCap(b) * 0.3; b.priceClock = 0;
  assert.ok(C.tick(b, 0.1, half).some(e => e.type === 'sold'));
  const low = inMarket(); low.stalls = 10; low.upgrades.broker = 1; low.price = 0.6; low.goods = C.goodsCap(low) * 0.3;
  assert.ok(!C.tick(low, 0.1, half).some(e => e.type === 'sold'), '낮은 시세에서는 기다린다');
  const off = inMarket(); off.stalls = 10; C.setAutoSell(off, false);
  for (let i = 0; i < 200; i++) assert.ok(!C.tick(off, 1, half).some(e => e.type === 'sold'));
});

test('거래: 고점에서 판 횟수를 세고, 직접 고점에 파는 이득은 평균의 두 배를 넘지 않는다', () => {
  const s = inMarket(); s.stalls = 5; s.goods = 10; s.price = C.PEAK_PRICE;
  assert.equal(C.sellGoods(s).peak, true);
  assert.equal(s.peakSales, 1);
  s.goods = 10; s.price = C.PEAK_PRICE - 0.01;
  assert.equal(C.sellGoods(s).peak, false);
  assert.equal(s.peakSales, 1);
  assert.ok(C.PRICE_CEIL / C.priceRange(inMarket()).mean < 2);
});

/* ================= 밤과 방벽 ================= */

test('밤: 방어력이 무리 규모 이상이면 막고 전리품을 얻는다. 무리는 밤마다 커진다', () => {
  const s = fresh(); s.supplies = 1e6;
  assert.equal(C.nightStrength(s), C.HORDE_BASE);
  assert.equal(C.defensePower(s), C.BASE_DEFENSE);
  C.buyDefense(s, 'wire', 1);
  assert.equal(C.defensePower(s), 9);
  const before = s.supplies;
  const ev = C.resolveNight(s);
  assert.equal(ev.type, 'defended');
  assert.equal(s.wavesCleared, 1);
  assert.equal(s.day, 2);
  assert.equal(s.supplies, before + ev.reward);
  assert.equal(C.nightStrength(s), Math.round(C.HORDE_BASE * C.HORDE_GROWTH));
  assert.equal(C.strengthAt(s, 10), Math.round(C.HORDE_BASE * Math.pow(C.HORDE_GROWTH, 9) * C.BOSS_STRENGTH), '10번째 밤은 변이체');
  const m = inMarket();
  assert.equal(C.nightStrength(m), C.HORDE_BASE * 3, '구역을 열면 무리도 커진다');
});

test('밤: 처음 뚫리면 15% 를 잃고 농성에 들어가며, 농성 중에는 더 잃지 않는다', () => {
  const s = fresh(); s.supplies = 1000;
  const a = C.resolveNight(s);
  assert.equal(a.type, 'breached');
  assert.equal(s.supplies, 850);
  assert.equal(s.siege, true);
  const b = C.resolveNight(s);
  assert.equal(b.type, 'held');
  assert.equal(s.supplies, 850);
  assert.equal(s.wavesCleared, 0);
  s.defenses.wire = 5;
  assert.equal(C.resolveNight(s).type, 'defended');
  assert.equal(s.siege, false);
});

test('방어 계획: 오늘 밤을 막는 가장 싼 보강을 알려 주고, 그대로 사면 막을 수 있다', () => {
  const s = fresh(); s.wavesCleared = 20; s.supplies = 1e9;
  const plan = C.defensePlan(s);
  assert.ok(plan.enough && plan.cost > 0 && plan.picks.length > 0);
  const before = s.supplies;
  const r = C.fortify(s);
  assert.ok(r.ok);
  assert.equal(s.supplies, before - plan.cost);
  assert.ok(C.defensePower(s) >= C.nightStrength(s));
  assert.equal(C.fortify(s).reason, 'safe');
  const poor = fresh(); poor.wavesCleared = 20;
  assert.equal(C.fortify(poor).reason, 'supplies');
  assert.equal(poor.defenses.wire, 0, '모자라면 아무것도 사지 않는다');
});

test('하루: 50초에 무리가 도착하고 60초에 승패가 갈린다', () => {
  const s = fresh();
  assert.deepEqual(C.dayPhase(s), { phase: 'day', left: 50, total: 50 });
  assert.ok(!C.tick(s, 49, half).some(e => e.type === 'arrive'));
  const at50 = C.tick(s, 1.5, half);
  assert.ok(at50.some(e => e.type === 'arrive'));
  assert.equal(C.dayPhase(s).phase, 'battle');
  assert.ok(!at50.some(e => e.type === 'breached' || e.type === 'defended'));
  const end = C.tick(s, 10, half);
  assert.ok(end.some(e => e.type === 'breached'));
  let nights = 0; const t = fresh();
  for (let i = 0; i < 6000; i++) nights += C.tick(t, 0.1, half).filter(e => ['defended', 'breached', 'held'].includes(e.type)).length;
  assert.equal(nights, 10, '10분에 밤 10번');
});

/* ================= 구조 신호 ================= */

test('구조 신호: 2분 뒤에 처음 오고, 응답하면 물자나 생산 3배를 얻는다', () => {
  const s = fresh(); s.buildings.garden = 10;
  let ev = [];
  for (let i = 0; i < 121; i++) ev = ev.concat(C.tick(s, 1, half));
  assert.ok(ev.some(e => e.type === 'signal'));
  assert.ok(s.signalLeft > 0);
  const per = C.productionPerSec(s);
  const a = C.answerSignal(s, () => 0.1);
  assert.equal(a.kind, 'supplies');
  near(a.gain, per * C.SIGNAL_SUPPLY_SECONDS);
  assert.equal(C.answerSignal(s, half).reason, 'none');
  s.signalLeft = 5;
  const b = C.answerSignal(s, () => 0.9);
  assert.equal(b.kind, 'buff');
  near(C.productionPerSec(s), per * C.BUFF_MULT);
  C.tick(s, C.BUFF_SECONDS + 1, half);
  assert.equal(s.buff, null);
  s.signalLeft = 1;
  assert.ok(C.tick(s, 2, half).some(e => e.type === 'signal-missed'));
});

/* ================= 철수와 영구 특성 ================= */

test('철수: 이번 판에서 충분히 모아야 하고, 많이 모을수록 항체 샘플이 는다', () => {
  const s = fresh();
  assert.equal(C.antibodiesOnRetreat(s), 0);
  assert.equal(C.canRetreat(s), false);
  assert.equal(C.retreat(s, 0).ok, false);
  s.runEarned = C.RETREAT_MIN;
  assert.equal(C.antibodiesOnRetreat(s), C.RETREAT_K);
  s.runEarned = C.RETREAT_MIN * 1e4;
  const big = C.antibodiesOnRetreat(s);
  assert.equal(big, Math.floor(C.RETREAT_K * Math.pow(1e4, C.RETREAT_POW)));
  assert.ok(big > C.RETREAT_K * 10);
  s.traits.legacy = 5;
  assert.equal(C.antibodiesOnRetreat(s), Math.floor(C.RETREAT_K * Math.pow(1e4, C.RETREAT_POW) * 1.5));
  s.pendingPerks = ['harvest'];
  assert.equal(C.canRetreat(s), false, '고르지 않은 특전이 있으면 안 된다');
});

test('철수: 거점은 전부 사라지고, 항체와 특성·일지·통계는 남는다', () => {
  const s = inMarket();
  s.runEarned = 1e11; s.lifetimeEarned = 5e11; s.supplies = 1e8; s.buildings.scouts = 50; s.defenses.wire = 9; s.upgrades.maps = 4; s.stalls = 20; s.goods = 99;
  s.perks.harvest = 3; s.wavesCleared = 40; s.traits.immune = 2; s.antibodies = 4; s.antibodyTotal = 10; s.story['z1-0'] = true; s.playSeconds = 777; s.runSeconds = 600; s.startedAt = 55;
  const gain = C.antibodiesOnRetreat(s);
  const r = C.retreat(s, 9000);
  assert.ok(r.ok);
  const n = r.state;
  assert.equal(r.gained, gain);
  assert.equal(n.antibodies, 4 + gain);
  assert.equal(n.antibodyTotal, 10 + gain);
  assert.equal(n.traits.immune, 2);
  assert.equal(n.zone, 0);
  assert.equal(n.supplies, 0);
  assert.equal(n.runEarned, 0);
  assert.equal(n.buildings.scouts + n.defenses.wire + n.upgrades.maps + n.stalls + n.goods + n.perks.harvest + n.wavesCleared, 0);
  assert.deepEqual(n.goalsDone, {});
  assert.equal(n.retreats, 1);
  assert.equal(n.bestZone, 1);
  assert.equal(n.story['z1-0'], true);
  assert.equal(n.lifetimeEarned, 5e11);
  assert.equal(n.playSeconds, 777);
  assert.equal(n.runSeconds, 0);
  assert.equal(n.startedAt, 55);
  assert.deepEqual(n.runLog, [{ zone: 1, seconds: 600, antibodies: gain }]);
});

test('특성: 항체 샘플로 찍고, 레벨마다 값이 오르며, 되돌리면 전부 돌려받는다', () => {
  const s = fresh(); s.antibodies = 20; s.buildings.scouts = 10;
  const base = C.productionPerSec(s);
  assert.equal(C.traitCost(s, 'immune'), 1);
  assert.ok(C.buyTrait(s, 'immune').ok);
  assert.equal(C.traitCost(s, 'immune'), 2);
  near(C.productionPerSec(s), base * 1.25);
  assert.ok(C.buyTrait(s, 'immune').ok);
  near(C.productionPerSec(s), base * 1.5);
  C.buyTrait(s, 'bulwark');
  assert.equal(C.defensePower(s), Math.floor(C.BASE_DEFENSE * 1.4));
  const spent = C.traitsSpent(s);
  assert.equal(s.antibodies, 20 - spent);
  const r = C.resetTraits(s);
  assert.equal(r.refunded, spent);
  assert.equal(s.antibodies, 20);
  near(C.productionPerSec(s), base);
  assert.equal(C.resetTraits(s).reason, 'none');
  const poor = fresh();
  assert.equal(C.buyTrait(poor, 'immune').reason, 'antibodies');
  assert.equal(C.buyTrait(poor, 'nothing').ok, false);
  poor.traits.pioneer = 8; poor.antibodies = 1e9;
  assert.equal(C.buyTrait(poor, 'pioneer').reason, 'max');
});

test('특성: 선발대는 철수 뒤 물자를 들고 시작하게 한다', () => {
  const s = fresh(); s.runEarned = C.RETREAT_MIN * 10; s.traits.pioneer = 2;
  const n = C.retreat(s, 0).state;
  assert.equal(n.supplies, 10000);
  assert.equal(C.startSupplies(fresh()), 0);
});

test('철수의 보람: 특성을 찍고 다시 하면 같은 시간에 훨씬 멀리 간다', () => {
  // 사는 순서가 같은 단순한 봇으로 20분을 돌려 번 물자를 비교한다
  const run = (s) => {
    for (let t = 0; t < 1200; t++) {
      C.tick(s, 1, half);
      if (s.pendingPerks.length) C.choosePerk(s, s.pendingPerks[0]);
      if (t < 20) C.scavenge(s);
      C.fortify(s);
      for (let g = 0; g < 50; g++) {
        let best = null;
        for (const b of C.BUILDINGS) { const c = C.buildingCost(s, b.id, 1); if (c <= s.supplies && (!best || c / b.baseRate < best.pay)) best = { id: b.id, pay: c / b.baseRate }; }
        if (!best) break;
        C.buyBuilding(s, best.id, 1);
      }
    }
    return s.runEarned;
  };
  const first = run(fresh());
  const strong = fresh(); strong.traits.immune = 6; strong.traits.bulwark = 4;
  assert.ok(run(strong) > first * 2, '특성 10레벨이면 같은 20분에 2배 넘게 번다');
});

/* ================= 이야기 ================= */

test('이야기: 구역에 들어설 때, 목표 둘, 목표 셋에 일지가 열리고 한 번만 뜬다', () => {
  const s = fresh();
  const story = (st) => C.tick(st, 0.1, half).filter(e => e.type === 'story').map(e => e.id);
  assert.deepEqual(story(s), ['z1-0']);
  assert.deepEqual(story(s), []);
  s.goalsDone.z1a = s.goalsDone.z1b = true;
  assert.deepEqual(story(s), ['z1-1']);
  s.goalsDone.z1c = true;
  assert.deepEqual(story(s), ['z1-2']);
  s.supplies = 1e9; assert.ok(C.openZone(s).ok);
  const ev = C.tick(s, 0.1, half).filter(e => e.type === 'story');
  assert.equal(ev[0].id, 'z2-0');
  assert.equal(ev[0].zoneName, '재래시장');
  assert.ok(ev[0].text.length > 10);
});

test('이야기: 첫 철수와 공단의 문 앞에서 일지가 열리고, 읽은 일지는 철수해도 다시 뜨지 않는다', () => {
  const s = inMarket();
  C.tick(s, 0.1, half);
  C.GOALS[1].forEach(g => { s.goalsDone[g.id] = true; });
  s.supplies = 1e12; C.openZone(s);
  assert.ok(C.tick(s, 0.1, half).some(e => e.type === 'story' && e.id === 'z3-0'));
  s.pendingPerks = [];
  s.runEarned = 1e11;
  const n = C.retreat(s, 0).state;
  const ids = C.tick(n, 0.1, half).filter(e => e.type === 'story').map(e => e.id);
  assert.deepEqual(ids, ['retreat-1']);
  assert.equal(new Set(C.BEATS.map(b => b.id)).size, C.BEATS.length);
});

/* ================= 자리 비움 ================= */

test('자리 비움: 최대 4시간을 50% 효율로 받고, 2구역은 평균 시세로 친다', () => {
  const s = inMarket(); s.buildings.garden = 10; s.stalls = 10; s.defenses.rail = 1000;
  const per = C.productionPerSec(s);
  const r = C.applyOffline(s, 600);
  near(r.gain, per * 600 * 0.5);
  assert.equal(r.capped, false);
  assert.equal(s.awaySeconds, 600);
  assert.ok(s.tradeEarned > 0);
  assert.equal(r.nights, 10);
  const long = inMarket(); long.buildings.garden = 10;
  const rr = C.applyOffline(long, C.OFFLINE_CAP * 3);
  assert.equal(rr.counted, C.OFFLINE_CAP);
  assert.equal(rr.capped, true);
  const t = fresh(); t.traits.rest = 4;
  near(C.offlineRate(t), 0.7);
  t.traits.rest = 10; t.perks.frugal = 0;
  assert.ok(C.offlineRate(t) <= 1);
  for (const bad of [-5, NaN, undefined]) assert.equal(C.applyOffline(fresh(), bad).gain, 0);
});

test('자리 비움: 못 막는 밤부터는 잃는 것 없이 버티기만 한다', () => {
  const s = fresh(); s.supplies = 1000; s.defenses.wire = 2;  // 방어력 13: 몇 밤만 막는다
  const r = C.applyOffline(s, 3600);
  assert.ok(r.nights >= 1 && r.nights < 60);
  assert.equal(r.held, true);
  assert.equal(s.breaches, 0);
  assert.ok(s.supplies >= 1000);
  assert.equal(s.day, 61, '날짜는 그대로 흐른다');
});

/* ================= 안내, 통계, 표기 ================= */

test('안내: 처음부터 철수까지 지금 할 일을 한 줄로 알려 준다', () => {
  const s = fresh();
  assert.equal(C.guide(s).id, 'click');
  s.supplies = 20; s.clicks = 3;
  assert.equal(C.guide(s).id, 'scouts');
  s.buildings.scouts = 1;
  assert.equal(C.guide(s).id, 'defend');
  s.defenses.wire = 5;
  const g = C.guide(s);
  assert.equal(g.id, 'goal');
  assert.match(g.text, /1구역 목표/);
  s.antibodies = 5;
  assert.equal(C.guide(s).id, 'trait');
  s.antibodies = 0;
  C.GOALS[0].forEach(x => { s.goalsDone[x.id] = true; });
  assert.equal(C.guide(s).id, 'open');
  s.pendingPerks = ['harvest'];
  assert.equal(C.guide(s).id, 'perk');
});

test('통계와 표기', () => {
  const s = fresh(); C.tick(s, 30, half); C.applyOffline(s, 100);
  const st = C.stats(s, 86400000 * 2);
  assert.equal(st.play, 30); assert.equal(st.away, 100); assert.equal(st.total, 130); assert.equal(st.run, 130);
  assert.equal(st.days, null, '시작 시각이 0 이면 모른다');
  assert.equal(C.stats(C.createState(1000), 1000 + 86400000).days, 2);
  assert.equal(C.formatNumber(12345), '1.23만');
  assert.equal(C.formatNumber(999), '999');
  assert.equal(C.formatNumber(1.5e8), '1.50억');
  assert.equal(C.formatNumber(NaN), '0');
  assert.equal(C.formatDuration(3700), '1시간 1분');
  assert.equal(C.formatDuration(-1), '0초');
});

test('정의표: id 가 겹치지 않고, 강화·특전·특성이 쓰는 항목을 보너스 합산이 모두 안다', () => {
  for (const list of [C.BUILDINGS, C.DEFENSES, C.UPGRADES, C.PERKS, C.TRAITS]) assert.equal(new Set(list.map(d => d.id)).size, list.length);
  const keys = Object.keys(C.mods(fresh()));
  for (const d of [...C.UPGRADES, ...C.PERKS, ...C.TRAITS]) assert.ok(keys.includes(d.key), `${d.id} 의 ${d.key}`);
  C.UPGRADES.forEach(u => assert.ok(u.zone >= 0 && u.zone < C.ZONES.length && C.ZONES[u.zone].kind !== 'soon', u.id));
  assert.equal(C.GOALS.length, C.ZONES.filter(z => z.kind !== 'soon').length);
});

/* ================= 3구역: 생산 라인 ================= */

test('라인: 3구역을 열기 전에는 기계도 산출도 없다', () => {
  const s = inMarket(); s.supplies = 1e30;
  assert.equal(C.buyMachine(s, 'sorter', 1).reason, 'locked');
  assert.equal(C.tuneLine(s, 1).reason, 'locked');
  assert.equal(C.machineCost(s, 'sorter', 1), Infinity);
  assert.equal(C.maxMachines(s, 'sorter'), 0);
  assert.equal(C.tuneCost(s), Infinity);
  s.machines.sorter = 5; s.machines.press = 5; s.machines.assembler = 5;   // 값이 남아 있어도 닫힌 구역은 돌지 않는다
  assert.equal(C.lineRate(s), 0);
  assert.equal(C.lineInfo(s).flow, 0);
});

test('라인: 가장 느린 기계의 속도로만 나온다', () => {
  const s = inFactory();
  assert.equal(C.lineRate(s), 0, '기계가 없으면 0');
  s.machines.sorter = 10; s.machines.press = 10;
  assert.equal(C.lineRate(s), 0, '하나라도 없으면 라인은 서 있다');
  s.machines.assembler = 4;
  let l = C.lineInfo(s);
  assert.deepEqual(l.caps, { sorter: 30, press: 20, assembler: 4 });
  assert.equal(l.flow, 4);
  assert.equal(l.bottleneck, 'assembler');
  near(l.load, 4 / 30);
  const before = C.lineRate(s);
  s.machines.sorter = 14;                         // 합계 28: 2배 구간(15) 안에서 병목이 아닌 기계를 올린다
  assert.equal(C.lineRate(s), before, '병목이 아닌 기계를 올려도 늘지 않는다');
  s.machines.assembler = 5;
  near(C.lineRate(s), before * 5 / 4, '병목을 올리면 그만큼 는다');
});

test('라인: 가동률이 기준 이상이면 정속 가동 보너스가 붙는다', () => {
  const s = inFactory();
  s.machines.sorter = 2; s.machines.press = 3; s.machines.assembler = 6;      // 6, 6, 6: 완전히 맞물림
  let l = C.lineInfo(s);
  assert.equal(l.load, 1);
  assert.equal(l.steady, true);
  near(l.bonus, 1 + C.STEADY_BONUS);
  near(C.lineRate(s), 6 * l.milestone * (1 + C.STEADY_BONUS) * C.productValue(s));
  s.machines.sorter = 3;                                                       // 9, 6, 6 → 가동률 0.67
  l = C.lineInfo(s);
  assert.equal(l.steady, false);
  assert.equal(l.bonus, 1);
  // 강화: 컨베이어는 보너스를 키우고, 예비 부품은 기준을 낮춘다(바닥 0.5)
  s.upgrades.belt = 2;
  s.machines.sorter = 2;
  near(C.lineInfo(s).bonus, 1 + C.STEADY_BONUS + 0.2);
  s.machines.sorter = 3; s.upgrades.spare = 5;                                 // 기준 0.75. 가동률 0.67 은 아직 모자란다
  near(C.lineInfo(s).steadyAt, 0.75);
  assert.equal(C.lineInfo(s).steady, false);
  s.machines.press = 4; s.machines.assembler = 8;                              // 9, 8, 8 → 0.89
  assert.equal(C.lineInfo(s).steady, true);
});

test('라인: 기계 레벨 합계가 구간에 닿을 때마다 2배', () => {
  assert.equal(C.lineMilestone(0), 1);
  assert.equal(C.lineMilestone(C.LINE_MILESTONES[0] - 1), 1);
  assert.equal(C.lineMilestone(C.LINE_MILESTONES[0]), 2);
  assert.equal(C.lineMilestone(C.LINE_MILESTONES[2]), 8);
  assert.equal(C.lineMilestone(1e9), Math.pow(2, C.LINE_MILESTONES.length));
  const s = inFactory();
  s.machines.sorter = 2; s.machines.press = 3; s.machines.assembler = 6;
  assert.equal(C.lineInfo(s).levels, 11);
  assert.equal(C.lineInfo(s).nextMilestone, 15);
  s.machines.sorter = 500; s.machines.press = 500; s.machines.assembler = 500;
  assert.equal(C.lineInfo(s).nextMilestone, null);
});

test('라인: 기계를 사고, 값은 오르고, 할인이 적용된다', () => {
  const s = inFactory();
  const def = C.MACHINES.find(m => m.id === 'press');
  assert.equal(C.machineCost(s, 'press', 1), def.baseCost);
  s.supplies = def.baseCost - 1;
  assert.equal(C.buyMachine(s, 'press', 1).reason, 'supplies');
  s.supplies = def.baseCost;
  assert.ok(C.buyMachine(s, 'press', 1).ok);
  assert.equal(s.machines.press, 1);
  assert.equal(s.supplies, 0);
  assert.equal(C.machineCost(s, 'press', 1), Math.ceil(def.baseCost * C.GROWTH));
  s.upgrades.manual = 1;
  assert.equal(C.machineCost(s, 'press', 1), Math.ceil(def.baseCost * C.GROWTH * 0.96));
  assert.equal(C.buyMachine(s, 'nothing', 1).reason, 'unknown');
  assert.equal(C.buyMachine(s, 'press', 0).reason, 'unknown');
  s.machines.press = C.COUNT_MAX;
  assert.equal(C.machineCost(s, 'press', 1), Infinity);
  s.supplies = 1e300;
  assert.equal(C.buyMachine(s, 'press', 1).reason, 'max');
});

test('라인: 병목 올리기는 그때그때 가장 느린 기계를 올린다', () => {
  const s = inFactory(); s.supplies = 1e14;      // 너무 큰 수에서 빼면 쓴 값이 반올림에 묻힌다
  const r = C.tuneLine(s, 11);
  assert.ok(r.ok);
  assert.equal(r.bought, 11);
  assert.deepEqual(s.machines, { sorter: 2, press: 3, assembler: 6 }, '처리량이 같아지는 비율(2:3:6)로 오른다');
  near(1e14 - s.supplies, r.cost);
  assert.equal(C.lineInfo(s).load, 1);
  // 물자가 모자라면 살 수 있는 만큼만
  const t = inFactory(); t.supplies = C.MACHINES[0].baseCost;
  const one = C.tuneLine(t, 50);
  assert.ok(one.ok); assert.equal(one.bought, 1);
  assert.equal(C.tuneLine(t, 50).reason, 'supplies');
  for (const junk of [NaN, -3, 'x', undefined, 1e99]) { const u = inFactory(); u.supplies = 1e13; assert.doesNotThrow(() => C.tuneLine(u, junk)); }
});

test('라인: 시간이 흐르면 물자가 들어오고 정속 가동 시간이 쌓인다', () => {
  const s = inFactory();
  s.machines.sorter = 2; s.machines.press = 3; s.machines.assembler = 6;
  s.defenses.rail = 1e5; s.signalIn = 1e9; s.autoSell = false;
  const rate = C.lineRate(s), before = s.supplies;
  assert.ok(rate > 0);
  C.tick(s, 10, half);
  near(s.lineEarned, rate * 10);
  near(s.supplies - before, rate * 10 + C.searchRate(s) * 10);
  assert.equal(s.steadySeconds, 10);
  near(C.productionPerSec(s), C.searchRate(s) + C.tradeRate(s) + C.lineRate(s));
  s.machines.sorter = 9;                           // 맞물림이 깨지면 정속 시간은 멈춘다
  C.tick(s, 10, half);
  assert.equal(s.steadySeconds, 10);
  assert.ok(s.lineEarned > rate * 10);
});

test('라인: 자리를 비운 동안에도 돈다', () => {
  const s = inFactory();
  s.machines.sorter = 2; s.machines.press = 3; s.machines.assembler = 6;
  s.defenses.rail = 1e5;
  const rate = C.lineRate(s);
  const rep = C.applyOffline(s, 1000);
  near(s.lineEarned, rate * 1000 * C.OFFLINE_RATE);
  assert.ok(rep.gain >= s.lineEarned);
  assert.equal(s.steadySeconds, 1000, '맞춰 두고 나갔으면 그 시간도 정속 가동으로 친다');
});

test('라인: 목표 셋과 일지, 그리고 철수하면 기계가 사라진다', () => {
  const s = inFactory();
  assert.equal(C.goals(s, 2).length, 3);
  assert.equal(C.goals(s, 2)[1].unit, 'time');
  s.defenses.rail = 1e5; s.signalIn = 1e9; s.buildings.scouts = 1; s.clicks = 1;
  let ev = C.tick(s, 0.1, half);
  assert.ok(ev.some(e => e.type === 'story' && e.id === 'z3-0'), '들어서면 일지가 열린다');
  assert.equal(C.guide(s).id, 'goal');
  s.machines.sorter = 30; s.machines.press = 40; s.machines.assembler = 50;
  ev = C.tick(s, 0.1, half);
  assert.ok(ev.some(e => e.type === 'goal' && e.id === 'z3a'));
  s.runEarned = C.RETREAT_MIN * 10; s.pendingPerks = [];
  const r = C.retreat(s, 0);
  assert.ok(r.ok);
  assert.deepEqual(r.state.machines, { sorter: 0, press: 0, assembler: 0 });
  assert.equal(r.state.lineEarned, 0);
  assert.equal(r.state.steadySeconds, 0);
  assert.equal(r.state.story['z3-0'], true, '읽은 일지는 남는다');
});

test('저장: 기계와 라인 기록을 안전하게 읽고, 문 앞에 있던 저장은 열린 구역으로 들여보낸다', () => {
  const s = inFactory();
  s.machines.sorter = 4; s.lineEarned = 123; s.steadySeconds = 45;
  assert.deepEqual(C.deserialize(C.serialize(s), 0), s);
  const bad = C.sanitizeState({ version: 2, zone: 2, machines: { sorter: 1e9, press: -2, assembler: 'x', ghost: 3 }, lineEarned: -1, steadySeconds: NaN }, 0);
  assert.deepEqual(bad.machines, { sorter: C.COUNT_MAX, press: 0, assembler: 0 });
  assert.equal(bad.lineEarned, 0);
  assert.equal(bad.steadySeconds, 0);
  // 알파 0.6.1 까지: 3구역은 '문 앞'(gate)까지만 갈 수 있었다
  const old = C.sanitizeState({ version: 2, zone: 1, gate: true, story: { 'z3-0': true, 'z2-0': true } }, 0);
  assert.equal(old.zone, 2);
  assert.equal(old.gate, false);
  assert.equal(old.bestZone, 2);
  assert.equal(old.story['z3-0'], undefined, '들어설 때의 일지를 새로 보여 준다');
  assert.equal(old.story['z2-0'], true);
  // 알파 0.6.4 까지: 4구역도 같은 식으로 문 앞까지만 갈 수 있었다
  const old4 = C.sanitizeState({ version: 2, zone: 2, gate: true, story: { 'gate-4': true } }, 0);
  assert.equal(old4.zone, 3); assert.equal(old4.gate, false);
  // 지금의 문 앞(6구역)은 그대로 둔다
  const now = C.sanitizeState({ version: 2, zone: 4, gate: true }, 0);
  assert.equal(now.zone, 4); assert.equal(now.gate, true);
});

/* ================= 4구역: 노선 ================= */

test('노선: 4구역을 열기 전에는 열차도 노선도 없다', () => {
  const s = inFactory(); s.supplies = 1e40;
  assert.equal(C.buyTrain(s, 1).reason, 'locked');
  assert.equal(C.buyRoute(s, 'loop').reason, 'locked');
  assert.equal(C.trainCost(s, 1), Infinity);
  assert.equal(C.routeCost(s, 'loop'), Infinity);
  assert.equal(C.maxTrains(s), 0);
  s.trains = 5; s.routes.loop = 3;
  assert.equal(C.railRate(s), 0);
  assert.equal(C.railPlan(s).riders.loop, 0);
  const before = s.supplies;
  s.defenses.rail = 1e9; s.signalIn = 1e9;
  const ev = C.tick(s, 100, half);
  assert.ok(!ev.some(e => e.type === 'train'));
});

test('노선: 열차와 노선을 사고, 값이 오른다', () => {
  const s = inStation();
  const t1 = C.trainCost(s, 1);
  s.supplies = t1 * 0.99;                         // 이만큼 큰 수에서는 1을 빼도 값이 그대로다
  assert.equal(C.buyTrain(s, 1).reason, 'supplies');
  s.supplies = t1;
  assert.ok(C.buyTrain(s, 1).ok);
  assert.equal(s.trains, 1);
  assert.equal(C.trainCost(s, 1), Math.ceil(t1 * C.TRAIN_GROWTH));
  const loop = C.ROUTES.find(r => r.id === 'loop');
  assert.equal(C.routeCost(s, 'loop'), loop.baseCost);
  s.supplies = loop.baseCost;
  assert.ok(C.buyRoute(s, 'loop').ok);
  assert.equal(s.routes.loop, 1);
  assert.equal(C.routeCost(s, 'loop'), Math.ceil(loop.baseCost * C.ROUTE_GROWTH));
  assert.equal(C.buyRoute(s, 'nothing').reason, 'unknown');
  assert.equal(C.buyTrain(s, 0).reason, 'unknown');
  s.upgrades.tracks = 1; s.upgrades.depot = 1;
  assert.equal(C.routeCost(s, 'loop'), Math.ceil(loop.baseCost * C.ROUTE_GROWTH * 0.94));
  assert.equal(C.trainCost(s, 1), Math.ceil(t1 * C.TRAIN_GROWTH * 0.96));
  s.trains = C.TRAIN_MAX; s.routes.loop = C.ROUTE_MAX; s.supplies = 1e300;
  assert.equal(C.buyTrain(s, 1).reason, 'max');
  assert.equal(C.buyRoute(s, 'loop').reason, 'max');
});

test('노선: 열차는 배수가 높은 노선부터 채워 탄다', () => {
  const s = inStation();
  s.trains = 7; s.routes.loop = 2; s.routes.river = 1; s.routes.express = 1;
  const p = C.railPlan(s);
  assert.deepEqual(p.slots, { express: 2, outer: 0, river: 2, loop: 4 });
  assert.deepEqual(p.riders, { express: 2, outer: 0, river: 2, loop: 3 });
  assert.equal(p.idle, 0);
  s.trains = 12;
  assert.equal(C.railPlan(s).idle, 4, '자리가 없는 열차는 쉰다');
  const byId = id => C.ROUTES.find(r => r.id === id).mult;
  s.trains = 7;
  near(C.railRate(s), (2 * byId('express') + 2 * byId('river') + 3 * byId('loop')) * C.cargoValue(s));
});

test('노선: 화물은 열차가 돌아왔을 때 한꺼번에 들어온다', () => {
  const s = inStation();
  s.trains = 2; s.routes.loop = 1; s.defenses.rail = 1e9; s.signalIn = 1e9; s.autoSell = false;
  const loop = C.ROUTES.find(r => r.id === 'loop'), value = C.cargoValue(s);
  let ev = C.tick(s, loop.seconds - 1, half);
  assert.ok(!ev.some(e => e.type === 'train'), '돌아오기 전에는 들어오지 않는다');
  assert.equal(s.railEarned, 0);
  near(s.routeLoad.loop, 2 * (loop.seconds - 1));
  ev = C.tick(s, 1, half);
  const arrived = ev.find(e => e.type === 'train');
  assert.ok(arrived);
  assert.equal(arrived.route, 'loop');
  assert.equal(arrived.long, false);
  near(arrived.gain, 2 * loop.seconds * loop.mult * value);
  near(s.railEarned, arrived.gain);
  near(s.routeLoad.loop, 0); near(s.routeClock.loop, 0);
});

test('노선: 운행 도중에 탄 열차는 달린 만큼만 싣는다', () => {
  const s = inStation();
  s.trains = 1; s.routes.loop = 2; s.defenses.rail = 1e9; s.signalIn = 1e9;
  const loop = C.ROUTES.find(r => r.id === 'loop');
  C.tick(s, loop.seconds - 2, half);
  s.trains = 4;                                   // 도착 2초 전에 세 대를 더 샀다. 값은 열차 수 구간(4대)에 맞춰 오른다
  const ev = C.tick(s, 2, half).find(e => e.type === 'train');
  near(ev.gain, ((loop.seconds - 2) * 1 + 2 * 4) * loop.mult * C.cargoValue(s));
});

test('노선: 긴 시간을 한 번에 진행해도 다녀온 횟수만큼만 내린다', () => {
  const s = inStation();
  s.trains = 1; s.routes.loop = 1; s.defenses.rail = 1e9; s.signalIn = 1e9;
  const loop = C.ROUTES.find(r => r.id === 'loop'), value = C.cargoValue(s);
  const ev = C.tick(s, loop.seconds * 3.5, half).filter(e => e.type === 'train');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].trips, 3);
  near(s.routeClock.loop, loop.seconds * 0.5);
  near(s.routeLoad.loop, loop.seconds * 0.5);
  assert.ok(Math.abs(s.railEarned - 3 * loop.seconds * loop.mult * value) / s.railEarned < 0.05);   // 막아낸 밤 보너스가 도중에 조금 붙는다
});

test('노선: 심야 급행 도착을 세고, 시간표는 운행 시간을 줄인다', () => {
  const s = inStation();
  s.trains = 1; s.routes.express = 1; s.defenses.rail = 1e9; s.signalIn = 1e9;
  const ex = C.ROUTES.find(r => r.id === 'express');
  assert.equal(C.tripSeconds(s, 'express'), ex.seconds);
  s.upgrades.timetable = 2;
  near(C.tripSeconds(s, 'express'), ex.seconds * 0.95 * 0.95);
  const ev = C.tick(s, C.tripSeconds(s, 'express') + 0.01, half).find(e => e.type === 'train');
  assert.ok(ev.long);
  assert.equal(s.expressRuns, 1);
  assert.equal(C.tripSeconds(s, 'nothing'), Infinity);
});

test('노선: 열차 수가 구간에 닿을 때마다 화물 2배', () => {
  assert.equal(C.fleetMilestone(0), 1);
  assert.equal(C.fleetMilestone(C.FLEET_MILESTONES[0]), 2);
  assert.equal(C.fleetMilestone(C.FLEET_MILESTONES[2]), 8);
  const s = inStation(); s.trains = 3;
  const v = C.cargoValue(s);
  s.trains = 4;
  near(C.cargoValue(s), v * 2);
});

test('노선: 자리를 비운 동안에도 다니고, 돌아온 화물은 자리 비움 효율로 받는다', () => {
  const s = inStation();
  s.trains = 2; s.routes.loop = 1; s.defenses.rail = 1e9;
  const loop = C.ROUTES.find(r => r.id === 'loop'), value = C.cargoValue(s), before = s.supplies;
  const rep = C.applyOffline(s, loop.seconds * 10);
  assert.ok(rep.trains >= 1);
  near(s.railEarned, 2 * loop.seconds * 10 * loop.mult * value * C.OFFLINE_RATE);
  assert.ok(rep.gain >= s.railEarned);
  assert.ok(s.supplies > before);
  assert.ok(s.runEarned >= 0 && s.lifetimeEarned >= 0);
});

test('노선: 목표와 일지, 그리고 철수하면 열차와 노선이 사라진다', () => {
  const s = inStation();
  assert.equal(C.goals(s, 3).length, 3);
  s.defenses.rail = 1e9; s.signalIn = 1e9; s.buildings.scouts = 1; s.clicks = 1;
  let ev = C.tick(s, 0.1, half);
  assert.ok(ev.some(e => e.type === 'story' && e.id === 'z4-0'));
  s.trains = 16; s.expressRuns = 3;
  ev = C.tick(s, 0.1, half);
  assert.ok(ev.some(e => e.type === 'goal' && e.id === 'z4a'));
  s.pendingPerks = []; s.runEarned = C.RETREAT_MIN * 10; s.routes.loop = 3; s.routeLoad.loop = 50; s.routeClock.loop = 5;
  const r = C.retreat(s, 0);
  assert.equal(r.state.trains, 0);
  assert.deepEqual(r.state.routes, { loop: 0, river: 0, outer: 0, express: 0 });
  assert.deepEqual(r.state.routeLoad, { loop: 0, river: 0, outer: 0, express: 0 });
  assert.equal(r.state.expressRuns, 0);
  assert.equal(r.state.railEarned, 0);
});

test('저장: 열차와 노선을 안전하게 읽는다', () => {
  const s = inStation();
  s.trains = 5; s.routes.river = 2; s.routeClock.river = 30; s.routeLoad.river = 120; s.railEarned = 9; s.expressRuns = 1;
  assert.deepEqual(C.deserialize(C.serialize(s), 0), s);
  const bad = C.sanitizeState({ version: 2, zone: 3, trains: 1e9, routes: { loop: 1e9, river: -1, ghost: 2 }, routeClock: { loop: 1e9, river: 'x' }, routeLoad: { loop: 1e30, outer: NaN }, railEarned: -4, expressRuns: 2.7 }, 0);
  assert.equal(bad.trains, C.TRAIN_MAX);
  assert.deepEqual(bad.routes, { loop: C.ROUTE_MAX, river: 0, outer: 0, express: 0 });
  assert.equal(bad.routeClock.loop, 30);
  assert.equal(bad.routeClock.river, 0);
  assert.equal(bad.routeLoad.loop, C.TRAIN_MAX * 30);
  assert.equal(bad.routeLoad.outer, 0);
  assert.equal(bad.railEarned, 0);
  assert.equal(bad.expressRuns, 2);
  for (const junk of [null, 'x', 7, []]) assert.doesNotThrow(() => C.sanitizeState({ version: 2, zone: 3, routes: junk, routeClock: junk, routeLoad: junk }, 0));
});

test('특전: 아직 열지 않은 구역의 특전은 나오지 않는다', () => {
  const seen = (state) => { const out = new Set(); for (let i = 0; i < 400; i++) { let k = i; C.drawPerks(() => ((k = (k * 7919 + 13) % 1000) / 1000), state).forEach(id => out.add(id)); } return out; };
  const z1 = seen(fresh());
  for (const id of ['bargain', 'foreman', 'driver']) assert.ok(!z1.has(id), id);
  for (const id of ['harvest', 'watch', 'hands', 'spoils', 'frugal']) assert.ok(z1.has(id), id);
  const z2 = seen(inMarket());
  assert.ok(z2.has('bargain') && !z2.has('foreman') && !z2.has('driver'));
  const z4 = seen(inStation());
  assert.ok(z4.has('foreman') && z4.has('driver'));
  assert.equal(C.drawPerks(half, fresh()).length, C.PERK_CHOICES);
  assert.equal(new Set(C.drawPerks(half)).size, C.PERK_CHOICES, '상태 없이 부르면 전체에서 뽑는다');
  // 목표를 달성했을 때 실제로 걸리는 선택지도 같다
  const s = fresh(); s.buildings.scouts = 50; s.defenses.rail = 1e5; s.signalIn = 1e9;
  C.tick(s, 0.1, half);
  assert.equal(s.pendingPerks.length, C.PERK_CHOICES);
  for (const id of s.pendingPerks) assert.ok(!(C.PERKS.find(p => p.id === id).zone > 0), id);
});

/* ================= 5구역: 연구 ================= */

test('연구: 5구역을 열기 전에는 연구원도 과제도 없다', () => {
  const s = inStation(); s.supplies = 1e40; s.points = 1e9; s.offers = ['soil'];
  assert.equal(C.buyStaff(s, 1).reason, 'locked');
  assert.equal(C.runProject(s, 'soil', half).reason, 'locked');
  assert.equal(C.rerollOffers(s, half).reason, 'locked');
  assert.equal(C.staffCost(s, 1), Infinity);
  assert.equal(C.maxStaff(s), 0);
  s.staff = 10;
  assert.equal(C.researchRate(s), 0);
  s.defenses.rail = 1e9; s.signalIn = 1e9; s.offers = [];
  C.tick(s, 10, half);
  assert.equal(s.points, 1e9);
  assert.deepEqual(s.offers, []);
});

test('연구: 연구원이 점수를 모으고, 들어서면 과제 셋이 나온다', () => {
  const s = inLab(); s.defenses.rail = 1e9; s.signalIn = 1e9;
  const c1 = C.staffCost(s, 1);
  s.supplies = c1;
  assert.ok(C.buyStaff(s, 1).ok);
  assert.equal(C.staffCost(s, 1), Math.ceil(c1 * C.STAFF_GROWTH));
  assert.equal(C.researchRate(s), 1);
  C.tick(s, 30, half);
  near(s.points, 30);
  assert.equal(s.offers.length, C.OFFER_COUNT);
  assert.equal(new Set(s.offers).size, C.OFFER_COUNT);
  s.staff = 10;
  assert.equal(C.researchRate(s), 20, '10명에 닿으면 2배');
  s.upgrades.scope = 4;
  assert.equal(C.researchRate(s), 40);
  s.upgrades.dorm = 1; s.staff = 1;
  near(C.staffCost(s, 1), c1 * C.STAFF_GROWTH * 0.96);      // 이만큼 큰 수는 곱하는 순서에 따라 끝자리가 달라진다
});

test('연구: 과제를 끝내면 점수를 쓰고 효과가 곱으로 쌓이며, 다음 과제가 비싸진다', () => {
  const s = inLab();
  s.buildings.scouts = 10;
  const before = C.searchRate(s), cost = C.projectCost(s);
  assert.equal(cost, C.PROJECT_BASE);
  s.offers = ['soil', 'drill', 'serum']; s.points = cost - 1;
  assert.equal(C.runProject(s, 'soil', half).reason, 'points');
  s.points = cost;
  const r = C.runProject(s, 'soil', half);
  assert.ok(r.ok);
  assert.equal(r.level, 1);
  assert.equal(s.points, 0);
  assert.equal(s.projectsDone, 1);
  near(C.searchRate(s), before * 2);
  assert.equal(C.projectCost(s), Math.ceil(C.PROJECT_BASE * C.PROJECT_GROWTH));
  assert.equal(s.offers.length, C.OFFER_COUNT, '과제 셋이 새로 나온다');
  s.offers = ['soil', 'drill', 'serum']; s.points = 1e9;
  C.runProject(s, 'soil', half);
  near(C.searchRate(s), before * 4);
  s.upgrades.notes = 2;
  assert.equal(C.projectCost(s), Math.ceil(C.PROJECT_BASE * Math.pow(C.PROJECT_GROWTH, 2) * 0.95 * 0.95));
});

test('연구: 내밀지 않은 과제와 모르는 과제는 끝낼 수 없다', () => {
  const s = inLab(); s.points = 1e9; s.offers = ['soil', 'drill', 'serum'];
  assert.equal(C.runProject(s, 'transit', half).reason, 'not-offered');
  assert.equal(C.runProject(s, 'nothing', half).reason, 'unknown');
  assert.equal(s.points, 1e9);
  assert.equal(s.projectsDone, 0);
});

test('연구: 과제마다 다른 곳을 키운다', () => {
  const run = (id) => { const s = inLab(); s.points = 1e9; s.offers = [id, 'soil', 'drop'].filter((x, i, a) => a.indexOf(x) === i); C.runProject(s, id, half); return s; };
  const base = inLab();
  near(C.goodsValue(run('ledger')), C.goodsValue(base) * 2);
  near(C.productValue(run('process')), C.productValue(base) * 2);
  near(C.mods(run('transit')).z4, C.mods(base).z4 * 2);
  near(C.mods(run('drill')).defense, C.mods(base).defense * 1.5);
  near(C.globalMult(run('serum')), C.globalMult(base) * 1.3);
  near(C.mods(run('refine')).antibody, C.mods(base).antibody * 1.15);
  // 방어 교범은 보강 계획에도 반영된다
  const d = run('drill'); d.defenses.wire = 10;
  assert.equal(C.defensePower(d), Math.floor((C.BASE_DEFENSE + 40) * 1.5));
  assert.ok(C.defensePlan(d).cost <= C.defensePlan(Object.assign(inLab(), { defenses: Object.assign({}, d.defenses) })).cost);
});

test('연구: 보급 요청은 효과가 남지 않고 물자를 바로 준다', () => {
  const s = inLab(); s.buildings.scouts = 100; s.points = 1e9; s.offers = ['drop', 'soil', 'serum'];
  const per = C.productionPerSec(s), before = s.supplies, m = JSON.stringify(C.mods(s));
  const r = C.runProject(s, 'drop', half);
  near(r.gain, per * C.SUPPLY_DROP_SECONDS);
  near(s.supplies - before, r.gain);
  assert.equal(JSON.stringify(C.mods(s)), m, '배수는 그대로다');
  assert.equal(s.projectsDone, 1, '끝낸 과제로는 센다');
  const empty = inLab(); empty.points = 1e9; empty.offers = ['drop'];
  assert.ok(C.runProject(empty, 'drop', half).gain >= 1, '생산이 0 이어도 0 을 주지는 않는다');
});

test('연구: 다시 뽑기는 과제 값의 일부를 낸다', () => {
  const s = inLab(); s.offers = ['soil', 'drill', 'serum'];
  assert.equal(C.rerollCost(s), Math.ceil(C.PROJECT_BASE * C.REROLL_SHARE));
  s.points = C.rerollCost(s) - 1;
  assert.equal(C.rerollOffers(s, half).reason, 'points');
  s.points = 100;
  let k = 0;
  const r = C.rerollOffers(s, () => (k += 0.37) % 1);
  assert.ok(r.ok);
  assert.equal(s.points, 100 - r.cost);
  assert.equal(s.offers.length, C.OFFER_COUNT);
  assert.equal(s.projectsDone, 0, '다시 뽑기는 과제 값을 올리지 않는다');
  for (let i = 0; i < 200; i++) { let z = i; const o = C.drawOffers(() => ((z = (z * 9301 + 49297) % 233280) / 233280)); assert.equal(new Set(o).size, C.OFFER_COUNT); o.forEach(id => assert.ok(C.PROJECTS.find(p => p.id === id))); }
});

test('연구: 자리를 비운 동안에도 점수가 모인다', () => {
  const s = inLab(); s.staff = 10; s.defenses.rail = 1e9;
  const rep = C.applyOffline(s, 1000);
  near(s.points, 20 * 1000 * C.OFFLINE_RATE);
  near(rep.points, s.points);
});

test('연구: 목표와 일지, 그리고 철수하면 연구가 사라진다', () => {
  const s = inLab();
  assert.equal(C.goals(s, 4).length, 3);
  s.defenses.rail = 1e9; s.signalIn = 1e9; s.buildings.scouts = 1; s.clicks = 1;
  let ev = C.tick(s, 0.1, half);
  assert.ok(ev.some(e => e.type === 'story' && e.id === 'z5-0'));
  s.research.serum = 3;
  ev = C.tick(s, 0.1, half);
  assert.ok(ev.some(e => e.type === 'goal' && e.id === 'z5c'));
  s.pendingPerks = []; s.runEarned = C.RETREAT_MIN * 10; s.staff = 9; s.points = 77; s.projectsDone = 4;
  const gainPlain = C.antibodiesOnRetreat(Object.assign(inLab(), { runEarned: s.runEarned }));
  s.research.refine = 2;
  assert.ok(C.antibodiesOnRetreat(s) >= Math.floor(gainPlain * 1.15 * 1.15) - 1, '항체 정제는 철수 항체를 늘린다');
  const r = C.retreat(s, 0);
  assert.equal(r.state.staff, 0);
  assert.equal(r.state.points, 0);
  assert.equal(r.state.projectsDone, 0);
  assert.deepEqual(r.state.offers, []);
  assert.ok(Object.values(r.state.research).every(v => v === 0));
});

test('저장: 연구를 안전하게 읽는다', () => {
  const s = inLab();
  s.staff = 7; s.points = 123.5; s.research.soil = 2; s.offers = ['soil', 'drop', 'serum']; s.projectsDone = 2;
  assert.deepEqual(C.deserialize(C.serialize(s), 0), s);
  const bad = C.sanitizeState({ version: 2, zone: 4, staff: 1e9, points: -3, research: { soil: 1e9, ghost: 4, drill: 'x' }, offers: ['soil', 'soil', 'ghost', 42, 'drop', 'serum', 'drill'], projectsDone: 3.9 }, 0);
  assert.equal(bad.staff, C.COUNT_MAX);
  assert.equal(bad.points, 0);
  assert.equal(bad.research.soil, 200);
  assert.equal(bad.research.ghost, undefined);
  assert.equal(bad.research.drill, 0);
  assert.deepEqual(bad.offers, ['soil', 'drop', 'serum']);
  assert.equal(bad.projectsDone, 3);
  for (const junk of [null, 'x', 7, {}]) assert.doesNotThrow(() => C.sanitizeState({ version: 2, zone: 4, research: junk, offers: junk }, 0));
  assert.doesNotThrow(() => C.mods({ upgrades: {}, perks: {}, traits: {} }), '연구 기록이 없는 상태에도 배수를 셀 수 있다');
});

/* ================= 1구역: 수색 지도 ================= */

test('수색 지도: 칸의 종류는 동네 번호로 정해지고 비율이 맞는다', () => {
  const count = { house: 0, store: 0, cache: 0 };
  for (let seed = 1; seed <= 500; seed++) for (let i = 0; i < C.SWEEP_TILES; i++) {
    const k = C.tileKind(seed, i);
    assert.equal(C.tileKind(seed, i), k, '같은 입력에는 같은 답');
    count[k.id]++;
  }
  const total = 500 * C.SWEEP_TILES;
  for (const k of C.TILE_KINDS) assert.ok(Math.abs(count[k.id] / total - k.weight / 100) < 0.03, k.id + ' ' + count[k.id] / total);
  assert.equal(C.TILE_KINDS.reduce((a, k) => a + k.weight, 0), 100);
  for (const junk of [NaN, -5, 1e12, 'x', null]) assert.doesNotThrow(() => C.tileKind(junk, junk));
});

test('수색 지도: 직접 수색은 한 칸을 뒤지고 칸의 종류만큼 번다', () => {
  const s = fresh();
  const base = C.clickValue(s), kind = C.tileKind(s.sweepSeed, 7);
  const r = C.scavenge(s, 7);
  assert.equal(r.tile, 7);
  assert.equal(r.kind, kind.id);
  near(r.gain, base * kind.mult);
  assert.ok(C.tileSearched(s, 7));
  assert.equal(C.sweepCount(s), 1);
  assert.equal(s.clicks, 1);
  // 칸을 정하지 않으면 맨 앞의 안 뒤진 칸, 이미 뒤진 칸이나 잘못된 번호도 마찬가지
  assert.equal(C.scavenge(s).tile, 0);
  assert.equal(C.scavenge(s, 7).tile, 1);
  for (const junk of [-1, 99, 2.5, NaN, 'x', null]) assert.ok(C.scavenge(s, junk).ok);
  assert.equal(C.sweepCount(s), 9);
});

test('수색 지도: 동네를 다 뒤지면 보너스를 받고 다음 동네로 넘어간다', () => {
  const s = fresh();
  const seed = s.sweepSeed;
  let last;
  for (let i = 0; i < C.SWEEP_TILES; i++) last = C.scavenge(s);
  assert.equal(last.swept, true);
  near(last.bonus, C.clickValue(s) * C.SWEEP_BONUS_CLICKS);
  assert.equal(s.sweeps, 1);
  assert.equal(s.sweepMask, 0);
  assert.equal(s.sweepSeed, seed + 1);
  assert.equal(C.nextTile(s), 0);
  assert.equal(C.scavenge(s).swept, false);
});

test('수색 지도: 누르기가 방치를 압도하지 않는다', () => {
  // 생산이 큰 판에서 스무 칸을 다 누른 수익(보너스 포함)이 초당 생산의 몇 배인지 본다: 초당 5번을 눌러도 생산의 절반을 넘지 않아야 한다
  const s = fresh(); s.buildings.workshop = 200; s.upgrades.crowbar = 12; s.traits.quick = 15;
  const per = C.productionPerSec(s), before = s.supplies;
  for (let i = 0; i < C.SWEEP_TILES; i++) C.scavenge(s);
  const perTap = (s.supplies - before) / C.SWEEP_TILES;
  assert.ok(perTap * 5 < per * 0.75, `한 번에 생산의 ${(perTap / per * 100).toFixed(1)}%`);
});

test('수색 지도: 시설이 있으면 알아서 뒤진다(칸 수익은 없고 동네 보너스만)', () => {
  const s = fresh(); s.defenses.rail = 1e5; s.signalIn = 1e9;
  C.tick(s, 30, half);
  assert.equal(C.sweepCount(s), 0, '시설이 없으면 그대로다');
  s.buildings.scouts = 1;
  C.tick(s, C.SWEEP_AUTO_SECONDS * 4 + 0.1, half);
  assert.equal(C.sweepCount(s), 4);
  assert.equal(s.clicks, 0);
  let swept = 0;
  for (let i = 0; i < 40; i++) swept += C.tick(s, C.SWEEP_AUTO_SECONDS, half).filter(e => e.type === 'sweep').length;
  assert.equal(swept, 2);
  assert.equal(s.sweeps, 2);
  assert.doesNotThrow(() => C.tick(s, 1e6, half));
  assert.ok(s.sweepClock >= 0 && s.sweepClock <= C.SWEEP_AUTO_SECONDS);
});

test('수색 지도: 저장을 안전하게 읽고, 철수하면 처음 동네로 돌아간다', () => {
  const s = fresh(); C.scavenge(s, 3); C.scavenge(s, 9); s.sweeps = 4; s.sweepSeed = 17;
  assert.deepEqual(C.deserialize(C.serialize(s), 0), s);
  const bad = C.sanitizeState({ version: 2, sweepMask: 1e15, sweepSeed: -3, sweepClock: 99, sweeps: 2.9 }, 0);
  assert.ok(bad.sweepMask >= 0 && bad.sweepMask < (1 << C.SWEEP_TILES));
  assert.equal(bad.sweepSeed, 1);
  assert.equal(bad.sweepClock, C.SWEEP_AUTO_SECONDS);
  assert.equal(bad.sweeps, 2);
  s.runEarned = C.RETREAT_MIN * 10;
  const r = C.retreat(s, 0).state;
  assert.equal(r.sweepMask, 0); assert.equal(r.sweeps, 0); assert.equal(r.sweepSeed, 1);
});

/* ================= 2구역: 시세판과 연속 호가 ================= */

test('시세판: 지난 시세가 정해진 수만큼 남는다', () => {
  const s = inMarket(); s.defenses.rail = 1e5; s.signalIn = 1e9; s.autoSell = false;
  assert.deepEqual(s.priceHistory, []);
  const first = s.price;
  C.tick(s, C.PRICE_STEP, half);
  assert.deepEqual(s.priceHistory, [first]);
  for (let i = 0; i < 40; i++) C.tick(s, C.PRICE_STEP, () => (i % 10) / 10);
  assert.equal(s.priceHistory.length, C.PRICE_HISTORY);
  const r = C.priceRange(s);
  for (const p of s.priceHistory) assert.ok(p >= r.floor && p <= r.ceil);
});

test('연속 호가: 평균 이상에서 직접 팔면 단계가 오르고 다음 판매가 커진다', () => {
  const s = inMarket(); s.stalls = 10;
  const mean = C.priceRange(s).mean, value = C.goodsValue(s);
  s.price = mean + 0.3; s.goods = 100;
  let r = C.sellGoods(s);
  near(r.gain, 100 * s.price * value, '첫 판매에는 보너스가 없다');
  assert.equal(s.streak, 1);
  s.goods = 100;
  r = C.sellGoods(s);
  near(r.gain, 100 * s.price * value * (1 + C.STREAK_BONUS), '오른 단계는 다음 판매부터 적용된다');
  assert.equal(s.streak, 1, '시세 하나에서는 한 번만 오른다');
  for (let i = 0; i < 10; i++) { s.streakUsed = false; s.goods = 1; C.sellGoods(s); }
  assert.equal(s.streak, C.STREAK_MAX);
  near(C.streakMult(s), 1 + C.STREAK_MAX * C.STREAK_BONUS);
});

test('연속 호가: 평균 아래에서 팔면 끊기고, 시세가 바뀌면 다시 올릴 수 있다', () => {
  const s = inMarket(); s.stalls = 10; s.defenses.rail = 1e5; s.signalIn = 1e9; s.autoSell = false;
  const mean = C.priceRange(s).mean;
  s.price = mean; s.goods = 5; C.sellGoods(s);
  assert.equal(s.streak, 1); assert.equal(s.streakUsed, true);
  C.tick(s, C.PRICE_STEP, () => 0.99);
  assert.equal(s.streakUsed, false);
  C.sellGoods(s);
  assert.equal(s.streak, 2);
  s.price = mean - 0.01; s.goods = 5; C.sellGoods(s);
  assert.equal(s.streak, 0);
});

test('연속 호가: 자동 판매도 단계를 올리고 보너스를 받지만, 낮은 시세에 팔려도 끊기지 않는다', () => {
  const s = inMarket(); s.stalls = 10; s.streak = 3;
  const value = C.goodsValue(s), mean = C.priceRange(s).mean;
  s.price = 0.6; s.goods = 100;
  let r = C.sellGoods(s, true);
  near(r.gain, 100 * 0.6 * value * 1.3);
  assert.equal(s.streak, 3, '낮은 시세의 자동 판매는 끊지 않는다');
  s.price = mean + 0.1; s.goods = 100;
  r = C.sellGoods(s, true);
  assert.equal(s.streak, 4, '평균 이상의 자동 판매는 올린다');
  // tick 의 자동 판매도 마찬가지다
  s.defenses.rail = 1e5; s.signalIn = 1e9; s.autoSell = true; s.goods = C.goodsCap(s);
  const ev = C.tick(s, 0.1, half).find(e => e.type === 'sold');
  assert.ok(ev && ev.auto); near(ev.bonus, 1.4);
});

test('시세판: 저장을 안전하게 읽고, 철수하면 비워진다', () => {
  const s = inMarket(); s.priceHistory = [0.7, 1.2, 1.9]; s.streak = 2; s.streakUsed = true;
  assert.deepEqual(C.deserialize(C.serialize(s), 0), s);
  const bad = C.sanitizeState({ version: 2, zone: 1, streak: 99, streakUsed: 'yes', priceHistory: Array.from({ length: 50 }, (_, i) => i % 2 ? 'x' : 1e9) }, 0);
  assert.equal(bad.streak, C.STREAK_MAX); assert.equal(bad.streakUsed, false);
  assert.equal(bad.priceHistory.length, C.PRICE_HISTORY);
  for (const p of bad.priceHistory) assert.ok(p >= 0 && p <= 10);
  for (const junk of [null, 'x', 5, {}]) assert.deepEqual(C.sanitizeState({ version: 2, priceHistory: junk }, 0).priceHistory, []);
  s.runEarned = C.RETREAT_MIN * 10; s.pendingPerks = [];
  const r = C.retreat(s, 0).state;
  assert.deepEqual(r.priceHistory, []); assert.equal(r.streak, 0);
});

/* ================= 3구역: 전력 투입 ================= */

test('전력 투입: 정해진 시간 동안 라인이 배로 돌고, 쉬는 시간이 있다', () => {
  const s = inFactory(); s.defenses.rail = 1e9; s.signalIn = 1e9; s.autoSell = false;
  assert.equal(C.surge(s).reason, 'stopped', '라인이 서 있으면 쓸 수 없다');
  s.machines.sorter = 2; s.machines.press = 3; s.machines.assembler = 6;
  const rate = C.lineRate(s);
  assert.ok(C.surge(s).ok);
  assert.equal(C.surge(s).reason, 'cooldown');
  near(C.lineNow(s), rate * C.SURGE_MULT);
  near(C.productionPerSec(s), C.searchRate(s) + C.tradeRate(s) + rate, '평균 수입(밤 전리품 등의 기준)은 그대로다');
  C.tick(s, 5, half);
  near(s.lineEarned, rate * 5 * C.SURGE_MULT);
  near(s.surgeLeft, C.SURGE_SECONDS - 5);
  // 남은 투입 시간보다 긴 시간을 한 번에 진행해도 투입 시간만큼만 배로 친다
  const before = s.lineEarned, r2 = C.lineRate(s);
  const ev = C.tick(s, 20, half);
  assert.ok(Math.abs((s.lineEarned - before) - r2 * (20 + (C.SURGE_SECONDS - 5) * (C.SURGE_MULT - 1))) / s.lineEarned < 0.02);
  assert.ok(ev.some(e => e.type === 'surge-end'));
  assert.equal(s.surgeLeft, 0);
  near(C.lineNow(s), C.lineRate(s));
  assert.equal(C.surge(s).reason, 'cooldown');
  C.tick(s, C.SURGE_COOLDOWN, half);
  assert.ok(C.surge(s).ok);
});

test('전력 투입: 잠긴 구역, 자리 비움, 저장', () => {
  assert.equal(C.surge(inMarket()).reason, 'locked');
  const s = inFactory(); s.defenses.rail = 1e5;      // 저장에서 읽을 수 있는 범위 안의 수
  s.machines.sorter = 2; s.machines.press = 3; s.machines.assembler = 6;
  C.surge(s);
  const rate = C.lineRate(s);
  C.applyOffline(s, 1000);
  near(s.lineEarned, rate * 1000 * C.OFFLINE_RATE, '자리를 비운 동안에는 투입 효과가 없다');
  assert.equal(s.surgeLeft, 0); assert.equal(s.surgeCool, 0);
  C.surge(s);
  assert.deepEqual(C.deserialize(C.serialize(s), 0), s);
  const bad = C.sanitizeState({ version: 2, zone: 2, surgeLeft: 1e9, surgeCool: -5 }, 0);
  assert.equal(bad.surgeLeft, C.SURGE_SECONDS); assert.equal(bad.surgeCool, 0);
});

/* ================= 4구역: 청신호 ================= */

test('청신호: 달리는 열차가 정해진 시간만큼 앞서 달리고 화물도 그만큼 싣는다', () => {
  const s = inStation(); s.defenses.rail = 1e5; s.signalIn = 1e9;
  assert.equal(C.greenSignal(s).reason, 'stopped', '달리는 열차가 없으면 켤 수 없다');
  s.trains = 2; s.routes.river = 1;
  const river = C.ROUTES.find(r => r.id === 'river');
  let r = C.greenSignal(s);
  assert.ok(r.ok); assert.deepEqual(r.arrivals, []);
  near(s.routeClock.river, C.GREEN_SECONDS);
  near(s.routeLoad.river, 2 * C.GREEN_SECONDS);
  assert.equal(C.greenSignal(s).reason, 'cooldown');
  // 도착 직전의 열차는 청신호로 바로 들어온다
  C.tick(s, river.seconds - C.GREEN_SECONDS - 10, half);
  assert.equal(s.railEarned, 0);
  s.greenCool = 0;
  r = C.greenSignal(s);
  assert.equal(r.arrivals.length, 1);
  assert.equal(r.arrivals[0].route, 'river');
  assert.ok(s.railEarned > 0);
  near(s.routeClock.river, C.GREEN_SECONDS - 10);
  C.tick(s, C.GREEN_COOLDOWN, half);
  assert.equal(s.greenCool, 0);
});

test('청신호: 잠긴 구역, 자리 비움, 저장', () => {
  assert.equal(C.greenSignal(inFactory()).reason, 'locked');
  const s = inStation(); s.defenses.rail = 1e5; s.trains = 1; s.routes.loop = 1;
  C.greenSignal(s);
  assert.deepEqual(C.deserialize(C.serialize(s), 0), s);
  C.applyOffline(s, 1000);
  assert.equal(s.greenCool, 0);
  const bad = C.sanitizeState({ version: 2, zone: 3, greenCool: 1e9 }, 0);
  assert.equal(bad.greenCool, C.GREEN_COOLDOWN);
});

/* ================= 자동 보조 ================= */

test('자동 보조: 새 판에는 켜져 있고, 전력 투입을 준비되는 대로 알아서 쓴다', () => {
  assert.equal(C.createState(0).autoAssist, true);
  assert.equal(C.sanitizeState({ version: 2 }, 0).autoAssist, true);
  assert.equal(C.sanitizeState({ version: 2, autoAssist: false }, 0).autoAssist, false);
  const s = inFactory(); s.autoAssist = true; s.defenses.rail = 1e9; s.signalIn = 1e9;
  let ev = C.tick(s, 1, half);
  assert.ok(!ev.some(e => e.type === 'surge'), '라인이 서 있으면 쓰지 않는다');
  s.machines.sorter = 2; s.machines.press = 3; s.machines.assembler = 6;
  ev = C.tick(s, 1, half);
  assert.ok(ev.some(e => e.type === 'surge'));
  assert.equal(s.surgeLeft, C.SURGE_SECONDS);
  let fired = 0;
  for (let i = 0; i < 300; i++) fired += C.tick(s, 1, half).filter(e => e.type === 'surge').length;
  assert.ok(fired >= 3 && fired <= 4, '90초마다 한 번: ' + fired);
});

test('자동 보조: 청신호도 알아서 켜고, 그 덕에 도착한 열차를 알린다', () => {
  const s = inStation(); s.autoAssist = true; s.defenses.rail = 1e9; s.signalIn = 1e9;
  let ev = C.tick(s, 1, half);
  assert.ok(!ev.some(e => e.type === 'green'), '달리는 열차가 없으면 켜지 않는다');
  s.trains = 1; s.routes.loop = 1;
  ev = C.tick(s, 1, half);
  assert.ok(ev.some(e => e.type === 'green'));
  assert.ok(ev.some(e => e.type === 'train'), '30초짜리 순환선은 청신호 한 번에 들어온다');
  assert.equal(s.greenCool, C.GREEN_COOLDOWN);
  // 2분 동안: 평소 4번 + 청신호 1번치 = 순환선 5번쯤
  const before = s.railEarned; let trips = 0;
  for (let i = 0; i < 120; i++) C.tick(s, 1, half).forEach(e => { if (e.type === 'train') trips += e.trips; });
  assert.ok(trips >= 4 && trips <= 6, String(trips));
  assert.ok(s.railEarned > before);
});

/* ================= 동물 친구 ================= */

test('동물 친구: 종류를 고르면 그 안에서 무작위로 온다', () => {
  for (const kind of ['dog', 'cat']) {
    const seen = new Set();
    for (let i = 0; i < 40; i++) { const s = fresh(); const r = C.adoptPet(s, kind, () => i / 40); assert.ok(r.ok); assert.equal(s.pet.kind, kind); assert.equal(r.breed.kind, kind); assert.equal(s.pet.name, r.breed.name); seen.add(s.pet.breed); }
    assert.equal(seen.size, C.PET_BREEDS.filter(b => b.kind === kind).length, '모든 품종이 나온다');
  }
  const s = fresh();
  assert.equal(C.adoptPet(s, 'bird', half).reason, 'unknown');
  C.adoptPet(s, 'cat', half);
  assert.equal(C.adoptPet(s, 'dog', half).reason, 'have');
  for (const junk of [() => NaN, () => 5, () => -1, null, 'x']) assert.ok(C.adoptPet(fresh(), 'dog', junk).ok);
});

test('동물 친구: 강아지는 방어력을, 고양이는 생산을 올린다', () => {
  const d = fresh(), c = fresh(), n = fresh();
  [d, c, n].forEach(s => { s.buildings.scouts = 10; s.defenses.wire = 10; });
  C.adoptPet(d, 'dog', half); C.adoptPet(c, 'cat', half);
  assert.equal(C.defensePower(d), Math.floor(C.defensePower(n) * 1.1));
  near(C.productionPerSec(d), C.productionPerSec(n));
  near(C.productionPerSec(c), C.productionPerSec(n) * 1.05);
  assert.equal(C.defensePower(c), C.defensePower(n));
  assert.ok(C.defensePlan(d).cost <= C.defensePlan(n).cost, '보강 계획에도 반영된다');
  assert.equal(C.petInfo(n), null);
  assert.equal(C.petInfo(d).kindName, '강아지');
});

test('동물 친구: 이름을 바꾼다', () => {
  const s = fresh();
  assert.equal(C.renamePet(s, '초코').reason, 'none');
  C.adoptPet(s, 'dog', half);
  assert.equal(C.renamePet(s, '  초코  ').name, '초코');
  assert.equal(s.pet.name, '초코');
  assert.equal(C.renamePet(s, '   ').reason, 'empty');
  assert.equal(C.renamePet(s, null).reason, 'empty');
  assert.equal(s.pet.name, '초코', '빈 이름으로는 바뀌지 않는다');
  assert.equal(C.renamePet(s, '가나다라마바사아자차카').name, '가나다라마바사아');
  assert.equal(C.renamePet(s, '<b>뭉\n치</b>').name, 'b 뭉 치 /b');
  assert.equal(C.renamePet(s, '😀😀😀😀😀😀😀😀😀😀').name, '😀'.repeat(C.PET_NAME_MAX), '이모지도 글자 수로 센다');
  assert.equal(C.cleanPetName(42, '기본'), '기본');
});

test('동물 친구: 철수해도 함께 가고, 저장을 안전하게 읽는다', () => {
  const s = inMarket(); C.adoptPet(s, 'cat', half); C.renamePet(s, '나비');
  s.runEarned = C.RETREAT_MIN * 10; s.pendingPerks = [];
  const r = C.retreat(s, 0).state;
  assert.deepEqual(r.pet, s.pet);
  assert.deepEqual(C.deserialize(C.serialize(r), 0).pet, r.pet);
  assert.equal(C.sanitizeState({ version: 2, pet: { breed: 'ghost', name: 'x' } }, 0).pet, null);
  assert.deepEqual(C.sanitizeState({ version: 2, pet: { kind: 'dog', breed: 'cheese', name: '<script>' } }, 0).pet, { kind: 'cat', breed: 'cheese', name: 'script' });
  assert.equal(C.sanitizeState({ version: 2, pet: { breed: 'jindo', name: '' } }, 0).pet.name, '흰둥이');
  for (const junk of ['x', 5, [], true]) assert.equal(C.sanitizeState({ version: 2, pet: junk }, 0).pet, null);
});
