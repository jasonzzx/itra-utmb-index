import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SORT,
  indexValue,
  nextSort,
  sortRunners,
  type SortState,
} from '@/lib/sort';
import type { ItraIndex, RunnerIndexes, RunnerRef, UtmbIndex } from '@/lib/types';

const AT = '2026-08-22T00:00:00.000Z';

function itra(pi: number | null): ItraIndex {
  return {
    runnerId: 1, name: 'R', pi: pi as number, piIndex: '', colorCode: '#888',
    nationality: '', gender: '', ageGroup: '', recentRaces: [],
    profileUrl: '', photoUrl: null,
  };
}

function utmb(ip: number): UtmbIndex {
  return {
    id: 1, uri: '', name: 'R', ip, category: 'general',
    nationality: '', sex: '', ageGroup: '', profileUrl: '', photoUrl: null,
  };
}

/** A resolved runner; pass null for "the source has no index for them". */
function entry(id: string, pi: number | null, ip: number | null): RunnerIndexes {
  return {
    id,
    name: id,
    itra: { ok: true, data: pi === null ? null : itra(pi), fetchedAt: AT },
    utmb: { ok: true, data: ip === null ? null : utmb(ip), fetchedAt: AT },
  };
}

const runners: RunnerRef[] = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id }));
const indexes: Record<string, RunnerIndexes> = {
  a: entry('a', 374, 382),
  b: entry('b', 494, 486),
  c: entry('c', null, 348), // no ITRA index, like a runner with no profile
  d: entry('d', 390, 372),
};

const order = (sort: SortState) =>
  sortRunners(runners, indexes, sort).map((r) => r.id);

describe('sortRunners', () => {
  it('ranks by UTMB index, highest first, with no asking', () => {
    expect(DEFAULT_SORT).toEqual({ key: 'utmb', dir: 'desc' });
    expect(order(DEFAULT_SORT)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('ranks by ITRA index, highest first', () => {
    expect(order({ key: 'itra', dir: 'desc' })).toEqual(['b', 'd', 'a', 'c']);
  });

  it('ranks by UTMB index, which disagrees with ITRA', () => {
    expect(order({ key: 'utmb', dir: 'desc' })).toEqual(['b', 'a', 'd', 'c']);
  });

  it('reverses on ascending but still sinks the unranked', () => {
    // 'c' has no ITRA index, so it stays last rather than leading.
    expect(order({ key: 'itra', dir: 'asc' })).toEqual(['a', 'd', 'b', 'c']);
  });

  it('keeps list order among runners with no index', () => {
    const none = { key: 'itra', dir: 'desc' } as const;
    const blank = Object.fromEntries(
      runners.map((r) => [r.id, entry(r.id, null, null)]),
    );
    expect(sortRunners(runners, blank, none).map((r) => r.id)).toEqual([
      'a', 'b', 'c', 'd',
    ]);
  });

  it('keeps list order among equal indexes', () => {
    const tied = {
      a: entry('a', 400, 1), b: entry('b', 400, 1),
      c: entry('c', 400, 1), d: entry('d', 400, 1),
    };
    expect(sortRunners(runners, tied, { key: 'itra', dir: 'desc' }).map((r) => r.id))
      .toEqual(['a', 'b', 'c', 'd']);
  });

  it('treats a runner whose indexes have not arrived as unranked', () => {
    expect(sortRunners(runners, {}, { key: 'utmb', dir: 'desc' }).map((r) => r.id))
      .toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('indexValue', () => {
  it('reads the index off a resolved source', () => {
    expect(indexValue(indexes.a, 'itra')).toBe(374);
    expect(indexValue(indexes.a, 'utmb')).toBe(382);
  });

  it('counts 0 as unranked, which is what it means upstream', () => {
    expect(indexValue(entry('x', 0, 0), 'itra')).toBeNull();
    expect(indexValue(entry('x', 0, 0), 'utmb')).toBeNull();
  });

  it('counts a source that failed as unranked rather than as zero', () => {
    const failed: RunnerIndexes = {
      id: 'x',
      name: 'x',
      itra: { ok: false, error: 'ITRA returned a bot challenge', fetchedAt: AT },
      utmb: { ok: true, data: utmb(500), fetchedAt: AT },
    };
    expect(indexValue(failed, 'itra')).toBeNull();
    expect(indexValue(failed, 'utmb')).toBe(500);
  });

  it('has nothing to read for a runner not in the map', () => {
    expect(indexValue(undefined, 'itra')).toBeNull();
  });
});

describe('nextSort', () => {
  it('starts a new key at highest first', () => {
    expect(nextSort(DEFAULT_SORT, 'itra')).toEqual({ key: 'itra', dir: 'desc' });
    expect(nextSort({ key: 'utmb', dir: 'asc' }, 'itra')).toEqual({
      key: 'itra', dir: 'desc',
    });
  });

  it('flips direction when the active key is tapped again', () => {
    expect(nextSort({ key: 'itra', dir: 'desc' }, 'itra')).toEqual({
      key: 'itra', dir: 'asc',
    });
    expect(nextSort({ key: 'itra', dir: 'asc' }, 'itra')).toEqual({
      key: 'itra', dir: 'desc',
    });
  });

  it('switches back to UTMB highest first', () => {
    expect(nextSort({ key: 'itra', dir: 'asc' }, 'utmb')).toEqual(DEFAULT_SORT);
  });
});
