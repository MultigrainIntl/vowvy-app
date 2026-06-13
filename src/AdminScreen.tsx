import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { type User } from 'firebase/auth';
import { navigate } from './nav';
import { functions } from './firebase';
import logoMark from './assets/logo-mark.svg';

interface Props { user: User; }

interface AdminUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  lastSignInAt: string;
  containerCount: number;
  locationCount: number;
  collaborators: { uid: string; email: string; displayName: string }[];
  invitesSent: { token: string; status: string; acceptedByEmail?: string }[];
  connectedTo: string[];
}

const FIREBASE_PROJECT = 'vowvy-1ba5f';

const consoleLinks = [
  { label: 'Firebase Console', href: `https://console.firebase.google.com/project/${FIREBASE_PROJECT}/overview` },
  { label: 'Firestore',        href: `https://console.firebase.google.com/project/${FIREBASE_PROJECT}/firestore` },
  { label: 'Authentication',   href: `https://console.firebase.google.com/project/${FIREBASE_PROJECT}/authentication` },
  { label: 'Hosting',          href: `https://console.firebase.google.com/project/${FIREBASE_PROJECT}/hosting` },
  { label: 'Storage',          href: `https://console.firebase.google.com/project/${FIREBASE_PROJECT}/storage` },
];

function fmt(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function AdminScreen({ user }: Props) {
  const [users, setUsers]     = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    const fn = httpsCallable<void, { users: AdminUser[] }>(functions, 'getAdminUserData');
    fn().then(result => {
      setUsers(result.data.users);
      setLoading(false);
    }).catch(err => {
      setError(err.message ?? 'Failed to load user data.');
      setLoading(false);
    });
  }, []);

  // Build UID → email map for resolving connectedTo UIDs
  const uidToEmail = Object.fromEntries(users.map(u => [u.uid, u.email ?? u.uid]));

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

      <main style={{ flex: 1, padding: '32px 24px', maxWidth: 1100, width: '100%', margin: '0 auto' }}>
        <h1 style={{ fontSize: 32, marginBottom: 4 }}>Admin</h1>
        <p style={{ fontSize: 13, color: 'var(--muted-slate)', marginBottom: 32 }}>
          Signed in as {user.email}
        </p>

        {/* Console links */}
        <section style={{ marginBottom: 40 }}>
          <p style={{ fontSize: 13, color: 'var(--muted-slate)', marginBottom: 12 }}>Firebase Console</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {consoleLinks.map(({ label, href }) => (
              <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                style={{
                  fontFamily: 'var(--font-body)', fontSize: 13,
                  padding: '7px 14px', borderRadius: 6,
                  background: 'white', color: 'var(--charcoal)',
                  border: '1px solid var(--warm-gray)',
                  textDecoration: 'none',
                }}
              >
                {label} ↗
              </a>
            ))}
          </div>
        </section>

        {/* Users */}
        <section>
          <p style={{ fontSize: 13, color: 'var(--muted-slate)', marginBottom: 12 }}>
            {loading ? 'Loading users…' : error ? '' : `${users.length} user${users.length === 1 ? '' : 's'}`}
          </p>

          {error && (
            <p style={{ fontSize: 14, color: 'var(--terracotta)' }}>{error}</p>
          )}

          {!loading && !error && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%', borderCollapse: 'collapse',
                fontFamily: 'var(--font-body)', fontSize: 13,
              }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--warm-gray)', textAlign: 'left' }}>
                    {['Email', 'UID', 'Created', 'Last sign-in', 'Boxes', 'Locations', 'Collaborators', 'Connected to'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', color: 'var(--muted-slate)', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.sort((a, b) => (a.email ?? '').localeCompare(b.email ?? '')).map(u => (
                    <tr key={u.uid} style={{ borderBottom: '1px solid var(--warm-gray)' }}>
                      <td style={{ padding: '10px 12px' }}>{u.email ?? '—'}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--muted-slate)', fontFamily: 'monospace', fontSize: 11 }}>
                        {u.uid.slice(0, 10)}…
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{fmt(u.createdAt)}</td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{fmt(u.lastSignInAt)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>{u.containerCount}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>{u.locationCount}</td>
                      <td style={{ padding: '10px 12px' }}>
                        {u.collaborators.length === 0 ? '—' : u.collaborators.map(c => c.email || c.displayName).join(', ')}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {u.connectedTo.length === 0 ? '—' : u.connectedTo.map(uid => uidToEmail[uid] ?? uid).join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
