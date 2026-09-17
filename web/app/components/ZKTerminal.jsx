'use client';
// ZKTerminal — visual display of the ZK math happening in real-time.
// Purely presentational: receives proving state from the parent (wallet/page.jsx)
// and renders a monospace terminal showing which circuits are running and the
// Poseidon hash formula that binds the private data to the commitment.
//
// Props:
//   proving   — 'all' | 'submitting' | null (from wallet proving state)
//   claims    — string[] of circuit names currently being proved
//   claimDone — { [circuit]: true } flips live as each Worker finishes its proof
import { useEffect, useState } from 'react';

// Approximate constraint counts per circuit — determined at compile time by
// build-circuits.sh and hardcoded here so judges can see the circuit sizes
// without needing to inspect build output.
// ponytail: hardcoded — compile-time constants, no reason to fetch them.
const CONSTRAINTS = {
  age_gte_18:       '~280 constraints  (Poseidon-7 + 32-bit LessEqThan)',
  citizenship_ng:   '~250 constraints  (Poseidon-7 + equality check)',
  id_ownership:     '~250 constraints  (Poseidon-2 + equality check)',
  credit_score_gte: '~280 constraints  (Poseidon-5 + 32-bit LessEqThan)',
};

// The identity commitment formula — the cryptographic heart of the system.
// Every identity circuit recomputes this hash inside the SNARK and checks it
// against the issuer-signed commitment. If anything is wrong, the proof fails.
// Displaying it here makes the ZK guarantee visible to non-technical observers.
const FORMULA = 'Poseidon( nin, bvn, dob, state, citizenship, secret, salt ) → commitment';

export default function ZKTerminal({ proving, claims, claimDone = {} }) {
  // Elapsed time in seconds since proving started, updated every 100ms.
  // Displayed alongside the proof count to give a feel for circuit speed.
  const [elapsed, setElapsed] = useState(0);

  // Start/stop the elapsed-time counter whenever the proving state changes.
  // When proving ends (null), reset to 0 so the next run starts fresh.
  useEffect(() => {
    if (!proving) { setElapsed(0); return; }
    const start = Date.now();
    // Update every 100ms — smooth enough for the demo, cheap enough to not matter.
    const t = setInterval(() => setElapsed(((Date.now() - start) / 1000).toFixed(1)), 100);
    return () => clearInterval(t);
  }, [proving]);

  // Return nothing when not actively proving — the terminal is only visible
  // during the consent approval flow, not while idle.
  if (!proving) return null;

  // True once the wallet has submitted all proofs to the gateway.
  const submitting = proving === 'submitting';

  // How many of the requested circuits have finished so far.
  const doneCount = claims.filter((c) => claimDone[c]).length;

  return (
    // Dark terminal-style container. Monospace font and green-on-black palette
    // makes the ZK math feel like it's really happening rather than just a spinner.
    <div style={{
      fontFamily: 'var(--mono)', fontSize: '0.78rem',
      background: '#04120a', border: '1px solid #1a3a22',
      borderRadius: 8, padding: '12px 16px', margin: '10px 0',
      color: '#00d97f', lineHeight: 1.8,
    }}>
      {/* Terminal header row: label on the left, proof-count / elapsed on the right */}
      <div style={{ color: '#3a7a4a', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
        <span>{'// Amana ZK Terminal'}</span>
        <span>{doneCount}/{claims.length} proofs · {elapsed}s</span>
      </div>

      {/* The Poseidon formula: the single most important line in the terminal.
          It explains in one line why the private data is safe — the inputs are
          squashed into a one-way hash, and the circuit proves the hash is correct. */}
      <div style={{ color: '#7fffbb', marginBottom: 8 }}>
        {'> '}{FORMULA}
      </div>

      {/* One row per circuit. Colour and symbol flip from pending (dim green, ⟳)
          to done (bright green, ✓) as each Worker posts its result back.
          Once in 'submitting' state all rows show as done regardless of individual
          completion, since all proofs are finished before submission begins. */}
      {claims.map(c => {
        // Mark the row as done if either: all proofs finished (submitting state),
        // or this specific circuit's worker has already returned its result.
        const done = submitting || claimDone[c];
        return (
          <div key={c} style={{ color: done ? '#00d97f' : '#5a8a6a' }}>
            {/* ✓ = complete, ⟳ = still running in its Web Worker thread */}
            {done ? '✓' : '⟳'} {c}
            {/* Constraint count shown in muted colour to give technical depth
                without competing visually with the completion status */}
            <span style={{ color: '#3a7a4a', marginLeft: 8 }}>{CONSTRAINTS[c]}</span>
          </div>
        );
      })}

      {/* Final line appears only after all local proofs are done and the gateway
          call has started. groth16.verify() runs server-side (snarkjs on Node)
          against the stored verification keys. */}
      {submitting && (
        <div style={{ color: '#ffffff', marginTop: 8 }}>
          {'→'} groth16.verify() on gateway…
        </div>
      )}
    </div>
  );
}
