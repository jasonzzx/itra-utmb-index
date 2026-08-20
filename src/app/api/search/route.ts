import { NextResponse } from 'next/server';
import { cachedItraSearch, cachedUtmbSearch } from '@/lib/cache';

/**
 * How wide a net one search casts. There is no "Load more" — a search fetches
 * this much in a single round trip and ranks it.
 *
 * These are windows, not totals. A bare common surname has far more matches
 * than anyone will scroll: "garcia" is 21,594 on ITRA and 23,310 on UTMB, and
 * ITRA's 49-row-per-request ceiling would make fetching that 441 sequential
 * requests. A full-name search — the case that matters — returns 1 ITRA row,
 * so the window only ever truncates the tail nobody reads.
 */
const ITRA_WINDOW = 250; // 5 parallel requests against ITRA's 49-row cap
const UTMB_WINDOW = 500; // a single request; UTMB serves thousands per call

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';

  // ITRA rejects queries shorter than 2 characters outright.
  if (query.length < 2) {
    return NextResponse.json(
      { error: 'Query must be at least 2 characters' },
      { status: 400 },
    );
  }

  // Each source is settled independently so one outage still returns the other.
  const [itra, utmb] = await Promise.allSettled([
    cachedItraSearch(query, ITRA_WINDOW),
    cachedUtmbSearch(query, UTMB_WINDOW),
  ]);

  const itraRows = itra.status === 'fulfilled' ? itra.value : [];
  const utmbRows = utmb.status === 'fulfilled' ? utmb.value : [];

  return NextResponse.json({
    query,
    itra: itraRows,
    utmb: utmbRows,
    // A full window means there were more results than we asked for. Reported
    // so the UI can say so honestly rather than implying the list is complete.
    truncated: {
      itra: itraRows.length >= ITRA_WINDOW,
      utmb: utmbRows.length >= UTMB_WINDOW,
    },
    errors: {
      itra: itra.status === 'rejected' ? String(itra.reason?.message ?? itra.reason) : null,
      utmb: utmb.status === 'rejected' ? String(utmb.reason?.message ?? utmb.reason) : null,
    },
  });
}
