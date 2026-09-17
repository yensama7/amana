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
// If this ID changes, every citizen's Swift Loan amanaId changes too.
const RP = { id: '1001', name: 'Swift Loan' };

// The minimum credit score Swift Loan requires.
// The citizen proves "my score >= 600" without revealing the actual number.
const MIN_SCORE = 600;

export default function SwiftLoan() {
  // The amanaId the citizen pastes from the wallet — a large decimal integer
  // (the Poseidon hash output) that uniquely identifies this citizen to Swift Loan.
  const [amanaId, setAmanaId] = useState('');

  // Current UI phase:
  //   idle     — form visible, waiting for the citizen to paste and click
  //   waiting  — request created, polling gateway every 2s for a verdict
  //   done     — citizen responded (approved or denied); outcome is set
  //   blocked  — citizen had revoked Swift Loan; gateway returned 403
  const [phase, setPhase] = useState('idle');

  // The gateway verdict once the request resolves: { ok: bool, receiptId, status }.
  const [outcome, setOutcome] = useState(null);

  // Ref to hold the setInterval handle so we can clear it on unmount or on result.
  const timerRef = useRef(null);

  // Clear the outcome poller if the page unmounts mid-wait, preventing a
  // state update on an unmounted component.
  useEffect(() => () => clearInterval(timerRef.current), []);

  async function apply() {
    // Validate that the input is a pure decimal integer — all Poseidon hash
    // outputs are large decimal numbers, never hex or alphanumeric.
    if (!/^\d+$/.test(amanaId.trim())) {
      alert('Paste your Swift Loan amanaId from the Amana Way app (a long number).');
      return;
    }
    setOutcome(null);

    // POST /api/request — the gateway creates a pending request and returns a requestId.
    // Supplying amanaId tells the gateway to include the id_ownership claim.
    // Supplying minScore tells the gateway to include the credit_score_gte claim.
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
      // Citizen has revoked Swift Loan. Show the block message and stop here —
      // no requestId exists to poll, so no interval is started.
      setPhase('blocked');
      return;
    }
    const { requestId } = await res.json();

    // Poll GET /api/requests/:id every 2 seconds until the citizen responds
    // in the Amana Way app. Status transitions:
    //   pending   → citizen hasn't acted yet (keep polling)
    //   verified  → proofs passed; loan pre-approved
    //   failed    → proofs were submitted but gateway rejected one or more
    //   denied    → citizen pressed "Deny" in the wallet
    setPhase('waiting');
    timerRef.current = setInterval(async () => {
      const r = await fetch(`/api/requests/${requestId}`).then((x) => x.json());
      if (r.status !== 'pending') {
        // Request settled — stop polling and display the outcome.
        clearInterval(timerRef.current);
        setOutcome(r);
        setPhase('done');
      }
    }, 2000);
  }

  return (
    <div className="site site-swift">

      {/* Lender header: logo and minimal navigation to look like a real financial product */}
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

      {/* Hero: value proposition from the lender's perspective.
          Deliberately does NOT mention NIN, BVN, or documents — they don't exist here. */}
      <div className="site-hero">
        <span className="site-eyebrow">Loans up to ₦5,000,000</span>
        <h1>Money in your account <em>in minutes</em>, not days.</h1>
        <p>
          No paperwork. No branch visits. And thanks to Amana Gateway —
          no BVN, NIN, or documents ever leave your phone.
        </p>
      </div>

      <div className="site-body">
        {/* Feature tiles: three selling points that reinforce the ZK privacy message */}
        <div className="feature-tiles">
          <div className="tile"><b>⏱ 3-minute decision</b><span>Instant cryptographic verification, no manual review.</span></div>
          <div className="tile"><b>🔒 Zero data collected</b><span>We verify facts about you without ever seeing your data.</span></div>
          <div className="tile"><b>📉 From 3.5% monthly</b><span>Better verification means better rates.</span></div>
        </div>

        {/* Application form card: the four verification requirements and the amanaId input.
            The absence of a BVN/NIN field is the most important thing to notice here. */}
        <div className="site-card">
          <h2>Apply for a loan</h2>
          <p>To process your application we verify four facts through <b>Amana Gateway</b>:</p>

          {/* Requirement list: each item shows what is verified and what stays private.
              The lock icons reinforce that the zero-knowledge guarantee is per-claim,
              not just for the overall transaction. */}
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

          {/* Input row: the amanaId field + apply button.
              The font is monospace because the amanaId is a large integer that looks
              better in a fixed-width font. The button is disabled while waiting for
              the citizen to respond to avoid duplicate requests. */}
          <div className="row">
            <input
              value={amanaId}
              onChange={(e) => setAmanaId(e.target.value)}
              placeholder="Paste your Swift Loan amanaId"
              style={{ maxWidth: 460, fontFamily: 'var(--mono)', fontSize: 13 }}
            />
            <button onClick={apply} disabled={phase === 'waiting'}>Apply for loan</button>
          </div>

          {/* Demo tip: pastes the wrong company's amanaId to show that the
              id_ownership proof fails when the amanaId was derived for a different rpId.
              This is a deliberate negative demo — ZK cannot prove false statements. */}
          <p className="muted" style={{ marginTop: 14 }}>
            💡 Demo tip: paste your <i>ABC Loan</i> amanaId instead to watch ownership verification
            fail — proving ownership of another company&rsquo;s ID is cryptographically impossible.
          </p>

          {/* Trust strip: compliance and technology attribution */}
          <div className="trust-strip">
            🔐 Identity verification powered by <b>Amana Gateway</b> — zero-knowledge proofs, licensed under the NDPR
          </div>
        </div>

        {/* Waiting state: shown while polling for the citizen's response.
            The spinner is CSS-animated; the main thread is not blocked. */}
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

        {/* Blocked state: citizen revoked Swift Loan before this request.
            The gateway rejected the POST /api/request call entirely — no request
            ID was issued, nothing was added to the audit log as pending. */}
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

        {/* Done state: request settled. outcome.ok is the gateway's Groth16 verdict.
            receiptId is a UUID the lender can use as an audit reference.
            This is ALL Swift Loan ever receives — one boolean and one receipt. */}
        {phase === 'done' && outcome && (
          <div className="site-card">
            <div className="row">
              {/* Large check or cross makes the verdict unmissable in a live demo */}
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
