/*
 * 화면 계층 — GameCore 의 상태를 그리고, 입력을 GameCore 함수 호출로 바꾼다.
 * 규칙 계산은 여기서 하지 않는다. 구성:
 *   Store   : localStorage 래퍼 (실패해도 게임은 계속된다)
 *   Cloud   : 계정별 서버 저장. 게시된 페이지에서만 켜지고, 없으면 조용히 Store 만 쓴다
 *   build*  : 시설·방벽·연구·장비·원정·유물·업적 목록을 한 번만 만든다
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

  var SAVE_KEY = 'beyond-barricade-save-v1';
  var AUTOSAVE_MS = 10000;
  var AWAY_THRESHOLD = 60;   // 프레임 간격이 이보다 길면 '자리 비움'으로 처리(초)
  var LOG_MAX = 40;
  var fmt = C.formatNumber;

  var state = null;
  var qtyMode = 1;           // 1 | 10 | 'max'
  var tab = 'buildings';     // 거점 관리 패널에서 보고 있는 탭
  var TAB_HINTS = {
    buildings: '시설은 가만히 있어도 물자를 만든다.',
    defenses: '방어력이 오늘 밤 무리 규모보다 커야 한다.',
    research: '연구는 이 거점에서만 유효하다. 이주하면 다시 해야 한다.',
    upgrades: '장비는 수색 배수를 올린다. 수색 배수가 두 배가 될 때마다 직접 수색 수익이 한 단계(기본의 1배)씩 는다.',
    gear: '부품으로 만든다. 이주해도 사라지지 않는다. 부품은 밤 방어와 원정에서 나온다.',
    serums: '', // 쓸 수 있는 항체 수가 들어가므로 render 가 채운다
    shop: '물자로 사는 일회성 거래. 값은 지금 생산량에 맞춰 매겨진다.',
    jobs: '' // 생존자 수가 들어가므로 render 가 채운다
  };
  var lastFrame = 0, lastSave = 0, nextFlavor = 0;
  var guideNow = null; // 지금 '다음 할 일' 칸에 보이는 안내(바로 가기 단추가 읽는다)
  var frameErrorShown = false;
  var paused = false;        // 다른 기기가 진행 중이라 이 기기가 멈춰 있는지(Cloud 가 관리한다)
  var scene = null;          // 도트 화면 핸들(캔버스를 못 쓰는 환경이면 null)
  var heldLogged = false;    // 이번 농성에서 '버텼다' 로그를 이미 남겼는지(1분마다 같은 줄이 쌓이지 않게)
  /** 효과음. 모듈이 없거나 소리를 못 내는 환경이면 아무 일도 하지 않는다. */
  function sfx(name) { try { if (window.Sound) window.Sound.play(name); } catch (e) { /* 소리는 없어도 된다 */ } }

  /* ---------- 일지 연출 ---------- */
  var Story = {
    queue: [], timer: null, full: '', shown: 0,
    /** 새 일지를 대기열에 넣는다. 이미 하나가 떠 있으면 닫힌 뒤에 이어서 나온다. */
    push: function (zoneLabel, text) {
      Story.queue.push({ zone: zoneLabel, text: text });
      if ($('story').hidden) Story.next();
    },
    next: function () {
      var item = Story.queue.shift();
      if (!item) { $('story').hidden = true; return; }
      Story.full = item.text; Story.shown = 0;
      setText($('story-zone'), item.zone);
      $('story-text').textContent = '';
      $('story').hidden = false;
      sfx('story');
      try { $('story-close').focus(); } catch (e) { /* 초점을 못 옮겨도 진행한다 */ }
      var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (still) { Story.finish(); return; }
      Story.timer = setInterval(function () {
        Story.shown++;
        $('story-text').textContent = Story.full.slice(0, Story.shown);
        if (Story.shown % 3 === 0) sfx('type');
        if (Story.shown >= Story.full.length) Story.finish();
      }, 34);
    },
    finish: function () {
      clearInterval(Story.timer); Story.timer = null;
      Story.shown = Story.full.length;
      $('story-text').textContent = Story.full;
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
    none: '10초마다 이 브라우저에 자동 저장',
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
      var differs = d.remote.lifetimeEarned !== state.lifetimeEarned || d.remote.relocations !== state.relocations;
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
      window.Updater.checkRemote(window.fetch.bind(window), 'version.json', Update.current).then(function (r) {
        if (!r.available || r.info.version === Update.offered) return; // "나중에"를 누른 버전은 다시 묻지 않는다
        setText($('update-text'), '새 버전 ' + (r.info.name || r.info.version) + ' 이 나왔다.' + (r.info.title ? ' ' + r.info.title + '.' : ''));
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
      location.reload();
    },
    /** 지난번에 열었을 때와 버전이 다르면 한 번 알린다. */
    afterUpdate: function () {
      if (!Update.current) return;
      var seen = recall(VERSION_KEY);
      remember(VERSION_KEY, Update.current);
      if (seen && seen !== Update.current) {
        var name = PATCH_NOTES.length ? PATCH_NOTES[0].ver : Update.current;
        notice(name + ' 으로 업데이트됐다. 기록 > 패치에서 바뀐 점을 볼 수 있다.');
        log(name + ' 으로 업데이트됐다.', 'good');
      }
    }
  };

  /* ---------- 작은 DOM 도우미 ---------- */
  /** 값이 바뀐 경우에만 DOM 을 건드려 0.1초 주기 갱신 비용을 줄인다. */
  function setText(el, text) { if (el && el.textContent !== text) el.textContent = text; }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
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
    '떠돌이 상인이 건전지와 소문을 두고 갔다.',
    '방벽 너머에서 긁는 소리가 밤새 이어졌다.'
  ];
  function log(text, kind) {
    var list = $('log');
    var li = el('li', kind ? 'log-' + kind : '');
    li.appendChild(el('span', 'log-day', 'D+' + pad3(state ? state.day : 1)));
    li.appendChild(el('span', 'log-text', text));
    list.insertBefore(li, list.firstChild);
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
    head.appendChild(name); head.appendChild(count);
    var desc = el('span', 'row-desc', def.desc);
    var foot = el('span', 'row-foot');
    var info = el('span', 'row-info');
    var cost = el('span', 'row-cost');
    foot.appendChild(info); foot.appendChild(cost);
    btn.appendChild(head); btn.appendChild(desc); btn.appendChild(foot);
    btn.addEventListener('click', onBuy);
    return { btn: btn, count: count, info: info, cost: cost };
  }

  /** 현재 수량 모드(×1, ×10, 최대)에서 실제로 살 개수. 최대 모드는 최소 1개로 표시한다. */
  function wantQty(kind, id) {
    if (kind === 'defense') return qtyMode === 'max' ? Math.max(1, C.maxDefenses(state, id)) : qtyMode;
    var room = Math.max(1, C.BUILDING_MAX - state.buildings[id]); // 시설은 최대치까지 남은 자리를 넘지 않는다
    return Math.min(room, qtyMode === 'max' ? Math.max(1, C.maxBuildings(state, id)) : qtyMode);
  }

  /* ---------- 확인 창 ---------- */
  /**
   * 되돌릴 수 없는 행동 전에 띄우는 확인 창. 안전한 쪽(noText) 버튼에 초점을 두어
   * 실수로 Enter 를 눌러도 실행되지 않게 한다. 확인을 누르면 onYes 를 실행한다.
   */
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

  /* ---------- 이주 특전 선택 ---------- */
  /** 골라야 할 특전이 있으면 선택 화면을 띄운다. 게임은 뒤에서 계속 진행된다. */
  function renderPerkChoice() {
    var key = state.pendingPerks.join(',') + (state.pendingRare ? '!' : '');
    if (key === perkShown) return;
    perkShown = key;
    var box = $('perk-list');
    box.textContent = '';
    if (!state.pendingPerks.length) { $('perk').hidden = true; return; }
    setText($('perk-lead'), state.pendingRare
      ? '구역을 넘었다. 하나를 고르면 한 번에 ' + C.RARE_LEVELS + '레벨이 오른다. 고른 특전은 끝까지 남는다.'
      : '새 지구에 도착했다. 하나를 고른다. 고른 특전은 끝까지 남는다.');
    state.pendingPerks.forEach(function (id) {
      var def = null;
      C.PERKS.forEach(function (k) { if (k.id === id) def = k; });
      if (!def) return;
      var btn = el('button', 'sync-pick');
      btn.type = 'button';
      var name = el('b', '', def.name);
      name.setAttribute('data-lv', 'Lv ' + C.perkLevel(state, id) + ' → ' + Math.min(def.max, C.perkLevel(state, id) + (state.pendingRare ? C.RARE_LEVELS : 1)));
      btn.appendChild(name);
      btn.appendChild(el('span', '', '레벨당 ' + def.desc));
      btn.addEventListener('click', function () {
        var r = C.choosePerk(state, id);
        if (!r.ok) return;
        log('이주 특전: ' + r.name + ' ' + r.level + '레벨.', 'good');
        toast('특전 · ' + r.name + ' Lv ' + r.level);
        sfx('buy');
        Store.save(); Cloud.flush();
        render();
      });
      box.appendChild(btn);
    });
    $('perk').hidden = false;
    try { box.firstChild.focus(); } catch (e) { /* 초점을 못 옮겨도 진행한다 */ }
  }

  function buildLists() {
    // 구역 고유 시설·방벽은 줄을 전부 만들어 두고, render 가 지금 구역의 것만 보이게 한다(이주해도 목록을 다시 만들지 않는다).
    C.ZONE_BUILDINGS.concat(C.BUILDINGS).forEach(function (b) {
      var r = buildRow(b, function () {
        if (state.buildings[b.id] >= C.BUILDING_MAX) return;
        var q = wantQty('building', b.id);
        var res = C.buyBuilding(state, b.id, q);
        if (res.ok && res.milestone) {
          log(b.name + ' ' + state.buildings[b.id] + '곳 달성. 생산이 2배로 늘었다.', 'good');
          toast(b.name + ' ' + state.buildings[b.id] + '곳 · 생산 2배');
        }
        render();
      });
      // 보유 수 옆에 최대치를, 행 아래에 채워진 정도를 보여 준다
      r.count.appendChild(document.createTextNode(''));
      r.owned = el('span', '', '0');
      r.count.textContent = '';
      r.count.appendChild(r.owned);
      r.count.appendChild(el('span', 'row-max', ' / ' + C.BUILDING_MAX));
      var bar = el('span', 'row-bar');
      r.fill = el('i');
      bar.appendChild(r.fill);
      r.btn.appendChild(bar);
      if (b.zone !== undefined) r.btn.classList.add('row-zone');
      rows.buildings[b.id] = r;
      $('buildings').appendChild(r.btn);
    });
    C.ZONE_DEFENSES.concat(C.DEFENSES).forEach(function (d) {
      var r = buildRow(d, function () {
        C.buyDefense(state, d.id, wantQty('defense', d.id));
        render();
      });
      if (d.zone !== undefined) r.btn.classList.add('row-zone');
      rows.defenses[d.id] = r;
      $('defenses').appendChild(r.btn);
    });
    C.UPGRADES.forEach(function (u) {
      var r = buildRow(u, function () {
        if (C.buyUpgrade(state, u.id).ok) log(u.name + ' 확보. 수색이 한결 수월해졌다.', 'good');
        render();
      });
      rows.upgrades[u.id] = r;
      $('upgrades').appendChild(r.btn);
    });
    C.RESEARCH.forEach(function (t) {
      var r = buildRow(t, function () {
        if (C.buyResearch(state, t.id).ok) log('연구 완료: ' + t.name + '. ' + t.desc + '.', 'good');
        render();
      });
      rows.research[t.id] = r;
      $('research').appendChild(r.btn);
    });
    C.GEAR.forEach(function (g) {
      var r = buildRow(g, function () {
        var res = C.craftGear(state, g.id);
        if (res.ok) log('제작: ' + g.name + (g.max > 1 ? ' ' + res.level + '레벨' : '') + '.', 'good');
        render();
      });
      rows.gear[g.id] = r;
      $('gear').appendChild(r.btn);
    });
    C.SERUMS.forEach(function (k) {
      var r = buildRow({ id: k.id, name: k.name, desc: '레벨당 ' + k.desc }, function () {
        var res = C.buySerum(state, k.id);
        if (res.ok) { log('혈청 투여: ' + k.name + ' ' + res.level + '레벨. 항체 샘플 ' + fmt(res.cost) + '개 사용.', 'good'); Store.save(); Cloud.flush(); }
        render();
      });
      rows.serums[k.id] = r;
      $('serums').appendChild(r.btn);
    });
    C.SHOP.forEach(function (it) {
      var r = buildRow(it, function () {
        var res = C.buyShop(state, it.id);
        if (res.ok) {
          if (it.id === 'bundle') log('상인에게서 부품 ' + res.parts + '개를 샀다.', 'good');
          if (it.id === 'mercs') log('용병을 고용했다. 오늘 밤 방어력 1.5배.', 'good');
          if (it.id === 'recall' && res.expedition) logExpedition(res.expedition);
        }
        render();
      });
      rows.shop[it.id] = r;
      $('shop').appendChild(r.btn);
    });
    C.EXPEDITIONS.forEach(function (x) {
      var r = buildRow(x, function () {
        if (C.startExpedition(state, x.id).ok) log('원정대가 ' + x.name + '(으)로 출발했다.');
        render();
      });
      rows.expeditions[x.id] = r;
      $('expeditions').appendChild(r.btn);
    });
    // 유물과 업적은 누르는 것이 아니라 읽는 것이므로 버튼이 아닌 정보 행으로 만든다.
    C.RELICS.forEach(function (rl) {
      var box = el('div', 'info-row');
      var name = el('b'), desc = el('span');
      box.appendChild(name); box.appendChild(desc);
      rows.relics[rl.id] = { box: box, name: name, desc: desc };
      $('relics').appendChild(box);
    });
    C.PERKS.forEach(function (k) {
      var box = el('div', 'ach');
      var name = el('b', '', k.name);
      box.appendChild(name);
      box.appendChild(el('span', '', '레벨당 ' + k.desc));
      rows.perks[k.id] = { box: box, name: name };
      $('perks').appendChild(box);
    });
    if (!PATCH_NOTES.length) $('notes').appendChild(el('p', 'hint', '패치노트를 불러오지 못했다.'));
    PATCH_NOTES.forEach(function (n, i) {
      var box = el('div', 'note' + (i === 0 ? ' note-now' : ''));
      var head = el('div');
      head.appendChild(el('div', 'note-ver', n.ver));
      head.appendChild(el('div', 'note-date', n.at || n.date)); // 낸 시각이 기록된 버전은 초까지, 아니면 날짜만
      box.appendChild(head);
      box.appendChild(el('p', 'note-title', n.title));
      var ul = el('ul');
      n.items.forEach(function (text) { ul.appendChild(el('li', '', text)); });
      box.appendChild(ul);
      $('notes').appendChild(box);
    });
    setText($('notes-current'), PATCH_NOTES.length ? '현재 ' + PATCH_NOTES[0].ver : '');
    buildHelp();
    buildStats();
    buildJobs();
    C.ACHIEVEMENTS.forEach(function (a) {
      var box = el('div', 'ach');
      box.appendChild(el('b', '', a.name));
      box.appendChild(el('span', '', a.desc));
      rows.achievements[a.id] = box;
      $('achievements').appendChild(box);
    });
  }

  /** 머리띠의 1~7 구역 칸. 지나온 곳은 검게, 지금 있는 곳은 노랗게 칠한다. */
  function buildRoute() {
    C.ZONES.forEach(function (z) {
      var li = el('li', '', String(z.no));
      li.title = z.no + '구역 ' + z.name;
      $('route').appendChild(li);
    });
  }
  function renderZone() {
    var zone = C.currentZone(state), idx = C.zoneIndex(state), threat = C.zoneThreat(state);
    var label = C.zoneLabel(state), sector = C.sectorIndex(state);
    if (state.cycle > 0) label = (state.cycle + 1) + '회차 ' + label; // 회차를 넘긴 뒤에는 몇 회차인지 함께 적는다
    setText($('base-no'), label + ' ' + zone.name);
    setText($('zone-name'), label + ' · ' + zone.name);
    var traitText = zone.trait + ' · 무리: ' + zone.horde.name + (threat > 1 ? ' · 무리 규모 ×' + (threat < 100 ? threat.toFixed(2) : fmt(threat)) : '');
    setText($('zone-trait'), traitText);
    setText($('m-zone-trait'), label + ' ' + zone.name + ' · ' + traitText); // 폰 화면의 '상황' 보기용
    // 이 구역 26개 지구 중 어디까지 왔는지
    setText($('sector-text'), zone.no + '구역 ' + (sector + 1) + ' / ' + C.SECTORS + ' 지구');
    $('sector-bar').style.width = ((sector + 1) / C.SECTORS * 100).toFixed(1) + '%';
    var cells = $('route').children;
    for (var i = 0; i < cells.length; i++) {
      var cls = i < idx ? 'past' : i === idx ? 'here' : '';
      if (cells[i].className !== cls) cells[i].className = cls;
    }

    // 일지는 열린 편수나 구역이 바뀔 때만 다시 그린다.
    var entries = C.storyLog(state);
    var key = entries.length + ':' + C.stepIndex(state);
    if (key === journalKey) return;
    journalKey = key;
    var list = $('journal');
    list.textContent = '';
    if (!entries.length) list.appendChild(el('li', '')).appendChild(el('span', 'j-empty', '아직 적힌 것이 없다.'));
    var latest = '';
    entries.forEach(function (b) {
      var li = el('li');
      li.appendChild(el('span', 'j-zone', b.zone + '구역 ' + C.ZONES[b.zone - 1].name));
      li.appendChild(el('span', '', b.text));
      list.appendChild(li);
      if (b.zone === zone.no) latest = b.text; // 지금 구역에서 가장 최근에 열린 편
    });
    latest = latest || (entries.length ? entries[entries.length - 1].text : '');
    setText($('story-latest'), latest);
    setText($('m-story'), latest);
    setText($('journal-count'), entries.length + ' / ' + C.BEATS.length);
  }

  function siteName(id) {
    for (var i = 0; i < C.EXPEDITIONS.length; i++) if (C.EXPEDITIONS[i].id === id) return C.EXPEDITIONS[i].name;
    return '';
  }

  /* ---------- 그리기 ---------- */
  function render() {
    var pps = C.productionPerSec(state);
    setText($('supplies'), fmt(state.supplies));
    setText($('pps'), '초당 +' + fmt(C.currentRate(state))
      + (state.buff ? ' · 지원 물자 ×' + state.buff.mult + ' (' + Math.ceil(state.buff.left) + '초)' : ''));
    setText($('parts'), fmt(state.parts));
    var sig = $('signal');
    sig.hidden = !(state.signalLeft > 0);
    if (!sig.hidden) setText($('signal-left'), Math.ceil(state.signalLeft) + '초');
    setText($('click-value'), '+' + fmt(C.clickValue(state)));
    setText($('day'), pad3(state.day));
    renderZone();

    // 오늘 밤: 남은 시간, 무리 규모 대 방어력
    var boss = C.isBossWave(C.currentWave(state));
    var strength = C.nightStrength(state);
    setText($('h-night'), boss ? '오늘 밤 · 변이체' : '오늘 밤');
    var defense = C.defensePower(state);
    var scale = Math.max(strength, defense, 1);
    var safe = defense >= strength;
    // 하루의 앞 50초는 '무리 도착까지', 마지막 10초는 '방어 중'. 방어 중에는 막대가 줄어들며 남은 시간을 보여 준다.
    var ph = C.dayPhase(state), fighting = ph.phase === 'battle';
    $('day-bar').style.width = Math.max(0, Math.min(100, (fighting ? ph.left / ph.total : 1 - ph.left / ph.total) * 100)).toFixed(1) + '%';
    $('night-timer-row').classList.toggle('battle', fighting);
    setText($('night-timer-label'), fighting ? (state.siege ? '농성 중 · 버티는 시간' : safe ? '방어 중 · 버티는 시간' : '방어 중 · 지금 보강해야 한다') : '무리 도착까지');
    setText($('night-timer'), clock(ph.left));
    setText($('horde-strength'), fmt(strength));
    setText($('defense-power'), fmt(defense));
    $('horde-bar').style.width = (strength / scale * 100).toFixed(1) + '%';
    $('defense-bar').style.width = (defense / scale * 100).toFixed(1) + '%';
    var pill = $('night-pill');
    var sieging = state.siege && !safe;
    setText(pill, safe ? '방어 가능' : sieging ? '농성 중' : '방벽 위험');
    pill.className = 'pill ' + (safe ? 'pill-safe' : sieging ? 'pill-siege' : 'pill-danger');
    // 다음 할 일: 첫 이주 전에는 '첫걸음 n/8' 이 순서대로 나오고, 그 뒤에는 평소의 안내가 나온다.
    guideNow = C.guide(state);
    ['', 'm-'].forEach(function (pre) {
      setText($(pre + 'goal-label'), guideNow.label);
      setText($(pre + 'goal'), guideNow.text);
      // 안내 칸 자체가 '상황' 화면에 있으므로, 갈 곳이 상황 화면이면 단추를 띄우지 않는다
      $(pre + 'goal-go').hidden = !(guideNow.tab || (guideNow.view && guideNow.view !== 'base'));
    });
    var tut = C.tutorial(state);
    tut.steps.forEach(function (st, i) {
      var li = rows.help && rows.help[i];
      if (li) li.className = st.done ? 'done' : (tut.current && tut.current.id === st.id ? 'now' : '');
    });
    setText($('help-count'), tut.done ? '첫걸음 완료' : '첫걸음 ' + tut.count + ' / ' + tut.total);
    renderJobs();
    renderEvent();
    renderCycle();
    if ($('record').getAttribute('data-rtab') === 'stats') renderStats();
    // 한 번만 사면 되는 것(연구·장비·제작) 중 지금 살 수 있는 것이 있으면 탭에 점을 찍는다
    var can = {
      research: C.RESEARCH.some(function (t) { return !state.research[t.id] && C.researchCost(state, t.id) <= state.supplies; }),
      upgrades: C.UPGRADES.some(function (u) { return !state.upgrades[u.id] && u.cost <= state.supplies; }),
      gear: C.GEAR.some(function (g) { return C.gearCost(state, g.id) <= state.parts; }),
      serums: C.SERUMS.some(function (k) { return C.serumCost(state, k.id) <= C.antibodiesFree(state); })
    };
    document.querySelectorAll('[data-tab]').forEach(function (b) { b.classList.toggle('avail', !!can[b.dataset.tab]); });
    $('mnav-manage').classList.toggle('avail', can.research || can.upgrades || can.gear || can.serums);
    // 폰 하단 메뉴: 다른 보기에 있어도 알아챌 수 있게 표시한다
    $('mnav-base').classList.toggle('alert', !safe);
    $('mnav-exped').classList.toggle('alert', !state.expedition && !state.autoExpedition);
    // 못 막는 밤이면 무엇을 몇 개 사야 하는지와 비용을 알려 주고, 한 번에 사는 버튼을 내놓는다
    var plan = C.defensePlan(state);
    var need = plan.items.map(function (it) { return it.name + ' ' + it.count + '개'; }).join(', ');
    var hordeNow = C.horde(state), surge = C.isSurgeWave(state, C.currentWave(state));
    setText($('horde-note'), '이 구역의 무리 · ' + hordeNow.name + ': ' + hordeNow.desc + '.');
    setText($('night-hint'), (boss ? '변이체가 무리를 이끈다. ' : '') + (surge ? '오늘은 떼로 몰려오는 밤이다. ' : '') + (state.mercs ? '용병 근무 중. ' : '') + (safe
      ? '막아내면 물자 ' + fmt(C.hordeReward(state)) + ', 부품 ' + C.nightParts(state) + ', 생산 +2%'
        + (boss ? ', 항체 샘플 ' + fmt(Math.max(1, Math.floor(state.antibodies * C.BOSS_ANTIBODY)) * (hordeNow.bossAntibody || 1)) + '개' : '') + '를 얻는다. 방어력 여유 +' + fmt(defense - strength) + '.'
      : '방어력이 ' + fmt(plan.short) + ' 모자라다. ' + need + '를 더 세우면 막을 수 있다. '
        + (sieging ? '농성 중이라 못 막아도 더 잃지는 않지만, 전리품·부품·생산 보너스를 받지 못한다. 한 번 막아내면 풀린다.'
                   : '뚫리면 물자의 ' + Math.round(C.breachLoss(state) * 100) + '%를 한 번 잃고 농성에 들어간다.')));
    var fb = $('fortify');
    fb.hidden = safe;
    if (!safe) {
      fb.disabled = !plan.affordable;
      setText(fb, plan.affordable ? '필요한 만큼 보강 · 물자 ' + fmt(plan.cost)
        : '보강에 물자 ' + fmt(plan.cost) + ' 필요 (' + fmt(plan.cost - state.supplies) + ' 부족)');
    }
    // 예고: 지금 방어력으로 몇 밤을 버티는지, 다음 변이체 밤은 언제 얼마나 큰지
    var fc = C.nightForecast(state, 21), holds = 0, bossAt = -1;
    while (holds < fc.length && fc[holds].strength <= defense) holds++;
    for (var fi = 0; fi < fc.length; fi++) if (fc[fi].boss) { bossAt = fi; break; }
    setText($('night-forecast'),
      (holds >= fc.length ? '지금 방어력으로 앞으로 20밤 넘게 버틴다.'
        : holds > 0 ? '지금 방어력으로 오늘 밤 포함 ' + holds + '밤을 버틴다. 그다음 밤의 규모는 ' + fmt(fc[holds].strength) + '.'
        : '오늘 밤 다음의 규모는 ' + fmt(fc[1].strength) + '.')
      + (bossAt > 0 ? ' 변이체는 ' + bossAt + '밤 뒤, 규모 ' + fmt(fc[bossAt].strength) + '.' : ''));

    setText($('stat-cleared'), fmt(state.wavesCleared));
    setText($('stat-breaches'), fmt(state.breaches));
    setText($('stat-antibodies'), fmt(state.antibodies));
    setText($('stat-mult'), '×' + C.globalMult(state).toFixed(2));
    setText($('stat-boss'), fmt(state.bossKills));
    setText($('stat-exped'), fmt(state.expeditionsDone));
    setText($('stat-quests'), fmt(state.questsDone));
    setText($('stat-medals'), fmt(state.bonus.medals));
    var capMin = Math.round(C.offlineCap(state) / 60);
    setText($('stat-offline'), (capMin % 60 ? Math.floor(capMin / 60) + '시간 ' + (capMin % 60) + '분' : capMin / 60 + '시간') + ' · ' + Math.round(C.offlineRate(state) * 100) + '%');

    // 이 지구의 과제
    var q = state.quest;
    $('quest-panel').hidden = !q;
    if (q) {
      var prog = C.questProgress(state);
      setText($('quest-text'), C.questText(state));
      $('quest-bar').style.width = (q.done ? 100 : Math.min(100, prog / q.goal * 100)).toFixed(1) + '%';
      setText($('quest-num'), q.done ? '' : fmt(Math.min(prog, q.goal)) + ' / ' + fmt(q.goal));
      setText($('quest-reward'), q.done ? '보상을 받았다' : '보상: ' + C.questRewardName(state));
      var qp = $('quest-pill');
      setText(qp, q.done ? '달성' : '진행 중');
      qp.className = 'pill ' + (q.done ? 'pill-safe' : 'pill-idle');
    }

    var zoneNow = C.zoneIndex(state); // 구역 고유 시설·방벽은 지금 구역의 것만 보인다
    C.ALL_BUILDINGS.forEach(function (b) {
      var r = rows.buildings[b.id], owned = state.buildings[b.id];
      r.btn.hidden = b.zone !== undefined && b.zone !== zoneNow;
      if (r.btn.hidden) return;
      var q = wantQty('building', b.id);
      var cost = C.buildingCost(state, b.id, q);
      var each = b.baseRate * C.milestoneMult(owned) * C.globalMult(state);
      var next = C.nextMilestone(owned);
      var full = owned >= C.BUILDING_MAX;
      setText(r.owned, String(owned));
      r.fill.style.width = (owned / C.BUILDING_MAX * 100).toFixed(1) + '%';
      setText(r.info, '곳당 +' + fmt(each) + '/초' + (next ? ' · ' + next + '곳에서 2배' : ''));
      setText(r.cost, full ? '최대 보유' : '×' + q + '  ' + fmt(cost));
      r.btn.disabled = full || cost > state.supplies;
    });
    C.ALL_DEFENSES.forEach(function (d) {
      var r = rows.defenses[d.id], owned = state.defenses[d.id];
      r.btn.hidden = d.zone !== undefined && d.zone !== zoneNow;
      if (r.btn.hidden) return;
      var q = wantQty('defense', d.id);
      var cost = C.defenseCost(state, d.id, q);
      setText(r.count, String(owned));
      var needOne = C.defenseNeeded(state, d.id);
      setText(r.info, '방어력 +' + fmt(d.power) + (needOne > 0 ? ' · 이것만으로는 ' + fmt(needOne) + '개 더 필요' : ''));
      setText(r.cost, '×' + q + '  ' + fmt(cost));
      r.btn.disabled = cost > state.supplies;
    });
    C.UPGRADES.forEach(function (u) {
      var r = rows.upgrades[u.id], owned = !!state.upgrades[u.id];
      setText(r.count, owned ? '보유' : '');
      setText(r.info, '');
      setText(r.cost, owned ? '확보 완료' : fmt(u.cost));
      r.btn.disabled = owned || u.cost > state.supplies;
      r.btn.classList.toggle('row-owned', owned);
    });

    C.RESEARCH.forEach(function (t) {
      var r = rows.research[t.id], owned = !!state.research[t.id];
      setText(r.count, owned ? '완료' : '');
      setText(r.info, '');
      var rc = C.researchCost(state, t.id); // 연구에 배치한 생존자만큼 싸다
      setText(r.cost, owned ? '연구 완료' : fmt(rc));
      r.btn.disabled = owned || rc > state.supplies;
      r.btn.classList.toggle('row-owned', owned);
    });

    C.GEAR.forEach(function (g) {
      var r = rows.gear[g.id], lv = C.gearLevel(state, g.id), cost = C.gearCost(state, g.id), maxed = lv >= g.max;
      setText(r.count, g.max > 1 ? 'Lv ' + lv : (lv ? '보유' : ''));
      var running = g.flag === 'autoFortify' ? state.auto.fortify : g.flag === 'autoBuild' ? state.auto.build : true;
      setText(r.info, g.flag ? (lv ? (running ? '작동 중' : '꺼 둠') : '') : '현재 ' + (g.per < 0 ? '' : '+') + Math.round(g.per * lv * 100) + '%');
      setText(r.cost, maxed ? (g.max > 1 ? '최대 레벨' : '제작 완료') : '부품 ' + fmt(cost));
      r.btn.disabled = maxed || cost > state.parts;
      r.btn.classList.toggle('row-owned', maxed);
    });
    // 자동화 켬/끔: 시설 탭에서는 건설 담당, 방벽 탭에서는 방벽 담당을 다룬다
    var autoKey = tab === 'buildings' ? 'build' : tab === 'defenses' ? 'fortify' : null;
    $('auto-ctl').hidden = !autoKey;
    if (autoKey) {
      var hasGear = !!state.gear[autoKey === 'build' ? 'builder' : 'warden'], box = $('auto-toggle');
      box.disabled = !hasGear;
      if (box.checked !== (hasGear && state.auto[autoKey])) box.checked = hasGear && state.auto[autoKey];
      setText($('auto-label'), autoKey === 'build'
        ? (hasGear ? '건설 담당이 시설을 알아서 짓는다' : '자동 건설: 제작에서 건설 담당(부품 24개)을 만들면 켤 수 있다')
        : (hasGear ? '방벽 담당이 방벽을 알아서 보강한다' : '자동 보강: 제작에서 방벽 담당(부품 16개)을 만들면 켤 수 있다'));
    }

    var freeAb = C.antibodiesFree(state);
    C.SERUMS.forEach(function (k) {
      var r = rows.serums[k.id], lv = C.serumLevel(state, k.id), cost = C.serumCost(state, k.id), maxed = lv >= k.max;
      setText(r.count, 'Lv ' + lv);
      setText(r.info, maxed ? '' : '최대 ' + k.max + '레벨');
      setText(r.cost, maxed ? '최대 레벨' : '항체 ' + fmt(cost));
      r.btn.disabled = maxed || cost > freeAb;
      r.btn.classList.toggle('row-owned', maxed);
    });
    if (tab === 'jobs') setText($('tab-hint'), C.survivorCount(state) ? '생존자 ' + C.survivorCount(state) + '명. 새로 온 사람은 수색에 들어간다. 구역을 넘거나 사건에서 받아들이면 늘어난다.' : '아직 함께하는 생존자가 없다. 사건에서 받아들이거나 다음 구역에 가면 합류한다.');
    if (tab === 'serums') setText($('tab-hint'), '쓸 수 있는 항체 샘플 ' + fmt(freeAb) + '개. 생산 보너스는 지금까지 모은 총량(' + fmt(state.antibodies) + '개) 기준이라 써도 줄지 않는다. 이주해도 남는다.');
    C.SHOP.forEach(function (it) {
      var r = rows.shop[it.id], cost = C.shopPrice(state, it.id), blocked = false, info = '';
      if (it.id === 'bundle') info = '부품 +' + C.bundleParts(state);
      if (it.id === 'mercs') { blocked = state.mercs; info = state.mercs ? '오늘 밤 근무 중' : ''; }
      if (it.id === 'recall') { blocked = !state.expedition; info = state.expedition ? '' : '나가 있는 원정대가 없다'; }
      setText(r.count, '');
      setText(r.info, info);
      setText(r.cost, blocked ? '' : fmt(cost));
      r.btn.disabled = blocked || cost > state.supplies;
    });

    // 원정: 진행 상황 막대 + 장소별 상태
    if ($('auto-exped').checked !== state.autoExpedition) $('auto-exped').checked = state.autoExpedition;
    var ex = state.expedition;
    setText($('exped-status'), ex ? siteName(ex.id) + ' 수색 중' : '원정대 대기 중');
    setText($('exped-timer'), ex ? clock(ex.left) : '');
    $('exped-cancel').hidden = !ex;
    $('exped-bar').style.width = (ex ? Math.min(100, (1 - ex.left / ex.total) * 100) : 0).toFixed(1) + '%';
    C.EXPEDITIONS.forEach(function (x) {
      var r = rows.expeditions[x.id];
      var open = C.expeditionUnlocked(state, x.id);
      var hasRelic = C.RELICS.some(function (rl) { return rl.site === x.id && state.relics[rl.id]; });
      setText(r.count, !open ? '잠김' : clock(C.expeditionDuration(state, x.id)));
      setText(r.info, open
        ? '예상 보상 ' + fmt(C.expeditionReward(state, x.id)) + ' · 부품 ' + C.expeditionParts(state, x.id)
        : '밤 ' + x.needWave + '회 방어 기록 필요 (최고 ' + state.bestWave + '회)');
      setText(r.cost, hasRelic ? '유물 확보' : '유물 확률 ' + Math.round(x.relicChance * 100) + '%');
      r.btn.disabled = !open || !!ex;
    });

    var relicN = 0;
    C.RELICS.forEach(function (rl) {
      var r = rows.relics[rl.id], owned = !!state.relics[rl.id];
      if (owned) relicN++;
      setText(r.name, owned ? rl.name : '미확인 유물');
      setText(r.desc, owned ? rl.desc : siteName(rl.site) + ' 원정에서 발견될 수 있다');
      r.box.classList.toggle('info-on', owned);
    });
    setText($('relic-count'), relicN + ' / ' + C.RELICS.length);

    C.PERKS.forEach(function (k) {
      var r = rows.perks[k.id], lv = C.perkLevel(state, k.id), tag = lv ? 'Lv ' + lv + (lv >= k.max ? ' (최대)' : '') : '';
      r.box.classList.toggle('perk-on', lv > 0);
      if (r.name.getAttribute('data-lv') !== tag) r.name.setAttribute('data-lv', tag);
    });
    setText($('perk-count'), '레벨 합계 ' + C.totalPerks(state));
    renderPerkChoice();

    var achN = C.achievementCount(state);
    C.ACHIEVEMENTS.forEach(function (a) {
      rows.achievements[a.id].classList.toggle('ach-on', !!state.achievements[a.id]);
    });
    setText($('ach-count'), achN + ' / ' + C.ACHIEVEMENTS.length + ' · 생산 +' + Math.round(achN * C.ACH_BONUS * 100) + '%');

    // 이주: 버튼이 '확인 대기' 상태일 때는 문구를 덮어쓰지 않는다.
    var gain = C.antibodiesOnRelocate(state);
    var rb = $('relocate');
    var stop = C.nextStop(state), need = C.relocateRequirement(state), ready = C.canRelocate(state);
    var newZone = stop.zone.no !== C.currentZone(state).no; // 다음 이주가 구역 경계를 넘는가
    rb.disabled = !ready;
    if (!rb.dataset.armed) setText(rb, !ready ? '아직 떠날 수 없다'
      : (stop.atEnd ? '7-Z 재건' : stop.label + ' 지구로 이주') + ' · 항체 샘플 +' + fmt(gain) + ' · 특전 1장');
    setText($('relocate-hint'), !ready
      ? '이 지구에서 모은 물자 ' + fmt(state.totalEarned) + ' / ' + fmt(need) + '. 채우면 ' + (stop.atEnd ? '거점을 다시 세울 수 있다.' : stop.label + ' 지구로 떠날 수 있다.')
      : (stop.atEnd ? '7-Z 를 처음부터 다시 세운다. ' : newZone ? '새 구역 ' + stop.zone.no + '구역 ' + stop.zone.name + '. 특성: ' + stop.zone.trait + '. ' : '')
        + (newZone && !stop.atEnd ? '구역을 넘는 이주라 특전이 3레벨 오른다. ' : '')
        + '시설·방벽·연구는 두고 가고, 유물·제작 장비·특전·업적·일지는 남는다. 항체 샘플 1개마다 생산이 영구히 10% 는다.');
  }

  /** 도트 화면이 매 프레임 읽어 가는 현재 상황. 규칙 계산은 전부 GameCore 에 맡긴다. */
  function sceneView() {
    var ex = state.expedition;
    return {
      t: state.dayClock / C.DAY_SECONDS,
      battle: C.dayPhase(state).phase === 'battle',
      day: state.day,
      buildings: state.buildings,
      expedition: ex ? { elapsed: ex.total - ex.left, left: ex.left } : null,
      zone: C.zoneIndex(state),
      horde: C.horde(state).id,
      research: state.research,
      upgrades: state.upgrades,
      gear: state.gear,
      surge: C.isSurgeWave(state, C.currentWave(state)),
      zoneBuilding: state.buildings[C.zoneBuilding(state).id],
      zoneDefense: state.defenses[C.zoneDefense(state).id],
      safe: C.defensePower(state) >= C.nightStrength(state),
      boss: C.isBossWave(C.currentWave(state)),
      signal: state.signalLeft > 0,
      buff: !!state.buff,
      def: state.defenses
    };
  }

  /* ---------- 시간 진행 ---------- */
  function logExpedition(ev) {
    log(ev.site + ' 원정대 귀환. 물자 ' + fmt(ev.reward) + ', 부품 ' + ev.parts + ' 확보.', 'good');
    if (ev.relic) { log('원정대가 유물을 가져왔다: ' + ev.relic + '.', 'good'); toast('유물 발견 · ' + ev.relic); }
  }
  /**
   * 도움말 탭을 채운다. 첫걸음 목록은 줄만 만들어 두고, 했는지 표시는 render 가 매번 맞춘다.
   * 도움말은 부가 요소라, 모듈이 빠졌거나 글을 만들다 오류가 나도 게임은 그대로 진행한다.
   */
  function buildHelp() {
    rows.help = [];
    C.tutorial(state).steps.forEach(function (st) {
      var li = el('li', '', st.text);
      rows.help.push(li);
      $('help-steps').appendChild(li);
    });
    setText($('signal-gain'), '물자 ' + C.SIGNAL_SUPPLY_SECONDS + '초치 또는 ' + C.BUFF_SECONDS + '초간 생산 ' + C.BUFF_MULT + '배');
    var list = [];
    try { if (window.Help) list = window.Help.sections(C); }
    catch (e) { console.warn('help', e); list = []; }
    if (!list.length) { $('help').appendChild(el('p', 'hint', '도움말을 불러오지 못했다.')); return; }
    list.forEach(function (sec) {
      var box = el('div', 'note');
      box.appendChild(el('div', 'note-ver help-title', sec.title));
      var ul = el('ul');
      sec.items.forEach(function (text) { ul.appendChild(el('li', '', text)); });
      box.appendChild(ul);
      $('help').appendChild(box);
    });
  }
  /* ---------- 생존자 배치 탭 ---------- */
  /** 일마다 한 줄: 이름과 효과, 인원, 빼기·더하기 단추. 값은 renderJobs 가 채운다. */
  function buildJobs() {
    C.JOBS.forEach(function (j) {
      var row = el('div', 'job'), name = el('div', 'job-name', j.name), eff = el('span', '', '');
      name.appendChild(eff);
      var ctl = el('div', 'job-ctl'), minus = el('button', '', '−'), n = el('b', '', '0'), plus = el('button', '', '+');
      minus.type = plus.type = 'button';
      minus.setAttribute('aria-label', j.name + '에서 한 명 빼기');
      plus.setAttribute('aria-label', j.name + '에 한 명 더하기');
      // 빼면 수색으로 돌아간다(수색에서 빼면 방어로). 더하면 다른 일 중 사람이 가장 많은 곳에서 데려온다.
      minus.addEventListener('click', function () { moveJob(j.id, j.id === 'scavenge' ? 'guard' : 'scavenge'); });
      plus.addEventListener('click', function () { var from = busiestOther(j.id); if (from) moveJob(from, j.id); });
      ctl.appendChild(minus); ctl.appendChild(n); ctl.appendChild(plus);
      row.appendChild(name); row.appendChild(ctl); row.appendChild(el('div', 'job-desc', j.desc));
      rows.jobs[j.id] = { n: n, eff: eff, minus: minus, plus: plus };
      $('jobs').appendChild(row);
    });
  }
  /** id 가 아닌 일 중에서 사람이 가장 많은 일(아무도 없으면 null). */
  function busiestOther(id) {
    var best = null;
    C.JOBS.forEach(function (j) { if (j.id !== id && state.jobs[j.id] > 0 && (!best || state.jobs[j.id] > state.jobs[best])) best = j.id; });
    return best;
  }
  function moveJob(from, to) {
    var r = C.moveSurvivor(state, from, to);
    if (!r.ok) return;
    sfx('click');
    Store.save();
    render();
  }
  function renderJobs() {
    var pct = Math.round(C.JOB_STEP * 100);
    C.JOBS.forEach(function (j) {
      var r = rows.jobs[j.id], n = state.jobs[j.id] || 0;
      setText(r.n, String(n));
      setText(r.eff, n ? (j.id === 'study' ? '연구 값 -' + Math.min(60, n * pct) + '%' : (j.id === 'guard' ? '방어력' : '생산') + ' +' + n * pct + '%') : '');
      r.minus.disabled = n < 1;
      r.plus.disabled = !busiestOther(j.id);
    });
  }

  /* ---------- 사건 ---------- */
  var eventShown = '';      // 선택 창에 지금 그려 둔 사건(같은 사건을 매 프레임 다시 그리지 않는다)
  var eventOpen = false;    // 플레이어가 선택 창을 열어 두었는가
  /** 사건 단추와 선택 창을 지금 상태에 맞춘다. 창은 플레이어가 단추를 눌렀을 때만 뜬다(하던 일을 가로막지 않는다). */
  function renderEvent() {
    var v = C.eventView(state);
    $('event-open').hidden = !v;
    if (!v) { eventOpen = false; eventShown = ''; $('event').hidden = true; return; }
    var left = Math.max(0, Math.ceil(v.left)) + '초';
    setText($('event-open-title'), '사건 · ' + v.title);
    setText($('event-open-left'), left);
    $('event').hidden = !eventOpen;
    if (!eventOpen) return;
    setText($('event-left'), left + ' 뒤 알아서 넘어간다');
    // 선택지의 설명과 고를 수 있는지는 물자에 따라 달라지므로 그 값까지 넣어 비교한다
    var key = v.id + '|' + v.choices.map(function (c) { return c.desc + c.can; }).join('|');
    if (key === eventShown) return;
    eventShown = key;
    setText($('event-title'), v.title);
    setText($('event-text'), v.text);
    var box = $('event-list');
    box.textContent = '';
    v.choices.forEach(function (ch, i) {
      var btn = el('button', 'sync-pick');
      btn.type = 'button';
      btn.disabled = !ch.can;
      var name = el('b', '', ch.label);
      if (i === v.def) name.appendChild(el('span', 'pick-default', '그냥 두면 이쪽'));
      btn.appendChild(name);
      btn.appendChild(el('span', '', ch.desc));
      btn.addEventListener('click', function () {
        var r = C.chooseEvent(state, i, Math.random);
        if (!r.ok) return;
        logEvent(r, false);
        Store.save();
        render();
      });
      box.appendChild(btn);
    });
  }
  function logEvent(r, auto) {
    log('사건 · ' + r.title + ': ' + (auto ? '지켜보다가 "' : '"') + r.label + (auto ? '" 쪽으로 넘어갔다. ' : '" 를 골랐다. ') + r.text, 'good');
  }

  /* ---------- 통계 탭 ---------- */
  // [id, 이름] 순서대로 칸을 만든다. 값은 renderStats 가 채운다.
  var STAT_CELLS = [
    ['total', '진행 시간'], ['play', '켜 둔 시간'], ['away', '자리 비움으로 받은 시간'],
    ['days', '시작한 지'], ['sector', '이 지구에서'], ['average', '지구 평균(최근)'],
    ['fastest', '가장 빨랐던 지구'], ['remaining', '7-Z 까지 남은 이주'], ['eta', '이 속도면 7-Z 까지'],
    ['relocations', '이주'], ['lifetime', '모은 물자(전체)'], ['clicks', '직접 수색'],
    ['bestWave', '한 거점 최다 방어'], ['signals', '신호 응답'], ['quests', '과제 달성']
  ];
  function buildStats() {
    rows.stats = {};
    STAT_CELLS.forEach(function (c) {
      var box = el('div');
      box.appendChild(el('dt', '', c[1]));
      rows.stats[c[0]] = el('dd', 'stat-small', '-');
      box.appendChild(rows.stats[c[0]]);
      $('stats-grid').appendChild(box);
    });
    rows.statZones = C.ZONES.map(function (z) {
      var li = el('li');
      li.appendChild(el('span', '', z.no + '구역 ' + z.name));
      var v = el('span', 'num', '-');
      li.appendChild(v);
      $('stats-zones').appendChild(li);
      return v;
    });
  }
  /** 통계 탭의 값을 채운다. 탭이 열려 있을 때만 부른다(매 프레임 15칸을 고칠 이유가 없다). */
  function renderStats() {
    var st = C.stats(state, Date.now()), d = C.formatDuration, cell = rows.stats;
    setText(cell.total, d(st.total));
    setText(cell.play, d(st.play));
    setText(cell.away, d(st.away));
    setText(cell.days, st.days === null ? '기록 없음' : st.days + '일째');
    setText(cell.sector, d(st.sector));
    setText(cell.average, st.average === null ? '이주 뒤에 표시' : d(st.average));
    setText(cell.fastest, st.fastest ? st.fastest.label + ' · ' + d(st.fastest.seconds) : '-');
    setText(cell.remaining, st.remaining + '번');
    setText(cell.eta, st.remaining === 0 ? '도착' : st.eta === null ? '이주 뒤에 표시' : d(st.eta));
    setText(cell.relocations, fmt(st.relocations) + '번');
    setText(cell.lifetime, fmt(st.lifetimeEarned));
    setText(cell.clicks, fmt(st.clicks) + '번');
    setText(cell.bestWave, fmt(st.bestWave) + '밤');
    setText(cell.signals, fmt(st.signals) + '번');
    setText(cell.quests, fmt(st.quests) + '개');
    st.zones.forEach(function (z, i) {
      setText(rows.statZones[i], z.sectors ? d(z.seconds) + ' · ' + z.sectors + '지구' + (z.sectors ? ' (지구당 ' + d(z.seconds / z.sectors) + ')' : '') : '아직');
    });
    // 최근 지구: 줄 수가 달라질 때만 다시 만든다
    var list = $('stats-recent'), sig = st.recent.map(function (r) { return r.label + r.seconds; }).join('|');
    if (list.getAttribute('data-sig') !== sig) {
      list.setAttribute('data-sig', sig);
      list.textContent = '';
      if (!st.recent.length) list.appendChild(el('li', 'hint', '첫 이주를 하면 지구마다 걸린 시간이 여기에 쌓인다.'));
      st.recent.forEach(function (r) {
        var li = el('li');
        li.appendChild(el('span', '', r.label));
        li.appendChild(el('span', 'num', d(r.seconds)));
        list.appendChild(li);
      });
    }
  }
  /** 회차 단추: 7-Z 에서 마지막 일지를 연 뒤에만 보인다. */
  function renderCycle() {
    var can = C.canStartCycle(state), btn = $('cycle');
    btn.hidden = !can;
    $('cycle-hint').hidden = !can;
    if (!can) return;
    if (!btn.dataset.armed) setText(btn, (state.cycle + 2) + '회차 시작 · 1-A 로 돌아간다');
    setText($('cycle-hint'), '항체 샘플은 0개에서 다시 모은다. 혈청, 특전, 제작한 것, 유물, 업적, 생존자는 남는다. '
      + '회차마다 생산 +' + Math.round(C.CYCLE_BONUS * 100) + '%, 생존자 +' + (C.ZONES.length - 1) + '명. 대신 무리 규모 +' + Math.round(C.CYCLE_THREAT * 100) + '%, 이주 요구 물자 ' + C.CYCLE_REQUIRE + '배.');
  }
  /** '바로 가기': 안내가 가리키는 화면을 연다. 폰에서는 하단 메뉴의 보기를, 관리에서는 탭을 바꾼다. */
  function goTo(view, tab) {
    var v = view ? document.querySelector('[data-mview-set="' + view + '"]') : null;
    if (v) v.click();
    var t = tab ? document.querySelector('[data-tab="' + tab + '"]') : null;
    if (t) t.click();
    // 넓은 화면에서는 모든 칸이 한 페이지에 있어 보기를 바꿀 일이 없다. 대신 그 칸이 보이는 곳으로 끌어온다
    // (폰은 한 화면이라 움직이지 않는다).
    var target = t || (view ? document.querySelector('[data-view="' + view + '"]') : null);
    try { if (target) target.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* 오래된 브라우저: 탭만 바뀐다 */ }
  }
  function logSignal(r, prefix) {
    if (r.kind === 'supplies') log(prefix + '고립된 보급 트럭이었다. 물자 ' + fmt(r.gain) + ' 확보.', 'good');
    else log(prefix + '공중 지원 물자가 투하됐다. ' + r.seconds + '초 동안 생산 ' + r.mult + '배.', 'good');
  }
  function handleEvents(events) {
    events.forEach(function (ev) {
      switch (ev.type) {
        case 'defended':
          log('밤 ' + ev.wave + ' 방어 성공. 규모 ' + fmt(ev.strength) + ' 의 무리를 막고 물자 ' + fmt(ev.reward) + ', 부품 ' + ev.parts + ' 확보.', 'good');
          if (scene) scene.night(true);
          sfx('defended');
          heldLogged = false;
          if (ev.boss) {
            log('변이체를 쓰러뜨렸다. 표본에서 항체 샘플 ' + fmt(ev.antibodies) + '개를 얻었다.', 'good');
            toast('변이체 처치 · 항체 샘플 +' + fmt(ev.antibodies));
          }
          break;
        case 'breached':
          log((ev.boss ? '변이체가 방벽을 부쉈다. ' : '방벽이 뚫렸다. ') + '규모 ' + fmt(ev.strength) + ' 의 무리에게 물자 ' + fmt(ev.lost) + ' 을 잃었다. 농성에 들어간다.', 'bad');
          heldLogged = false;
          flash();
          if (scene) scene.night(false);
          sfx('breached');
          break;
        case 'held':
          // 농성 중 버틴 밤: 잃은 것이 없으므로 조용히 넘긴다. 로그는 농성마다 한 번만 남긴다.
          if (scene) scene.night('held');
          if (!heldLogged) { log('문을 걸어 잠그고 밤을 버텼다. 잃은 것은 없지만 얻은 것도 없다. 방벽을 보강해야 한다.'); heldLogged = true; }
          break;
        case 'expedition': logExpedition(ev); sfx('expedition'); break;
        case 'event': log('사건이 생겼다: ' + ev.title + '. ' + C.EVENT_WINDOW + '초 안에 고르지 않으면 알아서 넘어간다.'); sfx('signal'); break;
        case 'event-auto': logEvent(ev, true); break;
        case 'arrive':
          // 무리 도착: 못 막는 상태일 때만 경보와 안내(막을 수 있는 밤마다 알리면 일지가 같은 말로 찬다)
          if (!ev.siege && ev.defense < ev.strength) {
            log('무리가 도착했다. ' + C.BATTLE_SECONDS + '초 안에 방벽을 보강하지 않으면 뚫린다.');
            sfx('dusk');
          }
          break;
        case 'signal': log('무전기에 구조 신호가 잡혔다. ' + C.SIGNAL_WINDOW + '초 안에 응답하면 물자나 생산 ' + C.BUFF_MULT + '배를 얻는다.'); sfx('signal'); break;
        case 'signal-lost': log('구조 신호가 끊겼다.'); break;
        case 'signal-auto': if (ev.result && ev.result.ok) logSignal(ev.result, '무전병이 구조 신호에 응답했다. '); break;
        case 'fortified': log('방벽 담당이 방벽 ' + ev.count + '곳을 보강했다.'); break;
        case 'built': break; // 자동 건설은 몇 초마다 일어나므로 로그를 남기지 않는다(시설 칸의 숫자로 보인다)
        case 'quest':
          log('과제 달성: ' + ev.text + '. 보상: ' + ev.reward + '.', 'good');
          toast('과제 달성 · ' + ev.reward);
          sfx('defended');
          break;
        case 'story':
          log('일지에 새 기록을 남겼다. ' + ev.text, 'story');
          Story.push(ev.zone + '구역 ' + ev.zoneName + ' · 생존 일지', ev.text);
          break;
        case 'achievement': log('업적 달성: ' + ev.name + '. 생산 +2%.', 'good'); toast('업적 달성 · ' + ev.name); break;
        default: break; // 모르는 이벤트는 무시한다(새 규칙이 추가돼도 화면이 깨지지 않게)
      }
    });
  }
  function flash() {
    var p = $('night');
    p.classList.remove('shake');
    void p.offsetWidth; // 애니메이션을 다시 시작시키기 위한 리플로
    p.classList.add('shake');
  }
  /** 자리를 비운 동안 벌어진 일을 한 번에 알린다. 원정이 여러 번이면 합쳐서 한 줄로 적는다. */
  function reportAway(r) {
    var ex = r.expeditions || [];
    if (ex.length > 3) {
      var sum = 0, parts = 0, relics = [];
      ex.forEach(function (e) { sum += e.reward; parts += e.parts; if (e.relic) relics.push(e.relic); });
      log('자리를 비운 동안 원정대가 ' + ex.length + '번 다녀왔다. 물자 ' + fmt(sum) + ', 부품 ' + fmt(parts) + ' 확보.', 'good');
      relics.forEach(function (name) { log('원정대가 유물을 가져왔다: ' + name + '.', 'good'); });
    } else ex.forEach(logExpedition);
    if (r.nights > 0) {
      log('자리를 비운 동안 밤 ' + r.nights + '번을 막아냈다. 물자 ' + fmt(r.nightReward) + ', 부품 ' + fmt(r.parts)
        + (r.antibodies ? ', 항체 샘플 ' + fmt(r.antibodies) : '') + ' 확보.', 'good');
    }
    if (r.held) log('막을 수 없는 무리가 와서 문을 걸어 잠그고 버텼다. 방벽을 보강해야 한다.', 'bad');
    if (r.event) logEvent(r.event, true);
    if (r.elapsed < AWAY_THRESHOLD || (r.gain <= 0 && !r.nights)) return;
    notice((r.capped ? '오래 자리를 비웠다. 최대치인 ' + duration(r.counted) + '치만 계산해' : '자리를 비운 ' + duration(r.elapsed) + ' 동안')
      + ' 대원들이 물자 ' + fmt(r.gain) + ' 을 모았다'
      + (r.nights ? ', 밤 ' + r.nights + '번을 막아냈다' : '') + '.'
      + (r.held ? ' 지금 방어력으로는 다음 밤을 못 막는다.' : '')
      + ' 경계 근무 중이라 생산 효율은 ' + Math.round(C.offlineRate(state) * 100) + '%.');
  }

  function frame() {
    var now = Date.now();
    var dt = (now - lastFrame) / 1000;
    lastFrame = now;
    if (!document.hidden && now - Cloud.lastCycle >= CLOUD_EVERY_MS) Cloud.check(); // 1분마다 서버와 맞춘다
    if (!document.hidden && now - Update.lastCheck >= UPDATE_EVERY_MS) Update.check(); // 30분마다 새 버전 확인(설치형만)
    if (paused) return;    // 다른 기기가 진행 중: 이 기기의 시간은 흐르지 않는다
    if (!(dt > 0)) return; // 시스템 시계가 뒤로 간 경우
    if (dt > AWAY_THRESHOLD) reportAway(C.applyOffline(state, dt)); // 탭이 잠들었다 깨어남
    else handleEvents(C.tick(state, dt));

    if (now >= nextFlavor) {
      if (nextFlavor) log(FLAVOR[Math.floor(Math.random() * FLAVOR.length)]);
      nextFlavor = now + 25000 + Math.random() * 20000;
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

  function saveMsg(text, bad) {
    var m = $('save-msg');
    m.textContent = text;
    m.className = 'save-msg' + (bad ? ' save-bad' : '');
  }

  function wire() {
    $('scavenge').addEventListener('click', function () {
      popNumber('+' + fmt(C.scavenge(state)));
      sfx('click');
      if (scene) scene.poke();
      render();
    });

    ['goal-go', 'm-goal-go'].forEach(function (id) {
      $(id).addEventListener('click', function () { if (guideNow) goTo(guideNow.view, guideNow.tab); });
    });

    $('signal').addEventListener('click', function () {
      var r = C.answerSignal(state);
      if (!r.ok) return; // 누르는 순간 신호가 끊긴 경우
      logSignal(r, '신호에 응답했다. ');
      render();
    });

    document.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () {
        tab = b.dataset.tab;
        document.querySelectorAll('[data-tab]').forEach(function (o) {
          o.setAttribute('aria-pressed', String(o === b));
          $(o.dataset.tab).hidden = o !== b;
        });
        // 수량 선택은 여러 개 살 수 있는 시설·방벽 탭에서만 의미가 있다.
        $('qty').hidden = !(tab === 'buildings' || tab === 'defenses');
        setText($('tab-hint'), TAB_HINTS[tab] || '');
        render(); // 탭에 딸린 표시(자동화 체크, 혈청 안내)를 다음 갱신까지 기다리지 않고 바로 맞춘다
      });
    });
    setText($('tab-hint'), TAB_HINTS[tab]);

    document.querySelectorAll('[data-qty]').forEach(function (b) {
      b.addEventListener('click', function () {
        qtyMode = b.dataset.qty === 'max' ? 'max' : Number(b.dataset.qty);
        document.querySelectorAll('[data-qty]').forEach(function (o) {
          o.setAttribute('aria-pressed', String(o === b));
        });
        render();
      });
    });

    $('notice-close').addEventListener('click', function () { $('notice').hidden = true; });

    // 필요한 만큼 보강: 안내한 방벽을 한 번에 산다
    $('fortify').addEventListener('click', function () {
      var plan = C.defensePlan(state), r = C.fortify(state);
      if (!r.ok) return; // 그사이 물자가 모자라졌거나 이미 충분해진 경우
      log('방벽을 보강했다: ' + plan.items.map(function (it) { return it.name + ' ' + it.count + '개'; }).join(', ') + '. 물자 ' + fmt(r.cost) + ' 사용.', 'good');
      sfx('buy');
      render();
    });

    // 일지 연출: 화면 아무 곳이나 누르거나 Enter·Esc 로 넘긴다
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
    // 구매음: 살 수 없는 행은 비활성이라 클릭이 오지 않는다. 눌렸다면 거래가 된 것이다
    ['buildings', 'defenses', 'research', 'upgrades', 'gear', 'serums', 'shop'].forEach(function (id) {
      $(id).addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.row')) sfx('buy'); });
    });

    // 기록 탭: 일지·유물·특전·업적·패치노트·저장 중 하나를 고른다
    document.querySelectorAll('[data-rtab-set]').forEach(function (b) {
      b.addEventListener('click', function () {
        $('record').setAttribute('data-rtab', b.dataset.rtabSet);
        if (b.dataset.rtabSet === 'stats') renderStats(); // 다음 갱신을 기다리지 않고 바로 채운다
        document.querySelectorAll('[data-rtab-set]').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
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

    $('event-open').addEventListener('click', function () { eventOpen = true; eventShown = ''; render(); });
    $('event-later').addEventListener('click', function () { eventOpen = false; render(); });

    twoStep($('cycle'), '한 번 더 누르면 1-A 에서 다시 시작한다', function () {
      var r = C.startCycle(state, Date.now(), Math.random);
      if (!r.ok) return;
      state = r.state;
      Store.save();
      log((r.cycle + 1) + '회차를 시작했다. 다시 1-A 다. 무리는 더 크고, 우리도 더 많다.', 'good');
      sfx('relocate');
      Cloud.flush();
      render();
    });

    twoStep($('relocate'), '한 번 더 누르면 이 구역을 떠난다', function () {
      var r = C.relocate(state, Date.now(), Math.random);
      if (!r.ok) return;
      state = r.state;
      Store.save();
      log('거점을 버리고 떠났다. 항체 샘플 ' + fmt(r.gained) + '개를 챙겼다.', 'good');
      log(r.label + ' 지구에 도착했다. ' + r.zone.name + ', ' + r.zone.trait + '.');
      sfx('relocate');
      Cloud.flush();
      render();
    });

    $('save-now').addEventListener('click', function () {
      saveMsg(Store.save() ? '이 브라우저에 저장했습니다.' : '저장하지 못했습니다. 저장 코드를 복사해 두세요.', false);
    });

    // 저장 코드: 브라우저 저장이 사라져도 옮겨 갈 수 있는 백업 수단.
    $('export').addEventListener('click', function () {
      var code;
      try { code = btoa(C.serialize(state)); }
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
        try { json = atob(text); } catch (e) { throw new Error('저장 코드 형식이 아닙니다. 처음부터 끝까지 복사했는지 확인하세요.'); }
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
      if (document.hidden) { if (!paused) Store.save(); Cloud.flush(); } // 진행 중인 기기면 최신 진행을 바로 올려 둔다
      else { Cloud.check(); Update.check(); } // 돌아왔을 때 다른 기기가 가져갔는지, 새 버전이 나왔는지 확인한다
    });
    // 강제 귀환: 보상을 못 받는다는 것을 먼저 알리고, 확인했을 때만 불러들인다
    $('exped-cancel').addEventListener('click', function () {
      if (!state.expedition) return;
      var name = siteName(state.expedition.id);
      confirmBox('원정대 강제 귀환',
        name + ' 원정대를 지금 불러들이면 물자·부품·유물을 하나도 받지 못한다. 지금까지 걸어간 시간도 사라진다. 보상을 받고 바로 불러들이려면 관리 > 상점의 긴급 귀환을 쓴다.',
        '계속 보낸다', '빈손으로 불러들인다', function () {
          var r = C.cancelExpedition(state);
          if (!r.ok) return; // 확인하는 사이 원정대가 돌아온 경우
          log(r.site + ' 원정대를 강제로 불러들였다. 가져온 것은 없다.', 'bad');
          render();
        });
    });
    $('auto-toggle').addEventListener('change', function () {
      var key = tab === 'buildings' ? 'build' : tab === 'defenses' ? 'fortify' : null;
      if (!key) return;
      var on = C.setAuto(state, key, $('auto-toggle').checked).on;
      log((key === 'build' ? '건설 담당' : '방벽 담당') + (on ? '에게 다시 일을 맡겼다.' : '을 쉬게 했다. 이제 직접 챙겨야 한다.'));
      render();
    });
    $('auto-exped').addEventListener('change', function () {
      C.setAutoExpedition(state, $('auto-exped').checked);
    });
    window.addEventListener('pagehide', function () { if (!paused) Store.save(); Cloud.flush(); });
    $('standby-take').addEventListener('click', function () { Cloud.take(); });
    $('update-now').addEventListener('click', function () { Update.apply(); });
    $('update-later').addEventListener('click', function () { Update.offered = $('update-bar').dataset.version || ''; $('update-bar').hidden = true; });
  }

  /* ---------- 시작 ---------- */
  /**
   * snapshot: 페이지가 새 버전으로 교체될 때 뷰어가 넘겨주는 직전 상태(없으면 {}).
   * 스냅샷 → 브라우저 저장 → 새 게임 순으로 시도한다.
   */
  function start(snapshot) {
    var now = Date.now();
    var loaded = { state: null, error: null };
    if (snapshot && snapshot.version === C.SAVE_VERSION) state = C.sanitizeState(snapshot, now);
    else {
      loaded = Store.load();
      state = loaded.state || C.createState(now);
    }

    buildLists();
    buildRoute();
    wire();

    if (loaded.error) notice(loaded.error);
    if (loaded.state) {
      log('무전기를 다시 켰다. 거점은 무사하다.');
      reportAway(C.applyOffline(state, (now - state.lastSeen) / 1000));
    } else if (!snapshot || !snapshot.version) {
      log('방벽을 손봐야 한다. 철조망 하나면 첫 밤은 넘길 수 있다.');
      log('잔해를 뒤져 물자를 모으고, 수색조를 꾸려라.');
      if (!loaded.error) notice('처음이라면 "첫걸음"에 나오는 일을 차례로 하면 된다. 자세한 설명은 기록 > 도움말에 있다.');
    }

    lastFrame = now; lastSave = now;
    render();
    // 도트 화면은 부가 요소다. 모듈이 없거나 캔버스를 못 써도 게임은 그대로 진행한다.
    try { if (window.Scene) scene = window.Scene.mount($('scene'), sceneView); }
    catch (e) { console.warn('scene', e); scene = null; }
    setInterval(safeFrame, 100);
    Cloud.init();
    Update.afterUpdate();
    Update.check();
  }

  // 뷰어가 페이지를 교체할 때 진행 상황을 넘겨받을 수 있도록 현재 상태를 제공한다.
  var hot = window.claude && window.claude.hot;
  try { if (hot && hot.snapshot) hot.snapshot(function () { return state; }); } catch (e) { /* 뷰어 밖에서는 없다 */ }
  if (hot && hot.ready) hot.ready(start);
  else start((hot && hot.data) || {});
})();
