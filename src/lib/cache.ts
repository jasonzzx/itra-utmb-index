import { cacheLife, cacheTag } from 'next/cache';
import { fetchItraIndex, searchItra } from './itra';
import { fetchUtmbAllCategories, fetchUtmbIndex, searchUtmb } from './utmb';
import type { ItraIndex, UtmbCategory, UtmbIndex } from './types';

/**
 * Indexes only move when race results are scored, so a long revalidate window
 * is plenty. Entries are keyed per runner per source — not per list — so two
 * lists containing the same runner share one entry.
 */
const INDEX_LIFE = {
  stale: 60 * 60, // 1h — client may show a stale value while revalidating
  revalidate: 60 * 60 * 12, // 12h — background refresh
  expire: 60 * 60 * 24 * 7, // 7d — hard ceiling
};

/** Search drives discovery, so it's refreshed more eagerly than a saved index. */
const SEARCH_LIFE = {
  stale: 60,
  revalidate: 60 * 5,
  expire: 60 * 60,
};

/**
 * The timestamp has to be produced *inside* the cached function so it is
 * cached alongside the value. Stamping it in the caller would make every
 * cache hit look freshly fetched, and the "updated 3h ago" label would always
 * read "just now".
 */
export interface Stamped<T> {
  data: T;
  fetchedAt: string;
}

export const itraTag = (runnerId: number | string) => `itra:${runnerId}`;
export const utmbTag = (id: number | string, category: UtmbCategory) =>
  `utmb:${id}:${category}`;

export async function cachedItraIndex(
  name: string,
  runnerId?: number,
): Promise<Stamped<ItraIndex | null>> {
  'use cache';
  cacheTag('indexes', itraTag(runnerId ?? name));
  cacheLife(INDEX_LIFE);
  const data = await fetchItraIndex(name, runnerId);
  return { data, fetchedAt: new Date().toISOString() };
}

export async function cachedUtmbIndex(
  name: string,
  id?: number,
  category: UtmbCategory = 'general',
): Promise<Stamped<UtmbIndex | null>> {
  'use cache';
  cacheTag('indexes', utmbTag(id ?? name, category));
  cacheLife(INDEX_LIFE);
  const data = await fetchUtmbIndex(name, id, category);
  return { data, fetchedAt: new Date().toISOString() };
}

export async function cachedUtmbCategories(
  name: string,
  id: number,
): Promise<Partial<Record<UtmbCategory, number>>> {
  'use cache';
  cacheTag('indexes', `utmb-categories:${id}`);
  cacheLife(INDEX_LIFE);
  return fetchUtmbAllCategories(name, id);
}

export async function cachedItraSearch(
  query: string,
  limit: number,
  offset: number,
): Promise<ItraIndex[]> {
  'use cache';
  cacheTag('search', `search:itra:${query}:${offset}`);
  cacheLife(SEARCH_LIFE);
  return searchItra(query, limit, offset);
}

export async function cachedUtmbSearch(
  query: string,
  limit: number,
  offset: number,
): Promise<UtmbIndex[]> {
  'use cache';
  cacheTag('search', `search:utmb:${query}:${offset}`);
  cacheLife(SEARCH_LIFE);
  return searchUtmb(query, 'general', limit, offset);
}
