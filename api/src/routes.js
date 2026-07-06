// routes.js — all gateway endpoints.
//
// Flow: company    -> POST /api/request  (creates a pending request + one-time nonce)
//       wallet     -> GET  /api/requests/pending, then POST /api/verify with proofs
//       company    -> GET  /api/requests/:id        (polls for the outcome)
//       dashboard  -> GET  /api/audit, POST /api/revoke | /api/unrevoke
//       wallet     -> POST /api/linkage/start + /api/linkage/complete
//                     (citizen authorises the credit bureau to link two of
//                      their pairwise IDs — Option 3, consent-based linkage)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const snarkjs = require('snarkjs');
const { pool } = require('./db');
const registry = require('./registry');

const router = express.Router();

const ALL_CIRCUITS = [
  'age_gte_18', 'citizenship_ng', 'bvn_match',
  'id_ownership', 'credit_score_gte', 'id_linkage',
];

// Companies known to the demo (display names only — proofs use the ids).
const KNOWN_RPS = { 1001: 'SwiftLoan', 2002: 'GTBank', 3003: 'CRC Credit Bureau' };
const rpName = (id) => KNOWN_RPS[id] || `company ${id}`;

// Groth16 verification keys exported by scripts/build-circuits.sh.
// Loaded once at require-time — they are tiny JSON files.
const ZK_DIR = process.env.ZK_DIR || path.join(__dirname, '..', 'zk');
const VKEYS = Object.fromEntries(
  ALL_CIRCUITS.map((c) => [c, JSON.parse(fs.readFileSync(path.join(ZK_DIR, `${c}.vkey.json`)))])
);

// today - 18 years, as an integer YYYYMMDD (numeric compare == date compare).
function ageCutoffDate() {
  const d = new Date();
  return (d.getFullYear() - 18) * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

// One-time random value: fresh per request, single-use (anti-replay).
function newNonce() {
  return BigInt('0x' + crypto.randomBytes(16).toString('hex')).toString();
}

async function isRevoked(rpId) {
  const r = await pool.query('SELECT 1 FROM revocations WHERE rp_id = $1', [rpId]);
  return r.rowCount > 0;
}

async function audit(rpId, name, claims, outcome, receiptId = null) {
  await pool.query(
    'INSERT INTO audit_log (rp_id, rp_name, claims, outcome, receipt_id) VALUES ($1,$2,$3,$4,$5)',
    [rpId, name, claims, outcome, receiptId]
  );
}

async function getCredential(kind) {
  const r = await pool.query('SELECT * FROM credentials WHERE kind = $1', [kind]);
  return r.rows[0];
}

// ---------------------------------------------------------------------------
// Company: start a verification request.
// Body: { rpId, rpName, amanaId, minScore?, bvnHash? }
//   amanaId  — the pairwise ID the citizen gave this company (replaces
//              typing a BVN/NIN in plaintext — see id_ownership.circom)
//   minScore — optional credit threshold, adds a credit_score_gte claim
//   bvnHash  — optional legacy path for companies that already hold a BVN
// The claims list is derived from what the company actually asked for.
// ---------------------------------------------------------------------------
router.post('/request', async (req, res) => {
  const { rpId, rpName: name, amanaId, minScore, bvnHash } = req.body || {};
  if (!rpId || !name) {
    return res.status(400).json({ error: 'rpId and rpName are required' });
  }

  // Revocation gate: if the citizen revoked this company, refuse before
  // anything else happens — and log the blocked attempt for the dashboard.
  const claims = ['age_gte_18', 'citizenship_ng'];
  if (amanaId) claims.push('id_ownership');
  if (minScore) claims.push('credit_score_gte');
  if (bvnHash) claims.push('bvn_match');

  if (await isRevoked(rpId)) {
    await audit(rpId, name, claims, 'blocked');
    return res.status(403).json({ error: 'revoked', message: 'The citizen has revoked access for this company.' });
  }

  const r = await pool.query(
    `INSERT INTO requests (rp_id, rp_name, claims, nonce, amana_id, min_score, bvn_hash, cutoff_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [rpId, name, claims, newNonce(), amanaId || null, minScore || null, bvnHash || null, ageCutoffDate()]
  );
  res.json({ requestId: r.rows[0].id, status: 'pending' });
});

// Wallet: list requests awaiting citizen consent (includes the public
// values the wallet needs to build proofs: nonce, cutoff_date, etc).
router.get('/requests/pending', async (_req, res) => {
  const r = await pool.query(
    `SELECT id, rp_id, rp_name, claims, nonce, amana_id, min_score, bvn_hash, cutoff_date, created_at
     FROM requests WHERE status = 'pending' ORDER BY id DESC`
  );
  res.json(r.rows);
});

// Company: poll a request's outcome.
router.get('/requests/:id', async (req, res) => {
  const r = await pool.query(
    'SELECT id, status, receipt_id FROM requests WHERE id = $1',
    [req.params.id]
  );
  if (!r.rowCount) return res.status(404).json({ error: 'not found' });
  const row = r.rows[0];
  res.json({ id: row.id, status: row.status, ok: row.status === 'verified', receiptId: row.receipt_id });
});

// Wallet: citizen pressed "Deny" (or proving failed, e.g. the amanaId the
// company holds is not this wallet's — the proof machinery refuses to
// prove a false statement, which is exactly the point of ZK).
router.post('/requests/:id/deny', async (req, res) => {
  const r = await pool.query(
    `UPDATE requests SET status = 'denied' WHERE id = $1 AND status = 'pending' RETURNING rp_id, rp_name, claims`,
    [req.params.id]
  );
  if (!r.rowCount) return res.status(404).json({ error: 'no pending request' });
  const { rp_id, rp_name, claims } = r.rows[0];
  await audit(rp_id, rp_name, claims, 'denied');
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Wallet: submit the proofs. This is the heart of the gateway.
// Body: { requestId, proofs: { <circuit>: { proof, publicSignals } } }
//
// Verification steps, in order — each one is load-bearing:
//   1. request exists and is still pending  -> nonce is single-use (anti-replay)
//   2. company not revoked (could have happened after the request was made)
//   3. issuer signatures are valid: registry's on the identity commitment,
//      and the bureau's on the credit commitment when a credit claim is asked
//   4. every proof's public signals EXACTLY match what this request expects
//      (right commitment, right rpId, right nonce, right amanaId/threshold) —
//      otherwise a valid proof for some other request could be spliced in
//   5. each Groth16 proof verifies against its circuit's verification key
// ---------------------------------------------------------------------------
router.post('/verify', async (req, res) => {
  const { requestId, proofs } = req.body || {};
  if (!requestId || !proofs) return res.status(400).json({ error: 'requestId and proofs are required' });

  // (1) single-use request
  const rq = await pool.query('SELECT * FROM requests WHERE id = $1', [requestId]);
  if (!rq.rowCount) return res.status(404).json({ error: 'unknown request' });
  const request = rq.rows[0];
  if (request.status !== 'pending') {
    return res.status(409).json({ ok: false, error: 'request already used (replay rejected)' });
  }

  // (2) revocation re-check
  if (await isRevoked(request.rp_id)) {
    await pool.query(`UPDATE requests SET status = 'denied' WHERE id = $1`, [requestId]);
    await audit(request.rp_id, request.rp_name, request.claims, 'blocked');
    return res.status(403).json({ ok: false, error: 'revoked' });
  }

  // (3) the issuers must have actually signed these commitments
  const idCred = await getCredential('identity');
  if (!registry.verifySignature(idCred)) {
    return res.status(400).json({ ok: false, error: 'registry signature invalid' });
  }
  let creditCred = null;
  if (request.claims.includes('credit_score_gte')) {
    creditCred = await getCredential('credit');
    if (!registry.verifySignature(creditCred)) {
      return res.status(400).json({ ok: false, error: 'credit bureau signature invalid' });
    }
  }

  // (4) expected public signals per circuit. Order matters: it is the
  // declaration order of the `{public [...]}` list in each .circom file.
  const expectedSignals = {
    age_gte_18:       [idCred.commitment, request.rp_id, request.nonce, String(request.cutoff_date)],
    citizenship_ng:   [idCred.commitment, request.rp_id, request.nonce],
    bvn_match:        [idCred.commitment, request.rp_id, request.nonce, request.bvn_hash],
    id_ownership:     [idCred.commitment, request.rp_id, request.nonce, request.amana_id],
    credit_score_gte: creditCred && [creditCred.commitment, request.rp_id, request.nonce, String(request.min_score)],
  };

  let allValid = true;
  for (const claim of request.claims) {
    const p = proofs[claim];
    const expected = expectedSignals[claim];
    const signalsMatch =
      p && expected && Array.isArray(p.publicSignals) &&
      p.publicSignals.length === expected.length &&
      p.publicSignals.every((s, i) => String(s) === expected[i]);

    // (5) the actual SNARK check
    const proofValid = signalsMatch && (await snarkjs.groth16.verify(VKEYS[claim], p.publicSignals, p.proof));
    if (!proofValid) {
      console.log(`[verify] request ${requestId}: claim ${claim} FAILED (signalsMatch=${!!signalsMatch})`);
      allValid = false;
    }
  }

  // Record the outcome: audit row + receipt, and burn the nonce.
  const receiptId = crypto.randomUUID();
  const outcome = allValid ? 'verified' : 'failed';
  await pool.query('UPDATE requests SET status = $1, receipt_id = $2 WHERE id = $3', [outcome, receiptId, requestId]);
  await audit(request.rp_id, request.rp_name, request.claims, outcome, receiptId);

  res.json({ ok: allValid, receiptId });
});

// ---------------------------------------------------------------------------
// Linkage (Option 3): the citizen's cryptographic permission slip that lets
// the credit bureau treat two of their pairwise IDs as the same person.
// Two steps, like /request + /verify:
//   start    -> hands the wallet a one-time nonce
//   complete -> wallet returns an id_linkage proof; gateway verifies it,
//               records which IDs are now linked, and writes an audit row.
// ---------------------------------------------------------------------------
router.post('/linkage/start', async (_req, res) => {
  const r = await pool.query(
    'INSERT INTO linkages (nonce) VALUES ($1) RETURNING id, nonce',
    [newNonce()]
  );
  res.json({ linkageId: r.rows[0].id, nonce: r.rows[0].nonce });
});

router.post('/linkage/complete', async (req, res) => {
  const { linkageId, proof, publicSignals } = req.body || {};
  if (!linkageId || !proof || !Array.isArray(publicSignals)) {
    return res.status(400).json({ error: 'linkageId, proof and publicSignals are required' });
  }

  const lr = await pool.query('SELECT * FROM linkages WHERE id = $1', [linkageId]);
  if (!lr.rowCount) return res.status(404).json({ error: 'unknown linkage' });
  const link = lr.rows[0];
  if (link.status !== 'pending') {
    return res.status(409).json({ ok: false, error: 'linkage already used (replay rejected)' });
  }

  // Public signal order (see id_linkage.circom's {public [...]} list):
  //   [commitment, rpIdA, idA, rpIdB, idB, nonce]
  const [commitment, rpIdA, idA, rpIdB, idB, nonce] = publicSignals.map(String);

  // Same trust chain as /verify: signed commitment + fresh nonce + SNARK.
  const idCred = await getCredential('identity');
  const bound =
    commitment === idCred.commitment &&
    nonce === link.nonce &&
    registry.verifySignature(idCred);
  const proofValid = bound && (await snarkjs.groth16.verify(VKEYS.id_linkage, publicSignals, proof));

  if (!proofValid) {
    return res.status(400).json({ ok: false, error: 'linkage proof invalid' });
  }

  await pool.query(
    `UPDATE linkages SET status = 'linked', rp_a = $1, id_a = $2, rp_b = $3, id_b = $4 WHERE id = $5`,
    [rpIdA, idA, rpIdB, idB, linkageId]
  );
  // The audit entry is the whole point: linking is a visible, logged event.
  await audit('3003', `${rpName(rpIdA)} ↔ ${rpName(rpIdB)} (via CRC Credit Bureau)`, ['id_linkage'], 'linked');
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Wallet: fetch the stored credentials (identity + credit).
// Demo shortcut: a real wallet keeps these on-device (secure storage) and
// the gateway would never hold them. Serving them here stands in for
// "the wallet already has its credentials".
// ---------------------------------------------------------------------------
router.get('/credential', async (_req, res) => {
  const shape = (c) => c && {
    attrs: c.attrs,
    commitment: c.commitment,
    signature: { R8x: c.sig_r8x, R8y: c.sig_r8y, S: c.sig_s },
    issuerPublicKey: { Ax: c.pub_ax, Ay: c.pub_ay },
  };
  const identity = shape(await getCredential('identity'));
  const credit = shape(await getCredential('credit'));
  if (!identity) return res.status(404).json({ error: 'no credential issued yet' });
  res.json({ identity, credit });
});

// Dashboard: audit trail (who asked, what they asked, outcome).
router.get('/audit', async (_req, res) => {
  const r = await pool.query('SELECT * FROM audit_log ORDER BY id DESC LIMIT 100');
  res.json(r.rows);
});

// Dashboard: revoke / restore a company.
router.post('/revoke', async (req, res) => {
  const { rpId, rpName: name } = req.body || {};
  if (!rpId) return res.status(400).json({ error: 'rpId required' });
  await pool.query(
    'INSERT INTO revocations (rp_id, rp_name) VALUES ($1, $2) ON CONFLICT (rp_id) DO NOTHING',
    [rpId, name || rpId]
  );
  res.json({ ok: true });
});

router.post('/unrevoke', async (req, res) => {
  const { rpId } = req.body || {};
  if (!rpId) return res.status(400).json({ error: 'rpId required' });
  await pool.query('DELETE FROM revocations WHERE rp_id = $1', [rpId]);
  res.json({ ok: true });
});

router.get('/revocations', async (_req, res) => {
  const r = await pool.query('SELECT * FROM revocations ORDER BY created_at DESC');
  res.json(r.rows);
});

module.exports = router;
