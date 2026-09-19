import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ActionForm, Field } from '@/components/action-form';
import { createClient } from '@/lib/supabase/server';
import { saveTrustPage, setTrustPagePublished } from './actions';

export const metadata: Metadata = { title: 'What you say about yourself' };

/**
 * The half of the verification page that belongs to the customer.
 *
 * A stranger who has just checked a mark usually wants something the
 * assessment cannot tell them: where to write when something goes wrong, where
 * to report a vulnerability, whether the thing is up. Only the owner knows.
 *
 * The page they end up on has to keep the two halves visibly apart, and this
 * form says so before the first field rather than after the last: what you
 * write here appears under your name, with a sentence saying we did not check
 * it. Somebody who expected us to be vouching for it should find that out
 * before they type, not after a reader has assumed we were.
 */
export default async function TrustPageEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/console/apps/${id}/trust`);

  const { data: app } = await supabase
    .from('apps')
    .select('id, name, organisation_id')
    .eq('id', id)
    .single();
  if (!app) notFound();

  const { data: page } = await supabase
    .from('trust_pages')
    .select('contact_email, security_contact, status_url, privacy_url, terms_url, note, published')
    .eq('app_id', id)
    .maybeSingle();

  const { data: badge } = await supabase
    .from('badges')
    .select('slug, status')
    .eq('app_id', id)
    .maybeSingle();

  const value = (name: string) => (page?.[name as keyof typeof page] ?? '') as string;

  return (
    <div className="max-w-3xl space-y-10">
      <header className="space-y-2">
        <p className="text-sm text-muted">
          <Link href="/console">Console</Link> ·{' '}
          <Link href={`/console/apps/${id}`}>{String(app.name)}</Link> · What you say
        </p>
        <h1 className="text-3xl font-bold tracking-tight">What you say about yourself</h1>
        <p className="max-w-prose text-muted">
          Somebody who has just checked your mark usually wants something the assessment cannot tell
          them: where to write when something goes wrong, who to tell about a security problem,
          whether the service is up. Only you know those.
        </p>
      </header>

      {/* Before the fields, not after them. */}
      <section
        aria-labelledby="how-it-appears"
        className="space-y-3 rounded-xl border border-line-strong p-6"
      >
        <h2 id="how-it-appears" className="text-lg font-semibold">
          How this appears to a reader
        </h2>
        <p className="max-w-prose text-muted">
          In its own section on your verification page, under a heading with your name in it, and
          under a sentence saying that you wrote it and that we have not checked any of it. Your
          score and the assessment are kept visibly apart from it, because a reader who cannot tell
          which half is which has been misled by the layout.
        </p>
        <p className="max-w-prose text-sm text-muted">
          What you write cannot extend the mark. “Verified by VibefyCode” is the whole of what a
          badge says. Anything that adds a word to it, or that claims an assessment proved more than
          it did, is refused here with an explanation of why — the same rule we hold ourselves to on
          every page of this site, applied to your words in the same way.
        </p>
      </section>

      <section aria-labelledby="fields" className="space-y-4 rounded-xl border border-line p-6">
        <h2 id="fields" className="text-lg font-semibold">
          Your details
        </h2>
        <ActionForm action={saveTrustPage} submitLabel="Save">
          <input type="hidden" name="appId" value={id} />
          <input type="hidden" name="organisationId" value={String(app.organisation_id)} />
          <Field
            label="If something goes wrong"
            name="contactEmail"
            defaultValue={value('contact_email')}
            hint="An address a person reads. A no-reply address is not a route."
          />
          <Field
            label="Reporting a vulnerability"
            name="securityContact"
            defaultValue={value('security_contact')}
            hint="A different inbox and a different urgency from support. An address, or a link to how you want it reported."
          />
          <Field
            label="Status page"
            name="statusUrl"
            defaultValue={value('status_url')}
            hint="https:// only."
          />
          <Field
            label="Privacy policy"
            name="privacyUrl"
            defaultValue={value('privacy_url')}
            hint="https:// only."
          />
          <Field
            label="Terms"
            name="termsUrl"
            defaultValue={value('terms_url')}
            hint="https:// only."
          />
          <Field
            label="Anything else a reader should know"
            name="note"
            multiline
            defaultValue={value('note')}
            hint="Up to 400 characters. This is a trust page, not a marketing page — a long one stops being read."
          />
        </ActionForm>
      </section>

      {page && (
        <section aria-labelledby="publish" className="space-y-4 rounded-xl border border-line p-6">
          <h2 id="publish" className="text-lg font-semibold">
            {page.published ? 'It is on your verification page' : 'It is not published'}
          </h2>
          <p className="max-w-prose text-sm text-muted">
            {badge?.slug ? (
              <>
                Your verification page is{' '}
                <Link href={`/a/${String(badge.slug)}`}>/a/{String(badge.slug)}</Link>. Taking this
                down leaves the assessment showing and removes your own words, immediately.
              </>
            ) : (
              'It appears once this application has a live mark. Until then there is no verification page to put it on.'
            )}
          </p>
          <ActionForm
            action={setTrustPagePublished}
            submitLabel={page.published ? 'Take it down' : 'Put it on my verification page'}
          >
            <input type="hidden" name="appId" value={id} />
            <input type="hidden" name="published" value={page.published ? 'false' : 'true'} />
          </ActionForm>
        </section>
      )}
    </div>
  );
}
