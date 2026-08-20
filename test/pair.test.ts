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

  it('gives every candidate a stable unique key', () => {
    const out = pairPages(
      [[itra(1, 'A', 1), itra(2, 'B', 2)]],
      [[utmb(3, 'C', 3)]],
    );
    expect(new Set(out.map((c) => c.key)).size).toBe(3);
  });
});
