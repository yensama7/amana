#!/usr/bin/env bash
#
# build-circuits.sh — one-shot ZK artifact builder for Amana Gateway.
#
# For each circuit (age_gte_18, citizenship_ng, id_ownership, credit_score_gte) this script:
#   1. compiles the .circom source to R1CS + a witness-generator .wasm
#   2. runs a LOCAL powers-of-tau ceremony (2^13 — our circuits are only
#      a few hundred constraints each, so this is generous and fast)
#   3. runs the Groth16 phase-2 setup to produce a proving key (.zkey)
#   4. exports the verification key for the gateway
#
# Outputs:
#   web/public/zk/<circuit>.wasm + .zkey   -> served statically to the browser
#   api/zk/<circuit>.vkey.json             -> used by the gateway to verify
#
# SECURITY NOTE: this is a single-party dev "ceremony" with no external
# contributions. Perfect for a hackathon, NOT for production — a real
# deployment needs a multi-party trusted setup.
#
# Prereqs: circom >= 2.1 on PATH, snarkjs on PATH (npm i -g snarkjs), node.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build"
CIRCUITS=(age_gte_18 citizenship_ng id_ownership credit_score_gte)

mkdir -p "$BUILD" "$ROOT/web/public/zk" "$ROOT/api/zk"

# circomlib (Poseidon, comparators) is pulled in as an npm package so the
# circuits can `include "circomlib/circuits/..."` via the -l search path.
if [ ! -d "$ROOT/circuits/node_modules/circomlib" ]; then
  (cd "$ROOT/circuits" && npm install --no-audit --no-fund)
fi

# ---- powers of tau (phase 1, circuit-independent, cached) ----
PTAU="$BUILD/pot13_final.ptau"
if [ ! -f "$PTAU" ]; then
  echo "==> generating local powers-of-tau (2^13)..."
  snarkjs powersoftau new bn128 13 "$BUILD/pot13_0000.ptau" -v
  snarkjs powersoftau contribute "$BUILD/pot13_0000.ptau" "$BUILD/pot13_0001.ptau" \
    --name="amana dev" -e="amana gateway dev entropy $(date +%s)" -v
  snarkjs powersoftau prepare phase2 "$BUILD/pot13_0001.ptau" "$PTAU" -v
fi

# ---- per-circuit: compile + phase-2 setup + export artifacts ----
for c in "${CIRCUITS[@]}"; do
  echo "==> building circuit: $c"
  circom "$ROOT/circuits/$c.circom" --r1cs --wasm -o "$BUILD" -l "$ROOT/circuits/node_modules"

  # dev-mode zkey: no phase-2 contributions (see security note above)
  snarkjs groth16 setup "$BUILD/$c.r1cs" "$PTAU" "$BUILD/$c.zkey"
  snarkjs zkey export verificationkey "$BUILD/$c.zkey" "$ROOT/api/zk/$c.vkey.json"

  cp "$BUILD/${c}_js/$c.wasm" "$ROOT/web/public/zk/$c.wasm"
  cp "$BUILD/$c.zkey"         "$ROOT/web/public/zk/$c.zkey"

  # print constraint counts so we can brag about how small the circuits are
  snarkjs r1cs info "$BUILD/$c.r1cs" | grep -i constraints || true
done

echo "==> done. wasm/zkey in web/public/zk, verification keys in api/zk."
