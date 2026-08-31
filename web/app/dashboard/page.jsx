'use client';
// Consent Dashboard — the citizen's control panel: a full audit trail of
// who asked what (and the outcome), plus per-relying-party revocation.
import { useEffect, useState } from 'react';

const CLAIM_SHORT = {
  age_gte_18: 'age ≥ 18',
  citizenship_ng: 'citizenship = NG',
  id_ownership: 'ID ownership',
  credit_score_gte: 'credit check',
};

// Deterministic avatar colour per relying party.
const AVATAR_COLORS = ['#2563eb', '#d97706', '#7c3aed', '#0d9488'];

export default function Dashboard() {
  const [audit, setAudit] = useState([]);
  const [revoked, setRevoked] = useState([]); // rows from /api/revocations

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

  // Light polling keeps the demo live across the three open tabs.
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  async function setRevocation(rpId, rpName, revoke) {
    await fetch(`/api/${revoke ? 'revoke' : 'unrevoke'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rpId, rpName }),
    });
    refresh();
  }

  const isRevoked = (rpId) => revoked.some((r) => r.rp_id === rpId);

  // Distinct relying parties seen in the audit log → revocation controls.
  const parties = [...new Map(audit.map((e) => [e.rp_id, e.rp_name])).entries()];

  const count = (outcome) => audit.filter((e) => e.outcome === outcome).length;

  return (
    <div className="amana-bg">
      <div className="main">
        <div className="row" style={{ marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>🛡 Consent Dashboard</h1>
          <span className="badge neutral">your data, your rules</span>
          <span className="spacer" />
          <span className="muted"><span className="live-dot" />live</span>
        </div>

        <div className="stat-cards">
          <div className="stat-card"><b>{audit.length}</b><span>total requests</span></div>
          <div className="stat-card ok"><b>{count('verified')}</b><span>verified</span></div>
          <div className="stat-card warn"><b>{count('denied')}</b><span>denied by you</span></div>
          <div className="stat-card bad"><b>{count('blocked') + count('failed')}</b><span>blocked / failed</span></div>
        </div>

        <div className="card">
          <h2>Relying parties</h2>
          {parties.length === 0 && (
            <p className="muted">No relying party has asked for anything yet. Try applying at a lender.</p>
          )}
          {parties.map(([rpId, rpName], i) => (
            <div className="party-row" key={rpId}>
              <span className="avatar" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                {rpName?.[0] ?? '?'}
              </span>
              <span style={{ minWidth: 140 }}>
                <b>{rpName}</b>
                <span className="muted" style={{ display: 'block' }}>company id {rpId}</span>
              </span>
              <span className="spacer" />
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

        <div className="card">
          <h2>Audit log</h2>
          {audit.length === 0 ? (
            <p className="muted">No verification events yet.</p>
          ) : (
            <table>
              <thead>
                <tr><th>When</th><th>Who asked</th><th>What they asked</th><th>Outcome</th><th>Receipt</th></tr>
              </thead>
              <tbody>
                {audit.map((e) => (
                  <tr key={e.id}>
                    <td className="muted">{new Date(e.created_at).toLocaleTimeString()}</td>
                    <td><b>{e.rp_name}</b></td>
                    <td className="muted">{e.claims.map((c) => CLAIM_SHORT[c] || c).join(' · ')}</td>
                    <td><span className={`badge ${e.outcome}`}>{e.outcome}</span></td>
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
