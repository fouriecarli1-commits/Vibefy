'use client';

/**
 * A page in the console that did not render.
 *
 * What a visitor saw before this existed was Next's own page: a white screen,
 * a triangle, "This page couldn't load — a server error occurred", and a Reload
 * button. It is not our wording, it says nothing about whose fault it is, and
 * it gives somebody reporting the problem nothing to report. The founder sent a
 * screenshot of exactly that on 2026-10-21 for `/console/apps/new`, and the one
 * fact that would have identified the failure — the digest Next writes into the
 * server log beside the stack — was on the screen she could not see.
 *
 * So the digest is printed. It is a hash of the error, not its message: it
 * names nothing about this deployment and is useless to anybody who cannot
 * already read our logs, which is what makes it safe to show and worth showing.
 */
export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">This page did not load</h1>
      <p className="text-muted">
        Something failed on our side while building it. Nothing you did caused it and nothing of
        yours has changed — the failure is recorded with the reference below.
      </p>
      {error.digest && (
        <p className="text-sm">
          Reference: <code>{error.digest}</code>
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="button" onClick={reset}>
          Try again
        </button>
        <a className="nav-cta" href="/console">
          Back to the console
        </a>
      </div>
      <p className="text-sm text-muted">
        If it keeps happening, send us that reference. It is what ties this page to the one line in
        our log that says what went wrong.
      </p>
    </div>
  );
}
