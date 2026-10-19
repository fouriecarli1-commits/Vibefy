/**
 * The licensing observations, on their way to the page somebody reads.
 *
 * `observeProvenance` has held its own test since the day it was written. What
 * it did not have was a reader: the engine wrote the observations, the worker
 * stored them when the column existed, and nothing printed them. A detector
 * whose output nobody sees is the silent failure path this review keeps
 * finding, built by me, one commit after I built the detector.
 *
 * So this covers the carriage rather than the detection:
 *
 *   · the section renders on both tiers, because these are facts about the run
 *     and the free verification page a stranger can open sits beside the paid
 *     report;
 *   · it renders nothing at all when there is nothing — no "no licensing
 *     problems were found" sentence, which is the one claim this section can
 *     never support, because it cannot tell "the stage looked and found
 *     nothing" from "this database has no column to store what it found";
 *   · a database that has not run `20261019120000` still produces a report.
 *     `provenance` is deliberately not a claim column: a missing `not_tested`
 *     has to stop every report because its absence would make each one imply
 *     nothing went unanswered, and a missing `provenance` implies nothing at
 *     all. Refusing on it would take every report in the product offline until
 *     a migration the founder runs by hand had run;
 *   · the words stay on the fact. "This file carries somebody else's copyright
 *     line" is something we saw. "You are in breach" is a conclusion about
 *     terms, intentions and a jurisdiction this engine does not know.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  assembleReportSource,
  missingClaimColumns,
  renderReport,
  type ReportSource,
  type SqlExecutor,
} from '../packages/report/src/index.ts';
import {
  observeProvenance,
  type RepositoryView,
} from '../packages/engine/src/stages/provenance.ts';
import { connect } from './setup/client.ts';
import { seedAccount, seedAssessment, seedFinding, type SeededAccount } from './setup/seed.ts';

let db: Client;
let owner: SeededAccount;

const SCOPE = 'What was assessed, and what was not. '.repeat(4);

const OBSERVED = [
  {
    id: 'foreign_copyright',
    title: 'A source file carries somebody else’s copyright line',
    detail: 'src/carousel.tsx names “Acme Components Ltd” in its header.',
    paths: ['src/carousel.tsx'],
  },
  {
    id: 'bundled_font_without_a_licence',
    title: 'A font is shipped with the application and no licence beside it',
    detail: 'public/fonts/Display.woff2 was found; no OFL or licence file accompanies it.',
    paths: ['public/fonts/Display.woff2'],
  },
];

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'licence-section');
});

afterAll(async () => {
  await db?.end();
});

/** An assessment with a score, a scope statement and whatever provenance a case wants. */
async function assessmentWith(provenance: unknown[] | null): Promise<string> {
  const { assessmentId } = await seedAssessment(db, owner);
  await seedFinding(db, owner, assessmentId);
  await db.query(
    `update public.assessments
        set overall_score = 71.5, scope_statement = $2, status = 'awaiting_review',
            completed_at = now(), provenance = coalesce($3::jsonb, '[]'::jsonb)
      where id = $1`,
    [assessmentId, SCOPE, provenance === null ? null : JSON.stringify(provenance)],
  );
  return assessmentId;
}

/** The same database, with the column the migration adds taken back out of the row. */
function withoutTheColumn(client: Client): SqlExecutor {
  return {
    async query<T = Record<string, unknown>>(text: string, values?: unknown[]) {
      const result = await client.query<Record<string, unknown>>(text, values);
      if (!text.includes('organisation_name')) return result as { rows: T[] };
      return {
        rows: result.rows.map((row) => {
          const { provenance: _dropped, ...rest } = row;
          return rest;
        }),
      } as { rows: T[] };
    },
  };
}

describe('what the report says about where the code came from', () => {
  it('prints each observation, its detail and its path, on both tiers', async () => {
    const assessmentId = await assessmentWith(OBSERVED);
    const source = await assembleReportSource(db, assessmentId);
    expect(source.provenance, 'the assembled report did not read the provenance column').toEqual(
      OBSERVED,
    );

    for (const tier of ['free', 'paid'] as const) {
      const { html } = renderReport(source, tier);
      expect(html, `the ${tier} report has no section about where the code came from`).toContain(
        'Where this code came from',
      );
      expect(html).toContain('A source file carries somebody else’s copyright line');
      expect(html).toContain('names “Acme Components Ltd” in its header');
      expect(html).toContain('<code>public/fonts/Display.woff2</code>');
    }
  });

  it('says nothing when there is nothing, rather than saying the licensing was fine', async () => {
    const assessmentId = await assessmentWith([]);
    const source = await assembleReportSource(db, assessmentId);
    expect(source.provenance).toEqual([]);

    const { html } = renderReport(source, 'paid');
    expect(html, 'an empty section was printed with no observations in it').not.toContain(
      'Where this code came from',
    );
    /*
     * The sentence this section must never grow. "What was not assessed" has a
     * fallback line for its empty case and can afford one, because the engine
     * records what it could not answer. Provenance has no such record: there is
     * no observation meaning "the licences were checked and they were in
     * order", so any sentence to that effect would be assembled out of silence.
     */
    expect(html.toLowerCase()).not.toMatch(/licen[cs]\w*[^.]{0,40}(in order|no (problem|issue))/);
  });

  it('still assembles a report on a database that has not run the migration', async () => {
    const assessmentId = await assessmentWith(OBSERVED);
    const source = await assembleReportSource(withoutTheColumn(db), assessmentId);
    expect(
      source.provenance,
      'a database with no provenance column reported observations it cannot store',
    ).toBeUndefined();
    expect(renderReport(source, 'paid').html).not.toContain('Where this code came from');
  });

  it('does not make the new column a thing every report refuses without', () => {
    // The row here carries none of the claim columns, so whatever the function
    // names is the complete list. `provenance` being in it would mean every
    // report in the product fails until the founder has run block 20.
    expect(missingClaimColumns({})).not.toContain('provenance');
    expect(missingClaimColumns({}), 'the claim columns stopped being checked').toContain(
      'not_tested',
    );
  });

  it('carries what the engine actually produces, key for key', async () => {
    /*
     * The two shapes are declared twice on purpose — a report package that
     * imported the engine would drag a browser automation library into a
     * renderer — so this is what holds them together. `observeProvenance`
     * output is assigned straight into a `ReportSource`, which the compiler
     * checks, and then has to come out the other end of the renderer. A key
     * renamed on either side fails here rather than quietly rendering a section
     * of empty strings.
     */
    const view: RepositoryView = {
      files: ['src/widget.ts', 'package.json'],
      read: (path) =>
        path === 'src/widget.ts'
          ? '// Copyright (c) 2019 Northwind Traders\nexport const widget = 1;\n'
          : path === 'package.json'
            ? JSON.stringify({ name: 'shop' })
            : null,
    };
    const observed = observeProvenance(view);
    expect(observed.length, 'the fixture stopped producing any observation').toBeGreaterThan(0);

    const assessmentId = await assessmentWith([]);
    const assembled = await assembleReportSource(db, assessmentId);
    const source: ReportSource = { ...assembled, provenance: observed };
    const { html } = renderReport(source, 'paid');
    for (const observation of observed) {
      expect(html).toContain(observation.title);
      expect(html).toContain(observation.detail);
    }
  });
});
