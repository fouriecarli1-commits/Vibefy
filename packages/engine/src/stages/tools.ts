/**
 * The tools a model-driven stage is allowed to use.
 *
 * This is the whole surface: there is no shell, no filesystem, no arbitrary
 * code execution, and no way to reach the network except through a tool defined
 * here. Every one of them goes through the scope guard, so the boundary is not a
 * property of how the tools are described in a prompt — it is a property of what
 * the functions can physically do.
 */
import type { BrowserSession } from '../runtime/browser.ts';
import type { ScopedHttp } from '../runtime/http.ts';
import type { ToolDefinition } from '../model/client.ts';
import { classifyStop } from '../runtime/stop.ts';

const MAX_TEXT = 6_000;
const MAX_ELEMENTS = 60;

/**
 * A compact description of what is on the page. Sending raw HTML would burn
 * tokens on markup the model cannot act on and would push the interesting parts
 * out of the window.
 */
async function describePage(session: BrowserSession): Promise<string> {
  const snapshot = await session.page.evaluate(
    ({ maxText, maxElements }) => {
      const visible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none'
        );
      };
      const describe = (element: Element, index: number) => {
        const tag = element.tagName.toLowerCase();
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
        const attributes: Record<string, string> = {};
        for (const name of ['id', 'name', 'type', 'href', 'placeholder', 'aria-label', 'value']) {
          const value = element.getAttribute(name);
          if (value) attributes[name] = value.slice(0, 120);
        }
        return { index, tag, text, attributes };
      };
      const all = Array.from(
        document.querySelectorAll(
          'a, button, input, select, textarea, [role="button"], [role="link"]',
        ),
      ).filter(visible);
      const interactive = all.slice(0, maxElements).map(describe);
      const fullText = (document.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n');
      return {
        url: window.location.href,
        title: document.title,
        text: fullText.slice(0, maxText),
        interactive,
        // What was left out, said rather than implied.
        //
        // The model reasons about absence from this description — "there is no
        // way to log out", "there is no cancel link" — and a page with more
        // than `maxElements` controls, or more text than fits, was handed to it
        // as though it were the whole page. A finding of absence drawn from a
        // list that was quietly cut is a finding about our truncation.
        interactiveShown: interactive.length,
        interactiveTotal: all.length,
        interactiveTruncated: all.length > interactive.length,
        textTruncated: fullText.length > maxText,
        status: document.readyState,
      };
    },
    { maxText: MAX_TEXT, maxElements: MAX_ELEMENTS },
  );
  const described = JSON.stringify(snapshot, null, 2);
  const warnings: string[] = [];
  if (snapshot.interactiveTruncated) {
    warnings.push(
      `Only ${snapshot.interactiveShown} of ${snapshot.interactiveTotal} interactive elements are listed above. There are more on this page than are shown; do not conclude that something is absent from this list alone.`,
    );
  }
  if (snapshot.textTruncated) {
    warnings.push(
      'The page text above is cut short. There is more of it than is shown; do not conclude that something is absent from this text alone.',
    );
  }
  return warnings.length === 0 ? described : `${described}\n\n${warnings.join('\n')}`;
}

/**
 * Runs a page action and says whether it happened.
 *
 * Playwright signals "nothing to do" by resolving with null rather than by
 * throwing — there was no history entry, the navigation was same-document —
 * so both have to be read. A ceiling reached inside the page's own traffic is
 * held on the session and is not an answer to give the model: it is the run
 * stopping, so it is re-thrown here.
 */
async function attempt(
  session: BrowserSession,
  action: () => Promise<unknown | null>,
): Promise<{ ok: true } | { ok: false; why: string }> {
  try {
    const result = await action();
    const ceiling = session.stoppedByCeiling;
    if (ceiling) throw ceiling;
    return result === null ? { ok: false, why: 'there was nothing to do.' } : { ok: true };
  } catch (error) {
    const ceiling = session.stoppedByCeiling;
    if (ceiling) throw ceiling;
    if (classifyStop(error) !== null) throw error;
    return { ok: false, why: error instanceof Error ? `${error.message}.` : `${String(error)}.` };
  }
}

export interface BrowserToolOptions {
  readonly session: BrowserSession;
  readonly onScreenshot?: (evidenceId: string, caption: string) => void;
}

export function browserTools({ session, onScreenshot }: BrowserToolOptions): ToolDefinition[] {
  return [
    {
      name: 'navigate',
      description:
        'Load a URL. Refused if the URL is outside the authorised scope — that refusal is the boundary working, so note it and try something else rather than another route to the same place.',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Absolute URL to load' } },
        required: ['url'],
        additionalProperties: false,
      },
      async run(input) {
        const response = await session.goto(String(input.url), 'domcontentloaded');
        return `Loaded ${session.page.url()} (HTTP ${response?.status() ?? 'unknown'})\n\n${await describePage(session)}`;
      },
    },
    {
      name: 'read_page',
      description:
        'Describe what is currently on the page: its URL, title, visible text and every interactive element with its attributes.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      async run() {
        return describePage(session);
      },
    },
    {
      name: 'click',
      description:
        'Click an element. Prefer a visible text label; fall back to a CSS selector when the text is ambiguous.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Visible text of the element' },
          selector: { type: 'string', description: 'CSS selector, used when text is not given' },
        },
        additionalProperties: false,
      },
      async run(input) {
        const locator = input.text
          ? session.page.getByText(String(input.text), { exact: false }).first()
          : session.page.locator(String(input.selector)).first();
        await locator.click({ timeout: 10_000 });
        await session.page.waitForLoadState('domcontentloaded').catch(() => undefined);
        return `Clicked. Now at ${session.page.url()}\n\n${await describePage(session)}`;
      },
    },
    {
      name: 'fill',
      description:
        'Type a value into a form field. Use only the synthetic test credentials you were given; never invent credentials and never try ones you were not given.',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector for the field' },
          value: { type: 'string', description: 'Value to type' },
        },
        required: ['selector', 'value'],
        additionalProperties: false,
      },
      async run(input) {
        await session.page
          .locator(String(input.selector))
          .first()
          .fill(String(input.value), { timeout: 10_000 });
        return `Filled ${String(input.selector)}.`;
      },
    },
    {
      name: 'screenshot',
      description:
        'Capture the current page as evidence. A finding without a screenshot or an HTTP exchange cannot be published, so take one whenever you observe something you intend to report.',
      inputSchema: {
        type: 'object',
        properties: {
          caption: { type: 'string', description: 'What this screenshot shows and why it matters' },
          fullPage: { type: 'boolean' },
        },
        required: ['caption'],
        additionalProperties: false,
      },
      async run(input) {
        const caption = String(input.caption);
        const id = await session.screenshot(caption, input.fullPage === true);
        onScreenshot?.(id, caption);
        return `Captured evidence ${id}: ${caption}`;
      },
    },
    {
      name: 'go_back',
      description: 'Press the browser back button, to check that navigation history behaves.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      async run() {
        const before = session.page.url();
        const moved = await attempt(session, () => session.page.goBack({ timeout: 10_000 }));
        // It used to report "Back at <url>" whatever happened. A back button
        // that did nothing then read as a back button that worked and returned
        // to the same page, which is a different answer about the application.
        if (!moved.ok) return `The back button did nothing: ${moved.why} Still at ${before}.`;
        return `Back at ${session.page.url()}\n\n${await describePage(session)}`;
      },
    },
    {
      name: 'reload',
      description: 'Reload the current page, to check whether state survives a refresh.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      async run() {
        const before = session.page.url();
        const reloaded = await attempt(session, () => session.page.reload({ timeout: 20_000 }));
        // This tool exists to answer whether state survives a refresh. A reload
        // that silently did not happen leaves the state exactly where it was,
        // which reads as state that survived — a clean bill on the criterion
        // this tool was called to test.
        if (!reloaded.ok) return `The page did not reload: ${reloaded.why} Still at ${before}.`;
        return `Reloaded ${session.page.url()}\n\n${await describePage(session)}`;
      },
    },
  ];
}

/**
 * The adversarial pass additionally gets a raw HTTP tool, because the defects it
 * looks for live in what the server returns rather than in what the interface
 * shows. The guard still decides every request, and DELETE, PUT and PATCH never
 * reach the network whatever the model asks for.
 */
export function httpTool(
  http: ScopedHttp,
  onExchange?: (evidenceId: string, summary: string) => void,
): ToolDefinition {
  return {
    name: 'http_request',
    description:
      'Issue a single HTTP request and see the status, headers and body. GET, HEAD, OPTIONS and POST only — destructive methods are refused below you. Use the smallest possible probe: never enumerate, never loop.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute URL' },
        method: { type: 'string', enum: ['GET', 'HEAD', 'OPTIONS', 'POST'] },
        why: { type: 'string', description: 'What you expect to learn from this one request' },
      },
      required: ['url', 'why'],
      additionalProperties: false,
    },
    async run(input) {
      const method = String(input.method ?? 'GET');
      const response = await http.request(String(input.url), {
        method,
        summary: `${method} ${String(input.url)} — ${String(input.why)}`,
      });
      onExchange?.(response.evidenceId, `${method} ${response.url} → ${response.status}`);
      const headers = Object.entries(response.headers)
        .map(([name, value]) => `${name}: ${value}`)
        .join('\n');
      return [
        `Evidence ${response.evidenceId}`,
        `HTTP ${response.status} ${response.url}`,
        headers,
        '',
        response.body.slice(0, 4_000),
        // Two different truncations, and only one of them used to be named.
        // `truncated` is the read cap on the wire; this slice is ours, and a
        // body cut here without saying so invites a conclusion about what the
        // response does not contain.
        response.body.length > 4_000
          ? `\n[body shown to 4000 of ${response.body.length} characters]`
          : '',
        response.truncated ? '\n[the response was larger than this client reads]' : '',
      ].join('\n');
    },
  };
}
