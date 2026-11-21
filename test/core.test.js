/*
 * GameCore 단위 테스트 (알파 0.6 의 새 구조)
 * 실행: npm test
 * 화면 코드는 여기서 검사하지 않는다. 화면은 tools/smoke.py 가 브라우저로 돌려 본다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');

const fresh = () => C.createState(0);
const half = () => 0.5;
/** 1구역 목표를 모두 채우고 2구역을 연 상태. */
function inMarket() {
  const s = fresh();
  C.GOALS[0].forEach(g => { s.goalsDone[g.id] = true; });
  s.runEarned = C.ZONES[1].cost;      // 1.4.0: 문은 이번 회차 누적 물자로 열린다(가진 물자를 내지 않는다)
  s.runSeconds += 1e5; assert.ok(C.openZone(s).ok);
  s.runEarned = 0;
  return s;
}
/** 3구역(공단)까지 연 상태. 앞 구역의 목표는 채운 것으로 둔다. */
function inFactory() {
  const s = inMarket();
  C.GOALS[1].forEach(g => { s.goalsDone[g.id] = true; });
  s.zone = 2; s.bestZone = 2;
  // 3.3.0: 합치기 판은 기준 상자(9단계) 하나만 두고 상자가 더 들어오지 않게 멈춰 둔다. 그러면 판 배수가 정확히 1이라 라인 셈을 따로 볼 수 있다
  s.board = Array(C.BOARD_MAX).fill(0); s.feed = -1e9; s.contractIn = 270;
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

function onPlatform() { const s = inStation(); s.trains = 4; s.routes.grade = 1; s.plat = { t: 0, bank: 0, pos: 1, horn: 0, rush: 0, warn: 0, hand: 0 }; s.defenses.rail = 1e9; s.signalIn = 1e9; s.salvageIn = 1e9; return s; }
const calm = () => 0.5;      // 무리가 기준 걸음으로만 걷고 달려들지 않는다
function onBoard(levels) { const s = inFactory(); (levels || []).forEach((lv, i) => { s.board[i] = lv; }); return s; }

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
  assert.equal(bad.zone, 6, '구역 번호는 마지막 구역을 넘지 못한다');
  assert.equal(C.ZONES.find(z => z.kind === 'soon'), undefined);
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
  const s = fresh(); s.supplies = 1e30; s.buildings.scouts = 10; s.retreats = 10;      // 경험이 찬 사람(숙련 상한이 풀린 상태)의 값으로 본다
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

test('다음 구역: 목표를 다 채우고 이번 회차 누적 물자가 문 값에 닿아야 열린다. 가진 물자는 내지 않고, 앞 구역은 그대로 남는다', () => {
  const s = fresh(); s.supplies = 1e12; s.buildings.scouts = 30;
  assert.equal(C.openZone(s).reason, 'goals');
  C.GOALS[0].forEach(g => { s.goalsDone[g.id] = true; });
  const n = C.nextZone(s);
  assert.equal(n.zone.name, '재래시장');
  assert.equal(n.cost, C.ZONES[1].cost);
  // 가진 물자가 아무리 많아도 누적이 모자라면 안 열린다
  s.supplies = 1e12; s.runEarned = 100;
  assert.equal(n.enough, false); assert.equal(C.openZone(s).reason, 'supplies');
  // 누적이 닿으면 가진 물자가 한 푼도 없어도 열리고, 물자는 그대로다
  s.supplies = 5; s.runEarned = C.ZONES[1].cost;
  assert.equal(C.nextZone(s).enough, true); assert.equal(C.nextZone(s).have, C.ZONES[1].cost);
  const before = C.searchRate(s);
  s.runSeconds += 1e5; const r = C.openZone(s);
  assert.ok(r.ok && !r.soon);
  assert.equal(s.zone, 1);
  assert.equal(s.supplies, 5, '문을 열어도 물자는 줄지 않는다');
  assert.equal(s.buildings.scouts, 30, '1구역 시설은 남는다');
  assert.equal(C.searchRate(s), before, '1구역은 계속 번다');
});

test('다음 구역: 7구역까지 차례로 열리고, 그 뒤로는 다음 구역이 없다', () => {
  const s = inLab();
  C.GOALS[4].forEach(g => { s.goalsDone[g.id] = true; });
  s.runEarned = C.nextZone(s).cost;
  assert.equal(C.nextZone(s).soon, false);
  s.runSeconds += 1e5; assert.ok(C.openZone(s).ok); assert.equal(s.zone, 5);
  C.GOALS[5].forEach(g => { s.goalsDone[g.id] = true; });
  s.runEarned = C.nextZone(s).cost;
  assert.equal(C.nextZone(s).soon, false);
  s.runSeconds += 1e5; assert.ok(C.openZone(s).ok); assert.equal(s.zone, 6); assert.equal(s.gate, false);
  assert.equal(C.nextZone(s), null, '7구역이 마지막이다');
  s.runEarned = 1e60;
  assert.equal(C.openZone(s).ok, false);
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

test('거래: 자동 판매는 흥정꾼(개조)이나 자동화 특성이 있어야 한다. 좋은 시세에 팔고, 창고가 차면 그냥 판다', () => {
  const none = inMarket(); none.stalls = 10;
  for (let i = 0; i < 200; i++) assert.ok(!C.tick(none, 1, half).some(e => e.type === 'sold'), '흥정꾼이 없으면 알아서 팔지 않는다');
  const viaTrait = inMarket(); viaTrait.stalls = 10; viaTrait.traits.auto = 3;
  let traitSold = 0; for (let i = 0; i < 200; i++) traitSold += C.tick(viaTrait, 1, half).filter(e => e.type === 'sold').length;
  assert.equal(traitSold, 0, '자동화 특성만으로는 팔지 않는다(0.9.0)');
  const s = inMarket(); s.stalls = 10; s.upgrades.broker = 1;
  const sold = [];
  for (let i = 0; i < 200; i++) C.tick(s, 1, half).forEach(e => { if (e.type === 'sold') sold.push(e); });
  assert.ok(sold.length >= 2, '가만히 둬도 팔린다');
  sold.forEach(e => assert.equal(e.auto, true));
  assert.ok(s.tradeEarned > 0);
  // 흥정꾼: 평균 이상인 동안 sellInterval 초마다 판다. 레벨마다 2초씩 빨라진다(2초까지)
  assert.deepEqual([1, 2, 5, 9].map(lv => { const t = inMarket(); t.upgrades.broker = lv; return C.sellInterval(t); }), [10, 8, 2, 2]);
  const b = inMarket(); b.stalls = 10; b.upgrades.broker = 1; b.price = 1.9; b.goods = C.goodsCap(b) * 0.1; b.priceClock = 0; b.sellClock = 0;
  assert.ok(!C.tick(b, 0.1, half).some(e => e.type === 'sold'), '방금 팔았으면 간격을 기다린다');
  b.sellClock = C.sellInterval(b);
  assert.ok(C.tick(b, 0.1, half).some(e => e.type === 'sold'));
  assert.ok(b.sellClock < 1, '팔면 시계가 처음으로 돌아간다');
  const low = inMarket(); low.stalls = 10; low.upgrades.broker = 1; low.price = 0.6; low.goods = C.goodsCap(low) * 0.3; low.sellClock = 99;
  assert.ok(!C.tick(low, 0.1, half).some(e => e.type === 'sold'), '낮은 시세에서는 기다린다');
  const off = inMarket(); off.stalls = 10; off.upgrades.broker = 1; C.setAutoSell(off, false);
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
  const bal0 = C.BAL.anti; C.BAL.anti = 1;      // 4.7.7 이 시험은 식의 모양을 본다(밸런스 손잡이는 1로 두고 잰다)
  try {
  const s = fresh();
  assert.equal(C.antibodiesOnRetreat(s), 0);
  assert.equal(C.canRetreat(s), false);
  assert.equal(C.retreat(s, 0).ok, false);
  s.runEarned = C.RETREAT_MIN;
  assert.equal(C.antibodiesOnRetreat(s), C.RETREAT_K);
  s.runEarned = C.RETREAT_MIN * 1e4;
  const big = C.antibodiesOnRetreat(s);
  const raw = C.RETREAT_K + C.ANTI_STEP * Math.pow(4, C.ANTI_CURVE);      // 자릿수 4(1만 배)
  assert.equal(big, Math.floor(raw));
  assert.ok(big > C.RETREAT_K * 5);
  s.runEarned = C.RETREAT_MIN * 1e22;
  assert.ok(C.antibodiesOnRetreat(s) < 400, '뒤 구역에서 물자가 폭발해도 샘플은 수백 개를 넘지 않는다');
  s.runEarned = C.RETREAT_MIN * 1e4;
  s.traits.legacy = 5;
  assert.equal(C.antibodiesOnRetreat(s), Math.floor(raw * 1.5));
  s.pendingPerks = ['harvest'];
  assert.equal(C.canRetreat(s), false, '고르지 않은 특전이 있으면 안 된다');
  } finally { C.BAL.anti = bal0; }
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
  s.runSeconds += 1e5; s.runEarned = C.ZONES[1].cost; assert.ok(C.openZone(s).ok);
  const ev = C.tick(s, 0.1, half).filter(e => e.type === 'story');
  assert.equal(ev[0].id, 'z2-0');
  assert.equal(ev[0].zoneName, '재래시장');
  assert.ok(ev[0].text.length > 10);
});

test('이야기: 첫 철수와 공단의 문 앞에서 일지가 열리고, 읽은 일지는 철수해도 다시 뜨지 않는다', () => {
  const s = inMarket();
  C.tick(s, 0.1, half);
  C.GOALS[1].forEach(g => { s.goalsDone[g.id] = true; });
  s.runSeconds += 1e5; s.runEarned = C.ZONES[2].cost; C.openZone(s);
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
  C.UPGRADES.forEach(u => assert.ok(u.zone === -1 || (u.zone >= 0 && u.zone < C.ZONES.length && C.ZONES[u.zone].kind !== 'soon'), u.id));
  assert.equal(C.GOALS.length, C.ZONES.filter(z => z.kind !== 'soon').length);
});

/* ================= 3구역 ================= */

test('3구역: 시간이 흐르면 판 위의 상자가 물자를 번다', () => {
  const s = inFactory(); s.board[0] = 5; s.board[1] = 2; s.machines.paint = 3;
  s.defenses.rail = 1e5; s.signalIn = 1e9; s.autoSell = false;
  const rate = C.lineRate(s), before = s.supplies;
  near(rate, C.productValue(s) * 4 * (Math.pow(C.BOX_STEP, 4) + C.BOX_STEP)); assert.ok(rate > 0);
  C.tick(s, 10, half);
  near(s.lineEarned, rate * 10); near(s.supplies - before, rate * 10 + C.searchRate(s) * 10);
  near(C.productionPerSec(s), C.searchRate(s) + C.tradeRate(s) + C.lineRate(s)); near(C.lineNow(s), C.lineRate(s));
});



test('라인: 목표 셋과 일지, 그리고 철수하면 기계가 사라진다', () => {
  const s = inFactory();
  assert.equal(C.goals(s, 2).length, 3);
  assert.equal(C.goals(s, 2)[1].text, '손으로 합치기 40번');
  s.defenses.rail = 1e5; s.signalIn = 1e9; s.buildings.scouts = 1; s.clicks = 1;
  let ev = C.tick(s, 0.1, half);
  assert.ok(ev.some(e => e.type === 'story' && e.id === 'z3-0'), '들어서면 일지가 열린다');
  assert.equal(C.guide(s).id, 'goal');
  s.boxBest = 7;
  ev = C.tick(s, 0.1, half);
  assert.ok(ev.some(e => e.type === 'goal' && e.id === 'z3a'));
  s.runEarned = C.RETREAT_MIN * 10; s.pendingPerks = [];
  const r = C.retreat(s, 0);
  assert.ok(r.ok);
  assert.deepEqual(r.state.machines, { feed: 0, forge: 0, paint: 0 });
  assert.equal(r.state.lineEarned, 0);
  assert.equal(r.state.steadySeconds, 0);
  assert.equal(r.state.story['z3-0'], true, '읽은 일지는 남는다');
});

test('저장: 기계와 라인 기록을 안전하게 읽고, 문 앞에 있던 저장은 열린 구역으로 들여보낸다', () => {
  const s = inFactory();
  s.machines.paint = 4; s.lineEarned = 123; s.steadySeconds = 45;
  assert.deepEqual(C.deserialize(C.serialize(s), 0), s);
  const bad = C.sanitizeState({ version: 2, zone: 2, machines: { paint: 1e9, feed: -2, forge: 'x', ghost: 3 }, lineEarned: -1, steadySeconds: NaN, lineV: 3 }, 0);
  assert.deepEqual(bad.machines, { feed: 0, forge: 0, paint: 500 });
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
  // 1.0.4: 6구역이 열렸다. 6구역 문 앞에 있던 저장은 6구역으로 들어간다
  const old6 = C.sanitizeState({ version: 2, zone: 4, gate: true, story: { 'gate-6': true } }, 0);
  assert.equal(old6.zone, 5); assert.equal(old6.gate, false);
  // 1.2.0: 7구역이 열렸다. 7구역 문 앞에 있던 저장은 7구역으로 들어간다
  const old7 = C.sanitizeState({ version: 2, zone: 5, gate: true }, 0);
  assert.equal(old7.zone, 6); assert.equal(old7.gate, false);
});

/* ================= 4구역: 노선 ================= */

test('노선: 열차 수가 구간에 닿을 때마다 화물 2배', () => {
  assert.equal(C.fleetMilestone(0), 1);
  assert.equal(C.fleetMilestone(C.FLEET_MILESTONES[0]), 2);
  assert.equal(C.fleetMilestone(C.FLEET_MILESTONES[2]), 8);
  const s = inStation(); s.trains = 3;
  const v = C.cargoValue(s);
  s.trains = 4;
  near(C.cargoValue(s), v * 2);
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
  s.pendingPerks = []; s.runEarned = C.RETREAT_MIN * 10; s.routes.grade = 3;
  const r = C.retreat(s, 0);
  assert.equal(r.state.trains, 0);
  assert.deepEqual(r.state.routes, { grade: 0, crew: 0 });
  assert.equal(r.state.expressRuns, 0);
  assert.equal(r.state.railEarned, 0);
});

test('저장: 열차와 노선을 안전하게 읽는다', () => {
  const s = inStation();
  s.trains = 5; s.routes.crew = 2; s.railEarned = 9; s.expressRuns = 1;
  assert.deepEqual(C.deserialize(C.serialize(s), 0), s);
  const bad = C.sanitizeState({ version: 2, zone: 3, trains: 1e9, routes: { grade: 1e9, crew: -1, ghost: 2 }, railV: 2, railEarned: -4, expressRuns: 2.7 }, 0);
  assert.equal(bad.trains, C.TRAIN_MAX);
  assert.deepEqual(bad.routes, { grade: C.ROUTES[0].max, crew: 0 });
  assert.equal(bad.railEarned, 0);
  assert.equal(bad.expressRuns, 2);
  for (const junk of [null, 'x', 7, []]) assert.doesNotThrow(() => C.sanitizeState({ version: 2, zone: 3, routes: junk, routeClock: junk, routeLoad: junk }, 0));
});

test('항체: 4구역 뒤로는 완만하게 늘고, 항체 정제는 3번까지(2.9.6)', () => {
  const bal0 = C.BAL.anti; C.BAL.anti = 1;      // 4.7.7 이 시험은 식의 모양을 본다(밸런스 손잡이는 1로 두고 잰다)
  try {
  const at = (e) => { const s = C.createState(0); s.zone = 3; s.runEarned = Math.pow(10, e); return C.antibodiesOnRetreat(s); };
  assert.equal(at(17), Math.floor(2 + 4 * Math.pow(9, 1.3)), '4구역 전까지는 예전 그대로');
  assert.ok(at(28) < 200 && at(28) > at(19), '뒤 구역: ' + at(28));
  assert.ok(at(33) - at(28) <= 21, '자릿수 다섯에 스무 개 안팎');
  const s = C.createState(0); s.zone = 4; s.research.refine = 3;
  for (let i = 0; i < 200; i++) { let k = i; assert.ok(!C.drawOffers(() => ((k = (k * 7919 + 13) % 1000) / 1000), s).includes('refine')); }
  s.offers = ['refine', 'serum', 'drill']; s.points = 1e30; assert.equal(C.runProject(s, 'refine', () => 0.5).reason, 'max');
  } finally { C.BAL.anti = bal0; }
});

test('과제: 지나온 구역의 과제는 나오지 않는다(2.9.5)', () => {
  const seen = (zone) => { const out = new Set(); for (let i = 0; i < 300; i++) { let k = i; C.drawOffers(() => ((k = (k * 7919 + 13) % 1000) / 1000), { zone }).forEach(id => out.add(id)); } return out; };
  const z5 = seen(4);
  for (const id of ['soil', 'ledger', 'process', 'transit']) assert.ok(!z5.has(id), id);
  for (const id of ['drill', 'serum', 'refine', 'drop']) assert.ok(z5.has(id), id);
  const z7 = seen(6); assert.equal(z7.size, 4);
  assert.equal(C.drawOffers(() => 0.5, { zone: 6 }).length, C.OFFER_COUNT);
  assert.equal(new Set(C.drawOffers(() => 0.5)).size, C.OFFER_COUNT, '상태 없이 부르면 전체에서 뽑는다');
});

test('특전: 아직 열지 않은 구역의 특전은 나오지 않는다', () => {
  const seen = (state) => { const out = new Set(); for (let i = 0; i < 400; i++) { let k = i; C.drawPerks(() => ((k = (k * 7919 + 13) % 1000) / 1000), state).forEach(id => out.add(id)); } return out; };
  const z1 = seen(fresh());
  for (const id of ['bargain', 'foreman', 'driver']) assert.ok(!z1.has(id), id);
  for (const id of ['harvest', 'watch', 'hands', 'spoils', 'frugal', 'local', 'sample']) assert.ok(z1.has(id), id);
  // 2.8.3: 한 구역에만 듣는 특전은 어느 구역에서도 나오지 않는다
  const z4 = seen(inStation());
  for (const id of ['bargain', 'foreman', 'driver', 'aide']) assert.ok(!z4.has(id), id + ' 는 더 나오지 않는다');
  assert.equal(z4.size, 7);
  // 현장 일손: 현재 있는 구역의 생산에만 붙고, 구역을 옮기면 따라간다
  const h = inMarket(); const m0 = C.mods(h); h.perks.local = 2; const m1 = C.mods(h);
  assert.ok(Math.abs(m1.z2 / m0.z2 - 1.4) < 1e-9); assert.equal(m1.z1, m0.z1); assert.equal(m1.z3, m0.z3);
  h.zone = 2; assert.ok(Math.abs(C.mods(h).z3 / m0.z3 - 1.4) < 1e-9); assert.equal(C.mods(h).z2, m0.z2);
  // 채혈은 3레벨까지: 다 올리면 후보에서 빠지고, 남아 있던 후보로도 넘기지 못한다
  const cap = fresh(); cap.perks.sample = 3;
  assert.ok(!seen(cap).has('sample'));
  cap.pendingPerks = ['sample', 'harvest', 'watch']; assert.equal(C.choosePerk(cap, 'sample').ok, false); assert.equal(cap.perks.sample, 3);
  // 이미 고른 옛 특전의 효과는 남는다
  const old = inMarket(); old.perks.bargain = 1; assert.ok(Math.abs(C.mods(old).z2 / m0.z2 - 1.4) < 1e-9);
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
  C.tick(s, 30, half);      // 3.9.0: 연구 점수는 시험관을 거둘 때 들어온다(가만히 두면 탄 관에서 조금만 건진다)
  assert.ok(s.points < 30);
  assert.equal(s.offers.length, C.OFFER_COUNT);
  assert.equal(new Set(s.offers).size, C.OFFER_COUNT);
  s.staff = 10;
  assert.equal(C.researchRate(s), 20, '10명에 닿으면 2배');
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
  assert.equal(C.projectCost(s), C.PROJECT_BASE + C.PROJECT_STEP);
  assert.equal(s.offers.length, C.OFFER_COUNT, '과제 셋이 새로 나온다');
  s.offers = ['soil', 'drill', 'serum']; s.points = 1e9;
  C.runProject(s, 'soil', half);
  near(C.searchRate(s), before * 4);
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

test('연구 성과는 없앴다(4.0.5): 자리를 비워도, 혈청을 놓아도 점수가 쌓이지 않는다', () => {
  const s = inLab(); s.staff = 10; s.defenses.rail = 1e9; s.upgrades.autolab = 1; s.upgrades.nurse = 1;
  assert.equal(C.applyOffline(s, 1000).points, 0); assert.equal(s.points, 0);
  C.wardOf(s).stock = 3; C.wardOf(s).seats[0] = { m: 0, dose: 0, r: 1, look: 1, since: 0 }; C.injectSeat(s, 0); assert.equal(s.points, 0);
  // 옛 저장에 쌓여 있던 점수와 내밀던 과제는 버린다. 이미 고른 효과는 이번 회차 동안 남는다
  const old = JSON.parse(C.serialize(s)); delete old.labV4; old.points = 6.9e7; old.offers = ['serum', 'drop']; old.research = { serum: 3 }; old.projectsDone = 3;
  const m = C.deserialize(JSON.stringify(old), 0); assert.equal(m.points, 0); assert.deepEqual(m.offers, []); assert.equal(m.research.serum, 3);
  C.tick(m, 0.5, half); assert.equal(m.points, 0);
});

test('연구: 목표와 일지, 그리고 철수하면 연구가 사라진다', () => {
  const s = inLab();
  assert.equal(C.goals(s, 4).length, 3);
  s.defenses.rail = 1e9; s.signalIn = 1e9; s.buildings.scouts = 1; s.clicks = 1;
  let ev = C.tick(s, 0.1, half);
  assert.ok(ev.some(e => e.type === 'story' && e.id === 'z5-0'));
  s.curesRun = 20;
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
  s.staff = 7; s.points = 123.5; s.research.soil = 2; s.offers = ['soil', 'drop']; s.projectsDone = 2;
  assert.deepEqual(C.deserialize(C.serialize(s), 0), s);
  const bad = C.sanitizeState({ version: 2, zone: 4, labV: 3, labV4: 1, staff: 1e9, points: -3, research: { soil: 1e9, ghost: 4, drill: 'x' }, offers: ['soil', 'soil', 'ghost', 42, 'drop', 'serum', 'drill'], projectsDone: 3.9 }, 0);
  assert.equal(bad.staff, C.COUNT_MAX);
  assert.equal(bad.points, 0);
  assert.equal(bad.research.soil, 200);
  assert.equal(bad.research.ghost, undefined);
  assert.equal(bad.research.drill, 0);
  assert.deepEqual(bad.offers, ['soil', 'drop']);
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

test('수색 지도: 순찰조(개조)가 있으면 알아서 뒤진다(칸 수익은 없고 동네 보너스만). 올릴수록 빨라진다', () => {
  const s = fresh(); s.defenses.rail = 1e5; s.signalIn = 1e9;
  C.tick(s, 30, half);
  s.buildings.scouts = 5; C.tick(s, 30, half);
  assert.equal(C.sweepCount(s), 0, '순찰조가 없으면 시설이 있어도 그대로다');
  s.upgrades.patrol = 1;
  assert.equal(C.autoOn(s, 0), true); assert.equal(C.autoOn(s, 1), false); assert.equal(C.autoOn(s, 9), false);
  assert.deepEqual([1, 2, 5].map(lv => { const t = fresh(); t.upgrades.patrol = lv; return C.sweepInterval(t); }), [3, 2.6, 1.4]);
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
  s.defenses.rail = 1e5; s.signalIn = 1e9; s.autoSell = true; s.upgrades.broker = 1; s.goods = C.goodsCap(s);
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

test('청신호: 잠긴 구역, 자리 비움, 저장', () => {
  assert.equal(C.greenSignal(inFactory()).reason, 'locked');
  const s = inStation(); s.defenses.rail = 1e5; s.trains = 1; s.routes.grade = 1;
  C.greenSignal(s);
  assert.deepEqual(C.deserialize(C.serialize(s), 0), s);
  C.applyOffline(s, 1000);
  assert.equal(s.greenCool, 0);
  const bad = C.sanitizeState({ version: 2, zone: 3, greenCool: 1e9 }, 0);
  assert.equal(bad.greenCool, C.GREEN_COOLDOWN);
});

/* ================= 자동 보조 ================= */

const lcg = (seed) => () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);

test('동물 친구: 등급은 정해진 비율로 나오고, 높을수록 효과가 크다', () => {
  assert.equal(C.PET_RARITIES.reduce((a, r) => a + r.weight, 0), 100);
  const rng = lcg(7), n = { common: 0, fine: 0, rare: 0 };
  for (let i = 0; i < 20000; i++) n[C.rollRarity(rng()).id]++;
  for (const r of C.PET_RARITIES) assert.ok(Math.abs(n[r.id] / 20000 - r.weight / 100) < 0.02, r.id + ' ' + n[r.id]);
  for (let i = 1; i < C.PET_RARITIES.length; i++) { assert.ok(C.PET_RARITIES[i].dog > C.PET_RARITIES[i - 1].dog); assert.ok(C.PET_RARITIES[i].cat > C.PET_RARITIES[i - 1].cat); }
  for (const junk of [NaN, -1, 5, 'x', null]) assert.ok(C.rollRarity(junk).id);
  // 종류마다 모든 등급에 품종이 있다
  for (const kind of ['dog', 'cat']) for (const r of C.PET_RARITIES) assert.ok(C.PET_BREEDS.some(b => b.kind === kind && b.rarity === r.id), kind + ' ' + r.id);
});

test('동물 친구: 첫 친구는 그냥 오고, 고른 종류 안에서 무작위로 온다', () => {
  for (const kind of ['dog', 'cat']) {
    const seen = new Set(), rng = lcg(11);
    for (let i = 0; i < 400; i++) { const s = fresh(); const r = C.adoptPet(s, kind, rng); assert.ok(r.ok); assert.equal(r.cost, 0); assert.equal(r.breed.kind, kind); assert.equal(r.breed.rarity, r.rarity.id); assert.equal(s.pet.breed, r.breed.id); assert.equal(s.kennel[r.breed.id], r.breed.name); seen.add(r.breed.id); }
    assert.equal(seen.size, C.PET_BREEDS.filter(b => b.kind === kind).length, '모든 품종이 나온다');
  }
  assert.equal(C.adoptPet(fresh(), 'bird', half).reason, 'unknown');
  for (const junk of [() => NaN, () => 5, () => -1, null, 'x']) assert.ok(C.adoptPet(fresh(), 'dog', junk).ok);
});

test('동물 친구: 다시 데려오기는 항체 샘플이 들고, 판이 커지면 값도 오른다', () => {
  const s = fresh();
  assert.equal(C.petPullCost(s), 0);
  C.adoptPet(s, 'dog', () => 0);                       // 기본 등급의 첫 품종
  assert.equal(C.petPullCost(s), C.PET_PULL_MIN);
  assert.equal(C.adoptPet(s, 'cat', half).reason, 'antibodies');
  s.antibodies = 10;
  const r = C.adoptPet(s, 'cat', () => 0.99);          // 희귀
  assert.ok(r.ok); assert.equal(r.rarity.id, 'rare'); assert.equal(r.dup, false);
  assert.equal(s.antibodies, 10 - C.PET_PULL_MIN);
  assert.equal(s.pet.breed, r.breed.id, '새로 온 아이를 바로 데리고 다닌다');
  assert.equal(C.kennelCount(s), 2);
  s.antibodyTotal = 1000;
  assert.equal(C.petPullCost(s), Math.ceil(1000 * C.PET_PULL_SHARE));
});

test('동물 친구: 이미 함께 있는 아이가 또 나오면 값의 일부를 돌려받는다', () => {
  const s = fresh(); s.antibodyTotal = 400; s.antibodies = 100;
  C.adoptPet(s, 'dog', () => 0);
  const active = s.pet.breed, cost = C.petPullCost(s), before = s.antibodies;
  C.renamePet(s, '초코');
  const r = C.adoptPet(s, 'dog', () => 0);
  assert.equal(r.dup, true);
  assert.equal(r.refund, Math.floor(cost * C.PET_DUP_REFUND));
  assert.equal(s.antibodies, before - cost + r.refund);
  assert.equal(s.pet.breed, active); assert.equal(s.pet.name, '초코', '이름은 그대로다');
  assert.equal(C.kennelCount(s), 1);
});

test('동물 친구(4.4.6): 장착 칸 둘(강아지 · 고양이), 종류 효과 · 특기 · 보유 효과', () => {
  const n = fresh(); n.buildings.scouts = 10; n.defenses.wire = 10;
  const mk = (kind, roll) => { const s = fresh(); s.buildings.scouts = 10; s.defenses.wire = 10; C.adoptPet(s, kind, () => roll); return s; };
  const d = mk('dog', 0), dr = mk('dog', 0.99), c = mk('cat', 0), cr = mk('cat', 0.99);
  assert.equal(d.pet.breed, 'jindo'); assert.equal(dr.pet.breed, 'bernese'); assert.equal(c.pet.breed, 'cheese'); assert.equal(cr.pet.breed, 'turkish');
  const def = (s) => C.defensePower(s), near1 = (a, b) => assert.ok(Math.abs(a - b) <= 1, a + ' ≈ ' + b);
  near1(def(d), def(n) * 1.01 * 1.1);                   // 보유 1% × 장착 10%
  near1(def(dr), def(n) * 1.04 * 1.35);                 // 보유 4% × 장착 35%
  near(C.productionPerSec(c), C.productionPerSec(n) * 1.01 * 1.05 * 1.2);    // 치즈의 특기: 1구역 생산 +20%
  near(C.productionPerSec(cr), C.productionPerSec(n) * 1.04 * 1.2);           // 터키시 앙고라의 특기는 밤 전리품이라 생산에는 없다
  near(C.mods(cr).loot, C.mods(n).loot * 1.3);
  near(C.mods(d).loot, C.mods(n).loot * 1.15);      // 흰둥이의 특기
  near(C.productionPerSec(d), C.productionPerSec(n)); assert.equal(def(c), def(n));
  assert.ok(C.defensePlan(dr).cost <= C.defensePlan(n).cost, '보강 계획에도 반영된다');
  assert.equal(C.petInfo(n), null); assert.equal(C.petEffect(n), null);
  assert.ok(C.petInfo(dr).desc.includes('방어력 +35%')); assert.equal(C.petInfo(dr).rarity.name, '희귀');
  assert.equal(C.petInfo(c).skill, '1구역 생산 +20%');
  // 강아지와 고양이를 함께 장착한다: 둘 다 효과가 있다
  d.antibodies = 99; C.adoptPet(d, 'cat', () => 0.99);
  assert.deepEqual(d.party, { dog: 'jindo', cat: 'turkish' });
  near1(def(d), def(n) * 1.01 * 1.1);
  near(C.productionPerSec(d), C.productionPerSec(n) * 1.04 * 1.2);
  // 강아지를 다시 고르면 데리고 다니는 아이만 바뀌고 고양이 칸은 그대로
  assert.ok(C.choosePet(d, 'jindo').ok); assert.equal(d.pet.breed, 'jindo'); assert.equal(d.party.cat, 'turkish');
  assert.equal(C.choosePet(d, 'siam').reason, 'unknown', '아직 없는 아이는 고를 수 없다');
  assert.equal(C.choosePet(d, 'ghost').reason, 'unknown');
  // 같은 종류는 한 칸: 강아지를 하나 더 데려오면 강아지 칸만 바뀐다
  d.antibodies = 1e9; C.adoptPet(d, 'dog', () => 0.99);
  assert.equal(d.party.dog, 'bernese'); assert.equal(d.party.cat, 'turkish');
  near1(def(d), def(n) * (1.01 + 0.04) * 1.35);       // 흰둥이는 장착에서 빠져도 보유 효과는 남는다
  // 4.4.9 보유 효과는 강화(레벨)로 커지지 않는다
  d.petLv.jindo = 10; near(C.petOwnBonus(d).dog, 0.01 + 0.04);
  // 36종 모두 특기가 있고, 있는 배수 항목에만 얹는다
  const m0 = C.mods(fresh());
  C.PET_BREEDS.forEach(b => { const k = C.PET_SKILLS[b.id]; assert.ok(k && k.text, b.id); assert.ok(k.key in m0, b.id + ' ' + k.key); assert.ok((k.mult > 0) !== !!k.add, b.id); });
});

test('동물 친구(4.4.6): 장착 칸 저장 · 불러오기 · 철수', () => {
  const s = inMarket(); s.antibodies = 1e9;
  C.adoptPet(s, 'dog', () => 0); C.adoptPet(s, 'cat', () => 0.99);
  const r = C.deserialize(C.serialize(s), 0);
  assert.deepEqual(r.party, { dog: 'jindo', cat: 'turkish' });
  // 예전 저장(장착 칸 없음): 데리고 다니던 아이가 그 칸에 들어간다
  const old = JSON.parse(JSON.stringify(s)); delete old.party;
  assert.deepEqual(C.deserialize(JSON.stringify(old), 0).party, { dog: null, cat: 'turkish' });
  // 엉터리: 없는 아이 · 종류가 틀린 아이는 받지 않는다
  const bad = JSON.parse(JSON.stringify(s)); bad.party = { dog: 'turkish', cat: 'siam' }; bad.pet = null;
  assert.deepEqual(C.deserialize(JSON.stringify(bad), 0).party, { dog: null, cat: null });
  const bad2 = JSON.parse(JSON.stringify(s)); bad2.party = 'x';
  assert.equal(C.deserialize(JSON.stringify(bad2), 0).party.cat, 'turkish');
  // 철수해도 장착은 남는다
  s.antibodiesGain = 0; const next = C.retreat ? C.retreat(s) : null;
  if (next && next.state) assert.deepEqual(next.state.party, { dog: 'jindo', cat: 'turkish' });
});

test('이름: 친구와 주인공의 이름을 바꾼다', () => {
  const s = fresh();
  assert.equal(s.heroName, '라라');
  assert.equal(C.renamePet(s, '초코').reason, 'none');
  C.adoptPet(s, 'dog', half);
  assert.equal(C.renamePet(s, '  초코  ').name, '초코');
  assert.equal(s.kennel[s.pet.breed], '초코');
  assert.equal(C.renamePet(s, '   ').reason, 'empty');
  assert.equal(C.renamePet(s, null).reason, 'empty');
  assert.equal(s.pet.name, '초코', '빈 이름으로는 바뀌지 않는다');
  assert.equal(C.renamePet(s, '가나다라마바사아자차카').name, '가나다라마바사아');
  assert.equal(C.renamePet(s, '<b>뭉\n치</b>').name, 'b 뭉 치 /b');
  assert.equal(C.renamePet(s, '😀😀😀😀😀😀😀😀😀😀').name, '😀'.repeat(C.PET_NAME_MAX), '이모지도 글자 수로 센다');
  assert.equal(C.cleanName(42, '기본'), '기본');
  assert.equal(C.setHeroName(s, ' 김씨 ').name, '김씨');
  assert.equal(C.setHeroName(s, '').reason, 'empty');
  assert.equal(s.heroName, '김씨');
});

test('동물 친구와 이름: 철수해도 함께 가고, 저장을 안전하게 읽는다', () => {
  const s = inMarket(); C.adoptPet(s, 'cat', half); C.renamePet(s, '나비'); C.setHeroName(s, '김씨');
  s.runEarned = C.RETREAT_MIN * 10; s.pendingPerks = [];
  const r = C.retreat(s, 0).state;
  assert.deepEqual(r.pet, s.pet); assert.deepEqual(r.kennel, s.kennel); assert.equal(r.heroName, '김씨');
  assert.deepEqual(C.deserialize(C.serialize(r), 0), r);
  assert.equal(C.sanitizeState({ version: 2, pet: { breed: 'ghost', name: 'x' } }, 0).pet, null);
  // 알파 0.7.5 의 저장(친구 하나, 일행 목록 없음)은 그 아이가 일행에 들어간다
  const old = C.sanitizeState({ version: 2, pet: { kind: 'dog', breed: 'cheese', name: '<script>' } }, 0);
  assert.deepEqual(old.pet, { kind: 'cat', breed: 'cheese', name: 'script' });
  assert.deepEqual(old.kennel, { cheese: 'script' });
  const bad = C.sanitizeState({ version: 2, heroName: '<<>>', kennel: { jindo: '', ghost: 'x', nero: 5 }, pet: { breed: 'jindo', name: '다른 이름' } }, 0);
  assert.equal(bad.heroName, '라라');
  assert.deepEqual(bad.kennel, { jindo: '흰둥이', nero: '네로' });
  assert.equal(bad.pet.name, '흰둥이', '일행 목록의 이름을 따른다');
  for (const junk of ['x', 5, [], true]) { const j = C.sanitizeState({ version: 2, pet: junk, kennel: junk, heroName: typeof junk === 'string' ? '' : junk }, 0); assert.equal(j.pet, null); assert.deepEqual(j.kennel, {}); assert.equal(j.heroName, '라라'); }
});

test('자동화: 레벨이 오를수록 대기 시간이 줄고, 절반 아래로는 내려가지 않는다', () => {
  const s = inStation();
  assert.equal(C.assistFactor(s), 1);
  s.traits.auto = 1;
  near(C.assistFactor(s), 1 - C.ASSIST_STEP);
  near(C.surgeCooldown(s), C.SURGE_COOLDOWN * (1 - C.ASSIST_STEP));
  near(C.greenCooldown(s), C.GREEN_COOLDOWN * (1 - C.ASSIST_STEP));
  s.traits.auto = C.ASSIST_MAX;
  assert.equal(C.assistFactor(s), 0.5);
  s.machines.sorter = 2; s.machines.press = 3; s.machines.assembler = 6; s.trains = 1; s.routes.grade = 1;
  const t = C.TRAITS.find(x => x.id === 'auto');
  assert.equal(t.max, C.ASSIST_MAX);
  const b = fresh(); b.antibodies = 2;
  assert.ok(C.buyTrait(b, 'auto').ok);
  assert.ok(C.assistFactor(b) < 1);
  assert.equal(C.autoOn(b, 2), false, '특성만으로는 자동이 켜지지 않는다');
  C.resetTraits(b);
  assert.equal(C.assistFactor(b), 1, '되돌리면 대기 시간도 돌아온다');
});

/* ---------- 알파 0.8.0: 소설 일지, 지난 구역, 숫자 표기 ---------- */
test('일지: 편마다 제목과 여러 문단이 있고, 구역마다 3편씩이다', () => {
  for (const b of C.BEATS) {
    assert.ok(typeof b.title === 'string' && b.title.length > 0, b.id);
    assert.ok(b.text.split('\n\n').length >= (b.mom ? 3 : 4), b.id + ' 는 문단이 너무 적다');      // 엄마의 수첩은 한 쪽이 짧다(하루에 한 쪽을 겨우 쓴다)
    assert.ok(b.part >= 1);
  }
  for (const no of [1, 2, 3, 4, 5]) assert.equal(C.BEATS.filter(b => b.id.startsWith('z' + no + '-')).length, 3);
  const story = C.tick(C.createState(), 0.1, () => 0.5).find(e => e.type === 'story');
  assert.equal(story.title, '열두 번째 날');
});

test('지난 구역: 구역을 열 때마다 기록이 남고, 구역마다 머문 시간이 나온다', () => {
  const s = C.createState();
  s.runSeconds = 100;
  assert.deepEqual(C.zoneHistory(s), [{ zone: 0, name: '주택가', here: true, day: 1, seconds: 100 }]);
  s.zoneLog.push({ zone: 1, seconds: 60, day: 3 }); s.zone = 1;
  const h = C.zoneHistory(s);
  assert.deepEqual(h.map(r => r.seconds), [60, 40]);
  assert.deepEqual(h.map(r => r.here), [false, true]);
  assert.equal(C.stats(s, Date.now()).zones.length, 2);
  // 기록이 없는 예전 저장: 시간은 모른다(null), 오류는 없다
  const old = C.createState(); old.zone = 2; old.runSeconds = 500;
  assert.deepEqual(C.zoneHistory(old).map(r => r.seconds), [null, null, null]);
  // 저장을 거쳐도 남고, 잘못된 기록은 버린다
  const back = C.deserialize(C.serialize(s), 0);
  assert.deepEqual(back.zoneLog, [{ zone: 1, seconds: 60, day: 3 }]);
  const raw = JSON.parse(C.serialize(s)); raw.zoneLog = [{ zone: 99, seconds: 1, day: 1 }, { zone: 1, seconds: -5, day: 1 }, null, 'x', { zone: 1.5, seconds: 1, day: 1 }];
  assert.deepEqual(C.sanitizeState(raw).zoneLog, []);
});

test('숫자 표기: 지수 표기로 바꿀 수 있고, 모르는 값은 기본(만·억)으로 돌아간다', () => {
  assert.equal(C.formatNumber(123456789), '1.23억');
  assert.equal(C.setNotation('sci'), 'sci');
  assert.equal(C.formatNumber(123456789), '1.23e8');
  assert.equal(C.formatNumber(999), '999');
  assert.equal(C.setNotation('nonsense'), 'kr');
  assert.equal(C.formatNumber(123456789), '1.23억');
});

test('시장의 일손: 짐꾼은 창고를, 호객꾼은 상품 값을 올린다. 2구역이 열려야 살 수 있고 상한이 있다', () => {
  const s = inMarket(); s.stalls = 10; s.supplies = 1e12;
  const cap = C.goodsCap(s), value = C.goodsValue(s);
  assert.equal(C.buyHand(s, 'porter', 3).ok, true);
  near(C.goodsCap(s), cap * 1.3);
  assert.equal(C.buyHand(s, 'crier', 10).ok, true);
  near(C.goodsValue(s), value * 1.3);
  assert.ok(C.handCost(s, 'porter', 1) > C.HANDS[0].baseCost, '살수록 비싸진다');
  assert.equal(C.buyHand(s, 'nothing', 1).ok, false);
  assert.equal(C.buyHand(s, 'porter', 0).ok, false);
  assert.equal(C.handCost(s, 'porter', 1e6), Infinity);
  s.supplies = 0; assert.equal(C.buyHand(s, 'porter', 1).ok, false);
  const f = C.createState(); f.supplies = 1e12;
  assert.equal(C.buyHand(f, 'porter', 1).ok, false, '2구역을 열기 전에는 못 산다');
  // 저장을 거쳐도 남고, 잘못된 값은 0 ~ 상한으로 맞춘다
  assert.deepEqual(C.deserialize(C.serialize(s), 0).hands, { porter: 3, crier: 10 });
  const raw = JSON.parse(C.serialize(s)); raw.hands = { porter: -4, crier: 1e9, fake: 3 };
  assert.deepEqual(C.sanitizeState(raw).hands, { porter: 0, crier: 200 });
  raw.hands = 'x'; assert.deepEqual(C.sanitizeState(raw).hands, { porter: 0, crier: 0 });
});

test('일지의 이름 자리: 주인공 이름과 받침에 맞는 조사가 들어간다. 기본 이름은 라라', () => {
  assert.equal(C.createState().heroName, '라라');
  assert.equal(C.fillStory('{hero:야}, {hero:은} {hero:을} {hero:이} {hero}', '라라'), '라라야, 라라는 라라를 라라가 라라');
  assert.equal(C.fillStory('{hero:야}, {hero:은} {hero:을} {hero:이}', '민준'), '민준아, 민준은 민준을 민준이');
  assert.equal(C.fillStory('{hero:야}', 'Zoe'), 'Zoe야');
  for (const bad of ['', '   ', null, undefined, 42]) assert.equal(C.fillStory('{hero}', bad), '라라');
  assert.equal(C.fillStory(null, '라라'), '');
  assert.equal(C.fillStory('{hero:x}', '라라'), '라라');
  assert.ok(C.BEATS.filter(b => b.text.includes('{hero')).length >= 5);
  for (const b of C.BEATS) assert.ok(!/[{}]/.test(C.fillStory(b.text, '딩동')), b.id);
  const s = C.createState(); s.heroName = '민준';
  const ev = C.tick(s, 0.1, () => 0.5).find(e => e.type === 'story');
  assert.ok(!ev.text.includes('{hero'));
  const raw = JSON.parse(C.serialize(C.createState())); raw.heroName = '생존자';
  assert.equal(C.sanitizeState(raw).heroName, '라라');
});

test('성별: 설정 안 함이면 중립 호칭, 고르면 형·오빠, 누나·언니, 아들·딸로 바뀌고 조사도 맞는다', () => {
  const t = '{student:이} {driver:은} {driver}의 {child:을} {sib:은}';
  assert.equal(C.fillStory(t, '라라', 'none'), '고등학생이 기관사는 기관사의 내 아이를 라라는');
  assert.equal(C.fillStory(t, '라라', 'm'), '고등학생 형이 기관사 누나는 기관사 누나의 내 아들을 오빠는');
  assert.equal(C.fillStory(t, '라라', 'f'), '고등학생 오빠가 기관사 언니는 기관사 언니의 내 딸을 언니는');
  for (const bad of [undefined, null, 'x', 3]) assert.equal(C.fillStory('{driver}', '라라', bad), '기관사');
  assert.equal(C.fillStory('{nothing:이}', '민준', 'm'), '민준이');
  for (const g of C.GENDERS) for (const b of C.BEATS) assert.ok(!/[{}]/.test(C.fillStory(b.text, '라라', g)), b.id + ' ' + g);
  const s = C.createState();
  assert.equal(s.heroGender, 'none');
  assert.equal(C.setHeroGender(s, 'f').ok, true);
  assert.equal(C.setHeroGender(s, 'robot').ok, false);
  assert.equal(s.heroGender, 'f');
  assert.equal(C.deserialize(C.serialize(s), 0).heroGender, 'f');
  const raw = JSON.parse(C.serialize(s)); raw.heroGender = 'zzz';
  assert.equal(C.sanitizeState(raw).heroGender, 'none');
});

test('간식과 친구 키우기: 밤을 막으면 간식을 얻고, 간식을 주면 레벨이 올라 효과가 커진다', () => {
  const s = inMarket(); s.defenses.rail = 1e6; s.signalIn = 1e9; s.dayClock = C.DAY_SECONDS - 0.05;
  const ev = C.tick(s, 0.1, () => 0.5).find(e => e.type === 'defended');
  assert.ok(ev, '밤을 막았다');
  assert.equal(s.treats, ev.boss ? C.TREAT_BOSS : C.TREAT_NIGHT);
  assert.equal(C.feedPet(s).ok, false, '친구가 없으면 줄 수 없다');
  assert.equal(C.petFeedCost(s), Infinity);
  C.adoptPet(s, 'dog', () => 0);
  const base = C.petEffect(s).bonus;
  assert.equal(C.petFeedCost(s), 5);
  s.treats = 4; assert.equal(C.feedPet(s).reason, 'treats');
  s.treats = 5; assert.equal(C.feedPet(s).ok, true);
  assert.equal(s.treats, 0);
  assert.equal(C.petLevel(s, s.pet.breed), 1);
  near(C.petEffect(s).bonus, base * (1 + C.PET_LEVEL_STEP));
  assert.equal(C.petFeedCost(s), 8);
  assert.ok(C.petEffectText(s).includes('%'));
  s.treats = 1e9; for (let i = 0; i < 30; i++) C.feedPet(s);
  assert.equal(C.petLevel(s, s.pet.breed), C.PET_LEVEL_MAX);
  assert.equal(C.feedPet(s).reason, 'max');
  // 철수해도, 저장을 거쳐도 남는다. 잘못된 값은 버린다
  const breed = s.pet.breed, left = s.treats;
  s.runEarned = 1e30;
  const r = C.retreat(s);
  assert.equal(r.ok, true);
  assert.equal(r.state.treats, left); assert.equal(C.petLevel(r.state, breed), C.PET_LEVEL_MAX);
  const raw = JSON.parse(C.serialize(r.state)); raw.treats = -5; raw.petLv = { [breed]: 999, fake: 3 };
  const back = C.sanitizeState(raw);
  assert.equal(back.treats, 0); assert.deepEqual(back.petLv, { [breed]: C.PET_LEVEL_MAX });
});

test('소문(1구역 개조): 은닉처가 나올 확률이 오른다. 올리지 않으면 칸의 배치는 전과 같다', () => {
  const count = (extra) => { let n = 0; for (let seed = 1; seed <= 200; seed++) for (let i = 0; i < C.SWEEP_TILES; i++) if (C.tileKind(seed, i, extra).id === 'cache') n++; return n / (200 * C.SWEEP_TILES); };
  for (let seed = 1; seed <= 30; seed++) for (let i = 0; i < C.SWEEP_TILES; i++) assert.equal(C.tileKind(seed, i, 0).id, C.tileKind(seed, i).id);
  const base = count(0), more = count(24);
  assert.ok(Math.abs(base - 0.10) < 0.03, '기본 10%: ' + base);
  assert.ok(Math.abs(more - 0.34) < 0.04, '24%p 더하면 34%: ' + more);
  for (const bad of [-5, NaN, 'x', null]) assert.equal(C.tileKind(3, 4, bad).id, C.tileKind(3, 4).id);
  assert.ok(count(999) <= 0.5 + 0.04, '상한을 넘지 않는다');
  const s = C.createState();
  assert.equal(C.cacheExtra(s), 0);
  s.upgrades.rumor = 8;
  assert.equal(C.cacheExtra(s), 24);
});

test('구조 신호의 보상: 물자, 간식, 생산 배수 가운데 하나', () => {
  const kind = (r) => { const s = C.createState(); s.signalLeft = 5; const before = s.treats; const out = C.answerSignal(s, () => r); return [out.kind, s.treats - before]; };
  assert.deepEqual(kind(0.1), ['supplies', 0]);
  assert.deepEqual(kind(0.44), ['supplies', 0]);
  assert.deepEqual(kind(0.45), ['treats', C.SIGNAL_TREATS]);
  assert.deepEqual(kind(0.59), ['treats', C.SIGNAL_TREATS]);
  assert.deepEqual(kind(0.6), ['buff', 0]);
  assert.deepEqual(kind(0.99), ['buff', 0]);
});

/* ---------- 알파 0.9.0: 업적 ---------- */
test('업적: 구역마다 15개, 공통 30개. 이름과 조건이 있고 id 가 겹치지 않는다', () => {
  const by = {};
  for (const a of C.ACHIEVEMENTS) { by[a.group] = (by[a.group] || 0) + 1; assert.ok(a.name && a.text && a.need > 0 && a.tier >= 1 && a.tier <= 4, a.id); assert.ok(!/undefined|NaN/.test(a.text), a.text); }
  assert.deepEqual(by, { z1: 15, z2: 15, z3: 15, z4: 15, z5: 15, z6: 15, z7: 15, all: 30 });
  assert.equal(new Set(C.ACHIEVEMENTS.map(a => a.id)).size, 135);
  assert.equal(new Set(C.ACHIEVEMENTS.map(a => a.name)).size, 135);
  for (const g of Object.keys(by)) assert.ok(new Set(C.ACHIEVEMENTS.filter(a => a.group === g).map(a => a.tier)).size >= 3, g + ' 에 여러 난이도가 있다');
});

test('업적: 조건을 채우면 달성되어 알림이 오고, 하나마다 생산이 늘고, 철수해도 저장해도 남는다', () => {
  const s = C.createState();
  assert.equal(C.achCount(s), 0); assert.equal(C.achMult(s), 1);
  s.clicks = 150; s.defenses.rail = 1e6; s.signalIn = 1e9;
  const ev = [];
  for (let i = 0; i < 15; i++) C.tick(s, 0.1, () => 0.5).forEach(e => ev.push(e));
  const got = ev.filter(e => e.type === 'achievement');
  assert.ok(got.some(e => e.id === 'z1click-1'), '부지런한 손 Ⅰ');
  assert.equal(got.filter(e => e.id === 'z1click-1').length, 1, '한 번만 알린다');
  assert.ok(s.ach['z1click-1']); assert.ok(!s.ach['z1click-2']);
  near(C.achMult(s), 1 + C.ACH_BONUS * C.achCount(s));
  const a = C.ACHIEVEMENTS.find(x => x.id === 'z1click-2');
  { const pr = C.achProgress(s, a); assert.equal(pr.value, 150); assert.equal(pr.need, 1000); assert.equal(pr.done, false); assert.equal(pr.at, 0); }
  // 값을 읽다 오류가 나도 0 으로 본다
  assert.equal(C.achProgress(s, { id: 'x', need: 5, value: () => { throw new Error('x'); } }).value, 0);
  const n = C.achCount(s);
  s.runEarned = 1e30; s.stalls = 100;      // 철수하는 순간의 값도 쳐 준다(좌판 100곳)
  const r = C.retreat(s);
  assert.equal(r.ok, true);
  assert.ok(r.state.ach['z1click-1'] && r.state.ach['z2stall-2']);
  assert.ok(C.achCount(r.state) > n);
  const raw = JSON.parse(C.serialize(r.state)); raw.ach.fake = true;
  const back = C.sanitizeState(raw);
  assert.ok(back.ach['z1click-1']); assert.equal(back.ach.fake, undefined);
  raw.ach = 'x'; assert.equal(C.achCount(C.sanitizeState(raw)), 0);
});

/* ---------- 알파 0.9.1: 동물 친구 24종, 좀비 도감 15종 ---------- */
test('동물 친구는 강아지 24종, 고양이 24종이고 등급마다 여덟씩 있다(4.4.6)', () => {
  for (const kind of ['dog', 'cat']) {
    const list = C.PET_BREEDS.filter(b => b.kind === kind);
    assert.equal(list.length, 24, kind);
    for (const r of C.PET_RARITIES) assert.equal(list.filter(b => b.rarity === r.id).length, 8, kind + ' ' + r.id);
  }
  assert.equal(new Set(C.PET_BREEDS.map(b => b.id)).size, 48);
  assert.equal(new Set(C.PET_BREEDS.map(b => b.name)).size, 48);
});

test('좀비 도감: 15종. 밤이 지나면 만난 것이 적히고, 처음 만난 것은 사건에 실린다. 구역을 열어야 나오는 것이 있다', () => {
  assert.equal(C.ZOMBIE_KINDS.length, 15);
  assert.equal(new Set(C.ZOMBIE_KINDS.map(z => z.id)).size, 15);
  for (const z of C.ZOMBIE_KINDS) { assert.ok(C.ZOMBIE_RARITIES[z.rarity], z.id); assert.ok(z.text.length <= 22, z.id + ' 설명이 한 줄을 넘는다'); }
  assert.deepEqual(['common', 'uncommon', 'rare', 'epic'].map(r => C.ZOMBIE_KINDS.filter(z => z.rarity === r).length), [4, 5, 4, 2]);
  for (let d = 1; d < 50; d++) { const r = C.sightRoll(d, 3); assert.ok(r >= 0 && r < 1); assert.equal(r, C.sightRoll(d, 3)); }
  const s = C.createState();
  const first = C.sightZombies(s, 1, false);
  assert.ok(first.some(f => f.id === 'walker'), '배회자는 늘 온다');
  assert.equal(C.sightZombies(s, 1, false).some(f => f.id === 'walker'), false, '두 번째부터는 처음이 아니다');
  assert.equal(s.zdex.walker, 2);
  assert.ok(!s.zdex.boss); C.sightZombies(s, 2, true); assert.equal(s.zdex.boss, 1);
  for (let d = 3; d < 3000; d++) C.sightZombies(s, d, false);
  assert.ok(!s.zdex.vendor && !s.zdex.nurse, '구역을 열기 전에는 그 구역의 좀비가 나오지 않는다');
  assert.ok(s.zdex.glow > 0, '아주 희귀한 것도 오래 하면 만난다');
  assert.ok(s.zdex.glow < s.zdex.hair / 10);
  s.zone = 4; for (let d = 3000; d < 4000; d++) C.sightZombies(s, d, false);
  assert.ok(s.zdex.vendor > 0 && s.zdex.patient > 0 && s.zdex.nurse > 0);
  // 실제 밤: 사건에 found 가 실린다. 철수해도 저장해도 남는다
  const n = inMarket(); n.defenses.rail = 1e6; n.signalIn = 1e9; n.dayClock = C.DAY_SECONDS - 0.05;
  const ev = C.tick(n, 0.1, () => 0.5).find(e => e.type === 'defended');
  assert.ok(ev.found && ev.found.some(f => f.id === 'walker'));
  assert.ok(C.zdexCount(n) >= 1);
  n.runEarned = 1e30;
  assert.ok(C.retreat(n).state.zdex.walker >= 1);
  const raw = JSON.parse(C.serialize(n)); raw.zdex = { walker: -3, fake: 9, hair: 2 };
  assert.deepEqual(C.sanitizeState(raw).zdex, { hair: 2 });
});

/* ---------- 알파 0.9.3: 웹 앱 알림의 시각과 문구 ---------- */
test('알림 시각: 낮에는 그대로, 밤 10시 ~ 아침 8시에 걸리면 아침 8시로 미룬다', () => {
  const H = 3600000, base = Date.UTC(2026, 10, 17, 0, 0, 0), utcHour = (t) => new Date(t).getUTCHours();      // 시험에서는 UTC 를 현지 시각으로 본다
  assert.equal(C.noticeAt(base + 10 * H, 4 * H, utcHour), base + 14 * H);
  assert.equal(C.noticeAt(base + 17 * H + 59 * 60000, 4 * H, utcHour), base + 21 * H + 59 * 60000);
  assert.equal(C.noticeAt(base + 19 * H, 4 * H, utcHour), base + 32 * H, '23시 → 다음 날 8시');
  assert.equal(C.noticeAt(base + 1 * H + 1234, 4 * H, utcHour), base + 8 * H, '5시 → 같은 날 8시');
  assert.equal(C.noticeAt(base + 4 * H, 4 * H, utcHour), base + 8 * H, '정각 8시는 그대로');
  assert.ok(C.noticeAt(base, -5, utcHour) >= base);
});

test('알림 문구: 네 가지가 차례로 돌고, 이름과 조사가 맞고, 친구가 없으면 건너뛴다', () => {
  const s = C.createState();
  assert.equal(C.noticeBackText(s, 0), '여기는 7구역. 라라, 들리면 응답하라.');
  assert.equal(C.noticeBackText(s, 1), '무전기가 하루째 조용해요.');
  assert.equal(C.noticeBackText(s, 2), '무전기가 하루째 조용해요.', '친구가 없으면 두 번째 문구');
  assert.equal(C.noticeBackText(s, 3), '방벽 너머가 시끄러워요. 한번 봐 주세요.');
  assert.equal(C.noticeBackText(s, 4), C.noticeBackText(s, 0));
  s.kennel.tabby = '딩딩'; s.pet = { kind: 'cat', breed: 'tabby', name: '딩딩' }; s.heroName = '민준';
  assert.equal(C.noticeBackText(s, 2), '딩딩이 문 앞에서 기다리고 있어요.');
  assert.equal(C.noticeBackText(s, 0), '여기는 7구역. 민준, 들리면 응답하라.');
  for (const bad of [-3, NaN, 'x', null]) assert.ok(C.noticeBackText(s, bad).length > 5);
  const plan = C.noticePlan(s, Date.UTC(2026, 10, 17, 10), 0, (t) => new Date(t).getUTCHours());
  assert.deepEqual(plan.slice(0, 2).map(p => p.kind), ['full', 'back'], '앞의 둘은 차례가 그대로다(ui 가 [1] 을 읽는다)');
  assert.equal(plan[0].text, C.NOTICE_FULL_TEXT);
  assert.ok(plan[0].at < plan[1].at);
});

test('오늘 밤의 특별한 좀비: 도감에 적히는 것과 같고, 흔한 것과 변이체는 빠진다', () => {
  const s = fresh(); s.zone = 4;
  let seen = 0;
  for (let day = 1; day <= 400; day++) {
    const sp = C.nightSpecials(s, day);
    sp.forEach((z) => {
      const k = C.ZOMBIE_KINDS.find((x) => x.id === z.id);
      assert.ok(k && !k.boss && k.rarity !== 'common' && k.zone <= s.zone);
    });
    seen += sp.length;
    const before = Object.assign({}, s.zdex);
    C.sightZombies(s, day, false);
    sp.forEach((z) => assert.equal(s.zdex[z.id], (before[z.id] || 0) + 1));      // 화면에 보인 것은 반드시 도감에 적힌다
  }
  assert.ok(seen > 50);
  s.zone = 0;
  for (let day = 1; day <= 200; day++) C.nightSpecials(s, day).forEach((z) => assert.equal(C.ZOMBIE_KINDS.find((x) => x.id === z.id).zone, 0));
  assert.deepEqual(C.nightSpecials(null, 1), []);
  assert.deepEqual(C.nightSpecials(s, NaN), []);
});

test('다음 2배 문턱: 시설·열차 목록에서 다음 수를 찾고, 끝나면 null', () => {
  assert.equal(C.nextMilestone(0), 10);
  assert.equal(C.nextMilestone(10), 25);
  assert.equal(C.nextMilestone(399), 400);
  assert.equal(C.nextMilestone(400), null);
  assert.equal(C.nextMilestone(3, C.FLEET_MILESTONES), 4);
  assert.equal(C.nextMilestone(100, C.FLEET_MILESTONES), null);
  assert.equal(C.nextMilestone('엉뚱'), 10);
  assert.equal(C.nextMilestone(5, '엉뚱'), 10);
});

test('1구역 셋째 목표는 수색으로 채운다(기다리기만 하는 목표가 아니다)', () => {
  const s = fresh(), g = C.GOALS[0][2];
  assert.equal(g.id, 'z1c');
  s.wavesCleared = 100; assert.equal(g.value(s), 0);
  s.sweeps = g.need; assert.ok(g.value(s) >= g.need);
});

test('순찰조의 초당 물자: 없으면 0, 사면 생기고, 빨라질수록 커진다', () => {
  const s = fresh(); s.buildings.scouts = 30;
  assert.equal(C.sweepRate(s), 0);
  assert.equal(C.incomePerSec(s), C.productionPerSec(s));
  s.upgrades.patrol = 1;
  const r1 = C.sweepRate(s);
  assert.ok(r1 > 0);
  near(r1, C.sweepBonus(s) / (C.SWEEP_TILES * C.sweepInterval(s)));
  near(C.incomePerSec(s), C.productionPerSec(s) + r1);
  s.upgrades.patrol = 5;
  assert.ok(C.sweepRate(s) > r1, '한 칸에 걸리는 시간이 줄면 초당 물자가 오른다');
});

test('2배 등급: 넘은 문턱의 수', () => {
  assert.equal(C.milestoneTier(0), 0);
  assert.equal(C.milestoneTier(9), 0);
  assert.equal(C.milestoneTier(10), 1);
  assert.equal(C.milestoneTier(100), 4);
  assert.equal(C.milestoneTier(500), C.MILESTONES.length);
  assert.equal(C.milestoneTier(8, C.FLEET_MILESTONES), 2);
  assert.equal(C.milestoneTier('엉뚱'), 0);
});

test('누르기 판정: 조금 움직인 짧은 터치만 누르기다', () => {
  assert.ok(C.isTap(0, 0, 80));
  assert.ok(C.isTap(8, -8, 300));
  assert.ok(!C.isTap(30, 0, 100), '밀기');
  assert.ok(!C.isTap(0, 0, 2000), '길게 누르기');
  assert.ok(!C.isTap(NaN, 0, 100));
  assert.ok(!C.isTap(0, 0, -5));
});

test('업적에 달성한 시각이 남고, 날짜 없는 예전 기록은 초기화된다', () => {
  const s = fresh(); s.clicks = 1e6;
  C.checkAchievements(s, [], 1700000000000);
  const done = C.ACHIEVEMENTS.filter((a) => s.ach[a.id]);
  assert.ok(done.length > 0);
  assert.equal(s.ach[done[0].id], 1700000000000);
  assert.equal(C.achProgress(s, done[0]).at, 1700000000000);
  const raw = JSON.parse(JSON.stringify(s)); raw.ach[done[0].id] = true; raw.ach.fake = 5;
  const back = C.sanitizeState(raw, 0);
  assert.equal(back.ach[done[0].id], undefined, '날짜 없는 예전 기록은 지운다');
  C.checkAchievements(back, [], 1800000000000);
  assert.equal(back.ach[done[0].id], 1800000000000, '조건을 채우고 있으면 새 날짜로 다시 달성된다');
  assert.equal(back.ach.fake, undefined);
});

test('다음 항체 샘플까지: 그만큼 모으면 정말 하나가 더 나온다', () => {
  const s = fresh();
  assert.equal(C.nextAntibodyAt(s), C.RETREAT_MIN, '아직 못 받는 판에서는 철수 문턱이 곧 첫 샘플');
  [1e8, 3e8, 5e9, 7e12, 1e20].forEach((run) => {
    s.runEarned = run;
    const now = C.antibodiesOnRetreat(s), at = C.nextAntibodyAt(s);
    assert.ok(at > run, '지금보다 더 모아야 한다');
    s.runEarned = at;
    assert.ok(C.antibodiesOnRetreat(s) >= now + 1, '그만큼 모으면 하나 더');
    s.runEarned = at * 0.999;
    assert.ok(C.antibodiesOnRetreat(s) <= now + 1);
  });
});

test('방벽 개조: 건축가는 방어력을, 건설자는 방어 수단 값을 바꾼다', () => {
  const s = fresh(); s.supplies = 1e12; s.defenses.wire = 10;
  const p0 = C.defensePower(s), c0 = C.defenseCost(s, 'wire', 1);
  assert.ok(C.buyUpgrade(s, 'architect').ok);
  assert.ok(C.defensePower(s) > p0);
  assert.ok(C.buyUpgrade(s, 'builder').ok);
  assert.ok(C.defenseCost(s, 'wire', 1) < c0 && C.defenseCost(s, 'wire', 1) > c0 * 0.9);
});

test('수리공: 없으면 목표를 못 정하고, 있으면 "지금 가진 수에서 몇 개 더"를 하나씩 산다', () => {
  const s = fresh(); s.supplies = 1e12;
  assert.equal(C.cycleAutoDef(s, 'wire').ok, false);
  assert.equal(C.cycleAutoDef(s, '없는것').ok, false);
  C.tick(s, 30, Math.random);
  assert.equal(s.defenses.wire, 0, '수리공이 없으면 사지 않는다');
  assert.ok(C.buyUpgrade(s, 'repair').ok);
  s.defenses.wire = 100;                                   // 이미 100개가 있어도
  assert.equal(C.cycleAutoDef(s, 'wire').left, 10);        // 10개 "더" 산다
  assert.equal(C.autoDefLeft(s, 'wire'), 10);
  assert.equal(C.repairInterval(s), 5);
  for (let i = 0; i < 200; i++) C.tick(s, 1, Math.random);
  assert.equal(s.defenses.wire, 110, '목표에서 멈춘다');
  assert.equal(C.autoDefLeft(s, 'wire'), 0, '다 사면 꺼진 것으로 보인다');
  assert.equal(s.defenses.tower, 0, '끈 것은 사지 않는다');
  assert.equal(C.cycleAutoDef(s, 'tower').left, 10);
  assert.equal(C.cycleAutoDef(s, 'tower').left, 25, '또 누르면 다음 단계');
  s.supplies = 0;
  for (let i = 0; i < 20; i++) C.tick(s, 1, () => 0.99);
  assert.equal(s.defenses.tower, 0, '물자가 없으면 건너뛴다');
  let presses = 0;
  while (C.cycleAutoDef(s, 'tower').left > 0 && presses++ < 20) { /* 500개 더까지 올라간 뒤 */ }
  assert.equal(C.autoDefLeft(s, 'tower'), 0, '끝까지 누르면 끔');
  assert.ok(presses <= C.AUTO_DEF_STEPS.length);
  const back = C.sanitizeState(JSON.parse(JSON.stringify(Object.assign({}, s, { autoDef: { wire: 125, tower: -7, 가짜: 3 } }))), 0);
  assert.equal(back.autoDef.wire, 125); assert.equal(back.autoDef.tower, 0); assert.equal(back.autoDef['가짜'], undefined);
});

test('특전 다시 뽑기: 특성 레벨만큼만 쓸 수 있고, 철수하면 다시 찬다', () => {
  const s = fresh();
  assert.equal(C.rerollsLeft(s), 0);
  s.pendingPerks = ['harvest'];
  assert.equal(C.rerollPerks(s, Math.random).ok, false, '특성이 없으면 못 뽑는다');
  s.traits.reroll = 2;
  assert.equal(C.rerollsLeft(s), 2);
  const r = C.rerollPerks(s, Math.random);
  assert.ok(r.ok); assert.equal(r.left, 1); assert.ok(s.pendingPerks.length > 0);
  assert.ok(C.rerollPerks(s, Math.random).ok);
  assert.equal(C.rerollPerks(s, Math.random).ok, false, '다 쓰면 못 뽑는다');
  s.pendingPerks = [];
  assert.equal(C.rerollPerks(s, Math.random).reason, 'none');
  s.runEarned = 1e9;
  const back = C.retreat(s, 1);
  assert.ok(back.ok); assert.equal(C.rerollsLeft(back.state), 2);
  assert.equal(C.sanitizeState({ version: 2, rerollsUsed: -4 }, 0).rerollsUsed, 0);
});

test('농성: 못 막은 밤마다 무리가 흩어지고, 바닥이 있으며, 방어에 성공하면 원래대로 돌아온다', () => {
  const s = fresh(); s.wavesCleared = 40; s.supplies = 1000;
  const full = C.nightStrength(s);
  assert.equal(C.resolveNight(s).type, 'breached');
  assert.equal(C.nightStrength(s), full, '뚫린 첫 밤에는 아직 그대로');
  assert.equal(C.resolveNight(s).type, 'held');
  assert.ok(C.nightStrength(s) < full, '버틴 밤마다 줄어든다');
  for (let i = 0; i < 60; i++) C.resolveNight(s);
  assert.ok(C.nightStrength(s) >= Math.floor(full * C.SIEGE_FLOOR), '바닥 아래로는 줄지 않는다');
  assert.ok(C.nightStrength(s) <= Math.ceil(full * C.SIEGE_FLOOR) + 1);
  s.defenses.rail = 100000;
  assert.equal(C.resolveNight(s).type, 'defended');
  assert.equal(s.siegeNights, 0);
  assert.equal(C.sanitizeState({ version: 2, siegeNights: 'x' }, 0).siegeNights, 0);
});

test('단골 주문: 2구역에서만 오고, 상품으로 넘기면 물자·간식·도감·상품 값을 얻는다', () => {
  const s = fresh();
  const ev0 = []; for (let i = 0; i < 600; i++) C.tick(s, 1, Math.random).forEach((e) => ev0.push(e));
  assert.equal(s.order, null, '2구역을 열기 전에는 오지 않는다');
  const m = inMarket(); m.stalls = 20; m.supplies = 0; m.goods = 0; m.orderIn = 1;
  let got = null;
  for (let i = 0; i < 5 && !got; i++) got = C.tick(m, 1, () => 0.3).find((e) => e.type === 'order') || null;
  assert.ok(got && m.order, '주문이 온다');
  assert.ok(m.order.need >= 10);
  assert.equal(C.fillOrder(m).reason, 'short', '상품이 모자라면 못 넘긴다');
  assert.ok(m.order, '모자라도 주문은 남는다');
  m.goods = m.order.need + 5;
  const before = m.supplies, treats = m.treats, value = C.goodsValue(m), who = m.order.who;
  const r = C.fillOrder(m);
  assert.ok(r.ok && r.first && r.gain > 0);
  assert.ok(m.supplies > before); assert.equal(m.treats, treats + C.ORDER_TREATS);
  assert.equal(m.goods, 5); assert.equal(m.regulars[who], 1); assert.equal(C.regularCount(m), 1);
  near(C.goodsValue(m), value * (1 + C.ORDER_BONUS));
  assert.equal(m.order, null);
  assert.equal(C.fillOrder(m).reason, 'none');
  m.ordersRun = 1000; near(C.orderMult(m), 1 + C.ORDER_BONUS_MAX);
  // 기다리다 돌아가도 잃는 것은 없다
  m.order = { who: 'fish', need: 50, left: 1 }; const sup = m.supplies, gone = C.tick(m, 2, Math.random);
  assert.ok(gone.some((e) => e.type === 'order-gone')); assert.equal(m.order, null); assert.ok(m.supplies >= sup);
  // 철수하면 도감은 남고 이번 회차의 보너스는 사라진다
  m.runEarned = 1e9; const back = C.retreat(m, 1).state;
  assert.equal(back.regulars[who], 1); assert.equal(back.ordersRun, 0); assert.equal(back.order, null);
  // 깨진 저장
  const bad = C.sanitizeState({ version: 2, order: { who: '없는사람', need: 5, left: 5 }, regulars: { fish: -2, 가짜: 3 }, ordersRun: 'x' }, 0);
  assert.equal(bad.order, null); assert.equal(bad.regulars.fish, undefined); assert.equal(bad.regulars['가짜'], undefined); assert.equal(bad.ordersRun, 0);
});

test('단골 주문이 와 있으면 흥정꾼은 상품을 팔지 않고 모아 둔다(창고가 차면 판다)', () => {
  const m = inMarket(); m.stalls = 20; m.upgrades.broker = 5; m.autoSell = true; m.price = C.priceRange(m).ceil; m.goods = 0;
  m.order = { who: 'fish', need: 1e9, left: 80 }; m.orderIn = 999;
  for (let i = 0; i < 20; i++) C.tick(m, 1, () => 0.5);
  assert.ok(m.goods > 0, '주문이 있는 동안에는 쌓인다');
  const cap = C.goodsCap(m); m.goods = cap;
  const ev = C.tick(m, 1, () => 0.5);
  assert.ok(ev.some((e) => e.type === 'sold'), '창고가 차면 판다');
});

test('6구역 강변 검문소: 초소가 통행 물자를 벌고, 방어력이 넉넉할수록 더 번다', () => {
  const s = inLab(); s.zone = 5; s.supplies = 1e40;
  assert.equal(C.guardRate(s), 0, '초소가 없으면 0');
  assert.ok(C.buyPost(s, 10).ok); assert.equal(s.posts, 10);
  s.defenses.rail = 0; s.defenses.wire = 0;
  const low = C.guardRate(s);
  assert.ok(low > 0);
  s.defenses.rail = 1e12;                                    // 방어력이 무리보다 훨씬 크다
  const high = C.guardRate(s);
  assert.ok(high > low * 3, '다리가 안전하면 더 번다');
  near(C.bridgeSafety(s), C.SAFETY_MAX);                     // 상한에서 멈춘다
  s.upgrades.lamp = 2; near(C.bridgeSafety(s), C.SAFETY_MAX + 1);
  const before = s.guardEarned;
  assert.ok(C.productionPerSec(s) >= C.guardRate(s), '초당 물자에 들어간다');
  for (let i = 0; i < 20; i++) C.tick(s, 1, () => 0.5);      // 4.1.0: 통행 물자는 다리에서 들어온다(아무도 안 쏘면 초소에 닿은 것의 몫만)
  assert.ok(s.guardEarned > before);
  const nights = s.safeNights; s.dayClock = C.DAY_SECONDS - 0.5;
  C.tick(s, 1, () => 0.5);
  assert.equal(s.safeNights, nights + 1, '넉넉하게 막은 밤을 센다');
  const closed = inLab(); closed.supplies = 1e40;
  assert.equal(C.buyPost(closed, 1).reason, 'locked');
  const bad = C.sanitizeState({ version: 2, zone: 2, posts: 50, guardEarned: -3, safeNights: 'x' }, 0);
  assert.equal(bad.posts, 0); assert.equal(bad.guardEarned, 0); assert.equal(bad.safeNights, 0);
});

test('업적은 철수의 도움 없이는 다 깰 수 없다: 어려움은 철수 1번, 아주 어려움은 3번 뒤에 달성된다', () => {
  const hard = C.ACHIEVEMENTS.filter((a) => a.tier === 3), hardest = C.ACHIEVEMENTS.filter((a) => a.tier === 4);
  assert.ok(hard.length >= 30 && hardest.length >= 10);
  hard.forEach((a) => assert.equal(a.retreats, C.ACH_RETREATS_HARD, a.id));
  hardest.forEach((a) => assert.equal(a.retreats, C.ACH_RETREATS_HARDEST, a.id));
  C.ACHIEVEMENTS.filter((a) => a.tier <= 2).forEach((a) => assert.equal(a.retreats, 0, a.id));
  // 수색 1만 번(어려움 이상)을 채워도 철수 전에는 잠겨 있다
  const s = fresh(); s.clicks = 1e9;
  C.checkAchievements(s, [], 5);
  const clickAch = C.ACHIEVEMENTS.filter((a) => a.id.startsWith('z1click-'));
  clickAch.forEach((a) => { const p = C.achProgress(s, a); assert.equal(!!s.ach[a.id], a.retreats === 0, a.id); assert.equal(p.locked, a.retreats > 0); });
  assert.ok(C.ACHIEVEMENTS.some((a) => !s.ach[a.id] && C.achProgress(s, a).value >= a.need), '조건을 채우고도 잠긴 업적이 있다');
  s.retreats = 1; C.checkAchievements(s, [], 6);
  clickAch.forEach((a) => assert.equal(!!s.ach[a.id], a.retreats <= 1, a.id));
  s.retreats = 3; C.checkAchievements(s, [], 7);
  clickAch.forEach((a) => assert.ok(s.ach[a.id], a.id));
});

test('표류 화물: 4구역에서만 발견되고, 열차가 싣고 온 값이 차면 끌어와서 물자·간식·도감·화물 값을 얻는다', () => {
  const f = inFactory(); f.salvageIn = 0.5;
  for (let i = 0; i < 30; i++) C.tick(f, 1, () => 0.3);
  assert.equal(f.salvage, null, '4구역을 열기 전에는 없다');
  const s = inStation(); s.supplies = 1e40;
  assert.ok(C.buyTrain(s, 8).ok); assert.ok(C.buyRoute(s, 'grade').ok);
  assert.ok(C.railRate(s) > 0);
  s.salvageIn = 0.5;
  let got = null;
  for (let i = 0; i < 5 && !got; i++) got = C.tick(s, 1, () => 0.3).find((e) => e.type === 'salvage') || null;
  assert.ok(got && s.salvage, '화물이 발견된다');
  assert.equal(C.fillSalvage(s).reason, 'short');
  const who = s.salvage.who;
  for (let i = 0; i < 149 && s.salvage && s.salvage.have < s.salvage.need; i++) { C.tick(s, 1, () => 0.3); if (C.trainInfo(s).full) C.sendTrain(s); }      // 3.7.0: 열차는 손으로(또는 역무원이) 보내야 화물이 들어온다
  assert.ok(s.salvage && s.salvage.have >= s.salvage.need, '시간 안에 찬다');
  s.supplies = 0;
  const treats = s.treats, value = C.cargoValue(s), r = C.fillSalvage(s);
  assert.ok(r.ok && r.first && r.gain > 0 && s.supplies > 0);
  assert.equal(s.treats, treats + C.SALVAGE_TREATS); assert.equal(s.cargos[who], 1); assert.equal(C.cargoCount(s), 1); assert.equal(s.salvage, null);
  near(C.cargoValue(s), value * (1 + C.SALVAGE_BONUS));
  s.salvagesRun = 1000; near(C.salvageMult(s), 1 + C.SALVAGE_BONUS_MAX);
  s.salvage = { who: 'fuel', need: 1e60, have: 0, left: 1 };
  assert.ok(C.tick(s, 2, Math.random).some((e) => e.type === 'salvage-gone')); assert.equal(s.salvage, null);
  s.runEarned = 1e9; const back = C.retreat(s, 1).state;
  assert.equal(back.cargos[who], 1); assert.equal(back.salvagesRun, 0); assert.equal(back.salvage, null);
  const bad = C.sanitizeState({ version: 2, salvage: { who: '없는칸', need: 5, left: 5 }, cargos: { fuel: -2, 가짜: 3 }, salvagesRun: 'x' }, 0);
  assert.equal(bad.salvage, null); assert.equal(bad.cargos.fuel, undefined); assert.equal(bad.salvagesRun, 0);
});

test('병원 서류: 과제를 끝낼 때 가끔 한 장을 찾고, 간식·도감·연구 속도를 얻는다', () => {
  const s = inLab(); s.staff = 10; s.points = 1e12; s.offers = ['soil', 'serum', 'drop'];
  const rate = C.researchRate(s), treats = s.treats, lab0 = C.labRate(s);
  // 주사위가 낮으면(0.1 < 0.35) 찾는다
  const r = C.runProject(s, 'soil', () => 0.1);
  assert.ok(r.ok && r.record && r.record.first);
  assert.equal(s.records[r.record.id], 1); assert.equal(C.recordCount(s), 1); assert.equal(s.recordsRun, 1);
  assert.equal(s.treats, treats + C.RECORD_TREATS);
  near(C.labRate(s) / lab0, 1 + C.RECORD_BONUS, '서류 한 장마다 혈청 값 +1%(4.0.5)');
  // 주사위가 높으면 못 찾는다
  s.offers = ['soil', 'serum', 'drop'];
  const r2 = C.runProject(s, 'soil', () => 0.9);
  assert.ok(r2.ok); assert.equal(r2.record, null); assert.equal(s.recordsRun, 1);
  s.recordsRun = 1000; near(C.recordMult(s), 1 + C.RECORD_BONUS_MAX);
  s.runEarned = 1e9; const back = C.retreat(s, 1).state;
  assert.equal(back.records[r.record.id], 1); assert.equal(back.recordsRun, 0);
  const bad = C.sanitizeState({ version: 2, records: { desk: -1, 가짜: 2 }, recordsRun: 'x' }, 0);
  assert.equal(bad.records.desk, undefined); assert.equal(bad.records['가짜'], undefined); assert.equal(bad.recordsRun, 0);
});

test('7구역 송신탑: 안테나가 생존자를 모으고, 모인 만큼 전체 생산이 늘고, 혈청을 끝내면 이야기가 끝난다', () => {
  const s = inLab(); s.zone = 6; s.supplies = 1e60;
  assert.equal(C.towerMult(s), 1, '생존자가 없으면 그대로');
  assert.equal(C.survivorRate(s), 0);
  assert.ok(C.buyAntenna(s, 30).ok); assert.equal(s.antennas, 30);
  assert.ok(C.survivorRate(s) > 30, '2배 문턱이 붙는다');
  C.tick(s, 10, () => 0.5);
  assert.ok(s.survivors > 0);
  s.survivors = 1e5; near(C.towerMult(s), 1 + 0.5 * Math.log10(1 + 1e5));
  const closed = inLab(); closed.supplies = 1e60;
  assert.equal(C.buyAntenna(closed, 1).reason, 'locked'); assert.equal(C.buySerum(closed).reason, 'locked'); assert.equal(C.towerMult(closed), 1);
  // 혈청 세 단계
  // 3.1.0: 혈청은 정착지의 가운데 줄 건물이 있어야 만든다
  assert.equal(C.buySerum(s).reason, 'settle'); C.SETTLE.forEach(d => { s.settle[d.id] = true; });
  s.nightLvBest = 30; C.SETTLE.forEach(d => { s.settleLv[d.id] = 3; }); s.finalHeld = true;      // 4.7.5 문턱을 다 채운 채로
  const costs = []; for (let i = 0; i < 3; i++) { costs.push(C.serumCost(s)); assert.ok(C.buySerum(s).ok); }
  assert.ok(costs[0] < costs[1] && costs[1] < costs[2]);
  assert.equal(s.serumStage, 3); assert.equal(C.buySerum(s).reason, 'done'); assert.equal(C.serumCost(s), Infinity);
  // 목표 셋을 채우면 끝난다(특전 고르기가 끼어들 수 있으므로 골라 가며 돌린다)
  let ending = null;
  for (let i = 0; i < 12 && !ending; i++) { const ev = C.tick(s, 1, () => 0.5); ending = ev.find((e) => e.type === 'ending') || null; if (s.pendingPerks.length) C.choosePerk(s, s.pendingPerks[0]); }
  assert.ok(ending, '끝이 온다'); assert.equal(s.ended, 1); assert.ok(s.endedAt > 0);
  for (let i = 0; i < 5; i++) assert.ok(!C.tick(s, 1, () => 0.5).some((e) => e.type === 'ending'), '한 회차에 한 번만');
  s.runEarned = 1e30; const back = C.retreat(s, 1).state;
  assert.equal(back.ended, 1); assert.equal(back.endedRun, false); assert.equal(back.antennas, 0); assert.equal(back.survivors, 0); assert.equal(back.serumStage, 0);
  const bad = C.sanitizeState({ version: 2, zone: 2, antennas: 50, survivors: 1e9, serumStage: 3, ended: 'x' }, 0);
  assert.equal(bad.antennas, 0); assert.equal(bad.survivors, 0); assert.equal(bad.serumStage, 0); assert.equal(bad.ended, 0);
});

test('일지의 신호는 처음부터 끝까지 같다: 길게, 짧게, 길게', () => {
  const texts = C.BEATS.map((b) => b.text).join('\n');
  assert.ok(!/길게 한 번, 짧게 두 번/.test(texts), '6장에서 신호가 달라져 있었다');
  ['z4-2', 'z5-2', 'z6-1', 'z7-0', 'z7-2'].forEach((id) => assert.ok(C.BEATS.find((b) => b.id === id).text.includes('길게, 짧게, 길게'), id));
});

test('6구역 통행인: 넉넉하게 막은 밤에만 건너고, 건넌 만큼 통행 물자가 늘고, 도감은 철수해도 남는다', () => {
  const s = inLab(); s.zone = 5; s.posts = 5;
  assert.equal(C.passBridge(s, () => 0.9), null, '확률을 넘으면 아무도 안 온다');
  const p = C.passBridge(s, () => 0);
  assert.ok(p && p.first && p.id === C.PASSERS[0].id);
  assert.equal(s.passers[p.id], 1); assert.equal(C.passerCount(s), 1); assert.equal(s.passersRun, 1);
  assert.equal(C.passBridge(s, () => 0).first, false);
  const before = C.guardRate(s); s.passersRun = 10; near(C.guardRate(s) / before, 1.10 / 1.02);
  s.passersRun = 1000; near(C.passerMult(s), 1 + C.PASSER_BONUS_MAX);
  const none = inLab(); none.zone = 5; assert.equal(C.passBridge(none, () => 0), null, '초소가 없으면 오지 않는다');
  const closed = inLab(); closed.posts = 5; assert.equal(C.passBridge(closed, () => 0), null);
  // 밤 판정과 이어진다: 방어력이 무리의 2배를 넘으면 건넌다. rng 를 안 줘도 돌아간다
  const n = inLab(); n.zone = 5; n.posts = 1; n.defenses.rail = 1e6;
  assert.ok(C.defensePower(n) >= C.nightStrength(n) * C.SAFE_NIGHT);
  assert.ok(C.resolveNight(n, () => 0).passer);
  assert.equal(C.resolveNight(n).type, 'defended');
  s.runEarned = 1e30; const back = C.retreat(s, 1).state;
  assert.equal(back.passers[p.id], 2); assert.equal(back.passersRun, 0);
  const bad = C.sanitizeState({ version: 2, passers: { porter: -1, 가짜: 2 }, passersRun: 'x' }, 0);
  assert.equal(bad.passers.porter, undefined); assert.equal(bad.passers['가짜'], undefined); assert.equal(bad.passersRun, 0);
  assert.equal(C.PASSERS.length, 12); assert.equal(new Set(C.PASSERS.map((x) => x.id)).size, 12);
});

test('보강 계획: 방어력이 한참 모자라도 빨리 셈하고, 하나씩 사서 더한 값과 같다', () => {
  const s = inLab(); s.zone = 5; s.day = 400; s.supplies = 1e9;
  const t0 = Date.now(); const plan = C.defensePlan(s); const ms = Date.now() - t0;
  assert.ok(ms < 60, '계획 한 번에 ' + ms + 'ms');
  // 같은 순서로 하나씩 사 보면 값이 같다
  const b = JSON.parse(JSON.stringify(s)); let cost = 0;
  plan.picks.forEach((p) => { /* 묶음 값은 올림 때문에 다를 수 있어 총 개수만 맞춘다 */ b.defenses[p.id] += p.qty; });
  assert.equal(C.defensePower(b) >= C.nightStrength(s), plan.enough);
  const before = s.supplies; assert.ok(C.fortify(s).ok); near(before - s.supplies, plan.cost);
  assert.ok(C.defensePower(s) >= C.nightStrength(s) || !plan.enough);
});

test('받침 판별: 한글은 글자로, 숫자로 끝나면 읽는 소리로 따진다', () => {
  assert.equal(C.hasBatchim('물자'), false); assert.equal(C.hasBatchim('샘플'), true);
  assert.equal(C.hasBatchim('1.2조'), false); assert.equal(C.hasBatchim('50.0만'), true); assert.equal(C.hasBatchim('3.5해'), false);
  ['10', '1', '3', '6', '7', '8'].forEach((n) => assert.equal(C.hasBatchim(n), true, n));
  ['2', '4', '5', '9', '1,252'].forEach((n) => assert.equal(C.hasBatchim(n), false, n));
  assert.equal(C.hasBatchim(''), false);
});

test('일지와 화면 글의 맞춤법: 고쳐 달라고 했던 표기가 다시 들어오지 않는다', () => {
  const fs = require('fs'), path = require('path');
  const all = ['core.js', 'ui.js', 'help.js', 'template.html'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')).join('\n');
  ['회차이 ', '회차을', '회차은 ', '누굴 주느냐고'].forEach((w) => assert.ok(!all.includes(w), w));
  const story = C.BEATS.map((b) => b.text).join('\n');
  assert.ok(!story.includes('그다음'), '"그 다음"으로 띄어 쓴다');
});

test('쌓인 효과 글: 더하는 것은 레벨만큼, 깎는 것은 곱으로 쌓아 적는다', () => {
  assert.equal(C.effectNow({ desc: '상품 값 +25%' }, 3), '상품 값 +75%');
  assert.equal(C.effectNow({ desc: '시세의 바닥 +0.1' }, 3), '시세의 바닥 +0.3');
  assert.equal(C.effectNow({ desc: '은닉처가 나올 확률 +3%p' }, 4), '은닉처가 나올 확률 +12%p');
  assert.equal(C.effectNow({ desc: '모든 구매 비용 -4%' }, 2), '모든 구매 비용 -7.8%');      // 1 - 0.96² = 7.84%
  assert.equal(C.effectNow({ desc: '정속 가동으로 치는 가동률 -3%p' }, 2), '정속 가동으로 치는 가동률 -6%p');
  assert.equal(C.effectNow({ desc: '청신호가 알아서 켜진다' }, 1), '');
  assert.equal(C.effectNow({ desc: '상품 값 +25%' }, 0), ''); assert.equal(C.effectNow(null, 3), ''); assert.equal(C.effectNow({}, 3), '');
  // 실제 mods 와 맞는다: 절약 2레벨이면 값이 0.96² 배
  const s = C.createState(0); s.traits.thrift = 2; near(C.mods(s).cost, 0.9216);
});

test('6구역 초소는 방어력도 올린다: 초소마다 더하고, 문턱마다 2배. 보강 계획도 같은 배수로 셈한다', () => {
  const s = inLab(); s.defenses.rail = 10;
  const base = C.defensePower(s);
  s.posts = 28; assert.equal(C.postDefense(s), 1, '6구역을 열기 전에는 그대로'); assert.equal(C.defensePower(s), base);
  s.zone = 5; near(C.postDefense(s), 1 + C.POST_DEFENSE * 28 * 4);      // 10곳, 25곳 문턱 → 4배
  assert.ok(Math.abs(C.defensePower(s) / base - C.postDefense(s)) < 0.01);
  s.posts = 0; assert.equal(C.postDefense(s), 1);
  // 보강 계획: 초소 배수를 넣고 셈해야 실제로 산 뒤의 방어력이 모자라지 않는다
  s.posts = 12; s.day = 200; s.supplies = 1e12;
  const plan = C.defensePlan(s);
  if (plan.picks.length && plan.enough && plan.cost <= s.supplies) { assert.ok(C.fortify(s).ok); assert.ok(C.defensePower(s) >= C.nightStrength(s)); }
});

test('구역 값의 차례: 문 값은 구역이 뒤로 갈수록 커지고, 그 구역에서 처음 살 것은 문 값보다 싸다', () => {
  for (let i = 2; i < C.ZONES.length; i++) assert.ok(C.ZONES[i].cost > C.ZONES[i - 1].cost * 100, C.ZONES[i].name);
  assert.ok(C.TRAIN_COST < C.ZONES[3].cost && C.STAFF_COST < C.ZONES[4].cost);
  const s = inLab(); s.zone = 6;
  assert.ok(C.postCost(s, 1) < C.ZONES[5].cost * 1.01 && C.antennaCost(s, 1) < C.ZONES[6].cost * 1.01);
  assert.ok(C.SERUM_COSTS[0] >= C.ZONES[6].cost, '혈청은 7구역 문을 연 뒤의 일이다');
  C.UPGRADES.filter((u) => u.zone >= 2).forEach((u) => assert.ok(u.baseCost <= C.ZONES[u.zone].cost * 100, u.id + ' 값이 그 구역의 문 값에 견주어 너무 비싸다'));
});

test('구역 사이 콘텐츠를 자주 나오게 하는 개조: 간격은 곱으로 줄고 절반에서 멈추며, 확률은 %p 로 더해진다', () => {
  const s = inLab(); s.zone = 5; s.supplies = 1e60; s.posts = 5;
  assert.equal(C.mods(s).ordergap, 1); assert.equal(C.mods(s).recordchance, 0);
  ['flyer', 'catalog', 'buoy'].forEach((id) => { const u = C.UPGRADES.find((x) => x.id === id); for (let i = 0; i < u.max; i++) assert.ok(C.buyUpgrade(s, id).ok, id); });
  near(C.mods(s).ordergap, Math.pow(0.92, 6)); near(C.mods(s).contractgap, Math.pow(0.92, 6)); near(C.mods(s).salvagegap, Math.pow(0.92, 6));
  s.upgrades.flyer = 99; assert.equal(C.mods(s).ordergap, 0.5, '절반 아래로는 줄지 않는다'); s.upgrades.flyer = 6;
  // 다음 주문까지의 시간이 실제로 줄어든다
  const a = inLab(); a.zone = 1; a.stalls = 5; a.orderIn = 0; C.stepOrders(a, 1, () => 0.5, []);
  const b = inLab(); b.zone = 1; b.stalls = 5; b.orderIn = 0; b.upgrades.flyer = 6; C.stepOrders(b, 1, () => 0.5, []);
  assert.ok(a.order && b.order); near(b.orderIn / a.orderIn, Math.pow(0.92, 6));
  // 확률: 서류 35% → 60%, 통행인 50% → 80%
  for (let i = 0; i < 5; i++) { assert.ok(C.buyUpgrade(s, 'archive').ok); assert.ok(C.buyUpgrade(s, 'signpost').ok); }
  near(C.mods(s).recordchance, 0.25); near(C.mods(s).passerchance, 0.30);
  assert.ok(C.findRecord(s, () => 0.59), '59% 눈금이면 찾는다'); assert.equal(C.findRecord(s, () => 0.61), null);
  assert.ok(C.passBridge(s, () => 0.79)); assert.equal(C.passBridge(s, () => 0.81), null);
  const plain = inLab(); plain.zone = 5; plain.posts = 5;
  assert.equal(C.findRecord(plain, () => 0.36), null); assert.equal(C.passBridge(plain, () => 0.51), null);
  assert.equal(C.effectNow(C.UPGRADES.find((u) => u.id === 'archive'), 3), '서류를 찾을 확률 +15%p');
});

test('주문·의뢰·화물 자동 넘기기: 그 구역의 자동 개조가 있을 때만 알아서 넘긴다', () => {
  const mk = (auto) => { const s = inLab(); s.zone = 1; s.stalls = 5; s.goods = 1e6; s.autoSell = true; s.order = { who: C.REGULARS[0].id, need: 10, left: 60 }; if (auto) s.upgrades.broker = 1; return s; };
  const a = mk(true), ev = []; C.stepOrders(a, 1, () => 0.5, ev);
  assert.equal(a.order, null); assert.equal(ev[0].type, 'order-filled'); assert.ok(ev[0].gain > 0); assert.equal(a.ordersRun, 1); assert.equal(a.regulars[C.REGULARS[0].id], 1);
  const b = mk(false), ev2 = []; C.stepOrders(b, 1, () => 0.5, ev2);
  assert.ok(b.order, '흥정꾼이 없으면 기다린다'); assert.equal(ev2.length, 0);
  const c = mk(true); c.autoSell = false; C.stepOrders(c, 1, () => 0.5, []); assert.ok(c.order, '자동 판매를 꺼 두면 주문도 넘기지 않는다');
  const d = mk(true); d.goods = 5; C.stepOrders(d, 1, () => 0.5, []); assert.ok(d.order, '상품이 모자라면 기다린다');
});

test('6구역 목표는 무리와의 경주에 묶이지 않는다: 초소, 개조, 통행 물자', () => {
  const g = C.GOALS[5].find((x) => x.id === 'z6b'), s = inLab(); s.zone = 5; s.supplies = 1e60;
  assert.equal(g.value(s), 0);
  s.handKills = g.need; assert.ok(g.value(s) >= g.need, '4.1.0: 손으로 잡은 수');
  C.GOALS[5].forEach((x) => assert.ok(!/방어력/.test(x.text), x.text));
});

test('시세: 평균 아래가 세 번 이어지면 다음은 평균 위다. 그래도 범위는 벗어나지 않는다', () => {
  const s = inLab(); s.zone = 1; s.stalls = 5;
  const r = C.priceRange(s); let low = 0, maxLow = 0, above = 0, n = 0, seed = 7;
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 4000; i++) {
    const before = s.priceHistory.length ? s.priceHistory[s.priceHistory.length - 1] : null; const p0 = s.price;
    C.tick(s, 1, rng); if (s.pendingPerks.length) C.choosePerk(s, s.pendingPerks[0]);
    if (s.price === p0 && before === (s.priceHistory.length ? s.priceHistory[s.priceHistory.length - 1] : null)) continue;
    n++; assert.ok(s.price >= r.floor - 1e-9 && s.price <= C.priceRange(s).ceil + 1e-9);
    if (s.price < C.priceRange(s).mean) { low++; maxLow = Math.max(maxLow, low); } else { low = 0; above++; }
  }
  assert.ok(n > 100, '시세가 여러 번 바뀌었다(' + n + ')');
  assert.ok(maxLow <= C.LOW_RUN_MAX, '평균 아래가 가장 길게 ' + maxLow + '번');
  assert.ok(above / n > 0.5, '평균 위 비율 ' + (above / n).toFixed(2));
  assert.equal(C.sanitizeState({ version: 2, lowRun: 99 }, 0).lowRun, C.LOW_RUN_MAX);
});

test('흥정꾼의 고점 판매: 켜면 고점 아래에서는 팔지 않고 모으다가, 고점이거나 창고가 차면 판다', () => {
  const mk = () => { const s = inLab(); s.zone = 1; s.stalls = 5; s.upgrades.broker = 1; s.autoSell = true; s.goods = 100; s.sellClock = 999; s.priceClock = 0; return s; };
  const r = C.priceRange(mk()), peak = C.peakPrice(mk());
  const a = mk(); a.price = r.mean + 0.01; C.setSellPeak(a, true); let ev = []; C.stepOrders && 0; ev = C.tick(a, 0.1, () => 0.5);
  assert.ok(!ev.some((e) => e.type === 'sold'), '평균은 넘었지만 고점이 아니면 기다린다'); assert.ok(a.goods >= 100);
  const b = mk(); b.price = r.mean + 0.01; assert.ok(C.tick(b, 0.1, () => 0.5).some((e) => e.type === 'sold'), '꺼 두면 평균 이상에서 판다');
  const c = mk(); c.price = peak; C.setSellPeak(c, true); assert.ok(C.tick(c, 0.1, () => 0.5).some((e) => e.type === 'sold'), '고점이면 판다');
  const d = mk(); d.price = r.floor; C.setSellPeak(d, true); d.goods = C.goodsCap(d); assert.ok(C.tick(d, 0.1, () => 0.5).some((e) => e.type === 'sold'), '창고가 차면 판다');
  assert.equal(C.sanitizeState({ version: 2, sellPeak: 'yes' }, 0).sellPeak, false); assert.equal(C.createState(0).sellPeak, false);
});

test('회차마다 달라지는 목표: 첫 회차는 원래 목표, 철수하면 자리별로 다시 뽑고 앞 회차와 셋이 모두 같지는 않다', () => {
  const s = fresh();
  assert.deepEqual(C.goals(s, 0).map((g) => g.id), ['z1a', 'z1b', 'z1c'], '첫 회차는 원래 목표');
  // 뽑기: 자리마다 0 또는 1, 앞 회차와 같은 구역은 없다. 후보가 없는 자리(6구역 셋째)와 7구역은 바뀌지 않는다
  let seed = 3; const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let prev = {};
  for (let i = 0; i < 200; i++) {
    const now = C.rollGoalPick(prev, rng);
    for (let zi = 0; zi <= 5; zi++) {
      assert.equal(now[zi].length, 3); now[zi].forEach((v) => assert.ok(v === 0 || v === 1));
      assert.notEqual(now[zi].join(), (prev[zi] || [0, 0, 0]).join(), '앞 회차와 같다(구역 ' + (zi + 1) + ')');
    }
    assert.equal(now[5][2], 0); assert.equal(now[6], undefined);
    prev = now;
  }
  // 뽑힌 목표가 화면과 달성 판정에 쓰인다. 한 회차 안에서 겹치지 않는다
  s.goalPick = { 0: [1, 0, 1] };
  assert.deepEqual(C.goals(s, 0).map((g) => g.id), ['z1a2', 'z1b', 'z1c2']);
  for (let zi = 0; zi < 7; zi++) for (let m = 0; m < 8; m++) {
    const t = fresh(); t.goalPick = { [zi]: [m & 1, (m >> 1) & 1, (m >> 2) & 1] };
    const ids = C.goals(t, zi).map((g) => g.id); assert.equal(new Set(ids).size, 3); assert.equal(new Set(C.goals(t, zi).map((g) => g.text)).size, 3);
  }
  s.goalsDone.z1a = s.goalsDone.z1c = true; assert.equal(C.goalsComplete(s, 0), false, '원래 목표를 채운 것으로는 안 된다');
  s.buildings.garden = 40; s.supplies = 1e9; s.buildings.scouts = 200; s.upgrades.maps = 12;
  for (let i = 0; i < 8; i++) { C.tick(s, 1, () => 0.5); if (s.pendingPerks.length) C.choosePerk(s, s.pendingPerks[0]); }
  assert.ok(s.goalsDone.z1a2 && s.goalsDone.z1b && s.goalsDone.z1c2); assert.ok(C.goalsComplete(s, 0));
  // 철수하면 새로 뽑히고, 저장을 거쳐도 남는다. 이상한 값은 버린다
  s.runEarned = 1e30; s.pendingPerks = [];
  const next = C.retreat(s, 1, rng).state;
  assert.notEqual(next.goalPick[0].join(), '1,0,1'); assert.deepEqual(next.goalsDone, {});
  const round = C.sanitizeState(JSON.parse(JSON.stringify(next)), 0); assert.deepEqual(round.goalPick, next.goalPick);
  const bad = C.sanitizeState({ version: 2, goalPick: { 0: [5, 'x', null], 5: [1, 1, 1], 6: [1, 1, 1], 9: [1] } }, 0);
  assert.deepEqual(bad.goalPick[0], [1, 1, 0]); assert.deepEqual(bad.goalPick[5], [1, 1, 0]); assert.equal(bad.goalPick[6], undefined); assert.equal(bad.goalPick[9], undefined);
  // 다른 후보는 모두 돈과 시간으로 채울 수 있는 것이다(무리와 겨루는 것은 없다)
  C.GOALS_ALT.forEach((list) => list.forEach((g) => { if (g) assert.ok(!/방어력|막기|방어 성공/.test(g.text), g.text); }));
});

test('4·6·7구역 사건: 그 구역이 벌고 있을 때만 뜨고, 바로 받거나 이번 회차 배수를 쌓는다. 놓쳐도 잃는 것은 없다', () => {
  const s = inLab(); s.zone = 6; s.trains = 5; s.routes = { loop: 1 }; s.posts = 12; s.antennas = 12; s.supplies = 0;
  s.zevIn = { rail: 0.5, guard: 0.5, tower: 0.5 }; s.jamIn = 1e6; s.truckIn = 1e6;
  assert.ok(C.railRate(s) > 0 && C.guardRate(s) > 0 && C.survivorRate(s) > 0);
  const ev = C.tick(s, 1, () => 0.5).filter((e) => e.type === 'zev');
  assert.deepEqual(ev.map((e) => e.id).sort(), ['guard', 'rail', 'tower']); assert.ok(s.zev.rail && s.zev.guard && s.zev.tower);
  // 바로 받는다
  const want = C.zevReward(s, 'rail', false); near(want, C.railRate(s) * C.ZEV_NOW);
  const sup = s.supplies, earned = s.railEarned, r = C.answerZoneEvent(s, 'rail', 'now', false);
  assert.ok(r.ok); near(s.supplies - sup, want); near(s.railEarned - earned, want); assert.equal(s.zev.rail, null); assert.equal(s.zevRun, 1);
  assert.equal(C.answerZoneEvent(s, 'rail', 'now', false).reason, 'none');
  // 배수를 쌓는다: 통행 물자가 그만큼 는다. 상한이 있다
  const g0 = C.guardRate(s), b = C.answerZoneEvent(s, 'guard', 'boost', false);
  assert.ok(b.ok); near(s.guardBoost, C.ZEV_BOOST); near(C.guardRate(s) / g0, 1 + C.ZEV_BOOST);
  s.guardBoost = C.ZEV_BOOST_MAX; s.zev.guard = { left: 10 }; assert.equal(C.answerZoneEvent(s, 'guard', 'boost', false).reason, 'max'); assert.ok(s.zev.guard, '못 쌓으면 사건은 남는다');
  s.railBoost = 0.09; const c0 = C.cargoValue(s); s.railBoost = 0; near(c0 / C.cargoValue(s), 1.09);
  // 7구역 무전: 사람이 온다(적어도 50명). 고를 것은 하나뿐이다
  const p0 = s.survivors, t = C.answerZoneEvent(s, 'tower', 'now', false);
  assert.ok(t.ok && t.people >= C.ZEV_MIN_PEOPLE); assert.equal(s.survivors - p0, t.people);
  s.zev.tower = { left: 5 }; assert.equal(C.answerZoneEvent(s, 'tower', 'boost', false).reason, 'unknown');
  // 놓치면 그냥 사라진다
  s.zev.tower = { left: 1 }; const sv = s.survivors, rate = C.survivorRate(s);
  assert.ok(C.tick(s, 2, () => 0.99).some((e) => e.type === 'zev-gone' && e.id === 'tower')); assert.equal(s.zev.tower, null);
  // 자동 신호는 특별 화물을 알아서 받되 절반만
  const a = inLab(); a.trains = 5; a.routes = { loop: 1 }; a.upgrades.autosig = 1; a.zev.rail = { left: C.ZEV_WAIT }; a.zevIn.rail = 1e6; a.jamIn = 1e6; a.truckIn = 1e6;
  let got = null; for (let i = 0; i < 6 && !got; i++) got = C.tick(a, 1, () => 0.99).find((e) => e.type === 'zev-auto') || null;
  assert.ok(got && got.auto && got.gain > 0);
  // 벌지 않는 구역에는 뜨지 않는다. 열지 않은 구역의 값은 저장에서 버린다
  const e = inLab(); e.zevIn.rail = 0; assert.ok(!C.tick(e, 1, () => 0.5).some((x) => x.type === 'zev'));
  const bad = C.sanitizeState({ version: 2, zone: 1, zev: { rail: { left: 9 }, guard: 'x' }, railBoost: 9, guardBoost: 9, zevRun: -1 }, 0);
  assert.equal(bad.zev.rail, null); assert.equal(bad.zev.guard, null); assert.equal(bad.railBoost, 0); assert.equal(bad.guardBoost, 0); assert.equal(bad.zevRun, 0);
  // 철수하면 배수는 사라지고, 자리를 비우면 떠 있던 사건은 정리된다
  s.runEarned = 1e40; s.pendingPerks = []; const back = C.retreat(s, 1).state; assert.equal(back.guardBoost, 0); assert.equal(back.railBoost, 0);
  const o = inLab(); o.zev.rail = { left: 20 }; C.applyOffline(o, 600); assert.equal(o.zev.rail, null);
});

test('6구역 순찰과 7구역 직접 방송: 누르면 잠깐 그 구역이 배로 돌고, 쉬는 시간이 있다', () => {
  const s = inLab(); s.zone = 6; s.posts = 12; s.antennas = 12; s.zevIn = { rail: 1e6, guard: 1e6, tower: 1e6 }; s.jamIn = 1e6; s.truckIn = 1e6;
  const g = C.guardRate(s), v = C.survivorRate(s);
  /* 4.1.0: 6구역의 순찰은 없앴다(다리에서 손으로 쏜다). 7구역 직접 방송은 3.1.0 에 주파수 맞추기로 바뀌었다 */
  assert.equal(C.pushZone(s, 'guard').reason, 'gone'); assert.equal(C.pushZone(s, 'tower').reason, 'gone');
  let p0 = s.survivors; C.tick(s, 1, () => 0.99); near(s.survivors - p0, v);
  p0 = s.survivors; C.tick(s, 30, () => 0.99); near(s.survivors - p0, v * 30); assert.ok(g > 0);
  assert.equal(s.push.tower.left, 0); assert.equal(s.push.guard.left, 0);
  const closed = inLab(); assert.equal(C.pushZone(closed, 'nope').reason, 'unknown');
  const empty = inLab(); empty.zone = 6; assert.equal(C.pushZone(empty, 'tower').reason, 'gone');
  const bad = C.sanitizeState({ version: 2, zone: 2, push: { guard: { left: 9, cool: 999 }, tower: 'x' } }, 0);
  assert.deepEqual(bad.push, { guard: { left: 0, cool: 0 }, tower: { left: 0, cool: 0 } });
});

test('5·6·7구역의 자동 개조: 단추는 알아서 누르고, 사건은 알아서 받되 절반만 받는다', () => {
  const s = inLab(); s.zone = 6; s.staff = 10; s.posts = 12; s.antennas = 12; s.supplies = 1e60; s.jamIn = 1e6; s.truckIn = 1e6; s.zevIn = { rail: 1e6, guard: 1e6, tower: 1e6 };
  assert.equal(C.autoOn(s, 4), false); assert.equal(C.autoOn(s, 5), false); assert.equal(C.autoOn(s, 6), false);
  C.tick(s, 1, () => 0.99); assert.equal(s.push.guard.left, 0, '개조가 없으면 알아서 누르지 않는다');
  ['autolab', 'autoguard', 'autotower'].forEach((id) => assert.ok(C.buyUpgrade(s, id).ok, id));
  assert.ok(C.autoOn(s, 4) && C.autoOn(s, 5) && C.autoOn(s, 6));
  const ev = C.tick(s, 1, () => 0.99).filter((e) => e.type === 'auto-push').map((e) => e.id).sort();
  assert.deepEqual(ev, [], '4.1.0: 순찰은 없다'); assert.ok(s.tune.cool > 0, '송신 기사는 주파수를 알아서 맞춘다(3.1.0)');
  // 사건: 3초 뒤에 알아서 받고, 절반만 받는다
  s.zev.guard = { left: C.ZEV_WAIT }; s.zev.tower = { left: C.ZEV_WAIT };
  const full = C.zevReward(s, 'guard', false), auto5 = C.zevReward(s, 'guard', true), auto6 = C.zevReward(s, 'tower', true);
  near(auto5, full, '지나온 6구역은 자동이 온전히 받는다'); assert.ok(auto6 <= C.zevReward(s, 'tower', false), '지금 있는 7구역은 절반');
  let got = []; for (let i = 0; i < 5; i++) got = got.concat(C.tick(s, 1, () => 0.99).filter((e) => e.type === 'zev-auto'));
  assert.deepEqual(got.map((e) => e.id).sort(), ['guard', 'tower']); assert.ok(got.every((e) => e.auto));
  assert.ok(got.find((e) => e.id === 'tower').people >= C.ZEV_MIN_PEOPLE);
  // 자동은 그 구역의 개조 화면에 있고, 한 번만 산다
  ['autolab', 'autoguard', 'autotower'].forEach((id, k) => { const u = C.UPGRADES.find((x) => x.id === id); assert.equal(u.zone, 4 + k); assert.equal(u.max, 1); });
});

test('개조의 숙련 상한: 철수와 특성이 적으면 상한 위로는 값이 크게 뛰고, 경험이 쌓이면 풀린다', () => {
  const s = fresh(); s.supplies = 1e80;
  const def = C.UPGRADES.find((u) => u.id === 'crowbar');      // 최대 12
  assert.equal(C.experience(s), 0); assert.equal(C.upgradeSoftCap(s, 'crowbar'), 6);
  for (let i = 0; i < 6; i++) { near(C.upgradeCost(s, 'crowbar'), Math.ceil(def.baseCost * Math.pow(def.growth, i))); assert.ok(C.buyUpgrade(s, 'crowbar').ok); }
  near(C.upgradeCost(s, 'crowbar'), Math.ceil(def.baseCost * Math.pow(def.growth, 6) * C.CAP_OVER), '상한을 넘긴 첫 레벨');
  assert.ok(C.buyUpgrade(s, 'crowbar').ok, '막지는 않는다');
  near(C.upgradeCost(s, 'crowbar'), Math.ceil(def.baseCost * Math.pow(def.growth, 7) * C.CAP_OVER * C.CAP_OVER));
  // 철수와 특성이 경험이 된다
  s.retreats = 4; assert.equal(C.upgradeSoftCap(s, 'crowbar'), Math.ceil(12 * 0.7));
  s.traits.immune = 10; assert.equal(C.experience(s), 6); assert.equal(C.upgradeSoftCap(s, 'crowbar'), Math.ceil(12 * 0.8));
  s.retreats = 10; assert.equal(C.upgradeSoftCap(s, 'crowbar'), 12);
  near(C.upgradeCost(s, 'crowbar'), Math.ceil(def.baseCost * Math.pow(def.growth, 7)), '경험이 차면 원래 값');
  // 한 번만 사는 개조는 그대로다
  assert.equal(C.upgradeSoftCap(fresh(), 'autosig'), 1); assert.equal(C.upgradeSoftCap(fresh(), 'nope'), 0);
  C.UPGRADES.forEach((u) => { const cap = C.upgradeSoftCap(fresh(), u.id); assert.ok(cap >= 1 && cap <= u.max, u.id); });
});

test('지나온 구역의 자동은 온전히 받고, 지금 있는 구역의 자동은 절반만 받는다', () => {
  const here = inFactory(); here.machines = { sorter: 10, press: 15, assembler: 30 }; here.stockSec = 60;
  near(C.truckReward(here, true), C.truckReward(here, false) * C.AUTO_SHARE); assert.equal(C.autoShare(here, 2), C.AUTO_SHARE);
  const past = inStation(); past.machines = { sorter: 10, press: 15, assembler: 30 }; past.stockSec = 60;
  near(C.truckReward(past, true), C.truckReward(past, false)); assert.equal(C.autoShare(past, 2), 1);
});

test('연속 방어: 연달아 막을수록 전리품이 커지고, 못 막으면 처음으로 돌아간다', () => {
  const s = fresh(); s.defenses.wire = 60;
  assert.equal(C.defStreakMult(s), 1);
  const r0 = C.nightReward(s);
  assert.equal(C.resolveNight(s).type, 'defended'); assert.equal(s.defStreak, 1); near(C.defStreakMult(s), 1 + C.DEF_STREAK_STEP);
  s.defStreak = 10; near(C.defStreakMult(s), 2); s.defStreak = 100; assert.equal(C.defStreakMult(s), C.DEF_STREAK_MAX);
  s.defStreak = 10; const base = C.nightReward(s); s.defStreak = 0; near(base / C.nightReward(s), 2, '10연속 뒤에는 2배');
  // 못 막으면 끊긴다(뚫린 밤과 버틴 밤 모두)
  const b = fresh(); b.defStreak = 7; b.day = 400; assert.equal(C.resolveNight(b).type, 'breached'); assert.equal(b.defStreak, 0);
  b.defStreak = 3; assert.equal(C.resolveNight(b).type, 'held'); assert.equal(b.defStreak, 0);
  assert.equal(C.sanitizeState({ version: 2, defStreak: -3 }, 0).defStreak, 0);
  s.runEarned = 1e30; s.pendingPerks = []; assert.equal(C.retreat(s, 1).state.defStreak, 0);
});

test('변이체를 막으면 특전 하나를 고른다. 고를 것이 이미 떠 있으면 미뤄 두었다가 건다', () => {
  const s = fresh(); s.defenses.wire = 5000; s.wavesCleared = C.BOSS_EVERY - 1;
  assert.ok(C.isBossWave(C.currentWave(s)));
  const ev = C.resolveNight(s); assert.equal(ev.type, 'defended'); assert.ok(ev.boss); assert.equal(s.perkOwed, 1);
  let got = C.tick(s, 0.1, () => 0.5);
  assert.ok(got.some((e) => e.type === 'boss-perk')); assert.equal(s.pendingPerks.length, 3); assert.equal(s.perkFrom, 'boss'); assert.equal(s.perkOwed, 0);
  // 이미 고를 것이 떠 있으면 미룬다
  s.perkOwed = 1; got = C.tick(s, 0.1, () => 0.5); assert.ok(!got.some((e) => e.type === 'boss-perk')); assert.equal(s.perkOwed, 1);
  C.choosePerk(s, s.pendingPerks[0]); got = C.tick(s, 0.1, () => 0.5); assert.ok(got.some((e) => e.type === 'boss-perk')); assert.equal(s.perkOwed, 0);
  // 보통 밤에는 없다. 철수하면 밀린 것도 사라진다
  const n = fresh(); n.defenses.wire = 60; C.resolveNight(n); assert.equal(n.perkOwed, 0);
  s.perkOwed = 3; s.pendingPerks = []; s.runEarned = 1e30; assert.equal(C.retreat(s, 1).state.perkOwed, 0);
  // 한 회차에 변이체로 얻는 특전은 정해진 수까지다
  const m = fresh(); m.defenses.wire = 1e7; let picks = 0;
  for (let i = 0; i < C.BOSS_EVERY * 8; i++) { C.resolveNight(m); C.tick(m, 0.1, () => 0.5).forEach((e) => { if (e.type === 'boss-perk') picks++; }); if (m.pendingPerks.length) C.choosePerk(m, m.pendingPerks[0]); }
  assert.equal(m.bossPerks, C.BOSS_PERKS_MAX); assert.equal(picks, C.BOSS_PERKS_MAX);
  m.runEarned = 1e30; m.pendingPerks = []; assert.equal(C.retreat(m, 1).state.bossPerks, 0);
  assert.equal(C.BOSS_REWARD, 2);
});

test('규칙 파일에 같은 이름이 두 번 선언되지 않는다(나중 것이 앞의 것을 말없이 덮어쓴다)', () => {
  // 1.5.2 를 만들다가 STREAK_MAX 와 streakMult 를 한 번 더 선언해서 2구역 연속 호가가 조용히 바뀐 적이 있다
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core.js'), 'utf8');
  const seen = {}, dup = [];
  const note = (name) => { if (seen[name]) dup.push(name); seen[name] = true; };
  src.split('\n').forEach((line) => {
    let m = /^  function ([A-Za-z_$][\w$]*)\s*\(/.exec(line); if (m) note(m[1]);
    m = /^  var (.+);/.exec(line);
    if (m) m[1].replace(/\[[^\]]*\]|\{[^}]*\}|\([^)]*\)|'[^']*'/g, '').split(',').forEach((part) => { const n = /^\s*([A-Z][A-Z0-9_]*)\s*=/.exec(part); if (n) note(n[1]); });
  });
  assert.deepEqual(dup, []);
});

test('자리를 비운 동안 변이체를 여러 번 막아도 특전은 하나만 쳐 준다', () => {
  const s = fresh(); s.defenses.wire = 1e6; s.wavesCleared = 5;
  const r = C.applyOffline(s, 4 * 3600);
  assert.ok(r.nights >= 30, '밤이 많이 지나갔다(' + r.nights + ')'); assert.equal(s.perkOwed, 1);
  s.perkOwed = 2; C.applyOffline(s, 3600); assert.ok(s.perkOwed <= 2, '밀린 특전은 둘까지');
});

test('선제 공격: 넉넉하게 막을수록 여유 게이지가 차고, 가득 차면 다음 밤 한 번의 무리를 절반으로 줄인다', () => {
  const s = fresh(); s.defenses.wire = 5000;
  assert.equal(s.edge, 0); assert.equal(C.strikeReady(s), false); assert.equal(C.strike(s).reason, 'not-ready');
  C.resolveNight(s); near(s.edge, C.EDGE_GAIN, '무리의 2배를 넘게 막으면 한 번에 가장 많이 찬다');
  // 겨우 막으면 거의 안 찬다
  const t = fresh(); t.defenses.wire = 1; while (C.defensePower(t) < C.nightStrength(t)) t.defenses.wire++;
  const ratio = C.defensePower(t) / C.nightStrength(t); C.resolveNight(t); near(t.edge, Math.min(1, ratio - 1) * C.EDGE_GAIN);
  C.resolveNight(s); C.resolveNight(s); assert.equal(s.edge, 1); assert.ok(C.strikeReady(s));
  const before = C.nightStrength(s), r = C.strike(s);
  assert.ok(r.ok); assert.equal(s.edge, 0); assert.ok(C.easeOn(s)); assert.equal(C.nightStrength(s), Math.ceil(before * C.NIGHT_EASE));
  assert.equal(C.strike(s).reason, 'set', '한 밤에 한 번만');
  const w = C.currentWave(s); C.resolveNight(s);
  assert.equal(C.easeOn(s), false, '밤이 지나면 원래대로'); assert.equal(C.nightStrength(s), Math.ceil(C.strengthAt(s, w + 1)));
  const bad = C.sanitizeState({ version: 2, edge: 9, nightEase: 0.01, counterAt: -2 }, 0);
  assert.equal(bad.edge, 1); assert.equal(bad.nightEase, 1); assert.equal(bad.counterAt, 0);
  s.runEarned = 1e30; s.pendingPerks = []; const back = C.retreat(s, 1).state; assert.equal(back.edge, 0); assert.equal(back.nightEase, 1);
});

test('반격: 못 막고 버틴 밤이 세 번 쌓이면 쓸 수 있고, 쓰고 나면 다시 그만큼 버텨야 한다', () => {
  const s = fresh(); s.wavesCleared = 200;      // 절반으로 줄여도 도저히 못 막는 밤
  assert.equal(C.resolveNight(s).type, 'breached'); assert.equal(C.counterReady(s), false);
  for (let i = 0; i < C.COUNTER_NIGHTS; i++) assert.equal(C.resolveNight(s).type, 'held');
  assert.ok(C.counterReady(s));
  const before = C.nightStrength(s), r = C.counterAttack(s);
  assert.ok(r.ok); assert.equal(C.nightStrength(s), Math.ceil(before * C.NIGHT_EASE)); assert.equal(C.counterReady(s), false);
  C.resolveNight(s); assert.equal(C.easeOn(s), false); assert.equal(C.counterReady(s), false, '쓴 직후에는 다시 못 쓴다');
  for (let i = 0; i < C.COUNTER_NIGHTS - 1; i++) C.resolveNight(s);
  assert.ok(C.counterReady(s), '다시 세 번 버티면 쓸 수 있다');
  // 막아내면 처음부터
  const d = fresh(); d.siege = true; d.siegeNights = 5; d.counterAt = 3; d.defenses.wire = 5000; C.resolveNight(d); assert.equal(d.counterAt, 0); assert.equal(C.counterReady(d), false);
  // 선제 공격을 걸어 둔 밤에는 반격을 겹쳐 쓸 수 없다
  const b = fresh(); b.siege = true; b.siegeNights = 5; b.nightEase = C.NIGHT_EASE; assert.equal(C.counterAttack(b).reason, 'set');
});

test('구역마다 주문·사건 자동을 끌 수 있다: 꺼 두면 자동 개조가 있어도 손으로 해야 한다', () => {
  const mk = () => { const s = inLab(); s.zone = 6; s.staff = 10; s.posts = 12; s.antennas = 12; ['autoline', 'autosig', 'autolab', 'autoguard', 'autotower', 'broker'].forEach((id) => { s.upgrades[id] = 1; }); s.jamIn = 1e6; s.truckIn = 1e6; s.zevIn = { rail: 1e6, guard: 1e6, tower: 1e6 }; s.contractIn = 1e6; s.orderIn = 1e6; return s; };
  const on = mk(); assert.ok(C.autoEvents(on, 5));
  on.zev.guard = { left: C.ZEV_WAIT }; let got = []; for (let i = 0; i < 5; i++) got = got.concat(C.tick(on, 1, () => 0.99));
  assert.ok(got.some((e) => e.type === 'zev-auto' && e.id === 'guard')); assert.ok(got.some((e) => e.type === 'bridge-shot'), '초소장이 쏜다');
  const off = mk(); assert.ok(C.setAutoEvents(off, 5, false).ok); assert.equal(C.autoEvents(off, 5), false); assert.ok(C.autoOn(off, 5), '개조는 그대로 있다');
  off.zev.guard = { left: C.ZEV_WAIT }; got = []; for (let i = 0; i < 5; i++) got = got.concat(C.tick(off, 1, () => 0.99));
  assert.ok(!got.some((e) => e.type === 'zev-auto' && e.id === 'guard')); assert.ok(!got.some((e) => e.type === 'bridge-shot'), '꺼 두면 초소장도 쏘지 않는다'); assert.ok(off.zev.guard, '사건은 손을 기다린다');
  assert.ok(got.some((e) => e.type === 'tune' && e.auto), '다른 구역의 자동은 그대로 돈다');
  // 다시 켜고, 저장과 철수를 거쳐도 설정이 남는다
  assert.ok(C.setAutoEvents(off, 5, true).ok); assert.ok(C.autoEvents(off, 5));
  C.setAutoEvents(off, 3, false); const round = C.sanitizeState(JSON.parse(JSON.stringify(off)), 0); assert.deepEqual(round.autoOff, { 3: true });
  off.runEarned = 1e40; off.pendingPerks = []; assert.deepEqual(C.retreat(off, 1).state.autoOff, { 3: true });
  assert.equal(C.setAutoEvents(off, 0, false).reason, 'unknown'); assert.equal(C.setAutoEvents(off, 9, false).reason, 'unknown');
  assert.deepEqual(C.sanitizeState({ version: 2, autoOff: { 2: 'yes', 4: true, 99: true } }, 0).autoOff, { 4: true });
});

test('연장 목표: 채운 목표 자리에 더 큰 목표가 이어서 뜨고, 채우면 간식과 물자를 받는다. 문과 일지는 그대로다', () => {
  const s = fresh();
  assert.deepEqual(C.extGoals(s, 0), [null, null, null], '원래 목표를 채우기 전에는 없다');
  s.buildings.scouts = 50; s.supplies = 0;
  for (let i = 0; i < 3; i++) { C.tick(s, 0.1, () => 0.5); if (s.pendingPerks.length) C.choosePerk(s, s.pendingPerks[0]); }
  assert.ok(s.goalsDone.z1a);
  let x = C.extGoals(s, 0)[0];
  assert.equal(x.tier, 1); assert.equal(x.need, 75); assert.equal(x.text, '잔해 수색조 75곳'); assert.equal(x.value, 50);
  // 채우면 다음 단계로 넘어가고 보상을 받는다. 특전은 없다
  s.buildings.scouts = 75; const treats = s.treats, sup = s.supplies;
  const ev = C.tick(s, 0.1, () => 0.5).filter((e) => e.type === 'goal-ext');
  assert.equal(ev.length, 1); assert.equal(ev[0].tier, 1); assert.equal(s.treats - treats, C.EXT_TREATS); assert.ok(s.supplies > sup); assert.equal(s.pendingPerks.length, 0);
  x = C.extGoals(s, 0)[0]; assert.equal(x.tier, 2); assert.equal(x.need, 100);
  // 크기: 수는 절반씩 더하고, 물자 누적은 10배씩. 글의 마지막 수를 바꿔 적는다
  assert.equal(C.extNeed({ need: 50 }, 2), 100); assert.equal(C.extNeed({ need: 3 }, 1), 5); assert.equal(C.extNeed({ need: 1e11 }, 2), 1e13);
  assert.equal(C.extNeed({ need: 120, unit: 'time' }, 1), 180);
  assert.equal(C.extText({ text: '1구역 시설 합계 200곳', need: 200 }, 300), '1구역 시설 합계 300곳');
  assert.equal(C.extText({ text: '상품 판매 누적 1,000억', need: 1e11 }, 1e12), '상품 판매 누적 ' + C.formatNumber(1e12));
  assert.equal(C.extText({ text: '정속 가동 누적 2분', need: 120, unit: 'time' }, 180), '정속 가동 누적 3분');
  assert.equal(C.extText({ text: '1구역 개조를 모두 합쳐 12번', need: 12 }, 18), '1구역 개조를 모두 합쳐 18번');
  // 끝까지 채우면 그 자리는 더 없다. 7구역은 처음부터 없다
  s.goalExt.z1a = C.EXT_MAX; assert.equal(C.extGoals(s, 0)[0], null);
  const last = inLab(); last.zone = 6; C.GOALS[6].forEach((g) => { last.goalsDone[g.id] = true; }); assert.deepEqual(C.extGoals(last, 6), [null, null, null]);
  // 문은 원래 목표로만 열린다. 저장과 철수
  assert.equal(C.goalsComplete(s, 0), false);
  const round = C.sanitizeState(JSON.parse(JSON.stringify(s)), 0); assert.deepEqual(round.goalExt, s.goalExt);
  assert.deepEqual(C.sanitizeState({ version: 2, goalsDone: { z1a: true }, goalExt: { z1a: 99, z1b: 3, nope: 2 } }, 0).goalExt, { z1a: C.EXT_MAX });
  s.runEarned = 1e30; s.pendingPerks = []; assert.deepEqual(C.retreat(s, 1).state.goalExt, {});
  // 모든 목표의 글이 수를 바꿔 적을 수 있는 모양이다(괄호로 덧붙이는 일이 없다)
  C.GOALS.slice(0, 6).concat(C.GOALS_ALT.slice(0, 6)).forEach((list) => list.forEach((g) => { if (g) { const t = C.extText(g, C.extNeed(g, 1)); assert.ok(!/\($/.test(t) && !t.endsWith(')'), g.text + ' → ' + t); assert.notEqual(t, g.text, g.text); } }));
});

test('선제 공격·반격을 쓸 수 있게 된 순간을 알리고, 급한 밤에는 다음 할 일로 안내한다', () => {
  const s = fresh(); s.defenses.wire = 5000; s.clicks = 20; s.buildings.scouts = 5;
  const evs = [C.resolveNight(s), C.resolveNight(s), C.resolveNight(s)];
  assert.deepEqual(evs.map((e) => !!e.edgeFull), [false, false, true], '가득 찬 그 밤에만 알린다');
  assert.ok(!C.resolveNight(s).edgeFull);
  assert.notEqual(C.guide(s).id, 'strike', '넉넉히 막을 수 있는 보통 밤에는 권하지 않는다');
  s.wavesCleared = C.BOSS_EVERY - 1; assert.equal(C.guide(s).id, 'strike', '변이체가 오는 밤에는 권한다');
  const b = fresh(); b.clicks = 20; b.buildings.scouts = 5; b.wavesCleared = 200; C.resolveNight(b);
  const held = []; for (let i = 0; i < C.COUNTER_NIGHTS + 1; i++) held.push(C.resolveNight(b));
  assert.deepEqual(held.map((e) => !!e.counterReady), [false, false, true, false]);
  assert.equal(C.guide(b).id, 'counter');
});

test('1.5.9: 구역 문 값은 뒤로 갈수록 커지고, 혈청 값은 7구역 문 값보다 크다', () => {
  for (let i = 1; i < C.ZONES.length; i++) assert.ok(C.ZONES[i].cost > C.ZONES[i - 1].cost);
  assert.ok(C.SERUM_COSTS[0] > C.ZONES[6].cost);
  for (let i = 1; i < C.SERUM_COSTS.length; i++) assert.ok(C.SERUM_COSTS[i] > C.SERUM_COSTS[i - 1]);
});

test('1.6.2 길 정찰: 구역마다 정해진 시간이 지나야 다음 문이 열리고, 뒤 구역일수록 조금씩 길다', () => {
  for (let i = 1; i < C.SCOUT_MINUTES.length; i++) assert.ok(C.SCOUT_MINUTES[i] > C.SCOUT_MINUTES[i - 1] && C.SCOUT_MINUTES[i] <= C.SCOUT_MINUTES[i - 1] * 1.5);
  assert.equal(C.SCOUT_MINUTES.length, C.ZONES.length);
  const s = C.createState(0);
  C.goals(s, 0).forEach(g => { s.goalsDone[g.id] = true; }); s.runEarned = C.ZONES[1].cost;
  assert.equal(C.scoutLeft(s), C.scoutNeed(0));
  assert.equal(C.openZone(s).reason, 'scout', '목표와 물자를 다 채워도 정찰이 끝나야 한다');
  s.runSeconds = C.scoutNeed(0) - 1; assert.equal(C.nextZone(s).wait, 1);
  s.runSeconds = C.scoutNeed(0); assert.equal(C.scoutLeft(s), 0); assert.ok(C.openZone(s).ok);
  assert.equal(C.zoneEntered(s), C.scoutNeed(0)); assert.equal(C.scoutLeft(s), C.scoutNeed(1), '새 구역에 들어서면 다시 센다');
  // 특성을 다 채워도 시간은 줄지 않는다
  C.TRAITS.forEach(t => { s.traits[t.id] = t.max; }); assert.equal(C.scoutLeft(s), C.scoutNeed(1));
  // 자리를 비운 시간도 센다
  const before = C.scoutLeft(s); C.applyOffline(s, 600); assert.ok(C.scoutLeft(s) < before);
  // 기록이 없는 옛 저장은 회차 처음부터 있었던 것으로 본다
  const old = C.createState(0); old.zone = 3; old.zoneLog = []; old.runSeconds = 5000; assert.equal(C.scoutLeft(old), 0);
});

test('1.6.2 길 정찰: 7구역의 끝도 정찰 시간이 지나야 온다', () => {
  const s = C.createState(0); s.zone = 6; s.zoneLog = [{ zone: 6, seconds: 100, day: 1 }]; s.runSeconds = 100;
  C.goals(s, 6).forEach(g => { s.goalsDone[g.id] = true; });
  assert.ok(!C.tick(s, 0.1, () => 0.5).some(e => e.type === 'ending'));
  s.runSeconds = 100 + C.scoutNeed(6);
  assert.ok(C.tick(s, 0.1, () => 0.5).some(e => e.type === 'ending'));
});

test('1.6.5 도전(규칙만, 화면은 아직 없음): 고르기, 조건, 성공과 실패, 훈장', () => {
  assert.equal(C.CHALLENGES.length, 8);
  const s = C.createState(0);
  assert.equal(C.setNextChallenge(s, 'frugal').reason, 'locked', '목표 구역에 닿아 본 적이 없으면 고를 수 없다');
  assert.equal(C.setNextChallenge(s, 'nope').reason, 'unknown');
  s.bestZone = 5;
  assert.ok(C.setNextChallenge(s, 'frugal').ok); assert.equal(C.setNextChallenge(s, 'oneshot').reason, 'locked', '끝까지 가는 도전은 엔딩을 본 뒤');
  // 철수하면 골라 둔 도전으로 시작한다
  s.runEarned = 1e30;
  const r = C.retreat(s, 0, () => 0.5); assert.ok(r.ok);
  const n = r.state; assert.equal(n.challenge.id, 'frugal'); assert.equal(n.nextChallenge, '');
  // 맨몸: 개조를 살 수 없다
  n.supplies = 1e12; assert.equal(C.buyUpgrade(n, C.UPGRADES[0].id).reason, 'challenge');
  // 성공: 3구역에 닿으면 훈장과 간식, 그 뒤로는 조건이 풀린다
  n.zone = C.CHALLENGES.find(d => d.id === 'frugal').goal; const ev = []; const treats = n.treats; C.checkChallenge(n, ev);
  assert.equal(ev[0].type, 'challenge-done'); assert.equal(ev[0].first, true); assert.ok(n.treats > treats);
  assert.equal(C.medalCount(n), 1); assert.equal(C.medalMult(n), 1 + C.MEDAL_BONUS); assert.equal(C.activeChallenge(n), null);
  assert.notEqual(C.buyUpgrade(n, C.UPGRADES[0].id).reason, 'challenge');
  // 훈장은 철수해도, 저장을 거쳐도 남는다
  const back = C.deserialize(C.serialize(n), 0); assert.equal(C.medalCount(back), 1);
  // 외벽: 방벽은 한 종류만
  const w = C.createState(0); w.challenge = { id: 'onewall', failed: false, done: false }; w.supplies = 1e9;
  assert.ok(C.buyDefense(w, 'wire', 1).ok); assert.ok(C.buyDefense(w, 'wire', 1).ok); assert.equal(C.buyDefense(w, 'tower', 1).reason, 'challenge');
  // 거센 무리: 무리 3배. 반쪽 보급: 생산 절반
  const h = C.createState(0), base = C.nightStrength(h); h.challenge = { id: 'horde', failed: false, done: false };
  assert.ok(Math.abs(C.nightStrength(h) - base * C.HORDE_MULT) <= 1);
  const l = C.createState(0), g = C.globalMult(l); l.challenge = { id: 'lean', failed: false, done: false }; assert.equal(C.globalMult(l), g * 0.25);
  // 질주: 시간을 넘기면 실패
  const q = C.createState(0); q.challenge = { id: 'sprint', failed: false, done: false }; q.runSeconds = C.SPRINT_SECONDS + 1;
  const ev2 = []; C.checkChallenge(q, ev2); assert.equal(ev2[0].type, 'challenge-failed'); assert.equal(C.activeChallenge(q), null);
});

test('1.7.0 도전 켜고 끄기: 1구역에서만, 한 회차에 한 번, 이미 어긴 조건은 못 켠다. 포기하면 연속 성공이 끊긴다', () => {
  const mk = () => { const s = C.createState(0); s.bestZone = 6; s.ended = 1; return s; };
  let s = mk();
  assert.equal(C.challengeBlock(s, 'frugal'), ''); assert.ok(C.startChallenge(s, 'frugal').ok);
  assert.equal(C.startChallenge(s, 'hands').reason, 'used');
  const q = C.quitChallenge(s); assert.ok(q.ok); assert.equal(C.activeChallenge(s), null);
  assert.equal(C.startChallenge(s, 'hands').reason, 'used', '포기한 회차에는 다시 켤 수 없다');
  assert.equal(C.quitChallenge(s).reason, 'none');
  s = mk(); s.zone = 1; assert.equal(C.startChallenge(s, 'lean').reason, 'late');
  s = mk(); s.upgrades[C.UPGRADES[0].id] = 1; assert.equal(C.startChallenge(s, 'frugal').reason, 'broken'); assert.ok(C.startChallenge(s, 'lean').ok);
  s = mk(); s.defenses.wire = 1; s.defenses.tower = 1; assert.equal(C.startChallenge(s, 'onewall').reason, 'broken');
  s = mk(); s.breaches = 1; assert.equal(C.startChallenge(s, 'unbroken').reason, 'broken');
  s = mk(); s.bestZone = 0; s.ended = 0; assert.equal(C.startChallenge(s, 'frugal').reason, 'locked');
  // 연속 성공: 성공할 때마다 간식이 늘고, 포기·실패·도전 중 철수면 0
  s = mk(); s.challengeStreak = 2; C.startChallenge(s, 'frugal'); s.zone = C.CHALLENGES.find(d => d.id === 'frugal').goal;
  const ev = []; C.tick(s, 0.1, () => 0.5).forEach(e => ev.push(e));
  const done = ev.find(e => e.type === 'challenge-done'); assert.ok(done, '시간이 흐르면 성공을 알아챈다'); assert.equal(s.challengeStreak, 3);
  assert.ok(done.treats >= 4, '연속 2번 뒤의 성공은 간식을 더 받는다');
  s = mk(); s.challengeStreak = 3; C.startChallenge(s, 'lean'); s.runEarned = 1e30;
  assert.equal(C.retreat(s, 0, () => 0.5).state.challengeStreak, 0, '도전을 달고 철수하면 끊긴다');
  s = mk(); s.challengeStreak = 3; s.runEarned = 1e30; assert.equal(C.retreat(s, 0, () => 0.5).state.challengeStreak, 3, '도전 없이 철수하면 남는다');
  // 무결: 뚫리면 실패 알림이 한 번 나오고 연속이 끊긴다
  s = mk(); s.challengeStreak = 1; C.startChallenge(s, 'unbroken'); s.challenge.failed = true;
  const fe = C.tick(s, 0.1, () => 0.5).filter(e => e.type === 'challenge-failed'); assert.equal(fe.length, 1); assert.equal(s.challengeStreak, 0);
  assert.equal(C.tick(s, 0.1, () => 0.5).filter(e => e.type === 'challenge-failed').length, 0);
});

test('1.7.0 도전의 고유 보상: 훈장이 있으면 붙고, 여러 번 성공해도 한 번만 붙는다', () => {
  C.CHALLENGES.forEach(d => assert.ok(d.perk && d.perk.text && d.perk.key, d.id));
  const base = C.createState(0), has = (id, n) => { const s = C.createState(0); s.medals[id] = n || 1; return s; };
  assert.ok(Math.abs(C.buildingCost(has('frugal'), C.BUILDINGS[0].id, 50) / C.buildingCost(base, C.BUILDINGS[0].id, 50) - 0.95) < 0.01);
  assert.equal(C.autoShare(base, 0), 0.5); assert.equal(C.autoShare(has('hands'), 0), 0.6);
  assert.equal(C.scoutLeft(has('sprint')), Math.ceil(C.scoutNeed(0) * 0.85));
  const d0 = C.defensePower(Object.assign(base, { defenses: Object.assign({}, base.defenses, { rail: 10 }) }));
  const w = has('onewall'); w.defenses.rail = 10; assert.ok(Math.abs(C.defensePower(w) / d0 - 1.1) < 0.01);
  const b2 = C.createState(0); assert.ok(Math.abs(C.nightReward(has('unbroken')) / C.nightReward(b2) - 1.2 * (1 + C.MEDAL_BONUS)) < 0.05 || C.nightReward(has('unbroken')) >= C.nightReward(b2) * 1.2 - 1e-9);
  assert.ok(C.defenseCost(has('horde'), 'rail', 1) < C.defenseCost(b2, 'rail', 1));
  assert.ok(Math.abs(C.globalMult(has('lean')) / C.globalMult(b2) - 1.1 * (1 + C.MEDAL_BONUS)) < 1e-9);
  assert.ok(Math.abs(C.globalMult(has('lean', 5)) - C.globalMult(has('lean', 1))) < 1e-9, '다섯 번 성공해도 보상은 한 번');
  const r0 = C.createState(0), r1 = has('oneshot'); r0.runEarned = r1.runEarned = 1e30; assert.ok(C.antibodiesOnRetreat(r1) > C.antibodiesOnRetreat(r0));
});

test('1.7.2 맨몸 도전 중에는 개조를 세는 목표가 원래 목표로 돌아간다(채울 방법이 없어 막히지 않게)', () => {
  const s = C.createState(0); s.bestZone = 6; s.goalPick = { 0: [1, 1, 1], 1: [1, 1, 1] };
  assert.ok(C.activeGoals(s, 0).some(g => /개조/.test(g.text)), '평소에는 개조 목표가 뽑힐 수 있다');
  assert.ok(C.startChallenge(s, 'frugal').ok);
  for (const zi of [0, 1]) assert.ok(!C.activeGoals(s, zi).some(g => /개조/.test(g.text)), (zi + 1) + '구역');
  assert.equal(C.activeGoals(s, 0)[0].id, 'z1a2', '개조와 상관없는 바뀐 목표는 그대로');
  C.quitChallenge(s); assert.ok(C.activeGoals(s, 0).some(g => /개조/.test(g.text)), '포기하면 돌아온다');
});

test('1.7.4: 훈장은 생산 +2%, 손수 도전 중에는 자리 비움 효율이 절반', () => {
  assert.equal(C.MEDAL_BONUS, 0.02);
  const a = C.createState(0), b = C.createState(0); b.bestZone = 6; assert.ok(C.startChallenge(b, 'hands').ok);
  assert.ok(Math.abs(C.offlineRate(b) - C.offlineRate(a) * 0.5) < 1e-9);
  C.quitChallenge(b); assert.equal(C.offlineRate(b), C.offlineRate(a));
});

// 원정 시험용: 목표는 다녀올 때마다 바뀌므로(3.0.6) 첫 후보로 고정해서 만든다. NEED 는 그 판의 목표 수치
const mk = (main, id, hard) => { main.stageGoal = main.stageGoal || {}; main.stageGoal[id] = 0; return C.createStage(main, id, hard, 0); };
const NEED = (st) => C.stageStatus(st).need;

test('1.8.0 원정: 스테이지는 따로 만든 새 판이고, 본 게임에는 결과만 적힌다', () => {
  assert.equal(C.STAGES.length, 6); assert.equal(C.STAGES.filter(d => d.boss).length, 1);
  C.STAGES.forEach(d => { assert.ok(d.speed < d.limit && d.need > 0 && C.STAGE_RULES[d.hard], d.id); d.rules.forEach(r => assert.ok(C.STAGE_RULES[r], d.id + ' ' + r)); assert.ok(d.rules.indexOf(d.hard) < 0, d.id + ': 하드 규칙은 원래 규칙과 달라야 한다'); });
  const main = C.createState(0); main.traits.immune = 10; main.supplies = 123; main.story = { 'z1-0': true };
  assert.equal(C.stageBlock(main, 's1-1', false), 'locked'); assert.equal(mk(main, 's1-1', false), null);
  main.bestZone = 2;
  assert.equal(C.stageBlock(main, 's1-1', false), ''); assert.equal(C.stageBlock(main, 's1-2', false), 'prev'); assert.equal(C.stageBlock(main, 's1-1', true), 'hard'); assert.equal(C.stageBlock(main, 'zz', false), 'unknown');
  const before = C.serialize(main);
  const st = mk(main, 's1-1', false);
  assert.ok(st.stage && st.supplies === 0 && !st.traits.immune, '특성 없이 빈 거점에서 시작한다');
  assert.equal(st.story['z1-0'], true, '읽은 일지는 옮겨서 다시 뜨지 않는다');
  assert.ok(C.stageRule(st, 'tap5') && !C.stageRule(st, 'lean') && !C.stageRule(main, 'tap5'));
  assert.ok(Math.abs(C.clickValue(st) / C.clickValue(C.createState(0)) - 5) < 1e-9, '직접 수색 5배');
  assert.equal(C.canRetreat(st), false);
  // 스테이지를 굴려도 본 게임은 그대로다
  for (let i = 0; i < 50; i++) { C.scavenge(st); C.tick(st, 1, () => 0.5); }
  assert.equal(C.serialize(main), before);
  assert.equal(Object.keys(st.ach).length, 0, '스테이지에서는 업적을 세지 않는다');
  // 시간이 다 되면 실패, 결과를 적어도 표시는 없다
  const lost = mk(main, 's1-1', false); lost.runSeconds = 480;
  assert.ok(C.tick(lost, 0.1, () => 0.5).some(e => e.type === 'stage-lost')); assert.ok(C.stageStatus(lost).lost);
  assert.equal(C.finishStage(main, lost).won, false); assert.equal(C.stageMarks(main, 's1-1').clear, false);
  // 목표를 채우면 클리어. 빨랐으면 스피드도. 간식은 새 표시마다 한 번만
  st.runEarned = NEED(st); st.runSeconds = 200;
  const ev = C.tick(st, 0.1, () => 0.5).find(e => e.type === 'stage-won'); assert.ok(ev && ev.speed);
  st.runEarned = 0; C.tick(st, 0.1, () => 0.5); assert.ok(C.stageStatus(st).won, '한 번 정해진 결과는 바뀌지 않는다');
  const t0 = main.treats, r = C.finishStage(main, st);
  assert.deepEqual(r.got, ['clear', 'speed', 'safe']); assert.equal(main.treats, t0 + C.STAGE_TREATS.clear + C.STAGE_TREATS.speed + C.STAGE_TREATS.safe + r.stepTreats);
  assert.deepEqual(C.finishStage(main, st).got, [], '같은 표시는 다시 받지 않는다');
  assert.equal(C.stageBlock(main, 's1-2', false), ''); assert.equal(C.stageBlock(main, 's1-1', true), '');
  // 하드: 규칙이 하나 더 걸리고 하드 표시를 준다
  const hd = mk(main, 's1-1', true); assert.ok(C.stageRule(hd, 'lean')); hd.runEarned = NEED(hd); hd.runSeconds = 400; C.tick(hd, 0.1, () => 0.5);
  assert.deepEqual(C.finishStage(main, hd).got, ['hard', 'hardSafe']); assert.equal(C.stageMarks(main, 's1-1').best, 201, '최고 기록은 더 빠른 쪽');
  assert.deepEqual(C.stageMarkCount(main), { have: 5, all: 36 });
  // 표시는 저장과 철수를 거쳐도 남고, 스테이지 판 자체는 저장되지 않는다
  const back = C.deserialize(C.serialize(main), 0); assert.deepEqual(C.stageMarks(back, 's1-1'), C.stageMarks(main, 's1-1')); assert.equal(back.stage, null);
  assert.equal(C.deserialize(C.serialize(st), 0).stage, null);
  main.runEarned = 1e30; assert.equal(C.stageMarks(C.retreat(main, 0, () => 0.5).state, 's1-1').clear, true);
  // 보스를 잡으면 지역 휘장: 전리품이 는다
  const b = C.createState(0), loot0 = C.nightReward(b); b.stageMarks['s1-b'] = { clear: true, speed: false, hard: false, best: 700 };
  assert.equal(C.badgeCount(b), 1); assert.ok(Math.abs(C.nightReward(b) / loot0 - 1.1) < 1e-9);
});

test('3.0.2 원정의 흔적: 최고 기록, 구간 간식, 다시 도전 물자, 하드 별 둘', () => {
  const main = C.createState(0); main.bestZone = 6; main.zone = 3;
  const id = C.STAGES[0].id, def = C.STAGES[0];
  // 시간이 다 돼 실패: 간 만큼 기록이 남고, 넘은 구간만큼 간식을 받는다
  const a = mk(main, id, false); a.runEarned = NEED(a) * 0.6; a.runSeconds = def.limit + 1; C.tick(a, 0.1, () => 0.5);
  const t0 = main.treats, r1 = C.finishStage(main, a);
  assert.equal(r1.won, false); assert.equal(r1.why, 'time'); assert.ok(r1.record); assert.ok(Math.abs(r1.pct - 0.6) < 0.01);
  assert.equal(main.treats, t0 + 2 * C.STAGE_STEP_TREATS, '25%와 50%를 넘었다');
  assert.equal(C.stageMarks(main, id).fails, 1); assert.equal(C.stageRetryBonus(main, id, false), C.STAGE_RETRY_SUPPLIES); assert.equal(C.stageRetryBonus(main, id, true), 0, '하드에는 얹지 않는다');
  assert.equal(mk(main, id, false).supplies, C.STAGE_RETRY_SUPPLIES); assert.equal(mk(main, id, false).runEarned, 0);
  // 같은 구간은 다시 주지 않고, 더 못 가면 기록도 그대로
  const b = mk(main, id, false); b.runEarned = NEED(b) * 0.3; b.runSeconds = def.limit + 1; C.tick(b, 0.1, () => 0.5);
  const t1 = main.treats, r2 = C.finishStage(main, b);
  assert.equal(main.treats, t1); assert.equal(r2.record, false); assert.ok(Math.abs(C.stageMarks(main, id).pct - 0.6) < 0.01); assert.equal(C.stageMarks(main, id).fails, 2);
  // 포기는 실패로 세지 않는다
  const q = mk(main, id, false); q.runEarned = NEED(q) * 0.1; assert.equal(C.finishStage(main, q).why, 'quit'); assert.equal(C.stageMarks(main, id).fails, 2);
  // 클리어하면 남은 구간 간식을 마저 받고 실패 횟수는 0
  const c = mk(main, id, false); c.runEarned = NEED(c); c.runSeconds = C.stageSpeed(def, false, 0) + 50; C.tick(c, 0.1, () => 0.5);
  c.breaches = 1; const r3 = C.finishStage(main, c); assert.deepEqual(r3.got, ['clear'], '방어 실패가 있으면 무결은 못 받는다'); assert.equal(r3.stepTreats, C.STAGE_STEP_TREATS); assert.equal(C.stageMarks(main, id).fails, 0); assert.equal(C.stageMarks(main, id).pct, 1);
  // 하드 별 둘: 하드 클리어, 하드를 스피드 기준 안에
  const h = mk(main, id, true); h.runEarned = NEED(h); h.runSeconds = C.stageSpeed(def, true, 0) - 10; C.tick(h, 0.1, () => 0.5);
  assert.deepEqual(C.finishStage(main, h).got, ['speed', 'hard', 'safe', 'hardSpeed', 'hardSafe']);
  const back = C.deserialize(C.serialize(main), 0); assert.deepEqual(C.stageMarks(back, id), C.stageMarks(main, id));
  // 실패 기록만 있는 원정도 저장을 거쳐 남는다
  const only = C.createState(0); only.stageMarks[id] = { pct: 0.4, steps: 1, fails: 2 };
  assert.deepEqual([C.stageMarks(C.deserialize(C.serialize(only), 0), id).pct, C.stageMarks(C.deserialize(C.serialize(only), 0), id).fails], [0.4, 2]);
});

test('1.9.0 뽑기: 화면의 확률표와 실제 추첨이 같고, 보장·중복·조각·입기가 맞게 돈다', () => {
  const table = C.gachaTable();
  assert.ok(Math.abs(table.reduce((a, t) => a + t.pct, 0) - 100) < 1e-9, '확률의 합은 100%');
  assert.ok(table.every(t => !C.COSMETICS.find(c => c.id === t.id).base), '기본 외형은 뽑기에 없다');
  [0, 1, 2].forEach(r => assert.ok(Math.abs(table.filter(t => t.rarity === r).reduce((a, t) => a + t.pct, 0) - C.GACHA_ODDS[r] * 100) < 1e-9));
  // 12만 번 뽑아 품목별 빈도가 표와 맞는지(보장이 끼어들지 않게 매번 보장 횟수를 지운다)
  let z = 12345; const rng = () => { z = (z * 1664525 + 1013904223) >>> 0; return z / 4294967296; };
  const s = C.createState(0), seen = {}, N = 120000;
  for (let i = 0; i < N; i++) { s.tickets = 1; s.gachaPity = 0; const r = C.pullGacha(s, rng); assert.ok(r.ok); seen[r.id] = (seen[r.id] || 0) + 1; }
  table.forEach(t => assert.ok(Math.abs((seen[t.id] || 0) / N * 100 - t.pct) < 0.35, t.name + ' ' + ((seen[t.id] || 0) / N * 100).toFixed(2) + '% / ' + t.pct.toFixed(2) + '%'));
  // 뽑기권이 없으면 못 뽑는다
  const e = C.createState(0); assert.equal(C.pullGacha(e, rng).reason, 'tickets');
  // 보장: 전설이 한 번도 안 나오는 난수로도 30번째에는 전설
  const p = C.createState(0); p.tickets = 100; let last = null;
  for (let i = 0; i < C.GACHA_PITY; i++) { assert.equal(C.gachaPityLeft(p), C.GACHA_PITY - i); last = C.pullGacha(p, () => 0); assert.equal(last.rarity === 2, i === C.GACHA_PITY - 1); }
  assert.ok(last.pity); assert.equal(p.gachaPity, 0); assert.equal(p.tickets, 100 - C.GACHA_PITY);
  // 중복은 조각으로
  const d = C.createState(0); d.tickets = 2; const a = C.pullGacha(d, () => 0), b = C.pullGacha(d, () => 0);
  assert.equal(a.dup, false); assert.ok(C.ownsCosmetic(d, a.id)); assert.equal(b.id, a.id); assert.equal(b.dup, true); assert.equal(d.shards, C.SHARDS_DUP[a.rarity]);
  // 조각으로 얻기, 입기
  assert.equal(C.craftCosmetic(d, 'coat-night').reason, 'shards'); d.shards = 50; assert.ok(C.craftCosmetic(d, 'coat-night').ok); assert.equal(d.shards, 0);
  assert.equal(C.craftCosmetic(d, 'coat-night').reason, 'owned'); assert.equal(C.wearCosmetic(d, 'flag-pink').reason, 'locked');
  assert.ok(C.wearCosmetic(d, 'coat-night').ok); assert.deepEqual(C.cosmeticLook(d).coat, { y: '#27336e', j: '#4a5fb8' }); assert.equal(C.cosmeticLook(d).flag, '#f0b400');
  assert.deepEqual([C.cosmeticLook(d).hood, C.cosmeticLook(d).pat, C.cosmeticLook(d).bag, C.cosmeticLook(d).fx], ['none', 'none', 'cooler', 'none']);
  // 간식으로 뽑기권
  const t = C.createState(0); assert.equal(C.buyTicket(t).reason, 'treats'); t.treats = C.TICKET_TREATS; assert.ok(C.buyTicket(t).ok); assert.equal(t.tickets, 1); assert.equal(t.treats, 0);
  // 저장과 철수를 거쳐도 남고, 갖지 않은 옷을 입은 저장은 기본으로 돌린다
  const back = C.deserialize(C.serialize(d), 0); assert.ok(C.ownsCosmetic(back, 'coat-night')); assert.equal(back.wear.coat, 'coat-night');
  const bad = JSON.parse(C.serialize(C.createState(0))); bad.wear = { coat: 'coat-neon', flag: 'zzz' }; assert.deepEqual(C.deserialize(JSON.stringify(bad), 0).wear, C.COS_BASE);
  d.runEarned = 1e30; const n = C.retreat(d, 0, () => 0.5).state; assert.ok(C.ownsCosmetic(n, 'coat-night')); assert.equal(n.wear.coat, 'coat-night');
  // 외형은 생산에 영향이 없다
  assert.equal(C.globalMult(d), C.globalMult(C.createState(0)));
});

test('1.9.0 뽑기권: 원정의 새 표시, 도전 성공, 변이체를 막은 밤에 받는다', () => {
  const main = C.createState(0); main.bestZone = 2;
  const st = mk(main, 's1-1', false); st.runEarned = NEED(st); st.runSeconds = 100; C.tick(st, 0.1, () => 0.5);
  const r = C.finishStage(main, st); assert.equal(r.tickets, 3); assert.equal(main.tickets, 3);      // 클리어 · 스피드 · 무결
  const c = C.createState(0); c.bestZone = 6; C.startChallenge(c, 'frugal'); c.zone = C.CHALLENGES.find(d => d.id === 'frugal').goal; C.tick(c, 0.1, () => 0.5); assert.equal(c.tickets, 3);
});

test('1.9.0: README 의 뽑기 확률표가 코드의 표와 같다', () => {
  const md = require('fs').readFileSync(require('path').join(__dirname, '..', 'README.md'), 'utf8');
  C.gachaTable().forEach(t => assert.ok(md.includes('| ' + C.RARITIES[t.rarity] + ' | ' + t.name + ' | ' + t.pct.toFixed(2) + '% |'), t.name));
});

test('2.0.0 외형: 후드·무늬·가방·효과가 뽑기에 있고 깃발은 없다. 깃발은 도전과 원정의 확정 보상이다', () => {
  const table = C.gachaTable();
  assert.equal(table.length, 60); assert.ok(!table.some(t => t.slot === 'flag'));
  ['hood', 'pat', 'bag', 'fx', 'pet'].forEach(slot => assert.ok(table.some(t => t.slot === slot), slot));
  C.COS_SLOTS.forEach(slot => assert.equal(C.COSMETICS.filter(c => c.slot === slot && c.base).length, 1, slot + ': 기본은 하나'));
  const S = require('../src/scene.js');
  C.COSMETICS.forEach(c => { if (c.slot === 'hood') assert.ok(S.LARA_HOODS[c.look], c.id); if (c.slot === 'bag') assert.ok(S.LARA_BAGS[c.look], c.id); });
  // 그림: 어떤 조합과 자세에서도 14×18칸
  Object.keys(S.LARA_HOODS).forEach(h => Object.keys(S.LARA_BAGS).forEach(b => ['stand', 'walk', 'search'].forEach(p => [0, 1].forEach(st => { const r = S.laraRows({ hood: h, bag: b }, p, st); assert.equal(r.length, S.LARA_H); r.forEach(row => assert.equal(row.length, S.LARA_W)); }))));
  // 입기
  const s = C.createState(0); s.cosmetics['hood-cat'] = s.cosmetics['pat-stripe'] = s.cosmetics['bag-teddy'] = s.cosmetics['fx-glow'] = true;
  ['hood-cat', 'pat-stripe', 'bag-teddy', 'fx-glow'].forEach(id => assert.ok(C.wearCosmetic(s, id).ok));
  assert.deepEqual(C.cosmeticLook(s), { coat: { y: '#f0b400', j: '#f0b400' }, hood: 'cat', pat: 'stripe', bag: 'teddy', fx: 'glow', pet: 'none', flag: '#f0b400' });
  assert.deepEqual(C.cosmeticLook(C.deserialize(C.serialize(s), 0)), C.cosmeticLook(s));
  // 깃발: 조건을 채우면 받는다
  const f = C.createState(0); assert.deepEqual(C.grantFlags(f), []);
  f.medals.frugal = 1; assert.deepEqual(C.grantFlags(f), ['빨간 깃발']); assert.deepEqual(C.grantFlags(f), [], '한 번만');
  f.stageMarks['s1-b'] = { clear: true, speed: false, hard: false, best: 1 }; assert.deepEqual(C.grantFlags(f), ['검은 깃발']);
  assert.ok(C.wearCosmetic(f, 'flag-black').ok);
});

test('2.0.1 야광 깃발과 무지개 깃발: 원정 표시 12개, 이야기의 끝에서 받고, 그림은 줄마다 색이 다르다', () => {
  const S = require('../src/scene.js');
  assert.equal(new Set(S.flagRows('rainbow', 0)).size, 4); assert.notDeepEqual(S.flagRows('rainbow', 0), S.flagRows('rainbow', 1));
  assert.equal(S.flagRows('#c0392b', 0)[0], '#c0392b'); assert.equal(S.flagRows('zzz', 0)[0], '#f0b400', '모르는 값은 기본 색');
  const s = C.createState(0);
  ['s1-1', 's1-2', 's1-3', 's1-4'].forEach(id => { s.stageMarks[id] = { clear: true, speed: true, hard: true, best: 1 }; });
  assert.ok(C.grantFlags(s).includes('야광 깃발')); assert.ok(C.wearCosmetic(s, 'flag-glow').ok); assert.equal(C.cosmeticLook(s).flag, 'glow');
  const e = C.createState(0); e.ended = 1; assert.ok(C.grantFlags(e).includes('무지개 깃발'));
  assert.ok(!C.gachaTable().some(t => t.slot === 'flag'), '깃발은 뽑기에 없다');
});

test('2.0.3 동물 친구의 옷: 뽑기에 있고, 친구 그림은 15×11칸', () => {
  const S = require('../src/scene.js');
  assert.equal(C.gachaTable().filter(t => t.slot === 'pet').length, 15);      // 4.4.6: 여덟 가지를 더했다
  // 4.4.6: 그림은 15×11칸(앉은 옆모습) 하나. 품종마다 그림이 있고, 모르는 품종은 그 종류의 첫 그림으로 그린다
  ['dog', 'cat', 'zzz'].forEach(k => [0, 1].forEach(w => { const r = S.petRows(k, w); assert.equal(r.length, S.PET_H); r.forEach(row => assert.equal(row.length, S.PET_W)); assert.ok(r.some(row => row.includes('e')), '눈'); }));
  C.PET_BREEDS.forEach(b => { assert.ok(S.PET_SPEC[b.id], '그림이 없다: ' + b.id); assert.equal(S.PET_SPEC[b.id].kind, b.kind, b.id); });
  assert.notDeepEqual(S.petRows('dog', 0, 'shiba'), S.petRows('dog', 0, 'beagle'), '품종마다 다르다');
  { const log = []; const ctx = { fillStyle: '', fillRect() { log.push(1); } }; assert.ok(S.paintPetBig(ctx, 0, 0, 2, { kind: 'cat', id: 'golden' })); assert.ok(log.length > 60, '칸 그림이 다 그려진다(테두리 없이 60칸 넘게)'); }
  const s = C.createState(0); s.cosmetics['pet-crown'] = true; assert.ok(C.wearCosmetic(s, 'pet-crown').ok); assert.equal(C.cosmeticLook(s).pet, 'crown');
  // 그리기: 어떤 옷이든 오류 없이 그려지고, 옷을 입히면 칠하는 칸이 달라진다
  const calls = (outfit) => { const log = []; const ctx = { fillStyle: '', fillRect(x, y, w, h) { log.push([this.fillStyle, x, y, w, h].join()); } }; S.paintPet(ctx, 0, 0, 1, false, { kind: 'dog' }, outfit, 0); return log; };
  const plain = calls('none');
  C.COSMETICS.filter(c => c.slot === 'pet' && !c.base).forEach(c => assert.ok(calls(c.look).length > plain.length, c.name));
});

test('2.0.4 걷는 그림: 두 발이 양옆으로 벌어지지 않는다(다리를 찢는 것처럼 보였다)', () => {
  const S = require('../src/scene.js');
  const feet = (rows) => { const last = rows[rows.length - 1], a = last.search(/[^.]/), b = last.length - 1 - last.split('').reverse().join('').search(/[^.]/); return b - a + 1; };
  const stand = feet(S.laraRows({}, 'stand', 0));
  [0, 1].forEach(st => assert.ok(feet(S.laraRows({}, 'walk', st)) <= stand, '라라 걸음 ' + st));
  assert.notDeepEqual(S.laraRows({}, 'walk', 0), S.laraRows({}, 'walk', 1), '두 걸음은 서로 다르다');
  ['walker', 'hair'].forEach(k => { const f = S.zombieFrames(k); assert.ok(feet(f[1]) <= feet(f[0]) + 1, k); });
});

test('2.1.0 위험 단계: 끝을 본 뒤에 고르고, 무리와 문 값이 오르고, 돌파하면 다음 단계와 영구 생산이 열린다', () => {
  const s = C.createState(0);
  assert.equal(C.dangerMax(s), 0); assert.equal(C.setDangerNext(s, 1).reason, 'locked'); assert.ok(C.setDangerNext(s, 0).ok);
  s.ended = 1; assert.equal(C.dangerMax(s), 1); assert.ok(C.setDangerNext(s, 1).ok); assert.equal(C.setDangerNext(s, 2).reason, 'locked'); assert.equal(C.setDangerNext(s, -1).reason, 'unknown');
  // 철수하면 그 단계로 시작한다
  s.runEarned = 1e30; const n = C.retreat(s, 0, () => 0.5).state;
  assert.equal(n.danger, 1); assert.equal(n.dangerNext, 1, '다음에도 같은 단계로 이어진다');
  const base = C.createState(0);
  assert.ok(Math.abs(C.nightStrength(n) / C.nightStrength(base) - C.DANGER_HORDE) < 0.2);
  assert.ok(Math.abs(C.nextZone(n).cost / C.nextZone(base).cost - C.DANGER_COST) < 1e-6);
  n.zone = 6; base.zone = 6; assert.ok(Math.abs(C.serumCost(n) / C.serumCost(base) - C.DANGER_SERUM) < 1e-6, '혈청 값은 문 값과 따로 오른다');
  n.runEarned = base.runEarned = 1e30; assert.ok(C.antibodiesOnRetreat(n) > C.antibodiesOnRetreat(base), '철수 항체가 는다');
  // 위험 1에서 끝을 보면: 다음 단계가 열리고, 전체 생산이 영구히 늘고, 뽑기권을 더 받고, 구조한 생존자가 쌓인다
  const g0 = C.globalMult(n), t0 = n.tickets; n.survivors = 6000; n.runSeconds = 5000;
  C.goals(n, 6).forEach(g => { n.goalsDone[g.id] = true; });
  const ev = C.tick(n, 0.1, () => 0.5).find(e => e.type === 'ending');
  assert.ok(ev && ev.higher && ev.danger === 1); assert.equal(n.bestDanger, 1); assert.equal(C.dangerMax(n), 2);
  assert.ok(n.tickets >= t0 + 3 + C.DANGER_TICKETS);
  assert.ok(ev.saved >= 12000, '위험 단계에서는 구조한 수가 배로 쌓인다'); assert.equal(n.rescued, ev.saved); assert.equal(C.rescueTier(n), 1);
  assert.ok(C.globalMult(n) >= g0 * C.DANGER_PROD * (1 + C.RESCUE_BONUS) * 0.99);
  assert.ok(n.bests.time > 0 && n.bests.byDanger[1] === n.bests.time); assert.equal(n.endLog.length, 1);
  // 철수와 저장을 거쳐도 남는다
  const back = C.deserialize(C.serialize(n), 0);
  assert.deepEqual([back.bestDanger, back.rescued, back.bests.time, back.endLog.length, back.danger], [1, n.rescued, n.bests.time, 1, 1]);
  n.runEarned = 1e40; const r2 = C.retreat(n, 0, () => 0.5).state; assert.deepEqual([r2.bestDanger, r2.rescued, r2.danger], [1, n.rescued, 1]);
  // 단계를 0으로 내리면 평소대로
  C.setDangerNext(n, 0); assert.equal(C.retreat(n, 0, () => 0.5).state.danger, 0);
  // 구조 단계는 문턱마다 오르고 상한이 있다
  const q = C.createState(0); q.rescued = 1e30; assert.equal(C.rescueTier(q), C.RESCUE_TIERS.length); assert.equal(C.rescueNext(q), 0);
});

/* ================= 엄마의 수첩 ================= */

test('엄마의 수첩: 끝을 보기 전에도, 끝을 본 바로 그 회차에도 열리지 않는다', () => {
  const s = C.createState(0);
  assert.equal(C.afterEnding(s), false);
  assert.ok(!C.tick(s, 0.1, half).some(e => e.type === 'story' && e.mom));
  // 끝을 본 회차: zone 이 7구역이어도 한 쪽도 열리지 않는다(15쪽이 한꺼번에 쏟아지지 않는다)
  s.ended = 1; s.endedRun = true; s.zone = 6;
  assert.equal(C.afterEnding(s), false);
  assert.ok(!C.tick(s, 0.1, half).some(e => e.type === 'story' && e.mom));
  assert.equal(C.momRead(s), 0);
});

test('엄마의 수첩: 끝을 본 뒤의 회차에서 구역을 따라 한 쪽씩 열린다', () => {
  const s = C.createState(0); s.ended = 1;
  const moms = (st) => C.tick(st, 0.1, half).filter(e => e.type === 'story' && e.mom).map(e => e.id);
  assert.deepEqual(moms(s), ['mom-0'], '새 회차가 시작되면 여는 글');
  assert.deepEqual(moms(s), [], '같은 쪽은 다시 열리지 않는다');
  // 1구역: 목표 둘을 채우면 첫 쪽, 모두 채우면 둘째 쪽
  const g0 = C.activeGoals(s, 0);
  s.goalsDone[g0[0].id] = true; s.goalsDone[g0[1].id] = true;
  assert.ok(moms(s).includes('mom-1'));
  g0.forEach(g => { s.goalsDone[g.id] = true; });
  assert.ok(moms(s).includes('mom-2'));
  // 3구역에 들어서면 2구역·3구역의 첫 쪽이 열린다(둘째 쪽은 그 구역의 목표를 다 채워야 한다)
  s.zone = 2;
  const got = moms(s);
  assert.ok(got.includes('mom-3') && got.includes('mom-5'));
  assert.ok(!got.includes('mom-6') && !got.includes('mom-7'));
  // 마지막 쪽은 끝을 두 번째로 봐야 열린다
  s.zone = 6;
  assert.ok(!moms(s).includes('mom-14'));
  s.ended = 2; s.endedRun = true;
  assert.deepEqual(moms(s), ['mom-14']);
  // 철수해도 읽은 쪽은 남는다
  s.runEarned = 1e20; s.pendingPerks = [];
  const n = C.retreat(s, 0).state;
  assert.ok(n.story['mom-0'] && n.story['mom-14']);
});

test('엄마의 수첩: 15쪽이고, 글에 채우지 못한 자리가 없고, 원정에서는 열리지 않는다', () => {
  assert.equal(C.MOM_PAGES.length, 15);
  const moms = C.BEATS.filter(b => b.mom);
  assert.equal(moms.length, 15);
  assert.ok(moms.every(b => b.zone === C.MOM_CHAPTER));
  for (const g of ['none', 'm', 'f']) for (const name of ['라라', '민준']) for (const b of moms) {
    const text = C.fillStory(b.text, name, g);
    assert.ok(!/[{}]/.test(text), b.id);
    assert.ok(!text.includes('undefined') && !text.includes('null'), b.id);
  }
  assert.equal(new Set(C.BEATS.map(b => b.id)).size, C.BEATS.length);
  // 원정의 상태는 끝을 본 횟수를 옮기지 않으므로 수첩이 열리지 않는다
  const main = C.createState(0); main.ended = 1; main.bestZone = 6; main.zone = 3;
  const st = C.createStage(main, 's1-1', false, 0);
  if (st) { assert.equal(C.afterEnding(st), false); assert.ok(!C.tick(st, 0.1, half).some(e => e.type === 'story' && e.mom)); }
  // 일지 업적의 문턱은 본편 일지(22편)만으로 닿는다
  assert.ok(C.BEATS.filter(b => !b.mom).length >= 17);
});

test('위험 단계의 값: 문 값은 10단계까지 2.2배씩, 그 뒤로는 덜 가파르게 오르고, 혈청 값은 그보다 완만하다', () => {
  assert.equal(C.dangerCost(0), 1); assert.equal(C.dangerSerum(0), 1);
  for (let n = 1; n <= C.DANGER_MAX; n++) {
    const step = C.dangerCost(n) / C.dangerCost(n - 1);
    assert.ok(Math.abs(step - (n <= C.DANGER_COST_KNEE ? C.DANGER_COST : C.DANGER_COST_LATE)) < 1e-9, '단계 ' + n);
    assert.ok(C.dangerSerum(n) > C.dangerSerum(n - 1) && C.dangerSerum(n) < C.dangerCost(n), '혈청은 문보다 덜 오른다: ' + n);
  }
  assert.ok(C.DANGER_COST_LATE < C.DANGER_COST && C.DANGER_COST_LATE > C.DANGER_PROD, '뒤쪽도 힘보다는 빨리 오른다(쉬워지지는 않는다)');
});

test('2.5.0 도전 난이도: 외벽·무결은 무리가 불고, 거센 무리는 방어 실패 3번까지, 단숨에는 시간 제한이 있다', () => {
  const base = C.nightStrength(C.createState(0));
  const on = (id) => { const s = C.createState(0); s.challenge = { id, failed: false, done: false }; return s; };
  assert.ok(Math.abs(C.nightStrength(on('onewall')) - base * C.ONEWALL_MULT) <= 1);
  assert.ok(Math.abs(C.nightStrength(on('unbroken')) - base * C.UNBROKEN_MULT) <= 1);
  assert.ok(Math.abs(C.nightStrength(on('horde')) - base * C.HORDE_MULT) <= 1);
  // 거센 무리: 세 번까지는 버티고, 네 번째에 실패한다(켜기 전에 이미 넘겼으면 켤 수 없다)
  const h = C.createState(0); h.bestZone = 6; h.ended = 1; h.breaches = C.HORDE_BREACHES;
  assert.equal(C.challengeBlock(h, 'horde'), '');
  h.breaches = C.HORDE_BREACHES + 1; assert.equal(C.challengeBlock(h, 'horde'), 'broken');
  // 단숨에: 제한 시간을 넘기면 실패
  const o = on('oneshot'); o.runSeconds = C.ONESHOT_SECONDS + 1; const ev = []; C.checkChallenge(o, ev);
  assert.ok(o.challenge.failed); assert.equal(ev[0].why, 'time');
  const o2 = on('oneshot'); o2.runSeconds = C.ONESHOT_SECONDS - 1; C.checkChallenge(o2, []); assert.ok(!o2.challenge.failed);
  // 목표 구역: 여덟 개 가운데 여섯이 6구역 이상이다(전에는 3~5구역이 다섯이었다)
  assert.deepEqual(C.CHALLENGES.map(d => d.goal), [2, 3, 4, 5, 5, 6, 6, 'end']);
});

test('3.0.6 원정 목표는 다녀올 때마다 다른 것으로 바뀐다', () => {
  const main = C.createState(0); main.bestZone = 6; main.zone = 3;
  const id = 's1-1', def = C.STAGES[0];
  assert.ok(def.goals.length >= 3);
  C.STAGES.forEach(d => { assert.ok(d.goals.length >= 3, d.id); d.goals.forEach(g => { assert.ok(g.need > 0 && g.hardNeed > 0 && g.speed > 0 && g.speed < d.limit && g.hardSpeed < d.limit, d.id + ' ' + g.goal); }); assert.equal(d.goals[0].goal, d.goal); });
  assert.equal(C.stageGoalIndex(main, id), 0);
  // 한 발짝도 못 가고 돌아온 포기는 목표를 바꾸지 않는다
  const q = C.createStage(main, id, false, 0); C.finishStage(main, q, () => 0.5); assert.equal(C.stageGoalIndex(main, id), 0);
  // 다녀오면 바뀐다: 언제나 다른 후보로, 범위 안에서
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const before = C.stageGoalIndex(main, id), s = C.createStage(main, id, false, 0);
    assert.equal(s.stage.goal, before); assert.equal(C.stageStatus(s).goal, def.goals[before].goal);
    s.runSeconds = def.limit + 1; C.tick(s, 0.1, () => 0.5); C.finishStage(main, s, () => (i * 0.37) % 1);
    const after = C.stageGoalIndex(main, id); assert.notEqual(after, before); assert.ok(after >= 0 && after < def.goals.length); seen.add(after);
  }
  assert.equal(seen.size, def.goals.length, '모든 후보가 나온다');
  // 저장과 철수를 거쳐도 남는다. 엉뚱한 값은 0으로
  main.stageGoal[id] = 2; assert.equal(C.stageGoalIndex(C.deserialize(C.serialize(main), 0), id), 2);
  main.stageGoal[id] = 99; assert.equal(C.stageGoalIndex(main, id), 0); assert.equal(C.stageGoalIndex(C.deserialize(C.serialize(main), 0), id), 0);
  // 목표 글과 수치는 후보를 따른다
  assert.notEqual(C.stageGoalText(def, false, 0), C.stageGoalText(def, false, 1)); assert.equal(C.stageNeed(def, true, 1), def.goals[1].hardNeed);
});

/* 4.2.0 7구역 정착지: 지도에 사람을 놓는다(공사 시간은 없앴다) */
function inCamp() { const s = inLab(); s.zone = 6; s.antennas = 10; s.supplies = 1e60; s.zevIn = { rail: 1e6, guard: 1e6, tower: 1e6 }; C.campOf(s); return s; }
const fill7 = (s, id) => { let r, n = 0; do { r = C.buildSettle(s, id); n++; } while (r.ok && !r.done && n < 99); return r; };
test('7구역 정착지: 자리에 사람을 놓으면 그만큼 차고, 다 차면 그 자리에서 선다. 줄을 따라 열리고, 혈청의 문턱이 된다', () => {
  const s = inCamp(), cost = (id) => C.SETTLE.find((d) => d.id === id).cost;
  assert.equal(C.SETTLE.length, 9); assert.equal(C.settleBlock(inLab(), 'farm'), 'locked');
  assert.equal(C.settleBlock(s, 'farm'), 'people'); assert.equal(C.settleBlock(s, 'mess'), 'prev'); assert.equal(C.buildSettle(s, 'nope').reason, 'unknown');
  s.survivors = cost('farm') + cost('clinic'); const prod0 = C.mods(s).prod, mult0 = C.towerMult(s);
  const r = C.buildSettle(s, 'farm'); assert.ok(r.ok && !r.done); assert.equal(r.sent, Math.ceil(cost('farm') / C.SEND_PARTS)); assert.equal(C.settleWork(s, 'farm'), r.sent); assert.equal(s.camp.flag, 'farm');
  assert.equal(C.settleFree(s), cost('farm') + cost('clinic') - r.sent, '놓은 사람은 문 앞에서 빠진다'); near(C.mods(s).prod, prod0, '다 차기 전에는 효과가 없다'); assert.equal(C.settleCount(s), 0);
  const d = fill7(s, 'farm'); assert.ok(d.done && d.lv === 1 && !d.repaired); assert.equal(C.settleLv(s, 'farm'), 1); assert.equal(C.settleWork(s, 'farm'), 0); near(C.mods(s).prod / prod0, 1.5);
  assert.equal(C.settleFree(s), cost('clinic')); assert.ok(C.towerMult(s) >= mult0, '놓은 사람도 생존자다');
  assert.ok(fill7(s, 'clinic').done); assert.equal(C.serumNeeds(s), null); assert.equal(C.buySerum(s).reason, 'gate'); s.nightLvBest = 10; assert.ok(C.buySerum(s).ok); assert.equal(C.serumNeeds(s).id, 'lab7'); assert.equal(C.buySerum(s).reason, 'settle');
  const d0 = C.mods(s).defense, z0 = C.mods(s).z7, b0 = C.tuneBand(s);
  s.survivors = 1e7; ['guard7', 'mess', 'watch'].forEach((id) => assert.ok(fill7(s, id).done, id));
  near(C.mods(s).defense / d0, 2); near(C.mods(s).z7 / z0, 2); assert.ok(C.tuneBand(s) > b0); assert.equal(C.settleCount(s), 5);
  /* 단계: 끝없이 자란다(값은 단계마다 3배). 효과는 갈수록 덜 는다 */
  assert.equal(C.settleNeed(s, 'farm'), cost('farm') * 3); const u0 = C.settleUsed(s); assert.ok(fill7(s, 'farm').lv === 2); near(C.settleUsed(s), u0 + cost('farm') * 3);
  near(C.mods(s).prod / prod0, Math.pow(1.5, C.levelPow(2))); assert.ok(fill7(s, 'farm').lv === 3); assert.equal(C.settleNeed(s, 'farm'), cost('farm') * 27); assert.equal(C.settleBlock(s, 'farm'), '', '3단계 뒤에도 놓을 수 있다'); assert.equal(C.settleLevels(s), 7);
  s.survivors = 1e15; let lvN = 3; for (let k = 0; k < 8; k++) { const rr = fill7(s, 'farm'); if (rr.ok) lvN = rr.lv; } assert.equal(lvN, C.LV_MAX, '4.3.7: 10단계가 끝'); assert.equal(C.settleNeed(s, 'farm'), 0); assert.equal(C.settleBlock(s, 'farm'), 'done'); assert.ok(C.levelPow(11) - C.levelPow(10) < C.levelPow(2) - C.levelPow(1), '갈수록 덜 는다'); assert.ok(C.mods(s).prod / prod0 < 3);
  s.settleLv.farm = 3; s.survivors = 1e9;
  /* 저장을 거쳐도 남고(놓는 중인 것도), 옛 저장의 '짓는 중'은 다 지은 것으로 옮기고, 철수하면 처음으로 */
  C.buildSettle(s, 'lab7'); const w = C.settleWork(s, 'lab7'); assert.ok(w > 0);
  const back = C.deserialize(C.serialize(s), 0); assert.equal(C.settleCount(back), 5); assert.equal(C.settleLv(back, 'farm'), 3); s.settleLv.farm = 3; assert.equal(C.settleWork(back, 'lab7'), w); assert.equal(back.camp.flag, 'lab7');
  const old = JSON.parse(C.serialize(s)); delete old.camp; delete old.settleLv; old.build = { id: 'lab7', left: 300 }; const mig = C.deserialize(JSON.stringify(old), 0); assert.ok(C.settleHas(mig, 'lab7')); assert.equal(C.settleLv(mig, 'farm'), 1); assert.equal(mig.build, null);
  for (const junk of [null, 5, 'x', { work: 'x', broken: 3, flag: 'zzz', clock: -1, nightLv: 1e9, night: 'x' }, { work: { farm: -5, mess: 1e99, zzz: 4 }, broken: { farm: 1, store: 1 } }]) { const raw = JSON.parse(C.serialize(s)); raw.camp = junk; raw.settleLv = junk; const z = C.deserialize(JSON.stringify(raw), 0); assert.doesNotThrow(() => { C.stepCamp(z, 0.5, calm, []); C.buildSettle(z, 'lab7'); C.sendGuard(z); C.mods(z); }); assert.ok(C.settleFree(z) >= 0 && C.settleLv(z, 'farm') >= 1 && !C.settleBroken(z, 'store')); }
  s.runEarned = 1e40; s.pendingPerks = []; s.perkOwed = 0; const fresh2 = C.retreat(s, 0, () => 0.5).state; assert.equal(C.settleCount(fresh2), 0); assert.equal(fresh2.build, null); assert.deepEqual(fresh2.camp.work, {});
});

test('7구역 습격: 화면을 보고 있을 때만 온다. 무리는 세 쪽에 나뉘어 붙고 몰리는 쪽이 바뀐다. 쪽마다 사람을 세워 막는다', () => {
  const s = inCamp(), c = C.campOf(s), cost = (id) => C.SETTLE.find((d) => d.id === id).cost; s.survivors = 5e6; fill7(s, 'farm'); const ev = [];
  assert.equal(C.sendGuard(s).reason, 'day'); assert.equal(C.sendGuard(inLab()).reason, 'locked');
  c.hand = 999; c.clock = C.RAID_EVERY - 0.2; C.stepCamp(s, 1, calm, ev); assert.equal(c.night, null, '보고 있지 않으면 오지 않는다');
  C.campSeen(s); assert.equal(c.hand, 0); C.stepCamp(s, 1, calm, ev); const nv = ev.find((e) => e.type === 'camp-night'); assert.ok(nv && c.night && c.night.need === nv.need && nv.need >= 5);
  const n = c.night; near(n.w[0] + n.w[1] + n.w[2], 1); assert.ok(n.w[n.side] >= 0.59); near(C.nightHold(s), 0);
  const free0 = C.settleFree(s), pool0 = C.guardPool(s), g = C.sendGuard(s, n.side); assert.ok(g.ok && g.side === n.side && g.sent > 0 && g.moved === -1); assert.equal(C.settleFree(s), free0, '4.2.4: 지키는 사람은 짓는 사람과 따로 센다'); assert.equal(C.guardPool(s), pool0 - g.sent); assert.equal(pool0, Math.floor(s.survivors), '모든 사람이 나선다');
  for (let i = 0; i < 3; i++) while (C.sendGuard(s, i).ok) {} assert.equal(C.sendGuard(s, 0).reason, 'full'); near(C.nightHold(s), 1); assert.equal(n.guards, n.g[0] + n.g[1] + n.g[2]);
  /* 몰리는 쪽이 바뀐다: 옮기지 않으면 그쪽이 깎인다. 문 앞에 사람이 없으면 남는 쪽에서 옮겨 온다 */
  const ev2 = []; let r2 = lcg(5); for (let i = 0; i < 30 && !ev2.some((e) => e.type === 'camp-shift'); i++) { C.campSeen(s); C.stepCamp(s, 0.25, r2, ev2); }
  const sh = ev2.find((e) => e.type === 'camp-shift'); assert.ok(sh && sh.side === n.side); assert.ok(C.sideHold(s, n.side) < 1, '새로 몰린 쪽은 모자란다');
  const sv0 = s.survivors; s.survivors = n.guards; assert.equal(C.guardPool(s), 0); const mv = C.sendGuard(s, n.side); assert.ok(mv.ok && mv.moved >= 0 && mv.moved !== n.side, '남는 쪽에서 옮긴다'); s.survivors = sv0;
  for (let k = 0; k < 20; k++) for (let i = 0; i < 3; i++) C.sendGuard(s, i);
  const sv = s.survivors; for (let i = 0; i < 200 && c.night; i++) { C.campSeen(s); for (let q = 0; q < 3; q++) C.sendGuard(s, q); C.stepCamp(s, 0.25, r2, ev); }
  const hv = ev.find((e) => e.type === 'camp-held'); assert.ok(hv && hv.gain > 0 && hv.lv === 1); assert.ok(s.survivors > sv - 1); assert.equal(c.nightLv, 1); assert.equal(s.nightsHeld, 1); assert.equal(c.night, null);
  /* 아무도 세우지 않으면 뚫린다: 건물이 부서져 효과가 없고, 고치면 돌아온다 */
  const p1 = C.mods(s).prod; c.nightLv = 5; c.clock = C.RAID_EVERY; C.campSeen(s); C.stepCamp(s, 0.25, calm, ev); assert.ok(c.night); const ev3 = []; for (let i = 0; i < 300 && c.night; i++) { C.campSeen(s); C.stepCamp(s, 0.25, calm, ev3); }
  const bv = ev3.find((e) => e.type === 'camp-breach'); assert.ok(bv && bv.id === 'farm'); assert.ok(C.settleBroken(s, 'farm')); assert.equal(c.nightLv, 5 - C.NIGHT_DROP); assert.ok(C.mods(s).prod < p1, '부서진 동안에는 효과가 없다'); assert.equal(s.campBreaches, 1);
  assert.equal(C.settleNeed(s, 'farm'), Math.ceil(cost('farm') * C.REPAIR_FRAC)); const rp = fill7(s, 'farm'); assert.ok(rp.done && rp.repaired && rp.lv === 1); assert.ok(!C.settleBroken(s, 'farm')); near(C.mods(s).prod, p1);
  /* 경비대와 망루는 거들지만 다 막아 주지는 않는다. 지키다 잃는 사람은 울타리가 깎인 만큼 */
  s.survivors = 1e12; fill7(s, 'guard7'); c.night = C.newRaid(s, calm); near(C.towerHold(s), C.TOWER_HOLD.guard7); c.broken.guard7 = true; near(C.towerHold(s), 0); delete c.broken.guard7; s.settleLv.guard7 = 10; s.settleLv.watch = 10; s.settle.watch = true; assert.ok(C.towerHold(s) <= C.TOWER_HOLD_MAX && C.towerHold(s) > 0.45, '10단계여도 다 막아 주지는 않는다'); s.settleLv.guard7 = 1; delete s.settle.watch; delete s.settleLv.watch;
  c.night = C.newRaid(s, calm); for (let i = 0; i < 3; i++) while (C.sendGuard(s, i).ok) {} c.night.fences = [0.5, 1, 1]; c.night.t = 0.1; const s1 = s.survivors, ev4 = []; C.stepCamp(s, 0.2, calm, ev4); const h4 = ev4.find((e) => e.type === 'camp-held'); assert.ok(h4 && h4.lost === 0 && s.survivors > s1, '지키다 잃는 사람은 없다');
  /* 세워야 하는 수는 모인 사람 전체의 몫이다: 낮에 얼마를 지었든 같고, 단계가 오르면 는다. 자리를 비운 동안에는 오지 않는다 */
  const hz = inCamp(); hz.survivors = 5e6; const need0 = C.raidNeed(hz); assert.equal(need0, Math.ceil(5e6 * C.NIGHT_FRAC)); fill7(hz, 'farm'); assert.equal(C.raidNeed(hz), need0, '지어도 같다'); hz.campRows.arms = 3; assert.ok(C.raidNeed(hz) < need0); hz.campRows.arms = 0;
  hz.camp.nightLv = 8; assert.ok(C.raidNeed(hz) > need0 * 1.1); hz.camp.nightLv = 200; assert.ok(C.raidNeed(hz) <= 5e6 * C.NIGHT_CAP + 1, '상한');
  // 4.3.8: 어떤 단계 · 무장 · 경비대 · 망루여도 세 쪽을 한꺼번에 다 채울 수는 없고(옮겨야 한다), 몰린 모양 하나는 늘 막을 수 있다
  for (const lv of [0, 5, 30, 200]) for (const arms of [0, 3, 10]) for (const tl of [0, 4, 10]) {
    const q = inCamp(); q.survivors = 1e8; q.camp.nightLv = lv; q.campRows.arms = arms; if (tl) { fill7(q, 'guard7'); q.settleLv.guard7 = tl; q.settle.watch = true; q.settleLv.watch = tl; }
    const T = C.raidTight(q), eff = C.raidNeed(q) * (1 - C.towerHold(q)) / q.survivors;
    assert.ok(T >= C.NIGHT_FLOOR - 1e-9 && T <= C.NIGHT_CAP + 1e-9, 'T ' + T); assert.ok(Math.abs(eff - T) < 0.01, '세울 수가 T 에 맞는다'); assert.ok(1.8 * T > 1, '다 채울 수 없다'); assert.ok(T <= 1, '막을 수는 있다');
  }
  /* 4.3.2 운영 줄 셋(수레 · 방벽 · 무기고)과 다시 채운 개조 */
  hz.camp.broken.farm = true; const rp0 = C.settleNeed(hz, 'farm'); hz.upgrades.medkit = 4; assert.ok(C.settleNeed(hz, 'farm') < rp0, '구급낭'); delete hz.camp.broken.farm; hz.upgrades.medkit = 0;
  const l2 = C.settleNeed(hz, 'farm'); hz.upgrades.blueprint = 4; near(C.settleNeed(hz, 'farm'), Math.ceil(l2 * Math.pow(0.95, 4)), '설계도'); const z1 = inCamp(); z1.upgrades.blueprint = 8; assert.equal(C.settleNeed(z1, 'farm'), C.SETTLE.find((d) => d.id === 'farm').cost, '1단계 값은 그대로(혈청의 문턱)');
  const rw = inCamp(); rw.supplies = 1e80; assert.equal(C.CAMP_ROWS.length, 3); assert.equal(C.buyCampRow(rw, 'nope').reason, 'unknown'); assert.equal(C.buyCampRow(inLab(), 'cart').reason, 'locked');
  const c0 = C.campRowCost(rw, 'cart'); assert.ok(C.buyCampRow(rw, 'cart').ok); assert.equal(C.campRow(rw, 'cart'), 1); assert.ok(C.campRowCost(rw, 'cart') > c0); near(C.mods(rw).wagon, 1 + C.CART_STEP);
  let nb = 0; while (C.buyCampRow(rw, 'wall7').ok) nb++; assert.equal(nb, 8); assert.equal(C.campRowCost(rw, 'wall7'), Infinity); near(C.mods(rw).fence, 1 + C.WALL7_STEP * 8);
  const mg = JSON.parse(C.serialize(rw)); delete mg.campRows; mg.upgrades.palisade = 3; mg.upgrades.muster = 99; const mb = C.deserialize(JSON.stringify(mg), 0); assert.equal(C.campRow(mb, 'wall7'), 3, '옛 개조는 줄로 옮긴다'); assert.equal(C.campRow(mb, 'arms'), 8);
  for (const junk of [null, 5, 'x', { cart: -3, wall7: 1e9, arms: 'x' }]) { const raw = JSON.parse(C.serialize(rw)); raw.campRows = junk; const z = C.deserialize(JSON.stringify(raw), 0); assert.ok(C.campRow(z, 'cart') >= 0 && C.campRow(z, 'wall7') <= 8 && isFinite(C.mods(z).muster)); }
  const sp = inCamp(), sc7 = C.campOf(sp); sp.upgrades.litter = 4; sp.upgrades.speaker = 5; const rs = lcg(8); while (!(sc7.strays || []).length) { C.campSeen(sp); C.stepCamp(sp, 0.25, rs, []); } assert.ok(sc7.strays[0].t0 > C.STRAY_TIME * 1.9, '들것: 더 오래 기다린다');
  const a = inCamp(); a.survivors = 5e6; fill7(a, 'farm'); C.campOf(a).clock = C.RAID_EVERY - 1; C.campSeen(a); C.stepCamp(a, 600, calm, []); assert.equal(a.camp.night, null); assert.equal(a.campBreaches || 0, 0);
});

test('7구역 울타리 밖의 사람들: 보고 있으면 나타나고, 시간 안에 누르면 들어온다. 못 누르면 사라진다', () => {
  const s = inCamp(), c = C.campOf(s), ev = []; c.hand = 999; for (let i = 0; i < 80; i++) C.stepCamp(s, 0.25, lcg(2), ev); assert.equal((c.strays || []).length, 0, '보고 있지 않으면 나타나지 않는다');
  const r = lcg(3); for (let i = 0; i < 400; i++) { C.campSeen(s); C.stepCamp(s, 0.25, r, ev); assert.ok(c.strays.length <= C.STRAY_MAX); }
  assert.ok(ev.some((e) => e.type === 'stray-in')); assert.ok(ev.some((e) => e.type === 'stray-lost'), '못 누르면 사라진다');
  while (!c.strays.length) { C.campSeen(s); C.stepCamp(s, 0.25, r, ev); } const st = c.strays[0], sv = s.survivors; assert.ok(st.side >= 0 && st.side <= 2 && st.u > 0 && st.u < 1 && st.t > 0);
  const g = C.rescueStray(s, st.id); assert.ok(g.ok && g.gain > 0); near(s.survivors - sv, C.strayGain(s)); assert.equal(s.straysRun, 1); assert.equal(C.rescueStray(s, st.id).reason, 'gone'); assert.equal(C.rescueStray(inLab(), 1).reason, 'locked');
  c.nightLv = 10; near(C.strayGain(s), C.survivorRate(s) * C.STRAY_PAY * 2); C.stepCamp(s, 600, calm, []); assert.equal(c.strays.length, 0, '자리를 비우면 없어진다');
  for (const junk of [NaN, 'x', null, -1, {}]) assert.doesNotThrow(() => C.rescueStray(s, junk));
  const b = C.deserialize(C.serialize(s), 0); assert.doesNotThrow(() => { C.campSeen(b); C.stepCamp(b, 0.5, calm, []); });
});

test('7구역 이장: 깃발을 꽂아 둔 자리로 알아서 보낸다. 밤에는 울타리를 절반까지만 채운다. 가만히 둠 < 이장 < 손', () => {
  const s = inCamp(); s.survivors = 1e7; s.upgrades.elder = 1; assert.ok(C.elderOn(s)); const c = C.campOf(s); c.hand = 999;
  assert.equal(C.elderTarget(s), 'farm', '깃발이 없으면 가장 덜 드는 자리'); c.flag = 'clinic'; const ev = [];
  for (let i = 0; i < 40; i++) C.stepCamp(s, 1, calm, ev); assert.ok(C.settleHas(s, 'clinic')); assert.ok(ev.some((e) => e.type === 'settle-done' && e.id === 'clinic' && e.auto)); assert.equal(c.hand >= 40, true, '이장이 보낸 것은 손으로 치지 않는다');
  assert.ok(ev.some((e) => e.type === 'camp-send' && e.id && e.auto), '이장이 보낸 것을 화면에 알린다');
  C.setAutoEvents(s, 6, false); assert.ok(C.elderOn(s), '송신 기사 스위치와 이장은 따로다'); C.setAutoEvents(s, 6, true);
  assert.ok(C.setElder(s, false).ok); const w0 = C.settleUsed(s); for (let i = 0; i < 10; i++) C.stepCamp(s, 1, calm, []); assert.equal(C.settleUsed(s), w0, '이장을 끄면 쉰다');
  const eo = C.deserialize(C.serialize(s), 0); assert.equal(C.elderOn(eo), false, '꺼 둔 것은 저장된다'); C.setElder(s, true); assert.ok(C.elderOn(s)); assert.equal(C.setElder(inCamp(), true).ok, false, '이장이 없으면 못 켠다');
  const old = JSON.parse(C.serialize(s)); delete old.elderOff; old.autoOff = { 6: true }; assert.equal(C.elderOn(C.deserialize(JSON.stringify(old), 0)), false, '옛 저장: 7구역 자동을 꺼 두었으면 이장도 꺼 둔다');
  c.night = C.newRaid(s, calm); c.night.shift = 99; c.night.t = 99; for (let i = 0; i < 14; i++) C.stepCamp(s, 1, calm, []); assert.ok(c.night && c.night.guards > 0 && C.nightHold(s) >= 0.5 && C.nightHold(s) < 0.95, '다는 못 채운다: ' + C.nightHold(s)); c.night = null;
  const away = inCamp(); away.survivors = 1e7; away.upgrades.elder = 1; C.campOf(away).flag = 'farm'; C.stepCamp(away, 3600, calm, []); assert.ok(C.settleLevels(away) >= 2, '자리를 비운 동안에도 보낸다');
  const idle = inCamp(); idle.survivors = 1e7; C.stepCamp(idle, 3600, calm, []); assert.equal(C.settleLevels(idle), 0);
  for (const junk of [NaN, -5, 'x', undefined, 1e99]) assert.doesNotThrow(() => C.stepCamp(inCamp(), junk, calm, []));
});

test('3.1.0 7구역 주파수: 바늘이 띠 안에 있을 때 맞추면 먼 무리가 온다', () => {
  const s = inLab(); s.zone = 6; s.antennas = 10; s.zevIn = { rail: 1e6, guard: 1e6, tower: 1e6 };
  assert.equal(C.tuneNow(inLab(), () => 0.5).reason, 'locked');
  const idle = inLab(); idle.zone = 6; assert.equal(C.tuneNow(idle, () => 0.5).reason, 'idle');
  // 바늘은 끝에서 끝으로 오간다
  s.tune.t = 0; near(C.tunePos(s), 0); s.tune.t = C.TUNE_PERIOD; near(C.tunePos(s), 1); s.tune.t = C.TUNE_PERIOD * 1.5; near(C.tunePos(s), 0.5);
  // 띠 안: 맞는다
  s.tune.band = 0.5; const p0 = s.survivors, gain = C.tuneGain(s);
  near(gain, C.survivorRate(s) * C.TUNE_GAIN_SECONDS);
  const hit = C.tuneNow(s, () => 0.5); assert.ok(hit.ok && hit.hit); near(s.survivors - p0, gain); near(s.tune.cool, C.TUNE_COOL); assert.equal(s.tuneHits, 1);
  assert.equal(C.tuneNow(s, () => 0.5).reason, 'cooldown');
  // 띠 밖: 빗나가고 짧게 쉰다
  s.tune.cool = 0; s.tune.t = 0; s.tune.band = 0.8; const p1 = s.survivors;
  const miss = C.tuneNow(s, () => 0.5); assert.ok(miss.ok && !miss.hit); assert.equal(s.survivors, p1); near(s.tune.cool, C.TUNE_MISS_COOL);
  // 시간이 흐르면 바늘이 움직이고 쉬는 시간이 준다. 송신 기사가 없으면 알아서 맞추지 않는다
  const t0 = s.tune.t; const ev = C.tick(s, 1, () => 0.5); assert.ok(s.tune.t !== t0); near(s.tune.cool, C.TUNE_MISS_COOL - 1); assert.ok(!ev.some(e => e.type === 'tune'));
  // 송신 기사: 쉴 때마다 절반
  s.upgrades.autotower = 1; s.tune.cool = 0; const p2 = s.survivors, r = C.survivorRate(s);
  const ev2 = C.tick(s, 1, () => 0.5).filter(e => e.type === 'tune'); assert.equal(ev2.length, 1); assert.ok(ev2[0].auto);
  near(s.survivors - p2, r * 1 + C.tuneGain(s) * C.TUNE_AUTO);
  // 저장
  const back = C.deserialize(C.serialize(s), 0); near(back.tune.band, s.tune.band); near(back.tune.cool, s.tune.cool);
  const bad = JSON.parse(C.serialize(s)); bad.tune = { t: 'x', band: 9, cool: -5 }; const fixed = C.deserialize(JSON.stringify(bad), 0);
  assert.ok(fixed.tune.band <= 0.85 && fixed.tune.cool === 0 && fixed.tune.t === 0);
});

test('3구역: 열기 전에는 판도 줄도 없다', () => {
  const s = inMarket();
  assert.equal(C.lineRate(s), 0); assert.equal(C.buyMachine(s, 'paint', 1).reason, 'locked'); assert.equal(C.mergeBox(s, 0).reason, 'locked');
  assert.equal(C.machineCost(s, 'paint', 1), Infinity); assert.equal(C.maxMachines(s, 'paint'), 0);
  C.stepBoard(s, 60, half, []); assert.equal(C.boardSum(s), 0);
});

test('3구역 줄 셋: 투입구는 더 자주, 단조기는 한 단계 높게(판의 상자도 오른다), 도장 라인은 값', () => {
  assert.deepEqual(C.MACHINES.map(d => d.id), ['feed', 'forge', 'paint']);
  const s = onBoard([1, 1, 2]); s.supplies = 1e40;
  near(C.feedSeconds(s), C.FEED_SECONDS); assert.ok(C.buyMachine(s, 'feed', 2).ok); near(C.feedSeconds(s), C.FEED_SECONDS * C.FEED_STEP * C.FEED_STEP);
  // 도장 라인: 1단계 상자 하나의 값이 (1 + 레벨) × 2배 구간
  const u0 = C.lineInfo(s).unit; near(u0, C.productValue(s)); near(C.lineRate(s), u0 * (1 + 1 + C.BOX_STEP));
  assert.ok(C.buyMachine(s, 'paint', 9).ok); near(C.lineInfo(s).unit, u0 * 10); assert.equal(C.lineInfo(s).nextMilestone, C.LINE_MILESTONES[0]);
  assert.ok(C.buyMachine(s, 'paint', 1).ok); near(C.lineInfo(s).unit, u0 * 11 * 2, '10레벨에서 2배');
  // 단조기: 들어오는 단계 +1, 판의 상자도 모두 +1 → 수입 3배
  const r0 = C.lineRate(s); s.boxBest = 2; s.contract = { who: 'bike', level: 3, need: 2, have: 0, left: 50 };
  assert.equal(C.spawnLevel(s), 1); assert.ok(C.buyMachine(s, 'forge', 1).ok); assert.equal(C.spawnLevel(s), 2);
  assert.deepEqual(s.board.slice(0, 4), [2, 2, 3, 0]); near(C.lineRate(s), r0 * C.BOX_STEP); assert.equal(s.boxBest, 3); assert.equal(s.contract.level, 4, '의뢰가 찾는 단계도 따라 오른다');
  // 값은 줄마다 다르게 오르고, 끝이 있다
  const t = inFactory(); near(C.machineCost(t, 'forge', 2), C.MACHINES[1].baseCost * (1 + C.MACHINES[1].growth));
  t.upgrades.manual = 1; near(C.machineCost(t, 'paint', 1), C.MACHINES[2].baseCost * 0.96);
  t.machines.forge = C.MACHINES[1].max; assert.equal(C.machineCost(t, 'forge', 1), Infinity); t.supplies = 1e300; assert.equal(C.buyMachine(t, 'forge', 1).ok, false);
  assert.equal(C.buyMachine(t, 'ghost', 1).reason, 'unknown'); for (const junk of [0, -1, NaN, 'x']) assert.equal(C.buyMachine(t, 'paint', junk).ok, false);
  assert.ok(C.machineGain(t, 'paint') > 0); near(C.machineGain(inFactory(), 'forge'), C.BOX_STEP - 1); assert.equal(C.machineGain(t, 'forge'), 0);
  // 봇의 '값에 견줘 가장 이득인 줄 사기'
  const b = inFactory(); b.supplies = 1e13; const r = C.tuneLine(b, 5); assert.ok(r.ok); assert.equal(r.bought, 5); assert.equal(C.machineLevels(b), 5);
  for (const junk of [NaN, -3, 'x', undefined, 1e99]) { const u = inFactory(); u.supplies = 1e13; assert.doesNotThrow(() => C.tuneLine(u, junk)); }
});

test('3구역 판: 상자 하나를 누르면 같은 단계의 짝이 모두 합쳐지고, 합쳐질 때마다 덤을 받는다', () => {
  assert.equal(C.boxWorth(1), 1); near(C.boxWorth(3), C.BOX_STEP * C.BOX_STEP); for (const junk of [0, -1, NaN, 'x', C.BOX_MAX + 1, undefined]) assert.equal(C.boxWorth(junk), 0);
  const s = onBoard([1, 0, 1, 2, 3, 1, 1, 1]);      // 1단계가 다섯: 두 짝이 합쳐지고 하나가 남는다
  assert.deepEqual(C.mergeable(s), [0, 2, 5, 6, 7]);
  const rate0 = C.lineRate(s), sup0 = s.supplies, r = C.mergeBox(s, 2);
  assert.ok(r.ok); assert.equal(r.level, 2); assert.equal(r.count, 2); assert.equal(r.merges.length, 2); assert.equal(r.merges[0].at, 2, '누른 칸에 첫 결과가 남는다');
  assert.equal(s.board.filter(x => x === 1).length, 1); assert.equal(s.board.filter(x => x === 2).length, 3); assert.equal(s.board[2], 2);
  near(r.gain, 2 * C.boxRate(s, 2) * C.MERGE_SECONDS); near(s.supplies - sup0, r.gain); assert.equal(s.mergesRun, 2); assert.ok(C.lineRate(s) > rate0, '합치면 언제나 더 번다');
  // 윗단계끼리 또 짝이 맞아도 이어서 합치지는 않는다: 다음에 누를 거리다
  assert.equal(s.board.filter(x => x === 3).length, 1); const r2 = C.mergeBox(s, 3); assert.equal(r2.count, 1); assert.equal(r2.level, 3); assert.equal(s.board.filter(x => x === 3).length, 2);
  assert.ok(C.mergeBox(s, 4).best, '처음 만든 단계'); assert.equal(s.boxBest, 4);
  // 안 되는 경우
  const a = onBoard([4, 0, 2]); assert.equal(C.mergeBox(a, 0).reason, 'alone'); assert.equal(C.mergeBox(a, 1).reason, 'empty');
  for (const junk of [-1, 99, NaN, 'x', undefined]) assert.equal(C.mergeBox(a, junk).reason, 'empty');
  const top = onBoard([C.BOX_MAX, C.BOX_MAX]); assert.equal(C.mergeBox(top, 0).reason, 'alone');
  const b = onBoard([1, 1]); b.upgrades.bonus = 2; near(C.mergeBox(b, 0).gain, C.boxRate(b, 2) * C.MERGE_SECONDS * 2, '손맛: 덤이 커진다');
  const w = onBoard([]); assert.equal(C.boardSize(w), 20); w.upgrades.wide = 1; assert.equal(C.boardSize(w), 25); w.upgrades.wide = 2; assert.equal(C.boardSize(w), C.BOARD_MAX);
  const bad = onBoard([]); bad.board = 'x'; assert.equal(C.boardSum(bad), 0); assert.equal(bad.board.length, C.BOARD_MAX);
});

test('3구역 판: 상자는 간격마다 들어오고, 가득 차면 들어오지 못하고 기다린다(알아서 합쳐지지 않는다)', () => {
  const s = onBoard([]); s.feed = 1; let ev = [];
  C.stepBoard(s, 0.01, half, ev); assert.equal(s.board.filter(x => x === 1).length, 1, '첫 상자는 바로'); assert.ok(ev.some(e => e.type === 'box-in'));
  C.stepBoard(s, C.FEED_SECONDS * 2, half, []); assert.equal(s.board.filter(x => x === 1).length, 3);
  assert.ok(s.board.slice(C.boardSize(s)).every(x => x === 0), '칸 수 밖에는 놓지 않는다');
  // 가득 찬 판: 아무 일도 없다. 손으로 자리를 내면 다시 들어온다
  const full = onBoard(Array(20).fill(1)); full.feed = 1; assert.equal(C.boardFull(full), true);
  C.stepBoard(full, 600, half, []); assert.equal(full.mergesAll, 0); assert.equal(full.board.slice(0, 20).filter(x => x === 1).length, 20); assert.equal(full.feed, 1, '다음 상자는 문 앞에서 기다린다');
  const r = C.mergeBox(full, 0); assert.equal(r.count, 10); assert.equal(C.boardFull(full), false);
  C.stepBoard(full, 0.01, half, []); assert.equal(full.board.filter(x => x === 1).length, 1, '자리가 나면 바로 들어온다');
  // 가만히 둔 판은 가득 찬 뒤로 더 자라지 않는다(그래도 번다)
  const idle = onBoard([]); idle.feed = 1; for (let t = 0; t < 600; t++) C.stepBoard(idle, 1, half, []);
  assert.equal(C.boardSum(idle), 20); assert.ok(C.lineRate(idle) > 0);
  const lucky = onBoard([]); lucky.feed = 1; lucky.upgrades.lucky = 5; C.stepBoard(lucky, 0.01, () => 0.01, []); assert.equal(Math.max(...lucky.board), 2, '행운 상자');
  for (const junk of [NaN, -5, 'x', undefined, 1e99]) assert.doesNotThrow(() => C.stepBoard(onBoard([1, 1]), junk, half, []));
});

test('3구역 자동 합치기: 몇 초마다 가장 많이 쌓인 상자를 모두 합친다(3.8.4). 가만히 둔 판 < 자동 < 손', () => {
  // 3.8.9: 조립공은 판이 거의 찼을 때(빈칸 5칸 이하)만 일한다. packed 는 서로 다른 높은 상자로 나머지를 채워 빈칸을 5칸만 남긴다
  const packed = (lv) => { const s = onBoard(lv); for (let i = lv.length, k = 0; i < 15; i++, k++) s.board[i] = 20 + k; return s; }, low = (s) => s.board.filter(x => x && x < 20);
  const roomy = onBoard([1, 1, 1, 1]); roomy.upgrades.autoline = 1; C.stepBoard(roomy, C.AUTO_MERGE_SECONDS * 3, half, []); assert.equal(roomy.mergesAll, 0, '판이 비어 있으면 쉰다'); assert.ok(roomy.autoMerge >= 1, '막대는 찬 채로 기다린다');
  const a = packed([1, 1, 1, 1, 2, 2]); a.upgrades.autoline = 1; let ev = [];
  C.stepBoard(a, C.AUTO_MERGE_SECONDS, half, ev);
  assert.equal(ev.filter(e => e.type === 'box-merge' && e.auto).length, 2, '손으로 누를 때처럼 같은 상자를 모두 합친다'); assert.equal(a.mergesRun, 0); assert.deepEqual(low(a), [2, 2, 2, 2], '한 번에 한 단계만: 윗단계 짝은 다음 박자에'); assert.equal(a.runEarned, 0, '자동은 덤을 받지 못한다');
  const many = packed([1, 1, 5, 5, 5, 5, 5]); many.upgrades.autoline = 1; C.stepBoard(many, C.AUTO_MERGE_SECONDS, half, []); assert.deepEqual(low(many).sort(), [1, 1, 5, 6, 6], '가장 많이 쌓인 단계부터');
  const sw = onBoard([1, 1, 1, 1]); sw.upgrades.autoline = 1; C.setAutoEvents(sw, 2, false); C.stepBoard(sw, C.AUTO_MERGE_SECONDS * 3, half, []); assert.equal(sw.mergesAll, 0, '구역 자동을 끄면 자동 합치기도 쉰다');
  const h = packed([1, 1, 3, 3]); h.upgrades.autoline = 1; h.contract = { who: 'bike', level: 1, need: 2, have: 2, left: 50 };
  C.stepBoard(h, C.AUTO_MERGE_SECONDS, half, []); assert.deepEqual(h.board.slice(0, 4).filter(x => x), [1, 1, 4], '의뢰가 찾는 단계는 건드리지 않는다');
  // 가득 찬 판에서도 자동이 자리를 내서 상자가 계속 들어온다
  const f = onBoard(Array(20).fill(1)); f.feed = 1; f.upgrades.autoline = 1; C.stepBoard(f, C.AUTO_MERGE_SECONDS, half, []); assert.equal(f.mergesAll, 10); assert.ok(f.board.filter(x => x === 1).length >= 1, '낸 자리에 새 상자가 들어왔다');
  // 30분 뒤
  const mk3 = (auto) => { const s = onBoard([]); s.feed = 1; s.upgrades.autoline = auto ? 1 : 0; return s; };
  const idle = mk3(false), auto = mk3(true), hand = mk3(false); let seed = 9; const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let t = 0; t < 1800; t++) { C.stepBoard(idle, 1, rng, []); C.stepBoard(auto, 1, rng, []); C.stepBoard(hand, 1, rng, []); for (let m = C.mergeable(hand), g = 0; m.length && g < 50; m = C.mergeable(hand), g++) C.mergeBox(hand, m[0]); }
  assert.ok(C.boardSum(auto) > C.boardSum(idle) * 10, '자동 ' + C.boardSum(auto) + ' / 가만히 ' + C.boardSum(idle)); assert.ok(C.boardSum(hand) > C.boardSum(auto));
  // 긴 자리 비움: 자동이 있으면 그동안 자라고, 없으면 가득 찬 채로 있다
  const away = mk3(true); C.stepBoard(away, 8 * 3600, rng, null, 30000); assert.ok(C.boardSum(away) > 1000);
  const stay = mk3(false); C.stepBoard(stay, 8 * 3600, rng, null, 30000); assert.equal(C.boardSum(stay), 20);
});

test('3구역 납품 의뢰: 찾는 단계의 상자를 모아 두었다가 넘기면 크게 받는다. 놓쳐도 잃는 것은 없다', () => {
  const s = onBoard([1, 1, 2]); s.contractIn = 0; let ev = [];
  C.stepContracts(s, 1, 0, () => 0, ev);
  const c = s.contract; assert.ok(c); assert.equal(c.level, C.spawnLevel(s) + 1); assert.equal(c.need, 2); assert.equal(c.left, C.CONTRACT_SECONDS); assert.equal(c.have, 1);
  assert.ok(ev.some(e => e.type === 'contract' && e.itemName === C.boxName(2))); assert.equal(C.heldLevel(s), 2);
  for (let i = 0; i < 30; i++) { const t = onBoard([1]); t.contractIn = 0; C.stepContracts(t, 1, 0, lcg(i + 1), []); assert.ok(t.contract.level >= 2 && t.contract.level <= 4); assert.ok(t.contract.need === 2 || t.contract.need === 3); }
  assert.equal(C.fillContract(s).reason, 'short');
  C.mergeBox(s, 0); assert.equal(C.contractHave(s), 2);
  const sup = s.supplies, treats = s.treats, want = C.contractReward(s); near(want, 2 * C.boxRate(s, 2) * C.CONTRACT_PAY_SECONDS);
  const r = C.fillContract(s);
  assert.ok(r.ok); near(s.supplies - sup, want); assert.equal(s.treats - treats, C.CONTRACT_TREATS); assert.ok(r.first); assert.equal(s.contractsRun, 1); assert.equal(s.contract, null);
  assert.equal(C.boardSum(s), 0, '넘긴 상자는 판에서 나간다'); near(C.contractMult(s), 1 + C.CONTRACT_BONUS);
  assert.equal(C.fillContract(s).reason, 'none');
  const g = onBoard([1]); g.contract = { who: 'bike', level: 5, need: 2, have: 0, left: 1 }; ev = []; C.stepContracts(g, 2, 0, half, ev); assert.equal(g.contract, null); assert.ok(ev.some(e => e.type === 'contract-gone'));
  const a = onBoard([3, 3]); a.upgrades.autoline = 1; a.contract = { who: 'bike', level: 3, need: 2, have: 0, left: 50 }; ev = []; C.stepContracts(a, 1, 0, half, ev);
  const af = ev.find(e => e.type === 'contract-filled'); assert.ok(af && af.auto, '자동 합치기가 있으면 다 모인 의뢰를 알아서 넘긴다'); assert.equal(a.contract, null);
  const hand2 = onBoard([3, 3]); hand2.contract = { who: 'bike', level: 3, need: 2, have: 0, left: 50 }; near(af.gain, C.contractReward(hand2) * C.AUTO_SHARE, '지금 있는 구역에서는 절반만: 손이 낫다');
  const past = inStation(); past.board = Array(C.BOARD_MAX).fill(0); past.board[0] = 3; past.board[1] = 3; past.upgrades.autoline = 1; past.contract = { who: 'bike', level: 3, need: 2, have: 0, left: 50 }; const full2 = C.contractReward(past); ev = []; C.stepContracts(past, 1, 0, half, ev); near(ev.find(e => e.type === 'contract-filled').gain, full2, '지나온 구역에서는 온전히');
  const off2 = onBoard([3, 3]); off2.upgrades.autoline = 1; C.setAutoEvents(off2, 2, false); off2.contract = { who: 'bike', level: 3, need: 2, have: 0, left: 50 }; C.stepContracts(off2, 1, 0, half, []); assert.ok(off2.contract, '구역 자동을 끄면 손을 기다린다');
  // 자동 합치기 간격: 개조 5레벨 + 특성 자동화로 1초까지
  const sp = onBoard([]); sp.upgrades.autoline = 1; assert.equal(C.autoMergeSeconds(sp), 5); sp.upgrades.autoline = 5; assert.equal(C.autoMergeSeconds(sp), 2); sp.traits.auto = C.ASSIST_MAX; near(C.autoMergeSeconds(sp), 1);
  const e = onBoard([]); e.contractIn = 0; C.stepContracts(e, 1, 0, half, []); assert.equal(e.contract, null, '판이 비어 있으면 의뢰가 오지 않는다');
});

test('3구역: 저장 · 옛 저장 옮기기 · 자리 비움 · 철수 · 없앤 것', () => {
  const s = onBoard([4, 4, 2]); s.feed = 0.5; s.mergesRun = 7; s.boxBest = 4; s.machines = { feed: 3, forge: 1, paint: 12 }; s.contract = { who: 'bike', level: 4, need: 2, have: 2, left: 33 };
  const back = C.deserialize(C.serialize(s), 0);
  assert.deepEqual(back.board, s.board); assert.equal(back.feed, 0.5); assert.equal(back.mergesRun, 7); assert.deepEqual(back.machines, s.machines); assert.deepEqual(back.contract, s.contract);
  const raw = JSON.parse(C.serialize(s)); raw.board = [99, -3, 'x', 2.7, null]; raw.feed = 'x'; raw.machines = { feed: 1e9, forge: -2, paint: 'x', sorter: 5 }; raw.contract = { who: 'bike', need: 300, have: 10, left: 20 };
  const fixed = C.deserialize(JSON.stringify(raw), 0);
  assert.equal(fixed.board.length, C.BOARD_MAX); assert.ok(fixed.board.every(x => Number.isInteger(x) && x >= 0 && x <= C.BOX_MAX)); assert.equal(fixed.feed, 1);
  assert.deepEqual(fixed.machines, { feed: 30, forge: 0, paint: 0 }); assert.equal(fixed.contract, null, '단계가 없는 옛 의뢰는 버린다');
  // 3.5.0 이전 저장: 옛 기계와 없앤 개조에 쓴 물자만큼 새 줄을 사 준다
  const old = JSON.parse(C.serialize(inFactory())); delete old.lineV; delete old.board; old.machines = { sorter: 40, press: 40, assembler: 40 }; old.upgrades.lube = 6; old.upgrades.belt = 2; old.supplies = 123;
  const moved = C.deserialize(JSON.stringify(old), 0);
  assert.ok(moved.machines.paint > 20, JSON.stringify(moved.machines)); assert.ok(moved.machines.feed >= 1); assert.equal(moved.supplies, 123, '가진 물자는 그대로'); assert.equal(moved.upgrades.lube, undefined);
  assert.ok(C.boardSum(moved) > 0, '판에 상자 몇 개를 놓아 준다'); assert.ok(C.lineRate(moved) > 0);
  assert.deepEqual(C.deserialize(C.serialize(moved), 0).machines, moved.machines, '한 번 옮긴 저장은 다시 옮기지 않는다');
  const low = JSON.parse(C.serialize(onBoard([1, 2, 9]))); low.machines = { feed: 0, forge: 3, paint: 0 }; assert.deepEqual(C.deserialize(JSON.stringify(low), 0).board.slice(0, 3), [4, 4, 9], '들어오는 단계보다 낮은 상자는 올려 준다');
  const early = JSON.parse(C.serialize(inMarket())); delete early.lineV; delete early.board; assert.equal(C.boardSum(C.deserialize(JSON.stringify(early), 0)), 0);
  const away = onBoard([9]); away.feed = 0; away.defenses.rail = 1e5;
  const rate = C.lineRate(away); C.applyOffline(away, 3000); near(away.lineEarned, rate * 3000 * C.OFFLINE_RATE); assert.ok(C.boardSum(away) > C.boxWorth(9), '그동안 상자가 들어온다');
  away.runEarned = 1e40; away.pendingPerks = []; const next = C.retreat(away, 1).state; assert.equal(C.boardSum(next), 0); assert.equal(next.mergesRun, 0); assert.equal(next.machines.paint, 0);
  const g = onBoard([1]); for (const f of [C.setRecipe, C.surge, C.repairJam, C.loadTruck, C.rebalanceLine]) assert.equal(f(g, 'x').reason, 'gone');
});

/* ---------- 3.7.0 4구역 승강장(구역 전체) ---------- */
test('4구역 판: 화물칸이 간격마다 붙고, 길수록 한 칸의 값이 뛴다. 꽉 차면 더 싣지 못하고 서 있다', () => {
  const s = onPlatform();
  assert.equal(C.trainInfo(s).cars, 0); assert.equal(C.trainInfo(s).max, C.CAR_BASE); assert.equal(C.sendTrain(s).reason, 'empty');
  C.stepRail(s, C.CAR_SECONDS * 3, [], calm);
  let i = C.trainInfo(s); assert.equal(i.cars, 3); near(i.mult, 1.2); near(i.near, 1 - C.CAR_SECONDS * 3 / C.HORDE_SECONDS);
  near(i.bank, C.railRate(s) * C.CAR_SECONDS * 3); near(i.gain, i.bank * i.mult / C.CAR_NORM);
  assert.equal(C.carMult(0), 0); assert.equal(C.carMult(1), 1); near(C.carMult(C.AUTO_CARS), C.CAR_NORM); assert.equal(C.carMult(12), 3); assert.ok(C.carMult(10) - C.carMult(9) > C.carMult(8) - C.carMult(7), '8칸을 넘기면 크게 뛴다');
  for (const junk of [NaN, -1, 'x', undefined]) assert.equal(C.carMult(junk), 0); assert.equal(C.carMult(99), C.carMult(C.CAR_MAX));
  const sup = s.supplies, r = C.sendTrain(s);
  assert.ok(r.ok); assert.equal(r.kept, 3); near(s.supplies - sup, i.gain); assert.equal(C.trainInfo(s).cars, 0); assert.equal(s.plat.bank, 0); assert.equal(s.plat.pos, 1); assert.equal(s.trainsSent, 1);
  assert.equal(C.sendTrain(inFactory()).reason, 'locked'); assert.equal(C.sendTrain(inStation()).reason, 'stopped');
  // 꽉 찬 열차: 알아서 떠나지 않고, 더 싣지도 못한다
  const f = onPlatform(); f.upgrades.fence = 5; C.stepRail(f, C.CAR_SECONDS * C.CAR_BASE, [], calm);
  assert.ok(C.trainInfo(f).full); assert.equal(f.trainsSent, 0); const bank = f.plat.bank; C.stepRail(f, 5, [], calm); assert.equal(f.plat.bank, bank); assert.equal(f.trainsSent, 0);
  const u = onPlatform(); u.upgrades.longplat = 1; assert.equal(C.carMax(u), 10); u.upgrades.longplat = 2; assert.equal(C.carMax(u), C.CAR_MAX);
  const cs = C.carSeconds(u); u.routes.crew = 2; near(C.carSeconds(u), cs * C.CREW_STEP * C.CREW_STEP, '연결 작업반: 칸이 빨리 붙는다');
  const a = onPlatform(), b = onPlatform(); b.upgrades.fence = 5; C.stepRail(a, 10, [], calm); C.stepRail(b, 10, [], calm); assert.ok(b.plat.pos > a.plat.pos, '철조망: 무리가 느리다');
});

test('4구역 무리: 닿으면 뒤쪽 절반을 떼고 떠난다. 가끔 달려든다. 그 직전에 손으로 보내는 쪽이 훨씬 낫다', () => {
  const cut = onPlatform(); let ev = [];
  C.stepRail(cut, C.HORDE_SECONDS + 1, ev, calm);
  const h = ev.find(e => e.type === 'train'); assert.ok(h); assert.equal(h.why, 'horde'); assert.equal(h.cars, C.CAR_BASE); assert.equal(h.kept, C.CAR_BASE / 2); assert.equal(cut.hordeHits, 1); assert.equal(cut.longRuns, 0);
  near(h.gain, C.railRate(cut) * C.CAR_SECONDS * C.CAR_BASE * 0.5 * C.carMult(4) / C.CAR_NORM, '8칸에서 멈춘 화물의 절반 × 4칸 배수');
  const hand = onPlatform(); C.stepRail(hand, C.HORDE_SECONDS - 2, [], calm); assert.ok(C.sendTrain(hand).gain > h.gain * 2);
  // 3.8.6 돌진: 칸이 붙은 열차에 온다. 예고 → 닿을 때까지 달려온다. 경적이 끊는다. 열차 한 대에 한 번
  const early = onPlatform(); ev = []; C.stepRail(early, 1, ev, () => 0.001); assert.ok(!ev.some(e => e.type === 'horde-sprint'), '잃을 칸이 없으면 오지 않는다');
  const quiet = onPlatform(); quiet.plat.t = C.CAR_SECONDS * 3; ev = []; for (let i = 0; i < 30; i++) C.stepRail(quiet, 0.1, ev, () => 0.001); assert.ok(!ev.some(e => e.type === 'horde-sprint'), '손대지 않은 열차에는 오지 않는다(3.9.1)');
  const ru = onPlatform(); ru.plat.t = C.CAR_SECONDS * 3; ru.plat.bank = 9; C.pullCar(ru); assert.equal(ru.plat.hand, 1); ev = []; C.stepRail(ru, 0.1, ev, () => 0.001);
  assert.ok(ev.some(e => e.type === 'horde-sprint')); assert.equal(C.trainInfo(ru).rush, 'warn'); const p0 = ru.plat.pos;
  for (let i = 0; i < 10; i++) C.stepRail(ru, 0.1, ev, calm); assert.ok(ru.plat.pos > p0 - 0.05, '예고 동안은 달려오지 않는다');
  for (let i = 0; i < 10; i++) C.stepRail(ru, 0.1, ev, calm); assert.equal(C.trainInfo(ru).rush, 'run'); assert.ok(ru.plat.pos < p0 - 0.2, 'pos ' + ru.plat.pos);
  assert.ok(C.deserialize(C.serialize(ru), 0).plat.rush > 0);
  const stop = JSON.parse(JSON.stringify(ru)), hr = C.blowHorn(stop); assert.ok(hr.ok && hr.broke); assert.equal(stop.plat.rush, -1); assert.equal(C.trainInfo(stop).rush, '');
  const p1 = stop.plat.pos; for (let i = 0; i < 20; i++) C.stepRail(stop, 0.1, ev, () => 0.001); assert.ok(stop.plat.pos > p1 - 0.05, '끊긴 돌진은 다시 오지 않는다'); assert.equal(ev.filter(e => e.type === 'horde-sprint').length, 1);
  for (let i = 0; i < 30; i++) C.stepRail(ru, 0.1, ev, calm); assert.equal(ru.hordeHits || 0, 0, '멀리서 온 돌진은 닿지 않는다(3.9.2)'); assert.equal(ru.plat.rush, -1); assert.ok(Math.abs((p0 - ru.plat.pos) - C.HORDE_RUSH_DIST) < 0.12, '거리의 45%쯤 다가온다: ' + (p0 - ru.plat.pos));
  const close = onPlatform(); close.plat.t = C.CAR_SECONDS * 3; close.plat.bank = 9; close.plat.pos = 0.3; close.plat.rush = C.HORDE_RUSH_DIST; close.plat.warn = 0; C.stepRail(close, 1, [], calm); assert.equal(close.hordeHits, 1, '이미 가까울 때의 돌진은 닿는다');
  // 굴림에 따라 닿는 때가 달라진다(정확히 알 수 없다)
  const when = (seed) => { const z = onPlatform(), r = lcg(seed); for (let t = 1; t < 400; t++) { C.stepRail(z, 1, [], r); if (z.hordeHits) return t; } return 400; };
  const times = [1, 2, 3, 4, 5, 6, 7, 8].map(when); assert.ok(Math.max(...times) - Math.min(...times) >= 4, times.join(',')); assert.ok(times.every(t => t > 8 && t < 200), times.join(','));
});

test('4구역 역무원: 꽉 차면, 또는 무리가 가까워지면 보낸다. 돌진은 못 끊는다. 가만히 둔 것 < 역무원 < 손', () => {
  const s = onPlatform(); s.upgrades.autosig = 1; s.upgrades.fence = 5; let ev = [];
  const sup = s.supplies; C.stepRail(s, C.CAR_SECONDS * C.CAR_BASE, ev, calm);
  const a = ev.find(e => e.type === 'train'); assert.equal(a.why, 'auto'); assert.equal(a.kept, C.CAR_BASE, '꽉 차면 보낸다'); near(s.supplies - sup, C.railRate(s) * C.CAR_SECONDS * C.CAR_BASE * C.carMult(C.CAR_BASE) / C.CAR_NORM);
  const e = onPlatform(); e.upgrades.autosig = 1; e.plat.pos = C.AUTO_NEAR + 0.01; e.plat.t = 11; e.plat.bank = 5; ev = []; C.stepRail(e, 2, ev, calm);
  const b = ev.find(x => x.type === 'train'); assert.equal(b.why, 'auto'); assert.equal(b.kept, 2, '무리가 가까워지면 그 전에 보낸다');
  const off = onPlatform(); off.upgrades.autosig = 1; off.upgrades.fence = 5; C.setAutoEvents(off, 3, false); ev = []; C.stepRail(off, C.CAR_SECONDS * C.CAR_BASE + 1, ev, calm); assert.ok(!ev.some(x => x.type === 'train'), '구역 자동을 끄면 손을 기다린다');
  const run = (up, policy, seed) => { const z = onPlatform(); Object.assign(z.upgrades, up); const r = lcg(seed), rate = C.railRate(z), e0 = z.railEarned; for (let t = 0; t < 7200; t++) { C.stepRail(z, 1, [], r); if (policy) { C.pullCar(z); C.pullCar(z); } let i = C.trainInfo(z); if (policy && i.rush && i.horn > 0) { C.blowHorn(z); i = C.trainInfo(z); } if (policy && i.cars >= 1 && (i.rush || policy(i))) C.sendTrain(z); }      /* 손: 돌진은 경적으로 끊고, 경적이 없으면 바로 보낸다 */ return { speed: (z.railEarned - e0) / 7200 / rate, hits: z.hordeHits, long: z.longRuns }; };
  const idle = run({}, null, 5), auto = run({ autosig: 1 }, null, 5), hand = run({ longplat: 2 }, (i) => i.full || i.near < 0.25, 5);
  assert.ok(idle.speed < auto.speed * 0.6, '가만히 ' + idle.speed.toFixed(2) + ' / 역무원 ' + auto.speed.toFixed(2)); 
  const autoLong = run({ autosig: 1, longplat: 2 }, null, 5);
  assert.ok(hand.speed > autoLong.speed, '손 ' + hand.speed.toFixed(2) + ' / 역무원 ' + autoLong.speed.toFixed(2)); assert.ok(hand.long > autoLong.long, '손이 긴 열차를 더 자주 보낸다');
  // 3.9.2 역무원과 돌진: 경고가 도는 동안은 보내지 않는다(손으로 경적을 울릴 틈). 그 뒤에는 평소대로, 가까워지면 온전히 보낸다
  const w = onPlatform(); w.upgrades.autosig = 1; w.plat.t = C.CAR_SECONDS * 6; w.plat.bank = 9; w.plat.pos = 0.5; w.plat.rush = C.HORDE_RUSH_DIST; w.plat.warn = C.HORDE_WARN; ev = [];
  C.stepRail(w, C.HORDE_WARN - 0.2, ev, calm); assert.ok(!ev.some(x => x.type === 'train'), '경고 동안은 보내지 않는다');
  for (let i = 0; i < 10 && !ev.some(x => x.type === 'train'); i++) C.stepRail(w, 0.1, ev, calm); const sent = ev.find(x => x.type === 'train'); assert.equal(sent.why, 'auto'); assert.equal(sent.kept, 6, '떼이지 않는다');
});

test('4구역: 긴 시간 · 이상한 값 · 저장 · 자리 비움 · 철수 · 목표', () => {
  const s = onPlatform(); s.upgrades.autosig = 1; const sup = s.supplies;
  C.stepRail(s, 3600, [], calm); assert.ok(s.supplies > sup); assert.ok(s.trainsSent >= 10);
  const big = onPlatform(); assert.doesNotThrow(() => C.stepRail(big, 1e7, [], calm)); assert.ok(isFinite(big.supplies));
  for (const junk of [NaN, -5, 'x', undefined, 0]) { const j = onPlatform(); C.stepRail(j, junk, [], calm); assert.equal(j.plat.t, 0); }
  const p = onPlatform(); C.stepRail(p, 17, [], calm); p.trainsSent = 9; p.longRuns = 2; p.hordeHits = 1;
  const back = C.deserialize(C.serialize(p), 0); assert.deepEqual(back.plat, p.plat); assert.equal(back.trainsSent, 9); assert.equal(back.longRuns, 2); assert.equal(back.hordeHits, 1);
  const raw = JSON.parse(C.serialize(p)); raw.plat = { t: 'x', bank: -5, pos: 7 }; const fixed = C.deserialize(JSON.stringify(raw), 0);
  assert.deepEqual(fixed.plat, { t: 0, bank: 0, pos: 1, horn: 0, rush: 0, warn: 0, hand: 0 }); delete raw.plat; assert.equal(C.deserialize(JSON.stringify(raw), 0).plat.pos, 1);
  raw.plat = { t: 20, bank: 9, horde: 52 }; assert.equal(C.deserialize(JSON.stringify(raw), 0).plat.pos, 1, '3.4.0 의 저장(닿는 시간)은 무리를 멀리서 다시 오게 한다');
  const away = onPlatform(); away.defenses.rail = 1e5; const rate = C.railRate(away), before = away.railEarned; C.applyOffline(away, 1000);
  near(away.railEarned - before, rate * 1000 * C.OFFLINE_RATE, '자리를 비운 동안은 역무원이 보낸 것으로 친다'); assert.equal(away.plat.t, 0);
  assert.equal(C.greenSignal(onPlatform()).reason, 'gone');
  const g = onPlatform(); g.upgrades.longplat = 1; g.upgrades.fence = 5; C.stepRail(g, C.CAR_SECONDS * 10, [], calm); assert.equal(C.trainInfo(g).cars, 10); C.sendTrain(g); assert.equal(g.longRuns, 1); assert.equal(g.expressRuns, 0);
  assert.equal(C.goals(g, 3)[1].text, '10칸 이상 열차 3번 보내기');
  away.runEarned = 1e40; away.pendingPerks = []; const next = C.retreat(away, 1).state; assert.equal(next.trainsSent, 0); assert.equal(next.longRuns, 0); assert.equal(next.plat.pos, 1);
});

test('4구역 줄 셋(3.8.0): 기관차는 한 칸의 값, 화물 등급은 레벨마다 2배, 연결 작업반은 칸을 빨리 붙인다', () => {
  assert.deepEqual(C.ROUTES.map(d => d.id), ['grade', 'crew']);
  const s = onPlatform();
  assert.equal(C.railUnits(s), 4 * C.GRADE_STEP); near(C.railRate(s), C.railUnits(s) * C.RAIL_SCALE * C.cargoValue(s));
  const r0 = C.railRate(s); s.trains = 5; near(C.railRate(s), r0 * 5 / 4);
  const r1 = C.railRate(s); s.routes.grade = 2; near(C.railRate(s), r1 * C.GRADE_STEP);
  const none = inStation(); none.routes.grade = 5; assert.equal(C.railRate(none), 0, '기관차가 없으면 열차가 서지 않는다');
  assert.equal(C.railRate(inFactory()), 0);
  // 값: 줄마다 다르게 오르고 끝이 있다. 정비창이 깎아 준다
  const b = inStation(); b.supplies = 1e40; near(C.routeCost(b, 'grade'), C.ROUTES[0].baseCost); assert.ok(C.buyRoute(b, 'grade').ok); near(C.routeCost(b, 'grade'), C.ROUTES[0].baseCost * C.ROUTES[0].growth);
  b.upgrades.yard = 1; near(C.routeCost(b, 'crew'), C.ROUTES[1].baseCost * 0.96);
  b.routes.grade = C.ROUTES[0].max; assert.equal(C.routeCost(b, 'grade'), Infinity); assert.equal(C.buyRoute(b, 'grade').ok, false); assert.equal(C.buyRoute(b, 'loop').reason, 'unknown');
});

test('4구역 손이 할 일(3.8.0): 그림을 눌러 칸을 당기고, 경적으로 무리를 밀어낸다', () => {
  const s = onPlatform();
  const r = C.pullCar(s); assert.ok(r.ok); near(s.plat.t, C.PULL_SECONDS); assert.equal(s.plat.bank, 0, '화물은 흐른 시간만큼만 실린다'); assert.equal(s.pullsRun, 1);
  for (let i = 0; i < 400; i++) C.pullCar(s);
  assert.ok(C.trainInfo(s).full); assert.equal(C.pullCar(s).reason, 'full'); assert.equal(C.pullCar(inFactory()).reason, 'locked'); assert.equal(C.pullCar(inStation()).reason, 'stopped');
  // 당기면 같은 시간에 더 긴 열차가 된다 → 한꺼번에 받는 것이 커진다
  const a = onPlatform(), b = onPlatform(); C.stepRail(a, 20, [], calm); C.stepRail(b, 20, [], calm); for (let i = 0; i < 24; i++) C.pullCar(b);
  assert.equal(C.trainInfo(a).cars, 4); assert.ok(C.trainInfo(b).cars > 4); assert.ok(C.trainInfo(b).gain > C.trainInfo(a).gain);
  // 경적: 열차 하나에 한 번(개조로 세 번까지). 무리를 밀어낸다. 새 열차가 서면 다시 쓸 수 있다
  const h = onPlatform(); C.stepRail(h, 20, [], calm); const pos = h.plat.pos; assert.equal(C.trainInfo(h).horn, 1);
  const hr = C.blowHorn(h); assert.ok(hr.ok); near(h.plat.pos, pos + C.HORN_PUSH); assert.equal(C.trainInfo(h).horn, 0); assert.equal(C.blowHorn(h).reason, 'empty');
  C.sendTrain(h); assert.equal(C.trainInfo(h).horn, 1);
  h.upgrades.horn = 2; assert.equal(C.hornMax(h), 3);
  const far = onPlatform(); C.blowHorn(far); assert.equal(far.plat.pos, 1, '1보다 멀어지지는 않는다');
  assert.equal(C.blowHorn(inFactory()).reason, 'locked');
  // 튼튼한 연결기: 떼일 때 3분의 1만
  const c = onPlatform(); c.upgrades.coupler = 1; const ev = []; C.stepRail(c, C.HORDE_SECONDS + 1, ev, calm); const t = ev.find(e => e.type === 'train'); assert.equal(t.why, 'horde'); assert.equal(t.kept, Math.ceil(C.CAR_BASE * 2 / 3));
  // 저장
  h.pullsRun = 7; h.hornsRun = 3; C.blowHorn(h); const back = C.deserialize(C.serialize(h), 0); assert.equal(back.plat.horn, 1); assert.equal(back.pullsRun, 7); assert.equal(back.hornsRun, 4);
});

test('4구역 옛 저장(3.8.0): 노선 넷과 없앤 개조에 쓴 물자만큼 화물 등급과 연결 작업반을 사 준다', () => {
  const old = JSON.parse(C.serialize(inStation())); delete old.railV; old.trains = 30; old.routes = { loop: 16, river: 13, outer: 10, express: 7 }; old.upgrades.signal = 20; old.upgrades.timetable = 8; old.supplies = 77;
  const m = C.deserialize(JSON.stringify(old), 0);
  assert.equal(m.trains, 30); assert.equal(m.supplies, 77); assert.ok(m.routes.grade >= 3, JSON.stringify(m.routes)); assert.ok(m.routes.crew >= 1); assert.equal(m.routes['loop'], undefined); assert.equal(m.upgrades.signal, undefined);
  assert.ok(C.railRate(m) > 0); assert.deepEqual(C.deserialize(C.serialize(m), 0).routes, m.routes, '한 번 옮긴 저장은 다시 옮기지 않는다');
  const fresh4 = JSON.parse(C.serialize(inStation())); delete fresh4.railV; fresh4.routes = {}; assert.deepEqual(C.deserialize(JSON.stringify(fresh4), 0).routes, { grade: 0, crew: 0 });
});

test('4구역: 열기 전에는 열차도 줄도 없다. 기관차를 사면 값이 오른다', () => {
  const f = inFactory();
  assert.equal(C.buyTrain(f, 1).reason, 'locked'); assert.equal(C.buyRoute(f, 'grade').reason, 'locked'); assert.equal(C.trainCost(f, 1), Infinity); assert.equal(C.routeCost(f, 'grade'), Infinity); assert.equal(C.maxTrains(f), 0);
  f.trains = 5; f.routes.grade = 3; assert.equal(C.railRate(f), 0); f.defenses.rail = 1e9; f.signalIn = 1e9; assert.ok(!C.tick(f, 100, half).some(e => e.type === 'train'));
  const s = inStation(), t1 = C.trainCost(s, 1);
  s.supplies = t1 * 0.99; assert.equal(C.buyTrain(s, 1).reason, 'supplies'); s.supplies = t1; assert.ok(C.buyTrain(s, 1).ok); assert.equal(s.trains, 1);
  assert.equal(C.trainCost(s, 1), Math.ceil(t1 * C.TRAIN_GROWTH)); assert.equal(C.buyTrain(s, 0).reason, 'unknown');
  s.upgrades.yard = 1; assert.equal(C.trainCost(s, 1), Math.ceil(t1 * C.TRAIN_GROWTH * 0.96));
  s.trains = C.TRAIN_MAX; s.supplies = 1e300; assert.equal(C.buyTrain(s, 1).reason, 'max');
});

/* ---------- 4.0.3 5구역 여섯 대(구역 전체) ---------- */
function onWard(n) { const s = inLab(); s.staff = 10; s.racks = (n || 4) - 4; s.defenses.rail = 1e9; s.signalIn = 1e9; const w = C.wardOf(s); w.seats = w.seats.map(() => ({ m: 0, dose: 0, r: 1, look: 1, since: 0 })); w.stock = 0; w.make = 0; w.arrive = 0; return s; }

test('5구역 병실: 한 대면 멈추고 한 대의 값을, 여섯 대째에 되돌아와 열두 대의 값을 받는다', () => {
  const s = onWard(4), w = C.wardOf(s), v = C.doseValue(s);
  assert.equal(C.seatCount(s), 4); near(v, C.labRate(s) * C.SERUM_SECONDS);
  assert.equal(C.injectSeat(s, 0).reason, 'nostock');
  w.stock = 6; const sup = s.supplies, pts = s.points;
  const a = C.injectSeat(s, 0); assert.ok(a.ok && a.stop && !a.cure); near(a.gain, v); near(s.supplies - sup, v); assert.equal(s.stopsRun, 1); assert.equal(w.stock, 5);
  for (let i = 2; i <= 5; i++) { const r = C.injectSeat(s, 0); assert.equal(r.dose, i); assert.equal(r.gain, 0, '사이의 대는 받는 것이 없다'); }
  w.stock = 1; const c = C.injectSeat(s, 0); assert.ok(c.cure); near(c.gain, v * (C.WARD_CURE - 1)); near(s.supplies - sup, v * C.WARD_CURE, '모두 합쳐 열두 대의 값'); assert.equal(s.curesRun, 1); assert.equal(s.dosesRun, 6);
  assert.ok(!(w.seats[0].dose >= 0), '되돌아온 사람은 자리를 비운다');
  assert.equal(C.injectSeat(s, 0).reason, 'empty');
  // 멈춘 사람은 줄이 더 차지 않고, 시간이 지나도 저절로 떠나지 않는다(4.0.6)
  const t = onWard(4); C.wardOf(t).stock = 3; C.injectSeat(t, 1); C.stepWard(t, 3, calm, []); assert.equal(t.ward.seats[1].m, 0); assert.ok(t.ward.seats[0].m > 0.1); assert.equal(t.ward.seats[1].dose, 1, '그대로 앉아 있다');
  // 새 사람이 왔는데 빈 의자가 없으면, 한 대만 맞고 가장 오래 앉아 있던 사람이 자리를 내 준다. 되돌리는 중인 사람(두 대 이상)은 내 주지 않는다
  C.injectSeat(t, 2); C.injectSeat(t, 2); t.ward.seats[0].m = 0.1; t.ward.seats[3].m = 0.1; t.ward.arrive = 0.99; const ev2 = []; C.stepWard(t, 0.25, calm, ev2);
  assert.ok(ev2.some((e) => e.type === 'ward-out' && e.at === 1)); assert.equal(t.ward.seats[1].dose, 0, '새 사람이 앉았다'); assert.equal(t.ward.seats[2].dose, 2);
  const full = onWard(4); full.ward.arrive = 0.99; C.stepWard(full, 0.5, calm, []); assert.equal(full.ward.arrive, 1, '내 줄 자리가 없으면 문 앞에서 기다린다');
  const emp = onWard(4); emp.ward.seats[2] = { wait: 0 }; emp.ward.arrive = 0.99; C.stepWard(emp, 0.25, calm, []); assert.equal(emp.ward.seats[2].dose, 0, '빈 의자가 있으면 거기 앉는다');
  // 안 되는 경우
  assert.equal(C.injectSeat(inStation(), 0).reason, 'locked'); assert.equal(C.injectSeat(inLab(), 0).reason, 'stopped');
  for (const junk of [-1, 99, NaN, 'x', undefined]) { const z = onWard(4); C.wardOf(z).stock = 3; assert.equal(C.injectSeat(z, junk).reason, 'empty'); }
  for (const junk of [NaN, -5, 'x', undefined, 1e99]) assert.doesNotThrow(() => C.stepWard(onWard(4), junk, calm, []));
});

test('5구역 냉장 상자: 두드리면 혈청이 만들어진다. 쌓아 둘 수 있는 만큼만', () => {
  const s = onWard(4), w = C.wardOf(s), need = Math.ceil(1 / C.SERUM_TAP);
  for (let i = 0; i < need - 1; i++) assert.equal(C.tapSerum(s).made, 0);
  assert.equal(C.tapSerum(s).made, 1); assert.equal(w.stock, 1); assert.equal(s.serumTaps, need);
  w.stock = C.serumCap(s); assert.equal(C.tapSerum(s).reason, 'full');
  s.upgrades.cooler = 2; assert.equal(C.serumCap(s), C.SERUM_CAP + 2 * C.SERUM_CAP_STEP, '개조 냉장 상자'); assert.ok(C.tapSerum(s).ok);
  const d = onWard(4), t0 = C.turnSeconds(d); d.upgrades.sterile = 2; near(C.turnSeconds(d), t0 * 1.3, '개조 진정제');
  assert.equal(C.tapSerum(inStation()).reason, 'locked'); assert.equal(C.tapSerum(inLab()).reason, 'stopped');
});

test('5구역: 한 대도 못 맞으면 변한다. 변한 사람이 달려들어 혈청을 깨뜨리고 잠깐 손을 쓸 수 없다', () => {
  const s = onWard(4), w = C.wardOf(s); w.stock = 5; w.seats[2].m = 0.99; const ev = [];
  C.stepWard(s, 0.5, calm, ev);
  const tv = ev.find((e) => e.type === 'ward-turned'); assert.ok(tv); assert.equal(tv.at, 2); assert.equal(tv.broke, C.TURN_BREAK); assert.equal(w.stock, 5 - C.TURN_BREAK); assert.equal(s.turnedRun, 1);
  assert.ok(w.stun > 0); assert.equal(C.injectSeat(s, 0).reason, 'stun'); assert.equal(C.tapSerum(s).reason, 'stun');
  C.stepWard(s, C.TURN_STUN + 0.1, calm, []); assert.equal(w.stun, 0); assert.ok(C.injectSeat(s, 0).ok, '조금 뒤에는 다시 쓸 수 있다');
  const e = onWard(4); e.ward.seats[0].m = 0.99; C.stepWard(e, 0.5, calm, []); assert.equal(e.ward.stock, 0, '없는 혈청은 깨지지 않는다');
});

test('5구역 자동은 둘: 연구 조교는 혈청을 만들고, 간호사는 급한 사람을 멈춘다. 가만히 둠 < 둘 다 < 손', () => {
  const a = onWard(4); a.upgrades.autolab = 1; C.stepWard(a, C.SERUM_SECONDS + 0.1, calm, []); assert.equal(a.ward.stock, 1, '조교: 혈청 한 대'); assert.equal(a.stopsRun || 0, 0, '조교는 놓지 않는다');
  const n = onWard(4); n.upgrades.nurse = 1; assert.ok(C.autoOn(n, 4), '간호사만 있어도 자동이 켜진 것으로 본다'); n.ward.stock = 2; n.ward.seats[1].m = 0.75; n.ward.seats[3].m = 0.2; const ev = [];
  C.stepWard(n, C.NURSE_SECONDS + 0.1, calm, ev); const nv = ev.find((e) => e.type === 'ward-nurse'); assert.ok(nv && nv.at === 1 && nv.stop, '가장 급한 사람'); assert.equal(n.dosesRun || 0, 0, '손으로 놓은 횟수에 안 든다');
  assert.equal(n.ward.seats[3].dose, 0, '아직 덜 급한 사람은 두고 혈청을 남긴다'); assert.equal(n.ward.stock, 1);
  const off = onWard(4); off.upgrades.autolab = 1; off.upgrades.nurse = 1; C.setAutoEvents(off, 4, false); C.stepWard(off, C.SERUM_SECONDS * 2, calm, []); assert.equal(off.ward.stock, 0, '구역 자동을 끄면 둘 다 쉰다');
  const run = (up, tps, seed) => { const z = onWard(4); Object.assign(z.upgrades, up); const r = lcg(seed), rate = C.labRate(z); let acc = 0;
    for (let t = 0; t < 18000; t++) { C.stepWard(z, 0.1, r, []); acc += tps * 0.1; while (acc >= 1) { acc -= 1; const w = C.wardOf(z); let did = false;
      if (w.stock >= 1) { let urgent = -1, focus = -1; w.seats.forEach((p, i) => { if (p.dose === 0 && p.m > 0.7 && (urgent < 0 || p.m > w.seats[urgent].m)) urgent = i; if (p.dose >= 1 && (focus < 0 || p.dose > w.seats[focus].dose)) focus = i; });
        const pick = urgent >= 0 ? urgent : focus >= 0 ? focus : w.seats.findIndex((p) => p.dose === 0); if (pick >= 0) did = C.injectSeat(z, pick).ok; }
      if (!did) C.tapSerum(z); } } return { rate: z.labEarned / 1800 / rate, cures: z.curesRun || 0 }; };
  const idle = run({}, 0, 3), one = run({ autolab: 1 }, 0, 3), both = run({ autolab: 1, nurse: 1 }, 0, 3), hand = run({ autolab: 1, nurse: 1 }, 2, 3);
  assert.equal(idle.rate, 0); assert.equal(one.rate, 0, '하나만으로는 돌지 않는다'); assert.ok(both.rate > 0.8 && both.rate < 1.1, '둘 다 ' + both.rate.toFixed(2)); assert.equal(both.cures, 0, '자동은 되돌리지 못한다');
  assert.ok(hand.rate > both.rate * 1.8 && hand.cures > 50, '손 ' + hand.rate.toFixed(2) + ' / ' + hand.cures);
});

test('5구역 줄 · 연구 성과 · 저장 · 옛 저장 옮기기 · 자리 비움 · 철수 · 목표', () => {
  const s = onWard(4); s.supplies = 1e60; const r0 = C.labRate(s), p0 = C.researchRate(s);
  assert.ok(C.buyRack(s).ok); assert.equal(C.seatCount(s), 5); assert.equal(C.wardOf(s).seats.length, 5); near(C.labRate(s), r0 * 5 / 4); near(C.researchRate(s), p0 * 5 / 4);
  const r1 = C.labRate(s); assert.ok(C.buyReagent(s).ok); near(C.labRate(s), r1 * C.REAGENT_STEP);
  for (let i = 0; i < 20; i++) C.buyRack(s); assert.equal(C.seatCount(s), C.SEAT_MAX); assert.equal(C.rackCost(s), Infinity);
  // 4.0.6: 되돌려도 서류는 찾지 않는다
  const f = onWard(4), fw = C.wardOf(f); fw.stock = 6; fw.seats[0].dose = 5; const cr = C.injectSeat(f, 0, false, () => 0.1); assert.ok(cr.cure); assert.equal(cr.record, undefined); assert.equal(f.recordsRun, 0); assert.equal(f.dosesAll, 1);
  // 저장
  const v = onWard(6); v.reagent = 2; v.ward.stock = 3; v.ward.make = 0.4; v.ward.seats[1] = { m: 0.5, dose: 3, r: 1.1, look: 7, since: 4 }; v.ward.seats[2] = { wait: 0 }; v.curesRun = 4; v.stopsRun = 9; v.turnedRun = 1;
  const back = C.deserialize(C.serialize(v), 0); assert.deepEqual(back.ward.seats, v.ward.seats); assert.equal(back.ward.stock, 3); assert.equal(back.curesRun, 4); assert.equal(back.racks, 2);
  const raw = JSON.parse(C.serialize(v)); raw.ward = { seats: [{ m: 'x', dose: 99, r: 9 }, null, 7], stock: -4, make: 9 }; raw.racks = 1e9;
  const fixed = C.deserialize(JSON.stringify(raw), 0); assert.equal(fixed.racks, C.SEAT_MAX - C.SEAT_BASE); assert.equal(fixed.ward.stock, 0); assert.equal(fixed.ward.seats[0].dose, C.WARD_DOSES - 1); assert.equal(C.wardOf(fixed).seats.length, C.SEAT_MAX);
  // 옛 저장(시험관 시절): 시험관 수는 의자로, 남는 것은 시약 등급으로. 연구 조교가 있었으면 간호사도
  const old = JSON.parse(C.serialize(onWard(4))); old.labV = 2; delete old.ward; old.tubes = [{ t: 3, age: 3, r: 1 }]; old.racks = 8; old.reagent = 1; old.upgrades.autolab = 1; old.upgrades.cooler = 2;
  const m = C.deserialize(JSON.stringify(old), 0); assert.equal(m.racks, C.SEAT_MAX - C.SEAT_BASE); assert.equal(m.reagent, 1 + Math.ceil((8 - (C.SEAT_MAX - C.SEAT_BASE)) / 2)); assert.equal(m.upgrades.nurse, 1); assert.equal(m.upgrades.cooler, 2); assert.equal(m.tubes, undefined);
  const again = C.deserialize(C.serialize(m), 0); assert.equal(again.reagent, m.reagent, '한 번 옮긴 저장은 다시 옮기지 않는다');
  // 자리 비움: 조교와 간호사가 다 있으면 초당 그대로
  const away = onWard(4); away.defenses.rail = 1e5; away.upgrades.autolab = 1; away.upgrades.nurse = 1; const rate = C.labRate(away), sup = away.supplies; C.applyOffline(away, 1000); assert.ok(away.supplies - sup >= rate * 1000 * C.OFFLINE_RATE * 0.999);
  // 목표 · 철수
  assert.equal(C.goals(s, 4)[2].text, '사람 20명 되돌리기');
  away.runEarned = 1e40; away.pendingPerks = []; const next = C.retreat(away, 1).state; assert.equal(next.racks, 0); assert.equal(next.curesRun, 0); assert.equal(next.staff, 0);
});

/* 4.0.8 5구역: 급한 환자 · 회진 차트 · 강화 혈청 */
test('5구역 급한 환자: 손을 쓰고 있을 때만 오고, 여섯 대를 다 놓아야 산다. 살리면 둘 가운데 하나를 고른다', () => {
  const s = onWard(4), w = C.wardOf(s), ev = [];
  w.erNext = 1; w.hand = 999; C.stepWard(s, 2, calm, ev); assert.equal(w.er, null, '손을 안 쓰고 있으면 오지 않는다');
  w.stock = 6; assert.ok(C.tapSerum(s).reason === 'full'); w.stock = 5; C.tapSerum(s); assert.equal(w.hand, 0);
  C.stepWard(s, 2, calm, ev); assert.ok(w.er && ev.some((e) => e.type === 'ward-er'), '침대가 들어온다'); assert.equal(w.er.dose, 0);
  assert.equal(C.injectEr(onWard(4)).reason, 'empty'); assert.equal(C.injectEr(inStation()).reason, 'locked');
  w.stock = 0; assert.equal(C.injectEr(s).reason, 'nostock'); w.stock = 6;
  const before = s.supplies; let r; for (let i = 0; i < 5; i++) { r = C.injectEr(s, calm); assert.ok(r.ok && !r.cure && r.er); assert.ok(w.er.t > 0); }
  C.stepWard(s, 1, calm, ev); assert.ok(w.er, '한 대로는 멈추지 않는다: 시간이 계속 간다');
  r = C.injectEr(s, calm); assert.ok(r.cure && Array.isArray(r.pick) && r.pick.length === 2 && r.pick[0] !== r.pick[1]); assert.equal(w.er, null); assert.equal(s.savedRun, 1);
  near(s.supplies - before, C.doseValue(onWard(4)) * C.WARD_CURE, '첫 대 1 + 여섯째 대 11');
  w.erNext = 0.5; C.stepWard(s, 2, calm, ev); assert.equal(w.er, null, '고르기 전에는 다음 침대가 오지 않는다');
  assert.equal(C.pickBoon(s, 'nope').reason, 'nopick'); const id = r.pick[0], rate0 = C.labRate(s), cap0 = C.serumCap(s), turn0 = C.turnSeconds(s);
  assert.ok(C.pickBoon(s, id).ok); assert.equal(C.boonOf(s, id), 1); assert.equal(w.pick, null); assert.equal(C.pickBoon(s, id).reason, 'nopick', '한 번만');
  assert.ok(C.labRate(s) > rate0 || C.serumCap(s) > cap0 || C.turnSeconds(s) > turn0 || id === 'quick', '고른 것이 듣는다');
  /* 4.1.1 끝없이 불어나지 않는다: 고르는 것마다 상한이 있고, 다 찬 것은 내밀지 않는다. 다 차면 물자로 받는다 */
  const cap = onWard(4), cw = C.wardOf(cap); for (let i = 0; i < 60; i++) { cw.er = { t: 9, dose: 5, look: 1 }; cw.stock = 1; cw.pick = null; const rr = C.injectEr(cap, lcg(i + 1)); if (cw.pick) { assert.ok(cw.pick.every((id) => id === 'cash' || C.boonOf(cap, id) < C.BOON_BY[id].max)); C.pickBoon(cap, cw.pick[0]); } else assert.ok(rr.gain > 0); }
  C.BOONS.forEach((d) => { if (d.id !== 'cash') assert.equal(C.boonOf(cap, d.id), d.max, d.id); }); assert.equal(cw.pick, null, '다 차면 고를 것 없이 물자로');
  const cs = onWard(4); C.wardOf(cs).pick = ['cash', 'rich']; const s0 = cs.supplies; assert.ok(C.pickBoon(cs, 'cash').gain > 0); near(cs.supplies - s0, C.doseValue(cs) * C.CASH_DOSES);
  for (const d of C.BOONS) { const z = onWard(4); z.boons[d.id] = 2; assert.ok(isFinite(C.labRate(z)) && C.serumCap(z) >= C.SERUM_CAP && C.turnSeconds(z) >= C.TURN_SECONDS); }
});

test('5구역 급한 환자: 시간 안에 못 놓으면 변해 달려든다. 자리를 비운 동안에는 오지도, 벌칙을 주지도 않는다', () => {
  const s = onWard(4), w = C.wardOf(s), ev = []; w.stock = 4; w.er = { t: 0.3, dose: 3, look: 5 };
  C.stepWard(s, 0.5, calm, ev); const tv = ev.find((e) => e.type === 'ward-turned' && e.at === 'er'); assert.ok(tv); assert.equal(w.er, null); assert.equal(w.stock, 4 - C.TURN_BREAK); assert.ok(w.stun > 0); assert.equal(s.turnedRun, 1);
  const a = onWard(4); a.ward.er = { t: 5, dose: 0, look: 1 }; a.ward.stock = 3; C.stepWard(a, 600, calm, []); assert.equal(a.ward.er, null); assert.equal(a.ward.stock, 3); assert.equal(a.turnedRun || 0, 0);
  const n = onWard(4); n.upgrades.nurse = 1; n.ward.stock = 6; n.ward.er = { t: 20, dose: 0, look: 1 }; n.ward.seats.forEach((p) => { p.dose = 1; }); C.stepWard(n, 3, calm, []); assert.equal(n.ward.er.dose, 0, '간호사는 급한 환자에게 손대지 않는다');
});

test('5구역 강화 혈청: 손으로 놓은 대수만큼 차고, 한 대가 세 대 몫이다. 연구원이 많을수록 자주 온다', () => {
  const s = onWard(4), w = C.wardOf(s), need = C.mixNeed(s); assert.ok(need >= 6 && need <= 14);
  const big = onWard(4); big.staff = 60; assert.ok(C.mixNeed(big) < need || need === 6); assert.equal(C.mixNeed(Object.assign(onWard(4), { staff: 1e9 })), 6);
  assert.equal(C.boostSeat(s, 0).reason, 'noboost');
  let got = false; for (let i = 0; i < need; i++) { w.stock = 1; w.seats[0] = { m: 0, dose: i % 4, r: 1, look: 1, since: 0 }; const r = C.injectSeat(s, 0); assert.ok(r.ok); got = !!r.boost; if (i < need - 1) assert.ok(!r.boost); }
  assert.ok(got && w.boost === 1 && w.mix === 0);
  w.stock = 1; w.seats[1] = { m: 0.1, dose: 0, r: 1, look: 1, since: 0 }; C.injectSeat(s, 1, true); assert.equal(w.mix, 0, '간호사가 놓은 것은 세지 않는다');
  w.seats[2] = { m: 0.5, dose: 0, r: 1, look: 1, since: 0 }; const st = w.stock, b = C.boostSeat(s, 2); assert.ok(b.ok && b.boosted && b.stop && !b.cure); assert.equal(w.seats[2].dose, C.BOOST_DOSES); assert.equal(w.stock, st, '냉장 상자의 혈청은 쓰지 않는다'); assert.equal(w.boost, 0);
  w.boost = 1; w.seats[3] = { m: 0, dose: 4, r: 1, look: 1, since: 0 }; const c = C.boostSeat(s, 3); assert.ok(c.cure); assert.ok(!(w.seats[3].dose >= 0), '넘치는 몫은 버리고 되돌아간다');
  w.boost = 1; w.seats[3] = { wait: 0 }; assert.equal(C.boostSeat(s, 3).reason, 'empty'); assert.equal(w.boost, 1, '빈 자리를 눌러도 없어지지 않는다');
  assert.equal(C.boostSeat(s, 'er').reason, 'empty'); w.er = { t: 9, dose: 2, look: 1 }; assert.ok(C.boostSeat(s, 'er').ok); assert.equal(w.er.dose, 5);
  for (const junk of [NaN, -1, 99, 'x', null]) { w.boost = 1; assert.doesNotThrow(() => C.boostSeat(s, junk)); }
});

test('5구역 회진 차트: 세 줄을 채우면 혈청 값이 오르고 다음 차트를 고른다. 빡빡한 차트는 누가 변하면 처음부터', () => {
  const s = onWard(4), w = C.wardOf(s), ch = w.chart; assert.equal(ch.lines.length, 3); assert.ok(!ch.hard && !ch.done); assert.equal(C.nextChart(s, true).reason, 'notdone');
  ch.lines.forEach((l) => assert.ok(C.CHART_TEXT[l.k] && l.need >= 1 && l.have === 0));
  const rate0 = C.labRate(s); ch.lines.forEach((l) => { l.have = l.need; }); ch.lines[0].have = ch.lines[0].need - 1; assert.equal(ch.lines[0].k, 'stop');
  w.stock = 1; w.seats[0] = { m: 0, dose: 0, r: 1, look: 1, since: 0 }; const r = C.injectSeat(s, 0); assert.ok(r.chart && ch.done); near(C.labRate(s), rate0 * (1 + C.CHART_EASY)); assert.equal(s.chartNo, 1);
  w.stock = 1; w.seats[1] = { m: 0, dose: 0, r: 1, look: 1, since: 0 }; C.injectSeat(s, 1); near(C.labRate(s), rate0 * (1 + C.CHART_EASY), '끝난 차트는 더 오르지 않는다');
  assert.ok(C.nextChart(s, true).ok); const h = w.chart; assert.ok(h.hard && !h.done && h !== ch); h.lines[0].have = 1;
  w.seats[2] = { m: 0.99, dose: 0, r: 1, look: 1, since: 0 }; const ev = []; C.stepWard(s, 0.5, calm, ev); assert.ok(ev.find((e) => e.type === 'ward-turned').reset); assert.equal(h.lines[0].have, 0);
  h.lines.forEach((l) => { l.have = l.need; }); h.lines[2].have = h.lines[2].need - 1; w.stun = 0; w.boost = 1; w.seats[0] = { m: 0, dose: 5, r: 1, look: 1, since: 0 }; assert.equal(h.lines[2].k, 'cure');
  assert.ok(C.boostSeat(s, 0).chart); near(C.labRate(s), rate0 * (1 + C.CHART_EASY + C.CHART_HARD));
  const f = onWard(4), r0 = C.labRate(f); for (let i = 0; i < 40; i++) { const fw = C.wardOf(f); fw.chart.lines.forEach((l) => { l.have = l.need; }); fw.chart.lines[0].have--; const k = fw.chart.lines[0].k; fw.stock = 1; fw.seats[0] = { m: 0, dose: 0, r: 1, look: 1, since: 0 }; if (k === 'stop') C.injectSeat(f, 0, true); else C.injectSeat(f, 0); assert.ok(fw.chart.done, k); C.nextChart(f, true); }
  near(C.labRate(f), r0 * (1 + C.CHART_MAX), '차트로 오르는 혈청 값에는 상한이 있다'); assert.ok(C.chartFull(f)); const sup = f.supplies; { const fw = C.wardOf(f); fw.chart.lines.forEach((l) => { l.have = l.need; }); fw.chart.lines[2].have--; fw.boost = 1; fw.seats[0] = { m: 0, dose: 5, r: 1, look: 1, since: 0 }; C.boostSeat(f, 0); assert.ok(fw.chart.done && f.supplies - sup > C.doseValue(f) * 20, '상한 뒤에는 물자로 받는다'); }
  const e = onWard(4); C.nextChart(e, false); e.ward.chart.lines[0].have = 1; e.ward.seats[0].m = 0.99; C.stepWard(e, 0.5, calm, []); assert.equal(e.ward.chart.lines[0].have, 1, '가벼운 차트는 누가 변해도 그대로');
  for (let no = 0; no < 40; no++) { const z = onWard(4); z.chartNo = no; for (const hard of [false, true]) { z.ward.chart = null; C.wardOf(z); z.ward.chart.done = true; C.nextChart(z, hard); z.ward.chart.lines.forEach((l) => assert.ok(l.need >= 1 && l.need <= 60)); } }
});

test('5구역 저장: 급한 환자 · 차트 · 강화 혈청 · 고른 것을 안전하게 읽는다. 철수하면 처음부터', () => {
  const s = onWard(4), w = C.wardOf(s); w.er = { t: 9, dose: 2, look: 7 }; w.boost = 1; w.mix = 3; w.pick = ['rich', 'box']; s.boons.slow = 2; s.chartBonus = 0.4; s.chartNo = 3; w.chart.lines[0].have = 2;
  const b = C.deserialize(C.serialize(s), 0);
  assert.deepEqual(b.ward.er, { t: 9, dose: 2, look: 7 }); assert.equal(b.ward.boost, 1); assert.equal(b.ward.mix, 3); assert.deepEqual(b.ward.pick, ['rich', 'box']); assert.equal(b.boons.slow, 2); near(b.chartBonus, 0.4); assert.equal(b.chartNo, 3); assert.equal(b.ward.chart.lines[0].have, 2);
  for (const junk of [null, 5, 'x', [], { er: 'x', pick: ['rich', 'rich'], chart: { lines: [{ k: 'zzz' }, 1, null] }, mix: -4, boost: NaN, erNext: -1 }, { er: { t: 1e9, dose: 99 }, pick: [1, 2], chart: { lines: 'x' } }]) {
    const raw = JSON.parse(JSON.stringify(s)); raw.ward = junk; raw.boons = junk; raw.chartBonus = junk; raw.chartNo = junk;
    const z = C.deserialize(JSON.stringify(raw), 0); assert.doesNotThrow(() => { C.wardOf(z); C.stepWard(z, 0.5, calm, []); C.labRate(z); });
    assert.ok(z.ward.pick === null || z.ward.pick.length === 2); assert.ok(!z.ward.er || (z.ward.er.t <= C.ER_TIME && z.ward.er.dose < C.WARD_DOSES)); assert.ok(z.ward.chart.lines.length === 3 && isFinite(C.labRate(z)));
  }
  const r = C.deserialize(C.serialize(s), 0); if (C.canRetreat ? C.canRetreat(r) : false) { C.retreat(r, 0, calm); assert.equal(r.chartBonus, 0); assert.equal(r.boons.slow, 0); assert.equal(r.ward.er, null); }
});

/* 6구역: 다리 막기 (4.1.0 에 처음, 4.1.2 에 다시: 무더기 · 방벽 · 떼 · 수류탄) */
function onBridge() { const s = inLab(); s.zone = 5; s.posts = 12; s.defenses.rail = 1e9; s.zevIn = { rail: 1e9, guard: 1e9, tower: 1e9 }; s.jamIn = 1e9; s.truckIn = 1e9; const b = C.bridgeOf(s); b.spawn = 1e9; return s; }      // spawn 을 미뤄 두어 시험이 넣은 것만 다리에 있다
const zom = (x, k) => { const d = C.BRIDGE_KINDS[k || 'norm']; return { x, hp: d.hp, max: d.hp, big: k === 'big' ? 1 : 0, k: k || 'norm', id: 1 }; };
test('6구역 다리: 손으로 쏘면 깎이고, 잡으면 몫을 받는다. 연달아 잡으면 배수가 오른다', () => {
  const s = onBridge(), b = C.bridgeOf(s); assert.equal(C.shootBridge(s).reason, 'empty'); assert.equal(C.shootBridge(inLab()).reason, 'locked');
  const e = onBridge(); e.posts = 0; assert.equal(C.shootBridge(e).reason, 'stopped');
  b.zs.push(zom(0.9)); const before = s.supplies; let r = C.shootBridge(s); assert.ok(r.ok && !r.kill && r.left === 1);
  r = C.shootBridge(s); assert.ok(r.kill && r.gain > 0); near(s.supplies - before, C.guardRate(s) * C.BRIDGE_SPAWN, '첫 마리는 1배'); assert.equal(s.handKills, 1); assert.ok(b.combo > 1); assert.equal(b.nade, 1);
  b.combo = 1; b.zs.push(zom(0.5, 'tough')); for (let i = 0; i < 3; i++) C.shootBridge(s); const t0 = s.supplies; C.shootBridge(s); near(s.supplies - t0, C.guardRate(s) * C.BRIDGE_SPAWN * 2, '튼튼한 놈은 몫이 2배');
  s.firepower = 1; b.zs.push(zom(0.5)); assert.ok(C.shootBridge(s).kill, '화력 1: 보통 것은 한 발');
  b.zs.push(zom(0.2), zom(0.9)); r = C.shootBridge(s, 0.88); near(r.x, 0.9, '누른 자리에서 가장 가까운 것'); r = C.shootBridge(s); near(r.x, 0.2, '자리를 안 주면 맨 앞');
  for (let i = 0; i < 80; i++) { b.zs.push(zom(0.5, 'run')); b.heat = 0; C.shootBridge(s); } near(b.combo, C.comboCap(s), '상한에서 멈춘다'); s.morale = 4; assert.ok(C.comboCap(s) > C.comboCap(onBridge()));
  C.stepBridge(s, 0.5, calm, []); const c0 = b.combo; for (let i = 0; i < 24; i++) C.stepBridge(s, 0.5, calm, []); assert.ok(b.combo < c0 && b.combo >= 1, '한동안 못 잡으면 줄어든다');
  for (const junk of [NaN, -1, 9, 'x', null, undefined]) assert.doesNotThrow(() => C.shootBridge(s, junk));
});

test('6구역 다리: 무더기로 오고, 닿으면 방벽을 깎는다. 방벽이 다 깎이면 뚫려서 한동안 쏠 수 없다', () => {
  const s = onBridge(), b = C.bridgeOf(s), r = lcg(3); b.spawn = 0.1; let most = 0, kinds = new Set();
  for (let i = 0; i < 400; i++) { const n0 = b.zs.length; C.stepBridge(s, 0.1, r, []); most = Math.max(most, b.zs.length - n0); b.zs.forEach((z) => kinds.add(z.k)); b.wall = C.wallMax(s); }
  assert.ok(most >= 2, '한 번에 여럿이 온다: ' + most); assert.ok(kinds.has('run') && kinds.has('tough') && kinds.has('big'), [...kinds].join());
  const w = onBridge(), wb = C.bridgeOf(w), ev = []; wb.combo = 2; wb.hold = 99; wb.zs.push(zom(0.001, 'big'));
  C.stepBridge(w, 0.25, calm, ev); assert.ok(ev.some((e) => e.type === 'bridge-leak' && e.big)); assert.equal(wb.combo, 1, '큰 놈이 닿으면 연속이 처음으로'); assert.equal(wb.wall, C.WALL_BASE - C.BRIDGE_KINDS.big.hit);
  C.stepBridge(w, C.WALL_FIX + 0.1, calm, []); assert.equal(wb.wall, C.WALL_BASE - C.BRIDGE_KINDS.big.hit + 1, '방벽은 조금씩 고쳐진다');
  w.upgrades.sandbag = 2; assert.equal(C.wallMax(w), C.WALL_BASE + 8);
  wb.wall = 1; wb.zs.push(zom(0.001), zom(0.5)); const ev2 = []; C.stepBridge(w, 0.25, calm, ev2); assert.ok(ev2.some((e) => e.type === 'bridge-breach')); assert.equal(w.breaches, 1); assert.equal(wb.zs.length, 0); assert.ok(wb.down > 0);
  assert.equal(C.shootBridge(w).reason, 'down'); assert.equal(C.throwNade(w).reason, 'down'); const g0 = w.guardEarned;
  const ev3 = []; C.stepBridge(w, C.BREACH_SECONDS + 0.3, calm, ev3); assert.ok(ev3.some((e) => e.type === 'bridge-back')); assert.equal(wb.down, 0); assert.equal(wb.wall, C.wallMax(w)); assert.equal(w.guardEarned, g0, '뚫린 동안에는 아무것도 못 받는다');
});

test('6구역 다리: 떼는 손을 쓰고 있을 때만 온다. 미리 알리고, 뚫리지 않고 넘기면 받는다. 잇달아 막을수록 세진다', () => {
  const s = onBridge(), b = C.bridgeOf(s), ev = []; b.waveIn = 1; b.hand = 999;
  C.stepBridge(s, 3, calm, ev); assert.ok(!ev.some((e) => e.type === 'bridge-warn'), '손을 안 쓰면 오지 않는다');
  b.zs.push(zom(0.9)); C.shootBridge(s); C.stepBridge(s, 1.2, calm, ev); assert.ok(ev.some((e) => e.type === 'bridge-warn')); assert.ok(b.warn > 0 && !(b.wave > 0));
  C.stepBridge(s, C.WAVE_WARN, calm, ev); assert.ok(ev.some((e) => e.type === 'bridge-wave')); assert.ok(b.wave > 0);
  b.zs = []; b.spawn = 1e9; const g0 = s.guardEarned; for (let i = 0; i < 40; i++) C.stepBridge(s, 0.25, calm, ev);
  const hv = ev.find((e) => e.type === 'bridge-held'); assert.ok(hv && hv.gain > 0 && hv.streak === 1); near(s.guardEarned - g0, C.guardRate(s) * C.WAVE_PAY); assert.equal(s.wavesHeld, 1); assert.equal(b.streak, 1);
  s.upgrades.flare = 2; b.wave = 0.1; b.combo = 1; const g1 = s.guardEarned; C.stepBridge(s, 0.25, calm, []); near(s.guardEarned - g1, C.guardRate(s) * C.WAVE_PAY * 2 * 1.1, '조명탄 + 단계 1');
  /* 4.1.3 다리 단계: 떼를 막으면 오르고, 뚫리면 내려간다. 단계가 오르면 더 질긴 것이 더 많이 온다. 손을 놓으면 내려간다 */
  b.streak = 5; b.wall = 1; b.zs.push(zom(0.001)); C.stepBridge(s, 0.25, calm, []); assert.equal(b.streak, 5 - C.LV_DROP, '뚫리면 내려간다');
  const m = onBridge(); C.bridgeOf(m).streak = 99; C.bridgeOf(m).wave = 0.1; C.stepBridge(m, 0.25, calm, []); assert.ok(C.bridgeOf(m).streak <= 40, '상한');
  const cnt = (lv) => { const z = onBridge(), zb = C.bridgeOf(z), r = lcg(9); zb.spawn = 0.1; zb.streak = lv; let n = 0, hp = 0; for (let i = 0; i < 300; i++) { zb.hand = 0; zb.waveIn = 99; const n0 = zb.n; C.stepBridge(z, 0.1, r, []); n += zb.n - n0; zb.zs.forEach((q) => { hp = Math.max(hp, q.k === 'norm' ? q.max : 0); }); zb.zs = []; zb.wall = 99; } return { n, hp }; };
  const lo = cnt(0), hi = cnt(10); assert.ok(hi.n > lo.n * 1.6, lo.n + ' → ' + hi.n); assert.equal(lo.hp, 2); assert.ok(hi.hp >= 5);
  const pz = onBridge(); near(C.bridgeLvPay(pz), 1); C.bridgeOf(pz).streak = 10; assert.ok(C.bridgeLvPay(pz) < 1, '한 마리의 몫은 줄지만'); assert.ok(C.bridgeLvPay(pz) * (1 + 0.12 * 10) > 1.9, '다 잡으면 더 번다');
  const dz = onBridge(), db = C.bridgeOf(dz); db.streak = 3; db.hand = 999; for (let i = 0; i < 100; i++) C.stepBridge(dz, 0.25, calm, []); assert.equal(db.streak, 2, '손을 놓고 있으면 내려간다');
  /* 4.1.7 단계가 오르면 새 종류가 섞여 온다: 3단계부터 개, 6단계부터 부푼 놈, 9단계부터 방패 든 놈 */
  const kindsAt = (lv) => { const z = onBridge(), zb = C.bridgeOf(z), r = lcg(4), seen = new Set(); zb.spawn = 0.1; zb.streak = lv; for (let i = 0; i < 1500; i++) { zb.hand = 0; zb.waveIn = 99; C.stepBridge(z, 0.1, r, []); zb.zs.forEach((q) => seen.add(q.k)); zb.zs = []; zb.wall = 99; } return seen; };
  const k0 = kindsAt(0), k3 = kindsAt(3), k6 = kindsAt(6), k9 = kindsAt(9);
  assert.ok(!k0.has('dog') && !k0.has('bomb') && !k0.has('shield')); assert.ok(k3.has('dog') && !k3.has('bomb')); assert.ok(k6.has('bomb') && !k6.has('shield')); assert.ok(k9.has('shield') && k9.has('dog') && k9.has('bomb') && k9.has('norm'));
  /* 부푼 놈은 쓰러지면 터진다: 곁의 것들이 깎이고, 쓰러진 것도 손이 잡은 것으로 친다. 잇달아 터지기도 한다 */
  const bz = onBridge(), bb = C.bridgeOf(bz); bz.firepower = 2; bb.zs.push(zom(0.5, 'bomb'), zom(0.53), zom(0.56, 'bomb'), zom(0.62, 'run'), zom(0.9));
  const br = C.shootBridge(bz, 0.5); assert.ok(br.kill && br.booms.length === 2 && br.also.length === 3, JSON.stringify(br)); assert.equal(bb.zs.length, 1); near(bb.zs[0].x, 0.9); assert.equal(bz.handKills, 4);
  const nz = onBridge(), nb = C.bridgeOf(nz); nb.nade = C.nadeNeed(nz); nb.zs.push(zom(0.3, 'bomb'), zom(0.33, 'shield'), zom(0.8, 'shield')); const nr = C.throwNade(nz); assert.equal(nr.kills, 2, '수류탄에 터진 부푼 놈이 곁의 방패까지'); assert.equal(nb.zs.length, 1);
  /* 총열: 쏠 때마다 달아오르고, 다 달아오르면 과열되어 잠깐 쏠 수 없다. 쉬면 식는다. 수류탄은 과열과 상관없다 */
  const hz = onBridge(), hb = C.bridgeOf(hz); let shots = 0, jr = null; while (shots < 40) { hb.zs.push(zom(0.5, 'big')); const r = C.shootBridge(hz); shots++; if (r.jam) { jr = r; break; } hb.zs = []; }
  assert.ok(jr && shots >= 10 && shots <= 14, '열두 발쯤: ' + shots); assert.equal(C.shootBridge(hz).reason, 'jam'); assert.equal(hz.jamsRun, 1);
  hb.nade = C.nadeNeed(hz); assert.ok(C.throwNade(hz).ok, '과열이어도 수류탄은 던진다');
  C.stepBridge(hz, C.JAM_SECONDS + 0.1, calm, []); assert.equal(hb.jam, 0); assert.equal(hb.heat, 0); hb.zs.push(zom(0.5)); assert.ok(C.shootBridge(hz).ok);
  const h0 = hb.heat; C.stepBridge(hz, 0.2, calm, []); assert.ok(hb.heat < h0, '쉬면 식는다'); hz.upgrades.coolant = 5; hb.heat = 0.5; C.stepBridge(hz, 1, calm, []); near(hb.heat, 0.5 - C.HEAT_COOL * 2, '냉각수');
});

test('6구역 수류탄: 손으로 잡은 만큼 차고, 던지면 다리 위의 모두가 깎인다', () => {
  const s = onBridge(), b = C.bridgeOf(s), need = C.nadeNeed(s); assert.equal(C.throwNade(s).reason, 'notready'); assert.equal(C.throwNade(inLab()).reason, 'locked');
  for (let i = 0; i < need + 5; i++) { b.zs.push(zom(0.5, 'run')); b.heat = 0; C.shootBridge(s); } assert.equal(b.nade, need, '넘치지 않는다'); assert.equal(C.throwNade(s).reason, 'empty'); assert.equal(b.nade, need);
  b.zs.push(zom(0.3), zom(0.5, 'tough'), zom(0.7, 'run'), zom(0.9, 'big')); const k0 = s.handKills, r = C.throwNade(s); assert.ok(r.ok && r.kills === 3 && r.gain > 0 && r.hits.length === 4); assert.equal(s.handKills, k0 + 3);
  assert.equal(b.zs.length, 1); assert.equal(b.zs[0].hp, C.BRIDGE_KINDS.big.hp - C.NADE_DMG); assert.equal(b.nade, 0, '수류탄으로 잡은 것으로는 차지 않는다');
  s.upgrades.nadebox = 3; assert.equal(C.nadeNeed(s), need - 12 < 8 ? 8 : need - 12);
});

test('6구역 다리: 가만히 둠 < 초소장 < 초소장 + 손. 자리를 비운 동안에는 하나하나 세지 않고 뚫리지도 않는다', () => {
  const run = (auto, tps) => { const z = onBridge(), r = lcg(11); C.bridgeOf(z).spawn = 1; if (auto) z.upgrades.autoguard = 1; let acc = 0; const s0 = z.guardEarned;
    for (let t = 0; t < 6000; t++) { C.stepBridge(z, 0.1, r, []); acc += tps * 0.1; while (acc >= 1) { acc -= 1; const bb = C.bridgeOf(z); if (bb.nade >= C.nadeNeed(z) && bb.zs.length >= 5) C.throwNade(z); if (!bb.zs.length) { if (tps > 0) bb.hand = 0; break; } C.shootBridge(z); } }
    return { x: (z.guardEarned - s0) / (C.guardRate(z) * 600), br: z.breaches || 0 }; };
  const idle = run(false, 0), auto = run(true, 0), hand = run(true, 3);
  assert.ok(idle.x < 0.3 && idle.br > 5, '가만히: ' + idle.x.toFixed(2)); assert.ok(auto.x > idle.x * 2 && auto.x < 1.2, '초소장: ' + auto.x.toFixed(2)); assert.ok(hand.x > auto.x * 2, '손: ' + hand.x.toFixed(2)); assert.ok(hand.br < auto.br); assert.ok(hand.br >= 1, '4.1.3: 누르고만 있어도 언젠가는 뚫린다(' + hand.br + ')');
  const off = onBridge(); off.upgrades.autoguard = 1; C.bridgeOf(off).zs.push(zom(0.9)); C.setAutoEvents(off, 5, false); const evo = []; for (let i = 0; i < 30; i++) C.stepBridge(off, 0.1, calm, evo); assert.ok(!evo.some((e) => e.type === 'bridge-shot'));
  const a = onBridge(), b = onBridge(); b.upgrades.autoguard = 1; C.bridgeOf(a).wall = 1; C.stepBridge(a, 600, calm, []); C.stepBridge(b, 600, calm, []);
  near(a.guardEarned, C.guardRate(a) * 600 * C.BRIDGE_LEAK); near(b.guardEarned, C.guardRate(b) * 600 * C.AWAY_AUTO); assert.equal(C.bridgeOf(a).zs.length, 0); assert.equal(a.breaches || 0, 0); assert.equal(C.bridgeOf(a).wall, C.wallMax(a));
  for (const junk of [NaN, -5, 'x', undefined, 1e99]) assert.doesNotThrow(() => C.stepBridge(onBridge(), junk, calm, []));
});

test('6구역 다리: 화력과 사기를 사고, 저장을 안전하게 읽는다', () => {
  const s = onBridge(); s.supplies = 1e80; let n = 0; while (C.buyFire(s).ok) n++; assert.equal(n, 3); assert.equal(C.fireCost(s), Infinity); n = 0; while (C.buyMorale(s).ok) n++; assert.equal(n, 4); assert.equal(C.buyFire(inLab()).reason, 'locked');
  const b = C.bridgeOf(s); b.zs.push(zom(0.4), zom(0.8, 'big'), zom(0.6, 'run')); b.zs[2].w = 1; b.combo = 1.7; b.wall = 6; b.nade = 5; b.streak = 3; b.heat = 0.4; s.breaches = 2;
  const back = C.deserialize(C.serialize(s), 0); assert.equal(back.firepower, 3); assert.equal(back.morale, 4); assert.equal(back.bridge.zs.length, 3); near(back.bridge.combo, 1.7); assert.equal(back.bridge.wall, 6); assert.equal(back.bridge.nade, 5); assert.equal(back.bridge.streak, 3); near(back.bridge.heat, 0.4); assert.equal(back.breaches, 2); assert.equal(back.bridge.zs[1].k, 'big'); assert.equal(back.bridge.zs[2].w, 1);
  for (const junk of [null, 5, 'x', { zs: 'x' }, { zs: [null, 1, { x: 9, hp: 1 }, { x: 0.5, hp: -1 }, { x: 0.5, hp: 1e9, big: 1 }, { x: 0.5, hp: 2, k: 'zzz' }], combo: 1e9, spawn: -3, wall: -9, down: 1e9, nade: 1e9, streak: 1e9, waveIn: -1 }]) { const raw = JSON.parse(JSON.stringify(s)); raw.bridge = junk; raw.firepower = junk; raw.morale = junk;
    const z = C.deserialize(JSON.stringify(raw), 0); assert.doesNotThrow(() => { C.stepBridge(z, 0.5, calm, []); C.shootBridge(z); C.throwNade(z); }); assert.ok(z.bridge.combo <= 10 && z.bridge.down <= C.BREACH_SECONDS && z.bridge.streak <= 99 && z.bridge.zs.every((q) => q.x > 0 && q.x <= 1.2 && q.hp > 0 && q.hp <= C.BRIDGE_BIG_HP * 9 && C.BRIDGE_KINDS[q.k]) && z.bridge.heat <= 1 && z.bridge.jam <= C.JAM_SECONDS); }
});

test('뽑기 기계 10회: 뽑기권 10장을 쓰고 열 개가 나온다. 모자라면 하나도 뽑지 않는다', () => {
  const s = fresh(); s.tickets = 9; assert.equal(C.pullGachaMany(s, 10).reason, 'tickets'); assert.equal(s.tickets, 9);
  s.tickets = 25; const r = C.pullGachaMany(s, 10, () => 0.99); assert.ok(r.ok); assert.equal(r.list.length, 10); assert.equal(s.tickets, 15); assert.ok(r.list.every((x) => x.ok && x.name));
  assert.equal(s.gachaPulls, 10); for (const bad of [0, 11, NaN, 'x']) assert.equal(C.pullGachaMany(s, bad).ok, false);
  const p = fresh(); p.tickets = 100; p.gachaPity = C.GACHA_PITY - 5; const pr = C.pullGachaMany(p, 10, () => 0.99); assert.ok(pr.list.some((x) => x.rarity === 2), '10회 안에서도 보장이 걸린다');
});

test('4.4.4 금냥이는 브리티시 숏헤어가 됐다: 기본 이름 그대로였으면 새 이름으로, 지어 준 이름은 그대로', () => {
  const s = C.createState(0); s.kennel = { golden: '금냥이' }; s.pet = { kind: 'cat', breed: 'golden', name: '금냥이' };
  const a = C.deserialize(C.serialize(s), 0); assert.equal(a.kennel.golden, '브리티시 숏헤어');
  s.kennel = { golden: '노랑이' }; const b = C.deserialize(C.serialize(s), 0); assert.equal(b.kennel.golden, '노랑이');
});

test('출석 체크(4.7.1): 하루에 한 번, 서른 날 한 바퀴, 빠져도 이어 가고 날짜를 되돌리면 못 받는다', () => {
  const s = fresh(); const t0 = s.tickets, tr0 = s.treats;
  assert.equal(C.attendInfo(s, '2026-11-21').can, true);
  const r = C.claimAttend(s, '2026-11-21'); assert.ok(r.ok); assert.equal(r.day, 0); assert.equal(s.treats, tr0 + 5);
  assert.equal(C.claimAttend(s, '2026-11-21').reason, 'done', '같은 날 두 번은 안 된다');
  assert.equal(C.claimAttend(s, '2026-11-20').reason, 'done', '날짜를 되돌려도 안 된다');
  assert.equal(C.claimAttend(s, 'x').reason, 'date');
  assert.ok(C.claimAttend(s, '2026-11-25').ok, '빠진 날이 있어도 받는다'); assert.equal(s.tickets, t0 + 1, '둘째 날은 뽑기권');
  for (let i = 0; i < 28; i++) C.claimAttend(s, '2027-01-' + String(i + 1).padStart(2, '0'));
  assert.equal(s.attend.count, 30); assert.equal(C.attendInfo(s, '2027-02-10').day, 0, '서른 날 뒤 처음으로');
  assert.equal(C.ATTEND_REWARDS.length, 30); assert.deepEqual(C.ATTEND_REWARDS[29], { tickets: 5, treats: 40 }); assert.equal(C.ATTEND_REWARDS[7].treats, 10, '둘째 주는 간식이 5개 더');
  // 저장 · 불러오기 · 철수
  const back = C.deserialize(C.serialize(s), 0); assert.deepEqual(back.attend, { last: '2027-01-28', count: 30 });
  const bad = JSON.parse(C.serialize(s)); bad.attend = { last: '어제', count: -3 };
  assert.deepEqual(C.deserialize(JSON.stringify(bad), 0).attend, { last: '', count: 0 });
  C.ATTEND_REWARDS.forEach(w => assert.ok((w.treats || 0) + (w.tickets || 0) > 0 && Object.keys(w).every(k => k === 'treats' || k === 'tickets'), '보상은 간식과 뽑기권뿐'));
});

test('외형 NEW(4.7.1): 새로 얻으면 붙고, 누르면(seeCosmetic) 사라지고, 저장 · 철수에도 남는다', () => {
  const s = fresh(); s.tickets = 5; let r;
  do { r = C.pullGacha(s, Math.random); } while (r.ok && r.dup && s.tickets > 0);
  if (r.ok && !r.dup) {
    assert.equal(s.cosNew[r.id], true);
    const back = C.deserialize(C.serialize(s), 0); assert.equal(back.cosNew[r.id], true);
    assert.equal(C.seeCosmetic(s, r.id), true); assert.equal(s.cosNew[r.id], undefined); assert.equal(C.seeCosmetic(s, r.id), false);
  }
  const bad = JSON.parse(C.serialize(s)); bad.cosNew = { ghost: true, 'pat-camo': 'yes' };
  assert.deepEqual(C.deserialize(JSON.stringify(bad), 0).cosNew, {});
  assert.equal(C.COSMETICS.find(c => c.id === 'pat-camo').look, 'bolt', '위장 무늬는 번개로');
});

test('7구역 습격(4.7.2): 단계가 오르면 더 자주 바뀌고 더 빨리 깎이고 길어지며, 15단계부터 협공이 섞인다', () => {
  assert.equal(C.raidShift(0), 6); assert.ok(C.raidShift(33) < 3.5); assert.equal(C.raidShift(200), 2.5);
  assert.equal(C.raidRate(0), 1); assert.ok(C.raidRate(33) > 1.8);
  assert.equal(C.raidLen(0), C.RAID_SECONDS); assert.equal(C.raidLen(200), C.RAID_SECONDS + 20);
  const s = fresh(); C.campOf(s).nightLv = 30; let pins = 0;
  for (let i = 0; i < 200; i++) { const r = C.newRaid(s, Math.random); const sum = r.w[0] + r.w[1] + r.w[2]; assert.ok(Math.abs(sum - 1) < 1e-9); if (r.pin) { pins++; assert.deepEqual(r.w.slice().sort(), [0.1, 0.45, 0.45]); } assert.equal(r.t, C.raidLen(30)); }
  assert.ok(pins > 20 && pins < 140, '협공은 가끔: ' + pins);
  C.campOf(s).nightLv = 10; for (let i = 0; i < 100; i++) assert.equal(C.newRaid(s, Math.random).pin, false, '15단계 아래에는 협공이 없다');
});

/* ---------- 4.7.3 출석 알림 ---------- */
test('출석 알림: 안 받았으면 한 시간 뒤의 첫 12시 · 19시, 받았으면 내일 12시', () => {
  const T = (d, h, m) => new Date(2026, 10, d, h, m || 0).getTime();      // 현지 시각
  assert.equal(C.attendNoticeAt(T(17, 10), false), T(17, 12));
  assert.equal(C.attendNoticeAt(T(17, 11, 30), false), T(17, 19), '12시는 한 시간 안이라 건너뛴다');
  assert.equal(C.attendNoticeAt(T(17, 20), false), T(18, 12));
  assert.equal(C.attendNoticeAt(T(17, 21), true), T(18, 12), '오늘 받았으면 자정이 지나야 받을 수 있다');
  assert.equal(C.attendNoticeAt(T(17, 9), true), T(18, 12));
  assert.equal(C.localDay(T(17, 23, 59)), '2026-11-17');
});

test('출석 알림 문구: 뽑기권이 든 날은 그것을 말한다', () => {
  const s = fresh();
  assert.equal(C.attendNoticeText(s), '오늘의 보급품이 도착했어요. 출석 체크하고 받아 가세요.');
  s.attend = { last: '2026-11-16', count: 6 };      // 다음이 7일째(뽑기권)
  assert.ok(C.ATTEND_REWARDS[6].tickets > 0);
  assert.equal(C.attendNoticeText(s), '오늘 보급 상자에 뽑기권이 들어 있어요. 출석 체크하고 받아 가세요.');
});

test('알림 목록: 출석 알림이 붙고, 다른 알림과 겹치면 빠진다', () => {
  const s = fresh(), T = (d, h, m) => new Date(2026, 10, d, h, m || 0).getTime();
  const p1 = C.noticePlan(s, T(17, 10), 0);
  assert.deepEqual(p1.map(p => p.kind), ['full', 'back', 'attend']);
  assert.equal(p1[2].at, T(17, 12));
  const p2 = C.noticePlan(s, T(17, 8), 0);      // 창고 알림(12시)과 출석(12시)이 겹친다
  assert.deepEqual(p2.map(p => p.kind), ['full', 'back']);
  s.attend = { last: C.localDay(T(17, 15)), count: 3 };
  const p3 = C.noticePlan(s, T(17, 15), 0);
  assert.equal(p3[2].at, T(18, 12), '오늘 받았으면 내일');
  p3.forEach(p => assert.ok(p.at > T(17, 15)));
  assert.ok(C.noticePlan({ attend: null }, T(17, 10), 0).length >= 2, '상태가 이상해도 앞의 둘은 나온다');
});

/* ---------- 4.7.3 5구역: 멈춘 사람이 나가기까지 ---------- */
test('멈춘 사람이 나가기까지: 오래 앉은 사람부터 WARD_ARRIVE 초 간격', () => {
  const s = fresh(); s.zone = 4; s.staff = 1;
  const w = C.wardOf(s);
  w.seats = [{ dose: 1, since: 3, m: 0.2, r: 1 }, { dose: 0, since: 1, m: 0.1, r: 1 }, { dose: 1, since: 9, m: 0.2, r: 1 }, { dose: 3, since: 20, m: 0.2, r: 1 }];
  w.arrive = 0.5;
  const t = C.wardOutTimes(s);
  assert.equal(t[2], 0.5 * C.WARD_ARRIVE, '가장 오래 앉은 멈춘 사람이 먼저');
  assert.equal(t[0], 1.5 * C.WARD_ARRIVE);
  assert.equal(t[1], null); assert.equal(t[3], null, '못 맞은 사람 · 되돌리는 중인 사람은 나가지 않는다');
  w.seats[1] = { wait: 0 };      // 빈 의자가 있으면 먼저 그 자리가 찬다
  const t2 = C.wardOutTimes(s);
  assert.ok(t2[2] > t[2]);
  assert.deepEqual(C.wardOutTimes({}), []);
});

test('멈춘 사람이 나가기까지: 셈과 실제로 나가는 때가 맞는다', () => {
  const s = fresh(); s.zone = 4; s.staff = 1;
  const w = C.wardOf(s);
  w.seats = w.seats.map((_, i) => ({ dose: 1, since: 10 - i, m: 0.1, r: 0.01, look: i }));
  w.arrive = 0; w.erNext = 1e9;
  const want = C.wardOutTimes(s)[0], ev = [];
  let t = 0; while (t < want + 1 && !ev.some(e => e.type === 'ward-out')) { C.stepWard(s, 0.25, () => 0.5, ev); t += 0.25; }
  const out = ev.find(e => e.type === 'ward-out');
  assert.ok(out && out.at === 0, '맨 처음 나가는 것은 가장 오래 앉은 0번');
  assert.ok(Math.abs(t - want) <= 0.3, '셈한 시각(' + want + ')에 나간다(' + t + ')');
});

/* ---------- 4.7.5 혈청의 문턱과 최후의 밤 ---------- */
function z7ready() {
  const s = fresh(); s.zone = 6; s.bestZone = 6; s.supplies = 1e40; s.survivors = 1e6;
  C.SETTLE.forEach(d => { s.settle[d.id] = true; s.settleLv[d.id] = 1; });
  return s;
}
test('혈청 문턱: 밤 단계와 건물 단계가 차야 단계가 선다', () => {
  const s = z7ready();
  let g = C.serumGate(s);
  assert.equal(g.stage, 1); assert.equal(g.night, 10); assert.equal(g.ok, false);
  assert.equal(C.buySerum(s).reason, 'gate');
  s.nightLvBest = 10; assert.ok(C.buySerum(s).ok);
  s.nightLvBest = 20; assert.equal(C.buySerum(s).reason, 'gate', '건물 단계 합이 모자라다');
  assert.equal(C.settleLvSum(s), 9);
  C.SETTLE.forEach(d => { s.settleLv[d.id] = 2; }); assert.ok(C.buySerum(s).ok);
  s.nightLvBest = 30; C.SETTLE.forEach(d => { s.settleLv[d.id] = 3; });
  g = C.serumGate(s); assert.ok(g.base && g.final && !g.ok);
  assert.equal(C.buySerum(s).reason, 'final', '최후의 밤을 막아야 한다');
});
test('최후의 밤: 맞으러 가는 습격. 막으면 마지막 단계가 열린다', () => {
  const s = z7ready(); s.serumStage = 2;
  assert.equal(C.canFinal(s), false, '문턱 전에는 맞을 수 없다');
  assert.equal(C.startFinal(s).reason, 'gate');
  s.nightLvBest = 30; C.SETTLE.forEach(d => { s.settleLv[d.id] = 3; });
  assert.ok(C.canFinal(s));
  const ev = []; assert.ok(C.startFinal(s, () => 0.3, ev).ok);
  const n = C.campOf(s).night;
  assert.ok(n.final && n.pin, '늘 협공'); assert.equal(n.t, C.FINAL_SECONDS);
  assert.ok(ev.some(e => e.type === 'camp-night' && e.final));
  assert.equal(C.startFinal(s).reason, 'night', '습격 중에는 또 맞을 수 없다');
  // 사람을 넉넉히 세워 버틴다
  const ev2 = []; let t = 0;
  while (C.campOf(s).night && t < 200) { for (let k = 0; k < 6; k++) C.sendGuard(s, -1); C.stepCamp(s, 0.5, () => 0.5, ev2); t += 0.5; }
  const held = ev2.find(e => e.type === 'camp-held'), breach = ev2.find(e => e.type === 'camp-breach');
  assert.ok(held || breach, '끝이 난다');
  if (held) { assert.ok(held.final); assert.equal(s.finalHeld, true); assert.ok(C.buySerum(s).ok); assert.equal(s.serumStage, 3); }
  else { assert.ok(breach.final); assert.equal(s.finalHeld, false); assert.ok(C.campOf(s).nightLv >= 0); }
  assert.equal(s.finalTries, 1);
});
test('최후의 밤: 아무도 세우지 않으면 뚫리고, 다시 맞을 수 있다', () => {
  const s = z7ready(); s.serumStage = 2; s.nightLvBest = 30; C.SETTLE.forEach(d => { s.settleLv[d.id] = 3; });
  C.startFinal(s, () => 0.3); const ev = []; let t = 0;
  while (C.campOf(s).night && t < 200) { C.stepCamp(s, 0.5, () => 0.5, ev); t += 0.5; }
  assert.ok(ev.some(e => e.type === 'camp-breach' && e.final)); assert.equal(s.finalHeld, false);
  C.SETTLE.forEach(d => { s.camp.broken[d.id] = false; });
  assert.ok(C.canFinal(s), '다시 맞을 수 있다');
  const back = C.deserialize(C.serialize(Object.assign(s, { finalHeld: true })));
  assert.equal(back.finalHeld, true, '저장에 남는다');
});

test('4.7.7 밸런스 손잡이: 항체 샘플은 BAL.anti 배로 받는다', () => {
  const s = fresh(); s.runEarned = 1e20;
  const bal0 = C.BAL.anti;
  try { C.BAL.anti = 1; const one = C.antibodiesOnRetreat(s); C.BAL.anti = 0.5; const half = C.antibodiesOnRetreat(s); assert.ok(one > 0); assert.ok(Math.abs(half - one / 2) <= 1); }
  finally { C.BAL.anti = bal0; }
  assert.equal(C.BAL.anti, 0.5);
});
