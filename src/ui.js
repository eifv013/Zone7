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
  /*
   * 원정(1.8.0): 스테이지를 하는 동안 state 는 "스테이지 판"이고, 본 게임은 home 에 그대로 보관한다.
   *   저장·내보내기·서버 저장은 언제나 본 게임(home || state)만 쓴다. 스테이지 판은 어디에도 저장하지 않는다.
   *   그래서 스테이지 도중에 창을 닫으면 스테이지만 사라지고, 본 게임은 들어간 때부터 자리를 비운 것으로 정산된다.
   */
  var home = null, stageEnter = 0;
  function mainState() { return home || state; }
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
  var STAGE_KEY = 'zone7-stage-v1';      // 하던 원정 판(3.0.1). 본 게임 저장과 따로 둔다
  /** 적어 둔 원정 판이 있으면 그 판으로 돌아간다. 본 게임(state)을 다 읽고 자리 비움 정산까지 끝난 뒤에 부른다. */
  function resumeStage(now) {
    var raw = null;
    try { raw = localStorage.getItem(STAGE_KEY); } catch (e) { return false; }
    if (!raw || home) return false;
    try {
      var saved = JSON.parse(raw), sg = saved && saved.stage, def = sg && C.STAGES.filter(function (d) { return d.id === sg.id; })[0];
      if (!def || sg.won || sg.lost) { localStorage.removeItem(STAGE_KEY); return false; }
      var st = C.deserialize(saved.text, now);
      st.stage = { id: def.id, hard: !!sg.hard, won: false, lost: false, seconds: Math.max(0, Number(sg.seconds) || 0), goal: Math.max(0, Math.floor(Number(sg.goal) || 0)) };
      st.lastSeen = now;      // 닫혀 있던 동안 원정의 시간은 흐르지 않는다
      home = state; stageEnter = now; state = st;      // 본 게임은 방금 정산했으므로, 원정을 끝낼 때는 지금부터의 시간만 더 정산한다
      tab = 'z0'; pane = 'play'; perkShown = '';
      return true;
    } catch (e) { try { localStorage.removeItem(STAGE_KEY); } catch (e2) { /* 그대로 둬도 다음에 다시 지운다 */ } return false; }
  }
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
        if (!home) state.lastSeen = Date.now();      // 스테이지 중에는 본 게임의 '마지막으로 본 때'를 건드리지 않는다(들어간 때로 남는다)
        localStorage.setItem(SAVE_KEY, C.serialize(mainState()));
        // 3.0.1: 원정 중이면 원정 판도 따로 적어 둔다. 전에는 원정 판을 어디에도 적지 않아서, 도중에 업데이트되거나 창이 닫히면 원정이 처음(0)으로 돌아갔다
        try { if (home && state.stage && !state.stage.hard) localStorage.setItem(STAGE_KEY, JSON.stringify({ stage: state.stage, text: C.serialize(state) })); else localStorage.removeItem(STAGE_KEY); } catch (e2) { /* 원정만 못 이어 갈 뿐이다 */ }
        return true;
      } catch (e) { return false; }
    },
    clear: function () { try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(STAGE_KEY); } catch (e) { /* 지울 것이 없다 */ } }
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
      // 3.8.2 화면 키우기 막기: 아이폰은 viewport 의 user-scalable=no 를 듣지 않는 판이 있어서, 벌리기 몸짓(gesture*)과 두 손가락 밀기를 직접 막는다
      ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (type) { document.addEventListener(type, function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false }); });
      document.addEventListener('touchmove', function (e) { if (e.touches && e.touches.length > 1 && e.cancelable) e.preventDefault(); }, { passive: false });
      document.addEventListener('wheel', function (e) { if (e.ctrlKey && e.cancelable) e.preventDefault(); }, { passive: false });      // 노트북 터치패드로 벌리기
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
          // 3.8.1: 단추가 아닌데 누르는 것(4구역 승강장 그림)도 [data-tap] 으로 표시해 두면 같이 눌러 준다.
          //   전에는 단추만 찾아서, 그림을 빠르게 두드리면 두 번째부터는 '빈 곳을 두 번 누른 것'으로 보고 누름을 버렸다(첫 번째만 먹었다)
          var btn = s.target && s.target.closest ? s.target.closest('button, [data-tap]') : null, under = document.elementFromPoint(t.clientX, t.clientY);
          /*
           * 1.3.0: 예전에는 손을 뗀 자리에 그 단추가 그대로 있어야만(elementFromPoint) 눌러 주었다.
           *   수색 지도의 칸은 눌리면 잠깐 작아졌다 커지고(tile-hit), 칸 사이에 틈도 있어서, 빠르게 두드리면 손끝이 칸 가장자리를 벗어난 것으로 읽혀 누름이 버려졌다.
           *   손가락이 거의 움직이지 않았다는 것은 isTap 이 이미 확인했으므로, 누르기 시작한 단추를 그대로 눌러 준다.
           *   다만 그 사이에 창(일지, 특전 고르기 등)이 위에 떴으면 아래 단추는 누르지 않는다.
           */
          var veil = under && under.closest ? under.closest('.story-veil, [role="dialog"], [role="alert"]') : null;
          if (btn && !btn.disabled && !(veil && !veil.contains(btn))) {
            synth = { btn: btn, at: Date.now() };
            /* 4.0.3: 그림([data-tap])은 누른 자리를 함께 넘긴다. btn.click() 은 자리(clientX/Y)가 0 이라서, 누른 자리로 대상을 가리는 그림(5구역 병실)에서는
               빠르게 이어 누른 것이 엉뚱한 대상으로 갔다(자리 없음 = 자판으로 누른 것으로 보고 '가장 급한 사람'을 골랐다) */
            if (btn.hasAttribute && btn.hasAttribute('data-tap') && typeof MouseEvent === 'function') btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: t.clientX, clientY: t.clientY }));
            else btn.click();
            made = true;
          }
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
  // 3.1.1: 아직 화면을 한 번도 누르지 않았으면 진동을 부르지 않는다. 브라우저가 막으면서 오류를 찍는다(공사가 저절로 끝날 때처럼 누르지 않고도 진동이 불리는 일이 생겼다)
  function buzz(ms) { try { var ua = navigator.userActivation; if (prefs.vibrate === 'on' && navigator.vibrate && (!ua || ua.hasBeenActive)) navigator.vibrate(ms); } catch (e) { /* 진동은 없어도 된다 */ } }
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
      home = null;      // 다른 기기의 진행을 받으면 하던 스테이지는 버린다
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
      if (!home) state.lastSeen = now;
      try {
        await withTimeout(Cloud.ref.set({ json: C.serialize(mainState()), savedAt: now, device: toDevice || Cloud.device, wants: null, zone: C.zoneLabel(mainState()) }), 15000);
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
        notice(name + (C.hasBatchim(name) && !/[178]$/.test(name) ? '으로' : '로') + ' 업데이트됐다. 기록 > 패치에서 바뀐 점을 볼 수 있다.', 8000);
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
  /** "3구역 …"처럼 구역 번호로 시작하는 알림이 지나온 구역 것인가. */
  function pastZoneText(text) { var m = /^([1-7])구역/.exec(String(text)); return !!m && state && Number(m[1]) - 1 < state.zone; }
  function toast(text) {
    // 2.9.3: 지나온 구역의 알림은 띄우지 않는다(일지에는 남는다). 뒤 구역에 가 있으면 앞 구역들의 주문 · 고장 · 트럭 알림이 쉬지 않고 올라왔다
    if (pastZoneText(text)) return;
    var box = $('toasts');
    var t = el('div', 'toast', text);
    t.addEventListener('animationend', function () { t.remove(); });
    box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild); // 한꺼번에 쏟아져도 3장까지만
  }
  /**
   * 화면 위 알림 띠. ms 를 주면 그 시간 뒤에 스스로 닫힌다(2.8.8: "업데이트됐다"는 읽고 나면 닫을 일만 남는 알림이었다).
   * ms 가 없으면 닫기를 누를 때까지 남는다: 오류처럼 꼭 봐야 하는 알림은 사라지면 안 된다.
   */
  var noticeTimer = null;
  function notice(text, ms) {
    setText($('notice-text'), text);
    $('notice').hidden = false;
    if (noticeTimer) { clearInterval(noticeTimer); noticeTimer = null; }      // 뒤에 온 알림을 앞 알림의 시계가 닫지 않게
    setText($('notice-close'), '닫기');
    if (!(ms > 0)) return;
    // 2.9.0: 닫기 단추에 남은 초를 적는다("닫기 8"). 언제 사라지는지 보이고, 기다리지 않고 눌러 닫을 수도 있다.
    // 시작 화면이 가리고 있는 동안에는 세지 않는다: 보이기도 전에 시간이 다 가지 않게.
    var left = ms;
    function shown() { var boot = $('boot'); return !(boot && !boot.hidden && boot.getClientRects().length > 0) && !document.hidden; }
    function paint() { setText($('notice-close'), '닫기 ' + Math.max(1, Math.ceil(left / 1000))); }
    paint();
    noticeTimer = setInterval(function () {
      if ($('notice').hidden || $('notice-text').textContent !== text) { clearInterval(noticeTimer); noticeTimer = null; return; }      // 이미 닫았거나 다른 알림으로 바뀌었다
      if (!shown()) return;
      left -= 250;
      if (left <= 0) { clearInterval(noticeTimer); noticeTimer = null; $('notice').hidden = true; setText($('notice-close'), '닫기'); } else paint();
    }, 250);
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
      if (hit) { r.mile.appendChild(el('i', 'st on')); r.mile.appendChild(el('span', '', '현재 2배')); }
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
  /*
   * 지도 위의 라라(1.8.2): 지도 그림 위에 얹는 작은 도트 그림. 서 있을 때는 제자리걸음을 하고, 자리를 옮길 때는 길(표지에서 표지로)을 따라 걷는다.
   *   mapLara(상자, 지도 폭, 지도 높이) → { at(x, y) 바로 그 자리에 세운다, walk([[x, y], …]) 차례로 걸어간다 }
   *   좌표는 지도 그림(SVG viewBox)의 좌표다. 화면 크기가 바뀌어도 백분율로 놓으므로 그대로 맞는다.
   */
  function mapLara(box, vw, vh) {
    var i = el('i', 'map-lara'), queue = [], cur = null, timer = 0;
    box.appendChild(i);
    function put(p) { i.style.left = (p[0] / vw * 100).toFixed(2) + '%'; i.style.top = (p[1] / vh * 100).toFixed(2) + '%'; }
    function next() {
      var p = queue.shift();
      if (!p) { i.classList.remove('walking'); return; }
      var d = cur ? Math.sqrt(Math.pow(p[0] - cur[0], 2) + Math.pow(p[1] - cur[1], 2)) : 0, ms = Math.max(120, Math.min(900, d * 9));
      if (cur && p[0] !== cur[0]) i.classList.toggle('left', p[0] < cur[0]);
      i.style.transitionDuration = ms + 'ms'; i.classList.add('walking');
      cur = p; put(p);
      clearTimeout(timer); timer = setTimeout(next, ms);
    }
    return {
      at: function (x, y) { queue = []; clearTimeout(timer); i.style.transitionDuration = '0ms'; cur = [x, y]; put(cur); i.classList.remove('walking'); },
      walk: function (pts) { if (!cur) { this.at(pts[pts.length - 1][0], pts[pts.length - 1][1]); return; } queue = pts.slice(); clearTimeout(timer); next(); },
      where: function () { return cur; }
    };
  }
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
      rows.zmap.push({ g: g, rate: rate, name: name });
      svg.appendChild(g);
    });
    // 지금 있는 곳: 우비 소년의 노란 표시
    rows.zmapLara = null; rows.zmapAt = -1;      // 라라는 지도 그림을 붙인 뒤에 얹는다
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
      setText(r.name, C.ZONES[zi].no + '구역 ' + (zoneSeen(zi) ? C.ZONES[zi].name : HID));
    });
    rows.zmapRoad.forEach(function (seg, k) { seg.setAttribute('class', 'zm-road' + (k < state.zone ? ' zm-road-open' : '')); });
    // 라라: 지금 있는 구역에 서 있다. 지도를 닫아 둔 사이에 구역을 넘어갔으면, 열었을 때 길을 따라 걸어간다
    var hz = Math.min(state.zone, ZMAP_AT.length - 1);
    if (!rows.zmapLara) rows.zmapLara = mapLara($('zmap-map'), 320, 330);
    if (rows.zmapAt !== hz) {
      var way = [], from = rows.zmapAt < 0 ? hz : rows.zmapAt, stp = hz > from ? 1 : -1;
      for (var wz = from; wz !== hz; wz += stp) way.push([ZMAP_AT[wz + stp][0] + 16, ZMAP_AT[wz + stp][1] + 2]);
      if (rows.zmapAt < 0 || !way.length) rows.zmapLara.at(ZMAP_AT[hz][0] + 16, ZMAP_AT[hz][1] + 2); else rows.zmapLara.walk(way);
      rows.zmapAt = hz;
    }
    // 아래 카드: 고른 구역의 설명
    var z = C.ZONES[zmapPick], open = zmapPick <= state.zone, soon = z.kind === 'soon';
    setText($('zmap-name'), z.no + '구역 ' + (zoneSeen(zmapPick) ? z.name : HID) + (zmapPick === state.zone ? ' · 현재' : ''));
    setText($('zmap-lead'), soon ? '다음 버전에서 열려요.' : open ? z.lead + '.' : zoneSeen(zmapPick) ? '아직 열지 않았어요. ' + z.lead + '.' : '아직 가 보지 못한 곳이에요.');
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
        // 3.2.0: 기계를 지날 때마다 그 기계가 만든 만큼 상자가 늘어난다(맨 앞은 들어오는 고철 조금)
        var total = line.flow, through = seg === 0 ? total / 5 : 0; for (var k = 0; k < seg; k++) through += line.caps[ids[k]];
        if (!(through > 0)) continue;
        var gap = Math.max(7, Math.round(8 * total / through)), done = seg === 3;
        g.fillStyle = done ? hazard : soft;
        for (var px = x0 + (running || seg <= bi ? Math.floor(t) % gap : 0); px < x1 - 4; px += gap) { g.fillRect(px, beltY - 7, 6, 6); if (done) { g.fillStyle = ink; g.fillRect(px, beltY - 7, 6, 1); g.fillStyle = hazard; } }
      }
      // 병목 앞에 쌓인 물건
      if (false && top > 0 && bi >= 0 && line.load < 0.95) {      // 3.2.0: 병목이 없으므로 쌓이는 물건도 없다
        var pile = Math.min(9, Math.max(1, Math.round((1 - line.load) * 9)));
        g.fillStyle = soft;
        for (var n = 0; n < pile; n++) g.fillRect(xs[bi] - 22 - (n % 3) * 7, beltY - 7 - Math.floor(n / 3) * 7, 6, 6);
      }
      // 기계 셋
      ids.forEach(function (id, i) {
        var has = line.caps[id] > 0, slow = false, shake = surge && has && !still ? (Math.floor(Date.now() / 80) % 2) : 0;
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
   *   - 노선마다 색이 있다(RAIL_COLORS). 복구한 노선은 그 색의 두 줄 레일과 중간역, 끊긴 노선은 회색 점선이다.
   *   - 열차는 기관차 한 대에 화물칸이 붙는다. 화물칸의 수는 그 노선의 열차 수를 따른다(4대마다 한 칸, 세 칸까지).
   *     종점까지 갔다가 돌아온다(운행 시계의 절반이 가는 길). 돌아오는 열차의 화물칸에는 상자가 실려 있다.
   *   - 방금 도착한 노선은 역 쪽에 불빛이 잠깐 켜진다.
   * 2.4.0: 전에는 노란 네모에 바퀴 둘이라 열차로 보이지 않았다. 기관차(창, 전조등, 지붕)와 화물칸을 따로 그린다.
   * 그리다 실패해도 게임은 계속된다: 같은 정보가 아래 목록에 글로 있다.
   */
  var RAIL_COLORS = { loop: '#4f9a3a', river: '#2f7fd0', outer: '#d8702a', express: '#9a5fd0' };
  /** 기관차(11×8). x,y 는 왼쪽 위, dir 은 가는 쪽(1 오른쪽, -1 왼쪽). 왼쪽을 볼 때는 좌우를 뒤집어 그린다. */
  function railLoco(g, x, y, dir, col, ink) {
    function r(c, a, b, w, h) { g.fillStyle = c; g.fillRect(x + (dir > 0 ? a : 11 - a - w), y + b, w, h); }
    r(col, 0, 1, 10, 5); r(col, 10, 3, 1, 3);                                  // 몸통과 앞코
    r('#1b1c14', 1, 2, 5, 2); r('#bfe3f2', 6, 2, 3, 2);                        // 창 띠와 운전실 창
    r('#fff6c9', 10, 4, 1, 1);                                                 // 전조등
    r('#2a2b22', 0, 6, 11, 1); r('#0c0d08', 1, 7, 2, 1); r('#0c0d08', 7, 7, 2, 1);      // 하부와 바퀴
    r(ink, 2, 0, 6, 1);                                                        // 지붕
  }
  /** 화물칸(8×8 자리에 그린다). full 이면 상자가 실려 있다. */
  function railCar(g, x, y, full) {
    function r(c, a, b, w, h) { g.fillStyle = c; g.fillRect(x + a, y + b, w, h); }
    r('#7b7c70', 0, 3, 8, 3); r('#55564c', 0, 3, 8, 1); r('#2a2b22', 0, 6, 8, 1); r('#0c0d08', 1, 7, 2, 1); r('#0c0d08', 5, 7, 2, 1);
    if (full) { r('#a8763f', 1, 0, 3, 3); r('#8a5a34', 4, 1, 3, 2); r('#f0b400', 1, 1, 3, 1); }
  }
  /** 화물칸의 수: 열차 4대마다 한 칸, 한 칸에서 세 칸까지. */
  function railCars(n) { return Math.max(1, Math.min(3, Math.ceil((n || 0) / 4))); }
  /*
   * 3.4.0 승강장 그림(184×84 도트). 뒤(벽돌 벽 · 노을 창 · 지붕 · 승강장 · 선로)는 한 번만 그려 두고, 그 위에 열차 · 다음 칸 · 무리를 매번 그린다.
   *   - 화물칸은 붙은 수만큼. 다음에 붙을 칸은 오른쪽에서 굴러온다(붙기까지 남은 시간만큼 떨어져 있다).
   *   - 무리는 오른쪽 끝에서 열차 꼬리까지, 남은 시간에 맞춰 다가온다.
   *   - 열차가 떠나면(platAnim) 0.9초 동안 왼쪽으로 빠져나간다. 무리에 닿아 떼어 낸 칸은 그 자리에 남았다가 사라진다.
   */
  var platBack = null, platAnim = null, platRaf = 0, platSprint = 0, platPull = 0, platHorn = 0;
  function platBackdrop() {
    if (platBack) return platBack;
    var cv = document.createElement('canvas'); cv.width = 184; cv.height = 84; var g = cv.getContext('2d');
    var R = function (x, y, w, h, c) { px(g, x, y, w, h, c); }, P = function (x, y, c) { px(g, x, y, 1, 1, c); };
    /* 4구역 배경(시안): 강가의 한데 승강장, 해 질 녘. 3구역(벽돌 공장 안)과 겹치지 않게 벽과 창을 없애고 하늘 · 건너편 도시 · 강 · 철교를 그린다 */
    R(0, 0, 184, 84, '#2a2228');
    [[0, 7, '#2b2a4a'], [7, 7, '#40365a'], [14, 6, '#5e4262'], [20, 5, '#8a4e5e'], [25, 5, '#b8604e'], [30, 4, '#d87c4a'], [34, 3, '#eca458'], [37, 2, '#f6c878']].forEach(function (b) { R(0, b[0], 184, b[1], b[2]); });
    for (var sx0 = 3; sx0 < 184; sx0 += 17) P(sx0 + (sx0 * 7) % 5, 2 + (sx0 * 3) % 9, '#cfc8e0');      // 이른 별
    R(58, 31, 10, 8, '#fff0c0'); R(56, 33, 14, 6, '#fff0c0'); R(54, 36, 18, 3, '#ffe0a0');      // 지는 해
    R(20, 9, 22, 2, '#6a5070'); R(26, 8, 10, 1, '#6a5070'); R(96, 14, 26, 2, '#8a5a6a'); R(104, 13, 12, 1, '#8a5a6a');      // 구름
    // 강 건너 도시(실루엣)와 불 켜진 창
    [[0, 30, 9], [9, 26, 7], [16, 32, 10], [26, 28, 6], [32, 33, 12], [44, 29, 8], [74, 31, 9], [83, 25, 6], [89, 30, 11], [100, 33, 8], [108, 27, 7]].forEach(function (b, k) {
      R(b[0], b[1], b[2], 39 - b[1], '#33284a'); if (k % 2) P(b[0] + 2, b[1] + 3, '#f6c878'); if (k % 3 === 0) P(b[0] + b[2] - 3, b[1] + 5, '#f6c878'); });
    R(0, 39, 184, 7, '#34406a'); R(0, 39, 184, 1, '#5a5a86');      // 강
    [[50, 40, 26], [54, 42, 18], [58, 44, 10]].forEach(function (r) { R(r[0], r[1], r[2], 1, '#eca458'); }); for (var rv = 4; rv < 184; rv += 13) R(rv, 41 + rv % 4, 5, 1, '#4a5a8a');
    // 철교(오른쪽, 무리가 건너오는 쪽)
    R(116, 20, 68, 2, '#17141c'); R(116, 36, 68, 2, '#17141c'); for (var bx = 116; bx < 184; bx += 12) { R(bx, 20, 2, 18, '#17141c'); for (var d = 0; d < 12; d++) P(bx + d, 22 + Math.round(d * 14 / 12), '#17141c'); }
    R(128, 38, 4, 8, '#221e2a'); R(164, 38, 4, 8, '#221e2a');
    // 전차선 기둥과 줄
    [14, 108].forEach(function (cx) { R(cx, 5, 2, 41, '#17141c'); R(cx, 9, 16, 1, '#17141c'); for (var a = 0; a < 6; a++) P(cx + 2 + a, 14 - a, '#17141c'); R(cx + 14, 9, 1, 3, '#17141c'); });
    for (var wx2 = 0; wx2 < 184; wx2++) P(wx2, 12 + Math.round(Math.sin((wx2 - 30) / 94 * Math.PI) * 1.2), '#17141c');
    // 다듬기(3.9.3): 기둥 끝의 등과 불빛, 강에 비친 도시의 불, 멀리 나는 새, 승강장 뒤 난간
    [28, 122].forEach(function (lx) { R(lx - 1, 12, 3, 2, BK); R(lx - 1, 14, 3, 1, '#fff2c0'); for (var c = 0; c < 30; c++) { var w = 3 + c * 0.5; g.fillStyle = 'rgba(255,236,170,' + Math.max(0, 0.10 - c * 0.003).toFixed(3) + ')'; g.fillRect(Math.round(lx + 0.5 - w / 2), 15 + c, Math.round(w), 1); } });
    [[11, 41], [28, 43], [46, 41], [85, 42], [102, 44], [110, 41]].forEach(function (r) { P(r[0], r[1], '#f6c878'); P(r[0], r[1] + 2, '#c89a5a'); });
    [[70, 10], [76, 8], [150, 6]].forEach(function (b) { P(b[0], b[1], '#17141c'); P(b[0] + 1, b[1] - 1, '#17141c'); P(b[0] + 2, b[1], '#17141c'); });
    R(0, 42, 184, 1, '#17141c'); for (var fx2 = 2; fx2 < 184; fx2 += 8) R(fx2, 42, 1, 4, '#17141c'); R(0, 44, 184, 1, '#2a2630');
    // 역 이름판(기둥에 건 것)과 시계
    R(94, 26, 2, 20, '#17141c');
    R(82, 13, 26, 13, BK); R(83, 14, 24, 11, '#f0b400'); spr(g, 86, 16, ['#..#', '#..#', '####', '...#', '...#', '...#', '...#'], { '#': BK }); spr(g, 93, 17, ['...#...', '....#..', '######.', '....#..', '...#...'], { '#': BK }); R(102, 16, 3, 7, BK); P(103, 17, '#f0b400'); P(103, 19, '#f0b400'); P(103, 21, '#f0b400');
    R(40, 24, 2, 22, '#17141c'); R(36, 16, 10, 9, BK); R(37, 17, 8, 7, '#e8e6dc'); P(41, 18, BK); P(41, 19, BK); P(41, 20, '#b8402e'); P(42, 20, BK); P(43, 20, BK);
    // 승강장과 그 위의 것들
    R(0, 46, 184, 8, '#6a6a64'); R(0, 46, 184, 1, '#8a8a82'); for (var px1 = 0; px1 < 184; px1 += 10) R(px1, 47, 1, 7, '#5a5a54');
    for (var sx = 0; sx < 184; sx += 6) { R(sx, 53, 3, 1, '#f0b400'); R(sx + 3, 53, 3, 1, BK); }
    R(0, 54, 184, 3, '#3a3a36'); R(0, 54, 184, 1, '#4a4a44');
    R(78, 41, 14, 1, '#8a5a2a'); R(78, 42, 14, 1, '#6a4420'); R(79, 43, 1, 3, BK); R(90, 43, 1, 3, BK); R(78, 38, 14, 1, '#8a5a2a'); R(78, 39, 1, 2, '#6a4420'); R(91, 39, 1, 2, '#6a4420');
    var crate = function (x, y, c, d) { R(x, y, 7, 6, c); R(x, y, 7, 1, d); R(x, y + 5, 7, 1, d); R(x, y, 1, 6, d); R(x + 6, y, 1, 6, d); P(x + 3, y + 2, d); P(x + 3, y + 3, d); };
    crate(140, 40, '#c9a04a', '#8a6a2a'); crate(148, 40, '#c9a04a', '#8a6a2a'); crate(144, 34, '#b8894a', '#7a5a2a'); crate(158, 40, '#7a9a6a', '#4a6a3a');
    var man = { k: BK, s: '#e6c9a0', b: '#3f6f8f', p: '#3a3a36', c: '#c9a04a', e: '#8a6a2a' };
    spr(g, 132, 35, ['.kk.', '.ss.', 'bbbcc', 'bbbce', '.bb.', '.pp.', '.pp.', '.p.p'], man);
    spr(g, 120, 36, ['.kk.', '.ss.', '.bb.', 'bbbb', '.bb.', '.pp.', '.p.p'], { k: BK, s: '#e6c9a0', b: '#8a5a44', p: '#3a3a36' });
    spr(g, 100, 35, ['.yy.', 'yssy', 'yyyy', 'yyyy', 'yyyyL', '.yy.L', '.dd.', '.d.d'], { y: '#f0b400', s: '#e6c9a0', d: '#3a3a36', L: '#3f8fd0' });
    // 선로
    R(0, 57, 184, 27, '#221c1e');
    for (var i = 0; i < 260; i++) P((i * 37) % 184, 74 + (i * 13) % 10, i % 3 ? '#3a3034' : '#4a3e40');
    for (var tie = 2; tie < 184; tie += 7) R(tie, 71, 4, 3, '#4a3626');
    R(0, 70, 184, 1, '#a9a79c'); R(0, 71, 184, 1, '#6a6a64'); R(0, 76, 184, 1, '#8a8a82');
    platBack = cv; return cv;
  }
  var CAR_W = 12;
  function platWheels(g, x, w) { [x + 1, x + w - 4].forEach(function (a) { px(g, a, 67, 3, 3, BK); px(g, a + 1, 66, 1, 5, BK); px(g, a + 1, 68, 1, 1, '#8a8a82'); }); }
  var CAR_KINDS = [
    function (g, x) { px(g, x, 54, 11, 12, '#a03a2a'); px(g, x, 54, 11, 1, '#c4503a'); for (var k = 2; k < 11; k += 3) px(g, x + k, 55, 1, 10, '#7a2a20'); px(g, x + 4, 57, 3, 7, '#8a3024'); px(g, x + 5, 60, 1, 1, BK); px(g, x, 65, 11, 1, '#5a2018'); },
    function (g, x) { px(g, x, 60, 11, 6, '#3f5f7a'); px(g, x, 60, 11, 1, '#5a7f9a'); px(g, x + 1, 55, 4, 5, '#c9a04a'); px(g, x + 1, 55, 4, 1, '#8a6a2a'); px(g, x + 6, 56, 4, 4, '#b8894a'); px(g, x + 6, 56, 4, 1, '#7a5a2a'); px(g, x, 65, 11, 1, '#2a4052'); },
    function (g, x) { px(g, x + 1, 55, 9, 9, '#8a8a82'); px(g, x + 1, 55, 9, 2, '#b0b0a8'); px(g, x + 1, 62, 9, 2, '#5a5a54'); px(g, x, 57, 1, 5, '#8a8a82'); px(g, x + 10, 57, 1, 5, '#5a5a54'); px(g, x + 4, 53, 3, 2, '#55564e'); px(g, x + 2, 58, 2, 2, '#f0b400'); px(g, x, 64, 11, 2, '#3a3a36'); },
    function (g, x) { px(g, x, 60, 11, 6, '#4a6a3a'); px(g, x, 60, 11, 1, '#6a8a52'); px(g, x + 1, 56, 9, 4, '#7a8a5a'); px(g, x + 2, 54, 7, 2, '#7a8a5a'); px(g, x + 1, 56, 9, 1, '#9aaa72'); px(g, x + 4, 58, 1, 1, '#5a6a42'); px(g, x, 65, 11, 1, '#2e4424'); }
  ];
  function platLoco(g, x) {
    px(g, x, 50, 22, 16, '#f0b400'); px(g, x, 50, 22, 1, '#ffd34a'); px(g, x, 62, 22, 4, '#c98f00'); px(g, x + 11, 44, 11, 7, '#f0b400'); px(g, x + 11, 44, 11, 1, '#ffd34a'); px(g, x + 13, 46, 7, 4, BK); px(g, x + 14, 47, 5, 2, '#ffe9a0'); px(g, x + 15, 47, 2, 2, '#e6c9a0');
    for (var k = 0; k < 5; k++) px(g, x + 1 + k * 4, 63, 2, 2, BK);
    px(g, x + 3, 46, 3, 4, '#30343c'); px(g, x + 2, 45, 5, 1, BK); px(g, x + 4, 43, 1, 1, '#9a9a92'); px(g, x + 5, 41, 1, 1, '#b0b0a8'); px(g, x + 3, 39, 1, 1, '#c4c4bc');
    px(g, x - 2, 56, 2, 4, BK); px(g, x - 3, 57, 1, 2, '#fff2c0'); px(g, x + 5, 53, 4, 6, BK); px(g, x + 6, 54, 2, 4, '#3f8fd0');
    platWheels(g, x, 22);
  }
  function platCar(g, x, i) { CAR_KINDS[i % CAR_KINDS.length](g, x); platWheels(g, x, 11); px(g, x - 1, 63, 1, 1, '#55564e'); }
  var PLAT_Z = [['.gg.', 'gkgk', '.gg.', 'ccccg', 'gcc..', '.cc.', '.d.d'], ['.gg.', 'gkgk', '.gr.', 'gccc.', '.ccg', '.dd.', 'd..d'], ['.gg.', 'kgkg', '.gg.', '.cc.g', 'gcc.', '.d.d', '.d.d']];
  function drawPlatform(ti) {
    var cv = $('platform'); if (!cv) return;
    var g = cv.getContext('2d'), now = Date.now(), LX = 6, CX = LX + 24;
    g.drawImage(platBackdrop(), 0, 0);
    var anim = platAnim && now - platAnim.at < 900 ? platAnim : null, slide = 0;
    if (platAnim && !anim) platAnim = null;
    if (anim) {      // 떠나는 열차: 왼쪽으로 점점 빨리
      var t = (now - anim.at) / 900; slide = -Math.round(t * t * 230);
      platLoco(g, LX + slide); for (var a = 0; a < anim.kept; a++) platCar(g, CX + a * CAR_W + slide, a);
      for (var c = 0; c < anim.cut; c++) platCar(g, CX + (anim.kept + c) * CAR_W, anim.kept + c);      // 떼어 낸 칸은 남는다
      if (anim.cut) for (var z = 0; z < 3; z++) spr(g, CX + (anim.kept + anim.cut) * CAR_W + 2 + z * 6 - Math.round(t * 8), 62 + z % 2, PLAT_Z[z], { g: '#7fb85a', k: BK, c: ['#6b4a3a', '#3f5f7a', '#8a8a52'][z], d: '#3a3a36', r: '#b8402e' });
      if (!platRaf) platRaf = requestAnimationFrame(function () { platRaf = 0; if ($('rail') && !$('rail').hidden) drawPlatform(C.trainInfo(state)); });
      return;
    }
    if (!ti.running) return;
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(LX, 72, 24 + ti.cars * CAR_W, 2);
    platLoco(g, LX); for (var i = 0; i < ti.cars; i++) platCar(g, CX + i * CAR_W, i);
    var tail = CX + ti.cars * CAR_W;
    if (ti.cars < ti.max) {      // 다음 칸이 굴러온다
      var cs = C.carSeconds(state), far = Math.min(1, ti.next / cs), nx = Math.round(tail + far * Math.min(40, 178 - tail - CAR_W));
      g.globalAlpha = 0.55 + 0.45 * (1 - far); platCar(g, nx, ti.cars); g.globalAlpha = 1;
    }
    // 무리: 오른쪽 끝에서 열차 꼬리까지
    var hp = Math.max(0, Math.min(1, ti.near)), hx = Math.round(tail + CAR_W + 2 + hp * (200 - tail - CAR_W));
    for (var q = 0; q < 3; q++) spr(g, hx + q * 7, 62 + q % 2 + (Math.floor(now / (ti.rush ? 90 : 300) + q) % 2), PLAT_Z[q], { g: '#7fb85a', k: BK, c: ['#6b4a3a', '#3f5f7a', '#8a8a52'][q], d: '#3a3a36', r: '#b8402e' });
    if (now - platPull < 160 && ti.cars < ti.max) { px(g, tail - 2, 60, 2, 2, '#fff2c0'); px(g, tail, 57, 1, 2, '#ffd95a'); px(g, tail + 2, 62, 2, 1, '#ffd95a'); px(g, tail - 4, 63, 1, 1, '#fff2c0'); }      // 칸을 당길 때 연결기에서 불꽃
    if (now - platHorn < 600) { var hw = Math.round((now - platHorn) / 600 * 60); g.fillStyle = 'rgba(255,242,192,' + (0.5 * (1 - (now - platHorn) / 600)).toFixed(3) + ')'; g.fillRect(tail + hw, 50, 3, 22); g.fillRect(tail + hw + 8, 52, 2, 18); }      // 경적: 소리가 무리 쪽으로 퍼진다
    if (ti.rush) {      // 3.8.6 돌진: 선로가 붉게 깜빡이고, 무리 위에 느낌표가 뜨고, 달려오는 동안에는 먼지가 인다
      if (Math.floor(now / 160) % 2) { g.fillStyle = 'rgba(255,90,74,.22)'; g.fillRect(0, 57, 184, 27); }
      px(g, hx + 8, 52, 2, 5, '#ff5a4a'); px(g, hx + 8, 58, 2, 2, '#ff5a4a');
      if (ti.rush === 'run') for (var du = 0; du < 4; du++) px(g, hx + 22 + du * 5 + Math.floor(now / 80) % 3, 70 - du % 2, 2, 1, '#8a8478');
    }
    if (now - platSprint < 500) { g.fillStyle = 'rgba(255,90,74,' + (0.28 * (1 - (now - platSprint) / 500)).toFixed(3) + ')'; g.fillRect(0, 57, 184, 27); }      // 달려드는 순간 선로가 붉게 번쩍인다
    // 경고등: 무리가 가까우면 깜빡인다
    px(g, 178, 36, 3, 3, BK); var lit = ti.near <= 0.3 && Math.floor(now / 250) % 2 === 0;
    px(g, 179, 37, 1, 1, lit ? '#ff5a4a' : '#6a2a24'); if (lit) { g.fillStyle = 'rgba(255,90,74,.25)'; g.fillRect(175, 33, 9, 9); }
  }
  function drawRail(plan) {
    try {
      var cv = $('railmap'), g = cv.getContext('2d'), css = getComputedStyle(document.body);
      var ink = css.getPropertyValue('--ink').trim() || '#17180f', hazard = css.getPropertyValue('--hazard').trim() || '#f0b400', soft = css.getPropertyValue('--ink-soft').trim() || '#666';
      var bg = css.getPropertyValue('--concrete').trim() || '#cfcfc4';
      var W = cv.width, H = cv.height, x0 = 34, ends = [112, 172, 242, 306], now = Date.now(), still = prefs.shake === 'off';
      g.clearRect(0, 0, W, H);
      C.ROUTES.forEach(function (d, i) {
        var y = 13 + i * 22, x1 = ends[i], lv = state.routes[d.id], n = plan.riders[d.id], col = RAIL_COLORS[d.id] || hazard, tx, sx;
        if (!lv) {      // 끊긴 노선: 회색 점선과 불 꺼진 종점
          g.fillStyle = soft; for (tx = x0; tx < x1; tx += 8) g.fillRect(tx, y + 2, 4, 1);
          g.fillRect(x1 - 1, y - 6, 10, 11);
          return;
        }
        g.fillStyle = soft; for (tx = x0 + 3; tx < x1; tx += 6) g.fillRect(tx, y, 2, 5);            // 침목
        g.fillStyle = col; g.fillRect(x0, y + 1, x1 - x0, 1); g.fillRect(x0, y + 3, x1 - x0, 1);     // 두 줄 레일
        for (sx = x0 + 34; sx < x1 - 10; sx += 38) {                                                // 중간역
          g.fillStyle = ink; g.fillRect(sx, y - 1, 5, 7); g.fillStyle = bg; g.fillRect(sx + 1, y, 3, 5); g.fillStyle = col; g.fillRect(sx + 2, y + 1, 1, 3);
        }
        // 종점 역사: 노선 색 지붕, 불 켜진 창
        g.fillStyle = ink; g.fillRect(x1 - 1, y - 6, 10, 11); g.fillStyle = col; g.fillRect(x1 - 2, y - 8, 12, 3);
        g.fillStyle = bg; g.fillRect(x1 + 2, y - 2, 4, 7); g.fillStyle = '#ffe9a0'; g.fillRect(x1 + 3, y - 1, 2, 2);
        // 열차: 운행 시계의 앞 절반은 가는 길, 뒤 절반은 오는 길
        var ghost = !n && state.routeLoad[d.id] > 0;      // 열차가 다른 노선으로 옮겨 갔어도, 싣고 돌아오는 마지막 한 대는 보인다
        if (n || ghost) {
          var trip = C.tripSeconds(state, d.id), p = Math.max(0, Math.min(1, state.routeClock[d.id] / trip));
          var pos = p < 0.5 ? p * 2 : 2 - p * 2, back = p >= 0.5, cars = ghost ? 1 : railCars(n), len = 11 + cars * 9;
          var head = Math.round(x0 + len + pos * (x1 - x0 - len - 14));      // 기관차의 앞쪽 끝이 닿는 자리(가는 길 기준)
          var lx = back ? head - len : head - 11, ty = y - 6, k;
          railLoco(g, lx, ty, back ? -1 : 1, col, ink);
          for (k = 0; k < cars; k++) {
            var cx = back ? lx + 12 + k * 9 : lx - 9 * (k + 1);
            g.fillStyle = '#2a2b22'; g.fillRect(back ? cx - 1 : cx + 8, ty + 5, 1, 1);      // 연결기
            railCar(g, cx, ty, back);
          }
          if (!still) {      // 연기: 꼬리 쪽으로 두 점이 번갈아 뜬다
            var puff = Math.floor(now / 260) % 2, tail = back ? lx + len + 2 : lx - cars * 9 - 4;
            g.fillStyle = soft; g.fillRect(tail + (back ? puff : -puff), ty - 2 - puff, 2, 2); g.fillRect(tail + (back ? 3 : -4), ty - 4 + puff, 3, 2);
          }
        }
        // 도착 불빛(0.7초)
        if (railFlash[d.id] && now - railFlash[d.id] < 700) { g.fillStyle = hazard; g.fillRect(x0 - 2, y - 5, 4, 12); g.fillRect(x0 + 4, y - 7, 3, 3); g.fillRect(x0 + 6, y + 6, 3, 3); }
      });
      // 환승역: 지붕 아래 전광판, 승강장마다 노선 색 문
      g.fillStyle = ink; g.fillRect(4, 3, 26, H - 6);
      g.fillStyle = hazard; g.fillRect(4, 3, 26, 3);
      g.fillStyle = '#11120c'; g.fillRect(7, 9, 20, 7);
      g.fillStyle = hazard; for (var li = 0; li < 4; li++) if (still || Math.floor(now / 500 + li) % 4) g.fillRect(9 + li * 5, 11, 3, 3);
      g.fillStyle = bg; for (var wy = 28; wy < H - 14; wy += 22) { g.fillRect(8, wy, 5, 5); g.fillRect(16, wy, 5, 5); }
      C.ROUTES.forEach(function (d, i) {
        var y = 13 + i * 22;
        g.fillStyle = bg; g.fillRect(24, y - 3, 8, 9);
        g.fillStyle = state.routes[d.id] ? (RAIL_COLORS[d.id] || hazard) : soft; g.fillRect(26, y - 1, 6, 5);
      });
    } catch (e) { /* 그림이 없어도 아래 목록으로 다 보인다 */ }
  }

  /** 확인 창. guardMs 를 주면 창이 뜬 뒤 그 시간 동안은 '예'가 눌리지 않는다(화면을 연달아 누르다 그대로 확인까지 눌러 버리는 일을 막는다). */
  function confirmBox(title, text, noText, yesText, onYes, guardMs) {
    var openedAt = Date.now();
    setText($('confirm-title'), title);
    setText($('confirm-text'), text);
    setText($('confirm-no'), noText);
    setText($('confirm-yes'), yesText);
    function close() { $('confirm').hidden = true; $('confirm-no').onclick = null; $('confirm-yes').onclick = null; }
    $('confirm-no').onclick = close;
    $('confirm-yes').onclick = function () { if (guardMs > 0 && Date.now() - openedAt < guardMs) return; close(); onYes(); };
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
    z2: '공단 · 같은 상자 둘을 누르면 합쳐져요.',
    z3: '환승역 · 화물칸을 모았다가 한 번에 보내요.',
    z4: '대학 병원 · 과제를 끝내면 다른 구역이 강해져요.',
    z5: '강변 검문소 · 다리를 건너오는 무리를 막아요.',
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
      var r = buildRow(d, function () { buy(C.buyMachine(state, d.id, qtyFor(C.maxMachines(state, d.id), d.max - (state.machines[d.id] || 0))), 'machine'); });
      rows.machines[d.id] = r; $('rows-z2').appendChild(r.btn);
    });
    // 3.8.8 줄 순서: 4구역(기관차 → 화물 등급 → 연결 작업반)과 같게, 값 → 단계 → 빠르기. 전에는 금방 끝까지 올리는 투입구가 맨 위에 '최대'로 남아 있었다
    ['paint', 'forge', 'feed'].forEach(function (id) { if (rows.machines[id]) $('rows-z2').appendChild(rows.machines[id].btn); });
    // 4구역: 노선 현황(위쪽)과 열차·노선 구매 줄(아래쪽)
    rows.train = buildRow({ id: 'train', name: '기관차', desc: '화물을 더 싣는다. ' + C.FLEET_MILESTONES.slice(0, 3).join('·') + '레벨마다 2배' }, function () { buy(C.buyTrain(state, qtyFor(C.maxTrains(state), C.TRAIN_MAX - state.trains)), 'train'); });
    $('rows-z3').appendChild(rows.train.btn);
    C.ROUTES.forEach(function (d) {
      var row = el('div', 'rail-row'), name = el('div', 'rail-name', d.name), small = el('small'), side = el('div', 'rail-side'), track = el('div', 'track'), bar = el('i');
      name.appendChild(small); track.appendChild(bar); row.appendChild(name); row.appendChild(side); row.appendChild(track);
      rows.railRows[d.id] = { row: row, small: small, side: side, bar: bar }; $('rail-list').appendChild(row);
      var r = buildRow({ id: 'route-' + d.id, name: d.name, desc: d.desc }, function () { buy(C.buyRoute(state, d.id), 'route'); });
      rows.routes[d.id] = r; $('rows-z3').appendChild(r.btn);
    });
    // 5구역 줄(4.0.5: 연구 성과 단추는 없앴다)
    rows.staff = buildRow({ id: 'staff', name: '연구원', desc: '혈청 한 대의 값을 올린다. 10·25·50명마다 2배' }, function () { buy(C.buyStaff(state, qtyFor(C.maxStaff(state), C.COUNT_MAX - state.staff)), 'staff'); });
    $('rows-z4').appendChild(rows.staff.btn);
    // 3.9.2 5구역 줄: 연구원(값) · 시험관(개수) · 시약 등급(거두는 약품 2배)
    rows.rack = buildRow({ id: 'rack', name: '의자', desc: '한 사람을 더 받는다 · 값도 그만큼 오른다' }, function () { buy(C.buyRack(state), 'staff'); });
    rows.reagent = buildRow({ id: 'reagent', name: '시약 등급', desc: '혈청 한 대의 값이 2배가 된다' }, function () { buy(C.buyReagent(state), 'staff'); });
    $('rows-z4').appendChild(rows.rack.btn); $('rows-z4').appendChild(rows.reagent.btn);
    /* 4.0.3 병실 그림: 왼쪽의 냉장 상자를 누르면 혈청이 만들어지고, 사람을 누르면 한 대를 놓는다. 누른 자리(가로)로 가린다 */
    /* 4.0.8 그림 위에 뜨는 숫자: 놓은 자리에서 무엇을 얻었는지 바로 보인다(xd, yd 는 도트 자리) */
    function wardPop(xd, yd, text, cls) {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      var wrap = $('ward-wrap'); if (!wrap || wrap.querySelectorAll('.ward-pop').length > 12) return;
      var s = el('span', 'ward-pop' + (cls ? ' ' + cls : ''), text); s.style.left = (xd / 184 * 100) + '%'; s.style.top = (yd / W_H * 100) + '%';
      s.addEventListener('animationend', function () { s.remove(); }); wrap.appendChild(s);
    }
    /* 놓은 뒤의 일을 한곳에서: 그림 효과 · 뜨는 숫자 · 소리 · 차트가 끝났는지 */
    function wardLanded(r, slot) {
      var now = Date.now(), n = C.seatCount(state), xd = r.er ? W_GX + 24 : W_LEFT + (184 - W_LEFT) / n * (slot + 0.5), yd = r.er ? 74 : 38;
      if (r.er) wardErFx = { at: now, kind: r.cure ? 'cure' : 'dose', boost: !!r.boosted, dose: r.dose }; else wardFx[slot] = { at: now, kind: r.cure ? 'cure' : r.stop ? 'stop' : 'dose', boost: !!r.boosted };
      if (r.gain > 0) wardPop(xd, yd, (r.cure ? '되돌렸다 +' : '+') + fmt(r.gain), r.cure ? 'cure' : r.boosted ? 'boost' : '');
      else wardPop(xd, yd, r.dose + ' / ' + C.WARD_DOSES, r.boosted ? 'boost' : '');
      if (r.boost) { wardBoostFx = now; sfx('goal'); }      // 연구원이 강화 혈청을 들고 온다
      if (r.boosted) wardArmed = false;
      if (r.pick) log('급한 환자를 살렸다.', 'good');
      if (r.chart) { log('회진 차트를 끝냈다. 혈청 값이 올랐다.', 'good'); sfx('goal'); }
      sfx(r.cure ? 'signal' : r.stop ? 'buy' : 'click'); buzz(r.cure ? 30 : 10); Store.save(); render();
    }
    function serumNope() { var sb = $('serum-btn'); sb.classList.remove('nope'); void sb.offsetWidth; sb.classList.add('nope'); setTimeout(function () { sb.classList.remove('nope'); }, 350); }      // 혈청이 없다: 단추가 붉게 흔들린다
    /* 4.0.3 병실 그림: 사람을 누르면 한 대를 놓는다. 누른 자리(가로)로 가린다.
       4.0.8: 아래 복도(세로 88도트부터)는 이동 침대의 급한 환자. 강화 혈청을 들고 있으면(wardArmed) 누른 사람에게 그것을 놓는다 */
    $('labscene').addEventListener('click', function (e) {
      var cv = $('labscene'), rc = cv.getBoundingClientRect(), n = C.seatCount(state), w = C.wardOf(state);
      var x = (e.clientX - rc.left) / rc.width * 184, y = (e.clientY - rc.top) / rc.height * W_H, key = !(e.clientX > 0) && !(e.clientY > 0);
      if (!key && x < W_LEFT) { if (w.boost && y < 34) $('boost-btn').click(); else $('serum-btn').click(); return; }      // 그림 속 냉장 상자: 위 선반은 강화 혈청, 나머지는 혈청 만들기
      var onEr = !key && w.er && y >= 86, slot = key ? wardPick() : Math.max(0, Math.min(n - 1, Math.floor((x - W_LEFT) / ((184 - W_LEFT) / n))));
      var r = wardArmed && w.boost ? C.boostSeat(state, onEr ? 'er' : slot) : onEr ? C.injectEr(state) : C.injectSeat(state, slot);
      if (!r.ok) { if (r.reason === 'nostock') serumNope(); return; }
      wardLanded(r, slot);
    });
    $('boost-btn').addEventListener('click', function () { if (!C.wardOf(state).boost) return; wardArmed = !wardArmed; sfx('click'); render(); });
    $('er-pick-a').addEventListener('click', function () { pickEr(0); }); $('er-pick-b').addEventListener('click', function () { pickEr(1); });
    function pickEr(k) { var w = C.wardOf(state), id = w.pick && w.pick[k]; if (!id) return; var r = C.pickBoon(state, id); if (!r.ok) return; log(r.name + (C.hasBatchim(r.name) ? '을' : '를') + ' 골랐다.', 'good'); sfx('perk'); Store.save(); render(); }
    $('chart-easy').addEventListener('click', function () { if (C.nextChart(state, false).ok) { sfx('buy'); Store.save(); render(); } });
    $('chart-hard').addEventListener('click', function () { if (C.nextChart(state, true).ok) { sfx('buy'); Store.save(); render(); } });
    /* 4.0.4: 혈청은 그림 속 작은 상자가 아니라 그림 아래의 큰 단추로 만든다. 그림은 통째로 사람들 차지가 되어 한 사람의 누르는 자리가 넓어졌다 */
    $('serum-btn').addEventListener('click', function () {
      var tr = C.tapSerum(state);
      if (!tr.ok) return;
      sfx(tr.made ? 'buy' : 'click'); buzz(tr.made ? 15 : 6); if (tr.made) Store.save(); render();
    });
    // 6구역: 초소
    rows.post = buildRow({ id: 'post', name: '초소', desc: '다리에서 잡을 때 받는 통행 물자가 는다. 10·25·50곳마다 2배' }, function () { buy(C.buyPost(state, qtyFor(C.maxPosts(state), C.COUNT_MAX - state.posts)), 'defense'); });
    $('rows-z5').appendChild(rows.post.btn);
    // 4.1.0 6구역 줄: 초소(값) · 화력(한 발의 세기) · 사기(연속의 상한)
    rows.fire = buildRow({ id: 'fire', name: '화력', desc: '한 발이 더 세진다' }, function () { buy(C.buyFire(state), 'defense'); });
    rows.morale = buildRow({ id: 'morale', name: '사기', desc: '연속 배수가 더 높이 오른다' }, function () { buy(C.buyMorale(state), 'defense'); });
    $('rows-z5').appendChild(rows.fire.btn); $('rows-z5').appendChild(rows.morale.btn);
    /* 다리 그림: 누른 자리(가로)에서 가장 가까운 것을 쏜다. 깎은 만큼, 잡으면 얻은 만큼이 그 자리에 뜬다 */
    function bridgePop(xd, yd, text, cls) {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      var wrap = $('bridge-wrap'); if (!wrap || wrap.querySelectorAll('.ward-pop').length > 14) return;
      var s = el('span', 'ward-pop' + (cls ? ' ' + cls : ''), text); s.style.left = (xd / 184 * 100) + '%'; s.style.top = (yd / 108 * 100) + '%';
      s.addEventListener('animationend', function () { s.remove(); }); wrap.appendChild(s);
    }
    bridgePopFn = bridgePop;
    $('nade-btn').addEventListener('click', function () {
      var r = C.throwNade(state); if (!r.ok) return;
      var now = Date.now(); bridgeFlash = { at: now, kind: 'nade' };
      r.hits.forEach(function (h, i) { var hx = BR_X0 + Math.min(1, h.x) * BR_W; if (i % 2 === 0 || r.hits.length < 6) bridgeFx.push({ at: now + i * 15, x: hx, kind: 'boom' }); if (h.kill) bridgeFx.push({ at: now, x: hx, kind: 'kill', big: h.big, hand: true, quiet: true }); });
      if (bridgeFx.length > 60) bridgeFx = bridgeFx.slice(-60);
      if (r.gain > 0) bridgePop(110, 30, r.kills + '마리 +' + fmt(r.gain), 'held');
      sfx('rush'); buzz([30, 20, 60]); Store.save(); render();
    });
    $('bridgescene').addEventListener('click', function (e) {
      var cv = $('bridgescene'), rc = cv.getBoundingClientRect(), key = !(e.clientX > 0) && !(e.clientY > 0);
      var xd = (e.clientX - rc.left) / rc.width * 184, zx = Math.max(0, Math.min(1, (xd - BR_X0) / BR_W));
      var r = key ? C.shootBridge(state) : C.shootBridge(state, zx);
      if (!r.ok) { if (r.reason === 'jam') { var hr = $('heat-row'); hr.classList.remove('nope'); void hr.offsetWidth; hr.classList.add('nope'); } return; }
      if (r.jam) { bridgePop(40, 34, '과열', 'wave'); sfx('rush'); buzz(40); }
      var hx = BR_X0 + Math.min(1, r.x) * BR_W, now = Date.now();
      bridgeFx.push({ at: now, x: hx, kind: r.kill ? 'kill' : 'hit', big: r.big, hand: true }); if (bridgeFx.length > 60) bridgeFx.shift();
      (r.booms || []).forEach(function (bx6) { bridgeFx.push({ at: now, x: BR_X0 + Math.min(1, bx6) * BR_W, kind: 'boom' }); }); (r.also || []).forEach(function (a6) { bridgeFx.push({ at: now + 60, x: BR_X0 + Math.min(1, a6.x) * BR_W, kind: 'kill', big: a6.big, hand: true, quiet: true }); }); if (r.booms) { bridgeFlash = { at: now, kind: 'nade' }; sfx('rush'); buzz([20, 20, 40]); }
      if (r.kill) bridgePop(hx, r.big ? 30 : 38, '+' + fmt(r.gain), r.big ? 'big' : ''); else bridgePop(hx + 4, r.big ? 34 : 42, '-' + r.dmg, 'hit');
      sfx(r.kill ? (r.big ? 'signal' : 'buy') : 'click'); buzz(r.kill ? (r.big ? 30 : 12) : 5); if (r.kill) Store.save(); render();
    });
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
    renderStageBar(); applyLaraArt();
    panel.hidden = !!home; $('mnav-hub').hidden = !!home;      // 스테이지 중에는 모험 창을 열 수 없다
    if (!$('hub').hidden && hubTab === 'exped') renderStages();
    if (home) return;
          // 1.7.3: 모험 탭은 처음부터 보인다. 아직 못 고르는 도전은 잠긴 채로 보여서 앞으로 무엇이 있는지 알 수 있다
    var actNow = C.activeChallenge(state), mn = C.medalCount(state);
    setText($('hub-count'), '훈장 ' + mn + ' / ' + C.CHALLENGES.length);
    setText($('hub-hint'), actNow ? '도전 중 · ' + actNow.name + ' · ' + actNow.rule : any ? '도전을 고르면 조건을 걸고 목표 구역까지 가요.' : '첫 도전은 3구역에 닿으면 열려요.');
    if (!rows.chal) {
      rows.chal = {};
      C.CHALLENGES.forEach(function (d) {
        var b = el('button', 'chal'), side = el('span', 'chal-side'), name = el('b', '', d.name), sub = el('span', 'chal-sub');
        b.type = 'button'; b.appendChild(side); b.appendChild(name); b.appendChild(sub);
        b.addEventListener('click', function () { clickChallenge(d); });
        rows.chal[d.id] = { btn: b, side: side, sub: sub, name: name };
        $('chal-list').appendChild(b);
      });
    }
    var act = C.activeChallenge(state), n = C.medalCount(state);
    setText($('chal-count'), '훈장 ' + n + ' / ' + C.CHALLENGES.length + ' · 생산 +' + Math.round(n * C.MEDAL_BONUS * 100) + '%');
    setText($('chal-hint'), act ? '진행 중 · ' + act.name + ' · ' + act.rule + (act.id === 'oneshot' ? ' · 남은 시간 ' + clock(Math.max(0, C.ONESHOT_SECONDS - state.runSeconds)) : act.id === 'horde' ? ' · 방어 실패 ' + state.breaches + ' / ' + C.HORDE_BREACHES : act.id === 'sprint' ? ' · 남은 시간 ' + clock(Math.max(0, C.SPRINT_SECONDS - state.runSeconds)) : '')
      : '조건을 하나 걸고 목표 구역까지 가요. 처음 성공하면 훈장과 영구 보상을 받아요.' + (state.challengeStreak > 0 ? '\n연속 성공 ' + state.challengeStreak + '번 · 간식 +' + C.streakTreats(state) + ' (최대 +' + C.STREAK_TREATS_MAX + ')' : ''));
    C.CHALLENGES.forEach(function (d) {
      var r = rows.chal[d.id], open = C.challengeOpen(state, d.id), on = !!act && act.id === d.id, why = on ? '' : C.challengeBlock(state, d.id), won = state.medals[d.id] > 0;
      var mine = state.challenge && state.challenge.id === d.id ? (state.challenge.done ? '이번 회차 성공' : state.challenge.failed ? '이번 회차 실패' : '') : '';
      r.btn.classList.toggle('on', on); r.btn.classList.toggle('won', won);
      r.btn.disabled = !on && !!why;
      setText(r.side, on ? '진행 중' : won ? '훈장 ×' + state.medals[d.id] : open ? '' : '잠김');
      setText(r.name, open ? d.name : HID);
      setText(r.sub, !open ? C.challengeGoalText(d).replace(' 도착', '에 닿으면 열려요').replace('이야기의 끝', '이야기를 끝내면 열려요')
        : d.rule + ' · 목표 ' + C.challengeGoalText(d) + '\n' + (won ? '받은 보상 · ' : '보상 · ') + d.perk.text + (on ? ' · 누르면 포기' : mine ? ' · ' + mine : why && CHAL_WHY[why] ? '\n' + CHAL_WHY[why] : ''));
    });
  }
  /** 모험 창을 연다. 아래 탭과 상황 화면의 단추가 같이 쓴다. 스테이지 중에는 열지 않는다. */
  function openHub() { if (home) { toast('원정 중에는 열 수 없어요'); return; } $('hub').hidden = false; renderChallenges(); renderStages(); }
  var hubTab = 'chal', MARK_NAME = { clear: '클리어', speed: '스피드', hard: '하드', hardSpeed: '하드 스피드', safe: '무결', hardSafe: '하드 무결' };
  function setHubTab(t) {
    hubTab = t;
    Array.prototype.forEach.call(document.querySelectorAll('[data-hub]'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.hub === t)); });
    $('chal-panel').hidden = t !== 'chal'; $('stage-panel').hidden = t !== 'exped'; $('shop-panel').hidden = t !== 'shop';
    if (t === 'shop') renderShop();
  }
  /*
   * 원정 목록: 스테이지마다 한 칸. 규칙·목표·제한 시간과 얻은 표시(클리어·스피드·하드)를 적고, "출발"과 "하드" 단추를 둔다.
   */
  function renderStages() {
    var open = C.stagesOpen(state), tabBtn = document.querySelector('[data-hub="exped"]');
    tabBtn.disabled = false; setText(tabBtn, '원정');
    var all = C.stageMarkCount(state);
    setText($('stage-count'), open ? '별 ' + all.have + ' / ' + all.all + ' · 지역 휘장 ' + C.badgeCount(state) + ' / ' + C.REGIONS.length : '');
    setText($('stage-hint'), open ? '맨손으로 시작해요. 목표는 다녀올 때마다 바뀌어요.' : (C.STAGE_OPEN_ZONE + 1) + '구역에 닿으면 열려요.');
    if (!rows.stages) buildStageMap();
    // 고른 스테이지가 없으면: 아직 클리어하지 않은 것 가운데 맨 앞
    if (!stagePick || !rows.stages[stagePick]) { stagePick = C.STAGES[0].id; C.STAGES.some(function (d) { if (!C.stageMarks(state, d.id).clear) { stagePick = d.id; return true; } return false; }); }
    C.STAGES.forEach(function (d, i) {
      var r = rows.stages[d.id], m = C.stageMarks(state, d.id), why = C.stageBlock(state, d.id, false);
      setText(r.name, why ? HID : d.name);
      r.g.setAttribute('class', 'zm-node st-node' + (why ? ' locked' : '') + (m.clear ? ' won' : '') + (d.id === stagePick ? ' pick' : '') + (!why && !m.clear ? ' next' : ''));
      C.STAGE_STARS[stageHard ? 'hard' : 'normal'].forEach(function (k, n) { r.dots[n].setAttribute('class', 'st-dot' + (stageHard ? ' hd' : '') + (m[k] ? ' on' : '')); });      // 일반을 고르면 노란 별, 하드를 고르면 붉은 별
      if (i > 0) rows.stages[d.id].road.setAttribute('class', 'zm-road' + (C.stageMarks(state, C.STAGES[i - 1].id).clear ? ' zm-road-open' : ''));
    });
    var d = C.STAGES.filter(function (x) { return x.id === stagePick; })[0], m = C.stageMarks(state, d.id), why = C.stageBlock(state, d.id, false), idx = C.STAGES.indexOf(d);
    // 라라: 고른 표지에 서 있다. 다른 표지를 고르면 사이의 표지들을 차례로 거쳐 걸어간다
    if (rows.stageAt !== idx) {
      var sw = [], sf = rows.stageAt >= 0 ? rows.stageAt : idx, sd = idx > sf ? 1 : -1;
      for (var si = sf; si !== idx; si += sd) sw.push([STAGE_AT[si + sd][0] + 17, STAGE_AT[si + sd][1] + 4]);
      if (rows.stageAt < 0 || !sw.length) rows.stageLara.at(STAGE_AT[idx][0] + 17, STAGE_AT[idx][1] + 4); else rows.stageLara.walk(sw);
      rows.stageAt = idx;
    }
    setText($('stage-d-no'), d.boss ? '지역 보스' : '스테이지 ' + C.REGIONS[0].no + '-' + (idx + 1));
    setText($('stage-d-name'), why ? HID : d.name);
    $('stage-normal').hidden = !!why; $('stage-hard').hidden = !!why;      // 아직 못 여는 원정은 규칙도 목표도 보이지 않는다
    // 3.0.3: 일반 · 하드 칸. 고른 쪽의 규칙과 별 셋, 기록만 보인다. 하드를 아직 못 여는 원정에서는 일반으로 되돌린다
    var whyHard = C.stageBlock(state, d.id, true);
    if (stageHard && whyHard && !why) stageHard = false;
    var hardOn = stageHard, keys = C.STAGE_STARS[hardOn ? 'hard' : 'normal'], block = hardOn ? whyHard : why, gi = C.stageGoalIndex(state, d.id);
    $('stage-normal').setAttribute('aria-pressed', String(!hardOn)); $('stage-hard').setAttribute('aria-pressed', String(hardOn));
    $('stage-hard').disabled = !!whyHard && !hardOn;
    $('stage-go').parentElement.classList.toggle('hard', hardOn);
    var bonus = C.stageRetryBonus(state, d.id, false), starOf = function (ks) { return ks.map(function (k) { return m[k] ? '★' : '☆'; }).join(''); };
    setText($('stage-go'), hardOn ? '하드 출발' : bonus > 0 ? '출발 · 시작 물자 +' + fmt(bonus) : '출발');
    // 위: 이 원정이 무엇인지(일반 규칙이 없으면 그 줄은 적지 않는다). 아래 두 줄: 일반과 하드. 누르면 그쪽으로 고른다
    var baseRules = C.stageRuleTexts(d, false).join(', ');
    setText($('stage-d-sub'), why ? (why === 'prev' ? '앞 스테이지를 클리어하면 열려요' : (C.STAGE_OPEN_ZONE + 1) + '구역에 닿으면 열려요') : (baseRules ? baseRules + '\n' : '') + C.stageGoalText(d, hardOn, gi) + ' · 제한 ' + clock(d.limit)
      + (d.boss ? '\n보상 · 지역 휘장 · 전리품 +10%' : '') + (why === 'prev' ? '\n앞 스테이지를 클리어하면 열려요' : why === 'locked' ? '\n' + (C.STAGE_OPEN_ZONE + 1) + '구역에 닿으면 열려요' : ''));
    setText($('stage-n-info'), m.best ? '최고 ' + clock(m.best) : m.pct > 0 ? '가장 멀리 ' + Math.floor(m.pct * 100) + '%' : '');
    setText($('stage-h-info'), whyHard && !why ? HID + ' · 일반을 클리어하면 열려요' : C.STAGE_RULES[d.hard] + ' · 닫으면 처음부터');
    setText($('stage-n-stars'), starOf(C.STAGE_STARS.normal)); setText($('stage-h-stars'), starOf(C.STAGE_STARS.hard));
    // 별마다 조건을 붙여 적는다(고른 줄에서만 펼쳐진다)
    var safeText = function (n) { return n > 0 ? '방어 실패 ' + n + '번까지' : '방어 실패 없이'; };
    var STAR_HOW = { clear: '클리어', speed: clock(C.stageSpeed(d, false, gi)) + ' 안에', safe: safeText(C.stageSafe(d, false)), hard: '클리어', hardSpeed: clock(C.stageSpeed(d, true, gi)) + ' 안에', hardSafe: safeText(C.stageSafe(d, true)) };
    [['stage-n-how', C.STAGE_STARS.normal], ['stage-h-how', C.STAGE_STARS.hard]].forEach(function (pair) {
      var box = $(pair[0]), key = pair[1].map(function (k) { return k + (m[k] ? 1 : 0) + STAR_HOW[k]; }).join('|');
      if (box.getAttribute('data-key') === key) return;      // 바뀔 때만 다시 그린다
      box.setAttribute('data-key', key); box.textContent = '';
      pair[1].forEach(function (k) { var sp = el('span', m[k] ? 'got' : ''); sp.appendChild(el('b', '', m[k] ? '★' : '☆')); sp.appendChild(document.createTextNode(STAR_HOW[k])); box.appendChild(sp); });
    });
    $('stage-go').disabled = !!block;
  }
  /*
   * 원정 지도(1.8.1): 지역 I 하류 마을. 구역 지도와 같은 도트 그림으로, 길을 따라 스테이지 표지가 놓이고 끝에 선착장(보스)이 있다.
   *   표지를 누르면 아래 칸에 그 스테이지의 규칙·목표·표시가 뜬다. 표지 아래 점 셋은 얻은 표시(클리어·스피드·하드).
   */
  var stageHard = false;      // 원정 카드에서 고른 난이도(3.0.3)
  var stagePick = '', STAGE_AT = [[58, 266], [130, 236], [78, 184], [162, 158], [104, 102], [210, 76]], STAGE_VB = [320, 320];
  function buildStageMap() {
    var svg = svgEl('svg', { viewBox: '0 0 ' + STAGE_VB[0] + ' ' + STAGE_VB[1], 'class': 'zmap-svg st-svg', role: 'group', 'aria-label': '원정 지도' });
    function add(name, attrs, text) { var n = svgEl(name, attrs, text); svg.appendChild(n); return n; }
    function px(x, y, w, h, cls) { return add('rect', { x: x, y: y, width: w, height: h, 'class': cls }); }
    var seed = 23; function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    // 가장자리를 어둡게 누르는 그늘(지도가 화면에 떠 보이지 않게)
    var defs = add('defs', {}), vg = svgEl('radialGradient', { id: 'st-vg', cx: '45%', cy: '55%', r: '75%' });
    vg.appendChild(svgEl('stop', { offset: '55%', 'stop-color': '#000', 'stop-opacity': '0' })); vg.appendChild(svgEl('stop', { offset: '100%', 'stop-color': '#000', 'stop-opacity': '.55' })); defs.appendChild(vg);
    /* 1. 물: 깊은 강. 잔물결이 천천히 흐른다 */
    px(0, 0, 320, 320, 'st-water');
    for (var wv = 0; wv < 46; wv++) { var wx = 200 + Math.floor(rnd() * 120), wy = Math.floor(rnd() * 320); add('rect', { x: wx, y: wy, width: 5 + Math.floor(rnd() * 7), height: 1, 'class': 'st-wave' + (wv % 3 ? '' : ' st-wave2') }); }
    /* 2. 땅: 얕은 물 → 모래톱 → 풀밭 순서로 겹쳐서 물가가 살아 보이게 한다 */
    var LAND = 'M-10 330 L-10 52 C24 26 78 16 128 30 C168 41 198 26 236 46 C262 60 248 96 260 130 C274 172 300 204 292 252 C287 290 298 316 300 330 Z';
    add('path', { d: LAND, 'class': 'st-shallow' }); add('path', { d: LAND, 'class': 'st-sand' }); add('path', { d: LAND, 'class': 'st-land' });
    // 풀밭의 얼룩: 밝은 풀, 짙은 풀, 마른 흙
    function onLand(x, y) { return x > 4 && x < 226 + (y > 120 ? 30 : 0) + (y > 200 ? 26 : 0) - (y < 60 ? 110 - y * 1.6 : 0) && y > 40 && y < 316; }
    for (var gp = 0; gp < 130; gp++) { var gx = Math.floor(rnd() * 290), gy = 30 + Math.floor(rnd() * 290); if (onLand(gx, gy)) px(gx, gy, 3 + Math.floor(rnd() * 7), 2, gp % 4 === 0 ? 'zm-dirt' : gp % 2 ? 'zm-grass' : 'st-grass2'); }
    function near(x, y, d) { return STAGE_AT.some(function (p) { return Math.abs(p[0] - x) < d && Math.abs(p[1] - y) < d + 6; }); }
    /* 3. 숲: 나무를 흩뿌리지 않고 무리 지어 심는다 */
    function tree(x, y, big) { px(x - 1, y - 2, 2, 4, 'zm-trunk'); px(x - 4, y - 8, 8, 6, 'zm-tree2'); px(x - 3, y - 11, 6, 4, 'zm-tree'); px(x - 2, y - 12, 3, 2, 'zm-leaf'); if (big) px(x - 5, y - 5, 2, 3, 'zm-tree'); }
    [[22, 80, 9], [196, 206, 8], [34, 214, 6], [232, 268, 7], [150, 300, 6], [176, 104, 5], [30, 140, 5]].forEach(function (f) {
      for (var k = 0; k < f[2]; k++) { var fx = f[0] + Math.floor(rnd() * 44) - 22, fy = f[1] + Math.floor(rnd() * 34) - 17; if (onLand(fx, fy) && !near(fx, fy, 20)) tree(fx, fy, k % 3 === 0); }
    });
    /* 4. 표지 곁의 그림: 스테이지가 무엇을 하는 곳인지 그림으로 먼저 보인다 */
    function house(x, y, roof) { px(x, y - 8, 12, 8, 'st-wall'); px(x - 1, y - 12, 14, 4, roof); px(x + 2, y - 5, 3, 5, 'zm-win'); px(x + 7, y - 6, 3, 3, 'st-lit'); }
    // 1 첫 수색: 작은 집 몇 채와 잔해
    house(20, 262, 'st-roof'); house(34, 274, 'st-roof2'); px(22, 280, 7, 3, 'zm-ruin'); px(26, 277, 4, 3, 'zm-ruin');
    // 2 빈 골목: 다닥다닥 붙은 집과 가로등
    house(146, 222, 'st-roof2'); house(159, 222, 'st-roof'); house(172, 222, 'st-roof2'); px(187, 208, 1, 14, 'zm-ink'); px(185, 207, 4, 2, 'st-lit');
    // 3 급한 공사: 비계와 자재 더미
    px(40, 160, 1, 22, 'zm-ink'); px(54, 160, 1, 22, 'zm-ink'); px(40, 166, 15, 1, 'zm-ink'); px(40, 174, 15, 1, 'zm-ink'); px(38, 158, 24, 2, 'st-crane'); px(60, 158, 1, 8, 'zm-ink'); px(58, 166, 5, 4, 'st-crate');
    px(28, 190, 8, 4, 'st-crate'); px(31, 186, 6, 4, 'st-crate2');
    // 4 긴 밤: 망루와 철조망, 모닥불
    px(184, 130, 1, 24, 'zm-trunk'); px(192, 130, 1, 24, 'zm-trunk'); px(181, 124, 15, 7, 'st-wall'); px(180, 121, 17, 3, 'st-roof2'); px(186, 126, 4, 3, 'zm-win');
    for (var fw = 0; fw < 7; fw++) { px(176 + fw * 6, 170, 1, 5, 'zm-ink'); } px(176, 171, 37, 1, 'zm-ink'); px(140, 176, 4, 2, 'zm-trunk'); px(141, 173, 2, 3, 'st-fire');
    // 5 빠듯한 살림: 창고와 밭고랑
    px(60, 78, 22, 12, 'st-wall'); px(58, 74, 26, 4, 'st-roof'); px(68, 82, 6, 8, 'zm-win'); px(84, 84, 5, 5, 'st-crate'); px(86, 80, 4, 4, 'st-crate2');
    for (var fr = 0; fr < 5; fr++) px(124, 84 + fr * 5, 28, 2, fr % 2 ? 'st-field' : 'st-field2');
    // 보스 선착장: 물 위로 뻗은 부두, 묶인 배, 깜박이는 등대
    for (var pl = 0; pl < 9; pl++) px(226 + pl * 5, 74, 4, 6, pl % 2 ? 'zm-plank' : 'zm-plank2');
    px(232, 80, 1, 6, 'zm-trunk'); px(252, 80, 1, 6, 'zm-trunk'); px(266, 80, 1, 6, 'zm-trunk');
    px(272, 86, 18, 5, 'zm-plank2'); px(275, 82, 10, 4, 'zm-car'); px(280, 70, 1, 12, 'zm-ink'); px(281, 71, 6, 5, 'st-sail');
    px(238, 30, 8, 22, 'st-tower'); px(238, 36, 8, 4, 'st-roof'); px(238, 44, 8, 4, 'st-roof'); px(236, 26, 12, 4, 'zm-ink'); px(239, 21, 6, 5, 'st-lamp');
    add('path', { d: 'M245 23 L300 6 L300 40 Z', 'class': 'st-beam' });
    /* 5. 지역 이름표와, 강 건너의 아직 열리지 않은 땅 */
    add('rect', { x: 8, y: 8, width: 96, height: 30, rx: 4, 'class': 'st-plate' });
    add('text', { x: 16, y: 20, 'class': 'st-plate-s' }, '지역 I');
    add('text', { x: 16, y: 32, 'class': 'st-plate-b' }, '하류 마을');
    add('text', { x: 306, y: 312, 'text-anchor': 'end', 'class': 'st-soon' }, '강 건너는 준비 중');
    add('rect', { x: 0, y: 0, width: 320, height: 320, fill: 'url(#st-vg)', 'pointer-events': 'none' });
    rows.stages = {};
    // 길 먼저(표지 아래에 깔리게), 그다음 표지
    C.STAGES.forEach(function (d, i) { if (i) add('line', { x1: STAGE_AT[i - 1][0], y1: STAGE_AT[i - 1][1], x2: STAGE_AT[i][0], y2: STAGE_AT[i][1], 'class': 'st-road-bed' }); });      // 길의 테두리
    var roads = C.STAGES.map(function (d, i) { return i ? add('line', { x1: STAGE_AT[i - 1][0], y1: STAGE_AT[i - 1][1], x2: STAGE_AT[i][0], y2: STAGE_AT[i][1], 'class': 'zm-road' }) : null; });
    C.STAGES.forEach(function (d, i) {
      var x = STAGE_AT[i][0], y = STAGE_AT[i][1], g = svgEl('g', { 'class': 'zm-node st-node', tabindex: '0', role: 'button', 'aria-label': d.name });
      function r(dx, dy, w, h, cls) { var n = svgEl('rect', { x: x + dx, y: y + dy, width: w, height: h, 'class': cls }); g.appendChild(n); return n; }
      r(-26, -26, 52, 60, 'zm-hit');
      var rad = d.boss ? 14 : 11;
      g.appendChild(svgEl('ellipse', { cx: x, cy: y + rad - 1, rx: rad + 2, ry: 4, 'class': 'st-shadow' }));
      g.appendChild(svgEl('circle', { cx: x, cy: y, r: rad + 4, 'class': 'st-halo' }));
      g.appendChild(svgEl('circle', { cx: x, cy: y, r: rad, 'class': 'st-pad' + (d.boss ? ' boss' : '') }));
      if (d.boss) { r(-6, -8, 12, 9, 'st-skull'); r(-4, -5, 3, 3, 'st-eye'); r(1, -5, 3, 3, 'st-eye'); r(-4, 1, 8, 4, 'st-skull'); r(-2, 2, 1, 3, 'st-eye'); r(1, 2, 1, 3, 'st-eye'); }
      else g.appendChild(svgEl('text', { x: x, y: y + 4.5, 'text-anchor': 'middle', 'class': 'st-num' }, String(i + 1)));
      var dots = [0, 1, 2].map(function (n) { var c = svgEl('circle', { cx: x - 7 + n * 7, cy: y - rad - 6, r: 2.6, 'class': 'st-dot' }); g.appendChild(c); return c; });      // 3.1.0: 별 셋은 숫자 위에. 카드에서 고른 쪽(일반 · 하드)의 별을 보여 준다
      var nameEl = svgEl('text', { x: x, y: y + rad + 14, 'text-anchor': 'middle', 'class': 'zm-name st-name' }, d.name); g.appendChild(nameEl);
      function pick() { stagePick = d.id; sfx('tab'); renderStages(); }
      g.addEventListener('click', pick);
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      svg.appendChild(g);
      rows.stages[d.id] = { g: g, dots: dots, road: roads[i], name: nameEl };
    });
    $('stage-map').appendChild(svg);
    rows.stageLara = mapLara($('stage-map'), STAGE_VB[0], STAGE_VB[1]); rows.stageAt = -1;
    $('stage-go').addEventListener('click', function () { var d = C.STAGES.filter(function (x) { return x.id === stagePick; })[0]; if (d) askStage(d, stageHard); });
    $('stage-normal').addEventListener('click', function () { stageHard = false; sfx('tab'); renderStages(); });
    $('stage-hard').addEventListener('click', function () { stageHard = true; sfx('tab'); renderStages(); });
  }
  /*
   * 상점(1.9.0): 뽑기와 옷장.
   *   뽑기   : 뽑기권 한 장에 외형 하나. 확률은 "확률 보기"에 등급별·품목별로 모두 적는다(코어의 gachaTable 그대로). 전설 보장까지 남은 횟수도 적는다.
   *   옷장   : 가진 것은 눌러서 입는다. 없는 것은 조각이 모이면 눌러서 얻는다.
   */
  var oddsOpen = false, SLOT_NAME = { coat: '우비 색', hood: '후드', pat: '무늬', bag: '가방', fx: '효과', pet: '친구 옷', flag: '깃발 · 도전과 원정의 보상' };
  function renderShop() {
    if (home) return;
    var shopBtn = document.querySelector('[data-hub="shop"]'); shopBtn.disabled = false; setText(shopBtn, '상점');
    setText($('shop-count'), '뽑기권 ' + state.tickets + '장 · 조각 ' + state.shards + '개 · 간식 ' + fmt(state.treats) + '개');
    setText($('shop-pity'), '전설 보장까지 ' + C.gachaPityLeft(state) + '번\n이미 가진 것이 나오면 조각으로 바뀌어요');
    $('gacha-pull').disabled = !(state.tickets >= 1);
    setText($('gacha-pull'), '뽑기 · 뽑기권 1장');
    $('ticket-buy').disabled = !(state.treats >= C.TICKET_TREATS);
    setText($('ticket-buy'), '뽑기권 사기 · 간식 ' + C.TICKET_TREATS + '개');
    setText($('odds-toggle'), oddsOpen ? '확률 접기' : '확률 보기');
    $('odds').hidden = !oddsOpen;
    if (oddsOpen && !$('odds').firstChild) {
      var table = C.gachaTable();
      C.RARITIES.forEach(function (rn, ri) {
        var items = table.filter(function (t) { return t.rarity === ri; });
        $('odds').appendChild(el('div', 'odds-head', rn + ' · 합계 ' + (C.GACHA_ODDS[ri] * 100).toFixed(0) + '% · 하나에 ' + items[0].pct.toFixed(2) + '%'));
        $('odds').appendChild(el('div', 'odds-items', items.map(function (t) { return t.name; }).join(', ')));
      });
      $('odds').appendChild(el('div', 'odds-items', C.GACHA_PITY + '번 안에 전설이 한 번은 나와요. 전설이 나오면 다시 세요.'));
    }
    if (!rows.shop) {
      rows.shop = {};
      C.COS_SLOTS.forEach(function (slot) {
        $('wardrobe').appendChild(el('div', 'label', SLOT_NAME[slot]));
        var grid = el('div', 'cos-grid'); $('wardrobe').appendChild(grid);
        C.COSMETICS.filter(function (c) { return c.slot === slot; }).forEach(function (c) {
          var b = el('button', 'cos'), cv = document.createElement('canvas'), name = el('b', '', c.name), sub = el('span', 'cos-sub');
          b.type = 'button'; cv.className = 'cos-pic'; cv.width = 28; cv.height = 40;
          b.appendChild(cv); b.appendChild(name); b.appendChild(sub);
          b.addEventListener('click', function () { clickCosmetic(c); });
          rows.shop[c.id] = { btn: b, sub: sub, cv: cv, def: c };
          grid.appendChild(b);
        });
      });
      $('look-act').addEventListener('click', function () {
        var c = C.COSMETICS.filter(function (x) { return x.id === lookPick; })[0];
        if (!c || C.ownsCosmetic(state, c.id)) return;
        confirmBox(c.name, '조각 ' + C.SHARDS_COST[c.rarity] + '개로 ' + c.name + (C.hasBatchim(c.name) ? '을' : '를') + ' 얻어요.', '그만둔다', '얻는다', function () {
          var r = C.craftCosmetic(state, c.id);
          if (r.ok) { C.wearCosmetic(state, c.id); lookPick = ''; log(r.name + (C.hasBatchim(r.name) ? '을' : '를') + ' 얻었다.', 'good'); sfx('goal'); Store.save(); renderShop(); }
        });
      });
    }
    var worn = C.cosmeticLook(state);
    C.COSMETICS.forEach(function (c) {
      var r = rows.shop[c.id], own = C.ownsCosmetic(state, c.id), on = state.wear[c.slot] === c.id, cost = C.SHARDS_COST[c.rarity];
      r.btn.className = 'cos r' + c.rarity + (own ? ' own' : ' not') + (on ? ' on' : '') + (lookPick === c.id ? ' pick' : '');
      var how = c.reward ? (C.FLAG_REWARDS.filter(function (f) { return f.id === c.id; })[0] || { text: '' }).text : C.RARITIES[c.rarity] + ' · 조각 ' + cost;
      setText(r.sub, on ? '입는 중' : own ? (c.base ? '기본' : C.RARITIES[c.rarity]) : how);
      // 작은 그림: 지금 입은 모습에 이 외형 하나만 바꿔 입힌 라라(깃발은 깃대)
      var key = JSON.stringify(worn) + c.id + (c.slot === 'pet' ? JSON.stringify(petLook()) : '');
      if (r.key !== key) { r.key = key; drawThumb(r.cv, c, worn); }
    });
    // 미리 보기: 지금 입은 모습. 아직 없는 외형을 눌렀으면 그것을 입혀서 보여 준다
    var pc = lookPick ? C.COSMETICS.filter(function (x) { return x.id === lookPick; })[0] : null;
    if (pc && C.ownsCosmetic(state, pc.id)) { pc = null; lookPick = ''; }
    lookNow = lookWith(worn, pc);
    drawLookScene($('look-pic'), lookNow, lookFrame);
    if (!lookTimer) lookTimer = setInterval(function () {      // 미리 보기의 라라는 제자리걸음을 하고 깃발은 펄럭인다(상점을 보고 있을 때만 그린다)
      if ($('hub').hidden || hubTab !== 'shop' || !lookNow) return;
      lookFrame = (lookFrame + 1) % 240; drawLookScene($('look-pic'), lookNow, lookFrame);
    }, 130);
    setText($('look-name'), pc ? '미리 보기 · ' + pc.name : '현재 입은 모습');
    $('look-act').hidden = !pc;
    if (pc) { var pcost = C.SHARDS_COST[pc.rarity]; $('look-act').disabled = !(state.shards >= pcost); setText($('look-act'), state.shards >= pcost ? '조각 ' + pcost + '개로 얻기' : pc.reward ? '조각 ' + pcost + '개 필요' : '조각 ' + pcost + '개 필요 · 뽑기로도 나와요'); }
  }
  /*
   * 외형 그림(2.0.0): 게임 화면과 같은 라라(Scene.drawHero)를 그대로 쓴다. 옷장에서 본 모습과 게임 속 모습이 같다.
   *   lookWith  : 입은 모습에 외형 하나를 바꿔 입힌 모습
   *   drawThumb : 목록의 작은 그림(2배). 깃발은 깃대와 깃발만.
   *   drawLookScene : 위쪽의 큰 미리 보기. 거점 앞에 선 라라(3배)가 제자리걸음을 하고, 옥상의 깃발이 펄럭인다.
   */
  var lookPick = '', lookNow = null, lookFrame = 0, lookTimer = 0;
  /*
   * 라라가 나오는 모든 곳에 입은 외형을 입힌다(2.0.2): 제목 옆, 지도 위, 이야기 창, 자리 비움 창, 시작 화면.
   *   이 그림들은 CSS 변수 --art-boy 하나를 같이 쓴다. 입은 모습을 작은 캔버스에 그려 그 변수에 넣으면 한꺼번에 바뀐다.
   *   같은 모습이면 다시 만들지 않는다. 캔버스를 못 쓰는 환경이면 원래 그림(노란 우비)이 그대로 남는다.
   */
  var laraArtKey = '';
  function applyLaraArt() {
    try {
      var S = window.Scene, look = C.cosmeticLook(mainState()), key = JSON.stringify(look);
      if (!S || !S.drawHero || key === laraArtKey) return;
      var cv = document.createElement('canvas'), k = 4; cv.width = S.LARA_W * k; cv.height = S.LARA_H * k;
      var ctx = cv.getContext('2d'); if (!ctx) return;
      S.drawHero(ctx, 0, 0, k, { coat: look.coat, hood: look.hood, pat: look.pat, bag: look.bag, fx: 'none' });      // 움직이는 효과는 정지 그림에 넣지 않는다
      document.documentElement.style.setProperty('--art-boy', 'url("' + cv.toDataURL('image/png') + '")');
      laraArtKey = key;
    } catch (e) { console.warn('laraArt', e); }
  }
  function lookWith(worn, c) { var o = {}; for (var k in worn) if (Object.prototype.hasOwnProperty.call(worn, k)) o[k] = worn[k]; if (c) o[c.slot] = c.look; return o; }
  function shade(hex, k) { var n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; function c(v) { return Math.max(0, Math.min(255, Math.round(v * k))); } return 'rgb(' + c(r) + ',' + c(g) + ',' + c(b) + ')'; }
  /** 옷장에 그릴 친구: 지금 데리고 있는 친구. 없으면 기본 누렁이(옷이 어떻게 보이는지는 알 수 있게). */
  function petLook() { var p = C.petInfo(mainState()); return p ? { kind: p.kind, body: p.breed.body, patch: p.breed.patch } : { kind: 'dog', body: '#b8864a', patch: '#e6d2a8' }; }
  function drawThumb(cv, c, worn) {
    var ctx = cv && cv.getContext ? cv.getContext('2d') : null; if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (c.slot === 'flag') { ctx.fillStyle = '#cfcebf'; ctx.fillRect(6, 6, 2, 30); if (window.Scene && window.Scene.drawFlag) window.Scene.drawFlag(ctx, c.look, 8, 6, 3, 0, 0); return; }
    if (c.slot === 'pet') { if (window.Scene && window.Scene.paintPet) window.Scene.paintPet(ctx, 4, 16, 2, false, petLook(), c.look, 0); return; }      // 친구 옷: 데리고 있는 친구(없으면 누렁이)에게 입혀 보인다
    var look = lookWith(c.slot === 'fx' ? worn : { coat: worn.coat, hood: 'none', pat: 'none', bag: 'cooler', fx: 'none' }, c);
    if (c.slot !== 'coat' && c.slot !== 'fx') look.coat = worn.coat;
    if (window.Scene && window.Scene.drawHero) window.Scene.drawHero(ctx, 0, 2, 2, look, undefined, 0.65, look.fx === 'glow' ? 1 : 0);
  }
  function drawLookScene(cv, look, frame) {
    var ctx = cv && cv.getContext ? cv.getContext('2d') : null; if (!ctx) return;
    var W = cv.width, H = cv.height, G = H - 6, flag = look.flag || '#f0b400', t = frame * 0.13, S0 = window.Scene;
    function r(col, x, y, w, h) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); }
    // 밤에 빛나는 것(야광 효과, 야광 깃발)을 보고 있으면 밤 장면으로 그린다: 낮에는 빛이 잘 안 보인다
    var night = look.fx === 'glow' || flag === 'glow';
    // 하늘과 먼 건물
    if (night) { r('#141a30', 0, 0, W, 24); r('#1c2440', 0, 24, W, G - 24); [[20, 6], [58, 12], [88, 4], [120, 9], [150, 5], [40, 20], [104, 18]].forEach(function (s) { r('#e6e5db', s[0], s[1], 1, 1); }); r('#e6e5db', 140, 10, 5, 5); r('#141a30', 142, 10, 3, 3); }
    else { r('#a9c4c2', 0, 0, W, 20); r('#c4cfb8', 0, 20, W, 16); r('#d8d0a8', 0, 36, W, G - 36); }
    [[92, 14, 14], [110, 6, 11], [126, 20, 16], [146, 12, 12]].forEach(function (b) { r(night ? '#232b45' : '#8fa5a2', b[0], G - 46 + b[1], b[2], 46 - b[1]); r(night ? '#2d3757' : '#7d9491', b[0] + 2, G - 42 + b[1], 3, 3); });
    // 땅과 길
    r(night ? '#2a2a24' : '#6f6a55', 0, G, W, H - G); r(night ? '#1f1f1a' : '#5d5947', 0, G, W, 1); for (var d = 6; d < W; d += 18) r(night ? '#45443a' : '#8f8a70', d, G + 3, 8, 1);
    // 거점: 콘크리트 본관, 창, 옥상 난간, 깃대와 깃발
    r(night ? '#3f3d38' : '#8f8a78', 6, G - 34, 48, 34); r(night ? '#35332f' : '#7a7566', 6, G - 34, 48, 3); r(night ? '#2c2a27' : '#6b6759', 51, G - 34, 3, 34);
    for (var wx = 0; wx < 3; wx++) { r(wx === 1 ? '#ffe9a0' : '#3f4a50', 12 + wx * 13, G - 27, 8, 7); r('#3f4a50', 12 + wx * 13, G - 15, 8, 6); }
    r('#4a4035', 26, G - 11, 9, 11); for (var rl = 0; rl < 9; rl++) r('#3c3a34', 6 + rl * 6, G - 38, 1, 4); r('#3c3a34', 6, G - 38, 48, 1);
    r('#cfcebf', 14, G - 58, 2, 24);
    if (S0 && S0.drawFlag) S0.drawFlag(ctx, flag, 16, G - 58, 3, night ? 0.9 : 0, t);
    // 모래주머니
    r(night ? '#4a4638' : '#a39a78', 130, G - 6, 11, 6); r(night ? '#403d31' : '#8f8767', 141, G - 6, 11, 6); r(night ? '#4a4638' : '#a39a78', 136, G - 12, 11, 6);
    // 라라: 3배 크기로, 제자리걸음
    var step = Math.floor(t * 4) % 2, S = window.Scene;
    r('rgba(0,0,0,.25)', 78, G, 30, 2);
    if (S && S.drawHero) S.drawHero(ctx, 70, G - S.LARA_H * 3 - (step ? 1 : 0), 3, look, step, t, night ? 1 : 0);
    if (S && S.paintPet) S.paintPet(ctx, 114, G - S.PET_H * 3, 3, false, petLook(), look.pet || 'none', t);      // 친구는 라라 곁에
  }
  function clickCosmetic(c) {
    if (C.ownsCosmetic(state, c.id)) { lookPick = ''; if (C.wearCosmetic(state, c.id).ok) { sfx('tab'); Store.save(); applyLaraArt(); renderShop(); } return; }
    lookPick = lookPick === c.id ? '' : c.id; sfx('tab'); renderShop();      // 아직 없는 외형: 입혀서 미리 보여 준다(다시 누르면 원래대로)
  }
  function doPull() {
    var r = C.pullGacha(state);
    if (!r.ok) return;
    var rn = C.RARITIES[r.rarity];
    log('뽑기: ' + rn + ' · ' + r.name + (r.dup ? ' (이미 있어서 조각 ' + r.shards + '개)' : '') + '.', r.rarity ? 'good' : '');
    sfx(r.rarity === 2 ? 'goal' : 'buy'); if (r.rarity === 2) { buzz([30, 40, 30]); if (fxShow) fxShow('전설', r.name + (r.dup ? ' · 조각 +' + r.shards : ''), 1, -1, -1); }      // 전설은 화면 효과와 함께
    setText($('gacha-result'), rn + ' · ' + r.name + (r.dup ? ' · 이미 있어요 · 조각 +' + r.shards : ' · 새 외형!') + (r.pity ? ' · 보장' : ''));
    $('gacha-result').className = 'gacha-result r' + r.rarity; void $('gacha-result').offsetWidth; $('gacha-result').classList.add('gacha-in');      // 'pop'·'show' 는 다른 곳(떠오르는 숫자, 알림)에서 쓰는 이름이라 피한다
    Store.save(); renderShop();
  }
  function askStage(d, hard) {
    if (home || C.stageBlock(state, d.id, hard)) return;
    confirmBox((d.boss ? '보스 · ' : '원정 · ') + d.name + (hard ? ' · 하드' : ''), '규칙 · ' + (C.stageRuleTexts(d, hard).join(', ') || '없음') + '\n목표 · ' + C.stageGoalText(d, hard, C.stageGoalIndex(state, d.id)) + '\n제한 시간 · ' + clock(d.limit) + '\n\n도중에 창을 닫으면 원정은 사라져요.', '그만둔다', '출발한다', function () { enterStage(d, hard); });
  }
  function enterStage(d, hard) {
    if (home) return;
    var st = C.createStage(state, d.id, hard, Date.now());
    if (!st) return;
    Store.save();      // 본 게임을 지금 시각으로 저장해 둔다: 도중에 창이 닫혀도 여기서부터 정산된다
    home = state; stageEnter = Date.now(); state = st;
    $('hub').hidden = true; tab = 'z0'; pane = 'play'; perkShown = '';
    log('원정 〈' + d.name + '〉에 나섰다. ' + C.stageGoalText(d, hard, C.stageGoalIndex(home, d.id)) + '.', 'good');
    sfx('relocate'); if (fxShow) fxShow('원정', d.name + (hard ? ' · 하드' : ''), 1, 0, -1);
    goTo('manage'); render();
  }
  /** 스테이지를 끝내고 본 게임으로 돌아간다. giveUp 이면 결과를 적지 않는다. */
  function endStage(giveUp) {
    if (!home) return;
    var st = state, def = C.stageDef(st), res = C.finishStage(home, st);      // 3.0.2: 포기해도 간 만큼의 기록과 구간 간식은 남는다
    var away = Math.max(0, (Date.now() - stageEnter) / 1000);
    state = home; home = null;
    var rep = C.applyOffline(state, away);      // 스테이지를 하는 동안 본 게임은 자리 비움처럼 돌았다
    tab = 'z' + state.zone; perkShown = '';
    if (res.won) {
      var gotText = res.got.map(function (k) { return MARK_NAME[k]; }).join(', ');
      log('원정 〈' + def.name + '〉 클리어. ' + clock(res.seconds) + '.' + (gotText ? ' 새 별: ' + gotText + '. 간식 ' + res.treats + '개.' : '') + (res.badge ? ' 지역 휘장을 받았다.' : ''), 'good');
      toast('원정 클리어 · ' + def.name + (gotText ? ' · ' + gotText : '') + (res.treats ? ' · 간식 +' + res.treats : '')); sfx('goal');
      if (res.tickets) log('뽑기권 ' + res.tickets + '장을 받았다.', 'good');
      if (res.flags && res.flags.length) { log(res.flags.join(', ') + (C.hasBatchim(res.flags[res.flags.length - 1]) ? '을' : '를') + ' 받았다. 옷장에서 달 수 있다.', 'good'); toast('새 깃발 · ' + res.flags.join(', ')); }
      if (fxShow) fxShow('클리어', def.name + (res.badge ? ' · 지역 휘장' : gotText ? ' · ' + gotText : ''), 1, -1, -1);
    } else {
      // 3.0.2: 실패해도 흔적이 남는다. 어디까지 갔는지, 왜 못 끝냈는지, 무엇을 받았는지, 다음에는 무엇이 달라지는지
      var pctText = Math.floor((res.pct || 0) * 100) + '%', whyText = res.why === 'breach' ? '방어 실패 ' + res.breaches + '번' : '시간이 모자랐어요';
      var extra = (res.record && res.pct > 0 ? ' 최고 기록.' : '') + (res.stepTreats ? ' 간식 ' + res.stepTreats + '개.' : '');
      log('원정 〈' + def.name + '〉' + (res.why === 'quit' ? '에서 돌아왔다. 목표의 ' + pctText + '까지 갔다.' : ' 실패. ' + (res.why === 'breach' ? '방어 실패가 ' + res.breaches + '번 있었다.' : '시간이 다 됐다.') + ' 목표의 ' + pctText + '까지 갔다.') + extra, res.why === 'quit' ? '' : 'bad');
      if (res.why !== 'quit') {
        toast('원정 실패 · ' + whyText + ' · 목표의 ' + pctText + (res.record ? ' · 최고 기록' : '') + (res.stepTreats ? ' · 간식 +' + res.stepTreats : ''));
        if (res.retry > 0 && !st.stage.hard) toast('다시 도전하면 시작 물자 +' + fmt(res.retry));
        sfx('breached'); if (fxShow) fxShow('원정 실패', def.name + ' · ' + pctText + (res.record ? ' · 최고 기록' : ''), -1, -1, -1);
      } else if (res.stepTreats) toast('원정 · 목표의 ' + pctText + ' · 간식 +' + res.stepTreats);
    }
    if (rep && rep.gain > 0) log('그동안 거점은 물자 ' + fmt(rep.gain) + '을 벌었다.', '');
    Store.save(); Cloud.flush();
    var nb = document.querySelector('[data-mview-set="base"]'); if (nb) nb.click();      // 상황 화면으로
    render();
  }
  /** 스테이지 중에 화면 맨 위를 덮는 띠: 목표, 남은 시간, 그만두기. */
  function renderStageBar() {
    var bar = $('stage-bar'), stt = home ? C.stageStatus(state) : null;
    bar.hidden = !stt; document.body.classList.toggle('in-stage', !!stt);
    if (!stt) return;
    setText($('stage-bar-name'), stt.def.name + (stt.hard ? ' · 하드' : ''));
    var goalWord = { earn: '물자', build: '시설', nights: '막은 밤', sweep: '수색' }[stt.goal] || '';      // 한 줄에 들어가게 목표는 낱말 하나로
    setText($('stage-bar-goal'), goalWord + ' ' + (stt.goal === 'earn' ? fmt(stt.value) : Math.floor(stt.value)) + ' / ' + (stt.goal === 'earn' ? fmt(stt.need) : stt.need));
    setText($('stage-bar-time'), clock(stt.left));
    $('stage-bar-time').classList.toggle('low', stt.left <= 60);
    $('stage-bar-fill').style.width = Math.min(100, stt.value / stt.need * 100).toFixed(1) + '%';
  }
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
      if (p.locked) card.appendChild(el('p', 'ach-lock', '철수를 ' + p.retreats + '번 한 뒤에 달성할 수 있어요(현재 ' + state.retreats + '번).'));
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
    ['전체', [['lifetime', '모은 물자'], ['retreats', '철수'], ['clicks', '직접 수색'], ['play', '켜 둔 시간'], ['away', '자리 비운 시간'], ['days', '시작한 지']]],
    ['이야기의 끝', [['ended', '끝을 본 횟수'], ['bestDanger', '가장 높은 위험 단계'], ['fastest', '가장 빨리 끝낸 회차'], ['rescued', '구조한 생존자']]]      // 2.1.0
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
    var ms = mainState();
    setText(c.ended, (ms.ended || 0) + '번'); setText(c.bestDanger, (ms.ended || 0) >= 1 ? '위험 ' + (ms.bestDanger || 0) : '-');
    setText(c.fastest, ms.bests && ms.bests.time > 0 ? d(ms.bests.time) : '-'); setText(c.rescued, fmt(Math.floor(ms.rescued || 0)) + '명 · 생산 +' + Math.round((C.rescueMult(ms) - 1) * 100) + '%');
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
    // 3.3.0 합치기 판: 칸 스무 개를 만들고, 누르면 같은 단계의 가까운 상자와 합친다
    var mb = $('mboard');
    for (var bi = 0; bi < C.BOARD_MAX; bi++) (function (i) {
      var b = el('button'); b.type = 'button'; b.dataset.box = i; mb.appendChild(b);
      b.addEventListener('click', function () {
        var res = C.mergeBox(state, i);
        if (!res.ok) return;
        // 3.6.0: 같은 단계의 짝이 모두 합쳐진다. 누른 칸부터 차례로(60ms 간격) 튀어 오르게 해서 주루룩 번지는 것이 보이게 한다
        res.merges.forEach(function (m, k) { boardFx[m.at] = { pop: true, gain: m.gain, delay: Math.min(k, 12) * 60 }; });
        if (res.best && res.level >= 4) log(C.boxName(res.level) + ' 상자가 처음 나왔다.', 'good');
        sfx(res.best ? 'goal' : res.count >= 4 ? 'upgrade' : 'buy'); buzz(res.best ? 30 : Math.min(40, 10 + res.count * 4)); Store.save(); render();
      });
    })(bi);
    $('truck-load').addEventListener('click', function () {
      var res = C.loadTruck(state, false);
      if (!res.ok) return;
      log('트럭에 실어 보냈다. 물자 ' + fmt(res.gain) + ' 확보.', 'good'); sfx('train'); buzz(25); Store.save(); render();
    });
  }
  /*
   * 3.3.0 합치기 판을 그린다. 칸마다 상자 이름과 그 상자가 초당 버는 양을 적고, 지금 합칠 수 있는 짝에는 노란 테두리를 친다.
   * boardFx: 방금 일어난 일(합쳐짐 pop, 새로 들어옴 in, 덤 gain)을 칸 번호로 적어 두었다가 한 번 보여 주고 지운다.
   */
  var boardFx = {}, boardSeen = null;
  /*
   * 5구역 시험관 그림(3.9.2). 칸 하나에 16×30 도트: 유리관, 단계에 따라 차오르고 색이 변하는 약, 아래의 불꽃.
   *   1 붉음 → 2 주홍 → 3 주황 → 4 노랑 → 5 금빛(절정, 반짝임) → 6 탔다(검은 찌꺼기와 연기, 불은 꺼져 있다).
   */
  /*
   * 5구역 병실 그림(4.0.3). 184×108 도트 한 장.
   *   왼쪽: 혈청 냉장 상자(남은 혈청이 주사기로 보인다). 가운데: 의자에 앉은 사람들. 사람마다 머리 위에 '변하는 줄'과 '맞은 대수 여섯 칸'.
   *   살갗은 변할수록 잿빛 · 초록으로 바뀐다. 한 대를 맞으면 줄이 파랗게 멈춘다. 여섯 대를 채우면 금빛으로 빛나며 일어선다.
   *   한 대도 못 맞고 변하면 그 사람이 화면 앞으로 달려든다(잠깐 아무것도 누를 수 없다).
   */
  var wardFx = {}, wardBox = 0, wardLunge = null, wardBack = null, wardFace = null;
  var W_HAIR = ['#3a3a36', '#6b4a3a', '#17180f', '#8a6248', '#55564e'], W_SHIRT = ['#6b4a3a', '#3f5f7a', '#8a8a52', '#d8644e', '#55585f', '#7a5a8a'], W_SKIN = ['#f0d8b8', '#e0d0aa', '#c8c8a0', '#a8b890', '#8ab070'];
  var W_BODY = ['..hhhhhh..', '.hhhhhhhh.', '.hssssssh.', '.sesssses.', '.ssssssss.', '..ssmmss..', '...ssss...', '.cccccccc.', 'cccccccccc', 'acccccccca', 'acccccccca', 'acccccccca', '.pppppppp.', '.ppp..ppp.', '.ppp..ppp.', '.ppp..ppp.', '.kkk..kkk.'];
  /** 자판으로 누를 때: 가장 급한 사람(한 대도 못 맞은 사람 가운데 줄이 가장 찬 사람), 없으면 가장 많이 맞은 사람. */
  function wardPick() { var w = C.wardOf(state), best = 0, score = -1; w.seats.forEach(function (p, i) { var sc = !(p.dose >= 0) ? -1 : p.dose === 0 ? 10 + p.m : p.dose; if (sc > score) { score = sc; best = i; } }); return best; }
  /*
   * 4.1.0 6구역 다리 그림(184×108). 좋다고 하신 처음 시안(밤의 다리 옆모습)을 그대로 옮겼다: 밤하늘 · 불타는 강 건너 · 트러스 다리 · 왼쪽의 초소와 모래주머니.
   *   바탕(bridgeBackdrop)은 한 번만 그려 두고, 그 위에 건너오는 것들 · 예광탄 · 맞는 순간 · 난간(맨 앞)을 매번 그린다.
   *   좀비의 가로 자리: 초소 앞(BR_X0)이 0, 다리 끝이 1.
   */
  var BR_X0 = 48, BR_W = 130, bridgeBack = null, bridgeFx = [], bridgePopFn = null, bridgeLeak = 0;
  var BR_A = ['.ggg.', 'gkgkg', '.ggg.', '.grg.', 'cccccg', 'gccc..', '.ccc.', '.ccc.', '.d.d.', '.d.d.', 'dd.dd'], BR_B = ['.ggg.', 'kgkgg', '.ggg.', '.ggg.', '.cccg', 'gccc.', 'gccc.', '.ccc.', '.dd..', 'd..d.', 'd..dd'];
  var BR_BIG = ['...ppppp...', '..ppppppp..', '..pkpppkp..', '..ppppppp..', '...prrrp...', '.ppppppppp.', 'pppcccccppp', 'pp.ccccc.pp', 'pp.ccccc.pp', 'p..ccccc..p', '...ccccc...', '...cc.cc...', '...dd.dd...', '...dd.dd...', '..ddd.ddd..'];
  var BR_BIG2 = ['...ppppp...', '..ppppppp..', '..pkpppkp..', '..ppppppp..', '...prrrp...', '.ppppppppp.', 'pppcccccppp', 'pp.ccccc.pp', 'pp.ccccc.pp', '.p.ccccc.p.', '...ccccc...', '...cc.cc...', '..dd...dd..', '..dd...dd..', '.ddd...ddd.'];
  var BR_DOG = ['......gg', 'kgggggkg', 'gggggggr', '.gcccg..', '.d...d..'], BR_DOG2 = ['......gg', 'kgggggkg', 'gggggggr', '.gcccg..', 'd.....d.'];
  var BR_BOMB = ['..ggg..', '.gkgkg.', '.ggggg.', 'yyyyyyy', 'yyoyyoy', 'yyyyyyy', 'yoyyyoy', '.yyyyy.', '.d...d.', '.d...d.', 'dd..dd.'];
  var BR_SHIRT = ['#6b4a3a', '#3f5f7a', '#8a8a52', '#b8402e', '#c9c7ba', '#55585f'];
  function bridgeBackdrop() {
    if (bridgeBack) return bridgeBack;
    var cv = document.createElement('canvas'); cv.width = 184; cv.height = 108; var g = cv.getContext('2d'), K = '#0c0e14';
    var R = function (x, y, w, h, c) { px(g, x, y, w, h, c); }, P = function (x, y, c) { px(g, x, y, 1, 1, c); };
    ['#0d1326', '#101a30', '#14213a', '#1a2944', '#22324e', '#2c3a56'].forEach(function (c, i) { R(0, i * 8, 184, 8, c); });      // 밤하늘
    [[12, 6], [40, 12], [70, 4], [98, 16], [130, 8], [160, 14], [176, 5], [54, 22], [116, 26], [24, 28], [146, 30]].forEach(function (s, i) { P(s[0], s[1], i % 3 ? '#8a9ac0' : '#e8f0ff'); });
    g.save(); g.translate(-30, 2);      // 4.1.7: 달을 왼쪽으로 옮겼다(오른쪽 위 모서리에 단계 딱지가 붙는다)
    R(148, 8, 10, 10, '#e8e6dc'); R(147, 10, 12, 6, '#e8e6dc'); R(150, 7, 6, 12, '#e8e6dc'); P(151, 11, '#c9c7ba'); P(154, 14, '#c9c7ba'); R(152, 9, 2, 1, '#c9c7ba');      // 달
    /* 4.1.2: 달 둘레에 깔았던 네모난 빛을 없앴다(네모가 그대로 보였다). 대신 달무리를 점으로 둥글게 찍는다 */
    [[146, 6], [159, 6], [145, 19], [160, 19], [143, 12], [162, 13], [152, 4], [153, 21]].forEach(function (q) { P(q[0], q[1], '#3a4a6a'); });
    g.restore();
    [[0, 34, 10, 14], [10, 30, 8, 18], [20, 36, 12, 12], [34, 28, 6, 20], [42, 35, 10, 13], [56, 31, 7, 17], [66, 37, 12, 11], [82, 29, 8, 19], [94, 35, 9, 13], [108, 32, 7, 16], [118, 37, 12, 11], [134, 30, 8, 18], [146, 36, 10, 12], [160, 33, 8, 15], [170, 36, 14, 12]].forEach(function (b, i) { R(b[0], b[1], b[2], b[3], '#131a2c'); if (i % 2) P(b[0] + 2, b[1] + 3, '#f0b878'); if (i % 3 === 0) P(b[0] + b[2] - 3, b[1] + 6, '#f0b878'); });      // 강 건너 도시
    R(0, 48, 184, 60, '#0b1424'); for (var y = 50; y < 108; y += 3) for (var x = (y * 7) % 11; x < 184; x += 13) R(x, y, 5, 1, y < 70 ? '#16243c' : '#111c30');      // 강
    for (var y2 = 74; y2 < 106; y2 += 2) R(120 - (y2 % 4), y2, 8 - (y2 % 3), 1, '#3a4a6a');      // 달빛
    R(0, 36, 184, 2, '#3a4252'); for (var tx = -6; tx < 184; tx += 24) { for (var k = 0; k < 24; k++) { P(tx + k, 60 - k, '#2c3442'); P(tx + k, 36 + k, '#2c3442'); } R(tx, 36, 2, 26, '#3a4252'); }      // 트러스
    R(0, 62, 184, 3, '#8a8f98'); R(0, 62, 184, 1, '#b4b8c0'); R(0, 65, 184, 7, '#4a4f58'); R(0, 71, 184, 1, '#2a2e36'); for (var dx = 0; dx < 184; dx += 16) R(dx, 65, 1, 6, '#3a3f48');      // 상판
    for (var lx = 6; lx < 184; lx += 14) R(lx, 63, 6, 1, '#f0b400');
    [26, 92, 158].forEach(function (x) { R(x, 72, 10, 36, '#3a3f48'); R(x, 72, 2, 36, '#4a4f58'); R(x + 8, 72, 2, 36, '#2a2e36'); R(x - 2, 72, 14, 3, '#4a4f58'); for (var y = 80; y < 108; y += 8) R(x, y, 10, 1, '#2a2e36'); R(x - 1, 98, 12, 2, '#16243c'); });      // 교각
    R(2, 34, 26, 28, '#c9c7ba'); R(2, 34, 26, 2, '#e8e6dc'); R(2, 58, 26, 4, '#8a8a82'); R(0, 30, 30, 4, '#7a4f24'); R(0, 30, 30, 1, '#a8743a'); R(6, 40, 10, 8, K); R(7, 41, 8, 6, '#ffe9a0'); R(9, 42, 3, 5, '#3a3a36'); R(9, 41, 3, 2, '#e6c9a0'); R(19, 46, 6, 16, '#55564e'); R(20, 47, 4, 6, '#3a3a36');      // 초소
    R(18, 36, 8, 7, K); R(19, 37, 6, 5, '#f0b400'); spr(g, 20, 37, ['###', '#..', '###', '#.#', '###'], { '#': K });      // 표지 6
    R(12, 24, 4, 6, '#55564e'); R(11, 22, 6, 3, '#8a8a82'); R(16, 22, 2, 3, '#fff2c0');      // 탐조등
    [[30, 58], [36, 58], [33, 54]].forEach(function (b) { R(b[0], b[1], 6, 4, '#a89a6a'); R(b[0], b[1], 6, 1, '#c9bc8a'); R(b[0], b[1] + 3, 6, 1, '#7a6e48'); });      // 사수 앞의 모래주머니(방벽은 drawBridge 가 남은 만큼 쌓는다)
    for (var v = 0; v < 8; v++) { g.fillStyle = 'rgba(4,6,12,' + (0.26 - v * 0.03).toFixed(3) + ')'; g.fillRect(v, 0, 1, 108); g.fillRect(183 - v, 0, 1, 108); }      // 가장자리를 어둡게
    spr(g, 32, 45, ['.kk.', '.ss.', 'gggg', 'gggg=====', '.gg.', '.pp.'], { k: '#3a3a36', s: '#e6c9a0', g: '#4a6a3a', p: '#2a2e36', '=': '#17180f' });      // 사수와 기관총
    return (bridgeBack = cv);
  }
  /*
   * 4.1.2 다리 그림을 다듬었다(도트는 그대로, 움직임을 더했다).
   *   하늘: 구름이 흐르고 별이 깜빡인다. 강 건너 불에서 연기가 오른다. 강: 물결이 흐르고 달빛과 불빛이 일렁인다.
   *   탐조등이 다리 위를 천천히 훑는다. 쓰러진 것은 난간 너머 강으로 떨어져 물이 튄다. 방벽은 남은 만큼 쌓여 있고 위에 남은 양이 보인다.
   *   고친 버그: 달 둘레와 불 둘레에 깔았던 반투명 네모가 깜빡여 보였다 → 네모를 없애고 점으로 찍는다.
   */
  var bridgeFlash = null;      // 화면을 덮는 한 번의 번쩍임 { at, kind: 'breach' | 'nade' | 'warn' }
  function drawBridge() {
    var cv = $('bridgescene'); if (!cv) return;
    var g = cv.getContext('2d'), now = Date.now(), b = C.bridgeOf(state), K = '#0c0e14', on = state.posts > 0;
    var R = function (x, y, w, h, c) { px(g, x, y, w, h, c); };
    g.imageSmoothingEnabled = false; g.drawImage(bridgeBackdrop(), 0, 0);
    // 하늘: 흐르는 구름, 깜빡이는 별
    [[20, 18, 26, 9000], [96, 10, 20, 14000], [120, 22, 30, 11000]].forEach(function (c) { var cx = Math.round(((c[0] + now / c[3] * 8) % 230) - 40); R(cx, c[1], c[2], 2, '#26324c'); R(cx + 4, c[1] - 1, c[2] - 10, 1, '#26324c'); R(cx + 2, c[1] + 2, c[2] - 6, 1, '#1c2740'); });
    [[40, 12, 0], [130, 8, 700], [70, 4, 1300], [176, 5, 400]].forEach(function (s) { if (Math.floor((now + s[2]) / 900) % 3 === 0) R(s[0], s[1], 1, 1, '#ffffff'); });
    // 강 건너의 불과 연기(네모난 빛은 쓰지 않는다)
    var fl = Math.floor(now / 160) % 2; R(84, 27, 4, 2, '#f08a3a'); R(85, 26 - fl, 2, 1 + fl, '#ffd95a'); R(83 + fl * 5, 28, 1, 1, '#ffb060'); R(136, 28, 3, 2, '#f08a3a'); R(137, 27 - fl, 1, 1 + fl, '#ffd95a');
    [[86, 0], [86, 1400], [137, 700]].forEach(function (s) { var a = ((now + s[1]) % 4200) / 4200, sy = Math.round(25 - a * 16), sx = Math.round(s[0] + Math.sin(a * 5 + s[1]) * 2 + a * 3); if (sy > 6) { R(sx, sy, 2, 1, a < 0.5 ? '#4a4048' : '#2e2c3a'); if (a > 0.3) R(sx + 1, sy - 1, 2, 1, '#2e2c3a'); } });
    /* 4.1.7 단계가 오를수록 풍경이 달라진다.
       3단계부터: 강 건너에 불이 번진다(단계마다 한 곳씩, 여섯 곳까지). 5단계부터: 비가 내린다. 8단계부터: 달이 붉어지고 번개가 친다. 12단계부터: 하늘이 붉고 불티가 날린다 */
    var lvS = b.streak || 0;
    if (on && lvS >= 3) { [[22, 35], [58, 30], [110, 31], [162, 32], [44, 34], [148, 35]].slice(0, Math.min(6, lvS - 2)).forEach(function (q, i) { var f2 = Math.floor(now / 150 + i) % 2; R(q[0], q[1], 3, 2, '#f08a3a'); R(q[0] + 1, q[1] - 1 - f2, 1, 1 + f2, '#ffd95a'); var sa = ((now + i * 900) % 3800) / 3800; if (q[1] - 2 - sa * 14 > 6) R(Math.round(q[0] + 1 + sa * 4), Math.round(q[1] - 2 - sa * 14), 2, 1, '#3a3440'); R(q[0] + (f2 ? 0 : 1), 50 + i % 3, 3, 1, '#6a3a2a'); }); }
    if (on && lvS >= 8) { R(118, 10, 10, 10, '#d8644e'); R(117, 12, 12, 6, '#d8644e'); R(120, 9, 6, 12, '#d8644e'); R(121, 13, 1, 1, '#a84030'); R(124, 16, 1, 1, '#a84030'); R(122, 11, 2, 1, '#a84030'); }      // 붉은 달
    if (on && lvS >= 12) { g.fillStyle = 'rgba(160,30,20,.16)'; g.fillRect(0, 0, 184, 48); for (var em = 0; em < 9; em++) { var ea = ((now / 30 + em * 47) % 120) / 120; R(Math.round((em * 23 + now / 90) % 184), Math.round(46 - ea * 44), 1, 1, em % 2 ? '#ffb060' : '#f08a3a'); } }
    else if (on && lvS >= 5) { g.fillStyle = 'rgba(8,12,24,' + Math.min(0.22, 0.1 + lvS * 0.01).toFixed(2) + ')'; g.fillRect(0, 0, 184, 48); }
    // 강: 흐르는 물결, 달빛, 불빛
    for (var wy = 51; wy < 108; wy += 6) { var wo = Math.floor(now / (wy < 72 ? 260 : 180) + wy * 3) % 23; for (var wx = -wo; wx < 184; wx += 23) R(wx, wy, 4, 1, wy < 72 ? '#1e3050' : '#18263e'); }
    for (var my = 74; my < 106; my += 2) { var mo = Math.round(Math.sin(now / 500 + my) * 1.5); R(120 - (my % 4) + mo, my, 8 - (my % 3), 1, (my + Math.floor(now / 400)) % 6 ? '#3a4a6a' : '#5a6c90'); }
    for (var fy = 49; fy < 56; fy += 2) { R(84 + ((fy + Math.floor(now / 200)) % 3), fy, 3, 1, '#6a3a2a'); }
    if (!on) { g.fillStyle = 'rgba(8,10,16,.45)'; g.fillRect(0, 0, 184, 108); R(0, 56, 184, 1, '#b4b8c0'); for (var rx0 = 2; rx0 < 184; rx0 += 8) R(rx0, 57, 1, 5, '#8a8f98'); return; }
    // 탐조등: 다리 위를 천천히 훑는다(맨 앞의 것을 따라간다)
    var front = null; b.zs.forEach(function (z) { if (!front || z.x < front.x) front = z; });
    var aimX = front ? BR_X0 + front.x * BR_W : 150; bridgeBeam += (aimX - bridgeBeam) * 0.05; var bx = bridgeBeam + Math.sin(now / 1300) * 6;
    g.fillStyle = 'rgba(255,242,192,.09)'; g.beginPath(); g.moveTo(18, 23); g.lineTo(bx - 14, 62); g.lineTo(bx + 16, 62); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,242,192,.10)'; g.fillRect(Math.round(bx - 12), 62, 26, 2);
    if (b.heat > 0.5 || b.jam > 0) { R(36, 48, 5, 1, b.jam > 0 ? '#ff5a4a' : '#c96a3a'); if (b.jam > 0) { var st6 = (now % 900) / 900; R(39 + Math.round(Math.sin(st6 * 6) * 1.5), Math.round(46 - st6 * 9), 1, 2, 'rgba(232,230,220,' + (0.7 * (1 - st6)).toFixed(2) + ')'); R(41, Math.round(45 - ((st6 + 0.5) % 1) * 9), 1, 2, 'rgba(232,230,220,.35)'); } }
    // 방벽(초소 앞): 남은 만큼 쌓여 있다. 위의 줄이 남은 양
    var wmax = C.wallMax(state), wl = Math.max(0, b.wall) / wmax, rowsW = b.down > 0 ? 0 : Math.max(1, Math.ceil(wl * 3)), hurtW = bridgeLeak && now - bridgeLeak < 160;
    for (var wr = 0; wr < rowsW; wr++) for (var wc = 0; wc < 2; wc++) { var sbx = 43 + wc * 5 + (wr % 2) * 2 + (hurtW ? 1 : 0), sby = 58 - wr * 4; R(sbx, sby, 6, 4, hurtW ? '#e8d8a8' : '#a89a6a'); R(sbx, sby, 6, 1, '#c9bc8a'); R(sbx, sby + 3, 6, 1, '#7a6e48'); }
    if (b.down > 0) { [[42, 60], [47, 59], [52, 61], [45, 61]].forEach(function (q, i) { R(q[0], q[1], 4, 2, i % 2 ? '#7a6e48' : '#a89a6a'); }); }
    R(40, 40, 16, 4, K); R(41, 41, Math.round(14 * wl), 2, wl > 0.5 ? '#7fb85a' : wl > 0.25 ? '#e98a3c' : (Math.floor(now / 140) % 2 ? '#ff5a4a' : '#d8453a'));
    // 건너오는 것들(먼 것부터 그려 가까운 것이 앞에 온다)
    var zs = b.zs.slice().sort(function (p, q) { return q.x - p.x; });
    zs.forEach(function (z) {
      if (z.x > 1.03) return;
      var zx = BR_X0 + z.x * BR_W, x = Math.round(zx), k = z.k || (z.big ? 'big' : 'norm'), step = Math.floor(now / (k === 'big' ? 320 : k === 'run' ? 110 : 220) + (z.id || 0)) % 2, hurt = bridgeFx.some(function (f) { return f.kind === 'hit' && now - f.at < 90 && Math.abs(f.x - zx) < 3; });
      var WH = { g: '#fff', h: '#fff', k: '#fff', c: '#fff', d: '#fff', r: '#fff', p: '#fff', a: '#fff' };
      if (k === 'big') {
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x - 5, 62, 11, 1);
        spr(g, x - 5 + (hurt ? 1 : 0), 47, step ? BR_BIG : BR_BIG2, hurt ? WH : { p: '#9a5ac8', k: '#ffd95a', r: '#3a1a4a', c: '#5a3a7a', d: '#2a2e36' });
        R(x - 8, 41, 17, 4, K); R(x - 7, 42, Math.max(1, Math.round(15 * z.hp / z.max)), 2, '#b07ae0');
      } else {
        g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x - 2, 62, 6, 1);
        if (k === 'dog') { g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x - 3, 62, 8, 1); spr(g, x - 3, 57, step ? BR_DOG : BR_DOG2, hurt ? WH : { g: '#8aa86a', k: '#17180f', r: '#d8453a', c: '#6a8a52', d: '#4a5a3a' }); R(x + 6, 59, 3, 1, 'rgba(232,230,220,.3)'); return; }
        if (k === 'bomb') { var pu = Math.floor(now / 260 + (z.id || 0)) % 2; spr(g, x - 3, 51 - pu, BR_BOMB, hurt ? { g: '#fff', k: '#fff', y: '#fff', o: '#fff', d: '#fff' } : { g: '#9ab86a', k: '#17180f', y: pu ? '#d8c84a' : '#c9b83a', o: '#e98a3c', d: '#3a3a36' }); if (z.hp < z.max) { R(x - 3, 46, 8, 3, K); R(x - 2, 47, Math.max(1, Math.round(6 * z.hp / z.max)), 1, '#d8453a'); } return; }
        var pal = hurt ? WH : k === 'shield' ? { g: '#6a9a5a', h: '#5a8a3e', k: '#17180f', c: '#2a3a4a', d: '#1a1e24', r: '#b8402e' } : k === 'run' ? { g: '#a8c86a', h: '#5a8a3e', k: '#d8453a', c: '#b8402e', d: '#3a3a36', r: '#b8402e' } : k === 'tough' ? { g: '#6a9a5a', h: '#5a8a3e', k: '#17180f', c: '#55585f', d: '#2a2e36', r: '#b8402e' } : { g: (z.id || 0) % 3 ? '#7fb85a' : '#6aa85a', h: '#5a8a3e', k: '#17180f', c: BR_SHIRT[(z.id || 0) % 5], d: '#3a3a36', r: '#b8402e' };
        spr(g, x - 2 + (hurt ? 1 : 0) - (k === 'run' ? 1 : 0), 51, step ? BR_A : BR_B, pal);
        if (k === 'shield') { R(x - 4, 50, 3, 12, '#3a4a5a'); R(x - 4, 50, 1, 12, '#8aa0b4'); R(x - 3, 53, 1, 2, '#c9d8e0'); R(x - 1, 50, 5, 2, '#2a2e36'); }      // 방패 든 놈: 앞에 든 진압 방패와 검은 투구
        if (k === 'run') { R(x + 5, 54, 3, 1, 'rgba(232,230,220,.35)'); R(x + 6, 58, 2, 1, 'rgba(232,230,220,.25)'); }      // 뛰는 놈: 뒤로 바람 줄
        if (k === 'tough') { R(x - 1, 50, 5, 2, '#8a8f98'); R(x - 1, 50, 5, 1, '#b4b8c0'); R(x - 3, 56, 2, 5, '#6a6f78'); }      // 튼튼한 놈: 철모와 방패
        if (z.hp < z.max) { R(x - 3, 46, 8, 3, K); R(x - 2, 47, Math.max(1, Math.round(6 * z.hp / z.max)), 1, '#d8453a'); }
      }
    });
    // 쏘는 순간: 총구의 불꽃, 예광탄, 맞은 자리의 불티. 쓰러진 것은 난간 너머 강으로 떨어져 물이 튄다
    bridgeFx = bridgeFx.filter(function (f) { return now - f.at < (f.kind === 'kill' ? 900 : f.kind === 'boom' ? 500 : 300); });
    bridgeFx.forEach(function (f) {
      var a = now - f.at, ty = f.big ? 52 : 55;
      if (a < 0) return;
      if (f.kind === 'boom') { var e = a / 500, rr = Math.round(3 + e * 9); g.fillStyle = 'rgba(255,' + Math.round(230 - e * 120) + ',' + Math.round(140 - e * 120) + ',' + (0.85 * (1 - e)).toFixed(2) + ')'; g.fillRect(Math.round(f.x - rr), 60 - rr, rr * 2, rr); g.fillRect(Math.round(f.x - rr + 2), 58 - rr, rr * 2 - 4, 2); if (e < 0.4) R(Math.round(f.x - 1), 54, 3, 6, '#fff2c0'); for (var sk = 0; sk < 4; sk++) R(Math.round(f.x + (sk - 1.5) * (3 + e * 10)), Math.round(54 - e * 18 + sk * 2 + e * e * 22), 1, 1, '#ffd95a'); return; }
      if (!f.quiet && a < 110) { R(41, 48, 2, 1, '#fff2c0'); R(43, 47, 1, 1, '#ffd95a'); R(43, 49, 1, 1, '#ffd95a'); R(40, 46, 1, 1, 'rgba(255,217,90,.5)'); var t0 = a / 110, sx = 44, hx = sx + (f.x - sx) * t0, hy = 48 + (ty - 48) * t0; for (var s = 0; s < 3; s++) { var qx = hx - s * 5; if (qx > sx) R(Math.round(qx), Math.round(hy - s * 0.3), 4, 1, f.hand ? '#ffd95a' : '#e8a04a'); } }
      if (!f.quiet && a < 260) R(38 - Math.round(a / 40), 50 + Math.round(a * a / 9000), 1, 1, '#c9a820');      // 탄피
      if (a >= 60 && a < 260) { [[-1, -2], [3, 0], [0, 2], [-3, 1]].forEach(function (q, i) { var d = (a - 60) / 200; R(Math.round(f.x + q[0] * (1 + d * 2)), Math.round(ty + q[1] * (1 + d * 2)), 1, 1, i % 2 ? '#fff2c0' : '#b8402e'); }); }
      if (f.kind === 'kill') {
        var d2 = Math.max(0, (a - 80) / 820), fx2 = f.x + d2 * 6, fy2 = 52 + d2 * d2 * 150, col = f.big ? '#9a5ac8' : '#7fb85a', col2 = f.big ? '#5a3a7a' : '#6b4a3a';
        if (fy2 < 96) { var tw = Math.floor(a / 90) % 2; if (tw) { R(Math.round(fx2), Math.round(fy2), f.big ? 6 : 3, f.big ? 9 : 6, col2); R(Math.round(fx2), Math.round(fy2) - 2, f.big ? 5 : 3, 2, col); } else { R(Math.round(fx2) - 1, Math.round(fy2), f.big ? 9 : 6, f.big ? 6 : 3, col2); R(Math.round(fx2) + (f.big ? 8 : 5), Math.round(fy2), 2, f.big ? 5 : 3, col); } }
        else { var sp2 = Math.min(1, (fy2 - 96) / 40), sxw = Math.round(fx2); R(sxw - Math.round(2 + sp2 * 5), 97, 2, 1, '#8ab0d8'); R(sxw + Math.round(2 + sp2 * 5), 97, 2, 1, '#8ab0d8'); R(sxw - 1, 96 - Math.round((1 - sp2) * 5), 1, 2, '#c9e0f8'); R(sxw + 1, 95 - Math.round((1 - sp2) * 3), 1, 2, '#c9e0f8'); R(sxw - Math.round(sp2 * 7), 99, Math.round(sp2 * 14) + 1, 1, '#2a3c5c'); }
      }
    });
    R(0, 56, 184, 1, '#b4b8c0'); for (var rx = 2; rx < 184; rx += 8) R(rx, 57, 1, 5, '#8a8f98');      // 난간(맨 앞)
    if (lvS >= 5) { var rn = Math.min(46, 14 + lvS * 3); for (var ri = 0; ri < rn; ri++) { var rxp = (ri * 37 + Math.floor(now / 16) * 2) % 196 - 6, ryp = (ri * 53 + Math.floor(now / 16) * 5) % 108; R(rxp, ryp, 1, 3, 'rgba(160,190,230,.35)'); } for (var sp6 = 0; sp6 < 6; sp6++) { if ((Math.floor(now / 120) + sp6 * 3) % 5 === 0) R((sp6 * 31 + 50) % 184, 61, 2, 1, 'rgba(200,220,250,.5)'); } }      // 비: 빗줄기와 상판에 튀는 물
    if (lvS >= 8) { var lt = now % 6100; if (lt < 70 || (lt > 140 && lt < 190)) { g.fillStyle = 'rgba(220,230,255,.28)'; g.fillRect(0, 0, 184, 108); [[60, 0], [58, 6], [62, 12], [59, 18], [64, 24], [61, 30]].forEach(function (q) { R(q[0] + (lvS % 3) * 20, q[1], 2, 6, '#e8f0ff'); }); } }      // 번개
    // 떼가 온다(미리 알림): 오른쪽 끝이 붉게 깜빡이고 화살표가 보인다. 떼가 오는 동안에는 위아래에 붉은 띠
    if (b.warn > 0 && Math.floor(now / 180) % 2) { g.fillStyle = 'rgba(216,69,58,.35)'; g.fillRect(150, 36, 34, 28); [0, 8, 16].forEach(function (o) { R(176 - o, 49, 5, 1, '#ff5a4a'); R(176 - o, 48, 2, 3, '#ff5a4a'); R(177 - o, 47, 1, 5, '#ff5a4a'); }); }
    if (b.wave > 0) { var wp = Math.floor(now / 250) % 2 ? '.55' : '.3'; g.fillStyle = 'rgba(216,69,58,' + wp + ')'; g.fillRect(0, 0, 184, 2); g.fillRect(0, 106, 184, 2); R(0, 0, Math.round(184 * b.wave / C.WAVE_SECONDS), 2, '#ff5a4a'); }
    // 뚫렸다: 어둡고 붉게. 다시 세우는 동안 가운데에 차오르는 줄
    if (b.down > 0) { g.fillStyle = 'rgba(60,8,8,.55)'; g.fillRect(0, 0, 184, 108); R(60, 50, 64, 6, K); R(61, 51, Math.round(62 * (1 - b.down / C.BREACH_SECONDS)), 4, '#e98a3c'); }
    if (bridgeFlash && now - bridgeFlash.at < 350) { var fa = 1 - (now - bridgeFlash.at) / 350; g.fillStyle = (bridgeFlash.kind === 'nade' ? 'rgba(255,240,200,' : bridgeFlash.kind === 'up' ? 'rgba(240,180,0,' : 'rgba(216,69,58,') + (0.5 * fa).toFixed(2) + ')'; g.fillRect(0, 0, 184, 108); }
    if (bridgeFlash && bridgeFlash.kind === 'up' && now - bridgeFlash.at < 700) { var ua = (now - bridgeFlash.at) / 700, ux = Math.round(184 * ua); R(ux - 3, 0, 3, 108, 'rgba(255,242,192,' + (0.6 * (1 - ua)).toFixed(2) + ')'); R(0, 0, 184, 2, '#f0b400'); R(0, 106, 184, 2, '#f0b400'); }      // 단계가 올랐다: 금빛 띠가 다리를 훑고 지나간다
    cv.classList.toggle('ward-shake', !!(bridgeFlash && bridgeFlash.kind !== 'warn' && bridgeFlash.kind !== 'up' && now - bridgeFlash.at < 260));
  }
  var bridgeBeam = 150, bsc0 = null, bridgeLvSeen = null;
  var W_H = 112;        // 4.0.8: 병실 그림의 높이(도트). 아래 16도트는 이동 침대가 다니는 복도
  var wardEr = null, wardErFx = null, wardBoostFx = 0, wardArmed = false;      // 급한 환자가 들어온 때 · 살리거나 놓친 때 · 연구원이 강화 혈청을 가져온 때 · 강화 혈청을 들었는지
  var W_GURNEY = ['.....hhhh', '....hhhhhh.......bbbbbbbbbbbbbbbbbbbb', '...hhsssss..bbbbbBBBBBBBbbbbbbbbbbbbbbbbff', '..pPesssmsdbbbbbbbbbbbbbbbbbbbbbbbbbbbbbfff', '.pppPssssddbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbff', '.ppppppppbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb..r', 'wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww.r', 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWrr', 'kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk', '..KkKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKkK', '...k.k................................k.k', '....k..................................k', '...k.k................................k.k', '..k...k..............................k...k', '.ooo.ooo............................ooo.ooo', '.oOo.oOo............................oOo.oOo', '.ooo.ooo............................ooo.ooo'];
  var W_GX = 66;        // 이동 침대가 서는 자리(도트)
  var W_LEFT = 28;      // 그림 왼쪽의 냉장 상자 자리(도트). 그 오른쪽을 의자들이 나눠 쓴다
  function wardBackdrop() {
    if (wardBack) return wardBack;
    var cv = document.createElement('canvas'); cv.width = 184; cv.height = W_H; var g = cv.getContext('2d'), K = '#0e1618';
    var R = function (x, y, w, h, c) { px(g, x, y, w, h, c); };
    R(0, 0, 184, W_H, '#1c2a2e'); for (var y = 0; y < 76; y += 8) for (var x = 0; x < 184; x += 8) { R(x, y, 7, 7, (x * 3 + y) % 40 === 0 ? '#22363c' : '#24383e'); R(x, y, 1, 1, '#2e4a52'); }      // 타일 벽(군데군데 바랜 타일)
    [[60, 22], [132, 30], [100, 52], [44, 60], [160, 58]].forEach(function (q) { R(q[0], q[1], 2, 1, '#1a2a2e'); R(q[0] + 1, q[1] + 1, 3, 1, '#1a2a2e'); });      // 금 간 자리
    [34, 118].forEach(function (lx) { R(lx, 1, 50, 2, '#d8f0f0'); R(lx, 3, 50, 1, '#8ab0b4'); R(lx - 1, 1, 1, 3, '#55585f'); R(lx + 50, 1, 1, 3, '#55585f'); for (var k = 0; k < 60; k++) { var w0 = 50 + k * 0.6; g.fillStyle = 'rgba(200,240,240,' + Math.max(0, 0.085 - k * 0.0014).toFixed(4) + ')'; g.fillRect(Math.round(lx + 25 - w0 / 2), 4 + k, Math.round(w0), 1); } });      // 천장등과 빛
    R(0, 7, 184, 1, '#8a8f98'); for (var rx = 4; rx < 184; rx += 8) R(rx, 8, 1, 1, '#8a8f98');      // 커튼 레일
    R(0, 38, 184, 2, '#3a5a62'); R(0, 40, 184, 1, '#16242a');      // 벽 허리띠
    R(0, 73, 184, 3, '#2a3a40'); R(0, 73, 184, 1, '#3a5a62');      // 걸레받이
    R(0, 76, 184, W_H - 76, '#3e4e54'); R(0, 76, 184, 1, '#5a6e76'); for (var fx = -8; fx < 184; fx += 16) R(fx, 82, 1, 6, '#34444a'); R(0, 88, 184, 1, '#34444a');      // 바닥
    /* 4.0.8 앞쪽 복도(그림을 16도트 늘렸다): 이동 침대가 다니는 길. 바닥에 노란 안내선과 화살표, 오른쪽에 응급 문 */
    R(0, 89, 184, W_H - 89, '#36464c'); for (var cxl = -4; cxl < 184; cxl += 20) R(cxl, 89, 1, W_H - 89, '#2e3c42'); R(0, 100, 184, 1, '#2e3c42');
    R(W_LEFT, 90, 184 - W_LEFT, 1, '#8a7a2a'); for (var ya = W_LEFT + 2; ya < 184; ya += 12) R(ya, 90, 6, 1, '#c9a820');
    R(W_LEFT, 110, 184 - W_LEFT, 1, '#8a7a2a'); for (var yb = W_LEFT + 8; yb < 184; yb += 12) R(yb, 110, 6, 1, '#c9a820');
    [150, 120, 90].forEach(function (ax) { R(ax, 100, 6, 1, '#4a5c62'); R(ax, 99, 2, 3, '#4a5c62'); R(ax + 1, 98, 1, 5, '#4a5c62'); });      // 왼쪽을 가리키는 화살표
    for (var gx = 6; gx < 184; gx += 22) { R(gx, 79, 9, 1, 'rgba(216,240,240,.10)'); R(gx + 4, 92, 12, 1, 'rgba(216,240,240,.06)'); }
    [34, 118].forEach(function (lx) { g.fillStyle = 'rgba(216,240,240,.05)'; g.fillRect(lx - 4, 77, 58, 30); });      // 바닥에 비친 등
    // 왼쪽: 시계와 혈청 냉장 상자
    R(8, 12, 11, 11, K); R(9, 13, 9, 9, '#e8e6dc'); R(13, 14, 1, 1, '#8a8a82'); R(13, 20, 1, 1, '#8a8a82'); R(10, 17, 1, 1, '#8a8a82'); R(16, 17, 1, 1, '#8a8a82');
    R(2, 34, 24, 44, K); R(3, 35, 22, 42, '#c9d8e0'); R(3, 35, 22, 2, '#e8f6ff'); R(3, 75, 22, 2, '#8aa0aa'); R(23, 37, 2, 38, '#a8bcc6'); R(5, 39, 17, 30, '#16262a'); R(5, 39, 17, 1, '#0a1214');
    R(10, 31, 8, 4, '#8a8f98'); R(10, 31, 8, 1, '#b4b8c0'); R(7, 71, 6, 3, '#e8e6dc'); R(9, 71, 2, 3, '#d8453a'); R(8, 72, 4, 1, '#d8453a'); R(19, 72, 2, 2, '#7fb85a'); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(1, 78, 26, 2);
    // 가장자리를 어둡게(눈이 가운데로 모이게)
    for (var v = 0; v < 10; v++) { g.fillStyle = 'rgba(8,12,16,' + (0.22 - v * 0.022).toFixed(3) + ')'; g.fillRect(v, 0, 1, W_H); g.fillRect(183 - v, 0, 1, W_H); }
    return (wardBack = cv);
  }
  /*
   * 달려드는 얼굴(4.0.6): 48×56 도트로 새로 그렸다. 전에는 14도트 얼굴을 열 배로 늘린 것이라 네모난 초록 덩어리였다.
   *   헝클어진 머리, 꺼진 눈두덩과 노란 눈(붉은 눈동자), 찢어진 뺨, 벌린 입과 고르지 않은 이, 턱으로 흐르는 피, 어깨까지.
   */
  function wardFaceSprite() {
    if (wardFace) return wardFace;
    var cv = document.createElement('canvas'); cv.width = 48; cv.height = 56; var g = cv.getContext('2d');
    var R = function (x, y, w, h, c) { px(g, x, y, w, h, c); }, G = '#7fb85a', GD = '#5a8a3e', GL = '#9ad070', K = '#10140e';
    R(6, 46, 36, 10, '#3a3f48'); R(6, 46, 36, 2, '#4a505a'); R(18, 42, 12, 6, GD); R(20, 42, 8, 5, G);      // 어깨와 목
    R(10, 8, 28, 34, G); R(8, 12, 32, 26, G); R(12, 40, 24, 4, G); R(14, 43, 20, 2, GD);      // 머리통
    R(34, 12, 6, 26, GD); R(32, 36, 6, 6, GD); R(10, 10, 4, 22, GL); R(9, 14, 2, 14, GL);      // 그늘과 빛
    R(5, 20, 4, 8, GD); R(39, 20, 4, 8, GD); R(6, 22, 2, 4, '#3a6a2a');      // 귀
    R(8, 2, 32, 9, K); R(6, 6, 6, 10, K); R(36, 6, 6, 12, K); [[10, 11, 3], [16, 11, 2], [22, 10, 4], [30, 11, 3], [13, 13, 1], [27, 13, 1], [34, 12, 2]].forEach(function (h) { R(h[0], h[1], h[2], 3, K); }); R(12, 3, 8, 1, '#2a3024'); R(24, 4, 6, 1, '#2a3024');      // 머리카락
    R(11, 17, 11, 2, '#3a6a2a'); R(26, 17, 11, 2, '#3a6a2a'); R(12, 16, 8, 1, K); R(28, 16, 8, 1, K);      // 눈썹뼈
    [[12, 19], [27, 19]].forEach(function (e) { R(e[0], e[1], 9, 7, '#1c2a1a'); R(e[0] + 1, e[1] + 1, 7, 5, '#ffd95a'); R(e[0] + 1, e[1] + 1, 7, 1, '#fff2c0'); R(e[0] + 3, e[1] + 2, 3, 3, '#d8453a'); R(e[0] + 4, e[1] + 3, 1, 1, K); R(e[0] + 1, e[1] + 5, 2, 1, '#d8453a'); R(e[0] + 6, e[1] + 2, 2, 1, '#d8453a'); });      // 눈
    R(12, 26, 9, 1, '#3a6a2a'); R(27, 26, 9, 1, '#3a6a2a'); R(22, 24, 4, 5, GD); R(22, 28, 1, 1, K); R(25, 28, 1, 1, K);      // 눈 밑, 코
    R(9, 28, 6, 2, '#8a2a20'); R(10, 30, 4, 1, '#d8453a'); R(11, 27, 2, 1, '#8a2a20'); R(8, 30, 2, 3, '#8a2a20');      // 찢어진 뺨
    R(14, 31, 20, 11, '#2a0a0a'); R(13, 32, 1, 8, '#3a6a2a'); R(34, 32, 1, 8, '#3a6a2a'); R(16, 37, 16, 4, '#8a2a20'); R(18, 38, 12, 2, '#b8402e');      // 입 속과 혀
    [[15, 3], [18, 4], [21, 3], [24, 4], [27, 3], [30, 4]].forEach(function (t) { R(t[0], 31, 2, t[1], '#e8e6dc'); R(t[0], 31, 2, 1, '#c9c7ba'); });      // 윗니
    [[16, 2], [20, 3], [23, 2], [26, 3], [30, 2]].forEach(function (t) { R(t[0], 42 - t[1], 2, t[1], '#e8e6dc'); });      // 아랫니
    R(15, 42, 2, 6, '#b8402e'); R(16, 48, 1, 3, '#b8402e'); R(31, 42, 2, 4, '#b8402e'); R(32, 46, 1, 4, '#8a2a20'); R(22, 43, 3, 2, '#8a2a20');      // 턱으로 흐르는 피
    R(30, 22, 1, 3, '#3a6a2a'); R(17, 12, 3, 1, '#3a6a2a'); R(36, 30, 2, 1, '#3a6a2a');      // 살갗의 얼룩
    return (wardFace = cv);
  }
  var wardHand = null;
  function wardHandSprite() {      // 유리를 치는 손(16×20)
    if (wardHand) return wardHand;
    var cv = document.createElement('canvas'); cv.width = 16; cv.height = 20; var g = cv.getContext('2d');
    var R = function (x, y, w, h, c) { px(g, x, y, w, h, c); }, G = '#7fb85a', GD = '#5a8a3e';
    R(3, 8, 10, 9, G); R(11, 9, 2, 8, GD); R(5, 17, 6, 3, GD);
    [[2, 2, 7], [5, 0, 9], [8, 1, 8], [11, 3, 6]].forEach(function (f) { R(f[0], f[1], 2, f[2], G); R(f[0] + 1, f[1], 1, f[2], GD); R(f[0], f[1], 2, 1, '#10140e'); });
    R(0, 9, 3, 2, G); R(0, 8, 2, 1, '#10140e'); R(5, 11, 4, 1, GD); R(4, 14, 5, 1, GD); R(6, 10, 2, 1, '#8a2a20');
    return (wardHand = cv);
  }
  /* 사람 그림(4.0.5): 14×24 도트로 새로 그렸다. 4.0.4 는 10×17 그림을 두 배로 늘린 것이라 뭉툭했다. 머리 빛, 눈 흰자, 옷깃, 옷 그늘, 무릎 위의 손까지 그린다 */
  var W_MAN = ['....hhhhhh....', '...hHHhhhhh...', '..hhhhhhhhhh..', '..hhsssssshh..', '..hssssssssh..', '..swesssswes..', '..ssssssssss..', '..dssssssssd..', '...ssmmmmss...', '....dssssd....',
    '..cclccccclcc.', '.cccccccccCCc.', '.cccccccccCCc.', 'acccccccccCCca', 'acccccccccCCca', 'aacccccccCCcaa', '.sscccccccCss.', '..pppppppppp..', '..pppPPpppPP..', '..ppp....ppp..', '..ppp....ppp..', '..ppP....ppP..', '..ppp....ppp..', '.kkkk...kkkk..'];
  var W_SHADE = { '#6b4a3a': '#4a3428', '#3f5f7a': '#2c4458', '#8a8a52': '#62623a', '#d8644e': '#a84030', '#55585f': '#3a3c42', '#7a5a8a': '#563e62' };
  function drawWard() {
    var cv = $('labscene'); if (!cv) return;
    var g = cv.getContext('2d'), now = Date.now(), w = C.wardOf(state), n = w.seats.length, sp = (184 - W_LEFT) / n, on = state.staff > 0, K = '#0e1618';
    var R = function (x, y, ww, hh, c) { px(g, x, y, ww, hh, c); };
    g.imageSmoothingEnabled = false; g.drawImage(wardBackdrop(), 0, 0);
    // 냉장 상자 속 혈청(남은 대수만큼 주사기가 꽂혀 있다)
    var cap = C.serumCap(state), per = cap > 7 ? 2 : 1;
    for (var k0 = 0; k0 < cap; k0++) { var kc = k0 % per, kr = Math.floor(k0 / per), sy = 41 + kr * 4, sxx = per > 1 ? 6 + kc * 8 : 6, sw = per > 1 ? 7 : 15; if (sy > 66) break;
      if (k0 < w.stock) { R(sxx, sy, sw - 2, 2, '#e8f6ff'); R(sxx + 1, sy, sw - 5, 2, '#f0b400'); R(sxx + sw - 2, sy, 2, 1, '#b4b8c0'); } else R(sxx, sy + 1, sw, 1, '#22343a'); }
    if (w.stock >= cap && Math.floor(now / 500) % 2) R(19, 72, 2, 2, '#b8f08a');
    // 연구 조교(상자 앞): 샀을 때만 서 있다. 혈청이 한 대 생길 때마다 손을 든다
    if ((state.upgrades.autolab || 0) > 0) { var aup = w.make > 0.85 ? 1 : 0;
      spr(g, 17, 60, ['..hhhh..', '.hhhhhh.', '.hsssss.', '.sesses.', '.ssssss.', '..ssss..', '.wwwwww.', 'wwwwwwww', 'wwwwwwww', 'awwwwwwa', 'awwwwwwa', '.wwwwww.', '.wwwwww.', '.pp..pp.', '.pp..pp.', '.pp..pp.', '.kk..kk.'], { h: '#4a3428', s: '#e6c9a0', e: K, w: '#e8e6dc', a: '#e6c9a0', p: '#3f5f7a', k: '#2a2e36' });
      if (aup) { R(16, 66, 1, 3, '#e6c9a0'); R(14, 65, 3, 1, '#e8f6ff'); } g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(16, 77, 10, 1); }
    // 칸막이 커튼(자리 사이): 레일에서 내려와 묶여 있다
    for (var c0 = 0; c0 <= n; c0++) { var kx = Math.min(181, Math.max(0, Math.round(W_LEFT + sp * c0) - 1)); R(kx, 9, 3, 30, '#4a8892'); R(kx + 1, 9, 1, 30, '#5a9aa4'); R(kx, 39, 3, 2, '#3a6a72'); R(kx, 41, 3, 20, '#4a8892'); R(kx + 2, 41, 1, 20, '#3a6a72'); R(kx + 1, 61, 1, 6, '#4a8892'); }
    for (var i = 0; i < n; i++) {
      var p = w.seats[i], cx = Math.round(W_LEFT + sp * i + sp / 2), x = cx - 7, fx = wardFx[i], has = on && p.dose >= 0;
      // 계기판(벽): 변하는 줄 + 맞은 대수 여섯 칸
      R(cx - 13, 16, 26, 17, K); R(cx - 12, 17, 24, 15, '#14242a'); R(cx - 12, 17, 24, 1, '#2e4a52'); R(cx - 12, 31, 24, 1, '#0a1214'); R(cx - 1, 33, 2, 4, '#2f474e'); R(cx + 9, 18, 2, 1, has ? '#7fb85a' : '#24383e');
      // 수액대: 맞은 대수만큼 주머니가 찬다
      R(cx + 10, 40, 1, 40, '#8a8f98'); R(cx + 8, 40, 5, 1, '#8a8f98'); R(cx + 8, 80, 5, 1, '#6a6f78'); R(cx + 8, 42, 4, 9, '#c9d8e0'); R(cx + 9, 43, 2, 7, '#22343a');
      if (has && p.dose > 0) { var bag = Math.min(7, Math.ceil(p.dose * 7 / C.WARD_DOSES)); R(cx + 9, 50 - bag, 2, bag, '#6aaede'); R(cx + 9, 51, 1, 10, '#6aaede'); }
      // 의자
      R(x - 2, 46, 2, 30, '#4a3428'); R(x + 14, 46, 2, 30, '#4a3428'); R(x - 2, 46, 18, 2, '#6b4a3a'); R(x - 2, 46, 18, 1, '#8a6248'); R(x, 50, 14, 12, '#5a3e30'); R(x - 2, 67, 18, 3, '#6b4a3a'); R(x - 2, 67, 18, 1, '#8a6248'); R(x - 1, 70, 2, 9, '#4a3428'); R(x + 13, 70, 2, 9, '#4a3428'); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x - 3, 79, 20, 2);
      if (fx && fx.kind === 'cure' && now - fx.at < 700) {      // 되돌아왔다: 금빛으로 빛나고 반짝임이 솟는다
        var cu = (now - fx.at) / 700; g.fillStyle = 'rgba(255,217,90,' + (0.42 * (1 - cu)).toFixed(2) + ')'; g.fillRect(cx - 14, 14, 28, 68);
        [[cx, 24], [cx - 9, 44], [cx + 8, 52], [cx - 3, 62]].forEach(function (q) { var yy = q[1] - Math.round(cu * 14); R(q[0], yy - 2, 1, 5, '#fff2c0'); R(q[0] - 2, yy, 5, 1, '#fff2c0'); });
      }
      if (fx && fx.boost && now - fx.at < 500) { g.fillStyle = 'rgba(180,138,255,' + (0.38 * (1 - (now - fx.at) / 500)).toFixed(2) + ')'; g.fillRect(cx - 14, 14, 28, 68); }
      if (!has) { R(cx - 10, 21, 20, 1, '#24383e'); continue; }
      var m = Math.min(1, p.m), stopped = p.dose > 0, hot = !stopped && m > 0.7, tone = W_SKIN[Math.min(4, Math.floor(m * 5))], dark = W_SKIN[Math.min(4, Math.floor(m * 5) + 1)], jit = hot ? Math.floor(now / 70) % 2 : 0, shirt = W_SHIRT[p.look % 6];
      spr(g, x + jit, 50, W_MAN, { h: W_HAIR[p.look % 5], H: 'rgba(255,255,255,.22)', s: tone, d: dark, w: hot ? '#f0b400' : '#e8e6dc', e: K, m: hot ? '#3a1414' : '#8a4a3a', c: shirt, C: W_SHADE[shirt] || shirt, l: '#e8e6dc', a: tone, p: '#2a2e36', P: '#1c2028', k: '#17180f' });
      R(x + jit, 64, 1, 2, '#d8453a'); R(x + 1 + jit, 63, 1, 1, '#8a2a20');      // 물린 자국(팔)
      if (!hot && (Math.floor(now / 100) + p.look * 7) % 34 === 0) { R(x + 3 + jit, 55, 2, 1, tone); R(x + 9 + jit, 55, 2, 1, tone); }      // 눈 깜빡임
      if (!hot && Math.floor((now + p.look * 300) / 900) % 2) R(x + 2, 60, 10, 1, 'rgba(255,255,255,.07)');      // 숨
      if (fx && fx.nurse && now - fx.at < 600) spr(g, x - 9, 57, ['.wwwwww.', '.wwrrww.', '.hsssss.', '.sesses.', '.ssssss.', '..ssss..', '.tttttt.', 'tttttttt', 'tttttttt', 'atttttts', 'attttttt', '.tttttt.', '.tttttt.', '.pp..pp.', '.pp..pp.', '.pp..pp.', '.kk..kk.'], { w: '#e8e6dc', r: '#d8453a', h: '#6b4a3a', s: '#e6c9a0', e: K, t: '#9ad0e8', a: '#e6c9a0', p: '#e8e6dc', k: '#8a8f98' });      // 간호사가 다가와 놓는다
      if (m > 0.4 && !stopped) { R(x + 3 + jit, 56, 2, 1, '#5a8a3e'); R(x + 10 + jit, 57, 1, 1, '#5a8a3e'); if (m > 0.7) { R(x + 6 + jit, 54, 2, 1, '#3a6a2a'); R(x + 13 + jit, 65, 1, 1, '#5a8a3e'); } }      // 번지는 얼룩
      // 변하는 줄(22칸): 찰수록 노랑 → 주황 → 빨강. 멈추면 파랑
      var fillW = Math.max(1, Math.round(22 * m)), colM = stopped ? '#6aaede' : m > 0.7 ? (Math.floor(now / 140) % 2 ? '#ff5a4a' : '#d8453a') : m > 0.4 ? '#e98a3c' : '#e0c04a';
      R(cx - 11, 20, 22, 5, '#0a1214'); R(cx - 11, 20, fillW, 5, colM); R(cx - 11, 20, fillW, 1, 'rgba(255,255,255,.3)'); if (stopped) R(cx - 11 + fillW, 20, 1, 5, '#e8f6ff');
      for (var d = 0; d < C.WARD_DOSES; d++) { R(cx - 11 + d * 4, 27, 3, 3, d < p.dose ? '#6aaede' : '#24383e'); if (d < p.dose) R(cx - 11 + d * 4, 27, 3, 1, '#e8f6ff'); }
      if (hot) R(cx + 9, 18, 2, 1, Math.floor(now / 140) % 2 ? '#ff5a4a' : '#5a1a14');      // 급하다는 등
      if (fx && now - fx.at < 240) { R(x - 9, 64, 9, 2, '#e8f6ff'); R(x - 8, 64, 5, 2, '#f0b400'); R(x, 64, 2, 1, '#b4b8c0'); R(x - 10, 63, 1, 4, '#8a8f98'); if (fx.kind === 'stop') { g.fillStyle = 'rgba(106,174,222,.30)'; g.fillRect(cx - 14, 14, 28, 68); } }      // 주사 놓는 순간
    }
    /* 4.0.8 응급 등(오른쪽 위 벽): 급한 환자가 있으면 붉게 깜빡인다 */
    R(170, 10, 11, 5, K); R(171, 11, 9, 3, w.er ? (Math.floor(now / 200) % 2 ? '#ff5a4a' : '#7a2018') : '#3a2420'); R(174, 12, 3, 1, w.er ? '#fff' : '#5a3a34'); R(175, 11, 1, 3, w.er ? '#fff' : '#5a3a34');
    /* 강화 혈청: 상자 위 선반. 차오르는 줄(보라) + 다 차면 연구원이 들고 온다. 들고 있으면 사람들 위에 화살표 */
    var PU = '#b48aff', PU2 = '#e8d8ff', need = C.mixNeed(state);
    if (on) { R(3, 28, 22, 2, '#0a1214'); R(3, 28, w.boost ? 22 : Math.round(22 * Math.min(1, (w.mix || 0) / need)), 2, PU); }
    if (w.boost) { var gl = Math.floor(now / 250) % 2; R(5, 23, 14, 4, 'rgba(180,138,255,' + (gl ? '.45' : '.25') + ')'); R(6, 24, 9, 2, PU2); R(7, 24, 6, 2, PU); R(15, 24, 3, 1, '#b4b8c0'); }
    if (wardBoostFx && now - wardBoostFx < 1100) { var bt = (now - wardBoostFx) / 1100, bx = Math.round(70 - 42 * Math.min(1, bt * 1.2)), bob = Math.floor(now / 120) % 2;
      spr(g, bx, 80 - bob, ['..hhhh..', '.hhhhhh.', '.hsssss.', '.sgssgs.', '.ssssss.', '..ssss..', '.wwwwww.', 'wwwwwwww', 'wwwtwwww', 'awwtwwwa', 'awwwwwwa', '.wwwwww.', '.wwwwww.', '.pp..pp.', bob ? '.pp...pp' : 'pp...pp.', bob ? '.kk...kk' : 'kk...kk.'], { h: '#3a3028', s: '#e6c9a0', g: '#22343a', w: '#f0f2f4', t: '#3f7f8a', a: '#e6c9a0', p: '#3a4450', k: K });
      R(bx - 9, 88 - bob, 11, 4, 'rgba(180,138,255,.35)'); R(bx - 8, 89 - bob, 8, 2, PU2); R(bx - 7, 89 - bob, 5, 2, PU); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(bx, 96, 8, 1); }
    if (wardArmed && w.boost && Math.floor(now / 300) % 2) { for (var ai = 0; ai < n; ai++) if (on && w.seats[ai].dose >= 0) { var ax = Math.round(W_LEFT + sp * ai + sp / 2); R(ax - 3, 41, 7, 1, PU); R(ax - 2, 42, 5, 1, PU); R(ax - 1, 43, 3, 1, PU); R(ax, 44, 1, 1, PU); } }
    /* 급한 환자: 이동 침대가 오른쪽에서 미끄러져 들어와 복도 가운데에 선다. 침대 옆 계기에 남은 시간과 여섯 칸 */
    var erShow = w.er || (wardErFx && now - wardErFx.at < 800 ? wardErFx : null);
    if (erShow) {
      var gone = !w.er, saved = gone && wardErFx.kind === 'cure', ein = wardEr ? Math.min(1, (now - wardEr) / 650) : 1, eo = 1 - (1 - ein) * (1 - ein), gxx = Math.round(190 - (190 - W_GX) * eo), gy = 91;
      if (gone && !saved) gxx = W_GX; var left = w.er ? Math.max(0, w.er.t / C.ER_TIME) : 0, dose = w.er ? w.er.dose : saved ? C.WARD_DOSES : wardErFx.dose || 0, late = w.er && left < 0.3, ej = late && Math.floor(now / 90) % 2 ? 1 : 0;
      if (ein < 1) { for (var gs = 1; gs <= 3; gs++) { g.fillStyle = 'rgba(232,246,255,' + (0.28 - gs * 0.07).toFixed(2) + ')'; g.fillRect(gxx + 46 + gs * 7, gy + 3 + gs * 3, 10, 1); } }
      if (saved) { var cu2 = (now - wardErFx.at) / 800; g.fillStyle = 'rgba(255,217,90,' + (0.4 * (1 - cu2)).toFixed(2) + ')'; g.fillRect(gxx - 4, gy - 16, 86, 36); }
      g.fillStyle = 'rgba(0,0,0,.32)'; g.fillRect(gxx + 1, gy + 17, 44, 1);
      var sick = Math.min(4, Math.floor((1 - left) * 5)), sk = saved ? '#e6c9a0' : W_SKIN[sick], sd = saved ? '#c9a880' : W_SKIN[Math.min(4, sick + 1)];
      spr(g, gxx, gy + ej, W_GURNEY, { h: W_HAIR[(erShow.look || 0) % 5], s: sk, d: sd, e: K, m: saved ? '#8a4a3a' : '#3a1414', p: '#e8e6dc', P: '#c4c2b6', b: saved ? '#3f7f8a' : '#b8433a', B: saved ? '#6ab0ba' : '#e06a5a', f: saved ? '#2c5f68' : '#8a2a20', w: '#e8f0f4', W: '#b4c4cc', k: '#a0a6b0', K: '#6a6f78', o: '#1a1e22', O: '#8a8f98', r: '#a0a6b0' });
      if (!saved) { R(gxx + 20, gy + 3 + ej, 5, 1, '#fff'); R(gxx + 22, gy + 1 + ej, 1, 5, '#fff'); }      // 담요의 흰 십자
      R(gxx + 5, gy - 13, 1, 16, '#8a8f98'); R(gxx + 3, gy - 13, 5, 1, '#8a8f98'); R(gxx + 2, gy - 11, 5, 7, '#c9d8e0'); R(gxx + 3, gy - 10, 3, 5, '#22343a'); if (dose > 0) { var eb = Math.min(5, Math.ceil(dose * 5 / C.WARD_DOSES)); R(gxx + 3, gy - 5 - eb, 3, eb, '#6aaede'); R(gxx + 4, gy - 4, 1, 5, '#6aaede'); }
      var px0 = gxx + 50; R(px0 - 1, gy + 1, 30, 14, K); R(px0, gy + 2, 28, 12, '#14242a'); R(px0, gy + 2, 28, 1, '#2e4a52'); R(px0 + 3, gy + 4, 22, 4, '#0a1214');
      if (saved) R(px0 + 3, gy + 4, 22, 4, '#f0b400'); else { var lw = Math.round(22 * left); R(px0 + 3, gy + 4, lw, 4, late ? (Math.floor(now / 140) % 2 ? '#ff5a4a' : '#d8453a') : '#e98a3c'); R(px0 + 3, gy + 4, lw, 1, 'rgba(255,255,255,.3)'); }
      for (var ed = 0; ed < C.WARD_DOSES; ed++) { R(px0 + 3 + ed * 4, gy + 10, 3, 3, ed < dose ? '#6aaede' : '#24383e'); if (ed < dose) R(px0 + 3 + ed * 4, gy + 10, 3, 1, '#e8f6ff'); }
      if (w.er && ein >= 1) { var bc = wardArmed && w.boost ? PU : late ? '#ff5a4a' : '#f0b400'; if (Math.floor(now / 350) % 2 || late) { var X0 = gxx - 4, Y0 = gy - 15, WW = 86, HH = 35; R(X0, Y0, 5, 1, bc); R(X0, Y0, 1, 5, bc); R(X0 + WW - 5, Y0, 5, 1, bc); R(X0 + WW - 1, Y0, 1, 5, bc); R(X0, Y0 + HH - 1, 5, 1, bc); R(X0, Y0 + HH - 5, 1, 5, bc); R(X0 + WW - 5, Y0 + HH - 1, 5, 1, bc); R(X0 + WW - 1, Y0 + HH - 5, 1, 5, bc); } }
      if (wardErFx && wardErFx.kind === 'dose' && now - wardErFx.at < 240) { R(gxx + 12, gy - 4, 9, 2, '#e8f6ff'); R(gxx + 13, gy - 4, 5, 2, wardErFx.boost ? PU : '#f0b400'); R(gxx + 21, gy - 3, 2, 1, '#b4b8c0'); }
      if (saved) [[gxx + 8, gy - 6], [gxx + 30, gy - 10], [gxx + 56, gy - 4], [gxx + 70, gy - 9]].forEach(function (q) { var yy = q[1] - Math.round((now - wardErFx.at) / 800 * 12); R(q[0], yy - 2, 1, 5, '#fff2c0'); R(q[0] - 2, yy, 5, 1, '#fff2c0'); });
    }
    /* 변한 사람이 달려든다(벌칙, 4.0.6 에 다시 그림).
       ① 자리에서 일어선다(0~0.2) ② 화면 앞으로 달려온다(0.2~0.5, 잔상) ③ 유리에 부딪혀 얼굴이 가득 찬다: 두 손이 유리를 치고 금이 간다(0.5~0.9) ④ 붉게 번지며 사라진다 */
    if (wardLunge && now - wardLunge.at < C.TURN_STUN * 1000) {
      var t = (now - wardLunge.at) / (C.TURN_STUN * 1000), sx0 = wardLunge.seat === 'er' ? W_GX + 20 : W_LEFT + sp * wardLunge.seat + sp / 2, face = wardFaceSprite();
      var e2 = t < 0.1 ? 0 : Math.min(1, (t - 0.1) / 0.35), ease = e2 * e2, sc = 0.5 + ease * 1.85, cx2 = sx0 + (92 - sx0) * ease, cy2 = 58 + (50 - 58) * ease, shake = t > 0.5 && t < 0.9 ? (Math.floor(now / 45) % 3 - 1) * 2 : 0;
      g.fillStyle = 'rgba(40,6,6,' + (0.15 + 0.5 * ease).toFixed(2) + ')'; g.fillRect(0, 0, 184, W_H);
      if (e2 > 0 && e2 < 1) for (var gh = 1; gh <= 2; gh++) { var es = Math.max(0, e2 - gh * 0.12), s2 = 0.5 + es * es * 1.85; g.globalAlpha = 0.25; g.drawImage(face, Math.round(sx0 + (92 - sx0) * es * es - 24 * s2), Math.round(58 - 8 * es * es - 28 * s2), Math.round(48 * s2), Math.round(56 * s2)); g.globalAlpha = 1; }      // 잔상
      g.drawImage(face, Math.round(cx2 - 24 * sc + shake), Math.round(cy2 - 28 * sc), Math.round(48 * sc), Math.round(56 * sc));
      if (t > 0.5) {
        var hs = 2.2, hy = t < 0.58 ? W_H - (t - 0.5) / 0.08 * 58 : 54 + (Math.floor(now / 60) % 2), hand = wardHandSprite();
        g.drawImage(hand, Math.round(6 - shake), Math.round(hy), Math.round(16 * hs), Math.round(20 * hs));
        g.save(); g.translate(184, 0); g.scale(-1, 1); g.drawImage(hand, Math.round(6 + shake), Math.round(hy + 4), Math.round(16 * hs), Math.round(20 * hs)); g.restore();
        g.fillStyle = 'rgba(232,246,255,.75)';      // 유리에 간 금
        [[22, 60, 1, -1, 16], [24, 62, -1, -1, 10], [20, 64, -1, 1, 12], [160, 66, 1, -1, 14], [162, 64, -1, -1, 12], [158, 68, 1, 1, 10], [92, 8, 1, 1, 8], [90, 8, -1, 1, 6]].forEach(function (c) { var len = Math.min(c[4], Math.round((t - 0.5) * 60)); for (var q = 0; q < len; q++) g.fillRect(c[0] + c[2] * q, c[1] + c[3] * Math.round(q * 0.7), 1, 1); });
      }
      if (t > 0.9) { g.fillStyle = 'rgba(120,10,10,' + ((t - 0.9) * 6).toFixed(2) + ')'; g.fillRect(0, 0, 184, W_H); }
      cv.classList.toggle('ward-shake', t > 0.5 && t < 0.9);
    } else if (cv.classList.contains('ward-shake')) cv.classList.remove('ward-shake');
  }
/*
   * 3.3.1 합치기 판의 도트 그림. 칸 하나는 32×27 도트: 어두운 바닥 + 품목 그림(14×14).
   *   왜: 색 네모에 글자만 적힌 판은 "보는 재미"가 없었다. 품목이 눈으로 구분되고, 합칠수록 물건이 그럴듯해져야 한다.
   *   품목 그림은 BOX_ART[단계 - 1](g, x, y) 가 그린다. 아홉 가지를 돌려 쓰고, 한 바퀴 돌 때마다 모서리에 별이 하나 붙는다(이름의 ★과 같다).
   */
  function px(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }
  function spr(g, x, y, rows, pal) { for (var j = 0; j < rows.length; j++) for (var i = 0; i < rows[j].length; i++) { var c = pal[rows[j].charAt(i)]; if (c) px(g, x + i, y + j, 1, 1, c); } }
  var BK = '#17180f';
  var BOX_ART = [
    function (g, x, y) { spr(g, x, y + 3, ['....aa....b...', '..aAAa..bBb...', '.aAAAAa.bBBb.c', 'aAAaAAAabBBbcC', 'AAaAAaAAABBbCC', 'aAAAAAAaBBBBCC', 'kkkkkkkkkkkkkk'], { a: '#b0b0a8', A: '#8a8a82', b: '#a86a3a', B: '#7a4a2a', c: '#9a9a92', C: '#6a6a64', k: BK }); },
    function (g, x, y) { spr(g, x + 2, y, ['..hhhhhh..', '.hHHHHHHh.', 'hHHhhhhHHh', 'hHHHHHHHHh', '.hhhhhhhh.', '...sSSs...', '...sSss...', '...sSSs...', '...sSss...', '...sSSs...', '...sSss...', '...sSSs...', '....ss....'], { h: '#c9c7ba', H: '#e8e6dc', s: '#8a8a82', S: '#b0b0a8' }); },
    function (g, x, y) { for (var k = 0; k < 4; k++) { px(g, x + 1 + k, y + 10 - k * 3, 12, 2, '#7a9ab8'); px(g, x + 1 + k, y + 10 - k * 3, 12, 1, '#a8c4dc'); px(g, x + 1 + k, y + 12 - k * 3, 12, 1, '#4a6a88'); px(g, x + 3 + k, y + 10 - k * 3, 1, 1, '#e8f2fa'); } },
    function (g, x, y) { var c = '#5fb37a', d = '#3a8a56', l = '#8fd8a6'; px(g, x + 4, y + 2, 6, 10, c); px(g, x + 2, y + 4, 10, 6, c); px(g, x + 3, y + 3, 8, 8, c); [[6, 0], [6, 12], [0, 6], [12, 6]].forEach(function (t) { px(g, x + t[0], y + t[1], 2, 2, c); }); [[2, 2], [10, 2], [2, 10], [10, 10]].forEach(function (t) { px(g, x + t[0], y + t[1], 2, 2, d); }); px(g, x + 5, y + 5, 4, 4, BK); px(g, x + 6, y + 6, 2, 2, '#2a2c28'); px(g, x + 4, y + 3, 5, 1, l); px(g, x + 3, y + 4, 1, 4, l); px(g, x + 4, y + 11, 6, 1, d); px(g, x + 11, y + 5, 1, 5, d); },
    function (g, x, y) { var o = '#d8d8d0', d = '#8a8a82'; px(g, x + 4, y + 1, 6, 12, o); px(g, x + 2, y + 3, 10, 8, o); px(g, x + 1, y + 5, 12, 4, o); px(g, x + 5, y + 5, 4, 4, BK); px(g, x + 4, y + 6, 6, 2, BK); px(g, x + 6, y + 4, 2, 6, BK); [[6, 2], [10, 4], [11, 7], [9, 10], [5, 11], [2, 8], [3, 4]].forEach(function (t) { px(g, x + t[0], y + t[1], 2, 2, '#f0b400'); }); px(g, x + 4, y + 1, 5, 1, '#fff'); px(g, x + 5, y + 12, 5, 1, d); px(g, x + 12, y + 6, 1, 3, d); },
    function (g, x, y) { px(g, x + 1, y + 3, 10, 9, '#3f7fb8'); px(g, x + 1, y + 3, 10, 2, '#6aa8de'); px(g, x + 1, y + 10, 10, 2, '#2a5a88'); for (var k = 2; k < 10; k += 2) px(g, x + k, y + 5, 1, 5, '#2a5a88'); px(g, x + 11, y + 6, 3, 3, '#b0b0a8'); px(g, x + 11, y + 6, 3, 1, '#e8e6dc'); px(g, x, y + 5, 1, 5, '#2a5a88'); px(g, x + 2, y + 12, 3, 1, BK); px(g, x + 7, y + 12, 3, 1, BK); px(g, x + 4, y + 1, 4, 2, '#55564e'); },
    function (g, x, y) { px(g, x + 2, y + 2, 10, 10, '#e98a3c'); px(g, x + 2, y + 2, 10, 2, '#f8b070'); px(g, x + 2, y + 10, 10, 2, '#b0602a'); px(g, x, y + 4, 2, 3, '#b0b0a8'); px(g, x + 12, y + 7, 2, 3, '#b0b0a8'); px(g, x + 4, y + 5, 4, 4, BK); px(g, x + 5, y + 6, 2, 2, '#e98a3c'); px(g, x + 8, y + 4, 3, 3, BK); px(g, x + 9, y + 5, 1, 1, '#f8b070'); [[3, 3], [10, 3], [3, 10], [10, 10]].forEach(function (t) { px(g, x + t[0], y + t[1], 1, 1, '#7a3a1a'); }); px(g, x + 3, y + 12, 2, 1, BK); px(g, x + 9, y + 12, 2, 1, BK); },
    function (g, x, y) { px(g, x + 1, y + 5, 12, 7, '#c4402e'); px(g, x + 1, y + 5, 12, 1, '#e8684e'); px(g, x + 1, y + 10, 12, 2, '#8a2a20'); [2, 6, 10].forEach(function (k) { px(g, x + k, y + 1, 3, 4, '#8a8a82'); px(g, x + k, y + 1, 3, 1, '#d8d8d0'); px(g, x + k + 1, y, 1, 1, '#55564e'); }); px(g, x + 3, y + 7, 2, 2, BK); px(g, x + 7, y + 7, 2, 2, BK); px(g, x + 11, y + 7, 1, 2, BK); px(g, x, y + 7, 1, 3, '#55564e'); px(g, x + 13, y + 6, 1, 4, '#55564e'); px(g, x + 2, y + 12, 3, 1, BK); px(g, x + 9, y + 12, 3, 1, BK); },
    function (g, x, y) { px(g, x + 1, y + 2, 12, 10, '#f0b400'); px(g, x + 1, y + 2, 12, 2, '#ffd95a'); px(g, x + 1, y + 10, 12, 2, '#b88600'); px(g, x + 2, y + 4, 10, 5, BK); spr(g, x + 5, y + 4, ['..yy', '.yy.', 'yyyy', '.yy.', 'yy..'], { y: '#ffd95a' }); for (var k = 2; k < 12; k += 2) px(g, x + k, y + 10, 1, 1, BK); px(g, x + 3, y, 2, 2, '#55564e'); px(g, x + 9, y, 2, 2, '#55564e'); px(g, x + 3, y, 1, 1, '#ff5a4a'); px(g, x + 2, y + 12, 3, 1, BK); px(g, x + 9, y + 12, 3, 1, BK); }
  ];
  /** 칸 하나를 그린다: 바닥 → (상자가 있으면) 팔레트와 품목 → (짝이 있으면) 노란 모서리. */
  function drawBoxCell(cv, lv, pair) {
    var g = cv.getContext('2d'), W = 32, H = 27;
    // 바닥은 어둡고 잔무늬 없이: 품목만 눈에 들어오게 한다(나무 팔레트와 바닥 무늬를 넣었더니 화면이 어수선했다)
    px(g, 0, 0, W, H, '#30333a'); px(g, 0, 0, W, 1, '#454952'); px(g, 0, 0, 1, H, '#454952'); px(g, 0, H - 1, W, 1, '#1f2126'); px(g, W - 1, 0, 1, H, '#1f2126');
    if (!(lv >= 1)) return;
    var tier = Math.floor((lv - 1) / BOX_ART.length);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(9, 17, 14, 1);      // 물건 밑의 옅은 그림자
    BOX_ART[(lv - 1) % BOX_ART.length](g, 9, 3);
    for (var st = 0; st < Math.min(tier, 3); st++) spr(g, W - 7 - st * 6, 2, ['..#..', '#####', '.###.', '#.#.#'], { '#': '#ffd95a' });      // 한 바퀴 돌 때마다 별 하나
    // 짝 표시는 그림에 넣지 않는다: 대부분의 칸에 짝이 있어서 모서리 표시가 판을 뒤덮었다. 합칠 수 있는 상자는 아래 숫자가 노랗다
  }
  /** 판 위의 공장 벽: 높은 창, 천장 크레인, 고철이 떨어지는 투입구, 경광등. 한 번만 그린다. */
  function drawBoardTop() {
    var cv = $('mboard-top'); if (!cv || cv._done) return; cv._done = true;
    var g = cv.getContext('2d');
    px(g, 0, 0, 184, 30, '#22242a');
    for (var y = 0; y < 30; y += 5) for (var x = (y / 5 % 2) * 6 - 6; x < 184; x += 12) { px(g, x, y, 11, 4, '#2e3038'); px(g, x, y, 1, 1, '#3a3c46'); }
    [8, 150].forEach(function (wx) { px(g, wx, 4, 26, 16, BK); for (var i = 0; i < 4; i++) for (var j = 0; j < 2; j++) px(g, wx + 1 + i * 6, 5 + j * 7, 5, 6, j ? '#f0b878' : '#e89a62'); px(g, wx + 3, 7, 1, 1, '#fff2d0'); px(g, wx + 13, 12, 5, 6, '#3a2c30'); });
    px(g, 0, 0, 184, 2, BK); px(g, 0, 2, 184, 1, '#f0b400'); for (var rx = 0; rx < 184; rx += 8) px(g, rx, 2, 4, 1, BK);
    px(g, 118, 3, 10, 4, '#f0b400'); px(g, 118, 3, 10, 1, '#ffd95a'); px(g, 122, 7, 1, 8, '#8a8a82'); spr(g, 120, 15, ['.###.', '#...#', '#....', '.#..#', '..##.'], { '#': '#b0b0a8' });
    px(g, 44, 4, 34, 3, '#55564e'); px(g, 46, 7, 30, 2, '#3c4048');
    spr(g, 50, 9, ['hhhhhhhhhhhhhhhhhhhhhh', '.hHHHHHHHHHHHHHHHHHHh.', '..hHHHHHHHHHHHHHHHHh..', '...hHHHHHHHHHHHHHHh...', '....hhhhhhhhhhhhhh....'], { h: '#3c4048', H: '#6a707c' });
    px(g, 57, 14, 8, 6, '#30343c'); px(g, 58, 20, 6, 3, BK); px(g, 60, 10, 1, 1, '#b0b0a8'); px(g, 64, 11, 1, 1, '#a86a3a'); px(g, 68, 10, 1, 1, '#9a9a92'); px(g, 56, 11, 1, 1, '#8a8a82');
    px(g, 60, 24, 1, 1, '#b0b0a8'); px(g, 62, 26, 1, 1, '#a86a3a'); px(g, 61, 28, 1, 1, '#8a8a82');
    px(g, 88, 5, 24, 13, BK); px(g, 89, 6, 22, 11, '#f0b400'); px(g, 89, 6, 22, 1, '#ffd95a'); spr(g, 97, 8, ['#####', '....#', '....#', '.####', '....#', '....#', '#####'], { '#': BK }); px(g, 92, 10, 2, 3, BK); px(g, 106, 10, 2, 3, BK);
    px(g, 36, 6, 3, 3, BK); px(g, 37, 7, 1, 1, '#ff5a4a'); g.fillStyle = 'rgba(255,90,74,.2)'; g.fillRect(33, 3, 9, 9);
    px(g, 4, 29, 176, 1, '#f0b400'); for (var sx = 4; sx < 180; sx += 6) px(g, sx + 3, 29, 3, 1, BK);
  }
  function renderBoard() {
    var mb = $('mboard'); if (!mb || !mb.children.length) return;
    drawBoardTop();
    var board = state.board || [], can = {}, size = C.boardSize(state), held = C.heldLevel(state); C.mergeable(state).forEach(function (i) { can[i] = true; });
    for (var i = 0; i < mb.children.length; i++) {
      var b = mb.children[i], lv = board[i] || 0, fx = boardFx[i];
      if (b.hidden !== (i >= size)) b.hidden = i >= size;
      if (i >= size) continue;
      if (boardSeen && !fx && lv >= 1 && boardSeen[i] !== lv) fx = lv === 1 && !(boardSeen[i] >= 1) ? { 'in': true } : { pop: true };      // 고철이 들어왔거나, 알아서 합쳐졌다
      var rate = lv ? '+' + fmt(C.boxRate(state, lv)) : '', want = held && lv === held, sig = lv + (can[i] ? 'p' : '') + (want ? 'w' : '') + '|' + rate;
      if (b._sig !== sig || fx) {
        if (!b._cv) { b._cv = document.createElement('canvas'); b._cv.width = 32; b._cv.height = 27; b._name = el('b'); b._rate = el('small'); b.appendChild(b._cv); b.appendChild(b._name); b.appendChild(b._rate); }
        if (b._art !== lv + (can[i] ? 'p' : '')) { b._art = lv + (can[i] ? 'p' : ''); drawBoxCell(b._cv, lv, !!can[i]); }
        b._sig = sig;
        b.className = (lv && can[i] ? 'pair' : '') + (want ? ' want' : '');
        setText(b._name, lv ? C.boxName(lv) : ''); setText(b._rate, rate);
        b.setAttribute('aria-label', lv ? C.boxName(lv) + ' ' + lv + '단계' + (can[i] ? ', 합칠 수 있음' : '') + (want ? ', 의뢰가 찾는 상자' : '') : '빈칸');
        var old = b.querySelector('i'); if (old) b.removeChild(old);
        if (fx && lv) {
          b._cv.style.animationDelay = (fx.delay || 0) + 'ms';
          void b.offsetWidth; b.classList.add(fx.pop ? 'mb-pop' : 'mb-in');      // 'pop' · 'in' 은 다른 곳(떠오르는 숫자)의 클래스라 칸이 통째로 투명해졌다. 판만의 이름을 쓴다
          if (fx.gain > 0) { var gi = el('i', '', '+' + fmt(fx.gain)); gi.style.animationDelay = (fx.delay || 0) + 'ms'; b.appendChild(gi); }
        }
      }
    }
    boardFx = {}; boardSeen = board.slice();
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
      if (!$('push-' + def.id)) return;      // 7구역의 직접 방송 단추는 주파수 맞추기로 바뀌었다(3.1.0)
      $('push-' + def.id).addEventListener('click', function () {
        var r = C.pushZone(state, def.id);
        if (!r.ok) return;
        log(def.id === 'guard' ? '초소를 한 바퀴 돈다. ' + r.seconds + '초 동안 통행 물자가 ' + C.PUSH_MULT + '배다.' : '마이크를 잡았다. ' + r.seconds + '초 동안 생존자가 ' + C.PUSH_MULT + '배로 모인다.', 'good');
        sfx('signal'); buzz(25); Store.save(); render();
      });
    });
  }
  /*
   * ---------- 7구역: 주파수와 정착지(3.1.0) ----------
   * 주파수: 바늘은 0.1초마다 그려진다(frame). 띠 안에 있을 때 "지금 맞춘다"를 누르면 먼 무리가 온다.
   * 정착지: 건물 아홉을 3 × 3 으로 놓는다. 세로 줄이 한 줄기다. 아직 앞 건물을 짓지 않은 칸은 이름도 효과도 '???'.
   */
  function renderTune() {
    var rate = C.survivorRate(state), t = state.tune, cool = t.cool > 0, band = C.tuneBand(state), dial = $('t7-dial'), btn = $('t7-tune');
    $('t7-needle').style.left = (C.tunePos(state) * 100).toFixed(2) + '%';
    $('t7-band').style.left = ((t.band - band / 2) * 100).toFixed(1) + '%'; $('t7-band').style.width = (band * 100).toFixed(1) + '%';
    dial.classList.toggle('cool', cool || !(rate > 0));
    setText($('t7-freq'), (87.5 + C.tunePos(state) * 20.5).toFixed(1) + ' MHz');
    setText($('t7-gain'), rate > 0 ? '+' + fmt(Math.floor(C.tuneGain(state))) + '명' : '');
    btn.disabled = cool || !(rate > 0);
    setText(btn, !(rate > 0) ? '안테나를 먼저 세워요' : cool ? '다시 잡는 중 ' + Math.ceil(t.cool) + '초' : '주파수 맞추기');
    fill(btn, cool ? 1 - t.cool / C.TUNE_COOL : 0);
  }
  function wireTower() {
    wireCamp();
    $('t7-tune').addEventListener('click', function () {
      var r = C.tuneNow(state, Math.random), dial = $('t7-dial');
      if (!r.ok) return;
      dial.classList.remove('hit', 'miss'); void dial.offsetWidth; dial.classList.add(r.hit ? 'hit' : 'miss');
      if (r.hit) { if (campPopFn) campPopFn(22, 60, '+' + fmt(Math.floor(r.gain)) + '명', 'done'); log('주파수를 맞췄다. 먼 무리가 응답했다. 생존자 ' + fmt(Math.floor(r.gain)) + '명.', 'good'); sfx('answer'); buzz(25); }
      else { if (campPopFn) campPopFn(22, 60, '잡음뿐이에요', 'bad'); sfx('tab'); }
      Store.save(); render();
    });
  }
  /*
   * ---------- 4.2.0 7구역 정착지 지도(184×128) ----------
   *   왼쪽: 송신탑(누르면 주파수를 맞춘다)과 문, 문 앞에 모인 사람들. 오른쪽: 아홉 자리(가로 = 살림 · 혈청 · 방어, 세로 = 줄의 차례).
   *   자리를 누르면 문 앞의 사람이 한 무리 길을 따라 걸어가 놓인다. 건물은 3단계까지 자라고 단계마다 그림이 달라진다(CAMP_ART).
   *   습격이 오면 어두워지고, 울타리 한쪽(북 · 동 · 남) 밖에 무리가 붙는다. 그쪽 울타리나 붉은 단추를 누르면 사람을 세운다.
   *   바탕(campBackdrop)은 한 번만 그리고, 건물 · 사람 · 불빛은 매번 그린다.
   */
  var CAMP_PX = [57, 96, 135], CAMP_PY = [13, 49, 85], CAMP_W = 38, CAMP_H = 28, CAMP_COL = ['#7fb85a', '#6aaede', '#e98a3c'];
  var campBack = null, campWalk = [], campFlash = null, campPopFn = null, campSel = '';
  function campPlot(d) { return { x: CAMP_PX[d.col], y: CAMP_PY[d.row] }; }
  function campBackdrop() {
    if (campBack) return campBack;
    var cv = document.createElement('canvas'); cv.width = 184; cv.height = 128; var g = cv.getContext('2d'), K = '#10140e';
    var R = function (x, y, w, h, c) { px(g, x, y, w, h, c); };
    R(0, 0, 184, 128, '#263022'); for (var y0 = 0; y0 < 128; y0 += 3) for (var x0 = (y0 * 7) % 11; x0 < 184; x0 += 11) R(x0, y0, 3, 1, (x0 * 3 + y0) % 4 ? '#2c3828' : '#20281c');      // 울타리 밖(어두운 들)
    R(3, 9, 172, 110, '#2e3a2a'); for (var y = 9; y < 119; y += 3) for (var x = 3 + (y * 7) % 11; x < 175; x += 11) R(x, y, 3, 1, (x * 3 + y) % 4 ? '#35432f' : '#283224');      // 안쪽 풀밭
    for (var i = 0; i < 60; i++) { var gx = 4 + (i * 53) % 170, gy = 10 + (i * 31) % 108; R(gx, gy, 1, 2, i % 5 ? '#44563a' : '#6a7a42'); if (i % 9 === 0) R(gx + 2, gy, 1, 1, '#e8d86a'); }
    function roadH(x, y, w, h) { R(x, y, w, h, '#74694f'); R(x, y, w, 1, '#857a5e'); R(x, y + h - 1, w, 1, '#5c523c'); for (var k = x + 2; k < x + w - 2; k += 6) { R(k, y + 2, 3, 1, '#685e46'); R(k + 3, y + h - 3, 3, 1, '#685e46'); } for (var k2 = x; k2 < x + w; k2 += 13) { R(k2 + 4, y - 1, 2, 1, '#44563a'); R(k2 + 9, y + h, 3, 1, '#44563a'); } }
    roadH(0, 78, 50, 7); R(48, 11, 8, 106, '#74694f'); R(48, 11, 1, 106, '#857a5e'); R(55, 11, 1, 106, '#5c523c'); for (var vy = 13; vy < 115; vy += 6) { R(50, vy, 1, 3, '#685e46'); R(53, vy + 3, 1, 3, '#685e46'); }
    roadH(56, 42, 118, 7); roadH(56, 78, 118, 7);
    function fenceH(y) { R(3, y + 1, 173, 1, '#a8854f'); R(3, y + 3, 173, 1, '#7a5f38'); for (var fx = 3; fx < 176; fx += 5) { R(fx, y, 1, 5, '#c9a868'); R(fx, y, 1, 1, '#e8cf98'); } for (var b = 5; b < 175; b += 4) R(b, y - 1, 1, 1, '#8a8f98'); }
    function fenceV(x, a0, a1) { R(x + 1, a0, 1, a1 - a0, '#a8854f'); for (var fy = a0; fy < a1; fy += 5) { R(x, fy, 3, 1, '#c9a868'); R(x, fy + 1, 3, 1, '#7a5f38'); } }
    fenceH(6); fenceH(117); fenceV(2, 8, 75); fenceV(2, 89, 119); fenceV(174, 8, 119);
    R(0, 73, 6, 3, K); R(0, 88, 6, 3, K); R(1, 69, 4, 5, '#55564e'); R(1, 89, 4, 5, '#55564e'); R(1, 68, 4, 1, '#f0b400'); R(1, 94, 4, 1, '#f0b400');
    function tree(x, y) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, y + 10, 8, 2); R(x + 3, y + 7, 2, 4, '#4a3428'); R(x + 1, y + 1, 6, 7, '#335230'); R(x, y + 3, 8, 3, '#335230'); R(x + 2, y, 4, 9, '#335230'); R(x + 2, y + 1, 3, 3, '#4f7446'); R(x + 1, y + 3, 2, 2, '#4f7446'); R(x + 5, y + 5, 2, 2, '#26401f'); }
    [[6, 14], [37, 15], [8, 100], [35, 103], [38, 62], [21, 106]].forEach(function (q) { tree(q[0], q[1]); });
    // 송신소(탑은 drawCamp 가 그린다: 등이 깜빡인다)
    g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(12, 62, 28, 2);
    R(9, 52, 28, 10, K); R(10, 52, 26, 9, '#d8d4c4'); R(10, 52, 26, 2, '#b8b4a4'); R(8, 44, 30, 9, K); R(9, 45, 28, 7, '#7a4f24'); R(9, 45, 28, 1, '#a8743a'); R(9, 51, 28, 1, '#5a3818'); for (var rk = 3; rk < 7; rk += 3) R(10, 45 + rk, 26, 1, '#5a3818'); R(26, 54, 5, 7, '#3a3a36'); R(27, 55, 3, 5, '#55564e'); R(29, 58, 1, 1, '#f0b400');
    R(30, 99, 5, 1, '#55564e'); R(31, 98, 3, 1, '#4a3428');      // 모닥불 자리
    return (campBack = cv);
  }
  /* 건물 그림: CAMP_ART[id](g, x, y, lv, L). 38×28 자리 안에 그린다. L(x, y, w, h)는 창(밤에 불이 켜진다). 단계가 오르면 덧붙는다 */
  var CAMP_ART = (function () {
    var K = '#10140e';
    function R(g, x, y, w, h, c) { px(g, x, y, w, h, c); }
    function sh(g, x, y, w) { g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x + 2, y, w, 2); g.fillRect(x + 4, y + 2, w - 2, 1); }
    function house(g, x, y, w, hw, hr, wall, wallD, roof, roofL, roofD) {
      sh(g, x, y + hr + hw, w);
      R(g, x, y + hr, w, hw, K); R(g, x + 1, y + hr, w - 2, hw - 1, wall); R(g, x + 1, y + hr, w - 2, 2, wallD); R(g, x + w - 3, y + hr, 2, hw - 1, wallD);
      R(g, x - 1, y, w + 2, hr + 1, K); R(g, x, y + 1, w, hr - 1, roof); R(g, x, y + 1, w, 1, roofL); R(g, x, y + hr - 1, w, 1, roofD);
      for (var k = 3; k < hr - 1; k += 3) R(g, x + 1, y + k, w - 2, 1, roofD); for (var q = 3 + (y % 2); q < w - 1; q += 5) R(g, x + q, y + 2, 1, hr - 3, 'rgba(0,0,0,.13)');
    }
    function bags(g, x, y, n) { for (var k = 0; k < n; k++) { R(g, x + k * 6, y, 6, 4, '#a89a6a'); R(g, x + k * 6, y, 6, 1, '#c9bc8a'); R(g, x + k * 6, y + 3, 6, 1, '#7a6e48'); } }
    function tent(g, x, y, c1, c2) { sh(g, x, y + 9, 9); for (var a = 0; a < 9; a++) R(g, x + a, y + 4 - Math.min(a, 8 - a), 1, Math.min(a, 8 - a) + 5, a < 4 ? c1 : c2); R(g, x + 3, y + 6, 3, 3, '#3a3a36'); }
    function crates(g, x, y, n) { for (var k = 0; k < n; k++) { var cx = x + (k % 2) * 5, cy = y - Math.floor(k / 2) * 4; R(g, cx, cy, 5, 4, K); R(g, cx + 1, cy + 1, 3, 2, k % 3 ? '#a8854f' : '#c9a868'); } }
    return {
      farm: function (g, x, y, lv, L) {
        var top = lv >= 3 ? 16 : 3; R(g, x + 2, y + top, 34, 27 - top, '#5a4630'); for (var k = 0; top + 1 + k * 3 < 25; k++) { R(g, x + 3, y + top + 1 + k * 3, 32, 2, '#6b5238'); for (var q = 0; q < 8; q++) { R(g, x + 4 + q * 4, y + top + k * 3, 1, 2, '#7fb85a'); R(g, x + 5 + q * 4, y + top + 1 + k * 3, 1, 1, (q + k) % 3 ? '#a8d86a' : '#d8644e'); } }
        if (lv < 3) { R(g, x + 30, y + 8, 1, 8, '#8a6a42'); R(g, x + 28, y + 10, 5, 1, '#8a6a42'); R(g, x + 29, y + 6, 3, 3, '#e8c890'); R(g, x + 29, y + 6, 3, 1, '#c9a868'); }
        if (lv === 2) { R(g, x + 3, y + 4, 7, 9, K); R(g, x + 4, y + 5, 5, 7, '#6a8aa0'); R(g, x + 4, y + 5, 5, 2, '#9ab8c8'); }
        if (lv >= 3) { sh(g, x + 2, y + 14, 22); R(g, x + 2, y + 2, 23, 13, K); R(g, x + 3, y + 3, 21, 11, '#8ac8c0'); R(g, x + 3, y + 3, 21, 4, '#b8e8e0'); for (var v = 0; v < 21; v += 5) R(g, x + 3 + v, y + 3, 1, 11, '#e8f6f0'); R(g, x + 3, y + 7, 21, 1, '#e8f6f0'); for (var s = 0; s < 4; s++) { R(g, x + 5 + s * 5, y + 10, 3, 3, '#4f9a4a'); R(g, x + 6 + s * 5, y + 9, 1, 1, '#d8644e'); } R(g, x + 28, y + 3, 7, 9, K); R(g, x + 29, y + 4, 5, 7, '#6a8aa0'); R(g, x + 29, y + 4, 5, 2, '#9ab8c8'); R(g, x + 30, y + 12, 1, 3, '#55564e'); R(g, x + 33, y + 12, 1, 3, '#55564e'); }
      },
      mess: function (g, x, y, lv, L) {
        var w = lv >= 3 ? 30 : 24; house(g, x + 3, y + 2, w, 10, 8, '#c8a878', '#a88a5c', '#b8402e', '#d8644e', '#8a2a20'); R(g, x + 21, y - 1, 4, 5, K); R(g, x + 22, y, 2, 4, '#8a8a82');
        for (var a = 0; a < w; a += 4) R(g, x + 3 + a, y + 10, 2, 3, a % 8 ? '#e8e6dc' : '#d8453a'); L(x + 6, y + 14, 4, 3); L(x + 19, y + 14, 4, 3); R(g, x + 12, y + 14, 4, 6, '#4a3428'); if (lv >= 3) { L(x + 27, y + 14, 3, 3); R(g, x + 8, y - 1, 3, 4, K); R(g, x + 9, y, 1, 3, '#8a8a82'); }
        if (lv >= 2) [[lv >= 3 ? 4 : 29, lv >= 3 ? 23 : 12], [lv >= 3 ? 16 : 29, lv >= 3 ? 23 : 20], [lv >= 3 ? 28 : 99, 23]].forEach(function (q) { if (q[0] > 40) return; R(g, x + q[0], y + q[1], 7, 4, K); R(g, x + q[0] + 1, y + q[1] + 1, 5, 2, '#a8743a'); R(g, x + q[0] + 2, y + q[1] + 1, 1, 1, '#e8e6dc'); });
      },
      store: function (g, x, y, lv, L) {
        if (lv === 1) { house(g, x + 4, y + 6, 18, 9, 6, '#8a8a82', '#6a6a62', '#55585f', '#7a7e86', '#3a3c42'); R(g, x + 10, y + 13, 6, 8, '#3a3a36'); crates(g, x + 25, y + 20, 3); return; }
        house(g, x + 2, y + 2, 26, 12, 9, '#a8743a', '#8a5a2a', '#7a2a20', '#a84030', '#5a1a14'); R(g, x + 10, y + 12, 10, 11, K); R(g, x + 11, y + 13, 8, 10, '#5a3818'); R(g, x + 15, y + 13, 1, 10, K); R(g, x + 11, y + 13, 8, 1, '#e8e6dc'); R(g, x + 13, y + 5, 4, 3, '#e8e6dc'); crates(g, x + 29, y + 22, lv >= 3 ? 6 : 4);
        if (lv >= 3) { R(g, x + 1, y + 23, 9, 4, K); R(g, x + 2, y + 24, 7, 2, '#4a6a3a'); R(g, x + 7, y + 22, 3, 2, '#9ab8c8'); R(g, x + 2, y + 26, 2, 1, '#17180f'); R(g, x + 7, y + 26, 2, 1, '#17180f'); }
      },
      clinic: function (g, x, y, lv, L) {
        if (lv === 1) { tent(g, x + 5, y + 8, '#f0f0e8', '#c8c8be'); tent(g, x + 20, y + 10, '#f0f0e8', '#c8c8be'); R(g, x + 16, y + 3, 1, 12, '#8a8f98'); R(g, x + 17, y + 3, 6, 5, '#fff'); R(g, x + 19, y + 4, 2, 3, '#d8453a'); R(g, x + 18, y + 5, 4, 1, '#d8453a'); return; }
        house(g, x + 3, y + 2, 22, 11, 8, '#e8e6dc', '#c4c2b6', '#6aaede', '#9ad0e8', '#3f7f9a'); R(g, x + 11, y + 3, 6, 6, '#fff'); R(g, x + 13, y + 4, 2, 4, '#d8453a'); R(g, x + 12, y + 5, 4, 2, '#d8453a'); L(x + 6, y + 13, 4, 4); L(x + 18, y + 13, 4, 4); R(g, x + 12, y + 14, 4, 7, '#55564e'); R(g, x + 13, y + 15, 2, 5, '#8aa0aa');
        tent(g, x + 27, y + 15, '#f0f0e8', '#c8c8be'); R(g, x + 31, y + 15, 1, 1, '#d8453a');
        if (lv >= 3) { R(g, x + 26, y + 5, 10, 6, K); R(g, x + 27, y + 6, 8, 4, '#f0f0e8'); R(g, x + 27, y + 6, 3, 2, '#9ab8c8'); R(g, x + 31, y + 7, 3, 2, '#d8453a'); R(g, x + 28, y + 10, 2, 1, '#17180f'); R(g, x + 33, y + 10, 2, 1, '#17180f'); }
      },
      lab7: function (g, x, y, lv, L) {
        house(g, x + 3, y + 3, 24, 12, 7, '#b8c8d4', '#98a8b4', '#3f5f7a', '#5a7f9a', '#2c4458'); for (var k = 0; k < 3; k++) { R(g, x + 6 + k * 7, y + 1, 4, 3, K); R(g, x + 7 + k * 7, y + 2, 2, 2, '#8a8f98'); } L(x + 6, y + 13, 5, 4, '#b8f08a'); L(x + 15, y + 13, 5, 4, '#b8f08a'); R(g, x + 22, y + 14, 4, 7, '#55564e');
        if (lv >= 2) { R(g, x + 31, y + 12, 1, 10, '#8a8f98'); R(g, x + 28, y + 7, 7, 5, K); R(g, x + 29, y + 8, 5, 3, '#c9d0d8'); R(g, x + 30, y + 9, 3, 1, '#8a8f98'); }
        if (lv >= 3) { R(g, x + 28, y + 18, 8, 9, K); R(g, x + 29, y + 19, 6, 7, '#4a6a5a'); L(x + 30, y + 20, 4, 4, '#b8f08a'); R(g, x + 27, y + 22, 2, 1, '#8a8f98'); }
      },
      ward: function (g, x, y, lv, L) {
        for (var k = 0; k < 38; k += 4) { R(g, x + k, y + 1, 1, 3, '#8a8f98'); R(g, x + k, y + 25, 1, 3, '#8a8f98'); } R(g, x, y + 2, 38, 1, '#b4b8c0'); R(g, x, y + 26, 38, 1, '#b4b8c0');
        if (lv === 1) { tent(g, x + 4, y + 9, '#e0d8a0', '#b8b078'); tent(g, x + 15, y + 11, '#e0d8a0', '#b8b078'); tent(g, x + 26, y + 9, '#e0d8a0', '#b8b078'); return; }
        house(g, x + 4, y + 5, 26, 10, 7, '#d8d4c4', '#b8b4a4', '#55585f', '#7a7e86', '#3a3c42'); for (var a = 0; a < 26; a += 4) R(g, x + 4 + a, y + 12, 2, 2, a % 8 ? '#f0b400' : '#17180f'); L(x + 7, y + 15, 3, 3); L(x + 13, y + 15, 3, 3); L(x + 19, y + 15, 3, 3); R(g, x + 25, y + 15, 3, 6, '#3a3a36');
        if (lv >= 3) { R(g, x + 33, y + 6, 1, 16, '#8a8f98'); R(g, x + 32, y + 5, 3, 2, '#55564e'); L(x + 32, y + 7, 3, 1, '#fff2c0'); }
      },
      guard7: function (g, x, y, lv, L) {
        if (lv >= 2) { house(g, x + 2, y + 3, 20, 9, 7, '#6a7a4a', '#55643a', '#4a6a3a', '#6a8a52', '#34502a'); L(x + 5, y + 12, 3, 3); R(g, x + 12, y + 12, 4, 7, '#2a2e26'); } else tent(g, x + 7, y + 6, '#6a8a52', '#4a6a3a');
        bags(g, x + 2, y + 23, 6); for (var k3 = 0; k3 < 5; k3++) { R(g, x + 5 + k3 * 6, y + 20, 6, 3, '#958858'); R(g, x + 5 + k3 * 6, y + 20, 6, 1, '#b8ab78'); } if (lv >= 3) for (var k4 = 0; k4 < 4; k4++) { R(g, x + 8 + k4 * 6, y + 17, 6, 3, '#a89a6a'); R(g, x + 8 + k4 * 6, y + 17, 6, 1, '#c9bc8a'); }
        R(g, x + 30, y + 2, 1, 16, '#8a8f98'); R(g, x + 31, y + 2, 6, 4, '#e98a3c'); R(g, x + 31, y + 2, 6, 1, '#ffb060'); R(g, x + 33, y + 3, 2, 2, '#17180f'); if (lv >= 2) { R(g, x + 25, y + 18, 7, 1, '#17180f'); R(g, x + 26, y + 19, 2, 2, '#3a3a36'); } if (lv >= 3) L(x + 24, y + 9, 2, 2, '#fff2c0');
      },
      watch: function (g, x, y, lv, L) {
        var top = lv === 1 ? 8 : 0; sh(g, x + 10, y + 26, 18); R(g, x + 11, y + 12 + top, 2, 15 - top, '#8a6a42'); R(g, x + 25, y + 12 + top, 2, 15 - top, '#8a6a42'); for (var k = 0; k < 14 - top; k++) { R(g, x + 12 + k, y + 13 + top + k, 1, 1, '#6b5238'); R(g, x + 25 - k, y + 13 + top + k, 1, 1, '#6b5238'); } R(g, x + 18, y + 12 + top, 2, 15 - top, '#a8854f'); for (var l = 0; l < 14 - top; l += 3) R(g, x + 17, y + 13 + top + l, 4, 1, '#c9a868');
        R(g, x + 8, y + 6 + top, 22, 7, K); R(g, x + 9, y + 7 + top, 20, 5, '#a8854f'); R(g, x + 9, y + 7 + top, 20, 1, '#c9a868'); for (var q = 0; q < 20; q += 4) R(g, x + 9 + q, y + 8 + top, 1, 4, '#7a5f38'); R(g, x + 7, y + 1 + top, 24, 4, K); R(g, x + 8, y + 2 + top, 22, 2, '#7a4f24'); R(g, x + 8, y + 2 + top, 22, 1, '#a8743a'); R(g, x + 12, y + 4 + top, 1, 3, '#8a6a42'); R(g, x + 26, y + 4 + top, 1, 3, '#8a6a42'); R(g, x + 17, y + 4 + top, 3, 3, '#e6c9a0'); R(g, x + 17, y + 4 + top, 3, 1, '#3a3028');
        if (lv >= 2) { R(g, x + 27, y + 5, 4, 3, '#55564e'); L(x + 31, y + 5, 2, 3, '#fff2c0'); } if (lv >= 3) { R(g, x + 7, y + 5, 4, 3, '#55564e'); L(x + 5, y + 5, 2, 3, '#fff2c0'); R(g, x + 19, y - 3, 1, 5, '#8a8f98'); R(g, x + 20, y - 3, 4, 3, '#e98a3c'); }
      },
      school: function (g, x, y, lv, L) {
        var w = lv >= 3 ? 30 : 22; house(g, x + 3, y + 4, w, 11, 7, '#e8d8a8', '#c8b888', '#3a7a5a', '#5a9a7a', '#2a5a40'); R(g, x + 11, y, 6, 5, K); R(g, x + 12, y + 1, 4, 4, '#e8d8a8'); R(g, x + 13, y + 2, 2, 2, '#f0b400'); L(x + 6, y + 14, 4, 4); L(x + 18, y + 14, 4, 4); R(g, x + 12, y + 15, 4, 7, '#4a3428'); if (lv >= 3) L(x + 27, y + 14, 4, 4);
        if (lv >= 2) { var sx = lv >= 3 ? 4 : 28; R(g, x + sx, y + 23, 1, 4, '#8a8f98'); R(g, x + sx + 6, y + 23, 1, 4, '#8a8f98'); R(g, x + sx, y + 23, 7, 1, '#8a8f98'); R(g, x + sx + 2, y + 24, 1, 2, '#d8644e'); R(g, x + sx + 4, y + 24, 1, 2, '#6aaede'); }
      }
    };
  })();
  function drawCamp() {
    var cv = $('campscene'); if (!cv) return;
    var g = cv.getContext('2d'), now = Date.now(), c = C.campOf(state), n = c.night, K = '#10140e', lights = [];
    var R = function (x, y, w, h, col) { px(g, x, y, w, h, col); }, L = function (x, y, w, h, col) { lights.push([x, y, w, h, col || '#ffe9a0']); R(x, y, w, h, '#4a5a66'); };
    g.imageSmoothingEnabled = false; g.drawImage(campBackdrop(), 0, 0);
    // 송신탑: 격자 탑과 깜빡이는 붉은 등, 전파
    for (var ty = 12; ty < 44; ty++) { var hw = 1 + ((ty - 12) / 5 | 0); R(23 - hw, ty, 1, 1, '#c9d0d8'); R(23 + hw, ty, 1, 1, '#8a8f98'); if (ty % 5 === 2) R(23 - hw, ty, hw * 2 + 1, 1, '#a0a6b0'); if (ty % 5 === 4 && hw > 1) { R(23 - hw + 1, ty, 1, 1, '#6a6f78'); R(23 + hw - 1, ty + 1, 1, 1, '#6a6f78'); R(23, ty, 1, 1, '#6a6f78'); } }
    var blink = Math.floor(now / 500) % 2; R(22, 9, 3, 3, blink ? '#ff5a4a' : '#8a2a20'); R(23, 7, 1, 2, '#c9d0d8'); if (blink) lights.push([20, 7, 7, 7, 'rgba(255,90,74,.3)']);
    var wavesOn = state.antennas > 0, tuneHot = state.tune && state.tune.cool > C.TUNE_COOL - 1.2;
    if (wavesOn) [[28, 14, 7], [31, 11, 11], [34, 8, 15]].forEach(function (q, i) { if (!tuneHot && (Math.floor(now / 350) + i) % 4 === 3) return; for (var a = 0; a < q[2]; a++) R(q[0] + Math.round(Math.sin(a / (q[2] - 1) * Math.PI) * 2), q[1] + a, 1, 1, tuneHot ? '#ffd95a' : 'rgba(240,180,0,.55)'); });
    L(13, 55, 5, 4);
    var ff = Math.floor(now / 140) % 2; R(32, 96 - ff, 1, 2 + ff, '#ffd95a'); R(31, 97, 3, 1, '#f08a3a'); lights.push([28, 93, 9, 7, 'rgba(240,138,58,.28)']);
    // 아홉 자리
    C.SETTLE.forEach(function (d) {
      var p = campPlot(d), lv = C.settleLv(state, d.id), why = C.settleBlock(state, d.id), work = C.settleWork(state, d.id), need = C.settleNeed(state, d.id), broken = C.settleBroken(state, d.id), col = CAMP_COL[d.col];
      if (lv > 0) { R(p.x, p.y, CAMP_W, CAMP_H, '#4c4638'); R(p.x, p.y, CAMP_W, 1, '#5e5848'); R(p.x, p.y + CAMP_H - 1, CAMP_W, 1, '#373226'); CAMP_ART[d.id](g, p.x, p.y, lv, L);
        for (var k = 0; k < 3; k++) { R(p.x + 12 + k * 5, p.y - 3, 4, 2, K); R(p.x + 13 + k * 5, p.y - 3, 2, 1, k < lv ? col : '#3a4636'); }
        if (broken) { g.fillStyle = 'rgba(20,10,6,.5)'; g.fillRect(p.x, p.y, CAMP_W, CAMP_H); for (var f = 0; f < 3; f++) { var fx = p.x + 8 + f * 10, fl = Math.floor(now / 120 + f) % 2; R(fx, p.y + 12 - fl, 3, 4 + fl, '#f08a3a'); R(fx + 1, p.y + 10 - fl, 1, 3, '#ffd95a'); lights.push([fx - 2, p.y + 8, 7, 9, 'rgba(240,138,58,.3)']); var sa = ((now + f * 700) % 2400) / 2400; R(fx + 1 + Math.round(sa * 3), Math.round(p.y + 8 - sa * 10), 2, 1, 'rgba(60,56,64,' + (0.8 - sa * 0.7).toFixed(2) + ')'); } }
      } else {
        var lock = why === 'prev' || why === 'locked', dc = lock ? '#3e4a38' : '#9aaa8a';
        for (var e = 0; e < CAMP_W; e += 4) { R(p.x + e, p.y, 2, 1, dc); R(p.x + e, p.y + CAMP_H - 1, 2, 1, dc); } for (var e2 = 0; e2 < CAMP_H; e2 += 4) { R(p.x, p.y + e2, 1, 2, dc); R(p.x + CAMP_W - 1, p.y + e2, 1, 2, dc); }
        if (lock) { R(p.x + 16, p.y + 13, 6, 5, '#343e2e'); R(p.x + 17, p.y + 11, 4, 3, '#343e2e'); R(p.x + 18, p.y + 12, 2, 2, '#2e3a2a'); } else if (!(work > 0)) { R(p.x + 13, p.y + 11, 12, 5, K); R(p.x + 14, p.y + 12, 10, 3, col); R(p.x + 18, p.y + 10, 2, 7, '#fff'); R(p.x + 15, p.y + 13, 8, 1, '#fff'); }
      }
      if (work > 0 && need > 0) {      // 놓는 중: 비계와 차오르는 줄
        for (var s = 0; s < 4; s++) R(p.x + 3 + s * 10, p.y + 3, 1, 22, '#c9a868'); R(p.x + 3, p.y + 3, 31, 1, '#c9a868'); R(p.x + 3, p.y + 11, 31, 1, '#a88a50'); R(p.x + 3, p.y + 19, 31, 1, '#a88a50'); for (var dd = 0; dd < 30; dd += 3) R(p.x + 4 + dd, p.y + 5 + ((dd / 3) % 2) * 3, 1, 1, '#8a7040');
        R(p.x + 1, p.y + CAMP_H - 4, CAMP_W - 2, 4, K); R(p.x + 2, p.y + CAMP_H - 3, Math.max(1, Math.round((CAMP_W - 4) * work / need)), 2, '#f0b400');
      }
      if (c.flag === d.id) { var bc = '#e8e6dc', X = p.x - 2, Y = p.y - 2, W = CAMP_W + 4, H = CAMP_H + 4; R(X, Y, 5, 1, bc); R(X, Y, 1, 5, bc); R(X + W - 5, Y, 5, 1, bc); R(X + W - 1, Y, 1, 5, bc); R(X, Y + H - 1, 5, 1, bc); R(X, Y + H - 5, 1, 5, bc); R(X + W - 5, Y + H - 1, 5, 1, bc); R(X + W - 1, Y + H - 5, 1, 5, bc); }
    });
    // 사람(3×6)
    var SH = ['#3f5f7a', '#8a8a52', '#b8402e', '#6b4a3a', '#c9c7ba', '#5a7a3a', '#9a5ac8', '#d8a03a'];
    function man(x, y, i, carry, gun) { x = Math.round(x); y = Math.round(y); R(x, y + 6, 3, 1, 'rgba(0,0,0,.3)'); R(x, y, 3, 2, '#e6c9a0'); R(x, y, 3, 1, i % 3 ? '#3a3028' : i % 2 ? '#6b4a3a' : '#17180f'); R(x, y + 2, 3, 2, gun ? '#4a6a3a' : SH[i % SH.length]); R(x, y + 4, 1, 2, '#2a2e36'); R(x + 2, y + 4, 1, 2, '#2a2e36'); if (carry) { R(x - 2, y + 1, 2, 2, K); R(x - 2, y + 1, 2, 1, '#c9a868'); } if (gun) R(x + 3, y + 2, 3, 1, '#17180f'); }
    function zed(x, y, i) { x = Math.round(x); y = Math.round(y); R(x, y + 6, 3, 1, 'rgba(0,0,0,.3)'); R(x, y, 3, 2, i % 2 ? '#7fb85a' : '#6aa85a'); R(x + (i % 2 ? 0 : 2), y, 1, 1, '#17180f'); R(x, y + 2, 3, 2, ['#6b4a3a', '#3f5f7a', '#55585f'][i % 3]); R(x - 1, y + 2, 1, 1, '#7fb85a'); R(x, y + 4, 1, 2, '#3a3a36'); R(x + 2, y + 4, 1, 2, '#3a3a36'); }
    // 지은 건물 곁에서 일하는 사람들(단계만큼)
    C.SETTLE.forEach(function (d, di) { var lv = C.settleLv(state, d.id); if (!lv || C.settleBroken(state, d.id)) return; var p = campPlot(d); for (var k = 0; k < lv; k++) { var wob = Math.round(Math.sin(now / 900 + di * 2 + k * 3) * 3); man(p.x + 6 + k * 11 + wob, p.y + CAMP_H + 1, di + k); } });
    // 문 앞의 사람들: 많을수록 많이 서 있다
    var free = C.settleFree(state), crowd = free <= 0 ? 0 : Math.min(13, 1 + Math.floor(Math.log(free + 1) / Math.LN10 * 2.4));
    [[0, 0], [4, 1], [8, 0], [12, 1], [2, 7], [6, 8], [10, 7], [14, 8], [16, 2], [0, 14], [5, 14], [9, 15], [13, 14]].slice(0, crowd).forEach(function (q, i) { man(7 + q[0], 71 + q[1] + ((Math.floor(now / 600) + i) % 5 === 0 ? -1 : 0), i); });
    // 길을 따라 걸어가는 사람들(방금 보낸 무리)
    campWalk = campWalk.filter(function (w) { return now - w.at < w.ms; });
    campWalk.forEach(function (w, wi) { var tt = (now - w.at) / w.ms, pts = w.path, seg = Math.min(pts.length - 2, Math.floor(tt * (pts.length - 1))), lt = tt * (pts.length - 1) - seg, a = pts[seg], b = pts[seg + 1]; if (tt < 0) return; man(a[0] + (b[0] - a[0]) * lt, a[1] + (b[1] - a[1]) * lt + (Math.floor(now / 110 + wi) % 2), wi + 3, !w.gun, w.gun); });
    // 습격: 그쪽 울타리 밖의 무리, 안쪽에 선 사람들, 깎인 울타리
    if (n) {
      var hold = C.nightHold(state), side = n.side, zN = Math.min(26, 8 + (c.nightLv || 0) * 2), gN = Math.round(Math.min(1, n.guards / Math.max(1, n.need)) * 14);
      for (var zi = 0; zi < zN; zi++) { var u = (zi * 37 % 100) / 100, jig = Math.floor(now / 200 + zi) % 2; if (side === 1) zed(178 + (zi % 2) * 3 - jig, 12 + u * 100, zi); else zed(10 + u * 160, side === 0 ? 0 + (zi % 2) * 1 - 0 + jig - 1 : 122 + (zi % 2) - jig, zi); }
      for (var gi = 0; gi < gN; gi++) { var gu = (gi + 0.5) / 14; if (side === 1) man(168 - (gi % 2) * 4, 12 + gu * 100, gi, 0, 1); else man(10 + gu * 160, side === 0 ? 12 + (gi % 2) * 3 : 108 - (gi % 2) * 3, gi, 0, 1); }
      var dmg = 1 - Math.max(0, n.fence); for (var di2 = 0; di2 < Math.round(dmg * 12); di2++) { var du = (di2 * 53 % 100) / 100; if (side === 1) { R(174, 12 + du * 100, 3, 4, '#3a2a1a'); R(175, 13 + du * 100, 1, 2, '#f08a3a'); } else { R(10 + du * 160, side === 0 ? 6 : 117, 4, 5, '#3a2a1a'); R(11 + du * 160, side === 0 ? 8 : 119, 2, 1, '#f08a3a'); } }
      if (gN > 0 && Math.floor(now / 90) % 3 === 0) { var tu = ((now / 90 | 0) * 29 % 100) / 100; if (side === 1) R(170, 12 + tu * 100, 5, 1, '#ffd95a'); else R(10 + tu * 160, side === 0 ? 9 : 115, 1, 4, '#ffd95a'); }
    }
    // 습격 중에는 어둡게 덮고 불빛만 다시 밝힌다
    if (n) { g.fillStyle = 'rgba(8,12,34,.5)'; g.fillRect(0, 0, 184, 128); }
    lights.forEach(function (l) { var glow = String(l[4]).indexOf('rgba') === 0; if (glow) { R(l[0], l[1], l[2], l[3], l[4]); return; } if (n) { R(l[0], l[1], l[2], l[3], l[4]); g.fillStyle = 'rgba(255,233,160,.16)'; g.fillRect(l[0] - 2, l[1] - 1, l[2] + 4, l[3] + 4); } });
    if (n) {
      var sideBand = n.side === 1 ? [160, 0, 24, 128] : n.side === 0 ? [0, 0, 184, 20] : [0, 108, 184, 20]; g.fillStyle = 'rgba(216,69,58,' + (Math.floor(now / 300) % 2 ? '.2' : '.12') + ')'; g.fillRect(sideBand[0], sideBand[1], sideBand[2], sideBand[3]);
      var bx = n.side === 1 ? 150 : 76, by = n.side === 0 ? 22 : n.side === 2 ? 102 : 60; R(bx - 1, by - 1, 34, 6, K); R(bx, by, Math.round(32 * Math.max(0, n.fence)), 4, n.fence > 0.5 ? '#7fb85a' : n.fence > 0.25 ? '#e98a3c' : '#ff5a4a');
    }
    if (campFlash && now - campFlash.at < 400) { var fa = 1 - (now - campFlash.at) / 400; g.fillStyle = (campFlash.kind === 'done' ? 'rgba(240,180,0,' : campFlash.kind === 'held' ? 'rgba(127,184,90,' : 'rgba(216,69,58,') + (0.4 * fa).toFixed(2) + ')'; if (campFlash.rect) g.fillRect(campFlash.rect[0], campFlash.rect[1], campFlash.rect[2], campFlash.rect[3]); else g.fillRect(0, 0, 184, 128); }
    for (var v = 0; v < 6; v++) { g.fillStyle = 'rgba(6,10,6,' + (0.2 - v * 0.03).toFixed(3) + ')'; g.fillRect(v, 0, 1, 128); g.fillRect(183 - v, 0, 1, 128); }
    cv.classList.toggle('ward-shake', !!(campFlash && campFlash.kind === 'breach' && now - campFlash.at < 300));
  }
  /** 문에서 그 자리까지의 길(도트 자리들). */
  function campPath(d) { var p = campPlot(d), ry = d.row === 0 ? 43 : 79; return [[8, 79], [48, 79], [50, ry + (d.row === 0 ? 0 : 0)], [p.x + 12, ry], [p.x + 14, p.y + (d.row === 2 ? 4 : CAMP_H - 6)]]; }
  function campSendWalkers(path, n, gun) { var now = Date.now(); for (var k = 0; k < n; k++) campWalk.push({ at: now + k * 130, ms: 1300, path: path, gun: !!gun }); if (campWalk.length > 40) campWalk = campWalk.slice(-40); }
  function renderCamp() {
    var c = C.campOf(state), n = c.night, free = C.settleFree(state), has = C.survivorRate(state) > 0 || state.survivors > 0;
    var head = $('camp-head'); setText(head, n ? '울타리 ' + Math.round(Math.max(0, n.fence) * 100) + '%' : '문 앞에 ' + fmt(free) + '명'); head.classList.toggle('bad', !!n && C.nightHold(state) < 1);
    var ck = $('camp-clock'), left = C.RAID_EVERY - (c.clock || 0), showCk = !!n || (C.settleCount(state) >= 1 && c.hand < C.CAMP_HAND);
    if (ck.hidden !== !showCk) ck.hidden = !showCk; if (showCk) setText(ck, n ? '습격 ' + clock(Math.max(0, n.t)) : ((c.nightLv || 0) > 0 ? c.nightLv + '단계 · ' : '') + '습격까지 ' + clock(Math.max(0, left))); ck.classList.toggle('raid', !!n);
    var gb = $('camp-guard'), tb = $('t7-tune'); if (gb.hidden !== !n) gb.hidden = !n; if (tb.hidden !== !!n) tb.hidden = !!n;
    if (n) { setText($('camp-guard-n'), fmt(n.guards) + ' / ' + fmt(n.need) + '명'); gb.disabled = n.guards >= n.need || !(free >= 1); }
    var sel = c.flag ? C.SETTLE.filter(function (d) { return d.id === c.flag; })[0] : null, card = $('camp-card'); if (card.hidden !== !sel) card.hidden = !sel;
    if (sel) { var lv = C.settleLv(state, sel.id), need = C.settleNeed(state, sel.id), work = C.settleWork(state, sel.id), brk = C.settleBroken(state, sel.id);
      setText($('camp-name'), sel.name + (lv > 0 ? ' ' + lv + '단계' : '') + ' · ' + (brk ? '부서졌어요' : sel.desc)); setText($('camp-need'), need > 0 ? fmt(work) + ' / ' + fmt(need) + '명' : '다 자랐어요'); fill($('camp-bar'), need > 0 ? work / need : 1); }
    drawCamp();
    var sc = $('campscene'); sc.classList.toggle('tappable', has); sc.setAttribute('data-free', free); sc.setAttribute('data-levels', C.settleLevels(state)); sc.setAttribute('data-raid', n ? n.side : ''); sc.setAttribute('data-guards', n ? n.guards : 0); sc.setAttribute('data-flag', c.flag || '');
    setText($('camp-note'), !has ? '안테나를 세우면 사람이 모여요' : n ? (C.nightHold(state) >= 1 ? '울타리가 버티고 있어요' : '사람을 세우지 않으면 울타리가 깎여요') : (state.sendsRun || 0) < 3 ? '지도의 자리를 누르면 문 앞의 사람이 가서 지어요' : C.settleCount(state) < 2 ? '송신탑을 눌러도 주파수를 맞춰요' : (state.nightsHeld || 0) + (state.campBreaches || 0) < 1 ? '손을 쓰고 있으면 습격이 와요. 울타리에 사람을 세워 막아요' : '모든 구역의 생산 ×' + C.towerMult(state).toFixed(2));
  }
  function wireCamp() {
    function campPop(xd, yd, text, cls) {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      var wrap = $('camp-wrap'); if (!wrap || wrap.querySelectorAll('.ward-pop').length > 10) return;
      var s = el('span', 'ward-pop' + (cls ? ' ' + cls : ''), text); s.style.left = (xd / 184 * 100) + '%'; s.style.top = (yd / 128 * 100) + '%';
      s.addEventListener('animationend', function () { s.remove(); }); wrap.appendChild(s);
    }
    campPopFn = campPop;
    function guard() {
      var r = C.sendGuard(state); if (!r.ok) return;
      var n = C.campOf(state).night, tx = n.side === 1 ? 166 : 40 + Math.random() * 100, tyy = n.side === 0 ? 14 : n.side === 2 ? 106 : 30 + Math.random() * 60;
      campSendWalkers([[8, 79], [48, 79], [50, n.side === 0 ? 43 : 79], [tx, tyy]], 3, true); campPop(tx, tyy - 8, '+' + fmt(r.sent), ''); sfx('fortify'); buzz(10); render();
    }
    $('camp-guard').addEventListener('click', guard);
    $('campscene').addEventListener('click', function (e) {
      var cv = $('campscene'), rc = cv.getBoundingClientRect(), key = !(e.clientX > 0) && !(e.clientY > 0), c = C.campOf(state);
      var x = (e.clientX - rc.left) / rc.width * 184, y = (e.clientY - rc.top) / rc.height * 128;
      if (key) { if (c.night) guard(); else if (c.flag) place(c.flag); return; }
      if (c.night && ((c.night.side === 1 && x > 158) || (c.night.side === 0 && y < 12) || (c.night.side === 2 && y > 116))) { guard(); return; }
      if (x < 46 && y < 66) { $('t7-tune').click(); return; }      // 송신탑: 주파수를 맞춘다
      var hit = null; C.SETTLE.forEach(function (d) { var p = campPlot(d); if (x >= p.x - 1 && x <= p.x + CAMP_W + 1 && y >= p.y - 4 && y <= p.y + CAMP_H + 4) hit = d; });
      if (hit) place(hit.id);
    });
    function place(id) {
      var d = C.SETTLE.filter(function (q) { return q.id === id; })[0], p = campPlot(d), c = C.campOf(state), r = C.buildSettle(state, id);
      if (!r.ok) { if (r.reason === 'people' || r.reason === 'done') { c.flag = id; if (r.reason === 'people') campPop(p.x + 19, p.y + 6, '문 앞에 사람이 없어요', 'bad'); render(); } return; }
      campSendWalkers(campPath(d), Math.min(5, 2 + Math.floor(r.sent / Math.max(1, r.need) * 20)), false); campPop(p.x + 19, p.y + 4, '+' + fmt(r.sent) + '명', '');
      if (r.done) campDone(d, r.lv, r.repaired, false); else { sfx('click'); buzz(8); }
      Store.save(); render();
    }
  }
  /** 다 놓았다: 팝업 없이, 그 자리의 반짝임과 뜨는 글 · 일지 한 줄로만 알린다. */
  function campDone(d, lv, repaired, auto) {
    var p = campPlot(d); campFlash = { at: Date.now(), kind: 'done', rect: [p.x - 2, p.y - 2, CAMP_W + 4, CAMP_H + 4] };
    if (campPopFn) campPopFn(p.x + 19, p.y - 2, repaired ? d.name + ' 고침' : d.name + ' ' + lv + '단계', 'done');
    log(repaired ? d.name + (C.hasBatchim(d.name) ? '을' : '를') + ' 고쳤다.' : lv === 1 ? d.name + (C.hasBatchim(d.name) ? '이' : '가') + ' 섰다. ' + d.desc + '.' : d.name + (C.hasBatchim(d.name) ? '이' : '가') + ' ' + lv + '단계가 됐다.', 'good');
    if (!auto || (tab === 'z6' && pane === 'play')) { sfx('goal'); buzz(25); }
  }
  var settleBuilt = '';      // 방금 지은 건물(한 번 반짝인다)
  function renderSettle() {
    // 혈청: 가운데 줄의 건물이 문턱이다
    var stage = state.serumStage, sMax = C.SERUM_COSTS.length, sCost = C.serumCost(state), need = C.serumNeeds(state), rNext = C.rescueNext(state);
    Array.prototype.forEach.call($('serum-steps').children, function (i, n) { i.className = n < stage ? 'on' : ''; });
    setText($('serum'), stage >= sMax ? '혈청을 완성했다' : need ? '혈청 ' + (stage + 1) + '단계 · ' + (stage + 1 >= sMax && !need.serum ? '정착지를 다 지어야 해요' : '가운데 줄의 다음 건물이 필요해요') : '혈청 ' + (stage + 1) + '단계 · 물자 ' + fmt(sCost));
    $('serum').disabled = stage >= sMax || !!need || !(sCost <= state.supplies);
    setText($('serum-note'), '혈청 ' + stage + ' / ' + sMax + '단계' + ((state.ended || 0) >= 1 ? '\n구조한 생존자 누적 ' + fmt(Math.floor(state.rescued)) + '명 · 생산 +' + Math.round((C.rescueMult(state) - 1) * 100) + '%' + (rNext ? ' · 다음 ' + fmt(rNext) + '명' : ' · 최대') : ''));
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
    // 2.8.5: 다시 뽑기도 한 번 더 묻는다. 횟수가 정해져 있는데, 화면을 막 누르다 창이 뜨면 그대로 눌려 한 번을 날렸다.
    // 확인 창은 뜬 뒤 0.5초 동안 "다시 뽑기"를 받지 않는다(특전 고르기와 같은 보호).
    $('perk-reroll').addEventListener('click', function () {
      var left = C.rerollsLeft(state);
      if (!(left > 0)) return;
      confirmBox('특전 다시 뽑기', '후보 셋을 새로 뽑을까요? 이번 회차에 ' + left + '번 남았어요.', '취소', '다시 뽑기', function () {
        var r = C.rerollPerks(state, Math.random);
        if (!r.ok) return;
        log('특전 후보를 다시 뽑았다.', '');
        sfx('click'); Store.save(); render();
      }, 500);
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
      // 2.9.0: 한도가 있는 특전(채혈)은 마지막 레벨에 '최대'를 붙인다
      var lvText = 'Lv ' + state.perks[id] + ' → ' + (state.perks[id] + 1) + (def.max > 0 ? (state.perks[id] + 1 >= def.max ? ' (최대)' : ' / ' + def.max) : '');
      name.setAttribute('data-lv', lvText);
      btn.appendChild(name);
      btn.appendChild(el('span', '', '레벨당 ' + def.desc));
      // 고르기 전에 한 번 더 묻는다(2.8.1). 다른 것을 연달아 누르던 중에 특전 창이 뜨면, 읽기도 전에 누른 자리의 특전이 골라졌다.
      // 확인 창의 '고른다'는 뜬 뒤 0.5초 동안 눌리지 않는다: 연달아 누르던 손이 확인까지 눌러 버리지 않게.
      btn.addEventListener('click', function () {
        confirmBox('특전 고르기', '〈' + def.name + '〉 ' + lvText + '\n레벨당 ' + def.desc + '\n이 특전을 고를까요?', '다시 본다', '고른다', function () {
          var r = C.choosePerk(state, id);
          if (!r.ok) return;
          log('특전을 골랐다: ' + def.name + ' Lv ' + r.level + '.', 'good');
          sfx('perk'); Store.save(); render();
        }, 500);
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
    // 제목 줄의 구역 이름(2.3.2): 좁은 휴대폰에서는 '6구역 강변 검문소'가 '6구역 강…'으로 잘렸다(360px 에서는 일곱 구역 모두).
    // 다 들어가지 않으면 '6구역'만 적는다. 이름은 바로 아래 줄(구역 · 하는 일)에 다시 나온다. 재는 일은 글이나 너비가 바뀔 때만 한다.
    var baseKey = label + '|' + window.innerWidth;
    if (baseKey !== baseNoKey) {
      baseNoKey = baseKey;
      var bn = $('base-no'); bn.textContent = label;
      if (bn.scrollWidth > bn.clientWidth + 1) bn.textContent = C.ZONES[state.zone].no + '구역';
    }
    // 배경 음악의 곡: 변이체가 온 밤이나 위험 11단계부터는 dread, 무리가 온 밤은 night, 그 밖에는 day
    try {
      if (window.Sound) {
        var fightNow = C.dayPhase(state).phase === 'battle';
        window.Sound.setMood((fightNow && C.isBossWave(C.currentWave(state))) || C.dangerOf(state) >= 11 ? 'dread' : fightNow || state.dayClock / C.DAY_SECONDS > 0.82 ? 'night' : 'day');
      }
    } catch (e) { /* 소리는 없어도 된다 */ }
    var dTag = $('danger-tag'), dNow = C.dangerOf(state);      // 위험 단계로 하는 회차는 그림 오른쪽 위에 붉은 딱지로 알린다(제목 줄은 좁아서 잘렸다)
    dTag.hidden = !(dNow > 0); if (dNow > 0) setText(dTag, '위험 ' + dNow);
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
      var pe = pendingEnding;
      setText($('ending-stats'), (pe.count > 1 ? pe.count + '번째 끝 · ' : '') + '이번 회차 ' + duration(pe.runSeconds || 0) + (pe.danger > 0 ? ' · 위험 ' + pe.danger : '') + '\nD+' + pe.day + ' · 철수 ' + pe.retreats + '번 · 켜 둔 시간 ' + duration(pe.seconds));
      // 받은 것: 뽑기권, 구조한 생존자(누적이 문턱을 넘으면 생산이 는다), 위험 단계 첫 돌파, 기록
      var got = ['뽑기권 +' + (3 + (pe.dangerTickets || 0)) + '장'];
      if (pe.saved > 0) got.push('구조한 생존자 +' + fmt(pe.saved) + '명 (누적 ' + fmt(Math.floor(pe.rescued || 0)) + '명)');
      if (pe.tierUp) got.push('구조한 사람이 늘어 전체 생산 +' + Math.round(C.RESCUE_BONUS * 100) + '% (철수해도 남아요)');
      if (pe.higher) got.push('위험 ' + pe.danger + ' 첫 돌파 · 전체 생산 +' + Math.round((C.DANGER_PROD - 1) * 100) + '% (철수해도 남아요)');
      if (pe.fastest) got.push('가장 빠른 기록');
      setText($('ending-got'), got.join('\n'));
      // 새로 열린 것: 처음 끝을 봤을 때, 그리고 더 높은 위험 단계를 돌파했을 때
      var fresh = [];
      if (pe.count === 1) { fresh.push('위험 단계 · 철수 화면에서 다음 회차를 더 어렵게 걸 수 있어요. 보상이 커져요.'); fresh.push('끝까지 가는 도전 · 모험 화면에서 고를 수 있어요.'); }
      else if (pe.higher && pe.danger < C.DANGER_MAX) fresh.push('위험 ' + (pe.danger + 1) + ' · 철수 화면에서 고를 수 있어요.');
      $('ending-new-box').hidden = !fresh.length; setText($('ending-new'), fresh.join('\n'));
      setText($('ending-after'), '거점은 계속 돌아가요.\n철수하면 1구역부터 다시 시작해요.');
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
    var canFill = fillReady(state.zone);      // 지금 있는 구역의 것만(2.8.0: 지나온 구역은 부르지 않는다)      // 주문·의뢰·화물, 그리고 3구역의 고장과 출하 트럭
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
    setText($('night-timer-label'), fighting ? (state.siege && !safe ? '농성 중 · 버티는 시간' : safe ? '방어 중 · 버티는 시간' : '방어 중 · 당장 보강해야 한다') : '무리 도착까지');
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
    setText(rb, can ? '철수하고 +' + fmt(gain) + ' 받기' : '아직 철수할 수 없다');
    // 철수의 기준은 "이번 회차에 모은 물자"(쓴 것도 포함한 누적)다. 지금 가진 물자와 헷갈리지 않게 이름을 붙여 적는다
    // 2.9.9: 물자 숫자("1.35구")는 적지 않는다. 받는 샘플을 크게, 지난번과 견준 한 줄, 다음 샘플(또는 철수 문턱)까지는 막대와 남은 시간으로.
    $('rt-gain').hidden = !can; $('rt-two').hidden = !can;
    setText($('rt-num'), '+' + fmt(gain));
    var lastRun = state.runLog && state.runLog.length ? state.runLog[state.runLog.length - 1] : null, cmp = '';
    if (can && lastRun && lastRun.antibodies > 0) cmp = gain > lastRun.antibodies ? '지난번 철수보다 ' + fmt(gain - lastRun.antibodies) + '개 많아요.' : gain < lastRun.antibodies ? '지난번 철수(+' + fmt(lastRun.antibodies) + ')보다 ' + fmt(lastRun.antibodies - gain) + '개 적어요.' : '지난번 철수와 같아요.';
    setText($('retreat-hint'), can ? cmp : state.pendingPerks.length ? '아직 고르지 않은 특전이 있어요.' : '');
    var rtGoal = can ? C.nextAntibodyAt(state) : C.RETREAT_MIN, rtRate = C.incomePerSec(state), rtLeft = rtRate > 0 ? Math.max(0, rtGoal - state.runEarned) / rtRate : Infinity;
    setText($('rt-next-label'), can ? '다음 샘플 +1까지' : state.pendingPerks.length ? '' : '철수할 수 있을 때까지');
    setText($('rt-next-eta'), (!can && state.pendingPerks.length) ? '' : !isFinite(rtLeft) ? '' : rtLeft < 60 ? '1분 안쪽' : rtLeft < 3600 ? '약 ' + Math.ceil(rtLeft / 60) + '분' : rtLeft < 86400 ? '약 ' + Math.ceil(rtLeft / 3600) + '시간' : '');      // 하루가 넘으면 적지 않는다(막 시작한 사람에게 "하루 넘게"는 겁만 준다)
    // 위험 단계(2.1.0): 끝을 본 뒤에 보인다. 다음 회차에 걸 단계를 − / + 로 고른다
    var dMax = C.dangerMax(state), dRow = $('danger-row');
    dRow.hidden = !(dMax > 0);
    if (dMax > 0) {
      var dn = Math.min(state.dangerNext || 0, dMax);
      setText($('danger-val'), '위험 ' + dn);
      $('danger-down').disabled = dn <= 0; $('danger-up').disabled = dn >= dMax;
      setText($('danger-text'), dn > 0 ? '어려워지는 것 · 밤의 무리 ×' + C.dangerHorde(dn).toFixed(2) + ', 다음 구역을 여는 값 ×' + fmt(C.dangerCost(dn)) + '\n더 받는 것 · 철수할 때 항체 샘플 +' + Math.round(dn * C.DANGER_ANTIBODY * 100) + '%, 끝을 보면 뽑기권 +' + dn * C.DANGER_TICKETS : '다음 회차의 위험 단계를 올리면 더 어렵고, 보상이 커요.\n처음 돌파한 단계마다 전체 생산이 ' + Math.round((C.DANGER_PROD - 1) * 100) + '% 늘어요.');
    }
    setText($('retreat-sub'), can ? '' : state.pendingPerks.length ? '' : '물자를 더 모으면 철수할 수 있어요. 철수하면 항체 샘플을 받아요.');
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
    if (zi < state.zone) return false;      // 지나온 구역은 점으로 부르지 않는다(2.8.0). 지나온 구역은 알아서 돌아가는 곳이라, 점이 늘 켜져 있으면 지금 구역의 점이 묻힌다
    if (fillReady(zi) || zoneBuyReady(zi)) return true;
    var nz = C.nextZone(state);
    return zi === state.zone && !!nz && nz.ready && nz.enough && !(nz.wait > 0);
  }
  /** 3.1.0: 아직 열어 본 적 없는 것은 이름도 내용도 '???'로 가린다(구역, 원정, 도전, 정착지 모두 같은 규칙). */
  var HID = '???';
  function zoneSeen(zi) { return zi <= Math.max(state.zone, state.bestZone || 0); }
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
      // 살 수 있는 개조가 있으면 노란 네모(1.5.2).
      // 2.8.3: 지나온 구역은 이 네모도 켜지 않는다. 2.8.0에서 빨간 점만 끄고 이 노란 네모를 남겨, 지나온 구역 탭에 표시가 그대로 보였다
      var zUp = id !== tab && (n < 0 || n === state.zone) && C.UPGRADES.some(function (u) { return u.zone === n && C.upgradeCost(state, u.id) <= state.supplies; });
      b.classList.toggle('upready', zUp && !b.classList.contains('avail'));      // 그 구역에 지금 할 일이 있으면 점(1.2.4)
    });
    var open = zi >= 0 && zi <= state.zone, soon = zi >= 0 && C.ZONES[zi].kind === 'soon';
    setText($('tab-hint'), tab === 'wall' ? HINTS.wall : open ? HINTS[tab] : zoneSeen(zi) ? (zi + 1) + '구역 ' + C.ZONES[zi].name + ' · ' + (C.ZONES[zi].lead || '아직 닿지 못한 곳') : (zi + 1) + '구역 ' + HID + ' · 아직 가 보지 못한 곳이에요');
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
    $('settle').hidden = !(tab === 'z6' && open && pane === 'up');
    if (tab === 'z6' && open && pane === 'up') renderSettle();
    var aeZone = /^z\d$/.test(tab) ? Number(tab.slice(1)) : -1, aeShow = aeZone >= 1 && aeZone <= state.zone && C.autoOn(state, aeZone);
    $('auto-ev-row').hidden = !aeShow;
    if (aeShow) {
      $('auto-ev').checked = C.autoEvents(state, aeZone);
      setText($('auto-ev-text'), ['', '단골 주문 자동', '조립공 · 의뢰 넘기기', '역무원 · 표류·특별 화물 자동', '연구 조교 · 간호사', '초소장 · 행렬 자동', '방송·무전 자동'][aeZone] + ' · 효율 ' + Math.round(C.autoShare(state, aeZone) * 100) + '%');
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
      var soonText = !open && soon ? (state.gate ? C.ZONES[zi].name + '의 문 앞까지 왔어요. 이 구역은 다음 버전에서 열려요. 현재는 철수해서 항체 샘플을 모아 두면 돼요.' : '이 구역은 다음 버전에서 열려요. 현재는 문 앞까지 갈 수 있어요.')
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
        ? '연속 호가 ' + state.streak + ' · 판매 +' + Math.round((mult - 1) * 100) + '%' + (state.price < range.mean ? ' · 직접 팔면 끊겨요' : state.streakUsed ? '' : ' · 바로 팔면 올라요')
        : '평균 이상에서 팔리면 연속 호가가 쌓여요');
      var sb = $('sell'), worth = state.goods * state.price * C.goodsValue(state) * mult;
      sb.disabled = !(state.goods > 0);
      setText(sb, state.goods > 0 ? '바로 판다 · 물자 +' + fmt(worth) + (state.price >= C.peakPrice(state) ? ' · 고점' : '') : '팔 상품이 없다');
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
      setText(rows.stall.info, '초당 상품 ' + fmt(C.goodsRate(state)) + ' · 초당 물자 ' + fmt(C.tradeRate(state)));
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
      // 3.5.0 3구역: 판 + 의뢰 + 줄 셋
      var line = C.lineInfo(state), ct = state.contract, cb = $('contract'), autoM = C.autoOn(state, 2);
      cb.hidden = !ct;
      if (ct) {
        var cl = null; C.CLIENTS.forEach(function (r) { if (r.id === ct.who) cl = r; });
        var cHave = Math.min(ct.need, C.contractHave(state)), cdone = cHave >= ct.need, cName = C.boxName(ct.level);
        setText($('contract-left'), clock(ct.left));
        setText($('contract-text'), (cl ? cl.name + (C.hasBatchim(cl.name) ? '이' : '가') : '거래처가') + ' ' + cName + ' 상자 ' + ct.need + '개를 찾아요.\n넘기면 물자 +' + fmt(C.contractReward(state)) + ' · 간식 +' + C.CONTRACT_TREATS);
        fill($('contract-bar'), cHave / ct.need);
        $('contract-fill').disabled = !cdone;
        setText($('contract-fill'), cdone ? '넘긴다' : cName + ' 상자 ' + cHave + ' / ' + ct.need + ' · 합치지 말고 모아 두세요');
      }
      $('truck').hidden = true;
      setText($('stock-note'), '');
      setText($('contract-note'), '거래처 ' + C.clientCount(state) + ' / ' + C.CLIENTS.length + ' · 상자 값 +' + Math.round((C.contractMult(state) - 1) * 100) + '% (최대 ' + Math.round(C.CONTRACT_BONUS_MAX * 100) + '%)');
      C.MACHINES.forEach(function (d) {
        var r = rows.machines[d.id], lv = state.machines[d.id] || 0, q = qtyFor(C.maxMachines(state, d.id), d.max - lv), cost = C.machineCost(state, d.id, q);
        setText(r.count, (d.id === 'paint' ? '' : 'Lv ') + lv + ' / ' + d.max);      // 도장 라인은 별 딱지가 있어 자리가 좁다(1구역 시설처럼 숫자만)
        // 줄마다 "지금 어떤가 → 사면 어떻게 되나"를 적는다
        setText(r.info, d.id === 'feed' ? (lv < d.max ? line.feed.toFixed(2) + '초 → ' + (line.feed * C.FEED_STEP).toFixed(2) + '초' : line.feed.toFixed(2) + '초마다')
          : d.id === 'forge' ? C.boxName(line.spawn) + (lv < d.max ? ' → ' + C.boxName(line.spawn + 1) : '')
          : '×' + fmt((1 + lv) * line.milestone) + (lv < d.max ? ' · 레벨당 +' + fmt(line.milestone) : ''));
        if (d.id === 'paint') setMile(r, lv, q, cost <= state.supplies, C.LINE_MILESTONES);
        setText(r.cost, isFinite(cost) ? '×' + q + ' ' + fmt(cost) : '최대');
        r.btn.disabled = !(cost <= state.supplies); afford(r.cost, cost);
      });
      var ld = $('line-load');
      renderBoard();
      setText(ld, '초당 ' + fmt(C.lineRate(state)));
      ld.className = 'num steady';
      $('line').setAttribute('data-rate', fmt(C.lineRate(state)));      // 화면 테스트가 읽는다
      var pairs = C.mergeable(state).length;
      var fullB = C.boardFull(state);
      /* 3.8.4: 글을 덜어 냈다. 횟수('손으로 N번 합침')는 목표에 이미 나오고, 자동 합치기의 박자는 글이 아니라 막대로 보여 준다.
         누르는 법은 처음 몇 번만 알려 주고, 그 뒤로는 판이 가득 찼을 때만 한 줄 적는다 */
      setText($('line-note'), fullB ? '상자가 가득 찼어요 · 눌러서 자리를 내세요' : (state.mergesAll || 0) < 10 ? '상자를 누르면 같은 상자끼리 합쳐져요' : '');
      $('line').setAttribute('data-merges', state.mergesRun || 0);      // 화면 테스트가 읽는다(글에서 횟수를 뺐다)
      // 3.8.5 조립공: 1구역 순찰조와 같은 틀(글 한 줄 + .autobar, fill 이 부드럽게 채운다)
      var aOn = !!autoM && C.autoEvents(state, 2);
      $('merge-bar').hidden = !aOn;
      setText($('merge-note'), !autoM ? '개조에서 조립공을 사요' : !aOn ? '조립공이 쉬고 있어요' : C.boardRoom(state) > C.AUTO_MERGE_ROOM ? '조립공 · 상자가 차면 일해요' : '조립공 · ' + secs(C.autoMergeSeconds(state)) + '마다');
      fill($('merge-bar'), aOn ? state.autoMerge || 0 : 0);
      $('line-note').classList.toggle('boosted', fullB);
      setText($('line-mile'), '가장 높은 상자 ' + (state.boxBest ? C.boxName(state.boxBest) + ' (' + state.boxBest + '단계)' : '-'));
      var tb = $('tune'), tc = C.tuneCost(state);
      tb.hidden = true;      // 3.2.1: 기계 줄의 구매 단추와 하는 일이 같아서 뺐다(1 · 2구역에도 없는 단추)
      tb.disabled = !(tc <= state.supplies); afford(tb, tc);
      setText(tb, isFinite(tc) ? '한 번에 올리기 · ' + names[line.bottleneck] + ' · 물자 ' + fmt(tc) + (qtyMode === 1 ? '' : qtyMode === 'max' ? ' · 되는 만큼' : ' · ' + qtyMode + '번') : '기계가 모두 최대다');
    }
    if (tab === 'z3' && open) {
      renderZoneEvent('rail');
      // 표류 화물: 발견됐을 때만 칸이 보인다. 발견된 뒤로 열차가 싣고 온 화물 값이 차고, 다 차면 끌어올 수 있다
      var sv = state.salvage, sb2 = $('salvage');
      sb2.hidden = !sv;
      if (sv) {
        var cg = null; C.CARGOS.forEach(function (r) { if (r.id === sv.who) cg = r; });
        setText($('salvage-left'), clock(sv.left));
        setText($('salvage-text'), '선로에 멈춰 선 ' + (cg ? cg.name + (C.hasBatchim(cg.name) ? '을' : '를') : '화물칸을') + ' 찾았어요.\n끌어오면 물자 +' + fmt(C.salvageReward(state)) + ' · 간식 +' + C.SALVAGE_TREATS);      // 얼마나 쌓아야 하는지는 아래 단추에 적는다(여기에 한 줄 더 적으니 휴대폰에서 두 줄로 넘어갔다)
        fill($('salvage-bar'), sv.need > 0 ? sv.have / sv.need : 0);
        var sdone = sv.have >= sv.need;
        $('salvage-fill').disabled = !sdone;
        setText($('salvage-fill'), sdone ? '끌어온다' : '열차 화물 ' + fmt(sv.have) + ' / ' + fmt(sv.need) + ' · ' + Math.floor(sv.need > 0 ? sv.have / sv.need * 100 : 0) + '%');
      }
      setText($('salvage-note'), '화물 ' + C.cargoCount(state) + ' / ' + C.CARGOS.length + ' · 화물 값 +' + Math.round((C.salvageMult(state) - 1) * 100) + '% (최대 ' + Math.round(C.SALVAGE_BONUS_MAX * 100) + '%)');
      // 3.7.0 승강장의 열차
      var cargo = C.cargoValue(state), ti = C.trainInfo(state), unit = C.RAIL_SCALE * cargo, autoT = C.autoOn(state, 3) && C.autoEvents(state, 3);
      setText($('plat-cars'), ti.running ? '화물칸 ' + ti.cars + ' / ' + ti.max + (ti.cars ? ' · ×' + ti.mult.toFixed(2) : '') : '');
      var pips = $('plat-pips');
      if (pips.children.length !== ti.max) { pips.textContent = ''; pips.style.gridTemplateColumns = 'repeat(' + ti.max + ', minmax(0, 1fr))'; for (var pi = 0; pi < ti.max; pi++) pips.appendChild(el('i')); }
      for (var pk = 0; pk < pips.children.length; pk++) {
        var pe = pips.children[pk], cls = pk < ti.cars ? 'on' : pk === ti.cars && ti.running ? 'next' : '';
        if (pe.className !== cls) pe.className = cls;
        if (cls === 'next') pe.style.setProperty('--p', Math.round((1 - ti.next / C.carSeconds(state)) * 100) + '%');
      }
      // 무리와의 거리: 막대만 보여 준다(숫자는 없다). 걸음이 고르지 않고 가끔 달려들어서, 언제 닿을지는 눈으로 가늠해야 한다
      var nearPct = ti.running ? Math.max(0, Math.min(100, ti.near * 100)) : 100, danger = ti.running && ti.near <= 0.3;
      $('plat-horde-bar').style.width = nearPct.toFixed(1) + '%';
      setText($('plat-horde-left'), !ti.running ? '' : ti.rush ? '달려와요!' : ti.near > 0.6 ? '멀어요' : ti.near > 0.3 ? '다가와요' : '코앞이에요');
      $('plat-horde-bar').parentNode.parentNode.classList.toggle('near', danger || !!ti.rush);
      // 3.8.6 돌진: 줄 전체가 경고로 바뀐다(이름표 · 막대 · 경적 단추). 경적이 남아 있으면 경적이, 없으면 출발 단추가 깜빡인다
      var hordeRow = $('plat-horde-bar').parentNode.parentNode;
      hordeRow.classList.toggle('rush', !!ti.rush);
      setText($('plat-horde-label'), ti.rush ? '무리 돌진!' : '무리와의 거리');
      $('train-horn').classList.toggle('alert', !!ti.rush && ti.horn > 0);
      $('train-go').classList.toggle('alert', !!ti.rush && !(ti.horn > 0));
      var go = $('train-go'), nextMult = ti.cars < ti.max ? C.carMult(ti.cars + 1) : 0;
      go.disabled = !(ti.running && ti.cars >= 1);
      var goKey = (ti.cars >= 1 ? fmt(ti.gain) : '-') + (ti.full ? 'F' : '');
      if (go._t !== goKey) { go._t = goKey; go.textContent = ''; go.appendChild(el('span', '', ti.full ? '꽉 찼어요 · 출발' : '출발')); go.appendChild(el('span', '', ti.cars >= 1 ? '+' + fmt(ti.gain) : ti.running ? '첫 칸을 붙이는 중' : '열차가 없어요')); }
      go.classList.toggle('full', ti.running && ti.full);
      var hb = $('train-horn'); hb.disabled = !(ti.running && ti.horn > 0); setText(hb, '경적 ' + (ti.running ? ti.horn : 0));
      $('platform').classList.toggle('tappable', ti.running && !ti.full);
      setText($('plat-note'), !ti.running ? '기관차를 사면 승강장에 열차가 서요.'
        : ti.rush ? (ti.horn > 0 ? '경적으로 돌진을 막으세요' : '경적이 없어요 · 바로 보내세요')
        : ti.full ? '보내야 다음 열차가 와요'
        : (state.trainsSent || 0) < 5 ? '그림을 누르면 칸이 빨리 붙어요 · 무리가 닿기 전에 보내세요'      // 3.8.4: 누르는 법은 처음 몇 대만. 횟수 기록은 목표와 업적에 있어서 뺐다
        : ti.hand && !ti.rushed ? '칸을 당긴 열차에는 무리가 돌진할 수 있어요 · 경적으로 막아요'      // 3.9.2: 돌진이 언제 오고 어떻게 막는지 그 자리에서 알려 준다
        : ti.cars >= 1 ? '한 칸 더 붙으면 ×' + nextMult.toFixed(2) : '');
      $('platform').setAttribute('data-pulls', state.pullsRun || 0); $('platform').setAttribute('data-sent', state.trainsSent || 0);      // 화면 테스트가 읽는다
      drawPlatform(ti);
      C.ROUTES.forEach(function (d) {
        var r = rows.routes[d.id], lv = state.routes[d.id] || 0, cost = C.routeCost(state, d.id);
        setText(r.count, 'Lv ' + lv + ' / ' + d.max);
        // 줄마다 "지금 어떤가 → 사면 어떻게 되나"
        setText(r.info, d.id === 'grade' ? '×' + fmt(Math.pow(C.GRADE_STEP, lv)) + (lv < d.max ? ' → ×' + fmt(Math.pow(C.GRADE_STEP, lv + 1)) : '')
          : lv < d.max ? C.carSeconds(state).toFixed(2) + '초 → ' + (C.carSeconds(state) * C.CREW_STEP).toFixed(2) + '초' : C.carSeconds(state).toFixed(2) + '초마다');      // 3.8.8: 3구역 줄과 같은 꼴(현재 → 다음)
        setText(r.cost, isFinite(cost) ? '×1 ' + fmt(cost) : '최대');
        r.btn.disabled = !(cost <= state.supplies); afford(r.cost, cost);
      });
      var tq = qtyFor(C.maxTrains(state), C.TRAIN_MAX - state.trains), tcost = C.trainCost(state, tq);
      setText(rows.train.count, state.trains + ' / ' + C.TRAIN_MAX);
      setMile(rows.train, state.trains, tq, tcost <= state.supplies, C.FLEET_MILESTONES);
      setText(rows.train.info, state.trains ? '초당 ' + fmt(C.railRate(state)) + ' · 레벨당 +' + fmt(C.railRate(state) / state.trains) : '사면 승강장에 열차가 서요');
      setText(rows.train.cost, isFinite(tcost) ? '×' + tq + ' ' + fmt(tcost) : '최대');
      rows.train.btn.disabled = !(tcost <= state.supplies); afford(rows.train.cost, tcost);
    }
    if (tab === 'z6' && open) {
      renderZoneEvent('tower');
      var sRate = C.survivorRate(state);
      renderCamp();
      renderTune();
      var aq = qtyFor(C.maxAntennas(state), C.COUNT_MAX - state.antennas), acost = C.antennaCost(state, aq);
      setText(rows.antenna.count, state.antennas + ' / ' + C.COUNT_MAX);
      setMile(rows.antenna, state.antennas, aq, acost <= state.supplies);
      setText(rows.antenna.info, state.antennas ? '초당 ' + fmt(sRate) + '명' : '세우면 생존자가 모여요');
      setText(rows.antenna.cost, isFinite(acost) ? '×' + aq + ' ' + fmt(acost) : '최대');
      rows.antenna.btn.disabled = !(acost <= state.supplies); afford(rows.antenna.cost, acost);
    }
    if (tab === 'z5' && open) {
      renderZoneEvent('guard');
      /* 4.1.0 6구역 다리. 제목 줄 오른쪽: 지금 한 마리를 잡으면 받는 것(연속 배수까지). 그림 아래: 연속 줄 → 초소장 바 → 행렬 카드 → 기록 한 줄 */
      var gRate = C.guardRate(state), br = C.bridgeOf(state), cap = C.comboCap(state), gAuto = (state.upgrades.autoguard || 0) > 0, gSw = C.autoEvents(state, 5);
      var gr = $('guard-rate'), urgent = br.down > 0 || br.warn > 0 || br.wave > 0;
      setText(gr, !(state.posts > 0) ? '' : br.down > 0 ? '뚫렸다 · 방벽을 다시 세우는 중' : br.warn > 0 ? '무리 습격이 온다' : br.wave > 0 ? '무리 습격 · ' + Math.ceil(br.wave) + '초' : '한 마리 +' + fmt(gRate * C.BRIDGE_SPAWN * br.combo));
      gr.classList.toggle('bad', urgent);
      /* 4.1.4: 단계는 제목이 아니라 그림 오른쪽 위 딱지에 적는다(제목에서는 눈에 안 들어왔다). 오르내릴 때 딱지가 움직인다 */
      var lvEl = $('br-level'), lv6 = state.posts > 0 ? (br.streak || 0) : 0; if (lvEl.hidden !== !(lv6 > 0)) lvEl.hidden = !(lv6 > 0); setText(lvEl, lv6 + '단계');
      if (bridgeLvSeen !== null && lv6 !== bridgeLvSeen && (lv6 > bridgeLvSeen || br.down > 0)) { var lc = lv6 > bridgeLvSeen ? 'up' : 'down'; lvEl.classList.remove('up', 'down'); void lvEl.offsetWidth; lvEl.classList.add(lc); if (lc === 'up') bridgeFlash = { at: Date.now(), kind: 'up' }; }
      bridgeLvSeen = lv6; $('bridgescene').setAttribute('data-level', lv6);
      var hr6 = $('heat-row'), jam6 = br.jam > 0; $('heat-bar').style.width = (Math.min(1, br.heat || 0) * 100).toFixed(1) + '%'; setText($('heat-label'), jam6 ? '과열' : '총열'); hr6.classList.toggle('jam', jam6); hr6.classList.toggle('hot', !jam6 && br.heat > 0.75); bsc0 = $('bridgescene'); bsc0.setAttribute('data-heat', (br.heat || 0).toFixed(2)); bsc0.setAttribute('data-jam', jam6 ? 1 : 0);
      var nb = $('nade-btn'), nNeed = C.nadeNeed(state), nReady = (br.nade || 0) >= nNeed, nShow = state.posts > 0; if (nb.hidden !== !nShow) nb.hidden = !nShow;
      setText($('nade-name'), nReady ? '수류탄 던지기' : '수류탄'); setText($('nade-count'), nReady ? '' : (br.nade || 0) + ' / ' + nNeed); nb.disabled = !nReady || br.down > 0 || !br.zs.length;
      bsc0 = $('bridgescene'); bsc0.setAttribute('data-wall', br.wall); bsc0.setAttribute('data-down', br.down > 0 ? 1 : 0); bsc0.setAttribute('data-wave', br.wave > 0 ? 'wave' : br.warn > 0 ? 'warn' : ''); bsc0.setAttribute('data-nade', br.nade || 0);
      $('combo-bar').style.width = (Math.max(0, Math.min(1, (br.combo - 1) / Math.max(0.01, cap - 1))) * 100).toFixed(1) + '%';
      setText($('combo-x'), '×' + br.combo.toFixed(1)); $('combo-x').parentNode.classList.toggle('cold', br.combo <= 1.001);
      var ga = $('guard-auto'), gaText = !(state.posts > 0) ? '초소를 세우면 다리를 막아요' : !gAuto ? '' : !gSw ? '초소장이 쉬고 있어요' : '초소장 · ' + secs(C.bridgeShotSeconds(state)) + '마다 한 발';
      setText(ga, gaText); if (ga.hidden !== !gaText) ga.hidden = !gaText;
      var gb = $('guard-bar'), gbOn = state.posts > 0 && gAuto && gSw; if (gb.hidden !== !gbOn) gb.hidden = !gbOn; if (gbOn) fill(gb, br.zs.length ? br.shot : 0);
      drawBridge();
      var bsc = $('bridgescene'); bsc.setAttribute('data-zs', br.zs.length); bsc.setAttribute('data-kills', state.handKills || 0); bsc.classList.toggle('tappable', state.posts > 0);
      setText($('guard-note'), !(state.posts > 0) ? '' : (state.handKills || 0) < 3 ? '건너오는 것을 눌러 쏘아요. 연달아 잡으면 더 받아요' : (state.breaches || 0) < 1 && (state.handKills || 0) < 40 ? '닿으면 방벽이 깎여요. 다 깎이면 뚫려요' : (br.streak || 0) > 0 && (state.wavesHeld || 0) < 4 ? '무리 습격을 막으면 단계가 올라요. 더 많이 오고 더 받아요' : '다리 안전도 ×' + C.bridgeSafety(state).toFixed(2) + ' · 통행인 ' + C.passerCount(state) + ' / ' + C.PASSERS.length);
      var fl6 = state.firepower || 0, fc6 = C.fireCost(state), ml6 = state.morale || 0, mc6 = C.moraleCost(state);
      setText(rows.fire.count, 'Lv ' + fl6 + ' / ' + C.FIRE_MAX); setText(rows.fire.info, '한 발 ' + (1 + fl6) + (isFinite(fc6) ? ' → ' + (2 + fl6) : ''));
      setText(rows.fire.cost, isFinite(fc6) ? '×1 ' + fmt(fc6) : '최대'); rows.fire.btn.disabled = !(fc6 <= state.supplies); afford(rows.fire.cost, fc6); rows.fire.btn.classList.toggle('row-max', !isFinite(fc6));
      setText(rows.morale.count, 'Lv ' + ml6 + ' / ' + C.MORALE_MAX); setText(rows.morale.info, '연속 ×' + cap.toFixed(1) + (isFinite(mc6) ? ' → ×' + (cap + 0.5).toFixed(1) : ''));
      setText(rows.morale.cost, isFinite(mc6) ? '×1 ' + fmt(mc6) : '최대'); rows.morale.btn.disabled = !(mc6 <= state.supplies); afford(rows.morale.cost, mc6); rows.morale.btn.classList.toggle('row-max', !isFinite(mc6));
      var pq = qtyFor(C.maxPosts(state), C.COUNT_MAX - state.posts), pcost = C.postCost(state, pq);
      setText(rows.post.count, state.posts + ' / ' + C.COUNT_MAX);
      setMile(rows.post, state.posts, pq, pcost <= state.supplies);
      setText(rows.post.info, state.posts ? '한 마리 ' + fmt(gRate * C.BRIDGE_SPAWN) : '세우면 다리를 막아요');
      setText(rows.post.cost, isFinite(pcost) ? '×' + pq + ' ' + fmt(pcost) : '최대');
      rows.post.btn.disabled = !(pcost <= state.supplies); afford(rows.post.cost, pcost);
    }
    if (tab === 'z4' && open) {
      /* 4.0.3 5구역 여섯 대. 차림은 1구역과 같다: 머리줄(왼쪽 숫자 · 오른쪽 자동 안내) → 막대 → 누르는 그림 → 카드(연구 성과) → 기록 한 줄 */
      var ward = C.wardOf(state), nT = ward.seats.length, swOn = !(state.autoOff && state.autoOff[4]);
      var hasAide = (state.upgrades.autolab || 0) > 0, hasNurse = (state.upgrades.nurse || 0) > 0;
      /* 4.0.7 제목 줄(4구역과 같은 꼴: 왼쪽 이름 · 오른쪽 한마디). 오른쪽에는 지금 병실의 형편을 적는다: 위험한 사람이 있으면 그 수(붉게), 없으면 기다리는 사람 수 */
      /* 4.0.8 제목 줄 오른쪽: 혈청을 놓으면 무엇을 얻는지(멈추면 한 대 값, 되돌리면 그 열두 배) */
      var lp = $('lab-points'), dv = C.doseValue(state); setText(lp, !(state.staff > 0) ? '' : '멈춤 +' + fmt(dv) + ' · 되돌림 +' + fmt(dv * C.WARD_CURE)); lp.classList.remove('bad');
      /* 4.0.6 무슨 일이 일어났는지 글로 보이게 한다.
         ① 그림 아래 한 줄: 자리마다의 상태(기다림 · 위험 · 멈춤 · 몇 대째 · 빈 자리). ② 집계 한 줄: 이번 회차에 멈춘 · 되돌린 · 변한 사람 수(자동에 맡긴 동안의 것도 여기 쌓인다) */
      var strip = $('ward-strip'), cells = strip.children, colsT = C.SEAT_MAX + 1;
      strip.style.gridTemplateColumns = W_LEFT + 'fr ' + ward.seats.map(function () { return ((184 - W_LEFT) / nT).toFixed(2) + 'fr'; }).join(' ');
      for (var sc = 0; sc < colsT; sc++) {
        var cel = cells[sc], ps = sc === 0 ? null : ward.seats[sc - 1], show = sc === 0 || sc <= nT, txt = '', cls = '';
        if (cel.hidden !== !show) cel.hidden = !show;
        if (!show) continue;
        if (sc === 0) { txt = '혈청 ' + ward.stock; cls = ward.stock > 0 ? 'has' : 'none'; }
        else if (!(state.staff > 0) || !(ps.dose >= 0)) { txt = '빈 자리'; cls = 'none'; }
        else if (ps.dose === 0) { txt = ps.m > 0.7 ? '위험' : '기다림'; cls = ps.m > 0.7 ? 'bad' : ''; }
        else if (ps.dose === 1) { txt = '멈춤'; cls = 'stop'; }
        else { txt = ps.dose + ' / ' + C.WARD_DOSES; cls = 'stop'; }
        setText(cel, txt); if (cel.className !== cls) cel.className = cls;
      }
      /* 4.0.8 회진 차트 · 급한 환자 보상 · 강화 혈청 단추 */
      if (!ward.boost) wardArmed = false;
      var bb = $('boost-btn'); if (bb.hidden !== !ward.boost) bb.hidden = !ward.boost;
      if (ward.boost) { setText(bb, wardArmed ? '강화 혈청 · 놓을 사람을 눌러요' : '강화 혈청 · 세 대 몫'); bb.classList.toggle('armed', wardArmed); }
      var ep = $('er-pick'), hasPick = !!ward.pick; if (ep.hidden !== !hasPick) ep.hidden = !hasPick;
      if (hasPick) ['er-pick-a', 'er-pick-b'].forEach(function (id, k) { var d = C.BOON_BY[ward.pick[k]], key = d.id + ':' + C.boonOf(state, d.id), b = $(id); if (b.getAttribute('data-k') !== key) { b.setAttribute('data-k', key); b.innerHTML = ''; b.appendChild(document.createTextNode(d.name)); b.appendChild(el('small', '', d.text)); } });
      var chEl = $('ward-chart'), ch = ward.chart, showCh = state.staff > 0 && !hasPick; if (chEl.hidden !== !showCh) chEl.hidden = !showCh;
      if (showCh) {
        var doneN = 0; ch.lines.forEach(function (l) { if (l.have >= l.need) doneN++; });
        setText($('chart-name'), ch.done ? '회진을 마쳤어요' : (ch.hard ? '빡빡한 차트 · ' : '회진 차트 · ') + ((state.chartNo || 0) + 1) + '호');
        setText($('chart-count'), ch.done ? '다음 차트 고르기' : C.chartFull(state) ? '물자 한 뭉치' : '혈청 값 +' + Math.round((ch.hard ? C.CHART_HARD : C.CHART_EASY) * 100) + '%');      // 4.1.1: 상한(+200%)에 닿으면 물자로 받는다
        chEl.classList.toggle('hard', !!ch.hard && !ch.done);
        var lines = $('chart-lines'); if (lines.hidden !== !!ch.done) lines.hidden = !!ch.done; if ($('chart-next').hidden !== !ch.done) $('chart-next').hidden = !ch.done;
        if (!ch.done) ch.lines.forEach(function (l, k) { var row = lines.children[k], ok = l.have >= l.need; if (row.classList.contains('ok') !== ok) row.classList.toggle('ok', ok); setText(row.children[1], C.CHART_TEXT[l.k]); setText(row.children[2], l.have + ' / ' + l.need); });
        else if ($('chart-easy').getAttribute('data-k') !== (C.chartFull(state) ? 'f' : '1')) { var cf = C.chartFull(state); [['chart-easy', '가벼운 차트', cf ? '물자 한 뭉치' : '혈청 값 +' + Math.round(C.CHART_EASY * 100) + '%'], ['chart-hard', '빡빡한 차트', cf ? '한 명이라도 변하면 다시 채워요 · 물자 세 뭉치' : '한 명이라도 변하면 다시 채워요 · +' + Math.round(C.CHART_HARD * 100) + '%']].forEach(function (q) { var b = $(q[0]); b.setAttribute('data-k', cf ? 'f' : '1'); b.innerHTML = ''; b.appendChild(document.createTextNode(q[1])); b.appendChild(el('small', '', q[2])); }); }
      }
      $('labscene').setAttribute('data-er', ward.er ? ward.er.dose : ''); $('labscene').setAttribute('data-boost', ward.boost ? 1 : 0); $('lab').setAttribute('data-chart', ward.chart.lines.map(function (l) { return l.have + '/' + l.need; }).join(',') + (ward.chart.done ? ',done' : ''));
      setText($('lab-rate'), !(state.staff > 0) ? '연구원을 뽑으면 사람들이 와요' : !hasAide && !hasNurse ? '개조에서 연구 조교와 간호사를 사요' : !swOn ? '연구 조교와 간호사가 쉬고 있어요'
        : hasAide && hasNurse ? '' : hasAide ? '연구 조교 · ' + secs(C.serumSeconds(state)) + '마다 한 대' : '간호사 · 급한 사람부터');      // 4.0.8: 둘 다 일하고 있으면 적지 않는다(그림에 둘이 서 있고, 자리가 모자라다)
      if ($('lab-rate').hidden !== !$('lab-rate').textContent) $('lab-rate').hidden = !$('lab-rate').textContent;
      var sFull = ward.stock >= C.serumCap(state);
      fill($('lab-bar'), state.staff > 0 && !sFull ? ward.make : 0);
      setText($('serum-name'), sFull ? '혈청이 가득 찼어요' : '혈청 만들기'); setText($('serum-count'), ward.stock + ' / ' + C.serumCap(state));
      $('serum-btn').disabled = !(state.staff > 0) || sFull || ward.stun > 0;
      drawWard();
      $('labscene').setAttribute('data-seats', ward.seats.map(function (p) { return p.dose >= 0 ? p.dose : 'x'; }).join(','));
      $('labscene').setAttribute('data-stock', ward.stock);
      $('labscene').classList.toggle('tappable', state.staff > 0);
      setText($('lab-note'), !(state.staff > 0) ? '' : (state.dosesRun || 0) < 3 ? '단추로 혈청을 만들고, 사람을 눌러 놓아요'
        : (state.curesRun || 0) < 3 ? '한 대면 변하는 것이 멈추고, 여섯 대를 채우면 되돌아와요' : '');
      $('lab-note').classList.remove('boosted');
      setText($('lab-record'), '');      // 4.0.6: 서류 줄은 두지 않는다
      $('lab').setAttribute('data-doses', state.dosesRun || 0); $('lab').setAttribute('data-cures', state.curesRun || 0); $('lab').setAttribute('data-taps', state.serumTaps || 0); $('lab').setAttribute('data-turned', state.turnedRun || 0); $('lab').setAttribute('data-forks', state.projectsDone || 0);      // 화면 테스트가 읽는다
      // 줄: 시험관 · 시약 등급
      var rkc = C.rackCost(state), rgc = C.reagentCost(state), rgl = state.reagent || 0;
      setText(rows.rack.count, nT + ' / ' + C.SEAT_MAX); setText(rows.rack.info, isFinite(rkc) ? nT + '개 → ' + (nT + 1) + '개' : nT + '개');
      setText(rows.rack.cost, isFinite(rkc) ? '×1 ' + fmt(rkc) : '최대'); rows.rack.btn.disabled = !(rkc <= state.supplies); afford(rows.rack.cost, rkc); rows.rack.btn.classList.toggle('row-max', !isFinite(rkc));
      setText(rows.reagent.count, 'Lv ' + rgl + ' / ' + C.REAGENT_MAX); setText(rows.reagent.info, '×' + fmt(Math.pow(C.REAGENT_STEP, rgl)) + (isFinite(rgc) ? ' → ×' + fmt(Math.pow(C.REAGENT_STEP, rgl + 1)) : ''));
      setText(rows.reagent.cost, isFinite(rgc) ? '×1 ' + fmt(rgc) : '최대'); rows.reagent.btn.disabled = !(rgc <= state.supplies); afford(rows.reagent.cost, rgc); rows.reagent.btn.classList.toggle('row-max', !isFinite(rgc));
      var sq = qtyFor(C.maxStaff(state), C.COUNT_MAX - state.staff), scost = C.staffCost(state, sq);
      setText(rows.staff.count, state.staff + ' / ' + C.COUNT_MAX);
      setMile(rows.staff, state.staff, sq, scost <= state.supplies);
      setText(rows.staff.info, '초당 ' + fmt(C.labRate(state)));      // 1.5.9: 연구원은 약품(물자)도 만든다
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
      if (u.id === 'autoline') {           // 3.8.4 자동 합치기: 몇 초마다 한 쌍인지(현재 → 산 뒤). 설명에 초가 없었다
        var ap = Object.create(state); ap.upgrades = Object.create(state.upgrades); ap.upgrades.autoline = lv + 1;
        var aNow = C.autoMergeSeconds(state).toFixed(1) + '초', aNext = C.autoMergeSeconds(ap).toFixed(1) + '초';
        infoText = !lv ? '사면 ' + aNext + '마다 한 번' : lv >= u.max ? '현재 ' + aNow + '마다 한 번' : '현재 ' + aNow + ' → ' + aNext;
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
      // 자동화: 3구역 자동 합치기의 간격이 지금 몇 초이고 찍으면 몇 초가 되는지 보여 준다
      var tInfo = '';
      if (t.id === 'auto') {
        var lvNow = state.traits.auto || 0, tp = Object.create(state); tp.traits = Object.create(state.traits); tp.traits.auto = lvNow + 1;
        var cNow = C.autoMergeSeconds(state).toFixed(1) + '초', cNext = C.autoMergeSeconds(tp).toFixed(1) + '초';
        tInfo = lvNow >= t.max ? '조립공 ' + cNow + '마다' : '조립공 ' + cNow + ' → ' + cNext + '마다';
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
      li.appendChild(el('span', '', p.name + ' Lv ' + state.perks[p.id] + (p.max > 0 && state.perks[p.id] >= p.max ? ' · 최대' : '')));
      li.appendChild(el('span', 'num', C.effectNow(p, state.perks[p.id]) || p.desc));      // 지금 쌓인 효과를 적는다(전에는 레벨당 수치만 있었다)
      list.appendChild(li);
    });
  }

  /** 일지 목록과 '최근 일지' 한 줄. 열린 일지가 바뀔 때만 다시 그린다. */
  /**
   * 일지: 구역(장)마다 탭이 하나씩 있고, 고른 장의 글을 편 순서대로 보여 준다.
   * 아직 열리지 않은 편은 자리만 보이고(몇 편이 남았는지 알 수 있게), 아직 가지 못한 구역의 장은 누를 수 없다.
   */
  var baseNoKey = '';        // 제목 줄의 구역 이름을 마지막으로 잰 때의 글과 화면 너비
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
      // 끝을 본 뒤에 열리는 장(2.3.1): 첫 쪽을 받기 전에는 이름도 쪽 수도 가리고 '???' 로만 보인다. 이름부터가 이야기의 내용이라서다.
      // 2.3.0 에서는 장을 아예 숨겼는데, 뭔가 더 있다는 것은 보여 주는 편이 낫다는 말이 있었다
      var hiddenCh = zone === C.MOM_CHAPTER && !got;
      var btn = el('button', '', hiddenCh ? '???' : (zone === C.MOM_CHAPTER ? '' : zone + '장 ') + byZone[zone][0].zoneName + ' ' + got + '/' + byZone[zone].length);
      btn.type = 'button'; btn.disabled = !got; btn.setAttribute('aria-pressed', zone === journalTab ? 'true' : 'false');
      btn.addEventListener('click', function () { journalTab = zone; renderJournal(); });
      tabs.appendChild(btn);
    });
    byZone[journalTab].forEach(function (b, k) {
      var li = el('li');
      if (!state.story[b.id]) {
        li.className = 'locked';
        li.appendChild(el('span', 'j-no', (k + 1) + (b.mom ? '쪽' : '편')));
        li.appendChild(el('span', 'j-title', b.mom ? '아직 반창고를 떼지 않았어요. 구역을 지나면 이어져요.' : '아직 적지 않았어요. 이 구역의 목표를 채우면 이어져요.'));
      } else {
        li.appendChild(el('span', 'j-no', b.mom ? (k + 1) + '쪽' : b.zone + '장 ' + (k + 1) + '편'));
        li.appendChild(el('span', 'j-title', b.title));
        C.fillStory(b.text, state.heroName, state.heroGender).split('\n\n').forEach(function (para) { li.appendChild(el('p', '', para)); });      // 이름 자리에 지금의 주인공 이름을 넣는다
      }
      list.appendChild(li);
    });
    var momGot = C.momRead(state) > 0;      // 수첩을 받기 전에는 전체 편수에도 넣지 않는다
    setText($('journal-count'), read.length + ' / ' + C.BEATS.filter(function (b) { return momGot || !b.mom; }).length + '편');
  }

  /** 도트 화면에 넘길 값. 장면은 예전 구조의 이름(시설 열 종, 연구, 장비)을 쓰므로 지금 상태를 거기에 맞춰 옮긴다. */
  function sceneView() {
    var b = { scouts: state.buildings.scouts, garden: state.buildings.garden, purifier: state.buildings.purifier, workshop: state.buildings.workshop,
      port: state.stalls, district: state.zone >= 1 ? state.stalls : 0 };   // 좌판은 하역장·자치구 방으로 보인다
    var wearNow = C.cosmeticLook(mainState());      // 외형은 본 게임의 것을 쓴다(원정 중에도 같은 옷)
    return { danger: C.dangerOf(state), look: wearNow, coat: wearNow.coat, flag: wearNow.flag, t: state.dayClock / C.DAY_SECONDS, battle: C.dayPhase(state).phase === 'battle', day: state.day, zone: state.zone,
      safe: C.defensePower(state) >= C.nightStrength(state), boss: C.isBossWave(C.currentWave(state)), def: state.defenses, buildings: b,
      expedition: null, buff: !!state.buff, signal: state.signalLeft > 0, horde: state.zone >= 1 ? 'swarm' : 'walker', special: C.nightSpecials(state, state.day),
      research: { maps: state.upgrades.maps > 0, ration: state.upgrades.stock > 0, shift: state.upgrades.shifts > 0 },
      upgrades: { crowbar: state.upgrades.crowbar > 0, backpack: state.upgrades.cart > 0 }, gear: {},
      settle: state.settle || null,      // 7구역 정착지의 지은 건물(3.1.0)
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
          if (ev.flags && ev.flags.length) log(ev.flags.join(', ') + (C.hasBatchim(ev.flags[ev.flags.length - 1]) ? '을' : '를') + ' 받았다. 옷장에서 달 수 있다.', 'good');
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
        case 'settle-done':      // 4.2.0: 이장이 다 놓았다(손으로 놓은 것은 누른 자리에서 바로 알린다). 팝업은 띄우지 않는다
          if (ev.auto) campDone(C.SETTLE.filter(function (q) { return q.id === ev.id; })[0], ev.lv, ev.repaired, true);
          break;
        case 'camp-night':
          campFlash = { at: Date.now(), kind: 'breach' }; if (tab === 'z6' && pane === 'play') { sfx('rush'); buzz([40, 40, 40]); if (campPopFn) campPopFn(92, 56, ['북쪽', '동쪽', '남쪽'][ev.side] + ' 울타리에 습격', 'bad'); }
          log(['북쪽', '동쪽', '남쪽'][ev.side] + ' 울타리에 무리가 붙었다.', 'bad');
          break;
        case 'camp-held':
          campFlash = { at: Date.now(), kind: 'held' }; if (tab === 'z6' && pane === 'play') { sfx('goal'); buzz(30); if (campPopFn) campPopFn(92, 56, '습격을 막았다 +' + fmt(Math.floor(ev.gain)) + '명', 'done'); }
          log('습격을 막았다. 사람이 ' + fmt(Math.floor(ev.gain)) + '명 더 왔다.', 'good');
          break;
        case 'camp-breach':
          campFlash = { at: Date.now(), kind: 'breach' }; if (tab === 'z6' && pane === 'play') { sfx('rush'); buzz([80, 40, 140]); if (campPopFn) campPopFn(92, 56, ev.name ? '뚫렸다 · ' + ev.name + ' 부서짐' : '뚫렸다', 'bad'); }
          log(ev.name ? '울타리가 뚫렸다. ' + ev.name + (C.hasBatchim(ev.name) ? '이' : '가') + ' 부서졌다.' : '울타리가 뚫렸다.', 'bad');
          break;
        case 'train':      // 3.4.0: 승강장의 열차가 떠났다(why: hand 손으로 · auto 역무원 · full 만차 · horde 무리에 닿음)
          platAnim = { at: Date.now(), kept: ev.kept, cut: ev.cars - ev.kept, why: ev.why };
          if (ev.why === 'horde') { if (state.zone === 3) log('무리가 승강장에 닿았다. 뒤쪽 ' + (ev.cars - ev.kept) + '칸을 떼고 떠났다.', 'bad'); if (tab === 'z3' && pane === 'play') { sfx('breached'); buzz(60); } }
          else if (ev.full) { if (state.zone === 3) log('12칸 만차를 보냈다. 물자 ' + fmt(ev.gain) + ' 확보.', 'good'); if (tab === 'z3' && pane === 'play') sfx('goal'); }
          else if (tab === 'z3' && pane === 'play') sfx('train');
          break;
        case 'horde-sprint':      // 무리가 달려든다: 4구역을 보고 있을 때만 알린다
          if (tab === 'z3' && pane === 'play') { platSprint = Date.now(); sfx('rush'); buzz([40, 60, 40]); }
          break;
        case 'ending':
          pendingEnding = ev;      // 일지 창과 특전 창이 닫힌 뒤에 끝 화면을 띄운다(render 가 본다)
          log('혈청을 완성했다. 7구역에 닿았다.', 'story');
          log('생존자 ' + fmt(ev.saved) + '명을 구조했다. 모두 ' + fmt(Math.floor(ev.rescued)) + '명.' + (ev.tierUp ? ' 거점이 더 북적인다. 전체 생산이 늘었다.' : ''), 'good');
          if (ev.higher) { log('위험 ' + ev.danger + '단계에서 끝을 봤다. 위험 ' + Math.min(C.DANGER_MAX, ev.danger + 1) + '단계를 고를 수 있다. 전체 생산이 영구히 늘었다.', 'good'); toast('위험 ' + ev.danger + '단계 돌파'); }
          else if (ev.fastestHere && ev.count > 1) { log('이 단계의 가장 빠른 기록이다. ' + C.formatDuration(ev.runSeconds) + '.', 'good'); toast('새 기록 · ' + C.formatDuration(ev.runSeconds)); }
          if (ev.count === 1) log('이제 철수할 때 다음 회차의 위험 단계를 고를 수 있다.', 'good');
          if (ev.dangerTickets) log('위험 단계 보상으로 뽑기권 ' + ev.dangerTickets + '장을 받았다.', 'good');
          break;
        case 'salvage':
          toast('4구역 표류 화물 · ' + ev.name); log('선로에서 ' + ev.name + (C.hasBatchim(ev.name) ? '을' : '를') + ' 찾았다.', ''); if (!pastZoneText('4구역')) sfx('signal');
          break;
        case 'salvage-gone':
          log('표류 화물을 놓쳤다.', '');
          break;
        case 'contract':
          toast('3구역 납품 의뢰 · ' + ev.name + ' · ' + (ev.itemName || '완제품')); log(ev.name + (C.hasBatchim(ev.name) ? '이' : '가') + ' ' + (ev.itemName || '완제품') + ' ' + fmt(ev.need) + '개를 찾는다.', ''); if (!pastZoneText('3구역')) sfx('signal');
          break;
        case 'contract-gone':
          log('거래처가 기다리다 돌아갔다.', '');
          break;
        case 'order':
          toast('2구역 단골 주문 · ' + ev.name); log(ev.name + (C.hasBatchim(ev.name) ? '이' : '가') + ' 상품 ' + fmt(ev.need) + '개를 찾는다.', ''); if (!pastZoneText('2구역')) sfx('signal');
          break;
        case 'order-filled':      // 흥정꾼·자동 제어반·자동 신호가 알아서 넘긴 것(1.3.1)
        case 'contract-filled':
        case 'salvage-filled':
          if (ev.first) { toast('새로 적었다 · ' + ev.name); log(ev.name + '. 도감에 적었다.', 'good'); }
          else log(ev.name + (ev.type === 'order-filled' ? '에게 흥정꾼이 상품을 팔았다.' : ev.type === 'contract-filled' ? '에 알아서 납품했다.' : (C.hasBatchim(ev.name) ? '을' : '를') + ' 알아서 거뒀다.') + ' 물자 ' + fmt(ev.gain) + ' 확보.', 'good');
          break;
        case 'ward-turned':      // 5구역: 변한 사람이 달려든다
          wardLunge = { at: Date.now(), seat: ev.at, look: ev.look || 0 }; if (ev.at === 'er') wardErFx = null;
          if (tab === 'z4' && pane === 'play') { sfx('rush'); buzz([60, 40, 120]); }
          break;
        case 'bridge-shot':      // 4.1.0: 초소장이 쏜다
          if (tab === 'z5' && pane === 'play') { bridgeFx.push({ at: Date.now(), x: BR_X0 + Math.min(1, ev.x) * BR_W, kind: ev.kill ? 'kill' : 'hit', big: ev.big, hand: false }); if (bridgeFx.length > 60) bridgeFx.shift(); (ev.booms || []).forEach(function (bx6) { bridgeFx.push({ at: Date.now(), x: BR_X0 + Math.min(1, bx6) * BR_W, kind: 'boom' }); }); if (ev.kill && ev.gain > 0 && bridgePopFn) bridgePopFn(BR_X0 + ev.x * BR_W, 40, '+' + fmt(ev.gain), 'hit'); }
          break;
        case 'bridge-leak':
          bridgeLeak = Date.now(); if (tab === 'z5' && pane === 'play' && ev.big) { sfx('rush'); buzz(40); if (bridgePopFn) bridgePopFn(46, 30, '연속이 끊겼다', 'bad'); }
          break;
        case 'bridge-warn':      // 4.1.2: 떼가 온다
          if (tab === 'z5' && pane === 'play') { bridgeFlash = { at: Date.now(), kind: 'warn' }; sfx('rush'); buzz([40, 40, 40]); if (bridgePopFn) bridgePopFn(130, 24, '무리 습격', 'wave'); }
          break;
        case 'bridge-held':
          if (tab === 'z5' && pane === 'play') { sfx('goal'); buzz(30); if (bridgePopFn) bridgePopFn(100, 24, '습격을 막았다 +' + fmt(ev.gain), 'held'); }
          log('무리 습격을 막았다. 다리 ' + ev.streak + '단계.', 'good');
          break;
        case 'bridge-breach':
          bridgeFlash = { at: Date.now(), kind: 'breach' }; bridgeFx = [];
          if (tab === 'z5' && pane === 'play') { sfx('rush'); buzz([80, 40, 140]); if (bridgePopFn) bridgePopFn(92, 30, '뚫렸다', 'wave'); }
          break;
        case 'ward-er':      // 4.0.8: 이동 침대가 들어온다
          wardEr = Date.now(); wardErFx = null; if (tab === 'z4' && pane === 'play') { sfx('signal'); buzz(20); }
          break;
        case 'ward-nurse':
          wardFx[ev.at] = { at: Date.now(), kind: 'stop', nurse: true };
          break;
        case 'box-merge':      // 3.8.4: 자동 합치기가 합친 칸도 손으로 합쳤을 때처럼 튀어 보인다(전에는 아무 표시 없이 숫자만 바뀌었다)
          if (ev.auto) boardFx[ev.at] = { pop: true, gain: 0, delay: Math.min(ev.delay || 0, 12) * 60 };
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
          toast('3구역 고장 · ' + ev.name); log(ev.name + (C.hasBatchim(ev.name) ? '이' : '가') + ' 멈칫거린다. 고치면 라인이 빨라진다.', ''); if (!pastZoneText('3구역')) sfx('signal');
          break;
        case 'jam-fixed':
          log(ev.auto ? '자동 제어반이 기계를 다시 돌렸다.' : '기계가 저절로 다시 돈다.', '');
          break;
        case 'truck':
          toast('3구역 출하 트럭이 왔어요'); log('출하 트럭이 왔다. 출하장에 ' + Math.floor(ev.seconds) + '초분이 쌓여 있다.', ''); if (!pastZoneText('3구역')) sfx('signal');
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
          log(ev.mom ? '엄마의 수첩에서 반창고를 하나 뗐다. 〈' + ev.title + '〉' : '일지에 새 글을 적었다. 〈' + ev.title + '〉', 'story');
          journalTab = ev.zone;                                 // 일지를 열면 방금 적힌 장이 보인다
          if (prefs.storyPop !== 'off') Story.push(ev.mom ? ev.zoneName : ev.zone + '구역 ' + ev.zoneName + ' · 생존 일지', ev.text, ev.title);
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
    if (dt > AWAY_THRESHOLD) { if (!home) reportAway(C.applyOffline(state, dt), true); }      // 탭이 잠들었다 깨어남: 정산 화면을 먼저 보여 준다. 스테이지는 그동안 멈춰 있었던 것으로 친다
    else handleEvents(C.tick(state, dt));
    if (home && state.stage && C.stageStatus(state).over) endStage(false);      // 스테이지가 끝났다: 결과를 본 게임에 적고 돌아간다

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
    $('danger-down').addEventListener('click', function () { if (C.setDangerNext(state, (state.dangerNext || 0) - 1).ok) { sfx('tab'); Store.save(); render(); } });
    $('danger-up').addEventListener('click', function () { if (C.setDangerNext(state, (state.dangerNext || 0) + 1).ok) { sfx('tab'); Store.save(); render(); } });
    Array.prototype.forEach.call(document.querySelectorAll('[data-hub]'), function (b) { b.addEventListener('click', function () { if (b.disabled) return; setHubTab(b.dataset.hub); if (b.dataset.hub === 'exped') renderStages(); }); });
    $('gacha-pull').addEventListener('click', doPull);
    $('ticket-buy').addEventListener('click', function () { if (C.buyTicket(state).ok) { sfx('buy'); Store.save(); renderShop(); } });
    $('odds-toggle').addEventListener('click', function () { oddsOpen = !oddsOpen; renderShop(); });
    $('stage-quit').addEventListener('click', function () {
      if (!home) return;
      confirmBox('원정에서 돌아가기', '스테이지를 그만두고 거점으로 돌아가요. 여기까지 한 것은 남지 않아요.', '계속한다', '돌아간다', function () { endStage(true); });
    });
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
      else { log(r.zone.no + '구역 ' + r.zone.name + '의 문을 열었다. 앞 구역은 그대로 남아 물자를 보낸다.', 'good'); tab = 'z' + r.index; pane = 'play';      /* 2.8.9: 새 구역은 운영 화면부터. 목표 화면에서 넘어가면 새 구역의 목표 화면에 그대로 서 있었다 */ moveFx(r.zone.no + '구역', r.zone.name, 1, r.index - 1, r.index); }
      sfx('relocate'); Store.save(); Cloud.flush(); render();
    });
    // 4구역: 청신호. 이 신호로 도착한 열차가 있으면 평소의 도착 알림을 그대로 낸다.
    // 3.8.0: 승강장 그림을 누르면 다음 칸이 빨리 붙는다(손이 쉬지 않게). 누른 자리에 불꽃이 튄다
    $('platform').addEventListener('click', function () {
      var res = C.pullCar(state);
      if (!res.ok) return;
      platPull = Date.now(); sfx(res.added ? 'buy' : 'click'); if (res.added) buzz(12);
      render();
    });
    $('train-horn').addEventListener('click', function () {
      var res = C.blowHorn(state);
      if (!res.ok) return;
      platHorn = Date.now(); log(res.broke ? '경적으로 무리의 돌진을 막았다.' : '경적을 울렸다. 무리가 물러선다.', ''); sfx('signal'); buzz(35); Store.save(); render();
    });
    $('train-go').addEventListener('click', function () {
      var res = C.sendTrain(state);
      if (!res.ok) return;
      platAnim = { at: Date.now(), kept: res.kept, cut: 0, why: 'hand' };
      log(res.kept + '칸 열차를 보냈다. 물자 ' + fmt(res.gain) + ' 확보.' + (res.full ? ' 만차다.' : ''), res.kept >= C.LONG_CARS ? 'good' : '');
      sfx(res.kept >= C.LONG_CARS ? 'goal' : 'train'); buzz(res.kept >= C.LONG_CARS ? 40 : 20); Store.save(); render();
    });
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

    /*
     * 휴대폰의 뒤로 가기(2.7.0): 전에는 누르면 곧바로 게임에서 나가 홈 화면이 됐다. 이제 게임 안에서 한 단계씩 물러난다.
     *   열린 창이 있으면 그 창을 닫는다 → 원정 중이면 돌아갈지 묻는다 → 상황 화면이 아니면 상황 화면으로 → 상황 화면이면 "한 번 더 누르면 나가요".
     *   2초 안에 한 번 더 누르면 정말 나간다. 고르기 전에는 닫을 수 없는 창(특전 고르기)은 그대로 둔다.
     * 받는 길은 둘이다: 안드로이드 앱은 앱이 직접 묻고(window.Zone7Back), 브라우저와 웹 앱은 방문 기록으로 받는다(아래).
     */
    (function () {
      var armed = 0;
      function shown(el) { return !!el && !el.hidden && el.getClientRects().length > 0; }      // offsetParent 로 보면 안 된다: 화면에 고정된 창(position: fixed)은 보여도 offsetParent 가 없다
      function goBack() {
        var veils = Array.prototype.slice.call(document.querySelectorAll('.story-veil, [role="dialog"], [role="alertdialog"]')).filter(shown);
        if (veils.length) {
          // 뒤에 있는 창부터 본다. 닫을 수 있는 창을 만나면 그것을 닫는다(특전 고르기처럼 닫을 수 없는 창이 함께 떠 있어도 다른 창은 닫힌다)
          for (var vi = veils.length - 1; vi >= 0; vi--) {
            var top = veils[vi];
            if (top.id === 'story') { Story.advance(); return true; }
            var x = top.querySelector('.feedback-close, [id$="-close"], #confirm-no, [data-close]');
            if (x && shown(x)) { x.click(); return true; }
          }
          return true;      // 닫는 단추가 없는 창(특전 고르기)만 있으면 그대로 둔다. 그래도 게임에서 나가지는 않는다
        }
        if (home && shown($('stage-quit'))) { $('stage-quit').click(); return true; }
        var base = document.querySelector('[data-mview-set="base"]');
        if (base && shown(base) && base.getAttribute('aria-pressed') !== 'true') { base.click(); return true; }
        return false;
      }
      /** 한 걸음 물러난다. 게임 안에서 처리했으면 'stay', 정말 나가야 하면 'exit'. 상황 화면에서는 2초 안에 두 번 눌러야 나간다. */
      function step() {
        var done = false;
        try { done = goBack(); } catch (e) { done = false; }
        if (done) { armed = 0; return 'stay'; }
        if (Date.now() - armed < 2000) { armed = 0; return 'exit'; }
        armed = Date.now(); toast('한 번 더 누르면 게임을 나가요');
        return 'stay';
      }
      // 안드로이드 앱(껍데기)의 뒤로 가기는 앱이 받아서 이 함수에 묻는다(MainActivity.onBackPressed). 'exit' 일 때만 앱이 뒤로 물러난다.
      window.Zone7Back = step;
      /*
       * 브라우저와 홈 화면에 설치한 웹 앱(2.7.1): 2.7.0 은 시작할 때 방문 기록을 한 칸 쌓아 두는 방식이었는데, 실제 휴대폰에서는 그냥 나가졌다.
       * 크롬은 사람이 화면을 건드리지 않은 채 쌓인 칸을 뒤로 가기에서 건너뛴다(뒤로 가기를 막는 사이트를 거르는 장치).
       * 그래서 사람이 화면을 누를 때마다 한 칸씩, 세 칸까지 쌓아 둔다. 건드린 뒤에 쌓인 칸은 건너뛰지 않는다.
       * 뒤로 가기로 한 칸이 빠지면(popstate) 한 걸음 물러나고, 빠진 칸은 다음에 화면을 누를 때 다시 채운다.
       */
      var depth = 0, DEPTH_MAX = 3;
      function arm() { if (depth >= DEPTH_MAX) return; try { history.pushState({ zone7: depth + 1 }, ''); depth++; } catch (e) { /* 기록을 쌓지 못하는 환경: 전처럼 바로 나간다 */ } }
      ['pointerdown', 'keydown'].forEach(function (type) { document.addEventListener(type, arm, { passive: true, capture: true }); });
      window.addEventListener('popstate', function () {
        depth = Math.max(0, depth - 1);
        if (step() === 'exit') { try { history.go(-(depth + 1)); } catch (e) { /* 더 물러날 곳이 없다 */ } depth = 0; }
      });
    })();

    /*
     * 옆으로 밀어 탭 넘기기(2.8.0): 화면을 왼쪽으로 밀면 다음 탭, 오른쪽으로 밀면 앞 탭으로 간다.
     *   기록 화면: 일지 · 업적 · 도감 · 무전 · 통계 · 패치 · 도움말 · 설정
     *   구역 화면: 1구역 · 2 · 3 … · 방벽
     *   모험 창  : 도전 · 원정 · 상점
     * 밀기로 치는 것: 가로로 60px 넘게, 세로보다 두 배 넘게, 0.6초 안에. 위아래로 읽는 중에 잘못 넘어가지 않게 한다.
     * 넘기지 않는 곳: 옆으로 미는 줄(탭 줄, 도감의 묶음 줄), 음량 막대, 글을 적는 칸, 그리고 다른 창(일지 알림, 확인창)이 떠 있을 때.
     * 끝에서는 더 넘어가지 않는다(처음으로 돌아가지 않는다).
     */
    (function () {
      var sx = 0, sy = 0, st = 0, ok = false, strip = null, stripAt = 0, onZoneTabs = false;
      function vis(el) { return !!el && !el.hidden && el.getClientRects().length > 0; }
      function group() {
        if (vis($('hub'))) return Array.prototype.slice.call(document.querySelectorAll('#hub [data-hub]'));
        if (Array.prototype.slice.call(document.querySelectorAll('.story-veil, [role="dialog"], [role="alertdialog"]')).some(vis)) return null;      // 다른 창이 떠 있다
        var now = document.querySelector('[data-mview-set][aria-pressed="true"]'), view = now ? now.getAttribute('data-mview-set') : '';
        if (view === 'record') return Array.prototype.slice.call(document.querySelectorAll('[data-rtab-set]'));
        if (view === 'manage') return Array.prototype.slice.call(document.querySelectorAll('#zone-tabs button'));
        return null;
      }
      /** 누른 곳이 옆으로 미는 줄이나 막대 안인가. */
      function blocked(el) {
        strip = null;
        for (var p = el; p && p !== document.body; p = p.parentElement) {
          var tag = p.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
          // 2.8.6: 옆으로 미는 줄(일지의 장 목록 같은 것) 위에서는 그 줄이 먼저 움직인다. 전에는 여기서 아예 막아서,
          // 줄이 끝까지 가 있어 더 움직이지 않을 때도 탭이 넘어가지 않았다. 이제 줄을 기억해 두었다가, 손을 뗐을 때 줄이 그대로면 탭을 넘긴다.
          if (!strip && p.scrollWidth > p.clientWidth + 4) { var ox = getComputedStyle(p).overflowX; if (ox === 'auto' || ox === 'scroll') { strip = p; stripAt = p.scrollLeft; } }
        }
        return false;
      }
      /** dir: 1 다음, -1 앞. 넘겼으면 true. 테스트와 다른 입력(키보드)도 쓸 수 있게 밖에 둔다. */
      function turn(dir, zonesOnly) {
        var g = group(); if (!g) return false;
        // 2.9.1: 구역 화면에서는 먼저 운영 · 개조 · 목표를 넘긴다. 끝(목표에서 다음, 운영에서 앞)에서는 옆 구역으로 간다.
        //        구역 탭 줄 위에서 밀면(zonesOnly) 바로 구역을 넘긴다.
        if (!zonesOnly && g.length && g[0].parentElement === $('zone-tabs') && vis($('zone-panes'))) {
          var ps = Array.prototype.slice.call($('zone-panes').children).filter(vis), pa = -1;
          ps.forEach(function (b, i) { if (b.getAttribute('aria-pressed') === 'true') pa = i; });
          if (pa >= 0 && pa + dir >= 0 && pa + dir < ps.length) { ps[pa + dir].click(); try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) { /* 넘어가기만 하면 된다 */ } return true; }
        }
        g = g.filter(function (b) { return vis(b) && !b.disabled && !b.hasAttribute('data-locked'); });
        var at = -1; g.forEach(function (b, i) { if (b.getAttribute('aria-pressed') === 'true') at = i; });
        var to = at + dir;
        if (at < 0 || to < 0 || to >= g.length) return false;
        g[to].click();
        // 2.9.1: 밀어서 넘긴 뒤에는 초점을 어디에도 두지 않는다. 2.8.7 에서 넘어간 탭으로 초점을 옮겼더니 그 탭에 초점 테두리가 새로 생겼다
        //        (남아 있던 테두리의 진짜 까닭은 :hover 였고 2.8.9 에서 고쳤다).
        try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) { /* 초점은 그대로 둬도 된다 */ }
        try { g[to].scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) { /* 줄이 길 때 고른 탭이 보이게만 한다 */ }
        return true;
      }
      window.Zone7Swipe = turn;
      document.addEventListener('touchstart', function (e) {
        var t = e.touches && e.touches.length === 1 ? e.touches[0] : null;
        ok = !!t && !blocked(e.target);
        onZoneTabs = !!(e.target && e.target.closest && e.target.closest('#zone-tabs'));
        if (t) { sx = t.clientX; sy = t.clientY; st = Date.now(); }
      }, { passive: true });
      // 옆으로 미는 중이라는 것이 분명해지면 브라우저의 기본 동작을 막는다. 일부 브라우저는 옆으로 미는 것을 '앞 페이지로 가기'로 받아서,
      // 탭을 넘기려다 게임 안의 뒤로 가기가 눌리거나 게임에서 나가졌다(시험 중에 실제로 그랬다). 위아래로 미는 것은 건드리지 않는다.
      document.addEventListener('touchmove', function (e) {
        var t = e.touches && e.touches.length === 1 ? e.touches[0] : null;
        if (!ok || !t) return;
        var dx = Math.abs(t.clientX - sx), dy = Math.abs(t.clientY - sy);
        if (!strip && dx > 12 && dx > dy * 1.5 && e.cancelable) e.preventDefault();      // 옆으로 미는 줄 위에서는 줄이 움직이게 둔다
      }, { passive: false });
      document.addEventListener('touchend', function (e) {
        var t = e.changedTouches && e.changedTouches[0];
        if (!ok || !t) return;
        ok = false;
        var dx = t.clientX - sx, dy = t.clientY - sy;
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - st > 600) return;
        if (strip && Math.abs(strip.scrollLeft - stripAt) > 2) return;      // 줄이 움직였다: 줄을 민 것이지 탭을 넘긴 것이 아니다
        turn(dx < 0 ? 1 : -1, onZoneTabs);
      }, { passive: true });
    })();

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
    wirePerkReroll(); wireTower();
    wireOrder();
    wireContract(); wireLineExtras(); wireZoneEvents();
    wireSalvage();
    // 배경 음악(2.5.0): 켬/끔과 음량을 효과음과 따로 기억한다. 곡은 render 가 상황에 맞춰 고른다(pickMood)
    (function () {
      // 기본값(2.6.0): 음원 파일이 실려 있으면 켬, 없으면(합성 음악뿐이면) 끔. 직접 고른 적이 있으면 그것을 따른다.
      var files = 0;
      try { if (window.Sound && window.ZONE7_BGM) files = window.Sound.setTracks(window.ZONE7_BGM); } catch (e) { files = 0; }
      var saved = recall('zone7-bgm');
      if (files > 0 && window.ZONE7_BGM_CREDIT) { $('bgm-credit-row').hidden = false; setText($('bgm-credit'), String(window.ZONE7_BGM_CREDIT)); }      // 음원을 만든 사람
      var btn = $('bgm-toggle'), bar = $('bgm-volume'), label = $('bgm-volume-num'), on = saved === 'on' || (saved !== 'off' && files > 0);
      function show() { btn.setAttribute('aria-pressed', String(on)); setText(btn, on ? '음악 켬' : '음악 끔'); }
      function vol(v, keep) {
        var n = 50;
        try { if (window.Sound) n = window.Sound.setMusicVolume(v); } catch (e) { /* 소리는 없어도 된다 */ }
        bar.value = n; setText(label, String(n));
        if (keep) remember('zone7-bgm-volume', n);
      }
      try { if (window.Sound) { window.Sound.setMusicEnabled(on); window.Sound.startMusic(); } } catch (e) { /* 소리는 없어도 된다 */ }
      show(); vol(recall('zone7-bgm-volume'), false);
      btn.addEventListener('click', function () { on = !on; try { if (window.Sound) window.Sound.setMusicEnabled(on); } catch (e) { /* 없어도 된다 */ } remember('zone7-bgm', on ? 'on' : 'off'); show(); });
      bar.addEventListener('input', function () { vol(bar.value, true); });
    })();
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
      try { code = encodeSave(C.serialize(mainState())); }
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

    if (resumeStage(now)) log('하던 원정으로 돌아왔다.', 'good');
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
  // 3.0.1: 넘겨주는 것은 언제나 본 게임이다. 전에는 원정 중이면 원정 판(0에서 시작한 판)을 넘겨서, 새 페이지가 그것을 본 게임으로 알고 이어 갔다.
  //        원정 판은 Store.save 가 따로 적어 두고, 새 페이지가 resumeStage 로 되찾는다.
  try { if (hot && hot.snapshot) hot.snapshot(function () { if (home) { try { Store.save(); } catch (e) { /* 넘기기만 하면 된다 */ } } return mainState(); }); } catch (e) { /* 뷰어 밖에서는 없다 */ }
  if (hot && hot.ready) hot.ready(start);
  else start((hot && hot.data) || {});
})();
