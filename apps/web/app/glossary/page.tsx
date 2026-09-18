import type { Metadata } from 'next';
import Link from 'next/link';
import { InShort } from '@/components/in-short';

export const metadata: Metadata = {
  title: 'What the words mean',
  description:
    'The words used across VibefyCode, explained in plain language: assessment, rubric, criterion, scope, evidence, badge, drift, authorisation and the rest.',
};

const IN_SHORT = [
  'Every word we use on this site that is not an ordinary English word is here.',
  'Each one is explained in a sentence or two, without using the others.',
  'If a word on any page sent you looking, it should be on this list.',
];

/**
 * The words, explained.
 *
 * `tests/plain-language.test.ts` bans a list of words from the summaries at the
 * top of each page, because they mean nothing on somebody's first visit. That
 * ban is only half an answer: the words are still used in the body of those
 * pages, and they have to be — "the list of checks, each of which has a weight"
 * is not a phrase anybody can write eleven times on one page.
 *
 * So the banned list and this page are the same list, held together by a test.
 * A word we think is too specialised for a summary is a word we owe a
 * definition for, and adding one without the other is how a glossary comes to
 * be missing exactly the term somebody looked up.
 *
 * Written so that no entry needs another entry to be understood first. That is
 * harder than it sounds and it is the only thing that makes a glossary useful
 * to the person who actually needs one.
 */
const TERMS: readonly { term: string; plain: string }[] = [
  {
    term: 'Assessment',
    plain:
      'One run of our checks against one application, on one day, covering what its owner said we could look at. Everything else on this site is either something that leads to an assessment or something that comes out of one.',
  },
  {
    term: 'Rubric',
    plain:
      'The list of things we check, and how much each one counts towards the score. We publish it in full and it has version numbers, so you can see exactly what an application was measured against and when that changed.',
  },
  {
    term: 'Criterion',
    plain:
      'One item on that list. "Does the sign-in form work" is a criterion. Each one has an identifier such as SEC-02, so a finding can point at the thing it failed rather than at a general area.',
  },
  {
    term: 'Criteria',
    plain: 'More than one criterion. The word has an awkward plural and that is all it means.',
  },
  {
    term: 'Scope',
    plain:
      'What the owner of an application allowed us to open, and nothing beyond it. If a part of an application was not in scope, we do not test it and the report says so rather than leaving you to assume it passed.',
  },
  {
    term: 'Authorisation',
    plain:
      'Proof that the person asking for an assessment is entitled to allow one. Nothing is opened until it exists, because testing software you do not own is not something a company should do for a fee.',
  },
  {
    term: 'Evidence',
    plain:
      'What we kept to show a finding is real: a screenshot, a recorded request, a page as it was at the time. A finding with no evidence never reaches a report, however confident anything was about it.',
  },
  {
    term: 'Finding',
    plain:
      'One thing we found, written down with what it was, where, how sure we are, and what to do about it. A report is mostly a list of these.',
  },
  {
    term: 'Badge',
    plain:
      'The mark an application can show on its own site once it has passed. It is served from us every time somebody loads it, which is how it can be taken down the moment it stops being true.',
  },
  {
    term: 'Drift',
    plain:
      'An application changing after it was assessed, in a way that affects what the badge stands on. We re-check on a schedule, and a badge is suspended when what earned it is no longer there.',
  },
  {
    term: 'Remediation',
    plain:
      'Fixing what an assessment found. We sell help with it, and we say plainly that a company which rates applications and also sells repairs has a reason to find more to repair.',
  },
  {
    term: 'Methodology',
    plain:
      'How we work something out, written down so you can check it. Our rating methodology page is the rubric plus the arithmetic that turns findings into a score.',
  },
  {
    term: 'Point-in-time',
    plain:
      'True on the day it was measured and not a promise about tomorrow. An application assessed in March can be different in April, which is why every badge carries a date and an expiry.',
  },
  {
    term: 'Provenance',
    plain:
      'Where something came from and how you can tell. A badge carries a signature that proves it came from us, so a picture of one copied from somebody else does not verify.',
  },
  {
    term: 'Attestation',
    plain:
      'A statement that something was checked, by someone willing to be named for it. A badge is one. It is not the same as a promise that nothing is wrong.',
  },
  {
    term: 'Deterministic',
    plain:
      'Gives the same answer every time it is run on the same thing. Some of our checks are like this and some involve a language model, which is not, and the report says which was which.',
  },
  {
    term: 'Heuristic',
    plain:
      'A rule of thumb that is usually right rather than always right. Where we use one, we say so and we say how sure we are, because a rule of thumb reported as a fact is how a report becomes untrustworthy.',
  },
  {
    term: 'Canonical',
    plain:
      'The one official version of something, written in one agreed way so that two copies can be compared. We use it about the rubric: the same rubric written out in the same order every time, so its fingerprint can be checked.',
  },
  {
    term: 'Idempotent',
    plain:
      'Doing it twice has the same result as doing it once. Running something idempotent again changes nothing, which is what you want from anything that might stop halfway through.',
  },
  {
    term: 'Taxonomy',
    plain:
      'A way of sorting things into named groups. Ours sorts findings into areas such as security, privacy and how usable an application is.',
  },
];

export default function GlossaryPage() {
  return (
    <div className="max-w-3xl space-y-10">
      <header className="space-y-4">
        <p className="eyebrow">Plain language</p>
        <h1 className="text-4xl font-bold tracking-tight">What the words mean</h1>
        <p className="text-lg text-muted">
          This site talks about rubrics, criteria, scope and drift. Those are ordinary words in this
          trade and nowhere else, and a page that uses them without explaining them is a page
          written for the people who built it.
        </p>
      </header>

      <InShort lines={IN_SHORT} />

      <dl className="space-y-6">
        {TERMS.map((entry) => (
          <div key={entry.term} className="space-y-1">
            <dt className="text-lg font-semibold">{entry.term}</dt>
            <dd className="text-muted">{entry.plain}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="missing" className="space-y-3 rounded-xl border border-line p-6">
        <h2 id="missing" className="text-lg font-semibold">
          A word that sent you here and is not on the list
        </h2>
        <p className="text-muted">
          That is a fault on our side rather than yours. The list is meant to hold every word on
          this site that is not ordinary English, and a gap in it means a page is using a word we
          never explained. <Link href="/legal">Our contact details are here</Link>.
        </p>
      </section>
    </div>
  );
}
