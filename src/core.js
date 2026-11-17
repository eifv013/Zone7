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
  var BOSS_REWARD = 5;             // 변이체를 막았을 때의 전리품 배수
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
  var TRAIN_COST = 2e18;           // 첫 열차의 값
  var TRAIN_MAX = 100;             // 열차의 최대 수
  var ROUTE_GROWTH = 2.2;          // 노선을 한 단계 늘릴 때마다 값이 오르는 배수
  var ROUTE_SLOTS = 2;             // 노선 한 단계마다 다닐 수 있는 열차 수
  var ROUTE_MAX = 25;              // 노선의 최대 단계
  var GREEN_SECONDS = 30;          // 청신호 한 번에 열차들이 앞서 달리는 시간
  var GREEN_COOLDOWN = 120;        // 청신호를 다시 켤 수 있을 때까지의 시간
  var FLEET_MILESTONES = [4, 8, 12, 16, 24, 32, 48, 64, 80, 100]; // 열차가 이 수에 닿을 때마다 화물 2배
  // 5구역 연구
  var STAFF_COST = 5e23;           // 첫 연구원의 값
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
          "옆집 지붕에 누가 흰 페인트로 숫자를 써 놓았다. 7, 그리고 화살표. 화살표는 강 쪽을 가리킨다. 다음 집 지붕에도, 그다음 집에도 있다. 누군가 지붕을 타고 가면서 길을 남긴 것이다.",
          "세 번째 집 다락에서 사람들을 만났다. 정수기 기사였다는 아저씨, 쌍둥이를 데리고 있는 아주머니, 말이 없는 {student}. 다들 같은 방송을 듣고 있었다. 아주머니가 이름을 물어서 {hero}라고 했다. 쌍둥이들이 그 이름을 세 번쯤 따라 불렀다.",
          "아저씨가 물었다. “{hero:야}, 그 상자엔 뭐가 들었냐.” 나는 모른다고 했다. 정말로 모른다. 아저씨는 더 묻지 않고 내 우비의 모자를 씌워 주었다. “비 온다. 노란색이라 멀리서도 보이겠네. 길 잃을 일은 없겠다.”",
          "밤에 방벽 너머에서 손톱으로 철판을 긁는 소리가 났다. 사람들이 숨을 죽였다. 나는 왼쪽 소매를 꼭 쥐고 있었다. 소매 아래가 가려웠다. 엄마가 긁지 말라고 했다.",
          "사람들은 내가 추워서 우비를 안 벗는 줄 안다. 그렇게 알게 두기로 했다."] },
        { title: "남겨 두는 것", text: [
          "동네의 통조림이 바닥을 보인다. 찾아볼 집이 이제 없다. 골목 끝에 셔터 내린 시장이 보인다. 다음은 거기다.",
          "떠나기 전에 아저씨가 이상한 일을 시켰다. 창고의 절반을 그대로 두고 가자는 것이다. 물, 통조림, 건전지. 문에는 분필로 썼다. “쓰고 채워 놓을 것.”",
          "{student:이} 화를 냈다. 우리도 모자란데 누굴 주느냐고. 아저씨는 지붕을 가리켰다. “저 숫자 써 놓은 사람도 모자랐을 거다. 그래도 썼잖냐.”",
          "나는 우리 집 현관에 쪽지를 붙였다. “엄마, 나 7구역으로 가. 상자는 잘 들고 있어. — {hero}” 붙이고 나서 한참 서 있었다. 엄마가 이걸 읽을 일이 있을까.",
          "돌아보지 않으려고 했는데 한 번 돌아봤다. 지붕 위의 7이 비에 젖어 번들거렸다."] }] },
    { no: 2, name: '재래시장', kind: 'trade', cost: 5e7, lead: '좌판을 열고 시세를 봐 가며 판다',
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
    { no: 3, name: '공단', kind: 'line', cost: 1e12, lead: '멈춘 공장의 기계 셋을 맞물려 돌린다',
      story: [
        { title: "멈춘 자리", text: [
          "3구역. 공단의 철문은 안쪽에서 잠겨 있었다. 밖에서 잠근 게 아니다. 안에 있던 사람들이 잠그고, 다른 길로 나간 것이다.",
          "문을 뜯고 들어가니 기계들이 멈춘 자리 그대로 서 있다. 컨베이어 위에는 만들다 만 것들이 한 줄로 늘어서 있다. 맨 앞의 것에는 나사가 세 개 박혀 있고, 그다음은 두 개, 그다음은 하나.",
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
    { no: 5, name: '대학 병원', kind: 'lab', cost: 1e24, lead: '남은 연구를 이어 가며 과제를 고른다',
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
    { no: 6, name: '강변 검문소', kind: 'soon', cost: 1e31, lead: '다리를 지키며 밀려오는 무리를 막는다',
      story: [
        { title: "다리", text: [
          "다리 입구의 검문소에 닿았다. 차단기는 내려가 있고 초소는 비었다. 탁자 위에 근무 일지가 펼쳐져 있다. 마지막 줄. “통과 17. 그중 아이 16.”",
          "아이 열여섯. 나는 쪽지 뒷면을 꺼내서, 줄 그은 이름 하나를 뺀 나머지를 소리 내어 읽었다. 열여섯 개. 맞다. 그러면 남는 하나는 아이가 아니다. 아이들과 같이 건넌 어른이 하나 있다.",
          "다리 위에는 버려진 차들이 끝까지 늘어서 있다. 그 사이사이에 놈들이 서 있다. 걷지 않는다. 다리 한가운데부터는 전부 멈춰서 건너편을 보고 있다. 방송이 저기서 나오기 때문이다.",
          "그때 건너편 탐조등이 돌던 것을 멈추고 이쪽으로 내려왔다. 빛이 차들을 훑고, 놈들을 훑고, 차단기 앞의 나한테 와서 섰다. 노란 우비가 대낮처럼 환해졌다.",
          "불빛이 한 번 꺼졌다 켜졌다. 그리고 또 한 번. 누가 저기서 나를 보고 있다. 다리를 건너려면 여기를 먼저 지켜야 한다."] }] },
    { no: 7, name: '송신탑', kind: 'soon', cost: 1e30, lead: '', story: [] }
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
    { id: 'lube',    zone: 2, name: '윤활유',    desc: '완제품 값 +25%',         key: 'z3',      per: 0.25, baseCost: 5e11, growth: 2.4, max: 40 },
    { id: 'manual',  zone: 2, name: '정비 교범', desc: '기계 값 -4%',            key: 'z3cost',  per: -0.04, baseCost: 1e12, growth: 3,  max: 12 },
    { id: 'belt',    zone: 2, name: '컨베이어',  desc: '정속 가동 보너스 +10%p', key: 'steady',  per: 0.1,  baseCost: 2e12, growth: 3.5, max: 10 },
    { id: 'spare',   zone: 2, name: '예비 부품', desc: '정속 가동으로 치는 가동률 -3%p', key: 'slack', per: 0.03, baseCost: 1e12, growth: 4, max: 5 },
    { id: 'signal',  zone: 3, name: '신호기',    desc: '화물 값 +25%',           key: 'z4',      per: 0.25, baseCost: 3e18, growth: 2.4, max: 40 },
    { id: 'timetable', zone: 3, name: '시간표',  desc: '운행 시간 -5%',          key: 'trip',    per: -0.05, baseCost: 1e19, growth: 4,  max: 8 },
    { id: 'tracks',  zone: 3, name: '선로 정비', desc: '노선 값 -6%',            key: 'routecost', per: -0.06, baseCost: 1e19, growth: 3, max: 12 },
    { id: 'depot',   zone: 3, name: '차량 기지', desc: '열차 값 -4%',            key: 'traincost', per: -0.04, baseCost: 1e19, growth: 3, max: 12 },
    { id: 'scope',   zone: 4, name: '현미경',    desc: '연구 속도 +25%',         key: 'lab',     per: 0.25, baseCost: 1e24, growth: 2.4, max: 40 },
    { id: 'notes',   zone: 4, name: '연구 노트', desc: '과제에 드는 점수 -5%',   key: 'labcost', per: -0.05, baseCost: 3e24, growth: 3.5, max: 10 },
    { id: 'dorm',    zone: 4, name: '기숙사',    desc: '연구원 값 -4%',          key: 'staffcost', per: -0.04, baseCost: 2e24, growth: 3, max: 12 },
    // 자동: 구역마다 개조를 사야 그 구역의 일이 알아서 돌아간다(AUTO_KEYS). 영구 특성 '자동화'가 있으면 개조 없이도 전부 돈다.
    // 방벽 개조(zone -1: 구역이 아니라 방벽 화면에 놓인다. 처음부터 살 수 있다)
    { id: 'architect', zone: -1, name: '건축가', desc: '방어력 +20%',              key: 'defense', per: 0.2,   baseCost: 5000, growth: 3,  max: 30 },
    { id: 'builder',   zone: -1, name: '건설자', desc: '방어 수단 값 -5%',         key: 'defcost', per: -0.05, baseCost: 2e4,  growth: 3,  max: 12 },
    { id: 'repair',    zone: -1, name: '수리공', desc: '정해 둔 수까지 방어 수단을 알아서 산다 · 올릴수록 빨라진다', key: 'repair', per: 1, baseCost: 1e5, growth: 10, max: 5 },
    { id: 'rumor',   zone: 0, name: '소문',      desc: '은닉처가 나올 확률 +3%p',  key: 'rumor',   per: 3,    baseCost: 3000, growth: 5,  max: 8 },
    { id: 'patrol',  zone: 0, name: '순찰조',    desc: '수색조가 알아서 동네를 수색한다 · 올릴수록 빨라진다', key: 'patrol', per: 1, baseCost: 2000, growth: 10, max: 5 },
    { id: 'broker',  zone: 1, name: '흥정꾼',    desc: '시세가 평균 이상이면 알아서 판다 · 올릴수록 자주 판다', key: 'broker', per: 1, baseCost: 5e6, growth: 8, max: 5 },
    { id: 'autoline', zone: 2, name: '자동 제어반', desc: '전력 투입이 알아서 들어간다', key: 'autoline', per: 1, baseCost: 5e13, growth: 1, max: 1 },
    { id: 'autosig', zone: 3, name: '자동 신호',  desc: '청신호가 알아서 켜진다', key: 'autosig', per: 1, baseCost: 5e20, growth: 1, max: 1 }
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
    { id: 'frugal',  name: '알뜰함',    desc: '모든 값 -6%',     key: 'cost',    per: -0.06 }
  ];
  /*
   * 영구 특성: 항체 샘플로 찍는다. 철수해도 남고, 되돌리면 쓴 샘플을 모두 돌려받는다.
   *   baseCost, growth : 레벨마다 드는 샘플 = ceil(baseCost × growth^레벨)
   */
  var TRAITS = [
    { id: 'immune',  name: '면역',      desc: '전체 생산 +25%',            key: 'prod',    per: 0.25, baseCost: 1, growth: 1.5,  max: 40 },
    { id: 'quick',   name: '숙련된 손', desc: '수색 배수 +100%',           key: 'click',   per: 1,    baseCost: 1, growth: 1.8,  max: 15 },
    { id: 'bulwark', name: '보루',      desc: '방어력 +40%',               key: 'defense', per: 0.4,  baseCost: 1, growth: 1.4,  max: 40 },
    { id: 'thrift',  name: '절약',      desc: '모든 값 -4%',               key: 'cost',    per: -0.04, baseCost: 2, growth: 1.7, max: 12 },
    { id: 'pioneer', name: '선발대',    desc: '철수 뒤 시작 물자 10배(레벨 1: 1,000)', key: 'start', per: 1, baseCost: 2, growth: 2, max: 8 },
    { id: 'dealer',  name: '장사 수완', desc: '상품 값 +30%',              key: 'z2',      per: 0.3,  baseCost: 3, growth: 1.5,  max: 30 },
    { id: 'engineer', name: '기술자',   desc: '완제품 값 +30%',            key: 'z3',      per: 0.3,  baseCost: 3, growth: 1.5,  max: 30 },
    { id: 'railman', name: '철도원',    desc: '화물 값 +30%',              key: 'z4',      per: 0.3,  baseCost: 3, growth: 1.5,  max: 30 },
    { id: 'scholar', name: '연구자',    desc: '연구 속도 +30%',            key: 'lab',     per: 0.3,  baseCost: 3, growth: 1.5,  max: 30 },
    { id: 'rest',    name: '교대 근무', desc: '자리 비움 효율 +5%p',       key: 'offline', per: 0.05, baseCost: 2, growth: 1.6,  max: 10 },
    { id: 'legacy',  name: '기록 보관', desc: '철수로 얻는 항체 샘플 +10%', key: 'antibody', per: 0.1, baseCost: 4, growth: 1.6,  max: 20 },
    { id: 'reroll',  name: '다시 뽑기', desc: '특전 후보를 한 회차에 1번 더 다시 뽑을 수 있다', key: 'reroll', per: 1, baseCost: 3, growth: 1.8, max: 5 },
    { id: 'auto',    name: '자동화',    desc: '전력 투입·청신호의 대기 시간 -6% (자동은 구역 개조로 켜요)', key: 'assist', per: 1, baseCost: 2, growth: 1.6, max: ASSIST_MAX }
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
    [ { id: 'z3a', text: '기계 레벨 합계 120', need: 120, value: function (s) { return machineLevels(s); } },
      { id: 'z3b', text: '정속 가동 누적 3분', need: 180, unit: 'time', value: function (s) { return s.steadySeconds; } },
      { id: 'z3c', text: '완제품으로 번 물자 누적 100경', need: 1e18, value: function (s) { return s.lineEarned; } } ],
    [ { id: 'z4a', text: '열차 16대', need: 16, value: function (s) { return s.trains; } },
      { id: 'z4b', text: '심야 급행 3번 도착', need: 3, value: function (s) { return s.expressRuns; } },
      { id: 'z4c', text: '화물로 번 물자 누적 100해', need: 1e22, value: function (s) { return s.railEarned; } } ],
    [ { id: 'z5a', text: '연구원 40명', need: 40, value: function (s) { return s.staff; } },
      { id: 'z5b', text: '연구 과제 15개 끝내기', need: 15, value: function (s) { return s.projectsDone; } },
      { id: 'z5c', text: '혈청 배양 3번 끝내기', need: 3, value: function (s) { return s.research.serum; } } ]
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
      stalls: 0, goods: 0, price: 1, priceClock: 0, autoSell: true, tradeEarned: 0, peakSales: 0,
      // 시세판: priceHistory 지난 시세(오래된 것부터), streak 연속 호가 단계, streakUsed 지금 시세에서 이미 단계를 올렸는가
      priceHistory: [], streak: 0, streakUsed: false,
      // 3구역 생산 라인
      machines: {}, lineEarned: 0, steadySeconds: 0,
      surgeLeft: 0, surgeCool: 0,      // 전력 투입: 남은 시간, 다시 쓸 수 있을 때까지 남은 시간
      // 4구역 노선: routes 노선 단계, routeClock 이번 운행이 지난 시간(초), routeLoad 이번 운행에 실린 화물(열차 × 초)
      trains: 0, routes: {}, routeClock: {}, routeLoad: {}, railEarned: 0, expressRuns: 0,
      greenCool: 0,                    // 청신호를 다시 켤 수 있을 때까지 남은 시간
      // 5구역 연구: staff 연구원, points 모인 연구 점수, research 과제별 끝낸 횟수, offers 지금 고를 수 있는 과제, projectsDone 끝낸 과제 수
      staff: 0, points: 0, research: {}, offers: [], projectsDone: 0,
      // 밤
      day: 1, dayClock: 0, wavesCleared: 0, breaches: 0, siege: false, siegeNights: 0,
      // 구조 신호
      signalIn: SIGNAL_FIRST, signalLeft: 0, signalsAnswered: 0, buff: null,
      // 특전(이번 판)
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
      zdex: {},              // 좀비 도감: 종류마다 만난 횟수. 철수해도 남는다
      ach: {},               // 달성한 업적 { id: true }. 철수해도 남는다
      achClock: 0,           // 업적을 마지막으로 확인한 뒤 흐른 시간(초)
      startedAt: safeNum(now, 0), playSeconds: 0, awaySeconds: 0, runSeconds: 0,
      zoneLog: [],           // 이번 판에 구역을 연 기록 [{ zone 구역 번호(0부터), seconds 판을 시작한 뒤 흐른 시간, day 날짜 }]
      runLog: [],            // 지난 판들 [{ zone, seconds, antibodies }] (최근 10판)
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
    s.autoSell = raw.autoSell !== false;
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
    s.surgeCool = clamp(safeNum(raw.surgeCool, 0), 0, SURGE_COOLDOWN);
    s.sweepMask = safeCount(raw.sweepMask) % (1 << SWEEP_TILES);
    s.sweepSeed = Math.max(1, safeCount(raw.sweepSeed) % 1000000);
    s.sweepClock = clamp(safeNum(raw.sweepClock, 0), 0, SWEEP_AUTO_SECONDS);
    s.staff = Math.min(s.staff, COUNT_MAX);
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
    GOALS.forEach(function (list) { list.forEach(function (g) { if (gd[g.id]) s.goalsDone[g.id] = true; }); });
    var st = raw.story && typeof raw.story === 'object' ? raw.story : {};
    BEATS.forEach(function (b) { if (st[b.id]) s.story[b.id] = true; });
    var rz = raw.zdex && typeof raw.zdex === 'object' ? raw.zdex : {};
    ZOMBIE_KINDS.forEach(function (z) { var n = clamp(safeCount(rz[z.id]), 0, 1e9); if (n > 0) s.zdex[z.id] = n; });
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
    var m = { prod: 1, z1: 1, z2: 1, z3: 1, z4: 1, lab: 1, labcost: 1, staffcost: 1, trip: 1, routecost: 1, traincost: 1, click: 1, defense: 1, defcost: 1, repair: 0, reroll: 0, loot: 1, cost: 1, z1cost: 1, z3cost: 1, floor: 0, ceil: 0, cap: 1, offline: 0, antibody: 1, start: 0, broker: 0, assist: 0, steady: 0, slack: 0, patrol: 0, autoline: 0, autosig: 0, rumor: 0 };
    var ADD = { floor: 1, ceil: 1, offline: 1, start: 1, broker: 1, steady: 1, slack: 1, assist: 1, patrol: 1, autoline: 1, autosig: 1, rumor: 1, repair: 1, reroll: 1 };      // 더하는 항목. 나머지는 (1 + 레벨 × per) 을 곱한다
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
    var pe = petEffect(state); if (pe) m[pe.key] *= 1 + pe.bonus;      // 동물 친구
    // 연구 과제: 끝낸 횟수만큼 곱으로 쌓인다
    if (state.research) PROJECTS.forEach(function (d) { var lv = state.research[d.id] || 0; if (lv && d.key !== 'drop') m[d.key] *= Math.pow(d.mult, lv); });
    m.labcost = Math.max(0.3, m.labcost); m.staffcost = Math.max(0.2, m.staffcost);
    m.cost = Math.max(0.2, m.cost);
    m.defcost = Math.max(0.2, m.defcost);
    m.z1cost = Math.max(0.2, m.z1cost);
    m.z3cost = Math.max(0.2, m.z3cost);
    m.routecost = Math.max(0.2, m.routecost); m.traincost = Math.max(0.2, m.traincost);
    m.trip = Math.max(0.5, m.trip);        // 운행 시간은 절반 아래로 줄지 않는다
    return m;
  }
  /** 전체 생산 배수: 특성·특전 × 막아낸 밤 보너스 × 지원 효과. */
  function globalMult(state) {
    return mods(state).prod * (1 + WAVE_BONUS * state.wavesCleared) * (state.buff ? state.buff.mult : 1) * achMult(state);
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
  function goodsValue(state) { return GOODS_VALUE * mods(state).z2 * globalMult(state) * handBonus(state, 'crier'); }
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
  /** 2구역이 가만히 둘 때 초당 버는 물자(평균 시세 기준). 화면의 '초당' 표시와 자리 비움 계산에 쓴다. */
  function tradeRate(state) { return goodsRate(state) * goodsValue(state) * priceRange(state).mean; }
  var SELL_AUTO_SECONDS = 10;   // 흥정꾼 1레벨이 한 번 파는 간격(초)
  /** 흥정꾼이 한 번 파는 간격(초). 레벨마다 2초씩 줄어든다(2초까지). 자동화 특성만 있으면 10초. */
  function sellInterval(state) { return Math.max(2, SELL_AUTO_SECONDS - 2 * Math.max(0, mods(state).broker - 1)); }
  function stepTrade(state, dt, rng, events) {
    if (!zoneOpen(state, 1)) return;
    state.priceClock += dt;
    while (state.priceClock >= PRICE_STEP) {
      state.priceClock -= PRICE_STEP;
      state.priceHistory.push(state.price);                       // 시세판에 지난 시세를 남긴다
      if (state.priceHistory.length > PRICE_HISTORY) state.priceHistory.splice(0, state.priceHistory.length - PRICE_HISTORY);
      state.streakUsed = false;                                   // 새 시세에서는 다시 단계를 올릴 수 있다
      var r = priceRange(state);
      state.price = Math.round((r.floor + rng() * (r.ceil - r.floor)) * 100) / 100;
    }
    var cap = goodsCap(state);
    state.goods = Math.min(cap, state.goods + goodsRate(state) * dt);
    if (!state.autoSell || !autoOn(state, 1)) return;
    // 자동 판매(흥정꾼): 시세가 평균 이상인 동안 sellInterval 초마다 한 번씩 판다. 낮은 시세에서는 기다린다(시계는 다 찬 채로 멈춘다).
    // 창고가 차면 시세와 상관없이 판다(버려지지 않게).
    var every = sellInterval(state);
    state.sellClock = Math.min(every, state.sellClock + dt);
    if (!(state.goods > 0)) return;
    var full = state.goods >= cap, good = state.price >= priceRange(state).mean && state.sellClock >= every;
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
      var c = open ? d.rate * (state.machines[d.id] || 0) : 0;
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
  function productValue(state) { return PRODUCT_VALUE * mods(state).z3 * globalMult(state); }
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
  var AUTO_KEYS = ['patrol', 'broker', 'autoline', 'autosig'];
  function autoOn(state, zone) { return zone >= 0 && zone < AUTO_KEYS.length && mods(state)[AUTO_KEYS[zone]] > 0; }
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
  function lineNow(state) { return lineRate(state) * (state.surgeLeft > 0 ? SURGE_MULT : 1); }
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
  function cargoValue(state) { return zoneOpen(state, 3) ? TRAIN_VALUE * fleetMilestone(state.trains) * mods(state).z4 * globalMult(state) : 0; }
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
  function researchRate(state) { return zoneOpen(state, 4) ? state.staff * milestoneMult(state.staff) * mods(state).lab : 0; }
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
    return { ok: true, id: id, name: def.name, level: state.research[id], cost: cost, gain: gain };
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
    state.points += researchRate(state) * dt;
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
  function upgradeCost(state, id) {
    var def = findById(UPGRADES, id);
    if (!def || !zoneOpen(state, def.zone) || state.upgrades[id] >= def.max) return Infinity;
    return Math.ceil(def.baseCost * Math.pow(def.growth, state.upgrades[id]) * mods(state).cost);
  }
  function buyUpgrade(state, id) {
    var def = findById(UPGRADES, id);
    if (!def) return fail('unknown');
    if (!zoneOpen(state, def.zone)) return fail('locked');
    return pay(state, upgradeCost(state, id), function () {
      state.upgrades[id]++;
      if (def.key === 'floor' || def.key === 'ceil') { var r = priceRange(state); state.price = clamp(state.price, r.floor, r.ceil); }
    });
  }

  /* ---------- 생산 합계와 직접 수색 ---------- */
  /** 가만히 둘 때의 초당 생산(1구역 시설 + 2구역 평균 판매 + 3구역 라인 + 4구역 열차의 평균). */
  function productionPerSec(state) { return searchRate(state) + tradeRate(state) + lineRate(state) + railRate(state); }
  /** 직접 수색의 실제 배수: 수색 배수가 두 배가 될 때마다 1씩 는다(누르기가 방치를 압도하지 않게). */
  function clickPower(state) { return 1 + Math.log(Math.max(1, mods(state).click)) / Math.LN2; }
  function clickValue(state) { return (globalMult(state) + productionPerSec(state) * CLICK_SHARE) * clickPower(state); }
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

  /* ---------- 구역 목표와 다음 구역 ---------- */
  /** 구역 index 의 목표 진행 [{ id, text, value, need, done }]. 아직 없는 구역은 빈 배열. */
  function goals(state, index) {
    return (GOALS[index] || []).map(function (g) {
      var v = 0;
      try { v = safeNum(g.value(state), 0); } catch (e) { v = 0; }
      return { id: g.id, text: g.text, value: Math.min(v, g.need), need: g.need, unit: g.unit || null, done: !!state.goalsDone[g.id] };
    });
  }
  function goalsComplete(state, index) { return (GOALS[index] || []).every(function (g) { return !!state.goalsDone[g.id]; }); }
  /** 새로 채운 목표를 달성 처리하고 특전 선택을 건다. 한 번에 하나씩(고르기 전에는 다음 것을 걸지 않는다). */
  function checkGoals(state, rng, events) {
    for (var z = 0; z <= state.zone; z++) {
      var list = GOALS[z] || [];
      for (var i = 0; i < list.length; i++) {
        var g = list[i];
        if (state.goalsDone[g.id] || state.pendingPerks.length) continue;
        var v = 0;
        try { v = g.value(state); } catch (e) { v = 0; }
        if (!(v >= g.need)) continue;
        state.goalsDone[g.id] = true;
        state.pendingPerks = drawPerks(rng, state);
        events.push({ type: 'goal', zone: z, id: g.id, text: g.text });
      }
    }
  }
  /** 다음 구역의 상태 { index, zone, cost, ready(목표를 다 채웠는가), soon(아직 없는 구역인가) }. 마지막 구역이면 null. */
  function nextZone(state) {
    var i = state.zone + 1;
    if (i >= ZONES.length) return null;
    return { index: i, zone: ZONES[i], cost: Math.ceil(ZONES[i].cost * mods(state).cost), ready: goalsComplete(state, state.zone), soon: ZONES[i].kind === 'soon' };
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
    if (n.cost > state.supplies) return fail('supplies');
    state.supplies -= n.cost;
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
    return Math.floor(total * mods(state).defense);
  }
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
  function nightStrength(state) { return Math.ceil(strengthAt(state, currentWave(state)) * siegeFactor(state)); }
  function nightReward(state) {
    var w = currentWave(state);
    return Math.max(25 * w, productionPerSec(state) * NIGHT_REWARD_SECONDS) * mods(state).loot * (isBossWave(w) ? BOSS_REWARD : 1);
  }
  /** 오늘 밤을 막는 데 가장 싼 보강 { cost, picks: [{ id, qty }], enough }. 이미 막을 수 있으면 cost 0. */
  function defensePlan(state) {
    var tmp = { supplies: Infinity, defenses: {}, upgrades: state.upgrades, perks: state.perks, traits: state.traits, research: state.research, pet: state.pet, zone: state.zone };   // defensePower 가 읽는 것만 담는다(연구 과제 '방어 교범' 포함)
    DEFENSES.forEach(function (d) { tmp.defenses[d.id] = state.defenses[d.id]; });
    var need = nightStrength(state), cost = 0, picked = {}, guard = 0;
    while (defensePower(tmp) < need && guard++ < 3000) {
      var best = null, bestValue = 0;
      DEFENSES.forEach(function (d) { var c = defenseCost(tmp, d.id, 1), v = d.power / c; if (v > bestValue) { best = d; bestValue = v; } });
      if (!best) break;
      cost += defenseCost(tmp, best.id, 1);
      tmp.defenses[best.id]++;
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
  function resolveNight(state) {
    var day = state.day, boss = isBossWave(currentWave(state)), ev = resolveNightCore(state);
    var found = sightZombies(state, day, boss);
    if (found.length) ev.found = found;
    return ev;
  }
  function resolveNightCore(state) {
    var w = currentWave(state), strength = nightStrength(state), defense = defensePower(state), boss = isBossWave(w);
    state.day++;
    if (defense >= strength) {
      var reward = nightReward(state);
      earn(state, reward);
      state.wavesCleared++;
      state.siege = false; state.siegeNights = 0;
      var treat = boss ? TREAT_BOSS : TREAT_NIGHT;
      state.treats = Math.min(1e9, state.treats + treat);      // 밤을 막으면 간식을 얻는다
      return { type: 'defended', wave: w, strength: strength, defense: defense, reward: reward, boss: boss, treats: treat };
    }
    if (state.siege) { state.siegeNights = Math.min(99, (state.siegeNights || 0) + 1); return      /* 버틴 밤을 센다: 다음 밤의 무리가 그만큼 흩어진다 */ { type: 'held', wave: w, strength: strength, defense: defense, boss: boss }; }
    var lost = state.supplies * BREACH_LOSS;
    state.supplies -= lost;
    state.breaches++;
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
  function canRetreat(state) { return antibodiesOnRetreat(state) >= 1 && !state.pendingPerks.length; }
  /**
   * 철수: 거점을 전부 버리고 1구역에서 다시 시작한다.
   *   사라지는 것 : 물자, 시설, 방벽, 구역 강화, 좌판과 상품, 기계, 열차와 노선, 연구원과 끝낸 과제, 연 구역, 특전, 막아낸 밤, 달성한 목표
   *   남는 것     : 항체 샘플과 영구 특성, 읽은 일지, 통계
   */
  function retreat(state, now) {
    if (!canRetreat(state)) return fail('not-ready');
    var gained = antibodiesOnRetreat(state), next = createState(now);
    next.antibodies = state.antibodies + gained;
    next.antibodyTotal = state.antibodyTotal + gained;
    TRAITS.forEach(function (t) { next.traits[t.id] = state.traits[t.id]; });
    next.retreats = state.retreats + 1;
    next.pet = state.pet; next.kennel = state.kennel; next.treats = state.treats; next.petLv = state.petLv; next.heroName = state.heroName; next.heroGender = state.heroGender;      // 동물 친구와 이름은 함께 간다
    next.bestZone = Math.max(state.bestZone, state.zone);
    next.story = state.story;
    checkAchievements(state, null);      // 철수하는 순간까지 채운 것은 달성으로 쳐 준다
    next.ach = state.ach; next.zdex = state.zdex;
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
  function hasBatchim(word) {
    var c = String(word || '').charCodeAt(String(word || '').length - 1);
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
        var done = (GOALS[zi] || []).filter(function (g) { return !!s.goalsDone[g.id]; }).length;
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
   * 업적: 구역마다 15개, 공통 30개(모두 105개). 한 번 달성하면 철수해도 남는다.
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
    { id: 'z5gate', group: 'z5', name: '다리 앞에서', tier: 4, needs: [1], value: function (s) { return s.gate && s.zone >= 4 ? 1 : 0; }, text: function () { return '6구역의 문 앞에 닿기'; } },
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
  var ACHIEVEMENTS = [];
  ACH_SERIES.forEach(function (sr) {
    sr.needs.forEach(function (need, k) {
      var a = { id: sr.id + '-' + (k + 1), group: sr.group, tier: sr.tier || Math.min(4, k + 1 + (sr.needs.length === 2 ? 1 : 0)),
        name: sr.name + (sr.needs.length > 1 ? ' ' + ROMAN[k] : ''), need: need, value: sr.value };
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
    return { value: Math.min(v, a.need), need: a.need, done: !!state.ach[a.id], at: typeof state.ach[a.id] === 'number' ? state.ach[a.id] : 0 };
  }
  /** 조건을 채운 업적을 달성으로 바꾸고 'achievement' 사건을 남긴다. */
  function checkAchievements(state, events, now) {
    var at = typeof now === 'number' && isFinite(now) && now > 0 ? Math.floor(now) : Date.now();      // 달성한 시각을 적어 둔다
    ACHIEVEMENTS.forEach(function (a) {
      if (state.ach[a.id]) return;
      var p = achProgress(state, a);
      if (p.value >= a.need) { state.ach[a.id] = at; if (events) events.push({ type: 'achievement', id: a.id, name: a.name, text: a.text, group: a.group, tier: a.tier }); }
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
    if (line > 0) { earn(state, line); state.lineEarned += line; if (lineInfo(state).steady) state.steadySeconds += dt; }
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
    while (state.dayClock >= DAY_SECONDS && guard++ < MAX_NIGHTS_PER_TICK) { state.dayClock -= DAY_SECONDS; before = 0; events.push(resolveNight(state)); }
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
  function offlineRate(state) { return Math.min(1, OFFLINE_RATE + mods(state).offline); }
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
    state.surgeLeft = 0; state.surgeCool = Math.max(0, state.surgeCool - elapsed);      // 전력 투입은 자리를 비우면 끝난 것으로 친다
    var trade = tradeRate(state) * counted * rate, line = lineRate(state) * counted * rate;
    report.gain = (searchRate(state) + sweepRate(state)) * counted * rate + trade + line;      // 순찰조는 자리를 비운 동안에도 돈다
    earn(state, report.gain);
    state.tradeEarned += trade;
    state.lineEarned += line;
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
    for (var i = 0; i < nights; i++) {
      if (defensePower(state) < nightStrength(state)) { report.held = true; state.day += nights - i; break; }
      var ev = resolveNight(state);
      report.nights++; report.nightReward += ev.reward; report.treats += ev.treats || 0;
    }
    return report;
  }

  /* ---------- 안내 ---------- */
  /** 화면의 '다음 할 일'에 보일 한 줄 { id, text, view }. view 는 그 일을 하는 화면('zone', 'wall', 'trait'). */
  function guide(state) {
    function g(id, text, view) { return { id: id, text: text, view: view || null }; }
    if (state.pendingPerks.length) return g('perk', '특전을 하나 골라 주세요.');
    if (state.clicks === 0 && state.supplies < 15) return g('click', '"잔해 수색"을 눌러 첫 물자를 모아 보세요.');
    if (!totalBuildings(state)) return g('scouts', '구역 > 1구역에서 잔해 수색조를 꾸려 보세요. 그때부터는 가만히 있어도 물자가 들어와요.', 'zone');
    if (!state.siege && defensePower(state) < nightStrength(state)) return g('defend', '방어력이 모자라요. 방벽을 보강해 주세요.', 'wall');
    if (state.antibodies > 0 && TRAITS.some(function (t) { return traitCost(state, t.id) <= state.antibodies; })) return g('trait', '쓸 수 있는 항체 샘플이 있어요. 특성을 찍어 보세요.', 'trait');
    var open = goals(state, state.zone).filter(function (x) { return !x.done; })[0];
    if (open) return g('goal', (state.zone + 1) + '구역 목표: ' + open.text + ' (' + formatNumber(open.value) + ' / ' + formatNumber(open.need) + ')', 'zone');
    var n = nextZone(state);
    if (n && !(n.soon && state.gate)) return g('open', n.zone.no + '구역 ' + n.zone.name + '의 문을 열 차례예요. 물자 ' + formatNumber(n.cost) + ' 이 들어요.', 'zone');
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
  var UNITS = ['만', '억', '조', '경', '해', '자', '양'];
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
    HANDS: HANDS, handBonus: handBonus, handCost: handCost, maxHands: maxHands, buyHand: buyHand, noticeAt: noticeAt, noticeBackText: noticeBackText, noticePlan: noticePlan, NOTICE_FULL_TEXT: NOTICE_FULL_TEXT, NOTICE_FULL_MS: NOTICE_FULL_MS, NOTICE_BACK_MS: NOTICE_BACK_MS, ZOMBIE_KINDS: ZOMBIE_KINDS, ZOMBIE_RARITIES: ZOMBIE_RARITIES, sightZombies: sightZombies, nightSpecials: nightSpecials, sightRoll: sightRoll, zdexCount: zdexCount, ACHIEVEMENTS: ACHIEVEMENTS, ACH_BONUS: ACH_BONUS, achCount: achCount, achMult: achMult, achProgress: achProgress, checkAchievements: checkAchievements, SIGNAL_TREATS: SIGNAL_TREATS, cacheExtra: cacheExtra, CACHE_EXTRA_MAX: CACHE_EXTRA_MAX, TREAT_NIGHT: TREAT_NIGHT, TREAT_BOSS: TREAT_BOSS, PET_LEVEL_MAX: PET_LEVEL_MAX, PET_LEVEL_STEP: PET_LEVEL_STEP, petLevel: petLevel, petFeedCost: petFeedCost, feedPet: feedPet, petEffectText: petEffectText, HERO_DEFAULT: HERO_DEFAULT, fillStory: fillStory, GENDERS: GENDERS, setHeroGender: setHeroGender, hasBatchim: hasBatchim, autoOn: autoOn, AUTO_KEYS: AUTO_KEYS, SELL_AUTO_SECONDS: SELL_AUTO_SECONDS, sellInterval: sellInterval, sweepInterval: sweepInterval, setNotation: setNotation, zoneHistory: zoneHistory, SAVE_VERSION: SAVE_VERSION, DAY_SECONDS: DAY_SECONDS, BATTLE_SECONDS: BATTLE_SECONDS, GROWTH: GROWTH, DEFENSE_GROWTH: DEFENSE_GROWTH,
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
    STAFF_COST: STAFF_COST, STAFF_GROWTH: STAFF_GROWTH, PROJECT_BASE: PROJECT_BASE, PROJECT_GROWTH: PROJECT_GROWTH, OFFER_COUNT: OFFER_COUNT,
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
    ZONES: ZONES, BUILDINGS: BUILDINGS, DEFENSES: DEFENSES, UPGRADES: UPGRADES, PERKS: PERKS, TRAITS: TRAITS, GOALS: GOALS, BEATS: BEATS,
    createState: createState, sanitizeState: sanitizeState, mods: mods, globalMult: globalMult,
    totalBuildings: totalBuildings, sweepRate: sweepRate, incomePerSec: incomePerSec, nextAntibodyAt: nextAntibodyAt, ANTI_STEP: ANTI_STEP, ANTI_CURVE: ANTI_CURVE, AUTO_DEF_STEPS: AUTO_DEF_STEPS, repairInterval: repairInterval, cycleAutoDef: cycleAutoDef, autoDefLeft: autoDefLeft, rerollsLeft: rerollsLeft, rerollPerks: rerollPerks, siegeFactor: siegeFactor, SIEGE_FADE: SIEGE_FADE, SIEGE_FLOOR: SIEGE_FLOOR, milestoneMult: milestoneMult, milestoneTier: milestoneTier, isTap: isTap, nextMilestone: nextMilestone, buildingCost: buildingCost, maxBuildings: maxBuildings, buyBuilding: buyBuilding,
    buildingRate: buildingRate, searchRate: searchRate,
    zoneOpen: zoneOpen, priceRange: priceRange, stallCost: stallCost, maxStalls: maxStalls, buyStall: buyStall, goodsRate: goodsRate, goodsCap: goodsCap,
    goodsValue: goodsValue, sellGoods: sellGoods, setAutoSell: setAutoSell, tradeRate: tradeRate,
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
