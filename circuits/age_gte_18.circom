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
    signal input nin;
    signal input bvn;
    signal input dob;
    signal input state;
    signal input citizenship;
    signal input secret;
    signal input salt;

    // ---- public ----
    signal input commitment;  // registry-signed Poseidon commitment
    signal input rpId;        // relying party identifier
    signal input nonce;       // one-time value from the gateway
    signal input cutoffDate;  // today - 18 years, as YYYYMMDD

    // 1. Attributes must match the signed commitment.
    component cred = CredentialCheck();
    cred.nin <== nin;
    cred.bvn <== bvn;
    cred.dob <== dob;
    cred.state <== state;
    cred.citizenship <== citizenship;
    cred.secret <== secret;
    cred.salt <== salt;
    cred.commitment <== commitment;

    // 2. dob <= cutoffDate  <=>  age >= 18.
    //    32 bits is plenty: YYYYMMDD values fit in 27 bits, and dob is
    //    honest by construction (it is pinned by the commitment above).
    component le = LessEqThan(32);
    le.in[0] <== dob;
    le.in[1] <== cutoffDate;
    le.out === 1;

    // 3. Touch rpId and nonce with a real constraint so no compiler
    //    optimisation level can ever prune them from the proof.
    signal rpNonce;
    rpNonce <== rpId * nonce;
}

component main {public [commitment, rpId, nonce, cutoffDate]} = AgeGte18();
