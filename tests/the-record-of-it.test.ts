/**
 * What an operator is told when the record of their act did not land.
 *
 * `audit_log` is append-only and closed to everyone but a platform
 * administrator, and it is where acts by the operator are kept beside acts by
 * the customer. Both admin actions that write to it discarded the result: the
 * plan change or the role change had already happened, so there was nothing to
 * roll back — and they returned success, which is true about the change and
 * false about the record of it.
 *
 * The shape is the point. An error here must not become *the* error, because
 * that would say the act failed when it did not; and it must not vanish,
 * because then an operator believes something is written down that is not.
 */
import { describe, expect, it } from 'vitest';
import { andTheRecordOfIt } from '../apps/web/lib/audit.ts';

describe('the record of it', () => {
  it('says nothing extra when the entry landed', () => {
    expect(andTheRecordOfIt('Agency: assessments run at full depth.', null)).toBe(
      'Agency: assessments run at full depth.',
    );
  });

  it('still says what happened, because it did happen', () => {
    // The act is not undone by the log failing, and telling an operator it
    // failed would send them to do it twice.
    const said = andTheRecordOfIt('somebody@example.test is now reviewer.', {
      message: 'new row violates row-level security policy for table "audit_log"',
    });
    expect(said).toContain('somebody@example.test is now reviewer.');
  });

  it('says the record is missing, and carries the reason', () => {
    const said = andTheRecordOfIt('somebody@example.test is now reviewer.', {
      message: 'new row violates row-level security policy for table "audit_log"',
    });
    expect(said).toMatch(/not written to the audit log/i);
    expect(said).toContain('row-level security');
  });

  it('says that this message is now the only record', () => {
    // The remedy once an append-only table has declined a row is for the
    // operator to write it down themselves, and they can only do that if they
    // know they have to.
    expect(andTheRecordOfIt('Done.', { message: 'timeout' })).toMatch(
      /no record of it but this message/i,
    );
  });
});
