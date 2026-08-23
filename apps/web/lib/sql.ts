import { Pool, type PoolClient } from 'pg';

/**
 * Direct SQL, still under row-level security.
 *
 * Some things a report needs — a finding joined to its evidence, joined to the
 * app, joined to the organisation — are one query in SQL and four round trips
 * through a REST client. Rather than keep a second copy of the assembly logic
 * for the console, the console runs the same query the worker does, but as the
 * caller: `set local role authenticated` plus the caller's JWT claims, exactly
 * what Supabase sets per request.
 *
 * The service role key is deliberately absent from this file. If a policy is
 * wrong, this path is as restricted as every other one — which is the point.
 */
let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error(
      'SUPABASE_DB_URL is not set. The console needs it to read reports under the caller’s identity.',
    );
  }
  pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 10_000 });
  return pool;
}

/**
 * Runs `work` inside a transaction as the given user. The transaction is always
 * rolled back: nothing that reads a report should be writing anything, and a
 * read path that cannot commit cannot accidentally mutate.
 */
export async function readAsUser<T>(
  userId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin read only');
    await client.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    await client.query('set local role authenticated');
    return await work(client);
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
  }
}

/**
 * The same identity, but permitted to commit.
 *
 * Used by the one console path that has to write while reading — the audit
 * export, which produces a file and records that it produced it. Still the
 * caller's own row-level security: a workspace cannot export, or record an
 * export against, an organisation it is not a member of.
 */
export async function writeAsUser<T>(
  userId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    await client.query('set local role authenticated');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Reads made on behalf of nobody: the public verification surfaces. Runs as the
 * `anon` role, so a mistake here can only expose what is already published.
 */
export async function readAsAnon<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin read only');
    await client.query('set local role anon');
    return await work(client);
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
  }
}

/** Writes made by the webhook endpoint, which has no signed-in user at all. */
export async function writeAsService<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}
