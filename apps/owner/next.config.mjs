/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a test copy of the app build into its own folder instead of sharing (and overwriting) the dev server's.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  // next/image is not used, so the image optimizer endpoint (the target of several Next.js 14 advisories) is switched off.
  images: { unoptimized: true },
};

export default nextConfig;
