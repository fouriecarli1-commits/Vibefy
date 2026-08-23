import { themes } from '@vibefycode/shared';

/**
 * One palette, three surfaces.
 *
 * The colours come from `packages/shared/design/tokens.json`, the same file the
 * console and the report read, so the app cannot drift away from the brand — and
 * the contrast gate that runs in CI covers these pairs too.
 */
export const palette = themes.light;
export const darkPalette = themes.dark;

export const scoreColour = (score: number | null): string => {
  if (score === null) return palette.textMuted;
  if (score >= 75) return palette.success;
  if (score >= 60) return palette.warning;
  return palette.danger;
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radii = { sm: 8, md: 12, lg: 16 } as const;
