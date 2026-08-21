'use client';

import Link from 'next/link';
import { useState } from 'react';
import { RunnerCard } from './RunnerCard';
import { ExportSheet, type ExportMetaDefaults } from './ExportSheet';
import { useRunnerIndexes } from '@/hooks/useRunnerIndexes';
import type { RunnerRef } from '@/lib/types';

export function RunnerListView({
  runners,
  onRemove,
  onRename,
  emptyMessage,
  exportMeta,
}: {
  runners: RunnerRef[];
  onRemove?: (id: string) => void;
  /** Set a runner's nickname, or clear it with an empty string. */
  onRename?: (id: string, alias: string) => void;
  emptyMessage?: string;
  /** Omit to hide the export button. */
  exportMeta?: ExportMetaDefaults;
}) {
  const { indexes, loading, error, refresh } = useRunnerIndexes(runners);
  const [exporting, setExporting] = useState(false);

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
      <div className="toolbar">
        {exportMeta && (
          <button className="text-btn" onClick={() => setExporting((v) => !v)}>
            {exporting ? 'Close' : 'Export'}
          </button>
        )}
        <button className="icon-btn" onClick={refresh} disabled={loading} aria-label="Refresh">
          <span className={loading ? 'spin' : undefined} aria-hidden>
            ↻
          </span>
        </button>
      </div>

      {exporting && exportMeta && (
        <ExportSheet
          runners={runners}
          defaults={exportMeta}
          onClose={() => setExporting(false)}
        />
      )}

      {error && <div className="banner">Couldn&apos;t refresh: {error}</div>}

      <div className="cards">
        {runners.map((r) => (
          <RunnerCard
            key={r.id}
            runner={r}
            indexes={indexes[r.id]}
            loading={loading}
            onRemove={onRemove ? () => onRemove(r.id) : undefined}
            onRename={onRename ? (alias) => onRename(r.id, alias) : undefined}
          />
        ))}
      </div>
    </>
  );
}
