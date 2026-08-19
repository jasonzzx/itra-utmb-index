/**
 * Live smoke tests against the real ITRA and UTMB APIs.
 * Opt-in: these hit the network, so they only run with LIVE=1.
 */
import { describe, it, expect } from 'vitest';
import { searchItra, fetchItraIndex } from '@/lib/itra';
import { searchUtmb, fetchUtmbIndex, fetchUtmbAllCategories } from '@/lib/utmb';

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

  it('returns null for a pinned id that does not match', async () => {
    expect(await fetchUtmbIndex('jornet', 999999999)).toBeNull();
  }, 30_000);
});
