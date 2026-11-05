import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';

export const metadata: Metadata = {
  title: 'Bookyo — Owner Portal',
  description: 'Manage your venues.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request headers makes every page render per request, which the Content-Security-Policy nonce (set in middleware.ts) needs:
  // a page built once ahead of time could not carry a nonce that changes with each request.
  headers();
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
          rel="stylesheet"
        />
      </head>
      <body className="bg-background font-body-md text-on-surface">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
