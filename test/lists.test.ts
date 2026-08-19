import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseList } from '@/lib/lists';

const LISTS_DIR = path.join(process.cwd(), 'lists');
const files = readdirSync(LISTS_DIR).filter((f) => f.endsWith('.json'));

describe('committed lists', () => {
  it('ships at least one list', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  // A malformed shared list should fail CI, not the page.
  it.each(files)('%s matches the schema', (file) => {
    const raw = JSON.parse(readFileSync(path.join(LISTS_DIR, file), 'utf8'));
    const parsed = parseList(raw);
    expect(parsed, `${file} failed schema validation`).not.toBeNull();
    expect(parsed!.runners.length).toBeGreaterThan(0);
  });

  it.each(files)('%s has a URL-safe filename', (file) => {
    expect(file.replace(/\.json$/, '')).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });

  it.each(files)('%s pins every runner with at least one id', (file) => {
    const parsed = parseList(
      JSON.parse(readFileSync(path.join(LISTS_DIR, file), 'utf8')),
    )!;
    for (const r of parsed.runners) {
      expect(
        r.itraRunnerId ?? r.utmbId,
        `"${r.name}" has no itraRunnerId or utmbId, so refreshes may match the wrong person`,
      ).toBeDefined();
    }
  });
});

describe('parseList', () => {
  const valid = { name: 'X', runners: [{ name: 'A', itraRunnerId: 1 }] };

  it('accepts a minimal valid list', () => {
    expect(parseList(valid)).toMatchObject({ name: 'X' });
  });

  it('allows a runner with only a name', () => {
    expect(parseList({ name: 'X', runners: [{ name: 'A' }] })).not.toBeNull();
  });

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['a missing name', { runners: [] }],
    ['a blank name', { name: '  ', runners: [] }],
    ['missing runners', { name: 'X' }],
    ['runners not an array', { name: 'X', runners: {} }],
    ['a runner without a name', { name: 'X', runners: [{ itraRunnerId: 1 }] }],
    ['a non-numeric id', { name: 'X', runners: [{ name: 'A', itraRunnerId: '1' }] }],
  ])('rejects %s', (_label, input) => {
    expect(parseList(input)).toBeNull();
  });

  it('drops unknown fields rather than passing them through', () => {
    const parsed = parseList({ ...valid, evil: 'x', runners: [{ name: 'A', evil: 'y' }] });
    expect(parsed).not.toHaveProperty('evil');
    expect(parsed!.runners[0]).not.toHaveProperty('evil');
  });
});
