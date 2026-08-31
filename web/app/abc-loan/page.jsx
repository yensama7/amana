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
import { useEffect, useRef, useState } from 'react';

// ABC Loan's company ID — 2002. The citizen's amanaId for this company is
// Poseidon(walletSecret, '2002'), but ABC Loan never asks for it.
const RP = { id: '2002', name: 'ABC Loan' };

export default function AbcLoan() {
  const [phase, setPhase] = useState('idle'); // idle | waiting | done | blocked
  const [outcome, setOutcome] = useState(null);
  const timerRef = useRef(null);

  // Clear the outcome poller if the page unmounts mid-wait.
  useEffect(() => () => clearInterval(timerRef.current), []);

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
    timerRef.current = setInterval(async () => {
      const r = await fetch(`/api/requests/${requestId}`).then((x) => x.json());
      if (r.status !== 'pending') {
        clearInterval(timerRef.current);
        setOutcome(r);
        setPhase('done');
      }
    }, 2000);
  }

  return (
    <div className="site site-abc">
      <header className="site-header">
        <span className="logo">🌤 ABC Loan</span>
        <nav>
          <span>Quick loans</span>
          <span>How it works</span>
          <span>About us</span>
        </nav>
        <span className="cta">Check eligibility</span>
      </header>

      <div className="site-hero">
        <span className="site-eyebrow">Micro-loans made simple</span>
        <h1>Small loans, <em>zero paperwork.</em></h1>
        <p>
          We only need to know two things: that you&rsquo;re an adult and that
          you&rsquo;re Nigerian. Nothing else. No ID numbers, no credit checks,
          no documents.
        </p>
      </div>

      <div className="site-body">
        <div className="feature-tiles">
          <div className="tile"><b>✌️ Two facts only</b><span>Age and citizenship — that&rsquo;s our entire KYC.</span></div>
          <div className="tile"><b>🙈 No credit check</b><span>Your credit history stays completely sealed.</span></div>
          <div className="tile"><b>🪪 No ID required</b><span>We don&rsquo;t even ask for your amanaId.</span></div>
        </div>

        <div className="site-card">
          <h2>Check your eligibility</h2>
          <p>ABC Loan verifies exactly two facts through <b>Amana Gateway</b>:</p>
          <ul className="req-list">
            <li><span className="tick">✓</span> You are 18 or older <span className="lock">🔒 birthday stays private</span></li>
            <li><span className="tick">✓</span> You are a Nigerian citizen <span className="lock">🔒 zero-knowledge proof</span></li>
          </ul>
          <p className="muted">
            After clicking, open the <a href="/wallet">Amana Way app</a> — the consent screen
            will show exactly these two claims, and your wallet will generate only 2 of its
            4 available circuits. ZK modularity in action: ask less, learn less.
          </p>
          <div className="row">
            <button onClick={apply} disabled={phase === 'waiting'}>Check eligibility</button>
          </div>
          <div className="trust-strip">
            🔐 Identity verification powered by <b>Amana Gateway</b> — zero-knowledge proofs, licensed under the NDPR
          </div>
        </div>

        {phase === 'waiting' && (
          <div className="site-card">
            <p>
              <span className="spinner" />
              Waiting for you to approve the request in the <a href="/wallet">Amana Way app</a>…
            </p>
          </div>
        )}

        {phase === 'blocked' && (
          <div className="site-card">
            <h2>🚫 Request blocked</h2>
            <p>
              You have <b>revoked</b> ABC Loan&rsquo;s access on your Consent Dashboard.
              The gateway refused the request before anything was processed.
            </p>
          </div>
        )}

        {phase === 'done' && outcome && (
          <div className="site-card">
            <div className="row">
              <span className={outcome.ok ? 'success-pop' : 'fail-pop'}>{outcome.ok ? '✓' : '✕'}</span>
              <h2 style={{ margin: 0 }}>{outcome.ok ? 'You are eligible!' : 'Not eligible'}</h2>
            </div>
            <p style={{ marginTop: 12 }}>
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
      </div>
    </div>
  );
}
