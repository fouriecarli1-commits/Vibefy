# Vibefy brand assets

## What is authoritative

`brand/source/` holds the founder-supplied artwork. It is the authority on what the marks
look like. **Nothing in this repository may redesign, recolour or "improve" them.**

`brand/geometry.mjs` is a clean vector reconstruction of that artwork — the same forms,
proportions and palette, rebuilt as editable paths because the badge is served as SVG at
runtime and an auto-trace of a gradient JPEG produces thousands of noisy paths that render
badly at the 96px minimum. Everything else in `brand/` is generated from it by
`pnpm brand:build`.

> **Open item:** the supplied artwork is 300dpi JPEG. When the original vector files (or the
> wordmark's font licence) are available, the paths in `geometry.mjs` are replaced from them
> and every derivative regenerates unchanged in shape and count. Tracked in
> `docs/OPEN_ITEMS.md`.

## What is generated

| Path | Contents | Committed |
|---|---|---|
| `brand/svg/` | Nine SVG masters: mark, mono light/dark, horizontal lockup light/dark, and the four badge states | yes |
| `brand/png/` | 1x / 2x / 3x raster exports of the mark, badge and lockup | no — generated |
| `brand/icons/` | Favicons, Apple touch icon, Android Chrome icons, maskable icon | no — generated |

```bash
pnpm brand:build          # regenerate everything
pnpm check:brand          # assert the masters still obey the usage rules
```

## The four badge states

A badge is never a broken image. Every state renders as a legible mark:

| State | Renders as |
|---|---|
| `active` | The certification mark: shield, check, "Verified by Vibefy" |
| `suspended` | Amber ring, barred shield, "Suspended — Not currently verified by Vibefy" |
| `expired` | Grey ring, barred shield, "Expired — Not currently verified by Vibefy" |
| `revoked` | Red ring, barred shield, "Revoked — Not currently verified by Vibefy" |

The centred layout of the three inactive states is deliberately different from the active
lockup, so the two are distinguishable at a glance and at thumbnail size.

## Usage rules — enforced, not just documented

These are the same rules the Badge Licence states in words. They are implemented in
`packages/shared/src/badge-usage.ts` and asserted by `tests/badge-usage.test.ts`.

1. **Served from our origin.** The badge is fetched from `verify.<domain>/badge/{id}.svg` on
   every load. It is never a file the customer hosts — rendering it ourselves is what makes
   revocation instant and forgery detectable.
2. **Always a link.** The only supported embed snippet wraps the image in an anchor to that
   app's verification page. A badge that does not link is a claim without evidence, so
   `badgeEmbedSnippet()` cannot produce one.
3. **Minimum 96px**, clear space of 25% of the badge width on every side. The snippet
   refuses a smaller size rather than rendering an illegible mark.
4. **No recolouring, rotation, cropping or alteration of the wordmark.** `check:brand` fails
   the build if any master contains a colour outside the palette.
5. **The alt text carries the scope.** Every embed states the app, the rubric version, the
   assessment date, and that this is a scope-limited assessment rather than a security
   guarantee.

## Language

The wordmark is exactly **"Verified by Vibefy"**. It is never extended. `pnpm check:copy`
fails the build on any phrase that stretches it, and on absolute words used without a scope
qualifier anywhere in the product's copy.

Permitted: "Verified by Vibefy", "Vibefy-assessed", "Vibefy Rubric v1.0.0 — score 82/100".

## Palette

Defined once in `packages/shared/design/tokens.json` and read by the console, the report PDF
and the badge alike. `pnpm check:contrast` asserts every pair against WCAG 2.2 AA — the teal
is an accent and fails as body text on white, which is why the tokens forbid it there.
