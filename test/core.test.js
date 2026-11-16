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
  assert.equal(bad.zone, 1, '아직 없는 구역에는 들어가 있을 수 없다');
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
  const s = inMarket();
  C.GOALS[1].forEach(g => { s.goalsDone[g.id] = true; });
  const n = C.nextZone(s);
  assert.equal(n.soon, true);
  s.supplies = n.cost;
  const r = C.openZone(s);
  assert.ok(r.ok && r.soon);
  assert.equal(s.zone, 1, '들어가지는 못한다');
  assert.equal(s.gate, true);
  assert.equal(s.bestZone, 2);
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
