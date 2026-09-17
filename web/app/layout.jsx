// Root layout: thin demo-switcher bar; each page owns its full layout so the
// lender sites can render their own branding (in production these would be
// separate origins entirely).
import './globals.css';
import DemoBar from './components/DemoBar';

// Next.js metadata object: sets <title> and <meta name="description">.
// The manifest key links the PWA manifest so browsers show the install prompt.
export const metadata = {
  title: 'Amana Gateway — prove facts, not data',
  description: 'Zero-knowledge identity verification — prove facts, not data.',
  manifest: '/manifest.json',
};

// Theme colour for the PWA title bar on mobile Chrome and Safari.
// Matches the dark background of the Amana colour scheme so the bar blends in.
export const viewport = { themeColor: '#070d0a' };

// RootLayout wraps every page. DemoBar is the only shared chrome — it shows
// all five demo actors (overview, wallet, dashboard, two lenders) as a nav strip
// so a judge can jump between them without opening separate tabs.
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Preconnect to Google Fonts before the stylesheet is parsed.
            Two separate preconnects are required: one for the CSS delivery CDN
            (fonts.googleapis.com) and one for the font binary host (fonts.gstatic.com).
            crossOrigin="anonymous" is required for gstatic per the Google Fonts spec.
            The system-ui fallback in globals.css keeps offline demos working
            while these fonts load progressively. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Inter: UI body text. JetBrains Mono: amanaIds, commitments, receipt IDs.
            display=swap shows the fallback font immediately while the web fonts load. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* DemoBar is rendered above every page — it is the only navigation
            element shared between the citizen-facing and lender-facing views. */}
        <DemoBar />

        {/* children is the active page component (wallet, dashboard, swift-loan, etc.) */}
        {children}

        {/* Register the PWA service worker using an inline script instead of a
            separate JS file. This avoids an extra network round-trip on first load.
            The .catch() silently swallows environments where registration fails
            (e.g. insecure contexts, browsers with service workers disabled)
            so those don't surface as unhandled promise rejections. */}
        <script dangerouslySetInnerHTML={{ __html: `if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});` }} />
      </body>
    </html>
  );
}
