import { NextResponse, type NextRequest } from 'next/server';
import { resolvePlan } from '@vibefycode/billing';
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
 *
 * They come out of the `reports` row rather than off a disk. The worker runs on
 * Render and this runs on Vercel; they share this database and nothing else, so
 * for as long as the bytes lived in a container directory every one of these
 * requests answered 410.
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
    const report = await client.query<{ sha256: string; content: Buffer | null }>(
      `select sha256, content from public.reports where assessment_id = $1 and format = 'pdf'`,
      [assessmentId],
    );
    // Whether the caller is staff. The entitlement below governs what a customer
    // has bought; it has nothing to say about whether we may keep a copy of an
    // assessment we performed.
    const staff = await client.query<{ role: string }>(
      'select platform_role as role from public.users where id = $1',
      [user.id],
    );
    return {
      plan,
      status: row.status,
      report: report.rows[0] ?? null,
      isStaff: ['reviewer', 'admin'].includes(String(staff.rows[0]?.role)),
    };
  });

  if (!context) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (context.status !== 'approved' && context.status !== 'published') {
    return NextResponse.json(
      { error: 'This assessment has not been reviewed yet.' },
      { status: 409 },
    );
  }
  // A reviewer and an operator can always take a copy. Gating our own records
  // on what the customer bought would mean the platform could not produce the
  // report it wrote when somebody later disputes it.
  if (!context.isStaff && !context.plan.entitlement.pdfExport) {
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

  const bytes = context.report.content;
  if (!bytes || bytes.byteLength === 0) {
    return NextResponse.json(
      {
        error:
          'This report was generated before reports were stored in the database, and its bytes are gone. Re-running the assessment produces a new one.',
      },
      { status: 410 },
    );
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="vibefycode-report-${assessmentId.slice(0, 8)}.pdf"`,
      'cache-control': 'private, no-store',
      // The hash is published so a recipient can check the file they were given
      // is the file we generated.
      'x-vibefycode-report-sha256': context.report.sha256,
    },
  });
}
