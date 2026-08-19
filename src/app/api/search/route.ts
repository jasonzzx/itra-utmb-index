import { NextResponse } from 'next/server';
import { cachedItraSearch, cachedUtmbSearch } from '@/lib/cache';

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
    cachedItraSearch(query),
    cachedUtmbSearch(query),
  ]);

  return NextResponse.json({
    query,
    itra: itra.status === 'fulfilled' ? itra.value : [],
    utmb: utmb.status === 'fulfilled' ? utmb.value : [],
    errors: {
      itra: itra.status === 'rejected' ? String(itra.reason?.message ?? itra.reason) : null,
      utmb: utmb.status === 'rejected' ? String(utmb.reason?.message ?? utmb.reason) : null,
    },
  });
}
