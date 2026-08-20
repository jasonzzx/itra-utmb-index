import type { ItraIndex, UtmbIndex } from './types';

/**
 * One person, as assembled from whichever sources found them.
 *
 * Search hits arrive from ITRA and UTMB independently and in different orders,
 * so the same runner can turn up on ITRA page 1 and UTMB page 3. Pairing runs
 * over every page fetched so far, which is what keeps them as a single row.
 */
export interface Candidate {
  key: string;
  name: string;
  itra?: ItraIndex;
  utmb?: UtmbIndex;
  /** Page this runner first appeared on, from either source. */
  page: number;
  /**
   * Ranking score, frozen once the page it appeared on is fully merged.
   *
   * It has to be frozen: if it were recomputed live, pairing in a UTMB result
   * from a later page would change a row's score and re-sort it within its own
   * page — moving a row the reader is already looking at.
   */
  rank: number;
}

/** Compare names ignoring case, punctuation, accents and spacing. */
export function norm(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/**
 * Merge accumulated pages of ITRA and UTMB results into one row per person.
 *
 * Ordering is `(page asc, rank desc)`: strongest first *within* a page, pages in
 * the order they were loaded, so tapping "Load more" only ever appends.
 *
 * Both sources are walked page by page in lockstep rather than one source
 * entirely then the other. Draining ITRA first would let a runner who is on
 * ITRA page 1 but UTMB page 0 be attributed to the wrong page, and they would
 * visibly jump once the second page loaded.
 *
 * Matching is by runner id first — UTMB reuses ITRA's ids in practice — and
 * falls back to a normalized name so pairing still works when they diverge.
 */
export function pairPages(
  itraPages: ItraIndex[][],
  utmbPages: UtmbIndex[][],
): Candidate[] {
  const byId = new Map<number, Candidate>();
  const byName = new Map<string, Candidate>();
  const out: Candidate[] = [];
  const pageCount = Math.max(itraPages.length, utmbPages.length);

  for (let page = 0; page < pageCount; page++) {
    const createdHere: Candidate[] = [];

    for (const r of itraPages[page] ?? []) {
      const existing = byId.get(r.runnerId) ?? byName.get(norm(r.name));
      if (existing) {
        // Already has ITRA data: the source repeated a row across pages.
        // Otherwise this is the ITRA half of a runner UTMB found first.
        if (!existing.itra) {
          existing.itra = r;
          byId.set(r.runnerId, existing);
        }
        continue;
      }
      const c: Candidate = {
        key: `itra:${r.runnerId}`,
        name: r.name,
        itra: r,
        page,
        rank: 0,
      };
      byId.set(r.runnerId, c);
      byName.set(norm(r.name), c);
      out.push(c);
      createdHere.push(c);
    }

    for (const r of utmbPages[page] ?? []) {
      const match = byId.get(r.id) ?? byName.get(norm(r.name));
      if (match) {
        if (!match.utmb) {
          match.utmb = r;
          byId.set(r.id, match);
        }
        continue;
      }
      const c: Candidate = {
        key: `utmb:${r.id}`,
        name: r.name,
        utmb: r,
        page,
        rank: 0,
      };
      byId.set(r.id, c);
      byName.set(norm(r.name), c);
      out.push(c);
      createdHere.push(c);
    }

    // Freeze ranking now that this page is fully merged from both sources.
    for (const c of createdHere) {
      c.rank = Math.max(c.itra?.pi ?? 0, c.utmb?.ip ?? 0);
    }
  }

  return out.sort((a, b) => a.page - b.page || b.rank - a.rank);
}
