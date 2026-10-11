#!/usr/bin/env tsx
/**
 * Generates a badge signing key.
 *
 * Writes to stdout and never to a file. If this key leaks, every badge becomes
 * forgeable, so the only place it should ever be written down is the platform
 * secret store — and a generator that helpfully drops a `.pem` next to your
 * source tree is a generator that eventually commits one.
 *
 *   pnpm badge:keygen                 generate a key with a dated id
 *   pnpm badge:keygen my-key-id       generate a key with a chosen id
 *
 * Rotation: generate a new key, move the old public JWK into
 * VIBEFYCODE_BADGE_RETIRED_KEYS, and point VIBEFYCODE_BADGE_KEY_ID at the new one.
 * Retired public keys stay published forever — removing one would silently break
 * every badge it ever signed, and a verifier that suddenly fails cannot tell
 * "forged" from "VibefyCode tidied up".
 *
 * The output used to say the public half "does not need to be configured"
 * because it is derived from the private key at start-up. That was true of the
 * code and impossible to follow: the runbook puts the private key on the worker
 * alone, and the deployment that publishes the key set is the console. So the
 * public line is printed as a variable to set rather than as a comment to keep.
 */
import { generateSigningKey, publishedKeysLine } from '@vibefycode/badge';

const kid = process.argv[2] ?? `vibefycode-badge-${new Date().toISOString().slice(0, 7)}`;
const { privateKeyB64, jwk } = generateSigningKey(kid);

const lines = [
  '# The worker (Render). Secret store only, never the repository.',
  `VIBEFYCODE_BADGE_KEY_ID=${kid}`,
  `VIBEFYCODE_BADGE_SIGNING_KEY_B64=${privateKeyB64}`,
  '',
  '# The console (Vercel). Public data: this is the half that verifies a badge,',
  '# and it is served to anybody at /.well-known/vibefycode-badge-key. Without it',
  '# that route answers 503 and no badge verifies anywhere.',
  '#',
  '# Rotating: put the new key first and keep the old entry, or move the old one',
  '# to VIBEFYCODE_BADGE_RETIRED_KEYS. Never drop it — every badge it signed',
  '# stops verifying, and a verifier cannot tell that from a forgery.',
  publishedKeysLine(jwk),
];

console.log(lines.join('\n'));
console.error(
  '\nGenerated. The first two go to the worker and the third to the console. Then clear your terminal history.\n',
);
