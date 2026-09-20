# AirCard Card Skin Studio

iPhone-first card skin editor for AirCard-iOS.

## What is real in this build

- 1536×969 cardBackgroundCombined@3x.png export.
- 1024×646 cardBackgroundCombined@2x.png export.
- Real full-resolution Canvas rendering, not a screenshot of the preview.
- Draggable/pinch-zoom artwork on iPhone.
- EMV chip renderer with gold, silver, black, and rose finishes.
- Contactless symbol with position and scale controls.
- Brightness, saturation, contrast, blur, vignette, gloss, grain, pan, zoom, and rotation.
- Optional decorative card number, holder, expiry, and badge layers.
- iOS Share Sheet support.
- One-tap live show templates for popular anime, cartoons, and TV series.
- Anime search: Jikan with AniList fallback.
- TV/cartoon search: TVmaze.
- Same-origin image proxy so searched artwork can be composited and exported from Canvas.
- GitHub CI boots the built Next.js app and verifies anime, TV, and cartoon search plus image-proxy loading.

## Local

npm install
npm run dev

## Production validation

npm run build
npm start -- -p 3000
node scripts/smoke.mjs

No environment variables are required for the current public search providers.

## Deploy

Import NightVibes33/Card-Maker into Vercel as a Next.js project.
