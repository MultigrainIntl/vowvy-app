import { useState } from 'react';
import { updateProfile, sendPasswordResetEmail, type User } from 'firebase/auth';
import { auth } from './firebase';
import { navigate } from './nav';
import logoMark from './assets/logo-mark.svg';

interface Props { user: User; }

export default function ProfileScreen({ user }: Props) {
  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [resetMsg, setResetMsg] = useState('');

  async function handleSaveName() {
    if (!displayName.trim()) return;
    setSaving(true);
    setSaveMsg('');
    try {
      await updateProfile(user, { displayName: displayName.trim() });
      setSaveMsg('Name updated.');
    } catch {
      setSaveMsg('Could not save — please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordReset() {
    if (!user.email) return;
    setResetMsg('');
    try {
      await sendPasswordResetEmail(auth, user.email);
      setResetMsg('Reset email sent — check your inbox.');
    } catch {
      setResetMsg('Could not send reset email — please try again.');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <header className="app-header">
        <div className="header-brand">
          <img src={logoMark} alt="Vowvy" className="header-logo-mark" />
          <span className="app-wordmark">Vowvy</span>
        </div>
        <div className="header-actions">
          <button className="sign-out-btn" onClick={() => navigate('/')}>← Back</button>
        </div>
      </header>

      <main style={{ flex: 1, padding: '32px 24px', maxWidth: 480, width: '100%', margin: '0 auto' }}>
        <h1 style={{ fontSize: 32, marginBottom: 24 }}>Profile</h1>

        <section style={{ marginBottom: 32 }}>
          <p style={{ fontSize: 13, color: 'var(--muted-slate)', marginBottom: 4 }}>Email</p>
          <p style={{ fontSize: 15 }}>{user.email}</p>
        </section>

        <section style={{ marginBottom: 32 }}>
          <label style={{ display: 'block', fontSize: 13, color: 'var(--muted-slate)', marginBottom: 6 }}>
            Display name
          </label>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              disabled={saving}
              style={{
                flex: 1, fontFamily: 'var(--font-body)', fontSize: 15,
                padding: '10px 12px', border: '1px solid var(--warm-gray)',
                borderRadius: 6, background: 'white', color: 'var(--charcoal)',
                outline: 'none',
              }}
            />
            <button
              onClick={handleSaveName}
              disabled={saving || !displayName.trim()}
              style={{
                fontFamily: 'var(--font-body)', fontSize: 14, padding: '10px 18px',
                border: 'none', borderRadius: 6, cursor: 'pointer',
                background: 'var(--terracotta)', color: 'white',
                opacity: saving || !displayName.trim() ? 0.45 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {saveMsg && (
            <p style={{ fontSize: 13, color: 'var(--muted-slate)', marginTop: 8 }}>{saveMsg}</p>
          )}
        </section>

        <section>
          <p style={{ fontSize: 13, color: 'var(--muted-slate)', marginBottom: 10 }}>Password</p>
          <button
            onClick={handlePasswordReset}
            style={{
              fontFamily: 'var(--font-body)', fontSize: 14,
              padding: '10px 18px', borderRadius: 6, cursor: 'pointer',
              background: 'white', color: 'var(--charcoal)',
              border: '1px solid var(--warm-gray)',
            }}
          >
            Send password reset email
          </button>
          {resetMsg && (
            <p style={{ fontSize: 13, color: 'var(--muted-slate)', marginTop: 8 }}>{resetMsg}</p>
          )}
        </section>
      </main>
    </div>
  );
}
