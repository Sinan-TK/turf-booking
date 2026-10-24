/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a test copy of the app build into its own folder instead of sharing (and overwriting) the dev server's.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  async redirects() {
    // Old WhatsApp booking links land on the home search instead of a 404.
    return [
      { source: '/book/:token', destination: '/', permanent: false },
      // My bookings and Support are tabs of the account page now.
      { source: '/bookings', destination: '/account?tab=bookings', permanent: false },
      { source: '/support', destination: '/account?tab=support', permanent: false },
    ];
  },
};

export default nextConfig;
