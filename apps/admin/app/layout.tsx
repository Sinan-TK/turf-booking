import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { headers } from 'next/headers';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import { PwaRegister } from '@/components/pwa-register';
import { ToastProvider } from '@/components/toast';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  appleWebApp: { capable: true, title: 'Bookyo Admin', statusBarStyle: 'black-translucent' },
  title: 'Bookyo — Super Admin',
  description: 'Platform administration.',
};

export const viewport: Viewport = { themeColor: '#050505' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request headers makes every page render per request, which the Content-Security-Policy nonce (set in middleware.ts) needs:
  // a page built once ahead of time could not carry a nonce that changes with each request.
  headers();
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,300..500,0..1,0&display=block"
        />
      </head>
      <body className="font-sans">
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
