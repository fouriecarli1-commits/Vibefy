import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { assembleReportSource, renderReport } from '@vibefycode/report';
import { resolvePlan } from '@vibefycode/billing';
import { ActionForm, Field } from '@/components/action-form';
import { submitAppeal } from '@/app/console/privacy/actions';
import { ReportCopilot } from '@/components/report-copilot';
import { createClient } from '@/lib/supabase/server';
import { readAsUser } from '@/lib/sql';

export const metadata: Metadata = { title: 'Report' };

/**
 * The report, on screen.
 *
 * Rendered from the same assembly the PDF uses, under the caller's own
 * row-level-security identity — so a customer sees their own report and nobody
 * else's, by construction rather than by a WHERE clause we remembered to write.
 *
 * The tier decides what is shown. It never decides what was scored.
 */
export default async function ReportPage({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  const { assessmentId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/console/reports/${assessmentId}`);

  const page = await readAsUser(user.id, async (client) => {
    const context = await client.query<{ organisation_id: string; app_id: string; status: string }>(
      'select organisation_id, app_id, status from public.assessments where id = $1',
      [assessmentId],
    );
    const row = context.rows[0];
    if (!row) return null;

    const plan = await resolvePlan(client, {
      organisationId: row.organisation_id,
      appId: row.app_id,
    });
    const source = await assembleReportSource(client, assessmentId);
    return { source, plan, status: row.status };
  });

  if (!page) notFound();

  const { data: appeals } = await supabase
    .from('appeals')
    .select('id, status, resolution, due_at, created_at')
    .eq('assessment_id', assessmentId)
    .order('created_at', { ascending: false });

  if (page.status !== 'approved' && page.status !== 'published') {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Report not ready</h1>
        <p className="text-muted">
          This assessment is {page.status.replace(/_/g, ' ')}. Nothing is published until a human
          reviewer has approved it — AI never certifies alone, and that includes publishing.
        </p>
        <Link href="/console">Back to the console</Link>
      </div>
    );
  }

  const rendered = renderReport(page.source, page.plan.entitlement.reportTier);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{page.plan.because}</p>
          <h1 className="text-2xl font-bold tracking-tight">Assessment report</h1>
        </div>
        {page.plan.entitlement.pdfExport ? (
          <a
            href={`/console/reports/${assessmentId}/pdf`}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent"
          >
            Download PDF
          </a>
        ) : (
          <Link
            href={`/console/billing?app=${page.source.assessmentId}`}
            className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium"
          >
            Get the full report
          </Link>
        )}
      </div>

      {rendered.withheld.length > 0 && (
        <section
          aria-labelledby="withheld"
          className="rounded-xl border border-line bg-surface-muted p-5"
        >
          <h2 id="withheld" className="font-semibold">
            You are reading the free report
          </h2>
          <p className="mt-2 text-sm text-muted">The full report adds:</p>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {rendered.withheld.map((item) => (
              <li key={item}>· {item}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm">
            Your score is the same either way. Payment buys depth, evidence and support — never a
            different number.
          </p>
        </section>
      )}

      <section aria-labelledby="appeal" className="rounded-xl border border-line p-5">
        <h2 id="appeal" className="font-semibold">
          Disagree with something here?
        </h2>
        <p className="mt-2 max-w-prose text-sm text-muted">
          Appeal it. A reviewer who did not work on this assessment answers within fourteen days, in
          writing, whether the appeal succeeds or not. Read the{' '}
          <Link href="/legal/appeals-and-corrections">appeals policy</Link> — it is a draft, and it
          is what we hold ourselves to. Appealing costs nothing and cannot lower your score.
        </p>
        {appeals && appeals.length > 0 && (
          <ul className="mt-4 space-y-2 text-sm">
            {appeals.map((appeal) => (
              <li key={appeal.id as string} className="rounded-lg border border-line p-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <span className="font-medium">{String(appeal.status).replace(/_/g, ' ')}</span>
                  <span className="text-muted">
                    due {new Date(appeal.due_at as string).toISOString().slice(0, 10)}
                  </span>
                </div>
                {appeal.resolution && (
                  <p className="mt-2 text-muted">{String(appeal.resolution)}</p>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5">
          <ActionForm action={submitAppeal} submitLabel="Submit an appeal">
            <input type="hidden" name="assessmentId" value={assessmentId} />
            <Field
              label="Grounds"
              name="grounds"
              multiline
              hint="What is wrong, and why. A few sentences — an appeal we cannot understand is one we cannot answer properly."
            />
          </ActionForm>
        </div>
      </section>

      {/* Above the report rather than below it. Somebody who has read the whole
          document and still has a question has already decided nobody will
          answer it. */}
      <ReportCopilot assessmentId={assessmentId} />

      {/* The report document is generated by us from our own data and is escaped
          at render time; it is not customer-supplied markup. */}
      <iframe
        title={rendered.title}
        srcDoc={rendered.html}
        className="h-[80vh] w-full rounded-xl border border-line bg-surface"
      />
    </div>
  );
}
