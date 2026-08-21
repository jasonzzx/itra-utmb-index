'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { displayName, prettyName } from '@/lib/format';
import { parseItraUrl, parseUtmbUrl, type ParsedProfileUrl } from '@/lib/urls';
import type { RunnerIndexes, RunnerRef } from '@/lib/types';

/** The provisional runner sent for the preview lookup. */
const PREVIEW_ID = 'preview';

interface Parsed {
  value: ParsedProfileUrl | null;
  /** Set when there is text in the box that isn't a link we recognise. */
  error: string | null;
}

function parse(
  input: string,
  reader: (s: string) => ParsedProfileUrl | null,
  /** Named with its article, so the message reads "an ITRA runner link". */
  label: string,
): Parsed {
  if (!input.trim()) return { value: null, error: null };
  const value = reader(input);
  return {
    value,
    error: value ? null : `That doesn't look like ${label} runner link.`,
  };
}

/**
 * Adding a runner by pasting their profile links.
 *
 * Searching by name can't always get there: ITRA returns a common name in
 * ranked order and buries somebody with a modest index hundreds of rows down,
 * and when its bot protection turns the app away there is no ITRA search at
 * all. A profile link carries the runner's id, which is exactly one person —
 * so this pins them even while a source is unreachable, and the figures
 * appear the moment it comes back.
 */
export function AddByLink({
  saved,
  onAdd,
}: {
  saved: RunnerRef[];
  onAdd: (runner: Omit<RunnerRef, 'id'>) => void;
}) {
  const [alias, setAlias] = useState('');
  const [itraUrl, setItraUrl] = useState('');
  const [utmbUrl, setUtmbUrl] = useState('');
  const [preview, setPreview] = useState<RunnerIndexes | null>(null);
  const [looking, setLooking] = useState(false);
  const [added, setAdded] = useState<string | null>(null);

  const itra = useMemo(() => parse(itraUrl, parseItraUrl, 'an ITRA'), [itraUrl]);
  const utmb = useMemo(() => parse(utmbUrl, parseUtmbUrl, 'a UTMB'), [utmbUrl]);

  const itraRunnerId = itra.value?.id;
  const utmbId = utmb.value?.id;
  const pinned = itraRunnerId != null || utmbId != null;

  /**
   * The name to look up with. UTMB has no per-runner endpoint, so its slug —
   * which its own search does find — is the one that has to be used; ITRA's
   * is only a label, because ids resolve there on their own.
   */
  const nameHint = utmb.value?.nameHint ?? itra.value?.nameHint ?? '';

  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    inFlight.current?.abort();
    if (!pinned) {
      setPreview(null);
      setLooking(false);
      return;
    }

    const controller = new AbortController();
    inFlight.current = controller;
    setLooking(true);

    // Debounced: a pasted link arrives in one go, but a typed one shouldn't
    // send a lookup per character.
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/indexes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runners: [{ id: PREVIEW_ID, name: nameHint, itraRunnerId, utmbId }],
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
        const body = (await res.json()) as { results: RunnerIndexes[] };
        if (!controller.signal.aborted) setPreview(body.results[0] ?? null);
      } catch {
        if (!controller.signal.aborted) setPreview(null);
      } finally {
        if (!controller.signal.aborted) setLooking(false);
      }
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [pinned, nameHint, itraRunnerId, utmbId]);

  const itraData = preview?.itra.ok ? preview.itra.data : null;
  const utmbData = preview?.utmb.ok ? preview.utmb.data : null;
  const itraError = preview && !preview.itra.ok ? preview.itra.error : null;
  const utmbError = preview && !preview.utmb.ok ? preview.utmb.error : null;

  // Whatever the sources call them, falling back to the link's own slug so a
  // runner can still be added while a source is unreachable.
  const resolvedName = itraData?.name ?? utmbData?.name ?? nameHint;

  // A source we never pinned answered anyway, off the name alone — the very
  // thing that puts a namesake on the card.
  const guessed = [
    itraRunnerId == null && itraData ? 'ITRA' : null,
    utmbId == null && utmbData ? 'UTMB' : null,
  ].filter(Boolean) as string[];

  const duplicate = saved.some(
    (r) =>
      (itraRunnerId != null && r.itraRunnerId === itraRunnerId) ||
      (utmbId != null && r.utmbId === utmbId),
  );

  function add() {
    if (!pinned || duplicate) return;
    onAdd({
      name: resolvedName,
      ...(alias.trim() ? { alias: alias.trim() } : {}),
      ...(itraRunnerId != null ? { itraRunnerId } : {}),
      ...(utmbId != null ? { utmbId } : {}),
    });
    setAdded(displayName({ name: resolvedName, alias }));
    setAlias('');
    setItraUrl('');
    setUtmbUrl('');
    setPreview(null);
  }

  return (
    <div className="sheet">
      <p className="sheet-hint">
        Open a runner on <code>itra.run</code> or <code>utmb.world</code> and
        paste their profile links. Either one on its own is enough — links pin
        the exact runner, which searching by name can&apos;t always do.
      </p>

      <label className="field">
        <span>Nickname</span>
        <input
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          placeholder={resolvedName ? prettyName(resolvedName) : 'Optional'}
          autoComplete="off"
        />
      </label>

      <label className="field">
        <span>ITRA profile link</span>
        <input
          value={itraUrl}
          onChange={(e) => setItraUrl(e.target.value)}
          placeholder="https://itra.run/RunnerSpace/…"
          autoComplete="off"
          inputMode="url"
          spellCheck={false}
        />
      </label>
      {itra.error && <div className="err">{itra.error}</div>}

      <label className="field">
        <span>UTMB profile link</span>
        <input
          value={utmbUrl}
          onChange={(e) => setUtmbUrl(e.target.value)}
          placeholder="https://utmb.world/runner/…"
          autoComplete="off"
          inputMode="url"
          spellCheck={false}
        />
      </label>
      {utmb.error && <div className="err">{utmb.error}</div>}

      {pinned && (
        <div className="preview">
          <div className="who">
            <div className="name">
              {displayName({ name: resolvedName || 'Unnamed runner', alias })}
            </div>
            <div className="meta">
              {[
                // A pi or ip of 0 means no index in that category, not a zero
                // score, so it reads as "—".
                itraRunnerId != null || itraData
                  ? `ITRA ${itraData ? itraData.pi || '—' : looking ? '…' : '—'}`
                  : null,
                utmbId != null || utmbData
                  ? `UTMB ${utmbData ? utmbData.ip || '—' : looking ? '…' : '—'}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
        </div>
      )}

      {/* Whichever link is missing, that source is matched on name instead —
          which is what a link is meant to avoid, so say so. */}
      {guessed.length > 0 && !looking && (
        <div className="sheet-hint">
          {guessed.join(' and ')} matched them by name. Paste{' '}
          {guessed.length > 1 ? 'those links' : 'that link'} too to be sure it
          is the same person.
        </div>
      )}

      {/* One source being unreachable is survivable: the id is still pinned,
          so the figure fills in by itself once it can be fetched. */}
      {itraError && <div className="err">ITRA: {itraError}</div>}
      {utmbError && <div className="err">UTMB: {utmbError}</div>}
      {pinned && !looking && (itraError || utmbError) && (
        <div className="sheet-hint">
          You can still add them — the link pins the runner, and the figure
          appears once that source is reachable again.
        </div>
      )}

      {duplicate && <div className="warn">That runner is already on your list.</div>}

      <button className="copy-btn text-btn" onClick={add} disabled={!pinned || duplicate}>
        {pinned ? 'Add runner' : 'Paste a profile link'}
      </button>

      {added && <div className="stamp">Added {added}.</div>}
    </div>
  );
}
