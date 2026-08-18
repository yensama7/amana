// Root layout: shared nav across all four views of the Amana Way demo.
// One Next.js app hosts everything — in production these would be separate origins.
import './globals.css';

export const metadata = {
  title: 'Amana Way',
  description: 'Zero-knowledge identity verification — prove facts, not data.',
  manifest: '/manifest.json',
};

export const viewport = { themeColor: '#0e1a13' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <span className="brand">🛡 Amana Way</span>
          <a href="/wallet">Amana Way</a>
          <a href="/dashboard">Consent Dashboard</a>
          <a href="/swift-loan">Swift Loan</a>
          <a href="/abc-loan">ABC Loan</a>
        </nav>
        <main className="main">{children}</main>
        {/* Register PWA service worker */}
        <script dangerouslySetInnerHTML={{ __html: `if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});` }} />
      </body>
    </html>
  );
}
