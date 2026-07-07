# How Amana Gateway Works — A Plain-Language Explanation

This document walks through the entire system in plain language: why each piece exists, what problem it solves, and what would be different in a real-world deployment versus this demo. No code knowledge required.

---

## The problem this is solving

When you apply for a loan in Nigeria today, you hand over your BVN and NIN. The lender stores both. If their database leaks, your BVN is out in the world forever — and because knowing a BVN is *treated* as proof that you are who you say you are, anyone with your BVN can potentially impersonate you.

Amana Gateway asks: what if the lender never needed the BVN at all? What if they could get a mathematically guaranteed *answer* — "yes, this person is over 18, Nigerian, and creditworthy" — without ever seeing the data that produced that answer?

That is exactly what zero-knowledge proofs make possible. You prove the statement is true without revealing the evidence.

---

## The cast of characters

There are four actors in every transaction. In the demo, they all live on your laptop — in reality they would each be a separate institution.

| Actor | Who they are | What they hold |
|---|---|---|
| **National Registry** (NIMC in reality) | Government identity authority | The citizen's NIN, BVN, date of birth, state, citizenship |
| **Credit Bureau** (CRC in reality) | Accredited financial data institution | The citizen's credit score, active loans, defaults |
| **Citizen Wallet** | The citizen's phone / browser | Two sealed envelopes from the above; a private wallet secret |
| **Relying Party (RP)** | A bank, lender, or service | An opaque ID for the citizen; gets true/false answers |
| **Amana Gateway** | The referee | Checks proofs; keeps an audit log; enforces revocation |

---

## The NIMC Act 2026: why the government's digital stamp needs a translator

Under the NIMC Act 2026, every Nigerian digital identity system must be anchored to a government-issued root certificate — think of it as an official wax seal from the Federal Government that says "this person's identity has been verified by the State."

That requirement is good news for trust. But it creates a technical problem.

The government's digital seal uses a type of cryptography that was designed for traditional computers — powerful, well-established, but slow. Asking a phone to verify that government seal *inside* a zero-knowledge proof would be like requiring someone to recite the entire Nigerian constitution as part of answering a simple yes-or-no question. Technically possible. Practically useless.

**The Trust Bridge solves this.** It lives in the Amana Gateway and works in four steps:

1. **NIMC issues a signed payload.** The government produces a digital document containing the citizen's NIN, BVN, date of birth, state of origin, and citizenship status — and stamps it with its official digital signature. This is the government saying: *"We verified this person. Here is our seal."*

2. **The Gateway checks the government's seal — the normal way.** The Gateway performs a standard verification of that signature on its own servers. No zero-knowledge involved here; it uses exactly the kind of cryptography every secure website on the internet uses. If the seal does not pass, the process stops immediately.

3. **If the seal is genuine, the Gateway translates the credential.** It takes the same identity data, runs it through a ZK-friendly mathematical process (Poseidon hash + BabyJubjub signature), and produces a new, lighter-weight credential. Think of the Gateway as saying: *"I have personally verified the government's stamp. I am now issuing my own version — one that a mobile device can work with efficiently."*

4. **The citizen receives this bridged credential** and uses it for all the zero-knowledge proofs described in this document.

The chain of trust is never broken: the Gateway's credential is only issued when the government's original stamp passes verification. No citizen receives a working ZK credential unless NIMC vouched for them first. The government's authority is the foundation; the Gateway is the translator.

**In the demo**, this full flow runs on every server start. The demo simulates NIMC by signing the citizen's data, then passes that signature to the Gateway's onboarding endpoint (`POST /api/citizen/onboard`), which verifies it and issues the bridged credential. A real deployment would replace the demo signature with a genuine NIMC-issued token from the National Identity Management System.

**Want to see it happen live?** Open this URL while the demo is running:

```
http://localhost:4200/api/trust-bridge/trace
```

The Gateway will run the full Trust Bridge on the spot — without touching the database or the live credentials — and return a step-by-step JSON showing every stage: the government's RSA signature, the verification result, the Poseidon commitment, and the final BabyJubjub EdDSA signature. Each step includes a plain-English explanation of what is happening and why.

---

## The two sealed envelopes

When the citizen registers, two things happen:

1. The **National Registry** takes the citizen's identity data — after the Trust Bridge has verified the government's original stamp (described above) — and produces a sealed, ZK-friendly version. This is the **identity commitment**: a single large number that represents everything about the citizen without revealing any of it. The Gateway signs this number on the Registry's behalf and hands the citizen a sealed envelope: *"The government vouched for this person, we have checked that vouching, and here is the credential that proves it."*

2. The **Credit Bureau** does the same thing with the citizen's credit data (score, active loans, defaults). Same kind of sealed envelope, called the **credit commitment**.

**Why hash?** Because a hash is a one-way function. You can compute the hash from the data, but you cannot work backwards from the hash to recover the data. The commitment is public-safe: even if someone intercepts it, it tells them nothing about your NIN, BVN, or score.

**Why sign?** Because without the issuer's signature, anyone could make up a commitment and claim the Registry endorsed it. The signature is the chain of trust. A ZK proof attached to a commitment nobody signed is worthless — the gateway checks the signature first, before it even looks at the proof.

**The shared secret:** both envelopes contain the same random value, called the **wallet secret**. You can think of it as a serial number stitched inside both envelopes by the same factory. Its purpose is to mathematically bind the credit history to the same person as the identity, and to generate the citizen's IDs for different companies (explained below). In a real system, the citizen's wallet generates this secret on-device and the government institutions build it into the credentials — it never travels over a network in the clear. In this demo, the mock issuer generates it and serves it to the wallet, which is a shortcut noted in the README.

---

## The amanaId: why there is no BVN field on the loan form

Classic KYC: you type your BVN into a form. The lender stores it. It can leak.

Amana's approach: the lender never receives a BVN. Instead, the citizen gives each company a unique number called an **amanaId**, computed like this:

```
amanaId = Poseidon(wallet_secret, company_number)
```

Two properties of this formula matter enormously:

1. **It always gives the same answer.** Every time the wallet opens, it recomputes `Poseidon(secret, 1001)` and gets the same SwiftLoan ID. Nothing is stored; it is derived on demand.

2. **It gives a different answer for every company.** SwiftLoan gets one number; GTBank gets a different number. Nobody looking at both numbers can tell they belong to the same person — the math prevents it. Companies cannot quietly merge records about you.

**If a stolen amanaId is useless, what stops someone from stealing it and passing it off as their own?** The `id_ownership` circuit. When the lender submits the amanaId to the gateway, the gateway demands a zero-knowledge proof that whoever is claiming this ID also knows the wallet secret that generated it. You cannot produce that proof without the secret. A thief with only the number is stuck.

**Company numbers in this demo:** SwiftLoan = `1001`, GTBank = `2002`, Credit Bureau = `3003`. These are hardcoded in the demo code because we are simulating a registration system. In production, a company would register with the gateway operator (the Central Bank, NIMC, or whoever runs this infrastructure), get assigned a unique company number (like a CAC registration number), and use that number in all future verification requests. The gateway operator controls the directory; companies cannot pick their own numbers, for the same reason banks do not get to choose their own sort codes.

---

## The six proofs: what gets proven and what stays hidden

When a citizen approves a verification request, the wallet generates one **zero-knowledge proof** for each claim the company asked about. Each proof is a piece of math that convinces the gateway the statement is true, without revealing any of the underlying data.

| Proof | What it proves | What stays hidden |
|---|---|---|
| **Age check** | Date of birth ≤ cutoff date (= today minus 18 years) | The actual date of birth |
| **Citizenship** | Citizenship code = 566 (Nigeria's international code) | Everything else |
| **ID ownership** | `Poseidon(wallet_secret, company_number) = amanaId` | The wallet secret and NIN/BVN |
| **Credit check** | Credit score ≥ the lender's minimum | The actual score |
| **ID linkage** | Two amanaIds at different companies come from the same wallet secret | Everything except the fact of the link |
| **BVN match** | (legacy path) The BVN on record hashes to the supplied value | The BVN itself |

Every proof also carries two additional public values that the gateway checks:
- **rpId** — binds the proof to this specific company. A valid proof for SwiftLoan cannot be reused at GTBank.
- **nonce** — a one-time random number issued by the gateway when the request was created. Once a proof is submitted, that nonce is burned. A recorded proof submitted a second time is rejected immediately (replay protection).

---

## The consent flow, step by step

1. **SwiftLoan sends a request** to the gateway: "I need these four things verified for the citizen with amanaId X."
2. **The gateway issues a nonce** (a one-time number) and stores the request as pending.
3. **The citizen's wallet polls** the gateway, sees the pending request, and shows a consent screen listing exactly what was asked — "You are 18 or older (your date of birth stays private)", etc.
4. **The citizen approves.** The wallet's JavaScript — in a background thread called a Web Worker — runs the ZK proof mathematics locally in the browser. Four proofs are generated, one for each claim. The main browser page stays responsive (you can see the liveness counter ticking) because the heavy computation happens off the main thread.
5. **The wallet submits all four proofs** to the gateway.
6. **The gateway checks, in order:**
   - Is this request still pending? (nonce not already used)
   - Is this company still not revoked?
   - Is the Registry's signature on the identity commitment valid?
   - Is the Bureau's signature on the credit commitment valid?
   - Do the public signals on each proof exactly match what this specific request expected?
   - Does each Groth16 SNARK proof verify against the circuit's verification key?
7. **The gateway responds** to SwiftLoan: `{ ok: true, receiptId: "..." }`. That is the entirety of what SwiftLoan receives. No name, no BVN, no score.
8. **An audit row is written** — who asked, what they asked, the outcome, a receipt ID — visible to the citizen on the dashboard.

---

## Credit history without a lookup: how Option 2 works

Traditional approach: the lender calls the credit bureau, the bureau looks up the citizen by BVN, and returns their full file. The citizen has no visibility into this.

Amana's approach (Option 2 — credit history travels to the wallet):

1. The credit bureau issues the citizen a **credit credential** (the sealed envelope described above) when they first register.
2. That credential lives in the citizen's wallet — not in a bureau lookup table.
3. When a lender needs a credit check, they ask the citizen's wallet directly. The wallet generates a zero-knowledge proof that the credit score in its sealed envelope meets the lender's threshold.
4. The lender gets "score ≥ 650: true." The bureau is never queried again. The bureau's signature on the credential is the proof that the data is authentic.

The citizen controls this data. It sits in their wallet. No query happens without their consent.

---

## ID linkage: the consent-based credit history bridge (Option 3)

Because every company sees a *different* amanaId, the credit bureau by default cannot tell that the same person has accounts at SwiftLoan and GTBank. This is good for privacy — companies cannot build a shadow profile by cross-referencing their data. But it creates a problem: the bureau cannot aggregate the citizen's full credit picture across institutions.

Option 3 solves this with a **consent-based linkage proof**. When the citizen clicks "Authorise SwiftLoan ↔ GTBank link":

1. The wallet generates an `id_linkage` zero-knowledge proof. This proof says: "I know the wallet secret that produced both the SwiftLoan ID and the GTBank ID." It reveals nothing except the fact of the link.
2. The gateway verifies the proof and records which two IDs belong to the same person.
3. This event appears on the citizen's audit log as a visible, dated entry.
4. The link is revocable — the citizen can instruct the gateway to stop honouring it.

Without this explicit proof, the two IDs are mathematically impossible to connect. The bureau cannot link them on its own.

---

## Revocation: the kill switch

Every company in the system has an entry in a revocations table, controlled by the citizen via the dashboard. When a company is revoked:

- Any new verification request from that company is rejected immediately, before a nonce is even issued.
- If a request is pending when revocation happens, it is blocked the moment the proofs come in.
- The blocked attempt is logged.

This is why the demo instruction says to try applying at SwiftLoan after revoking — the system blocks it live, not with a delay or a policy document.

---

## What is a zero-knowledge proof, in plain words?

Imagine you want to prove to a bank that you know a secret password, but you don't want to say the password out loud — because then the bank would know it too, and could use it without you.

A zero-knowledge proof is a mathematical protocol where you can convince the bank "I know this secret" through a series of challenges and responses that are statistically impossible to pass without actually knowing it — but the bank learns nothing about *what* the secret is.

In this system, the "secret" is not a password — it is the full content of the citizen's credential (NIN, BVN, date of birth, etc.). The proof says: "I know values that, when hashed together in the way the Registry specifies, produce this publicly visible commitment number, AND the date of birth in those values is before a cutoff date." The verifier checks the math, is convinced, and learns only that the statement is true.

The specific type of ZK proof used here — **Groth16** — is efficient enough to run in a web browser in a few seconds.

---

## What is a Poseidon hash?

A hash function takes any input (numbers, text, data) and produces a fixed-size output. Change the input by one digit and the output changes completely. You cannot reverse it to recover the input.

**Poseidon** is a specific hash function designed to work efficiently inside ZK proof systems. Standard hashes like SHA-256 are expensive to use inside a ZK circuit (they require tens of thousands of mathematical constraints). Poseidon is designed so that the same operation costs only a few hundred constraints — making browser-based proving fast enough to be practical.

---

## What is a circuit?

In ZK terminology, a **circuit** is a set of mathematical constraints that describe a computation. Think of it like a locked box: you put inputs in, the box performs a specific calculation, and if all the constraints are satisfied, it produces a proof that the calculation was done correctly.

This system has six circuits, each one proving a specific statement. A circuit is compiled (by a tool called **Circom**) into two files:
- A `.wasm` file — the actual computation, run in the browser to produce a *witness* (the evidence that all constraints are satisfied for your specific inputs)
- A `.zkey` file — the *proving key*, the mathematical parameters needed to turn the witness into a compact proof

The gateway holds *verification keys* (`.vkey.json`) — a different, smaller file that only needs to check whether a proof is valid, not produce one.

---

## Demo shortcuts vs. real deployment

This system is built for a 48-hour hackathon. Several things are simplified that would be different in production. It is important to be clear about them.

| What the demo does | What a real system would do |
|---|---|
| Company IDs (1001, 2002) are hardcoded in the UI and API | Companies register with the gateway operator and receive an assigned ID — like registering for OAuth client credentials |
| The gateway serves the credential (including the wallet secret) to the browser | The wallet generates the secret on-device; it never leaves the device; the credential is provisioned over a secure channel at registration time |
| Both mock issuers (Registry + Bureau) run in the same server process and generate fresh keys every boot | Each issuer is a separate institution with long-lived keys in a Hardware Security Module (HSM) |
| The demo generates its own RSA key pair on startup to simulate the NIMC root certificate | A real deployment would pin the actual NIMC Root CA certificate, published by the government |
| The demo signs the citizen's data itself (acting as NIMC) and passes that signature to the Trust Bridge | NIMC would issue the signed token directly to the citizen through the official NIMC enrolment process |
| A single synthetic citizen, no authentication on wallet/dashboard | Real wallets require device authentication (biometric, PIN); the gateway authenticates each session |
| Trusted setup for circuits is single-party (one computer ran the ceremony) | A real deployment requires a multi-party trusted setup ceremony, where many independent parties each contribute randomness and destroy their contribution — security holds as long as at least one participant is honest |
| Credit credential is re-signed on every server restart | A real credential is issued once, stored on-device, and has an expiry date and a revocation mechanism |
| One nonce covers all four proofs in a request | Production may use per-proof nonces or a more structured binding scheme |

None of these shortcuts affect the cryptographic correctness of the demo — the ZK proofs are real, the signatures are real, the replay protection is real. They are operational shortcuts appropriate for a proof-of-concept.

---

## Learning resources: Circom and SnarkJS

These resources are arranged from gentlest introduction to deeper technical material. You do not need to start at the bottom.

### Start here (no math background needed)

- **"What is a zero-knowledge proof?" — zkiap.com (ZK Intensive Application Program)**
  A free, self-paced course built by 0xPARC. Module 1 uses puzzles and plain English before introducing any math. Start here if you have never touched ZK before.
  `https://zkiap.com`

- **"An Introduction to Zero Knowledge Proofs" — Rareskills blog**
  One of the clearest plain-language explanations online. Covers commitments, witnesses, and provers/verifiers without requiring prior cryptography knowledge.
  `https://www.rareskills.io/post/intro-to-zero-knowledge`

- **Vitalik Buterin's "STARKs, Part I: Proofs with Polynomials"**
  Vitalik is unusually good at explaining hard concepts gently. The STARK series builds intuition for how proof systems work from first principles. You will not use STARKs in this project, but the intuition transfers directly.
  `https://vitalik.eth.limo/general/2017/11/09/starks_part_1.html`

### Circom (the circuit language)

- **Official Circom documentation — docs.circom.io**
  The authoritative reference. Start with "Getting Started" → "Writing circuits". The "Language reference" section explains every keyword. This is where you will spend most time once you are writing circuits yourself.
  `https://docs.circom.io`

- **0xPARC Circom Workshop (recorded)**
  A free workshop where the creators of Circom walk through writing circuits from scratch. The session on `LessThan` and `IsZero` directly covers the comparator patterns used in this project's age and credit circuits.
  Search: *"0xPARC circom workshop"* on YouTube

- **circomlib — the standard library**
  The circuits in this project use `Poseidon`, `LessEqThan`, and `IsEqual` from circomlib. Reading the source is one of the best ways to learn idiomatic Circom.
  `https://github.com/iden3/circomlib`

### SnarkJS (the proving and verification library)

- **SnarkJS README — github.com/iden3/snarkjs**
  The full CLI and API reference. The README walks through the entire ceremony workflow: ptau → r1cs → zkey → export vkey → prove → verify. This is the exact sequence `scripts/build-circuits.sh` runs.
  `https://github.com/iden3/snarkjs`

- **"How to use SnarkJS in the browser" section of the SnarkJS README**
  Directly relevant to this project — covers loading `.wasm` and `.zkey` as static files and calling `snarkjs.groth16.fullProve`. This is exactly what `web/lib/prover.worker.js` does.

### Going deeper (some math required, but approached gently)

- **"ZK Book" — rareskills.io/zk-book**
  A free, thorough textbook starting from modular arithmetic and building up to R1CS, Groth16, and Plonk. Excellent for understanding *why* circuits are expressed as rank-1 constraint systems. Chapter on R1CS is particularly useful for understanding what Circom compiles down to.
  `https://www.rareskills.io/zk-book`

- **"Moon Math Manual" — leastauthority.com**
  A free PDF that carefully builds the mathematical foundations of ZK proofs — finite fields, elliptic curves, pairings — for readers who want to understand what is happening under the hood of Groth16. Dense but rewarding.
  Search: *"Moon Math Manual ZK"*

- **"ZKP MOOC" — zk-learning.org**
  A university-level course (Berkeley / Stanford) with recorded lectures, freely available. The lectures on Groth16 and the Fiat-Shamir transform are the most directly relevant to this stack.
  `https://zk-learning.org`

### Community

- **ZKProof.org** — the standards body for ZK proofs; publishes readable summaries of different proof systems and real-world deployment considerations.
- **Telegram: "Circom and SnarkJS"** — the official support group; the library authors are active there.
- **ETHGlobal YouTube channel** — dozens of recorded ZK workshops from hackathons, most aimed at builders rather than researchers.

### Suggested learning order if starting from zero

1. Read the Rareskills intro blog post (1–2 hours)
2. Do ZK Intensive Application Program, Modules 1–3 (a few evenings)
3. Work through the Circom documentation "Getting started" guide, write a simple circuit yourself
4. Read the SnarkJS README end to end, run the CLI workflow once manually
5. Read the source of this project's `circuits/age_gte_18.circom` — it will make sense by then
6. When you want to go deeper on the math, start the ZK Book from Chapter 1
