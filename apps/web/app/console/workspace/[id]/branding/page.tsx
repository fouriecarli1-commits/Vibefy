import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ActionForm, Field } from '@/components/action-form';
import { createClient } from '@/lib/supabase/server';
import { saveBranding } from '../../actions';

export const metadata: Metadata = { title: 'Report branding' };

export default async function BrandingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/console/workspace/${id}/branding`);

  const { data: branding } = await supabase
    .from('workspace_branding')
    .select('*')
    .eq('organisation_id', id)
    .maybeSingle();

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-line bg-surface-muted p-5 text-sm">
        <h2 className="font-semibold text-ink">What white-label means here</h2>
        <p className="mt-2 text-muted">
          Your cover block goes on reports you hand to your clients: your name, your logo, your
          contact line. What it does not do is change who performed the assessment. Every report
          still states that VibefyCode carried out the work against the published rubric, and that you
          did not score the application and cannot change what it scored. The VibefyCode marks in the
          document are the supplied marks, unaltered.
        </p>
        <p className="mt-2 text-muted">
          Your accent colour is used only where it is legible on the report’s background. If it is
          not, we fall back to the report’s own text colour — we will not publish a document that
          fails the accessibility standard we score other people against.
        </p>
      </section>

      <div className="rounded-xl border border-line p-5">
        <ActionForm action={saveBranding} submitLabel="Save branding">
          <input type="hidden" name="organisationId" value={id} />
          <Field
            label="Display name"
            name="displayName"
            required
            defaultValue={String(branding?.display_name ?? '')}
          />
          <Field
            label="Accent colour"
            name="accentColour"
            placeholder="#1F4FD8"
            defaultValue={String(branding?.accent_colour ?? '')}
            hint="Six-digit hex. Checked for contrast before it is used."
          />
          <Field
            label="Contact line"
            name="contactLine"
            defaultValue={String(branding?.contact_line ?? '')}
            hint="How your client reaches you about this report."
          />
          <Field
            label="Footer note"
            name="footerNote"
            multiline
            defaultValue={String(branding?.footer_note ?? '')}
          />
          <div className="space-y-1.5">
            <label htmlFor="field-logo" className="block text-sm font-medium">
              Logo
            </label>
            <input
              id="field-logo"
              name="logo"
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              aria-describedby="field-logo-hint"
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2"
            />
            <p id="field-logo-hint" className="text-sm text-muted">
              PNG, JPEG or SVG, under 128 KB. It is embedded in the PDF, which has to render with no
              network at all.
            </p>
          </div>
        </ActionForm>
      </div>
    </div>
  );
}
