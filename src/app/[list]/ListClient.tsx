'use client';

import { useEffect, useState } from 'react';
import { RunnerListView } from '@/components/RunnerListView';
import { resetFork, resolveList, writeFork } from '@/lib/storage';
import type { RunnerList, RunnerRef } from '@/lib/types';

export function ListClient({ slug, seed }: { slug: string; seed: RunnerList }) {
  const [runners, setRunners] = useState<RunnerRef[]>([]);
  const [forked, setForked] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const resolved = resolveList(slug, seed);
    setRunners(resolved.runners);
    setForked(resolved.forked);
    setReady(true);
  }, [slug, seed]);

  // The first edit forks the committed roster into local storage; the file in
  // the repo is never touched, so the owner's shared list stays as published.
  function fork(next: RunnerRef[]) {
    setRunners(next);
    writeFork(slug, next);
    setForked(true);
  }

  function remove(id: string) {
    fork(runners.filter((r) => r.id !== id));
  }

  function edit(id: string, patch: Partial<RunnerRef>) {
    fork(runners.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function reset() {
    resetFork(slug);
    const resolved = resolveList(slug, seed);
    setRunners(resolved.runners);
    setForked(false);
  }

  return (
    <>
      <header className="topbar">
        <h1>{seed.name}</h1>
      </header>
      {seed.description && <p className="subtitle">{seed.description}</p>}

      {forked && (
        <div className="banner">
          {/* Say what the published list holds, so a copy that has drifted
              from it — or been emptied — is visible rather than puzzling. */}
          <span>
            Your own copy of this list. The published one has{' '}
            {seed.runners.length}.
          </span>
          <button onClick={reset}>Reset to original</button>
        </div>
      )}

      {ready && (
        <RunnerListView
          runners={runners}
          onRemove={remove}
          onEdit={edit}
          /**
           * An emptied copy is the one empty list that isn't what it looks
           * like: the published roster is still there, and "no runners" with
           * a "find a runner" button gives no hint of that.
           */
          emptyMessage={
            forked && seed.runners.length > 0
              ? `Your copy of this list is empty. The published list has ${seed.runners.length} runners.`
              : 'This list is empty.'
          }
          emptyAction={
            forked && seed.runners.length > 0
              ? { label: 'Show the published list', onClick: reset }
              : undefined
          }
          exportMeta={{
            defaultName: seed.name,
            defaultDescription: seed.description,
            defaultSlug: slug,
          }}
        />
      )}
    </>
  );
}
