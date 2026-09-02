/**
 * v0.51.1 R6 — **화자 식별자.** 로그인 계정 이메일의 SHA-256 앞 8자(hex). PII 최소화 — 이메일 원문은
 * `device.json`(export)에 이미 있으므로 이벤트·프로필에는 해시만 싣는다(민구 09-02: *"사용자마다 같은
 * 숫자에 대한 발음은 다 달라 … 사람들 각각의 발음에 대한 정보들 모아서"*).
 *
 * 🔴 `crypto.subtle.digest`는 **비동기**인데 `session start` 로그는 동기 지점에서 방출된다 — 그래서
 * 앱 부팅·세션 시작의 기존 await 뒤에서 `ensureSpeakerId()`로 미리 계산해 두고, 방출 지점은
 * `getSpeakerId()`(캐시)를 읽는다. 미로그인이면 `anon`, subtle이 없으면(비보안 컨텍스트) `nosubtle`.
 */
import { getCurrentEmail } from './googleTokenStore';

const SPEAKER_ANON = 'anon';
const SPEAKER_NOSUBTLE = 'nosubtle';

let cachedEmail: string | null | undefined;
let cachedId: string = SPEAKER_ANON;

async function sha256Hex8(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return SPEAKER_NOSUBTLE;
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf).slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 현재 로그인 이메일 기준 화자 id를 계산·캐시한다(이메일이 바뀌면 재계산). */
export async function ensureSpeakerId(): Promise<string> {
  const email = getCurrentEmail();
  if (email === cachedEmail) return cachedId;
  const id = email ? await sha256Hex8(email.trim().toLowerCase()) : SPEAKER_ANON;
  cachedEmail = email;
  cachedId = id;
  return id;
}

/** 캐시된 화자 id(동기). `ensureSpeakerId()`가 아직 안 돌았으면 `anon`. */
export function getSpeakerId(): string {
  return cachedId;
}
