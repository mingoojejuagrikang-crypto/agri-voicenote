#!/usr/bin/env node
/**
 * v0.51.1 R6 — 런타임 규칙 시뮬레이션: 실제 세션의 음성 커밋 시도에 후보 생성·판정을 세션 순서대로 적용해
 * 「발동 n · 오커밋 중 질문으로 잡히는 수 · clean 셀 위양성」을 센다(브리핑 §4 산출물).
 *
 *   node scripts/stt-confusion-sim.mjs <growth-log 폴더…> [--mode insample|loso|cold] [--cold-groups <dir부분문자열,…>]
 *        [--eval <dir부분문자열,…>] [--params theta=0.15,rho=0.5,kSupport=3,usePrior=0] [--sweep] [--detail]
 *
 *  · insample = 전 세션으로 만든 표를 그 세션들에 적용(상한) · loso = 평가 세션을 뺀 표(leave-one-session-out ·
 *    같은 화자의 새 세션에 가까운 정직한 값) · cold = `--cold-groups`에 걸리는 폴더만으로 표를 만들어
 *    나머지에 적용(회차 간 이월). `--eval`은 평가 대상 폴더를 부분문자열로 고른다(기본 전부).
 *  · 그럴듯함은 혼동표 확률뿐이다(민구 결정 09-02 ⓐ — 세션 내 값 규칙은 어떤 형태로도 넣지 않는다).
 */
import { DEFAULT_CANDIDATE_PARAMS, decide, generateCandidates, isNumericString } from '../src/lib/sttConfusionCore.ts';
import { buildTables, expandSessionDirs, loadSessionDir } from './stt-confusion-lib.mjs';

const argv = process.argv.slice(2);
const opts = { mode: 'loso', coldGroups: [], evalMatch: [], params: {}, sweep: false, detail: false };
const dirs = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--mode') opts.mode = argv[++i];
  else if (a === '--cold-groups') opts.coldGroups = argv[++i].split(',');
  else if (a === '--eval') opts.evalMatch = argv[++i].split(',');
  else if (a === '--params') for (const kv of argv[++i].split(',')) { const [k, v] = kv.split('='); opts.params[k] = Number(v); }
  else if (a === '--sweep') opts.sweep = true;
  else if (a === '--detail') opts.detail = true;
  else dirs.push(a);
}
if (!dirs.length) { console.error('사용법: node scripts/stt-confusion-sim.mjs <폴더…> [--mode …] [--sweep] [--detail]'); process.exit(2); }

const sessions = expandSessionDirs(dirs).map((d) => loadSessionDir(d));
const evalSessions = sessions.filter((s) => !opts.evalMatch.length || opts.evalMatch.some((m) => s.dir.includes(m)));
const coldSet = new Set(sessions.filter((s) => opts.coldGroups.some((m) => s.dir.includes(m))).map((s) => s.sid));

function tableFor(sid) {
  if (opts.mode === 'insample') return buildTables(sessions).global;
  if (opts.mode === 'loso') return buildTables(sessions, { exclude: new Set([sid]) }).global;
  if (opts.mode === 'cold') return buildTables(sessions.filter((s) => coldSet.has(s.sid))).global;
  throw new Error(`--mode: ${opts.mode}`);
}
const tableCache = new Map();
const getTable = (sid) => { const k = opts.mode === 'loso' ? sid : '*'; if (!tableCache.has(k)) tableCache.set(k, tableFor(sid)); return tableCache.get(k); };

/** 평가 대상 = 음성 커밋(정정·재발화 포함) 중 값·정답이 모두 숫자인 것. */
function run(params, detail = false) {
  const p = { ...DEFAULT_CANDIDATE_PARAMS, ...params };
  const m = { attempts: 0, wrong: 0, clean: 0, asked: 0, caught: 0, askedWrongCand: 0, fp: 0, cellsAsked: new Set(), rows: [] };
  for (const s of evalSessions) {
    const table = getTable(s.sid);
    const askedCells = new Set();
    const commits = s.commits.filter((c) => c.kind === 'voice').sort((a, b) => a.ts - b.ts);
    for (const c of commits) {
      if (!isNumericString(c.value) || !isNumericString(c.truth)) continue;
      m.attempts += 1;
      const wrong = c.value !== c.truth;
      if (wrong) m.wrong += 1; else m.clean += 1;
      const cands = generateCandidates({ heard: c.value, col: c.colKey, decimals: c.decimals, colType: c.colType, tables: [table], params: p });
      const d = decide(c.value, cands, p);
      const cellKey = `${c.row}:${c.colId}`;
      const ask = d.ask && !askedCells.has(cellKey);
      if (d.ask) askedCells.add(cellKey);
      if (!ask) continue;
      m.asked += 1;
      const hit = d.cands.some((x) => x.value === c.truth);
      if (wrong && hit) m.caught += 1;
      else if (wrong) m.askedWrongCand += 1;
      else m.fp += 1;
      if (detail) m.rows.push({ sid: s.sid.slice(-6), dir: s.dir.slice(0, 18), row: c.row, col: c.colKey, heard: c.value, truth: c.truth, cands: d.cands.map((x) => `${x.value}(${x.p.toFixed(2)}/${x.rule}/${x.scope})`).join(' '), verdict: wrong ? (hit ? '포착' : '오답후보') : '위양성' });
    }
  }
  return m;
}

function line(label, m) {
  return `${label.padEnd(44)} 시도 ${String(m.attempts).padStart(4)} · 오커밋 ${String(m.wrong).padStart(3)} · clean ${String(m.clean).padStart(4)} │ 발동 ${String(m.asked).padStart(3)} · 포착 ${String(m.caught).padStart(3)} · 오답후보 ${String(m.askedWrongCand).padStart(2)} · 위양성 ${String(m.fp).padStart(2)}`;
}

console.log(`모드 ${opts.mode} · 평가 세션 ${evalSessions.length}/${sessions.length}${opts.mode === 'cold' ? ` · 표 세션 ${coldSet.size}` : ''}`);
if (opts.sweep) {
  for (const kSupport of [2, 3]) for (const theta of [0.1, 0.15, 0.2, 0.3]) for (const rho of [0.3, 0.5, 1]) {
    const params = { ...opts.params, kSupport, theta, rho };
    console.log(line(`k=${kSupport} θ=${theta} ρ=${rho}`, run(params)));
  }
} else {
  const m = run(opts.params, opts.detail);
  console.log(line(`params ${JSON.stringify({ ...DEFAULT_CANDIDATE_PARAMS, ...opts.params })}`, m));
  if (opts.detail) for (const r of m.rows) console.log(`  ${r.verdict.padEnd(4)} ${r.dir} r${String(r.row).padStart(2)} ${r.col.padEnd(6)} 들림 ${r.heard.padEnd(6)} 정답 ${r.truth.padEnd(6)} 후보 ${r.cands}`);
}
