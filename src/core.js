/*
 * GameCore — 7구역의 규칙 (알파 0.6 부터의 새 구조)
 * ------------------------------------------------------------
 * 화면(DOM)을 만지지 않는 순수 모듈. 브라우저와 Node(테스트) 양쪽에서 쓴다.
 *
 * 한 판의 흐름
 *   1구역에서 시작해 7구역까지 거점을 쌓아 올린다. 구역을 넘어가도 앞 구역은 남아서 계속 물자를 보낸다.
 *   구역마다 하는 일이 다르다(1구역 수색, 2구역 거래, ...). 구역의 목표를 달성할 때마다 특전을 하나 고른다.
 *   뒤 구역으로 갈수록 필요한 양이 가파르게 늘어 벽에 막힌다. 그때 철수하면 거점을 전부 버리고 1구역에서
 *   다시 시작하는 대신 항체 샘플을 얻는다. 항체 샘플로 찍는 영구 특성은 철수해도 남는다.
 *
 * 모듈 구성(위에서 아래로)
 *   상수 · 정의표(구역, 시설, 방벽, 구역 강화, 특전, 특성, 이야기)
 *   상태(createState, sanitizeState) · 보너스 합산(mods)
 *   1구역 수색 · 2구역 거래 · 직접 수색 · 구역 목표와 다음 구역
 *   밤과 방벽 · 구조 신호 · 특전 · 철수와 영구 특성 · 이야기
 *   시간 진행(tick) · 자리 비움(applyOffline) · 안내 · 저장 · 숫자 표기
 *
 * 알파 0.5 까지의 규칙(지구 A~Z 를 182번 이주하던 구조)은 legacy/core-v1.js 에 남겨 두었다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GameCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var HERO_DEFAULT = '라라';      // 주인공의 기본 이름. 일지 속에서 사람들이 이 이름으로 부른다

  /* ---------- 상수 ---------- */
  var SAVE_VERSION = 2;            // 구조가 달라져 알파 0.5 까지의 저장(버전 1)은 읽지 않는다
  var DAY_SECONDS = 60;            // 현실 60초 = 게임 속 하루
  var BATTLE_SECONDS = 10;         // 하루의 마지막 10초는 무리가 도착해 싸우는 시간
  var GROWTH = 1.15;               // 시설·좌판을 하나 더 살 때마다 값이 오르는 배수
  var DEFENSE_GROWTH = 1.2;        // 방벽 값이 오르는 배수
  var MILESTONES = [10, 25, 50, 100, 150, 200, 300, 400]; // 한 시설이 이 수에 닿을 때마다 그 시설의 생산 2배
  var COUNT_MAX = 500;             // 시설 한 종류의 최대 수
  var BASE_DEFENSE = 5;            // 방벽이 하나도 없을 때의 방어력
  var HORDE_BASE = 8;              // 첫 밤의 무리 규모
  var HORDE_GROWTH = 1.13;         // 밤마다 무리가 커지는 배수
  var BOSS_EVERY = 10;             // 이 밤마다 변이체가 온다
  var BOSS_STRENGTH = 2.5;         // 변이체가 이끄는 무리의 규모 배수
  var BOSS_REWARD = 2;             // 변이체를 막았을 때의 전리품 배수(1.5.2: 5 → 2. 대신 특전 하나를 고른다)
  var NIGHT_REWARD_SECONDS = 20;   // 밤을 막으면 생산 이만큼의 초치 물자를 얻는다
  var WAVE_BONUS = 0.02;           // 이번 판에서 막아낸 밤 한 번마다 전체 생산 +2%
  var BREACH_LOSS = 0.15;          // 뚫릴 때 잃는 물자의 비율
  var CLICK_SHARE = 0.01;          // 직접 수색 한 번의 기본 몫: 초당 생산의 1%
  var SIGNAL_FIRST = 120, SIGNAL_MIN = 90, SIGNAL_SPREAD = 90, SIGNAL_WINDOW = 20;
  var SIGNAL_SUPPLY_SECONDS = 90, SIGNAL_SUPPLY_MIN = 50, BUFF_MULT = 3, BUFF_SECONDS = 30;
  var OFFLINE_CAP = 4 * 3600;      // 자리 비움으로 인정하는 최대 시간
  var OFFLINE_RATE = 0.5;          // 자리 비움 동안의 생산 효율
  var PERK_CHOICES = 3;            // 특전을 고를 때 내미는 장수
  // 1구역 수색 지도
  var SWEEP_COLS = 5, SWEEP_ROWS = 4, SWEEP_TILES = SWEEP_COLS * SWEEP_ROWS;   // 동네 하나는 5×4 = 20칸
  var SWEEP_AUTO_SECONDS = 3;      // 시설이 있으면 이 시간마다 한 칸을 알아서 뒤진다
  var SWEEP_BONUS_CLICKS = 3;      // 동네 하나를 다 뒤졌을 때의 보너스: 직접 수색 이만큼의 몫
  // 칸의 종류: 뒤졌을 때 직접 수색 수익에 곱하는 값과, 100칸 가운데 몇 칸쯤 나오는가
  var TILE_KINDS = [
    { id: 'house', name: '빈집', mult: 1,   weight: 60 },
    { id: 'store', name: '가게', mult: 1.25, weight: 30 },
    { id: 'cache', name: '은닉처', mult: 2, weight: 10 }
  ];
  // 2구역 거래
  var PRICE_STEP = 10;             // 시세가 바뀌는 간격(초)
  var PRICE_FLOOR = 0.5, PRICE_CEIL = 2;  // 기본 시세의 범위
  var GOODS_VALUE = 180;           // 상품 하나의 기준 값(물자)
  var GOODS_CAP_SECONDS = 60;      // 창고에 쌓아 둘 수 있는 양(좌판 생산의 초 수)
  var PRICE_HISTORY = 14;          // 시세판에 남겨 두는 지난 시세의 수
  var STREAK_MAX = 5;              // 연속 호가의 최대 단계
  var STREAK_BONUS = 0.1;          // 연속 호가 한 단계마다 직접 판매에 붙는 비율(+10%)
  var PEAK_PRICE = 1.8;            // '고점 판매'로 치는 시세
  // 3구역 생산 라인
  var PRODUCT_VALUE = 2e8;          // 완제품 하나의 기준 값(물자)
  var STEADY_AT = 0.9;             // 가동률이 이 이상이면 '정속 가동'
  var STEADY_BONUS = 0.5;          // 정속 가동일 때 라인 산출에 더하는 비율(+50%)
  var SURGE_MULT = 2;              // 전력 투입 중의 라인 산출 배수
  var SURGE_SECONDS = 15;          // 전력 투입이 이어지는 시간
  var SURGE_COOLDOWN = 90;         // 다시 쓸 수 있을 때까지의 시간(투입을 누른 때부터)
  var ASSIST_MAX = 9;              // 영구 특성 '자동화'의 최대 레벨
  var ASSIST_STEP = 0.06;          // 자동화 2레벨부터 레벨마다 줄어드는 대기 시간의 비율
  var LINE_MILESTONES = [15, 30, 60, 100, 150, 220, 300, 400, 520, 660, 820, 1000]; // 기계 레벨 합계가 이 수에 닿을 때마다 라인 산출 2배
  // 4구역 노선
  var TRAIN_VALUE = 1e14;          // 열차 한 대가 운행 1초마다 싣는 화물의 기준 값(물자)
  var TRAIN_GROWTH = 1.4;          // 열차를 한 대 더 살 때마다 값이 오르는 배수
  var TRAIN_COST = 6e17;           // 첫 열차의 값
  var TRAIN_MAX = 100;             // 열차의 최대 수
  var ROUTE_GROWTH = 2.2;          // 노선을 한 단계 늘릴 때마다 값이 오르는 배수
  var ROUTE_SLOTS = 2;             // 노선 한 단계마다 다닐 수 있는 열차 수
  var ROUTE_MAX = 25;              // 노선의 최대 단계
  var GREEN_SECONDS = 30;          // 청신호 한 번에 열차들이 앞서 달리는 시간
  var GREEN_COOLDOWN = 120;        // 청신호를 다시 켤 수 있을 때까지의 시간
  var FLEET_MILESTONES = [4, 8, 12, 16, 24, 32, 48, 64, 80, 100]; // 열차가 이 수에 닿을 때마다 화물 2배
  // 5구역 연구
  var STAFF_COST = 3e22;           // 첫 연구원의 값
  var LAB_VALUE = 2e18;            // 연구원 한 명이 초당 만드는 약품의 값(개조와 전체 배수를 곱하기 전)
  var STAFF_GROWTH = 1.25;         // 연구원을 한 명 더 뽑을 때마다 값이 오르는 배수
  var PROJECT_BASE = 60;           // 첫 연구 과제에 드는 연구 점수
  var PROJECT_GROWTH = 1.8;        // 과제를 하나 끝낼 때마다 다음 과제의 점수가 오르는 배수
  var OFFER_COUNT = 3;             // 한 번에 내미는 과제 수
  var REROLL_SHARE = 0.25;         // 과제를 다시 뽑는 데 드는 점수: 지금 과제 값의 이 비율
  var SUPPLY_DROP_SECONDS = 600;   // '보급 요청' 과제가 주는 물자: 생산 이만큼의 초치
  // 동물 친구
  var PET_NAME_MAX = 8;            // 이름의 최대 글자 수
  /*
   * 동물 친구: 강아지나 고양이 가운데 하나를 고르면, 그 종류 안에서 어떤 아이가 올지는 무작위다.
   *   kind 에 따라 효과가 다르다(PET_KINDS). 품종은 생김새와 기본 이름만 다르다. 철수해도 함께 간다.
   *   body·patch 는 도트 그림의 몸 색과 무늬 색이다.
   */
  var PET_KINDS = {
    dog: { name: '강아지', what: '밤마다 방벽을 지킨다', label: '방어력', key: 'defense' },
    cat: { name: '고양이', what: '창고의 쥐를 잡는다', label: '전체 생산', key: 'prod' }
  };
  /*
   * 등급: 데려올 때 weight 의 비율로 정해진다(100 가운데). 등급이 높을수록 효과가 크다.
   *   dog·cat 은 그 등급의 강아지·고양이가 올려 주는 비율(0.1 = +10%).
   */
  var PET_RARITIES = [
    { id: 'common', name: '기본', weight: 70, dog: 0.10, cat: 0.05 },
    { id: 'fine',   name: '고급', weight: 24, dog: 0.20, cat: 0.10 },
    { id: 'rare',   name: '희귀', weight: 6,  dog: 0.35, cat: 0.20 }
  ];
  var PET_PULL_MIN = 2;            // 다시 데려오기에 드는 항체 샘플의 최소값
  var PET_PULL_SHARE = 0.05;       // 다시 데려오기 값: 지금까지 얻은 항체 샘플 총량의 이 비율(판이 커져도 값이 헐해지지 않게)
  var PET_DUP_REFUND = 0.5;        // 이미 함께 있는 아이가 또 나왔을 때 돌려받는 비율
  var PET_BREEDS = [
    { id: 'jindo',   kind: 'dog', rarity: 'common', name: '흰둥이', body: '#e9e4d6', patch: '#e9e4d6' },
    { id: 'nureong', kind: 'dog', rarity: 'common', name: '누렁이', body: '#b9853f', patch: '#e9d9b0' },
    { id: 'black',   kind: 'dog', rarity: 'fine',   name: '검둥이', body: '#2b2a28', patch: '#2b2a28' },
    { id: 'spot',    kind: 'dog', rarity: 'fine',   name: '바둑이', body: '#e9e4d6', patch: '#2b2a28' },
    { id: 'sapsal',  kind: 'dog', rarity: 'rare',   name: '삽살이', body: '#a9a39a', patch: '#f0b400' },
    { id: 'wolf',    kind: 'dog', rarity: 'rare',   name: '늑대개', body: '#5d6470', patch: '#e6e5db' },
    { id: 'cheese',  kind: 'cat', rarity: 'common', name: '치즈',   body: '#e0a04a', patch: '#f3e3c3' },
    { id: 'tabby',   kind: 'cat', rarity: 'common', name: '고등어', body: '#7d7f84', patch: '#3c3e44' },
    { id: 'tuxedo',  kind: 'cat', rarity: 'fine',   name: '턱시도', body: '#26262a', patch: '#f1efe8' },
    { id: 'calico',  kind: 'cat', rarity: 'fine',   name: '삼색이', body: '#f1efe8', patch: '#d0782e' },
    { id: 'siam',    kind: 'cat', rarity: 'rare',   name: '샴',     body: '#e8dcc4', patch: '#4a3628' },
    { id: 'nero',    kind: 'cat', rarity: 'rare',   name: '네로',   body: '#17171a', patch: '#f0b400' },
    // 0.9.1: 강아지 여섯, 고양이 여섯을 더해 모두 24종
    { id: 'shiba',   kind: 'dog', rarity: 'common', name: '시바',   body: '#d9903d', patch: '#f3e3c3' },
    { id: 'poodle',  kind: 'dog', rarity: 'common', name: '푸들',   body: '#c9a27a', patch: '#b08a62' },
    { id: 'husky',   kind: 'dog', rarity: 'fine',   name: '허스키', body: '#8d95a3', patch: '#f1efe8' },
    { id: 'corgi',   kind: 'dog', rarity: 'fine',   name: '코기',   body: '#e0a04a', patch: '#f1efe8' },
    { id: 'pungsan', kind: 'dog', rarity: 'rare',   name: '풍산이', body: '#f4f1ea', patch: '#cfd6dd' },
    { id: 'dalma',   kind: 'dog', rarity: 'rare',   name: '달마',   body: '#f1efe8', patch: '#17171a' },
    { id: 'white',   kind: 'cat', rarity: 'common', name: '흰냥이', body: '#f1efe8', patch: '#e2ddd0' },
    { id: 'gray',    kind: 'cat', rarity: 'common', name: '회색이', body: '#9a9da3', patch: '#c9ccd1' },
    { id: 'bengal',  kind: 'cat', rarity: 'fine',   name: '벵갈',   body: '#c98a3c', patch: '#4a3628' },
    { id: 'russian', kind: 'cat', rarity: 'fine',   name: '러블',   body: '#6f7f95', patch: '#8a98ab' },
    { id: 'ragdoll', kind: 'cat', rarity: 'rare',   name: '랙돌',   body: '#f1efe8', patch: '#7a6a5c' },
    { id: 'golden',  kind: 'cat', rarity: 'rare',   name: '금냥이', body: '#f0b400', patch: '#fff3c4' }
  ];
  /*
   * 좀비 도감: 15종. 밤이 지날 때마다 그날 무리에 섞여 있던 것을 만난 것으로 적는다(zdex 에 만난 횟수).
   *   rarity : common 흔함, uncommon 드묾, rare 희귀, epic 아주 희귀
   *   zone   : 이 구역(0부터)을 열어야 나온다,  chance : 밤마다 나올 확률,  boss : 변이체가 오는 밤에만 나온다
   *   frames : 도감 그림의 몸(도트 화면의 walker·hair·runner·brute 가운데 하나),  pal : 옷 색(c 윗옷, d 바지, g 살, h 머리)
   * 만남은 날짜로 정해지는 수(sightRoll)로 가린다: 같은 날은 늘 같은 결과라서 저장했다 불러와도 달라지지 않는다.
   */
  var ZOMBIE_RARITIES = { common: '흔함', uncommon: '드묾', rare: '희귀', epic: '아주 희귀' };
  var ZOMBIE_KINDS = [
    { id: 'walker',    name: '배회자',     rarity: 'common',   zone: 0, chance: 1,     frames: 'walker', pal: {}, text: '가장 흔해요. 느리지만 끝없이 와요.' },
    { id: 'hair',      name: '긴 머리',    rarity: 'common',   zone: 0, chance: 0.6,   frames: 'hair',   pal: {}, text: '머리카락에 얼굴이 가려져 있어요.' },
    { id: 'runner',    name: '달리는 것',  rarity: 'common',   zone: 0, chance: 0.4,   frames: 'runner', pal: {}, text: '몸을 숙이고 뛰어와요. 가장 빨라요.' },
    { id: 'brute',     name: '덩치',       rarity: 'common',   zone: 0, chance: 0.3,   frames: 'brute',  pal: {}, text: '어깨가 넓고 한 발을 더 버텨요.' },
    { id: 'vendor',    name: '좌판 상인',  rarity: 'uncommon', zone: 1, chance: 0.2,   frames: 'walker', pal: { c: '#b8402e', d: '#4a3a2a' }, text: '앞치마를 아직 두르고 있어요.' },
    { id: 'worker',    name: '작업복',     rarity: 'uncommon', zone: 2, chance: 0.2,   frames: 'brute',  pal: { c: '#3f6f8f', d: '#2a4a60' }, text: '공단의 푸른 작업복을 입었어요.' },
    { id: 'commuter',  name: '통근객',     rarity: 'uncommon', zone: 3, chance: 0.2,   frames: 'walker', pal: { c: '#2b2d38', d: '#1c1d26' }, text: '양복을 입고 가방을 놓지 않아요.' },
    { id: 'patient',   name: '환자복',     rarity: 'uncommon', zone: 4, chance: 0.2,   frames: 'hair',   pal: { c: '#cfe0ea', d: '#cfe0ea' }, text: '병원에서 걸어 나왔어요.' },
    { id: 'boss',      name: '변이체',     rarity: 'uncommon', zone: 0, chance: 1,     frames: 'walker', pal: { g: '#9a5ac8', c: '#3a2a4a' }, boss: true, big: true, text: '몇 밤에 한 번 무리를 이끌고 와요.' },
    { id: 'student',   name: '체육복',     rarity: 'rare',     zone: 1, chance: 0.04,  frames: 'runner', pal: { c: '#2f4f8f', d: '#2f4f8f' }, text: '가슴에 이름표가 달려 있어요.' },
    { id: 'guard',     name: '경비원',     rarity: 'rare',     zone: 2, chance: 0.04,  frames: 'brute',  pal: { c: '#30343c', d: '#17180f', h: '#17180f' }, text: '손전등을 아직 쥐고 있어요.' },
    { id: 'conductor', name: '역무원',     rarity: 'rare',     zone: 3, chance: 0.04,  frames: 'walker', pal: { c: '#1f3a5a', d: '#17180f', h: '#b8402e' }, text: '붉은 모자를 쓰고 승강장을 돌아요.' },
    { id: 'nurse',     name: '간호사',     rarity: 'rare',     zone: 4, chance: 0.04,  frames: 'hair',   pal: { c: '#f1efe8', d: '#f1efe8', h: '#4a3628' }, text: '주머니에 체온계가 꽂혀 있어요.' },
    { id: 'glow',      name: '야광',       rarity: 'epic',     zone: 0, chance: 0.01,  frames: 'walker', pal: { g: '#b8ff7a', c: '#3a5a2a' }, text: '어둠 속에서 희미하게 빛나요.' },
    { id: 'raincoat',  name: '노란 우비',  rarity: 'epic',     zone: 0, chance: 0.004, frames: 'hair',   pal: { c: '#f0b400', d: '#c98f00', h: '#f0b400' }, text: '누구일까요. 멀리서만 보여요.' }
  ];
  /** 날짜와 차례로 정해지는 0 이상 1 미만의 수(같은 입력에는 늘 같은 값). */
  function sightRoll(day, k) { var v = Math.sin(day * 12.9898 + (k + 1) * 78.233) * 43758.5453; return v - Math.floor(v); }
  /** 그날 밤 무리에 섞여 있던 좀비를 도감에 적는다. 처음 만난 종류의 목록을 돌려준다. */
  function sightZombies(state, day, boss) {
    var found = [];
    ZOMBIE_KINDS.forEach(function (z, k) {
      if (z.zone > state.zone) return;
      var hit = z.boss ? !!boss : sightRoll(day, k) < z.chance;
      if (!hit) return;
      if (!state.zdex[z.id]) found.push({ id: z.id, name: z.name, rarity: z.rarity });
      state.zdex[z.id] = Math.min(1e9, (state.zdex[z.id] || 0) + 1);
    });
    return found;
  }
  /**
   * 오늘 밤 무리에 섞여 올 "흔하지 않은" 좀비들(도트 화면이 미리 그릴 수 있게 알려 준다).
   * sightZombies 와 같은 주사위(날짜로 정해짐)를 쓰므로, 화면에 보인 것이 밤이 끝나면 도감에 적힌다.
   * 흔한 넷은 늘 섞여 오고 변이체는 따로 그리므로 여기서는 뺀다.
   */
  function nightSpecials(state, day) {
    var out = [];
    if (!state || typeof day !== 'number' || !isFinite(day)) return out;
    ZOMBIE_KINDS.forEach(function (z, k) {
      if (z.boss || z.rarity === 'common' || z.zone > state.zone) return;
      if (sightRoll(day, k) < z.chance) out.push({ id: z.id, frames: z.frames, pal: z.pal, glow: z.id === 'glow' });
    });
    return out;
  }
  function zdexCount(state) { var n = 0; ZOMBIE_KINDS.forEach(function (z) { if (state.zdex[z.id] > 0) n++; }); return n; }
  // 철수
  var RETREAT_MIN = 1e8;           // 이번 판에서 이만큼은 모아야 철수할 수 있다(2구역에 들어선 무렵)
  var RETREAT_K = 2, RETREAT_POW = 0.3;  // 항체 = K × (이번 판 누적 물자 ÷ RETREAT_MIN)^POW. 물자를 100배 더 모으면 항체는 6배쯤

  /* ---------- 정의표 ---------- */
  /*
   * 구역: kind 가 그 구역에서 하는 일. 'soon' 은 아직 만들지 않은 구역(문 앞까지만 갈 수 있다).
   *   cost  : 그 구역의 문을 여는 데 드는 물자
   *   story : 그 구역에 들어설 때, 목표 둘을 채웠을 때, 목표를 모두 채웠을 때 열리는 일지 3편.
   *           한 편은 { title 제목, text [문단, ...] }. 주인공(노란 우비를 입은 아이)이 쓰는 글이다.
   */
  var ZONES = [
    { no: 1, name: '주택가', kind: 'search', cost: 0, lead: '잔해를 수색하고 사람을 모은다',
      story: [
        { title: "열두 번째 날", text: [
          "사태 12일째. 무전기는 오늘도 같은 말만 한다. “여기는 7구역. 생존자는 7구역으로 오라.” 여자 목소리다. 숨 쉴 틈도 없이 되풀이한다.",
          "엄마는 사흘 전 밤에 나갔다. 병원에 다녀온다고 했다. 현관에서 노란 우비를 내 어깨에 걸쳐 주고, 파란 냉장 상자를 내 무릎에 올려놓았다. “열지 마. 엄마가 안 오면 이걸 들고 7구역으로 가.”",
          "나는 왜냐고 묻지 않았다. 엄마의 손이 떨리고 있었기 때문이다. 그 손이 내 왼쪽 소매를 끝까지 내려 주었다. 그 아래에 뭐가 있는지는 엄마와 나만 안다.",
          "통조림은 엿새 치가 남았다. 창밖 골목에는 어제보다 하나가 더 서 있다. 지도를 펴 보니 여기는 1구역이다. 7은 강 건너, 지도의 맨 끝에 있다.",
          "기다리는 건 오늘까지만 하기로 했다. 내일부터는 내가 찾으러 나간다. 옆집부터, 한 집씩."] },
        { title: "지붕 위의 7", text: [
          "옆집 지붕에 누가 흰 페인트로 숫자를 써 놓았다. 7, 그리고 화살표. 화살표는 강 쪽을 가리킨다. 다음 집 지붕에도, 그 다음 집에도 있다. 누군가 지붕을 타고 가면서 길을 남긴 것이다.",
          "세 번째 집 다락에서 사람들을 만났다. 정수기 기사였다는 아저씨, 쌍둥이를 데리고 있는 아주머니, 말이 없는 {student}. 다들 같은 방송을 듣고 있었다. 아주머니가 이름을 물어서 {hero}라고 했다. 쌍둥이들이 그 이름을 세 번쯤 따라 불렀다.",
          "아저씨가 물었다. “{hero:야}, 그 상자엔 뭐가 들었냐.” 나는 모른다고 했다. 정말로 모른다. 아저씨는 더 묻지 않고 내 우비의 모자를 씌워 주었다. “비 온다. 노란색이라 멀리서도 보이겠네. 길 잃을 일은 없겠다.”",
          "밤에 방벽 너머에서 손톱으로 철판을 긁는 소리가 났다. 사람들이 숨을 죽였다. 나는 왼쪽 소매를 꼭 쥐고 있었다. 소매 아래가 가려웠다. 엄마가 긁지 말라고 했다.",
          "사람들은 내가 추워서 우비를 안 벗는 줄 안다. 그렇게 알게 두기로 했다."] },
        { title: "남겨 두는 것", text: [
          "동네의 통조림이 바닥을 보인다. 찾아볼 집이 이제 없다. 골목 끝에 셔터 내린 시장이 보인다. 다음은 거기다.",
          "떠나기 전에 아저씨가 이상한 일을 시켰다. 창고의 절반을 그대로 두고 가자는 것이다. 물, 통조림, 건전지. 문에는 분필로 썼다. “쓰고 채워 놓을 것.”",
          "{student:이} 화를 냈다. 우리도 모자란데 누굴 주냐고. 아저씨는 지붕을 가리켰다. “저 숫자 써 놓은 사람도 모자랐을 거다. 그래도 썼잖냐.”",
          "나는 우리 집 현관에 쪽지를 붙였다. “엄마, 나 7구역으로 가. 상자는 잘 들고 있어. — {hero}” 붙이고 나서 한참 서 있었다. 엄마가 이걸 읽을 일이 있을까.",
          "돌아보지 않으려고 했는데 한 번 돌아봤다. 지붕 위의 7이 비에 젖어 번들거렸다."] }] },
    { no: 2, name: '재래시장', kind: 'trade', cost: 5e9, lead: '좌판을 열고 시세를 봐 가며 판다',
      story: [
        { title: "저울", text: [
          "2구역. 시장 골목은 셔터가 전부 내려가 있다. 그런데 좌판 하나에 저울이 그대로 놓여 있었다. 바늘이 0을 가리키고 있다. 누가 닦아 놓은 것처럼 깨끗하다.",
          "저울 주인은 건어물 가게 뒤에 숨어 있던 할머니였다. 할머니는 우리를 보자마자 말했다. “공짜는 없어. 뭘 가져왔는지부터 보자꾸나.”",
          "아저씨가 통조림 두 개를 올렸다. 할머니는 무게를 달고, 멸치 한 봉지를 내주고, 장부에 적었다. 세상이 이렇게 됐는데 장부를 쓴다. 나는 그게 이상하게 마음이 놓였다.",
          "“물건이 있으면 사람이 오고, 사람이 오면 소문이 돌아. 소문이 돌면 살 길도 보이는 법이지.” 할머니는 저울을 툭 쳤다. “장사는 그러자고 하는 거야.”",
          "그날 저녁에 벌써 두 사람이 더 왔다. 한 사람은 라디오 건전지를 들고 왔다."] },
        { title: "3반 일동", text: [
          "생선 가게 냉동고를 열었다가 쪽지를 찾았다. 비닐에 싸서 얼음 틈에 끼워 놓았다. “먼저 갑니다. 7구역에서 만나요. 3반 일동.”",
          "글씨를 알아봤다. 반장 글씨다. 받침을 꼭 네모나게 쓴다. 3반은 우리 반이다.",
          "쪽지 뒷면에는 이름이 적혀 있었다. 열일곱 명. {hero}, 내 이름은 없다. 나는 그 주에 학교에 가지 않았다. 열이 나서. 엄마가 밤새 내 팔에서 피를 뽑던 그 주다.",
          "할머니가 쪽지를 들여다보고 말했다. “애들끼리 갔구나. 어른 이름이 하나도 없네.” 그러고는 멸치를 한 줌 더 싸 주었다. 장부에는 적지 않았다.",
          "열일곱 명이 이 길을 먼저 지나갔다. 그러니까 이 길은 갈 수 있는 길이다. 나는 쪽지를 접어서 냉장 상자 손잡이에 묶었다."] },
        { title: "같은 방향", text: [
          "시장이 다시 시끄럽다. 좌판이 스무 개를 넘었다. 할머니는 목이 쉬었다.",
          "그런데 밤마다 무리가 불어난다. 망을 보던 {student:이} 이상한 걸 알아챘다. 놈들은 우리를 보고 오는 게 아니다. 시장 앞을 그냥 지나간다. 우리가 소리를 내면 그때 고개를 돌린다.",
          "전부 같은 쪽으로 걷는다. 강 쪽이다. 우리가 가려는 방향이다.",
          "밤에 혼자 무전기를 켰다. “여기는 7구역. 생존자는 7구역으로 오라.” 방벽 너머에서 발소리가 멈췄다. 틈으로 내다보니, 골목의 놈들이 전부 서 있었다. 고개를 한쪽으로 기울이고. 듣고 있었다.",
          "나는 무전기를 껐다. 발소리가 다시 시작됐다. 이 얘기는 아직 아무한테도 하지 않았다."] }] },
    { no: 3, name: '공단', kind: 'line', cost: 8e11, lead: '멈춘 공장의 기계 셋을 맞물려 돌린다',
      story: [
        { title: "멈춘 자리", text: [
          "3구역. 공단의 철문은 안쪽에서 잠겨 있었다. 밖에서 잠근 게 아니다. 안에 있던 사람들이 잠그고, 다른 길로 나간 것이다.",
          "문을 뜯고 들어가니 기계들이 멈춘 자리 그대로 서 있다. 컨베이어 위에는 만들다 만 것들이 한 줄로 늘어서 있다. 맨 앞의 것에는 나사가 세 개 박혀 있고, 그 다음은 두 개, 그 다음은 하나.",
          "누군가 네 번째 나사를 박으려다 손을 놓았다. 드라이버가 바닥에 떨어져 있다. 그 옆에 보온병. 뚜껑을 여니 아직 커피 냄새가 났다.",
          "아저씨가 배전반을 열어 보고 휘파람을 불었다. “죽은 게 아니야. 꺼 놓은 거지. 순서대로, 얌전하게.” 여기 사람들은 도망친 게 아니라 퇴근한 것이다.",
          "나는 드라이버를 주워서 제자리에 걸어 두었다. 벽에 공구 모양대로 그림자가 그려져 있었다."] },
        { title: "야간조", text: [
          "사무실 책상에서 작업 일지를 찾았다. 마지막 장. “야간조 전원 7구역으로 이동. 설비는 두고 간다. 돌릴 줄 아는 사람이 오면 쓰라.”",
          "그 아래에 다른 글씨로 한 줄이 더 있다. “프레스 2번은 왼쪽으로 쏠린다. 발로 한 번 차 주면 된다. 미안하다, 못 고치고 간다.”",
          "아저씨가 프레스 2번을 찼다. 정말로 돌았다. 다들 웃었다. 쌍둥이들이 따라서 기계를 차고 다녀서 아주머니한테 혼이 났다.",
          "일지 사이에 사진이 끼워져 있었다. 작업복을 입은 사람들이 공장 앞에 줄지어 서 있다. 뒷줄의 한 사람이 간호사복을 입고 있다. 얼굴은 구겨져서 보이지 않는다. 손에 파란 상자를 들고 있다.",
          "나는 사진을 오래 봤다. 파란 상자는 세상에 많다. 그렇게 생각하기로 했다."] },
        { title: "불빛", text: [
          "라인이 돈다. 밤에도 공단에 불이 켜진다. 불빛을 보고 사람이 온다. 어제는 여섯, 오늘은 열하나.",
          "소리를 듣고 무리도 온다. 오늘 밤 철망 앞에 선 것들 가운데 하나가 체육복을 입고 있었다. 우리 학교 체육복이다. 가슴에 이름표가 그대로 달려 있다.",
          "반장이었다. 받침을 네모나게 쓰던 애. 쪽지에 제일 먼저 이름을 적은 애.",
          "반장은 철망을 잡고 흔들지 않았다. 그냥 서서 강 쪽을 보고 있었다. 내가 이름을 불렀다. 고개가 아주 천천히 돌아왔다. 입이 한 번 움직였다. 소리는 없었지만 나는 그 모양을 안다. {hero}. 그리고 내 노란 우비를 한참 봤다. 나는 그 눈이 나를 알아봤다고 지금도 생각한다.",
          "철망 사이로 반장의 손이 나와 내 왼쪽 소매를 잡았다. 망을 보던 사람들이 소리를 질렀다. 놈들은 산 사람을 잡으면 문다. 그런데 반장은 물지 않았다. 소매에 코를 대고 한참 있다가, 놓았다. 아무도 그 까닭을 묻지 않았고 나도 말하지 않았다.",
          "새벽에 무리가 움직이자 반장도 따라갔다. 선로 쪽으로. 열일곱 명 중에 몇이나 건넜을까. 나는 쪽지 뒷면의 이름 하나에 줄을 그었다. 선로를 따라가면 환승역이다."] }] },
    { no: 4, name: '환승역', kind: 'rail', cost: 1e19, lead: '끊긴 노선을 잇고 열차를 보낸다',
      story: [
        { title: "행선지", text: [
          "4구역. 환승역 계단을 내려가니 선로가 네 갈래로 갈라진다. 역 안은 캄캄한데 전광판 하나만 켜져 있다. 행선지: 7구역. 도착 예정: --분.",
          "승강장에 열차 한 대가 문을 연 채 서 있다. 좌석마다 가방이 놓여 있다. 사람은 없다. 가방들만 줄 맞춰 앉아서 출발을 기다리고 있다.",
          "맨 앞 칸에서 기관사를 찾았다. 살아 있었다. 운전석에 앉아서 컵라면을 먹고 있었다. “손님이네. 표는 없어도 돼. 이름이 뭐야?” {hero}라고 했더니 승무 일지에 그대로 받아 적었다.",
          "{driver:은} 열이틀째 여기 있었다고 했다. 전기가 나갔는데 왜 안 떠났느냐고 물으니 전광판을 가리켰다. “저게 안 꺼지잖아. 저게 켜져 있는 동안은 운행 중인 거야. 내가 정한 건 아니고.”",
          "아저씨가 변전실을 보러 갔다. 나는 {driver} 옆에 앉아서 전광판을 봤다. --분. 숫자가 들어갈 자리가 비어 있다."] },
        { title: "막차", text: [
          "역무실 칠판에 분필 글씨가 남아 있다. “막차는 7구역행. 못 탄 사람은 선로를 따라 걸을 것. 터널 안에서는 소리 내지 말 것.” 마지막 줄에는 밑줄이 세 번 그어져 있다.",
          "끊긴 선로를 보러 터널에 들어갔다. {driver:이} 앞장서고 내가 손전등을 들었다. 터널 벽에 손자국이 있다. 어른 것, 그리고 그 아래 내 손만 한 것들. 열 몇 개. 벽을 짚으며 걸어간 자국이다.",
          "한가운데쯤 왔을 때 가방 속 무전기가 저절로 켜졌다. “여기는 7구역. 생존자는—” {driver:이} 내 입을 막았다. 입을 막을 건 내가 아닌데. 나는 가방을 끌어안고 스위치를 더듬었다.",
          "끄기 직전에 들었다. 문장과 문장 사이에 아주 작은 소리가 있다. 딸깍. 테이프가 처음으로 돌아가는 소리다. 방송은 누가 말하고 있는 게 아니다. 녹음이다.",
          "터널 저쪽 어둠에서 수십 개의 발이 한꺼번에 멈췄다가, 한참 뒤에 다시 걷기 시작했다. 우리는 그 자리에서 삼십 분을 서 있었다. {driver}의 손이 내 입 위에서 계속 떨렸다.",
          "떨리던 손이 미끄러져 내 왼쪽 소매를 걷어 올렸다. 손전등 빛에 그것이 드러났다. 이빨 자국. 아홉 번째 날에 물린 자리다. {driver:은} 숨을 삼켰지만 손을 떼지 않았다. 물리면 반나절이라고들 한다. 나는 그때 벌써 몇 주째 멀쩡했다.",
          "터널을 나와서 {driver:이} 말했다. “방금 그것들, 너를 지나쳐 갔어. 나는 봤는데 너는 안 봤어.” 그러고는 소매를 도로 내려 주었다. 엄마가 하던 것처럼, 끝까지."] },
        { title: "옥상의 불", text: [
          "열차가 다시 다닌다. 멀리 간 열차일수록 많이 싣고 돌아온다. 전광판의 --분 자리에 처음으로 숫자가 들어갔다. {driver:이} 그걸 보고 울었다. 컵라면을 먹으면서.",
          "심야 급행에서 돌아온 {driver:이} 말했다. 강 건너 병원 옥상에 불이 켜져 있다고. 깜박이는 불이라고. 길게, 짧게, 길게.",
          "아저씨가 그건 신호라고 했다. 누가 거기서 손으로 켰다 껐다 하는 거라고. 녹음이 아니라 사람이라고.",
          "나는 녹음 얘기를 그제야 꺼냈다. 방송이 테이프라는 것, 놈들이 그걸 듣는다는 것. 다들 조용해졌다. {student:이} 물었다. “그럼 7구역엔 아무도 없는 거야? 우린 놈들이랑 같이 빈 데로 가고 있는 거야?”",
          "아무도 대답하지 못했다. 나는 방송의 목소리를 한 번 더 떠올렸다. 숨 쉴 틈 없이 말하는 여자. 엄마는 급할 때 그렇게 말한다. 그 생각은 입 밖에 내지 않았다. 다음 급행은 병원 앞까지 간다."] }] },
    { no: 5, name: '대학 병원', kind: 'lab', cost: 1.5e24, lead: '남은 연구를 이어 가며 과제를 고른다',
      story: [
        { title: "감염내과, 7층", text: [
          "5구역. 응급실 문의 쇠사슬을 끊었다. 복도에 비상등이 깜박인다. 안내판의 화살표가 전부 한 곳을 가리킨다. 누가 매직으로 덧그려 놓았다. 감염내과, 7층.",
          "7층. 또 7이다.",
          "계단으로 올라갔다. 층마다 문이 침대로 막혀 있다. 안에서 막은 것이다. 6층 문에는 종이가 붙어 있었다. “이 아래는 포기했습니다. 죄송합니다.”",
          "7층 탈의실에서 사물함 하나가 열려 있었다. 이름표를 읽기 전에 알았다. 문 안쪽에 내 사진이 붙어 있었으니까. 유치원 때 노란 우비를 입고 찍은 사진이다. 지금 입고 있는 건 그때보다 네 치수가 크다.",
          "사물함 안에는 갈아입은 옷과 식은 도시락, 그리고 수첩이 있었다. 연구실 냉장고는 아직 돌아가고 있다. 누가 발전기에 기름을 채우고 있다는 뜻이다."] },
        { title: "114번", text: [
          "수첩은 실험 노트였다. 엄마 글씨다. 마지막 쪽. “샘플 114번에서 반응. 양이 모자란다. 사람이 더 필요하다. 살아서 여기까지 온 사람들의 피가.” 날짜는 사태 9일째.",
          "9일째는 내가 물린 날이다.",
          "앞쪽을 넘겨 봤다. 1번부터 113번까지는 전부 한 줄씩이고, 끝에 같은 말이 적혀 있다. 반응 없음. 114번만 세 쪽이다. “물린 지 6시간, 열 39도. 12시간, 열 내림. 24시간, 밥을 달라고 함.” 그리고 줄을 벅벅 그어 지운 한 줄. 불빛에 비춰 보니 읽을 수 있었다. “{hero:을} 숫자로 적고 있다. {child:을}.”",
          "나는 왼쪽 소매를 걷었다. 이번에는 내 손으로, 모두의 앞에서. 이빨 자국은 하얗게 아물어 있다. 아저씨는 한참 보다가 소매를 도로 내려 주었다. “그래서 비도 안 오는데 맨날 우비를 입고 있었구나.”",
          "쌍둥이 중 하나가 물었다. “그럼 {sib:은} 안 변해?” 나는 모른다고 했다. 엄마도 몰랐을 것이다. 그래서 병원에 온 것이다."] },
        { title: "냉장 상자", text: [
          "연구가 다시 굴러간다. 아주머니는 알고 보니 임상병리사였다. 열이틀 동안 아무도 묻지 않아서 말하지 않았다고 했다.",
          "냉장 상자를 열었다. 엄마가 열지 말라고 했지만, 엄마의 노트가 열라고 하고 있었다. 안에는 피가 든 관이 여섯 개. 라벨은 114-2부터 114-7. 첫 번째 관은 엄마가 들고 간 것이다.",
          "관 아래에 카세트테이프 케이스가 깔려 있었다. 테이프는 없고 케이스만. 엄마 글씨로 적혀 있다. “방송용. 지우지 말 것.” 그리고 뒷면에. “사람을 모으는 방법이 이것밖에 없었다. 놈들도 같이 올 줄은 몰랐다. 미안하다.”",
          "그러니까 7구역에서 오라고 부르는 건 엄마다. 살아남은 사람을, 물리고도 살아남은 사람을 찾으려고. 그리고 엄마가 찾던 건 처음부터 집 다락에서 통조림을 세고 있었다.",
          "옥상에 올라가니 강 건너 검문소의 탐조등이 아직 돈다. 길게, 짧게, 길게. 저 너머가 7구역이다. 나는 우비의 모자를 벗고 손전등을 켰다. 길게, 짧게, 길게."] }] },
    { no: 6, name: '강변 검문소', kind: 'guard', cost: 1.5e27, lead: '다리를 지키며 밀려오는 무리를 막는다',
      story: [
        { title: "다리", text: [
          "다리 입구의 검문소에 닿았다. 차단기는 내려가 있고 초소는 비었다. 탁자 위에 근무 일지가 펼쳐져 있다. 마지막 줄. “통과 17. 그중 아이 16.”",
          "아이 열여섯. 나는 쪽지 뒷면을 꺼내서, 줄 그은 이름 하나를 뺀 나머지를 소리 내어 읽었다. 열여섯 개. 맞다. 그러면 남는 하나는 아이가 아니다. 아이들과 같이 건넌 어른이 하나 있다.",
          "다리 위에는 버려진 차들이 끝까지 늘어서 있다. 그 사이사이에 놈들이 서 있다. 걷지 않는다. 다리 한가운데부터는 전부 멈춰서 건너편을 보고 있다. 방송이 저기서 나오기 때문이다.",
          "그때 건너편 탐조등이 돌던 것을 멈추고 이쪽으로 내려왔다. 빛이 차들을 훑고, 놈들을 훑고, 차단기 앞의 나한테 와서 섰다. 노란 우비가 대낮처럼 환해졌다.",
          "불빛이 한 번 꺼졌다 켜졌다. 그리고 또 한 번. 누가 저기서 나를 보고 있다. 다리를 건너려면 여기를 먼저 지켜야 한다."] },
        { title: "깜박임", text: [
          "탐조등은 밤마다 온다. 길게, 짧게, 길게. 매번 같다. 아저씨는 그게 신호라고 했다. 뜻은 모른다고 했다. 나는 모른다고 하지 않았다.",
          "나는 초소 지붕에 올라가 손전등으로 똑같이 돌려보냈다. 길게, 짧게, 길게. 건너편 불빛이 한참 멈춰 있다가, 처음으로 다르게 깜박였다. 짧게 세 번.",
          "다리 위의 놈들은 불빛을 보지 않는다. 소리만 따라간다. 방송이 나오는 쪽으로 서 있을 뿐이다. 그러니까 저 불빛은 놈들한테 보내는 게 아니다.",
          "초소를 하나 더 세웠다. 차단기 옆에 모래주머니를 쌓으면서 건너편을 자꾸 봤다. 누가 보고 있다는 건, 누가 기다리고 있다는 뜻일지도 모른다."] },
        { title: "차단기", text: [
          "열다섯 밤을 버텼다. 다리 이쪽 끝의 놈들이 눈에 띄게 줄었다. 초소마다 불을 켜 두니 다리 절반까지 훤하다.",
          "새벽에 건너편에서 쇠 긁는 소리가 났다. 차단기가 올라가는 소리였다. 저쪽 차단기다. 절반쯤 올라가다 멈췄다.",
          "탐조등이 다리 한가운데를 비췄다. 버려진 버스 한 대가 가로로 서 있다. 그 지붕 위에 밧줄 뭉치가 놓여 있었다. 어제는 없던 것이다.",
          "아저씨가 말했다. “저쪽에서도 길을 내고 있는 거야. 우리가 여기서 버티는 걸 보고.” 나는 냉장 상자를 고쳐 멨다. 강은 넓고, 다리는 하나뿐이다."] }] },
    { no: 7, name: '송신탑', kind: 'tower', cost: 1e31, lead: '방송을 멀리 보내 흩어진 사람들을 부른다',
      story: [
        { title: "밧줄", text: [
          "7구역. 버스 지붕의 밧줄을 잡고 건넜다. 밧줄은 저쪽에서 당겨 주었다. 당긴 손은 작았다. 여럿이었다.",
          "차단기 아래에서 아이들이 쏟아져 나왔다. 세어 볼 것도 없었다. 열여섯. 받침을 네모나게 쓰는 애는 없다. 나는 쪽지를 펴서 줄 그은 이름을 보여 줬다. 아무도 묻지 않았다. 다들 알고 있었다.",
          "송신탑은 강둑 끝에 서 있다. 밑동을 놈들이 빙 둘러싸고 있다. 걷지 않는다. 스피커를 올려다보고 서 있을 뿐이다. 아이들은 그 사이를 지나다닌다. 소리만 내지 않으면 된다고 했다.",
          "어른은 어디 있느냐고 물었다. 일지에는 열일곱이 건넜다고 적혀 있었다. 아이들이 탑 꼭대기를 가리켰다. “간호사 선생님. 공단에서부터 우리를 데리고 왔어. 올라오지 말래. 밤에 불만 켜 줘.”",
          "꼭대기 창에 불이 들어왔다. 길게, 짧게, 길게. 나는 냉장 상자 손잡이를 쥔 손에 힘이 들어가는 걸 한참 뒤에야 알았다."] },
        { title: "딸깍", text: [
          "안테나를 세울수록 방송이 멀리 간다. 사람들이 온다. 강을 따라, 선로를 따라, 지붕 위의 7을 따라. 어제는 마흔, 오늘은 백이 넘었다. 아저씨는 문마다 분필로 썼다. “쓰고 채워 놓을 것.”",
          "방송실은 탑의 중간에 있다. 테이프가 혼자 돌고 있었다. 헤드폰을 쓰니 무전기로는 들리지 않던 것이 들렸다. 문장과 문장 사이, 딸깍 소리 바로 앞에, 아주 작게 녹음된 목소리.",
          "“{hero:야}. 우비 벗지 마. 멀리서도 엄마가 알아볼 수 있게.”",
          "숨 쉴 틈도 없이 말하던 그 목소리가 거기서만 느렸다. 테이프가 돌 때마다 그 말이 나왔다. 사태 9일째부터 지금까지. 나는 그 방송을 매일 들으면서 한 번도 듣지 못했다.",
          "책상에는 빈 관이 하나 놓여 있었다. 라벨은 114-1. 그 옆에 주사기. 수첩의 마지막 장에는 글씨가 아니라 삐뚤빼뚤한 선만 있었다. 손이 말을 듣지 않는 사람이 쓴 것처럼. 겨우 읽을 수 있는 건 한 줄이었다. “물렸다. 다리에서. 한 대로는 멈추기만 한다.”"] },
        { title: "길게, 짧게, 길게", text: [
          "꼭대기까지 계단이 백마흔 개였다. 아이들은 올라오지 말랬다고 했지만, 나를 막지는 않았다.",
          "탐조등 옆에 간호사복을 입은 사람이 등을 돌리고 서 있었다. 살갗이 잿빛이다. 강 건너를 보고 있다. 놈들이 서 있는 것처럼 서 있다. 나는 엄마라고 부르지 못하고 우비의 모자를 벗었다.",
          "그 사람이 돌아봤다. 아주 천천히. 반장이 그랬던 것처럼. 다가와서 내 왼쪽 소매에 코를 대고 한참 있었다. 그러고는 소매를 끝까지 내려 주었다. 떨리는 손으로. 그 손을 나는 안다.",
          "엄마는 말을 하지 못했다. 대신 탐조등 스위치에 손을 올렸다. 길게, 짧게, 길게. 저녁밥이 다 됐을 때 현관 불을 그렇게 깜박이던 사람이다. 나는 그게 무슨 신호인지 처음부터 알고 있었다. 모르는 척하고 여기까지 온 것이다.",
          "냉장 상자를 열었다. 114-2부터 114-7. 아주머니가 관을 받아 들고 말했다. “여섯 대면 돼. 멈춘 걸 되돌릴 수 있어.” 엄마가 고개를 저었다. 수첩에 선을 그었다. 겨우 읽었다. “애들 먼저.” 열여섯 가운데 열이 나는 애가 넷 있었다.",
          "그래서 나는 팔을 걷었다. 이번에는 오른쪽도. “114번은 여기 있어. 모자라면 더 뽑으면 돼.” 엄마의 입이 한 번 움직였다. 소리는 없었지만 나는 그 모양을 안다.",
          "그날 밤 방송실에서 테이프를 새로 녹음했다. 엄마 목소리는 지우지 않고, 그 뒤에 이어 붙였다. “여기는 7구역. 생존자는 7구역으로 오라. 물린 사람도 오라.” 딸깍.",
          "노란 우비는 탑 꼭대기에 걸어 두었다. 멀리서도 보이게. 길 잃을 일은 없게."] }] }
  ];

  // 1구역의 시설: 가만히 있어도 물자를 만든다
  var BUILDINGS = [
    { id: 'scouts',   name: '잔해 수색조', desc: '폐허를 수색해 물자를 가져온다', baseCost: 15,    baseRate: 0.5 },
    { id: 'garden',   name: '옥상 텃밭',   desc: '감자와 콩이 자란다',          baseCost: 120,   baseRate: 4 },
    { id: 'purifier', name: '빗물 정수기', desc: '마실 물은 곧 화폐다',         baseCost: 1100,  baseRate: 22 },
    { id: 'workshop', name: '고철 작업장', desc: '잔해를 쓸모 있게 바꾼다',     baseCost: 12000, baseRate: 120 }
  ];
  /*
   * 3구역의 기계: 원료 → 부품 → 완제품 순서로 맞물려 돈다. rate 는 레벨 하나당 초당 처리량.
   * 라인 전체는 셋 중 가장 느린 기계(병목)의 속도로만 나온다.
   */
  var MACHINES = [
    { id: 'sorter',    name: '선별기', desc: '고철을 골라 원료로 만든다',   baseCost: 2e10,  rate: 3 },
    { id: 'press',     name: '가공기', desc: '원료를 눌러 부품으로 찍는다', baseCost: 4e10,  rate: 2 },
    { id: 'assembler', name: '조립기', desc: '부품을 맞춰 완제품을 낸다',   baseCost: 8e10,  rate: 1 }
  ];
  /*
   * 4구역의 노선: 멀리 가는 노선일수록 운행이 오래 걸리지만 같은 시간에 더 많이 싣는다(mult).
   *   seconds 한 번 다녀오는 시간, mult 화물 배수, baseCost 첫 단계(복구)의 값. 단계마다 열차 ROUTE_SLOTS 대가 더 다닐 수 있다.
   * 열차는 배수가 높은 노선부터 알아서 채워 탄다. 화물은 열차가 돌아왔을 때 한꺼번에 들어온다.
   */
  var ROUTES = [
    { id: 'loop',    name: '순환선',    desc: '역 주변을 한 바퀴 돈다',       seconds: 30,   mult: 1,   baseCost: 1e18 },
    { id: 'river',   name: '강변선',    desc: '강을 따라 창고 지대까지 간다', seconds: 180,  mult: 1.4, baseCost: 1e19 },
    { id: 'outer',   name: '외곽선',    desc: '도시 바깥 화물역을 돈다',      seconds: 900,  mult: 2,   baseCost: 1e20 },
    { id: 'express', name: '심야 급행', desc: '밤새 달려 가장 먼 곳까지 간다', seconds: 3600, mult: 3,   baseCost: 1e21 }
  ];
  /*
   * 5구역의 연구 과제: 연구 점수를 써서 끝내면 이번 판 동안 효과가 남는다. 같은 과제를 또 끝내면 효과가 곱으로 쌓인다.
   *   key  : mods() 의 어느 항목에 곱하는가. 'drop' 은 효과가 남지 않고 물자를 바로 받는다.
   *   mult : 한 번 끝낼 때마다 곱하는 값
   * 과제는 한 번에 OFFER_COUNT 개가 나오고 그중 하나를 고른다. 무엇이 나올지는 그때그때 다르다.
   */
  var PROJECTS = [
    { id: 'soil',    name: '토양 분석', desc: '1구역 생산 2배',        key: 'z1',       mult: 2 },
    { id: 'ledger',  name: '유통 기록', desc: '상품 값 2배',           key: 'z2',       mult: 2 },
    { id: 'process', name: '공정 개선', desc: '완제품 값 2배',         key: 'z3',       mult: 2 },
    { id: 'transit', name: '운행 분석', desc: '화물 값 2배',           key: 'z4',       mult: 2 },
    { id: 'drill',   name: '방어 교범', desc: '방어력 1.5배',          key: 'defense',  mult: 1.5 },
    { id: 'serum',   name: '혈청 배양', desc: '전체 생산 1.3배',       key: 'prod',     mult: 1.3 },
    { id: 'refine',  name: '항체 정제', desc: '철수 항체 샘플 1.15배', key: 'antibody', mult: 1.15 },
    { id: 'drop',    name: '보급 요청', desc: '생산 10분치 물자를 바로 받는다', key: 'drop', mult: 1 }
  ];
  // 방벽: 구역과 상관없이 거점 전체를 지킨다
  var DEFENSES = [
    { id: 'wire',   name: '철조망',    desc: '느리게 만든다',     baseCost: 40,    power: 4 },
    { id: 'tower',  name: '감시탑',    desc: '먼저 보고 쏜다',    baseCost: 600,   power: 20 },
    { id: 'turret', name: '자동 포탑', desc: '잠들지 않는 총구',  baseCost: 8000,  power: 70 },
    { id: 'flame',  name: '화염 방벽', desc: '가까이 오면 태운다', baseCost: 2e5,   power: 400 },
    { id: 'emp',    name: '전자기 울타리', desc: '닿으면 굳는다',  baseCost: 8e6,   power: 3300 },
    { id: 'rail',   name: '레일건',    desc: '무리를 꿰뚫는다',   baseCost: 5e8,   power: 42000 }
  ];
  /*
   * 구역 강화: 구역마다 따로 있는 강화 목록. 물자로 레벨을 올리고, 철수하면 사라진다.
   *   key 는 mods() 가 합산하는 항목, per 는 레벨당 효과. growth 는 레벨마다 값이 오르는 배수.
   */
  var UPGRADES = [
    { id: 'crowbar', zone: 0, name: '쇠지렛대',  desc: '수색 배수 +100%',        key: 'click',   per: 1,    baseCost: 100,  growth: 4,   max: 12 },
    { id: 'maps',    zone: 0, name: '동네 지도', desc: '1구역 생산 +25%',        key: 'z1',      per: 0.25, baseCost: 400,  growth: 2.4, max: 30 },
    { id: 'cart',    zone: 0, name: '손수레',    desc: '1구역 시설 값 -4%',      key: 'z1cost',  per: -0.04, baseCost: 2000, growth: 3,  max: 12 },
    { id: 'shifts',  zone: 0, name: '교대 수색', desc: '밤 전리품 +25%',         key: 'loot',    per: 0.25, baseCost: 5000, growth: 3,   max: 15 },
    { id: 'haggle',  zone: 1, name: '흥정',      desc: '시세의 바닥 +0.1',       key: 'floor',   per: 0.1,  baseCost: 2e5,  growth: 4,   max: 8 },
    { id: 'regular', zone: 1, name: '단골',      desc: '시세의 천장 +0.2',       key: 'ceil',    per: 0.2,  baseCost: 5e5,  growth: 3.2, max: 15 },
    { id: 'stock',   zone: 1, name: '창고 확장', desc: '쌓아 둘 수 있는 양 +100%', key: 'cap',    per: 1,    baseCost: 1e5,  growth: 3,   max: 12 },
    { id: 'scale',   zone: 1, name: '좋은 저울', desc: '상품 값 +25%',           key: 'z2',      per: 0.25, baseCost: 3e5,  growth: 2.4, max: 40 },
    { id: 'lube',    zone: 2, name: '윤활유',    desc: '완제품 값 +25%',         key: 'z3',      per: 0.25, baseCost: 1.5e11, growth: 2.4, max: 40 },
    { id: 'manual',  zone: 2, name: '정비 교범', desc: '기계 값 -4%',            key: 'z3cost',  per: -0.04, baseCost: 3e11, growth: 3,  max: 12 },
    { id: 'belt',    zone: 2, name: '컨베이어',  desc: '정속 가동 보너스 +10%p', key: 'steady',  per: 0.1,  baseCost: 6e11, growth: 3.5, max: 10 },
    { id: 'spare',   zone: 2, name: '예비 부품', desc: '정속 가동으로 치는 가동률 -3%p', key: 'slack', per: 0.03, baseCost: 3e11, growth: 4, max: 5 },
    { id: 'signal',  zone: 3, name: '신호기',    desc: '화물 값 +25%',           key: 'z4',      per: 0.25, baseCost: 1e18, growth: 2.4, max: 40 },
    { id: 'timetable', zone: 3, name: '시간표',  desc: '운행 시간 -5%',          key: 'trip',    per: -0.05, baseCost: 3e18, growth: 4,  max: 8 },
    { id: 'tracks',  zone: 3, name: '선로 정비', desc: '노선 값 -6%',            key: 'routecost', per: -0.06, baseCost: 3e18, growth: 3, max: 12 },
    { id: 'depot',   zone: 3, name: '차량 기지', desc: '열차 값 -4%',            key: 'traincost', per: -0.04, baseCost: 3e18, growth: 3, max: 12 },
    { id: 'scope',   zone: 4, name: '현미경',    desc: '연구 속도 +25%',         key: 'lab',     per: 0.25, baseCost: 1e23, growth: 2.4, max: 40 },
    { id: 'notes',   zone: 4, name: '연구 노트', desc: '과제에 드는 점수 -5%',   key: 'labcost', per: -0.05, baseCost: 3e23, growth: 3.5, max: 10 },
    { id: 'booth',   zone: 5, name: '검문대',    desc: '통행 물자 +25%',         key: 'z6',      per: 0.25, baseCost: 1.5e27, growth: 2.4, max: 40 },
    { id: 'lamp',    zone: 5, name: '탐조등',    desc: '다리 안전도 상한 +0.5',  key: 'margin',  per: 0.5,  baseCost: 5e27, growth: 6,   max: 4 },
    { id: 'amp',     zone: 6, name: '증폭기',    desc: '생존자가 모이는 속도 +25%', key: 'z7',    per: 0.25, baseCost: 1.5e30, growth: 2.4, max: 40 },
    { id: 'dorm',    zone: 4, name: '기숙사',    desc: '연구원 값 -4%',          key: 'staffcost', per: -0.04, baseCost: 2e23, growth: 3, max: 12 },
    // 구역 사이 콘텐츠가 더 자주 나오게 하는 개조(1.3.1). 1구역의 '소문'(은닉처 확률)과 같은 자리다.
    //   간격을 줄이는 셋은 곱으로 쌓이고 절반 아래로는 줄지 않는다. 확률을 올리는 둘은 %p 를 더한다(서류 35→60%, 통행인 50→80%).
    { id: 'flyer',    zone: 1, name: '전단지',     desc: '단골 주문이 오는 간격 -8%',  key: 'ordergap',    per: -0.08, baseCost: 4e5,  growth: 4, max: 6 },
    { id: 'catalog',  zone: 2, name: '견본 상자',  desc: '납품 의뢰가 오는 간격 -8%',  key: 'contractgap', per: -0.08, baseCost: 4e11, growth: 4, max: 6 },
    { id: 'buoy',     zone: 3, name: '부표',       desc: '표류 화물이 나오는 간격 -8%', key: 'salvagegap', per: -0.08, baseCost: 2e18, growth: 4, max: 6 },
    { id: 'archive',  zone: 4, name: '문서고 열쇠', desc: '서류를 찾을 확률 +5%p',     key: 'recordchance', per: 0.05, baseCost: 6e22, growth: 4, max: 5 },
    { id: 'signpost', zone: 5, name: '다리 표지판', desc: '통행인이 건널 확률 +6%p',   key: 'passerchance', per: 0.06, baseCost: 1e27, growth: 4, max: 5 },
    // 자동: 구역마다 개조를 사야 그 구역의 일이 알아서 돌아간다(AUTO_KEYS). 영구 특성 '자동화'가 있으면 개조 없이도 전부 돈다.
    // 방벽 개조(zone -1: 구역이 아니라 방벽 화면에 놓인다. 처음부터 살 수 있다)
    { id: 'architect', zone: -1, name: '건축가', desc: '방어력 +20%',              key: 'defense', per: 0.2,   baseCost: 5000, growth: 3,  max: 30 },
    { id: 'builder',   zone: -1, name: '건설자', desc: '방어 수단 값 -5%',         key: 'defcost', per: -0.05, baseCost: 2e4,  growth: 3,  max: 12 },
    { id: 'repair',    zone: -1, name: '수리공', desc: '정해 둔 수까지 방어 수단을 알아서 산다 · 올릴수록 빨라진다', key: 'repair', per: 1, baseCost: 1e5, growth: 10, max: 5 },
    { id: 'rumor',   zone: 0, name: '소문',      desc: '은닉처가 나올 확률 +3%p',  key: 'rumor',   per: 3,    baseCost: 3000, growth: 5,  max: 8 },
    { id: 'patrol',  zone: 0, name: '순찰조',    desc: '수색조가 알아서 동네를 수색한다 · 올릴수록 빨라진다', key: 'patrol', per: 1, baseCost: 2000, growth: 10, max: 5 },
    { id: 'broker',  zone: 1, name: '흥정꾼',    desc: '시세가 평균 이상이면 알아서 판다 · 올릴수록 자주 판다', key: 'broker', per: 1, baseCost: 5e6, growth: 8, max: 5 },
    { id: 'autoline', zone: 2, name: '자동 제어반', desc: '전력 투입이 알아서 들어간다', key: 'autoline', per: 1, baseCost: 1.5e13, growth: 1, max: 1 },
    { id: 'autosig', zone: 3, name: '자동 신호',  desc: '청신호가 알아서 켜진다', key: 'autosig', per: 1, baseCost: 1.5e20, growth: 1, max: 1 },
    // 5·6·7구역의 자동(1.5.1): 단추는 알아서 눌러 주고, 사건은 알아서 받되 절반만 받는다(손으로 하는 쪽이 더 번다)
    { id: 'autolab',   zone: 4, name: '연구 조교',  desc: '밤샘 연구를 알아서 시작한다', key: 'autolab',   per: 1, baseCost: 5e24, growth: 1, max: 1 },
    { id: 'autoguard', zone: 5, name: '초소장',     desc: '순찰을 알아서 돌고, 행렬을 알아서 통과시킨다(절반)', key: 'autoguard', per: 1, baseCost: 5e28, growth: 1, max: 1 },
    { id: 'autotower', zone: 6, name: '송신 기사',  desc: '직접 방송을 알아서 하고, 무전에 알아서 응답한다(절반)', key: 'autotower', per: 1, baseCost: 5e31, growth: 1, max: 1 }
  ];
  /*
   * 특전: 구역의 목표를 달성할 때마다 셋 중 하나를 고른다. 이번 판에만 유효하고 철수하면 사라진다.
   * 같은 특전을 또 고르면 레벨이 오른다. zone 이 있는 특전은 그 구역을 연 뒤에만 나온다(쓸모없는 특전이 섞이지 않게).
   */
  var PERKS = [
    { id: 'harvest', name: '풍작',      desc: '전체 생산 +40%',  key: 'prod',    per: 0.4 },
    { id: 'watch',   name: '불침번',    desc: '방어력 +50%',     key: 'defense', per: 0.5 },
    { id: 'hands',   name: '빠른 손',   desc: '수색 배수 +200%', key: 'click',   per: 2 },
    { id: 'bargain', name: '입담',      desc: '상품 값 +40%',    key: 'z2',      per: 0.4, zone: 1 },
    { id: 'foreman', name: '작업 반장', desc: '완제품 값 +40%',  key: 'z3',      per: 0.4, zone: 2 },
    { id: 'driver',  name: '기관사',    desc: '화물 값 +40%',    key: 'z4',      per: 0.4, zone: 3 },
    { id: 'aide',    name: '조교',      desc: '연구 속도 +40%',  key: 'lab',     per: 0.4, zone: 4 },
    { id: 'spoils',  name: '전리품 수거', desc: '밤 전리품 +60%', key: 'loot',    per: 0.6 },
    { id: 'frugal',  name: '알뜰함',    desc: '모든 구매 비용 -6%',     key: 'cost',    per: -0.06 }
  ];
  /*
   * 영구 특성: 항체 샘플로 찍는다. 철수해도 남고, 되돌리면 쓴 샘플을 모두 돌려받는다.
   *   baseCost, growth : 레벨마다 드는 샘플 = ceil(baseCost × growth^레벨)
   */
  var TRAITS = [
    { id: 'immune',  name: '면역',      desc: '전체 생산 +25%',            key: 'prod',    per: 0.25, baseCost: 1, growth: 1.5,  max: 40 },
    { id: 'quick',   name: '숙련된 손', desc: '수색 배수 +100%',           key: 'click',   per: 1,    baseCost: 1, growth: 1.8,  max: 15 },
    { id: 'bulwark', name: '보루',      desc: '방어력 +40%',               key: 'defense', per: 0.4,  baseCost: 1, growth: 1.4,  max: 40 },
    { id: 'thrift',  name: '절약',      desc: '모든 구매 비용 -4%',               key: 'cost',    per: -0.04, baseCost: 2, growth: 1.7, max: 12 },
    { id: 'pioneer', name: '선발대',    desc: '철수 뒤 시작 물자 10배(레벨 1: 1,000)', key: 'start', per: 1, baseCost: 2, growth: 2, max: 8 },
    { id: 'dealer',  name: '장사 수완', desc: '상품 값 +30%',              key: 'z2',      per: 0.3,  baseCost: 3, growth: 1.5,  max: 30 },
    { id: 'engineer', name: '기술자',   desc: '완제품 값 +30%',            key: 'z3',      per: 0.3,  baseCost: 3, growth: 1.5,  max: 30 },
    { id: 'railman', name: '철도원',    desc: '화물 값 +30%',              key: 'z4',      per: 0.3,  baseCost: 3, growth: 1.5,  max: 30 },
    { id: 'scholar', name: '연구자',    desc: '연구 속도 +30%',            key: 'lab',     per: 0.3,  baseCost: 3, growth: 1.5,  max: 30 },
    { id: 'rest',    name: '교대 근무', desc: '자리 비움 효율 +5%p',       key: 'offline', per: 0.05, baseCost: 2, growth: 1.6,  max: 10 },
    { id: 'legacy',  name: '기록 보관', desc: '철수로 얻는 항체 샘플 +10%', key: 'antibody', per: 0.1, baseCost: 4, growth: 1.6,  max: 20 },
    { id: 'reroll',  name: '다시 뽑기', desc: '특전 후보를 한 회차에 1번 더 다시 뽑을 수 있다', key: 'reroll', per: 1, baseCost: 3, growth: 1.8, max: 5 },
    { id: 'auto',    name: '자동화',    desc: '전력 투입·청신호의 대기 시간 -6%', key: 'assist', per: 1, baseCost: 2, growth: 1.6, max: ASSIST_MAX }
  ];

  /*
   * 구역 목표: 구역마다 셋. 달성할 때마다 특전을 하나 고르고, 셋을 모두 채워야 다음 구역의 문을 열 수 있다.
   *   value(state) 가 need 이상이면 달성. text 는 화면에 보일 문장.
   */
  var GOALS = [
    [ { id: 'z1a', text: '잔해 수색조 50곳', need: 50, value: function (s) { return s.buildings.scouts; } },
      { id: 'z1b', text: '1구역 시설 합계 200곳', need: 200, value: function (s) { return totalBuildings(s); } },
      // 기다리기만 하면 되는 목표(밤 30번)는 뺐다: 손을 움직이는 만큼 빨리 끝나는 것으로 바꿨다
      { id: 'z1c', text: '동네 12곳 다 수색하기', need: 12, value: function (s) { return s.sweeps; } } ],
    [ { id: 'z2a', text: '좌판 50곳', need: 50, value: function (s) { return s.stalls; } },
      { id: 'z2b', text: '고점 시세에서 10번 팔기', need: 10, value: function (s) { return s.peakSales; } },
      { id: 'z2c', text: '상품 판매 누적 1,000억', need: 1e11, value: function (s) { return s.tradeEarned; } } ],
    [ { id: 'z3a', text: '기계 레벨 합계 85', need: 85, value: function (s) { return machineLevels(s); } },
      { id: 'z3b', text: '정속 가동 누적 2분', need: 120, unit: 'time', value: function (s) { return s.steadySeconds; } },
      { id: 'z3c', text: '완제품으로 번 물자 누적 10경', need: 1e17, value: function (s) { return s.lineEarned; } } ],
    [ { id: 'z4a', text: '열차 11대', need: 11, value: function (s) { return s.trains; } },
      { id: 'z4b', text: '심야 급행 2번 도착', need: 2, value: function (s) { return s.expressRuns; } },
      { id: 'z4c', text: '화물로 번 물자 누적 10해', need: 1e21, value: function (s) { return s.railEarned; } } ],
    [ { id: 'z5a', text: '연구원 28명', need: 28, value: function (s) { return s.staff; } },
      { id: 'z5b', text: '연구 과제 10개 끝내기', need: 10, value: function (s) { return s.projectsDone; } },
      { id: 'z5c', text: '혈청 배양 2번 끝내기', need: 2, value: function (s) { return s.research.serum; } } ],
    [ { id: 'z6a', text: '초소 28곳', need: 28, value: function (s) { return s.posts; } },
      { id: 'z6b', text: '6구역 개조를 모두 합쳐 10번', need: 10, value: function (s) { return zoneUpgrades(s, 5); } },
      { id: 'z6c', text: '통행 물자 누적 5,000자', need: 5e27, value: function (s) { return s.guardEarned; } } ],
    [ { id: 'z7a', text: '안테나 21기', need: 21, value: function (s) { return s.antennas; } },
      { id: 'z7b', text: '생존자 7만 명 모으기', need: 7e4, value: function (s) { return s.survivors; } },
      { id: 'z7c', text: '혈청 3단계 완성', need: 3, value: function (s) { return s.serumStage; } } ]
  ];

  /* ---------- 작은 도우미 ---------- */
  function findById(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function fail(reason) { return { ok: false, reason: reason }; }
  function safeNum(v, d) { return typeof v === 'number' && isFinite(v) && v >= 0 ? v : d; }
  function safeCount(v) { return Math.floor(safeNum(v, 0)); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ---------- 상태 ---------- */
  function createState(now) {
    var s = {
      version: SAVE_VERSION,
      supplies: 0,
      runEarned: 0,          // 이번 판에서 번 물자(철수 항체의 기준)
      lifetimeEarned: 0,     // 지금까지 번 물자(통계)
      clicks: 0,
      zone: 0,               // 가장 멀리 연 구역(0 이 1구역)
      gate: false,           // 아직 만들지 않은 구역의 문 앞에 닿았는가(이번 판)
      buildings: {}, defenses: {}, upgrades: {},
      // 1구역 수색 지도: sweepMask 뒤진 칸(비트), sweepSeed 동네 번호(칸의 배치를 정한다), sweepClock 자동 수색 시계, sweeps 이번 판에 다 뒤진 동네 수
      sweepMask: 0, sweepSeed: 1, sweepClock: 0, sweeps: 0,
      autoDef: {}, repairClock: 0,      // 수리공: 방어 수단마다 자동 구입 목표(0 은 끔), 다음 구입까지의 시계
      // 2구역 거래
      sellClock: 0,                        // 흥정꾼이 마지막으로 판 뒤 흐른 시간(초)
      hands: { porter: 0, crier: 0 },      // 시장의 일손(HANDS)
      stalls: 0, goods: 0, price: 1, priceClock: 0, lowRun: 0, autoSell: true, sellPeak: false, tradeEarned: 0, peakSales: 0,
      // 시세판: priceHistory 지난 시세(오래된 것부터), streak 연속 호가 단계, streakUsed 지금 시세에서 이미 단계를 올렸는가
      priceHistory: [], streak: 0, streakUsed: false,
      // 3구역 생산 라인
      machines: {}, lineEarned: 0, steadySeconds: 0,
      recipe: 'bolt', mastery: {}, retool: 0, jam: null, jamIn: 90, tuneLeft: 0, truck: null, truckIn: 100, stockSec: 0, repairsRun: 0, trucksRun: 0,      // 3구역: 품목, 고장과 정비, 출하 트럭
      surgeLeft: 0, surgeCool: 0,      // 전력 투입: 남은 시간, 다시 쓸 수 있을 때까지 남은 시간
      // 4구역 노선: routes 노선 단계, routeClock 이번 운행이 지난 시간(초), routeLoad 이번 운행에 실린 화물(열차 × 초)
      trains: 0, routes: {}, routeClock: {}, routeLoad: {}, railEarned: 0, expressRuns: 0,
      greenCool: 0,                    // 청신호를 다시 켤 수 있을 때까지 남은 시간
      // 5구역 연구: staff 연구원, points 모인 연구 점수, research 과제별 끝낸 횟수, offers 지금 고를 수 있는 과제, projectsDone 끝낸 과제 수
      staff: 0, points: 0, research: {}, offers: [], projectsDone: 0,
      antennas: 0, survivors: 0, serumStage: 0,      // 7구역: 안테나 수, 모인 생존자, 혈청 단계(0~3)
      ended: 0, endedAt: 0, endedRun: false,                          // 이야기를 끝낸 횟수와 처음 끝낸 시각(철수해도 남는다)
      posts: 0, guardEarned: 0, safeNights: 0,      // 6구역: 초소 수, 통행 물자 누적, 넉넉하게 막은 밤
      // 밤
      day: 1, dayClock: 0, wavesCleared: 0, breaches: 0, siege: false, siegeNights: 0, defStreak: 0, edge: 0, nightEase: 1, counterAt: 0, perkOwed: 0, bossPerks: 0, perkFrom: 'goal',      // defStreak 연속으로 막은 밤, perkOwed 변이체를 막고 아직 못 고른 특전
      // 구조 신호
      signalIn: SIGNAL_FIRST, signalLeft: 0, signalsAnswered: 0, buff: null,
      // 특전(이번 판)
      zev: { rail: null, guard: null, tower: null }, zevIn: { rail: 60, guard: 60, tower: 60 }, railBoost: 0, guardBoost: 0, zevRun: 0, focusLeft: 0, focusCool: 0, push: { guard: { left: 0, cool: 0 }, tower: { left: 0, cool: 0 } },      // 4·6·7구역 사건과 5구역 밤샘 연구
      autoOff: {},      // 구역 index → true 면 그 구역의 주문·사건 자동을 꺼 둔 것(철수해도 남는다)
      goalExt: {},      // 목표 id → 채운 연장 단계 수(이번 회차)
      goalPick: {},      // 이번 회차의 목표 고르기(구역 index → 자리별 0|1). 비어 있으면 원래 목표 셋
      perks: {}, pendingPerks: [], goalsDone: {}, rerollsUsed: 0,      // rerollsUsed: 이번 판에 특전을 다시 뽑은 횟수(철수하면 0)
      // 영구
      pet: null,             // 지금 데리고 다니는 동물 친구 { kind, breed, name }. 없으면 null. 철수해도 남는다
      treats: 0,             // 간식: 친구를 키우는 재화(철수해도 남는다)
      petLv: {},             // 친구마다의 레벨 { 품종: 레벨 }
      kennel: {},            // 함께 있는 친구들 { 품종: 이름 }. 한 번 데려온 아이는 계속 남고, 누구를 데리고 다닐지 고른다
      heroName: HERO_DEFAULT,
      heroGender: 'none',    // 주인공의 성별: 'none'(설정 안 함) | 'm' | 'f'. 일지의 호칭이 달라진다    // 주인공의 이름
      antibodies: 0,         // 쓰지 않은 항체 샘플
      antibodyTotal: 0,      // 지금까지 얻은 항체 샘플
      traits: {},
      retreats: 0,           // 철수한 횟수
      bestZone: 0,           // 가장 멀리 갔던 구역
      story: {},
      passers: {}, passersRun: 0,      // 6구역 통행인: 사람마다 건넌 수(철수해도 남는다), 이번 회차에 건넌 수
      records: {}, recordsRun: 0,      // 5구역 병원 서류: 종류마다 찾은 수(철수해도 남는다), 이번 회차에 찾은 수
      cargos: {}, salvage: null, salvageIn: 150, salvagesRun: 0,      // 4구역 표류 화물: 종류마다 끌어온 수(철수해도 남는다), 지금 발견된 화물, 다음 발견까지(초), 이번 회차에 끌어온 수
      clients: {}, contract: null, contractIn: 120, contractsRun: 0,      // 3구역 거래처: 종류마다 채운 의뢰 수(철수해도 남는다), 지금 온 의뢰, 다음 의뢰까지(초), 이번 회차에 채운 수
      regulars: {}, order: null, orderIn: 120, ordersRun: 0,      // 단골: 종류마다 채운 주문 수(철수해도 남는다), 지금 온 주문, 다음 주문까지(초), 이번 회차에 채운 수
      zdex: {},              // 좀비 도감: 종류마다 만난 횟수. 철수해도 남는다
      ach: {},               // 달성한 업적 { id: true }. 철수해도 남는다
      achClock: 0,           // 업적을 마지막으로 확인한 뒤 흐른 시간(초)
      startedAt: safeNum(now, 0), playSeconds: 0, awaySeconds: 0, runSeconds: 0,
      zoneLog: [],           // 이번 판에 구역을 연 기록 [{ zone 구역 번호(0부터), seconds 판을 시작한 뒤 흐른 시간, day 날짜 }]
      runLog: [],            // 지난 판들 [{ zone, seconds, antibodies }] (최근 10판)
      challenge: null,       // 이번 회차의 도전 { id, failed, done }. 없으면 null
      nextChallenge: '',     // 다음 회차에 걸 도전(철수하면 쓰이고 지워진다)
      medals: {},            // 도전마다 성공한 횟수. 철수해도 남는다
      tickets: 0,            // 뽑기권
      shards: 0,             // 중복으로 받은 조각
      cosmetics: {},         // 가진 외형 { id: true } (기본 외형은 적지 않는다)
      wear: { coat: 'coat-yellow', hood: 'hood-none', pat: 'pat-none', bag: 'bag-cooler', fx: 'fx-none', flag: 'flag-yellow' },      // 입은 외형(자리마다 하나)
      gachaPity: 0,          // 전설이 나온 뒤로 뽑은 횟수(보장 계산)
      gachaPulls: 0,         // 지금까지 뽑은 횟수
      stage: null,           // 원정 스테이지로 만든 상태에만 있다 { id, hard, won, lost, seconds }
      stageMarks: {},        // 본 게임: 스테이지마다 얻은 표시 { clear, speed, hard, best }. 철수해도 남는다
      challengeStreak: 0,    // 도전을 연달아 성공한 횟수(실패·포기하면 0). 철수해도 남는다
      lastSeen: safeNum(now, 0)
    };
    BUILDINGS.forEach(function (b) { s.buildings[b.id] = 0; });
    DEFENSES.forEach(function (d) { s.defenses[d.id] = 0; s.autoDef[d.id] = 0; });
    MACHINES.forEach(function (d) { s.machines[d.id] = 0; });
    ROUTES.forEach(function (d) { s.routes[d.id] = 0; s.routeClock[d.id] = 0; s.routeLoad[d.id] = 0; });
    PROJECTS.forEach(function (d) { s.research[d.id] = 0; });
    UPGRADES.forEach(function (u) { s.upgrades[u.id] = 0; });
    PERKS.forEach(function (p) { s.perks[p.id] = 0; });
    TRAITS.forEach(function (t) { s.traits[t.id] = 0; });
    return s;
  }

  /**
   * 외부에서 들어온 임의의 객체(저장 데이터, 뷰어가 넘긴 스냅샷)를 안전한 상태로 바꾼다.
   * 모르는 항목은 버리고, 깨진 숫자는 기본값으로 돌린다. 절대 예외를 던지지 않는다.
   */
  function sanitizeState(raw, now) {
    var s = createState(now);
    if (!raw || typeof raw !== 'object') return s;
    ['supplies', 'runEarned', 'lifetimeEarned', 'goods', 'tradeEarned', 'lineEarned', 'steadySeconds', 'railEarned', 'points', 'playSeconds', 'awaySeconds', 'runSeconds', 'startedAt'].forEach(function (k) { s[k] = safeNum(raw[k], s[k]); });
    ['clicks', 'sweeps', 'stalls', 'trains', 'expressRuns', 'staff', 'projectsDone', 'peakSales', 'wavesCleared', 'breaches', 'signalsAnswered', 'antibodies', 'antibodyTotal', 'retreats'].forEach(function (k) { s[k] = safeCount(raw[k]); });
    s.zone = clamp(safeCount(raw.zone), 0, ZONES.length - 1);
    while (s.zone > 0 && ZONES[s.zone].kind === 'soon') s.zone--;     // 아직 없는 구역에 들어가 있을 수는 없다
    s.bestZone = clamp(Math.max(safeCount(raw.bestZone), s.zone), 0, ZONES.length - 1);
    s.gate = !!raw.gate;
    s.stalls = Math.min(s.stalls, COUNT_MAX);
    s.sellClock = clamp(safeNum(raw.sellClock, 0), 0, SELL_AUTO_SECONDS);
    DEFENSES.forEach(function (d) { var t = raw.autoDef && typeof raw.autoDef === 'object' ? raw.autoDef[d.id] : 0; s.autoDef[d.id] = clamp(safeCount(t), 0, 1e6); });
    s.repairClock = clamp(safeNum(raw.repairClock, 0), 0, 10);
    HANDS.forEach(function (d) { s.hands[d.id] = clamp(safeCount(raw.hands && typeof raw.hands === 'object' ? raw.hands[d.id] : 0), 0, d.max); });
    s.day = Math.max(1, safeCount(raw.day));
    s.dayClock = clamp(safeNum(raw.dayClock, 0), 0, DAY_SECONDS);
    s.siege = !!raw.siege;
    s.autoSell = raw.autoSell !== false; s.sellPeak = raw.sellPeak === true;
    s.streak = Math.min(STREAK_MAX, safeCount(raw.streak));
    s.streakUsed = raw.streakUsed === true;
    s.priceHistory = (Array.isArray(raw.priceHistory) ? raw.priceHistory : []).slice(-PRICE_HISTORY).map(function (v) { return clamp(safeNum(v, 1), 0, 10); });
    s.priceClock = clamp(safeNum(raw.priceClock, 0), 0, PRICE_STEP);
    s.signalIn = clamp(safeNum(raw.signalIn, SIGNAL_FIRST), 0, SIGNAL_MIN + SIGNAL_SPREAD);
    s.signalLeft = clamp(safeNum(raw.signalLeft, 0), 0, SIGNAL_WINDOW);
    s.buff = raw.buff && safeNum(raw.buff.left, 0) > 0 ? { mult: clamp(safeNum(raw.buff.mult, BUFF_MULT), 1, 10), left: Math.min(raw.buff.left, 600) } : null;
    function counts(defs, src, max) {
      var out = {};
      defs.forEach(function (d) { out[d.id] = Math.min(safeCount(src && typeof src === 'object' ? src[d.id] : 0), typeof max === 'function' ? max(d) : max); });
      return out;
    }
    s.buildings = counts(BUILDINGS, raw.buildings, COUNT_MAX);
    s.defenses = counts(DEFENSES, raw.defenses, 1e6);
    s.machines = counts(MACHINES, raw.machines, COUNT_MAX);
    s.heroName = cleanName(raw.heroName, HERO_DEFAULT);
    if (s.heroName === '생존자') s.heroName = HERO_DEFAULT;
    s.heroGender = GENDERS.indexOf(raw.heroGender) >= 0 ? raw.heroGender : 'none';      // 예전 기본 이름은 새 기본 이름으로 옮긴다
    s.kennel = {};
    s.treats = clamp(safeCount(raw.treats), 0, 1e9);
    s.petLv = {};
    var rl = raw.petLv && typeof raw.petLv === 'object' && !Array.isArray(raw.petLv) ? raw.petLv : {};
    PET_BREEDS.forEach(function (b) { var n = clamp(safeCount(rl[b.id]), 0, PET_LEVEL_MAX); if (n > 0) s.petLv[b.id] = n; });
    var rk = raw.kennel && typeof raw.kennel === 'object' && !Array.isArray(raw.kennel) ? raw.kennel : {};
    PET_BREEDS.forEach(function (b) { if (Object.prototype.hasOwnProperty.call(rk, b.id)) s.kennel[b.id] = cleanName(rk[b.id], b.name); });
    s.pet = null;
    if (raw.pet && typeof raw.pet === 'object') {
      var breed = findById(PET_BREEDS, raw.pet.breed);
      if (breed) {
        if (!s.kennel[breed.id]) s.kennel[breed.id] = cleanName(raw.pet.name, breed.name);       // 알파 0.7.5 의 저장: 친구가 하나뿐이었다
        s.pet = { kind: breed.kind, breed: breed.id, name: s.kennel[breed.id] };
      }
    }
    s.surgeLeft = clamp(safeNum(raw.surgeLeft, 0), 0, SURGE_SECONDS);
    s.recipe = findById(RECIPES, raw.recipe) ? raw.recipe : 'bolt';
    var rm = raw.mastery && typeof raw.mastery === 'object' ? raw.mastery : {};
    RECIPES.forEach(function (r) { var v = clamp(safeNum(rm[r.id], 0), 0, 1); if (v > 0 && r.id !== 'bolt') s.mastery[r.id] = v; });
    s.retool = clamp(safeNum(raw.retool, 0), 0, REBALANCE_SECONDS); s.tuneLeft = clamp(safeNum(raw.tuneLeft, 0), 0, TUNE_SECONDS);
    s.jamIn = clamp(safeNum(raw.jamIn, 90), 0, JAM_GAP_MAX); s.truckIn = clamp(safeNum(raw.truckIn, 100), 0, TRUCK_GAP_MAX);
    s.jam = raw.jam && typeof raw.jam === 'object' && findById(MACHINES, raw.jam.id) ? { id: raw.jam.id, left: clamp(safeNum(raw.jam.left, 0), 0, JAM_SELF_FIX) } : null;
    s.truck = raw.truck && typeof raw.truck === 'object' ? { left: clamp(safeNum(raw.truck.left, 0), 0, TRUCK_WAIT) } : null;
    s.stockSec = clamp(safeNum(raw.stockSec, 0), 0, TRUCK_STOCK_MAX);
    s.repairsRun = clamp(safeCount(raw.repairsRun), 0, 1e9); s.trucksRun = clamp(safeCount(raw.trucksRun), 0, 1e9);
    if (s.zone < 2) { s.jam = null; s.truck = null; s.recipe = 'bolt'; s.mastery = {}; s.retool = 0; s.tuneLeft = 0; s.stockSec = 0; }
    s.surgeCool = clamp(safeNum(raw.surgeCool, 0), 0, SURGE_COOLDOWN);
    s.sweepMask = safeCount(raw.sweepMask) % (1 << SWEEP_TILES);
    s.sweepSeed = Math.max(1, safeCount(raw.sweepSeed) % 1000000);
    s.sweepClock = clamp(safeNum(raw.sweepClock, 0), 0, SWEEP_AUTO_SECONDS);
    s.staff = Math.min(s.staff, COUNT_MAX);
    s.posts = clamp(safeCount(raw.posts), 0, COUNT_MAX); s.guardEarned = Math.max(0, safeNum(raw.guardEarned, 0)); s.safeNights = clamp(safeCount(raw.safeNights), 0, 1e9);
    if (s.zone < 5) { s.posts = 0; }
    s.antennas = s.zone >= 6 ? clamp(safeCount(raw.antennas), 0, COUNT_MAX) : 0; s.survivors = s.zone >= 6 ? clamp(safeNum(raw.survivors, 0), 0, 1e15) : 0;
    s.serumStage = s.zone >= 6 ? clamp(safeCount(raw.serumStage), 0, SERUM_COSTS.length) : 0;
    s.endedRun = !!raw.endedRun && s.zone >= 6;
    s.medals = {}; CHALLENGES.forEach(function (d) { var n = raw.medals && typeof raw.medals === 'object' ? clamp(safeCount(raw.medals[d.id]), 0, 1e6) : 0; if (n > 0) s.medals[d.id] = n; });
    s.challengeStreak = clamp(safeCount(raw.challengeStreak), 0, 1e6);
    s.stageMarks = {}; STAGES.forEach(function (d) { var m = raw.stageMarks && typeof raw.stageMarks === 'object' ? raw.stageMarks[d.id] : null; if (m && typeof m === 'object' && (m.clear || m.speed || m.hard)) s.stageMarks[d.id] = { clear: !!m.clear, speed: !!m.speed, hard: !!m.hard, best: clamp(safeCount(m.best), 0, 1e6) }; });
    s.tickets = clamp(safeCount(raw.tickets), 0, 1e9); s.shards = clamp(safeCount(raw.shards), 0, 1e9); s.gachaPity = clamp(safeCount(raw.gachaPity), 0, GACHA_PITY - 1); s.gachaPulls = clamp(safeCount(raw.gachaPulls), 0, 1e9);
    s.cosmetics = {}; COSMETICS.forEach(function (c) { if (!c.base && raw.cosmetics && typeof raw.cosmetics === 'object' && raw.cosmetics[c.id]) s.cosmetics[c.id] = true; });
    s.wear = { coat: 'coat-yellow', hood: 'hood-none', pat: 'pat-none', bag: 'bag-cooler', fx: 'fx-none', flag: 'flag-yellow' };
    COS_SLOTS.forEach(function (slot) { var id = raw.wear && typeof raw.wear === 'object' ? raw.wear[slot] : '', c = typeof id === 'string' ? findById(COSMETICS, id) : null; if (c && c.slot === slot && (c.base || s.cosmetics[c.id])) s.wear[slot] = c.id; });
    grantFlags(s);      // 조건을 이미 채운 깃발(1.10.0 전의 저장)
    s.stage = null;      // 스테이지 판은 저장하지 않는다(저장되는 것은 언제나 본 게임이다)
    s.nextChallenge = typeof raw.nextChallenge === 'string' && findById(CHALLENGES, raw.nextChallenge) ? raw.nextChallenge : '';
    s.challenge = raw.challenge && typeof raw.challenge === 'object' && findById(CHALLENGES, raw.challenge.id) ? { id: raw.challenge.id, failed: !!raw.challenge.failed, done: !!raw.challenge.done } : null;
    s.ended = clamp(safeCount(raw.ended), 0, 1e6); s.endedAt = Math.max(0, safeNum(raw.endedAt, 0));
    s.research = counts(PROJECTS, raw.research, 200);
    s.offers = [];
    (Array.isArray(raw.offers) ? raw.offers : []).forEach(function (id) { if (findById(PROJECTS, id) && s.offers.indexOf(id) < 0 && s.offers.length < OFFER_COUNT) s.offers.push(id); });
    s.trains = Math.min(s.trains, TRAIN_MAX);
    s.greenCool = clamp(safeNum(raw.greenCool, 0), 0, GREEN_COOLDOWN);
    s.routes = counts(ROUTES, raw.routes, ROUTE_MAX);
    ROUTES.forEach(function (d) {
      var rc = raw.routeClock && typeof raw.routeClock === 'object' ? raw.routeClock[d.id] : 0, rl = raw.routeLoad && typeof raw.routeLoad === 'object' ? raw.routeLoad[d.id] : 0;
      s.routeClock[d.id] = clamp(safeNum(rc, 0), 0, d.seconds);
      s.routeLoad[d.id] = clamp(safeNum(rl, 0), 0, TRAIN_MAX * d.seconds);      // 한 번의 운행에 실릴 수 있는 양을 넘지 않는다
    });
    s.upgrades = counts(UPGRADES, raw.upgrades, function (u) { return u.max; });
    s.perks = counts(PERKS, raw.perks, 999);
    s.traits = counts(TRAITS, raw.traits, function (t) { return t.max; });
    s.siegeNights = clamp(safeCount(raw.siegeNights), 0, 99);
    s.rerollsUsed = clamp(safeCount(raw.rerollsUsed), 0, 99);
    s.pendingPerks = (Array.isArray(raw.pendingPerks) ? raw.pendingPerks : []).filter(function (id) { return !!findById(PERKS, id); }).slice(0, PERK_CHOICES);
    var gd = raw.goalsDone && typeof raw.goalsDone === 'object' ? raw.goalsDone : {};
    GOALS.concat(GOALS_ALT).forEach(function (list) { list.forEach(function (g) { if (g && gd[g.id]) s.goalsDone[g.id] = true; }); });
    var rz = raw.zev && typeof raw.zev === 'object' ? raw.zev : {}, rzi = raw.zevIn && typeof raw.zevIn === 'object' ? raw.zevIn : {};
    ZONE_EVENTS.forEach(function (d) {
      s.zev[d.id] = s.zone >= d.zone && rz[d.id] && typeof rz[d.id] === 'object' && safeNum(rz[d.id].left, 0) > 0 ? { left: clamp(safeNum(rz[d.id].left, 0), 0, ZEV_WAIT) } : null;
      s.zevIn[d.id] = clamp(safeNum(rzi[d.id], 60), 0, ZEV_GAP_MAX);
    });
    s.railBoost = s.zone >= 3 ? clamp(safeNum(raw.railBoost, 0), 0, ZEV_BOOST_MAX) : 0; s.guardBoost = s.zone >= 5 ? clamp(safeNum(raw.guardBoost, 0), 0, ZEV_BOOST_MAX) : 0;
    s.zevRun = clamp(safeCount(raw.zevRun), 0, 1e9);
    s.focusLeft = s.zone >= 4 ? clamp(safeNum(raw.focusLeft, 0), 0, FOCUS_SECONDS) : 0; s.focusCool = s.zone >= 4 ? clamp(safeNum(raw.focusCool, 0), 0, FOCUS_COOL) : 0;
    var rp = raw.push && typeof raw.push === 'object' ? raw.push : {};
    PUSHES.forEach(function (d) { var q = rp[d.id] && typeof rp[d.id] === 'object' ? rp[d.id] : {}, openZ = s.zone >= d.zone; s.push[d.id] = { left: openZ ? clamp(safeNum(q.left, 0), 0, PUSH_SECONDS) : 0, cool: openZ ? clamp(safeNum(q.cool, 0), 0, PUSH_COOL) : 0 }; });
    s.edge = clamp(safeNum(raw.edge, 0), 0, 1); s.nightEase = raw.nightEase === NIGHT_EASE ? NIGHT_EASE : 1; s.counterAt = clamp(safeCount(raw.counterAt), 0, 99);
    s.defStreak = clamp(safeCount(raw.defStreak), 0, 1e6); s.perkOwed = clamp(safeCount(raw.perkOwed), 0, PERK_OWED_MAX); s.bossPerks = clamp(safeCount(raw.bossPerks), 0, BOSS_PERKS_MAX); s.perkFrom = raw.perkFrom === 'boss' ? 'boss' : 'goal';
    var ao = raw.autoOff && typeof raw.autoOff === 'object' ? raw.autoOff : {};
    for (var az = 1; az < AUTO_KEYS.length; az++) if (ao[az] === true) s.autoOff[az] = true;
    var ge = raw.goalExt && typeof raw.goalExt === 'object' ? raw.goalExt : {};
    GOALS.concat(GOALS_ALT).forEach(function (list) { list.forEach(function (g) { if (g && s.goalsDone[g.id]) { var tv = clamp(safeCount(ge[g.id]), 0, EXT_MAX); if (tv > 0) s.goalExt[g.id] = tv; } }); });
    var gp = raw.goalPick && typeof raw.goalPick === 'object' ? raw.goalPick : {};
    GOALS_ALT.forEach(function (alt, zi) { var p = gp[zi]; if (Array.isArray(p) && alt.some(function (g) { return !!g; })) s.goalPick[zi] = [0, 1, 2].map(function (k) { return p[k] && alt[k] ? 1 : 0; }); });
    var st = raw.story && typeof raw.story === 'object' ? raw.story : {};
    BEATS.forEach(function (b) { if (st[b.id]) s.story[b.id] = true; });
    var rz = raw.zdex && typeof raw.zdex === 'object' ? raw.zdex : {};
    ZOMBIE_KINDS.forEach(function (z) { var n = clamp(safeCount(rz[z.id]), 0, 1e9); if (n > 0) s.zdex[z.id] = n; });
    var rd = raw.records && typeof raw.records === 'object' ? raw.records : {};
    RECORDS.forEach(function (r) { var n = clamp(safeCount(rd[r.id]), 0, 1e9); if (n > 0) s.records[r.id] = n; });
    s.recordsRun = clamp(safeCount(raw.recordsRun), 0, 1e6);
    var pd = raw.passers && typeof raw.passers === 'object' ? raw.passers : {};
    PASSERS.forEach(function (r) { var n = clamp(safeCount(pd[r.id]), 0, 1e9); if (n > 0) s.passers[r.id] = n; });
    s.passersRun = clamp(safeCount(raw.passersRun), 0, 1e6);
    var rg = raw.cargos && typeof raw.cargos === 'object' ? raw.cargos : {};
    CARGOS.forEach(function (c) { var n = clamp(safeCount(rg[c.id]), 0, 1e9); if (n > 0) s.cargos[c.id] = n; });
    s.salvagesRun = clamp(safeCount(raw.salvagesRun), 0, 1e6);
    s.salvageIn = clamp(safeNum(raw.salvageIn, 150), 0, SALVAGE_GAP_MAX);
    var rs = raw.salvage;
    s.salvage = rs && typeof rs === 'object' && findById(CARGOS, rs.who) && safeNum(rs.need, 0) > 0 && safeNum(rs.left, 0) > 0
      ? { who: rs.who, need: safeNum(rs.need, 0), have: clamp(safeNum(rs.have, 0), 0, safeNum(rs.need, 0)), left: clamp(safeNum(rs.left, 0), 0, SALVAGE_SECONDS) } : null;
    var rc = raw.clients && typeof raw.clients === 'object' ? raw.clients : {};
    CLIENTS.forEach(function (c) { var n = clamp(safeCount(rc[c.id]), 0, 1e9); if (n > 0) s.clients[c.id] = n; });
    s.contractsRun = clamp(safeCount(raw.contractsRun), 0, 1e6);
    s.contractIn = clamp(safeNum(raw.contractIn, 120), 0, CONTRACT_GAP_MAX);
    var rk = raw.contract;
    s.contract = rk && typeof rk === 'object' && findById(CLIENTS, rk.who) && safeNum(rk.need, 0) > 0 && safeNum(rk.left, 0) > 0
      ? { who: rk.who, item: findById(RECIPES, rk.item) ? rk.item : '', need: Math.floor(safeNum(rk.need, 0)), have: clamp(safeNum(rk.have, 0), 0, Math.floor(safeNum(rk.need, 0))), left: clamp(safeNum(rk.left, 0), 0, CONTRACT_SECONDS) } : null;
    var rr = raw.regulars && typeof raw.regulars === 'object' ? raw.regulars : {};
    REGULARS.forEach(function (r) { var n = clamp(safeCount(rr[r.id]), 0, 1e9); if (n > 0) s.regulars[r.id] = n; });
    s.ordersRun = clamp(safeCount(raw.ordersRun), 0, 1e6);
    s.orderIn = clamp(safeNum(raw.orderIn, 120), 0, ORDER_GAP_MAX);
    var ro = raw.order;
    s.order = ro && typeof ro === 'object' && findById(REGULARS, ro.who) && safeNum(ro.need, 0) > 0 && safeNum(ro.left, 0) > 0
      ? { who: ro.who, need: Math.floor(safeNum(ro.need, 0)), left: clamp(safeNum(ro.left, 0), 0, ORDER_SECONDS) } : null;
    var ra = raw.ach && typeof raw.ach === 'object' ? raw.ach : {};
    // 값은 달성한 시각(ms). 날짜를 적기 전의 저장(true)은 버린다: 조건을 아직 채우고 있으면 곧바로 오늘 날짜로 다시 달성된다(0.9.10 에서 한 번 초기화)
    ACHIEVEMENTS.forEach(function (a) { var v = ra[a.id]; if (typeof v === 'number' && isFinite(v) && v > 0) s.ach[a.id] = Math.floor(v); });
    // 예전에는 '문 앞'까지만 갈 수 있던 구역이 그 뒤 버전에서 열린 경우: 문값은 이미 치렀으므로 들여보낸다.
    if (s.gate && s.zone + 1 < ZONES.length && ZONES[s.zone + 1].kind !== 'soon') {
      s.zone++; s.gate = false; s.bestZone = Math.max(s.bestZone, s.zone);
      delete s.story['z' + ZONES[s.zone].no + '-0'];      // 그때 읽은 것은 '문 앞' 글이다. 들어설 때의 일지는 새로 보여 준다.
    }
    s.zoneLog = (Array.isArray(raw.zoneLog) ? raw.zoneLog : []).filter(function (r) {
      return r && typeof r === 'object' && isFinite(r.seconds) && r.seconds >= 0 && isFinite(r.day) && Math.floor(r.zone) === r.zone && r.zone >= 1 && r.zone < ZONES.length;
    }).slice(0, ZONES.length).map(function (r) { return { zone: r.zone, seconds: r.seconds, day: Math.max(1, Math.floor(r.day)) }; });
    s.runLog = (Array.isArray(raw.runLog) ? raw.runLog : []).filter(function (r) { return r && typeof r === 'object' && isFinite(r.seconds) && isFinite(r.antibodies) && isFinite(r.zone); })
      .slice(-10).map(function (r) { return { zone: clamp(safeCount(r.zone), 0, ZONES.length - 1), seconds: safeNum(r.seconds, 0), antibodies: safeCount(r.antibodies) }; });
    // 시세는 강화 레벨에 따라 범위가 달라지므로 마지막에 맞춘다
    var range = priceRange(s);
    s.price = clamp(safeNum(raw.price, 1), range.floor, range.ceil);
    s.lowRun = clamp(safeCount(raw.lowRun), 0, LOW_RUN_MAX);
    s.goods = Math.min(s.goods, goodsCap(s));
    s.lastSeen = safeNum(raw.lastSeen, safeNum(now, 0));
    return s;
  }

  /* ---------- 보너스 합산 ---------- */
  /**
   * 구역 강화, 특전, 영구 특성을 모두 모아 항목별 배수로 돌려준다.
   *   prod 전체 생산, z1 / z2 구역별 생산, click 수색 배수, defense 방어력, loot 밤 전리품,
   *   cost 모든 값, z1cost 1구역 시설 값, floor / ceil 시세 범위에 더하는 값, cap 창고 배수,
   *   offline 자리 비움 효율에 더하는 값, antibody 철수 항체 배수, start 선발대 레벨, broker 흥정꾼 여부,
   *   lab 연구 속도, labcost 과제에 드는 점수, staffcost 연구원 값,
   *   z4 화물 값, trip 운행 시간, routecost 노선 값, traincost 열차 값,
   *   z3 완제품 값, z3cost 기계 값, steady 정속 가동 보너스에 더하는 값, slack 정속 가동 기준을 낮추는 값
   */
  function mods(state) {
    var m = { prod: 1, z1: 1, z2: 1, z3: 1, z4: 1, lab: 1, labcost: 1, staffcost: 1, trip: 1, routecost: 1, traincost: 1, click: 1, defense: 1, defcost: 1, repair: 0, reroll: 0, z6: 1, margin: 0, z7: 1, ordergap: 1, contractgap: 1, salvagegap: 1, recordchance: 0, passerchance: 0, autolab: 0, autoguard: 0, autotower: 0, loot: 1, cost: 1, z1cost: 1, z3cost: 1, floor: 0, ceil: 0, cap: 1, offline: 0, antibody: 1, start: 0, broker: 0, assist: 0, steady: 0, slack: 0, patrol: 0, autoline: 0, autosig: 0, rumor: 0 };
    var ADD = { floor: 1, ceil: 1, offline: 1, start: 1, broker: 1, steady: 1, slack: 1, assist: 1, patrol: 1, autoline: 1, autosig: 1, rumor: 1, repair: 1, reroll: 1, margin: 1, recordchance: 1, passerchance: 1, autolab: 1, autoguard: 1, autotower: 1 };      // 더하는 항목. 나머지는 (1 + 레벨 × per) 을 곱한다
    function apply(defs, levels) {
      defs.forEach(function (d) {
        var lv = levels[d.id] || 0;
        if (!lv) return;
        if (ADD[d.key]) m[d.key] += d.per * lv;
        else if (d.per < 0) m[d.key] *= Math.pow(1 + d.per, lv);          // 할인은 곱으로 쌓여 0 아래로 내려가지 않는다
        else m[d.key] *= 1 + d.per * lv;
      });
    }
    apply(UPGRADES, state.upgrades);
    apply(PERKS, state.perks);
    apply(TRAITS, state.traits);
    // 도전 훈장의 고유 보상(1.7.0): 그 도전을 한 번이라도 성공했으면 붙는다(여러 번 성공해도 한 번만)
    m.autoshare = 0; m.scout = 1;
    if (state.stageMarks) m.loot *= Math.pow(BOSS_BADGE_LOOT, badgeCount(state));      // 원정 지역 휘장
    if (state.medals) CHALLENGES.forEach(function (d) { if (state.medals[d.id] > 0 && d.perk) { if (d.perk.add) m[d.perk.key] += d.perk.add; else m[d.perk.key] *= d.perk.mult; } });
    var pe = petEffect(state); if (pe) m[pe.key] *= 1 + pe.bonus;      // 동물 친구
    // 연구 과제: 끝낸 횟수만큼 곱으로 쌓인다
    if (state.research) PROJECTS.forEach(function (d) { var lv = state.research[d.id] || 0; if (lv && d.key !== 'drop') m[d.key] *= Math.pow(d.mult, lv); });
    m.labcost = Math.max(0.3, m.labcost); m.staffcost = Math.max(0.2, m.staffcost);
    m.cost = Math.max(0.2, m.cost);
    m.defcost = Math.max(0.2, m.defcost);
    m.z1cost = Math.max(0.2, m.z1cost);
    m.z3cost = Math.max(0.2, m.z3cost);
    m.routecost = Math.max(0.2, m.routecost); m.traincost = Math.max(0.2, m.traincost);
    m.ordergap = Math.max(0.5, m.ordergap); m.contractgap = Math.max(0.5, m.contractgap); m.salvagegap = Math.max(0.5, m.salvagegap);      // 간격은 절반 아래로 줄지 않는다
    m.trip = Math.max(0.5, m.trip);        // 운행 시간은 절반 아래로 줄지 않는다
    return m;
  }
  /** 전체 생산 배수: 특성·특전 × 막아낸 밤 보너스 × 지원 효과. */
  /*
   * 7구역 송신탑: 안테나를 세워 방송을 멀리 보내면 생존자가 모이고, 모인 사람만큼 모든 구역의 생산이 는다.
   *   생존자 = 초당 (안테나 수 × 2배 문턱 배수 × 개조) 명씩 모인다.
   *   전체 생산 배수 = 1 + TOWER_GAIN × log10(1 + 생존자).  10만 명이면 3.5배.
   *   혈청: 물자를 들여 세 단계로 완성한다(SERUM_COSTS). 마지막 단계를 끝내면 이야기가 끝난다(ended).
   */
  var ANTENNA_COST = 5e28, ANTENNA_GROWTH = 1.13, TOWER_GAIN = 0.5, SERUM_COSTS = [2e31, 6e31, 2e32];
  function towerMult(state) { return zoneOpen(state, 6) ? 1 + TOWER_GAIN * Math.log(1 + Math.max(0, state.survivors || 0)) / Math.LN10 : 1; }
  function globalMult(state) {
    return mods(state).prod * (1 + WAVE_BONUS * state.wavesCleared) * (state.buff ? state.buff.mult : 1) * achMult(state) * towerMult(state) * medalMult(state) * (challengeOn(state, 'lean') ? LEAN_MULT : 1);
  }
  function antennaCost(state, qty) {
    if (!zoneOpen(state, 6) || state.antennas + qty > COUNT_MAX) return Infinity;
    return seriesCost(ANTENNA_COST * mods(state).cost, ANTENNA_GROWTH, state.antennas, qty);
  }
  function maxAntennas(state) { return zoneOpen(state, 6) ? seriesMax(ANTENNA_COST * mods(state).cost, ANTENNA_GROWTH, state.antennas, state.supplies, COUNT_MAX) : 0; }
  function buyAntenna(state, qty) {
    qty = Math.floor(qty);
    if (!zoneOpen(state, 6)) return fail('locked');
    if (!(qty >= 1)) return fail('unknown');
    return pay(state, antennaCost(state, qty), function () { state.antennas += qty; });
  }
  function survivorRate(state) { return zoneOpen(state, 6) && state.antennas > 0 ? state.antennas * milestoneMult(state.antennas) * mods(state).z7 : 0; }
  function serumCost(state) { return state.serumStage < SERUM_COSTS.length && zoneOpen(state, 6) ? Math.ceil(SERUM_COSTS[state.serumStage] * mods(state).cost) : Infinity; }
  /** 혈청을 한 단계 진행한다. 마지막 단계를 끝내면 last 가 참이다. */
  function buySerum(state) {
    if (!zoneOpen(state, 6)) return fail('locked');
    if (state.serumStage >= SERUM_COSTS.length) return fail('done');
    return pay(state, serumCost(state), function () { state.serumStage++; });
  }

  /* ---------- 값 계산(공통) ---------- */
  /** 지금 owned 개를 가진 것을 qty 개 더 살 때의 값(등비수열의 합). */
  function seriesCost(base, growth, owned, qty) {
    if (!(qty >= 1)) return Infinity;
    if (growth === 1) return Math.ceil(base * qty);
    return Math.ceil(base * Math.pow(growth, owned) * (Math.pow(growth, qty) - 1) / (growth - 1));
  }
  /** budget 으로 살 수 있는 최대 개수. */
  function seriesMax(base, growth, owned, budget, cap) {
    var n = 0, room = Math.max(0, cap - owned);
    while (n < room && seriesCost(base, growth, owned, n + 1) <= budget) n++;
    return n;
  }
  function earn(state, amount) {
    if (!(amount > 0) || !isFinite(amount)) return;
    state.supplies += amount; state.runEarned += amount; state.lifetimeEarned += amount;
  }
  /** 흔한 구매 절차: 값이 유한하고 물자가 충분하면 치르고 apply 를 부른다. */
  function pay(state, cost, apply) {
    if (!isFinite(cost)) return fail('max');
    if (cost > state.supplies) return fail('supplies');
    state.supplies -= cost;
    apply();
    return { ok: true, cost: cost };
  }

  /* ---------- 1구역: 수색 ---------- */
  function totalBuildings(s) { var n = 0; BUILDINGS.forEach(function (b) { n += s.buildings[b.id] || 0; }); return n; }
  /**
   * 다음에 2배가 되는 수(문턱). 더 없으면 null.
   *   count 지금 수,  list 문턱 목록(기본은 시설의 MILESTONES)
   */
  function nextMilestone(count, list) {
    var marks = Array.isArray(list) ? list : MILESTONES, n = Number(count);
    if (!isFinite(n)) n = 0;
    for (var i = 0; i < marks.length; i++) if (n < marks[i]) return marks[i];
    return null;
  }
  /** 지금까지 넘은 2배 문턱의 수(등급). 0 이면 아직 하나도 못 넘은 것. */
  function milestoneTier(count, list) {
    var marks = Array.isArray(list) ? list : MILESTONES, n = Number(count), tier = 0;
    if (!isFinite(n)) return 0;
    marks.forEach(function (t) { if (n >= t) tier++; });
    return tier;
  }
  /**
   * 손가락을 뗀 것이 "누르기"인지: 거의 움직이지 않았고(12px 이내) 오래 누르지 않았을 때(0.7초 이내).
   * 두 손가락으로 번갈아 누를 때 직접 누르기를 만들어 주는 데 쓴다(밀기·벌리기와 구별한다).
   */
  function isTap(dx, dy, ms) {
    if (!isFinite(dx) || !isFinite(dy) || !isFinite(ms)) return false;
    return dx * dx + dy * dy <= 144 && ms >= 0 && ms <= 700;
  }
  function milestoneMult(count) { var m = 1; MILESTONES.forEach(function (t) { if (count >= t) m *= 2; }); return m; }
  function buildingCost(state, id, qty) {
    var def = findById(BUILDINGS, id);
    if (!def || state.buildings[id] + qty > COUNT_MAX) return Infinity;
    var m = mods(state);
    return seriesCost(def.baseCost * m.cost * m.z1cost, GROWTH, state.buildings[id], qty);
  }
  function maxBuildings(state, id) {
    var def = findById(BUILDINGS, id);
    if (!def) return 0;
    var m = mods(state);
    return seriesMax(def.baseCost * m.cost * m.z1cost, GROWTH, state.buildings[id], state.supplies, COUNT_MAX);
  }
  function buyBuilding(state, id, qty) {
    qty = Math.floor(qty);
    if (!findById(BUILDINGS, id) || !(qty >= 1)) return fail('unknown');
    return pay(state, buildingCost(state, id, qty), function () { state.buildings[id] += qty; });
  }
  /** 시설 한 종류의 초당 생산(배수 포함). */
  function buildingRate(state, id) {
    var def = findById(BUILDINGS, id), n = def ? state.buildings[id] : 0;
    return def ? def.baseRate * n * milestoneMult(n) * mods(state).z1 * globalMult(state) : 0;
  }
  function searchRate(state) { var t = 0; BUILDINGS.forEach(function (b) { t += buildingRate(state, b.id); }); return t; }

  /* ---------- 2구역: 거래 ---------- */
  /*
   * 좌판이 상품을 만들고, 상품을 시세에 맞춰 팔아 물자로 바꾼다. 시세는 PRICE_STEP 초마다 범위 안에서 바뀐다.
   * 자동 판매가 켜져 있으면(기본) 창고가 찼을 때 알아서 판다: 가만히 둬도 평균 시세만큼은 번다.
   * 직접 높은 시세를 골라 팔면 그보다 더 번다. 적극적으로 하는 사람의 이득은 평균의 1.5배 안팎이다.
   */
  function zoneOpen(state, index) { return state.zone >= index; }
  /**
   * '고점'으로 치는 시세. 시세 범위가 개조로 넓어지면 고점도 따라 올라간다(평균과 최고가 사이의 PEAK_SHARE 지점).
   * 기본 범위(0.5~2)에서는 PEAK_PRICE(1.8)와 같다. 전에는 1.8 로 고정돼 있어서, 범위를 넓히면 고점이 평균보다 낮아졌다.
   */
  var PEAK_SHARE = (PEAK_PRICE - (PRICE_FLOOR + PRICE_CEIL) / 2) / (PRICE_CEIL - (PRICE_FLOOR + PRICE_CEIL) / 2);
  function peakPrice(state) { var r = priceRange(state); return Math.round((r.mean + (r.ceil - r.mean) * PEAK_SHARE) * 100) / 100; }
  var LOW_RUN_MAX = 3;      // 평균 아래 시세가 이만큼 이어지면 다음은 평균 위
  function priceRange(state) {
    var m = mods(state), floor = PRICE_FLOOR + m.floor, ceil = PRICE_CEIL + m.ceil;
    return { floor: Math.min(floor, ceil), ceil: ceil, mean: (Math.min(floor, ceil) + ceil) / 2 };
  }
  /*
   * 시장의 일손: 좌판 말고도 2구역 운영 화면에서 살 수 있는 것. 값은 살 때마다 GROWTH 배.
   *   짐꾼은 쌓아 둘 수 있는 양을, 호객꾼은 상품 값을 올린다(per 는 한 명마다 더하는 비율). 철수하면 사라진다.
   */
  var HANDS = [
    { id: 'porter', name: '짐꾼',   desc: '쌓아 둘 수 있는 양 +10%', per: 0.10, baseCost: 2e5, max: 100 },
    { id: 'crier',  name: '호객꾼', desc: '상품 값 +3%',             per: 0.03, baseCost: 1e6, max: 200 }
  ];
  function handBonus(state, id) { var d = findById(HANDS, id); return d ? 1 + d.per * (state.hands[id] || 0) : 1; }
  function handCost(state, id, qty) {
    var d = findById(HANDS, id);
    if (!d || !zoneOpen(state, 1) || !(qty >= 1) || state.hands[id] + qty > d.max) return Infinity;
    return seriesCost(d.baseCost * mods(state).cost, GROWTH, state.hands[id], qty);
  }
  function maxHands(state, id) {
    var d = findById(HANDS, id);
    return d && zoneOpen(state, 1) ? seriesMax(d.baseCost * mods(state).cost, GROWTH, state.hands[id], state.supplies, d.max) : 0;
  }
  function buyHand(state, id, qty) {
    qty = Math.floor(qty);
    if (!findById(HANDS, id)) return fail('unknown');
    if (!zoneOpen(state, 1)) return fail('locked');
    if (!(qty >= 1)) return fail('unknown');
    return pay(state, handCost(state, id, qty), function () { state.hands[id] += qty; });
  }
  function stallCost(state, qty) {
    if (!zoneOpen(state, 1) || state.stalls + qty > COUNT_MAX) return Infinity;
    return seriesCost(5e4 * mods(state).cost, GROWTH, state.stalls, qty);
  }
  function maxStalls(state) { return zoneOpen(state, 1) ? seriesMax(5e4 * mods(state).cost, GROWTH, state.stalls, state.supplies, COUNT_MAX) : 0; }
  function buyStall(state, qty) {
    qty = Math.floor(qty);
    if (!zoneOpen(state, 1)) return fail('locked');
    if (!(qty >= 1)) return fail('unknown');
    return pay(state, stallCost(state, qty), function () { state.stalls += qty; });
  }
  /** 좌판 전체가 초당 만드는 상품 수. */
  function goodsRate(state) { return zoneOpen(state, 1) ? state.stalls * milestoneMult(state.stalls) : 0; }
  function goodsCap(state) { return goodsRate(state) * GOODS_CAP_SECONDS * mods(state).cap * handBonus(state, 'porter'); }
  /** 상품 하나를 시세 1 에 팔았을 때의 물자. */
  function goodsValue(state) { return GOODS_VALUE * mods(state).z2 * globalMult(state) * handBonus(state, 'crier') * orderMult(state); }
  /** 연속 호가로 직접 판매에 붙는 배수(1 ~ 1.5). */
  function streakMult(state) { return 1 + Math.min(STREAK_MAX, state.streak || 0) * STREAK_BONUS; }
  /**
   * 가진 상품을 지금 시세에 모두 판다. auto 가 참이면 자동 판매다.
   * 연속 호가: 시세가 평균 이상일 때 팔면 단계가 하나 오른다(시세 하나에 한 번만). 직접 평균 아래에서 팔면 0 으로 돌아간다.
   *   단계마다 판매 값이 STREAK_BONUS 만큼 는다(이번 판매에는 오르기 전의 단계가 적용된다).
   *   자동 판매도 똑같이 단계를 올리고 보너스를 받는다. 다만 낮은 시세에 자동으로 팔려도 끊기지는 않는다: 챙기지 않아도 손해 보지 않게.
   */
  function sellGoods(state, auto) {
    if (!zoneOpen(state, 1)) return fail('locked');
    if (!(state.goods > 0)) return fail('empty');
    var price = state.price, bonus = streakMult(state);
    var gain = state.goods * price * goodsValue(state) * bonus;
    earn(state, gain);
    state.tradeEarned += gain;
    if (price >= peakPrice(state)) state.peakSales++;
    state.goods = 0;
    var below = price < priceRange(state).mean;
    if (below) { if (!auto) state.streak = 0; }      // 자동 판매는 낮은 시세에 팔아도 끊지 않는다(창고가 차서 어쩔 수 없이 판 것이다)
    else if (!state.streakUsed) { state.streak = Math.min(STREAK_MAX, state.streak + 1); state.streakUsed = true; }
    return { ok: true, gain: gain, price: price, peak: price >= peakPrice(state), bonus: bonus, streak: state.streak };
  }
  function setAutoSell(state, on) { state.autoSell = !!on; return { ok: true, on: state.autoSell }; }
  /**
   * 흥정꾼이 고점에서만 팔게 한다(1.3.2). 꺼 두면 전처럼 평균 이상에서 판다.
   * 평균 이상에서 자주 팔면 상품이 쌓일 틈이 없어서 창고를 늘린 보람이 없었다. 고점을 기다리면 창고가 클수록 더 오래 버티며 비싸게 판다(창고가 차면 시세와 상관없이 판다).
   */
  function setSellPeak(state, on) { state.sellPeak = !!on; return { ok: true, on: state.sellPeak }; }
  /** 2구역이 가만히 둘 때 초당 버는 물자(평균 시세 기준). 화면의 '초당' 표시와 자리 비움 계산에 쓴다. */
  function tradeRate(state) { return goodsRate(state) * goodsValue(state) * priceRange(state).mean; }
  var SELL_AUTO_SECONDS = 10;   // 흥정꾼 1레벨이 한 번 파는 간격(초)
  /** 흥정꾼이 한 번 파는 간격(초). 레벨마다 2초씩 줄어든다(2초까지). 자동화 특성만 있으면 10초. */
  function sellInterval(state) { return Math.max(2, SELL_AUTO_SECONDS - 2 * Math.max(0, mods(state).broker - 1)); }
  /*
   * 단골 주문(1.0.3): 2구역에 머무는 긴 시간 동안 할 거리와 모을 거리를 준다.
   *   몇 분마다 단골 하나가 "상품 N개를 M초 안에" 달라고 온다. 쌓인 상품으로 넘기면 물자(평균 시세의 ORDER_PAY 배)와 간식을 받고,
   *   그 단골이 도감에 적힌다(철수해도 남는다). 이번 회차에 채운 주문 하나마다 상품 값이 ORDER_BONUS 씩 오른다(ORDER_BONUS_MAX 까지).
   *   놓쳐도 잃는 것은 없다(방치해도 손해가 없게). 자리를 비운 동안에는 오지 않는다.
   */
  var REGULARS = [
    { id: 'dried',   name: '건어물 할머니',   color: '#8a5a44', hair: '#d8d8d0', text: '저울 눈금을 절대 속이지 않아요.' },
    { id: 'fish',    name: '생선 장수',       color: '#3f6f8f', hair: '#2a2a2a', text: '얼음 대신 강물로 식혀 와요.' },
    { id: 'mill',    name: '방앗간 아저씨',   color: '#c9a04a', hair: '#4a3628', text: '고춧가루 냄새가 먼저 와요.' },
    { id: 'fruit',   name: '과일 트럭',       color: '#b8402e', hair: '#17180f', text: '확성기가 아직 돼요.' },
    { id: 'tools',   name: '철물점 주인',     color: '#5a5f6a', hair: '#8a8a82', text: '못 하나도 세어서 줘요.' },
    { id: 'herbs',   name: '약초꾼',          color: '#5a7a3a', hair: '#3a2a22', text: '산에서 내려올 때마다 들러요.' },
    { id: 'rice',    name: '떡집 자매',       color: '#e6d8c0', hair: '#2a2a2a', text: '둘이 번갈아 와요.' },
    { id: 'taffy',   name: '엿장수',          color: '#d08a3c', hair: '#6a4a3a', text: '가위 소리로 온 줄 알아요.' },
    { id: 'tailor',  name: '수선집 할아버지', color: '#4f5d73', hair: '#e6e5db', text: '우비 솔기를 봐 줬어요.' },
    { id: 'soup',    name: '국밥집 이모',     color: '#a8483a', hair: '#3a2a22', text: '오면 꼭 한 그릇 놓고 가요.' },
    { id: 'flower',  name: '꽃집 청년',       color: '#7a9a6a', hair: '#4a3628', text: '씨앗만 받아 가요.' },
    { id: 'busker',  name: '야시장 악사',     color: '#6a4a8a', hair: '#17180f', text: '값은 노래로도 받아 달래요.' }
  ];
  var ORDER_SECONDS = 90, ORDER_GAP_MIN = 150, ORDER_GAP_MAX = 270, ORDER_PAY = 2, ORDER_BONUS = 0.01, ORDER_BONUS_MAX = 0.5, ORDER_TREATS = 2;
  /** 이번 회차에 채운 주문으로 오른 상품 값 배수(1 ~ 1.5). */
  function orderMult(state) { return 1 + Math.min(ORDER_BONUS_MAX, (state.ordersRun || 0) * ORDER_BONUS); }
  function regularCount(state) { var n = 0; REGULARS.forEach(function (r) { if (state.regulars[r.id] > 0) n++; }); return n; }
  /** 주문을 넘겼을 때 받는 물자. */
  function orderReward(state) { return state.order ? state.order.need * goodsValue(state) * priceRange(state).mean * ORDER_PAY : 0; }
  function stepOrders(state, dt, rng, events) {
    if (!zoneOpen(state, 1) || !(goodsRate(state) > 0)) return;
    if (state.order) {
      // 흥정꾼을 두고 자동 판매를 켜 놓았으면 주문도 알아서 넘긴다(1.3.1): 자리에 없어서 단골을 놓치는 손해가 없게
      if (state.autoSell && autoEvents(state, 1) && state.goods >= state.order.need) { var of = fillOrder(state); if (of.ok) { of.type = 'order-filled'; events.push(of); return; } }
      state.order.left -= dt;
      if (state.order.left <= 0) { events.push({ type: 'order-gone', who: state.order.who }); state.order = null; }
      return;
    }
    state.orderIn -= dt;
    if (state.orderIn > 0) return;
    rng = typeof rng === 'function' ? rng : Math.random;
    var who = REGULARS[Math.floor(rng() * REGULARS.length) % REGULARS.length];
    // 주문량: 좌판이 45초쯤 만드는 양. 창고에 다 들어가지 않으면 창고의 8할로 줄인다
    var need = Math.max(10, Math.floor(Math.min(goodsCap(state) * 0.8, goodsRate(state) * 45)));
    state.order = { who: who.id, need: need, left: ORDER_SECONDS };
    state.orderIn = (ORDER_GAP_MIN + rng() * (ORDER_GAP_MAX - ORDER_GAP_MIN)) * mods(state).ordergap;
    events.push({ type: 'order', who: who.id, name: who.name, need: need });
  }
  /** 쌓인 상품으로 주문을 넘긴다. 상품이 모자라면 실패(주문은 남는다). */
  function fillOrder(state) {
    if (!state.order) return fail('none');
    if (!(state.goods >= state.order.need)) return fail('short');
    var who = findById(REGULARS, state.order.who), gain = orderReward(state), first = !(state.regulars[state.order.who] > 0);
    state.goods -= state.order.need;
    earn(state, gain);
    state.tradeEarned += gain;
    state.treats = Math.min(1e9, state.treats + ORDER_TREATS);
    state.regulars[state.order.who] = Math.min(1e9, (state.regulars[state.order.who] || 0) + 1);
    state.ordersRun = (state.ordersRun || 0) + 1;
    state.order = null;
    return { ok: true, gain: gain, treats: ORDER_TREATS, first: first, who: who ? who.id : '', name: who ? who.name : '' };
  }
  function stepTrade(state, dt, rng, events) {
    if (!zoneOpen(state, 1)) return;
    state.priceClock += dt;
    while (state.priceClock >= PRICE_STEP) {
      state.priceClock -= PRICE_STEP;
      state.priceHistory.push(state.price);                       // 시세판에 지난 시세를 남긴다
      if (state.priceHistory.length > PRICE_HISTORY) state.priceHistory.splice(0, state.priceHistory.length - PRICE_HISTORY);
      state.streakUsed = false;                                   // 새 시세에서는 다시 단계를 올릴 수 있다
      var r = priceRange(state);
      /*
       * 시세 뽑기(1.3.1): 바닥과 천장 사이에서 고르게 뽑되, 평균 아래가 LOW_RUN_MAX 번 이어지면 다음 시세는 반드시 평균 위에서 뽑는다.
       *   고르게만 뽑으면 평균 아래가 다섯 번 넘게 이어지는 일이 서른 번에 한 번꼴로 생겨서, 하한가만 나온다는 느낌을 줬다.
       *   이 보정으로 평균 위가 나오는 비율은 50% → 53%쯤, 평균 아래가 가장 길게 이어지는 길이는 3번이 된다.
       */
      var lowStreak = (state.lowRun || 0) >= LOW_RUN_MAX, from = lowStreak ? r.mean : r.floor;
      state.price = Math.round((from + rng() * (r.ceil - from)) * 100) / 100;
      state.lowRun = state.price < r.mean ? (state.lowRun || 0) + 1 : 0;
    }
    var cap = goodsCap(state);
    state.goods = Math.min(cap, state.goods + goodsRate(state) * dt);
    if (!state.autoSell || !autoOn(state, 1)) return;
    // 자동 판매(흥정꾼): 시세가 평균 이상인 동안 sellInterval 초마다 한 번씩 판다. 낮은 시세에서는 기다린다(시계는 다 찬 채로 멈춘다).
    // 창고가 차면 시세와 상관없이 판다(버려지지 않게).
    var every = sellInterval(state);
    state.sellClock = Math.min(every, state.sellClock + dt);
    if (!(state.goods > 0)) return;
    var full = state.goods >= cap, good = state.price >= (state.sellPeak ? peakPrice(state) : priceRange(state).mean) && state.sellClock >= every;
    // 단골 주문이 와 있으면 흥정꾼은 팔지 않고 상품을 모아 둔다(창고가 차면 판다). 그러지 않으면 자동 판매를 켠 사람은 주문을 채울 상품이 쌓이지 않는다
    if (state.order && !full) return;
    if (full || good) state.sellClock = 0;
    if (full || good) { var sold = sellGoods(state, true); if (sold.ok) { sold.type = 'sold'; sold.auto = true; events.push(sold); } }
  }

  /* ---------- 3구역: 생산 라인 ---------- */
  /*
   * 기계 셋이 차례로 맞물려 돈다. 라인은 가장 느린 기계(병목)의 속도로만 나온다: 빠른 기계를 더 올려 봐야 소용없다.
   *   가동률 = 가장 느린 기계 ÷ 가장 빠른 기계. STEADY_AT 이상이면 '정속 가동'으로 산출이 늘어난다.
   *   기계 레벨의 합계가 LINE_MILESTONES 에 닿을 때마다 라인 전체가 2배가 된다.
   * 상품을 쌓아 두고 파는 2구역과 달리 만든 즉시 물자가 된다. 할 일은 "어느 기계를 올릴까"다.
   */
  /*
   * 3구역에서 할 일 셋(1.5.0). 전에는 병목을 올리고 기다리는 것뿐이었다.
   *
   * ① 품목과 숙련(RECIPES): 볼트·철판·톱니 가운데 무엇을 만들지 고른다. 품목마다 숙련도(0~1)가 있고, 만드는 동안 MASTERY_SECONDS 에 걸쳐 찬다.
   *    숙련이 낮은 품목은 라인이 느리다: 배수 = MASTERY_MIN + (1 - MASTERY_MIN) × 숙련. 볼트는 처음부터 다 익혀 있다(전과 같은 속도).
   *    세 품목을 모두 익히면 라인이 MASTERY_ALL 배가 된다. 품목을 바꾸면 RETOOL_SECONDS 동안 라인이 선다.
   *    납품 의뢰는 품목을 정해서 오고, 그 품목을 만드는 동안에만 찬다.
   *    (1.4.1 에서는 품목마다 기계의 처리량이 달랐다. 그러면 다른 품목을 만들며 기계를 올린 사람은 어느 품목에서도 정속 가동을 못 맞추게 되고,
   *     기계 값이 레벨마다 불어나서 되돌리기도 어려웠다. 기계는 건드리지 않고 숙련으로 바꿨다.)
   * ② 고장과 정비: JAM_GAP 마다 기계 하나가 멈칫거려 라인이 JAM_SLOW 배로 느려진다. "고친다"를 누르면 바로 풀리고 TUNE_SECONDS 동안 라인이 TUNE_MULT 배로 돈다.
   *    내버려 두면 JAM_SELF_FIX 초 뒤에 저절로 풀린다(보너스 없음). 자동 제어반이 있으면 JAM_AUTO_FIX 초 만에 알아서 풀지만 보너스는 없다: 손으로 고치는 쪽이 낫다.
   * ③ 출하 트럭: 라인이 도는 동안 출하장에 완제품이 쌓인다(TRUCK_STOCK_MAX 초분까지). TRUCK_GAP 마다 트럭이 와서 TRUCK_WAIT 초 기다린다.
   *    실으면 쌓인 시간 × 초당 수입 × TRUCK_SHARE 만큼 더 받는다. 놓치면 쌓인 것은 그대로 남는다. 자동 제어반은 TRUCK_AUTO 배로 알아서 싣는다.
   *
   * 평균 수입(lineRate)은 이 셋을 넣지 않는다: 자리 비움과 화면의 "초당"은 전과 같다. 고장·정비·트럭은 접속해 있을 때만 일어난다.
   */
  var RECIPES = [
    { id: 'bolt',  name: '볼트' },
    { id: 'plate', name: '철판' },
    { id: 'gear',  name: '톱니' }
  ];
  var RETOOL_SECONDS = 6, MASTERY_MIN = 0.5, MASTERY_SECONDS = 180, MASTERY_ALL = 1.1;
  function mastery(state, id) { var m = state.mastery && state.mastery[id]; return id === 'bolt' ? 1 : Math.max(0, Math.min(1, m || 0)); }
  function masteredAll(state) { return RECIPES.every(function (r) { return mastery(state, r.id) >= 1; }); }
  /** 그 품목을 만들 때의 라인 배수(숙련). */
  function recipeFactor(state, id) { return (MASTERY_MIN + (1 - MASTERY_MIN) * mastery(state, id)) * (masteredAll(state) ? MASTERY_ALL : 1); }
  var JAM_GAP_MIN = 70, JAM_GAP_MAX = 130, JAM_SLOW = 0.5, JAM_SELF_FIX = 30, JAM_AUTO_FIX = 5, TUNE_SECONDS = 15, TUNE_MULT = 2;
  var TRUCK_GAP_MIN = 80, TRUCK_GAP_MAX = 130, TRUCK_WAIT = 20, TRUCK_STOCK_MAX = 120, TRUCK_SHARE = 0.3, TRUCK_AUTO = 0.5;
  function recipeOf(state) { return findById(RECIPES, state.recipe) || RECIPES[0]; }
  function machineRate(state, id) { var d = findById(MACHINES, id); return d ? d.rate : 0; }
  /** 품목을 바꾼다. 바꾸는 동안(RETOOL_SECONDS) 라인이 선다. */
  function setRecipe(state, id) {
    if (!zoneOpen(state, 2)) return fail('locked');
    if (!findById(RECIPES, id)) return fail('unknown');
    if (recipeOf(state).id === id) return fail('same');
    // 이미 라인이 서 있으면(기계 다시 맞추기 30초 등) 남은 시간을 줄이지 않는다: 전에는 품목을 바꾸면 30초가 6초로 덮여서 기다림을 건너뛸 수 있었다
    state.recipe = id; state.retool = Math.max(state.retool || 0, RETOOL_SECONDS);
    return { ok: true, id: id, seconds: Math.ceil(state.retool) };
  }
  /** 지금 이 순간 라인에 걸린 배수: 품목을 바꾸는 중이면 0, 고장이면 느려지고, 정비 직후면 빨라진다. */
  function lineFactor(state) {
    if (state.retool > 0) return 0;
    return recipeFactor(state, recipeOf(state).id) * (state.jam ? JAM_SLOW : 1) * (state.tuneLeft > 0 ? TUNE_MULT : 1);
  }
  /** 멈칫거리는 기계를 고친다. 바로 풀리고, 잠깐 라인이 더 빨리 돈다. */
  function repairJam(state) {
    if (!state.jam) return fail('none');
    var id = state.jam.id;
    state.jam = null; state.tuneLeft = TUNE_SECONDS; state.repairsRun = (state.repairsRun || 0) + 1;
    return { ok: true, id: id, seconds: TUNE_SECONDS };
  }
  /** 트럭에 실으면 받을 물자. */
  function truckReward(state, auto) { return lineRate(state) * Math.max(0, state.stockSec || 0) * TRUCK_SHARE * (auto ? autoShare(state, 2) : 1); }
  /** 출하장에 쌓인 것을 트럭에 싣는다. */
  function loadTruck(state, auto) {
    if (!state.truck) return fail('none');
    var gain = truckReward(state, auto), secs = state.stockSec || 0;
    earn(state, gain); state.lineEarned += gain;
    state.stockSec = 0; state.truck = null; state.trucksRun = (state.trucksRun || 0) + 1;
    return { ok: true, gain: gain, seconds: secs, auto: !!auto };
  }
  /** 고장·정비·출하 트럭의 시간을 흘린다. 라인이 돌지 않으면 아무 일도 없다. */
  function stepLineEvents(state, dt, rng, events) {
    if (!zoneOpen(state, 2)) return;
    state.retool = Math.max(0, (state.retool || 0) - dt);
    state.tuneLeft = Math.max(0, (state.tuneLeft || 0) - dt);
    if (!(lineInfo(state).flow > 0)) return;
    rng = typeof rng === 'function' ? rng : Math.random;
    var auto = autoEvents(state, 2);
    // 고장
    if (state.jam) {
      state.jam.left -= dt;
      if (auto && state.jam.left <= JAM_SELF_FIX - JAM_AUTO_FIX) {
        events.push({ type: 'jam-fixed', id: state.jam.id, auto: true });
        if (state.zone > 2) repairJam(state); else state.jam = null;      // 지나온 구역이면 자동 제어반이 손으로 고친 것처럼 정비 효과까지 낸다
      }
      else if (state.jam.left <= 0) { events.push({ type: 'jam-fixed', id: state.jam.id, auto: false }); state.jam = null; }
    } else {
      state.jamIn -= dt;
      if (state.jamIn <= 0) {
        var def = MACHINES[Math.floor(rng() * MACHINES.length) % MACHINES.length];
        state.jam = { id: def.id, left: JAM_SELF_FIX };
        state.jamIn = JAM_GAP_MIN + rng() * (JAM_GAP_MAX - JAM_GAP_MIN);
        events.push({ type: 'jam', id: def.id, name: def.name });
      }
    }
    // 출하장과 트럭
    if (!(state.retool > 0)) {
      state.stockSec = Math.min(TRUCK_STOCK_MAX, (state.stockSec || 0) + dt);
      // 숙련: 만드는 동안 그 품목이 손에 익는다
      var rid = recipeOf(state).id;
      if (rid !== 'bolt' && mastery(state, rid) < 1) { var was = masteredAll(state); state.mastery[rid] = Math.min(1, mastery(state, rid) + dt / MASTERY_SECONDS); if (state.mastery[rid] >= 1) events.push({ type: 'mastered', id: rid, name: recipeOf(state).name, all: !was && masteredAll(state) }); }
    }
    if (state.truck) {
      state.truck.left -= dt;
      if (auto && state.truck.left <= TRUCK_WAIT - 3) { var lt = loadTruck(state, true); lt.type = 'truck-loaded'; events.push(lt); }
      else if (state.truck.left <= 0) { state.truck = null; events.push({ type: 'truck-gone' }); }
    } else {
      state.truckIn -= dt;
      if (state.truckIn <= 0) {
        state.truck = { left: TRUCK_WAIT };
        state.truckIn = TRUCK_GAP_MIN + rng() * (TRUCK_GAP_MAX - TRUCK_GAP_MIN);
        events.push({ type: 'truck', seconds: state.stockSec });
      }
    }
  }
  function machineLevels(s) { var n = 0; MACHINES.forEach(function (d) { n += s.machines[d.id] || 0; }); return n; }
  function lineMilestone(levels) { var m = 1; LINE_MILESTONES.forEach(function (t) { if (levels >= t) m *= 2; }); return m; }
  function machineBase(state, def) { var m = mods(state); return def.baseCost * m.cost * m.z3cost; }
  function machineCost(state, id, qty) {
    var def = findById(MACHINES, id);
    if (!def || !zoneOpen(state, 2) || state.machines[id] + qty > COUNT_MAX) return Infinity;
    return seriesCost(machineBase(state, def), GROWTH, state.machines[id], qty);
  }
  function maxMachines(state, id) {
    var def = findById(MACHINES, id);
    return def && zoneOpen(state, 2) ? seriesMax(machineBase(state, def), GROWTH, state.machines[id], state.supplies, COUNT_MAX) : 0;
  }
  function buyMachine(state, id, qty) {
    qty = Math.floor(qty);
    if (!findById(MACHINES, id) || !(qty >= 1)) return fail('unknown');
    if (!zoneOpen(state, 2)) return fail('locked');
    return pay(state, machineCost(state, id, qty), function () { state.machines[id] += qty; });
  }
  /**
   * 라인의 지금 상태.
   *   caps 기계별 초당 처리량, flow 라인의 초당 완제품(병목 기준, 배수 전), bottleneck 가장 느린 기계의 id,
   *   load 가동률(0~1), steadyAt 정속 가동 기준, steady 정속 가동 중인가, bonus 정속 가동 배수(아니면 1),
   *   levels 레벨 합계, milestone 레벨 합계 배수, nextMilestone 다음 2배가 되는 합계(없으면 null)
   */
  function lineInfo(state) {
    var m = mods(state), caps = {}, lo = Infinity, hi = 0, bottleneck = null, open = zoneOpen(state, 2);
    MACHINES.forEach(function (d) {
      var c = open ? machineRate(state, d.id) * (state.machines[d.id] || 0) : 0;
      caps[d.id] = c;
      if (c < lo) { lo = c; bottleneck = d.id; }
      if (c > hi) hi = c;
    });
    var load = hi > 0 ? lo / hi : 0, steadyAt = Math.max(0.5, STEADY_AT - m.slack), steady = lo > 0 && load >= steadyAt - 1e-9;
    var levels = machineLevels(state), next = null;
    for (var i = 0; i < LINE_MILESTONES.length; i++) if (levels < LINE_MILESTONES[i]) { next = LINE_MILESTONES[i]; break; }
    return { caps: caps, flow: lo, bottleneck: bottleneck, load: load, steadyAt: steadyAt, steady: steady,
      bonus: steady ? 1 + STEADY_BONUS + m.steady : 1, levels: levels, milestone: lineMilestone(levels), nextMilestone: next };
  }
  /** 완제품 하나의 값(물자). */
  /*
   * 납품 의뢰(1.0.8, 3구역): 2구역의 단골 주문과 같은 틀이다.
   *   몇 분마다 거래처 하나가 "완제품 N개를 M초 안에" 달라고 온다. 의뢰가 온 뒤로 라인이 만든 완제품이 차곡차곡 쌓이고(평소 수입은 그대로),
   *   다 차면 "납품한다"를 눌러 물자(완제품 값의 CONTRACT_PAY 배)와 간식을 받는다. 그 거래처는 도감에 적힌다(철수해도 남는다).
   *   이번 회차에 채운 의뢰 하나마다 완제품 값이 CONTRACT_BONUS 씩 오른다(CONTRACT_BONUS_MAX 까지). 전력 투입을 쓰면 더 빨리 찬다.
   *   놓쳐도 잃는 것은 없고, 자리를 비운 동안에는 오지 않는다.
   */
  var CLIENTS = [
    { id: 'bike',    name: '자전거포',         color: '#3f6f8f', hair: '#2a2a2a', text: '체인이 없어서 못 고친대요.' },
    { id: 'garage',  name: '정비소',           color: '#5a5f6a', hair: '#17180f', text: '기름 묻은 장부를 들고 와요.' },
    { id: 'forge',   name: '철공소',           color: '#8a5a44', hair: '#6a4a3a', text: '망치 소리가 다시 나요.' },
    { id: 'sign',    name: '간판집',           color: '#b8402e', hair: '#3a2a22', text: '구역 표지판을 새로 달아요.' },
    { id: 'boiler',  name: '보일러 기사',      color: '#d08a3c', hair: '#8a8a82', text: '겨울 전에 다 돌려야 한대요.' },
    { id: 'farm',    name: '농기구상',         color: '#5a7a3a', hair: '#4a3628', text: '옥상 텃밭에서 소문을 들었대요.' },
    { id: 'welder',  name: '용접공',           color: '#30343c', hair: '#17180f', text: '불꽃을 보면 멀리서도 알아요.' },
    { id: 'junk',    name: '고물상',           color: '#6b4a3a', hair: '#d8d8d0', text: '주는 것보다 가져가는 게 많아요.' },
    { id: 'print',   name: '인쇄소',           color: '#e6d8c0', hair: '#2a2a2a', text: '전단지를 찍어 붙이고 다녀요.' },
    { id: 'wood',    name: '목공소',           color: '#c9a04a', hair: '#6a4a3a', text: '문짝을 맞춰 달아 줘요.' },
    { id: 'battery', name: '배터리 가게',      color: '#7a9a6a', hair: '#3a2a22', text: '충전은 해 줄 테니 부품을 달래요.' },
    { id: 'radio',   name: '무전기 수리점',    color: '#6a4a8a', hair: '#4a3628', text: '잡음을 줄일 수 있대요.' }
  ];
  var CONTRACT_SAME = 0.5;      // 의뢰가 지금 만드는 품목으로 올 확률
  var CONTRACT_SECONDS = 90, CONTRACT_NEED_SECONDS = 50, CONTRACT_GAP_MIN = 150, CONTRACT_GAP_MAX = 270, CONTRACT_PAY = 2, CONTRACT_BONUS = 0.01, CONTRACT_BONUS_MAX = 0.5, CONTRACT_TREATS = 2;
  function contractMult(state) { return 1 + Math.min(CONTRACT_BONUS_MAX, (state.contractsRun || 0) * CONTRACT_BONUS); }
  function clientCount(state) { var n = 0; CLIENTS.forEach(function (c) { if (state.clients[c.id] > 0) n++; }); return n; }
  function contractReward(state) { return state.contract ? state.contract.need * productValue(state) * CONTRACT_PAY : 0; }
  /** 라인이 지금 초당 내는 완제품 수(전력 투입은 빼고). */
  function productFlow(state) { var pv = productValue(state); return pv > 0 ? lineRate(state) / pv : 0; }
  function stepContracts(state, dt, made, rng, events) {
    if (!zoneOpen(state, 2) || !(productFlow(state) > 0)) return;
    if (state.contract) {
      // 1.6.1: 자동에 맡겼으면 의뢰가 바라는 품목으로 알아서 바꾼다(전에는 품목이 다르면 의뢰가 차지 않은 채 떠났다)
      if (autoEvents(state, 2) && state.contract.item && state.contract.item !== recipeOf(state).id && !(state.retool > 0) && setRecipe(state, state.contract.item).ok) events.push({ type: 'auto-recipe', item: state.contract.item });
      // 의뢰가 정한 품목을 만드는 동안에만 찬다(1.5.0). 품목이 없는 옛 저장의 의뢰는 무엇을 만들어도 찬다
      if (!state.contract.item || state.contract.item === recipeOf(state).id) state.contract.have = Math.min(state.contract.need, state.contract.have + made);
      // 자동 제어반이 있으면 다 채운 의뢰를 알아서 넘긴다(1.3.1)
      if (autoEvents(state, 2) && state.contract.have >= state.contract.need) { var cf = fillContract(state); if (cf.ok) { cf.type = 'contract-filled'; events.push(cf); return; } }
      state.contract.left -= dt;
      if (state.contract.left <= 0) { events.push({ type: 'contract-gone', who: state.contract.who }); state.contract = null; }
      return;
    }
    state.contractIn -= dt;
    if (state.contractIn > 0) return;
    rng = typeof rng === 'function' ? rng : Math.random;
    var who = CLIENTS[Math.floor(rng() * CLIENTS.length) % CLIENTS.length];
    // 품목: 절반은 지금 만드는 것, 절반은 다른 둘 중 하나. 필요한 양은 그 품목으로 돌렸을 때의 속도로 잡는다(바꾸면 채울 수 있게)
    var others = RECIPES.filter(function (r) { return r.id !== recipeOf(state).id; });
    var item = rng() < CONTRACT_SAME || (state.zone > 2 && autoEvents(state, 2)) ? recipeOf(state).id :      // 지나온 구역을 자동에 맡겼으면 지금 만드는 품목으로만 온다
       others[Math.floor(rng() * others.length) % others.length].id;
    var need = Math.max(5, Math.ceil(productFlow(state) * recipeFactor(state, item) * CONTRACT_NEED_SECONDS));      // 지금의 숙련으로 50초쯤 만들 양
    state.contract = { who: who.id, item: item, need: need, have: 0, left: CONTRACT_SECONDS };
    state.contractIn = (CONTRACT_GAP_MIN + rng() * (CONTRACT_GAP_MAX - CONTRACT_GAP_MIN)) * mods(state).contractgap;
    events.push({ type: 'contract', who: who.id, name: who.name, need: need, item: item, itemName: findById(RECIPES, item).name });
  }
  /** 다 찬 의뢰를 납품한다. 아직 덜 찼으면 실패(의뢰는 남는다). */
  function fillContract(state) {
    if (!state.contract) return fail('none');
    if (!(state.contract.have >= state.contract.need)) return fail('short');
    var who = findById(CLIENTS, state.contract.who), gain = contractReward(state), first = !(state.clients[state.contract.who] > 0);
    earn(state, gain);
    state.lineEarned += gain;
    state.treats = Math.min(1e9, state.treats + CONTRACT_TREATS);
    state.clients[state.contract.who] = Math.min(1e9, (state.clients[state.contract.who] || 0) + 1);
    state.contractsRun = (state.contractsRun || 0) + 1;
    state.contract = null;
    return { ok: true, gain: gain, treats: CONTRACT_TREATS, first: first, who: who ? who.id : '', name: who ? who.name : '' };
  }
  function productValue(state) { return PRODUCT_VALUE * mods(state).z3 * globalMult(state) * contractMult(state); }
  /** 3구역이 초당 버는 물자. */
  function lineRate(state) {
    if (!zoneOpen(state, 2)) return 0;
    var l = lineInfo(state);
    return l.flow * l.milestone * l.bonus * productValue(state);
  }
  /**
   * 병목인 기계를 한 단계씩 times 번 올린다(살 수 있는 만큼만). "어느 걸 올려야 하지"를 대신해 주는 단추다.
   * 돌려주는 값: { ok, bought: 올린 횟수, cost: 쓴 물자 }. 한 번도 못 올리면 실패.
   */
  function tuneLine(state, times) {
    if (!zoneOpen(state, 2)) return fail('locked');
    times = Math.min(2000, Math.max(1, Math.floor(safeNum(times, 1))));
    var bought = 0, spent = 0, last = 'supplies';
    for (var i = 0; i < times; i++) {
      var r = buyMachine(state, lineInfo(state).bottleneck, 1);
      if (!r.ok) { last = r.reason; break; }
      bought++; spent += r.cost;
    }
    return bought ? { ok: true, bought: bought, cost: spent } : fail(last);
  }
  /*
   * 자동화(영구 특성): 전력 투입과 청신호의 대기 시간을 레벨마다 ASSIST_STEP 씩 줄인다(절반까지).
   * 0.9.0 부터 이 특성만으로는 자동이 켜지지 않는다. 자동은 구역마다 개조를 사야 켜진다(autoOn). 줄어든 대기 시간은 직접 누를 때에도 적용된다.
   */
  function assistLevel(state) { return Math.min(ASSIST_MAX, Math.max(0, Math.floor(mods(state).assist))); }
  function assistOn(state) { return assistLevel(state) >= 1; }
  /*
   * 구역의 자동: 그 구역의 개조(AUTO_KEYS)를 사야 켜진다. 영구 특성 '자동화'는 켜 주지 않고 대기 시간만 줄인다.
   *   0 수색조의 자동 수색, 1 자동 판매, 2 전력 투입, 3 청신호. 그 밖의 구역은 늘 false.
   */
  var AUTO_KEYS = ['patrol', 'broker', 'autoline', 'autosig', 'autolab', 'autoguard', 'autotower'];      // 구역 index 순서. 5·6·7구역의 자동은 1.5.1 에서 생겼다
  /**
   * 자동이 대신 해 줄 때 받는 몫(1.5.1). 지금 있는 구역에서는 절반(손으로 하는 쪽이 낫다), 이미 지나온 구역에서는 전부.
   * 다음 구역으로 넘어가면 앞 구역은 자동에 맡기고 새 구역에 손을 쓰라는 뜻이다.
   */
  function autoShare(state, zone) { return state.zone > zone ? 1 : Math.min(1, AUTO_SHARE + mods(state).autoshare); }
  var AUTO_SHARE = 0.5;
  function autoOn(state, zone) { return zone >= 0 && zone < AUTO_KEYS.length && mods(state)[AUTO_KEYS[zone]] > 0; }
  /**
   * 그 구역의 주문·의뢰·사건을 자동에 맡겼는가(1.5.3). 자동 개조가 있어도 구역마다 끌 수 있다(state.autoOff[구역 index]).
   * 손으로 하면 더 받는 것들이라, 지금 붙어서 하는 구역은 끄고 싶을 수 있다. 전력 투입·청신호·순찰조처럼 늘 도는 자동은 이 스위치와 상관없다.
   */
  function autoEvents(state, zone) { return autoOn(state, zone) && !(state.autoOff && state.autoOff[zone]); }
  function setAutoEvents(state, zone, on) {
    zone = Math.floor(zone);
    if (!(zone >= 1 && zone < AUTO_KEYS.length)) return fail('unknown');
    if (on) delete state.autoOff[zone]; else state.autoOff[zone] = true;
    return { ok: true, zone: zone, on: !!on };
  }
  /** 수색조가 한 칸을 뒤지는 데 걸리는 시간(초). 순찰조 레벨마다 0.4초씩 줄어든다(1.4초까지). */
  function sweepInterval(state) { return Math.max(1.4, SWEEP_AUTO_SECONDS - 0.4 * Math.max(0, mods(state).patrol - 1)); }
  /** 대기 시간에 곱하는 값: 0·1레벨 1, 그 뒤로 레벨마다 ASSIST_STEP 씩 줄고 절반 아래로는 내려가지 않는다. */
  function assistFactor(state) { return Math.max(0.5, 1 - ASSIST_STEP * assistLevel(state)); }
  function surgeCooldown(state) { return SURGE_COOLDOWN * assistFactor(state); }
  function greenCooldown(state) { return GREEN_COOLDOWN * assistFactor(state); }
  /**
   * 전력 투입: 라인을 SURGE_SECONDS 초 동안 SURGE_MULT 배로 돌린다. 누른 때부터 SURGE_COOLDOWN 초 뒤에 다시 쓸 수 있다.
   * 늘 챙겨 써도 평균 +17% 정도다: 지켜보는 사람의 작은 덤이고, 안 써도 뒤처지지 않는다. 라인이 서 있으면 쓸 수 없다.
   */
  function surge(state) {
    if (!zoneOpen(state, 2)) return fail('locked');
    if (state.surgeCool > 0) return fail('cooldown');
    if (!(lineInfo(state).flow > 0)) return fail('stopped');
    state.surgeLeft = SURGE_SECONDS; state.surgeCool = surgeCooldown(state);
    return { ok: true, seconds: SURGE_SECONDS };
  }
  /** 지금 이 순간 라인이 초당 버는 물자(전력 투입 포함). 화면 표시용이다. 평균 수입 계산에는 lineRate 를 쓴다. */
  function lineNow(state) { return lineRate(state) * (state.surgeLeft > 0 ? SURGE_MULT : 1) * lineFactor(state); }
  /*
   * 기계 다시 맞추기(1.5.1): 기계 하나만 잔뜩 올려 버리면 가동률이 무너지고, 기계 값은 레벨마다 불어나서 나머지를 따라 올리기가 사실상 불가능했다.
   *   레벨 합계는 그대로 두고 세 기계에 다시 나눈다: 레벨당 처리량이 3·2·1 이므로 2 : 3 : 6 으로 나누면 처리량이 같아진다(가동률 100%).
   *   합계가 그대로라 2배 문턱(별)은 변하지 않는다. 값은 받지 않고, 대신 REBALANCE_SECONDS 동안 라인이 선다. 가동률이 정속 기준 아래일 때만 쓸 수 있다.
   */
  var REBALANCE_SECONDS = 30;
  /*
   * 1.6.1: 레벨 합계가 아니라 "기계에 쓴 물자"를 지킨다.
   *   고친 까닭: 합계를 지키면, 값이 싼 선별기만 사고 다시 맞추기를 되풀이해서 비싼 조립기 레벨을 선별기 값에 얻을 수 있었다.
   *   이제는 지금 기계들을 사는 데 든 물자(machineSpent)로 살 수 있는 가장 높은 "고르게 나눈 레벨"을 찾는다.
   *   그래서 다시 맞춰도 이득이 없다. 한쪽만 올린 실수는 여전히 되돌릴 수 있지만, 싼 기계로 채운 만큼 레벨 합계는 줄어든다.
   */
  function machineSpent(state, lv) {
    var sum = 0; lv = lv || state.machines;
    MACHINES.forEach(function (d) { if (lv[d.id] > 0) sum += seriesCost(machineBase(state, d), GROWTH, 0, lv[d.id]); });
    return sum;
  }
  function rebalancePlan(state) {
    var have = machineLevels(state);
    if (have < 3) return splitLevels(have);
    var budget = machineSpent(state), lo = 3, hi = COUNT_MAX * 3;
    while (lo < hi) {      // 쓴 물자로 살 수 있는 가장 큰 합계를 이분 탐색으로 찾는다
      var mid = Math.ceil((lo + hi) / 2), p = splitLevels(mid);
      var fits = p.sorter <= COUNT_MAX && p.press <= COUNT_MAX && p.assembler <= COUNT_MAX && machineSpent(state, p) <= budget;
      if (fits) lo = mid; else hi = mid - 1;
    }
    return splitLevels(lo);
  }
  /** 레벨 합계 total 을 처리량이 같아지게 세 기계에 나눈다(2 : 3 : 6). */
  function splitLevels(total) {
    var w = { sorter: 2, press: 3, assembler: 6 }, out = {}, used = 0;
    MACHINES.forEach(function (d) { out[d.id] = Math.max(total >= 3 ? 1 : 0, Math.floor(total * w[d.id] / 11)); used += out[d.id]; });
    // 나머지는 그때그때 가장 느린 기계에 하나씩 준다
    for (var left = total - used; left > 0; left--) { var lo = null, lv = Infinity; MACHINES.forEach(function (d) { var c = d.rate * out[d.id]; if (c < lv) { lv = c; lo = d.id; } }); out[lo]++; }
    return out;
  }
  /** 다시 맞추면 돌려받는 물자: 지금 기계에 쓴 값 − 다시 나눈 기계의 값. */
  function rebalanceRefund(state) { return machineLevels(state) < 3 ? 0 : Math.max(0, Math.floor(machineSpent(state) - machineSpent(state, rebalancePlan(state)))); }
  function rebalanceLine(state) {
    if (!zoneOpen(state, 2)) return fail('locked');
    var l = lineInfo(state);
    if (machineLevels(state) < 3) return fail('few');
    if (l.steady) return fail('steady');
    // 1.6.3: 다시 나누고 남는 값은 물자로 돌려준다. 전에는 싼 기계에 쓴 물자가 그냥 사라졌다(선별기 80 → 110 으로 올렸는데 80 으로 돌아가는 식).
    //        돌려주는 것은 가진 물자뿐이고 이번 회차 누적(runEarned)은 늘리지 않는다: 쓴 것을 되받는 것이지 번 것이 아니다.
    var refund = rebalanceRefund(state);
    state.machines = rebalancePlan(state); state.retool = Math.max(state.retool || 0, REBALANCE_SECONDS);
    state.supplies += refund;
    return { ok: true, machines: state.machines, seconds: REBALANCE_SECONDS, refund: refund };
  }
  /** 병목을 한 단계 올리는 값(단추에 보일 값). */
  function tuneCost(state) { return zoneOpen(state, 2) ? machineCost(state, lineInfo(state).bottleneck, 1) : Infinity; }

  /* ---------- 4구역: 노선 ---------- */
  /*
   * 노선을 복구하고 열차를 보낸다. 열차는 운행하는 동안 화물을 싣고, 돌아왔을 때 한꺼번에 물자로 바뀐다.
   *   멀리 가는 노선일수록 같은 시간에 더 많이 싣지만(mult) 돌아오기까지 오래 걸린다.
   *   열차는 배수가 높은 노선부터 알아서 탄다. 노선마다 다닐 수 있는 열차 수(단계 × ROUTE_SLOTS)가 정해져 있다.
   * 그래서 할 일은 "열차를 살까, 노선을 늘릴까, 어느 노선을 늘릴까"다. 물자가 띄엄띄엄 크게 들어오는 것이 앞 구역들과 다르다.
   */
  function fleetMilestone(trains) { var m = 1; FLEET_MILESTONES.forEach(function (t) { if (trains >= t) m *= 2; }); return m; }
  function trainCost(state, qty) {
    if (!zoneOpen(state, 3) || state.trains + qty > TRAIN_MAX) return Infinity;
    var m = mods(state);
    return seriesCost(TRAIN_COST * m.cost * m.traincost, TRAIN_GROWTH, state.trains, qty);
  }
  function maxTrains(state) {
    if (!zoneOpen(state, 3)) return 0;
    var m = mods(state);
    return seriesMax(TRAIN_COST * m.cost * m.traincost, TRAIN_GROWTH, state.trains, state.supplies, TRAIN_MAX);
  }
  function buyTrain(state, qty) {
    qty = Math.floor(qty);
    if (!zoneOpen(state, 3)) return fail('locked');
    if (!(qty >= 1)) return fail('unknown');
    return pay(state, trainCost(state, qty), function () { state.trains += qty; });
  }
  /** 노선을 한 단계 늘리는 값(첫 단계는 복구). */
  function routeCost(state, id) {
    var def = findById(ROUTES, id);
    if (!def || !zoneOpen(state, 3) || state.routes[id] >= ROUTE_MAX) return Infinity;
    var m = mods(state);
    return Math.ceil(def.baseCost * Math.pow(ROUTE_GROWTH, state.routes[id]) * m.cost * m.routecost);
  }
  function buyRoute(state, id) {
    if (!findById(ROUTES, id)) return fail('unknown');
    if (!zoneOpen(state, 3)) return fail('locked');
    return pay(state, routeCost(state, id), function () { state.routes[id]++; });
  }
  /** 노선 하나를 다녀오는 데 걸리는 시간(초, 강화 포함). */
  function tripSeconds(state, id) { var def = findById(ROUTES, id); return def ? def.seconds * mods(state).trip : Infinity; }
  /**
   * 지금의 배차 { riders: { 노선: 열차 수 }, slots: { 노선: 자리 수 }, idle: 탈 노선이 없어 쉬는 열차 수 }.
   * 배수가 높은 노선부터 자리를 채운다.
   */
  function railPlan(state) {
    var left = zoneOpen(state, 3) ? state.trains : 0, riders = {}, slots = {};
    ROUTES.slice().sort(function (a, b) { return b.mult - a.mult; }).forEach(function (d) {
      slots[d.id] = (state.routes[d.id] || 0) * ROUTE_SLOTS;
      riders[d.id] = Math.min(left, slots[d.id]);
      left -= riders[d.id];
    });
    return { riders: riders, slots: slots, idle: left };
  }
  /** 열차 한 대가 운행 1초마다 싣는 화물의 값(노선 배수를 곱하기 전). */
  /*
   * 표류 화물(1.1.2, 4구역): 단골 주문·납품 의뢰와 같은 틀이다.
   *   몇 분마다 선로 어딘가에 멈춰 선 화물칸이 발견된다. 발견된 뒤로 열차가 싣고 돌아온 화물의 값이 차곡차곡 쌓이고(평소 수입은 그대로),
   *   다 차면 "끌어온다"를 눌러 물자(SALVAGE_PAY 배)와 간식을 받는다. 그 화물칸은 도감에 적힌다(철수해도 남는다).
   *   이번 회차에 끌어온 화물 하나마다 화물 값이 SALVAGE_BONUS 씩 오른다(SALVAGE_BONUS_MAX 까지). 놓쳐도 잃는 것은 없다.
   */
  var CARGOS = [
    { id: 'ration',  name: '비상식량 칸',   color: '#b8402e', text: '상자마다 날짜가 적혀 있어요.' },
    { id: 'medic',   name: '의약품 칸',     color: '#e6e5db', text: '붉은 십자가 반쯤 벗겨졌어요.' },
    { id: 'fuel',    name: '연료 탱크차',   color: '#5a5f6a', text: '절반쯤 남아 있었어요.' },
    { id: 'tool',    name: '공구 칸',       color: '#c9a04a', text: '자물쇠가 세 개나 달려 있었어요.' },
    { id: 'seed',    name: '종자 칸',       color: '#5a7a3a', text: '봉투에 손글씨가 있어요.' },
    { id: 'blanket', name: '담요 칸',       color: '#8a5a44', text: '겨울 전에 찾아서 다행이에요.' },
    { id: 'cell',    name: '건전지 칸',     color: '#3f6f8f', text: '무전기가 며칠은 더 버텨요.' },
    { id: 'filter',  name: '정수 필터 칸',  color: '#4f9bd8', text: '정수기 담당이 제일 반겼어요.' },
    { id: 'parts',   name: '무전 부품 칸',  color: '#6a4a8a', text: '안테나가 통째로 들어 있었어요.' },
    { id: 'book',    name: '책 칸',         color: '#6b4a3a', text: '아이들이 먼저 올라갔어요.' },
    { id: 'cycle',   name: '자전거 칸',     color: '#d08a3c', text: '바람만 넣으면 탈 수 있어요.' },
    { id: 'mail',    name: '우편 칸',       color: '#f0b400', text: '부치지 못한 편지가 가득해요.' }
  ];
  var SALVAGE_SECONDS = 150, SALVAGE_NEED_SECONDS = 50, SALVAGE_GAP_MIN = 180, SALVAGE_GAP_MAX = 300, SALVAGE_PAY = 2, SALVAGE_BONUS = 0.01, SALVAGE_BONUS_MAX = 0.5, SALVAGE_TREATS = 2;
  function salvageMult(state) { return 1 + Math.min(SALVAGE_BONUS_MAX, (state.salvagesRun || 0) * SALVAGE_BONUS); }
  function cargoCount(state) { var n = 0; CARGOS.forEach(function (c) { if (state.cargos[c.id] > 0) n++; }); return n; }
  function salvageReward(state) { return state.salvage ? state.salvage.need * SALVAGE_PAY : 0; }
  function stepSalvage(state, dt, rng, events) {
    if (!zoneOpen(state, 3) || !(railRate(state) > 0)) return;
    if (state.salvage) {
      // 자동 신호가 있으면 다 채운 화물을 알아서 거둔다(1.3.1)
      if (autoEvents(state, 3) && state.salvage.have >= state.salvage.need) { var sf = fillSalvage(state); if (sf.ok) { sf.type = 'salvage-filled'; events.push(sf); return; } }
      state.salvage.left -= dt;
      if (state.salvage.left <= 0) { events.push({ type: 'salvage-gone', who: state.salvage.who }); state.salvage = null; }
      return;
    }
    state.salvageIn -= dt;
    if (state.salvageIn > 0) return;
    rng = typeof rng === 'function' ? rng : Math.random;
    var who = CARGOS[Math.floor(rng() * CARGOS.length) % CARGOS.length];
    state.salvage = { who: who.id, need: railRate(state) * SALVAGE_NEED_SECONDS, have: 0, left: SALVAGE_SECONDS };
    state.salvageIn = (SALVAGE_GAP_MIN + rng() * (SALVAGE_GAP_MAX - SALVAGE_GAP_MIN)) * mods(state).salvagegap;
    events.push({ type: 'salvage', who: who.id, name: who.name });
  }
  /** 다 찬 표류 화물을 끌어온다. 덜 찼으면 실패(화물은 남는다). */
  function fillSalvage(state) {
    if (!state.salvage) return fail('none');
    if (!(state.salvage.have >= state.salvage.need)) return fail('short');
    var who = findById(CARGOS, state.salvage.who), gain = salvageReward(state), first = !(state.cargos[state.salvage.who] > 0);
    earn(state, gain);
    state.railEarned += gain;
    state.treats = Math.min(1e9, state.treats + SALVAGE_TREATS);
    state.cargos[state.salvage.who] = Math.min(1e9, (state.cargos[state.salvage.who] || 0) + 1);
    state.salvagesRun = (state.salvagesRun || 0) + 1;
    state.salvage = null;
    return { ok: true, gain: gain, treats: SALVAGE_TREATS, first: first, who: who ? who.id : '', name: who ? who.name : '' };
  }
  function cargoValue(state) { return zoneOpen(state, 3) ? TRAIN_VALUE * fleetMilestone(state.trains) * mods(state).z4 * globalMult(state) * salvageMult(state) * (1 + (state.railBoost || 0)) : 0; }
  /** 4구역이 평균적으로 초당 버는 물자(운행 중인 열차 기준). 실제로는 열차가 돌아올 때 한꺼번에 들어온다. */
  function railRate(state) {
    if (!zoneOpen(state, 3)) return 0;
    var plan = railPlan(state), sum = 0;
    ROUTES.forEach(function (d) { sum += plan.riders[d.id] * d.mult; });
    return sum * cargoValue(state);
  }
  /**
   * 열차를 dt 초 운행한다. 돌아온 노선이 있으면 그동안 실은 화물을 물자로 바꾸고 'train' 사건을 남긴다.
   * 열차 수가 운행 도중에 바뀌어도 실제로 달린 만큼(열차 × 초)만 실린다.
   */
  function stepRail(state, dt, events) {
    if (!zoneOpen(state, 3) || !state.trains) return;
    var plan = railPlan(state), value = cargoValue(state);
    ROUTES.forEach(function (d) {
      var n = plan.riders[d.id];
      if (!n && !(state.routeLoad[d.id] > 0)) return;
      var trip = tripSeconds(state, d.id);
      state.routeLoad[d.id] += n * dt;
      state.routeClock[d.id] += dt;
      if (state.routeClock[d.id] < trip) return;
      // dt 가 길어 여러 번 다녀왔을 수도 있다: 다녀온 횟수만큼의 몫을 내리고, 남은 시간의 몫은 실은 채로 둔다
      var trips = Math.floor(state.routeClock[d.id] / trip), share = trips * trip / state.routeClock[d.id];
      var gain = state.routeLoad[d.id] * share * d.mult * value;
      state.routeLoad[d.id] *= 1 - share;
      state.routeClock[d.id] -= trips * trip;
      earn(state, gain);
      state.railEarned += gain;
      if (state.salvage) state.salvage.have = Math.min(state.salvage.need, state.salvage.have + gain);      // 표류 화물: 돌아온 열차의 화물 값이 쌓인다
      if (d.id === 'express') state.expressRuns += trips;
      events.push({ type: 'train', route: d.id, name: d.name, gain: gain, trips: trips, long: d.seconds >= 900 });
    });
  }

  /* ---------- 5구역: 연구 ---------- */
  /*
   * 연구원이 연구 점수를 모으고, 점수를 써서 과제를 끝낸다. 과제는 이번 판의 다른 구역들을 강하게 만든다.
   *   한 번에 세 과제가 나오고 그중 하나를 고른다. 고르면 세 과제가 모두 새로 바뀐다.
   *   과제를 하나 끝낼 때마다 다음 과제에 드는 점수가 오른다(어느 과제든 같다). 그래서 무엇을 먼저 키울지가 중요하다.
   * 이 구역은 물자를 직접 만들지 않는다. 대신 "이번 판은 어디를 키울까"를 정한다. 판마다 나오는 과제가 달라 고르는 것도 달라진다.
   */
  function staffCost(state, qty) {
    if (!zoneOpen(state, 4) || state.staff + qty > COUNT_MAX) return Infinity;
    var m = mods(state);
    return seriesCost(STAFF_COST * m.cost * m.staffcost, STAFF_GROWTH, state.staff, qty);
  }
  function maxStaff(state) {
    if (!zoneOpen(state, 4)) return 0;
    var m = mods(state);
    return seriesMax(STAFF_COST * m.cost * m.staffcost, STAFF_GROWTH, state.staff, state.supplies, COUNT_MAX);
  }
  function buyStaff(state, qty) {
    qty = Math.floor(qty);
    if (!zoneOpen(state, 4)) return fail('locked');
    if (!(qty >= 1)) return fail('unknown');
    return pay(state, staffCost(state, qty), function () { state.staff += qty; });
  }
  /** 초당 모이는 연구 점수. 연구원 수가 10·25·50…명에 닿을 때마다 2배(시설과 같다). */
  /*
   * 병원 서류(1.1.3, 5구역): 과제를 끝낼 때 RECORD_CHANCE 의 확률로 병원에 남아 있던 서류 한 장을 찾는다.
   *   찾으면 간식을 받고, 그 서류가 도감에 적힌다(철수해도 남는다). 이번 회차에 찾은 한 장마다 연구 속도가 RECORD_BONUS 씩 오른다(RECORD_BONUS_MAX 까지).
   *   다른 구역의 주문·의뢰·화물과 달리 시간 제한이 없다: 이 구역의 할 일은 과제를 고르는 것이고, 서류는 그 덤이다.
   */
  var RECORDS = [
    { id: 'desk',    name: '접수 대장',     color: '#e6d8c0', text: '마지막 줄은 이름 없이 시각만 있어요.' },
    { id: 'temp',    name: '체온 기록지',   color: '#cfe0ea', text: '두 시간마다 빠짐없이 적혀 있어요.' },
    { id: 'duty',    name: '야간 당직표',   color: '#c9a04a', text: '같은 이름이 나흘 연속 적혀 있어요.' },
    { id: 'stock',   name: '약품 수불부',   color: '#e6e5db', text: '나간 것만 있고 들어온 것은 없어요.' },
    { id: 'visit',   name: '면회 명부',     color: '#d8c8a8', text: '어느 날부터 줄이 그어져 있어요.' },
    { id: 'label',   name: '검체 라벨',     color: '#f0b400', text: '번호만 있고 이름이 없어요.' },
    { id: 'menu',    name: '식단표',        color: '#a8c89a', text: '금요일 칸에 동그라미가 쳐져 있어요.' },
    { id: 'beds',    name: '병상 배치도',   color: '#b8c8d8', text: '한 층이 통째로 빗금이에요.' },
    { id: 'handoff', name: '인계장',        color: '#d8d8d0', text: '"다음 근무자에게"로 시작해요.' },
    { id: 'clean',   name: '소독 일지',     color: '#c8d8c8', text: '끝까지 서명이 있어요.' },
    { id: 'call',    name: '호출 기록',     color: '#e0b8a8', text: '같은 호실이 밤새 눌렸어요.' },
    { id: 'leave',   name: '퇴원 서류',     color: '#e8e0c8', text: '도장만 찍히고 비어 있어요.' }
  ];
  var RECORD_CHANCE = 0.35, RECORD_BONUS = 0.01, RECORD_BONUS_MAX = 0.5, RECORD_TREATS = 2;
  function recordMult(state) { return 1 + Math.min(RECORD_BONUS_MAX, (state.recordsRun || 0) * RECORD_BONUS); }
  function recordCount(state) { var n = 0; RECORDS.forEach(function (r) { if (state.records[r.id] > 0) n++; }); return n; }
  /** 과제를 끝낸 뒤 부른다. 서류를 찾았으면 { id, name, first } 를, 못 찾았으면 null 을 돌려준다. */
  function findRecord(state, rng) {
    rng = typeof rng === 'function' ? rng : Math.random;
    if (!(rng() < RECORD_CHANCE + mods(state).recordchance)) return null;
    var who = RECORDS[Math.floor(rng() * RECORDS.length) % RECORDS.length], first = !(state.records[who.id] > 0);
    state.records[who.id] = Math.min(1e9, (state.records[who.id] || 0) + 1);
    state.recordsRun = (state.recordsRun || 0) + 1;
    state.treats = Math.min(1e9, state.treats + RECORD_TREATS);
    return { id: who.id, name: who.name, first: first };
  }
  function researchRate(state) { return zoneOpen(state, 4) ? state.staff * milestoneMult(state.staff) * mods(state).lab * recordMult(state) : 0; }
  /** 지금 과제 하나를 끝내는 데 드는 점수. 어느 과제를 고르든 같다. */
  function projectCost(state) { return Math.ceil(PROJECT_BASE * Math.pow(PROJECT_GROWTH, state.projectsDone) * mods(state).labcost); }
  function rerollCost(state) { return Math.ceil(projectCost(state) * REROLL_SHARE); }
  /** 과제 OFFER_COUNT 개를 겹치지 않게 뽑는다. */
  function drawOffers(rng) {
    var pool = PROJECTS.map(function (p) { return p.id; }), out = [];
    rng = typeof rng === 'function' ? rng : Math.random;
    while (out.length < OFFER_COUNT && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length) % pool.length, 1)[0]);
    return out;
  }
  /**
   * 내민 과제 가운데 하나를 끝낸다. 점수를 치르고 효과를 얻고, 과제 셋을 새로 뽑는다.
   * '보급 요청'은 효과가 남는 대신 물자를 바로 준다.
   */
  function runProject(state, id, rng) {
    var def = findById(PROJECTS, id);
    if (!def) return fail('unknown');
    if (!zoneOpen(state, 4)) return fail('locked');
    if (state.offers.indexOf(id) < 0) return fail('not-offered');
    var cost = projectCost(state);
    if (cost > state.points) return fail('points');
    state.points -= cost;
    var gain = 0;
    if (def.key === 'drop') { gain = Math.max(1, productionPerSec(state) * SUPPLY_DROP_SECONDS); earn(state, gain); }
    state.research[id]++;
    state.projectsDone++;
    state.offers = drawOffers(rng);
    var record = findRecord(state, rng);      // 병원 서류: 과제를 끝낼 때 가끔 한 장을 찾는다
    return { ok: true, id: id, name: def.name, level: state.research[id], cost: cost, gain: gain, record: record };
  }
  /** 점수를 조금 내고 과제 셋을 다시 뽑는다. */
  function rerollOffers(state, rng) {
    if (!zoneOpen(state, 4)) return fail('locked');
    var cost = rerollCost(state);
    if (cost > state.points) return fail('points');
    state.points -= cost;
    state.offers = drawOffers(rng);
    return { ok: true, cost: cost };
  }
  function stepLab(state, dt, rng) {
    if (!zoneOpen(state, 4)) return;
    if (!state.offers.length) state.offers = drawOffers(rng);       // 구역에 처음 들어섰을 때
    // 밤샘 연구 중인 시간만큼은 FOCUS_MULT 배로 모인다(dt 가 길어도 남은 시간까지만)
    var focused = Math.min(dt, Math.max(0, state.focusLeft || 0));
    state.points += researchRate(state) * (dt + (FOCUS_MULT - 1) * focused);
    state.focusLeft = Math.max(0, (state.focusLeft || 0) - dt); state.focusCool = Math.max(0, (state.focusCool || 0) - dt);
  }

  /**
   * 청신호: 달리고 있는 열차들이 GREEN_SECONDS 초만큼 앞서 달린다(그만큼 화물도 싣는다). GREEN_COOLDOWN 초 뒤에 다시 켤 수 있다.
   * 늘 챙겨 켜도 평균 +25% 정도다. 도착 직전의 열차를 당겨 바로 들어오게 하는 손맛이 쓸모다. 달리는 열차가 없으면 켤 수 없다.
   * 돌려주는 값: { ok, arrivals: 이 신호로 도착한 열차의 'train' 사건들 }
   */
  function greenSignal(state) {
    if (!zoneOpen(state, 3)) return fail('locked');
    if (state.greenCool > 0) return fail('cooldown');
    var plan = railPlan(state), running = 0;
    ROUTES.forEach(function (d) { running += plan.riders[d.id]; });
    if (!running) return fail('stopped');
    var events = [];
    stepRail(state, GREEN_SECONDS, events);
    state.greenCool = greenCooldown(state);
    return { ok: true, arrivals: events };
  }

  /* ---------- 동물 친구와 이름 ---------- */
  /** 이름을 다듬는다: 글이 아니거나 비면 fallback, 줄바꿈·꺾쇠 같은 글자는 빼고, PET_NAME_MAX 글자까지. */
  function cleanName(name, fallback) {
    var t = (typeof name === 'string' ? name : '').replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, ' ').replace(/\s+/g, ' ').trim();
    t = Array.from(t).slice(0, PET_NAME_MAX).join('').trim();
    return t || fallback || '';
  }
  function setHeroName(state, name) {
    var clean = cleanName(name, '');
    if (!clean) return fail('empty');
    state.heroName = clean;
    return { ok: true, name: clean };
  }
  function kennelCount(state) { var n = 0; PET_BREEDS.forEach(function (b) { if (state.kennel && state.kennel[b.id]) n++; }); return n; }
  /** 데려오는 데 드는 항체 샘플. 첫 친구는 그냥 온다. 그 뒤로는 지금까지 얻은 항체 총량의 일부를 낸다. */
  function petPullCost(state) {
    if (!kennelCount(state)) return 0;
    return Math.max(PET_PULL_MIN, Math.ceil(state.antibodyTotal * PET_PULL_SHARE));
  }
  /** 0 이상 1 미만의 수로 등급을 고른다(weight 의 비율). */
  function rollRarity(r) {
    var roll = clamp(safeNum(r, 0), 0, 0.999999) * 100, acc = 0;
    for (var i = 0; i < PET_RARITIES.length; i++) { acc += PET_RARITIES[i].weight; if (roll < acc) return PET_RARITIES[i]; }
    return PET_RARITIES[0];
  }
  /**
   * 강아지('dog')나 고양이('cat')를 데려온다. 등급을 먼저 뽑고, 그 등급 안에서 어떤 아이가 올지 뽑는다.
   *   첫 친구는 값이 없다. 그 뒤로는 항체 샘플을 낸다(petPullCost).
   *   새 아이면 일행에 들어오고 바로 데리고 다닌다. 이미 함께 있는 아이가 또 나오면 값의 일부를 돌려받는다.
   * 돌려주는 값: { ok, breed, rarity, dup, cost, refund }
   */
  function adoptPet(state, kind, rng) {
    if (!PET_KINDS[kind]) return fail('unknown');
    var cost = petPullCost(state);
    if (cost > state.antibodies) return fail('antibodies');
    rng = typeof rng === 'function' ? rng : Math.random;
    var rarity = rollRarity(rng());
    var pool = PET_BREEDS.filter(function (b) { return b.kind === kind && b.rarity === rarity.id; });
    var breed = pool[Math.min(pool.length - 1, Math.max(0, Math.floor(safeNum(rng(), 0) * pool.length)))];
    var dup = !!state.kennel[breed.id], refund = dup ? Math.floor(cost * PET_DUP_REFUND) : 0;
    state.antibodies -= cost - refund;
    if (!dup) { state.kennel[breed.id] = breed.name; state.pet = { kind: kind, breed: breed.id, name: breed.name }; }
    return { ok: true, breed: breed, rarity: rarity, dup: dup, cost: cost, refund: refund };
  }
  /** 함께 있는 친구 가운데 누구를 데리고 다닐지 고른다. */
  function choosePet(state, breedId) {
    var breed = findById(PET_BREEDS, breedId);
    if (!breed || !state.kennel[breedId]) return fail('unknown');
    state.pet = { kind: breed.kind, breed: breed.id, name: state.kennel[breedId] };
    return { ok: true, breed: breed };
  }
  function renamePet(state, name) {
    if (!state.pet) return fail('none');
    var clean = cleanName(name, '');
    if (!clean) return fail('empty');
    state.pet.name = clean; state.kennel[state.pet.breed] = clean;
    return { ok: true, name: clean };
  }
  /*
   * 친구 키우기: 간식을 주면 그 친구의 레벨이 오르고 효과가 커진다.
   *   간식은 물자·항체와 다른 재화다. 밤을 막을 때마다 TREAT_NIGHT 개(변이체는 TREAT_BOSS 개)를 얻고, 구조 신호의 보상으로도 가끔 나온다.
   *   레벨마다 효과가 PET_LEVEL_STEP(20%)씩 커진다(기본 효과에 곱한다). 값은 PET_FEED_BASE 에서 시작해 레벨마다 PET_FEED_GROWTH 배.
   *   레벨은 친구마다 따로이고, 간식과 레벨은 철수해도 남는다.
   */
  var TREAT_NIGHT = 1, TREAT_BOSS = 5, PET_LEVEL_MAX = 10, PET_LEVEL_STEP = 0.2, PET_FEED_BASE = 5, PET_FEED_GROWTH = 1.6;
  function petLevel(state, breedId) { var n = state.petLv && state.petLv[breedId]; return typeof n === 'number' && n > 0 ? Math.min(PET_LEVEL_MAX, Math.floor(n)) : 0; }
  function petLevelMult(state, breedId) { return 1 + PET_LEVEL_STEP * petLevel(state, breedId); }
  /** 지금 데리고 다니는 친구에게 간식을 주는 값. 친구가 없거나 최대 레벨이면 Infinity. */
  function petFeedCost(state) {
    if (!state.pet) return Infinity;
    var lv = petLevel(state, state.pet.breed);
    return lv >= PET_LEVEL_MAX ? Infinity : Math.ceil(PET_FEED_BASE * Math.pow(PET_FEED_GROWTH, lv));
  }
  function feedPet(state) {
    if (!state.pet) return fail('nopet');
    var cost = petFeedCost(state);
    if (!isFinite(cost)) return fail('max');
    if (!(state.treats >= cost)) return fail('treats');
    state.treats -= cost;
    state.petLv[state.pet.breed] = petLevel(state, state.pet.breed) + 1;
    return { ok: true, level: state.petLv[state.pet.breed], cost: cost };
  }
  /** 지금 데리고 다니는 친구의 효과 { key: 배수 항목, bonus: 올려 주는 비율 }. 없으면 null. */
  function petEffect(state) {
    if (!state.pet) return null;
    var breed = findById(PET_BREEDS, state.pet.breed), kind = PET_KINDS[state.pet.kind];
    if (!breed || !kind) return null;
    var rarity = findById(PET_RARITIES, breed.rarity) || PET_RARITIES[0];
    return { key: kind.key, bonus: rarity[breed.kind] * petLevelMult(state, breed.id) };
  }
  function breedDesc(breed) {
    var kind = PET_KINDS[breed.kind], rarity = findById(PET_RARITIES, breed.rarity) || PET_RARITIES[0];
    return kind.what + ' · ' + kind.label + ' +' + Math.round(rarity[breed.kind] * 100) + '%';
  }
  /** 지금 친구의 효과를 레벨까지 반영해 글로. 친구가 없으면 빈 글. */
  function petEffectText(state) {
    var e = petEffect(state), kind = state.pet ? PET_KINDS[state.pet.kind] : null;
    return e && kind ? kind.label + ' +' + Math.round(e.bonus * 100) + '%' : '';
  }
  /** 지금 친구의 정보 { kind, kindName, breed(생김새), rarity, name, desc }. 없으면 null. */
  function petInfo(state) {
    if (!state.pet) return null;
    var breed = findById(PET_BREEDS, state.pet.breed), kind = PET_KINDS[state.pet.kind];
    if (!breed || !kind) return null;
    return { kind: state.pet.kind, kindName: kind.name, breed: breed, rarity: findById(PET_RARITIES, breed.rarity) || PET_RARITIES[0], name: state.pet.name, desc: breedDesc(breed) };
  }

  /* ---------- 구역 강화 ---------- */
  /*
   * 개조의 숙련 상한(1.5.1): 철수와 영구 특성이 적으면 개조를 끝까지 올리기 어렵다. 철수를 해야 할 이유가 하나 더 생긴다.
   *   경험 = 철수 횟수 + (영구 특성 레벨 합계 ÷ 5, 버림).
   *   숙련 상한 = 최대 레벨 × (CAP_BASE + CAP_PER × 경험), 올림. 경험 10 이면 전부 풀린다. 한 번만 사는 개조(자동 등)는 그대로다.
   *   상한을 넘겨서도 살 수는 있다(막아 버리지는 않는다). 다만 넘긴 레벨마다 값이 CAP_OVER 배씩 더 붙는다.
   */
  var CAP_BASE = 0.5, CAP_PER = 0.05, CAP_OVER = 20;
  function experience(state) { var lv = 0; TRAITS.forEach(function (t) { lv += state.traits[t.id] || 0; }); return (state.retreats || 0) + Math.floor(lv / 5); }
  function upgradeSoftCap(state, id) {
    var def = findById(UPGRADES, id);
    if (!def) return 0;
    if (def.max <= 1) return def.max;
    return Math.min(def.max, Math.ceil(def.max * Math.min(1, CAP_BASE + CAP_PER * experience(state))));
  }
  function upgradeCost(state, id) {
    var def = findById(UPGRADES, id);
    if (!def || !zoneOpen(state, def.zone) || state.upgrades[id] >= def.max) return Infinity;
    var over = Math.max(0, state.upgrades[id] + 1 - upgradeSoftCap(state, id));
    return Math.ceil(def.baseCost * Math.pow(def.growth, state.upgrades[id]) * mods(state).cost * Math.pow(CAP_OVER, over));
  }
  function buyUpgrade(state, id) {
    var def = findById(UPGRADES, id);
    if (!def) return fail('unknown');
    if (!zoneOpen(state, def.zone)) return fail('locked');
    if (challengeOn(state, 'frugal') || (challengeOn(state, 'hands') && AUTO_KEYS.indexOf(def.key) >= 0)) return fail('challenge');      // 도전: 개조 금지 / 자동 개조 금지
    return pay(state, upgradeCost(state, id), function () {
      state.upgrades[id]++;
      if (def.key === 'floor' || def.key === 'ceil') { var r = priceRange(state); state.price = clamp(state.price, r.floor, r.ceil); }
    });
  }

  /* ---------- 생산 합계와 직접 수색 ---------- */
  /** 가만히 둘 때의 초당 생산(1구역 시설 + 2구역 평균 판매 + 3구역 라인 + 4구역 열차의 평균). */
  /*
   * 6구역 강변 검문소(방어전): 초소를 세워 다리를 지킨다. 다리가 안전할수록 건너오는 사람이 많아 통행 물자가 는다.
   *   통행 물자 = 초소 수 × 2배 문턱 배수 × GUARD_VALUE × 개조 × 전체 배수 × 다리 안전도
   *   다리 안전도 = 방어력 ÷ 오늘 밤 무리 규모. SAFETY_MIN 아래로는 안 내려가고, SAFETY_MAX(+탐조등)까지만 쳐 준다.
   *   그래서 이 구역에서는 방벽을 무리보다 넉넉하게 올려 두는 것이 곧 벌이다(방어전).
   */
  var POST_COST = 5e25, POST_GROWTH = 1.13, GUARD_VALUE = 7e20, POST_DEFENSE = 0.25, SAFETY_MIN = 0.5, SAFETY_MAX = 3, SAFE_NIGHT = 2;
  function bridgeSafety(state) {
    var str = nightStrength(state), ratio = str > 0 ? defensePower(state) / str : SAFETY_MAX;
    return clamp(ratio, SAFETY_MIN, SAFETY_MAX + mods(state).margin);
  }
  function postCost(state, qty) {
    if (!zoneOpen(state, 5) || state.posts + qty > COUNT_MAX) return Infinity;
    return seriesCost(POST_COST * mods(state).cost, POST_GROWTH, state.posts, qty);
  }
  function maxPosts(state) { return zoneOpen(state, 5) ? seriesMax(POST_COST * mods(state).cost, POST_GROWTH, state.posts, state.supplies, COUNT_MAX) : 0; }
  function buyPost(state, qty) {
    qty = Math.floor(qty);
    if (!zoneOpen(state, 5)) return fail('locked');
    if (!(qty >= 1)) return fail('unknown');
    return pay(state, postCost(state, qty), function () { state.posts += qty; });
  }
  /*
   * 통행인(1.2.1, 6구역): 무리의 SAFE_NIGHT 배가 넘는 방어력으로 밤을 막으면 PASSER_CHANCE 의 확률로 누군가 다리를 건넌다.
   *   건너면 간식을 받고, 그 사람이 도감에 적힌다(철수해도 남는다). 이번 회차에 건넌 한 사람마다 통행 물자가 PASSER_BONUS 씩 오른다(PASSER_BONUS_MAX 까지).
   *   이 구역의 할 일은 "넉넉하게 막는 것"이므로, 통행인도 넉넉하게 막은 밤에만 온다. 초소가 하나도 없으면 오지 않는다.
   */
  var PASSERS = [
    { id: 'porter',  name: '짐꾼',           color: '#8a6a3a', text: '제 몸만 한 배낭을 메고 건넜어요.' },
    { id: 'cyclist', name: '자전거 탄 사람', color: '#3a7a8a', text: '바퀴에 바람이 없는데도 타고 갔어요.' },
    { id: 'sisters', name: '자매',           color: '#c85a7a', text: '손을 한 번도 놓지 않았어요.' },
    { id: 'guardm',  name: '경비원',         color: '#3a4a6a', text: '차단기 앞에서 경례를 하고 갔어요.' },
    { id: 'cook',    name: '급식 조리사',    color: '#e6e5db', text: '국자를 허리에 차고 있었어요.' },
    { id: 'oldman',  name: '지팡이 짚은 노인', color: '#7a7a6a', text: '쉬었다 가라니까 고개를 저었어요.' },
    { id: 'mail',    name: '집배원',         color: '#c8482a', text: '가방에 아직 편지가 들어 있었어요.' },
    { id: 'busker',  name: '기타 멘 사람',   color: '#5a3a7a', text: '다리 위에서는 한 줄도 튕기지 않았어요.' },
    { id: 'welder',  name: '용접공',         color: '#4a5a3a', text: '차단기 경첩을 고쳐 주고 갔어요.' },
    { id: 'teacher', name: '선생님',         color: '#3a6a4a', text: '출석부를 품에 안고 있었어요.' },
    { id: 'angler',  name: '낚시꾼',         color: '#6a8a3a', text: '강을 한참 내려다보다 건넜어요.' },
    { id: 'runner',  name: '맨발의 아이',    color: '#f0b400', text: '뒤도 안 돌아보고 뛰어서 건넜어요.' }
  ];
  var PASSER_CHANCE = 0.5, PASSER_BONUS = 0.01, PASSER_BONUS_MAX = 0.5, PASSER_TREATS = 2;
  function passerMult(state) { return 1 + Math.min(PASSER_BONUS_MAX, (state.passersRun || 0) * PASSER_BONUS); }
  function passerCount(state) { var n = 0; PASSERS.forEach(function (r) { if (state.passers[r.id] > 0) n++; }); return n; }
  /** 넉넉하게 막은 밤 뒤에 부른다. 누가 건넜으면 { id, name, first } 를, 아니면 null 을 돌려준다. */
  function passBridge(state, rng) {
    rng = typeof rng === 'function' ? rng : Math.random;
    if (!zoneOpen(state, 5) || !(state.posts > 0)) return null;
    if (!(rng() < PASSER_CHANCE + mods(state).passerchance)) return null;
    var who = PASSERS[Math.floor(rng() * PASSERS.length) % PASSERS.length], first = !(state.passers[who.id] > 0);
    state.passers[who.id] = Math.min(1e9, (state.passers[who.id] || 0) + 1);
    state.passersRun = (state.passersRun || 0) + 1;
    state.treats = Math.min(1e9, state.treats + PASSER_TREATS);
    return { id: who.id, name: who.name, first: first };
  }
  function guardRate(state) {
    if (!zoneOpen(state, 5) || !(state.posts > 0)) return 0;
    return state.posts * milestoneMult(state.posts) * GUARD_VALUE * mods(state).z6 * globalMult(state) * bridgeSafety(state) * passerMult(state) * (1 + (state.guardBoost || 0));
  }
  /**
   * 5구역 약품(1.5.9): 연구원이 연구하는 틈에 약품을 만들어 물자로 바꾼다.
   *   약품 물자 = 연구원 수 × 2배 문턱 배수 × LAB_VALUE × 연구 개조 × 전체 배수
   * 넣은 까닭: 5구역만 직접 버는 것이 없어서, 6구역 문 값을 앞 구역 수입으로만 채워야 했다.
   * 그래서 철수의 3분의 1에서 절반이 5구역에서 나왔다. 연구원을 뽑는 일이 곧 수입이 되게 해서 다른 구역과 같은 흐름으로 맞췄다.
   */
  function labRate(state) {
    if (!zoneOpen(state, 4) || !(state.staff > 0)) return 0;
    return state.staff * milestoneMult(state.staff) * LAB_VALUE * mods(state).lab * globalMult(state);
  }
  function productionPerSec(state) { return searchRate(state) + tradeRate(state) + lineRate(state) + railRate(state) + labRate(state) + guardRate(state); }
  /** 직접 수색의 실제 배수: 수색 배수가 두 배가 될 때마다 1씩 는다(누르기가 방치를 압도하지 않게). */
  function clickPower(state) { return 1 + Math.log(Math.max(1, mods(state).click)) / Math.LN2; }
  function clickValue(state) { return (globalMult(state) + productionPerSec(state) * CLICK_SHARE) * clickPower(state) * (stageRule(state, 'tap5') ? TAP5 : 1); }
  /*
   * 수색 지도: 직접 수색은 동네의 한 칸을 뒤지는 일이다. 칸마다 종류(빈집·가게·은닉처)가 있어 수익이 다르고,
   * 스무 칸을 다 뒤지면 보너스를 받고 다음 동네로 넘어간다. 시설이 있으면 몇 초마다 한 칸씩 알아서 뒤진다(자동 수색은 칸 수익 없이 진행만 시킨다).
   * 칸의 배치는 동네 번호(sweepSeed)로 정해지므로 저장했다 불러와도 같은 동네가 나온다.
   */
  var CACHE_EXTRA_MAX = 40;      // 개조로 더할 수 있는 은닉처 확률의 상한(%p)
  /** 은닉처가 나올 확률에 개조(소문)로 더해지는 값(%p). */
  function cacheExtra(state) { return Math.min(CACHE_EXTRA_MAX, mods(state).rumor); }
  /** 동네 seed 의 index 번째 칸의 종류. 같은 입력에는 언제나 같은 답을 준다. */
  function tileKind(seed, index, extraCache) {
    // 두 수를 섞어 고르게 흩는다(murmur3 의 마무리 섞기). 단순히 곱해서 더하면 종류가 한쪽으로 쏠린다.
    var h = (Math.imul((seed | 0) + 1, 0x9E3779B1) + Math.imul((index | 0) + 1, 0x85EBCA6B)) | 0;
    h ^= h >>> 16; h = Math.imul(h, 0x85EBCA6B); h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35); h ^= h >>> 16;
    var roll = (h >>> 0) % 100, acc = 0;
    // 은닉처가 늘어난 만큼(extraCache, %p) 은닉처의 몫을 키우고, 나머지 종류는 원래 비율대로 줄인다. 0 이면 원래 배치 그대로다
    var extra = typeof extraCache === 'number' && extraCache > 0 ? Math.min(CACHE_EXTRA_MAX, extraCache) : 0;
    var cache = TILE_KINDS[TILE_KINDS.length - 1], rest = 100 - cache.weight;
    if (roll >= 100 - cache.weight - extra) return cache;
    for (var i = 0; i < TILE_KINDS.length - 1; i++) { acc += TILE_KINDS[i].weight * (rest - extra) / rest; if (roll < acc) return TILE_KINDS[i]; }
    return TILE_KINDS[TILE_KINDS.length - 2];
  }
  function tileSearched(state, index) { return index >= 0 && index < SWEEP_TILES && (state.sweepMask & (1 << index)) !== 0; }
  function sweepCount(state) { var n = 0; for (var i = 0; i < SWEEP_TILES; i++) if (state.sweepMask & (1 << i)) n++; return n; }
  /** 아직 뒤지지 않은 칸 가운데 맨 앞의 것. 없으면 -1. */
  function nextTile(state) { for (var i = 0; i < SWEEP_TILES; i++) if (!(state.sweepMask & (1 << i))) return i; return -1; }
  function sweepBonus(state) { return clickValue(state) * SWEEP_BONUS_CLICKS; }
  /**
   * 순찰조(자동 수색)가 벌어 오는 초당 물자: 동네 하나의 보너스 ÷ (스무 칸 × 한 칸에 걸리는 시간).
   * 순찰조가 빨라지면(개조) 그만큼 커진다. 자동 수색이 꺼져 있으면 0.
   */
  function sweepRate(state) { return autoOn(state, 0) ? sweepBonus(state) / (SWEEP_TILES * sweepInterval(state)) : 0; }
  /** 화면에 보여 주는 초당 물자: 시설·거래·라인·열차에 순찰조의 몫을 더한 것. (직접 수색 값은 productionPerSec 만 본다 — 서로 물고 돌지 않게) */
  function incomePerSec(state) { return productionPerSec(state) + sweepRate(state); }
  /** 칸 하나를 뒤진 것으로 표시한다. 동네를 다 뒤졌으면 보너스를 주고 다음 동네로 넘긴다. 돌려주는 값: 보너스(없으면 0). */
  function markTile(state, index) {
    state.sweepMask |= 1 << index;
    if (sweepCount(state) < SWEEP_TILES) return 0;
    var bonus = sweepBonus(state);
    earn(state, bonus);
    state.sweeps++;
    state.sweepMask = 0;
    state.sweepSeed = state.sweepSeed % 999999 + 1;
    return bonus;
  }
  /**
   * 직접 수색. index 를 주면 그 칸을 뒤지고(이미 뒤진 칸이거나 잘못된 번호면 다음 칸), 주지 않으면 다음 칸을 뒤진다.
   * 돌려주는 값: { ok, gain 칸에서 얻은 물자, tile 뒤진 칸, kind 칸의 종류, swept 동네를 다 뒤졌는가, bonus 그 보너스 }
   */
  function scavenge(state, index) {
    var i = typeof index === 'number' && index === Math.floor(index) && index >= 0 && index < SWEEP_TILES && !tileSearched(state, index) ? index : nextTile(state);
    var kind = tileKind(state.sweepSeed, i, cacheExtra(state)), g = clickValue(state) * kind.mult;
    earn(state, g);
    state.clicks++;
    var bonus = markTile(state, i);
    return { ok: true, gain: g, tile: i, kind: kind.id, swept: bonus > 0, bonus: bonus };
  }
  /** 수색조가 dt 초 동안 알아서 뒤진다. 동네를 다 뒤질 때마다 'sweep' 사건을 남긴다. */
  function stepSweep(state, dt, events) {
    if (!autoOn(state, 0)) return;                 // 순찰조(1구역 개조)나 자동화 특성이 있어야 알아서 뒤진다
    state.sweepClock += dt;
    var guard = 0, every = sweepInterval(state);
    while (state.sweepClock >= every && guard++ < SWEEP_TILES * 3) {
      state.sweepClock -= every;
      var bonus = markTile(state, nextTile(state));
      if (bonus > 0) events.push({ type: 'sweep', bonus: bonus, auto: true });
    }
    if (state.sweepClock > SWEEP_AUTO_SECONDS) state.sweepClock = 0;      // 아주 긴 dt: 남은 시간은 버린다(자리 비움은 따로 계산한다)
  }

  /*
   * 회차마다 달라지는 목표(1.4.2). 구역의 목표 셋은 자리(첫째·둘째·셋째)마다 후보가 둘씩 있다: GOALS 의 원래 것과 GOALS_ALT 의 다른 것.
   *   첫 회차는 원래 것 셋이다(처음 하는 사람이 보는 길은 그대로다). 철수할 때마다 자리별로 다시 뽑고, 바로 앞 회차와 셋이 모두 같지는 않게 한다.
   *   자리마다 후보가 다르므로 한 회차 안에서 같은 목표가 겹치는 일은 없다.
   *   다른 후보는 "돈과 시간으로 반드시 채울 수 있는 것"만 넣었다(무리와의 경주에 묶인 것은 넣지 않는다). null 인 자리는 바뀌지 않는다.
   *   7구역은 바꾸지 않는다: 마지막 장의 목표는 이야기의 끝과 묶여 있다.
   *   state.goalPick = { 구역 index: [0|1, 0|1, 0|1] }. 없으면 원래 것.
   */
  function defenseCount(s) { var n = 0; DEFENSES.forEach(function (d) { n += s.defenses[d.id] || 0; }); return n; }
  function routeLevels(s) { var n = 0; ROUTES.forEach(function (r) { n += s.routes[r.id] || 0; }); return n; }
  var GOALS_ALT = [
    [ { id: 'z1a2', text: '옥상 텃밭 40곳', need: 40, value: function (s) { return s.buildings.garden; } },
      { id: 'z1b2', text: '방어 수단 합계 50개', need: 50, value: function (s) { return defenseCount(s); } },
      { id: 'z1c2', text: '1구역 개조를 모두 합쳐 12번', need: 12, value: function (s) { return zoneUpgrades(s, 0); } } ],
    [ { id: 'z2a2', text: '시장 일손 합계 12명', need: 12, value: function (s) { return (s.hands.porter || 0) + (s.hands.crier || 0); } },
      { id: 'z2b2', text: '단골 주문 3번 채우기', need: 3, value: function (s) { return s.ordersRun; } },
      { id: 'z2c2', text: '2구역 개조를 모두 합쳐 15번', need: 15, value: function (s) { return zoneUpgrades(s, 1); } } ],
    [ { id: 'z3a2', text: '3구역 개조를 모두 합쳐 12번', need: 12, value: function (s) { return zoneUpgrades(s, 2); } },
      { id: 'z3b2', text: '출하 트럭 4번 싣기', need: 4, value: function (s) { return s.trucksRun; } },
      { id: 'z3c2', text: '납품 의뢰 3번 채우기', need: 3, value: function (s) { return s.contractsRun; } } ],
    [ { id: 'z4a2', text: '노선 단계 합계 10', need: 10, value: function (s) { return routeLevels(s); } },
      { id: 'z4b2', text: '표류 화물 2번 끌어오기', need: 2, value: function (s) { return s.salvagesRun; } },
      { id: 'z4c2', text: '4구역 개조를 모두 합쳐 10번', need: 10, value: function (s) { return zoneUpgrades(s, 3); } } ],
    [ { id: 'z5a2', text: '5구역 개조를 모두 합쳐 10번', need: 10, value: function (s) { return zoneUpgrades(s, 4); } },
      { id: 'z5b2', text: '병원 서류 3장 찾기', need: 3, value: function (s) { return s.recordsRun; } },
      { id: 'z5c2', text: '방어 교범 2번 끝내기', need: 2, value: function (s) { return s.research.drill; } } ],
    [ { id: 'z6a2', text: '방어 수단 합계 200개', need: 200, value: function (s) { return defenseCount(s); } },
      { id: 'z6b2', text: '검문대 7단계', need: 7, value: function (s) { return s.upgrades.booth || 0; } },
      null ],
    [ null, null, null ]
  ];
  /** 이번 회차에 그 구역에서 채울 목표 셋(정의). */
  function activeGoals(state, index) {
    var base = GOALS[index] || [], alt = GOALS_ALT[index] || [], pick = (state.goalPick && state.goalPick[index]) || [];
    // 도전 '맨몸'(개조 금지) 중에는 "개조를 N번" 목표가 뽑혀 있어도 원래 목표로 돌린다: 그대로 두면 채울 방법이 없어 도전이 막힌다(1.7.2)
    var noUps = challengeOn(state, 'frugal');
    return base.map(function (g, k) { return pick[k] && alt[k] && !(noUps && /개조/.test(alt[k].text)) ? alt[k] : g; });
  }
  /** 다음 회차의 목표를 뽑는다. 바로 앞 회차(prev)와 셋이 모두 같은 구역이 없게 한다. */
  function rollGoalPick(prev, rng) {
    rng = typeof rng === 'function' ? rng : Math.random;
    var out = {};
    GOALS_ALT.forEach(function (alt, zi) {
      var slots = []; alt.forEach(function (g, k) { if (g) slots.push(k); });
      if (!slots.length) return;
      var before = (prev && prev[zi]) || [0, 0, 0], now = [0, 0, 0];
      slots.forEach(function (k) { now[k] = rng() < 0.5 ? 1 : 0; });
      if (now.join() === [before[0] ? 1 : 0, before[1] ? 1 : 0, before[2] ? 1 : 0].join()) { var flip = slots[Math.floor(rng() * slots.length) % slots.length]; now[flip] = now[flip] ? 0 : 1; }
      out[zi] = now;
    });
    return out;
  }

  /*
   * 4·5·6·7구역에서 손으로 할 일(1.5.0). 3구역(고장·트럭·품목)과 같은 생각이다: 내버려 둬도 잃는 것은 없고, 누르면 더 번다.
   *
   * 구역 사건(ZONE_EVENTS): ZEV_GAP 마다 하나가 떠서 ZEV_WAIT 초 기다린다. 접속해 있을 때만 일어난다.
   *   4구역 특별 화물  고르기: '바로 받는다'(화물 수입 ZEV_NOW 초분) / '단골 화주로 삼는다'(이번 회차 화물 값 +ZEV_BOOST, ZEV_BOOST_MAX 까지)
   *   6구역 행렬       고르기: '통과시킨다'(통행 물자 ZEV_NOW 초분) / '쉬어 가게 한다'(이번 회차 통행 물자 +ZEV_BOOST, ZEV_BOOST_MAX 까지)
   *   7구역 무전       응답하면 생존자가 ZEV_NOW 초분(적어도 ZEV_MIN_PEOPLE 명) 한꺼번에 온다
   *   자동 신호(4구역 개조)가 있으면 특별 화물은 알아서 '바로 받는다'로 처리하되 절반만 받는다. 6·7구역은 자동이 없다.
   * 5구역 밤샘 연구: 누르면 FOCUS_SECONDS 동안 연구 속도가 FOCUS_MULT 배, 그 뒤 FOCUS_COOL 초 쉰다(3구역 전력 투입, 4구역 청신호와 같은 틀).
   *
   * state.zev = { rail|guard|tower: { left } | null }, state.zevIn = { rail, guard, tower }(다음 사건까지 초),
   * state.railBoost / guardBoost: 이번 회차에 쌓은 배수(0 ~ ZEV_BOOST_MAX), state.zevRun: 이번 회차에 처리한 사건 수.
   */
  var ZONE_EVENTS = [
    { id: 'rail',  zone: 3, name: '특별 화물', choices: ['now', 'boost'] },
    { id: 'guard', zone: 5, name: '행렬',      choices: ['now', 'boost'] },
    { id: 'tower', zone: 6, name: '무전',      choices: ['now'] }
  ];
  // 1.5.1: 사건 사이가 너무 길다는 말에 간격을 절반 가까이 줄였다(90~150초 → 50~90초). 자주 오는 만큼 한 번에 받는 양은 줄였다(45초분 → 30초분)
  var ZEV_GAP_MIN = 50, ZEV_GAP_MAX = 90, ZEV_WAIT = 30, ZEV_NOW = 30, ZEV_BOOST = 0.03, ZEV_BOOST_MAX = 0.3, ZEV_AUTO = 0.5, ZEV_MIN_PEOPLE = 50;
  var FOCUS_SECONDS = 15, FOCUS_MULT = 2, FOCUS_COOL = 60;      // 1.5.1: 20초/2분 → 15초/1분
  /*
   * 6구역 순찰, 7구역 직접 방송(1.5.1): 5구역 밤샘 연구와 같은 틀의 단추다. 누르면 PUSH_SECONDS 동안 그 구역이 PUSH_MULT 배, 그 뒤 PUSH_COOL 초 쉰다.
   *   state.push = { guard: { left, cool }, tower: { left, cool } }
   */
  var PUSH_SECONDS = 15, PUSH_MULT = 2, PUSH_COOL = 60;
  var PUSHES = [ { id: 'guard', zone: 5, name: '순찰' }, { id: 'tower', zone: 6, name: '직접 방송' } ];
  function pushZone(state, id) {
    var def = findById(PUSHES, id);
    if (!def) return fail('unknown');
    if (!zoneOpen(state, def.zone)) return fail('locked');
    var p = state.push[id];
    if (p.cool > 0) return fail('cooldown');
    if (!(zevFlow(state, id) > 0)) return fail('stopped');
    p.left = PUSH_SECONDS; p.cool = PUSH_COOL;
    return { ok: true, id: id, seconds: PUSH_SECONDS };
  }
  /** dt 초 가운데 그 단추의 효과가 살아 있는 시간만큼 더해 줄 배수(1 이상). 시간도 함께 흘린다. */
  function pushFactor(state, id, dt) {
    var p = state.push[id], on = Math.min(dt, Math.max(0, p.left));
    p.left = Math.max(0, p.left - dt); p.cool = Math.max(0, p.cool - dt);
    return dt > 0 ? 1 + (PUSH_MULT - 1) * on / dt : 1;
  }
  function zevFlow(state, id) { return id === 'rail' ? railRate(state) : id === 'guard' ? guardRate(state) : id === 'tower' ? survivorRate(state) : 0; }
  /** 그 사건을 '바로 받는다'로 처리하면 받는 양(물자, 7구역은 사람 수). */
  function zevReward(state, id, auto) {
    var zdef = findById(ZONE_EVENTS, id), v = zevFlow(state, id) * ZEV_NOW * (auto && zdef ? autoShare(state, zdef.zone) : 1);
    return id === 'tower' ? Math.max(ZEV_MIN_PEOPLE, Math.floor(v)) : v;
  }
  /** 떠 있는 구역 사건에 답한다. choice: 'now' | 'boost'. */
  function answerZoneEvent(state, id, choice, auto) {
    var def = findById(ZONE_EVENTS, id);
    if (!def || !state.zev || !state.zev[id]) return fail('none');
    if (def.choices.indexOf(choice) < 0) return fail('unknown');
    var out = { ok: true, id: id, choice: choice, auto: !!auto, gain: 0, people: 0, boost: 0 };
    if (choice === 'boost') {
      var key = id === 'rail' ? 'railBoost' : 'guardBoost';
      if ((state[key] || 0) >= ZEV_BOOST_MAX - 1e-9) return fail('max');
      state[key] = Math.min(ZEV_BOOST_MAX, (state[key] || 0) + ZEV_BOOST); out.boost = state[key];
    } else if (id === 'tower') {
      out.people = zevReward(state, id, auto); state.survivors = Math.min(1e15, (state.survivors || 0) + out.people);
    } else {
      out.gain = zevReward(state, id, auto); earn(state, out.gain);
      if (id === 'rail') state.railEarned += out.gain; else state.guardEarned += out.gain;
    }
    state.zev[id] = null; state.zevRun = (state.zevRun || 0) + 1;
    return out;
  }
  function stepZoneEvents(state, dt, rng, events) {
    rng = typeof rng === 'function' ? rng : Math.random;
    ZONE_EVENTS.forEach(function (def) {
      if (!zoneOpen(state, def.zone) || !(zevFlow(state, def.id) > 0)) return;
      var ev = state.zev[def.id];
      if (ev) {
        ev.left -= dt;
        if (autoEvents(state, def.zone) && ev.left <= ZEV_WAIT - 3) { var r = answerZoneEvent(state, def.id, 'now', true); if (r.ok) { r.type = 'zev-auto'; events.push(r); } }
        else if (ev.left <= 0) { state.zev[def.id] = null; events.push({ type: 'zev-gone', id: def.id }); }
        return;
      }
      state.zevIn[def.id] -= dt;
      if (state.zevIn[def.id] > 0) return;
      state.zev[def.id] = { left: ZEV_WAIT };
      state.zevIn[def.id] = ZEV_GAP_MIN + rng() * (ZEV_GAP_MAX - ZEV_GAP_MIN);
      events.push({ type: 'zev', id: def.id, name: def.name });
    });
  }
  /** 5구역 밤샘 연구: 잠깐 연구 속도를 올린다. */
  function focusLab(state) {
    if (!zoneOpen(state, 4)) return fail('locked');
    if (state.focusCool > 0) return fail('cooldown');
    if (!(researchRate(state) > 0)) return fail('stopped');
    state.focusLeft = FOCUS_SECONDS; state.focusCool = FOCUS_COOL;
    return { ok: true, seconds: FOCUS_SECONDS };
  }
  /** 지금 이 순간의 연구 속도(밤샘 연구 포함). 화면 표시용. */
  function researchNow(state) { return researchRate(state) * (state.focusLeft > 0 ? FOCUS_MULT : 1); }

  /* ---------- 구역 목표와 다음 구역 ---------- */
  /** 구역 index 의 목표 진행 [{ id, text, value, need, done }]. 아직 없는 구역은 빈 배열. */
  function goals(state, index) {
    return activeGoals(state, index).map(function (g) {
      var v = 0;
      try { v = safeNum(g.value(state), 0); } catch (e) { v = 0; }
      return { id: g.id, text: g.text, value: Math.min(v, g.need), need: g.need, unit: g.unit || null, done: !!state.goalsDone[g.id] };
    });
  }
  /*
   * 연장 목표(1.5.5): 목표를 채운 뒤에도 같은 자리에 더 큰 목표가 이어서 뜬다. 문 값보다 목표가 한참 먼저 끝나서 채우는 맛이 없다는 말에서 나왔다.
   *   문이 열리는 조건과 일지는 그대로다(원래 목표 셋). 연장 목표는 덤이고, 채울 때마다 간식 EXT_TREATS 개와 생산 EXT_SECONDS 초분을 받는다. 특전은 주지 않는다.
   *   크기: 수를 세는 목표는 단계마다 원래의 절반씩 는다(50 → 75 → 100 …). 물자 누적 목표(100만 이상)는 단계마다 10배.
   *   한 목표에 EXT_MAX 단계까지. 7구역은 없다(마지막 장의 목표는 이야기의 끝이다).
   *   state.goalExt = { 목표 id: 채운 연장 단계 수 }. 철수하면 비워진다.
   */
  var EXT_MAX = 5, EXT_TREATS = 2, EXT_SECONDS = 60;
  function extNeed(g, tier) { return g.need >= 1e6 && g.unit !== 'time' ? g.need * Math.pow(10, tier) : Math.ceil(g.need * (1 + 0.5 * tier)); }
  /** 목표 글 속의 수를 새 크기로 바꿔 적는다(글의 마지막 수를 바꾼다: "1구역 시설 합계 200곳" → "… 300곳"). */
  function extText(g, need) {
    var shown = g.unit === 'time' ? String(Math.round(need / 6) / 10) : need >= 1e6 ? formatNumber(need) : String(need);
    var re = /[\d][\d,.]*(?:[만억조경해자양구간정재극](?![가-힣]))?/g, last = null, m;
    while ((m = re.exec(g.text))) last = m;
    return last ? g.text.slice(0, last.index) + shown + g.text.slice(last.index + last[0].length) : g.text + ' (' + shown + ')';
  }
  /** 그 구역의 연장 목표 [{ id, tier, text, value, need, unit } | null]. 원래 목표를 아직 못 채웠거나 끝까지 채운 자리는 null. */
  function extGoals(state, index) {
    if (index >= ZONES.length - 1) return [null, null, null];
    return activeGoals(state, index).map(function (g) {
      var tier = (state.goalExt && state.goalExt[g.id]) || 0;
      if (!state.goalsDone[g.id] || tier >= EXT_MAX) return null;
      var need = extNeed(g, tier + 1), v = 0;
      try { v = safeNum(g.value(state), 0); } catch (e) { v = 0; }
      return { id: g.id, tier: tier + 1, text: extText(g, need), value: Math.min(v, need), need: need, unit: g.unit || null };
    });
  }
  function checkExtGoals(state, events) {
    for (var z = 0; z <= state.zone; z++) {
      extGoals(state, z).forEach(function (x) {
        if (!x || x.value < x.need) return;
        var gain = productionPerSec(state) * EXT_SECONDS;
        state.goalExt[x.id] = x.tier;
        earn(state, gain); state.treats = Math.min(1e9, state.treats + EXT_TREATS);
        events.push({ type: 'goal-ext', zone: z, id: x.id, tier: x.tier, text: x.text, gain: gain, treats: EXT_TREATS });
      });
    }
  }
  function goalsComplete(state, index) { return activeGoals(state, index).every(function (g) { return !!state.goalsDone[g.id]; }); }
  /** 새로 채운 목표를 달성 처리하고 특전 선택을 건다. 한 번에 하나씩(고르기 전에는 다음 것을 걸지 않는다). */
  function checkGoals(state, rng, events) {
    // 변이체를 막고 받을 특전이 밀려 있으면, 고를 것이 없을 때 하나 건다
    if (state.perkOwed > 0 && !state.pendingPerks.length) { state.perkOwed--; state.pendingPerks = drawPerks(rng, state); state.perkFrom = 'boss'; events.push({ type: 'boss-perk' }); }
    for (var z = 0; z <= state.zone; z++) {
      var list = activeGoals(state, z);
      for (var i = 0; i < list.length; i++) {
        var g = list[i];
        if (state.goalsDone[g.id] || state.pendingPerks.length) continue;
        var v = 0;
        try { v = g.value(state); } catch (e) { v = 0; }
        if (!(v >= g.need)) continue;
        state.goalsDone[g.id] = true;
        state.pendingPerks = drawPerks(rng, state); state.perkFrom = 'goal';
        events.push({ type: 'goal', zone: z, id: g.id, text: g.text });
      }
    }
    checkExtGoals(state, events);
    if (state.challenge && state.challenge.failed && !state.challenge.told) { state.challenge.told = true; var cdef = findById(CHALLENGES, state.challenge.id); if (cdef && !events.some(function (e) { return e.type === 'challenge-failed'; })) events.push({ type: 'challenge-failed', id: cdef.id, name: cdef.name, why: 'rule' }); state.challengeStreak = 0; }
    // 7구역의 목표를 모두 채우면 이야기가 끝난다. 한 회차에 한 번만 센다(endedRun). 끝낸 횟수(ended)는 철수해도 남는다
    if (state.zone >= ZONES.length - 1 && !state.endedRun && goalsComplete(state, ZONES.length - 1) && !(scoutLeft(state) > 0)) {
      state.endedRun = true;
      state.ended = (state.ended || 0) + 1;
      if (!state.endedAt) state.endedAt = Date.now();
      addTickets(state, 3);
      events.push({ type: 'ending', count: state.ended, day: state.day, retreats: state.retreats, seconds: state.playSeconds });
    }
    checkChallenge(state, events);      // 도전: 목표에 닿았는지, 시간을 넘겼는지
    checkStage(state, events);          // 원정 스테이지: 목표를 채웠는지, 시간이 다 됐는지
  }
  /** 다음 구역의 상태 { index, zone, cost, ready(목표를 다 채웠는가), soon(아직 없는 구역인가) }. 마지막 구역이면 null. */
  /*
   * 다음 구역의 문(1.4.0): 문 값은 "이번 회차에 모은 물자의 누적"으로 잰다. 가진 물자를 내지 않는다.
   *   전에는 가진 물자에서 문 값을 냈다. 그러면 문 값을 모으는 동안 아무것도 사지 않고 기다리는 것이 가장 빨랐다(방치형에서 가장 재미없는 구간).
   *   이제는 사고 싶은 것을 사면서 가도 문이 열린다. 철수 화면의 "이번 회차 누적"과 같은 숫자다.
   *   have: 이번 회차 누적 물자, enough: 문 값에 닿았는가.
   */
  /*
   * 길 정찰(1.6.2): 구역마다 최소한 머물러야 하는 시간.
   *   구역에 들어선 때부터 SCOUT_MINUTES[구역] 분이 지나야 다음 구역의 문을 열 수 있다(7구역은 이야기의 끝).
   *   넣은 까닭: 특성과 업적을 다 채우면 한 회차가 1시간도 안 걸렸다. 문 값은 배수가 커지면 금방 채워지지만 시간은 줄지 않는다.
   *   뒤 구역일수록 조금씩 길다. 자리를 비운 시간도 센다(runSeconds 가 그렇다). 새로 시작한 사람은 원래 이보다 오래 머문다.
   */
  var SCOUT_MINUTES = [5, 7, 9, 12, 15, 19, 23];
  function scoutNeed(zone) { return (SCOUT_MINUTES[zone] || 0) * 60; }
  /** 지금 구역에 들어선 때(이번 회차가 시작되고 몇 초째였는지). */
  function zoneEntered(state) {
    if (!(state.zone > 0)) return 0;
    for (var i = (state.zoneLog || []).length - 1; i >= 0; i--) if (state.zoneLog[i] && state.zoneLog[i].zone === state.zone) return Math.max(0, Number(state.zoneLog[i].seconds) || 0);
    return 0;      // 기록이 없는 옛 저장: 회차 처음부터 있었던 것으로 본다
  }
  /** 지금 구역의 정찰이 끝나기까지 남은 초. 끝났으면 0. */
  function scoutLeft(state) { return Math.max(0, Math.ceil(scoutNeed(state.zone) * mods(state).scout - ((state.runSeconds || 0) - zoneEntered(state)))); }
  function nextZone(state) {
    var i = state.zone + 1;
    if (i >= ZONES.length) return null;
    var cost = Math.ceil(ZONES[i].cost * mods(state).cost), have = Math.max(0, state.runEarned || 0);
    return { index: i, zone: ZONES[i], cost: cost, have: have, enough: have >= cost, wait: scoutLeft(state), ready: goalsComplete(state, state.zone), soon: ZONES[i].kind === 'soon' };
  }
  /**
   * 다음 구역의 문을 연다. 앞 구역은 그대로 남아 계속 번다.
   * 아직 만들지 않은 구역이면 값은 치르되 들어가지는 못하고 '문 앞에 닿았다'는 기록만 남는다.
   */
  function openZone(state) {
    var n = nextZone(state);
    if (!n) return fail('last');
    if (!n.ready) return fail('goals');
    if (n.soon && state.gate) return fail('soon');
    if (!n.enough) return fail('supplies');      // 누적이 모자라다. 물자는 내지 않는다
    if (n.wait > 0) return fail('scout');         // 길 정찰이 아직 끝나지 않았다
    if (n.soon) { state.gate = true; state.bestZone = Math.max(state.bestZone, n.index); return { ok: true, soon: true, index: n.index, zone: n.zone }; }
    state.zone = n.index;
    state.zoneLog.push({ zone: n.index, seconds: state.runSeconds, day: state.day });      // 통계의 '지난 구역'
    state.bestZone = Math.max(state.bestZone, n.index);
    return { ok: true, soon: false, index: n.index, zone: n.zone };
  }

  /* ---------- 밤과 방벽 ---------- */
  function defenseCost(state, id, qty) {
    var def = findById(DEFENSES, id);
    var m = mods(state);
    return def ? seriesCost(def.baseCost * m.cost * m.defcost, DEFENSE_GROWTH, state.defenses[id], qty) : Infinity;
  }
  function maxDefenses(state, id) {
    var def = findById(DEFENSES, id);
    var m = mods(state);
    return def ? seriesMax(def.baseCost * m.cost * m.defcost, DEFENSE_GROWTH, state.defenses[id], state.supplies, 1e6) : 0;
  }
  function buyDefense(state, id, qty) {
    qty = Math.floor(qty);
    if (!findById(DEFENSES, id) || !(qty >= 1)) return fail('unknown');
    if (challengeOn(state, 'onewall') && DEFENSES.some(function (d) { return d.id !== id && state.defenses[d.id] > 0; })) return fail('challenge');      // 도전: 방벽 한 종류만
    return pay(state, defenseCost(state, id, qty), function () { state.defenses[id] += qty; });
  }
  /*
   * 수리공(방벽 개조): 방어 수단마다 "몇 개까지 알아서 살지"(autoDef)를 정해 두면, 일정한 간격으로 하나씩 사 준다.
   *   AUTO_DEF_STEPS : 고를 수 있는 수. 0 은 끔.
   *   repairInterval : 수리공 레벨이 오를수록 짧아진다(5초 → 1초).
   * 물자가 모자라면 그 차례는 건너뛴다. 자리를 비운 동안에는 사지 않는다(돌아와서 물자가 사라져 있으면 놀라니까).
   */
  var AUTO_DEF_STEPS = [0, 10, 25, 50, 100, 200, 500];
  function repairInterval(state) { return Math.max(1, 6 - Math.floor(mods(state).repair)); }
  /** 방어 수단 id 의 자동 구입 목표를 다음 단계로 넘긴다(끝이면 끔으로 돌아간다). 수리공이 없으면 실패. */
  function cycleAutoDef(state, id) {
    if (!findById(DEFENSES, id)) return fail('unknown');
    if (!(mods(state).repair >= 1)) return fail('locked');
    // 목표는 "지금 가진 수에서 몇 개 더"로 정한다(0.9.25). 전에는 "모두 합쳐 몇 개까지"라서, 이미 100개가 있으면 10·25·50 을 골라도 아무것도 사지 않았다.
    // 누를 때마다 남은 수가 다음 단계(10 → 25 → 50 → …)로 늘고, 끝까지 가면 끈다.
    var owned = state.defenses[id] || 0, left = autoDefLeft(state, id), next = 0;
    for (var i = 1; i < AUTO_DEF_STEPS.length; i++) if (AUTO_DEF_STEPS[i] > left) { next = AUTO_DEF_STEPS[i]; break; }
    state.autoDef[id] = next ? owned + next : 0;
    return { ok: true, target: state.autoDef[id], left: next };
  }
  /** 방어 수단 id 를 앞으로 몇 개 더 살 것인지(0 이면 꺼져 있거나 다 샀다). */
  function autoDefLeft(state, id) { return Math.max(0, (state.autoDef[id] || 0) - (state.defenses[id] || 0)); }
  function stepRepair(state, dt) {
    if (!(mods(state).repair >= 1)) return;
    state.repairClock += dt;
    var every = repairInterval(state);
    if (state.repairClock < every) return;
    state.repairClock = dt > every * 3 ? 0 : state.repairClock - every;      // 긴 dt 는 한 번으로 친다
    DEFENSES.forEach(function (d) {
      if ((state.autoDef[d.id] || 0) > state.defenses[d.id] && defenseCost(state, d.id, 1) <= state.supplies) buyDefense(state, d.id, 1);
    });
  }
  function defensePower(state) {
    var total = BASE_DEFENSE;
    DEFENSES.forEach(function (d) { total += d.power * (state.defenses[d.id] || 0); });
    return Math.floor(total * mods(state).defense * postDefense(state));
  }
  /** 6구역 초소는 다리를 지키는 자리라 방어력도 올린다(1.3.0): 초소 하나마다 POST_DEFENSE. 6구역을 열기 전에는 1. */
  function postDefense(state) { var n = state.zone >= 5 ? (state.posts || 0) : 0; return 1 + POST_DEFENSE * n * milestoneMult(n); }      // 초소도 10·25·50…곳마다 2배가 붙는다
  function currentWave(state) { return state.wavesCleared + 1; }
  function isBossWave(w) { return w % BOSS_EVERY === 0; }
  /** w 번째 밤의 무리 규모. 뒤 구역을 열수록 무리도 커진다(구역 하나마다 3배). */
  function strengthAt(state, w) {
    return Math.round(HORDE_BASE * Math.pow(HORDE_GROWTH, w - 1) * (isBossWave(w) ? BOSS_STRENGTH : 1) * Math.pow(3, state.zone));
  }
  /*
   * 농성이 길어지면 무리가 흩어진다: 못 막은 밤 하루마다 무리가 SIEGE_FADE 만큼 줄어든다(SIEGE_FLOOR 까지).
   * 방벽을 올릴 물자가 더디게 모이는 때에도 언젠가는 풀리게 해서, 무리 때문에 철수로 내몰리지 않게 한다.
   * 방어에 성공하면 다음 무리는 원래 크기로 돌아온다.
   */
  var SIEGE_FADE = 0.05, SIEGE_FLOOR = 0.5;      // 천천히, 절반까지만: 철수로 내몰리는 압박은 남기되 끝없이 갇히지는 않게
  function siegeFactor(state) { return Math.max(SIEGE_FLOOR, Math.pow(1 - SIEGE_FADE, state.siegeNights || 0)); }
  /*
   * 선제 공격과 반격(1.5.3): 밤 칸에 생기는 단추 둘. 둘 다 "다음에 오는 밤 한 번의 무리를 NIGHT_EASE 배로" 줄인다(state.nightEase). 밤이 지나면 원래대로 돌아온다.
   *   선제 공격: 밤을 막을 때마다 방어력이 무리를 넘는 만큼 여유 게이지(state.edge, 0~1)가 찬다. 한 번에 (방어력 ÷ 무리 − 1) × EDGE_GAIN, 많아야 EDGE_GAIN.
   *             가득 차면 쓸 수 있고, 쓰면 게이지가 빈다. 넉넉하게 막은 것을 다음 밤의 여유로 돌려준다.
   *   반격:     못 막고 버틴 밤이 COUNTER_NIGHTS 번 쌓이면 쓸 수 있다. 쓰고 나면 다시 그만큼 버텨야 한다. 버티는 시간이 준비가 된다.
   *   둘 다 손으로 누르는 것이고, 한 밤에 하나만 쓸 수 있다.
   */
  var NIGHT_EASE = 0.5, EDGE_GAIN = 0.34, COUNTER_NIGHTS = 3;
  function easeOn(state) { return state.nightEase > 0 && state.nightEase < 1; }
  function strikeReady(state) { return (state.edge || 0) >= 1 - 1e-9 && !easeOn(state); }
  function counterReady(state) { return !!state.siege && (state.siegeNights || 0) - (state.counterAt || 0) >= COUNTER_NIGHTS && !easeOn(state); }
  function strike(state) {
    if (!strikeReady(state)) return fail(easeOn(state) ? 'set' : 'not-ready');
    state.edge = 0; state.nightEase = NIGHT_EASE;
    return { ok: true, ease: NIGHT_EASE };
  }
  function counterAttack(state) {
    if (!counterReady(state)) return fail(easeOn(state) ? 'set' : 'not-ready');
    state.counterAt = state.siegeNights || 0; state.nightEase = NIGHT_EASE;
    return { ok: true, ease: NIGHT_EASE };
  }
  function nightStrength(state) { return Math.ceil(strengthAt(state, currentWave(state)) * siegeFactor(state) * (easeOn(state) ? state.nightEase : 1) * (challengeOn(state, 'horde') ? HORDE_MULT : 1)); }
  /*
   * 연속 방어(1.5.2): 밤을 연달아 막을수록 전리품이 커진다. 한 번이라도 못 막으면 처음으로 돌아간다.
   *   배수 = 1 + DEF_STREAK_STEP × 연속으로 막은 밤, DEF_STREAK_MAX 까지. (첫 밤 ×1, 5연속 뒤 ×1.5, 10연속 뒤 ×2)
   *   방벽을 미리 올려 둘 이유와, 뚫릴 것 같을 때 버틸지 철수할지 고민할 이유를 만든다.
   * 변이체(BOSS_EVERY 번째 밤): 물자는 BOSS_REWARD 배, 간식 TREAT_BOSS 개, 그리고 특전 하나를 고른다.
   *   특전은 이번 회차에만 남으므로 철수로 얻는 것(항체)과 겹치지 않는다. 고를 것이 이미 떠 있으면 perkOwed 에 적어 두었다가 다음에 건다.
   */
  var BOSS_PERKS_MAX = 3;      // 한 회차에 변이체로 얻는 특전의 수. 끝없이 주면 회차가 통째로 빨라진다(재 보니 엔딩이 13시간에서 5시간이 됐다)
  var DEF_STREAK_STEP = 0.1, DEF_STREAK_MAX = 2, PERK_OWED_MAX = 2;      // 2구역 연속 호가의 STREAK_MAX 와 다른 값이다(이름을 따로 쓴다)
  function defStreakMult(state) { return Math.min(DEF_STREAK_MAX, 1 + DEF_STREAK_STEP * Math.max(0, state.defStreak || 0)); }
  function nightReward(state) {
    var w = currentWave(state);
    return Math.max(25 * w, productionPerSec(state) * NIGHT_REWARD_SECONDS) * mods(state).loot * (isBossWave(w) ? BOSS_REWARD : 1) * defStreakMult(state);
  }
  /** 오늘 밤을 막는 데 가장 싼 보강 { cost, picks: [{ id, qty }], enough }. 이미 막을 수 있으면 cost 0. */
  function defensePlan(state) {
    var tmp = { supplies: Infinity, defenses: {}, upgrades: state.upgrades, perks: state.perks, traits: state.traits, research: state.research, pet: state.pet, zone: state.zone, posts: state.posts };   // defensePower 가 읽는 것만 담는다(연구 과제 '방어 교범' 포함)
    DEFENSES.forEach(function (d) { tmp.defenses[d.id] = state.defenses[d.id]; });
    /*
     * 1.2.3: 배수(mods)는 방어 수단을 더해도 바뀌지 않으므로 고리 밖에서 한 번만 셈한다.
     *   예전에는 한 개를 더할 때마다 mods 를 여덟 번쯤 다시 셈해서, 방어력이 한참 모자란 후반 구역에서는 이 함수 한 번에 0.1초 가까이 걸렸다.
     *   화면이 0.1초마다 이 함수를 부르므로(보강 단추의 값) 방벽이 밀리는 동안 게임이 통째로 버벅였다. 셈하는 식과 순서는 그대로다(결과가 같다).
     */
    var need = nightStrength(state), cost = 0, picked = {}, guard = 0, m = mods(tmp), costMul = m.cost * m.defcost, total = BASE_DEFENSE, mult = m.defense * postDefense(tmp);
    DEFENSES.forEach(function (d) { total += d.power * (tmp.defenses[d.id] || 0); });
    while (Math.floor(total * mult) < need && guard++ < 3000) {
      var best = null, bestValue = 0, bestCost = 0;
      DEFENSES.forEach(function (d) { var c = seriesCost(d.baseCost * costMul, DEFENSE_GROWTH, tmp.defenses[d.id], 1), v = d.power / c; if (v > bestValue) { best = d; bestValue = v; bestCost = c; } });
      if (!best) break;
      cost += bestCost;
      tmp.defenses[best.id]++; total += best.power;
      picked[best.id] = (picked[best.id] || 0) + 1;
    }
    return { cost: cost, picks: Object.keys(picked).map(function (id) { return { id: id, qty: picked[id] }; }), enough: defensePower(tmp) >= need };
  }
  /** 방어 계획대로 한 번에 보강한다. 물자가 모자라면 아무것도 사지 않는다. */
  function fortify(state) {
    var plan = defensePlan(state);
    if (!plan.picks.length) return fail('safe');
    if (plan.cost > state.supplies) return fail('supplies');
    // 계획이 하나씩 더해 가며 셈한 값을 그대로 치른다(묶음으로 다시 셈하면 올림 때문에 몇 단위가 어긋난다)
    state.supplies -= plan.cost;
    plan.picks.forEach(function (p) { state.defenses[p.id] += p.qty; });
    return { ok: true, cost: plan.cost, picks: plan.picks };
  }
  /** 하루의 어느 구간인가 { phase: 'day' | 'battle', left, total }. */
  function dayPhase(state) {
    var clock = clamp(safeNum(state.dayClock, 0), 0, DAY_SECONDS), arriveAt = DAY_SECONDS - BATTLE_SECONDS;
    return clock < arriveAt ? { phase: 'day', left: arriveAt - clock, total: arriveAt } : { phase: 'battle', left: DAY_SECONDS - clock, total: BATTLE_SECONDS };
  }
  /**
   * 밤 한 번의 결과를 정한다.
   *   막으면      : 전리품을 얻고 다음 밤으로(무리가 커진다)
   *   처음 뚫리면 : 물자의 15% 를 잃고 농성에 들어간다
   *   농성 중     : 못 막는 밤은 잃지도 얻지도 않고 버틴다. 한 번 막아내면 농성이 풀린다
   */
  /** 밤을 넘긴다. 결과 사건에 그날 처음 만난 좀비(found)를 붙인다. */
  function resolveNight(state, rng) {
    var day = state.day, boss = isBossWave(currentWave(state)), ev = resolveNightCore(state, rng);
    var found = sightZombies(state, day, boss);
    if (found.length) ev.found = found;
    return ev;
  }
  function resolveNightCore(state, rng) {
    var w = currentWave(state), strength = nightStrength(state), defense = defensePower(state), boss = isBossWave(w);
    state.day++;
    state.nightEase = 1;      // 선제 공격·반격은 이 밤 한 번에만 듣는다(무리 규모는 위에서 이미 읽었다)
    if (defense >= strength) {
      var reward = nightReward(state);
      earn(state, reward);
      state.wavesCleared++;
      state.defStreak = Math.min(1e6, (state.defStreak || 0) + 1);
      var edgeWas = state.edge || 0;
      state.edge = Math.min(1, (state.edge || 0) + Math.max(0, Math.min(1, defense / Math.max(1, strength) - 1)) * EDGE_GAIN);
      var edgeFull = edgeWas < 1 && state.edge >= 1;      // 넉넉하게 막은 만큼 여유 게이지가 찬다
      state.counterAt = 0;
      if (boss && (state.bossPerks || 0) < BOSS_PERKS_MAX) { addTickets(state, 1); state.bossPerks = (state.bossPerks || 0) + 1; state.perkOwed = Math.min(PERK_OWED_MAX, (state.perkOwed || 0) + 1); }      // 변이체를 막으면 특전 하나(한 회차에 BOSS_PERKS_MAX 번까지)
      var passer = null;
      if (zoneOpen(state, 5) && defense >= strength * SAFE_NIGHT) { state.safeNights++; passer = passBridge(state, rng); }      // 6구역: 넉넉하게 막은 밤(목표)에는 가끔 누가 다리를 건넌다
      state.siege = false; state.siegeNights = 0;
      var treat = boss ? TREAT_BOSS : TREAT_NIGHT;
      state.treats = Math.min(1e9, state.treats + treat);      // 밤을 막으면 간식을 얻는다
      return { type: 'defended', wave: w, strength: strength, defense: defense, reward: reward, boss: boss, treats: treat, passer: passer, edgeFull: edgeFull };
    }
    state.defStreak = 0;      // 못 막았다: 연속 방어가 끊긴다
    if (state.siege) { state.siegeNights = Math.min(99, (state.siegeNights || 0) + 1); return      /* 버틴 밤을 센다: 다음 밤의 무리가 그만큼 흩어진다 */ { type: 'held', wave: w, strength: strength, defense: defense, boss: boss, counterReady: state.siegeNights - (state.counterAt || 0) === COUNTER_NIGHTS }; }
    var lost = state.supplies * BREACH_LOSS;
    state.supplies -= lost;
    state.breaches++;
    if (challengeOn(state, 'unbroken')) state.challenge.failed = true;      // 도전 '무결': 뚫리면 끝(알림은 checkGoals 가 다음 틱에 낸다)
    state.siege = true;
    return { type: 'breached', wave: w, strength: strength, defense: defense, lost: lost, boss: boss };
  }

  /* ---------- 구조 신호 ---------- */
  var SIGNAL_TREATS = 3;      // 구조 신호의 보상으로 간식이 나왔을 때의 개수
  function answerSignal(state, rng) {
    if (!(state.signalLeft > 0)) return fail('none');
    rng = typeof rng === 'function' ? rng : Math.random;
    state.signalLeft = 0;
    state.signalsAnswered++;
    // 보상은 셋 가운데 하나: 물자(45%), 간식(15%), 생산 배수(40%)
    var roll = rng();
    if (roll >= 0.45 && roll < 0.6) {
      state.treats = Math.min(1e9, state.treats + SIGNAL_TREATS);
      return { ok: true, kind: 'treats', treats: SIGNAL_TREATS };
    }
    if (roll < 0.45) {
      var gain = Math.max(SIGNAL_SUPPLY_MIN, productionPerSec(state) * SIGNAL_SUPPLY_SECONDS);
      earn(state, gain);
      return { ok: true, kind: 'supplies', gain: gain };
    }
    state.buff = { mult: BUFF_MULT, left: BUFF_SECONDS };
    return { ok: true, kind: 'buff', mult: BUFF_MULT, seconds: BUFF_SECONDS };
  }

  /* ---------- 특전 ---------- */
  /** 특전 PERK_CHOICES 장을 겹치지 않게 뽑는다. state 를 주면 아직 열지 않은 구역의 특전은 뺀다. */
  function drawPerks(rng, state) {
    var reach = state && typeof state.zone === 'number' ? state.zone : Infinity;
    var pool = PERKS.filter(function (p) { return !(p.zone > reach); }).map(function (p) { return p.id; }), out = [];
    rng = typeof rng === 'function' ? rng : Math.random;
    while (out.length < PERK_CHOICES && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length) % pool.length, 1)[0]);
    return out;
  }
  /** 이번 판에 남은 '다시 뽑기' 횟수(영구 특성 '다시 뽑기'의 레벨 − 이번 판에 쓴 횟수). */
  function rerollsLeft(state) { return Math.max(0, Math.floor(mods(state).reroll) - (state.rerollsUsed || 0)); }
  /** 지금 떠 있는 특전 후보를 버리고 새로 뽑는다. 후보가 없거나 횟수가 없으면 실패. */
  function rerollPerks(state, rng) {
    if (!state.pendingPerks.length) return fail('none');
    if (rerollsLeft(state) < 1) return fail('empty');
    state.rerollsUsed = (state.rerollsUsed || 0) + 1;
    state.pendingPerks = drawPerks(rng, state);
    return { ok: true, left: rerollsLeft(state) };
  }
  function choosePerk(state, id) {
    if (state.pendingPerks.indexOf(id) < 0) return fail('unknown');
    state.perks[id]++;
    state.pendingPerks = [];
    return { ok: true, id: id, level: state.perks[id] };
  }

  /* ---------- 철수와 영구 특성 ---------- */
  /** 지금 철수하면 얻는 항체 샘플 수. 이번 판에서 RETREAT_MIN 이상 모아야 1개 이상이 된다. */
  /*
   * 항체 샘플은 "물자의 자릿수"를 따라 는다(0.9.24). 전에는 물자의 거듭제곱이라, 뒤 구역에서 물자가 폭발하면 샘플도 수천 개씩 쏟아졌다.
   *   샘플 = RETREAT_K + ANTI_STEP × (자릿수)^ANTI_CURVE × 배수.   자릿수 = log10(이번 회차 누적 물자 ÷ RETREAT_MIN)
   *   1억 → 2개, 1,000억 → 18개, 1,000경 → 90개쯤. 물자를 10배 더 모을 때마다 몇 개씩 더 받는 셈이다.
   */
  var ANTI_STEP = 4, ANTI_CURVE = 1.3;
  function antibodiesFor(run, mult) {
    if (!(run >= RETREAT_MIN)) return 0;
    var d = Math.log(run / RETREAT_MIN) / Math.LN10;
    return Math.floor((RETREAT_K + ANTI_STEP * Math.pow(d, ANTI_CURVE)) * mult);
  }
  function antibodiesOnRetreat(state) { return antibodiesFor(state.runEarned, mods(state).antibody); }
  /**
   * 항체 샘플을 하나 더 받으려면 이번 회차 누적 물자가 얼마여야 하는지. (철수 화면이 "다음 샘플까지"를 알려 주는 데 쓴다)
   * 식을 거꾸로 풀지 않고 반씩 좁혀 가며 찾는다: 식이 바뀌어도 그대로 맞는다.
   */
  function nextAntibodyAt(state) {
    var mult = mods(state).antibody, want = antibodiesOnRetreat(state) + 1;
    if (!(mult > 0)) return Infinity;
    if (antibodiesFor(RETREAT_MIN, mult) >= want) return RETREAT_MIN;
    var lo = Math.max(RETREAT_MIN, state.runEarned || 0), hi = lo * 2, guard = 0;
    while (antibodiesFor(hi, mult) < want && guard++ < 400) hi *= 2;
    for (var k = 0; k < 80; k++) { var mid = Math.sqrt(lo * hi); if (antibodiesFor(mid, mult) >= want) hi = mid; else lo = mid; }
    return hi;
  }
  function canRetreat(state) { return !state.stage && antibodiesOnRetreat(state) >= 1 && !state.pendingPerks.length; }      // 스테이지에서는 철수가 없다
  /**
   * 철수: 거점을 전부 버리고 1구역에서 다시 시작한다.
   *   사라지는 것 : 물자, 시설, 방벽, 구역 강화, 좌판과 상품, 기계, 열차와 노선, 연구원과 끝낸 과제, 연 구역, 특전, 막아낸 밤, 달성한 목표
   *   남는 것     : 항체 샘플과 영구 특성, 읽은 일지, 통계
   */
  /*
   * 도전(1.7.0): 조건을 하나 걸고 회차를 시작한다. 조건을 지키며 목표 구역에 닿으면 훈장을 받는다.
   *   고르기   : setNextChallenge 로 "다음 회차의 도전"을 정해 두면, 다음 철수 때 그 도전으로 시작한다.
   *   열림     : 그 목표 구역에 한 번이라도 닿아 본 뒤(bestZone). 끝까지 가는 도전은 엔딩을 본 뒤.
   *   끝       : 목표에 닿으면 성공(done). 조건을 어기면 실패(failed)이고, 그 뒤로는 조건이 풀려 평소처럼 이어 간다.
   *   보상     : 처음 성공하면 훈장 하나(전체 생산 +MEDAL_BONUS, 영구)와 간식. 다시 성공하면 간식만.
   * 조건은 규칙 함수 안에서 challengeOn 으로 확인한다: 개조 구매(frugal, hands), 방벽 구매(onewall), 밤(unbroken, horde), 생산(lean), 시간(sprint).
   */
  var HANDS_AWAY = 0.5;      // 도전 '손수' 중 자리 비움 효율에 곱하는 값
  var MEDAL_BONUS = 0.02, CHALLENGE_TREATS = 10, CHALLENGE_TREATS_AGAIN = 3, SPRINT_SECONDS = 45 * 60, HORDE_MULT = 3, LEAN_MULT = 0.5;
  var CHALLENGES = [
    { id: 'frugal',   name: '맨몸',      rule: '개조를 살 수 없어요',            goal: 2, perk: { key: 'cost', mult: 0.95, text: '모든 구매 비용 -5%' } },
    { id: 'hands',    name: '손수',      rule: '자동 개조 금지 · 자리 비움 효율 절반',      goal: 3, perk: { key: 'autoshare', add: 0.1, text: '현재 구역 자동 효율 +10%p' } },
    { id: 'sprint',   name: '질주',      rule: '45분 안에 닿아야 해요',          goal: 3, perk: { key: 'scout', mult: 0.85, text: '길 정찰 시간 -15%' } },
    { id: 'onewall',  name: '외벽',      rule: '방벽을 한 종류만 살 수 있어요',  goal: 4, perk: { key: 'defense', mult: 1.1, text: '방어력 +10%' } },
    { id: 'unbroken', name: '무결',      rule: '한 번도 뚫리면 안 돼요',         goal: 4, perk: { key: 'loot', mult: 1.2, text: '방어 성공 시 전리품 +20%' } },
    { id: 'horde',    name: '거센 무리', rule: '무리가 3배로 와요',              goal: 5, perk: { key: 'defcost', mult: 0.9, text: '방벽 비용 -10%' } },
    { id: 'lean',     name: '반쪽 보급', rule: '전체 생산이 절반이에요',         goal: 6, perk: { key: 'prod', mult: 1.1, text: '전체 생산 +10%' } },
    { id: 'oneshot',  name: '단숨에',    rule: '철수 없이 끝까지 가요',          goal: 'end', perk: { key: 'antibody', mult: 1.1, text: '철수 항체 샘플 +10%' } }
  ];
  /** 도전의 목표를 글로: '4구역 도착' / '이야기의 끝'. */
  function challengeGoalText(def) { return def.goal === 'end' ? '이야기의 끝' : ZONES[def.goal].no + '구역 도착'; }
  /** 이 도전을 고를 수 있는가: 목표 구역에 닿아 본 적이 있어야 한다. */
  function challengeOpen(state, id) {
    var def = findById(CHALLENGES, id);
    if (!def) return false;
    return def.goal === 'end' ? (state.ended || 0) >= 1 : Math.max(state.bestZone || 0, state.zone || 0) >= def.goal;
  }
  /** 지금 이 도전의 조건이 걸려 있는가(성공했거나 실패한 뒤에는 풀린다). */
  function challengeOn(state, id) { var c = state.challenge; return (!!c && c.id === id && !c.failed && !c.done) || stageRule(state, id); }      // 원정 스테이지의 규칙도 같은 자리에서 걸린다

  /*
   * ---------- 꾸미기와 뽑기(1.9.0) ----------
   * 외형만 바꾼다(라라의 우비, 거점의 깃발). 생산이나 방어에는 아무 영향이 없다.
   *   뽑기권 : 원정의 새 표시(1장씩), 도전 성공(처음 3장, 다시 1장), 변이체를 막은 밤(1장), 이야기의 끝(3장). 간식 TICKET_TREATS 개로도 한 장 산다.
   *   확률   : GACHA_ODDS 가 등급의 확률이고, 같은 등급 안에서는 모두 같다. 화면의 확률표(gachaTable)와 추첨(pullGacha)이 같은 표를 쓴다.
   *   보장   : GACHA_PITY 번 안에 전설이 한 번은 나온다(전설이 나오면 다시 센다). 남은 횟수는 gachaPityLeft.
   *   중복   : 이미 가진 것이 나오면 조각으로 바뀐다(SHARDS_DUP). 조각을 모으면 원하는 외형을 골라 얻는다(SHARDS_COST).
   * 세트를 다 모아야 보상을 주는 방식(컴플리트)은 두지 않는다. 뽑기에서 나오는 것은 전부 이 표에 있는 외형이다.
   */
  var RARITIES = ['일반', '희귀', '전설'], GACHA_ODDS = [0.7, 0.25, 0.05], GACHA_PITY = 30, TICKET_TREATS = 20;
  var SHARDS_DUP = [1, 3, 10], SHARDS_COST = [5, 15, 50];
  var COSMETICS = [
    { id: 'coat-yellow', slot: 'coat', name: '노란 우비',   rarity: 0, base: true, look: { y: '#f0b400', j: '#f0b400' } },
    { id: 'coat-red',    slot: 'coat', name: '빨간 우비',   rarity: 0, look: { y: '#c0392b', j: '#c0392b' } },
    { id: 'coat-blue',   slot: 'coat', name: '파란 우비',   rarity: 0, look: { y: '#3f7fb5', j: '#3f7fb5' } },
    { id: 'coat-green',  slot: 'coat', name: '초록 우비',   rarity: 0, look: { y: '#4f9a4a', j: '#4f9a4a' } },
    { id: 'coat-orange', slot: 'coat', name: '주황 우비',   rarity: 0, look: { y: '#e07b2a', j: '#e07b2a' } },
    { id: 'coat-purple', slot: 'coat', name: '보라 우비',   rarity: 1, look: { y: '#8a5fc0', j: '#8a5fc0' } },
    { id: 'coat-white',  slot: 'coat', name: '하얀 우비',   rarity: 1, look: { y: '#e6e5db', j: '#e6e5db' } },
    { id: 'coat-black',  slot: 'coat', name: '검은 우비',   rarity: 1, look: { y: '#3a3d45', j: '#2b2d33' } },
    { id: 'coat-night',  slot: 'coat', name: '밤하늘 우비', rarity: 2, look: { y: '#27336e', j: '#4a5fb8' } },
    { id: 'coat-neon',   slot: 'coat', name: '형광 우비',   rarity: 2, look: { y: '#c6ff4a', j: '#8fe01f' } },
    // 1.10.0: 후드 모양·우비 무늬·가방·전설 효과. look 은 그림 쪽(scene.js)이 아는 이름이다
    { id: 'hood-none',   slot: 'hood', name: '기본 후드',   rarity: 0, base: true, look: 'none' },
    { id: 'hood-cat',    slot: 'hood', name: '고양이 귀',   rarity: 1, look: 'cat' },
    { id: 'hood-bear',   slot: 'hood', name: '곰 귀',       rarity: 1, look: 'bear' },
    { id: 'hood-rabbit', slot: 'hood', name: '토끼 귀',     rarity: 1, look: 'rabbit' },
    { id: 'hood-horn',   slot: 'hood', name: '뿔 후드',     rarity: 2, look: 'horn' },
    { id: 'pat-none',    slot: 'pat',  name: '무늬 없음',   rarity: 0, base: true, look: 'none' },
    { id: 'pat-stripe',  slot: 'pat',  name: '줄무늬',      rarity: 0, look: 'stripe' },
    { id: 'pat-dot',     slot: 'pat',  name: '물방울',      rarity: 0, look: 'dot' },
    { id: 'pat-camo',    slot: 'pat',  name: '위장 무늬',   rarity: 1, look: 'camo' },
    { id: 'pat-star',    slot: 'pat',  name: '별 무늬',     rarity: 1, look: 'star' },
    { id: 'bag-cooler',  slot: 'bag',  name: '냉장 상자',   rarity: 0, base: true, look: 'cooler' },
    { id: 'bag-ruck',    slot: 'bag',  name: '낡은 배낭',   rarity: 0, look: 'ruck' },
    { id: 'bag-medkit',  slot: 'bag',  name: '구급 상자',   rarity: 1, look: 'medkit' },
    { id: 'bag-teddy',   slot: 'bag',  name: '곰 인형 가방', rarity: 1, look: 'teddy' },
    { id: 'fx-none',     slot: 'fx',   name: '효과 없음',   rarity: 0, base: true, look: 'none' },
    { id: 'fx-glow',     slot: 'fx',   name: '야광',        rarity: 2, look: 'glow' },
    { id: 'fx-sparkle',  slot: 'fx',   name: '반짝이 가루', rarity: 2, look: 'sparkle' },
    { id: 'fx-star',     slot: 'fx',   name: '머리 위 별',  rarity: 2, look: 'star' },
    // 깃발은 뽑기에서 뺐다(1.10.0: 화면에서 작아서 뽑아도 기쁘지 않았다). 도전·원정의 확정 보상으로 준다(FLAG_REWARDS). 조각으로도 얻을 수 있다
    { id: 'flag-yellow', slot: 'flag', name: '노란 깃발',   rarity: 0, base: true, look: '#f0b400' },
    { id: 'flag-red',    slot: 'flag', name: '빨간 깃발',   rarity: 0, reward: true, look: '#c0392b' },
    { id: 'flag-blue',   slot: 'flag', name: '파란 깃발',   rarity: 0, reward: true, look: '#3f7fb5' },
    { id: 'flag-green',  slot: 'flag', name: '초록 깃발',   rarity: 0, reward: true, look: '#4f9a4a' },
    { id: 'flag-white',  slot: 'flag', name: '하얀 깃발',   rarity: 1, reward: true, look: '#e6e5db' },
    { id: 'flag-black',  slot: 'flag', name: '검은 깃발',   rarity: 1, reward: true, look: '#2b2d33' },
    { id: 'flag-pink',   slot: 'flag', name: '분홍 깃발',   rarity: 2, reward: true, look: '#ff7fb0' }
  ];
  var COS_SLOTS = ['coat', 'hood', 'pat', 'bag', 'fx', 'flag'], COS_BASE = { coat: 'coat-yellow', hood: 'hood-none', pat: 'pat-none', bag: 'bag-cooler', fx: 'fx-none', flag: 'flag-yellow' };
  /* 깃발을 주는 조건(확정 보상): 도전 훈장의 수, 원정 표시의 수, 지역 휘장 */
  var FLAG_REWARDS = [
    { id: 'flag-red',   text: '도전 훈장 1개', has: function (s) { return medalCount(s) >= 1; } },
    { id: 'flag-blue',  text: '도전 훈장 3개', has: function (s) { return medalCount(s) >= 3; } },
    { id: 'flag-green', text: '원정 표시 6개', has: function (s) { return stageMarkCount(s).have >= 6; } },
    { id: 'flag-white', text: '도전 훈장 6개', has: function (s) { return medalCount(s) >= 6; } },
    { id: 'flag-black', text: '지역 휘장 1개', has: function (s) { return badgeCount(s) >= 1; } },
    { id: 'flag-pink',  text: '도전 훈장 8개', has: function (s) { return medalCount(s) >= 8; } }
  ];
  /** 조건을 채운 깃발을 준다. 새로 받은 것의 이름들을 돌려준다. */
  function grantFlags(state) {
    var got = [];
    FLAG_REWARDS.forEach(function (f) { if (!state.cosmetics[f.id] && f.has(state)) { state.cosmetics[f.id] = true; got.push(findById(COSMETICS, f.id).name); } });
    return got;
  }
  function gachaPool() { return COSMETICS.filter(function (c) { return !c.base && !c.reward; }); }      // 기본 외형과 확정 보상(깃발)은 뽑기에 없다
  /** 화면에 적는 확률표 [{ id, name, slot, rarity, pct }]. pct 는 백분율(합계 100). 추첨도 이 표를 쓴다. */
  function gachaTable() {
    var pool = gachaPool(), count = [0, 0, 0];
    pool.forEach(function (c) { count[c.rarity]++; });
    return pool.map(function (c) { return { id: c.id, name: c.name, slot: c.slot, rarity: c.rarity, pct: GACHA_ODDS[c.rarity] / count[c.rarity] * 100 }; });
  }
  function ownsCosmetic(state, id) { var c = findById(COSMETICS, id); return !!c && (!!c.base || !!(state.cosmetics && state.cosmetics[id])); }
  function gachaPityLeft(state) { return Math.max(1, GACHA_PITY - (state.gachaPity || 0)); }
  /** 뽑기권 한 장으로 하나를 뽑는다. { ok, item, rarity, dup, shards(중복으로 받은 조각), pity(보장으로 나왔는가) } */
  function pullGacha(state, rng) {
    if (!(state.tickets >= 1)) return fail('tickets');
    rng = typeof rng === 'function' ? rng : Math.random;
    var table = gachaTable(), forced = (state.gachaPity || 0) + 1 >= GACHA_PITY, pick = null;
    if (forced) { var legends = table.filter(function (t) { return t.rarity === 2; }); pick = legends[Math.floor(rng() * legends.length) % legends.length]; }
    else { var roll = rng() * 100, acc = 0; for (var i = 0; i < table.length; i++) { acc += table[i].pct; if (roll < acc) { pick = table[i]; break; } } if (!pick) pick = table[table.length - 1]; }
    state.tickets -= 1;
    state.gachaPulls = Math.min(1e9, (state.gachaPulls || 0) + 1);
    state.gachaPity = pick.rarity === 2 ? 0 : (state.gachaPity || 0) + 1;
    var dup = ownsCosmetic(state, pick.id), shards = 0;
    if (dup) { shards = SHARDS_DUP[pick.rarity]; state.shards = Math.min(1e9, (state.shards || 0) + shards); }
    else state.cosmetics[pick.id] = true;
    return { ok: true, id: pick.id, name: pick.name, slot: pick.slot, rarity: pick.rarity, dup: dup, shards: shards, pity: forced };
  }
  /** 간식으로 뽑기권을 한 장 산다. */
  function buyTicket(state) {
    if (!(state.treats >= TICKET_TREATS)) return fail('treats');
    state.treats -= TICKET_TREATS; state.tickets = Math.min(1e9, (state.tickets || 0) + 1);
    return { ok: true };
  }
  function addTickets(state, n) { if (n > 0) state.tickets = Math.min(1e9, (state.tickets || 0) + n); return n; }
  /** 조각으로 아직 없는 외형을 골라 얻는다. */
  function craftCosmetic(state, id) {
    var c = findById(COSMETICS, id);
    if (!c) return fail('unknown');
    if (ownsCosmetic(state, id)) return fail('owned');
    var cost = SHARDS_COST[c.rarity];
    if (!(state.shards >= cost)) return fail('shards');
    state.shards -= cost; state.cosmetics[id] = true;
    return { ok: true, id: id, name: c.name, cost: cost };
  }
  function wearCosmetic(state, id) {
    var c = findById(COSMETICS, id);
    if (!c) return fail('unknown');
    if (!ownsCosmetic(state, id)) return fail('locked');
    state.wear[c.slot] = id;
    return { ok: true, id: id, slot: c.slot };
  }
  /** 지금 입은 외형의 색 { coat: { y, j }, flag: '#…' }. 잘못된 값이면 기본. */
  function cosmeticLook(state) {
    var out = {};
    COS_SLOTS.forEach(function (slot) { var id = state.wear && state.wear[slot], c = id && ownsCosmetic(state, id) ? findById(COSMETICS, id) : null; out[slot] = (c && c.slot === slot ? c : findById(COSMETICS, COS_BASE[slot])).look; });
    return out;
  }

  /*
   * ---------- 원정(1.8.0) ----------
   * 본 게임과 따로 도는 짧은 판. 지역마다 스테이지가 이어지고, 스테이지마다 규칙·목표·제한 시간이 있다.
   *   구조   : 스테이지는 "새 상태 하나"다. createStage 가 빈 거점을 만들고 state.stage = { id, hard } 를 단다.
   *            화면은 이 상태를 평소처럼 굴리고(tick), 끝나면 finishStage 로 본 게임 상태에 결과만 적는다. 본 게임 상태는 그동안 건드리지 않는다.
   *   규칙   : 도전과 같은 조건 이름을 쓴다(challengeOn 이 stage 도 본다). 그 밖에 tap5(직접 수색 5배).
   *   공정함 : 특성·업적·훈장을 들고 가지 않는다. 누구에게나 같은 난이도다. 읽은 일지와 도감만 옮겨서 같은 알림이 다시 뜨지 않게 한다.
   *   표시   : 클리어 / 스피드(speed 초 안에) / 하드(규칙 하나를 더 얹어서). 처음 얻을 때마다 간식을 받는다.
   *   열림   : 본 게임에서 3구역에 닿은 뒤(STAGE_OPEN_ZONE). 스테이지는 앞의 것을 클리어해야 다음이 열린다.
   *   시간   : 스테이지의 시간은 접속해 있을 때만 흐른다(자리 비움 정산을 하지 않는다).
   */
  var STAGE_OPEN_ZONE = 2, STAGE_TREATS = { clear: 5, speed: 5, hard: 10 }, TAP5 = 5, BOSS_BADGE_LOOT = 1.1;
  var STAGE_GOALS = {
    earn:   { text: function (n) { return '누적 물자 ' + formatNumber(n); },  value: function (s) { return s.runEarned; } },
    build:  { text: function (n) { return '시설 ' + n + '채'; },              value: function (s) { return totalBuildings(s); } },
    nights: { text: function (n) { return '밤 ' + n + '번 막기'; },           value: function (s) { return s.wavesCleared; } },
    sweep:  { text: function (n) { return '동네 ' + n + '곳 다 수색'; },      value: function (s) { return s.sweeps; } }
  };
  var STAGE_RULES = {
    tap5:    '직접 수색 5배',
    frugal:  '개조 금지',
    onewall: '방벽 한 종류만',
    horde:   '무리 3배',
    lean:    '전체 생산 절반'
  };
  var REGIONS = [ { id: 'r1', no: 1, name: '하류 마을' } ];
  var STAGES = [
    { id: 's1-1', region: 'r1', name: '첫 수색',      rules: ['tap5'],          goal: 'earn',   need: 5e6, limit: 480, speed: 300, hard: 'lean' },
    { id: 's1-2', region: 'r1', name: '빈 골목',      rules: [],                goal: 'sweep',  need: 40,  limit: 480, speed: 300, hard: 'frugal' },
    { id: 's1-3', region: 'r1', name: '급한 공사',    rules: ['frugal'],        goal: 'build',  need: 130, limit: 720, speed: 420, hard: 'lean' },
    { id: 's1-4', region: 'r1', name: '긴 밤',        rules: ['horde'],         goal: 'nights', need: 9,   limit: 720, speed: 600, hard: 'onewall' },
    { id: 's1-5', region: 'r1', name: '빠듯한 살림',  rules: ['lean'],          goal: 'earn',   need: 2e7, limit: 900, speed: 720, hard: 'horde' },
    { id: 's1-b', region: 'r1', name: '선착장의 무리', rules: ['horde', 'lean'], goal: 'nights', need: 10,  limit: 900, speed: 780, hard: 'onewall', boss: true }
  ];
  /** 이 상태가 스테이지이고 그 규칙이 걸려 있는가(끝난 뒤에도 규칙은 그대로다: 결과 창이 뜰 때까지 화면이 바뀌지 않게). */
  function stageRule(state, rule) {
    var st = state.stage; if (!st) return false;
    var def = findById(STAGES, st.id); if (!def) return false;
    return def.rules.indexOf(rule) >= 0 || (st.hard && def.hard === rule);
  }
  function stageDef(state) { return state.stage ? findById(STAGES, state.stage.id) : null; }
  function stageRuleTexts(def, hard) { var r = def.rules.map(function (k) { return STAGE_RULES[k]; }); if (hard) r.push(STAGE_RULES[def.hard]); return r; }
  function stageGoalText(def) { return STAGE_GOALS[def.goal].text(def.need); }
  /** 본 게임 상태에서: 원정이 열렸는가, 이 스테이지를 할 수 있는가. */
  function stagesOpen(main) { return Math.max(main.bestZone || 0, main.zone || 0) >= STAGE_OPEN_ZONE; }
  function stageMarks(main, id) { var m = main.stageMarks && main.stageMarks[id]; return { clear: !!(m && m.clear), speed: !!(m && m.speed), hard: !!(m && m.hard), best: m && m.best > 0 ? m.best : 0 }; }
  function stageBlock(main, id, hard) {
    var i = -1; STAGES.forEach(function (d, k) { if (d.id === id) i = k; });
    if (i < 0) return 'unknown';
    if (!stagesOpen(main)) return 'locked';
    if (i > 0 && STAGES[i - 1].region === STAGES[i].region && !stageMarks(main, STAGES[i - 1].id).clear) return 'prev';
    if (hard && !stageMarks(main, id).clear) return 'hard';      // 하드는 먼저 그냥 클리어한 뒤에
    return '';
  }
  /** 스테이지용 새 상태를 만든다. 본 게임 상태(main)는 바꾸지 않는다. 할 수 없으면 null. */
  function createStage(main, id, hard, now) {
    if (stageBlock(main, id, hard)) return null;
    var s = createState(now);
    s.stage = { id: id, hard: !!hard, won: false, lost: false, seconds: 0 };
    // 같은 알림이 다시 뜨지 않게 읽은 것만 옮긴다(복사본: 스테이지에서 바뀌어도 본 게임에 새지 않는다)
    s.story = JSON.parse(JSON.stringify(main.story || {})); s.ach = JSON.parse(JSON.stringify(main.ach || {})); s.zdex = JSON.parse(JSON.stringify(main.zdex || {}));
    s.heroName = main.heroName; s.heroGender = main.heroGender;
    return s;
  }
  /** 스테이지의 지금 형편 { def, value, need, left, won, lost, over }. 스테이지가 아니면 null. */
  function stageStatus(state) {
    var def = stageDef(state); if (!def) return null;
    var st = state.stage, v = STAGE_GOALS[def.goal].value(state);
    return { def: def, hard: !!st.hard, value: Math.min(v, def.need), need: def.need, left: Math.max(0, Math.ceil(def.limit - state.runSeconds)), won: !!st.won, lost: !!st.lost, over: !!(st.won || st.lost), seconds: st.seconds || 0 };
  }
  /** 시간마다 부른다: 목표를 채웠는지, 시간이 다 됐는지. 한 번 정해지면 바뀌지 않는다. */
  function checkStage(state, events) {
    var def = stageDef(state), st = state.stage;
    if (!def || st.won || st.lost) return;
    if (STAGE_GOALS[def.goal].value(state) >= def.need) { st.won = true; st.seconds = Math.ceil(state.runSeconds); events.push({ type: 'stage-won', id: def.id, name: def.name, seconds: st.seconds, speed: st.seconds <= def.speed, hard: !!st.hard }); }
    else if (state.runSeconds >= def.limit) { st.lost = true; st.seconds = def.limit; events.push({ type: 'stage-lost', id: def.id, name: def.name }); }
  }
  /**
   * 끝난 스테이지의 결과를 본 게임 상태에 적는다. 새로 얻은 표시마다 간식을 준다.
   * 돌려주는 값: { ok, won, got: ['clear'|'speed'|'hard'…] 새로 얻은 표시, treats, badge(보스를 처음 잡았는가) }
   */
  function finishStage(main, stage) {
    var stt = stageStatus(stage);
    if (!stt) return fail('none');
    if (!stt.won) return { ok: true, won: false, got: [], treats: 0, badge: false };
    if (!main.stageMarks) main.stageMarks = {};
    var m = main.stageMarks[stt.def.id] || (main.stageMarks[stt.def.id] = { clear: false, speed: false, hard: false, best: 0 }), got = [], treats = 0;
    function mark(k) { if (!m[k]) { m[k] = true; got.push(k); treats += STAGE_TREATS[k]; } }      // 새 표시 하나마다 간식과 뽑기권 한 장
    var badge = !!stt.def.boss && !m.clear;
    mark('clear');
    if (stt.seconds <= stt.def.speed) mark('speed');
    if (stt.hard) mark('hard');
    if (!(m.best > 0) || stt.seconds < m.best) m.best = stt.seconds;
    main.treats = Math.min(1e9, (main.treats || 0) + treats);
    var tickets = addTickets(main, got.length);
    var flags = grantFlags(main);
    return { ok: true, won: true, got: got, treats: treats, tickets: tickets, flags: flags, badge: badge, seconds: stt.seconds };
  }
  /** 얻은 표시의 수와 전체 수(지역 하나 또는 전부). */
  function stageMarkCount(main, region) {
    var have = 0, all = 0;
    STAGES.forEach(function (d) { if (region && d.region !== region) return; var m = stageMarks(main, d.id); all += 3; have += (m.clear ? 1 : 0) + (m.speed ? 1 : 0) + (m.hard ? 1 : 0); });
    return { have: have, all: all };
  }
  /** 보스를 잡은 지역의 수: 지역 휘장. 하나마다 방어 성공 시 전리품이 BOSS_BADGE_LOOT 배. */
  function badgeCount(main) { var n = 0; STAGES.forEach(function (d) { if (d.boss && stageMarks(main, d.id).clear) n++; }); return n; }
  function activeChallenge(state) { var c = state.challenge; return c && !c.failed && !c.done ? findById(CHALLENGES, c.id) : null; }
  function medalCount(state) { var n = 0; CHALLENGES.forEach(function (d) { if (state.medals && state.medals[d.id] > 0) n++; }); return n; }
  function medalMult(state) { return 1 + MEDAL_BONUS * medalCount(state); }
  /** 다음 회차의 도전을 정한다. 빈 글이면 도전 없이. */
  function setNextChallenge(state, id) {
    if (!id) { state.nextChallenge = ''; return { ok: true, id: '' }; }
    if (!findById(CHALLENGES, id)) return fail('unknown');
    if (!challengeOpen(state, id)) return fail('locked');
    state.nextChallenge = id;
    return { ok: true, id: id };
  }
  /*
   * 회차 도중에 도전을 켠다(1.7.0). 아무 때나 켤 수 있으면 목표 문 앞에서 켜고 훈장을 그냥 받으므로:
   *   - 2구역 문을 열기 전(1구역)에만 켤 수 있다.
   *   - 한 회차에 한 번만. 성공했든 실패했든 포기했든 그 회차에는 다시 켤 수 없다.
   *   - 그 도전이 막는 것을 이미 했으면 켤 수 없다(개조를 사 놓고 '맨몸'을 켜는 식).
   * 돌려주는 실패 이유: unknown, locked(목표 구역에 닿아 본 적 없음), used(이번 회차에 이미 썼음), late(2구역을 열었음), broken(이미 조건을 어겼음)
   */
  function challengeBlock(state, id) {
    var def = findById(CHALLENGES, id);
    if (!def) return 'unknown';
    if (!challengeOpen(state, id)) return 'locked';
    if (state.challenge) return 'used';
    if (state.zone > 0) return 'late';
    var ups = 0, autos = 0, walls = 0;
    UPGRADES.forEach(function (u) { var n = state.upgrades[u.id] || 0; ups += n; if (AUTO_KEYS.indexOf(u.key) >= 0) autos += n; });
    DEFENSES.forEach(function (d) { if (state.defenses[d.id] > 0) walls++; });
    if ((id === 'frugal' && ups > 0) || (id === 'hands' && autos > 0) || (id === 'onewall' && walls > 1) || (id === 'unbroken' && state.breaches > 0) || (id === 'sprint' && state.runSeconds > SPRINT_SECONDS)) return 'broken';
    return '';
  }
  function startChallenge(state, id) {
    var why = challengeBlock(state, id);
    if (why) return fail(why);
    state.challenge = { id: id, failed: false, done: false };
    return { ok: true, id: id };
  }
  /** 도전을 포기한다. 조건이 풀리고 회차는 그대로 이어진다. 연속 성공은 끊긴다. */
  function quitChallenge(state) {
    var def = activeChallenge(state);
    if (!def) return fail('none');
    state.challenge.failed = true; state.challenge.told = true; state.challengeStreak = 0;
    return { ok: true, id: def.id, name: def.name };
  }
  /** 연속 성공에 따라 더 받는 간식: 한 번마다 +STREAK_TREATS, STREAK_TREATS_MAX 까지. */
  var STREAK_TREATS = 2, STREAK_TREATS_MAX = 10;
  function streakTreats(state) { return Math.min(STREAK_TREATS_MAX, (state.challengeStreak || 0) * STREAK_TREATS); }
  function failChallenge(state, events, why) {
    var def = activeChallenge(state);
    if (!def) return;
    state.challenge.failed = true; state.challenge.told = true; state.challengeStreak = 0;
    if (events) events.push({ type: 'challenge-failed', id: def.id, name: def.name, why: why });
  }
  /** 시간마다 부른다: 시간 제한을 넘겼는지, 목표에 닿았는지 본다. */
  function checkChallenge(state, events) {
    var def = activeChallenge(state);
    if (!def) return;
    var reached = def.goal === 'end' ? !!state.endedRun : state.zone >= def.goal;
    if (!reached) { if (def.id === 'sprint' && state.runSeconds > SPRINT_SECONDS) failChallenge(state, events, 'time'); return; }
    var first = !(state.medals[def.id] > 0), treats = (first ? CHALLENGE_TREATS : CHALLENGE_TREATS_AGAIN) + streakTreats(state);      // 연속으로 성공할수록 간식을 더 받는다
    state.challengeStreak = Math.min(1e6, (state.challengeStreak || 0) + 1);
    state.challenge.done = true;
    state.medals[def.id] = Math.min(1e6, (state.medals[def.id] || 0) + 1);
    state.treats = Math.min(1e9, state.treats + treats);
    var tk = addTickets(state, first ? 3 : 1), flags = grantFlags(state);
    events.push({ type: 'challenge-done', id: def.id, name: def.name, first: first, treats: treats, tickets: tk, flags: flags, medals: medalCount(state) });
  }
  function retreat(state, now, rng) {
    if (!canRetreat(state)) return fail('not-ready');
    var gained = antibodiesOnRetreat(state), next = createState(now);
    next.goalPick = rollGoalPick(state.goalPick, rng);      // 다음 회차의 목표는 이번과 다르게
    next.medals = state.medals || {};      // 훈장은 남는다
    next.stageMarks = state.stageMarks || {};      // 원정에서 얻은 표시도 남는다
    next.tickets = state.tickets || 0; next.shards = state.shards || 0; next.cosmetics = state.cosmetics || {}; next.wear = state.wear || next.wear; next.gachaPity = state.gachaPity || 0; next.gachaPulls = state.gachaPulls || 0;      // 뽑기와 외형도 남는다
    next.challengeStreak = activeChallenge(state) ? 0 : (state.challengeStreak || 0);      // 도전을 달고 철수하면 포기한 것으로 친다
    next.bestZone = Math.max(state.bestZone, state.zone);
    if (state.nextChallenge && challengeOpen(next, state.nextChallenge)) next.challenge = { id: state.nextChallenge, failed: false, done: false };      // 골라 둔 도전으로 시작한다(한 번만)
    next.antibodies = state.antibodies + gained;
    next.antibodyTotal = state.antibodyTotal + gained;
    TRAITS.forEach(function (t) { next.traits[t.id] = state.traits[t.id]; });
    next.retreats = state.retreats + 1;
    next.pet = state.pet; next.kennel = state.kennel; next.treats = state.treats; next.petLv = state.petLv; next.heroName = state.heroName; next.heroGender = state.heroGender;      // 동물 친구와 이름은 함께 간다
    next.bestZone = Math.max(state.bestZone, state.zone);
    next.story = state.story;
    checkAchievements(state, null);      // 철수하는 순간까지 채운 것은 달성으로 쳐 준다
    next.ach = state.ach; next.zdex = state.zdex; next.regulars = state.regulars; next.clients = state.clients; next.cargos = state.cargos; next.sellPeak = !!state.sellPeak; next.autoOff = state.autoOff;      // 흥정꾼의 고점 판매 설정은 취향이라 철수해도 남는다
    next.records = state.records; next.passers = state.passers; next.ended = state.ended; next.endedAt = state.endedAt;
    next.lifetimeEarned = state.lifetimeEarned;
    next.clicks = state.clicks;
    next.signalsAnswered = state.signalsAnswered;
    next.startedAt = state.startedAt; next.playSeconds = state.playSeconds; next.awaySeconds = state.awaySeconds;
    next.runLog = state.runLog.concat([{ zone: state.gate ? state.zone + 1 : state.zone, seconds: state.runSeconds, antibodies: gained }]).slice(-10);
    next.supplies = startSupplies(next);
    return { ok: true, state: next, gained: gained };
  }
  /** 선발대 특성: 철수 뒤 들고 시작하는 물자(레벨 1 = 1,000, 레벨마다 10배). */
  function startSupplies(state) { var lv = state.traits.pioneer || 0; return lv ? 100 * Math.pow(10, lv) : 0; }
  function traitCost(state, id) {
    var def = findById(TRAITS, id);
    if (!def || state.traits[id] >= def.max) return Infinity;
    return Math.ceil(def.baseCost * Math.pow(def.growth, state.traits[id]));
  }
  function buyTrait(state, id) {
    var def = findById(TRAITS, id);
    if (!def) return fail('unknown');
    var cost = traitCost(state, id);
    if (!isFinite(cost)) return fail('max');
    if (cost > state.antibodies) return fail('antibodies');
    state.antibodies -= cost;
    state.traits[id]++;
    return { ok: true, cost: cost, level: state.traits[id] };
  }
  /** 특성에 쓴 항체 샘플의 합. */
  function traitsSpent(state) {
    var sum = 0;
    TRAITS.forEach(function (t) { for (var lv = 0; lv < state.traits[t.id]; lv++) sum += Math.ceil(t.baseCost * Math.pow(t.growth, lv)); });
    return sum;
  }
  /** 특성을 모두 되돌리고 쓴 샘플을 돌려받는다. 다시 찍는 데 드는 값은 없다. */
  function resetTraits(state) {
    var back = traitsSpent(state);
    if (!back) return fail('none');
    TRAITS.forEach(function (t) { state.traits[t.id] = 0; });
    state.antibodies += back;
    return { ok: true, refunded: back };
  }

  /* ---------- 이야기 ---------- */
  /*
   * 일지: 조건이 맞으면 한 번씩 열린다. 읽은 일지는 철수해도 다시 뜨지 않는다.
   *   구역 일지 3편: 구역에 들어설 때 / 목표 둘 / 목표 셋. 그 밖에 첫 철수와 '문 앞' 일지.
   */
  /** 마지막 글자에 받침이 있는가(한글이 아니면 false). */
  /**
   * 개조·특성·특전의 "지금까지 쌓인 효과"를 글로 돌려준다(1.3.0). 설명 끝의 수치(+25%, -4%, +0.5, +3%p)를 레벨만큼 쌓아 바꿔 적는다.
   *   더하는 것(+N%, +N%p, +N)은 레벨 × N.  깎는 것(-N%)은 mods 와 같이 곱으로 쌓인다: 1 - (1 - N/100)^레벨.
   *   설명이 수치로 끝나지 않는 것(순찰조, 자동 신호 등)과 레벨 0 은 빈 글.
   *   예) effectNow({ desc: '상품 값 +25%' }, 3) → '상품 값 +75%'
   */
  function effectNow(def, lv) {
    lv = Math.floor(lv);
    if (!def || typeof def.desc !== 'string' || !(lv >= 1)) return '';
    var m = /([+-])(\d+(?:\.\d+)?)(%p|%|)$/.exec(def.desc);
    if (!m) return '';
    var n = Number(m[2]), total = m[1] === '-' && m[3] === '%' ? (1 - Math.pow(1 - n / 100, lv)) * 100 : n * lv;
    var shown = String(Math.round(total * 10) / 10);
    return def.desc.slice(0, m.index) + m[1] + shown + m[3];
  }
  function hasBatchim(word) {
    var w = String(word || ''), c = w.charCodeAt(w.length - 1);
    // 숫자로 끝나면 읽는 소리로 따진다(1.2.4): 0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔 은 받침이 있고 2·4·5·9 는 없다. "1,250을", "1.2조를"
    if (c >= 48 && c <= 57) return '013678'.indexOf(w[w.length - 1]) >= 0;
    return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
  }
  /**
   * 일지 글의 이름 자리를 채운다. {hero} 는 이름 그대로, {hero:야}·{hero:은}·{hero:을}·{hero:이} 는 받침에 맞는 조사를 붙인다.
   *   라라 → 라라야, 라라는, 라라를, 라라가 / 민준 → 민준아, 민준은, 민준을, 민준이.  이름이 비면 기본 이름을 쓴다.
   */
  var JOSA = { '야': ['아', '야'], '은': ['은', '는'], '을': ['을', '를'], '이': ['이', '가'] };
  /*
   * 주인공의 성별에 따라 달라지는 호칭. 'none'(설정 안 함)이면 어느 쪽으로 읽어도 되는 말을 쓴다.
   *   student 고등학생(남자), driver 기관사(여자), child 엄마가 주인공을 가리키는 말, sib 쌍둥이가 주인공을 부르는 말(none 이면 이름)
   */
  var GENDERS = ['none', 'm', 'f'];
  var CALLS = {
    student: { none: '고등학생', m: '고등학생 형', f: '고등학생 오빠' },
    driver:  { none: '기관사',   m: '기관사 누나', f: '기관사 언니' },
    child:   { none: '내 아이',  m: '내 아들',     f: '내 딸' },
    sib:     { none: null,       m: '오빠',        f: '언니' }
  };
  /**
   * 일지 글의 자리를 채운다. {hero} 는 주인공 이름, {student}·{driver}·{child}·{sib} 는 성별에 맞는 호칭(CALLS).
   *   자리 뒤에 :야 :은 :을 :이 를 붙이면 받침에 맞는 조사가 따라온다(라라야 / 민준아, 형이 / 오빠가).
   *   이름이 비면 기본 이름, 모르는 성별이면 '설정 안 함', 모르는 자리는 주인공 이름으로 채운다.
   */
  function fillStory(text, name, gender) {
    var hero = typeof name === 'string' && name.trim() ? name.trim() : HERO_DEFAULT;
    var g = GENDERS.indexOf(gender) >= 0 ? gender : 'none';
    return String(text == null ? '' : text).replace(/\{([a-z]+)(?::(.))?\}/g, function (all, key, josa) {
      var word = Object.prototype.hasOwnProperty.call(CALLS, key) ? (CALLS[key][g] || hero) : hero;
      var pair = josa ? JOSA[josa] : null;
      return pair ? word + (hasBatchim(word) ? pair[0] : pair[1]) : word;
    });
  }
  function setHeroGender(state, gender) {
    if (GENDERS.indexOf(gender) < 0) return fail('unknown');
    state.heroGender = gender;
    return { ok: true, gender: gender };
  }
  var BEATS = [];
  ZONES.forEach(function (z, zi) {
    z.story.forEach(function (ep, k) {
      var text = ep.text.join('\n\n');
      // 아직 없는 구역의 글은 '문 앞'(gate-번호)이다. 나중에 그 구역이 열려도 들어설 때의 일지(z번호-0)와 겹치지 않는다.
      BEATS.push({ id: (z.kind === 'soon' ? 'gate-' + z.no : 'z' + z.no + '-' + k), zone: z.no, zoneName: z.name, title: ep.title, part: k + 1, text: text, when: function (s) {
        if (ZONES[zi].kind === 'soon') return s.gate && s.zone === zi - 1;          // 아직 없는 구역: 문 앞에 닿았을 때
        if (s.zone < zi) return false;
        var done = activeGoals(s, zi).filter(function (g) { return !!s.goalsDone[g.id]; }).length;
        return k === 0 || (k === 1 && done >= 2) || (k === 2 && done >= 3);
      } });
    });
  });
  BEATS.push({ id: 'retreat-1', zone: 1, zoneName: '주택가', title: "다시, 1구역", part: 4,
    text: [
      "거점을 버렸다. 등 뒤에서 방벽이 무너지는 소리가 났다. 아저씨가 쌍둥이를 하나씩 옆구리에 끼고 뛰었다. 나는 냉장 상자만 안고 뛰었다.",
      "손에 남은 것은 파란 상자 하나뿐이다. 쌓아 둔 것도, 고쳐 놓은 것도 전부 저 뒤에 있다.",
      "그런데 이상하다. 무섭지가 않다. 어디에 뭐가 있는지 안다. 어느 집 지붕이 튼튼한지, 어느 골목이 막혔는지, 밤이면 어디서부터 소리가 나는지.",
      "아저씨가 숨을 고르며 말했다. “집은 무너져도 짓는 법은 안 무너진다.” 그러고는 분필을 꺼내 첫 번째 문에 썼다. “쓰고 채워 놓을 것.”",
      "다시 1구역이다. 하지만 이번에는 무엇을 먼저 해야 하는지 안다."].join('\n\n'),
    when: function (s) { return s.retreats >= 1; } });
  function checkStory(state, events) {
    BEATS.forEach(function (b) {
      if (state.story[b.id]) return;
      var hit = false;
      try { hit = !!b.when(state); } catch (e) { hit = false; }
      if (!hit) return;
      state.story[b.id] = true;
      events.push({ type: 'story', id: b.id, zone: b.zone, zoneName: b.zoneName, title: b.title, text: fillStory(b.text, state.heroName, state.heroGender) });
    });
  }

  /* ---------- 알림(웹 앱용) ---------- */
  /*
   * 아이폰처럼 홈 화면에 추가한 웹 앱에 보내는 알림의 시각과 문구. 안드로이드 앱의 규칙(android 의 Notices.java)과 같게 맞춘다.
   *   NOTICE_FULL_MS(4시간) 뒤 "창고가 가득 찼어요", NOTICE_BACK_MS(24시간) 뒤 네 문구 가운데 하나(차례로 돈다).
   *   밤 10시 ~ 아침 8시에 걸리면 아침 8시로 미룬다. 시각은 기기의 현지 시각을 따른다.
   */
  var NOTICE_FULL_MS = 4 * 3600 * 1000, NOTICE_BACK_MS = 24 * 3600 * 1000, NOTICE_QUIET_FROM = 22, NOTICE_QUIET_TO = 8;
  var NOTICE_FULL_TEXT = '창고가 가득 찼어요. 물자를 가져가세요.';
  /** now(ms)부터 delay 뒤에 울릴 시각. 조용한 시간에 걸리면 다음 아침 8시. hourOf 는 시각 → 현지 시(0~23)를 주는 함수(테스트용, 없으면 기기 시각). */
  function noticeAt(now, delay, hourOf) {
    var at = now + Math.max(0, safeNum(delay, 0));
    var d = new Date(at), hour = typeof hourOf === 'function' ? hourOf(at) : d.getHours();
    if (!(hour >= NOTICE_QUIET_FROM || hour < NOTICE_QUIET_TO)) return at;
    // 그날(또는 다음 날)의 아침 8시까지 남은 시간을 더한다
    var into = d.getMinutes() * 60000 + d.getSeconds() * 1000 + d.getMilliseconds();
    var hoursLeft = hour >= NOTICE_QUIET_FROM ? 24 - hour + NOTICE_QUIET_TO : NOTICE_QUIET_TO - hour;
    return at + hoursLeft * 3600000 - into;
  }
  /** 오래 비웠을 때의 문구. index 는 지금까지 보낸 횟수(네 가지가 차례로 돈다). 친구가 없으면 세 번째 대신 두 번째를 쓴다. */
  function noticeBackText(state, index) {
    var k = ((Math.floor(safeNum(index, 0)) % 4) + 4) % 4, pet = petInfo(state), hero = state.heroName || HERO_DEFAULT;
    if (k === 0) return '여기는 7구역. ' + hero + ', 들리면 응답하라.';
    if (k === 2 && pet) return pet.name + (hasBatchim(pet.name) ? '이' : '가') + ' 문 앞에서 기다리고 있어요.';
    if (k === 3) return '방벽 너머가 시끄러워요. 한번 봐 주세요.';
    return '무전기가 하루째 조용해요.';
  }
  /** 지금 게임을 닫는다면 맡길 알림 목록 [{ at, text, kind }]. */
  function noticePlan(state, now, index, hourOf) {
    return [
      { at: noticeAt(now, NOTICE_FULL_MS, hourOf), text: NOTICE_FULL_TEXT, kind: 'full' },
      { at: noticeAt(now, NOTICE_BACK_MS, hourOf), text: noticeBackText(state, index), kind: 'back' }
    ];
  }
  /* ---------- 업적 ---------- */
  /*
   * 업적: 구역마다 15개, 공통 30개(모두 120개(1.0.5: 6구역 15개를 더했다)). 한 번 달성하면 철수해도 남는다.
   *   묶음(series) 하나가 문턱(needs)마다 업적 하나씩이 된다: '좌판 주인 Ⅰ~Ⅳ' 처럼 쉬운 것부터 아주 어려운 것까지.
   *   group : 'all'(공통) 또는 'z1'~'z5',  value(state) : 지금의 값,  text(need) : 조건을 적은 글
   *   tier  : 1 쉬움, 2 되풀이, 3 어려움, 4 아주 어려움 (묶음 안에서의 차례로 정한다. 문턱이 하나뿐인 묶음은 tier 를 따로 적는다)
   * 달성한 업적 하나마다 전체 생산이 ACH_BONUS(0.5%)씩 늘어난다.
   */
  var ACH_BONUS = 0.005;
  function sumOf(obj) { var n = 0; for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] > 0) n += obj[k]; return n; }
  function zoneUpgrades(s, zone) { var n = 0; UPGRADES.forEach(function (u) { if (u.zone === zone) n += s.upgrades[u.id] || 0; }); return n; }
  function maxOf(obj) { var m = 0; for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] > m) m = obj[k]; return m; }
  function minMachine(s) { var m = Infinity; MACHINES.forEach(function (d) { m = Math.min(m, s.machines[d.id] || 0); }); return isFinite(m) ? m : 0; }
  function storyRead(s) { var n = 0; BEATS.forEach(function (b) { if (s.story[b.id]) n++; }); return n; }
  function defenseKinds(s) { var n = 0; DEFENSES.forEach(function (d) { if (s.defenses[d.id] > 0) n++; }); return n; }
  var ACH_SERIES = [
    // 1구역 주택가
    { id: 'z1build', group: 'z1', name: '동네 일꾼', needs: [10, 100, 500, 2000], value: function (s) { return totalBuildings(s); }, text: function (n) { return '1구역 시설을 모두 합쳐 ' + n + '곳 짓기'; } },
    { id: 'z1sweep', group: 'z1', name: '골목 대장', needs: [1, 10, 100, 1000], value: function (s) { return s.sweeps; }, text: function (n) { return '한 회차에 동네 ' + n + '곳을 다 수색하기'; } },
    { id: 'z1click', group: 'z1', name: '부지런한 손', needs: [100, 1000, 10000], value: function (s) { return s.clicks; }, text: function (n) { return '잔해 수색을 ' + n + '번 누르기'; } },
    { id: 'z1up', group: 'z1', name: '살림꾼', needs: [10, 40], value: function (s) { return zoneUpgrades(s, 0); }, text: function (n) { return '1구역 개조를 모두 합쳐 ' + n + '번 하기'; } },
    { id: 'z1patrol', group: 'z1', name: '빈틈없는 순찰', tier: 3, needs: [5], value: function (s) { return s.upgrades.patrol; }, text: function () { return '순찰조를 끝까지 올리기'; } },
    { id: 'z1rumor', group: 'z1', name: '소문난 동네', tier: 3, needs: [8], value: function (s) { return s.upgrades.rumor; }, text: function () { return '소문을 끝까지 올리기'; } },
    // 2구역 재래시장
    { id: 'z2stall', group: 'z2', name: '좌판 주인', needs: [10, 100, 300, 500], value: function (s) { return s.stalls; }, text: function (n) { return '좌판 ' + n + '곳 열기'; } },
    { id: 'z2earn', group: 'z2', name: '큰손', needs: [1e8, 1e11, 1e14], value: function (s) { return s.tradeEarned; }, text: function (n) { return '한 회차에 상품을 팔아 물자 ' + formatNumber(n) + ' 벌기'; } },
    { id: 'z2peak', group: 'z2', name: '고점 사냥꾼', needs: [10, 100, 1000], value: function (s) { return s.peakSales; }, text: function (n) { return '한 회차에 고점에서 ' + n + '번 팔기'; } },
    { id: 'z2streak', group: 'z2', name: '연속 호가', tier: 2, needs: [STREAK_MAX], value: function (s) { return s.streak; }, text: function () { return '연속 호가를 끝까지 쌓기'; } },
    { id: 'z2hand', group: 'z2', name: '북적이는 시장', needs: [20, 150], value: function (s) { return sumOf(s.hands); }, text: function (n) { return '짐꾼과 호객꾼을 합쳐 ' + n + '명 두기'; } },
    { id: 'z2broker', group: 'z2', name: '믿음직한 흥정꾼', needs: [1, 5], value: function (s) { return s.upgrades.broker; }, text: function (n) { return n === 1 ? '흥정꾼 두기' : '흥정꾼을 끝까지 올리기'; } },
    // 3구역 공단
    { id: 'z3level', group: 'z3', name: '기계공', needs: [10, 50, 150, 300], value: function (s) { return sumOf(s.machines); }, text: function (n) { return '기계 레벨의 합계 ' + n + ' 채우기'; } },
    { id: 'z3earn', group: 'z3', name: '공장장', needs: [1e13, 1e16, 1e19], value: function (s) { return s.lineEarned; }, text: function (n) { return '한 회차에 라인으로 물자 ' + formatNumber(n) + ' 벌기'; } },
    { id: 'z3steady', group: 'z3', name: '정속 가동', needs: [60, 3600, 36000], value: function (s) { return s.steadySeconds; }, text: function (n) { return '한 회차에 정속 가동 ' + formatDuration(n) + ' 채우기'; } },
    { id: 'z3up', group: 'z3', name: '정비반', needs: [10, 40], value: function (s) { return zoneUpgrades(s, 2); }, text: function (n) { return '3구역 개조를 모두 합쳐 ' + n + '번 하기'; } },
    { id: 'z3auto', group: 'z3', name: '손을 뗀 공장', tier: 2, needs: [1], value: function (s) { return s.upgrades.autoline; }, text: function () { return '자동 제어반 달기'; } },
    { id: 'z3even', group: 'z3', name: '세 박자', tier: 3, needs: [50], value: function (s) { return minMachine(s); }, text: function (n) { return '기계 셋을 모두 ' + n + '레벨 이상으로 올리기'; } },
    { id: 'z3belt', group: 'z3', name: '끊기지 않는 벨트', tier: 4, needs: [10], value: function (s) { return s.upgrades.belt; }, text: function () { return '컨베이어를 끝까지 올리기'; } },
    // 4구역 환승역
    { id: 'z4train', group: 'z4', name: '차량 기지장', needs: [5, 20, 50, 100], value: function (s) { return s.trains; }, text: function (n) { return '열차 ' + n + '대 갖추기'; } },
    { id: 'z4earn', group: 'z4', name: '화물왕', needs: [1e20, 1e23, 1e26], value: function (s) { return s.railEarned; }, text: function (n) { return '한 회차에 화물로 물자 ' + formatNumber(n) + ' 벌기'; } },
    { id: 'z4express', group: 'z4', name: '심야 급행', needs: [1, 20, 200], value: function (s) { return s.expressRuns; }, text: function (n) { return '한 회차에 심야 급행을 ' + n + '번 맞이하기'; } },
    { id: 'z4route', group: 'z4', name: '선로 복구반', needs: [5, 20], value: function (s) { return sumOf(s.routes); }, text: function (n) { return '노선 단계를 모두 합쳐 ' + n + ' 올리기'; } },
    { id: 'z4up', group: 'z4', name: '역무원', needs: [10, 30], value: function (s) { return zoneUpgrades(s, 3); }, text: function (n) { return '4구역 개조를 모두 합쳐 ' + n + '번 하기'; } },
    { id: 'z4auto', group: 'z4', name: '알아서 켜지는 신호', tier: 2, needs: [1], value: function (s) { return s.upgrades.autosig; }, text: function () { return '자동 신호 달기'; } },
    // 5구역 대학 병원
    { id: 'z5staff', group: 'z5', name: '연구실장', needs: [5, 25, 100, 250], value: function (s) { return s.staff; }, text: function (n) { return '연구원 ' + n + '명 뽑기'; } },
    { id: 'z5done', group: 'z5', name: '끝낸 과제', needs: [1, 10, 30, 60], value: function (s) { return s.projectsDone; }, text: function (n) { return '한 회차에 과제 ' + n + '개 끝내기'; } },
    { id: 'z5points', group: 'z5', name: '쌓인 연구', needs: [1000, 1000000], value: function (s) { return s.points; }, text: function (n) { return '연구 점수 ' + formatNumber(n) + ' 모아 두기'; } },
    { id: 'z5up', group: 'z5', name: '실험 도구', needs: [10, 30], value: function (s) { return zoneUpgrades(s, 4); }, text: function (n) { return '5구역 개조를 모두 합쳐 ' + n + '번 하기'; } },
    { id: 'z5deep', group: 'z5', name: '한 우물', needs: [5, 10], value: function (s) { return maxOf(s.research); }, text: function (n) { return '같은 과제를 ' + n + '번 끝내기'; } },
    { id: 'z5gate', group: 'z5', name: '다리 앞에서', tier: 4, needs: [1], value: function (s) { return s.zone >= 5 ? 1 : 0; }, text: function () { return '6구역의 문 열기'; } },
    // 6구역 강변 검문소(1.0.5)
    { id: 'z6post', group: 'z6', name: '검문소장', needs: [5, 25, 100, 250], value: function (s) { return s.posts; }, text: function (n) { return '초소 ' + n + '곳 세우기'; } },
    { id: 'z6safe', group: 'z6', name: '넉넉한 밤', needs: [5, 15, 50, 150], value: function (s) { return s.safeNights; }, text: function (n) { return '한 회차에 무리의 2배 방어력으로 밤 ' + n + '번 방어'; } },
    { id: 'z6earn', group: 'z6', name: '다리지기', needs: [1e32, 1e35, 1e38], value: function (s) { return s.guardEarned; }, text: function (n) { return '한 회차에 통행 물자 ' + formatNumber(n) + ' 벌기'; } },
    { id: 'z6up', group: 'z6', name: '검문 장비', needs: [10, 30], value: function (s) { return zoneUpgrades(s, 5); }, text: function (n) { return '6구역 개조를 모두 합쳐 ' + n + '번 하기'; } },
    { id: 'z6max', group: 'z6', name: '철통', tier: 3, needs: [1], value: function (s) { return s.zone >= 5 && s.posts > 0 && bridgeSafety(s) >= SAFETY_MAX + mods(s).margin ? 1 : 0; }, text: function () { return '다리 안전도를 끝까지 채우기'; } },
    { id: 'z6gate', group: 'z6', name: '송신탑 앞에서', tier: 4, needs: [1], value: function (s) { return s.zone >= 6 ? 1 : 0; }, text: function () { return '7구역의 문 열기'; } },
    // 7구역 송신탑(1.2.0)
    { id: 'z7ant', group: 'z7', name: '송신소장', needs: [5, 25, 100, 250], value: function (s) { return s.antennas; }, text: function (n) { return '안테나 ' + n + '기 세우기'; } },
    { id: 'z7crowd', group: 'z7', name: '모여든 사람들', needs: [1000, 1e5, 1e7, 1e9], value: function (s) { return s.survivors; }, text: function (n) { return '한 회차에 생존자 ' + formatNumber(n) + '명 모으기'; } },
    { id: 'z7serum', group: 'z7', name: '혈청', needs: [1, 2, 3], value: function (s) { return s.serumStage; }, text: function (n) { return '한 회차에 혈청 ' + n + '단계 끝내기'; } },
    { id: 'z7up', group: 'z7', name: '송신 장비', needs: [10, 30], value: function (s) { return zoneUpgrades(s, 6); }, text: function (n) { return '7구역 개조를 모두 합쳐 ' + n + '번 하기'; } },
    { id: 'z7end', group: 'z7', name: '7구역', tier: 4, needs: [1], value: function (s) { return s.ended; }, text: function () { return '이야기의 끝을 보기'; } },
    { id: 'z7again', group: 'z7', name: '다시, 7구역', tier: 4, needs: [3], value: function (s) { return s.ended; }, text: function (n) { return '이야기의 끝을 ' + n + '번 보기'; } },
    // 공통
    { id: 'night', group: 'all', name: '밤을 넘긴 사람', needs: [10, 50, 100, 300], value: function (s) { return s.wavesCleared; }, text: function (n) { return '한 회차에 방어 성공 ' + n + '번'; } },
    { id: 'retreat', group: 'all', name: '다시, 1구역', needs: [1, 5, 20, 50], value: function (s) { return s.retreats; }, text: function (n) { return '철수 ' + n + '번 하기'; } },
    { id: 'antibody', group: 'all', name: '항체 수집가', needs: [10, 100, 10000, 1000000], value: function (s) { return s.antibodyTotal; }, text: function (n) { return '항체 샘플을 모두 합쳐 ' + formatNumber(n) + '개 얻기'; } },
    { id: 'kennel', group: 'all', name: '동물 친구들', needs: [1, 6, 12, 24], value: function (s) { return kennelCount(s); }, text: function (n) { return '동물 친구 ' + n + '마리 만나기'; } },
    { id: 'petlv', group: 'all', name: '잘 먹고 잘 크는', needs: [5, 10], value: function (s) { return maxOf(s.petLv); }, text: function (n) { return '친구 하나를 ' + n + '레벨까지 키우기'; } },
    { id: 'story', group: 'all', name: '일지를 쓰는 아이', needs: [5, 10, 17], value: function (s) { return storyRead(s); }, text: function (n) { return '생존 일지 ' + n + '편 적기'; } },
    { id: 'reach', group: 'all', name: '더 멀리', needs: [1, 2, 3, 4], value: function (s) { return s.bestZone; }, text: function (n) { return (n + 1) + '구역 열기'; } },
    { id: 'time', group: 'all', name: '오래 버틴 거점', needs: [3600, 36000, 360000], value: function (s) { return s.playSeconds + s.awaySeconds; }, text: function (n) { return '진행 시간 ' + formatDuration(n) + ' 채우기'; } },
    { id: 'zdex', group: 'all', name: '좀비 박사', tier: 4, needs: [ZOMBIE_KINDS.length], value: function (s) { return zdexCount(s); }, text: function (n) { return '좀비 도감 ' + n + '종을 모두 채우기'; } },
    { id: 'arsenal', group: 'all', name: '빈틈없는 방벽', tier: 3, needs: [DEFENSES.length], value: function (s) { return defenseKinds(s); }, text: function () { return '방어 수단 여섯 가지를 모두 갖추기'; } }
  ];
  var ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ'];
  var ACH_RETREATS_HARD = 1, ACH_RETREATS_HARDEST = 3;      // 어려움 / 아주 어려움 업적에 필요한 철수 수
  var ACHIEVEMENTS = [];
  ACH_SERIES.forEach(function (sr) {
    sr.needs.forEach(function (need, k) {
      var a = { id: sr.id + '-' + (k + 1), group: sr.group, tier: sr.tier || Math.min(4, k + 1 + (sr.needs.length === 2 ? 1 : 0)),
        name: sr.name + (sr.needs.length > 1 ? ' ' + ROMAN[k] : ''), need: need, value: sr.value };
      // 철수의 도움 없이는 다 깰 수 없게 한다(1.0.7): 어려움은 철수 1번, 아주 어려움은 철수 3번을 한 뒤에야 달성된다.
      // 조건을 채워도 철수 수가 모자라면 잠겨 있고, 철수 수를 채운 뒤에 조건을 (다시) 채우면 달성된다
      a.retreats = a.tier >= 4 ? ACH_RETREATS_HARDEST : a.tier >= 3 ? ACH_RETREATS_HARD : 0;
      // 조건 글은 읽을 때 만든다: 숫자 표기(만·억 / 지수) 설정을 따라가야 하고, 이 자리에서는 아직 숫자 단위 표가 준비되지 않았다
      Object.defineProperty(a, 'text', { enumerable: true, get: function () { return sr.text(need); } });
      ACHIEVEMENTS.push(a);
    });
  });
  function achCount(state) { var n = 0; ACHIEVEMENTS.forEach(function (a) { if (state.ach[a.id]) n++; }); return n; }
  function achMult(state) { return 1 + ACH_BONUS * achCount(state); }
  /** 업적 하나의 진행 { value, need, done }. 값을 읽다 오류가 나면 0 으로 본다. */
  function achProgress(state, a) {
    var v = 0;
    try { v = a.value(state); } catch (e) { v = 0; }
    v = typeof v === 'number' && isFinite(v) && v > 0 ? v : 0;
    return { value: Math.min(v, a.need), need: a.need, done: !!state.ach[a.id], at: typeof state.ach[a.id] === 'number' ? state.ach[a.id] : 0,
      retreats: a.retreats || 0, locked: !state.ach[a.id] && (state.retreats || 0) < (a.retreats || 0) };
  }
  /** 조건을 채운 업적을 달성으로 바꾸고 'achievement' 사건을 남긴다. */
  function checkAchievements(state, events, now) {
    if (state.stage) return;      // 원정 스테이지에서는 업적을 세지 않는다(본 게임의 기록이 아니다)
    var at = typeof now === 'number' && isFinite(now) && now > 0 ? Math.floor(now) : Date.now();      // 달성한 시각을 적어 둔다
    ACHIEVEMENTS.forEach(function (a) {
      if (state.ach[a.id]) return;
      var p = achProgress(state, a);
      if (p.value >= a.need && !p.locked) { state.ach[a.id] = at; if (events) events.push({ type: 'achievement', id: a.id, name: a.name, text: a.text, group: a.group, tier: a.tier }); }
    });
  }

  /* ---------- 시간 진행 ---------- */
  var MAX_NIGHTS_PER_TICK = 600;
  /**
   * dt 초를 진행하고 그동안 일어난 일을 돌려준다.
   * 순서: 지원 효과 → 생산(1구역 시설, 3구역 라인) → 거래 → 열차 → 신호 → 밤 → 목표 → 이야기.
   */
  function tick(state, dt, rng) {
    var events = [];
    rng = typeof rng === 'function' ? rng : Math.random;
    if (!(typeof dt === 'number' && isFinite(dt) && dt > 0)) return events;
    state.playSeconds += dt; state.runSeconds += dt;

    // 지원 효과가 dt 도중에 끝나면 끝나기 전과 뒤를 나눠 계산한다
    var boosted = state.buff ? Math.min(dt, state.buff.left) : 0, line = 0;
    if (boosted > 0) { earn(state, searchRate(state) * boosted); line += lineRate(state) * boosted; }
    if (state.buff) { state.buff.left -= dt; if (state.buff.left <= 0) { state.buff = null; events.push({ type: 'buff-end' }); } }
    if (dt > boosted) { earn(state, searchRate(state) * (dt - boosted)); line += lineRate(state) * (dt - boosted); }
    // 전력 투입 중인 시간만큼은 라인이 SURGE_MULT 배로 돈다(dt 가 길어도 남은 투입 시간까지만 친다)
    if (line > 0 && state.surgeLeft > 0) line *= 1 + (SURGE_MULT - 1) * Math.min(dt, state.surgeLeft) / dt;
    line *= lineFactor(state);      // 품목 바꾸는 중(0), 고장(느림), 정비 직후(빠름)
    if (line > 0) { earn(state, line); state.lineEarned += line; if (lineInfo(state).steady) state.steadySeconds += dt; }
    stepContracts(state, dt, line > 0 ? line / productValue(state) : 0, rng, events);
    stepLineEvents(state, dt, rng, events);
    stepZoneEvents(state, dt, rng, events);
    // 자동 개조: 밤샘 연구, 순찰, 직접 방송을 준비되는 대로 알아서 누른다
    if (autoEvents(state, 4) && !(state.focusCool > 0) && focusLab(state).ok) events.push({ type: 'auto-push', id: 'lab' });
    PUSHES.forEach(function (d) { if (autoEvents(state, d.zone) && !(state.push[d.id].cool > 0) && pushZone(state, d.id).ok) events.push({ type: 'auto-push', id: d.id }); });      // 3구역 납품 의뢰: 이번 틱에 만든 완제품 수를 넘긴다
    if (state.zone >= 6) state.survivors = Math.min(1e15, (state.survivors || 0) + survivorRate(state) * dt * pushFactor(state, 'tower', dt));      // 7구역: 방송을 듣고 생존자가 모인다(직접 방송 중이면 더 빨리)
    var guard = guardRate(state) * dt * pushFactor(state, 'guard', dt);      // 6구역 통행 물자(순찰 중이면 더 많이)
    if (guard > 0) { earn(state, guard); state.guardEarned += guard; }
    var drug = labRate(state) * dt;      // 5구역 약품(1.5.9)
    if (drug > 0) earn(state, drug);
    if (state.surgeLeft > 0 || state.surgeCool > 0) {
      var wasOn = state.surgeLeft > 0;
      state.surgeLeft = Math.max(0, state.surgeLeft - dt); state.surgeCool = Math.max(0, state.surgeCool - dt);
      if (wasOn && !(state.surgeLeft > 0)) events.push({ type: 'surge-end' });
    }
    // 영구 특성 '자동화'가 있으면 준비되는 대로 알아서 투입한다
    if (autoOn(state, 2) && zoneOpen(state, 2) && !(state.surgeCool > 0) && surge(state).ok) events.push({ type: 'surge' });

    stepSweep(state, dt, events);
    stepRepair(state, dt);
    stepTrade(state, dt, rng, events);
    stepOrders(state, dt, rng, events);
    stepSalvage(state, dt, rng, events);
    stepRail(state, dt, events);
    if (state.greenCool > 0) state.greenCool = Math.max(0, state.greenCool - dt);
    if (autoOn(state, 3) && zoneOpen(state, 3) && !(state.greenCool > 0)) { var auto = greenSignal(state); if (auto.ok) { events.push({ type: 'green' }); auto.arrivals.forEach(function (e) { events.push(e); }); } }
    stepLab(state, dt, rng);

    if (state.signalLeft > 0) {
      state.signalLeft -= dt;
      if (state.signalLeft <= 0) { state.signalLeft = 0; events.push({ type: 'signal-missed' }); }
    } else {
      state.signalIn -= dt;
      if (state.signalIn <= 0) { state.signalLeft = SIGNAL_WINDOW; state.signalIn = SIGNAL_MIN + rng() * SIGNAL_SPREAD; events.push({ type: 'signal' }); }
    }

    var before = state.dayClock, arriveAt = DAY_SECONDS - BATTLE_SECONDS, guard = 0;
    state.dayClock += dt;
    while (state.dayClock >= DAY_SECONDS && guard++ < MAX_NIGHTS_PER_TICK) { state.dayClock -= DAY_SECONDS; before = 0; events.push(resolveNight(state, rng)); }
    if (before < arriveAt && state.dayClock >= arriveAt) {
      events.push({ type: 'arrive', strength: nightStrength(state), defense: defensePower(state), siege: state.siege, boss: isBossWave(currentWave(state)) });
    }

    checkGoals(state, rng, events);
    checkStory(state, events);
    state.achClock += dt;
    if (state.achClock >= 1) { state.achClock = 0; checkAchievements(state, events); }      // 업적은 1초에 한 번만 확인한다
    return events;
  }

  /* ---------- 자리 비움 ---------- */
  function offlineRate(state) { return (Math.min(1, OFFLINE_RATE + mods(state).offline)) * (challengeOn(state, 'hands') ? HANDS_AWAY : 1); }      // 도전 '손수': 자리를 비운 동안의 효율이 절반
  /**
   * 게임을 꺼 둔 동안의 진행. 최대 OFFLINE_CAP 초를 offlineRate 효율로 계산한다.
   * 2구역은 평균 시세로 판 것으로 친다. 3구역 라인은 나갈 때의 상태 그대로 돈 것으로 친다. 밤은 막을 수 있는 동안만 막고, 못 막는 밤부터는 잃는 것 없이 버틴다.
   */
  function applyOffline(state, elapsed) {
    elapsed = safeNum(elapsed, 0);
    var counted = Math.min(elapsed, OFFLINE_CAP), rate = offlineRate(state);
    var report = { elapsed: elapsed, counted: counted, capped: elapsed > OFFLINE_CAP, rate: rate, gain: 0, nights: 0, nightReward: 0, held: false, trains: 0, points: 0, treats: 0 };
    if (!(counted > 0)) return report;
    state.buff = null;
    state.signalLeft = 0;
    state.greenCool = Math.max(0, state.greenCool - elapsed);
    state.surgeLeft = 0; state.surgeCool = Math.max(0, state.surgeCool - elapsed);
    if (elapsed >= 60) { state.jam = null; state.truck = null; state.tuneLeft = 0; state.retool = 0; state.zev = { rail: null, guard: null, tower: null }; state.focusLeft = 0; PUSHES.forEach(function (d) { state.push[d.id].left = 0; }); }
    PUSHES.forEach(function (d) { state.push[d.id].cool = Math.max(0, state.push[d.id].cool - elapsed); });
    state.focusCool = Math.max(0, (state.focusCool || 0) - elapsed);      // 고장·트럭·정비는 접속해 있을 때만의 일이다(잠깐 새로 고친 정도로는 지우지 않는다)      // 전력 투입은 자리를 비우면 끝난 것으로 친다
    var trade = tradeRate(state) * counted * rate, line = lineRate(state) * counted * rate;
    report.gain = (searchRate(state) + sweepRate(state)) * counted * rate + trade + line;      // 순찰조는 자리를 비운 동안에도 돈다
    if (state.zone >= 6) state.survivors = Math.min(1e15, (state.survivors || 0) + survivorRate(state) * counted * rate);
    var guardAway = guardRate(state) * counted * rate;
    report.gain += guardAway + labRate(state) * counted * rate;      // 약품도 자리를 비운 동안 쌓인다
    earn(state, report.gain);
    state.tradeEarned += trade;
    state.lineEarned += line;
    state.guardEarned += guardAway;
    if (line > 0 && lineInfo(state).steady) state.steadySeconds += counted;     // 정속으로 맞춰 두고 나갔으면 그 시간도 친다
    // 4구역 열차: 자리를 비운 동안에도 다닌다. 돌아온 열차의 화물은 자리 비움 효율로 쳐서 받는다.
    var railEvents = [], before = state.supplies, earnedBefore = state.railEarned;
    stepRail(state, counted, railEvents);
    var railFull = state.railEarned - earnedBefore, cut = railFull * (1 - rate);
    if (cut > 0) { state.supplies -= cut; state.runEarned -= cut; state.lifetimeEarned -= cut; state.railEarned -= cut; }
    report.gain += state.supplies - before;
    report.trains = railEvents.length;
    // 5구역 연구: 점수도 자리 비움 효율로 모인다
    report.points = researchRate(state) * counted * rate;
    state.points += report.points;
    state.awaySeconds += counted; state.runSeconds += counted;
    var clock = state.dayClock + counted, nights = Math.floor(clock / DAY_SECONDS);
    state.dayClock = clock - nights * DAY_SECONDS;
    var owedBefore = state.perkOwed || 0;      // 자리를 비운 동안 막은 변이체의 특전은 하나만 쳐 준다(밤이 수백 번 지나가도 특전이 쌓이지 않게)
    for (var i = 0; i < nights; i++) {
      if (defensePower(state) < nightStrength(state)) { report.held = true; state.day += nights - i; break; }
      var ev = resolveNight(state);
      report.nights++; report.nightReward += ev.reward; report.treats += ev.treats || 0;
    }
    state.perkOwed = Math.min(state.perkOwed || 0, owedBefore + 1);
    return report;
  }

  /* ---------- 안내 ---------- */
  /** 화면의 '다음 할 일'에 보일 한 줄 { id, text, view }. view 는 그 일을 하는 화면('zone', 'wall', 'trait'). */
  function guide(state) {
    function g(id, text, view) { return { id: id, text: text, view: view || null }; }
    if (state.pendingPerks.length) return g('perk', '특전을 하나 골라 주세요.');
    if (state.clicks === 0 && state.supplies < 15) return g('click', '"잔해 수색"을 눌러 첫 물자를 모아 보세요.');
    if (!totalBuildings(state)) return g('scouts', '구역 > 1구역에서 잔해 수색조를 꾸려 보세요. 그때부터는 가만히 있어도 물자가 들어와요.', 'zone');
    // 선제 공격·반격을 쓸 수 있는데 오늘 밤을 못 막거나 변이체가 오는 밤이면 먼저 알려 준다(1.5.6)
    var tight = defensePower(state) < nightStrength(state) || isBossWave(currentWave(state));
    if (counterReady(state)) return g('counter', '반격할 수 있어요. 아래 오늘 밤 칸에서 누르면 오늘 밤 무리가 절반이 돼요.');
    if (strikeReady(state) && tight) return g('strike', '선제 공격을 할 수 있어요. 아래 오늘 밤 칸에서 누르면 오늘 밤 무리가 절반이 돼요.');
    if (!state.siege && defensePower(state) < nightStrength(state)) return g('defend', '방어력이 모자라요. 방벽을 보강해 주세요.', 'wall');
    if (state.antibodies > 0 && TRAITS.some(function (t) { return traitCost(state, t.id) <= state.antibodies; })) return g('trait', '쓸 수 있는 항체 샘플이 있어요. 특성을 찍어 보세요.', 'trait');
    var open = goals(state, state.zone).filter(function (x) { return !x.done; })[0];
    if (open) return g('goal', (state.zone + 1) + '구역 목표: ' + open.text + ' (' + formatNumber(open.value) + ' / ' + formatNumber(open.need) + ')', 'zone');
    var n = nextZone(state);
    if (n && !(n.soon && state.gate)) return g('open', n.zone.no + '구역 ' + n.zone.name + (n.enough ? '의 문을 열 수 있어요.' : '의 문은 이번 회차 누적 물자 ' + formatNumber(n.cost) + '에 열려요.'), 'zone');
    return g('retreat', '지금은 더 나아갈 곳이 없어요. 철수해서 항체 샘플을 챙기고, 더 강하게 다시 시작해 보세요.');
  }

  /* ---------- 통계 ---------- */
  function stats(state, now) {
    var started = state.startedAt > 0 && typeof now === 'number' && isFinite(now) && now >= state.startedAt;
    return { play: state.playSeconds, away: state.awaySeconds, total: state.playSeconds + state.awaySeconds, run: state.runSeconds,
      days: started ? Math.floor((now - state.startedAt) / 86400000) + 1 : null,
      retreats: state.retreats, bestZone: state.bestZone, antibodyTotal: state.antibodyTotal, lifetimeEarned: state.lifetimeEarned, runEarned: state.runEarned,
      clicks: state.clicks, wavesCleared: state.wavesCleared, breaches: state.breaches, signals: state.signalsAnswered,
      runs: state.runLog.slice().reverse(), zones: zoneHistory(state) };
  }
  /**
   * 지난 구역: 이번 판에 지나온 구역마다 머문 시간. [{ zone, name, seconds 머문 시간, day 연 날짜, here 지금 있는 구역인가 }]
   *   1구역은 판을 시작할 때 열린 것으로 본다. 기록이 없는 예전 저장(구역은 열려 있는데 기록이 없다)은 seconds 가 null 이다.
   */
  function zoneHistory(state) {
    var at = {}, out = [], i;
    state.zoneLog.forEach(function (r) { at[r.zone] = r; });
    for (i = 0; i <= state.zone; i++) {
      var from = i === 0 ? { seconds: 0, day: 1 } : at[i], to = i === state.zone ? { seconds: state.runSeconds } : at[i + 1];
      out.push({ zone: i, name: ZONES[i].name, here: i === state.zone, day: from ? from.day : null,
        seconds: from && to ? Math.max(0, to.seconds - from.seconds) : null });
    }
    return out;
  }
  function formatDuration(sec) {
    if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) return '0초';
    sec = Math.floor(sec);
    var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return d ? d + '일 ' + h + '시간' : h ? h + '시간 ' + m + '분' : m ? m + '분 ' + s + '초' : s + '초';
  }

  /* ---------- 저장 ---------- */
  function zoneLabel(state) { return (state.zone + 1) + '구역 ' + ZONES[state.zone].name; }
  function serialize(state) { return JSON.stringify(state); }
  function deserialize(text, now) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('저장 데이터가 비어 있습니다.');
    var raw;
    try { raw = JSON.parse(text); } catch (e) { throw new Error('저장 데이터를 읽을 수 없습니다. 코드가 잘렸는지 확인하세요.'); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('저장 데이터 형식이 올바르지 않습니다.');
    if (raw.version !== SAVE_VERSION) throw new Error('이전 버전의 저장입니다. 알파 0.6 부터는 새로 시작해야 합니다.');
    return sanitizeState(raw, now);
  }

  /* ---------- 표시용 숫자 ---------- */
  var UNITS = ['만', '억', '조', '경', '해', '자', '양', '구', '간', '정', '재', '극'];      // 1.0.4: 6구역의 숫자가 '양'을 넘어서 뒤 단위를 더했다
  /** 12345 → "1.23만". 보유량이 실제보다 많아 보이지 않도록 내림한다. */
  /*
   * 숫자 표기: 'kr' 만·억·조(기본), 'sci' 1.23e8 꼴. 설정에서 바꾼다. 화면에 보이는 모양만 달라진다.
   */
  var notation = 'kr';
  function setNotation(mode) { notation = mode === 'sci' ? 'sci' : 'kr'; return notation; }
  function formatNumber(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '0';
    var sign = n < 0 ? '-' : '';
    n = Math.abs(n);
    if (n < 100) return sign + String(Math.floor(n * 10 + 1e-9) / 10);
    if (n < 1e4) return sign + Math.floor(n).toLocaleString('en-US');
    if (notation === 'sci') return sign + n.toExponential(2).replace('e+', 'e');
    var v = n, k = 0;
    while (v >= 1e4 && k < UNITS.length) { v /= 1e4; k++; }
    if (v >= 1e4) return sign + n.toExponential(2);
    var digits = v < 10 ? 2 : v < 100 ? 1 : 0, p = Math.pow(10, digits);
    return sign + (digits ? (Math.floor(v * p + 1e-9) / p).toFixed(digits) : Math.floor(v).toLocaleString('en-US')) + UNITS[k - 1];
  }

  return {
    HANDS: HANDS, handBonus: handBonus, handCost: handCost, maxHands: maxHands, buyHand: buyHand, noticeAt: noticeAt, noticeBackText: noticeBackText, noticePlan: noticePlan, NOTICE_FULL_TEXT: NOTICE_FULL_TEXT, NOTICE_FULL_MS: NOTICE_FULL_MS, NOTICE_BACK_MS: NOTICE_BACK_MS, ZOMBIE_KINDS: ZOMBIE_KINDS, ZOMBIE_RARITIES: ZOMBIE_RARITIES, sightZombies: sightZombies, nightSpecials: nightSpecials, sightRoll: sightRoll, zdexCount: zdexCount, ACHIEVEMENTS: ACHIEVEMENTS, ACH_BONUS: ACH_BONUS, ACH_RETREATS_HARD: ACH_RETREATS_HARD, ACH_RETREATS_HARDEST: ACH_RETREATS_HARDEST, achCount: achCount, achMult: achMult, achProgress: achProgress, checkAchievements: checkAchievements, SIGNAL_TREATS: SIGNAL_TREATS, cacheExtra: cacheExtra, CACHE_EXTRA_MAX: CACHE_EXTRA_MAX, TREAT_NIGHT: TREAT_NIGHT, TREAT_BOSS: TREAT_BOSS, PET_LEVEL_MAX: PET_LEVEL_MAX, PET_LEVEL_STEP: PET_LEVEL_STEP, petLevel: petLevel, petFeedCost: petFeedCost, feedPet: feedPet, petEffectText: petEffectText, HERO_DEFAULT: HERO_DEFAULT, fillStory: fillStory, GENDERS: GENDERS, setHeroGender: setHeroGender, hasBatchim: hasBatchim, autoOn: autoOn, AUTO_KEYS: AUTO_KEYS, SELL_AUTO_SECONDS: SELL_AUTO_SECONDS, sellInterval: sellInterval, sweepInterval: sweepInterval, setNotation: setNotation, zoneHistory: zoneHistory, SAVE_VERSION: SAVE_VERSION, DAY_SECONDS: DAY_SECONDS, BATTLE_SECONDS: BATTLE_SECONDS, GROWTH: GROWTH, DEFENSE_GROWTH: DEFENSE_GROWTH,
    MILESTONES: MILESTONES, COUNT_MAX: COUNT_MAX, BASE_DEFENSE: BASE_DEFENSE, HORDE_BASE: HORDE_BASE, HORDE_GROWTH: HORDE_GROWTH,
    BOSS_EVERY: BOSS_EVERY, BOSS_STRENGTH: BOSS_STRENGTH, BOSS_REWARD: BOSS_REWARD, NIGHT_REWARD_SECONDS: NIGHT_REWARD_SECONDS,
    WAVE_BONUS: WAVE_BONUS, BREACH_LOSS: BREACH_LOSS, CLICK_SHARE: CLICK_SHARE,
    SIGNAL_FIRST: SIGNAL_FIRST, SIGNAL_MIN: SIGNAL_MIN, SIGNAL_SPREAD: SIGNAL_SPREAD, SIGNAL_WINDOW: SIGNAL_WINDOW,
    SIGNAL_SUPPLY_SECONDS: SIGNAL_SUPPLY_SECONDS, SIGNAL_SUPPLY_MIN: SIGNAL_SUPPLY_MIN, BUFF_MULT: BUFF_MULT, BUFF_SECONDS: BUFF_SECONDS,
    OFFLINE_CAP: OFFLINE_CAP, OFFLINE_RATE: OFFLINE_RATE, PERK_CHOICES: PERK_CHOICES,
    PRODUCT_VALUE: PRODUCT_VALUE, STEADY_AT: STEADY_AT, STEADY_BONUS: STEADY_BONUS, LINE_MILESTONES: LINE_MILESTONES, MACHINES: MACHINES,
    machineLevels: machineLevels, lineMilestone: lineMilestone, machineCost: machineCost, maxMachines: maxMachines, buyMachine: buyMachine,
    lineInfo: lineInfo, productValue: productValue, lineRate: lineRate, tuneLine: tuneLine, tuneCost: tuneCost,
    TRAIN_VALUE: TRAIN_VALUE, TRAIN_COST: TRAIN_COST, TRAIN_GROWTH: TRAIN_GROWTH, TRAIN_MAX: TRAIN_MAX, ROUTE_GROWTH: ROUTE_GROWTH, ROUTE_SLOTS: ROUTE_SLOTS, ROUTE_MAX: ROUTE_MAX,
    FLEET_MILESTONES: FLEET_MILESTONES, ROUTES: ROUTES, fleetMilestone: fleetMilestone, trainCost: trainCost, maxTrains: maxTrains, buyTrain: buyTrain,
    routeCost: routeCost, buyRoute: buyRoute, tripSeconds: tripSeconds, railPlan: railPlan, cargoValue: cargoValue, railRate: railRate,
    LAB_VALUE: LAB_VALUE, labRate: labRate, STAFF_COST: STAFF_COST, STAFF_GROWTH: STAFF_GROWTH, PROJECT_BASE: PROJECT_BASE, PROJECT_GROWTH: PROJECT_GROWTH, OFFER_COUNT: OFFER_COUNT,
    REROLL_SHARE: REROLL_SHARE, SUPPLY_DROP_SECONDS: SUPPLY_DROP_SECONDS, PROJECTS: PROJECTS,
    staffCost: staffCost, maxStaff: maxStaff, buyStaff: buyStaff, researchRate: researchRate, projectCost: projectCost, rerollCost: rerollCost,
    drawOffers: drawOffers, runProject: runProject, rerollOffers: rerollOffers,
    SWEEP_COLS: SWEEP_COLS, SWEEP_ROWS: SWEEP_ROWS, SWEEP_TILES: SWEEP_TILES, SWEEP_AUTO_SECONDS: SWEEP_AUTO_SECONDS, SWEEP_BONUS_CLICKS: SWEEP_BONUS_CLICKS,
    TILE_KINDS: TILE_KINDS, tileKind: tileKind, tileSearched: tileSearched, sweepCount: sweepCount, nextTile: nextTile, sweepBonus: sweepBonus,
    SURGE_MULT: SURGE_MULT, SURGE_SECONDS: SURGE_SECONDS, SURGE_COOLDOWN: SURGE_COOLDOWN, surge: surge, lineNow: lineNow,
    ASSIST_MAX: ASSIST_MAX, ASSIST_STEP: ASSIST_STEP, assistLevel: assistLevel, assistOn: assistOn, assistFactor: assistFactor, surgeCooldown: surgeCooldown, greenCooldown: greenCooldown,
    GREEN_SECONDS: GREEN_SECONDS, GREEN_COOLDOWN: GREEN_COOLDOWN, greenSignal: greenSignal,
    PET_NAME_MAX: PET_NAME_MAX, PET_KINDS: PET_KINDS, PET_BREEDS: PET_BREEDS, PET_RARITIES: PET_RARITIES, PET_PULL_MIN: PET_PULL_MIN, PET_PULL_SHARE: PET_PULL_SHARE, PET_DUP_REFUND: PET_DUP_REFUND,
    cleanName: cleanName, setHeroName: setHeroName, kennelCount: kennelCount, petPullCost: petPullCost, rollRarity: rollRarity, adoptPet: adoptPet, choosePet: choosePet, renamePet: renamePet, petEffect: petEffect, breedDesc: breedDesc, petInfo: petInfo,
    PRICE_HISTORY: PRICE_HISTORY, STREAK_MAX: STREAK_MAX, STREAK_BONUS: STREAK_BONUS, streakMult: streakMult,
    PRICE_STEP: PRICE_STEP, PRICE_FLOOR: PRICE_FLOOR, PRICE_CEIL: PRICE_CEIL, GOODS_VALUE: GOODS_VALUE, GOODS_CAP_SECONDS: GOODS_CAP_SECONDS, PEAK_PRICE: PEAK_PRICE, peakPrice: peakPrice,
    RETREAT_MIN: RETREAT_MIN, RETREAT_K: RETREAT_K, RETREAT_POW: RETREAT_POW,
    ZONES: ZONES, BUILDINGS: BUILDINGS, DEFENSES: DEFENSES, UPGRADES: UPGRADES, PERKS: PERKS, TRAITS: TRAITS, GOALS: GOALS, EXT_MAX: EXT_MAX, EXT_TREATS: EXT_TREATS, EXT_SECONDS: EXT_SECONDS, extNeed: extNeed, extText: extText, extGoals: extGoals, GOALS_ALT: GOALS_ALT, activeGoals: activeGoals, rollGoalPick: rollGoalPick, BEATS: BEATS,
    createState: createState, sanitizeState: sanitizeState, mods: mods, globalMult: globalMult,
    totalBuildings: totalBuildings, sweepRate: sweepRate, incomePerSec: incomePerSec, nextAntibodyAt: nextAntibodyAt, ANTI_STEP: ANTI_STEP, ANTI_CURVE: ANTI_CURVE, AUTO_DEF_STEPS: AUTO_DEF_STEPS, repairInterval: repairInterval, cycleAutoDef: cycleAutoDef, autoDefLeft: autoDefLeft, rerollsLeft: rerollsLeft, rerollPerks: rerollPerks, siegeFactor: siegeFactor, SIEGE_FADE: SIEGE_FADE, SIEGE_FLOOR: SIEGE_FLOOR, RECORDS: RECORDS, RECORD_CHANCE: RECORD_CHANCE, RECORD_BONUS: RECORD_BONUS, RECORD_BONUS_MAX: RECORD_BONUS_MAX, RECORD_TREATS: RECORD_TREATS, recordMult: recordMult, recordCount: recordCount, CARGOS: CARGOS, SALVAGE_SECONDS: SALVAGE_SECONDS, SALVAGE_BONUS: SALVAGE_BONUS, SALVAGE_BONUS_MAX: SALVAGE_BONUS_MAX, SALVAGE_TREATS: SALVAGE_TREATS, salvageMult: salvageMult, cargoCount: cargoCount, salvageReward: salvageReward, fillSalvage: fillSalvage, cargoValue: cargoValue, CLIENTS: CLIENTS, CONTRACT_SECONDS: CONTRACT_SECONDS, CONTRACT_BONUS: CONTRACT_BONUS, CONTRACT_BONUS_MAX: CONTRACT_BONUS_MAX, CONTRACT_TREATS: CONTRACT_TREATS, contractMult: contractMult, clientCount: clientCount, contractReward: contractReward, fillContract: fillContract, productFlow: productFlow, REGULARS: REGULARS, ORDER_SECONDS: ORDER_SECONDS, ORDER_BONUS: ORDER_BONUS, ORDER_BONUS_MAX: ORDER_BONUS_MAX, ORDER_TREATS: ORDER_TREATS, orderMult: orderMult, regularCount: regularCount, orderReward: orderReward, fillOrder: fillOrder, PASSERS: PASSERS, PASSER_CHANCE: PASSER_CHANCE, PASSER_BONUS_MAX: PASSER_BONUS_MAX, passerMult: passerMult, passerCount: passerCount, passBridge: passBridge, postDefense: postDefense, POST_DEFENSE: POST_DEFENSE, LOW_RUN_MAX: LOW_RUN_MAX, RECIPES: RECIPES, RETOOL_SECONDS: RETOOL_SECONDS, JAM_SLOW: JAM_SLOW, JAM_SELF_FIX: JAM_SELF_FIX, JAM_AUTO_FIX: JAM_AUTO_FIX, TUNE_SECONDS: TUNE_SECONDS, TUNE_MULT: TUNE_MULT, TRUCK_WAIT: TRUCK_WAIT, TRUCK_STOCK_MAX: TRUCK_STOCK_MAX, TRUCK_SHARE: TRUCK_SHARE, TRUCK_AUTO: TRUCK_AUTO, MASTERY_MIN: MASTERY_MIN, MASTERY_SECONDS: MASTERY_SECONDS, MASTERY_ALL: MASTERY_ALL, mastery: mastery, masteredAll: masteredAll, recipeFactor: recipeFactor, recipeOf: recipeOf, machineRate: machineRate, setRecipe: setRecipe, lineFactor: lineFactor, repairJam: repairJam, truckReward: truckReward, loadTruck: loadTruck, stepLineEvents: stepLineEvents, stepContracts: stepContracts, ZONE_EVENTS: ZONE_EVENTS, ZEV_WAIT: ZEV_WAIT, ZEV_NOW: ZEV_NOW, ZEV_BOOST: ZEV_BOOST, ZEV_BOOST_MAX: ZEV_BOOST_MAX, ZEV_AUTO: ZEV_AUTO, ZEV_MIN_PEOPLE: ZEV_MIN_PEOPLE, zevReward: zevReward, answerZoneEvent: answerZoneEvent, stepZoneEvents: stepZoneEvents, FOCUS_SECONDS: FOCUS_SECONDS, FOCUS_MULT: FOCUS_MULT, FOCUS_COOL: FOCUS_COOL, PUSHES: PUSHES, PUSH_SECONDS: PUSH_SECONDS, PUSH_MULT: PUSH_MULT, PUSH_COOL: PUSH_COOL, pushZone: pushZone, focusLab: focusLab, researchNow: researchNow, CAP_BASE: CAP_BASE, CAP_PER: CAP_PER, CAP_OVER: CAP_OVER, experience: experience, upgradeSoftCap: upgradeSoftCap, autoEvents: autoEvents, setAutoEvents: setAutoEvents, AUTO_SHARE: AUTO_SHARE, autoShare: autoShare, REBALANCE_SECONDS: REBALANCE_SECONDS, SCOUT_MINUTES: SCOUT_MINUTES, scoutNeed: scoutNeed, scoutLeft: scoutLeft, zoneEntered: zoneEntered, COSMETICS: COSMETICS, COS_SLOTS: COS_SLOTS, COS_BASE: COS_BASE, FLAG_REWARDS: FLAG_REWARDS, grantFlags: grantFlags, RARITIES: RARITIES, GACHA_ODDS: GACHA_ODDS, GACHA_PITY: GACHA_PITY, TICKET_TREATS: TICKET_TREATS, SHARDS_DUP: SHARDS_DUP, SHARDS_COST: SHARDS_COST, gachaTable: gachaTable, gachaPityLeft: gachaPityLeft, pullGacha: pullGacha, buyTicket: buyTicket, craftCosmetic: craftCosmetic, wearCosmetic: wearCosmetic, ownsCosmetic: ownsCosmetic, cosmeticLook: cosmeticLook, STAGES: STAGES, REGIONS: REGIONS, STAGE_RULES: STAGE_RULES, STAGE_TREATS: STAGE_TREATS, STAGE_OPEN_ZONE: STAGE_OPEN_ZONE, stagesOpen: stagesOpen, stageMarks: stageMarks, stageBlock: stageBlock, createStage: createStage, stageStatus: stageStatus, stageDef: stageDef, stageRuleTexts: stageRuleTexts, stageGoalText: stageGoalText, finishStage: finishStage, stageMarkCount: stageMarkCount, badgeCount: badgeCount, stageRule: stageRule, CHALLENGES: CHALLENGES, challengeBlock: challengeBlock, startChallenge: startChallenge, quitChallenge: quitChallenge, streakTreats: streakTreats, STREAK_TREATS_MAX: STREAK_TREATS_MAX, MEDAL_BONUS: MEDAL_BONUS, SPRINT_SECONDS: SPRINT_SECONDS, HORDE_MULT: HORDE_MULT, challengeOpen: challengeOpen, challengeOn: challengeOn, activeChallenge: activeChallenge, challengeGoalText: challengeGoalText, setNextChallenge: setNextChallenge, medalCount: medalCount, medalMult: medalMult, checkChallenge: checkChallenge, rebalancePlan: rebalancePlan, rebalanceRefund: rebalanceRefund, ROUTE_MAX: ROUTE_MAX, machineSpent: machineSpent, splitLevels: splitLevels, rebalanceLine: rebalanceLine, NIGHT_EASE: NIGHT_EASE, EDGE_GAIN: EDGE_GAIN, COUNTER_NIGHTS: COUNTER_NIGHTS, easeOn: easeOn, strikeReady: strikeReady, counterReady: counterReady, strike: strike, counterAttack: counterAttack, BOSS_PERKS_MAX: BOSS_PERKS_MAX, DEF_STREAK_STEP: DEF_STREAK_STEP, DEF_STREAK_MAX: DEF_STREAK_MAX, defStreakMult: defStreakMult, effectNow: effectNow, stepOrders: stepOrders, findRecord: findRecord, towerMult: towerMult, antennaCost: antennaCost, maxAntennas: maxAntennas, buyAntenna: buyAntenna, survivorRate: survivorRate, serumCost: serumCost, buySerum: buySerum, SERUM_COSTS: SERUM_COSTS, bridgeSafety: bridgeSafety, postCost: postCost, maxPosts: maxPosts, buyPost: buyPost, guardRate: guardRate, SAFETY_MAX: SAFETY_MAX, SAFE_NIGHT: SAFE_NIGHT, milestoneMult: milestoneMult, milestoneTier: milestoneTier, isTap: isTap, nextMilestone: nextMilestone, buildingCost: buildingCost, maxBuildings: maxBuildings, buyBuilding: buyBuilding,
    buildingRate: buildingRate, searchRate: searchRate,
    zoneOpen: zoneOpen, priceRange: priceRange, stallCost: stallCost, maxStalls: maxStalls, buyStall: buyStall, goodsRate: goodsRate, goodsCap: goodsCap,
    goodsValue: goodsValue, sellGoods: sellGoods, setAutoSell: setAutoSell, setSellPeak: setSellPeak, tradeRate: tradeRate,
    upgradeCost: upgradeCost, buyUpgrade: buyUpgrade,
    productionPerSec: productionPerSec, clickPower: clickPower, clickValue: clickValue, scavenge: scavenge,
    goals: goals, goalsComplete: goalsComplete, nextZone: nextZone, openZone: openZone,
    defenseCost: defenseCost, maxDefenses: maxDefenses, buyDefense: buyDefense, defensePower: defensePower, currentWave: currentWave, isBossWave: isBossWave,
    strengthAt: strengthAt, nightStrength: nightStrength, nightReward: nightReward, defensePlan: defensePlan, fortify: fortify, dayPhase: dayPhase, resolveNight: resolveNight,
    answerSignal: answerSignal, drawPerks: drawPerks, choosePerk: choosePerk,
    antibodiesOnRetreat: antibodiesOnRetreat, canRetreat: canRetreat, retreat: retreat, startSupplies: startSupplies,
    traitCost: traitCost, buyTrait: buyTrait, traitsSpent: traitsSpent, resetTraits: resetTraits,
    tick: tick, offlineRate: offlineRate, applyOffline: applyOffline, guide: guide, stats: stats, formatDuration: formatDuration,
    zoneLabel: zoneLabel, serialize: serialize, deserialize: deserialize, formatNumber: formatNumber
  };
});
