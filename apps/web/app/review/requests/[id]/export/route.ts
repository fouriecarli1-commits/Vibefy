import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { assembleSubjectExport, subjectExportFilename } from '@vibefycode/governance';
import { createClient } from '@/lib/supabase/server';
import { writeAsUser } from '@/lib/sql';

/**
 * Assembling a person's own data in answer to an access or portability request.
 *
 * This used to be a reviewer running queries by hand, which meant a published
 * promise with no mechanism behind it — the exact shape of failure this product
 * exists to find in other people's software.
 *
 * Three things hold it together:
 *
 *   · Only a platform admin may ask, and only against a request that actually
 *     exists and actually asked for this. An endpoint that assembles a person's
 *     data from a user id in the URL is a data breach with a route handler in
 *     front of it.
 *   · The disclosure and the record of the disclosure are one transaction. A
 *     file handed over with no record of it having been handed over is what an
 *     audit trail exists to prevent.
 *   · The response carries the SHA-256 of the bytes, so the person can be told
 *     what they received and check that it is what arrived.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users')
    .select('platform_role')
    .eq('id', user.id)
    .single();
  if (profile?.platform_role !== 'admin') {
    // Not reviewer-or-admin, as elsewhere. `consents` and `data_requests` are
    // readable only by the person themselves or a platform admin, so a reviewer
    // would assemble an export with an empty consents array and nothing saying
    // so. A partial answer to a statutory request that looks complete is worse
    // than being told to escalate.
    return NextResponse.json(
      {
        error:
          'Assembling a data export requires a platform admin. A reviewer cannot read the consents, so what they would produce would be incomplete without saying so.',
      },
      { status: 403 },
    );
  }

  const { data: dataRequest } = await supabase
    .from('data_requests')
    .select('id, user_id, organisation_id, request_type, status')
    .eq('id', id)
    .single();
  if (!dataRequest) {
    return NextResponse.json({ error: 'No such request.' }, { status: 404 });
  }
  if (!['access', 'portability'].includes(String(dataRequest.request_type))) {
    // A correction, a deletion or an objection is answered by doing something,
    // not by handing over a file. Assembling one anyway would be a disclosure
    // nobody asked for.
    return NextResponse.json(
      {
        error: `A ${String(dataRequest.request_type)} request is not answered with an export. Only access and portability are.`,
      },
      { status: 409 },
    );
  }

  try {
    const { body, sha256, filename } = await writeAsUser(user.id, async (client) => {
      const assembled = await assembleSubjectExport(client, String(dataRequest.user_id));
      const serialised = `${JSON.stringify(assembled, null, 2)}\n`;
      const digest = createHash('sha256').update(serialised).digest('hex');

      await client.query(
        `insert into public.audit_log
           (organisation_id, actor_id, actor_role, action, entity_type, entity_id, summary, after_state)
         values ($1, $2, 'reviewer', 'data_request.exported', 'data_request', $3, $4, $5)`,
        [
          dataRequest.organisation_id,
          user.id,
          dataRequest.id,
          `Assembled a ${String(dataRequest.request_type)} export: ${assembled.consents.length} consent(s), ${assembled.memberships.length} membership(s), ${assembled.applications.length} application(s).`,
          JSON.stringify({ sha256: digest, exportVersion: assembled.exportVersion }),
        ],
      );

      return { body: serialised, sha256: digest, filename: subjectExportFilename(assembled) };
    });

    return new NextResponse(body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        // Never cached, never stored by an intermediary. This is one person's
        // personal data travelling over a link a reviewer opened.
        'cache-control': 'no-store, private',
        'x-vibefycode-export-sha256': sha256,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'The export could not be assembled, and nothing was recorded as disclosed.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
