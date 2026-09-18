import JSZip from 'jszip';
import { logger } from './logger';
import { withErr } from './logEvents';
import {
  loadAudioClip, loadAllAudioClipKeys, loadLogEvents, loadAllSessions,
  loadScreenshot, loadAllScreenshotKeys,
} from './db';
import { getCurrentEmail } from './googleAuth';
import { buildSessionsSnapshot } from './sessionSnapshot';
import { attachClipsManifest, type ManifestSourceEvent } from './clipsManifest';
import type { Session } from '../types';
import { withoutPendingCandidate } from './pendingValidation';
import { APP_SENTINEL, blankSessionWindow, includeEventInSessionExport } from './exportLogEvents';
import { attachSttProfile } from './sttProfileCore.ts';
import { hydrateSttProfiles, listSttProfiles } from './sttProfileStore';
import { ensureSpeakerId } from './sttSpeaker';

/** Export logs + audio clips as a ZIP.
 *  - `sessionIds` undefined → include ALL events and clips (used by manual LOG button)
 *  - `sessionIds` provided → restrict to those sessions only (used by auto upload after sync)
 *  - Empty array → still produces a device-only ZIP, no events/clips
 *
 *  v5.2 Codex 4차 MEDIUM: events는 IDB(영속)에서 우선 조회 — reload 후에도 보존됨.
 *  v0.10.1: userEmail은 토큰의 검증된 값 (`getCurrentEmail`) 사용 — settingsStore stale 방지.
 */
export async function exportLogZip(sessionIds?: string[]): Promise<Blob> {
  const { blob } = await exportLogZipInternal(sessionIds);
  return blob;
}

async function exportLogZipInternal(sessionIds?: string[]): Promise<{ blob: Blob; clipsComplete: boolean }> {
  const zip = new JSZip();
  const deviceInfo = await logger.deviceAsync();
  const userEmail = getCurrentEmail();
  // v0.51.1 R6 — 화자 id(이메일 sha256 앞 8자). 이벤트·프로필의 `speaker`와 같은 값 — 판독이 device.json만
  //   보고 「이 zip의 프로필이 누구 것인가」를 잇는다(이메일 원문은 종전대로 여기에만 있다).
  const speakerId = await ensureSpeakerId();
  const deviceWithUser = { ...deviceInfo, userEmail: userEmail ?? null, speakerId };
  zip.file('device.json', JSON.stringify(deviceWithUser, null, 2));

  const filterSet = sessionIds ? new Set(sessionIds) : null;

  // v0.5.0 W8: 복구용 세션 스냅샷 — export 범위 세션의 전체 Session 객체를 sessions.json으로 동봉.
  // "세션 복구" 2단계가 Drive의 이 zip만으로 세션+클립을 복원한다(별도 백업 업로드 없음 —
  // 클립은 아래 clips/를 그대로 공유, 중복 없음). 실패해도 zip 자체는 유효(구버전 zip과 동일 취급)
  // 하지만 [REVIEW-1] "빈 catch 금지" — 실패는 반드시 로깅한다.
  // v0.27.0: scoped 세션은 아래 clips-manifest 생성에도 재사용하므로 블록 밖으로 승격.
  // 로드 실패 시 빈 배열 유지 — manifest는 committedValue:null로 정직하게 비운다(추측 금지).
  // v0.51.1 X1 — events보다 **먼저** 읽는다: 아래 `''` 이벤트 창이 범위 세션의 시각에서 나온다.
  //   zip 엔트리 순서는 그대로다(device → events → sessions …) — 읽는 순서만 바뀌었다.
  let scopedSessions: Session[] = [];
  let sessionsJson: string | null = null;
  try {
    const allSessions = await loadAllSessions();
    scopedSessions = (filterSet ? allSessions.filter((s) => filterSet.has(s.id)) : allSessions)
      .map(withoutPendingCandidate);
    sessionsJson = buildSessionsSnapshot(scopedSessions, deviceWithUser.appVersion);
  } catch (e) {
    logger.log({ type: 'app', extra: withErr('export_sessions_json_failed', e) });
  }

  // v0.51.1 X1(read-fb F6) — 세션 필터 export는 **빈 sessionId(`''`) 이벤트도 동봉**한다: 세션 시작 직전 진단
  //   (`audio_unlock`·`start_ready`·`notify_perm`)이 `sessionIdRef` 미배정 시점에 `''`로 찍혀 종전엔 통째로
  //   빠졌다(09-02 정식 4세션 zip 5개 전부 0건). 창·술어·근거는 `exportLogEvents.ts`.
  const blankWindow = filterSet ? blankSessionWindow(scopedSessions, Date.now()) : null;
  let events: unknown[];
  try {
    // v0.5.0 W7(T-19): 세션 필터 ZIP에도 앱 수명주기 이벤트('__app__' sentinel — app_boot,
    // hydration, recover, drive_upload, setting_changed)를 항상 동봉해 계측 공백을 없앤다.
    // X1: 빈 문자열은 유효한 IDB 키다 — `''` 인덱스 항목을 함께 읽고 창으로 거른다.
    const idsToLoad = filterSet ? [...filterSet, APP_SENTINEL, ''] : undefined;
    events = (await loadLogEvents(idsToLoad)).filter((e) => {
      if (!filterSet) return true;
      return includeEventInSessionExport(e, filterSet, blankWindow);
    });
  } catch {
    events = logger.getAll().filter((e) => {
      if (!filterSet) return true;
      return includeEventInSessionExport(e, filterSet, blankWindow);
    });
  }
  zip.file('events.json', JSON.stringify(events, null, 2));
  if (sessionsJson != null) zip.file('sessions.json', sessionsJson);

  // Include audio clips (v0.54.0 K1: clipsComplete 검증 및 빈 catch 제거)
  let clipsComplete = true;
  let missingClips = 0;
  try {
    const keys = await loadAllAudioClipKeys();
    for (const key of keys) {
      if (filterSet) {
        const sid = key.split(':')[0];
        if (!filterSet.has(sid)) continue;
      }
      const blob = await loadAudioClip(key);
      if (blob) {
        const ext = blob.type.includes('wav') ? 'wav' : blob.type.includes('mp4') ? 'mp4' : 'webm';
        zip.file(`clips/${key}.${ext}`, blob);
      } else {
        clipsComplete = false;
        missingClips++;
      }
    }
    if (missingClips > 0) {
      logger.log({ type: 'app', extra: `export_clips_incomplete:missing=${missingClips}` });
    }
  } catch (e) {
    clipsComplete = false;
    logger.log({ type: 'app', extra: withErr('export_clips_failed', e) });
  }

  // v0.33.0 항목10-B: screens/ — 자동 화면 캡처(JPEG) + screens-manifest.json. 키
  // `${sessionId}:${ts}:${trigger}` 규약이라 세션 필터·조인이 클립과 동일하게 동작한다.
  // additive-only, 실패해도 export는 성공([REVIEW-1] 빈 catch 금지 — screens_export_failed 로깅).
  try {
    const screenKeys = await loadAllScreenshotKeys();
    const screens: { key: string; sessionId: string; ts: number; trigger: string; bytes: number }[] = [];
    for (const key of screenKeys) {
      const [sid, ts, ...trig] = key.split(':');
      if (filterSet && !filterSet.has(sid)) continue;
      const blob = await loadScreenshot(key);
      if (blob) {
        zip.file(`screens/${key}.jpg`, blob);
        screens.push({ key, sessionId: sid, ts: Number(ts), trigger: trig.join(':'), bytes: blob.size });
      }
    }
    if (screens.length > 0) {
      zip.file(
        'screens-manifest.json',
        JSON.stringify({ schema: 1, appVersion: deviceWithUser.appVersion, screens }, null, 2),
      );
    }
  } catch (e) {
    logger.log({ type: 'app', extra: withErr('screens_export_failed', e) });
  }

  // v0.27.0: clips-manifest.json — 클립 감사(SOP-003 §3) 자동화용 매핑(클립 파일 ↔ 커밋값 ↔
  // confidence ↔ 종류). zip에 실제로 담긴 clips/*만 스캔하므로 목록과 파일이 어긋날 수 없다.
  // additive-only: 기존 엔트리(device/events/sessions/clips)는 불변. 실패해도 export는 성공해야
  // 하며 [REVIEW-1] "빈 catch 금지" — 실패는 manifest_error로 로깅한다.
  try {
    attachClipsManifest(zip, scopedSessions, events as ManifestSourceEvent[], deviceWithUser.appVersion);
  } catch (e) {
    logger.log({ type: 'app', extra: withErr('manifest_error', e) });
  }

  // v0.51.1 R6 — stt-profile.json: 기기 누적 화자 혼동표 프로필(민구 09-02 「사람들 각각의 발음 정보」).
  // additive-only · 세션 필터와 무관하게 기기 전체 프로필을 싣는다(프로필은 세션 경계가 없다).
  // 실패해도 export는 성공([REVIEW-1] 빈 catch 금지 — stt_profile_export_failed 로깅).
  try {
    await hydrateSttProfiles();
    attachSttProfile(zip, listSttProfiles(), deviceWithUser.appVersion, speakerId);
  } catch (e) {
    logger.log({ type: 'app', extra: withErr('stt_profile_export_failed', e) });
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { blob, clipsComplete };
}

/** v0.19.0 W6 — 세션별 개별 zip 생성. 시트 sync 성공 세션들을 **세션당 1개 zip**으로 분리해
 *  각각 업로드할 수 있게 한다(기존: 성공 세션 전체를 통합 1 zip). 각 zip은 `exportLogZip([oneId])`를
 *  그대로 재사용하므로 sessions.json은 단일 세션, clips/도 그 세션 것만 담기며 `__app__` 수명주기
 *  이벤트는 항상 동봉된다(exportLogZip 계약). 복구(recoverFromDrive)는 zip마다 sessions.json의
 *  sessions 배열을 순회하므로 N개 단일세션 zip을 그대로 열거·dedupe한다 — 호환.
 *
 *  파일명은 수확 컨벤션 prefix `growth-log_<date>`를 보존하고 세션 식별자 + 타임스탬프를 덧붙여
 *  rclone 수확/SOP-003과 호환되며 세션 간 충돌하지 않는다:
 *    `growth-log_<YYYY-MM-DD>_<sessionId>_<ts>.zip`
 *  sessionId의 `:` 등 파일명 부적합 문자는 `_`로 정규화한다(현 sessionId는 `sess_<ts>` 형태라
 *  보통 영숫자/underscore지만 방어적으로 처리). */
export interface SessionZip {
  sessionId: string;
  blob: Blob;
  filename: string;
  clipsComplete: boolean;
}

export async function exportLogZipsPerSession(sessionIds: string[]): Promise<SessionZip[]> {
  const date = new Date().toISOString().slice(0, 10);
  const out: SessionZip[] = [];
  for (const id of sessionIds) {
    const { blob, clipsComplete } = await exportLogZipInternal([id]);
    const safeId = id.replace(/[^A-Za-z0-9_-]/g, '_');
    const filename = `growth-log_${date}_${safeId}_${Date.now()}.zip`;
    out.push({ sessionId: id, blob, filename, clipsComplete });
  }
  return out;
}

export function downloadZip(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
