import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createApp } from '../actions';
import { ActionForm, Checkbox, Field } from '@/components/action-form';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Submit an application' };

export default async function NewAppPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  // Arrived from the games page, which is the whole point of that page having a
  // button of its own: somebody who came to have a game tested should not have
  // to know that the box halfway down the form is the one that matters.
  const { kind } = await searchParams;
  const isGame = kind === 'game';
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/console/apps/new');

  const { data: memberships } = await supabase
    .from('memberships')
    .select('organisation_id, organisations (name)');

  return (
    <div className="max-w-2xl space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">
          {isGame ? 'Submit a game' : 'Submit an application'}
        </h1>
        <p className="text-muted">
          Nothing is tested yet. Submitting records what the {isGame ? 'game' : 'application'} is;
          the next step is proving you are entitled to authorise testing of it.
        </p>
      </header>

      <ActionForm action={createApp} submitLabel="Submit" pendingLabel="Screening…">
        <div className="space-y-2">
          <label htmlFor="field-organisationId" className="block text-sm font-medium">
            Workspace
          </label>
          <select
            id="field-organisationId"
            name="organisationId"
            required
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2"
          >
            {(memberships ?? []).map((membership, index) => {
              const organisation = membership.organisations as unknown as { name: string } | null;
              return (
                <option
                  key={membership.organisation_id ?? index}
                  value={membership.organisation_id}
                >
                  {organisation?.name ?? 'Workspace'}
                </option>
              );
            })}
          </select>
        </div>

        <Field label="Application name" name="name" required />
        <Field
          label="URL"
          name="primaryUrl"
          type="url"
          required
          placeholder="https://"
          hint="The address a real user would visit. HTTPS only."
        />
        <Field
          label="What does it do?"
          name="description"
          multiline
          required
          hint="A few sentences. This is what the intake screen reads, and a description too thin to judge goes to a human rather than being guessed at."
        />
        <Field
          label="Category"
          name="category"
          placeholder="e.g. productivity, e-commerce, health"
        />
        <Field
          label="Built with"
          name="builder"
          placeholder="Lovable, Bolt, Replit, Cursor, Claude Code, other"
        />
        <Field label="Who is it for?" name="targetAudience" />

        <fieldset className="space-y-3 rounded-xl border border-line p-5">
          <legend className="px-2 text-sm font-medium">What it handles</legend>
          <p className="text-sm text-muted">
            These are claims we go looking to confirm, not facts we take on trust. Answering
            honestly makes the assessment more useful to you.
          </p>
          <Checkbox label="It has sign-up or sign-in" name="hasAuthentication" />
          <Checkbox label="It takes payments" name="hasPayments" />
          <Checkbox label="It processes personal data" name="processesPersonalData" />
          <Checkbox
            label="I intend to submit it to the App Store or Play"
            name="intendedForAppStore"
            hint="Adds the store-readiness pass, checked against published submission requirements."
          />
          <Checkbox
            label="It is a game"
            name="isGame"
            defaultChecked={isGame}
            hint="Adds a pass that plays it: whether it becomes playable at all, what it downloads before it can, whether it works on a phone, and whether progress survives a reload. It does not judge whether the game is any good — that is taste, and taste cannot be evidenced."
          />
        </fieldset>
      </ActionForm>
    </div>
  );
}
