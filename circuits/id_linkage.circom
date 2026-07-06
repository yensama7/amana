pragma circom 2.1.6;

include "credential.circom";

/*
 * id_linkage — consent-based linking of two amanaIds (Option 3).
 *
 * Plain-language version: because every company gets a DIFFERENT amanaId
 * for the same citizen, companies cannot combine their records behind
 * the citizen's back. But sometimes the citizen WANTS records combined —
 * e.g. so a credit bureau can build their credit history from two banks.
 *
 * This circuit is the citizen's signed permission slip. It proves:
 *
 *   "amanaId A (at company A) and amanaId B (at company B) both come
 *    from the secret inside MY government-signed credential — they are
 *    the same person, and I am choosing to say so."
 *
 * Without this proof the two IDs are mathematically unlinkable. With it,
 * linking becomes a consented, audited, one-time event — the citizen
 * decides which records join, when, and it shows on their dashboard.
 *
 * Public inputs: commitment, rpIdA, idA, rpIdB, idB, nonce.
 */
template IdLinkage() {
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
    signal input rpIdA;       // first company
    signal input idA;         // citizen's amanaId at company A
    signal input rpIdB;       // second company
    signal input idB;         // citizen's amanaId at company B
    signal input nonce;       // one-time value (anti-replay)

    // 1. The secret must be the one sealed inside the signed credential —
    //    only the real credential holder can authorise a link.
    component cred = CredentialCheck();
    cred.nin <== nin;
    cred.bvn <== bvn;
    cred.dob <== dob;
    cred.state <== state;
    cred.citizenship <== citizenship;
    cred.secret <== secret;
    cred.salt <== salt;
    cred.commitment <== commitment;

    // 2. Both amanaIds must derive from that same secret.
    component pa = Poseidon(2);
    pa.inputs[0] <== secret;
    pa.inputs[1] <== rpIdA;
    pa.out === idA;

    component pb = Poseidon(2);
    pb.inputs[0] <== secret;
    pb.inputs[1] <== rpIdB;
    pb.out === idB;

    // 3. Bind the one-time nonce into the math (anti-replay).
    signal nonceBind;
    nonceBind <== nonce * nonce;
}

component main {public [commitment, rpIdA, idA, rpIdB, idB, nonce]} = IdLinkage();
