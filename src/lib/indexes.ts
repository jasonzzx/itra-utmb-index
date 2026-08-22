import { revalidateTag } from 'next/cache';
import {
  cachedItraIndex,
  cachedUtmbIndex,
  itraTag,
  utmbTag,
  type Stamped,
} from './cache';
import { fetchItraIndex, itraAccessNotice } from './itra';
import { fetchUtmbIndex } from './utmb';
import type { RunnerIndexes, RunnerRef, SourceResult } from './types';

/** Cap on simultaneous upstream requests so a big list stays polite. */
const CONCURRENCY = 8;

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i]);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

/**
 * Wrap a lookup so one source failing never blanks the other. `fetchedAt`
 * comes from the cached payload on a hit, so it reflects when the data was
 * actually retrieved rather than when this request ran.
 */
async function settle<T>(
  fn: () => Promise<Stamped<T>>,
  /**
   * Recovers the real reason when one is available.
   *
   * React replaces any error thrown inside a `'use cache'` function with "the
   * specific message is omitted in production builds", so the message a caller
   * catches from a cached lookup is a placeholder. The source module records
   * why it refused, and that is what the user should read.
   */
  notice?: () => string | null,
): Promise<SourceResult<T>> {
  try {
    const { data, fetchedAt } = await fn();
    return { ok: true, data, fetchedAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: notice?.() ?? message,
      fetchedAt: new Date().toISOString(),
    };
  }
}

/** Bypass path: fetch live and stamp now. */
async function stampNow<T>(value: Promise<T>): Promise<Stamped<T>> {
  return { data: await value, fetchedAt: new Date().toISOString() };
}

/**
 * Look up both indexes for one runner.
 *
 * When `force` is set we call the *uncached* functions directly and separately
 * invalidate the tags. Reading back through the cache in the same request
 * after revalidateTag is not reliable, so the direct call is what guarantees
 * the refresh button actually refreshes.
 */
export async function getRunnerIndexes(
  runner: RunnerRef,
  force = false,
): Promise<RunnerIndexes> {
  if (force) {
    // `{ expire: 0 }` drops the entry immediately so the next ordinary read
    // re-fetches rather than serving what we just bypassed.
    revalidateTag(itraTag(runner.itraRunnerId ?? runner.name), { expire: 0 });
    revalidateTag(utmbTag(runner.utmbId ?? runner.name, 'general'), {
      expire: 0,
    });
  }

  const [itra, utmb] = await Promise.all([
    settle(
      () =>
        force
          ? stampNow(
              fetchItraIndex(runner.name, runner.itraRunnerId, runner.itraUri),
            )
          : cachedItraIndex(runner.name, runner.itraRunnerId, runner.itraUri),
      itraAccessNotice,
    ),
    settle(() =>
      force
        ? stampNow(
            fetchUtmbIndex(runner.name, runner.utmbId, 'general', runner.utmbUri),
          )
        : cachedUtmbIndex(runner.name, runner.utmbId, 'general', runner.utmbUri),
    ),
  ]);

  return { id: runner.id, name: runner.name, itra, utmb };
}

export async function getManyRunnerIndexes(
  runners: RunnerRef[],
  force = false,
): Promise<RunnerIndexes[]> {
  return mapLimit(runners, CONCURRENCY, (r) => getRunnerIndexes(r, force));
}
