import type { Metadata } from 'next';
import { Akshar } from 'next/font/google';
import { headers } from 'next/headers';
import './globals.css';
import { CustomerProvider } from '@/lib/customer';
import { ToastProvider } from '@/components/toast';

const akshar = Akshar({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-akshar',
});

export const metadata: Metadata = {
  title: 'TurfX',
  description: 'Instant 1-tap booking for sports, games and activity venues — live slots, pay online and get your confirmation on WhatsApp.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request headers makes every page render per request, which the Content-Security-Policy nonce (set in middleware.ts) needs:
  // a page built once ahead of time could not carry a nonce that changes with each request.
  headers();
  return (
    <html lang="en" className={akshar.variable}>
      <body className="font-sans antialiased text-slate-800 selection:bg-brand-500 selection:text-white">
        <ToastProvider>
          <CustomerProvider>{children}</CustomerProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
