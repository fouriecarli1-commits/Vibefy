/**
 * The check constraints nothing was watching.
 *
 * Five mutation classes have measured the layers of this schema that *run*: a
 * policy is consulted, a trigger fires, a definer function is called. A check
 * constraint is the layer with no code in it. It makes a state impossible by
 * refusing the row, and a later migration can drop one in a line with nothing
 * anywhere saying so.
 *
 * Measured on 2026-10-07. A hundred and twenty-four constraints; dropping all
 * of them failed thirty-four tests, so the layer is substantially watched.
 * Narrowing to the ones that encode a rule rather than a shape — more than one
 * column, or a minimum length on a reason — left twenty-seven, of which
 * seventeen were watched by behaviour. Dropping the other fifteen together
 * failed nothing at all.
 *
 * These are the eight of those fifteen with consequences. The rest are
 * orderings and self-comparisons; they are in `DECISIONS.md` and left alone,
 * because a test written for completeness is ceremony and this file is not
 * that.
 *
 * Three of them have a sibling that *was* tested, which is the pattern this
 * week keeps producing: `badges_revoked_needs_reason` watched and
 * `badges_suspended_needs_reason` not, written in the same migration, three
 * lines apart.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { connect } from './setup/client.ts';
import { seedAccount, seedApp, seedBadgedApp, type SeededAccount } from './setup/seed.ts';

let db: Client;
let owner: SeededAccount;
let appId: string;

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'no-code-rules');
  appId = await seedApp(db, owner);
});

afterAll(async () => {
  await db.end();
});

const slug = () => `app-${randomUUID().slice(0, 8)}`;

const insertApp = (over: Record<string, unknown>) => {
  const row = {
    organisation_id: owner.organisationId,
    name: 'Fixture',
    slug: slug(),
    app_type: 'web_url',
    primary_url: 'https://fixture.example.test',
    created_by: owner.userId,
    ...over,
  };
  const keys = Object.keys(row);
  return db.query(
    `insert into public.apps (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
    keys.map((key) => row[key]),
  );
};

describe('an application this engine could not assess', () => {
  it('cannot be recorded over plain HTTP', async () => {
    // The brief draws this line and the submit form repeats it: "We do not
    // assess applications over plain HTTP." The form is the polite half.
    await expect(insertApp({ primary_url: 'http://fixture.example.test' })).rejects.toThrow(
      /apps_url_is_https/i,
    );
  });

  it('cannot be a web application with no address', async () => {
    // Nothing to fetch, so every stage would record "not reached" and the
    // assessment would arrive in the review queue having looked at nothing.
    await expect(insertApp({ primary_url: null })).rejects.toThrow(/reference_matches_type/i);
  });

  it('cannot be a repository with no repository', async () => {
    await expect(
      insertApp({ app_type: 'repository', primary_url: null, repository_url: null }),
    ).rejects.toThrow(/reference_matches_type/i);
  });
});

describe('a mark taken down without saying why', () => {
  it('cannot be suspended with no reason', async () => {
    /*
     * `badges_revoked_needs_reason` has been tested since August. This one was
     * written in the same migration, three lines further down, and never was.
     * The verification page prints the reason either way.
     *
     * The badge is seeded rather than borrowed from whatever is in the
     * database. A first version read `select id from public.badges limit 1`
     * and returned early when there was none, so it passed in one millisecond
     * against a schema with the constraint dropped — a test that tested
     * nothing, found by watching it fail and seeing that it did not.
     */
    const { appId: badgedApp } = await seedBadgedApp(db, 'no-code-suspend');
    const { rows } = await db.query<{ id: string }>(
      `select id from public.badges where app_id = $1`,
      [badgedApp],
    );
    expect(rows[0], 'the fixture should have issued a badge').toBeDefined();
    await expect(
      db.query(
        `update public.badges set status = 'suspended', suspended_at = now() where id = $1`,
        [rows[0]!.id],
      ),
    ).rejects.toThrow(/suspended_needs_reason/i);
  });
});

describe('an authorisation withdrawn without saying why', () => {
  it('cannot be recorded as revoked with no reason', async () => {
    /*
     * On insert, because `authorisations` is append-only — a trigger refuses
     * every update, so a revocation is a new row. Worth knowing: the
     * constraint's only reachable path is the insert, and writing this test
     * against an update is how that came out.
     *
     * The record of why we stopped being allowed to test somebody's
     * application is the first thing anybody would ask for afterwards.
     */
    await expect(
      db.query(
        `insert into public.authorisations
           (organisation_id, app_id, status, method, scope_domains, granted_by,
            warranty_text_version, warranty_text_sha256, revocation_reason)
         values ($1, $2, 'revoked', 'dns_txt', array['fixture.example.test'], $3, '1.0.0', $4, $5)`,
        [owner.organisationId, appId, owner.userId, 'a'.repeat(64), 'too short'],
      ),
    ).rejects.toThrow(/revoked_needs_reason/i);
  });
});

describe('an invitation in two states at once', () => {
  const invite = (over: Record<string, unknown>) => {
    const row = {
      organisation_id: owner.organisationId,
      email: `someone-${randomUUID().slice(0, 6)}@example.test`,
      role: 'member',
      token_sha256: randomUUID().replace(/-/g, '').repeat(2),
      invited_by: owner.userId,
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      ...over,
    };
    const keys = Object.keys(row);
    return db.query(
      `insert into public.invitations (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
      keys.map((key) => row[key]),
    );
  };

  it('cannot be accepted and withdrawn together', async () => {
    // Which one wins decides whether somebody has access, and nothing in the
    // code picks.
    await expect(
      invite({
        accepted_at: new Date().toISOString(),
        accepted_by: owner.userId,
        revoked_at: new Date().toISOString(),
        revoked_by: owner.userId,
      }),
    ).rejects.toThrow(/invitations_not_both/i);
  });

  it('cannot be accepted by nobody', async () => {
    await expect(invite({ accepted_at: new Date().toISOString() })).rejects.toThrow(
      /accepted_has_user/i,
    );
  });

  it('cannot be a link that works for a year', async () => {
    // An invitation is a credential. Thirty days is the bound.
    await expect(
      invite({ expires_at: new Date(Date.now() + 400 * 86_400_000).toISOString() }),
    ).rejects.toThrow(/expire_within_reason/i);
  });
});

describe('what an owner puts on their own trust page', () => {
  const page = (over: Record<string, unknown>) =>
    db.query(
      `insert into public.trust_pages (app_id, organisation_id, privacy_url, terms_url, status_url)
       values ($1, $2, $3, $4, $5)
       on conflict (app_id) do update set privacy_url = excluded.privacy_url,
         terms_url = excluded.terms_url, status_url = excluded.status_url`,
      [
        appId,
        owner.organisationId,
        over.privacy_url ?? null,
        over.terms_url ?? null,
        over.status_url ?? null,
      ],
    );

  it.each(['privacy_url', 'terms_url', 'status_url'])(
    'will not publish a plain-HTTP %s',
    async (column) => {
      // We render these from our own page, under our own mark. An http link
      // there is one we are vouching for.
      await expect(page({ [column]: 'http://example.test/policy' })).rejects.toThrow(
        new RegExp(column),
      );
    },
  );
});

describe('an agency logo', () => {
  it('cannot be a data URI that is not an image', async () => {
    // `data:text/html` in an img src is inert in a browser, and this column is
    // rendered on a white-labelled report. The constraint is what keeps the
    // question from ever arising.
    await expect(
      db.query(
        `insert into public.workspace_branding (organisation_id, display_name, logo_data_uri)
         values ($1, $2, $3)
         on conflict (organisation_id) do update set logo_data_uri = excluded.logo_data_uri`,
        [owner.organisationId, 'Fixture Agency', 'data:text/html;base64,PHNjcmlwdD4='],
      ),
    ).rejects.toThrow(/logo_data_uri/i);
  });
});
