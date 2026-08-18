'use client';
// ABC Loan — mock lender (relying party) that requests only TWO proofs:
//   age ≥ 18 and Nigerian citizenship.
//
// No credit check. No amanaId required. No ID ownership proof.
//
// This is INTENTIONAL — it demonstrates that ZK circuits are modular. A company
// requests only the proofs it actually needs, and the citizen's wallet generates
// only those specific circuits. The other credentials stay completely sealed.
//
// Compare with Swift Loan (four proofs) to see modular ZK in action.
//
// Flow:
//   1. Citizen clicks "Check eligibility" (no ID to paste — ABC Loan doesn't need it).
//   2. ABC Loan sends POST /api/request with just rpId + rpName (no amanaId, no minScore).
//   3. Gateway derives claims: ['age_gte_18', 'citizenship_ng'].
//   4. Consent appears in Amana Way → citizen approves → two proofs → gateway verifies.
import { useState } from 'react';

// ABC Loan's company ID — 2002. The citizen's amanaId for this company is
// Poseidon(walletSecret, '2002'), but ABC Loan never asks for it.
const RP = { id: '2002', name: 'ABC Loan' };

export default function AbcLoan() {
  const [phase, setPhase] = useState('idle'); // idle | waiting | done | blocked
  const [outcome, setOutcome] = useState(null);

  async function apply() {
    setOutcome(null);

    // POST /api/request — no amanaId or minScore, so gateway builds only
    // the two base claims: ['age_gte_18', 'citizenship_ng'].
    const res = await fetch('/api/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rpId: RP.id, rpName: RP.name }),
    });

    if (res.status === 403) {
      setPhase('blocked');
      return;
    }
    const { requestId } = await res.json();

    // Poll until the citizen responds in the Amana Way app.
    setPhase('waiting');
    const timer = setInterval(async () => {
      const r = await fetch(`/api/requests/${requestId}`).then((x) => x.json());
      if (r.status !== 'pending') {
        clearInterval(timer);
        setOutcome(r);
        setPhase('done');
      }
    }, 2000);
  }

  return (
    <>
      <div className="card">
        <h2>🏦 ABC Loan — quick eligibility check</h2>
        <p>
          ABC Loan only needs two basic facts: you are over 18 and a Nigerian citizen.{' '}
          <b>No credit check. No amanaId required. No identity numbers of any kind.</b>
        </p>
        <p>Claims requested: <b>age ≥ 18 · Nigerian citizen</b></p>
        <p className="muted">
          Open the <a href="/wallet">Amana Way app</a> after clicking — your wallet will
          show exactly these two claims in the consent screen. Notice the wallet generates
          only 2 of the 4 available circuits. ZK circuit modularity in action.
        </p>
        <div className="row">
          <button onClick={apply} disabled={phase === 'waiting'}>Check eligibility</button>
        </div>
      </div>

      {phase === 'waiting' && (
        <div className="card">
          <p>
            <span className="spinner" />
            Waiting for you to respond in the <a href="/wallet">Amana Way app</a>…
          </p>
        </div>
      )}

      {phase === 'blocked' && (
        <div className="card">
          <h2>🚫 Request blocked</h2>
          <p>
            You have <b>revoked</b> ABC Loan&rsquo;s access on your Consent Dashboard.
          </p>
        </div>
      )}

      {phase === 'done' && outcome && (
        <div className="card">
          <h2>{outcome.ok ? '✅ Eligible' : '❌ Not eligible'}</h2>
          <p>
            Gateway verdict: <b>{String(outcome.ok)}</b>{' '}
            {outcome.receiptId && (
              <span className="mono">(receipt {outcome.receiptId})</span>
            )}
          </p>
          <p className="muted">
            ABC Loan received only that boolean. No age, no nationality, no personal data.
          </p>
        </div>
      )}
    </>
  );
}
