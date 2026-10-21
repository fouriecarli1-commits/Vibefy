'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { writeAsService } from '@/lib/sql';
import { SECOND_STEP_REQUIRED, sessionPassedSecondStep } from '@/lib/second-step-server';
import { liftLivePause, whyALiftIsRefused } from '@/lib/spend-pause';
import type { ActionState } from '@/app/console/apps/actions';

/**
 * Lifting the stop the platform put on itself.
 *
 * The pause is automatic and the lift is not — `packages/governance/src/spend.ts`
 * says getting that the wrong way round is how a capped system produces an
 * uncapped bill. Until now the second half did not exist in the product at all:
 * the grant on `spend_pauses` is `select`, so not even an administrator could
 * clear one from the console, and the only way back was a statement typed
 * against the database by hand.
 *
 * Three gates, in the order that costs least to fail:
 *
 *   · signed in, because `lifted_by` is a person and is taken from the session
 *     rather than from anything the form can carry;
 *   · an administrator, read through that person's own row-level security;
 *   · the second step, for the same reason the review actions ask for it. This
 *     one restarts spending across the whole platform.
 *
 * The write itself goes through the service role, because the policy on that
 * table grants select and nothing else. The alternative is a migration adding
 * an update policy, which is the stronger shape and is not available tonight:
 * a button that silently does nothing until a migration has been run by hand is
 * the failure this page exists to end. `/admin/health` still prints the
 * statement that does it directly, so a lift is possible even when this refuses.
 */
export async function liftSpendPause(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reason = String(formData.get('reason') ?? '');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You are signed out.' };

  const { data: profile } = await supabase
    .from('users')
    .select('platform_role')
    .eq('id', user.id)
    .single();
  if (profile?.platform_role !== 'admin') {
    return { error: 'Only a VibefyCode administrator can lift a spend pause.' };
  }
  if (!(await sessionPassedSecondStep())) return { error: SECOND_STEP_REQUIRED };

  const refused = whyALiftIsRefused(reason);
  if (refused) return { error: refused };

  const { lifted } = await writeAsService((client) =>
    liftLivePause(client, { userId: user.id, reason }),
  );
  revalidatePath('/admin/health');

  return lifted > 0
    ? {
        notice:
          'Lifted. The worker reads the pause before it claims anything, so it starts taking work again within five minutes. Your reason is kept on the row.',
      }
    : {
        // Not an error of theirs, and not a success either. Somebody else may
        // have lifted it, or the sweep may have found the day's spend back
        // under the ceiling.
        notice: 'There was no live pause to lift. Nothing was changed.',
      };
}
