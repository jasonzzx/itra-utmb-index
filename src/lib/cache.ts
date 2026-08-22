import { cacheLife, cacheTag } from 'next/cache';
import { fetchItraIndex, searchItraWindow } from './itra';
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
  uri?: string,
): Promise<Stamped<ItraIndex | null>> {
  'use cache';
  // The slug addresses the same runner the id does, so it doesn't key the entry.
  cacheTag('indexes', itraTag(runnerId ?? name));
  cacheLife(INDEX_LIFE);
  const data = await fetchItraIndex(name, runnerId, uri);
  return { data, fetchedAt: new Date().toISOString() };
}

export async function cachedUtmbIndex(
  name: string,
  id?: number,
  category: UtmbCategory = 'general',
  uri?: string,
): Promise<Stamped<UtmbIndex | null>> {
  'use cache';
  // The uri addresses the same runner the id does, so it doesn't key the entry.
  cacheTag('indexes', utmbTag(id ?? name, category));
  cacheLife(INDEX_LIFE);
  const data = await fetchUtmbIndex(name, id, category, uri);
  return { data, fetchedAt: new Date().toISOString() };
}

export async function cachedUtmbCategories(
  name: string,
  id: number,
  uri?: string,
): Promise<Partial<Record<UtmbCategory, number>>> {
  'use cache';
  cacheTag('indexes', `utmb-categories:${id}`);
  cacheLife(INDEX_LIFE);
  return fetchUtmbAllCategories(name, id, uri);
}

export async function cachedItraSearch(
  query: string,
  limit: number,
): Promise<ItraIndex[]> {
  'use cache';
  cacheTag('search', `search:itra:${query}`);
  cacheLife(SEARCH_LIFE);
  return searchItraWindow(query, limit);
}

export async function cachedUtmbSearch(
  query: string,
  limit: number,
): Promise<UtmbIndex[]> {
  'use cache';
  cacheTag('search', `search:utmb:${query}`);
  cacheLife(SEARCH_LIFE);
  return searchUtmb(query, 'general', limit);
}
