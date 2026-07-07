// National PKI to ZK Trust Bridge — PKI utility.
//
// Represents the NIMC Root CA in the demo. The Trust Bridge works in two steps:
//   1. verifyNIMCSignature — standard RSA/SHA-256 out-of-circuit (this file)
//   2. bridgeNIMCToken     — Poseidon re-hash + EdDSA re-sign (registry.js)
//
// This is why X.509 signatures can't go INTO a ZK circuit directly: RSA is
// far too expensive to compute inside Circom/Groth16 on a mobile device.
// The gateway does the heavy RSA check here, then issues a ZK-friendly credential.
const crypto = require('crypto');

// ponytail: runtime keygen — production loads from HSM or a pinned cert bundle
const { privateKey: NIMC_ROOT_PRIVATE_KEY, publicKey: NIMC_ROOT_PUBLIC_KEY } =
  crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

// Field order is fixed — both sides must stringify identically.
function stringify(citizenData) {
  const { nin, bvn, dob, state, citizenship } = citizenData;
  return JSON.stringify({ nin, bvn, dob, state, citizenship });
}

// Used by NIMC (or the demo seeder) to produce a PKI signature over a citizen payload.
function signNIMCPayload(citizenData) {
  return crypto.createSign('SHA256').update(stringify(citizenData)).sign(NIMC_ROOT_PRIVATE_KEY, 'hex');
}

// Called by the Trust Bridge: standard RSA verify out-of-circuit.
function verifyNIMCSignature(citizenData, signatureHex) {
  return crypto.createVerify('SHA256').update(stringify(citizenData)).verify(NIMC_ROOT_PUBLIC_KEY, signatureHex, 'hex');
}

module.exports = { NIMC_ROOT_PUBLIC_KEY, signNIMCPayload, verifyNIMCSignature };
