import { outboundFetch } from './http';
import type { UtmbCategory, UtmbIndex } from './types';
import { UTMB_CATEGORIES } from './types';

const SEARCH_API = 'https://api.utmb.world/search/runners';
const PROFILE_BASE = 'https://utmb.world/runner';
const PHOTO_BASE = 'https://res.cloudinary.com/utmb-world/image/upload';

/** Raw runner record from the UTMB search API. */
interface UtmbRawRunner {
  id: number;
  ageGroup: string;
  fullname: string;
  uri: string;
  /** The UTMB Index for the requested category. */
  ip: number;
  nationality: string;
  sex: string;
  picture: string | null;
}

interface UtmbSearchResponse {
  category: string;
  nbHits: number;
  runners: UtmbRawRunner[];
}

function toIndex(raw: UtmbRawRunner, category: UtmbCategory): UtmbIndex {
  return {
    id: raw.id,
    uri: raw.uri,
    name: raw.fullname,
    ip: raw.ip,
    category,
    nationality: raw.nationality ?? '',
    sex: raw.sex ?? '',
    ageGroup: raw.ageGroup ?? '',
    profileUrl: `${PROFILE_BASE}/${raw.uri}`,
    photoUrl: raw.picture ? `${PHOTO_BASE}/${raw.picture}` : null,
  };
}

/**
 * Search UTMB by name. The API is unauthenticated but sends no CORS headers,
 * so this can only run server-side.
 */
export async function searchUtmb(
  name: string,
  category: UtmbCategory = 'general',
  limit = 10,
): Promise<UtmbIndex[]> {
  if (name.trim().length < 2) return [];

  const url = new URL(SEARCH_API);
  url.searchParams.set('category', category);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', '0');
  url.searchParams.set('search', name);

  const res = await outboundFetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`UTMB search failed with ${res.status}`);
  }
  const body = (await res.json()) as UtmbSearchResponse;
  return (body.runners ?? []).map((r) => toIndex(r, category));
}

/** Refresh a pinned runner: search by name, match strictly on id. */
export async function fetchUtmbIndex(
  name: string,
  id?: number,
  category: UtmbCategory = 'general',
): Promise<UtmbIndex | null> {
  const results = await searchUtmb(name, category, 25);
  if (id != null) {
    return results.find((r) => r.id === id) ?? null;
  }
  return results[0] ?? null;
}

/**
 * All five category indexes for one runner, fetched in parallel. Used by the
 * expanded card only — the list view fetches `general` alone to stay fast.
 */
export async function fetchUtmbAllCategories(
  name: string,
  id: number,
): Promise<Partial<Record<UtmbCategory, number>>> {
  const settled = await Promise.allSettled(
    UTMB_CATEGORIES.map((c) => fetchUtmbIndex(name, id, c)),
  );
  const out: Partial<Record<UtmbCategory, number>> = {};
  settled.forEach((result, i) => {
    // ip === 0 means the runner has no index in that category, not a zero
    // score, so it's omitted rather than rendered as "0".
    if (result.status === 'fulfilled' && result.value && result.value.ip > 0) {
      out[UTMB_CATEGORIES[i]] = result.value.ip;
    }
  });
  return out;
}
