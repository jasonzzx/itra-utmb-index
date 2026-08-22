import { NextResponse } from 'next/server';
import { cachedUtmbCategories } from '@/lib/cache';

/**
 * The five per-distance UTMB indexes for one runner. Split out from
 * /api/indexes because it costs an extra upstream fetch — five of them without
 * a uri — and is only needed when a card is expanded.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const name = params.get('name')?.trim() ?? '';
  const idParam = params.get('id');
  const id = idParam ? Number(idParam) : NaN;
  // With a uri this is one page load instead of five searches, and it reaches
  // a runner search ranks out of sight.
  const uri = params.get('uri')?.trim() || undefined;

  if (!Number.isFinite(id) || (name.length < 2 && !uri)) {
    return NextResponse.json(
      {
        error:
          'A numeric `id` is required, with either `name` (2+ chars) or `uri`',
      },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({
      categories: await cachedUtmbCategories(name, id, uri),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
