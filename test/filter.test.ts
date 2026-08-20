import { describe, it, expect } from 'vitest';
import {
  activeFilterCount,
  applyFilters,
  candidateAges,
  candidateCountries,
  candidateIndex,
  EMPTY_FILTERS,
  filterOptions,
} from '@/lib/filter';
import type { Candidate } from '@/lib/pair';
import type { ItraIndex, UtmbIndex } from '@/lib/types';

function itra(
  runnerId: number,
  name: string,
  pi: number,
  nationality = 'China',
  ageGroup = '35-39',
): ItraIndex {
  return {
    runnerId, name, pi, piIndex: '', colorCode: '#000', nationality,
    gender: 'Male', ageGroup, recentRaces: [], profileUrl: '', photoUrl: null,
  };
}

function utmb(
  id: number,
  name: string,
  ip: number,
  nationality = 'CN',
  ageGroup = '35-39',
): UtmbIndex {
  return {
    id, uri: '', name, ip, category: 'general', nationality, sex: 'H',
    ageGroup, profileUrl: '', photoUrl: null,
  };
}

function candidate(over: Partial<Candidate> = {}): Candidate {
  return { key: 'k', name: 'X', order: 0, strong: false, tier: 0, ...over };
}

describe('candidateIndex', () => {
  it('takes the larger of the two indexes', () => {
    expect(candidateIndex(candidate({ itra: itra(1, 'A', 475), utmb: utmb(1, 'A', 477) }))).toBe(477);
  });

  // The project rule: ip/pi of 0 means "no index", not a zero score.
  it('treats 0 as no index', () => {
    expect(candidateIndex(candidate({ utmb: utmb(1, 'A', 0) }))).toBeNull();
    expect(candidateIndex(candidate({ itra: itra(1, 'A', 0), utmb: utmb(1, 'A', 0) }))).toBeNull();
  });

  it('is null when neither source has one', () => {
    expect(candidateIndex(candidate())).toBeNull();
  });
});

describe('candidateCountries', () => {
  // Without normalization "China" and "CN" would be two separate chips.
  it('collapses UTMB codes onto ITRA names', () => {
    const c = candidate({ itra: itra(1, 'A', 500, 'China'), utmb: utmb(1, 'A', 500, 'CN') });
    expect(candidateCountries(c)).toEqual(['China']);
  });

  it('translates a code even when only UTMB found the runner', () => {
    expect(candidateCountries(candidate({ utmb: utmb(1, 'A', 500, 'TW') }))).toEqual(['Taiwan']);
  });

  it('keeps a name that is already spelled out', () => {
    expect(candidateCountries(candidate({ itra: itra(1, 'A', 500, 'New Zealand') }))).toEqual([
      'New Zealand',
    ]);
  });

  it('keeps both when the sources genuinely disagree', () => {
    const c = candidate({ itra: itra(1, 'A', 500, 'China'), utmb: utmb(1, 'A', 500, 'TW') });
    expect(candidateCountries(c).sort()).toEqual(['China', 'Taiwan']);
  });

  it('ignores blanks', () => {
    expect(candidateCountries(candidate({ utmb: utmb(1, 'A', 500, '') }))).toEqual([]);
  });
});

describe('candidateAges', () => {
  it('trims the padding ITRA sends', () => {
    expect(candidateAges(candidate({ itra: itra(1, 'A', 500, 'China', ' 35-39') }))).toEqual([
      '35-39',
    ]);
  });

  // ITRA splits U23 out of what UTMB calls 20-34, so both are kept.
  it('keeps both values when the sources bucket differently', () => {
    const c = candidate({
      itra: itra(1, 'A', 500, 'China', 'U23'),
      utmb: utmb(1, 'A', 500, 'CN', '20-34'),
    });
    expect(candidateAges(c).sort()).toEqual(['20-34', 'U23']);
  });

  it('deduplicates when they agree', () => {
    const c = candidate({
      itra: itra(1, 'A', 500, 'China', '40-44'),
      utmb: utmb(1, 'A', 500, 'CN', '40-44'),
    });
    expect(candidateAges(c)).toEqual(['40-44']);
  });
});

describe('filterOptions', () => {
  it('counts each candidate once per value and orders by count', () => {
    const cs = [
      candidate({ utmb: utmb(1, 'A', 500, 'CN', '40-44') }),
      candidate({ utmb: utmb(2, 'B', 500, 'CN', '35-39') }),
      candidate({ utmb: utmb(3, 'C', 500, 'TW', '40-44') }),
    ];
    const opts = filterOptions(cs);
    expect(opts.countries).toEqual([
      { value: 'China', count: 2 },
      { value: 'Taiwan', count: 1 },
    ]);
    expect(opts.ageGroups[0]).toEqual({ value: '40-44', count: 2 });
  });

  it('does not double-count a runner both sources agree on', () => {
    const cs = [candidate({ itra: itra(1, 'A', 500, 'China'), utmb: utmb(1, 'A', 500, 'CN') })];
    expect(filterOptions(cs).countries).toEqual([{ value: 'China', count: 1 }]);
  });

  it('is empty for no candidates', () => {
    expect(filterOptions([])).toEqual({ countries: [], ageGroups: [] });
  });
});

describe('applyFilters', () => {
  const cs = [
    candidate({ key: 'a', utmb: utmb(1, 'A', 628, 'CN', '35-39') }),
    candidate({ key: 'b', utmb: utmb(2, 'B', 372, 'CN', '50-54') }),
    candidate({ key: 'c', utmb: utmb(3, 'C', 348, 'CN', '40-44') }),
    candidate({ key: 'd', utmb: utmb(4, 'D', 359, 'TW', '45-49') }),
    candidate({ key: 'e', utmb: utmb(5, 'E', 0, 'CN', '40-44') }),
  ];

  it('returns everything when nothing is set', () => {
    expect(applyFilters(cs, EMPTY_FILTERS)).toHaveLength(5);
  });

  it('applies an index band', () => {
    const out = applyFilters(cs, { ...EMPTY_FILTERS, minIndex: 300, maxIndex: 400 });
    expect(out.map((c) => c.key)).toEqual(['b', 'c', 'd']);
  });

  it('excludes a runner with no index once a band is set', () => {
    const out = applyFilters(cs, { ...EMPTY_FILTERS, minIndex: 0 });
    expect(out.map((c) => c.key)).not.toContain('e');
  });

  // The two sources score the same runner differently, and someone filtering
  // by a remembered index doesn't know which source it came from.
  it('matches when either source lands in the band', () => {
    const split = [
      candidate({ key: 'x', itra: itra(9, 'X', 543), utmb: utmb(9, 'X', 348) }),
      candidate({ key: 'y', itra: itra(8, 'Y', 700), utmb: utmb(8, 'Y', 690) }),
    ];
    const out = applyFilters(split, { ...EMPTY_FILTERS, minIndex: 300, maxIndex: 400 });
    expect(out.map((c) => c.key)).toEqual(['x']);
  });

  it('accepts an open-ended band', () => {
    expect(applyFilters(cs, { ...EMPTY_FILTERS, minIndex: 400 }).map((c) => c.key)).toEqual(['a']);
    expect(applyFilters(cs, { ...EMPTY_FILTERS, maxIndex: 350 }).map((c) => c.key)).toEqual(['c']);
  });

  it('ORs chips within a facet', () => {
    const out = applyFilters(cs, { ...EMPTY_FILTERS, ageGroups: ['50-54', '45-49'] });
    expect(out.map((c) => c.key)).toEqual(['b', 'd']);
  });

  it('ANDs across facets', () => {
    const out = applyFilters(cs, {
      ...EMPTY_FILTERS,
      minIndex: 300,
      maxIndex: 400,
      countries: ['China'],
    });
    expect(out.map((c) => c.key)).toEqual(['b', 'c']);
  });

  it('matches a country chip through the code translation', () => {
    const out = applyFilters(cs, { ...EMPTY_FILTERS, countries: ['Taiwan'] });
    expect(out.map((c) => c.key)).toEqual(['d']);
  });
});

/**
 * The search that prompted all this. 77 runners share the name; ranking cannot
 * choose between them, so filtering has to cut the set down instead.
 */
describe('the Lei Yang case', () => {
  const ages = ['20-34', '35-39', '40-44', '45-49', '50-54'];
  const cohort: Candidate[] = Array.from({ length: 77 }, (_, i) =>
    candidate({
      key: `ly${i}`,
      name: 'Lei YANG',
      utmb: utmb(1000 + i, 'Lei YANG', 628 - i * 8, i === 40 ? 'TW' : 'CN', ages[i % 5]),
    }),
  );

  it('narrows 77 name-alikes to a handful', () => {
    expect(cohort).toHaveLength(77);

    const band = applyFilters(cohort, { ...EMPTY_FILTERS, minIndex: 300, maxIndex: 400 });
    expect(band.length).toBeGreaterThan(0);
    expect(band.length).toBeLessThan(20);

    const narrowed = applyFilters(cohort, {
      ...EMPTY_FILTERS,
      minIndex: 300,
      maxIndex: 400,
      ageGroups: ['40-44'],
    });
    expect(narrowed.length).toBeLessThanOrEqual(5);
    expect(narrowed.every((c) => candidateIndex(c)! >= 300 && candidateIndex(c)! <= 400)).toBe(true);
  });

  it('offers China once rather than as China and CN', () => {
    const countries = filterOptions(cohort).countries.map((o) => o.value);
    expect(countries).toContain('China');
    expect(countries).not.toContain('CN');
    expect(countries).toEqual(['China', 'Taiwan']);
  });
});

describe('activeFilterCount', () => {
  it('counts an index band once however many bounds are set', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTERS, minIndex: 300 })).toBe(1);
    expect(activeFilterCount({ ...EMPTY_FILTERS, minIndex: 300, maxIndex: 400 })).toBe(1);
  });

  it('counts each chip', () => {
    expect(
      activeFilterCount({ minIndex: 300, countries: ['China'], ageGroups: ['40-44', '45-49'] }),
    ).toBe(4);
  });
});
