import { describe, it, expect } from 'vitest';
import { ago, initials, prettyName, shortRace } from '@/lib/format';

describe('prettyName', () => {
  it('softens the shouted surname ITRA returns', () => {
    expect(prettyName('Kilian JORNET BURGADA')).toBe('Kilian Jornet Burgada');
    expect(prettyName('Courtney DAUWALTER')).toBe('Courtney Dauwalter');
  });

  it('leaves correctly cased names alone', () => {
    expect(prettyName('Kilian Jornet')).toBe('Kilian Jornet');
    expect(prettyName('Ruth McDonald')).toBe('Ruth McDonald');
  });

  it('handles accents and collapses whitespace', () => {
    expect(prettyName('Óscar GARCÍA')).toBe('Óscar García');
    expect(prettyName('  Jim   WALMSLEY  ')).toBe('Jim Walmsley');
  });

  it('leaves single characters and initials untouched', () => {
    expect(prettyName('J WALMSLEY')).toBe('J Walmsley');
  });
});

describe('initials', () => {
  it('takes the first letter of the first two words', () => {
    expect(initials('Kilian Jornet Burgada')).toBe('KJ');
    expect(initials('Kilian')).toBe('K');
  });
});

describe('ago', () => {
  const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

  it('describes recency in the largest sensible unit', () => {
    expect(ago(at(10_000))).toBe('just now');
    expect(ago(at(20 * 60_000))).toBe('20m ago');
    expect(ago(at(3 * 3_600_000))).toBe('3h ago');
    expect(ago(at(2 * 86_400_000))).toBe('2d ago');
  });

  it('never reports a negative age for a clock skewed into the future', () => {
    expect(ago(new Date(Date.now() + 60_000).toISOString())).toBe('just now');
  });
});

describe('shortRace', () => {
  it('keeps the year and the race, dropping the event in between', () => {
    expect(shortRace('2026 - Nike ACG Ultra-Trail Chongli - Chongli 168 Emergency Route Team'))
      .toBe('2026 · Chongli 168 Emergency Route Team');
  });

  it('handles an entry with only a year and a race', () => {
    expect(shortRace('2025 - Amnye Machen Xtreme Challenge')).toBe(
      '2025 · Amnye Machen Xtreme Challenge',
    );
  });

  it('passes through an entry with no year', () => {
    expect(shortRace('Some Race')).toBe('Some Race');
  });

  it('returns empty for empty input', () => {
    expect(shortRace('')).toBe('');
    expect(shortRace('   ')).toBe('');
  });
});
