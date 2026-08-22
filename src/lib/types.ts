/** A runner as stored in a list (local storage or a committed lists/*.json). */
export interface RunnerRef {
  /** Stable local identifier, generated when the runner is added. */
  id: string;
  /** The name the sources know them by, also used as the search term. */
  name: string;
  /**
   * What to call them on screen, when their registered name isn't it.
   *
   * Display only — a nickname would find nobody upstream, so lookups keep
   * using `name`.
   */
  alias?: string;
  /** ITRA's RunnerId. Pins the runner so refreshes can't match the wrong person. */
  itraRunnerId?: number;
  /** UTMB's numeric id. */
  utmbId?: number;
  /**
   * UTMB's profile slug, `7388490.yu.chen`.
   *
   * The id alone can only be matched inside search results, so a runner search
   * ranks out of reach stays unresolvable however well pinned. Their page has
   * no such ceiling, and this is what addresses it.
   */
  utmbUri?: string;
}

export interface ItraIndex {
  runnerId: number;
  name: string;
  /** ITRA Performance Index. */
  pi: number;
  /** Band label, e.g. "Elite 1". */
  piIndex: string;
  /** Hex colour ITRA associates with the band. */
  colorCode: string;
  nationality: string;
  gender: string;
  ageGroup: string;
  recentRaces: string[];
  profileUrl: string;
  photoUrl: string | null;
}

export type UtmbCategory = 'general' | '20k' | '50k' | '100k' | '100m';

export const UTMB_CATEGORIES: UtmbCategory[] = ['general', '20k', '50k', '100k', '100m'];

export interface UtmbIndex {
  id: number;
  uri: string;
  name: string;
  /** UTMB Index for the requested category. */
  ip: number;
  category: UtmbCategory;
  nationality: string;
  sex: string;
  ageGroup: string;
  profileUrl: string;
  photoUrl: string | null;
}

/** One source's outcome. Sources fail independently so one outage can't blank a card. */
export type SourceResult<T> =
  | { ok: true; data: T; fetchedAt: string }
  | { ok: false; error: string; fetchedAt: string };

export interface RunnerIndexes {
  id: string;
  name: string;
  itra: SourceResult<ItraIndex | null>;
  utmb: SourceResult<UtmbIndex | null>;
}

/** Shape of a committed lists/<slug>.json file. */
export interface RunnerList {
  name: string;
  description?: string;
  runners: Array<{
    name: string;
    alias?: string;
    itraRunnerId?: number;
    utmbId?: number;
    utmbUri?: string;
  }>;
}
