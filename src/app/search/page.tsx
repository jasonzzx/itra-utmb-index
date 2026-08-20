'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { prettyName } from '@/lib/format';
import { pairPages, type Candidate } from '@/lib/pair';
import { newRunnerId, readPersonal, writePersonal } from '@/lib/storage';
import type { ItraIndex, RunnerRef, UtmbIndex } from '@/lib/types';

interface SearchResponse {
  itra?: ItraIndex[];
  utmb?: UtmbIndex[];
  pageSize?: number;
  hasMore?: { itra: boolean; utmb: boolean };
  errors?: { itra: string | null; utmb: string | null };
}

const NO_ERRORS = { itra: null, utmb: null };

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [itraPages, setItraPages] = useState<ItraIndex[][]>([]);
  const [utmbPages, setUtmbPages] = useState<UtmbIndex[][]>([]);
  const [hasMore, setHasMore] = useState({ itra: false, utmb: false });
  const [pageSize, setPageSize] = useState(25);
  const [errors, setErrors] = useState<{ itra: string | null; utmb: string | null }>(NO_ERRORS);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<RunnerRef[]>([]);

  // Aborts whatever is in flight — a new query, or a superseded Load more.
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => setSaved(readPersonal()), []);

  const fetchPage = useCallback(async (q: string, offset: number) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setLoading(true);
    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(q)}&offset=${offset}`,
        { signal: controller.signal },
      );
      const body = (await res.json()) as SearchResponse;
      if (controller.signal.aborted) return;

      setPageSize(body.pageSize ?? 25);
      setHasMore(body.hasMore ?? { itra: false, utmb: false });
      setErrors(body.errors ?? NO_ERRORS);
      // offset 0 replaces; anything else appends a page.
      setItraPages((prev) => (offset === 0 ? [body.itra ?? []] : [...prev, body.itra ?? []]));
      setUtmbPages((prev) => (offset === 0 ? [body.utmb ?? []] : [...prev, body.utmb ?? []]));
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setErrors({ itra: 'Search failed', utmb: 'Search failed' });
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      inFlight.current?.abort();
      setItraPages([]);
      setUtmbPages([]);
      setHasMore({ itra: false, utmb: false });
      setErrors(NO_ERRORS);
      setLoading(false);
      return;
    }
    const timer = setTimeout(() => void fetchPage(q, 0), 350);
    return () => clearTimeout(timer);
  }, [query, fetchPage]);

  const candidates = useMemo(
    () => pairPages(itraPages, utmbPages, query.trim()),
    [itraPages, utmbPages, query],
  );

  // Index of the first demoted row, so a divider can mark where the runners
  // that match everything you typed stop.
  const firstWeakIndex = candidates.findIndex((c) => !c.strong);
  const showDivider = firstWeakIndex > 0;

  // Pages fetched so far — the next offset, not the number of rows shown,
  // since the two sources are paged in lockstep.
  const pagesLoaded = Math.max(itraPages.length, utmbPages.length);
  const moreAvailable = hasMore.itra || hasMore.utmb;

  function isAdded(c: Candidate): boolean {
    return saved.some(
      (r) =>
        (c.itra && r.itraRunnerId === c.itra.runnerId) ||
        (c.utmb && r.utmbId === c.utmb.id),
    );
  }

  function add(c: Candidate) {
    if (isAdded(c)) return;
    const next = [
      ...saved,
      {
        id: newRunnerId(),
        // Store the readable form so exported lists aren't SHOUTING.
        name: prettyName(c.name),
        itraRunnerId: c.itra?.runnerId,
        utmbId: c.utmb?.id,
      },
    ];
    setSaved(next);
    writePersonal(next);
  }

  return (
    <>
      <header className="topbar">
        <h1>Add a runner</h1>
      </header>

      <div className="search-field">
        <span aria-hidden>🔍</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name…"
          autoComplete="off"
          autoFocus
          enterKeyHint="search"
        />
        {loading && <span className="spin" aria-hidden>↻</span>}
      </div>

      {errors.itra && <div className="err">ITRA search unavailable: {errors.itra}</div>}
      {errors.utmb && <div className="err">UTMB search unavailable: {errors.utmb}</div>}

      {query.trim().length >= 2 && !loading && candidates.length === 0 && (
        <div className="empty">
          <p>No runners found for “{query.trim()}”.</p>
        </div>
      )}

      {candidates.map((c, i) => {
        const added = isAdded(c);
        return (
          <div key={c.key}>
            {showDivider && i === firstWeakIndex && (
              <div className="group-divider">Other results</div>
            )}
          <button
            className="result"
            data-added={added}
            onClick={() => add(c)}
            disabled={added}
          >
            <div className="who">
              <div className="name">{prettyName(c.name)}</div>
              <div className="meta">
                {[
                  c.itra ? `ITRA ${c.itra.pi}` : 'no ITRA match',
                  c.utmb ? `UTMB ${c.utmb.ip}` : 'no UTMB match',
                  c.itra?.nationality || c.utmb?.nationality,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            <span className="score">{added ? '✓' : '+'}</span>
          </button>
          </div>
        );
      })}

      {moreAvailable && candidates.length > 0 && (
        <button
          className="load-more"
          onClick={() => void fetchPage(query.trim(), pagesLoaded * pageSize)}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </>
  );
}
