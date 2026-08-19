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
    if (!r.name.trim()) return null;
    out.push({
      id: r.id,
      name: r.name,
      itraRunnerId: typeof r.itraRunnerId === 'number' ? r.itraRunnerId : undefined,
      utmbId: typeof r.utmbId === 'number' ? r.utmbId : undefined,
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
      { error: 'Expected `runners` to be an array of { id, name }' },
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
