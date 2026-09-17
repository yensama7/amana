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
    signal input score;       // the actual credit score (e.g. 720) — stays completely private
    signal input activeLoans; // number of currently open loans (e.g. 2) — not revealed
    signal input defaults;    // number of past defaults (e.g. 0) — not revealed
    signal input secret;      // same wallet secret as the identity credential (wallet binding)
    signal input salt;        // this credential's own blinding randomness (per-credential)

    // ---- public (visible to the verifier / gateway) ----
    signal input creditCommitment; // bureau-signed commitment sealing the five private fields
    signal input rpId;             // the lender asking (binds proof to this company)
    signal input nonce;            // one-time value (anti-replay — single-use per request)
    signal input minScore;         // the threshold the lender requires (e.g. 650)

    // 1. The private values must match the bureau-signed commitment.
    //    Re-computes Poseidon(score, activeLoans, defaults, secret, salt) and checks it
    //    equals creditCommitment. This prevents using an invented score.
    //    NOTE: input order must match registry.js hash() call for credit credentials.
    component h = Poseidon(5);
    h.inputs[0] <== score;
    h.inputs[1] <== activeLoans;
    h.inputs[2] <== defaults;
    h.inputs[3] <== secret;
    h.inputs[4] <== salt;
    // The re-computed hash must equal the bureau's signed commitment.
    h.out === creditCommitment;

    // 2. minScore <= score, i.e. "score is at least the threshold".
    //    16 bits is plenty — credit scores are small numbers (typically 300–850),
    //    and score is honest by construction (pinned by the commitment above).
    //    LessEqThan(n) checks in[0] <= in[1].
    component le = LessEqThan(16);
    le.in[0] <== minScore; // the lender's required minimum
    le.in[1] <== score;    // the citizen's actual score
    le.out === 1;          // constraint: minScore must be <= score

    // 3. Bind rpId + nonce into the math (anti-replay).
    //    rpId is NOT otherwise used in this circuit (unlike id_ownership), so
    //    we need an explicit constraint to prevent the compiler from dropping it.
    signal rpNonce;
    rpNonce <== rpId * nonce;
}

// The four public inputs. creditCommitment anchors to the bureau's signed credential;
// rpId + nonce make it single-use; minScore is the threshold being proved against.
component main {public [creditCommitment, rpId, nonce, minScore]} = CreditScoreGte();
