import Anthropic from '@anthropic-ai/sdk';
import { NextResponse, type NextRequest } from 'next/server';
import { priceFor } from '@vibefycode/engine';
import { badgeEmbedJsx, badgeEmbedSnippet } from '@vibefycode/shared';
import {
  COPILOT_COST_CEILING_USD,
  COPILOT_MODEL,
  COPILOT_WITHHELD,
  checkCopilotReply,
  copilotSystemPrompt,
  recentTurns,
  type CopilotContext,
  type CopilotTurn,
} from '@vibefycode/copilot';
import { createClient } from '@/lib/supabase/server';
import { readAsUser, writeAsService } from '@/lib/sql';
import { resolveVerifyOrigin } from '@/lib/verify-origin.server';

/**
 * The assistant beside the report.
 *
 * Three things happen here that do not happen in a chat endpoint written for
 * its own sake:
 *
 *   · The context is read as the caller, through row-level security. There is
 *     no assessment id you can pass to see somebody else's findings, because
 *     the query that assembles the grounding cannot see them either.
 *   · Every reply is checked before it is returned. This is the only text the
 *     product sends a customer that no build-time gate has read, and an
 *     assistant that calls an application secure has undone the sentence the
 *     rest of the product is careful about.
 *   · The tokens are priced and written to `cost_records`. An assistant that
 *     spends without appearing in the ledger is exactly the hole the spend cap
 *     was blind to a week ago, rebuilt with a text box in front of it.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface Body {
  readonly assessmentId?: string;
  readonly messages?: CopilotTurn[];
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Body;
  const assessmentId = String(body.assessmentId ?? '');
  const turns = Array.isArray(body.messages) ? body.messages : [];
  if (!assessmentId) return NextResponse.json({ error: 'No assessment named.' }, { status: 400 });
  if (turns.length === 0) return NextResponse.json({ error: 'Nothing asked.' }, { status: 400 });

  const verifyOrigin = await resolveVerifyOrigin();

  // Everything the assistant is allowed to know, read as the caller. An
  // assessment they cannot see produces no rows, and therefore no context.
  const grounding = await readAsUser(user.id, async (client) => {
    const assessment = await client.query<{
      organisation_id: string;
      app_name: string;
      status: string;
      overall_score: string | null;
      rubric_version: string;
      scope_statement: string;
      assessed_on: string;
    }>(
      `select a.organisation_id, app.name as app_name, a.status::text as status,
              a.overall_score, a.rubric_version, a.scope_statement,
              coalesce(a.completed_at, a.created_at)::date::text as assessed_on
         from public.assessments a
         join public.apps app on app.id = a.app_id
        where a.id = $1`,
      [assessmentId],
    );
    const row = assessment.rows[0];
    if (!row) return null;

    const findings = await client.query<{
      title: string;
      severity: string;
      dimension: string;
      confidence: string;
      summary: string | null;
      evidence_count: string;
    }>(
      `select f.title, f.severity::text as severity, f.dimension, f.confidence::text as confidence,
              f.summary,
              (select count(*) from public.finding_evidence fe where fe.finding_id = f.id)::text
                as evidence_count
         from public.findings f
        where f.assessment_id = $1 and f.is_published
        order by f.severity, f.title`,
      [assessmentId],
    );

    const badge = await client.query<{
      public_id: string;
      slug: string;
      status: string;
    }>(
      `select b.public_id, b.slug, b.status::text as status
         from public.badges b
         join public.assessments a on a.app_id = b.app_id
        where a.id = $1 and b.status in ('active', 'suspended')
        limit 1`,
      [assessmentId],
    );

    return { row, findings: findings.rows, badge: badge.rows[0] ?? null };
  });

  if (!grounding) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const { row, findings, badge } = grounding;
  const embedFacts = badge
    ? {
        appName: row.app_name,
        rubricVersion: row.rubric_version,
        assessedOn: row.assessed_on,
        verifyOrigin,
        publicId: badge.public_id,
        slug: badge.slug,
      }
    : null;

  const context: CopilotContext = {
    appName: row.app_name,
    assessedOn: row.assessed_on,
    rubricVersion: row.rubric_version,
    overallScore: row.overall_score === null ? null : Number(row.overall_score),
    status: row.status,
    scopeStatement: row.scope_statement,
    findings: findings.map((finding) => ({
      title: finding.title,
      severity: finding.severity,
      dimension: finding.dimension,
      confidence: finding.confidence,
      summary: finding.summary ?? '',
      evidenceCount: Number(finding.evidence_count),
    })),
    badge: {
      status: badge?.status ?? null,
      embedHtml: embedFacts ? badgeEmbedSnippet(embedFacts) : null,
      embedJsx: embedFacts ? badgeEmbedJsx(embedFacts) : null,
      verificationUrl: badge ? `${verifyOrigin}/a/${badge.slug}` : null,
    },
  };

  const anthropic = new Anthropic();
  let reply: Anthropic.Message;
  try {
    reply = await anthropic.messages.create({
      model: COPILOT_MODEL,
      max_tokens: 2000,
      // The instruction is stable for the whole conversation and the findings
      // do not change while somebody is reading them, so the prefix is worth
      // caching — the second question in a conversation costs a tenth of the
      // first.
      system: [
        {
          type: 'text',
          text: copilotSystemPrompt(context),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: recentTurns(turns).map((turn) => ({ role: turn.role, content: turn.content })),
    });
  } catch (error) {
    // Named rather than swallowed: a customer who gets silence assumes the
    // product is broken, and they are not wrong to.
    const status = error instanceof Anthropic.RateLimitError ? 429 : 502;
    return NextResponse.json(
      { error: 'The assistant could not answer just now. Try again in a moment.' },
      { status },
    );
  }

  const pricing = priceFor(COPILOT_MODEL);
  const usage = reply.usage;
  const costUsd =
    (usage.input_tokens / 1_000_000) * pricing.input +
    ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) *
      pricing.input *
      pricing.cacheWriteMultiplier +
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) *
      pricing.input *
      pricing.cacheReadMultiplier +
    (usage.output_tokens / 1_000_000) * pricing.output;

  // Into the ledger the daily cap reads. Unattributed to an assessment on
  // purpose: this is not what the assessment cost, and adding it there would
  // make the unit economics dashboard quietly wrong.
  void writeAsService(async (client) => {
    await client.query(
      `insert into public.cost_records
         (assessment_id, organisation_id, model, input_tokens, output_tokens,
          cache_read_tokens, ai_cost_usd)
       values (null, $1, $2, $3, $4, $5, $6)`,
      [
        row.organisation_id,
        COPILOT_MODEL,
        usage.input_tokens,
        usage.output_tokens,
        usage.cache_read_input_tokens ?? 0,
        costUsd.toFixed(6),
      ],
    );
  }).catch(() => undefined);

  const text = reply.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  const check = checkCopilotReply(text);

  return NextResponse.json({
    reply: check.allowed ? text : COPILOT_WITHHELD,
    withheld: !check.allowed,
    ...(check.allowed ? {} : { reasons: check.reasons }),
    costUsd: Number(costUsd.toFixed(6)),
    ceilingUsd: COPILOT_COST_CEILING_USD,
  });
}
