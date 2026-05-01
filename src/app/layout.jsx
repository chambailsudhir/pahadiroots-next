import './globals.css';

export const metadata = {
  title: '5 Pahadi Roots — Admin',
  description: 'Admin Panel',
  robots: 'noindex, nofollow',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
        {/* Restore theme BEFORE paint to avoid flash */}
        <script dangerouslySetInnerHTML={{__html: `
          try {
            var t = JSON.parse(localStorage.getItem('pr_theme') || 'null');
            if (t) {
              var r = document.documentElement;
              r.style.setProperty('--accent', t.accent);
              r.style.setProperty('--bg',  t.bg);
              r.style.setProperty('--bg2', t.bg2);
              r.style.setProperty('--bd',  t.bd);
              r.style.setProperty('--tx',  t.tx);
              r.style.setProperty('--tx2', t.tx2 || '#6e7681');
              document.documentElement.style.cssText += ';background:'+t.bg+';color:'+t.tx;
            }
          } catch(e) {}
        `}} />
      </head>
      <body className="antialiased" style={{background:'var(--bg,#0d1117)',color:'var(--tx,#e6edf3)'}}>
        {children}
      </body>
    </html>
  );
}
