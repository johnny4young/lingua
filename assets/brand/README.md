# Lingua brand assets

Every SVG here, the app icons in `assets/` and the favicons are written by
`scripts/brand/generate-brand-assets.mjs`. Don't edit them by hand.

| File | Use |
| --- | --- |
| `wordmark.svg` | Wordmark for light grounds: Ink letters, pulse dot |
| `wordmark-inverse.svg` | Wordmark for Ink grounds: Paper letters, pulse dot |
| `wordmark-mono.svg` | One colour (`currentColor`), for pulse grounds, print and embossing |
| `mark-mono.svg` | One-colour mark (`currentColor`), for tray templates, print and watermarks |
| `../icon.svg` | Master app icon, macOS squircle |
| `../../public/favicon.svg` | Lite mark, browser tab |

The generator also writes the website's copies: the four SVGs above and the
1024 px icon into `website/public/press/` (linked from the press page and
bundled in its ZIP), the inverse wordmark for the social cards, and a
`currentColor` wordmark with a pulse dot for the site header and footer
(`website/src/assets/brand/wordmark.svg`).

## Wordmark

Fraunces Italic, weight 520, optical size 144, SOFT 100, WONK 1, tracking −1 %,
always lower case. The i is set dotless and the dot is drawn: diameter 0.175 em,
0.05 em above the x-height, in pulse `#00BFDF`. The dot changes colour only in
one-colour use; amber and red mean values in the app.

The files are outlined paths, so they need no font. The in-app title bar sets
the same wordmark live from the bundled Fraunces (`Chrome/Wordmark.tsx`).

**Clear space:** half an x-height (½ x) on every side of the letterforms. The
SVG viewBox is tight to the letterforms, so add the clear space around it.

## Mark

The l, the dot leader and the pulse, on a 160-unit grid with a 10 % safe margin.
The leader and pulse sit on one line, 70 % down. Ground: a diagonal gradient
from `#16292D` to `#04090A`.

At 32 px and below the leader is dropped: the l and a larger pulse only (the
lite mark).

| Platform | File | Corner radius |
| --- | --- | --- |
| macOS | `assets/icon.icns`, 16–1024 with @2x | 22.5 % |
| Windows | `assets/icon.ico`, 16, 24, 32, 48, 64, 256 | 6 % |
| Linux, web | `assets/icon.png` (1024), `public/icon-192.png`, `public/icon-512.png`, favicons | 18 % |
| PWA maskable | `public/icon-maskable-512.png` | full bleed, mark inside the 80 % safe circle |

## Minimum sizes

- Wordmark: 14 px type size, about 44 px wide.
- Full mark: 48 px.
- Lite mark: 16–32 px. Below 16 px, use the pulse dot alone.

## Don't

- Capitalise the wordmark or set it upright.
- Recolour the dot, except in one-colour use.
- Stretch it or set it on a busy ground. Use Ink, white or pulse.

## Regenerating

```bash
# Only when the letterforms change: re-outline Fraunces (needs uv and network).
scripts/brand/outline-glyphs.sh
# Write the SVGs, PNGs, icon.icns and icon.ico.
node scripts/brand/generate-brand-assets.mjs
# Redraw the website social cards with the new wordmark.
npm --prefix website run generate:og
```

`tests/scripts/brandAssets.test.ts` fails when a committed SVG drifts from the
generator or an icon loses a size.

Fraunces is licensed under the SIL Open Font License 1.1 (`public/fonts/Fraunces-OFL.txt`);
the outlines are artwork made with the font, not a copy of the font software.
