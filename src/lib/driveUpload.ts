import { getAccessToken, getCurrentEmail } from './googleAuth';
import { useSettingsStore } from '../stores/settingsStore';
import { FILES_API, escapeDriveQ, ensureEmailSubFolder, cachedFolderIdFor } from './driveFolders';
import { LEGACY_APP_FOLDER_NAME, DRIVE_ADOPTED_KEY } from './namespaceMigrate';
import { logger } from './logger';

/**
 * Drive log backup target — 관리자(팀 리더) 드라이브의 공유 폴더 ID.
 * 환경변수 VITE_ADMIN_LOGS_FOLDER_ID로 설정. 미설정 시 admin 업로드 단계 건너뜀.
 * 팀원들은 이 폴더에 Editor 권한으로 공유받아야 함.
 */
const LOG_FOLDER_ID =
  import.meta.env.VITE_ADMIN_LOGS_FOLDER_ID || '123Qag3EJK2R4imt0vfeZwvJyvQ3yL-lw';

/**
 * v0.33.0 항목11 — 개선요청(feedback) zip의 관리자 수신 폴더 ID.
 * 환경변수 VITE_ADMIN_FEEDBACK_FOLDER_ID(.env.example 참조). 로그 폴더와 달리 **기본값 없음** —
 * 미설정 시 관리자 레그는 조용히 skip(사용자 Drive 레그만 수행).
 */
export const FEEDBACK_FOLDER_ID = import.meta.env.VITE_ADMIN_FEEDBACK_FOLDER_ID || '';

const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

/** RFC 5322 단순 검증 (Drive 폴더명으로 받기 전에). */
function isLikelyEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function authHeader(): Promise<Record<string, string>> {
  const token = getAccessToken();
  if (!token) throw new Error('Google 로그인이 필요합니다.');
  return { Authorization: `Bearer ${token}` };
}

/** 업로드 작업 단위 인증 스냅샷(TOCTOU — 리뷰 라운드4 Codex High). 이중 업로드는 **작업 진입 시
 *  1회** 캡처해 사용자·관리자 두 레그가 같은 계정으로 완결되게 한다 — 레그 사이에 A→B 재로그인이
 *  끼어도 같은 zip이 user=A/admin=B로 갈라져 귀속되지 않는다. */
interface UploadAuth {
  email: string | null;
  headers: Record<string, string>;
}

/** 스냅샷 캡처. 미로그인이면 null — 각 레그가 자체 authHeader()에서 기존 문구로 실패하게 둔다
 *  (진입 시 throw하면 errors[] 수집 계약이 깨진다). */
function captureUploadAuth(): UploadAuth | null {
  const token = getAccessToken();
  if (!token) return null;
  return { email: getCurrentEmail(), headers: { Authorization: `Bearer ${token}` } };
}

/** zip 업로드. headers를 넘기면 그 인증으로 고정 실행 — 폴더 ensure와 같은 작업 단위에서 계정이
 *  바뀌어도(리뷰 라운드2 Codex High TOCTOU) 다른 계정 토큰으로 남의 폴더에 올리지 않는다.
 *  미지정 시 호출 시점 토큰(단독 업로드 경로용). */
async function uploadZip(
  zipBlob: Blob,
  filename: string,
  parentId?: string,
  headers?: Record<string, string>,
): Promise<string> {
  const metadata: Record<string, unknown> = {
    name: filename,
    mimeType: 'application/zip',
  };
  if (parentId) metadata.parents = [parentId];

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', zipBlob);

  const res = await fetch(UPLOAD_API, {
    method: 'POST',
    headers: headers ?? (await authHeader()),
    body: form,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Drive 업로드 실패: ${err}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

/**
 * 관리자 공유 폴더 내에 팀원 이메일 이름의 하위 폴더를 찾거나 생성한다.
 * Codex 리뷰 반영: race condition 방지를 위해 settingsStore에 캐시, 검색 시 createdTime 정렬로
 * 중복 폴더가 있어도 가장 오래된 것을 선택해 일관성 유지. 공용 로직은 ensureEmailSubFolder
 * (driveFolders.ts — [RACE-6] 계약)로 통합, 여기서는 **로그 폴더 전용** 캐시만 배선한다.
 * v0.35.1(리뷰 Codex High): 캐시는 계정 결합(FolderCache) — 다른 계정의 캐시는 미스 처리.
 */
async function ensureTeamSubFolder(
  parentId: string,
  userEmail: string,
  headers: Record<string, string>,
): Promise<string> {
  return ensureEmailSubFolder(parentId, userEmail, {
    headers,
    readCache: () => cachedFolderIdFor(useSettingsStore.getState().teamFolderCache, userEmail),
    writeCache: (id) => useSettingsStore.getState().set({ teamFolderCache: { email: userEmail, id } }),
    errorLabels: { search: '팀원 폴더 검색 실패', create: '팀원 하위 폴더 생성 실패' },
  });
}

const APP_FOLDER_NAME = 'agri-voicenote';   // v0.50 개명 — namespaceMigrate와 별개로 여기서도 새 이름
const USER_LOG_SUBFOLDER = 'log';

/** 사용자 Drive에서 `name` 폴더를 parent(미지정=루트) 아래에서 검색만 한다(생성 없음).
 *  중복이 있으면 createdTime asc로 가장 오래된 것을 선택해 일관성 유지. 미존재 시 null. */
async function findFolder(name: string, parentId?: string, headersIn?: Record<string, string>): Promise<string | null> {
  const headers = headersIn ?? (await authHeader());
  const safeName = escapeDriveQ(name);
  const parentClause = parentId ? `'${escapeDriveQ(parentId)}' in parents` : `'root' in parents`;
  const q = `${parentClause} and name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchUrl = `${FILES_API}?q=${encodeURIComponent(q)}&fields=files(id,createdTime)&orderBy=createdTime&spaces=drive`;
  const sr = await fetch(searchUrl, { headers });
  if (!sr.ok) {
    const errText = await sr.text().catch(() => `HTTP ${sr.status}`);
    throw new Error(`폴더 검색 실패(${name}): ${errText}`);
  }
  const data = (await sr.json()) as { files?: { id: string }[] };
  return data.files && data.files.length > 0 ? data.files[0].id : null;
}

/** 사용자 Drive에서 `name` 폴더를 parent(미지정=루트) 아래에서 찾거나 생성해 ID 반환. */
async function ensureFolder(name: string, parentId?: string, headersIn?: Record<string, string>): Promise<string> {
  const found = await findFolder(name, parentId, headersIn);
  if (found) return found;
  const headers = headersIn ?? (await authHeader());
  const createRes = await fetch(FILES_API, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  if (!createRes.ok) {
    const err = await createRes.text().catch(() => `HTTP ${createRes.status}`);
    throw new Error(`폴더 생성 실패(${name}): ${err}`);
  }
  const created = (await createRes.json()) as { id: string };
  return created.id;
}

/** v0.50 개명 — 앱 루트 폴더의 **채택(adoption) 경로**. 순서가 계약이다:
 *  ① 새 이름(`agri-voicenote`)이 있으면 그것 — 이미 전환됐다.
 *  ② 구 이름(`survey-011`)만 있으면:
 *     - 🔴 **프리뷰 빌드는 구 폴더를 그대로 쓴다**(rename 금지). github.io는 같은 origin이라
 *       구 정식(v0.48)이 아직 살아 있는데, rename하면 구 앱이 `survey-011`을 **재생성**해
 *       폴더가 갈라진다. 프리뷰가 구 폴더를 쓰면 수확 경로(`gdrive:survey-011/log`)도 불변.
 *     - 정식 빌드는 **rename**(PATCH)으로 채택 — 내용물·폴더 ID가 보존되는 마이그레이션 본체.
 *       rename 실패 시 구 폴더 ID로 계속(업로드는 성공해야 한다 — 유실 없음, 다음 부팅 재시도).
 *  ③ 둘 다 없으면 새 이름으로 생성(신규 사용자).
 *  구 이름 상수는 namespaceMigrate.ts가 SSOT다. */
async function ensureAppFolder(headers: Record<string, string>): Promise<string> {
  const found = await findFolder(APP_FOLDER_NAME, undefined, headers);
  if (found) { markDriveAdopted(); return found; }
  const legacy = await findFolder(LEGACY_APP_FOLDER_NAME, undefined, headers);
  if (legacy) {
    if (typeof __PREVIEW_BUILD__ !== 'undefined' && __PREVIEW_BUILD__) {
      logger.log({ type: 'app', extra: 'ns_drive:legacy_used_preview' });
      return legacy; // 프리뷰는 채택하지 않는다 — 마커도 안 쓴다
    }
    const res = await fetch(`${FILES_API}/${legacy}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: APP_FOLDER_NAME }),
    });
    logger.log({ type: 'app', extra: `ns_drive:${res.ok ? 'renamed' : `rename_fail_${res.status}`}` });
    if (res.ok) markDriveAdopted(); // 실패면 마커 없이 — 다음 기회에 재시도(멱등)
    return legacy; // rename 성공/실패 무관 — 이 ID가 그 폴더다(ID는 rename과 무관하게 불변)
  }
  const created = await ensureFolder(APP_FOLDER_NAME, undefined, headers);
  markDriveAdopted();
  return created;
}

/** 채택 완료 마커 — 🔴 이게 없으면 `userLogFolderCache` 히트가 ensureAppFolder를 영구
 *  우회해서 rename이 영원히 안 일어난다(콜드 리뷰 codex #6). evict돼도 재시도는
 *  검색 1~2회 비용뿐(멱등 — namespaceMigrate.DRIVE_ADOPTED_KEY 주석). */
function markDriveAdopted(): void {
  try { localStorage.setItem(DRIVE_ADOPTED_KEY, '1'); } catch { /* ignore */ }
}

/** 정식 빌드에서 아직 채택 전이면 폴더 캐시를 신뢰하지 않는다 — 캐시된 ID 자체는 rename과
 *  무관하게 유효하지만(ID 불변), 캐시 경로는 rename 기회를 영영 안 준다. */
function driveAdoptionPending(): boolean {
  if (typeof __PREVIEW_BUILD__ !== 'undefined' && __PREVIEW_BUILD__) return false;
  // catch → false는 **의도된 fail-open**이다(codex 2회전 #5 검토·수용): storage 접근이
  // 차단된 환경에서 rename 재시도가 안 일어나지만, 캐시된 폴더 ID는 rename과 무관하게
  // 유효해 업로드는 정상이다 — 잃는 것은 「폴더 표시 이름의 전환 시점」뿐이다.
  try { return localStorage.getItem(DRIVE_ADOPTED_KEY) !== '1'; } catch { return false; }
}

/** 사용자 Drive `agri-voicenote/log/` 폴더 ID (settingsStore 캐시 우선).
 *  v0.35.1 — 캐시는 계정 결합: 같은 기기에서 계정을 바꾸면 다른 사용자 Drive의 폴더 ID가
 *  재사용되지 않는다(불일치 = 재검색). 이메일 미확인 상태면 무캐시로 진행. */
async function ensureUserLogFolder(email: string | null, headers: Record<string, string>): Promise<string> {
  const cached = cachedFolderIdFor(useSettingsStore.getState().userLogFolderCache, email);
  if (cached && !driveAdoptionPending()) return cached;
  const appId = await ensureAppFolder(headers);
  const logId = await ensureFolder(USER_LOG_SUBFOLDER, appId, headers);
  if (email) useSettingsStore.getState().set({ userLogFolderCache: { email, id: logId } });
  return logId;
}

/** 사용자 본인 드라이브 `agri-voicenote/log/` 폴더에 업로드 (v0.4.5 Q1b: 루트 대신 전용 폴더).
 *  v0.35.1(리뷰 라운드3 Codex High): 이메일·토큰을 작업 시작 시 1회 스냅샷해 폴더 탐색·생성·zip
 *  업로드·캐시 기록 전 과정에 주입 — 응답 대기 중 A→B 재로그인이 끼어도 폴더는 B에, 캐시는
 *  {A, B폴더}로 갈라지는 혼입이 생기지 않는다(admin 레그와 동일 방어). */
async function uploadLogToUserDrive(zipBlob: Blob, filename: string, auth?: UploadAuth): Promise<string> {
  const { email, headers } = auth ?? { email: getCurrentEmail(), headers: await authHeader() };
  const folderId = await ensureUserLogFolder(email, headers);
  return uploadZip(zipBlob, filename, folderId, headers);
}

// ─── v0.5.0 W8: 로그 zip 기반 세션 복구 — Drive 읽기 경로 ──────────────────────
// 업로드와 같은 폴더 규약(`agri-voicenote/log` — 전환기 구 폴더 폴백)·캐시(settingsStore.userLogFolderCache)를 재사용하되,
// 복구는 읽기 전용이므로 폴더를 **생성하지 않는다**(없으면 백업도 없음).

/** `agri-voicenote/log`(폴백: 구 `survey-011/log`) 폴더 ID를 검색만으로 찾는다(캐시 우선, 생성 없음). 미존재 시 null. */
export async function findUserLogFolderId(): Promise<string | null> {
  const email = getCurrentEmail();
  const cached = cachedFolderIdFor(useSettingsStore.getState().userLogFolderCache, email);
  if (cached) return cached;
  // v0.50 개명 — 읽기 전용이라 rename·생성 없이 구 이름까지만 폴백한다(W8 복구가
  // 전환 전 백업도 보게). 채택·rename은 업로드 경로(ensureAppFolder)의 몫.
  const appId = (await findFolder(APP_FOLDER_NAME)) ?? (await findFolder(LEGACY_APP_FOLDER_NAME));
  if (!appId) return null;
  const logId = await findFolder(USER_LOG_SUBFOLDER, appId);
  if (logId && email) useSettingsStore.getState().set({ userLogFolderCache: { email, id: logId } });
  return logId;
}

/** 캐시된 로그 폴더 ID 무효화 — 폴더 삭제/이동으로 stale해진 캐시를 재탐색하게 한다. */
export function invalidateUserLogFolderCache(): void {
  if (useSettingsStore.getState().userLogFolderCache) {
    useSettingsStore.getState().set({ userLogFolderCache: null });
  }
}

export interface DriveLogZip {
  id: string;
  name: string;
  createdTime: string;
}

/** 로그 폴더의 zip 목록을 **최신순**(createdTime desc)으로 조회. 페이지네이션 포함. */
export async function listLogZips(folderId: string): Promise<DriveLogZip[]> {
  const headers = await authHeader();
  const q = `'${escapeDriveQ(folderId)}' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'`;
  const files: DriveLogZip[] = [];
  let pageToken: string | undefined;
  do {
    const url =
      `${FILES_API}?q=${encodeURIComponent(q)}` +
      `&fields=${encodeURIComponent('nextPageToken,files(id,name,createdTime)')}` +
      `&orderBy=${encodeURIComponent('createdTime desc')}&pageSize=100&spaces=drive` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      throw new Error(`로그 목록 조회 실패: ${errText}`);
    }
    const data = (await res.json()) as { nextPageToken?: string; files?: DriveLogZip[] };
    files.push(...(data.files ?? []).filter((f) => f.name.toLowerCase().endsWith('.zip')));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}

/** Drive 파일 본문 다운로드 (zip 바이너리). 복구 시에만 호출 — 평시 네트워크 0. */
export async function downloadDriveFile(fileId: string): Promise<Blob> {
  const headers = await authHeader();
  const res = await fetch(`${FILES_API}/${encodeURIComponent(fileId)}?alt=media`, { headers });
  if (!res.ok) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`로그 다운로드 실패: ${errText}`);
  }
  return res.blob();
}

/** 관리자 공유 폴더 내 {userEmail}/ 하위 폴더에 업로드.
 *  Codex 리뷰: 이메일은 토큰의 검증된 값(`getCurrentEmail`)을 사용 — settingsStore stale 방지.
 *  v0.35.1(리뷰 라운드2 Codex High, TOCTOU): 이메일·토큰을 작업 시작 시 **한 번만** 확정해 폴더
 *  ensure와 zip 업로드 양쪽에 주입 — 네트워크 대기 중 A→B 재로그인이 끼어도 B 토큰으로 A 폴더에
 *  올리는 혼입이 생기지 않는다(양쪽 다 A 인증으로 완결되거나 A 토큰 만료로 실패). */
async function uploadLogToAdminTeamFolder(zipBlob: Blob, filename: string, auth?: UploadAuth): Promise<string> {
  if (!LOG_FOLDER_ID) throw new Error('관리자 폴더 ID 미설정');
  const resolved = auth ?? { email: getCurrentEmail(), headers: await authHeader() };
  const verifiedEmail = resolved.email;
  if (!verifiedEmail || !isLikelyEmail(verifiedEmail)) {
    throw new Error('토큰에서 검증된 이메일을 가져올 수 없음');
  }
  const teamFolderId = await ensureTeamSubFolder(LOG_FOLDER_ID, verifiedEmail, resolved.headers);
  return uploadZip(zipBlob, filename, teamFolderId, resolved.headers);
}

export interface DualUploadResult {
  userDriveId?: string;
  adminDriveId?: string;
  /** 관리자 폴더가 설정되어 있는지 — backupOk 판정에 사용. */
  adminConfigured: boolean;
  errors: string[];
}

/** v0.35.1 Stage 1-3 — 사용자 Drive + 관리자 폴더 이중 업로드 공용 골격. 한 레그 실패해도 다른
 *  레그는 진행하고, 실패는 기존 접두('user_drive: '/'admin_drive: ') 그대로 errors[]에 쌓는다
 *  (로그 zip 하위호환). 레그별 실패 후처리(캐시 무효화 등)는 훅으로 주입한다. */
async function uploadToBothLegs(opts: {
  adminConfigured: boolean;
  userLeg: () => Promise<string>;
  adminLeg: () => Promise<string>;
  onUserError?: () => void;
  onAdminError?: () => void;
  /** 🔴 v0.50 r2 [UA-2] — **이미 성공한 레그를 다시 올리지 않는다.**
   *  인증 실패 재시도는 「하나라도 인증 오류면」 돈다. admin만 401이고 user는 성공한 경우
   *  재시도가 두 레그를 다시 올려 **user Drive에 같은 파일이 두 개** 생겼다.
   *  결과의 부분 성공은 보존되지만 **부수효과(중복 파일)는 못 막는다** — 그래서 여기서 건너뛴다.
   *  건너뛴 레그의 id는 호출자가 넘긴 값을 그대로 돌려준다(결과 합성은 호출자 몫이 아니다). */
  keep?: { userDriveId?: string; adminDriveId?: string };
}): Promise<DualUploadResult> {
  const result: DualUploadResult = { errors: [], adminConfigured: opts.adminConfigured };
  if (opts.keep?.userDriveId) {
    result.userDriveId = opts.keep.userDriveId;
  } else {
    try {
      result.userDriveId = await opts.userLeg();
    } catch (e) {
      result.errors.push(`user_drive: ${e instanceof Error ? e.message : String(e)}`);
      opts.onUserError?.();
    }
  }
  if (opts.adminConfigured) {
    if (opts.keep?.adminDriveId) {
      result.adminDriveId = opts.keep.adminDriveId;
    } else {
      try {
        result.adminDriveId = await opts.adminLeg();
      } catch (e) {
        result.errors.push(`admin_drive: ${e instanceof Error ? e.message : String(e)}`);
        opts.onAdminError?.();
      }
    }
  }
  return result;
}

/** 사용자 본인 드라이브 + 관리자 공유 폴더 둘 다 업로드. 하나 실패해도 다른 쪽은 진행. */
export async function uploadLogToBothDrives(
  zipBlob: Blob,
  filename: string,
  /** v0.50 r2 [UA-2] — 인증 재시도에서 **이미 성공한 레그**를 넘긴다(그 레그는 다시 안 올린다). */
  keep?: { userDriveId?: string; adminDriveId?: string },
): Promise<DualUploadResult> {
  const auth = captureUploadAuth(); // 작업 단위 스냅샷 — 두 레그가 같은 계정으로 완결
  return uploadToBothLegs({
    keep,
    adminConfigured: !!LOG_FOLDER_ID,
    userLeg: () => uploadLogToUserDrive(zipBlob, filename, auth ?? undefined),
    adminLeg: () => uploadLogToAdminTeamFolder(zipBlob, filename, auth ?? undefined),
    // 캐시된 폴더 ID가 삭제/이동돼 실패했을 수 있음 — 무효화해 다음 시도에 재탐색/재생성.
    onUserError: () => {
      if (useSettingsStore.getState().userLogFolderCache) {
        useSettingsStore.getState().set({ userLogFolderCache: null });
      }
    },
    onAdminError: () => {
      if (useSettingsStore.getState().teamFolderCache) {
        useSettingsStore.getState().set({ teamFolderCache: null });
      }
    },
  });
}

// ─── v0.33.0 항목11 — 개선요청(feedback) 이중 업로드 ─────────────────────────

const USER_FEEDBACK_SUBFOLDER = 'feedback';

/** 사용자 Drive `agri-voicenote/feedback/` 폴더 ID. 로그 폴더(userLogFolderCache)와 달리 별도
 *  settings 캐시를 두지 않는다 — 개선요청은 빈도가 낮아 검색 2회 비용이 무해하고, persist 필드
 *  추가(마이그레이션 비용)를 피한다. */
async function ensureUserFeedbackFolder(headers: Record<string, string>): Promise<string> {
  const appId = await ensureAppFolder(headers);
  return ensureFolder(USER_FEEDBACK_SUBFOLDER, appId, headers);
}

/** 관리자 feedback 폴더 내 {userEmail}/ 하위 폴더를 찾거나 생성한다.
 *  ⚠️ **무캐시**인 이유([RACE-6] parent별 캐시 분리): settingsStore.teamFolderCache는 **로그
 *  폴더의** 하위 폴더 ID를 담고 있어, 다른 parent(feedback 폴더)에 재사용하면 로그 하위 폴더로
 *  오업로드된다. 개선요청은 빈도가 낮아 검색 비용이 무해하고 persist 필드 추가도 피한다(v0.33.0). */
async function ensureFeedbackSubFolder(
  parentId: string,
  userEmail: string,
  headers: Record<string, string>,
): Promise<string> {
  return ensureEmailSubFolder(parentId, userEmail, {
    headers,
    errorLabels: { search: '피드백 하위 폴더 검색 실패', create: '피드백 하위 폴더 생성 실패' },
  });
}

/** 사용자 Drive `agri-voicenote/feedback/`에 업로드. TOCTOU — 로그 사용자 레그와 동일하게 토큰을
 *  작업 시작 시 1회 스냅샷해 전 과정에 주입. */
export async function uploadFeedbackToUserDrive(zipBlob: Blob, filename: string, auth?: UploadAuth): Promise<string> {
  const headers = auth?.headers ?? (await authHeader());
  const folderId = await ensureUserFeedbackFolder(headers);
  return uploadZip(zipBlob, filename, folderId, headers);
}

/** 관리자 feedback 폴더의 {검증된 이메일}/ 하위 폴더에 업로드. FEEDBACK_FOLDER_ID 미설정이면 throw
 *  하지 않도록 호출 전에 adminConfigured로 분기할 것(uploadFeedbackToBothDrives가 담당). */
export async function uploadFeedbackToAdminFolder(zipBlob: Blob, filename: string, auth?: UploadAuth): Promise<string> {
  if (!FEEDBACK_FOLDER_ID) throw new Error('관리자 피드백 폴더 ID 미설정');
  const resolved = auth ?? { email: getCurrentEmail(), headers: await authHeader() };
  const verifiedEmail = resolved.email;
  if (!verifiedEmail || !isLikelyEmail(verifiedEmail)) {
    throw new Error('토큰에서 검증된 이메일을 가져올 수 없음');
  }
  const subId = await ensureFeedbackSubFolder(FEEDBACK_FOLDER_ID, verifiedEmail, resolved.headers);
  return uploadZip(zipBlob, filename, subId, resolved.headers);
}

/** 개선요청 이중 업로드 결과 — DualUploadResult와 동일 형태(adminConfigured=FEEDBACK_FOLDER_ID
 *  설정 여부, 미설정이면 admin 레그는 '해당 없음'). */
export type FeedbackUploadResult = DualUploadResult;

/** 사용자 Drive + 관리자 폴더 이중 업로드(uploadToBothLegs 공용 골격). 한 레그 실패해도 다른
 *  레그는 진행. 관리자 레그 실패는 non-fatal — 호출자(feedback.ts)가 사용자 레그 성공 시 성공
 *  처리하고 관리자 레그만 재시도 큐에 남긴다(캐시가 없는 경로라 실패 훅도 없음). */
export async function uploadFeedbackToBothDrives(
  zipBlob: Blob,
  filename: string,
): Promise<FeedbackUploadResult> {
  const auth = captureUploadAuth(); // 작업 단위 스냅샷 — 두 레그가 같은 계정으로 완결
  return uploadToBothLegs({
    adminConfigured: !!FEEDBACK_FOLDER_ID,
    userLeg: () => uploadFeedbackToUserDrive(zipBlob, filename, auth ?? undefined),
    adminLeg: () => uploadFeedbackToAdminFolder(zipBlob, filename, auth ?? undefined),
  });
}
