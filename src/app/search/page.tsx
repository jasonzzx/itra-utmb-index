'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SearchFilters } from '@/components/SearchFilters';
import {
  applyFilters,
  EMPTY_FILTERS,
  filterOptions,
  type FilterState,
} from '@/lib/filter';
import { prettyName, shortRace } from '@/lib/format';
import { pairPages, type Candidate } from '@/lib/pair';
import { newRunnerId, readPersonal, writePersonal } from '@/lib/storage';
import type { ItraIndex, RunnerRef, UtmbIndex } from '@/lib/types';

interface SearchResponse {
  itra?: ItraIndex[];
  utmb?: UtmbIndex[];
  truncated?: { itra: boolean; utmb: boolean };
  errors?: { itra: string | null; utmb: string | null };
}

const NO_ERRORS = { itra: null, utmb: null };

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [itra, setItra] = useState<ItraIndex[]>([]);
  const [utmb, setUtmb] = useState<UtmbIndex[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [errors, setErrors] = useState<{ itra: string | null; utmb: string | null }>(NO_ERRORS);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<RunnerRef[]>([]);

  // Aborts the request in flight when the query changes under it.
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => setSaved(readPersonal()), []);

  const runSearch = useCallback(async (q: string) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      });
      const body = (await res.json()) as SearchResponse;
      if (controller.signal.aborted) return;

      setItra(body.itra ?? []);
      setUtmb(body.utmb ?? []);
      setTruncated(Boolean(body.truncated?.itra || body.truncated?.utmb));
      setErrors(body.errors ?? NO_ERRORS);
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
    // A new query invalidates whatever was filtered from the old one.
    setFilters(EMPTY_FILTERS);
    if (q.length < 2) {
      inFlight.current?.abort();
      setItra([]);
      setUtmb([]);
      setTruncated(false);
      setErrors(NO_ERRORS);
      setLoading(false);
      return;
    }
    const timer = setTimeout(() => void runSearch(q), 350);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);

  const all = useMemo(
    () => pairPages(itra, utmb, query.trim()),
    [itra, utmb, query],
  );
  const options = useMemo(() => filterOptions(all), [all]);
  const candidates = useMemo(() => applyFilters(all, filters), [all, filters]);

  // Index of the first demoted row, so a divider can mark where the runners
  // matching everything you typed stop.
  const firstWeakIndex = candidates.findIndex((c) => !c.strong);
  const showDivider = firstWeakIndex > 0;

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

      {all.length > 0 && (
        <SearchFilters
          options={options}
          state={filters}
          onChange={setFilters}
          shown={candidates.length}
          total={all.length}
        />
      )}

      {query.trim().length >= 2 && !loading && candidates.length === 0 && (
        <div className="empty">
          <p>
            {all.length > 0
              ? 'No runners match those filters.'
              : `No runners found for “${query.trim()}”.`}
          </p>
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
                    // An index of 0 means the runner has no index, not a zero
                    // score, so it reads as "no index" rather than "0".
                    c.itra ? (c.itra.pi ? `ITRA ${c.itra.pi}` : 'ITRA —') : 'no ITRA match',
                    c.utmb ? (c.utmb.ip ? `UTMB ${c.utmb.ip}` : 'UTMB —') : 'no UTMB match',
                    c.itra?.nationality || c.utmb?.nationality,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {/* The strongest human discriminator when a name is shared —
                    "2026 · Chongli 168" identifies a person, "CN · 40-44"
                    does not. ITRA sends this with every search result. */}
                {c.itra?.recentRaces[0] && (
                  <div className="race">{shortRace(c.itra.recentRaces[0])}</div>
                )}
              </div>
              <span className="score">{added ? '✓' : '+'}</span>
            </button>
          </div>
        );
      })}

      {truncated && candidates.length > 0 && (
        <p className="tail-note">
          Showing the {candidates.length} closest matches. Add a first name to
          narrow it down.
        </p>
      )}
    </>
  );
}
