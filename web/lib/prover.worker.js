// prover.worker.js — ZK proof generation OFF the main thread.
//
// Groth16 proving takes real CPU time (hundreds of ms per circuit even for
// our tiny ones). Running snarkjs.groth16.fullProve here, in a Web Worker,
// keeps the wallet UI at 60fps — the consent screen's "UI alive" ticker
// exists specifically to demonstrate that during the demo.
//
// Protocol:
//   in : { circuit: 'age_gte_18', inputs: { nin, bvn, ... } }
//   out: { circuit, proof, publicSignals }  or  { circuit, error }
//
// The .wasm (witness generator) and .zkey (proving key) are precomputed by
// scripts/build-circuits.sh and served statically from /public/zk — snarkjs
// fetches them by URL, so proving starts instantly with no key setup.
import * as snarkjs from 'snarkjs';

self.onmessage = async (event) => {
  const { circuit, inputs } = event.data;
  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      inputs,
      `/zk/${circuit}.wasm`,
      `/zk/${circuit}.zkey`
    );
    self.postMessage({ circuit, proof, publicSignals });
  } catch (err) {
    // Most common cause: the witness generator hit a violated constraint,
    // i.e. the statement is FALSE (e.g. the RP's BVN doesn't match).
    // ZK working as intended — you cannot prove a false statement.
    self.postMessage({ circuit, error: String(err?.message || err) });
  }
};
