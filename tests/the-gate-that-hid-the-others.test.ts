/**
 * CI reported failure on every push for a hundred and more runs, and the thing
 * it was failing on was not the tests.
 *
 * Measured on 2026-10-07 against the ninety-nine most recent runs on `main`:
 * ninety-three failures, six cancelled, no successes, back to 2026-09-21. The
 * step conclusions of the latest one say why:
 *
 *     10. Colour contrast — WCAG 2.2 AA: success
 *     11. Brand assets are current:      failure
 *     12. Formatting:                    skipped
 *     13. Typecheck:                     skipped
 *     14. Tests:                         skipped
 *     15. Schema file matches:           skipped
 *     16. Legal register is complete:    skipped
 *     17. Fail if any STUB_ undocumented: skipped
 *
 * Six gates had not run on a server in weeks. The suite passing on this machine
 * was the only thing holding the line, and a typecheck error in `apps/web` and
 * `apps/mobile` — both of which run their own `tsc` under `pnpm -r typecheck` —
 * sat in `main` for a day without anything saying so.
 *
 * The brand step reproduced exactly:
 *
 *     rm -rf apps/web/public/brand   # .gitignore:33 — a fresh checkout has none
 *     pnpm brand:build --svg-only    # returns before the raster section
 *     pnpm check:brand               # ✗ 4 problems: the .webp files are missing
 *
 * `brand-build.mts` writes `vibefycode-badge-artwork*.webp` in the part
 * `--svg-only` skips, and `check:brand` requires them — it is what proves the
 * badge a customer embeds is the supplied artwork and not a drawing of it. So
 * the step asked for a check it had just made impossible. The flag saved 3.8
 * seconds.
 *
 * Two rules come out of it, and the second is the one that cost the weeks. The
 * comment on the legal-register step in that same file already said it: "Missing
 * from CI entirely until 2026-08-25 — the one gate `pnpm verify` ran that
 * nothing on the server did. Nobody noticed, because no run had ever got far
 * enough to notice anything." It was written about a different gate and the
 * ordering was left as it was.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(join(import.meta.dirname, '..', '.github/workflows/ci.yml'), 'utf8');

/**
 * The steps of the gate job, as `{ name, body }`.
 *
 * Parsed from the text rather than with a YAML library, because there is no
 * YAML parser in this project's dependencies and adding one to read one file is
 * a worse trade than reading the two shapes this file actually uses.
 */
function steps(): { name: string; body: string }[] {
  const found: { name: string; body: string }[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^      - name: (.+)$/.exec(lines[index] ?? '');
    if (!match) continue;
    const body: string[] = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next] ?? '';
      if (/^      - name: /.test(line) || /^  \w/.test(line)) break;
      body.push(line);
    }
    found.push({
      name: match[1]!,
      // Comment lines stripped. The comment on the brand step quotes
      // `--svg-only` while explaining why it is gone, and the first version of
      // this test matched its own explanation — the same trap as every other
      // source-text rule in this suite.
      body: body.filter((line) => !/^\s*#/.test(line)).join('\n'),
    });
  }
  return found;
}

/** The gates `pnpm verify` runs, by the script name rather than the step title. */
const GATE_SCRIPTS = [
  'check:secrets',
  'check:copy',
  'check:contrast',
  'check:brand',
  'format:check',
  'typecheck',
  'test',
  'check:schema',
  'legal:registry',
  'check:stubs',
];

describe('the brand gate that could not pass', () => {
  it('does not ask check:brand to read files a --svg-only build skips', () => {
    // The whole defect in one assertion. `--svg-only` returns before the raster
    // section, which is what writes the .webp files check:brand requires, and
    // apps/web/public/brand is gitignored so a fresh checkout has none.
    for (const step of steps()) {
      if (!step.body.includes('check:brand')) continue;
      expect(step.body).not.toContain('--svg-only');
    }
  });

  it('still builds the brand before checking it', () => {
    const step = steps().find((entry) => entry.body.includes('check:brand'))!;
    expect(step.body).toContain('pnpm brand:build');
  });

  it('still fails when brand/svg has drifted, which is the gate’s own job', () => {
    const step = steps().find((entry) => entry.body.includes('check:brand'))!;
    expect(step.body).toContain('git diff --exit-code -- brand/svg');
  });
});

describe('one failing gate must not hide the rest', () => {
  const gateSteps = steps().filter((step) =>
    GATE_SCRIPTS.some((script) => new RegExp(`pnpm (?:-s )?${script}\\b`).test(step.body)),
  );

  it('finds the gate steps, so this file is testing something', () => {
    expect(gateSteps.length).toBeGreaterThanOrEqual(GATE_SCRIPTS.length);
  });

  it('runs every gate even when an earlier one failed', () => {
    // Without this, CI's one red mark says nothing about what is red. Six gates
    // were skipped on every push for weeks and the only visible symptom was a
    // failure on a step nobody read.
    const unconditional = gateSteps.filter(
      (step) => !/if: \$\{\{ !cancelled\(\) \}\}/.test(step.body),
    );
    expect(unconditional.map((step) => step.name)).toEqual([]);
  });

  it('covers every gate pnpm verify runs', () => {
    // The legal register was missing from CI altogether until 2026-08-25, and
    // the comment that records it is three steps below the one that hid it.
    for (const script of GATE_SCRIPTS) {
      expect(workflow).toMatch(new RegExp(`pnpm (?:-s )?${script}\\b`));
    }
  });
});
