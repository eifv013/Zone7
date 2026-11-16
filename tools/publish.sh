#!/usr/bin/env bash
# 패치 올리기 — 테스트 → 빌드 → GitHub 저장소로 복사 → 커밋.  (push 는 따로 한다)
#
#   사용: tools/publish.sh [저장소 폴더]        기본값 ../zone7
#
# 저장소 구조
#   docs/      게임(= dist/pwa). GitHub Pages 가 이 폴더를 https://eifv013.github.io/Zone7/ 로 내보낸다. 앱과 폰 브라우저가 여기서 받는다.
#   android/   앱 껍데기. 바뀌면 GitHub Actions 가 APK 를 다시 만든다.
#   그 밖      게임 소스 전체.
# 테스트나 빌드가 실패하면 아무것도 복사하지 않고 멈춘다(깨진 판이 올라가지 않게).
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${1:-$SRC/../zone7}"
[ -d "$REPO/.git" ] || { echo "저장소가 아니다: $REPO" >&2; exit 1; }

cd "$SRC"
npm test >/dev/null || { echo "테스트 실패. 올리지 않는다." >&2; exit 1; }
node build.js >/dev/null
VERSION="$(node -p "require('./package.json').version")"
[ "$(node -p "require('./dist/pwa/version.json').version")" = "$VERSION" ] || { echo "빌드 버전이 맞지 않는다." >&2; exit 1; }

# .git 만 남기고 비운 뒤 다시 채운다(지운 파일이 저장소에 남지 않게).
find "$REPO" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
tar -C "$SRC" --exclude=./dist --exclude=./node_modules --exclude='__pycache__' --exclude=./android/.gradle --exclude=./android/app/build -cf - . | tar -C "$REPO" -xf -
mkdir -p "$REPO/docs" && cp -r "$SRC/dist/pwa/." "$REPO/docs/"
touch "$REPO/docs/.nojekyll"     # GitHub Pages 가 파일을 가공하지 않고 그대로 내보내게 한다

cd "$REPO"
git add -A
if git diff --cached --quiet; then echo "바뀐 것이 없다."; exit 0; fi
git commit -q -m "알파 $VERSION" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01LfK2SDRQiTYi6z9XC6XwSo"
echo "커밋: 알파 $VERSION ($(git rev-parse --short HEAD))"
