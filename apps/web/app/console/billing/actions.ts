'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { PriceNotSetError, currencyForCountry, type PlanId } from '@vibefycode/billing';
import { createClient } from '@/lib/supabase/server';
import { PaymentsNotConfiguredError, paymentProvider } from '@/lib/payments';
import type { ActionState } from '@/app/console/apps/actions';

/**
 * Starts a hosted checkout. The customer types their card into the provider's
 * page, never ours — which is why there is no card field anywhere in this repo.
 */
export async function startCheckout(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You are signed out.' };

  const organisationId = String(formData.get('organisationId') ?? '');
  const plan = String(formData.get('plan') ?? '') as PlanId;
  const appId = String(formData.get('appId') ?? '') || undefined;
  // Where the customer is billed decides the currency, and the currency decides
  // the provider. Nothing here looks at what they can afford or at which
  // provider costs us less: somebody quoted one price and charged another has
  // been lied to, however small the difference.
  const billingCountry = String(formData.get('billingCountry') ?? '').toUpperCase() || null;

  if (!organisationId || !plan) return { error: 'Choose a workspace and a plan.' };
  if (!billingCountry) return { error: 'Choose the country you are billed in.' };

  const membership = await supabase
    .from('memberships')
    .select('role')
    .eq('organisation_id', organisationId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership.data || !['owner', 'admin', 'billing'].includes(String(membership.data.role))) {
    return { error: 'Only an owner or an admin can buy for this workspace.' };
  }

  const currency = currencyForCountry(billingCountry);

  let payments;
  try {
    payments = paymentProvider(currency);
  } catch (error) {
    if (error instanceof PaymentsNotConfiguredError) {
      return {
        error: `Payments in ${currency} are not configured on this deployment yet. See docs/OPEN_ITEMS.md.`,
      };
    }
    throw error;
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

  let session;
  try {
    session = await payments.createCheckoutSession({
      organisationId,
      plan,
      currency,
      customerEmail: user.email ?? '',
      successUrl: `${origin}/console/billing?purchased=1`,
      cancelUrl: `${origin}/console/billing?cancelled=1`,
      ...(appId ? { appId } : {}),
      // One key per attempt. Paystack treats this as the transaction reference
      // and rejects a reused one outright, so an abandoned checkout must not
      // poison the next try. It is therefore not a guard against a double-click
      // opening two checkouts — see docs/OPEN_ITEMS.md, which says so plainly
      // rather than leaving a comment here claiming otherwise.
      idempotencyKey: `checkout-${user.id.slice(0, 8)}-${plan}-${randomUUID().slice(0, 12)}`,
    });
  } catch (error) {
    if (error instanceof PriceNotSetError) {
      // Never converted, never guessed. A plan with no price in this currency
      // is a plan we have not decided how to sell here yet.
      return { error: `That plan is not sold in ${currency} yet.` };
    }
    throw error;
  }

  redirect(session.url);
}
