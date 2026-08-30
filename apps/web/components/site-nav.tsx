'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * The primary navigation.
 *
 * It used to be nine links in one row, which is not navigation — it is a list
 * of everything, and a reader has to check each item to find out whether it is
 * for them. They are grouped here by *who is asking*: someone checking a badge
 * they found on a website has nothing to do with someone paying an invoice.
 *
 * Three behaviours matter more than the styling:
 *
 *   · On a narrow screen the row becomes one button. A wrapping nine-link row
 *     pushes the page down and looks broken; a menu does not.
 *   · A group opens on click, never on hover. Hover menus are unusable with a
 *     finger and hostile with a trackpad, and this row has to work on a phone.
 *   · Escape closes, a click outside closes, and the trigger says whether it is
 *     open. A menu that traps you is worse than no menu.
 */

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly hint: string;
}

interface NavGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly NavItem[];
}

const GROUPS: readonly NavGroup[] = [
  {
    id: 'verify',
    label: 'Verify',
    items: [
      {
        href: '/how-it-works',
        label: 'What happens to your app',
        hint: 'The mechanism, the limits, and what we never see',
      },
      { href: '/verify', label: 'Check a badge', hint: 'Confirm a mark you found somewhere' },
      {
        href: '/trust-check',
        label: 'Check an app',
        hint: 'Before you pay: can it be cancelled, is anyone there',
      },
      { href: '/directory', label: 'Directory', hint: 'Applications with a live badge' },
      { href: '/methodology', label: 'Methodology', hint: 'The rubric, published in full' },
    ],
  },
  {
    id: 'console',
    label: 'Console',
    items: [
      { href: '/console', label: 'Overview', hint: 'Your applications and their state' },
      { href: '/console/portfolio', label: 'Portfolio', hint: 'Every application, one page' },
      { href: '/console/alerts', label: 'Alerts', hint: 'What changed, and what it costs you' },
      { href: '/console/billing', label: 'Billing', hint: 'Plan, invoices and receipts' },
      {
        href: '/console/privacy',
        label: 'Your data',
        hint: 'What we hold, and your rights over it',
      },
    ],
  },
];

const DIRECT: readonly NavItem[] = [
  { href: '/review', label: 'Review', hint: 'The reviewer queue' },
];

export function SiteNav() {
  const pathname = usePathname();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);

  // Navigating is the end of a menu's usefulness. Without this, tapping a link
  // leaves the panel covering the page you just asked for.
  useEffect(() => {
    setOpenGroup(null);
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!openGroup && !menuOpen) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenGroup(null);
        setMenuOpen(false);
      }
    }
    function onPointer(event: PointerEvent) {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpenGroup(null);
        setMenuOpen(false);
      }
    }

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [openGroup, menuOpen]);

  const isCurrent = (href: string) =>
    href === '/console' ? pathname === '/console' : pathname.startsWith(href);

  return (
    <div ref={navRef} className="nav-shell">
      <Link href="/" className="nav-logo" aria-label="VibefyCode — home">
        {/*
          The outlined lockup on its dark variant. Not the mark plus the name in
          a live font: that is a different drawing on every machine, and the
          name is the trade mark.
          eslint-disable-next-line @next/next/no-img-element
        */}
        <img
          src="/brand/vibefycode-logo-horizontal-dark.svg"
          alt="VibefyCode"
          width={140}
          height={42}
        />
      </Link>

      {/* The narrow-screen trigger. Hidden from wide screens by CSS, not by JS,
          so it is never briefly visible while the page loads. */}
      <button
        type="button"
        className="nav-burger"
        aria-expanded={menuOpen}
        aria-controls="site-nav-panel"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span className="nav-burger-bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        {menuOpen ? 'Close' : 'Menu'}
      </button>

      <div id="site-nav-panel" className="nav-panel" data-open={menuOpen}>
        {GROUPS.map((group) => {
          const open = openGroup === group.id;
          const active = group.items.some((item) => isCurrent(item.href));
          return (
            <div key={group.id} className="nav-group">
              <button
                type="button"
                className="nav-trigger"
                aria-expanded={open}
                aria-controls={`nav-menu-${group.id}`}
                data-active={active}
                onClick={() => setOpenGroup(open ? null : group.id)}
              >
                {group.label}
                <span className="nav-caret" aria-hidden="true" />
              </button>

              <ul id={`nav-menu-${group.id}`} className="nav-menu" data-open={open}>
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="nav-menu-item"
                      aria-current={isCurrent(item.href) ? 'page' : undefined}
                    >
                      <span className="nav-menu-label">{item.label}</span>
                      <span className="nav-menu-hint">{item.hint}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}

        {DIRECT.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="nav-direct"
            data-active={isCurrent(item.href)}
            aria-current={isCurrent(item.href) ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}

        <Link href="/sign-in" className="nav-cta">
          Sign in
        </Link>
      </div>
    </div>
  );
}
