/**
 * Report generation.
 *
 * Assembled from the database rather than from the engine's in-memory outcome,
 * so a report can be regenerated years later from the row alone. That is what
 * "reproducible and defensible" has to mean when a customer disputes a finding
 * long after the run that produced it.
 *
 * The scope statement is read from the assessment row, not from the current
 * source files: a later edit to the standard wording must never change what a
 * customer was actually told.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { resolveBrowserExecutable } from '@vibefycode/engine';
import { NON_RELIANCE_LEGEND } from '@vibefycode/shared';
import { assembleReportSource, renderReport, type ReportTier } from '@vibefycode/report';
import { resolvePlan } from '@vibefycode/billing';
import type { PoolClient } from 'pg';

export interface StoredReport {
  readonly storagePath: string;
  readonly sha256: string;
  readonly byteSize: number;
}

/**
 * Where a rendered artefact goes. Local disk now; object storage when it exists.
 *
 * Not only reports. Evidence rows carry a `storage_path`, a `sha256` and a
 * `byte_size` and nothing ever wrote a byte to any of those paths, so every
 * screenshot, HTTP exchange and accessibility scan a finding cites was a row
 * claiming we hold proof we did not hold — and the reviewer whose job is to
 * look at it had nothing to open.
 */
export interface ArtefactStorage {
  put(path: string, body: Buffer, contentType: string): Promise<StoredReport>;
  get(path: string): Promise<Buffer | null>;
  /** Used by the retention sweep, which used to delete a row and leave the file. */
  remove(path: string): Promise<void>;
}

/** @deprecated The same thing under its older, narrower name. */
export type ReportStorage = ArtefactStorage;

export class LocalReportStorage implements ArtefactStorage {
  constructor(private readonly root: string) {}

  async put(path: string, body: Buffer, _contentType: string): Promise<StoredReport> {
    const full = join(this.root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
    return {
      storagePath: path,
      sha256: createHash('sha256').update(body).digest('hex'),
      byteSize: body.byteLength,
    };
  }

  async get(path: string): Promise<Buffer | null> {
    // Paths come from our own rows, but a traversal here would read anything on
    // the disk, so it is refused rather than trusted.
    this.refuseTraversal(path);
    try {
      return await readFile(join(this.root, path));
    } catch {
      return null;
    }
  }

  async remove(path: string): Promise<void> {
    // And a traversal here would delete anything on the disk, which is worse.
    this.refuseTraversal(path);
    await rm(join(this.root, path), { force: true });
  }

  private refuseTraversal(path: string): void {
    if (path.includes('..')) throw new Error('Refusing an artefact path containing "..".');
  }
}

/**
 * The storage the process should use. Local disk today; a Supabase Storage
 * bucket once the project exists, which is a deployment decision rather than a
 * code one — see docs/OPEN_ITEMS.md.
 */
export function resolveArtefactStorage(): ArtefactStorage {
  return new LocalReportStorage(process.env.VIBEFYCODE_REPORT_DIR ?? '.tmp/reports');
}

/** @deprecated The same thing under its older, narrower name. */
export const resolveReportStorage = resolveArtefactStorage;

/** Prints the rendered HTML to PDF. Self-contained input, so no network is needed. */
export async function renderPdf(html: string): Promise<Buffer> {
  const launchOptions = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  let browser;
  try {
    browser = await chromium.launch(launchOptions);
  } catch (error) {
    const executablePath = resolveBrowserExecutable();
    if (!executablePath) throw error;
    browser = await chromium.launch({ ...launchOptions, executablePath });
  }

  try {
    const page = await browser.newPage();
    // No network at all while printing: the document carries everything it needs,
    // and a report that renders differently depending on the network is not a record.
    await page.route('**/*', (route) => route.abort());
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        '<div style="font-size:8px;color:#5A6488;width:100%;padding:0 16mm;display:flex;justify-content:space-between">' +
        '<span>VibefyCode assessment — point-in-time, scope-limited. Not a guarantee.</span>' +
        '<span class="pageNumber"></span>/<span class="totalPages"></span></div>',
      margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
    });
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export { assembleReportSource };

export interface GenerateReportInput {
  readonly assessmentId: string;
  readonly tier: ReportTier;
  readonly formats?: readonly ('html' | 'pdf')[];
  /**
   * How to print the PDF. Injectable only so a test can make printing fail:
   * the promise below — that nothing is written down until everything has
   * rendered — is not worth making if nobody has watched it hold.
   */
  readonly printPdf?: ((html: string) => Promise<Buffer>) | undefined;
}

/**
 * Generates and stores the report. PDF export is a paid feature, so asking for
 * one on a free tier is refused here rather than quietly downgraded — a customer
 * who asked for something they cannot have should be told, not handed a surprise.
 */
export async function generateReport(
  client: PoolClient,
  storage: ReportStorage,
  input: GenerateReportInput,
): Promise<{ html: StoredReport; pdf: StoredReport | null }> {
  const formats = input.formats ?? (input.tier === 'paid' ? ['html', 'pdf'] : ['html']);
  if (input.tier === 'free' && formats.includes('pdf')) {
    throw new Error('PDF export is part of the paid report. A free report is HTML only.');
  }

  const source = await assembleReportSource(client, input.assessmentId);
  if (source.scopeStatement.trim().length < 100) {
    throw new Error(
      `Assessment ${input.assessmentId} has no frozen scope statement. A report without one states no limits, and we do not publish those.`,
    );
  }

  const rendered = renderReport(source, input.tier);
  const htmlBytes = Buffer.from(rendered.html, 'utf8');

  // Everything is rendered before anything is written down, and the order is
  // load-bearing. `sweepPendingReports` decides there is work to do by looking
  // for an assessment with no HTML report. Writing the HTML row first and then
  // failing to print the PDF satisfied that test while leaving a paying
  // customer without the format they paid for — and because the sweep only ever
  // asked about HTML, it never came back. The PDF was not late; it was gone.
  const pdf = formats.includes('pdf') ? await (input.printPdf ?? renderPdf)(rendered.html) : null;

  // The file is written for whoever is developing locally and wants to open it.
  // It is not where the download comes from: this process runs on Render and the
  // console runs on Vercel, and the only thing they share is this database.
  const htmlStored = await storage.put(
    `reports/${source.assessmentId}/${input.tier}.html`,
    htmlBytes,
    'text/html; charset=utf-8',
  );

  await client.query(
    `insert into public.reports
       (assessment_id, organisation_id, format, storage_path, sha256, rubric_version,
        scope_statement, non_reliance_legend, content)
     select $1, a.organisation_id, 'html', $2, $3, a.rubric_version, a.scope_statement, $4, $5
       from public.assessments a where a.id = $1
     on conflict (assessment_id, format) do update
       set storage_path = excluded.storage_path,
           sha256 = excluded.sha256,
           content = excluded.content,
           generated_at = now()`,
    [
      source.assessmentId,
      htmlStored.storagePath,
      htmlStored.sha256,
      NON_RELIANCE_LEGEND,
      htmlBytes,
    ],
  );

  let pdfStored: StoredReport | null = null;
  if (pdf) {
    pdfStored = await storage.put(
      `reports/${source.assessmentId}/report.pdf`,
      pdf,
      'application/pdf',
    );
    await client.query(
      `insert into public.reports
         (assessment_id, organisation_id, format, storage_path, sha256, rubric_version,
          scope_statement, non_reliance_legend, content)
       select $1, a.organisation_id, 'pdf', $2, $3, a.rubric_version, a.scope_statement, $4, $5
         from public.assessments a where a.id = $1
       on conflict (assessment_id, format) do update
         set storage_path = excluded.storage_path,
             sha256 = excluded.sha256,
             content = excluded.content,
             generated_at = now()`,
      [source.assessmentId, pdfStored.storagePath, pdfStored.sha256, NON_RELIANCE_LEGEND, pdf],
    );
  }

  return { html: htmlStored, pdf: pdfStored };
}

// ---------------------------------------------------------------------------
// Keeping reports in step with reviews
// ---------------------------------------------------------------------------

/**
 * Generates the reports that should exist and do not.
 *
 * A sweep rather than a queue message from the console, deliberately. Approval
 * happens in the web app and generation happens here; coupling them through a
 * queue means an approval whose enqueue failed leaves a customer with a report
 * that never appears and no trace of why. A sweep is self-healing: whatever the
 * reason a report is missing — a crash, a deploy, an upgrade from free to paid —
 * the next pass notices and fixes it.
 */
/**
 * How many times one assessment may fail to render before the sweep stops
 * trying it, and the count of failures so far.
 *
 * The window is twenty rows ordered oldest-review-first, and a row leaves it
 * only by acquiring a report. An assessment that can never acquire one — a
 * scope statement too short to publish, a source row the assembler chokes on —
 * therefore sits at the front of that window and takes a slot every sweep, for
 * ever. Twenty of those and nobody's report is generated again, while the log
 * fills with the same twenty errors and never says the thing that matters:
 * that everyone else is now waiting behind them.
 *
 * In memory rather than a column, because this is a process-lifetime guard and
 * not a record: a restart is a fresh try, which is what you want after a deploy
 * that fixed the renderer. A permanent failure needs a person either way, and
 * the point of the cap is that the log says so once instead of never.
 */
export const REPORT_RENDER_ATTEMPTS = 3;
const renderFailures = new Map<string, number>();

/** Forgets the failure counts. Exported for tests, which share one process. */
export function resetReportFailureCounts(): void {
  renderFailures.clear();
}

export async function sweepPendingReports(
  pool: { connect(): Promise<PoolClient> },
  storage: ReportStorage,
  log: (message: string, detail?: Record<string, unknown>) => void = () => undefined,
): Promise<number> {
  const client = await pool.connect();
  try {
    const pending = await client.query<{ id: string; organisation_id: string; app_id: string }>(
      `select a.id, a.organisation_id, a.app_id
         from public.assessments a
        where a.status in ('approved', 'published')
          and a.scope_statement is not null
          and not exists (
            select 1 from public.reports r
             where r.assessment_id = a.id and r.format = 'html'
          )
        order by a.reviewed_at
        limit 20`,
    );

    let generated = 0;
    let blocked = 0;
    for (const row of pending.rows) {
      if ((renderFailures.get(row.id) ?? 0) >= REPORT_RENDER_ATTEMPTS) {
        blocked += 1;
        continue;
      }

      const plan = await resolvePlan(client, {
        organisationId: row.organisation_id,
        appId: row.app_id,
      });
      try {
        await generateReport(client, storage, {
          assessmentId: row.id,
          tier: plan.entitlement.reportTier,
          formats: plan.entitlement.pdfExport ? ['html', 'pdf'] : ['html'],
        });
        renderFailures.delete(row.id);
        generated += 1;
        log('report generated', { assessmentId: row.id, tier: plan.entitlement.reportTier });
      } catch (error) {
        // One bad assessment must not stop the others.
        const failures = (renderFailures.get(row.id) ?? 0) + 1;
        renderFailures.set(row.id, failures);
        log('report generation failed', {
          assessmentId: row.id,
          attempt: failures,
          error: error instanceof Error ? error.message : String(error),
        });
        if (failures >= REPORT_RENDER_ATTEMPTS) {
          // Said once, in the words somebody woken at night needs: not "it
          // failed" — it has been failing all along — but "it is now holding a
          // place that other customers' reports are queued behind".
          log('report generation given up on until this process restarts', {
            assessmentId: row.id,
            attempts: failures,
            consequence: 'it no longer takes a slot in the sweep window',
          });
        }
      }
    }
    if (blocked > 0) {
      log('assessments the sweep can no longer render', {
        blocked,
        note: 'each needs a person; a restart makes the sweep try them again',
      });
    }
    return generated;
  } finally {
    client.release();
  }
}

/**
 * Regenerates a report after an upgrade, so a customer who pays after reading
 * the free version gets the full one without waiting for a re-assessment. The
 * assessment is untouched: the same findings, the same evidence, the same score.
 */
export async function regenerateForPlanChange(
  client: PoolClient,
  storage: ReportStorage,
  assessmentId: string,
): Promise<void> {
  const context = await client.query<{ organisation_id: string; app_id: string }>(
    'select organisation_id, app_id from public.assessments where id = $1',
    [assessmentId],
  );
  const row = context.rows[0];
  if (!row) {
    // Louder than a bare return, because of when this is called: somebody has
    // just paid for the full version of a report. Quietly doing nothing there
    // means the customer waits for a file that is never coming.
    throw new Error(
      `Cannot regenerate the report for assessment ${assessmentId}: there is no such assessment.`,
    );
  }

  const plan = await resolvePlan(client, {
    organisationId: row.organisation_id,
    appId: row.app_id,
  });
  await generateReport(client, storage, {
    assessmentId,
    tier: plan.entitlement.reportTier,
    formats: plan.entitlement.pdfExport ? ['html', 'pdf'] : ['html'],
  });
}
