'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * A second step, with an authenticator app.
 *
 * Supabase's own TOTP, not a second authentication system of our own: the
 * brief says no custom auth, and an application that rolls its own second
 * factor has written the part of the login that is hardest to get right and
 * easiest to get subtly wrong.
 *
 * ## The lock-out this must not create
 *
 * We have just finished building a password reset because there was none, and
 * the owner of this product could not get into his own account. A second step
 * is the same trap with a shorter fuse: lose the phone and the reset email no
 * longer helps, because the reset link lands you at the second step as well.
 *
 * So two things are said here before anything is enrolled, in the panel rather
 * than in a document nobody opens — keep the recovery route, and add a second
 * device if you have one. Supabase allows several factors on one account, and
 * two enrolled devices is the difference between an inconvenience and losing
 * the organisation.
 */

interface Factor {
  readonly id: string;
  readonly friendlyName: string;
  readonly createdAt: string;
}

interface Enrolling {
  readonly factorId: string;
  /** An SVG data URI from Supabase. Rendered as an image, never as markup. */
  readonly qr: string;
  /** The same secret in characters, for a device whose camera will not do it. */
  readonly secret: string;
}

export function MfaPanel() {
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<{ kind: 'idle' | 'busy' | 'error' | 'done'; text?: string }>(
    { kind: 'idle' },
  );

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      // Said, not swallowed. A panel that renders "no second step" when it
      // simply could not ask would tell somebody who has one that they do not,
      // which is the one answer here that could get them to turn it off.
      setStatus({ kind: 'error', text: `Could not read your current settings: ${error.message}` });
      return;
    }
    setFactors(
      (data?.totp ?? []).map((factor) => ({
        id: factor.id,
        friendlyName: factor.friendly_name ?? 'Authenticator app',
        createdAt: factor.created_at,
      })),
    );
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function startEnrolment() {
    setStatus({ kind: 'busy' });
    const supabase = createClient();
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
    });
    if (error || !data) {
      return setStatus({
        kind: 'error',
        text: error?.message ?? 'Enrolment could not be started.',
      });
    }
    setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setCode('');
    setStatus({ kind: 'idle' });
  }

  async function confirmEnrolment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enrolling) return;
    setStatus({ kind: 'busy' });
    const supabase = createClient();
    const challenge = await supabase.auth.mfa.challenge({ factorId: enrolling.factorId });
    if (challenge.error || !challenge.data) {
      return setStatus({
        kind: 'error',
        text: challenge.error?.message ?? 'That step could not be started again.',
      });
    }
    const { error } = await supabase.auth.mfa.verify({
      factorId: enrolling.factorId,
      challengeId: challenge.data.id,
      code: code.trim(),
    });
    if (error) {
      return setStatus({
        kind: 'error',
        text: `${error.message} Codes change every thirty seconds — if the last one expired while you typed it, the next one will work.`,
      });
    }
    setEnrolling(null);
    setStatus({ kind: 'done', text: 'That device is now a second step on this account.' });
    await refresh();
  }

  async function remove(factorId: string) {
    setStatus({ kind: 'busy' });
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) return setStatus({ kind: 'error', text: error.message });
    setStatus({ kind: 'done', text: 'That device is no longer a second step.' });
    await refresh();
  }

  const enrolled = factors ?? [];

  return (
    <section aria-labelledby="second-step" className="space-y-6">
      <div className="space-y-2">
        <h2 id="second-step" className="text-2xl font-bold tracking-tight">
          A second step, from an authenticator app
        </h2>
        <p className="max-w-prose text-muted">
          An authenticator app on your phone shows a six-digit code that changes every thirty
          seconds. With one enrolled, signing in asks for your password and then for the code. It
          works offline, and it is not tied to your phone number — which is the part of a text
          message that somebody else can take over.
        </p>
      </div>

      {status.kind === 'error' && (
        <p role="alert" className="rounded-xl border border-line bg-surface-muted p-4 text-bad">
          {status.text}
        </p>
      )}
      {status.kind === 'done' && (
        <p role="status" className="rounded-xl border border-line bg-surface-muted p-4 text-ok">
          {status.text}
        </p>
      )}

      {factors === null ? (
        <p className="text-muted">Reading your current settings…</p>
      ) : enrolled.length === 0 ? (
        <p className="text-muted">
          No second step is set up. Your password on its own reaches this account.
        </p>
      ) : (
        <ul className="space-y-3">
          {enrolled.map((factor) => (
            <li
              key={factor.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4"
            >
              <span>
                <span className="block font-medium">{factor.friendlyName}</span>
                <span className="block text-sm text-muted">
                  Added {factor.createdAt.slice(0, 10)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void remove(factor.id)}
                className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Said before enrolment, not after.

          A second step turns a forgotten password into an inconvenience and a
          lost phone into a locked account: the reset email still works, and
          then asks for a code from the device that is gone. The honest time to
          say that is while somebody is deciding, and the honest advice is to
          enrol the second device at the same sitting rather than intending to. */}
      <div className="rounded-xl border border-line-strong p-5">
        <h3 className="font-semibold">Before you turn this on</h3>
        <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-muted">
          <li>
            Losing the device means losing the account. A password reset email lands at the second
            step too, so it does not get you past a phone you no longer have.
          </li>
          <li>
            Enrol two devices if you have two, in the same sitting. Everything on this page can be
            done again for a second one, and that is what turns a lost phone into an inconvenience.
          </li>
          <li>
            Keep the setup key below somewhere a fire would not take with the phone. It is enough to
            set the same codes up again on a new device.
          </li>
        </ul>
      </div>

      {enrolling ? (
        <form onSubmit={confirmEnrolment} className="space-y-5 rounded-xl border border-line p-5">
          <h3 className="font-semibold">Scan this, then type the code it shows</h3>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={enrolling.qr}
            alt="A QR code to scan with your authenticator app. The same value is written out below it as a setup key."
            width={200}
            height={200}
            className="rounded-lg bg-white p-2"
          />
          <div className="space-y-1">
            <p className="text-sm font-medium">Setup key, if the camera will not do it</p>
            <code className="block break-all rounded-lg bg-surface-muted p-3 text-sm">
              {enrolling.secret}
            </code>
          </div>
          <div className="space-y-2">
            <label htmlFor="mfa-code" className="block text-sm font-medium">
              The six-digit code
            </label>
            <input
              id="mfa-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="w-full max-w-40 rounded-lg border border-line-strong bg-surface px-3 py-2 text-lg tracking-widest"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={status.kind === 'busy'}
              className="rounded-lg bg-accent px-4 py-3 font-medium text-on-accent disabled:opacity-60"
            >
              {status.kind === 'busy' ? 'Checking…' : 'Confirm this device'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEnrolling(null);
                setStatus({ kind: 'idle' });
              }}
              className="rounded-lg border border-line-strong px-4 py-3 font-medium"
            >
              Cancel
            </button>
          </div>
          <p className="text-sm text-muted">
            Nothing changes until the code is accepted. Until then your password still reaches this
            account on its own.
          </p>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => void startEnrolment()}
          disabled={status.kind === 'busy'}
          className="rounded-lg bg-accent px-4 py-3 font-medium text-on-accent disabled:opacity-60"
        >
          {enrolled.length === 0 ? 'Set up an authenticator app' : 'Add another device'}
        </button>
      )}
    </section>
  );
}
