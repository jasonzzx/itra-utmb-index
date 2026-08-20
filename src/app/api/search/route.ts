import { NextResponse } from 'next/server';
import { cachedItraSearch, cachedUtmbSearch } from '@/lib/cache';

/**
 * Rows fetched per source per page. Comfortably under ITRA's hard cap of 49
 * rows per request, and small enough to keep the payload light on mobile.
 */
export const PAGE_SIZE = 25;

/**
 * Ceiling on how deep paging can go. Both APIs report unreliable totals, so
 * this is what stops a client walking the offset forever.
 */
const MAX_OFFSET = 500;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get('q')?.trim() ?? '';

  // ITRA rejects queries shorter than 2 characters outright.
  if (query.length < 2) {
    return NextResponse.json(
      { error: 'Query must be at least 2 characters' },
      { status: 400 },
    );
  }

  const rawOffset = params.get('offset');
  const offset = rawOffset ? Number(rawOffset) : 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
    return NextResponse.json(
      { error: `offset must be an integer between 0 and ${MAX_OFFSET}` },
      { status: 400 },
    );
  }

  // Each source is settled independently so one outage still returns the other.
  const [itra, utmb] = await Promise.allSettled([
    cachedItraSearch(query, PAGE_SIZE, offset),
    cachedUtmbSearch(query, PAGE_SIZE, offset),
  ]);

  const itraRows = itra.status === 'fulfilled' ? itra.value : [];
  const utmbRows = utmb.status === 'fulfilled' ? utmb.value : [];

  return NextResponse.json({
    query,
    offset,
    pageSize: PAGE_SIZE,
    itra: itraRows,
    utmb: utmbRows,
    // Neither API reports a total we can trust — ITRA's ResultCount disagrees
    // with reality and UTMB's nbHits shifts with the page size — so a full
    // page coming back is the only sound signal that more exists.
    hasMore: {
      itra: itraRows.length === PAGE_SIZE && offset + PAGE_SIZE <= MAX_OFFSET,
      utmb: utmbRows.length === PAGE_SIZE && offset + PAGE_SIZE <= MAX_OFFSET,
    },
    errors: {
      itra: itra.status === 'rejected' ? String(itra.reason?.message ?? itra.reason) : null,
      utmb: utmb.status === 'rejected' ? String(utmb.reason?.message ?? utmb.reason) : null,
    },
  });
}
