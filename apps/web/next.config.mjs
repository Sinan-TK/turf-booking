/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    // Old WhatsApp booking links land on the home search instead of a 404.
    return [{ source: '/book/:token', destination: '/', permanent: false }];
  },
};

export default nextConfig;
