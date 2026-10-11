/**
 * The reviewer's own page, and whether it says anything is waiting.
 *
 * `/review` measures the assessment queue three ways — waiting, needing a
 * closer look, minutes — and then offers four links: Screening, Badges,
 * Appeals, Data requests. Those four read identically whether there is nothing
 * behind them or an appeal whose fourteen days ran out on Tuesday. The worker's
 * log now names an open appeal once a day, and the log is not where somebody
 * reviewing is looking; this page is.
 *
 * So three of the four carry a count, and the two with a published deadline
 * carry how many of them are late. Badges deliberately does not: that surface
 * is for suspending or revoking a live badge, not a queue of things waiting.
 *
 * Asserted against the source, because a server component's output is not
 * something this suite can render. What it holds is the part that would go
 * wrong silently: a chip that stops being derived, a status set that stops
 * agreeing with the sweep's, and a lateness test that stops reading `due_at`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withoutComments } from './setup/source.ts';

const page = withoutComments(
  readFileSync(join(process.cwd(), 'apps/web/app/review/page.tsx'), 'utf8'),
);
const sweep = withoutComments(
  readFileSync(join(process.cwd(), 'apps/worker/src/governance.ts'), 'utf8'),
);

describe('the four queues', () => {
  it('are all still linked, which is what the counts are on', () => {
    for (const href of [
      '/review/screening',
      '/review/badges',
      '/review/appeals',
      '/review/requests',
    ]) {
      expect(page).toContain(`href="${href}"`);
    }
  });

  it('carry a count rather than a word, except the one with nothing waiting', () => {
    expect(page).toContain("{chipLabel('Screening', screeningWaiting)}");
    expect(page).toContain("{chipLabel('Appeals', appealsOpen, appealsOverdue)}");
    expect(page).toContain("{chipLabel('Data requests', requestsOpen, requestsOverdue)}");
    // Badges is a word on purpose, and stays one.
    expect(page).toMatch(/href="\/review\/badges"[^>]*>\s*Badges/);
  });

  it('count what is open, not what exists', () => {
    expect(page).toContain("rows('appeals').in('status', ['open', 'under_review'])");
    expect(page).toContain("rows('data_requests').not('status', 'in', '(completed,refused)')");
    expect(page).toContain("eq('screening_status', 'pending')");
    // An archived application is not waiting for a screening decision.
    expect(page).toContain("is('archived_at', null)");
  });

  it('agree with the sweep about which appeal is still open', () => {
    // The worker says this in SQL and the page says it to a REST client. Two
    // statements of one definition: if the sweep's set changes, the number on
    // this page goes on counting the old one, and nobody would see it.
    expect(sweep).toContain("where status in ('open', 'under_review')");
  });

  it('call something late by its own published deadline', () => {
    const late = page.match(/\.lt\('due_at', now\)/g) ?? [];
    expect(late.length).toBe(2);
  });
});
