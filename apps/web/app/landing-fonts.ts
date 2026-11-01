import { Barlow, Barlow_Condensed } from 'next/font/google';

// The landing page's own faces (transport-signage sans, like a departures board). Only the landing page uses them.
export const barlow = Barlow({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-barlow' });
export const barlowCondensed = Barlow_Condensed({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--font-barlow-condensed' });
