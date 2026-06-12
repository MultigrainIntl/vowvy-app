import { useState, useEffect } from 'react';
import { type User } from 'firebase/auth';
import { doc, getDoc, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { navigate } from './nav';
import logoMark from './assets/logo-mark.svg';
import './AcceptInviteScreen.css';

interface InviteData {
  ownerUid: string;
  ownerDisplayName: string;
  status: 'pending' | 'active' | 'revoked';
  expiresAt?: Date | { toDate: () => Date } | null;
}

interface Props {
  user: User;
  token: string;
}

export default function AcceptInviteScreen({ user, token }: Props) {
  const [invite, setInvite]   = useState<InviteData | null>(null);
  const [state, setState]     = useState<'loading' | 'ready' | 'accepting' | 'done' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    getDoc(doc(db, 'invites', token)).then(snap => {
      if (!snap.exists()) {
        setErrorMsg('This invite link is invalid or has expired.');
        setState('error');
        return;
      }
      const data = snap.data() as InviteData;
      if (data.status === 'revoked') {
        setErrorMsg('This invite has been revoked by the owner.');
        setState('error');
        return;
      }
      if (data.status === 'active') {
        // Already accepted — if it was accepted by this user, just go home
        setErrorMsg('This invite has already been accepted.');
        setState('error');
        return;
      }
      if (data.ownerUid === user.uid) {
        setErrorMsg("You can't accept your own invite.");
        setState('error');
        return;
      }
      if (data.expiresAt) {
        const expiry = data.expiresAt instanceof Date
          ? data.expiresAt
          : (data.expiresAt as { toDate: () => Date }).toDate();
        if (expiry < new Date()) {
          setErrorMsg('This invite link has expired.');
          setState('error');
          return;
        }
      }
      setInvite(data);
      setState('ready');
    }).catch(() => {
      setErrorMsg('Failed to load invite. Please try again.');
      setState('error');
    });
  }, [token, user.uid]);

  async function handleAccept() {
    if (!invite) return;
    setState('accepting');
    try {
      // Create collaborator doc under owner's subcollection (keyed by collaborator UID)
      await setDoc(doc(db, `users/${invite.ownerUid}/collaborators/${user.uid}`), {
        displayName: user.displayName ?? user.email?.split('@')[0] ?? 'Collaborator',
        email: user.email ?? '',
        status: 'active',
        inviteToken: token,
        acceptedAt: serverTimestamp(),
      });
      // Mark invite as used — single-use
      await updateDoc(doc(db, 'invites', token), {
        status: 'active',
        acceptedByUid: user.uid,
        acceptedByEmail: user.email ?? '',
        acceptedAt: serverTimestamp(),
      });
      setState('done');
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Failed to accept invite. Please try again.');
      setState('error');
    }
  }

  return (
    <div className="accept-screen">
      <header className="accept-header">
        <img src={logoMark} alt="Vowvy" className="accept-logo" />
        <span className="accept-wordmark">Vowvy</span>
      </header>

      <main className="accept-main">
        {state === 'loading' && (
          <p className="accept-status">Loading invite…</p>
        )}

        {state === 'ready' && invite && (
          <div className="accept-card">
            <div className="accept-icon">📦</div>
            <h1 className="accept-title">You've been invited</h1>
            <p className="accept-body">
              <strong>{invite.ownerDisplayName}</strong> has invited you to collaborate
              on their Vowvy inventory. You'll be able to view and add containers and photos.
            </p>
            <p className="accept-signed-in-as">Signing in as {user.email}</p>
            <button className="accept-btn" onClick={handleAccept}>
              Accept Invite
            </button>
          </div>
        )}

        {state === 'accepting' && (
          <p className="accept-status">Accepting…</p>
        )}

        {state === 'done' && (
          <div className="accept-card">
            <div className="accept-icon">✓</div>
            <h1 className="accept-title">You're in!</h1>
            <p className="accept-body">
              You now have access to {invite?.ownerDisplayName}'s inventory.
            </p>
            <button className="accept-btn" onClick={() => navigate(`/?owner=${invite?.ownerUid}`)}>
              Go to inventory
            </button>
          </div>
        )}

        {state === 'error' && (
          <div className="accept-card">
            <div className="accept-icon">✕</div>
            <h1 className="accept-title">Can't accept this invite</h1>
            <p className="accept-body">{errorMsg}</p>
            <button className="accept-btn" onClick={() => navigate('/')}>
              Go home
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
