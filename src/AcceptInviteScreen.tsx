import { useState, useEffect } from 'react';
import { type User } from 'firebase/auth';
import { useTranslation } from 'react-i18next';
import { db } from './firebase';
import { navigate } from './nav';
import {
  createFirebaseLifecycleAdapter,
  readInvitation,
} from './collaboration/firebase-lifecycle-adapter';
import type { CollaboratorInvitation } from './collaboration/access-lifecycle';
import logoMark from './assets/logo-mark.svg';
import './AcceptInviteScreen.css';

interface Props {
  user: User;
  token: string;
}

export default function AcceptInviteScreen({ user, token }: Props) {
  const { t } = useTranslation();
  const [invite, setInvite]   = useState<CollaboratorInvitation | null>(null);
  const [state, setState]     = useState<'loading' | 'ready' | 'accepting' | 'done' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    readInvitation(db, token).then(data => {
      if (!data) {
        setErrorMsg(t('acceptInvite.errorInvalid'));
        setState('error');
        return;
      }
      if (data.status === 'revoked') {
        setErrorMsg(t('acceptInvite.errorRevoked'));
        setState('error');
        return;
      }
      if (data.status === 'accepted') {
        setErrorMsg(t('acceptInvite.errorAlreadyAccepted'));
        setState('error');
        return;
      }
      if (data.ownerUid === user.uid) {
        setErrorMsg(t('acceptInvite.errorOwnInvite'));
        setState('error');
        return;
      }
      if (data.status === 'expired' ||
          (data.expiresAtMs !== null && Date.now() >= data.expiresAtMs)) {
        setErrorMsg(t('acceptInvite.errorExpired'));
        setState('error');
        return;
      }
      setInvite(data);
      setState('ready');
    }).catch(() => {
      setErrorMsg(t('acceptInvite.errorLoad'));
      setState('error');
    });
  }, [token, user.uid]);

  async function handleAccept() {
    if (!invite) return;
    setState('accepting');
    try {
      const lifecycle = createFirebaseLifecycleAdapter(db, {
        nowMs: () => Date.now(),
        newAccessId: () => crypto.randomUUID(),
      });
      await lifecycle.acceptInvitation(token, user.uid, {
        displayName: user.displayName ?? user.email?.split('@')[0] ?? '',
        email: user.email ?? '',
      });
      setState('done');
    } catch (e: any) {
      setErrorMsg(e?.message ?? t('acceptInvite.errorAccept'));
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
          <p className="accept-status">{t('acceptInvite.loading')}</p>
        )}

        {state === 'ready' && invite && (
          <div className="accept-card">
            <div className="accept-icon">📦</div>
            <h1 className="accept-title">{t('acceptInvite.invitedTitle')}</h1>
            <p className="accept-body">
              {t('acceptInvite.inviteBody', {
                name: invite.ownerDisplayName || 'the inventory owner',
              })}
            </p>
            <p className="accept-signed-in-as">{t('acceptInvite.signingInAs', { email: user.email })}</p>
            <button className="accept-btn" onClick={handleAccept}>
              {t('acceptInvite.acceptBtn')}
            </button>
          </div>
        )}

        {state === 'accepting' && (
          <p className="accept-status">{t('acceptInvite.accepting')}</p>
        )}

        {state === 'done' && (
          <div className="accept-card">
            <div className="accept-icon">✓</div>
            <h1 className="accept-title">{t('acceptInvite.youreInTitle')}</h1>
            <p className="accept-body">
              {t('acceptInvite.accessGranted', {
                name: invite?.ownerDisplayName || 'the inventory owner',
              })}
            </p>
            <button className="accept-btn" onClick={() => navigate(`/?owner=${invite?.ownerUid}`)}>
              {t('acceptInvite.goToInventory')}
            </button>
          </div>
        )}

        {state === 'error' && (
          <div className="accept-card">
            <div className="accept-icon">✕</div>
            <h1 className="accept-title">{t('acceptInvite.cantAcceptTitle')}</h1>
            <p className="accept-body">{errorMsg}</p>
            <button className="accept-btn" onClick={() => navigate('/')}>
              {t('acceptInvite.goHome')}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
