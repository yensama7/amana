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
//   stored in the browser's Cache API under the key 'zk-v1'. Subsequent calls
//   for the same file serve from cache — no re-download on repeated approvals.
//   Cache entries persist across page loads until the service worker clears them.
import * as snarkjs from 'snarkjs';

// Fetch a binary artifact (wasm/zkey) using the Cache API.
// On a cache miss the file is fetched from the network and stored for next time.
// Returns a Uint8Array that snarkjs accepts in place of a URL string.
async function cachedBuf(url) {
  const cache = await caches.open('zk-v2'); // version must match sw.js KEEP list
  let response = await cache.match(url);
  if (!response) {
    // First load: download and cache. Clone before consuming — you can only
    // read a Response body once, and cache.put needs a copy.
    response = await fetch(url);
    // Never cache an error page as a .wasm/.zkey — snarkjs would choke on it
    // forever after. Fail loudly instead; the wallet surfaces the error.
    if (!response.ok) throw new Error(`failed to fetch ${url}: HTTP ${response.status}`);
    await cache.put(url, response.clone());
    response = await cache.match(url); // read the cached copy
  }
  return new Uint8Array(await response.arrayBuffer());
}

self.onmessage = async (event) => {
  const { circuit, inputs } = event.data;
  try {
    // Download (or serve from cache) both artifacts in parallel.
    const [wasm, zkey] = await Promise.all([
      cachedBuf(`/zk/${circuit}.wasm`),
      cachedBuf(`/zk/${circuit}.zkey`),
    ]);

    // fullProve: builds the witness from private inputs, then generates the Groth16 proof.
    // Public signals are the values the gateway checks against its expected values.
    // { type: 'mem', data: Uint8Array } tells snarkjs to read from the in-memory buffer
    // rather than fetching again by URL.
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      inputs,
      { type: 'mem', data: wasm },
      { type: 'mem', data: zkey }
    );
    self.postMessage({ circuit, proof, publicSignals });
  } catch (err) {
    // Most common cause: the witness generator hit a violated constraint.
    // This means the statement is FALSE — you cannot prove a false claim in ZK.
    // The wallet's approve() catches this error and sends a deny to the gateway.
    self.postMessage({ circuit, error: String(err?.message || err) });
  }
};
