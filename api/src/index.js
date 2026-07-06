// index.js — gateway bootstrap: init crypto, init DB, seed the mock
// registry, then serve. The Next.js frontend proxies /api/* here, so no
// CORS configuration is needed.
const express = require('express');
const { initDb } = require('./db');
const registry = require('./registry');
const routes = require('./routes');

const PORT = process.env.PORT || 4000;

async function main() {
  await registry.init();  // load Poseidon/EdDSA wasm builds
  await initDb();         // create tables (retries while postgres starts)
  await registry.seed();  // issue + sign the demo credential

  const app = express();
  app.use(express.json({ limit: '2mb' })); // 3 Groth16 proofs ≈ a few KB, 2mb is generous
  app.use('/api', routes);
  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.listen(PORT, () => console.log(`[gateway] listening on :${PORT}`));
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
