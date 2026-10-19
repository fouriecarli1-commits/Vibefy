import { whyTheDatabaseRefused } from './connection-string.ts';
import { sayItAgain } from './said-recently.ts';

/**
 * One line for a read that failed and a page that carried on without it.
 *
 * Every public page here is built to degrade rather than break, and each of
 * those decisions is written down beside the code that makes it: three answers
 * instead of two on `/verify`, so a failed read is not an accusation of fraud;
 * three on `/a/[slug]`, so a database blip does not quietly remove the
 * plain-language answers and leave the score standing alone; a grey frame from
 * the badge image rather than a broken picture on a customer's website.
 *
 * All of that is right, and all of it is invisible. A page that degrades
 * silently is indistinguishable, from the outside, from a page that is working
 * — which is how this product spent a week with every badge grey. The reasoning
 * was done per page, so the logging was too, and three of four sites ended up
 * with a comment saying the failure is "ours to read in the logs" above a catch
 * that wrote nothing.
 *
 * So the saying is one function. It takes what could not be done as a verb
 * phrase, and it requires `shown`: what the visitor got instead. Without that
 * the line says a read failed and leaves the reader of the log to guess whether
 * anybody noticed, which is the question they actually have.
 *
 * Once a minute per subject and message, for the reason `said-recently.ts`
 * gives: these states last for days across every impression of every embed, and
 * a line per pageview buries the one line that matters under the traffic it is
 * measuring.
 */
export interface WhatTheReaderGot {
  /** What the page rendered instead, in words a person would use. */
  readonly shown: string;
  readonly [key: string]: unknown;
}

export function couldNot(subject: string, got: WhatTheReaderGot, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  if (!sayItAgain(`could-not:${subject}:${detail}`)) return;
  // The explanation travels beside the message rather than replacing it: a
  // tripped pooler breaker reads exactly like our own bad password and is not
  // one, and the original is what somebody will search for.
  const means = whyTheDatabaseRefused(detail);
  console.error(`could not ${subject}`, {
    ...got,
    error: detail,
    ...(means === null ? {} : { means }),
  });
}
