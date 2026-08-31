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
import { useEffect, useRef, useState } from 'react';

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
  const timerRef = useRef(null);

  // Clear the outcome poller if the page unmounts mid-wait.
  useEffect(() => () => clearInterval(timerRef.current), []);

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
    <div className="site site-swift">
      <header className="site-header">
        <span className="logo">⚡ Swift Loan</span>
        <nav>
          <span>Personal loans</span>
          <span>Business</span>
          <span>Rates</span>
          <span>Help</span>
        </nav>
        <span className="cta">Get started</span>
      </header>

      <div className="site-hero">
        <span className="site-eyebrow">Loans up to ₦5,000,000</span>
        <h1>Money in your account <em>in minutes</em>, not days.</h1>
        <p>
          No paperwork. No branch visits. And thanks to Amana Gateway —
          no BVN, NIN, or documents ever leave your phone.
        </p>
      </div>

      <div className="site-body">
        <div className="feature-tiles">
          <div className="tile"><b>⏱ 3-minute decision</b><span>Instant cryptographic verification, no manual review.</span></div>
          <div className="tile"><b>🔒 Zero data collected</b><span>We verify facts about you without ever seeing your data.</span></div>
          <div className="tile"><b>📉 From 3.5% monthly</b><span>Better verification means better rates.</span></div>
        </div>

        <div className="site-card">
          <h2>Apply for a loan</h2>
          <p>To process your application we verify four facts through <b>Amana Gateway</b>:</p>
          <ul className="req-list">
            <li><span className="tick">✓</span> You are 18 or older <span className="lock">🔒 birthday stays private</span></li>
            <li><span className="tick">✓</span> You are a Nigerian citizen <span className="lock">🔒 zero-knowledge proof</span></li>
            <li><span className="tick">✓</span> The amanaId you provide is really yours <span className="lock">🔒 NIN/BVN stay private</span></li>
            <li><span className="tick">✓</span> Credit score of {MIN_SCORE} or above <span className="lock">🔒 actual score stays private</span></li>
          </ul>
          <p className="muted">
            Paste your Swift Loan amanaId from the <a href="/wallet">Amana Way app</a>.
            Notice: there is no BVN or NIN field on this form — we never ask, and we never see them.
          </p>
          <div className="row">
            <input
              value={amanaId}
              onChange={(e) => setAmanaId(e.target.value)}
              placeholder="Paste your Swift Loan amanaId"
              style={{ maxWidth: 460, fontFamily: 'var(--mono)', fontSize: 13 }}
            />
            <button onClick={apply} disabled={phase === 'waiting'}>Apply for loan</button>
          </div>
          <p className="muted" style={{ marginTop: 14 }}>
            💡 Demo tip: paste your <i>ABC Loan</i> amanaId instead to watch ownership verification
            fail — proving ownership of another company&rsquo;s ID is cryptographically impossible.
          </p>
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
            <p className="muted">
              A consent request has been sent to your wallet. We&rsquo;ll know the moment you decide —
              and we&rsquo;ll only ever learn true or false.
            </p>
          </div>
        )}

        {phase === 'blocked' && (
          <div className="site-card">
            <h2>🚫 Request blocked</h2>
            <p>
              You have <b>revoked</b> Swift Loan&rsquo;s access on your Consent Dashboard.
              No verification request can even be created — the block happens at the gateway
              before any data is processed.
            </p>
          </div>
        )}

        {phase === 'done' && outcome && (
          <div className="site-card">
            <div className="row">
              <span className={outcome.ok ? 'success-pop' : 'fail-pop'}>{outcome.ok ? '✓' : '✕'}</span>
              <h2 style={{ margin: 0 }}>{outcome.ok ? 'Loan pre-approved!' : 'Verification failed'}</h2>
            </div>
            <p style={{ marginTop: 12 }}>
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
      </div>
    </div>
  );
}
