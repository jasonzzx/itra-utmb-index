/**
 * Live smoke tests against the real ITRA and UTMB APIs.
 * Opt-in: these hit the network, so they only run with LIVE=1.
 */
import { describe, it, expect } from 'vitest';
import { searchItra, fetchItraIndex, fetchItraProfile } from '@/lib/itra';
import {
  searchUtmb,
  fetchUtmbIndex,
  fetchUtmbAllCategories,
  fetchUtmbProfile,
} from '@/lib/utmb';

const live = process.env.LIVE === '1' ? describe : describe.skip;

live('live upstream', () => {
  it('searches ITRA and decrypts the payload', async () => {
    const results = await searchItra('jornet', 10);
    expect(results.length).toBeGreaterThan(0);
    const kilian = results.find((r) => r.runnerId === 2704);
    expect(kilian).toBeDefined();
    expect(kilian!.pi).toBeGreaterThan(800);
    expect(kilian!.piIndex).toMatch(/Elite|Expert/);
    console.log('ITRA:', kilian!.name, kilian!.pi, kilian!.piIndex, kilian!.profileUrl);
  }, 30_000);

  it('pins an ITRA runner by id', async () => {
    const r = await fetchItraIndex('Kilian Jornet', 2704);
    expect(r?.runnerId).toBe(2704);
  }, 30_000);

  it('reads an ITRA index straight off the runner page, by id alone', async () => {
    const r = await fetchItraProfile(2704);
    expect(r?.runnerId).toBe(2704);
    expect(r?.name).toMatch(/JORNET/i);
    expect(r!.pi).toBeGreaterThan(800);
    // Search spells the band "Elite 1"; the page hyphenates it, and the two
    // have to agree because a card may be painted from either.
    expect(r!.piIndex).toMatch(/^(Elite|Expert) \d$/);
    console.log('ITRA by id:', r!.name, r!.pi, r!.piIndex, r!.ageGroup);
  }, 30_000);

  it('resolves a pinned runner whose name ITRA search cannot reach', async () => {
    // The canonical profile slug, "jornetburgada", finds nobody in ITRA's own
    // search — the id is the only way through.
    const r = await fetchItraIndex('jornetburgada', 2704);
    expect(r?.runnerId).toBe(2704);
  }, 30_000);

  it('searches UTMB', async () => {
    const results = await searchUtmb('jornet', 'general', 10);
    expect(results.length).toBeGreaterThan(0);
    const kilian = results.find((r) => r.id === 2704);
    expect(kilian!.ip).toBeGreaterThan(800);
    console.log('UTMB:', kilian!.name, kilian!.ip, kilian!.profileUrl);
  }, 30_000);

  it('fetches all UTMB categories', async () => {
    const cats = await fetchUtmbAllCategories('Kilian Jornet', 2704);
    console.log('UTMB categories:', cats);
    expect(Object.keys(cats).length).toBeGreaterThan(2);
  }, 45_000);

  it('reaches a runner UTMB search ranks out of sight', async () => {
    // "Yu Chen" returns hundreds of people ranked by index, and this one sits
    // at 382 — far past any window worth fetching. Only the slug finds him.
    const searched = await searchUtmb('Yu Chen', 'general', 25);
    expect(searched.some((r) => r.id === 7388490)).toBe(false);

    const r = await fetchUtmbIndex('Yu Chen', 7388490, 'general', '7388490.yu.chen');
    expect(r?.id).toBe(7388490);
    expect(r!.ip).toBeGreaterThan(0);
    console.log('UTMB by slug:', r!.name, r!.ip, r!.nationality, r!.ageGroup);
  }, 30_000);

  it('takes every UTMB category from one page load', async () => {
    const cats = await fetchUtmbAllCategories('Yu Chen', 7388490, '7388490.yu.chen');
    expect(Object.keys(cats).length).toBeGreaterThan(0);
    console.log('UTMB categories by slug:', cats);
  }, 30_000);

  it('treats an unknown UTMB slug as an answer', async () => {
    expect(await fetchUtmbProfile('999999999.no.body')).toBeNull();
  }, 30_000);

  it('returns null for a pinned id that does not match', async () => {
    expect(await fetchUtmbIndex('jornet', 999999999)).toBeNull();
  }, 30_000);
});
