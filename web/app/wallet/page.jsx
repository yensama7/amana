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
// This is intentional: the citizen knows what they're consenting to, phrase by phrase.
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
  // { identity, credit } loaded from GET /api/credential on mount.
  // Both are objects with { attrs, commitment, signature, issuerPublicKey }.
  const [creds, setCreds] = useState(null);

  // Derived amanaIds: { [companyId]: string } — Poseidon(secret, companyId) for each company.
  // Computed locally from creds.identity.attrs.secret — never sent to the server.
  const [amanaIds, setAmanaIds] = useState(null);

  // The most recent pending consent request from a company, or null if none.
  // Polled from GET /api/requests/pending every 2 seconds while idle.
  const [request, setRequest] = useState(null);

  // Proving phase:
  //   null        — idle, nothing is proving
  //   'all'       — one Worker per circuit running, proofs not yet complete
  //   'submitting' — all proofs generated, POST /api/verify in flight
  const [proving, setProving] = useState(null);

  // Per-circuit completion flags: { [circuit]: true } flips as each Worker finishes.
  // Passed into ZKTerminal to update the progress display in real-time.
  const [claimDone, setClaimDone] = useState({});

  // Last gateway verdict from POST /api/verify: { ok: bool, receiptId: string }.
  const [result, setResult] = useState(null);

  // Error message if proof generation fails (false statement, worker crash, etc.).
  const [error, setError] = useState(null);

  // Liveness counter: increments 10 times per second on the MAIN thread.
  // If proofs ran on the main thread, this number would freeze during proving.
  // Its smooth increment proves that Web Workers handle the heavy computation.
  const [tick, setTick] = useState(0);

  // Which company's amanaId was most recently copied; used to show a "✓ Copied" flash.
  const [copied, setCopied] = useState(null);

  // True once all .wasm and .zkey artifacts have been preloaded into the Cache API.
  // Warm cache means the first approval proves at full speed with no download stall.
  const [warmed, setWarmed] = useState(false);

  // Error message from the initial credential/Poseidon load. Shown as a retry card
  // instead of an eternal spinner (e.g. if the gateway hasn't started yet).
  const [loadError, setLoadError] = useState(null);

  // Poseidon hasher instance, cached after first load so it doesn't rebuild
  // on every re-render. Must match the circuits' implementation exactly.
  const poseidonRef = useRef(null);

  // True while any proving activity is in progress — used to pause the consent poller.
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
  // serving them here is a hackathon shortcut (see db.js for the "attrs" columns).
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
          // Different companies get different IDs for the same citizen (unlinkability).
          ids[co.id] = poseidon.F.toString(poseidon([BigInt(c.identity.attrs.secret), BigInt(co.id)]));
        }
        setAmanaIds(ids);
      } catch (err) {
        // Gateway down, or a stale cached JS chunk failed to import — either
        // way, tell the user instead of spinning forever.
        setLoadError(String(err?.message || err));
      }
    })();
  }, []);

  // Warm the proof-artifact cache in the background: pull every .wasm/.zkey into
  // the same 'zk-v2' Cache API bucket the prover worker reads from, so the FIRST
  // approval of the demo proves at full speed instead of stalling on ~10MB of downloads.
  // Uses the same cache version string as sw.js and prover.worker.js — all three must agree.
  useEffect(() => {
    if (typeof caches === 'undefined') return;
    (async () => {
      try {
        const cache = await caches.open('zk-v2');
        for (const circuit of Object.keys(CLAIM_LABELS)) {
          for (const ext of ['wasm', 'zkey']) {
            const url = `/zk/${circuit}.${ext}`;
            // Only fetch if not already cached — avoids re-downloading on every wallet open.
            if (!(await cache.match(url))) {
              const res = await fetch(url);
              // Never cache an error response as a proving artifact — snarkjs would fail
              // on every subsequent proving attempt until the cache was manually cleared.
              if (res.ok) await cache.put(url, res);
            }
          }
        }
        setWarmed(true);
      } catch { /* cache unavailable — worker will fetch on demand */ }
    })();
  }, []);

  // While idle, poll the gateway every 2 seconds for pending consent requests.
  // Stops polling during proof generation (busy = true) to avoid race conditions
  // where a new consent request arrives while an existing one is being proved.
  useEffect(() => {
    if (busy) return;
    const t = setInterval(async () => {
      try {
        const rows = await fetch('/api/requests/pending').then((r) => r.json());
        // Show only the most recent pending request (rows[0]).
        // Multiple pending requests are possible but unusual; the citizen handles them one at a time.
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
        // This is an expected "error" — the wallet catches it and sends a deny to the gateway.
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
  // The credit circuit uses a separate creditCommitment from the bureau-issued credential.
  function buildInputs(rq) {
    const a = creds.identity.attrs;
    // idBase: private fields + the three public values that bind this proof to this request.
    const idBase = {
      nin: a.nin, bvn: a.bvn, dob: a.dob, state: a.state,
      citizenship: a.citizenship, secret: a.secret, salt: a.salt,
      commitment: creds.identity.commitment,
      rpId: rq.rp_id, nonce: rq.nonce,
    };
    const c = creds.credit?.attrs;
    return {
      // age_gte_18 also needs the cutoff date (today minus 18 years as YYYYMMDD)
      age_gte_18:       { ...idBase, cutoffDate: String(rq.cutoff_date) },
      // citizenship_ng only needs the base inputs — the constraint is `citizenship === 566`
      citizenship_ng:   idBase,
      // id_ownership also needs the amanaId the company holds
      id_ownership:     { ...idBase, amanaId: rq.amana_id },
      // Credit circuit uses a separate commitment (bureau-issued), not the identity one.
      // c may be undefined if the request doesn't include a credit claim.
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
    setClaimDone({});
    const inputsByCircuit = buildInputs(request);
    setProving('all');
    try {
      // Run all required circuits simultaneously — one Worker thread each.
      // On a 4-core device, 4 proofs take roughly the same time as 1 proof sequentially.
      // Each promise also flips its claim's check mark in the ZK terminal as it lands.
      const proofResults = await Promise.all(
        request.claims.map(claim =>
          prove(claim, inputsByCircuit[claim]).then((r) => {
            // Mark this specific circuit as done in the terminal display.
            setClaimDone((d) => ({ ...d, [claim]: true }));
            return r;
          })
        )
      );
      // Reshape array of results into { circuit: { proof, publicSignals } } for the gateway.
      // The gateway expects exactly this shape in POST /api/verify.
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
      // Send an explicit deny so the audit log records this as 'denied' rather than
      // leaving the request in 'pending' forever (the nonce would still be burned).
      await fetch(`/api/requests/${request.id}/deny`, { method: 'POST' }).catch(() => {});
    } finally {
      // Reset proving state regardless of success or failure.
      setProving(null);
      setRequest(null);
    }
  }

  async function deny() {
    // POST /api/requests/:id/deny flips the request status to 'denied' and writes
    // an audit row so the citizen's dashboard shows this decision.
    await fetch(`/api/requests/${request.id}/deny`, { method: 'POST' });
    setRequest(null);
  }

  // Copy an amanaId to the clipboard and show a brief "✓ Copied" flash on the button.
  function copyId(coId) {
    navigator.clipboard.writeText(amanaIds[coId]).then(() => {
      setCopied(coId);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <div className="amana-bg">
      <div className="main">

        {/* Wallet header: title, badge, and proving-key warm-up status.
            The warm-up status tells the citizen whether the first approval will
            be instant (keys cached) or may take a few seconds (still downloading). */}
        <div className="row" style={{ marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>📱 Amana Way</h1>
          <span className="badge neutral">your identity wallet</span>
          <span className="spacer" />
          <span className="muted">
            <span className="live-dot" />
            {warmed ? 'proving keys cached · ready' : 'preloading proving keys…'}
          </span>
        </div>

        {/* Load error card: shown if credentials couldn't be fetched on mount.
            Displays the raw error message so a developer can debug immediately.
            The most common cause is the gateway still starting up (docker boot). */}
        {loadError && (
          <div className="card">
            <div className="row">
              <span className="fail-pop">✕</span>
              <h2 style={{ margin: 0 }}>Wallet could not load</h2>
            </div>
            <p className="muted" style={{ marginTop: 12 }}>{loadError}</p>
            <p className="muted">
              Usually the gateway is still starting, or a stale cached version of the
              app is interfering. Reloading fetches everything fresh.
            </p>
            <button onClick={() => location.reload()}>Reload wallet</button>
          </div>
        )}

        {/* Credential display card: shows the two signed credentials held by this wallet.
            The fields listed are what the commitment seals — they are never transmitted.
            The commitment string itself IS public (it's the hash output on-chain).
            "Sealed on device" reminds the citizen (and judges) that attrs never leave. */}
        <div className="card">
          <h2>Your credentials</h2>
          {loadError ? (
            // Suppress the loading spinner during error state — give a clear message instead.
            <p className="muted">Unavailable until the wallet reloads.</p>
          ) : !creds ? (
            // Credentials are still loading from the gateway.
            <p className="muted"><span className="spinner" />Loading credentials from the gateway…</p>
          ) : (
            <>
              {/* Identity credential: issued by the national registry via the NIMC Trust Bridge.
                  Covers NIN, BVN, date of birth, state, citizenship. */}
              <div className="cred-card">
                <div className="cred-top">
                  <span>National Identity Credential</span>
                  <span className="sealed-chip">🔏 Sealed on device</span>
                </div>
                <div className="holder">{creds.identity.attrs.name}</div>
                <div className="fields">
                  Contains (never transmitted): NIN · BVN · date of birth · state · citizenship
                </div>
                {/* The full commitment is displayed so judges can verify it matches
                    what the gateway signed (GET /api/credential returns it). */}
                <div className="chipline">commitment {creds.identity.commitment}</div>
                <div className="fields" style={{ marginTop: 6 }}>
                  ✒️ Signed by the National Registry via the NIMC Trust Bridge
                </div>
              </div>

              {/* Credit credential: issued by the credit bureau.
                  Covers score, active loans, defaults. Only shown if issued. */}
              {creds.credit && (
                <div className="cred-card credit">
                  <div className="cred-top">
                    <span>Credit Credential</span>
                    <span className="sealed-chip">🔏 Sealed on device</span>
                  </div>
                  <div className="holder">{creds.identity.attrs.name}</div>
                  <div className="fields">
                    Contains (never transmitted): credit score · active loans · defaults
                  </div>
                  <div className="chipline">commitment {creds.credit.commitment}</div>
                  <div className="fields" style={{ marginTop: 6 }}>
                    ✒️ Signed by the Credit Bureau — lenders only ever learn &ldquo;score ≥ X: true/false&rdquo;
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* AmanaId display card: one row per company.
            Each ID is Poseidon(secret, companyId) — mathematically unique per company.
            The "Copy" button is the main citizen action: they paste this into the lender's form.
            The IDs being different for each company is the unlinkability guarantee. */}
        <div className="card">
          <h2>Your amanaIds</h2>
          <p className="muted">
            One ID per company, mathematically bound to your wallet secret and that company only.
            Give a company its ID instead of your BVN/NIN — a stolen ID is useless, because
            only this wallet can generate the ownership proof. The two IDs are different on purpose:
            companies cannot link records without your cryptographic permission.
          </p>
          {loadError ? (
            <p className="muted">Unavailable until the wallet reloads.</p>
          ) : !amanaIds ? (
            <p className="muted"><span className="spinner" />Deriving IDs with Poseidon…</p>
          ) : (
            COMPANIES.map((co) => (
              <div className="amana-row" key={co.id}>
                {/* Company name label */}
                <span className="co">{co.name}</span>
                {/* The amanaId itself — a large decimal integer (Poseidon output).
                    Displayed in full so the citizen can verify it matches what they pasted. */}
                <span className="id">{amanaIds[co.id]}</span>
                {/* Copy button: writes the amanaId to the clipboard and shows a
                    transient "✓ Copied" state for 1.5 seconds to confirm success. */}
                <button
                  className={`copy-btn ${copied === co.id ? 'copied' : ''}`}
                  onClick={() => copyId(co.id)}
                >
                  {copied === co.id ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Consent request card: shown when a pending request arrives from a company.
            Hidden while proving (busy) because the approval buttons are meaningless mid-proof.
            The claim list is translated to human-readable labels via CLAIM_LABELS so the
            citizen knows exactly what will be proved — no cryptographic jargon. */}
        {request && !busy && (
          <div className="card elevated">
            <h2>🔔 Consent request from {request.rp_name}</h2>
            <p><b>{request.rp_name}</b> asks you to prove, in zero knowledge:</p>
            <ul className="claim-list">
              {request.claims.map((c) => (
                <li key={c}>
                  <span className="ico">🔐</span>
                  {/* CLAIM_LABELS[c] is the plain-English description of what this circuit proves */}
                  {CLAIM_LABELS[c]}
                </li>
              ))}
            </ul>
            <p className="muted">
              Approving generates a cryptographic proof for each claim — only true/false answers
              leave your wallet. No raw data (NIN, BVN, score, birthday) is ever transmitted.
            </p>
            <div className="row">
              {/* Approve triggers proof generation for all claims in parallel.
                  Disabled if credentials haven't loaded yet (no inputs to build). */}
              <button onClick={approve} disabled={!creds}>Approve &amp; generate proofs</button>
              {/* Deny sends POST /api/requests/:id/deny and removes the request from view */}
              <button className="ghost" onClick={deny}>Deny</button>
            </div>
          </div>
        )}

        {/* Proving-in-progress card: shown while one or more Workers are running.
            The ZKTerminal component provides a live per-circuit progress display.
            The liveness counter below the terminal is the visual proof that the
            main thread is NOT blocked during SNARK computation. */}
        {busy && (
          <div className="card elevated">
            <h2><span className="spinner" />Generating proofs in Web Workers…</h2>
            <p>
              {proving === 'submitting'
                // All proofs are done; now waiting for the gateway to run groth16.verify()
                ? 'All proofs generated — submitting to the gateway for Groth16 verification…'
                : `Proving ${request?.claims?.length ?? ''} claims in parallel, one CPU thread each…`}
            </p>
            {/* ZKTerminal shows the Poseidon formula + per-circuit tick marks.
                proving, claims, and claimDone are passed down as controlled props. */}
            <ZKTerminal proving={proving} claims={request?.claims ?? []} claimDone={claimDone} />
            {/* The liveness counter: its smooth increment proves the UI is not frozen.
                If proofs ran synchronously on the main thread this number would stop
                incrementing for several seconds during each circuit. */}
            <p className="muted">
              Main thread is still alive — liveness counter: <b>{tick}</b> (it
              would freeze if we proved on the UI thread instead of Web Workers).
            </p>
          </div>
        )}

        {/* Outcome card: shows the final gateway verdict after all proofs are submitted.
            ok = true means all Groth16 verifications passed.
            receiptId is a UUID the lender can use as an audit reference. */}
        {result && (
          <div className="card elevated">
            <div className="row">
              <span className={result.ok ? 'success-pop' : 'fail-pop'}>{result.ok ? '✓' : '✕'}</span>
              <h2 style={{ margin: 0 }}>{result.ok ? 'Verified' : 'Not verified'}</h2>
            </div>
            <p className="mono" style={{ marginTop: 12 }}>receipt: {result.receiptId || '—'}</p>
            <p className="muted">The company received only this boolean and receipt. Nothing else.</p>
          </div>
        )}

        {/* Error card: shown when proof generation fails (false statement, or a worker crash).
            The most common cause during the demo is pastig the wrong amanaId into a lender —
            the id_ownership circuit cannot prove a false claim, so it throws an error instead. */}
        {error && (
          <div className="card">
            <div className="row">
              <span className="fail-pop">✕</span>
              <h2 style={{ margin: 0 }}>Could not generate proof</h2>
            </div>
            <p className="muted" style={{ marginTop: 12 }}>{error}</p>
            <p className="muted">
              This usually means a requested statement is false — for example, the amanaId
              the company holds belongs to a different wallet. ZK proofs of false statements
              are impossible, so the request was denied automatically.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
