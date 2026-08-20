// 🔴 v0.50 개명 — **반드시 첫 import.** 구 네임스페이스 localStorage 복사가 스토어 모듈
// 평가(= zustand 동기 하이드레이션)보다 먼저 돌아야 한다. namespaceBoot.ts 머리주석 참조.
import './lib/namespaceBoot';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';
import { initPwaUpdate } from './lib/pwaUpdate';
import { logger } from './lib/logger';

// v0.18.0 1f — PWA 수동 SW 등록 + 능동 업데이트 체크(비강제 프롬프트). vite.config는
// injectRegister:null이라 여기서 한 번만 등록한다(이중 등록 방지). 강제 리로드는 하지 않는다.
initPwaUpdate();

// v0.33.0 safe-area 실측 텔레메트리 — 부팅 시 1회, global.css :root의 --sat/--sab(SSOT,
// env(safe-area-inset-*) 해석값)를 getComputedStyle로 판독해 기록한다. 아이폰 17 standalone에서
// 실제 inset이 얼마인지(예: top=62/bottom=34 가정 검증)와 display-mode를 다음 실기기 로그가
// 정량 대조하는 근거. TabBar minHeight:88 하향 등 레이아웃 결정은 이 실측 후에 한다.
function logSafeAreaInsets() {
  try {
    const cs = getComputedStyle(document.documentElement);
    const px = (name: string) => {
      const v = parseFloat(cs.getPropertyValue(name));
      return Number.isFinite(v) ? v : 0;
    };
    // iOS 홈화면 설치형은 display-mode:standalone(구형 iOS는 navigator.standalone만 true).
    const displayMode = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true
      ? 'standalone'
      : 'browser';
    logger.log({
      type: 'app',
      extra: `sa_insets:top=${px('--sat')},bottom=${px('--sab')},left=${px('--sal')},right=${px('--sar')},standalone=${displayMode}`,
    });
  } catch { /* 계측 실패는 무해 — 부팅을 막지 않는다 */ }
}
// 빌드 배포에선 CSS가 <link>로 로드되므로, 스타일 적용 이후에 판독하도록 load 이후로 미룬다.
if (document.readyState === 'complete') logSafeAreaInsets();
else window.addEventListener('load', logSafeAreaInsets, { once: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
