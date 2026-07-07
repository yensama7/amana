// registry.js — the MOCK issuers: national registry + credit bureau.
//
// Plain-language version: two trusted institutions each hand the citizen
// a sealed, signed "envelope":
//
//   National registry (NIMC-style):
//     identity commitment = Poseidon(nin, bvn, dob, state, citizenship, secret, salt)
//   Credit bureau (CRC-style):
//     credit commitment   = Poseidon(score, activeLoans, defaults, secret, salt)
//
// "Sealed" = hashed so nobody can read the contents from the outside.
// "Signed" = the issuer's EdDSA signature proves the institution vouched
// for exactly these contents. Later, ZK proofs let the citizen prove
// facts about what's inside WITHOUT opening the envelope.
//
// The same wallet `secret` goes into BOTH envelopes. That is deliberate:
// it ties the credit history to the same person as the identity, and it
// is the seed from which all shareable amanaIds are derived.
//
// IMPORTANT: the hash input order here must match the circuits exactly
// (circuits/credential.circom and circuits/credit_score_gte.circom).
const crypto = require('crypto');
const { buildPoseidon, buildEddsa } = require('circomlibjs');
const { pool } = require('./db');
const { verifyNIMCSignature, signNIMCPayload } = require('./pki');

// Our synthetic citizen. Every value is kept as a decimal string because
// they are all "field elements" (numbers the ZK math can work with).
const CITIZEN = {
  name: 'Amina Bello (synthetic)',
  nin: '12345678901',   // National Identification Number
  bvn: '22212345678',   // Bank Verification Number
  dob: '19950704',      // 1995-07-04 as YYYYMMDD → 31 years old
  state: '25',          // state-of-origin code (Lagos)
  citizenship: '566',   // ISO 3166-1 numeric for Nigeria
};

// Her (synthetic) credit file at the bureau.
const CREDIT = {
  score: '720',
  activeLoans: '2',
  defaults: '0',
};

let poseidon; // Poseidon hash (same construction the circuits use)
let eddsa;    // EdDSA signatures over Baby Jubjub
let F;        // field helpers for hashing (poseidon's field)
let Fb;       // field helpers for signatures (same field, different instance)

// Build the wasm-backed crypto objects once at startup (they're async to load).
async function init() {
  poseidon = await buildPoseidon();
  eddsa = await buildEddsa();
  F = poseidon.F;
  Fb = eddsa.babyJub.F;
}

// Poseidon over an array of decimal-string values -> decimal string.
function hash(values) {
  return F.toString(poseidon(values.map(BigInt)));
}

// One random field element (used for secrets, salts, nonces).
function randomField() {
  return BigInt('0x' + crypto.randomBytes(16).toString('hex')).toString();
}

// Sign a commitment with a fresh issuer keypair and store the credential.
// Fresh keys per boot are fine for a demo — the credential is re-signed at
// the same time. A real issuer has a long-lived key in secure hardware.
async function issue(kind, attrs, commitment) {
  const prvKey = crypto.randomBytes(32);
  const pubKey = eddsa.prv2pub(prvKey);
  const sig = eddsa.signPoseidon(prvKey, Fb.e(commitment));

  await pool.query(
    `INSERT INTO credentials (kind, attrs, commitment, sig_r8x, sig_r8y, sig_s, pub_ax, pub_ay)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (kind) DO UPDATE SET
       attrs = EXCLUDED.attrs, commitment = EXCLUDED.commitment,
       sig_r8x = EXCLUDED.sig_r8x, sig_r8y = EXCLUDED.sig_r8y, sig_s = EXCLUDED.sig_s,
       pub_ax = EXCLUDED.pub_ax, pub_ay = EXCLUDED.pub_ay`,
    [
      kind,
      JSON.stringify(attrs),
      commitment,
      Fb.toString(sig.R8[0]),
      Fb.toString(sig.R8[1]),
      sig.S.toString(),
      Fb.toString(pubKey[0]),
      Fb.toString(pubKey[1]),
    ]
  );
}

// Trust Bridge: verify NIMC PKI sig out-of-circuit, re-hash with Poseidon,
// sign with EdDSA, store as ZK-friendly identity credential.
async function bridgeNIMCToken(nimcPayload, pkiSignature, citizenSecret, citizenSalt) {
  if (!verifyNIMCSignature(nimcPayload, pkiSignature)) {
    throw new Error('Invalid NIMC PKI signature');
  }
  const commitment = hash([
    nimcPayload.nin, nimcPayload.bvn, nimcPayload.dob,
    nimcPayload.state, nimcPayload.citizenship,
    citizenSecret, citizenSalt,
  ]);
  await issue('identity', { ...nimcPayload, secret: citizenSecret, salt: citizenSalt }, commitment);
  const r = await pool.query('SELECT * FROM credentials WHERE kind = $1', ['identity']);
  return r.rows[0];
}

// Issue (or re-issue) both demo credentials. Runs on every boot; the data
// is synthetic so overwriting is harmless and keeps the demo self-healing.
async function seed() {
  const secret = randomField();

  // identity via Trust Bridge — NIMC signs with RSA, gateway verifies then re-issues ZK-friendly credential
  const salt = randomField();
  const pkiSig = signNIMCPayload(CITIZEN);
  const idCred = await bridgeNIMCToken(CITIZEN, pkiSig, secret, salt);

  // --- credit credential (credit bureau) — same secret, own salt ---
  const creditSalt = randomField();
  const crAttrs = { ...CREDIT, secret, salt: creditSalt };
  const crCommitment = hash([crAttrs.score, crAttrs.activeLoans, crAttrs.defaults, secret, creditSalt]);
  await issue('credit', crAttrs, crCommitment);

  console.log('[registry] identity credential issued, commitment =', idCred.commitment.slice(0, 20) + '…');
  console.log('[bureau]   credit credential issued, commitment =', crCommitment.slice(0, 20) + '…');
}

// Check an issuer's EdDSA signature on a stored credential row.
// Called by the gateway on every /verify — a proof about an unsigned (or
// tampered) commitment is worthless no matter how valid the SNARK is.
function verifySignature(cred) {
  const sig = {
    R8: [Fb.e(cred.sig_r8x), Fb.e(cred.sig_r8y)],
    S: BigInt(cred.sig_s),
  };
  const pubKey = [Fb.e(cred.pub_ax), Fb.e(cred.pub_ay)];
  return eddsa.verifyPoseidon(Fb.e(cred.commitment), sig, pubKey);
}

module.exports = { init, seed, hash, verifySignature, bridgeNIMCToken };
