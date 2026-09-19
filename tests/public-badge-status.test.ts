/**
 * The answer a stranger's software gets when it asks about a badge.
 *
 * A marketplace that wants to show our mark beside a listing, a directory of AI
 * tools, a platform that wants an assessment before it publishes — none of them
 * will build against something they have to negotiate access to first. This is
 * how the mark reaches places we would never sell to, and the whole value of it
 * is that the answer is correct and cannot be misread.
 *
 * Two failures would be ours rather than the caller's, and both are held here.
 *
 * The first is a badge that is not live reading as live. Suspension is the
 * entire mechanism by which a mark stops meaning something, and an endpoint
 * that reports a revoked badge as active has quietly removed it.
 *
 * The second is a correct answer that invites a wrong conclusion. `isLive: true`
 * beside somebody's listing becomes the word "safe" on their page unless the
 * sentence saying what it actually means is in the payload the developer is
 * already reading.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BADGE_LIMITS,
  BADGE_MEANING,
  badgeStatus,
  liveBadgeList,
  type BadgeRow,
} from '../packages/badge/src/index.ts';

const row = (overrides: Partial<BadgeRow> = {}): BadgeRow => ({
  public_id: 'bdg_01',
  slug: 'kettle',
  status: 'active',
  app_name: 'Kettle',
  certified_origin: 'https://kettle.example',
  rubric_version: '1.1.0',
  assessed_at: '2026-08-22T09:00:00.000Z',
  expires_at: '2027-08-22T09:00:00.000Z',
  ...overrides,
});

describe('one badge, asked for by its identifier', () => {
  it('answers the four things somebody actually needs', () => {
    const status = badgeStatus(row(), 'https://verify.vibefycode.test');
    expect(status.isLive).toBe(true);
    expect(status.rubricVersion).toBe('1.1.0');
    expect(status.assessedOn).toBe('2026-08-22');
    expect(status.expiresOn).toBe('2027-08-22');
    expect(status.verificationPage).toBe('https://verify.vibefycode.test/a/kettle');
  });

  it.each(['suspended', 'expired', 'revoked'])('does not call a %s badge live', (status) => {
    const answer = badgeStatus(row({ status }), 'https://verify.test');
    expect(answer.isLive).toBe(false);
    expect(answer.state).toBe(status);
  });

  it('treats a status it has never seen as not live', () => {
    // There is no value the database can acquire that should make a stranger's
    // page show our mark. Failing closed is the only safe direction here.
    const answer = badgeStatus(row({ status: 'something_new' }), 'https://verify.test');
    expect(answer.isLive).toBe(false);
  });

  it('carries what the badge means, in the payload rather than the docs', () => {
    // The likeliest misuse is reading isLive and rendering the word "safe".
    // Whoever writes that code has this sentence on their screen.
    const status = badgeStatus(row(), 'https://verify.test');
    expect(status.meaning).toBe(BADGE_MEANING);
    expect(status.limits).toBe(BADGE_LIMITS);
    expect(status.limits).toMatch(/not a statement that the application has no defects/i);
  });

  it('says which origin the badge was issued for', () => {
    // A badge shown on a different site is misuse, and the caller cannot see
    // that unless we tell them where it belongs.
    expect(badgeStatus(row(), 'https://verify.test').certifiedOrigin).toBe(
      'https://kettle.example',
    );
  });

  it('handles a badge with no expiry without inventing one', () => {
    expect(badgeStatus(row({ expires_at: null }), 'https://verify.test').expiresOn).toBeNull();
  });

  it('does not double the slash when the origin has a trailing one', () => {
    expect(badgeStatus(row(), 'https://verify.test/').verificationPage).toBe(
      'https://verify.test/a/kettle',
    );
  });
});

describe('the list, for people who should not have to tell us what they are looking at', () => {
  const rows = [
    row({ public_id: 'a', slug: 'a', status: 'active' }),
    row({ public_id: 'b', slug: 'b', status: 'suspended' }),
    row({ public_id: 'c', slug: 'c', status: 'revoked' }),
    row({ public_id: 'd', slug: 'd', status: 'active' }),
  ];

  it('holds only the live ones', () => {
    const list = liveBadgeList(rows, 'https://verify.test');
    expect(list.badges.map((badge) => badge.badgeId)).toEqual(['a', 'd']);
    expect(list.count).toBe(2);
  });

  it('says when it was built, because a copy of it goes stale', () => {
    const list = liveBadgeList(rows, 'https://verify.test', new Date('2026-09-19T06:00:00.000Z'));
    expect(list.generatedAt).toBe('2026-09-19T06:00:00.000Z');
  });

  it('says in its own body that a stale copy is not an answer', () => {
    // Suspension is how a mark stops meaning anything. A list downloaded this
    // morning cannot carry that, and the document has to say so itself — a
    // caveat in documentation nobody opens is not a caveat.
    const list = liveBadgeList(rows, 'https://verify.test');
    expect(list.staleness).toMatch(/snapshot/i);
    expect(list.staleness).toMatch(/ask about the one badge it cares about/i);
  });

  it('carries the same meaning and limits as a single answer', () => {
    const list = liveBadgeList(rows, 'https://verify.test');
    expect(list.meaning).toBe(BADGE_MEANING);
    expect(list.limits).toBe(BADGE_LIMITS);
  });

  it('is empty rather than wrong when nothing is live', () => {
    const list = liveBadgeList([row({ status: 'revoked' })], 'https://verify.test');
    expect(list.badges).toEqual([]);
    expect(list.count).toBe(0);
  });
});

describe('what is deliberately not here', () => {
  const source = readFileSync(join(process.cwd(), 'packages/badge/src/public-status.ts'), 'utf8');

  it('has no lookup by domain', () => {
    /*
     * The obvious third shape, and the one that would let somebody build a
     * browser extension reporting every page a person visits to us. The list
     * does the same job without the leak, so the leak has nowhere to hide
     * behind being convenient.
     */
    expect(source).not.toMatch(/function\s+\w*[Bb]yDomain/);
    expect(source).not.toMatch(/certified_origin\s*=\s*\$/);
  });

  it('says why, where somebody about to add one would read it', () => {
    expect(source).toMatch(/no "does this domain have a badge" lookup/i);
  });
});
