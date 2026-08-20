import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fixture from './fixtures/itra-encrypted.json';

const TOKEN_PAGE = (token: string) =>
  `<html><body><form><input name="__RequestVerificationToken" type="hidden" value="${token}" /></form></body></html>`;

/** Build a Response-ish object with the header lookups the lib performs. */
function res(
  body: unknown,
  init: { status?: number; headers?: Record<string, string>; text?: string } = {},
) {
  const status = init.status ?? 200;
  const headers = new Headers(init.headers ?? {});
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: Object.assign(headers, { getSetCookie: () => ['Lang=en; path=/'] }),
    json: async () => body,
    text: async () => init.text ?? '',
  } as unknown as Response;
}

const outboundFetch = vi.fn();
vi.mock('@/lib/http', () => ({
  outboundFetch: (...args: unknown[]) => outboundFetch(...args),
  outboundDispatcher: () => undefined,
  resetOutboundDispatcher: () => {},
}));

const { searchItra, fetchItraIndex, decryptResponse, resetItraSession, ItraChallengedError } =
  await import('@/lib/itra');

beforeEach(() => {
  outboundFetch.mockReset();
  resetItraSession();
});
afterEach(() => resetItraSession());

describe('decryptResponse', () => {
  it('decrypts the AES-CBC payload ITRA ships', async () => {
    const decoded = (await decryptResponse(fixture)) as { Results: unknown[] };
    expect(decoded.Results).toHaveLength(2);
    expect((decoded.Results[0] as { Pi: number }).Pi).toBe(939);
  });

  it('rejects a payload encrypted with a different key', async () => {
    const wrongKey = Buffer.alloc(32, 7).toString('base64');
    await expect(
      decryptResponse({ ...fixture, response3: wrongKey }),
    ).rejects.toThrow();
  });
});

describe('searchItra', () => {
  it('acquires a token then returns normalized runners', async () => {
    outboundFetch
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('tok-1') }))
      .mockResolvedValueOnce(res(fixture));

    const results = await searchItra('jornet');

    expect(results[0]).toMatchObject({
      runnerId: 2704,
      pi: 939,
      piIndex: 'Elite 1',
      nationality: 'Spain',
      ageGroup: '35-39',
    });
    // RecentRaces is a pipe-delimited string upstream.
    expect(results[0].recentRaces).toHaveLength(2);
    expect(results[0].profileUrl).toContain('/2704');

    // The CSRF token from the page must be echoed in the POST header.
    const [, postInit] = outboundFetch.mock.calls[1];
    expect((postInit.headers as Record<string, string>)['X-CSRF-TOKEN']).toBe('tok-1');
    // `nationality` must be present even when blank or ITRA 400s.
    expect(String(postInit.body)).toContain('nationality=');
  });

  it('drops the default avatar rather than linking a placeholder', async () => {
    outboundFetch
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('tok') }))
      .mockResolvedValueOnce(res(fixture));
    const results = await searchItra('runner');
    expect(results[1].photoUrl).toBeNull();
  });

  it('retries once with a fresh token when the old one has expired', async () => {
    outboundFetch
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('stale') })) // page
      .mockResolvedValueOnce(res(null, { status: 400 })) // expired token
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('fresh') })) // new page
      .mockResolvedValueOnce(res(fixture)); // success

    const results = await searchItra('jornet');

    expect(results).toHaveLength(2);
    expect(outboundFetch).toHaveBeenCalledTimes(4);
    const [, retryInit] = outboundFetch.mock.calls[3];
    expect((retryInit.headers as Record<string, string>)['X-CSRF-TOKEN']).toBe('fresh');
  });

  it('gives up after a single retry instead of looping', async () => {
    outboundFetch
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('a') }))
      .mockResolvedValueOnce(res(null, { status: 400 }))
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('b') }))
      .mockResolvedValueOnce(res(null, { status: 400 }));

    await expect(searchItra('jornet')).rejects.toThrow(/400/);
    expect(outboundFetch).toHaveBeenCalledTimes(4);
  });

  it('reuses a warm session across calls so a batch does one handshake', async () => {
    outboundFetch
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('tok') }))
      .mockResolvedValue(res(fixture));

    await searchItra('aa');
    await searchItra('bb');
    await searchItra('cc');

    // 1 page fetch + 3 searches, not 3 page fetches.
    expect(outboundFetch).toHaveBeenCalledTimes(4);
  });

  it('reports the AWS WAF challenge distinctly', async () => {
    outboundFetch.mockResolvedValueOnce(
      res(null, { status: 202, headers: { 'x-amzn-waf-action': 'challenge' } }),
    );
    await expect(searchItra('jornet')).rejects.toBeInstanceOf(ItraChallengedError);
  });

  it('surfaces a missing token rather than silently returning nothing', async () => {
    outboundFetch.mockResolvedValueOnce(res(null, { text: '<html>no form</html>' }));
    await expect(searchItra('jornet')).rejects.toThrow(/token not found/i);
  });

  it('skips the network entirely for queries ITRA would reject', async () => {
    expect(await searchItra('a')).toEqual([]);
    expect(outboundFetch).not.toHaveBeenCalled();
  });
});

describe('paging', () => {
  function body(callIndex: number): URLSearchParams {
    return new URLSearchParams(String(outboundFetch.mock.calls[callIndex][1].body));
  }

  it('asks for one more row than requested, because ITRA returns count - 1', async () => {
    outboundFetch
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('tok') }))
      .mockResolvedValueOnce(res(fixture));

    await searchItra('croft', 25);

    expect(body(1).get('count')).toBe('26');
  });

  it('trims the extra row so callers get exactly what they asked for', async () => {
    outboundFetch
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('tok') }))
      .mockResolvedValueOnce(res(fixture)); // fixture holds 2 runners

    // Asking for 1 must yield 1, not the 2 the payload happens to contain.
    expect(await searchItra('croft', 1)).toHaveLength(1);
  });

  it('passes the start offset through', async () => {
    outboundFetch
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('tok') }))
      .mockResolvedValueOnce(res(fixture));

    await searchItra('croft', 25, 50);

    expect(body(1).get('start')).toBe('50');
    expect(body(1).get('count')).toBe('26');
  });

  it('defaults to the first page', async () => {
    outboundFetch
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('tok') }))
      .mockResolvedValueOnce(res(fixture));

    await searchItra('croft');

    expect(body(1).get('start')).toBe('0');
  });

  it('never asks beyond the server-side cap', async () => {
    outboundFetch
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('tok') }))
      .mockResolvedValueOnce(res(fixture));

    // ITRA returns 49 rows however large count is; asking for more is pointless.
    await searchItra('croft', 500);

    expect(Number(body(1).get('count'))).toBeLessThanOrEqual(50);
  });
});

describe('fetchItraIndex', () => {
  it('pins on RunnerId instead of taking the first match', async () => {
    outboundFetch
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('tok') }))
      .mockResolvedValueOnce(res(fixture));
    const r = await fetchItraIndex('anything', 999001);
    expect(r?.runnerId).toBe(999001);
  });

  it('returns null when the pinned id is absent, never a wrong runner', async () => {
    outboundFetch
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('tok') }))
      .mockResolvedValueOnce(res(fixture));
    expect(await fetchItraIndex('anything', 12345)).toBeNull();
  });
});
