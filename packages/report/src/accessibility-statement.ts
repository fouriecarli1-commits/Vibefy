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

/**
 * The criteria in the published rubric that are about being able to use it.
 *
 * Four of the seven in the practicality dimension, and the reason each one is
 * here is written beside it — because the list was four literals with no rule,
 * and its own test was called "agrees with the rubric about which criteria
 * those are" while reading nothing but this constant. A criterion that is
 * about accessibility and is missing from here is a barrier that never reaches
 * the statement a customer publishes in their own name.
 *
 * Rubric 1.1.0 added UX-07 after this list was written, which is the shape:
 * four was complete on the day and nothing would have said otherwise.
 * `NOT_ACCESSIBILITY_CRITERIA` is the other half, so the two together have to
 * account for every criterion in the dimension and a new one cannot be
 * classified by omission.
 */
export const ACCESSIBILITY_CRITERIA: readonly string[] = [
  // Reflow. WCAG 2.2 AA 1.4.10: content at 320 CSS pixels wide without
  // two-dimensional scrolling. The rubric measures 360, which is narrower than
  // every phone sold and wider than the criterion asks.
  'UX-02',
  // The automated pass itself, named for the standard.
  'UX-03',
  // Keyboard access and a visible focus indicator. 2.1.1 and 2.4.7.
  'UX-04',
  // Legibility and placeholder text left in the page. Not a numbered success
  // criterion on its own, and a page whose copy is unreadable is not usable by
  // the people this statement is for.
  'UX-06',
];

/**
 * The criteria in the same dimension that are not, and why.
 *
 * Here so that the two lists together account for every criterion the rubric
 * publishes in this dimension. `tests/accessibility-statement.test.ts` reads
 * the rubric and insists on it, which is the check that was missing: a UX
 * criterion added later is otherwise excluded from a legal statement by
 * nobody's decision.
 */
export const NOT_ACCESSIBILITY_CRITERIA: Readonly<Record<string, string>> = {
  'UX-01':
    'Whether a first-run path to value is clear without instruction is usability. A confusing product is not an accessibility barrier, and calling it one in a statement a customer publishes would misdescribe both.',
  'UX-05':
    'Loading and error feedback for slow operations overlaps WCAG 2.2 AA 4.1.3 Status Messages, and is deliberately not treated as the same thing: 4.1.3 is about a status being programmatically determinable, and a finding here can as easily be a missing spinner. Treating the broader criterion as the narrower one would put a barrier in somebody\u2019s statement that an auditor would not accept, which is worse for them than leaving it out. If the rubric ever splits it, the narrower half belongs above.',
  'UX-07':
    'Type, spacing and control styles following a consistent scale is a design-coherence criterion added in rubric 1.1.0. Consistency has an accessibility dividend and is not a success criterion; 3.2.4 Consistent Identification is about functional components being named the same way, which this does not measure.',
};

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
