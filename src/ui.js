/*
 * 화면 계층 — GameCore 의 상태를 그리고, 입력을 GameCore 함수 호출로 바꾼다.
 * 규칙 계산은 여기서 하지 않는다. 구성:
 *   Store   : localStorage 래퍼 (실패해도 게임은 계속된다)
 *   Cloud   : 계정별 서버 저장. 게시된 페이지에서만 켜지고, 없으면 조용히 Store 만 쓴다
 *   build   : 구역 탭, 시설·좌판·강화·방벽·특성 목록을 한 번만 만든다
 *   render  : 0.1초마다 바뀐 글자만 갱신한다
 *   Story   : 새 일지가 열릴 때의 연출(어두운 화면에 타자기처럼 찍힌다)
 *   sfx     : 효과음(Sound 모듈). 없으면 조용히 건너뛴다
 *   scene   : 도트 화면(Scene 모듈). 상태를 읽어 가기만 하고, 없어도 게임은 돌아간다
 *   frame   : 시간 진행 → 이벤트 로그 → 자동 저장 → render
 */
(function () {
  'use strict';
  var C = window.GameCore;
  var $ = function (id) { return document.getElementById(id); };

  // 핵심 모듈이 없으면 빈 화면 대신 이유를 보여 준다.
  if (!C) {
    document.body.insertAdjacentHTML('afterbegin',
      '<p class="fatal">게임 규칙 모듈을 불러오지 못했습니다. 페이지를 새로 고쳐 주세요.</p>');
    return;
  }

  var SAVE_KEY = 'zone7-save-v2';   // 알파 0.6 부터 구조가 달라져 예전 저장(beyond-barricade-save-v1)은 읽지 않는다
  var AUTOSAVE_MS = 10000;
  var AWAY_THRESHOLD = 60;   // 프레임 간격이 이보다 길면 '자리 비움'으로 처리(초)
  var LOG_MAX = 40;
  var fmt = C.formatNumber;

  var state = null;
  var qtyMode = 1;           // 1 | 10 | 'max'
  var railFlash = {};        // 노선별로 마지막 열차가 도착한 시각(ms): 노선도에서 도착 불빛을 잠깐 켠다
  var pane = 'play';         // 구역 화면 안에서 보고 있는 것: 'play'(운영) | 'up'(강화) | 'goal'(목표)
  var tab = 'z0';            // 구역 화면에서 보고 있는 탭: 'z0'(1구역), 'z1'(2구역), 'z2'(3구역 문 앞), 'wall'(방벽)
  var lastFrame = 0, lastSave = 0, nextFlavor = 0;
  var guideNow = null; // 지금 '다음 할 일' 칸에 보이는 안내(바로 가기 단추가 읽는다)
  var frameErrorShown = false;
  var paused = false;        // 다른 기기가 진행 중이라 이 기기가 멈춰 있는지(Cloud 가 관리한다)
  var fxShow = null;         // 화면 효과를 띄우는 함수(wire 가 채운다). 큰 일이 있을 때마다 쓴다: 구역 이동, 철수, 도전 시작·성공·실패
  var MOVE_FX = ['tape', 'shutter', 'stamp', 'blinds'], lastFx = '';      // 구역 이동·철수 효과의 종류와 바로 앞에 쓴 것
  /** 효과 하나를 고른다. 바로 앞의 것(prev)은 빼고 고른다. */
  function pickMoveFx(prev, rng) {
    var pool = MOVE_FX.filter(function (k) { return k !== prev; });
    return pool[Math.floor((typeof rng === 'function' ? rng() : Math.random()) * pool.length) % pool.length];
  }
  var scene = null;          // 도트 화면 핸들(캔버스를 못 쓰는 환경이면 null)
  var heldLogged = false;    // 이번 농성에서 '버텼다' 로그를 이미 남겼는지(1분마다 같은 줄이 쌓이지 않게)
  /** 효과음. 모듈이 없거나 소리를 못 내는 환경이면 아무 일도 하지 않는다. */
  function sfx(name) { try { if (window.Sound) window.Sound.play(name); } catch (e) { /* 소리는 없어도 된다 */ } }

  /* ---------- 일지 연출 ---------- */
  var Story = {
    queue: [], timer: null, full: '', shown: 0,
    /** 새 일지를 대기열에 넣는다. 이미 하나가 떠 있으면 닫힌 뒤에 이어서 나온다. */
    push: function (zoneLabel, text, title) {
      Story.queue.push({ zone: zoneLabel, text: text, title: title || '' });
      if ($('story').hidden) Story.next();
    },
    next: function () {
      var item = Story.queue.shift();
      if (!item) { $('story').hidden = true; return; }
      Story.full = item.text; Story.shown = 0;
      setText($('story-zone'), item.zone); setText($('story-title'), item.title);
      $('story-text').textContent = '';
      $('story').hidden = false;
      sfx('story');
      try { $('story-close').focus(); } catch (e) { /* 초점을 못 옮겨도 진행한다 */ }
      var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (still) { Story.finish(); return; }
      Story.timer = setInterval(function () {
        Story.shown++;
        var box = $('story-text');
        box.textContent = Story.full.slice(0, Story.shown);
        box.scrollTop = box.scrollHeight;                    // 긴 글은 쓰이는 줄을 따라 내려간다
        if (Story.shown % 4 === 0) sfx('type');
        if (Story.shown >= Story.full.length) Story.finish();
      }, 22);
    },
    finish: function () {
      clearInterval(Story.timer); Story.timer = null;
      Story.shown = Story.full.length;
      $('story-text').textContent = Story.full; $('story-text').scrollTop = 0;      // 다 나오면 처음부터 읽게 맨 위로
    },
    /** 한 번 누르면 남은 글을 전부 보여 주고, 다 나온 뒤에 누르면 닫는다. */
    advance: function () {
      if (Story.timer) Story.finish();
      else Story.next();
    }
  };
  var journalKey = '';       // 일지 패널을 마지막으로 그렸을 때의 상태(바뀔 때만 다시 그린다)
  var rows = { buildings: {}, defenses: {}, upgrades: {}, research: {}, gear: {}, shop: {}, expeditions: {}, relics: {}, achievements: {}, perks: {}, serums: {}, jobs: {} };
  var perkShown = '';        // 지금 특전 선택 화면에 띄워 둔 후보(바뀔 때만 다시 그린다)

  // 패치노트는 src/notes.js 에 있다(업데이트 알림과 빌드 스크립트도 같은 목록을 쓴다).
  var PATCH_NOTES = window.PatchNotes || [];

  /* ---------- 저장소 ---------- */
  var Store = {
    /** { state, error } 를 돌려준다. 저장이 없으면 둘 다 null. */
    load: function () {
      var raw;
      try { raw = localStorage.getItem(SAVE_KEY); }
      catch (e) { return { state: null, error: '이 브라우저에서는 자동 저장을 쓸 수 없습니다. 저장 코드를 복사해 두세요.' }; }
      if (!raw) return { state: null, error: null };
      try { return { state: C.deserialize(raw, Date.now()), error: null }; }
      catch (e) { return { state: null, error: '저장 데이터가 손상되어 새 거점에서 시작합니다.' }; }
    },
    save: function () {
      try {
        state.lastSeen = Date.now();
        localStorage.setItem(SAVE_KEY, C.serialize(state));
        return true;
      } catch (e) { return false; }
    },
    clear: function () { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 지울 것이 없다 */ } }
  };

  /* ---------- 계정 저장 ---------- */
  var CLOUD_TEXT = {
    none: '자동으로 저장돼요',
    connecting: '계정 저장 연결 중…',
    on: '계정에 자동 저장 중 · 다른 기기에서 열면 이어진다',
    retry: '계정 저장이 잠시 안 된다. 곧 다시 시도한다',
    off: '계정 저장을 쓸 수 없어 이 브라우저에만 저장한다',
    standby: '다른 기기에서 진행 중 · 이 기기는 멈춰 있다'
  };
  var CLOUD_EVERY_MS = 60000;
  /** 정해진 시간 안에 끝나지 않는 요청은 실패로 본다(연결이 막힌 환경에서 무한 대기 방지). */
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject({ code: 'unavailable', message: 'timeout' }); }, ms);
      promise.then(function (v) { clearTimeout(timer); resolve(v); },
                   function (e) { clearTimeout(timer); reject(e); });
    });
  }
  /**
   * 계정 저장 — "한 번에 한 기기" 방식
   * ------------------------------------------------------------
   * 뷰어 본인만 읽고 쓸 수 있는 서버 문서 한 개를 쓴다.
   *   { json: 저장 내용, savedAt: 쓴 시각, device: 지금 진행 중인 기기, wants: 넘겨받기를 요청한 기기 }
   *
   * 기기는 네 가지 역할 중 하나다.
   *   owner   : 진행 중인 기기. 1분마다 서버에 올린다.
   *   standby : 다른 기기가 진행 중이라 멈춰 있다. "여기서 이어하기"만 누를 수 있다.
   *   taking  : 넘겨받기를 요청하고 기다리는 중.
   *   none    : 아직 서버와 맞춰 보지 않았다(시작 직후).
   *
   * 넘겨받는 흐름: 이 기기가 wants 에 자기 이름을 적는다 → 진행 중이던 기기가 그것을 보고
   * 자기 최신 진행을 올리면서 device 를 이쪽으로 바꾸고 멈춘다 → 이 기기가 그 진행을 받아 이어 간다.
   * 상대가 꺼져 있어 4초 안에 답이 없으면 서버에 남은 마지막 저장을 가져와 이어 간다.
   *
   * 서버 문서의 변화는 onSnapshot 으로 곧바로 듣고, 그것이 안 되는 환경에 대비해 1분마다 직접 읽는다.
   * 모든 처리는 한 줄로 세워 차례대로 실행한다(읽는 도중에 쓰는 일이 없도록).
   */
  var DEVICE_KEY = 'zone7-device', STAMP_KEY = 'zone7-sync';
  var LIVE_MS = 150000;        // 마지막 저장이 이보다 최근이면 그 기기가 아직 켜져 있다고 본다
  var HANDOFF_WAIT_MS = 4000;  // 넘겨받기 요청 뒤 상대의 응답을 기다리는 시간
  /*
   * 설정: 기기에 따로 기억한다(저장 코드에는 들어가지 않는다). 모르는 값은 기본값으로 읽는다.
   *   vibrate 진동, notation 숫자 표기, storyPop 새 일지를 바로 띄울지, shake 화면 흔들림
   */
  var PREF_DEFAULTS = { vibrate: 'on', notation: 'kr', storyPop: 'on', shake: 'on', names: 'on' };
  var PREF_VALUES = { vibrate: ['on', 'off'], notation: ['kr', 'sci'], storyPop: ['on', 'off'], shake: ['on', 'off'], names: ['on', 'off'] };
  var prefs = { vibrate: 'on', notation: 'kr', storyPop: 'on', shake: 'on', names: 'on' };
  function setPref(name, value, keep) {
    if (!PREF_VALUES[name]) return;
    prefs[name] = PREF_VALUES[name].indexOf(value) >= 0 ? value : PREF_DEFAULTS[name];
    if (name === 'notation') C.setNotation(prefs.notation);
    if (name === 'shake') document.body.setAttribute('data-shake', prefs.shake);
    if (keep) remember('zone7-pref-' + name, prefs[name]);
    document.querySelectorAll('[data-pref="' + name + '"]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-value') === prefs[name] ? 'true' : 'false'); });
  }
  function wirePrefs() {
    Object.keys(PREF_DEFAULTS).forEach(function (name) { setPref(name, recall('zone7-pref-' + name), false); });
    document.querySelectorAll('[data-pref]').forEach(function (b) {
      b.addEventListener('click', function () { setPref(b.getAttribute('data-pref'), b.getAttribute('data-value'), true); buzz(12); });
    });
  }
  /*
   * 이름표: 도트 화면은 너무 작아서(80칸) 글자를 그릴 수 없으므로, 화면 위에 글자를 겹쳐 놓고 주인공을 따라다니게 한다.
   *   따라다니면 그림을 가리므로 도트 화면의 왼쪽 아래 구석에 고정해 둔다: '주인공 · 동물 친구'. 밤 싸움 중이거나 설정에서 끄면 숨긴다.
   *   자리는 도트 화면 모델의 주인공 위치(hero.x)를 화면 너비에 대한 비율로 옮긴 것이다.
   */
  function renderNames() {
    var tag = $('tag-hero');
    if (!tag) return;
    var show = prefs.names === 'on';
    tag.hidden = !show;
    if (!show) return;
    var pet = C.petInfo(state);
    setText($('tag-hero-name'), state.heroName || C.HERO_DEFAULT);
    setText($('tag-pet-name'), pet ? ' · ' + pet.name : '');
  }
  /*
   * 앱 알림(안드로이드 앱에서만): 앱이 Zone7Native 라는 통로를 내어 준다. 브라우저에는 없으므로 그때는 설정 줄을 숨긴다.
   *   - 켬/끔은 앱이 기억한다(getNotify / setNotify).
   *   - 알림 문구에 들어갈 주인공과 동물 친구의 이름을 바뀔 때마다 알려 준다(setNames).
   * 통로가 없거나 부르다 실패해도 게임은 그대로 간다.
   */
  var nativeNames = '';
  function nativeApp() { try { return window.Zone7Native && typeof window.Zone7Native.setNames === 'function' ? window.Zone7Native : null; } catch (e) { return null; } }
  function syncNative() {
    var app = nativeApp();
    if (!app) return;
    var pet = C.petInfo(state), key = (state.heroName || '') + '|' + (pet ? pet.name : '');
    if (key === nativeNames) return;
    nativeNames = key;
    try { app.setNames(state.heroName || C.HERO_DEFAULT, pet ? pet.name : ''); } catch (e) { /* 알림 문구만 예전 이름으로 남는다 */ }
  }
  /*
   * 웹 앱 알림(아이폰 등, 홈 화면에 추가한 경우): 폰 안에서 예약할 수 없어서 알림 서버(push/worker.js)에 맡긴다.
   *   켤 때   : 알림 허락을 받고, 서버의 공개 키로 구독한다.
   *   닫을 때 : 알림 목록(C.noticePlan)을 폰의 서비스 워커가 읽을 곳에 적어 두고, 서버에는 "언제 깨워 달라"는 시각만 보낸다.
   *   열 때   : 서버에 맡긴 것을 취소한다.
   * 서버에는 글이 가지 않는다(시각과 알림 주소뿐). 무슨 글을 띄울지는 서비스 워커가 적어 둔 목록에서 고른다.
   * PUSH_SERVER 가 비어 있거나 기기가 지원하지 않으면 이 기능은 없는 것처럼 동작한다.
   */
  var PUSH_SERVER = 'https://zone7-push.eifv013.workers.dev';      // 알림 서버(push/worker.js)를 올린 주소
  var PUSH_KEY = 'zone7-push', PUSH_INDEX = 'zone7-push-index', PUSH_BACK_AT = 'zone7-push-back';
  var NOTICE_CACHE = 'zone7-notice', NOTICE_PLAN = './notice-plan';      // 서비스 워커(sw.js)와 맞춘 이름
  function webPushReady() {
    try { return !!(PUSH_SERVER && window.ZONE7_PWA && !nativeApp() && navigator.serviceWorker && window.PushManager && window.Notification && window.caches); }
    catch (e) { return false; }
  }
  function b64ToBytes(text) {
    var raw = atob(String(text).replace(/-/g, '+').replace(/_/g, '/')), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function pushPost(path, body) {
    return fetch(PUSH_SERVER + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true });
  }
  /** 알림을 켠다: 허락 → 구독. 성공하면 true. 사용자가 누른 순간에 불러야 한다(아이폰은 그렇지 않으면 허락 창을 띄우지 않는다). */
  async function webPushOn() {
    var perm = await Notification.requestPermission();
    if (perm !== 'granted') return false;
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    if (!sub) {
      var res = await fetch(PUSH_SERVER + '/key'), data = await res.json();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(data.key) });
    }
    return !!sub;
  }
  async function webPushOff() {
    try {
      var reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
      if (sub) { try { await pushPost('/cancel', { endpoint: sub.endpoint }); } catch (e) { /* 서버가 못 받아도 구독은 끊는다 */ } await sub.unsubscribe(); }
    } catch (e) { /* 끊지 못해도 설정은 꺼 둔다 */ }
  }
  /** 화면이 가려질 때: 알림을 맡긴다. 다시 보일 때: 취소한다. */
  async function webPushSync(hidden) {
    if (!webPushReady() || recall(PUSH_KEY) !== 'on') return;
    try {
      var reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
      if (!sub) return;
      if (!hidden) {
        // 24시간 알림이 이미 나갔다면 다음에는 다음 문구를 쓴다
        var backAt = Number(recall(PUSH_BACK_AT)) || 0;
        if (backAt && Date.now() >= backAt) remember(PUSH_INDEX, (Number(recall(PUSH_INDEX)) || 0) + 1);
        remember(PUSH_BACK_AT, 0);
        await pushPost('/cancel', { endpoint: sub.endpoint });
        return;
      }
      var plan = C.noticePlan(state, Date.now(), Number(recall(PUSH_INDEX)) || 0);
      remember(PUSH_BACK_AT, plan[1].at);
      var box = await caches.open(NOTICE_CACHE);
      await box.put(NOTICE_PLAN, new Response(JSON.stringify({ items: plan }), { headers: { 'Content-Type': 'application/json' } }));
      await pushPost('/schedule', { endpoint: sub.endpoint, times: plan.map(function (p) { return p.at; }) });
    } catch (e) { /* 알림은 없어도 게임에는 지장이 없다 */ }
  }
  /**
   * 두 손가락으로 번갈아 누르기: 폰 브라우저는 손가락 하나가 닿아 있는 동안 다른 손가락의 누르기(click)를 만들어 주지 않는다.
   * 그래서 손가락이 둘 이상 닿은 동안에는, 뗀 손가락이 "누르기"였으면(C.isTap) 그 단추를 직접 눌러 준다.
   * 빠르게 두 번 누를 때도 같은 방법을 쓴다: 아이폰은 두 번 누르면 화면을 키우는데, 두 번째 누르기를 직접 처리해서 막는다.
   * 그 밖에 손가락 하나로 누를 때는 브라우저가 하던 대로 둔다(겹쳐서 두 번 눌리지 않게).
   */
  function wireMultiTouch() {
    var starts = {}, multi = false, lastEnd = 0, synth = { btn: null, at: 0 };
    try {
      // 직접 눌러 준 단추에 브라우저의 누르기가 뒤따라오면 버린다(한 번 눌렀는데 두 번 사지 않게)
      document.addEventListener('click', function (e) {
        if (e.isTrusted && synth.btn && Date.now() - synth.at < 100 &&      /* 같은 손가락에서 곧바로 뒤따라온 것만 버린다. 창이 길면(전에는 0.45초) 조금 느리게 이어 누른 것까지 버려졌다 */ synth.btn.contains(e.target)) { e.stopImmediatePropagation(); e.preventDefault(); }
      }, true);
      /*
       * 누름 표시(노란 채움, 1.5.1): 실제로 눌린 순간(click)에만 켠다.
       *   전에는 손이 닿는 순간(touchstart)에 켰다. 그래서 화면을 밀어 올리려고 줄에 손을 대기만 해도 노랗게 번쩍였고, 정작 눌린 것과 번쩍임이 따로 놀았다.
       *   click 은 손으로 누른 것과 대신 눌러 준 것(여러 손가락, 빠른 두 번) 모두에서 한 번씩 난다.
       */
      document.addEventListener('click', function (e) {
        var pr = e.target && e.target.closest ? e.target.closest('button.row') : null;
        if (!pr || pr.disabled) return;
        pr.classList.remove('pressed'); void pr.offsetWidth; pr.classList.add('pressed');
        clearTimeout(pr.__pressT); pr.__pressT = setTimeout(function () { pr.classList.remove('pressed'); }, 180);
      }, true);
      document.addEventListener('touchstart', function (e) {
        if (e.touches.length > 1) multi = true;
        for (var i = 0; i < e.changedTouches.length; i++) {
          var t = e.changedTouches[i]; starts[t.identifier] = { x: t.clientX, y: t.clientY, at: Date.now(), target: t.target };
        }
      }, { passive: true });
      document.addEventListener('touchend', function (e) {
        var made = false, now = Date.now(), quick = now - lastEnd < 350;      // quick: 빠르게 두 번 누름(아이폰은 이때 화면을 키운다)
        lastEnd = now;
        for (var i = 0; i < e.changedTouches.length; i++) {
          var t = e.changedTouches[i], s = starts[t.identifier];
          delete starts[t.identifier];
          // 살 수 없는 줄(물자 부족)을 눌렀으면 값이 붉게 흔들린다: 눌리긴 했는데 물자가 모자라다는 것을 알려 준다
          var off = s && s.target && s.target.closest ? s.target.closest('button.row:disabled') : null;
          if (off && C.isTap(t.clientX - s.x, t.clientY - s.y, Date.now() - s.at)) { off.classList.remove('nope'); void off.offsetWidth; off.classList.add('nope'); (function (b) { setTimeout(function () { b.classList.remove('nope'); }, 350); })(off); }
          if (!(multi || quick) || !s || !C.isTap(t.clientX - s.x, t.clientY - s.y, Date.now() - s.at)) continue;
          var btn = s.target && s.target.closest ? s.target.closest('button') : null, under = document.elementFromPoint(t.clientX, t.clientY);
          /*
           * 1.3.0: 예전에는 손을 뗀 자리에 그 단추가 그대로 있어야만(elementFromPoint) 눌러 주었다.
           *   수색 지도의 칸은 눌리면 잠깐 작아졌다 커지고(tile-hit), 칸 사이에 틈도 있어서, 빠르게 두드리면 손끝이 칸 가장자리를 벗어난 것으로 읽혀 누름이 버려졌다.
           *   손가락이 거의 움직이지 않았다는 것은 isTap 이 이미 확인했으므로, 누르기 시작한 단추를 그대로 눌러 준다.
           *   다만 그 사이에 창(일지, 특전 고르기 등)이 위에 떴으면 아래 단추는 누르지 않는다.
           */
          var veil = under && under.closest ? under.closest('.story-veil, [role="dialog"], [role="alert"]') : null;
          if (btn && !btn.disabled && !(veil && !veil.contains(btn))) { synth = { btn: btn, at: Date.now() }; btn.click(); made = true; }
          else if (quick && !(s.target && s.target.closest && s.target.closest('input, textarea, select, a'))) made = true;      // 빈 곳을 두 번 눌러도 화면이 커지지 않게
        }
        if (made && e.cancelable) e.preventDefault();      // 브라우저가 뒤늦게 한 번 더 누르지 않게
        if (e.touches.length === 0) { multi = false; starts = {}; }
      }, { passive: false });
      document.addEventListener('touchcancel', function (e) {
        for (var i = 0; i < e.changedTouches.length; i++) delete starts[e.changedTouches[i].identifier];
        if (e.touches.length === 0) { multi = false; starts = {}; }
      }, { passive: true });
    } catch (err) { /* 터치가 없는 기기: 할 일이 없다 */ }
  }
  function wireNotify() {
    var app = nativeApp(), row = $('notify-row');
    if (!row || (!app && !webPushReady())) return;
    row.hidden = false;
    function show(on) { document.querySelectorAll('[data-notify]').forEach(function (b) { b.setAttribute('aria-pressed', (b.getAttribute('data-notify') === 'on') === on ? 'true' : 'false'); }); }
    var now = false;
    if (app) { try { now = !!app.getNotify(); } catch (e) { now = true; } }
    else now = recall(PUSH_KEY) === 'on' && Notification.permission === 'granted';
    show(now);
    document.querySelectorAll('[data-notify]').forEach(function (b) {
      b.addEventListener('click', function () {
        var on = b.getAttribute('data-notify') === 'on';
        if (app) { try { app.setNotify(on); } catch (e) { return; } show(on); return; }
        if (!on) { remember(PUSH_KEY, 'off'); show(false); webPushOff(); return; }
        webPushOn().then(function (ok) {
          remember(PUSH_KEY, ok ? 'on' : 'off'); show(ok);
          toast(ok ? '알림을 켰어요' : '알림을 켜지 못했어요. 폰 설정에서 알림을 허용해 주세요.');
        }, function () { show(false); toast('알림을 켜지 못했어요'); });
      });
    });
  }
  /** 짧은 진동. 설정에서 껐거나 기기가 지원하지 않으면 아무 일도 하지 않는다. */
  function buzz(ms) { try { if (prefs.vibrate === 'on' && navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* 진동은 없어도 된다 */ } }
  function recall(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function remember(key, value) { try { localStorage.setItem(key, String(value)); } catch (e) { /* 기억만 못 한다 */ } }
  function hasProgress(st) { return !!st && (st.lifetimeEarned > 0 || st.clicks > 0); }
  function summary(st) {
    return C.zoneLabel(st) + ' · D+' + st.day + ' · 누적 물자 ' + fmt(st.lifetimeEarned) + ' · 항체 샘플 ' + fmt(st.antibodies);
  }
  var Cloud = {
    ref: null, role: 'none', lastCycle: 0, device: '', stamp: 0, chain: Promise.resolve(), takeTimer: null,
    show: function (key) { setText($('cloud-status'), CLOUD_TEXT[key] || CLOUD_TEXT.none); },
    /** 작업을 한 줄로 세운다. 앞 작업이 실패해도 뒤 작업은 실행된다. */
    run: function (job) {
      Cloud.chain = Cloud.chain.then(job).catch(function (e) { console.warn('cloud', e); Cloud.show('retry'); });
      return Cloud.chain;
    },
    /** 뷰어가 기능을 조금 늦게 붙이는 경우가 있어 최대 10초까지 기다려 본다. */
    waitForHost: function () {
      return new Promise(function (resolve) {
        var tries = 0;
        (function check() {
          if (window.claude && typeof window.claude.use === 'function') return resolve(true);
          if (++tries > 20) return resolve(false);
          setTimeout(check, 500);
        })();
      });
    },
    init: async function () {
      try {
        Cloud.device = recall(DEVICE_KEY) || '';
        if (!Cloud.device) { Cloud.device = 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); remember(DEVICE_KEY, Cloud.device); }
        Cloud.stamp = Number(recall(STAMP_KEY)) || 0;
        if (!(await Cloud.waitForHost())) return; // 파일·exe 로 실행 중: 브라우저 저장만 쓴다
        Cloud.show('connecting');
        var got = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
        var id = got[0] && got[1] ? await got[1].id() : null;
        if (!id) { Cloud.show('none'); return; }
        Cloud.ref = got[0].doc('data/users/' + id + '/save');
        await Cloud.check();
        // 서버 문서가 바뀌면 곧바로 듣는다(넘겨받기 요청, 다른 기기의 가져감). 실패해도 1분 주기 확인이 남는다.
        try {
          Cloud.ref.onSnapshot(function (snap) {
            if (!snap || (snap.metadata && (snap.metadata.fromCache || snap.metadata.hasPendingWrites))) return; // 확정된 내용만 본다
            var body = snap.exists ? snap.data() : null;
            Cloud.run(function () { return Cloud.onDoc(body); });
          }, function () { /* 실시간 수신이 끊겨도 주기 확인으로 계속한다 */ });
        } catch (e) { /* 위와 같다 */ }
      } catch (e) {
        console.warn('cloud init', e);
        Cloud.ref = null;
        Cloud.setRole('none');
        Cloud.show('off');
      }
    },
    setStamp: function (t) { Cloud.stamp = t; remember(STAMP_KEY, t); },
    /** 역할을 바꾸고, 멈춤 화면과 게임의 일시 정지를 거기에 맞춘다. */
    setRole: function (role) {
      Cloud.role = role;
      paused = role === 'standby' || role === 'taking';
      $('standby').hidden = !paused;
      $('standby-take').disabled = role === 'taking';
      setText($('standby-take'), role === 'taking' ? '넘겨받는 중…' : '여기서 이어하기');
      if (!paused) lastFrame = Date.now(); // 멈춰 있던 시간이 한꺼번에 진행되지 않게 한다
      if (role === 'owner') Cloud.show('on');
      if (paused) Cloud.show('standby');
    },
    /** 서버 문서를 해석한다. 내용이 없거나 깨졌으면 remote 가 null. */
    parse: function (body) {
      var d = { remote: null, savedAt: 0, device: null, wants: null };
      if (!body || typeof body.json !== 'string') return d;
      try { d.remote = C.deserialize(body.json, Date.now()); } catch (e) { return d; }
      d.savedAt = typeof body.savedAt === 'number' && isFinite(body.savedAt) ? body.savedAt : d.remote.lastSeen;
      d.device = typeof body.device === 'string' ? body.device : null;
      d.wants = typeof body.wants === 'string' ? body.wants : null;
      return d;
    },
    read: async function () {
      var snap = await withTimeout(Cloud.ref.get(), 10000);
      return snap && snap.exists ? snap.data() : null;
    },
    adopt: function (remote, savedAt) {
      state = remote;
      Cloud.setStamp(savedAt);
      log('다른 기기에서 하던 진행을 이어받았다. ' + summary(state), 'good');
      reportAway(C.applyOffline(state, (Date.now() - savedAt) / 1000));
      Store.save();
      render();
    },
    /** 서버에 올린다. toDevice 를 주면 그 기기에게 진행을 넘긴다는 뜻이다. */
    write: async function (toDevice) {
      if (!Cloud.ref) return;
      var now = Date.now();
      state.lastSeen = now;
      try {
        await withTimeout(Cloud.ref.set({ json: C.serialize(state), savedAt: now, device: toDevice || Cloud.device, wants: null, zone: C.zoneLabel(state) }), 15000);
        Cloud.setStamp(now);
        if (Cloud.role === 'owner') Cloud.show('on');
      } catch (e) {
        // invalid_argument: 이 뷰어는 쓸 권한이 없다 → 계정 저장을 끄고 이 기기에서만 진행한다. 그 외는 다음 주기에 재시도.
        if (e && e.code === 'invalid_argument') { Cloud.ref = null; Cloud.setRole('none'); Cloud.show('off'); }
        else Cloud.show('retry');
      }
    },
    /**
     * 서버 문서의 현재 내용을 보고 이 기기의 역할을 정한다. 실시간 수신과 주기 확인 양쪽에서 불린다.
     */
    onDoc: async function (body) {
      if (!Cloud.ref) return;
      var me = Cloud.device, d = Cloud.parse(body);
      if (!d.remote) { // 서버에 저장이 없다: 이 기기가 진행한다
        if (Cloud.role !== 'owner') { Cloud.setRole('owner'); await Cloud.write(); }
        return;
      }
      if (d.device === me) {
        if (Cloud.role === 'taking') { // 상대가 진행을 넘겨줬다
          clearTimeout(Cloud.takeTimer);
          await Cloud.takeFrom(d);
        } else if (Cloud.role !== 'owner') {
          Cloud.setRole('owner'); // 지난번에도 이 기기였다. 이 기기의 저장이 더 최근이므로 그대로 쓴다
        } else if (d.wants && d.wants !== me) { // 다른 기기가 넘겨 달라고 한다: 최신 진행을 넘기고 멈춘다
          await Cloud.write(d.wants);
          Cloud.setRole('standby');
        }
        return;
      }
      // 서버의 진행은 다른 기기 것이다
      setText($('standby-info'), summary(d.remote));
      if (Cloud.role === 'owner') { Cloud.setRole('standby'); return; } // 다른 기기가 가져갔다
      if (Cloud.role !== 'none') return;                                 // 이미 멈춰 있거나 넘겨받는 중
      if (Date.now() - d.savedAt < LIVE_MS) Cloud.setRole('standby');    // 그 기기가 아직 켜져 있다
      else await Cloud.takeFrom(d);                                      // 꺼진 지 오래다: 바로 이어받는다
    },
    /** 서버의 진행 d 를 이 기기로 가져온다. 어느 쪽을 살릴지 애매하면 묻는다. */
    takeFrom: async function (d) {
      var differs = d.remote.lifetimeEarned !== state.lifetimeEarned || d.remote.retreats !== state.retreats || d.remote.runEarned !== state.runEarned;
      var useRemote;
      if (!hasProgress(d.remote)) useRemote = false;
      else if (!hasProgress(state)) useRemote = true;
      else if (Cloud.stamp === 0 && differs) useRemote = await Cloud.ask(d.remote); // 서버와 맞춰 본 적 없는 기기: 조용히 지우지 않는다
      else useRemote = true;
      if (useRemote) Cloud.adopt(d.remote, d.savedAt);
      Cloud.setRole('owner');
      await Cloud.write();
    },
    /** "여기서 이어하기": 진행 중인 기기에 넘겨 달라고 요청하고, 답이 없으면 마지막 저장을 가져온다. */
    take: function () {
      if (!Cloud.ref || Cloud.role !== 'standby') return;
      Cloud.setRole('taking');
      Cloud.run(async function () {
        try { await withTimeout(Cloud.ref.update({ wants: Cloud.device }), 8000); } catch (e) { /* 요청을 못 남겨도 아래에서 직접 가져온다 */ }
      });
      Cloud.takeTimer = setTimeout(function () {
        Cloud.run(async function () {
          if (Cloud.role !== 'taking') return; // 그사이 넘겨받았다
          var d = Cloud.parse(await Cloud.read());
          if (d.remote) await Cloud.takeFrom(d);
          else { Cloud.setRole('owner'); await Cloud.write(); }
        });
      }, HANDOFF_WAIT_MS);
    },
    /** 주기 확인: 서버를 읽어 역할을 다시 정하고, 진행 중인 기기라면 최신 진행을 올린다. */
    check: function () {
      if (!Cloud.ref) return Promise.resolve();
      Cloud.lastCycle = Date.now();
      return Cloud.run(async function () {
        await Cloud.onDoc(await Cloud.read());
        if (Cloud.role === 'owner' && Date.now() - Cloud.stamp > 5000) await Cloud.write();
        Cloud.lastCycle = Date.now();
      });
    },
    /** 진행 중인 기기일 때만 즉시 올린다(이주, 불러오기, 초기화, 탭을 가릴 때). */
    flush: function () {
      if (Cloud.ref && Cloud.role === 'owner') Cloud.run(function () { return Cloud.write(); });
    },
    /** 어느 진행을 쓸지 묻는다. 계정 저장을 고르면 true. 고를 때까지 서버에는 아무것도 쓰지 않는다. */
    ask: function (remote) {
      return new Promise(function (resolve) {
        setText($('sync-local'), summary(state));
        setText($('sync-remote'), summary(remote));
        $('sync').hidden = false;
        function done(useRemote) {
          $('sync').hidden = true;
          $('sync-use-local').onclick = null; $('sync-use-remote').onclick = null;
          resolve(useRemote);
        }
        $('sync-use-local').onclick = function () { done(false); };
        $('sync-use-remote').onclick = function () { done(true); };
        try { $('sync-use-remote').focus(); } catch (e) { /* 초점을 못 옮겨도 진행한다 */ }
      });
    }
  };

  /* ---------- 업데이트 ---------- */
  var VERSION_KEY = 'zone7-version';
  var UPDATE_EVERY_MS = 30 * 60 * 1000;
  /**
   * 새 버전 확인과 적용.
   *   - 설치형(PWA)에서만 서버의 version.json 을 확인한다: 열 때, 30분마다, 화면으로 돌아올 때.
   *     새 버전이면 알림 띠를 띄우고, "지금 업데이트"를 누르면 저장 → 예전 파일 지우기 → 새로 열기 순으로 진행한다.
   *   - Claude 에 게시된 페이지는 뷰어가 알아서 새 버전으로 바꿔 주므로 확인하지 않는다.
   *   - 어느 쪽이든, 버전이 바뀐 뒤 처음 열면 한 번 알려 준다(afterUpdate).
   * 확인에 실패해도(오프라인 등) 게임에는 영향이 없다.
   */
  var Update = {
    current: window.ZONE7_VERSION || '', lastCheck: 0, offered: '',
    enabled: function () { return !!(window.ZONE7_PWA && window.Updater && Update.current); },
    check: function () {
      if (!Update.enabled()) return;
      Update.lastCheck = Date.now();
      // version.json 의 주소를 매번 다르게 해서(?t=) 기기에 저장된 예전 답을 받지 않는다
      window.Updater.checkRemote(window.fetch.bind(window), 'version.json?t=' + Date.now(), Update.current).then(function (r) {
        if (!r.available || r.info.version === Update.offered) return; // "나중에"를 누른 버전은 다시 묻지 않는다
        setText($('update-text'), '새 버전 ' + (r.info.name || r.info.version) + (C.hasBatchim(r.info.name || r.info.version) ? '이' : '가') + ' 나왔다.' + (r.info.title ? ' ' + r.info.title + '.' : ''));
        $('update-bar').dataset.version = r.info.version;
        $('update-bar').hidden = false;
      });
    },
    /** 진행을 저장하고, 저장해 둔 예전 파일을 지운 뒤 새로 연다. 어느 단계가 실패해도 새로 열기까지는 간다. */
    apply: async function () {
      $('update-now').disabled = true;
      setText($('update-now'), '업데이트 중…');
      if (!paused) Store.save();
      try { if (window.caches) { var keys = await caches.keys(); await Promise.all(keys.map(function (k) { return caches.delete(k); })); } } catch (e) { /* 지우지 못해도 서비스 워커가 새 파일을 받아 온다 */ }
      try { var reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (e) { /* 위와 같다 */ }
      // 그냥 새로 고치면 기기에 저장된 예전 페이지가 다시 뜰 수 있다(그러면 알림 띠가 또 나온다).
      // 주소 뒤에 새 버전 번호를 붙여서 열어 저장된 것을 건너뛴다.
      var target = $('update-bar').dataset.version || String(Date.now());
      try { location.replace(location.origin + location.pathname + '?v=' + encodeURIComponent(target)); }
      catch (e) { location.reload(); }
    },
    /** 지난번에 열었을 때와 버전이 다르면 한 번 알린다. */
    afterUpdate: function () {
      if (!Update.current) return;
      var seen = recall(VERSION_KEY);
      remember(VERSION_KEY, Update.current);
      if (seen && seen !== Update.current) {
        var name = PATCH_NOTES.length ? PATCH_NOTES[0].ver : Update.current;
        notice(name + (C.hasBatchim(name) && !/[178]$/.test(name) ? '으로' : '로') + ' 업데이트됐다. 기록 > 패치에서 바뀐 점을 볼 수 있다.');
      }
    }
  };

  /* ---------- 작은 DOM 도우미 ---------- */
  /** 값이 바뀐 경우에만 DOM 을 건드려 0.1초 주기 갱신 비용을 줄인다. */
  /** 진행 바 채우기: el 의 --p 를 0~1 로 둔다. 잘못된 값(NaN, 범위 밖)은 0~1 로 맞춘다. 값이 같으면 건드리지 않는다. */
  /**
   * 값 아래에 "지금 가진 물자가 그 값의 얼마쯤인지"를 가는 띠로 칠한다(1.5.9). 살 수 있으면 띠를 지운다.
   * 얼마나 더 모아야 하는지를 숫자를 견주지 않고도 알 수 있다.
   */
  function afford(el, cost) {
    if (!el) return;
    var p = !(cost > 0) || !isFinite(cost) || cost <= state.supplies ? -1 : Math.max(0, Math.min(1, state.supplies / cost)), key = p < 0 ? '' : (p * 100).toFixed(0);
    if (el._afford === key) return;
    el._afford = key;
    el.style.background = p < 0 ? '' : 'linear-gradient(90deg, var(--hazard) ' + key + '%, var(--rule) ' + key + '%) left bottom / 100% 3px no-repeat';
    el.style.paddingBottom = p < 0 ? '' : '4px';
  }
  function fill(el, ratio) {
    if (!el) return;
    var p = typeof ratio === 'number' && ratio > 0 ? Math.min(1, ratio) : 0, v = p.toFixed(3);
    if (el._p === v) return;
    var back = parseFloat(v) < parseFloat(el._p || '0');
    el._p = v;
    if (back) { el.style.transition = 'none'; el.style.setProperty('--p', v); void el.offsetWidth; el.style.transition = ''; }   // 처음으로 돌아갈 때는 되감기지 않게 바로 바꾼다
    else el.style.setProperty('--p', v);
  }
  /**
   * 글에서 문장이 끝나는 자리를 찾아 표시(SEP)를 넣는다. 화면에 넣을 때 fillText 가 문장마다 한 덩어리로 묶는다.
   */
  var SEP = '\u0001';
  function lines(text) {
    if (typeof text !== 'string') return text;
    // 따옴표(“ ”) 안에서는 줄을 바꾸지 않는다: 대사는 한 줄로 읽혀야 한다. 따옴표가 닫힌 뒤에 문장이 끝나면 거기서 바꾼다
    var out = '', depth = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '“') depth++;
      else if (ch === '”') depth = Math.max(0, depth - 1);
      if (ch === ' ' && depth === 0 && i > 0 && i < text.length - 1 && /\S/.test(text[i + 1]) && /[.!?…]$|[.!?…][”’"')]$/.test(text.slice(Math.max(0, i - 2), i))) out += SEP;
      else out += ch;
    }
    return out;
  }
  /** 목표 글: 진행 숫자(괄호)도 한 덩어리로 묶어서, 자리가 모자라면 통째로 아랫줄로 내려가게 한다. */
  function goalLines(text) { return String(text).replace(/ \(/g, SEP + '('); }
  /**
   * 줄 정렬(1.0.6): 문장 하나를 한 덩어리(inline-block)로 묶는다.
   *   한 줄에 다 들어가면 한 줄로 나오고, 넘치면 문장 사이에서만 줄이 바뀐다. 문장 중간에서 꺾이는 것은 문장 하나가 한 줄보다 길 때뿐이다.
   *   전에는 문장마다 무조건 줄을 바꿔서, 짧은 두 문장도 두 줄이 됐다.
   *   글 안의 줄바꿈(\n)은 그대로 줄을 바꾼다.
   */
  function fillText(node, text) {
    var marked = lines(text);
    if (typeof marked !== 'string' || (marked.indexOf(SEP) < 0 && marked.indexOf('\n') < 0 && marked.indexOf(' · ') < 0)) { node.textContent = text; return; }
    node.textContent = '';
    marked.split('\n').forEach(function (row, ri) {
      if (ri > 0) node.appendChild(document.createElement('br'));
      row.split(SEP).forEach(function (part, pi) {
        if (pi > 0) node.appendChild(document.createTextNode(' '));
        // 가운뎃점( · )으로 이은 글은 토막마다 묶는다(1.3.0): "연속 호가 5 · 판매 +50% · 직접 팔면 끊겨요"가 토막 중간에서 끊기지 않게.
        // 구분점은 앞 토막에 붙여 두어서, 줄이 바뀌어도 새 줄이 점으로 시작하지 않는다
        var bits = part.split(' · ');
        bits.forEach(function (bit, bi) {
          if (bi > 0) node.appendChild(document.createTextNode(' '));
          var span = document.createElement('span');
          span.className = 'sn'; span.textContent = bit + (bi < bits.length - 1 ? ' ·' : '');
          node.appendChild(span);
        });
      });
    });
  }
  /** 글을 넣는다. 같은 글이면 건드리지 않는다(매 프레임 다시 그리지 않게, 넣은 글을 기억해 둔다). */
  function setText(el, text) { if (!el || el.__raw === text) return; el.__raw = text; fillText(el, text); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) { n.__raw = text; fillText(n, text); }
    return n;
  }
  function pad3(n) { return n < 1000 ? ('00' + n).slice(-3) : String(n); }
  function clock(sec) {
    sec = Math.max(0, Math.ceil(sec));
    return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
  }
  function duration(sec) {
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return h > 0 ? h + '시간 ' + m + '분' : m > 0 ? m + '분' : Math.floor(sec) + '초';
  }

  /* ---------- 무전 로그 ---------- */
  var FLAVOR = [
    '북쪽 고가도로에서 연기가 보인다. 누군가 아직 살아 있다.',
    '수색조가 통조림 상자를 들고 돌아왔다. 유통기한은 묻지 않기로 했다.',
    '무전기에서 잡음 사이로 노랫소리가 들렸다.',
    '아이들이 방벽 안쪽에 분필로 그림을 그렸다.',
    '오늘은 비가 온다. 정수기 담당이 웃는다.',
    '옥상 감시조 보고: 서쪽 아파트 단지, 움직임 다수.',
    '누군가 달력에 오늘도 줄을 그었다.',
    '발전기 소리가 멎자 모두가 숨을 죽였다. 다시 돌아간다.',
    '떠돌이 상인이 건전지를 두고 갔다. 소문도 하나 흘리고 갔다.',
    '방벽 너머에서 긁는 소리가 밤새 이어졌다.'
  ];
  /** 잡담 한 줄: 주머니에서 하나씩 꺼내 쓰고, 다 쓰면 다시 채운다(같은 줄이 연달아 나오지 않게). */
  var chatterBag = [];
  function nextChatter() {
    if (!chatterBag.length) chatterBag = FLAVOR.slice();
    return chatterBag.splice(Math.floor(Math.random() * chatterBag.length), 1)[0];
  }
  function log(text, kind) {
    var list = $('log');
    var li = el('li', kind ? 'log-' + kind : '');
    li.appendChild(el('span', 'log-day', 'D+' + pad3(state ? state.day : 1)));
    li.appendChild(el('span', 'log-text', text));
    list.insertBefore(li, list.firstChild);
    setText($('m-story'), li.lastChild.textContent);      // 폰 화면의 상황 칸에도 같은 줄을 적는다
    setText($('story-latest'), li.lastChild.textContent);      // 상황 화면의 '최근 무전' 한 줄(글 대신 요소가 넘어오는 로그도 있어서, 화면에 찍힌 글을 읽는다)
    while (list.children.length > LOG_MAX) list.removeChild(list.lastChild);
  }
  /** 화면 구석에 잠깐 떴다 사라지는 쪽지. 무전 로그를 안 보고 있어도 알아챌 일(업적, 유물 등)에 쓴다. */
  function toast(text) {
    var box = $('toasts');
    var t = el('div', 'toast', text);
    t.addEventListener('animationend', function () { t.remove(); });
    box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild); // 한꺼번에 쏟아져도 3장까지만
  }
  function notice(text) {
    setText($('notice-text'), text);
    $('notice').hidden = false;
  }

  /* ---------- 목록 만들기 (최초 1회) ---------- */
  function buildRow(def, onBuy) {
    var btn = el('button', 'row');
    btn.type = 'button';
    btn.id = 'row-' + def.id;
    var head = el('span', 'row-head');
    var name = el('span', 'row-name', def.name);
    var count = el('span', 'row-count', '0');
    // 2배 표시: 다음에 생산이 2배가 되는 수를 이름 옆에 적는다. 쓰지 않는 줄에서는 숨겨 둔다
    var mile = el('span', 'row-mile'); mile.hidden = true;
    head.appendChild(name); head.appendChild(mile); head.appendChild(count);
    var desc = el('span', 'row-desc', def.desc);
    var foot = el('span', 'row-foot');
    var info = el('span', 'row-info');
    var cost = el('span', 'row-cost');
    foot.appendChild(info); foot.appendChild(cost);
    btn.appendChild(head); btn.appendChild(desc); btn.appendChild(foot);
    btn.addEventListener('click', onBuy);
    return { btn: btn, count: count, info: info, cost: cost, mile: mile };
  }
  /**
   * 2배 표시를 고친다.
   *   n 지금 수,  q 이번에 살 수,  can 살 수 있는지,  list 문턱 목록(없으면 시설의 것)
   * 이번 구매로 문턱에 닿으면 "지금 2배"로 바꿔 눈에 띄게 한다.
   */
  function setMile(r, n, q, can, list) {
    if (!r || !r.mile) return;
    var next = C.nextMilestone(n, list), tier = C.milestoneTier(n, list);
    // 등급(넘은 문턱 수)에 따라 줄의 띠 색과 별의 수가 달라진다
    r.btn.setAttribute('data-tier', String(tier));
    if (typeof r.tier === 'number' && tier > r.tier) {      // 방금 2배가 됐다: 줄을 한 번 번쩍인다
      r.btn.classList.remove('tier-up'); void r.btn.offsetWidth; r.btn.classList.add('tier-up');
      buzz(25);
    }
    r.tier = tier;
    // 별: 문턱의 수만큼 빈 별이 있고, 넘을 때마다 하나씩 채워진다. 다 채우면 금색으로 빛난다
    var total = (Array.isArray(list) ? list : C.MILESTONES).length;
    var hit = next !== null && !!can && q > 0 && n + q >= next;
    // 별은 글자(★)가 아니라 도형으로 그린다: 글자는 폰마다 크기와 높이가 달라서(아이폰에서는 작고 아래로 처졌다) 줄이 맞지 않았다
    var key = hit ? 'hit' : tier + '/' + total;
    if (r.mileKey !== key) {
      r.mileKey = key;
      while (r.mile.firstChild) r.mile.removeChild(r.mile.firstChild);
      if (hit) { r.mile.appendChild(el('i', 'st on')); r.mile.appendChild(el('span', '', '지금 2배')); }
      else for (var si = 0; si < total; si++) r.mile.appendChild(el('i', si < tier ? 'st on' : 'st'));
      r.mile.setAttribute('aria-label', hit ? '이번에 사면 2배' : '2배 등급 ' + tier + ' / ' + total);
    }
    r.mile.hidden = false;
    r.mile.classList.toggle('full', next === null);
    r.next = next;
    r.mile.classList.toggle('hit', hit);
    r.mile.title = next === null ? '2배 문턱을 모두 넘었어요' : next + '에 닿으면 2배가 돼요';
  }


  /* ---------- 확인 창 ---------- */
  /**
   * 되돌릴 수 없는 행동 전에 띄우는 확인 창. 안전한 쪽(noText) 버튼에 초점을 두어
   * 실수로 Enter 를 눌러도 실행되지 않게 한다. 확인을 누르면 onYes 를 실행한다.
   */
  /* ---------- 의견 보내기 ---------- */
  var FEEDBACK_REPO = 'https://github.com/eifv013/Zone7';   // "GitHub에 올리기"가 여는 곳
  /** 지금 판의 정보를 붙인 의견 글. 쓴 글이 비어 있으면 ''. 글 자체는 Feedback 모듈이 만든다. */
  function feedbackReport(text) {
    if (!window.Feedback) return '';
    return window.Feedback.compose({
      text: text, version: window.ZONE7_VERSION || '', zone: C.zoneLabel(state), stats: C.stats(state, Date.now()),
      screen: { w: window.innerWidth, h: window.innerHeight }, ua: navigator.userAgent, duration: C.formatDuration,
      zoneName: function (i) { var z = C.ZONES[Math.min(i, C.ZONES.length - 1)]; return z.no + '구역 ' + z.name; }
    });
  }
  /**
   * 의견 창의 단추들을 잇는다. 보내는 길은 셋이고, 어느 것도 실패해도 게임에는 영향이 없다.
   *   공유하기       : 폰의 공유 창(메신저 등). 지원하는 브라우저에서만 단추가 보인다.
   *   복사하기       : 클립보드에 복사. 막혀 있으면 글 칸에 전체 글을 넣어 직접 복사하게 한다.
   *   GitHub에 올리기: 글이 채워진 새 글 쓰기 화면을 연다(GitHub 계정이 필요하다).
   */
  function wireFeedback() {
    var box = $('feedback'), area = $('feedback-text');
    if (!box || !area || !window.Feedback) { if ($('feedback-open')) $('feedback-open').hidden = true; return; }
    var say = function (t) { setText($('feedback-msg'), t); };
    var refresh = function () {
      var ok = window.Feedback.valid(area.value);
      ['feedback-share', 'feedback-copy', 'feedback-issue'].forEach(function (id) { $(id).disabled = !ok; });
      // 붙는 정보 미리 보기: 아무 글이나 넣어 만든 뒤, 정보 부분만 떼어 보여 준다
      var sample = feedbackReport('-'), cut = sample.indexOf('--- 자동으로 붙는 정보 ---');
      setText($('feedback-info'), cut >= 0 ? sample.slice(cut).split('\n').slice(1).join('\n') : '');
    };
    var close = function () { box.hidden = true; };
    $('feedback-open').addEventListener('click', function () {
      say(''); refresh(); box.hidden = false;
      try { area.focus(); } catch (e) { /* 초점을 못 옮겨도 쓸 수 있다 */ }
    });
    $('feedback-close').addEventListener('click', close);
    area.addEventListener('input', refresh);
    $('feedback-share').hidden = typeof navigator.share !== 'function';
    $('feedback-share').addEventListener('click', function () {
      var report = feedbackReport(area.value);
      if (!report) return;
      try { navigator.share({ title: '7구역 의견', text: report }).then(function () { say('공유 창을 열었어요. 고마워요!'); }, function () { say('공유를 취소했어요.'); }); }
      catch (e) { say('공유할 수 없어요. "복사하기"를 써 주세요.'); }
    });
    $('feedback-copy').addEventListener('click', function () {
      var report = feedbackReport(area.value);
      if (!report) return;
      var done = function () { say('복사했어요. 테스트를 부탁한 사람에게 붙여 넣어 보내 주세요.'); };
      var manual = function () { area.value = report; area.select(); say('자동 복사가 막혀 있어요. 위 글을 직접 복사해 주세요.'); refresh(); };
      try { navigator.clipboard.writeText(report).then(done, manual); }
      catch (e) { manual(); }
    });
    $('feedback-issue').addEventListener('click', function () {
      var url = window.Feedback.issueUrl(FEEDBACK_REPO, feedbackReport(area.value), area.value);
      if (!url) return;
      // 앱(웹뷰)에서는 창을 새로 띄울 수 없으므로 주소로 이동한다: 껍데기가 게임 밖 주소를 바깥 브라우저로 넘긴다.
      var opened = null;
      try { opened = window.open(url, '_blank'); if (opened) opened.opener = null; } catch (e) { opened = null; }   // 새 창이 게임 창을 건드리지 못하게 한다
      if (!opened) { try { location.href = url; } catch (e) { say('GitHub를 열 수 없어요. "복사하기"를 써 주세요.'); return; } }
      say('GitHub 글쓰기 화면을 열었어요. GitHub 계정으로 로그인해야 올릴 수 있어요.');
    });
  }

  /**
   * 직접 수색 한 번. index 를 주면 수색 지도의 그 칸을, 주지 않으면("잔해 수색" 단추) 다음 칸을 뒤진다.
   * 뒤진 칸이 잠깐 튀고, 은닉처나 동네 완료 때는 소리와 쪽지로 알린다.
   */
  /** 동네를 다 뒤졌을 때: 수색 지도 머리줄의 글을 2초 동안 보너스로 바꿔 보여 준다(알림 띠 대신). */
  var sweepFlashUntil = 0, sweepFlashText = '';
  function flashSweep(bonus) { sweepFlashText = '동네 완료 · 물자 +' + fmt(bonus); sweepFlashUntil = Date.now() + 2000; }
  function search(index) {
    var r = C.scavenge(state, index);
    popNumber('+' + fmt(r.gain + r.bonus));
    var tile = rows.tiles[r.tile];
    if (tile) { tile.classList.remove('hit'); void tile.offsetWidth; tile.classList.add('hit'); }
    if (scene) scene.poke();
    buzz(r.swept ? 30 : 8);
    if (r.swept) {
      // 동네를 다 뒤질 때마다 알림 띠를 띄우면 너무 잦다(순찰조가 돌면 30초마다). 수색 지도의 칸 수 옆에 잠깐 표시만 한다
      flashSweep(r.bonus);
      var box = $('search'); box.classList.remove('swept'); void box.offsetWidth; box.classList.add('swept');
      sfx('defended');
    } else sfx(r.kind === 'cache' ? 'cache' : 'click');
    render();
  }
  /** 구역 지도를 채운다: 구역마다 이름, 하는 일, 지금 버는 양(전체에서 차지하는 몫을 막대로). */
  /*
   * 구역 지도: 1구역(왼쪽 아래)에서 7구역(오른쪽 위)까지 길이 이어진 지도. 강을 건너야 6·7구역이다.
   *   구역 표지를 누르면 아래 카드에 그 구역의 설명과 버는 양이 나오고, '이 구역 보기'로 그 구역 화면에 간다.
   *   그림은 SVG 도형으로 그린다(좌표는 320×330 도트 기준). ZMAP_AT 이 구역마다의 자리다.
   */
  var ZMAP_AT = [[56, 292], [176, 268], [258, 206], [150, 170], [62, 122], [182, 66], [270, 30]];
  var zmapPick = 0;
  function svgEl(name, attrs, text) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
    if (text !== undefined) { n.__raw = text; fillText(n, text); }
    return n;
  }
  /** 구역 표지 위의 작은 건물 그림(도트). kind 는 구역 번호(0~6). */
  function zmapIcon(g, zi, x, y) {
    function r(dx, dy, w, h, c) { g.appendChild(svgEl('rect', { x: x + dx, y: y + dy, width: w, height: h, fill: c, 'class': 'zm-art' })); }
    if (zi === 0) { r(-9, -12, 18, 12, '#8a6a4a'); r(-11, -16, 22, 4, '#a8402e'); r(-3, -7, 5, 7, '#17180f'); r(4, -9, 3, 3, '#ffe9a0'); }                                   // 주택가: 집
    if (zi === 1) { r(-12, -8, 24, 8, '#8a5a34'); for (var i = 0; i < 4; i++) r(-12 + i * 6, -14, 6, 6, i % 2 ? '#e6e5db' : '#b8402e'); r(-11, -15, 1, 15, '#17180f'); r(10, -15, 1, 15, '#17180f'); } // 시장: 천막 좌판
    if (zi === 2) { r(-12, -10, 24, 10, '#6d7479'); r(-10, -20, 4, 10, '#4a4f55'); r(-3, -16, 4, 6, '#4a4f55'); r(4, -6, 5, 6, '#f0b400'); r(-10, -24, 5, 3, '#9a9a94'); }       // 공단: 굴뚝 공장
    if (zi === 3) { r(-14, -4, 28, 2, '#17180f'); r(-11, -14, 22, 9, '#3f6f8f'); r(-9, -12, 5, 4, '#cfe0ea'); r(-2, -12, 5, 4, '#cfe0ea'); r(5, -12, 4, 4, '#cfe0ea'); r(-9, -5, 4, 3, '#17180f'); r(5, -5, 4, 3, '#17180f'); } // 환승역: 열차
    if (zi === 4) { r(-10, -18, 20, 18, '#d9d8cf'); r(-2, -15, 4, 10, '#a8261b'); r(-5, -12, 10, 4, '#a8261b'); r(-3, -4, 6, 4, '#17180f'); }                                 // 병원: 붉은 십자
    if (zi === 5) { r(-13, -6, 26, 6, '#8d8a80'); r(-13, -9, 26, 2, '#a8261b'); r(-13, -11, 26, 2, '#e6e5db'); r(8, -20, 3, 9, '#30343c'); r(5, -22, 9, 3, '#30343c'); }      // 검문소: 차단벽과 초소
    if (zi === 6) { r(-1, -26, 2, 26, '#17180f'); r(-6, -8, 12, 1, '#17180f'); r(-4, -16, 8, 1, '#17180f'); r(-7, -1, 14, 1, '#17180f'); r(-1, -29, 2, 3, '#e0392b'); }       // 송신탑
  }
  function buildZoneMap() {
    var svg = svgEl('svg', { viewBox: '0 0 320 330', 'class': 'zmap-svg', role: 'group', 'aria-label': '구역 지도' });
    function add(name, attrs) { var n = svgEl(name, attrs); svg.appendChild(n); return n; }
    function px(x, y, w, h, cls) { add('rect', { x: x, y: y, width: w, height: h, 'class': cls }); }
    var RIVER = 'M-10 74 L60 86 L120 98 L170 92 L210 84 L270 92 L330 106';
    // 강의 y 좌표(x 에 따라): 나무와 폐허를 강 위에 놓지 않으려고 쓴다
    function riverY(x) { var pts = [[-10, 74], [60, 86], [120, 98], [170, 92], [210, 84], [270, 92], [330, 106]]; for (var k = 1; k < pts.length; k++) if (x <= pts[k][0]) { var a = pts[k - 1], b = pts[k]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); } return 106; }
    /* 땅: 풀밭 바탕에 얼룩(밝은 풀, 마른 흙)을 흩뿌린다. 자리는 늘 같다(씨앗이 고정된 난수). */
    px(0, 0, 320, 330, 'zm-land');
    var seed = 7; function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var gp = 0; gp < 90; gp++) px(Math.floor(rnd() * 316), Math.floor(rnd() * 326), 3 + Math.floor(rnd() * 6), 2, gp % 3 ? 'zm-grass' : 'zm-dirt');
    /* 강: 어두운 둑, 물, 물결. 강 건너(위쪽)는 안개가 낀 듯 조금 어둡다 */
    add('path', { d: RIVER, 'class': 'zm-bank' });
    add('path', { d: RIVER, 'class': 'zm-river' });
    add('path', { d: RIVER, 'class': 'zm-river-glint' });
    add('path', { d: RIVER, 'class': 'zm-river-glint zm-glint2' });
    /* 길: 구역을 차례로 잇는다. 흙길 바탕 위에 가운데 줄을 얹는다. 연 구역까지는 밝은 길(zm-road-open), 그 뒤는 흐린 점선 */
    rows.zmapRoad = []; rows.zmap = [];
    for (var k = 0; k < ZMAP_AT.length - 1; k++) {
      var seg = svgEl('line', { x1: ZMAP_AT[k][0], y1: ZMAP_AT[k][1], x2: ZMAP_AT[k + 1][0], y2: ZMAP_AT[k + 1][1], 'class': 'zm-road' });
      rows.zmapRoad.push(seg); svg.appendChild(seg);
    }
    // 다리: 5구역과 6구역 사이, 길이 강을 건너는 자리에 널판을 깐다
    for (var bp = 0; bp < 7; bp++) px(108 + bp * 5, 100 - bp * 2.3, 4, 9, bp % 2 ? 'zm-plank' : 'zm-plank2');
    /* 숲과 폐허: 길·강·구역 표지를 피해 흩뿌린다. 아래쪽(가까운 곳)일수록 나중에 그려서 겹칠 때 앞에 온다 */
    function clear(x, y) {
      if (Math.abs(y - riverY(x)) < 22) return false;
      for (var n = 0; n < ZMAP_AT.length; n++) if (Math.abs(x - ZMAP_AT[n][0]) < 34 && y > ZMAP_AT[n][1] - 36 && y < ZMAP_AT[n][1] + 34) return false;
      for (var s = 0; s < ZMAP_AT.length - 1; s++) {          // 길과의 거리(선분까지)
        var a = ZMAP_AT[s], b = ZMAP_AT[s + 1], dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
        var qx = a[0] + t * dx - x, qy = a[1] + t * dy - y;
        if (qx * qx + qy * qy < 144) return false;
      }
      return true;
    }
    var decor = [];
    for (var dn = 0; dn < 420 && decor.length < 95; dn++) {
      var dx0 = 6 + Math.floor(rnd() * 306), dy0 = 14 + Math.floor(rnd() * 306);
      if (clear(dx0, dy0)) decor.push([dx0, dy0, rnd()]);
    }
    decor.sort(function (a, b) { return a[1] - b[1]; });
    decor.forEach(function (d) {
      var x = d[0], y = d[1], r = d[2];
      if (r < 0.62) {                    // 소나무: 세 단으로 쌓은 잎과 밑동
        var dark = r < 0.3 ? 'zm-tree2' : 'zm-tree';
        px(x - 1, y - 9, 2, 3, dark); px(x - 2, y - 7, 4, 3, dark); px(x - 3, y - 4, 6, 3, dark); px(x - 1, y - 1, 2, 2, 'zm-trunk');
        px(x - 2, y - 7, 1, 1, 'zm-leaf');
      } else if (r < 0.8) {              // 덤불
        px(x - 3, y - 3, 6, 3, 'zm-tree'); px(x - 2, y - 4, 3, 1, 'zm-leaf');
      } else if (r < 0.93) {             // 무너진 집: 벽과 어두운 창, 비스듬히 잘린 지붕
        px(x - 4, y - 6, 8, 6, 'zm-ruin'); px(x - 4, y - 8, 4, 2, 'zm-ruin'); px(x - 2, y - 4, 2, 2, 'zm-win'); px(x + 1, y - 4, 2, 2, 'zm-win');
      } else {                           // 버려진 차
        px(x - 4, y - 3, 8, 3, 'zm-car'); px(x - 2, y - 5, 4, 2, 'zm-car'); px(x - 3, y, 2, 1, 'zm-win'); px(x + 1, y, 2, 1, 'zm-win');
      }
    });
    // 나침반(왼쪽 위 구석)
    px(14, 12, 1, 9, 'zm-ink'); px(10, 16, 9, 1, 'zm-ink'); px(13, 10, 3, 2, 'zm-here-c');
    svg.appendChild(svgEl('text', { x: 14.5, y: 8, 'class': 'zm-compass', 'text-anchor': 'middle' }, 'N'));
    C.ZONES.forEach(function (z, zi) {
      var at = ZMAP_AT[zi], g = svgEl('g', { id: 'zmap-z' + zi, 'class': 'zm-node', tabindex: '0', role: 'button' });
      g.appendChild(svgEl('circle', { cx: at[0], cy: at[1], r: 22, 'class': 'zm-hit' }));           // 누르는 넓은 자리
      g.appendChild(svgEl('ellipse', { cx: at[0], cy: at[1] + 1, rx: 17, ry: 5, 'class': 'zm-plot' }));
      zmapIcon(g, zi, at[0], at[1]);
      g.appendChild(svgEl('rect', { x: at[0] - 21, y: at[1] - 30, width: 12, height: 12, 'class': 'zm-badge' }));
      g.appendChild(svgEl('text', { x: at[0] - 15, y: at[1] - 20.5, 'class': 'zm-no', 'text-anchor': 'middle' }, String(z.no)));
      var name = svgEl('text', { x: at[0], y: at[1] + 16, 'class': 'zm-name', 'text-anchor': 'middle' }, z.no + '구역 ' + z.name);
      var rate = svgEl('text', { x: at[0], y: at[1] + 28, 'class': 'zm-rate', 'text-anchor': 'middle' }, '');
      g.appendChild(name); g.appendChild(rate);
      var pick = function () { zmapPick = zi; renderZoneMap(); };
      g.addEventListener('click', pick);
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      rows.zmap.push({ g: g, rate: rate });
      svg.appendChild(g);
    });
    // 지금 있는 곳: 우비 소년의 노란 표시
    rows.zmapHere = svgEl('rect', { width: 8, height: 8, 'class': 'zm-here' });
    svg.appendChild(rows.zmapHere);
    $('zmap-map').appendChild(svg);
    $('zmap-go').addEventListener('click', function () { $('zmap').hidden = true; tab = 'z' + zmapPick; pane = 'play'; goTo('tab'); });
  }
  /** 구역 zi 가 버는 양을 글로. 잠긴 구역은 '잠김'. */
  function zmapRate(zi, rates) {
    if (zi > state.zone) return '잠김';
    if (zi === 4) return '+' + fmt(C.labRate(state)) + '/초';
    if (zi === 5) return '+' + fmt(C.guardRate(state)) + '/초';
    if (zi === 6) return '생산 ×' + C.towerMult(state).toFixed(2);
    return zi < rates.length ? '+' + fmt(rates[zi]) + '/초' : '';
  }
  function renderZoneMap() {
    var rates = [C.searchRate(state), C.tradeRate(state), C.lineRate(state), C.railRate(state), C.labRate(state), C.guardRate(state)], total = C.productionPerSec(state);
    if (zmapPick > C.ZONES.length - 1 || zmapPick < 0) zmapPick = state.zone;
    setText($('zmap-total'), '+' + fmt(total));
    rows.zmap.forEach(function (r, zi) {
      r.g.setAttribute('class', 'zm-node' + (zi <= state.zone ? ' open' : ' locked') + (zi === state.zone ? ' here' : '') + (zi === zmapPick ? ' pick' : ''));
      setText(r.rate, zmapRate(zi, rates));
    });
    rows.zmapRoad.forEach(function (seg, k) { seg.setAttribute('class', 'zm-road' + (k < state.zone ? ' zm-road-open' : '')); });
    var here = ZMAP_AT[Math.min(state.zone, ZMAP_AT.length - 1)];
    rows.zmapHere.setAttribute('x', here[0] + 12); rows.zmapHere.setAttribute('y', here[1] - 9);
    // 아래 카드: 고른 구역의 설명
    var z = C.ZONES[zmapPick], open = zmapPick <= state.zone, soon = z.kind === 'soon';
    setText($('zmap-name'), z.no + '구역 ' + z.name + (zmapPick === state.zone ? ' · 현재' : ''));
    setText($('zmap-lead'), soon ? '다음 버전에서 열려요.' : open ? z.lead + '.' : '아직 열지 않았어요. ' + z.lead + '.');
    setText($('zmap-rate'), zmapRate(zmapPick, rates));
    fill($('zmap-share'), open && zmapPick < rates.length && total > 0 ? rates[zmapPick] / total : 0);
    setText($('zmap-share-note'), open && zmapPick < rates.length && total > 0 ? '전체 생산의 ' + (rates[zmapPick] > 0 && rates[zmapPick] / total < 0.01 ? '1% 미만' : Math.round(rates[zmapPick] / total * 100) + '%') : '');      // 1.6.3: 0%로 보이던 앞 구역은 "1% 미만"으로
    $('zmap-go').disabled = !open || soon;
    setText($('zmap-go'), open && !soon ? '이 구역 보기' : '아직 갈 수 없어요');
  }

  /**
   * 3구역 컨베이어를 그린다(320×64 도트). 기계 셋이 벨트 위에 서 있고 물건이 왼쪽에서 오른쪽으로 흐른다.
   *   - 구간마다 물건의 촘촘함이 다르다: 병목 앞까지는 앞 기계가 내놓는 만큼, 병목 뒤로는 병목이 내놓는 만큼만 지나간다.
   *   - 병목인 기계는 붉게 칠하고, 그 앞에는 못 지나간 물건이 쌓인다(가동률이 낮을수록 높이).
   *   - 전력 투입 중에는 물건이 빨리 흐르고 기계 위에 불빛이 켜진다.
   * 색은 테마(라이트·다크)를 따르도록 CSS 변수에서 읽는다. 그리다 실패해도 게임은 계속된다.
   */
  function drawBelt(line) {
    try {
      var cv = $('belt'), g = cv.getContext('2d');
      var css = getComputedStyle(document.body), ink = css.getPropertyValue('--ink').trim() || '#17180f', hazard = css.getPropertyValue('--hazard').trim() || '#f0b400',
        blood = css.getPropertyValue('--blood').trim() || '#a3261d', soft = css.getPropertyValue('--ink-soft').trim() || '#666';
      var W = cv.width, H = cv.height, beltY = 46, xs = [70, 160, 250], ids = C.MACHINES.map(function (d) { return d.id; });
      var surge = state.surgeLeft > 0, still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var t = still ? 0 : Date.now() / 1000 * (surge ? 60 : 30);            // 벨트가 흐른 거리(도트)
      g.clearRect(0, 0, W, H);
      // 벨트: 굵은 줄과 흘러가는 눈금
      g.fillStyle = ink; g.fillRect(0, beltY, W, 3);
      g.fillStyle = soft; for (var x = Math.floor(t) % 8 - 8; x < W; x += 8) g.fillRect(x, beltY + 5, 4, 2);
      // 물건: 구간마다 간격이 다르다(촘촘할수록 많이 지나간다)
      var top = 0; ids.forEach(function (id) { top = Math.max(top, line.caps[id]); });
      var bi = ids.indexOf(line.bottleneck), running = line.flow > 0;
      for (var seg = 0; seg <= 3 && top > 0; seg++) {
        var x0 = seg === 0 ? 0 : xs[seg - 1] + 14, x1 = seg === 3 ? W : xs[seg] - 14;
        // 이 구간을 지나는 양: 맨 앞 구간은 넉넉히, 그 뒤는 앞 기계들 가운데 가장 느린 것만큼
        var through = top; for (var k = 0; k < seg; k++) through = Math.min(through, line.caps[ids[k]]);
        if (!(through > 0)) continue;
        var gap = Math.max(7, Math.round(10 * top / through)), done = seg === 3;
        g.fillStyle = done ? hazard : soft;
        for (var px = x0 + (running || seg <= bi ? Math.floor(t) % gap : 0); px < x1 - 4; px += gap) { g.fillRect(px, beltY - 7, 6, 6); if (done) { g.fillStyle = ink; g.fillRect(px, beltY - 7, 6, 1); g.fillStyle = hazard; } }
      }
      // 병목 앞에 쌓인 물건
      if (top > 0 && bi >= 0 && line.load < 0.95) {
        var pile = Math.min(9, Math.max(1, Math.round((1 - line.load) * 9)));
        g.fillStyle = soft;
        for (var n = 0; n < pile; n++) g.fillRect(xs[bi] - 22 - (n % 3) * 7, beltY - 7 - Math.floor(n / 3) * 7, 6, 6);
      }
      // 기계 셋
      ids.forEach(function (id, i) {
        var has = line.caps[id] > 0, slow = id === line.bottleneck && top > 0, shake = surge && has && !still ? (Math.floor(Date.now() / 80) % 2) : 0;
        g.fillStyle = has ? (slow ? blood : ink) : soft;
        g.fillRect(xs[i] - 13, 14 + shake, 26, 34 - shake);
        g.fillStyle = css.getPropertyValue('--concrete').trim() || '#cfcfc4';
        g.fillRect(xs[i] - 8, 20 + shake, 16, 8);                               // 창
        g.fillStyle = has ? hazard : soft;
        g.fillRect(xs[i] - 6, 22 + shake, has && running && !still ? 4 + Math.floor(Date.now() / 200 + i) % 3 * 4 : 4, 4);   // 계기
        if (surge && has) { g.fillStyle = hazard; g.fillRect(xs[i] - 2, 8, 4, 4); }                                          // 투입 중 불빛
        if (has) { g.fillStyle = ink; g.fillRect(xs[i] + 6, 6 + shake, 4, 8); }                                              // 굴뚝
      });
    } catch (e) { /* 그림이 없어도 숫자로 다 보인다 */ }
  }

  /**
   * 4구역 노선도를 그린다(320×92 도트). 왼쪽이 환승역이고, 노선 넷이 위에서 아래로 놓인다(먼 노선일수록 길다).
   *   - 복구한 노선은 실선, 끊긴 노선은 점선이다. 열차는 종점까지 갔다가 돌아온다(운행 시계의 절반이 가는 길).
   *   - 방금 도착한 노선은 역 쪽에 불빛이 잠깐 켜진다.
   * 그리다 실패해도 게임은 계속된다: 같은 정보가 아래 목록에 글로 있다.
   */
  function drawRail(plan) {
    try {
      var cv = $('railmap'), g = cv.getContext('2d'), css = getComputedStyle(document.body);
      var ink = css.getPropertyValue('--ink').trim() || '#17180f', hazard = css.getPropertyValue('--hazard').trim() || '#f0b400', soft = css.getPropertyValue('--ink-soft').trim() || '#666';
      var W = cv.width, H = cv.height, x0 = 30, ends = [110, 170, 240, 306], now = Date.now();
      g.clearRect(0, 0, W, H);
      C.ROUTES.forEach(function (d, i) {
        var y = 12 + i * 22, x1 = ends[i], lv = state.routes[d.id], n = plan.riders[d.id];
        // 선로와 침목
        g.fillStyle = lv ? ink : soft;
        if (lv) { g.fillRect(x0, y, x1 - x0, 2); for (var tx = x0 + 4; tx < x1; tx += 8) g.fillRect(tx, y - 2, 2, 6); }
        else for (var dx = x0; dx < x1; dx += 8) g.fillRect(dx, y, 4, 2);
        // 종점
        g.fillStyle = lv ? ink : soft; g.fillRect(x1 - 2, y - 5, 8, 12);
        if (!lv) return;
        // 열차: 운행 시계의 앞 절반은 가는 길, 뒤 절반은 오는 길. 여러 대는 조금씩 뒤따른다(세 대까지만 그린다).
        var trip = C.tripSeconds(state, d.id), p = Math.max(0, Math.min(1, state.routeClock[d.id] / trip));
        for (var k = 0; k < Math.min(3, n); k++) {
          var q = Math.max(0, Math.min(1, p - k * 0.04)), pos = q < 0.5 ? q * 2 : 2 - q * 2, back = q >= 0.5;
          var x = Math.round(x0 + 4 + pos * (x1 - x0 - 16));
          g.fillStyle = hazard; g.fillRect(x, y - 5, 10, 7);
          g.fillStyle = ink; g.fillRect(back ? x : x + 8, y - 5, 2, 7); g.fillRect(x + 1, y + 2, 2, 2); g.fillRect(x + 7, y + 2, 2, 2);
          if (back) { g.fillStyle = soft; g.fillRect(x + 3, y - 8, 5, 3); }      // 돌아오는 열차는 화물을 실었다
        }
        // 도착 불빛(0.7초)
        if (railFlash[d.id] && now - railFlash[d.id] < 700) { g.fillStyle = hazard; g.fillRect(x0 - 2, y - 7, 6, 16); g.fillRect(x0 + 6, y - 9, 3, 3); g.fillRect(x0 + 8, y + 6, 3, 3); }
      });
      // 환승역
      g.fillStyle = ink; g.fillRect(4, 4, 24, H - 8);
      g.fillStyle = css.getPropertyValue('--concrete').trim() || '#cfcfc4';
      for (var wy = 10; wy < H - 12; wy += 12) { g.fillRect(8, wy, 6, 6); g.fillRect(18, wy, 6, 6); }
      g.fillStyle = hazard; g.fillRect(4, 4, 24, 3);
    } catch (e) { /* 그림이 없어도 아래 목록으로 다 보인다 */ }
  }

  function confirmBox(title, text, noText, yesText, onYes) {
    setText($('confirm-title'), title);
    setText($('confirm-text'), text);
    setText($('confirm-no'), noText);
    setText($('confirm-yes'), yesText);
    function close() { $('confirm').hidden = true; $('confirm-no').onclick = null; $('confirm-yes').onclick = null; }
    $('confirm-no').onclick = close;
    $('confirm-yes').onclick = function () { close(); onYes(); };
    $('confirm').hidden = false;
    try { $('confirm-no').focus(); } catch (e) { /* 초점을 못 옮겨도 진행한다 */ }
  }

  /* ====================================================================
   * 여기부터 알파 0.6 의 화면: 구역이 쌓이는 구조에 맞춰 새로 썼다.
   * 위쪽(저장, 계정 저장, 업데이트, 일지 연출, 로그)은 예전 것을 그대로 쓴다.
   * ==================================================================== */
  var HINTS = {
    z0: '주택가 · 시설을 지으면 물자가 들어와요.',
    z1: '재래시장 · 시세가 좋을 때 팔수록 많이 벌어요.',
    z2: '공단 · 가장 느린 기계만큼만 나와요.',
    z3: '환승역 · 먼 노선일수록 많이 실어 와요.',
    z4: '대학 병원 · 과제를 끝내면 다른 구역이 강해져요.',
    z5: '강변 검문소 · 방어력이 무리보다 넉넉할수록 더 벌어요.',
    z6: '송신탑 · 사람이 모일수록 모든 구역이 더 벌어요.',
    wall: '방어력이 무리 규모보다 커야 밤을 넘겨요.'
  };
  var perkShown = '', journalShown = '', statsShown = '';
  var pendingEnding = null;      // 끝 화면에 띄울 사건(이야기를 끝낸 순간의 날짜·철수 수·시간)
  var ZONE_TABS = C.ZONES.length;   // 구역마다 탭 하나. 화면에는 연 구역과 그다음 구역까지만 보인다

  /* ---------- 목록 만들기(처음 한 번) ---------- */
  function build() {
    rows = { buildings: {}, defenses: {}, upgrades: {}, traits: {}, machines: {}, cells: {}, tiles: [], zmap: [], bars: [], pips: [], routes: {}, railRows: {}, train: null, staff: null, offers: [], stall: null, goals: [], stats: {}, tabs: {} };
    // 구역 탭
    for (var i = 0; i < ZONE_TABS; i++) { addTab('z' + i, String(i + 1)); rows.tabs['z' + i].setAttribute('aria-label', (i + 1) + '구역 ' + C.ZONES[i].name); rows.tabs['z' + i].title = (i + 1) + '구역 ' + C.ZONES[i].name; }
    addTab('wall', '방벽');
    // 1구역: 시설과 강화
    C.BUILDINGS.forEach(function (b) {
      var r = buildRow(b, function () { buy(C.buyBuilding(state, b.id, qtyFor(C.maxBuildings(state, b.id), C.COUNT_MAX - state.buildings[b.id]))); });
      rows.buildings[b.id] = r; $('rows-z0').appendChild(r.btn);
    });
    // 1구역 수색 지도: 칸마다 단추 하나. 누르면 그 칸을 뒤진다.
    for (var ti = 0; ti < C.SWEEP_TILES; ti++) (function (index) {
      var b = el('button', 'tile');
      b.type = 'button'; b.id = 'tile-' + index;
      b.addEventListener('click', function () { search(index); });
      rows.tiles.push(b); $('search-grid').appendChild(b);
    })(ti);
    buildZoneMap();
    // 2구역 시세판: 지난 시세 막대들 + 지금 시세 막대 하나, 그리고 연속 호가 칸
    for (var bi = 0; bi <= C.PRICE_HISTORY; bi++) { var bar = el('i'); rows.bars.push(bar); $('board-bars').appendChild(bar); }
    for (var pi = 0; pi < C.STREAK_MAX; pi++) { var pip = el('i'); rows.pips.push(pip); $('streak-pips').appendChild(pip); }
    // 2구역: 좌판
    rows.stall = buildRow({ id: 'stall', name: '좌판', desc: '상품을 만든다. 10·25·50곳마다 2배' }, function () { buy(C.buyStall(state, qtyFor(C.maxStalls(state), C.COUNT_MAX - state.stalls)), 'stall'); });
    $('rows-z1').appendChild(rows.stall.btn);
    // 2구역: 시장의 일손(짐꾼, 호객꾼)
    rows.hands = {};
    C.HANDS.forEach(function (d) {
      var r = buildRow(d, function () { buy(C.buyHand(state, d.id, qtyFor(C.maxHands(state, d.id), d.max - state.hands[d.id])), 'hand'); });
      rows.hands[d.id] = r; $('rows-z1').appendChild(r.btn);
    });
    // 3구역: 기계 셋(위쪽의 흐름 칸과 아래쪽의 구매 줄)
    C.MACHINES.forEach(function (d) {
      var cell = el('div', 'line-cell'), name = el('div', 'line-name', d.name), cap = el('div', 'line-cap', '0'), track = el('div', 'track'), bar = el('i');
      track.appendChild(bar); cell.appendChild(name); cell.appendChild(cap); cell.appendChild(track);
      rows.cells[d.id] = { cell: cell, cap: cap, bar: bar }; $('line-flow').appendChild(cell);
      var r = buildRow(d, function () { buy(C.buyMachine(state, d.id, qtyFor(C.maxMachines(state, d.id), C.COUNT_MAX - state.machines[d.id])), 'machine'); });
      rows.machines[d.id] = r; $('rows-z2').appendChild(r.btn);
    });
    // 4구역: 노선 현황(위쪽)과 열차·노선 구매 줄(아래쪽)
    rows.train = buildRow({ id: 'train', name: '열차', desc: '화물을 싣고 다닌다. ' + C.FLEET_MILESTONES.slice(0, 3).join('·') + '대마다 2배' }, function () { buy(C.buyTrain(state, qtyFor(C.maxTrains(state), C.TRAIN_MAX - state.trains)), 'train'); });
    $('rows-z3').appendChild(rows.train.btn);
    C.ROUTES.forEach(function (d) {
      var row = el('div', 'rail-row'), name = el('div', 'rail-name', d.name), small = el('small'), side = el('div', 'rail-side'), track = el('div', 'track'), bar = el('i');
      name.appendChild(small); track.appendChild(bar); row.appendChild(name); row.appendChild(side); row.appendChild(track);
      rows.railRows[d.id] = { row: row, small: small, side: side, bar: bar }; $('rail-list').appendChild(row);
      var r = buildRow({ id: 'route-' + d.id, name: d.name, desc: d.desc }, function () { buy(C.buyRoute(state, d.id), 'route'); });
      rows.routes[d.id] = r; $('rows-z3').appendChild(r.btn);
    });
    // 5구역: 과제 세 장(위쪽)과 연구원 구매 줄(아래쪽). 과제 단추는 자리만 만들어 두고, 무엇을 보여 줄지는 그릴 때 정한다.
    for (var k = 0; k < C.OFFER_COUNT; k++) (function (slot) {
      var b = el('button', 'lab-offer'), name = el('b'), desc = el('span'), cost = el('em');
      b.type = 'button'; b.id = 'offer-' + slot;
      b.appendChild(name); b.appendChild(cost); b.appendChild(desc);
      b.addEventListener('click', function () {
        var r = C.runProject(state, state.offers[slot]);
        if (!r.ok) return;
        if (r.gain) popNumber('+' + fmt(r.gain));
        if (r.record) {      // 병원 서류를 찾았다
          toast((r.record.first ? '5구역 새 서류 · ' : '5구역 서류 · ') + r.record.name);
          log('과제를 끝내다 ' + r.record.name + (C.hasBatchim(r.record.name) ? '을' : '를') + ' 찾았다.' + (r.record.first ? ' 도감에 적었다.' : ''), 'good');
          sfx(r.record.first ? 'goal' : 'staff');
        }
        sfx('buy'); Store.save(); render();
      });
      rows.offers.push({ btn: b, name: name, desc: desc, cost: cost }); $('lab-offers').appendChild(b);
    })(k);
    rows.staff = buildRow({ id: 'staff', name: '연구원', desc: '연구 점수와 약품을 만든다. 10·25·50명마다 2배' }, function () { buy(C.buyStaff(state, qtyFor(C.maxStaff(state), C.COUNT_MAX - state.staff)), 'staff'); });
    $('rows-z4').appendChild(rows.staff.btn);
    // 6구역: 초소
    rows.post = buildRow({ id: 'post', name: '초소', desc: '다리를 건너오는 사람들에게서 통행 물자를 받는다. 10·25·50곳마다 2배' }, function () { buy(C.buyPost(state, qtyFor(C.maxPosts(state), C.COUNT_MAX - state.posts)), 'defense'); });
    $('rows-z5').appendChild(rows.post.btn);
    // 7구역: 안테나와 혈청
    rows.antenna = buildRow({ id: 'antenna', name: '안테나', desc: '방송을 멀리 보내 생존자를 부른다. 10·25·50기마다 2배' }, function () { buy(C.buyAntenna(state, qtyFor(C.maxAntennas(state), C.COUNT_MAX - state.antennas)), 'route'); });
    $('rows-z6').appendChild(rows.antenna.btn);
    $('serum').addEventListener('click', function () {
      var r = C.buySerum(state);
      if (!r.ok) return;
      log('혈청 ' + state.serumStage + '단계를 끝냈다.', 'good'); sfx('perk'); buzz(30); Store.save(); render();
    });
    $('ending-ok').addEventListener('click', function () { $('ending').hidden = true; pendingEnding = null; sfx('story'); });
    C.UPGRADES.forEach(function (u) {
      var r = buildRow(u, function () { buy(C.buyUpgrade(state, u.id), 'upgrade'); });
      r.btn.classList.add('row-zone');
      rows.upgrades[u.id] = r; $(u.zone < 0 ? 'ups-wall' : 'ups-z' + u.zone).appendChild(r.btn);      // zone -1 은 방벽 개조
    });
    C.DEFENSES.forEach(function (d) {
      var r = buildRow(d, function () { buy(C.buyDefense(state, d.id, qtyFor(C.maxDefenses(state, d.id), 1e6)), 'defense'); });
      rows.defenses[d.id] = r; $('rows-wall').appendChild(r.btn);
      // 수리공의 자동 구입 목표: 누를 때마다 끔 → 10 → 25 → … 로 넘어간다
      var ab = el('button', 'auto-def'); ab.type = 'button'; ab.id = 'auto-def-' + d.id;
      ab.addEventListener('click', function () { var res = C.cycleAutoDef(state, d.id); if (res.ok) { sfx('click'); Store.save(); render(); } });
      rows.autoDef = rows.autoDef || {}; rows.autoDef[d.id] = ab; $('auto-defs').appendChild(ab);
    });
    C.TRAITS.forEach(function (t) {
      var r = buildRow(t, function () { var res = C.buyTrait(state, t.id); if (res.ok) { sfx('trait'); Store.save(); render(); } });
      rows.traits[t.id] = r; $('traits').appendChild(r.btn);
    });
    // 구역 목표 세 줄
    for (var g = 0; g < 3; g++) {
      var li = el('li'), text = el('span'), num = el('span', 'num'), track = el('div', 'track'), bar = el('i');
      track.appendChild(bar); li.appendChild(text); li.appendChild(num); li.appendChild(track);
      rows.goals.push({ li: li, text: text, num: num, bar: bar });
      $('goals').appendChild(li);
    }
    C.ZONES.forEach(function (z) { var li = el('li', '', String(z.no)); li.title = z.no + '구역 ' + z.name; $('route').appendChild(li); });
    setText($('signal-gain'), '물자, 간식, 생산 ' + C.BUFF_MULT + '배 가운데 하나');
    buildNotes(); buildHelp(); buildStats();
    alignStatic();
  }
  /**
   * 화면 틀(template.html)에 처음부터 적혀 있는 글도 문장 단위로 묶는다(1.3.0).
   * 줄 정렬은 setText 로 넣는 글에만 걸려 있어서, 틀에 박아 둔 설명 글(특전 안내 등)은 문장 중간에서 줄이 바뀌었다.
   * 글만 든 요소(자식 요소가 없는 것) 가운데 문장이 둘 이상인 것만 건드린다.
   */
  function alignStatic() {
    try {
      Array.prototype.forEach.call(document.querySelectorAll('p, .hint, .label, .sync-q, .note, li, small'), function (n) {
        if (n.children.length || n.__raw !== undefined) return;
        var t = n.textContent;
        if (!t || (lines(t).indexOf(SEP) < 0 && t.indexOf(' · ') < 0)) return;
        n.__raw = t; fillText(n, t);
      });
    } catch (e) { /* 정렬은 꾸밈이다: 실패해도 글은 그대로 보인다 */ }
  }
  function addTab(id, label) {
    var b = el('button', '', label);
    b.type = 'button';
    b.setAttribute('data-tab', id);
    b.addEventListener('click', function () { if (tab !== id) pane = 'play'; tab = id; render(); });   // 다른 구역으로 가면 운영 화면부터
    rows.tabs[id] = b; $('zone-tabs').appendChild(b);
  }
  /** 수량 모드(×1, ×10, 최대)에서 실제로 살 개수. max 는 지금 살 수 있는 최대 수, room 은 상한까지 남은 자리. */
  /** 초를 글로: 정수면 '3초', 아니면 소수 한 자리 '2.6초'. */
  function secs(v) { return (Math.round(v * 10) / 10).toFixed(1).replace('.0', '') + '초'; }
  function qtyFor(max, room) { return Math.max(1, Math.min(Math.max(1, room), qtyMode === 'max' ? Math.max(1, max) : qtyMode)); }
  /** 구매 결과를 받아 소리를 내고 화면을 고친다. sound 는 무엇을 샀는지에 따라 다른 소리(없으면 시설을 살 때의 buy). */
  /*
   * 도전 칸(1.7.0): 목표 구역에 닿아 본 도전이 하나라도 있으면 보인다.
   *   줄을 누르면 켜고(확인 창), 진행 중인 줄을 누르면 포기한다(확인 창). 켤 수 없는 까닭은 줄 아래에 적는다.
   */
  var CHAL_WHY = { locked: '', used: '이번 회차에는 더 켤 수 없어요', late: '2구역 문을 열기 전에만 켤 수 있어요', broken: '이미 조건을 어겼어요. 다음 회차에 켜요' };
  function renderChallenges() {
    var panel = $('hub-panel'); if (!panel) return;
    var any = C.CHALLENGES.some(function (d) { return C.challengeOpen(state, d.id); }) || !!state.challenge;
    panel.hidden = !any; $('mnav-hub').hidden = !any;      // 고를 수 있는 도전이 생기면 모험 칸과 아래 탭이 나타난다
    if (!any) { if (!$('hub').hidden) $('hub').hidden = true; return; }
    var actNow = C.activeChallenge(state), mn = C.medalCount(state);
    setText($('hub-count'), '훈장 ' + mn + ' / ' + C.CHALLENGES.length);
    setText($('hub-hint'), actNow ? '도전 중 · ' + actNow.name + ' · ' + actNow.rule : '도전을 고르면 조건을 걸고 목표 구역까지 가요.');
    if (!rows.chal) {
      rows.chal = {};
      C.CHALLENGES.forEach(function (d) {
        var b = el('button', 'chal'), side = el('span', 'chal-side'), name = el('b', '', d.name), sub = el('span', 'chal-sub');
        b.type = 'button'; b.appendChild(side); b.appendChild(name); b.appendChild(sub);
        b.addEventListener('click', function () { clickChallenge(d); });
        rows.chal[d.id] = { btn: b, side: side, sub: sub };
        $('chal-list').appendChild(b);
      });
    }
    var act = C.activeChallenge(state), n = C.medalCount(state);
    setText($('chal-count'), '훈장 ' + n + ' / ' + C.CHALLENGES.length + ' · 생산 +' + Math.round(n * C.MEDAL_BONUS * 100) + '%');
    setText($('chal-hint'), act ? '진행 중 · ' + act.name + ' · ' + act.rule + (act.id === 'sprint' ? ' · 남은 시간 ' + clock(Math.max(0, C.SPRINT_SECONDS - state.runSeconds)) : '')
      : '조건을 하나 걸고 목표 구역까지 가요. 처음 성공하면 훈장과 영구 보상을 받아요.' + (state.challengeStreak > 0 ? '\n연속 성공 ' + state.challengeStreak + '번 · 간식 +' + C.streakTreats(state) + ' (최대 +' + C.STREAK_TREATS_MAX + ')' : ''));
    C.CHALLENGES.forEach(function (d) {
      var r = rows.chal[d.id], open = C.challengeOpen(state, d.id), on = !!act && act.id === d.id, why = on ? '' : C.challengeBlock(state, d.id), won = state.medals[d.id] > 0;
      var mine = state.challenge && state.challenge.id === d.id ? (state.challenge.done ? '이번 회차 성공' : state.challenge.failed ? '이번 회차 실패' : '') : '';
      r.btn.classList.toggle('on', on); r.btn.classList.toggle('won', won);
      r.btn.disabled = !on && !!why;
      setText(r.side, on ? '진행 중' : won ? '훈장 ×' + state.medals[d.id] : open ? '' : '잠김');
      setText(r.sub, !open ? C.challengeGoalText(d).replace(' 도착', '에 닿으면 열려요').replace('이야기의 끝', '이야기를 끝내면 열려요')
        : d.rule + ' · 목표 ' + C.challengeGoalText(d) + '\n' + (won ? '받은 보상 · ' : '보상 · ') + d.perk.text + (on ? ' · 누르면 포기' : mine ? ' · ' + mine : why && CHAL_WHY[why] ? '\n' + CHAL_WHY[why] : ''));
    });
  }
  /** 모험 창을 연다. 아래 탭과 상황 화면의 단추가 같이 쓴다. */
  function openHub() { if ($('mnav-hub').hidden) return; $('hub').hidden = false; renderChallenges(); }
  function clickChallenge(d) {
    if (C.activeChallenge(state) && state.challenge.id === d.id) {
      confirmBox('도전 포기', '〈' + d.name + '〉 도전을 포기해요. 조건이 풀리고 회차는 그대로 이어져요. 이번 회차에는 다시 켤 수 없고, 연속 성공이 끊겨요.', '계속한다', '포기한다', function () {
        var q = C.quitChallenge(state);
        if (q.ok) { log('도전 〈' + q.name + '〉을 포기했다.', ''); Store.save(); render(); }
      });
      return;
    }
    if (C.challengeBlock(state, d.id)) return;
    confirmBox('도전 〈' + d.name + '〉', d.rule + '. 목표는 ' + C.challengeGoalText(d) + '이에요. 보상은 ' + d.perk.text + '예요. 한 회차에 도전은 한 번만 켤 수 있어요.', '그만둔다', '도전한다', function () {
      var s = C.startChallenge(state, d.id);
      if (s.ok) { log('도전 〈' + d.name + '〉을 시작했다. ' + d.rule.replace('없어요', '없다').replace('해요', '한다').replace('돼요', '된다').replace('와요', '온다').replace('이에요', '이다').replace('가요', '간다') + '.', 'good'); sfx('relocate'); $('hub').hidden = true; if (fxShow) fxShow('도전', d.name + ' · ' + C.challengeGoalText(d), 1, -1, -1); Store.save(); render(); }
    });
  }
  function buy(result, sound) { if (result && result.ok) { sfx(sound || 'buy'); render(); } }
  /*
   * 패치노트: 버전마다 한 줄(버전, 날짜, 제목)만 보이고, 누르면 내용이 펼쳐진다.
   * 맨 위(최신 버전)는 처음부터 펼쳐져 있고 버전 옆에 노란 NEW 딱지가 붙는다.
   */
  function buildNotes() {
    if (!PATCH_NOTES.length) $('notes').appendChild(el('p', 'hint', '패치노트를 불러오지 못했다.'));
    PATCH_NOTES.forEach(function (n, i) {
      var box = el('div', 'note' + (i === 0 ? ' note-now open' : '')), head = el('button', 'note-head');
      head.type = 'button';
      head.setAttribute('aria-expanded', i === 0 ? 'true' : 'false');
      var ver = el('span', 'note-ver', n.ver);
      if (i === 0) ver.appendChild(el('b', 'note-new', 'NEW'));
      head.appendChild(ver);
      head.appendChild(el('span', 'note-title', n.title));
      head.appendChild(el('span', 'note-date', (n.at || n.date).slice(0, 10)));
      box.appendChild(head);
      var ul = el('ul');
      n.items.forEach(function (text) { ul.appendChild(el('li', '', text)); });
      box.appendChild(ul);
      head.addEventListener('click', function () {
        var open = !box.classList.contains('open');
        box.classList.toggle('open', open);
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      $('notes').appendChild(box);
    });
    setText($('notes-current'), PATCH_NOTES.length ? '현재 ' + PATCH_NOTES[0].ver : '');
  }

  /* ---------- 업적 ---------- */
  /*
   * 업적 화면: 공통과 구역마다 탭이 있고, 고른 묶음의 업적을 쉬운 것부터 보여 준다.
   *   달성한 것은 노란 표시, 아직인 것은 진행 막대와 '지금 / 목표'. 머리줄에는 달성 수와 지금의 생산 보너스.
   */
  var achTab = 'all', achShown = '';
  var ACH_GROUPS = [['all', '공통'], ['z1', '1구역'], ['z2', '2구역'], ['z3', '3구역'], ['z4', '4구역'], ['z5', '5구역'], ['z6', '6구역'], ['z7', '7구역']];
  var TIER_NAMES = ['', '쉬움', '반복', '어려움', '아주 어려움'];
  function renderAch() {
    var list = C.ACHIEVEMENTS.filter(function (a) { return a.group === achTab; });
    var prog = list.map(function (a) { return C.achProgress(state, a); });
    var key = achTab + '|' + Math.max(state.zone, state.bestZone || 0) + '|' + prog.map(function (p) { return (p.done ? 'd' : '') + Math.floor(p.value / p.need * 50); }).join(',');
    if (key === achShown) return;
    achShown = key;
    var total = C.achCount(state);
    setText($('ach-count'), total + ' / ' + C.ACHIEVEMENTS.length + ' · 생산 +' + (total * C.ACH_BONUS * 100).toFixed(1).replace('.0', '') + '%');
    var tabs = $('ach-tabs'), box = $('ach');
    tabs.textContent = ''; box.textContent = '';
    ACH_GROUPS.forEach(function (g) {
      var all = C.ACHIEVEMENTS.filter(function (a) { return a.group === g[0]; }), got = all.filter(function (a) { return state.ach[a.id]; }).length;
      var b = el('button', '', g[1] + ' ' + got + '/' + all.length);
      b.type = 'button'; b.setAttribute('aria-pressed', g[0] === achTab ? 'true' : 'false');
      b.addEventListener('click', function () { achTab = g[0]; renderAch(); });
      tabs.appendChild(b);
    });
    // 아직인 것을 위로, 그 안에서는 쉬운 것부터. 달성한 것은 아래에 모은다
    var order = list.map(function (a, i) { return i; }).sort(function (x, y) { return (prog[x].done - prog[y].done) || (list[x].tier - list[y].tier) || (x - y); });
    order.forEach(function (i) {
      var a = list[i], p = prog[i], card = el('div', 'ach-card tier' + a.tier + (p.done ? ' done' : '')), head = el('div', 'ach-head');
      // 아직 가 보지 못한 구역의 업적은 이름과 조건을 가린다(1.2.4): 뒤 구역에서 무엇을 하는지 미리 알려 주지 않는다. 한 번이라도 가 본 구역은 철수해도 보인다
      var zoneNo = /^z\d$/.test(a.group) ? Number(a.group.slice(1)) : 0;
      if (zoneNo && !p.done && Math.max(state.zone, state.bestZone || 0) < zoneNo - 1) {
        card.className = 'ach-card hidden-ach';
        head.appendChild(el('b', '', '???')); head.appendChild(el('span', 'ach-tier', TIER_NAMES[a.tier]));
        card.appendChild(head); card.appendChild(el('p', '', zoneNo + '구역을 열면 보여요.'));
        box.appendChild(card);
        return;
      }
      head.appendChild(el('b', '', a.name)); head.appendChild(el('span', 'ach-tier', p.done ? '달성' + (p.at ? ' · ' + dayText(p.at) : '') : TIER_NAMES[a.tier] + (p.retreats ? ' · 철수 ' + p.retreats + '번 뒤' : '')));      // 달성한 날짜(적어 둔 것만)
      card.appendChild(head); card.appendChild(el('p', '', a.text));
      if (p.locked) card.appendChild(el('p', 'ach-lock', '철수를 ' + p.retreats + '번 한 뒤에 달성할 수 있어요(지금 ' + state.retreats + '번).'));
      if (!p.done) {
        var bar = el('div', 'autobar');
        fill(bar, p.value / p.need);
        card.appendChild(bar);
        card.appendChild(el('span', 'label num', (a.need >= 1e4 ? fmt(p.value) + ' / ' + fmt(p.need) : Math.floor(p.value) + ' / ' + a.need)));
      }
      box.appendChild(card);
    });
  }

  /** 시각(ms)을 '2026.11.17' 꼴의 날짜로. 잘못된 값이면 빈 글. */
  function dayText(ms) {
    var d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + ('0' + d.getDate()).slice(-2);
  }

  /* ---------- 도감 ---------- */
  /*
   * 도감: 동물 친구(만난 아이만 모습이 보인다), 좀비, 방어 수단. 기록 화면의 '도감' 탭에서 본다.
   *   그림은 도트를 SVG 로 옮긴다(pixSvg). 좀비는 도트 화면의 그림(Scene.zombieFrames)을 그대로 쓴다.
   */
  var DOG_PIX = ['..........pp..', '.........bbbb.', '.........bkbbn', 'b........bbbb.', 'bb.bbbbbbbbb..', '.bbbbppbbbbb..', '..bbbbppbbbb..', '..bbbbbbbbbb..', '..bb.b..bb.b..', '..bb.b..bb.b..'];
  var CAT_PIX = ['.........b..b.', '.........bbbb.', 'b........bkbk.', 'b........bbnb.', 'b..bbbbbbbbb..', 'bb.bppbbbbbb..', '.bbbbppbbbbb..', '..bbbbbbbbbb..', '..b.b...b.b...', '..b.b...b.b...'];
  var ZOMBIE_PAL = { g: '#7da35a', x: '#17180f', c: '#5a5f6a', d: '#3a3f4a', h: '#3a2a22' };
  var ZOMBIE_DEX = [
    { id: 'walker', name: '배회자', text: '가장 흔해요. 느리지만 끝없이 와요.' },
    { id: 'hair', name: '긴 머리', text: '머리카락에 얼굴이 가려져 있어요. 조금 느려요.' },
    { id: 'runner', name: '달리는 것', text: '몸을 숙이고 뛰어와요. 가장 빨라요.' },
    { id: 'brute', name: '덩치', text: '어깨가 넓고 한 발을 더 버텨요.' },
    { id: 'boss', name: '변이체', text: '몇 밤에 한 번 무리를 이끌고 와요. 여러 발을 맞아야 쓰러져요.', frames: 'walker', big: true }
  ];
  var LEAD_TEXT = { wire: '무리를 느리게 해요. 주역으로 나오지는 않아요.', tower: '주역일 때: 저격 한 발.', turret: '주역일 때: 세 발 연사.',
    flame: '주역일 때: 불길을 깔아 가까운 좀비를 모두 태워요.', emp: '주역일 때: 번개가 셋까지 옮겨 붙어요.', rail: '주역일 때: 화면 끝까지 꿰뚫어요.' };
  /** 도트 그림(글자 줄)을 SVG 로. pal 에 없는 글자는 비운다. */
  function pixSvg(rowsPix, pal, cls) {
    var h = rowsPix.length, w = 0;
    rowsPix.forEach(function (r) { w = Math.max(w, r.length); });
    var svg = svgEl('svg', { viewBox: '0 0 ' + w + ' ' + h, 'class': 'pix ' + (cls || ''), 'aria-hidden': 'true' });
    rowsPix.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) if (pal[row[x]]) svg.appendChild(svgEl('rect', { x: x, y: y, width: 1, height: 1, fill: pal[row[x]] }));
    });
    return svg;
  }
  /* 방어 수단의 도트 그림(12×12). k 어두운 쇠, s 쇠, l 밝은 쇠, w 나무, y 노랑, r 빨강, o 주황, c 번개, b 파랑 */
  var WALL_PAL = { k: '#2a2c24', s: '#8d949e', l: '#cfd3d8', w: '#8a5a34', y: '#f0b400', r: '#e0392b', o: '#e0602b', c: '#7fe0f0', b: '#3f6f8f' };
  var WALL_PAL_OFF = { k: '#4a4b40', s: '#4a4b40', l: '#55564a', w: '#4a4b40', y: '#55564a', r: '#4a4b40', o: '#4a4b40', c: '#55564a', b: '#4a4b40' };
  var WALL_PIX = {
    wire:   ['............', 'w....w....w.', 'wl..lwl..lw.', 'w.ll.w.ll.w.', 'wl..lwl..lw.', 'w.ll.w.ll.w.', 'wl..lwl..lw.', 'w.ll.w.ll.w.', 'w....w....w.', 'w....w....w.', 'w....w....w.', 'w....w....w.'],
    tower:  ['..wwwwwwww..', '.wwwwwwwwww.', '..k......k..', '..kyyyyyyk..', '..ssssssss..', '..ssssssss..', '....w..w....', '....wwww....', '....w..w....', '....wwww....', '....w..w....', '...ww..ww...'],
    turret: ['............', '............', '..yyyyyy....', '..ssssssllll', '..ssrsss....', '..ssssssllll', '..ssssss....', '...kkkk.....', '...kkkk.....', '..kkkkkk....', '.kkkkkkkk...', '.kkkkkkkk...'],
    flame:  ['.......o....', '......oo..o.', '.....oyo.oo.', '....oyyooyo.', '....oyyyyyo.', '.....oyyyo..', 'rr....ooo...', 'rr..........', 'yyssssssk...', 'rr....ssk...', 'rr..........', 'rr..........'],
    emp:    ['.cc......cc.', '.cc..c...cc.', '.kk.c.c..kk.', 'owwo..c.owwo', '.kk....c.kk.', 'owwo.c..owwo', '.kk.c....kk.', 'owwo.c..owwo', '.kk......kk.', '.kk......kk.', '.kk......kk.', 'kkkk....kkkk'],
    rail:   ['............', '............', 'yyyyyy......', 'ssssssllllll', 'sbbsss.s.s.s', 'sbbsss.s.s.s', 'ssssssllllll', 'ssssss......', '..kkkk......', '..kkkk......', '.kkkkkk.....', 'kkkkkkkk....']
  };
  var dexTab = 'pet', dexShown = '';
  var LEAD_SHORT = { wire: '무리를 느리게 해요.', tower: '주역일 때 저격 한 발.', turret: '주역일 때 세 발 연사.', flame: '주역일 때 불길을 깔아요.', emp: '주역일 때 번개가 옮겨 붙어요.', rail: '주역일 때 끝까지 꿰뚫어요.' };
  /*
   * 도감 화면: 강아지 / 고양이 / 좀비 / 방어 수단 네 탭. 카드의 글은 한 줄에 들어가게 짧게 쓴다.
   *   아직 만나지 못한 것은 회색 그림자와 '???' 로 보이고, 어디서 만날 수 있는지만 알려 준다.
   */
  var DOC_PIX = ['.pppppp..', '.ppppppp.', '.pllllpp.', '.ppppppp.', '.plllllp.', '.ppppppp.', '.pllllpp.', '.ppppppp.', '.ppppkkp.', '.ppppppp.'];      // 서류의 모습(종이 p, 글줄 l, 도장 k)
  var CAR_PIX = ['..........', '.cccccccc.', '.cwccccwc.', '.cccccccc.', '.cccccccc.', 'dddddddddd', '.kk....kk.', '.kk....kk.'];      // 화물칸의 모습(몸통 c, 창 w, 받침 d, 바퀴 k)
  var REG_PIX = ['..hhh...', '.hhhhh..', '.hsssh..', '..sss...', '.ccccc..', 'scccccs.', '.ccccc..', '.ccccc..', '.dd.dd..', '.dd.dd..'];      // 단골의 모습(머리 h, 살 s, 옷 c, 바지 d)
  function renderDex() {
    if (dexTab === 'pet') dexTab = 'dog';
    var key = dexTab + '|' + JSON.stringify(state.kennel) + '|' + JSON.stringify(state.petLv) + '|' + JSON.stringify(state.defenses) + '|' + JSON.stringify(state.zdex) + '|' + JSON.stringify(state.regulars) + '|' + JSON.stringify(state.clients) + '|' + JSON.stringify(state.cargos) + '|' + JSON.stringify(state.records) + '|' + JSON.stringify(state.passers) + '|' + (state.pet ? state.pet.breed : '') + '|' + state.zone;
    if (key === dexShown) return;
    dexShown = key;
    var tabs = $('dex-tabs'), box = $('dex');
    tabs.textContent = ''; box.textContent = '';
    function have(kind) { return C.PET_BREEDS.filter(function (b) { return b.kind === kind && state.kennel[b.id]; }).length; }
    [['dog', '강아지 ' + have('dog') + '/12'], ['cat', '고양이 ' + have('cat') + '/12'], ['zombie', '좀비 ' + C.zdexCount(state) + '/' + C.ZOMBIE_KINDS.length], ['regular', '단골 ' + C.regularCount(state) + '/' + C.REGULARS.length], ['client', '거래처 ' + C.clientCount(state) + '/' + C.CLIENTS.length], ['cargo', '화물 ' + C.cargoCount(state) + '/' + C.CARGOS.length], ['record', '서류 ' + C.recordCount(state) + '/' + C.RECORDS.length], ['passer', '통행인 ' + C.passerCount(state) + '/' + C.PASSERS.length], ['wall', '방어 수단']].forEach(function (t) {
      var b = el('button', '', t[1]);
      b.type = 'button'; b.setAttribute('aria-pressed', t[0] === dexTab ? 'true' : 'false');
      b.addEventListener('click', function () { dexTab = t[0]; renderDex(); });
      tabs.appendChild(b);
    });
    // 탭이 여덟이라 폰에서는 옆으로 밀어서 본다: 고른 탭이 화면 밖에 있으면 보이는 자리로 옮긴다
    try { var on = tabs.querySelector('[aria-pressed="true"]'); if (on) tabs.scrollLeft = Math.max(0, on.offsetLeft - (tabs.clientWidth - on.offsetWidth) / 2); } catch (e) { /* 못 옮겨도 누르는 데는 지장이 없다 */ }
    function card(art, name, sub, text, locked, cls) {
      var c = el('div', 'dex-card' + (locked ? ' locked' : '') + (cls ? ' ' + cls : '')), body = el('div');
      var frame = el('div', 'dex-art'); frame.appendChild(art);
      body.appendChild(el('b', '', name)); body.appendChild(el('span', 'label', sub)); body.appendChild(el('p', '', text));
      c.appendChild(frame); c.appendChild(body); box.appendChild(c);
    }
    if (dexTab === 'dog' || dexTab === 'cat') {
      // 등급 순(기본 → 고급 → 희귀)으로 늘어놓는다
      var order = { common: 0, fine: 1, rare: 2 };
      C.PET_BREEDS.filter(function (b) { return b.kind === dexTab; }).sort(function (x, y) { return order[x.rarity] - order[y.rarity]; }).forEach(function (b) {
        var got = !!state.kennel[b.id], kind = C.PET_KINDS[b.kind], rar = null;
        C.PET_RARITIES.forEach(function (r) { if (r.id === b.rarity) rar = r; });
        var pal = got ? { b: b.body, p: b.patch || b.body, k: '#17180f', n: '#17180f' } : { b: '#4a4b40', p: '#4a4b40', k: '#4a4b40', n: '#4a4b40' };
        var art = pixSvg(b.kind === 'cat' ? CAT_PIX : DOG_PIX, pal), rname = rar ? rar.name : '';
        if (!got) { card(art, '???', rname + ' 등급', '데려오기에서 만날 수 있어요.', true, 'r-' + b.rarity); return; }
        var lv = C.petLevel(state, b.id), with_ = state.pet && state.pet.breed === b.id;
        var bonus = Math.round((rar ? rar[b.kind] : 0) * (1 + C.PET_LEVEL_STEP * lv) * 100);
        card(art, state.kennel[b.id] + (with_ ? ' ★' : ''), rname + ' · ' + b.name + ' · Lv ' + lv + ' / ' + C.PET_LEVEL_MAX, kind.label + ' +' + bonus + '%', false, 'r-' + b.rarity);
      });
    } else if (dexTab === 'zombie') {
      C.ZOMBIE_KINDS.forEach(function (z) {
        var n = state.zdex[z.id] || 0, rows = window.Scene && window.Scene.zombieFrames ? window.Scene.zombieFrames(z.frames)[0] : ['g'];
        var pal = {}, k;
        for (k in ZOMBIE_PAL) pal[k] = n ? (z.pal[k] || ZOMBIE_PAL[k]) : '#4a4b40';
        var rname = C.ZOMBIE_RARITIES[z.rarity];
        if (!n) { card(pixSvg(rows, pal, z.big ? 'big' : ''), '???', rname, z.zone > state.zone ? (z.zone + 1) + '구역을 열면 나와요.' : z.boss ? '변이체가 오는 밤에 나와요.' : '밤을 넘기다 보면 만나요.', true, 'z-' + z.rarity); return; }
        card(pixSvg(rows, pal, z.big ? 'big' : ''), z.name, rname + ' · 만난 밤 ' + fmt(n), z.text, false, 'z-' + z.rarity);
      });
    } else if (dexTab === 'passer') {
      // 통행인: 6구역에서 넉넉하게 막은 밤에 다리를 건넌 사람들
      C.PASSERS.forEach(function (r) {
        var n = state.passers[r.id] || 0;
        var pal = n ? { h: '#3a2e22', s: '#e8c39a', c: r.color, d: '#3b3f4a' } : { h: '#4a4b40', s: '#4a4b40', c: '#4a4b40', d: '#4a4b40' };
        if (!n) { card(pixSvg(REG_PIX, pal), '???', '아직 못 만났어요', '6구역에서 밤을 넉넉히 막으면 와요.', true); return; }
        card(pixSvg(REG_PIX, pal), r.name, '건넌 수 ' + fmt(n) + '번', r.text, false);
      });
    } else if (dexTab === 'record') {
      // 서류: 5구역에서 과제를 끝내다 찾은 병원 서류들
      C.RECORDS.forEach(function (r) {
        var n = state.records[r.id] || 0;
        var pal = n ? { p: r.color, l: '#8a8a82', k: '#17180f' } : { p: '#4a4b40', l: '#4a4b40', k: '#4a4b40' };
        if (!n) { card(pixSvg(DOC_PIX, pal), '???', '아직 못 찾았어요', '5구역에서 과제를 끝내다 보면 나와요.', true); return; }
        card(pixSvg(DOC_PIX, pal), r.name, '찾은 수 ' + fmt(n) + '장', r.text, false);
      });
    } else if (dexTab === 'cargo') {
      // 화물: 4구역에서 끌어온 표류 화물칸들
      C.CARGOS.forEach(function (r) {
        var n = state.cargos[r.id] || 0;
        var pal = n ? { c: r.color, w: '#e6e5db', d: '#3a3f4a', k: '#17180f' } : { c: '#4a4b40', w: '#4a4b40', d: '#4a4b40', k: '#4a4b40' };
        if (!n) { card(pixSvg(CAR_PIX, pal), '???', '아직 못 찾았어요', '4구역에서 표류 화물을 끌어오면 적혀요.', true); return; }
        card(pixSvg(CAR_PIX, pal), r.name, '끌어온 수 ' + fmt(n) + '번', r.text, false);
      });
    } else if (dexTab === 'client') {
      // 거래처: 3구역에서 납품 의뢰를 채워 준 곳들
      C.CLIENTS.forEach(function (r) {
        var n = state.clients[r.id] || 0;
        var pal = n ? { h: r.hair, s: '#e8c39e', c: r.color, d: '#3a3f4a' } : { h: '#4a4b40', s: '#4a4b40', c: '#4a4b40', d: '#4a4b40' };
        if (!n) { card(pixSvg(REG_PIX, pal), '???', '아직 거래가 없어요', '3구역에서 납품 의뢰를 채우면 만나요.', true); return; }
        card(pixSvg(REG_PIX, pal), r.name, '채운 의뢰 ' + fmt(n) + '번', r.text, false);
      });
    } else if (dexTab === 'regular') {
      // 단골: 2구역에서 주문을 채워 준 사람들. 아직 못 만난 사람은 그림자로 보인다
      C.REGULARS.forEach(function (r) {
        var n = state.regulars[r.id] || 0;
        var pal = n ? { h: r.hair, s: '#e8c39e', c: r.color, d: '#3a3f4a' } : { h: '#4a4b40', s: '#4a4b40', c: '#4a4b40', d: '#4a4b40' };
        if (!n) { card(pixSvg(REG_PIX, pal), '???', '아직 못 만났어요', '2구역에서 주문을 채워 주면 만나요.', true); return; }
        card(pixSvg(REG_PIX, pal), r.name, '채운 주문 ' + fmt(n) + '번', r.text, false);
      });
    } else {
      C.DEFENSES.forEach(function (d) {
        var n = state.defenses[d.id] || 0, art = pixSvg(WALL_PIX[d.id] || ['k'], n ? WALL_PAL : WALL_PAL_OFF);
        card(art, d.name, n ? '가진 수 ' + fmt(n) : '아직 없어요', LEAD_SHORT[d.id] || d.desc, !n);
      });
    }
  }

  /** 도움말은 부가 요소라, 모듈이 빠졌거나 글을 만들다 오류가 나도 게임은 그대로 진행한다. */
  function buildHelp() {
    var list = [];
    try { if (window.Help) list = window.Help.sections(C); } catch (e) { console.warn('help', e); list = []; }
    if (!list.length) { $('help').appendChild(el('p', 'hint', '도움말을 불러오지 못했다.')); return; }
    // 항목마다 탭 하나. 한 번에 한 항목만 보여서 길게 내리지 않아도 된다
    var tabs = $('help-tabs'), shown = 0;
    function show(n) {
      shown = n;
      var sec = list[n], box = el('div', 'note'), ul = el('ul');
      $('help').textContent = '';
      box.appendChild(el('div', 'note-ver help-title', sec.title));
      sec.items.forEach(function (text) { ul.appendChild(el('li', '', text)); });
      box.appendChild(ul);
      $('help').appendChild(box);
      Array.prototype.forEach.call(tabs.children, function (b, k) { b.setAttribute('aria-pressed', k === n ? 'true' : 'false'); });
    }
    list.forEach(function (sec, n) {
      var btn = el('button', '', sec.tab || sec.title);
      btn.type = 'button';
      btn.addEventListener('click', function () { show(n); });
      tabs.appendChild(btn);
    });
    show(0);
  }
  /*
   * 통계: 맨 위에 큰 숫자 셋(어디까지 갔나, 항체, 진행 시간), 그 아래 '이번 회차'과 '전체'를 나눠 보여 준다.
   *   [id, 이름] 의 id 는 renderStats 가 값을 채우는 자리(rows.stats)다.
   */
  var STAT_HERO = [['best', '가장 멀리 간 구역'], ['antibody', '얻은 항체 샘플'], ['total', '진행 시간']];
  var STAT_GROUPS = [
    ['이번 회차', [['run', '걸린 시간'], ['runEarned', '모은 물자'], ['waves', '방어 성공한 밤']]],
    ['전체', [['lifetime', '모은 물자'], ['retreats', '철수'], ['clicks', '직접 수색'], ['play', '켜 둔 시간'], ['away', '자리 비운 시간'], ['days', '시작한 지']]]
  ];
  function buildStats() {
    var root = $('stats-grid');
    function cells(list, cls) {
      var dl = el('dl', 'stats ' + cls);
      list.forEach(function (c) {
        var box = el('div');
        box.appendChild(el('dt', '', c[1]));
        rows.stats[c[0]] = el('dd', '', '-');
        box.appendChild(rows.stats[c[0]]);
        dl.appendChild(box);
      });
      return dl;
    }
    root.appendChild(cells(STAT_HERO, 'stats-hero'));
    STAT_GROUPS.forEach(function (g) { root.appendChild(el('h3', 'stats-h', g[0])); root.appendChild(cells(g[1], '')); });
  }
  function renderStats() {
    var st = C.stats(state, Date.now()), d = C.formatDuration, c = rows.stats;
    setText(c.total, d(st.total)); setText(c.play, d(st.play)); setText(c.away, d(st.away));
    setText(c.days, st.days === null ? '기록 없음' : st.days + '일째');
    setText(c.run, d(st.run)); setText(c.retreats, st.retreats + '번');
    setText(c.best, (st.bestZone + 1) + '구역');
    setText(c.antibody, fmt(st.antibodyTotal) + '개'); setText(c.runEarned, fmt(st.runEarned)); setText(c.lifetime, fmt(st.lifetimeEarned));
    setText(c.waves, st.wavesCleared + '밤'); setText(c.clicks, fmt(st.clicks) + '번');
    // 지난 구역: 이번 회차에 지나온 구역마다 머문 시간(지금 있는 구역은 계속 늘어난다)
    var key = st.zones.map(function (r) { return r.zone + ':' + (r.seconds === null ? '-' : Math.floor(r.seconds)); }).join('|');
    if (key === statsShown) return;
    statsShown = key;
    var list = $('stats-zones'), longest = 1;
    list.textContent = '';
    st.zones.forEach(function (r) { if (r.seconds > longest) longest = r.seconds; });
    st.zones.forEach(function (r) {
      var li = el('li', r.here ? 'bar here' : 'bar');
      fill(li, r.seconds === null ? 0 : r.seconds / longest);      // 머문 시간만큼 막대가 찬다(가장 오래 머문 구역이 가득)
      li.appendChild(el('span', '', (r.zone + 1) + '구역 ' + r.name + (r.here ? ' · 현재' : '')));
      li.appendChild(el('span', 'num', r.seconds === null ? '기록 없음' : (r.here ? '' : '머문 시간 ') + d(r.seconds)));
      list.appendChild(li);
    });
    if (st.runs.length) {
      var last = st.runs[0], note = el('li', 'hint', '지난번 철수: ' + (last.zone + 1) + '구역까지 · ' + d(last.seconds) + ' · 항체 +' + fmt(last.antibodies));
      list.appendChild(note);
    }
  }

  function wireOrder() {
    $('order-fill').addEventListener('click', function () {
      var r = C.fillOrder(state);
      if (!r.ok) return;
      if (r.first) { toast('새 단골 · ' + r.name); log('새 단골이 생겼다. ' + r.name + '. 도감에 적었다.', 'good'); sfx('goal'); }
      else { log(r.name + '에게 상품을 팔았다. 물자 ' + fmt(r.gain) + ' 확보.', 'good'); sfx('sell'); }
      buzz(20); Store.save(); render();
    });
  }
  function wireSalvage() {
    $('salvage-fill').addEventListener('click', function () {
      var r = C.fillSalvage(state);
      if (!r.ok) return;
      if (r.first) { toast('새 화물 · ' + r.name); log(r.name + (C.hasBatchim(r.name) ? '을' : '를') + ' 끌어왔다. 도감에 적었다.', 'good'); sfx('goal'); }
      else { log(r.name + (C.hasBatchim(r.name) ? '을' : '를') + ' 끌어왔다. 물자 ' + fmt(r.gain) + ' 확보.', 'good'); sfx('train'); }
      buzz(20); Store.save(); render();
    });
  }
  /** 3구역의 품목 고르기, 고장 고치기, 출하 트럭 싣기. */
  function wireLineExtras() {
    rows.recipes = {};
    C.RECIPES.forEach(function (r) {
      var b = el('button'); b.type = 'button';
      b.appendChild(document.createTextNode(r.name)); var sm = el('small', '', ''); b.appendChild(sm); b.__small = sm;
      b.addEventListener('click', function () {
        var res = C.setRecipe(state, r.id);
        if (!res.ok) return;
        log(r.name + (C.hasBatchim(r.name) ? '으로' : '로') + ' 품목을 바꾼다. 라인이 ' + res.seconds + '초 선다.', ''); sfx('machine'); buzz(15); Store.save(); render();
      });
      rows.recipes[r.id] = b; $('recipes').appendChild(b);
    });
    $('jam-fix').addEventListener('click', function () {
      var res = C.repairJam(state);
      if (!res.ok) return;
      log('기계를 고쳤다. ' + res.seconds + '초 동안 라인이 ' + C.TUNE_MULT + '배로 돈다.', 'good'); sfx('upgrade'); buzz(25); Store.save(); render();
    });
    $('rebalance').addEventListener('click', function () {
      confirmBox('기계 다시 맞추기', '기계에 쓴 물자만큼, 세 기계의 처리량이 같아지도록 레벨을 다시 나눠요. 남는 값은 물자로 돌려받아요. ' + C.REBALANCE_SECONDS + '초 동안 라인이 서요.', '그만둔다', '다시 맞춘다', function () {
        var res = C.rebalanceLine(state);
        if (!res.ok) return;
        log('기계를 다시 맞췄다. ' + res.seconds + '초 동안 라인이 선다.', 'good'); sfx('machine'); buzz(25); Store.save(); render();
      });
    });
    // 구역마다 주문·사건 자동을 켜고 끈다(그 구역의 자동 개조가 있을 때만 보인다)
    $('auto-ev').addEventListener('change', function () {
      var zi = /^z\d$/.test(tab) ? Number(tab.slice(1)) : -1;
      if (!C.setAutoEvents(state, zi, $('auto-ev').checked).ok) return;
      sfx('click'); Store.save(); render();
    });
    $('strike').addEventListener('click', function () {
      if (!C.strike(state).ok) return;
      log('선제 공격을 나간다. 오늘 밤 무리는 절반이다.', 'good'); sfx('defense'); buzz(30); Store.save(); render();
    });
    $('counter').addEventListener('click', function () {
      if (!C.counterAttack(state).ok) return;
      log('버틴 만큼 되갚는다. 오늘 밤 무리는 절반이다.', 'good'); sfx('defense'); buzz(30); Store.save(); render();
    });
    $('truck-load').addEventListener('click', function () {
      var res = C.loadTruck(state, false);
      if (!res.ok) return;
      log('트럭에 실어 보냈다. 물자 ' + fmt(res.gain) + ' 확보.', 'good'); sfx('train'); buzz(25); Store.save(); render();
    });
  }
  /** 4·6·7구역의 사건 칸과 5구역의 밤샘 연구. */
  var ZEV_TEXT = {
    rail:  { lead: '급한 화물을 실어 달라는 무전이 왔어요.', now: '바로 받는다', boost: '단골로 만든다', what: '화물 값', done: '특별 화물을 실어 보냈다.', kept: '화물을 맡기는 단골이 생겼다.' },
    guard: { lead: '사람들이 다리 앞에 줄을 섰어요.', now: '통과시킨다', boost: '쉬어 가게 한다', what: '통행 물자', done: '행렬을 통과시켰다.', kept: '행렬이 초소 옆에서 쉬어 갔다. 소문이 난다.' },
    tower: { lead: '어딘가에서 무전이 들어왔어요.', now: '응답한다', boost: '', what: '', done: '무전에 응답했다.', kept: '' }
  };
  function wireZoneEvents() {
    C.ZONE_EVENTS.forEach(function (def) {
      def.choices.forEach(function (choice) {
        $('zev-' + def.id + '-' + choice).addEventListener('click', function () {
          var r = C.answerZoneEvent(state, def.id, choice, false), t = ZEV_TEXT[def.id];
          if (!r.ok) return;
          if (choice === 'boost') log(t.kept + ' ' + t.what + ' +' + Math.round(r.boost * 100) + '%.', 'good');
          else if (r.people) log(t.done + ' 생존자 ' + fmt(r.people) + '명이 왔다.', 'good');
          else log(t.done + ' 물자 ' + fmt(r.gain) + ' 확보.', 'good');
          sfx(choice === 'boost' ? 'perk' : 'route'); buzz(25); Store.save(); render();
        });
      });
    });
    C.PUSHES.forEach(function (def) {
      $('push-' + def.id).addEventListener('click', function () {
        var r = C.pushZone(state, def.id);
        if (!r.ok) return;
        log(def.id === 'guard' ? '초소를 한 바퀴 돈다. ' + r.seconds + '초 동안 통행 물자가 ' + C.PUSH_MULT + '배다.' : '마이크를 잡았다. ' + r.seconds + '초 동안 생존자가 ' + C.PUSH_MULT + '배로 모인다.', 'good');
        sfx('signal'); buzz(25); Store.save(); render();
      });
    });
    $('lab-focus').addEventListener('click', function () {
      var r = C.focusLab(state);
      if (!r.ok) return;
      log('밤샘 연구를 시작했다. ' + r.seconds + '초 동안 연구가 ' + C.FOCUS_MULT + '배로 빨라진다.', 'good'); sfx('staff'); buzz(25); Store.save(); render();
    });
  }
  /** 순찰·직접 방송 단추를 그린다(밤샘 연구와 같은 모양). */
  function renderPush(id, label) {
    var p = state.push[id], b = $('push-' + id), on = p.left > 0;
    b.disabled = on || p.cool > 0 || !(C.zevReward(state, id, false) > 0);
    b.className = 'surge' + (on ? ' on' : '');
    setText(b, on ? label + ' 중 ' + Math.ceil(p.left) + '초' : p.cool > 0 ? '다음 ' + label + ' ' + clock(p.cool) : label + ' ×' + C.PUSH_MULT);
    fill(b, on ? p.left / C.PUSH_SECONDS : p.cool > 0 ? 1 - p.cool / C.PUSH_COOL : 0);
  }
  /** 사건 칸 하나를 그린다. */
  function renderZoneEvent(id) {
    var ev = state.zev && state.zev[id], box = $('zev-' + id), t = ZEV_TEXT[id];
    box.hidden = !ev;
    if (!ev) return;
    setText($('zev-' + id + '-left'), clock(ev.left));
    var reward = C.zevReward(state, id, false);
    setText($('zev-' + id + '-text'), t.lead);
    setText($('zev-' + id + '-now'), t.now + ' · ' + (id === 'tower' ? '생존자 +' + fmt(reward) + '명' : '물자 +' + fmt(reward)));
    if (t.boost) {
      var cur = id === 'rail' ? state.railBoost : state.guardBoost, full = cur >= C.ZEV_BOOST_MAX - 1e-9, bb = $('zev-' + id + '-boost');
      bb.disabled = full;
      setText(bb, full ? t.what + ' +' + Math.round(cur * 100) + '% · 최대' : t.boost + ' · ' + t.what + ' +' + Math.round(C.ZEV_BOOST * 100) + '% (현재 +' + Math.round(cur * 100) + '% / 최대 +' + Math.round(C.ZEV_BOOST_MAX * 100) + '%)');
    }
  }
  function wireContract() {
    $('contract-fill').addEventListener('click', function () {
      var r = C.fillContract(state);
      if (!r.ok) return;
      if (r.first) { toast('새 거래처 · ' + r.name); log('새 거래처가 생겼다. ' + r.name + '. 도감에 적었다.', 'good'); sfx('goal'); }
      else { log(r.name + '에 납품했다. 물자 ' + fmt(r.gain) + ' 확보.', 'good'); sfx('machine'); }
      buzz(20); Store.save(); render();
    });
  }
  function wirePerkReroll() {
    $('perk-reroll').addEventListener('click', function () {
      var r = C.rerollPerks(state, Math.random);
      if (!r.ok) return;
      log('특전 후보를 다시 뽑았다.', '');
      sfx('click'); Store.save(); render();
    });
  }
  /* ---------- 특전 고르기 ---------- */
  /** 골라야 할 특전이 있으면 선택 창을 띄운다. 게임은 뒤에서 계속 진행된다. */
  function renderPerkChoice() {
    // 일지 창이 떠 있는 동안에는 특전 창을 띄우지 않는다: 목표를 채우면 일지와 특전이 한꺼번에 열려 두 창이 겹쳤다. 일지를 닫으면 이어서 뜬다
    if (!$('story').hidden) { if (!$('perk').hidden) { $('perk').hidden = true; perkShown = ''; } return; }
    var key = state.pendingPerks.join(',') + '|' + C.rerollsLeft(state);
    if (key === perkShown) return;
    perkShown = key;
    var box = $('perk-list');
    box.textContent = '';
    if (!state.pendingPerks.length) { $('perk').hidden = true; return; }
    setText($('perk-lead'), (state.perkFrom === 'boss' ? '변이체를 막아냈어요.' : '구역 목표를 달성했어요.') + ' 하나를 골라 주세요. 이번 회차가 끝날 때까지 남아요.');
    state.pendingPerks.forEach(function (id) {
      var def = null;
      C.PERKS.forEach(function (k) { if (k.id === id) def = k; });
      if (!def) return;
      var btn = el('button', 'sync-pick'), name = el('b', '', def.name);
      btn.type = 'button';
      name.setAttribute('data-lv', 'Lv ' + state.perks[id] + ' → ' + (state.perks[id] + 1));
      btn.appendChild(name);
      btn.appendChild(el('span', '', '레벨당 ' + def.desc));
      btn.addEventListener('click', function () {
        var r = C.choosePerk(state, id);
        if (!r.ok) return;
        log('특전을 골랐다: ' + def.name + ' Lv ' + r.level + '.', 'good');
        sfx('perk'); Store.save(); render();
      });
      box.appendChild(btn);
    });
    // 다시 뽑기(영구 특성): 남은 횟수가 있을 때만 단추가 보인다
    var left = C.rerollsLeft(state), rr = $('perk-reroll');
    rr.hidden = left < 1;
    setText(rr, '다시 뽑기 · 이번 회차에 ' + left + '번 남음');
    $('perk').hidden = false;
  }

  /* ---------- 그리기 ---------- */
  function render() {
    renderNames();
    syncNative();
    var m = C.mods(state), per = C.incomePerSec(state);      // 순찰조가 벌어 오는 몫까지 더해서 보여 준다
    setText($('supplies'), fmt(state.supplies));
    setText($('pps'), '초당 +' + fmt(per) + (state.buff ? ' · 지원 ×' + state.buff.mult + ' (' + Math.ceil(state.buff.left) + '초)' : ''));
    setText($('antibodies'), fmt(state.antibodies));
    setText($('click-value'), '+' + fmt(C.clickValue(state)));
    setText($('day'), ('00' + state.day).slice(-3));
    var label = C.zoneLabel(state);
    setText($('base-no'), label);
    setText($('zone-name'), label);
    var lead = state.retreats ? '철수 ' + state.retreats + '번' : C.ZONES[state.zone].lead;      // 한 줄에 들어가게 둘 중 하나만 적는다
    setText($('zone-trait'), lead);
    setText($('m-zone-trait'), label + ' · ' + lead);
    var cells = $('route').children;
    for (var i = 0; i < cells.length; i++) { var cls = i < state.zone ? 'past' : i === state.zone ? 'here' : ''; if (cells[i].className !== cls) cells[i].className = cls; }
    renderJournal();

    // 다음 할 일
    guideNow = C.guide(state);
    // 끝 화면: 일지와 특전 창이 모두 닫힌 뒤에 띄운다(겹치지 않게)
    if (pendingEnding && $('ending').hidden && $('story').hidden && $('perk').hidden) {
      setText($('ending-text'), '끝까지 왔어요.\n노란 우비는 탑 꼭대기에 걸려 있어요.');
      setText($('ending-stats'), 'D+' + pendingEnding.day + ' · 철수 ' + pendingEnding.retreats + '번 · 켜 둔 시간 ' + duration(pendingEnding.seconds) + (pendingEnding.count > 1 ? ' · ' + pendingEnding.count + '번째 끝' : ''));
      setText($('ending-after'), '거점은 계속 돌아가요.\n철수하면 처음부터 다시, 더 강하게 시작할 수 있어요.');
      $('ending').hidden = false; sfx('goal');
      try { $('ending-ok').focus(); } catch (e) { /* 초점을 못 옮겨도 된다 */ }
    }
    // 끝까지 올린 줄은 색을 바꾼다(1.5.9): 값 자리에 '최대'가 적힌 줄
    Array.prototype.forEach.call(document.querySelectorAll('button.row'), function (b) {
      var c = b.querySelector('.row-cost'), full = !!c && c.textContent === '최대';
      if (b.__max !== full) { b.__max = full; b.classList.toggle('row-max', full); }
    });
    // 아래 탭의 붉은 점: 살 것이 있는데 다른 화면을 보느라 놓치지 않게 한다
    var feedCost = state.pet ? C.petFeedCost(state) : Infinity;
    var canFeed = isFinite(feedCost) && feedCost <= state.treats;
    var canTrait = state.antibodies > 0 && C.TRAITS.some(function (t) { return C.traitCost(state, t.id) <= state.antibodies; });
    var nz = C.nextZone(state), canOpen = !!nz && nz.ready && nz.enough && !(nz.wait > 0) && !(nz.soon && state.gate);
    $('mnav-exped').classList.toggle('dot', canFeed || canTrait);
    var canFill = fillReady(1) || fillReady(2) || fillReady(3) || fillReady(5) || fillReady(6);      // 주문·의뢰·화물, 그리고 3구역의 고장과 출하 트럭
    $('mnav-manage').classList.toggle('dot', canOpen || canFill);
    $('mnav-base').classList.toggle('dot', C.strikeReady(state) || C.counterReady(state));      // 상황: 선제 공격이나 반격을 쓸 수 있다
    $('pet-feed').classList.toggle('ready', canFeed);
    // 줄을 문장 끝에서 나눈다: 문장마다 한 줄, 진행 숫자(괄호)는 아랫줄. 좁은 화면에서 낱말 중간이나 문장 중간에서 꺾이지 않게 한다
    var guideText = goalLines(guideNow.text);
    ['', 'm-'].forEach(function (pre) { setText($(pre + 'goal'), guideText); $(pre + 'goal-go').hidden = !guideNow.view; });

    // 구조 신호
    $('signal').hidden = !(state.signalLeft > 0);
    setText($('signal-left'), Math.ceil(state.signalLeft) + '초');

    // 오늘 밤
    var strength = C.nightStrength(state), defense = C.defensePower(state), safe = defense >= strength, boss = C.isBossWave(C.currentWave(state));
    var ph = C.dayPhase(state), fighting = ph.phase === 'battle', scale = Math.max(strength, defense, 1);
    $('day-bar').style.width = Math.max(0, Math.min(100, (fighting ? ph.left / ph.total : 1 - ph.left / ph.total) * 100)).toFixed(1) + '%';
    $('night-timer-row').classList.toggle('battle', fighting);
    setText($('night-timer-label'), fighting ? (state.siege && !safe ? '농성 중 · 버티는 시간' : safe ? '방어 중 · 버티는 시간' : '방어 중 · 지금 보강해야 한다') : '무리 도착까지');
    setText($('night-timer'), clock(ph.left));
    setText($('horde-strength'), fmt(strength));
    setText($('defense-power'), fmt(defense));
    $('horde-bar').style.width = (strength / scale * 100).toFixed(1) + '%';
    $('defense-bar').style.width = (defense / scale * 100).toFixed(1) + '%';
    var pill = $('night-pill'), sieging = state.siege && !safe;
    setText(pill, safe ? '방어 가능' : sieging ? '농성 중' : '방벽 위험');
    pill.className = 'pill ' + (safe ? 'pill-safe' : sieging ? 'pill-siege' : 'pill-danger');
    var plan = safe ? null : C.defensePlan(state);
    // 변이체가 오는 밤은 제목 옆 딱지와 칸의 테두리로 알린다(글에 섞어 적으면 줄이 넘쳐 읽기 어려웠다)
    $('night-boss').hidden = !boss;
    $('night').classList.toggle('boss', boss);
    // 두 줄로 나눠 적는다: 윗줄은 오늘 밤의 결과, 아랫줄은 지금까지 막아낸 밤과 그 보너스
    setText($('night-hint'), safe ? '방어 성공 시 물자 +' + fmt(C.nightReward(state)) + (boss ? ' · 간식 +' + C.TREAT_BOSS + ((state.bossPerks || 0) < C.BOSS_PERKS_MAX ? ' · 특전 하나' : '') : '')
      : sieging ? '방어력이 모자라요. 방벽을 보강해 주세요.' : '방어력이 모자라요. 방어 실패 시 물자의 ' + Math.round(C.BREACH_LOSS * 100) + '%를 잃어요.');
    setText($('night-sub'), '방어 성공한 밤 ' + state.wavesCleared + '번 · 생산 +' + Math.round(state.wavesCleared * C.WAVE_BONUS * 100) + '%' + (state.defStreak > 0 ? '\n연속 방어 ' + state.defStreak + '번 · 전리품 ×' + C.defStreakMult(state).toFixed(1) + ' (최대 ×' + C.DEF_STREAK_MAX.toFixed(1) + ')' : ''));
    // 방어 여유 게이지, 선제 공격, 반격(1.5.3)
    var eased = C.easeOn(state);
    $('edge-bar').style.width = Math.round((state.edge || 0) * 100) + '%';
    setText($('edge-label'), eased ? '오늘 밤 무리 절반' : '방어 여유 ' + Math.floor((state.edge || 0) * 100) + '%');
    $('strike').hidden = !C.strikeReady(state); $('counter').hidden = !C.counterReady(state);
    setText($('strike'), '선제 공격 · 오늘 밤 무리 절반'); setText($('counter'), '반격 · 오늘 밤 무리 절반');
    var fb = $('fortify');
    fb.hidden = safe;
    if (plan) { fb.disabled = plan.cost > state.supplies; setText(fb, '필요한 만큼 보강 · 물자 ' + fmt(plan.cost)); }

    // 철수
    var gain = C.antibodiesOnRetreat(state), rb = $('retreat'), can = C.canRetreat(state);
    rb.disabled = !can;
    setText($('retreat-count'), state.retreats ? state.retreats + '번 철수함' : '');
    setText(rb, can ? '철수한다 · 항체 샘플 +' + fmt(gain) : '아직 철수할 수 없다');
    // 철수의 기준은 "이번 회차에 모은 물자"(쓴 것도 포함한 누적)다. 지금 가진 물자와 헷갈리지 않게 이름을 붙여 적는다
    setText($('retreat-hint'), can
      ? '이번 회차 누적 ' + fmt(state.runEarned) + ' · ' + (function (t) { return t + (C.hasBatchim(t) ? '을' : '를'); })(fmt(C.nextAntibodyAt(state))) + ' 넘기면 샘플 +' + fmt(gain + 1)
      : state.pendingPerks.length ? '아직 고르지 않은 특전이 있어요.' : '이번 회차 누적 ' + fmt(state.runEarned) + ' / ' + fmt(C.RETREAT_MIN));
    setText($('retreat-sub'), can ? '물자를 더 모으면 샘플이 늘어요.'
      : state.pendingPerks.length ? '' : '물자를 다 모으면 철수할 수 있어요.');
    // 막대: 철수 전에는 철수 문턱까지, 철수할 수 있게 된 뒤에는 다음 샘플까지
    $('retreat-bar').hidden = !!state.pendingPerks.length && !can;
    $('retreat-bar').firstChild.style.width = Math.min(100, state.runEarned / (can ? C.nextAntibodyAt(state) : C.RETREAT_MIN) * 100).toFixed(1) + '%';

    renderZone(m);
    if (!$('zmap').hidden) renderZoneMap();
    renderTraits();
    renderPerkChoice();
    if ($('record').getAttribute('data-rtab') === 'stats') renderStats();
    if ($('record').getAttribute('data-rtab') === 'dex') renderDex();
    if ($('record').getAttribute('data-rtab') === 'ach') renderAch();
  }

  /** 구역 화면: 고른 탭에 따라 목표, 거래 칸, 목록을 바꿔 보여 준다. */
  /** 그 구역에서 지금 채울 수 있는 것이 있는가: 2구역 단골 주문, 3구역 납품 의뢰, 4구역 표류 화물. */
  function fillReady(zi) {
    if (C.autoEvents(state, zi)) return false;      // 자동에 맡긴 구역은 점으로 부르지 않는다(1.5.9: 지금 있는 구역도. 자동이 몇 초 안에 처리하는데 그 사이 점이 깜박여서, 살 것도 없는데 자꾸 부르는 것처럼 보였다)
    if (zi === 1) return !!state.order && state.goods >= state.order.need;
    if (zi === 2) return (!!state.contract && state.contract.have >= state.contract.need) || !!state.jam || !!state.truck;      // 납품, 고장, 출하 트럭
    if (zi === 3) return (!!state.salvage && state.salvage.have >= state.salvage.need) || !!(state.zev && state.zev.rail);
    if (zi === 5) return !!(state.zev && state.zev.guard);
    if (zi === 6) return !!(state.zev && state.zev.tower);
    return false;
  }
  /** 구역 탭에 점을 찍을 일: 채울 것이 있거나, 지금 구역에서 다음 문을 열 수 있다. */
  /*
   * 살 것이 있어서 구역 탭에 점을 찍을 일(1.5.2). 지나온 구역도 부른다: 자동이 대신 해 주는 것은 사건이지 구매가 아니다.
   *   개조: 그 구역의 개조 가운데 지금 살 수 있는 것이 있다.
   *   건물: 늘 뭔가는 살 수 있으므로 "살 수 있다"로 부르면 점이 꺼지지 않는다. 지금 사면 2배 문턱을 넘길 수 있을 때만 부른다.
   */
  function reach(count, canBuy, list) { var next = C.nextMilestone(count, list); return next !== null && canBuy >= next - count; }
  function zoneBuyReady(zi) {
    if (zi > state.zone) return false;
    if (C.UPGRADES.some(function (u) { return u.zone === zi && C.upgradeCost(state, u.id) <= state.supplies; })) return true;
    if (zi === 0) return C.BUILDINGS.some(function (b) { return reach(state.buildings[b.id], C.maxBuildings(state, b.id)); });
    if (zi === 1) return reach(state.stalls, C.maxStalls(state));
    if (zi === 2) { var lv = C.lineInfo(state).levels; return C.MACHINES.some(function (d) { return reach(lv, C.maxMachines(state, d.id), C.LINE_MILESTONES); }); }
    if (zi === 3) return reach(state.trains, C.maxTrains(state), C.FLEET_MILESTONES);
    if (zi === 4) return reach(state.staff, C.maxStaff(state));
    if (zi === 5) return reach(state.posts, C.maxPosts(state));
    if (zi === 6) return reach(state.antennas, C.maxAntennas(state));
    return false;
  }
  function zoneTodo(zi) {
    if (fillReady(zi) || zoneBuyReady(zi)) return true;
    var nz = C.nextZone(state);
    return zi === state.zone && !!nz && nz.ready && nz.enough && !(nz.wait > 0);
  }
  function renderZone(m) {
    var zi = tab === 'wall' ? -1 : Number(tab.slice(1));
    Object.keys(rows.tabs).forEach(function (id) {
      var b = rows.tabs[id], n = id === 'wall' ? -1 : Number(id.slice(1));
      b.setAttribute('aria-pressed', String(id === tab));
      // 구역 탭은 번호만 보여 주고, 고른 탭만 "4구역"으로 넓게 편다: 일곱 구역이 다 열려도 한 줄에 여유 있게 들어간다.
      if (n >= 0) setText(b, id === tab ? (n + 1) + '구역' : String(n + 1));
      if (n > state.zone) b.setAttribute('data-locked', '1'); else b.removeAttribute('data-locked');
      b.hidden = n > state.zone + 1;      // 아직 먼 구역의 탭은 숨긴다: 초반에 탭이 여섯 개나 보이지 않게
      b.classList.toggle('avail', n >= 0 && n <= state.zone && id !== tab && zoneTodo(n));
      // 살 수 있는 개조가 있으면 노란 네모(1.5.2). 지나온 구역도 부른다: 자동에 맡긴 구역이라도 개조는 직접 사야 한다
      var zUp = id !== tab && (n < 0 || n <= state.zone) && C.UPGRADES.some(function (u) { return u.zone === n && C.upgradeCost(state, u.id) <= state.supplies; });
      b.classList.toggle('upready', zUp && !b.classList.contains('avail'));      // 그 구역에 지금 할 일이 있으면 점(1.2.4)
    });
    var open = zi >= 0 && zi <= state.zone, soon = zi >= 0 && C.ZONES[zi].kind === 'soon';
    setText($('tab-hint'), tab === 'wall' ? HINTS.wall : open ? HINTS[tab] : (zi + 1) + '구역 ' + C.ZONES[zi].name + ' · ' + (C.ZONES[zi].lead || '아직 닿지 못한 곳'));
    // 구역 화면은 한 번에 한 가지만 보인다: 운영(놀이 화면 + 주된 구매), 강화, 목표
    var play = pane === 'play', zoneTab = zi >= 0 && open;
    $('zone-panes').hidden = !zoneTab;
    Array.prototype.forEach.call($('zone-panes').children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.pane === pane)); });
    for (var uz = 0; uz < C.ZONES.length; uz++) $('ups-z' + uz).hidden = !(tab === 'z' + uz && open && pane === 'up');
    $('search').hidden = !(tab === 'z0' && play);
    $('rows-z0').hidden = !(tab === 'z0' && play);
    $('rows-z1').hidden = !(tab === 'z1' && open);
    $('rows-z2').hidden = !(tab === 'z2' && open);
    $('rows-z3').hidden = !(tab === 'z3' && open);
    $('rail').hidden = !(tab === 'z3' && open);
    $('rows-z4').hidden = !(tab === 'z4' && open);
    $('lab').hidden = !(tab === 'z4' && open);
    $('rows-z5').hidden = !(tab === 'z5' && open);
    $('guard').hidden = !(tab === 'z5' && open);
    $('rows-z6').hidden = !(tab === 'z6' && open);
    $('tower').hidden = !(tab === 'z6' && open);
    var aeZone = /^z\d$/.test(tab) ? Number(tab.slice(1)) : -1, aeShow = aeZone >= 1 && aeZone <= state.zone && C.autoOn(state, aeZone);
    $('auto-ev-row').hidden = !aeShow;
    if (aeShow) {
      $('auto-ev').checked = C.autoEvents(state, aeZone);
      setText($('auto-ev-text'), ['', '단골 주문 자동', '의뢰·고장·트럭 자동', '표류·특별 화물 자동', '밤샘 연구 자동', '순찰·행렬 자동', '방송·무전 자동'][aeZone] + ' · 효율 ' + Math.round(C.autoShare(state, aeZone) * 100) + '%');
    }
    $('rows-wall').hidden = tab !== 'wall';
    $('wall-now').hidden = tab !== 'wall';
    $('wall-extra').hidden = tab !== 'wall';
    $('trade').hidden = !(tab === 'z1' && open);
    $('line').hidden = !(tab === 'z2' && open);
    ['rows-z1', 'rows-z2', 'rows-z3', 'rows-z4', 'rows-z5', 'rows-z6', 'trade', 'line', 'rail', 'lab', 'guard', 'tower'].forEach(function (id) { if (!play) $(id).hidden = true; });
    $('pane-goals').hidden = !(zi >= 0) || (open && pane !== 'goal');
    $('qty').hidden = soon || (zi > state.zone) || (zoneTab && !play);
    // 강화나 목표에 볼 것이 생기면 전환 단추에 점을 찍는다
    if (zoneTab) {
      var upReady = C.UPGRADES.some(function (u) { return u.zone === zi && C.upgradeCost(state, u.id) <= state.supplies; });
      var nz = C.nextZone(state), goalReady = zi === state.zone && !!nz && nz.ready && nz.enough && !(nz.wait > 0) && !(nz.soon && state.gate);
      $('zone-panes').children[0].classList.toggle('avail', fillReady(zi) && pane !== 'play');      // 운영: 채울 수 있는 주문·의뢰·화물이 있다
      $('zone-panes').children[1].classList.toggle('avail', upReady && pane !== 'up');
      $('zone-panes').children[2].classList.toggle('avail', goalReady && pane !== 'goal');
    }

    // 목표와 다음 구역
    if (zi >= 0) {
      var gs = open ? C.goals(state, zi) : [], xs = open ? C.extGoals(state, zi) : [];
      rows.goals.forEach(function (r, i) {
        var g = gs[i];
        r.li.hidden = !g;
        if (!g) return;
        // 연장 목표: 원래 목표를 채운 자리에 더 큰 목표가 이어서 뜬다. 채우면 간식과 물자를 받는다
        var x = xs[i];
        if (x) {
          r.li.className = 'ext';
          setText(r.text, '◆ 연장 ' + x.tier + ' · ' + x.text);
          setText(r.num, x.unit === 'time' ? clock(x.value) + ' / ' + clock(x.need) : fmt(x.value) + ' / ' + fmt(x.need));
          r.bar.style.width = Math.min(100, x.value / x.need * 100).toFixed(1) + '%';
          return;
        }
        r.li.className = g.done ? 'done' : '';
        setText(r.text, (g.done ? '■ ' : '□ ') + g.text);
        // 시간으로 재는 목표(정속 가동 등)는 분:초로 보여 준다
        setText(r.num, g.done ? '달성' : g.unit === 'time' ? clock(g.value) + ' / ' + clock(g.need) : fmt(g.value) + ' / ' + fmt(g.need));
        r.bar.style.width = (g.done ? 100 : Math.min(100, g.value / g.need * 100)).toFixed(1) + '%';
      });
      var n = C.nextZone(state), ob = $('open-zone'), showOpen = !!n && (zi === state.zone || zi === n.index) && !(n.soon && state.gate);
      // 7구역: 다음 문은 없지만 정찰(송신 준비) 시간이 남았으면 같은 자리에 알려 준다(1.6.2)
      var lastWait = !n && zi === state.zone && !state.endedRun ? C.scoutLeft(state) : 0;
      ob.hidden = !showOpen && !(lastWait > 0);
      if (!showOpen && lastWait > 0) {
        ob.disabled = true;
        if (!ob.firstChild) { ob.appendChild(el('span', 'oz-main')); ob.appendChild(el('span', 'oz-sub num')); var ozl = el('span', 'oz-bar'); ozl.appendChild(el('i')); ob.appendChild(ozl); }
        setText(ob.children[0], '송신을 준비하고 있어요'); setText(ob.children[1], '남은 시간 ' + clock(lastWait));
        ob.children[2].firstChild.style.width = (100 - lastWait / C.scoutNeed(state.zone) * 100).toFixed(1) + '%';
      }
      if (showOpen) {
        ob.disabled = !n.ready || !n.enough || n.wait > 0;
        // 두 줄로 나눠 적는다: 윗줄은 할 일, 아랫줄은 모은 물자 / 필요한 물자(막대와 함께)
        if (!ob.firstChild) { ob.appendChild(el('span', 'oz-main')); ob.appendChild(el('span', 'oz-sub num')); var ozb = el('span', 'oz-bar'); ozb.appendChild(el('i')); ob.appendChild(ozb); }
        setText(ob.children[0], n.ready ? n.zone.no + '구역 ' + n.zone.name + '의 문을 연다' : (state.zone + 1) + '구역 목표를 모두 채우면 ' + n.zone.no + '구역이 열려요');
        // 문 값은 이번 회차 누적 물자로 잰다(1.4.0). 가진 물자는 줄지 않는다
        setText(ob.children[1], '이번 회차 누적 ' + fmt(Math.min(n.have, n.cost)) + ' / ' + fmt(n.cost) + (n.wait > 0 ? ' · 길 정찰 ' + clock(n.wait) : ''));
        if (n.ready && n.enough && n.wait > 0) setText(ob.children[0], n.zone.no + '구역 가는 길을 정찰하고 있어요');
        ob.children[2].firstChild.style.width = (n.cost > 0 ? Math.min(100, n.have / n.cost * 100) : 100).toFixed(1) + '%';
      }
      var soonText = !open && soon ? (state.gate ? C.ZONES[zi].name + '의 문 앞까지 왔어요. 이 구역은 다음 버전에서 열려요. 지금은 철수해서 항체 샘플을 모아 두면 돼요.' : '이 구역은 다음 버전에서 열려요. 지금은 문 앞까지 갈 수 있어요.')
        : !open ? '아직 열지 않은 구역이에요. 앞 구역의 목표를 모두 채우면 문을 열 수 있어요.' : '';
      $('soon').hidden = !soonText;
      setText($('soon'), soonText);
    } else $('soon').hidden = true;

    if (tab === 'z0' && play) {
      var nextIdx = C.nextTile(state), done = C.sweepCount(state);
      rows.tiles.forEach(function (b, i) {
        var searched = C.tileSearched(state, i), kind = C.tileKind(state.sweepSeed, i, C.cacheExtra(state));
        var cls = 'tile' + (searched ? ' done ' + kind.id : i === nextIdx ? ' next' : '') + (b.classList.contains('hit') ? ' hit' : '');
        if (b.className !== cls) b.className = cls;
        setText(b, searched ? kind.name : '');
        b.setAttribute('aria-label', searched ? kind.name + ' · 수색한 칸' : '아직 수색하지 않은 칸');
      });
      setText($('search-count'), done + ' / ' + C.SWEEP_TILES + '칸');
      var patrol = C.autoOn(state, 0), every = C.sweepInterval(state);
      var flashing = Date.now() < sweepFlashUntil;
      setText($('search-note'), flashing ? sweepFlashText : (state.sweeps + 1) + '번째 동네 · ' + (patrol ? secs(every) + '마다 한 칸' : '개조에서 순찰조를 사요'));
      $('search-note').classList.toggle('flash', flashing);
      fill($('search-bar'), patrol ? state.sweepClock / every : 0);            // 수색조가 다음 칸을 뒤질 때까지
      $('search-bar').hidden = !patrol;
      $('search').classList.toggle('auto', patrol);          // 순찰조가 돌면 지도를 작게 접는다(눌러서 뒤질 일이 줄어드니까)
      setText($('search-bonus'), '다 수색하면 물자 +' + fmt(C.sweepBonus(state)) + ' · 가게 ×1.25, 은닉처 ×2');
    }
    if (tab === 'z0' && play) {
      C.BUILDINGS.forEach(function (b) {
        var r = rows.buildings[b.id], n = state.buildings[b.id], q = qtyFor(C.maxBuildings(state, b.id), C.COUNT_MAX - n), cost = C.buildingCost(state, b.id, q);
        setText(r.count, n + ' / ' + C.COUNT_MAX);
        setMile(r, n, q, cost <= state.supplies);
        setText(r.info, (n ? '초당 ' + fmt(C.buildingRate(state, b.id)) : '하나에 초당 ' + fmt(b.baseRate * m.z1 * C.globalMult(state))) + (r.next ? ' · ' + r.next + '곳에서 2배' : ''));
        setText(r.cost, isFinite(cost) ? '×' + q + ' ' + fmt(cost) : '최대');
        r.btn.disabled = !(cost <= state.supplies); afford(r.cost, cost);
      });
    }
    if (tab === 'z1' && open) {
      var range = C.priceRange(state), cap = C.goodsCap(state), pr = $('price');
      setText(pr, '×' + state.price.toFixed(2));
      pr.className = 'trade-price num' + (state.price >= C.peakPrice(state) ? ' high' : state.price < range.mean * 0.8 ? ' low' : '');
      setText($('price-range'), '범위 ' + range.floor.toFixed(1) + ' ~ ' + range.ceil.toFixed(1) + ' · 평균 ' + range.mean.toFixed(2));
      setText($('price-next'), Math.ceil(C.PRICE_STEP - state.priceClock) + '초 뒤 시세가 바뀌어요');
      setText($('goods'), fmt(state.goods) + ' / ' + fmt(cap));
      $('goods-bar').style.width = (cap > 0 ? Math.min(100, state.goods / cap * 100) : 0).toFixed(1) + '%';
      // 시세판: 막대의 높이는 시세 범위 안에서의 위치(바닥 8% ~ 천장 100%). 맨 오른쪽이 지금 시세다.
      var span = Math.max(0.01, range.ceil - range.floor);
      var height = function (p) { return (8 + 92 * Math.max(0, Math.min(1, (p - range.floor) / span))).toFixed(1) + '%'; };
      var tone = function (p) { return p >= C.peakPrice(state) ? ' high' : p < range.mean ? ' low' : ''; };
      var hist = state.priceHistory, pad = C.PRICE_HISTORY - hist.length;
      rows.bars.forEach(function (b, i) {
        var now = i === C.PRICE_HISTORY, p = now ? state.price : hist[i - pad];
        var has = typeof p === 'number';
        b.style.height = has ? height(p) : '0';
        var cls = has ? (now ? 'now' : '') + tone(p) : '';
        if (b.className !== cls) b.className = cls;
      });
      $('board-mean').style.bottom = height(range.mean);
      $('board-peak').style.bottom = height(C.peakPrice(state));
      $('board-peak').hidden = C.peakPrice(state) > range.ceil;
      // 연속 호가
      rows.pips.forEach(function (p, i) { var c = i < state.streak ? 'on' : ''; if (p.className !== c) p.className = c; });
      var mult = C.streakMult(state);
      setText($('streak-note'), state.streak
        ? '연속 호가 ' + state.streak + ' · 판매 +' + Math.round((mult - 1) * 100) + '%' + (state.price < range.mean ? ' · 직접 팔면 끊겨요' : state.streakUsed ? '' : ' · 지금 팔면 올라요')
        : '평균 이상에서 팔리면 연속 호가가 쌓여요');
      var sb = $('sell'), worth = state.goods * state.price * C.goodsValue(state) * mult;
      sb.disabled = !(state.goods > 0);
      setText(sb, state.goods > 0 ? '지금 판다 · 물자 +' + fmt(worth) + (state.price >= C.peakPrice(state) ? ' · 고점' : '') : '팔 상품이 없다');
      $('auto-sell').checked = state.autoSell;
      // 자동 판매: 흥정꾼(개조)이 있어야 한다. 막대는 다음 자동 판매까지 — 시세가 평균 이상이면 창고의 1/4, 아니면 가득 찰 때까지
      var broker = C.autoOn(state, 1), selling = broker && state.autoSell, goodPrice = state.price >= (state.sellPeak ? C.peakPrice(state) : C.priceRange(state).mean);
      var sellEvery = C.sellInterval(state);
      $('auto-sell-row').hidden = !broker;
      $('sell-peak-row').hidden = !selling; $('sell-peak').checked = !!state.sellPeak;
      $('sell-bar').hidden = !selling;
      // 시세가 좋을 때는 다음 판매까지의 시간, 낮을 때는 창고가 찰 때까지(회색)
      fill($('sell-bar'), !selling ? 0 : goodPrice ? state.sellClock / sellEvery : (cap > 0 ? state.goods / cap : 0));
      $('sell-bar').classList.toggle('wait', !goodPrice);
      setText($('sell-auto'), !broker ? '개조에서 흥정꾼을 사면 알아서 팔아요.' : !state.autoSell ? '자동 판매가 꺼져 있어요.'
        : state.order ? '단골 주문에 넘길 상품을 모으는 중이에요' : goodPrice ? (state.sellPeak ? '고점이에요' : '시세가 좋아요') + ' · 흥정꾼이 ' + secs(sellEvery) + '마다 팔아요' : (state.sellPeak ? '고점을 기다려요' : '시세가 낮아 기다려요') + ' · 창고가 차면 팔아요');
      // 단골 주문: 왔을 때만 칸이 보인다. 상품이 모자라면 단추가 꺼지고 얼마나 모자란지 알려 준다
      var od = state.order, ob2 = $('order');
      ob2.hidden = !od;
      if (od) {
        var reg = null; C.REGULARS.forEach(function (r) { if (r.id === od.who) reg = r; });
        setText($('order-left'), clock(od.left));
        setText($('order-text'), (reg ? reg.name + (C.hasBatchim(reg.name) ? '이' : '가') : '단골이') + ' 상품 ' + fmt(od.need) + '개를 찾아요.\n팔면 물자 +' + fmt(C.orderReward(state)) + ' · 간식 +' + C.ORDER_TREATS);
        fill($('order-bar'), od.left / C.ORDER_SECONDS);
        var enough = state.goods >= od.need;
        $('order-fill').disabled = !enough;
        setText($('order-fill'), enough ? '단골에게 판다' : '상품이 ' + fmt(od.need - state.goods) + '개 모자라요');
      }
      setText($('order-note'), '단골 ' + C.regularCount(state) + ' / ' + C.REGULARS.length + ' · 이번 회차 주문 ' + state.ordersRun + '번 · 상품 값 +' + Math.round((C.orderMult(state) - 1) * 100) + '% (최대 ' + Math.round(C.ORDER_BONUS_MAX * 100) + '%)');
      var q2 = qtyFor(C.maxStalls(state), C.COUNT_MAX - state.stalls), sc = C.stallCost(state, q2);
      setText(rows.stall.count, state.stalls + ' / ' + C.COUNT_MAX);
      setMile(rows.stall, state.stalls, q2, sc <= state.supplies);
      setText(rows.stall.info, '초당 상품 ' + fmt(C.goodsRate(state)) + ' · 평균 초당 물자 ' + fmt(C.tradeRate(state)));
      setText(rows.stall.cost, isFinite(sc) ? '×' + q2 + ' ' + fmt(sc) : '최대');
      rows.stall.btn.disabled = !(sc <= state.supplies); afford(rows.stall.cost, sc);
      C.HANDS.forEach(function (d) {
        var r = rows.hands[d.id], n = state.hands[d.id], q = qtyFor(C.maxHands(state, d.id), d.max - n), cost = C.handCost(state, d.id, q);
        setText(r.count, n + ' / ' + d.max);
        setText(r.info, '현재 +' + Math.round((C.handBonus(state, d.id) - 1) * 100) + '%');
        setText(r.cost, isFinite(cost) ? '×' + q + ' ' + fmt(cost) : '최대');
        r.btn.disabled = !(cost <= state.supplies); afford(r.cost, cost);
      });
    }
    if (tab === 'z2' && open) {
      // 납품 의뢰: 왔을 때만 칸이 보인다. 의뢰가 온 뒤로 만든 완제품이 차고, 다 차면 납품할 수 있다
      var ct = state.contract, cb = $('contract');
      cb.hidden = !ct;
      if (ct) {
        var cl = null; C.CLIENTS.forEach(function (r) { if (r.id === ct.who) cl = r; });
        setText($('contract-left'), clock(ct.left));
        var cItem = null; C.RECIPES.forEach(function (r) { if (r.id === ct.item) cItem = r; });
        var cMatch = !cItem || cItem.id === C.recipeOf(state).id;
        setText($('contract-text'), (cl ? cl.name + (C.hasBatchim(cl.name) ? '이' : '가') : '거래처가') + ' ' + (cItem ? cItem.name : '완제품') + ' ' + fmt(ct.need) + '개를 찾아요.\n납품하면 물자 +' + fmt(C.contractReward(state)) + ' · 간식 +' + C.CONTRACT_TREATS);
        fill($('contract-bar'), ct.have / ct.need);
        var cdone = ct.have >= ct.need;
        $('contract-fill').disabled = !cdone;
        setText($('contract-fill'), cdone ? '납품한다' : !cMatch ? cItem.name + (C.hasBatchim(cItem.name) ? '을' : '를') + ' 만들어야 차요 · ' + fmt(Math.floor(ct.have)) + ' / ' + fmt(ct.need) : '만드는 중 · ' + fmt(Math.floor(ct.have)) + ' / ' + fmt(ct.need));
      }
      // 품목 단추: 지금 만드는 것은 채워서, 의뢰가 찾는 것은 점선 테두리로 보여 준다
      C.RECIPES.forEach(function (r) {
        var rb = rows.recipes[r.id];
        rb.classList.toggle('on', r.id === C.recipeOf(state).id);
        setText(rb.__small, '숙련 ' + Math.floor(C.mastery(state, r.id) * 100) + '%');
        rb.classList.toggle('want', !!ct && ct.item === r.id && r.id !== C.recipeOf(state).id);
        rb.setAttribute('aria-pressed', r.id === C.recipeOf(state).id ? 'true' : 'false');
      });
      // 기계 다시 맞추기: 가동률이 정속 기준 아래로 무너졌을 때만 보인다
      var rbLine = C.lineInfo(state), rb = $('rebalance');
      rb.hidden = !(rbLine.flow > 0 && !rbLine.steady) || state.retool > 0;
      if (!rb.hidden) { var rp = C.rebalancePlan(state); var rf = C.rebalanceRefund(state); setText(rb, '기계 다시 맞추기 · Lv ' + rp.sorter + ' / ' + rp.press + ' / ' + rp.assembler + '로' + (rf > 0 ? ' · 물자 +' + fmt(rf) : '')); }
      // 고장: 고치면 잠깐 라인이 빨라진다
      var jf = $('jam-fix'), jamName = '';
      C.MACHINES.forEach(function (d) { if (state.jam && state.jam.id === d.id) jamName = d.name; });
      jf.hidden = !state.jam;
      if (state.jam) setText(jf, jamName + (C.hasBatchim(jamName) ? '이' : '가') + ' 멈칫거려요 · 고친다 (' + C.TUNE_SECONDS + '초 동안 ×' + C.TUNE_MULT + ')');
      // 출하 트럭
      var tk = state.truck; $('truck').hidden = !tk;
      if (tk) {
        setText($('truck-left'), clock(tk.left));
        setText($('truck-text'), '출하장에 ' + Math.floor(state.stockSec) + '초분이 쌓였어요.\n실으면 물자 +' + fmt(C.truckReward(state, false)));
      }
      setText($('stock-note'), '출하장 ' + Math.floor(state.stockSec) + ' / ' + C.TRUCK_STOCK_MAX + '초분 · 이번 회차 출하 ' + state.trucksRun + '번 · 정비 ' + state.repairsRun + '번');
      setText($('contract-note'), '거래처 ' + C.clientCount(state) + ' / ' + C.CLIENTS.length + ' · 이번 회차 의뢰 ' + state.contractsRun + '번 · 완제품 값 +' + Math.round((C.contractMult(state) - 1) * 100) + '% (최대 ' + Math.round(C.CONTRACT_BONUS_MAX * 100) + '%)');
      var line = C.lineInfo(state), top = 0, names = {};
      C.MACHINES.forEach(function (d) { top = Math.max(top, line.caps[d.id]); names[d.id] = d.name; });
      C.MACHINES.forEach(function (d) {
        var c = rows.cells[d.id], r = rows.machines[d.id], lv = state.machines[d.id];
        setText(c.cap, '초당 ' + fmt(line.caps[d.id]));
        c.bar.style.width = (top > 0 ? line.caps[d.id] / top * 100 : 0).toFixed(1) + '%';
        c.cell.classList.toggle('slow', d.id === line.bottleneck);
        c.cell.classList.toggle('jam', !!state.jam && state.jam.id === d.id);      // 가장 느린 기계: 이것을 올려야 라인이 빨라진다
        var q = qtyFor(C.maxMachines(state, d.id), C.COUNT_MAX - lv), cost = C.machineCost(state, d.id, q);
        setText(r.count, 'Lv ' + lv + ' / ' + C.COUNT_MAX);      // 다른 시설처럼 최대 레벨을 함께 적는다(끝이 없는 것처럼 보였다)
        // 이 기계가 지금 초당 몇 개를 처리하는지와, 한 레벨에 얼마나 느는지(1.4.0). 전에는 "레벨당 초당 3"뿐이라 무슨 수인지 알기 어려웠다
        setText(r.info, '초당 ' + fmt(lv * C.machineRate(state, d.id)) + '개 처리 · 레벨당 +' + C.machineRate(state, d.id) + (d.id === line.bottleneck ? ' · 현재 병목' : ''));
        // 별: 기계 레벨 합계의 2배 문턱(세 기계가 함께 채운다). 이 기계를 사서 문턱을 넘으면 "지금 2배"가 뜬다
        setMile(r, line.levels, q, cost <= state.supplies, C.LINE_MILESTONES);
        setText(r.cost, isFinite(cost) ? '×' + q + ' ' + fmt(cost) : '최대');
        r.btn.disabled = !(cost <= state.supplies); afford(r.cost, cost);
      });
      var ld = $('line-load');
      setText(ld, '가동률 ' + Math.floor(line.load * 100 + 1e-6) + '% · 정속 ' + Math.round(line.steadyAt * 100) + '% 이상');
      ld.className = 'num' + (line.steady ? ' steady' : '');
      setText($('line-note'), state.retool > 0 ? '품목을 바꾸는 중 · ' + Math.ceil(state.retool) + '초' : line.flow > 0
        ? (C.masteredAll(state) ? '전 품목 숙련 ×' + C.MASTERY_ALL + ' · ' : C.mastery(state, C.recipeOf(state).id) < 1 ? '손에 익히는 중 ×' + C.recipeFactor(state, C.recipeOf(state).id).toFixed(2) + ' · ' : '') + (state.tuneLeft > 0 ? '정비 직후 ×' + C.TUNE_MULT + ' · ' + Math.ceil(state.tuneLeft) + '초 · ' : state.jam ? '고장으로 느려짐 · ' : '') + (line.steady ? '정속 가동 · 산출 +' + Math.round((line.bonus - 1) * 100) + '%' : '세 기계의 속도를 비슷하게 맞춰 가동률이 ' + Math.round(line.steadyAt * 100) + '%를 넘으면 정속 가동(산출 보너스)이 돼요') + ' · 초당 물자 ' + fmt(C.lineNow(state))
        : '기계 셋이 모두 있어야 라인이 돌아요');
      drawBelt(line);
      var sg = $('surge'), sOn = state.surgeLeft > 0;
      sg.disabled = sOn || state.surgeCool > 0 || !(line.flow > 0);
      sg.className = 'surge' + (sOn ? ' on' : '');
      setText(sg, sOn ? '투입 중 ' + Math.ceil(state.surgeLeft) + '초' : state.surgeCool > 0 ? '다음 투입 ' + clock(state.surgeCool) + (C.autoOn(state, 2) ? ' · 자동' : '') : '전력 투입 ×' + C.SURGE_MULT);
      // 진행 바: 투입 중에는 남은 시간이 줄어들고, 기다리는 동안은 다음 투입까지 차오른다(단추 바탕을 채운다)
      fill(sg, sOn ? state.surgeLeft / C.SURGE_SECONDS : state.surgeCool > 0 ? 1 - state.surgeCool / C.surgeCooldown(state) : 0);
      setText($('line-mile'), '기계 레벨 합계 ' + line.levels + ' · 배수 ×' + line.milestone + (line.nextMilestone ? ' · ' + line.nextMilestone + '에서 2배' : ''));
      var tb = $('tune'), tc = C.tuneCost(state);
      tb.disabled = !(tc <= state.supplies); afford(tb, tc);
      setText(tb, isFinite(tc) ? '병목 올리기 · ' + names[line.bottleneck] + ' · 물자 ' + fmt(tc) + (qtyMode === 1 ? '' : qtyMode === 'max' ? ' · 되는 만큼' : ' · ' + qtyMode + '번') : '기계가 모두 최대다');
    }
    if (tab === 'z3' && open) {
      renderZoneEvent('rail');
      // 표류 화물: 발견됐을 때만 칸이 보인다. 발견된 뒤로 열차가 싣고 온 화물 값이 차고, 다 차면 끌어올 수 있다
      var sv = state.salvage, sb2 = $('salvage');
      sb2.hidden = !sv;
      if (sv) {
        var cg = null; C.CARGOS.forEach(function (r) { if (r.id === sv.who) cg = r; });
        setText($('salvage-left'), clock(sv.left));
        setText($('salvage-text'), '선로에 멈춰 선 ' + (cg ? cg.name + (C.hasBatchim(cg.name) ? '을' : '를') : '화물칸을') + ' 찾았어요.\n끌어오면 물자 +' + fmt(C.salvageReward(state)) + ' · 간식 +' + C.SALVAGE_TREATS);
        fill($('salvage-bar'), sv.need > 0 ? sv.have / sv.need : 0);
        var sdone = sv.have >= sv.need;
        $('salvage-fill').disabled = !sdone;
        setText($('salvage-fill'), sdone ? '끌어온다' : '열차를 기다리는 중 · ' + Math.floor(sv.need > 0 ? sv.have / sv.need * 100 : 0) + '%');
      }
      setText($('salvage-note'), '화물 ' + C.cargoCount(state) + ' / ' + C.CARGOS.length + ' · 이번 회차 ' + state.salvagesRun + '번 · 화물 값 +' + Math.round((C.salvageMult(state) - 1) * 100) + '% (최대 ' + Math.round(C.SALVAGE_BONUS_MAX * 100) + '%)');
      var plan = C.railPlan(state), cargo = C.cargoValue(state);
      C.ROUTES.forEach(function (d) {
        var v = rows.railRows[d.id], r = rows.routes[d.id], lv = state.routes[d.id], trip = C.tripSeconds(state, d.id), on = plan.riders[d.id];
        v.row.classList.toggle('off', !lv);
        setText(v.small, clock(trip) + ' · 화물 ×' + d.mult);
        setText(v.side, !lv ? '끊김' : on ? on + ' / ' + plan.slots[d.id] + '대 · ' + clock(trip - state.routeClock[d.id]) : '0 / ' + plan.slots[d.id] + '대');
        v.bar.style.width = (lv && (on || state.routeLoad[d.id] > 0) ? Math.min(100, state.routeClock[d.id] / trip * 100) : 0).toFixed(1) + '%';
        var cost = C.routeCost(state, d.id);
        setText(r.count, lv ? lv + ' / ' + C.ROUTE_MAX + '단계' : '끊김');
        setText(r.info, (lv ? '열차 ' + plan.slots[d.id] + '대까지' : '복구하면 열차 ' + C.ROUTE_SLOTS + '대') + ' · ' + clock(trip) + ' · 화물 ×' + d.mult);
        setText(r.cost, isFinite(cost) ? (lv ? '증편 ' : '복구 ') + fmt(cost) : '최대');
        r.btn.disabled = !(cost <= state.supplies); afford(r.cost, cost);
      });
      drawRail(plan);
      var gb = $('green'), running = 0;
      C.ROUTES.forEach(function (d) { running += plan.riders[d.id]; });
      gb.disabled = state.greenCool > 0 || !running;
      setText(gb, state.greenCool > 0 ? '다음 청신호 ' + clock(state.greenCool) + (C.autoOn(state, 3) ? ' · 자동' : '') : running ? '청신호 · 열차들이 ' + C.GREEN_SECONDS + '초 앞서 달려요' : '청신호 · 달리는 열차가 없어요');
      fill(gb, state.greenCool > 0 ? 1 - state.greenCool / C.greenCooldown(state) : 0);
      setText($('rail-note'), !state.trains ? '열차가 없어요. 열차를 사고 노선을 복구하면 운행이 시작돼요.'
        : '열차 ' + state.trains + '대' + (plan.idle ? ' · 쉬는 열차 ' + plan.idle + '대(노선을 늘리면 달려요)' : '') + ' · 평균 초당 물자 ' + fmt(C.railRate(state)) + ' · 화물은 돌아올 때 들어와요');
      var tq = qtyFor(C.maxTrains(state), C.TRAIN_MAX - state.trains), tcost = C.trainCost(state, tq);
      setText(rows.train.count, state.trains + ' / ' + C.TRAIN_MAX);
      setMile(rows.train, state.trains, tq, tcost <= state.supplies, C.FLEET_MILESTONES);
      setText(rows.train.info, '대당 초당 화물 ' + fmt(cargo) + (plan.idle ? ' · 탈 노선이 없음' : ''));
      setText(rows.train.cost, isFinite(tcost) ? '×' + tq + ' ' + fmt(tcost) : '최대');
      rows.train.btn.disabled = !(tcost <= state.supplies); afford(rows.train.cost, tcost);
    }
    if (tab === 'z6' && open) {
      renderZoneEvent('tower'); renderPush('tower', '직접 방송');
      // 7구역: 모인 생존자와 전체 배수, 혈청, 안테나
      var sRate = C.survivorRate(state), stage = state.serumStage, sMax = C.SERUM_COSTS.length, sCost = C.serumCost(state);
      setText($('tower-people'), fmt(Math.floor(state.survivors)) + '명');
      setText($('tower-rate'), sRate > 0 ? '초당 +' + fmt(sRate) + '명' : '안테나를 세우면 사람이 모여요');
      setText($('tower-mult'), '모든 구역의 생산 ×' + C.towerMult(state).toFixed(2));
      setText($('serum'), stage >= sMax ? '혈청을 완성했다' : '혈청 ' + (stage + 1) + '단계 · 물자 ' + fmt(sCost));
      $('serum').disabled = stage >= sMax || !(sCost <= state.supplies);
      setText($('serum-note'), '혈청 ' + stage + ' / ' + sMax + '단계');
      var aq = qtyFor(C.maxAntennas(state), C.COUNT_MAX - state.antennas), acost = C.antennaCost(state, aq);
      setText(rows.antenna.count, state.antennas + ' / ' + C.COUNT_MAX);
      setMile(rows.antenna, state.antennas, aq, acost <= state.supplies);
      setText(rows.antenna.info, state.antennas ? '초당 ' + fmt(sRate) + '명' : '세우면 생존자가 모여요');
      setText(rows.antenna.cost, isFinite(acost) ? '×' + aq + ' ' + fmt(acost) : '최대');
      rows.antenna.btn.disabled = !(acost <= state.supplies); afford(rows.antenna.cost, acost);
    }
    if (tab === 'z5' && open) {
      renderZoneEvent('guard'); renderPush('guard', '순찰');
      // 6구역: 다리 안전도(방어력 ÷ 무리)와 초소
      var safety = C.bridgeSafety(state), safeMax = C.SAFETY_MAX + m.margin, gRate = C.guardRate(state);
      setText($('guard-safety'), '×' + safety.toFixed(2));
      setText($('guard-rate'), '통행 물자 초당 +' + fmt(gRate));
      $('guard-bar').style.width = Math.min(100, safety / safeMax * 100).toFixed(1) + '%';
      setText($('guard-note'), '방어력이 오늘 밤 무리의 몇 배인지예요. 최대 ×' + safeMax.toFixed(1) + '까지 쳐 줘요.\n무리의 ' + C.SAFE_NIGHT + '배 방어력으로 막은 밤 ' + state.safeNights + '번\n통행인 ' + C.passerCount(state) + ' / ' + C.PASSERS.length + ' · 이번 회차 ' + state.passersRun + '명 · 통행 물자 +' + Math.round((C.passerMult(state) - 1) * 100) + '% (최대 ' + Math.round(C.PASSER_BONUS_MAX * 100) + '%)');
      var pq = qtyFor(C.maxPosts(state), C.COUNT_MAX - state.posts), pcost = C.postCost(state, pq);
      setText(rows.post.count, state.posts + ' / ' + C.COUNT_MAX);
      setMile(rows.post, state.posts, pq, pcost <= state.supplies);
      setText(rows.post.info, state.posts ? '초당 ' + fmt(gRate) : '사면 통행 물자가 들어와요');
      setText(rows.post.cost, isFinite(pcost) ? '×' + pq + ' ' + fmt(pcost) : '최대');
      rows.post.btn.disabled = !(pcost <= state.supplies); afford(rows.post.cost, pcost);
    }
    if (tab === 'z4' && open) {
      var pc = C.projectCost(state), rc = C.rerollCost(state), rate = C.researchNow(state);
      setText($('lab-points'), fmt(state.points));
      setText($('lab-rate'), rate > 0 ? '초당 +' + fmt(rate) + (state.points < pc ? ' · 다음 과제까지 ' + clock((pc - state.points) / rate) : ' · 과제를 고를 수 있어요') : '연구원을 뽑으면 점수가 모여요');
      rows.offers.forEach(function (o, i) {
        var def = null, id = state.offers[i];
        C.PROJECTS.forEach(function (p) { if (p.id === id) def = p; });
        o.btn.hidden = !def;
        if (!def) return;
        var lv = state.research[def.id];
        setText(o.name, def.name + (lv ? ' · ' + lv + '번 끝냄' : ''));
        setText(o.desc, def.desc);
        setText(o.cost, '점수 ' + fmt(pc));
        o.btn.disabled = !(pc <= state.points);
      });
      // 밤샘 연구: 전력 투입·청신호와 같은 틀(누르면 잠깐 빨라지고, 쉬는 시간이 있다)
      var fb = $('lab-focus'), fOn = state.focusLeft > 0;
      fb.disabled = fOn || state.focusCool > 0 || !(C.researchRate(state) > 0);
      fb.className = 'surge' + (fOn ? ' on' : '');
      setText(fb, fOn ? '밤샘 연구 중 ' + Math.ceil(state.focusLeft) + '초' : state.focusCool > 0 ? '다음 밤샘 ' + clock(state.focusCool) : '밤샘 연구 ×' + C.FOCUS_MULT);
      fill(fb, fOn ? state.focusLeft / C.FOCUS_SECONDS : state.focusCool > 0 ? 1 - state.focusCool / C.FOCUS_COOL : 0);
      var rr = $('lab-reroll');
      rr.disabled = !(rc <= state.points) || !state.offers.length;
      setText(rr, '다른 과제 보기 · 점수 ' + fmt(rc));
      var doneList = C.PROJECTS.filter(function (p) { return state.research[p.id] > 0 && p.key !== 'drop'; }).map(function (p) { return p.name + ' ' + state.research[p.id]; });
      setText($('lab-record'), '서류 ' + C.recordCount(state) + ' / ' + C.RECORDS.length + ' · 이번 회차 ' + state.recordsRun + '장 · 연구 속도 +' + Math.round((C.recordMult(state) - 1) * 100) + '% (최대 ' + Math.round(C.RECORD_BONUS_MAX * 100) + '%)');
      setText($('lab-done'), '끝낸 과제 ' + state.projectsDone + '개' + (doneList.length ? ' · ' + doneList.join(', ') : '') + ' · 과제를 끝낼수록 다음 과제가 비싸져요');
      var sq = qtyFor(C.maxStaff(state), C.COUNT_MAX - state.staff), scost = C.staffCost(state, sq);
      setText(rows.staff.count, state.staff + ' / ' + C.COUNT_MAX);
      setMile(rows.staff, state.staff, sq, scost <= state.supplies);
      setText(rows.staff.info, '초당 점수 ' + fmt(rate) + ' · 약품 +' + fmt(C.labRate(state)));      // 1.5.9: 연구원은 약품(물자)도 만든다
      setText(rows.staff.cost, isFinite(scost) ? '×' + sq + ' ' + fmt(scost) : '최대');
      rows.staff.btn.disabled = !(scost <= state.supplies); afford(rows.staff.cost, scost);
    }
    if (tab === 'wall') {
      // 방벽을 사는 자리에서 바로 견줘 볼 수 있게: 지금 방어력과 오늘 밤 무리(1.5.1)
      var wDef = C.defensePower(state), wStr = C.nightStrength(state);
      setText($('wall-now'), '방어력 ' + fmt(wDef) + ' · 오늘 밤 무리 ' + fmt(wStr) + ' · ' + (wDef >= wStr ? '방어 가능' : '모자람 ' + fmt(wStr - wDef)));
      $('wall-now').classList.toggle('bad', wDef < wStr);
      C.DEFENSES.forEach(function (d) {
        var r = rows.defenses[d.id], q = qtyFor(C.maxDefenses(state, d.id), 1e6), cost = C.defenseCost(state, d.id, q);
        setText(r.count, String(state.defenses[d.id]));
        setText(r.info, '하나에 방어력 +' + fmt(d.power * m.defense));
        setText(r.cost, '×' + q + ' ' + fmt(cost));
        r.btn.disabled = !(cost <= state.supplies); afford(r.cost, cost);
        var adLeft = C.autoDefLeft(state, d.id);
        setText(rows.autoDef[d.id], d.name + ' · ' + (adLeft ? adLeft + '개 더' : '끔'));
        rows.autoDef[d.id].setAttribute('aria-pressed', adLeft ? 'true' : 'false');
      });
      var fixer = m.repair >= 1;
      $('auto-defs').hidden = !fixer;
      setText($('auto-def-note'), fixer ? '수리공이 ' + secs(C.repairInterval(state)) + '마다 하나씩 사요.\n눌러서 몇 개 더 살지 정해요.' : '개조에서 수리공을 사면 방어 수단을 알아서 사 줘요.');
    }
    C.UPGRADES.forEach(function (u) {
      if ((u.zone < 0 ? 'wall' : 'z' + u.zone) !== tab) return;
      var r = rows.upgrades[u.id], lv = state.upgrades[u.id], cost = C.upgradeCost(state, u.id);
      var softCap = C.upgradeSoftCap(state, u.id);
      setText(r.count, 'Lv ' + lv + ' / ' + u.max);
      // 순찰조: 지금 몇 초마다 뒤지는지와 사고 난 뒤의 초를 함께 보여 준다
      var infoText = '';
      if (u.id === 'patrol') {
        var probe = Object.create(state); probe.upgrades = Object.create(state.upgrades); probe.upgrades.patrol = lv + 1;
        var nowS = secs(C.sweepInterval(state)), nextS = secs(C.sweepInterval(probe));
        infoText = !lv ? '사면 ' + nextS + '마다 한 칸' : lv >= u.max ? '현재 ' + nowS + '마다 한 칸' : '현재 ' + nowS + ' → ' + nextS;
      }
      if (u.id === 'broker') {             // 흥정꾼: 몇 초마다 파는지(지금 → 산 뒤)
        var bp = Object.create(state); bp.upgrades = Object.create(state.upgrades); bp.upgrades.broker = lv + 1;
        var bNow = secs(C.sellInterval(state)), bNext = secs(C.sellInterval(bp));
        infoText = !lv ? '사면 ' + bNext + '마다 판매' : lv >= u.max ? '현재 ' + bNow + '마다 판매' : '현재 ' + bNow + ' → ' + bNext;
      }
      if (u.id === 'repair') infoText = !lv ? '사면 5초마다 하나' : '현재 ' + secs(C.repairInterval(state)) + '마다 하나';
      if (!infoText && lv > 0 && C.effectNow(u, lv)) infoText = '현재 ' + C.effectNow(u, lv);
      // 숙련 상한: 철수와 특성이 적으면 그 위로는 값이 크게 뛴다
      if (softCap < u.max && lv >= softCap && lv < u.max) infoText = (infoText ? infoText + ' · ' : '') + '숙련 상한 Lv ' + softCap + ' · 넘기면 값이 ' + C.CAP_OVER + '배씩';      // 지금까지 쌓인 효과(1.3.0). 설명 줄은 레벨당 오르는 양이다
      setText(r.info, infoText);
      setText(r.cost, isFinite(cost) ? fmt(cost) : lv >= u.max ? '최대' : '잠김');
      r.btn.disabled = !(cost <= state.supplies); afford(r.cost, cost);
      r.btn.classList.toggle('row-owned', lv >= u.max);
    });
  }

  /** 일행 칸: 주인공 이름, 지금 데리고 다니는 친구, 함께 있는 친구들(누르면 바꾼다), 데려오기 단추와 값. */
  function renderPet() {
    var p = C.petInfo(state), cost = C.petPullCost(state), have = C.kennelCount(state);
    $('pet-empty').hidden = !!p; $('pet-card').hidden = !p;
    $('hero-input').placeholder = state.heroName;
    document.querySelectorAll('[data-gender]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-gender') === state.heroGender ? 'true' : 'false'); });
    setText($('pet-kind'), (p ? '친구 ' + have + ' / ' + C.PET_BREEDS.length : '아직 친구가 없어요') + ' · 간식 ' + fmt(state.treats));
    ['dog', 'cat'].forEach(function (kind) {
      var b = $('adopt-' + kind), k = C.PET_KINDS[kind];
      setText(b.firstChild, k.name + (have ? ' 데려오기' : ' 맞이하기'));
      setText(b.lastChild, cost ? '항체 샘플 ' + fmt(cost) : '첫 친구는 그냥 와요');
      b.disabled = cost > state.antibodies;
    });
    setText($('pet-odds'), C.PET_RARITIES.map(function (r) { return r.name + ' ' + r.weight + '%'; }).join(' · ') + ' · 겹치면 절반 환불');
    if (!p) return;
    setText($('pet-name'), p.name);
    var plv = C.petLevel(state, p.breed.id), feed = C.petFeedCost(state);
    setText($('pet-desc'), p.rarity.name + ' · ' + p.breed.name + ' · Lv ' + plv + ' / ' + C.PET_LEVEL_MAX + ' · ' + C.petEffectText(state));
    setText($('pet-feed'), isFinite(feed) ? '간식 주기 · 간식 ' + fmt(feed) : '다 컸어요(최대 레벨)');
    $('pet-feed').disabled = !(feed <= state.treats);
    $('pet-input').placeholder = p.name;
    var face = $('pet-face');
    face.className = 'pet-face ' + p.rarity.id;
    face.style.background = 'linear-gradient(135deg, ' + p.breed.body + ' 0 62%, ' + p.breed.patch + ' 62%)';      // 몸 색과 무늬 색
    // 함께 있는 친구들: 목록이 바뀌었을 때만 다시 만든다(매 프레임 만들면 누르는 도중에 단추가 사라진다)
    var key = C.PET_BREEDS.filter(function (b) { return state.kennel[b.id]; }).map(function (b) { return b.id + ':' + state.kennel[b.id]; }).join('|') + '>' + state.pet.breed;
    var box = $('kennel');
    if (box.getAttribute('data-key') === key) return;
    box.setAttribute('data-key', key);
    while (box.firstChild) box.removeChild(box.firstChild);
    if (have < 2) return;
    C.PET_BREEDS.forEach(function (b) {
      if (!state.kennel[b.id]) return;
      var btn = el('button', b.rarity), dot = el('i');
      btn.type = 'button'; btn.id = 'kennel-' + b.id;
      dot.style.background = 'linear-gradient(135deg, ' + b.body + ' 0 62%, ' + b.patch + ' 62%)';
      btn.appendChild(dot); btn.appendChild(document.createTextNode(state.kennel[b.id]));
      btn.title = C.breedDesc(b);
      btn.setAttribute('aria-pressed', String(b.id === state.pet.breed));
      btn.addEventListener('click', function () { if (C.choosePet(state, b.id).ok) { sfx('click'); Store.save(); render(); } });
      box.appendChild(btn);
    });
  }
  function renderTraits() {
    renderPet();
    setText($('trait-points'), '남은 항체 샘플 ' + fmt(state.antibodies) + ' · 사용 ' + fmt(C.traitsSpent(state)));
    C.TRAITS.forEach(function (t) {
      var r = rows.traits[t.id], lv = state.traits[t.id], cost = C.traitCost(state, t.id);
      setText(r.count, 'Lv ' + lv + ' / ' + t.max);
      // 자동화: 전력 투입 대기 시간이 지금 몇 초이고 찍으면 몇 초가 되는지 보여 준다(청신호도 같은 비율로 줄어든다)
      var tInfo = '';
      if (t.id === 'auto') {
        var lvNow = state.traits.auto || 0, tp = Object.create(state); tp.traits = Object.create(state.traits); tp.traits.auto = lvNow + 1;
        var cNow = secs(C.surgeCooldown(state)), cNext = secs(C.surgeCooldown(tp)), gNow = secs(C.greenCooldown(state)), gNext = secs(C.greenCooldown(tp));
        tInfo = lvNow >= t.max ? '전력 투입 ' + cNow + ' · 청신호 ' + gNow : '전력 투입 ' + cNow + ' → ' + cNext + ' · 청신호 ' + gNow + ' → ' + gNext;
      }
      if (!tInfo && lv > 0) tInfo = C.effectNow(t, lv) ? '현재 ' + C.effectNow(t, lv) : t.id === 'pioneer' ? '현재 시작 물자 ' + fmt(100 * Math.pow(10, lv)) : t.id === 'reroll' ? '현재 한 회차에 ' + lv + '번' : '';
      setText(r.info, tInfo);
      setText(r.cost, isFinite(cost) ? '샘플 ' + fmt(cost) : '최대');
      r.btn.disabled = !(cost <= state.antibodies);
      r.btn.classList.toggle('row-owned', lv >= t.max);
    });
    $('trait-reset').disabled = C.traitsSpent(state) === 0;
    renderChallenges();
    var owned = C.PERKS.filter(function (p) { return state.perks[p.id] > 0; }), total = 0;
    owned.forEach(function (p) { total += state.perks[p.id]; });
    setText($('perk-count'), total + '장');
    var key = owned.map(function (p) { return p.id + state.perks[p.id]; }).join('|') || 'none', list = $('perks');
    if (list.getAttribute('data-key') === key) return;
    list.setAttribute('data-key', key);
    list.textContent = '';
    if (!owned.length) list.appendChild(el('li', 'hint', '아직 고른 특전이 없다.'));
    owned.forEach(function (p) {
      var li = el('li');
      li.appendChild(el('span', '', p.name + ' Lv ' + state.perks[p.id]));
      li.appendChild(el('span', 'num', C.effectNow(p, state.perks[p.id]) || p.desc));      // 지금 쌓인 효과를 적는다(전에는 레벨당 수치만 있었다)
      list.appendChild(li);
    });
  }

  /** 일지 목록과 '최근 일지' 한 줄. 열린 일지가 바뀔 때만 다시 그린다. */
  /**
   * 일지: 구역(장)마다 탭이 하나씩 있고, 고른 장의 글을 편 순서대로 보여 준다.
   * 아직 열리지 않은 편은 자리만 보이고(몇 편이 남았는지 알 수 있게), 아직 가지 못한 구역의 장은 누를 수 없다.
   */
  var journalTab = 0;        // 보고 있는 장(구역 번호). 0 이면 가장 최근에 글이 적힌 장을 고른다
  function renderJournal() {
    var read = C.BEATS.filter(function (b) { return state.story[b.id]; });
    var chapters = [], byZone = {};
    C.BEATS.forEach(function (b) { if (!byZone[b.zone]) { byZone[b.zone] = []; chapters.push(b.zone); } byZone[b.zone].push(b); });
    // 처음에는 글이 적힌 장 가운데 가장 뒤의 장을 연다(철수 글은 1장에 있으므로 '마지막에 적힌 글'로 고르면 1장이 열린다)
    if (!journalTab || !byZone[journalTab]) { journalTab = chapters[0]; read.forEach(function (b) { if (b.zone > journalTab) journalTab = b.zone; }); }
    var key = read.map(function (b) { return b.id; }).join(',') + '|' + journalTab + '|' + state.heroName + '|' + state.heroGender;
    if (key === journalShown) return;
    journalShown = key;
    var tabs = $('journal-tabs'), list = $('journal'), latest = read.length ? read[read.length - 1] : null;
    tabs.textContent = ''; list.textContent = '';
    chapters.forEach(function (zone) {
      var got = byZone[zone].filter(function (b) { return state.story[b.id]; }).length;
      var btn = el('button', '', zone + '장 ' + byZone[zone][0].zoneName + ' ' + got + '/' + byZone[zone].length);
      btn.type = 'button'; btn.disabled = !got; btn.setAttribute('aria-pressed', zone === journalTab ? 'true' : 'false');
      btn.addEventListener('click', function () { journalTab = zone; renderJournal(); });
      tabs.appendChild(btn);
    });
    byZone[journalTab].forEach(function (b, k) {
      var li = el('li');
      if (!state.story[b.id]) {
        li.className = 'locked';
        li.appendChild(el('span', 'j-no', (k + 1) + '편'));
        li.appendChild(el('span', 'j-title', '아직 적지 않았어요. 이 구역의 목표를 채우면 이어져요.'));
      } else {
        li.appendChild(el('span', 'j-no', b.zone + '장 ' + (k + 1) + '편'));
        li.appendChild(el('span', 'j-title', b.title));
        C.fillStory(b.text, state.heroName, state.heroGender).split('\n\n').forEach(function (para) { li.appendChild(el('p', '', para)); });      // 이름 자리에 지금의 주인공 이름을 넣는다
      }
      list.appendChild(li);
    });
    setText($('journal-count'), read.length + ' / ' + C.BEATS.length + '편');
  }

  /** 도트 화면에 넘길 값. 장면은 예전 구조의 이름(시설 열 종, 연구, 장비)을 쓰므로 지금 상태를 거기에 맞춰 옮긴다. */
  function sceneView() {
    var b = { scouts: state.buildings.scouts, garden: state.buildings.garden, purifier: state.buildings.purifier, workshop: state.buildings.workshop,
      port: state.stalls, district: state.zone >= 1 ? state.stalls : 0 };   // 좌판은 하역장·자치구 방으로 보인다
    return { t: state.dayClock / C.DAY_SECONDS, battle: C.dayPhase(state).phase === 'battle', day: state.day, zone: state.zone,
      safe: C.defensePower(state) >= C.nightStrength(state), boss: C.isBossWave(C.currentWave(state)), def: state.defenses, buildings: b,
      expedition: null, buff: !!state.buff, signal: state.signalLeft > 0, horde: state.zone >= 1 ? 'swarm' : 'walker', special: C.nightSpecials(state, state.day),
      research: { maps: state.upgrades.maps > 0, ration: state.upgrades.stock > 0, shift: state.upgrades.shifts > 0 },
      upgrades: { crowbar: state.upgrades.crowbar > 0, backpack: state.upgrades.cart > 0 }, gear: {},
      still: prefs.shake === 'off',
      pet: (function () { var p = C.petInfo(state); return p ? { kind: p.kind, body: p.breed.body, patch: p.breed.patch } : null; })() };
  }

  /* ---------- 일어난 일 알리기 ---------- */
  function handleEvents(events) {
    // 업적이 한꺼번에 여럿 달성되면(초기화 뒤 다시 채워질 때 등) 알림을 하나로 묶는다
    var achN = events.filter(function (ev) { return ev.type === 'achievement'; }).length, achMany = achN > 3;
    if (achMany) { toast('업적 ' + achN + '개 달성'); log('업적 ' + achN + '개를 달성했다.', 'good'); sfx('goal'); }
    events.forEach(function (ev) {
      if (ev.found) ev.found.forEach(function (f) {      // 도감에 새로 적힌 좀비
        toast('도감 · 새 좀비 〈' + f.name + '〉'); log('처음 보는 것이 무리에 섞여 있었다. 〈' + f.name + '〉 ' + C.ZOMBIE_RARITIES[f.rarity] + '.', 'story');
        if (f.rarity === 'rare' || f.rarity === 'epic') sfx('goal');
      });
      switch (ev.type) {
        case 'defended':
          heldLogged = false;
          // 무전 로그에는 굵직한 일만 남긴다: 변이체를 막은 밤과 10번째마다의 밤
          if (ev.boss || ev.wave % 10 === 0) log((ev.boss ? '변이체가 이끈 무리를 막아냈다. ' : ev.wave + '번째 밤을 막아냈다. ') + '물자 ' + fmt(ev.reward) + ' 확보.', 'good');
          if (ev.passer) {      // 6구역: 넉넉하게 막은 밤에 누가 다리를 건넜다
            toast((ev.passer.first ? '6구역 새 통행인 · ' : '6구역 통행인 · ') + ev.passer.name);
            log(ev.passer.name + (C.hasBatchim(ev.passer.name) ? '이' : '가') + ' 다리를 건넜다.' + (ev.passer.first ? ' 도감에 적었다.' : ''), 'good');
          }
          if (ev.edgeFull) { toast('선제 공격을 할 수 있어요'); log('방어 여유가 가득 찼다. 선제 공격을 할 수 있다.', 'good'); }
          sfx('defended'); buzz(20); if (scene) scene.night(true);
          break;
        case 'breached':
          log('방벽이 뚫렸다. 문을 걸어 잠그고 버틴다.', 'bad');
          sfx('breached'); buzz([40, 60, 40]); flash(); if (scene) scene.night(false);
          break;
        case 'held':
          if (!heldLogged) { heldLogged = true; log('무리가 문을 두드리다 물러갔다. 방벽을 보강하기 전까지는 버티기만 한다.', 'bad'); }
          if (ev.counterReady) { toast('반격할 수 있어요'); log('버틴 만큼 되갚을 때다. 반격할 수 있다.', 'good'); }
          if (scene) scene.night('held');
          break;
        case 'arrive':
          if (!ev.siege && ev.defense < ev.strength) { log('무리가 도착했다. ' + C.BATTLE_SECONDS + '초 안에 방벽을 보강하지 않으면 뚫린다.', 'bad'); sfx('dusk'); }
          break;
        case 'challenge-done':
          log('도전 〈' + ev.name + '〉 성공. ' + (ev.first ? '훈장을 받았다. ' + (C.CHALLENGES.filter(function (d) { return d.id === ev.id; })[0] || { perk: { text: '' } }).perk.text + '. ' : '') + '간식 ' + ev.treats + '개.', 'good');
          toast('도전 성공 · ' + ev.name + (ev.first ? ' · 훈장' : '') + ' · 간식 +' + ev.treats); sfx('goal');
          if (fxShow) fxShow('도전 성공', ev.name + (ev.first ? ' · 훈장' : ''), 1, -1, -1);
          break;
        case 'challenge-failed':
          log('도전 〈' + ev.name + '〉 실패. ' + (ev.why === 'time' ? '시간이 다 됐다.' : '조건을 지키지 못했다.') + ' 회차는 그대로 이어진다.', 'bad');
          toast('도전 실패 · ' + ev.name); sfx('breached');
          if (fxShow) fxShow('도전 실패', ev.name, -1, -1, -1);
          break;
        case 'goal-ext':
          log((ev.zone + 1) + '구역 연장 목표 달성: ' + ev.text + '. 물자 ' + fmt(ev.gain) + ', 간식 ' + ev.treats + '개.', 'good');
          toast('연장 목표 · ' + ev.text + ' · 간식 +' + ev.treats); sfx('upgrade');
          break;
        case 'goal':
          log((ev.zone + 1) + '구역 목표 달성: ' + ev.text + '. 특전을 하나 고른다.', 'good');
          toast('목표 달성 · ' + ev.text); sfx('goal');
          break;
        case 'surge': if (tab === 'z2' && pane === 'play') sfx('surge'); break;      // 알아서 들어간 전력: 3구역을 보고 있을 때만 소리를 낸다
        case 'train':
          railFlash[ev.route] = Date.now();
          if (ev.long) { toast('4구역 ' + ev.name + ' 도착 · 물자 +' + fmt(ev.gain)); sfx('defended'); }
          else if (tab === 'z3' && pane === 'play') sfx('buy');        // 짧은 노선은 자주 오므로 4구역을 보고 있을 때만 소리를 낸다
          break;
        case 'ending':
          pendingEnding = ev;      // 일지 창과 특전 창이 닫힌 뒤에 끝 화면을 띄운다(render 가 본다)
          log('혈청을 완성했다. 7구역에 닿았다.', 'story');
          break;
        case 'salvage':
          toast('4구역 표류 화물 · ' + ev.name); log('선로에서 ' + ev.name + (C.hasBatchim(ev.name) ? '을' : '를') + ' 찾았다.', ''); sfx('signal');
          break;
        case 'salvage-gone':
          log('표류 화물을 놓쳤다.', '');
          break;
        case 'contract':
          toast('3구역 납품 의뢰 · ' + ev.name + ' · ' + (ev.itemName || '완제품')); log(ev.name + (C.hasBatchim(ev.name) ? '이' : '가') + ' ' + (ev.itemName || '완제품') + ' ' + fmt(ev.need) + '개를 찾는다.', ''); sfx('signal');
          break;
        case 'contract-gone':
          log('거래처가 기다리다 돌아갔다.', '');
          break;
        case 'order':
          toast('2구역 단골 주문 · ' + ev.name); log(ev.name + (C.hasBatchim(ev.name) ? '이' : '가') + ' 상품 ' + fmt(ev.need) + '개를 찾는다.', ''); sfx('signal');
          break;
        case 'order-filled':      // 흥정꾼·자동 제어반·자동 신호가 알아서 넘긴 것(1.3.1)
        case 'contract-filled':
        case 'salvage-filled':
          if (ev.first) { toast('새로 적었다 · ' + ev.name); log(ev.name + '. 도감에 적었다.', 'good'); }
          else log(ev.name + (ev.type === 'order-filled' ? '에게 흥정꾼이 상품을 팔았다.' : ev.type === 'contract-filled' ? '에 알아서 납품했다.' : (C.hasBatchim(ev.name) ? '을' : '를') + ' 알아서 거뒀다.') + ' 물자 ' + fmt(ev.gain) + ' 확보.', 'good');
          break;
        case 'mastered':
          toast(ev.all ? '세 품목을 모두 익혔다' : ev.name + ' 숙련'); log(ev.name + (C.hasBatchim(ev.name) ? '이' : '가') + ' 손에 익었다.' + (ev.all ? ' 세 품목을 모두 익혀 라인이 더 빨리 돈다.' : ''), 'good'); sfx('goal');
          break;
        case 'zev':
          toast(({ rail: '4구역 ', guard: '6구역 ', tower: '7구역 ' }[ev.id] || '') + ev.name + (C.hasBatchim(ev.name) ? '이' : '가') + ' 왔어요'); log(ZEV_TEXT[ev.id].lead.replace('왔어요.', '왔다.').replace('섰어요.', '섰다.').replace('들어왔어요.', '들어왔다.'), ''); sfx('signal');
          break;
        case 'zev-auto':
          log(ev.id === 'rail' ? '자동 신호가 특별 화물을 실어 보냈다. 물자 ' + fmt(ev.gain) + ' 확보.' : ev.id === 'guard' ? '초소장이 행렬을 통과시켰다. 물자 ' + fmt(ev.gain) + ' 확보.' : '송신 기사가 무전에 응답했다. 생존자 ' + fmt(ev.people) + '명이 왔다.', 'good');
          break;
        case 'zev-gone':
          break;
        case 'boss-perk':
          log('변이체를 막은 몫으로 특전 하나를 고른다.', 'good');
          break;
        case 'jam':
          toast('3구역 고장 · ' + ev.name); log(ev.name + (C.hasBatchim(ev.name) ? '이' : '가') + ' 멈칫거린다. 고치면 라인이 빨라진다.', ''); sfx('signal');
          break;
        case 'jam-fixed':
          log(ev.auto ? '자동 제어반이 기계를 다시 돌렸다.' : '기계가 저절로 다시 돈다.', '');
          break;
        case 'truck':
          toast('3구역 출하 트럭이 왔어요'); log('출하 트럭이 왔다. 출하장에 ' + Math.floor(ev.seconds) + '초분이 쌓여 있다.', ''); sfx('signal');
          break;
        case 'truck-loaded':
          log('자동 제어반이 트럭에 실어 보냈다. 물자 ' + fmt(ev.gain) + ' 확보.', 'good');
          break;
        case 'truck-gone':
          log('트럭이 빈 채로 돌아갔다. 쌓인 것은 그대로다.', '');
          break;
        case 'order-gone':
          log('단골이 기다리다 돌아갔다.', '');
          break;
        case 'achievement':
          if (achMany) break;
          toast('업적 달성 · ' + ev.name); log('업적을 달성했다. 〈' + ev.name + '〉 ' + ev.text + '.', 'good'); sfx('goal'); buzz(25);
          break;
        case 'story':
          log('일지에 새 글을 적었다. 〈' + ev.title + '〉', 'story');
          journalTab = ev.zone;                                 // 일지를 열면 방금 적힌 장이 보인다
          if (prefs.storyPop !== 'off') Story.push(ev.zone + '구역 ' + ev.zoneName + ' · 생존 일지', ev.text, ev.title);
          else notice('일지에 새 글이 적혔어요. 기록 > 일지에서 읽을 수 있어요.');
          break;
      }
    });
  }
  /** 자리를 비운 동안 벌어진 일을 한 번에 알린다. */
  /*
   * 돌아왔을 때의 정산 화면: 게임을 켜 둔 채 다른 앱에 다녀오면 시작 화면이 다시 나오지 않으므로,
   * 자리 비움 보상을 띄우기 전에 짧은 로딩 화면(우비 소년과 좀비의 추격)을 먼저 보여 준다.
   *   길이는 비운 시간에 비례한다: 1.2초 ~ 3.2초(최대치인 4시간을 비웠을 때). done 은 끝난 뒤 부를 함수.
   *   화면을 만들지 못하면(요소 없음 등) 바로 done 을 부른다.
   */
  var BACK_MIN_MS = 1200, BACK_SPAN_MS = 2000;
  function backSplash(elapsed, done) {
    var box = $('back');
    if (!box || !box.hidden) { done(); return; }
    var ms = BACK_MIN_MS + BACK_SPAN_MS * Math.max(0, Math.min(1, elapsed / C.OFFLINE_CAP));
    setText($('back-text'), duration(Math.min(elapsed, C.OFFLINE_CAP)) + ' 동안의 일을 정산하는 중…');
    var bar = $('back-bar');
    bar.style.transition = 'none'; bar.style.width = '0'; void bar.offsetWidth;
    bar.style.transition = 'width ' + ms + 'ms linear'; bar.style.width = '100%';
    box.hidden = false;
    setTimeout(function () { box.hidden = true; try { done(); } catch (e) { console.error(e); } }, ms);
  }
  function reportAway(r, splash) {
    var first = !r.logged; r.logged = true;      // 정산 화면을 거쳐 두 번째로 불릴 때는 로그를 또 남기지 않는다
    if (first && r.nights > 0) log('자리를 비운 동안 밤 ' + r.nights + '번을 막아냈다. 물자 ' + fmt(r.nightReward) + ' 확보.', 'good');
    if (first && r.held) log('막을 수 없는 무리가 와서 문을 걸어 잠그고 버텼다. 방벽을 보강해야 한다.', 'bad');
    if (r.elapsed < AWAY_THRESHOLD || !(r.gain > 0)) return;
    // 돌아왔을 때의 보상 창: 쌓인 물자를 크게 보여 준다. 물자는 이미 들어와 있고, "받기"는 창을 닫을 뿐이다.
    if (splash) { backSplash(r.elapsed, function () { reportAway(r, false); }); return; }
    var total = r.gain + (r.nightReward || 0), lines = [];
    setText($('away-gain'), '+' + fmt(total));
    setText($('away-text'), (r.capped ? '오래 비웠어요. 최대치인 ' + duration(r.counted) + '치만 계산했어요' : duration(r.elapsed) + ' 동안 거점이 돌아갔어요') + ' · 효율 ' + Math.round(r.rate * 100) + '%');
    if (r.nights > 0) lines.push('방어 성공한 밤 ' + r.nights + '번 · 전리품 ' + fmt(r.nightReward));
    if (r.trains > 0) lines.push('돌아온 열차 ' + r.trains + '편');
    if (r.points > 0) lines.push('연구 점수 +' + fmt(r.points));
    if (r.held) lines.push('막을 수 없는 밤이 와서 버티는 중이에요');
    var list = $('away-list');
    while (list.firstChild) list.removeChild(list.firstChild);
    lines.forEach(function (t) { list.appendChild(el('li', '', t)); });
    $('away').hidden = false;
    try { $('away-ok').focus(); } catch (e) { /* 초점을 못 옮겨도 닫을 수 있다 */ }
  }
  /** '바로 가기': 안내가 가리키는 화면을 연다. */
  function goTo(view) {
    var target = view === 'trait' ? 'exped' : 'manage';
    if (view === 'zone') { tab = 'z' + state.zone; pane = C.goals(state, state.zone).some(function (g) { return !g.done; }) && state.buildings.scouts > 0 ? 'goal' : 'play'; }
    if (view === 'wall') tab = 'wall';
    var nav = document.querySelector('[data-mview-set="' + target + '"]');
    if (nav) nav.click();
    render();
    var box = document.querySelector('[data-view="' + target + '"]');
    try { if (box) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* 오래된 브라우저: 화면만 바뀐다 */ }
  }

  function flash() {
    if (prefs.shake === 'off') return;                 // 설정에서 화면 흔들림을 껐다
    var p = $('night');
    p.classList.remove('shake');
    void p.offsetWidth; // 애니메이션을 다시 시작시키기 위한 리플로
    p.classList.add('shake');
  }

  function frame() {
    var now = Date.now();
    var dt = (now - lastFrame) / 1000;
    lastFrame = now;
    if (!document.hidden && now - Cloud.lastCycle >= CLOUD_EVERY_MS) Cloud.check(); // 1분마다 서버와 맞춘다
    if (!document.hidden && now - Update.lastCheck >= UPDATE_EVERY_MS) Update.check(); // 30분마다 새 버전 확인(설치형만)
    if (paused) return;    // 다른 기기가 진행 중: 이 기기의 시간은 흐르지 않는다
    if (!(dt > 0)) return; // 시스템 시계가 뒤로 간 경우
    if (dt > AWAY_THRESHOLD) reportAway(C.applyOffline(state, dt), true); // 탭이 잠들었다 깨어남: 정산 화면을 먼저 보여 준다
    else handleEvents(C.tick(state, dt));

    if (now >= nextFlavor) {
      if (nextFlavor) log(nextChatter());
      nextFlavor = now + 120000 + Math.random() * 120000;      // 2~4분에 한 줄(전에는 30초쯤마다라 로그를 뒤덮었다)
    }
    if (!document.hidden) {
      if (now - lastSave >= AUTOSAVE_MS) { lastSave = now; Store.save(); }
    }
    render();
  }
  /** 한 프레임의 오류가 게임 전체를 멈추지 않게 감싼다. 안내는 한 번만 띄운다. */
  function safeFrame() {
    try { frame(); }
    catch (e) {
      console.error(e);
      if (!frameErrorShown) { frameErrorShown = true; notice('화면 갱신 중 문제가 생겼습니다. 저장 코드를 복사한 뒤 새로 고쳐 주세요.'); }
    }
  }

  /* ---------- 입력 연결 ---------- */
  function popNumber(text) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var wrap = $('scavenge-wrap');
    var s = el('span', 'pop', text);
    s.style.left = (30 + Math.random() * 40) + '%';
    s.addEventListener('animationend', function () { s.remove(); });
    wrap.appendChild(s);
  }

  /** 두 번 눌러야 실행되는 버튼. 4초 안에 다시 누르지 않으면 원래대로 돌아간다. */
  function twoStep(btn, armedText, action) {
    var timer = null, original = '';
    btn.addEventListener('click', function () {
      if (btn.dataset.armed) {
        clearTimeout(timer); delete btn.dataset.armed;
        action();
        return;
      }
      original = btn.textContent;
      btn.dataset.armed = '1';
      btn.textContent = armedText;
      timer = setTimeout(function () { delete btn.dataset.armed; btn.textContent = original; render(); }, 4000);
    });
  }

  /*
   * 저장 코드: 저장 글(JSON)을 base64 로 바꾼 것.
   *   btoa 는 한글을 그대로 넣으면 오류를 낸다(주인공·친구 이름에 한글이 들어가면서 코드가 안 만들어지던 원인, 0.8.10 에서 고침).
   *   그래서 먼저 UTF-8 로 바꾼 뒤 base64 로 만든다. 읽을 때는 거꾸로 하되, 예전 코드(한글이 없던 때의 것)도 읽을 수 있게 한다.
   */
  function encodeSave(json) { return btoa(unescape(encodeURIComponent(json))); }
  function decodeSave(code) {
    var raw = atob(code);
    try { return decodeURIComponent(escape(raw)); } catch (e) { return raw; }
  }
  function saveMsg(text, bad) {
    var m = $('save-msg');
    m.textContent = text;
    m.className = 'save-msg' + (bad ? ' save-bad' : '');
  }

  function wire() {
    $('scavenge').addEventListener('click', function () { search(); });   // 수색 지도의 다음 칸을 뒤진다
    // 구역 화면 안의 전환(운영 / 강화 / 목표)
    Array.prototype.forEach.call($('zone-panes').children, function (b) {
      b.addEventListener('click', function () { pane = b.dataset.pane; render(); });
    });
    // 구역 지도: 구역 화면의 단추나 머리띠의 구역 번호를 누르면 열린다
    var openMap = function () { zmapPick = state.zone; renderZoneMap(); $('zmap').hidden = false; };
    $('zmap-open').addEventListener('click', openMap);
    $('route').addEventListener('click', openMap);
    $('zmap-close').addEventListener('click', function () { $('zmap').hidden = true; });
    $('hub-close').addEventListener('click', function () { $('hub').hidden = true; });
    $('hub-open').addEventListener('click', openHub);
    $('mnav-hub').addEventListener('click', openHub);
    $('away-ok').addEventListener('click', function () { $('away').hidden = true; sfx('buy'); });
    ['goal-go', 'm-goal-go'].forEach(function (id) { $(id).addEventListener('click', function () { if (guideNow && guideNow.view) goTo(guideNow.view); }); });
    $('signal').addEventListener('click', function () {
      var r = C.answerSignal(state);
      if (!r.ok) return; // 누르는 순간 신호가 끊긴 경우
      toast(r.kind === 'supplies' ? '보급품 · 물자 +' + fmt(r.gain) : r.kind === 'treats' ? '간식 +' + r.treats : '지원 · ' + r.seconds + '초 동안 생산 ' + r.mult + '배');
      sfx(r.kind === 'treats' ? 'feed' : 'answer'); render();
    });
    $('fortify').addEventListener('click', function () {
      var r = C.fortify(state);
      if (!r.ok) return; // 그사이 물자가 모자라졌거나 이미 충분해진 경우
      sfx('fortify'); render();
    });
    $('open-zone').addEventListener('click', function () {
      var r = C.openZone(state);
      if (!r.ok) return;
      if (r.soon) log(r.zone.no + '구역 ' + r.zone.name + '의 문 앞에 닿았다. 문은 아직 열리지 않는다.', 'good');
      else { log(r.zone.no + '구역 ' + r.zone.name + '의 문을 열었다. 앞 구역은 그대로 남아 물자를 보낸다.', 'good'); tab = 'z' + r.index; moveFx(r.zone.no + '구역', r.zone.name, 1, r.index - 1, r.index); }
      sfx('relocate'); Store.save(); Cloud.flush(); render();
    });
    // 5구역: 점수를 조금 내고 과제 셋을 다시 뽑는다.
    $('lab-reroll').addEventListener('click', function () {
      if (!C.rerollOffers(state).ok) return;
      sfx('buy'); render();
    });
    // 4구역: 청신호. 이 신호로 도착한 열차가 있으면 평소의 도착 알림을 그대로 낸다.
    $('green').addEventListener('click', function () {
      var r = C.greenSignal(state);
      if (!r.ok) return;
      var gain = 0; r.arrivals.forEach(function (ev) { gain += ev.gain; });
      if (gain > 0) popNumber('+' + fmt(gain));
      handleEvents(r.arrivals);
      sfx('green'); render();
    });
    // 일행: 데려오기(등급 뽑기), 친구 이름, 주인공 이름
    ['dog', 'cat'].forEach(function (kind) {
      var b = $('adopt-' + kind), k = C.PET_KINDS[kind];
      b.appendChild(el('span', '', k.name)); b.appendChild(el('small', '', k.what));
      b.addEventListener('click', function () {
        var r = C.adoptPet(state, kind);
        if (!r.ok) return;
        if (r.dup) { toast(r.rarity.name + ' · ' + r.breed.name + ' · 이미 함께 있어요'); sfx('buy'); }
        else {
          log(r.rarity.name + ' 등급 ' + k.name + ' ' + r.breed.name + (C.hasBatchim(r.breed.name) ? '이' : '가') + ' 일행이 됐다. ' + C.breedDesc(r.breed) + '.', 'good');
          toast((r.rarity.id === 'rare' ? '희귀! ' : '') + r.rarity.name + ' · ' + r.breed.name + ' · 새 친구예요');
          sfx(r.rarity.id === 'common' ? 'buy' : 'defended');
        }
        $('pet-input').value = '';
        Store.save(); render();
      });
    });
    var renamer = function (inputId, change, done) {
      var go = function () {
        var r = change($(inputId).value);
        if (!r.ok) { toast(r.reason === 'empty' ? '새 이름을 적어 주세요' : '아직 친구가 없어요'); return; }
        $(inputId).value = '';
        toast(done(r.name)); sfx('buy'); Store.save(); render();
      };
      $(inputId).addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      return go;
    };
    $('pet-rename').addEventListener('click', renamer('pet-input', function (v) { return C.renamePet(state, v); }, function (n) { return '이제 ' + n + ' (이)라고 불러요'; }));
    $('hero-rename').addEventListener('click', renamer('hero-input', function (v) { return C.setHeroName(state, v); }, function (n) { return '주인공의 이름은 이제 ' + n; }));
    // 3구역: 전력 투입
    $('surge').addEventListener('click', function () {
      if (!C.surge(state).ok) return;
      sfx('surge'); render();
    });
    // 3구역: 병목인 기계를 올린다. 수량 모드를 따른다(×1 한 번, ×10 열 번, 최대는 물자가 되는 만큼).
    $('tune').addEventListener('click', function () {
      var r = C.tuneLine(state, qtyMode === 'max' ? 2000 : qtyMode);
      if (!r.ok) return;
      sfx('buy'); render();
    });
    $('sell').addEventListener('click', function () {
      var r = C.sellGoods(state);
      if (!r.ok) return;
      popNumber('+' + fmt(r.gain));
      if (r.streak === C.STREAK_MAX && r.bonus < C.streakMult(state)) toast('연속 호가 최대 · 판매 +' + Math.round(C.STREAK_MAX * C.STREAK_BONUS * 100) + '%');
      var sb = $('sell'); sb.classList.remove('flash'); void sb.offsetWidth; sb.classList.add('flash');
      sfx(r.peak ? 'peak' : 'sell'); render();
    });
    $('auto-sell').addEventListener('change', function () { C.setAutoSell(state, $('auto-sell').checked); Store.save(); render(); });
    $('sell-peak').addEventListener('change', function () { C.setSellPeak(state, $('sell-peak').checked); Store.save(); render(); });
    // 철수는 되돌릴 수 없으니 확인 창을 한 번 거친다(안전한 쪽 단추에 초점이 간다)
    $('retreat').addEventListener('click', function () {
      if (!C.canRetreat(state)) return;
      confirmBox('철수', '거점을 버리고 1구역에서 다시 시작해요. 항체 샘플 +' + fmt(C.antibodiesOnRetreat(state)) + '개를 받아요. 물자, 시설, 방벽, 연 구역은 사라지고 항체 샘플, 영구 특성, 일지, 업적, 도감은 남아요.', '남는다', '철수한다', doRetreat);
    });
    /*
     * 구역을 넘어가거나 철수할 때의 화면 효과(1.6.0).
     *   MOVE_FX 가운데 하나를 고른다. 바로 앞에 나온 것은 다시 고르지 않는다(pickMoveFx).
     *   dir +1 = 다음 구역, -1 = 철수(같은 효과를 반대 방향으로). 그림 속 라라도 같은 쪽으로 달려 나간다.
     *   동작 줄이기 설정이면 글자만 잠깐 보여 준다. 효과는 누르는 것을 막지 않는다(pointer-events: none).
     */
    function moveFx(big, small, dir, from, to) {
      try {
        var box = $('move-fx'); if (!box) return;
        lastFx = pickMoveFx(lastFx, Math.random);
        setText($('move-fx-big'), big); setText($('move-fx-small'), small);
        box.className = 'move-fx fx-' + lastFx + (dir < 0 ? ' back' : '');
        box.hidden = false; void box.offsetWidth; box.classList.add('go');
        clearTimeout(moveFx.timer);
        moveFx.timer = setTimeout(function () { box.hidden = true; box.classList.remove('go'); }, 2300);
        if (from >= 0 && scene && scene.travel) scene.travel(from, dir);      // from 이 음수면 글자 효과만(도전 시작·성공·실패처럼 자리를 옮기지 않는 일)
        // 위쪽 구역 번호 칸: 새로 선 구역이 노랗게 차오른다
        var li = to >= 0 ? $('route').children[to] : null;
        if (li) { li.classList.remove('arrive'); void li.offsetWidth; li.classList.add('arrive'); }
        buzz(dir < 0 ? [30, 40, 30] : 30);
      } catch (e) { console.warn('moveFx', e); }
    }
    fxShow = moveFx;      // 사건 처리(wire 밖)에서도 같은 효과를 쓸 수 있게 내어 둔다
    function doRetreat() {
      var wasZone = state.zone, r = C.retreat(state, Date.now());
      if (!r.ok) return;
      state = r.state;
      moveFx('철수', (state.retreats + 1) + '회차 · 다시 1구역', -1, wasZone, 0);
      tab = 'z0'; perkShown = '';
      log('거점을 버리고 철수했다. 항체 샘플 ' + fmt(r.gained) + '개를 챙겼다. 다시 1구역이다.', 'good');
      log('이번 회차는 구역 목표가 달라졌다.', '');      // 1.4.2: 철수할 때마다 목표를 다시 뽑는다
      notice('항체 샘플 ' + fmt(r.gained) + '개를 얻었어요. 특성 화면에서 영구 특성을 찍어 보세요.');
      sfx('relocate'); Store.save(); Cloud.flush(); render();
    }
    $('trait-reset').addEventListener('click', function () {
      confirmBox('특성 되돌리기', '찍은 특성을 모두 지우고, 쓴 항체 샘플을 전부 돌려받아요. 비용 없이 바로 다시 찍을 수 있어요.', '그만둔다', '되돌린다', function () {
        var r = C.resetTraits(state);
        if (r.ok) { log('특성을 되돌렸다. 항체 샘플 ' + fmt(r.refunded) + '개를 돌려받았다.'); Store.save(); render(); }
      });
    });
    document.querySelectorAll('[data-qty]').forEach(function (b) {
      b.addEventListener('click', function () {
        qtyMode = b.dataset.qty === 'max' ? 'max' : Number(b.dataset.qty);
        document.querySelectorAll('[data-qty]').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
        render();
      });
    });

    $('notice-close').addEventListener('click', function () { $('notice').hidden = true; });
    $('story').addEventListener('click', Story.advance);
    document.addEventListener('keydown', function (e) {
      if (!$('story').hidden && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); Story.advance(); }
    });

    // 효과음: 브라우저 규칙상 첫 입력 뒤에야 소리를 낼 수 있다. 켬/끔은 이 브라우저에 기억한다.
    var SOUND_KEY = 'zone7-sound';
    function applySound(on, remember) {
      if (window.Sound) window.Sound.setEnabled(on);
      document.querySelectorAll('[data-sound-toggle]').forEach(function (b) {
        b.setAttribute('aria-pressed', String(on));
        b.textContent = on ? '소리 켬' : '소리 끔';
      });
      if (remember) { try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch (e) { /* 기억만 못 한다 */ } }
    }
    var soundOn = true;
    try { soundOn = localStorage.getItem(SOUND_KEY) !== 'off'; } catch (e) { soundOn = true; }
    applySound(soundOn, false);
    document.querySelectorAll('[data-sound-toggle]').forEach(function (b) {
      b.addEventListener('click', function () { soundOn = !soundOn; applySound(soundOn, true); if (soundOn) sfx('buy'); });
    });
    ['pointerdown', 'keydown'].forEach(function (type) {
      document.addEventListener(type, function () { if (window.Sound) window.Sound.unlock(); }, { passive: true });
    });

    // 기록 탭: 일지·유물·특전·업적·패치노트·저장 중 하나를 고른다
    document.querySelectorAll('[data-rtab-set]').forEach(function (b) {
      b.addEventListener('click', function () {
        $('record').setAttribute('data-rtab', b.dataset.rtabSet);
        if (b.dataset.rtabSet === 'stats') renderStats(); // 다음 갱신을 기다리지 않고 바로 채운다
        if (b.dataset.rtabSet === 'dex') renderDex();
        if (b.dataset.rtabSet === 'ach') { achShown = ''; renderAch(); }
        document.querySelectorAll('[data-rtab-set]').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
        sfx('tab');
      });
    });

    // 폰 하단 메뉴: 네 가지 보기 중 하나를 고른다(데스크톱에서는 메뉴가 숨겨져 있고 전부 보인다).
    document.querySelectorAll('[data-mview-set]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.body.setAttribute('data-mview', b.dataset.mviewSet);
        document.querySelectorAll('[data-mview-set]').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
      });
    });

    // 화면 테마: 기본 라이트. 고른 값은 이 브라우저에 기억한다(게임 진행과 별개인 화면 설정).
    var SKIN_KEY = 'zone7-skin';
    function applySkin(skin, remember) {
      var dark = skin === 'dark';
      if (dark) document.documentElement.setAttribute('data-skin', 'dark');
      else document.documentElement.removeAttribute('data-skin');
      document.querySelectorAll('[data-skin-set]').forEach(function (b) {
        b.setAttribute('aria-pressed', String((b.dataset.skinSet === 'dark') === dark));
      });
      if (remember) { try { localStorage.setItem(SKIN_KEY, dark ? 'dark' : 'light'); } catch (e) { /* 기억만 못 할 뿐 적용은 된다 */ } }
    }
    document.querySelectorAll('[data-skin-set]').forEach(function (b) {
      b.addEventListener('click', function () { applySkin(b.dataset.skinSet, true); });
    });
    applySkin(document.documentElement.getAttribute('data-skin') === 'dark' ? 'dark' : 'light', false);
    $('save-now').addEventListener('click', function () {
      saveMsg(Store.save() ? '이 브라우저에 저장했습니다.' : '저장하지 못했습니다. 저장 코드를 복사해 두세요.', false);
    });

    // 저장 코드: 브라우저 저장이 사라져도 옮겨 갈 수 있는 백업 수단.
    // 업데이트 알림 띠의 두 단추. 알파 0.6 에서 화면을 새로 짜면서 이 연결이 빠져 있었다(눌러도 반응이 없던 원인, 0.9.0 에서 고침).
    $('update-now').addEventListener('click', function () { Update.apply(); });
    wirePrefs();
    wireNotify();
    wireMultiTouch();
    wirePerkReroll();
    wireOrder();
    wireContract(); wireLineExtras(); wireZoneEvents();
    wireSalvage();
    // 음량: 0 ~ 100(기본 50). 기기에 기억한다. 손을 떼면 그 크기로 소리를 한 번 들려준다
    (function () {
      var bar = $('volume'), label = $('volume-num');
      function apply(v, keep) {
        var n = 50;
        try { if (window.Sound) n = window.Sound.setVolume(v); } catch (e) { /* 소리는 없어도 된다 */ }
        bar.value = n; setText(label, String(n));
        if (keep) remember('zone7-volume', n);
      }
      apply(recall('zone7-volume'), false);
      bar.addEventListener('input', function () { apply(bar.value, true); });
      bar.addEventListener('change', function () { sfx('buy'); });
    })();
    $('pet-feed').addEventListener('click', function () { var r = C.feedPet(state); if (r.ok) { sfx('feed'); toast('Lv ' + r.level + ' · ' + C.petEffectText(state)); Store.save(); render(); } });
    // 주인공의 성별: 고르면 일지의 호칭이 바뀐다(설정 안 함이면 중립)
    document.querySelectorAll('[data-gender]').forEach(function (b) {
      b.addEventListener('click', function () { if (C.setHeroGender(state, b.getAttribute('data-gender')).ok) { Store.save(); render(); renderJournal(); } });
    });
    wireFeedback();
    $('export').addEventListener('click', function () {
      var code;
      try { code = encodeSave(C.serialize(state)); }
      catch (e) { saveMsg('저장 코드를 만들지 못했습니다.', true); return; }
      $('save-code').value = code;
      var done = function () { saveMsg('저장 코드를 복사했습니다. 메모장에 붙여 두세요.', false); };
      var manual = function () { $('save-code').select(); saveMsg('아래 칸의 코드를 직접 복사해 주세요.', false); };
      try { navigator.clipboard.writeText(code).then(done, manual); }
      catch (e) { manual(); }
    });

    $('import').addEventListener('click', function () {
      var text = $('save-code').value.trim();
      if (!text) { saveMsg('불러올 저장 코드를 아래 칸에 붙여 넣으세요.', true); return; }
      try {
        var json;
        try { json = decodeSave(text); } catch (e) { throw new Error('저장 코드 형식이 아닙니다. 처음부터 끝까지 복사했는지 확인하세요.'); }
        state = C.deserialize(json, Date.now());
        Store.save();
        saveMsg('불러왔습니다.', false);
        log('기록을 복원했다.', 'good');
        Cloud.flush();
        render();
      } catch (e) { saveMsg(e.message, true); }
    });

    twoStep($('reset'), '한 번 더 누르면 모든 기록이 사라진다', function () {
      Store.clear();
      state = C.createState(Date.now());
      $('log').textContent = '';
      log('모든 기록을 지우고 처음부터 다시 시작한다.');
      Cloud.flush(); // 계정 저장도 새 게임으로 덮어쓴다
      render();
    });

    // 탭을 닫거나 숨길 때 마지막 순간을 저장한다.
    document.addEventListener('visibilitychange', function () {
      webPushSync(document.hidden);      // 웹 앱 알림: 가려질 때 맡기고, 돌아오면 취소한다
      if (document.hidden) { if (!paused) Store.save(); Cloud.flush(); } // 진행 중인 기기면 최신 진행을 바로 올려 둔다
      else { Cloud.check(); Update.check(); } // 돌아왔을 때 다른 기기가 가져갔는지, 새 버전이 나왔는지 확인한다
    });
    // 강제 귀환: 보상을 못 받는다는 것을 먼저 알리고, 확인했을 때만 불러들인다
  }

  /* ---------- 시작 ---------- */
  /**
   * snapshot: 페이지가 새 버전으로 교체될 때 뷰어가 넘겨주는 직전 상태(없으면 {}).
   * 스냅샷 → 브라우저 저장 → 새 게임 순으로 시도한다.
   */
  function start(snapshot) {
    var now = Date.now();
    // 시작 화면에 진행을 알린다. 시작 화면이 없으면(테스트 등) 아무 일도 하지 않는 대역을 쓴다.
    var boot = window.BOOT || { mark: function () {}, skip: function () {} };
    boot.mark('code');
    // 뷰어가 진행 중이던 게임을 넘겨받아 페이지만 바꾼 경우에는 시작 화면을 건너뛴다(하던 플레이가 끊기지 않게).
    if (snapshot && snapshot.version === C.SAVE_VERSION) boot.skip();
    var loaded = { state: null, error: null };
    if (snapshot && snapshot.version === C.SAVE_VERSION) state = C.sanitizeState(snapshot, now);
    else {
      loaded = Store.load();
      state = loaded.state || C.createState(now);
    }

    boot.mark('save');
    build();
    wire();

    if (loaded.error) notice(loaded.error);
    if (loaded.state) {
      log('무전기를 다시 켰다. 거점은 무사하다.');
      reportAway(C.applyOffline(state, (now - state.lastSeen) / 1000));
    } else if (!snapshot || !snapshot.version) {
      log('방벽을 손봐야 한다. 철조망 하나면 첫 밤은 넘길 수 있다.');
      log('잔해를 수색해 물자를 모으고, 수색조를 꾸려라.');
      if (!loaded.error) notice('알파 0.6 부터 구조가 새로 바뀌었어요. "다음 할 일"을 따라가면 돼요. 자세한 설명은 기록 > 도움말에 있어요.');
    }

    lastFrame = now; lastSave = now;
    render();
    // 도트 화면은 부가 요소다. 모듈이 없거나 캔버스를 못 써도 게임은 그대로 진행한다.
    try { if (window.Scene) scene = window.Scene.mount($('scene'), sceneView); }
    catch (e) { console.warn('scene', e); scene = null; }
    boot.mark('ready');
    setInterval(safeFrame, 100);
    window.ZONE7_STARTED = true;      // 안전장치(template.html)에게 무사히 시작했다고 알린다. 게임은 여기서 이미 돌고 있다
    // 아래 셋은 부가 기능이다(1.2.2): 여기서 오류가 나도 게임 시작을 막지 않게 하나씩 감싼다
    try { Cloud.init(); } catch (e) { console.warn('cloud', e); }
    try { Update.afterUpdate(); } catch (e) { console.warn('update', e); }
    try { Update.check(); } catch (e) { console.warn('update', e); }
  }

  // 뷰어가 페이지를 교체할 때 진행 상황을 넘겨받을 수 있도록 현재 상태를 제공한다.
  var hot = window.claude && window.claude.hot;
  try { if (hot && hot.snapshot) hot.snapshot(function () { return state; }); } catch (e) { /* 뷰어 밖에서는 없다 */ }
  if (hot && hot.ready) hot.ready(start);
  else start((hot && hot.data) || {});
})();
