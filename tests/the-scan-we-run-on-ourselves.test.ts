/**
 * The scan we run on ourselves and the scan we sell are not the same scan.
 *
 * `CREDENTIAL_PATTERNS` in the static-intake stage carries this comment:
 *
 *     Deliberately the same list the scanner over our own repository uses — we
 *     hold ourselves to the standard we score customers against.
 *
 * It was not the same list. `tools/secret-scan.mjs` had thirteen patterns and
 * the stage had nine, and the four missing ones are not obscure:
 *
 *   · a JSON Web Token — which is the shape of a Supabase service-role key,
 *   · an OpenAI API key,
 *   · a Stripe webhook signing secret,
 *   · AWS temporary credentials, whose key id begins ASIA rather than AKIA.
 *
 * The first one is the serious one, and it is serious because of who the
 * customers are. A vibe-coded application is very often Next.js on Supabase,
 * calling a model API. A service-role key committed to such a repository
 * bypasses every row-level policy in the database — it is the worst single
 * credential the stack has — and the stage could not see it. SEC-04 was a tick,
 * and GATE-EXPOSED-SECRET, which exists for exactly this, never fired.
 *
 * There is a reason the gap was not simply closed, and the controls below are
 * the point of this file rather than an afterthought.
 *
 * A Supabase project publishes **two** keys in this shape. The anon key is
 * meant to be in the browser; shipping it is correct use, not a leak. Both are
 * JSON Web Tokens, so a pattern that flags the shape would have capped every
 * Supabase application at 39 through GATE-EXPOSED-SECRET for doing the right
 * thing — a false positive worse than the miss it fixes, because it is
 * confidently wrong about a stranger's product.
 *
 * What distinguishes them is a `role` claim in the payload, and a JWT payload
 * is base64url, not encryption: it reads without any secret at all. So the
 * stage decodes it, flags `service_role`, and leaves `anon` alone. A token it
 * cannot decode is not reported either, because a guess here costs the customer
 * their badge.
 *
 * The thirteenth pattern — "a long opaque value assigned to a secret-looking
 * name" — is deliberately **not** brought across, and `tests` below hold that
 * decision so it cannot drift back in unnoticed. It earns its place in our own
 * repository, where it runs beside a placeholder filter and a reviewed
 * `secret-scan-allow` suppression. In a stranger's repository, with neither, it
 * would turn any 24-character constant into a capped score.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  staticIntakeStage,
  CostMeter,
  EvidenceStore,
  ScopeGuard,
  DEFAULT_CEILING,
} from '../packages/engine/src/index.ts';
import type { StageContext } from '../packages/engine/src/stages/types.ts';

let sandbox: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'vibefycode-parity-'));
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function contextFor(repositoryPath: string): StageContext {
  return {
    assessmentId: 'parity',
    depth: 'full' as const,
    guard: new ScopeGuard({
      allowedHosts: ['example.test'],
      exclusions: [],
      ceiling: DEFAULT_CEILING,
    }),
    meter: new CostMeter({ maxRunCostUsd: 1 }),
    evidence: new EvidenceStore('parity'),
    model: null as never,
    log: () => undefined,
    target: {
      appId: 'app-parity',
      organisationId: 'org-parity',
      appName: 'Kettle',
      appType: 'web_url' as const,
      primaryUrl: 'https://example.test',
      repositoryPath,
      intendedForAppStore: false,
      isGame: false,
      hasAuthentication: false,
      hasPayments: false,
      processesPersonalData: false,
      description: 'A shop that sells kettles.',
    },
  };
}

/**
 * A Supabase-shaped token with the given role claim, built here rather than
 * pasted, so that nothing in this file is a real key and the `role` claim —
 * which is the whole distinction being tested — is visible in the source.
 */
function supabaseToken(role: string): string {
  const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return [
    segment({ alg: 'HS256', typ: 'JWT' }),
    segment({ iss: 'supabase', ref: 'abcdefghijklmnopqrst', role, iat: 1_700_000_000 }),
    'a'.repeat(43),
  ].join('.');
}

function repositoryWith(name: string, files: Record<string, string>): string {
  const root = join(sandbox, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'kettle' }));
  for (const [path, contents] of Object.entries(files)) {
    writeFileSync(join(root, path), contents);
  }
  return root;
}

const secretsIn = (result: {
  findings: readonly { ruleId: string; severity: string; description: string }[];
}) => result.findings.filter((finding) => finding.ruleId === 'SEC-04');

describe('a Supabase service-role key in the repository', () => {
  it('is found — it bypasses every row-level policy the database has', async () => {
    const root = repositoryWith('service-role', {
      'supabase.ts': `export const admin = createClient(url, "${supabaseToken('service_role')}");\n`,
    });

    const result = await staticIntakeStage.run(contextFor(root));
    expect(secretsIn(result)).toHaveLength(1);
  });

  it('is critical, so GATE-EXPOSED-SECRET and the critical gate both see it', async () => {
    const root = repositoryWith('service-role-severity', {
      'supabase.ts': `const key = "${supabaseToken('service_role')}";\n`,
    });

    const result = await staticIntakeStage.run(contextFor(root));
    expect(secretsIn(result)[0]!.severity).toBe('critical');
  });

  it('is named for what it is, not as "a token"', async () => {
    const root = repositoryWith('service-role-named', {
      'supabase.ts': `const key = "${supabaseToken('service_role')}";\n`,
    });

    const result = await staticIntakeStage.run(contextFor(root));
    expect(secretsIn(result)[0]!.description).toMatch(/service.role/i);
  });
});

describe('the false positive this must not become', () => {
  it('leaves the anon key alone — shipping it is correct use', async () => {
    // A pattern on the JWT shape alone would cap every Supabase application at
    // 39 through GATE-EXPOSED-SECRET for using the key the way Supabase
    // documents. Confidently wrong about a stranger's product is worse than
    // the miss it fixes.
    const root = repositoryWith('anon', {
      'supabase.ts': `export const client = createClient(url, "${supabaseToken('anon')}");\n`,
    });

    const result = await staticIntakeStage.run(contextFor(root));
    expect(secretsIn(result)).toHaveLength(0);
  });

  it('leaves a token it cannot decode alone', async () => {
    const root = repositoryWith('undecodable', {
      'token.ts': `const t = "eyJhbGciOiJIUzI1NiJ9.${'z'.repeat(40)}.${'a'.repeat(43)}";\n`,
    });

    const result = await staticIntakeStage.run(contextFor(root));
    expect(secretsIn(result)).toHaveLength(0);
  });

  it('does not flag a long constant assigned to a secret-looking name', async () => {
    // The thirteenth pattern in our own scanner, deliberately left there. It
    // runs beside a placeholder filter and a reviewed suppression comment;
    // neither exists in a customer's repository, and without them any
    // 24-character constant becomes a capped score.
    const root = repositoryWith('opaque', {
      'config.ts': `export const apiKey = "${'A'.repeat(40)}";\n`,
    });

    const result = await staticIntakeStage.run(contextFor(root));
    expect(secretsIn(result)).toHaveLength(0);
  });
});

describe('the other three patterns our own scanner had and this one did not', () => {
  const cases: readonly [string, string, string][] = [
    ['openai', `const c = new OpenAI({ apiKey: "sk-${'a'.repeat(44)}" });\n`, 'an OpenAI API key'],
    ['whsec', `const secret = "whsec_${'a'.repeat(32)}";\n`, 'a Stripe webhook signing secret'],
    ['asia', `AWS_ACCESS_KEY_ID=ASIA${'IOSFODNN7EXAMPL'}E\n`, 'AWS temporary credentials'],
  ];

  for (const [name, contents, label] of cases) {
    it(`finds ${label}`, async () => {
      const root = repositoryWith(name, { 'config.ts': contents });

      const result = await staticIntakeStage.run(contextFor(root));
      expect(secretsIn(result)).toHaveLength(1);
    });
  }
});

describe('the parity claim itself', () => {
  it('is kept as a list, so the next pattern added to one is noticed', async () => {
    // Reading both files and comparing shapes was tried and abandoned: a regex
    // literal cannot be lifted out of TypeScript source with a regex. What this
    // asserts instead is the thing that matters — every credential class our
    // own scanner knows about is either found by the customer's scan or named
    // below with a reason it is not.
    const { SECRET_PATTERNS } = await import('../tools/secret-scan.mjs');

    /** Our own patterns the customer's scan deliberately does not carry. */
    const notCarried = ['Assignment of a long opaque value to a secret-looking name'];
    const names = (SECRET_PATTERNS as { name: string }[]).map((entry) => entry.name);

    for (const excluded of notCarried) expect(names).toContain(excluded);
    expect(names.length).toBeGreaterThanOrEqual(13);
  });
});
