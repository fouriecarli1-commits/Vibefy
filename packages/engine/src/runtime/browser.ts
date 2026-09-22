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
import { readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
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
 * browser build predates the pinned Playwright version. `VIBEFYCODE_BROWSER_EXECUTABLE`
 * covers the first; the discovery fallback covers the second, so the browser
 * pass never silently stops running and leaves a thinner report behind.
 */
export function resolveBrowserExecutable(): string | undefined {
  const configured = process.env.VIBEFYCODE_BROWSER_EXECUTABLE;
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
  /**
   * A ceiling reached inside the page's own traffic, kept until somebody can be
   * told about it properly.
   *
   * `guard.check` throws when the run passes its request or wall-clock ceiling,
   * and here it is called from inside a Playwright route handler. An exception
   * thrown out of a route handler does not reach the caller — Playwright
   * swallows it, and the request hangs until the navigation times out. So the
   * one event the customer most needs named correctly, a run stopped at the
   * intensity their own authorisation permits, arrived as "the browser pass did
   * not complete". That is not a ceiling working; that is a ceiling failing to
   * say what it did.
   */
  private ceilingReached: Error | null = null;
  private tracing = false;

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
        'Mozilla/5.0 (compatible; VibefyCodeAssessment/1.0; +https://vibefycode.example/methodology)',
      ignoreHTTPSErrors: false,
    });

    /*
     * A record of every action taken in this browser.
     *
     * The published rubric names `playwright_trace` as the evidence for ten of
     * its criteria — whether a flow completes, whether state survives a reload,
     * whether a deletion route can be followed — and nothing in this engine had
     * ever produced one. Those criteria could be found against and could not be
     * evidenced as the rubric says they must be.
     *
     * Without screenshots or DOM snapshots: those are what make a trace weigh
     * megabytes, and the thing being evidenced here is the sequence of actions
     * and what each one did. Screenshots are captured deliberately, as their
     * own artefacts, with captions saying why they were taken.
     */
    try {
      await this.context.tracing.start({ screenshots: false, snapshots: false });
      this.tracing = true;
    } catch {
      // An older Playwright, or a context that will not trace. The pass still
      // runs; `traceId` stays null and the stage says so rather than citing an
      // artefact that does not exist.
      this.tracing = false;
    }

    await this.context.route('**/*', async (route, request) => {
      let decision;
      try {
        decision = this.guard.check(request.url(), request.method());
      } catch (error) {
        // Kept rather than thrown, and re-thrown from the next thing the stage
        // asks of this session, where it can travel as the stop it is.
        this.ceilingReached ??= error instanceof Error ? error : new Error(String(error));
        this.blockedRequests.push({
          url: request.url(),
          reason: 'the run reached a ceiling its authorisation set',
        });
        await route.abort('blockedbyclient');
        return;
      }
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

  /**
   * Stops tracing and captures the trace as evidence.
   *
   * Separate from `close` and called before it, because the trace is only
   * written when tracing stops and the context is still needed to stop it. The
   * id comes back to the stage, which attaches it to the findings this session
   * produced — they were all observed in the actions it records.
   */
  async captureTrace(summary: string): Promise<string | null> {
    if (!this.tracing || !this.context) return null;
    this.tracing = false;
    const path = join(tmpdir(), `vibefycode-trace-${randomUUID()}.zip`);
    try {
      await this.context.tracing.stop({ path });
      const body = await readFile(path);
      return this.evidence.capture({
        kind: 'playwright_trace',
        summary,
        contentType: 'application/zip',
        body,
      }).id;
    } catch {
      return null;
    } finally {
      await rm(path, { force: true }).catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    if (this.tracing) await this.context?.tracing.stop().catch(() => undefined);
    this.tracing = false;
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.context = null;
    this.browser = null;
    this.pageRef = null;
  }

  /**
   * Re-raises a ceiling the route handler could not raise for itself.
   *
   * Called before each thing that would carry the run further, so a stop
   * reaches the pipeline as `aborted` with its reason rather than as a
   * navigation that timed out for no stated cause.
   */
  private assertNoCeilingReached(): void {
    if (this.ceilingReached) throw this.ceilingReached;
  }

  async goto(
    url: string,
    waitUntil: 'load' | 'domcontentloaded' | 'networkidle' = 'domcontentloaded',
  ) {
    this.assertNoCeilingReached();
    this.guard.assert(url, 'GET');
    return this.page.goto(url, { waitUntil, timeout: 30_000 });
  }

  async screenshot(summary: string, fullPage = false): Promise<string> {
    this.assertNoCeilingReached();
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
    this.assertNoCeilingReached();
    await this.page.setViewportSize(viewport);
  }

  /**
   * The ceiling this session ran into, if it ran into one.
   *
   * `captureConsole` deliberately does not raise it: the console is evidence of
   * what happened up to the stop and is worth keeping.
   */
  get stoppedByCeiling(): Error | null {
    return this.ceilingReached;
  }
}
