/**
 * The questions, and how the public page answers them.
 *
 * Each check is a pure function over what a browser would have received. They
 * are written to be read by the person deciding whether to pay, so the question
 * is in their words — "can I cancel this?" — and the answer says what we saw
 * rather than what we concluded.
 *
 * Two things every check obeys.
 *
 *   · **It quotes what it matched.** An observation without its evidence is an
 *     assertion, and this product does not publish assertions about anybody.
 *   · **It says `unclear` when it is unclear.** A single-page look at a large
 *     site misses things constantly: a cancellation flow can live behind a
 *     sign-in, a company name can be in a footer that loads later. Reporting
 *     that honestly is the difference between a useful tool and a rumour mill.
 */
import type { FetchedPage } from './fetch.ts';
import type { Observation, Outcome, SignalId, Weight } from './types.ts';

/** Strips tags so a phrase in body text is not confused with one in a script. */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ');
}

/** Every href and the words inside its link, which is where policies live. */
function links(html: string): { href: string; text: string }[] {
  return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(
    (match) => ({
      href: match[1]!.trim(),
      text: match[2]!
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    }),
  );
}

function quote(value: string, limit = 160): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

interface Check {
  readonly id: SignalId;
  readonly question: string;
  readonly weight: Weight;
  run(page: FetchedPage): { outcome: Outcome; detail: string; evidence: string[] };
}

/** Finds a link whose address or words match, and reports what it matched. */
function linkMatcher(page: FetchedPage, pattern: RegExp): { href: string; text: string }[] {
  return links(page.html).filter((link) => pattern.test(link.href) || pattern.test(link.text));
}

const CHECKS: readonly Check[] = [
  {
    id: 'encrypted',
    question: 'Is the connection encrypted?',
    weight: 'high',
    run: (page) => {
      const https = new URL(page.finalUrl).protocol === 'https:';
      return https
        ? {
            outcome: 'found',
            detail: 'The site is served over an encrypted connection.',
            evidence: [new URL(page.finalUrl).origin],
          }
        : {
            outcome: 'not_found',
            detail:
              'The site is served over plain HTTP. Anything typed into it — including a card number — travels in a form others on the network can read.',
            evidence: [new URL(page.finalUrl).origin],
          };
    },
  },
  {
    id: 'cancellation',
    question: 'Does it say how to cancel?',
    weight: 'high',
    run: (page) => {
      const pattern =
        /cancel|unsubscribe|manage (your )?(subscription|plan|membership)|end (your )?(subscription|membership)|opt.?out/i;
      const matched = linkMatcher(page, pattern);
      const text = visibleText(page.html);
      const mentioned = /how to cancel|cancel (at )?any ?time|you can cancel/i.exec(text);

      if (matched.length > 0) {
        return {
          outcome: 'found',
          detail: 'The page links to something about cancelling.',
          evidence: matched
            .slice(0, 3)
            .map((link) => `${quote(link.text || link.href, 60)} → ${quote(link.href, 90)}`),
        };
      }
      if (mentioned) {
        return {
          outcome: 'unclear',
          detail:
            'Cancelling is mentioned in the text but not linked to. Being told you can cancel is not the same as being shown where.',
          evidence: [quote(mentioned[0])],
        };
      }
      return {
        outcome: 'not_found',
        detail:
          'No link or instruction about cancelling was found on this page. It may exist behind a sign-in, or in a policy this check did not open.',
        evidence: [],
      };
    },
  },
  {
    id: 'contact_email',
    question: 'Is there an email address you can write to?',
    weight: 'high',
    run: (page) => {
      const mailto = [...page.html.matchAll(/mailto:([^"'?\s>]+)/gi)].map((match) => match[1]!);
      const inText = [...visibleText(page.html).matchAll(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/g)].map(
        (match) => match[0],
      );
      const all = [...new Set([...mailto, ...inText])].filter(
        // Addresses that belong to the site's own tooling rather than to a
        // person who will answer.
        (address) => !/^(no-?reply|do-?not-?reply|postmaster|abuse)@/i.test(address),
      );

      return all.length > 0
        ? {
            outcome: 'found',
            detail: 'An email address is published on the page.',
            evidence: all.slice(0, 3),
          }
        : {
            outcome: 'not_found',
            detail:
              'No contact email address was found on this page. If something goes wrong with a payment, there is no address here to write to.',
            evidence: [],
          };
    },
  },
  {
    id: 'telephone',
    question: 'Is there a telephone number?',
    weight: 'medium',
    run: (page) => {
      const tel = [...page.html.matchAll(/tel:([+\d][\d\s()-]{6,})/gi)].map((match) =>
        match[1]!.trim(),
      );
      const inText = [
        ...visibleText(page.html).matchAll(
          /(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,4}\)[\s-]?|\d{2,4}[\s-])\d{3}[\s-]?\d{3,4}/g,
        ),
      ].map((match) => match[0].trim());
      const all = [...new Set([...tel, ...inText])];

      if (tel.length > 0) {
        return {
          outcome: 'found',
          detail: 'A telephone number is published and linked for dialling.',
          evidence: tel.slice(0, 2),
        };
      }
      if (inText.length > 0) {
        return {
          outcome: 'unclear',
          detail:
            'Something that looks like a telephone number appears in the text, but it is not marked as one. It may be a date, a reference or a price.',
          evidence: all.slice(0, 2),
        };
      }
      return {
        outcome: 'not_found',
        detail: 'No telephone number was found on this page.',
        evidence: [],
      };
    },
  },
  {
    id: 'company_identity',
    question: 'Does it say who the company is?',
    weight: 'high',
    run: (page) => {
      const text = visibleText(page.html);
      const forms =
        /\b([A-Z][\w&.,'-]*(?:\s+[A-Z][\w&.,'-]*){0,4}\s+(?:\(Pty\)\s*Ltd|Pty\s*Ltd|Ltd|Limited|LLC|Inc\.?|GmbH|B\.?V\.?|S\.?A\.?S|Oy|AB|A\/S))\b/;
      const registration =
        /\b(?:company (?:registration|reg\.?|number)|reg(?:istration)? no\.?|VAT (?:no\.?|number)|CIPC|Companies House)\b[:\s]*([\w/-]{4,})/i;

      const named = forms.exec(text);
      const registered = registration.exec(text);

      if (named && registered) {
        return {
          outcome: 'found',
          detail: 'A registered company name and a registration number are both published.',
          evidence: [quote(named[1]!, 80), quote(registered[0]!, 80)],
        };
      }
      if (named) {
        return {
          outcome: 'unclear',
          detail:
            'A company name appears, but no registration number was found. A name on its own can be difficult to trace to a real entity.',
          evidence: [quote(named[1]!, 80)],
        };
      }
      return {
        outcome: 'not_found',
        detail:
          'No registered company name was found on this page. If a payment is disputed, there may be no named entity to dispute it with.',
        evidence: [],
      };
    },
  },
  {
    id: 'privacy_policy',
    question: 'Is there a privacy policy?',
    weight: 'medium',
    run: (page) => {
      const matched = linkMatcher(page, /privacy|data protection|gdpr|popia/i);
      return matched.length > 0
        ? {
            outcome: 'found',
            detail: 'A privacy policy is linked from the page.',
            evidence: [quote(matched[0]!.href, 110)],
          }
        : {
            outcome: 'not_found',
            detail: 'No privacy policy link was found on this page.',
            evidence: [],
          };
    },
  },
  {
    id: 'terms',
    question: 'Are the terms published?',
    weight: 'medium',
    run: (page) => {
      const matched = linkMatcher(page, /terms|conditions|\beula\b|user agreement/i);
      return matched.length > 0
        ? {
            outcome: 'found',
            detail: 'Terms are linked from the page.',
            evidence: [quote(matched[0]!.href, 110)],
          }
        : {
            outcome: 'not_found',
            detail: 'No link to terms or conditions was found on this page.',
            evidence: [],
          };
    },
  },
  {
    id: 'refund_policy',
    question: 'Does it say anything about refunds?',
    weight: 'medium',
    run: (page) => {
      const matched = linkMatcher(page, /refund|money.?back|returns/i);
      // vibefycode-copy-lint-allow: this is a search pattern for words on somebody else's page, not a claim we are making. We look for the phrase; we never use it.
      const mentioned = /refund|money.?back guarantee/i.exec(visibleText(page.html));
      if (matched.length > 0) {
        return {
          outcome: 'found',
          detail: 'A refund policy is linked from the page.',
          evidence: [quote(matched[0]!.href, 110)],
        };
      }
      if (mentioned) {
        return {
          outcome: 'unclear',
          detail: 'Refunds are mentioned in the text but no policy is linked.',
          evidence: [quote(mentioned[0])],
        };
      }
      return {
        outcome: 'not_found',
        detail: 'Nothing about refunds was found on this page.',
        evidence: [],
      };
    },
  },
  {
    id: 'recurring_payment',
    question: 'Does it say the payment repeats?',
    weight: 'high',
    run: (page) => {
      const text = visibleText(page.html);
      const upfront =
        /(auto(?:matically)?[- ]?renew\w*|renews automatically|recurring (?:payment|charge|billing)|billed (?:monthly|annually|yearly)|per month until|until you cancel|subscription will continue)/i.exec(
          text,
        );
      const priceOnly = /(free trial|start (?:your )?free|try (?:it )?free|\d+[- ]day trial)/i.exec(
        text,
      );

      if (upfront) {
        return {
          outcome: 'found',
          detail:
            'The page says in its own words that the payment repeats. That is what you want to see before paying, not afterwards.',
          evidence: [quote(upfront[0])],
        };
      }
      if (priceOnly) {
        return {
          outcome: 'unclear',
          detail:
            'A free trial is offered but this page does not say what happens when it ends. That is the point at which people find they have been charged.',
          evidence: [quote(priceOnly[0])],
        };
      }
      return {
        outcome: 'not_found',
        detail: 'Nothing on this page says whether a payment would repeat.',
        evidence: [],
      };
    },
  },
  {
    id: 'pricing_visible',
    question: 'Is the price shown before you sign up?',
    weight: 'medium',
    run: (page) => {
      const text = visibleText(page.html);
      const price =
        /(?:R|ZAR|\$|USD|€|EUR|£|GBP)\s?\d[\d\s.,]*(?:\s?(?:per|\/)\s?(?:month|mo|year|yr|week))?/i.exec(
          text,
        );
      const pricingLink = linkMatcher(page, /pricing|plans|prices/i);

      if (price) {
        return {
          outcome: 'found',
          detail: 'A price appears on the page.',
          evidence: [quote(price[0], 60)],
        };
      }
      if (pricingLink.length > 0) {
        return {
          outcome: 'unclear',
          detail: 'There is a pricing page, but no price on this one.',
          evidence: [quote(pricingLink[0]!.href, 110)],
        };
      }
      return {
        outcome: 'not_found',
        detail: 'No price was found on this page.',
        evidence: [],
      };
    },
  },
];

export function runChecks(page: FetchedPage): Observation[] {
  return CHECKS.map((check) => {
    const { outcome, detail, evidence } = check.run(page);
    return {
      id: check.id,
      question: check.question,
      outcome,
      detail,
      evidence,
      weight: check.weight,
    };
  });
}

export const CHECK_COUNT = CHECKS.length;
