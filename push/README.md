# 7구역 알림 서버

아이폰(홈 화면에 추가한 웹 앱)에 알림을 보내기 위한 Cloudflare Worker 입니다. 안드로이드 앱은 이 서버를 쓰지 않습니다.

- 무엇을 하는지, 어떻게 생겼는지는 `worker.js` 맨 위에 적혀 있습니다.
- 서버에는 알림 주소와 알림을 보낼 시각만 저장됩니다. 게임 진행이나 이름은 올라오지 않습니다.
- 열쇠(VAPID)는 서버가 처음 쓸 때 스스로 만들어 보관합니다. 따로 넣어 줄 값이 없습니다.

## 올리는 법(Cloudflare 화면에서)

1. Workers & Pages 에서 새로 만들기를 누르고, GitHub 저장소 `eifv013/Zone7` 을 연결합니다.
2. 프로젝트 이름은 `zone7-push` (wrangler.toml 의 name 과 같아야 합니다).
3. 고급 설정의 경로(Root directory / Path)에 `push` 를 적습니다.
4. 배포 명령은 기본값 `npx wrangler deploy` 그대로 둡니다. 빌드 명령은 비워 둡니다.
5. 배포가 끝나면 `https://zone7-push.<계정>.workers.dev` 주소가 나옵니다. 이 주소를 게임의 `src/ui.js` 에 있는 `PUSH_SERVER` 에 넣습니다.

## 확인

- 주소를 브라우저로 열어 `{"ok":true,"name":"zone7-push"}` 가 보이면 살아 있는 것입니다.
- `주소/key` 를 열면 공개 키가 보입니다.

## 테스트

`npm test` 가 `test/push.test.mjs` 를 함께 돌립니다(주소 검사, 시각 다듬기, 서명). 실제 푸시 발송과 알람은 배포한 뒤 폰으로 확인해야 합니다.
