import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { loadPublishedKeys, publicKeyFromJwk } from '@vibefycode/badge';
import { providerLabel } from '@vibefycode/shared';
import { enabledProviders } from '@/lib/providers-enabled';
import { lookUpBadgeVerification } from '@/lib/badge-verification';
import { whatIsWrongWithTheConnectionString, whyTheDatabaseRefused } from '@/lib/connection-string';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'What is wrong' };

/**
 * Why the badge is not showing, answered inside the product.
 *
 * `docs/DOEN.md` has sent the founder to a Vercel log four times — a private
 * window, a time picker set to Live, a panel three clicks down — to read one
 * sentence this deployment already knows. Every check below is a fact the
 * running server can state about itself, and together they answer the question
 * a grey frame cannot: greyness says "we could not look", and nothing more.
 *
 * Administrators only, and not out of modesty: these sentences name
 * environment variables and connection faults, which is our own plumbing and
 * no customer's business. Nothing here is a secret — no value is printed, only
 * whether it is set and what is wrong with its shape.
 *
 * Read live on every request, because a cached answer to "is the database
 * reachable" is worse than no answer at all.
 */
export const dynamic = 'force-dynamic';

/** An id nothing can ever match, which is the point: the lookup must still answer. */
const NOBODY = 'nonexistent-test-id';

type Tone = 'ok' | 'bad' | 'warn' | 'unknown';

interface Check {
  readonly question: string;
  readonly answer: string;
  readonly tone: Tone;
  /** The next step, where there is one to take. */
  readonly then?: string;
}

const TONE_LABEL: Readonly<Record<Tone, string>> = {
  ok: 'Good',
  bad: 'Broken',
  warn: 'Works, but',
  unknown: 'Cannot tell',
};

/** Whether it is set, and whether its shape is wrong. Never the value. */
function connectionString(): Check {
  const question = 'Is the database connection string set?';
  const raw = process.env.SUPABASE_DB_URL;
  if (!raw) {
    return {
      question,
      answer: 'No. SUPABASE_DB_URL is not set in this deployment.',
      tone: 'bad',
      then: 'Vercel → Settings → Environment Variables → add it, then redeploy. A new value never reaches an existing deployment.',
    };
  }
  const wrong = whatIsWrongWithTheConnectionString(raw);
  return wrong
    ? {
        question,
        answer: `It is set, and it is wrong: ${wrong}`,
        tone: 'bad',
        then: 'Correct the value, then redeploy.',
      }
    : {
        question,
        answer: 'Set, and its shape is right. Whether it answers is the next line.',
        tone: 'ok',
      };
}

/** The public pair the badge's spare route and the sign-in form both need. */
function publicApiKeys(): Check {
  const question = 'Can this deployment reach Supabase over HTTPS?';
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key) {
    return {
      question,
      answer:
        'Both public variables are set, so the badge has a second route and sign-in can work.',
      tone: 'ok',
    };
  }
  const missing = [
    url ? null : 'NEXT_PUBLIC_SUPABASE_URL',
    key ? null : 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ]
    .filter(Boolean)
    .join(' and ');
  return {
    question,
    answer: `No: ${missing} is not set. Nobody can sign in, and the badge has no second route.`,
    tone: 'bad',
    then: 'Supabase → Project Settings → API carries both values. Add them in Vercel, then redeploy.',
  };
}

/**
 * The test `docs/DOEN.md` sends him to a private window for, run here instead.
 *
 * `lookUpBadgeVerification` tries the direct connection and then Supabase's
 * API, and says which one answered — so one call separates the three states a
 * grey frame cannot: the main route works, the spare route is carrying it, or
 * neither answers.
 */
async function badgeLookup(): Promise<Check> {
  const question = 'Can a badge be looked up at all?';
  try {
    const { source } = await lookUpBadgeVerification(NOBODY);
    return source === 'direct'
      ? {
          question,
          answer:
            'Yes, over the direct connection. A badge that exists will render, and an id nothing matches renders as revoked, which is correct.',
          tone: 'ok',
        }
      : {
          question,
          answer:
            'Yes, but only over Supabase’s API. The direct connection did not answer, so the badge is being served by the spare route.',
          tone: 'warn',
          then: 'The badge works meanwhile. SUPABASE_DB_URL still needs fixing: the console, the reports and the worker have no spare route.',
        };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const means = whyTheDatabaseRefused(detail);
    return {
      question,
      answer: `No. Neither route answered: ${detail}${means ? ` — ${means}` : ''}`,
      tone: 'bad',
      then: 'This is the grey frame. Repair whichever of the two lines above is broken, then redeploy.',
    };
  }
}

/** Published so a stranger can check a signature, and never a private key. */
function signingKeys(): Check {
  const question = 'Are the badge signing keys published?';
  const { keys, carriedPrivate, unusable } = loadPublishedKeys();
  if (carriedPrivate.length > 0) {
    return {
      question,
      answer: `A private key was pasted into a public variable (${carriedPrivate.join(', ')}). It is not being published, and it has to be replaced.`,
      tone: 'bad',
      then: 'Run pnpm badge:keygen for a new pair, set the private half on the worker only, and rotate.',
    };
  }
  if (keys.length === 0) {
    return {
      question,
      answer:
        'No. The published key set is empty, so /verify cannot check any badge — and says so rather than calling a real one a forgery.',
      tone: 'bad',
      then: 'Copy the VIBEFYCODE_BADGE_PUBLIC_KEYS line out of the worker’s log into Vercel, then redeploy. docs/DOEN.md section 1c.',
    };
  }
  /*
   * Published, and readable are two questions.
   *
   * `loadPublishedKeys` checks the shape of each entry — `kty`, `crv`, a
   * non-empty `x`, a `kid` — and any non-empty string passes as `x`. A line
   * truncated or wrapped on its way into an environment variable keeps its
   * shape and stops being a key, so the set reads as published while every
   * badge signed with that key is uncheckable.
   *
   * It is built here, which is the only way to know. Until `key_unusable`
   * existed, `/verify` reported exactly this as a signature that did not match
   * — "either the badge was altered, or VibefyCode did not issue it" — about a
   * badge we did issue.
   */
  const unreadable = keys
    .filter((key) => {
      try {
        publicKeyFromJwk(key);
        return false;
      } catch {
        return true;
      }
    })
    .map((key) => key.kid);

  if (unreadable.length > 0) {
    return {
      question,
      answer: `${keys.length} key${keys.length === 1 ? '' : 's'} published, and ${unreadable.length} of them cannot be read as a key (${unreadable.join(', ')}). Any badge naming one of those cannot be checked, and /verify says so rather than calling it a forgery.`,
      tone: 'bad',
      then: 'Paste the VIBEFYCODE_BADGE_PUBLIC_KEYS line into Vercel again, whole and on one line, then redeploy. A character lost in the paste is enough to do this.',
    };
  }

  return {
    question,
    answer: `${keys.length} key${keys.length === 1 ? '' : 's'} published and readable${
      unusable > 0
        ? `, and ${unusable} entr${unusable === 1 ? 'y' : 'ies'} that could not be read`
        : ''
    }.`,
    tone: unusable > 0 ? 'warn' : 'ok',
    ...(unusable > 0
      ? {
          then: 'An unreadable entry is ignored, so a badge signed with that key reads as unknown rather than as genuine.',
        }
      : {}),
  };
}

/**
 * Who can get in, and the one line each provider's own console has to carry.
 *
 * Google answered "Error 400: redirect_uri_mismatch" on 2026-10-18 and the
 * sign-in was dead in the water, which also means this page was unreachable —
 * it needs an administrator. The mismatch is never about this deployment: the
 * address Google is handed is Supabase's own callback, and it has to be in the
 * OAuth client's authorised list in Google Cloud. So the exact string is
 * printed here, for every provider that is on, because the alternative is
 * remembering what it looks like while reading an error page from Google.
 *
 * Not a secret: the project reference is in `NEXT_PUBLIC_SUPABASE_URL`, which
 * ships to every browser by design.
 */
async function signInProviders(): Promise<Check> {
  const question = 'Can anybody sign in?';
  const { enabled, unavailable } = await enabledProviders();
  if (unavailable) {
    return {
      question,
      answer: `Cannot tell which providers are on: ${unavailable}`,
      tone: 'unknown',
      then: 'An email address and a password still work, which is how to reach this page when a provider will not let you in.',
    };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const callback = url ? `${url.replace(/\/+$/, '')}/auth/v1/callback` : null;
  if (enabled.length === 0) {
    return {
      question,
      answer: 'An email address and a password. No social provider is turned on in Supabase.',
      tone: 'ok',
    };
  }

  return {
    question,
    answer: `An email address and a password, and ${enabled.map(providerLabel).join(', ')}.`,
    tone: 'ok',
    ...(callback
      ? {
          then: `Each of those has to list ${callback} as an authorised redirect address in its own console — in Google Cloud under Credentials, for Google. A provider that does not answers the sign-in with "Error 400: redirect_uri_mismatch", which is a setting there and nothing in this deployment. Supabase prints the same string under Authentication → Providers.`,
        }
      : {}),
  };
}

export default async function HealthPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/admin/health');

  const { data: profile } = await supabase
    .from('users')
    .select('platform_role')
    .eq('id', user.id)
    .single();
  if (profile?.platform_role !== 'admin') {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">What is wrong</h1>
        <p className="text-muted">
          This page is for VibefyCode administrators. It describes our own plumbing, which is no
          customer’s business.
        </p>
      </div>
    );
  }

  /*
   * And whether there is a badge to look at.
   *
   * "The badge is not showing" has two causes that look identical from
   * outside: the route cannot answer, or nothing has ever been issued. The
   * counts answer the second, read as the signed-in administrator under
   * row-level security — so a number this page cannot see is reported as that,
   * rather than as a zero, which would read as "nothing exists".
   */
  const { count: badgeCount, error: badgeError } = await supabase
    .from('badges')
    .select('id', { count: 'exact', head: true });
  const { count: approvedCount, error: approvedError } = await supabase
    .from('assessments')
    .select('id', { count: 'exact', head: true })
    .in('status', ['approved', 'published']);
  const { count: appCount, error: appError } = await supabase
    .from('apps')
    .select('id', { count: 'exact', head: true })
    .is('archived_at', null);

  const seen = (count: number | null, error: { message: string } | null) =>
    error ? `cannot tell (${error.message})` : String(count ?? 0);

  const badges = badgeCount ?? 0;
  const checks: Check[] = [
    connectionString(),
    publicApiKeys(),
    await signInProviders(),
    await badgeLookup(),
    signingKeys(),
    {
      question: 'Is there a badge to look at?',
      answer: badgeError
        ? `Cannot tell: ${badgeError.message}`
        : badges > 0
          ? `${badges} badge row${badges === 1 ? '' : 's'} exist.`
          : 'None. No badge has ever been issued, so there is nothing for the image route to render — whatever the lines above say.',
      tone: badgeError ? 'unknown' : badges > 0 ? 'ok' : 'bad',
      ...(badges > 0 || badgeError
        ? {}
        : {
            then: `A badge needs an approved assessment that is certification-eligible, an accepted badge licence, and a plan that is not free. Approved assessments so far: ${seen(approvedCount, approvedError)}. Applications: ${seen(appCount, appError)}.`,
          }),
    },
  ];

  return (
    <div className="max-w-3xl space-y-8">
      <header className="space-y-2">
        <p className="eyebrow">Administrators</p>
        <h1 className="text-3xl font-bold tracking-tight">What is wrong</h1>
        <p className="max-w-prose text-muted">
          Read live, on this request. Every line is something this deployment can say about itself —
          the questions that otherwise mean a private window, a log and a time picker. No value of
          any variable is printed here; only whether it is set, and what is wrong with its shape.
        </p>
      </header>

      <ul className="space-y-4">
        {checks.map((check) => (
          <li key={check.question} className="rounded-xl border border-line p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="font-semibold">{check.question}</h2>
              <span
                className="chip"
                data-tone={check.tone === 'ok' ? 'ok' : check.tone === 'bad' ? 'bad' : 'warn'}
              >
                {TONE_LABEL[check.tone]}
              </span>
            </div>
            <p className="mt-2 text-sm">{check.answer}</p>
            {check.then && <p className="mt-2 text-sm text-muted">{check.then}</p>}
          </li>
        ))}
      </ul>

      <p className="text-sm text-muted">
        The badge image itself is at <code>/badge/{NOBODY}.svg</code>. With the lines above good it
        renders as a revoked badge rather than a grey frame: an id nothing matches is not verified,
        and saying so is the honest answer. See also{' '}
        <Link href="/verify">the checker a stranger uses</Link>.
      </p>
    </div>
  );
}
