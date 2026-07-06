// Landing page: explains the demo and where each actor lives.
export default function Home() {
  return (
    <>
      <div className="card">
        <h2>Prove facts, not data.</h2>
        <p>
          Amana Gateway lets a citizen prove statements about themselves —
          &ldquo;I am over 18&rdquo;, &ldquo;I am Nigerian&rdquo;, &ldquo;this
          ID is mine&rdquo;, &ldquo;my credit score is high enough&rdquo; —
          using zero-knowledge proofs, without ever handing over the underlying
          data. No BVN or NIN is typed anywhere: companies get an
          <b> amanaId</b> instead, an opaque code that identifies you but is
          useless to a thief.
        </p>
        <p className="muted">The demo has three actors, each with its own page (nav above):</p>
        <ul className="claims">
          <li><b>SwiftLoan</b> — a mock lender that needs four facts verified before approving a loan.</li>
          <li><b>Citizen Wallet</b> — holds two signed credentials (identity + credit), shows your amanaIds, and generates proofs in a Web Worker.</li>
          <li><b>Consent Dashboard</b> — the citizen&rsquo;s audit trail, with revoke buttons per company.</li>
        </ul>
      </div>
      <div className="card">
        <h2>Try the demo flow</h2>
        <ol className="claims">
          <li>Open the <a href="/wallet">Wallet</a> and copy your <b>SwiftLoan amanaId</b>.</li>
          <li>Open <a href="/loan">SwiftLoan</a>, paste the ID, and apply — notice there is no BVN/NIN field.</li>
          <li>Back in the Wallet, a consent request appears. Approve it and watch four proofs generate (the UI stays responsive).</li>
          <li>SwiftLoan gets <b>verified: true</b> + a receipt — and nothing else.</li>
          <li>In the Wallet, click <b>Authorise SwiftLoan ↔ GTBank link</b> — consent-based ID linkage, logged on the dashboard.</li>
          <li>On the <a href="/dashboard">Dashboard</a>, revoke SwiftLoan, then apply again — blocked, live.</li>
        </ol>
      </div>
    </>
  );
}
