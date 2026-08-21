import { describe, it, expect } from 'vitest';
import {
  buildExport,
  formatList,
  slugify,
  toRunnerList,
  unpinnedRunners,
} from '@/lib/export';
import { parseList } from '@/lib/lists';
import type { RunnerRef } from '@/lib/types';

const RUNNERS: RunnerRef[] = [
  { id: 'seed_2704', name: 'Kilian Jornet', itraRunnerId: 2704, utmbId: 2704 },
  { id: 'a1b2-uuid', name: 'Courtney Dauwalter', itraRunnerId: 30959 },
  { id: 'c3d4-uuid', name: 'Ruth Croft', utmbId: 362813 },
];

describe('toRunnerList', () => {
  it('strips the local-only id', () => {
    const list = toRunnerList(RUNNERS, { name: 'CRIT' });
    for (const r of list.runners) {
      expect(r).not.toHaveProperty('id');
    }
  });

  it('omits absent ids rather than emitting null', () => {
    const json = formatList(toRunnerList(RUNNERS, { name: 'CRIT' }));
    // A null here would be rejected by parseList on read.
    expect(json).not.toContain('null');

    const [, onlyItra, onlyUtmb] = toRunnerList(RUNNERS, { name: 'CRIT' }).runners;
    expect(onlyItra).not.toHaveProperty('utmbId');
    expect(onlyUtmb).not.toHaveProperty('itraRunnerId');
    expect(onlyUtmb.utmbId).toBe(362813);
  });

  it('omits a blank description but keeps a real one', () => {
    expect(toRunnerList(RUNNERS, { name: 'CRIT' })).not.toHaveProperty('description');
    expect(toRunnerList(RUNNERS, { name: 'CRIT', description: '   ' })).not.toHaveProperty(
      'description',
    );
    expect(toRunnerList(RUNNERS, { name: 'CRIT', description: 'The crew' }).description).toBe(
      'The crew',
    );
  });

  it('carries a nickname across, and omits a blank one', () => {
    const list = toRunnerList(
      [
        { id: 'x', name: 'Lei Yang', alias: '  Big Lei  ', itraRunnerId: 1 },
        { id: 'y', name: 'Ruth Croft', alias: '   ', utmbId: 2 },
      ],
      { name: 'CRIT' },
    );
    expect(list.runners[0].alias).toBe('Big Lei');
    expect(list.runners[1]).not.toHaveProperty('alias');
  });

  it('trims surrounding whitespace from names', () => {
    const list = toRunnerList([{ id: 'x', name: '  Jim Walmsley  ', utmbId: 1 }], {
      name: '  CRIT  ',
    });
    expect(list.name).toBe('CRIT');
    expect(list.runners[0].name).toBe('Jim Walmsley');
  });
});

describe('formatList', () => {
  it('matches the committed file style: 2-space indent, trailing newline', () => {
    const json = formatList(toRunnerList(RUNNERS, { name: 'CRIT' }));
    expect(json.endsWith('\n')).toBe(true);
    expect(json).toContain('\n  "runners": [');
  });
});

// The important one: the export has to survive the app's own reader, so the
// two definitions of the schema can never drift apart.
describe('round-trip through parseList', () => {
  it('produces a file the app can load back', () => {
    const json = formatList(toRunnerList(RUNNERS, { name: 'CRIT', description: 'The crew' }));
    const reparsed = parseList(JSON.parse(json));

    expect(reparsed).not.toBeNull();
    expect(reparsed!.name).toBe('CRIT');
    expect(reparsed!.description).toBe('The crew');
    expect(reparsed!.runners).toEqual([
      { name: 'Kilian Jornet', itraRunnerId: 2704, utmbId: 2704 },
      { name: 'Courtney Dauwalter', itraRunnerId: 30959, utmbId: undefined },
      { name: 'Ruth Croft', itraRunnerId: undefined, utmbId: 362813 },
    ]);
  });

  it('survives an empty roster', () => {
    const json = formatList(toRunnerList([], { name: 'Empty' }));
    expect(parseList(JSON.parse(json))).toMatchObject({ name: 'Empty', runners: [] });
  });

  it('survives names with quotes, accents and non-Latin script', () => {
    const tricky: RunnerRef[] = [
      { id: '1', name: 'Óscar García', itraRunnerId: 1 },
      { id: '2', name: 'A "quoted" name', utmbId: 2 },
      { id: '3', name: '张三', utmbId: 3 },
    ];
    const json = formatList(toRunnerList(tricky, { name: 'Tricky' }));
    const reparsed = parseList(JSON.parse(json));
    expect(reparsed!.runners.map((r) => r.name)).toEqual([
      'Óscar García',
      'A "quoted" name',
      '张三',
    ]);
  });
});

describe('slugify', () => {
  const RULE = /^[a-z0-9][a-z0-9-]*$/; // the rule test/lists.test.ts enforces

  it.each([
    ['CRIT', 'crit'],
    ['My Runners', 'my-runners'],
    ['Óscar & Friends', 'oscar-friends'],
    ['  spaced  out  ', 'spaced-out'],
    ['Trail/Ultra Crew!', 'trail-ultra-crew'],
    ['2026 Squad', '2026-squad'],
    ['---dashes---', 'dashes'],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
    expect(slugify(input)).toMatch(RULE);
  });

  it('falls back when nothing usable survives', () => {
    // A slug must still be a valid filename and URL segment.
    expect(slugify('!!!')).toBe('my-list');
    expect(slugify('张三')).toBe('my-list');
    expect(slugify('')).toBe('my-list');
    expect(slugify('!!!')).toMatch(RULE);
  });
});

describe('unpinnedRunners', () => {
  it('finds runners with neither id', () => {
    const runners: RunnerRef[] = [
      ...RUNNERS,
      { id: 'z', name: 'Unknown Person' },
    ];
    expect(unpinnedRunners(runners).map((r) => r.name)).toEqual(['Unknown Person']);
  });

  it('is empty when every runner is pinned', () => {
    expect(unpinnedRunners(RUNNERS)).toEqual([]);
  });
});

describe('buildExport', () => {
  it('bundles json, slug and warnings together', () => {
    const out = buildExport([...RUNNERS, { id: 'z', name: 'Unknown' }], {
      name: 'My Runners',
    });
    expect(out.slug).toBe('my-runners');
    expect(out.unpinned).toHaveLength(1);
    expect(parseList(JSON.parse(out.json))).not.toBeNull();
  });
});
