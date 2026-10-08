import { NextResponse } from 'next/server';
import {
  isAuditExportKind,
  recordAuditExport,
  runAuditExport,
  type AuditExportFormat,
} from '@vibefycode/workspace';
import { createClient } from '@/lib/supabase/server';
import { readAsUser, writeAsService, writeAsUser } from '@/lib/sql';

/**
 * Producing an audit export.
 *
 * The rows are read under the caller's own row-level security, so they come
 * back only if they are this workspace's. The record of the disclosure is
 * written on our own connection, and before the file is returned: a file handed
 * over with no record of it having been handed over is the failure mode an
 * audit export exists to avoid.
 *
 * Both halves used to run as the caller, in one transaction, and the authority
 * check was the insert policy — "refused by the insert policy if the caller is
 * not an owner or admin of this workspace, which rolls back the whole
 * transaction, file included". Neat, and it meant `row_count` and `sha256` were
 * written by the party who would later be producing the file in a dispute.
 * `audit-export.ts` says the table is append-only so a file can be checked
 * against it; a digest its holder wrote checks nothing.
 *
 * So the authority check moved here, as the policy's own predicate evaluated
 * against this request's claims, and the record moved to our connection. The
 * transaction is gone, and the order is what replaces it: no record, no file.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; kind: string }> },
) {
  const { id, kind } = await params;
  if (!isAuditExportKind(kind)) {
    return NextResponse.json({ error: 'Unknown export.' }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const url = new URL(request.url);
  const format: AuditExportFormat = url.searchParams.get('format') === 'json' ? 'json' : 'csv';
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  try {
    const mayExport = await readAsUser(user.id, async (client) => {
      const { rows } = await client.query<{ ok: boolean }>(
        `select public.has_org_role($1, array['owner', 'admin']::public.org_role[]) as ok`,
        [id],
      );
      return rows[0]?.ok === true;
    });
    if (!mayExport) {
      return NextResponse.json(
        {
          error:
            'Only an owner or admin of this workspace can produce an audit export, and every export is recorded.',
        },
        { status: 403 },
      );
    }

    const result = await writeAsUser(user.id, async (client) =>
      runAuditExport(client, {
        organisationId: id,
        kind,
        format,
        periodStart: from ? new Date(from) : null,
        periodEnd: to ? new Date(to) : null,
      }),
    );

    // Before the file, not after: the record is what makes the disclosure
    // accountable, so a failure here is a failure to export.
    await writeAsService(async (client) => {
      await recordAuditExport(client, {
        organisationId: id,
        requestedBy: user.id,
        result,
      });
    });

    return new NextResponse(result.body, {
      headers: {
        'content-type': result.mediaType,
        'content-disposition': `attachment; filename="${result.filename}"`,
        'cache-control': 'no-store',
        'x-vibefycode-export-sha256': result.sha256,
      },
    });
  } catch (error) {
    // The likely cause is the insert policy: a member, not an admin, asked for
    // an export. Say that rather than leaking a database message.
    return NextResponse.json(
      {
        error:
          'Only an owner or admin of this workspace can produce an audit export, and every export is recorded.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 403 },
    );
  }
}
