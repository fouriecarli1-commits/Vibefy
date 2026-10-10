/**
 * The sentence that explains a refusal was wired into one route out of five.
 *
 * `whyTheDatabaseRefused` exists because of a real evening: after the database
 * password was reset, Supabase's pooler tripped a breaker over a second
 * service still retrying with the old one, and the refusal it returns reads
 * character for character like our own bad password. The function says so, in
 * one sentence, and it was called in exactly one place —
 * `app/badge/[file]/route.ts`, the badge *image* route.
 *
 * So the badge image explained it in the log, and `/verify`, the trust page,
 * the console and every report did not. Those are the pages somebody opens
 * when the badge is grey. They were the ones saying nothing.
 *
 * `lib/sql.ts` is where all four identities connect, so that is where the
 * explanation belongs. This holds the wiring rather than the sentence: the
 * sentence has its own tests in `connection-string.test.ts`, and what was
 * wrong was never the wording.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { whyTheDatabaseRefused } from '../apps/web/lib/connection-string.ts';
import { withoutComments } from './setup/source.ts';

const sql = withoutComments(readFileSync('apps/web/lib/sql.ts', 'utf8'));

describe('every identity that connects', () => {
  it('goes through one place, so there is one place to explain a refusal', () => {
    // Four accessors — as a user, as a user who may write, as anon, as the
    // service — and `getPool().connect()` appearing once means they share a
    // path. Two would mean one of them is back to being on its own.
    expect(sql.match(/getPool\(\)\.connect\(\)/g) ?? []).toHaveLength(1);
    expect(sql.match(/connectAndExplainRefusals\(\)/g) ?? []).toHaveLength(5);
  });

  it('decodes the refusal on that path', () => {
    expect(sql).toMatch(/whyTheDatabaseRefused\(/);
  });

  it('keeps the original message beside the explanation', () => {
    // The message is what somebody searches for; the sentence is what tells
    // them it is not the thing it looks like. Replacing one with the other
    // would lose the half that matches a support thread.
    const block = sql.slice(sql.indexOf('connectAndExplainRefusals'));
    const logged = block.slice(block.indexOf('console.error'), block.indexOf('throw error'));
    expect(logged).toMatch(/error: detail/);
    expect(logged).toMatch(/means/);
  });
});

describe('the sentence itself, which was never the problem', () => {
  it.each(['FATAL: circuit breaker is open', 'too many authentication failures'])(
    'still names the breaker rather than the password, given %s',
    (message) => {
      const means = whyTheDatabaseRefused(message);
      expect(means, 'the breaker is no longer recognised').not.toBeNull();
      expect(means).toMatch(/says nothing about the password used here/i);
    },
  );

  it('does not recognise a bare password failure, which is the open question', () => {
    /*
     * Worth asserting because it is the thing I cannot check from here, and a
     * test that quietly expected either answer would hide it.
     *
     * The function matches `circuit breaker` and `too many authentication
     * failures`. Whether Supabase's pooler actually sends either of those to
     * the client, or only `password authentication failed for user ...`, is
     * not something this repository can establish — and if it is the latter,
     * the sentence never fires for the evening it was written for. The next
     * occurrence settles it: the message is in the Vercel log. It is in
     * `docs/OPEN_ITEMS.md` with that instruction.
     *
     * Null is still the right answer here. A bare password failure usually is
     * a wrong password, and attaching the breaker's sentence to it would send
     * somebody to check the thing that was fine, which is how the original
     * evening went.
     */
    expect(whyTheDatabaseRefused('password authentication failed for user "postgres"')).toBeNull();
  });

  it('says nothing about a refusal it cannot explain', () => {
    // Null rather than a guess. A sentence attached to the wrong failure sends
    // somebody to check the thing that was fine, which is how this started.
    expect(whyTheDatabaseRefused('relation "public.badges" does not exist')).toBeNull();
  });
});
