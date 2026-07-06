pragma circom 2.1.6;

include "credential.circom";

/*
 * citizenship_ng — proves "this citizen is Nigerian" and nothing else.
 *
 * Nigeria's ISO 3166-1 numeric code is 566, hard-wired as a circuit
 * constant, so the statement being proven is literally
 * "the citizenship field inside the signed commitment equals 566".
 *
 * Public inputs: commitment, rpId, nonce (see age_gte_18.circom for why
 * rpId/nonce are included — replay protection).
 */
template CitizenshipNg() {
    // ---- private ----
    signal input nin;
    signal input bvn;
    signal input dob;
    signal input state;
    signal input citizenship;
    signal input secret;
    signal input salt;

    // ---- public ----
    signal input commitment;
    signal input rpId;
    signal input nonce;

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

    // 2. Citizenship must be Nigeria (ISO 3166-1 numeric = 566).
    citizenship === 566;

    // 3. Bind rpId + nonce into the constraint system (anti-replay).
    signal rpNonce;
    rpNonce <== rpId * nonce;
}

component main {public [commitment, rpId, nonce]} = CitizenshipNg();
