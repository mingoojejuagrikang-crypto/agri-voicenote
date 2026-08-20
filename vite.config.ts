import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

const BUILD_DATE = (() => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
})();

/** 🔴 v0.46.0 (민구 지시 08-06) — **테스트 배포본임을 빌드에 새긴다.**
 *
 *  ## 왜 필요한가 — 08-06에 이것 때문에 회차 하나를 태울 뻔했다
 *  프리뷰는 **bump를 안 한다**(게이트 통과 후에만 올린다). 그런데 프로덕션도 같은 `0.45.0`이라
 *  **두 빌드의 `appVersion` 문자열이 완전히 같았다.** 민구 제보 2건이 어느 빌드에서 왔는지
 *  가르려고 `curl`로 라이브 번들을 받아 **회차 전용 문자열을 grep**해야 했다
 *  (`테이블 재생성`·`data-chip-sweep`). 로그만으로는 판정이 불가능했다.
 *  👉 이 플래그가 **화면과 로그 양쪽에** 표식을 넣어 그 절차를 통째로 없앤다.
 *
 *  ⚠️ `VitePWA.disable`과 **같은 식**을 쓴다 — 갈라지면 "SW는 껐는데 표식은 없는" 빌드가 생긴다.
 *  ⚠️ `process`를 직접 참조하지 않는다(이 파일은 `@types/node` 없이 타입 검사된다 — 아래 주석 참조). */
const IS_PREVIEW_BUILD =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.PREVIEW_BUILD === '1';

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(BUILD_DATE),
    __PREVIEW_BUILD__: JSON.stringify(IS_PREVIEW_BUILD),
  },
  plugins: [
    react(),
    VitePWA({
      // 🔴 v0.50 (2026-08-19) — **프리뷰에서도 서비스워커를 켠다.** 종전 `disable: IS_PREVIEW_BUILD`를
      //   제거했다. **되돌리기 전에 아래를 읽어라** — 껐던 이유 3개가 전부 무효가 됐다.
      //
      //   | v0.46.0에 껐던 이유 | 2026-08-19 판정 |
      //   |---|---|
      //   | ① 프로덕션 SW(scope `/survey-011/`)가 테스트본을 가로챌 수 있다 | 🟢 **해소** — 프리뷰는
      //   |   | `/survey-011-preview/`이고 SW scope 매칭은 **문자열 접두**다. `/survey-011-preview/`는
      //   |   | `/survey-011/`로 **시작하지 않는다**(하이픈 ≠ 슬래시) → 양방향 비침범 |
      //   | ② 캐시가 없으니 새로고침만으로 최신 | 🔴 **전제 붕괴** — standalone(홈 화면 설치형)에는
      //   |   | **새로고침 UI가 없다.** 민구 제보: *"프리뷰앱은 새로 고침을 할 수가 없어."* |
      //   | ③ 테스트본이 두 번째 PWA로 설치되지 않는다 | 🔴 **무효** — 이미 설치해서 쓰고 있다.
      //   |   | 그리고 SW는 iOS 설치 요건이 아니다(Safari 26.0: *"zero requirements for installability"*) |
      //
      //   👉 SW를 끈 결과는 **갱신 경로 0개**였다: `pwaUpdate`가 `registerSW`에 걸려 있어
      //      `UpdateBanner`도 `UpdateControl`도 영원히 침묵했다(민구: *"08-14에 만든 버전이야"*).
      //
      //   🔴 **되살아나는 위험을 정직하게 적는다**: SW를 켜면 프리뷰에도 캐시가 생겨
      //      **「고쳤는데 안 고쳐진」 오판**(v0.44.1 유형)이 돌아올 수 있다.
      //      **그래서 이 변경은 단독으로 의미가 없다** — `liveVersionProbe`(배포본 index.html과
      //      번들 해시를 **직접 대조**)와 **한 세트**다. SW가 통째로 침묵해도 그 프로브는 사실을
      //      말한다. 한쪽만 되돌리지 마라.
      //
      //   ⚠️ `IS_PREVIEW_BUILD` 자체는 **그대로 둔다** — 버전 배지·로그 `appVersion` 접미사가 쓴다.
      //      아래 `process.env` 주석도 그 상수에 대한 것이라 유효하다.
      //   ⚠️ `process.env`를 직접 쓰지 않는다 — 이 파일은 `@types/node` 없이 타입 검사되므로
      //      `Cannot find name 'process'`로 빌드가 죽는다(실측). `--mode`로 가르는 길도 있으나
      //      mode는 빌드 최적화 경로에 영향을 줄 수 있어 **테스트본과 프로덕션의 번들이 갈린다.**
      //      그래서 mode는 건드리지 않고 환경변수만 타입 안전하게 읽는다.
      // v0.18.0 1f — 비강제(프롬프트) 업데이트. autoUpdate의 silent 강제 리로드를 제거하고
      // main.tsx의 registerSW(onNeedRefresh/onRegisteredSW)로 수동 등록한다. injectRegister:null로
      // 플러그인 자동 주입을 끄고(이중 등록 방지) main에서 한 번만 등록한다. iOS standalone에서
      // 새 버전을 silent 리로드 없이 "새 버전" 배너로 안내(현장 음성 측정 중 강제 리로드 금지).
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['icon.svg', 'icon-192.svg', 'icon-512.svg', 'maskable-icon-512.svg'],
      manifest: {
        // v0.50 개명 (민구 확정 08-20) — short_name은 iOS 홈화면 12자 잘림 회피로 'VoiceNote'
        name: 'Agri VoiceNote',
        short_name: 'VoiceNote',
        description: '음성 입력 기반 현장 측정 기록 PWA',
        lang: 'ko',
        theme_color: '#0E0F11',
        background_color: '#0E0F11',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
          { src: 'maskable-icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cdn-fonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
});
