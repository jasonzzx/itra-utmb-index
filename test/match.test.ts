import { describe, it, expect } from 'vitest';
import { isStrongMatch, matchTier, nameVariants, tokenize, Tier } from '@/lib/match';

describe('tokenize', () => {
  it('splits, lowercases and strips accents', () => {
    expect(tokenize('Óscar GARCÍA JORNET')).toEqual(['oscar', 'garcia', 'jornet']);
  });

  it('treats hyphens and dots as separators', () => {
    expect(tokenize('Jean-Luc St. Pierre')).toEqual(['jean', 'luc', 'st', 'pierre']);
  });

  it('drops punctuation and empty tokens', () => {
    expect(tokenize("  O'Brien   ")).toEqual(['obrien']);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('nameVariants', () => {
  it('separates the parenthetical alternate UTMB stores', () => {
    expect(nameVariants('Óscar GARCIA JORNET (Oscar GARCIA JORNET)')).toEqual([
      'Óscar GARCIA JORNET',
      'Oscar GARCIA JORNET',
    ]);
  });

  it('leaves a plain name alone', () => {
    expect(nameVariants('Kilian JORNET BURGADA')).toEqual(['Kilian JORNET BURGADA']);
  });
});

describe('matchTier', () => {
  it('scores an exact match regardless of word order', () => {
    expect(matchTier('Kilian Jornet', 'Kilian JORNET')).toBe(Tier.Exact);
    expect(matchTier('Jornet Kilian', 'Kilian JORNET')).toBe(Tier.Exact);
  });

  it('scores every word present as AllWords', () => {
    // Spanish double surnames are why this tier exists.
    expect(matchTier('Kilian Jornet', 'Kilian JORNET BURGADA')).toBe(Tier.AllWords);
  });

  it('scores prefix typing', () => {
    expect(matchTier('kil jor', 'Kilian JORNET BURGADA')).toBe(Tier.Prefix);
  });

  it('scores unrelated names as None', () => {
    expect(matchTier('Elliot Croft', 'Elliot CARDIN')).toBe(Tier.None);
    expect(matchTier('Meme Croft', 'Joe MORECROFT')).toBe(Tier.None);
  });

  it('does not treat a suffix as a prefix', () => {
    // "croft" ends MORECROFT but does not start it.
    expect(matchTier('croft', 'Joe MORECROFT')).toBe(Tier.None);
  });

  it('matches through an accent variant', () => {
    expect(matchTier('Oscar Garcia', 'Óscar GARCÍA JORNET')).toBe(Tier.AllWords);
  });

  it('uses the parenthetical alternate when it scores better', () => {
    expect(
      matchTier('Oscar Garcia Jornet', 'Óscar GARCIA JORNET (Oscar GARCIA JORNET)'),
    ).toBe(Tier.Exact);
  });

  it('will not match one name token against a repeated query word twice', () => {
    // "Croft Croft" must not be satisfied by the single token in "Meme CROFT".
    expect(matchTier('Croft Croft', 'Meme CROFT')).toBe(Tier.None);
  });

  it('returns None for an empty query', () => {
    expect(matchTier('', 'Kilian JORNET')).toBe(Tier.None);
    expect(matchTier('   ', 'Kilian JORNET')).toBe(Tier.None);
  });
});

/**
 * The two failures that prompted this change, measured against the live API.
 * If scoring ever drifts, these fail loudly instead of the runner quietly
 * sinking down the list again.
 */
describe('regressions from real searches', () => {
  it('ranks Elliot CROFT above the eight unrelated Elliots', () => {
    const others = [
      'Elliot CARDIN', 'Elliot PHILLIPPON', 'Elliot HOLTHAM', 'Elliot TEMPLE',
      'Elliot CANTOU LLOPIS', 'Elliot OUCHET', 'Elliot DAVIS', 'Elliot ROBBIE',
    ];
    expect(matchTier('Elliot Croft', 'Elliot CROFT')).toBe(Tier.Exact);
    for (const name of others) {
      expect(matchTier('Elliot Croft', name), name).toBe(Tier.None);
      expect(isStrongMatch('Elliot Croft', name), name).toBe(false);
    }
    expect(isStrongMatch('Elliot Croft', 'Elliot CROFT')).toBe(true);
  });

  it('ranks Meme CROFT above the BEECROFTs', () => {
    expect(isStrongMatch('Meme Croft', 'Meme CROFT')).toBe(true);
    for (const name of ['Jackie BEECROFT', 'Greg BEECROFT', 'Joe MORECROFT', 'Nick BEECROFT']) {
      expect(isStrongMatch('Meme Croft', name), name).toBe(false);
    }
  });

  it('demotes the UTMB fuzz around Kilian Jornet', () => {
    expect(isStrongMatch('Kilian Jornet', 'Kilian JORNET BURGADA')).toBe(true);
    for (const name of ['Killian CORNET', 'Killian JOURNET', 'Kilian DUVERGER', 'Kilian KORTH']) {
      expect(isStrongMatch('Kilian Jornet', name), name).toBe(false);
    }
  });
});

describe('isStrongMatch', () => {
  it('promotes prefix and better on a multi-word query', () => {
    expect(isStrongMatch('kil jor', 'Kilian JORNET BURGADA')).toBe(true);
    expect(isStrongMatch('Kilian Jornet', 'Kilian JORNET BURGADA')).toBe(true);
  });

  // This is what keeps single-word paging append-only: with one word every
  // upstream result contains it, so promoting on tier would re-sort everything.
  it('promotes nothing but an outright exact match on a single word', () => {
    expect(isStrongMatch('croft', 'Meme CROFT')).toBe(false);
    expect(isStrongMatch('croft', 'Ruth CROFT')).toBe(false);
    expect(isStrongMatch('croft', 'CROFT')).toBe(true);
  });
});
