import { describe, expect, it } from 'vitest';
import { parseItraUrl, parseUtmbUrl } from '../src/lib/urls';

describe('parseItraUrl', () => {
  it('reads the canonical surname.firstname.id slug', () => {
    expect(parseItraUrl('https://itra.run/RunnerSpace/jornetburgada.kilian.2704')).toEqual({
      id: 2704,
      nameHint: 'Kilian Jornetburgada',
    });
  });

  it('reads the older form, whose hint keeps the spaces in a surname', () => {
    expect(
      parseItraUrl('https://itra.run/RunnerSpace/JORNET%20BURGADA.Kilian/2704'),
    ).toEqual({ id: 2704, nameHint: 'Kilian JORNET BURGADA' });
  });

  it('accepts a URL with no scheme, a www host, a query and a trailing slash', () => {
    expect(parseItraUrl('  www.itra.run/RunnerSpace/dauwalter.courtney.30959/?lang=en  ')).toEqual({
      id: 30959,
      nameHint: 'Courtney Dauwalter',
    });
  });

  it('accepts a bare id, which carries no name', () => {
    expect(parseItraUrl('2704')).toEqual({ id: 2704, nameHint: null });
  });

  it('rejects another site, so a UTMB link pasted in the wrong box is caught', () => {
    expect(parseItraUrl('https://utmb.world/runner/2704.kilian.jornetburgada')).toBeNull();
    expect(parseItraUrl('not a url')).toBeNull();
    expect(parseItraUrl('')).toBeNull();
  });
});

describe('parseUtmbUrl', () => {
  it('reads the id.first.last slug', () => {
    expect(parseUtmbUrl('https://utmb.world/runner/2704.kilian.jornetburgada')).toEqual({
      id: 2704,
      nameHint: 'Kilian Jornetburgada',
    });
  });

  it('finds the slug behind a locale prefix', () => {
    expect(parseUtmbUrl('https://utmb.world/en/runner/30959.courtney.dauwalter')).toEqual({
      id: 30959,
      nameHint: 'Courtney Dauwalter',
    });
  });

  it('accepts a bare id', () => {
    expect(parseUtmbUrl('30959')).toEqual({ id: 30959, nameHint: null });
  });

  it('rejects an ITRA link and anything unparseable', () => {
    expect(parseUtmbUrl('https://itra.run/RunnerSpace/jornetburgada.kilian.2704')).toBeNull();
    expect(parseUtmbUrl('https://utmb.world/utmb-index/runner-search')).toBeNull();
  });
});
