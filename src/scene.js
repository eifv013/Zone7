/*
 * Scene — 도트 화면(게임 상황을 보여 주는 그림 계층)
 * ------------------------------------------------------------
 * 게임 규칙에는 전혀 관여하지 않는다. ui.js 가 넘겨주는 view(시간, 구역, 방벽 종류 등)를
 * 받아 캔버스에 그릴 뿐이고, 여기서 주인공이 물자를 날라도 실제 물자는 변하지 않는다.
 *
 * 두 부분으로 나뉜다.
 *   1) 모델(create / step / poke / night) : DOM 을 모르는 순수 상태 기계. Node 에서 테스트한다.
 *   2) 그리기(mount / draw)               : 캔버스에 저해상도로 그리고 CSS 가 확대한다.
 *
 * view = { t: 하루 진행도 0~1, day: 날짜, zone: 구역 순번 0~6, safe, boss, signal, buff,
 *          def: { wire, tower, turret, flame, emp, rail } (방벽 종류별 보유 수),
 *          buildings: { scouts, garden, … } (시설별 보유 수),
 *          expedition: { elapsed, left } | null (원정 진행 초),
 *          battle: 무리가 도착해 싸우는 중인지(없으면 해 질 녘 전체를 싸움으로 본다),
 *          horde: 그 구역 무리의 성격 id('walker', 'swarm', 'plated', 'runner', 'patient', 'gather', 'drawn'),
 *          surge: 오늘이 떼로 몰려오는 밤인지,
 *          zoneBuilding / zoneDefense: 이 구역 고유 시설·방벽의 보유 수,
 *          research / upgrades / gear: 끝낸 연구, 산 수색 장비, 제작 레벨(거점에 소품과 사람으로 나타난다) }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Scene = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 배치 상수(저해상도 픽셀 단위) ---------- */
  var H = 80;            // 화면 높이(폭은 화면 크기에 따라 달라진다)
  var GROUND = 64;       // 땅의 y 좌표(발이 닿는 곳)
  var WALL_X = 84;       // 좁은 화면(폰)의 방벽 위치. 왼쪽이 거점, 오른쪽이 바깥(60 이었으나 거점이 비좁아 넓혔다)
  var WALL_WIDE = 132;   // 넓은 화면의 방벽 위치
  var SQUAD_TIME = 8;    // 원정대가 화면을 가로질러 나가거나 들어오는 데 걸리는 시간(초)
  var FACILITIES = ['scouts', 'garden', 'purifier', 'workshop', 'solar', 'radio', 'bunker', 'lab', 'port', 'district'];
  var DUSK = 0.72;       // 하루의 이 시점부터 해가 지고 좀비가 나타난다
  var WALK = 30;         // 주인공 걷는 속도(px/초)
  var SEARCH_TIME = 1.4; // 잔해 더미 하나를 뒤지는 시간
  /*
   * 무리 성격에 따라 달라지는 것(그림 전용. 실제 규모와 보상은 core.js 가 정한다).
   *   speed : 걷는 속도 배수,  extra : 화면에 더 나오는 수,  bossScale : 변이체의 크기 배수
   *   hp    : 쓰러지기까지 맞는 발 수(기본 1)
   *   look  : 옷·몸 색을 바꾸는 표(PAL 의 일부만 덮어쓴다),  hat : 머리 위에 얹는 색(안전모 등)
   */
  var HORDES = {
    walker:  { speed: 1,   extra: 0, bossScale: 2 },
    swarm:   { speed: 1.1, extra: 2, bossScale: 2 },
    plated:  { speed: 0.8, extra: 0, bossScale: 2, hp: 2, look: { c: '#7b8186', d: '#4a4f55' }, hat: '#f0b400' },
    runner:  { speed: 2,   extra: 1, bossScale: 2, look: { c: '#2f4f8f', d: '#17180f' } },
    patient: { speed: 0.9, extra: 0, bossScale: 2, look: { c: '#d9d8cf', d: '#9fa39c' } },
    gather:  { speed: 1,   extra: 1, bossScale: 3 },
    drawn:   { speed: 1.2, extra: 3, bossScale: 2, look: { x: '#e0392b' } }
  };
  var SURGE_EXTRA = 5;   // 떼로 몰려오는 밤에 더 나오는 수
  /** 무리 성격 id 에 해당하는 표. 모르는 값이면 기본(배회자)으로 그린다. */
  function hordeFor(id) { return Object.prototype.hasOwnProperty.call(HORDES, id) ? HORDES[id] : HORDES.walker; }

  /* ---------- 색 ---------- */
  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  /** 두 색 사이를 k(0~1)만큼 섞는다. 범위를 벗어난 k 는 잘라 낸다. */
  function lerpColor(a, b, k) {
    k = Math.max(0, Math.min(1, k));
    var x = hexToRgb(a), y = hexToRgb(b);
    var r = Math.round(x[0] + (y[0] - x[0]) * k), g = Math.round(x[1] + (y[1] - x[1]) * k), bl = Math.round(x[2] + (y[2] - x[2]) * k);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
  }
  // 하늘 색 열쇠 장면: [시점, 위쪽 색, 아래쪽 색]
  var SKY = [
    [0.00, '#7fb0c4', '#d9e3d0'],
    [0.55, '#7fb0c4', '#d9e3d0'],
    [0.75, '#b85a36', '#efbd6c'],
    [0.90, '#10141f', '#2a2f45'],
    [1.00, '#10141f', '#2a2f45']
  ];
  /** 하루 진행도 t 에서의 하늘 색과 어두운 정도(dark: 0 낮 ~ 1 밤). */
  function skyAt(t) {
    t = Math.max(0, Math.min(1, typeof t === 'number' && isFinite(t) ? t : 0));
    for (var i = 1; i < SKY.length; i++) {
      if (t <= SKY[i][0]) {
        var a = SKY[i - 1], b = SKY[i], k = (t - a[0]) / ((b[0] - a[0]) || 1);
        return { top: lerpColor(a[1], b[1], k), bottom: lerpColor(a[2], b[2], k),
                 dark: Math.max(0, Math.min(1, (t - 0.55) / 0.35)) };
      }
    }
    return { top: SKY[4][1], bottom: SKY[4][2], dark: 1 };
  }

  /**
   * 위험 단계의 풍경(2.2.0): 단계가 오를수록 화면이 달라진다. 5단계마다 한 묶음(tier)씩 더해진다.
   *   1묶음(1~5)   하늘이 녹빛으로 물들고 재가 날리며, 멀리서 불 하나가 탄다
   *   2묶음(6~10)  해와 달이 붉어지고 불길이 늘며, 불티가 오르고 까마귀 떼가 맴돈다
   *   3묶음(11~15) 좀비의 눈이 붉게 빛나고 화면 가장자리가 어둡게 물든다
   *   4묶음(16~20) 붉은 보름달이 뜨고 하늘이 핏빛이 되며, 이따금 붉은 번개가 친다
   * 2.2.1: 전체를 더 세게 했다(하늘색·불의 수와 크기·재의 양, 화면 전체의 붉은 기운). 낮에는 변화가 약하다는 말이 있었다.
   * 숫자가 아니거나 0 이하면 0(평소 풍경), 20 을 넘으면 4.
   */
  function dangerTier(d) { return !(typeof d === 'number' && isFinite(d) && d > 0) ? 0 : Math.min(4, Math.ceil(d / 5)); }
  /** 하늘 색을 위험 단계만큼 붉은 쪽으로 옮긴다. 단계가 0 이면 받은 값을 그대로 돌려준다(평소 화면은 한 점도 바뀌지 않는다). */
  function dangerSky(sky, d) {
    var tier = dangerTier(d);
    if (!tier) return sky;
    var k = 0.34 + 0.56 * Math.min(1, d / 20);
    return { top: lerpColor(sky.top, lerpColor('#7a2e24', '#3a0810', sky.dark), k),
             bottom: lerpColor(sky.bottom, lerpColor('#e8884a', '#7a1c1a', sky.dark), k),
             dark: sky.dark, tier: tier };
  }

  /* ---------- 모델 ---------- */
  function wallFor(W) { return W >= 300 ? WALL_WIDE : WALL_X; }
  /** 화면 폭 W 에 맞춰 잔해 더미 세 곳의 위치를 정한다(방벽 바깥, 화면 안). */
  function pilesFor(W, wall) {
    wall = wall || wallFor(W);
    var span = Math.max(40, W - wall - 30);
    return [0.3, 0.57, 0.84].map(function (f) { return Math.round(wall + 14 + span * f); });
  }
  function create(W) {
    W = W > 120 ? Math.floor(W) : 256;
    var wall = wallFor(W);
    return {
      W: W, wall: wall, home: wall - 12, piles: pilesFor(W, wall), time: 0,
      hero: { x: wall - 12, state: 'home', timer: 0.6, target: 0, carrying: false, boost: 0, face: 1 },
      zombies: [], spawn: 0, particles: [], flash: 0, flashColor: '#ffffff', shake: 0, delivered: 0,
      corpses: [], shots: [], raiders: [], fire: 0, turn: 0, bang: 0
    };
  }
  function resize(model, W) {
    if (!(W > 120) || Math.floor(W) === model.W) return;
    model.W = Math.floor(W);
    model.wall = wallFor(model.W);
    model.home = model.wall - 12;
    model.piles = pilesFor(model.W, model.wall);
    // 폭이 바뀌면 걷던 길이 달라지므로 주인공과 좀비를 제자리로 돌려 새로 시작한다
    model.hero.x = model.home; model.hero.state = 'home'; model.hero.timer = 0.4; model.hero.carrying = false;
    model.zombies.length = 0; model.corpses.length = 0; model.shots.length = 0; model.raiders.length = 0;
  }
  function burst(model, x, y, color, n, rng) {
    for (var i = 0; i < n && model.particles.length < 120; i++) {
      model.particles.push({ x: x, y: y, vx: (rng() - 0.5) * 30, vy: -10 - rng() * 28, life: 0.5 + rng() * 0.4, color: color });
    }
  }

  /**
   * 주인공 상태 기계를 dt 만큼 진행한다.
   *   home → out(더미로 걸어감) → search(뒤짐) → back(물자를 들고 귀환) → home
   * 해가 지면 하던 일을 멈추고 돌아와 아침까지 거점에 머문다.
   * 돌려주는 값: 'found'(물자 발견) | 'delivered'(거점에 내려놓음) | null
   */
  function stepHero(model, dt, dusk, rng) {
    var h = model.hero, speed = WALK * (h.boost > 0 ? 2.2 : 1);
    h.boost = Math.max(0, h.boost - dt);
    if (dusk && (h.state === 'out' || h.state === 'search')) h.state = 'back';
    if (h.state === 'home') {
      if (dusk) return null;
      h.timer -= dt;
      if (h.timer <= 0) { h.target = model.piles[Math.floor(rng() * model.piles.length) % model.piles.length]; h.state = 'out'; }
      return null;
    }
    if (h.state === 'out') {
      h.face = 1;
      h.x = Math.min(h.target, h.x + speed * dt);
      if (h.x >= h.target) { h.state = 'search'; h.timer = SEARCH_TIME; }
      return null;
    }
    if (h.state === 'search') {
      h.timer -= dt * (h.boost > 0 ? 2.2 : 1);
      if (h.timer > 0) return null;
      h.carrying = true; h.state = 'back';
      return 'found';
    }
    // back
    h.face = -1;
    h.x = Math.max(model.home, h.x - speed * dt);
    if (h.x > model.home) return null;
    h.state = 'home'; h.timer = 0.5; h.face = 1;
    if (!h.carrying) return null;
    h.carrying = false;
    model.delivered++;
    return 'delivered';
  }

  /** 해 질 녘에 좀비를 화면 오른쪽에서 하나씩 들여보내 방벽 앞까지 걷게 한다. */
  /*
   * 좀비의 종류(그림 전용). 한 무리 안에 섞여 나와서 같은 그림이 줄지어 오는 것처럼 보이지 않게 한다.
   *   speed : 걷는 속도 배수,  hp : 더 버티는 발 수,  weight : 100 가운데 나오는 비율
   *   walker 평범한 것, hair 머리가 긴 것, runner 몸을 숙이고 뛰는 것, brute 덩치 큰 것
   */
  var ZOMBIE_TYPES = {
    walker: { speed: 1,   hp: 0, weight: 46 },
    hair:   { speed: 0.9, hp: 0, weight: 22 },
    runner: { speed: 1.7, hp: 0, weight: 18 },
    brute:  { speed: 0.7, hp: 1, weight: 14 }
  };
  /** 0 이상 1 미만의 수로 종류를 고른다. 잘못된 값이면 평범한 것. */
  function zombieType(r) {
    var roll = (typeof r === 'number' && r >= 0 && r < 1 ? r : 0) * 100, acc = 0;
    for (var id in ZOMBIE_TYPES) if (Object.prototype.hasOwnProperty.call(ZOMBIE_TYPES, id)) { acc += ZOMBIE_TYPES[id].weight; if (roll < acc) return id; }
    return 'walker';
  }
  /**
   * 오늘 밤의 특별한 좀비(view.special) 가운데 지금 화면에 없는 첫 번째를 고른다. 없으면 null.
   * 같은 종류는 한 번에 하나만 서 있게 해서, 드문 것이 드물게 보이도록 한다.
   */
  function pickSpecial(specials, zombies) {
    if (!Array.isArray(specials) || !Array.isArray(zombies)) return null;
    for (var i = 0; i < specials.length; i++) {
      var sp = specials[i];
      if (!sp || typeof sp.id !== 'string') continue;
      if (!zombies.some(function (z) { return z.kind === sp.id; })) return sp;
    }
    return null;
  }
  function stepZombies(model, view, dt, rng) {
    var dusk = view.t >= DUSK;
    if (!dusk) { if (view.t < 0.1) model.zombies.length = 0; return; }
    var kind = hordeFor(view.horde);
    var want = (view.boss ? 5 : view.safe ? 4 : 8) + kind.extra + (view.surge ? SURGE_EXTRA : 0);
    // 수가 많은 밤에는 간격을 좁혀 화면 밖으로 줄이 늘어지지 않게 한다
    var gap = want > 9 ? 4 : 7;
    model.spawn -= dt;
    if (model.zombies.length < want && model.spawn <= 0) {
      var big = !!view.boss && !model.zombies.some(function (z) { return z.big; });
      model.zombies.push({ x: model.W + 4 + rng() * 12, speed: (9 + rng() * 6) * kind.speed, big: big, look: Math.floor(rng() * 3) % 3,
        // 생김새와 걸음이 다른 네 종류가 섞여 온다(zombieType). 덩치는 한 발을 더 버틴다. 변이체는 여러 발을 맞아야 쓰러진다
        type: 'walker', hp: big ? BOSS_HP : (kind.hp || 1), stop: 0, phase: 0 });
      var nz = model.zombies[model.zombies.length - 1];
      nz.type = big ? 'walker' : zombieType(rng());
      // 오늘 밤 섞여 온 특별한 좀비: 도감과 같은 옷 색으로 그린다(생김새는 그 종류의 틀을 쓴다)
      var sp = !big && model.zombies.length > 2 ? pickSpecial(view.special, model.zombies) : null;      // 앞의 둘은 평범한 것, 그 뒤로 빈자리가 나면 반드시 섞여 온다(도감에 적힐 것이 화면에 안 보이는 밤이 없게)
      if (sp) { nz.kind = sp.id; nz.pal = sp.pal || null; nz.glow = !!sp.glow; if (Object.prototype.hasOwnProperty.call(ZOMBIE_TYPES, sp.frames)) nz.type = sp.frames; }
      nz.speed *= ZOMBIE_TYPES[nz.type].speed; if (!big) nz.hp += ZOMBIE_TYPES[nz.type].hp;
      nz.phase = rng() * 6;
      model.spawn = (0.5 + rng() * 0.9) / (view.surge ? 2.5 : 1) / kind.speed;
    }
    // 쓰러진 자리는 뒤에서 채운다: 방벽에 가까운 순서대로 멈출 자리를 다시 매긴다
    model.zombies.sort(function (a, b) { return a.x - b.x; });
    model.zombies.forEach(function (z, i) {
      z.stop = model.wall + 6 + i * gap;
      if (z.x > z.stop) z.x = Math.max(z.stop, z.x - z.speed * dt);
    });
  }

  /*
   * 방벽의 사격: 화면에 보이는 싸움일 뿐이고, 밤의 승패는 core.js 가 정한다.
   *   무기(가진 방어 수단)마다 쏘는 자리와 쓰러뜨리는 모습이 다르다.
   *   reach : 방벽에서 이 거리 안에 들어온 좀비만 맞힌다. 화면 끝에서 쓰러지면 폰에서는 싸움이 보이지 않으므로
   *           모든 무기에 사거리를 두어 무리가 방벽 가까이 온 뒤에 쏘게 한다
   *   death : 맞은 좀비가 쓰러지는 방식 'shot'(뒤로 넘어짐) 'burn'(불탐) 'zap'(감전) 'blast'(터짐)
   */
  var WEAPONS = [
    { id: 'tower',  death: 'shot',  shot: 'bullet', reach: 84, from: function (m) { return [m.wall - 8, GROUND - 34]; } },
    { id: 'turret', death: 'shot',  shot: 'bullet', reach: 62, from: function (m) { return [m.wall + 6, GROUND - 13]; } },
    { id: 'flame',  death: 'burn',  shot: 'flame',  reach: 24, from: function (m) { return [m.wall + 5, GROUND - 4]; } },
    { id: 'emp',    death: 'zap',   shot: 'arc',    reach: 40, from: function (m) { return [m.wall + 2, GROUND - 16]; } },
    { id: 'rail',   death: 'blast', shot: 'beam',   reach: 110, from: function (m) { return [m.wall + 10, GROUND - 14]; } }
  ];
  var SHOT_MAX = 24;        // 화면에 남기는 탄 줄기 수의 상한
  var BOSS_HP = 8;          // 변이체가 버티는 발 수
  var CORPSE_TIME = 1.6;    // 쓰러진 좀비가 화면에 남는 시간(초)
  var CORPSE_MAX = 24;      // 화면에 남기는 시체 수의 상한
  /** 쓰러진 좀비를 시체 목록으로 옮긴다(상한을 넘으면 가장 오래된 것부터 지운다). */
  function fell(model, z, death, rng) {
    model.corpses.push({ x: z.x, big: !!z.big, look: z.look || 0, type: z.type || 'walker', death: death, life: CORPSE_TIME, total: CORPSE_TIME });
    if (model.corpses.length > CORPSE_MAX) model.corpses.shift();
    burst(model, z.x + 3, GROUND - 7, death === 'burn' ? '#e0602b' : death === 'zap' ? '#7fe0f0' : '#7da35a', death === 'blast' ? 14 : z.big ? 12 : 5, rng);
  }
  /** 날짜로 만드는 0 이상 1 미만의 수(같은 날은 늘 같은 값). */
  function dayRoll(day) { var v = Math.sin((day + 1) * 12.9898) * 43758.5453; return v - Math.floor(v); }
  /** 보유 수 → 뽑힐 몫(1~4). 열 배 살 때마다 한 몫씩 는다. */
  function leadWeight(n) { return !(typeof n === 'number' && n > 0) ? 1 : 1 + Math.min(3, Math.floor(Math.log(n) / Math.LN10)); }
  function leadIndex(armed, day, def) {
    var total = 0, i, w = armed.map(function (a) { var n = leadWeight(def && def[a.id]); total += n; return n; });
    var roll = dayRoll(day) * total;
    for (i = 0; i < armed.length; i++) { roll -= w[i]; if (roll < 0) return i; }
    return armed.length - 1;
  }
  /**
   * 그날 밤의 주 무기: 가진 무기 가운데 하나를 날짜로 고른다(같은 날은 늘 같은 무기).
   *   많이 산 무기일수록 자주 뽑히고, 전날과 같은 무기가 나오면 다음 무기로 넘긴다(매일 밤 다른 것이 나오게).
   *   무기가 없으면 null, 날짜가 잘못되면 0일로 본다. def 는 방어 수단 보유 수(없어도 된다).
   */
  function leadWeapon(armed, day, def) {
    if (!armed || !armed.length) return null;
    var d = typeof day === 'number' && isFinite(day) && day > 0 ? Math.floor(day) : 0;
    var idx = leadIndex(armed, d, def);
    if (armed.length > 1 && d > 0) {
      // 전날의 무기를 같은 규칙으로 거슬러 구한다(전날도 그 전날과 겹쳐 넘겼을 수 있으므로 첫날부터 따라간다. 날짜는 400일까지만 본다)
      var prev = leadIndex(armed, 0, def), from = Math.max(1, d - 400), k, cur;
      if (from > 1) prev = leadIndex(armed, from - 1, def);
      for (k = from; k < d; k++) { cur = leadIndex(armed, k, def); if (cur === prev) cur = (cur + 1) % armed.length; prev = cur; }
      if (idx === prev) idx = (idx + 1) % armed.length;
    }
    return armed[idx];
  }
  function stepCombat(model, view, dt, rng) {
    var i;
    for (i = model.shots.length - 1; i >= 0; i--) { model.shots[i].life -= dt; if (model.shots[i].life <= 0) model.shots.splice(i, 1); }
    for (i = model.corpses.length - 1; i >= 0; i--) { model.corpses[i].life -= dt; if (model.corpses[i].life <= 0) model.corpses.splice(i, 1); }
    for (i = model.raiders.length - 1; i >= 0; i--) { var rd = model.raiders[i]; rd.x -= 46 * dt; rd.life -= dt; if (rd.life <= 0 || rd.x < -10) model.raiders.splice(i, 1); }
    // 사격은 무리가 도착한 뒤(방어 구간)에만 한다. 그 전의 해 질 녘에는 무리가 다가오기만 한다.
    if (view.battle === undefined ? view.t < DUSK : !view.battle) return;
    var d = view.def || {};
    var armed = WEAPONS.filter(function (w) { return d[w.id] > 0; });
    // 못 막는 밤에는 무리가 방벽을 두드린다(방벽이 가볍게 흔들린다)
    var atWall = model.zombies.length > 0 && model.zombies[0].x <= model.zombies[0].stop + 0.5;
    if (!view.safe && atWall) {
      model.bang -= dt;
      if (model.bang <= 0) { model.bang = 0.7; model.shake = Math.max(model.shake, 0.12); burst(model, model.wall + 4, GROUND - 8, '#c9c2a3', 3, rng); }
    }
    if (!armed.length || !model.zombies.length) return;
    model.fire -= dt;
    if (model.fire > 0) return;
    // 무기 종류가 많을수록 자주 쏜다. 못 막는 밤에는 쓰러뜨리는 속도가 무리를 따라가지 못한다
    model.fire = Math.max(0.3, 1.5 / armed.length) * (view.safe ? 1 : 2.6);
    // 밤마다 주역이 바뀐다: 그날의 주 무기가 네 발 가운데 세 발을 쏘고, 나머지 한 발은 다른 무기들이 돌아가며 쏜다
    var turn = model.turn++, lead = leadWeapon(armed, view.day, d);
    var w = turn % 4 === 3 ? armed[Math.floor(turn / 4) % armed.length] : lead;
    function aim(wp) {      // 그 무기의 사거리 안에 든 맨 앞의 좀비
      for (var k = 0; k < model.zombies.length; k++) { var z = model.zombies[k]; if (z.x < model.W - 6 && (!wp.reach || z.x <= model.wall + wp.reach)) return z; }
      return null;
    }
    var target = aim(w);
    if (!target && w !== lead) { w = lead; target = aim(w); }      // 거들 무기의 사거리 밖이면 주 무기가 대신 쏜다
    if (!target) return;
    var from = w.from(model), star = w === lead;
    function hit(z, dmg) {
      z.hp -= dmg;
      if (z.hp <= 0) { model.zombies.splice(model.zombies.indexOf(z), 1); fell(model, z, w.death, rng); }
      else burst(model, z.x + 3, GROUND - 8, '#7da35a', 2, rng);
    }
    function line(x0, y0, x1, y1, life) { if (model.shots.length < SHOT_MAX) model.shots.push({ kind: w.shot, x0: x0, y0: y0, x1: x1, y1: y1, life: life }); }
    if (!star) { line(from[0], from[1], target.x + 3, GROUND - 7, w.shot === 'beam' ? 0.22 : 0.12); hit(target, w.id === 'rail' ? 4 : 1); return; }
    /* 주 무기는 저마다 다르게 쏜다. 맞는 좀비 목록은 미리 떠 둔다(쓰러지면 목록에서 빠지므로). */
    var inReach = model.zombies.filter(function (z) { return z.x < model.W - 6 && z.x <= model.wall + w.reach; });
    if (w.id === 'tower') {              // 감시탑: 저격 한 발. 굵은 예광탄이 길게 남고 두 발 몫을 한다
      line(from[0], from[1], target.x + 3, GROUND - 8, 0.3); hit(target, 2);
    } else if (w.id === 'turret') {      // 자동 포탑: 세 발 연사. 탄 줄기가 위아래로 흩어진다
      for (i = 0; i < 3; i++) line(from[0], from[1] + i - 1, target.x + 3, GROUND - 5 - i * 2, 0.1 + i * 0.05);
      hit(target, 2); model.fire *= 0.7;
    } else if (w.id === 'flame') {       // 화염 방벽: 불길이 사거리 끝까지 깔리고 그 안의 좀비가 모두 탄다
      line(from[0], from[1], model.wall + w.reach, GROUND - 4, 0.45);
      inReach.forEach(function (z) { hit(z, 1); });
    } else if (w.id === 'emp') {         // 전자기 울타리: 번개가 가까운 좀비 셋까지 차례로 옮겨 붙는다
      var px = from[0], py = from[1];
      inReach.slice(0, 3).forEach(function (z) { line(px, py, z.x + 3, GROUND - 8, 0.2); px = z.x + 3; py = GROUND - 8; hit(z, 1); });
    } else {                             // 레일건: 화면 끝까지 꿰뚫는다. 줄 위의 좀비가 모두 맞는다
      line(from[0], from[1], model.W, from[1] + 4, 0.3);
      model.zombies.filter(function (z) { return z.x < model.W - 2; }).forEach(function (z) { hit(z, 4); });
      model.shake = Math.max(model.shake, 0.08); model.fire *= 1.6;
    }
  }

  /** 모델 전체를 dt 초 진행한다. 잘못된 dt 는 무시하고, 긴 dt 는 한 번에 0.25초까지만 반영한다. */
  /*
   * 구역 이동과 철수의 연출(1.6.0): 라라가 화면 밖으로 달려 나갔다가 반대쪽에서 들어온다.
   *   dir +1 = 다음 구역으로(오른쪽으로 나가 왼쪽에서 들어온다), -1 = 철수(왼쪽으로 나가 오른쪽에서 들어온다)
   * 나가는 동안에는 배경을 떠나는 구역(from)으로 그리고, 들어올 때부터 새 구역으로 그린다(shownZone).
   */
  var TRAVEL_TIME = 2.4, TRAVEL_SPEED = 3.2;
  function travel(model, from, dir) {
    if (!model || !model.hero) return false;
    model.move = { t: 0, from: typeof from === 'number' && from >= 0 ? Math.floor(from) : 0, dir: dir < 0 ? -1 : 1, turned: false };
    model.hero.carrying = false; model.hero.boost = 0; model.hero.state = 'out';
    return true;
  }
  function stepTravel(model, dt) {
    var mv = model.move, h = model.hero, sp = WALK * TRAVEL_SPEED * dt, W = model.W || 256;
    mv.t += dt;
    if (!mv.turned) {
      h.face = mv.dir; h.x += mv.dir * sp;
      if (h.x > W + 10 || h.x < -12 || mv.t >= TRAVEL_TIME / 2) { mv.turned = true; h.x = mv.dir > 0 ? -12 : W + 10; }
    } else {
      h.face = mv.dir;
      if (mv.dir > 0) h.x = Math.min(model.home, h.x + sp); else h.x = Math.max(model.home, h.x - sp);
      if (h.x === model.home || mv.t >= TRAVEL_TIME * 2) { h.x = model.home; h.state = 'home'; h.timer = 0.6; h.face = 1; model.move = null; }
    }
    return null;
  }
  /** 지금 배경으로 그릴 구역: 떠나는 중이면 떠나는 구역. */
  function shownZone(model, zone) { return model && model.move && !model.move.turned ? model.move.from : zone; }
  function step(model, view, dt, rng) {
    if (!(typeof dt === 'number' && isFinite(dt) && dt > 0)) return null;
    dt = Math.min(dt, 0.25);
    rng = typeof rng === 'function' ? rng : Math.random;
    model.time += dt;
    var ev = model.move ? stepTravel(model, dt) : stepHero(model, dt, view.t >= DUSK, rng);
    if (ev === 'found') burst(model, model.hero.x + 3, GROUND - 6, '#c9c2a3', 5, rng);
    if (ev === 'delivered') burst(model, model.home - 4, GROUND - 10, '#f0b400', 6, rng);
    stepZombies(model, view, dt, rng);
    stepCombat(model, view, dt, rng);
    if (view.still) model.shake = 0;      // 설정에서 화면 흔들림을 껐다
    model.flash = Math.max(0, model.flash - dt);
    model.shake = Math.max(0, model.shake - dt);
    for (var i = model.particles.length - 1; i >= 0; i--) {
      var p = model.particles[i];
      p.life -= dt; p.vy += 90 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.life <= 0 || p.y > GROUND) model.particles.splice(i, 1);
    }
    return ev;
  }

  /**
   * 원정대가 화면에 보이는 위치. 출발 직후에는 방벽에서 오른쪽 끝으로 걸어 나가고,
   * 귀환 직전에는 오른쪽 끝에서 걸어 들어온다. 그 사이에는 화면 밖이라 null.
   */
  function squadAt(model, exp) {
    if (!exp || !(exp.left >= 0) || !(exp.elapsed >= 0)) return null;
    var from = model.wall + 8, span = model.W + 14 - from;
    if (exp.left < SQUAD_TIME) return { x: from + span * (exp.left / SQUAD_TIME), dir: -1 };
    if (exp.elapsed < SQUAD_TIME) return { x: from + span * (exp.elapsed / SQUAD_TIME), dir: 1 };
    return null;
  }

  /**
   * 그날의 날씨. 날짜와 구역이 같으면 언제나 같은 결과다(새로 고쳐도 날씨가 바뀌지 않게).
   * 강변(6구역)은 안개가 잦고, 눈은 여정 후반(5구역부터)에만 내린다. 연출일 뿐 수치에는 영향이 없다.
   */
  function weatherFor(day, zone) {
    day = typeof day === 'number' && isFinite(day) ? Math.floor(day) : 1;
    zone = typeof zone === 'number' && isFinite(zone) ? Math.floor(zone) : 0;
    var r = seeded(day * 7 + zone * 131)() * 100;
    var rain = 20, fog = zone === 5 ? 30 : 10, snow = zone >= 4 ? 12 : 0;
    if (r < rain) return 'rain';
    if (r < rain + fog) return 'fog';
    if (r < rain + fog + snow) return 'snow';
    return 'clear';
  }

  /** 플레이어가 '잔해 수색'을 눌렀을 때: 주인공이 잠깐 빨라지고, 뒤지는 중이면 곧 끝난다. */
  function poke(model, rng) {
    rng = typeof rng === 'function' ? rng : Math.random;
    var h = model.hero;
    h.boost = 1.5;
    if (h.state === 'home') h.timer = 0;
    burst(model, h.x + 3, GROUND - 8, '#f0b400', 3, rng);
  }

  /**
   * 밤의 결과를 연출한다. 막았으면(true) 좀비가 흩어지고, 뚫렸으면(false) 화면이 붉게 흔들린다.
   * 'held'(농성 중 버틴 밤)는 번쩍임 없이 좀비만 물러난다.
   */
  function night(model, defended, rng) {
    rng = typeof rng === 'function' ? rng : Math.random;
    model.shots.length = 0;
    if (defended === 'held') { model.zombies.length = 0; return; }
    if (defended) {
      // 막아낸 밤: 남은 무리가 한꺼번에 쓰러진다
      model.zombies.forEach(function (z) { fell(model, z, z.big ? 'blast' : 'shot', rng); });
    } else {
      // 뚫린 밤: 무리가 방벽을 넘어 거점 안으로 달려든다
      model.zombies.slice(0, 8).forEach(function (z) { model.raiders.push({ x: z.x, look: z.look || 0, big: !!z.big, life: 1.6, phase: z.phase }); });
      burst(model, model.wall + 2, GROUND - 8, '#7a5a36', 12, rng);
    }
    model.zombies.length = 0;
    model.flash = 0.45;
    model.flashColor = defended ? '#f5f1dc' : '#b3261a';
    if (!defended) model.shake = 0.5;
  }

  /* ---------- 도트 그림 ---------- */
  // 한 글자가 한 픽셀. '.' 은 투명.
  var PAL = { y: '#f0b400', h: '#2b241c', s: '#e2b48c', j: '#f0b400', k: '#6b4a2b', p: '#30343c', b: '#17180f',
              g: '#7da35a', x: '#1b2414', c: '#6f6a60', d: '#3c3a34', e: '#c0392b' };
  // 주인공은 노란 우비의 모자(y)를 쓰고 있다. 원정대원은 같은 몸에 모자 대신 머리카락을 그린다(SQUAD_TOP)
  var HERO_TOP = ['..yyy...', '.yyyyy..', '.ysssy..', '.ysss...', 'kjjjj...', 'kjjjjs..', 'kjjjj...', '.jjjj...'];
  var HERO_LEGS = [['.pp.pp..', '.pp.pp..', '.bb.bb..'], ['.pp.pp..', '.pp.bb..', '.bb.....']];      // 둘째 장: 한 발을 든다(전에는 두 발이 양옆으로 벌어졌다)
  var HERO_SEARCH = ['........', '........', '..yyy...', '.yyyyy..', 'kjysss..', 'kjjjjss.', 'kjjjj...', '.jjjjj..', '.pp.pp..', '.bb.bb..', '........'];
  var ZOMBIE = [
    ['..ggg...', '.ggggg..', '.gxgxg..', '..ggg...', '.ccccgg.', '.cccc...', '.cccc...', '.cccc...', '.dd.dd..', '.dd.dd..', '.dd.dd..'],
    ['..ggg...', '.ggggg..', '.gxgxg..', '..ggg...', '.cccc...', '.ccccgg.', '.cccc...', '.cccc...', '.dd.dd..', '.dd..dd.', '.dd..dd.']      // 한 다리를 앞으로 끈다(전에는 두 발이 양옆으로 벌어졌다)
  ];
  // 머리가 긴 것: 머리카락(h)이 얼굴 옆으로 내려온다
  var ZOMBIE_HAIR = ZOMBIE.map(function (f) { return ['..hhh...', '.hhhhh..', '.hxgxh..', '.hggg...'].concat(f.slice(4)); });
  // 뛰는 것: 몸을 앞으로 숙이고 팔을 뒤로 뻗는다. 보폭이 크다
  var ZOMBIE_RUN = [
    ['...ggg..', '..ggggg.', '..gxgxg.', '...ggg..', '.gcccc..', '..cccc..', '..ccc...', '..ccc...', '.dd.dd..', 'dd...d..', 'd....dd.'],
    ['...ggg..', '..ggggg.', '..gxgxg.', '...ggg..', '..ccccg.', '..cccc..', '..ccc...', '..ccc...', '..ddd...', '..dd....', '..d.d...']
  ];
  // 덩치: 어깨가 넓고 키가 두 칸 크다(10×13)
  var ZOMBIE_BRUTE = [
    ['...gggg...', '..gggggg..', '..gxggxg..', '..gggggg..', '.cccccccc.', 'gccccccccg', 'gccccccccg', 'g.cccccc.g', '..cccccc..', '..cccccc..', '..ddd.ddd.', '..dd...dd.', '.ddd...ddd'],
    ['...gggg...', '..gggggg..', '..gxggxg..', '..gggggg..', '.cccccccc.', 'gccccccccg', 'gccccccccg', '.gcccccc.g', '..cccccc..', '..cccccc..', '..ddd.ddd.', '...dd.dd..', '..ddd.ddd.']
  ];
  var ZOMBIE_FRAMES = { walker: ZOMBIE, hair: ZOMBIE_HAIR, runner: ZOMBIE_RUN, brute: ZOMBIE_BRUTE };
  /** 종류의 그림 두 장. 모르는 종류면 평범한 것. */
  function zombieFrames(type) { return Object.prototype.hasOwnProperty.call(ZOMBIE_FRAMES, type) ? ZOMBIE_FRAMES[type] : ZOMBIE; }
  // 쓰러진 것: 서 있는 그림을 눕혀 쓰지 않고, 바닥에 무너진 더미를 따로 그린다(머리가 방벽 반대쪽)
  var ZOMBIE_DOWN = ['...cc.gg', '.ddcccgg', 'dddccccg'];
  // 원정대원: 주인공과 같은 몸에 회색 옷(주인공의 노란 우비와 구별된다)
  var SQUAD_TOP = HERO_TOP.map(function (row) { return row.replace(/j/g, 'c').replace(/k/g, 'd').replace(/y/g, 'h'); });
  // 좀비 옷 색 세 가지(같은 무리가 복제된 것처럼 보이지 않게). 각 항목은 PAL 의 일부만 바꾼다.
  var ZOMBIE_LOOKS = [{}, { c: '#4f5d73', d: '#2a3140' }, { c: '#6b4a3a', d: '#3a2a22' }];
  /** rows 의 글자를 색으로 바꿔 찍는다. look 을 주면 그 글자들만 다른 색으로 그린다. */
  function sprite(ctx, rows, x, y, flip, scale, look) {
    scale = scale || 1;
    for (var r = 0; r < rows.length; r++) {
      for (var c = 0; c < rows[r].length; c++) {
        var ch = rows[r][c];
        if (ch === '.') continue;
        ctx.fillStyle = (look && look[ch]) || PAL[ch];
        var px = flip ? rows[r].length - 1 - c : c;
        ctx.fillRect(Math.round(x + px * scale), Math.round(y + r * scale), scale, scale);
      }
    }
  }
  /**
   * 옷장에 쓰는 그림(1.9.1): 라라를 주어진 우비 색으로 그린다. 가로 8칸, 세로 11칸.
   *   look = { y 모자 색, j 몸 색 }. scale 은 한 칸의 크기(화면 픽셀).
   */
  /*
   * 라라(2.0.0): 가로 14칸, 세로 18칸. 전에는 8×11칸이라 얼굴도 가방도 없었다.
   *   위 세 줄은 후드의 귀·뿔 자리, 왼쪽 네 칸은 옆구리의 가방 자리다. 몸은 그 사이에 선다.
   *   글자 뜻: y 후드, Y 후드 그늘, j 우비, J 우비 그늘, s 살, e 눈, m 입, h 머리카락, k 가방끈, w 옷깃·단추·뿔, i 귀 안쪽, p 바지, b 장화, c 가방, C 가방의 밝은 곳
   *   겹: 후드 모양(LARA_HOODS)이 위 세 줄을, 가방(LARA_BAGS)이 왼쪽 네 칸을 갈아 끼운다. 무늬(laraPattern)는 우비 칸(j)을 골라 다른 색으로 칠한다.
   *   look = { coat: { y, j }, hood, pat, bag, fx } — 코어의 cosmeticLook 이 준다. 없는 값은 기본으로 그린다.
   */
  var LARA_W = 14, LARA_H = 18;
  /*
   * 2.7.2 다시 그림: "수염이 났다, 예전 라라가 더 귀엽다"는 말이 있었다. 예전 그림(14×16)의 좋은 점을 가져왔다.
   *   - 턱 밑의 흰 옷깃이 수염으로 보였다 → 옷깃을 없애고, 예전처럼 우비 가운데에 지퍼 선(J)을 내렸다
   *   - 머리가 작고 앞머리·코가 있어 얼굴이 복잡했다 → 후드를 크고 둥글게, 얼굴은 눈 둘과 붉은 입만
   *   - 가방끈을 없애고 상자는 손에 든다(손은 살색). 장화는 예전처럼 붉은색, 살색은 예전의 밝은 색
   */
  /*
   * 2.7.4 예전 라라로 되돌렸다(1.4.2 의 그림 그대로). 2.0.0 뒤로 여러 번 고쳐 그렸지만 그때마다 더 어색해졌다.
   *   위 두 줄은 후드의 귀·뿔 자리다. 그 아래 열여섯 줄이 예전 그림이다: 둥근 후드, 눈 둘과 붉은 입, 아래로 넓어지는 우비와 가운데 지퍼 선,
   *   우비 양옆 안쪽의 손, 붉은 장화. 상자는 예전처럼 오른쪽 아래에서 우비 앞에 겹쳐 든다.
   */
  var LARA_BODY = ['..............', '..............',
    '....yyyyyy....', '...yyyyyyyy...', '..yyyssssyyy..', '..yysessesyy..', '..yyssssssyy..',      /* 눈 줄(2.7.6): 오른쪽 눈 바로 옆이 후드 색이라 눈이 후드에 붙어 보였다. 살색 한 칸을 넣어 좌우를 맞췄다 */ '...yssmmssy...',
    '..jjjjjjjjjj..', '.jjjjjJjjjjjj.', '.jjjjjJjjjjjj.', '.jsjjjJjjjjs..', '.jjjjjJjjjj...', '..jjjjjjjj....', '..jjjjjjjj....'];
  var LARA_STAND = ['....pp.pp.....', '....pp.pp.....', '...bbb.bbb....'];
  // 걸음: 한 발씩 번갈아 든다(두 발이 양옆으로 벌어지지 않게)
  var LARA_LEGS = [['....pp.pp.....', '....pp.bbb....', '...bbb........'], ['....pp.pp.....', '...bbb.pp.....', '.......bbb....']];
  var LARA_HOODS = {
    none:   {},
    cat:    { 0: '...y......y...', 1: '...yi....iy...' },
    bear:   { 0: '...yy....yy...', 1: '...yy....yy...' },
    rabbit: { 0: '.....y..y.....', 1: '.....i..i.....' },
    horn:   { 0: '..w........w..', 1: '...w......w...' },
    // 4.5.2 더한 후드. 아이 우비의 동물 후드(털모자 방울 · 공룡 가시 · 여우 귀 · 판다 귀 · 새싹)에서 가져왔다. g 는 새싹 · 공룡 가시의 초록, n 은 판다 귀의 검정(어두운 바탕에서도 보이게 조금 밝다)
    pompom: { 0: '......ww......', 1: '.....wwww.....' },      // 방울 털모자처럼 꼭대기에 흰 방울
    dino:   { 0: '......g.......', 1: '....g.g.g.....' },
    fox:    { 0: '...O......O...', 1: '..owo....owo..' },      // 여우 귀: 우비 색과 상관없이 주황 귀에 끝은 검게, 안쪽은 희게
    panda:  { 0: '...nn....nn...', 1: '...nn....nn...' },
    sprout: { 0: '.....g..g.....', 1: '......gg......' }
  };
  /* 가방: 줄 번호 → 오른쪽 네 칸(10~13번 칸)에 덮어 그린다. '.' 은 아래 그림을 그대로 둔다. 색은 c(몸), C(밝은 곳), e(눈) */
  var LARA_BAGS = {
    cooler: { c: '#3f6f8f', C: '#e6e5db', rows: { 11: '..c.', 12: 'cccc', 13: 'cCcc', 14: 'cccc' } },      // 파란 냉장 상자(기본, 예전 그림 그대로)
    medkit: { c: '#c0392b', C: '#f1f0e6', rows: { 11: '..c.', 12: 'cccc', 13: 'cCCc', 14: 'cccc' } },      // 구급 상자
    ruck:   { c: '#6b6f45', C: '#9a9f68', rows: { 11: '.cc.', 12: 'cccc', 13: 'cCCc', 14: 'cccc' } },      // 낡은 배낭
    teddy:  { c: '#a8733f', C: '#e0b98a', rows: { 11: 'c..c', 12: 'cccc', 13: 'cecc', 14: 'cCCc' } },      // 곰 인형 가방(귀와 눈)
    // 4.5.2 더한 든 것
    lunch:  { c: '#ff7fb0', C: '#f8d8e6', rows: { 11: '.CC.', 12: 'cCCc', 13: 'cccc', 14: 'cccc' } },      // 분홍 보자기 도시락(위에 묶은 매듭)
    radio:  { c: '#30343c', C: '#7fc98a', rows: { 9: '.c..', 10: '.c..', 11: '.c..', 12: 'cccc', 13: 'cCCc', 14: 'cccc' } },      // 무전기(안테나와 초록 화면)
    pot:    { c: '#b8683c', C: '#5cb85c', rows: { 10: '.C.C', 11: '..C.', 12: 'cccc', 13: 'cccc', 14: '.cc.' } },      // 새싹 화분
    lantern: { c: '#5a4a3a', C: '#ffd95a', rows: { 10: '..c.', 11: '.cc.', 12: 'cCCc', 13: 'cCCc', 14: '.cc.' } }      // 등불(밤에 둘레가 밝다)
  };
  /** 무늬: 우비 칸 (x, y) 를 무늬 색으로 칠할지. */
  function laraPattern(pat, x, y) {
    // 'stripe' 는 이제 체크 밑단이다(2.7.5, 전에는 몸 전체의 가로 줄무늬였는데 보기 좋지 않다는 말이 있었다). 우비의 아래 두 줄만 바둑판으로 칠한다
    if (pat === 'stripe') return y >= 13 && (x + y) % 2 === 0;
    if (pat === 'zigzag') return (y === 11 && x % 2 === 0) || (y === 12 && x % 2 === 1);      // 지그재그(2.7.7): 허리에 두 줄이 엇갈린다
    if (pat === 'dot') return (x + y) % 3 === 0 && y % 2 === 1;
    if (pat === 'star') return (x === 3 && y === 9) || (x === 9 && y === 10) || (x === 4 && y === 13) || (x === 8 && y === 12);
    if (pat === 'camo') return (x * 3 + y * 5) % 7 < 3;
    // 4.5.2 더한 무늬
    if (pat === 'heart') return (y === 10 && (x === 3 || x === 5)) || (y === 11 && x === 4) || (y === 12 && (x === 8 || x === 10)) || (y === 13 && x === 9);      // 하트 둘
    if (pat === 'reflect') return y === 11 || y === 14;      // 반사띠(소방 우비처럼 가슴과 밑단에 두 줄)
    if (pat === 'rain') return (x === 2 && y === 10) || (x === 8 && y === 11) || (x === 4 && y === 13) || (x === 10 && y === 14) || (x === 6 && y === 9);      // 빗방울
    return false;
  }
  /** 두 색이 비슷한가(빨강·초록·파랑의 차이를 더해 120 아래). */
  function colorNear(a, b) { try { var x = hexToRgb(a), y = hexToRgb(b); return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]) < 120; } catch (e) { return false; } }
  function darker(hex, k) { return lerpColor(hex, '#000000', 1 - k); }
  /** 자세(pose 'stand' | 'walk' | 'search')와 걸음(step 0·1)에 맞는 줄들. */
  function laraRows(look, pose, step) {
    var rows = LARA_BODY.slice(), hood = LARA_HOODS[look && look.hood] || LARA_HOODS.none, bag = LARA_BAGS[look && look.bag] || LARA_BAGS.cooler, k;
    for (k in hood) if (Object.prototype.hasOwnProperty.call(hood, k)) rows[k] = hood[k];
    for (k in bag.rows) if (Object.prototype.hasOwnProperty.call(bag.rows, k)) rows[k] = rows[k].slice(0, 10) + bag.rows[k].split('').map(function (ch, bi) { return ch === '.' ? rows[k][10 + bi] : ch; }).join('');      // 오른쪽 네 칸에 덮어 그린다
    if (pose === 'search') return ['..............', '..............'].concat(rows).concat(['...bbb.bbb....']);      // 웅크린다: 몸을 두 칸 내리고 다리를 접는다
    return rows.concat(pose === 'walk' ? LARA_LEGS[step ? 1 : 0] : LARA_STAND);
  }
  /** 라라를 그린다. flip 이면 왼쪽을 본다. scale 은 한 칸의 크기. */
  function paintLara(ctx, x, y, scale, flip, look, pose, step) {
    if (!ctx) return false;
    scale = scale || 1; look = look || {};
    var coat = look.coat || { y: '#f0b400', j: '#f0b400' }, bag = LARA_BAGS[look.bag] || LARA_BAGS.cooler, pat = look.pat;
    // 든 것이 우비와 비슷한 색이면(빨간 우비에 빨간 구급 상자) 묻혀서 보이지 않았다(2.7.7). 그럴 때는 든 것의 몸 색과 밝은 색을 맞바꿔 그린다
    if (colorNear(bag.c, coat.j)) bag = { c: bag.C, C: bag.c, rows: bag.rows };
    var patCol = pat === 'star' ? '#ffd95a' : pat === 'camo' ? darker(coat.j, 0.6) : pat === 'heart' ? '#ff6f9f' : pat === 'reflect' ? '#dfe6ea' : pat === 'rain' ? '#8fc3ff' : '#f1f0e6';
    // 2.8.9: 무늬 색이 우비 색과 비슷하면(흰 우비에 흰 무늬, 노란 우비에 노란 별) 보이지 않았다. 그럴 때는 우비를 어둡게 한 색으로 그린다
    if (pat && pat !== 'none' && colorNear(patCol, coat.j)) patCol = darker(coat.j, 0.55);
    var pal = { y: coat.y, Y: darker(coat.y, 0.72), j: coat.j, J: darker(coat.j, 0.72), s: '#f1c9a0', e: '#17180f', m: '#b8402e', h: '#7a4a2a', k: '#6b4a2b', w: '#f1f0e6', i: '#f0a0b8', p: '#3c4a5a', b: '#b8402e', c: bag.c, C: bag.C, g: '#5cb85c', n: '#3a3a42', o: '#e8762a', O: '#3a2a22' };
    var rows = laraRows(look, pose, step), glowBand = pose === 'search' ? 13 : 11;
    for (var r = 0; r < rows.length; r++) for (var c = 0; c < LARA_W; c++) {
      var ch = rows[r][c];
      if (ch === '.') continue;
      var col = pal[ch];
      if (pat && pat !== 'none' && (ch === 'j' || (pat === 'camo' && ch === 'y')) && laraPattern(pat, c, r)) col = patCol;
      if (look.fx === 'glow' && (ch === 'j' || ch === 'J') && (r === glowBand || r === glowBand + 3)) col = '#d8ff7a';      // 야광: 가슴과 옷자락의 야광 띠(낮에도 보인다)
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(x + (flip ? LARA_W - 1 - c : c) * scale), Math.round(y + r * scale), scale, scale);
    }
    return true;
  }
  /**
   * 전설 효과(look.fx)를 라라 둘레에 그린다. t 는 흐른 시간(초).
   *   glow 둘레가 은은하게 깜박인다 · sparkle 뒤로 반짝이 가루가 떨어진다 · star 머리 위에 작은 별이 떠 있다
   */
  function paintLaraFx(ctx, x, y, scale, flip, look, t, pose, step, dark) {
    if (ctx && look && look.bag === 'lantern' && (dark || 0) > 0.3) {      // 4.5.2 등불은 밤에 둘레가 밝다(효과 칸과 따로)
      var la = Math.min(0.5, (dark - 0.3)) * (0.8 + 0.2 * Math.sin((t || 0) * 5)), lc = 'rgba(255, 217, 90, ' + la.toFixed(2) + ')', ls = scale || 1;
      ctx.fillStyle = lc; for (var ly = 10; ly <= 15; ly++) { var lw = ly === 10 || ly === 15 ? 4 : 6; ctx.fillRect(Math.round(x + (flip ? LARA_W - (10 - (lw - 4) / 2) - lw : 10 - (lw - 4) / 2) * ls), Math.round(y + ly * ls), lw * ls, ls); }
    }
    var fx = look && look.fx; if (!ctx || !fx || fx === 'none') return;
    scale = scale || 1; t = t || 0;
    function px(col, cx, cy, w, h) { ctx.fillStyle = col; ctx.fillRect(Math.round(x + (flip ? LARA_W - cx - (w || 1) : cx) * scale), Math.round(y + cy * scale), (w || 1) * scale, (h || 1) * scale); }
    if (fx === 'glow') {
      // 야광(2.0.4): 몸의 테두리를 따라 한 칸 두께로 빛난다. 전에는 네모난 띠를 둘러서 몸과 어긋나 보였다.
      //   낮에는 옅게, 밤(dark)에는 진하게. 숨 쉬듯 천천히 밝아졌다 어두워진다.
      var rows = laraRows(look, pose === 'search' ? 'search' : pose, step), night = Math.max(0, Math.min(1, dark || 0));
      var a = (0.3 + 0.5 * night) + 0.15 * Math.sin(t * 2.4), col = 'rgba(206, 255, 96, ' + Math.max(0.12, Math.min(0.95, a)).toFixed(2) + ')';
      for (var r = 0; r < rows.length - 1; r++) for (var c = 0; c < LARA_W; c++) {      // 발(맨 아랫줄)은 땅에 닿으니 두르지 않는다
        if (rows[r][c] !== '.') continue;
        var touch = (c > 0 && rows[r][c - 1] !== '.') || (c < LARA_W - 1 && rows[r][c + 1] !== '.') || (r > 0 && rows[r - 1][c] !== '.') || (rows[r + 1] && rows[r + 1][c] !== '.');
        if (touch) px(col, c, r, 1, 1);
      }
    }
    if (fx === 'sparkle') for (var k = 0; k < 4; k++) { var ph = (t * 1.6 + k * 0.25) % 1; px(k % 2 ? '#ffffff' : '#ffe9a0', 1 - (k % 2), 6 + Math.floor(ph * 11), 1, 1); if (ph < 0.5) px('rgba(255, 233, 160, .5)', 3 - k % 3, 5 + Math.floor(ph * 9), 1, 1); }
    // 4.5.2 더한 효과: 꽃잎(분홍 잎이 천천히 떨어진다) · 비눗방울(둥근 방울이 떠오른다) · 등불 빛(밤에 든 등불 둘레가 밝다)
    if (fx === 'petal') for (var q = 0; q < 3; q++) { var pp = (t * 0.7 + q / 3) % 1, sx = 2 + q * 4 + Math.round(Math.sin(t * 2 + q) * 1.5); px(q % 2 ? '#ffb8d0' : '#ff8fb8', sx, -2 + Math.floor(pp * 18), 1, 1); }
    if (fx === 'bubble') for (var u = 0; u < 3; u++) { var bp = (t * 0.5 + u / 3) % 1, bx = 11 + (u % 2) + Math.round(Math.sin(t * 3 + u) * 1), by = 12 - Math.floor(bp * 14); px('rgba(160, 220, 255, .85)', bx, by, 1, 1); if (u === 1) { px('rgba(160, 220, 255, .6)', bx + 1, by, 1, 1); px('rgba(160, 220, 255, .6)', bx, by - 1, 1, 1); px('#ffffff', bx + 1, by - 1, 1, 1); } }
    if (fx === 'star') { var bob = Math.floor(t * 2) % 2, sy = (LARA_HOODS[look.hood] && look.hood !== 'none' ? -3 : -1) - bob; px('#ffd95a', 7, sy, 1, 3); px('#ffd95a', 6, sy + 1, 3, 1); px('#ffffff', 7, sy + 1, 1, 1); }
  }
  /*
   * 동물 친구(4.4.6): 강아지 24 · 고양이 24. 작은 도트 하나(15×11칸)로 걷는 장면과 창(일행 · 도감)을 함께 그린다.
   *   왜: 큰 그림(24×19칸)은 필요 없다고 하셨다. 레퍼런스(앉은 옆모습 도트 고양이 · 강아지)처럼
   *   머리는 왼쪽 앞, 몸은 오른쪽으로 앉고, 꼬리는 오른쪽에서 말려 올라간다. 눈은 1칸 점, 테두리는 없다(라라와 같이).
   *   품종마다 귀 · 꼬리 · 털 · 무늬 · 몸집이 다르다(PET_SPEC). 창에서는 같은 그림을 칸 크기(k)만 키워 쓴다.
   *   글자 뜻(칸): o 몸, q 무늬, d 어두운 귀, z 주둥이(밝게), e 눈, n 코, t2 혀, i 속귀, C 볼, x 다리 사이 선
   */
  var PET_H = 11, PET_W = 15;      // 4.4.8 맨 아래 빈 줄(테두리 자리)을 없애 발이 땅에 닿는다
  var PET_SPEC = {
    jindo: {'size': 'm', 'ear': 'pt', 'tail': 'curl', 'snout': 'mid', 'body': '#ece6d6', 'patch': '#ece6d6', 'kind': 'dog'},
    nureong: {'size': 'm', 'ear': 'pt', 'tail': 'curl', 'snout': 'mid', 'body': '#c08a44', 'patch': '#ead6a6', 'pat': 'belly', 'kind': 'dog'},
    shiba: {'size': 's', 'ear': 'pt', 'tail': 'curl', 'snout': 'mid', 'body': '#d9903d', 'patch': '#f3e3c3', 'pat': 'belly', 'kind': 'dog'},
    poodle: {'size': 's', 'ear': 'flop', 'tail': 'stub', 'snout': 'mid', 'fur': 'fluff', 'body': '#c9a27a', 'patch': '#b08a62', 'kind': 'dog'},
    beagle: {'size': 's', 'ear': 'long', 'tail': 'up', 'snout': 'mid', 'body': '#f1ede2', 'patch': '#b8783c', 'pat': 'saddle head', 'kind': 'dog'},
    dachs: {'size': 'm', 'legs': 'short', 'ear': 'long', 'tail': 'down', 'snout': 'long', 'body': '#8a4a24', 'patch': '#8a4a24', 'kind': 'dog'},
    black: {'size': 'm', 'ear': 'pt', 'tail': 'curl', 'snout': 'mid', 'body': '#2e2c2a', 'patch': '#2e2c2a', 'kind': 'dog'},
    spot: {'size': 'm', 'ear': 'flop', 'tail': 'up', 'snout': 'mid', 'body': '#ece6d6', 'patch': '#2b2a28', 'pat': 'spots mask', 'kind': 'dog'},
    husky: {'size': 'l', 'ear': 'pt', 'tail': 'bush', 'snout': 'long', 'body': '#8d95a3', 'patch': '#f1efe8', 'pat': 'belly', 'kind': 'dog'},
    corgi: {'size': 'm', 'legs': 'short', 'ear': 'big', 'tail': 'stub', 'snout': 'mid', 'body': '#e0a04a', 'patch': '#f6efe2', 'pat': 'belly socks', 'kind': 'dog'},
    collie: {'size': 'm', 'ear': 'fold', 'tail': 'bush', 'snout': 'long', 'body': '#252428', 'patch': '#f1efe8', 'pat': 'chest socks belly', 'kind': 'dog'},
    retriever: {'size': 'l', 'ear': 'flop', 'tail': 'down', 'snout': 'long', 'fur': 'fluff', 'body': '#e2b468', 'patch': '#e2b468', 'kind': 'dog'},
    sapsal: {'size': 'm', 'ear': 'flop', 'tail': 'bush', 'snout': 'mid', 'fur': 'fluff', 'body': '#a9a39a', 'patch': '#6e6860', 'pat': 'mask', 'kind': 'dog'},
    wolf: {'size': 'l', 'ear': 'pt', 'tail': 'bush', 'snout': 'long', 'body': '#5d6470', 'patch': '#e6e5db', 'pat': 'belly', 'kind': 'dog'},
    pungsan: {'size': 'l', 'ear': 'pt', 'tail': 'curl', 'snout': 'mid', 'fur': 'fluff', 'body': '#f4f1ea', 'patch': '#cfd6dd', 'pat': 'belly', 'kind': 'dog'},
    dalma: {'size': 'l', 'ear': 'flop', 'tail': 'down', 'snout': 'long', 'body': '#f4f2ec', 'patch': '#17171a', 'pat': 'spots', 'kind': 'dog'},
    shepherd: {'size': 'l', 'ear': 'big', 'tail': 'bush', 'snout': 'long', 'body': '#b8783c', 'patch': '#2a2420', 'pat': 'saddle mask', 'kind': 'dog'},
    samoyed: {'size': 'l', 'ear': 'pt', 'tail': 'curl', 'snout': 'mid', 'fur': 'fluff', 'body': '#ffffff', 'patch': '#ffffff', 'kind': 'dog'},
    cheese: {'ear': 'pt', 'tail': 'long', 'body': '#e0a04a', 'patch': '#f3e3c3', 'pat': 'tabby', 'eye': '#e0c040', 'kind': 'cat'},
    tabby: {'ear': 'pt', 'tail': 'long', 'body': '#8d8f94', 'patch': '#3c3e44', 'pat': 'tabby', 'kind': 'cat'},
    white: {'ear': 'pt', 'tail': 'long', 'body': '#f4f2ec', 'patch': '#f4f2ec', 'eye': '#6ab0e8', 'kind': 'cat'},
    gray: {'ear': 'pt', 'tail': 'long', 'body': '#9a9da3', 'patch': '#9a9da3', 'kind': 'cat'},
    cow: {'ear': 'pt', 'tail': 'long', 'body': '#f4f2ec', 'patch': '#26262a', 'pat': 'saddle head tail', 'kind': 'cat'},
    chaos: {'ear': 'pt', 'tail': 'long', 'body': '#2e2a26', 'patch': '#b8783c', 'pat': 'calico', 'eye': '#e0c040', 'kind': 'cat'},
    tuxedo: {'ear': 'pt', 'tail': 'long', 'body': '#26262a', 'patch': '#f1efe8', 'pat': 'chest socks', 'eye': '#e0c040', 'kind': 'cat'},
    calico: {'ear': 'pt', 'tail': 'long', 'body': '#f1efe8', 'patch': '#d0782e', 'patch2': '#2a2622', 'pat': 'calico', 'kind': 'cat'},
    bengal: {'ear': 'pt', 'tail': 'long', 'body': '#d09a50', 'patch': '#5a3a20', 'pat': 'spots', 'kind': 'cat'},
    russian: {'ear': 'pt', 'tail': 'long', 'body': '#7d8ca2', 'patch': '#7d8ca2', 'eye': '#7ad070', 'kind': 'cat'},
    scottish: {'ear': 'fold', 'tail': 'long', 'body': '#b8b0a4', 'patch': '#8a8478', 'pat': 'tabby', 'eye': '#e0a040', 'kind': 'cat'},
    munchkin: {'legs': 'short', 'ear': 'pt', 'tail': 'long', 'body': '#e8c08a', 'patch': '#f6ead6', 'pat': 'chest', 'kind': 'cat'},
    siam: {'ear': 'pt', 'tail': 'long', 'body': '#ece0c8', 'patch': '#4a3628', 'pat': 'point', 'eye': '#5aa8f0', 'kind': 'cat'},
    nero: {'ear': 'pt', 'tail': 'long', 'body': '#1a1a1e', 'patch': '#1a1a1e', 'eye': '#f0b400', 'kind': 'cat'},
    ragdoll: {'ear': 'pt', 'tail': 'fluffy', 'fur': 'fluff', 'body': '#f4f0e8', 'patch': '#7a6a5c', 'pat': 'point', 'eye': '#5aa8f0', 'kind': 'cat'},
    golden: {'chubby': true, 'ear': 'pt', 'tail': 'long', 'body': '#e8b04a', 'patch': '#f8e2b0', 'pat': 'belly tabby', 'eye': '#5ab070', 'kind': 'cat'},
    persian: {'ear': 'fold', 'tail': 'fluffy', 'fur': 'fluff', 'body': '#ece6dc', 'patch': '#ece6dc', 'eye': '#e09040', 'kind': 'cat'},
    norwegian: {'size': 'l', 'ear': 'pt', 'tail': 'fluffy', 'fur': 'fluff', 'body': '#8a7058', 'patch': '#efe4d0', 'pat': 'belly tabby', 'eye': '#9ad04a', 'kind': 'cat'},
    maltese: {'size': 's', 'ear': 'flop', 'tail': 'curl', 'snout': 'mid', 'fur': 'fluff', 'body': '#f6f4ee', 'patch': '#f6f4ee', 'kind': 'dog'},
    pug: {'size': 's', 'ear': 'fold', 'tail': 'curl', 'snout': 'mid', 'body': '#d8b888', 'patch': '#3a3430', 'pat': 'muzzle', 'kind': 'dog'},
    schnauzer: {'size': 'm', 'ear': 'fold', 'tail': 'stub', 'snout': 'long', 'fur': 'fluff', 'body': '#8c9096', 'patch': '#d8dadc', 'pat': 'belly', 'kind': 'dog'},
    doberman: {'size': 'l', 'ear': 'pt', 'tail': 'stub', 'snout': 'long', 'body': '#2a2422', 'patch': '#b8783c', 'pat': 'socks muzzle', 'kind': 'dog'},
    akita: {'size': 'l', 'ear': 'pt', 'tail': 'curl', 'snout': 'mid', 'fur': 'fluff', 'body': '#d88a48', 'patch': '#f6efe2', 'pat': 'belly', 'kind': 'dog'},
    bernese: {'size': 'l', 'ear': 'flop', 'tail': 'bush', 'snout': 'mid', 'fur': 'fluff', 'body': '#24222a', 'patch': '#f1efe8', 'pat': 'chest socks', 'kind': 'dog'},
    socks: {'ear': 'pt', 'tail': 'long', 'body': '#6a6c72', 'patch': '#f1efe8', 'pat': 'socks chest', 'kind': 'cat'},
    cream: {'ear': 'pt', 'tail': 'long', 'body': '#f0dcb4', 'patch': '#e0c090', 'pat': 'tabby', 'kind': 'cat'},
    abyssinian: {'ear': 'pt', 'tail': 'long', 'body': '#b8763c', 'patch': '#8a5028', 'pat': 'tabby', 'eye': '#7ad070', 'kind': 'cat'},
    sphynx: {'ear': 'pt', 'tail': 'long', 'body': '#e8c0b0', 'patch': '#e8c0b0', 'eye': '#7ad070', 'kind': 'cat'},
    maine: {'size': 'l', 'ear': 'pt', 'tail': 'fluffy', 'fur': 'fluff', 'body': '#6a5038', 'patch': '#c8a888', 'pat': 'belly tabby', 'eye': '#e0c040', 'kind': 'cat'},
    turkish: {'ear': 'pt', 'tail': 'fluffy', 'fur': 'fluff', 'body': '#f8f6f0', 'patch': '#f8f6f0', 'eye': '#6ab0e8', 'kind': 'cat'}
  };
  function petLum(h){var n=parseInt(h.slice(1),16);return (((n>>16)&255)*0.3+((n>>8)&255)*0.5+(n&255)*0.2)/255;}

  function petDark(hex,k){var n=parseInt(hex.slice(1),16),r=(n>>16)&255,g=(n>>8)&255,b=n&255;return 'rgb('+Math.round(r*k)+','+Math.round(g*k)+','+Math.round(b*k)+')';}

  function petLight(hex,k){var n=parseInt(hex.slice(1),16),r=(n>>16)&255,g=(n>>8)&255,b=n&255;return 'rgb('+Math.round(r+(255-r)*k)+','+Math.round(g+(255-g)*k)+','+Math.round(b+(255-b)*k)+')';}

  // 검은 동물은 몸을 조금 밝혀 어두운 배경에서도 모양이 보이게 한다.
  /** 칸 그림(petGrid)을 그린다. k 는 한 칸의 크기. */
  function petPaint2(g,x0,y0,k,sp){
   var G=petGrid(sp),H=G.length,W=G[0].length,body=sp.body,patch=sp.patch||body,patch2=sp.patch2,dark=petLum(body)<0.22;
   if(dark)body=petLight(body,0.12).replace(/rgb\((\d+),(\d+),(\d+)\)/,function(_,r,gg,b){return '#'+((1<<24)+(+r<<16)+(+gg<<8)+(+b)).toString(16).slice(1);});
   function filled(x,y){return y>=0&&y<H&&x>=0&&x<W&&G[y][x]!=='.';}
   for(var y=0;y<H;y++)for(var x=0;x<W;x++){var c=G[y][x],col;
    if(c==='.')continue; // 4.4.5: 검은 테두리는 넣지 않는다(동물만 튀어 보인다고 하셨다). 라라처럼 몸 색과 아래 그늘로만 모양을 낸다
    if(c==='t2')col='#f07888'; else if(c==='z')col=petLight(body,0.5); else if(c==='C')col='#f4a0b0'; else if(c==='i')col='#f0a0a8'; else if(c==='x')col=petDark(body,0.55);
    else if(c==='e')col=dark?(sp.eye||'#f0d060'):(sp.eye&&petLum(body)>0.85?sp.eye:'#241c1a');
    else if(c==='n')col=sp.kind==='cat'?'#f08898':'#241c1a';
    else { var b=c==='q'?(patch2&&((x*3+y*5)%7<3)?patch2:patch):body; col=c==='d'?petDark(body,0.7):b; if(!filled(x,y+1)||(G[y+1]&&G[y+1][x]==='.'))col=petDark(b,0.84); }
    if(sp.shadow)col='#4a4b40';      // 못 만난 친구(도감): 품종이 드러나지 않게 한 빛깔 그림자
    g.fillStyle=col;g.fillRect(x0+x*k,y0+y*k,k,k);
   }
  }

  var PET_CAT=[
   '...............',
   '.O.....O.......',
   '.OI...IO.......',
   '.OOOOOOO.......',
   '.OOEOEOO.......',
   '.OCONOCO....T..',
   '..OOOOOO.....T.',
   '..OOOOOOOO...T.',
   '..OOOOOOOOO..T.',
   '..OxOOOOOOOO.T.',
   '..PPxPPOOOOOTT.'];
  var PET_DOG=[
   '...............',
   '...............',
   '..OOOOO........',
   '.OOOOOOO.......',
   '.OOEOEOO.......',
   '.OOZNZOO.......',
   '..OZMZO.....T..',
   '..OOOOOOOOOT...',
   '..OOOOOOOOOO...',
   '..OxOOOOOOOO...',
   '..PPxPPOOOOO...'];
  /** 품종(sp)에 맞춘 칸 그림. sp.wag 면 꼬리 끝이 한 칸 오른다. */
  /*
   * 4.5.0 걷는 모습: 네 발로 서서 걷는다(앉은 그림을 들썩이며 미끄러지던 것이 어색하다고 하셨다).
   *   두 칸(step 0 · 1): 0 은 앞뒤 다리를 벌리고, 1 은 다리가 모인다. 발은 늘 맨 아랫줄(땅)에 닿는다.
   *   머리는 앉은 그림과 같은 모양(고양이 1~5줄, 강아지 1~5줄)이라 귀 · 얼굴 무늬는 같은 규칙을 쓴다.
   */
  var PET_WALK_CAT=[
   '...............',
   '.O.....O.......',
   '.OI...IO.......',
   '.OOOOOOO.....T.',
   '.OOEOEOO......T',
   '.OCONOCOOOOOOT.',
   '..OOOOOOOOOOO..',
   '...OOOOOOOOOO..',
   '...OOOOOOOOOO..',
   '...PP.....PP...',
   '..P..P...P..P..'];
  var PET_WALK_DOG=[
   '...............',
   '..OOOOO........',
   '.OOOOOOO.......',
   '.OOEOEOO....T..',
   '.OOZNZOO.....T.',
   '..OZMZOOOOOOT..',
   '..OOOOOOOOOOO..',
   '...OOOOOOOOOO..',
   '...OOOOOOOOOO..',
   '...PP.....PP...',
   '..P..P...P..P..'];
  function petGridWalk(sp){
   var cat=sp.kind==='cat', G=(cat?PET_WALK_CAT:PET_WALK_DOG).map(function(r){return r.split('');}), H=G.length, W=PET_W;
   function S(x,y,c){if(x>=0&&x<W&&y>=0&&y<H)G[y][x]=c;}
   if(sp.step){ G[10]='...P......P....'.split(''); G[9]='...PP.....PP...'.split(''); }      // 다리가 모이는 칸
   var e=sp.ear, t=sp.tail, dy=-1;      // 강아지 머리는 앉은 그림보다 한 줄 위
   if(cat){
    if(e==='fold'){S(1,1,'.');S(7,1,'.');S(2,2,'D');S(6,2,'D');S(1,2,'O');S(7,2,'O');}
    if(t==='fluffy'){S(12,4,'T');S(13,3,'T');S(12,5,'T');}
   } else {
    if(e==='pt'){S(2,0,'O');S(6,0,'O');S(2,1,'I');S(6,1,'I');}
    if(e==='big'){S(2,0,'O');S(3,0,'O');S(5,0,'O');S(6,0,'O');S(3,1,'I');S(5,1,'I');}
    if(e==='flop'){[2,3,4,5].forEach(function(y){S(1,y,'D');S(7,y,'D');});}
    if(e==='long'){[2,3,4,5,6].forEach(function(y){S(1,y,'D');S(7,y,'D');});}
    if(e==='fold'){S(2,1,'D');S(6,1,'D');S(2,2,'D');S(6,2,'D');}
    if(t==='curl'){S(13,4,'.');S(13,3,'T');S(14,3,'T');S(14,4,'T');}
    if(t==='bush'){S(13,3,'T');S(13,5,'T');S(14,4,'T');}
    if(t==='down'){S(12,3,'.');S(13,4,'.');S(12,5,'.');S(13,6,'T');S(13,7,'T');S(14,8,'T');S(12,5,'O');}
    if(t==='stub'){S(12,3,'.');S(13,4,'.');}
    if(sp.snout==='long'){S(0,4,'Z');}
   }
   if(sp.chubby||sp.size==='l'){S(13,6,'O');S(13,7,'O');S(2,7,'O');}
   if(sp.legs==='short'){G[9]=G[10].slice();G[10]='...............'.split('');G.pop();G.unshift('...............'.split(''));}      // 다리가 짧으면 몸이 한 줄 내려온다
   var pt=sp.pat||'', top=sp.legs==='short'?1:0;
   function P(f){for(var y=0;y<H;y++)for(var x=0;x<W;x++){var c=G[y][x];if((c==='O'||c==='P'||c==='T'||c==='Z'||c==='D')&&f(x,y-top,c))G[y][x]=c==='Z'?'Z':'q';}}
   if(pt.indexOf('belly')>=0)P(function(x,y,c){return c==='Z'||(y===8&&x>=4&&x<=11)||(x>=2&&x<=4&&y>=5&&y<=7);});
   if(pt.indexOf('chest')>=0)P(function(x,y){return x>=2&&x<=4&&y>=6&&y<=8;});
   if(pt.indexOf('socks')>=0)P(function(x,y,c){return c==='P';});
   if(pt.indexOf('saddle')>=0)P(function(x,y,c){return y>=5&&y<=7&&x>=7&&x<=12&&c!=='T';});
   if(pt.indexOf('mask')>=0)P(function(x,y,c){return y>=(cat?3:2)&&y<=4&&x>=1&&x<=3&&c!=='Z';});
   if(pt.indexOf('head')>=0)P(function(x,y,c){return (y<=(cat?4:3)&&x>=4&&x<=7)||c==='D';});
   if(pt.indexOf('spots')>=0)P(function(x,y,c){return c!=='Z'&&c!=='P'&&((y===2&&x===6)||(y===6&&(x===5||x===10))||(y===8&&(x===7||x===12))||(y===7&&x===3));});
   if(pt.indexOf('tabby')>=0)P(function(x,y){return (y===3&&cat&&(x===3||x===5))||((y===6||y===8)&&(x===7||x===9||x===11));});
   if(pt.indexOf('point')>=0)P(function(x,y,c){return y<=(cat?2:1)||(y>=(cat?4:3)&&y<=(cat?5:4)&&x>=3&&x<=5)||c==='P'||c==='T';});
   if(pt.indexOf('calico')>=0)P(function(x,y,c){return c!=='P'&&((x>>1)+(y>>1))%3===0&&!(y>=3&&y<=5&&x>=3&&x<=5);});
   if(pt.indexOf('tail')>=0)P(function(x,y,c){return c==='T';});
   if(pt.indexOf('muzzle')>=0)for(var yz=0;yz<H;yz++)for(var xz=0;xz<W;xz++)if(G[yz][xz]==='Z')G[yz][xz]='q';
   if(sp.wag){var tp=-1,tx=-1;for(var y0=0;y0<H&&tp<0;y0++)for(var x0=11;x0<W;x0++)if(G[y0][x0]==='T'||(G[y0][x0]==='q'&&x0>=12)){tp=y0;tx=x0;break;}if(tp>0&&G[tp-1][tx]==='.')G[tp-1][tx]=G[tp][tx];}
   for(var y=0;y<H;y++)for(var x=0;x<W;x++){var c=G[y][x];G[y][x]=c==='O'||c==='P'||c==='T'?'o':c==='Z'?'z':c==='D'?'d':c==='N'?'n':c==='M'?'t2':c==='E'?'e':c==='I'?'i':c;}
   return G;
  }
  function petGrid(sp){
   if(sp.walk)return petGridWalk(sp);
   var cat=sp.kind==='cat', G=(cat?PET_CAT:PET_DOG).map(function(r){return r.split('');}), H=G.length, W=PET_W;
   function S(x,y,c){if(x>=0&&x<W&&y>=0&&y<H)G[y][x]=c;}
   var e=sp.ear, t=sp.tail;
   if(cat){
    if(e==='fold'){S(1,1,'.');S(7,1,'.');S(2,2,'D');S(6,2,'D');S(1,2,'O');S(7,2,'O');}
    if(t==='fluffy'){S(12,6,'T');S(12,7,'T');S(12,8,'T');S(12,9,'T');}
   } else {
    if(e==='pt'){S(2,1,'O');S(6,1,'O');S(2,2,'I');S(6,2,'I');}
    if(e==='big'){S(2,1,'O');S(3,1,'O');S(5,1,'O');S(6,1,'O');S(2,0,'O');S(6,0,'O');S(3,2,'I');S(5,2,'I');}
    if(e==='flop'){[3,4,5,6].forEach(function(y){S(1,y,'D');S(7,y,'D');});S(1,6,'D');S(7,6,'D');}
    if(e==='long'){[3,4,5,6,7].forEach(function(y){S(1,y,'D');S(7,y,'D');});S(2,7,'O');}
    if(e==='fold'){S(2,2,'D');S(6,2,'D');S(2,3,'D');S(6,3,'D');}
    if(t==='curl'){S(12,6,'.');S(12,5,'T');S(13,5,'T');S(13,6,'T');}
    if(t==='up'){S(12,5,'T');}
    if(t==='bush'){S(12,5,'T');S(13,5,'T');S(13,6,'T');S(12,7,'T');}
    if(t==='down'){S(12,6,'.');S(11,7,'.');S(12,8,'T');S(12,9,'T');S(13,10,'T');}
    if(t==='stub'){S(12,6,'.');}
    if(sp.snout==='long'){S(0,5,'Z');}
   }
   if(sp.fur==='fluff'){S(1,6,'O');S(7,6,'O');S(2,11-1,'P');}
   if(sp.chubby||sp.size==='l'){S(11,8,'O');S(12,9,'O');S(12,10,'O');if(cat){S(13,10,'T');}}
   if(sp.size==='s'&&!cat){S(11,9,'.');S(11,10,'.');S(10,7,'.');}
   if(sp.legs==='short'){S(3,9,'O');S(4,9,'O');}
   var pt=sp.pat||'';
   function P(f){for(var y=0;y<H;y++)for(var x=0;x<W;x++){var c=G[y][x];if((c==='O'||c==='P'||c==='T'||c==='Z'||c==='D')&&f(x,y,c))G[y][x]=c==='Z'?'Z':'q';}}
   if(pt.indexOf('belly')>=0)P(function(x,y,c){return c==='Z'||(x>=3&&x<=6&&y>=6&&y<=10&&c!=='T');});
   if(pt.indexOf('chest')>=0)P(function(x,y,c){return x>=3&&x<=5&&y>=6&&y<=9&&c!=='T';});
   if(pt.indexOf('socks')>=0)P(function(x,y,c){return c==='P';});
   if(pt.indexOf('saddle')>=0)P(function(x,y,c){return y>=7&&y<=9&&x>=7&&c!=='T';});
   if(pt.indexOf('mask')>=0)P(function(x,y,c){return y>=3&&y<=5&&x>=1&&x<=3&&c!=='Z';});
   if(pt.indexOf('head')>=0)P(function(x,y,c){return (y<=4&&x>=4)||c==='D';});
   if(pt.indexOf('spots')>=0)P(function(x,y,c){return c!=='Z'&&c!=='P'&&((y===3&&x===6)||(y===7&&(x===4||x===9))||(y===9&&(x===7||x===11))||(y===8&&x===2)||(y===5&&x===13));});
   if(pt.indexOf('tabby')>=0)P(function(x,y){return (y===3&&(x===3||x===5))||((y===7||y===9)&&(x===8||x===10));});
   if(pt.indexOf('point')>=0)P(function(x,y,c){return y<=2||(y>=4&&y<=5&&x>=3&&x<=5)||c==='P'||c==='T';});
   if(pt.indexOf('calico')>=0)P(function(x,y,c){return c!=='P'&&((x>>1)+(y>>1))%3===0&&!(y>=4&&y<=5&&x>=3&&x<=5);});
   if(pt.indexOf('tail')>=0)P(function(x,y,c){return c==='T';});
   if(pt.indexOf('muzzle')>=0)for(var yz=0;yz<H;yz++)for(var xz=0;xz<W;xz++)if(G[yz][xz]==='Z')G[yz][xz]='q';      // 퍼그 · 도베르만: 주둥이가 무늬 색
   if(sp.wag){var top=-1,tx=-1;for(var y0=0;y0<H&&top<0;y0++)for(var x0=9;x0<W;x0++)if(G[y0][x0]==='T'||(G[y0][x0]==='q'&&x0>=12)){top=y0;tx=x0;break;}if(top>1&&G[top-1][tx]==='.')G[top-1][tx]=G[top][tx];}
   for(var y=0;y<H;y++)for(var x=0;x<W;x++){var c=G[y][x];G[y][x]=c==='O'||c==='P'||c==='T'?'o':c==='Z'?'z':c==='D'?'d':c==='N'?'n':c==='M'?'t2':c==='E'?'e':c==='I'?'i':c;}
   return G;
  }

  // 옷을 얹는 자리: top 머리 위 줄(귀 사이), neck 목 줄, back 등의 첫 줄(등은 back~back+2줄, 7~11칸), eye 눈 줄
  var PET_BOX = { dog: { top: 1, neck: 7, back: 8, eye: 4 }, cat: { top: 2, neck: 6, back: 7, eye: 4 } };
  var PET_BOX_WALK = { dog: { top: 0, neck: 6, back: 6, eye: 3 }, cat: { top: 2, neck: 6, back: 6, eye: 4 } };      // 4.5.0 걷는 모습의 옷 자리
  function petKind(kind) { return kind === 'cat' ? 'cat' : 'dog'; }
  function petSpec(pet) { pet = pet || {}; var sp = PET_SPEC[pet.id]; if (!sp) { var kind = petKind(pet.kind); for (var k in PET_SPEC) if (PET_SPEC[k].kind === kind) { sp = PET_SPEC[k]; break; } } var o = {}; for (var q in sp) o[q] = sp[q]; return o; }
  /** 칸 그림(글자 배열의 줄). wag 1 이면 꼬리 끝이 한 칸 오른다. */
  function petRows(kind, wag, id) {
    var sp = petSpec({ kind: kind, id: id }); sp.kind = petKind(sp.kind); sp.wag = !!wag; var G = petGrid(sp);
    return G.map(function (r) { return r.map(function (c) { return c.length > 1 ? 'm' : c; }).join(''); });
  }
  /** 걷는 장면의 친구. 앉은 옆모습(머리 왼쪽). flip 이면 좌우를 뒤집는다(라라 쪽을 본다). */
  function paintPet(ctx, x, y, scale, flip, pet, outfit, t) {
    if (!ctx) return false;
    scale = scale || 1; pet = pet || {}; t = t || 0;
    var kind = petKind(pet.kind), sp = petSpec(pet), top = PET_BOX[kind].top, W = PET_W, wag = Math.floor(t * 4) % 2;
    sp.kind = kind; sp.wag = !!wag; sp.walk = !!pet.walk; sp.step = pet.step ? 1 : 0;
    var g = ctx;
    if (flip && ctx.save) { ctx.save(); ctx.translate(x * 2 + W * scale, 0); ctx.scale(-1, 1); }
    petPaint2(g, x, y, scale, sp);
    function px(col, cx, cy, w, h) { g.fillStyle = col; g.fillRect(Math.round(x + cx * scale), Math.round(y + cy * scale), (w || 1) * scale, (h || 1) * scale); }
    // 옷(4.4.6: 15×12칸 그림에 맞춰 자리를 다시 잡았다. 머리 위 B.top · 목 B.neck · 등 B.back · 눈 B.eye)
    var B = (sp.walk ? PET_BOX_WALK : PET_BOX)[kind], tp = B.top + (sp.walk && sp.legs === 'short' ? 1 : 0), nk = B.neck + (sp.walk && sp.legs === 'short' ? 1 : 0), bk = B.back + (sp.walk && sp.legs === 'short' ? 1 : 0);
    if (outfit === 'scarf') { px('#c0392b', 2, nk, 5, 1); px('#c0392b', 6, nk + 1, 1, 2); px('#8f2a20', 6, nk + 2, 1, 1); }
    if (outfit === 'bell') { px('#30343c', 2, nk, 5, 1); px('#ffd95a', 4, nk + 1, 1, 1); }
    if (outfit === 'bandana') { px('#f0b400', 2, nk, 5, 1); px('#f0b400', 3, nk + 1, 3, 1); px('#b88a00', 4, nk + 2, 1, 1); px('#fff4c0', 3, nk, 1, 1); }
    if (outfit === 'bowtie') { px('#3f7fb5', 3, nk, 1, 1); px('#3f7fb5', 5, nk, 1, 1); px('#27507a', 4, nk, 1, 1); px('#3f7fb5', 3, nk + 1, 1, 1); px('#3f7fb5', 5, nk + 1, 1, 1); }
    if (outfit === 'ribbon') { px('#ff7fb0', 3, tp, 1, 1); px('#f1f0e6', 4, tp, 1, 1); px('#ff7fb0', 5, tp, 1, 1); }
    if (outfit === 'flower') { px('#ffffff', 6, tp - 1, 1, 1); px('#ffffff', 5, tp, 1, 1); px('#ffffff', 7, tp, 1, 1); px('#ffffff', 6, tp + 1, 1, 1); px('#ffd95a', 6, tp, 1, 1); }
    if (outfit === 'goggles') { px('#5a4a3a', 1, B.eye, 7, 1); px('#7ad0f0', 3, B.eye, 1, 1); px('#7ad0f0', 5, B.eye, 1, 1); px('#c8f0ff', 3, B.eye - 1 + 1, 1, 1); }
    if (outfit === 'coat') { px('#f0b400', 6, bk, 5, 2); px('#b88a00', 6, bk + 2, 5, 1); px('#f1f0e6', 8, bk + 1, 1, 1); }
    if (outfit === 'sweater') { for (var sy = 0; sy < 3; sy++) px(sy % 2 ? '#f1efe8' : '#c0392b', 3, bk + sy, 8, 1); }
    if (outfit === 'pack') { px('#5d6b4a', 8, bk - 1, 3, 2); px('#3f4a33', 8, bk + 1, 3, 1); px('#c8a050', 9, bk - 1, 1, 1); }
    if (outfit === 'hat') { px('#3f7fb5', 3, tp, 3, 1); px('#3f7fb5', 4, tp - 1, 1, 1); px('#f1f0e6', 4, tp - 2, 1, 1); }
    if (outfit === 'cape') { px('#8a5fc0', 7, bk, 4, 2); px('#6a45a0', 8, bk + 2, 3, 1); px('#8a5fc0', 11, bk + wag, 1, 2); px('#ffd95a', 6, bk, 1, 1); }
    if (outfit === 'crown') { px('#ffd95a', 3, tp, 3, 1); px('#ffd95a', 3, tp - 1, 1, 1); px('#ffd95a', 5, tp - 1, 1, 1); px('#e0392b', 4, tp, 1, 1); if (Math.floor(t * 2) % 2) px('#ffffff', 4, tp - 2, 1, 1); }
    if (outfit === 'halo') { var hy = tp - 2 - (Math.floor(t * 2) % 2); px('#ffe680', 3, hy, 3, 1); px('#fff8c8', 4, hy, 1, 1); }
    if (outfit === 'wings') {      // 4.5.0 다시 그렸다: 깃털 끝이 셋으로 갈라진 날개가 등에서 위로 펴지고, 접었다 폈다 한다
      var wy = bk - 1, up = wag;
      px('#d8e4f0', 8, wy, 3, 1);                                   // 날개 뿌리(등에 붙은 곳)
      px('#ffffff', 9, wy - 1, 3, 1); px('#ffffff', 10, wy - 2, 2, 1);
      px('#ffffff', 11, wy - 3 - up, 1, 1); px('#ffffff', 12, wy - 2 - up, 1, 1); px('#ffffff', 12, wy - 1, 1, 1);      // 깃털 끝 셋
      px('#b8c8dc', 9, wy, 1, 1);
    }
    if (flip && ctx.restore) ctx.restore();
    return true;
  }
  /** 창에 쓰는 그림: 같은 칸 그림을 k 배로 키운다. */
  function paintPetBig(ctx, x, y, k, pet) { if (!ctx) return false; var sp = petSpec(pet); sp.kind = petKind(sp.kind); if (pet && pet.shadow) { sp = petSpec({ kind: sp.kind }); sp.kind = petKind(sp.kind); sp.shadow = true; } petPaint2(ctx, x, y, k || 1, sp); return true; }

  /** 옷장의 그림: 그 자리에 서 있는 라라를 그린다(scene 밖에서 쓴다). */
  function drawHero(ctx, x, y, scale, look, step, t, dark) {
    if (!ctx) return false;
    paintLara(ctx, x, y, scale || 1, false, look, step === undefined ? 'stand' : 'walk', step);
    paintLaraFx(ctx, x, y, scale || 1, false, look, t || 0, step === undefined ? 'stand' : 'walk', step, dark);
    return true;
  }
  /*
   * 거점의 깃발(2.0.1): 가로 5칸, 세로 4칸(전에는 4×3). 줄마다 색을 줄 수 있다.
   *   flag = '#rrggbb' 한 색 · 'rainbow' 네 줄 무지개(천천히 흐른다) · 'glow' 야광(밤에는 어두워지지 않고 둘레가 빛난다)
   *   dark 는 밤의 어두운 정도(0~1). 보통 깃발은 밤에 어두워진다.
   */
  var FLAG_RAINBOW = ['#e0392b', '#f0b400', '#4f9a4a', '#3f7fb5'];
  function flagRows(flag, t) {
    if (flag === 'rainbow') { var o = Math.floor((t || 0) * 1.5) % 4; return [0, 1, 2, 3].map(function (i) { return FLAG_RAINBOW[(i + o) % 4]; }); }
    if (flag === 'glow') return ['#d8ff7a', '#c6ff4a', '#c6ff4a', '#9fe01f'];
    var col = typeof flag === 'string' && flag.charAt(0) === '#' ? flag : '#f0b400';
    return [col, col, col, lerpColor(col, '#17180f', 0.25)];
  }
  function drawFlag(ctx, flag, x, y, scale, dark, t) {
    if (!ctx) return false;
    scale = scale || 1; dark = dark || 0;
    var rows = flagRows(flag, t), special = flag === 'glow', wave = Math.floor((t || 0) * 3) % 2;
    if (special && dark > 0.3) { ctx.fillStyle = 'rgba(198, 255, 74, ' + (0.18 + 0.12 * Math.sin((t || 0) * 3)).toFixed(2) + ')'; ctx.fillRect(x - scale, y - scale, 7 * scale, 6 * scale); }
    rows.forEach(function (col, i) {
      ctx.fillStyle = special ? col : lerpColor(col, '#17180f', dark * (flag === 'rainbow' ? 0.25 : 0.45));
      ctx.fillRect(x, y + i * scale, 4 * scale, scale);
      ctx.fillRect(x + 4 * scale, y + (i + (wave ? 0 : 0)) * scale + (i === 0 && wave ? scale : 0), scale, i === 3 && wave ? 0 : scale);      // 끝 한 칸이 펄럭인다
    });
    return true;
  }
  /** 같은 구역이면 언제나 같은 배경이 나오도록 하는 작은 난수기. */
  function seeded(seed) {
    var s = (seed * 9301 + 49297) % 233280;
    return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  }

  /* ---------- 배경 ---------- */
  /** 하늘: 8단 띠 사이를 점 무늬로 이어 부드럽게 보이게 하고, 해(또는 달과 별)와 흘러가는 구름을 그린다. */
  function drawSky(ctx, model, view, sky) {
    var W = model.W, t = model.time, i, x;
    for (i = 0; i < 8; i++) {
      ctx.fillStyle = lerpColor(sky.top, sky.bottom, i / 7); ctx.fillRect(0, i * 8, W, 8);
      if (i === 7) break;
      ctx.fillStyle = lerpColor(sky.top, sky.bottom, (i + 1) / 7); // 아래 띠의 색을 위 띠 끝에 섞는다
      for (x = i % 2; x < W; x += 2) ctx.fillRect(x, i * 8 + 7, 1, 1);
      for (x = (i % 2) * 2; x < W; x += 4) ctx.fillRect(x, i * 8 + 6, 1, 1);
    }
    if (sky.dark > 0.6) {
      var star = seeded(77);
      ctx.fillStyle = '#e6e5db';
      for (i = 0; i < 30; i++) { var sx = Math.floor(star() * W), sy = Math.floor(star() * 40); if ((i + Math.floor(t * 2)) % 7) ctx.fillRect(sx, sy, 1, 1); }
      // 달의 자리(2.2.0): 방벽 바로 위, 거점과 먼 건물 사이의 빈 하늘. 전에는 오른쪽 맨 위(W-62, 10)에 있어서
      // 휴대폰에서는 그림의 윗부분이 잘려 달이 아예 보이지 않았고, 위험 단계 딱지와도 겹치는 자리였다.
      var mx = model.wall - 8, my = 22;
      if (sky.tier >= 4) {          // 붉은 보름달: 둘레에 붉은 빛이 번진다
        glow(ctx, mx + 4, my + 4, 11, '216,69,47', 0.07);
        ctx.fillStyle = '#d8452f'; ctx.fillRect(mx, my + 1, 8, 6); ctx.fillRect(mx + 1, my, 6, 8);
        ctx.fillStyle = '#a32c22'; ctx.fillRect(mx + 2, my + 2, 2, 2); ctx.fillRect(mx + 5, my + 5, 1, 1);
      } else {
        if (sky.tier >= 2) ctx.fillStyle = '#d8452f';      // 붉은 초승달
        // 초승달: 줄마다 [시작 칸, 너비]. 전에는 네모에서 네모를 파내 ㄴ자로 보였다
        [[2, 3], [1, 2], [0, 2], [0, 2], [1, 2], [2, 3]].forEach(function (r, ri) { ctx.fillRect(mx + r[0], my + ri, r[1], 1); });
      }
    } else {
      var k = Math.min(1, view.t / 0.78), sunX = Math.round(70 + (W - 110) * k), sunY = Math.round(8 + 44 * k * k);
      ctx.fillStyle = 'rgba(255,240,190,0.16)'; ctx.fillRect(sunX - 4, sunY - 4, 15, 15); ctx.fillRect(sunX - 2, sunY - 2, 11, 11); // 햇무리
      if (sky.tier >= 2) { glow(ctx, sunX + 3, sunY + 3, 9 + sky.tier, '230,70,40', 0.07); ctx.fillStyle = sky.tier >= 4 ? '#c0392b' : '#e8623a'; ctx.fillRect(sunX, sunY + 1, 7, 5); ctx.fillRect(sunX + 1, sunY, 5, 7); }      // 위험 6단계부터: 연기에 가린 붉은 해
      else { ctx.fillStyle = lerpColor('#fff6c9', '#f08a3c', sky.dark * 1.6); ctx.fillRect(sunX, sunY, 7, 7); }
    }
    var cl = seeded(31), cloud = lerpColor('#f4f1e4', '#343a52', sky.dark);
    if (sky.tier) cloud = lerpColor(cloud, lerpColor('#6b4a44', '#3a1418', sky.dark), 0.25 + sky.tier * 0.15);      // 위험 단계: 구름이 연기 빛으로 탁해진다
    ctx.globalAlpha = 0.8; ctx.fillStyle = cloud;
    for (i = 0; i < 5; i++) {
      var cw = 14 + Math.floor(cl() * 18), cy = 5 + Math.floor(cl() * 22);
      var cx = Math.floor((cl() * (W + 60) + t * (1.5 + i * 0.6)) % (W + 60)) - 40;
      ctx.fillRect(cx, cy, cw, 3); ctx.fillRect(cx + 3, cy - 2, cw - 8, 2); ctx.fillRect(cx + 2, cy + 3, cw - 6, 1);
    }
    ctx.globalAlpha = 1;
    if (sky.tier >= 2) {      // 위험 6단계부터: 까마귀 떼가 하늘을 맴돈다(낮밤 없이)
      ctx.fillStyle = '#0d0a0a';
      for (i = 0; i < 2 + sky.tier * 2; i++) {
        var ca = t * (0.5 + (i % 3) * 0.12) + i * 1.9, ccx = W * (0.35 + (i % 4) * 0.15), kx = Math.round(ccx + Math.cos(ca) * (16 + i * 3)), ky = Math.round(30 + (i % 3) * 4 + Math.sin(ca) * 5), flap = Math.floor(t * 6 + i) % 2 ? -1 : 1;
        ctx.fillRect(kx, ky + flap, 1, 1); ctx.fillRect(kx + 1, ky, 1, 1); ctx.fillRect(kx + 2, ky + flap, 1, 1);
      }
    }
    if (sky.dark < 0.3) { // 낮에는 까마귀 두 마리가 지나간다
      ctx.fillStyle = '#17180f';
      for (i = 0; i < 2; i++) {
        var bx = Math.floor((t * (9 + i * 3) + i * 90) % (W + 40)) - 20, by = Math.round(12 + i * 7 + Math.sin(t * 2 + i) * 2), up = Math.floor(t * 5 + i) % 2 ? -1 : 1;
        ctx.fillRect(bx, by + up, 1, 1); ctx.fillRect(bx + 1, by, 1, 1); ctx.fillRect(bx + 2, by + up, 1, 1);
      }
    }
  }

  /**
   * 건물은 두 겹이다. 먼 겹은 하늘빛에 흐려 놓고(구역마다 모양이 다르다) 가까운 겹은 더 어둡고 낮게 그려
   * 거리감이 생기게 한다. 그 사이로 전봇대와 늘어진 전선이 지나간다.
   */
  function drawSkyline(ctx, model, view, sky) {
    var W = model.W, wall = model.wall, i, x;
    var solid = lerpColor('#6c7c80', '#0b0d14', sky.dark);
    var far = lerpColor(solid, sky.bottom, 0.38), rnd = seeded(view.zone + 3);
    ctx.fillStyle = far; x = wall + 8;
    while (x < W) {
      var bw = 9 + Math.floor(rnd() * 13), bh = 12 + Math.floor(rnd() * (view.zone === 1 ? 8 : view.zone === 6 ? 6 : 26));
      ctx.fillRect(x, GROUND - bh, bw, bh);
      if (view.zone === 0) { for (i = 0; i < bw / 2; i++) ctx.fillRect(x + i, GROUND - bh - i - 1, bw - i * 2, 1); }      // 주택가: 박공지붕
      if (view.zone === 1 && rnd() > 0.3) { ctx.fillStyle = lerpColor('#b8762f', '#1a1410', sky.dark); ctx.fillRect(x - 1, GROUND - bh, bw + 2, 2); ctx.fillStyle = far; } // 시장: 차양
      if (view.zone === 2 && rnd() > 0.5) ctx.fillRect(x + 2, GROUND - bh - 12, 3, 12);                                    // 공단: 굴뚝
      if (view.zone === 3 && rnd() > 0.6) ctx.fillRect(x - 3, GROUND - 14, bw + 6, 2);                                     // 환승역: 승강장 지붕
      if (view.zone === 4 && bh > 22) { ctx.fillStyle = lerpColor('#a8261b', '#3a1310', sky.dark); ctx.fillRect(x + 3, GROUND - bh + 3, 3, 1); ctx.fillRect(x + 4, GROUND - bh + 2, 1, 3); ctx.fillStyle = far; } // 병원: 십자
      if (rnd() > 0.5) { ctx.fillStyle = sky.bottom; ctx.fillRect(x + 2 + Math.floor(rnd() * (bw - 4)), GROUND - bh, 2, 3); ctx.fillStyle = far; } // 무너진 귀퉁이
      x += bw + 2 + Math.floor(rnd() * 6);
    }
    if (view.zone === 5) { // 강변 검문소: 다리 트러스
      for (x = wall + 20; x < W; x += 8) ctx.fillRect(x, GROUND - 28 + ((x / 8) % 2 ? 0 : 4), 1, 8);
      ctx.fillRect(wall + 20, GROUND - 29, W, 1); ctx.fillRect(wall + 20, GROUND - 20, W, 2);
    }
    // 송신탑: 구역을 넘어갈수록 가까워져 커진다. 꼭대기의 붉은 불은 항상 깜빡인다.
    var th = 12 + view.zone * 7, tx = W - 16;
    ctx.fillStyle = solid;
    ctx.fillRect(tx, GROUND - th, 1, th);
    for (i = 4; i < th; i += 5) { var half = Math.ceil((th - i) / 9) + 1; ctx.fillRect(tx - half, GROUND - i, half * 2 + 1, 1); }
    if (Math.floor(model.time * 1.3) % 2) { ctx.fillStyle = '#e0392b'; ctx.fillRect(tx - 1, GROUND - th - 2, 3, 2); }
    // 전봇대와 전선(먼 겹과 가까운 겹 사이)
    var wire = lerpColor('#3a3d38', '#05060a', sky.dark), px, prev = -1;
    ctx.fillStyle = wire;
    for (px = wall + 30; px < W + 60; px += 62) {
      ctx.fillRect(px, GROUND - 24, 1, 24); ctx.fillRect(px - 2, GROUND - 22, 5, 1);
      if (prev >= 0) for (x = prev; x <= px; x += 2) { var u = (x - prev) / (px - prev); ctx.fillRect(x, Math.round(GROUND - 22 + 16 * u * (1 - u)), 1, 1); } // 늘어진 전선
      prev = px;
    }
    // 가까운 겹: 낮고 어두운 폐허, 깨진 창
    var near = lerpColor('#4c5a5e', '#06070c', sky.dark), hole = lerpColor('#2e383b', '#020308', sky.dark), r2 = seeded(view.zone + 41);
    x = wall + 14;
    while (x < W) {
      var w2 = 12 + Math.floor(r2() * 16), h2 = 5 + Math.floor(r2() * 11);
      ctx.fillStyle = near; ctx.fillRect(x, GROUND - h2, w2, h2);
      if (r2() > 0.4) ctx.fillRect(x + Math.floor(r2() * (w2 - 3)), GROUND - h2 - 2, 3, 2); // 삐죽 남은 벽
      ctx.fillStyle = hole;
      for (i = 2; i < w2 - 2; i += 4) if (r2() > 0.35 && h2 > 6) ctx.fillRect(x + i, GROUND - h2 + 2, 2, 2);
      x += w2 + 6 + Math.floor(r2() * 22);
    }
  }

  /** 땅: 거점 안은 흙바닥, 방벽 밖은 보도 턱과 차선이 남은 아스팔트 도로. */
  function drawGround(ctx, model, view, sky) {
    var W = model.W, wall = model.wall, i, x, dirt = seeded(11);
    ctx.fillStyle = lerpColor('#8d8973', '#24251f', sky.dark); ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = lerpColor('#77735f', '#1a1b16', sky.dark);
    for (i = 0; i < 30; i++) ctx.fillRect(Math.floor(dirt() * (wall + 4)), GROUND + 2 + Math.floor(dirt() * 13), 2, 1);
    ctx.fillStyle = lerpColor('#a09c88', '#2c2d27', sky.dark); ctx.fillRect(wall + 4, GROUND, W, 2);            // 보도 턱
    ctx.fillStyle = lerpColor('#6a685f', '#191a17', sky.dark); ctx.fillRect(wall + 4, GROUND + 2, W, H - GROUND - 2); // 아스팔트
    ctx.fillStyle = lerpColor('#57554d', '#111210', sky.dark);
    for (i = 0; i < W / 4; i++) ctx.fillRect(wall + 6 + Math.floor(dirt() * (W - wall)), GROUND + 3 + Math.floor(dirt() * 12), 1 + Math.floor(dirt() * 3), 1); // 갈라진 자국
    ctx.fillStyle = lerpColor('#cfc9a8', '#4a4838', sky.dark);
    for (x = wall + 12; x < W; x += 16) ctx.fillRect(x, GROUND + 9, 7, 1); // 차선
  }

  /** 길 위의 소품: 버려진 차, 꺼진 가로등, 그리고 구역마다 하나씩 있는 고유 소품. */
  function drawProps(ctx, model, view, sky) {
    var d = sky.dark, t = model.time, p = model.piles;
    function c(day, night) { return lerpColor(day, night, d * 0.9); }
    function r(col, x, y, w, h) { ctx.fillStyle = col; ctx.fillRect(Math.round(x), GROUND - y - h, w, h); }
    // 가로등(더미 사이마다)
    for (var i = 0; i < p.length - 1; i++) {
      var lx = Math.round((p[i] + p[i + 1]) / 2) + 9;
      r(c('#3a3d38', '#0a0b0d'), lx, 0, 1, 19); r(c('#3a3d38', '#0a0b0d'), lx - 3, 18, 4, 1); r(c('#c9c2a3', '#33322a'), lx - 4, 17, 2, 1);
    }
    // 버려진 차(첫 더미와 둘째 더미 사이)
    var cx = Math.round((p[0] + p[1]) / 2) - 10;
    r(c('#7d4f3f', '#241612'), cx, 2, 17, 4); r(c('#7d4f3f', '#241612'), cx + 4, 6, 9, 3);
    r(c('#2c343a', '#07090b'), cx + 5, 6, 3, 2); r(c('#2c343a', '#07090b'), cx + 9, 6, 3, 2);
    r('#17180f', cx + 2, 0, 3, 3); r('#17180f', cx + 12, 0, 3, 2); // 바퀴 하나는 주저앉았다
    // 구역 고유 소품(방벽 바로 밖)
    var zx = model.wall + 16;
    if (view.zone === 0) { r(c('#3a3d38', '#0a0b0d'), zx + 1, 0, 1, 5); r(c('#a8261b', '#3a1310'), zx - 1, 5, 5, 4); r(c('#e6e5db', '#55544c'), zx, 7, 3, 1); }           // 주택가: 우체통
    if (view.zone === 1) { r(c('#8a5a34', '#2a1c11'), zx - 2, 0, 12, 5); for (i = 0; i < 6; i++) r(i % 2 ? c('#e6e5db', '#55544c') : c('#b85a36', '#3a1c11'), zx - 3 + i * 2, 9, 2, 2); r(c('#3a3d38', '#0a0b0d'), zx - 2, 5, 1, 4); r(c('#3a3d38', '#0a0b0d'), zx + 9, 5, 1, 4); } // 시장: 좌판
    if (view.zone === 2) { for (i = 0; i < 3; i++) { r(c('#f0b400', '#4a3a08'), zx + i * 5, 0, 4, 6); r('#17180f', zx + i * 5, 2, 4, 1); } }                               // 공단: 드럼통
    if (view.zone === 3) { r(c('#3a3d38', '#0a0b0d'), zx + 3, 0, 1, 14); r(c('#2f4f8f', '#12203c'), zx, 13, 7, 5); r(c('#e6e5db', '#55544c'), zx + 2, 14, 3, 3); r(c('#57554d', '#111210'), zx - 3, 0, 14, 2); } // 환승역: 역 표지와 계단 입구
    if (view.zone === 4) { r(c('#e6e5db', '#4a4a45'), zx - 2, 2, 16, 7); r(c('#a8261b', '#3a1310'), zx + 3, 4, 4, 1); r(c('#a8261b', '#3a1310'), zx + 4, 3, 2, 3); r(c('#2c343a', '#07090b'), zx + 10, 5, 3, 3); r('#17180f', zx, 0, 3, 3); r('#17180f', zx + 9, 0, 3, 3); } // 병원: 구급차
    if (view.zone === 5) { r(c('#57554d', '#111210'), zx - 2, 0, 7, 10); r(c('#2c343a', '#07090b'), zx, 5, 3, 3); r(c('#3a3d38', '#0a0b0d'), zx + 7, 0, 1, 8); for (i = 0; i < 7; i++) r(i % 2 ? c('#e6e5db', '#55544c') : c('#a8261b', '#3a1310'), zx + 8 + i * 2, 8 + i, 2, 1); } // 검문소: 초소와 올라간 차단기
    if (view.zone === 6) { r(c('#57554d', '#111210'), zx - 2, 0, 12, 8); r(c('#2c343a', '#07090b'), zx + 1, 3, 3, 3); r(c('#c9c2a3', '#4a4738'), zx + 5, 8, 6, 1); r(c('#c9c2a3', '#4a4738'), zx + 6, 9, 4, 2); if (Math.floor(t * 2) % 2) r('#e0392b', zx + 7, 11, 1, 1); } // 송신탑: 송신소 건물과 접시
    /*
     * 7구역 정착지(3.1.0): 길가에 터가 셋 있다(식량 · 의료 · 경비). 줄을 따라 지을수록 그 터의 건물이 커진다.
     *   화면이 좁아(방벽 밖은 60칸쯤) 아홉 채를 늘어놓을 수 없어서, 터마다 가장 나중에 지은 건물을 그린다. 밤에는 창에 불이 켜진다.
     */
    if (view.zone === 6 && view.settle) {
      var st = view.settle, gap = Math.max(15, Math.floor((model.W - model.wall - 34) / 3)), sx = model.wall + 30, lit = d > 0.5 ? '#ffe9a0' : c('#2c343a', '#07090b'), k;
      var cross = function (x, y) { r(c('#b8402e', '#5a1f17'), x, y + 1, 3, 1); r(c('#b8402e', '#5a1f17'), x + 1, y, 1, 3); };
      // 식량: 텃밭 → 식당 → 창고
      if (st.store) { r(c('#6b4a2b', '#22170d'), sx, 0, 12, 10); r(c('#8a5a34', '#2a1c11'), sx - 1, 10, 14, 2); r('#17180f', sx + 4, 0, 4, 6); r(lit, sx + 1, 5, 2, 2); r(c('#c9a04a', '#4a3a1a'), sx - 4, 0, 3, 3); r(c('#8fc46a', '#2f4a22'), sx + 13, 0, 1, 3); r(c('#8fc46a', '#2f4a22'), sx + 15, 0, 1, 2); }
      else if (st.mess) { r(c('#c9a04a', '#4a3a1a'), sx, 0, 12, 7); r(c('#8a5a2a', '#2a1c0e'), sx - 1, 7, 14, 2); r(c('#8a5a2a', '#2a1c0e'), sx + 2, 9, 8, 1); r(lit, sx + 2, 2, 2, 2); r('#17180f', sx + 7, 0, 3, 5); r(c('#8fc46a', '#2f4a22'), sx + 13, 0, 1, 3); }
      else if (st.farm) { r(c('#4f7a3a', '#1c2c15'), sx, 0, 12, 2); for (k = 0; k < 4; k++) r(c('#8fc46a', '#2f4a22'), sx + 1 + k * 3, 2, 1, 2 + (k % 2)); }
      sx += gap;
      // 의료: 진료소 → 실험동 → 격리동
      if (st.ward) { r(c('#d7dde0', '#4a5258'), sx, 0, 13, 14); r(c('#9aa7a5', '#2c3336'), sx - 1, 14, 15, 1); cross(sx + 5, 10); r(lit, sx + 1, 7, 2, 2); r(lit, sx + 10, 7, 2, 2); r(lit, sx + 1, 3, 2, 2); r(c('#7fe0f0', '#2a5a66'), sx + 10, 3, 2, 2); r('#17180f', sx + 5, 0, 3, 4); for (k = 0; k < 2; k++) { r(c('#3a3d38', '#0a0b0d'), sx - 3 - k * 2, 0, 1, 4); r(c('#3a3d38', '#0a0b0d'), sx + 14 + k * 2, 0, 1, 4); } }
      else if (st.lab7) { r(c('#d7dde0', '#4a5258'), sx, 0, 12, 12); r(c('#9aa7a5', '#2c3336'), sx - 1, 12, 14, 1); cross(sx + 5, 8); r(lit, sx + 1, 5, 2, 2); r(c('#7fe0f0', '#2a5a66'), sx + 9, 5, 2, 2); r('#17180f', sx + 5, 0, 3, 4); }
      else if (st.clinic) { r(c('#e6e5db', '#55544c'), sx, 0, 12, 8); r(c('#c9c2a3', '#33322a'), sx - 1, 8, 14, 1); cross(sx + 5, 4); r(lit, sx + 1, 3, 2, 2); r('#17180f', sx + 8, 0, 3, 4); }
      sx += gap;
      // 경비: 경비대 → 망루 → 학교
      if (st.guard7) { r(c('#8a7a5a', '#2a2418'), sx - 2, 0, 5, 2); r(c('#8a7a5a', '#2a2418'), sx - 1, 2, 3, 1); }
      if (st.watch) { r(c('#3a3d38', '#0a0b0d'), sx + 4, 0, 1, 15); r(c('#3a3d38', '#0a0b0d'), sx + 9, 0, 1, 15); r(c('#57554d', '#111210'), sx + 3, 15, 8, 1); r(c('#6b4a2b', '#22170d'), sx + 3, 16, 8, 4); r(lit, sx + 6, 17, 2, 2); r(c('#3a3d38', '#0a0b0d'), sx + 2, 20, 10, 1); }
      else if (st.guard7) { r('#17180f', sx + 5, 0, 1, 11); r(Math.floor(t * 2) % 2 ? c('#f0b400', '#6a5008') : c('#d89a00', '#5a4406'), sx + 6, 8, 4, 3); }
      if (st.school) { r(c('#d8b24a', '#4a3c16'), sx + 12, 0, 12, 8); r(c('#8a3a2a', '#2e120c'), sx + 11, 8, 14, 2); r(c('#f0b400', '#6a5008'), sx + 17, 10, 2, 2); r(lit, sx + 13, 3, 3, 3); r(lit, sx + 20, 3, 3, 3); r('#17180f', sx + 17, 0, 3, 4); }
    }
  }

  /** 화면 맨 앞의 풀 무더기: 가장 어둡게 그려 앞쪽에 있는 것처럼 보이게 한다. */
  function drawForeground(ctx, model, view, sky) {
    var g = seeded(53), W = model.W, x = 0;
    ctx.fillStyle = lerpColor('#39452b', '#0a0d08', sky.dark);
    while (x < W) {
      var gh = 1 + Math.floor(g() * 3);
      ctx.fillRect(x, H - gh, 1, gh); ctx.fillRect(x + 1, H - gh - 1, 1, gh + 1); ctx.fillRect(x + 2, H - gh + 1, 1, Math.max(1, gh - 1));
      x += 3 + Math.floor(g() * 9);
    }
  }

  /**
   * 위험 단계의 먼 불길: 건물 사이에서 불빛이 일렁이고 연기 기둥이 바람에 기울어 오른다.
   * 불은 1·2·3·5곳으로 늘고 묶음이 오를수록 불꽃도 크다. 자리는 구역마다 정해져 있어 매번 같은 곳에서 탄다.
   */
  function drawDangerFires(ctx, model, view, sky) {
    if (!sky.tier) return;
    var W = model.W, t = model.time, rnd = seeded(view.zone * 7 + 19), n = sky.tier >= 4 ? 5 : sky.tier, big = sky.tier - 1, i, j;
    var span = Math.max(40, W - model.wall - 60);
    for (i = 0; i < n; i++) {
      var fx = Math.round(model.wall + 40 + (i + 0.2 + rnd() * 0.6) * span / n), fy = GROUND - 6 - Math.floor(rnd() * 8);
      var flick = Math.floor(t * 7 + i * 3) % 3;
      glow(ctx, fx, fy + 2, 10 + big * 2 + flick, '240,120,40', 0.12 + 0.06 * sky.dark, true);
      ctx.fillStyle = '#d8452f'; ctx.fillRect(fx - 3, fy - big, 6, 2 + big);      // 불꽃: 붉은 바깥, 주황, 노란 속
      ctx.fillStyle = '#f08a3c'; ctx.fillRect(fx - 2, fy - 1 - big - flick, 4, 3 + big + flick); ctx.fillRect(fx - 1 + (flick - 1), fy - 3 - big - flick, 2, 2);
      ctx.fillStyle = '#ffd36a'; ctx.fillRect(fx - 1, fy - (flick ? 1 : 0), 2, 2);
      for (j = 0; j < 9; j++) {      // 연기: 위로 갈수록 넓고 옅다
        var sy = fy - 5 - j * 4, lean = Math.round(j * j * 0.22 + Math.sin(t * 0.8 + j * 0.7 + i) * 1.5);
        if (sy < 2) break;
        ctx.fillStyle = 'rgba(' + (sky.dark > 0.5 ? '40,26,30' : '58,46,44') + ',' + (0.62 - j * 0.05).toFixed(3) + ')';
        ctx.fillRect(fx - 1 - Math.floor(j / 2) + lean, sy, 3 + j, 4);
      }
    }
  }
  /**
   * 위험 단계의 재와 불티: 재는 1묶음부터 비스듬히 내리고(묶음이 오를수록 많다), 불티는 2묶음부터 아래에서 위로 오른다.
   * 날씨처럼 상태를 두지 않고 시간에서 자리를 계산한다. 흔들림을 끈 설정(still)이어도 그리되, 그때는 양을 반으로 줄인다.
   */
  function drawDangerAir(ctx, model, view, sky) {
    if (!sky.tier) return;
    var W = model.W, t = model.time, rnd = seeded(23), i, less = view.still ? 0.5 : 1;
    // 붉은 기운: 화면 전체에 엷게 덮는다. 낮에도 달라진 것이 한눈에 보이게 하는 것이 목적이다
    ctx.fillStyle = 'rgba(150,40,20,' + (0.04 + 0.03 * sky.tier).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H);
    if (sky.tier >= 3) {      // 가장자리 어둠: 양옆과 아래가 검붉게 죈다
      for (i = 0; i < 8; i++) { ctx.fillStyle = 'rgba(40,4,6,' + ((0.05 + 0.03 * (sky.tier - 3)) * (8 - i) / 3).toFixed(3) + ')'; ctx.fillRect(i * 2, 0, 2, H); ctx.fillRect(W - 2 - i * 2, 0, 2, H); if (i < 4) ctx.fillRect(0, H - 1 - i, W, 1); }
    }
    // 붉은 번개(16단계부터): 9초쯤마다 하늘이 잠깐 번쩍인다. 흔들림을 끈 설정이면 치지 않는다
    if (sky.tier >= 4 && !view.still) { var lp = (t + 3) % 9; if (lp < 0.12 || (lp > 0.25 && lp < 0.32)) { ctx.fillStyle = 'rgba(255,90,70,0.14)'; ctx.fillRect(0, 0, W, GROUND); } }
    var ash = Math.floor(W / 9 * sky.tier * less);
    ctx.fillStyle = sky.dark > 0.5 ? 'rgba(150,140,140,0.55)' : 'rgba(70,64,60,0.5)';
    for (i = 0; i < ash; i++) {
      var ax = (rnd() * W + t * (5 + (i % 3) * 2) + Math.sin(t * 0.9 + i) * 2 + W) % W, ay = (rnd() * H + t * (6 + (i % 4))) % (GROUND + 4);
      ctx.fillRect(Math.round(ax), Math.round(ay), i % 5 ? 1 : 2, 1);      // 다섯에 하나는 큰 재
    }
    if (sky.tier >= 2) {
      var emb = Math.floor(W / 16 * (sky.tier - 1) * less);
      for (i = 0; i < emb; i++) {
        var life = (rnd() + t * (0.10 + (i % 5) * 0.02)) % 1;      // 0 땅 ~ 1 하늘: 오를수록 사그라든다
        var ex = (rnd() * W + life * 26 + Math.sin(t * 2 + i) * 2) % W, ey = GROUND + 4 - life * (GROUND - 6);
        ctx.fillStyle = 'rgba(' + (i % 3 ? '255,150,60' : '255,210,110') + ',' + (0.9 * (1 - life)).toFixed(3) + ')';
        ctx.fillRect(Math.round(ex), Math.round(ey), 1, 1);
      }
    }
  }

  function drawBackdrop(ctx, model, view, sky) {
    drawSky(ctx, model, view, sky);
    drawSkyline(ctx, model, view, sky);
    drawDangerFires(ctx, model, view, sky);
    drawGround(ctx, model, view, sky);
    drawProps(ctx, model, view, sky);
  }

  function drawBase(ctx, model, view, sky) {
    var d = view.def || {}, t = model.time;
    var kinds = ['wire', 'tower', 'turret', 'flame', 'emp', 'rail'].filter(function (k) { return d[k] > 0; }).length;
    var night = sky.dark > 0.5;
    // 무전 안테나: 구조 신호가 오면 노랗게 깜빡인다
    ctx.fillStyle = '#17180f'; ctx.fillRect(8, GROUND - 22, 1, 22); ctx.fillRect(6, GROUND - 18, 5, 1);
    if (view.signal && Math.floor(t * 4) % 2) { ctx.fillStyle = '#f0b400'; ctx.fillRect(7, GROUND - 25, 3, 3); }
    // 천막: 거점 건물이 서면(1단계부터) 걷는다. 그 자리는 건물 1층의 창고가 된다
    var i;
    if (baseStage(Math.max(totalFacilities(view), view.zoneBuilding > 0 ? 1 : 0)) < 1) {
      ctx.fillStyle = lerpColor('#5d6b4a', '#1e241a', sky.dark);
      for (i = 0; i < 10; i++) ctx.fillRect(16 + i, GROUND - 1 - i, 22 - i * 2, 1);
      ctx.fillStyle = '#17180f'; ctx.fillRect(25, GROUND - 6, 4, 6);
    }
    // 모닥불(밤에는 주변이 따뜻하게 밝아진다)
    if (sky.dark > 0.4) {
      glow(ctx, 42, GROUND - 1, 15, '240,170,70', 0.055, true); // 네모난 빛이 안개처럼 보여서 둥근 빛으로 바꿨다
    }
    ctx.fillStyle = '#3c3a34'; ctx.fillRect(40, GROUND - 1, 5, 1);
    ctx.fillStyle = Math.floor(t * 8) % 2 ? '#f0b400' : '#e0602b'; ctx.fillRect(41, GROUND - 3 - (Math.floor(t * 6) % 2), 3, 3);
    if (view.buff) { ctx.fillStyle = '#f0b400'; ctx.fillRect(30 + Math.floor(t * 20) % 8, GROUND - 30 + Math.floor(t * 30) % 20, 2, 2); } // 지원 물자 낙하
    // 방벽: 방어 수단의 종류가 늘수록 높아지고 철판으로 바뀐다
    var wh = 7 + kinds * 3, wx = model.wall + (model.shake > 0 ? (Math.floor(t * 30) % 2 ? 1 : -1) : 0);
    var tw = model.wall - 10; // 감시탑 기둥 위치
    drawWall(ctx, view, sky, wx, wh, kinds);
    if (d.wire > 0) { ctx.fillStyle = '#c9c2a3'; for (i = 0; i < 6; i++) ctx.fillRect(wx - 1 + i, GROUND - wh - 1 - (i % 2), 1, 1); }
    if (d.tower > 0) {
      ctx.fillStyle = lerpColor('#5b4630', '#1c160f', sky.dark);
      ctx.fillRect(tw, GROUND - 30, 2, 30); ctx.fillRect(tw - 4, GROUND - 31, 10, 2); ctx.fillRect(tw - 4, GROUND - 36, 1, 5); ctx.fillRect(tw + 5, GROUND - 36, 1, 5);
      ctx.fillStyle = '#17180f'; ctx.fillRect(tw, GROUND - 37, 3, 6);               // 경계병
      if (night) { for (i = 0; i < 26; i++) { ctx.fillStyle = 'rgba(240,220,150,' + (0.11 - i * 0.003).toFixed(3) + ')'; ctx.fillRect(tw + 6 + i * 2, GROUND - 33 + Math.floor(i * 1.1), 2, 4 + Math.floor(i / 3)); } } // 탐조등: 멀어질수록 옅어진다
    }
    if (d.turret > 0) { ctx.fillStyle = '#30343c'; ctx.fillRect(wx, GROUND - wh - 4, 4, 3); ctx.fillRect(wx + 4, GROUND - wh - 3, d.rail > 0 ? 9 : 4, 1); }
    if (d.flame > 0 && night) { ctx.fillStyle = Math.floor(t * 9) % 2 ? '#f0b400' : '#e0602b'; for (i = 0; i < 4; i++) ctx.fillRect(wx + 5 + i * 3, GROUND - 2 - ((i + Math.floor(t * 7)) % 3), 2, 3); }
    drawZoneDefense(ctx, model, view, sky, wx, wh);
    drawLead(ctx, model, view, sky, wx, wh);
    if (d.emp > 0 && Math.floor(t * 5) % 3 === 0) { ctx.fillStyle = '#7fe0f0'; ctx.fillRect(wx + 1 + Math.floor(t * 13) % 4, GROUND - wh - 6 - Math.floor(t * 17) % 4, 1, 2); }
  }

  /*
   * 방벽의 생김새: 가장 멀리 연 구역에 따라 재료가 달라진다(높이는 전과 같이 방어 수단의 종류 수로 정한다).
   *   0 주택가 판자 울타리, 1 시장 좌판 상자와 천막, 2 공단 철판과 경고 띠, 3 환승역 콘크리트와 침목,
   *   4 병원 흰 격리 패널과 모래주머니, 5 이후 콘크리트 차단벽. 모르는 구역은 마지막 것.
   */
  var WALL_STYLES = ['plank', 'crate', 'steel', 'tie', 'panel', 'concrete'];
  function wallStyle(zone) {
    var z = typeof zone === 'number' && isFinite(zone) && zone > 0 ? Math.floor(zone) : 0;
    return WALL_STYLES[Math.min(z, WALL_STYLES.length - 1)];
  }
  function drawWall(ctx, view, sky, wx, wh, kinds) {
    var style = wallStyle(view.zone), top = GROUND - wh, i;
    function c(day, night) { return lerpColor(day, night, sky.dark * 0.85); }
    function r(col, x, y, w, h) { ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), w, h); }
    var dark = c('#17180f', '#0b0c08');
    if (style === 'plank') {                 // 판자: 높이가 들쭉날쭉한 널빤지 넷, 가로 버팀목, 못
      for (i = 0; i < 4; i++) r(c(i % 2 ? '#8a6a44' : '#7a5a36', i % 2 ? '#332618' : '#2a1f14'), wx + i, top - (i % 2 ? 1 : 0) - (i === 2 ? 1 : 0), 1, wh + (i % 2 ? 1 : 0) + (i === 2 ? 1 : 0));
      r(c('#5b4630', '#1c160f'), wx - 1, top + 2, 6, 1); r(c('#5b4630', '#1c160f'), wx - 1, GROUND - 3, 6, 1);
      r(c('#c9c2a3', '#5a5648'), wx + 1, top + 2, 1, 1); r(c('#c9c2a3', '#5a5648'), wx + 3, GROUND - 3, 1, 1);
      r(c('#5b4630', '#1c160f'), wx - 3, GROUND - 4, 1, 4); r(c('#5b4630', '#1c160f'), wx - 2, GROUND - 5, 1, 2);        // 안쪽 버팀목
    } else if (style === 'crate') {          // 좌판 상자: 쌓은 궤짝, 맨 위에 줄무늬 천막
      for (i = 0; i < wh; i += 4) { r(c(i % 8 ? '#9a6a3a' : '#8a5a34', '#35241a'), wx - 1, GROUND - i - 4, 6, 4); r(c('#5b3d22', '#1c130b'), wx - 1, GROUND - i - 4, 6, 1); r(c('#5b3d22', '#1c130b'), wx + 2, GROUND - i - 4, 1, 4); }
      for (i = 0; i < 4; i++) r(i % 2 ? c('#e6e5db', '#6a6960') : c('#b8402e', '#4a1a14'), wx - 2 + i * 2, top - 2, 2, 2);
    } else if (style === 'steel') {          // 철판: 리벳과 노랑·검정 경고 띠
      r(c('#7b8186', '#2c3035'), wx, top, 4, wh); r(c('#5d6266', '#1c1f23'), wx + 3, top, 1, wh);
      for (i = 2; i < wh - 2; i += 3) { r(dark, wx, GROUND - i, 1, 1); r(dark, wx + 2, GROUND - i - 1, 1, 1); }
      for (i = 0; i < 4; i++) r(i % 2 ? dark : c('#f0b400', '#8a6a08'), wx + i, top, 1, 2);
      r(c('#5d6266', '#1c1f23'), wx - 2, GROUND - 6, 2, 6);                                                              // 안쪽 지지대
    } else if (style === 'tie') {            // 환승역: 콘크리트 기둥에 침목을 가로로 덧대고, 위에 역 표지
      r(c('#8f8b80', '#2a2925'), wx, top, 4, wh);
      for (i = 2; i < wh; i += 3) r(c('#4a3a2a', '#17120c'), wx - 1, GROUND - i - 1, 6, 1);
      r(c('#f0b400', '#8a6a08'), wx - 1, top - 3, 6, 3); r(dark, wx, top - 2, 4, 1);
    } else if (style === 'panel') {          // 병원: 흰 격리 패널과 붉은 십자, 발치의 모래주머니
      r(c('#d9d8cf', '#55554e'), wx, top, 4, wh); r(c('#b9b8ab', '#3c3c36'), wx, top, 4, 1);
      for (i = 5; i < wh; i += 5) r(c('#9a9a94', '#2e2e2a'), wx, GROUND - i, 4, 1);
      if (wh >= 9) { r(c('#a8261b', '#5a1a14'), wx + 1, top + 2, 2, 4); r(c('#a8261b', '#5a1a14'), wx, top + 3, 4, 2); }
      r(c('#a89a72', '#3a3526'), wx - 3, GROUND - 2, 3, 2); r(c('#a89a72', '#3a3526'), wx + 4, GROUND - 2, 3, 2); r(c('#8a7d58', '#2a2619'), wx - 2, GROUND - 4, 3, 2);
    } else {                                 // 콘크리트 차단벽: 아래가 넓고 붉은 띠
      r(c('#8d8a80', '#2a2925'), wx, top, 4, wh); r(c('#6f6c63', '#1f1e1b'), wx - 1, GROUND - 3, 6, 3);
      r(c('#a8261b', '#3a1310'), wx, top + 2, 4, 1); r(c('#e6e5db', '#55544c'), wx, top + 3, 4, 1);
    }
    if (kinds >= 3 && style !== 'steel') { r(c('#7b8186', '#2c3035'), wx + 3, top + 1, 1, wh - 1); }                       // 방어 수단이 많으면 바깥쪽에 철판을 덧댄다
  }

  /**
   * 그날의 주 무기: 방벽 위(또는 앞)에 다른 무기보다 크게 세운다. 낮에도 보이므로 오늘 밤 무엇이 앞장서는지 미리 알 수 있다.
   * 싸우는 동안에는 저마다 움직인다(포신 반동, 불씨, 코일의 불꽃, 충전 빛).
   */
  function drawLead(ctx, model, view, sky, wx, wh) {
    var d = view.def || {}, lead = leadWeapon(WEAPONS.filter(function (w) { return d[w.id] > 0; }), view.day, d);
    if (!lead) return;
    var t = model.time, top = GROUND - wh, fight = !!view.battle, tick = Math.floor(t * 8) % 2, i;
    function c(day, night) { return lerpColor(day, night, sky.dark * 0.8); }
    function r(col, x, y, w, h) { ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), w, h); }
    // 밤하늘에 묻히지 않게 밤에는 몸통과 포신을 밝은 쇠 빛으로 그린다(낮에는 어두운 윤곽)
    var steel = c('#4a4f57', '#737a85'), dark = c('#17180f', '#9aa1ab'), warn = c('#f0b400', '#d9a400');
    if (lead.id === 'tower') {           // 감시탑: 지붕과 방탄판을 단 큰 망루, 저격수의 긴 총
      var tw = model.wall - 10;
      r(c('#6b4a2b', '#241a10'), tw - 6, GROUND - 40, 14, 2); r(c('#8a5a34', '#7a5a3a'), tw - 5, GROUND - 41, 12, 1);   // 지붕
      r(steel, tw - 5, GROUND - 35, 12, 4); r(warn, tw - 5, GROUND - 35, 12, 1);                                         // 방탄판
      r(dark, tw + 3, GROUND - 37, 9, 1);                                                                                // 총
      if (fight && tick) r('#ffe9a0', tw + 12, GROUND - 38, 2, 3);
    } else if (lead.id === 'turret') {   // 자동 포탑: 쌍열 포신. 싸울 때 포신이 번갈아 물러난다
      r(steel, wx - 2, top - 8, 8, 6); r(dark, wx - 1, top - 2, 6, 2); r(warn, wx - 2, top - 8, 8, 1);
      r(dark, wx + 6 - (fight && tick ? 1 : 0), top - 7, 8, 1); r(dark, wx + 6 - (fight && !tick ? 1 : 0), top - 4, 8, 1);
      r(fight && tick ? '#e0392b' : '#7dff9a', wx, top - 6, 1, 1);
    } else if (lead.id === 'flame') {    // 화염 방벽: 연료통 둘과 분사구. 불씨가 늘 살아 있고, 싸울 때 바닥에 불길이 깔린다
      r(c('#a8261b', '#4a1410'), wx - 5, GROUND - 9, 3, 9); r(c('#a8261b', '#4a1410'), wx - 9, GROUND - 7, 3, 7); r(warn, wx - 5, GROUND - 6, 3, 1);
      r(steel, wx - 2, GROUND - 5, 9, 2); r(dark, wx + 7, GROUND - 6, 2, 4);
      r(tick ? '#f0b400' : '#e0602b', wx + 9, GROUND - 5, 1 + tick, 2);
      if (fight) for (i = 0; i < 7; i++) r((i + Math.floor(t * 9)) % 2 ? '#f0b400' : '#e0602b', wx + 10 + i * 2, GROUND - 2 - ((i + Math.floor(t * 7)) % 4), 2, 2 + ((i + Math.floor(t * 7)) % 4));
    } else if (lead.id === 'emp') {      // 전자기 울타리: 코일 기둥 둘. 사이로 불꽃이 튄다
      for (i = 0; i < 2; i++) {
        var cx = wx - 1 + i * 7;
        r(dark, cx, top - 12, 2, 12 + (i ? wh : 0)); for (var k = 0; k < 4; k++) r(c('#b87333', '#4a2e14'), cx - 1, top - 10 + k * 2, 4, 1);
        r(Math.floor(t * 6 + i) % 2 ? '#7fe0f0' : '#2f6f8f', cx - 1, top - 14, 4, 2);
      }
      if (fight || Math.floor(t * 3) % 4 === 0) for (i = 0; i < 4; i++) r('#7fe0f0', wx + 2 + i, top - 13 + ((i + Math.floor(t * 12)) % 3) - 1, 1, 1);
    } else if (lead.id === 'rail') {     // 레일건: 긴 두 줄 포신과 충전 빛. 싸울 때 빛이 포신을 따라 달린다
      r(steel, wx - 4, top - 9, 9, 7); r(warn, wx - 4, top - 9, 9, 1); r(dark, wx - 2, top - 2, 5, 2);
      r(dark, wx + 5, top - 8, 16, 1); r(dark, wx + 5, top - 5, 16, 1);
      for (i = 0; i < 4; i++) r(steel, wx + 7 + i * 4, top - 7, 1, 2);
      r(fight ? '#9ad0ff' : '#3f6f8f', wx + 5 + (fight ? Math.floor(t * 24) % 15 : 0), top - 7, 2, 2);
      r(Math.floor(t * 4) % 2 ? '#9ad0ff' : '#3f6f8f', wx - 3, top - 7, 2, 3);
    }
  }

  /**
   * 구역 고유 방벽: 가지고 있으면 방벽 바로 바깥(오른쪽)에 그 구역만의 구조물을 세운다.
   * wx 는 방벽의 x(흔들림 반영), wh 는 방벽 높이.
   */
  function drawZoneDefense(ctx, model, view, sky, wx, wh) {
    if (!(view.zoneDefense > 0)) return;
    var x = wx + 5, t = model.time, i;
    function c(day, night) { return lerpColor(day, night, sky.dark * 0.85); }
    function r(col, dx, y, w, h) { ctx.fillStyle = col; ctx.fillRect(Math.round(x + dx), GROUND - y - h, w, h); }
    if (view.zone === 0) { r(c('#8f3a2e', '#2e1410'), 0, 0, 11, 4); r(c('#6d2a20', '#22100c'), 2, 4, 6, 3); r('#17180f', 1, 0, 2, 1); r('#17180f', 8, 0, 2, 1); r(c('#9fc6d8', '#2a4658'), 3, 5, 4, 1); } // 주택가: 가로로 세운 폐차
    if (view.zone === 1) { for (i = 0; i < 3; i++) { r(c('#8a8f93', '#2c3035'), i * 4, 0, 3, 12); for (var k = 2; k < 12; k += 3) r(c('#5d6266', '#1c1f23'), i * 4, k, 3, 1); } }   // 시장: 셔터 세 장
    if (view.zone === 2) { r(c('#6d7479', '#24282c'), 0, 0, 10, 15); for (i = 0; i < 3; i++) r('#17180f', 1 + i * 3, 3 + i * 4, 2, 2); r(c('#f0b400', '#4a3a08'), 0, 15, 10, 1); }  // 공단: 강철 담장과 경고 띠
    if (view.zone === 3) { r('#17180f', 0, 0, 1, 13); r('#17180f', 9, 0, 1, 13); for (i = 0; i < 4; i++) r(i % 2 ? c('#f0b400', '#4a3a08') : '#17180f', 1, 2 + i * 3, 8, 2); }        // 환승역: 줄무늬 차단문
    if (view.zone === 4) { r(c('#d9d8cf', '#4a4a45'), 0, 0, 9, 14); r(c('#2c343a', '#07090b'), 2, 8, 5, 4); r(c('#a8261b', '#3a1310'), 3, 3, 3, 1); r(c('#a8261b', '#3a1310'), 4, 2, 1, 3); } // 병원: 격리 병동 문
    if (view.zone === 5) { r(c('#8d8a80', '#2a2925'), 0, 0, 12, 9); r(c('#a8261b', '#3a1310'), 0, 6, 12, 1); r(c('#e6e5db', '#55544c'), 0, 5, 12, 1); r(c('#6f6c63', '#1f1e1b'), 0, 0, 12, 2); } // 검문소: 콘크리트 차단벽
    if (view.zone === 6) { for (i = 0; i < 3; i++) r('#17180f', i * 5, 0, 1, 14); for (i = 0; i < 3; i++) r(c('#c9c2a3', '#4a4738'), 0, 4 + i * 4, 11, 1); if (Math.floor(t * 6) % 2) r('#7fe0f0', 2 + Math.floor(t * 11) % 8, 4 + (Math.floor(t * 7) % 3) * 4, 2, 1); } // 송신탑: 전류가 흐르는 울타리
  }

  /** 구역 고유 시설 하나를 x 위치에 그린다. r 은 바닥 기준 사각형 도우미(drawUpgrades 가 앞마당 바닥으로 넘긴다). */
  function drawZoneFacility(view, sky, x, r, c, t) {
    if (view.zone === 0) { r(c('#57554d', '#17160f'), x, 0, 6, 3); r('#17180f', x + 1, 3, 4, 1); if (Math.floor(t * 3) % 2) r('#d9d8cf', x + 2, 5, 1, 2); else r('#d9d8cf', x + 3, 6, 1, 2); }  // 취사장: 솥과 김
    if (view.zone === 1) { r(c('#8a5a34', '#2a1c11'), x, 0, 7, 3); r(c('#b85a36', '#3a1c11'), x - 1, 5, 9, 1); r(c('#e6e5db', '#55544c'), x + 1, 5, 2, 1); r('#17180f', x, 3, 1, 2); r('#17180f', x + 6, 3, 1, 2); } // 거래소: 차양 친 좌판
    if (view.zone === 2) { r(c('#6f6a60', '#22211d'), x, 0, 7, 5); r('#17180f', x + 5, 5, 2, 5); r(c('#9a9a94', '#33332f'), x + 5, 10 + Math.floor(t * 2) % 2, 2, 1); r('#f0b400', x + 1, 1, 2, 2); } // 프레스 공장: 굴뚝과 연기
    if (view.zone === 3) { r(c('#8f3a2e', '#2e1410'), x, 1, 8, 4); r('#17180f', x + 1, 0, 2, 1); r('#17180f', x + 5, 0, 2, 1); r(c('#57554d', '#17160f'), x - 1, 0, 10, 1); }                 // 화물차와 선로
    if (view.zone === 4) { r(c('#d9d8cf', '#4a4a45'), x, 0, 7, 6); r(c('#2c6638', '#16321c'), x + 3, 2, 1, 3); r(c('#2c6638', '#16321c'), x + 2, 3, 3, 1); }                                   // 약제실: 녹십자
    if (view.zone === 5) { r(c('#3f6f8f', '#162836'), x - 1, 0, 10, 1); r(c('#8a5a34', '#2a1c11'), x + 1, 1, 6, 2); r('#17180f', x + 4, 3, 1, 5); r(c('#e6e5db', '#55544c'), x + 5, 5, 2, 3); } // 나루터: 돛단배
    if (view.zone === 6) { r(c('#4a463f', '#151512'), x, 0, 7, 4); r('#17180f', x + 6, 4, 1, 4); r(Math.floor(t * 4) % 2 ? '#f0b400' : c('#c9c2a3', '#4a4738'), x + 1, 1, 2, 2); r('#17180f', x + 4, 1, 2, 1); } // 발전기: 깜빡이는 계기등
  }

  /*
   * 거점 건물: 거점 전체가 단계별로 다른 모습이 되고(통째로 바뀐다), 그 안이 단면으로 보인다(방마다 시설 하나).
   *
   *   단계(baseStage, 시설 합계 1·10·50·150·400곳에서 오른다)
   *     0 천막뿐  1 야영지(나무 뼈대와 천막 지붕)  2 판잣집(판자벽과 양철 지붕)
   *     3 거점(콘크리트, 옥상 난간과 깃발. 천막은 걷는다)  4 요새(철판, 총안과 탐조등)  5 도시(간판, 송신탑, 줄전등)
   *   구조
   *     1층은 창고(왼쪽 두 칸), 공용실(가운데 두 칸), 현관과 계단(오른쪽 한 칸). 주인공이 나른 물자는 창고에 쌓인다.
   *     사람은 1층 안에서 오가는 것처럼 보인다(1층 높이가 사람 키와 같다).
   *     그 위로 방이 두 층, 층마다 다섯 칸. 시설마다 정해진 방이 있고, 지으면 그 방에 불이 켜지고 설비가 들어선다.
   *     양옆에 두꺼운 외벽, 바닥에 기초, 위에 단계마다 다른 지붕(천막 → 박공 양철 → 평지붕과 난간 → 총안)을 둔다.
   *     같은 시설을 많이 지으면(facilityTier) 방 위쪽에 등이 하나씩 더 켜진다.
   */
  var BASE_STAGES = [1, 10, 50, 150, 400];
  var ROOMS = [['radio', 'lab', 'district', 'solar', 'purifier'],     // 위층
               ['scouts', 'garden', 'workshop', 'bunker', 'port']];   // 아래층
  var BASE_X = 10, PILOTI = 12, ROOM_H = 9;   // PILOTI 는 1층의 높이(사람 키 11칸이 들어간다)
  var STOCK_MAX = 12;                         // 창고에 그리는 상자 수의 상한
  /** 시설 합계 → 거점의 단계(0~5). 잘못된 값은 0. */
  function baseStage(total) {
    if (!(typeof total === 'number' && total > 0)) return 0;
    var st = 0;
    while (st < BASE_STAGES.length && total >= BASE_STAGES[st]) st++;
    return st;
  }
  /** 시설 보유 수 → 그 방의 단계(0~3). 잘못된 값은 0. */
  function facilityTier(n) { return !(typeof n === 'number' && n > 0) ? 0 : n >= 150 ? 3 : n >= 50 ? 2 : n >= 10 ? 1 : 0; }
  function totalFacilities(view) {
    var b = view.buildings || {}, total = 0;
    for (var k in b) if (Object.prototype.hasOwnProperty.call(b, k) && b[k] > 0) total += b[k];
    return total;
  }
  /** 방 한 칸의 폭: 방벽 안쪽 너비를 다섯으로 나눈다(폰 12칸, 넓은 화면 22칸). */
  function roomWidth(model) { return Math.max(11, Math.floor((model.wall - 12 - BASE_X) / 5)); }
  /** 시설 id 의 방 자리 { x, y, w, h, row, col } (y 는 방의 위쪽 끝). 모르는 id 는 null. */
  function roomSlot(model, id) {
    for (var row = 0; row < ROOMS.length; row++) {
      var col = ROOMS[row].indexOf(id);
      if (col >= 0) { var w = roomWidth(model); return { x: BASE_X + col * w, y: GROUND - PILOTI - (ROOMS.length - row) * ROOM_H, w: w, h: ROOM_H, row: row, col: col }; }
    }
    return null;
  }
  /** 창고에 쌓아 보이는 상자 수: 거점 단계만큼 기본으로 있고, 주인공이 나른 만큼(8개까지) 더 쌓인다. */
  function stockCrates(stage, delivered) {
    delivered = typeof delivered === 'number' && delivered > 0 ? Math.floor(delivered) : 0;
    return Math.min(STOCK_MAX, Math.max(0, stage) + Math.min(8, delivered));
  }
  function drawBaseBuilding(ctx, model, view, sky) {
    var stage = baseStage(Math.max(totalFacilities(view), view.zoneBuilding > 0 ? 1 : 0));
    if (!stage) return;
    var b = view.buildings || {}, t = model.time, night = sky.dark > 0.5, rw = roomWidth(model), W5 = rw * 5, i, k;
    var top = GROUND - PILOTI - ROOMS.length * ROOM_H, floor = GROUND - PILOTI, right = BASE_X + W5;
    function c(day, dark) { return lerpColor(day, dark, sky.dark * 0.85); }
    function px(col, x, y, w, h) { ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), w, h); }
    // 단계별 재료: [뼈대(바닥·칸막이), 외벽, 지붕]
    var mat = [null,
      [c('#8a6a4a', '#2a2018'), null,                    c('#5d6b4a', '#1e241a')],
      [c('#5b4630', '#1c160f'), c('#8a6240', '#2a1e14'), c('#8d9296', '#2c3035')],
      [c('#6f6c63', '#1c1e24'), c('#8f8b80', '#22242b'), c('#7f7b70', '#1a1c23')],
      [c('#4a4f55', '#15171c'), c('#6d7479', '#1e2228'), c('#5d6268', '#181b20')],
      [c('#30343c', '#0f1116'), c('#6d7479', '#1e2228'), c('#5d6268', '#181b20')]][stage];
    var frame = mat[0], wallCol = mat[1], roof = mat[2];
    // 방마다 벽지 색이 조금씩 다르다(낮 / 불 켜진 밤). 모든 방이 같은 색이면 격자무늬처럼 보인다.
    var TINT_DAY = ['#ddd4b4', '#d2d8c2', '#dcc9ae', '#ccd4d6'], TINT_NIGHT = ['#8a7340', '#77784a', '#8a683c', '#66707c'];
    function lit(n) { return night ? TINT_NIGHT[n % 4] : c(TINT_DAY[n % 4], TINT_NIGHT[n % 4]); }

    /* --- 1층: 창고(왼쪽 두 칸), 공용실(가운데 두 칸, 모닥불 자리), 현관과 계단(오른쪽 한 칸) --- */
    if (wallCol) {
      px(night ? '#5c4d2c' : c('#c4b894', '#5c4d2c'), BASE_X + 1, floor + 1, rw * 2 - 1, PILOTI - 1);            // 창고: 조금 어두운 벽
      px(lit(1), BASE_X + rw * 2 + 1, floor + 1, rw * 2 - 1, PILOTI - 1);                                         // 공용실
      px(night ? '#4a4434' : c('#b4ad98', '#4a4434'), BASE_X + rw * 4 + 1, floor + 1, rw - 1, PILOTI - 1);        // 현관
    }
    // 창고의 물자: 아래부터 한 줄씩 쌓는다. 상자는 5×4 칸, 줄마다 반 칸씩 들여 쌓는다
    var crates = stockCrates(stage, model.delivered), perRow = Math.max(2, Math.floor((rw * 2 - 3) / 5)), n = 0, rowNo = 0;
    while (n < crates && rowNo < 3) {
      var inRow = Math.min(crates - n, Math.max(1, perRow - rowNo));
      for (k = 0; k < inRow; k++) {
        var cx = BASE_X + 2 + k * 5 + rowNo * 2, cy = GROUND - 4 - rowNo * 4;
        px(c('#8a5a34', '#4a3220'), cx, cy, 4, 4); px(c('#f0b400', '#8a6a08'), cx, cy + 1, 4, 1);
      }
      n += inRow; rowNo++;
    }
    // 공용실: 선반과 식탁(모닥불은 drawBase 가 이 방 자리에 그린다)
    if (wallCol) { px(frame, BASE_X + rw * 2 + 3, floor + 3, rw - 2, 1); px(c('#a8261b', '#5a1a14'), BASE_X + rw * 2 + 4, floor + 2, 2, 1); px(c('#3f6f8f', '#1c3446'), BASE_X + rw * 2 + 7, floor + 2, 2, 1); }
    // 현관: 문과 위층으로 가는 계단
    for (k = 0; k < 5; k++) px(frame, BASE_X + rw * 4 + 2 + k * 2, GROUND - 2 - k * 2, rw - 3 - k * 2 > 0 ? 2 : 1, 2);
    if (wallCol) { px('#17180f', right - 4, GROUND - 9, 3, 9); px(night ? '#ffe9a0' : c('#c9c2a3', '#6a6654'), right - 3, GROUND - 8, 1, 2); }

    /* --- 2·3층: 시설의 방 --- */
    ROOMS.forEach(function (row, ri) {
      row.forEach(function (id, ci) {
        var x = BASE_X + ci * rw, y = top + ri * ROOM_H, own = b[id] > 0, tier = facilityTier(b[id]);
        if (own) px(lit(ri * 5 + ci + ri), x + 1, y + 1, rw - 1, ROOM_H - 1);                                    // 불 켜진 방
        else if (wallCol) px(c('#7a766c', '#16181e'), x + 1, y + 1, rw - 1, ROOM_H - 1);                          // 아직 비어 있는 어두운 방
        if (own) { drawRoom(ctx, id, x + 1 + Math.floor((rw - 11) / 2), y + 1, t, night); for (k = 0; k < tier; k++) px('#f0b400', x + 2 + k * 2, y + 1, 1, 1); }
        else if (wallCol) { px(c('#5f5b52', '#0f1014'), x + 3, y + ROOM_H - 3, rw - 6, 2); }                      // 빈 방에 덮어 둔 천
      });
    });

    /* --- 뼈대와 외벽: 바닥 슬래브, 칸막이, 양옆의 두꺼운 벽, 기초 --- */
    var slab = stage >= 3 ? 2 : 1;
    for (i = 0; i <= ROOMS.length; i++) px(frame, BASE_X, top + i * ROOM_H, W5 + 1, i === ROOMS.length ? slab : 1);
    for (i = 1; i < 5; i++) px(frame, BASE_X + i * rw, top, 1, ROOMS.length * ROOM_H);
    px(frame, BASE_X + rw * 2, floor, 1, PILOTI); px(frame, BASE_X + rw * 4, floor, 1, PILOTI);                    // 1층 칸막이
    if (wallCol) {
      px(wallCol, BASE_X - 1, top, 2, GROUND - top); px(wallCol, right, top, 2, GROUND - top - 9);                 // 양옆 외벽(오른쪽은 문 위까지)
      px(c('#57554d', '#17160f'), BASE_X - 2, GROUND - 1, W5 + 5, 1);                                              // 기초
    } else { px(frame, BASE_X, top, 1, GROUND - top); px(frame, right, top, 1, GROUND - top); }                    // 야영지: 기둥뿐

    /* --- 외벽: 방을 통째로 드러내지 않고, 벽에 난 창으로 안이 들여다보이게 한다 --- */
    if (wallCol) {
      var trim = c('#4a4034', '#14110d'), board = c('#6b4a2b', '#1f160e'), shade = lerpColor(wallCol, '#17180f', 0.18);
      ROOMS.forEach(function (row, ri) {
        row.forEach(function (id, ci) {
          var x = BASE_X + ci * rw, y = top + ri * ROOM_H, own = b[id] > 0;
          px(wallCol, x, y, rw + 1, 2); px(wallCol, x, y + ROOM_H - 2, rw + 1, 2);              // 창 위아래의 벽
          px(wallCol, x, y, 2, ROOM_H); px(wallCol, x + rw - 1, y, 2, ROOM_H);                  // 창 양옆의 벽
          px(trim, x + 2, y + ROOM_H - 3, rw - 3, 1);                                           // 창턱
          px(shade, x + 1, y + ROOM_H - 1, rw - 1, 1);                                          // 층 사이의 그늘진 줄
          if (!own) { px(board, x + 2, y + 3, rw - 3, 1); px(board, x + 3, y + 5, rw - 4, 1); } // 빈 방: 판자로 막은 창
        });
      });
      // 1층: 창고 셔터(반쯤 올린 것), 공용실의 큰 창, 현관
      px(wallCol, BASE_X, floor, W5 + 1, 2);
      px(wallCol, BASE_X, floor, 2, PILOTI); px(wallCol, BASE_X + rw * 2 - 1, floor, 2, PILOTI); px(wallCol, BASE_X + rw * 4 - 1, floor, 2, PILOTI);
      for (k = 0; k < 2; k++) px(trim, BASE_X + 2, floor + 2 + k, rw * 2 - 3, 1);              // 말아 올린 셔터
      px(trim, BASE_X + rw * 2 + 1, GROUND - 3, rw * 2 - 2, 1);                                 // 공용실 창턱
      px(wallCol, BASE_X + rw * 2 + 1, GROUND - 2, rw * 2 - 2, 2);                              // 창 아래의 벽
    }

    /* --- 위로 올린 층: 3구역을 열면 창만 있는 층이 하나 더 올라간다.
     *     폰에서는 화면 위쪽 22칸을 날짜 줄이 가리므로 한 층(4칸)까지만 올린다. 옥상의 탑과 깃발도 그 안에 들어오게 낮게 그린다. --- */
    var extra = stage >= 3 && view.zone >= 2 ? 1 : 0, FLOOR_H = 4, rt = top - extra * FLOOR_H;
    for (i = 0; i < extra; i++) {
      var fy = top - (i + 1) * FLOOR_H;
      px(wallCol, BASE_X - 1, fy, W5 + 3, FLOOR_H);
      px(lerpColor(wallCol, '#17180f', 0.18), BASE_X - 1, fy + FLOOR_H - 1, W5 + 3, 1);
      for (k = 3; k < W5 - 2; k += 6) {
        var on = night && (k + i * 3) % 4 !== 0;                                                // 밤에는 창 넷에 셋쯤 불이 켜진다
        px(on ? ['#ffe9a0', '#f3c66a', '#cfe0ea'][(k + i) % 3] : c('#9fb4c4', '#1a2230'), BASE_X + k, fy + 1, 3, 2);
      }
    }

    /* --- 지붕: 단계마다 모양이 다르다 --- */
    if (stage === 1) { for (i = 0; i < W5 + 2; i++) px(roof, BASE_X - 1 + i, rt - 2 + (Math.floor(i / 4) % 2), 1, 2); }                              // 처진 천막
    if (stage === 2) {                                                                                                                              // 박공 양철 지붕과 굴뚝
      for (k = 0; k < 4; k++) px(roof, BASE_X - 2 + k * Math.ceil(W5 / 12), rt - 1 - k, W5 + 5 - k * 2 * Math.ceil(W5 / 12), 1);
      for (i = 3; i < W5; i += 5) px(c('#6d7479', '#22262b'), BASE_X + i, rt - 1, 1, 1);
      px(c('#6d2a20', '#22100c'), right - 8, rt - 8, 3, 6); if (Math.floor(t * 2) % 2) px(c('#b9b6ac', '#3a3c44'), right - 8 + Math.floor(t) % 2, rt - 10, 2, 1);
    }
    if (stage >= 3) {
      px(roof, BASE_X - 2, rt - 2, W5 + 5, 2);                                                                                                     // 평지붕
      for (i = 0; i <= W5; i += stage >= 4 ? 3 : 4) px(frame, BASE_X + i, rt - (stage >= 4 ? 5 : 4), stage >= 4 ? 2 : 1, stage >= 4 ? 3 : 2);      // 난간 / 총안
      if (stage === 3) px(frame, BASE_X, rt - 4, W5 + 1, 1);
      px('#17180f', BASE_X + 2, rt - 10, 1, 8); drawFlag(ctx, view.flag, BASE_X + 3, rt - 10, 1, sky.dark, model.time);                                           // 깃발
      px(c('#3f6f8f', '#162836'), BASE_X + rw * 3 + 2, rt - 7, 6, 5); px('#17180f', BASE_X + rw * 3 + 3, rt - 2, 1, 1); px('#17180f', BASE_X + rw * 3 + 6, rt - 2, 1, 1); // 옥상 물탱크
    }
    if (stage >= 4) { px('#30343c', right - 5, rt - 8, 4, 3); if (night) for (i = 0; i < 9; i++) { px('rgba(240,220,150,' + (0.10 - i * 0.01).toFixed(2) + ')', right - 1 + i * 2, rt - 8 + i, 2, 3 + Math.floor(i / 2)); } } // 탐조등
    if (stage >= 5) {
      var mx = BASE_X + Math.floor(W5 / 2);
      px('#17180f', mx, rt - 7, 1, 5); px('#17180f', mx - 1, rt - 5, 3, 1); if (Math.floor(t * 2) % 2) px('#e0392b', mx, rt - 8, 1, 1);     // 송신탑
      px(c('#a8261b', '#7a2018'), BASE_X + rw + 1, rt - 8, rw + 2, 5); px(night ? '#ffe9a0' : c('#e6e5db', '#8a887c'), BASE_X + rw + 3, rt - 6, rw - 2, 1); // 옥상 간판
      for (i = 4; i < W5 - 2; i += 5) px(night ? ['#ffe9a0', '#ffb39a', '#9ad0ff'][Math.floor(i / 5) % 3] : c('#c9c2a3', '#4a4738'), BASE_X + i, floor + 1 + (Math.floor(i / 5) % 2), 1, 1); // 줄전등
    }
  }
  /** 방 안의 설비(11×8 칸 안에 그린다). x, y 는 방 안쪽의 왼쪽 위. */
  function drawRoom(ctx, id, x, y, t, night) {
    function r(col, dx, dy, w, h) { ctx.fillStyle = col; ctx.fillRect(x + dx, y + dy, w, h); }
    var blink = Math.floor(t * 2) % 2;
    if (id === 'radio')    { r('#5b4630', 1, 5, 7, 1); r('#30343c', 2, 3, 4, 2); r(blink ? '#e0392b' : '#7a2018', 3, 3, 1, 1); r('#17180f', 7, 0, 1, 5); r('#17180f', 6, 1, 3, 1); r('#5b4630', 2, 6, 1, 2); r('#5b4630', 7, 6, 1, 2); } // 무전소: 무전기와 안테나
    if (id === 'lab')      { r('#e6e5db', 0, 5, 9, 1); r(night ? '#7dff9a' : '#4fbf6a', 1, 2, 2, 3); r(night ? '#7dff9a' : '#4fbf6a', 5, 3, 2, 2); r('#d9d8cf', 1, 1, 2, 1); r('#2c6638', 8, 1, 1, 3); r('#2c6638', 7, 2, 3, 1); r('#9a9a94', 1, 6, 1, 2); r('#9a9a94', 7, 6, 1, 2); } // 연구동: 초록 시약병과 십자
    if (id === 'district') { r('#5b4630', 0, 2, 5, 1); r('#5b4630', 0, 5, 5, 1); r('#5b4630', 0, 2, 1, 6); r('#5b4630', 4, 2, 1, 6); r('#a8261b', 1, 1, 3, 1); r('#3f6f8f', 1, 4, 3, 1); r('#17180f', 8, 2, 1, 6); r('#ffe9a0', 7, 1, 3, 2); } // 자치구: 이층 침대와 전등
    if (id === 'solar')    { r('#30343c', 0, 2, 4, 6); r('#30343c', 5, 2, 4, 6); r('#5a86d0', 1, 3, 2, 1); r('#5a86d0', 6, 3, 2, 1); r(blink ? '#7dff9a' : '#2c6638', 1, 6, 1, 1); r(blink ? '#2c6638' : '#7dff9a', 6, 6, 1, 1); r('#f0b400', 4, 4, 1, 1); } // 태양광: 축전지 두 대
    if (id === 'purifier') { r('#3f6f8f', 2, 1, 6, 6); r('#9fc6d8', 2, 2, 6, 1); r('#17180f', 0, 4, 2, 1); r('#17180f', 0, 4, 1, 4); r('#9fc6d8', 9, 2 + Math.floor(t * 6) % 5, 1, 1); r('#30343c', 2, 7, 6, 1); }               // 정수기: 물탱크와 떨어지는 물
    if (id === 'scouts')   { r('#c9c2a3', 0, 1, 5, 4); r('#a8261b', 1, 2, 1, 1); r('#2f4f8f', 3, 3, 1, 1); r('#8a5a34', 6, 4, 3, 4); r('#5d6b4a', 7, 3, 2, 1); r('#f0b400', 6, 5, 3, 1); }                                               // 수색조: 지도와 배낭
    if (id === 'garden')   { r('#c64f9a', 0, 0, 10, 1); r('#5a4630', 0, 6, 10, 2); for (var g = 0; g < 4; g++) r('#3f8a3c', 1 + g * 2 + (g > 1 ? 1 : 0), 3 + (g + Math.floor(t)) % 2, 1, 3 - (g + Math.floor(t)) % 2); }               // 텃밭: 재배등 아래의 작물
    if (id === 'workshop') { r('#5b4630', 0, 5, 7, 1); r('#5b4630', 1, 6, 1, 2); r('#5b4630', 5, 6, 1, 2); r('#9a9a94', 2, 3, 3, 2); r(Math.floor(t * 6) % 2 ? '#f0b400' : '#e0602b', 4, 2, 1, 1); r('#30343c', 8, 1, 2, 7); r('#e0602b', 8, 5, 2, 2); } // 작업장: 작업대의 불꽃과 화덕
    if (id === 'bunker')   { r('#5d6b4a', 0, 5, 4, 3); r('#5d6b4a', 1, 2, 3, 3); r('#f0b400', 0, 6, 4, 1); r('#c9c2a3', 5, 6, 5, 2); r('#c9c2a3', 6, 4, 3, 2); r('#17180f', 7, 1, 2, 1); }                                               // 벙커: 탄약 상자와 모래주머니
    if (id === 'port')     { r('#b85a36', 0, 5, 5, 3); r('#3f6f8f', 5, 5, 5, 3); r('#3f6f8f', 1, 2, 5, 3); r('#17180f', 8, 0, 1, 2 + blink); r('#8a5a34', 7, 2 + blink, 3, 2); }                                                         // 하역장: 컨테이너와 갈고리
  }

  // 누운 좀비: 선 그림을 옆으로 눕힌 것(쓰러진 뒤와 기어 오는 좀비에 쓴다)
  /** 쓰러진 좀비: 죽는 방식에 따라 넘어지거나, 불타거나, 감전되거나, 흔적만 남는다. 끝에는 흐려지며 사라진다. */
  function drawCorpses(ctx, model, view) {
    var t = model.time;
    model.corpses.forEach(function (cp) {
      var k = 1 - cp.life / cp.total, x = Math.round(cp.x), sc = cp.big ? 2 : 1, look = ZOMBIE_LOOKS[cp.look];
      ctx.globalAlpha = k > 0.7 ? Math.max(0, (1 - k) / 0.3) : 1;
      if (cp.death === 'blast') {            // 터짐: 그을린 자국만 남는다
        ctx.fillStyle = '#17180f'; ctx.fillRect(x - 1, GROUND - 1, 8 * sc, 1); ctx.fillRect(x + 1, GROUND - 2, 4 * sc, 1);
      } else if (cp.death === 'burn') {      // 불탐: 선 채로 타다가 재가 된다
        if (k < 0.45) {
          sprite(ctx, ZOMBIE[0], x, GROUND - 11 * sc, true, sc, { g: '#e0602b', c: '#f0b400', d: '#8f3a2e', x: '#17180f' });
          ctx.fillStyle = Math.floor(t * 12) % 2 ? '#f0b400' : '#e0602b';
          ctx.fillRect(x + 1 + Math.floor(t * 9) % 4, GROUND - 13 * sc, 2, 2);
        } else { ctx.fillStyle = '#2b241c'; ctx.fillRect(x, GROUND - 2, 7 * sc, 2); ctx.fillStyle = '#57554d'; ctx.fillRect(x + 2, GROUND - 3, 3 * sc, 1); }
      } else if (cp.death === 'zap' && k < 0.2) { // 감전: 잠깐 하얗게 굳는다
        sprite(ctx, ZOMBIE[0], x, GROUND - 11 * sc, true, sc, Math.floor(t * 20) % 2 ? { g: '#ffffff', c: '#7fe0f0', d: '#7fe0f0', x: '#17180f' } : look);
      } else if (k < 0.1) {                  // 맞은 순간: 뒤로 젖혀진다
        var fr = zombieFrames(cp.type)[1];
        sprite(ctx, fr, x + 2, GROUND - (fr.length - 1) * sc, true, sc, look);
      } else if (k < 0.2) {                  // 무릎이 꺾인다: 같은 그림의 위쪽 절반만 낮게
        var half = zombieFrames(cp.type)[0].slice(0, 7);
        sprite(ctx, half, x + 3, GROUND - 7 * sc, true, sc, look);
      } else {                               // 바닥에 무너져 있다
        sprite(ctx, ZOMBIE_DOWN, x + 1, GROUND - 3 * sc, false, sc, look);
        if (cp.type === 'brute') sprite(ctx, ZOMBIE_DOWN, x + 3, GROUND - 4 * sc, false, sc, look);       // 덩치는 더미도 크다
      }
      ctx.globalAlpha = 1;
    });
  }

  /** 사격 흔적: 총알 자국, 화염, 전류, 광선. 아주 짧게 보였다 사라진다. */
  function drawShots(ctx, model) {
    model.shots.forEach(function (sh) {
      var n = Math.max(2, Math.round(Math.abs(sh.x1 - sh.x0) / 3)), i, px, py;
      for (i = 0; i <= n; i++) {
        px = sh.x0 + (sh.x1 - sh.x0) * i / n; py = sh.y0 + (sh.y1 - sh.y0) * i / n;
        if (sh.kind === 'bullet') { if (i % 2 === 0) { ctx.fillStyle = '#ffe9a0'; ctx.fillRect(Math.round(px), Math.round(py), 2, 1); } }
        else if (sh.kind === 'flame') { ctx.fillStyle = i % 2 ? '#f0b400' : '#e0602b'; ctx.fillRect(Math.round(px), Math.round(py) - (i % 3), 2, 2 + (i % 2)); }
        else if (sh.kind === 'arc') { ctx.fillStyle = '#7fe0f0'; ctx.fillRect(Math.round(px), Math.round(py) + (i % 2 ? -2 : 1), 2, 1); }
        else { ctx.fillStyle = '#d9f6ff'; ctx.fillRect(Math.round(px), Math.round(py), 3, 2); }
      }
      if (sh.kind === 'bullet' || sh.kind === 'beam') { ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(sh.x0), Math.round(sh.y0) - 1, 2, 3); } // 총구 불꽃
    });
  }

  /** 주인공이 산 수색 장비: 배낭은 등에, 수색견은 뒤를 따르고, 정찰 드론은 머리 위를 맴돈다. */
  function drawHeroKit(ctx, model, view, hx) {
    var u = view.upgrades || {}, h = model.hero, t = model.time, back = h.face < 0 ? 6 : 0;
    if (u.backpack && h.state !== 'search') { ctx.fillStyle = '#5d6b4a'; ctx.fillRect(hx - 4 + (h.face < 0 ? 10 : 0), GROUND - 8, 4, 1); ctx.fillStyle = '#3f4a33'; ctx.fillRect(hx - 4 + (h.face < 0 ? 10 : 0), GROUND - 8, 1, 1); }      // 배낭 개조: 가방 위에 얹은 침낭
    if (u.crowbar && h.state === 'search') { ctx.fillStyle = '#9a9a94'; ctx.fillRect(hx + 9, GROUND - 6 - Math.floor(t * 6) % 2, 1, 5); }
    var pet = view.pet;
    if (pet) {
      // 동물 친구: 주인공 뒤를 따른다. 4.5.0 걸을 때는 네 발로 걷고(발은 늘 땅에), 멈추면 앉는다. 들썩이며 미끄러지던 깡충은 없앴다
      var f = h.face > 0 ? 1 : -1, moving = h.state === 'out' || h.state === 'back', step = Math.floor(t * 8) % 2;
      var pw = PET_W;
      var as = function (p, st) { var o = {}; for (var k in p) o[k] = p[k]; o.walk = moving; o.step = st; return o; };
      paintPet(ctx, f > 0 ? Math.round(h.x) - 10 - pw : Math.round(h.x) + 10, GROUND - PET_H, 1, f > 0, as(pet, step), (view.look && view.look.pet) || 'none', t);
      // 4.4.6 함께 장착한 다른 친구는 라라 앞에서 걷는다(옷은 데리고 다니는 아이만 입는다). 발은 반 박자 어긋나게
      if (view.pet2) paintPet(ctx, f > 0 ? Math.round(h.x) + 12 : Math.round(h.x) - 12 - pw, GROUND - PET_H, 1, f > 0, as(view.pet2, 1 - step), 'none', t + 0.3);
    }
    if (u.drone) {
      var qx = Math.round(h.x) + Math.round(Math.sin(t * 1.3) * 6) - 2, qy = GROUND - 24 + Math.round(Math.sin(t * 2.1) * 2);
      ctx.fillStyle = '#30343c'; ctx.fillRect(qx, qy, 5, 1); ctx.fillRect(qx + 1, qy + 1, 3, 1);
      ctx.fillStyle = Math.floor(t * 3) % 2 ? '#e0392b' : '#7fe0f0'; ctx.fillRect(qx + 2, qy + 2, 1, 1);
    }
  }

  /** 거점 사람들: 제작으로 둔 담당자와, 시설이 늘면 함께 늘어나는 생존자. 밤에는 불가에 모인다. */
  function drawPeople(ctx, model, view, sky) {
    var g = view.gear || {}, b = view.buildings || {}, t = model.time, night = sky.dark > 0.5, i;
    var total = 0;
    for (var k in b) if (Object.prototype.hasOwnProperty.call(b, k) && b[k] > 0) total += b[k];
    function person(x, look, hat, walking, flip) {
      sprite(ctx, SQUAD_TOP.concat(HERO_LEGS[walking ? Math.floor(t * 6 + x) % 2 : 0]), Math.round(x) - 4, GROUND - 11, flip, 1, look);
      if (hat) { ctx.fillStyle = hat; ctx.fillRect(Math.round(x) - (flip ? 1 : 3), GROUND - 12, 5, 1); }
    }
    // 생존자가 오가는 구간: 모닥불 오른쪽 ~ 방벽 안쪽
    var left = 44, right = model.wall - 16;
    if (g.operator) {                             // 무전병: 안테나 앞에 앉아 있다
      sprite(ctx, SQUAD_TOP, 9, GROUND - 8, true, 1, { c: '#4f5d73', d: '#2a3140' });
      ctx.fillStyle = view.signal && Math.floor(t * 6) % 2 ? '#f0b400' : '#17180f'; ctx.fillRect(11, GROUND - 9, 5, 1);
    }
    if (g.warden) {                               // 방벽 담당: 방벽 안쪽에서 보강한다(못 막는 밤에는 망치질이 빨라진다)
      person(model.wall - 4, { c: '#8a5a34', d: '#5b4630' }, '#f0b400', false, false);
      ctx.fillStyle = '#9a9a94'; ctx.fillRect(model.wall - 1, GROUND - 8 - Math.floor(t * (view.safe ? 2 : 7)) % 2 * 2, 2, 1);
    }
    if (g.builder && right > left) {              // 건설 담당: 시설 사이를 오가며 손본다
      var span = right - left, ph = (t * 7) % (span * 2), bx = left + (ph < span ? ph : span * 2 - ph);
      person(bx, { c: '#b85a36', d: '#6d2a20' }, '#e6e5db', true, ph >= span);
      ctx.fillStyle = '#9a9a94'; ctx.fillRect(Math.round(bx) + (ph >= span ? -5 : 3), GROUND - 7, 2, 1);
    }
    // 생존자: 시설 10곳마다 한 명씩, 넓은 화면은 넷까지 좁은 화면은 둘까지
    var folk = Math.min(model.wall > WALL_X ? 4 : 2, Math.floor(total / 10)); // 좁은 화면은 둘까지: 사람이 많으면 건물이 가려진다
    for (i = 0; i < folk && right > left; i++) {
      if (night) { person([33, 49, 55, 27][i], ZOMBIE_LOOKS[i % 3], null, false, i === 1 || i === 2); continue; } // 밤에는 불가에 둘러앉는다(서로 겹치지 않게 자리를 정해 둔다)
      var sp = right - left, q = (t * (4 + i) + i * 37) % (sp * 2), fx = left + (q < sp ? q : sp * 2 - q);
      person(fx, [{ c: '#4f5d73', d: '#2a3140' }, { c: '#6b4a3a', d: '#3a2a22' }, { c: '#5d6b4a', d: '#30343c' }, {}][i], null, true, q >= sp);
    }
  }

  /**
   * 끝낸 연구와 제작 장비가 거점에 남기는 것들. 연구 하나에 소품 하나, 낮에도 밤에도 보인다.
   * 자리가 겹치면 가려지므로 넷으로 나눠 놓는다: 앞마당 줄(땅 아래쪽 띠), 땅 위 왼편, 방벽 위, 방벽 바깥.
   */
  function drawUpgrades(ctx, model, view, sky) {
    var rs = view.research || {}, g = view.gear || {}, t = model.time, night = sky.dark > 0.5, wall = model.wall, i;
    function c(day, dark) { return lerpColor(day, dark, sky.dark * 0.85); }
    function r(col, x, y, w, h) { ctx.fillStyle = col; ctx.fillRect(Math.round(x), GROUND - y - h, w, h); }
    // 앞마당 줄: 좁은 화면에서도 서로 겹치지 않도록 9칸 간격의 정해진 자리에 놓는다(낮에도 밤에도 보인다)
    var yard = H - 2 - GROUND; // 땅 선에서 이만큼 아래가 앞마당 소품의 바닥
    function y(col, x, up, w, h) { r(col, x, up - yard, w, h); }
    if (rs.compost) { y(c('#5a4630', '#1c160f'), 2, 0, 7, 3); y(c('#4f8a3c', '#2c5a22'), 3, 3, 5, 1); y(c('#4f8a3c', '#2c5a22'), 5, 4, 1, 2); }                      // 퇴비 순환: 싹이 난 퇴비 더미
    if (rs.ration)  { y(c('#8a5a34', '#4a3220'), 11, 0, 4, 4); y(c('#8a5a34', '#4a3220'), 15, 0, 3, 3); y(c('#f0b400', '#8a6a08'), 11, 2, 4, 1); y(c('#8a5a34', '#4a3220'), 12, 4, 3, 3); } // 분산 창고: 나눠 쌓은 상자
    if (rs.drill)   { y('#17180f', 23, 0, 1, 6); y(c('#c9c2a3', '#6a6654'), 21, 6, 5, 3); y(c('#a8261b', '#7a2018'), 23, 7, 1, 1); y(c('#c9c2a3', '#6a6654'), 26, 0, 3, 2); } // 야간 훈련: 사격 표적과 모래주머니
    if (rs.serum)   { y(c('#6f6a60', '#33312c'), 31, 0, 6, 2); y(night ? '#7dff9a' : '#4fbf6a', 32, 2, 4, 5); y(c('#d9d8cf', '#6a6a62'), 32, 7, 4, 1); if (Math.floor(t * 3) % 2) y('#d9ffe2', 33 + Math.floor(t * 2) % 2, 3 + Math.floor(t * 5) % 3, 1, 1); } // 혈청 배양: 거품이 이는 배양통
    if (rs.shift)   { y('#17180f', 41, 0, 1, 8); y('#17180f', 41, 8, 3, 1); y(night ? '#ffe9a0' : c('#c9c2a3', '#6a6654'), 43, 6, 2, 2); if (night) glow(ctx, 44, GROUND + yard - 7, 5, '255,233,160', 0.06); } // 교대 근무: 야간 작업등
    if (rs.caravan) { y(c('#5d6b4a', '#2c3324'), 48, 1, 8, 4); y(c('#3f6f8f', '#1c3446'), 54, 3, 2, 2); y('#17180f', 49, 0, 2, 1); y('#17180f', 53, 0, 2, 1); }      // 호송대: 세워 둔 호송 트럭
    if (view.zoneBuilding > 0) drawZoneFacility(view, sky, 62, function (col, x, up, w, h) { y(col, x, up, w, h); }, c, t); // 구역 고유 시설: 앞마당 줄의 마지막 자리
    // 땅 위: 게시판과 전신주
    if (rs.maps)    { r('#17180f', 2, 0, 1, 8); r(c('#c9c2a3', '#6a6654'), 0, 8, 5, 4); r(c('#a8261b', '#7a2018'), 1, 10, 2, 1); r(c('#2f4f8f', '#243c6c'), 2, 9, 2, 1); } // 구역 지도: 게시판
    if (rs.grid)    {                                                                                                                                                 // 전력망: 방벽 안쪽의 전신주, 거점 건물로 이어진 전선, 밤에 켜지는 등
      var gx = wall - 16, bx = BASE_X + roomWidth(model) * 5 + 1, span = Math.max(1, gx - bx);   // 건물의 방을 가로지르지 않도록 건물 오른쪽에 세운다
      r('#17180f', gx, 0, 1, 26); r('#17180f', gx - 2, 24, 5, 1);
      for (i = 0; i < span; i += 2) r('#17180f', bx + i, 24 - Math.round(Math.sin(i / span * Math.PI) * 2), 2, 1);
      r(night ? '#ffe9a0' : c('#c9c2a3', '#6a6654'), gx - 1, 22, 3, 2);
      if (night) glow(ctx, gx, GROUND - 22, 8, '255,233,160', 0.045);
    }
    if (rs.fortress) { var fh = 7 + ['wire', 'tower', 'turret', 'flame', 'emp', 'rail'].filter(function (k2) { return (view.def || {})[k2] > 0; }).length * 3;
      r(c('#9aa0a6', '#4a5058'), wall - 1, fh, 6, 2); r(c('#9aa0a6', '#4a5058'), wall - 1, fh + 2, 2, 2); r(c('#9aa0a6', '#4a5058'), wall + 3, fh + 2, 2, 2); r(c('#7b8186', '#3a4048'), wall - 1, 0, 6, 2); } // 요새화: 방벽 꼭대기의 철제 총안
    if (g.barricade > 0) { for (i = 0; i < Math.min(3, Math.ceil(g.barricade / 4)); i++) r(c('#57554d', '#17160f'), wall + 4 + i, 0, 1, 6 + i * 2); }                    // 강화 바리케이드: 덧댄 판
    if (g.antenna > 0) { r(c('#c9c2a3', '#4a4738'), 9, 19, 3, 1); r(c('#c9c2a3', '#4a4738'), 10, 20, 2, 2); }                                                           // 지향성 안테나: 접시
    if (g.cart > 0) { r(c('#8a5a34', '#2a1c11'), 47, 1, 5, 3); r('#17180f', 47, 0, 2, 1); r('#17180f', 50, 0, 2, 1); }                                                  // 보급 수레
    // 방벽 바깥
    if (rs.traps)   { for (i = 0; i < 7; i++) { r(c('#9a9a94', '#33332f'), wall + 14 + i * 4, 0, 1, 3); r(c('#9a9a94', '#33332f'), wall + 13 + i * 4, 0, 3, 1); } }      // 함정 지대: 말뚝 줄
    if (rs.alarm)   { r('#17180f', wall + 46, 0, 1, 16); r(view.t >= DUSK && Math.floor(t * 4) % 2 ? '#e0392b' : c('#8f3a2e', '#2e1410'), wall + 45, 16, 3, 2); }       // 조기 경보망: 해 질 녘에 깜빡이는 경보등
  }

  /** 낮 하늘을 가로지르는 까마귀 한 마리(시간으로부터 위치를 계산한다. 밤에는 없다). */
  function drawBird(ctx, model, sky) {
    if (sky.dark > 0.4) return;
    var span = model.W + 120, x = model.W + 10 - (model.time * 14) % span, y = 14 + Math.round(Math.sin(model.time * 0.7) * 4);
    if (x < -6) return;
    ctx.fillStyle = '#17180f';
    ctx.fillRect(Math.round(x), y, 3, 1);
    ctx.fillRect(Math.round(x) + 1, y + (Math.floor(model.time * 6) % 2 ? -1 : 1), 1, 1);
  }

  /** 원정대: 회색 옷의 대원 둘이 출발 직후 걸어 나가고, 귀환 직전 상자를 들고 걸어 들어온다. */
  function drawSquad(ctx, model, view) {
    var sq = squadAt(model, view.expedition);
    if (!sq) return;
    var legs = HERO_LEGS[Math.floor(model.time * 7) % 2];
    for (var i = 0; i < 2; i++) {
      var x = Math.round(sq.x) - i * 10 * sq.dir;
      sprite(ctx, SQUAD_TOP.concat(legs), x - 4, GROUND - 11, sq.dir < 0, 1);
      if (sq.dir < 0) { ctx.fillStyle = '#8a5a34'; ctx.fillRect(x - 2, GROUND - 16, 5, 4); }
    }
    if ((view.research || {}).caravan) { // 호송대: 뒤에 수레가 따라온다
      var cx = Math.round(sq.x) - 22 * sq.dir - 3;
      ctx.fillStyle = '#8a5a34'; ctx.fillRect(cx, GROUND - 5, 7, 4); ctx.fillStyle = '#17180f'; ctx.fillRect(cx, GROUND - 1, 2, 1); ctx.fillRect(cx + 5, GROUND - 1, 2, 1);
      if (sq.dir < 0) { ctx.fillStyle = '#f0b400'; ctx.fillRect(cx + 1, GROUND - 7, 5, 2); }
    }
  }

  /** 안개의 짙기 배수: 낮 1, 밤 0.3. 범위를 벗어난 값은 잘라 낸다. */
  function fogStrength(dark) {
    dark = typeof dark === 'number' && isFinite(dark) ? Math.max(0, Math.min(1, dark)) : 0;
    return 1 - 0.7 * dark;
  }
  /**
   * 불빛: 네모 대신 계단식 원을 세 겹으로 겹쳐 가운데가 밝고 가장자리가 흐린 빛을 만든다.
   * dome 이 참이면 바닥(cy) 위쪽 반원만 그린다(모닥불처럼 땅에 놓인 빛).
   */
  function glow(ctx, cx, cy, radius, rgb, alpha, dome) {
    if (!(radius > 0) || !(alpha > 0)) return;
    ctx.fillStyle = 'rgba(' + rgb + ',' + alpha + ')';
    for (var k = 0; k < 3; k++) {
      var rr = radius * (1 - k * 0.3);
      for (var dy = -Math.floor(rr); dy <= (dome ? 0 : Math.floor(rr)); dy++) {
        var half = Math.round(Math.sqrt(rr * rr - dy * dy));
        ctx.fillRect(Math.round(cx - half), Math.round(cy + dy), half * 2 + 1, 1);
      }
    }
  }

  /** 날씨: 상태를 따로 두지 않고 시간으로부터 위치를 계산해 그린다. */
  function drawWeather(ctx, model, view) {
    var kind = weatherFor(view.day, view.zone), W = model.W, t = model.time, i, rnd;
    if (kind === 'rain') {
      rnd = seeded(5); ctx.fillStyle = 'rgba(190,210,225,0.55)';
      for (i = 0; i < W / 3; i++) { var rx = (rnd() * W + t * 40) % W, ry = (rnd() * H + t * 150) % GROUND; ctx.fillRect(Math.round(rx), Math.round(ry), 1, 3); }
    } else if (kind === 'snow') {
      rnd = seeded(9); ctx.fillStyle = 'rgba(240,240,235,0.85)';
      for (i = 0; i < W / 5; i++) { var sx = (rnd() * W + Math.sin(t + i) * 3 + W) % W, sy = (rnd() * H + t * 14) % (GROUND + 2); ctx.fillRect(Math.round(sx), Math.round(sy), 1, 1); }
    } else if (kind === 'fog') {
      // 안개: 화면 전체를 덮는 띠를 없애고, 가장자리가 가는 덩어리 몇 개만 천천히 흘려보낸다.
      // 밤에는 어두운 바탕 위에서 회색 띠가 도드라지므로 색을 밤하늘 쪽으로 옮기고 훨씬 옅게 그린다.
      var dark = skyAt(view.t).dark, strength = fogStrength(dark), tint = hexToRgb(lerpColor('#cdd2c8', '#46506a', dark)).join(',');
      for (i = 0; i < 4; i++) {
        var fw = 70 + i * 22, fx = Math.round(((t * (2 + i) + i * 90) % (W + fw)) - fw), fy = GROUND - 20 + i * 5;
        ctx.fillStyle = 'rgba(' + tint + ',' + ((0.07 + i * 0.03) * strength).toFixed(3) + ')';
        ctx.fillRect(fx + 10, fy, fw - 20, 2);       // 위쪽은 짧게
        ctx.fillRect(fx, fy + 2, fw, 3);             // 가운데가 가장 길고
        ctx.fillRect(fx + 16, fy + 5, fw - 32, 2);   // 아래쪽도 짧게: 네모난 띠로 보이지 않는다
      }
    }
  }

  function draw(ctx, model, view) {
    if (model.move && !model.move.turned && view.zone !== model.move.from) view = Object.assign({}, view, { zone: model.move.from });      // 떠나는 동안은 떠나는 구역의 배경
    var sky = dangerSky(skyAt(view.t), view.danger), h = model.hero, t = model.time, i;      // 위험 단계로 하는 회차는 하늘부터 달라진다
    drawBackdrop(ctx, model, view, sky);
    // 잔해 더미
    model.piles.forEach(function (px) {
      ctx.fillStyle = lerpColor('#6f6a60', '#1d1d19', sky.dark); ctx.fillRect(px - 3, GROUND - 3, 12, 3); ctx.fillRect(px, GROUND - 6, 6, 3);
      ctx.fillStyle = lerpColor('#8a5a34', '#2a1c11', sky.dark); ctx.fillRect(px + 5, GROUND - 4, 3, 2);
    });
    drawBaseBuilding(ctx, model, view, sky);
    drawBase(ctx, model, view, sky);
    drawUpgrades(ctx, model, view, sky);
    drawBird(ctx, model, sky);
    drawSquad(ctx, model, view);
    drawCorpses(ctx, model, view);
    // 좀비(왼쪽을 향해 걷는다)
    var kind = hordeFor(view.horde);
    model.zombies.forEach(function (z, zi) {
      var moving = z.x > z.stop, sc = z.big ? kind.bossScale : 1;
      // 무리 성격의 색이 먼저, 그 위에 개체마다 다른 옷 색(성격이 옷 색을 정하지 않을 때만)
      var look = kind.look ? Object.assign({}, ZOMBIE_LOOKS[z.look || 0], kind.look) : ZOMBIE_LOOKS[z.look || 0];
      // 종류마다 그림이 다르다. 빠른 것은 다리도 빨리 움직인다
      if (z.pal) look = Object.assign({}, look, z.pal);
      if (sky.tier >= 3) look = Object.assign({}, look, { x: Math.floor(t * 4 + z.phase) % 5 ? '#ff3b2b' : '#ffb09a' });      // 위험 11단계부터: 눈이 붉게 빛난다(가끔 번뜩인다)
      var frames = zombieFrames(z.big ? 'walker' : z.type), pace = z.type === 'runner' ? 7 : z.type === 'brute' ? 2 : 3;
      var frame = frames[Math.floor(t * pace * kind.speed + z.phase) % 2], tall = frame.length;
      // 방벽 앞에 선 맨 앞줄은, 못 막는 밤이면 방벽을 두드린다(앞뒤로 흔들린다)
      var pound = !moving && !view.safe && zi < 2 && Math.floor(t * 6 + z.phase) % 2 ? -1 : 0;
      // 걷는 동안 한 칸씩 휘청이고(뛰는 것은 빼고), 방벽 앞에 서면 제자리에서 들썩인다
      var sway = moving && z.type !== 'runner' && Math.floor(t * 1.5 + z.phase) % 3 === 0 ? 1 : 0;
      var top = GROUND - tall * sc - (!moving && Math.floor(t * 5 + z.phase) % 2 ? 1 : 0);
      if (z.glow) {      // 야광: 몸 둘레가 희미하게 빛난다
        ctx.save(); ctx.globalAlpha = 0.18 + 0.08 * Math.sin(t * 3 + z.phase); ctx.fillStyle = (z.pal && z.pal.g) || PAL.g;
        ctx.fillRect(Math.round(z.x + pound + sway) - 1, top - 1, frame[0].length * sc + 2, tall * sc + 2); ctx.restore();
      }
      sprite(ctx, frame, z.x + pound + sway, top, true, sc, look);
      if (kind.hat) { ctx.fillStyle = kind.hat; ctx.fillRect(Math.round(z.x) + 1 * sc, top - sc, 5 * sc, sc); }           // 안전모
      if (z.big) { ctx.fillStyle = PAL.e; ctx.fillRect(Math.round(z.x) + 3 * sc, top + 2 * sc, sc, sc); ctx.fillRect(Math.round(z.x) + 5 * sc, top + 2 * sc, sc, sc); } // 변이체의 붉은 눈(그림을 뒤집어 그리므로 3·5번째 칸)
    });
    // 거점으로 뛰어드는 무리(뚫린 밤)
    model.raiders.forEach(function (rd) {
      sprite(ctx, ZOMBIE[Math.floor(t * 9 + rd.phase) % 2], rd.x, GROUND - 11 * (rd.big ? 2 : 1), true, rd.big ? 2 : 1, ZOMBIE_LOOKS[rd.look]);
    });
    drawShots(ctx, model);
    drawPeople(ctx, model, view, sky);
    // 주인공
    // hx: 옛 그림(8칸) 기준의 왼쪽 끝. 곁들이는 것들(동물 친구, 지렛대)은 이 값을 그대로 쓴다. 라라(14칸)는 lx 에서 그린다
    var hx = Math.round(h.x) - 4, lx = Math.round(h.x) - 8, ly = GROUND - LARA_H, look = view.look || (view.coat ? { coat: view.coat } : null), lflip = h.face < 0;
    if (h.state === 'search') paintLara(ctx, lx, ly + (Math.floor(t * 6) % 2), 1, false, look, 'search', 0);
    else {
      var walking = h.state === 'out' || h.state === 'back';
      paintLara(ctx, lx, ly, 1, lflip, look, walking ? 'walk' : 'stand', walking ? Math.floor(t * (h.boost > 0 ? 14 : 7)) % 2 : 0);
    }
    var lwalk = h.state === 'out' || h.state === 'back';
    paintLaraFx(ctx, lx, ly + (h.state === 'search' ? (Math.floor(t * 6) % 2) : 0), 1, lflip && h.state !== 'search', look, t, h.state === 'search' ? 'search' : lwalk ? 'walk' : 'stand', lwalk ? Math.floor(t * (h.boost > 0 ? 14 : 7)) % 2 : 0, sky.dark);
    if (h.carrying) { ctx.fillStyle = '#8a5a34'; ctx.fillRect(lx + 5, ly - 2, 6, 4); ctx.fillStyle = '#f0b400'; ctx.fillRect(lx + 5, ly - 1, 6, 1); }      // 든 상자: 머리 위
    drawHeroKit(ctx, model, view, hx);
    // 거점에 쌓인 상자(최근에 나른 만큼, 최대 6개). 건물이 서면 상자는 건물 1층 창고에 쌓인다(drawBaseBuilding)
    for (i = 0; i < Math.min(6, model.delivered) && baseStage(Math.max(totalFacilities(view), view.zoneBuilding > 0 ? 1 : 0)) < 1; i++) { ctx.fillStyle = '#8a5a34'; ctx.fillRect(30 + (i % 3) * 5, GROUND - 4 - Math.floor(i / 3) * 4, 4, 4); ctx.fillStyle = '#f0b400'; ctx.fillRect(30 + (i % 3) * 5, GROUND - 3 - Math.floor(i / 3) * 4, 4, 1); }
    model.particles.forEach(function (p) { ctx.fillStyle = p.color; ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1); });
    drawForeground(ctx, model, view, sky);
    drawWeather(ctx, model, view);
    drawDangerAir(ctx, model, view, sky);
    if (model.flash > 0) { ctx.globalAlpha = Math.min(0.6, model.flash * 1.6); ctx.fillStyle = model.flashColor; ctx.fillRect(0, 0, model.W, H); ctx.globalAlpha = 1; }
  }

  /* ---------- 캔버스에 붙이기 ---------- */
  /**
   * canvas 에 장면을 붙이고 그리기 루프를 시작한다. getView 는 매 프레임 호출되어 현재 view 를 돌려준다.
   * 캔버스를 쓸 수 없는 환경이면 null 을 돌려주고 아무 일도 하지 않는다(게임은 그림 없이도 돌아간다).
   */
  function mount(canvas, getView) {
    var ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) return null;
    var model = create(256), last = 0, acc = 0;
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function fit() {
      // 도트 한 칸이 화면에서 2~3픽셀이 되도록 저해상도 폭을 정한다
      var css = canvas.clientWidth || 512, scale = Math.max(2, Math.round(css / 400));
      var W = Math.max(160, Math.round(css / scale));
      if (canvas.width !== W) { canvas.width = W; canvas.height = H; }
      canvas.style.height = (H * css / W).toFixed(1) + 'px'; // 감싼 틀이 더 낮으면 하늘 윗부분이 잘린다
      resize(model, W);
    }
    function frame(now) {
      requestAnimationFrame(frame);
      var dt = Math.min(0.25, (now - last) / 1000 || 0);
      last = now; acc += dt;
      if (acc < (still ? 1 : 1 / 15)) return; // 초당 15장이면 도트 화면에 충분하다. 동작 줄이기 설정이면 1초에 한 장.
      try {
        var view = getView();
        if (!still) step(model, view, acc);
        draw(ctx, model, view);
      } catch (e) { /* 그림 한 장의 오류가 게임을 멈추지 않게 한다 */ }
      acc = 0;
    }
    fit();
    window.addEventListener('resize', fit);
    requestAnimationFrame(frame);
    return {
      poke: function () { poke(model); },
      night: function (defended) { night(model, defended); },
      travel: function (from, dir) { return still ? false : travel(model, from, dir); },
      model: model
    };
  }

  return { wallStyle: wallStyle, WALL_STYLES: WALL_STYLES, leadWeapon: leadWeapon, leadWeight: leadWeight, SHOT_MAX: SHOT_MAX, ZOMBIE_TYPES: ZOMBIE_TYPES, pickSpecial: pickSpecial, zombieType: zombieType, zombieFrames: zombieFrames, fogStrength: fogStrength, glow: glow, WEAPONS: WEAPONS, BOSS_HP: BOSS_HP, CORPSE_TIME: CORPSE_TIME, CORPSE_MAX: CORPSE_MAX, facilityTier: facilityTier, stockCrates: stockCrates, STOCK_MAX: STOCK_MAX, baseStage: baseStage, BASE_STAGES: BASE_STAGES, roomSlot: roomSlot, ROOMS: ROOMS, HORDES: HORDES, SURGE_EXTRA: SURGE_EXTRA, hordeFor: hordeFor, H: H, GROUND: GROUND, WALL_X: WALL_X, WALL_WIDE: WALL_WIDE, DUSK: DUSK, SEARCH_TIME: SEARCH_TIME, SQUAD_TIME: SQUAD_TIME,
           lerpColor: lerpColor, colorNear: colorNear, skyAt: skyAt, dangerTier: dangerTier, dangerSky: dangerSky, pilesFor: pilesFor, wallFor: wallFor, squadAt: squadAt, weatherFor: weatherFor,
           paintPet: paintPet, petRows: petRows, PET_H: PET_H, PET_W: PET_W, paintPetBig: paintPetBig, PET_SPEC: PET_SPEC,
           drawFlag: drawFlag, flagRows: flagRows, drawHero: drawHero, paintLara: paintLara, paintLaraFx: paintLaraFx, laraRows: laraRows, laraPattern: laraPattern, LARA_W: LARA_W, LARA_H: LARA_H, LARA_HOODS: LARA_HOODS, LARA_BAGS: LARA_BAGS, travel: travel, shownZone: shownZone, TRAVEL_TIME: TRAVEL_TIME,
           create: create, resize: resize, step: step, poke: poke, night: night, draw: draw, mount: mount };
});
