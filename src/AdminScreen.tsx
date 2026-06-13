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

interface BackfillResult {
  scanned: number;
  missing: number;
  patched: number;
  remainingMissing: number;
  dryRun: boolean;
}

export default function AdminScreen({ user }: Props) {
  const [users, setUsers]     = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillResult, setBackfillResult]   = useState<BackfillResult | null>(null);
  const [backfillError, setBackfillError]     = useState('');

  const [locRunning, setLocRunning] = useState(false);
  const [locResult, setLocResult]   = useState<BackfillResult | null>(null);
  const [locError, setLocError]     = useState('');

  const [conRunning, setConRunning] = useState(false);
  const [conResult, setConResult]   = useState<BackfillResult | null>(null);
  const [conError, setConError]     = useState('');

  async function runBackfill(dryRun: boolean) {
    if (!dryRun) {
      const ok = window.confirm(
        'This will add isPrivate: false to old containers missing the field. Continue?'
      );
      if (!ok) return;
    }
    setBackfillRunning(true);
    setBackfillResult(null);
    setBackfillError('');
    try {
      const fn = httpsCallable<{ dryRun: boolean }, BackfillResult>(functions, 'backfillIsPrivateOnce');
      const result = await fn({ dryRun });
      setBackfillResult(result.data);
    } catch (err: any) {
      setBackfillError(err.message ?? 'Backfill call failed.');
    } finally {
      setBackfillRunning(false);
    }
  }

  async function runLocBackfill(dryRun: boolean) {
    if (!dryRun) {
      const ok = window.confirm('This will add visibility: "inherit" and effectiveIsPrivate: false to locations missing these fields. Continue?');
      if (!ok) return;
    }
    setLocRunning(true); setLocResult(null); setLocError('');
    try {
      const fn = httpsCallable<{ dryRun: boolean }, BackfillResult>(functions, 'backfillLocationsVisibility');
      const result = await fn({ dryRun });
      setLocResult(result.data);
    } catch (err: any) {
      setLocError(err.message ?? 'Backfill call failed.');
    } finally {
      setLocRunning(false);
    }
  }

  async function runConBackfill(dryRun: boolean) {
    if (!dryRun) {
      const ok = window.confirm('This will add visibility + effectiveIsPrivate to containers missing these fields (derived from isPrivate). Continue?');
      if (!ok) return;
    }
    setConRunning(true); setConResult(null); setConError('');
    try {
      const fn = httpsCallable<{ dryRun: boolean }, BackfillResult>(functions, 'backfillContainersVisibility');
      const result = await fn({ dryRun });
      setConResult(result.data);
    } catch (err: any) {
      setConError(err.message ?? 'Backfill call failed.');
    } finally {
      setConRunning(false);
    }
  }

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

        {/* TEMPORARY — Privacy backfill. Remove after backfill confirmed complete. */}
        <section style={{ marginBottom: 40, padding: '20px 24px', border: '1px solid #e0b0a0', borderRadius: 10, background: '#fffaf8' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--terracotta)', marginBottom: 4 }}>
            Privacy Backfill (temporary)
          </p>
          <p style={{ fontSize: 13, color: 'var(--muted-slate)', marginBottom: 16 }}>
            Patches containers missing <code>isPrivate</code> → sets them to <code>false</code>. Run dry-run first, review, then write.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <button
              disabled={backfillRunning}
              onClick={() => runBackfill(true)}
              style={{
                padding: '8px 18px', borderRadius: 8, border: '1px solid var(--warm-gray)',
                background: '#fff', fontSize: 13, cursor: backfillRunning ? 'not-allowed' : 'pointer',
                color: 'var(--charcoal)',
              }}
            >
              {backfillRunning ? 'Running…' : 'Dry-run backfill'}
            </button>
            <button
              disabled={backfillRunning}
              onClick={() => runBackfill(false)}
              style={{
                padding: '8px 18px', borderRadius: 8, border: '1px solid #c8a090',
                background: 'var(--terracotta)', fontSize: 13, cursor: backfillRunning ? 'not-allowed' : 'pointer',
                color: '#fff',
              }}
            >
              {backfillRunning ? 'Running…' : 'Run write backfill'}
            </button>
          </div>
          {backfillError && (
            <p style={{ fontSize: 13, color: 'var(--terracotta)' }}>Error: {backfillError}</p>
          )}
          {backfillResult && (
            <table style={{ fontSize: 13, borderCollapse: 'collapse', fontFamily: 'var(--font-body)' }}>
              <tbody>
                <tr><td style={{ padding: '3px 16px 3px 0', color: 'var(--muted-slate)' }}>Mode</td><td>{backfillResult.dryRun ? 'Dry run (no writes)' : 'Write'}</td></tr>
                <tr><td style={{ padding: '3px 16px 3px 0', color: 'var(--muted-slate)' }}>Scanned</td><td>{backfillResult.scanned}</td></tr>
                <tr><td style={{ padding: '3px 16px 3px 0', color: 'var(--muted-slate)' }}>Missing isPrivate</td><td>{backfillResult.missing}</td></tr>
                <tr><td style={{ padding: '3px 16px 3px 0', color: 'var(--muted-slate)' }}>Patched</td><td>{backfillResult.patched}</td></tr>
                {!backfillResult.dryRun && <tr><td style={{ padding: '3px 16px 3px 0', color: 'var(--muted-slate)' }}>Remaining missing</td><td>{backfillResult.remainingMissing}</td></tr>}
              </tbody>
            </table>
          )}
        </section>

        {/* TEMPORARY — Location visibility backfill. Remove after backfill confirmed complete. */}
        <section style={{ marginBottom: 40, padding: '20px 24px', border: '1px solid #e0b0a0', borderRadius: 10, background: '#fffaf8' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--terracotta)', marginBottom: 4 }}>
            Location Visibility Backfill (temporary)
          </p>
          <p style={{ fontSize: 13, color: 'var(--muted-slate)', marginBottom: 16 }}>
            Adds <code>visibility: "inherit"</code> and <code>effectiveIsPrivate: false</code> to locations missing these fields.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <button disabled={locRunning} onClick={() => runLocBackfill(true)}
              style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid var(--warm-gray)', background: '#fff', fontSize: 13, cursor: locRunning ? 'not-allowed' : 'pointer', color: 'var(--charcoal)' }}>
              {locRunning ? 'Running…' : 'Dry-run locations'}
            </button>
            <button disabled={locRunning} onClick={() => runLocBackfill(false)}
              style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #c8a090', background: 'var(--terracotta)', fontSize: 13, cursor: locRunning ? 'not-allowed' : 'pointer', color: '#fff' }}>
              {locRunning ? 'Running…' : 'Write locations'}
            </button>
          </div>
          {locError && <p style={{ fontSize: 13, color: 'var(--terracotta)' }}>Error: {locError}</p>}
          {locResult && (
            <table style={{ fontSize: 13, borderCollapse: 'collapse', fontFamily: 'var(--font-body)' }}>
              <tbody>
                <tr><td style={{ padding: '3px 16px 3px 0', color: 'var(--muted-slate)' }}>Mode</td><td>{locResult.dryRun ? 'Dry run (no writes)' : 'Write'}</td></tr>
                <tr><td style={{ padding: '3px 16px 3px 0', color: 'var(--muted-slate)' }}>Scanned</td><td>{locResult.scanned}</td></tr>
                <tr><td style={{ padding: '3px 16px 3px 0', color: 'var(--muted-slate)' }}>Missing fields</td><td>{locResult.missing}</td></tr>
                <tr><td style={{ padding: '3px 16px 3px 0', color: 'var(--muted-slate)' }}>Patched</td><td>{locResult.patched}</td></tr>
                {!locResult.dryRun && <tr><td style={{ padding: '3px 16px 3px 0', color: 'var(--muted-slate)' }}>Remaining missing</td><td>{locResult.remainingMissing}</td></tr>}
              </tbody>
            </table>
          )}
        </section>

        {/* TEMPORARY — Container visibility backfill. Remove after backfill confirmed complete. */}
        <section style={{ marginBottom: 40, padding: '20px 24px', border: '1px solid #e0b0a0', borderRadius: 10, background: '#fffaf8' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--terracotta)', marginBottom: 4 }}>
            Container Visibility Backfill (temporary)
          </p>
          <p style={{ fontSize: 13, color: 'var(--muted-slate)', marginBottom: 16 }}>
            Adds <code>visibility</code> and <code>effectiveIsPrivate</code> to containers missing these fields, derived from existing <code>isPrivate</code>.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <button disabled={conRunning} onClick={() => runConBackfill(true)}
              style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid var(--warm-gray)', background: '#fff', fontSize: 13, cursor: conRunning ? 'not-allowed' : 'pointer', color: 'var(--charcoal)' }}>
              {conRunning ? 'Running…' : 'Dry-run containers'}
            </button>
            <button disabled={conRunning} onClick={() => runConBackfill(false)}
              style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #c8a090', background: 'var(--terracotta)', fontSize: 13, cursor: conRunning ? 'not-allowed' : 'pointer', color: '#fff' }}>
              {conRunning ? 'Running…' : 'Write containers'}
            </button>
          </div>
          {conError && <p style={{ fontSize: 13, color: 'var(--terracotta)' }}>Error: {conError}</p>}
          {conResult && (
            <table style={{ fontSize: 13, borderCollapse: 'collapse', fontFamily: 'var(--font-body)' }}>
              <tbody>
                <tr><td style={{ padding: '3px 16px 3px 0', color: 'var(--muted-slate)' }}>Mode</td><td>{conResult.dryRun ? 'Dry run (no writes)' : 'Write'}</td></tr>
                <tr><td style={{ padding: '3px 16px 3px 0', color: 'var(--muted-slate)' }}>Scanned</td><td>{conResult.scanned}</td></tr>
                <tr><td style={{ padding: '3px 16px 3px 0', color: 'var(--muted-slate)' }}>Missing fields</td><td>{conResult.missing}</td></tr>
                <tr><td style={{ padding: '3px 16px 3px 0', color: 'var(--muted-slate)' }}>Patched</td><td>{conResult.patched}</td></tr>
                {!conResult.dryRun && <tr><td style={{ padding: '3px 16px 3px 0', color: 'var(--muted-slate)' }}>Remaining missing</td><td>{conResult.remainingMissing}</td></tr>}
              </tbody>
            </table>
          )}
        </section>

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
