pragma circom 2.1.6;

include "credential.circom";
include "circomlib/circuits/comparators.circom";

/*
 * age_gte_18 — proves "this citizen is at least 18 years old" without
 * revealing the date of birth.
 *
 * The gateway supplies cutoffDate = (today minus 18 years) as YYYYMMDD.
 * Because dates in YYYYMMDD format sort numerically, the constraint
 *
 *     dob <= cutoffDate
 *
 * is exactly "born at least 18 years ago".
 *
 * Public inputs: commitment, rpId, nonce, cutoffDate.
 * rpId + nonce make each proof single-use: the gateway issues a fresh
 * nonce per request and refuses to accept the same one twice, so a
 * captured proof cannot be replayed by (or for) another relying party.
 */
template AgeGte18() {
    // ---- private (stay on the citizen's device) ----
    signal input nin;         // National Identification Number
    signal input bvn;         // Bank Verification Number
    signal input dob;         // Date of birth as integer YYYYMMDD (e.g. 19950704)
    signal input state;       // State-of-origin numeric code
    signal input citizenship; // ISO 3166-1 numeric country code (Nigeria = 566)
    signal input secret;      // Wallet secret (same value across all identity circuits)
    signal input salt;        // Blinding factor chosen at credential issuance

    // ---- public (visible to the verifier / gateway) ----
    signal input commitment;  // registry-signed Poseidon commitment
    signal input rpId;        // relying party identifier (e.g. '1001' for Swift Loan)
    signal input nonce;       // one-time value from the gateway — binds proof to this request
    signal input cutoffDate;  // today - 18 years, as YYYYMMDD (computed by ageCutoffDate() in routes.js)

    // 1. Attributes must match the signed commitment.
    //    CredentialCheck re-computes Poseidon(nin, bvn, dob, ...) and asserts it
    //    equals `commitment`. This prevents proving age on invented details.
    component cred = CredentialCheck();
    cred.nin        <== nin;
    cred.bvn        <== bvn;
    cred.dob        <== dob;
    cred.state      <== state;
    cred.citizenship <== citizenship;
    cred.secret     <== secret;
    cred.salt       <== salt;
    cred.commitment <== commitment;

    // 2. dob <= cutoffDate  <=>  age >= 18.
    //    32 bits is plenty: YYYYMMDD values fit in 27 bits, and dob is
    //    honest by construction (it is pinned by the commitment above).
    //    LessEqThan(n) checks in[0] <= in[1] and outputs 1 if true, 0 if false.
    component le = LessEqThan(32);
    le.in[0] <== dob;         // the citizen's birth date
    le.in[1] <== cutoffDate;  // today minus 18 years
    le.out === 1;             // constraint: the output MUST be 1 (dob must be old enough)

    // 3. Touch rpId and nonce with a real constraint so no compiler
    //    optimisation level can ever prune them from the proof.
    //    Without a constraint, an optimising compiler could drop unused signals
    //    and a proof generated for company A could be replayed for company B.
    signal rpNonce;
    rpNonce <== rpId * nonce;
}

// Declare the four public inputs. Everything not listed here is private (witness-only).
component main {public [commitment, rpId, nonce, cutoffDate]} = AgeGte18();
