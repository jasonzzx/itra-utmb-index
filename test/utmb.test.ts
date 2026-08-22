import { describe, it, expect, vi, beforeEach } from 'vitest';

const outboundFetch = vi.fn();
vi.mock('@/lib/http', () => ({
  outboundFetch: (...args: unknown[]) => outboundFetch(...args),
  outboundDispatcher: () => undefined,
  resetOutboundDispatcher: () => {},
}));

const {
  searchUtmb, fetchUtmbIndex, fetchUtmbAllCategories, fetchUtmbProfile, extractPageProps,
} = await import('@/lib/utmb');

const RUNNERS = [
  { id: 2704, ageGroup: '35-39', fullname: 'Kilian JORNET BURGADA', uri: '2704.kilian.jornetburgada', ip: 948, nationality: 'ES', sex: 'H', picture: 'worldseries/Members/abc' },
  { id: 7975974, ageGroup: '20-34', fullname: 'Kilian DUVERGER', uri: '7975974.kilian.duverger', ip: 762, nationality: 'AU', sex: 'H', picture: null },
];

function ok(runners = RUNNERS, category = 'general') {
  return { ok: true, status: 200, json: async () => ({ category, nbHits: runners.length, runners }) } as unknown as Response;
}

/** The runner page as UTMB serves it: a Next.js app with its props inlined. */
function RUNNER_PAGE(props: Record<string, unknown>): string {
  return (
    '<html><body><div id="__next"></div>' +
    '<script id="__NEXT_DATA__" type="application/json">' +
    JSON.stringify({ props: { pageProps: props }, page: '/runner/[runner]' }) +
    '</script></body></html>'
  );
}

const PAGE_PROPS = {
  fullname: 'Yu CHEN',
  nationality: 'China',
  nationalityCode: 'CN',
  ageGroup: '40-44',
  gender: 'H',
  profilePicture: null as string | null,
  performanceIndexes: [
    { piCategory: 'general', index: 382 },
    { piCategory: '20k', index: null },
    { piCategory: '50k', index: 383 },
    { piCategory: '100k', index: null },
    { piCategory: '100m', index: null },
  ],
};

function page(props = PAGE_PROPS, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => RUNNER_PAGE(props),
  } as unknown as Response;
}

beforeEach(() => outboundFetch.mockReset());

describe('searchUtmb', () => {
  it('normalizes runners and builds profile and photo urls', async () => {
    outboundFetch.mockResolvedValueOnce(ok());
    const [first, second] = await searchUtmb('kilian');

    expect(first).toMatchObject({ id: 2704, ip: 948, category: 'general' });
    expect(first.profileUrl).toBe('https://utmb.world/runner/2704.kilian.jornetburgada');
    expect(first.photoUrl).toBe(
      'https://res.cloudinary.com/utmb-world/image/upload/worldseries/Members/abc',
    );
    expect(second.photoUrl).toBeNull();
  });

  it('passes the requested category through to the API', async () => {
    outboundFetch.mockResolvedValueOnce(ok(RUNNERS, '100m'));
    await searchUtmb('kilian', '100m');
    const url = String(outboundFetch.mock.calls[0][0]);
    expect(url).toContain('category=100m');
    expect(url).toContain('search=kilian');
  });

  it('passes the offset through for paging', async () => {
    outboundFetch.mockResolvedValueOnce(ok());
    await searchUtmb('croft', 'general', 25, 50);
    const url = String(outboundFetch.mock.calls[0][0]);
    expect(url).toContain('offset=50');
    expect(url).toContain('limit=25');
  });

  it('defaults to the first page', async () => {
    outboundFetch.mockResolvedValueOnce(ok());
    await searchUtmb('croft');
    expect(String(outboundFetch.mock.calls[0][0])).toContain('offset=0');
  });

  it('skips the network for queries that are too short', async () => {
    expect(await searchUtmb('k')).toEqual([]);
    expect(outboundFetch).not.toHaveBeenCalled();
  });

  it('throws on an upstream error rather than returning empty', async () => {
    outboundFetch.mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    await expect(searchUtmb('kilian')).rejects.toThrow(/503/);
  });
});

describe('fetchUtmbIndex', () => {
  it('pins on id rather than taking the first result', async () => {
    outboundFetch.mockResolvedValueOnce(ok());
    expect((await fetchUtmbIndex('kilian', 7975974))?.id).toBe(7975974);
  });

  it('returns null when the pinned id is absent and there is no slug to fall back on', async () => {
    outboundFetch.mockResolvedValueOnce(ok());
    expect(await fetchUtmbIndex('kilian', 42)).toBeNull();
  });

  it('falls back to the profile page for a runner search ranks out of reach', async () => {
    // "Yu Chen" returns hundreds of people ranked by index; the one meant, at
    // 382, is nowhere near the rows fetched. Only the slug reaches him.
    outboundFetch
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(page());

    const r = await fetchUtmbIndex('Yu Chen', 7388490, 'general', '7388490.yu.chen');

    expect(r).toMatchObject({ id: 7388490, name: 'Yu CHEN', ip: 382, nationality: 'CN' });
    expect(String(outboundFetch.mock.calls[1][0])).toBe(
      'https://utmb.world/runner/7388490.yu.chen',
    );
  });

  it('never fetches the page when search already found the pin', async () => {
    outboundFetch.mockResolvedValueOnce(ok());
    await fetchUtmbIndex('kilian', 2704, 'general', '2704.kilian.jornetburgada');
    expect(outboundFetch).toHaveBeenCalledTimes(1);
  });

  it('skips search entirely when there is no name to search with', async () => {
    outboundFetch.mockResolvedValueOnce(page());
    expect((await fetchUtmbIndex('', 7388490, 'general', '7388490.yu.chen'))?.ip).toBe(382);
    expect(outboundFetch).toHaveBeenCalledTimes(1);
  });
});

describe('fetchUtmbProfile', () => {
  it('reads every category off one page load', async () => {
    outboundFetch.mockResolvedValueOnce(page());
    const profile = await fetchUtmbProfile('7388490.yu.chen');
    // A null index means no index in that category, not a zero score.
    expect(profile?.categories).toEqual({ general: 382, '50k': 383 });
  });

  it('reports the requested category as the index', async () => {
    outboundFetch.mockResolvedValueOnce(page());
    const profile = await fetchUtmbProfile('7388490.yu.chen', '50k');
    expect(profile?.index).toMatchObject({ ip: 383, category: '50k' });
  });

  it('builds the photo url the same way search does', async () => {
    outboundFetch.mockResolvedValueOnce(
      page({ ...PAGE_PROPS, profilePicture: 'worldseries/Members/abc' }),
    );
    expect((await fetchUtmbProfile('2704.kilian.jornetburgada'))?.index.photoUrl).toBe(
      'https://res.cloudinary.com/utmb-world/image/upload/worldseries/Members/abc',
    );
  });

  it('treats an unknown slug as an answer, not a failure', async () => {
    outboundFetch.mockResolvedValueOnce({ ok: false, status: 404 } as Response);
    expect(await fetchUtmbProfile('1.no.body')).toBeNull();
  });

  it('throws when the page carries no runner at all', async () => {
    outboundFetch.mockResolvedValueOnce({
      ok: true, status: 200, text: async () => '<html><body>nope</body></html>',
    } as unknown as Response);
    await expect(fetchUtmbProfile('2704.kilian.jornetburgada')).rejects.toThrow(/did not contain/);
  });
});

describe('extractPageProps', () => {
  it('returns null for a page with no props script', () => {
    expect(extractPageProps('<html><body>nothing</body></html>')).toBeNull();
  });
});

describe('fetchUtmbAllCategories', () => {
  it('omits categories with no index instead of reporting a zero score', async () => {
    // general/20k/50k have a score; 100k is 0 (no index); 100m has one.
    const ips = [948, 795, 940, 0, 935];
    ips.forEach((ip) =>
      outboundFetch.mockResolvedValueOnce(ok([{ ...RUNNERS[0], ip }])),
    );

    const cats = await fetchUtmbAllCategories('kilian', 2704);

    expect(cats).toEqual({ general: 948, '20k': 795, '50k': 940, '100m': 935 });
    expect(cats).not.toHaveProperty('100k');
  });

  it('takes all five from one page load when the slug is known', async () => {
    outboundFetch.mockResolvedValueOnce(page());
    expect(await fetchUtmbAllCategories('Yu Chen', 7388490, '7388490.yu.chen')).toEqual({
      general: 382,
      '50k': 383,
    });
    // Five searches collapse into one fetch.
    expect(outboundFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the categories that succeed when one call fails', async () => {
    outboundFetch
      .mockResolvedValueOnce(ok([{ ...RUNNERS[0], ip: 948 }]))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(ok([{ ...RUNNERS[0], ip: 900 }]));

    const cats = await fetchUtmbAllCategories('kilian', 2704);
    expect(cats.general).toBe(948);
    expect(cats).not.toHaveProperty('20k');
  });
});
