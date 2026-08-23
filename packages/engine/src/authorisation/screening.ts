/**
 * Prohibited-use screening at intake.
 *
 * Two passes, deliberately in this order: a deterministic pre-filter that cannot
 * be talked out of a refusal, then — where a model is available — a judgement
 * pass for the cases wording alone cannot settle.
 *
 * The default when the two disagree, or when the description is too thin to
 * judge, is `needs_human_review` rather than either extreme. A wrongly refused
 * customer is a real harm; so is a wrongly accepted one. The difference is that
 * a human can resolve the first in a day.
 */
import { z } from 'zod';
import type { ModelClient } from '../model/client.ts';

export const SCREENING_CATEGORIES = [
  'malware',
  'phishing_or_credential_harvesting',
  'csam_or_minor_sexual_content',
  'weapons_or_illicit_substances',
  'unlicensed_financial_services',
  'impersonation_of_an_institution',
  'terms_breaching_scraping',
  'deception_about_operator_or_data',
  'targeting_a_private_individual',
] as const;

export type ScreeningCategory = (typeof SCREENING_CATEGORIES)[number];
export type ScreeningVerdict = 'cleared' | 'refused' | 'needs_human_review';

export const screeningSchema = z.object({
  verdict: z.enum(['cleared', 'refused', 'needs_human_review']),
  category: z.enum(SCREENING_CATEGORIES).nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  quotedBasis: z
    .string()
    .describe(
      'The exact words from the submission that led to this verdict. Never refuse without quoting.',
    ),
  reasoning: z.string(),
});

export type ScreeningResult = z.infer<typeof screeningSchema> & {
  readonly source: 'deterministic' | 'model' | 'unavailable';
};

export interface IntakeSubmission {
  readonly appName: string;
  readonly description: string;
  readonly category: string | null;
  readonly targetAudience: string | null;
  readonly primaryUrl: string | null;
}

/**
 * Phrases specific enough that their presence is the finding. Deliberately not a
 * keyword list about topics — "crypto", "dating" and "security" are all
 * legitimate subjects, and a screen that refuses topics refuses honest customers.
 */
const HARD_REFUSALS: readonly { pattern: RegExp; category: ScreeningCategory }[] = [
  {
    pattern:
      /\b(?:steal|harvest|capture)\s+(?:their\s+|user\s+)?(?:passwords?|credentials?|logins?)\b/i,
    category: 'phishing_or_credential_harvesting',
  },
  {
    pattern:
      /\b(?:clone|replica|copy)\s+of\s+(?:the\s+)?(?:\w+\s+)?(?:bank|paypal|stripe|revolut)\b/i,
    category: 'impersonation_of_an_institution',
  },
  {
    pattern: /\bphishing\s+(?:page|site|kit|campaign)\b/i,
    category: 'phishing_or_credential_harvesting',
  },
  { pattern: /\b(?:keylogger|ransomware|stalkerware|spyware)\b/i, category: 'malware' },
  {
    pattern: /\bwithout\s+(?:their|the user'?s?)\s+knowledge\b/i,
    category: 'deception_about_operator_or_data',
  },
  {
    pattern:
      /\btrack\s+(?:my|a|an)\s+(?:ex|partner|girlfriend|boyfriend|wife|husband|neighbour|neighbor)\b/i,
    category: 'targeting_a_private_individual',
  },
  {
    pattern: /\bbypass(?:es|ing)?\s+(?:their|the)\s+(?:rate\s*limits?|terms|anti-?bot)\b/i,
    category: 'terms_breaching_scraping',
  },
  {
    pattern: /\b(?:buy|sell|order)\s+(?:guns?|firearms?|cocaine|heroin|meth|fentanyl)\b/i,
    category: 'weapons_or_illicit_substances',
  },
];

/** Too little to judge on. Not a refusal — a request for more. */
const MINIMUM_DESCRIPTION_LENGTH = 40;

export function deterministicScreen(submission: IntakeSubmission): ScreeningResult | null {
  const haystack = [
    submission.appName,
    submission.description,
    submission.category,
    submission.targetAudience,
  ]
    .filter(Boolean)
    .join('\n');

  for (const { pattern, category } of HARD_REFUSALS) {
    const match = pattern.exec(haystack);
    if (match) {
      return {
        verdict: 'refused',
        category,
        confidence: 'high',
        quotedBasis: match[0],
        reasoning: `The submission describes ${match[0]!.toLowerCase()}, which falls under the Acceptable Use Policy.`,
        source: 'deterministic',
      };
    }
  }

  if ((submission.description ?? '').trim().length < MINIMUM_DESCRIPTION_LENGTH) {
    return {
      verdict: 'needs_human_review',
      category: null,
      confidence: 'low',
      quotedBasis: submission.description ?? '',
      reasoning:
        'The description is too short to judge what the application is for. This is not a refusal — a reviewer will ask for more detail.',
      source: 'deterministic',
    };
  }

  return null;
}

export async function screenIntake(
  submission: IntakeSubmission,
  model?: ModelClient,
): Promise<ScreeningResult> {
  const deterministic = deterministicScreen(submission);
  if (deterministic) return deterministic;

  if (!model) {
    return {
      verdict: 'needs_human_review',
      category: null,
      confidence: 'low',
      quotedBasis: '',
      reasoning:
        'The deterministic screen found nothing, and no judgement pass was available. A reviewer confirms before any assessment runs.',
      source: 'unavailable',
    };
  }

  try {
    const result = await model.run<z.infer<typeof screeningSchema>>({
      stage: 'intake_screening',
      promptId: 'prohibited-use-screening',
      outputSchema: screeningSchema,
      messages: [
        {
          role: 'user',
          content: [
            `Application name: ${submission.appName}`,
            `Category: ${submission.category ?? 'not stated'}`,
            `Target audience: ${submission.targetAudience ?? 'not stated'}`,
            `URL: ${submission.primaryUrl ?? 'not stated'}`,
            '',
            'Description as written by the submitter:',
            submission.description,
          ].join('\n'),
        },
      ],
    });

    if (!result.parsed) {
      return {
        verdict: 'needs_human_review',
        category: null,
        confidence: 'low',
        quotedBasis: '',
        reasoning: 'The screening pass returned nothing usable, so a reviewer decides.',
        source: 'unavailable',
      };
    }

    // A refusal has to quote what it relied on. One that cannot is downgraded to
    // a review rather than acted on.
    if (result.parsed.verdict === 'refused' && result.parsed.quotedBasis.trim().length === 0) {
      return {
        ...result.parsed,
        verdict: 'needs_human_review',
        reasoning: `${result.parsed.reasoning} (Downgraded to human review: a refusal must quote the words it relied on.)`,
        source: 'model',
      };
    }

    return { ...result.parsed, source: 'model' };
  } catch {
    return {
      verdict: 'needs_human_review',
      category: null,
      confidence: 'low',
      quotedBasis: '',
      reasoning:
        'The screening pass could not run, so a reviewer decides. Screening never fails open.',
      source: 'unavailable',
    };
  }
}
