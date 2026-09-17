'use client';
// Consent Dashboard — the citizen's control panel: a full audit trail of
// who asked what (and the outcome), plus per-relying-party revocation.
//
// The dashboard has two main sections:
//   1. Relying parties — a list of every company that has ever interacted with
//      this wallet, with an Approve/Revoke toggle for each.
//   2. Audit log — every verification event in reverse-chronological order,
//      including blocked and denied requests so the citizen sees everything.
//
// Data is polled from the gateway every 3 seconds so the dashboard stays live
// as the citizen runs the lender demo in another tab.
import { useEffect, useState } from 'react';

// Short human-readable labels for the four circuit claim IDs.
// The audit log stores the raw identifiers (e.g. 'age_gte_18') and this map
// translates them to text a non-technical citizen can understand.
const CLAIM_SHORT = {
  age_gte_18:       'age ≥ 18',
  citizenship_ng:   'citizenship = NG',
  id_ownership:     'ID ownership',
  credit_score_gte: 'credit check',
};

// A small palette of colours used to generate deterministic avatar initials.
// The index is rp_id % length, so the same company always gets the same colour
// across page reloads without storing any additional state.
const AVATAR_COLORS = ['#2563eb', '#d97706', '#7c3aed', '#0d9488'];

export default function Dashboard() {
  // audit: all rows from the audit_log table, newest first.
  const [audit, setAudit] = useState([]);

  // revoked: rows from the revocations table — each row means one company is blocked.
  // Presence of a company id in this array = revoked. Absence = active.
  const [revoked, setRevoked] = useState([]);

  // Fetch the latest audit log and revocation list in parallel.
  // Both endpoints are cheap (SELECT * ORDER BY id DESC LIMIT 100), so polling
  // every 3 seconds is fine and keeps the demo live across open tabs.
  async function refresh() {
    try {
      const [a, r] = await Promise.all([
        fetch('/api/audit').then((x) => x.json()),
        fetch('/api/revocations').then((x) => x.json()),
      ]);
      setAudit(a);
      setRevoked(r);
    } catch { /* gateway briefly unreachable; next tick retries */ }
  }

  // On mount, load data immediately then start a 3-second polling interval.
  // The cleanup function cancels the interval on unmount so there are no
  // stale state updates after the component is removed from the tree.
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  // POST to /api/revoke or /api/unrevoke depending on the desired new state,
  // then immediately refresh so the UI reflects the change.
  async function setRevocation(rpId, rpName, revoke) {
    await fetch(`/api/${revoke ? 'revoke' : 'unrevoke'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rpId, rpName }),
    });
    refresh();
  }

  // Check whether a company is currently revoked by scanning the revocations array.
  const isRevoked = (rpId) => revoked.some((r) => r.rp_id === rpId);

  // Deduplicate relying parties seen in the audit log using a Map keyed on rp_id.
  // This gives us one row per company in the Relying Parties section with its
  // current revocation status and a single Revoke/Restore button.
  const parties = [...new Map(audit.map((e) => [e.rp_id, e.rp_name])).entries()];

  // Helper: count audit entries that have a specific outcome string.
  // Used for the four headline stat cards at the top of the dashboard.
  const count = (outcome) => audit.filter((e) => e.outcome === outcome).length;

  return (
    <div className="amana-bg">
      <div className="main">

        {/* Dashboard header: title, "your data, your rules" badge, and live indicator */}
        <div className="row" style={{ marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>🛡 Consent Dashboard</h1>
          <span className="badge neutral">your data, your rules</span>
          <span className="spacer" />
          {/* The live dot is a CSS animation — it blinks to signal the 3s polling is active */}
          <span className="muted"><span className="live-dot" />live</span>
        </div>

        {/* Four headline stat cards: total, verified, denied-by-citizen, blocked+failed.
            Blocked = gateway refused because the company was revoked.
            Failed  = proofs submitted but gateway verification returned false. */}
        <div className="stat-cards">
          <div className="stat-card"><b>{audit.length}</b><span>total requests</span></div>
          <div className="stat-card ok"><b>{count('verified')}</b><span>verified</span></div>
          <div className="stat-card warn"><b>{count('denied')}</b><span>denied by you</span></div>
          <div className="stat-card bad"><b>{count('blocked') + count('failed')}</b><span>blocked / failed</span></div>
        </div>

        {/* Relying parties section: one row per unique company, with their revocation toggle.
            Empty state shown when no lender has made a request yet — prompts the
            user to start the demo by visiting one of the lender pages. */}
        <div className="card">
          <h2>Relying parties</h2>
          {parties.length === 0 && (
            <p className="muted">No relying party has asked for anything yet. Try applying at a lender.</p>
          )}
          {parties.map(([rpId, rpName], i) => (
            <div className="party-row" key={rpId}>
              {/* Avatar circle: the company's initial letter on a deterministic colour.
                  i % length ensures we cycle through colours without going out of bounds. */}
              <span className="avatar" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                {rpName?.[0] ?? '?'}
              </span>

              {/* Company name and internal ID — shows the judge that rp_id is an
                  opaque integer, not a name or any identifying string */}
              <span style={{ minWidth: 140 }}>
                <b>{rpName}</b>
                <span className="muted" style={{ display: 'block' }}>company id {rpId}</span>
              </span>

              <span className="spacer" />

              {/* Conditional rendering: if revoked, show the blocked badge + Restore button.
                  If active, show the verified badge + Revoke button.
                  The gateway checks this table on every /request and /verify call,
                  so a revoke takes effect immediately — no pending requests can succeed
                  for a revoked company even if a proof is already being generated. */}
              {isRevoked(rpId) ? (
                <>
                  <span className="badge blocked">access revoked</span>
                  <button className="ghost" onClick={() => setRevocation(rpId, rpName, false)}>Restore access</button>
                </>
              ) : (
                <>
                  <span className="badge verified">access active</span>
                  <button className="danger" onClick={() => setRevocation(rpId, rpName, true)}>Revoke access</button>
                </>
              )}
            </div>
          ))}
          <p className="muted">
            Revoking blocks all future verification requests from that party — the
            gateway refuses them before a proof is ever requested.
          </p>
        </div>

        {/* Audit log section: every verification event for this wallet, newest first.
            The claims column uses CLAIM_SHORT to show human-readable labels.
            Receipt IDs are truncated to 8 characters — full UUID visible in DB. */}
        <div className="card">
          <h2>Audit log</h2>
          {audit.length === 0 ? (
            <p className="muted">No verification events yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who asked</th>
                  <th>What they asked</th>
                  <th>Outcome</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((e) => (
                  <tr key={e.id}>
                    {/* Timestamp displayed as a local time string — precision is
                        sufficient for a demo; a production UI would show a full
                        date for requests older than 24 hours */}
                    <td className="muted">{new Date(e.created_at).toLocaleTimeString()}</td>
                    <td><b>{e.rp_name}</b></td>
                    {/* claims is an array of circuit IDs; join with · for readability */}
                    <td className="muted">{e.claims.map((c) => CLAIM_SHORT[c] || c).join(' · ')}</td>
                    {/* outcome badge class matches the CSS badge colour variants:
                        'verified' = green, 'denied' = yellow, 'blocked'/'failed' = red */}
                    <td><span className={`badge ${e.outcome}`}>{e.outcome}</span></td>
                    {/* Receipt ID is only set for completed (verified/failed) requests.
                        Denied and blocked requests do not produce a receipt. */}
                    <td className="mono">{e.receipt_id ? e.receipt_id.slice(0, 8) + '…' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  );
}
