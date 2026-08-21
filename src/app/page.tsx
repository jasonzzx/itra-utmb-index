'use client';

import { useEffect, useState } from 'react';
import { RunnerListView } from '@/components/RunnerListView';
import { readPersonal, writePersonal } from '@/lib/storage';
import type { RunnerRef } from '@/lib/types';

export default function MyRunnersPage() {
  const [runners, setRunners] = useState<RunnerRef[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setRunners(readPersonal());
    setReady(true);
  }, []);

  function remove(id: string) {
    save(runners.filter((r) => r.id !== id));
  }

  function rename(id: string, alias: string) {
    // An emptied box means "no nickname", not a nickname of "".
    save(
      runners.map((r) =>
        r.id === id ? { ...r, alias: alias.trim() ? alias : undefined } : r,
      ),
    );
  }

  function save(next: RunnerRef[]) {
    setRunners(next);
    writePersonal(next);
  }

  return (
    <>
      <header className="topbar">
        <h1>My Runners</h1>
      </header>
      {ready && (
        <RunnerListView
          runners={runners}
          onRemove={remove}
          onRename={rename}
          emptyMessage="You're not following anyone yet."
          exportMeta={{ defaultName: 'My Runners', defaultSlug: 'my-runners' }}
        />
      )}
    </>
  );
}
