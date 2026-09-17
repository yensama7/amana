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
    // ---- private (stay on the citizen's device) ----
    signal input nin;         // National Identification Number
    signal input bvn;         // Bank Verification Number
    signal input dob;         // Date of birth as integer YYYYMMDD
    signal input state;       // State-of-origin numeric code
    signal input citizenship; // ISO 3166-1 numeric country code — must equal 566 (Nigeria)
    signal input secret;      // Wallet secret
    signal input salt;        // Blinding factor

    // ---- public (visible to the verifier / gateway) ----
    signal input commitment;  // registry-signed Poseidon commitment
    signal input rpId;        // relying party identifier (anti-replay)
    signal input nonce;       // one-time value from the gateway (anti-replay)

    // 1. Attributes must match the signed commitment.
    //    This ensures the citizenship field being checked below is the real one
    //    from the signed credential, not an arbitrary value the prover supplies.
    component cred = CredentialCheck();
    cred.nin        <== nin;
    cred.bvn        <== bvn;
    cred.dob        <== dob;
    cred.state      <== state;
    cred.citizenship <== citizenship;
    cred.secret     <== secret;
    cred.salt       <== salt;
    cred.commitment <== commitment;

    // 2. Citizenship must be Nigeria (ISO 3166-1 numeric = 566).
    //    This is a simple equality constraint — it either holds (Nigeria) or it doesn't.
    //    No range check needed; the value 566 is a fixed constant in the circuit.
    citizenship === 566;

    // 3. Bind rpId + nonce into the constraint system (anti-replay).
    //    Prevents a proof generated for company A from being accepted by company B.
    signal rpNonce;
    rpNonce <== rpId * nonce;
}

// The three public inputs. commitment anchors the proof to a signed credential;
// rpId + nonce make it single-use for this specific company and request.
component main {public [commitment, rpId, nonce]} = CitizenshipNg();
