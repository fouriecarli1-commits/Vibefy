/**
 * "We could not ask" told apart from "nobody is signed in".
 *
 * Seventy places in the web app did this, and every one of them dropped the
 * error:
 *
 *     const {
 *       data: { user },
 *     } = await supabase.auth.getUser();
 *     if (!user) redirect('/sign-in');
 *
 * `getUser` reaches the auth service over the network, and it does not throw
 * when that goes wrong — it answers with an error in the result. So a failure
 * there produced exactly the same `user: null` as a visitor who has never
 * signed in, and a customer with a live session was sent to the sign-in page:
 * the page that looks as though the problem is theirs. Nothing anywhere
 * recorded that the question had failed.
 *
 * That is not hypothetical here. This product spent days on a sign-in nobody
 * could explain, and the explanation came from a person reading code — the
 * running system said nothing the whole time, because every surface that could
 * have said something was treating a failed question as a no. The proxy is the
 * worst of the seventy: it runs before any page, and its own `catch` could
 * never see this because nothing was thrown.
 *
 * What is held here: the signed-out case stays quiet, because it is the
 * ordinary case on every public page and a line per pageview buries the one
 * line worth reading; everything else is said, with what the reader got; and
 * the answer handed back is unchanged either way, so no page decides anything
 * differently because of this.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { whoIsSignedIn } from '../apps/web/lib/who-is-signed-in.ts';
import { forgetWhatWasSaid } from '../apps/web/lib/said-recently.ts';

/**
 * Enough of a user to tell one from nobody.
 *
 * Not the library's `User`: the root tsconfig compiles `tests/` from outside
 * every workspace package, so it cannot resolve `@supabase/supabase-js`, and
 * the helper is generic over this type precisely so that neither it nor this
 * file has to name it.
 */
interface SomeUser {
  readonly id: string;
  readonly email: string;
}

/** A client that answers getUser however this case needs. */
function answering(response: {
  user?: SomeUser | null;
  error?: { name?: string; message: string; status?: number } | null;
}) {
  const answer = response.user
    ? { data: { user: response.user }, error: null as null }
    : { data: { user: null as null }, error: response.error ?? ({ message: '' } as const) };
  return {
    auth: {
      async getUser() {
        return answer;
      },
    },
  };
}

let said: { message: string; detail: Record<string, unknown> }[];

beforeEach(() => {
  forgetWhatWasSaid();
  said = [];
  vi.spyOn(console, 'error').mockImplementation((message: unknown, detail?: unknown) => {
    said.push({ message: String(message), detail: (detail ?? {}) as Record<string, unknown> });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  forgetWhatWasSaid();
});

describe('nobody is signed in', () => {
  it('is not a failure, and is not said', async () => {
    // No user and no error at all, which is what a public page gets.
    expect(
      await whoIsSignedIn({
        auth: {
          async getUser() {
            return { data: { user: null as null }, error: null as null };
          },
        },
      }),
    ).toBeNull();
    expect(said).toEqual([]);
  });

  it('including the error the library gives for a missing session', async () => {
    // Every public page gets this one. Saying it would be a line per pageview
    // about nothing being wrong.
    const user = await whoIsSignedIn(
      answering({
        user: null,
        error: { name: 'AuthSessionMissingError', message: 'Auth session missing!', status: 400 },
      }),
    );
    expect(user).toBeNull();
    expect(said).toEqual([]);
  });
});

describe('a question we could not ask', () => {
  it('is said, with what the reader got instead', async () => {
    const user = await whoIsSignedIn(
      answering({
        user: null,
        error: { name: 'AuthRetryableFetchError', message: 'fetch failed', status: 503 },
      }),
    );
    // The answer is unchanged: this makes the failure audible, it does not
    // decide anything differently.
    expect(user).toBeNull();
    expect(said).toHaveLength(1);
    expect(said[0]!.message).toBe('could not ask the auth service who is signed in');
    expect(String(said[0]!.detail.shown)).toMatch(/signed-out view/);
    // The redirect is the part a customer experiences, so it is in the line.
    expect(String(said[0]!.detail.shown)).toMatch(/sign in/i);
    expect(said[0]!.detail.error).toBe('fetch failed');
    expect(said[0]!.detail.status).toBe(503);
  });

  it('is said once a minute, not once a request', async () => {
    // The proxy runs on every route that is not a static asset. A fault here is
    // the same fault on every request.
    for (let request = 0; request < 5; request += 1) {
      await whoIsSignedIn(answering({ error: { name: 'AuthApiError', message: 'server_error' } }));
    }
    expect(said).toHaveLength(1);
  });

  it('keeps a second fault audible while the first is still happening', async () => {
    await whoIsSignedIn(answering({ error: { name: 'AuthApiError', message: 'server_error' } }));
    await whoIsSignedIn(answering({ error: { name: 'AuthApiError', message: 'bad_jwt' } }));
    expect(said).toHaveLength(2);
  });
});

describe('somebody is signed in', () => {
  it('comes back as they always did', async () => {
    const user = await whoIsSignedIn(answering({ user: { id: 'u-1', email: 'a@b.test' } }));
    expect(user?.id).toBe('u-1');
    expect(said).toEqual([]);
  });
});
