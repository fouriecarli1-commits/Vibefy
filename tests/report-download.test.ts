/**
 * Getting the report out, as a file somebody can keep.
 *
 * This suite exists because of a download that could never have worked. The
 * worker renders the PDF and wrote the bytes to a directory inside its own
 * container on Render; the console serves the download from Vercel and read the
 * same path back. Two machines, one shared database and nothing else — so every
 * request would have answered 410, and a deploy would have discarded every
 * report already promised to a customer.
 *
 * Nobody found it by using the product, because nothing had ever been approved.
 * It was found by reading the code after the founder asked for a download he
 * could keep records with.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { connect } from './setup/client.ts';
import { seedAccount, seedAssessment, seedRubric, type SeededAccount } from './setup/seed.ts';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');
const route = read('apps/web/app/console/reports/[assessmentId]/pdf/route.ts');
const reviewPage = read('apps/web/app/review/[id]/page.tsx');
const reportPage = read('apps/web/app/console/reports/[assessmentId]/page.tsx');
const worker = read('apps/worker/src/report.ts');

let db: Client;
let owner: SeededAccount;

beforeAll(async () => {
  db = await connect();
  await seedRubric(db);
  owner = await seedAccount(db, 'report-owner');
});

afterAll(async () => {
  await db.end();
});

describe('where the bytes live', () => {
  it('the reports table can hold them', async () => {
    const { rows } = await db.query<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'reports' and column_name = 'content'`,
    );
    expect(rows[0]?.data_type).toBe('bytea');
    // Nullable, because rows written before this change have bytes that are
    // genuinely gone. A placeholder would be worse than saying so.
    expect(rows[0]?.is_nullable).toBe('YES');
  });

  it('survives a round trip unchanged, which a disk on another machine did not', async () => {
    // Through the seed helper, because an assessment without a verified
    // authorisation is refused by the database — which is the point of that gate
    // and not something a fixture should route around.
    const { assessmentId } = await seedAssessment(db, owner, { depth: 'full' });
    const payload = Buffer.from('%PDF-1.7 not really a pdf, but exactly these bytes');

    await db.query(
      `insert into public.reports
         (assessment_id, organisation_id, format, storage_path, sha256, rubric_version,
          scope_statement, non_reliance_legend, content)
       values ($1, $2, 'pdf', 'reports/x/report.pdf', repeat('b', 64), '1.0.0', $3, $4, $5)`,
      [assessmentId, owner.organisationId, 'S'.repeat(120), 'L'.repeat(60), payload],
    );

    const { rows } = await db.query<{ content: Buffer }>(
      `select content from public.reports where assessment_id = $1 and format = 'pdf'`,
      [assessmentId],
    );
    expect(Buffer.compare(rows[0]!.content, payload)).toBe(0);
  });
});

describe('the worker writes them into the row', () => {
  it('for both formats', () => {
    const inserts = [...worker.matchAll(/insert into public\.reports[\s\S]*?\)/g)];
    expect(inserts.length).toBeGreaterThanOrEqual(2);
    expect(worker).toContain('non_reliance_legend, content');
  });

  it('replaces the bytes when a report is regenerated', () => {
    // Without this the row would keep the first render's bytes while reporting
    // the second render's checksum, which is the worst of both.
    expect(worker).toContain('content = excluded.content');
  });
});

describe('the download', () => {
  it('reads the row, not a disk the console cannot see', () => {
    expect(route).toContain('content from public.reports');
    expect(route).not.toContain('resolveReportStorage');
  });

  it('says plainly when an old report has no bytes left', () => {
    expect(route).toMatch(/bytes are gone/i);
    expect(route).toContain('410');
  });

  it('still refuses a report that has not been reviewed', () => {
    // A downloadable draft is a draft somebody will forward.
    expect(route).toContain("!== 'approved'");
    expect(route).toContain('409');
  });

  it('still checks entitlement on the server rather than by hiding a link', () => {
    expect(route).toContain('pdfExport');
    expect(route).toContain('402');
  });
});

describe('when there is no PDF row at all', () => {
  /*
   * One sentence for three states, and it was true of one of them.
   *
   * "The PDF is still being prepared. It is generated once, after review, and
   * stored." That is right while the sweep has not reached it. It is false for
   * an assessment the sweep has given up on after three attempts — where
   * waiting is the one thing not to do — and false for a plan that stores the
   * HTML and nothing else, which only staff can reach, because the entitlement
   * check turns a customer back before this branch.
   *
   * The worker has recorded the abandonment since 2026-10-09. Nothing on this
   * side asked, so the product went on telling those customers to wait for
   * something that was never coming.
   */
  it('asks whether the sweep has given up before telling anybody to wait', () => {
    expect(route).toContain('RENDER_ABANDONED');
    // And the recovery, because an append-only log cannot mark the first row
    // resolved: a report produced on a later pass is not still abandoned.
    expect(route).toContain('RENDER_RECOVERED');
    expect(route).toMatch(/abandoned:\s*actions\.includes\(RENDER_ABANDONED\)/);
    expect(route).toContain('!actions.includes(RENDER_RECOVERED)');
  });

  it('says it is ours to chase rather than theirs', () => {
    const branch = route.slice(route.indexOf('if (context.abandoned)'));
    expect(branch).toMatch(/tried\s+three\s+times/i);
    expect(branch).toMatch(/our\s+fault/i);
    // The report itself renders live on the page, so it is readable even when
    // the stored PDF does not exist. Saying so is the difference between a
    // missing file and a lost assessment.
    expect(branch).toMatch(/readable\s+on\s+screen/i);
  });

  it('does not promise a PDF to a plan that never stores one', () => {
    expect(route).toContain('if (!context.plan.entitlement.pdfExport)');
    expect(route).toMatch(/keeps\s+the\s+report\s+on\s+screen\s+only/i);
  });

  it('keeps the honest wait for the state it is true of', () => {
    expect(route).toMatch(/still\s+being\s+prepared/i);
  });
});

describe('the page that assembles a report on the spot', () => {
  it('says what happened rather than throwing at the error boundary', () => {
    /*
     * This page does not serve what the worker stored: it assembles and renders
     * live, which is why a customer can read a report the sweep failed to store.
     * The other side of that is that everything which can throw in the worker
     * can throw here — the assembler on a source row it chokes on, the plan
     * lookup on a statement timeout, the renderer itself — and the whole page
     * threw with it. The reader got the console's generic card, which names a
     * digest and tells them nothing, on the one page they paid for.
     */
    expect(reportPage).toContain('couldNotPutItTogether');
    expect(reportPage).toContain('couldNot(');
    expect(reportPage).toMatch(/assemble the report for the console/);
    expect(reportPage).toMatch(/render the report for the console/);
    // Told apart from an assessment that does not exist, which is a 404 and not
    // a fault of ours.
    expect(reportPage).toContain('notFound()');
    expect(reportPage).toContain('page === FAILED');
  });

  it('does not blame the application for a failure in our own assembly', () => {
    const block = reportPage.slice(reportPage.indexOf('function couldNotPutItTogether'));
    expect(block).toMatch(/findings, its evidence and its score are stored and\s*unchanged/);
    expect(block).toMatch(/our\s+fault/i);
  });

  it('renders only after the status check, never before it', () => {
    // An assessment nobody has reviewed gets the "not ready" page and has no
    // business being rendered at all.
    expect(reportPage.indexOf("page.status !== 'approved'")).toBeLessThan(
      reportPage.indexOf('renderReport(page.source'),
    );
  });
});

describe('who may keep a copy', () => {
  it('the customer, when their plan includes it', () => {
    expect(reportPage).toContain('entitlement.pdfExport');
    expect(reportPage).toContain('/pdf');
  });

  it('the reviewer and the operator, whatever the customer bought', () => {
    // Gating our own records on the customer's plan would mean the platform
    // could not produce the report it wrote when somebody later disputes it.
    expect(route).toContain('isStaff');
    expect(route).toContain('!context.isStaff && !context.plan.entitlement.pdfExport');
    expect(reviewPage).toContain('/pdf');
  });

  it('and the operator is offered it from the review screen', () => {
    expect(reviewPage).toMatch(/Download the PDF/i);
  });
});
