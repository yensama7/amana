// prover.worker.js — ZK proof generation OFF the main thread.
//
// Each worker instance handles exactly one circuit (one message in, one message out),
// then the parent terminates it. The wallet spawns one worker per circuit so that
// Promise.all() runs all proofs simultaneously on separate CPU threads.
//
// Protocol:
//   in : { circuit: 'age_gte_18', inputs: { nin, bvn, ... } }
//   out: { circuit, proof, publicSignals }  or  { circuit, error }
//
// Caching:
//   The .wasm (witness generator) and .zkey (proving key) are fetched once and
//   stored in the browser's Cache API under the key 'zk-v2'. Subsequent calls
//   for the same file serve from cache — no re-download on repeated approvals.
//   Cache entries persist across page loads until the service worker bumps the version.
import * as snarkjs from 'snarkjs';

// Fetch a binary proving artifact (wasm/zkey) using the Cache API.
// On a cache miss the file is downloaded from the network and stored for next time.
// Returns a Uint8Array that snarkjs accepts in place of a URL string.
async function cachedBuf(url) {
  // 'zk-v2' must match the KEEP list in sw.js and the open() call in wallet/page.jsx.
  // All three must use the same version string or they will read from different caches.
  const cache = await caches.open('zk-v2');
  let response = await cache.match(url);

  if (!response) {
    // Cache miss: download the file from the Next.js static server.
    response = await fetch(url);

    // Never store a non-OK response (e.g. a 404 HTML page) as if it were a .wasm file.
    // If we cached an error, snarkjs would choke on it forever after, and the only fix
    // would be manually clearing the cache. Fail loudly instead so the wallet surfaces
    // the error message immediately.
    if (!response.ok) throw new Error(`failed to fetch ${url}: HTTP ${response.status}`);

    // Clone before caching: a Response body can only be consumed once.
    // cache.put() consumes one copy; we read from the cached copy below.
    await cache.put(url, response.clone());

    // Re-read from cache so both code paths (hit and miss) return the same type.
    response = await cache.match(url);
  }

  // Convert to Uint8Array so snarkjs can use it as an in-memory buffer
  // instead of trying to fetch it again by URL.
  return new Uint8Array(await response.arrayBuffer());
}

// Handle one proving request from the wallet's Wallet component.
// The wallet posts { circuit, inputs } and expects back { circuit, proof, publicSignals }.
self.onmessage = async (event) => {
  const { circuit, inputs } = event.data;
  try {
    // Download (or serve from cache) both artifacts in parallel.
    // .wasm = the witness generator compiled from the circuit's Circom code.
    // .zkey = the proving key produced during the trusted setup ceremony.
    const [wasm, zkey] = await Promise.all([
      cachedBuf(`/zk/${circuit}.wasm`),
      cachedBuf(`/zk/${circuit}.zkey`),
    ]);

    // fullProve: two phases in one call.
    //   Phase 1 (witness generation): runs the .wasm with the private inputs to
    //            compute all intermediate circuit signals.
    //   Phase 2 (proof generation):   runs the Groth16 prover with the .zkey and
    //            witness to produce a succinct proof + public signals.
    //
    // { type: 'mem', data: Uint8Array } tells snarkjs to read from the in-memory
    // buffer rather than issuing another network fetch.
    //
    // publicSignals are the values the gateway checks against its expectedSignals
    // map before running groth16.verify().
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      inputs,
      { type: 'mem', data: wasm },
      { type: 'mem', data: zkey }
    );

    // Send the proof back to the wallet's prove() function.
    // The wallet reshapes the results into { circuit: { proof, publicSignals } }
    // before posting to POST /api/verify.
    self.postMessage({ circuit, proof, publicSignals });
  } catch (err) {
    // Most common cause: the witness generator encountered a violated constraint.
    // In ZK, a violated constraint means the statement is FALSE — the prover literally
    // cannot construct a witness for a false claim. This is not a software bug; it is
    // the system working correctly.
    //
    // Example: the wallet tries to prove id_ownership with the wrong amanaId.
    // The circuit's constraint `Poseidon(secret, rpId) === amanaId` fails, and
    // snarkjs throws here. The wallet catches this error and sends a deny.
    self.postMessage({ circuit, error: String(err?.message || err) });
  }
};
