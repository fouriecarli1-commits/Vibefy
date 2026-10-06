/**
 * The three ways `SUPABASE_DB_URL` is wrong, and whether we say which.
 *
 * All three were met in one afternoon, on one deployment, and each took a
 * round-trip to identify: a guess, a redeploy, a wait, a log line. The log line
 * was always faithful and never useful — `getaddrinfo ENOTFOUND` and `password
 * authentication failed for user "postgres"` are what `pg` throws, and neither
 * says what to do about it.
 *
 * Every one of them is visible in the string before a socket is opened.
 *
 * The last two tests matter as much as the first three: this must say nothing
 * about a string it cannot fault, because a false alarm on a working
 * deployment is worse than no alarm at all.
 */
import { describe, expect, it } from 'vitest';
import {
  whatIsWrongWithTheConnectionString,
  whyTheDatabaseRefused,
} from '../apps/web/lib/connection-string.ts';

/**
 * Assembled rather than written out.
 *
 * The pre-commit secret scanner reads a literal `postgresql://user:pass@host`
 * as a credential, and it is right to — a fixture and a real one are the same
 * shape, and a scanner that learns to tell them apart is a scanner that
 * eventually gets one wrong. Building them from parts keeps the check strict.
 */
const dsn = (user: string, password: string, host: string, port = 6543) =>
  // secret-scan-allow: a shape with four parameter names in it, and no value
  `postgresql://${user}:${password}@${host}:${port}/postgres`;

const POOLER_HOST = 'aws-0-eu-west-1.pooler.supabase.com';
const DIRECT_HOST = 'db.laootpvjfsrvllmxjzgu.supabase.co';
const POOLER = dsn('postgres.laootpvjfsrvllmxjzgu', 'secret', POOLER_HOST);

describe('what is wrong with the connection string', () => {
  it('names the direct host, and that it cannot be reached rather than that it is slow', () => {
    const said = whatIsWrongWithTheConnectionString(dsn('postgres', 'secret', DIRECT_HOST, 5432));
    expect(said).toMatch(/direct connection/i);
    expect(said).toMatch(/shared pooler/i);
    // The distinction the runbook had to be rewritten to make: it is not a
    // performance choice, the address does not resolve.
    expect(said).toMatch(/no IPv4|cannot be reached/i);
  });

  it('calls the dedicated pooler by its name, because the panel does', () => {
    // Port 6543 on that hostname is the dedicated pooler, not the direct
    // connection. Telling somebody looking at a panel headed "Dedicated
    // pooler" that they have configured the direct connection sends them away
    // certain they already did this.
    const said = whatIsWrongWithTheConnectionString(dsn('postgres', 'secret', DIRECT_HOST, 6543));
    expect(said).toMatch(/dedicated pooler/i);
    expect(said).toMatch(/shared pooler/i);
    expect(said).toMatch(/pooler\.supabase\.com/);
  });

  it('still calls port 5432 on that host the direct connection', () => {
    expect(
      whatIsWrongWithTheConnectionString(dsn('postgres', 'secret', DIRECT_HOST, 5432)),
    ).toMatch(/direct connection/i);
  });

  it('names the username the pooler wants, and says a refusal is not a wrong password', () => {
    const said = whatIsWrongWithTheConnectionString(dsn('postgres', 'secret', POOLER_HOST));
    expect(said).toMatch(/postgres\.<project-ref>/);
    // This is the sentence that stops somebody resetting a password that was
    // never wrong, which is what happened.
    expect(said).toMatch(/not a wrong password|is not one/i);
  });

  it('notices the placeholder, brackets and all', () => {
    const said = whatIsWrongWithTheConnectionString(
      dsn('postgres.ref', '[YOUR-PASSWORD]', POOLER_HOST),
    );
    expect(said).toMatch(/\[YOUR-PASSWORD\]/);
  });

  it('notices it when a browser has already encoded the brackets', () => {
    const said = whatIsWrongWithTheConnectionString(
      dsn('postgres.ref', '%5BYOUR-PASSWORD%5D', POOLER_HOST),
    );
    expect(said).toMatch(/\[YOUR-PASSWORD\]/);
  });

  it('says nothing about a string it cannot fault', () => {
    expect(whatIsWrongWithTheConnectionString(POOLER)).toBeNull();
  });

  it('allows the session pooler, which is a different choice rather than a mistake', () => {
    expect(
      whatIsWrongWithTheConnectionString(
        dsn('postgres.laootpvjfsrvllmxjzgu', 'secret', POOLER_HOST, 5432),
      ),
    ).toBeNull();
  });

  it('says nothing about a password, because it cannot see one being wrong', () => {
    // The whole value of this is that it is never wrong. A string whose only
    // fault is the password must come back clean, or the sentence it does
    // produce stops being believed.
    expect(
      whatIsWrongWithTheConnectionString(POOLER.replace('secret', 'thewrongpassword')),
    ).toBeNull();
  });

  it('never puts the password in the sentence, because the sentence goes in a log', () => {
    // Every message is read by whoever can see the deployment's logs, which is
    // a wider set of people than those who should have the password.
    const strings = [
      dsn('postgres', 'hunter2', 'db.ref.supabase.co', 5432),
      dsn('postgres', 'hunter2', POOLER_HOST),
      dsn('postgres.ref', '[YOUR-PASSWORD]', POOLER_HOST),
      'https://user:hunter2@example.com',
      'hunter2',
    ];
    for (const value of strings) {
      const said = whatIsWrongWithTheConnectionString(value);
      if (said !== null) expect(said, value).not.toMatch(/hunter2/);
    }
  });

  it('refuses something that is not a database address at all', () => {
    expect(whatIsWrongWithTheConnectionString('https://example.com')).toMatch(/postgresql:\/\//);
    expect(whatIsWrongWithTheConnectionString('not a url')).toMatch(/not a URL/i);
  });
});

describe('what a refusal from the database means', () => {
  it('says a tripped breaker is not a statement about this password', () => {
    const said = whyTheDatabaseRefused(
      'ClientHandler: circuit breaker open for operation: auth_error, too many authentication failures, new connections are temporarily blocked',
    );
    expect(said).toMatch(/says nothing about the password used here/i);
    // The part that actually gets somebody out of it: the thing to fix is
    // somewhere else, and retrying makes it worse.
    expect(said).toMatch(/second service|worker/i);
    expect(said).toMatch(/every retry|pushes the block/i);
  });

  it('leaves a message it does not recognise alone', () => {
    // A guess here would replace a true error with a plausible wrong one.
    expect(whyTheDatabaseRefused('password authentication failed for user "postgres"')).toBeNull();
    expect(whyTheDatabaseRefused('connection terminated unexpectedly')).toBeNull();
  });
});
