'use client';
// DemoBar — the thin navigation bar rendered at the top of every page.
//
// In a production deployment each of these actors would be a completely separate
// web origin (e.g. wallet.amana.ng, swiftloan.com, abcloan.com). The bar
// collapses them into one app for demo purposes and makes it explicit which
// "actor" the current page represents, so a judge understands the role
// separation without needing five browser windows.
import { usePathname } from 'next/navigation';

// The five demo roles, in the order they appear in the bar.
// href doubles as the unique key and the route for active-state detection.
const LINKS = [
  { href: '/',          label: 'Overview' },          // system explanation + demo script
  { href: '/wallet',    label: '📱 Citizen Wallet' },  // amanaId derivation + proof generation
  { href: '/dashboard', label: '🛡 Consent Dashboard' }, // audit trail + revocation controls
  { href: '/swift-loan', label: '💸 Swift Loan' },     // relying party — 4 proofs (full KYC)
  { href: '/abc-loan',  label: '🏦 ABC Loan' },        // relying party — 2 proofs (minimal KYC)
];

export default function DemoBar() {
  // usePathname returns the current route (e.g. '/wallet'), which is compared
  // against each link's href to highlight the active tab. This must be a
  // client component ('use client') because usePathname is a React hook that
  // reads browser-side routing state.
  const path = usePathname();

  return (
    <nav className="demobar">
      {/* Brand name anchors the bar and makes screenshots self-explanatory */}
      <span className="brand">🔐 Amana Gateway</span>

      {/* Render one anchor per actor. The 'active' class is applied when the
          current pathname exactly matches the link's href, giving the current
          actor a visual highlight in the bar. */}
      {LINKS.map((l) => (
        <a key={l.href} href={l.href} className={path === l.href ? 'active' : ''}>
          {l.label}
        </a>
      ))}

      {/* Static pill that marks this as a live running demo, not a static mockup */}
      <span className="pill">LIVE DEMO</span>
    </nav>
  );
}
