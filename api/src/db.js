// db.js — Postgres pool + schema bootstrap.
//
// Schema is created with CREATE TABLE IF NOT EXISTS at boot: no migration
// tooling needed for a hackathon, and re-running is always safe.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgres://amana:amana@localhost:5432/amana',
});

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
  sig_r8x      TEXT  NOT NULL,        -- issuer's EdDSA signature over the commitment...
  sig_r8y      TEXT  NOT NULL,
  sig_s        TEXT  NOT NULL,
  pub_ax       TEXT  NOT NULL,        -- ...and the issuer public key it verifies against
  pub_ay       TEXT  NOT NULL
);

-- One row per verification request from a company (relying party).
-- The nonce lives here: a request is single-use, which is what makes
-- proof replay impossible (status flips away from 'pending' on first use).
CREATE TABLE IF NOT EXISTS requests (
  id           SERIAL PRIMARY KEY,
  rp_id        TEXT   NOT NULL,
  rp_name      TEXT   NOT NULL,
  claims       TEXT[] NOT NULL,
  nonce        TEXT   NOT NULL,       -- one-time random value (anti-replay)
  amana_id     TEXT,                  -- the pairwise ID the citizen gave this company
  min_score    BIGINT,                -- credit score threshold the company requires
  bvn_hash     TEXT,                  -- legacy path: Poseidon(bvn) if the company already holds a BVN
  cutoff_date  BIGINT NOT NULL,       -- today - 18y as YYYYMMDD, for the age circuit
  status       TEXT   NOT NULL DEFAULT 'pending',  -- pending | verified | failed | denied
  receipt_id   TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Immutable audit trail shown on the citizen's consent dashboard.
CREATE TABLE IF NOT EXISTS audit_log (
  id           SERIAL PRIMARY KEY,
  rp_id        TEXT   NOT NULL,
  rp_name      TEXT   NOT NULL,
  claims       TEXT[] NOT NULL,
  outcome      TEXT   NOT NULL,       -- verified | failed | denied | blocked | linked
  receipt_id   TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Companies the citizen has revoked. Presence of a row = blocked.
CREATE TABLE IF NOT EXISTS revocations (
  rp_id        TEXT PRIMARY KEY,
  rp_name      TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Citizen-authorised linkages between two of their pairwise IDs
-- (the "permission slips" that let a credit bureau join records).
CREATE TABLE IF NOT EXISTS linkages (
  id           SERIAL PRIMARY KEY,
  nonce        TEXT NOT NULL,         -- one-time value for the linkage proof
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | linked
  rp_a         TEXT,                  -- first company
  id_a         TEXT,                  -- citizen's amanaId there
  rp_b         TEXT,                  -- second company
  id_b         TEXT,                  -- citizen's amanaId there
  created_at   TIMESTAMPTZ DEFAULT now()
);
`;

// Postgres may still be starting when the API boots (docker compose),
// so retry for up to ~30s before giving up.
async function initDb() {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await pool.query(SCHEMA);
      return;
    } catch (err) {
      if (attempt === 30) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

module.exports = { pool, initDb };
