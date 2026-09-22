/**
 * Two subscription sites: one you can leave, one you have to write a letter to.
 *
 * Neither is unusual. The hard one does nothing that is not done every day by
 * companies nobody thinks of as dishonest — the subscribe button is on the home
 * page, the cancel route is three pages in behind "Manage preferences", and at
 * the end of it there is an address to email rather than a button to press.
 * That is the point: it is a series of ordinary decisions that add up to an
 * exit nobody finds.
 *
 * `?fair=1` is the same service with the way out where the way in is.
 *
 * `?layered=1` is the ordinary case that broke the measurement: a footer on
 * every page that mentions cancelling and carries a newsletter form, a pricing
 * page that is a step towards joining rather than the place you join, and the
 * real exit one click further than the first page that looked like it.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface SubscriptionFixture {
  readonly url: string;
  readonly host: string;
  close(): Promise<void>;
}

const wrap = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

const HARD: Record<string, string> = {
  '/': wrap(
    'Kettle Club',
    `<h1>Kettle Club</h1><p>A kettle every month.</p>
     <a href="/join">Start your free trial</a>
     <a href="/account">Your account</a>
     <a href="/about">About us</a>`,
  ),
  '/join': wrap('Join', `<h1>Start your trial</h1><form><button>Subscribe now</button></form>`),
  '/account': wrap(
    'Your account',
    `<h1>Your account</h1><a href="/account/settings">Account settings</a>`,
  ),
  '/account/settings': wrap(
    'Settings',
    `<h1>Settings</h1><a href="/account/settings/membership">Manage your membership</a>`,
  ),
  '/account/settings/membership': wrap(
    'Membership options',
    `<h1>Membership options</h1>
     <p>We would be sorry to see you go. To cancel your subscription, please email us at
     support@kettleclub.test and our team will get back to you within five working days.</p>`,
  ),
  '/about': wrap('About', `<h1>About</h1><p>We like kettles.</p>`),
};

const FAIR: Record<string, string> = {
  '/': wrap(
    'Kettle Club',
    `<h1>Kettle Club</h1><p>A kettle every month.</p>
     <a href="/join">Start your free trial</a>
     <a href="/cancel">Cancel your subscription</a>
     <a href="/about">About us</a>`,
  ),
  '/join': wrap('Join', `<h1>Start your trial</h1><form><button>Subscribe now</button></form>`),
  '/cancel': wrap(
    'Cancel',
    `<h1>Cancel your subscription</h1>
     <p>This stops your subscription at the end of the current month. Nothing else is needed.</p>
     <form method="post"><button type="submit">Cancel my subscription</button></form>`,
  ),
  '/about': wrap('About', `<h1>About</h1><p>We like kettles.</p>`),
};

/** A footer of the kind every page of an ordinary site carries. */
const FOOTER = `<footer>
  <p>You can cancel your subscription at any time.</p>
  <form action="/newsletter"><input name="email"><button>Subscribe to our newsletter</button></form>
  <a href="/about">About us</a>
</footer>`;

const LAYERED: Record<string, string> = {
  '/': wrap(
    'Kettle Club',
    `<h1>Kettle Club</h1><p>A kettle every month.</p>
     <a href="/pricing">Pricing</a>
     <a href="/account">Your account</a>
     ${FOOTER}`,
  ),
  // A page about what things cost, not a page you join on. The old rule took
  // the first link whose text matched, so this fixed the way in at one click.
  '/pricing': wrap(
    'Pricing',
    `<h1>Pricing</h1><p>Standard is R99 a month.</p>
     <a href="/join">Choose Standard</a>
     ${FOOTER}`,
  ),
  '/join': wrap(
    'Join',
    `<h1>Start your trial</h1><form action="/join"><button>Subscribe now</button></form>${FOOTER}`,
  ),
  '/account': wrap(
    'Your account',
    `<h1>Your account</h1><a href="/account/settings">Account settings</a>${FOOTER}`,
  ),
  // The page the old rule called the exit: it mentions cancelling in its
  // footer and has a form in the same footer, and it is neither.
  '/account/settings': wrap(
    'Settings',
    `<h1>Settings</h1>
     <a href="/cancel">Cancel your subscription</a>
     <a href="/account/settings/address">Change your address</a>
     ${FOOTER}`,
  ),
  '/account/settings/address': wrap('Address', `<h1>Change your address</h1>${FOOTER}`),
  '/cancel': wrap(
    'Cancel',
    `<h1>Cancel your subscription</h1>
     <p>This stops your subscription at the end of the current month.</p>
     <form method="post" action="/cancel"><button type="submit">Cancel my subscription</button></form>
     ${FOOTER}`,
  ),
  '/about': wrap('About', `<h1>About</h1><p>We like kettles.</p>${FOOTER}`),
};

export async function startSubscriptionSite(): Promise<SubscriptionFixture> {
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const variant =
      url.searchParams.get('fair') === '1'
        ? 'fair'
        : url.searchParams.get('layered') === '1'
          ? 'layered'
          : 'hard';
    const pages = variant === 'fair' ? FAIR : variant === 'layered' ? LAYERED : HARD;
    const body = pages[url.pathname];
    if (!body) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
      return;
    }
    // The query string has to survive a click, or the fair site's links land on
    // the hard site and the fixture quietly tests one page twice.
    const carried =
      variant === 'hard'
        ? body
        : body.replace(
            /href="([^"]+)"/g,
            (m, href) =>
              `href="${href}${String(href).includes('?') ? '&' : '?'}${variant === 'fair' ? 'fair' : 'layered'}=1"`,
          );
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(carried);
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
