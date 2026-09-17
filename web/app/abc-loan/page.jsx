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
// Poseidon(walletSecret, '2002'), but ABC Loan never asks for it because
// it does not need to verify ID ownership — only age and citizenship.
const RP = { id: '2002', name: 'ABC Loan' };

export default function AbcLoan() {
  // Current UI phase:
  //   idle     — show the button, waiting for citizen to start
  //   waiting  — request created, polling for the citizen's response
  //   done     — citizen responded; outcome is set
  //   blocked  — citizen had revoked ABC Loan; gateway returned 403
  const [phase, setPhase] = useState('idle');

  // The gateway verdict once the request resolves: { ok: bool, receiptId, status }.
  const [outcome, setOutcome] = useState(null);

  // Ref holds the setInterval handle so we can cancel it on unmount or resolution.
  const timerRef = useRef(null);

  // Clear the outcome poller if the page unmounts mid-wait, preventing a
  // state update on an unmounted component.
  useEffect(() => () => clearInterval(timerRef.current), []);

  async function apply() {
    setOutcome(null);

    // POST /api/request — no amanaId or minScore in the body, so the gateway
    // builds only the two base claims: ['age_gte_18', 'citizenship_ng'].
    // The claim list is derived server-side from what the company provides,
    // not from a hardcoded list — this is what makes the system modular.
    const res = await fetch('/api/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rpId: RP.id, rpName: RP.name }),
    });

    if (res.status === 403) {
      // Citizen revoked ABC Loan — show the block message and stop.
      setPhase('blocked');
      return;
    }
    const { requestId } = await res.json();

    // Poll until the citizen responds in the Amana Way app.
    // Same polling approach as Swift Loan — 2s interval, clears on any non-pending status.
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

      {/* Lender header: different branding from Swift Loan to look like a separate company */}
      <header className="site-header">
        <span className="logo">🌤 ABC Loan</span>
        <nav>
          <span>Quick loans</span>
          <span>How it works</span>
          <span>About us</span>
        </nav>
        <span className="cta">Check eligibility</span>
      </header>

      {/* Hero: ABC Loan's minimal requirements — only two things needed */}
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
        {/* Feature tiles: three points that reinforce the minimal-data theme.
            The contrast with Swift Loan (no credit check, no ID) is deliberate — it
            shows that the same infrastructure supports different KYC requirements. */}
        <div className="feature-tiles">
          <div className="tile"><b>✌️ Two facts only</b><span>Age and citizenship — that&rsquo;s our entire KYC.</span></div>
          <div className="tile"><b>🙈 No credit check</b><span>Your credit history stays completely sealed.</span></div>
          <div className="tile"><b>🪪 No ID required</b><span>We don&rsquo;t even ask for your amanaId.</span></div>
        </div>

        {/* Eligibility card: the two claims ABC Loan verifies, with privacy labels.
            Notice there is no amanaId input field — ABC Loan does not need one,
            so the gateway never creates an id_ownership claim for this company. */}
        <div className="site-card">
          <h2>Check your eligibility</h2>
          <p>ABC Loan verifies exactly two facts through <b>Amana Gateway</b>:</p>

          {/* Only two requirements, versus four at Swift Loan — this is the
              ZK modularity demo: each company asks for and receives exactly what
              it needs, and no more. */}
          <ul className="req-list">
            <li><span className="tick">✓</span> You are 18 or older <span className="lock">🔒 birthday stays private</span></li>
            <li><span className="tick">✓</span> You are a Nigerian citizen <span className="lock">🔒 zero-knowledge proof</span></li>
          </ul>

          {/* Instruction to open the wallet after clicking, since the consent screen
              appears there, not here. The note about "2 of 4 circuits" makes the
              modularity point explicit for technical observers. */}
          <p className="muted">
            After clicking, open the <a href="/wallet">Amana Way app</a> — the consent screen
            will show exactly these two claims, and your wallet will generate only 2 of its
            4 available circuits. ZK modularity in action: ask less, learn less.
          </p>

          {/* Single button — no ID input needed.
              Disabled while waiting to prevent duplicate requests. */}
          <div className="row">
            <button onClick={apply} disabled={phase === 'waiting'}>Check eligibility</button>
          </div>

          {/* Trust strip: same gateway, different lender — same privacy guarantee */}
          <div className="trust-strip">
            🔐 Identity verification powered by <b>Amana Gateway</b> — zero-knowledge proofs, licensed under the NDPR
          </div>
        </div>

        {/* Waiting state: shown while the citizen is on the consent screen */}
        {phase === 'waiting' && (
          <div className="site-card">
            <p>
              <span className="spinner" />
              Waiting for you to approve the request in the <a href="/wallet">Amana Way app</a>…
            </p>
          </div>
        )}

        {/* Blocked state: citizen had previously revoked ABC Loan.
            The gateway rejected the request before any proof was requested. */}
        {phase === 'blocked' && (
          <div className="site-card">
            <h2>🚫 Request blocked</h2>
            <p>
              You have <b>revoked</b> ABC Loan&rsquo;s access on your Consent Dashboard.
              The gateway refused the request before anything was processed.
            </p>
          </div>
        )}

        {/* Done state: shows the Groth16 verdict (true/false) and receipt.
            Same structure as Swift Loan — one boolean, one receipt, nothing else. */}
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
