'use client';

import { useState } from 'react';
import { readItraUrl, readUtmbUrl, itraProfileUrl } from '@/lib/urls';
import type { ItraIndex, RunnerRef, UtmbIndex } from '@/lib/types';

/**
 * Correcting a runner already on a list.
 *
 * The pins are what make a refresh land on the right person, and they can be
 * wrong from the start: a search that couldn't reach ITRA leaves that half
 * unpinned forever, and a name-matched source can be a namesake. Pasting the
 * profile link fixes either, on the card, without removing and re-adding.
 */
export function RunnerEditor({
  runner,
  itra,
  utmb,
  onEdit,
}: {
  runner: RunnerRef;
  itra: ItraIndex | null;
  utmb: UtmbIndex | null;
  onEdit: (patch: Partial<RunnerRef>) => void;
}) {
  // Null until edited, so the field keeps following the resolved value while
  // it is still arriving, and stops the moment the user takes it over.
  const [aliasDraft, setAliasDraft] = useState<string | null>(null);
  const [itraDraft, setItraDraft] = useState<string | null>(null);
  const [utmbDraft, setUtmbDraft] = useState<string | null>(null);

  // What the runner is pinned to now. UTMB has no address that works from an
  // id alone — its URLs carry a name slug — so an unresolved pin can only be
  // named in the placeholder.
  const itraCurrent =
    itra?.profileUrl ??
    (runner.itraRunnerId != null ? itraProfileUrl(runner.itraRunnerId) : '');
  const utmbCurrent = utmb?.profileUrl ?? '';

  const itraValue = itraDraft ?? itraCurrent;
  const utmbValue = utmbDraft ?? utmbCurrent;

  const itraParsed = readItraUrl(itraValue);
  const utmbParsed = readUtmbUrl(utmbValue);

  /**
   * Clearing the last thing we can find a runner by would leave a card that
   * can never resolve again, so it is refused rather than silently accepted.
   */
  const strandedBy = (keeping: number | undefined) =>
    !runner.name.trim() && keeping == null;

  function editItra(raw: string) {
    setItraDraft(raw);
    if (!raw.trim()) {
      if (!strandedBy(runner.utmbId)) onEdit({ itraRunnerId: undefined });
      return;
    }
    const parsed = readItraUrl(raw).value;
    if (parsed && parsed.id !== runner.itraRunnerId) {
      onEdit({ itraRunnerId: parsed.id });
    }
  }

  function editUtmb(raw: string) {
    setUtmbDraft(raw);
    if (!raw.trim()) {
      if (!strandedBy(runner.itraRunnerId)) onEdit({ utmbId: undefined });
      return;
    }
    const parsed = readUtmbUrl(raw).value;
    if (!parsed || parsed.id === runner.utmbId) return;
    // UTMB is refreshed by searching the name and matching the id, so a new
    // pin needs the name that goes with it or the lookup finds nobody. The
    // slug in the link is exactly that name.
    onEdit({
      utmbId: parsed.id,
      ...(parsed.nameHint ? { name: parsed.nameHint } : {}),
    });
  }

  const stranded =
    (itraParsed.value == null && !itraValue.trim() && strandedBy(runner.utmbId)) ||
    (utmbParsed.value == null && !utmbValue.trim() && strandedBy(runner.itraRunnerId));

  return (
    <div className="editor">
      <label className="field">
        <span>Nickname</span>
        <input
          value={aliasDraft ?? runner.alias ?? ''}
          onChange={(e) => {
            setAliasDraft(e.target.value);
            // A cleared box means "no nickname", not a nickname of "".
            onEdit({ alias: e.target.value.trim() ? e.target.value : undefined });
          }}
          placeholder={itra?.name ?? utmb?.name ?? runner.name}
          autoComplete="off"
        />
      </label>

      <label className="field">
        <span>ITRA profile link</span>
        <input
          value={itraValue}
          onChange={(e) => editItra(e.target.value)}
          placeholder={
            runner.itraRunnerId != null
              ? `Pinned to ITRA ${runner.itraRunnerId}`
              : 'https://itra.run/RunnerSpace/…'
          }
          autoComplete="off"
          inputMode="url"
          spellCheck={false}
        />
      </label>
      {itraParsed.error && <div className="err">{itraParsed.error}</div>}

      <label className="field">
        <span>UTMB profile link</span>
        <input
          value={utmbValue}
          onChange={(e) => editUtmb(e.target.value)}
          placeholder={
            runner.utmbId != null
              ? `Pinned to UTMB ${runner.utmbId}`
              : 'https://utmb.world/runner/…'
          }
          autoComplete="off"
          inputMode="url"
          spellCheck={false}
        />
      </label>
      {utmbParsed.error && <div className="err">{utmbParsed.error}</div>}

      {stranded && (
        <div className="warn">
          This runner has no name on file, so the link is the only way to find
          them. Paste the other source&apos;s link before clearing this one.
        </div>
      )}

      {/* Clearing a pin doesn't erase the runner — it falls back to matching
          on name, which is what pinning was there to prevent. */}
      {(runner.itraRunnerId == null || runner.utmbId == null) && !stranded && (
        <p className="sheet-hint">
          An unpinned source is matched on name, so it can land on a namesake.
          Paste the link to pin it.
        </p>
      )}
    </div>
  );
}
