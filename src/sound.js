/*
 * Sound — 효과음
 * ------------------------------------------------------------
 * 음원 파일 없이 Web Audio 로 짧은 소리를 합성한다(파일 하나짜리 게임을 유지하기 위함).
 * 소리 하나는 음표 목록이다. { f: 주파수(Hz), to: 끝 주파수(있으면 그쪽으로 미끄러진다), d: 길이(초), at: 시작 시점(초), type: 파형, g: 음량 }
 * noise: true 인 항목은 주파수 대신 백색 소음을 cut(Hz) 아래로 걸러 낸다(둔탁한 충격음용).
 *
 * 브라우저는 사용자가 한 번 누르기 전에는 소리를 내지 못하게 막는다. 그래서 첫 입력 때
 * unlock() 으로 오디오를 깨우고, 그 전의 play() 는 조용히 무시한다.
 * 오디오를 쓸 수 없는 환경(Node, 구형 브라우저)에서도 play() 는 오류 없이 false 를 돌려준다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sound = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_GAIN = 0.95;  // 어떤 소리도 이보다 크게 내지 않는다(음량 100 에서도)
  // 2.5.2: 기본 음량(50)에서 지금의 두 배가 돼야 한다는 말에 따라 한 번 더 두 배로(5.2 → 10.4). 음 하나의 크기는 여전히 MAX_GAIN 에서 잘린다
  var VOLUME = 10.4;    /* 0.9.23: 음량 100 에서도 작다는 의견에 따라 두 배로 키웠다. 겹쳐서 터지지 않게 끝에 누름막(compressor)을 둔다 */ var VOLUME_OLD = 2.6;    // 전체 음량 배수(0.8.6: 소리가 작다는 의견에 따라 전체를 키웠다). 소리마다의 g 에 곱한다

  /*
   * 0.8.5: 소리를 부드럽게 다듬었다. 날카롭게 들리던 네모파·톱니파를 빼고 사인파·세모파만 쓴다.
   *   높은 음(1200Hz 이상)은 한 옥타브쯤 내렸고, 모든 소리는 SOFT_CUT 아래만 남기는 거름막을 거친다.
   */
  var SOFT_CUT = 2400;   // 이 주파수(Hz) 위의 소리는 걸러 낸다(쇳소리 제거)
  var ATTACK = 0.02;     // 소리가 올라오는 시간(초). 짧을수록 딱딱하게 들린다
  var SOUNDS = {
    // 누르는 소리: 음이 위로 미끄러져 올라가는 '뽁' 소리(to 는 끝날 때의 주파수)
    click:      [{ f: 520, to: 840, d: 0.09, type: 'sine', g: 0.05 }],
    buy:        [{ f: 523, d: 0.07, type: 'sine', g: 0.045 }, { f: 659, d: 0.1, at: 0.06, type: 'sine', g: 0.045 }],
    // 0.9.24: 사는 것마다 소리가 다르다. 전에는 무엇을 사든 buy 하나였다. 음색(사인·세모·잡음)과 음높이를 달리해서 귀로 구별되게 했다
    stall:      [{ noise: true, cut: 400, d: 0.05, g: 0.06 }, { f: 392, d: 0.09, at: 0.02, type: 'triangle', g: 0.05 }],                                 // 좌판: 나무 두드리는 소리
    hand:       [{ f: 330, d: 0.05, type: 'triangle', g: 0.05 }, { f: 330, d: 0.06, at: 0.09, type: 'triangle', g: 0.05 }],                              // 일손: 낮게 똑똑
    machine:    [{ f: 180, to: 120, d: 0.12, type: 'triangle', g: 0.06 }, { noise: true, cut: 400, d: 0.05, at: 0.06, g: 0.07 }],                       // 기계: 철컥
    train:      [{ f: 311, d: 0.3, type: 'triangle', g: 0.04 }, { f: 370, d: 0.3, type: 'triangle', g: 0.04 }],                                          // 열차: 두 음이 겹친 경적
    route:      [{ noise: true, cut: 380, d: 0.04, g: 0.08 }, { noise: true, cut: 380, d: 0.04, at: 0.1, g: 0.08 }, { f: 196, d: 0.14, at: 0.1, type: 'triangle', g: 0.04 }],   // 노선: 덜컹덜컹
    staff:      [{ f: 784, to: 1047, d: 0.06, type: 'sine', g: 0.035 }, { f: 988, d: 0.07, at: 0.07, type: 'sine', g: 0.03 }],                          // 연구원: 높고 짧게
    upgrade:    [{ f: 392, d: 0.05, type: 'triangle', g: 0.045 }, { f: 523, d: 0.05, at: 0.05, type: 'triangle', g: 0.045 }, { f: 659, d: 0.12, at: 0.1, type: 'triangle', g: 0.045 }],   // 개조: 세 음이 올라간다
    defense:    [{ noise: true, cut: 400, d: 0.06, g: 0.07 }, { f: 220, d: 0.1, type: 'triangle', g: 0.055 }],                                           // 방어 수단: 못 박는 소리
    trait:      [{ f: 659, d: 0.06, type: 'sine', g: 0.04 }, { f: 784, d: 0.06, at: 0.05, type: 'sine', g: 0.04 }, { f: 988, d: 0.26, at: 0.1, type: 'sine', g: 0.04 }],          // 특성: 반짝
    perk:       [{ f: 523, d: 0.35, type: 'sine', g: 0.035 }, { f: 659, d: 0.35, type: 'sine', g: 0.035 }, { f: 784, d: 0.35, type: 'sine', g: 0.035 }],  // 특전: 화음
    cache:      [{ f: 660, to: 990, d: 0.12, type: 'sine', g: 0.045 }, { f: 523, d: 0.07, at: 0.1, type: 'triangle', g: 0.04 }],                            // 은닉처: 찾았다
    // 0.8.10: 하는 일마다 소리가 다르다
    sell:       [{ f: 784, d: 0.05, type: 'sine', g: 0.045 }, { f: 988, d: 0.13, at: 0.05, type: 'sine', g: 0.045 }],                                   // 동전 소리
    peak:       [{ f: 784, d: 0.05, type: 'sine', g: 0.045 }, { f: 988, d: 0.08, at: 0.05, type: 'sine', g: 0.045 }, { f: 880, to: 1175, d: 0.2, at: 0.13, type: 'sine', g: 0.045 }],
    surge:      [{ f: 196, to: 392, d: 0.18, type: 'triangle', g: 0.05 }, { f: 392, to: 784, d: 0.22, at: 0.14, type: 'sine', g: 0.04 }],                // 전력이 차오르는 소리
    green:      [{ f: 880, d: 0.28, type: 'sine', g: 0.045 }, { f: 660, d: 0.34, at: 0.14, type: 'sine', g: 0.035 }],                                    // 역의 종소리
    answer:     [{ f: 659, d: 0.08, type: 'sine', g: 0.045 }, { f: 784, d: 0.16, at: 0.08, type: 'sine', g: 0.045 }],                                    // 무전 응답
    // 4.4.1 뽑기 기계: 손잡이(드르륵) · 캡슐이 떨어짐(통) · 누름(딱) · 금이 감(찌직) · 열림(등급마다: 일반 짧게, 희귀 두 음, 전설 화음이 올라간다)
    gturn:      [{ noise: true, cut: 400, d: 0.03, g: 0.09 }, { noise: true, cut: 400, d: 0.03, at: 0.09, g: 0.09 }, { noise: true, cut: 400, d: 0.03, at: 0.18, g: 0.09 }, { noise: true, cut: 400, d: 0.03, at: 0.27, g: 0.09 }, { noise: true, cut: 400, d: 0.03, at: 0.36, g: 0.09 }, { noise: true, cut: 400, d: 0.03, at: 0.45, g: 0.09 }, { f: 523, d: 0.06, at: 0.09, type: 'triangle', g: 0.05 }, { f: 587, d: 0.06, at: 0.27, type: 'triangle', g: 0.05 }, { f: 659, d: 0.08, at: 0.45, type: 'triangle', g: 0.055 }],
    gdrop:      [{ f: 880, to: 440, d: 0.12, type: 'triangle', g: 0.08 }, { noise: true, cut: 400, d: 0.05, at: 0.1, g: 0.09 }, { f: 659, d: 0.07, at: 0.18, type: 'triangle', g: 0.06 }, { f: 784, d: 0.07, at: 0.26, type: 'triangle', g: 0.05 }],
    gtap:       [{ f: 988, to: 880, d: 0.07, type: 'triangle', g: 0.085 }, { f: 494, d: 0.05, type: 'sine', g: 0.05 }, { noise: true, cut: 400, d: 0.02, g: 0.06 }],
    gcrack:     [{ noise: true, cut: 400, d: 0.09, g: 0.09 }, { f: 880, to: 1200, d: 0.12, at: 0.02, type: 'triangle', g: 0.075 }, { f: 988, d: 0.1, at: 0.08, type: 'sine', g: 0.06 }],
    gopen0:     [{ noise: true, cut: 400, d: 0.07, g: 0.08 }, { f: 784, d: 0.12, at: 0.04, type: 'triangle', g: 0.085 }, { f: 988, d: 0.2, at: 0.1, type: 'sine', g: 0.075 }],
    gopen1:     [{ noise: true, cut: 400, d: 0.09, g: 0.09 }, { f: 659, d: 0.12, at: 0.04, type: 'triangle', g: 0.085 }, { f: 880, d: 0.12, at: 0.12, type: 'triangle', g: 0.085 }, { f: 988, to: 1175, d: 0.3, at: 0.2, type: 'sine', g: 0.085 }],
    gopen2:     [{ noise: true, cut: 400, d: 0.12, g: 0.09 }, { f: 523, d: 0.45, at: 0.04, type: 'triangle', g: 0.07 }, { f: 659, d: 0.45, at: 0.12, type: 'triangle', g: 0.07 }, { f: 784, d: 0.45, at: 0.2, type: 'triangle', g: 0.07 }, { f: 880, d: 0.45, at: 0.28, type: 'triangle', g: 0.07 }, { f: 988, to: 1200, d: 0.6, at: 0.36, type: 'sine', g: 0.09 }, { f: 988, d: 0.08, at: 0.6, type: 'triangle', g: 0.06 }, { f: 880, d: 0.08, at: 0.72, type: 'triangle', g: 0.05 }, { f: 988, d: 0.12, at: 0.84, type: 'triangle', g: 0.06 }],
    // 4.5.5 친구 만들기: 간식 던지기 · 받아먹기 · 강아지(왈 · 멍멍) · 고양이(냥 · 야옹) · 친구가 됐을 때의 반짝임. 강아지 · 고양이는 목소리(voice)로 낸다
    bftoss:     [{ noise: true, cut: 380, d: 0.12, g: 0.05 }, { f: 420, to: 760, d: 0.14, type: 'sine', g: 0.04 }],                                  // 휙
    bfnom:      [{ f: 520, to: 700, d: 0.07, type: 'sine', g: 0.06 }, { f: 600, to: 820, d: 0.08, at: 0.09, type: 'sine', g: 0.06 }],              // 냠냠
    bfyip:      [{ voice: true, f: [700, 760, 450], d: 0.12, g: 0.06, pk: 0.25, att: 0.006, hold: 0.3, rough: 0.2, roughF: 1400, F: [{ f: [900, 1000, 700], q: 3, g: 1.5 }, { f: [1800, 2000, 1500], q: 5, g: 0.9 }] }],      // 왈
    bfbark:     [{ voice: true, f: [520, 560, 300], d: 0.16, g: 0.075, pk: 0.25, att: 0.008, hold: 0.3, rough: 0.25, roughF: 1100, F: [{ f: [800, 900, 600], q: 3, g: 1.5 }, { f: [1500, 1700, 1200], q: 5, g: 0.9 }] },
                 { voice: true, at: 0.24, f: [540, 580, 310], d: 0.17, g: 0.075, pk: 0.25, att: 0.008, hold: 0.3, rough: 0.25, roughF: 1100, F: [{ f: [800, 900, 600], q: 3, g: 1.5 }, { f: [1500, 1700, 1200], q: 5, g: 0.9 }] }],      // 멍멍
    bfmew:      [{ voice: true, f: [620, 840, 700], d: 0.32, g: 0.06, pk: 0.45, vib: 8, vd: 0.015, att: 0.03, hold: 0.45, F: [{ f: [600, 1100, 800], q: 4, g: 1.4 }, { f: [1500, 2100, 1600], q: 6, g: 1 }] }],      // 냥
    bfmeow:     [{ voice: true, f: [480, 760, 420], d: 0.75, g: 0.065, pk: 0.4, vib: 7, vd: 0.02, att: 0.06, hold: 0.5, F: [{ f: [500, 1000, 650], q: 4, g: 1.4 }, { f: [1300, 1900, 1100], q: 6, g: 1 }, { f: [2600, 2900, 2400], q: 8, g: 0.4 }] }],      // 야옹
    bfjoy:      [{ f: 659, d: 0.1, type: 'triangle', g: 0.07 }, { f: 784, d: 0.1, at: 0.08, type: 'triangle', g: 0.07 }, { f: 988, to: 1175, d: 0.32, at: 0.16, type: 'sine', g: 0.08 }],      // 반짝(하트)
    // 미리 듣기용 다른 소리(고르시면 위의 것과 바꾼다): 아기 고양이(더 높고 짧게), 작은 강아지(깡깡)
    bfmeowB:    [{ voice: true, f: [700, 980, 620], d: 0.55, g: 0.065, pk: 0.4, vib: 9, vd: 0.02, att: 0.04, hold: 0.5, F: [{ f: [700, 1300, 900], q: 4, g: 1.4 }, { f: [1700, 2400, 1700], q: 6, g: 1 }] }],
    bfbarkB:    [{ voice: true, f: [820, 900, 560], d: 0.11, g: 0.07, pk: 0.25, att: 0.006, hold: 0.3, rough: 0.2, roughF: 1500, F: [{ f: [1000, 1200, 800], q: 3, g: 1.5 }, { f: [2000, 2300, 1700], q: 5, g: 0.9 }] },
                 { voice: true, at: 0.17, f: [840, 920, 580], d: 0.11, g: 0.07, pk: 0.25, att: 0.006, hold: 0.3, rough: 0.2, roughF: 1500, F: [{ f: [1000, 1200, 800], q: 3, g: 1.5 }, { f: [2000, 2300, 1700], q: 5, g: 0.9 }] }],
    fortify:    [{ noise: true, cut: 300, d: 0.12, g: 0.07 }, { f: 147, d: 0.16, type: 'triangle', g: 0.06 }],                                           // 망치질
    goal:       [{ f: 523, d: 0.09, type: 'sine', g: 0.05 }, { f: 659, d: 0.09, at: 0.09, type: 'sine', g: 0.05 }, { f: 784, d: 0.09, at: 0.18, type: 'sine', g: 0.05 }, { f: 988, d: 0.3, at: 0.27, type: 'sine', g: 0.05 }],
    feed:       [{ f: 440, to: 660, d: 0.08, type: 'sine', g: 0.045 }, { f: 520, to: 780, d: 0.08, at: 0.09, type: 'sine', g: 0.045 }, { f: 660, to: 990, d: 0.13, at: 0.18, type: 'sine', g: 0.045 }],  // 냠냠
    tab:        [{ f: 330, to: 440, d: 0.05, type: 'sine', g: 0.025 }],
    dusk:       [{ f: 294, d: 0.35, type: 'triangle', g: 0.03 }, { f: 233, d: 0.5, at: 0.3, type: 'triangle', g: 0.03 }],
    defended:   [{ f: 392, d: 0.1, type: 'sine', g: 0.05 }, { f: 494, d: 0.1, at: 0.1, type: 'sine', g: 0.05 }, { f: 587, d: 0.24, at: 0.2, type: 'sine', g: 0.05 }],
    breached:   [{ noise: true, cut: 260, d: 0.55, g: 0.12 }, { f: 82, d: 0.55, type: 'triangle', g: 0.07 }],
    rush:       [{ f: 392, d: 0.1, type: 'triangle', g: 0.06 }, { f: 262, d: 0.1, at: 0.13, type: 'triangle', g: 0.06 }, { f: 392, d: 0.1, at: 0.26, type: 'triangle', g: 0.06 }, { f: 262, d: 0.14, at: 0.39, type: 'triangle', g: 0.06 }],      // 3.8.6 돌진 경보(높낮이를 오가는 네 음)
    signal:     [{ f: 784, d: 0.07, type: 'sine', g: 0.035 }, { f: 988, d: 0.07, at: 0.1, type: 'sine', g: 0.035 }, { f: 784, d: 0.09, at: 0.2, type: 'sine', g: 0.035 }],
    expedition: [{ f: 349, d: 0.1, type: 'sine', g: 0.045 }, { f: 466, d: 0.16, at: 0.1, type: 'sine', g: 0.045 }],
    story:      [{ f: 294, d: 0.55, type: 'sine', g: 0.05 }, { f: 220, d: 0.85, at: 0.3, type: 'sine', g: 0.045 }],
    type:       [{ f: 620, d: 0.025, type: 'sine', g: 0.009 }],
    relocate:   [{ f: 262, d: 0.14, type: 'sine', g: 0.045 }, { f: 330, d: 0.14, at: 0.13, type: 'sine', g: 0.045 }, { f: 392, d: 0.14, at: 0.26, type: 'sine', g: 0.045 }, { f: 523, d: 0.32, at: 0.39, type: 'sine', g: 0.045 }]
  };

  var enabled = true, ctx = null, unlocked = false;
  /*
   * 음량: 0 ~ 100, 기본 50. 50 이 기준 크기이고 100 이면 두 배, 0 이면 소리가 나지 않는다. 잘못된 값은 기본으로 본다.
   */
  var VOLUME_DEFAULT = 50, volume = VOLUME_DEFAULT;
  function setVolume(v) {
    var n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    volume = typeof n === 'number' && isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : VOLUME_DEFAULT;
    return volume;
  }
  function getVolume() { return volume; }

  function hasAudio() {
    return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
  }
  /** 첫 사용자 입력에서 호출한다. 여러 번 불러도 한 번만 만든다. */
  function unlock() {
    if (unlocked || !hasAudio()) return unlocked;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      unlocked = true;
    } catch (e) { ctx = null; }
    return unlocked;
  }
  function setEnabled(on) { enabled = on === true; return enabled; }
  function isEnabled() { return enabled; }

  /** 소리 하나의 전체 길이(초). 정의에 없는 이름이면 0. */
  function duration(name) {
    var notes = SOUNDS[name] || [], end = 0;
    notes.forEach(function (n) { end = Math.max(end, (n.at || 0) + n.d); });
    return end;
  }

  /*
   * ---------- 겹침 정리(2.8.6) ----------
   * 단추를 빠르게 누르면 같은 소리가 여러 겹으로 쌓여 뭉개져 들렸다(음량을 두 배로 올린 뒤 더 잘 들렸다).
   *   1) 같은 이름의 소리가 아직 울리는 중이면 앞의 것을 짧게 줄이고 새로 낸다(쌓이지 않고 다시 시작한다)
   *   2) 이름이 달라도 동시에 울리는 소리는 VOICE_MAX 개까지: 넘치면 가장 오래된 것부터 줄인다
   * voiceCuts 는 계산만 한다(테스트가 본다): 지금 울리는 목록에서 줄여야 할 것들을 돌려준다.
   */
  var VOICE_MAX = 2, VOICE_FADE = 0.012, voices = [];
  function soundLength(notes) { var end = 0; (notes || []).forEach(function (n) { end = Math.max(end, (n.at || 0) + (n.d || 0)); }); return end; }
  function voiceCuts(list, name, now) {
    var live = (list || []).filter(function (v) { return v && !v.cut && v.end > now; });
    var cuts = live.filter(function (v) { return v.name === name; });
    var rest = live.filter(function (v) { return v.name !== name; });
    while (rest.length > VOICE_MAX - 1) cuts.push(rest.shift());      // 새 소리 하나가 들어갈 자리를 남긴다
    return cuts;
  }

  /*
   * 4.5.5 목소리(voice): 강아지 · 고양이 소리. 톱니파를 목청처럼 쓰고, 입 모양(포먼트)을 띠 거름막 둘~셋으로 만든다.
   *   f: [처음, 가운데, 끝] 음높이(Hz) — 가운데까지 pk(0~1) 비율로 오르고 끝으로 내린다. 야옹은 오르내리는 활 모양이다.
   *   F: 입 모양 [{ f: [처음, 가운데, 끝], q, g }] — 'ㅁ'(닫힌 입)에서 'ㅑ'(벌린 입)로, 다시 'ㅗ'로 바뀌며 '야옹'이 된다.
   *   vib · vd: 떨림(Hz · 깊이), rough · roughF: 숨소리(짖을 때 거칠게), att · hold: 올라오는 시간 · 유지 비율.
   *   왜: 사인파 몇 음으로는 동물 소리가 아니라는 말이 있었다. 실제 울음처럼 배음과 입 모양이 있어야 그렇게 들린다.
   */
  function ramp3(param, a, b, c, st, d, pk) { param.setValueAtTime(a, st); param.linearRampToValueAtTime(b, st + d * (pk || 0.35)); param.linearRampToValueAtTime(c, st + d); }
  function playVoice(n, t0, bus) {
    var st = t0 + (n.at || 0), d = n.d, g = ctx.createGain(), peak = Math.max(0.0002, Math.min(MAX_GAIN, (n.g || 0.05) * VOLUME * volume / VOLUME_DEFAULT));
    var att = n.att || 0.03, hold = n.hold || 0.55;
    g.gain.setValueAtTime(0.0001, st); g.gain.linearRampToValueAtTime(peak, st + att); g.gain.setValueAtTime(peak, st + d * hold); g.gain.exponentialRampToValueAtTime(0.0001, st + d);
    var o = ctx.createOscillator(); o.type = 'sawtooth'; ramp3(o.frequency, n.f[0], n.f[1], n.f[2], st, d, n.pk);
    if (n.vib) { var l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = n.vib; lg.gain.value = n.f[1] * (n.vd || 0.025); l.connect(lg); lg.connect(o.frequency); l.start(st); l.stop(st + d + 0.05); }
    var mix = ctx.createGain(); mix.gain.value = 1;
    (n.F || []).forEach(function (F) { var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = F.q || 5; ramp3(bp.frequency, F.f[0], F.f[1], F.f[2], st, d, n.pk); var fg = ctx.createGain(); fg.gain.value = F.g || 1; o.connect(bp); bp.connect(fg); fg.connect(mix); });
    if (n.rough) {
      var len = Math.max(1, Math.floor(ctx.sampleRate * d)), buf = ctx.createBuffer(1, len, ctx.sampleRate), data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      var ns = ctx.createBufferSource(); ns.buffer = buf; var nb = ctx.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = n.roughF || 1200; nb.Q.value = 1.2;
      var ng = ctx.createGain(); ng.gain.value = n.rough; ns.connect(nb); nb.connect(ng); ng.connect(mix); ns.start(st); ns.stop(st + d);
    }
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    mix.connect(g); g.connect(lp);
    var out = ctx.__zone7Comp || ctx.destination;
    if (bus) { lp.connect(bus); bus.__out = out; } else lp.connect(out);
    o.start(st); o.stop(st + d + 0.05);
  }
  function playNote(n, t0, bus) {
    if (n.voice) return playVoice(n, t0, bus);
    var start = t0 + (n.at || 0), gain = ctx.createGain(), peak = Math.max(0.0002, Math.min(MAX_GAIN, (n.g || 0.05) * VOLUME * volume / VOLUME_DEFAULT)), src;
    // 딸깍거리는 잡음을 막으려고 음량을 짧게 올렸다가 서서히 내린다
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(ATTACK, n.d / 2));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + n.d);
    if (n.noise) {
      var len = Math.max(1, Math.floor(ctx.sampleRate * n.d)), buf = ctx.createBuffer(1, len, ctx.sampleRate), data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      src = ctx.createBufferSource(); src.buffer = buf;
      var filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = n.cut || 400;
      src.connect(filter); filter.connect(gain);
    } else {
      src = ctx.createOscillator(); src.type = n.type || 'triangle'; src.frequency.setValueAtTime(n.f, start);
      if (n.to > 0) src.frequency.exponentialRampToValueAtTime(n.to, start + n.d * 0.7);      // 음이 미끄러지는 소리
      src.connect(gain);
    }
    // 마지막에 높은 소리를 한 번 더 걸러서 부드럽게 한다
    var soft = ctx.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = SOFT_CUT;
    gain.connect(soft);
    // 누름막: 여러 소리가 겹쳐 커질 때만 눌러서 찢어지는 소리를 막는다. 기기가 지원하지 않으면 그냥 내보낸다
    var out = ctx.destination;
    try {
      if (!ctx.__zone7Comp && ctx.createDynamicsCompressor) {
        var comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -10; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.15;
        comp.connect(ctx.destination); ctx.__zone7Comp = comp;
      }
      if (ctx.__zone7Comp) out = ctx.__zone7Comp;
    } catch (e) { out = ctx.destination; }
    // 2.8.6: 한 번의 play 로 나는 음들은 그 소리만의 묶음(bus)을 거친다. 뒤에 오는 소리가 앞 소리를 줄일 수 있게
    if (bus) { soft.connect(bus); bus.__out = out; } else soft.connect(out);
    src.start(start); src.stop(start + n.d + 0.02);
  }

  /**
   * 이름으로 소리를 낸다. 실제로 냈으면 true.
   * 꺼져 있거나, 아직 깨우지 못했거나, 탭이 가려져 있거나, 모르는 이름이면 아무것도 하지 않고 false.
   */
  function play(name) {
    var notes = SOUNDS[name];
    if (!notes || !enabled || !unlocked || !ctx || volume <= 0) return false;
    if (typeof document !== 'undefined' && document.hidden) return false; // 안 보는 탭에서 혼자 울리지 않는다
    try {
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      var t0 = ctx.currentTime + 0.01, bus = null;
      try {
        // 겹침 정리: 같은 소리가 아직 울리는 중이면 앞의 것을 끊고, 동시에 울리는 소리는 VOICE_MAX 개까지만 둔다
        voiceCuts(voices, name, ctx.currentTime).forEach(function (v) {
          try { v.node.gain.cancelScheduledValues(ctx.currentTime); v.node.gain.setTargetAtTime(0.0001, ctx.currentTime, VOICE_FADE); } catch (e) { /* 못 줄여도 소리는 제 길이에서 끝난다 */ }
          v.cut = true;
        });
        voices = voices.filter(function (v) { return !v.cut && v.end > ctx.currentTime; });
        bus = ctx.createGain(); bus.gain.setValueAtTime(1, ctx.currentTime);
        voices.push({ name: name, node: bus, end: t0 + soundLength(notes) });
      } catch (e) { bus = null; }      // 묶음을 못 만들면 예전처럼 그냥 낸다
      notes.forEach(function (n) { playNote(n, t0, bus); });
      if (bus && bus.__out) bus.connect(bus.__out);
      return true;
    } catch (e) { return false; }
  }

  /*
   * ---------- 배경 음악(2.5.0) ----------
   * 녹음한 파일 없이, 효과음처럼 그 자리에서 소리를 만들어 낸다(파일 하나짜리 게임이라 음원을 실을 수 없다).
   * 곡은 셋이고 모두 가단조다. 한 곡은 여덟 마디, 한 마디는 16칸(16분음표)이다.
   *   day   낮: 보통 빠르기. 베이스, 화음을 한 음씩 짚는 반주, 가락, 여린 박자
   *   night 밤(무리가 온 뒤): 느리다. 심장 소리 같은 낮은 두 박, 길게 끄는 음, 드문드문한 높은 가락
   *   dread 변이체가 온 밤과 높은 위험 단계: 가장 느리다. 반음 부딪히는 화음, 낮게 깔리는 음
   * 구조: MUSIC(곡의 정의) → musicStep(곡, 마디, 칸)이 그 칸에 낼 음의 목록을 돌려준다(계산만 한다: 테스트가 이것을 본다)
   *       → 일정 간격으로 깨어나(pump) 조금 앞의 칸들을 미리 예약한다. 곡이 바뀌면 다음 마디부터 바뀐다.
   * 효과음과 따로 켜고 끄고, 음량도 따로다(musicBus). 탭이 가려지면 멈추고, 돌아오면 그 마디부터 다시 잇는다.
   */
  function midi(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  var MUSIC = {
    day: { bpm: 92,
      chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]],
      lead: [[[0, 76, 4], [4, 72, 2], [6, 69, 2], [8, 72, 4], [12, 74, 4]], [[0, 72, 6], [6, 69, 2], [8, 65, 4], [12, 69, 4]],
             [[0, 67, 4], [4, 72, 4], [8, 76, 6], [14, 74, 2]], [[0, 74, 8], [8, 71, 4], [12, 67, 4]],
             [[0, 76, 4], [4, 79, 2], [6, 76, 2], [8, 72, 4], [12, 69, 4]], [[0, 77, 6], [6, 76, 2], [8, 72, 8]],
             [[0, 74, 4], [4, 71, 4], [8, 74, 4], [12, 79, 4]], [[0, 76, 12], [12, 71, 4]]] },
    night: { bpm: 74,
      chords: [[57, 60, 64], [57, 60, 64], [50, 53, 57], [52, 56, 59], [57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]],
      lead: [[[8, 81, 8]], [[0, 80, 4], [8, 76, 8]], [[4, 77, 4], [8, 74, 8]], [[0, 71, 8], [8, 68, 8]],
             [[8, 76, 4], [12, 81, 4]], [[0, 84, 8], [8, 81, 8]], [[4, 77, 4], [8, 74, 8]], [[0, 76, 4], [4, 71, 12]]] },
    dread: { bpm: 66,
      chords: [[45, 48, 52], [45, 48, 51], [46, 49, 53], [45, 48, 52], [45, 48, 52], [44, 48, 51], [46, 49, 53], [45, 52, 57]],
      lead: [[[0, 75, 2], [2, 76, 10]], [[8, 72, 2], [10, 71, 6]], [[0, 77, 2], [2, 76, 6], [12, 73, 4]], [[4, 69, 12]],
             [[0, 75, 2], [2, 76, 6], [8, 79, 8]], [[0, 80, 4], [4, 79, 12]], [[8, 77, 2], [10, 76, 6]], [[0, 69, 16]]] }
  };
  /*
   * 2.5.2 음악의 기본 음량을 효과음과 같은 50으로 맞추고, 그 50에서의 크기를 전의 두 배로 했다(MUSIC_GAIN 2.4 → 4.8).
   * 2.5.1 날카로운 소리를 다듬었다:
   *   - 음악 전체를 MUSIC_CUT(1500Hz) 아래로 거른다(효과음은 2400Hz). 세모 파형의 쇳소리와 잡음 박자의 '칙' 소리가 여기서 깎인다
   *   - 음이 올라오는 시간을 0.03초 → MUSIC_ATTACK(0.07초)로 늘렸다. 음의 머리가 '딱' 하고 튀지 않는다
   *   - 밤과 변이체 곡의 가락을 한 옥타브 내렸다(880~1046Hz 의 사인파가 귀를 찔렀다). 낮의 가락은 세모에서 사인 파형으로
   *   - 변이체 곡의 부딪히는 화음을 한 옥타브 내리고 줄였다. 잡음 박자는 더 낮고 작게
   */
  var MUSIC_BARS = 8, MUSIC_STEPS = 16, MUSIC_GAIN = 4.8, MUSIC_VOLUME_DEFAULT = 50, MUSIC_CUT = 1500, MUSIC_ATTACK = 0.07;
  function musicDef(mood) { return Object.prototype.hasOwnProperty.call(MUSIC, mood) ? MUSIC[mood] : MUSIC.day; }
  /** 한 칸의 길이(초). */
  function musicStepSeconds(mood) { return 60 / musicDef(mood).bpm / 4; }
  /**
   * 그 칸에서 시작하는 음들 [{ f 주파수, d 길이(초), type 파형, g 크기, noise, cut }].
   * 모르는 곡이면 낮의 곡으로, 마디와 칸은 범위를 넘으면 돌아서(나머지) 읽는다. 잘못된 숫자는 0 으로 본다.
   */
  function musicStep(mood, bar, step) {
    var def = musicDef(mood), sec = musicStepSeconds(mood), out = [];
    var b = ((Math.floor(Number(bar) || 0) % MUSIC_BARS) + MUSIC_BARS) % MUSIC_BARS, st = ((Math.floor(Number(step) || 0) % MUSIC_STEPS) + MUSIC_STEPS) % MUSIC_STEPS;
    var chord = def.chords[b], kind = def === MUSIC.night ? 'night' : def === MUSIC.dread ? 'dread' : 'day';
    function add(m, steps, type, g) { out.push({ f: midi(m), d: steps * sec * 0.95, type: type, g: g }); }
    if (kind === 'day') {
      if (st === 0 || st === 8) add(chord[0] - 12, 5, 'triangle', 0.050);                     // 베이스: 근음
      if (st === 6 || st === 14) add(chord[2] - 12, 2, 'triangle', 0.036);                    // 베이스: 5음
      if (st % 2 === 0) add(chord[[0, 1, 2, 1, 0, 2, 1, 2][st / 2]] + 12, 2, 'sine', 0.012);  // 반주: 화음을 한 음씩
      if (st === 4 || st === 12) out.push({ noise: true, cut: 900, d: 0.07, g: 0.006, f: 0 });      // 여린 박자
    } else if (kind === 'night') {
      if (st === 0 || st === 3) add(chord[0] - 12, 3, 'triangle', 0.075);                     // 심장 소리: 쿵, 쿵(휴대폰 스피커로도 들리게 한 옥타브만 내리고 세모 파형을 쓴다)
      if (st === 0) { add(chord[0], 16, 'sine', 0.014); add(chord[2], 16, 'sine', 0.011); }   // 길게 끄는 음
      if (st === 8 || (b % 2 === 1 && st === 12)) add(chord[1], 4, 'sine', 0.012);
      if (st === 10) out.push({ noise: true, cut: 500, d: 0.16, g: 0.006, f: 0 });
    } else {
      if (st === 0 || st === 2 || st === 8) add(chord[0], 3, 'triangle', 0.075);              // 낮게 깔리는 박
      if (st === 0) { add(chord[0] + 12, 16, 'sine', 0.014); add(chord[1] + 12, 16, 'sine', 0.010); add(chord[2] + 1, 16, 'sine', 0.005); }      // 반음이 부딪히는 화음
      if (st % 4 === 2) out.push({ noise: true, cut: 350, d: 0.24, g: 0.008, f: 0 });
    }
    def.lead[b].forEach(function (n) { if (n[0] === st) add(n[1] - (kind === 'day' ? 0 : 12), n[2], 'sine', kind === 'day' ? 0.030 : 0.022); });      // 밤과 변이체의 가락은 한 옥타브 낮게
    return out;
  }

  var musicOn = true, musicVolume = MUSIC_VOLUME_DEFAULT, musicMood = 'day', musicNow = 'day', musicBus = null, musicTimer = null;
  var musicNext = 0, musicBar = 0, musicAt = 0;      // 다음에 예약할 칸의 시각(초), 마디, 칸
  function setMusicVolume(v) {
    var n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    musicVolume = typeof n === 'number' && isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : MUSIC_VOLUME_DEFAULT;
    try { if (musicBus) musicBus.gain.value = musicVolume / MUSIC_VOLUME_DEFAULT; } catch (e) { /* 소리는 없어도 된다 */ }
    return musicVolume;
  }
  function getMusicVolume() { return musicVolume; }
  function setMusicEnabled(on) { musicOn = on === true; if (!musicOn) musicNext = 0; return musicOn; }
  function isMusicEnabled() { return musicOn; }
  /** 곡을 고른다. 모르는 이름이면 그대로 둔다. 실제로는 다음 마디부터 바뀐다. */
  function setMood(mood) { if (Object.prototype.hasOwnProperty.call(MUSIC, mood)) musicMood = mood; return musicMood; }
  function getMood() { return musicMood; }
  function musicNote(n, start) {
    var gain = ctx.createGain(), peak = Math.max(0.0002, Math.min(0.5, n.g * MUSIC_GAIN)), src;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(MUSIC_ATTACK, n.d / 3));
    gain.gain.setValueAtTime(peak, start + n.d * 0.5);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + n.d);
    if (n.noise) {
      var len = Math.max(1, Math.floor(ctx.sampleRate * n.d)), buf = ctx.createBuffer(1, len, ctx.sampleRate), data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      src = ctx.createBufferSource(); src.buffer = buf;
      var filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = n.cut || 800;
      src.connect(filter); filter.connect(gain);
    } else {
      src = ctx.createOscillator(); src.type = n.type || 'sine'; src.frequency.setValueAtTime(n.f, start);
      src.connect(gain);
    }
    gain.connect(musicBus);
    src.start(start); src.stop(start + n.d + 0.03);
  }

  /*
   * ---------- 음원 파일(2.6.0) ----------
   * 합성한 음악은 악기 소리도 공간감도 없어서 "동굴에서 듣는 것 같다"는 말을 들었다. 그래서 녹음된 음원을 실을 수 있게 한다.
   *   넣는 법 : assets/bgm/ 에 day·night·dread 라는 이름의 파일(.ogg .mp3 .m4a .wav)을 둔다. 빌드가 게임 파일 안에 끼워 넣는다(build.js).
   *            셋 다 없어도 되고 하나만 있어도 된다. 없는 곡은 day → 아무 곡 순서로 대신한다(pickTrack).
   *   트는 법 : 곡이 필요해질 때 처음 한 번 풀어 두고(decode), 끊김 없이 되풀이한다. 곡이 바뀌면 TRACK_FADE 초 동안 겹쳐서 넘긴다.
   *   음원이 하나라도 있으면 합성 음악은 쓰지 않는다. 풀지 못한 파일은 없는 것으로 친다.
   */
  var TRACK_FADE = 1.5, TRACK_GAIN = 0.5;      // TRACK_GAIN: 음량 50 에서 파일의 소리를 이만큼으로(100 이면 원래 크기)
  var tracks = {}, trackBuf = {}, trackBusy = {}, trackBad = {}, playing = null;      // playing: { mood, src, gain }
  /** 음원을 등록한다 { day: 'data:audio/…', … }. 글이 아닌 값과 모르는 곡 이름은 버린다. 등록한 곡의 수를 돌려준다. */
  function setTracks(map) {
    tracks = {}; trackBuf = {}; trackBusy = {}; trackBad = {};
    if (map && typeof map === 'object') Object.keys(MUSIC).forEach(function (m) { if (typeof map[m] === 'string' && map[m].length > 16) tracks[m] = map[m]; });
    return Object.keys(tracks).length;
  }
  function hasTracks() { return Object.keys(tracks).length > 0; }
  /** 그 곡 자리에 틀 음원의 이름. 그 곡이 없으면(변이체는 먼저 밤의 곡을 찾고) 낮의 곡, 그것도 없으면 있는 것 가운데 첫째. 하나도 없으면 ''. */
  function pickTrack(mood, have) {
    var h = have && typeof have === 'object' ? have : {}, ok = function (m) { return Object.prototype.hasOwnProperty.call(h, m) && !!h[m]; };
    if (ok(mood)) return mood;
    if (mood === 'dread' && ok('night')) return 'night';      // 변이체의 곡이 없으면 밝은 낮 곡보다 밤 곡이 낫다(2.6.2)
    if (ok('day')) return 'day';
    var names = Object.keys(MUSIC).filter(ok);
    return names.length ? names[0] : '';
  }
  function stopTrack(now) {
    if (!playing) return;
    var old = playing; playing = null;
    try { old.gain.gain.cancelScheduledValues(now); old.gain.gain.setValueAtTime(Math.max(0.0001, old.gain.gain.value), now); old.gain.gain.exponentialRampToValueAtTime(0.0001, now + TRACK_FADE); old.src.stop(now + TRACK_FADE + 0.05); } catch (e) { /* 이미 멈췄다 */ }
  }
  function loadTrack(name) {
    if (trackBuf[name] || trackBusy[name] || trackBad[name] || typeof fetch !== 'function') return;
    trackBusy[name] = true;
    fetch(tracks[name]).then(function (r) { return r.arrayBuffer(); }).then(function (ab) {
      return new Promise(function (res, rej) { var p = ctx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
    }).then(function (buf) { trackBuf[name] = buf; trackBusy[name] = false; }, function () { trackBad[name] = true; trackBusy[name] = false; });
  }
  /** 음원 쪽의 한 걸음: 틀어야 할 곡을 고르고, 준비됐으면 겹쳐서 넘긴다. 새로 틀었으면 1, 아니면 0. */
  function pumpTracks() {
    var now = ctx.currentTime, usable = {};
    Object.keys(tracks).forEach(function (m) { if (!trackBad[m]) usable[m] = true; });
    var want = pickTrack(musicMood, usable);
    if (!want) { stopTrack(now); return 0; }
    if (playing && playing.mood === want) return 0;
    if (!trackBuf[want]) { loadTrack(want); return 0; }
    stopTrack(now);
    var src = ctx.createBufferSource(), gain = ctx.createGain();
    src.buffer = trackBuf[want]; src.loop = true;
    gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(TRACK_GAIN, now + TRACK_FADE);
    src.connect(gain); gain.connect(musicBus); src.start(now);
    playing = { mood: want, src: src, gain: gain };
    return 1;
  }
  /** 조금 앞의 칸들을 예약한다. 꺼져 있거나, 깨우지 못했거나, 탭이 가려져 있으면 아무것도 하지 않는다. */
  function pump() {
    var quiet = !musicOn || !unlocked || !ctx || musicVolume <= 0 || (typeof document !== 'undefined' && document.hidden);
    if (quiet) { musicNext = 0; if (playing && ctx) { try { stopTrack(ctx.currentTime); } catch (e) { playing = null; } } return 0; }
    var made = 0;
    try {
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      if (!musicBus) {
        musicBus = ctx.createGain(); musicBus.gain.value = musicVolume / MUSIC_VOLUME_DEFAULT;
        var soft = ctx.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = MUSIC_CUT;
        if (hasTracks()) soft.frequency.value = 20000;      // 음원은 이미 다듬어진 소리다: 거르지 않는다
        musicBus.connect(soft);
        // 2.5.2: 음악도 두 배로 키웠으므로(기본 50) 음량 100 에서 겹친 음이 찢어지지 않게 누름막을 거친다. 기기가 지원하지 않으면 그냥 내보낸다
        var mout = ctx.destination;
        try { if (ctx.createDynamicsCompressor) { var mc = ctx.createDynamicsCompressor(); mc.threshold.value = -14; mc.knee.value = 10; mc.ratio.value = 12;      /* 2.5.3: 음량 100 에서 최대 1.04 로 넘쳐서 더 세게 누른다(재 보니 0.87~0.91) */ mc.attack.value = 0.005; mc.release.value = 0.2; mc.connect(ctx.destination); mout = mc; } } catch (e) { mout = ctx.destination; }
        soft.connect(mout);
      }
      if (hasTracks()) return pumpTracks();      // 음원이 있으면 합성 음악은 쓰지 않는다
      var now = ctx.currentTime;
      if (!(musicNext > now - 0.5)) { musicNext = now + 0.08; musicAt = 0; musicNow = musicMood; }      // 처음이거나 오래 쉬었다: 마디의 처음부터 다시
      while (musicNext < now + 0.45 && made < 64) {
        if (musicAt === 0) musicNow = musicMood;      // 곡은 마디가 바뀔 때만 바꾼다
        musicStep(musicNow, musicBar, musicAt).forEach(function (n) { musicNote(n, musicNext); made++; });
        musicNext += musicStepSeconds(musicNow);
        musicAt++;
        if (musicAt >= MUSIC_STEPS) { musicAt = 0; musicBar = (musicBar + 1) % MUSIC_BARS; }
      }
    } catch (e) { musicNext = 0; }
    return made;
  }
  /** 음악을 돌리기 시작한다(여러 번 불러도 한 번만). 실제 소리는 첫 입력으로 깨운 뒤부터 난다. */
  function startMusic() {
    if (musicTimer || typeof setInterval !== 'function') return !!musicTimer;
    musicTimer = setInterval(pump, 120);
    return true;
  }

  return { voiceCuts: voiceCuts, VOICE_MAX: VOICE_MAX, SOUNDS: SOUNDS, MAX_GAIN: MAX_GAIN, VOLUME: VOLUME, VOLUME_DEFAULT: VOLUME_DEFAULT, setVolume: setVolume, getVolume: getVolume, SOFT_CUT: SOFT_CUT, unlock: unlock, setEnabled: setEnabled, isEnabled: isEnabled,
           MUSIC: MUSIC, MUSIC_BARS: MUSIC_BARS, MUSIC_STEPS: MUSIC_STEPS, MUSIC_VOLUME_DEFAULT: MUSIC_VOLUME_DEFAULT, MUSIC_CUT: MUSIC_CUT, MUSIC_ATTACK: MUSIC_ATTACK, musicStep: musicStep, musicStepSeconds: musicStepSeconds, setMusicVolume: setMusicVolume, getMusicVolume: getMusicVolume, setMusicEnabled: setMusicEnabled, isMusicEnabled: isMusicEnabled, setMood: setMood, getMood: getMood, startMusic: startMusic, pump: pump, setTracks: setTracks, hasTracks: hasTracks, nowPlaying: function () { return playing ? playing.mood : ''; }, pickTrack: pickTrack, TRACK_FADE: TRACK_FADE, duration: duration, play: play };
});
