'use client';
// Amana Way — the citizen-facing identity wallet.
//
// This component does three things:
//   1. Loads the citizen's two signed credentials (identity + credit) from the gateway.
//   2. Derives a unique, unlinkable amanaId for each company using Poseidon(secret, companyId).
//      The same citizen gets a DIFFERENT id for Swift Loan vs ABC Loan — companies can't
//      combine records without the citizen's explicit cryptographic permission.
//   3. When a company sends a consent request, the citizen sees exactly what will be proved
//      and can Approve (generating ZK proofs) or Deny.
//
// ZK proof generation runs in separate Web Worker threads (one per circuit) so the UI
// stays responsive. All circuits run in parallel via Promise.all — the "liveness counter"
// below is visual proof that the main thread never blocks.
import { useEffect, useRef, useState } from 'react';
import ZKTerminal from '../components/ZKTerminal';

// Human-readable descriptions of what each circuit actually proves.
// The consent screen shows EXACTLY these labels — nothing more is disclosed.
const CLAIM_LABELS = {
  age_gte_18:       'You are 18 or older (your date of birth stays private)',
  citizenship_ng:   'You are a Nigerian citizen',
  id_ownership:     'The amanaId this company holds really belongs to this wallet (your NIN/BVN stay private)',
  credit_score_gte: 'Your credit score meets their minimum (the actual score stays private)',
};

// The two accredited companies in the Amana Way demo.
// amanaId = Poseidon(secret, companyId) — each company gets a different opaque identifier
// for the same citizen. A stolen ID is useless because only this wallet can prove ownership.
const COMPANIES = [
  { id: '1001', name: 'Swift Loan' },
  { id: '2002', name: 'ABC Loan' },
];

export default function Wallet() {
  const [creds, setCreds] = useState(null);      // { identity, credit } — loaded from gateway
  const [amanaIds, setAmanaIds] = useState(null); // { [companyId]: derived BigInt string }
  const [request, setRequest] = useState(null);   // pending consent request from a company
  const [proving, setProving] = useState(null);   // 'all' | 'submitting' | null
  const [result, setResult] = useState(null);     // last gateway verdict { ok, receiptId }
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);            // main-thread liveness counter (increments 10x/sec)
  const poseidonRef = useRef(null);
  const busy = proving !== null;

  // Build and cache the Poseidon hasher — same implementation the Circom circuits use,
  // so the amanaIds derived here are guaranteed to match what the circuits expect.
  async function getPoseidon() {
    if (!poseidonRef.current) {
      const { buildPoseidon } = await import('circomlibjs');
      poseidonRef.current = await buildPoseidon();
    }
    return poseidonRef.current;
  }

  // On mount: load credentials from the gateway, then derive amanaIds locally.
  // In a real deployment, credentials live in secure on-device storage; the gateway
  // serving them here is a hackathon shortcut.
  useEffect(() => {
    (async () => {
      try {
        const c = await fetch('/api/credential').then((r) => r.json());
        setCreds(c);
        const poseidon = await getPoseidon();
        const ids = {};
        for (const co of COMPANIES) {
          // amanaId = Poseidon(walletSecret, companyId)
          // This is a one-way function: given amanaId + companyId you cannot recover the secret.
          ids[co.id] = poseidon.F.toString(poseidon([BigInt(c.identity.attrs.secret), BigInt(co.id)]));
        }
        setAmanaIds(ids);
      } catch { /* gateway not up yet — user can refresh */ }
    })();
  }, []);

  // While idle, poll the gateway every 2 seconds for pending consent requests.
  // Stops polling during proof generation (busy = true) to avoid race conditions.
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

  // The liveness counter ticks 10x/second on the MAIN thread.
  // If proofs ran on the main thread, this would freeze during proving.
  // Its smooth ticking is visible proof that Web Workers handle the heavy lifting.
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 100);
    return () => clearInterval(t);
  }, []);

  // Spawn a fresh Worker per circuit so Promise.all can run all proofs in true parallel.
  // Each worker loads snarkjs once, generates one proof, then is terminated.
  // The .wasm and .zkey files are fetched by the worker and cached in the Cache API
  // (see prover.worker.js) so subsequent runs load instantly from memory.
  function prove(circuit, inputs) {
    const worker = new Worker(new URL('../../lib/prover.worker.js', import.meta.url));
    return new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        worker.terminate();
        // If the worker returns an error, the statement was FALSE (ZK cannot prove false claims).
        e.data.error ? reject(new Error(`${circuit}: ${e.data.error}`)) : resolve(e.data);
      };
      worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'worker error')); };
      worker.postMessage({ circuit, inputs });
    });
  }

  // Assemble the private + public inputs each circuit needs.
  // Every identity circuit shares the same base (idBase) which pins the proof to:
  //   - the signed commitment (so you're proving about YOUR credential)
  //   - rpId + nonce (so the proof is bound to THIS request — replay impossible)
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
      age_gte_18:       { ...idBase, cutoffDate: String(rq.cutoff_date) },
      citizenship_ng:   idBase,
      id_ownership:     { ...idBase, amanaId: rq.amana_id },
      // Credit circuit uses a separate commitment (bureau-issued), not the identity one.
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
    setProving('all');
    try {
      // Run all required circuits simultaneously — one Worker thread each.
      // On a 4-core device, 4 proofs take roughly the same time as 1 proof sequentially.
      const proofResults = await Promise.all(
        request.claims.map(claim => prove(claim, inputsByCircuit[claim]))
      );
      // Reshape array of results into { circuit: { proof, publicSignals } } for the gateway.
      const proofs = Object.fromEntries(
        proofResults.map(r => [r.circuit, { proof: r.proof, publicSignals: r.publicSignals }])
      );
      setProving('submitting');
      const out = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: request.id, proofs }),
      }).then((r) => r.json());
      setResult(out);
    } catch (err) {
      // Proving failed — most likely a false statement (e.g. the company holds a different
      // wallet's amanaId). ZK cannot prove false statements; the request is denied cleanly.
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

  return (
    <>
      {/* --- Credential display ------------------------------------------------ */}
      <div className="card">
        <h2>Your credentials</h2>
        {!creds ? (
          <p className="muted">Loading credentials…</p>
        ) : (
          <>
            <p>
              <b>Identity</b> — issued to <b>{creds.identity.attrs.name}</b>, signed by
              the National Registry via the NIMC Trust Bridge. Contains (sealed, on this device):
              NIN, BVN, date of birth, state, citizenship.
            </p>
            <p className="mono">identity commitment: {creds.identity.commitment}</p>
            {creds.credit && (
              <>
                <p>
                  <b>Credit</b> — signed by the Credit Bureau. Contains (sealed):
                  credit score, active loans, defaults. Lenders only ever learn
                  &ldquo;score is above X: true/false&rdquo;.
                </p>
                <p className="mono">credit commitment: {creds.credit.commitment}</p>
              </>
            )}
          </>
        )}
      </div>

      {/* --- AmanaId display --------------------------------------------------- */}
      <div className="card">
        <h2>Your amanaIds</h2>
        <p className="muted">
          One ID per company, mathematically bound to your wallet secret and that company only.
          Give a company its ID instead of your BVN/NIN — a stolen ID is useless, because
          only this wallet can generate the ownership proof. The two IDs are different on purpose:
          companies cannot link records without your cryptographic permission.
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

      {/* --- Consent request --------------------------------------------------- */}
      {request && !busy && (
        <div className="card">
          <h2>🔔 Consent request from {request.rp_name}</h2>
          <p><b>{request.rp_name}</b> asks you to prove, in zero knowledge:</p>
          <ul className="claims">
            {request.claims.map((c) => <li key={c}>{CLAIM_LABELS[c]}</li>)}
          </ul>
          <p className="muted">
            Approving generates cryptographic proofs for each claim — only true/false answers
            leave your wallet. No raw data (NIN, BVN, score, birthday) is ever transmitted.
          </p>
          <div className="row">
            <button onClick={approve} disabled={!creds}>Approve &amp; generate proofs</button>
            <button className="ghost" onClick={deny}>Deny</button>
          </div>
        </div>
      )}

      {/* --- Proving in progress ----------------------------------------------- */}
      {busy && (
        <div className="card">
          <h2><span className="spinner" />Generating proofs in Web Workers…</h2>
          <p>
            {proving === 'submitting'
              ? 'Submitting proofs to the gateway…'
              : `Proving ${request?.claims?.length ?? ''} claims in parallel…`}
          </p>
          {/* ZKTerminal visualises the Poseidon hash formula and per-circuit progress */}
          <ZKTerminal proving={proving} claims={request?.claims ?? []} />
          <p className="muted">
            Main thread is still alive — liveness counter: <b>{tick}</b> (it
            would freeze if we proved on the UI thread instead of Web Workers).
          </p>
        </div>
      )}

      {/* --- Outcome ----------------------------------------------------------- */}
      {result && (
        <div className="card">
          <h2>{result.ok ? '✅ Verified' : '❌ Not verified'}</h2>
          <p className="mono">receipt: {result.receiptId || '—'}</p>
          <p className="muted">The company received only this boolean and receipt. Nothing else.</p>
        </div>
      )}

      {error && (
        <div className="card">
          <h2>❌ Could not generate proof</h2>
          <p className="muted">{error}</p>
          <p className="muted">
            This usually means a requested statement is false — for example, the amanaId
            the company holds belongs to a different wallet. ZK proofs of false statements
            are impossible, so the request was denied automatically.
          </p>
        </div>
      )}
    </>
  );
}
