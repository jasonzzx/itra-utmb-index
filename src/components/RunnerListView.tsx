'use client';

import Link from 'next/link';
import { RunnerCard } from './RunnerCard';
import { useRunnerIndexes } from '@/hooks/useRunnerIndexes';
import type { RunnerRef } from '@/lib/types';

export function RunnerListView({
  runners,
  onRemove,
  emptyMessage,
}: {
  runners: RunnerRef[];
  onRemove?: (id: string) => void;
  emptyMessage?: string;
}) {
  const { indexes, loading, error, refresh } = useRunnerIndexes(runners);

  if (runners.length === 0) {
    return (
      <div className="empty">
        <p>{emptyMessage ?? 'No runners yet.'}</p>
        <Link className="cta" href="/search">
          Find a runner
        </Link>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button className="icon-btn" onClick={refresh} disabled={loading} aria-label="Refresh">
          <span className={loading ? 'spin' : undefined} aria-hidden>
            ↻
          </span>
        </button>
      </div>

      {error && <div className="banner">Couldn&apos;t refresh: {error}</div>}

      <div className="cards">
        {runners.map((r) => (
          <RunnerCard
            key={r.id}
            runner={r}
            indexes={indexes[r.id]}
            loading={loading}
            onRemove={onRemove ? () => onRemove(r.id) : undefined}
          />
        ))}
      </div>
    </>
  );
}
