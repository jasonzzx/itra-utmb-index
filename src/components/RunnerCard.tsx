'use client';

import { useEffect, useState } from 'react';
import { RunnerEditor } from './RunnerEditor';
import { ago, displayName, initials, prettyName } from '@/lib/format';
import type { RunnerIndexes, RunnerRef, UtmbCategory } from '@/lib/types';

/** Profile photos 404 often enough that a broken-image icon is a real risk. */
function Avatar({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <div className="avatar avatar-fallback">{initials(name)}</div>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="avatar"
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function Badge({
  label,
  value,
  kind,
  loading,
}: {
  label: string;
  value: number | null;
  kind: 'itra' | 'utmb';
  loading: boolean;
}) {
  return (
    <div className={`badge ${kind}`}>
      <span className="label">{label}</span>
      {loading ? (
        <span className="skeleton" />
      ) : (
        // ip/pi of 0 means "no index in this category", not a zero score.
        <span className={`value${value ? '' : ' muted'}`}>{value || '—'}</span>
      )}
    </div>
  );
}

export function RunnerCard({
  runner,
  indexes,
  loading,
  onRemove,
  onEdit,
}: {
  runner: RunnerRef;
  indexes?: RunnerIndexes;
  loading: boolean;
  onRemove?: () => void;
  /** Change the nickname or either pin. Omit to make the card read-only. */
  onEdit?: (patch: Partial<RunnerRef>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  const itra = indexes?.itra.ok ? indexes.itra.data : null;
  const utmb = indexes?.utmb.ok ? indexes.utmb.data : null;
  const itraErr = indexes && !indexes.itra.ok ? indexes.itra.error : null;
  const utmbErr = indexes && !indexes.utmb.ok ? indexes.utmb.error : null;

  const photo = itra?.photoUrl ?? utmb?.photoUrl ?? null;
  // The sources know their registered name; the alias is what you call them.
  const sourceName = prettyName(itra?.name ?? utmb?.name ?? runner.name);
  const label = displayName({ name: sourceName, alias: runner.alias });
  const meta = [
    itra?.nationality || utmb?.nationality,
    itra?.ageGroup || utmb?.ageGroup,
    itra?.piIndex,
  ]
    .filter(Boolean)
    .join(' · ');

  // An extra upstream fetch, so only made once the card is actually expanded.
  const utmbId = utmb?.id ?? runner.utmbId;
  const utmbUri = utmb?.uri ?? runner.utmbUri;
  const [cats, setCats] = useState<Partial<Record<UtmbCategory, number>> | null>(
    null,
  );

  useEffect(() => {
    if (!open || cats || !utmbId) return;
    const controller = new AbortController();
    const url = new URL('/api/categories', window.location.origin);
    url.searchParams.set('name', runner.name);
    url.searchParams.set('id', String(utmbId));
    if (utmbUri) url.searchParams.set('uri', utmbUri);
    fetch(url, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => body && setCats(body.categories))
      .catch(() => {
        /* the section just stays hidden */
      });
    return () => controller.abort();
  }, [open, cats, utmbId, utmbUri, runner.name]);

  return (
    <div className="card">
      <button
        className="card-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Avatar src={photo} name={label} />
        <div className="who">
          <div className="name">{label}</div>
          {/* With a nickname on the card, the registered name is the only way
              to tell which runner it actually is. */}
          {runner.alias?.trim() && <div className="alias-of">{sourceName}</div>}
          <div className="meta">{meta || (loading ? 'Loading…' : '—')}</div>
        </div>
        <div className="badges">
          <Badge label="UTMB" value={utmb?.ip ?? null} kind="utmb" loading={loading && !utmb} />
          <Badge label="ITRA" value={itra?.pi ?? null} kind="itra" loading={loading && !itra} />
        </div>
      </button>

      {open && (
        <div className="detail">
          {cats && Object.keys(cats).length > 0 && (
            <div>
              <h3>UTMB by distance</h3>
              <div className="cats">
                {Object.entries(cats).map(([k, v]) => (
                  <span key={k} className="cat">
                    {k} <b>{v}</b>
                  </span>
                ))}
              </div>
            </div>
          )}

          {itra && itra.recentRaces.length > 0 && (
            <div>
              <h3>Recent races</h3>
              <ul className="races">
                {itra.recentRaces.slice(0, 3).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {(itraErr || utmbErr) && (
            <div>
              {utmbErr && <div className="err">UTMB: {utmbErr}</div>}
              {itraErr && <div className="err">ITRA: {itraErr}</div>}
              {/* One source failing is expected and survivable — say which half
                  is still real so a blocked ITRA doesn't read as a broken app. */}
              {utmbErr && !itraErr && itra && (
                <div className="stamp">The ITRA figure above is still live.</div>
              )}
              {itraErr && !utmbErr && utmb && (
                <div className="stamp">The UTMB figure above is still live.</div>
              )}
            </div>
          )}

          <div className="links">
            {utmb && (
              <a className="link-chip" href={utmb.profileUrl} target="_blank" rel="noreferrer">
                UTMB profile ↗
              </a>
            )}
            {itra && (
              <a className="link-chip" href={itra.profileUrl} target="_blank" rel="noreferrer">
                ITRA profile ↗
              </a>
            )}
          </div>

          {indexes && (
            <div className="stamp">Updated {ago(indexes.itra.fetchedAt)}</div>
          )}

          {onEdit && (
            <>
              <button className="text-btn wide" onClick={() => setEditing((v) => !v)}>
                {editing ? 'Done' : 'Edit nickname and links'}
              </button>
              {editing && (
                <RunnerEditor
                  runner={runner}
                  itra={itra}
                  utmb={utmb}
                  onEdit={onEdit}
                />
              )}
            </>
          )}

          {onRemove && (
            <button className="remove" onClick={onRemove}>
              Remove from list
            </button>
          )}
        </div>
      )}
    </div>
  );
}
