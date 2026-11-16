/*
 * 밸런스 시뮬레이터 — 자동 플레이로 1-A 에서 결말(7-Z)까지 걸리는 게임 내 시간을 잰다.
 * 실행: node tools/sim.js                 (현재 수치)
 *       node tools/sim.js ANTIBODY_BONUS=0.03 STEP_REQUIRE=1.12   (상수를 바꿔서 시험)
 * core.js 를 고치지 않고, 읽어 온 소스의 상수만 바꿔 메모리에서 실행한다.
 *
 * 봇의 규칙(사람보다 부지런하고 단순하다): 1초마다 회수 기간이 가장 짧은 시설을 사고, 방어가 모자라면
 * 방벽을 사고, 연구·제작·원정·구조 신호를 가능한 대로 처리하고, 이주 조건이 차면 바로 떠난다.
 */
const fs = require('fs');
const path = require('path');

function loadCore(overrides) {
  let src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core.js'), 'utf8');
  for (const [name, value] of Object.entries(overrides)) {
    const re = new RegExp('(var ' + name + ' = )[^;]+;');
    if (!re.test(src)) throw new Error('core.js 에 상수 ' + name + ' 이 없습니다.');
    src = src.replace(re, '$1' + value + ';');
  }
  const mod = { exports: {} };
  new Function('module', src)(mod);
  return mod.exports;
}

function run(C, maxHours, seed) {
  let s = C.createState(0), t = 0, z = (seed || 1) >>> 0;
  const draw = () => { z = (z * 1664525 + 1013904223) >>> 0; return z / 4294967296; }; // 특전 뽑기용: 씨앗이 같으면 결과가 같다
  const marks = [], rng = () => 0.5, nights = { won: 0, lost: 0, lostSupplies: 0 };
  const perkOrder = ['harvest', 'culture', 'crew', 'watch', 'pioneer'];
  while (t < maxHours * 3600 && !(s.relocations >= C.LAST_STEP && s.story['z7-2'])) {
    t += 1;
    for (const ev of C.tick(s, 1, rng)) { if (ev.type === 'defended') nights.won++; if (ev.type === 'breached') { nights.lost++; nights.lostSupplies += ev.lost; } }
    if (s.pendingPerks.length) C.choosePerk(s, perkOrder.find(id => s.pendingPerks.includes(id)) || s.pendingPerks[0]);
    s.autoExpedition = true;
    for (const g of C.GEAR) while (C.craftGear(s, g.id).ok) { /* 살 수 있는 만큼 */ }
    for (const k of C.SERUMS) while (C.buySerum(s, k.id).ok) { /* 살 수 있는 만큼 */ }
    if (s.signalLeft > 0) C.answerSignal(s, rng);
    if (s.clicks < 15) C.scavenge(s); // 첫 시설을 살 만큼만 손으로 모은다
    if (!s.expedition) for (let i = C.EXPEDITIONS.length - 1; i >= 0; i--) if (C.startExpedition(s, C.EXPEDITIONS[i].id).ok) break;
    C.autoFortify(s);
    for (const r of C.RESEARCH) if (!s.research[r.id] && r.cost <= s.supplies * 0.5) C.buyResearch(s, r.id);
    for (let g = 0; g < 200; g++) {
      let best = null;
      for (const b of C.buildingsFor(s)) { const c = C.buildingCost(s, b.id, 1), pay = c / b.baseRate; if (c <= s.supplies && (!best || pay < best.pay)) best = { id: b.id, pay }; }
      if (!best) break;
      C.buyBuilding(s, best.id, 1);
    }
    const sec = C.sectorIndex(s), stay = C.STORY_SECTOR.includes(sec) && sec > 0 && s.wavesCleared < 3; // 일지를 열 때까지 머문다
    if (C.canRelocate(s) && !stay && s.relocations < C.LAST_STEP) {
      s = C.relocate(s, 0, draw).state;
      if (C.sectorIndex(s) === 0 || s.relocations === C.LAST_STEP) marks.push(C.zoneLabel(s) + ' ' + (t / 3600).toFixed(1) + 'h');
    }
  }
  return { hours: +(t / 3600).toFixed(1), at: C.zoneLabel(s), ending: !!s.story['z7-2'], stories: Object.keys(s.story).length,
           antibodies: s.antibodies, perks: C.totalPerks(s), marks, nights };
}

/**
 * 방치 위주로 하는 사람 흉내: 하루에 sessions 번 접속해 minutes 분씩 하고, 나머지 시간은 꺼 둔다.
 * 접속해 있는 동안은 위의 봇과 같은 규칙으로 움직이고, 꺼 둔 시간은 게임의 자리 비움 규칙
 * (생산 50%·최대 8시간, 막을 수 있는 밤만 진행)으로 처리한다. 접속 간격은 깨어 있는 16시간에 고르게 둔다.
 * 돌려주는 값: 결말까지 걸린 날 수(못 끝내면 maxDays).
 */
function runCasual(C, sessions, minutes, maxDays, seed) {
  let s = C.createState(0), z = (seed || 1) >>> 0, day = 0, active = 0;
  const draw = () => { z = (z * 1664525 + 1013904223) >>> 0; return z / 4294967296; };
  const rng = () => 0.5, perkOrder = ['harvest', 'culture', 'crew', 'watch', 'pioneer'];
  const done = () => s.relocations >= C.LAST_STEP && s.story['z7-2'];
  const play = (seconds) => {
    for (let t = 0; t < seconds && !done(); t++) {
      active++;
      C.tick(s, 1, rng);
      if (s.pendingPerks.length) C.choosePerk(s, perkOrder.find(id => s.pendingPerks.includes(id)) || s.pendingPerks[0]);
      s.autoExpedition = true;
      for (const g of C.GEAR) while (C.craftGear(s, g.id).ok) { /* 살 수 있는 만큼 */ }
      for (const k of C.SERUMS) while (C.buySerum(s, k.id).ok) { /* 살 수 있는 만큼 */ }
      if (s.signalLeft > 0) C.answerSignal(s, rng);
      if (s.clicks < 15) C.scavenge(s);
      if (!s.expedition) for (let i = C.EXPEDITIONS.length - 1; i >= 0; i--) if (C.startExpedition(s, C.EXPEDITIONS[i].id).ok) break;
      C.autoFortify(s);
      for (const r of C.RESEARCH) if (!s.research[r.id] && r.cost <= s.supplies * 0.5) C.buyResearch(s, r.id);
      for (let g = 0; g < 200; g++) {
        let best = null;
        for (const b of C.buildingsFor(s)) { const c = C.buildingCost(s, b.id, 1), pay = c / b.baseRate; if (c <= s.supplies && (!best || pay < best.pay)) best = { id: b.id, pay }; }
        if (!best) break;
        C.buyBuilding(s, best.id, 1);
      }
      const sec = C.sectorIndex(s), stay = C.STORY_SECTOR.includes(sec) && sec > 0 && s.wavesCleared < 3;
      if (C.canRelocate(s) && !stay && s.relocations < C.LAST_STEP) s = C.relocate(s, 0, draw).state;
    }
  };
  const awake = 16 * 3600, gap = Math.max(0, awake / sessions - minutes * 60), night = 8 * 3600;
  while (day < maxDays && !done()) {
    for (let i = 0; i < sessions && !done(); i++) {
      play(minutes * 60);
      C.applyOffline(s, i === sessions - 1 ? gap + night : gap, rng); // 마지막 접속 뒤에는 밤새 꺼 둔다
    }
    day++;
  }
  return { days: day, finished: !!done(), at: C.zoneLabel(s), activeHours: +(active / 3600).toFixed(1) };
}

if (require.main === module) {
  const overrides = {};
  process.argv.slice(2).forEach(a => { const [k, v] = a.split('='); overrides[k] = v; });
  const seed = Number(overrides.SEED) || 1; delete overrides.SEED;
  if (overrides.CASUAL) { // 예: node tools/sim.js CASUAL=3x10  → 하루 3번, 10분씩
    const [n, m] = overrides.CASUAL.split('x').map(Number); delete overrides.CASUAL;
    const c = runCasual(loadCore(overrides), n, m, 120, seed);
    console.log(`하루 ${n}번 × ${m}분 →`, c.finished ? c.days + '일' : c.days + '일 안에 못 끝냄(' + c.at + ')', '· 실제 접속 시간', c.activeHours + 'h');
    return;
  }
  const r = run(loadCore(overrides), 300, seed);
  console.log(JSON.stringify(overrides), '→', r.hours + 'h', r.at, '결말:', r.ending, '일지:', r.stories, '항체:', r.antibodies.toExponential(1), '특전:', r.perks);
  console.log('  ', r.marks.join(' / '));
  console.log('   밤: 막음', r.nights.won, '· 뚫림', r.nights.lost, '(' + (r.nights.lost / Math.max(1, r.nights.won + r.nights.lost) * 100).toFixed(0) + '%)');
}
module.exports = { loadCore, run, runCasual };
