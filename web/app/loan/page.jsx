'use client';
// SwiftLoan — the mock lender (relying party). Before "approving a loan"
// it needs four verified facts: over 18, Nigerian citizen, the applicant
// really owns the amanaId they gave us, and credit score ≥ 650.
//
// The important change from a classic KYC form: there is NO field for a
// BVN or NIN. The applicant pastes their amanaId — an opaque code from
// their wallet that identifies them WITHOUT authenticating them. Even if
// this ID leaked, nobody could use it: only the wallet holding the
// matching secret can generate the ownership proof.
import { useState } from 'react';

const RP = { id: '1001', name: 'SwiftLoan' };
const MIN_SCORE = 650; // the credit threshold this lender requires

export default function Loan() {
  const [amanaId, setAmanaId] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | waiting | done | blocked
  const [outcome, setOutcome] = useState(null);

  async function apply() {
    if (!/^\d+$/.test(amanaId.trim())) {
      alert('Paste your SwiftLoan amanaId from the wallet (a long number).');
      return;
    }
    setOutcome(null);

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

    // 403 = the citizen revoked us on their dashboard. Blocked, live.
    if (res.status === 403) {
      setPhase('blocked');
      return;
    }
    const { requestId } = await res.json();

    // Poll until the citizen responds (approves/denies in their wallet).
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
        <h2>💸 SwiftLoan — loan application</h2>
        <p>
          To process your loan we verify four things through Amana Gateway:
          you are over 18, a Nigerian citizen, the ID below is really yours,
          and your credit score is at least {MIN_SCORE}. <b>We never see your
          BVN, NIN, birthday, or actual score — only true/false answers.</b>
        </p>
        <p className="muted">
          Your SwiftLoan amanaId (copy it from your <a href="/wallet">wallet</a> —
          notice there is no BVN/NIN field on this form):
        </p>
        <div className="row">
          <input
            value={amanaId}
            onChange={(e) => setAmanaId(e.target.value)}
            placeholder="paste your SwiftLoan ID here"
            style={{ maxWidth: 460 }}
          />
          <button onClick={apply} disabled={phase === 'waiting'}>
            Apply for loan
          </button>
        </div>
        <p className="muted">
          Tip: paste your GTBank ID instead (or any random number) to see
          verification fail — proving ownership of an ID that isn&rsquo;t yours
          for this company is cryptographically impossible.
        </p>
      </div>

      {phase === 'waiting' && (
        <div className="card">
          <p><span className="spinner" />Waiting for the citizen to respond in their wallet…</p>
          <p className="muted">Open the <a href="/wallet">Citizen Wallet</a> tab to approve.</p>
        </div>
      )}

      {phase === 'blocked' && (
        <div className="card">
          <h2>🚫 Request blocked</h2>
          <p>
            The citizen has <b>revoked</b> SwiftLoan&rsquo;s access on their consent
            dashboard. No verification request can even be created.
          </p>
        </div>
      )}

      {phase === 'done' && outcome && (
        <div className="card">
          <h2>{outcome.ok ? '✅ Loan pre-approved' : '❌ Verification failed'}</h2>
          <p>
            Gateway verdict: <b>{String(outcome.ok)}</b>{' '}
            {outcome.receiptId && <span className="mono">(receipt {outcome.receiptId})</span>}
          </p>
          <p className="muted">
            That boolean — plus the receipt — is ALL SwiftLoan ever receives.
            No documents, no identity numbers, no credit report.
          </p>
        </div>
      )}
    </>
  );
}
