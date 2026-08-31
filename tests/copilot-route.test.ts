/**
 * The assistant's wiring, as opposed to its rules.
 *
 * The rules are tested in `packages/copilot`. What is checked here is the
 * half that could quietly stop being true without any sentence changing: that
 * the grounding is read as the caller, that the reply is checked before it is
 * returned, and that the tokens reach the ledger the daily cap reads.
 *
 * That last one is not hypothetical caution. A week ago the spend cap could not
 * see a run that failed to persist, and reported zero while the same assessment
 * was paid for three times. An assistant that spends outside the ledger is the
 * same hole with a text box in front of it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COPILOT_MODEL } from '../packages/copilot/src/index.ts';
import { MODEL_PRICING } from '../packages/engine/src/runtime/cost.ts';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');
const route = read('apps/web/app/api/copilot/route.ts');
// Whitespace-collapsed: a sentence's meaning does not depend on where the
// formatter broke the line, and a test that fails when Prettier rewraps is a
// test about formatting wearing the clothes of one about copy.
const panel = read('apps/web/components/report-copilot.tsx').replace(/\s+/g, ' ');
const reportPage = read('apps/web/app/console/reports/[assessmentId]/page.tsx');

describe('whose findings it can see', () => {
  it('reads the grounding as the caller, not as the service', () => {
    // There is no assessment id somebody can pass to see another customer's
    // findings, because the query that assembles the context cannot see them
    // either. Row-level security does the work; the route does not re-implement
    // an ownership check that could disagree with it.
    expect(route).toContain('readAsUser');
    const grounding = route.slice(
      route.indexOf('const grounding'),
      route.indexOf('if (!grounding)'),
    );
    expect(grounding).not.toContain('writeAsService');
    expect(grounding).toContain('public.assessments');
    expect(grounding).toContain('public.findings');
  });

  it('refuses a request that names no assessment', () => {
    expect(route).toContain('No assessment named.');
    expect(route).toContain('400');
  });

  it('refuses anybody who is not signed in', () => {
    expect(route).toContain('401');
  });

  it('publishes only published findings', () => {
    // A withheld finding is withheld from the customer too — it is in the
    // record for the reviewer, not in the conversation.
    expect(route).toContain('f.is_published');
  });
});

describe('what it is allowed to say', () => {
  it('checks every reply before returning it', () => {
    expect(route).toContain('checkCopilotReply');
    expect(route).toContain('COPILOT_WITHHELD');
  });

  it('returns the explanation rather than the draft when it withholds', () => {
    expect(route).toContain('check.allowed ? text : COPILOT_WITHHELD');
  });

  it('tells the caller that something was withheld, rather than hiding it', () => {
    expect(route).toContain('withheld: !check.allowed');
  });
});

describe('what it costs', () => {
  it('prices the call against the table that refuses an unpriced model', () => {
    expect(route).toContain('priceFor(COPILOT_MODEL)');
    expect(Object.keys(MODEL_PRICING)).toContain(COPILOT_MODEL);
  });

  it('counts cached tokens at their own rates rather than at full price', () => {
    expect(route).toContain('cacheWriteMultiplier');
    expect(route).toContain('cacheReadMultiplier');
  });

  it('writes the spend to the ledger the daily cap reads', () => {
    expect(route).toContain('insert into public.cost_records');
    expect(route).toContain('ai_cost_usd');
  });

  it('does not attribute the conversation to the assessment', () => {
    // It is not what the assessment cost. Putting it there would make the unit
    // economics dashboard quietly wrong about every run somebody chatted about.
    const insert = route.slice(route.indexOf('insert into public.cost_records'));
    expect(insert.slice(0, 400)).toContain('values (null,');
  });

  it('caches the instruction, because the findings do not change while somebody reads them', () => {
    expect(route).toContain("cache_control: { type: 'ephemeral' }");
  });

  it('tags the row as the assistant’s, or the ceiling cannot find it again', () => {
    const insert = route.slice(route.indexOf('insert into public.cost_records'));
    expect(insert.slice(0, 400)).toContain('purpose');
    expect(insert.slice(0, 400)).toContain("'assistant'");
  });
});

describe('the ceiling', () => {
  it('is checked before the money is spent, not after', () => {
    // A limit read after the call is a receipt. The check has to sit above the
    // line that buys the tokens or it stops nothing.
    const check = route.indexOf('assistant_spend_since');
    const call = route.indexOf('anthropic.messages.create');
    expect(check).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(-1);
    expect(check).toBeLessThan(call);
  });

  it('measures a window the database owns rather than the history it was handed', () => {
    // The browser decides what conversation to send back, so a per-conversation
    // total is a figure the spender reports about itself.
    expect(route).toContain('COPILOT_CEILING_WINDOW_MINUTES');
    expect(route).toContain('row.organisation_id');
  });

  it('answers with a sentence rather than a bare refusal', () => {
    expect(route).toContain('COPILOT_CEILING_REACHED');
    expect(route).toContain('ceilingReached: true');
    expect(route).toContain('429');
  });

  it('renders that sentence as an answer in the panel, not as a failure', () => {
    expect(panel).toContain('ceilingReached');
    expect(panel).toMatch(/!response\.ok && !data\.ceilingReached/);
  });
});

describe('the exemption is the list, not the prose', () => {
  /** The skip set itself, not the comments around it. */
  const skipped = (() => {
    const source = read('tools/copy-lint.mjs');
    const block = /const SKIP_FILES = new Set\(\[([\s\S]*?)\]\)/.exec(source);
    if (!block) throw new Error('copy-lint no longer has a SKIP_FILES set');
    return [...block[1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
  })();

  it('exempts the rule list, which necessarily contains every forbidden phrase', () => {
    expect(skipped).toContain('packages/copilot/src/guard.ts');
  });

  it('does not exempt the file the assistant is instructed with', () => {
    // The system prompt is prose a customer's answers are shaped by. If it ever
    // stopped being gated, the one text written while somebody waits would be
    // the only text in the product nobody checks — twice over.
    expect(skipped).not.toContain('packages/copilot/src/index.ts');
  });
});

describe('what the customer is told about it', () => {
  it('states the limits on the panel rather than only in a policy', () => {
    // Somebody who asks "will this fix my score" and gets a straight refusal
    // should already know why, or the refusal reads as evasion.
    expect(panel).toMatch(/cannot change a finding or a score/i);
    expect(panel).toMatch(/next assessment/i);
  });

  it('says what it has been given, so its silences are legible', () => {
    expect(panel).toMatch(/this assessment and nothing else/i);
  });

  it('sits above the report, not below it', () => {
    // Somebody who has read the whole document and still has a question has
    // already concluded nobody will answer it.
    const copilot = reportPage.indexOf('<ReportCopilot');
    const iframe = reportPage.indexOf('<iframe');
    expect(copilot).toBeGreaterThan(-1);
    expect(copilot).toBeLessThan(iframe);
  });

  it('says that nothing is kept, where the claim can be checked', () => {
    // Somebody who assumes a transcript exists will ask us for it later — and
    // for a company that rates other people's software, "we keep nothing" is a
    // claim worth making next to the box rather than in a policy.
    expect(panel).toMatch(/Nothing you type here is stored/i);
    expect(panel).toMatch(/leaving the page ends it/i);
  });

  it('announces its own updates to a screen reader', () => {
    expect(panel).toContain('aria-live="polite"');
    expect(panel).toContain('role="log"');
  });
});
