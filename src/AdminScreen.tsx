import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { type User } from 'firebase/auth';
import { navigate } from './nav';
import { functions } from './firebase';
import { firebaseConfig } from './environment';
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

const FIREBASE_PROJECT = firebaseConfig.projectId;

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

interface DryRunUserEntry {
  uid: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  lastSignInAt: string;
  isAdmin: boolean;
  onboardingCompleted: boolean;
  onboardingSkipped: boolean;
  locationCount: number;
  containerCount: number;
  photoReferenceCount: number;
  collaboratorRecordCount: number;
  inviteCount: number;
  storageFileCount: number | null;
  category: 'KEEP' | 'UNKNOWN';
  wouldClear: string[];
}

interface DryRunResult {
  users: DryRunUserEntry[];
  totals: {
    total: number;
    keep: number;
    unknown: number;
    locations: number;
    containers: number;
    photoReferences: number;
    storageFiles: number | null;
    invites: number;
    collaboratorRecords: number;
  };
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

  const [dryRunRunning, setDryRunRunning] = useState(false);
  const [dryRunResult, setDryRunResult]   = useState<DryRunResult | null>(null);
  const [dryRunError, setDryRunError]     = useState('');

  async function runContentDryRun() {
    setDryRunRunning(true);
    setDryRunResult(null);
    setDryRunError('');
    try {
      const fn = httpsCallable<void, DryRunResult>(functions, 'dryRunContentReset', { timeout: 290000 });
      const result = await fn();
      setDryRunResult(result.data);
    } catch (err: any) {
      setDryRunError(err.message ?? 'Dry-run call failed.');
    } finally {
      setDryRunRunning(false);
    }
  }

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

        {/* Content Reset — Dry-Run Report */}
        <section id="content-reset-dryrun" style={{ marginBottom: 40, padding: '20px 24px', border: '2px solid #b0c4de', borderRadius: 10, background: '#f4f8fc' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#1a3a5c', marginBottom: 4 }}>
            Content Reset — Dry-Run Report
          </p>
          <p style={{ fontSize: 13, color: '#4a6080', marginBottom: 4 }}>
            Read-only report. No data will be changed. Shows what a content reset would affect per account.
          </p>
          <p style={{ fontSize: 12, color: '#c0392b', fontWeight: 600, marginBottom: 16 }}>
            ⚠ Deletion is NOT implemented. This is planning only.
          </p>

          <button
            disabled={dryRunRunning}
            onClick={runContentDryRun}
            style={{
              padding: '9px 22px', borderRadius: 8, border: '1px solid #4a6080',
              background: dryRunRunning ? '#ccc' : '#1a3a5c',
              color: '#fff', fontSize: 13,
              cursor: dryRunRunning ? 'not-allowed' : 'pointer',
              marginBottom: 16,
            }}
          >
            {dryRunRunning ? 'Running dry-run (may take ~30s)…' : 'Run dry-run report'}
          </button>

          {dryRunError && (
            <p style={{ fontSize: 13, color: '#c0392b', marginBottom: 12 }}>Error: {dryRunError}</p>
          )}

          {dryRunResult && (() => {
            const { users: dryUsers, totals } = dryRunResult;
            const keepUsers    = dryUsers.filter(u => u.category === 'KEEP');
            const unknownUsers = dryUsers.filter(u => u.category === 'UNKNOWN');

            return (
              <>
                {/* Totals */}
                <div style={{ marginBottom: 20, padding: '14px 18px', background: '#fff', borderRadius: 8, border: '1px solid #ccd8e8' }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#4a6080', marginBottom: 8 }}>TOTALS ACROSS ALL ACCOUNTS</p>
                  <table style={{ fontSize: 13, borderCollapse: 'collapse' }}>
                    <tbody>
                      {([
                        ['Auth users', totals.total],
                        ['  KEEP (admin/protected)', totals.keep],
                        ['  UNKNOWN (pending decision)', totals.unknown],
                        ['Locations', totals.locations],
                        ['Containers (incl. soft-deleted)', totals.containers],
                        ['Photo references (Firestore)', totals.photoReferences],
                        ['Storage files', totals.storageFiles === null ? 'unavailable' : totals.storageFiles],
                        ['Active collaborator records', totals.collaboratorRecords],
                        ['Invites', totals.invites],
                      ] as [string, string | number][]).map(([label, val]) => (
                        <tr key={label}>
                          <td style={{ padding: '2px 20px 2px 0', color: '#4a6080', whiteSpace: 'nowrap' }}>{label}</td>
                          <td style={{ padding: '2px 0', fontWeight: label.startsWith('  ') ? 400 : 600 }}>{val}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* KEEP accounts */}
                {keepUsers.length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: '#217a3c', marginBottom: 8 }}>
                      ✓ KEEP — {keepUsers.length} protected account{keepUsers.length !== 1 ? 's' : ''} (admin / master UID)
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {keepUsers.map(u => (
                        <div key={u.uid} style={{ padding: '10px 14px', background: '#edfaf2', border: '1px solid #a8d5b5', borderRadius: 8, fontSize: 13 }}>
                          <span style={{ fontWeight: 600 }}>{u.email ?? '(no email)'}</span>
                          <span style={{ marginLeft: 10, fontFamily: 'monospace', fontSize: 11, color: '#555' }}>{u.uid}</span>
                          {u.isAdmin && <span style={{ marginLeft: 8, background: '#217a3c', color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 11 }}>admin</span>}
                          <span style={{ marginLeft: 12, color: '#555' }}>
                            {u.locationCount} loc · {u.containerCount} containers · {u.photoReferenceCount} photo refs
                            {u.storageFileCount !== null ? ` · ${u.storageFileCount} storage files` : ''}
                          </span>
                          <div style={{ marginTop: 4, fontSize: 12, color: '#555' }}>
                            onboarding: completed={String(u.onboardingCompleted)} skipped={String(u.onboardingSkipped)}
                          </div>
                          <div style={{ marginTop: 2, fontSize: 12, color: '#888', fontStyle: 'italic' }}>
                            Protected — excluded from any reset
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* UNKNOWN accounts */}
                {unknownUsers.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: '#8a6000', marginBottom: 8 }}>
                      ? UNKNOWN — {unknownUsers.length} account{unknownUsers.length !== 1 ? 's' : ''} pending your decision
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {unknownUsers.map(u => (
                        <div key={u.uid} style={{ padding: '10px 14px', background: '#fffbee', border: '1px solid #d4b84a', borderRadius: 8, fontSize: 13 }}>
                          <span style={{ fontWeight: 600 }}>{u.email ?? '(no email)'}</span>
                          <span style={{ marginLeft: 10, fontFamily: 'monospace', fontSize: 11, color: '#555' }}>{u.uid}</span>
                          <span style={{ marginLeft: 12, color: '#555' }}>
                            {u.locationCount} loc · {u.containerCount} containers · {u.photoReferenceCount} photo refs
                            {u.storageFileCount !== null ? ` · ${u.storageFileCount} storage files` : ''}
                          </span>
                          <div style={{ marginTop: 4, fontSize: 12, color: '#555' }}>
                            Created {fmt(u.createdAt)} · Last sign-in {fmt(u.lastSignInAt)}
                          </div>
                          <div style={{ marginTop: 2, fontSize: 12, color: '#555' }}>
                            onboarding: completed={String(u.onboardingCompleted)} skipped={String(u.onboardingSkipped)}
                            {u.collaboratorRecordCount > 0 && ` · ${u.collaboratorRecordCount} collab records`}
                            {u.inviteCount > 0 && ` · ${u.inviteCount} invites`}
                          </div>
                          {u.wouldClear.length > 0 && (
                            <div style={{ marginTop: 4, fontSize: 12, color: '#8a6000' }}>
                              Would clear: {u.wouldClear.join(' · ')}
                            </div>
                          )}
                          {u.wouldClear.length === 0 && (
                            <div style={{ marginTop: 4, fontSize: 12, color: '#888', fontStyle: 'italic' }}>
                              No content — nothing to clear
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <p style={{ fontSize: 12, color: '#4a6080', marginTop: 12, fontStyle: 'italic' }}>
                  Deletion requires separate explicit approval. Provide approval wording before any deletion code is written.
                </p>
              </>
            );
          })()}
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
