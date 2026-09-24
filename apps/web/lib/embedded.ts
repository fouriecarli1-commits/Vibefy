/**
 * The single row of a to-one embed, whichever shape it arrives in.
 *
 * PostgREST returns `organisations (name, is_personal)` on a membership as an
 * *object*, because a membership has one organisation. Supabase's generated
 * types describe it as an array, because the generator reads the foreign key
 * and not the cardinality. So the runtime value and the declared type disagree,
 * and every call site so far has resolved that with
 * `value as unknown as { ... } | null`.
 *
 * A cast is the wrong tool for it. It asserts the object shape and compiles
 * whatever the value actually is, so the day a query is changed to a to-many
 * embed the cast keeps compiling and the code reads `.is_personal` off an
 * array — `undefined`, silently, which for a boolean reads as false. That is
 * the whole class of defect this review keeps finding: a lookup that misses
 * turning into a benign-looking default.
 *
 * This handles both shapes instead of asserting one, so it cannot be wrong
 * about which it got.
 */
export function embedded<T>(value: T | readonly T[] | null | undefined): T | null {
  if (value === null || value === undefined) return null;
  return Array.isArray(value) ? ((value[0] as T | undefined) ?? null) : (value as T);
}
