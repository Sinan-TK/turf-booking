import type { Metadata } from 'next';
import { Akshar } from 'next/font/google';
import './globals.css';

const akshar = Akshar({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-akshar',
});

export const metadata: Metadata = {
  title: 'TurfX by ZK Fitness',
  description: 'Instant 1-tap booking for sports, games and activity venues — live slots, book straight on WhatsApp.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={akshar.variable}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      </head>
      <body className="font-sans antialiased text-slate-800 selection:bg-brand-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
