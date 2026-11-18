/*
 * Boot — 시작 화면(로딩)
 * ------------------------------------------------------------
 * 게임을 열면 플레이 화면이 바로 나오지 않고, 제목과 진행 막대가 있는 시작 화면이 먼저 나온다.
 *
 * 두 부분으로 나뉜다.
 *   1) createBoot: 화면(DOM)을 모르는 계산부. "지금 막대를 몇 %로 그릴까, 닫아도 되나"만 판단한다. Node 에서 테스트한다.
 *   2) mount:     실제 화면을 움직이는 부분. 0.05초마다 계산부에 물어 막대와 문구를 고친다.
 *
 * 진행 단계는 실제로 일어나는 일이다(가짜 대기가 아니다). ui.js 가 그 일을 마칠 때마다 mark 로 알린다.
 *   page  페이지가 도착했다         code  게임 코드를 다 읽었다
 *   save  저장을 불러왔다           ready 첫 화면을 그렸다
 * 다만 이 일들은 보통 눈 깜짝할 사이에 끝나므로, 화면이 번쩍하고 사라지지 않게 최소 시간(minMs) 동안은 막대가 차오르는 것을 보여 준다.
 * 반대로 무언가 잘못돼 끝내 준비되지 않아도 maxMs 가 지나면 닫는다: 시작 화면이 게임(과 오류 안내)을 영영 가리면 안 된다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Boot = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 단계: id, 여기까지 오면 채워지는 비율, 이 단계를 "하는 중"에 보여 줄 문구. 순서대로 진행한다. */
  var STAGES = [
    { id: 'page', upTo: 0.25, text: '신호를 잡는 중' },
    { id: 'code', upTo: 0.55, text: '장비를 푸는 중' },
    { id: 'save', upTo: 0.85, text: '거점을 확인하는 중' },
    { id: 'ready', upTo: 1, text: '문을 여는 중' }
  ];
  var MIN_MS = 2200, MAX_MS = 9000;      // 최소 2.2초는 보여 준다: 제목과 도움말 한 줄을 읽을 틈
  var TIPS = [
    '자리를 비워도 거점은 돌아가요. 최대 4시간, 절반 효율이에요.',
    '방어력이 무리 규모보다 커야 밤을 넘길 수 있어요.',
    '시세가 높을 때 팔면 같은 상품으로 더 벌어요.',
    '철수하면 거점은 잃지만 항체 샘플은 남아요.',
    '구역 목표를 채울 때마다 특전을 하나 골라요.',
    '다음 구역을 열어도 앞 구역은 계속 물자를 보내 줘요.'
  ];

  function finite(n, fallback) { return typeof n === 'number' && isFinite(n) ? n : fallback; }

  /**
   * 계산부를 만든다. opts: { now: 시작 시각(ms), minMs, maxMs }. 잘못된 값은 기본값으로 바꾼다.
   * 모든 함수는 예외를 던지지 않는다: 시작 화면의 오류가 게임 시작을 막으면 안 된다.
   */
  function createBoot(opts) {
    opts = opts || {};
    var startedAt = finite(opts.now, 0);
    var minMs = Math.max(0, finite(opts.minMs, MIN_MS));
    var maxMs = Math.max(minMs, finite(opts.maxMs, MAX_MS));
    var reached = -1;      // 마친 단계 중 가장 뒤의 것(STAGES 의 번호)
    var forced = false;    // 오류 등으로 당장 닫아야 하는가

    function elapsed(now) { return Math.max(0, finite(now, startedAt) - startedAt); }
    /** 실제 진행 비율(0~1). */
    function real() { return reached < 0 ? 0 : STAGES[reached].upTo; }

    return {
      /** 단계를 마쳤다고 알린다. 모르는 이름은 무시하고, 뒤 단계를 마쳤으면 앞 단계도 마친 것으로 본다. */
      mark: function (id) {
        for (var i = 0; i < STAGES.length; i++) if (STAGES[i].id === id && i > reached) reached = i;
      },
      /** 기다리지 않고 닫는다(시작 중 오류, 또는 뷰어가 진행 중인 게임을 넘겨받아 다시 여는 경우). */
      skip: function () { forced = true; },
      /** 막대에 그릴 비율(0~1). 실제 진행을 넘지 않고, 최소 시간에 맞춰 차오른다. */
      shown: function (now) {
        var byTime = minMs > 0 ? elapsed(now) / minMs : 1;
        return Math.max(0, Math.min(1, real(), byTime));
      },
      /** 지금 보여 줄 문구: 막대가 아직 닿지 못한 첫 단계의 것. */
      text: function (now) {
        var p = this.shown(now);
        for (var i = 0; i < STAGES.length; i++) if (p < STAGES[i].upTo) return STAGES[i].text;
        return STAGES[STAGES.length - 1].text;
      },
      /** 닫아도 되는가: 준비가 끝났고 최소 시간도 지났거나, 강제로 닫으라고 했거나, 너무 오래 걸렸다. */
      canClose: function (now) {
        if (forced || elapsed(now) >= maxMs) return true;
        return reached === STAGES.length - 1 && elapsed(now) >= minMs;
      },
      /** 준비가 안 됐는데 시간이 다 돼서 닫는 것인가(기록용). */
      timedOut: function (now) { return !forced && reached < STAGES.length - 1 && elapsed(now) >= maxMs; }
    };
  }

  /** 도움말 한 줄을 고른다. rand 는 0 이상 1 미만의 수를 돌려주는 함수(테스트에서는 고정값을 넣는다). */
  function pickTip(rand) {
    var r = finite(typeof rand === 'function' ? rand() : NaN, 0);
    return TIPS[Math.min(TIPS.length - 1, Math.max(0, Math.floor(r * TIPS.length)))];
  }

  /**
   * 시작 화면을 실제로 움직인다. 페이지의 #boot 를 찾아 막대·문구를 갱신하고, 닫을 때가 되면 흐리게 지운 뒤 없앤다.
   * 돌려주는 것: { mark(id), skip() } — ui.js 가 진행을 알릴 때 쓴다. #boot 가 없으면 아무 일도 하지 않는 같은 모양의 객체를 준다.
   */
  function mount(doc, win) {
    var nothing = { mark: function () {}, skip: function () {} };
    try {
      var box = doc && doc.getElementById('boot');
      if (!box) return nothing;
      var bar = doc.getElementById('boot-bar'), text = doc.getElementById('boot-text'), tip = doc.getElementById('boot-tip');
      // 제목 글꼴이 도착했는지 본다(2.6.5). 도착했을 때만 제목의 숫자 7을 키운다(.seven). 확인하지 못하는 브라우저에서는 그대로 둔다.
      try {
        var fontOk = function () { try { if (doc.fonts && doc.fonts.check && doc.fonts.check('40px "Black Han Sans"', '7구역')) doc.body.classList.add('font-display-ok'); } catch (e) { /* 그대로 둔다 */ } };
        if (doc.fonts && doc.fonts.load) doc.fonts.load('40px "Black Han Sans"', '7구역').then(fontOk, function () {});
        if (doc.fonts && doc.fonts.ready && doc.fonts.ready.then) doc.fonts.ready.then(fontOk, function () {});
      } catch (e) { /* 글꼴은 없어도 된다 */ }
      var boot = createBoot({ now: Date.now() });
      var timer = null, closed = false;
      if (tip) tip.textContent = pickTip(Math.random);
      boot.mark('page');

      var close = function () {
        if (closed) return;
        closed = true;
        if (timer) win.clearInterval(timer);
        if (boot.timedOut(Date.now()) && win.console) win.console.warn('boot', '준비가 끝나지 않았지만 시작 화면을 닫는다.');
        box.className += ' boot-out';                                   // 0.3초 동안 흐려진다. 이때부터 터치는 게임으로 간다.
        win.setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 350);
      };
      var paint = function () {
        try {
          var now = Date.now();
          if (bar) bar.style.width = Math.round(boot.shown(now) * 100) + '%';
          if (text) text.textContent = boot.text(now) + '…';
          if (boot.canClose(now)) close();
        } catch (e) { close(); }
      };
      timer = win.setInterval(paint, 50);
      paint();
      // 시작 도중 오류가 나면 기다리지 않고 닫는다. 게임 쪽의 오류 안내가 가려지지 않게.
      win.addEventListener('error', function () { boot.skip(); });
      return { mark: function (id) { boot.mark(id); }, skip: function () { boot.skip(); paint(); } };
    } catch (e) {
      // 시작 화면을 못 띄워도 게임은 열려야 한다. 남아 있으면 지운다.
      try { var b = doc.getElementById('boot'); if (b && b.parentNode) b.parentNode.removeChild(b); } catch (e2) { /* 더 할 수 있는 일이 없다 */ }
      return nothing;
    }
  }

  return { STAGES: STAGES, TIPS: TIPS, MIN_MS: MIN_MS, MAX_MS: MAX_MS, createBoot: createBoot, pickTip: pickTip, mount: mount };
});
