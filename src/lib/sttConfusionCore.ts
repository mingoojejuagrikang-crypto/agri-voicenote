/**
 * v0.51.1 R6 — 화자별 STT 혼동표 **핵심(순수)**: 정정 쌍 정렬 · 표 갱신 · 후보 생성 · 판정.
 *
 * 🔴 **이 파일은 잎(leaf)이다 — import가 없다.** 이유는 셋이다:
 *  ① 런타임(값 커밋 착지)·기기 프로필 갱신·오프라인 표 생성 스크립트(`scripts/stt-confusion-build.mjs`)·
 *     시뮬레이션이 **같은 정렬·같은 후보 규칙**을 써야 한다(문구·값의 조립부는 하나 —
 *     ENGINEERING-GUARDRAILS [UI-ALERT-1]의 데이터 판).
 *  ② 스크립트는 Node 22 타입 스트리핑(`node script.mjs` → `import '../src/lib/sttConfusionCore.ts'`)으로
 *     이 파일을 **그대로** 읽는다. 그래서 **소거 가능한 문법만** 쓴다(enum·namespace·매개변수 프로퍼티 금지)
 *     · 다른 앱 모듈을 import하지 않는다(`koreanNum`·`logger`·`idb` 전부 금지).
 *  ③ 파서(`koreanNum.ts`)를 **바꾸지 않는다** — 이 모듈은 파싱 **뒤**에 「확인 질문」만 얹는다.
 *     정수부 추측 금지 원칙·W4(salvage 비채택)·alt 스킵 규칙은 불변이다.
 *
 * 표의 방향은 **`heard -> said`** 다: `conf[x][y]` = 「STT가 x로 들었는데 사용자가 y라고 말했다」의 횟수,
 * `seen[x]` = 「x로 들린 채 커밋된 자리」의 총수(맞은 것 + 틀린 것 + 「첫째」 부정 사례). 그래서
 * P(said=y | heard=x) = conf[x][y] / seen[x] 이고, 들린 값이 맞았을 확률 = (seen − Σconf) / seen 다.
 *
 * 문맥(`DigitCtx`) = `L<정수부 자릿수>P<자리>` — 09-02 실측에서 혼동은 거의 전부 **정수부 1자리 값의
 * 첫 자리**(1→8 ×8 · 3→7 ×5 · 1→7 ×4)였고, 전역으로 접으면 「1」이 들린 335자리 중 8건이라 2%로 묻힌다.
 * 컬럼 축(`byColumn`, 이름 정규화 키)은 그 위의 스코프다 — 당도의 「1.x」는 11/11 오답인데 적정의
 * 「3.x」는 42/46 정답이라 같은 자리도 컬럼이 갈라야 한다. 소수부 자리(`F<자리>`)는 **기록만** 하고
 * 후보를 만들지 않는다(09-02 실측 각 1건 — 지지수 미달·위양성 위험).
 */

type DigitCtx = string;

/** 한 문맥의 자리 혼동 표 — `heard 숫자 → said 숫자 → 횟수` + 분모. */
interface DigitScope {
  seen: Record<string, number>;
  conf: Record<string, Record<string, number>>;
}

/** 「점」 소실 규칙 4종. `as3`=「점」이 3으로 전사(738→7.8) · `as00`=00으로(7007→7.7) · `as0`=0으로 ·
 *  `insert`=점만 빠짐(837→83.7). 09-02 실측: as3 7 · as00 3 · as0 0 · insert 0 — 지지수 0인 규칙은
 *  표에 자리만 있고 **발동하지 않는다**(지지수 게이트). */
export type DecimalLossRule = 'as3' | 'as00' | 'as0' | 'insert';
export const DECIMAL_LOSS_RULES: DecimalLossRule[] = ['as3', 'as00', 'as0', 'insert'];

interface DecimalLossScope {
  /** 「점」 소실 후보가 성립할 수 있는 형상(소수 컬럼 + 정수로 들림 + 자릿수 ≥ decimals+1)으로 커밋된 수. */
  seen: number;
  rules: Record<DecimalLossRule, number>;
}

interface ColumnScope {
  ctx: Record<DigitCtx, DigitScope>;
  decimalLoss: DecimalLossScope;
}

export interface ConfusionTable {
  direction: 'heard->said';
  ctx: Record<DigitCtx, DigitScope>;
  decimalLoss: DecimalLossScope;
  byColumn: Record<string, ColumnScope>;
}

export type Observation =
  | { kind: 'digit'; ctx: DigitCtx; heard: string; said: string }
  | { kind: 'decimalLoss'; rule: DecimalLossRule }
  | { kind: 'other'; tag: string };

export interface CandidateParams {
  /** 🔴 **컬럼 증거 하한**(r2 P2-1·P2-2): 어떤 표의 **컬럼 스코프**에서 그 숫자(또는 「점」 소실 형상)가 이만큼 이상
   *  들렸는데 해당 치환의 지지수가 kSupport에 못 미치면, 그 컬럼에선 그 규칙을 **만들지 않는다**(더 뒤 스코프·표로
   *  내려가지 않는다). 「첫째」 부정 사례가 프로필 컬럼 스코프의 seen을 올리므로 새 사용자(프로필 비어 전역 폴백)도
   *  kSeen번 뒤엔 그 컬럼에서 멎는다 — 이것이 출하 구성에서 작동하는 유일한 억제다. */
  kSeen: number;
  /** 치환 규칙 하나의 지지수 하한(브리핑 기본 3). */
  kSupport: number;
  /** P(said=y | heard=x) 하한. */
  theta: number;
  /** 후보 확률이 들린 값 확률의 이 비율 이상일 때만 묻는다. */
  rho: number;
  /** TTS 길이 원칙 — 후보는 최대 이 수만 묻는다. */
  maxCands: number;
}

export const DEFAULT_CANDIDATE_PARAMS: CandidateParams = {
  kSeen: 3, kSupport: 3, theta: 0.15, rho: 0.5, maxCands: 2,
};

export interface Candidate {
  value: string;
  /** P(said=value | heard) — 가중 전. */
  p: number;
  /** 같은 스코프에서 들린 값이 맞았을 확률. */
  pHeard: number;
  /** 규칙 식별자 — `L1P0:1>8` · `dec:as3`. 계측(`stt_confusion_hint` rule=)에 그대로 실린다. */
  rule: string;
  /** 어느 스코프가 답했나 — `col`(컬럼) / `ctx`(문맥) + 표 순번(0=화자 프로필, 1=전역 …). */
  scope: string;
}

export interface Decision {
  ask: boolean;
  cands: Candidate[];
  /** ask=false일 때의 이유(계측·시뮬 판독용). */
  reason: 'none' | 'below_theta' | 'below_rho' | 'ask';
}

// ─── 표 생성·갱신 ───────────────────────────────────────────────────────────

export function emptyDecimalLoss(): DecimalLossScope {
  return { seen: 0, rules: { as3: 0, as00: 0, as0: 0, insert: 0 } };
}

export function emptyTable(): ConfusionTable {
  return { direction: 'heard->said', ctx: {}, decimalLoss: emptyDecimalLoss(), byColumn: {} };
}

/** 컬럼 키 — 시트마다 다른 id 대신 **이름**으로 잇는다. 괄호 단위(`종경(mm)`)·공백을 벗긴다. */
export function colKey(name: string): string {
  return name.replace(/[（(][^)）]*[)）]/g, '').replace(/\s+/g, '').trim().toLowerCase() || '?';
}

export function isNumericString(s: string | null | undefined): s is string {
  return typeof s === 'string' && /^-?\d+(\.\d+)?$/.test(s);
}

function digitsOf(s: string): string {
  return s.replace(/[^0-9]/g, '');
}

/** 「점」 소실 후보가 성립할 수 있는 형상인가. */
export function decimalLossEligible(heard: string, decimals: number, colType: string): boolean {
  if (colType !== 'float' || decimals < 1) return false;
  if (!isNumericString(heard) || heard.includes('.')) return false;
  // 자릿수 하한 = max(decimals + 1, 3): 「점」이 빠지거나 3/00/0으로 전사된 형상은 최소 정수부 1자리 + 소수부라
  // decimals+1 자리이고, 2자리 정수(당도 10 · 횡경 50)는 정상값이므로 분모에 넣지 않는다(3자리부터). 넣으면 분모가
  // 정상값으로 부풀어 「738」이 억제된다(09-02 실측: 3자리 이상 정수 커밋은 소수 컬럼에서 전부 오답).
  return digitsOf(heard).length >= Math.max(decimals + 1, 3);
}

function scopeFor(table: ConfusionTable, col: string | null): { ctx: Record<DigitCtx, DigitScope>; decimalLoss: DecimalLossScope } {
  if (col === null) return table;
  if (!table.byColumn[col]) table.byColumn[col] = { ctx: {}, decimalLoss: emptyDecimalLoss() };
  return table.byColumn[col];
}

function digitScope(holder: { ctx: Record<DigitCtx, DigitScope> }, ctx: DigitCtx): DigitScope {
  if (!holder.ctx[ctx]) holder.ctx[ctx] = { seen: {}, conf: {} };
  return holder.ctx[ctx];
}

/** 정수부 각 자리의 (문맥, 숫자) 목록. 소수부는 `F<자리>`로 따로 돌려준다. */
export function digitContexts(value: string): { ctx: DigitCtx; digit: string; pos: number; part: 'int' | 'frac' }[] {
  const [ip, fp = ''] = value.replace('-', '').split('.');
  const out: { ctx: DigitCtx; digit: string; pos: number; part: 'int' | 'frac' }[] = [];
  for (let i = 0; i < ip.length; i++) out.push({ ctx: `L${ip.length}P${i}`, digit: ip[i], pos: i, part: 'int' });
  for (let i = 0; i < fp.length; i++) out.push({ ctx: `F${i}`, digit: fp[i], pos: i, part: 'frac' });
  return out;
}

/** 음성 커밋 1건 — **분모**를 올린다(맞았든 틀렸든). 터치·직접값 커밋은 STT가 들은 게 아니라 올리지 않는다. */
export function noteSeen(table: ConfusionTable, col: string, heard: string, decimals: number, colType: string): void {
  if (!isNumericString(heard)) return;
  for (const holder of [scopeFor(table, null), scopeFor(table, col)]) {
    for (const d of digitContexts(heard)) {
      const s = digitScope(holder, d.ctx);
      s.seen[d.digit] = (s.seen[d.digit] ?? 0) + 1;
    }
    if (decimalLossEligible(heard, decimals, colType)) holder.decimalLoss.seen += 1;
  }
}

/** 정정 쌍 (heard → said) 정렬. 같은 자릿수·같은 소수 구조면 자리별로, 정수로 들렸는데 소수였으면
 *  「점」 소실 규칙으로, 그 밖은 `other:<태그>`(자릿수 변화 통계용). */
export function alignPair(heard: string, said: string, decimals: number): Observation[] {
  if (!isNumericString(heard) || !isNumericString(said)) return [{ kind: 'other', tag: 'non_numeric' }];
  if (heard === said) return [];
  const dh = digitsOf(heard);
  const ds = digitsOf(said);
  if (!dh || !ds) return [{ kind: 'other', tag: 'empty' }];
  const [hi, hf = ''] = heard.replace('-', '').split('.');
  const [si, sf = ''] = said.replace('-', '').split('.');
  if (hi.length === si.length && hf.length === sf.length) {
    const hc = digitContexts(heard);
    const sc = digitContexts(said);
    const diff: number[] = [];
    for (let i = 0; i < hc.length; i++) if (hc[i].digit !== sc[i].digit) diff.push(i);
    if (diff.length === 1) {
      const i = diff[0];
      return [{ kind: 'digit', ctx: hc[i].ctx, heard: hc[i].digit, said: sc[i].digit }];
    }
    return [{ kind: 'other', tag: 'multi_diff' }];
  }
  if (!heard.includes('.') && said.includes('.') && decimals >= 1) {
    const rule = matchDecimalLossRule(dh, si, sf);
    if (rule) return [{ kind: 'decimalLoss', rule }];
    if (dh.length >= 3 && dh.length > ds.length) return [{ kind: 'other', tag: 'dot_lost_other' }];
  }
  if (ds.endsWith(dh)) return [{ kind: 'other', tag: 'leading_digits_lost' }];
  if (dh.endsWith(ds)) return [{ kind: 'other', tag: 'leading_digits_added' }];
  if (ds.startsWith(dh)) return [{ kind: 'other', tag: 'trailing_digits_lost' }];
  if (dh.startsWith(ds)) return [{ kind: 'other', tag: 'trailing_digits_added' }];
  return [{ kind: 'other', tag: `len_${dh.length}_${ds.length}` }];
}

function matchDecimalLossRule(dh: string, si: string, sf: string): DecimalLossRule | null {
  const ip = digitsOf(si);
  const fp = digitsOf(sf);
  if (!fp) return null;
  if (ip + '3' + fp === dh) return 'as3';
  if (ip + '00' + fp === dh) return 'as00';
  if (ip + '0' + fp === dh) return 'as0';
  if (ip + fp === dh) return 'insert';
  return null;
}

/** 관측 1건을 전역 + 컬럼 스코프에 더한다. */
export function addObservation(table: ConfusionTable, col: string, obs: Observation): void {
  for (const holder of [scopeFor(table, null), scopeFor(table, col)]) {
    if (obs.kind === 'digit') {
      const s = digitScope(holder, obs.ctx);
      if (!s.conf[obs.heard]) s.conf[obs.heard] = {};
      s.conf[obs.heard][obs.said] = (s.conf[obs.heard][obs.said] ?? 0) + 1;
    } else if (obs.kind === 'decimalLoss') {
      holder.decimalLoss.rules[obs.rule] = (holder.decimalLoss.rules[obs.rule] ?? 0) + 1;
    }
  }
}

/** 「첫째」(들린 값이 맞았다) — 그 규칙의 분모(seen)만 올린다. 프로필 컬럼 스코프의 seen이 kSeen에 닿으면
 *  `pickDigitScope`의 컬럼 증거 게이트가 그 컬럼에서 규칙 생성을 멈춘다(r2 P2-1 — 전역 규칙으로 묻는 새 사용자에게도
 *  작동하는 억제). 같은 표 안에서는 P도 내려간다. */
export function addNegative(table: ConfusionTable, col: string, rule: string): void {
  const dec = /^dec:/.test(rule);
  const m = /^(L\d+P\d+):(\d)>(\d)$/.exec(rule);
  for (const holder of [scopeFor(table, null), scopeFor(table, col)]) {
    if (dec) holder.decimalLoss.seen += 1;
    else if (m) {
      const s = digitScope(holder, m[1]);
      s.seen[m[2]] = (s.seen[m[2]] ?? 0) + 1;
    }
  }
}

function mergeDigitScope(into: DigitScope, from: DigitScope): void {
  for (const [d, n] of Object.entries(from.seen)) into.seen[d] = (into.seen[d] ?? 0) + n;
  for (const [x, row] of Object.entries(from.conf)) {
    if (!into.conf[x]) into.conf[x] = {};
    for (const [y, n] of Object.entries(row)) into.conf[x][y] = (into.conf[x][y] ?? 0) + n;
  }
}

function mergeHolder(into: { ctx: Record<DigitCtx, DigitScope>; decimalLoss: DecimalLossScope }, from: { ctx: Record<DigitCtx, DigitScope>; decimalLoss: DecimalLossScope }): void {
  for (const [ctx, s] of Object.entries(from.ctx)) mergeDigitScope(digitScope(into, ctx), s);
  into.decimalLoss.seen += from.decimalLoss.seen;
  for (const r of DECIMAL_LOSS_RULES) into.decimalLoss.rules[r] = (into.decimalLoss.rules[r] ?? 0) + (from.decimalLoss.rules[r] ?? 0);
}

/** 표 합치기(전역 표 생성 — 화자별 표를 모아 전역으로). */
export function mergeTables(into: ConfusionTable, from: ConfusionTable): ConfusionTable {
  mergeHolder(into, from);
  for (const [col, cs] of Object.entries(from.byColumn)) mergeHolder(scopeFor(into, col), cs);
  return into;
}

// ─── 후보 생성 ─────────────────────────────────────────────────────────────

export interface CandidateInput {
  heard: string;
  /** `colKey()`로 정규화한 컬럼 키. */
  col: string;
  decimals: number;
  colType: string;
  /** 우선순위 순 — [화자 프로필 표, 전역 표]. 각 표 안에서는 컬럼 스코프 → 문맥 스코프. */
  tables: ConfusionTable[];
  params?: Partial<CandidateParams>;
}

function replaceIntDigit(heard: string, pos: number, digit: string): string {
  const neg = heard.startsWith('-') ? '-' : '';
  const [ip, fp] = heard.replace('-', '').split('.');
  const nip = ip.slice(0, pos) + digit + ip.slice(pos + 1);
  if (nip.length > 1 && nip.startsWith('0')) return '';
  return `${neg}${nip}${fp !== undefined ? `.${fp}` : ''}`;
}

/** 규칙을 들린 정수 숫자열에 적용해 후보 값을 만든다. 형상이 안 맞으면 null. */
export function applyDecimalLossRule(heard: string, decimals: number, rule: DecimalLossRule): string | null {
  const dh = digitsOf(heard);
  const sep = rule === 'as3' ? '3' : rule === 'as00' ? '00' : rule === 'as0' ? '0' : '';
  const need = decimals + sep.length + 1;
  if (dh.length < need) return null;
  const fp = dh.slice(dh.length - decimals);
  const mid = dh.slice(dh.length - decimals - sep.length, dh.length - decimals);
  const ip = dh.slice(0, dh.length - decimals - sep.length);
  if (mid !== sep || !ip) return null;
  if (ip.length > 1 && ip.startsWith('0')) return null;
  const v = `${ip}.${fp}`;
  return v === heard ? null : v;
}

export function generateCandidates(input: CandidateInput): Candidate[] {
  const p = { ...DEFAULT_CANDIDATE_PARAMS, ...(input.params ?? {}) };
  const { heard, col, decimals, colType, tables } = input;
  const out: Candidate[] = [];
  if (!isNumericString(heard)) return out;

  for (const d of digitContexts(heard)) {
    if (d.part !== 'int') continue;
    // 🔴 스코프는 **규칙별**로 고른다 — 「그 heard 자리의 분모가 있는 첫 스코프」로 고르면 컬럼 표에
    //   분모만 있고 해당 치환의 지지수가 모자랄 때(당도 as00 2건) 문맥·전역 표의 지지수(3건)로
    //   폴백하지 못한다. 규칙 (x→y)의 지지수가 kSupport 이상인 첫 스코프가 그 규칙의 P·분모를 준다.
    //   단 **컬럼 증거가 우선한다**(r2 P2-2): 컬럼 스코프의 seen[digit] ≥ kSeen인데 지지수가 모자라면 그 컬럼에선
    //   규칙을 만들지 않는다(적정의 「1.x」는 정상값 — root 표의 당도 지배 규칙이 덮어쓰면 안 된다). 표에 없는
    //   컬럼(첫 회차의 새 항목)만 root 문맥 표로 폴백한다 — 그 컬럼은 kSeen번 커밋이 쌓일 때까지 「1.x」를 묻는다.
    const saidDigits = new Set<string>();
    for (const t of tables) {
      for (const s of [t.byColumn[col]?.ctx[d.ctx], t.ctx[d.ctx]]) {
        for (const y of Object.keys(s?.conf[d.digit] ?? {})) saidDigits.add(y);
      }
    }
    for (const y of saidDigits) {
      if (y === d.digit) continue;
      const pick = pickDigitScope(tables, col, d.ctx, d.digit, y, p);
      if (!pick) continue;
      const { scope, label } = pick;
      const seen = Math.max(scope.seen[d.digit] ?? 0, 1);
      const row = scope.conf[d.digit] ?? {};
      let wrong = 0;
      for (const [yy, n] of Object.entries(row)) if (yy !== d.digit) wrong += n;
      const prob = (row[y] ?? 0) / seen;
      if (prob < p.theta) continue;
      const value = replaceIntDigit(heard, d.pos, y);
      if (!value) continue;
      out.push({ value, p: prob, pHeard: Math.max(0, seen - wrong) / seen, rule: `${d.ctx}:${d.digit}>${y}`, scope: label });
    }
  }

  if (decimalLossEligible(heard, decimals, colType)) {
    for (const r of DECIMAL_LOSS_RULES) {
      const pick = pickDecimalScope(tables, col, r, p);
      if (!pick) continue;
      const { scope, label } = pick;
      const seen = Math.max(scope.seen, 1);
      let wrong = 0;
      for (const rr of DECIMAL_LOSS_RULES) wrong += scope.rules[rr] ?? 0;
      const prob = (scope.rules[r] ?? 0) / seen;
      if (prob < p.theta) continue;
      const value = applyDecimalLossRule(heard, decimals, r);
      if (!value) continue;
      out.push({ value, p: prob, pHeard: Math.max(0, seen - wrong) / seen, rule: `dec:${r}`, scope: label });
    }
  }

  // 같은 값이 두 규칙에서 나오면 큰 확률만 남긴다.
  const best = new Map<string, Candidate>();
  for (const c of out) {
    const cur = best.get(c.value);
    if (!cur || cur.p < c.p) best.set(c.value, c);
  }
  return [...best.values()].sort((a, b) => b.p - a.p);
}

/** 규칙 (digit→said)의 스코프. 표 순서(화자 프로필 → 전역)대로 「컬럼 → root 문맥」을 본다.
 *  🔴 r2 P2-1·P2-2 — 컬럼 스코프에 **증거가 있는데**(seen[digit] ≥ kSeen) 이 치환의 지지수가 kSupport 미만이면 **null로
 *  끝낸다**(뒤 표로 내려가지 않는다). 프로필 컬럼의 seen은 커밋과 「첫째」 부정 사례가 올리므로, 새 사용자가 전역
 *  규칙으로 질문받다가 「첫째」가 kSeen번 쌓이면 그 컬럼에서 질문이 멎는다. 컬럼 스코프 자체가 없으면 root로 폴백한다. */
function pickDigitScope(tables: ConfusionTable[], col: string, ctx: DigitCtx, digit: string, said: string, p: CandidateParams): { scope: DigitScope; label: string } | null {
  for (let t = 0; t < tables.length; t++) {
    const table = tables[t];
    const cs = table.byColumn[col]?.ctx[ctx];
    if (cs) {
      if ((cs.conf[digit]?.[said] ?? 0) >= p.kSupport) return { scope: cs, label: `col${t}` };
      if ((cs.seen[digit] ?? 0) >= p.kSeen) return null;
    }
    const gs = table.ctx[ctx];
    if (gs && (gs.conf[digit]?.[said] ?? 0) >= p.kSupport) return { scope: gs, label: `ctx${t}` };
  }
  return null;
}

/** 「점」 소실 규칙의 스코프 — 위와 같은 계약(컬럼 decimalLoss.seen ≥ kSeen인데 지지수 미달이면 null). */
function pickDecimalScope(tables: ConfusionTable[], col: string, rule: DecimalLossRule, p: CandidateParams): { scope: DecimalLossScope; label: string } | null {
  for (let t = 0; t < tables.length; t++) {
    const table = tables[t];
    const cs = table.byColumn[col]?.decimalLoss;
    if (cs) {
      if ((cs.rules[rule] ?? 0) >= p.kSupport) return { scope: cs, label: `col${t}` };
      if (cs.seen >= p.kSeen) return null;
    }
    if ((table.decimalLoss.rules[rule] ?? 0) >= p.kSupport) return { scope: table.decimalLoss, label: `ctx${t}` };
  }
  return null;
}

// ─── 판정 ──────────────────────────────────────────────────────────────────

/** 후보 목록 → 물을지 말지. 「들린 값 외에 그럴듯함이 비슷하거나 높은 후보」가 있을 때만 묻는다.
 *
 *  🔴 **그럴듯함 = 혼동표 확률뿐이다**(민구 결정 2026-09-02, `_ASK-build-r6-fable-xhigh` #2 → ⓐ). 브리핑이
 *  「(선택) 같은 세션·같은 컬럼 이전 값 분포」 가중을 열어 뒀고 시뮬로는 질문 27→22·포착 15→16이었지만,
 *  민구는 R1(세션 내 값 타당성 규칙)을 *"이미 이상치 알람 설정옵션이 존재"* 로 기각한 취지 그대로
 *  **세션 내 값 규칙은 어떤 형태로도 넣지 않는다**고 정했다 — 값의 범위 판단은 사용자가 설정하는 알람의
 *  몫이고, 이 모듈은 「발음 혼동 확률」만 말한다. 여기에 이전 값·범위·중앙값을 들이지 마라. */
export function decide(heard: string, cands: Candidate[], params?: Partial<CandidateParams>): Decision {
  void heard;
  const p = { ...DEFAULT_CANDIDATE_PARAMS, ...(params ?? {}) };
  if (cands.length === 0) return { ask: false, cands: [], reason: 'none' };
  const sorted = [...cands].sort((a, b) => b.p - a.p);
  const top = sorted[0];
  if (top.p < p.theta) return { ask: false, cands: [], reason: 'below_theta' };
  if (top.p < p.rho * top.pHeard) return { ask: false, cands: [], reason: 'below_rho' };
  const kept = sorted.filter((x) => x.p >= p.theta && x.p >= p.rho * x.pHeard).slice(0, p.maxCands);
  return { ask: true, cands: kept, reason: 'ask' };
}

/** R4(「7·8은 일곱·여덟으로」 안내)와 겹치지 않는 **훅**: 이 화자의 7/8 혼동이 높으면 세션 시작 안내에
 *  한 문장을 붙일 근거가 된다. 문구·발화는 여기 없다(R4 문구 재사용 · 중복 발화 금지 — 배선은 미결). */
export function shouldHintSevenEight(tables: ConfusionTable[], kSupport = 3): boolean {
  for (const t of tables) {
    for (const [ctx, s] of Object.entries(t.ctx)) {
      if (!ctx.startsWith('L')) continue;
      for (const [x, row] of Object.entries(s.conf)) {
        for (const [y, n] of Object.entries(row)) {
          if ((y === '7' || y === '8') && x !== y && n >= kSupport) return true;
        }
      }
    }
  }
  return false;
}
