#!/usr/bin/env node
/**
 * v0.51.1 R6 — 전역 STT 혼동표 생성(재현 가능).
 *
 *   node scripts/stt-confusion-build.mjs <growth-log 폴더…> [--out src/data/stt-confusion-default.json]
 *        [--attempts-out <json>] [--truth=final|audit] [--audit <tsv>] [--label <문자열>]
 *
 *  · 입력 폴더는 절대경로(teamops inbox 등). 세션 폴더(sessions.json 포함) 또는 그 상위 폴더.
 *  · `--truth=final`(기본) = sessions.json 최종값이 정답. `--truth=audit --audit <tsv>` = 감사 전사
 *    (`sid\trow\tcolId\ttruth`)가 정답(없는 셀은 최종값 폴백).
 *  · `--attempts-out` = 시도·커밋 덤프(시뮬 `stt-confusion-sim.mjs`·클린 픽스처 입력).
 *  · 출력 JSON의 `table`이 앱의 전역 표다(`sttProfileStore.getDefaultConfusionTable`). 방향 `heard->said`.
 *
 * 🔴 사람 식별은 화자 해시(이메일 sha256 앞 8자)뿐이다 — 이름·이메일은 출력에 싣지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildTables, expandSessionDirs, loadAuditTsv, loadSessionDir, topRules } from './stt-confusion-lib.mjs';

const argv = process.argv.slice(2);
const opts = { out: 'src/data/stt-confusion-default.json', attemptsOut: null, truth: 'final', audit: null, label: '' };
const dirs = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--out') opts.out = argv[++i];
  else if (a === '--attempts-out') opts.attemptsOut = argv[++i];
  else if (a.startsWith('--truth=')) opts.truth = a.slice('--truth='.length);
  else if (a === '--audit') opts.audit = argv[++i];
  else if (a === '--label') opts.label = argv[++i];
  else dirs.push(a);
}
if (!dirs.length) {
  console.error('사용법: node scripts/stt-confusion-build.mjs <growth-log 폴더…> [--out …] [--attempts-out …] [--truth=final|audit --audit <tsv>]');
  process.exit(2);
}
if (opts.truth !== 'final' && opts.truth !== 'audit') throw new Error(`--truth는 final|audit: ${opts.truth}`);
if (opts.truth === 'audit' && !opts.audit) throw new Error('--truth=audit에는 --audit <tsv>가 필요하다');

const audit = opts.audit ? loadAuditTsv(opts.audit) : null;
const sessionDirs = expandSessionDirs(dirs);
const sessions = sessionDirs.map((d) => loadSessionDir(d, { audit }));
const { global, bySpeaker, stats } = buildTables(sessions);

const out = {
  schema: 1,
  direction: 'heard->said',
  builtAt: new Date().toISOString(),
  generator: 'scripts/stt-confusion-build.mjs',
  label: opts.label,
  truth: opts.truth,
  sources: dirs.map((d) => path.resolve(d)),
  sessions: stats.sessions,
  speakers: bySpeaker.size,
  voiceCommits: stats.voiceCommits,
  pairs: stats.pairs,
  aligned: stats.aligned,
  unaligned: stats.other,
  pairsFromEvents: stats.fromEvents,
  bySpeaker: Object.fromEntries([...bySpeaker.entries()].map(([sp, v]) => [sp, { sessions: v.sessions, pairs: v.pairs, micClasses: [...v.mics].sort() }])),
  top: topRules(global),
  table: global,
};
fs.mkdirSync(path.dirname(opts.out), { recursive: true });
fs.writeFileSync(opts.out, JSON.stringify(out, null, 2) + '\n');
console.log(`전역 표 → ${opts.out}: 세션 ${out.sessions} · 화자 ${out.speakers} · 음성 커밋 ${out.voiceCommits} · 쌍 ${out.pairs}(정렬 ${out.aligned}) · 정답=${opts.truth}`);
for (const r of out.top) console.log(`  ${r.rule.padEnd(12)} 지지 ${String(r.support).padStart(3)} / 분모 ${String(r.seen).padStart(4)}  P=${r.p.toFixed(2)}`);

if (opts.attemptsOut) {
  const dump = {
    schema: 1, builtAt: out.builtAt, truth: opts.truth,
    sessions: sessions.map((s) => ({ sid: s.sid, speaker: s.speaker, mic: s.mic, rows: s.rows, dir: path.basename(s.dir), attempts: s.attempts.length, commits: s.commits.length, corrections: s.corrections.length })),
    attempts: sessions.flatMap((s) => s.attempts),
    commits: sessions.flatMap((s) => s.commits),
  };
  fs.mkdirSync(path.dirname(opts.attemptsOut), { recursive: true });
  fs.writeFileSync(opts.attemptsOut, JSON.stringify(dump, null, 1) + '\n');
  console.log(`시도 덤프 → ${opts.attemptsOut}: 시도 ${dump.attempts.length} · 커밋 ${dump.commits.length}`);
}
