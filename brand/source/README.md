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

## `traced-mark.svg` — the mark as geometry, at last

Not supplied. **Derived**, which is what PART 0.5 asks for: same forms, same proportions, no
redesign. `supplied-mark-black.svg` carries a 1600×1472 single-channel silhouette of the mark —
pure black and white, no gradient, clean edges — and that is the one input a contour tracer handles
well. The result is eighteen paths of real curve data: the woven ribbon, the arrow, the circuit
traces and the bar chart, in the arrangement the supplied artwork draws them.

It is reproduced by extracting that silhouette from the base64 `<image>` inside
`supplied-mark-black.svg`, running `potrace` over it at `turdsize=8, alphamax=1.0,
opttolerance=0.2`, and discarding the first traced curve — potrace reads the canvas frame as
foreground, which inverts the whole image if it is kept. The tracer is installed for the job and
not added to the toolchain: this runs once per supplied mark, not once per build.

Two things it is not, and both matter before anything adopts it:

1. **It is 21 KB where the current geometry is 2 KB.** The badge is served as SVG on every request,
   from our origin, on somebody else's page. Ten times the bytes on every load is a real cost.
2. **The circuit traces become noise below about 64 px.** At the 96 px the Badge Licence permits it
   holds; at favicon sizes the hand-authored geometry in `packages/shared/src/brand.ts` reads better
   because it draws less.

So adopting it is a decision with a trade-off in it, not a straight upgrade, and it is recorded
here rather than made silently. The likely answer is both: the trace for large renders, the simpler
geometry for icons.

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
