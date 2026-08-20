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
    const out = pairPages([[itra(2704, 'Kilian JORNET', 939)]], [[utmb(2704, 'Kilian JORNET', 948)]]);
    expect(out).toHaveLength(1);
    expect(out[0].itra?.pi).toBe(939);
    expect(out[0].utmb?.ip).toBe(948);
  });

  it('falls back to matching on a normalized name when ids differ', () => {
    const out = pairPages([[itra(1, 'Óscar GARCÍA', 800)]], [[utmb(999, 'OSCAR GARCIA', 810)]]);
    expect(out).toHaveLength(1);
    expect(out[0].utmb?.ip).toBe(810);
  });

  it('keeps a runner only one source knows about', () => {
    const out = pairPages([[itra(1, 'Only Itra', 700)]], [[utmb(2, 'Only Utmb', 690)]]);
    expect(out).toHaveLength(2);
    expect(out.find((c) => c.name === 'Only Itra')?.utmb).toBeUndefined();
  });

  // The reason pairing runs over accumulated pages rather than page by page.
  it('merges a runner found on different pages of each source', () => {
    const out = pairPages(
      [[itra(2704, 'Kilian JORNET', 939)], [itra(50, 'Someone Else', 500)]],
      [[utmb(77, 'Nobody', 400)], [utmb(2704, 'Kilian JORNET', 948)]],
    );
    const kilian = out.filter((c) => c.name === 'Kilian JORNET');
    expect(kilian).toHaveLength(1);
    expect(kilian[0].itra?.pi).toBe(939);
    expect(kilian[0].utmb?.ip).toBe(948);
  });

  it('sorts strongest first within a page', () => {
    const out = pairPages(
      [[itra(1, 'Weak', 500), itra(2, 'Strong', 900), itra(3, 'Middle', 700)]],
      [[]],
    );
    expect(out.map((c) => c.name)).toEqual(['Strong', 'Middle', 'Weak']);
  });

  // The whole point of the page-aware ordering: Load more must not reshuffle
  // what the reader is already looking at.
  it('never lets a later page jump above an earlier one', () => {
    const out = pairPages(
      [
        [itra(1, 'Page1 Weak', 100), itra(2, 'Page1 Weaker', 50)],
        [itra(3, 'Page2 Monster', 999)],
      ],
      [[]],
    );
    expect(out.map((c) => c.name)).toEqual(['Page1 Weak', 'Page1 Weaker', 'Page2 Monster']);
  });

  it('keeps a cross-page merge anchored to its earliest page', () => {
    const out = pairPages(
      [[itra(2704, 'Kilian JORNET', 939)], [itra(9, 'Later Guy', 800)]],
      [[], [utmb(2704, 'Kilian JORNET', 948)]],
    );
    // Kilian first appeared on page 0, so pairing him from page 1 must not
    // push him below the page-1 runner.
    expect(out[0].name).toBe('Kilian JORNET');
  });

  it('ignores a row a source repeats across pages', () => {
    const out = pairPages(
      [[itra(1, 'Dup Runner', 500)], [itra(1, 'Dup Runner', 500)]],
      [[utmb(2, 'Other', 400)], [utmb(2, 'Other', 400)]],
    );
    expect(out).toHaveLength(2);
  });

  /**
   * The property that matters, stated directly: whatever was on screen before
   * "Load more" must still be there, in the same order, as a prefix of the
   * result. A browser run caught a reordering that the narrower cases below
   * all passed, so this asserts the invariant itself rather than an example.
   */
  it('is append-only: loading a page never reorders what was shown', () => {
    const itraPages = [
      [itra(1, 'Alpha', 500), itra(4, 'Delta', 300)],
      [itra(2, 'Xavier', 900), itra(5, 'Echo', 950)],
    ];
    const utmbPages = [
      [utmb(2, 'Xavier', 100), utmb(6, 'Foxtrot', 250)],
      [utmb(3, 'Beta', 400), utmb(1, 'Alpha', 999)],
    ];

    const afterPage0 = pairPages([itraPages[0]], [utmbPages[0]]).map((c) => c.key);
    const afterPage1 = pairPages(itraPages, utmbPages).map((c) => c.key);

    expect(afterPage1.slice(0, afterPage0.length)).toEqual(afterPage0);
  });

  it('does not re-rank a row when a later page pairs more data into it', () => {
    // Xavier is weak on UTMB page 0 but strong on ITRA page 1. Merging that in
    // must not lift him above Alpha, who the reader already saw above him.
    const itraPages = [[itra(1, 'Alpha', 500)], [itra(2, 'Xavier', 900)]];
    const utmbPages = [[utmb(2, 'Xavier', 100)], []];

    const out = pairPages(itraPages, utmbPages);
    expect(out.map((c) => c.name)).toEqual(['Alpha', 'Xavier']);
    // Still merged into one row, just held in place.
    expect(out.find((c) => c.name === 'Xavier')?.itra?.pi).toBe(900);
  });

  it('attributes a runner to the first page either source saw them on', () => {
    // On UTMB page 0 and ITRA page 1 — page 0 is when the reader first saw them.
    const out = pairPages([[], [itra(2, 'Xavier', 900)]], [[utmb(2, 'Xavier', 100)], []]);
    expect(out[0].page).toBe(0);
  });

  it('handles empty input', () => {
    expect(pairPages([], [])).toEqual([]);
    expect(pairPages([[]], [[]])).toEqual([]);
  });

  describe('name-match promotion', () => {
    // The real "Elliot Croft" result set: the exact match arrives last and
    // with the lowest index, exactly where the app used to bury it.
    const elliots = [
      utmb(1, 'Elliot CARDIN', 873),
      utmb(2, 'Elliot PHILLIPPON', 804),
      utmb(3, 'Elliot HOLTHAM', 755),
      utmb(4, 'Elliot CROFT', 412),
    ];

    it('lifts the runner you typed above higher-indexed strangers', () => {
      const out = pairPages([[]], [elliots], 'Elliot Croft');
      expect(out[0].name).toBe('Elliot CROFT');
      expect(out[0].strong).toBe(true);
      expect(out.slice(1).every((c) => !c.strong)).toBe(true);
    });

    it('keeps the non-matching rows, just lower down', () => {
      const out = pairPages([[]], [elliots], 'Elliot Croft');
      expect(out).toHaveLength(4);
      expect(out.map((c) => c.name)).toContain('Elliot CARDIN');
    });

    it('promotes an exact match found on a later page', () => {
      const out = pairPages(
        [[]],
        [[utmb(1, 'Elliot CARDIN', 873)], [utmb(4, 'Elliot CROFT', 412)]],
        'Elliot Croft',
      );
      expect(out[0].name).toBe('Elliot CROFT');
    });

    it('orders the strong group by match quality before index', () => {
      const out = pairPages(
        [[]],
        [
          [
            utmb(1, 'Kilian JORNET BURGADA', 948), // all words, 3 tokens
            utmb(2, 'Kilian JORNET', 500), // exact
          ],
        ],
        'Kilian Jornet',
      );
      // Exact wins despite the far lower index.
      expect(out[0].name).toBe('Kilian JORNET');
      expect(out[1].name).toBe('Kilian JORNET BURGADA');
    });

    // This is what protects the paging work: one word promotes nothing, so
    // the append-only ordering is untouched.
    it('leaves a single-word query on the append-only path', () => {
      const pages = [
        [utmb(1, 'Meme CROFT', 477)],
        [utmb(2, 'Jackie BEECROFT', 502)],
      ];
      const afterPage0 = pairPages([[]], [pages[0]], 'croft').map((c) => c.key);
      const afterPage1 = pairPages([[], []], pages, 'croft').map((c) => c.key);
      expect(afterPage1.slice(0, afterPage0.length)).toEqual(afterPage0);
      expect(afterPage1).toEqual(['utmb:1', 'utmb:2']);
    });

    it('matches against either source name when the two spellings differ', () => {
      const out = pairPages(
        [[itra(7, 'Oscar GARCIA JORNET', 700)]],
        [[utmb(7, 'Óscar GARCIA JORNET (Oscar GARCIA JORNET)', 710)]],
        'Oscar Garcia Jornet',
      );
      expect(out[0].strong).toBe(true);
    });

    it('promotes nothing when no query is given', () => {
      const out = pairPages([[]], [elliots]);
      expect(out.every((c) => !c.strong)).toBe(true);
      expect(out[0].name).toBe('Elliot CARDIN'); // pure index order
    });
  });

  it('gives every candidate a stable unique key', () => {
    const out = pairPages(
      [[itra(1, 'A', 1), itra(2, 'B', 2)]],
      [[utmb(3, 'C', 3)]],
    );
    expect(new Set(out.map((c) => c.key)).size).toBe(3);
  });
});
