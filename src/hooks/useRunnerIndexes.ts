'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeSnapshot, readSnapshot } from '@/lib/storage';
import type { RunnerIndexes, RunnerRef } from '@/lib/types';

/**
 * Paints from the local snapshot immediately, then revalidates against the
 * server. `refresh()` sends force:true so the server bypasses its cache.
 */
export function useRunnerIndexes(runners: RunnerRef[]) {
  const [indexes, setIndexes] = useState<Record<string, RunnerIndexes>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hydrated = useRef(false);

  // Re-fetch when the set of runners changes, not on every render. Everything
  // a lookup is made from belongs here: correcting a runner's pins or the name
  // behind them has to send the card back to the server, or the edit lands in
  // storage and the card goes on showing what the old one resolved to.
  const key = runners
    .map(
      (r) =>
        `${r.id}:${r.name}:${r.itraRunnerId ?? ''}:${r.utmbId ?? ''}:${r.utmbUri ?? ''}`,
    )
    .join('|');

  const load = useCallback(
    async (force: boolean, list: RunnerRef[]) => {
      if (list.length === 0) {
        setIndexes({});
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/indexes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runners: list, force }),
        });
        if (!res.ok) {
          throw new Error(`Lookup failed (${res.status})`);
        }
        const body = (await res.json()) as { results: RunnerIndexes[] };
        mergeSnapshot(body.results);
        setIndexes(Object.fromEntries(body.results.map((r) => [r.id, r])));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      setIndexes(readSnapshot());
    }
    void load(false, runners);
    // `key` is the stable identity of the runner set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, load]);

  const refresh = useCallback(() => load(true, runners), [load, runners]);

  return { indexes, loading, error, refresh };
}
