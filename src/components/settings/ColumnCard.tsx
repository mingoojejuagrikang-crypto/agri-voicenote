import { T, TYPE_LABELS, TYPE_COLORS } from '../../tokens';
import { I } from '../icons';
import type { Column, DataType } from '../../types';
import { isTrendEligible } from '../../lib/columnFlags';
import { MiniInput } from './MiniInput';
import { SegmentToggle, ROW_LABEL_STYLE } from './SegmentToggle';
import { AutoDetail } from './AutoDetail';
import { OptionsPanel } from './OptionsPanel';

const TYPE_ORDER: DataType[] = ['date', 'text', 'int', 'float', 'options'];

export function ColumnCard({
  col,
  index,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  col: Column;
  index: number;
  onChange: (c: Column) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const typ = TYPE_COLORS[col.type];
  return (
    <div
      data-testid={`col-card-${col.id}`}
      style={{
        background: T.card,
        borderRadius: 14,
        border: `1px solid ${T.line}`,
        padding: '10px 12px 10px 4px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        flexShrink: 0,
        transition: 'border 150ms',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            width: 32,
            alignItems: 'center',
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
            disabled={isFirst}
            style={{
              width: 28, height: 24, borderRadius: 6,
              border: `1px solid ${isFirst ? 'transparent' : T.line}`,
              background: isFirst ? 'transparent' : 'rgba(255,255,255,0.06)',
              color: isFirst ? T.textMute : T.text,
              fontSize: 12, fontWeight: 700,
              cursor: isFirst ? 'default' : 'pointer',
              opacity: isFirst ? 0.25 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'opacity 150ms, background 150ms',
            }}
          >▲</button>
          <button
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
            disabled={isLast}
            style={{
              width: 28, height: 24, borderRadius: 6,
              border: `1px solid ${isLast ? 'transparent' : T.line}`,
              background: isLast ? 'transparent' : 'rgba(255,255,255,0.06)',
              color: isLast ? T.textMute : T.text,
              fontSize: 12, fontWeight: 700,
              cursor: isLast ? 'default' : 'pointer',
              opacity: isLast ? 0.25 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'opacity 150ms, background 150ms',
            }}
          >▼</button>
        </div>
        <input
          value={col.name}
          onChange={(e) => onChange({ ...col, name: e.target.value })}
          style={{
            flex: 1, background: 'transparent', border: 'none',
            color: T.text, fontSize: 18, fontWeight: 700, outline: 'none',
            letterSpacing: -0.2, padding: '2px 2px', minWidth: 0,
          }}
        />
        <span style={{ fontSize: 12, fontWeight: 700, color: T.textMute, letterSpacing: 0.2 }}>
          데이터 타입
        </span>
        <button
          data-testid={`type-btn-${col.id}`}
          style={{
            height: 32, borderRadius: 999, padding: '0 12px',
            border: 'none', background: typ.bg, color: typ.fg,
            fontSize: 14, fontWeight: 700, letterSpacing: 0.1,
            display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
          }}
          title="탭하여 데이터형 변경"
          onClick={() => {
            const next = TYPE_ORDER[(TYPE_ORDER.indexOf(col.type) + 1) % TYPE_ORDER.length];
            // When switching to options, init shape
            const auto =
              next === 'options'
                ? { kind: 'options' as const, available: [], selected: [] }
                : { kind: 'fixed' as const, value: '' };
            onChange({ ...col, type: next, auto });
          }}
        >
          {TYPE_LABELS[col.type]} {I.chevDown(12, typ.fg)}
        </button>
        <button
          onClick={onRemove}
          style={{
            width: 36, height: 36, borderRadius: 10,
            border: 'none', background: 'rgba(255,23,68,0.10)',
            color: T.red, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="항목 삭제"
        >
          {I.trash(16, T.red)}
        </button>
      </div>

      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 32,
          minHeight: 36, flexWrap: 'wrap',
        }}
      >
        <SegmentToggle
          label="입력방식"
          value={col.input}
          options={[
            { id: 'auto', label: '자동' },
            { id: 'voice', label: '음성' },
            { id: 'touch', label: '수동' },
          ]}
          onChange={(v) => {
            const updates: Partial<typeof col> = { input: v };
            if (v === 'voice') updates.ttsAnnounce = true;
            if (v === 'touch') updates.ttsAnnounce = false;
            // 🔴 v0.46.0 — **`auto` 설정을 지우지 않는다.** 08-06에 민구 계약(*"입력방식이 수동이고,
            //    순차가 아니고, 어떤값이 올지는 데이터형 외의 정의는 없어야 해"*)을 근거로 여기서
            //    `auto`를 비우는 변경을 넣었다가 **되돌렸다** — `tests/v0460-fb-a-manual-column.spec.ts`가
            //    *"'자동'으로 되돌릴 때 설정을 잃지 않게 하는 계약. 합성에서만 빼고 데이터는 보존한다"*
            //    를 이미 재고 있고, 그 계약이 실용적으로 옳다(되돌리면 목록이 그대로 살아난다).
            //    🔑 민구 계약의 「값」 축은 **다른 층에서 이미 충족된다**: 값 합성은
            //    `isUserInputColumn`이 막고(FB-A), 행 자릿수는 `isCycling`이 막는다(L2-2 처방).
            //    즉 `auto`는 **보관된 데이터**이고 수동인 동안 값 생성에 쓰이지 않는다.
            //    ⏭ 남은 논점(민구 확인 대기): 수동 칸에 선택지 편집 UI가 보이는 것이 혼란스러운가.
            onChange({ ...col, ...updates });
          }}
        />
        <SegmentToggle
          label="음성확인"
          value={col.ttsAnnounce ? 'on' : 'off'}
          options={[
            { id: 'on', label: '유' },
            { id: 'off', label: '무' },
          ]}
          onChange={(v) => {
            if (col.input === 'voice') return;
            onChange({ ...col, ttsAnnounce: v === 'on' });
          }}
          disabled={col.input === 'voice'}
        />
        {/* v0.8.0 — 샘플키 토글은 조회탭으로 이전(WS4). 자동 유추·effectiveSampleKey 로직은 유지. */}
        {/* v0.8.0 — 이상치 알람(의미 반전: 증가=커지면 알람, 감소=작아지면 알람). 적격(사용자 입력
            숫자) 컬럼만 노출; 부적격 전환 시 store가 trendRule/pctThreshold 클리어. */}
        {isTrendEligible(col) && (
          <>
            <SegmentToggle
              label="추세 알람"
              testId={`trend-rule-${col.id}`}
              value={col.trendRule ?? 'off'}
              options={[
                { id: 'off', label: '없음' },
                { id: 'increase', label: '증가' },
                { id: 'decrease', label: '감소' },
              ]}
              onChange={(v) =>
                onChange({ ...col, trendRule: v === 'off' ? undefined : v })
              }
            />
            {/* v0.23.0 설정탭#4(Vance) — 인라인 추세 설명을 카드 `?` 도움말 팝업(COLUMN_HELP)으로
                이전. 화면 밀도를 낮추고(장갑·소음 현장 가독), 설명은 필요할 때만 팝업으로 본다. */}
            {/* v0.8.0 — 변동률 % 임계값(방향 무관). 빈 값=undefined(off), 값 입력 시에만 활성. */}
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: T.textDim }}
            >
              이상값 범위
              {/* v0.23.0 설정탭#1(Vance) — 단위 "%"를 입력칸 옆에 **항상** 보이게(placeholder만으론
                  값 입력 시 사라져 단위가 안 보였다). 입력칸과 % 접미를 한 묶음으로 감싸 정렬 유지. */}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  data-testid={`pct-threshold-${col.id}`}
                  placeholder="선택"
                  value={col.pctThreshold ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    const n = raw === '' ? undefined : Number(raw);
                    onChange({
                      ...col,
                      pctThreshold: n === undefined || !Number.isFinite(n) ? undefined : n,
                    });
                  }}
                  style={{
                    width: 76, height: 32, borderRadius: 8,
                    background: T.inputBg, border: `1px solid ${T.line}`,
                    color: T.text, fontSize: 14, fontWeight: 600,
                    padding: '0 8px', outline: 'none',
                  }}
                />
                <span
                  data-testid={`pct-unit-${col.id}`}
                  aria-hidden
                  style={{ fontSize: 14, fontWeight: 800, color: T.textDim }}
                >
                  %
                </span>
              </span>
            </label>
          </>
        )}
      </div>

      {/* v0.21.0 설정탭#1 — 단일/순차 선택 일원화. 자동입력+정수 컬럼에서 "음성확인" 행 아래줄에
          칩 하이라이트(SegmentToggle, 선택된 칩 강조)로 단일값/순차값을 고른다. 순차값 선택 시
          그 자리(아래)에 from~to 인라인 입력을 노출. updateColumn(settingsStore)의 isCycling 전이
          시 ttsAnnounce 자동 토글을 보존하려, onChange는 auto.kind만 바꾸고 ttsAnnounce는 건드리지
          않는다(fixed↔seq 전이를 store가 감지해 음성확인을 자동 조정). int 전용(spec). */}
      {col.input === 'auto' && col.type === 'int' && (col.auto.kind === 'seq' || col.auto.kind === 'fixed') && (
        <div
          data-testid={`seq-fixed-${col.id}`}
          style={{ paddingLeft: 32, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
        >
          <SegmentToggle
            label="생성방식"
            value={col.auto.kind === 'seq' ? 'seq' : 'fixed'}
            options={[
              { id: 'fixed', label: '단일값' },
              { id: 'seq', label: '순차값' },
            ]}
            onChange={(v) => {
              if (v === 'seq') {
                if (col.auto.kind === 'seq') return; // 이미 순차 — no-op
                onChange({ ...col, auto: { kind: 'seq', from: 1, to: 50 } });
              } else {
                if (col.auto.kind === 'fixed') return; // 이미 단일 — no-op
                onChange({ ...col, auto: { kind: 'fixed', value: '' } });
              }
            }}
          />
          {col.auto.kind === 'seq' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, color: T.textMute }}>시작</span>
              <MiniInput
                value={col.auto.from}
                onChange={(v) =>
                  onChange({
                    ...col,
                    auto: { kind: 'seq', from: +v || 0, to: col.auto.kind === 'seq' ? col.auto.to : 0 },
                  })
                }
              />
              <span style={{ color: T.textMute, fontSize: 14 }}>~</span>
              <span style={{ fontSize: 13, color: T.textMute }}>끝</span>
              <MiniInput
                value={col.auto.to}
                onChange={(v) =>
                  onChange({
                    ...col,
                    auto: { kind: 'seq', from: col.auto.kind === 'seq' ? col.auto.from : 0, to: +v || 0 },
                  })
                }
              />
            </div>
          )}
        </div>
      )}

      {/* v0.23.0 설정탭#2(Vance) — 자동값 행에 선두 라벨 "입력값"을 추가해 입력방식·음성확인 행과
          정렬한다(이전엔 "단일값" span/무라벨로 3행이 어긋남). int+seq는 생성방식 칩 행에서 from~to를
          이미 보이고 AutoDetail이 null을 반환하므로 이 행 자체를 그린다(라벨만 남아 빈 행이 되지 않게
          AutoDetail이 콘텐츠를 갖는 분기에서만 노출 — int+seq는 건너뜀). */}
      {col.input === 'auto' && col.type !== 'options' && !(col.type === 'int' && col.auto.kind === 'seq') && (
        <div
          data-testid={`auto-value-row-${col.id}`}
          style={{ paddingLeft: 32, display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, flexWrap: 'wrap' }}
        >
          <span style={ROW_LABEL_STYLE}>입력값</span>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
            <AutoDetail col={col} onChange={onChange} />
          </div>
        </div>
      )}

      {col.type === 'options' && (
        <div style={{ paddingLeft: 32 }}>
          <OptionsPanel col={col} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

// ─── TTS voice selector ────────────────────────────────────────
