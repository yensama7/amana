// smoke.js — end-to-end check of the whole trust chain, no framework.
//
// It plays every role from Node:
//   company — derives nothing, just holds the citizen's amanaId + asks
//             for age / citizenship / ID ownership / credit score ≥ 650
//   wallet  — fetches credentials, generates all four Groth16 proofs in parallel
//   gateway — called via HTTP; asserts valid proofs → true, replayed proofs → rejected
//
// Prereqs:
//   1. ZK artifacts built:  bash scripts/build-circuits.sh
//   2. API + postgres up:   docker compose up  (or local equivalents)
// Run: npm run smoke   (from the api/ directory)
const assert = require('assert');
const path = require('path');
const snarkjs = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');

// 8000 = the host-side port docker-compose publishes for the gateway.
// Override with API_URL for other deployment configurations (e.g. local dev on 4000).
const API = process.env.API_URL || 'http://localhost:8000';

// The smoke test reads proving artifacts from the same path the browser wallet uses.
// This ensures the test exercises the EXACT same wasm/zkey files served to the frontend.
const ZK = path.join(__dirname, '..', '..', 'web', 'public', 'zk');

// Thin HTTP helpers: GET and POST with JSON body/response.
const get = (p) => fetch(API + p).then((r) => r.json());
const post = (p, body) =>
  fetch(API + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

// prove: run snarkjs.groth16.fullProve with the circuit's wasm and zkey artifacts.
// Returns { proof, publicSignals } — the same shape the wallet POSTs to /api/verify.
const prove = (circuit, inputs) =>
  snarkjs.groth16.fullProve(inputs, path.join(ZK, `${circuit}.wasm`), path.join(ZK, `${circuit}.zkey`));

(async () => {
  // Build the Poseidon hasher to derive the amanaId locally, exactly as the wallet does.
  const poseidon = await buildPoseidon();
  const pos = (vals) => poseidon.F.toString(poseidon(vals.map(BigInt)));

  // ---- wallet side: load credentials and derive the pairwise amanaId ----------------
  // In the real wallet these are on-device; the gateway serves them here as a demo shortcut.
  const { identity, credit } = await get('/api/credential');

  // RP '9999' is a synthetic company that only exists in the smoke test.
  // amanaId = Poseidon(walletSecret, '9999') — unique to this (wallet, company) pair.
  const RP = '9999';
  const amanaId = pos([identity.attrs.secret, RP]);

  // ---- company side: create a verification request ---------------------------------
  // The company only provides its ID, name, the citizen's amanaId, and a minimum score.
  // It never sees NIN, BVN, date of birth, or any other private field.
  const { requestId } = await post('/api/request', {
    rpId: RP, rpName: 'SmokeTest RP', amanaId, minScore: 650,
  });
  assert.ok(requestId, 'request should be created');

  // ---- wallet side: pick up the pending request ------------------------------------
  const pending = await get('/api/requests/pending');
  const rq = pending.find((r) => r.id === requestId);
  assert.ok(rq, 'request should be pending');

  // Verify the gateway derived exactly the four claims we expect from the request body.
  assert.deepStrictEqual(
    [...rq.claims].sort(),
    ['age_gte_18', 'citizenship_ng', 'credit_score_gte', 'id_ownership'],
    'claims should be derived from what the company asked'
  );

  // ---- wallet side: assemble the private inputs for each circuit -------------------
  const a = identity.attrs;
  // idBase: the shared private fields + public binding values for all identity circuits.
  const idBase = {
    nin: a.nin, bvn: a.bvn, dob: a.dob, state: a.state,
    citizenship: a.citizenship, secret: a.secret, salt: a.salt,
    commitment: identity.commitment,
    rpId: rq.rp_id,   // binds the proof to this specific company
    nonce: rq.nonce,  // binds the proof to this specific request (anti-replay)
  };
  const c = credit.attrs;
  // Per-circuit input objects: each adds the extra field(s) its circuit requires.
  const inputs = {
    age_gte_18:     { ...idBase, cutoffDate: String(rq.cutoff_date) }, // today - 18y
    citizenship_ng: idBase,                                             // no extra fields
    id_ownership:   { ...idBase, amanaId: rq.amana_id },               // the company's amanaId
    credit_score_gte: {
      // Credit circuit uses a separate credential — note creditCommitment, not commitment.
      score: c.score, activeLoans: c.activeLoans, defaults: c.defaults,
      secret: c.secret, salt: c.salt,
      creditCommitment: credit.commitment,
      rpId: rq.rp_id, nonce: rq.nonce,
      minScore: String(rq.min_score), // the threshold the company specified
    },
  };

  // Prove all four claims in parallel — exactly as the browser wallet does with
  // Promise.all + Web Workers. Each prove() call is independent so they run concurrently.
  const results = await Promise.all(rq.claims.map(claim => prove(claim, inputs[claim])));

  // Reshape to { circuit: { proof, publicSignals } } for the /verify endpoint.
  const proofs = Object.fromEntries(results.map((r, i) => [rq.claims[i], r]));
  rq.claims.forEach(c => console.log(`proved ${c}`));

  // ---- gateway: submit the proofs and check the verdicts --------------------------
  const out = await post('/api/verify', { requestId, proofs });
  // All four valid proofs must produce ok = true.
  assert.strictEqual(out.ok, true, 'valid proofs must verify true');
  // A receipt ID must be issued on success for the lender's audit trail.
  assert.ok(out.receiptId, 'receipt id expected');

  // Replay attack: submit the same proofs a second time against the same requestId.
  // The gateway must reject this — the nonce is single-use, status is no longer 'pending'.
  const replay = await post('/api/verify', { requestId, proofs });
  assert.notStrictEqual(replay.ok, true, 'replayed proofs must be rejected');

  console.log(`SMOKE OK — verified=true, replay rejected, receipt=${out.receiptId}`);

  // snarkjs keeps WebAssembly worker threads alive after proving finishes.
  // Calling process.exit() here ensures the smoke test terminates cleanly
  // without waiting for those internal threads to time out.
  process.exit(0);
})().catch((err) => {
  console.error('SMOKE FAILED:', err.message);
  process.exit(1);
});
