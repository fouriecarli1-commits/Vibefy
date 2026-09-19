/**
 * The extension that cannot watch you.
 *
 * A small mark in the toolbar saying whether the site you are on carries a live
 * badge is a useful thing and an easy thing to build badly. The easy version
 * lights up by itself, which means watching every page you open, or asks a
 * server "does this site have a badge", which means sending that server a
 * browsing history one request at a time. Either is a worse trade than a
 * bookmark, and neither is undone by a promise in a store listing.
 *
 * So the design is the privacy argument: one request for the whole list, on a
 * schedule, and every question answered from the copy on the computer. These
 * tests hold that shape as well as the answers, because the shape is the part
 * somebody would quietly change to make the icon light up on its own.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { answerFor, coversOrigin, originOf } from '../apps/extension/src/lookup.js';

const entry = (certifiedOrigin: string | null) => ({
  badgeId: 'bdg_1',
  certifiedOrigin,
  rubricVersion: '1.1.0',
  assessedOn: '2026-08-22',
  expiresOn: '2027-08-22',
  verificationPage: 'https://verify.vibefycode.app/a/kettle',
});

const list = (certifiedOrigin: string | null, generatedAt = '2026-09-19T06:00:00.000Z') => ({
  generatedAt,
  badges: [entry(certifiedOrigin)],
});

const now = new Date('2026-09-19T08:00:00.000Z');

describe('which page this is', () => {
  it('reads an origin from an ordinary address', () => {
    expect(originOf('https://kettle.example/pricing?ref=x')).toBe('https://kettle.example');
  });

  it('says nothing is a page when it is not one', () => {
    for (const url of ['chrome://newtab', 'about:blank', 'file:///tmp/x.html', '', 'not a url']) {
      expect(originOf(url), url).toBeNull();
    }
  });
});

describe('which badge covers it', () => {
  it('matches the exact origin', () => {
    expect(coversOrigin('https://kettle.example', 'https://kettle.example')).toBe(true);
  });

  it('does not let a badge cover a subdomain', () => {
    // A mark earned by one application must not end up vouching for another,
    // which is the misuse the badge licence exists to forbid.
    expect(coversOrigin('https://kettle.example', 'https://shop.kettle.example')).toBe(false);
    expect(coversOrigin('https://kettle.example', 'https://kettle.example.evil.test')).toBe(false);
  });

  it('does not let a badge cover a different scheme or port', () => {
    expect(coversOrigin('https://kettle.example', 'http://kettle.example')).toBe(false);
    expect(coversOrigin('https://kettle.example', 'https://kettle.example:8443')).toBe(false);
  });

  it('treats www as the same site, because it is', () => {
    expect(coversOrigin('https://kettle.example', 'https://www.kettle.example')).toBe(true);
    expect(coversOrigin('https://www.kettle.example', 'https://kettle.example')).toBe(true);
  });

  it('matches nothing when a badge has no origin recorded', () => {
    expect(coversOrigin(null, 'https://kettle.example')).toBe(false);
  });
});

describe('the answer', () => {
  it('finds a live badge for the site', () => {
    const answer = answerFor(list('https://kettle.example'), 'https://kettle.example/pricing', now);
    expect(answer.kind).toBe('badged');
    expect(answer.entry?.verificationPage).toContain('/a/kettle');
  });

  it('says no badge was issued, not that the site is bad', () => {
    // Most sites have never asked for one. An extension whose "no" reads as a
    // finding is an extension that defames every site it does not know.
    const answer = answerFor(list('https://kettle.example'), 'https://other.example/', now);
    expect(answer.kind).toBe('none');
    expect(answer.detail).toMatch(/not a finding about this site/i);
  });

  it('says so when there is no list yet, rather than saying no', () => {
    const answer = answerFor(null, 'https://kettle.example/', now);
    expect(answer.kind).toBe('no_list');
  });

  it('says a stale copy is stale, with its age', () => {
    // A list downloaded last week can show a suspended badge as live, and
    // suspension is the whole mechanism by which a mark stops meaning anything.
    const answer = answerFor(
      list('https://kettle.example', '2026-09-15T06:00:00.000Z'),
      'https://kettle.example/',
      now,
    );
    expect(answer.detail).toMatch(/4 day\(s\) old/);
    expect(answer.detail).toMatch(/check the verification page/i);
  });

  it('does not call a fresh list stale', () => {
    const answer = answerFor(list('https://kettle.example'), 'https://kettle.example/', now);
    expect(answer.detail).not.toMatch(/old/);
  });
});

describe('what the extension is not allowed to become', () => {
  const read = (name: string) => readFileSync(join(process.cwd(), 'apps/extension', name), 'utf8');
  const manifest = JSON.parse(read('manifest.json'));
  const background = read('src/background.js');
  const popup = read('src/popup.js');
  const lookup = read('src/lookup.js');

  it('can reach exactly one host', () => {
    // The list, and nothing else. A second host is a second thing to explain.
    expect(manifest.host_permissions).toHaveLength(1);
    expect(manifest.host_permissions[0]).toMatch(/^https:\/\//);
  });

  it('asks for no permission that would let it watch browsing', () => {
    // `tabs` would grant the URL of every tab at any time. `activeTab` grants
    // one tab's address at the moment somebody clicks, and nothing otherwise.
    expect(manifest.permissions).toContain('activeTab');
    expect(manifest.permissions).not.toContain('tabs');
    expect(manifest.permissions).not.toContain('webNavigation');
    expect(manifest.permissions).not.toContain('webRequest');
    expect(manifest).not.toHaveProperty('content_scripts');
  });

  it('makes exactly one network call, in one file, for the whole list', () => {
    expect((background.match(/fetch\(/g) ?? []).length).toBe(1);
    expect(popup).not.toMatch(/fetch\(/);
    expect(lookup).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon/);
  });

  it('does not light up by itself, and the reason is written down', () => {
    // The change somebody would make to be more convenient, and the one that
    // would turn this into the thing it exists not to be.
    expect(background).not.toMatch(/onUpdated|onActivated|setBadgeText/);
    expect(read('README.md')).toMatch(/does not light up by itself/i);
    expect(popup).toMatch(/only consults a list already on your computer/i);
  });

  it('tells the person, in the popup, every time', () => {
    // A privacy claim made once in a store listing is one nobody has read.
    expect(popup).toMatch(/Nothing about the page you are on was sent anywhere/);
  });

  it('keeps only the fields it renders', () => {
    const stored = background.slice(background.indexOf('badges:'), background.indexOf('});'));
    expect(stored).not.toMatch(/\.\.\.badge/);
  });
});
