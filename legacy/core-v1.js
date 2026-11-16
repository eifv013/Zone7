/*
 * GameCore — "7구역" 순수 게임 로직 모듈
 * ------------------------------------------------------------
 * DOM, 타이머, 저장소를 전혀 모른다. 상태(state) 객체와 숫자만 다룬다.
 * 덕분에 브라우저(window.GameCore)와 Node(require) 양쪽에서 같은 코드로
 * 실행되고, core.test.js 가 화면 없이 규칙 전체를 검증할 수 있다.
 *
 * 흐름: createState → (tick | scavenge | buy* | startExpedition | answerSignal) 반복 → serialize
 *
 * 보너스가 모이는 곳은 mods() 하나다. 연구·유물이 주는 배수는 전부 거기서 합쳐지고
 * 생산·방어·원정 계산은 그 결과만 읽는다. 새 콘텐츠를 넣을 때는 정의 표에 한 줄을
 * 더하면 되고 계산식은 건드리지 않는다.
 *
 * 무작위가 필요한 함수는 rng(0 이상 1 미만을 돌려주는 함수)를 인자로 받는다.
 * 생략하면 Math.random 을 쓰고, 테스트는 고정값을 넣어 결과를 확정한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GameCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 밸런스 상수 ---------- */
  var SAVE_VERSION = 1;            // 새 필드는 기본값으로 채워지므로 버전을 올리지 않는다
  var DAY_SECONDS = 60;            // 현실 60초 = 게임 속 하루
  var BATTLE_SECONDS = 10;         // 하루의 마지막 이만큼은 무리가 도착해 방벽에서 싸우는 시간. 승패는 이 시간이 끝날 때 정해진다
  var BUILD_GROWTH = 1.15;         // 시설 가격 증가율
  var BUILDING_MAX = 500;          // 시설 한 종류의 최대 보유 수(자동 플레이의 최대치가 약 365곳이라 평소 진행을 막지 않는다)
  var DEFENSE_GROWTH = 1.2;        // 방벽 가격 증가율
  var BASE_DEFENSE = 5;            // 아무것도 없어도 있는 맨손 바리케이드
  var BREACH_LOSS = 0.15;          // 방벽이 뚫리면 잃는 물자 비율(기본)
  var WAVE_BONUS = 0.02;           // 막아낸 밤 1회당 생산 보너스
  var ANTIBODY_BONUS = 0.1;        // 항체 샘플 1개당 생산 보너스
  var ANTIBODY_GROWTH = 1.1;       // 요구량만 딱 채우고 이주하면 항체 효과(생산 배수)가 이만큼 곱해진다
  var ACH_BONUS = 0.02;            // 업적 1개당 생산 보너스
  var OFFLINE_CAP = 4 * 3600;      // 자리 비움 보상 기본 최대 4시간(과제 보상으로 늘릴 수 있다)
  var OFFLINE_CAP_STEP = 600;      // 과제 보상 1회당 늘어나는 시간(10분)
  var OFFLINE_CAP_BONUS_MAX = 8 * 3600; // 과제로 늘릴 수 있는 한도(+8시간 → 최대 12시간)
  var OFFLINE_RATE_STEP = 0.01;    // 과제 보상 1회당 늘어나는 효율(1%p)
  var OFFLINE_RATE_BONUS_MAX = 0.3;// 과제로 늘릴 수 있는 효율 한도(+30%p)
  var MEDAL_BONUS = 0.01;          // 과제 훈장 1개당 생산 보너스
  var QUEST_BUFF = { mult: 2, seconds: 300 }; // 과제 보상 '증산 명령': 5분간 생산 2배
  var OFFLINE_RATE = 0.5;          // 자리 비움 중 생산 효율(기본)
  var RELOCATE_UNIT = 1e6;         // 항체 샘플 1개에 필요한 누적 물자 기준
  var MILESTONES = [10, 25, 50, 100, 150, 200]; // 보유 수 달성 시 해당 시설 생산 2배
  var MAX_NIGHTS_PER_TICK = 10000; // 비정상적으로 큰 dt 에 대한 루프 안전장치
  var BOSS_EVERY = 10;             // 10번째 밤마다 변이체가 무리를 이끈다
  var BOSS_STRENGTH = 2.5;         // 변이체 밤의 무리 규모 배수
  var BOSS_REWARD = 5;             // 변이체 밤의 전리품 배수
  var SIGNAL_FIRST = 120;          // 첫 구조 신호까지(초)
  var SIGNAL_MIN = 90;             // 다음 신호까지 최소 대기
  var SIGNAL_SPREAD = 90;          // 대기 시간의 무작위 폭
  var SIGNAL_WINDOW = 20;          // 신호에 응답할 수 있는 시간
  var SIGNAL_SUPPLY_SECONDS = 90;  // 신호 보상이 물자일 때: 지금 생산량의 몇 초치를 받는지
  var SIGNAL_SUPPLY_MIN = 50;      // 그 보상의 최소치(생산이 거의 없는 첫 거점에서도 받을 만하게)
  var BUFF_MULT = 3;               // 지원 물자 투하 시 생산 배수
  var BUFF_SECONDS = 30;
  var BOSS_ANTIBODY = 0.01;        // 변이체 처치 시 얻는 항체: 보유량의 1%(최소 1개)
  var GEAR_GROWTH = 1.6;           // 제작 레벨당 부품 가격 증가율
  var BUNDLE_GROWTH = 1.5;         // 상점 부품 꾸러미를 살 때마다 오르는 가격(지구를 옮기면 초기화)
  var MERC_BONUS = 1.5;            // 용병을 고용한 밤의 방어력 배수
  var EVENT_FIRST = 180;           // 첫 사건까지(초)
  var EVENT_MIN = 240;             // 사건 사이의 최소 간격(초)
  var EVENT_SPREAD = 240;          // 그 위에 무작위로 더해지는 간격(초): 4~8분마다 한 번
  var EVENT_WINDOW = 30;           // 사건에서 고를 수 있는 시간(초). 지나면 기본 선택으로 넘어간다(방치해도 손해가 없도록)
  var SURVIVORS_BASE = 0;          // 처음에는 혼자다. 생존자는 사건으로 받아들이거나 구역을 넘을 때 합류한다
  var RECRUIT_MAX = 6;             // 사건으로 받아들일 수 있는 생존자 수의 상한
  var JOB_STEP = 0.04;             // 배치한 생존자 한 명의 효과(4%)
  var CYCLE_BONUS = 0.5;           // 끝낸 회차 하나마다 전체 생산 +50%
  var CYCLE_THREAT = 0.5;          // 끝낸 회차 하나마다 무리 규모 +50%
  var CYCLE_REQUIRE = 2;           // 끝낸 회차 하나마다 이주 요구 물자 2배
  var CLICK_SHARE = 0.01;          // 직접 수색 한 번의 기본 몫: 초당 생산의 1%
  var SECTOR_LOG_MAX = 12;         // 통계에 남기는 '최근 지구' 기록 수
  var SECTORS = 26;                // 구역 하나는 A~Z 26개 지구로 나뉜다(1-A … 7-Z, 총 182곳)
  var STEP_THREAT = 1.04;          // 지구를 하나 넘어갈 때마다 무리 규모에 곱해지는 값
  var STEP_EARLY = 1.75;           // 초반(EARLY_STEPS 지구까지) 지구마다 이주 요구 물자에 곱해지는 값
  var EARLY_STEPS = 40;            // 초반 구간의 길이(지구 수): 1구역 전체와 2구역 절반
  var STEP_REQUIRE = 1.21;         // 그 뒤로 지구마다 이주 요구 물자에 곱해지는 값
  var STORY_SECTOR = [0, 12, 25];  // 구역마다 일지가 열리는 지구: A(도착), M(중간), Z(끝)
  var STORY_WAVES = [0, 3, 3];     // 그 지구에서 이만큼 밤을 막아내야 기록할 여유가 생긴다

  var BUILDINGS = [
    { id: 'scouts',   name: '잔해 수색조',   desc: '무너진 편의점을 뒤진다',         baseCost: 15,      baseRate: 0.5 },
    { id: 'garden',   name: '옥상 텃밭',     desc: '상추와 감자, 그리고 희망',       baseCost: 120,     baseRate: 4 },
    { id: 'purifier', name: '빗물 정수기',   desc: '깨끗한 물은 최고의 화폐',        baseCost: 1100,    baseRate: 22 },
    { id: 'workshop', name: '고철 작업장',   desc: '폐차를 부품으로 되살린다',       baseCost: 12000,   baseRate: 120 },
    { id: 'solar',    name: '태양광 발전기', desc: '밤에도 불이 켜지는 유일한 건물', baseCost: 130000,  baseRate: 650 },
    { id: 'radio',    name: '무전 중계소',   desc: '다른 생존자 무리와 거래한다',    baseCost: 1.4e6,   baseRate: 3600 },
    { id: 'bunker',   name: '지하 벙커 농장', desc: '지상이 어떻든 수확은 계속된다', baseCost: 2e7,     baseRate: 20000 },
    { id: 'lab',      name: '백신 연구실',   desc: '끝낼 방법을 찾는 사람들',        baseCost: 3.3e8,   baseRate: 120000 },
    { id: 'port',     name: '항만 교역소',   desc: '바다 건너에도 사람이 있었다',    baseCost: 5.1e9,   baseRate: 700000 },
    { id: 'district', name: '재건 구역',     desc: '가로등이 다시 켜진 첫 번째 거리', baseCost: 7.5e10, baseRate: 4500000 }
  ];

  var DEFENSES = [
    { id: 'wire',   name: '철조망',        desc: '느리게 만들 뿐이지만 그걸로 충분하다', baseCost: 40,     power: 4 },
    { id: 'tower',  name: '감시탑',        desc: '먼저 보는 쪽이 살아남는다',           baseCost: 900,    power: 30 },
    { id: 'turret', name: '자동 포탑',     desc: '잠들지 않는 경계병',                 baseCost: 30000,  power: 260 },
    { id: 'flame',  name: '화염 방벽',     desc: '연료만 있으면 아무것도 못 넘는다',    baseCost: 1.2e6,  power: 2400 },
    { id: 'emp',    name: '전자기 울타리', desc: '연구실이 내놓은 첫 번째 성과',        baseCost: 6e7,    power: 25000 },
    { id: 'rail',   name: '레일건 포대',   desc: '발전소 하나를 통째로 먹는다',         baseCost: 3e9,    power: 260000 }
  ];

  /*
   * 구역 고유 시설·방벽: 그 구역(26개 지구)에 있는 동안에만 짓고 살 수 있다. zone 은 구역 순번(0~6).
   * 공통 시설·방벽과 같은 규칙(값이 오르는 방식, 10곳마다 2배, 최대 수)을 따르되,
   * 비슷한 값의 공통 시설보다 값 대비 효율이 1.5배쯤 좋다. 구역마다 끼어드는 가격대가 달라서
   * 무엇부터 지을지가 구역마다 달라진다. 다른 구역으로 넘어가면 지을 수 없고 가진 것도 사라진다.
   */
  var ZONE_BUILDINGS = [
    { id: 'z1kitchen', zone: 0, name: '공동 취사장',   desc: '골목 사람들이 솥 하나에 모인다',     baseCost: 500,   baseRate: 20 },
    { id: 'z2stall',   zone: 1, name: '좌판 거래소',   desc: '셔터를 올리자 흥정이 돌아왔다',      baseCost: 5000,  baseRate: 105 },
    { id: 'z3press',   zone: 2, name: '프레스 공장',   desc: '멈췄던 기계가 철판을 찍어 낸다',     baseCost: 5e5,   baseRate: 2600 },
    { id: 'z4freight', zone: 3, name: '선로 화물차',   desc: '지하 선로로 짐을 실어 나른다',       baseCost: 6e6,   baseRate: 14000 },
    { id: 'z5pharma',  zone: 4, name: '병원 약제실',   desc: '약은 어디서나 값을 쳐 준다',         baseCost: 8e7,   baseRate: 72000 },
    { id: 'z6ferry',   zone: 5, name: '강변 나루터',   desc: '강을 오가는 배가 물자를 싣고 온다',  baseCost: 1.3e9, baseRate: 430000 },
    { id: 'z7relay',   zone: 6, name: '송신소 발전기', desc: '탑의 발전기를 거점으로 끌어온다',    baseCost: 1e12,  baseRate: 4e7 }
  ];
  var ZONE_DEFENSES = [
    { id: 'z1cars',    zone: 0, name: '폐차 바리케이드', desc: '골목 입구를 차로 틀어막는다',       baseCost: 250,    power: 16 },
    { id: 'z2shutter', zone: 1, name: '셔터 방벽',       desc: '가게 셔터를 떼어 이어 붙였다',      baseCost: 6000,   power: 120 },
    { id: 'z3steel',   zone: 2, name: '강철 담장',       desc: '공장 철판은 쉽게 휘지 않는다',      baseCost: 2e5,    power: 1100 },
    { id: 'z4gate',    zone: 3, name: '선로 차단문',     desc: '터널 하나만 막으면 된다',           baseCost: 8e6,    power: 9000 },
    { id: 'z5ward',    zone: 4, name: '격리 병동 문',    desc: '안에서 못 나오게 만든 문',          baseCost: 4e8,    power: 100000 },
    { id: 'z6block',   zone: 5, name: '검문 차단벽',     desc: '다리 앞 콘크리트 벽을 다시 세웠다', baseCost: 1.5e10, power: 600000 },
    { id: 'z7grid',    zone: 6, name: '송신탑 전류망',   desc: '탑의 전력을 울타리로 돌린다',       baseCost: 1e11,   power: 3500000 }
  ];
  var ALL_BUILDINGS = BUILDINGS.concat(ZONE_BUILDINGS);
  var ALL_DEFENSES = DEFENSES.concat(ZONE_DEFENSES);

  /*
   * 생존자 배치: 생존자는 언제나 세 가지 일 중 하나를 맡는다(쉬는 사람은 없다).
   * 새로 온 생존자는 수색에 들어가고, 플레이어가 원하면 옮긴다. 옮기지 않아도 손해는 없다.
   */
  var JOBS = [
    { id: 'scavenge', name: '수색', desc: '한 명마다 전체 생산 +4%' },
    { id: 'guard',    name: '방어', desc: '한 명마다 방어력 +4%' },
    { id: 'study',    name: '연구', desc: '한 명마다 연구 값 -4% (최대 -60%)' }
  ];

  var UPGRADES = [
    { id: 'crowbar',  name: '쇠지렛대',   desc: '수색 배수 2배', cost: 100,   clickMult: 2 },
    { id: 'backpack', name: '군용 배낭',  desc: '수색 배수 3배', cost: 5000,  clickMult: 3 },
    { id: 'dog',      name: '수색견',     desc: '수색 배수 4배', cost: 5e5,   clickMult: 4 },
    { id: 'drone',    name: '정찰 드론',  desc: '수색 배수 5배', cost: 5e7,   clickMult: 5 }
  ];

  /*
   * 연구: 물자로 사고, 이주하면 사라진다. effect 키의 뜻은 mods() 참고.
   *   prod/defense/reward/expedReward : 곱해지는 배수
   *   expedTime : 원정 시간 배수,  breach/offline : 해당 비율을 이 값으로 교체
   */
  var RESEARCH = [
    { id: 'compost',  name: '퇴비 순환',   desc: '전체 생산 1.25배',              cost: 2000,  effect: { prod: 1.25 } },
    { id: 'drill',    name: '야간 훈련',   desc: '방어력 1.25배',                 cost: 3000,  effect: { defense: 1.25 } },
    { id: 'maps',     name: '구역 지도',   desc: '원정 시간 25% 단축',            cost: 8000,  effect: { expedTime: 0.75 } },
    { id: 'traps',    name: '함정 지대',   desc: '밤 방어 전리품 2배',            cost: 40000, effect: { reward: 2 } },
    { id: 'ration',   name: '분산 창고',   desc: '뚫릴 때 손실 15% → 8%',         cost: 60000, effect: { breach: 0.08 } },
    { id: 'grid',     name: '전력망',      desc: '전체 생산 1.5배',               cost: 5e5,   effect: { prod: 1.5 } },
    { id: 'alarm',    name: '조기 경보망', desc: '방어력 1.5배',                  cost: 8e5,   effect: { defense: 1.5 } },
    { id: 'shift',    name: '교대 근무',   desc: '자리 비움 효율 50% → 75%',      cost: 2e6,   effect: { offline: 0.75 } },
    { id: 'caravan',  name: '호송대',      desc: '원정 보상 2배',                 cost: 1e7,   effect: { expedReward: 2 } },
    { id: 'serum',    name: '혈청 배양',   desc: '전체 생산 2배',                 cost: 2e8,   effect: { prod: 2 } },
    { id: 'fortress', name: '요새화',      desc: '방어력 2배',                    cost: 5e8,   effect: { defense: 2 } }
  ];

  /*
   * 원정: 한 번에 한 곳. 시간이 지나면 자동으로 돌아와 보상을 준다.
   *   needWave    : 지금까지 막아낸 최고 기록(bestWave)이 이 값 이상이어야 열린다
   *   baseReward  : 최소 보상,  rateSeconds : 초당 생산의 몇 초치를 받는지
   *                 (걸리는 시간의 40~80% 수준. 원정은 생산의 보조이고 주 목적은 부품과 유물이다)
   *   parts       : 귀환 시 얻는 부품(구역 번호가 곱해진다)
   */
  var EXPEDITIONS = [
    { id: 'mart',     name: '동네 마트',       desc: '가깝지만 이미 여러 번 털렸다',     seconds: 90,   needWave: 0,  baseReward: 60,    rateSeconds: 36,  relicChance: 0.3, parts: 1 },
    { id: 'hospital', name: '시립 병원',       desc: '약품은 남아 있다. 환자들도.',      seconds: 300,  needWave: 5,  baseReward: 2500,  rateSeconds: 150,  relicChance: 0.3, parts: 4 },
    { id: 'armory',   name: '예비군 무기고',   desc: '자물쇠는 멀쩡하다는 소문',         seconds: 900,  needWave: 15, baseReward: 60000, rateSeconds: 540, relicChance: 0.3, parts: 14 },
    { id: 'dam',      name: '수력 발전소',     desc: '아직 돌아가는 터빈 소리가 들린다', seconds: 1800, needWave: 30, baseReward: 2e6,   rateSeconds: 1260, relicChance: 0.25, parts: 32 },
    { id: 'cdc',      name: '방역 본부 분소',  desc: '모든 것이 시작된 곳',              seconds: 3600, needWave: 50, baseReward: 5e7,   rateSeconds: 2880, relicChance: 0.25, parts: 70 }
  ];

  /*
   * 제작: 부품으로 만드는 영구 장비. 레벨마다 per 만큼 효과가 더해지고 이주해도 남는다.
   *   key : mods() 의 어느 보정치에 더할지,  max : 최대 레벨
   */
  var GEAR = [
    { id: 'tools',     name: '정비 공구',     desc: '레벨당 전체 생산 +10%',        baseCost: 3, key: 'prod',        per: 0.10, max: 30 },
    { id: 'barricade', name: '강화 바리케이드', desc: '레벨당 방어력 +10%',          baseCost: 3, key: 'defense',     per: 0.10, max: 30 },
    { id: 'pack',      name: '개조 배낭',     desc: '레벨당 수색 배수 +25%',        baseCost: 2, key: 'click',       per: 0.25, max: 30 },
    { id: 'cart',      name: '보급 수레',     desc: '레벨당 원정 보상 +5%',         baseCost: 4, key: 'expedReward', per: 0.05, max: 30 },
    { id: 'filter',    name: '혈청 필터',     desc: '레벨당 이주 시 항체 샘플 +0.5%', baseCost: 6, key: 'antibody',   per: 0.005, max: 20 },
    { id: 'antenna',   name: '지향성 안테나', desc: '레벨당 구조 신호 대기 -5%',    baseCost: 5, key: 'signal',      per: -0.05, max: 10 },
    // 아래 둘은 수치가 아니라 자동화 스위치다(flag). 방치해도 게임이 굴러가게 하는 장비.
    { id: 'operator',  name: '무전병 배치',   desc: '구조 신호에 알아서 응답한다',  baseCost: 10, flag: 'autoSignal',  max: 1 },
    { id: 'warden',    name: '방벽 담당',     desc: '방어력이 모자라면 방벽을 알아서 보강한다', baseCost: 16, flag: 'autoFortify', max: 1 },
    { id: 'builder',   name: '건설 담당',     desc: '물자가 모이면 시설을 알아서 짓는다',       baseCost: 24, flag: 'autoBuild',   max: 1 }
  ];
  var AUTO_BUILD_PER_TICK = 25;    // 자동 건설이 한 번에 짓는 최대 수(한꺼번에 수백 채를 사며 멈칫하지 않게)

  /*
   * 이주 특전: 이주할 때마다 3장이 나오고 그중 1장을 고른다. 영구히 쌓인다(같은 특전을 또 고르면 레벨이 오른다).
   * 구역 경계를 넘는 이주(1-Z → 2-A 등)에서는 고른 특전이 한 번에 3레벨 오른다.
   *   key : mods() 의 어느 값에 더할지,  per : 레벨당 변화량,  max : 최대 레벨
   *   곱셈형(prod, defense …)은 1 + per × 레벨 을 곱하고, 가격형(buildCost, defenseCost)은 하한 0.4 가 있다.
   *   startScouts 는 새 지구에 도착할 때 받는 시설 수, offlineAdd 는 자리 비움 효율에 더해지는 값이다.
   */
  var PERKS = [
    { id: 'harvest', name: '풍작',        desc: '전체 생산 +6%',                     key: 'prod',          per: 0.06,  max: 60 },
    { id: 'watch',   name: '야간 경계',   desc: '방어력 +8%',                        key: 'defense',       per: 0.08,  max: 60 },
    { id: 'crew',    name: '숙련 일꾼',   desc: '시설 가격 -2%',                     key: 'buildCost',     per: -0.02, max: 20 },
    { id: 'mason',   name: '석공',        desc: '방벽 가격 -3%',                     key: 'defenseCost',   per: -0.03, max: 15 },
    { id: 'hands',   name: '빠른 손',     desc: '수색 배수 +20%',                    key: 'click',         per: 0.2,   max: 60 },
    { id: 'loot',    name: '전리품 분배', desc: '밤 방어 전리품 +15%',               key: 'reward',        per: 0.15,  max: 40 },
    { id: 'route',   name: '지름길',      desc: '원정 시간 -3%',                     key: 'expedTime',     per: -0.03, max: 15 },
    { id: 'salvage', name: '고철 회수',   desc: '부품 획득 +10%',                    key: 'parts',         per: 0.1,   max: 30 },
    { id: 'culture', name: '배양 기술',   desc: '이주 시 항체 샘플 +0.5%',           key: 'antibody',      per: 0.005, max: 20 },
    { id: 'shifts',  name: '불침번',      desc: '자리 비움 생산 효율 +2%p',          key: 'offlineAdd',    per: 0.02,  max: 10 },
    { id: 'pioneer', name: '선발 시설',   desc: '새 지구를 잔해 수색조 4곳과 함께 시작',   key: 'startScouts',   per: 4,     max: 10 }
  ];
  var PERK_CHOICES = 3;   // 한 번에 나오는 특전 수
  var RARE_LEVELS = 3;    // 구역 경계를 넘을 때 고른 특전이 오르는 레벨

  /*
   * 지구별 과제: 지구마다 하나씩 주어진다. 안 해도 이주할 수 있지만, 떠나면 그 과제는 사라진다.
   * 달성하면 보상이 자동으로 들어온다(방치 중에도 받을 수 있게).
   *   goal : 목표 수치,  text : 화면 문구({n} 자리에 목표가 들어간다)
   * 진행도를 재는 방법은 questProgress() 에 있다.
   */
  var QUESTS = [
    { type: 'nights',   goal: 5,   text: '이 지구에서 밤 {n}번 막아내기' },
    { type: 'boss',     goal: 1,   text: '변이체 {n}마리 처치' },
    { type: 'exped',    goal: 3,   text: '원정 {n}회 완료' },
    { type: 'click',    goal: 120, text: '직접 수색 {n}회' },
    { type: 'build',    goal: 80,  text: '시설 합계 {n}곳 보유' },
    { type: 'research', goal: 4,   text: '연구 {n}개 완료' },
    { type: 'signal',   goal: 2,   text: '구조 신호에 {n}번 응답' },
    { type: 'defense',  goal: 3,   text: '방어력을 오늘 밤 무리 규모의 {n}배로' },
    { type: 'earn',     goal: 2,   text: '이주 요구 물자의 {n}배 모으기' },
    { type: 'craft',    goal: 1,   text: '장비 {n}번 제작' }
  ];
  /*
   * 과제 보상: 과제가 주어질 때 weight 비율로 하나가 정해진다. 실제 양은 받는 시점에 계산한다.
   * offlineCap / offlineRate 는 한도에 닿으면 더는 나오지 않는다.
   */
  var QUEST_REWARDS = [
    { kind: 'parts',       weight: 22, name: '부품' },
    { kind: 'supplies',    weight: 14, name: '보급 물자 (생산 10분치)' },
    { kind: 'buff',        weight: 12, name: '증산 명령 (5분간 생산 2배)' },
    { kind: 'antibody',    weight: 12, name: '항체 샘플 (보유량의 3%)' },
    { kind: 'medal',       weight: 12, name: '훈장 (생산 +1% 영구)' },
    { kind: 'perk',        weight: 8,  name: '이주 특전 1장 추가 선택' },
    { kind: 'offlineCap',  weight: 10, name: '자리 비움 보상 시간 +10분 영구' },
    { kind: 'offlineRate', weight: 10, name: '자리 비움 효율 +1%p 영구' }
  ];

  /*
   * 혈청: 항체 샘플로 사는 영구 강화. 이주해도 남는다.
   * 항체의 생산 보너스는 "지금까지 모은 총량"으로 계산하므로, 혈청에 써도 생산은 줄지 않는다
   * (써야 이득인지 고민하게 만드는 함정을 두지 않기 위함). 쓸 수 있는 양 = 총량 - 쓴 양.
   * 생산을 직접 올리는 혈청은 두지 않았다: 항체가 이미 생산을 올리고 있어 밸런스가 겹치기 때문이다.
   *   cost = baseCost × SERUM_GROWTH^레벨,  key/per/max 는 특전과 같은 뜻
   */
  var SERUMS = [
    { id: 'immune', name: '면역 혈청',   desc: '방어력 +15%',               baseCost: 3,  key: 'defense',      per: 0.15,  max: 30 },
    { id: 'calm',   name: '억제 혈청',   desc: '무리 규모 -3%',             baseCost: 8,  key: 'threat',       per: -0.03, max: 10 },
    { id: 'focus',  name: '각성 혈청',   desc: '수색 배수 +50%',            baseCost: 3,  key: 'click',        per: 0.5,   max: 30 },
    { id: 'sense',  name: '감각 혈청',   desc: '원정 시간 -4%',             baseCost: 5,  key: 'expedTime',    per: -0.04, max: 10 },
    { id: 'salv',   name: '회수 혈청',   desc: '부품 획득 +10%',            baseCost: 5,  key: 'parts',        per: 0.1,   max: 30 },
    { id: 'vigil',  name: '불면 혈청',   desc: '자리 비움 효율 +2%p',       baseCost: 6,  key: 'offlineAdd',   per: 0.02,  max: 10 },
    { id: 'endure', name: '지구력 혈청', desc: '자리 비움 보상 시간 +20분', baseCost: 6,  key: 'offlineCapAdd', per: 1200, max: 12 }
  ];
  var SERUM_GROWTH = 3;

  /* 상점: 물자로 사는 일회성 거래. 가격은 shopPrice() 가 현재 생산량에 맞춰 정한다. */
  var SHOP = [
    { id: 'bundle', name: '부품 꾸러미', desc: '부품을 바로 얻는다. 살수록 비싸지고 지구를 옮기면 원래 값으로 돌아온다' },
    { id: 'mercs',  name: '용병 고용',   desc: '오늘 밤 하루만 방어력 1.5배' },
    { id: 'recall', name: '긴급 귀환',   desc: '진행 중인 원정대를 즉시 불러들인다. 보상은 그대로' }
  ];

  /* 유물: 원정에서 확률로 발견. 이주해도 남는다. */
  var RELICS = [
    { id: 'handradio', site: 'mart',     name: '손잡이 라디오', desc: '전체 생산 +10%',       effect: { prod: 1.1 } },
    { id: 'medbag',    site: 'hospital', name: '군의관 가방',   desc: '뚫릴 때 손실 절반',    effect: { breachMult: 0.5 } },
    { id: 'rifle',     site: 'armory',   name: '저격 소총',     desc: '방어력 +25%',          effect: { defense: 1.25 } },
    { id: 'turbine',   site: 'dam',      name: '소형 터빈',     desc: '전체 생산 +50%',       effect: { prod: 1.5 } },
    { id: 'specimen',  site: 'cdc',      name: '0번 환자 표본', desc: '이주 시 항체 샘플 +10%', effect: { antibody: 1.1 } }
  ];

  /*
   * 구역: 이주할 때마다 한 지구씩 나아간다(1-A → 1-B → … → 1-Z → 2-A → … → 7-Z).
   * 7-Z 가 종착지이며 그 뒤의 이주는 7-Z 를 다시 세우는 것으로 취급한다.
   *   effect : 그 구역(26개 지구 전체)에 있는 동안 적용되는 특성(mods 참고)
   *   story  : A·M·Z 지구에서 하나씩 열리는 일지 3편
   *   horde  : 그 구역 무리의 성격. 밤의 규칙을 조금씩 바꾼다(없는 키는 1배 = 변화 없음).
   *            strength 규모 배수, reward 전리품 배수, parts 밤 부품 배수,
   *            surgeEvery/surge 몇 번째 밤마다 규모와 전리품이 몇 배가 되는지(변이체 밤 제외),
   *            boss/bossReward 변이체의 규모·전리품에 더 곱해지는 값, breach 뚫릴 때 손실 배수,
   *            bossAntibody 변이체 처치 시 항체 샘플 배수
   *            규모가 커지는 성격에는 그만큼의 보상이 붙는다: 까다롭지만 손해는 아니게.
   */
  var ZONES = [
    { no: 1, name: '주택가', trait: '익숙한 동네. 특별한 것은 없다', effect: {},
      horde: { id: 'walker', name: '배회자', desc: '느리고 흩어져 있다. 특별한 것은 없다' }, story: [
      '사태 12일째. 무전기에서 같은 말이 반복된다. “여기는 7구역. 생존자는 7구역으로 오라.” 우리는 아직 1구역에 있다.',
      '옆집 지붕에 누군가 페인트로 숫자를 남겼다. 7, 그리고 화살표.',
      '1구역의 끝. 이 동네의 통조림은 바닥났다. 방송은 오늘도 같은 시각에 흘러나온다.' ] },
    { no: 2, name: '재래시장', trait: '수색 배수 2배', effect: { click: 2 },
      horde: { id: 'swarm', name: '떼거리', desc: '3번째 밤마다 떼로 몰려온다: 규모와 전리품 1.5배', surgeEvery: 3, surge: 1.5 }, story: [
      '2구역. 셔터 내린 시장 골목은 뒤질 곳투성이다. 좌판 위에 저울이 그대로 놓여 있다.',
      '생선 가게 냉동고 안에서 쪽지를 찾았다. “먼저 갑니다. 7구역에서 만나요. 3반 일동.”',
      '밤마다 무리가 불어난다. 놈들도 강 쪽으로, 우리와 같은 방향으로 걷고 있다.' ] },
    { no: 3, name: '공단', trait: '방어력 +30%', effect: { defense: 1.3 },
      horde: { id: 'plated', name: '철갑 무리', desc: '작업복과 안전모를 걸쳤다: 규모 1.2배, 밤 부품 2배', strength: 1.2, parts: 2 }, story: [
      '3구역. 공장 담장은 높고 철판은 남아돈다. 방벽을 세우기엔 더없이 좋다.',
      '프레스 공장 사무실에 출근부가 펼쳐져 있다. 마지막 날짜 뒤로는 전부 빈칸이다.',
      '먼저 지나간 사람들이 남긴 표식을 발견했다. 3반 일동. 적힌 인원수가 줄어 있다.' ] },
    { no: 4, name: '환승역', trait: '원정 시간 30% 단축', effect: { expedTime: 0.7 },
      horde: { id: 'runner', name: '질주자', desc: '선로를 따라 달려온다: 규모 1.15배, 전리품 1.5배', strength: 1.15, reward: 1.5 }, story: [
      '4구역. 선로를 따라가면 지상을 피해 멀리까지 닿는다. 노선도의 종점에 누가 동그라미를 쳐 놓았다.',
      '역무실 무전기는 방송을 더 또렷하게 잡는다. 목소리 뒤로 기침 소리가 섞여 있다.',
      '선로 끝에서 배낭 일곱 개를 찾았다. 주인은 없다. 이름표에는 3반.' ] },
    { no: 5, name: '대학 병원', trait: '밤 방어 전리품 2배', effect: { reward: 2 },
      horde: { id: 'patient', name: '감염 환자', desc: '뚫리면 손실 1.5배. 대신 변이체에게서 얻는 항체 샘플 2배', breach: 1.5, bossAntibody: 2 }, story: [
      '5구역. 병원 로비의 번호표 기계가 아직 켜져 있다. 대기 인원 0명.',
      '격리 병동 기록지. “환자들이 모두 한 방향을 본다. 창문 쪽, 강 건너 송신탑 쪽.”',
      '방송을 녹음해 처음 것과 비교했다. 숨 쉬는 자리까지 한 글자도 다르지 않다. 누군가 말하고 있는 게 아니다.' ] },
    { no: 6, name: '강변 검문소', trait: '방어력 +50%', effect: { defense: 1.5 },
      horde: { id: 'gather', name: '집결한 무리', desc: '변이체가 더 크다: 변이체 규모 1.5배, 변이체 전리품 2배', boss: 1.5, bossReward: 2 }, story: [
      '6구역. 강을 따라 올라가면 다리가 나오고, 다리 건너가 7구역이다. 검문소 차단기는 올라간 채로 녹슬었다.',
      '검문 일지의 마지막 줄. “건너간 사람은 많은데 돌아온 사람이 없다.”',
      '밤이면 강 건너 송신탑에 붉은 불이 깜빡인다. 무리는 그 불빛 아래에 모여 있다.' ] },
    { no: 7, name: '송신탑', trait: '전체 생산 2배', effect: { prod: 2 },
      horde: { id: 'drawn', name: '신호에 끌린 무리', desc: '방송을 따라 끝없이 온다: 규모 1.3배, 전리품 1.3배, 밤 부품 1.5배', strength: 1.3, reward: 1.3, parts: 1.5 }, story: [
      '7구역. 아무도 없다. 멀리 송신탑 아래에서 발전기 하나가 혼자 돌고 있다.',
      '송신실 책상에 테이프가 무한 반복으로 걸려 있다. 녹음 날짜는 사태 3일째. 그날 이후 이곳에서 말한 사람은 없다.',
      '7구역 Z. 테이프를 멈추고 마이크를 잡았다. “여기는 7구역. 생존자가 있다. 반복한다. 생존자가 있다.” 이번에는 진짜 목소리다.' ] }
  ];
  /** 일지 한 편의 고유 ID. 저장 데이터에 이 값으로 기록된다. */
  function beatId(zoneNo, i) { return 'z' + zoneNo + '-' + i; }
  var BEATS = []; // 전체 일지 목록(구역 순, 시점 순)
  ZONES.forEach(function (z) {
    z.story.forEach(function (text, i) { BEATS.push({ id: beatId(z.no, i), zone: z.no, sector: STORY_SECTOR[i], text: text }); });
  });
  var ENDING_BEAT = beatId(7, 2);

  /* ---------- 내부 유틸 ---------- */
  function findById(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function findBy(list, key, value) {
    for (var i = 0; i < list.length; i++) if (list[i][key] === value) return list[i];
    return null;
  }
  /** 유한하고 min 이상인 숫자만 통과시키고, 아니면 기본값으로 대체한다. */
  function safeNum(v, fallback, min) {
    return (typeof v === 'number' && isFinite(v) && v >= (min === undefined ? 0 : min)) ? v : fallback;
  }
  function safeCount(v) { return Math.floor(safeNum(v, 0)); }
  function fail(reason) { return { ok: false, reason: reason }; }
  function pickRng(rng) { return typeof rng === 'function' ? rng : Math.random; }
  function countTrue(map, defs) {
    var n = 0;
    for (var i = 0; i < defs.length; i++) if (map[defs[i].id]) n++;
    return n;
  }
  /** 이 시설·방벽을 지금 구역에서 쓸 수 있는가. 공통 항목(zone 없음)은 어디서나 된다. */
  function inZone(def, state) { return def.zone === undefined || def.zone === zoneIndex(state); }
  /** 지금 구역에서 지을 수 있는 시설 목록(공통 + 이 구역의 고유 시설). */
  function buildingsFor(state) { return ALL_BUILDINGS.filter(function (b) { return inZone(b, state); }); }
  function defensesFor(state) { return ALL_DEFENSES.filter(function (d) { return inZone(d, state); }); }
  /** id 로 정의를 찾되, 지금 구역에서 쓸 수 없는 것이면 null(살 수 없다). */
  function buildingDef(state, id) { var d = findById(ALL_BUILDINGS, id); return d && inZone(d, state) ? d : null; }
  function defenseDef(state, id) { var d = findById(ALL_DEFENSES, id); return d && inZone(d, state) ? d : null; }
  /** 지금 구역의 고유 시설·방벽(화면 표시용). */
  function zoneBuilding(state) { return findZone(ZONE_BUILDINGS, state); }
  function zoneDefense(state) { return findZone(ZONE_DEFENSES, state); }
  function findZone(list, state) {
    var z = zoneIndex(state);
    for (var i = 0; i < list.length; i++) if (list[i].zone === z) return list[i];
    return null;
  }
  function totalBuildings(s) {
    var n = 0;
    ALL_BUILDINGS.forEach(function (b) { n += s.buildings[b.id] || 0; });
    return n;
  }
  function totalPerks(s) {
    var n = 0;
    PERKS.forEach(function (k) { n += s.perks[k.id] || 0; });
    return n;
  }
  function totalSerums(s) {
    var n = 0;
    SERUMS.forEach(function (k) { n += s.serums[k.id] || 0; });
    return n;
  }
  function totalGear(s) {
    var n = 0;
    GEAR.forEach(function (g) { n += s.gear[g.id] || 0; });
    return n;
  }
  function maxBuilding(s) {
    var n = 0;
    ALL_BUILDINGS.forEach(function (b) { n = Math.max(n, s.buildings[b.id] || 0); });
    return n;
  }

  /* 업적: 조건(test)을 만족하면 영구 해금, 1개당 생산 +2%. 이주해도 남는다. */
  var ACHIEVEMENTS = [
    { id: 'click1',    name: '첫 수색',       desc: '잔해를 한 번 뒤진다',            test: function (s) { return s.clicks >= 1; } },
    { id: 'click500',  name: '굳은살',        desc: '직접 수색 500회',                test: function (s) { return s.clicks >= 500; } },
    { id: 'click5k',   name: '맨손의 달인',   desc: '직접 수색 5,000회',              test: function (s) { return s.clicks >= 5000; } },
    { id: 'build10',   name: '분업의 시작',   desc: '한 시설을 10곳 보유',            test: function (s) { return maxBuilding(s) >= 10; } },
    { id: 'build50',   name: '산업 단지',     desc: '한 시설을 50곳 보유',            test: function (s) { return maxBuilding(s) >= 50; } },
    { id: 'build100',  name: '도시 계획',     desc: '한 시설을 100곳 보유',           test: function (s) { return maxBuilding(s) >= 100; } },
    { id: 'buildMax',  name: '더 지을 곳이 없다', desc: '한 시설을 최대치(500곳)까지 보유', test: function (s) { return maxBuilding(s) >= BUILDING_MAX; } },
    { id: 'total100',  name: '마을',          desc: '시설 합계 100곳',                test: function (s) { return totalBuildings(s) >= 100; } },
    { id: 'total300',  name: '작은 나라',     desc: '시설 합계 300곳',                test: function (s) { return totalBuildings(s) >= 300; } },
    { id: 'wave1',     name: '첫 아침',       desc: '밤을 한 번 막아낸다',            test: function (s) { return s.bestWave >= 1; } },
    { id: 'wave10',    name: '열흘',          desc: '한 거점에서 밤 10회 방어',       test: function (s) { return s.bestWave >= 10; } },
    { id: 'wave25',    name: '버티는 법',     desc: '한 거점에서 밤 25회 방어',       test: function (s) { return s.bestWave >= 25; } },
    { id: 'wave50',    name: '철옹성',        desc: '한 거점에서 밤 50회 방어',       test: function (s) { return s.bestWave >= 50; } },
    { id: 'wave100',   name: '백야',          desc: '한 거점에서 밤 100회 방어',      test: function (s) { return s.bestWave >= 100; } },
    { id: 'breach1',   name: '비싼 교훈',     desc: '방벽이 한 번 뚫린다',            test: function (s) { return s.breaches >= 1; } },
    { id: 'boss1',     name: '변이체 사냥',   desc: '변이체를 처치한다',              test: function (s) { return s.bossKills >= 1; } },
    { id: 'boss5',     name: '표본 수집가',   desc: '변이체 5마리 처치',              test: function (s) { return s.bossKills >= 5; } },
    { id: 'exped1',    name: '담장 밖으로',   desc: '원정을 한 번 마친다',            test: function (s) { return s.expeditionsDone >= 1; } },
    { id: 'exped10',   name: '길잡이',        desc: '원정 10회 완료',                 test: function (s) { return s.expeditionsDone >= 10; } },
    { id: 'exped50',   name: '지도 제작자',   desc: '원정 50회 완료',                 test: function (s) { return s.expeditionsDone >= 50; } },
    { id: 'relic1',    name: '쓸 만한 물건',  desc: '유물을 하나 발견한다',           test: function (s) { return countTrue(s.relics, RELICS) >= 1; } },
    { id: 'relicAll',  name: '박물관',        desc: '유물을 전부 모은다',             test: function (s) { return countTrue(s.relics, RELICS) >= RELICS.length; } },
    { id: 'research5', name: '실험 노트',     desc: '한 거점에서 연구 5개 완료',      test: function (s) { return countTrue(s.research, RESEARCH) >= 5; } },
    { id: 'researchAll', name: '석학',        desc: '한 거점에서 연구를 전부 완료',   test: function (s) { return countTrue(s.research, RESEARCH) >= RESEARCH.length; } },
    { id: 'move1',     name: '새 출발',       desc: '새 거점으로 이주한다',           test: function (s) { return s.relocations >= 1; } },
    { id: 'move5',     name: '유랑 생활',     desc: '5번 이주한다',                   test: function (s) { return s.relocations >= 5; } },
    { id: 'move50',    name: '먼 길',         desc: '50번 이주한다',                  test: function (s) { return s.relocations >= 50; } },
    { id: 'earn1m',    name: '창고 가득',     desc: '누적 물자 100만',                test: function (s) { return s.lifetimeEarned >= 1e6; } },
    { id: 'earn1b',    name: '물류 대국',     desc: '누적 물자 10억',                 test: function (s) { return s.lifetimeEarned >= 1e9; } },
    { id: 'earn1t',    name: '문명 재건',     desc: '누적 물자 1조',                  test: function (s) { return s.lifetimeEarned >= 1e12; } },
    { id: 'day100',    name: '백일',          desc: '한 거점에서 D+100 을 맞는다',    test: function (s) { return s.day >= 100; } },
    { id: 'signal10',  name: '응답하라',      desc: '구조 신호에 10번 응답',          test: function (s) { return s.signalsAnswered >= 10; } },
    { id: 'craft1',    name: '손재주',        desc: '장비를 하나 제작한다',           test: function (s) { return totalGear(s) >= 1; } },
    { id: 'craft30',   name: '장인',          desc: '제작 레벨 합계 30',              test: function (s) { return totalGear(s) >= 30; } },
    { id: 'quest10',   name: '해결사',        desc: '지구 과제 10개 달성',            test: function (s) { return s.questsDone >= 10; } },
    { id: 'quest50',   name: '구역의 일꾼',   desc: '지구 과제 50개 달성',            test: function (s) { return s.questsDone >= 50; } },
    { id: 'serum1',    name: '첫 투여',       desc: '혈청을 하나 산다',               test: function (s) { return totalSerums(s) >= 1; } },
    { id: 'serum20',   name: '임상 시험',     desc: '혈청 레벨 합계 20',              test: function (s) { return totalSerums(s) >= 20; } },
    { id: 'perk10',    name: '노련한 유랑민', desc: '이주 특전 레벨 합계 10',         test: function (s) { return totalPerks(s) >= 10; } },
    { id: 'zone4',     name: '반환점',        desc: '4구역에 도착한다',               test: function (s) { return s.relocations >= 3 * SECTORS; } },
    { id: 'zone7',     name: '종착지',        desc: '7구역에 도착한다',               test: function (s) { return s.relocations >= 6 * SECTORS; } },
    { id: 'ending',    name: '발신자',        desc: '7구역의 마지막 일지를 연다',     test: function (s) { return !!s.story[ENDING_BEAT]; } }
  ];

  /* ---------- 상태 생성 / 검증 ---------- */
  function createState(now) {
    var s = {
      version: SAVE_VERSION,
      supplies: 0,          // 현재 보유 물자
      totalEarned: 0,       // 이번 거점에서 번 누적 물자 (이주 보상 계산용)
      lifetimeEarned: 0,    // 전체 누적
      buildings: {}, defenses: {}, upgrades: {},
      research: {},         // 이번 거점에서 끝낸 연구
      relics: {},           // 발견한 유물(영구)
      achievements: {},     // 달성한 업적(영구)
      story: {},            // 열린 일지(영구). 키는 beatId
      parts: 0,             // 부품: 밤 방어·원정에서 얻는 제작 재료(영구)
      gear: {},             // 제작 장비 레벨(영구)
      bundlesBought: 0,     // 이 지구에서 산 부품 꾸러미 수(가격 상승용)
      quest: { type: 'nights', goal: 3, count: 0, reward: 'parts', done: false }, // 이 지구의 과제(첫 지구는 고정)
      questsDone: 0,        // 지금까지 달성한 과제 수(영구)
      bonus: { offlineCap: 0, offlineRate: 0, medals: 0 }, // 과제로 얻은 영구 보너스
      antibodySpent: 0,     // 혈청에 쓴 항체 샘플(쓸 수 있는 양 = antibodies - antibodySpent)
      serums: {},           // 혈청 레벨(영구)
      perks: {},            // 이주 특전 레벨(영구)
      pendingPerks: [],     // 골라야 할 특전 후보(이주 직후 채워지고, 고르면 비워진다)
      pendingRare: false,   // 이번 선택이 구역 경계 보상(3레벨)인지
      mercs: false,         // 오늘 밤 용병 고용 여부
      auto: { fortify: true, build: true }, // 자동화 장비의 켬/끔(장비가 있을 때만 의미가 있다. 설정이라 영구)
      siege: false,         // 농성 중인지(방벽이 뚫린 뒤, 다시 한 번 막아낼 때까지)
      autoExpedition: false, // 원정대가 돌아오면 같은 곳으로 다시 보낼지(설정, 영구)
      expedition: null,     // 진행 중인 원정 { id, left, total }
      buff: null,           // 지원 물자 효과 { mult, left }
      signalIn: SIGNAL_FIRST, // 다음 구조 신호까지 남은 시간
      signalLeft: 0,        // 신호가 떠 있는 동안 남은 응답 시간(0 이면 신호 없음)
      day: 1,               // D+ 카운터
      dayClock: 0,          // 오늘 흐른 시간(초)
      wavesCleared: 0,      // 이번 거점에서 막아낸 밤
      bestWave: 0,          // 한 거점에서 막아낸 밤 최고 기록(영구, 원정 개방 기준)
      breaches: 0,          // 방벽이 뚫린 횟수(전체)
      bossKills: 0,
      expeditionsDone: 0,
      signalsAnswered: 0,
      antibodies: 0,        // 이주·변이체 처치로 얻는 영구 재화
      relocations: 0,
      clicks: 0,
      recruits: 0,          // 사건으로 받아들인 생존자 수
      jobs: { scavenge: SURVIVORS_BASE, guard: 0, study: 0 }, // 생존자 배치(합은 언제나 생존자 수와 같다)
      event: null,          // 지금 떠 있는 사건 { id, left } 또는 null
      eventIn: EVENT_FIRST, // 다음 사건까지 남은 초
      lastEvent: null,      // 직전 사건의 id(연달아 같은 사건이 나오지 않게)
      eventsDone: 0,        // 지나간 사건 수
      cycle: 0,             // 끝낸 회차 수(0 이 첫 회차)
      // --- 통계(규칙에는 쓰이지 않는다. 기록 > 통계 화면용) ---
      startedAt: safeNum(now, 0), // 이 저장을 시작한 시각(ms). 0 이면 알 수 없음(통계가 생기기 전의 저장)
      playSeconds: 0,       // 게임을 켜 둔 시간(전체)
      awaySeconds: 0,       // 자리 비움 보상으로 인정받은 시간(전체)
      sectorSeconds: 0,     // 이 지구에서 보낸 시간(켜 둔 시간 + 인정받은 자리 비움)
      sectorLog: [],        // 최근에 떠난 지구들 [{ step, seconds }], 오래된 것부터
      zoneSeconds: ZONES.map(function () { return 0; }), // 구역별로 보낸 시간(떠난 지구만 합산)
      fastest: null,        // 가장 빨리 떠난 지구 { step, seconds }
      lastSeen: safeNum(now, 0)
    };
    ALL_BUILDINGS.forEach(function (b) { s.buildings[b.id] = 0; });
    ALL_DEFENSES.forEach(function (d) { s.defenses[d.id] = 0; });
    return s;
  }

  function copyFlags(raw, defs) {
    var out = {};
    var src = raw && typeof raw === 'object' ? raw : {};
    defs.forEach(function (d) { if (src[d.id] === true) out[d.id] = true; });
    return out;
  }

  /** 통계의 지구 기록 하나가 쓸 수 있는 값인가: 0~LAST_STEP 의 정수 지구, 0 이상의 유한한 시간. */
  function validSectorRecord(r) {
    return !!r && typeof r === 'object' && typeof r.step === 'number' && r.step >= 0 && r.step <= LAST_STEP && Math.floor(r.step) === r.step
      && typeof r.seconds === 'number' && isFinite(r.seconds) && r.seconds >= 0;
  }
  /**
   * 외부에서 들어온 임의의 객체(저장 데이터, 핫 스냅샷)를 안전한 상태로 바꾼다.
   * 알 수 없는 키는 버리고, 깨진 숫자는 기본값으로 되돌린다. 절대 throw 하지 않는다.
   * 이전 버전 저장에 없는 필드는 createState 의 기본값이 그대로 남는다.
   */
  function sanitizeState(raw, now) {
    var s = createState(now);
    if (!raw || typeof raw !== 'object') return s;
    s.supplies = safeNum(raw.supplies, 0);
    s.totalEarned = safeNum(raw.totalEarned, 0);
    s.lifetimeEarned = Math.max(safeNum(raw.lifetimeEarned, 0), s.totalEarned);
    s.day = Math.max(1, safeCount(raw.day));
    s.dayClock = Math.min(safeNum(raw.dayClock, 0), DAY_SECONDS);
    s.wavesCleared = safeCount(raw.wavesCleared);
    s.bestWave = Math.max(safeCount(raw.bestWave), s.wavesCleared);
    s.breaches = safeCount(raw.breaches);
    s.bossKills = safeCount(raw.bossKills);
    s.expeditionsDone = safeCount(raw.expeditionsDone);
    s.signalsAnswered = safeCount(raw.signalsAnswered);
    s.antibodies = safeCount(raw.antibodies);
    s.relocations = safeCount(raw.relocations);
    s.clicks = safeCount(raw.clicks);
    s.lastSeen = safeNum(raw.lastSeen, s.lastSeen);
    s.signalIn = safeNum(raw.signalIn, SIGNAL_FIRST);
    s.signalLeft = Math.min(safeNum(raw.signalLeft, 0), SIGNAL_WINDOW);
    var rb = raw.buildings && typeof raw.buildings === 'object' ? raw.buildings : {};
    var rd = raw.defenses && typeof raw.defenses === 'object' ? raw.defenses : {};
    // 다른 구역의 고유 시설·방벽이 저장에 들어 있으면 버린다(지금 구역의 것만 살린다).
    ALL_BUILDINGS.forEach(function (b) { s.buildings[b.id] = inZone(b, s) ? Math.min(safeCount(rb[b.id]), BUILDING_MAX) : 0; });
    ALL_DEFENSES.forEach(function (d) { s.defenses[d.id] = inZone(d, s) ? safeCount(rd[d.id]) : 0; });
    s.upgrades = copyFlags(raw.upgrades, UPGRADES);
    s.research = copyFlags(raw.research, RESEARCH);
    s.relics = copyFlags(raw.relics, RELICS);
    s.achievements = copyFlags(raw.achievements, ACHIEVEMENTS);
    s.story = copyFlags(raw.story, BEATS);
    s.cycle = safeCount(raw.cycle);
    s.recruits = Math.min(safeCount(raw.recruits), RECRUIT_MAX);
    var rj = raw.jobs && typeof raw.jobs === 'object' ? raw.jobs : null;
    if (rj) JOBS.forEach(function (j) { s.jobs[j.id] = safeCount(rj[j.id]); });
    normalizeJobs(s); // 배치가 없던 저장은 기본 배치에서 모자란 만큼 수색에 들어간다
    s.eventsDone = safeCount(raw.eventsDone);
    s.eventIn = typeof raw.eventIn === 'number' && isFinite(raw.eventIn) ? Math.max(0, Math.min(raw.eventIn, EVENT_MIN + EVENT_SPREAD)) : EVENT_FIRST;
    s.lastEvent = findById(EVENTS, raw.lastEvent) ? raw.lastEvent : null;
    s.event = raw.event && findById(EVENTS, raw.event.id) ? { id: raw.event.id, left: Math.max(0, Math.min(safeNum(raw.event.left, 0), EVENT_WINDOW)) } : null;
    // 통계: 깨진 값은 0 으로. 통계가 없던 저장은 시작 시각을 알 수 없으므로 0 으로 둔다(지금 시각으로 속이지 않는다).
    s.startedAt = safeNum(raw.startedAt, 0);
    s.playSeconds = safeNum(raw.playSeconds, 0);
    s.awaySeconds = safeNum(raw.awaySeconds, 0);
    s.sectorSeconds = safeNum(raw.sectorSeconds, 0);
    s.sectorLog = (Array.isArray(raw.sectorLog) ? raw.sectorLog : []).filter(validSectorRecord).slice(-SECTOR_LOG_MAX)
      .map(function (r) { return { step: r.step, seconds: r.seconds }; });
    if (Array.isArray(raw.zoneSeconds)) s.zoneSeconds = s.zoneSeconds.map(function (_, i) { return safeNum(raw.zoneSeconds[i], 0); });
    s.fastest = validSectorRecord(raw.fastest) ? { step: raw.fastest.step, seconds: raw.fastest.seconds } : null;
    s.parts = safeCount(raw.parts);
    s.bundlesBought = safeCount(raw.bundlesBought);
    s.mercs = raw.mercs === true;
    s.siege = raw.siege === true;
    var ra = raw.auto && typeof raw.auto === 'object' ? raw.auto : {};
    s.auto = { fortify: ra.fortify !== false, build: ra.build !== false }; // 따로 끄지 않았으면 켜짐
    s.autoExpedition = raw.autoExpedition === true;
    var rg = raw.gear && typeof raw.gear === 'object' ? raw.gear : {};
    GEAR.forEach(function (g) { var lv = Math.min(safeCount(rg[g.id]), g.max); if (lv > 0) s.gear[g.id] = lv; });
    s.questsDone = safeCount(raw.questsDone);
    var rbn = raw.bonus && typeof raw.bonus === 'object' ? raw.bonus : {};
    s.bonus.offlineCap = Math.min(safeNum(rbn.offlineCap, 0), OFFLINE_CAP_BONUS_MAX);
    s.bonus.offlineRate = Math.min(safeNum(rbn.offlineRate, 0), OFFLINE_RATE_BONUS_MAX);
    s.bonus.medals = safeCount(rbn.medals);
    // 과제: 아는 종류·보상일 때만 살린다. 이전 버전 저장처럼 과제가 없으면 null 로 두고 다음 tick 이 새로 준다.
    var rq = raw.quest;
    s.quest = null;
    if (rq && typeof rq === 'object' && findBy(QUESTS, 'type', rq.type) && findBy(QUEST_REWARDS, 'kind', rq.reward) && safeNum(rq.goal, 0) > 0) {
      s.quest = { type: rq.type, goal: rq.goal, count: safeCount(rq.count), reward: rq.reward, done: rq.done === true };
    }
    s.antibodySpent = Math.min(safeCount(raw.antibodySpent), s.antibodies);
    var rs = raw.serums && typeof raw.serums === 'object' ? raw.serums : {};
    SERUMS.forEach(function (k) { var lv = Math.min(safeCount(rs[k.id]), k.max); if (lv > 0) s.serums[k.id] = lv; });
    var rp = raw.perks && typeof raw.perks === 'object' ? raw.perks : {};
    PERKS.forEach(function (k) { var lv = Math.min(safeCount(rp[k.id]), k.max); if (lv > 0) s.perks[k.id] = lv; });
    if (Array.isArray(raw.pendingPerks)) {
      raw.pendingPerks.forEach(function (id) { if (findById(PERKS, id) && s.pendingPerks.indexOf(id) < 0 && s.pendingPerks.length < PERK_CHOICES) s.pendingPerks.push(id); });
    }
    s.pendingRare = raw.pendingRare === true && s.pendingPerks.length > 0;
    // 원정: 아는 장소이고 시간이 정상일 때만 살린다.
    var ex = raw.expedition;
    if (ex && typeof ex === 'object' && findById(EXPEDITIONS, ex.id)) {
      var total = safeNum(ex.total, 0);
      if (total > 0) s.expedition = { id: ex.id, left: Math.min(safeNum(ex.left, 0), total), total: total };
    }
    var bf = raw.buff;
    if (bf && typeof bf === 'object' && safeNum(bf.mult, 0, 1) && safeNum(bf.left, 0) > 0) {
      s.buff = { mult: Math.min(bf.mult, BUFF_MULT), left: Math.min(bf.left, Math.max(BUFF_SECONDS, QUEST_BUFF.seconds)) };
    }
    return s;
  }

  /* ---------- 구역 ---------- */
  var LAST_STEP = ZONES.length * SECTORS - 1; // 7-Z
  /** 출발점(1-A)에서 몇 지구를 지나왔는지. 7-Z 에 닿은 뒤로는 계속 7-Z 다. */
  function stepIndex(state) { return Math.min(safeCount(state.relocations), LAST_STEP); }
  function zoneIndex(state) { return Math.floor(stepIndex(state) / SECTORS); }
  function sectorIndex(state) { return stepIndex(state) % SECTORS; }
  function currentZone(state) { return ZONES[zoneIndex(state)]; }
  function labelOf(step) {
    return ZONES[Math.floor(step / SECTORS)].no + '-' + String.fromCharCode(65 + step % SECTORS);
  }
  /** "3-K" 같은 현재 위치 표기. */
  function zoneLabel(state) { return labelOf(stepIndex(state)); }
  /** 이주하면 가게 될 곳 { label, zone, atEnd }. 이미 7-Z 면 atEnd 가 true. */
  function nextStop(state) {
    var step = stepIndex(state), next = Math.min(step + 1, LAST_STEP);
    return { label: labelOf(next), zone: ZONES[Math.floor(next / SECTORS)], atEnd: step >= LAST_STEP };
  }
  function zoneThreat(state) { return Math.pow(STEP_THREAT, stepIndex(state)); }
  /** 이 지구를 떠나려면 모아야 하는 누적 물자. 멀리 갈수록 커진다. */
  /*
   * 요구량이 두 구간으로 나뉘는 이유: 생산 배수가 붙으면 시설 값은 금방 회수되므로, 요구 물자가 배수보다
   * 충분히 앞서 있지 않으면 한 지구가 몇 초 만에 끝난다. 초반에는 요구량을 가파르게 올려 그 간격을 벌리고
   * (그동안 더 깊은 시설까지 올리게 된다), 그 뒤로는 배수가 자라는 속도에 맞춰 완만하게 올린다.
   */
  function relocateRequirement(state) {
    var n = stepIndex(state);
    return RELOCATE_UNIT * Math.pow(STEP_EARLY, Math.min(n, EARLY_STEPS)) * Math.pow(STEP_REQUIRE, Math.max(0, n - EARLY_STEPS))
      * Math.pow(CYCLE_REQUIRE, safeCount(state.cycle));
  }
  /**
   * 지금 구역에서 조건을 채운 일지를 열고 새로 열린 것들을 돌려준다.
   * 조건: 해당 지구(A·M·Z) 이상에 와 있고, 그곳에서 정해진 만큼 밤을 막아냈을 것.
   * 지나온 구역의 못 본 일지는 열리지 않는다(그 구역에 있을 때만 쓸 수 있는 기록이므로).
   */
  function checkStory(state) {
    var zone = currentZone(state), sector = sectorIndex(state), fresh = [];
    for (var i = 0; i < zone.story.length; i++) {
      var id = beatId(zone.no, i);
      if (!state.story[id] && sector >= STORY_SECTOR[i] && state.wavesCleared >= STORY_WAVES[i]) {
        state.story[id] = true;
        fresh.push({ id: id, zone: zone.no, zoneName: zone.name, text: zone.story[i] });
      }
    }
    return fresh;
  }
  /** 지금까지 열린 일지를 구역 순으로 돌려준다(화면의 일지 패널용). */
  function storyLog(state) {
    return BEATS.filter(function (b) { return !!state.story[b.id]; });
  }

  /* ---------- 보너스 집계 ---------- */
  /** 연구와 유물이 주는 모든 보정치를 한 객체로 합친다. 다른 계산은 이 결과만 읽는다. */
  function mods(state) {
    var m = { prod: 1, defense: 1, reward: 1, expedTime: 1, expedReward: 1, click: 1, signal: 1,
              breach: BREACH_LOSS, offline: OFFLINE_RATE, antibody: 1,
              buildCost: 1, defenseCost: 1, parts: 1, startScouts: 0, offlineAdd: 0, offlineCapAdd: 0, threat: 1,
              autoSignal: false, autoFortify: false, autoBuild: false, researchCost: 1 };
    // 생존자 배치
    m.prod *= 1 + JOB_STEP * (state.jobs.scavenge || 0);
    m.defense *= 1 + JOB_STEP * (state.jobs.guard || 0);
    m.researchCost = Math.max(0.4, 1 - JOB_STEP * (state.jobs.study || 0));
    // 회차: 생산도 늘지만 무리도 커진다
    m.prod *= 1 + CYCLE_BONUS * state.cycle;
    m.threat *= 1 + CYCLE_THREAT * state.cycle;
    // 혈청
    SERUMS.forEach(function (k) {
      var lv = state.serums[k.id] || 0;
      if (lv < 1) return;
      if (k.key === 'offlineAdd' || k.key === 'offlineCapAdd') m[k.key] += k.per * lv;
      else m[k.key] *= Math.max(0.4, 1 + k.per * lv);
    });
    // 과제 훈장
    m.prod *= 1 + MEDAL_BONUS * state.bonus.medals;
    // 이주 특전
    PERKS.forEach(function (k) {
      var lv = state.perks[k.id] || 0;
      if (lv < 1) return;
      if (k.key === 'startScouts' || k.key === 'offlineAdd') m[k.key] += k.per * lv;
      else m[k.key] *= Math.max(0.4, 1 + k.per * lv);
    });
    // 제작 장비: 레벨 × per 를 더한 값을 곱한다(레벨 3, per 0.1 → ×1.3)
    GEAR.forEach(function (g) {
      var lv = state.gear[g.id] || 0;
      if (lv < 1) return;
      if (g.flag) m[g.flag] = true;
      else m[g.key] *= 1 + g.per * lv;
    });
    var z = currentZone(state).effect;
    if (z.prod) m.prod *= z.prod;
    if (z.defense) m.defense *= z.defense;
    if (z.reward) m.reward *= z.reward;
    if (z.expedTime) m.expedTime *= z.expedTime;
    if (z.click) m.click *= z.click;
    RESEARCH.forEach(function (r) {
      if (!state.research[r.id]) return;
      var e = r.effect;
      if (e.prod) m.prod *= e.prod;
      if (e.defense) m.defense *= e.defense;
      if (e.reward) m.reward *= e.reward;
      if (e.expedTime) m.expedTime *= e.expedTime;
      if (e.expedReward) m.expedReward *= e.expedReward;
      if (e.breach !== undefined) m.breach = Math.min(m.breach, e.breach);
      if (e.offline !== undefined) m.offline = Math.max(m.offline, e.offline);
    });
    RELICS.forEach(function (r) {
      if (!state.relics[r.id]) return;
      var e = r.effect;
      if (e.prod) m.prod *= e.prod;
      if (e.defense) m.defense *= e.defense;
      if (e.breachMult) m.breach *= e.breachMult;
      if (e.antibody) m.antibody *= e.antibody;
    });
    return m;
  }
  function achievementCount(state) { return countTrue(state.achievements, ACHIEVEMENTS); }

  /* ---------- 가격 계산 ---------- */
  /** owned 개 보유 중일 때 qty 개를 한꺼번에 사는 값 (등비수열의 합). */
  function bulkCost(baseCost, growth, owned, qty) {
    owned = safeCount(owned); qty = safeCount(qty);
    if (qty < 1) return 0;
    return Math.ceil(baseCost * Math.pow(growth, owned) * (Math.pow(growth, qty) - 1) / (growth - 1));
  }
  /** 현재 물자로 살 수 있는 최대 개수. 올림 오차는 마지막 while 로 보정한다. */
  function maxAffordable(baseCost, growth, owned, supplies) {
    supplies = safeNum(supplies, 0);
    var first = baseCost * Math.pow(growth, safeCount(owned));
    if (supplies < first) return 0;
    var n = Math.floor(Math.log(1 + supplies * (growth - 1) / first) / Math.log(growth));
    while (n > 0 && bulkCost(baseCost, growth, owned, n) > supplies) n--;
    return n;
  }
  function buildingCost(state, id, qty) {
    var def = buildingDef(state, id);
    return def ? bulkCost(def.baseCost * mods(state).buildCost, BUILD_GROWTH, state.buildings[id], qty === undefined ? 1 : qty) : Infinity;
  }
  function defenseCost(state, id, qty) {
    var def = defenseDef(state, id);
    return def ? bulkCost(def.baseCost * mods(state).defenseCost, DEFENSE_GROWTH, state.defenses[id], qty === undefined ? 1 : qty) : Infinity;
  }
  /** 지금 물자로 살 수 있는 최대 개수(특전 할인 반영). 화면의 '최대' 구매에 쓴다. */
  function maxBuildings(state, id) {
    var def = buildingDef(state, id);
    if (!def) return 0;
    return Math.min(BUILDING_MAX - state.buildings[id], maxAffordable(def.baseCost * mods(state).buildCost, BUILD_GROWTH, state.buildings[id], state.supplies));
  }
  function maxDefenses(state, id) {
    var def = defenseDef(state, id);
    return def ? maxAffordable(def.baseCost * mods(state).defenseCost, DEFENSE_GROWTH, state.defenses[id], state.supplies) : 0;
  }

  /* ---------- 생산 / 전투 수치 ---------- */
  function milestoneMult(count) {
    var m = 1;
    for (var i = 0; i < MILESTONES.length; i++) if (count >= MILESTONES[i]) m *= 2;
    return m;
  }
  function nextMilestone(count) {
    for (var i = 0; i < MILESTONES.length; i++) if (count < MILESTONES[i]) return MILESTONES[i];
    return null;
  }
  /** 항체 샘플 × 막아낸 밤 × 업적 × 연구·유물. 일시 효과(지원 물자)는 포함하지 않는다. */
  function globalMult(state) {
    return (1 + ANTIBODY_BONUS * state.antibodies)
      * (1 + WAVE_BONUS * state.wavesCleared)
      * (1 + ACH_BONUS * achievementCount(state))
      * mods(state).prod;
  }
  function buildingRate(state, id) {
    var def = findById(ALL_BUILDINGS, id);
    if (!def) return 0;
    var n = state.buildings[id] || 0;
    return def.baseRate * n * milestoneMult(n) * globalMult(state);
  }
  /** 일시 효과를 뺀 초당 생산. */
  function productionPerSec(state) {
    var g = globalMult(state), total = 0;
    ALL_BUILDINGS.forEach(function (b) {
      var n = state.buildings[b.id] || 0;
      total += b.baseRate * n * milestoneMult(n);
    });
    return total * g;
  }
  /** 지금 이 순간 실제로 들어오는 초당 생산(지원 물자 효과 포함). */
  function currentRate(state) {
    return productionPerSec(state) * (state.buff ? state.buff.mult : 1);
  }
  function clickMult(state) {
    var m = 1;
    UPGRADES.forEach(function (u) { if (state.upgrades[u.id]) m *= u.clickMult; });
    return m;
  }
  /**
   * 직접 수색의 실제 배수: 수색 배수(장비·제작·특전·혈청·구역을 모두 곱한 값)가 두 배가 될 때마다 1씩 는다.
   *   수색 배수 1 → 1배, 2 → 2배, 4 → 3배, 120(장비 4종) → 7.9배, 40만(전부 최대) → 19.6배
   *
   * 예전에는 수색 배수를 그대로 곱했다. 장비 4종만으로 120배라 한 번 누를 때마다 생산 2~5초치가 들어왔고,
   * 빠르게 누르면 가만히 둘 때의 10~20배를 벌어 지구 하나가 30초에 끝났다. 방치형의 기본이 무너지므로
   * 배수가 쌓일수록 효과가 천천히 늘게 했다. 첫 장비(2배)는 적힌 그대로 2배다.
   */
  function clickPower(state) {
    var m = Math.max(1, clickMult(state) * mods(state).click);
    return 1 + Math.log(m) / Math.LN2;
  }
  /** 직접 수색 한 번이 주는 '생산 몇 초치'(화면 안내와 테스트용). */
  function clickSeconds(state) { return CLICK_SHARE * clickPower(state); }
  /**
   * 직접 수색 1회 수익 = (전체 생산 배수 + 초당 생산의 1%) × 수색의 실제 배수.
   * 앞의 항은 시설이 없는 지구 초반에 첫 물자를 모으는 몫이고, 뒤의 항은 생산이 커져도 누르는 보람이 남게 하는 몫이다.
   * 초당 6번을 눌러도 가만히 둘 때의 1.5~2.5배를 넘지 않는다.
   */
  function clickValue(state) {
    return (globalMult(state) + productionPerSec(state) * CLICK_SHARE) * clickPower(state);
  }
  function defensePower(state) {
    var total = BASE_DEFENSE;
    ALL_DEFENSES.forEach(function (d) { total += d.power * (state.defenses[d.id] || 0); });
    return Math.floor(total * mods(state).defense * (state.mercs ? MERC_BONUS : 1));
  }
  /** 뚫릴 때 잃는 비율. 무리 성격(감염 환자)이 키울 수 있지만 물자의 90% 를 넘기지는 않는다. */
  function breachLoss(state) { return Math.min(0.9, mods(state).breach * (horde(state).breach || 1)); }
  /** 자리 비움 효율: 기본 50%(연구 시 75%) + 특전 + 과제 보너스, 100%를 넘지 않는다. */
  function offlineRate(state) { var m = mods(state); return Math.min(1, m.offline + m.offlineAdd + state.bonus.offlineRate); }
  /** 자리 비움 보상이 쌓이는 최대 시간(초): 기본 4시간 + 과제 보너스. */
  function offlineCap(state) { return OFFLINE_CAP + state.bonus.offlineCap + mods(state).offlineCapAdd; }
  function currentWave(state) { return state.wavesCleared + 1; }
  function isBossWave(wave) { return wave > 0 && wave % BOSS_EVERY === 0; }
  function hordeStrength(wave) { return Math.round(8 * Math.pow(1.2, Math.max(1, wave) - 1)); }
  /** 오늘 밤 실제로 막아야 하는 규모. 변이체 밤은 2.5배, 지구를 넘을 때마다 4%씩 커진다. */
  function nightStrength(state) { return strengthAt(state, currentWave(state)); }
  /** 지금 구역 무리의 성격(없으면 빈 객체). */
  function horde(state) { return currentZone(state).horde || {}; }
  /** w 번째 밤이 '떼로 몰려오는 밤'인가(떼거리 구역 전용, 변이체 밤과는 겹치지 않는다). */
  function isSurgeWave(state, w) {
    var h = horde(state);
    return h.surgeEvery > 0 && w > 0 && w % h.surgeEvery === 0 && !isBossWave(w);
  }
  /** w 번째 밤의 무리 규모: 기본 규모 × 변이체 × 무리 성격 × 지구 위협. 오늘 밤과 예보가 같은 식을 쓴다. */
  function strengthAt(state, w) {
    var h = horde(state), boss = isBossWave(w);
    return Math.round(hordeStrength(w) * (boss ? BOSS_STRENGTH * (h.boss || 1) : 1) * (isSurgeWave(state, w) ? h.surge : 1)
      * (h.strength || 1) * zoneThreat(state) * mods(state).threat);
  }
  /** 방어 성공 시 전리품: 최소 보장액과 15초치 생산 중 큰 쪽, 변이체 밤은 5배. */
  function hordeReward(state) {
    var w = currentWave(state), h = horde(state), boss = isBossWave(w);
    return Math.max(25 * w, productionPerSec(state) * 15) * mods(state).reward * (boss ? BOSS_REWARD * (h.bossReward || 1) : 1)
      * (h.reward || 1) * (isSurgeWave(state, w) ? h.surge : 1);
  }

  function earn(state, amount) {
    state.supplies += amount;
    state.totalEarned += amount;
    state.lifetimeEarned += amount;
  }

  /* ---------- 플레이어 행동 ---------- */
  function scavenge(state) {
    var gain = clickValue(state);
    earn(state, gain);
    state.clicks++;
    bumpQuest(state, 'click');
    return gain;
  }

  function validQty(qty) { return typeof qty === 'number' && isFinite(qty) && qty >= 1; }

  function buyBuilding(state, id, qty) {
    var def = buildingDef(state, id);
    if (!def) return fail('unknown');
    qty = qty === undefined ? 1 : qty;
    if (!validQty(qty)) return fail('quantity');
    var before = state.buildings[id];
    if (before >= BUILDING_MAX) return fail('max');
    qty = Math.min(Math.floor(qty), BUILDING_MAX - before); // 남은 자리만큼만 산다
    var cost = buildingCost(state, id, qty);
    if (cost > state.supplies) return fail('supplies');
    state.supplies -= cost;
    state.buildings[id] = before + qty;
    // 이번 구매로 2배 문턱을 넘었는지 알려 화면이 축하 로그를 띄울 수 있게 한다.
    var crossed = milestoneMult(before + qty) > milestoneMult(before);
    return { ok: true, cost: cost, qty: qty, milestone: crossed };
  }

  function buyDefense(state, id, qty) {
    var def = defenseDef(state, id);
    if (!def) return fail('unknown');
    qty = qty === undefined ? 1 : qty;
    if (!validQty(qty)) return fail('quantity');
    qty = Math.floor(qty);
    var cost = defenseCost(state, id, qty);
    if (cost > state.supplies) return fail('supplies');
    state.supplies -= cost;
    state.defenses[id] += qty;
    return { ok: true, cost: cost, qty: qty };
  }

  /** 한 번만 살 수 있는 항목(장비, 연구)의 공통 구매 처리. */
  function buyOnce(state, defs, owned, id) {
    var def = findById(defs, id);
    if (!def) return fail('unknown');
    if (owned[id]) return fail('owned');
    if (def.cost > state.supplies) return fail('supplies');
    state.supplies -= def.cost;
    owned[id] = true;
    return { ok: true, cost: def.cost };
  }
  function buyUpgrade(state, id) { return buyOnce(state, UPGRADES, state.upgrades, id); }
  function buyResearch(state, id) {
    // 연구에 배치한 생존자만큼 싸진다. 값만 다르고 나머지는 한 번 사는 것들과 같다.
    var def = findById(RESEARCH, id);
    if (!def) return fail('unknown');
    if (state.research[id]) return fail('owned');
    var cost = researchCost(state, id);
    if (cost > state.supplies) return fail('supplies');
    state.supplies -= cost;
    state.research[id] = true;
    return { ok: true, cost: cost };
  }

  /* ---------- 부품 / 제작 ---------- */
  /** 밤을 막아냈을 때 얻는 부품. 깊은 구역일수록, 변이체 밤일수록 많다. */
  function nightParts(state) {
    var w = currentWave(state);
    return Math.floor((1 + Math.floor(w / 5)) * currentZone(state).no * (isBossWave(w) ? 5 : 1) * mods(state).parts * (horde(state).parts || 1));
  }
  function expeditionParts(state, id) {
    var def = findById(EXPEDITIONS, id);
    return def ? Math.floor(def.parts * currentZone(state).no * mods(state).parts) : 0;
  }
  function gearLevel(state, id) { return state.gear[id] || 0; }
  /** 다음 레벨 제작에 드는 부품. 최대 레벨이면 Infinity. */
  function gearCost(state, id) {
    var def = findById(GEAR, id);
    if (!def) return Infinity;
    var lv = gearLevel(state, id);
    return lv >= def.max ? Infinity : Math.ceil(def.baseCost * Math.pow(GEAR_GROWTH, lv));
  }
  function craftGear(state, id) {
    var def = findById(GEAR, id);
    if (!def) return fail('unknown');
    if (gearLevel(state, id) >= def.max) return fail('max');
    var cost = gearCost(state, id);
    if (cost > state.parts) return fail('parts');
    state.parts -= cost;
    state.gear[id] = gearLevel(state, id) + 1;
    bumpQuest(state, 'craft');
    return { ok: true, cost: cost, level: state.gear[id] };
  }

  /* ---------- 상점 ---------- */
  /** 상점 가격은 현재 생산량에 비례한다(후반에도 의미 있는 지출이 되도록). 최소값이 있다. */
  function shopPrice(state, id) {
    var pps = productionPerSec(state);
    if (id === 'bundle') return Math.ceil(Math.max(300, pps * 120) * Math.pow(BUNDLE_GROWTH, state.bundlesBought));
    if (id === 'mercs') return Math.ceil(Math.max(150, pps * 45));
    if (id === 'recall') return Math.ceil(Math.max(100, pps * (state.expedition ? state.expedition.left : 0) * 0.5));
    return Infinity;
  }
  function bundleParts(state) { return Math.floor(3 * currentZone(state).no * mods(state).parts); }
  /** 거래 1건을 처리한다. 조건이 안 맞으면 물자를 받지 않고 이유를 돌려준다. */
  function buyShop(state, id, rng) {
    if (!findById(SHOP, id)) return fail('unknown');
    if (id === 'mercs' && state.mercs) return fail('active');
    if (id === 'recall' && !state.expedition) return fail('none');
    var cost = shopPrice(state, id);
    if (cost > state.supplies) return fail('supplies');
    state.supplies -= cost;
    if (id === 'bundle') {
      var got = bundleParts(state);
      state.parts += got;
      state.bundlesBought++;
      return { ok: true, cost: cost, parts: got };
    }
    if (id === 'mercs') {
      state.mercs = true;
      return { ok: true, cost: cost };
    }
    state.expedition.left = 0;
    return { ok: true, cost: cost, expedition: advanceExpedition(state, 0, rng)[0] || null };
  }

  /* ---------- 원정 ---------- */
  function expeditionUnlocked(state, id) {
    var def = findById(EXPEDITIONS, id);
    return !!def && state.bestWave >= def.needWave;
  }
  function expeditionDuration(state, id) {
    var def = findById(EXPEDITIONS, id);
    return def ? def.seconds * mods(state).expedTime : 0;
  }
  /** 보상은 돌아오는 시점의 생산량으로 계산한다(떠난 뒤 키운 거점도 반영). */
  function expeditionReward(state, id) {
    var def = findById(EXPEDITIONS, id);
    if (!def) return 0;
    return Math.max(def.baseReward, productionPerSec(state) * def.rateSeconds) * mods(state).expedReward;
  }
  function startExpedition(state, id) {
    var def = findById(EXPEDITIONS, id);
    if (!def) return fail('unknown');
    if (state.expedition) return fail('busy');
    if (!expeditionUnlocked(state, id)) return fail('locked');
    var total = expeditionDuration(state, id);
    state.expedition = { id: id, left: total, total: total };
    return { ok: true, seconds: total };
  }
  /**
   * 강제 귀환: 진행 중인 원정을 그만두고 빈손으로 돌아온다. 물자·부품·유물을 받지 못하고
   * 원정 횟수(과제·업적)에도 들어가지 않는다. 보상을 받고 즉시 돌아오려면 상점의 긴급 귀환을 쓴다.
   */
  function cancelExpedition(state) {
    var ex = state.expedition;
    if (!ex) return fail('none');
    var def = findById(EXPEDITIONS, ex.id);
    state.expedition = null;
    return { ok: true, site: def ? def.name : '', wasted: Math.max(0, ex.total - ex.left) };
  }
  function setAutoExpedition(state, on) { state.autoExpedition = on === true; return state.autoExpedition; }
  /**
   * 원정 시계를 dt 만큼 돌리고, 그 사이 귀환한 원정의 이벤트 목록을 돌려준다.
   * 반복 출발이 켜져 있으면 남은 시간을 이월해 곧바로 다시 떠나므로, 긴 dt(자리 비움)에는
   * 여러 번 다녀올 수 있다. 횟수 상한은 비정상적으로 큰 dt 에 대한 안전장치다.
   */
  function advanceExpedition(state, dt, rng) {
    var done = [];
    var ex = state.expedition;
    if (!ex) return done;
    ex.left -= dt;
    var guard = 0;
    while (state.expedition && state.expedition.left <= 0 && guard++ < 500) {
      ex = state.expedition;
      state.expedition = null;
      var def = findById(EXPEDITIONS, ex.id);
      if (!def) break;
      var reward = expeditionReward(state, def.id);
      earn(state, reward);
      var parts = expeditionParts(state, def.id);
      state.parts += parts;
      state.expeditionsDone++;
      bumpQuest(state, 'exped');
      var found = null;
      for (var i = 0; i < RELICS.length; i++) {
        var r = RELICS[i];
        if (r.site === def.id && !state.relics[r.id] && pickRng(rng)() < def.relicChance) {
          state.relics[r.id] = true;
          found = r.name;
        }
      }
      done.push({ type: 'expedition', id: def.id, site: def.name, reward: reward, parts: parts, relic: found });
      if (state.autoExpedition) {
        var total = expeditionDuration(state, def.id);
        state.expedition = { id: def.id, left: total + ex.left, total: total }; // ex.left ≤ 0: 넘친 시간 이월
      }
    }
    // 안전장치에 걸렸으면 넘친 시간을 버리고 새로 출발한 것으로 친다.
    if (state.expedition && state.expedition.left <= 0) state.expedition.left = state.expedition.total;
    return done;
  }

  /* ---------- 방어 안내 ---------- */
  /**
   * 오늘 밤을 막으려면 무엇을 얼마나 사야 하는지 계산한다(실제로 사지는 않는다).
   * 물자 대비 방어력이 가장 좋은 방벽부터 고르는, 자동 보강과 같은 방식이다.
   * 돌려주는 값: { short: 모자란 방어력, cost: 총비용, items: [{ id, name, count }], affordable }
   * 이미 충분하면 short 0, items 는 빈 배열.
   */
  function defensePlan(state) {
    var tmp = Object.assign({}, state, { defenses: Object.assign({}, state.defenses) });
    var strength = nightStrength(state), picked = {}, order = [], guard = 0;
    var pool = defensesFor(state); // 공통 방벽 + 이 구역의 고유 방벽
    while (defensePower(tmp) < strength && guard++ < 2000) {
      var best = null, bestValue = 0;
      for (var i = 0; i < pool.length; i++) {
        var c = defenseCost(tmp, pool[i].id, 1), v = pool[i].power / c;
        if (v > bestValue) { best = pool[i]; bestValue = v; }
      }
      if (!best) break;
      tmp.defenses[best.id]++;
      if (!picked[best.id]) { picked[best.id] = 0; order.push(best); }
      picked[best.id]++;
    }
    // 비용은 종류별 묶음 가격으로 다시 계산한다: 한 번에 보강할 때 실제로 빠져나가는 금액과 정확히 같게 하기 위함.
    var cost = 0;
    order.forEach(function (d) { cost += defenseCost(state, d.id, picked[d.id]); });
    return {
      short: Math.max(0, strength - defensePower(state)), cost: cost,
      items: order.map(function (d) { return { id: d.id, name: d.name, count: picked[d.id] }; }),
      affordable: cost <= state.supplies
    };
  }
  /** 위 계획대로 실제로 산다. 물자가 모자라면 아무것도 사지 않는다. */
  function fortify(state) {
    var plan = defensePlan(state);
    if (!plan.items.length) return fail('safe');
    if (!plan.affordable) return fail('supplies');
    var bought = 0;
    plan.items.forEach(function (it) { if (buyDefense(state, it.id, it.count).ok) bought += it.count; });
    return { ok: true, cost: plan.cost, count: bought };
  }
  /** 이 방벽 한 종류만으로 오늘 밤을 막으려면 몇 개를 더 사야 하는지. 이미 충분하면 0. */
  function defenseNeeded(state, id) {
    var def = defenseDef(state, id);
    if (!def) return 0;
    var strength = nightStrength(state);
    if (defensePower(state) >= strength) return 0;
    var mult = mods(state).defense * (state.mercs ? MERC_BONUS : 1), raw = BASE_DEFENSE;
    ALL_DEFENSES.forEach(function (d) { raw += d.power * (state.defenses[d.id] || 0); });
    var n = Math.max(1, Math.ceil((strength / mult - raw) / def.power));
    var tmp = Object.assign({}, state, { defenses: Object.assign({}, state.defenses) });
    tmp.defenses[id] += n;
    while (defensePower(tmp) < strength && n < 1e6) { tmp.defenses[id]++; n++; } // 내림 오차 보정
    return n;
  }
  /** 앞으로 올 밤 count 번의 무리 규모(지금부터 매번 막아낸다고 가정). [{ wave, strength, boss, surge }] */
  function nightForecast(state, count) {
    var out = [], w0 = currentWave(state);
    for (var i = 0; i < count; i++) {
      var w = w0 + i;
      out.push({ wave: w, boss: isBossWave(w), surge: isSurgeWave(state, w), strength: strengthAt(state, w) });
    }
    return out;
  }

  /* ---------- 자동화 켬/끔 ---------- */
  /** 자동화 장비(방벽 담당: 'fortify', 건설 담당: 'build')를 켜거나 끈다. 장비가 없으면 켜 둬도 동작하지 않는다. */
  function setAuto(state, key, on) {
    if (key !== 'fortify' && key !== 'build') return fail('unknown');
    state.auto[key] = on === true;
    return { ok: true, on: state.auto[key] };
  }
  /** 그 자동화가 지금 실제로 돌아가는지: 장비가 있고 켜져 있어야 한다. */
  function autoActive(state, key) {
    var m = mods(state);
    return key === 'fortify' ? m.autoFortify && state.auto.fortify : key === 'build' ? m.autoBuild && state.auto.build : false;
  }

  /* ---------- 자동 시설 건설 ---------- */
  /**
   * 살 수 있는 시설 중 값 대비 생산이 가장 좋은 것(회수 기간이 가장 짧은 것)을 차례로 짓는다.
   * 오늘 밤을 막을 방어력이 모자란 동안에는 짓지 않는다: 방벽에 쓸 물자를 먼저 써 버리지 않기 위함이다.
   */
  function autoBuild(state) {
    if (defensePower(state) < nightStrength(state)) return 0;
    var built = 0, pool = buildingsFor(state);
    while (built < AUTO_BUILD_PER_TICK) {
      var best = null, bestPay = Infinity;
      for (var i = 0; i < pool.length; i++) {
        var b = pool[i];
        if (state.buildings[b.id] >= BUILDING_MAX) continue;
        var cost = buildingCost(state, b.id, 1), pay = cost / b.baseRate;
        if (cost <= state.supplies && pay < bestPay) { best = b; bestPay = pay; }
      }
      if (!best) break;
      buyBuilding(state, best.id, 1);
      built++;
    }
    return built;
  }

  /* ---------- 자동 방벽 보강 ---------- */
  /** 오늘 밤을 막을 수 있을 때까지, 살 수 있는 방벽 중 물자 대비 방어력이 가장 좋은 것을 산다. */
  function autoFortify(state) {
    var bought = 0, pool = defensesFor(state);
    while (bought < 200 && defensePower(state) < nightStrength(state)) {
      var best = null, bestValue = 0;
      for (var i = 0; i < pool.length; i++) {
        var cost = defenseCost(state, pool[i].id, 1);
        var value = pool[i].power / cost;
        if (cost <= state.supplies && value > bestValue) { best = pool[i]; bestValue = value; }
      }
      if (!best) break;
      buyDefense(state, best.id, 1);
      bought++;
    }
    return bought;
  }

  /* ---------- 구조 신호 ---------- */
  function nextSignalDelay(state, rng) {
    return (SIGNAL_MIN + pickRng(rng)() * SIGNAL_SPREAD) * mods(state).signal;
  }
  /** 떠 있는 신호에 응답한다. 절반은 즉시 물자, 절반은 30초간 생산 3배. */
  function answerSignal(state, rng) {
    if (!(state.signalLeft > 0)) return fail('none');
    rng = pickRng(rng);
    state.signalLeft = 0;
    state.signalIn = nextSignalDelay(state, rng);
    state.signalsAnswered++;
    bumpQuest(state, 'signal');
    if (rng() < 0.5) {
      var gain = Math.max(SIGNAL_SUPPLY_MIN, productionPerSec(state) * SIGNAL_SUPPLY_SECONDS);
      earn(state, gain);
      return { ok: true, kind: 'supplies', gain: gain };
    }
    state.buff = { mult: BUFF_MULT, left: BUFF_SECONDS };
    return { ok: true, kind: 'buff', mult: BUFF_MULT, seconds: BUFF_SECONDS };
  }

  /* ---------- 업적 ---------- */
  /** 새로 조건을 채운 업적을 기록하고 그 목록을 돌려준다. */
  function checkAchievements(state) {
    var fresh = [];
    for (var i = 0; i < ACHIEVEMENTS.length; i++) {
      var a = ACHIEVEMENTS[i];
      if (state.achievements[a.id]) continue;
      var ok = false;
      try { ok = !!a.test(state); } catch (e) { ok = false; } // 조건 하나의 오류가 게임을 멈추지 않게
      if (ok) { state.achievements[a.id] = true; fresh.push(a); }
    }
    return fresh;
  }

  /* ---------- 시간 진행 ---------- */
  /**
   * 하루의 끝. 방어력 ≥ 무리 규모면 전리품을 얻는다. 못 막으면:
   *   - 처음 뚫린 밤에는 물자를 빼앗기고 '농성'에 들어간다.
   *   - 농성 중에 또 못 막는 밤은 문을 걸어 잠그고 버틴다: 더 잃지 않지만 얻는 것도 없다.
   *   - 한 번 막아내면 농성이 풀린다.
   *
   * [알파 0.3.5 변경] 전에는 못 막는 밤마다 물자를 빼앗겼다. 밤이 1분마다 오므로 방벽을 챙기지 않고
   * 켜 두면 번 물자의 80%를 잃고 생산 7분치 이상을 모을 수 없었다. 꺼 두는 쪽(자리 비움 중에는 손실 없이
   * 버틴다)이 켜 두는 쪽보다 유리한 모순도 있었다. 벌칙을 한 번으로 줄여 두 규칙을 같게 했다.
   */
  function resolveNight(state) {
    var wave = currentWave(state);
    var boss = isBossWave(wave);
    var strength = nightStrength(state);
    var defense = defensePower(state);
    var event;
    if (defense >= strength) {
      var reward = hordeReward(state);
      var parts = nightParts(state);
      var antibodies = 0;
      earn(state, reward);
      state.parts += parts;
      state.wavesCleared++;
      state.bestWave = Math.max(state.bestWave, state.wavesCleared);
      bumpQuest(state, 'nights');
      if (boss) bumpQuest(state, 'boss');
      if (boss) {
        // 고정 1개는 후반에 의미가 없어지므로 보유량의 1%(최소 1개)를 준다.
        antibodies = Math.max(1, Math.floor(state.antibodies * BOSS_ANTIBODY)) * (horde(state).bossAntibody || 1);
        state.bossKills++;
        state.antibodies += antibodies;
      }
      state.siege = false;
      event = { type: 'defended', day: state.day, wave: wave, strength: strength, reward: reward,
                parts: parts, antibodies: antibodies, boss: boss };
    } else if (state.siege) {
      event = { type: 'held', day: state.day, wave: wave, strength: strength, boss: boss };
    } else {
      // 실패해도 무리 규모는 커지지 않는다: 막힌 구간에서 무한히 약탈당하지 않게 하기 위함.
      var lost = state.supplies * breachLoss(state);
      state.supplies -= lost;
      state.breaches++;
      state.siege = true;
      event = { type: 'breached', day: state.day, wave: wave, strength: strength, lost: lost, boss: boss };
    }
    state.mercs = false; // 용병 계약은 하룻밤짜리
    state.day++;
    return event;
  }

  /**
   * dt 초만큼 게임을 진행하고, 그 사이 벌어진 이벤트 목록을 돌려준다.
   * 순서: 생산(지원 효과 반영) → 원정 → 구조 신호 → 자동 방벽 보강 → 자동 시설 건설 → 밤 → 과제 → 일지 → 업적.
   * 잘못된 dt(NaN, 음수, 0)는 조용히 무시한다.
   */
  function tick(state, dt, rng) {
    var events = [];
    rng = typeof rng === 'function' ? rng : Math.random; // 난수 함수를 주지 않아도 사건과 신호가 멈추지 않게
    if (!(typeof dt === 'number' && isFinite(dt) && dt > 0)) return events;
    state.playSeconds += dt;   // 통계: 켜 둔 시간
    state.sectorSeconds += dt; // 통계: 이 지구에서 보낸 시간

    // 지원 효과가 dt 도중에 끝나면 남은 시간만큼만 배수를 적용한다.
    var pps = productionPerSec(state);
    var boosted = state.buff ? Math.min(dt, state.buff.left) : 0;
    earn(state, pps * (dt - boosted) + pps * boosted * (state.buff ? state.buff.mult : 1));
    if (state.buff) {
      state.buff.left -= dt;
      if (state.buff.left <= 0) state.buff = null;
    }

    advanceExpedition(state, dt, rng).forEach(function (ev) { events.push(ev); });
    var m = mods(state);

    if (state.signalLeft > 0) {
      state.signalLeft -= dt;
      if (state.signalLeft <= 0) {
        state.signalLeft = 0;
        state.signalIn = nextSignalDelay(state, rng);
        events.push({ type: 'signal-lost' });
      }
    } else {
      state.signalIn -= dt;
      if (state.signalIn <= 0) {
        state.signalIn = 0;
        state.signalLeft = SIGNAL_WINDOW;
        if (m.autoSignal) events.push({ type: 'signal-auto', result: answerSignal(state, rng) });
        else events.push({ type: 'signal' });
      }
    }

    stepEvent(state, dt, rng, events);

    if (autoActive(state, 'fortify')) {
      var added = autoFortify(state);
      if (added > 0) events.push({ type: 'fortified', count: added });
    }
    if (autoActive(state, 'build')) {
      var built = autoBuild(state);
      if (built > 0) events.push({ type: 'built', count: built });
    }

    var clockBefore = state.dayClock, arriveAt = DAY_SECONDS - BATTLE_SECONDS;
    state.dayClock += dt;
    var guard = 0;
    while (state.dayClock >= DAY_SECONDS && guard++ < MAX_NIGHTS_PER_TICK) {
      state.dayClock -= DAY_SECONDS;
      clockBefore = 0; // 새 날이 시작됐다
      events.push(resolveNight(state));
    }
    // 무리가 도착하는 순간(낮 → 방어)을 한 번 알린다. 승패는 아직 정해지지 않았고, 남은 시간 동안 보강할 수 있다.
    if (clockBefore < arriveAt && state.dayClock >= arriveAt && state.dayClock < DAY_SECONDS) {
      events.push({ type: 'arrive', strength: nightStrength(state), defense: defensePower(state), siege: !!state.siege, boss: isBossWave(currentWave(state)) });
    }
    if (state.dayClock >= DAY_SECONDS) state.dayClock = 0; // 안전장치에 걸린 경우

    var quest = checkQuest(state, rng);
    if (quest) events.push(quest);
    checkStory(state).forEach(function (b) {
      events.push({ type: 'story', id: b.id, zone: b.zone, zoneName: b.zoneName, text: b.text });
    });
    checkAchievements(state).forEach(function (a) {
      events.push({ type: 'achievement', id: a.id, name: a.name });
    });
    return events;
  }

  /**
   * 자리를 비운 시간만큼 진행한다. 방치가 기본인 게임이므로 꺼 둔 동안에도 거점은 굴러간다.
   *   생산 : 절반 효율(연구·특전·과제로 오른다), 기본 최대 4시간(과제로 늘어난다)
   *   원정 : 실제로 흐른 시간만큼(반복 출발이면 여러 번)
   *   밤   : 막을 수 있는 밤은 막고 보상을 받는다. 못 막는 밤을 만나면 문을 걸어 잠그고
   *          버틴 것으로 쳐서 손실도 진행도 없다(돌아와 보니 전부 털린 상황을 막기 위함).
   *   구조 신호 : 오지 않는다.
   * 시계가 거꾸로 간 경우(음수)나 깨진 값은 0초로 취급한다.
   */
  function applyOffline(state, seconds, rng) {
    var elapsed = safeNum(seconds, 0);
    var cap = offlineCap(state);
    var counted = Math.min(elapsed, cap);
    var gain = productionPerSec(state) * counted * offlineRate(state);
    earn(state, gain);
    state.awaySeconds += counted;   // 통계: 보상으로 인정받은 시간만 센다(상한을 넘긴 시간은 진행이 없었으므로 뺀다)
    state.sectorSeconds += counted;
    state.buff = null;
    // 떠 있던 사건은 기본 선택으로 넘긴다(자리를 비운 동안 새 사건은 일어나지 않는다)
    var pendingEvent = null;
    if (state.event && elapsed > 0) { pendingEvent = chooseEvent(state, defaultChoice(state), rng); if (!pendingEvent.ok) { state.event = null; pendingEvent = null; } }
    var expeditions = elapsed > 0 ? advanceExpedition(state, elapsed, rng) : [];

    var report = { elapsed: elapsed, counted: counted, gain: gain, capped: elapsed > cap,
                   expeditions: expeditions, expedition: expeditions[0] || null,
                   nights: 0, nightReward: 0, parts: 0, antibodies: 0, held: false, event: pendingEvent };
    var clock = state.dayClock + counted;
    var nights = Math.floor(clock / DAY_SECONDS);
    state.dayClock = clock - nights * DAY_SECONDS;
    var auto = autoActive(state, 'fortify');
    for (var i = 0; i < nights; i++) {
      if (auto) autoFortify(state);
      if (defensePower(state) < nightStrength(state)) {
        report.held = true;          // 여기서부터는 버티기만 한다
        state.day += nights - i;     // 날짜는 그대로 흐른다
        state.mercs = false;
        break;
      }
      var ev = resolveNight(state);
      report.nights++;
      report.nightReward += ev.reward;
      report.parts += ev.parts;
      report.antibodies += ev.antibodies;
    }
    return report;
  }

  /* ---------- 혈청(항체 샘플 사용처) ---------- */
  /** 지금 쓸 수 있는 항체 샘플. 생산 보너스는 총량(state.antibodies) 기준이라 이 값과 무관하다. */
  function antibodiesFree(state) { return Math.max(0, state.antibodies - state.antibodySpent); }
  function serumLevel(state, id) { return state.serums[id] || 0; }
  /** 다음 레벨에 드는 항체 샘플. 최대 레벨이면 Infinity. */
  function serumCost(state, id) {
    var def = findById(SERUMS, id);
    if (!def) return Infinity;
    var lv = serumLevel(state, id);
    return lv >= def.max ? Infinity : Math.ceil(def.baseCost * Math.pow(SERUM_GROWTH, lv));
  }
  function buySerum(state, id) {
    var def = findById(SERUMS, id);
    if (!def) return fail('unknown');
    if (serumLevel(state, id) >= def.max) return fail('max');
    var cost = serumCost(state, id);
    if (cost > antibodiesFree(state)) return fail('antibodies');
    state.antibodySpent += cost;
    state.serums[id] = serumLevel(state, id) + 1;
    return { ok: true, cost: cost, level: state.serums[id] };
  }

  /* ---------- 지구별 과제 ---------- */
  /** 횟수를 세는 과제(밤, 원정, 수색 …)의 진행을 하나 올린다. 종류가 다르거나 이미 끝났으면 아무 일도 없다. */
  function bumpQuest(state, type) {
    var q = state.quest;
    if (q && !q.done && q.type === type) q.count++;
  }
  /** 과제의 현재 진행도. 횟수형은 세어 둔 값, 상태형(시설 수, 방어력 배수 …)은 지금 상태에서 계산한다. */
  function questProgress(state) {
    var q = state.quest;
    if (!q) return 0;
    if (q.type === 'build') return totalBuildings(state);
    if (q.type === 'research') return countTrue(state.research, RESEARCH);
    if (q.type === 'defense') return Math.floor(defensePower(state) / Math.max(1, nightStrength(state)) * 10) / 10;
    if (q.type === 'earn') return Math.floor(state.totalEarned / relocateRequirement(state) * 100) / 100;
    return q.count;
  }
  function questText(state) {
    var q = state.quest, def = q ? findBy(QUESTS, 'type', q.type) : null;
    return def ? def.text.replace('{n}', q.goal) : '';
  }
  function questRewardName(state) {
    var q = state.quest, def = q ? findBy(QUEST_REWARDS, 'kind', q.reward) : null;
    return def ? def.name : '';
  }
  /** 새 지구의 과제를 정한다. 한도에 닿은 보상은 후보에서 빠진다. */
  function generateQuest(state, rng) {
    rng = pickRng(rng);
    var def = QUESTS[Math.floor(rng() * QUESTS.length) % QUESTS.length];
    var pool = QUEST_REWARDS.filter(function (r) {
      if (r.kind === 'offlineCap') return state.bonus.offlineCap < OFFLINE_CAP_BONUS_MAX;
      if (r.kind === 'offlineRate') return state.bonus.offlineRate < OFFLINE_RATE_BONUS_MAX - 1e-9;
      return true;
    });
    var total = 0, roll, reward = pool[0].kind;
    pool.forEach(function (r) { total += r.weight; });
    roll = rng() * total;
    for (var i = 0; i < pool.length; i++) { roll -= pool[i].weight; if (roll < 0) { reward = pool[i].kind; break; } }
    return { type: def.type, goal: def.goal, count: 0, reward: reward, done: false };
  }
  /** 보상을 실제로 지급하고, 무엇을 얼마나 받았는지 알리는 문구를 돌려준다. */
  function grantQuestReward(state, kind, rng) {
    if (kind === 'supplies') { var gain = Math.max(200, productionPerSec(state) * 600); earn(state, gain); return '물자 ' + formatNumber(gain); }
    if (kind === 'buff') { state.buff = { mult: QUEST_BUFF.mult, left: QUEST_BUFF.seconds }; return '5분간 생산 2배'; }
    if (kind === 'antibody') { var ab = Math.max(1, Math.floor(state.antibodies * 0.03)); state.antibodies += ab; return '항체 샘플 ' + formatNumber(ab) + '개'; }
    if (kind === 'medal') { state.bonus.medals++; return '훈장 1개 (생산 +1% 영구)'; }
    if (kind === 'offlineCap') { state.bonus.offlineCap = Math.min(OFFLINE_CAP_BONUS_MAX, state.bonus.offlineCap + OFFLINE_CAP_STEP); var mins = Math.round(offlineCap(state) / 60); return '자리 비움 보상 시간 +10분 (지금 ' + Math.floor(mins / 60) + '시간' + (mins % 60 ? ' ' + (mins % 60) + '분' : '') + ')'; }
    if (kind === 'offlineRate') { state.bonus.offlineRate = Math.min(OFFLINE_RATE_BONUS_MAX, state.bonus.offlineRate + OFFLINE_RATE_STEP); return '자리 비움 효율 +1%p (지금 ' + Math.round(offlineRate(state) * 100) + '%)'; }
    if (kind === 'perk' && !state.pendingPerks.length) {
      state.pendingPerks = drawPerks(state, rng); state.pendingRare = false;
      if (state.pendingPerks.length) return '이주 특전 1장 추가 선택';
    }
    // 부품이거나, 특전을 줄 수 없는 경우(이미 고르는 중이거나 전부 최대)의 대체 보상
    var parts = 8 * currentZone(state).no;
    state.parts += parts;
    return '부품 ' + parts + '개';
  }
  /** 과제가 없으면 새로 주고, 목표를 채웠으면 보상을 지급한다. 달성했을 때만 이벤트를 돌려준다. */
  function checkQuest(state, rng) {
    if (!state.quest) state.quest = generateQuest(state, rng);
    var q = state.quest;
    if (q.done || questProgress(state) < q.goal) return null;
    q.done = true;
    state.questsDone++;
    return { type: 'quest', text: questText(state), reward: grantQuestReward(state, q.reward, rng) };
  }

  /* ---------- 이주 특전 ---------- */
  function perkLevel(state, id) { return state.perks[id] || 0; }
  /** 아직 최대 레벨이 아닌 특전 중에서 서로 다른 3장을 뽑는다. 남은 종류가 적으면 있는 만큼만. */
  function drawPerks(state, rng) {
    rng = pickRng(rng);
    var pool = PERKS.filter(function (k) { return perkLevel(state, k.id) < k.max; }).map(function (k) { return k.id; });
    var out = [];
    while (out.length < PERK_CHOICES && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length) % pool.length, 1)[0]);
    return out;
  }
  /** 후보 중 하나를 고른다. 구역 경계 보상이면 3레벨, 아니면 1레벨 오른다(최대 레벨에서 멈춘다). */
  function choosePerk(state, id) {
    var def = findById(PERKS, id);
    if (!def) return fail('unknown');
    if (state.pendingPerks.indexOf(id) < 0) return fail('not-offered');
    var before = perkLevel(state, id);
    var level = Math.min(def.max, before + (state.pendingRare ? RARE_LEVELS : 1));
    state.perks[id] = level;
    state.pendingPerks = [];
    state.pendingRare = false;
    return { ok: true, id: id, name: def.name, level: level, gained: level - before };
  }

  /* ---------- 이주(프레스티지) ---------- */
  /**
   * 이주하면 얻는 항체 샘플: 항체 효과(생산 배수 = 1 + 0.1 × 항체)가 ANTIBODY_GROWTH 배가 되는 만큼.
   * 첫 이주는 1개, 그 뒤로는 가진 만큼에 비례해 늘어난다. 유물·제작·특전의 항체 보너스가 여기에 곱해진다.
   *
   * [알파 0.2 변경] 예전 식은 sqrt(모은 물자 / 100만)이었다. 두 가지 문제가 있었다.
   *   1) 항체가 요구 물자보다 훨씬 빨리 불어나, 중반부터 한 지구가 몇 초 만에 끝났다.
   *   2) "많이 모을수록 항체가 늘고, 항체가 늘수록 더 많이 모이는" 고리가 있어 수치가 폭주했다.
   * 그래서 모은 양과 무관하게, 이주 한 번의 성장 폭을 고정했다. 요구 물자(STEP_REQUIRE)가 이보다
   * 조금 빨리 자라므로 뒤로 갈수록 한 지구가 길어지고 더 깊은 시설까지 올리게 된다.
   */
  function antibodiesOnRelocate(state) {
    if (state.totalEarned < relocateRequirement(state)) return 0;
    return Math.max(1, Math.floor((1 / ANTIBODY_BONUS + state.antibodies) * (ANTIBODY_GROWTH - 1) * mods(state).antibody + 1e-9));
  }
  function canRelocate(state) {
    return state.totalEarned >= relocateRequirement(state) && antibodiesOnRelocate(state) >= 1;
  }
  /** 이주해도, 회차를 넘어가도 남는 것들을 새 상태로 옮긴다. */
  function carryPermanent(state, next) {
    next.lifetimeEarned = state.lifetimeEarned;
    next.breaches = state.breaches;
    next.clicks = state.clicks;
    next.bestWave = state.bestWave;
    next.bossKills = state.bossKills;
    next.expeditionsDone = state.expeditionsDone;
    next.signalsAnswered = state.signalsAnswered;
    next.relics = copyFlags(state.relics, RELICS);
    next.achievements = copyFlags(state.achievements, ACHIEVEMENTS);
    next.story = copyFlags(state.story, BEATS);
    next.parts = state.parts;
    next.autoExpedition = state.autoExpedition;
    next.auto = { fortify: state.auto.fortify, build: state.auto.build };
    GEAR.forEach(function (g) { if (state.gear[g.id]) next.gear[g.id] = state.gear[g.id]; });
    PERKS.forEach(function (k) { if (state.perks[k.id]) next.perks[k.id] = state.perks[k.id]; });
    next.antibodySpent = state.antibodySpent;
    SERUMS.forEach(function (k) { if (state.serums[k.id]) next.serums[k.id] = state.serums[k.id]; });
    next.questsDone = state.questsDone;
    next.bonus = { offlineCap: state.bonus.offlineCap, offlineRate: state.bonus.offlineRate, medals: state.bonus.medals };
    next.startedAt = state.startedAt;
    next.playSeconds = state.playSeconds;
    next.awaySeconds = state.awaySeconds;
    next.sectorLog = state.sectorLog.slice();
    next.zoneSeconds = state.zoneSeconds.slice();
    next.fastest = state.fastest;
    next.cycle = state.cycle;
    next.recruits = state.recruits;
    JOBS.forEach(function (j) { next.jobs[j.id] = state.jobs[j.id]; });
    next.eventIn = state.eventIn;       // 사건 간격은 이주와 무관하게 이어진다(떠 있던 사건은 두고 간다)
    next.lastEvent = state.lastEvent;
    next.eventsDone = state.eventsDone;
  }
  function relocate(state, now, rng) {
    var gain = antibodiesOnRelocate(state);
    if (!canRelocate(state)) return fail('not-ready');
    if (state.pendingPerks.length) return fail('choose-perk'); // 지난 특전을 고르지 않고는 또 떠날 수 없다
    var next = createState(now);
    next.antibodies = state.antibodies + gain;
    next.relocations = state.relocations + 1;
    carryPermanent(state, next);
    // 통계: 떠나는 지구에서 보낸 시간을 기록에 남기고 전체 누계를 넘긴다.
    var left = { step: stepIndex(state), seconds: state.sectorSeconds };
    next.sectorLog = state.sectorLog.concat([left]).slice(-SECTOR_LOG_MAX);
    next.zoneSeconds = state.zoneSeconds.slice();
    next.zoneSeconds[zoneIndex(state)] += left.seconds;
    next.fastest = !state.fastest || left.seconds < state.fastest.seconds ? left : state.fastest;
    normalizeJobs(next); // 구역을 넘었으면 생존자가 한 명 늘어 수색에 들어간다
    next.quest = generateQuest(next, rng); // 새 지구의 과제(끝내지 못한 과제는 사라진다)
    // 특전 후보를 지금 뽑아 저장해 둔다(새로 고쳐서 다시 뽑을 수 없게). 7-Z 재건에서는 구역이 바뀌지 않으므로 일반 보상이다.
    next.pendingPerks = drawPerks(next, rng);
    next.pendingRare = next.pendingPerks.length > 0 && zoneIndex(next) !== zoneIndex(state);
    // 선발 시설 특전: 수색조 몇 곳을 가지고 시작한다(매번 맨손으로 첫 물자를 모으지 않아도 되게).
    next.buildings.scouts = Math.floor(mods(next).startScouts);
    return { ok: true, gained: gain, state: next, zone: currentZone(next), label: zoneLabel(next) };
  }

  /* ---------- 다음 할 일 안내 ---------- */
  /**
   * 지금 상태에서 가장 먼저 권할 일 하나를 돌려준다 { id, text }.
   * 처음 하는 사람에게는 순서대로 배울 거리를, 익숙한 사람에게는 놓치기 쉬운 것을 알려 준다.
   * 위에서부터 처음 해당하는 항목이 뽑힌다: 급한 것(오늘 밤, 이주 가능)이 배울 거리보다 앞선다.
   */
  function nextGoal(state) {
    var stop = nextStop(state);
    function g(id, text) { return { id: id, text: text }; }
    if (state.pendingPerks.length) return g('perk', '이주 특전을 고른다.' + (state.pendingRare ? ' 구역을 넘은 보상이라 3레벨이 오른다.' : ''));
    if (state.clicks < 1 && state.lifetimeEarned === 0) return g('click', '잔해를 수색해 첫 물자를 모은다.');
    if ((state.buildings.scouts || 0) < 1 && totalBuildings(state) < 1) return g('scouts', '관리 > 시설에서 잔해 수색조를 꾸린다. 가만히 있어도 물자가 들어온다.');
    if (canRelocate(state)) return g('relocate', stop.atEnd ? '7-Z 를 다시 세울 수 있다.' : stop.label + ' 지구로 떠날 수 있다. 상황 > 이주.');
    if (defensePower(state) < nightStrength(state)) return g('defend', '오늘 밤을 막기엔 방어력이 모자라다. 관리 > 방벽에서 보강한다.');
    if (state.expeditionsDone < 1 && !state.expedition) return g('expedition', '원정대를 보낸다. 물자와 부품, 가끔 유물을 가져온다.');
    if (!state.autoExpedition && state.expeditionsDone >= 1) return g('auto', '원정의 "돌아오면 다시 보낸다"를 켜 두면 알아서 다녀온다.');
    if (countTrue(state.research, RESEARCH) < 1) return g('research', '관리 > 연구에서 첫 연구를 끝낸다.');
    if (totalGear(state) < 1) return g('craft', state.parts >= 2 ? '관리 > 제작에서 부품으로 장비를 만든다. 이주해도 남는다.' : '밤을 막거나 원정을 보내 부품을 모은다.');
    if (!totalSerums(state) && SERUMS.some(function (k) { return serumCost(state, k.id) <= antibodiesFree(state); })) return g('serum', '관리 > 혈청에서 항체 샘플로 영구 강화를 산다. 써도 생산 보너스는 줄지 않는다.');
    if (!state.gear.warden) return g('warden', '부품 16개로 방벽 담당을 제작하면 방벽을 알아서 보강한다.');
    if (!state.gear.builder) return g('builder', '부품 24개로 건설 담당을 제작하면 시설을 알아서 짓는다.');
    if (!state.gear.operator) return g('operator', '부품 10개로 무전병을 배치하면 구조 신호에 알아서 응답한다.');
    if (state.quest && !state.quest.done) return g('quest', '과제: ' + questText(state) + ' (보상: ' + questRewardName(state) + ')');
    return g('gather', '물자 ' + formatNumber(state.totalEarned) + ' / ' + formatNumber(relocateRequirement(state)) + ' 을 모으면 ' + (stop.atEnd ? '거점을 다시 세울 수 있다.' : stop.label + ' 지구로 떠날 수 있다.'));
  }

  /**
   * 하루의 어느 구간인가. { phase: 'day' | 'battle', left: 그 구간의 남은 초, total: 그 구간의 길이 }
   *   day    : 무리가 도착하기 전(하루의 앞 50초)
   *   battle : 무리가 도착해 방벽에서 싸우는 중(마지막 10초). 이 구간이 끝날 때의 방어력으로 승패가 갈린다.
   * 하루 길이와 승패 규칙은 바꾸지 않는다. 같은 60초를 두 구간으로 나눠 보여 줄 뿐이다.
   */
  function dayPhase(state) {
    var clock = Math.max(0, Math.min(DAY_SECONDS, safeNum(state.dayClock, 0))), arriveAt = DAY_SECONDS - BATTLE_SECONDS;
    if (clock < arriveAt) return { phase: 'day', left: arriveAt - clock, total: arriveAt };
    return { phase: 'battle', left: DAY_SECONDS - clock, total: BATTLE_SECONDS };
  }

  /* ---------- 생존자 배치 ---------- */
  /** 지금 함께하는 생존자 수: 넘어온 구역마다 1명 + 사건으로 받아들인 사람 + 끝낸 회차마다 6명. */
  function survivorCount(state) {
    return SURVIVORS_BASE + zoneIndex(state) + safeCount(state.recruits) + safeCount(state.cycle) * (ZONES.length - 1);
  }
  /**
   * 배치 인원의 합을 생존자 수에 맞춘다. 모자라면 수색에 넣고(새로 온 사람), 넘치면 가장 많은 일에서 뺀다.
   * 저장을 읽을 때, 이주했을 때, 생존자가 늘었을 때 부른다.
   */
  function normalizeJobs(state) {
    var total = survivorCount(state), sum = 0;
    JOBS.forEach(function (j) { state.jobs[j.id] = safeCount(state.jobs[j.id]); sum += state.jobs[j.id]; });
    if (sum < total) state.jobs.scavenge += total - sum;
    while (sum > total) {
      var big = JOBS[0];
      JOBS.forEach(function (j) { if (state.jobs[j.id] > state.jobs[big.id]) big = j; });
      state.jobs[big.id]--; sum--;
    }
  }
  /** 생존자 한 명을 from 일에서 to 일로 옮긴다. */
  function moveSurvivor(state, from, to) {
    if (!findById(JOBS, from) || !findById(JOBS, to) || from === to) return fail('unknown');
    if (!(state.jobs[from] > 0)) return fail('empty');
    state.jobs[from]--; state.jobs[to]++;
    return { ok: true, from: from, to: to };
  }
  /** 연구 하나의 값(연구에 배치한 생존자만큼 싸진다). 모르는 연구는 Infinity. */
  function researchCost(state, id) {
    var def = findById(RESEARCH, id);
    return def ? Math.ceil(def.cost * mods(state).researchCost) : Infinity;
  }

  /* ---------- 사건(선택지) ---------- */
  /** 지금 생산량의 n 초치 물자(생산이 거의 없을 때도 의미가 있도록 최소 50). 사건의 값과 보상은 이 단위로 매긴다. */
  function worth(state, n) { return Math.max(SIGNAL_SUPPLY_MIN, productionPerSec(state) * n); }
  /*
   * 사건: 가끔 일어나고 둘 중 하나를 고른다. EVENT_WINDOW 초 안에 고르지 않으면 기본 선택(def)으로 넘어간다.
   *   choices[i] = { label, desc(state) 화면에 보일 설명, can(state) 고를 수 있는가(없으면 언제나 가능), run(state, rng) 결과 문장 }
   * 기본 선택은 방치해도 손해가 없는 쪽이다. 기본 선택을 고를 수 없는 상황(물자 부족 등)이면 다른 쪽으로 넘어간다.
   * 생존자를 들이는 사건만은 기본이 '들인다'이다: 값은 치르지만 생존자는 계속 남는 이득이라, 방치하는 사람도 거점이 커지게 한다.
   */
  var EVENTS = [
    { id: 'stranger', title: '문을 두드리는 사람', text: '낯선 생존자가 방벽 앞에 서 있다. 지쳤지만 눈빛은 멀쩡하다.', def: 0, choices: [
      { label: '들인다', desc: function (s) { return '물자 ' + formatNumber(worth(s, 60)) + ' 을 내주고 생존자 한 명을 얻는다' + (s.recruits >= RECRUIT_MAX ? ' (더 받을 자리가 없다)' : ''); },
        can: function (s) { return s.recruits < RECRUIT_MAX && s.supplies >= worth(s, 60); },
        run: function (s) { s.supplies -= worth(s, 60); s.recruits++; normalizeJobs(s); return '생존자 한 명이 합류했다. 수색에 배치했다.'; } },
      { label: '돌려보낸다', desc: function () { return '아무 일도 없다'; }, run: function () { return '그는 말없이 돌아섰다.'; } } ] },
    { id: 'trader', title: '떠돌이 상인', text: '수레를 끄는 상인이 부품을 내놓는다. 값은 물자로 받겠다고 한다.', def: 1, choices: [
      { label: '산다', desc: function (s) { return '물자 ' + formatNumber(worth(s, 120)) + ' 으로 부품 ' + currentZone(s).no * 3 + '개'; },
        can: function (s) { return s.supplies >= worth(s, 120); },
        run: function (s) { s.supplies -= worth(s, 120); s.parts += currentZone(s).no * 3; return '부품 ' + currentZone(s).no * 3 + '개를 샀다.'; } },
      { label: '보낸다', desc: function () { return '아무 일도 없다'; }, run: function () { return '상인은 다음 거점으로 떠났다.'; } } ] },
    { id: 'cache', title: '무너진 창고', text: '수색조가 반쯤 무너진 창고를 찾았다. 안쪽은 어둡고 불안하다.', def: 0, choices: [
      { label: '입구만 턴다', desc: function (s) { return '물자 ' + formatNumber(worth(s, 90)) + ' 을 확실히 얻는다'; },
        run: function (s) { var g = worth(s, 90); earn(s, g); return '입구의 상자를 실어 왔다. 물자 ' + formatNumber(g) + '.'; } },
      { label: '깊이 들어간다', desc: function (s) { return '절반의 확률로 물자 ' + formatNumber(worth(s, 300)) + ', 아니면 빈손'; },
        run: function (s, rng) { if (rng() < 0.5) { var g = worth(s, 300); earn(s, g); return '안쪽에 손대지 않은 물자가 있었다. 물자 ' + formatNumber(g) + '.'; } return '천장이 내려앉아 빈손으로 돌아왔다.'; } } ] },
    { id: 'patrol', title: '밤 순찰 자원', text: '젊은 생존자 둘이 오늘 밤 방벽을 지키겠다고 나섰다.', def: 1, choices: [
      { label: '방벽에 세운다', desc: function (s) { return s.mercs ? '오늘 밤은 이미 방어력이 올라 있다' : '오늘 밤 방어력 ' + MERC_BONUS + '배'; },
        can: function (s) { return !s.mercs; },
        run: function (s) { s.mercs = true; return '오늘 밤 방벽에 사람이 더 선다.'; } },
      { label: '일을 시킨다', desc: function () { return '60초 동안 생산 2배'; },
        run: function (s) { s.buff = { mult: Math.max(2, s.buff ? s.buff.mult : 0), left: Math.max(60, s.buff ? s.buff.left : 0) }; return '둘은 밤새 짐을 날랐다. 60초 동안 생산 2배.'; } } ] },
    { id: 'sick', title: '열이 나는 아이', text: '아이 하나가 열이 높다. 물린 자국은 없다. 약은 넉넉하지 않다.', def: 1, choices: [
      { label: '약을 쓴다', desc: function (s) { return '물자 ' + formatNumber(worth(s, 90)) + ' 을 쓰고 항체 샘플 1개를 얻는다'; },
        can: function (s) { return s.supplies >= worth(s, 90); },
        run: function (s) { s.supplies -= worth(s, 90); s.antibodies += 1; return '아이는 이틀 만에 일어났다. 피에서 항체 샘플 1개를 얻었다.'; } },
      { label: '지켜본다', desc: function () { return '아무 일도 없다'; }, run: function () { return '열은 며칠 뒤에 내렸다.'; } } ] },
    { id: 'radio', title: '끊어진 방송', text: '무전기에서 잡음 사이로 사람 목소리가 들렸다 끊겼다.', def: 0, choices: [
      { label: '주파수를 맞춘다', desc: function () { return '곧 구조 신호가 잡힌다'; },
        run: function (s) { if (!(s.signalLeft > 0)) s.signalIn = Math.min(s.signalIn, 2); return '주파수를 찾았다. 곧 신호가 들어온다.'; } },
      { label: '전지를 아낀다', desc: function () { return '부품 1개를 얻는다'; }, run: function (s) { s.parts += 1; return '무전기를 끄고 전지를 챙겼다. 부품 1개.'; } } ] },
    { id: 'scrap', title: '버려진 화물차', text: '방벽 근처에 화물차 한 대가 서 있다. 뜯을 것이 많다.', def: 0, choices: [
      { label: '부품을 뜯는다', desc: function (s) { return '부품 ' + currentZone(s).no * 2 + '개'; },
        run: function (s) { s.parts += currentZone(s).no * 2; return '쓸 만한 부품 ' + currentZone(s).no * 2 + '개를 뜯었다.'; } },
      { label: '방벽 앞에 세운다', desc: function (s) { return s.mercs ? '오늘 밤은 이미 방어력이 올라 있다' : '오늘 밤 방어력 ' + MERC_BONUS + '배'; },
        can: function (s) { return !s.mercs; },
        run: function (s) { s.mercs = true; return '화물차로 길목을 막았다. 오늘 밤은 한결 든든하다.'; } } ] }
  ];
  /** 지금 떠 있는 사건을 화면에 쓰기 좋게 돌려준다. 없으면 null. { id, title, text, left, def, choices: [{ label, desc, can }] } */
  function eventView(state) {
    var def = state.event ? findById(EVENTS, state.event.id) : null;
    if (!def) return null;
    return { id: def.id, title: def.title, text: def.text, left: state.event.left, def: def.def,
      choices: def.choices.map(function (ch) { return { label: ch.label, desc: ch.desc(state), can: !ch.can || !!ch.can(state) }; }) };
  }
  /** 사건에서 index 번 선택을 고른다. 고를 수 없는 선택이면 실패. 결과 { ok, id, choice, label, text }. */
  function chooseEvent(state, index, rng) {
    var def = state.event ? findById(EVENTS, state.event.id) : null;
    if (!def) return fail('no-event');
    var ch = def.choices[index];
    if (!ch) return fail('unknown');
    if (ch.can && !ch.can(state)) return fail('cannot');
    var text = ch.run(state, typeof rng === 'function' ? rng : Math.random);
    state.event = null;
    state.lastEvent = def.id;
    state.eventsDone++;
    return { ok: true, id: def.id, title: def.title, choice: index, label: ch.label, text: text };
  }
  /** 시간이 다 됐을 때 넘어갈 선택: 기본 선택을 고를 수 있으면 그것, 아니면 고를 수 있는 다른 쪽. */
  function defaultChoice(state) {
    var def = state.event ? findById(EVENTS, state.event.id) : null;
    if (!def) return 0;
    var ch = def.choices[def.def];
    if (!ch.can || ch.can(state)) return def.def;
    for (var i = 0; i < def.choices.length; i++) if (!def.choices[i].can || def.choices[i].can(state)) return i;
    return def.def;
  }
  /** 사건의 시간을 dt 만큼 흘린다: 새 사건을 띄우거나, 시간이 다 된 사건을 기본 선택으로 넘긴다. */
  function stepEvent(state, dt, rng, events) {
    if (state.event) {
      state.event.left -= dt;
      if (state.event.left <= 0) {
        var r = chooseEvent(state, defaultChoice(state), rng);
        if (r.ok) { r.type = 'event-auto'; events.push(r); } else state.event = null; // 정의가 사라진 사건은 조용히 치운다
      }
      return;
    }
    state.eventIn -= dt;
    if (state.eventIn > 0) return;
    // 같은 사건이 연달아 나오지 않게 직전 것은 뺀다
    var pool = EVENTS.filter(function (e) { return e.id !== state.lastEvent; });
    var pick = pool[Math.floor(rng() * pool.length) % pool.length];
    if (state.eventsDone === 0) pick = findById(EVENTS, 'stranger'); // 첫 사건은 언제나 첫 생존자를 만나는 일이다
    state.event = { id: pick.id, left: EVENT_WINDOW };
    state.eventIn = EVENT_MIN + rng() * EVENT_SPREAD;
    events.push({ type: 'event', id: pick.id, title: pick.title });
  }

  /* ---------- 결말 이후: 회차 ---------- */
  /** 다음 회차를 시작할 수 있는가: 7-Z 에 와서 마지막 일지를 열었고, 고르지 않은 특전이 없을 것. */
  function canStartCycle(state) {
    return stepIndex(state) >= LAST_STEP && !!state.story[ENDING_BEAT] && !state.pendingPerks.length;
  }
  /**
   * 다음 회차를 시작한다: 1-A 로 돌아가되 더 거친 세계다.
   *   돌아가는 것 : 지구(1-A), 항체 샘플(0개), 물자·시설·방벽·연구·장비
   *   남는 것     : 혈청 레벨, 이주 특전, 제작한 것, 유물, 업적, 훈장, 생존자, 부품, 통계의 누계
   *   달라지는 것 : 끝낸 회차 하나마다 생산 +50%, 무리 규모 +50%, 이주 요구 물자 2배, 생존자 +6명
   */
  function startCycle(state, now, rng) {
    if (!canStartCycle(state)) return fail('not-ready');
    var next = createState(now);
    carryPermanent(state, next);
    next.cycle = state.cycle + 1;
    next.relocations = 0;
    next.antibodies = 0;
    next.antibodySpent = 0;               // 혈청 레벨은 남기고, 쓴 샘플 기록만 지운다(0개에서 다시 모은다)
    next.zoneSeconds = ZONES.map(function () { return 0; });
    next.sectorLog = [];
    next.fastest = null;
    normalizeJobs(next);
    next.quest = generateQuest(next, rng);
    return { ok: true, state: next, cycle: next.cycle };
  }

  /* ---------- 통계 ---------- */
  /**
   * 기록 > 통계 화면에 보일 값들을 계산한다. 상태를 바꾸지 않는다. now 는 현재 시각(ms).
   *   total          : 진행 시간(켜 둔 시간 + 인정받은 자리 비움)
   *   days           : 시작한 지 며칠째인지(시작 시각을 모르면 null)
   *   average        : 최근 지구들의 평균 소요 시간(기록이 없으면 null)
   *   remaining, eta : 7-Z 도착까지 남은 이주 횟수와, 최근 평균대로 간다면 남은 진행 시간(평균이 없으면 null)
   *   recent         : 최근 지구 기록 [{ label, seconds }], 최신이 앞
   *   zones          : 구역별 [{ no, name, seconds, sectors }] (떠난 지구 기준)
   */
  function stats(state, now) {
    var total = state.playSeconds + state.awaySeconds;
    var log = state.sectorLog, sum = 0;
    log.forEach(function (r) { sum += r.seconds; });
    var average = log.length ? sum / log.length : null;
    var step = stepIndex(state), remaining = LAST_STEP - step;
    var started = state.startedAt > 0 && typeof now === 'number' && isFinite(now) && now >= state.startedAt;
    return {
      play: state.playSeconds, away: state.awaySeconds, total: total,
      days: started ? Math.floor((now - state.startedAt) / 86400000) + 1 : null,
      sector: state.sectorSeconds, label: zoneLabel(state),
      average: average, remaining: remaining,
      eta: average === null ? null : Math.max(0, average * remaining - state.sectorSeconds), // 지금 지구도 남은 이주에 들어 있으므로 여기서 보낸 시간을 뺀다
      fastest: state.fastest ? { label: labelOf(state.fastest.step), seconds: state.fastest.seconds } : null,
      recent: log.slice().reverse().map(function (r) { return { label: labelOf(r.step), seconds: r.seconds }; }),
      zones: ZONES.map(function (z, i) {
        var done = Math.max(0, Math.min(SECTORS, step - i * SECTORS)); // 그 구역에서 떠난 지구 수
        return { no: z.no, name: z.name, seconds: state.zoneSeconds[i] || 0, sectors: done };
      }),
      relocations: state.relocations, clicks: state.clicks, lifetimeEarned: state.lifetimeEarned,
      bestWave: state.bestWave, breaches: state.breaches, bossKills: state.bossKills,
      expeditions: state.expeditionsDone, signals: state.signalsAnswered, quests: state.questsDone
    };
  }
  /** 초 → "3일 4시간", "2시간 5분", "4분 10초", "12초". 통계 화면의 시간 표기. */
  function formatDuration(sec) {
    if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) return '0초';
    sec = Math.floor(sec);
    var d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    if (d) return d + '일 ' + h + '시간';
    if (h) return h + '시간 ' + m + '분';
    if (m) return m + '분 ' + s + '초';
    return s + '초';
  }

  /* ---------- 첫걸음(튜토리얼) ---------- */
  /*
   * 처음 하는 사람이 첫 이주까지 따라갈 일의 목록. 새 저장 항목을 만들지 않고, 지금 상태에서 '했는지'를 읽어 낸다.
   *   done(s)  : 이미 해 본 일인가
   *   ready(s) : 지금 할 수 있는 일인가(없으면 언제나 가능). 신호처럼 기다려야 하는 단계가 다른 단계를 막지 않게 한다.
   *   view/tab : 그 일을 하는 화면(폰 하단 메뉴의 보기, 관리의 탭). '바로 가기' 단추가 쓴다.
   */
  var TUTORIAL = [
    { id: 'search',     view: 'base',   tab: null,        text: '"잔해 수색"을 눌러 첫 물자를 모은다.',
      done: function (s) { return s.clicks >= 1 || s.lifetimeEarned > 0; } },
    { id: 'build',      view: 'manage', tab: 'buildings', text: '관리 > 시설에서 잔해 수색조를 꾸린다. 그때부터는 가만히 있어도 물자가 들어온다.',
      done: function (s) { return totalBuildings(s) >= 1; } },
    { id: 'wall',       view: 'manage', tab: 'defenses',  text: '관리 > 방벽에서 방벽을 보강한다. 방어력이 오늘 밤 무리 규모보다 커야 한다.',
      done: function (s) { return totalDefenses(s) >= 1; } },
    { id: 'night',      view: 'base',   tab: null,        text: '해가 질 때까지 기다려 첫 밤을 막아낸다. 막으면 물자와 부품을 얻는다.',
      done: function (s) { return s.bestWave >= 1; } },
    { id: 'expedition', view: 'exped',  tab: null,        text: '원정대를 보낸다. 시간이 지나면 물자와 부품, 가끔 유물을 가지고 돌아온다.',
      done: function (s) { return s.expeditionsDone >= 1; },
      ready: function (s) { return !s.expedition; } },
    { id: 'research',   view: 'manage', tab: 'research',  text: '관리 > 연구에서 첫 연구를 끝낸다.',
      done: function (s) { return countTrue(s.research, RESEARCH) >= 1; } },
    { id: 'signal',     view: 'base',   tab: null,
      text: '구조 신호가 뜨면 ' + SIGNAL_WINDOW + '초 안에 응답한다. 물자 ' + SIGNAL_SUPPLY_SECONDS + '초치를 받거나 ' + BUFF_SECONDS + '초 동안 생산이 ' + BUFF_MULT + '배가 된다.',
      done: function (s) { return s.signalsAnswered >= 1; },
      ready: function (s) { return s.signalLeft > 0; } },
    { id: 'relocate',   view: 'base',   tab: null,        text: '물자를 모아 다음 지구로 이주한다. 항체 샘플을 얻어 다음 거점은 더 빨리 큰다.',
      done: function (s) { return s.relocations >= 1; } }
  ];
  function totalDefenses(s) {
    var n = 0;
    ALL_DEFENSES.forEach(function (d) { n += s.defenses[d.id] || 0; });
    return n;
  }
  /**
   * 첫걸음의 진행 상황 { steps: [{ id, text, view, tab, done }], count, total, done, current }.
   * current 는 지금 권할 단계: 안 한 것 중 지금 할 수 있는 첫 단계, 그런 것이 없으면 안 한 첫 단계.
   * 한 번이라도 이주했다면 전부 끝난 것으로 본다(시설·방벽은 이주할 때 비워지므로 다시 묻지 않기 위해서다).
   */
  function tutorial(state) {
    var veteran = state.relocations >= 1;
    var steps = TUTORIAL.map(function (t) {
      var done = veteran;
      if (!done) { try { done = !!t.done(state); } catch (e) { done = false; } } // 조건 하나의 오류가 안내를 멈추지 않게
      return { id: t.id, text: t.text, view: t.view, tab: t.tab, done: done };
    });
    var count = 0, current = null, firstOpen = null;
    for (var i = 0; i < steps.length; i++) {
      if (steps[i].done) { count++; continue; }
      if (!firstOpen) firstOpen = steps[i];
      var ready = true;
      try { ready = !TUTORIAL[i].ready || !!TUTORIAL[i].ready(state); } catch (e) { ready = true; }
      if (!current && ready) current = steps[i];
    }
    return { steps: steps, count: count, total: steps.length, done: count === steps.length, current: current || firstOpen };
  }
  /**
   * 화면의 '다음 할 일' 칸에 보일 내용 { label, id, text, view, tab }.
   * 첫걸음이 끝나기 전에는 첫걸음의 단계를, 끝난 뒤에는 nextGoal 을 보여 준다.
   * 다만 지금 당장 손써야 하는 일(특전 고르기, 오늘 밤 방어 부족, 이주 가능)은 첫걸음보다 먼저 알린다.
   */
  function guide(state) {
    var goal = nextGoal(state), t = tutorial(state);
    var urgent = goal.id === 'perk' || goal.id === 'relocate' || (goal.id === 'defend' && t.current && t.current.id !== 'wall');
    if (t.done || urgent) {
      var where = { defend: ['manage', 'defenses'], relocate: ['base', null] }[goal.id] || [null, null];
      return { label: '다음 할 일', id: goal.id, text: goal.text, view: where[0], tab: where[1] };
    }
    var step = t.current;
    return { label: '첫걸음 ' + Math.min(t.count + 1, t.total) + '/' + t.total, id: 'tutorial-' + step.id, text: step.text, view: step.view, tab: step.tab };
  }

  /* ---------- 저장 ---------- */
  function serialize(state) { return JSON.stringify(state); }
  /** 문자열을 상태로 복원한다. JSON 이 아니거나 버전이 맞지 않으면 Error 를 던진다. */
  function deserialize(text, now) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('저장 데이터가 비어 있습니다.');
    var raw;
    try { raw = JSON.parse(text); }
    catch (e) { throw new Error('저장 데이터를 읽을 수 없습니다. 코드가 잘렸는지 확인하세요.'); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('저장 데이터 형식이 올바르지 않습니다.');
    if (raw.version !== SAVE_VERSION) throw new Error('지원하지 않는 저장 버전입니다.');
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
    var digits = v < 10 ? 2 : v < 100 ? 1 : 0;
    var p = Math.pow(10, digits);
    var body = digits ? (Math.floor(v * p + 1e-9) / p).toFixed(digits) : Math.floor(v).toLocaleString('en-US');
    return sign + body + UNITS[k - 1];
  }

  return {
    SAVE_VERSION: SAVE_VERSION, DAY_SECONDS: DAY_SECONDS, BATTLE_SECONDS: BATTLE_SECONDS, dayPhase: dayPhase, BASE_DEFENSE: BASE_DEFENSE,
    BREACH_LOSS: BREACH_LOSS, OFFLINE_CAP: OFFLINE_CAP, OFFLINE_RATE: OFFLINE_RATE,
    BUILD_GROWTH: BUILD_GROWTH, BUILDING_MAX: BUILDING_MAX, DEFENSE_GROWTH: DEFENSE_GROWTH, MILESTONES: MILESTONES,
    ANTIBODY_BONUS: ANTIBODY_BONUS, WAVE_BONUS: WAVE_BONUS, ACH_BONUS: ACH_BONUS,
    BOSS_EVERY: BOSS_EVERY, BOSS_STRENGTH: BOSS_STRENGTH, BOSS_REWARD: BOSS_REWARD,
    SIGNAL_FIRST: SIGNAL_FIRST, SIGNAL_WINDOW: SIGNAL_WINDOW, BUFF_MULT: BUFF_MULT, BUFF_SECONDS: BUFF_SECONDS,
    SIGNAL_MIN: SIGNAL_MIN, SIGNAL_SPREAD: SIGNAL_SPREAD, SIGNAL_SUPPLY_SECONDS: SIGNAL_SUPPLY_SECONDS, SIGNAL_SUPPLY_MIN: SIGNAL_SUPPLY_MIN,
    TUTORIAL: TUTORIAL, tutorial: tutorial, guide: guide,
    CLICK_SHARE: CLICK_SHARE, clickSeconds: clickSeconds, clickPower: clickPower,
    JOBS: JOBS, JOB_STEP: JOB_STEP, SURVIVORS_BASE: SURVIVORS_BASE, RECRUIT_MAX: RECRUIT_MAX, survivorCount: survivorCount, moveSurvivor: moveSurvivor, researchCost: researchCost,
    EVENTS: EVENTS, EVENT_FIRST: EVENT_FIRST, EVENT_MIN: EVENT_MIN, EVENT_SPREAD: EVENT_SPREAD, EVENT_WINDOW: EVENT_WINDOW, eventView: eventView, chooseEvent: chooseEvent,
    CYCLE_BONUS: CYCLE_BONUS, CYCLE_THREAT: CYCLE_THREAT, CYCLE_REQUIRE: CYCLE_REQUIRE, canStartCycle: canStartCycle, startCycle: startCycle,
    stats: stats, formatDuration: formatDuration, SECTOR_LOG_MAX: SECTOR_LOG_MAX,
    ZONE_BUILDINGS: ZONE_BUILDINGS, ZONE_DEFENSES: ZONE_DEFENSES, ALL_BUILDINGS: ALL_BUILDINGS, ALL_DEFENSES: ALL_DEFENSES,
    buildingsFor: buildingsFor, defensesFor: defensesFor, zoneBuilding: zoneBuilding, zoneDefense: zoneDefense,
    horde: horde, isSurgeWave: isSurgeWave, strengthAt: strengthAt,
    BUILDINGS: BUILDINGS, DEFENSES: DEFENSES, UPGRADES: UPGRADES,
    RESEARCH: RESEARCH, EXPEDITIONS: EXPEDITIONS, RELICS: RELICS, ACHIEVEMENTS: ACHIEVEMENTS,
    QUESTS: QUESTS, QUEST_REWARDS: QUEST_REWARDS, OFFLINE_CAP_STEP: OFFLINE_CAP_STEP, OFFLINE_CAP_BONUS_MAX: OFFLINE_CAP_BONUS_MAX,
    OFFLINE_RATE_STEP: OFFLINE_RATE_STEP, OFFLINE_RATE_BONUS_MAX: OFFLINE_RATE_BONUS_MAX, MEDAL_BONUS: MEDAL_BONUS,
    offlineCap: offlineCap, questProgress: questProgress, questText: questText, questRewardName: questRewardName,
    generateQuest: generateQuest, checkQuest: checkQuest,
    SERUMS: SERUMS, SERUM_GROWTH: SERUM_GROWTH, antibodiesFree: antibodiesFree, serumLevel: serumLevel, serumCost: serumCost, buySerum: buySerum,
    PERKS: PERKS, PERK_CHOICES: PERK_CHOICES, RARE_LEVELS: RARE_LEVELS,
    perkLevel: perkLevel, totalPerks: totalPerks, drawPerks: drawPerks, choosePerk: choosePerk,
    maxBuildings: maxBuildings, maxDefenses: maxDefenses,
    GEAR: GEAR, SHOP: SHOP, BOSS_ANTIBODY: BOSS_ANTIBODY, MERC_BONUS: MERC_BONUS,
    nightParts: nightParts, expeditionParts: expeditionParts, gearLevel: gearLevel, gearCost: gearCost,
    craftGear: craftGear, setAutoExpedition: setAutoExpedition, autoFortify: autoFortify,
    setAuto: setAuto, autoActive: autoActive, autoBuild: autoBuild,
    defensePlan: defensePlan, fortify: fortify, defenseNeeded: defenseNeeded, nightForecast: nightForecast, shopPrice: shopPrice, bundleParts: bundleParts, buyShop: buyShop,
    ZONES: ZONES, BEATS: BEATS, SECTORS: SECTORS, LAST_STEP: LAST_STEP,
    STORY_SECTOR: STORY_SECTOR, STORY_WAVES: STORY_WAVES, STEP_THREAT: STEP_THREAT, STEP_REQUIRE: STEP_REQUIRE,
    stepIndex: stepIndex, zoneIndex: zoneIndex, sectorIndex: sectorIndex, currentZone: currentZone,
    zoneLabel: zoneLabel, nextStop: nextStop, zoneThreat: zoneThreat,
    relocateRequirement: relocateRequirement, canRelocate: canRelocate, nextGoal: nextGoal,
    checkStory: checkStory, storyLog: storyLog,
    createState: createState, sanitizeState: sanitizeState, mods: mods,
    bulkCost: bulkCost, maxAffordable: maxAffordable, buildingCost: buildingCost, defenseCost: defenseCost,
    milestoneMult: milestoneMult, nextMilestone: nextMilestone, globalMult: globalMult,
    buildingRate: buildingRate, productionPerSec: productionPerSec, currentRate: currentRate, clickValue: clickValue,
    defensePower: defensePower, breachLoss: breachLoss, offlineRate: offlineRate,
    currentWave: currentWave, isBossWave: isBossWave, hordeStrength: hordeStrength,
    nightStrength: nightStrength, hordeReward: hordeReward,
    scavenge: scavenge, buyBuilding: buyBuilding, buyDefense: buyDefense,
    buyUpgrade: buyUpgrade, buyResearch: buyResearch,
    expeditionUnlocked: expeditionUnlocked, expeditionDuration: expeditionDuration,
    expeditionReward: expeditionReward, startExpedition: startExpedition, cancelExpedition: cancelExpedition,
    answerSignal: answerSignal, checkAchievements: checkAchievements, achievementCount: achievementCount,
    tick: tick, resolveNight: resolveNight, applyOffline: applyOffline,
    antibodiesOnRelocate: antibodiesOnRelocate, relocate: relocate,
    serialize: serialize, deserialize: deserialize, formatNumber: formatNumber
  };
});
