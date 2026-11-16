/*
 * 데스크톱 껍데기(Electron 메인 프로세스)
 * ------------------------------------------------------------
 * 하는 일은 창 하나를 띄워 dist/index.html 을 여는 것뿐이다.
 * 게임 규칙(src/core.js)과 화면(src/ui.js)은 웹 버전과 완전히 같은 파일을 쓴다.
 * 저장은 페이지의 localStorage 가 그대로 맡는다(Electron 이 사용자 폴더에 보관).
 */
const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');

const GAME_FILE = path.join(__dirname, 'dist', 'index.html');
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#cfcfc4', // 로딩 중 흰 화면이 번쩍이지 않게 게임 배경색으로 맞춘다
    autoHideMenuBar: true,
    title: '7구역',
    icon: path.join(__dirname, 'build', 'icon.png'), // 창과 작업 표시줄에 보이는 아이콘
    webPreferences: {
      // 게임 페이지는 Node 기능이 필요 없다. 최소 권한으로 연다.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  // 게임 파일을 못 찾으면(빌드 누락 등) 빈 창 대신 이유를 알리고 종료한다.
  win.loadFile(GAME_FILE).catch((err) => {
    dialog.showErrorBox('7구역', '게임 파일을 열 수 없습니다.\n먼저 "npm run build" 를 실행해 주세요.\n\n' + err.message);
    app.quit();
  });

  // 창 안에서는 게임 페이지만 보여 준다. 외부 링크는 기본 브라우저로 넘긴다.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  win.on('closed', () => { win = null; });
}

// 두 번 실행하면 저장 데이터를 두 창이 서로 덮어쓰므로 한 개만 허용한다.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(createWindow).catch((err) => {
    dialog.showErrorBox('7구역', '시작하지 못했습니다.\n\n' + err.message);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
}
