/**
 * v0.51.1 R6 — growth-log 폴더 → 시도·커밋 재구성 + 혼동표 조립 (build·sim 스크립트 공용).
 *
 * 앱의 순수 핵심(`src/lib/sttConfusionCore.ts`)을 **그대로** import한다(Node 22 타입 스트리핑) —
 * 정렬·후보 규칙이 런타임과 한 벌이다. 재구성 규칙은 STT 레인 `stt_cells.py`(09-02)를 따른다:
 *  · 시도 = `stt` 이벤트 중 row·colId가 있고 extra가 없는 것(엔진 관측 라인)
 *  · 결과 = 뒤따르는 `stt_parse_failed`/`stt_rejected_*`(거절) 또는 `value`(커밋 · parsed)
 *  · 커밋 = `value`(음성 · `direct_modify`) + `command manual_commit|touch_commit`(터치)
 *  · 정답 = sessions.json 최종값(`--truth=final`) 또는 감사 전사 TSV(`--truth=audit`)
 *  · 앱이 `stt_correction`을 남긴 세션(v0.51.1+)은 그 이벤트가 쌍의 정본이고 재구성 쌍은 쓰지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  addObservation, alignPair, colKey, emptyTable, isNumericString, mergeTables, noteSeen,
} from '../src/lib/sttConfusionCore.ts';

export function sha8(email) {
  return createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 8);
}

/** 인자 폴더들을 growth-log 세션 폴더 목록으로 편다(폴더 자체가 세션이면 그대로, 아니면 하위 growth-log_*). */
export function expandSessionDirs(args) {
  const out = [];
  for (const a of args) {
    const abs = path.resolve(a);
    if (!fs.existsSync(abs)) throw new Error(`없는 경로: ${abs}`);
    if (fs.existsSync(path.join(abs, 'sessions.json'))) { out.push(abs); continue; }
    for (const name of fs.readdirSync(abs).sort()) {
      const d = path.join(abs, name);
      if (name.startsWith('growth-log_') && fs.statSync(d).isDirectory() && fs.existsSync(path.join(d, 'sessions.json'))) out.push(d);
    }
  }
  // 🔴 같은 세션이 두 번 export될 수 있다(`growth-log_<날짜>_<sid>_<export ts>` — 09-01 inbox에 실재:
  //   sess_1788216696225가 zip 2개). sid로 dedupe하고 **나중 export**(뒤 타임스탬프가 큰 것)를 택한다.
  const bySid = new Map();
  for (const d of out) {
    const m = /growth-log_\d{4}-\d{2}-\d{2}_(sess_\d+)_(\d+)$/.exec(path.basename(d));
    const sid = m ? m[1] : d;
    const ts = m ? Number(m[2]) : 0;
    const cur = bySid.get(sid);
    if (!cur || ts > cur.ts) bySid.set(sid, { d, ts });
  }
  return [...bySid.values()].map((x) => x.d).sort();
}

function parseKv(extra, prefix) {
  if (typeof extra !== 'string' || !extra.startsWith(prefix + ':')) return null;
  const o = {};
  for (const part of extra.slice(prefix.length + 1).split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    o[part.slice(0, i)] = part.slice(i + 1);
  }
  return o;
}

/** 세션 폴더 1개 → { sid, speaker, mic, person, columns, attempts, commits, corrections, finals }. */
export function loadSessionDir(dir, opts = {}) {
  const sessJson = JSON.parse(fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8'));
  const sess = sessJson.sessions ? sessJson.sessions[0] : sessJson[0];
  const sid = sess.id;
  const device = fs.existsSync(path.join(dir, 'device.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'device.json'), 'utf8')) : {};
  const speaker = device.speakerId || (device.userEmail ? sha8(device.userEmail) : 'anon');
  const cols = {};
  for (const c of sess.columns) cols[c.id] = { name: c.name, type: c.type, decimals: c.type === 'float' ? (c.decimals ?? 1) : 0 };
  let person = null;
  for (const c of sess.columns) if (c.name === '농가명' && sess.rows[0]) person = sess.rows[0].values?.[c.id] ?? null;
  const finals = {};
  for (const r of sess.rows) finals[r.index] = r.values || {};
  const truth = opts.audit ? (opts.audit.get(sid) ?? new Map()) : null;
  const truthOf = (row, colId) => {
    if (truth) { const v = truth.get(`${row}:${colId}`); if (v !== undefined) return v; }
    return finals[row]?.[colId] ?? null;
  };

  const ev = JSON.parse(fs.readFileSync(path.join(dir, 'events.json'), 'utf8'))
    .filter((e) => e.sessionId === sid)
    .sort((a, b) => (a.ts - b.ts) || ((a.id ?? 0) - (b.id ?? 0)));
  let mic = 'unknown';
  const cellAttempts = new Map();
  const attempts = [];
  const commits = [];
  const corrections = [];
  const lastOf = (row, colId) => { const a = cellAttempts.get(`${row}:${colId}`); return a && a.length ? a[a.length - 1] : null; };
  for (const e of ev) {
    const extra = typeof e.extra === 'string' ? e.extra : '';
    if (e.type === 'session' && extra.startsWith('audio_input_class:')) { mic = parseKv(extra, 'audio_input_class')?.cls ?? mic; continue; }
    if (e.type === 'stt') {
      const corr = parseKv(extra, 'stt_correction');
      if (corr) { corrections.push({ ts: e.ts, row: e.row, colId: e.colId, ...corr }); continue; }
      if (e.row == null || e.colId == null || extra) continue;
      const c = cols[e.colId] || { name: e.colId, type: '?', decimals: 1 };
      const a = {
        sid, speaker, mic, person, ts: e.ts, id: e.id, row: e.row, colId: e.colId,
        colName: c.name, colKey: colKey(c.name), colType: c.type, decimals: c.decimals,
        text: e.text ?? '', conf: e.confidence ?? null, alts: e.alts ?? [],
        outcome: null, reason: null, parsed: null, altIdx: null, truth: truthOf(e.row, e.colId),
      };
      attempts.push(a);
      const k = `${e.row}:${e.colId}`;
      if (!cellAttempts.has(k)) cellAttempts.set(k, []);
      cellAttempts.get(k).push(a);
      continue;
    }
    if (e.type === 'stt_alt_used') { const a = lastOf(e.row, e.colId); if (a) a.altIdx = e.altIdx ?? null; continue; }
    if (e.type === 'stt_parse_failed' || e.type === 'stt_rejected_low_confidence' || e.type === 'stt_rejected_ambiguous_syllable' || e.type === 'stt_rejected_col_name') {
      const a = lastOf(e.row, e.colId);
      if (a && a.outcome === null) { a.outcome = 'rejected'; a.reason = e.type === 'stt_parse_failed' ? (extra || 'parse_failed') : e.type; }
      continue;
    }
    if (e.type === 'value') {
      const c = cols[e.colId] || { name: e.colId, type: '?', decimals: 1 };
      if (extra === 'direct_modify') {
        commits.push({ sid, speaker, mic, ts: e.ts, row: e.row, colId: e.colId, colKey: colKey(c.name), colType: c.type, decimals: c.decimals, kind: 'direct_modify', value: e.parsed, prev: e.previousValue ?? null, truth: truthOf(e.row, e.colId) });
        continue;
      }
      const a = lastOf(e.row, e.colId);
      if (a && a.outcome === null) { a.outcome = 'committed'; a.parsed = e.parsed; }
      commits.push({ sid, speaker, mic, ts: e.ts, row: e.row, colId: e.colId, colKey: colKey(c.name), colType: c.type, decimals: c.decimals, kind: 'voice', value: e.parsed, prev: e.previousValue ?? null, text: e.text, conf: e.confidence ?? null, truth: truthOf(e.row, e.colId) });
      continue;
    }
    if (e.type === 'command' && (e.parsed === 'manual_commit' || e.parsed === 'touch_commit')) {
      const c = cols[e.colId] || { name: e.colId, type: '?', decimals: 1 };
      commits.push({ sid, speaker, mic, ts: e.ts, row: e.row, colId: e.colId, colKey: colKey(c.name), colType: c.type, decimals: c.decimals, kind: 'touch', value: e.text, prev: e.previousValue ?? null, truth: truthOf(e.row, e.colId) });
    }
  }
  return { dir, sid, speaker, mic, person, columns: cols, attempts, commits, corrections, rows: sess.rows.length };
}

/** 감사 전사 TSV(`sid\trow\tcolId\ttruth`) → Map<sid, Map<'row:colId', truth>>. */
export function loadAuditTsv(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const H = lines[0].split('\t');
  const idx = (n) => { const i = H.indexOf(n); if (i < 0) throw new Error(`감사 TSV에 ${n} 컬럼이 없다`); return i; };
  const iS = idx('sid'), iR = idx('row'), iC = idx('colId'), iT = idx('truth');
  const out = new Map();
  for (const l of lines.slice(1)) {
    const c = l.split('\t');
    if (!out.has(c[iS])) out.set(c[iS], new Map());
    out.get(c[iS]).set(`${c[iR]}:${c[iC]}`, c[iT]);
  }
  return out;
}

/** 세션들 → 화자별 표 + 통계. 쌍의 출처: 세션에 `stt_correction`이 있으면 그것, 없으면 재구성(커밋≠정답). */
export function buildTables(sessions, { exclude = new Set() } = {}) {
  const bySpeaker = new Map();
  const stats = { sessions: 0, voiceCommits: 0, pairs: 0, aligned: 0, other: {}, fromEvents: 0 };
  const get = (sp) => { if (!bySpeaker.has(sp)) bySpeaker.set(sp, { table: emptyTable(), sessions: 0, pairs: 0, mics: new Set() }); return bySpeaker.get(sp); };
  for (const s of sessions) {
    if (exclude.has(s.sid)) continue;
    const sp = get(s.speaker);
    sp.sessions += 1; sp.mics.add(s.mic); stats.sessions += 1;
    for (const c of s.commits) {
      if (c.kind !== 'voice' || !isNumericString(c.value)) continue;
      noteSeen(sp.table, c.colKey, c.value, c.decimals, c.colType);
      stats.voiceCommits += 1;
    }
    const pairs = [];
    if (s.corrections.length) {
      stats.fromEvents += 1;
      for (const c of s.corrections) {
        const col = s.columns[c.colId];
        if (!col || c.from === '-' || !isNumericString(c.from) || !isNumericString(c.to)) continue;
        pairs.push({ colKey: colKey(col.name), heard: c.from, said: c.to, decimals: col.decimals });
      }
    } else {
      for (const c of s.commits) {
        if (c.kind !== 'voice' || !isNumericString(c.value) || !isNumericString(c.truth) || c.value === c.truth) continue;
        pairs.push({ colKey: c.colKey, heard: c.value, said: c.truth, decimals: c.decimals });
      }
    }
    for (const p of pairs) {
      sp.pairs += 1; stats.pairs += 1;
      for (const o of alignPair(p.heard, p.said, p.decimals)) {
        if (o.kind === 'other') { stats.other[o.tag] = (stats.other[o.tag] ?? 0) + 1; continue; }
        addObservation(sp.table, p.colKey, o);
        stats.aligned += 1;
      }
    }
  }
  const global = emptyTable();
  for (const sp of bySpeaker.values()) mergeTables(global, sp.table);
  return { global, bySpeaker, stats };
}

/** 표에서 지지수 순 상위 규칙(판독·산출물용). */
export function topRules(table, n = 12) {
  const rows = [];
  for (const [ctx, s] of Object.entries(table.ctx)) {
    for (const [x, row] of Object.entries(s.conf)) for (const [y, c] of Object.entries(row)) if (x !== y) rows.push({ rule: `${ctx}:${x}>${y}`, support: c, seen: s.seen[x] ?? 0, p: c / Math.max(1, s.seen[x] ?? 0) });
  }
  for (const [r, c] of Object.entries(table.decimalLoss.rules)) if (c) rows.push({ rule: `dec:${r}`, support: c, seen: table.decimalLoss.seen, p: c / Math.max(1, table.decimalLoss.seen) });
  return rows.sort((a, b) => b.support - a.support || b.p - a.p).slice(0, n);
}
