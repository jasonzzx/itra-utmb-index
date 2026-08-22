'use client';

import Link from 'next/link';
import { useState } from 'react';
import { RunnerCard } from './RunnerCard';
import { ExportSheet, type ExportMetaDefaults } from './ExportSheet';
import { useRunnerIndexes } from '@/hooks/useRunnerIndexes';
import {
  DEFAULT_SORT,
  nextSort,
  sortRunners,
  type SortKey,
  type SortState,
} from '@/lib/sort';
import type { RunnerRef } from '@/lib/types';

const SORTS: Array<{ key: SortKey; label: string; description: string }> = [
  { key: 'list', label: 'List', description: 'Keep the list order' },
  { key: 'itra', label: 'ITRA', description: 'Sort by ITRA index' },
  { key: 'utmb', label: 'UTMB', description: 'Sort by UTMB index' },
];

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
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  // Sorted for display only. The hook and the export keep the original array,
  // so reordering the cards never looks like the list itself changed.
  const shown = sortRunners(runners, indexes, sort);

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
        <div className="sort" role="group" aria-label="Sort by">
          {SORTS.map(({ key, label, description }) => {
            const active = sort.key === key;
            return (
              <button
                key={key}
                data-active={active}
                aria-pressed={active}
                // "ITRA" alone reads the same as the badge on every card; say
                // what the button does instead.
                aria-label={description}
                onClick={() => setSort((s) => nextSort(s, key))}
              >
                {label}
                {active && key !== 'list' && (
                  <span aria-hidden>{sort.dir === 'desc' ? ' ↓' : ' ↑'}</span>
                )}
              </button>
            );
          })}
        </div>

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
        {shown.map((r) => (
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
