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
// BigInt('566') fits in the BN254 field; so do all the other values here.
const CITIZEN = {
  name: 'Amina Bello (synthetic)',
  nin: '12345678901',   // National Identification Number (11 digits)
  bvn: '22212345678',   // Bank Verification Number (11 digits)
  dob: '19950704',      // 1995-07-04 as YYYYMMDD — 31 years old at demo date
  state: '25',          // state-of-origin code (Lagos = 25)
  citizenship: '566',   // ISO 3166-1 numeric for Nigeria
};

// Her (synthetic) credit file at the bureau.
// score: 720 is above both Swift Loan's 600 threshold and the smoke test's 650 threshold.
const CREDIT = {
  score: '720',
  activeLoans: '2',
  defaults: '0',
};

// Module-level singletons loaded once in init().
let poseidon; // Poseidon hash function (same construction the circuits use)
let eddsa;    // EdDSA over Baby Jubjub — the signature scheme ZK circuits can verify
let F;        // Poseidon's field helper (toString, e, etc.)
let Fb;       // EdDSA's Baby Jubjub field helper

// Build the wasm-backed crypto objects once at startup.
// Both are async because they load compiled WebAssembly from disk the first time.
// All functions below depend on these being initialised; call await init() first.
async function init() {
  poseidon = await buildPoseidon();
  eddsa = await buildEddsa();
  F = poseidon.F;   // field helpers for Poseidon outputs
  Fb = eddsa.babyJub.F; // field helpers for EdDSA / Baby Jubjub operations
}

// Poseidon hash over an array of decimal-string values — returns a decimal string.
// Converts each input to BigInt first because Poseidon's wasm expects BigInt values.
// The output is normalised to a decimal string to match Circom's F.toString convention.
function hash(values) {
  return F.toString(poseidon(values.map(BigInt)));
}

// Generate one cryptographically random field element as a decimal string.
// Used for wallet secrets, credential salts, and nonces.
// 16 random bytes = 128 bits of entropy — sufficient for all three uses.
function randomField() {
  return BigInt('0x' + crypto.randomBytes(16).toString('hex')).toString();
}

// Sign a commitment with a fresh issuer keypair and write the credential to the database.
// The keypair is fresh per-boot: fine for a demo where the credential is re-signed on
// every restart. A real issuer uses a long-lived key in secure hardware (HSM).
//
// ON CONFLICT DO UPDATE means re-seeding on restart overwrites the previous row,
// keeping the database self-consistent with the in-memory keys.
async function issue(kind, attrs, commitment) {
  // Generate a fresh EdDSA key for this issuer (registry or bureau).
  const prvKey = crypto.randomBytes(32);
  const pubKey = eddsa.prv2pub(prvKey);

  // signPoseidon expects a Baby Jubjub field element, so we convert the commitment string.
  const sig = eddsa.signPoseidon(prvKey, Fb.e(commitment));

  await pool.query(
    // Upsert: if a credential of this kind already exists (from a previous boot), overwrite it.
    `INSERT INTO credentials (kind, attrs, commitment, sig_r8x, sig_r8y, sig_s, pub_ax, pub_ay)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (kind) DO UPDATE SET
       attrs = EXCLUDED.attrs, commitment = EXCLUDED.commitment,
       sig_r8x = EXCLUDED.sig_r8x, sig_r8y = EXCLUDED.sig_r8y, sig_s = EXCLUDED.sig_s,
       pub_ax = EXCLUDED.pub_ax, pub_ay = EXCLUDED.pub_ay`,
    [
      kind,
      JSON.stringify(attrs),    // stored as JSONB — includes private fields for demo shortcut
      commitment,               // the Poseidon hash of all fields
      Fb.toString(sig.R8[0]),   // EdDSA signature component R8.x
      Fb.toString(sig.R8[1]),   // EdDSA signature component R8.y
      sig.S.toString(),         // EdDSA signature scalar S
      Fb.toString(pubKey[0]),   // issuer public key Ax (Baby Jubjub x-coordinate)
      Fb.toString(pubKey[1]),   // issuer public key Ay (Baby Jubjub y-coordinate)
    ]
  );
}

// Trust Bridge: verify NIMC PKI sig out-of-circuit, re-hash with Poseidon,
// sign with EdDSA, store as ZK-friendly identity credential.
//
// This is the conversion step from the legacy PKI world to the ZK world:
//   RSA signature verified here (Node crypto) → Poseidon commitment → EdDSA signed.
async function bridgeNIMCToken(nimcPayload, pkiSignature, citizenSecret, citizenSalt) {
  // Step 1: verify the government's RSA signature. If invalid, reject immediately —
  // there is no point issuing a ZK credential for data that wasn't signed by NIMC.
  if (!verifyNIMCSignature(nimcPayload, pkiSignature)) {
    throw new Error('Invalid NIMC PKI signature');
  }

  // Step 2: re-hash with Poseidon using the citizen's secret and salt.
  // Input order must match circuits/credential.circom (7 inputs in this exact order).
  const commitment = hash([
    nimcPayload.nin, nimcPayload.bvn, nimcPayload.dob,
    nimcPayload.state, nimcPayload.citizenship,
    citizenSecret, citizenSalt,
  ]);

  // Step 3: store the ZK-friendly credential (EdDSA-signed Poseidon commitment).
  await issue('identity', { ...nimcPayload, secret: citizenSecret, salt: citizenSalt }, commitment);

  // Return the newly written row so callers can log the commitment.
  const r = await pool.query('SELECT * FROM credentials WHERE kind = $1', ['identity']);
  return r.rows[0];
}

// Issue (or re-issue) both demo credentials. Runs on every boot; the data
// is synthetic so overwriting is harmless and keeps the demo self-healing.
// Both credentials share the same `secret` — this is what binds identity to credit.
async function seed() {
  // One secret for both credentials — ties credit history to the same wallet as identity.
  const secret = randomField();

  // Identity credential via the Trust Bridge:
  //   1. Sign the citizen payload with the demo NIMC RSA key.
  //   2. Pass it through bridgeNIMCToken to get a Poseidon-hashed, EdDSA-signed credential.
  const salt = randomField();
  const pkiSig = signNIMCPayload(CITIZEN);
  const idCred = await bridgeNIMCToken(CITIZEN, pkiSig, secret, salt);

  // Credit credential — issued directly by the (mock) bureau.
  // Uses a separate salt but the same wallet secret so the two credentials are linked.
  const creditSalt = randomField();
  const crAttrs = { ...CREDIT, secret, salt: creditSalt };
  // Hash input order must match circuits/credit_score_gte.circom (5 inputs).
  const crCommitment = hash([crAttrs.score, crAttrs.activeLoans, crAttrs.defaults, secret, creditSalt]);
  await issue('credit', crAttrs, crCommitment);

  console.log('[registry] identity credential issued, commitment =', idCred.commitment.slice(0, 20) + '…');
  console.log('[bureau]   credit credential issued, commitment =', crCommitment.slice(0, 20) + '…');
}

// Verify an issuer's EdDSA signature on a stored credential row.
// Called by routes.js on every /verify before running the Groth16 checks.
//
// A proof about an unsigned (or tampered) commitment is worthless no matter
// how valid the SNARK is — the signature check is the chain-of-trust anchor.
function verifySignature(cred) {
  // Reconstruct the signature and public key objects from the stored string values.
  const sig = {
    R8: [Fb.e(cred.sig_r8x), Fb.e(cred.sig_r8y)], // Baby Jubjub point R8
    S: BigInt(cred.sig_s),                           // scalar S
  };
  const pubKey = [Fb.e(cred.pub_ax), Fb.e(cred.pub_ay)];

  // verifyPoseidon checks that the EdDSA signature over the commitment is valid.
  // Returns true if the issuer's key signed exactly this commitment string.
  return eddsa.verifyPoseidon(Fb.e(cred.commitment), sig, pubKey);
}

// Dry-run the full Trust Bridge and return every intermediate value as a structured object.
// No database write — safe to call repeatedly without affecting live credentials.
//
// This endpoint exists for judges: GET /api/trust-bridge/trace shows the entire
// RSA→Poseidon→EdDSA conversion in one JSON response, with plain-English explanations
// at each step.
async function traceNIMCBridge() {
  // Use fresh throwaway keys so the trace never conflicts with seeded credentials.
  const secret = randomField();
  const salt = randomField();

  // Step 1: NIMC signs the citizen payload (RSA-SHA256, just like HTTPS).
  const pkiSignature = signNIMCPayload(CITIZEN);
  const pkiValid = verifyNIMCSignature(CITIZEN, pkiSignature);

  // Step 2: Assemble the 7 inputs that will be Poseidon-hashed.
  const inputs = [
    CITIZEN.nin, CITIZEN.bvn, CITIZEN.dob,
    CITIZEN.state, CITIZEN.citizenship,
    secret, salt,
  ];
  const commitment = hash(inputs);

  // Step 3: Sign the commitment with a fresh EdDSA keypair.
  const prvKey = crypto.randomBytes(32);
  const pubKey = eddsa.prv2pub(prvKey);
  const sig = eddsa.signPoseidon(prvKey, Fb.e(commitment));

  // Return a structured trace with step-by-step descriptions for the judge view.
  return {
    description: 'National PKI to ZK Trust Bridge — live trace (no DB write)',
    why: 'RSA (used by NIMC) costs tens of thousands of constraints inside a ZK circuit — too slow for a mobile device. The Gateway verifies it once, out-of-circuit, then re-issues a ZK-friendly credential the phone can work with.',
    steps: [
      {
        step: 1,
        name: 'NIMC signs citizen payload (RSA-2048 / SHA-256)',
        what: 'The government authority signs the raw identity data with its root private key. This is the official government stamp.',
        output: {
          payload: {
            nin: CITIZEN.nin, bvn: CITIZEN.bvn, dob: CITIZEN.dob,
            state: CITIZEN.state, citizenship: CITIZEN.citizenship,
          },
          // Truncate the signature for readability — full hex is ~512 chars.
          signature: pkiSignature.slice(0, 64) + '…',
          algorithm: 'RSA-SHA256',
        },
      },
      {
        step: 2,
        name: 'Gateway verifies RSA signature (out-of-circuit)',
        what: "Standard crypto.createVerify('SHA256') — the same cryptography HTTPS uses. No ZK circuit involved. If this fails, the flow stops here.",
        output: { valid: pkiValid },
      },
      {
        step: 3,
        name: 'Poseidon re-hash (ZK-friendly)',
        what: 'The identity data is re-hashed with Poseidon — designed to cost ~250 constraints inside a ZK circuit vs tens of thousands for SHA-256. The input order is fixed and must match the Circom circuits exactly.',
        output: {
          inputOrder: ['nin', 'bvn', 'dob', 'state', 'citizenship', 'secret', 'salt'],
          commitment,
        },
      },
      {
        step: 4,
        name: 'BabyJubjub EdDSA signature',
        what: 'The commitment is signed with a ZK-friendly elliptic curve key. A Circom circuit can verify this signature efficiently — this is what makes in-browser ZK proving fast.',
        output: {
          R8x: Fb.toString(sig.R8[0]),
          R8y: Fb.toString(sig.R8[1]),
          S: sig.S.toString(),
          pubKey_Ax: Fb.toString(pubKey[0]),
          pubKey_Ay: Fb.toString(pubKey[1]),
        },
      },
      {
        step: 5,
        name: 'ZK-friendly credential ready',
        what: "In the live flow this is saved to the database. The citizen's wallet can now generate Groth16 proofs using only the Poseidon commitment and EdDSA signature — the original RSA signature is never seen again.",
        output: { kind: 'identity', commitment },
      },
    ],
    summary: 'Government RSA signature verified out-of-circuit (step 2). Poseidon + EdDSA credential issued (steps 3–4). Chain of trust: NIMC root key → Gateway verification → ZK credential. The citizen never needs to expose their NIN, BVN, or DOB to any company.',
  };
}

module.exports = { init, seed, hash, verifySignature, bridgeNIMCToken, traceNIMCBridge };
