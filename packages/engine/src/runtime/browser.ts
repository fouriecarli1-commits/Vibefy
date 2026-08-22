/**
 * The browser session.
 *
 * Playwright, wrapped so that the scope guard sees every request the page makes
 * — including ones the page's own JavaScript initiates, which a plain HTTP
 * client would never observe. Out-of-scope requests are aborted at the route
 * level rather than allowed and then complained about.
 *
 * The browser also enforces the read-only ceiling: a page that tries to issue a
 * DELETE is stopped here, whatever the model or the page's script intended.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page, type Request } from 'playwright';
import type { ScopeGuard } from './scope.ts';
import type { EvidenceStore } from './evidence.ts';

export interface BrowserSessionOptions {
  readonly viewport?: { width: number; height: number };
  readonly headless?: boolean;
}

/** A phone-sized viewport, because that is where most of these apps are used. */
export const MOBILE_VIEWPORT = { width: 390, height: 844 };
export const DESKTOP_VIEWPORT = { width: 1280, height: 900 };

export interface ConsoleEntry {
  readonly type: string;
  readonly text: string;
  readonly url: string;
}

/**
 * Where the browser binary lives.
 *
 * Normally Playwright resolves this itself. Two situations need an override: a
 * container image that bakes in a specific browser, and a machine whose cached
 * browser build predates the pinned Playwright version. `VIBEFY_BROWSER_EXECUTABLE`
 * covers the first; the discovery fallback covers the second, so the browser
 * pass never silently stops running and leaves a thinner report behind.
 */
export function resolveBrowserExecutable(): string | undefined {
  const configured = process.env.VIBEFY_BROWSER_EXECUTABLE;
  if (configured && existsSync(configured)) return configured;

  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!cache || !existsSync(cache)) return undefined;

  const candidates = readdirSync(cache)
    .filter((entry) => entry.startsWith('chromium-'))
    .sort()
    .reverse()
    .map((entry) => join(cache, entry, 'chrome-linux', 'chrome'))
    .filter((candidate) => existsSync(candidate));

  return candidates[0];
}

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pageRef: Page | null = null;
  readonly consoleEntries: ConsoleEntry[] = [];
  readonly blockedRequests: { url: string; reason: string }[] = [];
  readonly pageErrors: string[] = [];

  constructor(
    private readonly guard: ScopeGuard,
    private readonly evidence: EvidenceStore,
    private readonly options: BrowserSessionOptions = {},
  ) {}

  get page(): Page {
    if (!this.pageRef) throw new Error('Browser session is not open');
    return this.pageRef;
  }

  async open(): Promise<void> {
    // No sandbox inside an already-sandboxed container; the container is the
    // boundary, and Chromium's own sandbox cannot start without privileges we
    // deliberately do not grant the runner.
    const launchOptions = {
      headless: this.options.headless ?? true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    };

    try {
      this.browser = await chromium.launch(launchOptions);
    } catch (error) {
      const executablePath = resolveBrowserExecutable();
      if (!executablePath) throw error;
      this.browser = await chromium.launch({ ...launchOptions, executablePath });
    }
    this.context = await this.browser.newContext({
      viewport: this.options.viewport ?? DESKTOP_VIEWPORT,
      userAgent:
        'Mozilla/5.0 (compatible; VibefyAssessment/1.0; +https://vibefy.example/methodology)',
      ignoreHTTPSErrors: false,
    });

    await this.context.route('**/*', async (route, request) => {
      const decision = this.guard.check(request.url(), request.method());
      if (!decision.allowed) {
        this.blockedRequests.push({ url: request.url(), reason: decision.reason });
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });

    this.pageRef = await this.context.newPage();
    this.pageRef.on('console', (message) => {
      this.consoleEntries.push({
        type: message.type(),
        text: message.text().slice(0, 2000),
        url: message.location().url,
      });
    });
    this.pageRef.on('pageerror', (error) => {
      this.pageErrors.push(error.message.slice(0, 2000));
    });
    this.pageRef.on('requestfailed', (request: Request) => {
      const failure = request.failure()?.errorText ?? 'unknown';
      if (failure.includes('blockedbyclient')) return; // already recorded
      this.consoleEntries.push({ type: 'requestfailed', text: failure, url: request.url() });
    });
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.context = null;
    this.browser = null;
    this.pageRef = null;
  }

  async goto(
    url: string,
    waitUntil: 'load' | 'domcontentloaded' | 'networkidle' = 'domcontentloaded',
  ) {
    this.guard.assert(url, 'GET');
    return this.page.goto(url, { waitUntil, timeout: 30_000 });
  }

  async screenshot(summary: string, fullPage = false): Promise<string> {
    const buffer = await this.page.screenshot({ fullPage, type: 'png' });
    const artefact = this.evidence.capture({
      kind: 'screenshot',
      summary,
      body: buffer,
      contentType: 'image/png',
      metadata: { url: this.page.url(), viewport: this.page.viewportSize() },
    });
    return artefact.id;
  }

  async captureConsole(summary: string): Promise<string> {
    const artefact = this.evidence.capture({
      kind: 'console_log',
      summary,
      body: {
        entries: this.consoleEntries,
        pageErrors: this.pageErrors,
        blocked: this.blockedRequests,
      },
    });
    return artefact.id;
  }

  async setViewport(viewport: { width: number; height: number }): Promise<void> {
    await this.page.setViewportSize(viewport);
  }
}
