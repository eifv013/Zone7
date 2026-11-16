/*
 * Scene 모델 단위 테스트 — 도트 화면의 상태 기계를 캔버스 없이 검증한다.
 * 실행: node --test test/scene.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/scene.js');

const day = { t: 0.2, zone: 0, safe: true, boss: false, def: {} };
const dusk = { ...day, t: 0.8 };
const rng = () => 0.5;
/** 조건이 참이 될 때까지 0.1초씩 진행한다. 끝내 안 되면 실패. */
function runUntil(m, view, done, limit = 600) {
  for (let i = 0; i < limit; i++) { const ev = S.step(m, view, 0.1, rng); if (done(ev)) return ev; }
  assert.fail('조건에 도달하지 못했다: ' + JSON.stringify(m.hero));
}

test('색 섞기: 양 끝과 중간, 범위를 벗어난 비율', () => {
  assert.equal(S.lerpColor('#000000', '#ffffff', 0), '#000000');
  assert.equal(S.lerpColor('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(S.lerpColor('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(S.lerpColor('#102030', '#ffffff', -3), '#102030');
  assert.equal(S.lerpColor('#102030', '#ffffff', 9), '#ffffff');
});

test('하늘: 낮에는 밝고 밤에는 어둡다, 잘못된 시각은 아침으로 본다', () => {
  assert.equal(S.skyAt(0.2).dark, 0);
  assert.equal(S.skyAt(0.95).dark, 1);
  assert.ok(S.skyAt(0.7).dark > 0 && S.skyAt(0.7).dark < 1);
  assert.equal(S.skyAt(0.95).top, '#10141f');
  assert.deepEqual(S.skyAt(NaN), S.skyAt(0));
  assert.deepEqual(S.skyAt(5), S.skyAt(1));
});

test('주인공: 더미로 가서 뒤지고, 물자를 들고 돌아와 내려놓는다', () => {
  const m = S.create(256);
  assert.equal(runUntil(m, day, ev => ev === 'found'), 'found');
  assert.equal(m.hero.carrying, true);
  assert.ok(m.piles.includes(m.hero.x), '더미 위치에서 발견한다');
  assert.equal(runUntil(m, day, ev => ev === 'delivered'), 'delivered');
  assert.equal(m.hero.carrying, false);
  assert.equal(m.hero.x, m.home);
  assert.equal(m.delivered, 1);
});

test('주인공: 화면 밖으로 나가지 않는다', () => {
  const m = S.create(200);
  for (let i = 0; i < 2000; i++) {
    S.step(m, day, 0.1, Math.random);
    assert.ok(m.hero.x >= m.home && m.hero.x <= m.W - 8, 'x=' + m.hero.x);
  }
});

test('해가 지면 빈손으로라도 돌아와 아침까지 거점에 머문다', () => {
  const m = S.create(256);
  runUntil(m, day, () => m.hero.state === 'search');
  runUntil(m, dusk, () => m.hero.state === 'home');
  assert.equal(m.delivered, 0, '뒤지다 말고 왔으니 가져온 것이 없다');
  for (let i = 0; i < 100; i++) S.step(m, dusk, 0.1, rng);
  assert.equal(m.hero.state, 'home');
});

test('수색 버튼을 누르면 더 빨리 다녀온다', () => {
  const trip = (pokes) => {
    const m = S.create(256);
    let n = 0;
    while (m.delivered < 1 && n++ < 2000) { if (pokes) S.poke(m, rng); S.step(m, day, 0.1, rng); }
    return n;
  };
  assert.ok(trip(true) < trip(false));
});

test('좀비: 낮에는 없고 해 질 녘에 몰려와 방벽 앞에서 멈춘다', () => {
  const m = S.create(256);
  for (let i = 0; i < 50; i++) S.step(m, day, 0.1, rng);
  assert.equal(m.zombies.length, 0);
  for (let i = 0; i < 600; i++) S.step(m, dusk, 0.1, rng);
  assert.equal(m.zombies.length, 4, '막을 수 있는 밤은 4마리');
  m.zombies.forEach(z => assert.ok(z.x > m.wall, '방벽을 넘지 않는다'));
  const danger = S.create(256);
  for (let i = 0; i < 600; i++) S.step(danger, { ...dusk, safe: false }, 0.1, rng);
  assert.equal(danger.zombies.length, 8, '위험한 밤은 8마리');
});

test('변이체 밤에는 큰 좀비가 정확히 하나 나온다', () => {
  const m = S.create(256);
  for (let i = 0; i < 600; i++) S.step(m, { ...dusk, boss: true }, 0.1, rng);
  assert.equal(m.zombies.filter(z => z.big).length, 1);
});

test('밤 결과 연출: 좀비가 사라지고, 뚫렸을 때만 화면이 흔들린다', () => {
  const m = S.create(256);
  for (let i = 0; i < 300; i++) S.step(m, dusk, 0.1, rng);
  S.night(m, true, rng);
  assert.equal(m.zombies.length, 0);
  assert.ok(m.flash > 0);
  assert.equal(m.shake, 0);
  S.night(m, false, rng);
  assert.ok(m.shake > 0);
  assert.equal(m.flashColor, '#b3261a');
});

test('잘못된 시간 간격은 무시하고, 입자는 무한히 쌓이지 않는다', () => {
  const m = S.create(256);
  for (const bad of [0, -1, NaN, Infinity, undefined]) assert.equal(S.step(m, day, bad, rng), null);
  assert.equal(m.time, 0);
  for (let i = 0; i < 500; i++) S.poke(m, rng);
  assert.ok(m.particles.length <= 120);
});

test('화면 폭이 바뀌면 더미 위치가 다시 잡히고 모두 방벽 바깥·화면 안에 있다', () => {
  const m = S.create(256);
  for (const w of [160, 220, 420]) {
    S.resize(m, w);
    assert.equal(m.W, w);
    m.piles.forEach(p => assert.ok(p > m.wall && p < w - 8, `W=${w} p=${p}`));
    assert.equal(m.wall, w >= 300 ? S.WALL_WIDE : S.WALL_X, '넓은 화면에서는 거점이 넓어진다');
    assert.equal(m.hero.x, m.home, '폭이 바뀌면 주인공은 거점에서 다시 시작한다');
  }
  S.resize(m, NaN);
  assert.equal(m.W, 420, '잘못된 폭은 무시한다');
  assert.equal(S.create(-5).W, 256);
});

test('원정대: 출발 직후와 귀환 직전에만 화면에 보인다', () => {
  const m = S.create(256);
  assert.equal(S.squadAt(m, null), null);
  const out = S.squadAt(m, { elapsed: 2, left: 88 });
  assert.equal(out.dir, 1);
  assert.ok(out.x > m.wall && out.x < m.W);
  assert.ok(S.squadAt(m, { elapsed: 6, left: 84 }).x > out.x, '걸어 나갈수록 오른쪽으로');
  assert.equal(S.squadAt(m, { elapsed: 40, left: 50 }), null, '멀리 나가 있는 동안은 보이지 않는다');
  const back = S.squadAt(m, { elapsed: 88, left: 2 });
  assert.equal(back.dir, -1);
  assert.ok(S.squadAt(m, { elapsed: 89.9, left: 0.1 }).x < back.x, '돌아올수록 방벽 쪽으로');
  assert.equal(S.squadAt(m, { elapsed: NaN, left: 5 }), null);
});

test('날씨: 같은 날·같은 구역이면 항상 같고, 눈은 여정 후반에만 내린다', () => {
  const kinds = new Set();
  for (let day = 1; day <= 400; day++) {
    for (let zone = 0; zone < 7; zone++) {
      const w = S.weatherFor(day, zone);
      assert.equal(w, S.weatherFor(day, zone));
      assert.ok(['clear', 'rain', 'fog', 'snow'].includes(w));
      if (zone < 4) assert.notEqual(w, 'snow');
      kinds.add(w);
    }
  }
  assert.equal(kinds.size, 4, '네 가지 날씨가 모두 나온다');
  const count = (zone, kind) => { let n = 0; for (let d = 1; d <= 600; d++) if (S.weatherFor(d, zone) === kind) n++; return n; };
  assert.ok(count(5, 'fog') > count(0, 'fog'), '강변 구역은 안개가 더 잦다');
  assert.equal(S.weatherFor(NaN, undefined), S.weatherFor(1, 0));
});

test('농성 중 버틴 밤은 번쩍임과 흔들림 없이 좀비만 사라진다', () => {
  const m = S.create(256);
  for (let i = 0; i < 300; i++) S.step(m, dusk, 0.1, rng);
  assert.ok(m.zombies.length > 0);
  S.night(m, 'held', rng);
  assert.deepEqual([m.zombies.length, m.flash, m.shake], [0, 0, 0]);
});

/* ================= 구역별 무리와 고유 구조물 ================= */

/** 캔버스 대신 쓰는 기록기: 무엇을 어디에 칠했는지만 남긴다. */
function recorder() {
  const calls = [];
  return { calls, fillStyle: '', globalAlpha: 1, fillRect(x, y, w, h) { calls.push({ color: this.fillStyle, x, y, w, h }); } };
}
const full = { t: 0.3, day: 3, zone: 0, safe: true, boss: false, def: {}, buildings: {}, expedition: null };

test('무리 성격: 모르는 값은 기본(배회자)으로 그린다', () => {
  assert.equal(S.hordeFor('runner'), S.HORDES.runner);
  assert.equal(S.hordeFor(undefined), S.HORDES.walker);
  assert.equal(S.hordeFor('toString'), S.HORDES.walker, '객체의 기본 속성 이름에 속지 않는다');
  assert.equal(S.hordeFor(null), S.HORDES.walker);
});

test('무리 성격: 떼로 몰려오는 밤과 수가 많은 무리는 화면에 더 많이 나온다', () => {
  const count = (view) => { const m = S.create(256); for (let i = 0; i < 900; i++) S.step(m, view, 0.1, rng); return m; };
  assert.equal(count({ ...dusk, horde: 'walker' }).zombies.length, 4);
  assert.equal(count({ ...dusk, horde: 'swarm' }).zombies.length, 4 + S.HORDES.swarm.extra);
  const surge = count({ ...dusk, horde: 'swarm', surge: true });
  assert.equal(surge.zombies.length, 4 + S.HORDES.swarm.extra + S.SURGE_EXTRA);
  surge.zombies.forEach(z => { assert.ok(z.x > surge.wall, '방벽을 넘지 않는다'); assert.ok(z.stop < surge.W, '멈추는 자리가 화면 안이다'); });
  const narrow = S.create(200);
  for (let i = 0; i < 900; i++) S.step(narrow, { ...dusk, horde: 'drawn', safe: false, surge: true }, 0.1, rng);
  narrow.zombies.forEach(z => assert.ok(z.stop < narrow.W, '좁은 화면에서도 줄이 화면 밖으로 늘어지지 않는다'));
});

test('무리 성격: 질주자는 더 빨리 다가온다', () => {
  const reach = (horde) => {
    const m = S.create(256);
    for (let i = 0; i < 30; i++) S.step(m, { ...dusk, horde }, 0.1, rng); // 3초
    return m.zombies[0].x;
  };
  assert.ok(reach('runner') < reach('walker'));
  assert.ok(reach('plated') > reach('walker'), '철갑 무리는 느리다');
});

test('무리 성격: 집결한 무리의 변이체는 더 크게 그려진다', () => {
  const draw = (horde) => {
    const m = S.create(256);
    for (let i = 0; i < 600; i++) S.step(m, { ...dusk, boss: true, horde }, 0.1, rng);
    const ctx = recorder();
    S.draw(ctx, m, { ...full, t: 0.8, boss: true, horde });
    return Math.max(...ctx.calls.filter(c => c.color === '#c0392b').map(c => c.w));
  };
  assert.equal(draw('walker'), 2);
  assert.equal(draw('gather'), 3);
});

test('구역 고유 방벽·시설: 가지고 있을 때만 그려진다(모든 구역, 넓은 화면과 폰 화면)', () => {
  for (const W of [256, 480]) {
    for (let zone = 0; zone < 7; zone++) {
      const m = S.create(W);
      const base = recorder(); S.draw(base, m, { ...full, zone });
      const wall = recorder(); S.draw(wall, m, { ...full, zone, zoneDefense: 3 });
      const both = recorder(); S.draw(both, m, { ...full, zone, zoneDefense: 3, zoneBuilding: 2 });
      assert.ok(wall.calls.length > base.calls.length, `구역 ${zone + 1} 방벽 (폭 ${W})`);
      assert.ok(both.calls.length > wall.calls.length, `구역 ${zone + 1} 시설 (폭 ${W})`);
      both.calls.forEach(c => assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y) && c.w > 0 && c.h > 0, '칠하는 자리가 올바른 숫자다'));
    }
  }
});

test('그리기: 새 항목이 없는 이전 형식의 view 로도 오류 없이 그린다', () => {
  const m = S.create(256);
  for (let i = 0; i < 300; i++) S.step(m, dusk, 0.1, rng);
  assert.doesNotThrow(() => S.draw(recorder(), m, { t: 0.8, day: 1, zone: 2, safe: false, boss: true, def: { wire: 1 } }));
});

/* ================= 싸움, 쓰러지는 모습, 산 것들이 보이는 거점 ================= */

const run = (m, view, sec) => { for (let i = 0; i < sec * 10; i++) S.step(m, view, 0.1, rng); return m; };
/** 쓰러진 수를 센다. 시체는 잠시 뒤 사라지므로 목록 길이가 아니라 처음 보는 시체를 센다. */
function fallenCounter() { const seen = new Set(); return (m) => { m.corpses.forEach(c => seen.add(c)); return seen.size; }; }

test('사격: 방어 수단이 있으면 해 질 녘에 좀비가 쓰러지고 빈자리는 다시 채워진다', () => {
  const none = run(S.create(256), dusk, 30);
  assert.equal(none.corpses.length, 0, '무기가 없으면 쓰러지지 않는다');
  assert.equal(none.shots.length, 0);
  const m = S.create(256);
  let fallen = 0, shots = 0, most = 0;
  const tally = fallenCounter();
  for (let i = 0; i < 400; i++) {
    S.step(m, { ...dusk, def: { tower: 1, turret: 2 } }, 0.1, rng);
    fallen = tally(m);
    shots = Math.max(shots, m.shots.length);
    most = Math.max(most, m.zombies.length);
  }
  assert.ok(fallen >= 10, '40초 동안 여럿 쓰러진다: ' + fallen);
  assert.ok(shots >= 1, '사격 흔적이 보인다');
  assert.ok(most <= 4, '막을 수 있는 밤의 수(4)를 넘지 않는다');
  assert.ok(m.zombies.length >= 1, '쓰러진 자리는 다시 채워진다');
  m.zombies.forEach((z, i) => { if (i) assert.ok(z.stop > m.zombies[i - 1].stop, '멈출 자리는 방벽에 가까운 순서로 매겨진다'); });
});

test('사격: 낮에는 쏘지 않고, 못 막는 밤에는 덜 쓰러지며 무리가 방벽을 두드린다', () => {
  const day = run(S.create(256), { t: 0.3, zone: 0, safe: true, def: { tower: 1 } }, 20);
  assert.equal(day.corpses.length + day.shots.length, 0);
  const count = (safe) => {
    const m = S.create(256); let n = 0, shook = false; const tally = fallenCounter();
    for (let i = 0; i < 400; i++) { S.step(m, { ...dusk, safe, def: { tower: 1 } }, 0.1, rng); n = tally(m); if (m.shake > 0) shook = true; }
    return { n, shook, zombies: m.zombies.length };
  };
  const safe = count(true), unsafe = count(false);
  assert.ok(unsafe.n < safe.n, `못 막는 밤(${unsafe.n})이 막는 밤(${safe.n})보다 덜 쓰러진다`);
  assert.equal(safe.shook, false, '막을 수 있는 밤에는 방벽이 흔들리지 않는다');
  assert.equal(unsafe.shook, true, '못 막는 밤에는 두드려서 흔들린다');
  assert.ok(unsafe.zombies > safe.zombies);
});

test('사격: 무기마다 쓰러지는 모습이 다르고, 화염과 전자기 울타리는 가까이 온 것만 맞힌다', () => {
  const deaths = (def) => { const m = S.create(256); const seen = new Set(); for (let i = 0; i < 600; i++) { S.step(m, { ...dusk, def }, 0.1, rng); m.corpses.forEach(c => seen.add(c.death)); } return [...seen]; };
  assert.deepEqual(deaths({ tower: 1 }), ['shot']);
  assert.deepEqual(deaths({ flame: 1 }), ['burn']);
  assert.deepEqual(deaths({ emp: 1 }), ['zap']);
  assert.deepEqual(deaths({ rail: 1 }), ['blast']);
  assert.deepEqual(deaths({ wire: 9 }), [], '철조망은 쓰러뜨리지 않는다');
  const flame = S.WEAPONS.find(w => w.id === 'flame');
  const m = S.create(256);
  for (let i = 0; i < 600; i++) {
    const before = m.corpses.length;
    S.step(m, { ...dusk, def: { flame: 1 } }, 0.1, rng);
    if (m.corpses.length > before) assert.ok(m.corpses[m.corpses.length - 1].x <= m.wall + flame.reach + 0.01, '닿는 거리 안에서만 불탄다');
  }
});

test('사격: 변이체는 여러 발을 맞아야 쓰러지고, 철갑 무리는 두 발을 버틴다', () => {
  const m = S.create(256);
  let shotsAtBoss = 0, fell = false;
  for (let i = 0; i < 1200 && !fell; i++) {
    const boss = m.zombies.find(z => z.big), hp = boss ? boss.hp : null;
    S.step(m, { ...dusk, boss: true, def: { tower: 1 } }, 0.1, rng);
    const after = m.zombies.find(z => z.big);
    if (boss && after && after.hp < hp) shotsAtBoss++;
    if (boss && !after) { shotsAtBoss++; fell = true; }
  }
  assert.equal(fell, true);
  assert.equal(shotsAtBoss, S.BOSS_HP);
  const plated = S.create(256);
  S.step(plated, { ...dusk, horde: 'plated' }, 0.1, rng);
  assert.equal(plated.zombies[0].hp, 2);
});

test('밤 결과: 막으면 남은 무리가 쓰러지고, 뚫리면 거점으로 뛰어들고, 농성 중에는 조용히 사라진다', () => {
  const ready = () => run(S.create(256), { ...dusk, safe: false }, 60);
  const won = ready(), n = won.zombies.length;
  S.night(won, true, rng);
  assert.equal(won.zombies.length, 0);
  assert.equal(won.corpses.length, n);
  assert.equal(won.raiders.length, 0);
  const lost = ready();
  S.night(lost, false, rng);
  assert.equal(lost.zombies.length, 0);
  assert.equal(lost.corpses.length, 0);
  assert.ok(lost.raiders.length > 0 && lost.raiders.length <= 8);
  const x0 = lost.raiders[0].x;
  S.step(lost, day, 0.2, rng);
  assert.ok(lost.raiders[0].x < x0, '왼쪽(거점)으로 달린다');
  run(lost, day, 3);
  assert.equal(lost.raiders.length, 0, '잠시 뒤 사라진다');
  const held = ready();
  S.night(held, 'held', rng);
  assert.equal(held.zombies.length + held.corpses.length + held.raiders.length, 0);
});

test('시체는 잠시 뒤 사라지고 정해진 수 넘게 쌓이지 않는다', () => {
  const m = S.create(256);
  for (let k = 0; k < 10; k++) { run(m, { ...dusk, safe: false, surge: true, horde: 'drawn' }, 4); S.night(m, true, rng); }
  assert.ok(m.corpses.length <= S.CORPSE_MAX);
  run(m, day, S.CORPSE_TIME + 1);
  assert.equal(m.corpses.length, 0);
  const sized = run(S.create(256), { ...dusk, def: { tower: 1 } }, 30);
  S.resize(sized, 480);
  assert.equal(sized.corpses.length + sized.shots.length + sized.zombies.length, 0, '화면 폭이 바뀌면 싸움도 처음부터');
});

const ALL_FACILITIES = ['scouts', 'garden', 'purifier', 'workshop', 'solar', 'radio', 'bunker', 'lab', 'port', 'district'];

test('거점 건물: 시설 합계로 단계가 오르고, 시설 보유 수로 방의 단계가 오른다', () => {
  assert.deepEqual([0, 1, 9, 10, 49, 50, 149, 150, 399, 400, 5000].map(S.baseStage), [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.deepEqual([0, 1, 9, 10, 49, 50, 149, 150, 5000].map(S.facilityTier), [0, 0, 0, 1, 1, 2, 2, 3, 3]);
  for (const bad of [-3, NaN, undefined, null, 'x']) { assert.equal(S.baseStage(bad), 0); assert.equal(S.facilityTier(bad), 0); }
});

test('거점 건물: 시설 열 종류가 방을 하나씩 갖고, 방벽 안쪽과 화면 안에 들어가며, 서로 겹치지 않는다', () => {
  assert.deepEqual(S.ROOMS.flat().sort(), ALL_FACILITIES.slice().sort());
  for (const W of [183, 256, 480]) {   // 183 은 실제 폰의 장면 폭
    const m = S.create(W), slots = ALL_FACILITIES.map(id => ({ id, ...S.roomSlot(m, id) }));
    slots.forEach(a => {
      assert.ok(a.w >= 11, '설비(11칸)가 들어갈 폭이다');
      assert.ok(a.x >= 0 && a.x + a.w <= m.wall - 10, `${a.id} 의 방이 방벽 안쪽이다 (폭 ${W})`);
      assert.ok(a.y >= 28 && a.y + a.h <= S.GROUND - 11, `${a.id} 의 방이 사람 머리 위, 화면 안에 있다`);
      slots.forEach(o => { if (o !== a) assert.ok(a.x + a.w <= o.x || o.x + o.w <= a.x || a.y + a.h <= o.y || o.y + o.h <= a.y, `${a.id} 와 ${o.id} 의 방이 겹친다`); });
    });
  }
  assert.equal(S.roomSlot(S.create(256), 'nothing'), null);
});

test('거점 건물: 지은 시설의 방에만 설비가 들어서고, 많이 지으면 방의 등이 늘어난다', () => {
  for (const W of [183, 480]) {
    const m = S.create(W), key = c => [c.color, c.x, c.y, c.w, c.h].join();
    const paint = (buildings, t = 0.3) => { const ctx = recorder(); S.draw(ctx, m, { ...full, t, buildings }); return ctx.calls; };
    for (const id of ALL_FACILITIES) {
      const slot = S.roomSlot(m, id);
      // 시설 합계(=거점 단계)가 같은 상태와 비교해서 이 방에 새로 그려진 것만 본다
      const mine = (n) => { const had = new Set(paint({ none: n }).map(key)); return paint({ [id]: n }).filter(c => !had.has(key(c))); };
      const one = mine(1);
      assert.ok(one.length >= 4, `${id} 의 방에 설비가 그려진다 (폭 ${W})`);
      one.forEach(c => assert.ok(c.x >= slot.x && c.x + c.w <= slot.x + slot.w + 1 && c.y >= slot.y && c.y + c.h <= slot.y + slot.h + 1, `${id} 의 설비가 제 방 안에 있다`));
      const pips = (n) => mine(n).filter(c => c.color === '#f0b400' && c.w === 1 && c.h === 1 && c.y === slot.y + 1).length;
      assert.deepEqual([1, 10, 50, 150].map(pips).map((v, i, a) => v - a[0]), [0, 1, 2, 3], `${id}: 10·50·150곳에서 등이 하나씩 는다`);
    }
  }
});

test('거점 건물: 단계가 오르면 거점이 통째로 다른 모습이 되고, 건물이 서면 천막을 걷는다', () => {
  for (const W of [183, 480]) {
    const m = S.create(W);
    const paint = (n) => { const ctx = recorder(); S.draw(ctx, m, { ...full, buildings: n ? { none: n } : {} }); return ctx.calls; };
    const sig = (n) => paint(n).map(c => [c.color, c.x, c.y, c.w, c.h].join()).join('|');
    const stages = [0, 1, 10, 50, 150, 400].map(sig);
    assert.equal(new Set(stages).size, 6, '여섯 단계가 모두 다르게 그려진다');
    assert.equal(sig(10), sig(19), '같은 단계에서는 그림이 같다(생존자 수가 같은 범위에서 비교)');
    const tent = (n) => paint(n).filter(c => c.y === S.GROUND - 1 && c.x === 16 && c.w === 22).length;
    assert.deepEqual([0, 1, 10, 50, 400].map(tent), [1, 0, 0, 0, 0]);
    // 건물로 새로 그려진 것(시설이 없을 때와의 차이)은 방벽 안쪽, 화면 안에 있다
    const had = new Set(paint(0).map(c => [c.color, c.x, c.y, c.w, c.h].join()));
    paint(400).filter(c => !had.has([c.color, c.x, c.y, c.w, c.h].join()) && c.y < S.GROUND - 12).forEach(c => assert.ok(c.y >= 16 && c.x >= 0 && c.x < m.wall + 20, `건물이 화면 밖으로 나간다: ${JSON.stringify(c)}`));
  }
});

test('창고: 나른 물자는 건물 1층 창고 안에 쌓이고, 정해진 수를 넘지 않는다', () => {
  assert.deepEqual([[0, 0], [1, 0], [1, 3], [3, 8], [5, 99], [5, NaN], [2, -4]].map(a => S.stockCrates(...a)), [0, 1, 4, 11, S.STOCK_MAX, 5, 2]);
  for (const W of [183, 480]) {
    const crates = (delivered, buildings) => {
      const m = S.create(W); m.delivered = delivered;
      const ctx = recorder(); S.draw(ctx, m, { ...full, buildings });
      return ctx.calls.filter(c => c.color === '#8a5a34' && c.w === 4 && c.h === 4);
    };
    const m = S.create(W), storageRight = S.roomSlot(m, 'scouts').x + S.roomSlot(m, 'scouts').w * 2;
    const one = crates(0, { scouts: 1 }), more = crates(5, { scouts: 1 }), full8 = crates(50, { scouts: 1 });
    assert.equal(one.length, 1);
    assert.equal(more.length, 6);
    assert.equal(full8.length, 9, '나른 것은 8개까지만 더 쌓인다');
    full8.forEach(c => { assert.ok(c.x >= 10 && c.x + c.w <= storageRight, `상자가 창고 칸 안에 있다 (폭 ${W}): ${c.x}`); assert.ok(c.y >= S.GROUND - 12 && c.y + c.h <= S.GROUND, '상자가 1층 안에 있다'); });
    // 건물이 없을 때(천막 시절)는 예전처럼 천막 옆 땅에 쌓인다
    assert.equal(crates(4, {}).length, 4);
  }
});

test('거점 건물: 1층도 채워져 있다(창고, 공용실, 현관과 계단)', () => {
  for (const W of [183, 480]) {
    const m = S.create(W), key = c => [c.color, c.x, c.y, c.w, c.h].join();
    const paint = (buildings) => { const ctx = recorder(); S.draw(ctx, m, { ...full, buildings }); return ctx.calls; };
    const had = new Set(paint({}).map(key));
    const ground = paint({ scouts: 10 }).filter(c => !had.has(key(c)) && c.y >= S.GROUND - 12 && c.y < S.GROUND && c.x >= 9 && c.x < m.wall - 10);
    const slotW = S.roomSlot(m, 'scouts').w;
    for (let col = 0; col < 5; col++) assert.ok(ground.some(c => c.x < 10 + (col + 1) * slotW && c.x + c.w > 10 + col * slotW + 1 && c.w > 1), `1층 ${col + 1}번째 칸에 그려진 것이 있다 (폭 ${W})`);
  }
});

test('거점 넓이: 폰에서도 방벽이 화면의 절반 가까이에 서고, 바깥에 싸울 자리가 남는다', () => {
  const m = S.create(183);
  assert.equal(m.wall, S.WALL_X);
  assert.ok(m.wall >= 80, '거점 안쪽이 넉넉하다');
  assert.ok(m.W - m.wall >= 90, '방벽 바깥에 무리가 설 자리가 있다');
  m.piles.forEach(p => assert.ok(p > m.wall + 10 && p < m.W - 8));
});

test('앞마당에는 연구 소품과 구역 고유 시설만 놓인다: 시설을 지어도 그대로다', () => {
  const yard = (view) => { const ctx = recorder(); S.draw(ctx, S.create(183), { ...full, ...view }); return ctx.calls.filter(c => c.y > S.GROUND + 4 && c.x < 80 && c.h > 1).length; };
  const all = Object.fromEntries(ALL_FACILITIES.map(id => [id, 20]));
  assert.equal(yard({ buildings: all }), yard({}));
  assert.ok(yard({ zoneBuilding: 1 }) > yard({}), '구역 고유 시설은 앞마당 끝에 놓인다');
});

test('연구는 하나도 빠짐없이, 낮에도 밤에도, 폰 폭에서도 화면에 보인다', () => {
  const ids = ['compost', 'drill', 'maps', 'traps', 'ration', 'grid', 'alarm', 'shift', 'caravan', 'serum', 'fortress'];
  for (const W of [256, 480]) {
    for (const t of [0.3, 0.95]) {
      const calls = (research) => { const ctx = recorder(); S.draw(ctx, S.create(W), { ...full, t, research }); return ctx.calls; };
      const base = calls({});
      for (const id of ids) {
        const extra = calls({ [id]: true });
        assert.ok(extra.length > base.length, `연구 ${id} (폭 ${W}, 시각 ${t})`);
        // 새로 칠한 것은 모두 화면 안이다
        const key = c => [c.color, c.x, c.y, c.w, c.h].join();
        const had = new Set(base.map(key));
        extra.filter(c => !had.has(key(c))).forEach(c => assert.ok(c.x + c.w > 0 && c.x < W && c.y >= 0 && c.y + c.h <= S.H, `연구 ${id} 의 소품이 화면 밖이다`));
      }
    }
  }
  // 앞마당 소품 여섯은 서로 겹치지 않는 자리에 있다
  const spans = ['compost', 'ration', 'drill', 'serum', 'shift', 'caravan'].map(id => {
    const ctx = recorder(), plain = recorder(), m = S.create(256);
    S.draw(plain, m, full); S.draw(ctx, m, { ...full, research: { [id]: true } });
    const key = c => [c.color, c.x, c.y, c.w, c.h].join(), had = new Set(plain.calls.map(key));
    const mine = ctx.calls.filter(c => !had.has(key(c)) && !/^rgba/.test(c.color));
    return [Math.min(...mine.map(c => c.x)), Math.max(...mine.map(c => c.x + c.w))];
  });
  spans.forEach((sp, i) => { if (i) assert.ok(sp[0] >= spans[i - 1][1], `앞마당 소품 ${i} 번이 앞의 것과 겹친다: ${spans[i - 1]} / ${sp}`); });
});

test('산 것들이 거점에 보인다: 연구, 수색 장비, 제작한 담당자, 생존자', () => {
  for (const W of [256, 480]) {
    const count = (extra, t = 0.3) => { const ctx = recorder(); S.draw(ctx, S.create(W), { ...full, t, ...extra }); return ctx.calls.length; };
    const base = count({});
    for (const id of ['compost', 'drill', 'maps', 'traps', 'ration', 'grid', 'fortress']) assert.ok(count({ research: { [id]: true } }) > base, `연구 ${id} (폭 ${W})`);
    assert.ok(count({ research: { alarm: true } }) > base);
    assert.ok(count({ research: { shift: true } }, 0.95) > count({ research: { shift: true } }), '교대 근무의 작업등은 밤에 빛이 번진다');
    assert.ok(count({ research: { serum: true } }) > base);
    for (const id of ['backpack', 'dog', 'drone']) assert.ok(count({ upgrades: { [id]: true } }) > base, `장비 ${id}`);
    for (const id of ['operator', 'warden', 'builder']) assert.ok(count({ gear: { [id]: 1 } }) > base, `담당 ${id}`);
    assert.ok(count({ gear: { barricade: 5 } }) > base);
    assert.ok(count({ buildings: { scouts: 30 } }) > count({ buildings: { scouts: 5 } }), '시설이 늘면 생존자가 보인다');
  }
  // 원정대 수레(호송대 연구)
  const squad = (research) => { const ctx = recorder(); S.draw(ctx, S.create(256), { ...full, expedition: { elapsed: 2, left: 80 }, research }); return ctx.calls.length; };
  assert.ok(squad({ caravan: true }) > squad({}));
});

/* ================= 밤 화면: 안개와 불빛 ================= */

test('안개는 밤에 훨씬 옅고, 화면 전체를 덮는 띠를 그리지 않는다', () => {
  assert.equal(S.fogStrength(0), 1);
  assert.ok(Math.abs(S.fogStrength(1) - 0.3) < 1e-9);
  assert.equal(S.fogStrength(NaN), 1);
  assert.ok(Math.abs(S.fogStrength(9) - 0.3) < 1e-9);
  // 안개 낀 날을 찾는다(같은 날·구역이면 날씨가 같다)
  let dayNo = 1; while (S.weatherFor(dayNo, 0) !== 'fog') dayNo++;
  const fogOf = (t) => {
    const ctx = recorder(), m = S.create(256);
    S.draw(ctx, m, { ...full, t, day: dayNo });
    let clearDay = 1; while (S.weatherFor(clearDay, 0) !== 'clear') clearDay++;
    const clear = recorder(); S.draw(clear, m, { ...full, t, day: clearDay });
    return ctx.calls.slice(clear.calls.length); // 맑은 날보다 더 그린 것이 안개다
  };
  const noon = fogOf(0.3), night = fogOf(0.95);
  const alpha = (c) => Number(c.color.match(/,([\d.]+)\)$/)[1]);
  assert.ok(noon.length > 0 && night.length > 0);
  night.forEach(c => { assert.ok(alpha(c) <= 0.06, '밤 안개는 옅다: ' + c.color); assert.ok(c.w < 256, '화면 전체 폭을 덮지 않는다'); });
  assert.ok(Math.max(...night.map(alpha)) < Math.max(...noon.map(alpha)) * 0.5);
  assert.notEqual(night[0].color.split(',').slice(0, 3).join(), noon[0].color.split(',').slice(0, 3).join(), '밤에는 색도 밤하늘 쪽으로 옮긴다');
});

test('불빛은 네모가 아니라 가운데가 넓은 둥근 모양으로 그려진다', () => {
  const ctx = recorder();
  S.glow(ctx, 50, 40, 10, '255,233,160', 0.05);
  const widths = ctx.calls.map(c => c.w);
  assert.ok(Math.min(...widths) < Math.max(...widths), '줄마다 폭이 다르다');
  ctx.calls.forEach(c => { assert.equal(c.h, 1); assert.ok(c.x >= 39 && c.x + c.w <= 62 && c.y >= 30 && c.y <= 50); });
  const dome = recorder(); S.glow(dome, 50, 40, 10, '1,2,3', 0.05, true);
  dome.calls.forEach(c => assert.ok(c.y <= 40, '반원은 바닥 아래로 내려가지 않는다'));
  const none = recorder(); S.glow(none, 0, 0, 0, '1,2,3', 0.1); S.glow(none, 0, 0, 5, '1,2,3', 0);
  assert.equal(none.calls.length, 0);
});

test('사격은 무리가 도착한 뒤에만 한다: 해 질 녘에는 다가오기만 한다', () => {
  const armed = { ...dusk, def: { tower: 1, turret: 1 } };
  const before = run(S.create(256), { ...armed, battle: false }, 30);
  assert.ok(before.zombies.length > 0, '해 질 녘에 무리는 다가온다');
  assert.equal(before.corpses.length + before.shots.length, 0, '도착 전에는 쏘지 않는다');
  const tally = fallenCounter(); let n = 0;
  for (let i = 0; i < 100; i++) { S.step(before, { ...armed, battle: true }, 0.1, rng); n = tally(before); } // 방어 10초
  assert.ok(n >= 3, '방어 구간에는 쓰러진다: ' + n);
});
