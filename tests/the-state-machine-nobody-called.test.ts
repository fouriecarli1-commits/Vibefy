/**
 * A transition table consulted by nothing but its own test.
 *
 * `packages/governance/src/requests.ts` carries the state machine for a
 * data-subject request and says why the terminal states are terminal:
 *
 *     // Terminal. A completed request that can be reopened is a deadline that
 *     // can be restarted, which is the same as no deadline.
 *     completed: [],
 *     refused: [],
 *
 * `canTransition` reads that table. Measured on 2026-10-07, every caller of it
 * in the repository was `tests/governance.test.ts`. Nothing in the application
 * asked it anything.
 *
 * What `resolveDataRequest` checked was the *target*:
 *
 *     if (!['verifying', 'in_progress', 'completed', 'refused'].includes(status))
 *
 * — a list of known statuses, with no reference to where the row is now. So a
 * completed request could be moved back to `in_progress`, and a refused one to
 * `completed`, by the reviewer's own form. The clock on a statutory request is
 * the whole point of handling it in product rather than by email, and it could
 * be restarted after it had been answered.
 *
 * The rule is given to the statement rather than checked before it:
 * `statusesThatMayBecome` turns the table around, the update filters on it, and
 * an illegal move matches no row and falls into the branch that already exists
 * for a write that changed nothing. One statement, so there is no window
 * between reading the status and writing it — which a read-then-write check
 * would have, and which matters for a row two reviewers can reach.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canTransition,
  statusesThatMayBecome,
  type RequestStatus,
} from '../packages/governance/src/index.ts';

const ALL: RequestStatus[] = ['received', 'verifying', 'in_progress', 'completed', 'refused'];

describe('the statuses a move is legal from', () => {
  it('agrees with canTransition for every pair, in both directions', () => {
    // Derived from the same table, so what this checks is that turning the rule
    // around did not change it.
    for (const to of ALL) {
      const legal = statusesThatMayBecome(to);
      for (const from of ALL) {
        expect(legal.includes(from)).toBe(canTransition(from, to));
      }
    }
  });

  it('never lets a completed request become anything', () => {
    for (const to of ALL) expect(statusesThatMayBecome(to)).not.toContain('completed');
  });

  it('never lets a refused request become anything', () => {
    for (const to of ALL) expect(statusesThatMayBecome(to)).not.toContain('refused');
  });

  it('still lets a received request be verified, worked on, or refused', () => {
    // The direction this guard fails in: refusing every move, which leaves a
    // statutory request that can never be answered.
    expect(statusesThatMayBecome('verifying')).toContain('received');
    expect(statusesThatMayBecome('in_progress')).toContain('received');
    expect(statusesThatMayBecome('refused')).toContain('received');
  });

  it('lets work in progress be completed', () => {
    expect(statusesThatMayBecome('completed')).toContain('in_progress');
  });

  it('does not let a received request skip straight to completed', () => {
    expect(statusesThatMayBecome('completed')).not.toContain('received');
  });
});

describe('the action that resolves a request', () => {
  /** The code, without the comments — which quote the defect on purpose. */
  const source = readFileSync(
    join(import.meta.dirname, '..', 'apps/web/app/console/privacy/actions.ts'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ');

  it('constrains the update by the status the row is in', () => {
    expect(source).toMatch(/statusesThatMayBecome\(/);
    expect(source).toMatch(/\.in\('status', legalFrom\)/);
  });

  it('tells the reviewer which of the two refusals it was', () => {
    // "Not changed" covers a row this reviewer cannot see and a move the state
    // machine forbids, and those need different things done about them.
    expect(source).toMatch(/canTransition\(/);
    expect(source).toMatch(/cannot become/);
  });

  it('still asks what it changed, which is the rule it sits inside', () => {
    expect(source).toMatch(/\.select\('id'\)/);
  });
});
