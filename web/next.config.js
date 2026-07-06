/** @type {import('next').NextConfig} */
const nextConfig = {
  // The browser only ever talks to the Next.js origin; /api/* is proxied
  // server-side to the gateway. This avoids CORS entirely. In docker the
  // gateway is reachable as http://api:4000 (set via API_URL at build time).
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL || 'http://localhost:4000'}/api/:path*`,
      },
    ];
  },
  // snarkjs / circomlibjs are written for Node and reference builtins that
  // do not exist in the browser. They are never actually called in the
  // browser code paths, so stubbing them out is safe.
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      os: false,
      path: false,
      crypto: false,
      readline: false,
      worker_threads: false,
      constants: false,
    };
    return config;
  },
};

module.exports = nextConfig;
