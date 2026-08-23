/**
 * Running axe over our own output.
 *
 * PART 8.3 is blunt about why this exists: WCAG 2.2 AA is a rubric dimension
 * *and* a requirement for our own product, because it is hard to sell an
 * accessibility score from an inaccessible dashboard. Until now we had a colour
 * contrast gate — one criterion out of thirty — and had never run a scan
 * against anything we ship.
 *
 * The same caveat we put in every report applies to us: an automated scan finds
 * a minority of real barriers. Passing this is a floor, not a claim.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolveBrowserExecutable } from '../../packages/engine/src/runtime/browser.ts';

const require_ = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require_.resolve('axe-core/axe.min.js'), 'utf8');

/** The rule set we hold ourselves to, matching what the rubric measures. */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

export interface AxeViolation {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly helpUrl: string;
  readonly nodes: readonly { readonly target: readonly string[]; readonly summary: string }[];
}

let browser: Browser | null = null;

export async function axeBrowser(): Promise<Browser> {
  if (browser) return browser;
  const launch = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  try {
    browser = await chromium.launch(launch);
  } catch (error) {
    const executablePath = resolveBrowserExecutable();
    if (!executablePath) throw error;
    browser = await chromium.launch({ ...launch, executablePath });
  }
  return browser;
}

export async function closeAxeBrowser(): Promise<void> {
  await browser?.close();
  browser = null;
}

export interface AxeRun {
  readonly violations: AxeViolation[];
  /** How many rules actually ran and passed. Zero means the scan did not happen. */
  readonly passes: number;
}

async function analyse(page: Page): Promise<AxeViolation[]> {
  return (await analyseFull(page)).violations;
}

async function analyseFull(page: Page): Promise<AxeRun> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(
    async (tags) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results = await (window as any).axe.run(document, {
        runOnly: { type: 'tag', values: tags },
      });
      const violations = results.violations.map(
        (violation: {
          id: string;
          impact: string | null;
          help: string;
          helpUrl: string;
          nodes: { target: string[]; failureSummary?: string }[];
        }) => ({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          helpUrl: violation.helpUrl,
          nodes: violation.nodes.slice(0, 4).map((node) => ({
            target: node.target,
            summary: (node.failureSummary ?? '').split('\n').slice(0, 3).join(' '),
          })),
        }),
      );
      return { violations, passes: results.passes.length };
    },
    AXE_TAGS as unknown as string[],
  );
}

/**
 * Scans a complete HTML document we generated.
 *
 * Returns the passing-rule count as well as the violations. "Zero violations"
 * and "the scan never ran" look identical otherwise, and the second one is the
 * failure mode worth guarding against — a green accessibility gate that is green
 * because it is broken is worse than not having one.
 */
export async function auditHtml(html: string): Promise<AxeRun> {
  const context = await (await axeBrowser()).newContext();
  const page = await context.newPage();
  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    return await analyseFull(page);
  } finally {
    await context.close();
  }
}

/** Scans a page served over HTTP. */
export async function auditUrl(url: string): Promise<AxeRun> {
  const context = await (await axeBrowser()).newContext();
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    return await analyseFull(page);
  } finally {
    await context.close();
  }
}

/** A failure message someone can act on, rather than a rule id. */
export function describe(violations: readonly AxeViolation[]): string {
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help}\n` +
        violation.nodes
          .map((node) => `    at ${node.target.join(' ')} — ${node.summary}`)
          .join('\n') +
        `\n    ${violation.helpUrl}`,
    )
    .join('\n\n');
}
