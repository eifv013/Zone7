/*
 * Help — 도움말 글 (알파 0.6 의 새 구조)
 * ------------------------------------------------------------
 * 기록 > 도움말 탭에 보이는 설명을 만든다. 화면(DOM)을 만지지 않는 순수 모듈이다.
 * 숫자를 글에 직접 적지 않고 GameCore 의 상수와 정의표에서 읽어 온다. 밸런스를 고쳤을 때
 * 도움말만 옛 숫자로 남는 일을 막기 위해서다(테스트가 이를 검사한다).
 *
 *   Help.sections(core) → [{ id, title, items: [문장, ...] }, ...]
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Help = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

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
      'PRICE_STEP', 'PRICE_FLOOR', 'PRICE_CEIL', 'PEAK_PRICE', 'GOODS_CAP_SECONDS', 'RETREAT_MIN'].forEach(function (k) {
      if (typeof core[k] !== 'number' || !isFinite(core[k])) throw new Error('도움말: 상수 ' + k + ' 가 없다.');
    });
    if (!Array.isArray(core.ZONES) || !Array.isArray(core.TRAITS) || !Array.isArray(core.PERKS) || typeof core.formatNumber !== 'function') throw new Error('도움말: 정의표가 없다.');
    var fmt = core.formatNumber;
    var ready = core.ZONES.filter(function (z) { return z.kind !== 'soon'; });
    var next = core.ZONES[ready.length];

    return [
      { id: 'flow', title: '어떤 게임인가', items: [
        '1구역에서 시작해 ' + core.ZONES.length + '구역까지 거점을 쌓아 올린다. 구역을 넘어가도 앞 구역은 남아서 계속 물자를 보낸다.',
        '구역마다 하는 일이 다르다. ' + ready.map(function (z) { return z.no + '구역 ' + z.name + '는 ' + z.lead; }).join(', ') + '.',
        '방치형이다. 꺼 두었다 켜도 그동안의 몫을 받는다. 무엇을 할지 모르겠으면 화면의 "다음 할 일"을 따라가면 된다.',
        '알파 ' + '0.6 에서는 ' + ready.length + '구역까지 만들어져 있다.' + (next ? ' ' + next.no + '구역 ' + next.name + '는 문 앞까지만 갈 수 있고, 다음 버전에서 열린다.' : '') ] },

      { id: 'zone', title: '구역과 목표', items: [
        '구역 화면의 탭으로 구역을 고른다. 구역마다 시설과 강화 목록이 따로 있다.',
        '구역마다 목표가 셋 있다. 하나를 달성할 때마다 특전 ' + core.PERK_CHOICES + '장 중 하나를 고른다.',
        '목표 셋을 모두 채우고 물자를 치르면 다음 구역의 문이 열린다. 뒤 구역일수록 문 값이 훨씬 비싸다.',
        '뒤 구역을 열면 밤에 오는 무리도 커진다(구역 하나마다 3배).' ] },

      { id: 'click', title: '직접 수색', items: [
        '"잔해 수색"을 누르면 물자를 바로 얻는다. 한 번의 기본 수익은 초당 생산의 ' + pct(core.CLICK_SHARE) + ' 에 전체 생산 배수를 더한 값이다.',
        '수색 배수가 두 배가 될 때마다 수익이 기본의 1배씩 는다(2배 → 2배, 4배 → 3배, 8배 → 4배).',
        '거점이 빈 판 초반에 첫 물자를 모으는 데 좋다. 열심히 눌러도 가만히 둘 때보다 조금 빠른 정도라, 누르지 않아도 뒤처지지 않는다.' ] },

      { id: 'trade', title: '2구역: 거래', items: [
        '좌판이 상품을 만든다. 상품은 시세를 곱한 값에 팔린다.',
        '시세는 ' + span(core.PRICE_STEP) + '마다 ' + core.PRICE_FLOOR + ' ~ ' + core.PRICE_CEIL + ' 사이에서 바뀐다. 강화(흥정, 단골)로 범위를 올릴 수 있다.',
        '상품은 좌판이 ' + span(core.GOODS_CAP_SECONDS) + ' 동안 만드는 양까지 쌓인다. 그 뒤로는 더 쌓이지 않는다.',
        '"창고가 차면 알아서 판다"가 켜져 있으면(기본) 가만히 둬도 평균 시세만큼은 번다. 시세가 높을 때 직접 팔면 그보다 더 번다.',
        '시세 ' + core.PEAK_PRICE + ' 이상에서 판 것은 "고점 판매"로 센다. 2구역 목표 가운데 하나다.' ] },

      { id: 'night', title: '밤과 방벽', items: [
        '하루는 ' + span(core.DAY_SECONDS) + '이다. ' + span(core.DAY_SECONDS - core.BATTLE_SECONDS) + '가 지나면 무리가 도착하고, 남은 ' + span(core.BATTLE_SECONDS) + ' 동안 방벽에서 싸운다.',
        '승패는 그 ' + span(core.BATTLE_SECONDS) + '가 끝날 때의 방어력으로 갈린다. 싸우는 중에도 보강할 수 있다.',
        '막으면 생산 ' + span(core.NIGHT_REWARD_SECONDS) + '치 물자를 얻고, 이번 판에서 막아낸 밤 한 번마다 생산이 ' + pct(core.WAVE_BONUS) + ' 늘어난다.',
        '못 막으면 물자의 ' + pct(core.BREACH_LOSS) + ' 를 잃고 농성에 들어간다. 농성 중에는 더 잃지 않지만 얻는 것도 없다. 한 번 막아내면 풀린다.',
        core.BOSS_EVERY + '번째 밤마다 변이체가 온다. 규모가 ' + core.BOSS_STRENGTH + '배지만 막으면 전리품이 ' + core.BOSS_REWARD + '배다.',
        '무리는 밤마다 커진다. 언젠가는 막을 수 없게 된다. 그때가 철수를 생각할 때다.' ] },

      { id: 'retreat', title: '철수와 항체 샘플', items: [
        '이번 판에서 물자 ' + fmt(core.RETREAT_MIN) + ' 을 모으면 철수할 수 있다(상황 > 철수).',
        '철수하면 거점을 전부 버리고 1구역에서 다시 시작한다. 물자, 시설, 방벽, 구역 강화, 연 구역, 특전이 사라진다.',
        '대신 항체 샘플을 얻는다. 이번 판에서 물자를 많이 모았을수록 많이 받는다. 물자를 100배 더 모으면 샘플은 6배쯤이다.',
        '벽에 막혀 진행이 느려졌을 때 철수하는 것이 좋다. 너무 일찍 철수하면 샘플이 적고, 너무 늦으면 시간이 아깝다.',
        '읽은 일지와 통계는 남는다.' ] },

      { id: 'trait', title: '특성과 특전', items: [
        '영구 특성은 항체 샘플로 찍는다(특성 화면). 철수해도 남는다.',
        '영구 특성: ' + core.TRAITS.map(function (t) { return t.name + '(' + t.desc + ')'; }).join(', ') + '.',
        '"특성 되돌리기"를 누르면 쓴 샘플을 모두 돌려받는다. 값이 들지 않으니 판마다 다르게 찍어 봐도 된다.',
        '특전은 이번 판에만 유효하다. 같은 특전을 또 고르면 레벨이 오른다.',
        '특전: ' + core.PERKS.map(function (p) { return p.name + '(' + p.desc + ')'; }).join(', ') + '.' ] },

      { id: 'signal', title: '구조 신호', items: [
        '가끔 무전기에 구조 신호가 잡힌다. 보유 물자 아래에 단추가 뜨고, ' + span(core.SIGNAL_WINDOW) + ' 안에 누르면 응답한다.',
        '응답하면 둘 중 하나를 얻는다(반반). 생산 ' + span(core.SIGNAL_SUPPLY_SECONDS) + '치 물자, 또는 ' + span(core.BUFF_SECONDS) + ' 동안 생산 ' + core.BUFF_MULT + '배다. 놓쳐도 잃는 것은 없다.' ] },

      { id: 'away', title: '자리 비움', items: [
        '게임을 꺼 둔 동안에도 물자가 쌓인다. 최대 ' + span(core.OFFLINE_CAP) + '치를, 평소 생산의 ' + pct(core.OFFLINE_RATE) + ' 효율로 받는다.',
        '2구역은 평균 시세로 판 것으로 친다.',
        '자리를 비운 동안에도 밤은 지나간다. 막을 수 있는 밤은 막아 전리품을 얻고, 못 막는 밤부터는 잃는 것 없이 버티기만 한다.' ] },

      { id: 'etc', title: '그 밖에', items: [
        '진행은 10초마다 자동으로 저장된다. 기록 > 설정에서 저장 코드를 복사해 두면 백업이 된다.',
        '알파 0.5 까지의 저장은 구조가 달라 이어지지 않는다.',
        '사건, 생존자 배치, 원정은 뒤 구역을 만들면서 다시 넣을 예정이다.' ] }
    ];
  }

  return { sections: sections, pct: pct, span: span };
});
