// Root layout: thin demo-switcher bar; each page owns its full layout so the
// lender sites can render their own branding (in production these would be
// separate origins entirely).
import './globals.css';
import DemoBar from './components/DemoBar';

export const metadata = {
  title: 'Amana Gateway — prove facts, not data',
  description: 'Zero-knowledge identity verification — prove facts, not data.',
  manifest: '/manifest.json',
};

export const viewport = { themeColor: '#070d0a' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Fonts load progressively; system-ui fallback keeps offline demos working */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <DemoBar />
        {children}
        {/* Register PWA service worker */}
        <script dangerouslySetInnerHTML={{ __html: `if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});` }} />
      </body>
    </html>
  );
}
