'use client';

// ABC Loan — mock lender (relying party) that requests only TWO proofs:
//   age >= 18, Nigerian citizenship.
//
// Contrast with Swift Loan, which requests all four (age, citizenship, ID
// ownership, credit score). Together they demonstrate that ZK circuits are
// modular — each company only gets exactly what it asks for. Because ABC
// Loan never asks for an amanaId, there's no paste-an-ID step at all: just
// a single "Check eligibility" click.
//
// Flow:
//   1. Citizen clicks "Check eligibility" — no ID to paste.
//   2. ABC Loan sends POST /api/request with just { rpId, rpName }.
//   3. A consent request appears in the citizen's Amana Way app.
//   4. Citizen approves -> two proofs generated -> gateway verifies -> result here.
//   5. If eligible, a short loan application form appears (amount/purpose/term);
//      submitting it shows the final approved summary.
//
// The in-progress/completed request is persisted to localStorage so that
// navigating to the wallet and back to this page (a real page reload, same
// as any browser navigation) resumes correctly instead of resetting.

import { useEffect, useRef, useState } from 'react';

const RP = { id: '2002', name: 'ABC Loan' };
const STORAGE_KEY = 'abcLoanRequest';

function loadStored() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveStored(data) {
  try {
    if (data) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable — flow still works within a single unloaded tab.
  }
}

export default function AbcLoan() {
  // idle | waiting | done | blocked
  const [phase, setPhase] = useState('idle');
  const [outcome, setOutcome] = useState(null); // { ok, receiptId, status } | null
  const timerRef = useRef(null);

  const [form, setForm] = useState({ amount: '', purpose: '', termMonths: '' });
  const [formError, setFormError] = useState(null);
  const [application, setApplication] = useState(null);

  // Resume any in-progress or completed request from localStorage on load.
  useEffect(() => {
    const stored = loadStored();
    if (!stored) return;

    if (stored.application) {
      setApplication(stored.application);
      setOutcome(stored.outcome || null);
      setPhase('done');
      return;
    }
    if (stored.outcome) {
      setOutcome(stored.outcome);
      setPhase('done');
      return;
    }
    if (stored.requestId) {
      setPhase('waiting');
      poll(stored.requestId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => clearInterval(timerRef.current), []);

  async function apply() {
    setOutcome(null);
    setApplication(null);

    const res = await fetch('/api/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rpId: RP.id, rpName: RP.name }),
    });

    if (res.status === 403) {
      setPhase('blocked');
      saveStored(null);
      return;
    }
    const { requestId } = await res.json();

    setPhase('waiting');
    saveStored({ requestId });
    poll(requestId);
  }

  function poll(requestId) {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(async () => {
      const r = await fetch(`/api/requests/${requestId}`).then((x) => x.json());
      if (r.status !== 'pending') {
        clearInterval(timerRef.current);
        setOutcome(r);
        setPhase('done');
        saveStored({ requestId, outcome: r });
      }
    }, 2000);
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

    const applicationData = { amount: amountNum, purpose: form.purpose.trim(), termMonths: termNum };
    setApplication(applicationData);
    saveStored({ outcome, application: applicationData });
  }

  function startOver() {
    setPhase('idle');
    setOutcome(null);
    setApplication(null);
    setForm({ amount: '', purpose: '', termMonths: '' });
    saveStored(null);
  }

  return (
    <div className="site site-abc">
      {/* Lender header, matching Swift Loan's convention */}
      <header className="site-header">
        <span className="logo">🏦 ABC Loan</span>
        <nav>
          <span>Personal loans</span>
          <span>Rates</span>
          <span>Help</span>
        </nav>
        <span className="cta">Get started</span>
      </header>

      {/* Hero: ABC Loan's pitch is minimalism — the fewest checks possible */}
      <div className="site-hero">
        <span className="site-eyebrow">Loans up to ₦1,000,000</span>
        <h1>The simplest loan check you'll ever do.</h1>
        <p>
          Two facts, one click. Thanks to Amana Gateway — no BVN, NIN, or documents ever leave your phone, and we
          don't even ask for an ID number.
        </p>
      </div>

      <div className="site-body">
        <div className="feature-tiles">
          <div className="tile">
            <b>⚡ One click</b>
            <span>No form, no ID to paste — just approve in your wallet.</span>
          </div>
          <div className="tile">
            <b>🔒 Two facts only</b>
            <span>We verify age and citizenship — nothing else, ever.</span>
          </div>
          <div className="tile">
            <b>📄 Zero paperwork</b>
            <span>The gateway hands us a boolean and a receipt. That's it.</span>
          </div>
        </div>

        <div className="site-card">
          <h2>Check your eligibility</h2>
          <p>
            To process your application we verify two facts through <b>Amana Gateway</b>:
          </p>

          <ul className="req-list">
            <li>
              <span className="tick">✓</span> You are 18 or older <span className="lock">🔒 birthday stays private</span>
            </li>
            <li>
              <span className="tick">✓</span> You are a Nigerian citizen <span className="lock">🔒 zero-knowledge proof</span>
            </li>
          </ul>

          <p className="muted">
            No ID to paste — click below, then approve the request in your <a href="/wallet">Amana Way app</a>.
          </p>

          <div className="row">
            <button onClick={apply} disabled={phase === 'waiting'}>
              {phase === 'waiting' ? 'Waiting for approval…' : 'Check eligibility'}
            </button>
          </div>

          {phase === 'waiting' && (
            <p className="muted" style={{ marginTop: 14 }}>
              Waiting for you to approve this request in Amana Way — you can safely switch tabs or navigate away,
              this page will pick up the result when you come back.
            </p>
          )}
        </div>

        {phase === 'blocked' && (
          <div className="site-card">
            <div className="row">
              <span className="fail-pop">✕</span>
              <h2 style={{ margin: 0 }}>Request blocked</h2>
            </div>
            <p className="muted">You've revoked ABC Loan's access in your Amana Way dashboard.</p>
          </div>
        )}

        {phase === 'done' && outcome && (
          <div className="site-card">
            <div className="row">
              <span className={outcome.ok ? 'success-pop' : 'fail-pop'}>{outcome.ok ? '✓' : '✕'}</span>
              <h2 style={{ margin: 0 }}>{outcome.ok ? 'Eligible!' : 'Not eligible'}</h2>
            </div>
            <p style={{ marginTop: 12 }}>
              Gateway verdict: <b>{String(outcome.ok)}</b>{' '}
              {outcome.receiptId && <span className="mono">(receipt {outcome.receiptId})</span>}
            </p>
            <p className="muted">That boolean and receipt are ALL ABC Loan ever receives.</p>

            {!outcome.ok && (
              <div className="row" style={{ marginTop: 14 }}>
                <button onClick={startOver}>Start over</button>
              </div>
            )}
          </div>
        )}

        {phase === 'done' && outcome && outcome.ok && !application && (
          <div className="site-card">
            <h2>Finish your application</h2>
            <p className="muted">Fill in the loan details below to complete your application.</p>

            <form onSubmit={submitApplication} className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
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
          <div className="site-card">
            <div className="row">
              <span className="success-pop">✓</span>
              <h2 style={{ margin: 0 }}>Loan pre-approved!</h2>
            </div>
            <p style={{ marginTop: 12 }}>
              <b>₦{application.amount.toLocaleString()}</b> over {application.termMonths} months
            </p>
            <p className="muted">Purpose: {application.purpose}</p>
            {outcome?.receiptId && (
              <p className="muted">
                Verified via Amana Way · receipt: <span className="mono">{outcome.receiptId}</span>
              </p>
            )}
            <div className="row" style={{ marginTop: 14 }}>
              <button onClick={startOver}>Apply for another loan</button>
            </div>
          </div>
        )}

        <div className="trust-strip">🔐 Verified with zero-knowledge proofs via Amana Gateway</div>
      </div>
    </div>
  );
}
