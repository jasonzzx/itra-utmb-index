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
  onEdit,
  emptyMessage,
  emptyAction,
  exportMeta,
}: {
  runners: RunnerRef[];
  onRemove?: (id: string) => void;
  /** Change one runner's nickname or pins. Omit to make the list read-only. */
  onEdit?: (id: string, patch: Partial<RunnerRef>) => void;
  emptyMessage?: string;
  /**
   * What to offer instead of "find a runner" when the list is empty for a
   * reason the visitor can undo.
   */
  emptyAction?: { label: string; onClick: () => void };
  /** Omit to hide the export button. */
  exportMeta?: ExportMetaDefaults;
}) {
  const { indexes, loading, error, refresh } = useRunnerIndexes(runners);
  const [exporting, setExporting] = useState(false);

  if (runners.length === 0) {
    return (
      <div className="empty">
        <p>{emptyMessage ?? 'No runners yet.'}</p>
        {emptyAction ? (
          <button className="cta" onClick={emptyAction.onClick}>
            {emptyAction.label}
          </button>
        ) : (
          <Link className="cta" href="/search">
            Find a runner
          </Link>
        )}
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
            onEdit={onEdit ? (patch) => onEdit(r.id, patch) : undefined}
          />
        ))}
      </div>
    </>
  );
}
