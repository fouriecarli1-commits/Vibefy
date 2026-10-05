/**
 * What the builder's own check says when there was no application to look at.
 *
 * Two faults, one shape. The preflight check answers seven questions from one
 * response, and both of these are about it answering them anyway when the
 * response was not the thing it was asked about.
 *
 * The first: a server that answers 404 serves a page, and that page has no
 * title, no description, no viewport and no language — because it is the
 * hosting platform's error page, not the application. Every one of those came
 * back as a finding about the builder's application, with a fix to go and
 * apply, when the single true finding was that the address does not work. Six
 * wrong things to fix teaches somebody to stop running the tool.
 *
 * The second: every failure to fetch produced "That address could not be
 * opened: <message>", including a `TypeError` thrown inside this package. The
 * consumer check beside this one was corrected for exactly that — a fault of
 * ours is not a finding about somebody's site — and the builder-facing one was
 * left saying it.
 */
import { describe, expect, it } from 'vitest';
import { TrustCheckInputError } from '../packages/trustcheck/src/types.ts';
import {
  preflightItems,
  preflightReport,
  preflightUnreachable,
  type FetchedPage,
} from '../packages/trustcheck/src/index.ts';

/** A hosting platform's 404: a real page, and nothing to do with the app. */
const notFoundPage: FetchedPage = {
  finalUrl: 'https://my-app.example/',
  status: 404,
  headers: {},
  html: '<!doctype html><html><body><h1>404: NOT_FOUND</h1></body></html>',
  redirected: false,
};

describe('a 404 is one finding, not seven', () => {
  const items = preflightItems(notFoundPage, 'https://my-app.example/');

  it('says the address does not work', () => {
    const answers = items.find((entry) => entry.id === 'answers');
    expect(answers?.outcome).toBe('missing');
    expect(answers?.detail).toMatch(/404/);
  });

  it('asks nothing else about a page that is not the application', () => {
    // The error page genuinely has no title, no description, no viewport and
    // no language. Reporting those is reporting the hosting platform's page
    // as if it were theirs.
    expect(items.map((entry) => entry.id)).toEqual(['answers']);
  });

  it('counts one thing to fix rather than six', () => {
    expect(items.filter((entry) => entry.outcome === 'missing')).toHaveLength(1);
  });

  it('does not restate the stranger-facing questions from an error page', () => {
    // `runChecks` reads the same bytes, so the borrowed questions would have
    // answered "no cancellation link" about the hosting platform's 404. The
    // whole report is assembled here rather than in `runPreflight`, so that
    // this is a thing a test can hold.
    expect(preflightReport(notFoundPage, 'https://my-app.example/').map((entry) => entry.id)).toEqual([
      'answers',
    ]);
  });
});

describe('a fault of ours, in the builder-facing check too', () => {
  it('does not call our own bug a problem with their address', () => {
    // The old sentence was "That address could not be opened: <message>" for
    // every failure, which hands our own stack trace to a builder as a fact
    // about their application.
    const said = preflightUnreachable(new Error('observations is not iterable'));
    expect(said).toMatch(/fault of ours/i);
    expect(said).not.toMatch(/that address could not be opened/i);
  });

  it('still says what a timeout was', () => {
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    expect(preflightUnreachable(timeout)).toMatch(/did not answer in time/i);
  });

  it('keeps an input refusal in the words written for the person', () => {
    // `normaliseUrl` refuses with a sentence somebody can act on. Wrapping it
    // in "something went wrong on our side" would lose that.
    const refusal = new TrustCheckInputError('That address is too long to be real.');
    expect(preflightUnreachable(refusal)).toBe('That address is too long to be real.');
  });
});
