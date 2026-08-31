import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Get your game tested',
  description:
    'A VibefyCode assessment for games: whether it becomes playable, what it downloads first, whether it works on a phone, and whether progress survives. Scope-limited, and it does not judge whether the game is any good.',
};

/**
 * The way in for games.
 *
 * Anré asked for a button specifically for games. The button is the easy half;
 * the half that makes it honest is that it leads somewhere different — a stage
 * that plays the thing, looking for the ways a game built quickly actually
 * fails, which are not the ways a to-do app fails.
 *
 * The page is built around one refusal, stated early rather than buried: we do
 * not say whether a game is any good. Fun, originality, art, difficulty and
 * pacing are matters of taste, they cannot be evidenced, and a scope-limited
 * assessment that starts commenting on them has begun making claims it cannot
 * support. Somebody arriving here hoping for a verdict on their design should
 * find out in the first paragraph, not after paying.
 */
const CHECKED = [
  {
    title: 'Does it become playable at all',
    body: 'Not whether the page loads — whether it reaches a state where input does something. A loading bar that never finishes, a black canvas, a start button that does nothing. This is the single most common way a game built quickly fails, and a check that only asks whether the server answered sees none of it.',
  },
  {
    title: 'What it downloads before you can play',
    body: 'Time from opening the link to playable, and the bytes it took. Authors rarely notice this: their own browser cached everything on the first run, so the version they test is not the version anybody else gets.',
  },
  {
    title: 'Whether it works on a phone',
    body: 'At a 360-pixel-wide viewport, with touch. Does the canvas scale, are there controls a finger can use, is anything required that only a keyboard can do. Being desktop-only is not a defect. Being desktop-only and saying nothing is.',
  },
  {
    title: 'Whether progress survives',
    body: 'Reload mid-play. If there is a score, a level or a save, is it still there — and still there after a second reload. Silent save loss is only ever discovered by a player who has already lost something.',
  },
  {
    title: 'What happens in a background tab',
    body: 'Switch away and back. Does it pause, keep running, or return broken. A game that runs its loop at full rate in a tab nobody is looking at is spending somebody else’s battery.',
  },
  {
    title: 'Errors during play, not only on load',
    body: 'Console errors that appear on the third input rather than the first are the ones that reach players. So we play for a while rather than loading the page and leaving.',
  },
];

const NOT_CHECKED = [
  'Whether the game is fun.',
  'Whether it is original, or how it compares to anything else.',
  'Whether the art, music or writing is good.',
  'Whether the difficulty or the pacing is right.',
  'Whether anybody will play it.',
  'Multiplayer behaviour beyond what a single client can show, and anti-cheat.',
];

export default function GamesPage() {
  return (
    <div className="max-w-3xl space-y-12">
      <header className="space-y-4">
        <p className="eyebrow">For games</p>
        <h1 className="text-4xl font-bold tracking-tight">Get your game tested</h1>
        <p className="max-w-prose text-lg text-muted">
          The same assessment, plus a pass that plays it. A game fails in ways a to-do application
          does not, and the general checks do not go looking for them: the loading bar that never
          finishes, the forty megabytes before anything happens, the controls no finger can reach,
          the save that quietly disappears.
        </p>
        <p className="flex flex-wrap gap-4 text-sm">
          <Link href="/console/apps/new?kind=game" className="nav-cta">
            Submit your game
          </Link>
          <Link href="/how-it-works" className="self-center">
            What happens to your game
          </Link>
          <Link href="/methodology" className="self-center">
            How it is scored
          </Link>
        </p>
      </header>

      {/* Second, and before the list of what we do check. Somebody hoping for a
          verdict on their design should find that out here rather than after
          paying for a report that carefully declines to give one. */}
      <section
        aria-labelledby="not-a-review"
        className="space-y-3 rounded-xl border border-line-strong p-6"
      >
        <h2 id="not-a-review" className="text-xl font-semibold">
          This is not a review
        </h2>
        <p className="max-w-prose text-muted">
          We do not say whether your game is any good. Not fun, not original, not pretty, not well
          balanced. Those are matters of taste, nobody can evidence them, and an assessment that
          started handing out opinions on them would be worth less on everything else it says. What
          you get is a record of how the thing behaves when somebody opens it.
        </p>
        <ul className="max-w-prose list-disc space-y-1 pl-5 text-sm text-muted">
          {NOT_CHECKED.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="checked" className="space-y-5">
        <h2 id="checked" className="text-2xl font-bold tracking-tight">
          What the game pass looks at
        </h2>
        <ul className="space-y-5">
          {CHECKED.map((item) => (
            <li key={item.title} className="panel space-y-2">
              <h3 className="font-semibold">{item.title}</h3>
              <p className="max-w-prose text-sm text-muted">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="same-rubric" className="space-y-3">
        <h2 id="same-rubric" className="text-2xl font-bold tracking-tight">
          Scored against the same rubric
        </h2>
        <p className="max-w-prose text-muted">
          A game is not marked on a different scale. Everything found here is scored against the
          same <Link href="/methodology">published rubric</Link> as every other assessment — a game
          that never becomes playable fails the criterion about a primary journey completing,
          exactly as an application that never completes its own does. There is no separate game
          score, no game badge, and no easier pass mark.
        </p>
        <p className="max-w-prose text-sm text-muted">
          A few things specific to games — age ratings, purchase disclosure, which input devices are
          supported — have no criterion in the rubric version we publish today. They are recorded as
          observations and named as unscored, rather than folded into the nearest criterion that
          almost fits.
        </p>
      </section>

      <section aria-labelledby="start" className="space-y-3 rounded-xl border border-line p-6">
        <h2 id="start" className="text-lg font-semibold">
          Before anything runs
        </h2>
        <p className="max-w-prose text-muted">
          You prove you are entitled to authorise testing of the game, and you say what is in scope.
          Nothing is opened before that — not for a game, not for anything.{' '}
          <Link href="/how-it-works">The whole sequence is written out here</Link>.
        </p>
        <p>
          <Link href="/console/apps/new?kind=game" className="nav-cta">
            Submit your game
          </Link>
        </p>
      </section>
    </div>
  );
}
