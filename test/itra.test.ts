import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fixture from './fixtures/itra-encrypted.json';

const TOKEN_PAGE = (token: string) =>
  `<html><body><form><input name="__RequestVerificationToken" type="hidden" value="${token}" /></form></body></html>`;

/**
 * The runner page as ITRA serves it: the view model handed to the client
 * inside an inline script, surrounded by braces and quotes that a regex would
 * trip over.
 */
function RUNNER_PAGE(model: Record<string, unknown>): string {
  return (
    `<html><body><script>\n  $('#tab').click(function () { $('.load').show(); });\n` +
    `  var Model = ${JSON.stringify(model)};\n</script></body></html>`
  );
}

const PAGE_MODEL = {
  runnerId: 999001,
  firstName: 'Kilian',
  lastName: 'JORNET BURGADA',
  nationality: 'Spain',
  gender: 'Male',
  ageGroup: 'M 35-39',
  performanceIndex: 939,
  profilePicture: '/Files/Photos/abc.jpg',
  performanceIndicatorInfos: [
    { pi: 855, categoryId: 2, piIndex: 'Elite-3', backGroundColor: '#E25961' },
    { pi: 939, categoryId: 0, piIndex: 'Elite-1', backGroundColor: '#BC4A51' },
  ],
};

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

const {
  searchItra, searchItraWindow, fetchItraIndex, fetchItraProfile, extractPageModel,
  decryptResponse, resetItraSession, itraInFlight, itraAccessNotice,
  ItraChallengedError, ItraBlockedError, ItraAccessError,
} = await import('@/lib/itra');

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

  it('falls back to the profile page when search cannot reach the pinned id', async () => {
    outboundFetch
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('tok') }))
      .mockResolvedValueOnce(res(fixture))
      .mockResolvedValueOnce(
        res(null, { text: RUNNER_PAGE({ ...PAGE_MODEL, runnerId: 12345 }) }),
      );
    const r = await fetchItraIndex('anything', 12345);
    expect(r?.runnerId).toBe(12345);
    expect(outboundFetch.mock.calls[2][0]).toContain('/RunnerSpace/-/12345');
  });

  it('never searches when there is no name to search with', async () => {
    outboundFetch.mockResolvedValueOnce(res(null, { text: RUNNER_PAGE(PAGE_MODEL) }));
    const r = await fetchItraIndex('', 999001);
    expect(r?.runnerId).toBe(999001);
    expect(outboundFetch).toHaveBeenCalledTimes(1);
  });
});

describe('fetchItraProfile', () => {
  it('reads the index off the runner page, agreeing with search on format', async () => {
    outboundFetch.mockResolvedValueOnce(res(null, { text: RUNNER_PAGE(PAGE_MODEL) }));
    const r = await fetchItraProfile(999001);
    expect(r).toMatchObject({
      runnerId: 999001,
      name: 'Kilian JORNET BURGADA',
      pi: 939,
      // Search spells these "Elite 1" and "35-39"; the page hyphenates and
      // prefixes, and a card may be painted from either.
      piIndex: 'Elite 1',
      ageGroup: '35-39',
      colorCode: '#BC4A51',
      photoUrl: 'https://itra.run/Files/Photos/abc.jpg',
    });
  });

  it('treats an unknown id as an answer, not a failure', async () => {
    outboundFetch.mockResolvedValueOnce(res(null, { status: 404 }));
    expect(await fetchItraProfile(1)).toBeNull();
  });

  it('refuses a page for somebody else rather than pinning the wrong runner', async () => {
    outboundFetch.mockResolvedValueOnce(res(null, { text: RUNNER_PAGE(PAGE_MODEL) }));
    expect(await fetchItraProfile(4242)).toBeNull();
  });

  it('reports bot protection the same way search does', async () => {
    outboundFetch.mockResolvedValueOnce(res(null, { status: 403 }));
    await expect(fetchItraProfile(999001)).rejects.toBeInstanceOf(ItraBlockedError);
  });
});

describe('extractPageModel', () => {
  it('finds the end of the object past braces and quotes inside strings', () => {
    const model = { name: 'A }{ "trap"', nested: { deep: [{ x: '\\' }] }, id: 7 };
    expect(extractPageModel(RUNNER_PAGE(model))).toEqual(model);
  });

  it('returns null for a page with no model at all', () => {
    expect(extractPageModel('<html><body>nothing here</body></html>')).toBeNull();
  });
});

describe('searchItraWindow', () => {
  /** A decrypted payload holding `n` distinct runners. */
  function pageOf(n: number, from = 0) {
    return {
      ResultCount: 999,
      Results: Array.from({ length: n }, (_, i) => ({
        RunnerId: from + i,
        FirstName: `R${from + i}`,
        LastName: 'TEST',
        Nationality: 'ES',
        Code: '',
        Gender: 'Male',
        AgeGroup: ' 35-39',
        RecentRaces: '',
        ProfilePic: '',
        Pi: 500,
        PiIndex: 'Expert 1',
        ColorCode: '#000',
      })),
    };
  }

  /** Encrypt like ITRA does, so the window goes through the real decrypt path. */
  async function encrypted(payload: unknown) {
    const { webcrypto } = await import('node:crypto');
    const key = webcrypto.getRandomValues(new Uint8Array(32));
    const iv = webcrypto.getRandomValues(new Uint8Array(16));
    const ck = await webcrypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt']);
    const ct = await webcrypto.subtle.encrypt(
      { name: 'AES-CBC', iv },
      ck,
      new TextEncoder().encode(JSON.stringify(payload)),
    );
    return {
      response1: Buffer.from(ct).toString('base64'),
      response2: Buffer.from(iv).toString('base64'),
      response3: Buffer.from(key).toString('base64'),
    };
  }

  function starts(): number[] {
    return outboundFetch.mock.calls
      .filter((c) => c[1]?.method === 'POST')
      .map((c) => Number(new URLSearchParams(String(c[1].body)).get('start')));
  }

  it('requests consecutive offsets across the 49-row cap', async () => {
    outboundFetch.mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('tok') }));
    for (let i = 0; i < 3; i++) {
      outboundFetch.mockResolvedValueOnce(res(await encrypted(pageOf(49, i * 49))));
    }

    const out = await searchItraWindow('croft', 147);

    expect(starts()).toEqual([0, 49, 98]);
    expect(out).toHaveLength(147);
    // Concatenated in offset order, not whichever request resolved first.
    expect(out[0].runnerId).toBe(0);
    expect(out[49].runnerId).toBe(49);
  });

  it('stops at a short page and discards anything past it', async () => {
    outboundFetch.mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('tok') }));
    outboundFetch.mockResolvedValueOnce(res(await encrypted(pageOf(49, 0))));
    outboundFetch.mockResolvedValueOnce(res(await encrypted(pageOf(10, 49)))); // short → end
    outboundFetch.mockResolvedValueOnce(res(await encrypted(pageOf(49, 100)))); // must be ignored

    const out = await searchItraWindow('croft', 147);

    expect(out).toHaveLength(59);
    expect(out.some((r) => r.runnerId >= 100)).toBe(false);
  });

  it('never returns more than asked for', async () => {
    outboundFetch.mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('tok') }));
    outboundFetch.mockResolvedValue(res(await encrypted(pageOf(49, 0))));
    expect(await searchItraWindow('croft', 20)).toHaveLength(20);
  });

  it('skips the network for a query ITRA would reject', async () => {
    expect(await searchItraWindow('a', 100)).toEqual([]);
    expect(await searchItraWindow('croft', 0)).toEqual([]);
    expect(outboundFetch).not.toHaveBeenCalled();
  });
});

/**
 * AWS WAF turns requests away two different ways and they look nothing alike:
 * a challenge is 202 with a header, a block is a bare 403. Reporting a block
 * as "ITRA search failed with 403" told the user nothing and suggested no
 * remedy, which is exactly what was seen on the runner cards.
 */
describe('bot protection', () => {
  it('reports a bare 403 as a block, not a raw status', async () => {
    outboundFetch
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('tok') }))
      .mockResolvedValueOnce(res(null, { status: 403 }));

    const err = await searchItra('jornet').catch((e) => e);
    expect(err).toBeInstanceOf(ItraBlockedError);
    expect(err).toBeInstanceOf(ItraAccessError);
    expect(err.message).toMatch(/OUTBOUND_PROXY_URL/);
    expect(err.message).toMatch(/UTMB figures are unaffected/);
  });

  it('still calls it a challenge when the header says so, whatever the status', async () => {
    outboundFetch
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('tok') }))
      .mockResolvedValueOnce(
        res(null, { status: 403, headers: { 'x-amzn-waf-action': 'challenge' } }),
      );
    await expect(searchItra('jornet')).rejects.toBeInstanceOf(ItraChallengedError);
  });

  // Re-handshaking into a block sent another pair of requests at a host that
  // had just refused us; over a runner list that multiplied badly.
  it('does not retry a 403', async () => {
    outboundFetch
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('tok') }))
      .mockResolvedValueOnce(res(null, { status: 403 }));

    await expect(searchItra('jornet')).rejects.toBeInstanceOf(ItraBlockedError);
    // Token page + the one search. No second handshake, no second search.
    expect(outboundFetch).toHaveBeenCalledTimes(2);
  });

  it('makes no further requests while the cooldown holds', async () => {
    outboundFetch
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('tok') }))
      .mockResolvedValueOnce(res(null, { status: 403 }));

    await expect(searchItra('jornet')).rejects.toBeInstanceOf(ItraBlockedError);
    const afterBlock = outboundFetch.mock.calls.length;

    // A card refresh during a block should cost nothing at all.
    for (let i = 0; i < 5; i++) {
      await expect(searchItra('jornet')).rejects.toBeInstanceOf(ItraBlockedError);
    }
    expect(outboundFetch).toHaveBeenCalledTimes(afterBlock);
  });

  it('lifts the cooldown once the session is reset', async () => {
    outboundFetch
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('tok') }))
      .mockResolvedValueOnce(res(null, { status: 403 }));
    await expect(searchItra('jornet')).rejects.toBeInstanceOf(ItraBlockedError);

    resetItraSession();
    outboundFetch
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('tok2') }))
      .mockResolvedValueOnce(res(fixture));
    expect(await searchItra('jornet')).toHaveLength(2);
  });
});

describe('request volume', () => {
  /**
   * The regression that matters most: /api/indexes fans out over a runner
   * list, so an uncoalesced handshake meant one token-page fetch per runner
   * arriving at once — the burst shape bot protection blocks on.
   */
  it('performs one handshake for many concurrent callers', async () => {
    let tokenFetches = 0;
    outboundFetch.mockImplementation(async (_url: string, init: { method?: string }) => {
      if (init?.method !== 'POST') {
        tokenFetches++;
        // Yield so the other callers arrive while this one is in flight.
        await new Promise((r) => setTimeout(r, 5));
        return res(null, { text: TOKEN_PAGE('tok') });
      }
      return res(fixture);
    });

    await Promise.all(
      Array.from({ length: 8 }, (_, i) => searchItra(`runner${i}`)),
    );

    expect(tokenFetches).toBe(1);
  });

  it('never has more than two requests in flight at once', async () => {
    let peak = 0;
    outboundFetch.mockImplementation(async (_url: string, init: { method?: string }) => {
      peak = Math.max(peak, itraInFlight());
      await new Promise((r) => setTimeout(r, 5));
      return init?.method === 'POST' ? res(fixture) : res(null, { text: TOKEN_PAGE('tok') });
    });

    await Promise.all(Array.from({ length: 10 }, (_, i) => searchItra(`runner${i}`)));

    expect(peak).toBeLessThanOrEqual(2);
  });

  it('still short-circuits a window at the end of the result set', async () => {
    outboundFetch.mockImplementation(async (_url: string, init: { method?: string }) =>
      init?.method === 'POST' ? res(fixture) : res(null, { text: TOKEN_PAGE('tok') }),
    );
    // The fixture's 2 rows are fewer than a full 49-row page, so page one is
    // the end of the results and later pages are discarded. Queueing behind
    // the semaphore must not change that.
    expect(await searchItraWindow('croft', 147)).toHaveLength(2);
  });
});

/**
 * React replaces any error thrown inside a `'use cache'` function with "the
 * specific message is omitted in production builds", so the carefully worded
 * reason never reached the user on a cached lookup — they saw the placeholder.
 * The module records why it refused so callers can report the real cause.
 */
describe('itraAccessNotice', () => {
  it('is null when nothing has gone wrong', async () => {
    expect(itraAccessNotice()).toBeNull();
  });

  it('reports the reason after a block', async () => {
    outboundFetch
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('tok') }))
      .mockResolvedValueOnce(res(null, { status: 403 }));
    await expect(searchItra('jornet')).rejects.toBeInstanceOf(ItraBlockedError);

    expect(itraAccessNotice()).toMatch(/OUTBOUND_PROXY_URL/);
    expect(itraAccessNotice()).not.toMatch(/omitted in production/);
  });

  it('distinguishes a challenge from a block in the reported reason', async () => {
    outboundFetch.mockResolvedValueOnce(
      res(null, { status: 202, headers: { 'x-amzn-waf-action': 'challenge' } }),
    );
    await expect(searchItra('jornet')).rejects.toBeInstanceOf(ItraChallengedError);
    expect(itraAccessNotice()).toMatch(/challenge/i);
  });

  it('clears once the block is reset', async () => {
    outboundFetch
      .mockResolvedValueOnce(res(null, { text: TOKEN_PAGE('tok') }))
      .mockResolvedValueOnce(res(null, { status: 403 }));
    await expect(searchItra('jornet')).rejects.toBeInstanceOf(ItraBlockedError);
    expect(itraAccessNotice()).not.toBeNull();

    resetItraSession();
    expect(itraAccessNotice()).toBeNull();
  });
});

describe('searchItraWindow request economy', () => {
  function postCount() {
    return outboundFetch.mock.calls.filter((c) => c[1]?.method === 'POST').length;
  }

  /**
   * A full-name search returns a handful of runners, so fetching the whole
   * window up front spent five requests to throw four away — wasteful against
   * a host whose bot protection is already refusing us.
   */
  it('stops after one page when the results already ended', async () => {
    outboundFetch.mockImplementation(async (_u: string, init: { method?: string }) =>
      init?.method === 'POST' ? res(fixture) : res(null, { text: TOKEN_PAGE('tok') }),
    );

    // The fixture's 2 rows are a short page, so there is nothing more to get.
    expect(await searchItraWindow('elliot croft', 250)).toHaveLength(2);
    expect(postCount()).toBe(1);
  });

  it('fetches the remaining pages when the first one fills', async () => {
    const full = {
      ResultCount: 999,
      Results: Array.from({ length: 49 }, (_, i) => ({
        RunnerId: i, FirstName: `R${i}`, LastName: 'TEST', Nationality: 'ES',
        Code: '', Gender: 'Male', AgeGroup: ' 35-39', RecentRaces: '',
        ProfilePic: '', Pi: 500, PiIndex: 'Expert 1', ColorCode: '#000',
      })),
    };
    const { webcrypto } = await import('node:crypto');
    const key = webcrypto.getRandomValues(new Uint8Array(32));
    const iv = webcrypto.getRandomValues(new Uint8Array(16));
    const ck = await webcrypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt']);
    const ct = await webcrypto.subtle.encrypt(
      { name: 'AES-CBC', iv }, ck, new TextEncoder().encode(JSON.stringify(full)),
    );
    const payload = {
      response1: Buffer.from(ct).toString('base64'),
      response2: Buffer.from(iv).toString('base64'),
      response3: Buffer.from(key).toString('base64'),
    };

    outboundFetch.mockImplementation(async (_u: string, init: { method?: string }) =>
      init?.method === 'POST' ? res(payload) : res(null, { text: TOKEN_PAGE('tok') }),
    );

    // 98 wanted over 49-row pages is 2 pages, and page one is full.
    await searchItraWindow('croft', 98);
    expect(postCount()).toBe(2);
  });
});
