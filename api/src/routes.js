// routes.js — all gateway endpoints.
//
// Flow: company    -> POST /api/request          (creates a pending request + one-time nonce)
//       wallet     -> GET  /api/requests/pending  (lists requests awaiting consent)
//       wallet     -> POST /api/verify            (submits all ZK proofs for a request)
//       company    -> GET  /api/requests/:id      (polls for the outcome)
//       dashboard  -> GET  /api/audit             (citizen's full audit trail)
//       dashboard  -> POST /api/revoke | /api/unrevoke  (per-company access control)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const snarkjs = require('snarkjs');
const { pool } = require('./db');
const registry = require('./registry');

const router = express.Router();

// The four circuits currently supported by the gateway.
// This list is the source of truth for which verification keys to load.
const ALL_CIRCUITS = [
  'age_gte_18', 'citizenship_ng', 'id_ownership', 'credit_score_gte',
];

// Display names for the two demo relying parties.
// Used only in the audit log — proofs use the numeric rpId, not the name.
const KNOWN_RPS = { 1001: 'Swift Loan', 2002: 'ABC Loan' };
const rpName = (id) => KNOWN_RPS[id] || `company ${id}`;

// Load all four Groth16 verification keys into memory at require-time.
// The keys are small JSON files (~1KB each) produced by build-circuits.sh.
// ZK_DIR can be overridden via environment variable for different deployment layouts.
const ZK_DIR = process.env.ZK_DIR || path.join(__dirname, '..', 'zk');
const VKEYS = Object.fromEntries(
  ALL_CIRCUITS.map((c) => [c, JSON.parse(fs.readFileSync(path.join(ZK_DIR, `${c}.vkey.json`)))])
);

// Compute today minus 18 years as an integer in YYYYMMDD format.
// Because YYYYMMDD sorts numerically the same as chronologically,
// the simple comparison dob <= cutoffDate is equivalent to age >= 18.
function ageCutoffDate() {
  const d = new Date();
  return (d.getFullYear() - 18) * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

// Generate a cryptographically random BigInt string for use as a nonce.
// 16 random bytes = 128 bits of entropy — each request gets a unique nonce,
// and the same nonce can never be reused (status flips on first use).
function newNonce() {
  return BigInt('0x' + crypto.randomBytes(16).toString('hex')).toString();
}

// Check whether the citizen has revoked a specific company's access.
// Returns true if a row exists in the revocations table for this rpId.
async function isRevoked(rpId) {
  const r = await pool.query('SELECT 1 FROM revocations WHERE rp_id = $1', [rpId]);
  return r.rowCount > 0;
}

// Write one row to the audit log. Called for every verification outcome,
// including denied, blocked, and failed events — the citizen sees everything.
async function audit(rpId, name, claims, outcome, receiptId = null) {
  await pool.query(
    'INSERT INTO audit_log (rp_id, rp_name, claims, outcome, receipt_id) VALUES ($1,$2,$3,$4,$5)',
    [rpId, name, claims, outcome, receiptId]
  );
}

// Fetch one credential row by kind ('identity' | 'credit').
// Returns undefined if the credential hasn't been issued yet.
async function getCredential(kind) {
  const r = await pool.query('SELECT * FROM credentials WHERE kind = $1', [kind]);
  return r.rows[0];
}

// ---------------------------------------------------------------------------
// GET /api/trust-bridge/trace — judge / demo endpoint.
// Returns a step-by-step trace of the entire NIMC PKI → ZK Trust Bridge
// with plain-English explanations at each step. No database write.
// Accessible in any browser: http://localhost:4200/api/trust-bridge/trace
// ---------------------------------------------------------------------------
router.get('/trust-bridge/trace', async (_req, res) => {
  try {
    res.json(await registry.traceNIMCBridge());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/citizen/onboard — onboard a citizen via the NIMC PKI Trust Bridge.
// Body: { nimcPayload, pkiSignature, citizenSecret, citizenSalt }
//
// The gateway verifies the RSA signature, re-hashes with Poseidon, and stores
// a ZK-friendly EdDSA-signed credential. After this call the citizen can prove
// facts about their identity without ever presenting the original RSA-signed token.
// ---------------------------------------------------------------------------
router.post('/citizen/onboard', async (req, res) => {
  const { nimcPayload, pkiSignature, citizenSecret, citizenSalt } = req.body || {};
  if (!nimcPayload || !pkiSignature || !citizenSecret || !citizenSalt) {
    return res.status(400).json({ error: 'nimcPayload, pkiSignature, citizenSecret, citizenSalt are required' });
  }
  try {
    const cred = await registry.bridgeNIMCToken(nimcPayload, pkiSignature, citizenSecret, citizenSalt);
    res.json({ success: true, commitment: cred.commitment });
  } catch (err) {
    // 'Invalid NIMC PKI signature' → 400 (bad request); everything else → 500.
    res.status(err.message.includes('Invalid') ? 400 : 500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/request — company starts a verification request.
// Body: { rpId, rpName, amanaId?, minScore? }
//
//   amanaId  — the pairwise ID the citizen gave this company (replaces plaintext BVN/NIN).
//              If present, adds 'id_ownership' to the claims list.
//   minScore — optional credit threshold. If present, adds 'credit_score_gte'.
//
// The two base claims (age_gte_18, citizenship_ng) are always included.
// Returns: { requestId, status: 'pending' }
// ---------------------------------------------------------------------------
router.post('/request', async (req, res) => {
  const { rpId, rpName: name, amanaId, minScore } = req.body || {};
  if (!rpId || !name) {
    return res.status(400).json({ error: 'rpId and rpName are required' });
  }

  // Build the claims list from what the company provided.
  // Starting with the two base claims that every company requires.
  const claims = ['age_gte_18', 'citizenship_ng'];
  if (amanaId) claims.push('id_ownership');      // company holds an amanaId → verify ownership
  if (minScore) claims.push('credit_score_gte'); // company requires a credit threshold

  // Revocation gate: if the citizen revoked this company, refuse before
  // anything else happens — and log the blocked attempt for the dashboard.
  // The company learns only that it was "revoked", not why.
  if (await isRevoked(rpId)) {
    await audit(rpId, name, claims, 'blocked');
    return res.status(403).json({ error: 'revoked', message: 'The citizen has revoked access for this company.' });
  }

  // Create the pending request. The nonce is generated here and stored in the row;
  // the wallet picks it up via GET /api/requests/pending and includes it in the proof inputs.
  const r = await pool.query(
    `INSERT INTO requests (rp_id, rp_name, claims, nonce, amana_id, min_score, cutoff_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [rpId, name, claims, newNonce(), amanaId || null, minScore || null, ageCutoffDate()]
  );
  res.json({ requestId: r.rows[0].id, status: 'pending' });
});

// ---------------------------------------------------------------------------
// GET /api/requests/pending — wallet fetches requests awaiting citizen consent.
// Returns all pending requests with the public values the wallet needs to build
// proofs: nonce, cutoff_date, amana_id, min_score.
// ---------------------------------------------------------------------------
router.get('/requests/pending', async (_req, res) => {
  const r = await pool.query(
    `SELECT id, rp_id, rp_name, claims, nonce, amana_id, min_score, cutoff_date, created_at
     FROM requests WHERE status = 'pending' ORDER BY id DESC`
  );
  res.json(r.rows);
});

// ---------------------------------------------------------------------------
// GET /api/requests/:id — company polls a request's current status.
// Returns { id, status, ok, receiptId }.
// ok is true only when status is 'verified'.
// ---------------------------------------------------------------------------
router.get('/requests/:id', async (req, res) => {
  const r = await pool.query(
    'SELECT id, status, receipt_id FROM requests WHERE id = $1',
    [req.params.id]
  );
  if (!r.rowCount) return res.status(404).json({ error: 'not found' });
  const row = r.rows[0];
  res.json({ id: row.id, status: row.status, ok: row.status === 'verified', receiptId: row.receipt_id });
});

// ---------------------------------------------------------------------------
// POST /api/requests/:id/deny — wallet: citizen pressed "Deny".
// Also called by the wallet's approve() flow if proof generation throws
// (a false statement causes the ZK prover to reject, not produce a proof).
// ---------------------------------------------------------------------------
router.post('/requests/:id/deny', async (req, res) => {
  // Only transition from 'pending' to 'denied' — can't deny an already-settled request.
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
// POST /api/verify — wallet submits all ZK proofs for a request.
// Body: { requestId, proofs: { <circuit>: { proof, publicSignals } } }
//
// Verification steps, in order — each one is load-bearing:
//   1. request exists and is still pending  → nonce is single-use (anti-replay)
//   2. company not revoked (could have been revoked after request was created)
//   3. issuer EdDSA signatures are valid on both stored commitments
//   4. every proof's public signals EXACTLY match what this request expects
//      (right commitment, rpId, nonce, amanaId/threshold) — prevents proof splicing
//   5. each Groth16 proof verifies against its circuit's verification key
// ---------------------------------------------------------------------------
router.post('/verify', async (req, res) => {
  const { requestId, proofs } = req.body || {};
  if (!requestId || !proofs) return res.status(400).json({ error: 'requestId and proofs are required' });

  // (1) single-use request: fetch it and confirm it is still pending.
  // If it was already used (or denied), reject with 409 Conflict.
  const rq = await pool.query('SELECT * FROM requests WHERE id = $1', [requestId]);
  if (!rq.rowCount) return res.status(404).json({ error: 'unknown request' });
  const request = rq.rows[0];
  if (request.status !== 'pending') {
    return res.status(409).json({ ok: false, error: 'request already used (replay rejected)' });
  }

  // (2) revocation re-check: the citizen might have revoked between request creation
  // and proof submission. Burn the request status and log it as blocked.
  if (await isRevoked(request.rp_id)) {
    await pool.query(`UPDATE requests SET status = 'denied' WHERE id = $1`, [requestId]);
    await audit(request.rp_id, request.rp_name, request.claims, 'blocked');
    return res.status(403).json({ ok: false, error: 'revoked' });
  }

  // (3) issuer signature check: the commitments in the database must actually be
  // signed by a trusted issuer. A valid SNARK about an unsigned commitment is worthless.
  const idCred = await getCredential('identity');
  if (!registry.verifySignature(idCred)) {
    return res.status(400).json({ ok: false, error: 'registry signature invalid' });
  }
  // Load the credit credential only if a credit claim was requested.
  let creditCred = null;
  if (request.claims.includes('credit_score_gte')) {
    creditCred = await getCredential('credit');
    if (!registry.verifySignature(creditCred)) {
      return res.status(400).json({ ok: false, error: 'credit bureau signature invalid' });
    }
  }

  // (4) expected public signals per circuit.
  // Order matches the {public [...]} declaration in each .circom file exactly.
  // If any value differs (wrong commitment, wrong rpId, stale nonce, wrong amanaId),
  // the signals-match check fails before even running snarkjs — this stops proof splicing.
  const expectedSignals = {
    age_gte_18:       [idCred.commitment, request.rp_id, request.nonce, String(request.cutoff_date)],
    citizenship_ng:   [idCred.commitment, request.rp_id, request.nonce],
    id_ownership:     [idCred.commitment, request.rp_id, request.nonce, request.amana_id],
    // credit uses the bureau's commitment, not the identity one
    credit_score_gte: creditCred && [creditCred.commitment, request.rp_id, request.nonce, String(request.min_score)],
  };

  let allValid = true;
  for (const claim of request.claims) {
    const p = proofs[claim];
    const expected = expectedSignals[claim];

    // Check that the submitted public signals exactly match what we expect.
    // String comparison is safe because both sides are serialised decimal strings.
    const signalsMatch =
      p && expected && Array.isArray(p.publicSignals) &&
      p.publicSignals.length === expected.length &&
      p.publicSignals.every((s, i) => String(s) === expected[i]);

    // (5) the actual Groth16 SNARK verification against the stored verification key.
    // Only runs if signals match — saves CPU on obviously forged submissions.
    const proofValid = signalsMatch && (await snarkjs.groth16.verify(VKEYS[claim], p.publicSignals, p.proof));
    if (!proofValid) {
      console.log(`[verify] request ${requestId}: claim ${claim} FAILED (signalsMatch=${!!signalsMatch})`);
      allValid = false;
    }
  }

  // Record the outcome: flip the request status, write an audit row, and issue a receipt.
  // The receipt ID is a UUID the lender can store as a proof-of-verification audit reference.
  const receiptId = crypto.randomUUID();
  const outcome = allValid ? 'verified' : 'failed';
  await pool.query('UPDATE requests SET status = $1, receipt_id = $2 WHERE id = $3', [outcome, receiptId, requestId]);
  await audit(request.rp_id, request.rp_name, request.claims, outcome, receiptId);

  res.json({ ok: allValid, receiptId });
});

// ---------------------------------------------------------------------------
// GET /api/credential — wallet fetches its stored credentials.
//
// Demo shortcut: a real wallet keeps credentials in on-device secure storage
// and the gateway would never hold the private attrs. Serving them here stands
// in for "the wallet already has its credentials locally".
// ---------------------------------------------------------------------------
router.get('/credential', async (_req, res) => {
  // Shape the raw DB row into the structure the wallet expects.
  const shape = (c) => c && {
    attrs: c.attrs,                       // private fields (demo shortcut — real wallet keeps these locally)
    commitment: c.commitment,             // the public Poseidon hash
    signature: { R8x: c.sig_r8x, R8y: c.sig_r8y, S: c.sig_s }, // issuer's EdDSA signature
    issuerPublicKey: { Ax: c.pub_ax, Ay: c.pub_ay },            // issuer's public key
  };
  const identity = shape(await getCredential('identity'));
  const credit = shape(await getCredential('credit'));
  if (!identity) return res.status(404).json({ error: 'no credential issued yet' });
  res.json({ identity, credit });
});

// ---------------------------------------------------------------------------
// GET /api/audit — dashboard fetches the citizen's full audit trail.
// Returns up to 100 most recent entries, newest first.
// ---------------------------------------------------------------------------
router.get('/audit', async (_req, res) => {
  const r = await pool.query('SELECT * FROM audit_log ORDER BY id DESC LIMIT 100');
  res.json(r.rows);
});

// ---------------------------------------------------------------------------
// POST /api/revoke — dashboard: citizen revokes a company's access.
// Body: { rpId, rpName }
// Inserts a row into revocations; ON CONFLICT DO NOTHING is idempotent.
// ---------------------------------------------------------------------------
router.post('/revoke', async (req, res) => {
  const { rpId, rpName: name } = req.body || {};
  if (!rpId) return res.status(400).json({ error: 'rpId required' });
  await pool.query(
    'INSERT INTO revocations (rp_id, rp_name) VALUES ($1, $2) ON CONFLICT (rp_id) DO NOTHING',
    [rpId, name || rpId]
  );
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/unrevoke — dashboard: citizen restores a company's access.
// Body: { rpId }
// Deletes the revocation row; if none exists, the DELETE is a no-op.
// ---------------------------------------------------------------------------
router.post('/unrevoke', async (req, res) => {
  const { rpId } = req.body || {};
  if (!rpId) return res.status(400).json({ error: 'rpId required' });
  await pool.query('DELETE FROM revocations WHERE rp_id = $1', [rpId]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /api/revocations — dashboard fetches the current revocation list.
// Used to render the Revoke/Restore toggle per company.
// ---------------------------------------------------------------------------
router.get('/revocations', async (_req, res) => {
  const r = await pool.query('SELECT * FROM revocations ORDER BY created_at DESC');
  res.json(r.rows);
});

module.exports = router;
