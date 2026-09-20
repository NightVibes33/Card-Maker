export default function manifest() {
  return {
    name: 'AirCard Card Studio',
    short_name: 'Card Studio',
    description: 'iPhone-first card skin maker for AirCard-iOS',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    orientation: 'portrait-primary',
    icons: [
      {
        src: '/icon',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable'
      },
      {
        src: '/apple-icon',
        sizes: '180x180',
        type: 'image/png',
        purpose: 'any'
      }
    ],
    categories: ['design', 'utilities']
  };
}
