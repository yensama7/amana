// pki.js — National PKI to ZK Trust Bridge: the PKI (RSA) side.
//
// Represents the NIMC Root CA in the demo. The Trust Bridge works in two steps:
//   1. verifyNIMCSignature — standard RSA/SHA-256 out-of-circuit (this file)
//   2. bridgeNIMCToken     — Poseidon re-hash + EdDSA re-sign (registry.js)
//
// WHY the two-step bridge exists:
//   RSA signature verification costs tens of thousands of constraints inside a
//   Circom/Groth16 circuit — far too expensive to prove on a mobile device.
//   The gateway does the RSA check here in Node (just like HTTPS), then issues a
//   ZK-friendly credential using Poseidon + EdDSA (each ~250 constraints).
const crypto = require('crypto');

// Generate a fresh RSA-2048 keypair to represent the NIMC Root CA.
// ponytail: runtime keygen — production loads from HSM or a pinned cert bundle.
// A 2048-bit key is the standard minimum; 4096-bit would be more realistic for
// a national root CA but adds no value in a demo context.
const { privateKey: NIMC_ROOT_PRIVATE_KEY, publicKey: NIMC_ROOT_PUBLIC_KEY } =
  crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

// Serialize citizen data to a canonical JSON string for signing/verifying.
// Field order is fixed so both sign and verify produce the exact same bytes.
// If the order changed between calls, the signature would never verify.
function stringify(citizenData) {
  const { nin, bvn, dob, state, citizenship } = citizenData;
  return JSON.stringify({ nin, bvn, dob, state, citizenship });
}

// Used by NIMC (or the demo seeder) to produce a PKI signature over a citizen payload.
// In a real system this would be called by the NIMC CA server with its HSM private key.
// Returns the signature as a hex string.
function signNIMCPayload(citizenData) {
  return crypto
    .createSign('SHA256')
    .update(stringify(citizenData))
    .sign(NIMC_ROOT_PRIVATE_KEY, 'hex');
}

// Called by the Trust Bridge (registry.js:bridgeNIMCToken) to verify a NIMC signature
// before re-issuing a ZK-friendly credential.
// Returns true if the signature is valid, false otherwise.
// Uses the same SHA-256 algorithm and the matching public key from above.
function verifyNIMCSignature(citizenData, signatureHex) {
  return crypto
    .createVerify('SHA256')
    .update(stringify(citizenData))
    .verify(NIMC_ROOT_PUBLIC_KEY, signatureHex, 'hex');
}

module.exports = { NIMC_ROOT_PUBLIC_KEY, signNIMCPayload, verifyNIMCSignature };
