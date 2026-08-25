/**
 * How people get caught, written for the person about to be caught.
 *
 * These sit beside the trust check because the check alone is not much use:
 * knowing that a page has no cancellation link only helps if you know why that
 * matters. Each piece names a specific trick, describes what it feels like from
 * the inside, and ends with the thing to do about it.
 *
 * Two rules, and they are the same two the rest of the product runs on.
 *
 *   · **No named companies.** Every example is the shape of a practice, not an
 *     accusation against anybody. We describe what dark patterns look like; we
 *     do not publish a list of who we think uses them.
 *   · **No advice we are not entitled to give.** Where the right answer is
 *     "your bank can stop this", it says so and stops. It does not tell anyone
 *     what their rights are in their country, because that varies and we are
 *     not their lawyer.
 */

export interface TrapArticle {
  readonly slug: string;
  readonly title: string;
  /** One line, in the reader's words, for a card. */
  readonly summary: string;
  /** What it feels like from the inside, before it is recognised. */
  readonly howItWorks: readonly string[];
  /** What to look for before paying. */
  readonly signs: readonly string[];
  /** What to do — practical, and only what we can stand behind. */
  readonly whatToDo: readonly string[];
}

export const TRAP_ARTICLES: readonly TrapArticle[] = [
  {
    slug: 'the-free-trial-that-was-not',
    title: 'The free trial that quietly becomes a subscription',
    summary:
      'You gave a card to prove you were real. The trial ended and the charges started, and nobody told you the date.',
    howItWorks: [
      'A trial is offered for seven or fourteen days and a card is required "for verification". No money is taken, so it feels free.',
      'The date the trial ends is not shown anywhere you will see it again. It is not in a confirmation email, and often not in the account either.',
      'On that date a full charge appears. Because the amount is modest and the name on the statement is unfamiliar, it can run for months before anyone notices.',
      'By the time it is noticed, the money already taken is treated as a normal payment for a service you did not cancel.',
    ],
    signs: [
      'A card is requested for a trial that is described as free.',
      'The page says "cancel any time" but does not say where or how.',
      'You cannot find the end date of the trial before you sign up.',
      'The price after the trial is in smaller type than the price during it, or on a different page.',
    ],
    whatToDo: [
      'Before signing up, find the cancellation page. If you cannot find it while they want your money, you will not find it when they have it.',
      'Write the trial end date in your calendar the day you sign up, two days early.',
      'Check the statement name the charge will appear under. Unfamiliar names are how these run unnoticed.',
    ],
  },
  {
    slug: 'cancelling-that-goes-nowhere',
    title: 'Cancelling that never quite completes',
    summary:
      'The button exists. It leads to a form, then an offer, then a chat window that is closed, and the subscription is still running.',
    howItWorks: [
      'Signing up takes two clicks. Cancelling takes a different route — a support form, a chat queue, or an email address that answers slowly.',
      'Each step offers a discount to stay. Accepting one restarts the subscription rather than ending it.',
      'The final step often is not a button but a request, so nothing is cancelled until somebody at the other end agrees.',
      'People give up somewhere in the middle, and the charges continue while they intend to try again.',
    ],
    signs: [
      'Signing up is self-service but cancelling requires contacting somebody.',
      'The cancellation route is not linked from the account page.',
      'Cancelling is only offered by email, or only during office hours.',
      'The confirmation says "we have received your request" rather than "your subscription has ended".',
    ],
    whatToDo: [
      'Keep the confirmation that says the subscription has ended. A request is not an ending.',
      'If the route is a form, keep a copy of what you sent and the date.',
      'If it cannot be cancelled, that is a matter for the payment provider rather than for another email.',
    ],
  },
  {
    slug: 'the-debit-order-you-did-not-agree-to',
    title: 'The debit order that outlives the app',
    summary:
      'A recurring charge continues after the account is deleted, the app is removed, or the company has stopped answering.',
    howItWorks: [
      'A subscription set up as a card payment or a debit order lives with the bank, not with the app. Deleting an account does not touch it.',
      'Removing the app from a phone stops nothing at all. Neither does changing the email address on the account.',
      'When a company goes quiet, the instruction it left with the bank keeps running until somebody stops it at the bank.',
      'Small amounts are the ones that survive longest, because they sit below the level at which a statement gets read closely.',
    ],
    signs: [
      'The payment is set up as a debit order rather than a card subscription.',
      'The amount is small and the description on the statement is not the app’s name.',
      'The charge continues after you stopped using the service.',
    ],
    whatToDo: [
      'Read one full bank statement, line by line, once a year. Most people find something.',
      'Your bank — not the app — is who stops a debit order. Ask them what they need from you.',
      'Deleting an account and deleting a payment instruction are two separate actions. Do both.',
    ],
  },
  {
    slug: 'nobody-to-contact',
    title: 'An app with nobody behind it',
    summary:
      'No email that answers, no telephone number, no company name — so a dispute has nowhere to go.',
    howItWorks: [
      'The site carries no registered company name, no address and no telephone number. Support is a form that produces a reference number and nothing else.',
      'Because there is no named entity, there is nobody to complain to, nobody to take to a small claims process, and no regulator with an obvious hook.',
      'The absence is easy to miss while signing up, because the pages that matter — pricing, features — look complete.',
    ],
    signs: [
      'The footer has no company name, registration number or address.',
      'The only contact route is a form.',
      'Replies come from a no-reply address.',
      'The terms name no jurisdiction, or name one with no connection to anything else on the site.',
    ],
    whatToDo: [
      'Look for the company name and registration number before paying. Both together, not one.',
      'Send one email to the published address before you subscribe and see whether a person answers.',
      'If there is no named entity, treat the payment as one you may not be able to dispute.',
    ],
  },
  {
    slug: 'the-price-that-changes-after-you-are-in',
    title: 'The price that only settles once you are inside',
    summary:
      'The headline figure is monthly-if-you-pay-yearly, exclusive of tax, for the first period only — and none of that is on the button.',
    howItWorks: [
      'A large figure is shown per month, but is only available on an annual commitment charged in full today.',
      'Tax is added at the last step, after the card details are entered.',
      'An introductory rate is described in the same size type as the standing rate, so the two read as one price.',
      'The renewal is at the standing rate, and the difference is not announced.',
    ],
    signs: [
      'The price carries an asterisk, or the words "from", "as low as", or "billed annually".',
      'The total you will actually be charged today is not shown until the final step.',
      'The renewal price is not stated at all.',
    ],
    whatToDo: [
      'Read the total on the final screen, not the figure on the pricing page.',
      'Look specifically for what the second payment will be, and when.',
      'If you cannot find the renewal price before paying, you will find it on the statement.',
    ],
  },
];

export function findArticle(slug: string): TrapArticle | null {
  return TRAP_ARTICLES.find((article) => article.slug === slug) ?? null;
}

/**
 * The note that must accompany the articles.
 *
 * These describe practices, never companies. Saying so plainly is both accurate
 * and the thing that keeps a general warning from reading as an accusation.
 */
export const ARTICLES_NOTE =
  'These describe practices, not companies. Nothing here is an allegation about any named business, and none of it is legal advice. Where money has already been taken, your bank or payment provider is the party who can stop a recurring instruction.';
