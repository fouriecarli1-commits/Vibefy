'use client';

import { useActionState } from 'react';
import { liftSpendPause } from './actions';
import { SHORTEST_LIFT_REASON } from '@/lib/spend-pause';
import type { ActionState } from '@/app/console/apps/actions';

/**
 * The button that starts the platform again.
 *
 * Deliberately plain and deliberately not a one-click: the reason is required
 * by the database and by the sentence under the field, because the row is read
 * later by somebody asking why the ceiling was lifted that day.
 */
export function LiftPauseForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(liftSpendPause, {});

  return (
    <form action={action} className="mt-4 space-y-3">
      <label className="block text-sm font-medium" htmlFor="lift-reason">
        Why may spending start again?
      </label>
      <textarea
        id="lift-reason"
        name="reason"
        rows={2}
        required
        minLength={SHORTEST_LIFT_REASON}
        className="w-full rounded-lg border border-line bg-transparent p-3 text-sm"
        placeholder="The ceiling was raised for the launch, agreed with Anré."
      />
      <p className="text-sm text-muted">
        Kept on the row with your name and the time. At least {SHORTEST_LIFT_REASON} characters.
      </p>
      <button type="submit" className="button" disabled={pending}>
        {pending ? 'Lifting…' : 'Lift the pause'}
      </button>
      {state.error && (
        <p className="text-sm text-bad" role="alert">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p className="text-sm text-muted" role="status">
          {state.notice}
        </p>
      )}
    </form>
  );
}
