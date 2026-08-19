/**
 * ITRA returns names as "Kilian JORNET BURGADA" — first name in title case,
 * surname shouted. Softening the surname keeps cards readable and stops long
 * names from being truncated as aggressively.
 */
export function prettyName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((word) =>
      // Only touch words that are entirely uppercase; leave "McDonald" and
      // already-cased names alone.
      word.length > 1 && word === word.toUpperCase() && /[A-ZÀ-Þ]/.test(word)
        ? word.charAt(0) + word.slice(1).toLowerCase()
        : word,
    )
    .join(' ');
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function ago(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 90) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
