import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AUDIT_EXPORT_KINDS } from '@vibefycode/workspace';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Audit export' };

export default async function ExportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/console/workspace/${id}/export`);

  const { data: exports } = await supabase
    .from('audit_exports')
    .select('id, kind, format, row_count, sha256, created_at')
    .eq('organisation_id', id)
    .order('created_at', { ascending: false })
    .limit(20);

  return (
    <div className="space-y-10">
      <section className="rounded-xl border border-line bg-surface-muted p-5 text-sm">
        <h2 className="font-semibold text-ink">What you get, and what you do not</h2>
        <p className="mt-2 text-muted">
          Six exports, each scoped to this workspace. Two things are deliberately left out: IP
          addresses are truncated to their network, and no email address appears in any file. You
          already know who your own people are, and a downloadable spreadsheet of staff addresses is
          a breach waiting for somewhere to happen.
        </p>
        <p className="mt-2 text-muted">
          Every export is recorded below with the hash of exactly what was handed over, in a table
          that refuses updates and deletes — so a file produced in a dispute can be checked against
          a record we could not have edited afterwards.
        </p>
      </section>

      <section aria-labelledby="download" className="space-y-4">
        <h2 id="download" className="text-xl font-semibold">
          Download
        </h2>
        <ul className="space-y-3">
          {Object.entries(AUDIT_EXPORT_KINDS).map(([kind, description]) => (
            <li key={kind} className="rounded-xl border border-line p-5 text-sm">
              <p className="font-medium">{kind.replace(/_/g, ' ')}</p>
              <p className="mt-1 text-muted">{description}</p>
              <p className="mt-3 flex gap-5">
                <a href={`/console/workspace/${id}/export/${kind}?format=csv`}>CSV</a>
                <a href={`/console/workspace/${id}/export/${kind}?format=json`}>JSON</a>
              </p>
            </li>
          ))}
        </ul>
      </section>

      {(exports ?? []).length > 0 && (
        <section aria-labelledby="history" className="space-y-4">
          <h2 id="history" className="text-xl font-semibold">
            Export history
          </h2>
          <ul className="space-y-2 text-sm">
            {(exports ?? []).map((record) => (
              <li key={record.id as string} className="rounded-lg border border-line p-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <span className="font-medium">
                    {String(record.kind).replace(/_/g, ' ')} · {String(record.format).toUpperCase()}
                  </span>
                  <span className="text-muted">
                    {new Date(record.created_at as string).toUTCString()}
                  </span>
                </div>
                <p className="mt-1 text-muted">
                  {String(record.row_count)} rows · sha256 {String(record.sha256).slice(0, 16)}…
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
