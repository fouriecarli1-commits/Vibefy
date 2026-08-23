/**
 * A person's own data, assembled by a mechanism rather than by hand.
 *
 * `REQUEST_KINDS` publishes a precise promise for an access request: the account
 * record, workspace memberships, every consent with the version and hash of what
 * was agreed to, and the applications submitted. Until this existed, keeping
 * that promise meant a reviewer running queries — a published commitment with
 * nothing behind it, which is the exact failure this product looks for in other
 * people's software.
 *
 * What is tested is mostly the boundary: whose data comes back, whose does not,
 * and whether an export that cannot be complete refuses rather than looking it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  NOT_INCLUDED,
  NotPermittedToExportError,
  REQUEST_KINDS,
  assembleSubjectExport,
  subjectExportFilename,
} from '../packages/governance/src/index.ts';
import { actingAs, connect } from './setup/client.ts';
import {
  makeReviewer,
  seedAccount,
  seedApp,
  seedAssessment,
  seedFinding,
  sha256,
  type SeededAccount,
} from './setup/seed.ts';

let db: Client;
let subject: SeededAccount;
let stranger: SeededAccount;
let admin: SeededAccount;
let reviewer: SeededAccount;

beforeAll(async () => {
  db = await connect();
  subject = await seedAccount(db, 'export-subject');
  stranger = await seedAccount(db, 'export-stranger');
  admin = await seedAccount(db, 'export-admin');
  reviewer = await seedAccount(db, 'export-reviewer');
  await db.query(`update public.users set platform_role = 'admin' where id = $1`, [admin.userId]);
  await makeReviewer(db, reviewer.userId);

  await db.query(
    `insert into public.consents
       (user_id, organisation_id, document_type, document_version, document_sha256, action, ip, user_agent)
     values ($1, $2, 'authorisation_to_test', '1.0.0', $3, 'accepted', '203.0.113.9', 'Test agent')`,
    [subject.userId, subject.organisationId, sha256('authorisation-warranty-1.0.0')],
  );
  await seedApp(db, subject, 'Kettle');

  // A stranger's records, so "everything about this person" can be checked to
  // mean this person.
  await db.query(
    `insert into public.consents
       (user_id, organisation_id, document_type, document_version, document_sha256, action)
     values ($1, $2, 'badge_licence', '1.0.0', $3, 'accepted')`,
    [stranger.userId, stranger.organisationId, sha256('badge-licence-1.0.0')],
  );
  await seedApp(db, stranger, 'Somebody else’s app');
});

afterAll(async () => {
  await db?.end();
});

async function exportFor(subjectId: string, actorId: string) {
  return actingAs(db, { userId: actorId }, (client) =>
    assembleSubjectExport(client as unknown as Client, subjectId),
  );
}

describe('what it contains', () => {
  it('keeps every promise the published copy makes', async () => {
    const result = await exportFor(subject.userId, admin.userId);
    expect(result.account?.id).toBe(subject.userId);
    expect(result.memberships).toHaveLength(1);
    expect(result.consents).toHaveLength(1);
    expect(result.applications).toHaveLength(1);

    // The promise, in the words it is published in.
    const access = REQUEST_KINDS.find((kind) => kind.type === 'access')!;
    expect(access.promise).toContain('consent');
    expect(access.promise).toContain('applications you submitted');
  });

  it('carries the hash of what was agreed to, not just that it was', async () => {
    // The hash is the whole point: it is how a person proves what they agreed
    // to rather than taking our word for it.
    const result = await exportFor(subject.userId, admin.userId);
    const consent = result.consents[0]!;
    expect(consent.document_version).toBe('1.0.0');
    expect(String(consent.document_sha256)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('contains nobody else’s records', async () => {
    const result = await exportFor(subject.userId, admin.userId);
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(stranger.userId);
    expect(serialised).not.toContain('Somebody else');
  });

  it('names what was left out, and why', async () => {
    const result = await exportFor(subject.userId, admin.userId);
    expect(result.notIncluded).toEqual(NOT_INCLUDED);
    expect(result.notIncluded.length).toBeGreaterThan(3);
    // Every omission carries a reason. "Not included" with no ground is the
    // behaviour the right exists to prevent.
    expect(result.notIncluded.every((entry) => entry.reason.length > 40)).toBe(true);
  });

  it('does not hand over the workspace’s assessment records', async () => {
    // They belong to the organisation that commissioned them. Handing them to
    // one member under a personal request would be a disclosure, not a right.
    const seeded = await seedAssessment(db, subject);
    await seedFinding(db, subject, seeded.assessmentId, {
      title: 'A finding nobody asked us to export',
    });

    const result = await exportFor(subject.userId, admin.userId);
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(seeded.assessmentId);
    expect(serialised).not.toContain('A finding nobody asked us to export');
    expect(result.notIncluded.some((entry) => /Assessment results/i.test(entry.category))).toBe(
      true,
    );
  });

  it('says nothing about passwords, cards or analytics, because it holds none', async () => {
    const result = await exportFor(subject.userId, admin.userId);
    const categories = result.notIncluded.map((entry) => entry.category.toLowerCase()).join(' ');
    expect(categories).toContain('password');
    expect(categories).toContain('card');
    expect(categories).toContain('analytics');
  });

  it('names its file by the date it was assembled', async () => {
    const result = await exportFor(subject.userId, admin.userId);
    expect(subjectExportFilename(result)).toMatch(
      /^vibefycode-data-export-\d{4}-\d{2}-\d{2}\.json$/,
    );
  });
});

describe('who may assemble one', () => {
  it('refuses a reviewer rather than handing them a partial export', async () => {
    // A reviewer can read the account but not the consents. What they would
    // produce is an export with an empty consents array and nothing saying so.
    await expect(exportFor(subject.userId, reviewer.userId)).rejects.toThrow(
      NotPermittedToExportError,
    );
  });

  it('refuses the person’s own colleague, and the person themselves', async () => {
    // Not a punishment: the route is how a request is *answered*, and an
    // endpoint that assembles anyone's data for anyone who names them is a
    // breach with a route handler in front of it.
    await expect(exportFor(subject.userId, stranger.userId)).rejects.toThrow(
      NotPermittedToExportError,
    );
    await expect(exportFor(subject.userId, subject.userId)).rejects.toThrow(
      NotPermittedToExportError,
    );
  });

  it('asks the database, not the caller', async () => {
    const source = readFileSync(
      join(process.cwd(), 'packages/governance/src/subject-export.ts'),
      'utf8',
    );
    // A guard the call site has to remember is a guard that will be forgotten.
    expect(source).toContain('public.is_platform_admin()');
    expect(source.indexOf('is_platform_admin')).toBeLessThan(source.indexOf('from public.users'));
  });
});

describe('the endpoint', () => {
  const route = readFileSync(
    join(process.cwd(), 'apps/web/app/review/requests/[id]/export/route.ts'),
    'utf8',
  );

  it('assembles only against a request that asked for one', () => {
    // A user id in the URL would be a breach with a route handler in front of
    // it. The subject comes from the stored request, and only from there.
    expect(route).toContain("'access', 'portability'");
    expect(route).toContain('dataRequest.user_id');
    expect(route).not.toMatch(/params.*userId/);
  });

  it('records the disclosure in the same transaction as the disclosure', () => {
    // A file handed over with no record of it having been handed over is what
    // an audit trail exists to prevent.
    expect(route).toContain('writeAsUser');
    expect(route).toContain("'data_request.exported'");
    expect(route.indexOf('assembleSubjectExport')).toBeLessThan(route.indexOf('audit_log'));
  });

  it('is never cached and carries the hash of what was sent', () => {
    expect(route).toContain("'cache-control': 'no-store, private'");
    expect(route).toContain('x-vibefycode-export-sha256');
  });

  it('is offered in the queue only for the two rights it answers', () => {
    const page = readFileSync(join(process.cwd(), 'apps/web/app/review/requests/page.tsx'), 'utf8');
    expect(page).toContain("['access', 'portability'].includes");
    expect(page).toContain('/export');
  });
});
