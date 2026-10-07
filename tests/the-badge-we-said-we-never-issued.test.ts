/**
 * A database hiccup told a stranger that a customer's badge was never issued.
 *
 * `/verify` is where somebody pastes a badge identifier from a mark they were
 * shown. It read the record through
 *
 *     readAsAnon(…).catch(() => null)
 *
 * and then rendered, on `badgeId && !record`:
 *
 *     VibefyCode has never issued that badge
 *     No badge with that identifier exists. If you were shown a VibefyCode mark
 *     linking to it, treat the mark as unverified — and please tell us where
 *     you saw it.
 *
 * So a connection the pool could not hand out, a statement timeout, or the
 * database being unreachable — which it has been for the last two days — made
 * this product accuse a paying customer of displaying a fraudulent mark, to a
 * stranger, and invite that stranger to report them for it. On the strength of
 * our own read failing.
 *
 * It is decision 805's defect exactly — `null` carrying two meanings, "there is
 * no such badge" and "the read failed" — on the page where it costs the most.
 * `/a/[slug]` one route over was corrected for it the night before; this one was
 * the same shape and was not looked at, because the fix was reasoned about per
 * page rather than swept for.
 *
 * Three states now, and the sentence for the third says whose fault it is. A
 * visitor who cannot be told whether a mark is genuine must be told that, not
 * told the mark is fake.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The code, without comments — which quote the defect on purpose. */
const page = readFileSync(join(import.meta.dirname, '..', 'apps/web/app/verify/page.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ');

describe('a read that failed', () => {
  it('is not turned into null', () => {
    expect(page).not.toMatch(/\.catch\(\(\)\s*=>\s*null\)/);
  });

  it('is a state of its own, not the absence of a badge', () => {
    expect(page).toMatch(/kind: 'unavailable'/);
    expect(page).toMatch(/kind: 'never_issued'/);
    expect(page).toMatch(/kind: 'issued'/);
  });

  it('says it is ours, so a visitor does not read it as the mark being fake', () => {
    const branch = /kind === 'unavailable'[\s\S]{0,1600}?<\/section>/.exec(page)?.[0] ?? '';
    expect(branch.length).toBeGreaterThan(100);
    expect(branch).toMatch(/our (?:side|end)|a fault on our/i);
  });

  it('does not tell anybody to treat the mark as unverified on our own failure', () => {
    // The sentence that did the damage. It belongs in the never-issued branch
    // and nowhere else.
    const unavailable = /kind === 'unavailable'[\s\S]{0,1600}?<\/section>/.exec(page)?.[0] ?? '';
    expect(unavailable).not.toMatch(/never issued/i);
    expect(unavailable).not.toMatch(/treat the mark as unverified/i);
  });
});

describe('what has to keep holding', () => {
  it('a badge that really was never issued is still said so, plainly', () => {
    const branch = /kind === 'never_issued'[\s\S]{0,1200}?<\/section>/.exec(page)?.[0] ?? '';
    expect(branch).toMatch(/never issued/i);
    expect(branch).toMatch(/treat the mark as unverified/i);
  });

  it('still asks the two questions a signature and an origin answer separately', () => {
    expect(page).toContain('Is the signature genuine?');
    expect(page).toContain('Is the badge live right now?');
  });

  it('still reports a revoked badge as one that must not be displayed', () => {
    expect(page).toContain('It must not be displayed.');
  });
});
