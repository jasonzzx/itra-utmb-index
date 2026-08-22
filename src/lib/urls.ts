/**
 * Turning a pasted profile URL into the ids the app pins runners by.
 *
 * Searching by name is lossy — ITRA buries a common name past any window we
 * are willing to fetch, and its bot protection can take the search away
 * entirely. A profile URL carries the runner's id, which identifies exactly
 * one person, so pasting one is the precise way to add somebody.
 */

export interface ParsedProfileUrl {
  id: number;
  /**
   * A readable name recovered from the URL, when it has one.
   *
   * Only a hint: profile slugs strip the spaces out of a surname, so ITRA's
   * "jornetburgada.kilian.2704" cannot be turned back into a name its own
   * search would find. It is a label to show until the source answers with
   * the canonical name, not something to search on.
   */
  nameHint: string | null;
}

const ITRA_ORIGIN = 'https://itra.run';
const ITRA_HOST = /(^|\.)itra\.run$/;
const UTMB_HOST = /(^|\.)utmb\.world$/;

/**
 * A runner's ITRA page addressed by id alone.
 *
 * ITRA redirects `/RunnerSpace/<anything>/<id>` to that runner's canonical
 * URL, so the slug carries no weight and we don't have to know their name.
 */
export function itraProfileUrl(runnerId: number): string {
  return `${ITRA_ORIGIN}/RunnerSpace/-/${runnerId}`;
}

/** Slug words are lowercase; a card reading "Kilian Jornetburgada" beats "kilian jornetburgada". */
function titleCase(words: string[]): string | null {
  const name = words
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => (w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ')
    .trim();
  return name || null;
}

/**
 * Parse loosely: people paste with or without a scheme, with tracking query
 * strings, and sometimes just the id off the end of the URL.
 */
function toUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

function segments(url: URL): string[] {
  return url.pathname
    .split('/')
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .filter(Boolean);
}

function bareId(input: string): number | null {
  const trimmed = input.trim();
  return /^\d{1,12}$/.test(trimmed) ? Number(trimmed) : null;
}

/**
 * ITRA runner URLs come in two shapes and both are in circulation:
 *
 *   https://itra.run/RunnerSpace/jornetburgada.kilian.2704   (canonical)
 *   https://itra.run/RunnerSpace/JORNET%20BURGADA.Kilian/2704 (older, redirects)
 *
 * Both put the surname first. The older form keeps the spaces, so its hint is
 * the name ITRA search actually knows; the canonical one does not.
 */
export function parseItraUrl(input: string): ParsedProfileUrl | null {
  const id = bareId(input);
  if (id !== null) return { id, nameHint: null };

  const url = toUrl(input);
  if (!url || !ITRA_HOST.test(url.hostname)) return null;

  const parts = segments(url);
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1];

  // Older form: the id is its own segment, preceded by "Surname.Firstname".
  const tail = bareId(last);
  if (tail !== null) {
    const before = parts[parts.length - 2] ?? '';
    const named = before.includes('.') ? before.split('.') : [];
    return {
      id: tail,
      nameHint: named.length >= 2 ? titleCase([...named.slice(1), named[0]]) : null,
    };
  }

  // Canonical form: surname.firstname.id in a single segment.
  const dotted = last.split('.');
  const trailing = bareId(dotted[dotted.length - 1] ?? '');
  if (trailing === null || dotted.length < 2) return null;
  const rest = dotted.slice(0, -1);
  return {
    id: trailing,
    nameHint: rest.length >= 2 ? titleCase([...rest.slice(1), rest[0]]) : titleCase(rest),
  };
}

/**
 * UTMB runner URLs embed the id and the name in one slug:
 *
 *   https://utmb.world/runner/2704.kilian.jornetburgada
 *
 * Unlike ITRA there is no per-runner API, so the hint matters: UTMB's search
 * does find "kilian jornetburgada", which is how a pinned runner is refreshed.
 */
export function parseUtmbUrl(input: string): ParsedProfileUrl | null {
  const id = bareId(input);
  if (id !== null) return { id, nameHint: null };

  const url = toUrl(input);
  if (!url || !UTMB_HOST.test(url.hostname)) return null;

  // Scan every segment rather than assuming a position — utmb.world prefixes
  // some routes with a locale.
  for (const part of segments(url)) {
    const dotted = part.split('.');
    const leading = bareId(dotted[0] ?? '');
    if (leading !== null && dotted.length >= 2) {
      return { id: leading, nameHint: titleCase(dotted.slice(1)) };
    }
  }
  return null;
}

/** A parse attempt, with the message to show when there is text but no link. */
export interface ParseAttempt {
  value: ParsedProfileUrl | null;
  error: string | null;
}

function attempt(
  input: string,
  reader: (s: string) => ParsedProfileUrl | null,
  /** Named with its article, so the message reads "an ITRA runner link". */
  label: string,
): ParseAttempt {
  if (!input.trim()) return { value: null, error: null };
  const value = reader(input);
  return {
    value,
    error: value ? null : `That doesn't look like ${label} runner link.`,
  };
}

export const readItraUrl = (input: string): ParseAttempt =>
  attempt(input, parseItraUrl, 'an ITRA');

export const readUtmbUrl = (input: string): ParseAttempt =>
  attempt(input, parseUtmbUrl, 'a UTMB');
