pragma circom 2.1.6;

include "credential.circom";

/*
 * bvn_match — proves "the BVN inside my signed credential is the same
 * BVN the relying party asked about" WITHOUT the gateway ever seeing
 * the BVN itself.
 *
 * How the BVN stays hidden:
 *   - The relying party (who already knows the BVN, the applicant typed
 *     it into their form) hashes it CLIENT-SIDE: bvnHash = Poseidon(bvn).
 *   - Only that hash travels through the gateway as a public input.
 *   - The circuit proves Poseidon(private bvn) == public bvnHash, and
 *     the CredentialCheck pins that same bvn to the signed commitment.
 *
 * Public inputs: commitment, rpId, nonce, bvnHash.
 */
template BvnMatch() {
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
    signal input bvnHash;   // Poseidon(bvn) supplied by the relying party

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

    // 2. The committed BVN must hash to the relying party's bvnHash.
    component bh = Poseidon(1);
    bh.inputs[0] <== bvn;
    bh.out === bvnHash;

    // 3. Bind rpId + nonce into the constraint system (anti-replay).
    signal rpNonce;
    rpNonce <== rpId * nonce;
}

component main {public [commitment, rpId, nonce, bvnHash]} = BvnMatch();
