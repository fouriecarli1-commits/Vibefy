import type { Metadata } from 'next';
import Link from 'next/link';
import { InShort } from '@/components/in-short';

export const metadata: Metadata = {
  title: 'What we do',
  description:
    'Everything VibefyCode offers, in plain words: get an application assessed, get a game tested, keep a badge watched, get help fixing what was found, check a badge or an app before you pay, and advertise on a quiet site.',
};

/** The plain-language summary, in the shape `tests/plain-language.test.ts` holds. */
const IN_SHORT = [
  'Some of what we do is for the person who built an app.',
  'The rest is for the person who is about to use one.',
  'Each service below says what it is for, and what it will not do.',
];

/**
 * The page that says what we sell.
 *
 * There was no such page. Every service had one of its own, and the only way to
 * find out the list existed was to open a menu and read eight links, each of
 * which assumed you already knew which one was for you. Somebody who lands here
 * from a badge, or from a search, has one question — what do you actually do —
 * and they were being answered in fragments.
 *
 * Written for that person, not for us. Short sentences. No jargon that is not
 * explained where it is used. Each service says what it is, who it is for, what
 * you get at the end, and what it will not do, in that order, because the last
 * one is what people find out too late everywhere else.
 *
 * The grouping is by who is asking, not by what we built. Somebody about to pay
 * for a subscription and somebody who built an application have almost nothing
 * in common, and a single list makes each of them read the other's half.
 */

interface Service {
  readonly href: string;
  readonly name: string;
  readonly what: string;
  readonly who: string;
  readonly get: string;
  readonly not: string;
  readonly cta: string;
}

const FOR_BUILDERS: readonly Service[] = [
  {
    href: '/pre-flight',
    name: 'Check your own app, free',
    what: 'Paste your own address and see what a stranger would find in ten seconds: whether it is encrypted, whether it works on a phone, whether anything is in the page source that should not be, whether anybody can reach you.',
    who: 'You are about to show somebody what you built, and you would rather find the obvious things yourself.',
    get: 'A list of what to go and fix, each with the evidence and a next step. No account, and nothing kept afterwards.',
    not: 'It is not an assessment and it earns no badge. It loads one page, once, exactly as a browser would, and there is no score at the end on purpose.',
    cta: 'Check your own app',
  },
  {
    href: '/how-it-works',
    name: 'Get your application assessed',
    what: 'We open your application from outside, the way a stranger would, and work through it against a rubric we publish in full. A person reviews what came back before anything is issued.',
    who: 'You built something — quickly, probably with AI — and you need somebody other than you to say what state it is in.',
    get: 'A report you can read and hand to somebody else, a score against each part of the rubric, and, if it clears the mark, a badge for your own site that links back to the evidence.',
    not: 'It is not a penetration test, a code audit, or any kind of legal certification. It says what was found, on a date, within the scope you authorised.',
    cta: 'See what happens to your app',
  },
  {
    href: '/games',
    name: 'Get your game tested',
    what: 'The same assessment plus a pass that actually plays the thing: does it become playable, what does it download first, does it work on a phone, does progress survive a reload.',
    who: 'You made a browser game. The usual checks ask whether the server answered, which tells you nothing about a loading bar that never finishes.',
    get: 'The same report and the same badge, with a section on how the game behaved when somebody opened it and played for a while.',
    not: 'We do not say whether your game is any good. Not fun, not original, not pretty. Those are matters of taste and nobody can evidence them.',
    cta: 'What the game pass looks at',
  },
  {
    href: '/how-it-works',
    name: 'Keep it watched after the badge',
    what: 'An application changes. We re-check yours on a schedule, and if what made it pass stops being true, the badge is suspended and you are told why before anybody else notices.',
    who: 'Anybody whose badge is on a live site. A mark that was earned eight months ago and never looked at again is worth very little.',
    get: 'Alerts when something material changes, when the application stops answering, and when the rubric it was measured against is superseded.',
    not: 'It does not watch continuously, and it is not monitoring for an outage. It is a re-check, on a schedule, of the things the badge stands on.',
    cta: 'How re-assessment works',
  },
  {
    href: '/services/remediation',
    name: 'Get help fixing what was found',
    what: 'A fixed-scope engagement to repair the findings. We tell you the conflict before you ask: a company that rates applications and also sells repairs has an obvious reason to find more to repair.',
    who: 'You have a report, you know what is wrong, and you would rather not spend three weekends on it.',
    get: 'The work done, and a re-assessment afterwards by a reviewer who had nothing to do with the repair.',
    not: 'Buying this cannot change a score, move you up the directory, or shorten a queue. Nothing you pay for can.',
    cta: 'The service, and its conflict',
  },
  {
    href: '/directory',
    name: 'Be listed where people are looking',
    what: 'Applications with a live badge appear in a public directory, ordered by what the rubric found and nothing else.',
    who: 'Anybody who has earned a badge and would like to be found.',
    get: 'A listing, with your score and the date it was measured, that a stranger can sort and filter.',
    not: 'The order cannot be bought. There is no promoted slot, no boost, and the ordering rule is published on the page itself.',
    cta: 'See the directory',
  },
];

const FOR_EVERYONE_ELSE: readonly Service[] = [
  {
    href: '/verify',
    name: 'Check a badge you found',
    what: 'Paste the address of a site carrying our mark, or open the badge itself, and see what the mark actually covers — when it was assessed, against which version of the rubric, and whether it is still live.',
    who: 'You are about to trust an application because it carries a mark, and you would like to know what the mark means.',
    get: 'The assessment behind the badge, a plain-language list of what was checked and what was not, and the date it stops being current.',
    not: 'A live badge does not mean an application has no defects. It means it was assessed, on a date, and met a published threshold.',
    cta: 'Check a badge',
  },
  {
    href: '/trust-check',
    name: 'Check an app before you pay',
    what: 'A free look at one public page of any application, from outside: can a person be reached, is there a way to cancel, does it say what it does with your data.',
    who: 'You are about to hand over a card to something you found yesterday.',
    get: 'An answer in under a minute, with the evidence for each part of it, and nothing kept afterwards.',
    not: 'It is not an assessment and it earns nobody a badge. It looks at one page, from outside, at a single moment.',
    cta: 'Check an app',
  },
  {
    href: '/methodology',
    name: 'Read the rubric yourself',
    what: 'Every criterion, every weight, every threshold, published in full and versioned. A score you cannot check is a number somebody asked you to believe.',
    who: 'Anybody deciding whether our opinion is worth anything.',
    get: 'The whole rubric, the version history, and the rule that a badge stays measured against the version it was earned under.',
    not: 'Reading it will not tell you how any particular application scored. That is on that application’s own verification page.',
    cta: 'Read the rubric',
  },
  {
    href: '/advertise',
    name: 'Reach people who build things',
    what: 'One advertising space, on a deliberately quiet site, read by people who are shipping software.',
    who: 'You sell something builders use, and you would rather not be the fourth banner on a page.',
    get: 'A single placement, clearly marked as paid, with the rate published.',
    not: 'It cannot buy a score, a listing position, a badge, or a mention in any report. The wall between what we sell and what we assess is the whole product.',
    cta: 'What the space is, and what it is not',
  },
];

/** Things inside an assessment that people are surprised to learn we look at. */
const ALSO_INCLUDED: readonly { title: string; body: string }[] = [
  {
    title: 'How hard it is to leave',
    body: 'Every review of every subscription tells you how good it is to join. We measure the other end: how many clicks from the front page to a way out, whether you can do it yourself, and how that compares with how easy it was to start. It has its own rating and its own percentage, and it moves no score.',
  },
  {
    title: 'Whether the page holds together',
    body: 'How many type sizes are on a page, how many of the spacings fall on no scale, whether blocks start a few pixels off each other. None of it is an opinion about taste, and all of it is why a page can feel unfinished to somebody who cannot say why.',
  },
  {
    title: 'Whether anybody can use it',
    body: 'An automated accessibility pass against WCAG 2.2 AA. We run the same one against our own pages on every build, because it is hard to sell an accessibility score from an inaccessible site.',
  },
  {
    title: 'A draft accessibility statement, written from what was found',
    body: 'Every larger company publishes one and every small one knows it should. Most are written from a template, which is why so many claim conformance with a standard nobody checked them against. Yours is assembled from the barriers an assessment actually found, with the sections only you can answer — how somebody reports a problem, what happens if you do not answer, when you will fix things — left visibly empty rather than invented.',
  },
  {
    title: 'Where a card number goes',
    body: 'Whether payment details are typed into a page the merchant controls or handed to a processor. Whether the application asks for more personal data than it explains. Whether anything on the page is a known cryptominer.',
  },
];

function ServiceCard({ service }: { service: Service }) {
  return (
    <li className="panel space-y-3">
      <h3 className="text-lg font-semibold">
        <Link href={service.href}>{service.name}</Link>
      </h3>
      <p className="max-w-prose">{service.what}</p>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="space-y-1">
          <dt className="eyebrow">Who it is for</dt>
          <dd className="text-muted">{service.who}</dd>
        </div>
        <div className="space-y-1">
          <dt className="eyebrow">What you get</dt>
          <dd className="text-muted">{service.get}</dd>
        </div>
        <div className="space-y-1">
          <dt className="eyebrow">What it is not</dt>
          <dd className="text-muted">{service.not}</dd>
        </div>
      </dl>
      <p className="text-sm">
        <Link href={service.href}>{service.cta}</Link>
      </p>
    </li>
  );
}

export default function ServicesPage() {
  return (
    <div className="space-y-12">
      <header className="max-w-3xl space-y-4">
        <p className="eyebrow">What we do</p>
        <h1 className="text-4xl font-bold tracking-tight">Everything we offer, in plain words</h1>
        <p className="text-lg text-muted">
          VibefyCode assesses applications that were built fast — usually with AI — and publishes
          what it found. Some of what we do is for the person who built something. The rest is for
          the person about to use it. Each one below says what it is, who it is for, what you end up
          with, and what it will not do.
        </p>
        <p className="flex flex-wrap gap-4 text-sm">
          <Link href="/sign-up" className="nav-cta">
            Create an account
          </Link>
          <Link href="/verify" className="self-center">
            Check a badge instead
          </Link>
        </p>
      </header>

      <InShort lines={IN_SHORT} />

      <section aria-labelledby="builders" className="space-y-5">
        <h2 id="builders" className="text-2xl font-bold tracking-tight">
          If you built something
        </h2>
        <ul className="space-y-5">
          {FOR_BUILDERS.map((service) => (
            <ServiceCard key={service.name} service={service} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="also" className="max-w-3xl space-y-5">
        <h2 id="also" className="text-2xl font-bold tracking-tight">
          {ALSO_INCLUDED.length} things in every assessment that people do not expect
        </h2>
        <p className="text-muted">
          These are part of an assessment rather than separate products. They are listed because
          nobody goes looking for them, and they are often the part that turns out to matter.
        </p>
        <ul className="space-y-4">
          {ALSO_INCLUDED.map((item) => (
            <li key={item.title} className="space-y-1 rounded-xl border border-line p-5">
              <h3 className="font-semibold">{item.title}</h3>
              <p className="text-sm text-muted">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="everyone" className="space-y-5">
        <h2 id="everyone" className="text-2xl font-bold tracking-tight">
          If you are about to use something
        </h2>
        <ul className="space-y-5">
          {FOR_EVERYONE_ELSE.map((service) => (
            <ServiceCard key={service.name} service={service} />
          ))}
        </ul>
      </section>

      {/* Last, and deliberately. A list of services reads as a list of promises
          unless the limits are on the same page, and a reader who finds them
          only in the small print has been told twice — once generously, once
          honestly — which is worse than not saying it at all. */}
      <section
        aria-labelledby="limits"
        className="max-w-3xl space-y-3 rounded-xl border border-line-strong p-6"
      >
        <h2 id="limits" className="text-xl font-semibold">
          What none of this is
        </h2>
        <p className="text-muted">
          Nothing here says an application is safe, and nothing here is a guarantee. An assessment
          is a point-in-time look at a stated scope, by people who are not lawyers and are not
          auditors. It does not certify that an application is free of defects, lawful, or fit for
          any particular purpose.
        </p>
        <p className="text-muted">
          Nothing you pay us can change a score, a badge, a directory position, or the wording of a
          report. That is not a policy we could quietly drop: the scoring code structurally cannot
          read who is paying, and a test fails if it ever can.
        </p>
        <p className="text-sm">
          <Link href="/legal/rating-methodology-and-independence">
            How we keep assessment and money apart
          </Link>
        </p>
      </section>
    </div>
  );
}
