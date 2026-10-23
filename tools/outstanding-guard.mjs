#!/usr/bin/env node
/**
 * Rewrites `docs/sql/OUTSTANDING.sql` so every block is safe to run twice.
 *
 * That document is the only file in this repository somebody runs against the
 * production database by hand. Its own header has promised since it was written
 * that "elke blok is so geskryf dat dit homself nie twee keer doen nie" — run
 * it again and nothing happens — and it carried the migrations verbatim, which
 * are deliberately written for a database that does not have them yet.
 *
 * So the promise was false. Found on 2026-10-23, by the founder, when a paste
 * stopped on:
 *
 *     ERROR: 42710: policy "reviews_need_second_step" for table "reviews"
 *     already exists
 *
 * — the first block of twenty-one, on a database that already had it. The paste
 * is one implicit transaction, so everything else rolled back too: twenty-one
 * migrations' worth of work undone by one statement that could not say "already
 * done".
 *
 * The transformation is `tools/idempotent.mjs`, the same one the catch-up file
 * is built with. This tool applies it to each block body in place and leaves
 * every banner, every `audit-marker` and the Afrikaans header untouched.
 *
 *     node tools/outstanding-guard.mjs          # rewrite the document
 *     node tools/outstanding-guard.mjs --check  # say whether it would change
 *
 * `tests/the-sql-i-ask-him-to-paste.test.ts` holds the result two ways: each
 * block must equal the guarded form of its migration, and the whole document
 * must apply twice to a database without an error.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { idempotent } from './idempotent.mjs';

const DOCUMENT = 'docs/sql/OUTSTANDING.sql';
const MIGRATIONS = 'supabase/migrations';
const check = process.argv.includes('--check');
const NEWLINE = '\n';

/** The same split the test uses: a banner naming a migration, then its body. */
const BANNER = /^-- =+\n-- ([0-9]{14}_[a-z0-9_]+\.sql)\n-- =+\n/m;

const document = readFileSync(DOCUMENT, 'utf8');
const parts = document.split(BANNER);
let out = parts[0] ?? '';
let changed = 0;

for (let index = 1; index < parts.length; index += 2) {
  const name = parts[index];
  const body = parts[index + 1] ?? '';
  /*
   * Guarded from the migration rather than from the body already in the
   * document, so running this twice cannot guard a guard — `drop policy if
   * exists` would otherwise collect another `if exists` on every pass.
   */
  const migration = readFileSync(join(MIGRATIONS, name), 'utf8');
  const guarded = idempotent(migration);
  /*
   * The body carries two things the migration does not, and they sit on either
   * side of it.
   *
   * Above: `audit-marker` lines. Most migrations carry their own on line one
   * and it arrives with the text; three of the twenty-one have none and the
   * document adds one, which is what `tools/migration-audit.mjs` reads to tell
   * somebody what their database already has. So the document's markers are
   * kept and the ones already in the text are not repeated — the hand-assembled
   * version had several of them twice.
   *
   * Below: the `-- BLOK n VAN 21` line belonging to the *next* block. The
   * banner is what the split cuts on and that marker is written above the
   * banner, so it lands at the end of the previous body. The first version of
   * this tool dropped it, and rewriting the document removed twenty of the
   * twenty-one numbers its header tells him to read out when a paste stops —
   * which is the one sentence he has to be able to say back to me.
   */
  const already = new Set(guarded.split(NEWLINE));
  const markers = [
    ...new Set(body.split(NEWLINE).filter((line) => line.startsWith('-- audit-marker:'))),
  ].filter((line) => !already.has(line));
  const nextBlock = /\n(-- BLOK \d+ VAN \d+\n)$/.exec(body)?.[1] ?? '';
  const above = markers.length === 0 ? '' : markers.join(NEWLINE) + NEWLINE;
  const below = nextBlock === '' ? '' : NEWLINE + nextBlock;
  const rebuilt = above + guarded.replace(/^\uFEFF/, '').replace(/\n+$/, NEWLINE) + below;
  if (rebuilt !== body) changed += 1;
  out += `-- =============================================================================\n-- ${name}\n-- =============================================================================\n${rebuilt}`;
}

if (check) {
  if (changed === 0) {
    console.log(
      `✓ ${DOCUMENT} is guarded: every block matches its migration, rewritten to re-run.`,
    );
    process.exit(0);
  }
  console.error(
    `✗ ${changed} block(s) in ${DOCUMENT} are not the guarded form of their migration.`,
  );
  console.error('  Run: node tools/outstanding-guard.mjs');
  process.exit(1);
}

writeFileSync(DOCUMENT, out);
console.log(`✓ ${changed} block(s) rewritten in ${DOCUMENT}.`);
