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

  function rename(id: string, alias: string) {
    // An emptied box means "no nickname", not a nickname of "".
    fork(
      runners.map((r) =>
        r.id === id ? { ...r, alias: alias.trim() ? alias : undefined } : r,
      ),
    );
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
          <span>Your own copy of this list.</span>
          <button onClick={reset}>Reset to original</button>
        </div>
      )}

      {ready && (
        <RunnerListView
          runners={runners}
          onRemove={remove}
          onRename={rename}
          emptyMessage="This list is empty."
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
