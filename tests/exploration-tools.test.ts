/**
 * What the tools tell the model, and what they leave out.
 *
 * The model-driven stages reason about absence — "there is no way to log out",
 * "there is no cancel link", "state did not survive a refresh" — and every one
 * of those conclusions is drawn from what a tool handed back. A tool that
 * quietly shows part of a page, or reports an action that did not happen, is
 * not a tool that is merely incomplete: it manufactures findings about
 * somebody's application out of our own truncation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BrowserSession } from '../packages/engine/src/runtime/browser.ts';
import { EvidenceStore } from '../packages/engine/src/runtime/evidence.ts';
import { DEFAULT_CEILING, ScopeGuard } from '../packages/engine/src/runtime/scope.ts';
import { browserTools } from '../packages/engine/src/stages/tools.ts';

let server: Server;
let base: string;
let session: BrowserSession;

/** A page with more controls than the description will list, and more text. */
const crowded = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Crowded</title></head>
<body>
${Array.from({ length: 90 }, (_, index) => `<a href="/p${index}">Link ${index}</a>`).join('\n')}
<a href="/logout">Log out</a>
<p>${'The quick brown fox jumps over the lazy dog. '.repeat(400)}</p>
</body></html>`;

const plain = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Plain</title></head>
<body><h1>Plain</h1><a href="/about">About</a></body></html>`;

beforeAll(async () => {
  server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(request.url?.startsWith('/crowded') ? crowded : plain);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  session = new BrowserSession(
    new ScopeGuard({
      allowedHosts: ['127.0.0.1'],
      exclusions: [],
      ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600, maxTotalRequests: 400 },
      allowPrivateNetworkForTesting: true,
    }),
    new EvidenceStore('tools'),
  );
  await session.open();
}, 120_000);

afterAll(async () => {
  await session?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

const tool = (name: string) => browserTools({ session }).find((entry) => entry.name === name)!;

describe('describing a page', () => {
  it('says how much of it was left out', async () => {
    const described = await tool('navigate').run({ url: `${base}/crowded` });
    // 91 links, 60 shown. Without this the model is handed a list that ends
    // where our slice ended and told it is the page.
    expect(described).toMatch(/Only 60 of 91 interactive elements are listed/);
    expect(described).toMatch(/do not conclude that something is absent/i);
    expect(described).toMatch(/page text above is cut short/i);
  });

  it('says nothing of the kind about a page that fitted', async () => {
    // The half that makes the other half mean something: a warning on every
    // page is a warning on none.
    const described = await tool('navigate').run({ url: `${base}/plain` });
    expect(described).not.toMatch(/interactive elements are listed/);
    expect(described).not.toMatch(/cut short/i);
  });
});

describe('an action that did not happen', () => {
  it('is not reported as one that did', async () => {
    // Its own session, so there is genuinely nothing behind the first page.
    const fresh = new BrowserSession(
      new ScopeGuard({
        allowedHosts: ['127.0.0.1'],
        exclusions: [],
        ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600, maxTotalRequests: 400 },
        allowPrivateNetworkForTesting: true,
      }),
      new EvidenceStore('tools-back'),
    );
    await fresh.open();
    try {
      const tools = browserTools({ session: fresh });
      await tools.find((entry) => entry.name === 'navigate')!.run({ url: `${base}/plain` });
      // Nothing to go back to. This used to answer "Back at <url>" with the
      // page description beneath it, which reads as a back button that worked
      // and returned to the same page.
      const result = await tools.find((entry) => entry.name === 'go_back')!.run({});
      expect(result).toMatch(/the back button did nothing/i);
      expect(result).not.toMatch(/^Back at/);
    } finally {
      await fresh.close();
    }
  }, 60_000);

  it('reports a reload that did happen', async () => {
    // A reload tool that always claims success answers "does state survive a
    // refresh?" with yes, for a refresh that never occurred.
    await tool('navigate').run({ url: `${base}/plain` });
    const result = await tool('reload').run({});
    expect(result).toMatch(/^Reloaded /);
  });
});
