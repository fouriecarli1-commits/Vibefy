/**
 * The primary navigation.
 *
 * It was nine links in one row, which is not navigation — it is a list of
 * everything, and a reader has to check each item to find out whether it is for
 * them. On a phone that row wrapped into four lines and pushed the page down.
 *
 * These tests are about the behaviour that makes a menu usable rather than
 * merely present: it can be opened, it says so, and it can always be closed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const nav = readFileSync(join(process.cwd(), 'apps/web/components/site-nav.tsx'), 'utf8');
const css = readFileSync(join(process.cwd(), 'apps/web/app/globals.css'), 'utf8');
const layout = readFileSync(join(process.cwd(), 'apps/web/app/layout.tsx'), 'utf8');

describe('the row is grouped, not listed', () => {
  it('puts the links into named groups', () => {
    expect(nav).toContain("label: 'Verify'");
    expect(nav).toContain("label: 'Console'");
  });

  it('leaves at most four things in the top row, for every audience', () => {
    // More than four and it is the nine-link row again with extra steps. The
    // row is now per audience, so the cap has to hold for each of them rather
    // than for one list nobody sees in full.
    const map = /const GROUPS_FOR[\s\S]*?\n\};/.exec(nav)![0];
    const rows = [...map.matchAll(/^\s{2}(\w+): \[([^\]]*)\]/gm)];
    expect(rows.length).toBe(4);
    for (const [, audience, entries] of rows) {
      const count = [...(entries ?? '').matchAll(/'[^']+'/g)].length;
      // Only the visitor is also offered a sign-in call to action.
      expect(count + (audience === 'visitor' ? 1 : 0)).toBeLessThanOrEqual(4);
    }
  });

  it('says what each destination is for', () => {
    // A label alone makes a reader open a page to find out whether it was the
    // one they wanted. Every item carries a line saying who it is for.
    // Counted per entry rather than per line. An earlier version matched only
    // items written on one line and compared totals with a fudge factor, so
    // wrapping an entry onto three lines — which Prettier does as soon as the
    // hint gets long — failed a test about hints for reasons of formatting.
    //
    // One hint per entry, exactly. Sign-in is written as JSX rather than as a
    // data entry, so it does not appear in this count and needs no exception.
    const hints = [...nav.matchAll(/\bhint: '/g)].length;
    const hrefs = [...nav.matchAll(/\bhref: '/g)].length;
    expect(hints).toBe(hrefs);
    expect(hrefs).toBeGreaterThan(8);
    expect(nav).not.toMatch(/hint: ''/);
  });
});

describe('it can be opened and closed', () => {
  it('states whether the menu is open, for a screen reader as well', () => {
    expect(nav).toContain('aria-expanded={menuOpen}');
    expect(nav).toContain('aria-controls="site-nav-panel"');
    expect(nav).toContain('aria-expanded={open}');
  });

  it('closes on Escape and on a click outside', () => {
    // A menu that traps you is worse than no menu.
    expect(nav).toContain("event.key === 'Escape'");
    expect(nav).toContain('pointerdown');
    expect(nav).toContain('navRef.current.contains');
  });

  it('closes when the route changes', () => {
    // Otherwise tapping a link leaves the panel covering the page you asked for.
    expect(nav).toMatch(
      /useEffect\([\s\S]{0,200}setMenuOpen\(false\);[\s\S]{0,80}\}, \[pathname\]\)/,
    );
  });

  it('opens on click rather than on hover', () => {
    // Hover is not available to a finger. A hover-only menu is an unreachable
    // menu on the device most people will use.
    expect(nav).toContain('onClick={() =>');
    expect(css).not.toMatch(/\.nav-trigger:hover\s*\+\s*\.nav-menu/);
    expect(css).not.toMatch(/\.nav-group:hover\s+\.nav-menu\s*\{[^}]*display:\s*block/);
  });

  it('marks the section you are in', () => {
    expect(nav).toContain("aria-current={isCurrent(item.href) ? 'page' : undefined}");
  });
});

describe('narrow screens get a menu, not a wrapped row', () => {
  it('collapses the row into one button below the breakpoint', () => {
    expect(css).toMatch(/@media \(max-width: 62rem\)[\s\S]*?\.nav-panel \{[\s\S]*?display: none;/);
    expect(css).toMatch(/\.nav-panel\[data-open='true'\] \{\s*display: flex;/);
  });

  it('hides the button on wide screens with CSS, not with JavaScript', () => {
    // A JavaScript-hidden control is briefly visible while the page loads, which
    // reads as a flicker on every navigation.
    expect(css).toMatch(
      /@media \(min-width: 62\.0625rem\)[\s\S]*?\.nav-burger \{\s*display: none;/,
    );
    expect(nav).not.toMatch(/window\.(innerWidth|matchMedia)/);
  });

  it('opens a group in place on a phone rather than floating over the page', () => {
    expect(css).toMatch(
      /@media \(max-width: 62rem\)[\s\S]*?\.nav-menu \{[\s\S]*?position: static;/,
    );
  });
});

describe('the page vocabulary', () => {
  it('defines the shapes every page is built from', () => {
    for (const shape of ['.panel', '.bar', '.stat', '.chip', '.eyebrow', '.grid-cards']) {
      expect(css, `${shape} is not defined`).toContain(`${shape} {`);
    }
  });

  it('carries state in shape as well as colour', () => {
    // A chip that differs only by hue is invisible to a colourblind reader and
    // to a black-and-white printout.
    expect(css).toContain("[data-tone='ok']");
    expect(css).toContain("[data-tone='warn']");
    expect(css).toContain("[data-tone='bad']");
    expect(css).toMatch(/\.bar \{[\s\S]*?border-left: 3px solid/);
  });

  it('uses those shapes on the home page rather than one-off styling', () => {
    const home = readFileSync(join(process.cwd(), 'apps/web/app/page.tsx'), 'utf8');
    expect(home).toContain('className="panel');
    expect(home).toContain('className="stat"');
    expect(home).toContain('grid-cards');
  });

  it('renders the navigation inside a labelled landmark', () => {
    expect(layout).toContain('aria-label="Primary"');
    expect(layout).toContain('<SiteNav />');
  });
});
