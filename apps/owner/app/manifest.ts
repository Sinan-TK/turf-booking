import type { MetadataRoute } from 'next';

/** What makes the portal installable: its name, icons and colours (the logo's black and warm white). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Bookyo Owner',
    short_name: 'Bookyo Owner',
    description: 'Manage your venues, bookings and payouts.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#FFFCF6',
    theme_color: '#050505',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
