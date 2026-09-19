/**
 * A draft accessibility statement, written from what was actually found.
 *
 * Every larger organisation publishes one of these and every small one knows it
 * should. They are usually written from a template, which is why so many of
 * them say an application conforms to a standard nobody checked it against.
 * Ours is assembled from the findings of a real assessment, which is the only
 * thing that makes it worth anything.
 *
 * Three rules, and the first two are refusals.
 *
 * **It never says fully conformant.** An automated pass plus a human review
 * finds a minority of real barriers, and "fully conformant" is a claim about
 * every page and every assistive technology, including the ones nobody opened.
 * The strongest thing this will draft is "partially conformant", and where
 * there were no findings at all it says the assessment found none rather than
 * that there are none.
 *
 * **The gaps are left visible rather than filled in.** A statement is a public
 * legal claim by its publisher about their own application. The places where
 * they have to write something — how somebody reports a barrier, what happens
 * when they do, when the known problems will be fixed — are precisely the
 * places we cannot honestly write it for them, so they are marked and counted,
 * and the draft says how many are outstanding.
 *
 * **It is a draft and says so on its face.** PART 11: drafted legal text is
 * never presented as final or as legal advice. We are not lawyers, and an
 * accessibility statement is something its publisher answers for.
 */
import type { ReportFinding } from './types.ts';

/** The criteria in the published rubric that are about being able to use it. */
export const ACCESSIBILITY_CRITERIA: readonly string[] = ['UX-02', 'UX-03', 'UX-04', 'UX-06'];

export type Conformance = 'partially_conformant' | 'non_conformant' | 'none_found';

export interface StatementInput {
  readonly appName: string;
  readonly organisationName: string;
  readonly assessedOn: string;
  readonly rubricVersion: string;
  readonly findings: readonly ReportFinding[];
  readonly scopeStatement: string;
}

export interface StatementGap {
  /** The exact token left in the draft, so a reader can search for it. */
  readonly placeholder: string;
  /** Why we did not write this part. */
  readonly why: string;
}

export interface AccessibilityStatementDraft {
  readonly conformance: Conformance;
  readonly markdown: string;
  readonly gaps: readonly StatementGap[];
  readonly barriers: readonly ReportFinding[];
  /** Said wherever this is offered, verbatim. */
  readonly disclaimer: string;
}

export const STATEMENT_DISCLAIMER =
  'This is a draft, not legal advice, and not a statement VibefyCode makes. It is assembled from what one assessment found on one date, for you to check, complete and publish under your own name. Sections marked [YOUR …] are ones only you can answer, and a statement published with them still in it is worse than none.';

const GAPS: readonly StatementGap[] = [
  {
    placeholder: '[YOUR FEEDBACK ROUTE]',
    why: 'How somebody tells you about a barrier, and how quickly you answer. We cannot know which of your addresses is monitored, and a statement pointing at an unread inbox is the commonest way one of these becomes untrue.',
  },
  {
    placeholder: '[YOUR ENFORCEMENT PROCEDURE]',
    why: 'What somebody can do if you do not answer. This depends on where you and your users are, it is a matter for a lawyer, and it is the section of a statement that carries actual legal weight.',
  },
  {
    placeholder: '[YOUR PLAN AND DATES]',
    why: 'When you intend to fix the barriers listed above. A date is a commitment, and inventing one on your behalf would be making a promise with your name on it.',
  },
  {
    placeholder: '[YOUR OWN TESTING]',
    why: 'Anything you have checked yourself, particularly with real assistive technology. An automated pass finds a minority of real barriers, and what you know about your own application belongs in a statement about it.',
  },
];

function conformanceOf(barriers: readonly ReportFinding[]): Conformance {
  if (barriers.length === 0) return 'none_found';
  return barriers.some((finding) => finding.severity === 'critical' || finding.severity === 'high')
    ? 'non_conformant'
    : 'partially_conformant';
}

const CONFORMANCE_SENTENCE: Readonly<Record<Conformance, string>> = {
  none_found:
    'This assessment found no accessibility barriers in what it covered. That is not the same as conforming fully: an assessment covers a stated scope at a moment, an automated pass finds a minority of real barriers, and nobody has claimed here that every page and every assistive technology was exercised.',
  partially_conformant:
    'This application is **partially conformant** with WCAG 2.2 level AA. Some content does not fully conform, and the parts that do not are listed below.',
  non_conformant:
    'This application does **not** conform to WCAG 2.2 level AA. One or more serious barriers were found, and they are listed below.',
};

export function draftAccessibilityStatement(input: StatementInput): AccessibilityStatementDraft {
  const barriers = input.findings
    .filter((finding) => ACCESSIBILITY_CRITERIA.includes(finding.ruleId))
    .filter((finding) => finding.severity !== 'info');

  const conformance = conformanceOf(barriers);

  const barrierList =
    barriers.length === 0
      ? '_No barriers were found by the assessment. Anything you know of yourself belongs here._'
      : barriers
          .map(
            (finding) =>
              `- **${finding.title}** — ${finding.description} _(found against criterion ${finding.ruleId} of the VibefyCode rubric.)_`,
          )
          .join('\n');

  const markdown = `# Accessibility statement for ${input.appName}

**This is a draft.** ${STATEMENT_DISCLAIMER}

${input.organisationName} is committed to making ${input.appName} accessible, in line with WCAG 2.2 level AA.

## How accessible this application is

${CONFORMANCE_SENTENCE[conformance]}

${barrierList}

## What we are doing about it

[YOUR PLAN AND DATES]

## Telling us about a problem

[YOUR FEEDBACK ROUTE]

## If we do not put it right

[YOUR ENFORCEMENT PROCEDURE]

## How this was checked

This statement was drafted from an independent assessment carried out by VibefyCode on ${input.assessedOn}, against version ${input.rubricVersion} of its published rubric. That assessment included an automated WCAG 2.2 AA pass and a review by a person.

${input.scopeStatement}

An automated pass finds a minority of real barriers. Anything checked with assistive technology by a person belongs here:

[YOUR OWN TESTING]

## When this statement was prepared

Drafted on ${input.assessedOn}. Review it whenever the application changes, and at least once a year — a statement that describes an application as it was eighteen months ago is a statement that is no longer true.
`;

  return {
    conformance,
    markdown,
    gaps: GAPS,
    barriers,
    disclaimer: STATEMENT_DISCLAIMER,
  };
}
