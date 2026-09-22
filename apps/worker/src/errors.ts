/**
 * Failures a second attempt cannot change.
 *
 * A base class rather than a list somebody has to remember to extend. The list
 * was in `main.ts` — `!(error instanceof NotAuthorisedError) && isRetryableFailure(error)` —
 * and it named one of the three: an authorisation withdrawn mid-run and a
 * finding citing evidence the run did not store were both classed retryable,
 * so a request that had already been paid for went back to the queue to reach
 * the same wall again.
 *
 * Postgres classes are still read separately, in `queue.ts`, because those
 * arrive from a driver rather than from us.
 */
export class UnretryableError extends Error {}
