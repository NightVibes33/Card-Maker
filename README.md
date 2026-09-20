# AirCard Card Studio

iPhone-first premade card-skin search and editor for AirCard-iOS.

## Search rules

Search results are real premade credit/debit-card skin products from online card-skin storefronts.

Current providers:
- Anime Town Creations
- Stickyink Designs
- CUCU Covers
- Styled Cards

The search API rejects:
- Jikan, AniList, TVmaze, and entertainment-poster fallbacks
- generic movie/TV/anime poster artwork
- unrelated card-skin products that do not match the requested franchise
- "design your own" / custom products when the user asked for premade skins
- obvious size-guide, materials, instructions, customer-photo, half-cover, window-cover, video, logo, and watermark media descriptors

Every accepted search result must resolve to a real storefront /products/... page and pass product + franchise relevance checks.

CI currently proves:
- Naruto resolves to a Naruto premade card skin
- SpongeBob resolves to a SpongeBob/Bikini Bottom premade card skin
- both selected product images load through the image proxy

Important: the app performs source and metadata filtering. It does not claim pixel-level computer-vision proof that every upstream image is watermark/logo-free.

## CUCU Covers category

Browse now includes a dedicated **CUCU** category backed by CUCU Covers' `all-card-covers` Shopify collection.

- Collection route: `/api/cucu`
- Current upstream collection count: 2,225 card-cover designs (verified by production smoke test)
- App pagination: 24 products per page
- Shopify source pagination: 250 products per upstream page
- Every app page maps back to the full collection, including the final upstream page
- Up to 8 candidate product images are exposed for client-side visual screening
- Obvious white/light storefront mockups are screened before a result is shown as usable artwork
- Product links always point back to the original CUCU product listing
- The collection is loaded on demand so iPhone Safari never has to render thousands of images at once

## iPhone UI

The interface is intentionally modeled around iOS interaction conventions:
- safe-area-aware layout
- 44pt+ touch targets
- large-title hierarchy
- four-section bottom tab bar
- native-style segmented controls, search, switches, and inset grouped settings
- semantic light/dark colors
- reduced-motion, reduced-transparency, and increased-contrast support
- touch-first drag and two-finger pinch editing
- authored SVG interface icons

## Card editor

- Full-resolution Canvas rendering
- One-finger pan and two-finger pinch zoom
- Fill/Fit
- X/Y positioning and rotation
- Brightness, saturation, contrast, blur, vignette, gloss, and grain
- EMV chip renderer with gold, silver, black, and rose finishes
- Contactless symbol
- Optional decorative card number, holder, expiry, and badge layers
- Local Photos/Files import
- Real product-source link shown with each searched skin

## AirCard export

- 1536×969 `cardBackgroundCombined@3x.png`
- 1024×646 `cardBackgroundCombined@2x.png`
- target-size Canvas rendering rather than screenshot scaling
- iOS Share Sheet support
- normal PNG download fallback

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

No API keys are required for the current storefront sources.

## Deploy

Import `NightVibes33/Card-Maker` into Vercel as a Next.js project. The connected Vercel team currently has no Card-Maker project, so Git pushes cannot deploy until that import exists.
