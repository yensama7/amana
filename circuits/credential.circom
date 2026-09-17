pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";

/*
 * CredentialCheck — the shared building block of every Amana circuit.
 *
 * Plain-language version: the government registry squeezes all of a
 * citizen's identity details into ONE scrambled number (a "commitment")
 * and signs it. The scrambling (Poseidon hashing) cannot be reversed —
 * you cannot get the details back out of the number.
 *
 *     commitment = Poseidon(nin, bvn, dob, state, citizenship, secret, salt)
 *
 * Every proof circuit re-does that scrambling from the citizen's PRIVATE
 * details and checks it lands on the exact same public number. That is
 * what stops cheating: you cannot claim "I'm over 18" about made-up
 * details, because made-up details scramble to a different number than
 * the one the government signed.
 *
 * Two special ingredients:
 *   secret — a random value only the citizen's wallet knows. It powers
 *            the "amanaId" system: shareable IDs that point to you but
 *            are useless to a thief (see id_ownership.circom).
 *   salt   — extra randomness so nobody can guess-and-check details
 *            against the public commitment.
 *
 * NOTE: the input ORDER here must match the registry code exactly
 * (api/src/registry.js) or commitments will never match.
 */
template CredentialCheck() {
    // Private details — these never leave the citizen's device.
    signal input nin;         // National Identification Number
    signal input bvn;         // Bank Verification Number
    signal input dob;         // Date of birth as integer YYYYMMDD (e.g. 19950704)
    signal input state;       // State-of-origin numeric code
    signal input citizenship; // ISO 3166-1 numeric country code (Nigeria = 566)
    signal input secret;      // Wallet secret — the seed of all amanaIds
    signal input salt;        // Random blinding factor chosen at issuance

    // Public: the registry-signed commitment.
    // The prover claims their private inputs hash to this value;
    // the verifier only ever sees this number, never the inputs themselves.
    signal input commitment;

    // Poseidon hash over 7 field elements — designed for efficient ZK computation.
    // The input count (7) must match the number of inputs passed below.
    component h = Poseidon(7);

    // Wire each private signal into the hash in the order registry.js uses.
    // The order is load-bearing: swapping any two inputs produces a different hash.
    h.inputs[0] <== nin;
    h.inputs[1] <== bvn;
    h.inputs[2] <== dob;
    h.inputs[3] <== state;
    h.inputs[4] <== citizenship;
    h.inputs[5] <== secret;
    h.inputs[6] <== salt;

    // The re-computed hash MUST equal the signed commitment.
    // This constraint is the cryptographic guarantee: the private inputs are real,
    // because fake ones would produce a different hash and this constraint would fail.
    h.out === commitment;
}
