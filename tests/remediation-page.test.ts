/**
 * The page that sells the service, and argues against itself first.
 *
 * A rating company offering to fix what it rates has a financial interest in
 * finding faults. Every sceptic notices, and they are right to. A page that
 * leads with the offer and buries the conflict confirms their suspicion the
 * moment they scroll — so the order of this page is not a stylistic choice, it
 * is the argument.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRICING_BASIS, REMEDIATION_OFFER } from '../packages/remediation/src/index.ts';
import { REMEDIATION_CLIENT_DISCLOSURE } from '../packages/shared/src/legal.ts';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const page = read('apps/web/app/services/remediation/page.tsx');

describe('the objection comes before the offer', () => {
  it('states the conflict above what is included', () => {
    // Whitespace-tolerant: Prettier wraps prose in JSX, so the sentence is split
    // across lines and a plain `indexOf` finds nothing at all — which would have
    // passed this as "-1 is less than 300" if the first assertion were missing.
    const conflict = /financial interest in\s+finding faults/.exec(page);
    const included = page.indexOf('What is included');
    expect(conflict, 'the conflict is not stated on the page').not.toBeNull();
    expect(included).toBeGreaterThan(-1);
    expect(conflict!.index).toBeLessThan(included);
  });

  it('says it about us, not about the industry', () => {
    // "Some companies have this conflict" is a way of not having it.
    expect(page).toMatch(/it is true of us/);
    expect(page).toMatch(/You should\s+be sceptical of this page/);
  });

  it('does not claim the conflict goes away', () => {
    expect(page).toContain('None of this makes the conflict disappear');
    expect(page).toContain('visible and inert');
  });

  it('tells the reader declining costs them nothing', () => {
    expect(page).toMatch(/decline/);
    expect(page).toMatch(/place in the review\s+queue changes/);
  });
});

describe('the copy is the copy the wall was tested against', () => {
  it('imports the offer rather than restating it', () => {
    // A page that retypes the offer is a page where "we cannot promise your
    // score will rise" quietly becomes "we will get you certified", and the
    // tests that forbid that are looking somewhere else.
    expect(page).toContain("from '@vibefycode/remediation'");
    expect(page).toContain('REMEDIATION_OFFER.included');
    expect(page).toContain('REMEDIATION_OFFER.notIncluded');
    expect(page).toContain('REMEDIATION_OFFER.howToStop');
  });

  it('shows the exact disclosure the badge page will carry', () => {
    // So a customer decides knowing the sentence, rather than discovering it
    // after paying.
    expect(page).toContain('REMEDIATION_CLIENT_DISCLOSURE');
    expect(REMEDIATION_CLIENT_DISCLOSURE).toContain('VibefyCode was paid to help fix');
  });

  it('renders the pricing bases from the closed union', () => {
    expect(page).toContain('PRICING_BASIS.map');
    expect(PRICING_BASIS).toHaveLength(2);
  });

  it('says why there is no third pricing option', () => {
    expect(page).toMatch(/price per finding resolved\s+would pay us for every fault we report/);
  });
});

describe('the disclosure reaches the surface that shows a score', () => {
  const verification = read('apps/web/app/a/[slug]/page.tsx');

  it('is rendered on the verification page', () => {
    expect(verification).toContain('REMEDIATION_CLIENT_DISCLOSURE');
    expect(verification).toContain('owner_has_remediation');
  });

  it('is selected in the query, not assumed', () => {
    expect(verification).toMatch(/select[\s\S]{0,400}owner_has_remediation/);
  });

  it('comes from the view every score surface already reads', () => {
    // Added to `badge_verification` rather than fetched separately, so a surface
    // cannot show a score without the disclosure being available to it.
    const migration = read('supabase/migrations/20260826170000_remediation_disclosure.sql');
    expect(migration).toContain('create or replace view public.badge_verification');
    expect(migration).toContain('public.app_has_remediation(b.app_id) as owner_has_remediation');
  });
});

describe('it can be found', () => {
  it('is in the navigation', () => {
    expect(read('apps/web/components/site-nav.tsx')).toContain("href: '/services/remediation'");
  });

  it('is scanned for accessibility like every other public page', () => {
    expect(read('tools/a11y-scan.mts')).toContain("'/services/remediation'");
  });
});
