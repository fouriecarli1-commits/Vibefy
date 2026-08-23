/**
 * Workspaces, seats and audit export.
 *
 * Three things are checked against the real database because getting any of them
 * wrong is a security incident rather than a bug: a seat limit that is only
 * enforced in a form, an invitation that works for the wrong person, and an
 * export that reaches across workspaces.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  canAccept,
  createInvitationToken,
  hashInvitationToken,
  runAuditExport,
  seatVerdict,
  toCsv,
  toCsvCell,
  tokenMatches,
} from '../packages/workspace/src/index.ts';
import { actingAs, connect, expectRefusal } from './setup/client.ts';
import {
  approveAssessment,
  makeReviewer,
  seedAccount,
  seedAssessment,
  seedFinding,
  type SeededAccount,
} from './setup/seed.ts';

let db: Client;
let owner: SeededAccount;
let colleague: SeededAccount;
let outsider: SeededAccount;
let reviewer: SeededAccount;
let workspaceId: string;

async function createWorkspace(name: string, seats: number): Promise<string> {
  const slug = `${name}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await db.query<{ id: string }>(
    `insert into public.organisations (name, slug, account_type, is_personal, created_by)
     values ($1, $2, 'agency', false, $3) returning id`,
    [name, slug, owner.userId],
  );
  const id = rows[0]!.id;
  await db.query(
    `insert into public.subscriptions (organisation_id, plan, status, seats, current_period_start, current_period_end)
     values ($1, 'agency', 'active', $2, now(), now() + interval '30 days')`,
    [id, seats],
  );
  await db.query(
    `insert into public.memberships (organisation_id, user_id, role) values ($1, $2, 'owner')`,
    [id, owner.userId],
  );
  return id;
}

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'workspace-owner');
  colleague = await seedAccount(db, 'workspace-colleague');
  outsider = await seedAccount(db, 'workspace-outsider');
  reviewer = await seedAccount(db, 'workspace-reviewer');
  await makeReviewer(db, reviewer.userId);
  workspaceId = await createWorkspace('acme-digital', 3);
});

afterAll(async () => {
  await db?.end();
});

describe('invitation tokens', () => {
  it('stores only a hash, and compares in constant time', () => {
    const { token, tokenSha256 } = createInvitationToken();
    expect(tokenSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenSha256).not.toContain(token);
    expect(tokenMatches(token, tokenSha256)).toBe(true);
    expect(tokenMatches(`${token}x`, tokenSha256)).toBe(false);
    expect(tokenMatches(token, 'not-hex')).toBe(false);
  });

  it('produces a different token every time', () => {
    const seen = new Set(Array.from({ length: 50 }, () => createInvitationToken().token));
    expect(seen.size).toBe(50);
  });

  it('expires within a week', () => {
    const now = new Date('2026-08-22T00:00:00Z');
    expect(createInvitationToken(now).expiresAt.toISOString()).toBe('2026-08-29T00:00:00.000Z');
  });

  it('refuses a forwarded link', () => {
    const invitation = {
      email: 'invited@example.test',
      acceptedAt: null,
      revokedAt: null,
      expiresAt: new Date('2030-01-01'),
    };
    expect(canAccept(invitation, 'invited@example.test').ok).toBe(true);
    const forwarded = canAccept(invitation, 'someone.else@example.test');
    expect(forwarded.ok).toBe(false);
    expect(forwarded.ok === false && forwarded.reason).toBe('wrong_account');
  });

  it('refuses a used, withdrawn, expired or unknown invitation', () => {
    const base = {
      email: 'a@example.test',
      acceptedAt: null,
      revokedAt: null,
      expiresAt: new Date('2030-01-01'),
    };
    expect(canAccept(null, 'a@example.test').ok).toBe(false);
    expect(canAccept({ ...base, acceptedAt: new Date() }, 'a@example.test').ok).toBe(false);
    expect(canAccept({ ...base, revokedAt: new Date() }, 'a@example.test').ok).toBe(false);
    expect(canAccept({ ...base, expiresAt: new Date('2020-01-01') }, 'a@example.test').ok).toBe(
      false,
    );
  });
});

describe('seats are enforced by the database', () => {
  it('counts an unaccepted invitation as a seat in use', () => {
    const verdict = seatVerdict({ seats: 3, members: 1, pendingInvitations: 1 });
    expect(verdict.used).toBe(2);
    expect(verdict.remaining).toBe(1);
    expect(verdict.explanation).toMatch(/1 invitation not yet accepted/);
  });

  it('refuses the invitation that would exceed the paid seat count', async () => {
    const small = await createWorkspace('two-seats', 2);
    const invite = async (email: string) =>
      db.query(
        `insert into public.invitations (organisation_id, email, role, token_sha256, expires_at)
         values ($1, $2, 'member', $3, now() + interval '7 days')`,
        [small, email, hashInvitationToken(`${email}-token`)],
      );

    // One member (the owner) plus one invitation fills two seats.
    await invite('first@example.test');
    await expect(invite('second@example.test')).rejects.toThrow(/seat/i);
  });

  it('refuses the membership that would exceed it, not only the invitation', async () => {
    // The form is not the enforcement point. A single-sign-on path that created
    // memberships directly would otherwise walk straight past the limit.
    const small = await createWorkspace('one-seat', 1);
    await expect(
      db.query(
        `insert into public.memberships (organisation_id, user_id, role) values ($1, $2, 'member')`,
        [small, colleague.userId],
      ),
    ).rejects.toThrow(/seat/i);
  });

  it('allows one live invitation per address, not two', async () => {
    const space = await createWorkspace('dupes', 5);
    const insert = () =>
      db.query(
        `insert into public.invitations (organisation_id, email, role, token_sha256, expires_at)
         values ($1, 'dupe@example.test', 'member', $2, now() + interval '7 days')`,
        [space, hashInvitationToken(`dupe-${Math.random()}`)],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/invitations_one_live_per_email/);
  });

  it('refuses an invitation that grants ownership', async () => {
    const space = await createWorkspace('no-owner-invites', 5);
    await expect(
      db.query(
        `insert into public.invitations (organisation_id, email, role, token_sha256, expires_at)
         values ($1, 'boss@example.test', 'owner', $2, now() + interval '7 days')`,
        [space, hashInvitationToken('boss')],
      ),
    ).rejects.toThrow(/invitations_never_grant_ownership/);
  });
});

describe('who may manage a workspace', () => {
  beforeAll(async () => {
    await db.query(
      `insert into public.memberships (organisation_id, user_id, role) values ($1, $2, 'member')`,
      [workspaceId, colleague.userId],
    );
  });

  it('lets an owner read the invitations and a plain member read none', async () => {
    await db.query(
      `insert into public.invitations (organisation_id, email, role, token_sha256, expires_at)
       values ($1, 'pending@example.test', 'member', $2, now() + interval '7 days')`,
      [workspaceId, hashInvitationToken('pending-one')],
    );

    const asOwner = await actingAs(db, { userId: owner.userId }, async (client) => {
      const { rows } = await client.query(
        'select id from public.invitations where organisation_id = $1',
        [workspaceId],
      );
      return rows.length;
    });
    expect(asOwner).toBeGreaterThan(0);

    const asMember = await actingAs(db, { userId: colleague.userId }, async (client) => {
      const { rows } = await client.query(
        'select id from public.invitations where organisation_id = $1',
        [workspaceId],
      );
      return rows.length;
    });
    // A member cannot see who else was invited — that is an administrative fact.
    expect(asMember).toBe(0);
  });

  it('refuses a member changing their own role', async () => {
    const message = await actingAs(db, { userId: colleague.userId }, (client) =>
      expectRefusal(
        client,
        `update public.memberships set role = 'owner' where organisation_id = $1 and user_id = $2`,
        [workspaceId, colleague.userId],
      ),
    );
    // Either an outright refusal or a silent no-op; both are safe, and the row
    // must be unchanged either way.
    expect(message === '' || /policy|permission/i.test(message)).toBe(true);
    const { rows } = await db.query<{ role: string }>(
      'select role from public.memberships where organisation_id = $1 and user_id = $2',
      [workspaceId, colleague.userId],
    );
    expect(rows[0]!.role).toBe('member');
  });

  it('refuses an outsider reading the workspace at all', async () => {
    const visible = await actingAs(db, { userId: outsider.userId }, async (client) => {
      const { rows } = await client.query('select id from public.organisations where id = $1', [
        workspaceId,
      ]);
      return rows.length;
    });
    expect(visible).toBe(0);
  });

  it('will not let a workspace be left without an owner', async () => {
    const solo = await createWorkspace('last-owner', 3);
    await expect(
      db.query('delete from public.memberships where organisation_id = $1', [solo]),
    ).rejects.toThrow(/owner/i);
  });
});

describe('audit export', () => {
  it('escapes CSV, and defuses a cell that would run as a formula', () => {
    expect(toCsvCell('plain')).toBe('plain');
    expect(toCsvCell('has,comma')).toBe('"has,comma"');
    expect(toCsvCell('say "hi"')).toBe('"say ""hi"""');
    // A spreadsheet that executes a cell from an exported file is a real attack,
    // not a theoretical one.
    expect(toCsvCell('=1+1')).toBe("'=1+1");
    expect(toCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(toCsvCell(null)).toBe('');
  });

  it('writes a header row from the first record', () => {
    expect(toCsv([{ a: 1, b: 'x' }])).toBe('a,b\r\n1,x\r\n');
    expect(toCsv([])).toBe('');
  });

  it('exports only the requesting workspace, under that caller’s identity', async () => {
    const seeded = await seedAssessment(db, owner);
    await seedFinding(db, owner, seeded.assessmentId, { severity: 'low' });
    await approveAssessment(db, owner, seeded.assessmentId, reviewer.userId, { score: 71 });

    const mine = await actingAs(db, { userId: owner.userId }, (client) =>
      runAuditExport(client, { organisationId: owner.organisationId, kind: 'assessments' }),
    );
    expect(mine.rowCount).toBeGreaterThan(0);
    expect(mine.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(mine.filename).toMatch(/^vibefycode-assessments-\d{4}-\d{2}-\d{2}\.csv$/);

    // The same query, asked by someone else about the same workspace, returns
    // nothing — the scoping is row-level security, not the organisation_id
    // parameter this function happens to be given.
    const theirs = await actingAs(db, { userId: outsider.userId }, (client) =>
      runAuditExport(client, { organisationId: owner.organisationId, kind: 'assessments' }),
    );
    expect(theirs.rowCount).toBe(0);
  });

  it('never puts an email address or a full IP in an export', async () => {
    await db.query(
      `insert into public.consents (user_id, organisation_id, document_type, document_version, document_sha256, action, ip)
       values ($1, $2, 'terms_of_service', '1.0.0', $3, 'accepted', '203.0.113.42')`,
      [owner.userId, owner.organisationId, 'f'.repeat(64)],
    );

    for (const kind of ['assessments', 'authorisations', 'consents', 'audit_log'] as const) {
      const result = await actingAs(db, { userId: owner.userId }, (client) =>
        runAuditExport(client, { organisationId: owner.organisationId, kind }),
      );
      expect(result.body, `${kind} must not carry an email address`).not.toMatch(
        /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
      );
      expect(result.body, `${kind} must not carry a full IP address`).not.toContain('203.0.113.42');
    }

    const consents = await actingAs(db, { userId: owner.userId }, (client) =>
      runAuditExport(client, { organisationId: owner.organisationId, kind: 'consents' }),
    );
    // Truncated to the network, which is enough to show two acceptances came
    // from different places without handing over a person's address.
    expect(consents.body).toContain('203.0.113.0');
  });

  it('records the export, and refuses to let the record be edited', async () => {
    const result = await actingAs(db, { userId: owner.userId }, (client) =>
      runAuditExport(client, { organisationId: owner.organisationId, kind: 'findings' }),
    );
    await db.query(
      `insert into public.audit_exports (organisation_id, requested_by, kind, format, row_count, sha256)
       values ($1, $2, 'findings', 'csv', $3, $4)`,
      [owner.organisationId, owner.userId, result.rowCount, result.sha256],
    );
    await expect(
      db.query(`update public.audit_exports set row_count = 0 where organisation_id = $1`, [
        owner.organisationId,
      ]),
    ).rejects.toThrow(/append-only/i);
  });

  it('refuses to record an export for a workspace the caller does not administer', async () => {
    const message = await actingAs(db, { userId: outsider.userId }, (client) =>
      expectRefusal(
        client,
        `insert into public.audit_exports (organisation_id, requested_by, kind, format, row_count, sha256)
         values ($1, $2, 'assessments', 'csv', 0, $3)`,
        [owner.organisationId, outsider.userId, '0'.repeat(64)],
      ),
    );
    expect(message).toMatch(/policy/i);
  });
});

describe('single sign-on routing', () => {
  it('reveals nothing until a connection is both verified and enforced', async () => {
    const space = await createWorkspace('sso-space', 5);
    await db.query(
      `insert into public.sso_connections (organisation_id, email_domain, provider, domain_challenge, created_by)
       values ($1, 'acme-sso.example', 'saml', 'vibefycode-site-verification=abc123', $2)`,
      [space, owner.userId],
    );

    const ask = async () => {
      const { rows } = await db.query<{ email_domain: string }>(
        `select * from public.sso_routing($1)`,
        ['person@acme-sso.example'],
      );
      return rows;
    };

    // Claimed but not verified: nothing.
    expect(await ask()).toEqual([]);

    await db.query(
      `update public.sso_connections set domain_verified_at = now() where organisation_id = $1`,
      [space],
    );
    // Verified but not enforced: still nothing. Enforcement is the customer's
    // decision, and until they make it a password is a legitimate way in.
    expect(await ask()).toEqual([]);

    await db.query(`update public.sso_connections set enforced = true where organisation_id = $1`, [
      space,
    ]);
    const routed = await ask();
    expect(routed).toHaveLength(1);
    expect(routed[0]!.email_domain).toBe('acme-sso.example');
  });

  it('refuses enforcement on a domain that has not been verified', async () => {
    const space = await createWorkspace('sso-unverified', 5);
    await db.query(
      `insert into public.sso_connections (organisation_id, email_domain, provider, domain_challenge, created_by)
       values ($1, 'unverified-sso.example', 'oidc', 'vibefycode-site-verification=zzz', $2)`,
      [space, owner.userId],
    );
    await expect(
      db.query(`update public.sso_connections set enforced = true where organisation_id = $1`, [
        space,
      ]),
    ).rejects.toThrow(/sso_enforced_needs_verified_domain/);
  });

  it('refuses two workspaces claiming one domain', async () => {
    const first = await createWorkspace('domain-race-a', 5);
    const second = await createWorkspace('domain-race-b', 5);
    const claim = (org: string) =>
      db.query(
        `insert into public.sso_connections (organisation_id, email_domain, provider, domain_challenge, created_by)
         values ($1, 'contested.example', 'saml', 'vibefycode-site-verification=q', $2)`,
        [org, owner.userId],
      );
    await claim(first);
    await expect(claim(second)).rejects.toThrow(/unique|duplicate/i);
  });

  it('never grants ownership through single sign-on', async () => {
    const space = await createWorkspace('sso-role', 5);
    await expect(
      db.query(
        `insert into public.sso_connections (organisation_id, email_domain, provider, domain_challenge, default_role, created_by)
         values ($1, 'roles-sso.example', 'saml', 'vibefycode-site-verification=r', 'owner', $2)`,
        [space, owner.userId],
      ),
    ).rejects.toThrow(/sso_default_role_is_not_owner/);
  });
});
