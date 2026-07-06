# Amana Gateway - Coding Agent Prompt

**System Role:** You are an expert full-stack cryptography engineer tasked with building a 48-hour hackathon MVP for a zero-knowledge identity system called "Amana Gateway". 

**Project Goal:** Build a system where a relying party (like a mock loan app) can ask "is this person over 18, a Nigerian citizen, and does this specific BVN belong to them?" and receive a cryptographically verified true or false, without the citizen ever handing over their raw data.

**Tech Stack:**
*   **Frontend:** Next.js PWA (Citizen Wallet and Consent Dashboard).
*   **Backend:** FastAPI or Express API (Gateway and Mock Registry).
*   **Database:** PostgreSQL.
*   **ZK Stack:** Circom, SnarkJS (Groth16 over BN254 curve), and Poseidon Hash.

**System Architecture & Efficiency Directives:**
Please implement the following components with a strict focus on front-end performance and minimal circuit complexity.

1.  **Mock Registry & Data Structure:** Create a mock registry database that issues a credential to a synthetic citizen. This credential must be a single Poseidon hash commitment containing the citizen's NIN, BVN, Date of Birth, State, Citizenship, and a random salt. The registry signs this hash commitment using an EdDSA key.
2.  **Circom Circuits (Strict Scope):** Do not build a Merkle tree. Build exactly three lightweight circuits: `age_gte_18`, `citizenship_ng`, and `bvn_match`. 
    *   `bvn_match`: verifies that a BVN provided by the relying party strictly matches the BVN hashed inside the signed commitment without revealing the actual BVN to the gateway.
    *   Use the Poseidon hash function inside the circuits to keep constraint counts as low as possible.
    *   The public inputs for each circuit must include the Relying Party ID and a one-time nonce to prevent proof replay.
3.  **Frontend Proving (Performance Priority):** The Next.js wallet must generate the ZK proofs client-side in the browser. You must execute the `snarkjs.groth16.fullProve` function inside a Web Worker. The main UI thread must not freeze during proof generation.
4.  **Static Key Loading:** Assume the `.zkey` and `.wasm` files are precomputed. Configure the Next.js app to load these files statically from the public directory to ensure instant proving.
5.  **Gateway API:** Build a `/verify` API endpoint. It must take the ZK proof from the client, verify it against the registry's public EdDSA key, write the verification event to a Postgres audit log, and return a simple boolean result alongside a receipt ID.
6.  **Consent & Revocation Dashboard:** Build a dashboard where the citizen can view the audit log (who asked, what they asked, and the outcome). Implement a "revoke" button that blocks all future verification requests from a specific relying party.

**Demo Flow to Execute:**
Ensure the system smoothly handles this exact user journey:
1.  The citizen's wallet holds the signed credential.
2.  A mock loan app requests proof of age, citizenship, and a BVN match through the gateway.
3.  The wallet displays a consent screen showing exactly what attributes are being requested.
4.  The user approves, and the Web Worker generates the proof.
5.  The gateway verifies the proof, logs the event, and returns true to the loan app.
6.  The user revokes access via the dashboard, and a subsequent attempt by the loan app fails live.
