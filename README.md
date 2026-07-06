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

## The 6-step demo

Open three browser tabs: **Citizen Wallet**, **SwiftLoan**, and **Consent Dashboard** (all linked from the home page).

1. **Wallet** — see your two sealed credentials (identity, signed by the National Registry; credit file, signed by the credit bureau) and your **amanaIds**. Copy the SwiftLoan one.
2. **SwiftLoan** — paste the ID and apply for a loan. Notice what's *missing*: there is no BVN or NIN field anywhere. The lender only ever gets an opaque code.
3. **Wallet** — a consent request pops up, listing *exactly* what SwiftLoan wants proven: over 18, Nigerian citizen, this ID is really yours, credit score ≥ 650. Approve it.
4. Watch four proofs generate in your browser (the ticking counter shows the page never freezes — the heavy math runs on a background thread). SwiftLoan receives **verified: true** and a receipt. Nothing else.
5. **Wallet** — click **"Authorise SwiftLoan ↔ GTBank link"**. Your IDs at different companies are normally *mathematically impossible to connect* — this button is your signed, logged permission slip letting the credit bureau connect them to build your credit history. It appears on your dashboard like everything else.
6. **Dashboard** — see the full audit trail (who asked, what, when, outcome), then hit **Revoke** on SwiftLoan and try applying again: blocked instantly, and the blocked attempt is logged too.

**Try to cheat:** paste your GTBank ID (or any random number) into SwiftLoan's form. Verification fails — the math simply refuses to produce a proof for an ID that isn't yours *at that company*. That's the whole point: a stolen amanaId is worthless.

## Why this design matters (in plain words)

**The BVN problem.** Your BVN does two jobs at once: it *points* to your records, and knowing it is treated as *proof it's yours*. That second job is why leaked BVNs are dangerous. Amana splits the jobs: the amanaId only points; ZK proofs do all the proving. Numbers stop being secrets worth stealing.

**One ID per company.** Your SwiftLoan ID and your GTBank ID are different, and no one can tell they belong to the same person. Companies can't quietly merge their files about you. When merging is *useful to you* (building your credit history), you grant it explicitly — one click, one proof, one audit line, one revocable decision.

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

### The six circuits (`circuits/`)

| Circuit | Statement proven | Extra public inputs |
|---|---|---|
| `age_gte_18` | committed `dob ≤ cutoffDate` (YYYYMMDD compare) | `cutoffDate` |
| `citizenship_ng` | committed citizenship = 566 (ISO code, Nigeria) | — |
| `id_ownership` | `Poseidon(secret, rpId) = amanaId` for the committed secret | `amanaId` |
| `credit_score_gte` | committed `score ≥ minScore` (bureau-signed commitment) | `minScore` |
| `id_linkage` | two amanaIds derive from the same committed secret | `rpIdA, idA, rpIdB, idB` |
| `bvn_match` | committed BVN hashes to the RP-supplied `Poseidon(bvn)` — legacy/hybrid path for RPs that already hold a BVN | `bvnHash` |

All bind the citizen's private attributes to the issuer-signed commitment (shared `credential.circom`), and all carry `rpId` + one-time `nonce` as public inputs for replay protection.

### Repo layout

```
circuits/            Circom sources (+ shared credential.circom)
scripts/build-circuits.sh   compile → local ptau (2^13) → Groth16 setup → export artifacts
api/                 Express gateway + mock issuers (src/), smoke test (test/)
web/                 Next.js PWA: /wallet, /dashboard, /loan; prover Web Worker in lib/
Dockerfile           3 stages: circuits → api → web (compose picks per-service targets)
docker-compose.yml   postgres + api (host :4200 → container :4000) + web (:3000)
```

### API surface (gateway — `http://localhost:4200` from the host, `http://api:4000` in-network)

> Why 4200? Windows/Hyper-V frequently reserves the 3900–4100 port range, so
> compose publishes the gateway on host port 4200 instead of 4000.

| Method & path | Who calls it | Purpose |
|---|---|---|
| `POST /api/request` | company | `{rpId, rpName, amanaId, minScore?, bvnHash?}` → claims derived from what was asked; **403 if revoked** |
| `GET /api/requests/pending` | wallet | consent requests awaiting the citizen |
| `GET /api/requests/:id` | company | poll outcome `{status, ok, receiptId}` |
| `POST /api/requests/:id/deny` | wallet | citizen denied (or proving failed) |
| `POST /api/verify` | wallet | submit `{requestId, proofs}` → full verification → `{ok, receiptId}` |
| `POST /api/linkage/start` / `/api/linkage/complete` | wallet | consent-based ID linkage (id_linkage proof) |
| `GET /api/credential` | wallet | both signed credentials (demo stand-in for on-device storage) |
| `GET /api/audit` | dashboard | who asked, what, outcome |
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

It plays company + wallet from Node: opens a request with an amanaId, generates all four proofs, asserts the gateway returns `true`, replays the proofs and asserts rejection, then runs a full linkage authorisation and asserts it's accepted.

### Honest limitations (hackathon shortcuts)

- **Single-party trusted setup** in `build-circuits.sh` — a real deployment needs a multi-party ceremony and phase-2 zkey contributions.
- **The gateway serves the credentials** (attributes + secret + salt) to the wallet via `GET /api/credential`. A real wallet keeps these on-device; this stands in for provisioning.
- **Both mock issuers live in the gateway process** and regenerate their keypairs per boot; the wallet secret is generated by the issuer instead of the wallet. Real issuers are separate services with long-lived HSM keys, and the secret never leaves the wallet.
- **One synthetic citizen, no auth** on wallet/dashboard routes.
- **PWA-lite**: manifest only, no offline service worker.
- Age check ignores leap-day pedantry (YYYYMMDD integer compare — off by at most one day for Feb 29 birthdays).
