// Landing page: what the system is, who the actors are, and the exact demo script.
export default function Home() {
  return (
    <div className="amana-bg">
      <div className="main-wide">
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
          <div className="stats">
            <div className="stat"><b>4</b><span>ZK circuits (Groth16)</span></div>
            <div className="stat"><b>0</b><span>identity numbers shared</span></div>
            <div className="stat"><b>~280</b><span>constraints per proof</span></div>
            <div className="stat"><b>100%</b><span>proved on-device</span></div>
          </div>
        </div>

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
          <p className="muted">
            Every proof is bound to a signed government credential, the requesting company,
            and a single-use nonce — replays and forgeries are cryptographically impossible.
          </p>
        </div>

        <div className="grid-2">
          <div className="card">
            <h2>📱 Citizen Wallet</h2>
            <p>
              Holds two signed credentials (identity + credit), derives a different
              opaque <b>amanaId</b> per company, and generates all proofs locally
              in parallel Web Workers.
            </p>
            <a className="btn" href="/wallet">Open the wallet</a>
          </div>
          <div className="card">
            <h2>🛡 Consent Dashboard</h2>
            <p>
              The citizen&rsquo;s audit trail: who asked, what they asked, and the
              outcome — with one-click revocation per company.
            </p>
            <a className="btn" href="/dashboard">Open the dashboard</a>
          </div>
          <div className="card">
            <h2>💸 Swift Loan</h2>
            <p>
              A full-KYC lender: four proofs — age, citizenship, ID ownership,
              and credit score ≥ 600. Never sees a single identity number.
            </p>
            <a className="btn" href="/swift-loan">Visit Swift Loan</a>
          </div>
          <div className="card">
            <h2>🏦 ABC Loan</h2>
            <p>
              A light-touch lender: just two proofs — age and citizenship.
              Shows that ZK circuits are modular: ask less, learn less.
            </p>
            <a className="btn" href="/abc-loan">Visit ABC Loan</a>
          </div>
        </div>

        <div className="card elevated">
          <h2>🎬 The 3-minute demo script</h2>
          <ol className="steps">
            <li>Open the <a href="/wallet">Citizen Wallet</a> — see your credentials and copy your <b>Swift Loan amanaId</b>.</li>
            <li>Visit <a href="/swift-loan">Swift Loan</a>, paste the ID, apply — notice there is no BVN/NIN field anywhere.</li>
            <li>Back in the wallet, a consent request appears: approve it and watch <b>four proofs generate in parallel</b> while the UI stays live.</li>
            <li>Swift Loan gets <b>verified ✓</b> and a receipt — nothing else crosses the wire.</li>
            <li>Try <a href="/abc-loan">ABC Loan</a>: it asks for only two proofs — the wallet generates exactly those two circuits, no more.</li>
            <li>Paste the <i>wrong</i> company&rsquo;s amanaId into Swift Loan — proving ownership fails, because ZK cannot prove a false statement.</li>
            <li>On the <a href="/dashboard">Dashboard</a>, revoke Swift Loan and apply again — blocked at the gateway, live, and logged.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
