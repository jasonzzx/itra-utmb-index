import type { Metadata, Viewport } from 'next';
import { TabBar } from '@/components/TabBar';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trail Index',
  description: 'Track the ITRA and UTMB index of the trail runners you follow.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Trail Index', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1116' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="app">{children}</div>
        <TabBar />
      </body>
    </html>
  );
}
