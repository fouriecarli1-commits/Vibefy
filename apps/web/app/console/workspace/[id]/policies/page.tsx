import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { POLICY_NOTE } from '@vibefycode/policy';
import { ActionForm, Checkbox, Field, Select } from '@/components/action-form';
import { createClient } from '@/lib/supabase/server';
import { deletePolicyProfile, savePolicyProfile } from '../../actions';

export const metadata: Metadata = { title: 'Policy profiles' };

const DIMENSIONS = [
  ['functional_integrity', 'Functional integrity'],
  ['security_posture', 'Security posture'],
  ['data_privacy_practice', 'Data privacy practice'],
  ['practicality_ux', 'Practicality and UX'],
  ['production_readiness', 'Production readiness'],
  ['store_distribution_readiness', 'Store distribution readiness'],
] as const;

export default async function PoliciesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/console/workspace/${id}/policies`);

  const { data: profiles } = await supabase
    .from('policy_profiles')
    .select('*')
    .eq('organisation_id', id)
    .order('created_at');

  return (
    <div className="space-y-10">
      <section className="rounded-xl border border-line bg-surface-muted p-5 text-sm">
        <h2 className="font-semibold text-ink">What a policy profile is</h2>
        <p className="mt-2 text-muted">{POLICY_NOTE}</p>
      </section>

      {(profiles ?? []).length > 0 && (
        <section aria-labelledby="existing" className="space-y-4">
          <h2 id="existing" className="text-xl font-semibold">
            Your profiles
          </h2>
          <ul className="space-y-3">
            {(profiles ?? []).map((profile) => (
              <li key={profile.id as string} className="rounded-xl border border-line p-5 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="font-medium">{String(profile.name)}</span>
                  <span className="text-muted">{profile.is_default ? 'default' : ''}</span>
                </div>
                {profile.description && <p className="mt-1 text-muted">{String(profile.description)}</p>}
                <ul className="mt-3 list-disc space-y-1 pl-5 text-muted">
                  {profile.min_overall_score !== null && (
                    <li>Minimum overall score {Number(profile.min_overall_score).toFixed(1)}</li>
                  )}
                  {Object.entries((profile.dimension_floors ?? {}) as Record<string, number>).map(
                    ([dimension, floor]) => (
                      <li key={dimension}>
                        {dimension.replace(/_/g, ' ')} at or above {floor}
                      </li>
                    ),
                  )}
                  {profile.max_open_severity && (
                    <li>No open finding worse than {String(profile.max_open_severity)}</li>
                  )}
                  {profile.require_certification && <li>Must meet the rubric’s certification requirements</li>}
                  {profile.require_store_readiness && <li>Must be assessed for store distribution</li>}
                </ul>
                <div className="mt-4">
                  <ActionForm action={deletePolicyProfile} submitLabel="Delete profile" destructive>
                    <input type="hidden" name="profileId" value={profile.id as string} />
                    <input type="hidden" name="organisationId" value={id} />
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="new" className="space-y-4">
        <h2 id="new" className="text-xl font-semibold">
          Add a profile
        </h2>
        <div className="rounded-xl border border-line p-5">
          <ActionForm action={savePolicyProfile} submitLabel="Save profile">
            <input type="hidden" name="organisationId" value={id} />
            <Field label="Name" name="name" required placeholder="Internal release bar" />
            <Field
              label="Description"
              name="description"
              multiline
              hint="Written for the engineer whose application is measured against it."
            />
            <Field
              label="Minimum overall score"
              name="minOverallScore"
              type="number"
              hint="Leave blank for no overall minimum. The rubric certifies at 70; you may require more, never less of it."
            />
            {DIMENSIONS.map(([value, label]) => (
              <Field
                key={value}
                label={`${label} floor`}
                name={`floor_${value}`}
                type="number"
                hint="Blank means this dimension has no floor in this profile."
              />
            ))}
            <Select
              label="Worst open finding permitted"
              name="maxOpenSeverity"
              defaultValue=""
              options={[
                { value: '', label: 'No limit' },
                { value: 'info', label: 'Informational only' },
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ]}
            />
            <Checkbox
              name="requireCertification"
              label="Require the rubric’s certification requirements to be met"
            />
            <Checkbox name="requireStoreReadiness" label="Require store distribution readiness" />
            <Checkbox
              name="isDefault"
              label="Use as the default for new applications in this workspace"
            />
          </ActionForm>
        </div>
      </section>
    </div>
  );
}
