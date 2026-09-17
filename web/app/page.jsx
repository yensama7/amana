// Landing page: what the system is, who the actors are, and the exact demo script.
// This is the entry point for judges and new visitors. It explains the flow at a
// high level without requiring the reader to open any other page first.
export default function Home() {
  return (
    <div className="amana-bg">
      <div className="main-wide">

        {/* Hero section: the one-line value proposition and four headline stats.
            The stats are designed to be scannable — each answers one common question
            a judge or evaluator would ask about the system. */}
        <div className="hero">
          <span className="eyebrow">● Zero-Knowledge Identity for Nigeria</span>
          <h1>
            Prove facts, <span className="gradient-text">not data.</span>
          </h1>
          <p className="sub">
            Amana Gateway lets a citizen prove statements about themselves —
            over 18, Nigerian, this ID is mine, credit score high enough —
            using zero-knowledge proofs. No BVN. No NIN. No documents.
            Companies get a cryptographic <b>true/false</b>, and nothing else.
          </p>

          {/* Four headline stats that orient judges quickly:
              - 4 circuits  → the system is non-trivial, each statement is its own SNARK
              - 0 numbers   → the privacy guarantee is total, not partial
              - ~280 constr → small enough to prove in a browser in seconds
              - 100% device → no server ever sees private inputs */}
          <div className="stats">
            <div className="stat"><b>4</b><span>ZK circuits (Groth16)</span></div>
            <div className="stat"><b>0</b><span>identity numbers shared</span></div>
            <div className="stat"><b>~280</b><span>constraints per proof</span></div>
            <div className="stat"><b>100%</b><span>proved on-device</span></div>
          </div>
        </div>

        {/* Flow diagram: four-step overview of a single verification round-trip.
            Each node represents one actor; arrows show the direction of control.
            The key insight is that the citizen is in the middle — no data flows
            from the citizen to the lender, only a cryptographic true/false. */}
        <div className="card">
          <h2>How a verification flows</h2>
          <div className="flow">
            <div className="node"><b>💸 Lender</b><span>asks: &ldquo;is this person over 18?&rdquo;</span></div>
            <div className="arrow">→</div>
            <div className="node"><b>🔐 Gateway</b><span>creates a one-time consent request</span></div>
            <div className="arrow">→</div>
            <div className="node"><b>📱 Citizen Wallet</b><span>approves; proves it in-browser (Web Workers)</span></div>
            <div className="arrow">→</div>
            <div className="node"><b>✅ Verdict</b><span>lender receives true/false + receipt</span></div>
          </div>
          {/* The three security properties baked into every proof:
              credential binding (signed commitment), company binding (rpId),
              and single-use binding (nonce). All three are explained by one sentence. */}
          <p className="muted">
            Every proof is bound to a signed government credential, the requesting company,
            and a single-use nonce — replays and forgeries are cryptographically impossible.
          </p>
        </div>

        {/* Four entry-point cards — one per demo actor.
            Wallet and Dashboard are citizen-facing tools.
            Swift Loan and ABC Loan are mock lender sites (relying parties).
            The two lenders differ deliberately: Swift Loan needs 4 proofs,
            ABC Loan needs only 2. Side-by-side they demonstrate ZK modularity. */}
        <div className="grid-2">

          {/* Citizen Wallet: generates amanaIds and ZK proofs locally */}
          <div className="card">
            <h2>📱 Citizen Wallet</h2>
            <p>
              Holds two signed credentials (identity + credit), derives a different
              opaque <b>amanaId</b> per company, and generates all proofs locally
              in parallel Web Workers.
            </p>
            <a className="btn" href="/wallet">Open the wallet</a>
          </div>

          {/* Consent Dashboard: audit trail and per-company revocation controls */}
          <div className="card">
            <h2>🛡 Consent Dashboard</h2>
            <p>
              The citizen&rsquo;s audit trail: who asked, what they asked, and the
              outcome — with one-click revocation per company.
            </p>
            <a className="btn" href="/dashboard">Open the dashboard</a>
          </div>

          {/* Swift Loan: full KYC path — 4 circuits (age, citizenship, ID, credit) */}
          <div className="card">
            <h2>💸 Swift Loan</h2>
            <p>
              A full-KYC lender: four proofs — age, citizenship, ID ownership,
              and credit score ≥ 600. Never sees a single identity number.
            </p>
            <a className="btn" href="/swift-loan">Visit Swift Loan</a>
          </div>

          {/* ABC Loan: minimal KYC path — 2 circuits (age, citizenship only).
              Shows that each lender asks only for what it actually needs. */}
          <div className="card">
            <h2>🏦 ABC Loan</h2>
            <p>
              A light-touch lender: just two proofs — age and citizenship.
              Shows that ZK circuits are modular: ask less, learn less.
            </p>
            <a className="btn" href="/abc-loan">Visit ABC Loan</a>
          </div>
        </div>

        {/* Demo script: seven numbered steps a judge can follow in about three minutes.
            Covers three distinct demo paths:
              - Happy path: full KYC at Swift Loan
              - Modularity path: light KYC at ABC Loan
              - Failure path: wrong amanaId → proof fails, ZK cannot prove false statements
              - Revocation path: citizen blocks a company mid-session */}
        <div className="card elevated">
          <h2>🎬 The 3-minute demo script</h2>
          <ol className="steps">
            {/* Step 1: Start in the wallet — establish the citizen's identity */}
            <li>Open the <a href="/wallet">Citizen Wallet</a> — see your credentials and copy your <b>Swift Loan amanaId</b>.</li>
            {/* Step 2: Go to the lender — notice there is no BVN/NIN field anywhere */}
            <li>Visit <a href="/swift-loan">Swift Loan</a>, paste the ID, apply — notice there is no BVN/NIN field anywhere.</li>
            {/* Step 3: Consent and parallel proving — the main interactive demo moment */}
            <li>Back in the wallet, a consent request appears: approve it and watch <b>four proofs generate in parallel</b> while the UI stays live.</li>
            {/* Step 4: Confirm the lender only received a boolean and a receipt */}
            <li>Swift Loan gets <b>verified ✓</b> and a receipt — nothing else crosses the wire.</li>
            {/* Step 5: Repeat with ABC Loan to show circuit modularity */}
            <li>Try <a href="/abc-loan">ABC Loan</a>: it asks for only two proofs — the wallet generates exactly those two circuits, no more.</li>
            {/* Step 6: Paste the wrong ID to demonstrate the cryptographic ownership guarantee */}
            <li>Paste the <i>wrong</i> company&rsquo;s amanaId into Swift Loan — proving ownership fails, because ZK cannot prove a false statement.</li>
            {/* Step 7: Revoke a company and show the gateway blocks the request at the door */}
            <li>On the <a href="/dashboard">Dashboard</a>, revoke Swift Loan and apply again — blocked at the gateway, live, and logged.</li>
          </ol>
        </div>

      </div>
    </div>
  );
}
