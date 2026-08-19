import type { RunnerList, RunnerRef } from './types';

/**
 * Turning a local list into a committable `lists/<slug>.json`.
 *
 * The output has to satisfy `parseList` in ./lists.ts *and* the assertions in
 * test/lists.test.ts, since the whole point is producing a file that can be
 * committed without breaking the build.
 */

export interface ExportMeta {
  name: string;
  description?: string;
}

/**
 * Strip the local-only `id` and drop absent optional fields entirely.
 *
 * Omission matters: `parseList` rejects an `itraRunnerId` that isn't a number,
 * so serializing an absent id as `null` would produce a file the app then
 * refuses to load.
 */
export function toRunnerList(
  runners: RunnerRef[],
  meta: ExportMeta,
): RunnerList {
  return {
    name: meta.name.trim(),
    ...(meta.description?.trim() ? { description: meta.description.trim() } : {}),
    runners: runners.map((r) => ({
      name: r.name.trim(),
      ...(r.itraRunnerId != null ? { itraRunnerId: r.itraRunnerId } : {}),
      ...(r.utmbId != null ? { utmbId: r.utmbId } : {}),
    })),
  };
}

/** Two-space indent and a trailing newline, matching the committed lists. */
export function formatList(list: RunnerList): string {
  return `${JSON.stringify(list, null, 2)}\n`;
}

/**
 * Derive a filename that satisfies the repo's `^[a-z0-9][a-z0-9-]*$` rule —
 * it is both the file name and the URL segment.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // A name of only punctuation or non-Latin script can leave nothing behind.
  return slug || 'my-list';
}

/**
 * Runners pinned to neither source. `test/lists.test.ts` fails on these,
 * because without an ID a refresh can match a different runner of the same
 * name — so they're worth flagging before the file is committed.
 */
export function unpinnedRunners(runners: RunnerRef[]): RunnerRef[] {
  return runners.filter((r) => r.itraRunnerId == null && r.utmbId == null);
}

/** Everything the export UI needs, derived in one place. */
export function buildExport(runners: RunnerRef[], meta: ExportMeta) {
  const list = toRunnerList(runners, meta);
  return {
    list,
    json: formatList(list),
    slug: slugify(meta.name),
    unpinned: unpinnedRunners(runners),
  };
}
