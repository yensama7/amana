// smoke.js — end-to-end check of the whole trust chain, no framework.
//
// It plays every role from Node:
//   company — derives nothing, just holds the citizen's amanaId + asks
//             for age / citizenship / ID ownership / credit score ≥ 650
//   wallet  — generates all four Groth16 proofs, then a linkage proof
//   asserts — valid proofs -> true, replayed proofs -> rejected,
//             linkage proof -> accepted
//
// Prereqs:
//   1. ZK artifacts built:  bash scripts/build-circuits.sh
//   2. API + postgres up:   docker compose up  (or local equivalents)
// Run: npm run smoke   (from the api/ directory)
const assert = require('assert');
const path = require('path');
const snarkjs = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');

// 4200 = the host-side port docker-compose publishes (4000 is often a
// Windows reserved port). Override with API_URL for other setups.
const API = process.env.API_URL || 'http://localhost:4200';
// wasm/zkey artifacts as the browser would load them
const ZK = path.join(__dirname, '..', '..', 'web', 'public', 'zk');

const get = (p) => fetch(API + p).then((r) => r.json());
const post = (p, body) =>
  fetch(API + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const prove = (circuit, inputs) =>
  snarkjs.groth16.fullProve(inputs, path.join(ZK, `${circuit}.wasm`), path.join(ZK, `${circuit}.zkey`));

(async () => {
  const poseidon = await buildPoseidon();
  const pos = (vals) => poseidon.F.toString(poseidon(vals.map(BigInt)));

  // -- wallet side: derive the pairwise amanaId this company would hold ----
  const { identity, credit } = await get('/api/credential');
  const RP = '9999';
  const amanaId = pos([identity.attrs.secret, RP]);

  // -- company side: open a request (no BVN, no NIN — just the amanaId) ----
  const { requestId } = await post('/api/request', {
    rpId: RP, rpName: 'SmokeTest RP', amanaId, minScore: 650,
  });
  assert.ok(requestId, 'request should be created');

  // -- wallet side: pick up the pending request, prove all four claims ----
  const pending = await get('/api/requests/pending');
  const rq = pending.find((r) => r.id === requestId);
  assert.ok(rq, 'request should be pending');
  assert.deepStrictEqual(
    [...rq.claims].sort(),
    ['age_gte_18', 'citizenship_ng', 'credit_score_gte', 'id_ownership'],
    'claims should be derived from what the company asked'
  );

  const a = identity.attrs;
  const idBase = {
    nin: a.nin, bvn: a.bvn, dob: a.dob, state: a.state,
    citizenship: a.citizenship, secret: a.secret, salt: a.salt,
    commitment: identity.commitment, rpId: rq.rp_id, nonce: rq.nonce,
  };
  const c = credit.attrs;
  const inputs = {
    age_gte_18:     { ...idBase, cutoffDate: String(rq.cutoff_date) },
    citizenship_ng: idBase,
    id_ownership:   { ...idBase, amanaId: rq.amana_id },
    credit_score_gte: {
      score: c.score, activeLoans: c.activeLoans, defaults: c.defaults,
      secret: c.secret, salt: c.salt,
      creditCommitment: credit.commitment, rpId: rq.rp_id, nonce: rq.nonce,
      minScore: String(rq.min_score),
    },
  };

  const proofs = {};
  for (const claim of rq.claims) {
    proofs[claim] = await prove(claim, inputs[claim]);
    console.log(`proved ${claim}`);
  }

  // -- gateway verdicts -----------------------------------------------------
  const out = await post('/api/verify', { requestId, proofs });
  assert.strictEqual(out.ok, true, 'valid proofs must verify true');
  assert.ok(out.receiptId, 'receipt id expected');

  const replay = await post('/api/verify', { requestId, proofs });
  assert.notStrictEqual(replay.ok, true, 'replayed proofs must be rejected');

  // -- linkage (Option 3): authorise linking SwiftLoan ↔ GTBank IDs ---------
  const { linkageId, nonce } = await post('/api/linkage/start', {});
  const linkProof = await prove('id_linkage', {
    nin: a.nin, bvn: a.bvn, dob: a.dob, state: a.state,
    citizenship: a.citizenship, secret: a.secret, salt: a.salt,
    commitment: identity.commitment,
    rpIdA: '1001', idA: pos([a.secret, '1001']),
    rpIdB: '2002', idB: pos([a.secret, '2002']),
    nonce,
  });
  console.log('proved id_linkage');
  const linked = await post('/api/linkage/complete', { linkageId, ...linkProof });
  assert.strictEqual(linked.ok, true, 'linkage proof must be accepted');

  console.log(`SMOKE OK — verified=true, replay rejected, linkage accepted, receipt=${out.receiptId}`);
  process.exit(0); // snarkjs keeps worker threads alive; exit explicitly
})().catch((err) => {
  console.error('SMOKE FAILED:', err.message);
  process.exit(1);
});
