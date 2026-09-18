/**
 * The three questions a visitor asks that the rubric could not answer.
 *
 * Added with rubric 1.1.0, and deliberately at the same time as the criteria
 * they answer. The verification page turns "no findings against this criterion"
 * into a tick — so a criterion that nothing checks does not produce a blank, it
 * produces a *pass*, for something nobody looked at. That is the one failure
 * this product cannot survive, and it is why these are not a later commit.
 *
 * All three are measured rather than judged, and all three are scoped narrowly
 * enough that the finding is defensible:
 *
 *   · **SEC-12** — where a card number goes. A checkout that hands the card to
 *     Stripe, Paystack, PayPal or Adyen is handing it to somebody set up to
 *     hold one. A form that posts card-shaped fields to the application's own
 *     origin is not, and the difference is visible from outside.
 *   · **SEC-13** — whether the page loads a script from a host already known to
 *     mine cryptocurrency or to serve malware. "Known" is doing real work in
 *     that sentence and every finding says so: this is not an antivirus scan
 *     and cannot see anything that has not been reported.
 *   · **PRI-07** — whether somebody can reach a human without signing in. The
 *     signals come from `@vibefycode/trustcheck`, which already asks this
 *     question for consumers and has spent months getting the wording right.
 */
import { runChecks, type FetchedPage, type Observation } from '@vibefycode/trustcheck';
import type { BrowserSession } from '../runtime/browser.ts';
import type { RawFinding } from './types.ts';

/**
 * Hosts whose entire purpose is mining cryptocurrency in a visitor's browser.
 *
 * A deliberately short list of the ones that are unambiguous. A long list
 * assembled from a feed would catch more and would also, eventually, accuse a
 * customer of hosting malware because a CDN they use once served something.
 * The narrow list is the defensible one.
 */
const MINER_HOSTS = [
  'coinhive.com',
  'coin-hive.com',
  'jsecoin.com',
  'crypto-loot.com',
  'cryptoloot.pro',
  'coinimp.com',
  'webminepool.com',
  'minero.cc',
  'webmine.cz',
  'authedmine.com',
];

/** Script text that is a miner whatever it was served from. */
const MINER_SIGNATURES = [
  /CoinHive\s*\.\s*Anonymous/i,
  /new\s+Miner\s*\.\s*User/i,
  /CryptoLoot\./i,
];

/** Recognised processors: a card handed to one of these is handled by them. */
const PAYMENT_PROCESSORS = [
  'js.stripe.com',
  'checkout.stripe.com',
  'js.paystack.co',
  'checkout.paystack.com',
  'www.paypal.com',
  'www.paypalobjects.com',
  'checkout.razorpay.com',
  'checkout.adyen.com',
  'js.braintreegateway.com',
  'checkout.flutterwave.com',
  'buy.itunes.apple.com',
  'js.squareup.com',
  'pay.google.com',
  'checkout.paddle.com',
  'cdn.paddle.com',
  'sandbox.yoco.com',
  'js.yoco.com',
  'www.payfast.co.za',
  'sandbox.payfast.co.za',
];

export interface TrustMeasurements {
  /** Every script origin the page loaded, deduplicated. */
  readonly scriptHosts: readonly string[];
  readonly minerHosts: readonly string[];
  readonly minerSignatures: readonly string[];
  /** A card input was found on the page. */
  readonly collectsCardDetails: boolean;
  /** Card inputs sit inside a frame belonging to a recognised processor. */
  readonly cardFieldsAreFramed: boolean;
  readonly processorsPresent: readonly string[];
  /** Contactability, from the consumer trust check's own signals. */
  readonly contactRoutes: readonly string[];
  readonly contactOutcome: 'found' | 'not_found' | 'unclear';
}

/** Inputs that hold a card number, by every name a form gives them. */
const CARD_FIELD = `(() => {
  const CARD = /card.?number|cardnum|ccnum|cc-number|creditcard|pan\\b/i;
  const CVC = /cvc|cvv|security.?code|card.?code/i;
  const inputs = [...document.querySelectorAll('input')];
  const named = (input) =>
    [input.name, input.id, input.autocomplete, input.placeholder, input.getAttribute('aria-label')]
      .filter(Boolean)
      .join(' ');

  const onPage = inputs.filter(
    (input) => CARD.test(named(input)) || CVC.test(named(input)) || input.autocomplete === 'cc-number',
  );

  const frames = [...document.querySelectorAll('iframe')]
    .map((frame) => frame.src)
    .filter(Boolean);

  return {
    cardInputsOnPage: onPage.length,
    // A processor's fields live in its own frame, which is the whole point of
    // the arrangement: the card never enters the merchant's document.
    frameSources: frames,
    scripts: [...document.querySelectorAll('script[src]')].map((script) => script.src),
    inlineScripts: [...document.querySelectorAll('script:not([src])')]
      .map((script) => script.textContent || '')
      .join('\\n')
      .slice(0, 200000),
  };
})();`;

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
};

const matchesKnown = (host: string, list: readonly string[]) =>
  list.some((known) => host === known || host.endsWith(`.${known}`));

export async function measureTrust(
  session: BrowserSession,
  html: string,
  finalUrl: string,
): Promise<TrustMeasurements> {
  const page = (await session.page.evaluate(FIELD_SCRIPT())) as {
    cardInputsOnPage: number;
    frameSources: string[];
    scripts: string[];
    inlineScripts: string;
  };

  const scriptHosts = [
    ...new Set(page.scripts.map(hostOf).filter((host): host is string => host !== null)),
  ];
  const frameHosts = [
    ...new Set(page.frameSources.map(hostOf).filter((host): host is string => host !== null)),
  ];

  const processorsPresent = [...new Set([...scriptHosts, ...frameHosts])].filter((host) =>
    matchesKnown(host, PAYMENT_PROCESSORS),
  );

  // The consumer trust check's own signals, reused rather than re-derived: it
  // has already worked out that a no-reply address is not a contact route.
  //
  // Built as the real shape rather than cast past the type. The checks read the
  // headers on some paths, and a cast that hid an absent field would produce a
  // quiet wrong answer about whether anybody can be contacted.
  const fetched: FetchedPage = {
    finalUrl,
    status: 200,
    headers: {},
    html,
    redirected: false,
  };
  const contact: Observation[] = runChecks(fetched).filter((observation) =>
    ['contact_email', 'telephone', 'company_identity'].includes(observation.id),
  );
  const found = contact.filter((observation) => observation.outcome === 'found');

  return {
    scriptHosts,
    minerHosts: [...scriptHosts, ...frameHosts].filter((host) => matchesKnown(host, MINER_HOSTS)),
    minerSignatures: MINER_SIGNATURES.filter((pattern) => pattern.test(page.inlineScripts)).map(
      (pattern) => pattern.source,
    ),
    collectsCardDetails: page.cardInputsOnPage > 0,
    cardFieldsAreFramed: frameHosts.some((host) => matchesKnown(host, PAYMENT_PROCESSORS)),
    processorsPresent,
    contactRoutes: found.map((observation) => observation.id),
    contactOutcome:
      found.length > 0
        ? 'found'
        : contact.some((observation) => observation.outcome === 'unclear')
          ? 'unclear'
          : 'not_found',
  };
}

function FIELD_SCRIPT(): string {
  return CARD_FIELD;
}

export function trustFindings(
  measurements: TrustMeasurements,
  declared: { payments: boolean },
  evidenceIds: readonly string[],
): RawFinding[] {
  const findings: RawFinding[] = [];
  const evidence = [...evidenceIds];

  // --- SEC-12: where a card number goes ------------------------------------
  //
  // Only when a card field was actually found. An application with no checkout
  // is not failing this criterion; it has nothing to fail it with, and the
  // verification page says "there was no checkout to test" rather than ticking.
  if (measurements.collectsCardDetails && !measurements.cardFieldsAreFramed) {
    findings.push({
      ruleId: 'SEC-12',
      dimension: 'security_posture',
      severity: 'high',
      confidence: 'medium',
      title: 'Card details are typed into the application’s own page',
      description:
        'A field that takes a card number was found in the application’s own document rather than inside a frame belonging to a payment processor. When a card is typed into the merchant’s own page, the merchant’s servers and every script on that page are in the path of the card number — which is the arrangement the card schemes require merchants to avoid, and the one that turns a single compromised script into a card-skimming incident.',
      remediation:
        'Use the hosted fields or hosted checkout your payment provider offers, so the card number never enters your own document. Every recognised processor provides one.',
      evidenceIds: evidence,
    });
  }

  // --- SEC-13: known-hostile code ------------------------------------------
  if (measurements.minerHosts.length > 0 || measurements.minerSignatures.length > 0) {
    findings.push({
      ruleId: 'SEC-13',
      dimension: 'security_posture',
      severity: 'critical',
      confidence: 'high',
      title: 'The page loads code from a known cryptominer',
      description: `The page loaded ${
        measurements.minerHosts.length > 0
          ? `a script from ${measurements.minerHosts.join(', ')}`
          : 'inline code matching a known cryptominer'
      }. Code of this kind spends a visitor’s battery and processor without asking. It is most often present because something else was compromised, so the miner is usually the symptom rather than the whole problem.`,
      remediation:
        'Remove it, then find out how it got there — a miner on a page almost never arrives alone. Check the dependencies, the build pipeline, and anything with write access to what you deploy.',
      evidenceIds: evidence,
    });
  }

  // --- PRI-07: somebody to write to ----------------------------------------
  if (measurements.contactOutcome === 'not_found') {
    findings.push({
      ruleId: 'PRI-07',
      dimension: 'data_privacy_practice',
      severity: 'medium',
      confidence: 'medium',
      title: 'No way to reach the operator was found without signing in',
      description:
        'No address that a person answers, telephone number, or named company was found on the pages we could reach. Both POPIA and the GDPR expect somebody a data subject can write to about their own data, and a user who cannot find anybody to ask has no route to exercise any of it. It may exist behind a sign-in, or on a page this assessment did not open — absence of a finding is not evidence of absence.',
      remediation:
        'Publish an address a person actually reads, on a page a visitor can reach without an account. A no-reply address is not a contact route.',
      evidenceIds: evidence,
    });
  }

  return findings;
}
