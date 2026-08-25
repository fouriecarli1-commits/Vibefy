# Supplied artwork

**This directory is currently empty of artwork.** The founder removed the supplied raster files
on 2026-08-25 — a JPEG of the horizontal lockup, and three seal renders that carried a "Made with
AI" watermark burned into the pixels — with the intention of replacing them with vector originals.
Those originals have not arrived yet.

So there is nothing here to derive from, and the geometry in `packages/shared/src/brand.ts` is
currently the only description of the marks that this project holds. Everything in `brand/svg/`,
`brand/png/`, `brand/icons/`, `apps/mobile/assets/` and `apps/web/public/brand/` is written from
it by `pnpm brand:build`, and nothing derived may be "improved" — see PART 0.5 and PART 11 of the
build brief.

That geometry began as a reconstruction of the supplied logo rather than as an original design.
With the supplied file gone there is nothing left to compare it against, which is a real loss and
is why the item stays open in `docs/OPEN_ITEMS.md`: **the first correct vector original that
arrives becomes the authority, and the reconstruction is replaced by it, not reconciled with it.**

The reconstruction is deliberate rather than a shortcut, and stays the right approach even once an
original exists: the badge is served as SVG on every request, and an auto-trace of a gradient
raster produces thousands of noisy paths that render badly at the 96px minimum embed size.

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
