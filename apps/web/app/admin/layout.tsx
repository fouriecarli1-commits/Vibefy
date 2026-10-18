import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * A way to reach the administrator pages.
 *
 * There were four of them and nothing linked to any: `/admin/accounts`,
 * `/admin/costs`, `/admin/sponsorships` and now `/admin/health` were reachable
 * only by typing the address, which means they were reachable only by somebody
 * who already remembered it. The one that answers "why is the badge not
 * showing" is no use at all under that rule.
 *
 * The nav renders for anyone signed in, which is deliberate rather than
 * careless: each page refuses a caller who is not an administrator, and
 * row-level security makes the rows behind them unreadable in any case. A
 * menu that hides depending on a role is a second place for that decision to
 * live, and the pages are where it belongs.
 */
export const ADMIN_PAGES: readonly { href: string; label: string }[] = [
  { href: '/admin/health', label: 'What is wrong' },
  { href: '/admin/accounts', label: 'Accounts' },
  { href: '/admin/costs', label: 'Unit economics' },
  { href: '/admin/sponsorships', label: 'Placements' },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <nav aria-label="Administrator pages" className="flex flex-wrap gap-2">
        {ADMIN_PAGES.map((page) => (
          <Link key={page.href} href={page.href} className="chip">
            {page.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
