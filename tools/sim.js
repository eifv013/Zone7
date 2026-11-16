/*
 * 밸런스 시뮬레이터 (알파 0.6 의 새 구조)
 * 하루에 몇 번, 몇 분씩 접속하는 사람을 흉내 내어 "아직 만들지 않은 구역의 문 앞"에 닿기까지 며칠이 걸리고 철수를 몇 번 하는지 잰다.
 *   node tools/sim.js                 하루 4번 × 15분, 누르지 않음
 *   node tools/sim.js TAPS=4          접속 중 초당 4번 누름
 *   node tools/sim.js SESSIONS=2 MINUTES=30 DAYS=30
 * 봇의 방침: 살 수 있는 것은 회수가 빠른 순서로 사고, 방벽은 필요한 만큼만 보강한다.
 *           판을 30분 넘게 했고, 얻을 항체가 지금까지 얻은 총량의 절반 이상이며, 다음 살 것까지 5분(STUCK=초) 넘게 걸릴 만큼 막혔으면 철수한다. 항체는 정해진 순서로 찍는다.
 */
const C = require('../src/core.js');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(k + '=')); return a ? +a.split('=')[1] : d; };

function run({ sessions = 4, minutes = 15, days = 30, taps = 0, seed = 1, stuck = 300, share = 0.5 } = {}) {
  let z = seed >>> 0; const rng = () => { z = (z * 1664525 + 1013904223) >>> 0; return z / 4294967296; };
  let s = C.createState(0), day = 0, active = 0; const marks = [];
  const traitOrder = ['immune', 'bulwark', 'immune', 'dealer', 'immune', 'pioneer', 'immune', 'thrift', 'legacy', 'immune', 'bulwark', 'dealer', 'engineer'];
  const spendTraits = () => { for (let k = 0, bought = true; bought && k < 500; k++) { bought = false; for (const id of traitOrder) if ((id !== 'engineer' || s.bestZone >= 2) && C.buyTrait(s, id).ok) bought = true; } };
  const step = () => {
    active++;
    C.tick(s, 1, rng);
    for (let zi = 1; zi <= s.zone; zi++) if (!marks.some(m => m.enter === zi)) marks.push({ enter: zi, day: day + 1, hours: active / 3600, retreats: s.retreats, pps: C.productionPerSec(s) });
    for (let k = 0; k < taps; k++) C.scavenge(s);
    if (s.clicks < 15) C.scavenge(s);
    if (s.pendingPerks.length) C.choosePerk(s, (s.zone >= 2 ? ['foreman', 'harvest', 'bargain', 'watch'] : ['harvest', 'bargain', 'watch']).find(id => s.pendingPerks.includes(id)) || s.pendingPerks[0]);
    if (s.signalLeft > 0) C.answerSignal(s, rng);
    C.fortify(s);
    const n = C.nextZone(s);
    if (n && n.ready && !(n.soon && s.gate) && C.openZone(s).ok && s.gate && !marks.some(m => m.gate)) marks.push({ gate: true, day: day + 1, hours: active / 3600, retreats: s.retreats });
    // 회수가 가장 빠른 것부터 산다: 시설, 좌판, 구역 강화
    let cheapest = Infinity;      // 못 산 것 중 가장 싼 값: 이것조차 한참 걸리면 '막혔다'고 본다
    for (let g = 0; g < 60; g++) {
      let best = null; const per = Math.max(1e-9, C.productionPerSec(s));
      cheapest = Infinity;
      const consider = (cost, gain, buy) => { if (cost > s.supplies && gain > 0) cheapest = Math.min(cheapest, cost); if (cost <= s.supplies && gain > 0 && (!best || cost / gain < best.pay)) best = { pay: cost / gain, buy }; };
      for (const b of C.BUILDINGS) consider(C.buildingCost(s, b.id, 1), b.baseRate * C.mods(s).z1 * C.globalMult(s) * C.milestoneMult(s.buildings[b.id] + 1), () => C.buyBuilding(s, b.id, 1));
      if (s.zone >= 1) consider(C.stallCost(s, 1), C.goodsValue(s) * C.priceRange(s).mean * 1.2, () => C.buyStall(s, 1));
      if (s.zone >= 2) {   // 3구역: 병목 기계를 올렸을 때 늘어나는 산출로 따진다(처음에는 0 이라 조금 얹어 준다)
        const cost = C.tuneCost(s), before = C.lineRate(s), probe = Object.assign({}, s, { machines: Object.assign({}, s.machines) });
        probe.machines[C.lineInfo(s).bottleneck]++;
        consider(cost, Math.max(C.lineRate(probe) - before, C.productValue(s) * 0.2), () => C.tuneLine(s, 1));
      }
      for (const u of C.UPGRADES) { const c = C.upgradeCost(s, u.id); if (isFinite(c)) consider(c, per * (u.key === 'click' || u.key === 'loot' ? 0.02 : u.key === 'cap' || u.key === 'broker' || u.key === 'slack' ? 0.03 : 0.12), () => C.buyUpgrade(s, u.id)); }
      if (!best) break;
      best.buy();
    }
    const gain = C.antibodiesOnRetreat(s);
    // 철수: 판을 30분 넘게 했고, 얻을 항체가 지금까지의 절반 이상이며, 다음 살 것까지 stuck 초 넘게 걸릴 만큼 막혔을 때
    const isStuck = cheapest - s.supplies > C.productionPerSec(s) * stuck;
    if (C.canRetreat(s) && s.runSeconds > 1800 && isStuck && gain >= Math.max(3, s.antibodyTotal * share)) { marks.push({ retreat: true, day: day + 1, hours: active / 3600, gain, zone: s.zone }); s = C.retreat(s, 0).state; spendTraits(); }
  };
  const gap = Math.max(0, 16 * 3600 / sessions - minutes * 60);
  while (day < days && !marks.some(m => m.gate)) {
    for (let i = 0; i < sessions; i++) { for (let t = 0; t < minutes * 60; t++) step(); C.applyOffline(s, i === sessions - 1 ? gap + 8 * 3600 : gap); }
    day++;
  }
  return { marks, day, state: s, hours: active / 3600 };
}

if (require.main === module) {
  const r = run({ sessions: arg('SESSIONS', 4), minutes: arg('MINUTES', 15), days: arg('DAYS', 30), taps: arg('TAPS', 0), seed: arg('SEED', 1), stuck: arg('STUCK', 300), share: arg('SHARE', 0.5) });
  r.marks.forEach(m => console.log(m.retreat ? `  철수: ${m.day}일째, 접속 ${m.hours.toFixed(1)}시간, ${m.zone + 1}구역에서 항체 +${m.gain}` : `${m.gate ? '다음 구역(준비 중)의 문 앞' : (m.enter + 1) + '구역 첫 도착'}: ${m.day}일째, 접속 ${m.hours.toFixed(1)}시간, 철수 ${m.retreats}번` + (m.pps ? `, 그때 초당 ${C.formatNumber(m.pps)}` : '')));
  if (!r.marks.some(m => m.gate)) console.log(`${r.day}일 동안 문 앞에 닿지 못했다. 지금 ${C.zoneLabel(r.state)}, 철수 ${r.state.retreats}번, 항체 ${r.state.antibodyTotal}, 이번 판 누적 ${C.formatNumber(r.state.runEarned)}`);
}
module.exports = { run };
