import { describe, it, expect } from 'vitest';
import { norm, pairPages } from '@/lib/pair';
import type { ItraIndex, UtmbIndex } from '@/lib/types';

function itra(runnerId: number, name: string, pi: number): ItraIndex {
  return {
    runnerId, name, pi, piIndex: 'Elite 1', colorCode: '#000', nationality: 'ES',
    gender: 'Male', ageGroup: '35-39', recentRaces: [],
    profileUrl: `https://itra.run/${runnerId}`, photoUrl: null,
  };
}

function utmb(id: number, name: string, ip: number): UtmbIndex {
  return {
    id, uri: `${id}.x`, name, ip, category: 'general', nationality: 'ES',
    sex: 'H', ageGroup: '35-39', profileUrl: `https://utmb.world/runner/${id}.x`,
    photoUrl: null,
  };
}

describe('norm', () => {
  it('ignores case, accents, punctuation and spacing', () => {
    expect(norm('Óscar García')).toBe(norm('OSCAR GARCIA'));
    expect(norm("O'Brien-Smith")).toBe(norm('obrien smith'));
  });
});

describe('pairPages', () => {
  it('merges the two sources into one row when ids match', () => {
    const out = pairPages([itra(2704, 'Kilian JORNET', 939)], [utmb(2704, 'Kilian JORNET', 948)]);
    expect(out).toHaveLength(1);
    expect(out[0].itra?.pi).toBe(939);
    expect(out[0].utmb?.ip).toBe(948);
  });

  it('falls back to matching on a normalized name when ids differ', () => {
    const out = pairPages([itra(1, 'Óscar GARCÍA', 800)], [utmb(999, 'OSCAR GARCIA', 810)]);
    expect(out).toHaveLength(1);
    expect(out[0].utmb?.ip).toBe(810);
  });

  it('keeps a runner only one source knows about', () => {
    const out = pairPages([itra(1, 'Only Itra', 700)], [utmb(2, 'Only Utmb', 690)]);
    expect(out).toHaveLength(2);
    expect(out.find((c) => c.name === 'Only Itra')?.utmb).toBeUndefined();
  });

  it('ignores a row a source repeats', () => {
    const out = pairPages(
      [itra(1, 'Dup Runner', 500), itra(1, 'Dup Runner', 500)],
      [utmb(2, 'Other', 400), utmb(2, 'Other', 400)],
    );
    expect(out).toHaveLength(2);
  });

  /**
   * A search for "lei yang" returns 155 ITRA runners with that exact name.
   * Pairing on name alone let the first absorb all the others, so 154 real
   * runners silently vanished from the results — invisible until a genuinely
   * common name turned up.
   */
  describe('runners who share a name', () => {
    it('keeps every distinct runner rather than collapsing them onto one', () => {
      const many = Array.from({ length: 20 }, (_, i) => itra(1000 + i, 'Lei YANG', 700 - i * 10));
      const out = pairPages(many, []);
      expect(out).toHaveLength(20);
      expect(new Set(out.map((c) => c.itra!.runnerId)).size).toBe(20);
    });

    it('still pairs same-named runners across sources by id', () => {
      const out = pairPages(
        [itra(1, 'Lei YANG', 700), itra(2, 'Lei YANG', 400)],
        [utmb(2, 'Lei YANG', 410), utmb(3, 'Lei YANG', 300)],
      );
      // 1 and 3 stay solo; 2 merges because the id matches.
      expect(out).toHaveLength(3);
      const merged = out.find((c) => c.itra?.runnerId === 2)!;
      expect(merged.utmb?.ip).toBe(410);
    });

    it('stops pairing on name as soon as the name is ambiguous', () => {
      // One "Lei YANG" per source with different ids still merges — from a
      // single result set there is no way to tell a divergent-id pairing from
      // two different people, and the sources' ids usually do agree.
      expect(pairPages([itra(1, 'Lei YANG', 700)], [utmb(999, 'Lei YANG', 300)])).toHaveLength(1);

      // Add a second same-named runner to either source and the name stops
      // being evidence of identity, so nobody is merged on it.
      const out = pairPages(
        [itra(1, 'Lei YANG', 700), itra(2, 'Lei YANG', 600)],
        [utmb(999, 'Lei YANG', 300)],
      );
      expect(out).toHaveLength(3);
    });

    it('still pairs on name when the name is unique in both sources', () => {
      const out = pairPages([itra(1, 'Óscar GARCÍA', 800)], [utmb(999, 'OSCAR GARCIA', 810)]);
      expect(out).toHaveLength(1);
    });
  });

  it('handles empty input', () => {
    expect(pairPages([], [])).toEqual([]);
  });

  it('gives every candidate a stable unique key', () => {
    const out = pairPages([itra(1, 'A', 1), itra(2, 'B', 2)], [utmb(3, 'C', 3)]);
    expect(new Set(out.map((c) => c.key)).size).toBe(3);
  });

  /**
   * The core of this design. Both APIs rank by name relevance — UTMB puts the
   * runner you typed at position 0 — so relevance is the base order and the
   * index is not an input at all. Sorting by index is what buried Elliot Croft.
   */
  describe('ordering by source relevance', () => {
    it('preserves the order the source returned, ignoring the index', () => {
      const out = pairPages(
        [],
        [
          utmb(1, 'First Listed', 100),
          utmb(2, 'Second Listed', 900), // far stronger, but listed later
          utmb(3, 'Third Listed', 500),
        ],
      );
      expect(out.map((c) => c.name)).toEqual([
        'First Listed',
        'Second Listed',
        'Third Listed',
      ]);
    });

    it('interleaves the two sources by position rather than draining one first', () => {
      const out = pairPages(
        [itra(1, 'Itra A', 500), itra(2, 'Itra B', 500)],
        [utmb(3, 'Utmb A', 500), utmb(4, 'Utmb B', 500)],
      );
      // A UTMB runner at position 0 must not sit below an ITRA runner at 1.
      expect(out.map((c) => c.name)).toEqual(['Itra A', 'Utmb A', 'Itra B', 'Utmb B']);
    });

    it('anchors a merged runner to the earlier of the two positions', () => {
      const out = pairPages(
        [
          itra(1, 'Itra 0', 500),
          itra(2, 'Itra 1', 500),
          itra(3, 'Itra 2', 500),
          itra(7, 'Shared Runner', 500), // ITRA position 3
        ],
        [utmb(7, 'Shared Runner', 500)], // UTMB position 0
      );
      const shared = out.find((c) => c.name === 'Shared Runner')!;
      expect(shared.order).toBe(0);
      // Being top-ranked by UTMB beats sitting fourth in ITRA's list.
      expect(out.indexOf(shared)).toBeLessThan(out.findIndex((c) => c.name === 'Itra 1'));
    });
  });

  describe('name-match promotion', () => {
    // The real "Elliot Croft" result set. UTMB lists the true match first, but
    // it has the lowest index — which is how index-sorting used to bury it.
    const elliots = [
      utmb(4, 'Elliot CROFT', 412),
      utmb(1, 'Elliot CARDIN', 873),
      utmb(2, 'Elliot PHILLIPPON', 804),
      utmb(3, 'Elliot HOLTHAM', 755),
    ];

    it('keeps the runner you typed on top', () => {
      const out = pairPages([], elliots, 'Elliot Croft');
      expect(out[0].name).toBe('Elliot CROFT');
      expect(out[0].strong).toBe(true);
      expect(out.slice(1).every((c) => !c.strong)).toBe(true);
    });

    it('keeps the non-matching rows, just lower down', () => {
      const out = pairPages([], elliots, 'Elliot Croft');
      expect(out).toHaveLength(4);
      expect(out.map((c) => c.name)).toContain('Elliot CARDIN');
    });

    it('promotes a match the source listed far down the list', () => {
      const buried = [
        ...Array.from({ length: 20 }, (_, i) => utmb(100 + i, `Other RUNNER${i}`, 900)),
        utmb(1, 'Elliot CROFT', 412),
      ];
      const out = pairPages([], buried, 'Elliot Croft');
      expect(out[0].name).toBe('Elliot CROFT');
    });

    it('orders the strong group by match quality', () => {
      const out = pairPages(
        [],
        [utmb(1, 'Kilian JORNET BURGADA', 948), utmb(2, 'Kilian JORNET', 500)],
        'Kilian Jornet',
      );
      // Exact beats all-words-present, despite being listed second.
      expect(out[0].name).toBe('Kilian JORNET');
      expect(out[1].name).toBe('Kilian JORNET BURGADA');
    });

    it('falls back to source order inside the strong group', () => {
      const out = pairPages(
        [],
        [utmb(1, 'Meme CROFT', 100), utmb(2, 'Meme CROFT JONES', 900)],
        'Meme Croft',
      );
      // Both are all-words matches; the source listed the first one first.
      expect(out.map((c) => c.name)).toEqual(['Meme CROFT', 'Meme CROFT JONES']);
    });

    it('matches against either source name when the spellings differ', () => {
      const out = pairPages(
        [itra(7, 'Oscar GARCIA JORNET', 700)],
        [utmb(7, 'Óscar GARCIA JORNET (Oscar GARCIA JORNET)', 710)],
        'Oscar Garcia Jornet',
      );
      expect(out[0].strong).toBe(true);
    });

    it('promotes nothing when no query is given', () => {
      const out = pairPages([], elliots);
      expect(out.every((c) => !c.strong)).toBe(true);
      expect(out[0].name).toBe('Elliot CROFT'); // pure source order
    });

    it('leaves a single-word query in source order', () => {
      const out = pairPages(
        [],
        [utmb(1, 'Meme CROFT', 477), utmb(2, 'Jackie BEECROFT', 502)],
        'croft',
      );
      expect(out.map((c) => c.name)).toEqual(['Meme CROFT', 'Jackie BEECROFT']);
    });
  });
});
