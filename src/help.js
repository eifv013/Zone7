/*
 * Help — 도움말 글 (알파 0.6 의 새 구조)
 * ------------------------------------------------------------
 * 기록 > 도움말 탭에 보이는 설명을 만든다. 화면(DOM)을 만지지 않는 순수 모듈이다.
 * 숫자를 글에 직접 적지 않고 GameCore 의 상수와 정의표에서 읽어 온다. 밸런스를 고쳤을 때
 * 도움말만 옛 숫자로 남는 일을 막기 위해서다(테스트가 이를 검사한다).
 *
 *   Help.sections(core) → [{ id, tab(탭에 쓰는 짧은 이름), title, items: [문장, ...] }, ...]
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Help = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 낱말 뒤에 '은' 또는 '는'을 붙인다. 받침이 있으면 '은'(환승역은), 없으면 '는'(주택가는). 한글로 끝나지 않으면 '는'. */
  function topic(word) {
    var code = String(word).charCodeAt(String(word).length - 1);
    var hangul = code >= 0xAC00 && code <= 0xD7A3;
    return word + (hangul && (code - 0xAC00) % 28 !== 0 ? '은' : '는');
  }
  function pct(x) { return Math.round(x * 100) + '%'; }
  function span(sec) {
    if (sec >= 3600 && sec % 3600 === 0) return sec / 3600 + '시간';
    if (sec >= 60 && sec % 60 === 0) return sec / 60 + '분';
    return sec + '초';
  }

  /** 도움말 항목을 만든다. 필요한 상수가 없으면(모듈이 어긋난 빌드) 조용히 "undefined" 를 적는 대신 오류를 낸다. */
  function sections(core) {
    if (!core || typeof core !== 'object') throw new Error('도움말: GameCore 가 필요하다.');
    ['DAY_SECONDS', 'BATTLE_SECONDS', 'BREACH_LOSS', 'WAVE_BONUS', 'BOSS_EVERY', 'BOSS_STRENGTH', 'BOSS_REWARD', 'NIGHT_REWARD_SECONDS', 'CLICK_SHARE',
      'SIGNAL_WINDOW', 'SIGNAL_SUPPLY_SECONDS', 'BUFF_MULT', 'BUFF_SECONDS', 'OFFLINE_CAP', 'OFFLINE_RATE', 'PERK_CHOICES',
      'PRICE_STEP', 'PRICE_FLOOR', 'PRICE_CEIL', 'PEAK_PRICE', 'GOODS_CAP_SECONDS', 'RETREAT_MIN', 'STEADY_AT', 'STEADY_BONUS', 'ROUTE_SLOTS', 'STREAK_MAX', 'STREAK_BONUS', 'SURGE_MULT', 'SURGE_SECONDS', 'SURGE_COOLDOWN', 'GREEN_SECONDS', 'GREEN_COOLDOWN', 'ASSIST_STEP', 'PET_PULL_SHARE', 'PET_PULL_MIN', 'PET_DUP_REFUND', 'PET_NAME_MAX', 'SWEEP_TILES', 'SWEEP_BONUS_CLICKS', 'SWEEP_AUTO_SECONDS', 'OFFER_COUNT', 'PROJECT_GROWTH', 'REROLL_SHARE'].forEach(function (k) {
      if (typeof core[k] !== 'number' || !isFinite(core[k])) throw new Error('도움말: 상수 ' + k + ' 가 없다.');
    });
    if (!Array.isArray(core.ZONES) || !Array.isArray(core.TRAITS) || !Array.isArray(core.PERKS) || typeof core.formatNumber !== 'function') throw new Error('도움말: 정의표가 없다.');
    var fmt = core.formatNumber;
    var ready = core.ZONES.filter(function (z) { return z.kind !== 'soon'; });
    var next = core.ZONES[ready.length];

    return [
      { id: 'flow', tab: '처음', title: '어떤 게임인가요', items: [
        '1구역에서 시작해 ' + core.ZONES.length + '구역까지 거점을 쌓아 올리는 게임이에요. 다음 구역으로 넘어가도 앞 구역은 남아서 계속 물자를 보내 줘요.',
        '구역마다 하는 일이 달라요. ' + ready.map(function (z) { return z.no + '구역 ' + z.name + '(' + z.lead + ')'; }).join(', ') + ' 순서예요.',
        '방치형이라 꺼 두었다 켜도 그동안의 몫을 받아요. 뭘 해야 할지 모르겠으면 화면의 "다음 할 일"을 따라가면 돼요.',
        '지금은 ' + ready.length + '구역까지 만들어져 있어요.' + (next ? ' ' + next.no + '구역 ' + topic(next.name) + ' 문 앞까지만 갈 수 있고, 다음 버전에서 열려요.' : '') ] },

      { id: 'zone', tab: '구역', title: '구역과 목표', items: [
        '구역 화면의 번호 탭에서 구역을 골라요. 구역 화면은 운영, 개조, 목표로 나뉘어 있어요. "구역 지도"를 누르면 구역마다 얼마를 버는지 한눈에 볼 수 있어요.',
        '구역마다 목표가 셋 있어요. 하나를 달성할 때마다 특전 ' + core.PERK_CHOICES + '장 중 하나를 골라요.',
        '목표 셋을 모두 채우고 물자를 치르면 다음 구역의 문이 열려요. 뒤 구역일수록 문 값이 훨씬 비싸요.',
        '뒤 구역을 열면 밤에 오는 무리도 커져요(구역 하나마다 3배).' ] },

      { id: 'map', tab: '1구역', title: '1구역: 수색 지도', items: [
        '동네 하나는 ' + core.SWEEP_TILES + '칸이에요. 칸을 누르면 그 칸을 뒤져서 물자를 얻어요. "잔해 수색" 단추는 다음 칸을 뒤지는 것과 같아요.',
        '칸마다 나오는 것이 달라요. ' + core.TILE_KINDS.map(function (k) { return k.name + '(수익 ' + k.mult + '배)'; }).join(', ') + '. 뒤져 봐야 알 수 있어요.',
        core.SWEEP_TILES + '칸을 다 뒤지면 직접 수색 ' + core.SWEEP_BONUS_CLICKS + '번치 보너스를 받고 다음 동네로 넘어가요.',
        '시설이 하나라도 있으면 ' + span(core.SWEEP_AUTO_SECONDS) + '마다 한 칸씩 알아서 뒤져요. 가만히 있어도 동네는 넘어가요.' ] },

      { id: 'click', tab: '수색', title: '직접 수색', items: [
        '"잔해 수색"을 누르면 물자를 바로 얻어요. 한 번의 기본 수익은 초당 생산의 ' + pct(core.CLICK_SHARE) + ' 에 전체 생산 배수를 더한 값이에요.',
        '수색 배수가 두 배가 될 때마다 수익이 기본의 1배씩 늘어요(2배 → 2배, 4배 → 3배, 8배 → 4배).',
        '거점이 비어 있는 판 초반에 첫 물자를 모으기 좋아요. 열심히 눌러도 가만히 둘 때보다 조금 빠른 정도라, 누르지 않아도 뒤처지지 않아요.' ] },

      { id: 'trade', tab: '2구역', title: '2구역: 거래', items: [
        '좌판이 상품을 만들어요. 상품은 시세를 곱한 값에 팔려요.',
        '시세는 ' + span(core.PRICE_STEP) + '마다 ' + core.PRICE_FLOOR + ' ~ ' + core.PRICE_CEIL + ' 사이에서 바뀌어요. 개조(흥정, 단골)로 범위를 올릴 수 있어요.',
        '상품은 좌판이 ' + span(core.GOODS_CAP_SECONDS) + ' 동안 만드는 양까지만 쌓여요.',
        '"창고가 차면 알아서 판다"가 켜져 있으면(기본) 가만히 둬도 평균 시세만큼은 벌어요. 시세가 높을 때 직접 팔면 그보다 더 벌고요.',
        '시세판에는 지난 시세가 막대로 남아요. 맨 오른쪽이 지금 시세고, 점선이 평균, 굵은 선이 고점이에요.',
        '연속 호가: 평균 이상의 시세에서 팔리면 한 단계씩 쌓여요(시세 하나에 한 번, 최대 ' + core.STREAK_MAX + '단계). 단계마다 판매 값이 ' + pct(core.STREAK_BONUS) + ' 늘어요. 자동 판매로도 쌓여요. 평균 아래에서 직접 팔 때만 끊겨요.',
        '시세 ' + core.PEAK_PRICE + ' 이상에서 판 것은 "고점 판매"로 세요. 2구역 목표 가운데 하나예요.' ] },

      { id: 'line', tab: '3구역', title: '3구역: 생산 라인', items: [
        '기계 셋(' + core.MACHINES.map(function (m) { return m.name; }).join(' → ') + ')이 차례로 맞물려 돌아요. 만든 완제품은 바로 물자가 돼요.',
        '라인은 가장 느린 기계(병목)의 속도로만 나와요. 빠른 기계를 더 올려도 산출은 늘지 않아요. "병목 올리기"를 누르면 그때 가장 느린 기계가 올라요.',
        '기계마다 레벨당 처리량이 달라요(' + core.MACHINES.map(function (m) { return m.name + ' ' + m.rate; }).join(', ') + '). 처리량이 비슷해지게 맞추면 돼요.',
        '가동률은 가장 느린 기계 ÷ 가장 빠른 기계예요. 가동률 ' + pct(core.STEADY_AT) + ' 이상이면 "정속 가동"이 되어 산출이 ' + pct(core.STEADY_BONUS) + ' 늘어나요.',
        '기계 레벨의 합계가 ' + core.LINE_MILESTONES.slice(0, 4).join(', ') + '… 에 닿을 때마다 라인 전체가 2배가 돼요.',
        '"전력 투입"을 누르면 ' + span(core.SURGE_SECONDS) + ' 동안 라인이 ' + core.SURGE_MULT + '배로 돌아요. ' + span(core.SURGE_COOLDOWN) + ' 뒤에 다시 쓸 수 있어요. 영구 특성 "자동화"를 찍으면 알아서 들어가요.',
        '자리를 비워도 라인은 나갈 때의 상태 그대로 돌아요. 정속으로 맞춰 두고 나가면 그 시간도 정속 가동으로 쳐 줘요.' ] },

      { id: 'rail', tab: '4구역', title: '4구역: 노선', items: [
        '노선을 복구하고 열차를 사면 운행이 시작돼요. 열차는 달리는 동안 화물을 싣고, 돌아왔을 때 한꺼번에 물자로 바뀌어요.',
        '노선은 넷이에요. ' + core.ROUTES.map(function (r) { return r.name + '(' + span(r.seconds) + ', 화물 ×' + r.mult + ')'; }).join(', ') + '. 멀리 가는 노선일수록 같은 시간에 더 많이 실어요.',
        '열차는 화물 배수가 높은 노선부터 알아서 타요. 노선 한 단계마다 열차 ' + core.ROUTE_SLOTS + '대가 다닐 수 있고, 자리가 없는 열차는 쉬어요.',
        '그래서 고를 것은 열차를 살지, 노선을 늘릴지, 어느 노선을 늘릴지예요. 먼 노선은 비싸지만 열차 한 대가 버는 양이 커요.',
        '열차가 ' + core.FLEET_MILESTONES.slice(0, 4).join(', ') + '… 대에 닿을 때마다 화물이 2배가 돼요.',
        '"청신호"를 누르면 달리는 열차들이 ' + span(core.GREEN_SECONDS) + '만큼 앞서 달려요. ' + span(core.GREEN_COOLDOWN) + ' 뒤에 다시 켤 수 있어요. 영구 특성 "자동화"를 찍으면 알아서 켜져요.',
        '자리를 비운 동안에도 열차는 다녀요. 돌아온 화물은 자리 비움 효율로 받아요.' ] },

      { id: 'lab', tab: '5구역', title: '5구역: 연구', items: [
        '연구원을 뽑으면 연구 점수가 모여요. 이 구역은 물자를 직접 만들지 않고, 대신 이번 판의 다른 구역들을 강하게 만들어요.',
        '과제는 한 번에 ' + core.OFFER_COUNT + '개가 나와요. 점수를 써서 하나를 끝내면 효과를 얻고, 과제 ' + core.OFFER_COUNT + '개가 모두 새로 바뀌어요.',
        '과제: ' + core.PROJECTS.map(function (p) { return p.name + '(' + p.desc + ')'; }).join(', ') + '.',
        '같은 과제를 또 끝내면 효과가 곱으로 쌓여요. 대신 과제를 하나 끝낼 때마다 다음 과제에 드는 점수가 ' + core.PROJECT_GROWTH + '배가 돼요. 그래서 무엇을 먼저 키울지가 중요해요.',
        '마음에 드는 과제가 없으면 "다른 과제 보기"로 다시 뽑을 수 있어요. 과제 값의 ' + pct(core.REROLL_SHARE) + ' 만큼 점수가 들어요.',
        '자리를 비운 동안에도 점수는 모여요. 철수하면 끝낸 과제의 효과는 사라져요.' ] },

      { id: 'night', tab: '밤', title: '밤과 방벽', items: [
        '하루는 ' + span(core.DAY_SECONDS) + '예요. ' + span(core.DAY_SECONDS - core.BATTLE_SECONDS) + '가 지나면 무리가 도착하고, 남은 ' + span(core.BATTLE_SECONDS) + ' 동안 방벽에서 싸워요.',
        '승패는 그 ' + span(core.BATTLE_SECONDS) + '가 끝날 때의 방어력으로 갈려요. 싸우는 중에도 보강할 수 있어요.',
        '막으면 생산 ' + span(core.NIGHT_REWARD_SECONDS) + '치 물자를 얻어요. 이번 판에서 막아낸 밤 한 번마다 생산도 ' + pct(core.WAVE_BONUS) + ' 씩 늘어나요.',
        '못 막으면 물자의 ' + pct(core.BREACH_LOSS) + ' 를 잃고 농성에 들어가요. 농성 중에는 더 잃지 않지만 얻는 것도 없어요. 한 번 막아내면 풀려요.',
        core.BOSS_EVERY + '번째 밤마다 변이체가 와요. 규모가 ' + core.BOSS_STRENGTH + '배지만, 막으면 전리품도 ' + core.BOSS_REWARD + '배예요.',
        '무리는 밤마다 커져서 언젠가는 막을 수 없게 돼요. 그때가 철수를 생각할 때예요.',
        '가진 방어 수단 가운데 하나가 밤마다 주역으로 뽑혀 방벽 위에 크게 올라와요. 주역마다 싸우는 모습이 달라요. 많이 산 것일수록 자주 나와요. 보이는 모습만 다르고 승패는 방어력으로 정해져요.'
      ] },

      { id: 'retreat', tab: '철수', title: '철수와 항체 샘플', items: [
        '이번 판에서 물자 ' + fmt(core.RETREAT_MIN) + ' 을 모으면 철수할 수 있어요(상황 > 철수).',
        '철수하면 거점을 전부 버리고 1구역에서 다시 시작해요. 물자, 시설, 방벽, 구역 개조, 연 구역, 특전이 사라져요.',
        '대신 항체 샘플을 얻어요. 이번 판에서 물자를 많이 모았을수록 많이 받아요. 물자를 100배 더 모으면 샘플은 6배쯤이에요.',
        '벽에 막혀 진행이 느려졌을 때 철수하는 게 좋아요. 너무 일찍 하면 샘플이 적고, 너무 늦으면 시간이 아까워요.',
        '읽은 일지와 통계는 그대로 남아요.' ] },

      { id: 'trait', tab: '특성', title: '특성과 특전', items: [
        '영구 특성은 항체 샘플로 찍어요(특성 화면). 철수해도 남아요.',
        '영구 특성: ' + core.TRAITS.map(function (t) { return t.name + '(' + t.desc + ')'; }).join(', ') + '.',
        '"자동화"는 전력 투입과 청신호를 알아서 써 주는 특성이에요. 2레벨부터는 레벨마다 대기 시간이 ' + pct(core.ASSIST_STEP) + ' 씩 줄어요(절반까지).',
        '"특성 되돌리기"를 누르면 쓴 샘플을 모두 돌려받아요. 값이 들지 않으니 판마다 다르게 찍어 봐도 좋아요.',
        '특전은 이번 판에만 쓰여요. 같은 특전을 또 고르면 레벨이 올라요.',
        '특전: ' + core.PERKS.map(function (p) { return p.name + '(' + p.desc + ')'; }).join(', ') + '.' ] },

      { id: 'pet', tab: '일행', title: '일행과 동물 친구', items: [
        '특성 화면의 "일행"에서 강아지나 고양이를 데려올 수 있어요. 첫 친구는 그냥 와요.',
        '등급이 있어요. ' + core.PET_RARITIES.map(function (r) { return r.name + ' ' + r.weight + '%(강아지 방어력 +' + Math.round(r.dog * 100) + '%, 고양이 전체 생산 +' + Math.round(r.cat * 100) + '%)'; }).join(', ') + '.',
        '다시 데려오려면 항체 샘플이 들어요. 값은 지금까지 얻은 항체 샘플 총량의 ' + pct(core.PET_PULL_SHARE) + ' 예요(최소 ' + core.PET_PULL_MIN + '개). 이미 함께 있는 아이가 또 나오면 ' + pct(core.PET_DUP_REFUND) + ' 를 돌려받아요.',
        '한 번 데려온 아이는 계속 일행에 남아요. 그중 누구를 데리고 다닐지 고를 수 있고, 효과는 데리고 다니는 아이 것만 적용돼요.',
        '친구들: ' + core.PET_BREEDS.map(function (b) { return b.name; }).join(', ') + '.',
        '친구와 주인공의 이름은 언제든 바꿀 수 있어요(' + core.PET_NAME_MAX + '글자까지). 철수해도 모두 함께 가요.' ] },

      { id: 'signal', tab: '신호', title: '구조 신호', items: [
        '가끔 무전기에 구조 신호가 잡혀요. 보유 물자 아래에 단추가 뜨는데, ' + span(core.SIGNAL_WINDOW) + ' 안에 누르면 응답할 수 있어요.',
        '응답하면 둘 중 하나를 얻어요(반반). 생산 ' + span(core.SIGNAL_SUPPLY_SECONDS) + '치 물자, 또는 ' + span(core.BUFF_SECONDS) + ' 동안 생산 ' + core.BUFF_MULT + '배예요. 놓쳐도 잃는 것은 없어요.' ] },

      { id: 'away', tab: '자리 비움', title: '자리 비움', items: [
        '게임을 꺼 둔 동안에도 물자가 쌓여요. 최대 ' + span(core.OFFLINE_CAP) + '치를, 평소 생산의 ' + pct(core.OFFLINE_RATE) + ' 효율로 받아요.',
        '2구역은 평균 시세로 판 것으로 쳐요. 3구역 라인은 나갈 때의 상태 그대로 돈 것으로 쳐요. 4구역 열차는 그동안 다녀온 만큼 화물을 내려요.',
        '자리를 비운 동안에도 밤은 지나가요. 막을 수 있는 밤은 막아서 전리품을 얻고, 못 막는 밤부터는 잃는 것 없이 버티기만 해요.' ] },

      { id: 'etc', tab: '그 밖에', title: '그 밖에', items: [
        '진행은 10초마다 자동으로 저장돼요. 기록 > 설정에서 저장 코드를 복사해 두면 백업이 돼요.',
        '알파 0.5 까지의 저장은 구조가 달라서 이어지지 않아요.',
        '사건, 생존자 배치, 원정은 뒤 구역을 만들면서 다시 넣을 예정이에요.',
        '기록 > 설정에서 테마, 효과음, 진동, 숫자 표기(1.23억 / 1.23e8), 새 일지를 바로 띄울지, 화면 흔들림을 바꿀 수 있어요.'
      ] }
    ];
  }

  return { sections: sections, pct: pct, span: span, topic: topic };
});
