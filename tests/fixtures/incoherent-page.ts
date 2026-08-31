/**
 * A page assembled a piece at a time, and the same page with a scale.
 *
 * Nothing here is a mistake anybody would defend, and nothing here is unusual.
 * Every value was plausible when it was written: a heading needed to be a bit
 * bigger, a card needed a bit more padding, a button was copied from somewhere
 * and adjusted. That is exactly how a page ends up with eleven type sizes and
 * five button styles, and why the person who built it cannot see it — they
 * chose every one of those values on purpose, one at a time.
 *
 * `?fixed=1` is the same content on a scale: five type sizes, one spacing grid,
 * two button styles, two radii, readable text, real copy.
 *
 * The pair is what makes the checks mean anything. A check that finds sprawl on
 * every page is a check that has not been shown to distinguish.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface PageFixture {
  readonly url: string;
  readonly host: string;
  close(): Promise<void>;
}

const MESSY = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Kettle</title>
<style>
  body { font-family: Georgia, serif; margin: 0; background: #ffffff; color: #333; }
  .wrap { padding: 37px; }
  h1 { font-size: 41px; font-family: Impact, sans-serif; margin-bottom: 13px; }
  h3 { font-size: 27px; font-family: Verdana, sans-serif; margin-top: 22px; }
  h5 { font-size: 19px; margin-top: 9px; }
  .lede { font-size: 21px; color: #555; margin-bottom: 18px; }
  .body { font-size: 15px; color: #4a4a4a; }
  .small { font-size: 13px; color: #999; }
  .tiny { font-size: 11px; color: #b4b4b4; }
  .faint { font-size: 12px; color: #c9c9c9; }
  .card { padding: 17px; border-radius: 3px; border: 1px solid #ddd; margin-bottom: 21px; }
  .panel { padding: 26px; border-radius: 11px; background: #f7f7f7; margin-bottom: 14px; }
  .box { padding: 9px; border-radius: 6px; border: 2px solid #eee; margin-bottom: 33px; }
  .note { padding: 23px; border-radius: 18px; background: #fafafa; }
  .btn-a { font-size: 16px; padding: 11px 19px; border-radius: 4px; background: #2b6cb0; color: #fff; border: none; }
  .btn-b { font-size: 14px; padding: 7px 23px; border-radius: 14px; background: #38a169; color: #fff; border: none; }
  .btn-c { font-size: 18px; padding: 15px 12px; border-radius: 0; background: #dd6b20; color: #fff; border: none; }
  .btn-d { font-size: 13px; padding: 6px 9px; border-radius: 9px; background: #fff; color: #2b6cb0; border: 1px solid #2b6cb0; }
  .icon { font-size: 12px; padding: 2px; background: #eee; border: none; border-radius: 2px; }
</style></head>
<body><div class="wrap">
  <h1>Kettle</h1>
  <p class="lede">The fastest way to buy a kettle.</p>
  <h3>Why Kettle</h3>
  <p class="body">We sell kettles. Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
  <div class="card"><h5>Fast</h5><p class="small">Your order arrives quickly.</p></div>
  <div class="panel"><h5>Cheap</h5><p class="tiny">Prices you can live with.</p></div>
  <div class="box"><h5>Simple</h5><p class="faint">Nothing you do not need.</p></div>
  <div class="note"><p class="small">Questions? Write to us at hello@example.com.</p></div>
  <p>
    <button class="btn-a">Buy a kettle</button>
    <button class="btn-b">See the range</button>
    <button class="btn-c">Talk to us</button>
    <button class="btn-d">Read the terms</button>
    <button class="icon" aria-label="Close">x</button>
  </p>
</div></body></html>`;

const COHERENT = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Kettle</title>
<style>
  :root { --space: 8px; --radius: 8px; --radius-sm: 4px; }
  body { font-family: system-ui, sans-serif; margin: 0; background: #ffffff; color: #1a1a1a; }
  .wrap { padding: 32px; }
  h1 { font-size: 40px; margin-bottom: 16px; }
  h2 { font-size: 24px; margin-top: 32px; }
  h3 { font-size: 18px; }
  .lede { font-size: 20px; color: #444444; margin-bottom: 16px; }
  .body, .small { font-size: 16px; color: #1a1a1a; }
  .card, .panel, .box, .note {
    padding: 24px; border-radius: var(--radius); border: 1px solid #d4d4d4; margin-bottom: 16px;
  }
  .btn-a { font-size: 16px; padding: 12px 24px; border-radius: var(--radius-sm); background: #1a4f8a; color: #fff; border: none; }
  .btn-d { font-size: 16px; padding: 12px 24px; border-radius: var(--radius-sm); background: #fff; color: #1a4f8a; border: 1px solid #1a4f8a; }
  .icon { font-size: 16px; padding: 12px; background: #fff; color: #1a4f8a; border: 1px solid #1a4f8a; border-radius: var(--radius-sm); }
</style></head>
<body><div class="wrap">
  <h1>Kettle</h1>
  <p class="lede">The fastest way to buy a kettle.</p>
  <h2>Why Kettle</h2>
  <p class="body">We sell kettles, we ship them the same day, and we take them back if you change your mind.</p>
  <div class="card"><h3>Fast</h3><p class="small">Ordered before four, posted the same afternoon.</p></div>
  <div class="panel"><h3>Cheap</h3><p class="small">One price, including delivery, shown before you pay.</p></div>
  <div class="box"><h3>Simple</h3><p class="small">Four kettles. We think one of them is right for you.</p></div>
  <div class="note"><p class="small">Questions? Write to us at hello@kettle.test.</p></div>
  <p>
    <button class="btn-a">Buy a kettle</button>
    <button class="btn-d">See the range</button>
    <button class="btn-d">Talk to us</button>
    <button class="btn-d">Read the terms</button>
    <button class="icon" aria-label="Close">x</button>
  </p>
</div></body></html>`;

export async function startIncoherentPage(): Promise<PageFixture> {
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const body = url.searchParams.get('fixed') === '1' ? COHERENT : MESSY;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/`,
    host: `127.0.0.1:${port}`,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
