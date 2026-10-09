/**
 * Which form fields hold a secret, and therefore which ones we may not invent a
 * value for.
 *
 * `legal/authorisation-to-test.md` and PART 6.2 of the build brief say the same
 * thing from two directions: the owner provisions a synthetic test account, and
 * we never ask for, accept or try anything else. Typing a guessed password into
 * somebody's live sign-in form is unauthorised credential testing — the single
 * act that a signed scope of work exists to put out of bounds — and until this
 * module existed the only thing preventing it was a sentence in the `fill`
 * tool's description.
 *
 * Deciding this from the page rather than from the model's intent is the point.
 * A field is a secret field because of what it is, not because the model said
 * so.
 */

/** Why a field may not be filled with a value of our own choosing. */
export type SecretFieldKind =
  /** A password: fillable only with the exact one the owner provisioned. */
  | 'password'
  /** A one-time code, which nobody provisioned and we cannot be given. */
  | 'code';

/** What `fill` managed to read off the field before deciding. */
export interface FieldIdentity {
  readonly type: string;
  readonly autocomplete: string;
  readonly name: string;
  readonly id: string;
}

/**
 * Name tokens that mean "this holds a secret".
 *
 * Matched as whole tokens after splitting on separators and camel-case
 * boundaries, so `new_password` and `freshPassword` match while `bypass` does
 * not. Compound words people actually write are listed outright rather than
 * reached with a substring test that would catch `bypass` and `tokenise`.
 */
const PASSWORD_TOKENS: ReadonlySet<string> = new Set([
  'password',
  'passwords',
  'passwd',
  'pwd',
  'pass',
  'passphrase',
  'secret',
  'apikey',
  'apisecret',
  'credential',
  'credentials',
]);

const CODE_TOKENS: ReadonlySet<string> = new Set([
  'otp',
  'totp',
  'mfa',
  '2fa',
  'passcode',
  'pincode',
  'pin',
  'onetimecode',
  'verificationcode',
  'authcode',
  'smscode',
  'cvv',
  'cvc',
]);

/** `autocomplete` values the HTML standard reserves for secrets. */
const PASSWORD_AUTOCOMPLETE: ReadonlySet<string> = new Set(['current-password', 'new-password']);
const CODE_AUTOCOMPLETE: ReadonlySet<string> = new Set(['one-time-code', 'cc-csc']);

/** `fieldName` into the words a person would read in it. */
export function fieldTokens(name: string): readonly string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 0);
}

/**
 * The kind of secret this field holds, or null if it holds none.
 *
 * Three sources, because no one of them is always present: `type="password"`
 * is the obvious case; `autocomplete` is the only marker on a one-time-code
 * input, which is `type="text"` by convention; and a name or id is all that is
 * left on the hand-rolled forms this product exists to assess.
 */
export function secretFieldKind(field: FieldIdentity): SecretFieldKind | null {
  if (field.type.toLowerCase() === 'password') return 'password';

  const autocomplete = field.autocomplete
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (autocomplete.some((token) => CODE_AUTOCOMPLETE.has(token))) return 'code';
  if (autocomplete.some((token) => PASSWORD_AUTOCOMPLETE.has(token))) return 'password';

  const tokens = [...fieldTokens(field.name), ...fieldTokens(field.id)];
  if (tokens.some((token) => CODE_TOKENS.has(token))) return 'code';
  if (tokens.some((token) => PASSWORD_TOKENS.has(token))) return 'password';

  return null;
}

/**
 * A fill that did not happen, for the stage to say so in its notes.
 *
 * It carries no value — not the one offered and not the provisioned one. A
 * refusal that quotes what the model typed writes that string into a stored
 * transcript, and a password is exactly the thing the brief forbids us to
 * store.
 */
export interface RefusedCredential {
  readonly selector: string;
  readonly kind: SecretFieldKind;
  readonly because: 'none_provisioned' | 'not_the_provisioned_one' | 'no_code_exists';
}
