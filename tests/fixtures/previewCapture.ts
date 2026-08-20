/**
 * 실렌더 → self-contained 프리뷰 HTML 직렬화기 (design-sync 카드 생성용).
 *
 * **왜 있나:** 민구가 "백지에서 시작하지 말고, 각 상황에 실제로 출력되는 화면을 보면서 같이 고치자"고
 * 했다. 그래서 이 도구는 **개선안을 그리지 않는다** — 지금 앱이 실제로 그리는 DOM을 상태별로 떠서
 * 정적 카드로 굳힌다. 손으로 그린 목업(design-sync/screens/*.html, 2026-06)과 달리 여기 나오는
 * 픽셀은 전부 앱 코드의 산출물이다.
 *
 * **자기완결 계약 (Design 패널 CSP가 외부 호스트를 전부 막는다):**
 *  - 외부 CSS/폰트/이미지/스크립트 참조 0 — `assertSelfContained`가 산출물을 실제로 검사한다.
 *  - 실제로 로드됐던 웹폰트는 woff2를 **data: URI로 인라인**한다(대체가 아니라 원본 임베드).
 *  - `:root` 커스텀 프로퍼티는 이름 목록으로 실측해 리터럴 `:root{}` 블록으로 박는다. 미등록
 *    커스텀 프로퍼티는 getComputedStyle 열거로 안 잡혀서 이름을 알아야만 읽을 수 있다.
 *
 * **뷰포트 독립:** 앱은 폰트·여백을 `clamp(px, min(19vw,11vh), px) * var(--fit-hi)` 꼴로 잡는다.
 * 카드가 402×874가 아닌 패널에서 열리면 그 값들이 전부 달라진다 → 캡처 시점의 **계산값을 px로
 * 동결**해 어떤 크기의 뷰어에서도 실기기와 같은 타이포로 보이게 한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Response } from '@playwright/test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PREVIEW_DIR = path.join(REPO_ROOT, 'design-sync/_previews');
export const LIVE_DIR = path.join(PREVIEW_DIR, '_live');

/** 실기기 실측 뷰포트(민구 iPhone / iOS 18.7 / 402×874, v0.39.0 로그 분석 §0). */
export const DEVICE = { width: 402, height: 874 };

/** `:root`에 실제로 걸리는 커스텀 프로퍼티(src grep 산출 — global.css + TabBar가 발행). */
const ROOT_CUSTOM_PROPS = ['--sat', '--sab', '--sal', '--sar', '--nav-h'];

export interface CardMeta {
  /** 파일명(확장자 제외) 겸 카드 식별자. */
  name: string;
  /** Design 패널 카드 그룹. */
  group: '입력화면 현재상태' | '알람 카드' | '결함 재현';
  /** 화면 제목. */
  title: string;
  /** 연결된 개선요청 ID(들). */
  feedback: string;
  /** 이 카드가 무엇을 보여주는지 — 카드 상단 주석에 남는다. */
  why: string;
}

export interface Provenance {
  version: string;
  commit: string;
  fontNote: string;
}

// ── 웹폰트 수집 ────────────────────────────────────────────────────────────────

export interface FontCollector {
  /** 실제로 다운로드된 @font-face만 data: URI로 치환해 돌려준다. */
  embeddedCss(): Promise<{ css: string; embedded: number; dropped: number }>;
}

/** `page.goto` **전에** 붙여야 한다 — 폰트 응답을 흘려보내면 임베드할 바이트가 없다. */
export function collectWebFonts(page: Page): FontCollector {
  const sheets: string[] = [];
  const binaries = new Map<string, string>();
  const pending: Promise<unknown>[] = [];
  page.on('response', (res: Response) => {
    const url = res.url();
    if (url.includes('fonts.googleapis.com')) {
      pending.push(res.text().then((t) => sheets.push(t)).catch(() => undefined));
    } else if (url.includes('fonts.gstatic.com')) {
      pending.push(res.body().then((b) => binaries.set(url, b.toString('base64'))).catch(() => undefined));
    }
  });
  return {
    async embeddedCss() {
      await Promise.all(pending);
      // 🔴 중복 제거가 필수다. boot()는 goto + reload로 스타일시트를 두 번 이상 받고, 세션이 길면
      //    (§[4] 완료처럼) 더 받는다. 그대로 이으면 같은 폰트가 여러 번 인라인돼 카드가 배로 커진다
      //    (실측: 08-complete가 21블록·933KB, 나머지는 9블록·440KB).
      const seen = new Set<string>();
      const out: string[] = [];
      let dropped = 0;
      for (const sheet of sheets) {
        for (const block of sheet.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
          const urls = [...block.matchAll(/url\((https:\/\/[^)]+)\)/g)].map((m) => m[1]);
          // 다운로드되지 않은 서브셋(unicode-range 밖)은 통째로 버린다 — 남기면 외부 참조가 된다.
          if (urls.length === 0 || urls.some((u) => !binaries.has(u))) { dropped++; continue; }
          if (seen.has(block)) continue;
          seen.add(block);
          let filled = block;
          for (const u of urls) filled = filled.replace(u, `data:font/woff2;base64,${binaries.get(u)}`);
          out.push(filled);
        }
      }
      return { css: out.join('\n'), embedded: out.length, dropped };
    },
  };
}

// ── 직렬화 ────────────────────────────────────────────────────────────────────

export interface Serialized {
  rootHtml: string;
  appStyles: string;
  rootVars: [string, string][];
  frozenTypography: number;
  frozenBoxes: number;
  scrollNodes: number;
}

/** 라이브 DOM에서 `#root`를 떠 온다. **클론에만** 손대므로 이후 캡처가 오염되지 않는다. */
export async function serializeLive(page: Page): Promise<Serialized> {
  return page.evaluate((names: string[]) => {
    const root = document.getElementById('root');
    if (!root) throw new Error('#root를 찾지 못했다 — 앱이 마운트되지 않았다');

    const originals: HTMLElement[] = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
    const clone = root.cloneNode(true) as HTMLElement;
    const clones: HTMLElement[] = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))];
    if (originals.length !== clones.length) throw new Error('클론 노드 수가 원본과 다르다');

    // 뷰포트 단위가 섞인 인라인 스타일만 박스까지 동결한다(전면 동결은 flex/grid 해석을 바꿀 위험).
    const VIEWPORT_UNIT = /\d\s*(vh|vw|dvh|dvw|svh|svw|lvh|lvw)\b/;
    const BOX_PROPS = [
      'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
      'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      'row-gap', 'column-gap', 'border-radius',
    ];

    let frozenTypography = 0;
    let frozenBoxes = 0;
    let scrollNodes = 0;
    for (let i = 0; i < originals.length; i++) {
      const from = originals[i];
      const to = clones[i];
      const cs = getComputedStyle(from);
      // 타이포 동결 — `--fit-lo/--fit-hi`·vw/vh 파생 크기를 캡처 시점 px로 못박는다.
      to.style.setProperty('font-size', cs.fontSize);
      to.style.setProperty('line-height', cs.lineHeight);
      to.style.setProperty('letter-spacing', cs.letterSpacing);
      frozenTypography++;
      if (VIEWPORT_UNIT.test(from.getAttribute('style') ?? '')) {
        for (const prop of BOX_PROPS) {
          const value = cs.getPropertyValue(prop);
          if (value && value !== 'auto' && value !== 'normal') to.style.setProperty(prop, value);
        }
        frozenBoxes++;
      }
      // outerHTML은 스크롤 위치를 담지 못한다 — 칩존 오버플로 카드가 조용히 맨 위로 돌아간다.
      if (from.scrollTop > 0 || from.scrollLeft > 0) {
        to.setAttribute('data-ds-scroll', `${Math.round(from.scrollTop)},${Math.round(from.scrollLeft)}`);
        scrollNodes++;
      }
    }

    const rootStyle = getComputedStyle(document.documentElement);
    const rootVars = names
      .map((n): [string, string] => [n, rootStyle.getPropertyValue(n).trim()])
      .filter(([, v]) => v !== '');

    const appStyles = Array.from(document.querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('\n');

    return { rootHtml: clone.outerHTML, appStyles, rootVars, frozenTypography, frozenBoxes, scrollNodes };
  }, ROOT_CUSTOM_PROPS);
}

// ── HTML 조립 ─────────────────────────────────────────────────────────────────

function stageCss(vars: [string, string][]): string {
  const rootBlock = vars.map(([k, v]) => `  ${k}: ${v};`).join('\n');
  return `:root {
${rootBlock}
}
html, body { margin: 0; padding: 0; }
body {
  background: #050507;
  min-height: 100vh;
  display: flex; justify-content: center; align-items: flex-start;
  padding: 24px 12px;
}
/* 실기기 뷰포트를 그대로 재현하는 무대. transform이 position:fixed 자손(EdgeGlow·모달)의
   포함 블록이 되어, 카드가 뷰어 화면 전체로 새지 않는다. */
.ds-stage {
  position: relative; flex: 0 0 auto;
  width: ${DEVICE.width}px; height: ${DEVICE.height}px;
  overflow: hidden;
  background: #0E0F11; color: #F5F5F7;
  transform: translateZ(0);
  outline: 1px solid rgba(255,255,255,0.16);
}
/* 앱은 100dvh로 높이를 잡는다 — 뷰어 창 높이가 아니라 무대 높이에 묶어야 실기기와 같다. */
.ds-stage > #root { width: ${DEVICE.width}px; height: ${DEVICE.height}px; min-height: ${DEVICE.height}px; }
.ds-stage .mobile-app-shell { height: ${DEVICE.height}px; }`;
}

/** ⚠️ **남은 위험 하나** — 이 인라인 스크립트는 `file://`에서 실행이 확인됐지만(캡처 스펙의 마지막
 *  케이스), **Design 패널의 script CSP는 여기서 확인할 수 없다.** 패널이 인라인 스크립트를 막으면
 *  `09-chipzone-overflow`가 에러 없이 `01`과 같은 화면으로 퇴화한다(스크롤 0).
 *  그때의 대안: 스크립트를 버리고 스크롤 컨테이너의 **직계 자식들에 `transform: translateY(-Npx)`**
 *  를 걸어라 — transform은 레이아웃(flex-wrap 줄바꿈 위치)을 건드리지 않아 스크롤과 결과가 같고,
 *  스크립트 의존이 사라진다. 카드가 맨 위로 돌아가 보이면 이 항목을 먼저 의심할 것. */
const SCROLL_RESTORE = `<script>
/* outerHTML이 못 담는 scrollTop 복원 — 인라인이라 외부 호스트 요청이 없다(CSP 무관). */
(function () {
  var nodes = document.querySelectorAll('[data-ds-scroll]');
  for (var i = 0; i < nodes.length; i++) {
    var parts = (nodes[i].getAttribute('data-ds-scroll') || '0,0').split(',');
    nodes[i].scrollTop = parseFloat(parts[0]) || 0;
    nodes[i].scrollLeft = parseFloat(parts[1]) || 0;
  }
})();
</script>`;

export function buildPreviewHtml(meta: CardMeta, s: Serialized, fontCss: string, p: Provenance): string {
  return `<!-- @dsCard group="${meta.group}" -->
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Agri VoiceNote · ${meta.title}</title>
<!--
  ${meta.name} — ${meta.title}
  근거: Agri VoiceNote v${p.version} · commit ${p.commit} · 뷰포트 ${DEVICE.width}×${DEVICE.height}(민구 실기기 실측)
  개선요청: ${meta.feedback}
  무엇을 보는 카드인가: ${meta.why}
  출처: 손으로 그린 목업이 아니라 **라이브 DOM 직렬화**다 — tests/capture-current-states.spec.ts
  폰트: ${p.fontNote}
  동결: 타이포 ${s.frozenTypography}노드 / 뷰포트단위 박스 ${s.frozenBoxes}노드 / 스크롤 ${s.scrollNodes}노드
  애니메이션: 캡처 시 duration 0ms(테스트 목 주입) — 정지 프레임이다.
-->
<style>
${fontCss || '/* 임베드된 웹폰트 없음 — 라이브도 시스템 폴백으로 렌더됐다 */'}
</style>
<style>
${s.appStyles}
</style>
<style>
${stageCss(s.rootVars)}
</style>
</head>
<body>
<div class="ds-stage">
${s.rootHtml}
</div>
${SCROLL_RESTORE}
</body>
</html>
`;
}

/** 산출물이 정말 자기완결인지 검사한다 — "그럴 것이다"가 아니라 확인. */
export function assertSelfContained(html: string, name: string): void {
  const violations: string[] = [];
  if (/<link\b/i.test(html)) violations.push('<link> 태그');
  if (/<img\b/i.test(html)) violations.push('<img> 태그');
  if (/(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i.test(html)) violations.push('외부 src/href');
  if (/url\(\s*["']?(?!data:)(?:https?:)?\/\//i.test(html)) violations.push('CSS url()의 외부 참조');
  if (/@import/i.test(html)) violations.push('@import');
  if (violations.length > 0) {
    throw new Error(`${name}: 프리뷰가 자기완결이 아니다 — ${violations.join(', ')}`);
  }
}

export function writePreview(name: string, html: string): string {
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  const file = path.join(PREVIEW_DIR, `${name}.html`);
  fs.writeFileSync(file, html, 'utf8');
  return file;
}
