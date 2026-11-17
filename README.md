# 7구역 — 알파 1.0.9

> **알파 0.6 부터 구조가 바뀌었다.** 지구(1-A ~ 7-Z)를 이주하던 규칙을 버리고, 구역이 쌓이고 철수로 항체 샘플을 얻는 구조로 새로 썼다.
> 지금 규칙은 `src/core.js`, 예전 규칙과 화면·테스트·시뮬레이터는 `legacy/` 에 남겨 두었다(빌드에는 들어가지 않는다).
> 아래 설명 가운데 예전 구조(이주, 원정, 제작, 유물 등)에 관한 부분은 `legacy/` 의 코드에 해당한다.
> 밸런스 확인: `node tools/sim.js` (하루 4번 × 15분으로 3구역 문 앞까지 며칠, 철수 몇 번). 화면 확인: `python3 tools/smoke.py`.

## 가장 빠른 방법 (설치 없음)
- `dist/index.html` 을 더블클릭하면 브라우저에서 바로 실행됩니다.
- Windows: `run-windows.bat` 을 더블클릭하면 주소창 없는 전용 창으로 열립니다.

## 실행파일(.exe) 만들기
[Node.js](https://nodejs.org) LTS 설치 후 이 폴더에서:

```
npm install
npm run dist
```

`release/` 폴더에 설치가 필요 없는 `7구역 1.0.9.exe` 가 생깁니다.
macOS 는 `npm run dist:mac`, Linux 는 `npm run dist:linux`. (각 OS 에서 실행해야 합니다.)

빌드 전에 창으로 먼저 띄워 보려면 `npm start`.

## 폰에 설치하기 (PWA)
`node build.js` 를 실행하면 `dist/pwa/` 폴더가 함께 만들어집니다. 이 폴더를 HTTPS 웹 호스팅에 올리고
폰 브라우저에서 "홈 화면에 추가"를 하면 앱처럼 설치됩니다. 자세한 순서는 `dist/pwa/설치방법.txt`.
원본은 `pwa-src/`(아이콘, manifest, 서비스 워커)에 있습니다.
아이콘은 "표지판과 탑" 디자인(7 표지판, 송신탑, 노란 우비의 주인공)이고, PC 실행파일용은 `build/icon.png` 입니다.

## 새 버전 내기
1. `src/notes.js` 맨 위에 패치노트 항목을 추가하고, `package.json` 의 `version` 을 같은 숫자로 올립니다(다르면 빌드가 멈춥니다).
2. `npm test` 후 `node build.js`.
3. `dist/pwa/` 폴더를 같은 주소에 다시 올립니다. 설치된 앱은 열 때·30분마다·화면으로 돌아올 때 `version.json` 을 확인해
   새 버전이면 "지금 업데이트" 띠를 띄웁니다. 누르면 진행을 저장하고 새 파일로 다시 엽니다.

## 구조
| 파일 | 역할 |
|---|---|
| `src/core.js` | 게임 규칙 (DOM 없음, 테스트 대상) |
| `src/scene.js` | 도트 화면 (그리기 전용, 규칙에 관여하지 않음) |
| `src/sound.js` | 효과음 (Web Audio 합성, 음원 파일 없음) |
| `src/notes.js` | 패치노트(버전 기록) |
| `src/update.js` | 버전 비교와 새 버전 확인 |
| `src/help.js` | 도움말 글 (숫자는 core.js 상수에서 읽음) |
| `tools/smoke.py` | 화면 연기 테스트: 빌드한 게임을 브라우저로 70초 돌려 오류를 잡는다 (Python, Playwright) |
| `tools/icon/` | 앱 아이콘 생성 스크립트와 테스트 (Python, Pillow) |
| `src/ui.js` | 화면과 입력, 자동 저장 |
| `src/template.html` | 마크업과 스타일 |
| `build.js` | 위 셋을 `dist/index.html` 한 파일로 합침 |
| `main.js` | Electron 창 껍데기 (dist/index.html 을 열기만 함) |
| `test/*.test.js` | 단위 테스트 — `npm test` |
| `tools/sim.js` | 밸런스 시뮬레이터 (자동 플레이로 엔딩까지의 시간 측정) |

## 참고
- 저장은 실행 방식마다 따로 보관됩니다(브라우저 / bat 창 / exe). 옮길 때는 게임 맨 아래 `저장 코드 복사` → `저장 코드 불러오기`.
- 인터넷이 없으면 글꼴만 시스템 기본 글꼴로 바뀌고 게임은 그대로 동작합니다.

## 알파 0.3 에서 알려진 한계
- 밸런스 기준은 하루 1시간(15분씩 4번) 플레이로 엔딩까지 15일입니다(자동 플레이 시험: 14~15일, 계속 켜 두면 약 39시간). 확인: `node tools/sim.js CASUAL=4x15`. 사람이 끝까지 해 본 적은 없습니다.
- 자리 비움 보상은 기본 최대 4시간·효율 50%이고, 지구 과제 보상으로 영구히 늘어납니다(최대 12시간, +30%p).
- 방치 플레이 시험: `node tools/sim.js CASUAL=3x10` (하루 3번, 10분씩).
- 밸런스 시험: `node tools/sim.js` (상수를 바꿔 보려면 `node tools/sim.js STEP_REQUIRE=1.18` 처럼 덧붙입니다).
- 계정 저장은 게시된 페이지에서만 동작하고, 한 번에 한 기기에서만 진행됩니다(다른 기기는 멈추고 "여기서 이어하기"로 넘겨받습니다). 파일·exe 는 그 기기에만 저장됩니다.
- 도트 화면과 날씨는 연출 전용이라 수치에 영향을 주지 않습니다.
- 효과음은 합성음입니다. 크기와 음은 `src/sound.js` 의 `SOUNDS` 표에서 바꿉니다.
- 밸런스 수치는 `src/core.js` 맨 위 상수와 정의 표에 모여 있습니다.

## 안드로이드 앱과 자동 업데이트

- 게임 주소: https://eifv013.github.io/Zone7/ (저장소의 `docs/` 폴더를 GitHub Pages 가 내보낸다)
- 앱(APK): https://github.com/eifv013/Zone7/releases/latest/download/zone7.apk
- 앱은 껍데기다(`android/`). 켤 때 위 게임 주소를 웹뷰로 연다. 그래서 **게임 패치는 `docs/` 만 바꾸면 끝**이고 APK 는 그대로다.
- 패치 올리기: `tools/publish.sh` (테스트 → 빌드 → 저장소로 복사 → 커밋) 뒤에 `git push`.
- APK 는 `android/` 가 바뀔 때만 GitHub Actions(`.github/workflows/apk.yml`)가 다시 만든다.
- 서명 키 `android/app/alpha.keystore` 는 공개 저장소에 든 알파 테스트용이다. 정식 배포 전에 GitHub Secrets 의 키로 바꿔야 하고, 그때는 앱을 지우고 다시 깔아야 한다.
- 앱의 저장은 기기 안(웹뷰 localStorage)에만 있다. 앱을 지우면 사라지므로, 지우기 전에 기록 > 저장에서 내보내기 코드를 받아 둔다.
