import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const TABS = [
  { href: 'team', label: 'Team & seats' },
  { href: 'policies', label: 'Policy profiles' },
  { href: 'branding', label: 'Report branding' },
  { href: 'sso', label: 'Single sign-on' },
  { href: 'export', label: 'Audit export' },
] as const;

/**
 * The workspace administration shell.
 *
 * The organisation is loaded here once, under row-level security. If the caller
 * is not a member the query returns nothing and this is a 404 — not a 403, which
 * would confirm the workspace exists.
 */
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/console/workspace/${id}/team`);

  const { data: organisation } = await supabase
    .from('organisations')
    .select('id, name, slug, account_type')
    .eq('id', id)
    .maybeSingle();
  if (!organisation) notFound();

  return (
    <div className="max-w-3xl space-y-8">
      <header className="space-y-2">
        <p className="text-sm text-muted">
          <Link href="/console/workspace">Workspaces</Link> · {organisation.slug}
        </p>
        <h1 className="text-3xl font-bold tracking-tight">{organisation.name}</h1>
        <p className="text-muted">{String(organisation.account_type)} workspace</p>
      </header>

      <nav aria-label="Workspace settings" className="flex flex-wrap gap-5 border-b border-line pb-3 text-sm">
        {TABS.map((tab) => (
          <Link key={tab.href} href={`/console/workspace/${id}/${tab.href}`}>
            {tab.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
