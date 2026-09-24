#!/usr/bin/env node
/**
 * Which sign-in providers this Supabase project has turned on, and why not.
 *
 * The sign-in page shows a provider's button only when Supabase says that
 * provider is enabled, which is right for a visitor and useless for whoever has
 * to set it up: a button that is absent looks exactly like a button that was
 * never built. Anré asked twice where the Google sign-in was, and the honest
 * answer was four steps in a console I cannot reach. This is how to ask.
 *
 *     pnpm providers
 *
 * Reads `/auth/v1/settings`, which GoTrue publishes with a boolean per provider.
 * It sends the anon key, writes nothing, and changes nothing.
 */
import { readFileSync, existsSync } from 'node:fs';

/** `.env.local` first, because that is where a local value actually lives. */
function envFromFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const fromFile = envFromFile('.env.local');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? fromFile.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? fromFile.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error(
    'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not set, in the\n' +
      'environment or in .env.local, so there is no project to ask.',
  );
  process.exit(1);
}

const response = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/settings`, {
  headers: { apikey: key },
}).catch((error) => {
  console.error(`Could not reach ${url}: ${error.message}`);
  process.exit(1);
});

if (!response.ok) {
  console.error(`${url} answered ${response.status} for /auth/v1/settings.`);
  process.exit(1);
}

const settings = await response.json();
const external = settings.external ?? {};

/*
 * The same nine, in the same order, as `apps/web/lib/social-providers.ts`.
 * Repeated rather than imported because this is a plain script that runs without
 * a build step, and a test holds the two lists to each other so they cannot
 * drift.
 *
 * Two ids are not what you would guess: X is still `twitter` in GoTrue, and
 * LinkedIn is `linkedin_oidc` — the older `linkedin` id is deprecated and
 * enabling it gets you a provider that answers and then fails at the token
 * exchange.
 */
const PROVIDERS = [
  ['google', 'Google'],
  ['apple', 'Apple'],
  ['github', 'GitHub'],
  ['discord', 'Discord'],
  ['twitter', 'X'],
  ['facebook', 'Facebook'],
  ['linkedin_oidc', 'LinkedIn'],
  ['spotify', 'Spotify'],
  ['twitch', 'Twitch'],
];

console.log(`Project: ${url}`);
console.log(`Email sign-up: ${settings.disable_signup === true ? 'disabled' : 'enabled'}`);
console.log('');
for (const [id, label] of PROVIDERS) {
  console.log(`  ${external[id] === true ? 'on ' : 'off'}  ${label.padEnd(9)} ${id}`);
}

const redirect = `${url.replace(/\/+$/, '')}/auth/v1/callback`;

/*
 * Printed whether or not anything is off.
 *
 * This used to appear only in the block for providers that are not enabled, and
 * the person who needs it most is the opposite one: somebody whose provider is
 * on, whose button appears, and who gets `Error 400: redirect_uri_mismatch` from
 * Google. That error means the URI in the provider's own console is not the one
 * Supabase sends — almost always because the app's address was put there instead
 * of Supabase's. The fix is one line, and it is this line.
 */
console.log('');
console.log('The authorised redirect URI every provider needs, and the one people get wrong:');
console.log(`  ${redirect}`);
console.log('');
console.log(
  'It is Supabase\u2019s address, not this application\u2019s, and it is the same for all nine.',
);
console.log('`redirect_uri_mismatch` from a provider means its console does not have this,');
console.log('character for character \u2014 no trailing slash, and https rather than http.');

const off = PROVIDERS.filter(([id]) => external[id] !== true);
if (off.length > 0) {
  console.log(
    [
      '',
      `${off.length} of ${PROVIDERS.length} are off, so the sign-in page does not show their`,
      'buttons. Each one is the same three steps, in consoles this repository cannot',
      'reach — and then nothing: the page asks Supabase on each render, cached for five',
      'minutes, so a button appears by itself once its provider is on.',
      '',
      '  1. Create an OAuth app with the provider. The authorised redirect URI is',
      '     Supabase\u2019s, not ours, and it is the same one for all of them:',
      `       ${redirect}`,
      '     Copy the client id and the client secret.',
      '',
      '  2. Supabase \u2192 Authentication \u2192 Providers \u2192 <the provider> \u2192 enable, and paste both.',
      '',
      '  3. Supabase \u2192 Authentication \u2192 URL Configuration. The Redirect URLs list must',
      '     include wherever the app is deployed, with the path:',
      '       https://<wherever>/auth/callback',
      '     Done once, for every provider. It is the step that is easy to miss, because',
      '     everything before it succeeds and the failure arrives at the very end,',
      '     after the provider has already said yes.',
      '',
      'Three of them ask for more than that, and it is worth knowing before you start:',
      '',
      '  \u00b7 Apple needs a paid Apple Developer account, and its guidelines are specific',
      '    about how the button may look \u2014 which is one reason none of these buttons',
      '    carries a drawn logo yet.',
      '  \u00b7 Facebook needs app review before anybody outside your own test users can',
      '    use it.',
      '  \u00b7 X requires a project on its developer portal with OAuth 2.0 turned on; the',
      '    older OAuth 1.0a keys will not work.',
    ].join('\n'),
  );
}
