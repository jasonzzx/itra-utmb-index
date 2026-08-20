import { describe, it, expect, vi, beforeEach } from 'vitest';

const outboundFetch = vi.fn();
vi.mock('@/lib/http', () => ({
  outboundFetch: (...args: unknown[]) => outboundFetch(...args),
  outboundDispatcher: () => undefined,
  resetOutboundDispatcher: () => {},
}));

const { searchUtmb, fetchUtmbIndex, fetchUtmbAllCategories } = await import('@/lib/utmb');

const RUNNERS = [
  { id: 2704, ageGroup: '35-39', fullname: 'Kilian JORNET BURGADA', uri: '2704.kilian.jornetburgada', ip: 948, nationality: 'ES', sex: 'H', picture: 'worldseries/Members/abc' },
  { id: 7975974, ageGroup: '20-34', fullname: 'Kilian DUVERGER', uri: '7975974.kilian.duverger', ip: 762, nationality: 'AU', sex: 'H', picture: null },
];

function ok(runners = RUNNERS, category = 'general') {
  return { ok: true, status: 200, json: async () => ({ category, nbHits: runners.length, runners }) } as unknown as Response;
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

  it('returns null when the pinned id is absent', async () => {
    outboundFetch.mockResolvedValueOnce(ok());
    expect(await fetchUtmbIndex('kilian', 42)).toBeNull();
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
