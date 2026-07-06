pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

/*
 * credit_score_gte — proves "my credit score is at least X" without
 * revealing the score, the number of loans, or anything else.
 *
 * Plain-language version: the credit bureau issues the wallet a SECOND
 * sealed credential (same trick as the identity one):
 *
 *     creditCommitment = Poseidon(score, activeLoans, defaults, secret, salt)
 *
 * A lender asking "is your score at least 650?" gets a true/false — the
 * actual score never leaves the wallet. This is Option 2 from the design:
 * your banking history travels TO your wallet as a signed credential,
 * instead of lenders pulling your whole file from a bureau.
 *
 * Note the wallet `secret` is baked in here too. That binds the credit
 * credential to the SAME wallet as the identity credential — you cannot
 * borrow someone else's good credit history, because you don't know
 * their secret.
 *
 * Public inputs: creditCommitment, rpId, nonce, minScore.
 */
template CreditScoreGte() {
    // ---- private (stay on the citizen's device) ----
    signal input score;       // e.g. 720
    signal input activeLoans; // e.g. 2
    signal input defaults;    // e.g. 0
    signal input secret;      // same wallet secret as the identity credential
    signal input salt;        // this credential's own blinding randomness

    // ---- public ----
    signal input creditCommitment; // bureau-signed commitment
    signal input rpId;             // the lender asking
    signal input nonce;            // one-time value (anti-replay)
    signal input minScore;         // the threshold the lender requires

    // 1. The private values must match the bureau-signed commitment.
    component h = Poseidon(5);
    h.inputs[0] <== score;
    h.inputs[1] <== activeLoans;
    h.inputs[2] <== defaults;
    h.inputs[3] <== secret;
    h.inputs[4] <== salt;
    h.out === creditCommitment;

    // 2. minScore <= score, i.e. "score is at least the threshold".
    //    16 bits is plenty — credit scores are small numbers, and score
    //    is honest by construction (pinned by the commitment above).
    component le = LessEqThan(16);
    le.in[0] <== minScore;
    le.in[1] <== score;
    le.out === 1;

    // 3. Bind rpId + nonce into the math (anti-replay).
    signal rpNonce;
    rpNonce <== rpId * nonce;
}

component main {public [creditCommitment, rpId, nonce, minScore]} = CreditScoreGte();
