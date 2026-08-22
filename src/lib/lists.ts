import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { cacheLife, cacheTag } from 'next/cache';
import type { RunnerList } from './types';

/**
 * Committed lists live in /lists at the repo root so they're easy to edit and
 * review in a pull request. Reading them with fs (rather than importing) keeps
 * adding a list to "drop in a JSON file" with no code change.
 */
const LISTS_DIR = path.join(process.cwd(), 'lists');

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export async function listSlugs(): Promise<string[]> {
  try {
    const entries = await readdir(LISTS_DIR);
    return entries
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .filter((slug) => SLUG_RE.test(slug))
      .sort();
  } catch {
    return [];
  }
}

/** Validate a parsed list, returning null if it doesn't match the schema. */
export function parseList(input: unknown): RunnerList | null {
  if (typeof input !== 'object' || input === null) return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.name !== 'string' || !raw.name.trim()) return null;
  if (!Array.isArray(raw.runners)) return null;

  const runners: RunnerList['runners'] = [];
  for (const entry of raw.runners) {
    if (typeof entry !== 'object' || entry === null) return null;
    const r = entry as Record<string, unknown>;
    if (typeof r.name !== 'string' || !r.name.trim()) return null;
    if (r.alias !== undefined && typeof r.alias !== 'string') return null;
    if (r.itraRunnerId !== undefined && typeof r.itraRunnerId !== 'number') return null;
    if (r.utmbId !== undefined && typeof r.utmbId !== 'number') return null;
    if (r.utmbUri !== undefined && typeof r.utmbUri !== 'string') return null;
    runners.push({
      name: r.name,
      // An empty alias is the same as none, so it doesn't reach the UI as a
      // blank name.
      alias: (r.alias as string | undefined)?.trim() || undefined,
      itraRunnerId: r.itraRunnerId as number | undefined,
      utmbId: r.utmbId as number | undefined,
      utmbUri: (r.utmbUri as string | undefined)?.trim() || undefined,
    });
  }

  return {
    name: raw.name,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    runners,
  };
}

export async function loadList(slug: string): Promise<RunnerList | null> {
  // Committed lists only change on deploy, so this is cached indefinitely.
  // Cache Components also requires the read to be cached for the route to
  // prerender rather than becoming dynamic.
  'use cache';
  cacheLife('max');
  cacheTag('lists', `list:${slug}`);

  // Guard against traversal — slug comes straight off the URL.
  if (!SLUG_RE.test(slug)) return null;
  try {
    const text = await readFile(path.join(LISTS_DIR, `${slug}.json`), 'utf8');
    return parseList(JSON.parse(text));
  } catch {
    return null;
  }
}
