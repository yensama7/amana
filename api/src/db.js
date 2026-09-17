// db.js — Postgres pool + schema bootstrap.
//
// Schema is created with CREATE TABLE IF NOT EXISTS at boot: no migration
// tooling needed for a hackathon, and re-running is always safe.
const { Pool } = require('pg');

// Single shared connection pool for the entire process.
// DATABASE_URL is set by docker-compose; the fallback is for local development.
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgres://amana:amana@localhost:5432/amana',
});

// All CREATE TABLE statements. Using a single string keeps the boot logic simple —
// it executes as one transaction so either all tables exist or none do.
const SCHEMA = `
-- Signed credentials held by the demo citizen's wallet. Two kinds:
--   'identity' — issued by the national registry (NIN, BVN, DOB, ...)
--   'credit'   — issued by the credit bureau (score, loans, defaults)
-- Both are stored the same way: a sealed commitment + the issuer's
-- signature + the issuer's public key to check that signature against.
CREATE TABLE IF NOT EXISTS credentials (
  kind         TEXT PRIMARY KEY,      -- 'identity' | 'credit'
  attrs        JSONB NOT NULL,        -- the private details incl. wallet secret (demo shortcut: real wallets keep these on-device)
  commitment   TEXT  NOT NULL,        -- the sealed, unreadable hash of those details
  sig_r8x      TEXT  NOT NULL,        -- issuer's EdDSA signature over the commitment (R8 x-coordinate)
  sig_r8y      TEXT  NOT NULL,        -- issuer's EdDSA signature (R8 y-coordinate)
  sig_s        TEXT  NOT NULL,        -- issuer's EdDSA signature (S scalar)
  pub_ax       TEXT  NOT NULL,        -- issuer public key (Ax) — used to verify the signature above
  pub_ay       TEXT  NOT NULL         -- issuer public key (Ay)
);

-- One row per verification request from a company (relying party).
-- The nonce lives here: a request is single-use, which is what makes
-- proof replay impossible (status flips away from 'pending' on first use).
CREATE TABLE IF NOT EXISTS requests (
  id           SERIAL PRIMARY KEY,
  rp_id        TEXT   NOT NULL,
  rp_name      TEXT   NOT NULL,
  claims       TEXT[] NOT NULL,       -- array of circuit IDs the company requires
  nonce        TEXT   NOT NULL,       -- one-time random value (anti-replay)
  amana_id     TEXT,                  -- the pairwise ID the citizen gave this company (id_ownership path)
  min_score    BIGINT,                -- credit score threshold the company requires (credit_score_gte path)
  bvn_hash     TEXT,                  -- legacy path: Poseidon(bvn) if the company already holds a BVN
  cutoff_date  BIGINT NOT NULL,       -- today - 18y as YYYYMMDD, for the age circuit
  status       TEXT   NOT NULL DEFAULT 'pending',  -- pending | verified | failed | denied | blocked
  receipt_id   TEXT,                  -- UUID issued on completion, used as an audit reference by the lender
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Immutable audit trail shown on the citizen's consent dashboard.
-- A row is written for every verification attempt, including denied and blocked ones.
CREATE TABLE IF NOT EXISTS audit_log (
  id           SERIAL PRIMARY KEY,
  rp_id        TEXT   NOT NULL,
  rp_name      TEXT   NOT NULL,
  claims       TEXT[] NOT NULL,       -- what the company asked for
  outcome      TEXT   NOT NULL,       -- verified | failed | denied | blocked | linked
  receipt_id   TEXT,                  -- only set for verified/failed outcomes
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Companies the citizen has revoked. Presence of a row = blocked.
-- The revocation check is the FIRST gate on every /request and /verify call.
CREATE TABLE IF NOT EXISTS revocations (
  rp_id        TEXT PRIMARY KEY,
  rp_name      TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);

`;

// Postgres may still be starting when the API boots (docker compose),
// so retry for up to ~30s before giving up. One attempt per second.
async function initDb() {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await pool.query(SCHEMA);
      return; // success — tables exist, exit the retry loop
    } catch (err) {
      if (attempt === 30) throw err; // give up after 30 tries
      // Wait 1 second before the next attempt.
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

module.exports = { pool, initDb };
