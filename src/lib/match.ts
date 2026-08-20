/**
 * Our own name matching, layered over the upstream search.
 *
 * UTMB matches *any* word in the query — "Kilian Jornet" reports 464 hits,
 * including "Killian CORNET" and "Kilian DUVERGER" — so ranking by index alone
 * buries a low-index runner under high-index strangers who happen to share one
 * name. Scoring here decides who actually matches what was typed.
 *
 * ITRA needs no help: it token-ANDs and is order-insensitive ("Kilian Jornet"
 * and "Jornet Kilian" both return exactly one runner).
 */

/** Higher is a better match. */
export const enum Tier {
  None = 0,
  /** Every typed word prefixes a distinct name token — "kil jor". */
  Prefix = 1,
  /** Every typed word is a whole name token — "Kilian Jornet" in "Kilian JORNET BURGADA". */
  AllWords = 2,
  /** Same tokens, any order — "Jornet Kilian". */
  Exact = 3,
}

/** Lowercase, strip accents, drop anything that isn't a letter or digit. */
export function normToken(token: string): string {
  return token
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Split a name into normalized tokens, discarding empties. */
export function tokenize(name: string): string[] {
  return name
    .split(/[\s\-_.]+/)
    .map(normToken)
    .filter(Boolean);
}

/**
 * UTMB stores alternate spellings in parentheses — "Óscar GARCIA JORNET (Oscar
 * GARCIA JORNET)" — usually because of an accent. Return the primary name and
 * any alternates so a variant spelling doesn't cost a match.
 */
export function nameVariants(name: string): string[] {
  const alternates = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim());
  const primary = name.replace(/\([^)]*\)/g, ' ').trim();
  return [primary, ...alternates].filter(Boolean);
}

/**
 * Greedily assign each query token to a distinct name token, so typing a word
 * twice cannot match the same token twice.
 *
 * `compare` decides what counts as a hit for one pair of tokens.
 */
function assignsAll(
  queryTokens: string[],
  nameTokens: string[],
  compare: (q: string, n: string) => boolean,
): boolean {
  const taken = new Set<number>();
  return queryTokens.every((q) => {
    const i = nameTokens.findIndex((n, idx) => !taken.has(idx) && compare(q, n));
    if (i === -1) return false;
    taken.add(i);
    return true;
  });
}

function tierFor(queryTokens: string[], name: string): Tier {
  const nameTokens = tokenize(name);
  if (queryTokens.length === 0 || nameTokens.length === 0) return Tier.None;

  if (
    queryTokens.length === nameTokens.length &&
    assignsAll(queryTokens, nameTokens, (q, n) => q === n)
  ) {
    return Tier.Exact;
  }
  if (assignsAll(queryTokens, nameTokens, (q, n) => q === n)) {
    return Tier.AllWords;
  }
  if (assignsAll(queryTokens, nameTokens, (q, n) => n.startsWith(q))) {
    return Tier.Prefix;
  }
  return Tier.None;
}

/** Best tier across the name's spellings. */
export function matchTier(query: string, name: string): Tier {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return Tier.None;

  let best = Tier.None;
  for (const variant of nameVariants(name)) {
    const tier = tierFor(queryTokens, variant);
    if (tier > best) best = tier;
    if (best === Tier.Exact) break;
  }
  return best;
}

/**
 * Whether a candidate should be promoted above the paged results.
 *
 * Only meaningful for a multi-word query. With a single word every upstream
 * result contains it, so tiers carry no signal — promoting on them would
 * re-sort the whole list and undo the append-only paging. A single word
 * therefore promotes only an outright exact match, which is rare.
 */
export function isStrongMatch(query: string, name: string): boolean {
  const tier = matchTier(query, name);
  return tokenize(query).length >= 2 ? tier >= Tier.Prefix : tier === Tier.Exact;
}
