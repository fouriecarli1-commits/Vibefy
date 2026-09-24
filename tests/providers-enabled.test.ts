/**
 * Whether the sign-in page offers a provider, and how somebody finds out why not.
 *
 * The Google button was hidden behind `NEXT_PUBLIC_GOOGLE_SIGN_IN=on`. The
 * reasoning was right — a button that is always there and always fails teaches
 * people the product is broken — and the result was the failure this codebase
 * spends its time removing: the page rendered nothing, and nothing distinguishes
 * "not configured yet" from "never built". Anré asked twice where it was.
 *
 * So the question goes to Supabase, which publishes a boolean per provider at
 * `/auth/v1/settings`. The button appears the moment the provider is enabled in
 * the dashboard, there is no second switch to remember, and the operator has a
 * command that answers "why is it not there" with a reason instead of a blank
 * space.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enabledProviders } from '../apps/web/lib/providers-enabled.ts';
import { SOCIAL_PROVIDERS, providerLabel } from '../packages/shared/src/index.ts';

const realFetch = globalThis.fetch;
const env = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

const answering = (body: unknown, ok = true, status = 200) => {
  globalThis.fetch = (async () =>
    ({ ok, status, json: async () => body }) as unknown as Response) as typeof fetch;
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://probe.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (env.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = env.url;
  if (env.key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.key;
});

describe('asking Supabase what is enabled', () => {
  it('offers exactly the ones the project says are on', async () => {
    answering({ external: { google: true, github: true, facebook: false } });
    const providers = await enabledProviders();
    expect(providers.enabled).toEqual(['google', 'github']);
    expect(providers.unavailable).toBeNull();
  });

  it.each(SOCIAL_PROVIDERS.map((provider) => provider.id))('can offer %s', async (id) => {
    // Every one of the nine, because a provider in the catalogue that the
    // discovery cannot report is a button that never appears however it is
    // configured — and nothing else would say so.
    answering({ external: { [id]: true } });
    expect((await enabledProviders()).enabled).toEqual([id]);
  });

  it('offers none when the project mentions none', async () => {
    // A field that is absent is not a field that is true. GoTrue has changed the
    // shape of this response before.
    answering({ external: {} });
    expect((await enabledProviders()).enabled).toEqual([]);
  });

  it('treats a truthy non-boolean as off, not as on', async () => {
    // `=== true`, because a provider list that ever answers "yes" as a string
    // would otherwise render a button that cannot work.
    answering({ external: { google: 'true', github: 1, apple: 'on' } });
    expect((await enabledProviders()).enabled).toEqual([]);
  });

  it('keeps the catalogue order, so the page does not reshuffle', async () => {
    // Answered in a different order than we list them, on purpose.
    answering({ external: { twitch: true, google: true, apple: true } });
    expect((await enabledProviders()).enabled).toEqual(['google', 'apple', 'twitch']);
  });

  it('ignores a provider Supabase has that we do not offer', async () => {
    // GoTrue supports about twenty. Rendering a button for one nobody chose to
    // support is a button with no label and no decision behind it.
    answering({ external: { google: true, kakao: true, workos: true } });
    expect((await enabledProviders()).enabled).toEqual(['google']);
  });
});

describe('when the question cannot be asked', () => {
  it('says so rather than guessing, on a refused request', async () => {
    answering({}, false, 503);
    const providers = await enabledProviders();
    expect(providers.enabled).toEqual([]);
    expect(providers.unavailable).toMatch(/503/);
  });

  it('says so when Supabase cannot be reached at all', async () => {
    globalThis.fetch = (async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as typeof fetch;
    const providers = await enabledProviders();
    expect(providers.enabled).toEqual([]);
    expect(providers.unavailable).toMatch(/ENOTFOUND/);
  });

  it('says so when there is no project configured', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const providers = await enabledProviders();
    expect(providers.enabled).toEqual([]);
    expect(providers.unavailable).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});

describe('what the operator can do about it', () => {
  it('no longer hides the button behind an environment variable', () => {
    // Two things that can be wrong instead of one, and the one that was wrong
    // produced a blank space rather than a reason.
    const gate = readFileSync(
      join(process.cwd(), 'apps/web/components/provider-sign-in.tsx'),
      'utf8',
    );
    expect(gate).toContain('enabledProviders()');
    expect(gate).not.toContain('NEXT_PUBLIC_GOOGLE_SIGN_IN');
  });

  it('has a command that answers why the button is absent', () => {
    const tool = readFileSync(join(process.cwd(), 'tools/providers.mjs'), 'utf8');
    // The redirect URI is the step people get wrong, and it is Supabase's own
    // address rather than ours — so the command prints it filled in.
    expect(tool).toContain('/auth/v1/callback');
    expect(tool).toMatch(/Redirect URLs/);
    expect(tool).toMatch(/auth\/callback/);
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.providers).toBe('node tools/providers.mjs');
  });

  it('reads nothing and writes nothing', () => {
    const tool = readFileSync(join(process.cwd(), 'tools/providers.mjs'), 'utf8');
    expect(tool).not.toMatch(/writeFileSync|execFileSync|SERVICE_ROLE/);
  });
});

describe('the nine, and the two ids nobody guesses', () => {
  it('uses GoTrue’s own id for X and LinkedIn', () => {
    /*
     * X is still `twitter` in GoTrue, and LinkedIn is `linkedin_oidc` — the older
     * `linkedin` id is deprecated and enabling it gets you a provider that
     * answers and then fails at the token exchange, which is the worst kind of
     * wrong: it looks configured.
     */
    const ids = SOCIAL_PROVIDERS.map((provider) => provider.id);
    expect(ids).toContain('twitter');
    expect(ids).toContain('linkedin_oidc');
    expect(ids).not.toContain('linkedin');
    expect(ids).not.toContain('x');
    expect(providerLabel('twitter')).toBe('X');
    expect(providerLabel('linkedin_oidc')).toBe('LinkedIn');
  });

  it('names every one it offers', () => {
    // A provider with no label renders a button saying "undefined", and an id is
    // not a name anybody recognises.
    for (const provider of SOCIAL_PROVIDERS) {
      expect(providerLabel(provider.id)).toBe(provider.label);
      expect(provider.label.length).toBeGreaterThan(0);
    }
  });

  it('refuses an id it has no name for', () => {
    expect(() => providerLabel('kakao' as never)).toThrow(/No label is defined/);
  });

  it('draws no brand mark, because eight from memory are eight wrong ones', () => {
    /*
     * Several of these companies publish licence terms about their marks, and
     * Apple's are specific enough that a freehand "Sign in with Apple" button is
     * a breach rather than an approximation. A product whose argument is that it
     * does not redraw somebody else's mark cannot open with redrawn marks on its
     * front door.
     */
    const button = readFileSync(
      join(process.cwd(), 'apps/web/components/provider-button.tsx'),
      'utf8',
    );
    expect(button).not.toMatch(/<svg|<path/);
    expect(button).toContain('providerLabel(provider)');
  });

  it('is one component rather than nine', () => {
    // Nine copies is eight chances for one of them to forget the consent
    // parameter that makes a provider sign-up recordable.
    const gate = readFileSync(
      join(process.cwd(), 'apps/web/components/provider-sign-in.tsx'),
      'utf8',
    );
    expect(gate).toContain('providers.enabled.map(');
    expect(gate).toContain('accepted={accepted}');
  });
});

describe('the command and the page agree about which nine', () => {
  it('lists the same providers in the same order', () => {
    /*
     * `tools/providers.mjs` repeats the list because it is a plain script that
     * runs without a build step. Repeated is fine; drifting is not — a provider
     * the page offers and the command never mentions is one nobody can find out
     * how to enable.
     */
    const tool = readFileSync(join(process.cwd(), 'tools/providers.mjs'), 'utf8');
    const listed = [...tool.matchAll(/^\s*\['([a-z_]+)', '([^']+)'\],$/gm)].map((match) => ({
      id: match[1],
      label: match[2],
    }));
    expect(listed).toEqual(SOCIAL_PROVIDERS.map((provider) => ({ ...provider })));
  });

  it('warns about the three that need more than an OAuth app', () => {
    // Worth knowing before starting rather than halfway through.
    const tool = readFileSync(join(process.cwd(), 'tools/providers.mjs'), 'utf8');
    expect(tool).toMatch(/Apple needs a paid Apple Developer account/);
    expect(tool).toMatch(/Facebook needs app review/);
    expect(tool).toMatch(/OAuth 2\.0/);
  });
});
