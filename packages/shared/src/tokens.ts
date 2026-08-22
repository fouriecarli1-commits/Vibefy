/**
 * Design tokens, typed.
 *
 * The console, the report PDF and the badge SVG all read this module, so the
 * three cannot drift apart. The JSON file beside it is the single source of
 * truth and is the file the contrast gate checks — never hardcode a hex value
 * anywhere else in the codebase.
 */
import tokens from '../design/tokens.json' with { type: 'json' };

export type ThemeName = 'light' | 'dark';
export type BadgeStatusName = 'active' | 'suspended' | 'expired' | 'revoked';

export type SemanticTokens = (typeof tokens)['semantic']['light'];
export type BrandTokens = (typeof tokens)['brand'];

export const brand: BrandTokens = tokens.brand;
export const gradient = tokens.gradient;
export const badgeStatusColours = tokens.badgeStatus;

export const themes: Record<ThemeName, SemanticTokens> = {
  light: tokens.semantic.light,
  dark: tokens.semantic.dark,
};

/** CSS custom properties for a theme, ready to inject into a stylesheet or an SVG. */
export function cssVariables(theme: ThemeName): Record<string, string> {
  const entries = Object.entries(themes[theme]).map(([key, value]) => [
    `--vibefy-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
    value,
  ]);
  const brandEntries = Object.entries(brand).map(([key, value]) => [`--vibefy-${key}`, value]);
  return Object.fromEntries([...brandEntries, ...entries]);
}

export function cssVariableBlock(theme: ThemeName, selector = ':root'): string {
  const declarations = Object.entries(cssVariables(theme))
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  return `${selector} {\n${declarations}\n}`;
}
