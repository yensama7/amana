'use client';
// DemoBar — the thin switcher between the demo's actors. In a real deployment
// each of these would be a separate origin (wallet app, two lender websites,
// dashboard); one bar makes that explicit for judges while staying navigable.
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Overview' },
  { href: '/wallet', label: '📱 Citizen Wallet' },
  { href: '/dashboard', label: '🛡 Consent Dashboard' },
  { href: '/swift-loan', label: '💸 Swift Loan' },
  { href: '/abc-loan', label: '🏦 ABC Loan' },
];

export default function DemoBar() {
  const path = usePathname();
  return (
    <nav className="demobar">
      <span className="brand">🔐 Amana Gateway</span>
      {LINKS.map((l) => (
        <a key={l.href} href={l.href} className={path === l.href ? 'active' : ''}>
          {l.label}
        </a>
      ))}
      <span className="pill">LIVE DEMO</span>
    </nav>
  );
}
