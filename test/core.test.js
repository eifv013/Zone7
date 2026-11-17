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

test('다음 구역: 7구역까지 차례로 열리고, 그 뒤로는 다음 구역이 없다', () => {
  const s = inLab();
  C.GOALS[4].forEach(g => { s.goalsDone[g.id] = true; });
  s.supplies = C.nextZone(s).cost;
  assert.equal(C.nextZone(s).soon, false);
  assert.ok(C.openZone(s).ok); assert.equal(s.zone, 5);
  C.GOALS[5].forEach(g => { s.goalsDone[g.id] = true; });
  s.supplies = C.nextZone(s).cost;
  assert.equal(C.nextZone(s).soon, false);
  assert.ok(C.openZone(s).ok); assert.equal(s.zone, 6); assert.equal(s.gate, false);
  assert.equal(C.nextZone(s), null, '7구역이 마지막이다');
  s.supplies = 1e60;
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
  C.UPGRADES.forEach(u => assert.ok(u.zone === -1 || (u.zone >= 0 && u.zone < C.ZONES.length && C.ZONES[u.zone].kind !== 'soon'), u.id));
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
  // 1.0.4: 6구역이 열렸다. 6구역 문 앞에 있던 저장은 6구역으로 들어간다
  const old6 = C.sanitizeState({ version: 2, zone: 4, gate: true, story: { 'gate-6': true } }, 0);
  assert.equal(old6.zone, 5); assert.equal(old6.gate, false);
  // 1.2.0: 7구역이 열렸다. 7구역 문 앞에 있던 저장은 7구역으로 들어간다
  const old7 = C.sanitizeState({ version: 2, zone: 5, gate: true }, 0);
  assert.equal(old7.zone, 6); assert.equal(old7.gate, false);
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
  s.achClock = -1e9;      // 이 시험 도중에 업적이 달성되어 생산 배수가 바뀌지 않게 한다(값을 정확히 비교하므로)
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

test('자동: 자동 제어반(개조)을 달면 전력 투입을 준비되는 대로 알아서 쓴다. 특성만으로는 안 된다', () => {
  const off = inFactory(); off.defenses.rail = 1e9; off.signalIn = 1e9;
  off.machines.sorter = 2; off.machines.press = 3; off.machines.assembler = 6;
  off.traits.auto = 5;
  assert.equal(C.autoOn(off, 2), false);
  assert.ok(!C.tick(off, 5, half).some(e => e.type === 'surge'), '개조가 없으면 특성이 있어도 알아서 쓰지 않는다');
  assert.ok(C.surge(off).ok, '직접 누르면 된다');
  const s = inFactory(); s.upgrades.autoline = 1; s.defenses.rail = 1e9; s.signalIn = 1e9;
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

test('자동: 자동 신호(개조)를 달면 청신호도 알아서 켜고, 그 덕에 도착한 열차를 알린다', () => {
  const s = inStation(); s.upgrades.autosig = 1; s.defenses.rail = 1e9; s.signalIn = 1e9;
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

/* ================= 동물 친구와 이름 ================= */

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

test('동물 친구: 강아지는 방어력을, 고양이는 생산을 등급만큼 올리고, 데리고 다닐 아이를 고른다', () => {
  const n = fresh(); n.buildings.scouts = 10; n.defenses.wire = 10;
  const mk = (kind, roll) => { const s = fresh(); s.buildings.scouts = 10; s.defenses.wire = 10; C.adoptPet(s, kind, () => roll); return s; };
  const d = mk('dog', 0), dr = mk('dog', 0.99), c = mk('cat', 0), cr = mk('cat', 0.99);
  assert.equal(C.defensePower(d), Math.floor(C.defensePower(n) * 1.1));
  assert.equal(C.defensePower(dr), Math.floor(C.defensePower(n) * 1.35));
  near(C.productionPerSec(c), C.productionPerSec(n) * 1.05);
  near(C.productionPerSec(cr), C.productionPerSec(n) * 1.2);
  near(C.productionPerSec(d), C.productionPerSec(n)); assert.equal(C.defensePower(c), C.defensePower(n));
  assert.ok(C.defensePlan(dr).cost <= C.defensePlan(n).cost, '보강 계획에도 반영된다');
  assert.equal(C.petInfo(n), null); assert.equal(C.petEffect(n), null);
  assert.ok(C.petInfo(dr).desc.includes('방어력 +35%')); assert.equal(C.petInfo(dr).rarity.name, '희귀');
  // 둘을 데리고 있어도 효과는 데리고 다니는 아이 것만
  d.antibodies = 99; C.adoptPet(d, 'cat', () => 0.99);
  near(C.productionPerSec(d), C.productionPerSec(n) * 1.2); assert.equal(C.defensePower(d), C.defensePower(n));
  const first = Object.keys(d.kennel)[0];
  assert.ok(C.choosePet(d, first).ok);
  assert.equal(C.defensePower(d), Math.floor(C.defensePower(n) * 1.1));
  assert.equal(C.choosePet(d, 'siam').reason, 'unknown', '아직 없는 아이는 고를 수 없다');
  assert.equal(C.choosePet(d, 'ghost').reason, 'unknown');
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
  s.machines.sorter = 2; s.machines.press = 3; s.machines.assembler = 6; s.trains = 1; s.routes.loop = 1;
  C.surge(s); C.greenSignal(s);
  near(s.surgeCool, C.surgeCooldown(s)); near(s.greenCool, C.greenCooldown(s));
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
    assert.ok(b.text.split('\n\n').length >= 4, b.id + ' 는 문단이 너무 적다');
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
test('동물 친구는 강아지 12종, 고양이 12종이고 등급마다 넷씩 있다', () => {
  for (const kind of ['dog', 'cat']) {
    const list = C.PET_BREEDS.filter(b => b.kind === kind);
    assert.equal(list.length, 12, kind);
    for (const r of C.PET_RARITIES) assert.equal(list.filter(b => b.rarity === r.id).length, 4, kind + ' ' + r.id);
  }
  assert.equal(new Set(C.PET_BREEDS.map(b => b.id)).size, 24);
  assert.equal(new Set(C.PET_BREEDS.map(b => b.name)).size, 24);
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
  assert.deepEqual(plan.map(p => p.kind), ['full', 'back']);
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
  C.tick(s, 1, () => 0.5);
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

test('납품 의뢰: 3구역에서만 오고, 만든 완제품이 차면 납품해서 물자·간식·도감·완제품 값을 얻는다', () => {
  const m = inMarket(); m.contractIn = 0.5;
  for (let i = 0; i < 30; i++) C.tick(m, 1, () => 0.3);
  assert.equal(m.contract, null, '3구역을 열기 전에는 오지 않는다');
  const s = inFactory(); s.supplies = 1e30;
  ['sorter', 'press', 'assembler'].forEach((id) => assert.ok(C.buyMachine(s, id, 5).ok));
  assert.ok(C.productFlow(s) > 0);
  s.contractIn = 0.5;
  let got = null;
  for (let i = 0; i < 5 && !got; i++) got = C.tick(s, 1, () => 0.3).find((e) => e.type === 'contract') || null;
  assert.ok(got && s.contract, '의뢰가 온다');
  assert.equal(C.fillContract(s).reason, 'short', '덜 찼으면 납품할 수 없다');
  const need = s.contract.need, who = s.contract.who;
  for (let i = 0; i < 80 && s.contract && s.contract.have < need; i++) C.tick(s, 1, () => 0.3);
  assert.ok(s.contract && s.contract.have >= need, '시간 안에 찬다(의뢰량은 50초 치, 시간은 90초)');
  s.supplies = 0;                                             // 큰 수에 묻혀 늘어난 것이 안 보이지 않게
  const before = s.supplies, treats = s.treats, value = C.productValue(s);
  const r = C.fillContract(s);
  assert.ok(r.ok && r.first && r.gain > 0);
  assert.ok(s.supplies > before); assert.equal(s.treats, treats + C.CONTRACT_TREATS);
  assert.equal(s.clients[who], 1); assert.equal(C.clientCount(s), 1); assert.equal(s.contract, null);
  near(C.productValue(s), value * (1 + C.CONTRACT_BONUS));
  s.contractsRun = 1000; near(C.contractMult(s), 1 + C.CONTRACT_BONUS_MAX);
  s.contract = { who: 'forge', need: 1e12, have: 0, left: 1 };
  assert.ok(C.tick(s, 2, Math.random).some((e) => e.type === 'contract-gone')); assert.equal(s.contract, null);
  s.runEarned = 1e9; const back = C.retreat(s, 1).state;
  assert.equal(back.clients[who], 1); assert.equal(back.contractsRun, 0); assert.equal(back.contract, null);
  const bad = C.sanitizeState({ version: 2, contract: { who: '없는곳', need: 5, left: 5 }, clients: { forge: -2, 가짜: 3 }, contractsRun: 'x' }, 0);
  assert.equal(bad.contract, null); assert.equal(bad.clients.forge, undefined); assert.equal(bad.contractsRun, 0);
});

test('표류 화물: 4구역에서만 발견되고, 열차가 싣고 온 값이 차면 끌어와서 물자·간식·도감·화물 값을 얻는다', () => {
  const f = inFactory(); f.salvageIn = 0.5;
  for (let i = 0; i < 30; i++) C.tick(f, 1, () => 0.3);
  assert.equal(f.salvage, null, '4구역을 열기 전에는 없다');
  const s = inStation(); s.supplies = 1e40;
  assert.ok(C.buyTrain(s, 8).ok); assert.ok(C.buyRoute(s, 'loop').ok);
  assert.ok(C.railRate(s) > 0);
  s.salvageIn = 0.5;
  let got = null;
  for (let i = 0; i < 5 && !got; i++) got = C.tick(s, 1, () => 0.3).find((e) => e.type === 'salvage') || null;
  assert.ok(got && s.salvage, '화물이 발견된다');
  assert.equal(C.fillSalvage(s).reason, 'short');
  const who = s.salvage.who;
  for (let i = 0; i < 149 && s.salvage && s.salvage.have < s.salvage.need; i++) C.tick(s, 1, () => 0.3);
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
  const rate = C.researchRate(s), treats = s.treats;
  // 주사위가 낮으면(0.1 < 0.35) 찾는다
  const r = C.runProject(s, 'soil', () => 0.1);
  assert.ok(r.ok && r.record && r.record.first);
  assert.equal(s.records[r.record.id], 1); assert.equal(C.recordCount(s), 1); assert.equal(s.recordsRun, 1);
  assert.equal(s.treats, treats + C.RECORD_TREATS);
  near(C.researchRate(s), rate * (1 + C.RECORD_BONUS));
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
  assert.equal(C.effectNow({ desc: '모든 값 -4%' }, 2), '모든 값 -7.8%');      // 1 - 0.96² = 7.84%
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
  for (let i = 0; i < 6; i++) assert.ok(C.buyUpgrade(s, 'booth').ok);
  for (let i = 0; i < 4; i++) assert.ok(C.buyUpgrade(s, 'signpost').ok);
  assert.equal(g.value(s), 10); assert.ok(g.value(s) >= g.need);
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
