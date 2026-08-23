/**
 * A deliberately flawed "vibe-coded" application.
 *
 * Every defect here is one the rubric names and one that recurs in real
 * AI-assisted builds: a key in the client bundle, a config file left in the
 * document root, authorisation enforced only in the interface, sequential
 * identifiers, cookies without flags, and a page that was never opened on a
 * phone. It exists so the engine can be tested against something that actually
 * fails, rather than against a mock that agrees with us.
 *
 * It is only ever bound to loopback, and the test scope policy is the only place
 * in the codebase permitted to reach a private address.
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// Assembled at runtime rather than written as a literal. It is a fabricated
// value the engine is meant to find in the served page, but a push-protection
// scanner cannot tell a fake key from a real one by looking at it — and it is
// right not to try.
const FAKE_STRIPE_KEY = 'sk' + '_live_' + '51QQQQQQQQQQQQQQQQQQQQQQQ';

const ORDERS = [
  { id: 1, owner: 'alice@example.test', item: 'Kettle', total: '42.00' },
  { id: 2, owner: 'bob@example.test', item: 'Toaster', total: '18.50' },
  { id: 3, owner: 'carol@example.test', item: 'Blender', total: '61.25' },
];

const LANDING = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Kettle — buy kettles online</title>
  <style>
    body { font-family: sans-serif; margin: 0; }
    .hero { width: 1400px; padding: 40px; background: #eee; }
    .faint { color: #b8b8b8; background: #ffffff; }
  </style>
</head>
<body>
  <div class="hero">
    <h1>Kettle</h1>
    <img src="/kettle.png">
    <p class="faint">The fastest way to buy a kettle.</p>
    <form action="/signup" method="post">
      <input type="email" name="email" placeholder="Email">
      <input type="password" name="password" placeholder="Password">
      <button type="submit">Sign up</button>
    </form>
    <a href="/orders">Your orders</a>
  </div>
  <script>
    // Shipped straight to the browser, as it was written.
    const STRIPE_KEY = "${FAKE_STRIPE_KEY}"; // secret-scan-allow: fabricated fixture value, never a real key
    const API = "http://localhost:4000/api";
    window.__CONFIG__ = { stripe: STRIPE_KEY, api: API };
  </script>
</body>
</html>`;

const ADMIN = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Admin</title></head>
<body>
  <h1>Admin dashboard</h1>
  <p>Total revenue: 121.75</p>
  <ul><li>alice@example.test</li><li>bob@example.test</li><li>carol@example.test</li></ul>
  <script>
    // "Authorisation": the page is already rendered by the time this runs.
    if (!localStorage.getItem('isAdmin')) { document.body.style.display = 'none'; }
  </script>
</body></html>`;

function send(
  response: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
  response.end(body);
}

export interface FixtureApp {
  readonly url: string;
  readonly host: string;
  close(): Promise<void>;
}

export async function startVulnerableApp(): Promise<FixtureApp> {
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (path === '/' || path === '/index.html') {
      // No CSP, no nosniff, no referrer policy, no frame protection, and a
      // session cookie with none of the three flags that matter.
      send(response, 200, LANDING, {
        'set-cookie': 'session=abc123; Path=/',
        'x-powered-by': 'Express 4.18.2',
      });
      return;
    }

    if (path === '/.env') {
      // Fabricated values. The engine is supposed to find these and call them
      // critical; that is the whole point of the fixture.
      const leakedEnv = [
        'DATABASE_URL=postgres://app:hunter2@db.internal:5432/kettle', // secret-scan-allow: fixture
        `STRIPE_SECRET_KEY=${FAKE_STRIPE_KEY}`, // secret-scan-allow: fixture
        '',
      ].join('\n');
      send(response, 200, leakedEnv, { 'content-type': 'text/plain' });
      return;
    }

    if (path === '/admin') {
      send(response, 200, ADMIN);
      return;
    }

    if (path.startsWith('/api/orders/')) {
      const id = Number(path.split('/').pop());
      const order = ORDERS.find((candidate) => candidate.id === id);
      response.writeHead(order ? 200 : 404, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-credentials': 'true',
      });
      response.end(JSON.stringify(order ?? { error: 'not found' }));
      return;
    }

    if (path === '/orders') {
      send(
        response,
        200,
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Orders</title></head>
<body><h1>Your orders</h1><ul>${ORDERS.map((order) => `<li><a href="/api/orders/${order.id}">Order ${order.id}</a></li>`).join('')}</ul></body></html>`,
      );
      return;
    }

    if (path === '/signup' && request.method === 'POST') {
      send(
        response,
        200,
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Welcome</title></head><body><h1>Welcome</h1><p>Your account is ready.</p></body></html>',
        {
          'set-cookie': 'session=signed-up; Path=/',
        },
      );
      return;
    }

    if (path === '/kettle.png') {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64',
        ),
      );
      return;
    }

    send(
      response,
      404,
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title></head><body><h1>Not found</h1></body></html>',
    );
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const host = `127.0.0.1:${address.port}`;

  return {
    url: `http://${host}/`,
    host,
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
