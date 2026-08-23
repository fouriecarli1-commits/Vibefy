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
 */
import { generateSigningKey } from '@vibefycode/badge';

const kid = process.argv[2] ?? `vibefycode-badge-${new Date().toISOString().slice(0, 7)}`;
const { privateKeyB64, jwk } = generateSigningKey(kid);

const lines = [
  '# Add these to the platform secret store. Never to the repository.',
  `VIBEFYCODE_BADGE_KEY_ID=${kid}`,
  `VIBEFYCODE_BADGE_SIGNING_KEY_B64=${privateKeyB64}`,
  '',
  '# The public half is served at /.well-known/vibefycode-badge-key. It is derived',
  '# from the private key at start-up, so it does not need to be configured —',
  '# but keep a copy for the retired-keys list when you rotate:',
  `# ${JSON.stringify(jwk)}`,
];

console.log(lines.join('\n'));
console.error(
  '\nGenerated. Copy the two variables into your secret store, then clear your terminal history.\n',
);
