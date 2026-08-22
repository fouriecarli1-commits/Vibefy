/**
 * The worker process.
 *
 * Assessments are long-running, so they never run in a request handler. pg-boss
 * gives us a durable queue in the database we already have — one fewer vendor,
 * one fewer dashboard, and the jobs live where the data lives.
 *
 * In production this process runs inside the ephemeral, network-restricted
 * container described in the runbook. The scope guard is the in-process half of
 * that boundary; the container's egress allowlist is the outer half.
 */
import { PgBoss, type Job } from 'pg-boss';
import { Pool } from 'pg';
import { runAssessmentJob, type AssessmentJob } from './run-assessment.ts';

export const ASSESSMENT_QUEUE = 'assessment.run';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. The worker needs a direct database connection.`);
  return value;
}

function log(message: string, detail: Record<string, unknown> = {}): void {
  // Structured, because the person debugging this at 2am is the person who wrote it.
  console.log(JSON.stringify({ at: new Date().toISOString(), message, ...detail }));
}

export async function start(): Promise<{ boss: PgBoss; pool: Pool }> {
  const connectionString = requireEnv('SUPABASE_DB_URL');
  const pool = new Pool({ connectionString, max: 4 });
  const boss = new PgBoss({ connectionString, schema: 'pgboss' });

  boss.on('error', (error: unknown) => log('queue error', { error: String(error) }));

  await boss.start();
  await boss.createQueue(ASSESSMENT_QUEUE);

  await boss.work<AssessmentJob>(
    ASSESSMENT_QUEUE,
    // One at a time per worker. Assessments are heavy, and a queue that runs
    // eight of them at once is a queue that hits the daily spend cap by lunchtime.
    { batchSize: 1, pollingIntervalSeconds: 5 },
    async ([job]: Job<AssessmentJob>[]) => {
      if (!job) return;
      log('job received', { jobId: job.id, appId: job.data.appId });
      try {
        const result = await runAssessmentJob(job.data, { pool, log });
        log('job completed', { jobId: job.id, ...result });
      } catch (error) {
        log('job failed', {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  );

  log('worker ready', { queue: ASSESSMENT_QUEUE });
  return { boss, pool };
}

if (process.argv[1]?.endsWith('main.ts')) {
  const { boss, pool } = await start();
  const shutdown = async () => {
    log('shutting down');
    await boss.stop({ graceful: true });
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
