'use client';

import { useEffect, useState } from 'react';
import { ago, initials, prettyName } from '@/lib/format';
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
}: {
  runner: RunnerRef;
  indexes?: RunnerIndexes;
  loading: boolean;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);

  const itra = indexes?.itra.ok ? indexes.itra.data : null;
  const utmb = indexes?.utmb.ok ? indexes.utmb.data : null;
  const itraErr = indexes && !indexes.itra.ok ? indexes.itra.error : null;
  const utmbErr = indexes && !indexes.utmb.ok ? indexes.utmb.error : null;

  const photo = itra?.photoUrl ?? utmb?.photoUrl ?? null;
  const meta = [
    itra?.nationality || utmb?.nationality,
    itra?.ageGroup || utmb?.ageGroup,
    itra?.piIndex,
  ]
    .filter(Boolean)
    .join(' · ');

  // Five upstream calls, so only fetched once the card is actually expanded.
  const utmbId = utmb?.id ?? runner.utmbId;
  const [cats, setCats] = useState<Partial<Record<UtmbCategory, number>> | null>(
    null,
  );

  useEffect(() => {
    if (!open || cats || !utmbId) return;
    const controller = new AbortController();
    fetch(
      `/api/categories?name=${encodeURIComponent(runner.name)}&id=${utmbId}`,
      { signal: controller.signal },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => body && setCats(body.categories))
      .catch(() => {
        /* the section just stays hidden */
      });
    return () => controller.abort();
  }, [open, cats, utmbId, runner.name]);

  return (
    <div className="card">
      <button
        className="card-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Avatar src={photo} name={runner.name} />
        <div className="who">
          <div className="name">
            {prettyName(itra?.name ?? utmb?.name ?? runner.name)}
          </div>
          <div className="meta">{meta || (loading ? 'Loading…' : '—')}</div>
        </div>
        <div className="badges">
          <Badge label="ITRA" value={itra?.pi ?? null} kind="itra" loading={loading && !itra} />
          <Badge label="UTMB" value={utmb?.ip ?? null} kind="utmb" loading={loading && !utmb} />
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
              {itraErr && <div className="err">ITRA: {itraErr}</div>}
              {utmbErr && <div className="err">UTMB: {utmbErr}</div>}
            </div>
          )}

          <div className="links">
            {itra && (
              <a className="link-chip" href={itra.profileUrl} target="_blank" rel="noreferrer">
                ITRA profile ↗
              </a>
            )}
            {utmb && (
              <a className="link-chip" href={utmb.profileUrl} target="_blank" rel="noreferrer">
                UTMB profile ↗
              </a>
            )}
          </div>

          {indexes && (
            <div className="stamp">Updated {ago(indexes.itra.fetchedAt)}</div>
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
