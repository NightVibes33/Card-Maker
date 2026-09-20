import './globals.css';

export const metadata = {
  title: 'AirCard Sticker Studio',
  description: 'iPhone-first credit card skin maker for AirCard-iOS',
  applicationName: 'AirCard Sticker Studio',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'AirCard Studio'
  },
  formatDetection: { telephone: false }
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#07080b'
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
