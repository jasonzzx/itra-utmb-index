import type { Candidate } from './pair';

/**
 * Narrowing a result set down to one person.
 *
 * Ranking can only go so far: 77 runners share the name "Lei Yang", 75 of them
 * Chinese, with five separate `Lei YANG · CN · 40-44` rows inside a single
 * 100-point index band. Nothing in the data says which one someone means, so
 * the app has to let them cut the set down by hand.
 */

export interface FilterState {
  minIndex?: number;
  maxIndex?: number;
  countries: string[];
  ageGroups: string[];
}

export const EMPTY_FILTERS: FilterState = { countries: [], ageGroups: [] };

export interface FilterOption {
  value: string;
  count: number;
}

export interface FilterOptions {
  countries: FilterOption[];
  ageGroups: FilterOption[];
}

/**
 * UTMB reports a country as an ISO code ("CN") where ITRA reports a name
 * ("China"). Without this the same country would appear as two separate chips.
 */
let regionNames: Intl.DisplayNames | undefined;

function countryName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  // Only a bare two-letter code needs translating; ITRA already sends a name.
  if (!/^[A-Za-z]{2}$/.test(trimmed)) return trimmed;
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(trimmed.toUpperCase()) ?? trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * Both of the runner's indexes, dropping 0 which means "no index" rather than
 * a zero score.
 *
 * The two sources disagree — ITRA and UTMB score the same runner differently,
 * sometimes by a wide margin — so a band matches if *either* index falls in
 * it. Taking only the higher one would hide a runner whose ITRA score sits
 * above the band while their UTMB score sits inside it, and someone filtering
 * by remembered index has no idea which source that number came from.
 */
export function candidateIndexes(c: Candidate): number[] {
  return [c.itra?.pi, c.utmb?.ip].filter((n): n is number => typeof n === 'number' && n > 0);
}

/** The runner's headline index — the larger of the two. */
export function candidateIndex(c: Candidate): number | null {
  const all = candidateIndexes(c);
  return all.length > 0 ? Math.max(...all) : null;
}

/** Every country either source attributes to this runner, normalized. */
export function candidateCountries(c: Candidate): string[] {
  const values = [c.itra?.nationality, c.utmb?.nationality]
    .filter(Boolean)
    .map((v) => countryName(v as string))
    .filter(Boolean);
  return [...new Set(values)];
}

/**
 * Every age band either source attributes to this runner.
 *
 * The two disagree below 35 — ITRA splits `U23` out of what UTMB calls
 * `20-34` — so both values are kept and a chip matches if either agrees.
 * Inventing a mapping between them would silently mis-bucket people.
 */
export function candidateAges(c: Candidate): string[] {
  const values = [c.itra?.ageGroup, c.utmb?.ageGroup]
    .map((v) => v?.trim())
    .filter(Boolean) as string[];
  return [...new Set(values)];
}

function tally(values: string[][]): FilterOption[] {
  const counts = new Map<string, number>();
  for (const perCandidate of values) {
    // Count each candidate once per distinct value.
    for (const v of new Set(perCandidate)) {
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/**
 * Chips for the current result set, with counts. Derived from the results
 * rather than a fixed list, so the options are always ones that match
 * something.
 */
export function filterOptions(candidates: Candidate[]): FilterOptions {
  return {
    countries: tally(candidates.map(candidateCountries)),
    ageGroups: tally(candidates.map(candidateAges)),
  };
}

/** Chips are OR'd within a facet and AND'd across facets. */
export function applyFilters(
  candidates: Candidate[],
  state: FilterState,
): Candidate[] {
  const { minIndex, maxIndex, countries, ageGroups } = state;
  const boundsSet = minIndex != null || maxIndex != null;

  return candidates.filter((c) => {
    if (boundsSet) {
      const indexes = candidateIndexes(c);
      // A runner with no index is not inside any numeric band.
      if (indexes.length === 0) return false;
      const inBand = indexes.some(
        (i) => (minIndex == null || i >= minIndex) && (maxIndex == null || i <= maxIndex),
      );
      if (!inBand) return false;
    }
    if (countries.length > 0) {
      const own = candidateCountries(c);
      if (!countries.some((v) => own.includes(v))) return false;
    }
    if (ageGroups.length > 0) {
      const own = candidateAges(c);
      if (!ageGroups.some((v) => own.includes(v))) return false;
    }
    return true;
  });
}

export function activeFilterCount(state: FilterState): number {
  return (
    (state.minIndex != null || state.maxIndex != null ? 1 : 0) +
    state.countries.length +
    state.ageGroups.length
  );
}
