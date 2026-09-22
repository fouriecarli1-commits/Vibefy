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
import type { ScopedResponse } from '../runtime/http.ts';
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
  /** Too much inline script to read all of, so the signatures saw only part. */
  readonly inlineScriptTruncated: boolean;
  /**
   * A card input was found in the application's own document.
   *
   * `document.querySelectorAll` does not cross a frame boundary, so this is
   * already the question that matters: whether the card number is typed into a
   * field the merchant's own page owns.
   */
  readonly collectsCardDetails: boolean;
  /**
   * A frame belonging to a recognised processor is somewhere on the page.
   *
   * It used to be called `cardFieldsAreFramed`, and the field it named claimed
   * the card inputs were inside such a frame. It never established that — it
   * asked only whether such a frame existed anywhere — and it was used to
   * withhold SEC-12, so a page with its own card fields *and* a processor frame
   * for something else was reported clean on the criterion it was failing.
   */
  readonly processorFramePresent: boolean;
  readonly processorsPresent: readonly string[];
  /** Something that looks like a payment flow was on the page at all. */
  readonly checkoutObserved: boolean;
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

  const inline = [...document.querySelectorAll('script:not([src])')]
    .map((script) => script.textContent || '')
    .join('\\n');

  return {
    cardInputsOnPage: onPage.length,
    // A processor's fields live in its own frame, which is the whole point of
    // the arrangement: the card never enters the merchant's document.
    frameSources: frames,
    scripts: [...document.querySelectorAll('script[src]')].map((script) => script.src),
    inlineScripts: inline.slice(0, 200000),
    inlineScriptTruncated: inline.length > 200000,
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

/**
 * Reads the three signals off a page that is already loaded.
 *
 * Takes the response rather than its body. The contact check reads the status
 * and the headers on some of its paths, and this used to hand it `status: 200`
 * and `headers: {}` — fabricated, beside a comment explaining that fabricating
 * them would give a quiet wrong answer about whether anybody can be contacted.
 * The real response is one argument away at every call site.
 */
export async function measureTrust(
  session: BrowserSession,
  response: Pick<ScopedResponse, 'url' | 'status' | 'headers' | 'body' | 'redirectChain'>,
): Promise<TrustMeasurements> {
  const page = (await session.page.evaluate(CARD_FIELD)) as {
    cardInputsOnPage: number;
    frameSources: string[];
    scripts: string[];
    inlineScripts: string;
    inlineScriptTruncated: boolean;
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
    finalUrl: response.url,
    status: response.status,
    headers: response.headers,
    html: response.body,
    redirected: response.redirectChain.length > 0,
  };
  const contact: Observation[] = runChecks(fetched).filter((observation) =>
    ['contact_email', 'telephone', 'company_identity'].includes(observation.id),
  );
  const found = contact.filter((observation) => observation.outcome === 'found');

  const processorFramePresent = frameHosts.some((host) => matchesKnown(host, PAYMENT_PROCESSORS));

  return {
    scriptHosts,
    minerHosts: [...scriptHosts, ...frameHosts].filter((host) => matchesKnown(host, MINER_HOSTS)),
    minerSignatures: MINER_SIGNATURES.filter((pattern) => pattern.test(page.inlineScripts)).map(
      (pattern) => pattern.source,
    ),
    inlineScriptTruncated: page.inlineScriptTruncated,
    collectsCardDetails: page.cardInputsOnPage > 0,
    processorFramePresent,
    processorsPresent,
    checkoutObserved: page.cardInputsOnPage > 0 || processorsPresent.length > 0,
    contactRoutes: found.map((observation) => observation.id),
    contactOutcome:
      found.length > 0
        ? 'found'
        : contact.some((observation) => observation.outcome === 'unclear')
          ? 'unclear'
          : 'not_found',
  };
}

/** A criterion this run did not get to test, and the sentence that says so. */
export interface NotTested {
  readonly criterion: string;
  readonly because: string;
}

export interface TrustOutcome {
  readonly findings: readonly RawFinding[];
  /**
   * The criteria this page could not answer, rather than silently none.
   *
   * "No findings against this criterion" renders as a tick. A checkout lives at
   * /checkout, not on the landing page this reads, so for an application whose
   * owner told us it takes payments, SEC-12 produced no finding and the visitor
   * was shown a tick against "If I pay, does my card go to a proper payment
   * company?" — for a page nobody had opened. That is the failure this file's
   * own header says it exists to prevent, and it was happening here.
   */
  readonly notTested: readonly NotTested[];
}

export function trustFindings(
  measurements: TrustMeasurements,
  declared: { payments: boolean },
  evidenceIds: readonly string[],
): TrustOutcome {
  const findings: RawFinding[] = [];
  const notTested: NotTested[] = [];
  const evidence = [...evidenceIds];

  // --- SEC-12: where a card number goes ------------------------------------
  //
  // A card field in the application's own document is the finding, and a
  // processor's frame somewhere else on the page does not undo it.
  // `querySelectorAll` does not cross a frame boundary, so these fields are the
  // merchant's own. Withholding the finding because a Stripe frame existed
  // elsewhere reported a page clean on the criterion it was failing.
  if (measurements.collectsCardDetails) {
    findings.push({
      ruleId: 'SEC-12',
      dimension: 'security_posture',
      severity: 'high',
      confidence: 'medium',
      title: 'Card details are typed into the application’s own page',
      description: `A field that takes a card number was found in the application’s own document rather than inside a frame belonging to a payment processor. When a card is typed into the merchant’s own page, the merchant’s servers and every script on that page are in the path of the card number — which is the arrangement the card schemes require merchants to avoid, and the one that turns a single compromised script into a card-skimming incident.${
        measurements.processorFramePresent
          ? ' A payment processor’s frame is also present on this page, so the hosted arrangement is available and these fields are not using it.'
          : ''
      }`,
      remediation:
        'Use the hosted fields or hosted checkout your payment provider offers, so the card number never enters your own document. Every recognised processor provides one.',
      evidenceIds: evidence,
    });
  } else if (declared.payments && !measurements.checkoutObserved) {
    notTested.push({
      criterion: 'SEC-12',
      because:
        'The owner says this application takes payments, and no checkout was found on the landing page — which is the only page this criterion is read from. Where a card number goes was not established.',
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

  if (measurements.inlineScriptTruncated) {
    notTested.push({
      criterion: 'SEC-13',
      because:
        'The page carries more inline script than this check reads, so the signatures were matched against part of it. The scripts it loads from elsewhere were all checked.',
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
        'No address that a person answers, telephone number, or named company was found on the landing page. Both POPIA and the GDPR expect somebody a data subject can write to about their own data, and a user who cannot find anybody to ask has no route to exercise any of it. It may exist behind a sign-in, or on a page this assessment did not open — absence of a finding is not evidence of absence.',
      remediation:
        'Publish an address a person actually reads, on a page a visitor can reach without an account. A no-reply address is not a contact route.',
      evidenceIds: evidence,
    });
  }

  return { findings, notTested };
}
