'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { StripeProvider, type PaymentProvider, type PlanId } from '@vibefy/billing';
import { createClient } from '@/lib/supabase/server';
import type { ActionState } from '@/app/console/apps/actions';

function provider(): PaymentProvider | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  return new StripeProvider({
    secretKey,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    priceIds: {
      one_off: process.env.STRIPE_PRICE_ONE_OFF ?? '',
      certified: process.env.STRIPE_PRICE_CERTIFIED ?? '',
      agency: process.env.STRIPE_PRICE_AGENCY ?? '',
      organisation: process.env.STRIPE_PRICE_ORGANISATION ?? '',
    },
  });
}

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

  if (!organisationId || !plan) return { error: 'Choose a workspace and a plan.' };

  const membership = await supabase
    .from('memberships')
    .select('role')
    .eq('organisation_id', organisationId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership.data || !['owner', 'admin', 'billing'].includes(String(membership.data.role))) {
    return { error: 'Only an owner or an admin can buy for this workspace.' };
  }

  const payments = provider();
  if (!payments) {
    return {
      error:
        'Payments are not configured on this deployment yet. Set STRIPE_SECRET_KEY and the price ids — see docs/OPEN_ITEMS.md.',
    };
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const session = await payments.createCheckoutSession({
    organisationId,
    plan,
    customerEmail: user.email ?? '',
    successUrl: `${origin}/console/billing?purchased=1`,
    cancelUrl: `${origin}/console/billing?cancelled=1`,
    ...(appId ? { appId } : {}),
    // Deterministic per user, plan and app: a double-click must not open two
    // checkouts and risk two charges.
    idempotencyKey: `checkout:${user.id}:${organisationId}:${plan}:${appId ?? 'none'}:${randomUUID().slice(0, 8)}`,
  });

  redirect(session.url);
}
