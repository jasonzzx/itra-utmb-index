import { NextResponse } from 'next/server';
import { cachedUtmbCategories } from '@/lib/cache';

/**
 * The five per-distance UTMB indexes for one runner. Split out from
 * /api/indexes because it costs five upstream calls and is only needed when a
 * card is expanded.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const name = params.get('name')?.trim() ?? '';
  const idParam = params.get('id');
  const id = idParam ? Number(idParam) : NaN;

  if (name.length < 2 || !Number.isFinite(id)) {
    return NextResponse.json(
      { error: 'Both `name` (2+ chars) and a numeric `id` are required' },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({ categories: await cachedUtmbCategories(name, id) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
