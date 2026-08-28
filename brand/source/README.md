# Supplied artwork

Nine SVG files supplied by the founder on 2026-08-25, replacing the raster artwork removed
earlier the same day. **They are the authority on what the marks look like.** Everything in
`brand/svg/`, `brand/png/`, `brand/icons/`, `apps/mobile/assets/` and `apps/web/public/brand/` is
written from `packages/shared/src/brand.ts` by `pnpm brand:build`, and nothing derived may be
"improved" — see PART 0.5 and PART 11 of the build brief.

Renamed on arrival, because the uploaded filenames carried spaces, export dimensions and a
browser's duplicate suffix. Nothing else about them was touched.

## What is actually inside them

Run `pnpm brand:inspect brand/source/<file>` to reproduce any row of this.

| File                               | The wordmark         | The V mark          | AI provenance |
| ---------------------------------- | -------------------- | ------------------- | ------------- |
| `supplied-wordmark.svg`            | **vector**, outlined | —                   | yes           |
| `supplied-lockup-horizontal.svg`   | **vector**, outlined | raster, 99 KB PNG   | yes           |
| `supplied-lockup-stacked.svg`      | **vector**, outlined | raster, 110 KB PNG  | yes           |
| `supplied-mark.svg`                | —                    | raster, 6 PNGs      | yes           |
| `supplied-mark-black.svg`          | —                    | raster, 145 KB PNG  | yes           |
| `supplied-mark-photographic.svg`   | —                    | raster, 733 KB JPEG | no            |
| `supplied-mark-photographic-2.svg` | —                    | raster, 733 KB JPEG | no            |
| `supplied-lockup-transparent.svg`  | **vector**, outlined | raster, 204 KB PNG  | yes           |
| `supplied-badge.svg`               | —                    | raster, 1087 KB PNG | no            |

So the set is **half vector**, and it is the useful half that is missing.

**The wordmark is real geometry.** Ten outlined letterforms — `VIBEFYCODE` — with curve data, in
the three files that contain words. That is a genuine original, and it is better than what this
project currently draws: `packages/shared/src/wordmark.generated.ts` holds a reconstruction of the
letterforms, and these are the letterforms themselves.

**The mark is not.** In all nine files the V is a placed picture, whatever else surrounds it. The
`<path>` elements that are not letters are clip and mask rectangles — four corners and a close,
carrying no shape. That is what a design tool produces when the artwork was generated as an image
and then positioned on a canvas: exporting as SVG outlines the _text_ and wraps the _picture_, and
both come out of the same menu item, so it looks like it worked.

Getting the mark as geometry needs it drawn as geometry — traced from one of these, or redrawn.
No export setting reaches it, because there is nothing in the source file to export. That trace has
now been done; see the next section.

## The badge: the artwork on the welcome page, generated everywhere else

`supplied-badge.svg` is the founder's trade mark. An earlier note here said it
could not be used at all; that was stated more absolutely than the facts
supported, and it has been reversed.

**The export pill comes off cleanly.** Canva's "Made with AI" label sits in the
top-right corner outside the disc. Measured rather than assumed: in the
artwork's top strip the seal occupies x[372–665] and the pill x[858–1013], with
nothing between them. The crop is expressed in the artwork's own 1024 grid and
`pnpm brand:build` throws if a replacement ever arrives at a different size —
because the failure mode is a watermark shipped on a trust mark.

**And the seal survives scaling.** Good at 256 px, legible at the 96 px the
Badge Licence permits. It is published as `vibefycode-badge-artwork.webp`
(190 KB) and shown at 300 px on the welcome page.

**The issued badge is still generated.** The badge served onto a customer's site
comes from `packages/badge/src/render.ts` on every request, and that is not a
preference: it is what makes a revocation take effect in minutes, and what lets
one badge carry one application's own score and date. Its seal follows the
artwork's composition — arc legend between two stars, mark on a field, banner
ribbon — and since 2026-08-26 its treatment too: a struck metal band on a dark
centre, lit on one edge and shadowed on the other.

So the two are not the same file and are not meant to be. One is the mark being
shown; the other is the mark being issued.

## A compression pass was tried, and rejected

On 2026-08-25 the same nine files were run through an online SVG compressor and re-uploaded. They
were removed again, because the pass did the opposite of what was wanted on all three counts:

|               | Before                                 | After                                                                                   |
| ------------- | -------------------------------------- | --------------------------------------------------------------------------------------- |
| The V mark    | raster PNG                             | raster PNG, **byte for byte the same**                                                  |
| The wordmark  | 10 outlined letterforms, smooth curves | merged and **flattened into polygons** — the `O` in `CODE` renders as a visible decagon |
| AI provenance | present                                | **still present**, in six of the seven                                                  |

A compressor shrinks bytes. It cannot turn a picture into shapes, so the payload it could not help
with was left alone, and the only real geometry in the files — the letterforms — was the one thing
it could reduce, so that is what it reduced. `net woorde` went from 36.6 KB to 30.0 KB, and the
6.6 KB was paid for out of the curves.

Worth writing down because the failure is invisible at reading size. The damage shows at about 4×,
which is a size nobody checks and every printed banner exceeds.

The uncompressed originals in this directory are the authority and were never replaced.

## The trace, and where it is used

Not supplied. **Derived**, which is what PART 0.5 asks for: same forms, same
proportions, no redesign. `supplied-mark-black.svg` carries a 1600×1472
single-channel silhouette — pure black and white, no gradient, clean edges, and
the ribbon's weave drawn as gaps — and that is the one input a contour tracer
handles well. Eighteen contours of real curve data: the woven ribbon, the arrow,
six circuit traces with their dots, and three bars.

```bash
pip install potracer pillow
node tools/build-mark-outline.mjs      # → packages/shared/src/mark-outline.generated.ts
```

The tracer is a prerequisite of that script and not of the build. It runs once
per supplied mark; `pnpm brand:build` never needs it, which matters because the
build also runs on Vercel where no Python tracer exists. A test asserts the
separation.

**It is used for the two single-colour masters and nowhere else.** A silhouette
is exactly what a trace produces well and exactly what a mono mark is, so
nothing is lost there — and the 21 KB is affordable for a master somebody
downloads once, where it would not be on a badge served on every page load.

**The colour mark stays drawn.** This was tried the other way first. Segmenting
the coloured artwork by hue gives clean regions — teal-to-blue ribbon, orange
arrow, grey furniture — and traces to a tidy 8 KB, but the ribbon's overlap is
carried by continuous _shading_ rather than by a colour boundary, so the two
arms flatten into one solid shape and the weave disappears. The V survives; the
character does not. Hence the split, rather than one file doing both jobs
badly.

## `traced-mark.svg` — the flat silhouette, kept as filed

The raw trace before it was fitted to the shared 512 box: eighteen contours, one
fill, no palette. Kept because it is the artefact the mono masters are built
from, and because it is the file to hand a designer who asks what the mark looks
like as geometry.

## What a usable original looks like

This is the specification to hand to a designer, or to check an export against. One file in the
first row closes the open item; the rest are conveniences.

| What                    | Format              | Size                       | Why                                                                                          |
| ----------------------- | ------------------- | -------------------------- | -------------------------------------------------------------------------------------------- |
| **The mark alone**      | `.svg`, real paths  | Any — a vector has no size | The one file that matters. Everything else is generated from it.                             |
| The horizontal lockup   | `.svg`, real paths  | Any                        | Mark plus wordmark, as it appears in the site header.                                        |
| Fallback raster of each | `.png`, transparent | 2048 px on the long edge   | For the two places a vector is not accepted — some app store listings, some social profiles. |

Requirements, all of them checkable with `pnpm brand:inspect`:

1. **Real geometry.** `<path>`, `<circle>`, `<polygon>` — not `<image>` with a base64 payload.
   A raster inside an `.svg` wrapper is still a raster.
2. **Text converted to outlines.** A `<text>` element renders in whatever font the viewer's
   machine happens to have, which on somebody else's website is not the font you chose.
3. **No AI-generation metadata.** No C2PA manifest, no `<ContainsAiGeneratedContent>`, and no
   watermark burned into the pixels. A trust mark cannot carry a third party's provenance claim
   about itself.
4. **Flat colour, no effects.** No gradients that need three hundred stops, no drop shadows, no
   bevels. The badge is rendered as SVG on every request at sizes down to 96 px; effects do not
   survive that and cost bytes on every load.
5. **Transparent background.** No white rectangle behind the artwork — the mark sits on a dark
   surface in this product and on whatever a customer chooses on theirs.

Most design tools can produce this. The instruction to give is: _"export as SVG, with text
converted to outlines and no embedded images."_ If the result fails `pnpm brand:inspect`, the
tool exported a picture and the option was missed.

## If you replace the logo

Drop the new file in as `vibefycode-logo-horizontal.*`, update the paths in
`packages/shared/src/brand.ts` to match, then:

```bash
pnpm brand:build     # regenerates every derivative from that one source
pnpm check:brand     # masters present, palette clean, wordmark intact
pnpm verify          # everything else
```

Then look at the result — the gate checks correctness, not whether it looks right. Render the seal
at 512px and the compact badge at 96px; they are different artwork for a reason. `docs/RUNBOOK.md`
has the one-liner.

## Uploading it through the GitHub website

The founder does this from a browser rather than from a checkout, and a web upload has one step
that is easy to miss — the files sit in a staging area until a commit is made, and closing the tab
discards them silently.

1. Open the repository and navigate into `brand/source/`.
2. **Add file** → **Upload files** (top right, next to the green Code button).
3. Drag the files in, or use **choose your files**.
4. **Scroll down.** There is a box with a short message in it and a green **Commit changes**
   button below it. Nothing is saved until that button is clicked.
5. Leave **"Commit directly to the `main` branch"** selected, and click **Commit changes**.

The file list should then show what was uploaded. If it does not, step 4 did not happen.

Then check what actually arrived, because an `.svg` from a design tool is often a picture in a
vector envelope rather than a vector:

```bash
pnpm brand:inspect brand/source/<the-file>.svg
```
