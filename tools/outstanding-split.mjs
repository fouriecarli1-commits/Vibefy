#!/usr/bin/env node
/**
 * The outstanding migrations, one file per block, and a number on every block.
 *
 * `docs/sql/OUTSTANDING.sql` is one hundred kilobytes of SQL with nineteen
 * blocks in it, each introduced by a banner and a paragraph explaining itself.
 * Anré's words, 2026-10-11: *"Ek weet nie waar 'n sql moet begin nie."* He is
 * right, and the document was written for somebody who already knows what a
 * migration is.
 *
 * Two answers, both generated from that one file so there is nothing to keep in
 * step by hand:
 *
 *   · **A number above every banner** — `BLOK 7 VAN 19`. The paste is still the
 *     whole file in one go, which is verified to work; the numbers are so that
 *     he can see where he is, and so that "it stopped at block 12" is a
 *     sentence he can say to me.
 *   · **`docs/sql/een-vir-een/NN-<name>.sql`** — the same blocks as nineteen
 *     separate files, each one a complete paste on its own. For the day one of
 *     them fails and the rest should not be re-run, which is the only situation
 *     where going one at a time is better.
 *
 * Run it after appending a block to the document:
 *
 *     pnpm sql:blocks
 *
 * `tests/the-sql-i-ask-him-to-paste.test.ts` holds the output equal to the
 * document, so a block added and not re-split fails the gate rather than
 * leaving him a folder that is quietly one migration short.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DOCUMENT = 'docs/sql/OUTSTANDING.sql';
const FOLDER = 'docs/sql/een-vir-een';

/** The banner the document uses, and the one the test splits on. */
const BANNER = /^-- =+\n-- ([0-9]{14}_[a-z0-9_]+\.sql)\n-- =+\n/m;

export function splitBlocks(document) {
  const parts = document.split(BANNER);
  const names = parts.filter((_, index) => index % 2 === 1);
  const bodies = parts.filter((_, index) => index % 2 === 0).slice(1);
  const preamble = parts[0] ?? '';
  return { preamble, names, bodies };
}

/** The document with one `BLOK n VAN m` line above each banner. */
export function numbered(document) {
  const withoutOld = document.replace(/^-- BLOK \d+ VAN \d+.*\n/gm, '');
  const { names } = splitBlocks(withoutOld);
  let index = 0;
  return withoutOld.replace(/^(-- =+\n-- [0-9]{14}_[a-z0-9_]+\.sql\n-- =+\n)/gm, (banner) => {
    index += 1;
    return `-- BLOK ${index} VAN ${names.length}\n${banner}`;
  });
}

function main() {
  const document = readFileSync(DOCUMENT, 'utf8');
  const marked = numbered(document);
  if (marked !== document) writeFileSync(DOCUMENT, marked);

  const { names, bodies } = splitBlocks(marked);
  if (names.length === 0) throw new Error(`${DOCUMENT} has no blocks in it`);

  // Rebuilt rather than added to: a block removed from the document has to
  // disappear from here as well, and a stale file is the one thing a folder
  // like this must not contain.
  rmSync(FOLDER, { recursive: true, force: true });
  mkdirSync(FOLDER, { recursive: true });

  names.forEach((name, index) => {
    const position = String(index + 1).padStart(2, '0');
    const header = [
      `-- BLOK ${index + 1} VAN ${names.length} · ${name}`,
      '--',
      '-- Een blok, op sy eie. Merk alles (Ctrl+A), kopieer, plak in Supabase se',
      '-- SQL Editor, Run. Loop dit twee keer en niks gebeur die tweede keer.',
      '--',
      `-- Gegenereer uit ${DOCUMENT} deur tools/outstanding-split.mjs.`,
      '-- Moenie hierdie lêer met die hand verander nie; verander die migrasie.',
      '',
    ].join('\n');
    writeFileSync(join(FOLDER, `${position}-${name}`), `${header}${bodies[index] ?? ''}`);
  });

  const written = readdirSync(FOLDER).length;
  console.log(
    `✓ ${names.length} blok(ke) genommer in ${DOCUMENT}, en ${written} lêer(s) in ${FOLDER}/`,
  );
}

if (process.argv[1] && process.argv[1].endsWith('outstanding-split.mjs')) main();
