/*
 * Feedback — 의견 보내기
 * ------------------------------------------------------------
 * 테스터가 쓴 글에 "어떤 판에서 나온 의견인지" 알 수 있는 정보를 붙여 한 덩어리의 글로 만든다.
 * 서버가 없으므로 보내는 길은 셋이다: 공유(폰의 공유 창), 복사(붙여 넣어 전달), GitHub 에 올리기.
 * 이 모듈은 글을 만드는 일만 한다(화면을 모른다). 실제로 창을 띄우고 보내는 일은 ui.js 가 한다.
 *
 * 붙는 정보: 버전, 구역, 철수 횟수, 플레이 시간, 지난 판 기록, 화면 크기, 브라우저 종류.
 * 붙지 않는 정보: 이름, 연락처, 위치, 저장 데이터 전체. 사람을 알아볼 수 있는 것은 넣지 않는다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Feedback = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_TEXT = 2000;       // 쓴 글의 최대 길이(글자)
  var MAX_URL = 6000;        // GitHub 로 넘기는 주소의 최대 길이: 너무 길면 브라우저나 서버가 거절한다
  var MAX_RUNS = 5;          // 붙이는 지난 판 기록의 수

  function str(v) { return typeof v === 'string' ? v : ''; }
  function num(v) { return typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0; }
  /** 줄바꿈을 정리하고 앞뒤 공백을 떼고 길이를 자른다. 글이 아니면 빈 글. */
  function clean(text) {
    return str(text).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT);
  }
  /** 보낼 수 있는 글인가(빈 글은 보내지 않는다). */
  function valid(text) { return clean(text).length > 0; }
  /** 초 → "2시간 5분". 규칙 모듈의 것을 받아 쓰되, 없으면 간단히 만든다. */
  function span(sec, fmt) {
    if (typeof fmt === 'function') { try { return String(fmt(num(sec))); } catch (e) { /* 아래 기본 방식으로 */ } }
    var m = Math.floor(num(sec) / 60);
    return m >= 60 ? Math.floor(m / 60) + '시간 ' + (m % 60) + '분' : m + '분';
  }
  /** 브라우저 이름표(User-Agent)에서 기기 종류만 짧게 뽑는다. 긴 원문은 붙이지 않는다. */
  function device(ua) {
    ua = str(ua);
    var os = /Android/i.test(ua) ? '안드로이드' : /iPhone|iPad|iPod/i.test(ua) ? '아이폰·아이패드' : /Windows/i.test(ua) ? '윈도우' : /Mac OS X/i.test(ua) ? '맥' : /Linux/i.test(ua) ? '리눅스' : '알 수 없음';
    var app = /; wv\)/.test(ua) ? '앱' : /Electron/i.test(ua) ? 'PC 앱' : '브라우저';
    return os + ' · ' + app;
  }

  /**
   * 의견 글을 만든다.
   *   input: { text, version, zone(지금 구역 이름), stats(GameCore.stats 의 결과), screen: { w, h }, ua, duration(초→글 함수), zoneName(번호→이름 함수) }
   * 빠진 값이 있어도 예외를 던지지 않고 그 줄만 비워 둔다. 쓴 글이 비어 있으면 '' 를 돌려준다.
   */
  function compose(input) {
    input = input && typeof input === 'object' ? input : {};
    var text = clean(input.text);
    if (!text) return '';
    var s = input.stats && typeof input.stats === 'object' ? input.stats : {};
    var zoneName = typeof input.zoneName === 'function' ? input.zoneName : function (i) { return (i + 1) + '구역'; };
    var name = function (i) { try { return String(zoneName(num(i))); } catch (e) { return (num(i) + 1) + '구역'; } };
    var lines = [
      '[7구역 의견] 알파 ' + (str(input.version) || '?'),
      '',
      text,
      '',
      '--- 자동으로 붙는 정보 ---',
      '지금: ' + (str(input.zone) || '?') + ' · 가장 멀리: ' + name(s.bestZone),
      '철수 ' + num(s.retreats) + '번 · 항체 누적 ' + num(s.antibodyTotal) + ' · 막아낸 밤 ' + num(s.wavesCleared) + ' · 뚫린 밤 ' + num(s.breaches),
      '플레이 ' + span(s.play, input.duration) + ' · 자리 비움 ' + span(s.away, input.duration) + ' · 이번 판 ' + span(s.run, input.duration) + (num(s.days) ? ' · ' + num(s.days) + '일째' : '')
    ];
    var runs = (Array.isArray(s.runs) ? s.runs : []).filter(function (r) { return r && typeof r === 'object'; }).slice(0, MAX_RUNS);
    if (runs.length) lines.push('지난 판: ' + runs.map(function (r) { return name(r.zone) + ' ' + span(r.seconds, input.duration) + ' (+' + num(r.antibodies) + ')'; }).join(' / '));
    var sc = input.screen && typeof input.screen === 'object' ? input.screen : {};
    lines.push('기기: ' + device(input.ua) + ' · 화면 ' + Math.round(num(sc.w)) + '×' + Math.round(num(sc.h)));
    return lines.join('\n');
  }

  /**
   * GitHub 에 새 글(이슈)을 쓰는 화면의 주소를 만든다. 제목은 쓴 글의 첫 줄(40자), 본문은 의견 글 전체.
   * 주소가 MAX_URL 을 넘으면 본문 뒤쪽을 잘라 맞춘다. repo 가 https://github.com/… 형식이 아니거나 글이 비면 ''.
   */
  function issueUrl(repo, report, text) {
    repo = str(repo).replace(/\/+$/, '');
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repo) || !str(report)) return '';
    var first = clean(text).split('\n')[0].slice(0, 40) || '의견';
    var head = repo + '/issues/new?title=' + encodeURIComponent('[의견] ' + first) + '&body=';
    var body = str(report), tail = '\n…(길어서 잘림)';
    while (body.length > 0 && (head + encodeURIComponent(body)).length > MAX_URL) body = body.slice(0, Math.floor(body.length * 0.9));
    if (body.length < str(report).length) body += tail;
    return head + encodeURIComponent(body);
  }

  return { MAX_TEXT: MAX_TEXT, MAX_URL: MAX_URL, MAX_RUNS: MAX_RUNS, clean: clean, valid: valid, device: device, compose: compose, issueUrl: issueUrl };
});
