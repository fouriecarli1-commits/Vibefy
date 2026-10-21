/**
 * Which application is waiting on me, and which is waiting on them.
 *
 * The console listed every application the same way: a name, an address and a
 * screening chip. One that was authorised and ready to assess looked exactly
 * like one still waiting for DNS to propagate — and the action everybody comes
 * here for was section four of a thousand-line page, under authorisation and
 * above the badge licence, monitoring, the directory listing and policy
 * profiles. The founder, on 2026-10-21: "ek kan byvoorbeeld nie mooi sien waar
 * om 'n application te launch nie."
 *
 * Nothing here changes what the product allows. Every state below already
 * decides something — `decideAssessmentRequest` refuses a run without a
 * verified authorisation, the screening sweep holds a submission until a person
 * clears it — and all of it was legible only by reading the page that enforces
 * it.
 *
 * What is worth pinning down is the order, because getting it wrong gives
 * somebody instructions for a step they cannot take: a DNS record to publish
 * for an application we have already refused, or an assessment to request for
 * one whose authorisation lapsed last week.
 */
import { describe, expect, it } from 'vitest';
import { whatComesNext, type AppState } from '../apps/web/lib/what-comes-next.ts';

const state = (over: Partial<AppState> = {}): AppState => ({
  appId: 'app-1',
  screening: 'cleared',
  authorisation: 'verified',
  authorisedForTesting: true,
  openRequest: null,
  latestAssessment: null,
  latestAssessmentId: null,
  ...over,
});

describe('the step an application is actually on', () => {
  it('asks for the assessment when everything is in place', () => {
    const next = whatComesNext(state());
    expect(next.id).toBe('assess');
    expect(next.yours).toBe(true);
    // The link lands on the section rather than on the page: the point of the
    // whole exercise is not having to find it.
    expect(next.href).toBe('/console/apps/app-1#assessment');
  });

  it('sends somebody to the authorisation before the assessment', () => {
    expect(whatComesNext(state({ authorisation: null, authorisedForTesting: false })).id).toBe(
      'authorise',
    );
    expect(whatComesNext(state({ authorisation: 'pending', authorisedForTesting: false })).id).toBe(
      'verify',
    );
  });

  it('treats a lapsed authorisation as one to prove again', () => {
    // `app_is_authorised_for_testing` is the gate, and it says no for an
    // expired record as readily as for an unverified one. Both are answered by
    // the same screen, and telling somebody to request an assessment instead
    // would send them into a refusal.
    const next = whatComesNext(state({ authorisation: 'expired', authorisedForTesting: false }));
    expect(next.id).toBe('verify');
    expect(next.what).toMatch(/lapsed/i);
  });

  it('says nothing is needed while a person is looking at it', () => {
    for (const screening of ['pending', 'in_review']) {
      const next = whatComesNext(state({ screening }));
      expect(next.id, screening).toBe('screening');
      expect(next.yours, screening).toBe(false);
      expect(next.href, screening).toBeNull();
    }
  });

  it('does not offer a next step to an application that was refused', () => {
    const next = whatComesNext(state({ screening: 'refused' }));
    expect(next.id).toBe('refused');
    expect(next.what).toMatch(/appeal/i);
    expect(next.what, 're-submitting is what this exists to stop').toMatch(/re-submitting is not/);
  });

  it('puts screening before authorisation, because a refusal is never authorised', () => {
    // Order, not preference. An application refused under the policy must never
    // be told to publish a DNS record.
    const refusedButAuthorised = whatComesNext(
      state({ screening: 'refused', authorisation: 'verified', authorisedForTesting: true }),
    );
    expect(refusedButAuthorised.id).toBe('refused');
  });

  it('says a run is under way rather than offering another', () => {
    expect(whatComesNext(state({ openRequest: 'queued' })).id).toBe('running');
    expect(whatComesNext(state({ openRequest: 'claimed' })).id).toBe('running');
    expect(whatComesNext(state({ latestAssessment: 'running' })).id).toBe('running');
    expect(whatComesNext(state({ openRequest: 'queued' })).yours).toBe(false);
  });

  it('separates waiting on a reviewer from waiting on nothing', () => {
    const next = whatComesNext(state({ latestAssessment: 'awaiting_review' }));
    expect(next.id).toBe('review');
    expect(next.yours).toBe(false);
    // The sentence that makes the wait make sense rather than look like a
    // product that has stopped.
    expect(next.what).toMatch(/before a person has looked/i);
  });

  it('points at the report once there is one', () => {
    for (const status of ['approved', 'published']) {
      const next = whatComesNext(
        state({ latestAssessment: status, latestAssessmentId: 'assessment-9' }),
      );
      expect(next.id, status).toBe('report');
      expect(next.href, status).toBe('/console/reports/assessment-9');
    }
  });

  it('asks again after a run that failed, rather than leaving a dead end', () => {
    for (const status of ['failed', 'rejected']) {
      expect(whatComesNext(state({ latestAssessment: status })).id, status).toBe('assess');
    }
  });

  it('does not repeat the plan rules it cannot keep in step with', () => {
    /*
     * The free tier's ninety-day cooldown, an inactive subscription, the
     * three-application limit: `decideAssessmentRequest` owns all of it and
     * answers with a sentence when the button is pressed. A second copy here
     * would be a second rule, and the two would disagree the day either moved.
     */
    const next = whatComesNext(state({ latestAssessment: 'published', latestAssessmentId: null }));
    expect(next.id).toBe('assess');
  });
});
