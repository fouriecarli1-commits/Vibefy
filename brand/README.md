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

> **Open item — there is still no vector original.** `brand/source/` holds the supplied logo
> as a raster image, which is the authority on what the mark looks like but cannot be scaled
> or edited as geometry. The masters in `brand/svg/` are therefore a reconstruction. See
> `brand/source/README.md` for what to drop in when a vector original exists, and
> **"Is that file really a vector?"** below for how to tell before you rely on one. Tracked in
> `docs/OPEN_ITEMS.md`.

## Is that file really a vector?

A design tool will hand you `logo.svg` whether it contains shapes or a photograph. Both open,
both preview, and they are indistinguishable in a file browser. The difference only shows up
later — on a printed banner, or at 16 pixels in a browser tab — which is the worst time to
find out.

```bash
pnpm brand:inspect path/to/logo.svg
```

It reports three things and then gives a verdict:

| It looks for                                | Because                                                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `<path>` elements with shape data           | This is the geometry. No geometry, no vector — regardless of the file extension.                                            |
| An embedded `<image>` with a base64 payload | A picture hidden inside the envelope. It will blur when scaled past its export size.                                        |
| AI-generation provenance                    | A C2PA manifest or `<ContainsAiGeneratedContent>`. A trust mark cannot carry somebody else's watermark or provenance claim. |

By hand, the same check takes ten seconds: open the file in a plain text editor. If you see
`<path d="M136 104 C164 212 …">`, it is a vector. If all you see is
`<image xlink:href="data:image/png;base64,` followed by thousands of characters, it is a
picture in an envelope.

`tests/svg-inspection.test.ts` runs the inspector over every master in `brand/svg/`, so a
wrapped raster cannot quietly become one of the marks we ship.

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
