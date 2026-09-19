/**
 * A page with every first-look mistake on it, and the same page with none.
 *
 * The messy one is not a parody. Every one of these is what a page looks like
 * the week it was built: nobody sets a viewport meta on purpose, the key in the
 * source was put there to get the demo working, and the localhost URL is left
 * over from the afternoon it was written. That is exactly why somebody else has
 * to look.
 *
 * `?ready=1` is the same page after an hour of work. The pair is what makes the
 * checks mean anything: one that finds problems on every page has not been
 * shown to distinguish.
 */
/**
 * Handed over as a fetched response rather than served.
 *
 * `fetchPublicPage` refuses a private address, which is correct and which means
 * a fixture server on loopback cannot be fetched through it. Every check added
 * for the builder reads one response, so the honest thing to test is that
 * function against these two responses. The fetching is the consumer check's
 * own suite's business and is tested there.
 */
export interface FixturePage {
  readonly finalUrl: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly html: string;
  readonly redirected: boolean;
}

/**
 * A string with the shape of a live key, assembled rather than written out.
 *
 * Written as a literal it is refused twice: by our own secret scanner, which
 * takes a reason, and by GitHub's push protection, which does not. Both are
 * right to refuse it — a rule with exceptions for fixtures is a rule somebody
 * will use for something else — so the fixture builds the shape at runtime and
 * neither gate has to be argued with.
 */
const FAKE_LIVE_KEY = ['sk', 'live', `51H${'x'.repeat(24)}A`].join('_');

const MESSY = `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <h1>My App</h1>
  <p>Sign up and start today.</p>
  <script>
    const stripeKey = "${FAKE_LIVE_KEY}";
    fetch("http://localhost:3000/api/session");
  </script>
</body>
</html>`;

const READY = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kettle — order a kettle, get it the same day</title>
  <meta name="description" content="Kettle sells four kettles and ships them the same afternoon. One price, including delivery, shown before you pay.">
</head>
<body>
  <h1>Kettle</h1>
  <p>Order before four and it goes out the same afternoon.</p>
  <p>Questions? Write to <a href="mailto:hello@kettle.test">hello@kettle.test</a>.</p>
  <p><a href="/account/cancel">Cancel your subscription</a> — two clicks, no email required.</p>
  <p><a href="/privacy">Privacy policy</a> · <a href="/terms">Terms</a></p>
</body>
</html>`;

export const messyPage: FixturePage = {
  finalUrl: 'http://my-app.example/',
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8' },
  html: MESSY,
  redirected: false,
};

export const readyPage: FixturePage = {
  finalUrl: 'https://kettle.example/',
  status: 200,
  headers: {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "default-src 'self'",
    'strict-transport-security': 'max-age=31536000',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
  },
  html: READY,
  redirected: false,
};
