import { useState, useEffect } from 'react';
import { type User } from 'firebase/auth';
import {
  collection, doc, onSnapshot, deleteDoc, updateDoc, setDoc,
  query, where, orderBy, getDocs, Timestamp, serverTimestamp,
} from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { db } from './firebase';
import { navigate } from './nav';
import logoMark from './assets/logo-mark.svg';
import './CollaboratorDashboard.css';

interface Collaborator {
  uid: string;
  displayName: string;
  email: string;
  inviteToken: string;
  acceptedAt: Timestamp | null;
  expiresAt: Date | null;
}

interface Props { user: User; }

export default function CollaboratorDashboard({ user }: Props) {
  const { t } = useTranslation();
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [search, setSearch]               = useState('');
  const [revoking, setRevoking]           = useState<string | null>(null);
  const [inviteLink, setInviteLink]           = useState<string | null>(null);
  const [inviteCopied, setInviteCopied]       = useState(false);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [inviteExpiry, setInviteExpiry]       = useState<number | null>(7);
  const [recentActivity, setRecentActivity] = useState<{ collaboratorUid: string; containerName: string; modifiedAt: Date }[]>([]);

  useEffect(() => {
    return onSnapshot(collection(db, `users/${user.uid}/collaborators`), async snap => {
      const active = snap.docs.filter(d => d.data().status === 'active');
      const result: Collaborator[] = await Promise.all(active.map(async d => {
        const data = d.data();
        let expiresAt: Date | null = null;
        if (data.inviteToken) {
          try {
            const inviteSnap = await getDocs(
              query(collection(db, 'invites'), where('__name__', '==', data.inviteToken))
            );
            if (!inviteSnap.empty) {
              const inviteData = inviteSnap.docs[0].data();
              expiresAt = inviteData.expiresAt ? inviteData.expiresAt.toDate?.() ?? null : null;
            }
          } catch {}
        }
        return {
          uid: d.id,
          displayName: data.displayName ?? data.email ?? 'Collaborator',
          email: data.email ?? '',
          inviteToken: data.inviteToken ?? '',
          acceptedAt: data.acceptedAt ?? null,
          expiresAt,
        };
      }));
      setCollaborators(result);
    });
  }, [user.uid]);

  useEffect(() => {
    const q = query(
      collection(db, `users/${user.uid}/containers`),
      where('lastModifiedBy', '!=', user.uid),
      orderBy('lastModifiedBy'),
      orderBy('lastModifiedAt', 'desc'),
    );
    return onSnapshot(q, snap => {
      const activity = snap.docs
        .filter(d => d.data().lastModifiedAt && d.data().lastModifiedBy)
        .map(d => ({
          collaboratorUid: d.data().lastModifiedBy,
          containerName: d.data().name ?? 'Unnamed container',
          modifiedAt: d.data().lastModifiedAt?.toDate?.() ?? new Date(),
        }));
      setRecentActivity(activity);
    });
  }, [user.uid]);

  async function generateInviteLink() {
    setGeneratingInvite(true);
    try {
      const token = crypto.randomUUID();
      const expiresAt = inviteExpiry
        ? new Date(Date.now() + inviteExpiry * 24 * 60 * 60 * 1000)
        : null;
      await setDoc(doc(db, 'invites', token), {
        ownerUid: user.uid,
        ownerDisplayName: user.displayName ?? user.email?.split('@')[0] ?? 'Your host',
        status: 'pending',
        token,
        createdAt: serverTimestamp(),
        ...(expiresAt && { expiresAt }),
      });
      setInviteLink(`${window.location.origin}/invite/${token}`);
    } catch (e) {
      console.error('Failed to generate invite link', e);
    } finally {
      setGeneratingInvite(false);
    }
  }

  async function revokeCollaborator(c: Collaborator) {
    if (!window.confirm(t('collabDash.revokeConfirm', { name: c.displayName }))) return;
    setRevoking(c.uid);
    try {
      await deleteDoc(doc(db, `users/${user.uid}/collaborators/${c.uid}`));
      if (c.inviteToken) {
        await updateDoc(doc(db, 'invites', c.inviteToken), { status: 'revoked' });
      }
    } catch (e) {
      console.error('Failed to revoke', e);
    } finally {
      setRevoking(null);
    }
  }

  function formatDate(ts: Timestamp | null): string {
    if (!ts) return '—';
    return ts.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatExpiry(d: Date | null): string {
    if (!d) return t('collabDash.noExpiry');
    const now = new Date();
    if (d < now) return t('collabDash.expired');
    const days = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return days === 1 ? t('collabDash.expiresTomorrow') : t('collabDash.expiresInDays', { count: days });
  }

  const filtered = collaborators.filter(c =>
    c.displayName.toLowerCase().includes(search.toLowerCase()) ||
    c.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="collab-screen">
      <header className="app-header">
        <div className="header-brand">
          <img src={logoMark} alt="Vowvy" className="header-logo-mark" />
          <span className="app-wordmark">Vowvy</span>
        </div>
        <div className="header-actions">
          <button className="sign-out-btn" onClick={() => navigate('/')}>{t('shared.back')}</button>
        </div>
      </header>

      <div className="collab-content">
        <h2 className="collab-title">{t('collabDash.title')}</h2>
        <p className="collab-subtitle">{t('collabDash.subtitle')}</p>

        <div className="collab-privacy-note">
          <span className="collab-privacy-note-icon">🔒</span>
          <div>
            <p className="collab-privacy-note-heading">{t('collabDash.privacyHeading')}</p>
            <p className="collab-privacy-note-body">{t('collabDash.privacyBody')}</p>
            <p className="collab-privacy-tip">{t('collabDash.privacyTip')}</p>
          </div>
        </div>

        <div className="collab-invite-box">
          <p style={{ margin: '0 0 12px', fontSize: 14, color: '#555' }}>
            {t('collabDash.inviteDesc')}
          </p>
          {inviteLink ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                readOnly
                value={inviteLink}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8,
                  border: '1px solid #ddd', fontSize: 13, color: '#333',
                  background: '#faf8f6', boxSizing: 'border-box',
                }}
                onFocus={e => e.target.select()}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => { navigator.clipboard.writeText(inviteLink); setInviteCopied(true); }}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 8, border: 'none',
                    background: '#7a3b2e', color: '#fff', fontSize: 14, cursor: 'pointer',
                  }}
                >
                  {inviteCopied ? t('main.invite.copied') : t('main.invite.copyLink')}
                </button>
                <button
                  onClick={() => { setInviteLink(null); setInviteCopied(false); }}
                  style={{
                    padding: '10px 16px', borderRadius: 8, border: '1px solid #ddd',
                    background: '#fff', fontSize: 14, cursor: 'pointer', color: '#555',
                  }}
                >
                  {t('main.invite.newLink')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                <label style={{ fontSize: 13, color: '#555' }}>{t('main.invite.expiryLabel')}</label>
                <select
                  value={inviteExpiry ?? 'never'}
                  onChange={e => setInviteExpiry(e.target.value === 'never' ? null : Number(e.target.value))}
                  style={{
                    padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd',
                    background: '#faf8f6', fontSize: 14, color: '#333',
                  }}
                >
                  <option value={1}>{t('main.invite.expiry24h')}</option>
                  <option value={7}>{t('main.invite.expiry7d')}</option>
                  <option value={30}>{t('main.invite.expiry30d')}</option>
                  <option value="never">{t('main.invite.expiryNever')}</option>
                </select>
              </div>
              <button
                onClick={generateInviteLink}
                disabled={generatingInvite}
                style={{
                  width: '100%', padding: '12px 0', borderRadius: 8, border: 'none',
                  background: generatingInvite ? '#ccc' : '#7a3b2e',
                  color: '#fff', fontSize: 14, cursor: generatingInvite ? 'not-allowed' : 'pointer',
                }}
              >
                {generatingInvite ? t('main.invite.generating') : t('main.invite.generate')}
              </button>
            </>
          )}
        </div>

        {collaborators.length > 0 && (
          <input
            type="text"
            className="collab-search"
            placeholder={t('collabDash.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        )}

        {collaborators.length === 0 ? (
          <p className="collab-empty">{t('collabDash.noCollaborators')}</p>
        ) : filtered.length === 0 ? (
          <p className="collab-empty">{t('collabDash.noResults', { search })}</p>
        ) : (
          <div className="collab-list">
            {filtered.map(c => (
              <div key={c.uid} className="collab-row">
                <div className="collab-avatar">
                  {c.displayName.charAt(0).toUpperCase()}
                </div>
                <div className="collab-info">
                  <div className="collab-name">{c.displayName}</div>
                  <div className="collab-email">{c.email}</div>
                  <div className="collab-meta">
                    {t('collabDash.joined', { date: formatDate(c.acceptedAt) })} · {formatExpiry(c.expiresAt)}
                    {(() => {
                      const latest = recentActivity.find(a => a.collaboratorUid === c.uid);
                      if (!latest) return null;
                      const mins = Math.floor((Date.now() - latest.modifiedAt.getTime()) / 60000);
                      const timeAgo = mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins/60)}h ago` : `${Math.floor(mins/1440)}d ago`;
                      return <span style={{ color: '#7a3b2e', marginLeft: 8 }}>{t('collabDash.addedTo', { container: latest.containerName, time: timeAgo })}</span>;
                    })()}
                  </div>
                </div>
                <button
                  className="collab-revoke"
                  disabled={revoking === c.uid}
                  onClick={() => revokeCollaborator(c)}
                >
                  {revoking === c.uid ? t('collabDash.revoking') : t('main.invite.revoke')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
