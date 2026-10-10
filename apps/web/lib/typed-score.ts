/**
 * A number somebody typed into a form, or the reason it is not one.
 *
 * In its own module rather than beside the action that uses it because
 * `actions.ts` carries `'use server'`, and every export from such a file has
 * to be an async server action — so a pure function living there cannot be
 * tested directly, and the only alternative was a test that reads the source.
 */

/**
 * A floor somebody typed, or the reason it is not one.
 *
 * Three answers, because the old two could not be told apart. This returned
 * `number | null`, and `null` meant both "the box was empty, which is a
 * legitimate way to say there is no floor here" and "what you typed is not a
 * score". So `85` in the wrong field, `9O` with a letter O in it, or `120`
 * saved a profile with that floor silently absent — and the notice the person
 * then read says the profile "can fail an application the rubric passed".
 *
 * What that costs is the whole point of the feature. A policy profile is what
 * an organisation measures somebody else's application against before
 * accepting it. A floor that quietly does not exist passes every application,
 * including the ones it was written to stop, and the only record of the
 * mistake is in the memory of whoever typed it.
 */
export type TypedScore = { readonly value: number | null } | { readonly error: string };

export function optionalScore(value: FormDataEntryValue | null, field: string): TypedScore {
  const text = String(value ?? '').trim();
  if (!text) return { value: null };
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) {
    return {
      error: `"${text}" is not a score. Leave ${field} empty if there is no floor for it, or give a number between 0 and 100.`,
    };
  }
  if (parsed < 0 || parsed > 100) {
    return {
      error: `A floor of ${parsed} for ${field} is not possible: scores run from 0 to 100.`,
    };
  }
  return { value: parsed };
}

/** `store_distribution_readiness` is not what somebody typed it into. */
export function readably(dimension: string): string {
  return dimension.replace(/_/g, ' ');
}
