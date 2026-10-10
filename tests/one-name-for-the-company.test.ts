/**
 * The company has one name, and it has to read the same everywhere.
 *
 * Anré's instruction on 2026-10-08: "ons legal en besigheid hardloop deur die
 * futurebox besigheids naam en die legal moet ook so opgestel word:
 * FUTUREBOXSTUDIO (PTY) LTD (2026/714071/07)".
 *
 * It now appears in four places that a customer or a court reads — the Terms,
 * the Privacy Policy, the Badge Licence and the site footer — plus
 * `OPERATOR_IDENTITY`, which the footer reads so that the two cannot drift. A
 * name typed out five times is a name that will eventually be four names, and
 * the one that goes stale is the one nobody re-reads.
 *
 * `[JURISDICTION]` and `[CONTACT_EMAIL]` are deliberately still placeholders.
 * That is asserted too: a draft that silently acquired a governing law nobody
 * chose would be worse than one that visibly has not got one.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OPERATOR_IDENTITY,
  OPERATOR_LEGAL_NAME,
  OPERATOR_REGISTRATION_NUMBER,
} from '../packages/shared/src/legal.ts';

const LEGAL = 'legal';
const documents = readdirSync(LEGAL).filter((file) => file.endsWith('.md'));

/** The documents that name the operating entity, and why each has to. */
const NAMES_THE_ENTITY: Readonly<Record<string, string>> = {
  'terms-of-service.md': 'who the contract is with',
  'privacy-policy.md': 'who the data controller is',
  'badge-licence.md': 'who owns the Mark being licensed',
  'README.md': 'the note saying the entity is decided and the governing law is not',
};

describe('the name', () => {
  it('is a CIPC registration number, in the form one is issued in', () => {
    // YYYY/NNNNNN/NN. The last pair is the company type — 07 is a private
    // company, which is what "(Pty) Ltd" means. A typo here would be copied
    // into every document by the constant, so it is worth one assertion.
    expect(OPERATOR_REGISTRATION_NUMBER).toMatch(/^\d{4}\/\d{6}\/\d{2}$/);
    expect(OPERATOR_REGISTRATION_NUMBER.endsWith('/07')).toBe(true);
    expect(OPERATOR_LEGAL_NAME).toMatch(/\(PTY\) LTD$/);
    expect(OPERATOR_IDENTITY).toBe(`${OPERATOR_LEGAL_NAME} (${OPERATOR_REGISTRATION_NUMBER})`);
  });

  it('has no [LEGAL_ENTITY] placeholder left anywhere in the legal corpus', () => {
    const left = documents.filter((file) =>
      readFileSync(join(LEGAL, file), 'utf8').includes('[LEGAL_ENTITY]'),
    );
    expect(left, `still unfilled:\n  ${left.join('\n  ')}`).toEqual([]);
  });

  it('reads identically in every document that names it', () => {
    const wrong: string[] = [];
    for (const [file, why] of Object.entries(NAMES_THE_ENTITY)) {
      const text = readFileSync(join(LEGAL, file), 'utf8');
      if (!text.includes(OPERATOR_LEGAL_NAME)) wrong.push(`${file}: no legal name — ${why}`);
      if (!text.includes(OPERATOR_REGISTRATION_NUMBER)) {
        wrong.push(`${file}: no registration number — ${why}`);
      }
    }
    expect(
      wrong,
      `a document that must name the company does not name it as the constant does:\n  ${wrong.join('\n  ')}`,
    ).toEqual([]);
  });

  it('is not written out by hand in the footer', () => {
    // The footer is on every page, which makes it the copy most likely to be
    // edited in isolation and the one a visitor is most likely to read.
    const layout = readFileSync('apps/web/app/layout.tsx', 'utf8');
    expect(layout).toMatch(/OPERATOR_IDENTITY/);
    expect(layout, 'the footer spells the name out instead of reading it').not.toMatch(
      /FUTUREBOXSTUDIO/,
    );
  });

  /**
   * Every company-shaped name in a document.
   *
   * The pattern used to be `\(PTY\) LTD`, case-sensitive and uppercase — so a
   * second company written the way a second company would actually be
   * written, `Acme Trading (Pty) Ltd`, matched nothing at all. The test's own
   * comment says "any other `(Pty) Ltd`", which is the form it could not see.
   * `Limited` spelled out, and a trailing full stop, were invisible too.
   *
   * Adding the `i` flag to the whole pattern is not the fix, which the first
   * attempt discovered: it makes the leading `[A-Z]` case-insensitive as well,
   * so the match swallows the prose in front of the name and reports `is a
   * product of FUTUREBOXSTUDIO (PTY) LTD` as a second company.
   *
   * So the suffix is matched case-insensitively on its own, and the name is
   * the run of words immediately before it with any lowercase prose words
   * trimmed off the front. That reads a lowercase mention too, which the
   * casing assertion below needs in order to object to one.
   */
  const COMPANY_SUFFIX = /\((?:pty|proprietary)\)\s*(?:ltd|limited)\.?/gi;

  function companiesIn(text: string): string[] {
    const found: string[] = [];
    for (const match of text.matchAll(COMPANY_SUFFIX)) {
      const before = text.slice(Math.max(0, match.index - 60), match.index);
      const words = (/[A-Za-z0-9 .&'-]*$/.exec(before)?.[0] ?? '').trim().split(/\s+/);
      while (words.length > 1 && /^[a-z]/.test(words[0]!)) words.shift();
      found.push(`${words.join(' ')} ${match[0]}`.trim());
    }
    return found;
  }

  const mentions = documents.flatMap((file) =>
    companiesIn(readFileSync(join(LEGAL, file), 'utf8')).map((name) => ({ file, name })),
  );
  const isOurs = (name: string) => name.toUpperCase() === OPERATOR_LEGAL_NAME.toUpperCase();

  it('reads a company name in the forms a company name is written in', () => {
    expect(companiesIn('entered into with Acme Trading (Pty) Ltd and others')).toEqual([
      'Acme Trading (Pty) Ltd',
    ]);
    expect(companiesIn('a product of Beta Holdings (Proprietary) Limited.')).toEqual([
      'Beta Holdings (Proprietary) Limited.',
    ]);
    expect(companiesIn('is a product of FUTUREBOXSTUDIO (PTY) LTD')).toEqual([
      'FUTUREBOXSTUDIO (PTY) LTD',
    ]);
    expect(companiesIn('no company here at all')).toEqual([]);
  });

  it('flags an all-lowercase mention, even though it cannot say where the name starts', () => {
    // The limit of the trimming, written down rather than discovered later.
    // Nothing distinguishes a lowercase company name from the lowercase prose
    // in front of it, so the name comes back truncated to its last word. The
    // mention is still found, which is all the assertions below need; the
    // message they print will be short of a word.
    expect(companiesIn('operated by gamma works (pty) ltd')).toEqual(['works (pty) ltd']);
  });

  it('finds our own name, which is what makes the two claims below mean anything', () => {
    // The positive control. Both assertions after this pass by finding nothing
    // unexpected, and a pattern that matches nothing finds nothing unexpected
    // either. Ours is in four documents, each for a reason in NAMES_THE_ENTITY.
    expect(
      mentions
        .filter((m) => isOurs(m.name))
        .map((m) => m.file)
        .sort(),
      'the pattern no longer finds the company it was written for',
    ).toEqual(Object.keys(NAMES_THE_ENTITY).sort());
  });

  it('names no second company anywhere in the legal corpus', () => {
    // Any other company here is either a second entity or a leftover, and both
    // are worth stopping. A mention of futurebox the *application* is fine;
    // futurebox the company is this one.
    const others = mentions.filter((m) => !isOurs(m.name)).map((m) => `${m.file}: ${m.name}`);
    expect(others, `a second company is named:\n  ${others.join('\n  ')}`).toEqual([]);
  });

  it('spells our own name the one way, wherever it appears', () => {
    // Nothing else catches this. `reads identically in every document` asks
    // whether the exact constant appears, not whether a second,
    // differently-cased mention is sitting beside it.
    const miscased = mentions
      .filter((m) => isOurs(m.name) && m.name !== OPERATOR_LEGAL_NAME)
      .map((m) => `${m.file}: ${m.name}`);
    expect(
      miscased,
      `the company's own name, written another way:\n  ${miscased.join('\n  ')}`,
    ).toEqual([]);
  });
});

describe('what is still open, and visibly so', () => {
  /**
   * Every document still awaiting a governing law, by name.
   *
   * A count would not do. The first version of this asserted "at least one is
   * still a placeholder", and filling one of the seventeen left sixteen, so a
   * document that had quietly acquired a governing law passed. Naming the set
   * is what catches it — and a corpus where some documents name a law and the
   * rest do not is a worse state than one where none do, which is why this
   * fails in both directions.
   */
  const AWAITING_A_GOVERNING_LAW: readonly string[] = [
    // The README's own note about what is and is not decided.
    'README.md',
    'acceptable-use-policy.md',
    'appeals-and-corrections.md',
    'assessment-services-agreement.md',
    'authorisation-to-test.md',
    'badge-licence.md',
    'cookie-notice.md',
    'data-processing-agreement.md',
    'ip-takedown.md',
    'marketing-services-agreement.md',
    'privacy-policy.md',
    'rating-methodology-and-independence.md',
    'refund-and-cancellation.md',
    'responsible-disclosure.md',
    'terms-of-service.md',
  ];

  it('has not quietly acquired a governing law, in any one document', () => {
    // The registration number says South Africa. A governing-law clause is a
    // commercial choice rather than a consequence of where you registered, and
    // filling it from an inference is how a draft becomes wrong while reading
    // as finished.
    const unresolved = documents
      .filter((file) => readFileSync(join(LEGAL, file), 'utf8').includes('[JURISDICTION]'))
      .sort();
    expect(
      unresolved,
      'the set of documents awaiting a governing law changed. If that was deliberate, the whole ' +
        'corpus moves together — half of it naming a law and half not is the state this stops.',
    ).toEqual([...AWAITING_A_GOVERNING_LAW].sort());
  });

  it('still says in the registry that every document is a draft', () => {
    const registry = JSON.parse(readFileSync('legal/registry.json', 'utf8')) as {
      documents: Record<string, { isDraft: boolean; status: string }>;
    };
    const inForce = Object.entries(registry.documents).filter(([, entry]) => !entry.isDraft);
    expect(
      inForce.map(([file]) => file),
      'a document stopped being a draft without counsel having read it',
    ).toEqual([]);
  });
});
