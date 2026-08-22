import { NextResponse, type NextRequest } from 'next/server';
import { resolvePlan } from '@vibefy/billing';
import { resolveReportStorage } from '@vibefy/worker';
import { createClient } from '@/lib/supabase/server';
import { readAsUser } from '@/lib/sql';

/**
 * PDF download.
 *
 * The entitlement is checked here, on the server, rather than by hiding the
 * button: a link is not an access control.
 *
 * The bytes are the ones the worker rendered and stored, not a fresh render.
 * A downloaded PDF is a record — if the console re-rendered it on every request,
 * two copies of "the same" report could differ, and the one the customer showed
 * an investor would be the one nobody could reproduce.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ assessmentId: string }> },
) {
  const { assessmentId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const context = await readAsUser(user.id, async (client) => {
    const assessment = await client.query<{
      organisation_id: string;
      app_id: string;
      status: string;
    }>('select organisation_id, app_id, status from public.assessments where id = $1', [
      assessmentId,
    ]);
    const row = assessment.rows[0];
    if (!row) return null;

    const plan = await resolvePlan(client, {
      organisationId: row.organisation_id,
      appId: row.app_id,
    });
    const report = await client.query<{ storage_path: string; sha256: string }>(
      `select storage_path, sha256 from public.reports where assessment_id = $1 and format = 'pdf'`,
      [assessmentId],
    );
    return { plan, status: row.status, report: report.rows[0] ?? null };
  });

  if (!context) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (context.status !== 'approved' && context.status !== 'published') {
    return NextResponse.json(
      { error: 'This assessment has not been reviewed yet.' },
      { status: 409 },
    );
  }
  if (!context.plan.entitlement.pdfExport) {
    return NextResponse.json(
      { error: 'PDF export is part of the paid report. Your score is unaffected either way.' },
      { status: 402 },
    );
  }
  if (!context.report) {
    return NextResponse.json(
      { error: 'The PDF is still being prepared. It is generated once, after review, and stored.' },
      { status: 409 },
    );
  }

  const bytes = await resolveReportStorage().get(context.report.storage_path);
  if (!bytes) {
    return NextResponse.json({ error: 'The stored report could not be read.' }, { status: 410 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="vibefy-report-${assessmentId.slice(0, 8)}.pdf"`,
      'cache-control': 'private, no-store',
      // The hash is published so a recipient can check the file they were given
      // is the file we generated.
      'x-vibefy-report-sha256': context.report.sha256,
    },
  });
}
