/**
 * The sentence an operator is owed when the record of their act did not land.
 *
 * `audit_log` is append-only, closed to everyone but a platform administrator,
 * and it is where acts by the operator are kept alongside acts by the customer.
 * The two admin actions that write to it discarded the result: the plan change
 * or the role change had already happened, so there was nothing to roll back
 * and nothing to report — and they reported success, which is true about the
 * change and false about the record of it.
 *
 * An error here cannot be returned as *the* error, because that would say the
 * act failed when it did not. It travels with the success instead: what
 * happened, and what was not written down. The operator can then write it down
 * themselves, which is the only remedy there is once an append-only table has
 * declined a row.
 */
export function andTheRecordOfIt(notice: string, error: { message: string } | null): string {
  if (!error) return notice;
  return `${notice} This was not written to the audit log — ${error.message} — so there is no record of it but this message.`;
}
