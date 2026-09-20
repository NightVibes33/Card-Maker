# AirCard Sticker Studio

A production iPhone-first card skin designer for [AirCard-iOS](https://github.com/Mak5er/AirCard-iOS).

## FVP features
- Exact AirCard exports: 1536×969 (`cardBackgroundCombined@3x.png`) and 1024×646 (`@2x`).
- Real high-resolution canvas compositor; preview scaling does not reduce export resolution.
- iPhone touch gestures: drag to pan and two-finger pinch to zoom.
- Built-in EMV chip renderer with four finishes plus size/position controls.
- Live anime artwork search via Jikan / MyAnimeList-linked images.
- Live TV/cartoon artwork search via TVmaze with in-app attribution.
- 18 built-in genre templates, image upload, fit/fill controls, brightness, saturation, blur, vignette, grain and gloss.
- Decorative number, holder, expiry and badge overlays with light/dark modes.
- iOS Share Sheet export and normal PNG download.
- Session settings persistence and an allow-listed image proxy so exports are not canvas-tainted by CORS.

## Run
```bash
npm install
npm run dev
```

No environment variables are required. Deploy directly as a Next.js project on Vercel.
