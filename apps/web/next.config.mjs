/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a test copy of the app build into its own folder instead of sharing (and overwriting) the dev server's.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  // next/image is not used, so the image optimizer endpoint (the target of several Next.js 14 advisories) is switched off.
  images: { unoptimized: true },
  async redirects() {
    // Old WhatsApp booking links land on the home search instead of a 404.
    return [
      { source: '/book/:token', destination: '/', permanent: false },
      // My bookings is a tab of the account page. (Support has a page of its own at /support.)
      { source: '/bookings', destination: '/account?tab=bookings', permanent: false },
    ];
  },
};

export default nextConfig;
