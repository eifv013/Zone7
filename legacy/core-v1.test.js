/*
 * GameCore 단위 테스트 — 실행: node --test test/
 * 화면 없이 게임 규칙(가격, 생산, 밤 전투, 자리 비움, 이주, 저장)을 검증한다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');

const fresh = () => C.createState(1000);
// tick 은 밤 외에도 업적·신호 이벤트를 돌려주므로, 밤 결과만 볼 때 쓴다.
const nights = evs => evs.filter(e => e.type === 'defended' || e.type === 'breached' || e.type === 'held');

test('새 상태는 모든 시설·방벽이 0개이고 D+1 에서 시작한다', () => {
  const s = fresh();
  assert.equal(s.supplies, 0);
  assert.equal(s.day, 1);
  C.BUILDINGS.forEach(b => assert.equal(s.buildings[b.id], 0));
  C.DEFENSES.forEach(d => assert.equal(s.defenses[d.id], 0));
  assert.equal(C.productionPerSec(s), 0);
  assert.equal(C.defensePower(s), C.BASE_DEFENSE);
});

test('묶음 가격은 낱개 가격의 합과 같다(올림 오차 이내)', () => {
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += 15 * Math.pow(1.15, 3 + i);
  const bulk = C.bulkCost(15, 1.15, 3, 10);
  assert.ok(Math.abs(bulk - sum) <= 1, `${bulk} vs ${sum}`);
  assert.equal(C.bulkCost(15, 1.15, 0, 0), 0);
  assert.equal(C.bulkCost(15, 1.15, 0, 1), 15);
});

test('maxAffordable 은 살 수 있는 최대치를 정확히 돌려준다', () => {
  for (const supplies of [0, 14, 15, 16, 100, 12345, 9.9e9]) {
    const n = C.maxAffordable(15, 1.15, 2, supplies);
    assert.ok(C.bulkCost(15, 1.15, 2, n) <= supplies);
    assert.ok(C.bulkCost(15, 1.15, 2, n + 1) > supplies);
  }
  assert.equal(C.maxAffordable(15, 1.15, 0, NaN), 0);
});

test('시설 구매: 성공하면 물자가 줄고 개수가 는다', () => {
  const s = fresh();
  s.supplies = 100;
  const r = C.buyBuilding(s, 'scouts', 1);
  assert.equal(r.ok, true);
  assert.equal(s.buildings.scouts, 1);
  assert.equal(s.supplies, 85);
  assert.equal(C.productionPerSec(s), 0.5);
});

test('시설 구매 실패: 물자 부족·없는 ID·잘못된 수량은 상태를 바꾸지 않는다', () => {
  const s = fresh();
  s.supplies = 10;
  assert.deepEqual(C.buyBuilding(s, 'scouts', 1), { ok: false, reason: 'supplies' });
  assert.equal(C.buyBuilding(s, 'nope', 1).reason, 'unknown');
  s.supplies = 1e9;
  for (const bad of [0, -3, NaN, Infinity, '2', null]) {
    assert.equal(C.buyBuilding(s, 'scouts', bad).reason, 'quantity');
    assert.equal(C.buyDefense(s, 'wire', bad).reason, 'quantity');
  }
  assert.equal(s.buildings.scouts, 0);
  assert.equal(s.supplies, 1e9);
});

test('보유 수 문턱(10, 25…)을 넘으면 해당 시설 생산이 2배가 되고 구매 결과가 알려준다', () => {
  assert.equal(C.milestoneMult(9), 1);
  assert.equal(C.milestoneMult(10), 2);
  assert.equal(C.milestoneMult(25), 4);
  assert.equal(C.nextMilestone(0), 10);
  assert.equal(C.nextMilestone(200), null);
  const s = fresh();
  s.supplies = 1e9;
  assert.equal(C.buyBuilding(s, 'scouts', 9).milestone, false);
  assert.equal(C.buyBuilding(s, 'scouts', 1).milestone, true);
  assert.equal(C.buildingRate(s, 'scouts'), 0.5 * 10 * 2);
});

test('항체 샘플과 막아낸 밤은 전체 생산에 곱해진다', () => {
  const s = fresh();
  s.buildings.garden = 1;
  s.antibodies = 5;      // +50%
  s.wavesCleared = 10;   // +20%
  assert.ok(Math.abs(C.productionPerSec(s) - 4 * 1.5 * 1.2) < 1e-9);
});

test('직접 수색은 장비 배수가 곱해지고 클릭 수를 센다', () => {
  const s = fresh();
  assert.equal(C.scavenge(s), 1);
  s.supplies = 1000;
  assert.equal(C.buyUpgrade(s, 'crowbar').ok, true);
  assert.equal(C.buyUpgrade(s, 'crowbar').reason, 'owned');
  assert.equal(C.buyUpgrade(s, 'ghost').reason, 'unknown');
  assert.equal(C.scavenge(s), 2);
  assert.equal(s.clicks, 2);
});

test('tick 은 생산량만큼 물자를 더하고, 잘못된 dt 는 무시한다', () => {
  const s = fresh();
  s.buildings.garden = 2; // 8/초
  assert.deepEqual(C.tick(s, 5).map(e => e.type), ['story'], '첫 tick 은 도착 일지만 연다');
  assert.equal(s.supplies, 40);
  assert.equal(s.totalEarned, 40);
  for (const bad of [0, -1, NaN, Infinity, undefined, '3']) C.tick(s, bad);
  assert.equal(s.supplies, 40);
  assert.equal(s.dayClock, 5);
});

test('밤: 방어력이 충분하면 전리품을 얻고 다음 무리가 커진다', () => {
  const s = fresh();
  s.defenses.wire = 1; // 5 + 4 = 9 ≥ 8
  const ev = nights(C.tick(s, C.DAY_SECONDS));
  assert.equal(ev.length, 1);
  assert.equal(ev[0].type, 'defended');
  assert.equal(ev[0].reward, 25);
  assert.equal(s.supplies, 25);
  assert.equal(s.wavesCleared, 1);
  assert.equal(s.day, 2);
  assert.ok(C.hordeStrength(2) > C.hordeStrength(1));
});

test('밤: 방벽이 뚫리면 물자 15%를 잃고 무리 규모는 그대로다', () => {
  const s = fresh();
  s.supplies = 1000;
  const ev = C.resolveNight(s);
  assert.equal(ev.type, 'breached');
  assert.equal(ev.lost, 150);
  assert.equal(s.supplies, 850);
  assert.equal(s.breaches, 1);
  assert.equal(s.wavesCleared, 0);
  assert.equal(s.day, 2);
});

test('긴 dt 는 여러 밤을 차례로 처리한다', () => {
  const s = fresh();
  const ev = nights(C.tick(s, C.DAY_SECONDS * 3 + 10));
  assert.equal(ev.length, 3);
  assert.equal(s.day, 4);
  assert.ok(Math.abs(s.dayClock - 10) < 1e-9);
});

test('자리 비움 보상: 효율 50%, 최대 8시간, 음수·NaN 은 0초', () => {
  const s = fresh();
  s.buildings.garden = 1; // 4/초
  const r = C.applyOffline(s, 100);
  assert.equal(r.gain, 4 * 100 * C.OFFLINE_RATE);
  assert.equal(r.capped, false);
  const long = C.applyOffline(s, 999999);
  assert.equal(long.counted, C.OFFLINE_CAP);
  assert.equal(long.capped, true);
  const before = s.supplies;
  assert.equal(C.applyOffline(s, -500).gain, 0);
  assert.equal(C.applyOffline(s, NaN).gain, 0);
  assert.equal(s.supplies, before);
  assert.equal(s.breaches, 0, '자리 비움 중에는 방벽이 뚫려도 약탈당하지 않는다');
  assert.ok(s.day > 1, '날짜는 흐른다');
});

test('이주: 조건 미달이면 거부, 충족하면 항체만 들고 새로 시작한다', () => {
  const s = fresh();
  assert.equal(C.relocate(s, 5).reason, 'not-ready');
  s.totalEarned = 4e6; s.lifetimeEarned = 4e6; s.supplies = 123; s.buildings.lab = 3; s.antibodies = 1;
  assert.equal(C.antibodiesOnRelocate(s), 1, '(10 + 1) × 0.1 = 1.1 → 1개');
  const r = C.relocate(s, 5);
  assert.equal(r.ok, true);
  assert.equal(r.state.antibodies, 2);
  assert.equal(r.state.relocations, 1);
  assert.equal(r.state.supplies, 0);
  assert.equal(r.state.buildings.lab, 0);
  assert.equal(r.state.lifetimeEarned, 4e6);
});

test('저장 → 불러오기 왕복 후 상태가 같다', () => {
  const s = fresh();
  s.supplies = 1e7;
  C.buyBuilding(s, 'workshop', 4);
  C.buyDefense(s, 'tower', 2);
  C.buyUpgrade(s, 'backpack');
  C.tick(s, 12.5);
  assert.deepEqual(C.deserialize(C.serialize(s), 1000), s);
});

test('깨진 저장 데이터는 이유가 담긴 오류를 던진다', () => {
  for (const bad of ['', '   ', 'not json', '[]', 'null', '{"version":99}', 42, undefined]) {
    assert.throws(() => C.deserialize(bad, 0), Error);
  }
});

test('sanitizeState 는 조작되거나 손상된 값을 안전한 기본값으로 되돌린다', () => {
  const s = C.sanitizeState({
    version: 1, supplies: -50, totalEarned: 'lots', day: 0, dayClock: 9999,
    buildings: { scouts: 3.9, garden: -2, hacked: 100 }, defenses: 'x',
    upgrades: { crowbar: true, dog: 'yes', fake: true }, antibodies: NaN
  }, 0);
  assert.equal(s.supplies, 0);
  assert.equal(s.totalEarned, 0);
  assert.equal(s.day, 1);
  assert.equal(s.dayClock, C.DAY_SECONDS);
  assert.equal(s.buildings.scouts, 3);
  assert.equal(s.buildings.garden, 0);
  assert.equal('hacked' in s.buildings, false);
  assert.equal(s.defenses.wire, 0);
  assert.deepEqual(s.upgrades, { crowbar: true });
  assert.equal(s.antibodies, 0);
  assert.deepEqual(C.sanitizeState(null, 7), C.createState(7));
});

test('formatNumber 는 만·억·조 단위로 줄여 쓴다', () => {
  assert.equal(C.formatNumber(0), '0');
  assert.equal(C.formatNumber(0.5), '0.5');
  assert.equal(C.formatNumber(99.99), '99.9');
  assert.equal(C.formatNumber(1234.9), '1,234');
  assert.equal(C.formatNumber(12345), '1.23만');
  assert.equal(C.formatNumber(123456789), '1.23억');
  assert.equal(C.formatNumber(5.5e12), '5.50조');
  assert.equal(C.formatNumber(1234e12), '1,234조');
  assert.equal(C.formatNumber(NaN), '0');
  assert.equal(C.formatNumber(-12345), '-1.23만');
});

/* ================= 콘텐츠 확장분 ================= */

test('연구: 한 번만 살 수 있고 생산·방어 배수가 곱으로 쌓인다', () => {
  const s = fresh();
  s.buildings.garden = 1; s.supplies = 1e12;
  assert.equal(C.buyResearch(s, 'compost').ok, true);
  assert.equal(C.buyResearch(s, 'compost').reason, 'owned');
  assert.equal(C.buyResearch(s, 'nope').reason, 'unknown');
  C.buyResearch(s, 'grid');
  assert.ok(Math.abs(C.productionPerSec(s) - 4 * 1.25 * 1.5) < 1e-9);
  C.buyResearch(s, 'drill');
  assert.equal(C.defensePower(s), Math.floor(5 * 1.25));
  const poor = fresh();
  assert.equal(C.buyResearch(poor, 'compost').reason, 'supplies');
});

test('연구·유물: 손실 비율과 자리 비움 효율을 바꾼다', () => {
  const s = fresh();
  assert.equal(C.breachLoss(s), 0.15);
  s.research.ration = true;
  assert.equal(C.breachLoss(s), 0.08);
  s.relics.medbag = true;
  assert.equal(C.breachLoss(s), 0.04);
  s.research.shift = true;
  assert.equal(C.offlineRate(s), 0.75);
  s.supplies = 1000;
  assert.equal(C.resolveNight(s).lost, 40);
});

test('원정: 잠김·중복 출발은 거부되고, 시간이 지나면 보상과 함께 돌아온다', () => {
  const s = fresh();
  s.defenses.wire = 1; // 원정 중 찾아오는 첫 밤을 막아 약탈 손실이 섞이지 않게 한다
  assert.equal(C.startExpedition(s, 'nowhere').reason, 'unknown');
  assert.equal(C.startExpedition(s, 'hospital').reason, 'locked');
  assert.equal(C.startExpedition(s, 'mart').ok, true);
  assert.equal(C.startExpedition(s, 'mart').reason, 'busy');
  assert.equal(C.tick(s, 30, () => 0.99).filter(e => e.type === 'expedition').length, 0);
  const done = C.tick(s, 60, () => 0.99).find(e => e.type === 'expedition');
  assert.equal(done.site, '동네 마트');
  assert.equal(done.reward, 60);
  assert.equal(done.relic, null, 'rng 0.99 는 유물 확률 0.3 을 넘긴다');
  assert.equal(s.expedition, null);
  assert.equal(s.expeditionsDone, 1);
  assert.equal(s.supplies, 60 + 25, '원정 보상 + 첫 밤 전리품');
});

test('원정: 유물은 확률로 한 번만 발견되고 효과가 즉시 적용된다', () => {
  const s = fresh();
  s.buildings.garden = 1;
  C.startExpedition(s, 'mart');
  const ev = C.tick(s, 90, () => 0).find(e => e.type === 'expedition');
  assert.equal(ev.relic, '손잡이 라디오');
  assert.equal(s.relics.handradio, true);
  // 유물 +10% 가 업적 보너스와 곱으로 적용된다
  assert.ok(s.achievements.exped1 && s.achievements.relic1);
  assert.ok(Math.abs(C.productionPerSec(s) - 4 * 1.1 * (1 + 0.02 * C.achievementCount(s))) < 1e-9);
  C.startExpedition(s, 'mart');
  assert.equal(C.tick(s, 90, () => 0).find(e => e.type === 'expedition').relic, null);
});

test('원정: 연구로 시간이 줄고 보상이 는다, 최고 기록으로 새 장소가 열린다', () => {
  const s = fresh();
  s.research.maps = true; s.research.caravan = true;
  assert.equal(C.expeditionDuration(s, 'mart'), 90 * 0.75);
  assert.equal(C.expeditionReward(s, 'mart'), 120);
  assert.equal(C.expeditionUnlocked(s, 'hospital'), false);
  s.bestWave = 5;
  assert.equal(C.expeditionUnlocked(s, 'hospital'), true);
});

test('자리 비움 중에도 원정대는 돌아온다', () => {
  const s = fresh();
  C.startExpedition(s, 'mart');
  const r = C.applyOffline(s, 500, () => 0.99);
  assert.equal(r.expedition.site, '동네 마트');
  assert.equal(s.expedition, null);
  assert.equal(s.supplies, 60);
});

test('구조 신호: 정해진 시간 뒤 나타나고, 무시하면 사라진다', () => {
  const s = fresh();
  assert.equal(C.answerSignal(s).reason, 'none');
  assert.ok(C.tick(s, C.SIGNAL_FIRST, () => 0).some(e => e.type === 'signal'));
  assert.equal(s.signalLeft, C.SIGNAL_WINDOW);
  assert.ok(C.tick(s, C.SIGNAL_WINDOW, () => 0).some(e => e.type === 'signal-lost'));
  assert.equal(s.signalLeft, 0);
  assert.equal(s.signalIn, 90);
});

test('구조 신호 응답: 즉시 물자 또는 30초간 생산 3배', () => {
  const a = fresh(); a.signalLeft = 10;
  const r1 = C.answerSignal(a, () => 0.1);
  assert.deepEqual([r1.kind, r1.gain], ['supplies', 50]);
  assert.equal(a.supplies, 50);
  assert.equal(a.signalsAnswered, 1);

  const b = fresh(); b.signalLeft = 10; b.buildings.garden = 1; // 4/초
  assert.equal(C.answerSignal(b, () => 0.9).kind, 'buff');
  assert.equal(C.currentRate(b), 12);
  // 40초 중 30초만 3배: 4×30×3 + 4×10
  C.tick(b, 40, () => 0.9);
  assert.equal(b.supplies, 400);
  assert.equal(b.buff, null);
});

test('변이체: 10번째 밤은 2.5배 규모, 막으면 전리품 5배와 항체 샘플 1개', () => {
  assert.equal(C.isBossWave(10), true);
  assert.equal(C.isBossWave(9), false);
  const s = fresh();
  s.wavesCleared = 9;
  assert.equal(C.nightStrength(s), Math.round(C.hordeStrength(10) * 2.5));
  s.defenses.turret = 10;
  const ev = C.resolveNight(s);
  assert.equal(ev.boss, true);
  assert.equal(ev.reward, 25 * 10 * 5);
  assert.equal(s.antibodies, 1);
  assert.equal(s.bossKills, 1);
  assert.equal(s.bestWave, 10);
});

test('업적: 조건을 채우면 한 번만 해금되고 1개당 생산 +2%', () => {
  const s = fresh();
  s.buildings.garden = 1;
  C.scavenge(s);
  const got = C.checkAchievements(s).map(a => a.id);
  assert.deepEqual(got, ['click1']);
  assert.deepEqual(C.checkAchievements(s), []);
  assert.ok(Math.abs(C.productionPerSec(s) - 4 * 1.02) < 1e-9);
  assert.ok(C.tick(fresh(), 1).every(e => e.type !== 'achievement'));
});

test('업적 정의는 ID 가 겹치지 않고 모두 판정 함수를 가진다', () => {
  const ids = C.ACHIEVEMENTS.map(a => a.id);
  assert.equal(new Set(ids).size, ids.length);
  C.ACHIEVEMENTS.forEach(a => assert.equal(typeof a.test(fresh()), 'boolean'));
  C.RELICS.forEach(r => assert.ok(C.EXPEDITIONS.some(e => e.id === r.site), r.id));
});

test('이주: 유물·업적·최고 기록은 남고 연구·원정·지원 효과는 사라진다', () => {
  const s = fresh();
  s.totalEarned = 4e6; s.lifetimeEarned = 4e6;
  s.relics.specimen = true; s.achievements.click1 = true; s.research.grid = true; s.antibodies = 30;
  s.bestWave = 30; s.bossKills = 3; s.expeditionsDone = 7;
  s.expedition = { id: 'mart', left: 10, total: 90 }; s.buff = { mult: 3, left: 5 };
  assert.equal(C.antibodiesOnRelocate(s), 4, '표본 유물: floor((10 + 30) × 0.1 × 1.1)');
  const n = C.relocate(s, 0).state;
  assert.deepEqual(n.relics, { specimen: true });
  assert.deepEqual(n.achievements, { click1: true });
  assert.deepEqual(n.research, {});
  assert.equal(n.expedition, null);
  assert.equal(n.buff, null);
  assert.deepEqual([n.bestWave, n.bossKills, n.expeditionsDone], [30, 3, 7]);
});

test('이전 버전 저장(새 필드 없음)도 기본값으로 채워져 그대로 불러온다', () => {
  const old = JSON.stringify({ version: 1, supplies: 500, wavesCleared: 12, buildings: { scouts: 20 },
    defenses: { wire: 3 }, upgrades: { crowbar: true }, day: 14, antibodies: 2 });
  const s = C.deserialize(old, 0);
  assert.equal(s.supplies, 500);
  assert.equal(s.buildings.scouts, 20);
  assert.equal(s.buildings.port, 0);
  assert.equal(s.defenses.rail, 0);
  assert.equal(s.bestWave, 12, '최고 기록은 현재 기록에서 복원');
  assert.deepEqual([s.research, s.relics, s.achievements, s.expedition, s.buff], [{}, {}, {}, null, null]);
  assert.equal(s.signalIn, C.SIGNAL_FIRST);
});

test('sanitizeState: 손상된 원정·지원 효과 값은 버린다', () => {
  const s = C.sanitizeState({ version: 1,
    expedition: { id: 'moon', left: 5, total: 10 }, buff: { mult: 999, left: 1e9 },
    relics: { rifle: 'yes', fake: true }, research: [1, 2], signalLeft: 9999 }, 0);
  assert.equal(s.expedition, null);
  assert.deepEqual(s.buff, { mult: C.BUFF_MULT, left: 300 }, '배수는 3배, 시간은 과제 보상의 5분까지');
  assert.deepEqual(s.relics, {});
  assert.deepEqual(s.research, {});
  assert.equal(s.signalLeft, C.SIGNAL_WINDOW);
  const t = C.sanitizeState({ version: 1, expedition: { id: 'mart', left: 500, total: 90 }, buff: { mult: 0, left: 5 } }, 0);
  assert.deepEqual(t.expedition, { id: 'mart', left: 90, total: 90 });
  assert.equal(t.buff, null);
});

/* ================= 구역과 이야기 ================= */
// 위치 표기: 구역 7개 × 지구 26개(A~Z). 이주 1회 = 지구 1칸.
const at = (relocations) => { const s = fresh(); s.relocations = relocations; return s; };

test('구역: 이주할 때마다 1-A → 1-B … 1-Z → 2-A 로 나아가고 7-Z 에서 멈춘다', () => {
  assert.deepEqual([C.zoneLabel(at(0)), C.nextStop(at(0)).label], ['1-A', '1-B']);
  assert.deepEqual([C.zoneLabel(at(25)), C.nextStop(at(25)).label], ['1-Z', '2-A']);
  assert.equal(C.currentZone(at(26)).no, 2);
  assert.equal(C.zoneLabel(at(181)), '7-Z');
  assert.equal(C.nextStop(at(180)).atEnd, false);
  assert.deepEqual([C.zoneLabel(at(999)), C.nextStop(at(999)).label, C.nextStop(at(999)).atEnd], ['7-Z', '7-Z', true]);
  assert.equal(C.zoneLabel(at(NaN)), '1-A', '깨진 값은 출발점으로 취급');
  assert.equal(C.LAST_STEP, 7 * 26 - 1);
});

test('구역 특성: 한 구역의 26개 지구 내내 같은 특성이 유지된다', () => {
  assert.equal(C.clickValue(at(0)), 1);
  assert.equal(C.clickValue(at(26)), 2, '2구역 재래시장: 수색 배수 2배');
  assert.equal(C.clickValue(at(51)), 2, '2-Z 까지 유지');
  assert.equal(C.defensePower(at(52)), Math.floor(5 * 1.3), '3구역 공단');
  assert.equal(C.expeditionDuration(at(78), 'mart'), 90 * 0.7, '4구역 환승역');
  const s = at(156); s.buildings.garden = 1;
  assert.equal(C.productionPerSec(s), 8, '7구역 송신탑: 생산 2배');
});

test('지구를 넘을 때마다 무리는 4%씩 커진다', () => {
  assert.equal(C.nightStrength(at(0)), 8);
  assert.equal(C.nightStrength(at(10)), Math.round(8 * Math.pow(1.04, 10)));
});

test('이주 요구 물자: 초반 40지구는 가파르게(1.75배), 그 뒤로는 완만하게(STEP_REQUIRE 배) 오른다', () => {
  const R = n => C.relocateRequirement(at(n));
  assert.equal(R(0), 1e6);
  assert.ok(Math.abs(R(1) / R(0) - 1.75) < 1e-9);
  assert.ok(Math.abs(R(40) / R(39) - 1.75) < 1e-9);
  assert.ok(C.STEP_REQUIRE > 1 && C.STEP_REQUIRE < 1.75);
  assert.ok(Math.abs(R(41) / R(40) - C.STEP_REQUIRE) < 1e-9, '41번째 지구부터 완만해진다');
  assert.ok(Math.abs(R(181) / R(180) - C.STEP_REQUIRE) < 1e-9);
  for (let n = 1; n <= 181; n++) assert.ok(R(n) > R(n - 1) && Number.isFinite(R(n)), '항상 늘고 유한하다');
  assert.equal(R(5000), R(181), '7-Z 이후로는 더 오르지 않는다');
});

test('이주 조건: 그 지구의 요구 물자를 채워야 떠날 수 있고, 못 채우면 항체도 없다', () => {
  const s = at(30);
  s.totalEarned = C.relocateRequirement(s) * 0.99;
  assert.equal(C.antibodiesOnRelocate(s), 0);
  assert.equal(C.canRelocate(s), false);
  assert.equal(C.relocate(s, 0).reason, 'not-ready');
  s.totalEarned = C.relocateRequirement(s);
  const r = C.relocate(s, 0);
  assert.equal(r.ok, true);
  assert.equal(r.label, '2-F');
  assert.equal(r.state.relocations, 31);
});

test('항체 샘플: 이주 한 번에 항체 효과가 1.1배가 되고, 더 모아도 늘지 않는다', () => {
  const s = fresh();
  s.totalEarned = 1e6;
  assert.equal(C.antibodiesOnRelocate(s), 1, '첫 이주는 1개');
  s.totalEarned = 1e12;
  assert.equal(C.antibodiesOnRelocate(s), 1, '오래 버텨도 같다(폭주 방지)');
  s.antibodies = 990; // 배수 100 → 110 이 되려면 100개
  assert.equal(C.antibodiesOnRelocate(s), 100);
  let m = fresh(), mult = [];
  for (let i = 0; i < 60; i++) { m.totalEarned = C.relocateRequirement(m); m = C.relocate(m, 0, () => 0).state; C.choosePerk(m, m.pendingPerks[0]); mult.push(1 + 0.1 * m.antibodies); }
  assert.ok(mult[59] / mult[58] > 1.09 && mult[59] / mult[58] < 1.13, '충분히 쌓인 뒤에는 이주마다 약 1.1배');
});

test('일지: A 지구 도착 즉시 1편, M·Z 지구에서 3밤을 버티면 2·3편', () => {
  const s = at(0);
  assert.deepEqual(C.checkStory(s).map(b => b.id), ['z1-0']);
  assert.deepEqual(C.checkStory(s), [], '같은 편은 다시 열리지 않는다');
  s.wavesCleared = 99;
  assert.deepEqual(C.checkStory(s), [], 'A 지구에서는 아무리 버텨도 2편이 없다');
  const m = at(12); // 1-M
  m.wavesCleared = 2;
  assert.deepEqual(C.checkStory(m).map(b => b.id), ['z1-0'], '지나쳐 온 1편은 같은 구역 안이면 열린다');
  m.wavesCleared = 3;
  assert.deepEqual(C.checkStory(m).map(b => b.id), ['z1-1']);
  const z = at(25); // 1-Z
  z.wavesCleared = 3;
  assert.deepEqual(C.checkStory(z).map(b => b.id), ['z1-0', 'z1-1', 'z1-2']);
  assert.deepEqual(C.storyLog(z).map(b => b.id), ['z1-0', 'z1-1', 'z1-2']);
});

test('일지: 이주해도 남고, 지난 구역의 못 본 편은 다음 구역에서 열리지 않는다', () => {
  const s = at(25);
  C.checkStory(s);
  s.totalEarned = C.relocateRequirement(s);
  const r = C.relocate(s, 0);
  assert.deepEqual([r.label, r.zone.no], ['2-A', 2]);
  const n = r.state;
  assert.deepEqual(n.story, { 'z1-0': true });
  n.wavesCleared = 99;
  assert.deepEqual(C.checkStory(n).map(b => b.id), ['z2-0']);
  assert.equal(n.story['z1-1'], undefined);
});

test('결말: 7-Z 에서 3밤을 버티면 마지막 일지와 업적이 열린다', () => {
  const s = at(181);
  s.wavesCleared = 3;
  const ev = C.tick(s, 1);
  assert.ok(ev.some(e => e.type === 'story' && e.id === 'z7-2'));
  assert.equal(s.achievements.ending, true);
  assert.equal(s.achievements.zone7, true);
  const early = at(180); early.wavesCleared = 99;
  C.tick(early, 1);
  assert.equal(early.story['z7-2'], undefined, '7-Y 에서는 결말이 열리지 않는다');
});

test('일지 정의: 구역마다 3편이고 저장 데이터의 모르는 키는 버린다', () => {
  C.ZONES.forEach(z => assert.equal(z.story.length, C.STORY_SECTOR.length, z.name));
  assert.equal(C.STORY_SECTOR.length, C.STORY_WAVES.length);
  assert.equal(C.BEATS.length, 21);
  assert.deepEqual(C.sanitizeState({ version: 1, story: { 'z3-1': true, 'z9-9': true, 'z1-0': 1 } }, 0).story, { 'z3-1': true });
});

/* ================= 부품 · 제작 · 상점 ================= */

test('부품: 밤을 막으면 구역 번호와 밤 수에 비례해 얻는다', () => {
  const s = fresh();
  s.defenses.wire = 1;
  const ev = C.resolveNight(s);
  assert.equal(ev.parts, 1);
  assert.equal(s.parts, 1);
  const deep = at(26); deep.wavesCleared = 9; // 2구역, 10번째 밤(변이체)
  assert.equal(C.nightParts(deep), (1 + 2) * 2 * 5);
  const lost = fresh(); C.resolveNight(lost);
  assert.equal(lost.parts, 0, '뚫린 밤에는 부품이 없다');
});

test('부품: 원정에서도 얻는다', () => {
  const s = fresh(); s.defenses.wire = 1;
  C.startExpedition(s, 'mart');
  const ev = C.tick(s, 90, () => 0.99).find(e => e.type === 'expedition');
  assert.equal(ev.parts, 1);
  assert.equal(C.expeditionParts(at(52), 'hospital'), 12, '3구역 × 병원 4개');
});

test('제작: 부품을 쓰고 레벨이 오르며 가격은 1.6배씩 는다', () => {
  const s = fresh();
  assert.equal(C.craftGear(s, 'tools').reason, 'parts');
  assert.equal(C.craftGear(s, 'nope').reason, 'unknown');
  s.parts = 100;
  assert.equal(C.gearCost(s, 'tools'), 3);
  assert.deepEqual(C.craftGear(s, 'tools'), { ok: true, cost: 3, level: 1 });
  assert.equal(C.gearCost(s, 'tools'), Math.ceil(3 * 1.6));
  assert.equal(s.parts, 97);
  s.gear.antenna = 10;
  assert.equal(C.craftGear(s, 'antenna').reason, 'max');
  assert.equal(C.gearCost(s, 'antenna'), Infinity);
});

test('제작 효과: 레벨만큼 생산·방어·수색·항체·신호 대기에 반영된다', () => {
  const s = fresh();
  s.buildings.garden = 1;
  s.gear = { tools: 3, barricade: 2, pack: 4, filter: 4, antenna: 10 };
  assert.ok(Math.abs(C.productionPerSec(s) - 4 * 1.3) < 1e-9);
  assert.equal(C.defensePower(s), Math.floor(5 * 1.2));
  assert.ok(Math.abs(C.clickValue(s) - (1.3 + 4 * 1.3 * C.CLICK_SHARE) * 2) < 1e-9, '수색 배수 2배는 그대로 2배다');
  s.totalEarned = 1e8; s.antibodies = 90; // (10 + 90) × 0.1 = 10, 필터 4레벨(+2%) → 10.2 → 10
  assert.equal(C.antibodiesOnRelocate(s), 10);
  s.gear.filter = 20; // +10% → 11
  assert.equal(C.antibodiesOnRelocate(s), 11);
  s.signalLeft = 5;
  C.answerSignal(s, () => 0);
  assert.equal(s.signalIn, 45, '안테나 10레벨: 대기 절반');
});

test('상점 · 부품 꾸러미: 살수록 1.5배씩 비싸진다', () => {
  const s = fresh();
  assert.equal(C.buyShop(s, 'bundle').reason, 'supplies');
  assert.equal(C.buyShop(s, 'what').reason, 'unknown');
  s.supplies = 1000;
  assert.equal(C.shopPrice(s, 'bundle'), 300);
  assert.deepEqual(C.buyShop(s, 'bundle'), { ok: true, cost: 300, parts: 3 });
  assert.equal(C.shopPrice(s, 'bundle'), 450);
  assert.deepEqual([s.supplies, s.parts], [700, 3]);
});

test('상점 · 용병: 오늘 밤만 방어력 1.5배, 밤이 지나면 풀린다', () => {
  const s = fresh();
  s.supplies = 1000; s.defenses.wire = 1; // 방어력 9
  assert.equal(C.buyShop(s, 'mercs').ok, true);
  assert.equal(C.buyShop(s, 'mercs').reason, 'active');
  assert.equal(C.defensePower(s), 13);
  C.resolveNight(s);
  assert.equal(s.mercs, false);
  assert.equal(C.defensePower(s), 9);
});

test('상점 · 긴급 귀환: 원정이 없으면 거부, 있으면 즉시 보상', () => {
  const s = fresh();
  s.supplies = 1000;
  assert.equal(C.buyShop(s, 'recall').reason, 'none');
  assert.equal(s.supplies, 1000, '거부된 거래는 물자를 받지 않는다');
  C.startExpedition(s, 'mart');
  const r = C.buyShop(s, 'recall', () => 0.99);
  assert.equal(r.ok, true);
  assert.equal(r.expedition.site, '동네 마트');
  assert.equal(s.expedition, null);
  assert.equal(s.supplies, 1000 - 100 + 60);
});

test('변이체 보상은 보유 항체의 1%(최소 1개)', () => {
  const s = fresh();
  s.wavesCleared = 9; s.defenses.turret = 50; s.antibodies = 400;
  const ev = C.resolveNight(s);
  assert.equal(ev.antibodies, 4);
  assert.equal(s.antibodies, 404);
});

test('이주: 부품과 제작 장비는 남고, 꾸러미 가격과 용병은 초기화된다', () => {
  const s = fresh();
  s.totalEarned = 1e6; s.parts = 17; s.gear = { tools: 2 }; s.bundlesBought = 4; s.mercs = true;
  const n = C.relocate(s, 0).state;
  assert.deepEqual([n.parts, n.gear, n.bundlesBought, n.mercs], [17, { tools: 2 }, 0, false]);
});

test('sanitizeState: 제작 레벨은 최대치로 자르고 모르는 장비는 버린다', () => {
  const s = C.sanitizeState({ version: 1, parts: -4, gear: { tools: 999, antenna: 3.7, laser: 5, pack: 'x' }, mercs: 'yes' }, 0);
  assert.equal(s.parts, 0);
  assert.deepEqual(s.gear, { tools: 30, antenna: 3 });
  assert.equal(s.mercs, false);
});

/* ================= 방치 플레이 ================= */

test('원정 반복 출발: 켜 두면 돌아오자마자 같은 곳으로 다시 떠난다', () => {
  const s = fresh(); s.defenses.wire = 1;
  C.setAutoExpedition(s, true);
  C.startExpedition(s, 'mart');
  const done = C.tick(s, 100, () => 0.99).filter(e => e.type === 'expedition');
  assert.equal(done.length, 1);
  assert.equal(s.expedition.id, 'mart');
  assert.equal(s.expedition.left, 80, '넘친 10초는 다음 원정에 이월된다');
  C.setAutoExpedition(s, 'yes');
  assert.equal(s.autoExpedition, false, '불리언 true 만 켜짐으로 인정한다');
});

test('자리 비움: 반복 원정은 흐른 시간만큼 여러 번 다녀온다', () => {
  const s = fresh();
  s.autoExpedition = true;
  C.startExpedition(s, 'mart');
  const r = C.applyOffline(s, 900, () => 0.99);
  assert.equal(r.expeditions.length, 10);
  assert.equal(s.expeditionsDone, 10);
  assert.equal(s.parts, 10);
  assert.ok(s.expedition.left > 0);
});

test('자리 비움: 막을 수 있는 밤은 막고, 못 막는 밤부터는 손실 없이 버틴다', () => {
  const s = fresh();
  s.defenses.wire = 2; // 방어력 13: 규모 8, 10, 12 까지 막고 14 에서 멈춘다
  s.supplies = 1000;
  const r = C.applyOffline(s, 600);
  assert.equal(r.nights, 3);
  assert.equal(r.held, true);
  assert.equal(r.parts, 3);
  assert.equal(r.nightReward, 25 + 50 + 75);
  assert.equal(s.wavesCleared, 3);
  assert.equal(s.breaches, 0);
  assert.equal(s.supplies, 1000 + 150);
  assert.equal(s.day, 11, '열흘이 흘렀다');
});

test('무전병: 구조 신호가 오면 알아서 응답한다', () => {
  const s = fresh();
  s.gear.operator = 1;
  const ev = C.tick(s, C.SIGNAL_FIRST, () => 0.1).find(e => e.type === 'signal-auto');
  assert.equal(ev.result.kind, 'supplies');
  assert.equal(s.signalLeft, 0);
  assert.equal(s.signalsAnswered, 1);
});

test('방벽 담당: 방어력이 모자라면 살 수 있는 만큼 방벽을 산다', () => {
  const s = fresh();
  s.gear.warden = 1; s.supplies = 40;
  const ev = C.tick(s, 1);
  assert.deepEqual(ev.find(e => e.type === 'fortified'), { type: 'fortified', count: 1 });
  assert.equal(s.defenses.wire, 1);
  assert.equal(s.supplies, 0);
  const poor = fresh(); poor.gear.warden = 1;
  assert.equal(C.autoFortify(poor), 0, '물자가 없으면 아무것도 사지 않는다');
  const safe = fresh(); safe.defenses.tower = 5; safe.supplies = 1e9;
  assert.equal(C.autoFortify(safe), 0, '이미 충분하면 사지 않는다');
});

/* ================= 다듬기: 안내와 안정성 ================= */

test('다음 할 일: 배울 순서대로 안내하고, 급한 일이 먼저 나온다', () => {
  const s = fresh();
  assert.equal(C.nextGoal(s).id, 'click');
  C.scavenge(s);
  assert.equal(C.nextGoal(s).id, 'scouts');
  s.buildings.scouts = 1;
  assert.equal(C.nextGoal(s).id, 'defend', '방어력 5 < 무리 8');
  s.defenses.tower = 5;
  assert.equal(C.nextGoal(s).id, 'expedition');
  s.expeditionsDone = 1;
  assert.equal(C.nextGoal(s).id, 'auto');
  s.autoExpedition = true;
  assert.equal(C.nextGoal(s).id, 'research');
  s.research.compost = true;
  assert.equal(C.nextGoal(s).id, 'craft');
  s.gear.tools = 1;
  s.antibodies = 5;
  assert.equal(C.nextGoal(s).id, 'serum', '항체 샘플이 모이면 혈청을 알려 준다');
  s.serums.immune = 1; s.antibodySpent = 3;
  assert.equal(C.nextGoal(s).id, 'warden');
  s.gear.warden = 1;
  assert.equal(C.nextGoal(s).id, 'builder');
  s.gear.builder = 1;
  assert.equal(C.nextGoal(s).id, 'operator');
  s.gear.operator = 1;
  assert.equal(C.nextGoal(s).id, 'quest', '배울 것을 다 배우면 이 지구의 과제를 알려 준다');
  s.quest.done = true;
  assert.equal(C.nextGoal(s).id, 'gather');
  s.totalEarned = 1e6;
  assert.deepEqual(C.nextGoal(s), { id: 'relocate', text: '1-B 지구로 떠날 수 있다. 상황 > 이주.' });
  C.ZONES.forEach((_, i) => assert.equal(typeof C.nextGoal(at(i * 26)).text, 'string'));
});

test('무작위 플레이 2만 번: 수치가 깨지지 않고 저장 왕복이 유지된다', () => {
  // 고정된 씨앗의 난수로 아무 행동이나 섞어 실행한다. 어떤 순서로 눌러도 상태가 망가지면 안 된다.
  let seed = 20261115;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = list => list[Math.floor(rng() * list.length)];
  let s = fresh();
  const actions = [
    () => C.scavenge(s),
    () => C.tick(s, rng() * 30, rng),
    () => C.tick(s, rng() * 600, rng),
    () => C.buyBuilding(s, pick(C.BUILDINGS).id, pick([1, 10, 3.7])),
    () => C.buyDefense(s, pick(C.DEFENSES).id, pick([1, 10])),
    () => C.buyUpgrade(s, pick(C.UPGRADES).id),
    () => C.buyResearch(s, pick(C.RESEARCH).id),
    () => C.craftGear(s, pick(C.GEAR).id),
    () => C.buyShop(s, pick(C.SHOP).id, rng),
    () => C.startExpedition(s, pick(C.EXPEDITIONS).id),
    () => C.setAutoExpedition(s, rng() < 0.5),
    () => C.cancelExpedition(s),
    () => C.fortify(s),
    () => C.setAuto(s, pick(['fortify', 'build', 'x']), rng() < 0.5),
    () => C.buySerum(s, pick(C.SERUMS).id),
    () => C.answerSignal(s, rng),
    () => C.applyOffline(s, rng() * 40000, rng),
    () => { const r = C.relocate(s, 0, rng); if (r.ok) s = r.state; },
    () => { if (s.pendingPerks.length) C.choosePerk(s, pick(s.pendingPerks)); },
    () => C.choosePerk(s, pick(C.PERKS).id),
    () => { s = C.deserialize(C.serialize(s), 0); }
  ];
  const finite = ['supplies', 'totalEarned', 'lifetimeEarned', 'parts', 'antibodies', 'day', 'dayClock', 'wavesCleared', 'signalIn', 'signalLeft'];
  for (let i = 0; i < 20000; i++) {
    pick(actions)();
    if (i % 50) continue;
    for (const k of finite) assert.ok(Number.isFinite(s[k]) && s[k] >= 0, `${i}번째: ${k}=${s[k]}`);
    assert.ok(s.dayClock <= C.DAY_SECONDS);
    assert.ok(Number.isFinite(C.productionPerSec(s)) && Number.isFinite(C.defensePower(s)) && Number.isFinite(C.nightStrength(s)));
    assert.equal(typeof C.nextGoal(s).text, 'string');
    if (s.expedition) assert.ok(s.expedition.left > 0 && s.expedition.left <= s.expedition.total + 1e-6);
  }
  assert.ok(s.relocations > 0, '무작위 플레이로도 이주까지 도달한다');
  assert.deepEqual(C.deserialize(C.serialize(s), 0), C.sanitizeState(s, 0));
});

/* ================= 알파 0.2: 이주 특전 ================= */
const ready = (s) => { s.totalEarned = C.relocateRequirement(s); return s; };

test('이주하면 서로 다른 특전 3장이 나오고, 고르기 전에는 다시 떠날 수 없다', () => {
  const n = C.relocate(ready(fresh()), 0, () => 0).state;
  assert.equal(n.pendingPerks.length, 3);
  assert.equal(new Set(n.pendingPerks).size, 3);
  n.pendingPerks.forEach(id => assert.ok(C.PERKS.some(k => k.id === id)));
  assert.equal(n.pendingRare, false, '같은 구역 안의 이주는 일반 보상');
  assert.equal(C.nextGoal(n).id, 'perk');
  assert.equal(C.relocate(ready(n), 0).reason, 'choose-perk');
});

test('특전 고르기: 후보에 있는 것만 고를 수 있고 레벨이 1 오른다', () => {
  const n = C.relocate(ready(fresh()), 0, () => 0).state;
  const offered = n.pendingPerks[0], other = C.PERKS.find(k => !n.pendingPerks.includes(k.id)).id;
  assert.equal(C.choosePerk(n, 'nope').reason, 'unknown');
  assert.equal(C.choosePerk(n, other).reason, 'not-offered');
  const r = C.choosePerk(n, offered);
  assert.deepEqual([r.ok, r.level, r.gained], [true, 1, 1]);
  assert.deepEqual(n.pendingPerks, []);
  assert.equal(C.choosePerk(n, offered).reason, 'not-offered', '한 번 고르면 끝');
  assert.equal(C.totalPerks(n), 1);
});

test('구역 경계를 넘는 이주는 고른 특전이 3레벨 오른다', () => {
  const n = C.relocate(ready(at(25)), 0, () => 0).state; // 1-Z → 2-A
  assert.equal(n.pendingRare, true);
  const r = C.choosePerk(n, n.pendingPerks[0]);
  assert.equal(r.gained, 3);
  assert.equal(n.pendingRare, false);
  const end = C.relocate(ready(at(181)), 0, () => 0).state; // 7-Z 재건: 구역이 바뀌지 않는다
  assert.equal(end.pendingRare, false);
});

test('특전 효과: 생산·방어·가격·부품·자리 비움 효율·시작 시설', () => {
  const s = fresh();
  s.buildings.garden = 1;
  s.perks = { harvest: 5, watch: 5, crew: 10, mason: 10, salvage: 10, shifts: 5, hands: 5 };
  assert.ok(Math.abs(C.productionPerSec(s) - 4 * 1.3) < 1e-9);
  assert.equal(C.defensePower(s), Math.floor(5 * 1.4));
  assert.equal(C.buildingCost(s, 'scouts', 1), 12, '15 × 0.8');
  assert.equal(C.defenseCost(s, 'wire', 1), 28, '40 × 0.7');
  assert.ok(Math.abs(C.clickValue(s) - (1.3 + 4 * 1.3 * C.CLICK_SHARE) * 2) < 1e-9, '풍작이 기본 수색에도 곱해지고, 빠른 손이 2배');
  assert.equal(C.offlineRate(s), 0.6);
  s.research.shift = true;
  assert.equal(C.offlineRate(s), 0.85, '연구(75%)에 더해진다');
  s.perks.shifts = 10; s.perks.crew = 20;
  assert.equal(C.offlineRate(s), 0.95);
  assert.equal(C.buildingCost(s, 'scouts', 1), 9, '할인은 60%까지: 15 × 0.6');
  s.defenses.wire = 1;
  assert.equal(C.resolveNight(s).parts, 2, '부품 1 × 2배');
  s.supplies = 100;
  assert.equal(C.maxBuildings(s, 'scouts'), C.maxAffordable(15 * 0.6, C.BUILD_GROWTH, 0, 100));
  const p = ready(fresh()); p.perks = { pioneer: 3 };
  assert.equal(C.relocate(p, 0, () => 0).state.buildings.scouts, 12, '수색조 4곳 × 3레벨');
});

test('특전은 이주해도 남고, 최대 레벨인 특전은 후보에 나오지 않는다', () => {
  const s = ready(fresh());
  C.PERKS.forEach(k => { s.perks[k.id] = k.max; });
  delete s.perks.harvest; s.perks.watch = 1;
  const n = C.relocate(s, 0, () => 0.5).state;
  assert.deepEqual([...n.pendingPerks].sort(), ['harvest', 'watch']);
  assert.equal(n.perks.crew, 20);
  C.PERKS.forEach(k => { n.perks[k.id] = k.max; });
  const m = C.relocate(ready(Object.assign(n, { pendingPerks: [] })), 0, () => 0.5).state;
  assert.deepEqual(m.pendingPerks, [], '전부 최대면 후보가 없고 다음 이주도 막히지 않는다');
  assert.equal(C.relocate(ready(m), 0).ok, true);
});

test('sanitizeState: 특전 레벨과 후보를 검증한다', () => {
  const s = C.sanitizeState({ version: 1, perks: { harvest: 999, fake: 3, crew: -1 },
    pendingPerks: ['harvest', 'harvest', 'ghost', 'watch', 'crew', 'mason'], pendingRare: true }, 0);
  assert.deepEqual(s.perks, { harvest: 60 });
  assert.deepEqual(s.pendingPerks, ['harvest', 'watch', 'crew'], '중복·모르는 것 제거, 3장까지');
  assert.equal(s.pendingRare, true);
  assert.equal(C.sanitizeState({ version: 1, pendingRare: true }, 0).pendingRare, false, '후보가 없으면 희귀 표시도 없다');
});

/* ================= 알파 0.3: 자리 비움 한도와 지구별 과제 ================= */
const withQuest = (type, reward, extra) => { const s = fresh(); const def = C.QUESTS.find(q => q.type === type); s.quest = { type, goal: def.goal, count: 0, reward, done: false }; return Object.assign(s, extra || {}); };

test('자리 비움 보상: 기본 최대 4시간·50%, 과제 보너스로 늘어나되 한도가 있다', () => {
  const s = fresh();
  assert.equal(C.offlineCap(s), 4 * 3600);
  assert.equal(C.offlineRate(s), 0.5);
  s.buildings.garden = 1; // 4/초
  const r = C.applyOffline(s, 10 * 3600);
  assert.equal(r.counted, 4 * 3600);
  assert.equal(r.gain, 4 * 4 * 3600 * 0.5);
  s.bonus.offlineCap = 3600; s.bonus.offlineRate = 0.2;
  assert.equal(C.offlineCap(s), 5 * 3600);
  assert.ok(Math.abs(C.offlineRate(s) - 0.7) < 1e-9);
  s.research.shift = true; s.perks.shifts = 10; s.bonus.offlineRate = 0.3;
  assert.equal(C.offlineRate(s), 1, '100%를 넘지 않는다');
  const big = C.sanitizeState({ version: 1, bonus: { offlineCap: 1e9, offlineRate: 5, medals: -2 } }, 0);
  assert.deepEqual(big.bonus, { offlineCap: C.OFFLINE_CAP_BONUS_MAX, offlineRate: C.OFFLINE_RATE_BONUS_MAX, medals: 0 });
});

test('과제: 첫 지구는 밤 3번 막기로 고정되고, 달성하면 보상이 자동으로 들어온다', () => {
  const s = fresh();
  assert.deepEqual(s.quest, { type: 'nights', goal: 3, count: 0, reward: 'parts', done: false });
  assert.equal(C.questText(s), '이 지구에서 밤 3번 막아내기');
  s.defenses.tower = 5;
  const ev = C.tick(s, C.DAY_SECONDS * 3).find(e => e.type === 'quest');
  assert.equal(ev.reward, '부품 8개');
  assert.equal(s.quest.done, true);
  assert.equal(s.questsDone, 1);
  assert.equal(s.parts, 3 + 8, '밤 3번의 부품 + 과제 보상');
  assert.ok(C.tick(s, C.DAY_SECONDS * 3).every(e => e.type !== 'quest'), '한 번만 지급된다');
});

test('과제 진행도: 횟수형은 해당 행동만 세고, 상태형은 지금 상태로 계산한다', () => {
  const c = withQuest('click', 'parts');
  C.scavenge(c); C.scavenge(c);
  assert.equal(C.questProgress(c), 2);
  c.signalLeft = 5; C.answerSignal(c, () => 0);
  assert.equal(C.questProgress(c), 2, '다른 종류의 행동은 세지 않는다');
  const b = withQuest('build', 'parts'); b.buildings.scouts = 30; b.buildings.garden = 12;
  assert.equal(C.questProgress(b), 42);
  const r = withQuest('research', 'parts'); r.research = { compost: true, drill: true };
  assert.equal(C.questProgress(r), 2);
  const d = withQuest('defense', 'parts'); d.defenses.tower = 1; // 방어력 35 / 무리 8
  assert.equal(C.questProgress(d), 4.3);
  const e = withQuest('earn', 'parts'); e.totalEarned = 1.5e6;
  assert.equal(C.questProgress(e), 1.5);
  const x = withQuest('exped', 'parts'); x.defenses.wire = 1; x.autoExpedition = true; C.startExpedition(x, 'mart');
  C.tick(x, 200, () => 0.99);
  assert.equal(C.questProgress(x), 2);
  const g = withQuest('craft', 'medal'); g.parts = 10; C.craftGear(g, 'tools');
  assert.equal(C.checkQuest(g).reward, '훈장 1개 (생산 +1% 영구)');
  const boss = withQuest('boss', 'parts', { wavesCleared: 9 }); boss.defenses.turret = 50; C.resolveNight(boss);
  assert.equal(C.questProgress(boss), 1);
  assert.equal(C.questProgress(Object.assign(fresh(), { quest: null })), 0);
});

test('과제 보상 8종이 각각 올바르게 지급된다', () => {
  const done = (reward, extra) => { const s = withQuest('click', reward, extra); s.quest.count = 999; return [s, C.checkQuest(s, () => 0)]; };
  let [s, ev] = done('supplies'); assert.equal(s.supplies, 200, '생산이 없어도 최소 200');
  [s, ev] = done('buff'); assert.deepEqual(s.buff, { mult: 2, left: 300 });
  [s, ev] = done('antibody', { antibodies: 500 }); assert.equal(s.antibodies, 515);
  [s, ev] = done('antibody'); assert.equal(s.antibodies, 1, '최소 1개');
  [s, ev] = done('medal'); s.buildings.garden = 1; assert.ok(Math.abs(C.productionPerSec(s) - 4 * 1.01) < 1e-9);
  [s, ev] = done('offlineCap'); assert.equal(C.offlineCap(s), 4 * 3600 + 600); assert.equal(ev.reward, '자리 비움 보상 시간 +10분 (지금 4시간 10분)');
  [s, ev] = done('offlineRate'); assert.ok(Math.abs(C.offlineRate(s) - 0.51) < 1e-9);
  [s, ev] = done('perk'); assert.equal(s.pendingPerks.length, 3); assert.equal(s.pendingRare, false);
  [s, ev] = done('perk', { pendingPerks: ['harvest'] }); assert.equal(ev.reward, '부품 8개', '이미 고르는 중이면 부품으로 대신한다');
  [s, ev] = done('parts', { relocations: 60 }); assert.equal(s.parts, 24, '3구역: 8 × 3');
});

test('과제 생성: 이주하면 새 과제가 주어지고, 한도에 닿은 보상은 나오지 않는다', () => {
  const a = fresh(); a.totalEarned = 1e6; a.quest.count = 2; a.questsDone = 4; a.bonus.medals = 3;
  const n = C.relocate(a, 0, () => 0.5).state;
  assert.equal(n.quest.count, 0);
  assert.equal(n.quest.done, false);
  assert.ok(C.QUESTS.some(q => q.type === n.quest.type && q.goal === n.quest.goal));
  assert.deepEqual([n.questsDone, n.bonus.medals], [4, 3], '달성 기록과 보너스는 이주해도 남는다');
  const full = fresh(); full.bonus.offlineCap = C.OFFLINE_CAP_BONUS_MAX; full.bonus.offlineRate = C.OFFLINE_RATE_BONUS_MAX;
  let seed = 7; const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const seen = new Set(), types = new Set();
  for (let i = 0; i < 3000; i++) { const q = C.generateQuest(full, rng); seen.add(q.reward); types.add(q.type); }
  assert.equal(seen.has('offlineCap') || seen.has('offlineRate'), false);
  assert.equal(seen.size, C.QUEST_REWARDS.length - 2);
  assert.equal(types.size, C.QUESTS.length, '모든 종류의 과제가 나온다');
});

test('과제가 없는 이전 저장은 다음 tick 에서 과제를 받는다', () => {
  const s = C.deserialize(JSON.stringify({ version: 1, supplies: 5, relocations: 30 }), 0);
  assert.equal(s.quest, null);
  C.tick(s, 1, () => 0.3);
  assert.ok(s.quest && s.quest.goal > 0);
  const bad = C.sanitizeState({ version: 1, quest: { type: 'fly', goal: 3, reward: 'parts' } }, 0);
  assert.equal(bad.quest, null, '모르는 종류의 과제는 버린다');
});

/* ================= 알파 0.3.1: 원정 강제 귀환 ================= */

test('강제 귀환: 보상 없이 원정이 끝나고, 과제·업적의 원정 횟수에 들어가지 않는다', () => {
  const s = withQuest('exped', 'parts');
  assert.equal(C.cancelExpedition(s).reason, 'none', '나가 있는 원정대가 없으면 거부');
  s.defenses.wire = 1; s.autoExpedition = true;
  C.startExpedition(s, 'mart');
  C.tick(s, 30, () => 0);
  const before = [s.supplies, s.parts];
  const r = C.cancelExpedition(s);
  assert.equal(r.ok, true);
  assert.equal(r.site, '동네 마트');
  assert.equal(r.wasted, 30);
  assert.equal(s.expedition, null, '반복 출발이 켜져 있어도 다시 떠나지 않는다');
  assert.deepEqual([s.supplies, s.parts], before);
  assert.equal(s.expeditionsDone, 0);
  assert.equal(C.questProgress(s), 0);
  assert.deepEqual(s.relics, {});
  assert.equal(C.startExpedition(s, 'mart').ok, true, '바로 다시 보낼 수 있다');
});

test('시설 최대치: 500곳까지만 지을 수 있고, 묶음 구매는 남은 자리만큼만 산다', () => {
  const s = fresh();
  s.supplies = Infinity; s.buildings.scouts = 495;
  const r = C.buyBuilding(s, 'scouts', 10);
  assert.deepEqual([r.ok, r.qty], [true, 5]);
  assert.equal(s.buildings.scouts, C.BUILDING_MAX);
  assert.equal(C.buyBuilding(s, 'scouts', 1).reason, 'max');
  assert.equal(C.maxBuildings(s, 'scouts'), 0);
  s.buildings.garden = 498; s.supplies = 1e300;
  assert.equal(C.maxBuildings(s, 'garden'), 2, '물자가 넘쳐도 남은 자리까지만');
  assert.equal(C.sanitizeState({ version: 1, buildings: { scouts: 99999 } }, 0).buildings.scouts, C.BUILDING_MAX);
  assert.equal(C.checkAchievements(s).some(a => a.id === 'buildMax'), true);
});

/* ================= 알파 0.3.2: 방어 안내 ================= */

test('방어 계획: 오늘 밤을 막는 데 필요한 방벽과 비용을 알려 주되 실제로 사지는 않는다', () => {
  const s = fresh(); // 방어력 5, 무리 8
  const plan = C.defensePlan(s);
  assert.deepEqual(plan.items, [{ id: 'wire', name: '철조망', count: 1 }]);
  assert.equal(plan.short, 3);
  assert.equal(plan.cost, 40);
  assert.equal(plan.affordable, false);
  assert.equal(s.defenses.wire, 0, '계산만 한다');
  s.defenses.tower = 1;
  assert.deepEqual(C.defensePlan(s), { short: 0, cost: 0, items: [], affordable: true });
});

test('방어 계획은 실제로 그만큼 사면 오늘 밤을 막을 수 있다(여러 지구·밤에서 확인)', () => {
  for (const [reloc, waves] of [[0, 0], [0, 12], [10, 29], [60, 19], [181, 40]]) {
    const s = at(reloc); s.wavesCleared = waves; s.supplies = Infinity;
    const plan = C.defensePlan(s);
    assert.ok(plan.items.length > 0 && Number.isFinite(plan.cost));
    let cost = 0;
    plan.items.forEach(it => { cost += C.defenseCost(s, it.id, it.count); C.buyDefense(s, it.id, it.count); });
    assert.ok(C.defensePower(s) >= C.nightStrength(s), `지구 ${reloc}, 밤 ${waves + 1}`);
    assert.equal(cost, plan.cost, '안내한 비용과 실제 비용이 같다');
  }
});

test('한 번에 보강: 물자가 충분할 때만 계획대로 사고, 이미 안전하면 사지 않는다', () => {
  const s = fresh();
  s.wavesCleared = 12; // 무리 71
  s.supplies = 10;
  assert.equal(C.fortify(s).reason, 'supplies');
  assert.equal(C.defensePower(s), 5, '모자라면 일부만 사지 않는다');
  s.supplies = 1e6;
  const plan = C.defensePlan(s), r = C.fortify(s);
  assert.equal(r.ok, true);
  assert.ok(C.defensePower(s) >= C.nightStrength(s));
  assert.ok(Math.abs((1e6 - s.supplies) - plan.cost) < 1e-6);
  assert.equal(C.fortify(s).reason, 'safe');
});

test('방벽별 필요 개수: 그 방벽만으로 막으려면 몇 개인지, 배수와 용병을 반영한다', () => {
  const s = fresh(); s.wavesCleared = 12; // 무리 71, 방어력 5 → 66 모자람
  assert.equal(C.defenseNeeded(s, 'wire'), 17);   // 4 × 17 = 68
  assert.equal(C.defenseNeeded(s, 'tower'), 3);   // 30 × 3 = 90
  assert.equal(C.defenseNeeded(s, 'turret'), 1);
  assert.equal(C.defenseNeeded(s, 'nope'), 0);
  s.research.drill = true; // ×1.25: (5 + 4n) × 1.25 ≥ 71 → n = 13
  assert.equal(C.defenseNeeded(s, 'wire'), 13);
  s.mercs = true;          // ×1.5 추가: (5 + 4n) × 1.875 ≥ 71 → n = 9
  assert.equal(C.defenseNeeded(s, 'wire'), 9);
  s.defenses.turret = 5;
  assert.equal(C.defenseNeeded(s, 'wire'), 0, '이미 충분하면 0');
  for (const d of C.DEFENSES) { const x = fresh(); x.wavesCleared = 30; const n = C.defenseNeeded(x, d.id); x.defenses[d.id] = n; assert.ok(C.defensePower(x) >= C.nightStrength(x)); x.defenses[d.id] = n - 1; assert.ok(n === 1 || C.defensePower(x) < C.nightStrength(x), d.id + ': 꼭 필요한 최소 개수'); }
});

test('밤 예고: 앞으로 올 무리 규모와 변이체 밤을 알려 준다', () => {
  const s = fresh(); s.wavesCleared = 7; // 다음은 8번째 밤
  const f = C.nightForecast(s, 4);
  assert.deepEqual(f.map(n => n.wave), [8, 9, 10, 11]);
  assert.deepEqual(f.map(n => n.boss), [false, false, true, false]);
  assert.equal(f[0].strength, C.nightStrength(s), '첫 항목은 오늘 밤과 같다');
  assert.equal(f[2].strength, Math.round(C.hordeStrength(10) * 2.5));
  assert.ok(f[3].strength < f[2].strength, '변이체 밤 다음은 다시 평소 규모');
  assert.equal(C.nightForecast(at(26), 1)[0].strength, C.nightStrength(at(26)), '지구 보정이 반영된다');
});

/* ================= 알파 0.3.2: 혈청(항체 샘플 사용처) ================= */

test('혈청: 항체 샘플로 사고, 가격은 레벨마다 3배, 써도 생산 보너스는 줄지 않는다', () => {
  const s = fresh();
  s.buildings.garden = 1;
  assert.equal(C.buySerum(s, 'immune').reason, 'antibodies');
  assert.equal(C.buySerum(s, 'nope').reason, 'unknown');
  s.antibodies = 20;
  const before = C.productionPerSec(s);
  assert.deepEqual(C.buySerum(s, 'immune'), { ok: true, cost: 3, level: 1 });
  assert.deepEqual(C.buySerum(s, 'immune'), { ok: true, cost: 9, level: 2 });
  assert.equal(C.serumCost(s, 'immune'), 27);
  assert.equal(C.antibodiesFree(s), 8);
  assert.equal(C.buySerum(s, 'immune').reason, 'antibodies', '남은 8개로는 27개짜리를 못 산다');
  assert.equal(s.antibodies, 20, '총량은 그대로');
  assert.equal(C.productionPerSec(s), before, '생산은 줄지 않는다');
  s.serums.calm = 10;
  assert.equal(C.buySerum(s, 'calm').reason, 'max');
  assert.equal(C.serumCost(s, 'calm'), Infinity);
});

test('혈청 효과: 방어력, 무리 규모, 수색, 원정 시간, 부품, 자리 비움', () => {
  const s = fresh();
  s.serums = { immune: 2, calm: 5, focus: 2, sense: 5, salv: 5, vigil: 5, endure: 3 };
  assert.equal(C.defensePower(s), Math.floor(5 * 1.3));
  assert.equal(C.nightStrength(s), Math.round(8 * 0.85));
  assert.equal(C.nightForecast(s, 1)[0].strength, C.nightStrength(s), '예고에도 반영된다');
  assert.equal(C.clickValue(s), 2);
  assert.equal(C.expeditionDuration(s, 'mart'), 90 * 0.8);
  assert.equal(C.expeditionParts(s, 'hospital'), 6, '4 × 1.5');
  assert.equal(C.offlineRate(s), 0.6);
  assert.equal(C.offlineCap(s), 4 * 3600 + 3600);
  s.serums.calm = 10;
  assert.equal(C.nightStrength(s), Math.round(8 * 0.7), '최대 30% 감소');
});

test('혈청과 쓴 항체는 이주해도 남고, 저장 데이터의 쓴 양은 총량을 넘지 못한다', () => {
  const s = fresh(); s.totalEarned = 1e6; s.antibodies = 50; s.antibodySpent = 12; s.serums = { immune: 2 };
  const n = C.relocate(s, 0, () => 0).state;
  assert.deepEqual([n.antibodySpent, n.serums], [12, { immune: 2 }]);
  assert.equal(C.antibodiesFree(n), n.antibodies - 12);
  const bad = C.sanitizeState({ version: 1, antibodies: 10, antibodySpent: 999, serums: { immune: 99, fake: 2 } }, 0);
  assert.equal(bad.antibodySpent, 10);
  assert.deepEqual(bad.serums, { immune: 30 });
  assert.equal(C.antibodiesFree(bad), 0);
});

/* ================= 알파 0.3.5: 농성 ================= */

test('농성: 처음 뚫린 밤에만 물자를 잃고, 그 뒤 못 막는 밤은 손실 없이 버틴다', () => {
  const s = fresh();
  s.supplies = 1000;
  const first = C.resolveNight(s);
  assert.deepEqual([first.type, first.lost, s.supplies, s.siege, s.breaches], ['breached', 150, 850, true, 1]);
  for (let i = 0; i < 5; i++) {
    const ev = C.resolveNight(s);
    assert.equal(ev.type, 'held');
    assert.equal(ev.strength, 8, '무리 규모는 그대로');
  }
  assert.deepEqual([s.supplies, s.breaches, s.wavesCleared, s.parts], [850, 1, 0, 0], '더 잃지도, 얻지도 않는다');
  assert.equal(s.day, 7, '날짜는 흐른다');
});

test('농성은 한 번 막아내면 풀리고, 다시 뚫리면 다시 한 번 잃는다', () => {
  const s = fresh();
  s.supplies = 1000;
  C.resolveNight(s);            // 뚫림 → 농성
  s.defenses.wire = 1;          // 방어력 9 ≥ 8
  const win = C.resolveNight(s);
  assert.deepEqual([win.type, s.siege], ['defended', false]);
  const after = s.supplies;     // 850 + 전리품 25
  const again = C.resolveNight(s); // 다음 무리 10 > 9
  assert.equal(again.type, 'breached');
  assert.ok(Math.abs(again.lost - after * 0.15) < 1e-9);
  assert.equal(s.breaches, 2);
});

test('켜 둔 채 방벽을 챙기지 않아도 30분 동안 한 번만 빼앗긴다', () => {
  const s = fresh(); s.buildings.scouts = 20; s.buildings.garden = 10;
  let lost = 0, breached = 0, held = 0;
  for (let t = 0; t < 1800; t++) for (const ev of C.tick(s, 1, () => 0.5)) {
    if (ev.type === 'breached') { breached++; lost += ev.lost; }
    if (ev.type === 'held') held++;
  }
  assert.deepEqual([breached, held], [1, 29]);
  assert.ok(lost / s.totalEarned < 0.01, '빼앗긴 물자는 번 물자의 1% 미만');
  assert.ok(s.supplies > s.totalEarned * 0.95);
});

test('농성 상태는 저장되고, 이주하면 풀린다', () => {
  const s = fresh(); s.siege = true; s.totalEarned = 1e6;
  assert.equal(C.deserialize(C.serialize(s), 0).siege, true);
  assert.equal(C.sanitizeState({ version: 1, siege: 'yes' }, 0).siege, false);
  assert.equal(C.relocate(s, 0, () => 0).state.siege, false);
});

/* ================= 알파 0.3.5: 자동화 켬/끔과 자동 건설 ================= */

test('방벽 담당은 끄면 보강하지 않고, 다시 켜면 보강한다', () => {
  const s = fresh();
  s.gear.warden = 1; s.supplies = 1000;
  assert.equal(C.autoActive(s, 'fortify'), true, '장비가 있으면 기본은 켜짐');
  assert.deepEqual(C.setAuto(s, 'fortify', false), { ok: true, on: false });
  C.tick(s, 1);
  assert.equal(s.defenses.wire, 0);
  assert.equal(s.supplies, 1000);
  C.setAuto(s, 'fortify', true);
  assert.ok(C.tick(s, 1).some(e => e.type === 'fortified'));
  assert.ok(C.defensePower(s) >= C.nightStrength(s));
  assert.equal(C.setAuto(s, 'nope', true).reason, 'unknown');
  assert.equal(C.setAuto(s, 'build', 'yes').on, false, '불리언 true 만 켜짐으로 인정한다');
  const none = fresh();
  assert.equal(C.autoActive(none, 'fortify'), false, '장비가 없으면 켜 둬도 동작하지 않는다');
});

test('자리 비움 중의 자동 보강도 켬/끔을 따른다', () => {
  const on = fresh(); on.gear.warden = 1; on.supplies = 1e6;
  assert.ok(C.applyOffline(on, 600).nights >= 10);
  const off = fresh(); off.gear.warden = 1; off.supplies = 1e6; C.setAuto(off, 'fortify', false);
  const r = C.applyOffline(off, 600);
  assert.deepEqual([r.nights, r.held], [0, true]);
});

test('건설 담당: 회수가 가장 빠른 시설부터 짓고, 끄면 짓지 않는다', () => {
  const s = fresh();
  s.defenses.tower = 5; s.supplies = 200;
  assert.equal(C.autoBuild(s) > 0, true);
  assert.ok(s.buildings.scouts > 0 && s.buildings.garden > 0, '값 대비 생산이 좋은 수색조와 텃밭을 섞어 산다');
  assert.ok(s.supplies < 15, '살 수 있는 것이 없을 때까지 짓는다');
  const t = fresh(); t.gear.builder = 1; t.defenses.tower = 5; t.supplies = 500;
  assert.ok(C.tick(t, 1).some(e => e.type === 'built'));
  const off = fresh(); off.gear.builder = 1; off.defenses.tower = 5; off.supplies = 500; C.setAuto(off, 'build', false);
  assert.ok(C.tick(off, 1).every(e => e.type !== 'built'));
  assert.equal(off.supplies, 500);
});

test('건설 담당은 오늘 밤을 못 막는 동안에는 짓지 않고, 한 번에 25채까지만 짓고, 최대치를 넘지 않는다', () => {
  const unsafe = fresh(); unsafe.supplies = 1e6;
  assert.equal(C.autoBuild(unsafe), 0, '방벽에 쓸 물자를 먼저 써 버리지 않는다');
  const rich = fresh(); rich.defenses.tower = 5; rich.supplies = 1e12;
  assert.equal(C.autoBuild(rich), 25);
  const full = fresh(); full.defenses.tower = 5; full.supplies = Infinity;
  C.buildingsFor(full).forEach(b => { full.buildings[b.id] = C.BUILDING_MAX; }); // 공통 시설 + 이 구역의 고유 시설
  assert.equal(C.autoBuild(full), 0);
});

test('자동화 설정은 저장되고 이주해도 유지된다. 이전 저장은 켜짐으로 읽는다', () => {
  const s = fresh(); s.totalEarned = 1e6; C.setAuto(s, 'build', false);
  assert.deepEqual(C.deserialize(C.serialize(s), 0).auto, { fortify: true, build: false });
  assert.deepEqual(C.relocate(s, 0, () => 0).state.auto, { fortify: true, build: false });
  assert.deepEqual(C.sanitizeState({ version: 1 }, 0).auto, { fortify: true, build: true });
  assert.deepEqual(C.sanitizeState({ version: 1, auto: 'x' }, 0).auto, { fortify: true, build: true });
});

/* ================= 첫걸음(튜토리얼)과 안내 ================= */

test('첫걸음: 새 게임은 0/8 에서 시작하고 잔해 수색부터 권한다', () => {
  const t = C.tutorial(fresh());
  assert.equal(t.total, C.TUTORIAL.length);
  assert.equal(t.count, 0);
  assert.equal(t.done, false);
  assert.equal(t.current.id, 'search');
  assert.deepEqual(t.steps.map(s => s.id), ['search', 'build', 'wall', 'night', 'expedition', 'research', 'signal', 'relocate']);
});

test('첫걸음: 한 일은 표시되고 다음 단계로 넘어간다', () => {
  const s = fresh();
  C.scavenge(s);
  assert.equal(C.tutorial(s).current.id, 'build');
  s.buildings.scouts = 1;
  assert.equal(C.tutorial(s).current.id, 'wall');
  s.defenses[C.DEFENSES[0].id] = 1;
  assert.equal(C.tutorial(s).current.id, 'night');
  s.bestWave = 1;
  const t = C.tutorial(s);
  assert.equal(t.current.id, 'expedition');
  assert.equal(t.count, 4);
});

test('첫걸음: 기다려야 하는 단계는 다른 단계를 막지 않는다', () => {
  const s = fresh();
  C.scavenge(s); s.buildings.scouts = 1; s.defenses[C.DEFENSES[0].id] = 1; s.bestWave = 1;
  s.expedition = { id: 'mart', left: 50, total: 90 };
  assert.equal(C.tutorial(s).current.id, 'research', '원정대가 나가 있는 동안에는 연구를 권한다');
  s.research[C.RESEARCH[0].id] = true;
  assert.equal(C.tutorial(s).current.id, 'relocate', '원정도 신호도 기다리는 중이면 물자를 모아 이주하라고 권한다');
  s.expedition = null; s.expeditionsDone = 1;
  assert.equal(C.tutorial(s).current.id, 'relocate', '신호가 없을 때는 신호 단계를 건너뛴다');
  s.signalLeft = 10;
  assert.equal(C.tutorial(s).current.id, 'signal', '신호가 떠 있으면 신호 단계가 먼저다');
  assert.ok(C.answerSignal(s, () => 0.9).ok);
  assert.equal(C.tutorial(s).current.id, 'relocate');
});

test('첫걸음: 한 번이라도 이주했으면 끝난 것으로 본다', () => {
  const s = fresh();
  s.relocations = 1; // 이주 직후에는 시설·방벽이 비어 있다
  const t = C.tutorial(s);
  assert.equal(t.done, true);
  assert.equal(t.count, t.total);
  assert.equal(t.current, null);
});

test('첫걸음: 깨진 상태에서도 멈추지 않는다', () => {
  const s = fresh();
  s.research = null; // 연구 단계의 조건이 오류를 낸다
  const t = C.tutorial(s);
  assert.equal(t.steps.find(x => x.id === 'research').done, false);
  assert.equal(typeof t.current.text, 'string');
});

test('안내: 첫걸음 중에는 단계와 갈 곳을, 끝난 뒤에는 평소 안내를 보여 준다', () => {
  const s = fresh();
  let g = C.guide(s);
  assert.equal(g.label, '첫걸음 1/8');
  assert.equal(g.id, 'tutorial-search');
  C.scavenge(s);
  g = C.guide(s);
  assert.equal(g.label, '첫걸음 2/8');
  assert.deepEqual([g.view, g.tab], ['manage', 'buildings']);
  s.buildings.scouts = 1;
  g = C.guide(s);
  assert.equal(g.id, 'tutorial-wall', '방벽 단계에서는 "방어 부족" 경고 대신 첫걸음 문장을 보여 준다');
  assert.deepEqual([g.view, g.tab], ['manage', 'defenses']);

  const v = fresh(); v.relocations = 1;
  assert.equal(C.guide(v).label, '다음 할 일');
  assert.equal(C.guide(v).id, C.nextGoal(v).id);
});

test('안내: 급한 일은 첫걸음보다 먼저 나온다', () => {
  const s = fresh();
  C.scavenge(s); s.buildings.scouts = 1; s.defenses[C.DEFENSES[0].id] = 1; s.bestWave = 1;
  s.defenses[C.DEFENSES[0].id] = 0; s.defenses.tower = 0; // 방어력 5 < 무리
  s.wavesCleared = 5;
  const g = C.guide(s);
  // 방벽 단계는 아직 안 한 것으로 돌아가므로 첫걸음의 방벽 문장이 나온다
  assert.equal(g.id, 'tutorial-wall');
  s.defenses[C.DEFENSES[0].id] = 1; // 방벽 단계는 했지만 여전히 모자란 경우
  assert.ok(C.defensePower(s) < C.nightStrength(s));
  const d = C.guide(s);
  assert.equal(d.id, 'defend');
  assert.equal(d.label, '다음 할 일');
  assert.deepEqual([d.view, d.tab], ['manage', 'defenses']);
});

test('구조 신호: 물자 보상은 생산량의 SIGNAL_SUPPLY_SECONDS 초치, 최소 SIGNAL_SUPPLY_MIN', () => {
  const s = fresh();
  s.signalLeft = 10;
  const r = C.answerSignal(s, () => 0.1);
  assert.equal(r.kind, 'supplies');
  assert.equal(r.gain, Math.max(C.SIGNAL_SUPPLY_MIN, C.productionPerSec(s) * C.SIGNAL_SUPPLY_SECONDS));
  const rich = fresh(); rich.buildings.scouts = 50; rich.signalLeft = 10;
  const before = C.productionPerSec(rich);
  assert.equal(C.answerSignal(rich, () => 0.1).gain, before * C.SIGNAL_SUPPLY_SECONDS);
});

/* ================= 구역 고유 콘텐츠 ================= */

test('구역 고유 시설·방벽: 구역마다 하나씩 있고, 그 구역에서만 목록에 나온다', () => {
  assert.equal(C.ZONE_BUILDINGS.length, C.ZONES.length);
  assert.equal(C.ZONE_DEFENSES.length, C.ZONES.length);
  const ids = C.ALL_BUILDINGS.map(b => b.id).concat(C.ALL_DEFENSES.map(d => d.id));
  assert.equal(new Set(ids).size, ids.length, 'id 가 겹치지 않는다');
  C.ZONES.forEach((_, i) => {
    const s = at(i * C.SECTORS + 3);
    assert.equal(C.zoneBuilding(s).zone, i);
    assert.equal(C.zoneDefense(s).zone, i);
    assert.equal(C.buildingsFor(s).length, C.BUILDINGS.length + 1);
    assert.equal(C.defensesFor(s).length, C.DEFENSES.length + 1);
    assert.ok(C.buildingsFor(s).includes(C.zoneBuilding(s)));
  });
});

test('구역 고유 시설: 그 구역에서는 사서 생산에 보태고, 다른 구역에서는 살 수 없다', () => {
  const home = fresh(); home.supplies = 1e6;
  const before = C.productionPerSec(home);
  assert.ok(C.buyBuilding(home, 'z1kitchen', 2).ok);
  assert.equal(home.buildings.z1kitchen, 2);
  assert.ok(C.productionPerSec(home) > before);
  assert.equal(C.buyBuilding(home, 'z2stall', 1).ok, false, '2구역 시설은 1구역에서 못 짓는다');
  assert.equal(C.buildingCost(home, 'z2stall', 1), Infinity);
  assert.equal(C.maxBuildings(home, 'z2stall'), 0);

  const market = at(C.SECTORS); market.supplies = 1e7;
  assert.ok(C.buyBuilding(market, 'z2stall', 1).ok);
  assert.equal(C.buyBuilding(market, 'z1kitchen', 1).ok, false);
});

test('구역 고유 방벽: 방어력에 들어가고, 방어 계획과 자동 보강이 함께 고려한다', () => {
  const s = fresh(); s.supplies = 1e6;
  const before = C.defensePower(s);
  assert.ok(C.buyDefense(s, 'z1cars', 1).ok);
  assert.equal(C.defensePower(s), before + 16);
  assert.equal(C.buyDefense(s, 'z3steel', 1).ok, false);
  assert.equal(C.defenseNeeded(s, 'z3steel'), 0, '살 수 없는 방벽은 필요 수를 계산하지 않는다');
  // 값 대비 방어력이 좋으므로 자동 보강이 고유 방벽을 쓴다
  const auto = fresh(); auto.supplies = 1e5; auto.wavesCleared = 12;
  C.autoFortify(auto);
  assert.ok(C.defensePower(auto) >= C.nightStrength(auto));
  assert.ok(auto.defenses.z1cars > 0);
});

test('구역 고유 시설·방벽: 이주하면 사라지고, 다른 구역의 것이 든 저장은 버린다', () => {
  const s = at(C.SECTORS - 1); s.supplies = 1e6; s.totalEarned = 1e30;
  C.buyBuilding(s, 'z1kitchen', 3); C.buyDefense(s, 'z1cars', 3);
  const next = C.relocate(s, 0, () => 0).state; // 1-Z → 2-A
  assert.equal(C.zoneIndex(next), 1);
  assert.equal(next.buildings.z1kitchen, 0);
  assert.equal(next.defenses.z1cars, 0);
  const tampered = C.sanitizeState({ version: 1, relocations: 0, buildings: { z1kitchen: 4, z5pharma: 9 }, defenses: { z1cars: 2, z7grid: 9 } }, 0);
  assert.equal(tampered.buildings.z1kitchen, 4);
  assert.equal(tampered.buildings.z5pharma, 0);
  assert.equal(tampered.defenses.z7grid, 0);
  assert.equal(C.productionPerSec(tampered), C.buildingRate(tampered, 'z1kitchen'));
});

test('구역 고유 시설·방벽: 바로 위 가격대의 공통 항목보다 값 대비 효율이 좋다', () => {
  // 고유 항목은 두 공통 항목 사이의 가격대에 끼어든다. 그 위의 공통 항목보다 효율이 좋아야 지을 이유가 생긴다.
  C.ZONE_BUILDINGS.forEach(z => {
    const pricier = C.BUILDINGS.find(b => b.baseCost > z.baseCost);
    if (pricier) assert.ok(z.baseRate / z.baseCost > pricier.baseRate / pricier.baseCost, z.id);
    else assert.ok(z.baseRate > C.BUILDINGS[C.BUILDINGS.length - 1].baseRate, z.id + ': 가장 비싼 시설이면 생산도 가장 크다');
  });
  C.ZONE_DEFENSES.forEach(z => {
    const pricier = C.DEFENSES.find(d => d.baseCost > z.baseCost);
    if (pricier) assert.ok(z.power / z.baseCost > pricier.power / pricier.baseCost, z.id);
    else assert.ok(z.power > C.DEFENSES[C.DEFENSES.length - 1].power, z.id);
  });
});

test('무리 성격: 구역마다 하나씩 있고 1구역은 규칙을 바꾸지 않는다', () => {
  C.ZONES.forEach(z => { assert.ok(z.horde && z.horde.name && z.horde.desc, z.name); });
  const s = fresh(); s.wavesCleared = 4;
  assert.equal(C.nightStrength(s), Math.round(C.hordeStrength(5) * C.zoneThreat(s)));
  assert.equal(C.breachLoss(s), C.BREACH_LOSS);
});

test('무리 성격: 떼거리는 3번째 밤마다 규모와 전리품이 1.5배, 변이체 밤과는 겹치지 않는다', () => {
  const s = at(C.SECTORS);
  s.wavesCleared = 1; // 2번째 밤
  const normal = C.nightStrength(s), normalReward = C.hordeReward(s);
  assert.equal(C.isSurgeWave(s, 2), false);
  s.wavesCleared = 2; // 3번째 밤
  assert.equal(C.isSurgeWave(s, 3), true);
  assert.equal(C.nightStrength(s), Math.round(C.hordeStrength(3) * 1.5 * C.zoneThreat(s)));
  assert.ok(C.nightStrength(s) > normal);
  assert.ok(Math.abs(C.hordeReward(s) / (Math.max(75, C.productionPerSec(s) * 15)) - 1.5) < 1e-9);
  assert.ok(normalReward > 0);
  assert.equal(C.isSurgeWave(s, 30), false, '30번째 밤은 변이체 밤이다');
  assert.equal(C.isSurgeWave(fresh(), 3), false, '1구역에는 없다');
  const f = C.nightForecast(s, 2);
  assert.deepEqual(f.map(n => n.surge), [true, false]);
  assert.equal(f[0].strength, C.nightStrength(s), '예보와 실제가 같은 식을 쓴다');
});

test('무리 성격: 규모·전리품·부품·손실·항체 배수가 구역마다 적용된다', () => {
  const plain = fresh(); plain.wavesCleared = 4;
  const base = (i) => { const s = at(i * C.SECTORS); s.wavesCleared = 4; return s; };
  const ratio = (s) => C.nightStrength(s) / (C.hordeStrength(5) * C.zoneThreat(s));
  assert.ok(Math.abs(ratio(base(2)) - 1.2) < 0.01, '공단: 철갑 무리 1.2배');
  assert.ok(Math.abs(ratio(base(3)) - 1.15) < 0.01, '환승역: 질주자 1.15배');
  assert.ok(Math.abs(ratio(base(6)) - 1.3) < 0.01, '송신탑 1.3배');
  assert.equal(C.nightParts(base(2)), 2 * 3 * 2, '공단: (1+5/5) × 구역 3 × 부품 2배');
  assert.ok(Math.abs(C.breachLoss(base(4)) - C.BREACH_LOSS * 1.5) < 1e-9, '병원: 손실 1.5배');
  // 강변 검문소: 변이체만 1.5배
  const river = base(5); river.wavesCleared = 9;
  assert.ok(Math.abs(C.nightStrength(river) / (C.hordeStrength(10) * C.BOSS_STRENGTH * C.zoneThreat(river)) - 1.5) < 0.01);
  river.wavesCleared = 4;
  assert.ok(Math.abs(ratio(river) - 1) < 0.01, '보통 밤은 그대로');
  // 병원: 변이체 처치 항체 2배
  const ward = base(4); ward.wavesCleared = 9; ward.antibodies = 1000; ward.defenses.rail = 1e6;
  const ev = C.resolveNight(ward);
  assert.equal(ev.type, 'defended');
  assert.equal(ev.antibodies, Math.floor(1000 * C.BOSS_ANTIBODY) * 2);
  assert.ok(C.breachLoss(base(4)) <= 0.9);
  assert.ok(plain.wavesCleared === 4);
});

/* ================= 통계 ================= */

test('통계: 켜 둔 시간과 자리 비움 시간이 따로 쌓이고, 지구 시간에는 둘 다 들어간다', () => {
  const s = fresh();
  C.tick(s, 30, () => 0.5); C.tick(s, 15, () => 0.5);
  assert.equal(s.playSeconds, 45);
  assert.equal(s.sectorSeconds, 45);
  C.applyOffline(s, 600);
  assert.equal(s.awaySeconds, 600);
  assert.equal(s.sectorSeconds, 645);
  C.applyOffline(s, C.offlineCap(s) + 9999); // 상한을 넘긴 시간은 세지 않는다
  assert.equal(s.awaySeconds, 600 + C.offlineCap(s));
  C.tick(s, -5); C.tick(s, NaN);
  assert.equal(s.playSeconds, 45, '잘못된 dt 는 통계에도 들어가지 않는다');
  const st = C.stats(s, 1000);
  assert.equal(st.total, st.play + st.away);
  assert.equal(st.average, null);
  assert.equal(st.eta, null);
  assert.equal(st.fastest, null);
});

test('통계: 이주하면 지구 기록이 남고 누계가 넘어간다', () => {
  let s = C.createState(5000);
  const times = [100, 40, 70];
  times.forEach(sec => {
    s.sectorSeconds = sec; s.playSeconds += sec; s.totalEarned = 1e40;
    s = C.relocate(s, 9999, () => 0).state;
    s.pendingPerks = [];
  });
  assert.equal(s.startedAt, 5000, '시작 시각은 이주해도 그대로다');
  assert.equal(s.sectorSeconds, 0);
  assert.equal(s.playSeconds, 210);
  assert.deepEqual(s.sectorLog, [{ step: 0, seconds: 100 }, { step: 1, seconds: 40 }, { step: 2, seconds: 70 }]);
  assert.deepEqual(s.fastest, { step: 1, seconds: 40 });
  assert.equal(s.zoneSeconds[0], 210);
  const st = C.stats(s, 5000 + 86400000 * 2 + 5);
  assert.equal(st.days, 3);
  assert.equal(st.average, 70);
  assert.equal(st.remaining, C.LAST_STEP - 3);
  assert.equal(st.eta, 70 * (C.LAST_STEP - 3));
  assert.deepEqual(st.fastest, { label: '1-B', seconds: 40 });
  assert.deepEqual(st.recent.map(r => r.label), ['1-C', '1-B', '1-A']);
  assert.equal(st.zones[0].sectors, 3);
  assert.equal(st.zones[1].sectors, 0);
});

test('통계: 최근 지구 기록은 정해진 수만 남는다', () => {
  let s = fresh();
  for (let i = 0; i < C.SECTOR_LOG_MAX + 5; i++) {
    s.sectorSeconds = i + 1; s.totalEarned = 1e60;
    s = C.relocate(s, 0, () => 0).state; s.pendingPerks = [];
  }
  assert.equal(s.sectorLog.length, C.SECTOR_LOG_MAX);
  assert.equal(s.sectorLog[s.sectorLog.length - 1].step, C.SECTOR_LOG_MAX + 4);
  assert.equal(s.fastest.seconds, 1);
});

test('통계: 저장을 거쳐도 남고, 깨진 값과 통계가 없던 저장을 안전하게 읽는다', () => {
  const s = C.createState(7000); s.playSeconds = 12; s.sectorLog = [{ step: 2, seconds: 9 }]; s.fastest = { step: 2, seconds: 9 }; s.zoneSeconds[0] = 9;
  const back = C.deserialize(C.serialize(s), 0);
  assert.equal(back.startedAt, 7000);
  assert.deepEqual(back.sectorLog, [{ step: 2, seconds: 9 }]);
  assert.deepEqual(back.fastest, { step: 2, seconds: 9 });
  const old = C.sanitizeState({ version: 1, relocations: 4 }, 123456);
  assert.equal(old.startedAt, 0, '통계가 없던 저장은 시작 시각을 모른다');
  assert.equal(C.stats(old, 123456).days, null);
  const bad = C.sanitizeState({ version: 1, playSeconds: 'x', awaySeconds: -3, sectorSeconds: NaN, fastest: { step: 999, seconds: 1 },
    sectorLog: [{ step: 1, seconds: 5 }, null, { step: -1, seconds: 5 }, { step: 1.5, seconds: 5 }, { step: 2, seconds: Infinity }, 'x'], zoneSeconds: ['a', 5] }, 0);
  assert.equal(bad.playSeconds, 0);
  assert.equal(bad.sectorSeconds, 0);
  assert.deepEqual(bad.sectorLog, [{ step: 1, seconds: 5 }]);
  assert.equal(bad.fastest, null);
  assert.equal(bad.zoneSeconds.length, C.ZONES.length);
  assert.equal(bad.zoneSeconds[1], 5);
  assert.doesNotThrow(() => C.stats(bad, NaN));
});

test('통계: 시간 표기', () => {
  assert.equal(C.formatDuration(12), '12초');
  assert.equal(C.formatDuration(250), '4분 10초');
  assert.equal(C.formatDuration(7500), '2시간 5분');
  assert.equal(C.formatDuration(86400 * 3 + 3600 * 4 + 59), '3일 4시간');
  assert.equal(C.formatDuration(-1), '0초');
  assert.equal(C.formatDuration(NaN), '0초');
});

/* ================= 하루의 두 구간: 낮 50초 + 방어 10초 ================= */

test('하루 구간: 앞 50초는 낮, 마지막 10초는 방어. 하루 길이는 그대로 60초다', () => {
  assert.equal(C.DAY_SECONDS, 60);
  assert.equal(C.BATTLE_SECONDS, 10);
  const s = fresh();
  assert.deepEqual(C.dayPhase(s), { phase: 'day', left: 50, total: 50 });
  s.dayClock = 49.5; assert.deepEqual(C.dayPhase(s), { phase: 'day', left: 0.5, total: 50 });
  s.dayClock = 50;   assert.deepEqual(C.dayPhase(s), { phase: 'battle', left: 10, total: 10 });
  s.dayClock = 57;   assert.deepEqual(C.dayPhase(s), { phase: 'battle', left: 3, total: 10 });
  for (const bad of [NaN, -5, 999, undefined]) { s.dayClock = bad; const p = C.dayPhase(s); assert.ok(p.left >= 0 && p.left <= p.total, String(bad)); }
});

test('무리 도착: 50초를 넘는 순간 한 번만 알리고, 승패는 60초에 정해진다', () => {
  const s = fresh();
  const types = (dt) => C.tick(s, dt, () => 0.5).map(e => e.type);
  assert.ok(!types(49).includes('arrive'));
  const at50 = C.tick(s, 1.5, () => 0.5);
  const arrive = at50.find(e => e.type === 'arrive');
  assert.ok(arrive, '50초를 넘으면 도착을 알린다');
  assert.equal(arrive.strength, C.nightStrength(s));
  assert.equal(arrive.defense, C.defensePower(s));
  assert.ok(!at50.some(e => e.type === 'defended' || e.type === 'breached'), '도착했다고 승패가 정해지지는 않는다');
  assert.ok(!types(5).includes('arrive'), '같은 밤에 두 번 알리지 않는다');
  const end = types(5);
  assert.ok(end.includes('breached') || end.includes('defended'));
  assert.ok(!end.includes('arrive'));
  assert.ok(types(50).includes('arrive'), '다음 날에도 알린다');
});

test('방어 구간에 보강하면 그 밤을 막아낸다(마지막 기회)', () => {
  const s = fresh(); s.supplies = 1e6;
  C.tick(s, 55, () => 0.5);
  assert.equal(C.dayPhase(s).phase, 'battle');
  assert.ok(C.defensePower(s) < C.nightStrength(s), '보강 전에는 못 막는다');
  assert.ok(C.fortify(s).ok);
  const ev = C.tick(s, 6, () => 0.5).find(e => e.type === 'defended' || e.type === 'breached');
  assert.equal(ev.type, 'defended');
});

test('방어 구간을 넣어도 밤이 오는 주기는 같다: 10분에 10번', () => {
  const s = fresh(); let nights = 0;
  for (let i = 0; i < 6000; i++) nights += C.tick(s, 0.1, () => 0.5).filter(e => ['defended', 'breached', 'held'].includes(e.type)).length;
  assert.equal(nights, 10);
});

/* ================= 생존자 배치 ================= */

test('생존자: 혼자 시작하고, 구역을 넘거나 사건으로 받아들이면 늘어난다', () => {
  assert.equal(C.survivorCount(fresh()), 0);
  assert.equal(C.survivorCount(at(C.SECTORS)), 1);
  assert.equal(C.survivorCount(at(C.SECTORS * 6 + 3)), 6);
  const s = fresh(); s.recruits = 2;
  assert.equal(C.survivorCount(s), 2);
  const c = fresh(); c.cycle = 1;
  assert.equal(C.survivorCount(c), C.ZONES.length - 1, '끝낸 회차마다 6명');
});

test('생존자 배치: 수색은 생산, 방어는 방어력, 연구는 연구 값을 한 명마다 4%씩 바꾼다', () => {
  const s = fresh(); s.recruits = 5; s.jobs = { scavenge: 5, guard: 0, study: 0 };
  s.buildings.garden = 10;
  const base = (() => { const p = fresh(); p.buildings.garden = 10; return C.productionPerSec(p); })();
  assert.ok(Math.abs(C.productionPerSec(s) / base - 1.2) < 1e-9);
  const def0 = C.defensePower(s);
  assert.ok(C.moveSurvivor(s, 'scavenge', 'guard').ok);
  assert.ok(C.moveSurvivor(s, 'scavenge', 'guard').ok);
  assert.deepEqual(s.jobs, { scavenge: 3, guard: 2, study: 0 });
  assert.ok(Math.abs(C.productionPerSec(s) / base - 1.12) < 1e-9);
  s.defenses.wire = 100;
  const plain = fresh(); plain.defenses.wire = 100;
  assert.equal(C.defensePower(s), Math.floor(C.defensePower(plain) * 1.08));
  assert.ok(def0 > 0);
  C.moveSurvivor(s, 'scavenge', 'study');
  const r = C.RESEARCH[0];
  assert.equal(C.researchCost(s, r.id), Math.ceil(r.cost * 0.96));
  s.supplies = C.researchCost(s, r.id);
  const bought = C.buyResearch(s, r.id);
  assert.ok(bought.ok);
  assert.equal(bought.cost, Math.ceil(r.cost * 0.96));
  assert.equal(s.supplies, 0, '할인된 값만 낸다');
  assert.equal(C.researchCost(s, 'nothing'), Infinity);
});

test('생존자 배치: 연구 할인은 60% 에서 멈추고, 없는 일이나 빈 일에서는 옮길 수 없다', () => {
  const s = fresh(); s.cycle = 5; s.jobs = { scavenge: 0, guard: 0, study: 30 };
  assert.equal(C.researchCost(s, C.RESEARCH[0].id), Math.ceil(C.RESEARCH[0].cost * 0.4));
  assert.equal(C.moveSurvivor(s, 'scavenge', 'guard').ok, false);
  assert.equal(C.moveSurvivor(s, 'study', 'nothing').ok, false);
  assert.equal(C.moveSurvivor(s, 'study', 'study').ok, false);
  assert.deepEqual(s.jobs, { scavenge: 0, guard: 0, study: 30 });
});

test('생존자 배치: 합은 언제나 생존자 수와 같다(저장, 이주, 깨진 값)', () => {
  const sum = (s) => s.jobs.scavenge + s.jobs.guard + s.jobs.study;
  const old = C.sanitizeState({ version: 1, relocations: C.SECTORS * 3 }, 0); // 배치가 없던 저장
  assert.equal(sum(old), 3);
  assert.equal(old.jobs.scavenge, 3, '새로 생긴 자리는 수색으로');
  const over = C.sanitizeState({ version: 1, recruits: 2, jobs: { scavenge: 9, guard: 4, study: 1 } }, 0);
  assert.equal(sum(over), 2, '넘치면 많은 쪽에서 덜어 낸다');
  const bad = C.sanitizeState({ version: 1, recruits: 99, jobs: { scavenge: -3, guard: 'x', study: 1.7 } }, 0);
  assert.equal(bad.recruits, C.RECRUIT_MAX);
  assert.equal(sum(bad), C.RECRUIT_MAX);
  // 구역을 넘는 이주: 한 명이 늘어 수색에 들어가고, 옮겨 둔 배치는 그대로다
  const s = at(C.SECTORS - 1); s.recruits = 2; s.jobs = { scavenge: 0, guard: 2, study: 0 }; s.totalEarned = 1e40;
  const next = C.relocate(s, 0, () => 0).state;
  assert.deepEqual(next.jobs, { scavenge: 1, guard: 2, study: 0 });
  assert.equal(next.recruits, 2);
  const back = C.deserialize(C.serialize(next), 0);
  assert.deepEqual(back.jobs, next.jobs);
});

/* ================= 사건 ================= */

test('사건: 첫 사건은 3분 뒤 생존자를 만나는 일이고, 그 뒤로는 4~8분마다 온다', () => {
  const s = fresh();
  let ev = [];
  for (let i = 0; i < 179; i++) ev = ev.concat(C.tick(s, 1, () => 0.5));
  assert.equal(s.event, null);
  ev = C.tick(s, 2, () => 0.5);
  assert.equal(ev.find(e => e.type === 'event').id, 'stranger');
  assert.equal(s.event.left, C.EVENT_WINDOW);
  assert.equal(s.eventIn, C.EVENT_MIN + 0.5 * C.EVENT_SPREAD);
  const v = C.eventView(s);
  assert.equal(v.title, '문을 두드리는 사람');
  assert.equal(v.choices.length, 2);
  v.choices.forEach(ch => { assert.equal(typeof ch.label, 'string'); assert.ok(ch.desc.length > 3); assert.equal(typeof ch.can, 'boolean'); });
});

test('사건: 고르면 결과가 적용되고 사건이 닫힌다. 고를 수 없는 선택은 거절한다', () => {
  const s = fresh(); s.event = { id: 'stranger', left: 20 }; s.supplies = 0;
  assert.equal(C.eventView(s).choices[0].can, false, '물자가 없으면 들일 수 없다');
  assert.equal(C.chooseEvent(s, 0).ok, false);
  assert.ok(s.event, '실패하면 사건은 그대로 떠 있다');
  s.supplies = 1000;
  const r = C.chooseEvent(s, 0, () => 0.5);
  assert.ok(r.ok);
  assert.equal(s.recruits, 1);
  assert.equal(s.jobs.scavenge, 1);
  assert.equal(s.supplies, 950, '생산이 없을 때의 값은 최소치 50');
  assert.equal(s.event, null);
  assert.equal(s.eventsDone, 1);
  assert.equal(C.chooseEvent(s, 0).ok, false, '사건이 없으면 고를 것도 없다');
  assert.equal(C.eventView(s), null);
  s.event = { id: 'stranger', left: 5 };
  assert.equal(C.chooseEvent(s, 7).ok, false);
});

test('사건: 시간이 지나면 기본 선택으로 넘어가고, 기본을 고를 수 없으면 다른 쪽으로 간다', () => {
  const rich = fresh(); rich.event = { id: 'stranger', left: 1 }; rich.supplies = 1000;
  const a = C.tick(rich, 2, () => 0.5).find(e => e.type === 'event-auto');
  assert.equal(a.choice, 0, '들일 수 있으면 들인다');
  assert.equal(rich.recruits, 1);
  const poor = fresh(); poor.event = { id: 'stranger', left: 1 }; poor.supplies = 0;
  const b = C.tick(poor, 2, () => 0.5).find(e => e.type === 'event-auto');
  assert.equal(b.choice, 1, '물자가 없으면 돌려보낸다');
  assert.equal(poor.recruits, 0);
  assert.equal(poor.event, null);
});

test('사건: 모든 사건의 모든 선택이 오류 없이 돌아가고, 기본 선택은 물자를 잃게 하지 않는다(생존자 영입 제외)', () => {
  for (const def of C.EVENTS) {
    assert.ok(def.title && def.text && def.choices.length === 2 && (def.def === 0 || def.def === 1), def.id);
    def.choices.forEach((ch, i) => {
      for (const roll of [0.1, 0.9]) {
        const s = at(C.SECTORS * 2); s.supplies = 1e9; s.buildings.garden = 5; s.event = { id: def.id, left: 10 };
        const before = { supplies: s.supplies, parts: s.parts, antibodies: s.antibodies };
        const r = C.chooseEvent(s, i, () => roll);
        assert.ok(r.ok, `${def.id} ${i}`);
        assert.ok(r.text.length > 3);
        assert.ok(Number.isFinite(s.supplies) && s.supplies >= 0 && s.parts >= before.parts && s.antibodies >= before.antibodies, `${def.id} ${i}`);
        if (i === def.def && def.id !== 'stranger') assert.ok(s.supplies >= before.supplies, `${def.id}: 기본 선택이 물자를 깎는다`);
      }
    });
  }
});

test('사건: 같은 사건이 연달아 나오지 않고, 자리 비움 중에는 일어나지 않으며 떠 있던 것은 기본 선택으로 넘어간다', () => {
  const s = fresh(); s.eventsDone = 3; s.lastEvent = 'cache'; s.eventIn = 0.5;
  for (const roll of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
    const c = C.deserialize(C.serialize(s), 0);
    C.tick(c, 1, () => roll);
    assert.notEqual(c.event.id, 'cache');
  }
  const away = fresh(); away.eventIn = 10; away.event = null;
  C.applyOffline(away, 3600);
  assert.equal(away.event, null, '자리를 비운 동안 새 사건은 없다');
  const pending = fresh(); pending.event = { id: 'cache', left: 20 }; pending.buildings.garden = 1;
  const rep = C.applyOffline(pending, 600);
  assert.equal(pending.event, null);
  assert.equal(rep.event.choice, 0);
  // 깨진 저장
  const bad = C.sanitizeState({ version: 1, event: { id: 'nothing', left: 5 }, eventIn: 'x', lastEvent: 42 }, 0);
  assert.equal(bad.event, null);
  assert.equal(bad.eventIn, C.EVENT_FIRST);
  assert.equal(bad.lastEvent, null);
  const kept = C.sanitizeState({ version: 1, event: { id: 'trader', left: 9999 } }, 0);
  assert.equal(kept.event.left, C.EVENT_WINDOW);
});

/* ================= 결말 이후: 회차 ================= */

test('회차: 7-Z 에서 마지막 일지를 연 뒤에만 시작할 수 있다', () => {
  assert.equal(C.canStartCycle(fresh()), false);
  const end = at(C.LAST_STEP);
  assert.equal(C.canStartCycle(end), false, '마지막 일지를 아직 열지 않았다');
  assert.equal(C.startCycle(end, 0, () => 0).ok, false);
  end.story[Object.keys(C.BEATS.reduce((o, b) => { o[b.id] = 1; return o; }, {})).pop()] = true;
  assert.equal(C.canStartCycle(end), true);
  end.pendingPerks = ['harvest'];
  assert.equal(C.canStartCycle(end), false, '고르지 않은 특전이 있으면 안 된다');
});

test('회차: 1-A 로 돌아가 항체는 0 에서 다시 모으고, 영구 항목은 남으며, 세계는 더 거칠어진다', () => {
  const end = at(C.LAST_STEP);
  C.BEATS.forEach(b => { end.story[b.id] = true; });
  end.antibodies = 5e9; end.antibodySpent = 300; end.serums.immune = 3; end.perks.harvest = 4; end.gear.tools = 2;
  end.relics[C.RELICS[0].id] = true; end.parts = 77; end.recruits = 4; end.jobs = { scavenge: 4, guard: 6, study: 0 };
  end.playSeconds = 9999; end.startedAt = 1234; end.bonus.medals = 5; end.supplies = 1e30; end.buildings.garden = 50;
  const res = C.startCycle(end, 5000, () => 0);
  assert.ok(res.ok);
  const n = res.state;
  assert.equal(n.cycle, 1);
  assert.equal(C.zoneLabel(n), '1-A');
  assert.equal(n.antibodies, 0);
  assert.equal(C.antibodiesFree(n), 0);
  assert.equal(n.supplies, 0);
  assert.equal(n.buildings.garden, 0);
  assert.equal(n.serums.immune, 3);
  assert.equal(n.perks.harvest, 4);
  assert.equal(n.gear.tools, 2);
  assert.equal(n.relics[C.RELICS[0].id], true);
  assert.equal(n.parts, 77);
  assert.equal(n.bonus.medals, 5);
  assert.equal(n.playSeconds, 9999);
  assert.equal(n.startedAt, 1234);
  assert.deepEqual(n.sectorLog, []);
  assert.equal(C.survivorCount(n), 4 + 6);
  assert.equal(n.jobs.scavenge + n.jobs.guard + n.jobs.study, 10);
  assert.ok(n.story[C.BEATS[0].id], '읽은 일지는 다시 뜨지 않는다');
  // 더 거친 세계
  const first = fresh();
  assert.equal(C.relocateRequirement(n), C.relocateRequirement(first) * C.CYCLE_REQUIRE);
  const plain = fresh(); plain.wavesCleared = 4; n.wavesCleared = 4;
  assert.equal(C.nightStrength(n), Math.round(C.hordeStrength(5) * (1 + C.CYCLE_THREAT)));
  assert.ok(C.nightStrength(n) > C.nightStrength(plain));
  const back = C.deserialize(C.serialize(n), 0);
  assert.equal(back.cycle, 1);
});

/* ================= 직접 수색: 누르기가 방치를 압도하지 않는다 ================= */

const maxClick = (s) => {  // 수색 배수를 올리는 것을 전부 최대로
  C.UPGRADES.forEach(u => { s.upgrades[u.id] = true; });
  C.GEAR.forEach(g => { if (g.key === 'click') s.gear[g.id] = g.max; });
  C.PERKS.forEach(k => { if (k.key === 'click') s.perks[k.id] = k.max; });
  C.SERUMS.forEach(k => { if (k.key === 'click') s.serums[k.id] = k.max; });
  return s;
};

test('직접 수색: 수색 배수가 두 배가 될 때마다 실제 배수가 1씩 는다', () => {
  const s = fresh();
  assert.equal(C.clickPower(s), 1);
  assert.equal(C.clickValue(s), 1);
  s.upgrades.crowbar = true;
  assert.equal(C.clickPower(s), 2, '첫 장비는 적힌 대로 2배');
  assert.equal(C.clickValue(s), 2);
  C.UPGRADES.forEach(u => { s.upgrades[u.id] = true; }); // 2 × 3 × 4 × 5 = 120배
  assert.ok(Math.abs(C.clickPower(s) - (1 + Math.log2(120))) < 1e-12);
  assert.ok(C.clickPower(s) < 8);
  const all = maxClick(at(C.SECTORS)); // 재래시장(수색 배수 2배)에서 전부 최대
  assert.ok(C.clickPower(all) > C.clickPower(s), '더 올리면 더 늘기는 한다');
  assert.ok(C.clickPower(all) < 25, '그래도 25배 미만: ' + C.clickPower(all));
  assert.ok(C.clickSeconds(all) < 0.25, '한 번에 생산 0.25초치 미만');
});

test('직접 수색: 초당 6번을 눌러도 가만히 둘 때의 생산을 크게 넘지 못한다(예전에는 20배가 넘었다)', () => {
  const s = maxClick(at(C.SECTORS));
  s.buildings.garden = 200; s.buildings.workshop = 100;
  const perSec = C.productionPerSec(s), tapping = C.clickValue(s) * 6;
  assert.ok(tapping < perSec * 1.5, `전부 최대일 때 누르기 수익은 생산의 ${(tapping / perSec).toFixed(2)}배`);
  const few = at(3); C.UPGRADES.forEach(u => { few.upgrades[u.id] = true; }); few.buildings.garden = 50;
  assert.ok(C.clickValue(few) * 6 < C.productionPerSec(few) * 0.7, '장비 4종만 있을 때는 생산의 절반 남짓');
  // 시설이 하나도 없는 지구 초반에는 여전히 첫 물자를 모을 수 있다
  const start = at(3); C.UPGRADES.forEach(u => { start.upgrades[u.id] = true; });
  assert.ok(C.clickValue(start) >= 7);
});
