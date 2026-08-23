import { Client } from 'pg';

/**
 * Connects as a specific Supabase role. Tests set `request.jwt.claims` exactly
 * as Supabase does per request, so policies are exercised through the same
 * mechanism they will face in production rather than a test-only shortcut.
 */
export interface ActingAs {
  readonly userId?: string;
  readonly role?: 'anon' | 'authenticated' | 'service_role';
}

const dsnParts = () => {
  const dsn = process.env.VIBEFYCODE_TEST_DSN;
  if (!dsn) throw new Error('VIBEFYCODE_TEST_DSN is not set — global setup did not run');
  const url = new URL(dsn);
  const host = url.searchParams.get('host');
  if (!host) throw new Error(`Expected a Unix socket DSN, got ${dsn}`);
  return { host, database: url.pathname.replace(/^\//, ''), user: 'postgres' };
};

export async function connect(): Promise<Client> {
  const client = new Client(dsnParts());
  await client.connect();
  return client;
}

/** Runs `work` inside a transaction under the given identity, then rolls back. */
export async function actingAs<T>(
  client: Client,
  identity: ActingAs,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const role = identity.role ?? 'authenticated';
  const claims = JSON.stringify({ sub: identity.userId ?? null, role });
  await client.query('begin');
  try {
    await client.query('select set_config($1, $2, true)', ['request.jwt.claims', claims]);
    await client.query(`set local role ${role}`);
    return await work(client);
  } finally {
    await client.query('rollback');
  }
}

/**
 * Runs a query that is expected to be refused, inside a savepoint, so that one
 * refusal does not abort the surrounding transaction and mask the next check.
 */
export async function expectRefusal(
  client: Client,
  sql: string,
  params: unknown[] = [],
): Promise<string> {
  await client.query('savepoint probe');
  try {
    await client.query(sql, params);
    await client.query('release savepoint probe');
    return '';
  } catch (error) {
    await client.query('rollback to savepoint probe');
    return error instanceof Error ? error.message : String(error);
  }
}
