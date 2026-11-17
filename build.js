/*
 * 빌드: src/boot.js, src/notes.js, src/update.js, src/core.js, src/help.js, src/scene.js, src/sound.js, src/ui.js 를 template.html 에 끼워 넣어
 * 한 파일짜리 dist/index.html 을 만든다. 실행: node build.js
 */
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');

try {
  const tpl = read('template.html');
  for (const mark of ['/*__VERSION__*/', '/*__BOOT__*/', '/*__NOTES__*/', '/*__FEEDBACK__*/', '/*__UPDATE__*/', '/*__CORE__*/', '/*__HELP__*/', '/*__SCENE__*/', '/*__SOUND__*/', '/*__UI__*/']) {
    if (!tpl.includes(mark)) throw new Error(`template.html 에 ${mark} 자리가 없습니다.`);
  }
  // 함수형 치환을 써서 소스 안의 '$' 가 치환 패턴으로 해석되지 않게 한다.
  // 버전은 package.json 한 곳에서 정한다. 패치노트의 맨 위 항목과 다르면 올리는 것을 잊은 것이므로 멈춘다.
  const version = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;
  const notes = require('./src/notes.js');
  if (!notes.length || !notes[0].ver.endsWith(' ' + version)) {
    throw new Error(`패치노트 맨 위 버전(${notes.length ? notes[0].ver : '없음'})이 package.json 의 버전(${version})과 다릅니다.`);
  }
  // 낸 시각(at)은 '연-월-일 시:분:초' 형식이어야 하고 날짜(date)와 같은 날이어야 한다. 잘못 적은 시각이 화면에 나가지 않게 한다.
  for (const n of notes) {
    if (n.at !== undefined && !(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(n.at) && n.at.startsWith(n.date + ' '))) {
      throw new Error(`패치노트 ${n.ver} 의 시각(at: ${n.at})이 형식에 맞지 않거나 날짜(${n.date})와 다릅니다.`);
    }
  }
  const html = tpl.replace('/*__VERSION__*/', () => `window.ZONE7_VERSION = ${JSON.stringify(version)};`)
    .replace('/*__BOOT__*/', () => read('boot.js'))
    .replace('/*__NOTES__*/', () => read('notes.js'))
    .replace('/*__FEEDBACK__*/', () => read('feedback.js'))
    .replace('/*__UPDATE__*/', () => read('update.js'))
    .replace('/*__CORE__*/', () => read('core.js'))
    .replace('/*__HELP__*/', () => read('help.js'))
    .replace('/*__SCENE__*/', () => read('scene.js'))
    .replace('/*__SOUND__*/', () => read('sound.js'))
    .replace('/*__UI__*/', () => read('ui.js'));
  const opens = (html.match(/<script\b/g) || []).length;
  const closes = (html.match(/<\/script>/g) || []).length;
  if (opens !== closes) throw new Error(`스크립트 태그가 맞지 않습니다(여는 태그 ${opens}, 닫는 태그 ${closes}). 소스 안에 </script> 문자열이 있는지 확인하세요.`);
  fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), html);
  console.log(`dist/index.html ${(html.length / 1024).toFixed(1)} KB`);

  /*
   * 설치형(PWA) 꾸러미: dist/pwa/ 폴더를 통째로 HTTPS 웹 호스팅에 올리면 폰의 홈 화면에 앱처럼 설치할 수 있다.
   * 게시된 페이지용 index.html 은 건드리지 않고, 복사본에만 설치에 필요한 태그와 서비스 워커 등록을 넣는다.
   */
  const pwaSrc = path.join(__dirname, 'pwa-src'), pwaOut = path.join(__dirname, 'dist', 'pwa');
  const headExtra = `
<meta name="theme-color" content="#17180f">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="7구역">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<style>
/* 전체 화면 앱에서는 노치와 홈 표시줄에 가려지지 않게 안쪽 여백을 둔다 */
body { padding-top: env(safe-area-inset-top); }
.mnav { padding-bottom: env(safe-area-inset-bottom); }
/*
 * 1.0.9: iOS 26 부터 홈 화면 앱의 맨 위에는 기기가 직접 그리는 흐림(상태 표시줄 아래로 40pt 쯤)이 덮인다.
 * 웹 쪽에서 끌 방법이 없어서(메타 태그나 CSS 로는 안 된다), 그 띠만큼 화면을 아래로 내려 내용이 흐림에 걸리지 않게 한다.
 * 아이폰·아이패드의 홈 화면 앱에서만 적용된다(다른 기기와 브라우저 탭에서는 그대로).
 */
@supports (-webkit-touch-callout: none) {
  @media (display-mode: standalone) {
    body { padding-top: calc(env(safe-area-inset-top) + 40px); }
  }
}
</style>`;
  const swRegister = `
<script>
// 설치형 버전: 오프라인에서도 열리도록 서비스 워커를 등록한다. 지원하지 않는 브라우저에서는 그냥 넘어간다.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('sw', e); });
  });
}
</script>`;
  let pwaHtml = html.replace('<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
  if (pwaHtml.indexOf('<meta name="viewport"') < 0) throw new Error('viewport 메타 태그를 찾지 못했습니다(PWA 빌드).');
  pwaHtml = pwaHtml.replace('</title>', '</title>' + headExtra).replace('</body>', swRegister + '\n</body>')
    .replace('window.ZONE7_VERSION = ', 'window.ZONE7_PWA = true; window.ZONE7_VERSION = '); // 설치형에서만 새 버전을 확인한다
  fs.mkdirSync(pwaOut, { recursive: true });
  fs.writeFileSync(path.join(pwaOut, 'index.html'), pwaHtml);
  fs.writeFileSync(path.join(pwaOut, 'sw.js'), fs.readFileSync(path.join(pwaSrc, 'sw.js'), 'utf8').replace(/__VERSION__/g, version));
  for (const f of ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', '설치방법.txt']) {
    fs.copyFileSync(path.join(pwaSrc, f), path.join(pwaOut, f));
  }
  // 앱이 새 버전 여부를 확인하는 파일. 이 폴더를 다시 올리면 설치된 앱에 "지금 업데이트"가 뜬다.
  fs.writeFileSync(path.join(pwaOut, 'version.json'), JSON.stringify({
    version, name: notes[0].ver, title: notes[0].title, items: notes[0].items, builtAt: new Date().toISOString()
  }, null, 1));
  console.log(`dist/pwa/ (설치형 꾸러미, 버전 ${version})`);
} catch (e) {
  console.error('빌드 실패:', e.message);
  process.exit(1);
}
