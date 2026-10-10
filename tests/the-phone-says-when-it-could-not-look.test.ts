/**
 * What the phone shows when a read failed.
 *
 * The app has no renderer in this suite, so these hold the source rather than
 * the screen. That is a weaker test than rendering one, and it is the test
 * that can be run — and the three defects it was written against are not
 * subtle shades of rendering, they are a screen that spins for ever and two
 * lists that say "none" when the answer is "we do not know".
 *
 *   · `application/[id].tsx` destructured `data` and dropped `error`, then
 *     rendered `if (!app) return <Loading />`. A read that failed left `app`
 *     null for ever, so the screen was a spinner with no message, no retry and
 *     nothing said. The same line also swallowed an application that genuinely
 *     is not there.
 *   · The same screen read its history and its requests through
 *     `.catch(() => [])`. A failure then printed "No approved assessments yet"
 *     — on an application that has been assessed — and offered a paid re-test
 *     while one was already queued, because the queued one was in the list
 *     that failed to load.
 *   · `report/[assessmentId].tsx` reads the assessment properly, sets an error
 *     and says so. The findings beneath it dropped `error`, so a failed read
 *     printed a score with an empty findings list, which on a report reads as
 *     nothing having been found.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The code, without the comments.
 *
 * Written because the first version of this file matched the comments
 * explaining the defects it was written against — they quote the old lines
 * verbatim, which is the point of them — and reported the defects as still
 * present. A text test that reads prose is a text test that measures prose.
 */
const source = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');

const application = source('apps/mobile/app/application/[id].tsx');
const report = source('apps/mobile/app/report/[assessmentId].tsx');
const applications = source('apps/mobile/app/(tabs)/index.tsx');

describe('the application screen', () => {
  it('tells apart loading, not there, and could not be read', () => {
    // Three outcomes need three states. `null` alone cannot carry them, and
    // `if (!app) return <Loading />` is what collapsing them looks like.
    expect(application).not.toMatch(/if \(!app\)\s*return <Loading/);
    expect(application).toMatch(/app === undefined/);
  });

  it('reads the error off the application row rather than dropping it', () => {
    const read = /const \{[^}]*\} = await supabase\s*\n\s*\.from\('apps'\)/.exec(application);
    expect(read, 'the apps read moved or changed shape').not.toBeNull();
    expect(read![0]).toMatch(/error/);
  });

  it('does not turn a failed list into an empty one', () => {
    expect(application).not.toMatch(/\.catch\(\(\) => \[\]\)/);
  });

  it('says so rather than printing “no assessments yet”', () => {
    // The distinction the screen has to draw in words, not only in state.
    expect(application).toMatch(/could not/i);
  });
});

describe('the report screen', () => {
  it('reads the error off the findings list too', () => {
    const read = /const \{[^}]*\} = await supabase\s*\n\s*\.from\('findings'\)/.exec(report);
    expect(read, 'the findings read moved or changed shape').not.toBeNull();
    expect(read![0]).toMatch(/error/);
  });
});

describe('the list of applications', () => {
  it('says so when the urgent alerts could not be read', () => {
    /*
     * This one keeps its catch, and should. A failed alert read must not blank
     * the list of applications beside it, which is what the screen is for.
     *
     * What was missing is the sentence. The comment above that read says these
     * are "surfaced on the screen they open, not left in a tab they have no
     * reason to visit" — so showing none of them, silently, is the one outcome
     * it was written to prevent.
     */
    expect(applications).toMatch(/alertsError/);
    expect(applications).toMatch(/Alerts could not be loaded/i);
  });

  it('still shows the applications when only the alerts failed', () => {
    // The catch stays, and the error state is separate from the one that
    // governs the list itself.
    expect(applications).toMatch(/\.catch\(/);
    expect(applications).toMatch(/setApps\(/);
  });
});
