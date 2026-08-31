import { ModalBase, OVERLAY_DIM_SOFT } from '../ModalBase';

/** 데이터탭 공용 backdrop — ModalBase 셸(Stage 2 통합)에 데이터탭 프리셋(dim 0.55+blur+fade-up)만
 *  고정한 thin 래퍼. v0.33.0 safe-area 계약(패딩 max(16px, var(--sa*)))은 ModalBase가 소유. */
export function Backdrop({ children, onClose, bottomInset }: {
  children: React.ReactNode;
  onClose: () => void;
  /** 🔴 v0.51 P0-1 (민구 확정 08-31 — Q9 ②) — **「세션 상세만 나비를 남긴다.」**
   *
   *  이 래퍼 하나가 데이터탭 모달 **7종**을 전부 감싼다(`ExportModal`·`ExportDoneModal`·
   *  `RecoverModal`·`SessionDetailModal`·`SyncSessionModal`·`ConfirmModal`·`FailureModal`).
   *  그래서 여기에 값을 **박으면 7개가 한꺼번에 바뀐다** — 대부분은 내보내기·복원·삭제 확인이라
   *  이탈이 곧 사고이고, **막는 쪽이 맞다.**
   *  👉 그래서 **opt-in prop**이다. 기본값 `undefined` = 종전 동작(나비를 덮는다) 그대로이고,
   *  넘기는 것은 `SessionDetailModal` **하나뿐**이다(보기 전용).
   *  🔴 새 소비자를 추가하려면 *"이 모달을 열어 둔 채 탭을 옮겨도 잃을 것이 없는가"* 에
   *  답하고 넣어라. 편해 보인다고 여기 기본값으로 올리지 마라 — 그 순간 7개가 같이 열린다. */
  bottomInset?: string;
}) {
  return (
    <ModalBase
      onClose={onClose} dim={OVERLAY_DIM_SOFT} blur animation="fade-up 200ms ease-out"
      bottomInset={bottomInset}
    >
      {children}
    </ModalBase>
  );
}
