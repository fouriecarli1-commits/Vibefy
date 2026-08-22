/**
 * The legal artefacts are drafts, and must stay visibly so. These tests assert
 * that the set is complete, that every document a customer can consent to
 * actually exists, that the mandated clauses are present, and that nothing has
 * quietly lost its DRAFT header.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { buildRegistry, registryProblems, DOCUMENT_FILES } from '../tools/legal-registry.mjs';
import { lintText } from '../tools/copy-lint.mjs';
import { connect } from './setup/client.ts';

const registry = buildRegistry();
const read = (file: string) => readFileSync(join(process.cwd(), 'legal', file), 'utf8');

/** Clause tests care about the sentence, not where Markdown happened to wrap it. */
const flow = (file: string) => read(file).replace(/^>\s?/gm, '').replace(/\s+/g, ' ');

let db: Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db?.end();
});

describe('the drafted set', () => {
  it('has no gaps', () => {
    expect(registryProblems(registry)).toEqual([]);
  });

  it('covers all fourteen documents the brief requires', () => {
    expect(Object.keys(registry.documents)).toHaveLength(14);
  });

  it('marks every document as a draft pending counsel', () => {
    for (const [file, entry] of Object.entries(registry.documents)) {
      expect(entry.isDraft, `${file} lost its DRAFT header`).toBe(true);
      expect(entry.version, `${file} has no version`).toBeTruthy();
    }
  });

  it('pins each document to a hash, so acceptance records exactly what was agreed', () => {
    for (const entry of Object.values(registry.documents)) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('every consent the database can record has a document behind it', () => {
  it('matches the consent_document enum exactly', async () => {
    const { rows } = await db.query<{ value: string }>(
      `select unnest(enum_range(null::public.consent_document))::text as value`,
    );
    const enumValues = rows.map((row) => row.value).sort();
    expect(Object.keys(DOCUMENT_FILES).sort()).toEqual(enumValues);
  });
});

describe('the clauses the brief requires', () => {
  const tos = flow('terms-of-service.md');

  it.each([
    [
      'the scope and limitation block',
      /point-in-time, scope-limited, AI-assisted and human-reviewed/,
    ],
    ['absence of a finding', /Absence of a finding is not evidence of absence of a defect/],
    ['no warranty', /provided "as is"/i],
    ['limitation of liability', /aggregate liability .* limited to the fees/i],
    ['customer indemnity', /indemnify and hold us harmless/i],
    ['no third-party reliance', /No third party .* may rely/i],
    ['right to refuse and revoke', /Our right to refuse and to revoke/i],
    ['AI disclosure', /AI output may contain errors/i],
    ['dispute resolution', /governed by the laws of/i],
    ['force majeure and severability', /Force majeure/i],
    ['termination and deletion', /Suspension and termination/i],
  ])('the Terms of Service contains %s', (_label, pattern) => {
    expect(tos).toMatch(pattern);
  });

  it('the Badge Licence forbids extending the mark and requires the link', () => {
    const licence = flow('badge-licence.md');
    expect(licence).toMatch(/A badge that does not link is a claim without evidence/);
    expect(licence).toMatch(/Minimum size 96px/);
    expect(licence).toMatch(/at most twelve months/);
    expect(licence).toMatch(/No alteration/);
  });

  it('the Authorisation warranty records what makes testing lawful', () => {
    const authorisation = flow('authorisation-to-test.md');
    expect(authorisation).toMatch(/Computer Fraud and Abuse Act/);
    expect(authorisation).toMatch(/synthetic test account/i);
    expect(authorisation).toMatch(/withdraw this authorisation at any time/i);
    expect(authorisation).toMatch(/indemnif/i);
  });

  it('the Independence Policy states that payment cannot move a score', () => {
    const independence = flow('rating-methodology-and-independence.md');
    expect(independence).toMatch(/Payment does not buy a score/);
    expect(independence).toMatch(/has no field/);
    expect(independence).toMatch(/identical/);
  });

  it('the Acceptable Use Policy names every prohibited category', () => {
    const aup = flow('acceptable-use-policy.md');
    for (const category of [
      /malware/i,
      /phishing/i,
      /child sexual abuse/i,
      /weapons/i,
      /requiring a licence/i,
      /[Ii]mpersonate/,
      /[Ss]crape/,
      /deceive users/i,
    ]) {
      expect(aup).toMatch(category);
    }
  });
});

describe('the drafts do not over-claim', () => {
  it.each(Object.keys(registry.documents))('%s passes the copy lint', (file) => {
    expect(lintText(read(file), `legal/${file}`)).toEqual([]);
  });
});
