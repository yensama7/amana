'use client';
// Swift Loan — mock lender (relying party) that requests ALL four proofs:
//   age ≥ 18, Nigerian citizenship, ID ownership, and credit score ≥ 600.
//
// This is the "full KYC" demo path. Contrast with ABC Loan which only needs
// two proofs — together they demonstrate that ZK circuits are modular and
// each company only gets exactly what it asks for.
//
// Flow:
//   1. Citizen pastes their Swift Loan amanaId (from the Amana Way app).
//   2. Swift Loan sends POST /api/request with the amanaId + minScore.
//   3. A consent request appears in the citizen's Amana Way app.
//   4. Citizen approves → four proofs generated → gateway verifies → result here.
import { useState } from 'react';

// Swift Loan's company ID — must match the id used to derive the citizen's amanaId
// in the Amana Way app: amanaId = Poseidon(walletSecret, '1001').
const RP = { id: '1001', name: 'Swift Loan' };

// The minimum credit score Swift Loan requires.
// The citizen proves "my score ≥ 600" without revealing the actual number.
const MIN_SCORE = 600;

export default function SwiftLoan() {
  const [amanaId, setAmanaId] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | waiting | done | blocked
  const [outcome, setOutcome] = useState(null);

  async function apply() {
    // The amanaId is a Poseidon hash output — always a large decimal integer.
    if (!/^\d+$/.test(amanaId.trim())) {
      alert('Paste your Swift Loan amanaId from the Amana Way app (a long number).');
      return;
    }
    setOutcome(null);

    // POST /api/request — the gateway creates a pending request and returns a requestId.
    // If the citizen has revoked Swift Loan, the gateway returns 403 immediately
    // and no request is even created (the revocation check is the first gate).
    const res = await fetch('/api/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rpId: RP.id,
        rpName: RP.name,
        amanaId: amanaId.trim(),
        minScore: MIN_SCORE,
      }),
    });

    if (res.status === 403) {
      // Citizen revoked Swift Loan — the live alert should also fire in Amana Way.
      setPhase('blocked');
      return;
    }
    const { requestId } = await res.json();

    // Poll GET /api/requests/:id every 2 seconds until the citizen responds.
    // Status transitions: pending → verified | failed | denied.
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
        <h2>💸 Swift Loan — loan application</h2>
        <p>
          To process your loan we verify four things through Amana Gateway:
          you are over 18, a Nigerian citizen, you own the ID below,
          and your credit score is at least {MIN_SCORE}.{' '}
          <b>We never see your BVN, NIN, birthday, or actual score — only true/false answers.</b>
        </p>
        <p>
          Claims requested:{' '}
          <b>age ≥ 18 · Nigerian citizen · ID ownership · credit score ≥ {MIN_SCORE}</b>
        </p>
        <p className="muted">
          Your Swift Loan amanaId — copy it from the{' '}
          <a href="/wallet">Amana Way app</a>. Notice there is no BVN or NIN field on this form.
        </p>
        <div className="row">
          <input
            value={amanaId}
            onChange={(e) => setAmanaId(e.target.value)}
            placeholder="paste your Swift Loan amanaId here"
            style={{ maxWidth: 460 }}
          />
          <button onClick={apply} disabled={phase === 'waiting'}>Apply for loan</button>
        </div>
        <p className="muted">
          Tip: paste your ABC Loan amanaId instead to see ownership verification fail —
          proving ownership of another company&rsquo;s ID is cryptographically impossible.
        </p>
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
            You have <b>revoked</b> Swift Loan&rsquo;s access on your Consent Dashboard.
            No verification request can even be created — the block happens at the gateway
            before any data is processed.
          </p>
        </div>
      )}

      {phase === 'done' && outcome && (
        <div className="card">
          <h2>{outcome.ok ? '✅ Loan pre-approved' : '❌ Verification failed'}</h2>
          <p>
            Gateway verdict: <b>{String(outcome.ok)}</b>{' '}
            {outcome.receiptId && (
              <span className="mono">(receipt {outcome.receiptId})</span>
            )}
          </p>
          <p className="muted">
            That boolean and receipt are ALL Swift Loan ever receives.
            No documents, no identity numbers, no credit report.
          </p>
        </div>
      )}
    </>
  );
}
