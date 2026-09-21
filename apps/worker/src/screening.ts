/**
 * The intake judgement pass, run where the key already is.
 *
 * `screenIntake` has always had two halves: a deterministic filter that refuses
 * phrases specific enough that their presence is the finding, and a judgement
 * pass for everything wording alone cannot settle. Only the first half ever
 * ran. The console calls `screenIntake` with no model, so every submission
 * lands in `needs_human_review`, and every application ever created went into
 * the reviewer queue whether or not there was anything to think about.
 *
 * It runs here rather than in the console for three reasons. The API key is
 * already in this process and nowhere else. Cost belongs in `cost_records`, and
 * this is the process that writes them. And submitting an application should
 * not wait on a model call — the customer gets their page immediately and the
 * screen catches up within a sweep.
 *
 * What it may do is deliberately narrower than what it can decide. The pass is
 * allowed to *clear* — to take the benign submissions out of the queue — and is
 * never allowed to refuse. A wrongly refused customer is a real harm; a
 * wrongly queued one waits an hour. Where the pass reads a submission as
 * prohibited, the reasoning is written onto the application and it stays
 * `pending` for a person, which is what `record_automated_screening` enforces
 * by taking no verdict at all.
 */
import { screenIntake, type ScreeningResult } from '@vibefycode/engine/authorisation';
import { CostMeter, ModelClient, AnthropicTransport } from '@vibefycode/engine';
import { recordUnattributedCost } from './persist.ts';
import type { PoolClient } from 'pg';

type Logger = (message: string, detail?: Record<string, unknown>) => void;
const noop: Logger = () => undefined;

interface Poolish {
  connect(): Promise<PoolClient>;
}

/**
 * What one screening call may spend.
 *
 * Generous against the real figure — this is a page of text through the cheap
 * model — and there so that a prompt change which somehow turns it into an
 * agentic loop hits a wall rather than a bill.
 */
export const SCREENING_COST_CEILING_USD = 0.05;

export interface ScreeningSweepResult {
  readonly considered: number;
  readonly cleared: number;
  readonly leftForAPerson: number;
}

/**
 * How the sweep gets a model, given a meter.
 *
 * A factory rather than a client, because each submission is metered on its own
 * and charged to its own organisation — a sweep spans several customers and one
 * shared meter would put one customer's spend on another's ledger.
 */
export type ScreeningModelFactory = (meter: CostMeter) => ModelClient;

/**
 * The factory for this process, or null when it holds no key.
 *
 * Null is not an error: a deployment without a key screens nothing
 * automatically and every submission goes to the reviewer queue, which is
 * exactly what happened before this existed and is safe. `main.ts` says so once
 * at startup, so it is a choice rather than a surprise.
 */
export function screeningModelFactory(): ScreeningModelFactory | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const transport = new AnthropicTransport();
  return (meter) => new ModelClient(transport, meter);
}

export async function sweepIntakeScreening(
  pool: Poolish,
  makeModel: ScreeningModelFactory | null,
  log: Logger = noop,
  limit = 10,
): Promise<ScreeningSweepResult> {
  const result = { considered: 0, cleared: 0, leftForAPerson: 0 };
  if (!makeModel) return result;

  const client = await pool.connect();
  try {
    const { rows } = await client.query<{
      id: string;
      organisation_id: string;
      name: string;
      description: string | null;
      category: string | null;
      target_audience: string | null;
      primary_url: string | null;
    }>(
      `select id, organisation_id, name, description, category, target_audience, primary_url
         from public.apps
        where screening_status = 'pending'
          and archived_at is null
        order by created_at
        limit $1`,
      [limit],
    );

    for (const row of rows) {
      result.considered += 1;
      const meter = new CostMeter({ maxRunCostUsd: SCREENING_COST_CEILING_USD });
      let verdict: ScreeningResult;
      try {
        verdict = await screenIntake(
          {
            appName: row.name,
            description: row.description ?? '',
            category: row.category,
            targetAudience: row.target_audience,
            primaryUrl: row.primary_url,
          },
          makeModel(meter),
        );
      } catch (error) {
        // One unreadable submission must not stop the others, and a pass that
        // could not run leaves the application exactly where it was: waiting
        // for a person, which is where it would have been anyway.
        result.leftForAPerson += 1;
        log('intake screening failed', {
          appId: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
        // The money was spent whether or not the answer arrived, and the daily
        // cap reads the ledger. Deliberately quiet: another error is on its way
        // to the log and this must not replace it.
        await recordScreeningCost(client, row.organisation_id, meter).catch(() => undefined);
        continue;
      }

      await recordScreeningCost(client, row.organisation_id, meter).catch((error: unknown) =>
        log('screening cost could not be recorded', { appId: row.id, error: String(error) }),
      );

      if (verdict.verdict === 'cleared') {
        const { rows: done } = await client.query<{ record: boolean }>(
          'select public.record_automated_screening($1, $2) as record',
          [
            row.id,
            `Automatic screen (${verdict.confidence} confidence): ${verdict.reasoning}`.slice(
              0,
              2000,
            ),
          ],
        );
        if (done[0]?.record === true) result.cleared += 1;
        else result.leftForAPerson += 1;
        continue;
      }

      // Refused or undecided, which are the same thing from here: a person
      // looks. The reasoning is written onto the application so the reviewer
      // opens the queue already knowing what the pass thought and why.
      result.leftForAPerson += 1;
      await client.query(
        `update public.apps
            set screening_notes = $2
          where id = $1 and screening_status = 'pending'`,
        [
          row.id,
          `Automatic screen says ${verdict.verdict.replace(/_/g, ' ')} (${verdict.confidence} confidence): ${verdict.reasoning}${
            verdict.quotedBasis.trim() ? ` Quoting: "${verdict.quotedBasis.trim()}"` : ''
          }`.slice(0, 2000),
        ],
      );
    }

    if (result.considered > 0) log('intake screening sweep', { ...result });
    return result;
  } finally {
    client.release();
  }
}

/**
 * Writes down what the screening pass spent.
 *
 * There is no assessment to attribute it to — the point of screening is that it
 * happens before anyone commits to running one — so it goes in unattributed,
 * the same way a run whose persistence failed does. The daily spend cap reads
 * `cost_records`, and a cost that is not in there is a cost the cap cannot see.
 */
export async function recordScreeningCost(
  client: Pick<PoolClient, 'query'>,
  organisationId: string,
  meter: CostMeter,
): Promise<number> {
  return recordUnattributedCost(client, {
    organisationId,
    costByStage: meter.summariseByStage(),
  });
}
