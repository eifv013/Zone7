/*
 * 화면 코드가 "선언하지 않은 이름"을 쓰지 않는지 본다.
 * 브라우저는 id 가 있는 요소를 같은 이름의 전역 변수로도 내준다. 그래서 지운 변수를 계속 읽어도 오류가 나지 않고,
 * 화면에 [object HTMLDivElement] 가 찍힌다(0.9 에서 '최근 무전'이 그랬다). 그런 실수를 올리기 전에 잡는다.
 * 실행: node --test test/ui-globals.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('ui.js 는 요소 id 와 같은 이름을 선언 없이 쓰지 않는다', () => {
  const tpl = fs.readFileSync(path.join(__dirname, '..', 'src', 'template.html'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui.js'), 'utf8');
  const ids = [...new Set([...tpl.matchAll(/id="([A-Za-z_$][\w$]*)"/g)].map((m) => m[1]))];
  // 주석과 문자열을 지운 본문에서만 찾는다
  const code = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, "''");
  const esc = (s) => s.replace(/[$]/g, '\\$');
  const bad = ids.filter((id) => {
    const used = new RegExp('(?<![\\w$.])' + esc(id) + '(?![\\w$]|\\s*:)').test(code);
    if (!used) return false;
    const declared = new RegExp('\\b(?:var|let|const|function)\\s+(?:[\\w$]+\\s*(?:=[^,;]*)?,\\s*)*' + esc(id) + '\\b').test(code)
      || new RegExp('function\\s*[\\w$]*\\s*\\([^)]*\\b' + esc(id) + '\\b[^)]*\\)').test(code);
    return !declared;
  });
  assert.deepEqual(bad, [], '선언 없이 쓰는 이름: ' + bad.join(', '));
});
