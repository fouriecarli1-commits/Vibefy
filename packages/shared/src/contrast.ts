/**
 * WCAG 2.2 contrast, in one place.
 *
 * This is used by two things that must not disagree: the build gate that refuses
 * a palette failing AA, and the report renderer that decides whether an agency's
 * chosen accent colour is legible enough to use. Two copies of this arithmetic
 * would eventually let a colour pass one and fail the other.
 */
export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`Not a 6-digit hex colour: ${hex}`);
  const digits = match[1]!;
  const channels = [0, 2, 4].map((index) => parseInt(digits.slice(index, index + 2), 16) / 255);
  const linear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return (
    0.2126 * linear(channels[0]!) + 0.7152 * linear(channels[1]!) + 0.0722 * linear(channels[2]!)
  );
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [high, low] = a > b ? [a, b] : [b, a];
  return (high + 0.05) / (low + 0.05);
}

/** AA for normal body text. */
export const AA_TEXT = 4.5;
/** AA for large text and for the non-text parts of a control. */
export const AA_LARGE = 3;

/**
 * Returns the colour if it is legible on the given background, or the fallback
 * if it is not.
 *
 * Used where the colour is somebody else's choice — an agency's brand accent on
 * a white-label report. We will show their colour; we will not ship a document
 * that fails the standard we score other people against.
 */
export function legibleOr(
  colour: string | null | undefined,
  background: string,
  fallback: string,
  minimum: number = AA_LARGE,
): string {
  if (!colour) return fallback;
  try {
    return contrastRatio(colour, background) >= minimum ? colour : fallback;
  } catch {
    return fallback;
  }
}
