'use client';
// Citizen Wallet — holds the two signed credentials (identity + credit),
// shows the citizen their shareable amanaIds, runs the consent screen, and
// generates ZK proofs in a Web Worker when the citizen approves.
import { useEffect, useRef, useState } from 'react';

// Human-readable descriptions of what each circuit actually proves.
// The consent screen shows EXACTLY these — nothing more is disclosed.
const CLAIM_LABELS = {
  age_gte_18: 'You are 18 or older (your date of birth stays private)',
  citizenship_ng: 'You are a Nigerian citizen',
  id_ownership: 'The amanaId this company holds really belongs to this wallet (your NIN/BVN stay private)',
  credit_score_gte: 'Your credit score meets their minimum (the actual score stays private)',
  bvn_match: 'The BVN the requester holds is yours (the BVN itself stays private)',
};

// Companies the demo knows about. amanaIds are derived per-company, so
// each of these gets a DIFFERENT id for the same citizen.
const COMPANIES = [
  { id: '1001', name: 'SwiftLoan' },
  { id: '2002', name: 'GTBank' },
];

export default function Wallet() {
  const [creds, setCreds] = useState(null);      // { identity, credit }
  const [amanaIds, setAmanaIds] = useState(null); // { [companyId]: derived id }
  const [request, setRequest] = useState(null);   // pending consent request, if any
  const [proving, setProving] = useState(null);   // circuit currently being proven
  const [result, setResult] = useState(null);     // last gateway verdict
  const [linkState, setLinkState] = useState('idle'); // idle | working | linked | error
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);            // main-thread liveness counter
  const workerRef = useRef(null);
  const poseidonRef = useRef(null);
  const busy = proving !== null;

  // Same Poseidon the circuits use — needed to derive amanaIds locally.
  async function getPoseidon() {
    if (!poseidonRef.current) {
      const { buildPoseidon } = await import('circomlibjs');
      poseidonRef.current = await buildPoseidon();
    }
    return poseidonRef.current;
  }

  // Load credentials once, then derive this wallet's amanaId for each
  // known company: amanaId = Poseidon(secret, companyId).
  useEffect(() => {
    (async () => {
      try {
        const c = await fetch('/api/credential').then((r) => r.json());
        setCreds(c);
        const poseidon = await getPoseidon();
        const ids = {};
        for (const co of COMPANIES) {
          ids[co.id] = poseidon.F.toString(poseidon([BigInt(c.identity.attrs.secret), BigInt(co.id)]));
        }
        setAmanaIds(ids);
      } catch { /* gateway not up yet; refresh the page */ }
    })();
  }, []);

  // Poll the gateway for pending consent requests while idle.
  useEffect(() => {
    if (busy) return;
    const t = setInterval(async () => {
      try {
        const rows = await fetch('/api/requests/pending').then((r) => r.json());
        setRequest(rows[0] || null);
      } catch { /* gateway briefly unreachable; next tick retries */ }
    }, 2000);
    return () => clearInterval(t);
  }, [busy]);

  // This counter increments 10x/second on the MAIN thread. If proving ran
  // on the main thread it would freeze — its smooth ticking during proof
  // generation is the visible evidence that the Web Worker is doing the work.
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 100);
    return () => clearInterval(t);
  }, []);

  // Send one job to the prover worker and await its reply.
  function prove(circuit, inputs) {
    if (!workerRef.current) {
      // Lazy-init: the worker pulls in snarkjs (heavy), so only pay that
      // cost when the user actually approves something.
      workerRef.current = new Worker(new URL('../../lib/prover.worker.js', import.meta.url));
    }
    return new Promise((resolve, reject) => {
      const w = workerRef.current;
      w.onmessage = (e) =>
        e.data.error ? reject(new Error(`${circuit}: ${e.data.error}`)) : resolve(e.data);
      w.onerror = (e) => reject(new Error(e.message || 'worker error'));
      w.postMessage({ circuit, inputs });
    });
  }

  // Build the private + public inputs each circuit needs for this request.
  function buildInputs(rq) {
    const a = creds.identity.attrs;
    const idBase = {
      nin: a.nin, bvn: a.bvn, dob: a.dob, state: a.state,
      citizenship: a.citizenship, secret: a.secret, salt: a.salt,
      commitment: creds.identity.commitment,
      rpId: rq.rp_id, nonce: rq.nonce,
    };
    const c = creds.credit?.attrs;
    return {
      age_gte_18: { ...idBase, cutoffDate: String(rq.cutoff_date) },
      citizenship_ng: idBase,
      id_ownership: { ...idBase, amanaId: rq.amana_id },
      bvn_match: { ...idBase, bvnHash: rq.bvn_hash },
      credit_score_gte: c && {
        score: c.score, activeLoans: c.activeLoans, defaults: c.defaults,
        secret: c.secret, salt: c.salt,
        creditCommitment: creds.credit.commitment,
        rpId: rq.rp_id, nonce: rq.nonce, minScore: String(rq.min_score),
      },
    };
  }

  async function approve() {
    setError(null);
    setResult(null);
    const inputsByCircuit = buildInputs(request);
    try {
      const proofs = {};
      for (const claim of request.claims) {
        setProving(claim);
        const { proof, publicSignals } = await prove(claim, inputsByCircuit[claim]);
        proofs[claim] = { proof, publicSignals };
      }
      setProving('submitting');
      const out = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: request.id, proofs }),
      }).then((r) => r.json());
      setResult(out);
    } catch (err) {
      // Proving failed => a statement is false (e.g. the amanaId the
      // company holds is not this wallet's). Deny so they get a clean "no".
      setError(err.message);
      await fetch(`/api/requests/${request.id}/deny`, { method: 'POST' }).catch(() => {});
    } finally {
      setProving(null);
      setRequest(null);
    }
  }

  async function deny() {
    await fetch(`/api/requests/${request.id}/deny`, { method: 'POST' });
    setRequest(null);
  }

  // Option 3: authorise the credit bureau to link this citizen's SwiftLoan
  // and GTBank IDs. Without this proof the two IDs are mathematically
  // unlinkable — this is the citizen's cryptographic permission slip.
  async function authoriseLinkage() {
    setLinkState('working');
    try {
      const { linkageId, nonce } = await fetch('/api/linkage/start', { method: 'POST' })
        .then((r) => r.json());
      const a = creds.identity.attrs;
      const { proof, publicSignals } = await prove('id_linkage', {
        nin: a.nin, bvn: a.bvn, dob: a.dob, state: a.state,
        citizenship: a.citizenship, secret: a.secret, salt: a.salt,
        commitment: creds.identity.commitment,
        rpIdA: '1001', idA: amanaIds['1001'],
        rpIdB: '2002', idB: amanaIds['2002'],
        nonce,
      });
      const out = await fetch('/api/linkage/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkageId, proof, publicSignals }),
      }).then((r) => r.json());
      setLinkState(out.ok ? 'linked' : 'error');
    } catch {
      setLinkState('error');
    }
  }

  return (
    <>
      <div className="card">
        <h2>Your credentials</h2>
        {!creds ? (
          <p className="muted">Loading credentials…</p>
        ) : (
          <>
            <p>
              <b>Identity</b> — issued to <b>{creds.identity.attrs.name}</b>, signed by
              the National Registry. Contains (sealed, on this device): NIN, BVN,
              date of birth, state, citizenship.
            </p>
            <p className="mono">identity commitment: {creds.identity.commitment}</p>
            {creds.credit && (
              <>
                <p>
                  <b>Credit</b> — signed by CRC Credit Bureau. Contains (sealed):
                  credit score, active loans, defaults. Lenders only ever learn
                  &ldquo;score is above X: true/false&rdquo;.
                </p>
                <p className="mono">credit commitment: {creds.credit.commitment}</p>
              </>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2>Your amanaIds</h2>
        <p className="muted">
          One ID per company, derived from your wallet secret. Give a company
          its ID instead of your BVN/NIN — a stolen ID is useless, because only
          this wallet can prove ownership of it. Note the two IDs differ: the
          companies cannot combine records about you without your say-so.
        </p>
        {!amanaIds ? (
          <p className="muted">Deriving IDs…</p>
        ) : (
          COMPANIES.map((co) => (
            <p key={co.id}>
              <b>{co.name}:</b>{' '}
              <span className="mono">{amanaIds[co.id]}</span>
            </p>
          ))
        )}
      </div>

      {request && !busy && (
        <div className="card">
          <h2>🔔 Consent request from {request.rp_name}</h2>
          <p><b>{request.rp_name}</b> asks you to prove, in zero knowledge:</p>
          <ul className="claims">
            {request.claims.map((c) => <li key={c}>{CLAIM_LABELS[c]}</li>)}
          </ul>
          <p className="muted">
            Approving shares only true/false answers — no raw data leaves your wallet.
          </p>
          <div className="row">
            <button onClick={approve} disabled={!creds}>Approve &amp; generate proofs</button>
            <button className="ghost" onClick={deny}>Deny</button>
          </div>
        </div>
      )}

      {busy && (
        <div className="card">
          <h2><span className="spinner" />Generating proofs in Web Worker…</h2>
          <p>
            {proving === 'submitting'
              ? 'Submitting proofs to the gateway…'
              : <>Proving <b>{proving}</b>…</>}
          </p>
          <p className="muted">
            Main thread is still alive — liveness counter: <b>{tick}</b> (it
            would freeze if we proved on the UI thread).
          </p>
        </div>
      )}

      {result && (
        <div className="card">
          <h2>{result.ok ? '✅ Verified' : '❌ Not verified'}</h2>
          <p className="mono">receipt: {result.receiptId || '—'}</p>
          <p className="muted">The company received only this boolean and receipt.</p>
        </div>
      )}

      {error && (
        <div className="card">
          <h2>❌ Could not generate proof</h2>
          <p className="muted">{error}</p>
          <p className="muted">
            This usually means a requested statement is false (e.g. the amanaId
            the company holds is not this wallet&rsquo;s) — ZK proofs of false
            statements are impossible, so the request was denied.
          </p>
        </div>
      )}

      <div className="card">
        <h2>Link my IDs (credit history)</h2>
        <p className="muted">
          Your SwiftLoan and GTBank IDs are unlinkable by default. To let the
          credit bureau build your credit history from both, you can authorise
          the link — a one-time, logged, zero-knowledge permission slip.
        </p>
        <div className="row">
          <button
            onClick={authoriseLinkage}
            disabled={!amanaIds || linkState === 'working' || linkState === 'linked'}
          >
            {linkState === 'linked' ? 'IDs linked ✓' : 'Authorise SwiftLoan ↔ GTBank link'}
          </button>
          {linkState === 'working' && <span className="muted"><span className="spinner" />proving…</span>}
          {linkState === 'error' && <span className="muted">linkage failed — try again</span>}
        </div>
        {linkState === 'linked' && (
          <p className="muted">Done — check the <a href="/dashboard">dashboard</a>: the link is on your audit log.</p>
        )}
      </div>
    </>
  );
}
