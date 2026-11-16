package io.github.eifv013.zone7;

import java.net.URI;

/**
 * 주소 판별 — "이 주소를 앱 안에서 열어도 되는가".
 *
 * 안드로이드 클래스를 쓰지 않는 순수 자바라서 PC 의 단위 테스트로 검증할 수 있다(LinksTest).
 * 게임 주소(같은 서버, 게임 폴더 아래)만 앱 안에서 열고, 나머지는 전부 바깥 브라우저로 보낸다.
 * 앱 안의 웹뷰가 엉뚱한 사이트를 띄우는 일을 막기 위한 것이다.
 */
final class Links {
    private Links() {}

    /**
     * url 이 gameUrl 과 같은 서버의 게임 폴더 아래인가.
     * 읽을 수 없는 주소, https 가 아닌 주소, 다른 서버는 모두 false 다(예외를 던지지 않는다).
     */
    static boolean isGame(String url, String gameUrl) {
        if (url == null || gameUrl == null) return false;
        try {
            URI u = new URI(url.trim()), g = new URI(gameUrl.trim());
            if (!"https".equalsIgnoreCase(u.getScheme()) || !"https".equalsIgnoreCase(g.getScheme())) return false;
            if (u.getHost() == null || g.getHost() == null || !u.getHost().equalsIgnoreCase(g.getHost())) return false;
            if (u.getPort() != g.getPort()) return false;
            String base = folder(g.getPath()).toLowerCase();      // GitHub Pages 는 저장소 이름의 대소문자를 가리지 않는다
            String path = (u.getPath() == null || u.getPath().isEmpty() ? "/" : u.getPath()).toLowerCase();
            // "/Zone7" 처럼 끝 빗금이 빠진 주소도 게임으로 본다. "/Zone7evil/" 은 아니다.
            return path.startsWith(base) || (path + "/").equals(base);
        } catch (Exception e) {
            return false;
        }
    }

    /** 경로를 "빗금으로 끝나는 폴더"로 맞춘다. "/Zone7/index.html" → "/Zone7/", "" → "/" */
    private static String folder(String path) {
        if (path == null || path.isEmpty()) return "/";
        return path.endsWith("/") ? path : path.substring(0, path.lastIndexOf('/') + 1);
    }
}
