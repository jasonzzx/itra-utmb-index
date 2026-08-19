import { webcrypto } from 'node:crypto';
import { outboundFetch } from './http';
import type { ItraIndex } from './types';

const ORIGIN = 'https://itra.run';
const FIND_PAGE = `${ORIGIN}/Runners/FindARunner`;
const FIND_API = `${ORIGIN}/api/runner/find`;

/**
 * ITRA's WAF returns 403 for requests without a browser User-Agent, so we have
 * to present as one. Everything else here is a plain public search.
 */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const TOKEN_RE =
  /name="__RequestVerificationToken"[^>]*\bvalue="([^"]+)"/;

/**
 * ITRA is fronted by AWS WAF Bot Control. When it decides to challenge us it
 * answers 202 with an `x-amzn-waf-action: challenge` header and a page whose
 * only content is a JavaScript challenge. That is an access control, so we
 * report it plainly rather than trying to defeat it — see the README for the
 * OUTBOUND_PROXY_URL escape hatch.
 */
export class ItraChallengedError extends Error {
  constructor() {
    super(
      'ITRA returned an AWS WAF bot challenge. Set OUTBOUND_PROXY_URL to route ' +
        'ITRA requests through a proxy with a non-datacenter IP.',
    );
    this.name = 'ItraChallengedError';
  }
}

function assertNotChallenged(res: Response): void {
  if (
    res.headers.get('x-amzn-waf-action') === 'challenge' ||
    res.status === 202
  ) {
    throw new ItraChallengedError();
  }
}

interface ItraSession {
  token: string;
  cookie: string;
  acquiredAt: number;
}

/**
 * The CSRF token expires within minutes. We hold it briefly so a single batch
 * of lookups shares one handshake (measured: 5 parallel searches in 0.6s), but
 * never long enough to go stale mid-request.
 */
const SESSION_TTL_MS = 5 * 60_000;
let cachedSession: ItraSession | null = null;

/** Raw runner record as it appears inside the decrypted ITRA payload. */
interface ItraRawRunner {
  RunnerId: number;
  FirstName: string;
  LastName: string;
  Nationality: string;
  Code: string;
  Gender: string;
  AgeGroup: string;
  RecentRaces: string;
  ProfilePic: string;
  Pi: number;
  PiIndex: string;
  ColorCode: string;
}

interface ItraEncryptedResponse {
  response1: string; // ciphertext
  response2: string; // iv
  response3: string; // key
}

function b64(input: string): Uint8Array {
  return Uint8Array.from(Buffer.from(input, 'base64'));
}

/**
 * ITRA ships the AES-256-CBC key and IV alongside the ciphertext; the browser
 * decrypts in WebCrypto. We do the same server-side. WebCrypto strips the
 * PKCS#7 padding for us.
 */
export async function decryptResponse(
  payload: ItraEncryptedResponse,
): Promise<unknown> {
  const key = await webcrypto.subtle.importKey(
    'raw',
    b64(payload.response3),
    { name: 'AES-CBC' },
    false,
    ['decrypt'],
  );
  const plaintext = await webcrypto.subtle.decrypt(
    { name: 'AES-CBC', iv: b64(payload.response2) },
    key,
    b64(payload.response1),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function acquireSession(): Promise<ItraSession> {
  const res = await outboundFetch(FIND_PAGE, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    cache: 'no-store',
  });
  assertNotChallenged(res);
  if (!res.ok) {
    throw new Error(`ITRA search page returned ${res.status}`);
  }
  const html = await res.text();
  const match = TOKEN_RE.exec(html);
  if (!match) {
    throw new Error('ITRA anti-forgery token not found on search page');
  }
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return { token: match[1], cookie, acquiredAt: Date.now() };
}

async function getSession(forceFresh = false): Promise<ItraSession> {
  const fresh =
    cachedSession && Date.now() - cachedSession.acquiredAt < SESSION_TTL_MS;
  if (!forceFresh && fresh && cachedSession) return cachedSession;
  cachedSession = await acquireSession();
  return cachedSession;
}

async function postSearch(
  name: string,
  count: number,
  session: ItraSession,
): Promise<Response> {
  // `nationality` must be present even when empty — omitting it yields a 400.
  const body = new URLSearchParams({
    name,
    nationality: '',
    start: '0',
    count: String(count),
    echoToken: '1',
  });
  return outboundFetch(FIND_API, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-TOKEN': session.token,
      Origin: ORIGIN,
      Referer: FIND_PAGE,
      Accept: '*/*',
      ...(session.cookie ? { Cookie: session.cookie } : {}),
    },
    body,
    cache: 'no-store',
  });
}

function toIndex(raw: ItraRawRunner): ItraIndex {
  const name = `${raw.FirstName} ${raw.LastName}`.trim();
  const isDefaultPic = raw.ProfilePic?.includes('default');
  return {
    runnerId: raw.RunnerId,
    name,
    pi: raw.Pi,
    piIndex: raw.PiIndex?.trim() ?? '',
    colorCode: raw.ColorCode ?? '#888888',
    nationality: raw.Nationality ?? '',
    gender: raw.Gender ?? '',
    ageGroup: raw.AgeGroup?.trim() ?? '',
    recentRaces: (raw.RecentRaces ?? '')
      .split('|')
      .map((r) => r.trim())
      .filter(Boolean),
    profileUrl: `${ORIGIN}/RunnerSpace/${encodeURIComponent(
      `${raw.LastName}.${raw.FirstName}`,
    )}/${raw.RunnerId}`,
    photoUrl:
      raw.ProfilePic && !isDefaultPic ? `${ORIGIN}${raw.ProfilePic}` : null,
  };
}

/**
 * Search ITRA by name. Retries once with a fresh session on 400/403, which is
 * what a stale anti-forgery token looks like.
 */
export async function searchItra(
  name: string,
  count = 10,
): Promise<ItraIndex[]> {
  if (name.trim().length < 2) return [];

  let session = await getSession();
  let res = await postSearch(name, count, session);

  if (res.status === 400 || res.status === 403) {
    cachedSession = null;
    session = await getSession(true);
    res = await postSearch(name, count, session);
  }
  assertNotChallenged(res);
  if (!res.ok) {
    throw new Error(`ITRA search failed with ${res.status}`);
  }

  const payload = (await res.json()) as ItraEncryptedResponse;
  const decoded = (await decryptResponse(payload)) as {
    Results?: ItraRawRunner[];
  };
  return (decoded.Results ?? []).map(toIndex);
}

/**
 * ITRA's per-runner endpoints require auth (401), so a pinned runner is
 * refreshed by re-searching their name and matching on RunnerId.
 */
export async function fetchItraIndex(
  name: string,
  runnerId?: number,
): Promise<ItraIndex | null> {
  const results = await searchItra(name, 25);
  if (runnerId != null) {
    return results.find((r) => r.runnerId === runnerId) ?? null;
  }
  return results[0] ?? null;
}

/** Test seam: drop the held session. */
export function resetItraSession(): void {
  cachedSession = null;
}
