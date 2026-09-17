pragma circom 2.1.6;

include "credential.circom";

/*
 * id_ownership — the circuit that makes plaintext BVNs/NINs unnecessary.
 *
 * Plain-language version: instead of typing a BVN into a company's form,
 * the citizen hands over an "amanaId" — an opaque code the wallet derives
 * from its secret, DIFFERENT for every company:
 *
 *     amanaId = Poseidon(secret, companyId)
 *
 * This circuit proves: "the amanaId you were given really comes from the
 * secret sealed inside my government-signed credential." Three nice
 * properties fall out of that:
 *
 *   1. Nothing sensitive is ever typed anywhere — the amanaId reveals
 *      no NIN, no BVN, no birthday.
 *   2. A stolen amanaId is USELESS. Knowing the code proves nothing;
 *      only the wallet holding the secret can generate this proof.
 *   3. Two companies get two different amanaIds for the same person, so
 *      they cannot secretly combine their records about you.
 *
 * Public inputs: commitment, rpId, nonce, amanaId.
 */
template IdOwnership() {
    // ---- private (stay on the citizen's device) ----
    signal input nin;         // National Identification Number
    signal input bvn;         // Bank Verification Number
    signal input dob;         // Date of birth as integer YYYYMMDD
    signal input state;       // State-of-origin numeric code
    signal input citizenship; // ISO 3166-1 numeric country code (Nigeria = 566)
    signal input secret;      // Wallet secret — the root of all amanaIds
    signal input salt;        // Blinding factor for the identity commitment

    // ---- public (visible to the verifier / gateway) ----
    signal input commitment;  // registry-signed identity commitment
    signal input rpId;        // the company asking (also used in amanaId derivation)
    signal input nonce;       // one-time value from the gateway (anti-replay)
    signal input amanaId;     // the ID the citizen gave that company (to be verified)

    // 1. The secret must be the one sealed inside the signed credential.
    //    CredentialCheck re-derives the commitment from the private fields and checks
    //    it equals the public `commitment`. If the secret is wrong, this fails.
    component cred = CredentialCheck();
    cred.nin        <== nin;
    cred.bvn        <== bvn;
    cred.dob        <== dob;
    cred.state      <== state;
    cred.citizenship <== citizenship;
    cred.secret     <== secret;
    cred.salt       <== salt;
    cred.commitment <== commitment;

    // 2. That secret, combined with THIS company's rpId, must produce the
    //    amanaId the company received. Wrong wallet => wrong secret =>
    //    Poseidon(secret, rpId) lands on a different number => constraint fails.
    //    This is the unlinkability guarantee: each (wallet, company) pair has a
    //    unique amanaId, so company A and company B cannot correlate their records.
    component pid = Poseidon(2);
    pid.inputs[0] <== secret; // the wallet's master secret
    pid.inputs[1] <== rpId;   // the specific company's ID
    pid.out === amanaId;      // the result must equal the public amanaId

    // 3. Tie the one-time nonce into the math so no compiler optimisation
    //    can drop it (rpId is already used in step 2, so only nonce needs binding here).
    //    Squaring is a valid constraint; multiplying by a constant would also work.
    signal nonceBind;
    nonceBind <== nonce * nonce;
}

// The four public inputs. commitment anchors to the signed credential;
// rpId + nonce make the proof single-use for this specific company and request;
// amanaId is the opaque identifier being verified.
component main {public [commitment, rpId, nonce, amanaId]} = IdOwnership();
