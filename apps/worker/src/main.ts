/**
 * The worker process.
 *
 * Assessments are long-running, so they never run in a request handler. The
 * queue is `public.assessment_requests`, claimed with FOR UPDATE SKIP LOCKED —
 * a table the customer can watch rather than a broker they cannot.
 *
 * In production this process runs inside the ephemeral, network-restricted
 * container described in the runbook. The scope guard is the in-process half of
 * that boundary; the container's egress allowlist is the outer half.
 */
import { Pool, type PoolClient } from 'pg';
import { resendFromEnvironment } from '@vibefycode/notify';
import { NotAuthorisedError, runAssessmentJob } from './run-assessment.ts';
import {
  claimNextRequest,
  completeRequest,
  failRequest,
  isRetryableFailure,
  reclaimStaleRequests,
} from './queue.ts';
import { resolveReportStorage, sweepPendingReports } from './report.ts';
import { sweepBadgeIssuance, sweepBadgeLifecycle } from './badge.ts';
import {
  sweepBadgeExpiryWarnings,
  sweepSupersededRubric,
  sweepDriftDetection,
  sweepLiveness,
  sweepScheduledReassessments,
} from './monitoring.ts';
import { sweepAlertPush } from './push.ts';
import { sweepAlertEmail } from './email.ts';
import {
  spendingIsPaused,
  sweepGovernanceDeadlines,
  sweepRetention,
  sweepSpendCap,
} from './governance.ts';

export const POLL_INTERVAL_MS = 5_000;
export const REPORT_SWEEP_INTERVAL_MS = 30_000;
// Monitoring answers slower questions — is anything due, has anything drifted,
// is the site still up — so it runs on its own, longer beat. Running it at the
// report cadence would mean pinging every customer's site every thirty seconds.
export const MONITOR_SWEEP_INTERVAL_MS = 5 * 60_000;
/**
 * How long a shutdown waits for work already in flight.
 *
 * Seconds, not minutes. A platform sending SIGTERM gives about thirty before it
 * kills the process, and an assessment may legitimately still have twenty-nine
 * minutes to run — so waiting for one would mean being killed mid-write anyway,
 * having blocked the shutdown for nothing. What does not finish is left
 * `claimed` and recovered by the reclaim sweep.
 */
export const SHUTDOWN_GRACE_MS = 10_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. The worker needs a direct database connection.`);
  return value;
}

function log(message: string, detail: Record<string, unknown> = {}): void {
  // Structured, because the person debugging this at 2am is the person who wrote it.
  console.log(JSON.stringify({ at: new Date().toISOString(), message, ...detail }));
}

/** Borrows a client for one piece of work and always gives it back. */
async function withClient<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

/**
 * Whether the last poll found spending paused.
 *
 * Module scope because `processNextRequest` is called afresh every five
 * seconds: anything narrower would have nothing to compare against, which is
 * how the pause came to announce itself several times a minute for as long as
 * it lasted.
 */
let saidSpendingIsPaused = false;

/** Runs one queued request, if there is one. Returns whether it did any work. */
export async function processNextRequest(pool: Pool, logger: typeof log = log): Promise<boolean> {
  const claimClient = await pool.connect();
  let claimed;
  try {
    // The global spend ceiling is checked here, before anything is claimed,
    // because the failure it guards against is not one expensive run — it is a
    // thousand cheap ones started by a loop nobody is watching at three in the
    // morning. A pause is a row in the database, not state in this process, so
    // restarting the worker does not lift it.
    const paused = await spendingIsPaused(claimClient);
    if (paused !== saidSpendingIsPaused) {
      // The transition, not the state. This is checked every five seconds, so
      // saying it unconditionally was seventeen thousand identical lines a day
      // — and the lift, which is the line somebody is actually waiting for,
      // would have arrived indistinguishable from all of them.
      saidSpendingIsPaused = paused;
      logger(
        paused
          ? 'spending paused — claiming nothing new until a person lifts it'
          : 'spending resumed — claiming work again',
      );
    }
    if (paused) return false;
    claimed = await claimNextRequest(claimClient);
  } finally {
    claimClient.release();
  }
  if (!claimed) return false;

  logger('request claimed', { requestId: claimed.id, appId: claimed.appId, depth: claimed.depth });

  try {
    const result = await runAssessmentJob(
      { appId: claimed.appId, depth: claimed.depth, requestedBy: claimed.requestedBy },
      { pool, log: logger },
    );
    const client = await pool.connect();
    try {
      await completeRequest(client, claimed.id, result.assessmentId);
    } finally {
      client.release();
    }
    logger('request completed', { requestId: claimed.id, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // An unauthorised target does not become authorised by trying again, and
    // retrying it would mean attempting to test something we may not test, twice.
    // Nor does a constraint violation resolve itself: the assessment has already
    // been paid for by the time persistence fails, so requeueing a deterministic
    // database error buys the same error at full price.
    const retryable = !(error instanceof NotAuthorisedError) && isRetryableFailure(error);
    const client = await pool.connect();
    try {
      const outcome = await failRequest(client, claimed.id, message, { retryable });
      logger('request failed', { requestId: claimed.id, outcome, error: message });
    } finally {
      client.release();
    }
  }

  return true;
}

export async function start(): Promise<{ pool: Pool; stop: () => Promise<void> }> {
  const pool = new Pool({ connectionString: requireEnv('SUPABASE_DB_URL'), max: 4 });
  const storage = resolveReportStorage();
  const emailProvider = resendFromEnvironment();
  if (!emailProvider) {
    log('email not configured — alerts will reach the console and phones only', {
      needs: 'RESEND_API_KEY and ALERT_EMAIL_FROM',
    });
  }
  let running = true;

  const loop = async () => {
    while (running) {
      try {
        // One at a time per worker. Assessments are heavy, and a worker that runs
        // eight at once is a worker that hits the daily spend cap by lunchtime.
        const did = await processNextRequest(pool, log);
        if (!did) await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      } catch (error) {
        log('worker loop error', { error: String(error) });
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    }
  };

  // Reports are generated by a sweep rather than by a message from the console:
  // an approval whose enqueue failed would otherwise leave a customer with a
  // report that never appears and no trace of why.
  /*
   * One sweep of a kind at a time.
   *
   * `setInterval` does not wait for the last one to finish, and the monitoring
   * beat pings every customer's application — so on a slow morning a second
   * sweep starts while the first is still going. Every sweep here is
   * idempotent, which is not the same thing as safe to run twice at once: two
   * runs can both read a row as un-acted-on before either writes, and then both
   * act on it. That is a second re-assessment somebody pays for.
   *
   * Skipping rather than queueing is deliberate. These run every five minutes;
   * a sweep that was still busy will be picked up by the next tick, and a
   * backlog of sweeps waiting their turn is a way of falling further behind.
   */
  const running_sweeps = new Set<string>();
  const once = (name: string, work: () => Promise<unknown>) => {
    if (running_sweeps.has(name)) {
      log('sweep still running, skipping this tick', { sweep: name });
      return;
    }
    running_sweeps.add(name);
    void work()
      .catch((error) => log(`${name} sweep failed`, { error: String(error) }))
      .finally(() => running_sweeps.delete(name));
  };

  const sweep = setInterval(() => {
    once('report', () => sweepPendingReports(pool, storage, log));
    // Badges: issued when the last of approval, the rubric gate and licence
    // acceptance lands, and expired or suspended when the facts change.
    once('badge issuance', () => sweepBadgeIssuance(pool, log));
    once('badge lifecycle', () => sweepBadgeLifecycle(pool, log));
  }, REPORT_SWEEP_INTERVAL_MS);
  sweep.unref();

  // Continuous monitoring. Every one of these is idempotent — a drift report is
  // unique per assessment, an alert is unique per dedupe key, a re-assessment
  // stamps the app before it runs — so a sweep that runs twice, or that crashes
  // halfway, costs nothing.
  const monitor = setInterval(() => {
    once('drift', () => sweepDriftDetection(pool, log));
    once('re-assessment', () => sweepScheduledReassessments(pool, log));
    once('liveness', () => sweepLiveness(pool, undefined, log));
    once('badge expiry', () => sweepBadgeExpiryWarnings(pool, log));
    // The standard moving on is a slow fact — a rubric is superseded a handful
    // of times a year — so it rides the five-minute monitoring beat rather than
    // getting a timer of its own. Idempotent, like every sweep here: the dedupe
    // key means running it a thousand times raises the notice once.
    once('superseded rubric', () => sweepSupersededRubric(pool, log));
    // Alerts reach phones from here. The console is still the record; a push is
    // a copy of it, and one that fails is retried rather than lost.
    once('alert push', () => sweepAlertPush(pool, undefined, log));
    // The other half of the same promise: an alert has to reach someone who did
    // not install the app.
    once('alert email', () => sweepAlertEmail(pool, emailProvider, log));
    // Requests whose worker never came back. A deploy in the middle of a run
    // used to strand its row at `claimed` for ever — and because the
    // re-assessment sweep skips an application that already has one queued or
    // claimed, that stranded row also stopped the application ever being
    // re-checked again. Its badge stayed live on a claim nobody was testing.
    once('reclaim', async () => {
      const result = await withClient(pool, (client) => reclaimStaleRequests(client));
      if (result.requeued > 0 || result.abandoned > 0) {
        log('stale requests reclaimed', { ...result });
      }
    });
    // Governance: the ceiling, the retention deadline and the response deadline.
    // All three were recorded in the schema from M1 and acted on by nothing.
    once('spend', () => sweepSpendCap(pool, log));
    once('retention', () => sweepRetention(pool, log));
    once('governance deadline', () => sweepGovernanceDeadlines(pool, log));
  }, MONITOR_SWEEP_INTERVAL_MS);
  monitor.unref();

  const loopFinished = loop();
  log('worker ready', {
    poll: POLL_INTERVAL_MS,
    reportSweep: REPORT_SWEEP_INTERVAL_MS,
    monitorSweep: MONITOR_SWEEP_INTERVAL_MS,
  });

  return {
    pool,
    async stop() {
      /*
       * Stop claiming, then give whatever is in flight a moment to finish.
       *
       * Not a full drain: an assessment may legitimately run for half an hour
       * and a platform sending SIGTERM will wait seconds, so waiting for it
       * would mean being killed mid-write anyway, having blocked the shutdown
       * for nothing. The grace is for the ordinary case — a run that was nearly
       * done, or a sweep mid-query — and a run that does not make it is left
       * claimed and picked up by the reclaim sweep, which exists for exactly
       * this. Ending the pool under an open transaction is what used to happen,
       * and it turned a tidy shutdown into a half-written assessment.
       */
      running = false;
      clearInterval(sweep);
      clearInterval(monitor);
      await Promise.race([
        loopFinished,
        new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS)),
      ]);
      await pool.end();
    },
  };
}

if (process.argv[1]?.endsWith('main.ts')) {
  const { stop } = await start();
  const shutdown = async () => {
    log('shutting down');
    await stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
