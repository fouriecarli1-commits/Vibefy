/**
 * Single sign-on, enforced, and what happens when we cannot ask.
 *
 * Both sign-in forms — the web one and the one on the phone — asked
 * `sso_routing` whether an address belongs to a domain that requires single
 * sign-on, and both discarded the error:
 *
 *     const { data: routing } = await supabase.rpc('sso_routing', { … });
 *     if (route?.email_domain) { … refuse the password … }
 *
 * A failed call returns no data, `route` is undefined, the branch is skipped,
 * and the password is accepted. So the control is off exactly when the database
 * cannot answer — and both copies carried a comment saying the opposite.
 *
 * Not an authentication bypass: the password still has to be right. It is the
 * policy that fails. An organisation that enforced single sign-on so that
 * deprovisioned staff lose access keeps a working password route open, on a
 * network blip or a PostgREST schema-cache miss after a migration, both of
 * which are ordinary.
 *
 * The retry is the other half and is held here too. Failing closed on the first
 * error would lock out every password user — almost all of whom enforce nothing
 * — on any transient fault.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withoutComments } from './setup/source.ts';
import { describe, expect, it } from 'vitest';
import { SSO_ROUTING_UNKNOWN, ssoRoutingFor } from '../packages/shared/src/sso-routing.ts';

/** A client that answers however the test says, and counts the asking. */
function caller(answers: { data?: unknown; error?: { message: string } }[]) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    client: {
      async rpc() {
        const answer = answers[Math.min(calls, answers.length - 1)]!;
        calls += 1;
        return { data: answer.data ?? null, error: answer.error ?? null };
      },
    },
  };
}

describe('when the lookup answers', () => {
  it('refuses the password for a domain that enforces single sign-on', async () => {
    const { client } = caller([{ data: [{ email_domain: 'bank.example', provider: 'okta' }] }]);
    expect(await ssoRoutingFor(client, 'someone@bank.example')).toEqual({
      kind: 'required',
      domain: 'bank.example',
    });
  });

  it('reads the row whether it arrives wrapped in an array or not', async () => {
    // `returns table` comes back as an array through PostgREST and as a row
    // from a direct call. Getting this wrong reads as "no SSO", which is the
    // same failure one layer along.
    const { client } = caller([{ data: { email_domain: 'bank.example' } }]);
    expect(await ssoRoutingFor(client, 'someone@bank.example')).toEqual({
      kind: 'required',
      domain: 'bank.example',
    });
  });

  it('lets a password through for a domain that enforces nothing', async () => {
    const { client } = caller([{ data: [] }]);
    expect(await ssoRoutingFor(client, 'someone@gmail.com')).toEqual({ kind: 'not_required' });
  });
});

describe('when the lookup does not answer', () => {
  it('does not treat silence as "no single sign-on"', async () => {
    // The defect, in one line. `{ data: null, error: … }` used to mean the
    // password was accepted.
    const { client } = caller([{ error: { message: 'Could not find the function' } }]);
    const outcome = await ssoRoutingFor(client, 'someone@bank.example');
    expect(outcome.kind).toBe('unknown');
    expect(outcome.kind === 'unknown' && outcome.because).toContain('Could not find the function');
  });

  it('asks a second time before refusing, so a blip locks nobody out', async () => {
    const asked = caller([{ error: { message: 'network error' } }, { data: [] }]);
    expect(await ssoRoutingFor(asked.client, 'someone@gmail.com')).toEqual({
      kind: 'not_required',
    });
    expect(asked.calls).toBe(2);
  });

  it('asks twice and no more, because a persistent failure is the case to refuse', async () => {
    const asked = caller([{ error: { message: 'down' } }]);
    expect((await ssoRoutingFor(asked.client, 'someone@bank.example')).kind).toBe('unknown');
    expect(asked.calls).toBe(2);
  });

  it('has a sentence that says what could not be established', async () => {
    expect(SSO_ROUTING_UNKNOWN).toMatch(/could not check/i);
    expect(SSO_ROUTING_UNKNOWN).toMatch(/password cannot be accepted/i);
  });
});

describe('both sign-in forms read the same answer', () => {
  /** The code, without the comments — which quote the defect on purpose. */
  const source = (path: string) => withoutComments(readFileSync(join(process.cwd(), path), 'utf8'));

  for (const path of ['apps/web/components/auth-form.tsx', 'apps/mobile/app/sign-in.tsx']) {
    it(`${path} does not call the lookup itself`, () => {
      // Two copies of this is how it drifted in the first place, and the
      // discarded error was in both.
      expect(source(path)).not.toMatch(/rpc\(\s*['"]sso_routing['"]/);
      expect(source(path)).toMatch(/ssoRoutingFor/);
    });

    it(`${path} refuses the password when the answer is unknown`, () => {
      expect(source(path)).toMatch(/SSO_ROUTING_UNKNOWN/);
    });
  }
});
