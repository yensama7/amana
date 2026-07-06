'use client';
// Consent Dashboard — the citizen's control panel: a full audit trail of
// who asked what (and the outcome), plus per-relying-party revocation.
import { useEffect, useState } from 'react';

const CLAIM_SHORT = {
  age_gte_18: 'age ≥ 18',
  citizenship_ng: 'citizenship = NG',
  bvn_match: 'BVN match',
  id_ownership: 'ID ownership',
  credit_score_gte: 'credit check',
  id_linkage: 'ID linkage',
};

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

  return (
    <>
      <div className="card">
        <h2>Relying parties</h2>
        {parties.length === 0 && <p className="muted">No relying party has asked for anything yet.</p>}
        {parties.map(([rpId, rpName]) => (
          <div className="row" key={rpId} style={{ marginBottom: 8 }}>
            <span style={{ minWidth: 160 }}><b>{rpName}</b> <span className="muted">(id {rpId})</span></span>
            {isRevoked(rpId) ? (
              <>
                <span className="badge blocked">revoked</span>
                <button className="ghost" onClick={() => setRevocation(rpId, rpName, false)}>Restore access</button>
              </>
            ) : (
              <button className="danger" onClick={() => setRevocation(rpId, rpName, true)}>Revoke access</button>
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
                  <td>{e.rp_name}</td>
                  <td>{e.claims.map((c) => CLAIM_SHORT[c] || c).join(', ')}</td>
                  <td><span className={`badge ${e.outcome}`}>{e.outcome}</span></td>
                  <td className="mono">{e.receipt_id ? e.receipt_id.slice(0, 8) + '…' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
