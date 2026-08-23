# Supplied artwork

**These files are the authority.** Everything in `brand/svg/`, `brand/png/`, `brand/icons/` and
`apps/web/public/brand/` is derived from them by `pnpm brand:build`, and nothing derived may be
"improved" — see PART 0.5 and PART 11 of the build brief.

## What is missing

The VibefyCode logo and stamp were supplied as images in conversation rather than as files, so
they are not here yet. The vector masters in `brand/svg/` are reconstructions from those images:
same forms, same palette, same proportions, rebuilt as clean geometry.

**Drop the real files in here** — vector originals if they exist, otherwise the highest-resolution
raster you have — named:

| File | What it is |
| --- | --- |
| `vibefycode-logo-horizontal.*` | The V mark with the rising arrow, circuit traces and the VIBEFYCODE wordmark |
| `vibefycode-badge-verified.*` | The round "Verified by VibefyCode" stamp |

Then re-derive the masters against them and check the reconstruction. This is registered in
`docs/OPEN_ITEMS.md` and will not disappear from that list on its own.

## One thing to fix in the supplied stamp

The outer arc of the supplied stamp image reads **"VERIFIED BY VIBFCODE"** — the E is missing from
VIBEFYCODE — and a second, ghosted "VERIFIED BY" overlaps it at a different angle. The
reconstruction here spells the wordmark correctly and carries the arc once, because a trust mark
with a typo in its own name is worse than no trust mark. If the supplied file is regenerated,
check that arc before anything is derived from it.

## Superseded

<!-- vibefycode-copy-lint-allow-block: naming the previous brand is the whole point of this line -->

`superseded/` holds the previous Vibefy artwork, kept for reference. Nothing derives from it.

<!-- vibefycode-copy-lint-allow-block-end -->
