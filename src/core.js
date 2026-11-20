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
  var PRODUCT_VALUE = 6e5;          // 완제품 하나의 기준 값(물자)
  var LINE_SCALE = 1 / 10.5;       // 3.2.0: 완제품 값에 곱한다. 기계 셋의 합(레벨당 1 + 2 + 4)이 예전의 '한 줄'보다 많이 만들고 언제나 다 돌아서, 버는 속도를 예전과 같게 맞추는 수(재서 정했다)
  var STEADY_AT = 0.9;             // 가동률이 이 이상이면 '정속 가동'
  var STEADY_BONUS = 0.5;          // 정속 가동일 때 라인 산출에 더하는 비율(+50%)
  var SURGE_MULT = 2;              // 전력 투입 중의 라인 산출 배수
  var SURGE_SECONDS = 15;          // 전력 투입이 이어지는 시간
  var SURGE_COOLDOWN = 90;         // 다시 쓸 수 있을 때까지의 시간(투입을 누른 때부터)
  var ASSIST_MAX = 9;              // 영구 특성 '자동화'의 최대 레벨
  var ASSIST_STEP = 0.06;          // 자동화 2레벨부터 레벨마다 줄어드는 대기 시간의 비율
  var LINE_MILESTONES = [10, 25, 50, 100, 150, 200, 250, 300, 400, 500];      // 3.5.0: 도장 라인이 이 레벨에 닿을 때마다 상자 값 2배
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
  var PROJECT_BASE = 8, PROJECT_STEP = 2;      // 4.0.4: 연구 성과는 '놓은 혈청 수'로 찬다. 첫 성과는 8대, 그 뒤로 2대씩 늘어난다
  var PROJECT_GROWTH = 1.8;        // 과제를 하나 끝낼 때마다 다음 과제의 점수가 오르는 배수
  var OFFER_COUNT = 2;             // 한 번에 내미는 과제 수(3.9.0: 갈림길. 둘 가운데 하나)
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
    // 4.4.6: 강아지 24 · 고양이 24(등급마다 여덟). 4.4.4 의 36종에 12종을 더했다. 그림은 scene.js 의 PET_SPEC(품종 id)로 그린다. body · patch 는 작은 표시(얼굴 칸 등)에 쓰는 대표 색이다
    { id: 'jindo', kind: 'dog', rarity: 'common', name: '흰둥이', body: '#ece6d6', patch: '#ece6d6' },
    { id: 'nureong', kind: 'dog', rarity: 'common', name: '누렁이', body: '#c08a44', patch: '#ead6a6' },
    { id: 'shiba', kind: 'dog', rarity: 'common', name: '시바', body: '#d9903d', patch: '#f3e3c3' },
    { id: 'poodle', kind: 'dog', rarity: 'common', name: '푸들', body: '#c9a27a', patch: '#b08a62' },
    { id: 'beagle', kind: 'dog', rarity: 'common', name: '비글', body: '#f1ede2', patch: '#b8783c' },
    { id: 'dachs', kind: 'dog', rarity: 'common', name: '닥스', body: '#8a4a24', patch: '#8a4a24' },
    { id: 'maltese', kind: 'dog', rarity: 'common', name: '말티즈', body: '#f6f4ee', patch: '#f6f4ee' },
    { id: 'pug', kind: 'dog', rarity: 'common', name: '퍼그', body: '#d8b888', patch: '#2a2622' },
    { id: 'black', kind: 'dog', rarity: 'fine', name: '검둥이', body: '#2e2c2a', patch: '#2e2c2a' },
    { id: 'spot', kind: 'dog', rarity: 'fine', name: '바둑이', body: '#ece6d6', patch: '#2b2a28' },
    { id: 'husky', kind: 'dog', rarity: 'fine', name: '허스키', body: '#8d95a3', patch: '#f1efe8' },
    { id: 'corgi', kind: 'dog', rarity: 'fine', name: '코기', body: '#e0a04a', patch: '#f6efe2' },
    { id: 'collie', kind: 'dog', rarity: 'fine', name: '보더콜리', body: '#252428', patch: '#f1efe8' },
    { id: 'retriever', kind: 'dog', rarity: 'fine', name: '리트리버', body: '#e2b468', patch: '#e2b468' },
    { id: 'schnauzer', kind: 'dog', rarity: 'fine', name: '슈나우저', body: '#8c9096', patch: '#d8dadc' },
    { id: 'doberman', kind: 'dog', rarity: 'fine', name: '도베르만', body: '#2a2422', patch: '#b8783c' },
    { id: 'sapsal', kind: 'dog', rarity: 'rare', name: '삽살이', body: '#a9a39a', patch: '#f0b400' },
    { id: 'wolf', kind: 'dog', rarity: 'rare', name: '늑대개', body: '#5d6470', patch: '#e6e5db' },
    { id: 'pungsan', kind: 'dog', rarity: 'rare', name: '풍산이', body: '#f4f1ea', patch: '#cfd6dd' },
    { id: 'dalma', kind: 'dog', rarity: 'rare', name: '달마', body: '#f4f2ec', patch: '#17171a' },
    { id: 'shepherd', kind: 'dog', rarity: 'rare', name: '셰퍼드', body: '#b8783c', patch: '#2a2420' },
    { id: 'samoyed', kind: 'dog', rarity: 'rare', name: '사모예드', body: '#ffffff', patch: '#ffffff' },
    { id: 'akita', kind: 'dog', rarity: 'rare', name: '아키타', body: '#d88a48', patch: '#f6efe2' },
    { id: 'bernese', kind: 'dog', rarity: 'rare', name: '버니즈', body: '#24222a', patch: '#f1efe8' },
    { id: 'cheese', kind: 'cat', rarity: 'common', name: '치즈', body: '#e0a04a', patch: '#f3e3c3' },
    { id: 'tabby', kind: 'cat', rarity: 'common', name: '고등어', body: '#8d8f94', patch: '#3c3e44' },
    { id: 'white', kind: 'cat', rarity: 'common', name: '흰냥이', body: '#f4f2ec', patch: '#f4f2ec' },
    { id: 'gray', kind: 'cat', rarity: 'common', name: '회색이', body: '#9a9da3', patch: '#9a9da3' },
    { id: 'cow', kind: 'cat', rarity: 'common', name: '젖소냥', body: '#f4f2ec', patch: '#26262a' },
    { id: 'chaos', kind: 'cat', rarity: 'common', name: '카오스', body: '#2e2a26', patch: '#b8783c' },
    { id: 'socks', kind: 'cat', rarity: 'common', name: '양말이', body: '#6a6c72', patch: '#f1efe8' },
    { id: 'cream', kind: 'cat', rarity: 'common', name: '크림이', body: '#f0dcb4', patch: '#f8ecd4' },
    { id: 'tuxedo', kind: 'cat', rarity: 'fine', name: '턱시도', body: '#26262a', patch: '#f1efe8' },
    { id: 'calico', kind: 'cat', rarity: 'fine', name: '삼색이', body: '#f1efe8', patch: '#d0782e' },
    { id: 'bengal', kind: 'cat', rarity: 'fine', name: '벵갈', body: '#d09a50', patch: '#5a3a20' },
    { id: 'russian', kind: 'cat', rarity: 'fine', name: '러블', body: '#7d8ca2', patch: '#7d8ca2' },
    { id: 'scottish', kind: 'cat', rarity: 'fine', name: '스코티시', body: '#b8b0a4', patch: '#8a8478' },
    { id: 'munchkin', kind: 'cat', rarity: 'fine', name: '먼치킨', body: '#e8c08a', patch: '#f6ead6' },
    { id: 'abyssinian', kind: 'cat', rarity: 'fine', name: '아비시니안', body: '#b8763c', patch: '#8a5028' },
    { id: 'sphynx', kind: 'cat', rarity: 'fine', name: '스핑크스', body: '#e8c0b0', patch: '#e8c0b0' },
    { id: 'siam', kind: 'cat', rarity: 'rare', name: '샴', body: '#ece0c8', patch: '#4a3628' },
    { id: 'nero', kind: 'cat', rarity: 'rare', name: '네로', body: '#1a1a1e', patch: '#1a1a1e' },
    { id: 'ragdoll', kind: 'cat', rarity: 'rare', name: '랙돌', body: '#f4f0e8', patch: '#7a6a5c' },
    { id: 'golden', kind: 'cat', rarity: 'rare', name: '브리티시 숏헤어', body: '#e8b04a', patch: '#f8e2b0' },
    { id: 'persian', kind: 'cat', rarity: 'rare', name: '페르시안', body: '#ece6dc', patch: '#ece6dc' },
    { id: 'norwegian', kind: 'cat', rarity: 'rare', name: '노르웨이숲', body: '#8a7058', patch: '#efe4d0' },
    { id: 'maine', kind: 'cat', rarity: 'rare', name: '메인쿤', body: '#6a5038', patch: '#c8a888' },
    { id: 'turkish', kind: 'cat', rarity: 'rare', name: '터키시 앙고라', body: '#f8f6f0', patch: '#f8f6f0' }
  ];
  /*
   * 4.4.6 친구의 효과는 셋이다.
   *   장착 효과: 강아지 칸 하나 · 고양이 칸 하나(party). 장착한 아이는 종류 효과(강아지 방어력 · 고양이 전체 생산, 등급 × 레벨)와 특기를 준다.
   *   특기(PET_SKILLS): 품종마다 하나. 이미 있는 배수 항목(mods)에만 얹는다(새 규칙을 만들지 않아 가볍다). mult 는 곱, add 는 더하기.
   *   보유 효과: 만난 아이마다 종류 효과를 조금씩(PET_OWN: 기본 1% · 고급 2% · 희귀 4%) 더한다. 장착하지 않아도 붙는다.
   *   4.4.9 보유 효과는 간식(강화)으로 커지지 않는다. 모으는 것만으로 정해진다. 강화는 장착 효과만 키운다.
   *   48종을 다 모으면 종류마다 56%로, 장착한 한 아이(최대 105%)보다 작다.
   */
  var PET_OWN = { common: 0.01, fine: 0.02, rare: 0.04 };
  var PET_SKILLS = {
    jindo: { key: 'loot', mult: 1.15, text: '밤 전리품 +15%' },
    nureong: { key: 'click', mult: 1.2, text: '수색 배수 +20%' },
    shiba: { key: 'offline', add: 0.03, text: '자리 비움 효율 +3%p' },
    poodle: { key: 'z2', mult: 1.15, text: '2구역 생산 +15%' },
    beagle: { key: 'lab', mult: 1.1, text: '혈청 값 +10%' },
    dachs: { key: 'z4', mult: 1.15, text: '4구역 화물 값 +15%' },
    black: { key: 'defcost', mult: 0.95, text: '방어 시설 값 -5%' },
    spot: { key: 'hordespeed', mult: 0.92, text: '무리가 다가오는 걸음 -8%' },
    husky: { key: 'cool', mult: 1.2, text: '총열이 20% 빨리 식는다' },
    corgi: { key: 'z1cost', mult: 0.95, text: '1구역 시설 값 -5%' },
    collie: { key: 'z6', mult: 1.2, text: '6구역 생산 +20%' },
    retriever: { key: 'strayfast', mult: 1.2, text: '울타리 밖 생존자가 20% 더 자주 나타난다' },
    sapsal: { key: 'defense', mult: 1.15, text: '방어력 +15% 더' },
    wolf: { key: 'held', mult: 1.3, text: '무리 습격을 막으면 받는 것 +30%' },
    pungsan: { key: 'loss', mult: 0.85, text: '부서진 건물을 고치는 생존자 -15%' },
    dalma: { key: 'nade', add: 1, text: '수류탄이 1마리 빨리 찬다' },
    shepherd: { key: 'nightpay', mult: 1.3, text: '습격을 막으면 오는 생존자 +30%' },
    samoyed: { key: 'antibody', mult: 1.05, text: '철수 항체 샘플 +5%' },
    cheese: { key: 'z1', mult: 1.2, text: '1구역 생산 +20%' },
    tabby: { key: 'cost', mult: 0.98, text: '모든 값 -2%' },
    white: { key: 'offline', add: 0.03, text: '자리 비움 효율 +3%p' },
    gray: { key: 'z3', mult: 1.15, text: '3구역 완제품 값 +15%' },
    cow: { key: 'z2', mult: 1.15, text: '2구역 생산 +15%' },
    chaos: { key: 'loot', mult: 1.15, text: '밤 전리품 +15%' },
    tuxedo: { key: 'z7', mult: 1.2, text: '7구역 생산 +20%' },
    calico: { key: 'reroll', add: 1, text: '특전 다시 뽑기 +1번' },
    bengal: { key: 'click', mult: 1.2, text: '수색 배수 +20%' },
    russian: { key: 'labcost', mult: 0.95, text: '연구 과제 점수 -5%' },
    scottish: { key: 'z4', mult: 1.15, text: '4구역 화물 값 +15%' },
    munchkin: { key: 'straytime', mult: 1.25, text: '울타리 밖 생존자가 25% 더 오래 기다린다' },
    siam: { key: 'antibody', mult: 1.05, text: '철수 항체 샘플 +5%' },
    nero: { key: 'staffcost', mult: 0.9, text: '연구원 값 -10%' },
    ragdoll: { key: 'offline', add: 0.05, text: '자리 비움 효율 +5%p' },
    golden: { key: 'prod', mult: 1.1, text: '전체 생산 +10% 더' },
    persian: { key: 'cap', mult: 1.2, text: '창고 +20%' },
    norwegian: { key: 'lab', mult: 1.2, text: '혈청 값 +20%' },
    maltese: { key: 'ordergap', mult: 0.92, text: '단골 주문이 오는 간격 -8%' },
    pug: { key: 'mergebonus', mult: 1.3, text: '손으로 합칠 때의 덤 +30%' },
    schnauzer: { key: 'wallfix', mult: 1.25, text: '방벽을 25% 더 빨리 고친다' },
    doberman: { key: 'lvcost', mult: 0.95, text: '건물을 올리는 데 드는 생존자 -5%' },
    akita: { key: 'contractgap', mult: 0.85, text: '납품 의뢰가 오는 간격 -15%' },
    bernese: { key: 'muster', mult: 0.95, text: '7구역 습격에 서야 할 경비 -5%' },
    socks: { key: 'z3cost', mult: 0.95, text: '3구역 시설 값 -5%' },
    cream: { key: 'salvagegap', mult: 0.92, text: '표류 화물이 나오는 간격 -8%' },
    abyssinian: { key: 'traincost', mult: 0.95, text: '4구역 시설 값 -5%' },
    sphynx: { key: 'lucky', add: 0.05, text: '들어오는 상자가 한 단계 더 높을 확률 +5%p' },
    maine: { key: 'click', mult: 1.3, text: '수색 배수 +30%' },
    turkish: { key: 'loot', mult: 1.3, text: '밤 전리품 +30%' }
  };
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
          "떠나기 전에 아저씨가 이상한 일을 시켰다. 창고의 절반을 그대로 두고 가자는 것이다. 물, 통조림, 건전지. 문에는 분필로 썼다. “사용하면 채워 놓을 것.”",
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
    { no: 3, name: '공단', kind: 'line', cost: 8e11, lead: '멈춘 공장을 돌려 상자를 합쳐 나간다',
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
    { no: 4, name: '환승역', kind: 'rail', cost: 1e19, lead: '화물칸을 모아 열차를 보낸다',
      story: [
        { title: "행선지", text: [
          "4구역. 환승역 계단을 내려가니 선로가 네 갈래로 갈라진다. 역 안은 캄캄한데 전광판 하나만 켜져 있다. 행선지: 7구역. 도착 예정: --분.",
          "승강장에 열차 한 대가 문을 연 채 서 있다. 좌석마다 가방이 놓여 있다. 사람은 없다. 가방들만 줄 맞춰 앉아서 출발을 기다리고 있다.",
          "맨 앞 칸에서 기관사를 찾았다. 살아 있었다. 운전석에 앉아서 컵라면을 먹고 있었다. “손님이네. 표는 없어도 돼. 이름이 뭐야?” {hero}라고 했더니 승무 일지에 그대로 받아 적었다.",
          "{driver:은} 전기가 나간 날부터 여기 있었다고 했다. 전기가 나갔는데 왜 안 떠났느냐고 물으니 전광판을 가리켰다. “저게 안 꺼지잖아. 저게 켜져 있는 동안은 운행 중인 거야. 내가 정한 건 아니고.”",
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
          "연구가 다시 굴러간다. 아주머니는 알고 보니 임상병리사였다. 그동안 아무도 묻지 않아서 말하지 않았다고 했다. 엄마의 노트를 이틀 만에 다 읽고는 마지막 쪽을 손가락으로 짚었다. “네 피로 만든 혈청이야. 물린 사람이 이걸 한 대 맞으면 놈들로 변해 가던 게 거기서 멈춰. 멈추기만 해. 사람으로 되돌리려면 여섯 대를 맞아야 하고. 네 엄마가 여기까지 알아냈어.”",
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
          "안테나를 세울수록 방송이 멀리 간다. 사람들이 온다. 강을 따라, 선로를 따라, 지붕 위의 7을 따라. 어제는 마흔, 오늘은 백이 넘었다. 아저씨는 문마다 분필로 썼다. “사용하면 채워 놓을 것.”",
          "방송실은 탑의 중간에 있다. 테이프가 혼자 돌고 있었다. 헤드폰을 쓰니 무전기로는 들리지 않던 것이 들렸다. 문장과 문장 사이, 딸깍 소리 바로 앞에, 아주 작게 녹음된 목소리.",
          "“{hero:야}. 우비 벗지 마. 멀리서도 엄마가 알아볼 수 있게.”",
          "숨 쉴 틈도 없이 말하던 그 목소리가 거기서만 느렸다. 테이프가 돌 때마다 그 말이 나왔다. 사태 9일째부터 지금까지. 나는 그 방송을 매일 들으면서 한 번도 듣지 못했다.",
          "책상에는 빈 시험관이 하나 놓여 있었다. 라벨은 114-1. 그 옆에 주사기. 수첩의 마지막 장에는 글씨가 아니라 삐뚤빼뚤한 선만 있었다. 손이 말을 듣지 않는 사람이 쓴 것처럼. 겨우 읽을 수 있는 건 한 줄이었다. “물렸다. 다리에서. 한 대를 맞았다. 변하는 것이 멈췄을 뿐, 돌아오지는 않는다.”"] },
        { title: "길게, 짧게, 길게", text: [
          "꼭대기까지 계단이 백마흔 개였다. 아이들은 올라오지 말랬다고 했지만, 나를 막지는 않았다.",
          "탐조등 옆에 간호사복을 입은 사람이 등을 돌리고 서 있었다. 살갗이 잿빛이다. 강 건너를 보고 있다. 놈들이 서 있는 것처럼 서 있다. 혈청 한 대가, 놈들로 변해 가던 엄마를 중간에서 붙잡아 둔 것이다. 놈들이 다 되지도, 사람으로 돌아오지도 못한 채로. 그 몸으로 밤마다 탐조등을 켜고 아이들 열여섯을 지켜 왔다. 나는 엄마라고 부르지 못하고 우비의 모자를 벗었다.",
          "그 사람이 돌아봤다. 아주 천천히. 반장이 그랬던 것처럼. 다가와서 내 왼쪽 소매에 코를 대고 한참 있었다. 그러고는 소매를 끝까지 내려 주었다. 떨리는 손으로. 그 손을 나는 안다.",
          "엄마는 말을 하지 못했다. 대신 탐조등 스위치에 손을 올렸다. 길게, 짧게, 길게. 저녁밥이 다 됐을 때 현관 불을 그렇게 깜박이던 사람이다. 나는 그게 무슨 신호인지 처음부터 알고 있었다. 모르는 척하고 여기까지 온 것이다.",
          "냉장 상자를 열었다. 혈청이 든 시험관 여섯 개, 114-2부터 114-7. 1구역 다락에서부터 같이 온 쌍둥이네 아주머니가 그것을 받아 들고 말했다. “병원에서 본 노트 그대로야. 한 대는 변하는 걸 멈추기만 해. 여섯 대를 다 맞으면 사람으로 되돌릴 수 있어.” 엄마가 고개를 저었다. 수첩에 선을 그었다. 겨우 읽었다. “애들 먼저.” 열여섯 가운데 열이 나는 애가 넷 있었다.",
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
  /*
   * 3.5.0 3구역의 줄 셋. 전에는 선별기 · 가공기 · 조립기가 모두 '상자 값'만 올렸다(옛 라인의 이름과 숫자를 그대로 둔 것).
   *   이제 셋이 판에서 하는 일이 다르고, 사면 판에서 바로 보인다.
   */
  var MACHINES = [
    { id: 'feed',  name: '투입구',   desc: '상자가 더 자주 들어온다',                           baseCost: 3e10, growth: 2.5,  max: 30 },
    { id: 'forge', name: '단조기',   desc: '들어오는 상자와 놓인 상자가 한 단계 오른다', baseCost: 1e13, growth: 40,   max: 15 },
    { id: 'paint', name: '도장 라인', desc: '상자 값을 올린다',                                 baseCost: 2e10, growth: 1.3, max: 500 }
  ];
  /*
   * 4구역의 노선: 멀리 가는 노선일수록 운행이 오래 걸리지만 같은 시간에 더 많이 싣는다(mult).
   *   seconds 한 번 다녀오는 시간, mult 화물 배수, baseCost 첫 단계(복구)의 값. 단계마다 열차 ROUTE_SLOTS 대가 더 다닐 수 있다.
   * 열차는 배수가 높은 노선부터 알아서 채워 탄다. 화물은 열차가 돌아왔을 때 한꺼번에 들어온다.
   */
  /*
   * 3.8.0 4구역의 줄. 전에는 기관차와 노선 넷(순환선 · 강변선 · 외곽선 · 심야 급행)이 모두 "초당 +얼마"였다: 다섯 줄이 하는 일이 같았다.
   *   이제 셋이고, 승강장에서 하는 일이 다르다(이름은 ROUTES 를 그대로 쓴다: 저장의 routes 칸과 화면의 줄이 이 이름을 본다).
   *     기관차(state.trains)  한 칸의 값을 올린다(꾸준히 올리는 줄. FLEET_MILESTONES 마다 2배)
   *     화물 등급(grade)      붙는 화물칸이 더 값진 것으로 바뀐다(레벨마다 GRADE_STEP 배. 값이 크게 오르는 줄)
   *     연결 작업반(crew)     화물칸이 더 빨리 붙는다(무리가 닿기 전에 더 길게 만들 수 있다)
   */
  var GRADE_STEP = 2, CREW_STEP = 0.96;
  var ROUTES = [
    { id: 'grade', name: '화물 등급',   desc: '더 값진 화물칸이 붙는다',   baseCost: 2e19, growth: 12,  max: 12 },
    { id: 'crew',  name: '연결 작업반', desc: '화물칸이 더 빨리 붙는다',   baseCost: 3e18, growth: 2.5, max: 20 }
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
    { id: 'refine',  name: '항체 정제', desc: '철수 항체 샘플 1.15배', key: 'antibody', mult: 1.15, max: 3 },      // 2.9.6: 3번까지. 끝없이 겹쳐 항체가 두 배 넘게 불었다
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
    { id: 'shifts',  zone: 0, name: '교대 수색', desc: '밤 전리품 +25%',         key: 'loot',    per: 0.25, baseCost: 1e13, growth: 40,   max: 15 },
    { id: 'haggle',  zone: 1, name: '흥정',      desc: '시세의 바닥 +0.1',       key: 'floor',   per: 0.1,  baseCost: 2e5,  growth: 4,   max: 8 },
    { id: 'regular', zone: 1, name: '단골',      desc: '시세의 천장 +0.2',       key: 'ceil',    per: 0.2,  baseCost: 5e5,  growth: 3.2, max: 15 },
    { id: 'stock',   zone: 1, name: '창고 확장', desc: '쌓아 둘 수 있는 양 +100%', key: 'cap',    per: 1,    baseCost: 1e5,  growth: 3,   max: 12 },
    { id: 'scale',   zone: 1, name: '좋은 저울', desc: '상품 값 +25%',           key: 'z2',      per: 0.25, baseCost: 3e5,  growth: 2.4, max: 40 },
    { id: 'manual',  zone: 2, name: '정비 교범', desc: '3구역 시설 값 -4%',      key: 'z3cost',  per: -0.04, baseCost: 3e11, growth: 3,  max: 12 },
    { id: 'bonus',   zone: 2, name: '손맛',      desc: '손으로 합칠 때의 덤 +50%', key: 'mergebonus', per: 0.5, baseCost: 3e11, growth: 4,  max: 10 },
    { id: 'lucky',   zone: 2, name: '행운 상자', desc: '들어오는 상자가 한 단계 더 높을 확률 +10%p', key: 'lucky', per: 0.1, baseCost: 6e11, growth: 5, max: 5 },
    { id: 'wide',    zone: 2, name: '칸 넓히기', desc: '칸이 5개 더 생긴다',     key: 'boardsize', per: 5, baseCost: 5e13, growth: 400, max: 2 },
    { id: 'yard',    zone: 3, name: '정비창',    desc: '4구역 시설 값 -4%',      key: 'traincost', per: -0.04, baseCost: 3e18, growth: 3, max: 12 },
    { id: 'longplat', zone: 3, name: '긴 승강장', desc: '화물칸을 2칸 더 붙일 수 있다', key: 'platlen', per: 2, baseCost: 2e19, growth: 500, max: 2 },
    { id: 'fence',   zone: 3, name: '철조망',    desc: '무리가 다가오는 걸음 -8%', key: 'hordespeed', per: -0.08, baseCost: 2e18, growth: 4, max: 5 },
    { id: 'horn',    zone: 3, name: '경적',      desc: '열차마다 경적을 한 번 더 울릴 수 있다(돌진을 막는다)', key: 'horn', per: 1, baseCost: 8e18, growth: 300, max: 2 },
    { id: 'coupler', zone: 3, name: '튼튼한 연결기', desc: '무리에 닿아도 뒤쪽 3분의 1만 떼인다', key: 'keepmore', per: 1, baseCost: 5e20, growth: 1, max: 1 },
    { id: 'cooler',  zone: 4, name: '냉장 상자',  desc: '혈청을 2대 더 쌓아 둘 수 있다',   key: 'peak',    per: 1,    baseCost: 3e23, growth: 30, max: 3 },
    { id: 'sterile', zone: 4, name: '진정제',    desc: '변하는 줄이 15% 느리게 찬다', key: 'sterile', per: 0.15, baseCost: 2e23, growth: 20, max: 3 },
    { id: 'notes',   zone: 4, name: '연구 노트', desc: '혈청 한 대의 값 +10%',   key: 'lab', per: 0.1, baseCost: 3e23, growth: 3.5, max: 10 },
    { id: 'booth',   zone: 5, name: '검문대',    desc: '통행 물자 +25%',         key: 'z6',      per: 0.25, baseCost: 1.5e27, growth: 2.4, max: 40 },
    { id: 'coolant', zone: 5, name: '냉각수',    desc: '총열이 20% 빨리 식는다',    key: 'cool',    per: 0.2,  baseCost: 2e27, growth: 5,   max: 5 },
    { id: 'sandbag', zone: 5, name: '모래주머니', desc: '방벽이 4 더 버틴다',        key: 'wall',    per: 4,    baseCost: 2e27, growth: 5,   max: 5 },
    { id: 'sapper',  zone: 5, name: '공병',      desc: '방벽을 25% 더 빨리 고친다', key: 'wallfix', per: 0.25, baseCost: 3e27, growth: 5,   max: 4 },
    { id: 'nadebox', zone: 5, name: '수류탄 상자', desc: '수류탄이 4마리 빨리 찬다', key: 'nade',    per: 1,    baseCost: 4e27, growth: 8,   max: 3 },
    { id: 'flare',   zone: 5, name: '조명탄',    desc: '무리 습격을 막으면 받는 것 +50%',  key: 'held',    per: 0.5,  baseCost: 3e27, growth: 4,   max: 6 },
    { id: 'lamp',    zone: 5, name: '탐조등',    desc: '다리 안전도 상한 +0.5',  key: 'margin',  per: 0.5,  baseCost: 5e27, growth: 6,   max: 4 },
    { id: 'amp',     zone: 6, name: '증폭기',    desc: '생존자가 모이는 속도 +25%', key: 'z7',    per: 0.25, baseCost: 1.5e30, growth: 2.4, max: 40 },
    { id: 'dorm',    zone: 4, name: '기숙사',    desc: '5구역 시설 값 -4%',          key: 'staffcost', per: -0.04, baseCost: 2e23, growth: 3, max: 12 },
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
    { id: 'autoline', zone: 2, name: '조립공', desc: '상자가 차면 가장 많이 쌓인 것을 합치고, 다 모인 의뢰를 넘긴다', key: 'autoline', per: 1, baseCost: 2e12, growth: 40, max: 5 },
    { id: 'autosig', zone: 3, name: '역무원',  desc: '꽉 차거나 무리가 가까워지면 알아서 보낸다', key: 'autosig', per: 1, baseCost: 1.5e20, growth: 1, max: 1 },
    // 5·6·7구역의 자동(1.5.1): 단추는 알아서 눌러 주고, 사건은 알아서 받되 절반만 받는다(손으로 하는 쪽이 더 번다)
    { id: 'autolab',   zone: 4, name: '연구 조교',  desc: '혈청을 알아서 만든다', key: 'autolab',   per: 1, baseCost: 5e24, growth: 1, max: 1 },
    { id: 'nurse',   zone: 4, name: '간호사',   desc: '가장 급한 사람에게 알아서 한 대 놓는다(멈추기만 한다)', key: 'nurse',   per: 1, baseCost: 5e24, growth: 1, max: 1 },
    { id: 'autoguard', zone: 5, name: '초소장',     desc: '맨 앞의 것을 알아서 쏘고, 행렬을 알아서 통과시킨다(절반)', key: 'autoguard', per: 1, baseCost: 5e28, growth: 1, max: 1 },
    /* 4.3.2 7구역 개조를 다시 채웠다(다섯뿐이라 살 것이 없었다). 4.3.0 에 뺐던 구급낭 · 봉화는 되살리고, 하는 일이 서로 다른 것 셋을 더했다.
       통나무 울타리 · 훈련 · 수레는 개조가 아니라 운영 화면의 줄(방벽 · 무기고 · 수레)로 옮겼다: 다른 구역처럼 운영에서 살 것이 셋 넷은 되게 */
    { id: 'beacon',  zone: 6, name: '봉화',      desc: '습격을 막으면 오는 생존자 +50%',       key: 'nightpay',  per: 0.5,   baseCost: 5e31, growth: 4, max: 10 },
    { id: 'medkit',  zone: 6, name: '구급낭',    desc: '부서진 건물을 고치는 데 드는 생존자 −15%', key: 'loss',  per: -0.15, baseCost: 3e31, growth: 5, max: 6 },
    { id: 'speaker', zone: 6, name: '확성기',    desc: '울타리 밖의 생존자가 20% 더 자주 나타난다', key: 'strayfast', per: 0.2, baseCost: 2e31, growth: 5, max: 5 },
    { id: 'litter',  zone: 6, name: '들것',      desc: '울타리 밖의 생존자가 25% 더 오래 기다린다', key: 'straytime', per: 0.25, baseCost: 2e31, growth: 6, max: 4 },
    { id: 'blueprint', zone: 6, name: '설계도',  desc: '건물을 올리는 데 드는 생존자 −5%',     key: 'lvcost',    per: -0.05, baseCost: 6e31, growth: 6, max: 8 },
    { id: 'elder',   zone: 6, name: '이장',      desc: '깃발을 꽂아 둔 자리로 알아서 사람을 보낸다. 밤에는 울타리를 절반까지 채운다', key: 'elder', per: 1, baseCost: 8e31, growth: 1, max: 1 },
    { id: 'autotower', zone: 6, name: '송신 기사',  desc: '주파수를 알아서 맞추고, 무전에 알아서 응답한다(절반)', key: 'autotower', per: 1, baseCost: 5e31, growth: 1, max: 1 }
  ];
  /*
   * 특전: 구역의 목표를 달성할 때마다 셋 중 하나를 고른다. 이번 판에만 유효하고 철수하면 사라진다.
   * 같은 특전을 또 고르면 레벨이 오른다. zone 이 있는 특전은 그 구역을 연 뒤에만 나온다(쓸모없는 특전이 섞이지 않게).
   */
  var PERKS = [
    { id: 'harvest', name: '풍작',      desc: '전체 생산 +40%',  key: 'prod',    per: 0.4 },
    { id: 'watch',   name: '불침번',    desc: '방어력 +50%',     key: 'defense', per: 0.5 },
    { id: 'hands',   name: '빠른 손',   desc: '수색 배수 +200%', key: 'click',   per: 2 },
    // 2.8.3: 한 구역에만 듣는 특전 넷은 더 나오지 않는다(retired). "상품 값"이 어느 구역 얘기인지 알기 어렵고, 그 구역을 지나면 쓸모가 없어졌다.
    // 이미 고른 사람의 효과는 그 회차가 끝날 때까지 남는다(그래서 정의는 지우지 않는다).
    { id: 'bargain', name: '입담',      desc: '상품 값 +40%',    key: 'z2',      per: 0.4, zone: 1, retired: true },
    { id: 'foreman', name: '작업 반장', desc: '완제품 값 +40%',  key: 'z3',      per: 0.4, zone: 2, retired: true },
    { id: 'driver',  name: '기관사',    desc: '화물 값 +40%',    key: 'z4',      per: 0.4, zone: 3, retired: true },
    { id: 'aide',    name: '조교',      desc: '5구역 물자 +40%',  key: 'lab',     per: 0.4, zone: 4, retired: true },
    // 대신 어느 구역에서나 듣는 둘: 현재 있는 구역을 따라다니는 생산, 그리고 철수 항체
    { id: 'local',   name: '현장 일손', desc: '현재 구역 생산 +20%', key: 'here', per: 0.2 },
    { id: 'sample',  name: '채혈',      desc: '철수 항체 샘플 +10%', key: 'antibody', per: 0.1, max: 3 },      // 2.8.6: 3레벨까지만. 다시 뽑기로 이것만 쌓으면 샘플이 끝없이 불었다
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
    { id: 'scholar', name: '연구자',    desc: '5구역 물자 +30%',           key: 'lab',     per: 0.3,  baseCost: 3, growth: 1.5,  max: 30 },
    { id: 'rest',    name: '교대 근무', desc: '자리 비움 효율 +5%p',       key: 'offline', per: 0.05, baseCost: 2, growth: 1.6,  max: 10 },
    { id: 'legacy',  name: '기록 보관', desc: '철수로 얻는 항체 샘플 +10%', key: 'antibody', per: 0.1, baseCost: 4, growth: 1.6,  max: 20 },
    { id: 'reroll',  name: '다시 뽑기', desc: '특전 후보를 한 회차에 1번 더 다시 뽑을 수 있다', key: 'reroll', per: 1, baseCost: 3, growth: 1.8, max: 5 },
    { id: 'auto',    name: '자동화',    desc: '조립공이 일하는 간격 -6%', key: 'assist', per: 1, baseCost: 2, growth: 1.6, max: ASSIST_MAX }
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
    [ { id: 'z3a', text: '상자 7단계 만들기', need: 7, value: function (s) { return s.boxBest || 0; } },
      { id: 'z3b', text: '손으로 합치기 40번', need: 40, value: function (s) { return s.mergesRun || 0; } },
      { id: 'z3c', text: '완제품으로 번 물자 누적 10경', need: 1e17, value: function (s) { return s.lineEarned; } } ],
    [ { id: 'z4a', text: '기관차 11레벨', need: 11, value: function (s) { return s.trains; } },
      { id: 'z4b', text: '10칸 이상 열차 3번 보내기', need: 3, value: function (s) { return s.longRuns || 0; } },
      { id: 'z4c', text: '화물로 번 물자 누적 10해', need: 1e21, value: function (s) { return s.railEarned; } } ],
    [ { id: 'z5a', text: '연구원 28명', need: 28, value: function (s) { return s.staff; } },
      { id: 'z5b', text: '혈청 200대 놓기', need: 200, value: function (s) { return s.dosesAll || 0; } },
      { id: 'z5c', text: '사람 20명 되돌리기', need: 20, value: function (s) { return s.curesRun || 0; } } ],
    [ { id: 'z6a', text: '초소 28곳', need: 28, value: function (s) { return s.posts; } },
      { id: 'z6b', text: '손으로 150마리 잡기', need: 150, value: function (s) { return s.handKills || 0; } },
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
      machines: {}, lineEarned: 0, steadySeconds: 0, lineV: 3, board: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], autoMerge: 0, feed: 1, mergesRun: 0, mergesAll: 0, boxBest: 0,
      recipe: 'bolt', mastery: {}, retool: 0, jam: null, jamIn: 90, tuneLeft: 0, truck: null, truckIn: 100, stockSec: 0, repairsRun: 0, trucksRun: 0,      // 3구역: 품목, 고장과 정비, 출하 트럭
      surgeLeft: 0, surgeCool: 0,      // 전력 투입: 남은 시간, 다시 쓸 수 있을 때까지 남은 시간
      // 4구역 노선: routes 노선 단계, routeClock 이번 운행이 지난 시간(초), routeLoad 이번 운행에 실린 화물(열차 × 초)
      trains: 0, routes: {}, routeClock: {}, routeLoad: {}, railEarned: 0, expressRuns: 0, railFlow: true, railV: 2, plat: { t: 0, bank: 0, pos: 1, horn: 0, rush: 0, warn: 0, hand: 0 }, pullsRun: 0, hornsRun: 0, trainsSent: 0, longRuns: 0, hordeHits: 0,
      greenCool: 0,                    // 청신호를 다시 켤 수 있을 때까지 남은 시간
      // 5구역 연구: staff 연구원, points 모인 연구 점수, research 과제별 끝낸 횟수, offers 지금 고를 수 있는 과제, projectsDone 끝낸 과제 수
      staff: 0, points: 0, research: {}, offers: [], projectsDone: 0, boons: { rich: 0, slow: 0, box: 0, quick: 0 }, chartBonus: 0, chartNo: 0, savedRun: 0, racks: 0, reagent: 0, ward: { seats: [], stock: 0, make: 0, nurse: 0, stun: 0, arrive: 0.8, mix: 0, boost: 0, hand: 999, erNext: 35, er: null, pick: null }, labEarned: 0, curesRun: 0, stopsRun: 0, turnedRun: 0, dosesRun: 0, dosesAll: 0, serumTaps: 0, labV: 3, labV4: 1,
      antennas: 0, survivors: 0, serumStage: 0,      // 7구역: 안테나 수, 모인 생존자, 혈청 단계(0~3)
      ended: 0, endedAt: 0, endedRun: false,                          // 이야기를 끝낸 횟수와 처음 끝낸 시각(철수해도 남는다)
      posts: 0, guardEarned: 0, safeNights: 0, bridge: { zs: [], spawn: 1, n: 0, shot: 0, combo: 1, hold: 0, wall: 14, fix: 0, down: 0, hand: 999, waveIn: 25, wave: 0, warn: 0, hurt: 0, nade: 0, streak: 0, heat: 0, jam: 0 }, streakBest: 0, breaches: 0, wavesHeld: 0, firepower: 0, morale: 0, bridgeKills: 0, handKills: 0, bigKills: 0, shotsRun: 0, comboBest: 1,      // 6구역: 초소 수, 통행 물자 누적, 넉넉하게 막은 밤
      // 밤
      day: 1, dayClock: 0, wavesCleared: 0, breaches: 0, siege: false, siegeNights: 0, defStreak: 0, edge: 0, nightEase: 1, counterAt: 0, perkOwed: 0, bossPerks: 0, perkFrom: 'goal',      // defStreak 연속으로 막은 밤, perkOwed 변이체를 막고 아직 못 고른 특전
      // 구조 신호
      signalIn: SIGNAL_FIRST, signalLeft: 0, signalsAnswered: 0, buff: null,
      // 특전(이번 판)
      settle: {}, settleLv: {}, camp: { work: {}, broken: {}, flag: null, clock: 0, night: null, nightLv: 0, day: 1, hand: 999, elder: 0 }, nightsHeld: 0, campBreaches: 0, nightLvBest: 0, sendsRun: 0, guardsLost: 0, straysRun: 0, campRows: { cart: 0, wall7: 0, arms: 0 }, build: null, tune: { t: 0, band: 0.6, cool: 0 }, tuneHits: 0,      // 7구역 정착지와 주파수(3.1.0)
      zev: { rail: null, guard: null, tower: null }, zevIn: { rail: 60, guard: 60, tower: 60 }, railBoost: 0, guardBoost: 0, zevRun: 0, focusLeft: 0, focusCool: 0, push: { guard: { left: 0, cool: 0 }, tower: { left: 0, cool: 0 } },      // 4·6·7구역 사건과 5구역 밤샘 연구
      autoOff: {},      // 구역 index → true 면 그 구역의 주문·사건 자동을 꺼 둔 것(철수해도 남는다)
      elderOff: false,      // 4.3.8: 7구역 이장을 꺼 둔 것(철수해도 남는다). 송신 기사(autoOff[6])와 따로 켜고 끈다
      goalExt: {},      // 목표 id → 채운 연장 단계 수(이번 회차)
      goalPick: {},      // 이번 회차의 목표 고르기(구역 index → 자리별 0|1). 비어 있으면 원래 목표 셋
      perks: {}, pendingPerks: [], goalsDone: {}, rerollsUsed: 0,      // rerollsUsed: 이번 판에 특전을 다시 뽑은 횟수(철수하면 0)
      // 영구
      pet: null,             // 지금 데리고 다니는 동물 친구 { kind, breed, name }. 없으면 null. 철수해도 남는다
      treats: 0,             // 간식: 친구를 키우는 재화(철수해도 남는다)
      petLv: {},             // 친구마다의 레벨 { 품종: 레벨 }
      party: { dog: null, cat: null },   // 4.4.6 장착한 친구(강아지 칸 · 고양이 칸의 품종 id). pet 은 그 가운데 라라 곁을 걷고 간식을 받는 아이
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
      danger: 0,             // 이번 회차의 위험 단계
      dangerNext: 0,         // 다음 회차에 걸 위험 단계(철수하면 쓰인다)
      bestDanger: 0,         // 끝을 본 가장 높은 위험 단계
      rescued: 0,            // 끝을 볼 때마다 더해지는 구조한 생존자(누적)
      bests: { time: 0, byDanger: {} },      // 가장 빨리 끝낸 시간(초): 전체, 단계별
      endLog: [],            // 최근에 본 끝 10번 [{ danger, seconds, retreats, saved }]
      tickets: 0,            // 뽑기권
      shards: 0,             // 중복으로 받은 조각
      cosmetics: {},         // 가진 외형 { id: true } (기본 외형은 적지 않는다)
      wear: { coat: 'coat-yellow', hood: 'hood-none', pat: 'pat-none', bag: 'bag-cooler', fx: 'fx-none', pet: 'pet-none', flag: 'flag-yellow' },      // 입은 외형(자리마다 하나)
      gachaPity: 0,          // 전설이 나온 뒤로 뽑은 횟수(보장 계산)
      gachaPulls: 0,         // 지금까지 뽑은 횟수
      stage: null,           // 원정 스테이지로 만든 상태에만 있다 { id, hard, won, lost, seconds }
      stageGoal: {},         // 본 게임: 원정마다 지금 걸린 목표의 번호(3.0.6). 철수해도 남는다
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
    // 3.3.0 합치기 판. 판이 없는 옛 저장은 '가만히 둔 판의 평균'에 가까운 판으로 시작한다(업데이트했다고 수입이 0부터 다시 오르지 않게)
    s.board = []; for (var bi = 0; bi < BOARD_MAX; bi++) s.board.push(Array.isArray(raw.board) ? clamp(safeCount(raw.board[bi]), 0, BOX_MAX) : 0);
    MACHINES.forEach(function (d) { s.machines[d.id] = Math.min(d.max, s.machines[d.id] || 0); });
    s.autoMerge = clamp(safeNum(raw.autoMerge, 0), 0, 2);
    var seedBoard = !Array.isArray(raw.board) && s.zone >= 2;      // 판이 없던 옛 저장: 아래 3.5.0 옮기기가 끝난 뒤에 상자 몇 개를 놓아 준다
    s.feed = typeof raw.feed === 'number' && isFinite(raw.feed) ? Math.min(2, raw.feed) : 1; s.mergesRun = clamp(safeCount(raw.mergesRun), 0, 1e9); s.boxBest = clamp(safeCount(raw.boxBest), 0, BOX_MAX); s.mergesAll = clamp(safeCount(raw.mergesAll), 0, 1e12);
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
    if (s.kennel.golden === '금냥이') s.kennel.golden = '브리티시 숏헤어';      // 4.4.4: 금냥이가 브리티시 숏헤어가 됐다(기본 이름 그대로였던 아이만 바꾼다)
    s.pet = null;
    if (raw.pet && typeof raw.pet === 'object') {
      var breed = findById(PET_BREEDS, raw.pet.breed);
      if (breed) {
        if (!s.kennel[breed.id]) s.kennel[breed.id] = cleanName(raw.pet.name, breed.name);       // 알파 0.7.5 의 저장: 친구가 하나뿐이었다
        s.pet = { kind: breed.kind, breed: breed.id, name: s.kennel[breed.id] };
      }
    }
    // 4.4.6 장착 칸: 함께 있는 아이이고 종류가 맞을 때만 받는다. 예전 저장은 데리고 다니던 아이가 그 종류 칸에 들어간다
    s.party = { dog: null, cat: null };
    var rp = raw.party && typeof raw.party === 'object' && !Array.isArray(raw.party) ? raw.party : {};
    ['dog', 'cat'].forEach(function (k) { var b = findById(PET_BREEDS, rp[k]); if (b && b.kind === k && s.kennel[b.id]) s.party[k] = b.id; });
    if (s.pet) s.party[s.pet.kind] = s.pet.breed;      // 데리고 다니는 아이는 늘 자기 칸에 장착돼 있다
    s.surgeLeft = clamp(safeNum(raw.surgeLeft, 0), 0, SURGE_SECONDS);
    // 3.5.0: 품목 · 숙련 · 고장 · 트럭은 없앴다. 칸만 남겨 둔다(옛 저장을 읽어도 탈이 없게)
    s.recipe = 'bolt'; s.mastery = {}; s.retool = 0; s.tuneLeft = 0; s.jamIn = 90; s.truckIn = 100; s.jam = null; s.truck = null; s.stockSec = 0;
    s.repairsRun = clamp(safeCount(raw.repairsRun), 0, 1e9); s.trucksRun = clamp(safeCount(raw.trucksRun), 0, 1e9);
    s.surgeCool = clamp(safeNum(raw.surgeCool, 0), 0, SURGE_COOLDOWN);
    s.sweepMask = safeCount(raw.sweepMask) % (1 << SWEEP_TILES);
    s.sweepSeed = Math.max(1, safeCount(raw.sweepSeed) % 1000000);
    s.sweepClock = clamp(safeNum(raw.sweepClock, 0), 0, SWEEP_AUTO_SECONDS);
    s.staff = Math.min(s.staff, COUNT_MAX);
    // 3.9.0 시험관
    s.racks = clamp(safeCount(raw.racks), 0, SEAT_MAX - SEAT_BASE); s.reagent = clamp(safeCount(raw.reagent), 0, REAGENT_MAX);
    s.labEarned = clamp(safeNum(raw.labEarned, 0), 0, 1e300);
    s.curesRun = clamp(safeCount(raw.curesRun), 0, 1e12); s.stopsRun = clamp(safeCount(raw.stopsRun), 0, 1e12); s.turnedRun = clamp(safeCount(raw.turnedRun), 0, 1e12); s.dosesRun = clamp(safeCount(raw.dosesRun), 0, 1e12); s.serumTaps = clamp(safeCount(raw.serumTaps), 0, 1e12);
    var rw = raw.ward && typeof raw.ward === 'object' ? raw.ward : {};
    s.ward = { seats: [], stock: clamp(safeCount(rw.stock), 0, 40), make: clamp(safeNum(rw.make, 0), 0, 1), nurse: clamp(safeNum(rw.nurse, 0), 0, 1), stun: 0, arrive: clamp(safeNum(rw.arrive, 0), 0, 1) };
    /* 4.0.8 급한 환자 · 회진 차트 · 강화 혈청. 저장이 깨져 있어도 놀이가 멈추지 않게 하나하나 걸러 읽는다 */
    s.boons = {}; BOONS.forEach(function (d) { if (d.id !== 'cash') s.boons[d.id] = clamp(safeCount(raw.boons && typeof raw.boons === 'object' ? raw.boons[d.id] : 0), 0, d.max); });
    s.chartBonus = clamp(safeNum(raw.chartBonus, 0), 0, CHART_MAX); s.chartNo = clamp(safeCount(raw.chartNo), 0, 1e9); s.savedRun = clamp(safeCount(raw.savedRun), 0, 1e12);
    s.ward.mix = clamp(safeCount(rw.mix), 0, 999); s.ward.boost = rw.boost ? 1 : 0; s.ward.hand = 999; s.ward.erNext = clamp(safeNum(rw.erNext, ER_FIRST), 1, ER_EVERY);
    s.ward.er = rw.er && typeof rw.er === 'object' ? { t: clamp(safeNum(rw.er.t, ER_TIME), 1, ER_TIME), dose: clamp(safeCount(rw.er.dose), 0, WARD_DOSES - 1), look: clamp(safeCount(rw.er.look), 0, 999) } : null;
    s.ward.pick = Array.isArray(rw.pick) && rw.pick.length === 2 && rw.pick.every(function (id) { return !!BOON_BY[id]; }) && rw.pick[0] !== rw.pick[1] ? rw.pick.slice() : null;
    var rc5 = rw.chart && typeof rw.chart === 'object' && Array.isArray(rw.chart.lines) ? rw.chart : null;
    if (rc5 && rc5.lines.length === 3 && rc5.lines.every(function (l) { return l && typeof l === 'object' && CHART_TEXT[l.k]; })) s.ward.chart = { hard: !!rc5.hard, done: !!rc5.done, lines: rc5.lines.map(function (l) { var need = clamp(safeCount(l.need), 1, 999); return { k: l.k, need: need, have: clamp(safeCount(l.have), 0, need) }; }) };
    (Array.isArray(rw.seats) ? rw.seats : []).slice(0, SEAT_MAX).forEach(function (p) {
      p = p && typeof p === 'object' ? p : {};
      if (typeof p.dose === 'number' && p.dose >= 0) s.ward.seats.push({ m: clamp(safeNum(p.m, 0), 0, 0.999), dose: clamp(safeCount(p.dose), 0, WARD_DOSES - 1), r: clamp(safeNum(p.r, 1), 0.5, 3), look: clamp(safeCount(p.look), 0, 999), since: clamp(safeNum(p.since, 0), 0, 1e6) });
      else s.ward.seats.push({ wait: 0 });
    });
    /* 옛 저장 옮기기.
       labV 2 미만(3.9.0 이전): 없앤 개조 '현미경'에 쓴 물자만큼 시약 등급을 사 준 것으로 한다.
       labV 3 미만(4.0.2 이전, 시험관 시절): 시험관 수(racks, 최대 8)는 의자 수(최대 4)로 줄이고 남는 것은 시약 등급으로 돌린다.
         자동이 둘로 나뉘었으니, 연구 조교가 있던 저장에는 간호사도 준다(자동으로 돌던 구역이 멈추지 않게). */
    if (raw.labV !== 2 && raw.labV !== 3 && s.zone >= 4) {
      var rup5 = raw.upgrades && typeof raw.upgrades === 'object' ? raw.upgrades : {}, n5 = clamp(safeCount(rup5.scope), 0, 40), bud5 = n5 > 0 ? seriesCost(1e23, 2.4, 0, n5) : 0;
      for (var g5 = 0; g5 < 40 && s.reagent < REAGENT_MAX; g5++) { var gc5 = REAGENT_COST * Math.pow(REAGENT_GROWTH, s.reagent); if (gc5 <= bud5) { s.reagent++; bud5 -= gc5; } else break; }
    }
    if (raw.labV !== 3) {
      var extra5 = clamp(safeCount(raw.racks), 0, 8) - (SEAT_MAX - SEAT_BASE); if (extra5 > 0) s.reagent = Math.min(REAGENT_MAX, s.reagent + Math.ceil(extra5 / 2));
    }
    if (raw.labV !== 3 || raw.labV4 !== 1) { s.points = 0; s.offers = []; }      // 4.0.5: 연구 성과를 없앴다. 쌓여 있던 점수와 내밀던 과제는 버린다(이미 고른 효과는 이번 회차 동안 남는다)
    s.labV = 3; s.labV4 = 1;
    s.dosesAll = clamp(safeCount(raw.dosesAll), 0, 1e12);
    s.posts = clamp(safeCount(raw.posts), 0, COUNT_MAX); s.guardEarned = Math.max(0, safeNum(raw.guardEarned, 0)); s.safeNights = clamp(safeCount(raw.safeNights), 0, 1e9);
    if (s.zone < 5) { s.posts = 0; }
    // 3.9.7 다리
    s.firepower = clamp(safeCount(raw.firepower), 0, FIRE_MAX); s.morale = clamp(safeCount(raw.morale), 0, MORALE_MAX);
    s.bridgeKills = clamp(safeCount(raw.bridgeKills), 0, 1e12); s.handKills = clamp(safeCount(raw.handKills), 0, 1e12); s.bigKills = clamp(safeCount(raw.bigKills), 0, 1e12); s.shotsRun = clamp(safeCount(raw.shotsRun), 0, 1e12); s.comboBest = clamp(safeNum(raw.comboBest, 1), 1, 10);
    var rb = raw.bridge && typeof raw.bridge === 'object' ? raw.bridge : {};
    s.bridge = { zs: [], spawn: clamp(safeNum(rb.spawn, 1), 0, 6), n: clamp(safeCount(rb.n), 0, 1e12), shot: clamp(safeNum(rb.shot, 0), 0, 2), combo: clamp(safeNum(rb.combo, 1), 1, 10), hold: clamp(safeNum(rb.hold, 0), 0, 60),
      wall: clamp(safeCount(rb.wall === undefined ? WALL_BASE : rb.wall), 0, 99), fix: clamp(safeNum(rb.fix, 0), 0, 1), down: clamp(safeNum(rb.down, 0), 0, BREACH_SECONDS), hand: 999, waveIn: clamp(safeNum(rb.waveIn, WAVE_FIRST), 1, WAVE_EVERY), wave: 0, warn: 0, hurt: 0, nade: clamp(safeCount(rb.nade), 0, NADE_KILLS), streak: clamp(safeCount(rb.streak), 0, 99), heat: clamp(safeNum(rb.heat, 0), 0, 1), jam: clamp(safeNum(rb.jam, 0), 0, JAM_SECONDS) };
    s.streakBest = clamp(safeCount(raw.streakBest), 0, 99);
    s.breaches = clamp(safeCount(raw.breaches), 0, 1e12); s.wavesHeld = clamp(safeCount(raw.wavesHeld), 0, 1e12);
    (Array.isArray(rb.zs) ? rb.zs : []).slice(0, 60).forEach(function (z) { if (!z || typeof z !== 'object') return; var kk = BRIDGE_KINDS[z.k] ? z.k : z.big ? 'big' : 'norm', mx = clamp(safeCount(z.max), BRIDGE_KINDS[kk].hp, BRIDGE_KINDS[kk].hp * 9); if (!(z.x > 0 && z.x <= 1.2) || !(z.hp > 0)) return; s.bridge.zs.push({ x: z.x, hp: Math.min(mx, z.hp), max: mx, big: kk === 'big' ? 1 : 0, k: kk, id: clamp(safeCount(z.id), 0, 999) }); if (z.w) s.bridge.zs[s.bridge.zs.length - 1].w = 1; });
    s.antennas = s.zone >= 6 ? clamp(safeCount(raw.antennas), 0, COUNT_MAX) : 0; s.survivors = s.zone >= 6 ? clamp(safeNum(raw.survivors, 0), 0, 1e15) : 0;
    s.serumStage = s.zone >= 6 ? clamp(safeCount(raw.serumStage), 0, SERUM_COSTS.length) : 0;
    s.endedRun = !!raw.endedRun && s.zone >= 6;
    s.medals = {}; CHALLENGES.forEach(function (d) { var n = raw.medals && typeof raw.medals === 'object' ? clamp(safeCount(raw.medals[d.id]), 0, 1e6) : 0; if (n > 0) s.medals[d.id] = n; });
    s.challengeStreak = clamp(safeCount(raw.challengeStreak), 0, 1e6);
    s.stageMarks = {}; STAGES.forEach(function (d) { var m = raw.stageMarks && typeof raw.stageMarks === 'object' ? raw.stageMarks[d.id] : null; if (m && typeof m === 'object' && (m.clear || m.speed || m.hard || m.pct > 0 || m.fails > 0)) s.stageMarks[d.id] = { clear: !!m.clear, speed: !!m.speed, hard: !!m.hard, hardSpeed: !!m.hardSpeed, safe: !!m.safe, hardSafe: !!m.hardSafe, best: clamp(safeCount(m.best), 0, 1e6), pct: clamp(safeNum(m.pct, 0), 0, 1), steps: clamp(safeCount(m.steps), 0, STAGE_STEPS), fails: clamp(safeCount(m.fails), 0, STAGE_RETRY_MAX) }; });
    s.bestDanger = clamp(safeCount(raw.bestDanger), 0, DANGER_MAX); s.danger = clamp(safeCount(raw.danger), 0, DANGER_MAX); s.dangerNext = clamp(safeCount(raw.dangerNext), 0, DANGER_MAX); s.rescued = clamp(safeNum(raw.rescued, 0), 0, 1e18);
    s.bests = { time: 0, byDanger: {} };
    if (raw.bests && typeof raw.bests === 'object') { s.bests.time = clamp(safeCount(raw.bests.time), 0, 1e9); if (raw.bests.byDanger && typeof raw.bests.byDanger === 'object') for (var dk = 0; dk <= DANGER_MAX; dk++) { var dv = clamp(safeCount(raw.bests.byDanger[dk]), 0, 1e9); if (dv > 0) s.bests.byDanger[dk] = dv; } }
    s.endLog = Array.isArray(raw.endLog) ? raw.endLog.filter(function (e) { return e && typeof e === 'object'; }).slice(-10).map(function (e) { return { danger: clamp(safeCount(e.danger), 0, DANGER_MAX), seconds: clamp(safeCount(e.seconds), 0, 1e9), retreats: clamp(safeCount(e.retreats), 0, 1e9), saved: clamp(safeNum(e.saved, 0), 0, 1e18) }; }) : [];
    s.tickets = clamp(safeCount(raw.tickets), 0, 1e9); s.shards = clamp(safeCount(raw.shards), 0, 1e9); s.gachaPity = clamp(safeCount(raw.gachaPity), 0, GACHA_PITY - 1); s.gachaPulls = clamp(safeCount(raw.gachaPulls), 0, 1e9);
    s.cosmetics = {}; COSMETICS.forEach(function (c) { if (!c.base && raw.cosmetics && typeof raw.cosmetics === 'object' && raw.cosmetics[c.id]) s.cosmetics[c.id] = true; });
    s.wear = { coat: 'coat-yellow', hood: 'hood-none', pat: 'pat-none', bag: 'bag-cooler', fx: 'fx-none', pet: 'pet-none', flag: 'flag-yellow' };
    COS_SLOTS.forEach(function (slot) { var id = raw.wear && typeof raw.wear === 'object' ? raw.wear[slot] : '', c = typeof id === 'string' ? findById(COSMETICS, id) : null; if (c && c.slot === slot && (c.base || s.cosmetics[c.id])) s.wear[slot] = c.id; });
    grantFlags(s);      // 조건을 이미 채운 깃발(2.0.0 전의 저장)
    s.stageGoal = {}; STAGES.forEach(function (d) { var gi = raw.stageGoal && typeof raw.stageGoal === 'object' ? safeCount(raw.stageGoal[d.id]) : 0; if (gi > 0 && d.goals && gi < d.goals.length) s.stageGoal[d.id] = gi; });
    s.stage = null;      // 스테이지 판은 저장하지 않는다(저장되는 것은 언제나 본 게임이다)
    s.nextChallenge = typeof raw.nextChallenge === 'string' && findById(CHALLENGES, raw.nextChallenge) ? raw.nextChallenge : '';
    s.challenge = raw.challenge && typeof raw.challenge === 'object' && findById(CHALLENGES, raw.challenge.id) ? { id: raw.challenge.id, failed: !!raw.challenge.failed, done: !!raw.challenge.done } : null;
    s.ended = clamp(safeCount(raw.ended), 0, 1e6); s.endedAt = Math.max(0, safeNum(raw.endedAt, 0));
    s.research = counts(PROJECTS, raw.research, 200);
    s.offers = [];
    (Array.isArray(raw.offers) ? raw.offers : []).forEach(function (id) { if (findById(PROJECTS, id) && s.offers.indexOf(id) < 0 && s.offers.length < OFFER_COUNT) s.offers.push(id); });
    if (raw.labV4 !== 1) s.offers = [];      // 4.0.5: 연구 성과를 없앴다
    s.trains = Math.min(s.trains, TRAIN_MAX);
    s.greenCool = clamp(safeNum(raw.greenCool, 0), 0, GREEN_COOLDOWN);
    s.routes = counts(ROUTES, raw.routes, ROUTE_MAX); ROUTES.forEach(function (d) { s.routes[d.id] = Math.min(d.max, s.routes[d.id] || 0); });
    ROUTES.forEach(function (d) {
      var rc = raw.routeClock && typeof raw.routeClock === 'object' ? raw.routeClock[d.id] : 0, rl = raw.routeLoad && typeof raw.routeLoad === 'object' ? raw.routeLoad[d.id] : 0;
      s.routeLoad[d.id] = 0; s.routeClock[d.id] = 0;      // 3.4.0: 노선마다 따로 달리던 시계는 쓰지 않는다
    });
    /*
     * 3.5.0 옛 저장(lineV 3 미만): 줄과 개조가 통째로 바뀌었다. 옛 기계 셋과 없앤 개조(윤활유 · 컨베이어 · 예비 부품)에 쓴 물자를 셈해서,
     *   그 물자로 새 줄을 '값에 견줘 가장 이득인 것부터' 사 준 것으로 한다. 가진 물자는 건드리지 않는다.
     */
    if (raw.lineV !== 3 && s.zone >= 2) {
      var rmach = raw.machines && typeof raw.machines === 'object' ? raw.machines : {}, rup = raw.upgrades && typeof raw.upgrades === 'object' ? raw.upgrades : {}, budget = 0;
      [['sorter', 2e10, 1.15, 5000], ['press', 4e10, 1.15, 5000], ['assembler', 8e10, 1.15, 5000]].forEach(function (o) { var n = clamp(safeCount(rmach[o[0]]), 0, o[3]); if (n > 0) budget += seriesCost(o[1], o[2], 0, n); });
      [['lube', 1.5e11, 2.4, 40], ['belt', 6e11, 3.5, 10], ['spare', 3e11, 4, 5]].forEach(function (o) { var n = clamp(safeCount(rup[o[0]]), 0, o[3]); if (n > 0) budget += seriesCost(o[1], o[2], 0, n); });
      MACHINES.forEach(function (d) { s.machines[d.id] = 0; });
      for (var guard = 0; guard < 3000 && isFinite(budget); guard++) {
        var pick = null, score = -1, cost = 0;
        MACHINES.forEach(function (d) { var lv = s.machines[d.id]; if (lv >= d.max) return; var c = seriesCost(d.baseCost, d.growth, lv, 1), g = machineGain(s, d.id) / c; if (c <= budget && g > score) { score = g; pick = d.id; cost = c; } });
        if (!pick) break;
        s.machines[pick]++; budget -= cost;
      }
    }
    s.lineV = 3;
    // 들어오는 단계보다 낮은 상자는 짝이 영영 생기지 않는다(옛 저장을 옮길 때 줄만 올라가서 생겼다). 들어오는 단계로 올려 준다
    for (var lowi = 0; lowi < s.board.length; lowi++) if (s.board[lowi] >= 1 && s.board[lowi] < spawnLevel(s)) s.board[lowi] = spawnLevel(s);
    if (seedBoard) [5, 4, 3, 2, 1, 0].forEach(function (up, k) { s.board[k * 3] = Math.min(BOX_MAX, spawnLevel(s) + up); });
    for (var bz = boardSize(s); bz < BOARD_MAX; bz++) s.board[bz] = 0;      // 칸 수 밖의 상자는 없다
    /*
     * 3.8.0 옛 저장(railV 2 미만): 노선 넷과 없앤 개조(신호기 · 시간표 · 선로 정비 · 차량 기지)에 쓴 물자를 셈해서, 그 물자로 화물 등급과 연결 작업반을 사 준 것으로 한다.
     *   기관차 레벨과 가진 물자는 그대로다.
     */
    if (raw.railV !== 2 && s.zone >= 3) {
      var rro = raw.routes && typeof raw.routes === 'object' ? raw.routes : {}, rup4 = raw.upgrades && typeof raw.upgrades === 'object' ? raw.upgrades : {}, bud4 = 0;
      [['loop', 1e18, 2.2, 25], ['river', 1e19, 2.2, 25], ['outer', 1e20, 2.2, 25], ['express', 1e21, 2.2, 25]].forEach(function (o) { var n = clamp(safeCount(rro[o[0]]), 0, o[3]); if (n > 0) bud4 += seriesCost(o[1], o[2], 0, n); });
      [['signal', 1e18, 2.4, 40], ['timetable', 3e18, 4, 8], ['tracks', 3e18, 3, 12], ['depot', 3e18, 3, 12]].forEach(function (o) { var n = clamp(safeCount(rup4[o[0]]), 0, o[3]); if (n > 0) bud4 += seriesCost(o[1], o[2], 0, n); });
      ROUTES.forEach(function (d) { s.routes[d.id] = 0; });
      for (var g4 = 0; g4 < 200 && isFinite(bud4); g4++) {
        // 화물 등급을 먼저(값이 크게 오른다), 등급 하나 값의 5분의 1 아래인 동안은 작업반도 함께
        var gd = ROUTES[0], cw = ROUTES[1], gc = s.routes.grade < gd.max ? seriesCost(gd.baseCost, gd.growth, s.routes.grade, 1) : Infinity, cc = s.routes.crew < cw.max ? seriesCost(cw.baseCost, cw.growth, s.routes.crew, 1) : Infinity;
        if (cc <= bud4 && cc < gc / 5) { s.routes.crew++; bud4 -= cc; }
        else if (gc <= bud4) { s.routes.grade++; bud4 -= gc; }
        else if (cc <= bud4) { s.routes.crew++; bud4 -= cc; }
        else break;
      }
    }
    s.railV = 2;
    s.railFlow = raw.railFlow === true;      // 없으면 옛 저장: 싣고 달리던 화물을 stepRail 이 처음 한 번 내려 준다
    // 3.4.0 승강장의 열차. 깨진 값이나 옛 저장은 새 열차로 시작한다
    var rp = raw.plat && typeof raw.plat === 'object' ? raw.plat : {};
    s.plat = { t: clamp(safeNum(rp.t, 0), 0, 3600), bank: clamp(safeNum(rp.bank, 0), 0, 1e300), pos: typeof rp.pos === 'number' && rp.pos >= 0 && rp.pos <= 1 ? rp.pos : 1, horn: clamp(safeCount(rp.horn), 0, 9), rush: rp.rush === -1 ? -1 : typeof rp.rush === 'number' && rp.rush > 0 && rp.rush <= 1 ? rp.rush : 0, warn: clamp(safeNum(rp.warn, 0), 0, 5), hand: rp.hand ? 1 : 0 };
    s.pullsRun = clamp(safeCount(raw.pullsRun), 0, 1e12); s.hornsRun = clamp(safeCount(raw.hornsRun), 0, 1e12);
    s.longRuns = clamp(safeCount(raw.longRuns), 0, 1e12); s.hordeHits = clamp(safeCount(raw.hordeHits), 0, 1e12);
    s.trainsSent = clamp(safeCount(raw.trainsSent), 0, 1e12);
    s.upgrades = counts(UPGRADES, raw.upgrades, function (u) { return u.max; });
    if (raw.labV !== 3 && (s.upgrades.autolab || 0) > 0) s.upgrades.nurse = 1;      // 4.0.3: 자동이 둘로 나뉘었다. 연구 조교가 있던 저장에는 간호사도 준다
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
    s.settle = {}; SETTLE.forEach(function (d) { if (raw.settle && typeof raw.settle === 'object' && raw.settle[d.id] && s.zone >= 6) s.settle[d.id] = true; });
    var rt = raw.tune && typeof raw.tune === 'object' ? raw.tune : {};
    s.tune = { t: clamp(safeNum(rt.t, 0), 0, TUNE_PERIOD * 2), band: clamp(safeNum(rt.band, 0.6), 0.15, 0.85), cool: clamp(safeNum(rt.cool, 0), 0, TUNE_COOL) };
    s.tuneHits = safeCount(raw.tuneHits);
    /* 4.2.0 정착지: 단계 · 놓는 중인 사람 · 부서진 건물 · 낮과 밤. 옛 저장의 '짓는 중'(build)은 그 건물에 사람을 다 놓은 것으로 옮긴다(이미 맡긴 사람이므로) */
    s.settleLv = {}; s.camp = newCamp(); s.build = null;
    var rl7 = raw.settleLv && typeof raw.settleLv === 'object' ? raw.settleLv : {}, rc7 = raw.camp && typeof raw.camp === 'object' ? raw.camp : {}, rw7 = rc7.work && typeof rc7.work === 'object' ? rc7.work : {}, rk7 = rc7.broken && typeof rc7.broken === 'object' ? rc7.broken : {};
    SETTLE.forEach(function (d) { if (s.settle[d.id]) { s.settleLv[d.id] = clamp(Math.floor(safeNum(rl7[d.id], 1)) || 1, 1, LV_MAX7); if (rk7[d.id]) s.camp.broken[d.id] = true; } });
    SETTLE.forEach(function (d) { var w = clamp(safeCount(rw7[d.id]), 0, 1e15), need = settleNeed(s, d.id); if (w > 0 && need > 0 && s.zone >= 6) s.camp.work[d.id] = Math.min(w, need - 1); });
    var rb = raw.build && typeof raw.build === 'object' ? findById(SETTLE, raw.build.id) : null;
    if (rb && s.zone >= 6 && !s.settle[rb.id]) { s.settle[rb.id] = true; s.settleLv[rb.id] = 1; }
    s.camp.flag = findById(SETTLE, rc7.flag) ? rc7.flag : null; s.camp.clock = clamp(safeNum(rc7.clock, 0), 0, RAID_EVERY); s.camp.nightLv = clamp(safeCount(rc7.nightLv), 0, NIGHT_LV_MAX); s.camp.day = clamp(safeCount(rc7.day) || 1, 1, 1e9);
    s.nightsHeld = clamp(safeCount(raw.nightsHeld), 0, 1e12); s.campBreaches = clamp(safeCount(raw.campBreaches), 0, 1e12); s.nightLvBest = clamp(safeCount(raw.nightLvBest), 0, NIGHT_LV_MAX); s.guardsLost = clamp(safeNum(raw.guardsLost, 0), 0, 1e15); s.straysRun = clamp(safeCount(raw.straysRun), 0, 1e12);
    var rr7 = raw.campRows && typeof raw.campRows === 'object' ? raw.campRows : {}, ru7 = raw.upgrades && typeof raw.upgrades === 'object' ? raw.upgrades : {}, old7 = { cart: 'wagon', wall7: 'palisade', arms: 'muster' };      // 옛 개조(수레 · 통나무 울타리 · 훈련)는 줄로 옮긴다
    s.campRows = {}; CAMP_ROWS.forEach(function (d) { s.campRows[d.id] = s.zone >= 6 ? clamp(Math.max(safeCount(rr7[d.id]), safeCount(ru7[old7[d.id]])), 0, d.max) : 0; }); s.sendsRun = clamp(safeCount(raw.sendsRun), 0, 1e12);
    PUSHES.forEach(function (d) { var q = rp[d.id] && typeof rp[d.id] === 'object' ? rp[d.id] : {}, openZ = s.zone >= d.zone; s.push[d.id] = { left: openZ ? clamp(safeNum(q.left, 0), 0, PUSH_SECONDS) : 0, cool: openZ ? clamp(safeNum(q.cool, 0), 0, PUSH_COOL) : 0 }; });
    s.edge = clamp(safeNum(raw.edge, 0), 0, 1); s.nightEase = raw.nightEase === NIGHT_EASE ? NIGHT_EASE : 1; s.counterAt = clamp(safeCount(raw.counterAt), 0, 99);
    s.defStreak = clamp(safeCount(raw.defStreak), 0, 1e6); s.perkOwed = clamp(safeCount(raw.perkOwed), 0, PERK_OWED_MAX); s.bossPerks = clamp(safeCount(raw.bossPerks), 0, BOSS_PERKS_MAX); s.perkFrom = raw.perkFrom === 'boss' ? 'boss' : 'goal';
    var ao = raw.autoOff && typeof raw.autoOff === 'object' ? raw.autoOff : {};
    for (var az = 1; az < AUTO_KEYS.length; az++) if (ao[az] === true) s.autoOff[az] = true;
    s.elderOff = typeof raw.elderOff === 'boolean' ? raw.elderOff : ao[6] === true;      // 4.3.8 전 저장: 7구역 자동을 꺼 두었으면 이장도 꺼 둔 것으로
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
    // 3.5.0: 의뢰는 "몇 단계 상자 몇 개". 단계가 없는 옛 의뢰(완제품 몇백 개)는 버린다
    s.contract = rk && typeof rk === 'object' && findById(CLIENTS, rk.who) && safeNum(rk.level, 0) >= 1 && safeNum(rk.need, 0) >= 1 && safeNum(rk.left, 0) > 0
      ? { who: rk.who, level: clamp(Math.floor(safeNum(rk.level, 1)), 1, BOX_MAX), need: clamp(Math.floor(safeNum(rk.need, 1)), 1, 5), have: clamp(safeCount(rk.have), 0, 5), left: clamp(safeNum(rk.left, 0), 0, CONTRACT_SECONDS) } : null;
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
    var m = { strayfast: 1, straytime: 1, lvcost: 1, fence: 1, muster: 1, loss: 1, nightpay: 1, wagon: 1, elder: 0, cool: 1, wall: 0, wallfix: 1, nade: 0, held: 1, prod: 1, z1: 1, z2: 1, z3: 1, z4: 1, lab: 1, labcost: 1, staffcost: 1, trip: 1, routecost: 1, traincost: 1, click: 1, defense: 1, defcost: 1, repair: 0, reroll: 0, z6: 1, margin: 0, z7: 1, ordergap: 1, contractgap: 1, salvagegap: 1, recordchance: 0, passerchance: 0, mergebonus: 1, lucky: 0, boardsize: 0, platlen: 0, hordespeed: 1, keepmore: 0, horn: 0, peak: 0, sterile: 0, autolab: 0, nurse: 0, autoguard: 0, autotower: 0, loot: 1, cost: 1, z1cost: 1, z3cost: 1, floor: 0, ceil: 0, cap: 1, offline: 0, antibody: 1, here: 1, start: 0, broker: 0, assist: 0, steady: 0, slack: 0, patrol: 0, autoline: 0, autosig: 0, rumor: 0 };
    var ADD = { elder: 1, wall: 1, nade: 1, peak: 1, sterile: 1, horn: 1, keepmore: 1, platlen: 1, lucky: 1, boardsize: 1, floor: 1, ceil: 1, offline: 1, start: 1, broker: 1, steady: 1, slack: 1, assist: 1, patrol: 1, autoline: 1, autosig: 1, rumor: 1, repair: 1, reroll: 1, margin: 1, recordchance: 1, passerchance: 1, autolab: 1, nurse: 1, autoguard: 1, autotower: 1 };      // 더하는 항목. 나머지는 (1 + 레벨 × per) 을 곱한다
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
    // 특전 '현장 일손'(here): 현재 서 있는 구역의 생산에 곱한다. 구역을 옮기면 따라간다
    var hereKey = ['z1', 'z2', 'z3', 'z4', 'lab', 'z6', 'z7'][state.zone];
    if (hereKey && m.here !== 1) m[hereKey] *= m.here;
    // 도전 훈장의 고유 보상(1.7.0): 그 도전을 한 번이라도 성공했으면 붙는다(여러 번 성공해도 한 번만)
    m.autoshare = 0; m.scout = 1;
    m.antibody *= 1 + DANGER_ANTIBODY * dangerOf(state);      // 위험 단계: 철수 항체가 는다
    if (state.stageMarks) m.loot *= Math.pow(BOSS_BADGE_LOOT, badgeCount(state));      // 원정 지역 휘장
    if (state.medals) CHALLENGES.forEach(function (d) { if (state.medals[d.id] > 0 && d.perk) { if (d.perk.add) m[d.perk.key] += d.perk.add; else m[d.perk.key] *= d.perk.mult; } });
    applyPets(state, m);      // 동물 친구(4.4.6: 보유 효과 + 장착한 강아지 · 고양이의 효과와 특기)
    // 연구 과제: 끝낸 횟수만큼 곱으로 쌓인다
    if (state.research) PROJECTS.forEach(function (d) { var lv = state.research[d.id] || 0; if (lv && d.key !== 'drop') m[d.key] *= Math.pow(d.mult, lv); });
    // 7구역 정착지의 건물(3.1.0)
    if (state.campRows) { m.wagon *= 1 + CART_STEP * campRow(state, 'cart'); m.fence *= 1 + WALL7_STEP * campRow(state, 'wall7'); m.muster *= Math.pow(1 - ARMS_STEP, campRow(state, 'arms')); }
    if (state.settle) SETTLE.forEach(function (d) { if (d.key && d.mult && state.settle[d.id] && !(state.camp && state.camp.broken && state.camp.broken[d.id])) m[d.key] *= Math.pow(d.mult, levelPow(settleLv(state, d.id))); });      // 4.2.0: 단계만큼 더(부서진 동안에는 없다)
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
    return mods(state).prod * (1 + WAVE_BONUS * state.wavesCleared) * (state.buff ? state.buff.mult : 1) * achMult(state) * towerMult(state) * medalMult(state) * rescueMult(state) * dangerPower(state) * (challengeOn(state, 'lean') ? LEAN_MULT : 1);
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
  /*
   * ---------- 7구역 정착지와 주파수(3.1.0) ----------
   * 전에는 7구역이 안테나 한 줄과 "15초 동안 2배" 단추 하나뿐이라, 닿고 20분이면 이야기가 끝났다. 구역만의 재화(생존자)를 쓰는 곳을 만든다.
   *
   * 정착지: 건물 아홉(SETTLE). 세 줄(col)이 위에서 아래로(row) 이어진다. 앞 건물을 지어야 다음 건물을 지을 수 있다.
   *   건물을 지으려면 사람을 맡겨야 한다(cost 명). 맡긴 사람은 사라지지 않는다: 생존자 수와 그에 따른 생산 배수는 그대로이고,
   *   "맡길 수 있는 사람"(settleFree = 생존자 − 맡긴 사람)만 준다. 그래서 무엇부터 지을지가 선택이 된다.
   *   가운데 줄(진료소 → 실험동 → 격리동)은 혈청의 문턱이다: 혈청 n단계는 그 줄의 n번째 건물이 있어야 만들 수 있다.
   * 주파수 맞추기: 바늘이 TUNE_PERIOD 초마다 끝에서 끝으로 오간다. 바늘이 띠 안에 있을 때 맞추면 먼 무리가 한꺼번에 온다
   *   (초당 모이는 수의 TUNE_GAIN_SECONDS 초분). 맞추면 TUNE_COOL, 빗나가면 TUNE_MISS_COOL 초 쉬고 띠가 자리를 옮긴다.
   *   '송신 기사'(autotower)가 있으면 쉴 때마다 알아서 맞추되 절반만 온다. 예전의 '직접 방송'(15초 2배)을 대신한다.
   * 회차에 딸린 것이라 철수하면 처음으로 돌아간다.
   */
  var SETTLE = [
    { id: 'farm',   col: 0, row: 0, name: '텃밭',   cost: 200,   desc: '전체 생산 ×1.5',          key: 'prod',     mult: 1.5 },
    { id: 'mess',   col: 0, row: 1, name: '식당',   cost: 1500,  desc: '모이는 속도 ×2',          key: 'z7',       mult: 2 },
    { id: 'store',  col: 0, row: 2, name: '창고',   cost: 10000, desc: '전체 생산 ×2',            key: 'prod',     mult: 2 },
    { id: 'clinic', col: 1, row: 0, name: '진료소', cost: 500,   desc: '혈청 1단계',              serum: 1 },
    { id: 'lab7',   col: 1, row: 1, name: '실험동', cost: 4000,  desc: '혈청 2단계',              serum: 2 },
    { id: 'ward',   col: 1, row: 2, name: '격리동', cost: 20000, desc: '혈청 3단계',              serum: 3 },
    { id: 'guard7', col: 2, row: 0, name: '경비대', cost: 400,   desc: '방어력 ×2',               key: 'defense',  mult: 2 },
    { id: 'watch',  col: 2, row: 1, name: '망루',   cost: 3000,  desc: '주파수 띠가 넓어진다',    band: 0.07 },
    { id: 'school', col: 2, row: 2, name: '학교',   cost: 15000, desc: '철수 항체 +10%',          key: 'antibody', mult: 1.1 }
  ];
  var SETTLE_SCALE = 100;      // 건물 값 전체에 곱하는 수(밸런스를 맞출 때 이것 하나만 만진다)
  SETTLE.forEach(function (d) { d.cost = Math.round(d.cost * SETTLE_SCALE); });
  var TUNE_PERIOD = 3.2, TUNE_BAND = 0.14, TUNE_GAIN_SECONDS = 3, TUNE_COOL = 1.5,      /* 4.2.2: 맞추고 나서 쉬는 시간을 거의 없앴다(1.5초). 왜: 낮에는 맞추고 기다리는 것뿐이라 '보고만 있다'고 하셨다. 한 번에 받는 양은 그만큼 나눴다 */
  TUNE_KEEP = 0, TUNE_MISS_COOL = 1.5, TUNE_MIN = 5, TUNE_AUTO = 0.5;
  /*
   * 공사(3.1.0): 건물은 맡기는 즉시 서지 않는다. 줄(row)에 따라 SETTLE_BUILD 초가 걸리고, 한 번에 한 채만 짓는다.
   *   사람 수만으로 막으면 강한 사람은 20분, 약한 사람은 16시간이 걸렸다(재 보니 그랬다). 공사 시간은 누구에게나 같다.
   *   주파수를 맞출 때마다 공사가 TUNE_BUILD 초 앞당겨진다(송신 기사는 절반). 자리를 비운 동안에도 공사는 간다.
   *   state.build = { id, left } 또는 null. 짓는 중인 건물의 사람은 이미 맡긴 것으로 센다. 효과는 다 지은 뒤부터.
   */
  /*
   * ---------- 4.2.0 7구역을 새로 만들었다: 정착지 지도에 사람을 놓는다 ----------
   * 왜: 전에는 건물을 누르면 8분 · 20분 · 40분을 그냥 기다렸다(손이 할 일은 주파수 맞추기뿐). 건물은 표의 한 칸이었고, 다 지으면 볼 것도 할 것도 없었다.
   * 사람: 생존자(state.survivors)는 모인 수의 합이다. 건물에 놓은 사람과 울타리에 세운 사람을 뺀 것이 '문 앞의 사람'(settleFree).
   * 놓기: 지도에서 자리를 누르면 문 앞의 사람이 한 무리(필요한 수의 1 / SEND_PARTS) 그 자리로 간다. 필요한 수가 차면 그 자리에서 선다(기다리는 시간은 없다).
   * 단계: 건물은 3단계까지 자란다(값은 LV_COST 배). 효과는 1단계가 지금까지의 것이고, 단계마다 조금씩 더 는다(LV_POW). 혈청의 문턱은 1단계면 된다.
   *       그래서 이야기의 끝까지는 전과 같은 만큼이면 되고, 더 머무는 사람에게는 2 · 3단계가 남는다.
   * 낮과 밤: 손을 쓰고 있을 때(CAMP_HAND 초 안에 놓은 적이 있을 때)만 해가 간다. DAY_SECONDS 초가 지나면 밤이 오고, 무리가 울타리 한쪽에 붙는다.
   *       밤에는 문 앞의 사람을 울타리로 보내 막는다(보낸 사람은 아침에 돌아온다). 필요한 수(night.need)만큼 세우면 울타리가 깎이지 않는다.
   *       경비대와 망루는 저마다 단계만큼 거든다(TOWER_HOLD). 울타리가 다 깎이면 뚫린다: 건물 한 채가 부서져 고칠 때까지 효과가 없다.
   *       밤을 넘기면 사람이 더 오고 '밤 단계'(nightLv)가 오른다. 단계가 오를수록 더 많은 사람을 세워야 한다(언젠가는 뚫린다). 뚫리면 NIGHT_DROP 내려간다.
   * 자동: 이장(elder)은 ELDER_SECONDS 초마다 깃발을 꽂아 둔 자리(마지막으로 누른 자리)로 한 무리를 보낸다. 밤에는 울타리를 절반(ELDER_HOLD)까지만 채운다.
   * 자리를 비운 동안(굵은 걸음)에는 밤이 오지 않는다. 이장이 있으면 그동안에도 사람을 보낸다. 가만히 둠 < 이장 < 손.
   */
  /* 4.2.1 단계의 끝을 없앴다(LV_MAX7 = 99). 왜: 사람이 많이 모인 저장에서는 아홉 채가 금세 3단계가 되고, 그 뒤로는 놓을 곳도 살 것도 없었다.
     값은 단계마다 LV_GROW 배(1 · 3 · 9 · 27 …)라 사람이 아무리 많아도 놓을 곳이 남는다. 효과는 갈수록 덜 는다(지수 = 1 + LV_POW × log2(단계)): 벌이가 한없이 불지 않게.
     그림은 3단계까지 달라지고, 그 뒤로는 건물 위의 숫자가 오른다 */
  /* 4.3.7 다시 끝을 두었다(10단계). 정착지 1 · 2 · 3(세 단)마다 세 건물이 다 10단계가 되면 '건설 완료'(해 보신 말씀). 10단계면 1단계의 3^9 배라 오래 걸린다 */
  var LV_MAX7 = 10, LV_GROW = 3, LV_COST = [1, 3, 9], LV_POW = 0.3, SEND_PARTS = 12, REPAIR_FRAC = 0.3, TOWER_HOLD_MAX = 0.6, GUARD_LOSS = 0.5;
  var RAID_EVERY = 50, RAID_SECONDS = 25, CAMP_HAND = 45, NIGHT_NEED = 15, NIGHT_GROW = 1.12, NIGHT_LV_MAX = 200, NIGHT_DROP = 2, NIGHT_PAY = 40, GUARD_PARTS = 8, FENCE_RATE = 1.6, ELDER_SECONDS = 2, ELDER_HOLD = 0.7;
  var NIGHT_HOARD = 0.3;
  var TOWER_HOLD = { guard7: 0.15, watch: 0.1 }, TUNE_BUILD = 0, SETTLE_BUILD = [0, 0, 0];      // 옛 공사 시간은 없앴다(이름만 남겨 둔다)
  function settleTime() { return 0; }
  /* 4.3.2 7구역 운영 줄: 안테나 말고도 물자로 사는 것 셋. 수레(한 번에 보내는 무리) · 방벽(벽이 더디게 깎인다) · 무기고(습격에 세워야 하는 수가 준다) */
  var CAMP_ROWS = [
    { id: 'cart',  name: '수레',   desc: '한 번에 보내는 무리가 커진다', max: 10, base: 2e30, growth: 12 },
    { id: 'wall7', name: '방벽',   desc: '습격에 벽이 더디게 깎인다',     max: 8,  base: 4e30, growth: 16 },
    { id: 'arms',  name: '무기고', desc: '습격에 세워야 하는 생존자가 준다', max: 8, base: 6e30, growth: 16 }
  ];
  var CART_STEP = 0.25, WALL7_STEP = 0.25, ARMS_STEP = 0.08;
  function campRow(state, id) { var r = state.campRows; return r && r[id] > 0 ? Math.floor(r[id]) : 0; }
  function campRowCost(state, id) { var d = findById(CAMP_ROWS, id); return d && zoneOpen(state, 6) && campRow(state, id) < d.max ? Math.ceil(d.base * Math.pow(d.growth, campRow(state, id)) * mods(state).cost) : Infinity; }
  function buyCampRow(state, id) { var d = findById(CAMP_ROWS, id); if (!d) return fail('unknown'); if (!zoneOpen(state, 6)) return fail('locked'); return pay(state, campRowCost(state, id), function () { if (!state.campRows || typeof state.campRows !== 'object') state.campRows = {}; state.campRows[id] = campRow(state, id) + 1; }); }
  function newCamp() { return { work: {}, broken: {}, flag: null, clock: 0, night: null, nightLv: 0, day: 1, hand: 999, elder: 0 }; }
  function campOf(state) { var c = state.camp; if (!c || typeof c !== 'object') c = state.camp = newCamp(); if (!c.work || typeof c.work !== 'object') c.work = {}; if (!c.broken || typeof c.broken !== 'object') c.broken = {}; if (!(c.hand >= 0)) c.hand = 999; return c; }
  function settleHas(state, id) { return !!(state.settle && state.settle[id]); }
  function settleLv(state, id) { return settleHas(state, id) ? clamp(Math.floor(safeNum(state.settleLv && state.settleLv[id], 1)) || 1, 1, LV_MAX7) : 0; }
  function settleBroken(state, id) { return !!(state.camp && state.camp.broken && state.camp.broken[id]); }
  function levelCost(def, lv) { return Math.min(1e15, def.cost * Math.pow(LV_GROW, clamp(lv, 1, LV_MAX7) - 1)); }
  function levelNeed(state, def, lv) { return Math.max(1, Math.ceil(levelCost(def, lv) * (lv > 1 ? mods(state).lvcost : 1))); }      // 설계도는 2단계부터 듣는다(1단계는 혈청의 문턱이라 값을 건드리지 않는다)
  function levelPow(lv) { return lv >= 1 ? 1 + LV_POW * Math.log(lv) / Math.LN2 : 0; }
  /** 이 자리에 더 놓아야 하는 사람 수: 부서졌으면 고치는 데, 아니면 다음 단계에. 다 자랐으면 0. */
  function settleNeed(state, id) {
    var def = findById(SETTLE, id); if (!def) return 0;
    var lv = settleLv(state, id);
    if (settleBroken(state, id)) return Math.max(1, Math.ceil(levelCost(def, lv) * REPAIR_FRAC * mods(state).loss));
    return lv >= LV_MAX7 ? 0 : levelNeed(state, def, lv + 1);
  }
  function settleWork(state, id) { var c = state.camp; return c && c.work && c.work[id] > 0 ? c.work[id] : 0; }
  function settleUsed(state) {
    var n = 0, c = state.camp;
    SETTLE.forEach(function (d) { var lv = settleLv(state, d.id); if (lv > 0) n += Math.min(1e15, d.cost * (Math.pow(LV_GROW, lv) - 1) / (LV_GROW - 1)); n += settleWork(state, d.id); });      // 1 + 3 + 9 + … 의 합
    return n;
  }
  function settleFree(state) { return Math.max(0, Math.floor(state.survivors || 0) - settleUsed(state)); }
  function settleCount(state) { var n = 0; SETTLE.forEach(function (d) { if (settleHas(state, d.id)) n++; }); return n; }
  function settleLevels(state) { var n = 0; SETTLE.forEach(function (d) { n += settleLv(state, d.id); }); return n; }
  /** 이 자리에 지금 사람을 놓을 수 없는 까닭: ''(놓을 수 있다) | unknown | locked(7구역이 아니다) | done(다 자랐다) | prev(앞 건물이 없다) | people(문 앞에 사람이 없다) */
  function settleBlock(state, id) {
    var def = findById(SETTLE, id);
    if (!def) return 'unknown';
    if (!zoneOpen(state, 6)) return 'locked';
    if (!(settleNeed(state, id) > 0)) return 'done';
    var prev = SETTLE.filter(function (d) { return d.col === def.col && d.row === def.row - 1; })[0];
    if (prev && !settleHas(state, prev.id)) return 'prev';
    return settleFree(state) >= 1 ? '' : 'people';
  }
  /** 이 자리로 한 무리를 보낸다. 필요한 수가 차면 그 자리에서 선다(또는 고쳐진다). auto: 이장이 보냈다. */
  function buildSettle(state, id, auto, events) {
    var why = settleBlock(state, id);
    if (why) return fail(why);
    var def = findById(SETTLE, id), c = campOf(state), need = settleNeed(state, id), have = settleWork(state, id);
    var sent = Math.min(settleFree(state), need - have, Math.max(1, Math.ceil(need / SEND_PARTS * mods(state).wagon)));
    c.work[id] = have + sent; if (!auto) { c.flag = id; c.hand = 0; state.sendsRun = (state.sendsRun || 0) + 1; }
    var out = { ok: true, id: id, name: def.name, sent: sent, have: have + sent, need: need, done: false, lv: settleLv(state, id), repaired: false };
    if (c.work[id] >= need) {
      delete c.work[id]; out.done = true;
      if (c.broken[id]) { delete c.broken[id]; out.repaired = true; }
      else { if (!state.settle) state.settle = {}; if (!state.settleLv) state.settleLv = {}; state.settle[id] = true; state.settleLv[id] = out.lv + 1; out.lv = out.lv + 1; }
      if (events) events.push({ type: 'settle-done', id: def.id, name: def.name, desc: def.desc, lv: out.lv, repaired: out.repaired, auto: !!auto });
    }
    return out;
  }
  /** 밤에 울타리가 버티는 정도(0 ~ 1): 세운 사람 ÷ 필요한 사람 + 경비대 · 망루의 몫. 1 이면 깎이지 않는다. */
  /*
   * 4.2.1 습격을 세 쪽으로 나눴다. 왜: 단추를 몇 번 누르면 끝나서 심심했다(해 보신 말씀).
   *   무리는 북 · 동 · 남 세 쪽에 나뉘어 붙고(night.w: 몫, 합 1), RAID_SHIFT 초마다 몰리는 쪽이 바뀐다. 쪽마다 울타리가 따로 깎인다(night.fences).
   *   그쪽에 세워야 하는 수 = need × w. 지도에서 그쪽 울타리를 누르면 한 무리를 세운다. 문 앞에 사람이 없으면 가장 남는 쪽에서 옮겨 온다.
   *   그래서 습격 내내 몰리는 쪽을 따라 사람을 옮겨야 한다. 어느 한쪽이라도 다 깎이면 뚫린다.
   *   night.guards 는 세 쪽의 합, night.fence 는 가장 많이 깎인 쪽(화면과 옛 코드가 쓴다).
   */
  var RAID_SHIFT = 6, RAID_SIDES = 3;
  /*
   * 4.2.2 울타리 밖의 사람들(c.strays): 이 화면을 보고 있으면 STRAY_EVERY 초쯤마다 울타리 밖에 길 잃은 무리가 나타난다(많아야 STRAY_MAX).
   *   STRAY_TIME 초 안에 누르면 문으로 들어온다(모이는 속도의 STRAY_PAY 초 치 × 습격 단계). 못 누르면 사라진다.
   *   왜: 낮에는 주파수를 맞추고 사람이 차기를 기다리는 것뿐이었다. 지도에서 눈과 손이 할 일을 둔다.
   */
  /* 4.3.3 울타리 밖 생존자 한 무리 = 모이는 속도의 STRAY_PAY 초 치(5초 → 40초). 왜(해 보신 말씀): 낮에 놓을 생존자를 눌러서 채울 수 있어야 하는데,
     5초 치로는 건물 한 단계에 턱없이 모자라 누를 까닭이 없었다. 하루(습격 사이)에 열 번쯤 누르면 가만히 모이는 것의 다섯 배쯤 된다(다른 구역의 손과 같은 정도) */
  var STRAY_EVERY = 5, STRAY_TIME = 7, STRAY_MAX = 3, STRAY_PAY = 40;
  function strayGain(state) { var c = state.camp; return Math.max(TUNE_MIN, survivorRate(state) * STRAY_PAY * (1 + 0.1 * (c && c.nightLv > 0 ? c.nightLv : 0))); }
  /** 울타리 밖의 무리를 들인다. */
  function rescueStray(state, id) {
    if (!zoneOpen(state, 6)) return fail('locked');
    var c = campOf(state), list = c.strays || [], i = -1; for (var k = 0; k < list.length; k++) if (list[k].id === id) { i = k; break; }
    if (i < 0) return fail('gone');
    var s = list[i], gain = strayGain(state); list.splice(i, 1);
    state.survivors = Math.min(1e15, (state.survivors || 0) + gain); state.straysRun = (state.straysRun || 0) + 1; c.hand = 0;
    return { ok: true, gain: gain, side: s.side, u: s.u };
  }
  function towerHold(state) { var tw = 0; Object.keys(TOWER_HOLD).forEach(function (id) { if (!settleBroken(state, id)) tw += TOWER_HOLD[id] * levelPow(settleLv(state, id)); }); return Math.min(TOWER_HOLD_MAX, tw); }      // 경비대와 망루만으로는 다 못 막는다
  function sideNeed(n, i) { return Math.max(1, Math.ceil(n.need * n.w[i])); }
  /** i 쪽 울타리가 버티는 정도(0 ~ 1). */
  function sideHold(state, i) { var n = state.camp && state.camp.night; if (!n) return 1; return Math.min(1, (n.g[i] || 0) / sideNeed(n, i) + towerHold(state)); }
  /** 습격 전체가 버티는 정도: 무리가 붙은 쪽 가운데 가장 약한 쪽. */
  function nightHold(state) { var n = state.camp && state.camp.night; if (!n) return 1; var h = 1; for (var i = 0; i < RAID_SIDES; i++) if (n.w[i] > 0.02) h = Math.min(h, sideHold(state, i)); return h; }
  function raidWeights(roll, prev) { var big = Math.floor(roll() * RAID_SIDES) % RAID_SIDES; if (big === prev) big = (big + 1 + Math.floor(roll() * (RAID_SIDES - 1))) % RAID_SIDES; var mid = (big + 1 + Math.floor(roll() * (RAID_SIDES - 1))) % RAID_SIDES, w = [0.1, 0.1, 0.1]; w[big] = 0.6; w[mid] = 0.3; return { w: w, side: big }; }
  function newRaid(state, roll) { var r = raidWeights(roll, -1); return { t: RAID_SECONDS, need: raidNeed(state), w: r.w, side: r.side, g: [0, 0, 0], fences: [1, 1, 1], fence: 1, guards: 0, shift: RAID_SHIFT }; }
  /** 습격 중에 side(0 북 · 1 동 · 2 남, 안 주면 가장 약한 쪽) 울타리로 한 무리를 세운다. 문 앞에 사람이 없으면 가장 남는 쪽에서 옮긴다. */
  function sendGuard(state, side, auto) {
    if (!zoneOpen(state, 6)) return fail('locked');
    var c = campOf(state), n = c.night;
    if (!n) return fail('day');
    if (!(side >= 0 && side < RAID_SIDES)) { side = 0; for (var k = 1; k < RAID_SIDES; k++) if (sideHold(state, k) < sideHold(state, side)) side = k; }
    side = Math.floor(side);
    var want = sideNeed(n, side) - n.g[side]; if (!(want > 0)) return fail('full');
    var chunk = Math.max(1, Math.ceil(n.need / GUARD_PARTS * mods(state).wagon)), free = guardPool(state), sent = 0, moved = -1;
    if (free >= 1) sent = Math.min(free, want, chunk);
    else { var best = -1, sur = 0; for (var j = 0; j < RAID_SIDES; j++) { if (j === side) continue; var s2 = n.g[j] - sideNeed(n, j); if (n.g[j] > 0 && (best < 0 || s2 > sur)) { best = j; sur = s2; } } if (best < 0) return fail('people'); sent = Math.min(n.g[best], want, chunk); n.g[best] -= sent; moved = best; }
    n.g[side] += sent; n.guards = n.g[0] + n.g[1] + n.g[2]; if (!auto) { c.hand = 0; state.sendsRun = (state.sendsRun || 0) + 1; }
    return { ok: true, side: side, sent: sent, moved: moved, guards: n.guards, need: n.need, hold: nightHold(state) };
  }
  /*
   * 4.2.4 습격에 서는 사람을 '문 앞의 사람'에서 떼어 냈다. 왜(해 보신 말씀): 지키는 사람이 짓는 사람과 같은 주머니라서,
   *   낮에는 밤을 대비해 아무것도 안 놓게 되고, 사람 수는 들락날락해서 밤이 얼마나 어려운지 가늠할 수 없었다.
   *   이제 습격에는 정착지의 모든 사람이 나선다(건물에서 일하던 사람도). 세울 수 있는 사람 = 모인 사람 전체 − 이미 세운 사람.
   *   세워야 하는 수 = 전체의 NIGHT_FRAC × 단계(NIGHT_GROW 배씩, 많아야 전체의 NIGHT_CAP). 낮에 얼마를 지었든 같다.
   *   지키다 잃는 사람도 없앴다(수가 들쭉날쭉해지는 까닭이었다). 벌칙은 뚫렸을 때 건물이 부서지는 것 하나다.
   */
  /*
   * 4.3.8 습격의 빠듯함(T): 몰린 쪽들에 실제로 세워야 하는 사람 ÷ 모인 사람 전체.
   *   왜(해 보신 말씀: '막는 게 너무 쉽다'): 전에는 전체의 6% × 1.12^단계라, 세 쪽 모두 가장 몰릴 때(0.6씩 = 1.8배)만큼 미리 세워 두고 나면
   *   쪽이 바뀌어도 할 일이 없었다. 이제 T 를 NIGHT_FLOOR(0.58) 위로 둔다: 1.8 × T > 1 이라 세 쪽을 한꺼번에 다 채울 수는 없고,
   *   T ≤ 1 이라 현재 몰린 모양(0.6 + 0.3 + 0.1)은 늘 막을 수 있다. 그래서 습격 내내 몰리는 쪽을 따라 옮겨야 한다.
   *   단계가 오르면 T 가 NIGHT_CAP(0.95)까지 오른다(남는 사람이 줄어 옮길 틈이 좁아진다). 무장(campRows.arms)과 경비대 · 망루는 T 를 낮추지만 바닥 아래로는 못 낮춘다.
   *   경비대 · 망루의 몫(towerHold)은 쪽마다 버팀에 더해지므로, 세울 수를 그만큼 부풀려 T 가 위의 값이 되게 맞춘다.
   */
  var NIGHT_FRAC = 0.62, NIGHT_STEP = 0.012, NIGHT_CAP = 0.95, NIGHT_FLOOR = 0.58, TOWER_EASE = 0.5;
  function raidTight(state) { var c = state.camp, lv = c && c.nightLv > 0 ? c.nightLv : 0; return Math.max(NIGHT_FLOOR, Math.min(NIGHT_CAP, NIGHT_FRAC + NIGHT_STEP * lv) * mods(state).muster * (1 - TOWER_EASE * towerHold(state))); }
  /** 다음 습격에 세워야 하는 사람 수(쪽마다의 몫으로 나뉜다). */
  function raidNeed(state) {
    var all = Math.floor(state.survivors || 0);
    return Math.max(5, Math.ceil(all * raidTight(state) / Math.max(0.05, 1 - towerHold(state))));
  }
  /** 습격에 아직 세우지 않은 사람 수(모인 사람 전체에서 센다). */
  function guardPool(state) { var n = state.camp && state.camp.night; return Math.max(0, Math.floor(state.survivors || 0) - (n ? n.guards || 0 : 0)); }
  function campSeen(state) { if (zoneOpen(state, 6)) campOf(state).hand = 0; }      // 화면이 7구역 운영을 보고 있다: 그동안은 해가 간다(보고 있지 않으면 습격은 오지 않는다)
  function elderOn(state) { return mods(state).elder > 0 && !state.elderOff; }
  /** 4.3.8 이장을 켜고 끈다(그전에는 송신 기사와 한 스위치였고, 그 스위치가 구역 탭 아래에 있어 찾기 어려웠다). */
  function setElder(state, on) { if (!(mods(state).elder > 0)) return fail('none'); state.elderOff = !on; return { ok: true, on: !!on }; }
  /** 이장이 보낼 자리: 깃발을 꽂아 둔 자리, 놓을 수 없으면 놓을 수 있는 자리 가운데 가장 덜 드는 곳. */
  function elderTarget(state) {
    var c = campOf(state); if (c.flag && !settleBlock(state, c.flag)) return c.flag;
    var best = null, bn = Infinity; SETTLE.forEach(function (d) { if (settleBlock(state, d.id)) return; var left = settleNeed(state, d.id) - settleWork(state, d.id); if (left < bn) { bn = left; best = d.id; } });
    return best;
  }
  function stepCamp(state, dt, rng, events) {
    if (!zoneOpen(state, 6)) return;
    dt = safeNum(dt, 0); if (!(dt > 0)) return;
    var c = campOf(state), roll = typeof rng === 'function' ? rng : Math.random, elder = elderOn(state);
    if (dt > 5) {      // 굵은 걸음(자리 비움): 밤은 오지 않는다. 이장이 있으면 그동안에도 보낸다
      c.night = null; c.hand = 999; c.strays = [];
      if (elder) { var sends = Math.min(400, Math.floor(dt / ELDER_SECONDS)); for (var q = 0; q < sends; q++) { var tg = elderTarget(state); if (!tg || !buildSettle(state, tg, true, events).ok) break; } }
      return;
    }
    c.hand = Math.min(999, c.hand + dt);
    if (!Array.isArray(c.strays)) c.strays = [];
    for (var si0 = c.strays.length - 1; si0 >= 0; si0--) { c.strays[si0].t -= dt; if (c.strays[si0].t <= 0) { var gone = c.strays.splice(si0, 1)[0]; if (events) events.push({ type: 'stray-lost', side: gone.side, u: gone.u }); } }
    if (c.hand < CAMP_HAND && survivorRate(state) > 0 && TEST.stray !== 0) {
      c.strayIn = (c.strayIn > 0 ? c.strayIn : STRAY_EVERY * (0.6 + roll() * 0.8)) - dt * TEST.stray * mods(state).strayfast;
      if (c.strayIn <= 0 && c.strays.length < STRAY_MAX) { c.strayN = (c.strayN || 0) + 1; var st = { id: c.strayN, side: Math.floor(roll() * RAID_SIDES) % RAID_SIDES, u: 0.08 + roll() * 0.84, t: STRAY_TIME * mods(state).straytime, t0: STRAY_TIME * mods(state).straytime }; c.strays.push(st); c.strayIn = 0; if (events) events.push({ type: 'stray-in', id: st.id, side: st.side, u: st.u }); }
    }
    if (elder) {
      c.elder = (c.elder || 0) + dt / ELDER_SECONDS * (c.night ? 4 : 1);      // 습격 중에는 서두른다(몰린 쪽은 몇 초면 깎인다)
      while (c.elder >= 1) { c.elder -= 1;
        if (c.night && nightHold(state) < ELDER_HOLD) { var eg = sendGuard(state, -1, true); if (!eg.ok) break; if (events) events.push({ type: 'camp-send', side: eg.side, auto: true }); }
        else { var t2 = elderTarget(state), eb = t2 ? buildSettle(state, t2, true, events) : null; if (!eb || !eb.ok) { c.elder = Math.min(c.elder, 1); break; } if (events) events.push({ type: 'camp-send', id: t2, auto: true }); } }      // 4.3.8: 보낸 것을 알린다(화면이 길을 걷는 사람을 그린다)      // 이장은 다음 습격에 세울 만큼은 남겨 둔다
    }
    var n = c.night;
    if (n) {
      n.t -= dt;
      for (var si = 0; si < RAID_SIDES; si++) n.fences[si] -= (1 - sideHold(state, si)) * n.w[si] * RAID_SIDES * FENCE_RATE / RAID_SECONDS * dt / mods(state).fence;
      n.fence = Math.min(n.fences[0], n.fences[1], n.fences[2]);
      n.shift -= dt; if (n.shift <= 0 && n.t > 2) { n.shift = RAID_SHIFT; var rw = raidWeights(roll, n.side); n.w = rw.w; n.side = rw.side; if (events) events.push({ type: 'camp-shift', side: n.side }); }
      if (n.fence <= 0) {      // 뚫렸다: 서 있는 건물 한 채가 부서진다(고칠 때까지 효과가 없다)
        var alive = SETTLE.filter(function (d) { return settleHas(state, d.id) && !c.broken[d.id]; }), v = alive.length ? alive[Math.floor(roll() * alive.length) % alive.length] : null;
        if (v) c.broken[v.id] = true;
        var lostB = 0;
        c.nightLv = Math.max(0, (c.nightLv || 0) - NIGHT_DROP); state.campBreaches = (state.campBreaches || 0) + 1;
        if (events) events.push({ type: 'camp-breach', id: v ? v.id : '', name: v ? v.name : '', side: n.side, lost: lostB });
        c.night = null; c.clock = 0; c.day = (c.day || 1) + 1;
      } else if (n.t <= 0) {      // 밤을 넘겼다
        var lostH = 0, gain = Math.max(TUNE_MIN, survivorRate(state) * NIGHT_PAY * (1 + 0.1 * (c.nightLv || 0))) * Math.max(0.2, n.fence) * mods(state).nightpay;      // 받는 사람: 모이는 속도의 NIGHT_PAY 초 치 × 단계 × 남은 울타리
        state.survivors = Math.min(1e15, (state.survivors || 0) + gain); c.nightLv = Math.min(NIGHT_LV_MAX, (c.nightLv || 0) + 1); state.nightsHeld = (state.nightsHeld || 0) + 1;
        if (c.nightLv > (state.nightLvBest || 0)) state.nightLvBest = c.nightLv;
        if (events) events.push({ type: 'camp-held', gain: gain, lv: c.nightLv, fence: n.fence, lost: lostH });
        c.night = null; c.clock = 0; c.day = (c.day || 1) + 1;
      }
    } else if (c.hand < CAMP_HAND && settleCount(state) >= 1 && TEST.night !== 0) {
      c.clock = (c.clock || 0) + dt * TEST.night;
      if (c.clock >= RAID_EVERY) {
        /* 세워야 하는 사람: 모이는 속도의 NIGHT_NEED 초 치 × 단계. 왜 모인 사람 전체가 아닌가: 사람은 거의 다 건물에 놓여 있어서, 전체의 몇 %로 잡으면 문 앞의 사람으로는 영영 못 막았다.
           모이는 속도에 맞추면 누구든 '얼마 동안 짓지 않고 모아 두면' 막을 수 있고, 단계가 오르면 그 동안이 길어진다 */
        var need = raidNeed(state);
        c.night = newRaid(state, roll);
        if (events) events.push({ type: 'camp-night', need: need, side: c.night.side, lv: c.nightLv || 0 });
      }
    }
  }
  function stepBuild() {}      // 옛 공사(시간이 가면 서던 것)는 없앴다
  /** 혈청의 다음 단계에 필요한 건물(없으면 null). 이미 있으면 null. */
  function serumNeeds(state) {
    var stage = (state.serumStage || 0) + 1, d = SETTLE.filter(function (x) { return x.serum === stage; })[0];
    if (d && !settleHas(state, d.id)) return d;
    // 마지막 단계는 정착지가 다 서야 한다: 가운데 줄만 짓고 끝내지 못하게(이야기의 끝은 정착지를 다 지은 다음이다)
    if (stage === SERUM_COSTS.length) { var rest = SETTLE.filter(function (x) { return !settleHas(state, x.id); })[0]; if (rest) return rest; }
    return null;
  }
  function tuneBand(state) { var b = TUNE_BAND; SETTLE.forEach(function (d) { if (d.band && settleHas(state, d.id) && !settleBroken(state, d.id)) b += d.band * levelPow(settleLv(state, d.id)); }); return Math.min(0.5, b); }
  /** 바늘의 자리(0 ~ 1): 끝에서 끝으로 오간다. */
  function tunePos(state) { var x = (((state.tune && state.tune.t) || 0) / TUNE_PERIOD) % 2; return x <= 1 ? x : 2 - x; }
  function tuneGain(state) { return Math.max(TUNE_MIN, survivorRate(state) * TUNE_GAIN_SECONDS); }
  function tuneHit(state) { return Math.abs(tunePos(state) - state.tune.band) <= tuneBand(state) / 2 + 1e-9; }
  /** 주파수를 맞춘다. { ok, hit, gain }. 실패 이유: locked, idle(안테나가 없다), cooldown */
  function tuneNow(state, rng) {
    if (!zoneOpen(state, 6)) return fail('locked');
    if (!(survivorRate(state) > 0)) return fail('idle');
    if (state.tune.cool > 0) return fail('cooldown');
    var hit = tuneHit(state), gain = hit ? tuneGain(state) : 0;
    if (hit) { state.survivors = Math.min(1e15, (state.survivors || 0) + gain); campOf(state).hand = 0; }
    state.tune.cool = hit ? TUNE_COOL : TUNE_MISS_COOL;
    state.tune.band = 0.15 + (typeof rng === 'function' ? rng() : Math.random()) * 0.7;      // 띠가 자리를 옮긴다
    state.tuneHits = (state.tuneHits || 0) + (hit ? 1 : 0);
    return { ok: true, hit: hit, gain: gain };
  }
  /** 시간마다: 바늘이 움직이고 쉬는 시간이 준다. 송신 기사가 있으면 쉴 때마다 알아서 맞춘다(절반). */
  function stepTune(state, dt, rng, events) {
    if (!zoneOpen(state, 6)) return;
    var t = state.tune;
    t.t = (t.t + dt) % (TUNE_PERIOD * 2);
    t.cool = Math.max(0, t.cool - dt);
    if (t.cool > 0 || !(mods(state).autotower > 0) || !autoEvents(state, 6) || !(survivorRate(state) > 0)) return;      // 7구역의 자동을 꺼 두면 손을 기다린다
    var gain = tuneGain(state) * TUNE_AUTO;
    state.survivors = Math.min(1e15, (state.survivors || 0) + gain);
    t.cool = TUNE_COOL; t.band = 0.15 + rng() * 0.7;
    events.push({ type: 'tune', auto: true, gain: gain });
  }
  function serumCost(state) { return state.serumStage < SERUM_COSTS.length && zoneOpen(state, 6) ? Math.ceil(SERUM_COSTS[state.serumStage] * mods(state).cost * dangerSerum(dangerOf(state))) : Infinity; }
  /** 혈청을 한 단계 진행한다. 마지막 단계를 끝내면 last 가 참이다. */
  function buySerum(state) {
    if (!zoneOpen(state, 6)) return fail('locked');
    if (state.serumStage >= SERUM_COSTS.length) return fail('done');
    if (serumNeeds(state)) return fail('settle');      // 3.1.0: 그 단계의 건물(진료소 · 실험동 · 격리동)이 있어야 한다
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

  /* ---------- 3구역: 합치기 판(3.5.0 에서 구역 전체를 다시 만들었다) ---------- */
  /*
   * 왜 다시 만들었나: 3.3.0 은 판만 새로 얹고 줄 · 개조 · 의뢰 · 자동 · 목표는 옛 '라인'의 것을 그대로 뒀다. 그래서
   *   - 옛 '자동 제어반'이 들어오는 대로 전부 합쳐 버려 손으로 누를 것이 없었고,
   *   - 줄 셋은 이름만 다르고 하는 일이 같았고, 개조(윤활유 · 컨베이어)는 판과 상관이 없었다.
   * 이번에는 한 덩어리로 맞췄다. 기준은 "간단하다 · 누르는 재미 · 보는 재미 · 선택의 긴장감".
   *
   * 판:   boardSize 칸. feedSeconds 마다 상자(spawnLevel 단계)가 빈칸에 들어온다. 같은 단계 둘을 합치면 윗단계 하나(값은 BOX_STEP 배).
   *       상자 하나를 누르면 같은 단계의 짝이 모두 합쳐지고, 합쳐질 때마다 덤(새 상자의 MERGE_SECONDS 초분 × 손맛)을 받는다.
   *       가득 차면 새 상자는 들어오지 못하고 기다린다(3.6.0). 손으로 자리를 내야 판이 자란다.
   * 줄:   투입구(더 자주) · 단조기(시작 단계 +1, 사는 순간 판의 상자도 모두 +1) · 도장 라인(상자 값, LINE_MILESTONES 마다 2배).
   * 개조: 손맛(덤) · 행운 상자(가끔 한 단계 높게) · 판 넓히기 · 정비 교범(값) · 견본 상자(의뢰 간격) · 자동 합치기.
   * 의뢰: 거래처가 "N단계 상자 몇 개"를 시간 안에 달라고 온다. 그 상자들을 판에 모아 두었다가 넘기면 크게 받는다.
   *       합치면 초당이 오르고, 아껴 두면 의뢰를 채운다: 3구역의 "선택"은 이것이다. 놓쳐도 잃는 것은 없다.
   * 자동: AUTO_MERGE_SECONDS 마다 짝 하나만 합친다(투입구보다 느리다). 그래서 자동을 사도 누를 짝은 늘 남고, 손이 언제나 더 낫다.
   *       의뢰가 찾는 단계의 상자는 자동이 건드리지 않는다.
   */
  var BOARD_BASE = 20, BOARD_MAX = 30, BOX_MAX = 40, BOX_STEP = 2.5, FEED_SECONDS = 3, FEED_STEP = 0.95, MERGE_SECONDS = 2, AUTO_MERGE_SECONDS = 5;
  var BOARD_SIZE = BOARD_BASE;      // 옛 이름(화면과 테스트가 쓴다): 기본 칸 수
  var BOXES = ['고철', '볼트', '철판', '톱니', '베어링', '모터', '변속기', '엔진', '발전기'];
  function boxName(level) { level = Math.floor(safeNum(level, 0)); if (level < 1) return ''; var tier = Math.floor((level - 1) / BOXES.length), n = BOXES[(level - 1) % BOXES.length]; for (var i = 0; i < tier; i++) n += '★'; return n; }
  function boxWorth(level) { level = Math.floor(safeNum(level, 0)); return level >= 1 && level <= BOX_MAX ? Math.pow(BOX_STEP, level - 1) : 0; }
  function machineLevels(s) { var n = 0; MACHINES.forEach(function (d) { n += s.machines[d.id] || 0; }); return n; }
  function lineMilestone(levels) { var m = 1; LINE_MILESTONES.forEach(function (t) { if (levels >= t) m *= 2; }); return m; }
  function machineBase(state, def) { var m = mods(state); return def.baseCost * m.cost * m.z3cost; }
  function machineCost(state, id, qty) {
    var def = findById(MACHINES, id); qty = Math.floor(qty);
    if (!def || !zoneOpen(state, 2) || !(qty >= 1) || (state.machines[id] || 0) + qty > def.max) return Infinity;
    return seriesCost(machineBase(state, def), def.growth, state.machines[id] || 0, qty);
  }
  function maxMachines(state, id) {
    var def = findById(MACHINES, id);
    if (!def || !zoneOpen(state, 2)) return 0;
    return seriesMax(machineBase(state, def), def.growth, state.machines[id] || 0, state.supplies, def.max);
  }
  function buyMachine(state, id, qty) {
    var def = findById(MACHINES, id); qty = Math.floor(qty);
    if (!def) return fail('unknown');
    if (!zoneOpen(state, 2)) return fail('locked');
    if (!(qty >= 1)) return fail('unknown');
    return pay(state, machineCost(state, id, qty), function () {
      state.machines[id] = (state.machines[id] || 0) + qty;
      // 단조기: 판의 상자도 그만큼 오른다(사는 순간 판이 통째로 바뀌는 것이 보인다)
      if (id === 'forge') { var b = boardOf(state); for (var i = 0; i < b.length; i++) if (b[i] >= 1) b[i] = Math.min(BOX_MAX, b[i] + qty); state.boxBest = Math.min(BOX_MAX, (state.boxBest || 0) + ((state.boxBest || 0) >= 1 ? qty : 0)); if (state.contract) state.contract.level = Math.min(BOX_MAX, state.contract.level + qty); }
    });
  }
  function feedSeconds(state) { return FEED_SECONDS * Math.pow(FEED_STEP, state.machines.feed || 0); }
  function spawnLevel(state) { return Math.min(BOX_MAX, 1 + (state.machines.forge || 0)); }
  function boardSize(state) { return clamp(BOARD_BASE + Math.round(mods(state).boardsize), BOARD_BASE, BOARD_MAX); }
  function boardOf(state) {
    if (!Array.isArray(state.board)) state.board = [];
    while (state.board.length < BOARD_MAX) state.board.push(0);
    if (state.board.length > BOARD_MAX) state.board.length = BOARD_MAX;
    return state.board;
  }
  function boardSum(state) { var b = boardOf(state), n = 0; for (var i = 0; i < b.length; i++) n += boxWorth(b[i]); return n; }
  /** 완제품(1단계 상자) 하나가 초당 버는 기준 값. */
  function productValue(state) { return PRODUCT_VALUE * mods(state).z3 * globalMult(state) * contractMult(state); }
  /** 줄과 값: { levels 도장 라인 레벨, milestone 2배 구간의 곱, nextMilestone, unit 1단계 상자 하나의 초당 물자, feed 상자 간격(초), spawn 들어오는 단계, size 칸 수 }. */
  function lineInfo(state) {
    var paint = state.machines.paint || 0, next = null, open = zoneOpen(state, 2);
    for (var i = 0; i < LINE_MILESTONES.length; i++) if (paint < LINE_MILESTONES[i]) { next = LINE_MILESTONES[i]; break; }
    var ms = lineMilestone(paint);
    return { levels: paint, milestone: ms, nextMilestone: next, unit: open ? (1 + paint) * ms * productValue(state) : 0, feed: feedSeconds(state), spawn: spawnLevel(state), size: boardSize(state),
      flow: open ? boardSum(state) : 0, steady: open && boardSum(state) > 0, bonus: 1, load: 1 };
  }
  /** 상자 하나(level 단계)가 초당 버는 물자. */
  function boxRate(state, level) { return lineInfo(state).unit * boxWorth(level); }
  /** 3구역이 초당 버는 물자: 판 위 상자들이 버는 것의 합. */
  function lineRate(state) { return zoneOpen(state, 2) ? lineInfo(state).unit * boardSum(state) : 0; }
  function lineNow(state) { return lineRate(state); }
  /** 의뢰가 찾고 있는 단계(없으면 0). 자동과 '가득 찼을 때의 합치기'는 이 단계를 되도록 건드리지 않는다. */
  function heldLevel(state) { return state.contract && state.contract.level >= 1 ? state.contract.level : 0; }
  /** idx 칸의 상자와 합칠 수 있는 다른 칸(없으면 -1). 가까운 칸부터 고른다(눈으로 따라가기 쉽다). */
  function boxPartner(state, idx) {
    var b = boardOf(state), lv = b[idx], best = -1, bd = 1e9;
    if (!(lv >= 1) || lv >= BOX_MAX) return -1;
    for (var i = 0; i < b.length; i++) if (i !== idx && b[i] === lv) { var d = Math.abs(i % 5 - idx % 5) + Math.abs(Math.floor(i / 5) - Math.floor(idx / 5)); if (d < bd) { bd = d; best = i; } }
    return best;
  }
  /** 가장 낮은 단계의 짝 [a, b] (없으면 null). skip 단계는 건너뛴다. */
  function lowestPair(state, skip) {
    var b = boardOf(state), seen = {}, best = null;
    for (var i = 0; i < b.length; i++) { var lv = b[i]; if (!(lv >= 1) || lv >= BOX_MAX || lv === skip) continue; if (seen[lv] !== undefined) { if (!best || lv < best.lv) best = { lv: lv, a: seen[lv], b: i }; } else seen[lv] = i; }
    return best ? [best.a, best.b] : null;
  }
  function doMerge(state, keep, gone, byHand) {
    var b = boardOf(state), lv = b[keep], out = { ok: true, at: keep, from: gone, level: lv + 1, gain: 0, hand: !!byHand };
    b[gone] = 0; b[keep] = lv + 1;
    if (byHand) { out.gain = boxRate(state, lv + 1) * MERGE_SECONDS * mods(state).mergebonus; state.mergesRun = (state.mergesRun || 0) + 1; }
    state.mergesAll = (state.mergesAll || 0) + 1;
    if (lv + 1 > (state.boxBest || 0)) { state.boxBest = lv + 1; out.best = true; }
    if (out.gain > 0) { earn(state, out.gain); state.lineEarned += out.gain; }
    return out;
  }
  /**
   * 손으로 합친다(3.6.0): idx 칸의 상자를 누르면 같은 단계의 상자가 둘씩 모두 합쳐진다(가까운 것부터, 누른 칸에 첫 결과가 남는다).
   *   왜: 투입구를 올리면 상자가 1초에 하나 넘게 들어온다. 하나씩 눌러서는 손이 못 따라가고 일이 된다.
   *       한 번 눌러 주루룩 합쳐지면 누를 일은 줄고, "어느 단계를 터뜨릴까"가 고를 거리가 된다(낮은 단계는 자리가 많이 나고, 높은 단계는 덤이 크다).
   *   윗단계끼리 또 짝이 맞아도 이어서 합치지는 않는다: 그것은 다음에 누를 거리다.
   * 돌려주는 값: { ok, at, level 새 단계, count 합친 짝 수, gain 덤의 합, merges: [{ at, from, gain }], best }
   */
  function mergeBox(state, idx) {
    if (!zoneOpen(state, 2)) return fail('locked');
    idx = Math.floor(safeNum(idx, -1));
    var b = boardOf(state);
    if (!(idx >= 0 && idx < boardSize(state)) || !(b[idx] >= 1)) return fail('empty');
    var lv = b[idx];
    if (lv >= BOX_MAX) return fail('alone');
    var cells = [];
    for (var i = 0; i < b.length; i++) if (b[i] === lv) cells.push(i);
    if (cells.length < 2) return fail('alone');
    var dist = function (c) { return Math.abs(c % 5 - idx % 5) + Math.abs(Math.floor(c / 5) - Math.floor(idx / 5)); };
    cells.sort(function (x, y) { return dist(x) - dist(y) || x - y; });      // 누른 칸이 맨 앞
    var out = { ok: true, at: idx, level: lv + 1, count: 0, gain: 0, merges: [], hand: true, best: false };
    for (var k = 0; k + 1 < cells.length; k += 2) {
      var r = doMerge(state, cells[k], cells[k + 1], true);
      out.count++; out.gain += r.gain; out.merges.push({ at: r.at, from: r.from, gain: r.gain }); if (r.best) out.best = true;
    }
    return out;
  }
  /** 합칠 수 있는 짝이 있는 칸들. */
  function mergeable(state) { var b = boardOf(state), cnt = {}, out = []; b.forEach(function (lv) { if (lv >= 1 && lv < BOX_MAX) cnt[lv] = (cnt[lv] || 0) + 1; }); b.forEach(function (lv, i) { if (lv >= 1 && cnt[lv] >= 2) out.push(i); }); return out; }
  /** 빈칸에 상자 하나를 넣는다. 빈칸이 없으면 넣지 못한다(false). */
  function spawnBox(state, rng, events) {
    var b = boardOf(state), size = boardSize(state), empty = [];
    for (var i = 0; i < size; i++) if (!(b[i] >= 1)) empty.push(i);
    if (!empty.length) return false;
    var roll = typeof rng === 'function' ? rng : Math.random;
    var at = empty[Math.floor(roll() * empty.length) % empty.length], lv = spawnLevel(state);
    if (mods(state).lucky > 0 && roll() < mods(state).lucky) lv = Math.min(BOX_MAX, lv + 1);      // 행운 상자
    b[at] = lv; if (lv > (state.boxBest || 0)) state.boxBest = lv;
    if (events) events.push({ type: 'box-in', at: at, level: lv });
    return true;
  }
  function boardFull(state) { var b = boardOf(state), size = boardSize(state); for (var i = 0; i < size; i++) if (!(b[i] >= 1)) return false; return true; }
  /**
   * 판의 시간을 흘린다.
   *   3.6.0: 가득 찬 판은 알아서 합쳐지지 않는다. 자리가 없으면 새 상자는 들어오지 못하고 기다린다(판 위의 상자는 계속 번다).
   *     전에는 가득 차면 가장 낮은 짝이 알아서 합쳐졌다. 투입구를 올리면 판이 늘 가득 차서 0.6초마다 혼자 합쳐졌고, 손이 할 일이 없었다.
   *   자동 합치기(개조)는 autoMergeSeconds 마다 짝 하나를 합쳐 자리를 낸다. 손보다 훨씬 느리다.
   *   긴 dt(자리 비움)는 상자 하나씩 따라가며 본다. 한 번에 최대 limit 개까지만 넣는다.
   */
  function stepBoard(state, dt, rng, events, limit) {
    if (!zoneOpen(state, 2)) return;
    dt = safeNum(dt, 0); if (!(dt > 0)) return;
    var fs = feedSeconds(state), n = 0, max = limit || 60, auto = autoEvents(state, 2);      // 구역 자동 스위치를 끄면 자동 합치기도 쉰다
    state.feed = (typeof state.feed === 'number' && isFinite(state.feed) ? state.feed : 1) + dt / fs;
    if (auto) state.autoMerge = Math.min(safeNum(state.autoMerge, 0) + dt / autoMergeSeconds(state), Math.max(2, dt / autoMergeSeconds(state) + 1));
    while (state.feed >= 1 && n < max) {
      if (!spawnBox(state, rng, n < 6 ? events : null)) {
        // 가득 찼다: 자동 합치기가 일할 몫이 남아 있으면 짝 하나를 합쳐 자리를 내고, 없으면 기다린다
        if (auto && state.autoMerge >= 1 && autoMergeOnce(state, n < 6 ? events : null)) continue;
        state.feed = 1; break;
      }
      state.feed -= 1; n++;
    }
    if (state.feed > 1 && n >= max) state.feed = 1;
    // 자리가 남아 있어도 자동 합치기는 제 박자로 하나씩 합친다(짧은 dt 에서는 한 번에 하나)
    if (auto && state.autoMerge >= 1 && dt <= autoMergeSeconds(state) * 2) { if (!autoMergeOnce(state, events)) state.autoMerge = Math.min(state.autoMerge, 1); }
    if (state.autoMerge > 2 && dt <= autoMergeSeconds(state) * 2) state.autoMerge = 2;
  }
  /** 자동 합치기가 짝 하나를 합치는 간격(초). 영구 특성 '자동화'가 줄여 준다(절반까지). 그래도 투입구를 올리면 상자가 더 빨리 들어와 누를 짝은 남는다. */
  var AUTO_MERGE_ROOM = 5;      // 조립공이 일을 시작하는 빈칸 수(한 줄)
  function boardRoom(state) { var b = boardOf(state), n = boardSize(state), room = 0; for (var i = 0; i < n; i++) if (!(b[i] >= 1)) room++; return room; }
  var AUTO_MERGE_STEPS = [5, 4, 3, 2.5, 2];      // 개조 '자동 합치기' 1~5레벨의 간격(초). 여기에 특성 '자동화'가 곱해져 가장 빠르면 1초다
  function autoMergeSeconds(state) { var lv = clamp(Math.round(mods(state).autoline), 1, AUTO_MERGE_STEPS.length); return AUTO_MERGE_STEPS[lv - 1] * assistFactor(state); }
  function autoMergeOnce(state, events) {
    state.autoMerge -= 1;
    /* 고르는 단계: 상자가 가장 많이 쌓인 단계(같으면 낮은 쪽). 가장 낮은 짝부터 고르면 새로 들어오는 상자만 치우느라 위에 쌓인 같은 상자들에 끝내 손이 닿지 않았다 */
    /* 3.8.9: 조립공은 판이 거의 찼을 때(빈칸이 AUTO_MERGE_ROOM 칸 이하)만 일한다. 3.8.4 처럼 쉬지 않고 합치면 판이 반쯤 빈 채로 남고
       손으로 누를 짝도 남지 않았다. 판이 차 있어야 버는 양도 많고(판의 합), 누를 것도 있다 */
    if (boardRoom(state) > AUTO_MERGE_ROOM) { state.autoMerge = Math.max(1, state.autoMerge + 1); return false; }
    var held = heldLevel(state), cnt = {}, pick = 0; boardOf(state).forEach(function (v) { if (v >= 1 && v < BOX_MAX && v !== held) cnt[v] = (cnt[v] || 0) + 1; });
    Object.keys(cnt).forEach(function (k) { k = +k; if (cnt[k] >= 2 && (!pick || cnt[k] > cnt[pick] || (cnt[k] === cnt[pick] && k < pick))) pick = k; });
    if (!pick) return false;
    /* 3.8.4: 자동 합치기도 손과 같게 한다. 전에는 한 번에 짝 하나만 합쳐서, 손으로 누르면 같은 상자가 모두 합쳐지는 것과 달랐고
       상자가 들어오는 것보다 느려 판이 늘 같은 상자로 차 있었다("안 합쳐지는 것 같다"). 이제는 한 단계의 짝을 모두 합친다.
       손과의 차이는 덤이다: 자동은 덤(합칠 때 받는 물자)을 받지 못한다. 의뢰가 찾는 단계는 그대로 남겨 둔다 */
    var b = boardOf(state), lv = pick, cells = [];
    for (var i = 0; i < b.length; i++) if (b[i] === lv) cells.push(i);
    for (var k = 0; k + 1 < cells.length; k += 2) { var r = doMerge(state, cells[k], cells[k + 1], false); r.type = 'box-merge'; r.auto = true; r.delay = k / 2; if (events) events.push(r); }
    return true;
  }
  /** 이 줄을 하나 더 사면 길게 보아 수입이 몇 배가 되는가(−1). 봇과 '한 번에 올리기'가 고르는 데 쓴다. */
  function machineGain(state, id) {
    var lv = state.machines[id] || 0, def = findById(MACHINES, id);
    if (!def || lv >= def.max) return 0;
    if (id === 'paint') return (lv + 2) / (lv + 1) * lineMilestone(lv + 1) / lineMilestone(lv) - 1;
    if (id === 'forge') return BOX_STEP - 1;
    return Math.pow(1 / FEED_STEP, 1.585) - 1;      // 투입구: 들어온 상자 수의 약 1.6제곱으로 판이 자란다
  }
  /** 값에 견줘 가장 이득인 줄을 times 번 산다(살 수 있는 만큼). 봇이 쓴다. */
  function tuneLine(state, times) {
    if (!zoneOpen(state, 2)) return fail('locked');
    times = Math.min(2000, Math.max(1, Math.floor(safeNum(times, 1))));
    var bought = 0, spent = 0, last = 'supplies';
    for (var i = 0; i < times; i++) {
      var best = null, score = -1;
      MACHINES.forEach(function (d) { var c = machineCost(state, d.id, 1), g = machineGain(state, d.id) / c; if (isFinite(c) && g > score) { score = g; best = d.id; } });
      var r = best ? buyMachine(state, best, 1) : fail('max');
      if (!r.ok) { last = r.reason; break; }
      bought++; spent += r.cost;
    }
    return bought ? { ok: true, bought: bought, cost: spent } : fail(last);
  }
  function tuneCost() { return Infinity; }

  /*
   * 납품 의뢰(3.5.0): 거래처가 "L단계 상자 N개"를 CONTRACT_SECONDS 안에 달라고 온다. 판에 그 상자가 N개 모이면 넘길 수 있다.
   *   넘기면 그 상자들은 판에서 나가고, 그 상자들이 CONTRACT_PAY_SECONDS 초 동안 벌 물자와 간식을 받는다. 거래처는 도감에 적힌다.
   *   이번 회차에 채운 의뢰 하나마다 상자 값이 CONTRACT_BONUS 씩 오른다(CONTRACT_BONUS_MAX 까지).
   *   찾는 단계는 지금 판에서 만들 만한 것으로 온다(들어오는 단계보다 1~3단계 위).
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
  var CONTRACT_SECONDS = 90, CONTRACT_PAY_SECONDS = 120, CONTRACT_GAP_MIN = 150, CONTRACT_GAP_MAX = 270, CONTRACT_BONUS = 0.01, CONTRACT_BONUS_MAX = 0.5, CONTRACT_TREATS = 2;
  function contractMult(state) { return 1 + Math.min(CONTRACT_BONUS_MAX, (state.contractsRun || 0) * CONTRACT_BONUS); }
  function clientCount(state) { var n = 0; CLIENTS.forEach(function (c) { if (state.clients[c.id] > 0) n++; }); return n; }
  /** 의뢰가 찾는 단계의 상자가 판에 몇 개 있는가. */
  function contractHave(state) { var lv = heldLevel(state), n = 0; if (lv) boardOf(state).forEach(function (x) { if (x === lv) n++; }); return n; }
  function contractReward(state) { return state.contract ? state.contract.need * boxRate(state, state.contract.level) * CONTRACT_PAY_SECONDS : 0; }
  function stepContracts(state, dt, made, rng, events) {
    if (!zoneOpen(state, 2)) return;
    if (state.contract) {
      state.contract.have = Math.min(state.contract.need, contractHave(state));
      // 3.8.3: 자동 합치기가 있으면 다 모인 의뢰도 알아서 넘긴다(구역 자동을 켜 두었을 때). 다만 지금 있는 구역에서는 절반만 받는다(autoShare): 손으로 넘기는 쪽이 낫다.
      //   3.5.0 에서는 넘기는 것을 손으로만 하게 했는데, 지나온 구역의 의뢰가 아무도 받지 않은 채 쌓였다 사라지기만 했다
      if (autoEvents(state, 2) && state.contract.have >= state.contract.need) { var cf = fillContract(state, true); if (cf.ok) { cf.type = 'contract-filled'; cf.auto = true; events.push(cf); return; } }
      state.contract.left -= dt;
      if (state.contract.left <= 0) { events.push({ type: 'contract-gone', who: state.contract.who }); state.contract = null; }
      return;
    }
    if (!(boardSum(state) > 0)) return;
    state.contractIn -= dt;
    if (state.contractIn > 0) return;
    rng = typeof rng === 'function' ? rng : Math.random;
    var who = CLIENTS[Math.floor(rng() * CLIENTS.length) % CLIENTS.length];
    var level = Math.min(BOX_MAX, spawnLevel(state) + 1 + Math.floor(rng() * 3) % 3), need = 2 + Math.floor(rng() * 2) % 2;
    state.contract = { who: who.id, level: level, need: need, have: 0, left: CONTRACT_SECONDS };
    state.contract.have = Math.min(need, contractHave(state));
    state.contractIn = (CONTRACT_GAP_MIN + rng() * (CONTRACT_GAP_MAX - CONTRACT_GAP_MIN)) * mods(state).contractgap;
    events.push({ type: 'contract', who: who.id, name: who.name, need: need, level: level, itemName: boxName(level) });
  }
  /** 모인 상자를 넘긴다. 덜 모였으면 실패(의뢰는 남는다). */
  function fillContract(state, auto) {
    if (!state.contract) return fail('none');
    var c = state.contract, b = boardOf(state);
    if (contractHave(state) < c.need) return fail('short');
    var who = findById(CLIENTS, c.who), gain = contractReward(state) * (auto ? autoShare(state, 2) : 1), first = !(state.clients[c.who] > 0);
    for (var i = b.length - 1, left = c.need; i >= 0 && left > 0; i--) if (b[i] === c.level) { b[i] = 0; left--; }
    earn(state, gain);
    state.lineEarned += gain;
    state.treats = Math.min(1e9, state.treats + CONTRACT_TREATS);
    state.clients[c.who] = Math.min(1e9, (state.clients[c.who] || 0) + 1);
    state.contractsRun = (state.contractsRun || 0) + 1;
    state.contract = null;
    return { ok: true, gain: gain, treats: CONTRACT_TREATS, first: first, who: who ? who.id : '', name: who ? who.name : '' };
  }
  /* 3.5.0 에서 없앤 것들: 품목 · 숙련 · 고장과 정비 · 출하 트럭 · 전력 투입 · 기계 다시 맞추기. 저장과 화면이 부르던 이름만 남겨 둔다. */
  var RECIPES = [{ id: 'bolt', name: '볼트' }];
  var JAM_GAP_MAX = 130, JAM_SELF_FIX = 30, TRUCK_GAP_MAX = 130, TRUCK_WAIT = 20, TRUCK_STOCK_MAX = 120;
  function recipeOf() { return RECIPES[0]; }
  function setRecipe() { return fail('gone'); }
  function repairJam() { return fail('gone'); }
  function loadTruck() { return fail('gone'); }
  function truckReward() { return 0; }
  function rebalanceLine() { return fail('gone'); }
  function stepLineEvents(state, dt, rng, events) {
    if (!zoneOpen(state, 2)) return;
    state.jam = null; state.truck = null; state.retool = 0; state.tuneLeft = 0;
    stepBoard(state, dt, rng, events);
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
  function autoOn(state, zone) { return zone >= 0 && zone < AUTO_KEYS.length && (mods(state)[AUTO_KEYS[zone]] > 0 || (zone === 4 && (state.upgrades.nurse || 0) > 0) ); }      // 4.3.8: 7구역의 이 스위치는 송신 기사만 다룬다(이장은 setElder)      // 4.0.3: 5구역은 자동이 둘(연구 조교 · 간호사). 하나만 있어도 켜진 것으로 본다
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
  function surge() { return fail('gone'); }      // 3.3.0: 전력 투입은 없앴다

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
    if (!def || !zoneOpen(state, 3) || (state.routes[id] || 0) >= def.max) return Infinity;
    var m = mods(state);
    return Math.ceil(def.baseCost * Math.pow(def.growth, state.routes[id] || 0) * m.cost * m.traincost);
  }
  function buyRoute(state, id) {
    if (!findById(ROUTES, id)) return fail('unknown');
    if (!zoneOpen(state, 3)) return fail('locked');
    return pay(state, routeCost(state, id), function () { state.routes[id]++; });
  }
  /** 노선 하나를 다녀오는 데 걸리는 시간(초, 강화 포함). */
  function tripSeconds() { return Infinity; }      // 3.4.0 부터 쓰지 않는다
  /**
   * 지금의 배차 { riders: { 노선: 열차 수 }, slots: { 노선: 자리 수 }, idle: 탈 노선이 없어 쉬는 열차 수 }.
   * 배수가 높은 노선부터 자리를 채운다.
   */
  function railPlan(state) {
    var left = zoneOpen(state, 3) ? state.trains : 0, riders = {}, slots = {};
    var order = ROUTES.slice().sort(function (a, b) { return b.mult - a.mult; });
    // 2.5.4: 복구한 노선에는 먼저 한 대씩 보낸다(배수가 높은 노선부터). 그다음 남은 열차를 배수가 높은 노선부터 채운다.
    // 전에는 배수 순서로만 채워서, 열차가 모자라면 순환선처럼 배수가 낮은 노선은 0대로 서 있었다.
    // 돈 들여 복구한 노선이 멈춰 있으니 고장으로 보였다. 한 대를 낮은 배수로 돌리는 손해는 작다(22대 가운데 한 대가 ×1.4 대신 ×1).
    order.forEach(function (d) {
      slots[d.id] = (state.routes[d.id] || 0) * ROUTE_SLOTS;
      riders[d.id] = slots[d.id] > 0 && left > 0 ? 1 : 0;
      left -= riders[d.id];
    });
    order.forEach(function (d) {
      var more = Math.min(left, slots[d.id] - riders[d.id]);
      riders[d.id] += more; left -= more;
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
  var SALVAGE_SECONDS = 150, SALVAGE_NEED_SECONDS = 35, SALVAGE_GAP_MIN = 180, SALVAGE_GAP_MAX = 300, SALVAGE_PAY = 2, SALVAGE_BONUS = 0.01, SALVAGE_BONUS_MAX = 0.5, SALVAGE_TREATS = 2;
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
  /*
   * ---------- 4구역: 승강장의 열차(3.7.0 에서 구역 전체를 다시 맞췄다) ----------
   * 3.4.0 의 잘못: 무리가 닿는 시간이 숫자로 보여서 고민할 것이 없었고, 12칸이 차면 알아서 떠나는데 돈 주고 산 역무원은 8칸에서 보내서
   *   "가만히 두는 것이 자동보다 낫다"는 앞뒤 안 맞는 일이 생겼다. 줄 · 개조 · 목표도 옛 노선의 것 그대로였다.
   * 기준: 아무것도 안 함 < 역무원 < 손으로 잘 보냄. 그리고 4구역의 손맛은 "더 끌까, 지금 보낼까"의 긴장이다(3구역의 '터뜨리기'와 다르다).
   *
   * 판:   승강장의 열차에 화물칸이 carSeconds 마다 하나씩 붙는다(carMax 칸까지). 붙는 동안 번 화물이 열차에 실린다(plat.bank).
   *       보내면 실린 화물 × carMult(칸 수) ÷ CAR_NORM 을 한꺼번에 받는다. 길수록 한 칸의 값이 뛴다.
   *       꽉 찬 열차는 더 싣지 못하고 서 있다(알아서 떠나지 않는다).
   * 무리: 선로를 따라 다가온다(plat.pos 1 → 0). 걸음이 고르지 않고 가끔 달려든다: 언제 닿을지 정확히는 알 수 없다(화면에는 거리만 보인다).
   *       닿으면 열차는 뒤쪽 절반을 떼고 떠난다.
   * 줄:   기관차(한 칸의 값) · 화물 등급(더 값진 칸, 레벨마다 2배) · 연결 작업반(칸이 빨리 붙는다). 셋이 하는 일이 다르다(3.8.0).
   * 개조: 긴 승강장(칸 수 +2) · 철조망(무리가 느려진다) · 튼튼한 연결기(덜 떼인다) · 정비창(값) · 부표(표류 화물) · 역무원.
   * 자동: 역무원은 꽉 차면, 또는 무리가 AUTO_NEAR 안으로 들어오면 보낸다. 떼이지는 않지만 아슬아슬하게 끌지도 않는다.
   *       손으로는 무리가 더 가까이 올 때까지 끌 수 있다(그만큼 칸이 더 붙는다).
   *       (처음에는 역무원이 늘 8칸에서 보내게 했다. 그러면 긴 승강장을 사도 역무원을 켜 둔 사람은 10칸을 영영 못 보냈다.)
   */
  /*
   * 3.8.0 손이 할 일을 늘렸다. 전에는 40초에 한 번 '출발'을 누르는 것이 전부라 그 사이가 지루했다.
   *   - 칸 당기기(pullCar): 승강장 그림을 누를 때마다 다음 칸이 PULL_SECONDS 초만큼 빨리 붙는다. 누르는 만큼 열차가 길어지고 배수가 오른다.
   *   - 경적(blowHorn): 무리를 HORN_PUSH 만큼 밀어낸다. 열차 하나에 hornMax 번뿐이라 언제 쓸지 골라야 한다.
   *   - 무리는 더 빨리 온다(HORDE_SECONDS 70 → 45). 가만히 있으면 8칸도 못 채운다: 당기고, 밀어내고, 떠날 때를 잰다.
   *   기준 칸 수(AUTO_CARS)도 8 → 6 으로 낮췄다: 역무원에게 맡기면 대략 화면의 초당만큼, 손으로 당기면 그보다 훨씬 더 번다.
   */
  var CAR_SECONDS = 5, CAR_BASE = 8, CAR_MAX = 12, CAR_STEP = 0.12, AUTO_CARS = 6, AUTO_NEAR = 0.36, RAIL_SCALE = 0.9;
  var PULL_SECONDS = 0.25, HORN_PUSH = 0.2, HORN_BASE = 1;
  var TEST = { rush: 1, er: 1, wave: 1, night: 1, stray: 1 };      // er: 급한 환자가 오는 빠르기에 곱한다(0 이면 오지 않는다)
  void 0;      // 화면 테스트용 손잡이: 돌진이 오는 확률에 곱한다(0 이면 오지 않는다). 게임에서는 늘 1
  var HORDE_SECONDS = 45, HORDE_SPRINT = 0.08, HORDE_WARN = 1.5, HORDE_RUSH_SPEED = 0.6, HORDE_RUSH_DIST = 0.45, HORDE_RUSH_CARS = 2, LONG_CARS = 10;      // 3.8.4: 돌진. 드물게 조금 건너뛰던 것을, 눈에 보이게 한참 달려오도록 바꿨다
  /* 칸 수에 따른 배수. 8칸까지는 한 칸에 +0.1, 그 뒤로는 크게 뛴다(9칸 1.95 · 10칸 2.25 · 11칸 2.6 · 12칸 3.0): 욕심낼 값어치가 있어야 긴장이 생긴다 */
  var CAR_MULTS = [0, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.95, 2.25, 2.6, 3];
  function carMult(n) { n = clamp(Math.floor(safeNum(n, 0)), 0, CAR_MAX); return CAR_MULTS[n]; }
  var CAR_NORM = carMult(AUTO_CARS);
  function carSeconds(state) { return CAR_SECONDS * Math.pow(CREW_STEP, state.routes.crew || 0) * mods(state).trip; }
  function carMax(state) { return clamp(CAR_BASE + Math.round(mods(state).platlen), CAR_BASE, CAR_MAX); }
  /** 화물을 싣는 힘: 기관차 레벨 × 화물 등급의 배수. 기관차가 없으면 열차가 서지 않는다. */
  function railUnits(state) {
    if (!zoneOpen(state, 3)) return 0;
    return (state.trains || 0) * Math.pow(GRADE_STEP, state.routes.grade || 0);
  }
  /** 4구역이 초당 싣는 물자. 역무원에게 맡겨 8칸에서 보낼 때 실제로 버는 속도와 같다. */
  function railRate(state) { return railUnits(state) * RAIL_SCALE * cargoValue(state); }
  function newPlat() { return { t: 0, bank: 0, pos: 1, horn: 0, rush: 0, warn: 0, hand: 0 }; }      // rush: 달려오는 중이면 남은 거리(양수), 이 열차에서 이미 한 번 달려왔으면 -1
  /** 열차 하나에 쓸 수 있는 경적 횟수. */
  function hornMax(state) { return HORN_BASE + Math.round(mods(state).horn); }
  function platOf(state) {
    var p = state.plat;
    if (!p || typeof p !== 'object') p = state.plat = newPlat();
    if (typeof p.pos !== 'number' || !isFinite(p.pos) || p.pos > 1) p.pos = 1;
    return p;
  }
  /** 지금 승강장의 열차: { cars 붙은 칸, max 붙을 수 있는 칸, next 다음 칸까지 남은 초, near 무리와의 거리(1 멀다 → 0 닿았다), mult, gain 지금 보내면 받는 물자, full }. */
  function trainInfo(state) {
    var p = platOf(state), cs = carSeconds(state), max = carMax(state), cars = Math.min(max, Math.floor(p.t / cs + 1e-9));
    return { cars: cars, max: max, full: cars >= max, next: cars >= max ? 0 : cs - (p.t - cars * cs), near: p.pos,
      mult: carMult(cars), gain: trainGain(state, cars, cars), bank: p.bank, running: railUnits(state) > 0, horn: Math.max(0, hornMax(state) - (p.horn || 0)), hand: !!p.hand, rushed: p.rush === -1, rush: p.rush > 0 ? (p.warn > 0 ? 'warn' : 'run') : '', warn: p.rush > 0 ? p.warn || 0 : 0 };
  }
  /** cars 칸이 붙은 열차를 kept 칸만 달고 보낼 때 받는 물자. */
  function trainGain(state, cars, kept) { var p = platOf(state); return cars >= 1 && kept >= 1 ? p.bank * (kept / cars) * carMult(kept) / CAR_NORM : 0; }
  function departTrain(state, why, events) {
    var p = platOf(state), info = trainInfo(state), cars = info.cars, kept = why === 'horde' ? Math.ceil(cars * (mods(state).keepmore > 0 ? 2 / 3 : 1 / 2)) : cars;      // 튼튼한 연결기: 뒤쪽 절반이 아니라 3분의 1만 떼인다
    var gain = cars >= 1 ? trainGain(state, cars, kept) : p.bank / CAR_NORM / 2;      // 한 칸도 못 붙이고 쫓겨난 열차는 실은 것의 절반
    if (gain > 0) {
      earn(state, gain); state.railEarned += gain;
      if (state.salvage) state.salvage.have = Math.min(state.salvage.need, state.salvage.have + gain);      // 표류 화물: 보낸 열차의 화물 값이 쌓인다
    }
    state.trainsSent = (state.trainsSent || 0) + 1;
    if (why !== 'horde' && kept >= LONG_CARS) state.longRuns = (state.longRuns || 0) + 1;      // 10칸 이상으로 보낸 횟수(목표)
    if (why !== 'horde' && kept >= CAR_MAX) state.expressRuns = (state.expressRuns || 0) + 1;      // 만차(12칸). 옛 이름을 그대로 쓴다(저장 호환)
    if (why === 'horde') state.hordeHits = (state.hordeHits || 0) + 1;
    state.plat = newPlat();
    var ev = { type: 'train', why: why, cars: cars, kept: kept, gain: gain, full: why !== 'horde' && kept >= CAR_MAX, name: kept + '칸 열차' };
    if (events) events.push(ev);
    return ev;
  }
  /** 칸 당기기: 다음 칸이 PULL_SECONDS 초만큼 빨리 붙는다. 꽉 찬 열차에는 못 쓴다. */
  function pullCar(state) {
    if (!zoneOpen(state, 3)) return fail('locked');
    if (!(railUnits(state) > 0)) return fail('stopped');
    var p = platOf(state), before = trainInfo(state);
    if (before.full) return fail('full');
    p.hand = 1;      // 3.9.1: 손댄 열차(돌진은 손댄 열차에만 온다)
    p.t += PULL_SECONDS;      // 화물은 실제로 흐른 시간만큼만 실린다. 당기면 '같은 시간에 더 긴 열차'가 되어 배수가 오른다(최대 만차 ×3)
    state.pullsRun = (state.pullsRun || 0) + 1;
    var after = trainInfo(state);
    return { ok: true, cars: after.cars, added: after.cars > before.cars, full: after.full };
  }
  /** 경적: 무리를 HORN_PUSH 만큼 밀어낸다. 열차 하나에 hornMax 번. */
  function blowHorn(state) {
    if (!zoneOpen(state, 3)) return fail('locked');
    if (!(railUnits(state) > 0)) return fail('stopped');
    var p = platOf(state);
    if ((p.horn || 0) >= hornMax(state)) return fail('empty');
    var broke = p.rush > 0;      // 3.8.6: 달려오는 무리(예고 중이어도)를 경적이 끊는다
    if (broke) { p.rush = -1; p.warn = 0; }
    p.horn = (p.horn || 0) + 1; p.pos = Math.min(1, p.pos + HORN_PUSH);
    state.hornsRun = (state.hornsRun || 0) + 1;
    return { ok: true, near: p.pos, left: hornMax(state) - p.horn, broke: broke };
  }
  /** 손으로 보낸다. 한 칸이라도 붙어 있어야 한다. */
  function sendTrain(state) {
    if (!zoneOpen(state, 3)) return fail('locked');
    if (!(railUnits(state) > 0)) return fail('stopped');
    if (trainInfo(state).cars < 1) return fail('empty');
    var ev = departTrain(state, 'hand', null); ev.ok = true;
    return ev;
  }
  /**
   * 승강장의 시간을 dt 초 흘린다. 1초 이하로 나눠서 본다(무리가 닿는 때를 지나치지 않게).
   *   무리의 걸음: 1초에 1 / HORDE_SECONDS 씩이 기준이고, 그때그때 0.5~1.5배로 흔들린다. 돌진은 stepRail 안의 설명을 본다(3.8.6).
   *   철조망(hordespeed)이 걸음을 늦춘다. 달려드는 거리는 그대로다.
   *   너무 긴 dt 는 900걸음까지만 따라가고, 남는 시간은 역무원이 보낸 것으로 친다(평균 속도).
   */
  function stepRail(state, dt, events, rng) {
    if (!zoneOpen(state, 3)) return;
    dt = safeNum(dt, 0); if (!(dt > 0)) return;
    if (!(railUnits(state) > 0)) return;
    var roll = typeof rng === 'function' ? rng : Math.random;
    var auto = autoOn(state, 3) && autoEvents(state, 3), steps = Math.min(900, Math.ceil(dt)), h = Math.min(dt, steps) / steps, rest = dt - h * steps, slow = mods(state).hordespeed;
    for (var i = 0; i < steps; i++) {
      var p = platOf(state), before = trainInfo(state);
      p.t += h; if (!before.full) p.bank += railRate(state) * h;      // 꽉 찬 열차는 더 싣지 못한다
      p.pos -= h / HORDE_SECONDS * (0.5 + roll()) * slow;
      /* 3.8.6 돌진을 다시 만들었다. 3.8.4 의 돌진은 예고도 없이 거리만 조금 줄고 끝나서, 할 일도 없고 위험하지도 않았다.
         이제: 칸이 HORDE_RUSH_CARS 칸 이상 붙은 열차에(잃을 것이 있을 때) 1초에 HORDE_SPRINT 의 확률로 온다. 열차 한 대에 한 번.
           1) 예고 HORDE_WARN 초: 화면이 경고한다. 2) 그 뒤로는 초당 HORDE_RUSH_SPEED 로 닿을 때까지 달려온다(철조망도 못 늦춘다).
         막는 길은 둘: 경적을 울려 돌진을 끊거나(blowHorn), 그 자리에서 보낸다. 그래서 경적을 미리 써 버릴지 아껴 둘지가 선택이 된다 */
      /* 3.9.1: 돌진은 '손댄 열차'에만 온다(이 열차에서 칸을 한 번이라도 당겼을 때). 돌진은 손으로 경적을 울려야 끊을 수 있는데,
         아무도 보고 있지 않은 열차에 오면 막을 길이 없이 떼이기만 한다. 3.8.9 처럼 빈도를 낮추는 것으로는 그 문제가 그대로 남는다.
         그래서 역무원에게 맡겨 둔 열차는 조용히 다니고, 칸을 당겨 더 긴 열차를 노릴 때에만 돌진의 위험이 따라온다 */
      if (!p.rush && p.hand && before.cars >= HORDE_RUSH_CARS && roll() < HORDE_SPRINT * TEST.rush * h) { p.rush = HORDE_RUSH_DIST; p.warn = HORDE_WARN; if (events) events.push({ type: 'horde-sprint', near: Math.max(0, p.pos) }); }
      else if (p.rush > 0) {
        /* 3.9.2: 돌진은 거리의 HORDE_RUSH_DIST(45%)만큼만 달려온다. 3.8.6 에서는 닿을 때까지 달려와서, 무리가 아무리 멀어도 한 번에 끝났다.
           멀리 있을 때의 돌진은 '확 가까워지는 것'이고, 이미 가까울 때의 돌진만 닿는다 */
        if (p.warn > 0) p.warn = Math.max(0, p.warn - h);
        else { var run = Math.min(p.rush, HORDE_RUSH_SPEED * h); p.pos -= run; p.rush -= run; if (!(p.rush > 1e-9)) p.rush = -1; }
      }
      var info = trainInfo(state);
      /* 3.8.9 역무원과 돌진: 역무원은 돌진을 끊지 못한다. 경고가 도는 동안은 기다리고(그 사이에 손으로 경적을 울릴 수 있다),
         경고가 끝나면 뒤쪽을 떼고 떠난다(무리에 닿은 것과 같다 — 튼튼한 연결기가 여기서 쓸모가 있다).
         3.8.6 에서는 돌진이 오자마자 역무원이 보내 버려 경적을 울릴 틈이 없었고, 떼이는 일이 없어 연결기가 쓸모없었다 */
      /* 3.9.2: 돌진이 끝까지 오지 않게 되어, 역무원은 다시 평소대로 한다. 다만 경고가 도는 동안은 보내지 않는다(그 사이에 손으로 경적을 울릴 수 있게) */
      if (auto && info.cars >= 1 && (info.full || (p.pos <= AUTO_NEAR && !(p.rush > 0 && p.warn > 0)))) departTrain(state, 'auto', events);
      else if (p.pos <= 0) departTrain(state, 'horde', events);
    }
    if (rest > 0) { var flat = railRate(state) * rest; earn(state, flat); state.railEarned += flat; }
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
   * 병원 서류(1.1.3, 5구역): (4.0.5 부터) 사람을 손으로 되돌릴 때 RECORD_CHANCE 의 확률로 병원에 남아 있던 서류 한 장을 찾는다.
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
  /*
   * ---------- 4.0.3 5구역을 다시 만들었다: 여섯 대 ----------
   * 왜: 시험관을 눌러 거두는 5구역(3.9.2~4.0.2)은 결과가 뻔했다. 금빛이 되면 누르면 끝이라 고를 것이 없었다.
   *     이야기의 규칙을 그대로 놀이로 옮긴다: "혈청 한 대는 변하는 것을 멈추기만 하고, 여섯 대를 맞아야 사람으로 되돌아온다."
   * 그림: 병실에 의자가 seatCount 개 있고, 물린 사람이 와서 앉는다. 사람마다 '변하는 줄'이 차오른다(turnSeconds 초, 사람마다 조금씩 다르다).
   * 손:   ① 냉장 상자를 누르면 혈청이 빨리 만들어진다(한 번에 SERUM_TAP 대만큼). ② 사람을 누르면 혈청 한 대를 놓는다.
   *       첫 한 대: 변하는 줄이 멈추고 한 대의 값을 받는다. 여섯 대째: 사람으로 돌아오고 WARD_CURE 대의 값을 받는다(한 대씩 여섯에게 나눠 주는 것의 두 배).
   *       혈청은 늘 모자라다. 급한 사람들을 한 대씩 멈춰 둘지, 한 사람에게 몰아서 되돌릴지를 고른다. 몰아 주는 동안 다른 사람이 변할 수 있다.
   *       변하는 줄이 다 찰 때까지 한 대도 못 맞은 사람은 변해서 나간다(받는 것 없음). 멈춘 사람은 새 사람이 와서 자리가 모자랄 때 자리를 내 준다(4.0.6).
   * 자동: 둘이다. 연구 조교(autolab)는 혈청을 만든다(serumSeconds 초에 한 대). 간호사(nurse)는 한 대도 못 맞은 가장 급한 사람에게 한 대를 놓는다.
   *       간호사는 멈추기만 한다. 되돌리는 것은 손뿐이다. 둘 다 있으면 초당 수입 그대로(1배), 손으로 되돌리면 그 두 배까지.
   * 값:   한 대의 값 = 약품 초당(labRate) × SERUM_SECONDS. 연구 점수도 같은 식(researchRate).
   * 줄:   연구원(값) · 의자(자리 수, 값도 그만큼) · 시약 등급(2배씩). 개조: 냉장 상자(쌓아 두는 수) · 진정제(변하는 줄이 느리게) · 연구 조교 · 간호사.
   */
  var SEAT_BASE = 4, SEAT_MAX = 6, SERUM_SECONDS = 4, SERUM_CAP = 6, SERUM_CAP_STEP = 2, SERUM_TAP = 0.12, TURN_SECONDS = 16, TURN_BREAK = 2, TURN_STUN = 1.2, WARD_DOSES = 6, WARD_CURE = 12, WARD_STAY = 12, WARD_STAY_ONE = 5, WARD_ARRIVE = 4.5, WARD_FILL = 1.2, NURSE_SECONDS = 3.5, NURSE_FROM = 0.7, REAGENT_STEP = 2, REAGENT_MAX = 10, LAB_SCALE = 1;
  var RACK_COST = 2e23, RACK_GROWTH = 30, REAGENT_COST = 5e23, REAGENT_GROWTH = 14;
  var ACUTE_CHANCE = 1 / 6, ACUTE_RATE = 2.6, HARD_SPEED = 1.3;      // 급성 환자가 올 확률 · 그 빠르기 · 빡빡한 차트를 하는 동안의 빠르기
  var ER_FIRST = 35, ER_EVERY = 70, ER_TIME = 22, ER_HAND = 30;      // 급한 환자: 첫 침대까지 · 그 뒤 간격 · 여섯 대를 놓을 시간 · '손을 쓰고 있다'로 치는 시간(초)
  var BOOST_DOSES = 3, MIX_BASE = 14, MIX_MIN = 6;                    // 강화 혈청: 몇 대 몫인지 · 손으로 몇 대마다 오는지(연구원 5명마다 1대씩 줄어 MIX_MIN 까지)
  var CHART_EASY = 0.1, CHART_HARD = 0.3;                             // 회진 차트를 끝낼 때마다 혈청 값에 더해지는 몫
  var BOON_RICH = 0.2, BOON_SLOW = 0.1, BOON_QUICK = 0.25;
  var BOONS = [
    { id: 'rich', name: '진한 혈청', text: '혈청 값 +20%', max: 5 },
    { id: 'slow', name: '느린 맥', text: '변하는 시간 +10%', max: 5 },
    { id: 'box', name: '큰 상자', text: '혈청 칸 +1', max: 4 },
    { id: 'quick', name: '빠른 손', text: '단추 한 번에 +25%', max: 4 },
    { id: 'cash', name: '물자 한 뭉치', text: '혈청 30대 값을 바로', max: Infinity }
  ];
  /* 4.1.1 끝없이 불어나지 않게 상한을 뒀다. 전에는 급한 환자를 살릴 때마다, 차트를 끝낼 때마다 혈청 값이 한없이 올랐다(한 시간이면 열 배쯤).
     고르는 것은 저마다 max 번까지(다 차면 더 나오지 않는다. '물자 한 뭉치'는 늘 나온다). 차트로 오르는 혈청 값은 CHART_MAX 까지, 그 뒤로는 차트를 끝낼 때마다 물자를 한 뭉치 받는다 */
  var CHART_MAX = 2, CASH_DOSES = 30, CHART_CASH = 20, CHART_CASH_HARD = 60;
  var BOON_BY = {}; BOONS.forEach(function (d) { BOON_BY[d.id] = d; });
  var CHART_TEXT = { stop: '멈추기', dose: '손으로 놓기', cure: '되돌리기', er: '급한 환자', boost: '강화 혈청' };      // 세 칸에 나란히 들어가야 해서 짧게 적는다
  function seatCount(state) { return clamp(SEAT_BASE + Math.floor(safeNum(state.racks, 0)), SEAT_BASE, SEAT_MAX); }
  function boonOf(state, id) { var b = state.boons; return b && b[id] > 0 ? b[id] : 0; }
  function serumCap(state) { return SERUM_CAP + SERUM_CAP_STEP * mods(state).peak + boonOf(state, 'box'); }
  function turnSeconds(state) { return TURN_SECONDS * (1 + mods(state).sterile) * (1 + BOON_SLOW * boonOf(state, 'slow')); }
  function serumSeconds(state) { return SERUM_SECONDS * assistFactor(state); }
  function nurseOn(state) { return (state.upgrades.nurse || 0) > 0 && autoEvents(state, 4); }
  function newWard() { return { seats: [], stock: 0, make: 0, nurse: 0, stun: 0, arrive: 0.8, mix: 0, boost: 0, hand: 999, erNext: ER_FIRST, er: null, pick: null }; }
  function wardOf(state) {
    var w = state.ward; if (!w || typeof w !== 'object' || !Array.isArray(w.seats)) w = state.ward = newWard();
    if (!(w.erNext > 0)) w.erNext = ER_FIRST; if (!(w.mix >= 0)) w.mix = 0; if (!(w.hand >= 0)) w.hand = 999;
    if (!w.chart) w.chart = newChart(state, false);
    var n = seatCount(state); while (w.seats.length < n) w.seats.push({ wait: 0 }); if (w.seats.length > n) w.seats.length = n;      // { wait } 는 빈 의자
    return w;
  }
  function doseValue(state) { return labRate(state) * SERUM_SECONDS; }
  function researchRate(state) { return zoneOpen(state, 4) ? state.staff * milestoneMult(state.staff) * mods(state).lab * seatCount(state) / SEAT_BASE : 0; }      // 옛 연구 점수의 빠르기(이제 쓰지 않는다)
  function rackCost(state) { return zoneOpen(state, 4) && seatCount(state) < SEAT_MAX ? Math.ceil(RACK_COST * Math.pow(RACK_GROWTH, state.racks || 0) * mods(state).cost * mods(state).staffcost) : Infinity; }
  function buyRack(state) { if (!zoneOpen(state, 4)) return fail('locked'); return pay(state, rackCost(state), function () { state.racks = (state.racks || 0) + 1; wardOf(state); }); }
  function reagentCost(state) { return zoneOpen(state, 4) && (state.reagent || 0) < REAGENT_MAX ? Math.ceil(REAGENT_COST * Math.pow(REAGENT_GROWTH, state.reagent || 0) * mods(state).cost * mods(state).staffcost) : Infinity; }
  function buyReagent(state) { if (!zoneOpen(state, 4)) return fail('locked'); return pay(state, reagentCost(state), function () { state.reagent = (state.reagent || 0) + 1; }); }
  /** 냉장 상자를 두드린다: 혈청이 SERUM_TAP 대만큼 더 만들어진다. 가득 차 있으면 소용없다. */
  function tapSerum(state) {
    if (!zoneOpen(state, 4)) return fail('locked');
    if (!(state.staff > 0)) return fail('stopped');
    var w = wardOf(state);
    if (w.stun > 0) return fail('stun');
    if (w.stock >= serumCap(state)) return fail('full');
    w.make += SERUM_TAP * (1 + BOON_QUICK * boonOf(state, 'quick')); w.hand = 0; state.serumTaps = (state.serumTaps || 0) + 1;
    var made = 0; while (w.make >= 1 && w.stock < serumCap(state)) { w.make -= 1; w.stock++; made++; }
    return { ok: true, made: made, stock: w.stock };
  }
  /** i번째 의자의 사람에게 한 대 놓는다. auto: 간호사가 놓았다(횟수에 안 든다). */
  /*
   * 4.0.5 '연구 성과'(점수를 모아 둘 가운데 하나를 고르던 것)를 없앴다.
   *   왜: 이 구역의 할 일은 이제 병실이다. 연구 성과는 값이 차기를 기다리는 것 말고는 할 일이 없었고, 고를수록 '전체 생산 1.3배' 같은 효과가 끝없이 쌓였다.
   *   4.0.6: 대신 넣으려던 '서류 찾기'도 넣지 않는다. 이 구역에는 병실 하나만 있다. 예전에 찾은 서류는 도감에 남고, 이번 회차에 찾은 만큼의 값 오름도 철수할 때까지 남는다.
   *   runProject 등 옛 함수는 남겨 두었지만(이번 회차에 이미 고른 효과는 철수할 때까지 남는다) 점수가 더는 쌓이지 않아 새로 고를 수는 없다.
   */
  function injectSeat(state, i, auto, rng) {
    if (!zoneOpen(state, 4)) return fail('locked');
    if (!(state.staff > 0)) return fail('stopped');
    i = Math.floor(safeNum(i, -1));
    var w = wardOf(state), p = w.seats[i];
    if (w.stun > 0 && !auto) return fail('stun');
    if (!p || !(p.dose >= 0)) return fail('empty');
    if (!(w.stock >= 1)) return fail('nostock');
    w.stock--;
    var out = landDose(state, i, 1, auto, rng);
    if (!auto) mixTick(state, w, out);
    return out;
  }
  /*
   * 4.0.8 병실에 세 가지를 더했다(연구 성과를 없앤 자리).
   *   ① 급한 환자: 손을 쓰고 있을 때 가끔 이동 침대가 들어온다. ER_TIME 초 안에 여섯 대를 다 놓아야 한다(한 대로는 멈추지 않는다. 간호사는 손대지 않는다).
   *      살리면 둘 가운데 하나를 고른다(BOONS, 이번 회차 동안). 놓치면 의자의 사람과 똑같이 변해 달려든다.
   *   ② 회진 차트: 세 줄을 다 채우면 혈청 값이 오르고, 다음 차트를 둘 가운데 고른다(가벼운 것 / 빡빡한 것: 누가 변하면 처음부터).
   *   ③ 강화 혈청: 손으로 mixNeed 대를 놓을 때마다 연구원이 한 대 가져온다(연구원이 많을수록 자주). 한 대가 BOOST_DOSES 대 몫이고, 누구에게 쓸지 고른다.
   *   셋 다 '손으로' 한 일로만 나아간다. 자리를 비운 동안(굵은 걸음)에는 급한 환자가 오지 않는다.
   */
  function mixNeed(state) { return Math.max(MIX_MIN, MIX_BASE - Math.floor(safeNum(state.staff, 0) / 5)); }
  function newChart(state, hard) {
    var no = Math.floor(safeNum(state.chartNo, 0)), k = hard ? 1.5 : 1;
    var a = no % 2 === 0 ? { k: 'stop', need: Math.min(14, 4 + no) } : { k: 'dose', need: Math.min(40, 12 + 3 * no) };
    var b = no % 2 === 0 ? { k: 'boost', need: hard ? 2 : 1 } : { k: 'er', need: 1 };
    var c = { k: 'cure', need: Math.min(4, 1 + Math.floor(no / 3)) + (hard ? 1 : 0) };
    a.need = Math.ceil(a.need * k);
    return { hard: !!hard, done: false, lines: [a, b, c].map(function (l) { return { k: l.k, need: l.need, have: 0 }; }) };
  }
  /** 차트의 k 줄을 n 만큼 채운다. 세 줄이 다 차면 그 자리에서 혈청 값이 오른다(다음 차트는 nextChart 로 고른다). */
  function chartTick(state, k, n) {
    var w = state.ward, ch = w && w.chart; if (!ch || ch.done) return false;
    ch.lines.forEach(function (l) { if (l.k === k) l.have = Math.min(l.need, l.have + (n || 1)); });
    if (!ch.lines.every(function (l) { return l.have >= l.need; })) return false;
    ch.done = true;
    if (chartFull(state)) { var lump = doseValue(state) * (ch.hard ? CHART_CASH_HARD : CHART_CASH); earn(state, lump); state.labEarned = (state.labEarned || 0) + lump; }
    else state.chartBonus = Math.min(CHART_MAX, safeNum(state.chartBonus, 0) + (ch.hard ? CHART_HARD : CHART_EASY));
    state.chartNo = Math.floor(safeNum(state.chartNo, 0)) + 1;
    return true;
  }
  function chartFull(state) { return safeNum(state.chartBonus, 0) >= CHART_MAX - 1e-9; }
  function chartMiss(state) { var ch = state.ward && state.ward.chart; if (ch && ch.hard && !ch.done) { ch.lines.forEach(function (l) { l.have = 0; }); return true; } return false; }
  function nextChart(state, hard) {
    if (!zoneOpen(state, 4)) return fail('locked');
    var w = wardOf(state); if (!w.chart.done) return fail('notdone');
    w.chart = newChart(state, !!hard); return { ok: true, hard: !!hard };
  }
  function pickBoon(state, id) {
    if (!zoneOpen(state, 4)) return fail('locked');
    var w = wardOf(state); if (!w.pick || w.pick.indexOf(id) < 0) return fail('nopick');
    if (!state.boons || typeof state.boons !== 'object') state.boons = {};
    w.pick = null;
    if (id === 'cash') { var lump = doseValue(state) * CASH_DOSES; earn(state, lump); state.labEarned = (state.labEarned || 0) + lump; return { ok: true, id: id, name: BOON_BY[id].name, gain: lump }; }
    state.boons[id] = Math.min(BOON_BY[id].max, boonOf(state, id) + 1); return { ok: true, id: id, name: BOON_BY[id].name };
  }
  /** where(의자 번호 또는 'er')의 사람에게 n 대가 들어간다. 값 · 집계 · 차트 · 되돌림을 한곳에서 치른다. */
  function landDose(state, where, n, auto, rng) {
    var w = wardOf(state), er = where === 'er', p = er ? w.er : w.seats[where], before = p.dose, after = Math.min(WARD_DOSES, before + n), roll = typeof rng === 'function' ? rng : Math.random;
    p.dose = after; p.since = 0;
    var mult = (before === 0 ? 1 : 0) + (after >= WARD_DOSES ? WARD_CURE - 1 : 0), gain = doseValue(state) * mult;
    if (gain > 0) { earn(state, gain); state.labEarned = (state.labEarned || 0) + gain; }
    var out = { ok: true, at: where, dose: after, stop: before === 0 && !er, cure: after >= WARD_DOSES, gain: gain, points: 0, auto: !!auto, er: er };
    state.dosesAll = (state.dosesAll || 0) + (after - before);
    if (!auto) { state.dosesRun = (state.dosesRun || 0) + (after - before); w.hand = 0; if (chartTick(state, 'dose', after - before)) out.chart = true; }
    if (out.stop) { state.stopsRun = (state.stopsRun || 0) + 1; if (chartTick(state, 'stop')) out.chart = true; }
    if (out.cure) {
      state.curesRun = (state.curesRun || 0) + 1; if (chartTick(state, 'cure')) out.chart = true;
      if (er) {
        var pool = BOONS.filter(function (d) { return d.id !== 'cash' && boonOf(state, d.id) < d.max; }), pa, pb;      // 다 찬 것은 내밀지 않는다
        if (pool.length >= 2) { var a = Math.floor(roll() * pool.length) % pool.length, b = (a + 1 + Math.floor(roll() * (pool.length - 1))) % pool.length; pa = pool[a].id; pb = pool[b].id; }
        else if (pool.length === 1) { pa = pool[0].id; pb = 'cash'; } else { pa = 'cash'; pb = null; }
        w.er = null; w.erNext = ER_EVERY; w.pick = pb ? [pa, pb] : null; if (!pb) { var lumpE = doseValue(state) * CASH_DOSES; earn(state, lumpE); state.labEarned = (state.labEarned || 0) + lumpE; out.gain += lumpE; } state.savedRun = (state.savedRun || 0) + 1; out.pick = w.pick; if (chartTick(state, 'er')) out.chart = true;
      } else w.seats[where] = { wait: 0 };      // 서류 찾기는 넣지 않는다(4.0.5 에 잠깐 있었다)
    }
    return out;
  }
  /** 이동 침대의 급한 환자에게 한 대 놓는다(손으로만). */
  function injectEr(state, rng) {
    if (!zoneOpen(state, 4)) return fail('locked');
    if (!(state.staff > 0)) return fail('stopped');
    var w = wardOf(state);
    if (w.stun > 0) return fail('stun');
    if (!w.er) return fail('empty');
    if (!(w.stock >= 1)) return fail('nostock');
    w.stock--;
    var out = landDose(state, 'er', 1, false, rng);
    mixTick(state, w, out);
    return out;
  }
  function mixTick(state, w, out) { if (w.boost) return; w.mix = (w.mix || 0) + 1; if (w.mix >= mixNeed(state)) { w.mix = 0; w.boost = 1; if (out) out.boost = true; } }
  /** 강화 혈청을 where(의자 번호 또는 'er')의 사람에게 놓는다: 한 번에 BOOST_DOSES 대 몫. 냉장 상자의 혈청은 쓰지 않는다. */
  function boostSeat(state, where, rng) {
    if (!zoneOpen(state, 4)) return fail('locked');
    if (!(state.staff > 0)) return fail('stopped');
    var w = wardOf(state);
    if (w.stun > 0) return fail('stun');
    if (!w.boost) return fail('noboost');
    if (where !== 'er') where = Math.floor(safeNum(where, -1));
    var p = where === 'er' ? w.er : w.seats[where];
    if (!p || !(p.dose >= 0)) return fail('empty');
    w.boost = 0;
    var out = landDose(state, where, BOOST_DOSES, false, rng); out.boosted = true;
    if (chartTick(state, 'boost')) out.chart = true;
    return out;
  }
  function stepWard(state, dt, rng, events) {
    if (!zoneOpen(state, 4) || !(state.staff > 0)) return;
    dt = safeNum(dt, 0); if (!(dt > 0)) return;
    var w = wardOf(state), auto = autoEvents(state, 4), aide = auto && (state.upgrades.autolab || 0) > 0, nurse = nurseOn(state), roll = typeof rng === 'function' ? rng : Math.random;
    if (dt > 5) {      // 굵은 걸음(자리 비움 등): 하나하나 세지 않는다. 조교와 간호사가 다 있어야 돌아간다
      if (aide && nurse) { var flat = labRate(state) * dt; earn(state, flat); state.labEarned = (state.labEarned || 0) + flat; }
      w.seats = []; w.make = 0; w.nurse = 0; w.arrive = 0; w.er = null; w.hand = 999; wardOf(state); return;      // 자리를 비운 동안에는 급한 환자도 오지 않는다
    }
    var steps = Math.max(1, Math.ceil(dt / 0.25)), h = dt / steps, turn = turnSeconds(state), cap = serumCap(state);
    if (w.stun > 0) w.stun = Math.max(0, w.stun - dt);
    w.hand = Math.min(999, (w.hand || 0) + dt);
    /* 급한 환자: 손을 쓰고 있을 때(ER_HAND 초 안에 누른 적이 있을 때)만 다음 침대까지의 시간이 간다. 보고 있지 않은 사람에게 벌칙을 주지 않으려는 것 */
    if (w.er) { w.er.t -= dt; if (w.er.t <= 0) {
      var brokeE = Math.min(w.stock, TURN_BREAK); w.stock -= brokeE; w.stun = TURN_STUN; state.turnedRun = (state.turnedRun || 0) + 1;
      if (events) events.push({ type: 'ward-turned', at: 'er', broke: brokeE, look: w.er.look, reset: chartMiss(state) });
      w.er = null; w.erNext = ER_EVERY;
    } } else if (!w.pick && w.hand < ER_HAND) { w.erNext -= dt * TEST.er; if (w.erNext <= 0) { w.er = { t: ER_TIME, dose: 0, look: Math.floor(roll() * 1000) }; w.erNext = ER_EVERY; if (events) events.push({ type: 'ward-er' }); } }
    for (var k = 0; k < steps; k++) {
      if (aide && w.stock < cap) { w.make += h / serumSeconds(state); while (w.make >= 1 && w.stock < cap) { w.make -= 1; w.stock++; } }
      if (w.stock >= cap) w.make = Math.min(w.make, 0.999);
      /* 4.0.6 오고 가는 것을 바꿨다. 전에는 멈춘 사람이 몇 초 뒤에 저절로 자리를 떴다(되돌리던 사람까지도). 시간이 됐다고 사라지는 것이 어색했다.
         이제 사람은 WARD_ARRIVE 초에 한 명씩 문으로 들어온다. 빈 의자가 있으면 앉고, 없으면 '한 대만 맞고 가장 오래 앉아 있던 사람'이 자리를 내 준다.
         두 대 이상 맞은 사람(되돌리는 중)과 아직 못 맞은 사람은 자리를 내 주지 않는다. 내 줄 자리가 없으면 문 앞에서 기다린다 */
      var anyEmpty = false; for (var e0 = 0; e0 < w.seats.length; e0++) if (!(w.seats[e0].dose >= 0)) { anyEmpty = true; break; }
      w.arrive = (w.arrive || 0) + h / (anyEmpty ? WARD_FILL : WARD_ARRIVE);      // 빈 의자가 있으면 기다리던 사람이 금방 들어와 앉는다
      if (w.arrive >= 1) {
        var seat = -1, old = -1;
        for (var q0 = 0; q0 < w.seats.length; q0++) { var sq = w.seats[q0]; if (!(sq.dose >= 0)) { if (seat < 0) seat = q0; } else if (sq.dose === 1 && (old < 0 || sq.since > w.seats[old].since)) old = q0; }
        if (seat < 0 && old >= 0) { seat = old; if (events) events.push({ type: 'ward-out', at: old }); }
        if (seat >= 0) { w.arrive -= 1; /* 4.1.2: 사람마다 변하는 빠르기가 더 다르다(0.8~1.8배, 여섯에 하나는 '급성' 2.6배). 이미 조금 진행된 채로 오기도 한다.
           왜: 전에는 다들 비슷하게 천천히 변해서, 자동 둘만 있으면 변하는 사람을 볼 일이 없었다(빡빡한 차트도 걸 것이 없었다) */
        var acute = roll() < ACUTE_CHANCE; w.seats[seat] = { m: roll() * 0.3, dose: 0, r: acute ? ACUTE_RATE : 0.8 + roll(), look: Math.floor(roll() * 1000), since: 0 }; if (events) events.push({ type: 'ward-in', at: seat }); }
        else w.arrive = 1;
      }
      for (var i = 0; i < w.seats.length; i++) {
        var p = w.seats[i];
        if (!(p.dose >= 0)) continue;
        p.since = (p.since || 0) + h;
        if (p.dose === 0) { p.m += h / turn * p.r * (w.chart && w.chart.hard && !w.chart.done ? HARD_SPEED : 1); if (p.m >= 1) {
          /* 변했다(벌칙): 변한 사람이 달려들어 냉장 상자의 혈청을 TURN_BREAK 대 깨뜨리고, TURN_STUN 초 동안 아무것도 누를 수 없다(화면 가득 달려든다).
             굵은 걸음이 아닐 때만 일어나니, 자리를 비운 동안에는 벌칙이 없다 */
          var broke = Math.min(w.stock, TURN_BREAK); w.stock -= broke; w.stun = TURN_STUN; w.seats[i] = { wait: 0 }; state.turnedRun = (state.turnedRun || 0) + 1;
          if (events) events.push({ type: 'ward-turned', at: i, broke: broke, look: p.look, reset: chartMiss(state) });
        } }
      }
      if (nurse) {
        w.nurse += h / (NURSE_SECONDS * assistFactor(state));
        if (w.nurse >= 1) {
          var pick = -1; w.seats.forEach(function (q, qi) { if (q.dose === 0 && q.m >= NURSE_FROM && (pick < 0 || q.m > w.seats[pick].m)) pick = qi; });      // 줄이 절반 넘게 찬 사람만(그 전에는 혈청을 손에 남겨 둔다)
          if (pick >= 0 && w.stock >= 1) { w.nurse -= 1; var r = injectSeat(state, pick, true); if (events) { r.type = 'ward-nurse'; events.push(r); } }
          else w.nurse = 1;
        }
      }
    }
  }
  /** 지금 과제 하나를 끝내는 데 드는 점수. 어느 과제를 고르든 같다. */
  /*
   * 4.0.4 연구 성과에 드는 것을 바꿨다. 전에는 '연구 점수'가 시간에 따라 쌓이고 값은 번번이 1.8배가 되어서,
   *   스무 번쯤 고르고 나면 다음 것까지 하염없이 기다려야 했다(누를 것도 없이). 이제는 혈청을 한 대 놓을 때마다 1씩 찬다(손이든 간호사든).
   *   값은 조금씩만 는다(8, 10, 12 …). 서른 번째도 66대, 손으로 하면 2~3분이다. 서류(recordMult)는 한 대에 차는 양을 늘린다.
   */
  function projectCost(state) { return Math.ceil((PROJECT_BASE + PROJECT_STEP * state.projectsDone) * mods(state).labcost); }
  function rerollCost(state) { return Math.ceil(projectCost(state) * REROLL_SHARE); }
  /** 과제 OFFER_COUNT 개를 겹치지 않게 뽑는다. */
  /*
   * 2.9.2: 지나온 구역만 키우는 과제는 내밀지 않는다(2.9.5 부터 바로 앞 구역 것도 뺀다: 5구역에서는 1 · 2 · 3 · 4구역 과제가 모두 빠진다).
   *   뒤 구역의 수입이 앞 구역의 수만 배라, 앞 구역 생산을 2배로 해도 달라지는 것이 없었다. 고를 것이 셋 중 하나뿐인 때가 많았다.
   */
  var PROJECT_ZONE = { z1: 0, z2: 1, z3: 2, z4: 3 };
  function drawOffers(rng, state) {
    var at = state && typeof state.zone === 'number' ? state.zone : -1;
    var pool = PROJECTS.filter(function (p) { return !(at >= 0 && PROJECT_ZONE[p.key] !== undefined && at - PROJECT_ZONE[p.key] >= 1) && !(p.max > 0 && state && state.research && state.research[p.id] >= p.max); }).map(function (p) { return p.id; }), out = [];
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
    if (def.max > 0 && state.research[id] >= def.max) return fail('max');      // 다 끝낸 과제(항체 정제 3번)
    var cost = projectCost(state);
    if (cost > state.points) return fail('points');
    state.points -= cost;
    var gain = 0;
    if (def.key === 'drop') { gain = Math.max(1, productionPerSec(state) * SUPPLY_DROP_SECONDS); earn(state, gain); }
    state.research[id]++;
    state.projectsDone++;
    state.offers = drawOffers(rng, state);
    var record = findRecord(state, rng);      // 병원 서류: 과제를 끝낼 때 가끔 한 장을 찾는다
    return { ok: true, id: id, name: def.name, level: state.research[id], cost: cost, gain: gain, record: record };
  }
  /** 점수를 조금 내고 과제 셋을 다시 뽑는다. */
  function rerollOffers(state, rng) {
    if (true) return fail('gone');      // 3.9.0: 갈림길은 다시 뽑지 않는다
    if (!zoneOpen(state, 4)) return fail('locked');
    var cost = rerollCost(state);
    if (cost > state.points) return fail('points');
    state.points -= cost;
    state.offers = drawOffers(rng, state);
    return { ok: true, cost: cost };
  }
  function stepLab(state, dt, rng) {
    if (!zoneOpen(state, 4)) return;
    if (!state.offers.length) state.offers = drawOffers(rng, state);       // 구역에 처음 들어섰을 때
    state.focusLeft = 0; state.focusCool = 0;      // 3.9.0: 밤샘 연구는 없앴다. 연구 점수는 시험관을 거둘 때 들어온다(stepTubes)
  }

  /**
   * 청신호: 달리고 있는 열차들이 GREEN_SECONDS 초만큼 앞서 달린다(그만큼 화물도 싣는다). GREEN_COOLDOWN 초 뒤에 다시 켤 수 있다.
   * 늘 챙겨 켜도 평균 +25% 정도다. 도착 직전의 열차를 당겨 바로 들어오게 하는 손맛이 쓸모다. 달리는 열차가 없으면 켤 수 없다.
   * 돌려주는 값: { ok, arrivals: 이 신호로 도착한 열차의 'train' 사건들 }
   */
  function greenSignal(state) {
    if (!zoneOpen(state, 3)) return fail('locked');
    if (true) return fail('gone');      // 3.4.0: 청신호는 없앴다(열차를 손으로 보내는 것이 4구역의 손맛이 됐다)
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
    if (!dup) { state.kennel[breed.id] = breed.name; state.pet = { kind: kind, breed: breed.id, name: breed.name }; partyOf(state)[kind] = breed.id; }      // 새 아이는 바로 그 종류 칸에 장착한다
    return { ok: true, breed: breed, rarity: rarity, dup: dup, cost: cost, refund: refund };
  }
  /** 함께 있는 친구 가운데 누구를 데리고 다닐지 고른다. */
  function choosePet(state, breedId) {
    var breed = findById(PET_BREEDS, breedId);
    if (!breed || !state.kennel[breedId]) return fail('unknown');
    state.pet = { kind: breed.kind, breed: breed.id, name: state.kennel[breedId] };
    partyOf(state)[breed.kind] = breed.id;      // 4.4.6 고른 아이는 자기 종류 칸에 장착된다(다른 종류 칸은 그대로)
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
  /** 장착 칸 { dog, cat }. 예전 상태(party 가 없음)도 받는다. */
  function partyOf(state) {
    if (!state.party || typeof state.party !== 'object') state.party = { dog: null, cat: null };
    return state.party;
  }
  /** 장착한 아이의 종류 효과 { key, bonus }. breedId 가 장착돼 있지 않거나 없으면 null. */
  function equipEffect(state, breedId) {
    var breed = findById(PET_BREEDS, breedId), kind = breed && PET_KINDS[breed.kind];
    if (!kind || !state.kennel || !state.kennel[breedId]) return null;
    var rarity = findById(PET_RARITIES, breed.rarity) || PET_RARITIES[0];
    return { key: kind.key, bonus: rarity[breed.kind] * petLevelMult(state, breed.id) };
  }
  /** 데리고 다니는 친구의 종류 효과 { key, bonus }. 없으면 null. */
  function petEffect(state) { return state.pet ? equipEffect(state, state.pet.breed) : null; }
  /** 보유 효과: 만난 아이 모두가 종류마다 조금씩 올려 주는 비율 { dog: 방어력, cat: 전체 생산 }. */
  function petOwnBonus(state) {
    var o = { dog: 0, cat: 0 };
    PET_BREEDS.forEach(function (b) { if (state.kennel && state.kennel[b.id]) o[b.kind] += PET_OWN[b.rarity] || 0; });      // 레벨(강화)과 상관없다
    return o;
  }
  /** 친구들이 주는 배수를 m(mods)에 얹는다: 보유 효과, 장착한 두 아이의 종류 효과와 특기. */
  function applyPets(state, m) {
    if (!state.kennel) return;
    var own = petOwnBonus(state);
    m[PET_KINDS.dog.key] *= 1 + own.dog; m[PET_KINDS.cat.key] *= 1 + own.cat;
    var party = partyOf(state);
    ['dog', 'cat'].forEach(function (k) {
      var id = party[k], e = id && equipEffect(state, id), sk = id && PET_SKILLS[id];
      if (!e) return;
      m[e.key] *= 1 + e.bonus;
      if (sk && sk.add) m[sk.key] += sk.add; else if (sk && sk.mult) m[sk.key] *= sk.mult;
    });
  }
  /** 품종의 특기 글. 없으면 빈 글. */
  function petSkillText(breedId) { var sk = PET_SKILLS[breedId]; return sk ? sk.text : ''; }
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
    return { kind: state.pet.kind, kindName: kind.name, breed: breed, rarity: findById(PET_RARITIES, breed.rarity) || PET_RARITIES[0], name: state.pet.name, desc: breedDesc(breed), skill: petSkillText(breed.id) };
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
    return state.staff * milestoneMult(state.staff) * LAB_VALUE * LAB_SCALE * mods(state).lab * globalMult(state) * seatCount(state) / SEAT_BASE * Math.pow(REAGENT_STEP, state.reagent || 0) * recordMult(state) * (1 + BOON_RICH * boonOf(state, 'rich')) * (1 + safeNum(state.chartBonus, 0));      // 4.0.5: 병원 서류는 혈청 값을 올린다
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
      { id: 'z3b2', text: '도장 라인 25레벨', need: 25, value: function (s) { return s.machines.paint || 0; } },
      { id: 'z3c2', text: '납품 의뢰 3번 채우기', need: 3, value: function (s) { return s.contractsRun; } } ],
    [ { id: 'z4a2', text: '화물 등급 3레벨', need: 3, value: function (s) { return s.routes.grade || 0; } },
      { id: 'z4b2', text: '표류 화물 2번 끌어오기', need: 2, value: function (s) { return s.salvagesRun; } },
      { id: 'z4c2', text: '4구역 개조를 모두 합쳐 10번', need: 10, value: function (s) { return zoneUpgrades(s, 3); } } ],
    [ { id: 'z5a2', text: '5구역 개조를 모두 합쳐 10번', need: 10, value: function (s) { return zoneUpgrades(s, 4); } },
      { id: 'z5b2', text: '사람 60명 멈추기', need: 60, value: function (s) { return s.stopsRun || 0; } },
      { id: 'z5c2', text: '의자 6개', need: 6, value: function (s) { return seatCount(s); } } ],
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
    if (id === 'tower' || id === 'guard') return fail('gone');      // 3.1.0: 직접 방송은 주파수 맞추기로 바뀌었다(예전 저장의 남은 효과만 흘러간다)
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
  /*
   * ---------- 6구역 다리 막기 (3.9.7 에 처음, 4.1.2 에 다시) ----------
   * 4.1.2 에 고친 까닭(해 보신 말씀): ① 누르기만 하면 절대 안 뚫린다 ② 좀비가 적다 ③ 1초마다 하나씩 와서 띡-띡-띡뿐이다 ④ 긴박한 때가 없다.
   * 그림: 무리가 다리 건너편(x = 1)에서 초소(x = 0)로 온다. 하나씩이 아니라 '무더기'로 온다(1~4마리, 사이는 들쭉날쭉). 평균은 BRIDGE_SPAWN 초에 한 마리.
   * 종류: 보통(2발) · 뛰는 놈(1발, 빠르다) · 튼튼한 놈(4발, 느리다, 몫 2배) · 큰 놈(BRIDGE_BIG_EVERY 번째마다, 14발, 몫 5배).
   * 방벽: 초소 앞의 방벽이 wallMax 만큼 버틴다. 닿은 놈은 방벽을 깎고(종류마다 hit) 몫의 BRIDGE_LEAK 만 남긴다. 방벽은 WALL_FIX 초에 1씩 고쳐진다.
   *       방벽이 다 깎이면 '뚫렸다': BREACH_SECONDS 초 동안 쏠 수 없고 아무것도 못 받는다. 연속은 처음으로. 그 뒤 방벽을 다시 세운다.
   * 떼:   손을 쓰고 있을 때(BRIDGE_HAND 초 안에 쏜 적이 있을 때) WAVE_EVERY 초마다 떼가 온다. WAVE_WARN 초 미리 알리고, WAVE_SECONDS 초 동안 세 배로 몰려온다.
   *       뚫리지 않고 넘기면 '떼를 막았다': 통행 물자 WAVE_PAY 초 치 × 연속 배수.
   * 손:   그림에서 누른 자리에서 가장 가까운 것을 쏜다. 한 발의 피해는 1 + 화력. 잡으면 몫 × 연속 배수.
   *       손으로 잡을 때마다 수류탄이 찬다(nadeNeed 마리). 던지면 다리 위의 모두가 NADE_DMG 만큼 깎인다. 언제 던질지 고른다.
   * 자동: 초소장은 bridgeShotSeconds 초마다 맨 앞의 것을 쏜다(한 발에 AUTO_DMG). 연속은 쌓지 못한다(1배). 혼자서는 다 못 막아 가끔 뚫린다.
   * 가만히: 아무도 쏘지 않으면 자꾸 뚫린다. 가만히 둠 < 초소장 < 손.
   * 긴 dt(자리 비움 · 굵은 걸음)에서는 하나하나 세지 않고 초소장이 있으면 AWAY_AUTO 배, 없으면 BRIDGE_LEAK 배로 친다(뚫리는 벌칙도 없다).
   */
  var BRIDGE_SPAWN = 0.55, BRIDGE_BIG_EVERY = 16, BRIDGE_LEAK = 0.2, BRIDGE_HP = 2, BRIDGE_BIG_HP = 14, BRIDGE_WALK = 11, BRIDGE_WALK_BIG = 18, BRIDGE_BIG_CARRY = 5;
  var BRIDGE_KINDS = {
    norm:  { hp: 2,  walk: 9,  carry: 1, hit: 1 },
    run:   { hp: 1,  walk: 5,  carry: 1, hit: 1 },
    tough: { hp: 4,  walk: 14, carry: 2, hit: 2 },
    big:   { hp: 14, walk: 18, carry: 5, hit: 5 },
    /* 4.1.7 단계가 오르면 섞여 오는 것들(from: 나오기 시작하는 단계). 왜: 단계가 올라도 보이는 것이 같았다 */
    dog:    { hp: 1, walk: 3.5, carry: 1, hit: 1, from: 3 },      // 좀비 개: 아주 빠르다
    bomb:   { hp: 3, walk: 10,  carry: 2, hit: 4, from: 6 },      // 부푼 놈: 쓰러지면 터져 곁의 것들을 깎는다(잘 쓰면 한 발에 여럿). 방벽에 닿으면 크게 깎는다
    shield: { hp: 8, walk: 12,  carry: 3, hit: 3, from: 9 }       // 방패 든 놈: 아주 질기다
  };
  var BOMB_R = 0.09, BOMB_DMG = 3;
  var WALL_BASE = 14, WALL_FIX = 2, BREACH_SECONDS = 4, BRIDGE_HAND = 30, AUTO_DMG = 2, AWAY_AUTO = 0.6;
  var WAVE_FIRST = 25, WAVE_EVERY = 45, WAVE_WARN = 3, WAVE_SECONDS = 7, WAVE_RATE = 3, WAVE_PAY = 12;
  /* 4.1.3 다리 단계(b.streak): 떼를 막을 때마다 1 오르고, 뚫리면 LV_DROP 내려간다. 단계가 오를수록 더 많이(LV_RATE), 더 질긴 것이(LV_HP) 오고, 받는 것도 는다(LV_PAY).
     왜: 화력을 올리거나 빨리 누르면 아무리 해도 안 뚫렸다. 이제는 잘 막을수록 다리가 세져서, 누구든 자기 손이 감당하는 단계의 끝에서 논다(언젠가는 뚫린다).
     손을 놓고 있으면(BRIDGE_HAND 초) LV_DECAY 초에 1씩 내려가, 자동에 맡긴 다리는 쉬운 채로 있다 */
  var WAVE_STREAK_MAX = 40, LV_RATE = 0.12, LV_HP = 0.18, LV_PAY = 0.1, LV_DROP = 3, LV_DECAY = 20, WAVE_GROW_PAY = 0.1;
  /* 4.1.3 총열: 누르고만 있으면 절대 안 뚫린다는 말씀에. 쏠 때마다 총열이 달아오르고(HEAT_SHOT), 쉬면 식는다(초당 HEAT_COOL).
     다 달아오르면 '과열': JAM_SECONDS 초 동안 쏠 수 없다. 그래서 마구 누르는 것보다 끊어 쏘는 것이 낫고, 급할 때는 수류탄이 있다(수류탄은 과열과 상관없다) */
  var HEAT_SHOT = 0.08, HEAT_COOL = 0.2, JAM_SECONDS = 2.5;
  var NADE_KILLS = 20, NADE_MIN = 8, NADE_DMG = 6;
  var BRIDGE_COMBO_STEP = 0.1, BRIDGE_COMBO_HOLD = 4, BRIDGE_COMBO_BASE = 2, BRIDGE_SHOT_SECONDS = 0.7, BRIDGE_SHOT_MIN = 0.55, BRIDGE_WAVE = 20, FIRE_MAX = 3, MORALE_MAX = 4, MORALE_STEP = 0.5;
  var FIRE_COST = 2e26, FIRE_GROWTH = 60, MORALE_COST = 4e26, MORALE_GROWTH = 25;
  function newBridge() { return { zs: [], spawn: 1, n: 0, shot: 0, combo: 1, hold: 0, wall: WALL_BASE, fix: 0, down: 0, hand: 999, waveIn: WAVE_FIRST, wave: 0, warn: 0, hurt: 0, nade: 0, streak: 0, heat: 0, jam: 0 }; }
  function bridgeOf(state) {
    var b = state.bridge; if (!b || typeof b !== 'object' || !Array.isArray(b.zs)) b = state.bridge = newBridge();
    if (!(b.wall >= 0)) b.wall = wallMax(state); if (!(b.waveIn > 0) && !(b.wave > 0) && !(b.warn > 0)) b.waveIn = WAVE_EVERY; if (!(b.hand >= 0)) b.hand = 999; if (!(b.nade >= 0)) b.nade = 0;
    return b;
  }
  function wallMax(state) { return WALL_BASE + Math.round(mods(state).wall); }
  function nadeNeed(state) { return Math.max(NADE_MIN, NADE_KILLS - 4 * Math.round(mods(state).nade)); }
  function comboCap(state) { return BRIDGE_COMBO_BASE + MORALE_STEP * clamp(safeCount(state.morale), 0, MORALE_MAX); }
  function tapDamage(state) { return 1 + clamp(safeCount(state.firepower), 0, FIRE_MAX); }
  function bridgeShotSeconds(state) { return Math.max(BRIDGE_SHOT_MIN, BRIDGE_SHOT_SECONDS * assistFactor(state)); }      // 특성으로 빨라져도 바닥이 있다(초소장 혼자 다 잡아 버리면 손이 할 일이 없다)
  function fireCost(state) { return zoneOpen(state, 5) && (state.firepower || 0) < FIRE_MAX ? Math.ceil(FIRE_COST * Math.pow(FIRE_GROWTH, state.firepower || 0) * mods(state).cost) : Infinity; }
  function buyFire(state) { if (!zoneOpen(state, 5)) return fail('locked'); return pay(state, fireCost(state), function () { state.firepower = (state.firepower || 0) + 1; }); }
  function moraleCost(state) { return zoneOpen(state, 5) && (state.morale || 0) < MORALE_MAX ? Math.ceil(MORALE_COST * Math.pow(MORALE_GROWTH, state.morale || 0) * mods(state).cost) : Infinity; }
  function buyMorale(state) { if (!zoneOpen(state, 5)) return fail('locked'); return pay(state, moraleCost(state), function () { state.morale = (state.morale || 0) + 1; }); }
  function bridgeWave(state) { return 1 + Math.floor((state.bridgeKills || 0) / BRIDGE_WAVE); }
  function bridgeLvPay(state) { var b = state.bridge, lv = b && b.streak > 0 ? b.streak : 0; return (1 + LV_PAY * lv) / (1 + LV_RATE * lv); }      // 한 마리의 몫: 단계가 오르면 더 많이 오므로 그만큼 나누고, 단계 몫(LV_PAY)만 얹는다(벌이가 한없이 불지 않게)
  function kindOf(z) { return BRIDGE_KINDS[z.k] || (z.big ? BRIDGE_KINDS.big : BRIDGE_KINDS.norm); }
  /** 좀비 하나의 몫을 준다. mult: 손 = 연속 배수, 초소장 = 1, 닿았다 = BRIDGE_LEAK. */
  function bridgePay(state, z, mult) { var gain = guardRate(state) * BRIDGE_SPAWN * kindOf(z).carry * mult * (z.w ? 0.5 : 1) * bridgeLvPay(state); if (gain > 0) { earn(state, gain); state.guardEarned += gain; } return gain; }
  function killOne(state, b, z, byHand) {
    var gain = bridgePay(state, z, byHand ? b.combo : 1);
    state.bridgeKills = (state.bridgeKills || 0) + 1;
    if (byHand) {
      state.handKills = (state.handKills || 0) + 1; if (z.big) state.bigKills = (state.bigKills || 0) + 1;
      b.combo = Math.min(comboCap(state), b.combo + BRIDGE_COMBO_STEP * (z.big ? 3 : 1)); b.hold = BRIDGE_COMBO_HOLD; if (b.combo > (state.comboBest || 1)) state.comboBest = b.combo;
      b.nade = Math.min(nadeNeed(state), (b.nade || 0) + 1);
    }
    return gain;
  }
  /** idx 번째를 잡는다. 부푼 놈이면 터져서 곁의 것들을 깎고, 그래서 쓰러진 것도 함께 잡는다(잇달아 터지기도 한다). out 을 주면 터진 자리(booms)와 함께 쓰러진 것(also)을 적는다. */
  function bridgeKill(state, idx, byHand, out) {
    var b = bridgeOf(state), z = b.zs[idx]; b.zs.splice(idx, 1);
    var gain = killOne(state, b, z, byHand), booms = z.k === 'bomb' ? [z.x] : [];
    while (booms.length) {
      var bx = booms.pop(); if (out) (out.booms = out.booms || []).push(bx);
      for (var i = b.zs.length - 1; i >= 0; i--) { var n = b.zs[i]; if (Math.abs(n.x - bx) >= BOMB_R) continue; n.hp -= BOMB_DMG;
        if (n.hp <= 0) { b.zs.splice(i, 1); gain += killOne(state, b, n, byHand); if (out) (out.also = out.also || []).push({ x: n.x, big: !!n.big }); if (n.k === 'bomb') booms.push(n.x); } }
    }
    return gain;
  }
  /** 손으로 쏜다. x(0~1)를 주면 그 자리에서 가장 가까운 좀비, 안 주면 맨 앞의 것. */
  function shootBridge(state, x) {
    if (!zoneOpen(state, 5)) return fail('locked');
    if (!(state.posts > 0)) return fail('stopped');
    var b = bridgeOf(state);
    if (b.down > 0) return fail('down');
    if (b.jam > 0) return fail('jam');
    b.hand = 0;
    if (!b.zs.length) return fail('empty');
    var idx = 0, best = Infinity, aim = typeof x === 'number' && isFinite(x);
    b.zs.forEach(function (z, i) { var d = aim ? Math.abs(z.x - x) : z.x; if (d < best) { best = d; idx = i; } });
    var z = b.zs[idx], dmg = tapDamage(state), out = { ok: true, x: z.x, big: !!z.big, k: z.k || 'norm', dmg: dmg, kill: false, gain: 0, combo: b.combo, left: 0 };
    z.hp -= dmg; state.shotsRun = (state.shotsRun || 0) + 1;
    if (z.hp <= 0) { out.kill = true; out.gain = bridgeKill(state, idx, true, out); out.combo = b.combo; } else out.left = z.hp;
    b.heat = (b.heat || 0) + HEAT_SHOT; if (b.heat >= 1) { b.heat = 1; b.jam = JAM_SECONDS; out.jam = true; state.jamsRun = (state.jamsRun || 0) + 1; }
    out.heat = b.heat;
    return out;
  }
  /** 수류탄을 던진다: 다리 위의 모두가 NADE_DMG 만큼 깎인다. 쓰러진 것은 손이 잡은 것으로 친다. */
  function throwNade(state) {
    if (!zoneOpen(state, 5)) return fail('locked');
    if (!(state.posts > 0)) return fail('stopped');
    var b = bridgeOf(state);
    if (b.down > 0) return fail('down');
    if (!((b.nade || 0) >= nadeNeed(state))) return fail('notready');
    if (!b.zs.length) return fail('empty');
    b.nade = 0; b.hand = 0;
    var gain = 0, kills = 0, hits = [];
    var n0 = b.zs.length; b.zs.forEach(function (z) { z.hp -= NADE_DMG; hits.push({ x: z.x, big: !!z.big, kill: z.hp <= 0 }); });
    for (var guard = 0; guard < 200; guard++) { var di = -1; for (var i = 0; i < b.zs.length; i++) if (b.zs[i].hp <= 0) { di = i; break; } if (di < 0) break; gain += bridgeKill(state, di, true); }      // 부푼 놈이 터지며 곁의 것까지 쓰러뜨릴 수 있어, 쓰러진 것이 없을 때까지 하나씩 치운다
    kills = n0 - b.zs.length;
    b.nade = 0;      // 수류탄으로 잡은 것으로 다음 수류탄이 차지는 않는다
    return { ok: true, gain: gain, kills: kills, hits: hits, combo: b.combo };
  }
  function spawnOne(b, roll, x, wave, lv) {
    b.n = (b.n || 0) + 1;
    var r = roll(), k = b.n % BRIDGE_BIG_EVERY === 0 ? 'big' : r < 0.18 ? 'run' : r < 0.33 ? 'tough' : 'norm', L = lv || 0;
    if (k === 'norm') { var r2 = roll(); if (L >= BRIDGE_KINDS.shield.from && r2 < 0.1) k = 'shield'; else if (L >= BRIDGE_KINDS.bomb.from && r2 < 0.22) k = 'bomb'; else if (L >= BRIDGE_KINDS.dog.from && r2 < 0.38) k = 'dog'; }
    var d = BRIDGE_KINDS[k];
    var hp = Math.ceil(d.hp * (1 + LV_HP * (lv || 0)) - 1e-9); b.zs.push({ x: x, hp: hp, max: hp, big: k === 'big' ? 1 : 0, k: k, id: b.n % 1000 }); if (wave) b.zs[b.zs.length - 1].w = 1;      // 떼로 온 것은 몫이 절반(떼를 막은 값은 따로 받는다)
  }
  function stepBridge(state, dt, rng, events) {
    if (!zoneOpen(state, 5) || !(state.posts > 0)) return;
    dt = safeNum(dt, 0); if (!(dt > 0)) return;
    var b = bridgeOf(state), auto = autoEvents(state, 5) && (state.upgrades.autoguard || 0) > 0, roll = typeof rng === 'function' ? rng : Math.random;
    if (dt > 5) {      // 굵은 걸음: 하나하나 세지 않는다. 뚫리는 벌칙도 없다
      var flat = guardRate(state) * dt * (auto ? AWAY_AUTO : BRIDGE_LEAK); earn(state, flat); state.guardEarned += flat;
      b.zs = []; b.spawn = 1; b.shot = 0; b.combo = 1; b.hold = 0; b.wall = wallMax(state); b.down = 0; b.wave = 0; b.warn = 0; b.hurt = 0; b.hand = 999; b.streak = 0; b.heat = 0; b.jam = 0; return;
    }
    var steps = Math.max(1, Math.ceil(dt / 0.25)), h = dt / steps, shotEvery = bridgeShotSeconds(state), wmax = wallMax(state);
    b.hand = Math.min(999, (b.hand || 0) + dt);
    if (b.jam > 0) { b.jam -= dt; b.heat = Math.max(0, b.jam / JAM_SECONDS); if (b.jam <= 0) { b.jam = 0; b.heat = 0; } } else if (b.heat > 0) b.heat = Math.max(0, b.heat - dt * HEAT_COOL * mods(state).cool);
    for (var k = 0; k < steps; k++) {
      if (b.down > 0) {      // 뚫려 있다: 다시 세우는 동안 아무 일도 없다
        b.down -= h; if (b.down <= 0) { b.down = 0; b.wall = wmax; b.spawn = 1; if (events) events.push({ type: 'bridge-back' }); }
        continue;
      }
      // 떼: 손을 쓰고 있을 때만 다음 떼까지의 시간이 간다
      if (b.wave > 0) { b.wave -= h; if (b.wave <= 0) { b.wave = 0; b.waveIn = WAVE_EVERY; if (!(b.wall <= 0)) { var held = guardRate(state) * WAVE_PAY * mods(state).held * b.combo * (1 + WAVE_GROW_PAY * (b.streak || 0)); earn(state, held); state.guardEarned += held; state.wavesHeld = (state.wavesHeld || 0) + 1; b.streak = Math.min(WAVE_STREAK_MAX, (b.streak || 0) + 1); if (b.streak > (state.streakBest || 0)) state.streakBest = b.streak; if (events) events.push({ type: 'bridge-held', gain: held, streak: b.streak }); } } }
      else if (b.warn > 0) { b.warn -= h; if (b.warn <= 0) { b.warn = 0; b.wave = WAVE_SECONDS; b.hurt = 0; if (events) events.push({ type: 'bridge-wave' }); } }
      else if (b.hand >= BRIDGE_HAND) { if (b.streak > 0) { b.cool = (b.cool || 0) + h / LV_DECAY; if (b.cool >= 1) { b.cool = 0; b.streak--; } } }
      else if (TEST.wave !== 0) { b.waveIn -= h * TEST.wave; if (b.waveIn <= 0) { b.warn = WAVE_WARN; if (events) events.push({ type: 'bridge-warn' }); } }
      // 무더기로 온다: 1~4마리, 다음 무더기까지는 마릿수 × BRIDGE_SPAWN × (0.6~1.4)초
      b.spawn -= h * (b.wave > 0 ? WAVE_RATE : 1) * (1 + LV_RATE * (b.streak || 0));      // 떼를 잇달아 막을수록 다음 떼가 더 빽빽하다(언젠가는 뚫린다). 받는 것도 그만큼 는다
      if (b.spawn <= 0 && b.zs.length < 60) {
        var pr = roll(), pack = pr < 0.4 ? 1 : pr < 0.7 ? 2 : pr < 0.9 ? 3 : 4;
        for (var q = 0; q < pack; q++) spawnOne(b, roll, 1 + q * 0.035, b.wave > 0, b.streak || 0);
        b.spawn += pack * BRIDGE_SPAWN * (0.6 + roll() * 0.8);
      }
      for (var i = b.zs.length - 1; i >= 0; i--) {
        var z = b.zs[i], kd = kindOf(z); z.x -= h / kd.walk;
        if (z.x <= 0) {      // 방벽에 닿았다: 방벽을 깎고, 몫은 조금만 남긴다. 큰 놈이면 연속이 처음으로
          b.zs.splice(i, 1); bridgePay(state, z, BRIDGE_LEAK); b.wall -= kd.hit; b.hurt = 1;
          if (z.big) { b.combo = 1; b.hold = 0; }
          if (events) events.push({ type: 'bridge-leak', big: !!z.big, wall: Math.max(0, b.wall) });
        }
      }
      if (b.wall <= 0) {      // 뚫렸다
        b.wall = 0; b.down = BREACH_SECONDS; b.zs = []; b.combo = 1; b.hold = 0; b.wave = 0; b.warn = 0; b.waveIn = WAVE_EVERY; b.streak = Math.max(0, (b.streak || 0) - LV_DROP); state.breaches = (state.breaches || 0) + 1;
        if (events) events.push({ type: 'bridge-breach' });
        continue;
      }
      if (b.wall < wmax) { b.fix = (b.fix || 0) + h / (WALL_FIX / mods(state).wallfix); while (b.fix >= 1 && b.wall < wmax) { b.fix -= 1; b.wall++; } } else b.fix = 0;
      if (auto) {
        b.shot += h / shotEvery;
        if (b.shot >= 1) {
          if (b.zs.length) { b.shot -= 1; var fi = 0; b.zs.forEach(function (zz, ii) { if (zz.x < b.zs[fi].x) fi = ii; }); var t = b.zs[fi]; t.hp -= AUTO_DMG; var ev = { type: 'bridge-shot', x: t.x, big: !!t.big, kill: t.hp <= 0 }; if (t.hp <= 0) ev.gain = bridgeKill(state, fi, false, ev); if (events) events.push(ev); }
          else b.shot = 1;
        }
      }
      if (b.hold > 0) b.hold -= h; else if (b.combo > 1) b.combo = Math.max(1, b.combo - 0.5 * h);
    }
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
    return fail('gone');      // 3.9.0: 밤샘 연구는 없앴다
  }
  /** 지금 이 순간의 연구 속도(밤샘 연구 포함). 화면 표시용. */
  function researchNow(state) { return researchRate(state); }

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
      addTickets(state, 3); grantFlags(state);
      var rec = recordEnding(state);
      events.push({ type: 'ending', count: state.ended, day: state.day, retreats: state.retreats, seconds: state.playSeconds, danger: rec.danger, runSeconds: rec.runSeconds, saved: rec.saved, rescued: rec.rescued, tierUp: rec.tierUp, fastest: rec.fastest, fastestHere: rec.fastestHere, higher: rec.higher, dangerTickets: rec.dangerTickets });
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
    var cost = Math.ceil(ZONES[i].cost * mods(state).cost * dangerCost(dangerOf(state))), have = Math.max(0, state.runEarned || 0);
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
  function nightStrength(state) { return Math.ceil(strengthAt(state, currentWave(state)) * siegeFactor(state) * (easeOn(state) ? state.nightEase : 1) * (challengeOn(state, 'horde') ? HORDE_MULT : 1) * (challengeOn(state, 'unbroken') ? UNBROKEN_MULT : 1) * (challengeOn(state, 'onewall') ? ONEWALL_MULT : 1) * dangerHorde(dangerOf(state))); }
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
    var tmp = { supplies: Infinity, defenses: {}, upgrades: state.upgrades, perks: state.perks, traits: state.traits, research: state.research, pet: state.pet, party: state.party, kennel: state.kennel, petLv: state.petLv, zone: state.zone, posts: state.posts };   // defensePower 가 읽는 것만 담는다(연구 과제 '방어 교범' 포함)
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
    if (challengeOn(state, 'horde') && state.breaches > HORDE_BREACHES) state.challenge.failed = true;      // 도전 '거센 무리': 방어 실패는 세 번까지
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
    // max 가 있는 특전은 다 올리면 후보에서 빠진다
    var pool = PERKS.filter(function (p) { return !p.retired && !(p.zone > reach) && !(p.max > 0 && state && state.perks && state.perks[p.id] >= p.max); }).map(function (p) { return p.id; }), out = [];
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
    var def = findById(PERKS, id);
    if (def && def.max > 0 && state.perks[id] >= def.max) return fail('max');      // 후보에 남아 있던 옛 저장이라도 한도를 넘기지 않는다
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
  var ANTI_STEP = 4, ANTI_CURVE = 1.3, ANTI_KNEE = 11, ANTI_LATE = 4;
  function antibodiesFor(run, mult) {
    if (!(run >= RETREAT_MIN)) return 0;
    var d = Math.log(run / RETREAT_MIN) / Math.LN10;
    // 2.9.6: 자릿수 ANTI_KNEE(4구역 무렵) 뒤로는 자릿수 하나에 ANTI_LATE 개씩만 는다. 전에는 뒤 구역으로 갈수록 가파르게 불어서,
    //        6구역까지 간 한 회차(+412)가 그 앞의 여섯 회차를 합친 것(420)만큼 줬다. 4구역까지의 양은 그대로다.
    var raw = d <= ANTI_KNEE ? ANTI_STEP * Math.pow(d, ANTI_CURVE) : ANTI_STEP * Math.pow(ANTI_KNEE, ANTI_CURVE) + ANTI_LATE * (d - ANTI_KNEE);
    return Math.floor((RETREAT_K + raw) * mult);
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
   * 2.5.0 난이도를 올렸다. 중간쯤 키운 사람이 여덟 개를 모두 첫 시도에 깼다(0.5~2.6시간). 도전인데 어렵지 않았다.
   *   맨몸 3구역→5구역 · 손수 4구역→7구역 · 질주 45분→25분 · 외벽 5구역→7구역에 무리 5배
   *   무결 5구역→7구역에 무리 10배 · 거센 무리 3배→100배, 7구역까지, 방어 실패 3번까지
   *   반쪽 보급 절반→4분의 1 · 단숨에 2시간 30분 제한
   *   고친 뒤(봇, 한 번씩): 중간쯤 키운 사람은 질주·무결·거센 무리·단숨에 실패, 맨몸 14시간, 반쪽 보급 17시간, 손수·외벽 2시간대 성공.
   *                        다 키운 사람은 여덟 개 모두 성공(질주는 25분 가운데 24분, 단숨에는 150분 가운데 132분).
   * 조건은 규칙 함수 안에서 challengeOn 으로 확인한다: 개조 구매(frugal, hands), 방벽 구매(onewall), 밤(unbroken, horde), 생산(lean), 시간(sprint).
   */
  var HANDS_AWAY = 0.5;      // 도전 '손수' 중 자리 비움 효율에 곱하는 값
  var MEDAL_BONUS = 0.02, CHALLENGE_TREATS = 10, CHALLENGE_TREATS_AGAIN = 3, SPRINT_SECONDS = 25 * 60, HORDE_MULT = 100, LEAN_MULT = 0.25, UNBROKEN_MULT = 10, ONEWALL_MULT = 5, HORDE_BREACHES = 3, ONESHOT_SECONDS = 150 * 60;
  /*
   * 2.9.4: 목표 구역을 구역마다 나눴다(3 · 4 · 5 · 6 · 6 · 7 · 7 · 끝). 전에는 여섯이 7구역에 몰려 있어서, 7구역에 닿기 전에는 도전이 둘뿐이었다.
   *        목록도 목표 구역이 가까운 것부터 늘어놓는다(열리는 순서와 같다).
   */
  var CHALLENGES = [
    { id: 'onewall',  name: '외벽',      rule: '무리 5배 · 방벽은 한 종류만',  goal: 2, perk: { key: 'defense', mult: 1.1, text: '방어력 +10%' } },
    { id: 'sprint',   name: '질주',      rule: '25분 안에 닿아야 해요',          goal: 3, perk: { key: 'scout', mult: 0.85, text: '길 정찰 시간 -15%' } },
    { id: 'frugal',   name: '맨몸',      rule: '개조를 살 수 없어요',            goal: 4, perk: { key: 'cost', mult: 0.95, text: '모든 구매 비용 -5%' } },
    { id: 'lean',     name: '반쪽 보급', rule: '전체 생산이 4분의 1이에요',     goal: 5, perk: { key: 'prod', mult: 1.1, text: '전체 생산 +10%' } },
    { id: 'unbroken', name: '무결',      rule: '무리 10배 · 방어 실패가 없어야 해요',         goal: 5, perk: { key: 'loot', mult: 1.2, text: '방어 성공 시 전리품 +20%' } },
    { id: 'hands',    name: '손수',      rule: '자동 개조 금지 · 자리 비움 효율 절반',      goal: 6, perk: { key: 'autoshare', add: 0.1, text: '현재 구역 자동 효율 +10%p' } },
    { id: 'horde',    name: '거센 무리', rule: '무리 100배 · 방어 실패는 3번까지',              goal: 6, perk: { key: 'defcost', mult: 0.9, text: '방벽 비용 -10%' } },
    { id: 'oneshot',  name: '단숨에',    rule: '철수 없이 2시간 30분 안에 끝까지',          goal: 'end', perk: { key: 'antibody', mult: 1.1, text: '철수 항체 샘플 +10%' } }
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
   * ---------- 위험 단계 · 구조한 생존자 · 기록(2.1.0) ----------
   * 이야기의 끝을 본 뒤에 할 일. 셋 다 "끝을 다시 볼 이유"다.
   *   위험 단계 : 다음 회차를 더 어렵게 건다. 단계 N 에서 무리는 DANGER_HORDE^N 배, 문 값과 혈청 값은 DANGER_COST^N 배.
   *               대신 철수 항체가 단계마다 +DANGER_ANTIBODY, 끝을 보면 뽑기권을 단계마다 DANGER_TICKETS 장 더 받는다.
   *               끝을 본 가장 높은 단계마다 전체 생산이 DANGER_PROD 배(영구): 값은 단계마다 DANGER_COST 배씩 오르고 힘은 그보다 조금씩 덜 올라서,
   *               단계가 오를수록 천천히 어려워진다(재 보니 값만 올리면 어느 단계에서 갑자기 며칠짜리 벽이 됐다).
   *               고를 수 있는 가장 높은 단계는 "끝을 본 가장 높은 단계 + 1"이다(dangerMax). 끝을 한 번도 못 봤으면 0뿐이다.
   *               다음 회차의 단계(dangerNext)를 정해 두면 철수할 때 그 단계로 시작한다.
   *               2.3.2 다시 맞춤(다 키운 사람, 하루 1시간, 한 회차로 끝까지 재 봄):
   *                 전: 5단계 2일, 8단계 9일, 12단계 34일, 16단계부터는 40일 안에 못 끝냄(스무 단계 가운데 여덟이 사실상 닫혀 있었다).
   *                 후: 10단계까지 2일, 12단계 3일, 16단계 4일, 18단계 12일, 20단계 14~17일.
   *                 바꾼 것 셋: ① 영구 생산 DANGER_PROD 1.25 → 1.35
   *                            ② 문 값은 10단계(DANGER_COST_KNEE)까지 2.2배씩, 그 뒤로는 1.93배씩(DANGER_COST_LATE)
   *                            ③ 혈청 값은 문 값과 따로 1.6배씩(DANGER_SERUM). 7구역은 생산이 더 늘지 않는 곳이라
   *                               혈청 값이 문 값만큼 오르면 그대로 기다리는 시간이 됐다(막힌 곳은 늘 7구역이었다).
   *   구조      : 끝을 볼 때 그 회차에 모은 생존자가 누적(rescued)에 더해진다(위험 단계마다 +100%).
   *               누적이 RESCUE_TIERS 의 문턱을 넘을 때마다 전체 생산이 RESCUE_BONUS 씩 영구히 는다.
   *   기록      : 가장 빨리 끝낸 시간(전체, 단계별), 끝을 본 가장 높은 단계, 최근 끝 10번(endLog).
   */
  var DANGER_MAX = 20, DANGER_HORDE = 1.2, DANGER_COST = 2.2, DANGER_ANTIBODY = 0.3, DANGER_TICKETS = 2;
  var DANGER_PROD = 1.35;      // 끝을 본 가장 높은 위험 단계마다 전체 생산이 이만큼 곱해진다(영구). 이것이 다음 단계를 넘을 힘이 된다
  var RESCUE_TIERS = [1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13], RESCUE_BONUS = 0.02;
  function dangerOf(state) { return clamp(Math.floor(state.danger || 0), 0, DANGER_MAX); }
  function dangerMax(state) { return (state.ended || 0) >= 1 ? Math.min(DANGER_MAX, (state.bestDanger || 0) + 1) : 0; }
  function dangerHorde(n) { return Math.pow(DANGER_HORDE, n); }
  var DANGER_COST_LATE = 1.93, DANGER_COST_KNEE = 10;
  function dangerCost(n) { return Math.pow(DANGER_COST, Math.min(n, DANGER_COST_KNEE)) * Math.pow(DANGER_COST_LATE, Math.max(0, n - DANGER_COST_KNEE)); }
  var DANGER_SERUM = 1.6;
  function dangerSerum(n) { return Math.pow(DANGER_SERUM, n); }
  function dangerPower(state) { return Math.pow(DANGER_PROD, clamp(Math.floor(state.bestDanger || 0), 0, DANGER_MAX)); }
  function setDangerNext(state, n) {
    n = Math.floor(n);
    if (!(n >= 0)) return fail('unknown');
    if (n > dangerMax(state)) return fail('locked');
    state.dangerNext = n;
    return { ok: true, danger: n };
  }
  function rescueTier(state) { var t = 0; RESCUE_TIERS.forEach(function (need) { if ((state.rescued || 0) >= need) t++; }); return t; }
  function rescueMult(state) { return 1 + RESCUE_BONUS * rescueTier(state); }
  function rescueNext(state) { var t = rescueTier(state); return t < RESCUE_TIERS.length ? RESCUE_TIERS[t] : 0; }
  /** 끝을 본 순간에 부른다: 구조 누적, 기록, 위험 단계의 보상. 돌려주는 값은 사건(ending)에 붙는다. */
  function recordEnding(state) {
    var n = dangerOf(state), secs = Math.max(1, Math.ceil(state.runSeconds || 0)), saved = Math.floor((state.survivors || 0) * (1 + n));
    var b = state.bests || (state.bests = { time: 0, byDanger: {} });
    var fastest = !(b.time > 0) || secs < b.time, fastestHere = !(b.byDanger[n] > 0) || secs < b.byDanger[n], higher = n > (state.bestDanger || 0);
    if (fastest) b.time = secs;
    if (fastestHere) b.byDanger[n] = secs;
    if (higher) state.bestDanger = n;
    var tierWas = rescueTier(state);
    state.rescued = Math.min(1e18, (state.rescued || 0) + saved);
    state.endLog = (state.endLog || []).concat([{ danger: n, seconds: secs, retreats: state.retreats, saved: saved }]).slice(-10);
    var tickets = addTickets(state, n * DANGER_TICKETS);
    return { danger: n, runSeconds: secs, saved: saved, rescued: state.rescued, tierUp: rescueTier(state) > tierWas, fastest: fastest && b.byDanger && (state.ended || 0) > 1, fastestHere: fastestHere, higher: higher, dangerTickets: tickets };
  }

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
    // 4.5.2 더한 우비. 투톤(후드와 몸의 색이 다르다)은 희귀 · 전설로 둔다
    { id: 'coat-mint',   slot: 'coat', name: '민트 우비',   rarity: 0, look: { y: '#7fd8c0', j: '#7fd8c0' } },
    { id: 'coat-pink',   slot: 'coat', name: '분홍 우비',   rarity: 0, look: { y: '#ff9fc0', j: '#ff9fc0' } },
    { id: 'coat-sky',    slot: 'coat', name: '하늘 우비',   rarity: 0, look: { y: '#8fc8f0', j: '#8fc8f0' } },
    { id: 'coat-cocoa',  slot: 'coat', name: '코코아 우비', rarity: 0, look: { y: '#8a5a3a', j: '#8a5a3a' } },
    { id: 'coat-duo',    slot: 'coat', name: '노랑 파랑 우비', rarity: 1, look: { y: '#f0b400', j: '#3f7fb5' } },
    { id: 'coat-berry',  slot: 'coat', name: '딸기 우비',   rarity: 1, look: { y: '#4f9a4a', j: '#d8384a' } },
    { id: 'coat-sunset', slot: 'coat', name: '노을 우비',   rarity: 2, look: { y: '#ff8f50', j: '#8a5fc0' } },
    // 2.0.0: 후드 모양·우비 무늬·가방·전설 효과. look 은 그림 쪽(scene.js)이 아는 이름이다
    { id: 'hood-none',   slot: 'hood', name: '기본 후드',   rarity: 0, base: true, look: 'none' },
    { id: 'hood-cat',    slot: 'hood', name: '고양이 귀',   rarity: 1, look: 'cat' },
    { id: 'hood-bear',   slot: 'hood', name: '곰 귀',       rarity: 1, look: 'bear' },
    { id: 'hood-rabbit', slot: 'hood', name: '토끼 귀',     rarity: 1, look: 'rabbit' },
    { id: 'hood-horn',   slot: 'hood', name: '뿔 후드',     rarity: 2, look: 'horn' },
    { id: 'hood-sprout', slot: 'hood', name: '새싹',        rarity: 0, look: 'sprout' },      // 4.5.2 더한 후드
    { id: 'hood-pompom', slot: 'hood', name: '털방울',      rarity: 1, look: 'pompom' },
    { id: 'hood-fox',    slot: 'hood', name: '여우 귀',     rarity: 1, look: 'fox' },
    { id: 'hood-panda',  slot: 'hood', name: '판다 귀',     rarity: 1, look: 'panda' },
    { id: 'hood-dino',   slot: 'hood', name: '공룡 가시',   rarity: 2, look: 'dino' },
    { id: 'pat-none',    slot: 'pat',  name: '무늬 없음',   rarity: 0, base: true, look: 'none' },
    { id: 'pat-stripe',  slot: 'pat',  name: '체크 밑단',   rarity: 0, look: 'stripe' },      // 2.7.5: 줄무늬가 보기 좋지 않다는 말에 그림을 바꿨다. 이미 가진 사람의 것이 사라지지 않게 id 와 look 의 이름은 그대로 둔다
    { id: 'pat-zigzag',  slot: 'pat',  name: '지그재그',    rarity: 0, look: 'zigzag' },      // 2.7.7 추가
    { id: 'pat-dot',     slot: 'pat',  name: '물방울',      rarity: 0, look: 'dot' },
    { id: 'pat-camo',    slot: 'pat',  name: '위장 무늬',   rarity: 1, look: 'camo' },
    { id: 'pat-star',    slot: 'pat',  name: '별 무늬',     rarity: 1, look: 'star' },
    { id: 'pat-rain',    slot: 'pat',  name: '빗방울',      rarity: 0, look: 'rain' },      // 4.5.2 더한 무늬
    { id: 'pat-heart',   slot: 'pat',  name: '하트',        rarity: 1, look: 'heart' },
    { id: 'pat-reflect', slot: 'pat',  name: '반사띠',      rarity: 1, look: 'reflect' },
    { id: 'bag-cooler',  slot: 'bag',  name: '냉장 상자',   rarity: 0, base: true, look: 'cooler' },
    { id: 'bag-ruck',    slot: 'bag',  name: '낡은 배낭',   rarity: 0, look: 'ruck' },
    { id: 'bag-medkit',  slot: 'bag',  name: '구급 상자',   rarity: 1, look: 'medkit' },
    { id: 'bag-teddy',   slot: 'bag',  name: '곰 인형 가방', rarity: 1, look: 'teddy' },
    { id: 'bag-lunch',   slot: 'bag',  name: '보자기 도시락', rarity: 0, look: 'lunch' },      // 4.5.2 더한 든 것
    { id: 'bag-pot',     slot: 'bag',  name: '새싹 화분',   rarity: 0, look: 'pot' },
    { id: 'bag-radio',   slot: 'bag',  name: '무전기',      rarity: 1, look: 'radio' },
    { id: 'bag-lantern', slot: 'bag',  name: '등불',        rarity: 2, look: 'lantern' },
    { id: 'fx-none',     slot: 'fx',   name: '효과 없음',   rarity: 0, base: true, look: 'none' },
    { id: 'fx-glow',     slot: 'fx',   name: '야광',        rarity: 2, look: 'glow' },
    { id: 'fx-sparkle',  slot: 'fx',   name: '반짝이 가루', rarity: 2, look: 'sparkle' },
    { id: 'fx-star',     slot: 'fx',   name: '머리 위 별',  rarity: 2, look: 'star' },
    { id: 'fx-petal',    slot: 'fx',   name: '꽃잎',        rarity: 2, look: 'petal' },      // 4.5.2 더한 효과
    { id: 'fx-bubble',   slot: 'fx',   name: '비눗방울',    rarity: 2, look: 'bubble' },
    // 2.0.3: 동물 친구의 옷. 친구는 늘 라라 옆에 붙어 다닌다
    { id: 'pet-none',    slot: 'pet',  name: '옷 없음',     rarity: 0, base: true, look: 'none' },
    { id: 'pet-scarf',   slot: 'pet',  name: '빨간 목도리', rarity: 0, look: 'scarf' },
    { id: 'pet-bell',    slot: 'pet',  name: '방울 목걸이', rarity: 0, look: 'bell' },
    { id: 'pet-ribbon',  slot: 'pet',  name: '분홍 리본',   rarity: 1, look: 'ribbon' },
    { id: 'pet-coat',    slot: 'pet',  name: '작은 우비',   rarity: 1, look: 'coat' },
    { id: 'pet-hat',     slot: 'pet',  name: '고깔모자',    rarity: 1, look: 'hat' },
    { id: 'pet-cape',    slot: 'pet',  name: '망토',        rarity: 2, look: 'cape' },
    { id: 'pet-crown',   slot: 'pet',  name: '왕관',        rarity: 2, look: 'crown' },
    // 4.4.6: 친구 그림이 바뀌어 옷 자리를 다시 잡고, 여덟 가지를 더했다
    { id: 'pet-bandana', slot: 'pet',  name: '노란 반다나', rarity: 0, look: 'bandana' },
    { id: 'pet-bowtie',  slot: 'pet',  name: '나비넥타이',  rarity: 0, look: 'bowtie' },
    { id: 'pet-flower',  slot: 'pet',  name: '꽃 핀',       rarity: 1, look: 'flower' },
    { id: 'pet-goggles', slot: 'pet',  name: '고글',        rarity: 1, look: 'goggles' },
    { id: 'pet-sweater', slot: 'pet',  name: '줄무늬 스웨터', rarity: 1, look: 'sweater' },
    { id: 'pet-pack',    slot: 'pet',  name: '작은 배낭',   rarity: 1, look: 'pack' },
    { id: 'pet-halo',    slot: 'pet',  name: '천사 고리',   rarity: 2, look: 'halo' },
    { id: 'pet-wings',   slot: 'pet',  name: '작은 날개',   rarity: 2, look: 'wings' },
    // 깃발은 뽑기에서 뺐다(2.0.0: 화면에서 작아서 뽑아도 기쁘지 않았다). 도전·원정의 확정 보상으로 준다(FLAG_REWARDS). 조각으로도 얻을 수 있다
    { id: 'flag-yellow', slot: 'flag', name: '노란 깃발',   rarity: 0, base: true, look: '#f0b400' },
    { id: 'flag-red',    slot: 'flag', name: '빨간 깃발',   rarity: 0, reward: true, look: '#c0392b' },
    { id: 'flag-blue',   slot: 'flag', name: '파란 깃발',   rarity: 0, reward: true, look: '#3f7fb5' },
    { id: 'flag-green',  slot: 'flag', name: '초록 깃발',   rarity: 0, reward: true, look: '#4f9a4a' },
    { id: 'flag-white',  slot: 'flag', name: '하얀 깃발',   rarity: 1, reward: true, look: '#e6e5db' },
    { id: 'flag-black',  slot: 'flag', name: '검은 깃발',   rarity: 1, reward: true, look: '#2b2d33' },
    { id: 'flag-pink',   slot: 'flag', name: '분홍 깃발',   rarity: 2, reward: true, look: '#ff7fb0' },
    { id: 'flag-glow',   slot: 'flag', name: '야광 깃발',   rarity: 2, reward: true, look: 'glow' },        // 밤에 빛난다
    { id: 'flag-orange', slot: 'flag', name: '주황 깃발',   rarity: 1, reward: true, look: '#e8862e' },
    { id: 'flag-purple', slot: 'flag', name: '보라 깃발',   rarity: 2, reward: true, look: '#8a5fd0' },
    { id: 'flag-rainbow', slot: 'flag', name: '무지개 깃발', rarity: 2, reward: true, look: 'rainbow' }     // 네 줄이 천천히 흐른다
  ];
  var COS_SLOTS = ['coat', 'hood', 'pat', 'bag', 'fx', 'pet', 'flag'], COS_BASE = { coat: 'coat-yellow', hood: 'hood-none', pat: 'pat-none', bag: 'bag-cooler', fx: 'fx-none', pet: 'pet-none', flag: 'flag-yellow' };
  /* 깃발을 주는 조건(확정 보상): 도전 훈장의 수, 원정 표시의 수, 지역 휘장 */
  var FLAG_REWARDS = [
    { id: 'flag-red',   text: '도전 훈장 1개', has: function (s) { return medalCount(s) >= 1; } },
    { id: 'flag-blue',  text: '도전 훈장 3개', has: function (s) { return medalCount(s) >= 3; } },
    { id: 'flag-green', text: '원정 별 6개', has: function (s) { return stageMarkCount(s).have >= 6; } },
    { id: 'flag-white', text: '도전 훈장 6개', has: function (s) { return medalCount(s) >= 6; } },
    { id: 'flag-black', text: '지역 휘장 1개', has: function (s) { return badgeCount(s) >= 1; } },
    { id: 'flag-pink',  text: '도전 훈장 8개', has: function (s) { return medalCount(s) >= 8; } },
    { id: 'flag-glow',  text: '원정 별 12개', has: function (s) { return stageMarkCount(s).have >= 12; } },
    // 3.0.3: 별이 원정마다 여섯(일반 셋 · 하드 셋)으로 늘어서 보상을 둘 더 둔다
    { id: 'flag-orange', text: '원정 별 20개', has: function (s) { return stageMarkCount(s).have >= 20; } },
    { id: 'flag-purple', text: '원정 별 30개', has: function (s) { return stageMarkCount(s).have >= 30; } },
    { id: 'flag-rainbow', text: '이야기의 끝 보기', has: function (s) { return (s.ended || 0) >= 1; } }
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
  /** 4.4.1 n 번 한꺼번에 뽑는다(뽑기 기계의 10회). 뽑기권이 n 장 있어야 한다. 보장은 한 번씩 뽑을 때와 똑같이 센다. */
  function pullGachaMany(state, n, rng) {
    n = Math.floor(safeNum(n, 0)); if (!(n >= 1 && n <= 10)) return fail('count');
    if (!(state.tickets >= n)) return fail('tickets');
    var out = []; for (var i = 0; i < n; i++) out.push(pullGacha(state, rng));
    return { ok: true, list: out };
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
  var STAGE_OPEN_ZONE = 2, STAGE_TREATS = { clear: 5, speed: 5, safe: 5, hard: 10, hardSpeed: 10, hardSafe: 10 }, STAGE_STARS = { normal: ['clear', 'speed', 'safe'], hard: ['hard', 'hardSpeed', 'hardSafe'] }, TAP5 = 5, BOSS_BADGE_LOOT = 1.1;
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
  /*
   * 3.0.5: 목표를 다시 쟀다. 전에는 1-5와 보스가 봇으로 초당 8번을 눌러도 제한 시간 안에 끝나지 않았고(1-5: 2,000만 중 749만),
   *   하드는 1-2 하나만 끝낼 수 있었다. 시간 제한이 걸린 판은 "실제로 되는가"를 재서 정한다:
   *     일반 클리어  초당 2번 누르는 봇이 제한 시간보다 1분쯤 일찍 끝낸다
   *     스피드       초당 3번 누르는 봇이 겨우 맞춘다
   *     하드 클리어  초당 3번 누르는 봇이 제한 시간 안에 끝낸다(hardNeed: 하드의 목표. 없으면 need 와 같다)
   *     하드 스피드  hardSpeed(없으면 speed). 초당 4번 누르는 봇이 맞추는 시간
   *     무결         방어 실패가 safe(하드는 hardSafe)번 이하. '무리 ×'가 걸린 판은 첫 밤을 막을 길이 없어서(40초 안에 물자 14만) 1번까지 봐 준다
   *   보스는 '무리 ×' 하나만 건다. '무리 × + 전체 생산 절반'은 봇이 15분에 한 밤도 못 막아서 될지 안 될지 잴 수 없었다.
   */
  var STAGES = [
    { id: 's1-1', region: 'r1', name: '첫 수색',      rules: ['tap5'],          goal: 'earn', need: 6.3e+07, hardNeed: 63000, limit: 480, speed: 360, hardSpeed: 360, hard: 'lean',
      goals: [{ goal: 'earn', need: 6.3e+07, hardNeed: 63000, speed: 360, hardSpeed: 360 }, { goal: 'build', need: 227, hardNeed: 66, speed: 360, hardSpeed: 360 }, { goal: 'nights', need: 6, hardNeed: 6, speed: 360, hardSpeed: 360 }, { goal: 'sweep', need: 40, hardNeed: 54, speed: 300, hardSpeed: 300 }] },
    { id: 's1-2', region: 'r1', name: '빈 골목',      rules: [],                goal: 'sweep', need: 39, hardNeed: 54, limit: 480, speed: 300, hardSpeed: 300, hard: 'frugal',
      goals: [{ goal: 'sweep', need: 39, hardNeed: 54, speed: 300, hardSpeed: 300 }, { goal: 'earn', need: 2.3e+07, hardNeed: 1.8e+06, speed: 360, hardSpeed: 360 }, { goal: 'build', need: 194, hardNeed: 142, speed: 360, hardSpeed: 360 }, { goal: 'nights', need: 6, hardNeed: 6, speed: 360, hardSpeed: 360 }] },
    { id: 's1-3', region: 'r1', name: '급한 공사',    rules: ['frugal'],        goal: 'build', need: 189, hardNeed: 53, limit: 720, speed: 540, hardSpeed: 540, hardSafe: 1, hard: 'lean',
      goals: [{ goal: 'build', need: 189, hardNeed: 53, speed: 540, hardSpeed: 540 }, { goal: 'earn', need: 8.9e+06, hardNeed: 24000, speed: 540, hardSpeed: 540 }, { goal: 'nights', need: 9, hardNeed: 7, speed: 540, hardSpeed: 480 }, { goal: 'sweep', need: 54, hardNeed: 81, speed: 360, hardSpeed: 420 }] },
    { id: 's1-4', region: 'r1', name: '긴 밤',        rules: ['horde'],         goal: 'nights', need: 5, hardNeed: 5, limit: 720, speed: 480, hardSpeed: 540, safe: 1, hardSafe: 1, hard: 'onewall',
      goals: [{ goal: 'nights', need: 5, hardNeed: 5, speed: 480, hardSpeed: 540 }, { goal: 'earn', need: 1.1e+08, hardNeed: 8.3e+07, speed: 540, hardSpeed: 540 }, { goal: 'build', need: 248, hardNeed: 243, speed: 540, hardSpeed: 540 }, { goal: 'sweep', need: 60, hardNeed: 88, speed: 420, hardSpeed: 420 }] },
    { id: 's1-5', region: 'r1', name: '빠듯한 살림',  rules: ['lean'],          goal: 'earn', need: 66000, hardNeed: 35000, limit: 900, speed: 660, hardSpeed: 600, safe: 1, hardSafe: 1, hard: 'horde',
      goals: [{ goal: 'earn', need: 66000, hardNeed: 35000, speed: 660, hardSpeed: 600 }, { goal: 'build', need: 66, hardNeed: 59, speed: 600, hardSpeed: 660 }, { goal: 'sweep', need: 67, hardNeed: 99, speed: 480, hardSpeed: 540 }] },
    { id: 's1-b', region: 'r1', name: '선착장의 무리', rules: ['horde'],         goal: 'nights', need: 7, hardNeed: 7, limit: 900, speed: 600, hardSpeed: 660, safe: 1, hardSafe: 1, hard: 'onewall', boss: true,
      goals: [{ goal: 'nights', need: 7, hardNeed: 7, speed: 600, hardSpeed: 660 }, { goal: 'earn', need: 1.9e+08, hardNeed: 1.6e+08, speed: 660, hardSpeed: 660 }, { goal: 'build', need: 269, hardNeed: 261, speed: 660, hardSpeed: 660 }, { goal: 'sweep', need: 75, hardNeed: 109, speed: 480, hardSpeed: 540 }] }
  ];
  /** 이 상태가 스테이지이고 그 규칙이 걸려 있는가(끝난 뒤에도 규칙은 그대로다: 결과 창이 뜰 때까지 화면이 바뀌지 않게). */
  function stageRule(state, rule) {
    var st = state.stage; if (!st) return false;
    var def = findById(STAGES, st.id); if (!def) return false;
    return def.rules.indexOf(rule) >= 0 || (st.hard && def.hard === rule);
  }
  function stageDef(state) { return state.stage ? findById(STAGES, state.stage.id) : null; }
  function stageRuleTexts(def, hard) { var r = def.rules.map(function (k) { return STAGE_RULES[k]; }); if (hard) r.push(STAGE_RULES[def.hard]); return r; }
  /** 그 난이도의 목표 수치(하드는 hardNeed 가 있으면 그것). */
  /*
   * 3.0.6: 원정의 목표는 도전할 때마다 바뀐다. 원정마다 목표 후보(goals)가 서넛 있고, 한 번 다녀오면(이기든 지든) 다음 목표가 다른 것으로 바뀐다.
   *   규칙과 제한 시간은 그 원정의 것 그대로다. 후보마다 목표 수치 · 하드 수치 · 스피드 시간을 봇으로 재서 정했다
   *   (일반: 초당 2번 봇이 제한 시간의 75% 지점에 닿는 값, 세 시드 중 가장 낮은 것. 하드: 초당 3번 봇).
   *   지금 걸린 목표는 본 게임의 stageGoal[id] 에, 다녀오는 중인 판의 목표는 stage.goal 에 적는다.
   */
  function stageVar(def, gi) { return (def.goals && def.goals[gi]) || (def.goals && def.goals[0]) || def; }
  function stageGoalIndex(main, id) { var def = findById(STAGES, id), n = def && def.goals ? def.goals.length : 1, i = main.stageGoal && main.stageGoal[id]; return i > 0 && i < n ? Math.floor(i) : 0; }
  function stageNeed(def, hard, gi) { var v = stageVar(def, gi); return hard && v.hardNeed > 0 ? v.hardNeed : v.need; }
  function stageSpeed(def, hard, gi) { var v = stageVar(def, gi); return hard && v.hardSpeed > 0 ? v.hardSpeed : v.speed; }
  function stageSafe(def, hard) { return (hard ? def.hardSafe : def.safe) || 0; }
  function stageGoalText(def, hard, gi) { return STAGE_GOALS[stageVar(def, gi).goal].text(stageNeed(def, hard, gi)); }
  /** 본 게임 상태에서: 원정이 열렸는가, 이 스테이지를 할 수 있는가. */
  function stagesOpen(main) { return Math.max(main.bestZone || 0, main.zone || 0) >= STAGE_OPEN_ZONE; }
  /*
   * 3.0.2 원정에 흔적을 남긴다(어려움은 그대로):
   *   pct    지금까지 가장 멀리 간 정도(0 ~ 1). 실패해도 남는다.
   *   steps  목표의 25 · 50 · 75%를 처음 넘을 때마다 간식 STAGE_STEP_TREATS 개(원정마다 한 번씩, 0 ~ STAGE_STEPS)
   *   fails  시간이 다 돼 실패한 횟수(연속, 최대 STAGE_RETRY_MAX). 다음 시도는 그만큼 시작 물자를 얹어 준다. 클리어하면 0. 하드에는 얹지 않는다.
   *   별은 일반 셋(clear 클리어 · speed 스피드 · safe 무결)과 하드 셋(hard · hardSpeed · hardSafe)을 따로 센다(3.0.3). 무결 = 방어 실패 없이 클리어.
   */
  var STAGE_STEPS = 3, STAGE_STEP_TREATS = 2, STAGE_RETRY_MAX = 3, STAGE_RETRY_SUPPLIES = 150;
  function stageMarks(main, id) { var m = main.stageMarks && main.stageMarks[id]; return { clear: !!(m && m.clear), speed: !!(m && m.speed), hard: !!(m && m.hard), hardSpeed: !!(m && m.hardSpeed), safe: !!(m && m.safe), hardSafe: !!(m && m.hardSafe), best: m && m.best > 0 ? m.best : 0, pct: m && m.pct > 0 ? Math.min(1, m.pct) : 0, steps: m && m.steps > 0 ? m.steps : 0, fails: m && m.fails > 0 ? m.fails : 0 }; }
  function stageRetryBonus(main, id, hard) { return hard ? 0 : stageMarks(main, id).fails * STAGE_RETRY_SUPPLIES; }
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
    s.stage = { id: id, hard: !!hard, won: false, lost: false, seconds: 0, goal: stageGoalIndex(main, id) };
    // 같은 알림이 다시 뜨지 않게 읽은 것만 옮긴다(복사본: 스테이지에서 바뀌어도 본 게임에 새지 않는다)
    s.story = JSON.parse(JSON.stringify(main.story || {})); s.ach = JSON.parse(JSON.stringify(main.ach || {})); s.zdex = JSON.parse(JSON.stringify(main.zdex || {}));
    s.heroName = main.heroName; s.heroGender = main.heroGender;
    s.supplies += stageRetryBonus(main, id, hard);      // 다시 도전: 지난 실패만큼 시작 물자를 얹는다(목표로 세는 누적에는 넣지 않는다)
    return s;
  }
  /** 스테이지의 지금 형편 { def, value, need, left, won, lost, over }. 스테이지가 아니면 null. */
  function stageStatus(state) {
    var def = stageDef(state); if (!def) return null;
    var st = state.stage, kind = stageVar(def, st.goal).goal, v = STAGE_GOALS[kind].value(state);
    var need = stageNeed(def, st.hard, st.goal);
    return { def: def, goal: kind, goalIndex: st.goal || 0, speed: stageSpeed(def, st.hard, st.goal), hard: !!st.hard, value: Math.min(v, need), need: need, left: Math.max(0, Math.ceil(def.limit - state.runSeconds)), won: !!st.won, lost: !!st.lost, over: !!(st.won || st.lost), seconds: st.seconds || 0 };
  }
  /** 시간마다 부른다: 목표를 채웠는지, 시간이 다 됐는지. 한 번 정해지면 바뀌지 않는다. */
  function checkStage(state, events) {
    var def = stageDef(state), st = state.stage;
    if (!def || st.won || st.lost) return;
    if (STAGE_GOALS[stageVar(def, st.goal).goal].value(state) >= stageNeed(def, st.hard, st.goal)) { st.won = true; st.seconds = Math.ceil(state.runSeconds); events.push({ type: 'stage-won', id: def.id, name: def.name, seconds: st.seconds, speed: st.seconds <= stageSpeed(def, st.hard, st.goal), hard: !!st.hard }); }
    else if (state.runSeconds >= def.limit) { st.lost = true; st.seconds = def.limit; events.push({ type: 'stage-lost', id: def.id, name: def.name }); }
  }
  /**
   * 끝난 스테이지의 결과를 본 게임 상태에 적는다. 새로 얻은 표시마다 간식을 준다.
   * 돌려주는 값: { ok, won, got: ['clear'|'speed'|'hard'…] 새로 얻은 표시, treats, badge(보스를 처음 잡았는가) }
   */
  function finishStage(main, stage, rng) {
    var stt = stageStatus(stage);
    if (!stt) return fail('none');
    // 다녀왔으면(이기든 지든 포기하든) 다음 목표를 다른 것으로 바꾼다. 다만 한 발짝도 못 가고 바로 돌아온 포기는 바꾸지 않는다(마음에 드는 목표가 나올 때까지 들락거리지 못하게)
    var gN = stt.def.goals ? stt.def.goals.length : 1;
    if (gN > 1 && (stt.won || stt.lost || stt.value > 0)) { if (!main.stageGoal) main.stageGoal = {}; main.stageGoal[stt.def.id] = (stt.goalIndex + 1 + Math.floor((typeof rng === 'function' ? rng() : Math.random()) * (gN - 1)) % (gN - 1)) % gN; }
    if (!main.stageMarks) main.stageMarks = {};
    var m = main.stageMarks[stt.def.id] || (main.stageMarks[stt.def.id] = { clear: false, speed: false, safe: false, hard: false, hardSpeed: false, hardSafe: false, best: 0, pct: 0, steps: 0, fails: 0 }), got = [], treats = 0;
    // 흔적: 가장 멀리 간 정도와 구간 간식(이기든 지든 적는다)
    var frac = stt.won ? 1 : Math.max(0, Math.min(1, stt.need > 0 ? stt.value / stt.need : 0)), before = m.pct > 0 ? m.pct : 0;
    var reach = Math.min(STAGE_STEPS, Math.floor(frac * (STAGE_STEPS + 1) + 1e-9)), stepTreats = Math.max(0, reach - (m.steps || 0)) * STAGE_STEP_TREATS;
    if (reach > (m.steps || 0)) m.steps = reach;
    if (frac > before) m.pct = frac;
    if (!stt.won) {
      if (stt.lost && !stt.hard) m.fails = Math.min(STAGE_RETRY_MAX, (m.fails || 0) + 1);      // 포기는 세지 않는다(포기만 되풀이해서 시작 물자를 받지 못하게)
      main.treats = Math.min(1e9, (main.treats || 0) + stepTreats);
      // 왜 못 끝냈나: 방어 실패가 있었으면 그것을, 아니면 시간이 모자랐다고 알린다
      var why = !stt.lost ? 'quit' : (stage.breaches > 0 ? 'breach' : 'time');
      return { ok: true, won: false, got: [], treats: stepTreats, stepTreats: stepTreats, badge: false, pct: frac, record: frac > before, before: before, why: why, breaches: stage.breaches || 0, retry: stageRetryBonus(main, stt.def.id, false) };
    }
    m.fails = 0; treats += stepTreats;
    function mark(k) { if (!m[k]) { m[k] = true; got.push(k); treats += STAGE_TREATS[k]; } }      // 새 표시 하나마다 간식과 뽑기권 한 장
    var badge = !!stt.def.boss && !m.clear;
    mark('clear');
    if (stt.seconds <= stageSpeed(stt.def, false, stt.goalIndex)) mark('speed');
    if (stt.hard) mark('hard');
    if ((stage.breaches || 0) <= stageSafe(stt.def, false)) mark('safe');      // 무결: 방어 실패가 봐 주는 횟수 안
    if (stt.hard && stt.seconds <= stageSpeed(stt.def, true, stt.goalIndex)) mark('hardSpeed');
    if (stt.hard && (stage.breaches || 0) <= stageSafe(stt.def, true)) mark('hardSafe');
    if (!(m.best > 0) || stt.seconds < m.best) m.best = stt.seconds;
    main.treats = Math.min(1e9, (main.treats || 0) + treats);
    var tickets = addTickets(main, got.length);
    var flags = grantFlags(main);
    return { ok: true, won: true, got: got, treats: treats, stepTreats: stepTreats, tickets: tickets, flags: flags, badge: badge, seconds: stt.seconds, pct: 1 };
  }
  /** 얻은 표시의 수와 전체 수(지역 하나 또는 전부). */
  function stageMarkCount(main, region) {
    var have = 0, all = 0;
    STAGES.forEach(function (d) { if (region && d.region !== region) return; var m = stageMarks(main, d.id); all += 6; STAGE_STARS.normal.concat(STAGE_STARS.hard).forEach(function (k) { if (m[k]) have++; }); });
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
    if ((id === 'frugal' && ups > 0) || (id === 'hands' && autos > 0) || (id === 'onewall' && walls > 1) || (id === 'unbroken' && state.breaches > 0) || (id === 'horde' && state.breaches > HORDE_BREACHES) || (id === 'sprint' && state.runSeconds > SPRINT_SECONDS) || (id === 'oneshot' && state.runSeconds > ONESHOT_SECONDS)) return 'broken';
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
    if (!reached) { if ((def.id === 'sprint' && state.runSeconds > SPRINT_SECONDS) || (def.id === 'oneshot' && state.runSeconds > ONESHOT_SECONDS)) failChallenge(state, events, 'time'); return; }
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
    next.stageGoal = state.stageGoal || {};
    next.stageMarks = state.stageMarks || {};      // 원정에서 얻은 표시도 남는다
    next.bestDanger = state.bestDanger || 0; next.rescued = state.rescued || 0; next.bests = state.bests || next.bests; next.endLog = state.endLog || [];
    next.ended = state.ended;      // dangerMax 가 본다
    next.dangerNext = Math.min(state.dangerNext || 0, dangerMax(next)); next.danger = next.dangerNext;      // 골라 둔 위험 단계로 시작한다(다음에도 같은 단계로 이어진다)
    next.tickets = state.tickets || 0; next.shards = state.shards || 0; next.cosmetics = state.cosmetics || {}; next.wear = state.wear || next.wear; next.gachaPity = state.gachaPity || 0; next.gachaPulls = state.gachaPulls || 0;      // 뽑기와 외형도 남는다
    next.challengeStreak = activeChallenge(state) ? 0 : (state.challengeStreak || 0);      // 도전을 달고 철수하면 포기한 것으로 친다
    next.bestZone = Math.max(state.bestZone, state.zone);
    if (state.nextChallenge && challengeOpen(next, state.nextChallenge)) next.challenge = { id: state.nextChallenge, failed: false, done: false };      // 골라 둔 도전으로 시작한다(한 번만)
    next.antibodies = state.antibodies + gained;
    next.antibodyTotal = state.antibodyTotal + gained;
    TRAITS.forEach(function (t) { next.traits[t.id] = state.traits[t.id]; });
    next.retreats = state.retreats + 1;
    next.pet = state.pet; next.party = state.party; next.kennel = state.kennel; next.treats = state.treats; next.petLv = state.petLv; next.heroName = state.heroName; next.heroGender = state.heroGender;      // 동물 친구와 이름은 함께 간다
    next.bestZone = Math.max(state.bestZone, state.zone);
    next.story = state.story;
    checkAchievements(state, null);      // 철수하는 순간까지 채운 것은 달성으로 쳐 준다
    next.ach = state.ach; next.zdex = state.zdex; next.regulars = state.regulars; next.clients = state.clients; next.cargos = state.cargos; next.sellPeak = !!state.sellPeak; next.autoOff = state.autoOff; next.elderOff = !!state.elderOff;      // 흥정꾼의 고점 판매 설정은 취향이라 철수해도 남는다
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
      "아저씨가 숨을 고르며 말했다. “집은 무너져도 짓는 법은 안 무너진다.” 그러고는 분필을 꺼내 첫 번째 문에 썼다. “사용하면 채워 놓을 것.”",
      "다시 1구역이다. 하지만 이번에는 무엇을 먼저 해야 하는지 안다."].join('\n\n'),
    when: function (s) { return s.retreats >= 1; } });

  /*
   * ---------- 엄마의 수첩(2.3.0) ----------
   * 끝을 한 번 본 뒤의 회차에서 열리는 글 15쪽. 주인공이 걸어온 길을 엄마가 먼저 걸었던 차례대로, 엄마의 목소리로 적는다.
   *   여는 글 1쪽: 끝을 본 뒤의 새 회차가 시작될 때
   *   구역마다 2쪽: 첫 쪽은 그 구역에 들어설 때(1구역은 목표 둘을 채웠을 때), 둘째 쪽은 그 구역의 목표를 모두 채웠을 때
   *   7구역의 둘째 쪽: 끝을 두 번째로 봤을 때(7구역의 목표를 다 채우는 순간이 곧 끝이라서 조건을 따로 둔다)
   * '끝을 본 뒤의 회차' = ended >= 1 이고 endedRun 이 거짓. 끝을 본 바로 그 회차(endedRun)에는 열리지 않는다:
   * 그 순간 zone 이 이미 7구역이라, 이 조건이 없으면 15쪽이 한꺼번에 쏟아진다.
   * 원정(스테이지)의 상태는 ended 가 0 이라 열리지 않는다.
   * 본편 일지와 어긋나지 않게 맞춘 것: 지붕의 7, 닦아 놓은 저울, 공단의 사진, 반장, 터널의 손자국, 발전기, 통과 17, 짧게 세 번.
   */
  var MOM_CHAPTER = 8, MOM_NAME = '엄마의 수첩';
  var MOM_PAGES = [
    { title: "반창고", text: [
      "엄마의 손이 다시 연필을 쥔다. 글씨는 아직 삐뚤다. 말은 돌아오지 않았다. 그래서 엄마는 쓴다. 하루에 한 쪽을 겨우 쓴다.",
      "다 쓴 수첩을 엄마가 내 가방에 넣어 주었다. 쪽마다 반창고가 붙어 있다. 겉에 숫자가 적혀 있다. 1부터 7까지, 두 번씩.",
      "거기 닿으면 떼라는 뜻이다. 거기 서서 읽어야 하는 글이라는 뜻이다. 엄마는 간호사라서 뭐든 반창고로 붙인다.",
      "나는 다시 1구역으로 간다. 지붕 위의 7을 따라 아직 오고 있는 사람들이 있다. 이번에는 내가 먼저 걸어 본 길이다. 그리고 엄마가 그보다 먼저 걸은 길이다."] },
    { title: "1 — 지붕", text: [
      "사태 9일째 밤. 네 열이 내린 것을 보고 나왔다. 데려가지 않은 까닭을 적는다. 병원까지는 닷새 길이고, 너는 그날 처음으로 밥을 달라고 한 아이였다.",
      "네 피가 든 관 일곱 개 가운데 하나만 들고 나왔다. 나머지 여섯은 네 무릎에 올려놓았다. 내가 길에서 끝나도 114번은 남아야 했다. 관도, 너도.",
      "골목은 걸을 수 없었다. 그래서 지붕으로 갔다. 창고에 있던 흰 페인트를 들고. 집마다 7을 쓰고 화살표를 그렸다. 네가 나를 찾으러 나올 아이라는 걸 알고 있었으니까.",
      "기다리라고 말했어야 했다. 그 말은 끝내 못 했다. 기다리지 않을 걸 알아서."] },
    { title: "1 — 현관 불", text: [
      "우리 집 현관 불 얘기를 적는다. 길게, 짧게, 길게. 네가 골목에서 놀다 안 들어오면 그렇게 깜박였다. 밥 다 됐다, 들어와라.",
      "네가 여섯 살 때 정한 신호다. 길게만 켜면 다른 집 불과 헷갈린다고 했다. 네가 정해 놓고 너는 잊었을지 모른다. 나는 한 번도 틀리게 켠 적이 없다.",
      "지붕 끝에서 한 번 돌아봤다. 다락 창에 네 손전등 불이 보였다. 통조림을 세고 있었을 것이다. 나는 그 불을 보고 방향을 잡았다. 등 뒤에 둬야 하는 방향을."] },
    { title: "2 — 저울", text: [
      "사태 10일째. 시장은 셔터가 다 내려가 있었다. 좌판 하나에 저울만 나와 있었다. 닦아 놓은 저울이다. 주인이 가까이 있다는 뜻이다.",
      "소독솜 한 통을 저울에 올려놓고 건어물 가게 문틈에 대고 말했다. 물 한 병만 가져가겠다고. 대답은 없었다. 나올 때 보니 저울 위는 비어 있고, 물병 옆에 멸치 한 줌이 놓여 있었다.",
      "얼굴도 못 본 사람과 거래를 했다. 그게 이상하게 힘이 됐다. 값을 치르고 받는 사람이 아직 있다."] },
    { title: "2 — 듣는 것들", text: [
      "방송은 내가 녹음한 것이다. 사태 2일째, 병원 사람들과. 피를 나눠 줄 사람을 모으려고. 백열세 명이 그 목소리를 듣고 팔을 걷어 주었다. 백열세 명 모두 반응이 없었다.",
      "놈들이 그 방송을 듣는다는 건 병원에서 이미 봤다. 시장 뒷골목에서 다시 봤다. 걷다가 서서, 고개를 기울이고. 나는 사람만 부른 줄 알았다.",
      "떠나던 밤에 집에서 테이프를 새로 녹음했다. 문장은 바꾸지 못했다. 사람이 와야 했으니까. 대신 문장 사이에 한 마디를 숨겼다. 탑에 닿으면 바꿔 끼울 것이다.",
      "너는 이 방송을 들으며 올 것이다. 놈들과 같은 방향으로. 그걸 알면서 테이프를 가방에 넣었다. 빈 케이스는 네 상자에 두었다. 변명 한 줄과 같이."] },
    { title: "3 — 열일곱", text: [
      "사태 11일째. 공단 기숙사 식당에서 아이들을 찾았다. 열일곱. 교복과 체육복. 어른은 없었다. 네 반 아이들이었다.",
      "반장이라는 아이가 나를 알아봤다. “{hero} 어머니시죠. {hero:은} 왜 안 왔어요?” 아파서 못 왔다고 했다. 거짓말은 아니다.",
      "공단은 아는 곳이다. 사태 첫 주에 야간조의 피를 뽑으러 왔었다. 다들 팔을 걷어 주고, 공장 앞에서 사진까지 찍자고 했다. 그 사람들은 먼저 떠나고 없었다. 기계를 얌전히 꺼 놓고.",
      "병원이 급했다. 열일곱을 데리고 가면 느려진다. 그 계산은 하지 않기로 했다. 계산은 다음 쪽에서 했다."] },
    { title: "3 — 한 대", text: [
      "반장이 물렸다. 철문을 나서다가, 맨 뒤에서 작은 애를 안으로 밀어 넣고. 팔뚝이었다.",
      "내 가방에는 114-1이 있었다. 한 대. 놓으면 그 아이가 멈출지도 모른다. 놓으면 연구에 쓸 것이 없어진다. 그 뒤에 물릴 모든 사람의 몫이 없어진다.",
      "나는 놓지 않았다. 그 계산에 3초가 걸렸다. 그 3초를 지금도 센다.",
      "반장은 울지 않았다. 이름을 적은 쪽지는 시장 냉동고에 두고 왔다고, {hero:이} 오면 볼 거라고 했다. 그러고는 제 발로 철망 밖에 섰다. 변한 뒤에도 우리를 따라오지 않았다. 강 쪽을 보고 서 있었다.",
      "네가 그 아이를 만났다면, 그 아이가 너를 물지 않았다면, 그건 네 피 때문만은 아닐 것이다. 나는 그렇게 믿기로 했다."] },
    { title: "4 — 손자국", text: [
      "사태 12일째. 막차는 떠난 뒤였다. 역무실 칠판에 적혀 있었다. 못 탄 사람은 선로를 따라 걸을 것. 터널 안에서는 소리 내지 말 것.",
      "열여섯 명에게 규칙을 하나만 줬다. 벽에서 손을 떼지 마라. 앞사람 소리가 아니라 벽을 따라가라. 터널 벽에 손자국이 한 줄로 남았을 것이다. 맨 위가 내 것이다.",
      "한가운데에서 놈들과 마주쳤다. 수십이었다. 우리는 벽에 붙어 숨을 참았다. 놈들은 지나갔다. 소리가 없으면 우리는 없는 것이다. 그날 배운 것으로 아이들은 강 건너에서도 살았다."] },
    { title: "4 — 전광판", text: [
      "승강장에 열차 한 대가 서 있었다. 맨 앞 칸에 불빛이 있었다. 누가 운전석에 앉아 있었다. 살아 있는 사람이었다. 부르지 않았다. 아이 열여섯을 세워 둔 채 소리를 낼 수는 없었다.",
      "대신 전광판을 봤다. 행선지 7구역. 누가 그걸 켜 두고 있다. 떠나지 않은 사람이 있다는 건 뒤에 올 사람에게 좋은 일이다. 네게.",
      "그날은 사태 12일째였다. 네가 기다리기를 그만둔 날이라는 건 나중에 네 일지에서 읽었다. 같은 날 너는 다락에 있었고 나는 땅 밑에 있었다."] },
    { title: "5 — 6층", text: [
      "사태 14일째. 병원에 닿았다. 6층 문에 동료의 글씨가 붙어 있었다. 이 아래는 포기했습니다. 그 사람은 죄송하다는 말을 빼먹는 법이 없다.",
      "7층은 비어 있었다. 냉장고는 돌고 있었다. 발전기 옆에 기름통이 줄지어 있고 쪽지가 있었다. 하루 한 통. 누가 오든 채울 것. 나도 한 통을 채웠다.",
      "114-1에서 한 방울을 덜어 현미경 아래에 놓았다. 반응은 진짜였다. 멈춘다. 그런데 멈추기만 한다. 되돌리려면 양이 더 있어야 한다. 관 하나로는 한 사람 몫도 못 된다."] },
    { title: "5 — 숫자", text: [
      "수첩에 너를 숫자로 적었다. 114번. 한 줄을 썼다가 지웠다. 지운 줄을 너는 불빛에 비춰 읽었다지.",
      "변명을 적는다. 숫자로 적어야 손이 떨리지 않았다. 네 팔에 바늘을 꽂던 밤에 나는 엄마가 아니라 간호사여야 했다. 엄마였으면 못 꽂았다.",
      "수첩과 네 사진은 사물함에 두고 나왔다. 문은 열어 두었다. 네가 여기까지 온다면 내가 뭘 알아냈는지 알아야 한다. 내가 없더라도.",
      "강 건너 탑으로 가기로 했다. 테이프를 바꿔야 한다. 그리고 아이 열여섯을 여기 둘 수는 없다. 아래 여섯 층이 전부 놈들이다."] },
    { title: "6 — 통과 17", text: [
      "사태 16일째. 검문소에는 군인이 하나 남아 있었다. 차단기를 올려 주면서 일지에 적었다. 통과 17, 그중 아이 16. 같이 가자고 했더니 고개를 저었다. 자기는 세는 사람이라고 했다.",
      "다리는 차로 막혀 있었다. 놈들은 차 사이에 서서 건너편을 보고 있었다. 방송이 나오는 쪽을. 내가 부른 것들이다.",
      "우리는 차 지붕으로 갔다. 터널에서처럼, 소리 없이. 한 줄로."] },
    { title: "6 — 다리 한가운데", text: [
      "버스 지붕에서 막내가 미끄러졌다. 소리가 났다. 나는 뛰어내려서 그 애를 지붕으로 올렸다. 올리는 동안 종아리가 뜨거웠다.",
      "물리면 반나절이다. 다리 끝까지는 차가 서른 대쯤 남아 있었다. 아이들을 먼저 보내고 맨 뒤에서 걸었다. 아이들한테는 말하지 않았다. 간호사 선생님이 다리를 전다고만 알았다.",
      "가방 속의 114-1을 생각했다. 공단에서 아낀 그 한 대. 반장에게는 안 된다고 한 것을 나한테는 된다고 하게 될까 봐, 다리를 다 건널 때까지 가방을 열지 않았다."] },
    { title: "7 — 테이프", text: [
      "탑에 닿았다. 방송실의 테이프를 바꿔 끼웠다. 같은 문장이다. 사이에 네게 하는 말이 하나 들어 있다. 무전기로는 들리지 않을 것이다. 그래도 넣었다. 하루에 한 번은 네 이름을 부르고 싶었다.",
      "열이 올랐다. 아이들 가운데 탐조등을 켜고 테이프를 갈 줄 아는 애는 없다. 내가 변하면 탑이 꺼진다. 탑이 꺼지면 아무도 오지 않는다. 너도.",
      "그래서 놓았다. 114-1을, 나한테. 연구에 쓸 한 대를. 반장에게는 놓지 않은 것을. 내가 한 계산 가운데 가장 나쁜 계산이다. 다시 해도 같은 답이 나온다.",
      "한 대로는 멈추기만 한다. 멈춘 채로도 스위치는 누를 수 있다."] },
    { title: "7 — 길게, 짧게, 길게", text: [
      "말이 먼저 나갔다. 다음은 글씨였다. 수첩의 마지막 쪽에는 선만 그었다. 아이들한테는 올라오지 말라고 했다. 어디까지가 나인지 나도 몰랐으니까.",
      "그 뒤는 띄엄띄엄하다. 밤이 오면 손이 스위치로 갔다. 길게, 짧게, 길게. 뜻은 잊었는데 손이 알았다. 밥 다 됐다. 들어와라.",
      "다리 건너에서 같은 불이 돌아온 밤은 기억한다. 그건 잊지 않았다. 짧게 세 번 켰다. 우리 집에는 없던 신호다. 뭐라고 켠 건지 나도 모른다. 아마 이름이었을 것이다.",
      "계단을 올라오는 발소리를 들었다. 백마흔 개. 노란 것이 보였다. 유치원 때부터 너는 노란 우비만 입었다. 멀리서도 내가 알아볼 수 있게.",
      "{hero:야}. 엄마는 계산을 많이 틀렸다. 하나는 맞았다. 너는 올 아이였다."] }
  ];
  /** 끝을 본 뒤의 새 회차인가(엄마의 수첩이 열리는 회차). */
  function afterEnding(s) { return (s.ended || 0) >= 1 && !s.endedRun && !s.stage; }
  MOM_PAGES.forEach(function (pg, i) {
    var zi = Math.floor((i - 1) / 2), second = i > 0 && (i - 1) % 2 === 1;      // 0쪽은 여는 글, 그 뒤로 구역마다 두 쪽
    BEATS.push({ id: 'mom-' + i, zone: MOM_CHAPTER, zoneName: MOM_NAME, mom: true, title: pg.title, part: i + 1, text: pg.text.join('\n\n'), when: function (s) {
      if (i === MOM_PAGES.length - 1) return (s.ended || 0) >= 2;      // 마지막 쪽: 끝을 두 번째로 봤을 때
      if (!afterEnding(s)) return false;
      if (i === 0) return true;
      if (s.zone < zi) return false;
      var done = activeGoals(s, zi).filter(function (g) { return !!s.goalsDone[g.id]; }).length;
      return second ? done >= 3 : (zi === 0 ? done >= 2 : true);
    } });
  });
  function momRead(s) { var n = 0; BEATS.forEach(function (b) { if (b.mom && s.story[b.id]) n++; }); return n; }
  function checkStory(state, events) {
    BEATS.forEach(function (b) {
      if (state.story[b.id]) return;
      var hit = false;
      try { hit = !!b.when(state); } catch (e) { hit = false; }
      if (!hit) return;
      state.story[b.id] = true;
      events.push({ type: 'story', id: b.id, zone: b.zone, zoneName: b.zoneName, mom: !!b.mom, title: b.title, text: fillStory(b.text, state.heroName, state.heroGender) });
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
    { id: 'z3level', group: 'z3', name: '기계공', needs: [10, 50, 150, 300], value: function (s) { return sumOf(s.machines); }, text: function (n) { return '3구역 시설 레벨의 합계 ' + n + ' 채우기'; } },
    { id: 'z3earn', group: 'z3', name: '공장장', needs: [1e13, 1e16, 1e19], value: function (s) { return s.lineEarned; }, text: function (n) { return '한 회차에 라인으로 물자 ' + formatNumber(n) + ' 벌기'; } },
    { id: 'z3steady', group: 'z3', name: '손이 바쁜 공장', needs: [50, 1000, 10000], value: function (s) { return s.mergesRun || 0; }, text: function (n) { return '한 회차에 손으로 ' + n + '번 합치기'; } },
    { id: 'z3up', group: 'z3', name: '정비반', needs: [10, 40], value: function (s) { return zoneUpgrades(s, 2); }, text: function (n) { return '3구역 개조를 모두 합쳐 ' + n + '번 하기'; } },
    { id: 'z3auto', group: 'z3', name: '손을 뗀 공장', tier: 2, needs: [1], value: function (s) { return s.upgrades.autoline; }, text: function () { return '조립공 들이기'; } },
    { id: 'z3even', group: 'z3', name: '명품', tier: 3, needs: [20], value: function (s) { return s.boxBest || 0; }, text: function (n) { return '상자 ' + n + '단계 만들기'; } },
    { id: 'z3belt', group: 'z3', name: '넓은 공장', tier: 4, needs: [2], value: function (s) { return s.upgrades.wide; }, text: function () { return '칸을 끝까지 넓히기'; } },
    // 4구역 환승역
    { id: 'z4train', group: 'z4', name: '차량 기지장', needs: [5, 20, 50, 100], value: function (s) { return s.trains; }, text: function (n) { return '기관차 ' + n + '레벨 올리기'; } },
    { id: 'z4earn', group: 'z4', name: '화물왕', needs: [1e20, 1e23, 1e26], value: function (s) { return s.railEarned; }, text: function (n) { return '한 회차에 화물로 물자 ' + formatNumber(n) + ' 벌기'; } },
    { id: 'z4express', group: 'z4', name: '만차', needs: [1, 20, 200], value: function (s) { return s.expressRuns; }, text: function (n) { return '한 회차에 12칸 열차를 ' + n + '번 보내기'; } },
    { id: 'z4route', group: 'z4', name: '귀한 짐', needs: [3, 10], value: function (s) { return s.routes.grade || 0; }, text: function (n) { return '화물 등급 ' + n + '레벨 올리기'; } },
    { id: 'z4up', group: 'z4', name: '역무원', needs: [10, 25], value: function (s) { return zoneUpgrades(s, 3); }, text: function (n) { return '4구역 개조를 모두 합쳐 ' + n + '번 하기'; } },
    { id: 'z4auto', group: 'z4', name: '맡겨 둔 승강장', tier: 2, needs: [1], value: function (s) { return s.upgrades.autosig; }, text: function () { return '역무원 두기'; } },
    // 5구역 대학 병원
    { id: 'z5staff', group: 'z5', name: '연구실장', needs: [5, 25, 100, 250], value: function (s) { return s.staff; }, text: function (n) { return '연구원 ' + n + '명 뽑기'; } },
    { id: 'z5done', group: 'z5', name: '퇴원', needs: [5, 50, 200, 500], value: function (s) { return s.curesRun || 0; }, text: function (n) { return '한 회차에 사람 ' + n + '명 되돌리기'; } },
    { id: 'z5points', group: 'z5', name: '놓은 혈청', needs: [100, 2000], value: function (s) { return s.dosesAll || 0; }, text: function (n) { return '한 회차에 혈청 ' + formatNumber(n) + '대 놓기'; } },
    { id: 'z5up', group: 'z5', name: '실험 도구', needs: [10, 30], value: function (s) { return zoneUpgrades(s, 4); }, text: function (n) { return '5구역 개조를 모두 합쳐 ' + n + '번 하기'; } },
    { id: 'z5deep', group: 'z5', name: '한 사람도', needs: [10, 40], value: function (s) { return (s.turnedRun || 0) > 0 ? 0 : (s.curesRun || 0); }, text: function (n) { return '아무도 변하지 않게 하면서 ' + n + '명 되돌리기'; } },
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
    if (line > 0) { earn(state, line); state.lineEarned += line; if (lineInfo(state).steady) state.steadySeconds += dt; }
    stepContracts(state, dt, line > 0 ? line / productValue(state) : 0, rng, events);
    stepLineEvents(state, dt, rng, events);
    stepZoneEvents(state, dt, rng, events);
    // 자동 개조: 밤샘 연구, 순찰, 직접 방송을 준비되는 대로 알아서 누른다
    PUSHES.forEach(function (d) { if (autoEvents(state, d.zone) && !(state.push[d.id].cool > 0) && pushZone(state, d.id).ok) events.push({ type: 'auto-push', id: d.id }); });      // 3구역 납품 의뢰: 이번 틱에 만든 완제품 수를 넘긴다
    if (state.zone >= 6) state.survivors = Math.min(1e15, (state.survivors || 0) + survivorRate(state) * dt * pushFactor(state, 'tower', dt));      // 7구역: 방송을 듣고 생존자가 모인다(직접 방송 중이면 더 빨리)
    stepTune(state, dt, rng, events); stepCamp(state, dt, rng, events);      // 7구역 주파수(3.1.0): 바늘이 움직이고, 송신 기사가 있으면 알아서 맞춘다
    pushFactor(state, 'guard', dt); stepBridge(state, dt, rng, events); var guard = 0;      // 6구역(3.9.7): 통행 물자는 다리에서 잡을 때 들어온다
    if (guard > 0) { earn(state, guard); state.guardEarned += guard; }
    stepWard(state, dt, rng, events);      // 5구역(3.9.0): 약품과 연구 점수는 시험관을 거둘 때 들어온다
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
    stepRail(state, dt, events, rng);
    if (state.greenCool > 0) state.greenCool = Math.max(0, state.greenCool - dt);
    if (false && autoOn(state, 3) && zoneOpen(state, 3) && !(state.greenCool > 0)) { var auto = greenSignal(state); if (auto.ok) { events.push({ type: 'green' }); auto.arrivals.forEach(function (e) { events.push(e); }); } }
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
    // 3.3.0: 자리를 비운 동안에도 상자는 들어오고 합쳐진다. 수입은 나갈 때의 판으로 치고(더 주지 않는다), 판은 그 뒤에 자란 모습으로 돌려준다
    stepBoard(state, counted, null, null, 30000);
    report.gain = (searchRate(state) + sweepRate(state)) * counted * rate + trade + line;      // 순찰조는 자리를 비운 동안에도 돈다
    // 자리를 비운 동안에도 공사는 간다(여러 채를 이어 짓지는 않는다: 다음 건물은 돌아와서 고른다). 송신 기사가 있으면 그만큼 더 빨리
    if (state.zone >= 6) stepCamp(state, Math.max(5.01, counted), null, null);      // 4.2.0: 자리를 비운 동안 이장이 있으면 사람을 보낸다(밤은 오지 않는다)
    // 자리를 비운 동안: 송신 기사가 있으면 주파수도 알아서 맞춘 것으로 친다(쉴 때마다 절반씩)
    if (state.zone >= 6) state.survivors = Math.min(1e15, (state.survivors || 0) + survivorRate(state) * counted * rate * (1 + (mods(state).autotower > 0 ? TUNE_AUTO * TUNE_GAIN_SECONDS / TUNE_COOL : 0)));
    var guardAway = guardRate(state) * counted * rate;
    report.gain += guardAway + labRate(state) * counted * rate;      // 약품도 자리를 비운 동안 쌓인다
    earn(state, report.gain);
    state.tradeEarned += trade;
    state.lineEarned += line;
    state.guardEarned += guardAway;
    if (line > 0 && lineInfo(state).steady) state.steadySeconds += counted;     // 정속으로 맞춰 두고 나갔으면 그 시간도 친다
    // 4구역 열차: 자리를 비운 동안에도 다닌다. 돌아온 열차의 화물은 자리 비움 효율로 쳐서 받는다.
    // 3.4.0: 자리를 비운 동안은 역무원이 보낸 것으로 친다(railRate 그대로). 돌아오면 승강장에는 새 열차가 서 있다
    var railAway = railRate(state) * counted * rate;
    if (railAway > 0) { earn(state, railAway); state.railEarned += railAway; report.gain += railAway; report.trains = Math.floor(counted / (carSeconds(state) * AUTO_CARS)); state.trainsSent = (state.trainsSent || 0) + report.trains; }
    if (elapsed >= 60) state.plat = newPlat();
    // 5구역 연구: 점수도 자리 비움 효율로 모인다
    report.points = 0;      // 4.0.5: 연구 성과를 없앴다
    if (elapsed >= 60) { state.ward = newWard(); wardOf(state); }      // 자리를 비운 사이 병실은 새로 찬다
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
    return g('retreat', '현재는 더 나아갈 곳이 없어요. 철수해서 항체 샘플을 챙기고, 더 강하게 다시 시작해 보세요.');
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
    LAB_VALUE: LAB_VALUE, labRate: labRate, STAFF_COST: STAFF_COST, STAFF_GROWTH: STAFF_GROWTH, PROJECT_BASE: PROJECT_BASE, PROJECT_STEP: PROJECT_STEP, PROJECT_GROWTH: PROJECT_GROWTH, OFFER_COUNT: OFFER_COUNT,
    REROLL_SHARE: REROLL_SHARE, SUPPLY_DROP_SECONDS: SUPPLY_DROP_SECONDS, PROJECTS: PROJECTS,
    staffCost: staffCost, maxStaff: maxStaff, buyStaff: buyStaff, researchRate: researchRate, projectCost: projectCost, rerollCost: rerollCost,
    drawOffers: drawOffers, runProject: runProject, rerollOffers: rerollOffers,
    SEAT_BASE: SEAT_BASE, SEAT_MAX: SEAT_MAX, SERUM_SECONDS: SERUM_SECONDS, SERUM_CAP: SERUM_CAP, SERUM_CAP_STEP: SERUM_CAP_STEP, SERUM_TAP: SERUM_TAP, TURN_SECONDS: TURN_SECONDS, TURN_BREAK: TURN_BREAK, TURN_STUN: TURN_STUN, WARD_DOSES: WARD_DOSES, WARD_CURE: WARD_CURE, WARD_STAY: WARD_STAY, WARD_STAY_ONE: WARD_STAY_ONE, NURSE_FROM: NURSE_FROM, WARD_ARRIVE: WARD_ARRIVE, NURSE_SECONDS: NURSE_SECONDS, REAGENT_STEP: REAGENT_STEP, REAGENT_MAX: REAGENT_MAX,
    seatCount: seatCount, serumCap: serumCap, turnSeconds: turnSeconds, serumSeconds: serumSeconds, nurseOn: nurseOn, wardOf: wardOf, doseValue: doseValue, tapSerum: tapSerum, injectSeat: injectSeat, injectEr: injectEr, boostSeat: boostSeat, pickBoon: pickBoon, ACUTE_RATE: ACUTE_RATE, HARD_SPEED: HARD_SPEED, chartFull: chartFull, CHART_MAX: CHART_MAX, CASH_DOSES: CASH_DOSES, nextChart: nextChart, mixNeed: mixNeed, boonOf: boonOf, BOONS: BOONS, BOON_BY: BOON_BY, CHART_TEXT: CHART_TEXT, ER_FIRST: ER_FIRST, ER_EVERY: ER_EVERY, ER_TIME: ER_TIME, ER_HAND: ER_HAND, BOOST_DOSES: BOOST_DOSES, CHART_EASY: CHART_EASY, CHART_HARD: CHART_HARD, stepWard: stepWard, rackCost: rackCost, buyRack: buyRack, reagentCost: reagentCost, buyReagent: buyReagent,
    SWEEP_COLS: SWEEP_COLS, SWEEP_ROWS: SWEEP_ROWS, SWEEP_TILES: SWEEP_TILES, SWEEP_AUTO_SECONDS: SWEEP_AUTO_SECONDS, SWEEP_BONUS_CLICKS: SWEEP_BONUS_CLICKS,
    TILE_KINDS: TILE_KINDS, tileKind: tileKind, tileSearched: tileSearched, sweepCount: sweepCount, nextTile: nextTile, sweepBonus: sweepBonus,
    SURGE_MULT: SURGE_MULT, SURGE_SECONDS: SURGE_SECONDS, SURGE_COOLDOWN: SURGE_COOLDOWN, surge: surge, lineNow: lineNow,
    ASSIST_MAX: ASSIST_MAX, ASSIST_STEP: ASSIST_STEP, assistLevel: assistLevel, assistOn: assistOn, assistFactor: assistFactor, surgeCooldown: surgeCooldown, greenCooldown: greenCooldown,
    GREEN_SECONDS: GREEN_SECONDS, GREEN_COOLDOWN: GREEN_COOLDOWN, greenSignal: greenSignal,
    PET_NAME_MAX: PET_NAME_MAX, PET_KINDS: PET_KINDS, PET_BREEDS: PET_BREEDS, PET_RARITIES: PET_RARITIES, PET_PULL_MIN: PET_PULL_MIN, PET_PULL_SHARE: PET_PULL_SHARE, PET_DUP_REFUND: PET_DUP_REFUND,
    cleanName: cleanName, setHeroName: setHeroName, kennelCount: kennelCount, petPullCost: petPullCost, rollRarity: rollRarity, adoptPet: adoptPet, choosePet: choosePet, renamePet: renamePet, petEffect: petEffect, petOwnBonus: petOwnBonus, petSkillText: petSkillText, partyOf: partyOf, PET_SKILLS: PET_SKILLS, PET_OWN: PET_OWN, breedDesc: breedDesc, petInfo: petInfo,
    MOM_CHAPTER: MOM_CHAPTER, MOM_PAGES: MOM_PAGES, momRead: momRead, afterEnding: afterEnding,
    PRICE_HISTORY: PRICE_HISTORY, STREAK_MAX: STREAK_MAX, STREAK_BONUS: STREAK_BONUS, streakMult: streakMult,
    PRICE_STEP: PRICE_STEP, PRICE_FLOOR: PRICE_FLOOR, PRICE_CEIL: PRICE_CEIL, GOODS_VALUE: GOODS_VALUE, GOODS_CAP_SECONDS: GOODS_CAP_SECONDS, PEAK_PRICE: PEAK_PRICE, peakPrice: peakPrice,
    RETREAT_MIN: RETREAT_MIN, RETREAT_K: RETREAT_K, RETREAT_POW: RETREAT_POW,
    ZONES: ZONES, BUILDINGS: BUILDINGS, DEFENSES: DEFENSES, UPGRADES: UPGRADES, PERKS: PERKS, TRAITS: TRAITS, GOALS: GOALS, EXT_MAX: EXT_MAX, EXT_TREATS: EXT_TREATS, EXT_SECONDS: EXT_SECONDS, extNeed: extNeed, extText: extText, extGoals: extGoals, GOALS_ALT: GOALS_ALT, activeGoals: activeGoals, rollGoalPick: rollGoalPick, BEATS: BEATS,
    createState: createState, sanitizeState: sanitizeState, mods: mods, globalMult: globalMult,
    settleTime: settleTime, TUNE_BUILD: TUNE_BUILD, SETTLE_BUILD: SETTLE_BUILD, campOf: campOf, setElder: setElder, raidTight: raidTight, NIGHT_FLOOR: NIGHT_FLOOR, NIGHT_STEP: NIGHT_STEP, NIGHT_CAP: NIGHT_CAP, LV_MAX: LV_MAX7, CAMP_ROWS: CAMP_ROWS, campRow: campRow, campRowCost: campRowCost, buyCampRow: buyCampRow, levelNeed: levelNeed, CART_STEP: CART_STEP, WALL7_STEP: WALL7_STEP, ARMS_STEP: ARMS_STEP, guardPool: guardPool, NIGHT_FRAC: NIGHT_FRAC, rescueStray: rescueStray, strayGain: strayGain, STRAY_PAY: STRAY_PAY, STRAY_TIME: STRAY_TIME, STRAY_MAX: STRAY_MAX, STRAY_EVERY: STRAY_EVERY, sideHold: sideHold, sideNeed: sideNeed, towerHold: towerHold, newRaid: newRaid, RAID_SHIFT: RAID_SHIFT, campSeen: campSeen, raidNeed: raidNeed, levelPow: levelPow, LV_GROW: LV_GROW, TOWER_HOLD_MAX: TOWER_HOLD_MAX, GUARD_LOSS: GUARD_LOSS, settleLv: settleLv, settleBroken: settleBroken, levelCost: levelCost, settleNeed: settleNeed, settleWork: settleWork, settleLevels: settleLevels, nightHold: nightHold, sendGuard: sendGuard, stepCamp: stepCamp, elderOn: elderOn, elderTarget: elderTarget, LV_MAX7: LV_MAX7, LV_COST: LV_COST, SEND_PARTS: SEND_PARTS, REPAIR_FRAC: REPAIR_FRAC, RAID_EVERY: RAID_EVERY, RAID_SECONDS: RAID_SECONDS, CAMP_HAND: CAMP_HAND, NIGHT_DROP: NIGHT_DROP, GUARD_PARTS: GUARD_PARTS, ELDER_SECONDS: ELDER_SECONDS, TOWER_HOLD: TOWER_HOLD,
    SETTLE: SETTLE, settleHas: settleHas, settleUsed: settleUsed, settleFree: settleFree, settleCount: settleCount, settleBlock: settleBlock, buildSettle: buildSettle, serumNeeds: serumNeeds,
    tuneBand: tuneBand, tunePos: tunePos, tuneGain: tuneGain, tuneHit: tuneHit, tuneNow: tuneNow, TUNE_PERIOD: TUNE_PERIOD, TUNE_COOL: TUNE_COOL, TUNE_MISS_COOL: TUNE_MISS_COOL, TUNE_GAIN_SECONDS: TUNE_GAIN_SECONDS, TUNE_AUTO: TUNE_AUTO,
    stageRetryBonus: stageRetryBonus, stageNeed: stageNeed, stageVar: stageVar, stageGoalIndex: stageGoalIndex, stageSpeed: stageSpeed, stageSafe: stageSafe, STAGE_STARS: STAGE_STARS, STAGE_STEP_TREATS: STAGE_STEP_TREATS, STAGE_RETRY_SUPPLIES: STAGE_RETRY_SUPPLIES, STAGE_RETRY_MAX: STAGE_RETRY_MAX,
    AUTO_MERGE_ROOM: AUTO_MERGE_ROOM, boardRoom: boardRoom, BOARD_SIZE: BOARD_SIZE, BOX_MAX: BOX_MAX, BOX_STEP: BOX_STEP, FEED_SECONDS: FEED_SECONDS, MERGE_SECONDS: MERGE_SECONDS, BOARD_BASE: BOARD_BASE, BOARD_MAX: BOARD_MAX, FEED_STEP: FEED_STEP, AUTO_MERGE_SECONDS: AUTO_MERGE_SECONDS, autoMergeSeconds: autoMergeSeconds, BOXES: BOXES, feedSeconds: feedSeconds, spawnLevel: spawnLevel, boardSize: boardSize, boardFull: boardFull, machineGain: machineGain, contractHave: contractHave, heldLevel: heldLevel, CONTRACT_PAY_SECONDS: CONTRACT_PAY_SECONDS, boxName: boxName,
    boxWorth: boxWorth, boardSum: boardSum, boxRate: boxRate, boxPartner: boxPartner, mergeBox: mergeBox, mergeable: mergeable, stepBoard: stepBoard, lowestPair: lowestPair,
    CAR_SECONDS: CAR_SECONDS, CAR_BASE: CAR_BASE, CAR_MAX: CAR_MAX, CAR_STEP: CAR_STEP, AUTO_CARS: AUTO_CARS, AUTO_NEAR: AUTO_NEAR, TEST: TEST, BRIDGE_SPAWN: BRIDGE_SPAWN, BRIDGE_WALK: BRIDGE_WALK, BRIDGE_WALK_BIG: BRIDGE_WALK_BIG, BRIDGE_HP: BRIDGE_HP, BRIDGE_BIG_HP: BRIDGE_BIG_HP, BRIDGE_BIG_EVERY: BRIDGE_BIG_EVERY, BRIDGE_BIG_CARRY: BRIDGE_BIG_CARRY, BRIDGE_LEAK: BRIDGE_LEAK, BRIDGE_COMBO_STEP: BRIDGE_COMBO_STEP, BRIDGE_COMBO_HOLD: BRIDGE_COMBO_HOLD, BRIDGE_WAVE: BRIDGE_WAVE, FIRE_MAX: FIRE_MAX, MORALE_MAX: MORALE_MAX, bridgeOf: bridgeOf, BOMB_R: BOMB_R, BOMB_DMG: BOMB_DMG, LV_PAY: LV_PAY, LV_HP: LV_HP, LV_DROP: LV_DROP, bridgeLvPay: bridgeLvPay, HEAT_SHOT: HEAT_SHOT, HEAT_COOL: HEAT_COOL, JAM_SECONDS: JAM_SECONDS, wallMax: wallMax, nadeNeed: nadeNeed, throwNade: throwNade, BRIDGE_KINDS: BRIDGE_KINDS, WALL_BASE: WALL_BASE, WALL_FIX: WALL_FIX, BREACH_SECONDS: BREACH_SECONDS, WAVE_EVERY: WAVE_EVERY, WAVE_WARN: WAVE_WARN, WAVE_SECONDS: WAVE_SECONDS, WAVE_PAY: WAVE_PAY, NADE_DMG: NADE_DMG, AWAY_AUTO: AWAY_AUTO, AUTO_DMG: AUTO_DMG, comboCap: comboCap, tapDamage: tapDamage, bridgeShotSeconds: bridgeShotSeconds, fireCost: fireCost, buyFire: buyFire, moraleCost: moraleCost, buyMorale: buyMorale, bridgeWave: bridgeWave, shootBridge: shootBridge, stepBridge: stepBridge, HORDE_SECONDS: HORDE_SECONDS, HORDE_WARN: HORDE_WARN, HORDE_RUSH_SPEED: HORDE_RUSH_SPEED, HORDE_RUSH_DIST: HORDE_RUSH_DIST, HORDE_RUSH_CARS: HORDE_RUSH_CARS, LONG_CARS: LONG_CARS, CAR_NORM: CAR_NORM, RAIL_SCALE: RAIL_SCALE, GRADE_STEP: GRADE_STEP, CREW_STEP: CREW_STEP, PULL_SECONDS: PULL_SECONDS, HORN_PUSH: HORN_PUSH, pullCar: pullCar, blowHorn: blowHorn, hornMax: hornMax, carMax: carMax,
    stepRail: stepRail, carMult: carMult, carSeconds: carSeconds, railUnits: railUnits, trainInfo: trainInfo, sendTrain: sendTrain, trainGain: trainGain,
    totalBuildings: totalBuildings, sweepRate: sweepRate, incomePerSec: incomePerSec, nextAntibodyAt: nextAntibodyAt, ANTI_STEP: ANTI_STEP, ANTI_CURVE: ANTI_CURVE, AUTO_DEF_STEPS: AUTO_DEF_STEPS, repairInterval: repairInterval, cycleAutoDef: cycleAutoDef, autoDefLeft: autoDefLeft, rerollsLeft: rerollsLeft, rerollPerks: rerollPerks, siegeFactor: siegeFactor, SIEGE_FADE: SIEGE_FADE, SIEGE_FLOOR: SIEGE_FLOOR, RECORDS: RECORDS, RECORD_CHANCE: RECORD_CHANCE, RECORD_BONUS: RECORD_BONUS, RECORD_BONUS_MAX: RECORD_BONUS_MAX, RECORD_TREATS: RECORD_TREATS, recordMult: recordMult, recordCount: recordCount, CARGOS: CARGOS, SALVAGE_SECONDS: SALVAGE_SECONDS, SALVAGE_BONUS: SALVAGE_BONUS, SALVAGE_BONUS_MAX: SALVAGE_BONUS_MAX, SALVAGE_TREATS: SALVAGE_TREATS, salvageMult: salvageMult, cargoCount: cargoCount, salvageReward: salvageReward, fillSalvage: fillSalvage, cargoValue: cargoValue, CLIENTS: CLIENTS, CONTRACT_SECONDS: CONTRACT_SECONDS, CONTRACT_BONUS: CONTRACT_BONUS, CONTRACT_BONUS_MAX: CONTRACT_BONUS_MAX, CONTRACT_TREATS: CONTRACT_TREATS, contractMult: contractMult, clientCount: clientCount, contractReward: contractReward, fillContract: fillContract, REGULARS: REGULARS, ORDER_SECONDS: ORDER_SECONDS, ORDER_BONUS: ORDER_BONUS, ORDER_BONUS_MAX: ORDER_BONUS_MAX, ORDER_TREATS: ORDER_TREATS, orderMult: orderMult, regularCount: regularCount, orderReward: orderReward, fillOrder: fillOrder, PASSERS: PASSERS, PASSER_CHANCE: PASSER_CHANCE, PASSER_BONUS_MAX: PASSER_BONUS_MAX, passerMult: passerMult, passerCount: passerCount, passBridge: passBridge, postDefense: postDefense, POST_DEFENSE: POST_DEFENSE, LOW_RUN_MAX: LOW_RUN_MAX, RECIPES: RECIPES, JAM_SELF_FIX: JAM_SELF_FIX, TRUCK_WAIT: TRUCK_WAIT, TRUCK_STOCK_MAX: TRUCK_STOCK_MAX, recipeOf: recipeOf, setRecipe: setRecipe, repairJam: repairJam, truckReward: truckReward, loadTruck: loadTruck, stepLineEvents: stepLineEvents, stepContracts: stepContracts, ZONE_EVENTS: ZONE_EVENTS, ZEV_WAIT: ZEV_WAIT, ZEV_NOW: ZEV_NOW, ZEV_BOOST: ZEV_BOOST, ZEV_BOOST_MAX: ZEV_BOOST_MAX, ZEV_AUTO: ZEV_AUTO, ZEV_MIN_PEOPLE: ZEV_MIN_PEOPLE, zevReward: zevReward, answerZoneEvent: answerZoneEvent, stepZoneEvents: stepZoneEvents, FOCUS_SECONDS: FOCUS_SECONDS, FOCUS_MULT: FOCUS_MULT, FOCUS_COOL: FOCUS_COOL, PUSHES: PUSHES, PUSH_SECONDS: PUSH_SECONDS, PUSH_MULT: PUSH_MULT, PUSH_COOL: PUSH_COOL, pushZone: pushZone, focusLab: focusLab, researchNow: researchNow, CAP_BASE: CAP_BASE, CAP_PER: CAP_PER, CAP_OVER: CAP_OVER, experience: experience, upgradeSoftCap: upgradeSoftCap, autoEvents: autoEvents, setAutoEvents: setAutoEvents, AUTO_SHARE: AUTO_SHARE, autoShare: autoShare, SCOUT_MINUTES: SCOUT_MINUTES, scoutNeed: scoutNeed, scoutLeft: scoutLeft, zoneEntered: zoneEntered, DANGER_PROD: DANGER_PROD, dangerPower: dangerPower, UNBROKEN_MULT: UNBROKEN_MULT, ONEWALL_MULT: ONEWALL_MULT, HORDE_BREACHES: HORDE_BREACHES, ONESHOT_SECONDS: ONESHOT_SECONDS, DANGER_SERUM: DANGER_SERUM, dangerSerum: dangerSerum, DANGER_COST_LATE: DANGER_COST_LATE, DANGER_COST_KNEE: DANGER_COST_KNEE, DANGER_MAX: DANGER_MAX, DANGER_HORDE: DANGER_HORDE, DANGER_COST: DANGER_COST, DANGER_ANTIBODY: DANGER_ANTIBODY, DANGER_TICKETS: DANGER_TICKETS, RESCUE_TIERS: RESCUE_TIERS, RESCUE_BONUS: RESCUE_BONUS, dangerOf: dangerOf, dangerMax: dangerMax, dangerHorde: dangerHorde, dangerCost: dangerCost, setDangerNext: setDangerNext, rescueTier: rescueTier, rescueMult: rescueMult, rescueNext: rescueNext, COSMETICS: COSMETICS, COS_SLOTS: COS_SLOTS, COS_BASE: COS_BASE, FLAG_REWARDS: FLAG_REWARDS, grantFlags: grantFlags, RARITIES: RARITIES, GACHA_ODDS: GACHA_ODDS, GACHA_PITY: GACHA_PITY, TICKET_TREATS: TICKET_TREATS, SHARDS_DUP: SHARDS_DUP, SHARDS_COST: SHARDS_COST, gachaTable: gachaTable, gachaPityLeft: gachaPityLeft, pullGacha: pullGacha, pullGachaMany: pullGachaMany, buyTicket: buyTicket, craftCosmetic: craftCosmetic, wearCosmetic: wearCosmetic, ownsCosmetic: ownsCosmetic, cosmeticLook: cosmeticLook, STAGES: STAGES, REGIONS: REGIONS, STAGE_RULES: STAGE_RULES, STAGE_TREATS: STAGE_TREATS, STAGE_OPEN_ZONE: STAGE_OPEN_ZONE, stagesOpen: stagesOpen, stageMarks: stageMarks, stageBlock: stageBlock, createStage: createStage, stageStatus: stageStatus, stageDef: stageDef, stageRuleTexts: stageRuleTexts, stageGoalText: stageGoalText, finishStage: finishStage, stageMarkCount: stageMarkCount, badgeCount: badgeCount, stageRule: stageRule, CHALLENGES: CHALLENGES, challengeBlock: challengeBlock, startChallenge: startChallenge, quitChallenge: quitChallenge, streakTreats: streakTreats, STREAK_TREATS_MAX: STREAK_TREATS_MAX, MEDAL_BONUS: MEDAL_BONUS, SPRINT_SECONDS: SPRINT_SECONDS, HORDE_MULT: HORDE_MULT, challengeOpen: challengeOpen, challengeOn: challengeOn, activeChallenge: activeChallenge, challengeGoalText: challengeGoalText, setNextChallenge: setNextChallenge, medalCount: medalCount, medalMult: medalMult, checkChallenge: checkChallenge, ROUTE_MAX: ROUTE_MAX, rebalanceLine: rebalanceLine, NIGHT_EASE: NIGHT_EASE, EDGE_GAIN: EDGE_GAIN, COUNTER_NIGHTS: COUNTER_NIGHTS, easeOn: easeOn, strikeReady: strikeReady, counterReady: counterReady, strike: strike, counterAttack: counterAttack, BOSS_PERKS_MAX: BOSS_PERKS_MAX, DEF_STREAK_STEP: DEF_STREAK_STEP, DEF_STREAK_MAX: DEF_STREAK_MAX, defStreakMult: defStreakMult, effectNow: effectNow, stepOrders: stepOrders, findRecord: findRecord, towerMult: towerMult, antennaCost: antennaCost, maxAntennas: maxAntennas, buyAntenna: buyAntenna, survivorRate: survivorRate, serumCost: serumCost, buySerum: buySerum, SERUM_COSTS: SERUM_COSTS, bridgeSafety: bridgeSafety, postCost: postCost, maxPosts: maxPosts, buyPost: buyPost, guardRate: guardRate, SAFETY_MAX: SAFETY_MAX, SAFE_NIGHT: SAFE_NIGHT, milestoneMult: milestoneMult, milestoneTier: milestoneTier, isTap: isTap, nextMilestone: nextMilestone, buildingCost: buildingCost, maxBuildings: maxBuildings, buyBuilding: buyBuilding,
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
