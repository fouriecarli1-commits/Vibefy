/**
 * A limited read says which rows it wants, not just how many.
 *
 * `.limit(20)` without `.order(...)` asks the database for twenty rows and
 * lets it choose which twenty. Postgres will usually hand back something
 * stable and the day it stops is the day an index is added, a row count
 * crosses a planner threshold, or a parallel plan is chosen — none of which
 * look like a change to this file.
 *
 * `packages/api` is the whole surface the phone reads through, and the phone
 * prints `history[0]` as the application's current score in large coloured
 * type. A window that chose its own twenty rows can leave the newest
 * assessment out of them, and then that figure is an old score presented as
 * today's.
 *
 * Tested through a recorder rather than a database, because what is being held
 * is the shape of the query — a thing the caller states — and not what any
 * particular planner does with it today.
 */
import { describe, expect, it } from 'vitest';
import { listAlerts, listApps, listAssessments, listRequests } from '../packages/api/src/client.ts';

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

/**
 * A stand-in for the Supabase query builder that records what was asked of it.
 *
 * Every method returns the chain, and the chain is awaitable, which is the
 * whole of the builder's contract as these functions use it.
 */
function recorder(rows: readonly Record<string, unknown>[] = []) {
  const calls: Call[] = [];
  const settled = () => Promise.resolve({ data: rows, error: null });
  const chain: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'then') {
          return (resolve: (value: unknown) => unknown) => settled().then(resolve);
        }
        return (...args: unknown[]) => {
          calls.push({ method: String(property), args });
          return chain;
        };
      },
    },
  );
  // The functions under test take a `SupabaseClient`; this is the part of it
  // they touch.
  return { calls, client: chain as never };
}

const methods = (calls: readonly Call[]) => calls.map((call) => call.method);

describe('every windowed read in the phone’s API', () => {
  const windows: readonly { name: string; run: (client: never) => Promise<unknown> }[] = [
    { name: 'listApps', run: (client) => listApps(client) },
    { name: 'listAssessments', run: (client) => listAssessments(client, 'app-1') },
    { name: 'listAlerts', run: (client) => listAlerts(client) },
    { name: 'listRequests', run: (client) => listRequests(client, 'app-1') },
  ];

  for (const { name, run } of windows) {
    it(`${name} orders whatever it limits`, async () => {
      const { calls, client } = recorder();
      await run(client);
      const asked = methods(calls);
      if (!asked.includes('limit')) return;
      expect(asked, `${name} limits without ordering`).toContain('order');
    });
  }
});

describe('the assessment the phone prints as the current score', () => {
  it('is the newest one, because the query says so', async () => {
    // `apps/mobile/app/application/[id].tsx` renders `history[0]` as the
    // application's score. The view this reads has its own `order by`, which
    // Postgres does not promise to keep once an outer query adds a limit.
    const { calls, client } = recorder();
    await listAssessments(client, 'app-1');
    const order = calls.find((call) => call.method === 'order');
    expect(order?.args[0]).toBe('assessed_at');
    expect(order?.args[1]).toEqual({ ascending: false });
  });

  it('orders before it limits, so the window is the newest twenty', async () => {
    const { calls, client } = recorder();
    await listAssessments(client, 'app-1');
    const asked = methods(calls);
    // Named rather than compared by index: a missing `order` is -1, and -1 is
    // less than every index, so the comparison alone passes on the defect.
    expect(asked).toContain('order');
    expect(asked.indexOf('order')).toBeLessThan(asked.indexOf('limit'));
  });
});
