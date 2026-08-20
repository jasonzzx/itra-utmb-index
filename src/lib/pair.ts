import { isStrongMatch, matchTier, normToken } from './match';
import type { ItraIndex, UtmbIndex } from './types';

/**
 * One person, as assembled from whichever sources found them.
 *
 * Search hits arrive from ITRA and UTMB independently and in different orders,
 * so the same runner can appear in both lists at different positions. Pairing
 * merges them into a single row.
 */
export interface Candidate {
  key: string;
  name: string;
  itra?: ItraIndex;
  utmb?: UtmbIndex;
  /**
   * Position this runner held in its source's own result list — the earlier of
   * the two when both found them.
   *
   * This is the base ordering, and it matters: both APIs rank by name
   * relevance, and UTMB in particular puts the runner you typed at position 0.
   * Sorting by index instead (as this used to) discards that and buries an
   * exact match under higher-indexed strangers who share a first name.
   */
  order: number;
  /** True when this runner matches what was actually typed. */
  strong: boolean;
  /** Match quality, used to order within the strong group. */
  tier: number;
}

/** Compare whole names ignoring case, punctuation, accents and spacing. */
export function norm(name: string): string {
  return normToken(name);
}

/**
 * Merge ITRA and UTMB results into one row per person.
 *
 * Ordering is `(strong desc, tier desc, order asc)`: runners matching the typed
 * name first, then everyone else in the order the sources returned them.
 *
 * The two lists are walked in lockstep, position by position, rather than one
 * source entirely then the other — draining ITRA first would give every ITRA
 * runner a better position than any UTMB-only runner regardless of relevance.
 *
 * Matching is by runner id first — UTMB reuses ITRA's ids in practice — and
 * falls back to a normalized name so pairing still works when they diverge.
 */
export function pairPages(
  itraResults: ItraIndex[],
  utmbResults: UtmbIndex[],
  query = '',
): Candidate[] {
  const byId = new Map<number, Candidate>();
  const byName = new Map<string, Candidate>();
  const out: Candidate[] = [];
  const depth = Math.max(itraResults.length, utmbResults.length);

  for (let i = 0; i < depth; i++) {
    const itra = itraResults[i];
    if (itra) {
      const existing = byId.get(itra.runnerId) ?? byName.get(norm(itra.name));
      if (existing) {
        // Already has ITRA data: the source repeated a row. Otherwise this is
        // the ITRA half of a runner UTMB listed first.
        if (!existing.itra) {
          existing.itra = itra;
          byId.set(itra.runnerId, existing);
        }
      } else {
        const c: Candidate = {
          key: `itra:${itra.runnerId}`,
          name: itra.name,
          itra,
          order: i,
          strong: false,
          tier: 0,
        };
        byId.set(itra.runnerId, c);
        byName.set(norm(itra.name), c);
        out.push(c);
      }
    }

    const utmb = utmbResults[i];
    if (utmb) {
      const existing = byId.get(utmb.id) ?? byName.get(norm(utmb.name));
      if (existing) {
        if (!existing.utmb) {
          existing.utmb = utmb;
          byId.set(utmb.id, existing);
        }
      } else {
        const c: Candidate = {
          key: `utmb:${utmb.id}`,
          name: utmb.name,
          utmb,
          order: i,
          strong: false,
          tier: 0,
        };
        byId.set(utmb.id, c);
        byName.set(norm(utmb.name), c);
        out.push(c);
      }
    }
  }

  // Score against every name the sources gave us, since one may hold the
  // spelling that matches — ITRA's "Kilian JORNET BURGADA" vs UTMB's alternate.
  for (const c of out) {
    const names = [c.name, c.itra?.name, c.utmb?.name].filter(Boolean) as string[];
    c.tier = Math.max(...names.map((n) => matchTier(query, n)));
    c.strong = names.some((n) => isStrongMatch(query, n));
  }

  return out.sort(
    (a, b) =>
      Number(b.strong) - Number(a.strong) ||
      b.tier - a.tier ||
      a.order - b.order,
  );
}
