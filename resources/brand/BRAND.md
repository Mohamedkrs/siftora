# Siftora logo

**Idea:** many moments (dots) are sifted row by row into the one vertical reel worth sharing. The rows warm up as they narrow, and the reel is the hottest colour.

## Files

| File | Use |
|---|---|
| `siftora-symbol.svg` | Main symbol, full colour |
| `siftora-symbol-small.svg` | Simpler version (3-2-1) for 32 px and below |
| `siftora-symbol-mono.svg` | One-colour version (violet); recolour to black or white as needed |
| `siftora-app-icon.svg` | Symbol on the dark rounded tile; source of `resources/icon.png` |
| `siftora-horizontal.svg` / `-on-dark.svg` | Symbol + wordmark side by side, for light / dark backgrounds |
| `siftora-horizontal-small.svg` / `-small-on-dark.svg` | Same with the simpler symbol, for small sizes such as the app's sidebar |
| `siftora-stacked.svg` | Symbol above the wordmark |
| `favicon.ico` | 16/32/48 px, from the small version |
| `download-windows.svg` / `support-kofi.svg` | README buttons: download the installer, and buy me a coffee on Ko-fi (ink with an orange outline, so it shows on light and dark pages) |

## Colours

| Role | HEX | RGB |
|---|---|---|
| Violet (top row) | `#7B61FF` | 123 97 255 |
| Magenta (middle row) | `#C04FE8` | 192 79 232 |
| Pink (bottom row) | `#F0437A` | 240 67 122 |
| Orange (the reel) | `#FF7A1A` | 255 122 26 |
| Ink (wordmark, icon tile) | `#16131F` | 22 19 31 |

## Wordmark

"siftora", lowercase, in **Sora Bold** (SIL Open Font License, which allows use in a logo), converted to outlines, with the font's kerning and letter spacing tightened by 0.035 em. Always use the SVG files; don't retype the name in a font.

In the horizontal lockups the symbol is 1.13 times the text size, centred on the text, with a gap of 0.39 times the text size.

## Rules

- **Clear space:** keep at least one dot's diameter of empty space around the logo.
- **Minimum size:** use the full symbol at 48 px and up; below that, use `siftora-symbol-small.svg`. Horizontal lockups need at least 100 px of width; below 48 px tall, use the `-small` lockups.
- **Backgrounds:** white, light neutrals, or the ink colour `#16131F`. On photos or busy backgrounds, use the app-icon tile or the one-colour white version.
- **Don't:** reorder or recolour the rows, add gradients or shadows, stretch the logo, rotate it, or change the number of dots.

## Use of the name and logo

The Siftora name and logo are not covered by the GPL that applies to the code. They identify the original project, so:

- **Fine:** using them to refer to Siftora itself, for example in an article, review, tutorial or link to the project.
- **Not fine:** using them for a modified version or another product, or in a way that suggests it comes from or is endorsed by the Siftora project. Forks that are published must use their own name and logo.
