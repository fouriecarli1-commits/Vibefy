/**
 * One SQL file, assembled from every migration in order.
 *
 * The migrations are the source of truth and stay that way. This exists for one
 * situation: setting up a fresh hosted database from a browser, by pasting into
 * a SQL editor, without installing a command-line tool first. Seventeen files
 * pasted by hand in the right order is a mistake waiting to happen; one file is
 * not.
 *
 * It is generated, never edited, and `--check` fails the build if it has drifted
 * from the migrations — because a schema file that quietly lags behind is worse
 * than no schema file, and it would be discovered by a broken deployment.
 *
 * Run: node tools/build-schema.mjs [--check]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = 'supabase/migrations';
const OUTPUT = 'supabase/schema.sql';

const HEADER = `-- ---------------------------------------------------------------------------
-- VibefyCode — the complete schema, assembled from supabase/migrations.
--
-- GENERATED FILE. Do not edit. Run \`pnpm schema:build\` after adding a
-- migration; CI fails if this has drifted from the migrations it came from.
--
-- To set up a fresh hosted database: open the Supabase dashboard, go to the SQL
-- Editor, paste this whole file, and run it. It is safe to run once on an empty
-- project and is not written to be re-runnable — a second run will fail on
-- objects that already exist, which is the correct behaviour for a file whose
-- job is to build a database from nothing.
-- ---------------------------------------------------------------------------

`;

function assemble() {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const parts = files.map((name) => {
    const body = readFileSync(join(MIGRATIONS, name), 'utf8').trimEnd();
    return [
      '-- ===========================================================================',
      `-- ${name}`,
      '-- ===========================================================================',
      '',
      body,
      '',
    ].join('\n');
  });

  return HEADER + parts.join('\n') + '\n';
}

const assembled = assemble();

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(OUTPUT, 'utf8');
  } catch {
    console.error(`✗ ${OUTPUT} does not exist. Run \`pnpm schema:build\`.`);
    process.exit(1);
  }
  if (current !== assembled) {
    console.error(
      `✗ ${OUTPUT} is out of date — a migration changed and it was not regenerated.\n` +
        '  Run `pnpm schema:build` and commit the result.',
    );
    process.exit(1);
  }
  console.log(`✓ ${OUTPUT} matches the migrations.`);
  process.exit(0);
}

writeFileSync(OUTPUT, assembled);
console.log(
  `✓ Wrote ${OUTPUT} from ${readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).length} migrations.`,
);
