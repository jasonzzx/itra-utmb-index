import { webcrypto } from 'node:crypto';
import { outboundFetch } from './http';
import { itraProfileUrl } from './urls';
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
 * ITRA is fronted by AWS WAF Bot Control, which has two ways of turning us
 * away, and they need telling apart because they look nothing alike:
 *
 * - **challenge** — `202` with `x-amzn-waf-action: challenge` and a page whose
 *   only content is a JavaScript challenge.
 * - **block** — a bare `403` with no distinguishing header.
 *
 * Both are access controls. This reports them plainly and backs off; it does
 * not try to defeat either. `OUTBOUND_PROXY_URL` (see src/lib/http.ts) is the
 * supported way to reach ITRA from a network it refuses.
 */
export abstract class ItraAccessError extends Error {}

export class ItraChallengedError extends ItraAccessError {
  constructor() {
    super(
      'ITRA returned an AWS WAF bot challenge, so this network cannot reach it. ' +
        'Set OUTBOUND_PROXY_URL to route ITRA requests through a proxy with a ' +
        'non-datacenter IP. UTMB figures are unaffected.',
    );
    this.name = 'ItraChallengedError';
  }
}

export class ItraBlockedError extends ItraAccessError {
  constructor() {
    super(
      'ITRA blocked this request (HTTP 403), which usually means its bot ' +
        'protection has blocked the IP the app runs from — datacenter ranges ' +
        'like serverless hosting are the common case. Run `npm run doctor` from ' +
        'that environment to confirm, and set OUTBOUND_PROXY_URL to route ITRA ' +
        'through a proxy. UTMB figures are unaffected.',
    );
    this.name = 'ItraBlockedError';
  }
}

/**
 * Cooldown after a block. Retrying into a wall only deepens the block and
 * costs the user latency for a result that cannot arrive, so once ITRA says no
 * we stop asking for a while.
 */
const BLOCK_COOLDOWN_MS = 60_000;
let blockedUntil = 0;
let lastAccessMessage: string | null = null;

/**
 * Why ITRA is currently refusing us, if it is.
 *
 * Needed because errors thrown inside a `'use cache'` function are replaced by
 * React with "the specific message is omitted in production builds" before any
 * caller sees them. Recording the reason here lets the API route report what
 * actually happened instead of that placeholder.
 */
export function itraAccessNotice(): string | null {
  return Date.now() < blockedUntil ? lastAccessMessage : null;
}

function assertNotBlocked(res: Response): void {
  // Order matters: a challenge can arrive with a non-202 status, so the header
  // is checked before the status code.
  if (res.headers.get('x-amzn-waf-action') === 'challenge' || res.status === 202) {
    throw recordAccessError(new ItraChallengedError());
  }
  if (res.status === 403) {
    throw recordAccessError(new ItraBlockedError());
  }
}

function recordAccessError<E extends ItraAccessError>(err: E): E {
  blockedUntil = Date.now() + BLOCK_COOLDOWN_MS;
  lastAccessMessage = err.message;
  return err;
}

/** Fail fast while a block is in force, without making a request. */
function assertNotCoolingDown(): void {
  if (Date.now() < blockedUntil) {
    throw lastAccessMessage
      ? Object.assign(new ItraBlockedError(), { message: lastAccessMessage })
      : new ItraBlockedError();
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

/**
 * The handshake in flight, shared by everyone waiting on it.
 *
 * Without this, concurrent callers each ran their own. `/api/indexes` fans out
 * over a runner list, so a cold cache meant one token-page fetch per runner
 * arriving at once — exactly the burst bot protection blocks on, and the app
 * doing it to itself.
 */
let sessionInFlight: Promise<ItraSession> | null = null;

/**
 * Ceiling on ITRA requests in flight at once, whatever the callers do.
 *
 * `searchItraWindow` wants 5 pages and `/api/indexes` fans out over a whole
 * list; neither should turn into a burst against a host that is watching for
 * exactly that. Requests queue instead.
 */
const MAX_CONCURRENT = 2;
let running = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** Test seam: how many ITRA requests are in flight right now. */
export function itraInFlight(): number {
  return running;
}

/**
 * ITRA refuses to return more than 49 rows however large `count` is
 * (count=100 and count=200 both yield 49), so bigger pages have to be reached
 * with `start` instead.
 */
const ITRA_MAX_COUNT = 50;
export const ITRA_MAX_PAGE = ITRA_MAX_COUNT - 1;

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
  assertNotCoolingDown();
  const res = await withSlot(() =>
    outboundFetch(FIND_PAGE, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      cache: 'no-store',
    }),
  );
  assertNotBlocked(res);
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

  // Everyone arriving while a handshake is running waits on that one.
  sessionInFlight ??= acquireSession()
    .then((session) => {
      cachedSession = session;
      return session;
    })
    .finally(() => {
      sessionInFlight = null;
    });

  return sessionInFlight;
}

async function postSearch(
  name: string,
  count: number,
  start: number,
  session: ItraSession,
): Promise<Response> {
  // `nationality` must be present even when empty — omitting it yields a 400.
  const body = new URLSearchParams({
    name,
    nationality: '',
    start: String(start),
    count: String(count),
    echoToken: '1',
  });
  return withSlot(() =>
    outboundFetch(FIND_API, {
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
    }),
  );
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
 * Search ITRA by name. Retries once with a fresh session on 400, which is what
 * a stale anti-forgery token looks like.
 *
 * A 403 is deliberately *not* retried. It means bot protection turned us away,
 * and re-handshaking immediately only sends another pair of requests into the
 * same wall — with a fan-out over a runner list that turned one refusal into
 * sixteen requests.
 */
export async function searchItra(
  name: string,
  count = 10,
  start = 0,
): Promise<ItraIndex[]> {
  if (name.trim().length < 2) return [];
  assertNotCoolingDown();

  // ITRA returns one fewer row than `count` asks for — measured at
  // count=3→2, 6→5, 26→25, 50→49 — so request one extra and trim. Above
  // ITRA_MAX_COUNT the server caps the page regardless of what we send.
  const requested = Math.min(count + 1, ITRA_MAX_COUNT);

  let session = await getSession();
  let res = await postSearch(name, requested, start, session);

  if (res.status === 400) {
    cachedSession = null;
    session = await getSession(true);
    res = await postSearch(name, requested, start, session);
  }
  assertNotBlocked(res);
  if (!res.ok) {
    throw new Error(`ITRA search failed with ${res.status}`);
  }

  const payload = (await res.json()) as ItraEncryptedResponse;
  const decoded = (await decryptResponse(payload)) as {
    Results?: ItraRawRunner[];
  };
  return (decoded.Results ?? []).slice(0, count).map(toIndex);
}

/**
 * Fetch up to `want` runners by issuing parallel requests across ITRA's 49-row
 * ceiling.
 *
 * The pages go out together rather than in sequence because they share one held
 * CSRF session — four concurrent requests measured 0.85s total. A page that
 * comes back short means the result set ended, so everything past it is
 * discarded rather than trusted: ITRA's own `ResultCount` disagrees with the
 * true total (it reports 147 for "croft" where reads succeed to 149).
 */
export async function searchItraWindow(
  name: string,
  want: number,
): Promise<ItraIndex[]> {
  if (name.trim().length < 2 || want <= 0) return [];

  const pageCount = Math.ceil(want / ITRA_MAX_PAGE);

  // Fetch the first page alone before committing to the rest. A full-name
  // search — the common case — returns a handful of runners, so a short first
  // page means the other pages would have been fetched only to be discarded.
  // "Elliot Croft" returns one runner: one request instead of five.
  const first = await searchItra(name, ITRA_MAX_PAGE, 0);
  if (first.length < ITRA_MAX_PAGE || pageCount === 1) {
    return first.slice(0, want);
  }

  const rest = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, i) =>
      searchItra(name, ITRA_MAX_PAGE, (i + 1) * ITRA_MAX_PAGE),
    ),
  );

  const out = [...first];
  for (const page of rest) {
    out.push(...page);
    if (page.length < ITRA_MAX_PAGE) break; // end of the result set
  }
  return out.slice(0, want);
}

/**
 * The runner's own page resolves by id alone — see `itraProfileUrl`. The slug
 * on the canonical URL is not a name we can search with (it strips the spaces
 * out of a surname, so Kilian's "jornetburgada" finds nobody), but we never
 * need one, because the id is enough.
 */

/** The page hands its view model to the client as `var Model = {...}`. */
const MODEL_MARKER = 'var Model = ';

/**
 * Cut the JSON object out of the inline script by matching braces.
 *
 * A regex can't do this: the object is 200KB of nested records containing
 * every brace and quote you can think of, so the end has to be found by
 * counting, with string literals and their escapes skipped over.
 */
export function extractPageModel(html: string): unknown {
  const marker = html.indexOf(MODEL_MARKER);
  if (marker === -1) return null;
  const start = html.indexOf('{', marker + MODEL_MARKER.length);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** The per-category indexes the page carries; category 0 is the general one. */
interface ItraPagePerformance {
  pi: number | null;
  categoryId: number;
  piIndex: string | null;
  backGroundColor: string | null;
}

interface ItraPageModel {
  runnerId?: number;
  firstName?: string | null;
  lastName?: string | null;
  nationality?: string | null;
  gender?: string | null;
  ageGroup?: string | null;
  performanceIndex?: number | null;
  profilePicture?: string | null;
  performanceIndicatorInfos?: ItraPagePerformance[] | null;
}

function pageToIndex(model: ItraPageModel): ItraIndex | null {
  if (typeof model.runnerId !== 'number') return null;
  const general = (model.performanceIndicatorInfos ?? []).find(
    (p) => p?.categoryId === 0,
  );
  const isDefaultPic = model.profilePicture?.includes('default');
  return {
    runnerId: model.runnerId,
    name: `${model.firstName ?? ''} ${model.lastName ?? ''}`.trim(),
    pi: (model.performanceIndex ?? general?.pi ?? null) as number,
    // The page hyphenates what search spaces — "Elite-1" vs "Elite 1" — and
    // the two have to agree, because a card may be painted from either.
    piIndex: (general?.piIndex ?? '').replace(/-/g, ' ').trim(),
    colorCode: general?.backGroundColor ?? '#888888',
    nationality: model.nationality ?? '',
    gender: model.gender ?? '',
    // The page prefixes the band with the gender ("M 35-39"); search doesn't.
    ageGroup: (model.ageGroup ?? '').replace(/^[MF]\s+/, '').trim(),
    // Results load over a later request the page makes for itself, so this
    // route simply has none to offer.
    recentRaces: [],
    profileUrl: itraProfileUrl(model.runnerId),
    photoUrl:
      model.profilePicture && !isDefaultPic
        ? `${ORIGIN}${model.profilePicture}`
        : null,
  };
}

/**
 * Look a runner up by id, straight off their public profile page.
 *
 * Their private API endpoints answer 401, but the page itself is public and
 * embeds the index, so this is the one exact lookup available — no name, no
 * anti-forgery handshake, and no chance of landing on a namesake.
 */
export async function fetchItraProfile(
  runnerId: number,
): Promise<ItraIndex | null> {
  assertNotCoolingDown();
  const res = await withSlot(() =>
    outboundFetch(itraProfileUrl(runnerId), {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      cache: 'no-store',
    }),
  );
  assertNotBlocked(res);
  // An id nobody holds is a 404, which is an answer rather than a failure.
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`ITRA runner page returned ${res.status}`);
  }

  const model = extractPageModel(await res.text()) as ItraPageModel | null;
  if (!model) {
    throw new Error('ITRA runner page did not contain a runner');
  }
  const index = pageToIndex(model);
  // A redirect to somebody else would be worse than no answer at all.
  return index && index.runnerId === runnerId ? index : null;
}

/**
 * The index for one runner.
 *
 * Search comes first because it carries the recent races a card shows, but it
 * only reaches the first 25 rows for a name — not enough for a common one —
 * so a pinned runner it misses is fetched from their profile page instead.
 * Without a pin there is nothing to verify against, so the top row is it.
 */
export async function fetchItraIndex(
  name: string,
  runnerId?: number,
): Promise<ItraIndex | null> {
  if (runnerId != null) {
    const results = name.trim().length >= 2 ? await searchItra(name, 25) : [];
    return (
      results.find((r) => r.runnerId === runnerId) ??
      (await fetchItraProfile(runnerId))
    );
  }
  const results = await searchItra(name, 25);
  return results[0] ?? null;
}

/** Test seam: drop the held session. */
export function resetItraSession(): void {
  cachedSession = null;
  sessionInFlight = null;
  blockedUntil = 0;
}
