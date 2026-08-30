/**
 * What is worth retrying, and what is worth paying for twice.
 *
 * An assessment is billed before it is persisted. So the retry decision is a
 * spending decision: requeueing a deterministic database error does not fix
 * anything, it just buys the identical error again at full price. That is not
 * hypothetical — the first production run was paid for three times to reach the
 * same foreign key violation.
 *
 * The rule is a deny-list rather than an allow-list on purpose. A dropped
 * connection or a deadlock must stay retryable, and an allow-list would quietly
 * make every unfamiliar transient failure permanent.
 */
import { describe, expect, it } from 'vitest';
import { isRetryableFailure } from '../apps/worker/src/queue.ts';

/** Shaped like what node-pg throws: an Error carrying a SQLSTATE. */
function pgError(code: string, message = 'database said no'): Error {
  return Object.assign(new Error(message), { code });
}

describe('isRetryableFailure', () => {
  it('refuses to retry the foreign key violation that started this', () => {
    expect(
      isRetryableFailure(
        pgError(
          '23503',
          'insert or update on table "assessments" violates foreign key constraint "assessments_rubric_version_fkey"',
        ),
      ),
    ).toBe(false);
  });

  it('refuses to retry any integrity constraint violation', () => {
    for (const code of ['23502', '23503', '23505', '23514']) {
      expect(isRetryableFailure(pgError(code))).toBe(false);
    }
  });

  it('refuses to retry a value that will never parse or fit', () => {
    for (const code of ['22001', '22003', '22P02']) {
      expect(isRetryableFailure(pgError(code))).toBe(false);
    }
  });

  it('refuses to retry our own broken SQL', () => {
    for (const code of ['42703', '42P01', '42883']) {
      expect(isRetryableFailure(pgError(code))).toBe(false);
    }
  });

  it('still retries the failures another attempt could survive', () => {
    // Connection exception, deadlock, serialisation failure, insufficient
    // resources. These are the reason the retry exists at all.
    for (const code of ['08006', '08003', '40001', '40P01', '53300', '57P01']) {
      expect(isRetryableFailure(pgError(code))).toBe(true);
    }
  });

  it('retries anything that carries no SQLSTATE at all', () => {
    // A network timeout, an aborted fetch, a bug in our own code. Unknown is
    // not the same as permanent, and the attempt counter bounds it anyway.
    expect(isRetryableFailure(new Error('socket hang up'))).toBe(true);
    expect(isRetryableFailure('a string')).toBe(true);
    expect(isRetryableFailure(null)).toBe(true);
    expect(isRetryableFailure(undefined)).toBe(true);
    expect(isRetryableFailure({ code: 500 })).toBe(true);
  });
});
