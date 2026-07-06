// Root layout: shared nav between the three roles in the demo.
// One Next.js app hosts all three (wallet / dashboard / mock loan app) —
// in production these would be separate origins.
import './globals.css';

export const metadata = {
  title: 'Amana Gateway',
  description: 'Zero-knowledge identity verification — prove facts, not data.',
  manifest: '/manifest.json',
};

export const viewport = { themeColor: '#0e1a13' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <span className="brand">🛡 Amana Gateway</span>
          <a href="/wallet">Citizen Wallet</a>
          <a href="/dashboard">Consent Dashboard</a>
          <a href="/loan">SwiftLoan (mock RP)</a>
        </nav>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
