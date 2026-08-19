'use client';

import { useMemo, useState } from 'react';
import { buildExport } from '@/lib/export';
import type { RunnerRef } from '@/lib/types';

export interface ExportMetaDefaults {
  defaultName: string;
  defaultDescription?: string;
  defaultSlug?: string;
}

/**
 * `navigator.clipboard` only exists in a secure context (HTTPS or localhost),
 * so fall back to the old selection-based copy for plain-HTTP testing.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function ExportSheet({
  runners,
  defaults,
  onClose,
}: {
  runners: RunnerRef[];
  defaults: ExportMetaDefaults;
  onClose: () => void;
}) {
  const [name, setName] = useState(defaults.defaultName);
  const [description, setDescription] = useState(defaults.defaultDescription ?? '');
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');

  const { json, slug, unpinned } = useMemo(
    () => buildExport(runners, { name: name || defaults.defaultName, description }),
    [runners, name, description, defaults.defaultName],
  );

  // Keep the committed filename stable when exporting an unrenamed list.
  const filename = name.trim() === defaults.defaultName.trim() && defaults.defaultSlug
    ? defaults.defaultSlug
    : slug;

  async function handleCopy() {
    const ok = await copyText(json);
    setCopied(ok ? 'ok' : 'fail');
    setTimeout(() => setCopied('idle'), 2000);
  }

  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>Export list</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close export">
          ✕
        </button>
      </div>

      <p className="sheet-hint">
        Copy this, then commit it to your repo as <code>lists/{filename}.json</code> —
        it will be served at <code>/{filename}</code>.
      </p>

      <label className="field">
        <span>List name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="CRIT" />
      </label>

      <label className="field">
        <span>Description (optional)</span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Runners the CRIT crew follows"
        />
      </label>

      {unpinned.length > 0 && (
        <div className="warn">
          <strong>
            {unpinned.length} runner{unpinned.length > 1 ? 's have' : ' has'} no ITRA or UTMB
            id:
          </strong>{' '}
          {unpinned.map((r) => r.name).join(', ')}. Committing this will fail the
          repo&apos;s list test, and a refresh could match the wrong person. Remove
          {unpinned.length > 1 ? ' them' : ' it'} or re-add via search so the ids resolve.
        </div>
      )}

      <pre className="json-preview">{json}</pre>

      <button className="cta copy-btn" onClick={handleCopy}>
        {copied === 'ok' ? 'Copied ✓' : copied === 'fail' ? 'Copy failed — select above' : 'Copy JSON'}
      </button>
    </div>
  );
}
