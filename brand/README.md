# VibefyCode brand assets

## What is authoritative

`brand/source/` holds the founder-supplied artwork. It is the authority on what the marks
look like. **Nothing in this repository may redesign, recolour or "improve" them.**

`packages/shared/src/brand.ts` is a clean vector reconstruction of that artwork — the same
forms, proportions and palette, rebuilt as editable paths because the badge is served as SVG
at runtime and an auto-trace of a gradient raster produces thousands of noisy paths that
render badly at the 96px minimum. Everything else in `brand/` is generated from it by
`pnpm brand:build`, and so is the badge served at request time: one geometry source, so the
mark on a customer's site and the mark in our own header cannot drift apart.

> **Open item — `brand/source/` is currently empty.** The VibefyCode logo and stamp were
> supplied as images in conversation rather than as files, so there is nothing here to derive
> from and the masters are reconstructions. See `brand/source/README.md` for what to drop in,
> and for the spelling defect in the supplied stamp that the reconstruction deliberately does
> not reproduce. Tracked in `docs/OPEN_ITEMS.md`.

## What is generated

| Path           | Contents                                                                                                          | Committed      |
| -------------- | ----------------------------------------------------------------------------------------------------------------- | -------------- |
| `brand/svg/`   | Ten SVG masters: mark, mono light/dark, horizontal lockup light/dark, the four badge states and the compact badge | yes            |
| `brand/png/`   | 1x / 2x / 3x raster exports of the mark, badge and lockup                                                         | no — generated |
| `brand/icons/` | Favicons, Apple touch icon, Android Chrome icons, maskable icon                                                   | no — generated |

```bash
pnpm brand:build          # regenerate everything
pnpm check:brand          # assert the masters still obey the usage rules
```

## The four badge states

A badge is never a broken image. Every state renders as a legible mark:

| State       | Renders as                                                                    |
| ----------- | ----------------------------------------------------------------------------- |
| `active`    | The certification mark: shield, check, "Verified by VibefyCode"               |
| `suspended` | Amber ring, barred shield, "Suspended — Not currently verified by VibefyCode" |
| `expired`   | Grey ring, barred shield, "Expired — Not currently verified by VibefyCode"    |
| `revoked`   | Red ring, barred shield, "Revoked — Not currently verified by VibefyCode"     |

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

The wordmark is exactly **"Verified by VibefyCode"**. It is never extended. `pnpm check:copy`
fails the build on any phrase that stretches it, and on absolute words used without a scope
qualifier anywhere in the product's copy.

Permitted: "Verified by VibefyCode", "VibefyCode-assessed", "VibefyCode Rubric v1.0.0 — score 82/100".

## Palette

Defined once in `packages/shared/design/tokens.json` and read by the console, the report PDF
and the badge alike. `pnpm check:contrast` asserts every pair against WCAG 2.2 AA — the teal
is an accent and fails as body text on white, which is why the tokens forbid it there.
