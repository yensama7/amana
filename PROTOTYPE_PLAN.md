# Amana Gateway — Prototype Plan

> **Status: the prototype already exists and runs.** This is not a plan for
> something unbuilt — circuits compile, the gateway + wallet + two lenders +
> dashboard are wired end-to-end, and `api/test/smoke.js` proves the happy path
> and replay rejection. This document scopes what the prototype *is*, marks
> what's real vs. faked, and names the shortest path to the next credible step.
> No prior prototype-plan document existed in the repo when this was written.

## 1. Goal (one sentence)

Prove that a lender can get the KYC answers it needs — *over 18, Nigerian,
owns this ID, credit score ≥ threshold* — as zero-knowledge proofs anchored to a
government signature, **without the citizen ever handing over BVN/NIN/DOB**.

## 2. Scope — what the prototype must show

| # | Capability | Where it lives | Built? |
|---|---|---|---|
| 1 | Government-signed identity → ZK credential | `api/src/pki.js`, `api/src/registry.js` | ✅ |
| 2 | Per-company unlinkable IDs (`Poseidon(secret, companyId)`) | wallet + `credential.circom` | ✅ |
| 3 | Four modular circuits, in-browser proving | `circuits/`, `web/lib/prover.worker.js` | ✅ |
| 4 | Two lenders with *different* proof requirements | `web/app/swift-loan`, `web/app/abc-loan` | ✅ |
| 5 | Consent + audit + revocation | `web/app/dashboard`, `api/src/routes.js` | ✅ |
| 6 | Replay protection (one-time nonce) | gateway verify + smoke test | ✅ |
| 7 | Live "blocked attempt" on revoked ID | dashboard | ✅ |
| 8 | PWA shell + parallel proving + artifact cache | `web/public/sw.js`, worker | ✅ |

**Explicitly out of scope for the prototype** (documented as such in README
"Honest limitations"): multi-party trusted setup, on-device key custody,
separate issuer services with HSM keys, real auth, multi-citizen data.

## 3. Success criteria (demo pass/fail)

1. Apply to Swift Loan with a valid amanaId → `verified: true` + receipt.
2. Apply to ABC Loan (subset of proofs) → `verified: true` — shows modularity.
3. Paste the *wrong* company's amanaId into Swift Loan → verification **fails**.
4. Revoke Swift Loan on the dashboard → next attempt blocked instantly + logged.
5. Replay a captured proof → gateway answers "replay rejected" (nonce burned).
6. `cd api && npm run smoke` passes.

All six are already achievable with `docker compose up -d --build`.

## 4. Build phases (as executed)

- **P0 — Circuits.** 4 modular Circom circuits sharing `credential.circom`;
  `scripts/build-circuits.sh` compiles → local 2^13 ptau → Groth16 → artifacts.
- **P1 — Gateway.** Express on :4000 (host :4200): request/verify/audit/revoke,
  mock issuers, Postgres for `requests / audit_log / linkages / revocation`.
- **P2 — Wallet + lenders.** Next.js PWA; Web Worker proves 4 SNARKs in
  parallel via `Promise.all()`, caches `.wasm`/`.zkey` in the Cache API.
- **P3 — Trust bridge + polish.** `GET /api/trust-bridge/trace` (NIMC PKI→ZK dry
  run), ZKTerminal viz, revocation alerts, frontend handoff docs.

## 5. Known shortcuts → upgrade path (what "productionizing" means next)

| Shortcut (prototype) | Real version |
|---|---|
| Single-party trusted setup | Multi-party ceremony + phase-2 zkey contributions |
| Gateway serves credential (secret+salt) to wallet | On-device key custody; secret never leaves wallet |
| Issuers run in gateway, regen keys per boot | Separate issuer services, long-lived HSM keys |
| One synthetic citizen, no auth | Real onboarding + auth on wallet/dashboard |
| Stale `bvn_match`/`id_linkage` artifacts still in `web/public/zk/` | Delete — circuits removed, artifacts orphaned |

## 6. Immediate cleanup (cheapest wins, do before next demo)

- Remove orphaned `web/public/zk/bvn_match.*` and `id_linkage.*` — their circuits
  were deleted but the compiled artifacts remain (dead weight in the bundle).
</content>
</invoke>
