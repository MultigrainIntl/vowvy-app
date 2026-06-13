import { type User } from 'firebase/auth';
import { navigate } from './nav';
import logoMark from './assets/logo-mark.svg';

interface Props { user: User; }

const FIREBASE_PROJECT = 'vowvy-1ba5f';

export default function AdminScreen({ user }: Props) {
  const links = [
    { label: 'Firebase Console', href: `https://console.firebase.google.com/project/${FIREBASE_PROJECT}/overview` },
    { label: 'Firestore', href: `https://console.firebase.google.com/project/${FIREBASE_PROJECT}/firestore` },
    { label: 'Authentication', href: `https://console.firebase.google.com/project/${FIREBASE_PROJECT}/authentication` },
    { label: 'Hosting', href: `https://console.firebase.google.com/project/${FIREBASE_PROJECT}/hosting` },
    { label: 'Storage', href: `https://console.firebase.google.com/project/${FIREBASE_PROJECT}/storage` },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <header className="app-header">
        <div className="header-brand">
          <img src={logoMark} alt="Vowvy" className="header-logo-mark" />
          <span className="app-wordmark">Vowvy</span>
        </div>
        <div className="header-actions">
          <button className="sign-out-btn" onClick={() => navigate('/profile')}>← Back</button>
        </div>
      </header>

      <main style={{ flex: 1, padding: '32px 24px', maxWidth: 480, width: '100%', margin: '0 auto' }}>
        <h1 style={{ fontSize: 32, marginBottom: 8 }}>Admin</h1>
        <p style={{ fontSize: 13, color: 'var(--muted-slate)', marginBottom: 32 }}>
          Signed in as {user.email}
        </p>

        <section style={{ marginBottom: 40 }}>
          <p style={{ fontSize: 13, color: 'var(--muted-slate)', marginBottom: 12 }}>Firebase Console</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {links.map(({ label, href }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontFamily: 'var(--font-body)', fontSize: 14,
                  padding: '10px 18px', borderRadius: 6,
                  background: 'white', color: 'var(--charcoal)',
                  border: '1px solid var(--warm-gray)',
                  textDecoration: 'none', display: 'inline-block',
                }}
              >
                {label} ↗
              </a>
            ))}
          </div>
        </section>

        <section>
          <p style={{ fontSize: 13, color: 'var(--muted-slate)', marginBottom: 8 }}>Platform stats</p>
          <p style={{ fontSize: 14, color: 'var(--muted-slate)', fontStyle: 'italic' }}>
            Cross-user stats require backend support — coming in a future version.
          </p>
        </section>
      </main>
    </div>
  );
}
