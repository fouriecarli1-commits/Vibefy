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
