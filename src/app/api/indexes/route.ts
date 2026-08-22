import { NextResponse } from 'next/server';
import { getManyRunnerIndexes } from '@/lib/indexes';
import type { RunnerRef } from '@/lib/types';

/** Guard against a runaway client sending an unbounded list. */
const MAX_RUNNERS = 100;

interface Body {
  runners?: unknown;
  force?: unknown;
}

function parseRunners(input: unknown): RunnerRef[] | null {
  if (!Array.isArray(input)) return null;
  const out: RunnerRef[] = [];
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.name !== 'string') return null;
    const pinned =
      typeof r.itraRunnerId === 'number' || typeof r.utmbId === 'number';
    // A name is how an unpinned runner is found at all, so it's required —
    // but somebody added from a profile link may only ever have had an id,
    // and ITRA resolves that on its own.
    if (!r.name.trim() && !pinned) return null;
    out.push({
      id: r.id,
      name: r.name,
      itraRunnerId: typeof r.itraRunnerId === 'number' ? r.itraRunnerId : undefined,
      utmbId: typeof r.utmbId === 'number' ? r.utmbId : undefined,
      utmbUri: typeof r.utmbUri === 'string' ? r.utmbUri : undefined,
    });
  }
  return out;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const runners = parseRunners(body.runners);
  if (!runners) {
    return NextResponse.json(
      {
        error:
          'Expected `runners` to be an array of { id, name }, where an entry ' +
          'with an empty name carries an itraRunnerId or utmbId instead',
      },
      { status: 400 },
    );
  }
  if (runners.length > MAX_RUNNERS) {
    return NextResponse.json(
      { error: `At most ${MAX_RUNNERS} runners per request` },
      { status: 400 },
    );
  }
  if (runners.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const results = await getManyRunnerIndexes(runners, body.force === true);
  return NextResponse.json(
    { results },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
