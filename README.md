# AirCard Card Studio

iPhone-first CUCU card-skin browser and editor for AirCard-iOS.

## Browse catalog

Browse is backed by **CUCU Covers** only.

Real CUCU collections exposed in the app:
- All Card Skins
- Best Sellers
- New Arrivals
- Anime
- Cars
- Sports
- Artistic
- Cute & Kawaii
- Pets
- Classic Art
- Funny
- Memes
- Retro & Nostalgic
- Animals
- Crypto

Blitz Covers has been removed completely.

## CUCU catalog implementation

- Route: `/api/cucu`
- Verified full collection size: 2,225 card skins
- App pagination: 24 products per page
- Shopify upstream chunks: 100 products per cached request
- Real CUCU collection handles are used where available
- Broken/empty collection endpoints can fall back to filtering the real CUCU product catalog by product evidence/tags
- Up to 8 candidate product images are ranked per product
- Raw Shopify CDN card-art assets are preferred over storefront mockups
- White/transparent product canvases are inspected and the printed-card region can be cropped automatically
- Catalog responses are edge cached
- Image proxy responses are long-lived cached for scale
- No storefront redirect buttons are shown in Browse

## Search API

The legacy search API remains available internally for compatibility/testing, but it does not drive the main Browse UI.

Its providers may include Anime Town Creations, Stickyink Designs, CUCU Covers, and Styled Cards. It rejects obvious poster/non-card results and proxies accepted images through the app.

## iPhone UI

- safe-area-aware layout
- 44pt+ touch targets
- large-title hierarchy
- four-section bottom tab bar
- native-style segmented controls, switches, sliders, and inset-grouped settings
- semantic light/dark colors
- reduced-motion, reduced-transparency, and increased-contrast support
- touch-first drag and two-finger pinch editing
- authored SVG interface icons

## Card editor

- Full-resolution Canvas rendering
- One-finger pan and two-finger pinch zoom
- Fill/Fit
- X/Y positioning and rotation
- Brightness, saturation, contrast, blur
- Dark overlay, vignette, gloss, grain
- EMV chip renderer with gold, silver, black, and rose finishes
- Contactless symbol
- Optional decorative card number, holder, expiry, and badge layers
- Local Photos/Files import
- Live iOS range controls
- Reset controls for layout, image adjustments, and finish

## AirCard export

- 1536×969 `cardBackgroundCombined@3x.png`
- 1024×646 `cardBackgroundCombined@2x.png`
- target-size Canvas rendering rather than screenshot scaling
- iOS Share Sheet support
- PNG download fallback

## Local

```bash
npm install
npm run dev
```

## Production validation

```bash
npm run build
npm start -- -p 3000
node scripts/smoke.mjs
```
