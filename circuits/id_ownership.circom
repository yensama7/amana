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
    signal input nin;
    signal input bvn;
    signal input dob;
    signal input state;
    signal input citizenship;
    signal input secret;
    signal input salt;

    // ---- public ----
    signal input commitment;  // registry-signed identity commitment
    signal input rpId;        // the company asking
    signal input nonce;       // one-time value from the gateway (anti-replay)
    signal input amanaId;     // the ID the citizen gave that company

    // 1. The secret must be the one sealed inside the signed credential.
    component cred = CredentialCheck();
    cred.nin <== nin;
    cred.bvn <== bvn;
    cred.dob <== dob;
    cred.state <== state;
    cred.citizenship <== citizenship;
    cred.secret <== secret;
    cred.salt <== salt;
    cred.commitment <== commitment;

    // 2. That secret, combined with THIS company's id, must produce the
    //    amanaId the company received. Wrong wallet => wrong secret =>
    //    no proof possible.
    component pid = Poseidon(2);
    pid.inputs[0] <== secret;
    pid.inputs[1] <== rpId;
    pid.out === amanaId;

    // 3. Tie the one-time nonce into the math so no compiler optimisation
    //    can drop it (rpId is already used in step 2).
    signal nonceBind;
    nonceBind <== nonce * nonce;
}

component main {public [commitment, rpId, nonce, amanaId]} = IdOwnership();
