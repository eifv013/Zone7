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

function run({ sessions = 4, minutes = 15, days = 30, taps = 0, seed = 1, stuck = 300, share = 0.5, dt = 1 } = {}) {
  // dt: 한 걸음에 흐르는 초(1.2.2). 엔딩까지 재려면 수백 시간을 돌려야 하므로 3~5초로 성기게 돌릴 수 있다
  let z = seed >>> 0; const rng = () => { z = (z * 1664525 + 1013904223) >>> 0; return z / 4294967296; };
  let s = C.createState(0), day = 0, active = 0, cheapest = Infinity; const marks = [];
  if (process.env.LIVE) { const push = marks.push.bind(marks); marks.push = (m) => { console.log(JSON.stringify(Object.assign({}, m, { hours: +m.hours.toFixed(1), pps: undefined }))); return push(m); }; }      // LIVE=1: 생기는 대로 찍는다(오래 도는 측정용)
  const traitOrder = ['immune', 'bulwark', 'immune', 'dealer', 'immune', 'pioneer', 'immune', 'thrift', 'legacy', 'immune', 'bulwark', 'dealer', 'engineer', 'railman', 'scholar'];
  const spendTraits = () => { for (let k = 0, bought = true; bought && k < 500; k++) { bought = false; for (const id of traitOrder) if ((id !== 'engineer' || s.bestZone >= 2) && (id !== 'railman' || s.bestZone >= 3) && (id !== 'scholar' || s.bestZone >= 4) && C.buyTrait(s, id).ok) bought = true; } };
  const step = () => {
    active += dt;
    const evs = C.tick(s, dt, rng);
    if (!marks.some(m => m.end) && evs.some(e => e.type === 'ending')) marks.push({ end: true, day: day + 1, hours: active / 3600, retreats: s.retreats });
    // 구역 사이 콘텐츠: 채울 수 있으면 바로 채운다(주문·의뢰·화물)
    if (s.jam) C.repairJam(s); if (s.truck) C.loadTruck(s, false);      // 접속 중에는 고장을 고치고 트럭에 싣는다(품목은 바꾸지 않는다)
    // 4·6·7구역 사건: 배수를 먼저 다 쌓고, 그 뒤로는 바로 받는다. 5구역 밤샘 연구는 되는 대로 누른다
    for (const d of C.ZONE_EVENTS) if (s.zev[d.id]) { if (!(d.choices.includes('boost') && C.answerZoneEvent(s, d.id, 'boost', false).ok)) C.answerZoneEvent(s, d.id, 'now', false); }
    if (s.zone >= 4 && !(s.focusCool > 0)) C.focusLab(s); if (s.zone >= 5) C.pushZone(s, 'guard'); if (s.zone >= 6) C.pushZone(s, 'tower');
    if (s.zone >= 1) C.fillOrder(s); if (s.zone >= 2) C.fillContract(s); if (s.zone >= 3) C.fillSalvage(s);
    if (s.zone >= 6 && C.serumCost(s) <= s.supplies * 0.5) C.buySerum(s);      // 7구역: 혈청은 가진 물자의 절반으로 살 수 있을 때 산다
    for (let zi = 1; zi <= s.zone; zi++) if (!marks.some(m => m.enter === zi)) marks.push({ enter: zi, day: day + 1, hours: active / 3600, retreats: s.retreats, pps: C.productionPerSec(s) });
    for (let k = 0; k < taps * dt; k++) C.scavenge(s);
    if (s.clicks < 15) C.scavenge(s);
    if (s.pendingPerks.length) C.choosePerk(s, (s.zone >= 3 ? ['driver', 'foreman', 'harvest', 'watch'] : s.zone >= 2 ? ['foreman', 'harvest', 'bargain', 'watch'] : ['harvest', 'bargain', 'watch']).find(id => s.pendingPerks.includes(id)) || s.pendingPerks[0]);
    if (s.signalLeft > 0) C.answerSignal(s, rng);
    // 5구역: 점수가 되면 과제를 끝낸다. 지금 가장 많이 버는 구역을 키우는 과제 > 혈청 배양 > 나머지 순으로 고른다.
    if (s.zone >= 4 && s.offers.length && s.points >= C.projectCost(s)) {
      const share = { soil: C.searchRate(s), ledger: C.tradeRate(s), process: C.lineRate(s), transit: C.railRate(s) }, per = C.productionPerSec(s) || 1;
      // 구역 목표(혈청 배양 3번)가 남아 있으면 그것부터 고른다: 사람도 목표를 보고 고른다
      const wantDrill = C.goals(s, 4).some(g => g.id === 'z5c2' && !g.done), wantSerum = C.goals(s, 4).some(g => g.id === 'z5c' && !g.done);
      const worth = id => (id === 'serum' && wantSerum) || (id === 'drill' && wantDrill) ? 9 : id in share ? 1 + share[id] / per : id === 'serum' ? 1.3 : id === 'drill' ? (C.defensePower(s) < C.nightStrength(s) ? 1.4 : 1.05) : id === 'refine' ? 1.1 : 1.02;
      C.runProject(s, s.offers.slice().sort((a, b) => worth(b) - worth(a))[0], rng);
    }
    C.fortify(s);
    // 선제 공격은 지금 방어력으로 못 막을 밤에 쓰고, 반격은 되는 대로 쓴다
    if (C.strikeReady(s) && C.defensePower(s) < C.nightStrength(s)) C.strike(s); if (C.counterReady(s)) C.counterAttack(s);
    // 목표를 보고 사는 것(사람도 목표 줄을 보고 산다): 이번 회차에 뽑힌 목표(C.goals)마다, 살 수 있으면 목표 쪽으로 먼저 산다
    const cheapestUp = (zone) => { const u = C.UPGRADES.filter(x => x.zone === zone && isFinite(C.upgradeCost(s, x.id))).sort((x, y) => C.upgradeCost(s, x.id) - C.upgradeCost(s, y.id))[0]; return u ? C.buyUpgrade(s, u.id) : { ok: false }; };
    const cheapestDef = () => { const d = C.DEFENSES.slice().sort((x, y) => C.defenseCost(s, x.id, 1) - C.defenseCost(s, y.id, 1))[0]; return C.buyDefense(s, d.id, 1); };
    const cheapestRoute = () => { const r = C.ROUTES.filter(x => isFinite(C.routeCost(s, x.id))).sort((x, y) => C.routeCost(s, x.id) - C.routeCost(s, y.id))[0]; return r ? C.buyRoute(s, r.id) : { ok: false }; };
    const cheapestHand = () => { const h = C.HANDS.slice().sort((x, y) => C.handCost(s, x.id, 1) - C.handCost(s, y.id, 1))[0]; return C.buyHand(s, h.id, 1); };
    const toward = {
      z1a: () => C.buyBuilding(s, 'scouts', 1), z1a2: () => C.buyBuilding(s, 'garden', 1), z1b2: cheapestDef, z1c2: () => cheapestUp(0),
      z2a: () => C.buyStall(s, 1), z2a2: cheapestHand, z2c2: () => cheapestUp(1),
      z3a: () => C.tuneLine(s, 1), z3a2: () => cheapestUp(2), z3b: () => (C.recipeOf(s).id === 'bolt' && !C.lineInfo(s).steady ? C.tuneLine(s, 1) : { ok: false }),      // 정속 가동이 깨져 있으면 병목을 올려 맞춘다
      z4a: () => C.buyTrain(s, 1), z4a2: cheapestRoute, z4c2: () => cheapestUp(3),
      z5a: () => C.buyStaff(s, 1), z5a2: () => cheapestUp(4),
      z6a: () => C.buyPost(s, 1), z6a2: cheapestDef, z6b: () => cheapestUp(5), z6b2: () => C.buyUpgrade(s, 'booth'),
      z7a: () => C.buyAntenna(s, 1)
    };
    for (let zi = 0; zi <= s.zone; zi++) for (const g of C.goals(s, zi)) { const act = toward[g.id]; for (let k = 0; act && !g.done && k < 5 && C.goals(s, zi).find(x => x.id === g.id).value < g.need && act().ok; k++); }
    // 3구역: 의뢰가 다른 품목을 찾으면 그 품목으로 바꾼다(의뢰가 없으면 볼트로 돌아온다)
    if (s.zone >= 2) { const want = s.contract && s.contract.item ? s.contract.item : 'bolt'; if (C.recipeOf(s).id !== want && !(s.retool > 0)) C.setRecipe(s, want); }
    const n = C.nextZone(s);
    if (n && n.ready && n.enough) C.openZone(s);
    // 7구역의 마지막 목표가 혈청뿐이고 3시간 안에 모을 수 있으면, 다른 것을 사지 않고 모은다(사람도 그렇게 한다)
    const saving = s.zone >= 6 && !s.goalsDone.z7c && s.goalsDone.z7a && (C.serumCost(s) - s.supplies) < C.incomePerSec(s) * 3 * 3600;
    if (saving && C.serumCost(s) <= s.supplies) C.buySerum(s);
    for (let g = 0; g < (+process.env.BUYS || 60) && !saving && (dt >= 3 || active % 3 === 0); g++) {
      let best = null; const per = Math.max(1e-9, C.productionPerSec(s));
      cheapest = Infinity;      // 못 산 것 중 가장 싼 값: 이것조차 한참 걸리면 '막혔다'고 본다
      const consider = (cost, gain, buy) => { if (cost > s.supplies && gain > 0) cheapest = Math.min(cheapest, cost); if (cost <= s.supplies && gain > 0 && (!best || cost / gain < best.pay)) best = { pay: cost / gain, buy }; };
      for (const b of C.BUILDINGS) consider(C.buildingCost(s, b.id, 1), b.baseRate * C.mods(s).z1 * C.globalMult(s) * C.milestoneMult(s.buildings[b.id] + 1), () => C.buyBuilding(s, b.id, 1));
      if (s.zone >= 1) consider(C.stallCost(s, 1), C.goodsValue(s) * C.priceRange(s).mean * 1.2, () => C.buyStall(s, 1));
      if (s.zone >= 2) {   // 3구역: 병목 기계를 올렸을 때 늘어나는 산출로 따진다(처음에는 0 이라 조금 얹어 준다)
        const cost = C.tuneCost(s), before = C.lineRate(s), probe = Object.create(s); probe.machines = Object.assign({}, s.machines);   // 상태를 통째로 베끼지 않고 바뀐 것만 덮어쓴다(빠르다)
        probe.machines[C.lineInfo(s).bottleneck]++;
        consider(cost, Math.max(C.lineRate(probe) - before, C.productValue(s) * 0.2), () => C.tuneLine(s, 1));
      }
      if (s.zone >= 3) {   // 4구역: 열차를 사거나 노선을 늘렸을 때 늘어나는 평균 수입으로 따진다
        const rate = C.railRate(s), probe = () => { const o = Object.create(s); o.routes = Object.assign({}, s.routes); return o; };
        const t = probe(); t.trains = s.trains + 1;
        consider(C.trainCost(s, 1), C.railRate(t) - rate, () => C.buyTrain(s, 1));
        for (const r of C.ROUTES) { const q = probe(); q.routes[r.id]++; consider(C.routeCost(s, r.id), Math.max(C.railRate(q) - rate, s.trains ? 0 : C.cargoValue(s) * 0.1), () => C.buyRoute(s, r.id)); }
      }
      if (s.zone >= 4) consider(C.staffCost(s, 1), per * 0.03, () => C.buyStaff(s, 1));
      if (s.zone >= 5) { const q = Object.create(s); q.posts = s.posts + 1; consider(C.postCost(s, 1), Math.max(C.guardRate(q) - C.guardRate(s), per * 0.01), () => C.buyPost(s, 1)); }      // 6구역: 초소
      if (s.zone >= 6) { const q = Object.create(s); q.antennas = s.antennas + 1; consider(C.antennaCost(s, 1), Math.max(per * 0.05, per * (C.survivorRate(q) - C.survivorRate(s)) / Math.max(1, C.survivorRate(s)) * 0.2), () => C.buyAntenna(s, 1)); }      // 7구역: 안테나(생존자가 전체 배수를 올린다)   // 5구역: 연구원은 물자를 직접 벌지 않으므로 어림값으로 따진다
      for (const u of C.UPGRADES) { const c = C.upgradeCost(s, u.id); if (isFinite(c)) consider(c, per * (u.key === 'click' || u.key === 'loot' ? 0.02 : u.key === 'cap' || u.key === 'broker' || u.key === 'slack' || u.key === 'trip' || u.key === 'traincost' || u.key === 'routecost' || u.key === 'staffcost' || u.key === 'labcost' ? 0.03 : u.key === 'lab' ? 0.06 : 0.12), () => C.buyUpgrade(s, u.id)); }
      if (!best) break;
      best.buy();
    }
    const gain = C.antibodiesOnRetreat(s);
    // 철수: 판을 30분 넘게 했고, 얻을 항체가 지금까지의 절반 이상이며, 다음 살 것까지 stuck 초 넘게 걸릴 만큼 막혔을 때
    const isStuck = cheapest - s.supplies > C.productionPerSec(s) * stuck;
    const nz = C.nextZone(s), wall = nz && nz.ready && (nz.cost - nz.have) > C.incomePerSec(s) * 6 * 3600;      // 문 값의 벽: 목표는 다 채웠는데 문 값이 한참 멀다
    const endWall = !nz && s.zone >= 6 && !s.endedRun && isFinite(C.serumCost(s)) && (C.serumCost(s) - s.supplies) > C.incomePerSec(s) * 6 * 3600;
    if (C.canRetreat(s) && s.runSeconds > 1800 && ((isStuck && s.zone < 4 && gain >= Math.max(3, s.antibodyTotal * share)) || ((wall || endWall) && gain >= Math.max(3, s.antibodyTotal * 0.15)))) { if (process.env.DBG) console.log('RETREAT', JSON.stringify({ goals: s.goalsDone, stalls: s.stalls, peak: s.peakSales, trade: s.tradeEarned.toExponential(2), run: s.runEarned.toExponential(2), sup: s.supplies.toExponential(2), pps: C.productionPerSec(s).toExponential(2), z1: C.searchRate(s).toExponential(2), z2: C.tradeRate(s).toExponential(2), waves: s.wavesCleared, siege: s.siege, def: C.defensePower(s), str: C.nightStrength(s) })); marks.push({ retreat: true, day: day + 1, hours: active / 3600, gain, zone: s.zone, why: wall ? 'gate' : endWall ? 'serum' : 'stuck', inc: C.incomePerSec(s).toExponential(1), sup: s.supplies.toExponential(1), next: nz ? nz.cost.toExponential(1) : '', goals: C.goals(s, s.zone).filter(g => !g.done).map(g => g.id + ':' + C.formatNumber(g.value) + '/' + C.formatNumber(g.need)).join(' ') }); s = C.retreat(s, 0, rng).state; spendTraits(); }
  };
  const gap = Math.max(0, 16 * 3600 / sessions - minutes * 60);
  while (day < days && !marks.some(m => m.end)) {
    for (let i = 0; i < sessions && !marks.some(m => m.end); i++) { for (let t = 0; t < minutes * 60 && !marks.some(m => m.end); t += dt) step(); C.applyOffline(s, i === sessions - 1 ? gap + 8 * 3600 : gap); }
    day++;
    if (process.env.LIVE && day % 5 === 0) console.log(`  .. ${day}일 ${(active / 3600).toFixed(0)}h ${s.zone + 1}구역 물자 ${C.formatNumber(s.supplies)} 초당 ${C.formatNumber(C.productionPerSec(s))} 철수 ${s.retreats} 항체 ${s.antibodyTotal} 목표 ${C.goals(s, s.zone).map(g => g.id + (g.done ? '✓' : ':' + C.formatNumber(g.value) + '/' + C.formatNumber(g.need))).join(' ')} 품목 ${s.recipe} 의뢰 ${s.contract ? s.contract.item + ' ' + Math.floor(s.contract.have) + '/' + s.contract.need : '-'} 방어 ${C.formatNumber(C.defensePower(s))}/${C.formatNumber(C.nightStrength(s))} 넉넉한밤 ${s.safeNights} 생존자 ${C.formatNumber(s.survivors)} 혈청 ${s.serumStage} 직원 ${s.staff} 초소 ${s.posts} 안테나 ${s.antennas}`);
  }
  return { marks, day, state: s, hours: active / 3600 };
}

if (require.main === module) {
  const r = run({ sessions: arg('SESSIONS', 4), minutes: arg('MINUTES', 15), days: arg('DAYS', 30), taps: arg('TAPS', 0), seed: arg('SEED', 1), stuck: arg('STUCK', 300), share: arg('SHARE', 0.5), dt: arg('DT', 1) });
  r.marks.forEach(m => console.log(m.end ? `엔딩: ${m.day}일째, 접속 ${m.hours.toFixed(1)}시간, 철수 ${m.retreats}번` : m.retreat ? `  철수: ${m.day}일째, 접속 ${m.hours.toFixed(1)}시간, ${m.zone + 1}구역에서 항체 +${m.gain}` : `${m.gate ? '다음 구역(준비 중)의 문 앞' : (m.enter + 1) + '구역 첫 도착'}: ${m.day}일째, 접속 ${m.hours.toFixed(1)}시간, 철수 ${m.retreats}번` + (m.pps ? `, 그때 초당 ${C.formatNumber(m.pps)}` : '')));
  if (!r.marks.some(m => m.end)) console.log(`${r.day}일 동안 엔딩에 닿지 못했다. 지금 ${C.zoneLabel(r.state)}, 철수 ${r.state.retreats}번, 항체 ${r.state.antibodyTotal}, 이번 판 누적 ${C.formatNumber(r.state.runEarned)}`);
}
module.exports = { run };
