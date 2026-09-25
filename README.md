# AirCard Card Studio V2

iPhone-first CUCU card-design PWA for AirCard-iOS.

## Product architecture

**Discover → Studio → Library → Export**

### Discover
- real CUCU collections
- cached full-catalog search
- Recently Added, Best Sellers, Anime, Cars, Cute & Kawaii, Memes, Recently Used
- favorites
- Surprise Me
- infinite loading
- thumbnail-first Browse rendering
- skeleton/loading/error/offline states

### Studio
- Crop / Position / Adjust / Effects / Card modes
- explicit crop-left/right/top/bottom controls
- Fill/Fit, flip, zoom, X/Y, rotation
- one-finger drag + two-finger scale/rotate
- selectable artwork, chip, contactless, and custom layers
- snapping to center, thirds, safe edges, and common hardware placements
- edge bleed, safe text, chip, contactless, and snap guides
- bounded 50-state undo/redo
- hold Before / After comparison
- Flat / Physical preview with the original lightweight CSS tilt and one shared card-wide sheen
- Original, Vivid, Dark, AMOLED, Warm, Cold, Film, Neon, Vintage, Monochrome image presets
- Classic Gold, Black Metal, Silver, Rose Gold, Minimal, No Chip, Full Art card presets
- exposure, brightness, contrast, saturation, highlights, shadows, temperature, tint, sharpness, blur
- vignette, grain, gloss, dark overlay, fade, color tint
- EMV/contactless hardware
- fixed card text plus custom text/image/shape layers
- custom text font, weight, size, letter spacing, alignment, opacity, shadow, X/Y, rotation
- imported TTF/OTF/WOFF fonts, text outline and curve, tracking, line spacing, reusable text styles
- AI cutout under Effects → Cutout, with editable erase/restore masks for artwork and image layers
- image/logo layers
- Bring Forward / Send Back / Duplicate / Delete / Lock
- Expert Mode numerical editing

### Library
- IndexedDB autosaved draft (Editing… → Saved)
- Favorites
- named saved projects containing full editable design state
- 20 Recent skins
- Imports stored as IndexedDB blobs
- duplicate/open/delete projects
- export history
- portable `.aircard.json` design presets with imported assets embedded
- offline cached favorite/project artwork
- iPhone PWA installation help

### Export
- full-screen final preview
- iOS Share Sheet
- `cardBackgroundCombined@3x.png` — exactly 1536×969
- `cardBackgroundCombined@2x.png` — exactly 1024×646
- target-size Canvas renderer, never a screenshot
- editor guides/selections/physical-preview effects never contaminate exported PNGs

## CUCU scale/performance

- verified All Card Skins total: 2,225
- catalog pages are edge cached
- upstream Shopify pages are chunked to fit Next/Vercel cache item limits
- Browse receives ~560px Shopify-resized thumbnails
- Studio/export use full-resolution artwork
- `/api/cucu/inspect` uses Sharp to compute reusable, edge-cached usability/crop metadata
- clients consume that metadata instead of decoding full originals in Discover
- image proxy uses one-year browser/CDN caching
- service worker caches artwork, catalog responses, navigations, and Next static assets

## Accessibility

- iPhone-safe target sizing
- VoiceOver labels and `aria-valuetext` on important adjustable controls
- gesture actions always have slider/numeric alternatives
- mobile page pinch-zoom is disabled for app-like interaction; canvas gestures remain app-controlled
- Apple body text sizing support
- Reduce Motion / Reduce Transparency handling
- dialog semantics for modal sheets
- intentional offline/loading/error status surfaces

## Product contract

The exact V2 feature set is machine-enforced by:

- `product/v2-contract.yaml`
- `scripts/verify-v2-contract.mjs`
- `.github/workflows/build.yml`

CI order:

```text
npm ci
npm run verify:v2
npm run build
npm start -- -p 3000
node scripts/smoke.mjs
```

The YAML contract fails CI if required V2 primitives disappear or legacy Browse/Edit/Layers/Blitz/Load More architecture returns.
