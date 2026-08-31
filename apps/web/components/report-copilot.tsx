'use client';

import { useRef, useState } from 'react';

/**
 * The assistant, beside the report.
 *
 * Deliberately plain: a transcript, a box, a button. What makes it useful is
 * not the interface but what sits behind it — it has been handed this
 * assessment and nothing else, and it is not permitted to revise it, predict
 * the next one, or sell anything.
 *
 * Those limits are stated on the panel rather than buried in a policy. Somebody
 * who asks "will this fix my score" and gets a straight refusal should already
 * know why, or the refusal reads as the product being evasive.
 */

interface Turn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly withheld?: boolean;
}

const SUGGESTIONS = [
  'Explain my highest-severity finding in plain language.',
  'What does my score actually mean?',
  'Help me put the badge on my site.',
  'What was not tested?',
];

export function ReportCopilot({ assessmentId }: { assessmentId: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transcript = useRef<HTMLDivElement>(null);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || pending) return;

    const next: Turn[] = [...turns, { role: 'user', content: trimmed }];
    setTurns(next);
    setDraft('');
    setPending(true);
    setError(null);

    try {
      const response = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          assessmentId,
          messages: next.map((turn) => ({ role: turn.role, content: turn.content })),
        }),
      });
      const data = (await response.json()) as {
        reply?: string;
        withheld?: boolean;
        ceilingReached?: boolean;
        error?: string;
      };
      // A workspace that has used its hour still gets a sentence rather than an
      // error: being told the limit is ours, not theirs, is the difference
      // between a boundary and a fault.
      if (!response.ok && !data.ceilingReached) {
        setError(data.error ?? 'The assistant could not answer just now.');
        return;
      }
      if (!data.reply) {
        setError('The assistant could not answer just now.');
        return;
      }
      setTurns((current) => [
        ...current,
        {
          role: 'assistant',
          content: data.reply!,
          ...(data.withheld || data.ceilingReached ? { withheld: true } : {}),
        },
      ]);
    } catch {
      setError('The assistant could not be reached. Check your connection and try again.');
    } finally {
      setPending(false);
      // After the state settles, so the newest turn is what lands in view.
      requestAnimationFrame(() => {
        transcript.current?.scrollTo({ top: transcript.current.scrollHeight });
      });
    }
  }

  return (
    <section aria-labelledby="copilot" className="space-y-4 rounded-xl border border-line p-6">
      <div>
        <h2 id="copilot" className="text-xl font-semibold">
          Ask about this assessment
        </h2>
        <p className="mt-2 max-w-prose text-sm text-muted">
          It has been given this assessment and nothing else — your findings, your scope statement,
          your badge snippet. It explains what was found and helps you place the badge. It cannot
          change a finding or a score, and it will not tell you what the next assessment will say:
          that is decided by the run, not by us in conversation.
        </p>
        {/* Said here rather than in a policy, because somebody who assumes a
            transcript exists will ask us for it later — and because "we keep
            nothing" is a claim worth making where it can be checked against
            what the page then does. */}
        <p className="mt-2 max-w-prose text-sm text-muted">
          Nothing you type here is stored. The conversation lives in this browser tab for as long as
          it is open and is never written down on our side, so leaving the page ends it — copy
          anything you want to keep.
        </p>
      </div>

      {turns.length > 0 && (
        <div
          ref={transcript}
          className="max-h-96 space-y-4 overflow-y-auto rounded-lg border border-line bg-surface-muted p-4"
          role="log"
          aria-live="polite"
          aria-label="Conversation"
        >
          {turns.map((turn, index) => (
            <div key={index} className={turn.role === 'user' ? 'text-sm' : 'text-sm'}>
              <p className="font-medium">{turn.role === 'user' ? 'You' : 'VibefyCode'}</p>
              <p className={`mt-1 whitespace-pre-wrap ${turn.withheld ? 'text-warn' : ''}`}>
                {turn.content}
              </p>
            </div>
          ))}
          {pending && (
            <p className="text-sm text-muted" role="status">
              Thinking…
            </p>
          )}
        </div>
      )}

      {turns.length === 0 && (
        <ul className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                onClick={() => void ask(suggestion)}
                className="rounded-lg border border-line px-3 py-2 text-left text-sm"
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask(draft);
        }}
        className="space-y-3"
      >
        <label htmlFor="copilot-question" className="text-sm font-medium">
          Your question
        </label>
        <textarea
          id="copilot-question"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, shift+enter breaks the line. A textarea that only
            // submits from the button costs a click on every question.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void ask(draft);
            }
          }}
          rows={3}
          className="w-full rounded-lg border border-line bg-surface p-3 text-sm"
          placeholder="Ask about a finding, the score, or getting the badge onto your site."
        />
        <button
          type="submit"
          disabled={pending || draft.trim().length === 0}
          className="rounded-lg bg-accent px-4 py-3 font-medium text-on-accent disabled:opacity-60"
        >
          {pending ? 'Asking…' : 'Ask'}
        </button>

        <div role="status" aria-live="polite" className="min-h-6 text-sm">
          {error && <p className="text-bad">{error}</p>}
        </div>
      </form>
    </section>
  );
}
