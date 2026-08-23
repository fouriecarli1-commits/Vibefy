import { NextResponse } from 'next/server';
import {
  isAuditExportKind,
  recordAuditExport,
  runAuditExport,
  type AuditExportFormat,
} from '@vibefycode/workspace';
import { createClient } from '@/lib/supabase/server';
import { writeAsUser } from '@/lib/sql';

/**
 * Producing an audit export.
 *
 * Everything runs inside one transaction under the caller's own row-level
 * security: the rows come back only if they are this workspace's, and the record
 * of the disclosure is written in the same breath as the disclosure. A file
 * handed over with no record of it having been handed over is the failure mode
 * an audit export exists to avoid.
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
    const result = await writeAsUser(user.id, async (client) => {
      const exported = await runAuditExport(client, {
        organisationId: id,
        kind,
        format,
        periodStart: from ? new Date(from) : null,
        periodEnd: to ? new Date(to) : null,
      });
      // Refused by the insert policy if the caller is not an owner or admin of
      // this workspace — which rolls back the whole transaction, file included.
      await recordAuditExport(client, {
        organisationId: id,
        requestedBy: user.id,
        result: exported,
      });
      return exported;
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
