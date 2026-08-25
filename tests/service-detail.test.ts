/**
 * What a plan says it includes — and what it says it does not.
 *
 * A service description that lists only the inclusions is a sales page wearing
 * an explanation's clothes, and this product spends its trust-check pages
 * complaining about exactly that. So the same standard applies to us: every
 * plan states what is missing and how to stop, in the same type size as the
 * benefits.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVICE_DETAILS, serviceDetailFor } from '../packages/billing/src/index.ts';
import { lintText } from '../tools/copy-lint.mjs';

const pricing = JSON.parse(readFileSync(join(process.cwd(), 'config/pricing.json'), 'utf8')) as {
  tiers: { id: string; label: string }[];
};

describe('every plan is explained', () => {
  it('covers every tier that is offered', () => {
    for (const tier of pricing.tiers) {
      expect(serviceDetailFor(tier.id), `${tier.id} has no detail`).not.toBeNull();
    }
  });

  it('says what happens after you pay, with a timing for each step', () => {
    for (const detail of SERVICE_DETAILS) {
      expect(detail.whatHappens.length, detail.tierId).toBeGreaterThanOrEqual(3);
      for (const entry of detail.whatHappens) {
        expect(
          entry.timing.length,
          `${detail.tierId}: "${entry.step}" has no timing`,
        ).toBeGreaterThan(5);
      }
    }
  });

  it('states what is not included, on every plan', () => {
    // The half that gets left out everywhere else.
    for (const detail of SERVICE_DETAILS) {
      expect(detail.notIncluded.length, detail.tierId).toBeGreaterThanOrEqual(2);
    }
  });

  it('says how to stop, on every plan', () => {
    for (const detail of SERVICE_DETAILS) {
      expect(detail.howToStop.length, detail.tierId).toBeGreaterThan(40);
    }
  });

  it('tells a recurring customer they can cancel in one step, without a conversation', () => {
    // The trust check calls out subscriptions that can only be cancelled by
    // contacting somebody. We do not get to be one of those.
    const certified = serviceDetailFor('certified')!;
    expect(certified.howToStop).toMatch(/one step/i);
    expect(certified.howToStop).toMatch(/no conversation|without.*(contact|conversation)/i);
  });

  it('says on every paid plan that money cannot move a score', () => {
    // The claim the whole product rests on, restated where somebody is about to
    // spend money — which is the moment they are entitled to doubt it.
    const paid = SERVICE_DETAILS.filter((detail) => detail.tierId !== 'free');
    const mentioning = paid.filter((detail) =>
      /score/i.test(detail.notIncluded.join(' ') + detail.plainly),
    );
    expect(mentioning.length).toBeGreaterThanOrEqual(3);
  });

  it('never promises a badge on a plan that cannot issue one', () => {
    for (const tierId of ['free', 'one_off']) {
      const detail = serviceDetailFor(tierId)!;
      expect(detail.notIncluded.join(' '), tierId).toMatch(/badge/i);
      expect(detail.included.join(' '), tierId).not.toMatch(/badge/i);
    }
  });

  it('passes the copy gate', () => {
    const copy = SERVICE_DETAILS.map((detail) =>
      [
        detail.plainly,
        ...detail.whatHappens.map((entry) => `${entry.step} ${entry.timing}`),
        ...detail.included,
        ...detail.notIncluded,
        detail.howToStop,
      ].join('\n'),
    ).join('\n');
    expect(lintText(copy, 'services')).toEqual([]);
  });
});

describe('the disclosure it is shown in', () => {
  const component = readFileSync(join(process.cwd(), 'apps/web/components/disclosure.tsx'), 'utf8');
  const billing = readFileSync(
    join(process.cwd(), 'apps/web/app/console/billing/page.tsx'),
    'utf8',
  );

  it('is a native details element rather than a hand-rolled accordion', () => {
    // Works with no JavaScript, opens from a keyboard without anything being
    // wired up, and find-in-page can open it to show a match.
    expect(component).toContain('<details');
    expect(component).toContain('<summary');
    expect(component).not.toContain('useState');
  });

  it('shows the exclusions in the same type size as the inclusions', () => {
    const notIncluded = component.slice(component.indexOf('Not included'));
    expect(notIncluded).toContain('text-sm');
    expect(notIncluded).not.toMatch(/text-\[?(10|11)px|text-\[0\.6/);
  });

  it('is on every plan on the billing page', () => {
    expect(billing).toContain('serviceDetailFor(tier.id)');
    expect(billing).toContain('<ServiceDetailBody');
    expect(billing).toContain('how to cancel');
  });
});
