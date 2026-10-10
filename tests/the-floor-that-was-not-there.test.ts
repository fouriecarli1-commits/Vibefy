/**
 * A floor typed wrong became a profile that passes everything.
 *
 * A policy profile is what an organisation measures somebody else's
 * application against before accepting it: an overall minimum and a floor per
 * dimension, applied over a score that was computed without knowing the
 * profile exists. Its own save notice says it "can fail an application the
 * rubric passed".
 *
 * `optionalScore` returned `number | null`, and `null` meant two things: the
 * box was empty, which is a legitimate way to say there is no floor here, and
 * what you typed is not a score. So `9O` with a letter O in it, or `120`, or a
 * number in the wrong field, saved the profile with that floor silently
 * absent. Every application then cleared it, including the ones the floor was
 * written to stop, and the only record of the mistake was in the memory of
 * whoever typed it.
 *
 * The form's input is `type="number"`, which is why this was easy to miss and
 * no defence at all: it carries no `min` or `max`, a server action is reachable
 * without a browser, and the value arrives as a string either way.
 */
import { describe, expect, it } from 'vitest';
import { optionalScore, readably } from '../apps/web/lib/typed-score.ts';

const scoreOf = (input: string) => optionalScore(input, 'the overall score');

describe('a score somebody typed', () => {
  it('reads a number in range', () => {
    expect(scoreOf('85')).toEqual({ value: 85 });
    expect(scoreOf(' 70 ')).toEqual({ value: 70 });
    expect(scoreOf('0')).toEqual({ value: 0 });
    expect(scoreOf('100')).toEqual({ value: 100 });
  });

  it('reads an empty box as no floor, which is a legitimate answer', () => {
    // The case that must stay a value and not become an error: most profiles
    // set one or two floors and leave the rest blank on purpose.
    expect(optionalScore('', 'x')).toEqual({ value: null });
    expect(optionalScore('   ', 'x')).toEqual({ value: null });
    expect(optionalScore(null, 'x')).toEqual({ value: null });
  });

  it('refuses something that is not a number, and quotes it back', () => {
    const verdict = scoreOf('9O');
    expect('error' in verdict).toBe(true);
    if ('error' in verdict) {
      // Quoted so they can see what they typed, which for a letter O in place
      // of a zero is the only way anybody spots it.
      expect(verdict.error).toContain('"9O"');
      expect(verdict.error).toContain('the overall score');
      expect(verdict.error).toMatch(/Leave .* empty if there is no floor/);
    }
  });

  it('refuses a score outside nought to a hundred, and says the range', () => {
    for (const typed of ['120', '-5', '1000']) {
      const verdict = scoreOf(typed);
      expect('error' in verdict, typed).toBe(true);
      if ('error' in verdict) expect(verdict.error).toMatch(/scores run from 0 to 100/);
    }
  });

  it('names the field, because there are seven of them on one form', () => {
    const verdict = optionalScore('abc', readably('store_distribution_readiness'));
    expect('error' in verdict).toBe(true);
    if ('error' in verdict) expect(verdict.error).toContain('store distribution readiness');
  });

  it('does not read an empty-ish number as nothing', () => {
    /*
     * `Number('')` is 0 and `Number(' ')` is 0, which is why the empty check
     * comes first and is about the text rather than the number. A floor of
     * zero that arrived from an empty box would be a floor every application
     * clears — the same outcome as the defect, reached from the other side.
     */
    expect(optionalScore('', 'x')).toEqual({ value: null });
    expect(scoreOf('0')).toEqual({ value: 0 });
  });
});

describe('the dimension names in the message', () => {
  it('reads as words rather than as a column name', () => {
    expect(readably('security_posture')).toBe('security posture');
    expect(readably('practicality_ux')).toBe('practicality ux');
  });
});
