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
// build-circuits.sh, hardcoded here so judges can see the circuit sizes.
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
const FORMULA = 'Poseidon( nin, bvn, dob, state, citizenship, secret, salt ) → commitment';

export default function ZKTerminal({ proving, claims, claimDone = {} }) {
  // Elapsed time since proving started — displayed to show how fast the circuits run.
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!proving) { setElapsed(0); return; }
    const start = Date.now();
    const t = setInterval(() => setElapsed(((Date.now() - start) / 1000).toFixed(1)), 100);
    return () => clearInterval(t);
  }, [proving]);

  if (!proving) return null;

  const submitting = proving === 'submitting';
  const doneCount = claims.filter((c) => claimDone[c]).length;

  return (
    <div style={{
      fontFamily: 'var(--mono)', fontSize: '0.78rem',
      background: '#04120a', border: '1px solid #1a3a22',
      borderRadius: 8, padding: '12px 16px', margin: '10px 0',
      color: '#00d97f', lineHeight: 1.8,
    }}>
      <div style={{ color: '#3a7a4a', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
        <span>{'// Amana ZK Terminal'}</span>
        <span>{doneCount}/{claims.length} proofs · {elapsed}s</span>
      </div>
      <div style={{ color: '#7fffbb', marginBottom: 8 }}>
        {'> '}{FORMULA}
      </div>
      {claims.map(c => {
        const done = submitting || claimDone[c];
        return (
          <div key={c} style={{ color: done ? '#00d97f' : '#5a8a6a' }}>
            {done ? '✓' : '⟳'} {c}
            <span style={{ color: '#3a7a4a', marginLeft: 8 }}>{CONSTRAINTS[c]}</span>
          </div>
        );
      })}
      {submitting && (
        <div style={{ color: '#ffffff', marginTop: 8 }}>
          {'→'} groth16.verify() on gateway…
        </div>
      )}
    </div>
  );
}
