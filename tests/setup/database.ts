/**
 * Boots the ephemeral Postgres used by the row-level-security suite and applies
 * the real migrations to it. The policies that separate one customer's data
 * from another's are tested against an actual database, never a mock.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = join(root, 'scripts', 'test-db.sh');

export default function setup(): void {
  const dsn = execFileSync('bash', [script, 'reset'], { encoding: 'utf8' }).trim().split('\n').pop();
  if (!dsn) throw new Error('test-db.sh did not return a connection string');
  process.env.VIBEFY_TEST_DSN = dsn;
}
