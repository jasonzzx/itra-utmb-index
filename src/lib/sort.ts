import type { RunnerIndexes, RunnerRef } from './types';

/**
 * Ordering a list by what it is for: the numbers. A list is always ranked by
 * one index or the other — the order the runners happen to sit in the file is
 * not one of the choices.
 */
export type SortKey = 'utmb' | 'itra';
export type SortDir = 'desc' | 'asc';

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

export const DEFAULT_SORT: SortState = { key: 'utmb', dir: 'desc' };

/**
 * The number to sort on, or null for "no index".
 *
 * Null covers three cases that all mean the same thing on screen: the source
 * has no index for this runner, it doesn't know them, or it couldn't be
 * reached. A pi or ip of 0 is ITRA and UTMB's own way of saying "unranked",
 * never a score of zero, so it counts as absent here exactly as it renders
 * as an em dash on the card.
 */
export function indexValue(
  entry: RunnerIndexes | undefined,
  key: SortKey,
): number | null {
  if (!entry) return null;
  if (key === 'itra') {
    return entry.itra.ok ? (entry.itra.data?.pi || null) : null;
  }
  return entry.utmb.ok ? (entry.utmb.data?.ip || null) : null;
}

/**
 * Sort for display only — the caller keeps the original array for lookups, so
 * reordering never looks like the set of runners changed.
 *
 * Runners with no index sink to the bottom in both directions. Ascending is
 * for reading the field from the bottom up, not for promoting the people the
 * app has nothing to say about, and they keep their list order down there.
 */
export function sortRunners(
  runners: RunnerRef[],
  indexes: Record<string, RunnerIndexes>,
  sort: SortState,
): RunnerRef[] {
  const key = sort.key;
  return runners
    .map((runner, position) => ({
      runner,
      position,
      value: indexValue(indexes[runner.id], key),
    }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) {
        if (a.value === b.value) return a.position - b.position;
        return a.value === null ? 1 : -1;
      }
      if (a.value !== b.value) {
        return sort.dir === 'desc' ? b.value - a.value : a.value - b.value;
      }
      // Ties keep the order the list already had, so equal indexes don't
      // shuffle between renders, and the file's order still decides something.
      return a.position - b.position;
    })
    .map((entry) => entry.runner);
}

/** Tapping the active key flips it; tapping the other switches, highest first. */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key !== key) return { key, dir: 'desc' };
  return { key, dir: current.dir === 'desc' ? 'asc' : 'desc' };
}
