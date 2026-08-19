'use client';

import { useEffect, useMemo, useState } from 'react';
import { prettyName } from '@/lib/format';
import { newRunnerId, readPersonal, writePersonal } from '@/lib/storage';
import type { ItraIndex, RunnerRef, UtmbIndex } from '@/lib/types';

interface Candidate {
  key: string;
  name: string;
  itra?: ItraIndex;
  utmb?: UtmbIndex;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/**
 * One row per person. ITRA and UTMB are matched on runner id where they agree
 * (UTMB reuses ITRA's ids in practice) and on normalized name otherwise, so
 * adding a runner captures both profiles in a single tap.
 */
function pair(itra: ItraIndex[], utmb: UtmbIndex[]): Candidate[] {
  const byId = new Map<number, Candidate>();
  const byName = new Map<string, Candidate>();
  const out: Candidate[] = [];

  for (const r of itra) {
    const c: Candidate = { key: `itra:${r.runnerId}`, name: r.name, itra: r };
    byId.set(r.runnerId, c);
    byName.set(norm(r.name), c);
    out.push(c);
  }

  for (const r of utmb) {
    const match = byId.get(r.id) ?? byName.get(norm(r.name));
    if (match && !match.utmb) {
      match.utmb = r;
    } else if (!match) {
      out.push({ key: `utmb:${r.id}`, name: r.name, utmb: r });
    }
  }

  // Strongest runners first — most searches are for a known name.
  return out.sort(
    (a, b) => Math.max(b.itra?.pi ?? 0, b.utmb?.ip ?? 0) - Math.max(a.itra?.pi ?? 0, a.utmb?.ip ?? 0),
  );
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [itra, setItra] = useState<ItraIndex[]>([]);
  const [utmb, setUtmb] = useState<UtmbIndex[]>([]);
  const [errors, setErrors] = useState<{ itra: string | null; utmb: string | null }>({
    itra: null,
    utmb: null,
  });
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<RunnerRef[]>([]);

  useEffect(() => setSaved(readPersonal()), []);

  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setItra([]);
      setUtmb([]);
      setErrors({ itra: null, utmb: null });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        const body = await res.json();
        setItra(body.itra ?? []);
        setUtmb(body.utmb ?? []);
        setErrors(body.errors ?? { itra: null, utmb: null });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setErrors({ itra: 'Search failed', utmb: 'Search failed' });
        }
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const candidates = useMemo(() => pair(itra, utmb), [itra, utmb]);

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

      {candidates.map((c) => {
        const added = isAdded(c);
        return (
          <button
            key={c.key}
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
        );
      })}
    </>
  );
}
