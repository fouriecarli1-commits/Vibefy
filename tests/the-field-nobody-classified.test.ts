/**
 * What a free report gives away.
 *
 * `redactForTier` builds the free version of a finding. It used to do it with
 * a spread and two blanked fields:
 *
 *     { ...finding, evidence: [], remediation: '' }
 *
 * which is a list of what to withhold. `ReportFinding` has nine fields and
 * that list covered the two that matter today, so it was complete — and
 * complete by coincidence, the third time tonight. Add a field to the type — a
 * reproduction, an affected URL, a technical detail — and it ships to the free
 * tier by default. That is the paid report given away rather than withheld,
 * and nothing would have said so.
 *
 * The default direction is what matters. The tier check itself is already the
 * right way round: anything that is not `'paid'` takes the free path, so an
 * unknown tier withholds. The finding's fields were the other way round.
 *
 * So the fields a free reader may see are named, and this refuses a field that
 * appears in neither list — read out of `types.ts`, because TypeScript's
 * fields are not there at runtime to be asked.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  FREE_TIER_FINDING_FIELDS,
  PAID_ONLY_FINDING_FIELDS,
  redactForTier,
} from '../packages/report/src/redact.ts';
import { withoutComments } from './setup/source.ts';
import type { ReportFinding, ReportSource } from '../packages/report/src/types.ts';

/** `ReportFinding`'s fields, read from the type that declares them. */
const declared = (() => {
  const source = withoutComments(readFileSync('packages/report/src/types.ts', 'utf8'));
  const block = /export interface ReportFinding \{([\s\S]*?)\n\}/.exec(source);
  if (!block) throw new Error('ReportFinding is no longer declared as an interface here');
  // Top-level fields only: `evidence` is an inline object and its own keys are
  // indented further.
  return [...block[1]!.matchAll(/^ {2}readonly (\w+)[?]?:/gm)].map((match) => match[1]!);
})();

const finding = (extra: Record<string, unknown> = {}): ReportFinding =>
  ({
    id: 'f1',
    ruleId: 'SEC-01',
    dimension: 'security',
    severity: 'high',
    confidence: 'confirmed',
    title: 'A finding',
    description: 'What we saw.',
    remediation: 'Do this to fix it.',
    evidence: [
      {
        id: 'EVIDENCE-ID-ONLY-PAID',
        kind: 'screenshot',
        summary: 'A SUMMARY ONLY A PAID READER SEES',
        sha256: 'SHA-ONLY-PAID',
        capturedAt: 'now',
      },
    ],
    ...extra,
  }) as unknown as ReportFinding;

const source = (findings: ReportFinding[]): ReportSource =>
  ({
    findings,
    intendedForAppStore: false,
    overallScore: 85,
    dimensionScores: [],
  }) as unknown as ReportSource;

describe('the fields of a finding', () => {
  it('were read from the type, so the comparison below is about something', () => {
    expect(declared.length).toBeGreaterThan(6);
    expect(declared).toContain('remediation');
    expect(declared).toContain('evidence');
  });

  it('are every one either shown free or withheld, with none unclassified', () => {
    const classified = new Set<string>([
      ...FREE_TIER_FINDING_FIELDS,
      ...Object.keys(PAID_ONLY_FINDING_FIELDS),
    ]);
    const unclassified = declared.filter((field) => !classified.has(field));
    expect(
      unclassified,
      `ReportFinding fields that are neither shown free nor withheld:\n  ${unclassified.join('\n  ')}\n` +
        'A field nobody classified is shown to a free reader, which gives away the paid report. ' +
        'Add it to FREE_TIER_FINDING_FIELDS, or to PAID_ONLY_FINDING_FIELDS with why it is paid.',
    ).toEqual([]);
  });

  it('are none classified twice, or in neither direction by mistake', () => {
    for (const field of FREE_TIER_FINDING_FIELDS) {
      expect(Object.keys(PAID_ONLY_FINDING_FIELDS), field).not.toContain(field);
    }
    for (const field of Object.keys(PAID_ONLY_FINDING_FIELDS)) {
      expect(declared, `${field} is withheld and is not a field`).toContain(field);
    }
  });

  it('gives a reason for each one withheld', () => {
    for (const [field, why] of Object.entries(PAID_ONLY_FINDING_FIELDS)) {
      expect(why.length, field).toBeGreaterThan(30);
    }
  });
});

describe('a free report', () => {
  it('carries only the fields named, whatever the finding carries', () => {
    const free = redactForTier(source([finding({ reproduction: 'a field added later' })]), 'free');
    expect(Object.keys(free.findings[0]!).sort()).toEqual(
      [...FREE_TIER_FINDING_FIELDS, 'remediation', 'evidence'].sort(),
    );
    expect(JSON.stringify(free), 'a field nobody classified reached a free reader').not.toContain(
      'a field added later',
    );
  });

  it('still blanks the two it is built to blank', () => {
    const free = redactForTier(source([finding()]), 'free');
    expect(free.findings[0]!.remediation).toBe('');
    expect(free.findings[0]!.evidence).toEqual([]);
    expect(JSON.stringify(free)).not.toContain('Do this to fix it.');
  });

  it('keeps what a free reader is meant to see, which is the point of the tier', () => {
    // The positive control: withholding everything would satisfy every
    // assertion above and leave nothing to buy the paid report for.
    const free = redactForTier(source([finding()]), 'free');
    expect(free.findings[0]!.title).toBe('A finding');
    expect(free.findings[0]!.description).toBe('What we saw.');
    expect(free.findings[0]!.severity).toBe('high');
  });
});

describe('the object a renderer is handed', () => {
  it('carries no findings on its source, redacted or otherwise', () => {
    /*
     * `RedactedReport.source` was the whole `ReportSource`, so the unredacted
     * findings sat on the redacted object, one dot away from every line of the
     * renderer. The comment beside the free-tier strip promises that "a
     * renderer that forgets a conditional must not be able to leak it", and
     * `view.source.findings` was how it could. Nothing read it; the type is
     * what keeps that true, and this is what notices if the type changes back.
     */
    const free = redactForTier(source([finding()]), 'free');
    expect('findings' in free.source, 'the unredacted findings are back on the source').toBe(false);
  });

  it('keeps the rest of the source, which the renderer needs for every heading', () => {
    // The positive control. Stripping the whole source would satisfy the
    // assertion above and leave nothing to render a report from.
    const free = redactForTier(source([finding()]), 'free');
    expect(free.source.overallScore).toBe(85);
    expect(free.source.intendedForAppStore).toBe(false);
  });

  it('carries none of the withheld text anywhere on the object', () => {
    const free = redactForTier(source([finding()]), 'free');
    const whole = JSON.stringify(free);
    /*
     * Named values rather than a word like "screenshot", which the `withheld`
     * list says out loud on purpose: "The evidence behind each finding —
     * screenshots, browser traces and HTTP exchanges" is the sales pitch for
     * the paid tier and has to be there. The first draft of this asserted on
     * that word and failed on the sentence describing the withholding.
     */
    for (const secret of [
      'Do this to fix it.',
      'EVIDENCE-ID-ONLY-PAID',
      'A SUMMARY ONLY A PAID READER SEES',
      'SHA-ONLY-PAID',
    ]) {
      expect(whole, `${secret} reached a free reader`).not.toContain(secret);
    }
  });
});

describe('a paid report', () => {
  it('carries the finding whole, including the fields the free one drops', () => {
    const paid = redactForTier(source([finding({ reproduction: 'a field added later' })]), 'paid');
    expect(paid.findings[0]!.remediation).toBe('Do this to fix it.');
    expect(paid.findings[0]!.evidence).toHaveLength(1);
  });

  it('is the only tier that does, so an unknown tier withholds', () => {
    const unknown = redactForTier(source([finding()]), 'enterprise' as never);
    expect(unknown.findings[0]!.remediation).toBe('');
    expect(unknown.showEvidence).toBe(false);
  });
});
