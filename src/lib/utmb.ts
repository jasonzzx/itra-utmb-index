import { outboundFetch } from './http';
import { utmbProfileUrl } from './urls';
import type { UtmbCategory, UtmbIndex } from './types';
import { UTMB_CATEGORIES } from './types';

const SEARCH_API = 'https://api.utmb.world/search/runners';
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
    profileUrl: utmbProfileUrl(raw.uri),
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
  offset = 0,
): Promise<UtmbIndex[]> {
  if (name.trim().length < 2) return [];

  const url = new URL(SEARCH_API);
  url.searchParams.set('category', category);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('search', name);

  const res = await outboundFetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`UTMB search failed with ${res.status}`);
  }
  const body = (await res.json()) as UtmbSearchResponse;
  return (body.runners ?? []).map((r) => toIndex(r, category));
}

/**
 * The runner's own page, which is the only exact UTMB lookup there is.
 *
 * Search ranks by index, so a runner with a modest one and a widely shared
 * name is unreachable through it: "Yu Chen" returns 684 people and the one you
 * mean, at 382, is nowhere near the rows we fetch. Pinning the id cannot
 * rescue that, because the id is only ever matched *within* the search
 * results. The profile page has no such ceiling — but it is addressed by the
 * full slug, `7388490.yu.chen`, and 404s on the id alone, which is why the uri
 * is stored beside the id.
 *
 * The page is a Next.js app and hands its props to the client in a
 * `__NEXT_DATA__` script, which carries the name, nationality, age group and
 * all five category indexes at once.
 */
const NEXT_DATA_RE =
  /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;

interface UtmbPageProps {
  fullname?: string | null;
  nationalityCode?: string | null;
  ageGroup?: string | null;
  gender?: string | null;
  profilePicture?: string | null;
  performanceIndexes?: Array<{
    piCategory?: string;
    index?: number | null;
  }> | null;
}

/** Everything one page load yields: the general index and every category. */
export interface UtmbProfile {
  index: UtmbIndex;
  categories: Partial<Record<UtmbCategory, number>>;
}

export function extractPageProps(html: string): UtmbPageProps | null {
  const match = NEXT_DATA_RE.exec(html);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]) as {
      props?: { pageProps?: UtmbPageProps };
    };
    return data.props?.pageProps ?? null;
  } catch {
    return null;
  }
}

/**
 * Look a runner up by their profile uri.
 *
 * Returns null for a uri nobody holds — a 404 is an answer, not a failure.
 */
export async function fetchUtmbProfile(
  uri: string,
  category: UtmbCategory = 'general',
): Promise<UtmbProfile | null> {
  const res = await outboundFetch(utmbProfileUrl(uri), { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`UTMB runner page returned ${res.status}`);
  }

  const props = extractPageProps(await res.text());
  if (!props) {
    throw new Error('UTMB runner page did not contain a runner');
  }

  const categories: Partial<Record<UtmbCategory, number>> = {};
  for (const entry of props.performanceIndexes ?? []) {
    const key = entry?.piCategory as UtmbCategory | undefined;
    // A null or 0 index means no index in that category, not a zero score.
    if (key && UTMB_CATEGORIES.includes(key) && entry.index) {
      categories[key] = entry.index;
    }
  }

  // The id leads the slug, which is the only place the page states it.
  const id = Number(uri.split('.')[0]);
  return {
    index: {
      id,
      uri,
      name: props.fullname ?? '',
      ip: categories[category] ?? 0,
      category,
      // The search API reports the country as a code, so match it rather than
      // the page's spelled-out `nationality`.
      nationality: props.nationalityCode ?? '',
      sex: props.gender ?? '',
      ageGroup: props.ageGroup ?? '',
      profileUrl: utmbProfileUrl(uri),
      photoUrl: props.profilePicture ? `${PHOTO_BASE}/${props.profilePicture}` : null,
    },
    categories,
  };
}

/**
 * The index for one runner.
 *
 * Search comes first because it is a small JSON payload against the page's
 * half a megabyte, and it finds most people. A pinned runner it misses is
 * fetched from their profile page instead, which is the only way to reach
 * somebody search ranks out of sight.
 */
export async function fetchUtmbIndex(
  name: string,
  id?: number,
  category: UtmbCategory = 'general',
  uri?: string,
): Promise<UtmbIndex | null> {
  const results =
    name.trim().length >= 2 ? await searchUtmb(name, category, 25) : [];
  if (id != null) {
    const hit = results.find((r) => r.id === id);
    if (hit) return hit;
    return uri ? ((await fetchUtmbProfile(uri, category))?.index ?? null) : null;
  }
  return results[0] ?? null;
}

/**
 * All five category indexes for one runner. Used by the expanded card only.
 *
 * With a uri this is one page load; without one it is five searches, since
 * each category is ranked separately and has to be asked for on its own.
 */
export async function fetchUtmbAllCategories(
  name: string,
  id: number,
  uri?: string,
): Promise<Partial<Record<UtmbCategory, number>>> {
  if (uri) {
    return (await fetchUtmbProfile(uri))?.categories ?? {};
  }

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
