'use client';

import { useActionState } from 'react';
import type { ActionState } from '@/app/console/apps/actions';

/**
 * A form bound to a server action, with the pending state and the result
 * announced to assistive technology rather than only shown. Everything the
 * console submits goes through one of these, so error handling looks the same
 * everywhere and cannot be forgotten on a new form.
 */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel,
  children,
  destructive = false,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  pendingLabel?: string;
  children: React.ReactNode;
  destructive?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-4">
      {children}
      <button
        type="submit"
        disabled={pending}
        className={`rounded-lg px-4 py-2.5 font-medium disabled:opacity-60 ${
          destructive ? 'border border-line-strong text-bad' : 'bg-accent text-white'
        }`}
      >
        {pending ? (pendingLabel ?? 'Working…') : submitLabel}
      </button>

      <div role="status" aria-live="polite" className="min-h-6 text-sm">
        {state.error && <p className="text-bad">{state.error}</p>}
        {state.notice && <p className="text-ok">{state.notice}</p>}
      </div>
    </form>
  );
}

export function Field({
  label,
  name,
  hint,
  type = 'text',
  required = false,
  defaultValue,
  placeholder,
  multiline = false,
}: {
  label: string;
  name: string;
  hint?: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  multiline?: boolean;
}) {
  const id = `field-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const shared = {
    id,
    name,
    required,
    defaultValue,
    placeholder,
    'aria-describedby': hintId,
    className: 'w-full rounded-lg border border-line-strong bg-surface px-3 py-2',
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {multiline ? <textarea {...shared} rows={4} /> : <input {...shared} type={type} />}
      {hint && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

export function Checkbox({
  label,
  name,
  hint,
  defaultChecked = false,
}: {
  label: string;
  name: string;
  hint?: string;
  defaultChecked?: boolean;
}) {
  const id = `field-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex gap-3">
      <input
        id={id}
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked}
        aria-describedby={hintId}
        className="mt-1.5 size-4"
      />
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {hint && (
          <p id={hintId} className="text-sm text-muted">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
