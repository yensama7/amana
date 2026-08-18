# Amana Gateway: Project Update Instructions

## Overview
This document serves as the master instruction set for updating the Amana Gateway project for the upcoming 2-day hackathon. The system transitions from a generic wallet to a centralized consumer app ("Amana Way"), interacting with two distinct mock lending companies.

## 1. Core Architecture & User Flow Updates
*   **The Amana Way App:** This is the new citizen-facing application. Users will use this to manage their identity, generate IDs, and handle verification requests.
*   **Distinct Mock Companies:** Implement two separate entities: **Swift Loan** and **ABC Loan**. Each should have distinct requirements (e.g., Swift Loan asks for all proofs, ABC Loan asks for a specific subset).
*   **Per-Company Amana IDs:** The user will check if a company is accredited in the Amana Way app and generate a specific Amana ID *just for that company*. This ID is mathematically bound to the company and useless elsewhere.
*   **Revocation Logic:** Do NOT generate new IDs or use random salts when a user revokes access. Implement a simple "active" or "revoked" status toggle on the gateway for the exact same Amana ID. 
*   **Hackathon Features:**
    *   **Live Blocking Alerts:** If a revoked ID is used, trigger a webhook/alert to show a live notification in the app that the unauthorized attempt was blocked.
    *   **PWA Setup:** Configure the frontend as a Progressive Web App (manifest, basic service worker) for a native mobile feel.
    *   **Visual ZK Terminal:** Add a small UI component that visualizes the ZK math happening in real-time to impress judges.

## 2. Zero-Knowledge (ZK) Optimizations
*Do not build a composite circuit.* Maintain modular, individual circuits for maximum flexibility during the demo. Instead, optimize the existing circuits:
*   **Shrink Comparators:** Update `LessEqThan` templates in the Circom circuits to use 32-bit (or fewer) comparators instead of the default 252-bit for simple integer checks like credit scores and YYYYMMDD dates.
*   **Parallel Proving:** In the Next.js Web Worker, use `Promise.all()` to execute the 4 SnarkJS proving tasks simultaneously rather than sequentially.
*   **Local Caching:** Configure the Web Worker to download the `.wasm` and `.zkey` files once on initial load and cache them using the browser's Cache API or IndexedDB.
*   **Optimize Hash Inputs:** Ensure Poseidon hashing within specific circuits only takes the exact inputs needed for that specific proof, reducing unnecessary constraints.

## 3. Frontend Implementation & Code Quality
*   **Keep UI Simple:** Focus strictly on state management, logic, and structural layout. The designated frontend design team will handle the CSS, UI, and styling.
*   **Extensive Commenting:** Heavily comment the codebase to explain the flow of data.
*   **ZK Logic Explanations:** Include clear inline comments explaining exactly how the ZK logic operates (e.g., how the Web Worker passes the witness to SnarkJS, what the public signals represent).

## 4. Required Documentation Deliverables
**ACTION REQUIRED BY AGENT:** You must generate two separate markdown files for the frontend developers: `swift-loan-frontend.md` and `abc-loan-frontend.md`. 

Each of these files MUST contain:
1.  **Frontend Layout & Design Guide:** A detailed explanation of the structural layout, component hierarchy, and state variables so frontend designers know exactly where to apply styles without breaking the underlying logic.
2.  **Logic Workflow:** Step-by-step explanation of how the frontend handles the ID input, pending states, and success/failure rendering.
3.  **Endpoint Documentation:** A rigorously detailed list of all endpoints the specific frontend uses, including:
    *   HTTP Methods and Paths
    *   Expected Request Payloads
    *   Expected Response Structures
    *   Error handling procedures
