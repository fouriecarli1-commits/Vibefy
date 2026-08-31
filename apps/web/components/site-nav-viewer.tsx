import { SiteNav, type Audience } from './site-nav';
import { createClient } from '@/lib/supabase/server';

/**
 * The navigation, told who is reading it.
 *
 * Separated from `SiteNav` so the menu itself stays a client component with no
 * idea what a database is, and so the layout can render it inside a boundary:
 * the public pages do not have to wait on a session lookup to paint a header.
 * Until the answer arrives the menu is the visitor's, which is the right thing
 * to show somebody we do not yet know.
 *
 * This decides what is *offered*, never what is permitted. Every route behind
 * these links checks the caller itself — `/review` and `/admin/*` both refuse
 * and say why — so a wrong answer here costs a missing menu entry rather than
 * an open door.
 */
export async function SiteNavForViewer() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <SiteNav audience="visitor" />;

  const { data: profile } = await supabase
    .from('users')
    .select('platform_role')
    .eq('id', user.id)
    .maybeSingle();

  const role = String(profile?.platform_role ?? 'user');
  const audience: Audience =
    role === 'admin' ? 'admin' : role === 'reviewer' ? 'reviewer' : 'customer';

  return <SiteNav audience={audience} />;
}
