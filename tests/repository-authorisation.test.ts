/**
 * What the runner is allowed to clone, and who said so.
 *
 * `apps.repository_url` has existed since the first migration and nothing read
 * it, so wiring it up raised the question the rest of this schema already
 * answers for a domain: what did the customer actually authorise us to look at?
 *
 * A domain is proved by a DNS record or a file at a well-known path. A public
 * repository cannot be proved that way, and a customer could otherwise type
 * somebody else's repository into their own application and receive a report
 * about code they do not own. So the repository is copied onto the
 * authorisation at the moment the warranty is accepted, and the runner clones
 * only what that record names.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Client } from 'pg';
import { connect } from './setup/client.ts';
import { seedAccount, seedApp, seedAuthorisation, type SeededAccount } from './setup/seed.ts';

let db: Client;
let owner: SeededAccount;

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'repo-authorisation');
});

afterAll(async () => {
  await db?.end();
});

describe('the column the runner reads', () => {
  it('is on the authorisation, not only on the app', async () => {
    // An authorisation we can widen afterwards is worth nothing as evidence
    // that our testing was lawful — decision 014, applied to source.
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'authorisations'
          and column_name = 'repository_url'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('cannot be added to an authorisation afterwards', async () => {
    // The table is append-only, which is decision 014 and is exactly the point:
    // widening what we may read has to be a new record, not an edit.
    const appId = await seedApp(db, owner, 'Late Repo App');
    await seedAuthorisation(db, owner, appId);
    await expect(
      db.query('update public.authorisations set repository_url = $2 where app_id = $1', [
        appId,
        'https://github.com/owner/repo',
      ]),
    ).rejects.toThrow(/append-only/i);
  });

  it('comes back from current_authorisation, which is what the worker asks', async () => {
    const appId = await seedApp(db, owner, 'Repo App', {
      repositoryUrl: 'https://github.com/owner/repo',
    });
    await seedAuthorisation(db, owner, appId, {
      repositoryUrl: 'https://github.com/owner/repo',
    });
    const { rows } = await db.query<{ repository_url: string | null }>(
      'select repository_url from public.current_authorisation($1)',
      [appId],
    );
    expect(rows[0]?.repository_url).toBe('https://github.com/owner/repo');
  });
});

describe('what the code does with it', () => {
  const worker = readFileSync('apps/worker/src/run-assessment.ts', 'utf8');
  const actions = readFileSync('apps/web/app/console/apps/actions.ts', 'utf8');

  it('clones what the authorisation names, not what the app names', () => {
    expect(worker).toMatch(/record\.repository_url/);
    expect(worker).toMatch(/await fetch\(authorisedRepository/);
  });

  it('says so when an app names one the authorisation does not cover', () => {
    // From the report it would otherwise look exactly like an application with
    // no source at all, which is a different thing and not the customer's.
    expect(worker).toMatch(/does not cover it/);
    expect(worker).toMatch(/needs a fresh authorisation/);
  });

  it('copies the declared repository at the moment the warranty is accepted', () => {
    expect(actions).toMatch(/repository_url: \(app\.repository_url as string \| null\) \?\? null/);
  });

  it('refuses in the console exactly what the runner would refuse', () => {
    // Accepting it here and failing in the runner an hour later would tell the
    // customer their source was assessed when it was not.
    expect(actions).toMatch(/repositoryUrlOrRefuse\(repositoryUrl\)/);
    expect(actions).toMatch(/RepositoryRefusedError/);
  });

  it('carries the repository from the pending row onto the verified one', () => {
    // Verification inserts a superseding row and that row is what the runner
    // reads. Leaving this behind authorised the domain and quietly dropped the
    // repository, so the report would have said the authorisation did not
    // cover a repository the customer had declared and accepted the warranty
    // for — found by reading the flow rather than by a test failing.
    const verified = actions.slice(actions.indexOf('export async function verifyAuthorisation'));
    expect(verified).toMatch(/repository_url: pending\.repository_url/);
  });

  it('leaves it off a withdrawal, which covers nothing', () => {
    const revoked = actions.slice(actions.indexOf('export async function revokeAuthorisation'));
    const insert = revoked.slice(revoked.indexOf('.insert({'), revoked.indexOf('});'));
    expect(insert).toMatch(/scope_domains: \[\]/);
    expect(insert).not.toMatch(/repository_url/);
  });

  it('offers the field at all, which is the whole point', () => {
    const form = readFileSync('apps/web/app/console/apps/new/page.tsx', 'utf8');
    expect(form).toMatch(/name="repositoryUrl"/);
    expect(form).toMatch(/never paste an address containing a token/i);
  });
});
