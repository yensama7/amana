# Amana Gateway 🛡

**Prove facts, not data.**

Amana Gateway is a demo of a different way to do identity checks (KYC). Today, when you apply for a loan, you hand over your BVN, your NIN, your date of birth — your whole identity — and hope every company stores it safely. With Amana, you hand over **answers instead of data**: "over 18? — yes", "Nigerian? — yes", "creditworthy? — yes". The company gets the answers it needs, cryptographically guaranteed by the government's own signature, and your actual information never leaves your phone.

The magic ingredient is called a **zero-knowledge proof**: a piece of math that lets you prove a statement is true *without revealing why it's true*. Prove you're over 18 without showing your birthday. Prove your credit score clears a bar without showing the score.

## Run it

You need [Docker](https://www.docker.com/products/docker-desktop/) installed. Then, in this folder:

```bash
docker compose up -d --build
```

The first build takes a few minutes (it compiles the cryptographic circuits). When it settles, open **http://localhost:3000**.

## The demo

Open four browser tabs: **Amana Way** (the citizen wallet), **Swift Loan**, **ABC Loan**, and **Consent Dashboard** (all linked from the home page).

1. **Amana Way** — see your two sealed credentials (identity, signed by the National Registry; credit file, signed by the credit bureau) and your **amanaIds**, one per company. Copy the Swift Loan one.
2. **Swift Loan** — paste the ID and apply. Notice what's *missing*: no BVN or NIN field. Swift Loan asks for four proofs: over 18, Nigerian citizen, ID ownership, and credit score ≥ 600. The lender only ever gets an opaque code.
3. **ABC Loan** — click "Check eligibility" (no ID to paste — ABC Loan only needs to know you're over 18 and a Nigerian citizen). This demonstrates that ZK is **modular**: each lender requests exactly the proofs it needs, nothing more.
4. **Amana Way** — consent requests appear for each pending application, listing *exactly* what each lender wants proven. Approve them. Watch proofs generate in your browser (the ticking counter shows the page never freezes — the heavy math runs on parallel background threads). Each lender receives **verified: true** and a receipt. Nothing else.
5. **Dashboard** — see the full audit trail (who asked, what, when, outcome), then hit **Revoke** on Swift Loan and try applying again: blocked instantly, and the blocked attempt is logged too.

**Try to cheat:** paste your ABC Loan ID (or any random number) into Swift Loan's form. Verification fails — the math simply refuses to produce a proof for an ID that isn't yours *at that company*. That's the whole point: a stolen amanaId is worthless.

## See what happens under the hood (NIMC Act 2026 — Trust Bridge)

Open this URL while the stack is running:

```
http://localhost:4200/api/trust-bridge/trace
```

The Gateway runs the full **National PKI to ZK Trust Bridge** live and returns a step-by-step JSON you can read in any browser or paste into a JSON viewer. You will see:

| Step | What it shows |
|---|---|
| **1 — NIMC RSA signature** | The government's raw digital stamp on the citizen's identity payload (NIN, BVN, DOB, state, citizenship), signed with RSA-2048 |
| **2 — Out-of-circuit verification** | The Gateway's `VALID` result from verifying that stamp using standard cryptography — this is the step the NIMC Act 2026 requires |
| **3 — Poseidon re-hash** | The same identity data, re-hashed with Poseidon in the exact input order the ZK circuits expect |
| **4 — BabyJubjub EdDSA signature** | The ZK-friendly signature (R8x, R8y, S) and public key the citizen's wallet will use to generate Groth16 proofs |
| **5 — Credential ready** | The final commitment that anchors every proof in the demo |

The trace is a dry run — it does not write to the database or affect the live session. Every call generates fresh values so you can see the cryptography is live, not cached.

## Why this design matters (in plain words)

**The BVN problem.** Your BVN does two jobs at once: it *points* to your records, and knowing it is treated as *proof it's yours*. That second job is why leaked BVNs are dangerous. Amana splits the jobs: the amanaId only points; ZK proofs do all the proving. Numbers stop being secrets worth stealing.

**One ID per company.** Your Swift Loan ID and your ABC Loan ID are different, and no one can tell they belong to the same person. Companies can't quietly merge their files about you. When merging is *useful to you* (building your credit history), you grant it explicitly — one click, one proof, one audit line, one revocable decision.

**Your history lives with you.** The credit bureau doesn't get queried behind your back. It issues your wallet a sealed credit credential, and lenders ask *your wallet* — which answers only "score ≥ 650: true" and keeps the rest private.

**Nothing works without the government's signature.** Every proof is anchored to a credential signed by the issuing authority. You can't invent attributes; the math checks them against the sealed, signed record.

**Nothing can be replayed.** Every verification carries a one-time number (a nonce). A recorded proof is useless a second time — the gateway literally answers "replay rejected".

---

## For the technical reader

### Architecture

```
┌─────────────┐  1. request + amanaId          ┌──────────────────┐
│  SwiftLoan   │ ─────────────────────────────> │                  │
│  (mock RP)   │ <───────── 5. true + receipt ── │   Amana Gateway  │──── audit log ───┐
└─────────────┘                                 │  (Express, :4000)│                  │
                                                │  verifies:       │    ┌───────────┐ │
┌─────────────┐  2. pending request (nonce,     │  · EdDSA sigs    │    │ Postgres  │<┘
│   Citizen    │ <──── cutoffDate, minScore) ─── │  · nonce unused  │    │ requests  │
│   Wallet     │                                 │  · pub signals   │    │ audit_log │
│  (Next.js)   │ ──── 4. four Groth16 proofs ──> │  · 4 × SNARK     │    │ linkages  │
│  Web Worker  │                                 └──────────────────┘    │ revocation│
└─────────────┘                                        ▲    ▲            └───────────┘
      ▲            ┌────────────────┐   signs identity │    │ signs credit
      │ 3. consent │ National       │───────────────────┘    │
      │            │ Registry (mock)│      ┌─────────────────┴───┐
      │            └────────────────┘      │ Credit Bureau (mock)│
      │                                    └─────────────────────┘
identity commitment = Poseidon(nin, bvn, dob, state, citizenship, secret, salt)
credit commitment   = Poseidon(score, activeLoans, defaults, secret, salt)
amanaId(company)    = Poseidon(secret, companyId)     ← pairwise, unlinkable
```

Issuer signatures (EdDSA over Baby Jubjub) are verified **outside** the circuits, keeping every circuit at a few hundred constraints — that's what makes in-browser proving near-instant.

### The four circuits (`circuits/`)

| Circuit | Statement proven | Extra public inputs |
|---|---|---|
| `age_gte_18` | committed `dob ≤ cutoffDate` (YYYYMMDD compare) | `cutoffDate` |
| `citizenship_ng` | committed citizenship = 566 (ISO code, Nigeria) | — |
| `id_ownership` | `Poseidon(secret, rpId) = amanaId` for the committed secret | `amanaId` |
| `credit_score_gte` | committed `score ≥ minScore` (bureau-signed commitment) | `minScore` |

All bind the citizen's private attributes to the issuer-signed commitment (shared `credential.circom`), and all carry `rpId` + one-time `nonce` as public inputs for replay protection.

### Repo layout

```
circuits/            Circom sources (+ shared credential.circom)
scripts/build-circuits.sh   compile → local ptau (2^13) → Groth16 setup → export artifacts
api/                 Express gateway + mock issuers (src/), smoke test (test/)
web/                 Next.js PWA: /wallet, /dashboard, /swift-loan, /abc-loan; prover Web Worker in lib/
Dockerfile           3 stages: circuits → api → web (compose picks per-service targets)
docker-compose.yml   postgres + api (host :4200 → container :4000) + web (:3000)
```

### API surface (gateway — `http://localhost:4200` from the host, `http://api:4000` in-network)

> Why 4200? Windows/Hyper-V frequently reserves the 3900–4100 port range, so
> compose publishes the gateway on host port 4200 instead of 4000.

| Method & path | Who calls it | Purpose |
|---|---|---|
| `POST /api/request` | company | `{rpId, rpName, amanaId?, minScore?}` → claims derived from what was asked; **403 if revoked** |
| `GET /api/requests/pending` | wallet | consent requests awaiting the citizen |
| `GET /api/requests/:id` | company | poll outcome `{status, ok, receiptId}` |
| `POST /api/requests/:id/deny` | wallet | citizen denied (or proving failed) |
| `POST /api/verify` | wallet | submit `{requestId, proofs}` → full verification → `{ok, receiptId}` |
| `GET /api/credential` | wallet | both signed credentials (demo stand-in for on-device storage) |
| `GET /api/audit` | dashboard | who asked, what, outcome |
| `GET /api/trust-bridge/trace` | judges / demo | dry-run the full NIMC PKI → ZK Trust Bridge; returns step-by-step JSON with RSA sig, Poseidon commitment, EdDSA output — no DB write |
| `POST /api/citizen/onboard` | onboarding | `{nimcPayload, pkiSignature, citizenSecret, citizenSalt}` → verifies RSA sig, issues ZK credential, returns `{success, commitment}` |
| `POST /api/revoke` / `/api/unrevoke`, `GET /api/revocations` | dashboard | per-company blocking |

### Running without Docker (dev)

```bash
# 1. circuits (needs circom >= 2.1 and `npm i -g snarkjs` on PATH)
bash scripts/build-circuits.sh

# 2. postgres — any instance works, e.g.:
docker run -d -p 5432:5432 -e POSTGRES_USER=amana -e POSTGRES_PASSWORD=amana -e POSTGRES_DB=amana postgres:16-alpine

# 3. gateway (pick a free port — 4000 is often Windows-reserved)
cd api && npm install && PORT=4200 npm start

# 4. frontend
cd web && npm install && API_URL=http://localhost:4200 npm run dev   # :3000, proxies /api
```

### Smoke test

With the stack running and circuits built locally (step 1 above):

```bash
cd api && npm run smoke
```

It plays company + wallet from Node: opens a request with an amanaId, generates all four proofs in parallel, asserts the gateway returns `true`, then replays the same proofs and asserts rejection (nonce burned).

### Honest limitations (hackathon shortcuts)

- **Single-party trusted setup** in `build-circuits.sh` — a real deployment needs a multi-party ceremony and phase-2 zkey contributions.
- **The gateway serves the credentials** (attributes + secret + salt) to the wallet via `GET /api/credential`. A real wallet keeps these on-device; this stands in for provisioning.
- **Both mock issuers live in the gateway process** and regenerate their keypairs per boot; the wallet secret is generated by the issuer instead of the wallet. Real issuers are separate services with long-lived HSM keys, and the secret never leaves the wallet.
- **One synthetic citizen, no auth** on wallet/dashboard routes.
- **PWA**: manifest + service worker registered for offline shell caching; no background sync or push notifications.
- Age check ignores leap-day pedantry (YYYYMMDD integer compare — off by at most one day for Feb 29 birthdays).
