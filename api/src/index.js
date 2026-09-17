// index.js — gateway bootstrap: init crypto, init DB, seed the mock
// registry, then serve. The Next.js frontend proxies /api/* here, so no
// CORS configuration is needed — both frontend and API are on the same origin
// from the browser's perspective.
const express = require('express');
const { initDb } = require('./db');
const registry = require('./registry');
const routes = require('./routes');

// Bind on PORT from the environment so docker-compose can publish it on a
// different host port without rebuilding the image (e.g. 8000:4000).
const PORT = process.env.PORT || 4000;

async function main() {
  // 1. Build the wasm-backed Poseidon and EdDSA objects.
  //    These are async because they load compiled WebAssembly from disk.
  //    Everything that needs them (signing, hashing) must wait for this.
  await registry.init();

  // 2. Create database tables if they don't exist yet.
  //    Retries for up to 30 seconds to handle the race between this process
  //    and the Postgres container finishing its startup sequence.
  await initDb();

  // 3. Issue the demo citizen's identity + credit credentials and write them
  //    to the database. Runs on every boot; the synthetic data is idempotent
  //    (ON CONFLICT DO UPDATE), so repeated restarts are harmless.
  await registry.seed();

  const app = express();

  // Parse JSON request bodies. 2mb cap is very generous for Groth16 proofs
  // (three proofs with public signals is a few kilobytes at most).
  app.use(express.json({ limit: '2mb' }));

  // All application routes live under /api so they share a clean namespace
  // with the health check below.
  app.use('/api', routes);

  // Liveness probe: docker-compose health check and load-balancer readiness
  // both hit this. Returns instantly with no database involvement.
  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.listen(PORT, () => console.log(`[gateway] listening on :${PORT}`));
}

main().catch((err) => {
  // Any unhandled async error in the startup sequence is fatal.
  // Log it with full stack and exit with a non-zero code so docker restarts the container.
  console.error('fatal:', err);
  process.exit(1);
});
