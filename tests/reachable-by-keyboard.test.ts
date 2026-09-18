/**
 * The half of the page a keyboard could not reach.
 *
 * A box that scrolls sideways and cannot be focused has a right-hand half that
 * does not exist for somebody using a keyboard: they can tab to every link on
 * the page and never see the third column of a rate card, or the second half of
 * the record they are supposed to publish at their own domain.
 *
 * It is invisible at desktop width, where nothing scrolls. It sat in three
 * public pages and five console ones until the accessibility scan started
 * running at phone width as well — which is the argument for scanning at both,
 * and the reason the first thing that scan found is the thing being fixed here.
 *
 * Most people who open these pages will open them on a phone.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTablesReachable } from '../apps/web/lib/reachable-tables.ts';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

describe('a wide table in a page', () => {
  /** Every .tsx under apps/web/app, as source. */
  const sources = (() => {
    const found: { path: string; source: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.tsx')) {
          found.push({ path: full, source: readFileSync(full, 'utf8') });
        }
      }
    };
    walk(join(process.cwd(), 'apps/web/app'));
    return found;
  })();

  it('found the pages it is talking about', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it('never scrolls sideways without being reachable', () => {
    // The guard, rather than a list of the places it was wrong. A new wide
    // table written next month is the case this exists for, and the person
    // writing it will be looking at a desktop.
    const offenders: string[] = [];
    for (const { path, source } of sources) {
      const where = path.replace(`${process.cwd()}/`, '');
      // `overflow-x-auto` as the element's own class. Not `[&_table]:overflow-x-auto`,
      // which scrolls the tables inside rather than the element carrying it —
      // a different case, and the one below.
      const pattern = /<(div|pre|table)\b([^>]*(?<!\]:)\boverflow-x-auto\b[^>]*)>/g;
      for (const match of source.matchAll(pattern)) {
        if (!match[2]!.includes('tabIndex')) offenders.push(`${where}: <${match[1]}>`);
      }

      // A page whose stylesheet makes its tables scroll has to be rendering
      // them through the helper, because nobody can put an attribute on a
      // table that came out of markdown.
      // Called, not merely imported: an import left behind by a refactor would
      // otherwise satisfy this while the tables went back to being unreachable.
      if (
        /\[&_table\]:overflow-x-auto/.test(source) &&
        !/makeTablesReachable\s*\(/.test(source.replace(/^import .*$/gm, ''))
      ) {
        offenders.push(`${where}: tables styled to scroll, rendered without makeTablesReachable`);
      }
    }
    expect(
      offenders,
      `Scrollable boxes a keyboard cannot reach:\n  ${offenders.join('\n  ')}\nUse <WideTable label="…"> for a table, or add tabIndex, role and aria-label.`,
    ).toEqual([]);
  });

  it('has a component that cannot be built without a label', () => {
    // A focused region with no name tells somebody they have arrived somewhere
    // and not where, so the label is a required prop rather than an option.
    const component = read('apps/web/components/wide-table.tsx');
    expect(component).toMatch(/readonly label: string;/);
    expect(component).toContain('aria-label={label}');
    expect(component).toContain('tabIndex={0}');
  });
});

describe('a wide table in a legal document', () => {
  // The legal pages are markdown, so nobody can put an attribute on the table
  // by hand. The renderer does it, and this is the pair that shows it working.
  const withTable = '<h2>What we keep</h2>\n<table><tr><td>x</td></tr></table>';

  it('makes a table reachable, and names it after the heading it sits under', () => {
    const html = makeTablesReachable(withTable);
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="What we keep"');
  });

  it('leaves a table that is already reachable alone', () => {
    const already = '<table tabindex="0" aria-label="Kept">';
    expect(makeTablesReachable(already)).toBe(already);
  });

  it('labels a table with no heading above it, rather than leaving it unnamed', () => {
    expect(makeTablesReachable('<table>')).toContain('aria-label="Table"');
  });

  it('uses the nearest heading, not the first one', () => {
    const html = makeTablesReachable(
      '<h2>First</h2><p>x</p><h3>Nearest</h3><table><tr><td>y</td></tr></table>',
    );
    expect(html).toContain('aria-label="Nearest"');
  });

  it('does not let a heading break out of the attribute it is written into', () => {
    const html = makeTablesReachable('<h2>He said "no"</h2><table>');
    expect(html).toContain('aria-label="He said &quot;no&quot;"');
    // The whole tag, still one tag.
    expect(html.match(/<table[^>]*>/)![0]).toContain('tabindex="0"');
  });

  it('strips the markup out of a heading before using it as a name', () => {
    expect(makeTablesReachable('<h2><em>Fees</em> and charges</h2><table>')).toContain(
      'aria-label="Fees and charges"',
    );
  });

  it('leaves everything that is not a table exactly as it was', () => {
    const prose = '<h2>Terms</h2>\n<p>Some words.</p>\n<ul><li>One</li></ul>';
    expect(makeTablesReachable(prose)).toBe(prose);
  });
});

describe('the scan that found it runs at both widths', () => {
  const scan = read('tools/a11y-scan.mts');

  it('scans a phone width as well as a desktop one', () => {
    // Reflow and target size are WCAG 2.2 AA criteria that only fail on a
    // narrow screen. A scan that runs at one width has been reporting a pass
    // on two things it never looked at.
    expect(scan).toContain('MOBILE_VIEWPORT');
    expect(scan).toContain('DESKTOP_VIEWPORT');
  });

  it('says which width failed, because the fix differs', () => {
    expect(scan).toMatch(/at \$\{width\.label\}/);
  });
});
