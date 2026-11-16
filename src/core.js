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
  // 2구역 거래
  var PRICE_STEP = 10;             // 시세가 바뀌는 간격(초)
  var PRICE_FLOOR = 0.5, PRICE_CEIL = 2;  // 기본 시세의 범위
  var GOODS_VALUE = 60;            // 상품 하나의 기준 값(물자)
  var GOODS_CAP_SECONDS = 60;      // 창고에 쌓아 둘 수 있는 양(좌판 생산의 초 수)
  var PEAK_PRICE = 1.8;            // '고점 판매'로 치는 시세
  // 3구역 생산 라인
  var PRODUCT_VALUE = 2e8;          // 완제품 하나의 기준 값(물자)
  var STEADY_AT = 0.9;             // 가동률이 이 이상이면 '정속 가동'
  var STEADY_BONUS = 0.5;          // 정속 가동일 때 라인 산출에 더하는 비율(+50%)
  var LINE_MILESTONES = [15, 30, 60, 100, 150, 220, 300, 400, 520, 660, 820, 1000]; // 기계 레벨 합계가 이 수에 닿을 때마다 라인 산출 2배
  // 4구역 노선
  var TRAIN_VALUE = 1e14;          // 열차 한 대가 운행 1초마다 싣는 화물의 기준 값(물자)
  var TRAIN_GROWTH = 1.4;          // 열차를 한 대 더 살 때마다 값이 오르는 배수
  var TRAIN_COST = 2e18;           // 첫 열차의 값
  var TRAIN_MAX = 100;             // 열차의 최대 수
  var ROUTE_GROWTH = 2.2;          // 노선을 한 단계 늘릴 때마다 값이 오르는 배수
  var ROUTE_SLOTS = 2;             // 노선 한 단계마다 다닐 수 있는 열차 수
  var ROUTE_MAX = 25;              // 노선의 최대 단계
  var FLEET_MILESTONES = [4, 8, 12, 16, 24, 32, 48, 64, 80, 100]; // 열차가 이 수에 닿을 때마다 화물 2배
  // 5구역 연구
  var STAFF_COST = 5e23;           // 첫 연구원의 값
  var STAFF_GROWTH = 1.25;         // 연구원을 한 명 더 뽑을 때마다 값이 오르는 배수
  var PROJECT_BASE = 60;           // 첫 연구 과제에 드는 연구 점수
  var PROJECT_GROWTH = 1.8;        // 과제를 하나 끝낼 때마다 다음 과제의 점수가 오르는 배수
  var OFFER_COUNT = 3;             // 한 번에 내미는 과제 수
  var REROLL_SHARE = 0.25;         // 과제를 다시 뽑는 데 드는 점수: 지금 과제 값의 이 비율
  var SUPPLY_DROP_SECONDS = 600;   // '보급 요청' 과제가 주는 물자: 생산 이만큼의 초치
  // 철수
  var RETREAT_MIN = 1e8;           // 이번 판에서 이만큼은 모아야 철수할 수 있다(2구역에 들어선 무렵)
  var RETREAT_K = 2, RETREAT_POW = 0.4;  // 항체 = K × (이번 판 누적 물자 ÷ RETREAT_MIN)^POW. 물자를 100배 더 모으면 항체는 6배쯤

  /* ---------- 정의표 ---------- */
  /*
   * 구역: kind 가 그 구역에서 하는 일. 'soon' 은 아직 만들지 않은 구역(문 앞까지만 갈 수 있다).
   *   cost  : 그 구역의 문을 여는 데 드는 물자
   *   story : 그 구역에 들어설 때, 목표 둘을 채웠을 때, 목표를 모두 채웠을 때 열리는 일지 3편
   */
  var ZONES = [
    { no: 1, name: '주택가', kind: 'search', cost: 0, lead: '잔해를 뒤지고 사람을 모은다',
      story: ['사태 12일째. 무전기에서 같은 말이 반복된다. “여기는 7구역. 생존자는 7구역으로 오라.” 우리는 아직 1구역에 있다.',
        '옆집 지붕에 누군가 페인트로 숫자를 남겼다. 7, 그리고 화살표.',
        '이 동네의 통조림은 바닥을 보인다. 골목 끝, 셔터 내린 시장이 다음이다. 여기는 남겨 두고 간다. 돌아올 사람들을 위해서.'] },
    { no: 2, name: '재래시장', kind: 'trade', cost: 5e7, lead: '좌판을 열고 시세를 봐 가며 판다',
      story: ['2구역. 셔터 내린 시장 골목은 뒤질 곳투성이다. 좌판 위에 저울이 그대로 놓여 있다. 물건이 있으면 사람이 온다.',
        '생선 가게 냉동고 안에서 쪽지를 찾았다. “먼저 갑니다. 7구역에서 만나요. 3반 일동.”',
        '시장이 다시 시끄럽다. 그런데 밤마다 무리가 불어난다. 놈들도 강 쪽으로, 우리와 같은 방향으로 걷고 있다.'] },
    { no: 3, name: '공단', kind: 'line', cost: 1e12, lead: '멈춘 공장의 기계 셋을 맞물려 돌린다',
      story: ['3구역. 공단의 철문은 안쪽에서 잠겨 있었다. 문을 뜯고 들어가니 기계들이 멈춘 자리 그대로 서 있다. 컨베이어 위에는 만들다 만 것들이 줄지어 있다.',
        '작업 일지의 마지막 장. “야간조 전원 7구역으로 이동. 설비는 두고 간다. 돌릴 줄 아는 사람이 오면 쓰라.”',
        '라인이 돈다. 밤에도 공단에 불이 켜진다. 불빛을 보고 사람이 오고, 소리를 듣고 무리가 온다. 선로를 따라가면 환승역이다.'] },
    { no: 4, name: '환승역', kind: 'rail', cost: 1e19, lead: '끊긴 노선을 잇고 열차를 보낸다',
      story: ['4구역. 환승역 계단 아래로 선로가 네 갈래로 갈라진다. 전광판 하나가 아직 켜져 있다. 행선지: 7구역. 승강장에 열차 한 대가 문을 연 채 서 있다.',
        '역무실 칠판에 분필 글씨가 남아 있다. “막차는 7구역행. 못 탄 사람은 선로를 따라 걸을 것. 터널 안에서는 소리 내지 말 것.”',
        '열차가 다시 다닌다. 멀리 간 열차일수록 많이 싣고 돌아온다. 심야 급행의 기관사가 말했다. 강 건너 병원 옥상에 아직 불이 켜져 있다고.'] },
    { no: 5, name: '대학 병원', kind: 'lab', cost: 1e24, lead: '남은 연구를 이어 가며 과제를 고른다',
      story: ['5구역. 응급실 문의 쇠사슬을 끊었다. 복도에 비상등이 깜박인다. 안내판의 화살표는 한 곳을 가리킨다. 감염내과, 7층. 연구실 냉장고는 아직 돌아가고 있다.',
        '실험 노트의 마지막 쪽. “샘플 114번에서 반응. 양이 모자란다. 사람이 더 필요하다. 살아서 여기까지 온 사람들의 피가.” 날짜는 사태 9일째다.',
        '연구가 다시 굴러간다. 우리가 들고 다니던 냉장 상자가 무엇이었는지 이제 안다. 옥상에서 보면 강 건너 검문소의 탐조등이 아직 돈다. 그 너머가 7구역이다.'] },
    { no: 6, name: '강변 검문소', kind: 'soon', cost: 1e31, lead: '다리를 지키며 밀려오는 무리를 막는다',
      story: ['다리 입구의 검문소에 닿았다. 차단기는 내려가 있고 초소는 비었다. 다리 위에는 버려진 차들이 끝까지 늘어서 있다. 건너편 어둠 속에서 무언가 움직인다.'] },
    { no: 7, name: '송신탑', kind: 'soon', cost: 1e30, lead: '', story: [] }
  ];

  // 1구역의 시설: 가만히 있어도 물자를 만든다
  var BUILDINGS = [
    { id: 'scouts',   name: '잔해 수색조', desc: '폐허를 뒤져 물자를 가져온다', baseCost: 15,    baseRate: 0.5 },
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
    { id: 'broker',  zone: 1, name: '거간꾼',    desc: '자동 판매가 평균 시세 이상일 때만 판다(창고가 차면 그냥 판다)', key: 'broker', per: 1, baseCost: 5e6, growth: 1, max: 1 }
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
    { id: 'legacy',  name: '기록 보관', desc: '철수로 얻는 항체 샘플 +10%', key: 'antibody', per: 0.1, baseCost: 4, growth: 1.6,  max: 20 }
  ];

  /*
   * 구역 목표: 구역마다 셋. 달성할 때마다 특전을 하나 고르고, 셋을 모두 채워야 다음 구역의 문을 열 수 있다.
   *   value(state) 가 need 이상이면 달성. text 는 화면에 보일 문장.
   */
  var GOALS = [
    [ { id: 'z1a', text: '잔해 수색조 50곳', need: 50, value: function (s) { return s.buildings.scouts; } },
      { id: 'z1b', text: '1구역 시설 합계 200곳', need: 200, value: function (s) { return totalBuildings(s); } },
      { id: 'z1c', text: '밤 30번 막아내기', need: 30, value: function (s) { return s.wavesCleared; } } ],
    [ { id: 'z2a', text: '좌판 50곳', need: 50, value: function (s) { return s.stalls; } },
      { id: 'z2b', text: '시세 ' + PEAK_PRICE + ' 이상에서 10번 팔기', need: 10, value: function (s) { return s.peakSales; } },
      { id: 'z2c', text: '상품 판매 누적 1,000억', need: 1e11, value: function (s) { return s.tradeEarned; } } ],
    [ { id: 'z3a', text: '기계 레벨 합계 120', need: 120, value: function (s) { return machineLevels(s); } },
      { id: 'z3b', text: '정속 가동 누적 10분', need: 600, unit: 'time', value: function (s) { return s.steadySeconds; } },
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
      // 2구역 거래
      stalls: 0, goods: 0, price: 1, priceClock: 0, autoSell: true, tradeEarned: 0, peakSales: 0,
      // 3구역 생산 라인
      machines: {}, lineEarned: 0, steadySeconds: 0,
      // 4구역 노선: routes 노선 단계, routeClock 이번 운행이 지난 시간(초), routeLoad 이번 운행에 실린 화물(열차 × 초)
      trains: 0, routes: {}, routeClock: {}, routeLoad: {}, railEarned: 0, expressRuns: 0,
      // 5구역 연구: staff 연구원, points 모인 연구 점수, research 과제별 끝낸 횟수, offers 지금 고를 수 있는 과제, projectsDone 끝낸 과제 수
      staff: 0, points: 0, research: {}, offers: [], projectsDone: 0,
      // 밤
      day: 1, dayClock: 0, wavesCleared: 0, breaches: 0, siege: false,
      // 구조 신호
      signalIn: SIGNAL_FIRST, signalLeft: 0, signalsAnswered: 0, buff: null,
      // 특전(이번 판)
      perks: {}, pendingPerks: [], goalsDone: {},
      // 영구
      antibodies: 0,         // 쓰지 않은 항체 샘플
      antibodyTotal: 0,      // 지금까지 얻은 항체 샘플
      traits: {},
      retreats: 0,           // 철수한 횟수
      bestZone: 0,           // 가장 멀리 갔던 구역
      story: {},
      startedAt: safeNum(now, 0), playSeconds: 0, awaySeconds: 0, runSeconds: 0,
      runLog: [],            // 지난 판들 [{ zone, seconds, antibodies }] (최근 10판)
      lastSeen: safeNum(now, 0)
    };
    BUILDINGS.forEach(function (b) { s.buildings[b.id] = 0; });
    DEFENSES.forEach(function (d) { s.defenses[d.id] = 0; });
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
    ['clicks', 'stalls', 'trains', 'expressRuns', 'staff', 'projectsDone', 'peakSales', 'wavesCleared', 'breaches', 'signalsAnswered', 'antibodies', 'antibodyTotal', 'retreats'].forEach(function (k) { s[k] = safeCount(raw[k]); });
    s.zone = clamp(safeCount(raw.zone), 0, ZONES.length - 1);
    while (s.zone > 0 && ZONES[s.zone].kind === 'soon') s.zone--;     // 아직 없는 구역에 들어가 있을 수는 없다
    s.bestZone = clamp(Math.max(safeCount(raw.bestZone), s.zone), 0, ZONES.length - 1);
    s.gate = !!raw.gate;
    s.stalls = Math.min(s.stalls, COUNT_MAX);
    s.day = Math.max(1, safeCount(raw.day));
    s.dayClock = clamp(safeNum(raw.dayClock, 0), 0, DAY_SECONDS);
    s.siege = !!raw.siege;
    s.autoSell = raw.autoSell !== false;
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
    s.staff = Math.min(s.staff, COUNT_MAX);
    s.research = counts(PROJECTS, raw.research, 200);
    s.offers = [];
    (Array.isArray(raw.offers) ? raw.offers : []).forEach(function (id) { if (findById(PROJECTS, id) && s.offers.indexOf(id) < 0 && s.offers.length < OFFER_COUNT) s.offers.push(id); });
    s.trains = Math.min(s.trains, TRAIN_MAX);
    s.routes = counts(ROUTES, raw.routes, ROUTE_MAX);
    ROUTES.forEach(function (d) {
      var rc = raw.routeClock && typeof raw.routeClock === 'object' ? raw.routeClock[d.id] : 0, rl = raw.routeLoad && typeof raw.routeLoad === 'object' ? raw.routeLoad[d.id] : 0;
      s.routeClock[d.id] = clamp(safeNum(rc, 0), 0, d.seconds);
      s.routeLoad[d.id] = clamp(safeNum(rl, 0), 0, TRAIN_MAX * d.seconds);      // 한 번의 운행에 실릴 수 있는 양을 넘지 않는다
    });
    s.upgrades = counts(UPGRADES, raw.upgrades, function (u) { return u.max; });
    s.perks = counts(PERKS, raw.perks, 999);
    s.traits = counts(TRAITS, raw.traits, function (t) { return t.max; });
    s.pendingPerks = (Array.isArray(raw.pendingPerks) ? raw.pendingPerks : []).filter(function (id) { return !!findById(PERKS, id); }).slice(0, PERK_CHOICES);
    var gd = raw.goalsDone && typeof raw.goalsDone === 'object' ? raw.goalsDone : {};
    GOALS.forEach(function (list) { list.forEach(function (g) { if (gd[g.id]) s.goalsDone[g.id] = true; }); });
    var st = raw.story && typeof raw.story === 'object' ? raw.story : {};
    BEATS.forEach(function (b) { if (st[b.id]) s.story[b.id] = true; });
    // 예전에는 '문 앞'까지만 갈 수 있던 구역이 그 뒤 버전에서 열린 경우: 문값은 이미 치렀으므로 들여보낸다.
    if (s.gate && s.zone + 1 < ZONES.length && ZONES[s.zone + 1].kind !== 'soon') {
      s.zone++; s.gate = false; s.bestZone = Math.max(s.bestZone, s.zone);
      delete s.story['z' + ZONES[s.zone].no + '-0'];      // 그때 읽은 것은 '문 앞' 글이다. 들어설 때의 일지는 새로 보여 준다.
    }
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
   *   offline 자리 비움 효율에 더하는 값, antibody 철수 항체 배수, start 선발대 레벨, broker 거간꾼 여부,
   *   lab 연구 속도, labcost 과제에 드는 점수, staffcost 연구원 값,
   *   z4 화물 값, trip 운행 시간, routecost 노선 값, traincost 열차 값,
   *   z3 완제품 값, z3cost 기계 값, steady 정속 가동 보너스에 더하는 값, slack 정속 가동 기준을 낮추는 값
   */
  function mods(state) {
    var m = { prod: 1, z1: 1, z2: 1, z3: 1, z4: 1, lab: 1, labcost: 1, staffcost: 1, trip: 1, routecost: 1, traincost: 1, click: 1, defense: 1, loot: 1, cost: 1, z1cost: 1, z3cost: 1, floor: 0, ceil: 0, cap: 1, offline: 0, antibody: 1, start: 0, broker: 0, steady: 0, slack: 0 };
    var ADD = { floor: 1, ceil: 1, offline: 1, start: 1, broker: 1, steady: 1, slack: 1 };      // 더하는 항목. 나머지는 (1 + 레벨 × per) 을 곱한다
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
    // 연구 과제: 끝낸 횟수만큼 곱으로 쌓인다
    if (state.research) PROJECTS.forEach(function (d) { var lv = state.research[d.id] || 0; if (lv && d.key !== 'drop') m[d.key] *= Math.pow(d.mult, lv); });
    m.labcost = Math.max(0.3, m.labcost); m.staffcost = Math.max(0.2, m.staffcost);
    m.cost = Math.max(0.2, m.cost);
    m.z1cost = Math.max(0.2, m.z1cost);
    m.z3cost = Math.max(0.2, m.z3cost);
    m.routecost = Math.max(0.2, m.routecost); m.traincost = Math.max(0.2, m.traincost);
    m.trip = Math.max(0.5, m.trip);        // 운행 시간은 절반 아래로 줄지 않는다
    return m;
  }
  /** 전체 생산 배수: 특성·특전 × 막아낸 밤 보너스 × 지원 효과. */
  function globalMult(state) {
    return mods(state).prod * (1 + WAVE_BONUS * state.wavesCleared) * (state.buff ? state.buff.mult : 1);
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
  function priceRange(state) {
    var m = mods(state), floor = PRICE_FLOOR + m.floor, ceil = PRICE_CEIL + m.ceil;
    return { floor: Math.min(floor, ceil), ceil: ceil, mean: (Math.min(floor, ceil) + ceil) / 2 };
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
  function goodsCap(state) { return goodsRate(state) * GOODS_CAP_SECONDS * mods(state).cap; }
  /** 상품 하나를 시세 1 에 팔았을 때의 물자. */
  function goodsValue(state) { return GOODS_VALUE * mods(state).z2 * globalMult(state); }
  /** 가진 상품을 지금 시세에 모두 판다. */
  function sellGoods(state) {
    if (!zoneOpen(state, 1)) return fail('locked');
    if (!(state.goods > 0)) return fail('empty');
    var gain = state.goods * state.price * goodsValue(state), price = state.price;
    earn(state, gain);
    state.tradeEarned += gain;
    if (price >= PEAK_PRICE) state.peakSales++;
    state.goods = 0;
    return { ok: true, gain: gain, price: price, peak: price >= PEAK_PRICE };
  }
  function setAutoSell(state, on) { state.autoSell = !!on; return { ok: true, on: state.autoSell }; }
  /** 2구역이 가만히 둘 때 초당 버는 물자(평균 시세 기준). 화면의 '초당' 표시와 자리 비움 계산에 쓴다. */
  function tradeRate(state) { return goodsRate(state) * goodsValue(state) * priceRange(state).mean; }
  function stepTrade(state, dt, rng, events) {
    if (!zoneOpen(state, 1)) return;
    state.priceClock += dt;
    while (state.priceClock >= PRICE_STEP) {
      state.priceClock -= PRICE_STEP;
      var r = priceRange(state);
      state.price = Math.round((r.floor + rng() * (r.ceil - r.floor)) * 100) / 100;
    }
    var cap = goodsCap(state);
    state.goods = Math.min(cap, state.goods + goodsRate(state) * dt);
    if (!state.autoSell || !(state.goods > 0)) return;
    // 자동 판매: 창고가 차면 판다. 거간꾼이 있으면 평균 시세 이상일 때 미리 팔고, 차기 전의 낮은 시세는 기다린다.
    var full = state.goods >= cap, good = mods(state).broker > 0 && state.price >= priceRange(state).mean && state.goods >= cap * 0.25;
    if (full || good) { var sold = sellGoods(state); if (sold.ok) { sold.type = 'sold'; sold.auto = true; events.push(sold); } }
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
  function scavenge(state) { var g = clickValue(state); earn(state, g); state.clicks++; return { ok: true, gain: g }; }

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
    state.bestZone = Math.max(state.bestZone, n.index);
    return { ok: true, soon: false, index: n.index, zone: n.zone };
  }

  /* ---------- 밤과 방벽 ---------- */
  function defenseCost(state, id, qty) {
    var def = findById(DEFENSES, id);
    return def ? seriesCost(def.baseCost * mods(state).cost, DEFENSE_GROWTH, state.defenses[id], qty) : Infinity;
  }
  function maxDefenses(state, id) {
    var def = findById(DEFENSES, id);
    return def ? seriesMax(def.baseCost * mods(state).cost, DEFENSE_GROWTH, state.defenses[id], state.supplies, 1e6) : 0;
  }
  function buyDefense(state, id, qty) {
    qty = Math.floor(qty);
    if (!findById(DEFENSES, id) || !(qty >= 1)) return fail('unknown');
    return pay(state, defenseCost(state, id, qty), function () { state.defenses[id] += qty; });
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
  function nightStrength(state) { return strengthAt(state, currentWave(state)); }
  function nightReward(state) {
    var w = currentWave(state);
    return Math.max(25 * w, productionPerSec(state) * NIGHT_REWARD_SECONDS) * mods(state).loot * (isBossWave(w) ? BOSS_REWARD : 1);
  }
  /** 오늘 밤을 막는 데 가장 싼 보강 { cost, picks: [{ id, qty }], enough }. 이미 막을 수 있으면 cost 0. */
  function defensePlan(state) {
    var tmp = { supplies: Infinity, defenses: {}, upgrades: state.upgrades, perks: state.perks, traits: state.traits, research: state.research, zone: state.zone };   // defensePower 가 읽는 것만 담는다(연구 과제 '방어 교범' 포함)
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
  function resolveNight(state) {
    var w = currentWave(state), strength = nightStrength(state), defense = defensePower(state), boss = isBossWave(w);
    state.day++;
    if (defense >= strength) {
      var reward = nightReward(state);
      earn(state, reward);
      state.wavesCleared++;
      state.siege = false;
      return { type: 'defended', wave: w, strength: strength, defense: defense, reward: reward, boss: boss };
    }
    if (state.siege) return { type: 'held', wave: w, strength: strength, defense: defense, boss: boss };
    var lost = state.supplies * BREACH_LOSS;
    state.supplies -= lost;
    state.breaches++;
    state.siege = true;
    return { type: 'breached', wave: w, strength: strength, defense: defense, lost: lost, boss: boss };
  }

  /* ---------- 구조 신호 ---------- */
  function answerSignal(state, rng) {
    if (!(state.signalLeft > 0)) return fail('none');
    rng = typeof rng === 'function' ? rng : Math.random;
    state.signalLeft = 0;
    state.signalsAnswered++;
    if (rng() < 0.5) {
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
  function choosePerk(state, id) {
    if (state.pendingPerks.indexOf(id) < 0) return fail('unknown');
    state.perks[id]++;
    state.pendingPerks = [];
    return { ok: true, id: id, level: state.perks[id] };
  }

  /* ---------- 철수와 영구 특성 ---------- */
  /** 지금 철수하면 얻는 항체 샘플 수. 이번 판에서 RETREAT_MIN 이상 모아야 1개 이상이 된다. */
  function antibodiesOnRetreat(state) {
    if (state.runEarned < RETREAT_MIN) return 0;
    return Math.floor(RETREAT_K * Math.pow(state.runEarned / RETREAT_MIN, RETREAT_POW) * mods(state).antibody);
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
    next.bestZone = Math.max(state.bestZone, state.zone);
    next.story = state.story;
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
  var BEATS = [];
  ZONES.forEach(function (z, zi) {
    z.story.forEach(function (text, k) {
      // 아직 없는 구역의 글은 '문 앞'(gate-번호)이다. 나중에 그 구역이 열려도 들어설 때의 일지(z번호-0)와 겹치지 않는다.
      BEATS.push({ id: (z.kind === 'soon' ? 'gate-' + z.no : 'z' + z.no + '-' + k), zone: z.no, zoneName: z.name, text: text, when: function (s) {
        if (ZONES[zi].kind === 'soon') return s.gate && s.zone === zi - 1;          // 아직 없는 구역: 문 앞에 닿았을 때
        if (s.zone < zi) return false;
        var done = (GOALS[zi] || []).filter(function (g) { return !!s.goalsDone[g.id]; }).length;
        return k === 0 || (k === 1 && done >= 2) || (k === 2 && done >= 3);
      } });
    });
  });
  BEATS.push({ id: 'retreat-1', zone: 1, zoneName: '주택가', text: '거점을 버렸다. 등 뒤에서 방벽이 무너지는 소리가 났다. 손에 남은 것은 냉장 상자 하나, 그 안의 혈액 샘플뿐이다. 다시 1구역이다. 하지만 이번에는 무엇을 먼저 해야 하는지 안다.',
    when: function (s) { return s.retreats >= 1; } });
  function checkStory(state, events) {
    BEATS.forEach(function (b) {
      if (state.story[b.id]) return;
      var hit = false;
      try { hit = !!b.when(state); } catch (e) { hit = false; }
      if (!hit) return;
      state.story[b.id] = true;
      events.push({ type: 'story', id: b.id, zone: b.zone, zoneName: b.zoneName, text: b.text });
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
    if (line > 0) { earn(state, line); state.lineEarned += line; if (lineInfo(state).steady) state.steadySeconds += dt; }

    stepTrade(state, dt, rng, events);
    stepRail(state, dt, events);
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
    var report = { elapsed: elapsed, counted: counted, capped: elapsed > OFFLINE_CAP, rate: rate, gain: 0, nights: 0, nightReward: 0, held: false, trains: 0, points: 0 };
    if (!(counted > 0)) return report;
    state.buff = null;
    state.signalLeft = 0;
    var trade = tradeRate(state) * counted * rate, line = lineRate(state) * counted * rate;
    report.gain = searchRate(state) * counted * rate + trade + line;
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
      report.nights++; report.nightReward += ev.reward;
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
      runs: state.runLog.slice().reverse() };
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
  function formatNumber(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '0';
    var sign = n < 0 ? '-' : '';
    n = Math.abs(n);
    if (n < 100) return sign + String(Math.floor(n * 10 + 1e-9) / 10);
    if (n < 1e4) return sign + Math.floor(n).toLocaleString('en-US');
    var v = n, k = 0;
    while (v >= 1e4 && k < UNITS.length) { v /= 1e4; k++; }
    if (v >= 1e4) return sign + n.toExponential(2);
    var digits = v < 10 ? 2 : v < 100 ? 1 : 0, p = Math.pow(10, digits);
    return sign + (digits ? (Math.floor(v * p + 1e-9) / p).toFixed(digits) : Math.floor(v).toLocaleString('en-US')) + UNITS[k - 1];
  }

  return {
    SAVE_VERSION: SAVE_VERSION, DAY_SECONDS: DAY_SECONDS, BATTLE_SECONDS: BATTLE_SECONDS, GROWTH: GROWTH, DEFENSE_GROWTH: DEFENSE_GROWTH,
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
    PRICE_STEP: PRICE_STEP, PRICE_FLOOR: PRICE_FLOOR, PRICE_CEIL: PRICE_CEIL, GOODS_VALUE: GOODS_VALUE, GOODS_CAP_SECONDS: GOODS_CAP_SECONDS, PEAK_PRICE: PEAK_PRICE,
    RETREAT_MIN: RETREAT_MIN, RETREAT_K: RETREAT_K, RETREAT_POW: RETREAT_POW,
    ZONES: ZONES, BUILDINGS: BUILDINGS, DEFENSES: DEFENSES, UPGRADES: UPGRADES, PERKS: PERKS, TRAITS: TRAITS, GOALS: GOALS, BEATS: BEATS,
    createState: createState, sanitizeState: sanitizeState, mods: mods, globalMult: globalMult,
    totalBuildings: totalBuildings, milestoneMult: milestoneMult, buildingCost: buildingCost, maxBuildings: maxBuildings, buyBuilding: buyBuilding,
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
