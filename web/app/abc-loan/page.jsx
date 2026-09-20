'use client';

import { useEffect, useRef, useState } from 'react';

// ABC Loan — the "lightweight" relying party in the Amana Way demo.
//
// Unlike Swift Loan, ABC Loan never asks for an amanaId or a minScore.
// It sends only { rpId, rpName } to the gateway, so the gateway derives
// just two claims: age_gte_18 and citizenship_ng. The citizen's wallet
// therefore only ever runs two circuits for this lender — no credit
// commitment, no ID ownership proof, nothing beyond what's asked.
//
// Flow: check eligibility (Amana proof) -> if eligible, fill in loan
// amount/purpose/term -> submit -> approved summary. The loan details
// themselves never touch the Amana gateway; they're local to ABC Loan,
// same as any lender's own application form would be.

const RP_ID = '2002';
const RP_NAME = 'ABC Loan';
const POLL_INTERVAL_MS = 2000;

export default function AbcLoan() {
  const [phase, setPhase] = useState('idle'); // 'idle' | 'waiting' | 'done' | 'blocked'
  const [outcome, setOutcome] = useState(null); // { ok, receiptId, status } | null
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  // Loan application form, shown only once outcome.ok is true.
  const [form, setForm] = useState({ amount: '', purpose: '', termMonths: '' });
  const [formError, setFormError] = useState(null);
  const [application, setApplication] = useState(null); // submitted details, once approved

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function apply() {
    setError(null);
    setOutcome(null);
    setApplication(null);

    let res;
    try {
      res = await fetch('/api/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rpId: RP_ID, rpName: RP_NAME }),
      });
    } catch {
      setError('Could not reach the Amana Gateway. Please try again.');
      return;
    }

    if (res.status === 403) {
      setPhase('blocked');
      return;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error('ABC Loan: /api/request failed', res.status, body);
      setError('Something went wrong starting verification. Please try again.');
      return;
    }

    const { requestId } = await res.json();
    setPhase('waiting');
    startPolling(requestId);
  }

  function startPolling(requestId) {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      let res;
      try {
        res = await fetch(`/api/requests/${requestId}`);
      } catch {
        return;
      }

      if (res.status === 404) {
        clearInterval(pollRef.current);
        setError('Verification request not found. Please try again.');
        setPhase('idle');
        return;
      }

      if (!res.ok) return;

      const data = await res.json();
      if (data.status === 'pending') return;

      clearInterval(pollRef.current);
      setOutcome({ ok: data.ok, receiptId: data.receiptId, status: data.status });
      setPhase('done');
    }, POLL_INTERVAL_MS);
  }

  function submitApplication(e) {
    e.preventDefault();
    setFormError(null);

    const amountNum = Number(form.amount);
    const termNum = Number(form.termMonths);

    if (!form.amount || Number.isNaN(amountNum) || amountNum <= 0) {
      setFormError('Enter a valid loan amount.');
      return;
    }
    if (!form.purpose.trim()) {
      setFormError('Tell us what the loan is for.');
      return;
    }
    if (!form.termMonths || Number.isNaN(termNum) || termNum <= 0) {
      setFormError('Enter a valid term in months.');
      return;
    }

    // No separate loan API here — approval is already established by the
    // Amana proof; this just records what was applied for.
    setApplication({ amount: amountNum, purpose: form.purpose.trim(), termMonths: termNum });
  }

  function startOver() {
    setPhase('idle');
    setOutcome(null);
    setError(null);
    setApplication(null);
    setForm({ amount: '', purpose: '', termMonths: '' });
  }

  return (
    <main>
      <div className="card">
        <h2>🏦 ABC Loan</h2>
        <p>We verify exactly two things before you can apply:</p>
        <p>
          <strong>age ≥ 18 · Nigerian citizen</strong>
        </p>
        <p className="muted">
          No ID to paste — open your Amana Way wallet after clicking below to approve the request.
        </p>
        <div className="row">
          <button onClick={apply} disabled={phase === 'waiting'}>
            {phase === 'waiting' ? 'Waiting for approval…' : 'Check eligibility'}
          </button>
        </div>
        {error && <p className="muted">{error}</p>}
      </div>

      {phase === 'waiting' && (
        <div className="card">
          <p>
            <span className="spinner" /> Waiting for you to approve this request in Amana Way…
          </p>
        </div>
      )}

      {phase === 'blocked' && (
        <div className="card">
          <h2>🚫 Request blocked</h2>
          <p>You've revoked ABC Loan's access in your Amana Way dashboard, so this request can't proceed.</p>
        </div>
      )}

      {phase === 'done' && outcome && !outcome.ok && (
        <div className="card">
          <h2>❌ Not eligible</h2>
          <p>
            ok: {String(outcome.ok)}
            {outcome.receiptId && (
              <>
                {' · receipt: '}
                <span className="mono">{outcome.receiptId}</span>
              </>
            )}
          </p>
          <p className="muted">You don't meet ABC Loan's age or citizenship requirement.</p>
        </div>
      )}

      {phase === 'done' && outcome && outcome.ok && !application && (
        <div className="card">
          <h2>✅ Eligible</h2>
          <p>
            ok: true
            {outcome.receiptId && (
              <>
                {' · receipt: '}
                <span className="mono">{outcome.receiptId}</span>
              </>
            )}
          </p>
          <p className="muted">
            ABC Loan only learned two facts about you — not your name, ID, or credit history. Fill in the loan
            details below to finish applying.
          </p>

          <form
            onSubmit={submitApplication}
            className="row"
            style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}
          >
            <label>
              Loan amount (₦)
              <input
                type="number"
                min="1"
                step="1"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
              />
            </label>
            <label>
              Purpose
              <input
                type="text"
                value={form.purpose}
                onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                required
              />
            </label>
            <label>
              Term (months)
              <input
                type="number"
                min="1"
                step="1"
                value={form.termMonths}
                onChange={(e) => setForm({ ...form, termMonths: e.target.value })}
                required
              />
            </label>
            <button type="submit">Submit application</button>
            {formError && <p className="muted">{formError}</p>}
          </form>
        </div>
      )}

      {application && (
        <div className="card">
          <h2>✅ Loan approved</h2>
          <p>
            <strong>₦{application.amount.toLocaleString()}</strong> over {application.termMonths} months
          </p>
          <p className="muted">Purpose: {application.purpose}</p>
          {outcome?.receiptId && (
            <p className="muted">
              Verified via Amana Way · receipt: <span className="mono">{outcome.receiptId}</span>
            </p>
          )}
          <div className="row">
            <button onClick={startOver}>Apply for another loan</button>
          </div>
        </div>
      )}
    </main>
  );
}
