/** @type {import('next').NextConfig} */
const nextConfig = {
  // Proxy all /api/* requests to the gateway server.
  // The browser only ever talks to the Next.js origin; /api/* is forwarded
  // server-side to the gateway, which avoids CORS entirely — both the UI and
  // the API appear to be on the same origin from the browser's perspective.
  //
  // In Docker: the gateway is reachable as http://api:4000 via the internal
  // Docker network; API_URL is set to that value at build time.
  // In local dev: the gateway runs on http://localhost:4000 (the default).
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL || 'http://localhost:4000'}/api/:path*`,
      },
    ];
  },

  // Browser polyfill stubs for Node.js built-ins used by snarkjs and circomlibjs.
  //
  // snarkjs and circomlibjs were written for Node and import 'fs', 'path', 'crypto', etc.
  // These imports appear in the package's source even in code paths that never run in
  // the browser (e.g. the file-system-based prover). Webpack bundles them anyway unless
  // we stub them out. Setting a built-in to `false` makes webpack replace all require()
  // calls for that module with an empty module — safe because the browser code paths
  // never actually call into these built-ins (crypto operations go through the WebAssembly
  // compiled from circomlibjs instead of Node's crypto module).
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback, // preserve any fallbacks already set by earlier plugins
      fs: false,             // file system — not available in browsers
      os: false,             // operating system info — not used in browser code paths
      path: false,           // path utilities — the browser wasm uses relative paths internally
      crypto: false,         // Node crypto — browser code uses the wasm-backed implementation
      readline: false,       // interactive terminal input — not relevant in a browser
      worker_threads: false, // Node worker threads — the browser uses Web Workers instead
      constants: false,      // Node OS/errno constants — not needed in browser
    };
    return config;
  },
};

module.exports = nextConfig;
