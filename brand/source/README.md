# Supplied artwork

**`vibefycode-logo-horizontal.jpg` is the authority.** Everything in `brand/svg/`, `brand/png/`,
`brand/icons/`, `apps/mobile/assets/` and `apps/web/public/brand/` is derived from it by
`pnpm brand:build`, and nothing derived may be "improved" — see PART 0.5 and PART 11 of the build
brief.

The vector masters are a clean reconstruction of it: same forms, same palette, same proportions,
rebuilt as editable geometry in `packages/shared/src/brand.ts`. That is deliberate rather than a
shortcut — the badge is served as SVG on every request, and an auto-trace of a gradient raster
produces thousands of noisy paths that render badly at the 96px minimum embed size.

## `reference/` — composition only, never derived from

Three seal designs, kept because the badge's **composition** follows them: the arc legend above,
the banner ribbon carrying the wordmark below, the stars, the fan base.

They are not artwork sources, for three reasons, and none of them is fixable by editing:

1. **Each has "Made with AI" burned into the pixels**, top right. A trust mark cannot carry a
   third-party watermark.
2. **The badge is generated as SVG on every request.** That is the whole revocation mechanism —
   no file exists for a customer to cache, so a suspended badge stops reading as verified within
   minutes. Chrome bevels, lens flares, bokeh and photographic circuit texture do not survive
   vectorisation.
3. **They would not survive the size they are licensed at.** The Badge Licence permits embedding
   from 96px. At 96px these read as a grey smudge; the flat vector seal reads as a seal.

They also draw a different V from the logo. The mark in `brand/svg/` follows the **logo**, because
a badge and a website that disagree about the same mark is precisely what PART 0.5 exists to
prevent.

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
