'use client';

import type { RunnerIndexes, RunnerList, RunnerRef } from './types';

const VERSION = 1;
const PERSONAL_KEY = 'runners:my';
const listKey = (slug: string) => `runners:list:${slug}`;
const SNAPSHOT_KEY = 'runners:snapshot';

interface Envelope {
  v: number;
  runners: RunnerRef[];
}

function read(key: string): RunnerRef[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Envelope;
    if (parsed?.v !== VERSION || !Array.isArray(parsed.runners)) return null;
    return parsed.runners;
  } catch {
    return null;
  }
}

function write(key: string, runners: RunnerRef[]): void {
  if (typeof window === 'undefined') return;
  const envelope: Envelope = { v: VERSION, runners };
  window.localStorage.setItem(key, JSON.stringify(envelope));
}

export function newRunnerId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `r_${Date.now()}_${Math.random()}`;
}

/* ---------------------------------------------------------------- personal */

export function readPersonal(): RunnerRef[] {
  return read(PERSONAL_KEY) ?? [];
}

export function writePersonal(runners: RunnerRef[]): void {
  write(PERSONAL_KEY, runners);
}

/* ------------------------------------------------------------------- forks */

/** A committed list is a read-only seed until the visitor edits it. */
export function isForked(slug: string): boolean {
  return read(listKey(slug)) !== null;
}

/**
 * Resolve what a list route should render: the visitor's fork if they have
 * one, otherwise the committed roster.
 */
export function resolveList(slug: string, seed: RunnerList): {
  runners: RunnerRef[];
  forked: boolean;
} {
  const fork = read(listKey(slug));
  if (fork) return { runners: fork, forked: true };
  return { runners: seedToRefs(seed), forked: false };
}

/** Committed entries have no local id, so mint stable ones from the content. */
export function seedToRefs(seed: RunnerList): RunnerRef[] {
  return seed.runners.map((r, i) => ({
    id: `seed_${r.itraRunnerId ?? r.utmbId ?? i}`,
    name: r.name,
    alias: r.alias,
    itraRunnerId: r.itraRunnerId,
    itraUri: r.itraUri,
    utmbId: r.utmbId,
    utmbUri: r.utmbUri,
  }));
}

export function writeFork(slug: string, runners: RunnerRef[]): void {
  write(listKey(slug), runners);
}

/** Discard the local copy so the committed roster shows again. */
export function resetFork(slug: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(listKey(slug));
}

/* --------------------------------------------------------------- snapshots */

/**
 * Last-known index values, so a list paints instantly on open instead of
 * showing empty cards while the network settles.
 */
export function readSnapshot(): Record<string, RunnerIndexes> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as Record<string, RunnerIndexes>) : {};
  } catch {
    return {};
  }
}

export function mergeSnapshot(results: RunnerIndexes[]): void {
  if (typeof window === 'undefined') return;
  const current = readSnapshot();
  for (const r of results) {
    // Only overwrite with a success, so a transient outage can't wipe a good
    // value the user was already looking at.
    const prev = current[r.id];
    current[r.id] = {
      ...r,
      itra: r.itra.ok ? r.itra : (prev?.itra ?? r.itra),
      utmb: r.utmb.ok ? r.utmb : (prev?.utmb ?? r.utmb),
    };
  }
  window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(current));
}
