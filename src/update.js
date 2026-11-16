/*
 * Updater — 버전 비교와 새 버전 확인
 * ------------------------------------------------------------
 * 화면(DOM)을 모른다. "지금 버전보다 새 버전이 서버에 있는가"만 판단하므로 Node 에서 테스트할 수 있다.
 * 실제로 알림을 띄우고 새로 여는 일은 ui.js 의 Update 가 한다.
 *
 * 서버의 version.json 형식(빌드 스크립트가 만든다):
 *   { "version": "0.3.6", "name": "알파 0.3.6", "title": "업데이트 알림", "items": ["…"], "builtAt": "2026-11-15T09:00:00Z" }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Updater = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** "0.3.10" → [0, 3, 10]. 숫자와 점으로만 된 문자열이 아니면 null. */
  function parse(version) {
    if (typeof version !== 'string' || !/^\d+(\.\d+)*$/.test(version.trim())) return null;
    return version.trim().split('.').map(Number);
  }
  /**
   * remote 가 current 보다 새 버전인가. 자리마다 숫자로 비교한다("0.3.10" 은 "0.3.9" 보다 새 버전).
   * 어느 한쪽이라도 읽을 수 없는 버전이면 false: 잘못된 정보로 업데이트를 권하지 않는다.
   */
  function isNewer(remote, current) {
    var a = parse(remote), b = parse(current);
    if (!a || !b) return false;
    for (var i = 0; i < Math.max(a.length, b.length); i++) {
      var x = a[i] || 0, y = b[i] || 0;
      if (x !== y) return x > y;
    }
    return false;
  }
  /**
   * 서버의 버전 정보를 받아 와 새 버전이 있는지 알려 준다.
   * fetchFn 은 window.fetch 와 같은 모양의 함수다(테스트에서는 가짜를 넣는다).
   * 절대 거부(reject)하지 않는다: 오프라인, 깨진 응답, 예전 버전은 모두 { available: false } 다.
   */
  function checkRemote(fetchFn, url, current) {
    return Promise.resolve()
      .then(function () { return fetchFn(url + '?t=' + Date.now(), { cache: 'no-store' }); }) // 저장해 둔 예전 응답을 받지 않게 한다
      .then(function (res) { return res && res.ok ? res.json() : null; })
      .then(function (info) {
        if (!info || typeof info !== 'object' || !isNewer(info.version, current)) return { available: false };
        return { available: true, info: {
          version: info.version,
          name: typeof info.name === 'string' ? info.name : '',
          title: typeof info.title === 'string' ? info.title : '',
          items: Array.isArray(info.items) ? info.items.filter(function (t) { return typeof t === 'string'; }) : []
        } };
      })
      .catch(function () { return { available: false }; });
  }

  return { parse: parse, isNewer: isNewer, checkRemote: checkRemote };
});
