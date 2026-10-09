/**
 * The tools a model-driven stage is allowed to use.
 *
 * This is the whole surface: there is no shell, no filesystem, no arbitrary
 * code execution, and no way to reach the network except through a tool defined
 * here. Every one of them goes through the scope guard, so the boundary is not a
 * property of how the tools are described in a prompt — it is a property of what
 * the functions can physically do.
 */
import type { Locator } from 'playwright';
import type { BrowserSession } from '../runtime/browser.ts';
import type { ScopedHttp } from '../runtime/http.ts';
import type { ToolDefinition } from '../model/client.ts';
import { classifyStop } from '../runtime/stop.ts';
import { destructivePhraseIn, type RefusedControl } from '../runtime/destructive-controls.ts';
import {
  secretFieldKind,
  type FieldIdentity,
  type RefusedCredential,
} from '../runtime/credential-fields.ts';
import type { SyntheticCredentials } from './types.ts';
import type { IntensityCeiling } from '../runtime/scope.ts';

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

/**
 * What a person would have read on the control about to be clicked.
 *
 * Three sources in order, because none of them is always there. `innerText` is
 * what a button says; the accessible name is what a screen reader would
 * announce and is the only thing an icon button has; `value` is where a
 * `<input type="submit">` keeps its label and it has no text node at all.
 *
 * Returns the empty string when the element cannot be read. The caller treats
 * that as "not known to be destructive" on purpose — refusing every unlabelled
 * control would stop the pass on most applications, and an unreadable button is
 * not evidence of anything.
 */
async function readControlLabel(locator: Locator): Promise<string> {
  for (const read of [
    () => locator.innerText({ timeout: 2_000 }),
    () => locator.getAttribute('aria-label', { timeout: 2_000 }),
    () => locator.getAttribute('value', { timeout: 2_000 }),
    () => locator.getAttribute('title', { timeout: 2_000 }),
  ]) {
    try {
      const value = await read();
      if (value !== null && value.trim().length > 0) return value;
    } catch {
      // An element that disappeared between being located and being read is a
      // page that moved, not a refusal. The click below will report it.
    }
  }
  return '';
}

/**
 * What the field about to be filled says it is.
 *
 * One `evaluate` rather than four `getAttribute` calls, so the four values come
 * from the same element at the same instant: a page that re-rendered halfway
 * through could otherwise hand back the `type` of one field and the `name` of
 * the next. Returns null when the element cannot be read at all, and the caller
 * lets `fill` itself report that — an element that cannot be read cannot be
 * filled either, so nothing is let through by failing open here.
 */
async function readFieldIdentity(locator: Locator): Promise<FieldIdentity | null> {
  try {
    return await locator.evaluate(
      (element) => ({
        type: element.getAttribute('type') ?? '',
        autocomplete: element.getAttribute('autocomplete') ?? '',
        name: element.getAttribute('name') ?? '',
        id: element.getAttribute('id') ?? '',
      }),
      undefined,
      { timeout: 10_000 },
    );
  } catch {
    return null;
  }
}

export interface BrowserToolOptions {
  readonly session: BrowserSession;
  readonly onScreenshot?: (evidenceId: string, caption: string) => void;
  /**
   * The intensity ceiling the customer authorised.
   *
   * Required rather than optional, and not defaulted. `click` is the one tool
   * here that can change somebody's data, and a ceiling that arrives as
   * `undefined` and is treated as permissive is exactly the shape of defect
   * this is here to close.
   */
  readonly ceiling: IntensityCeiling;
  /** Called when a click is refused, so the stage can say so in its notes. */
  readonly onRefusedControl?: (refused: RefusedControl) => void;
  /**
   * The synthetic account the owner provisioned for this run, or `undefined`
   * when none was.
   *
   * Required rather than optional, for the same reason as `ceiling`: `fill` is
   * the one tool here that can type a secret into somebody's live application,
   * and a caller that simply forgot to pass this would get the permissive
   * reading of "we were given nothing". Writing it out makes that a compile
   * error instead.
   */
  readonly credentials: SyntheticCredentials | undefined;
  /** Called when a fill is refused, so the stage can say so in its notes. */
  readonly onRefusedCredential?: (refused: RefusedCredential) => void;
}

export function browserTools({
  session,
  onScreenshot,
  ceiling,
  onRefusedControl,
  credentials,
  onRefusedCredential,
}: BrowserToolOptions): ToolDefinition[] {
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
        'Click an element. Prefer a visible text label; fall back to a CSS selector when the text is ambiguous. ' +
        'A control that would delete data, close an account or spend money is refused — that refusal is the ' +
        'authorisation working, so note what you found and read the page instead of looking for another way to press it.',
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

        /*
         * The warranty, enforced where the click happens.
         *
         * `legal/authorisation-to-test.md` says under "We will not": "Modify,
         * delete or exfiltrate data", and every authorisation row carries
         * `allow_data_modification: false` under a constraint that will not let
         * it be anything else. Until now the only thing standing between the
         * model and a "Delete account" button was a sentence in a tool
         * description.
         *
         * The label is read from the page rather than from the model's input,
         * because the input may be a CSS selector and because what matters is
         * what a person would have read on the control. `innerText` first, then
         * the accessible name, then the value — a submit input carries its
         * label in `value` and has no text at all.
         */
        if (!ceiling.allowDataModification) {
          const label = await readControlLabel(locator);
          const phrase = destructivePhraseIn(label);
          if (phrase !== null) {
            const refused: RefusedControl = { label: label.replace(/\s+/g, ' ').trim(), phrase };
            onRefusedControl?.(refused);
            return (
              `Refused: "${refused.label}" reads as a control that would modify or destroy data, ` +
              `and this authorisation does not permit that (matched "${phrase}"). ` +
              `The control exists and you have seen it — that is the observation. Report it from the ` +
              `page rather than by pressing it.`
            );
          }
        }

        await locator.click({ timeout: 10_000 });
        await session.page.waitForLoadState('domcontentloaded').catch(() => undefined);
        return `Clicked. Now at ${session.page.url()}\n\n${await describePage(session)}`;
      },
    },
    {
      name: 'fill',
      description:
        'Type a value into a form field. A password, passcode or one-time-code field is refused unless the ' +
        'value is exactly the synthetic test password the owner provisioned for this run — that refusal is the ' +
        'authorisation working, so record what is behind the sign-in as unreachable rather than looking for a ' +
        'value that would be accepted.',
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
        const selector = String(input.selector);
        const value = String(input.value);
        const locator = session.page.locator(selector).first();

        /*
         * The one rule on this tool surface that still lived only in a prompt.
         *
         * The description above used to end "never invent credentials and never
         * try ones you were not given", and that was the whole of it: nothing
         * stopped the model typing `admin` into a password field on somebody's
         * live application and pressing the button next to it. That is
         * unauthorised credential testing, which is the single act every signed
         * authorisation is written to put out of bounds, and PART 6.2 of the
         * brief is absolute about it.
         *
         * Decided from the field, not from the model's intent — see
         * `secretFieldKind`. A password field accepts exactly the password the
         * owner provisioned; a one-time-code field accepts nothing, because
         * nobody provisioned a code and a code we chose would be a guess.
         */
        const field = await readFieldIdentity(locator);
        const kind = field === null ? null : secretFieldKind(field);
        if (kind === 'code') {
          onRefusedCredential?.({ selector, kind, because: 'no_code_exists' });
          return (
            `Refused: ${selector} asks for a one-time code or card security code, and no such code was ` +
            `provisioned for this run. One we chose would be a guess against a live account. Record the ` +
            `field as reached and the step past it as unreachable.`
          );
        }
        if (kind === 'password') {
          if (credentials === undefined) {
            onRefusedCredential?.({ selector, kind, because: 'none_provisioned' });
            return (
              `Refused: ${selector} is a password field and this run was given no test account, so there ` +
              `is no value it may receive. Inventing one would be credential testing we are not authorised ` +
              `to do. Everything behind sign-in is out of reach for this run — report that as a limit of ` +
              `the assessment, not as a property of the application.`
            );
          }
          if (value !== credentials.password) {
            onRefusedCredential?.({ selector, kind, because: 'not_the_provisioned_one' });
            return (
              `Refused: the value offered for ${selector} is not the one the owner provisioned for this ` +
              `run. The synthetic test password is the only password this tool will type.`
            );
          }
        }

        await locator.fill(value, { timeout: 10_000 });
        return `Filled ${selector}.`;
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
