import { useState, useEffect } from 'react';
import { type User } from 'firebase/auth';
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp,
  collection,
} from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { db } from './firebase';
import { navigate } from './nav';
import { PARTNERS, type PartnerBox } from './partnerBoxes';
import logoMark from './assets/logo-mark.svg';
import './ClaimBoxScreen.css';

interface Props {
  boxId: string;
  user: User;
}

type State = 'loading' | 'ready' | 'claiming' | 'done' | 'error' | 'already-claimed';

export default function ClaimBoxScreen({ boxId, user }: Props) {
  const { t } = useTranslation();
  const [state, setState]   = useState<State>('loading');
  const [box, setBox]       = useState<PartnerBox | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [containerId, setContainerId] = useState<string | null>(null);

  useEffect(() => {
    getDoc(doc(db, 'partnerBoxes', boxId)).then(snap => {
      if (!snap.exists()) {
        setErrorMsg(t('acceptInvite.errorInvalid'));
        setState('error');
        return;
      }
      const data = snap.data() as PartnerBox;
      setBox(data);
      if (data.status === 'active' && data.claimedByUid === user.uid) {
        setState('already-claimed');
        return;
      }
      if (data.status === 'active' && data.claimedByUid !== user.uid) {
        setErrorMsg(t('claimBox.errorClaimed'));
        setState('error');
        return;
      }
      setState('ready');
    }).catch(() => {
      setErrorMsg(t('claimBox.errorLoad'));
      setState('error');
    });
  }, [boxId, user.uid]);

  async function handleClaim() {
    if (!box) return;
    setState('claiming');
    try {
      const containerRef = doc(collection(db, `users/${user.uid}/containers`));
      const partner = PARTNERS[box.partnerId] ?? { name: box.partnerName };
      const containerName = `${partner.name} — ${boxId}`;
      await setDoc(containerRef, {
        name: containerName,
        locationId: null,
        location: partner.name,
        photos: [],
        photoUrls: [],
        photoStoragePaths: [],
        createdAt: serverTimestamp(),
        deletedAt: null,
        isPrivate: false,
        partnerBoxId: boxId,
        partnerId: box.partnerId,
      });
      await updateDoc(doc(db, 'partnerBoxes', boxId), {
        status: 'active',
        claimedByUid: user.uid,
        claimedByEmail: user.email ?? '',
        claimedAt: serverTimestamp(),
        userContainerId: containerRef.id,
      });
      setContainerId(containerRef.id);
      setState('done');
    } catch (e: any) {
      setErrorMsg(e?.message ?? t('claimBox.errorClaim'));
      setState('error');
    }
  }

  const partner = box ? (PARTNERS[box.partnerId] ?? null) : null;

  return (
    <div className="claim-screen">
      <header className="app-header">
        <div className="header-brand">
          <img src={logoMark} alt="Vowvy" className="header-logo-mark" />
          <span className="app-wordmark">Vowvy</span>
        </div>
      </header>

      <div className="claim-content">
        {state === 'loading' && (
          <div className="claim-card">
            <p className="claim-loading">{t('claimBox.loading')}</p>
          </div>
        )}

        {(state === 'ready' || state === 'claiming') && box && (
          <div className="claim-card">
            {partner && (
              <div className="claim-sponsor">
                <span className="claim-sponsor-label">{t('claimBox.sponsoredBy')}</span>
                <a href={partner.website} target="_blank" rel="noopener noreferrer" className="claim-sponsor-name">
                  {partner.name}
                </a>
                {partner.tagline && (
                  <p className="claim-sponsor-tagline">{partner.tagline}</p>
                )}
              </div>
            )}
            <div className="claim-box-id">📦 {boxId}</div>
            <h1 className="claim-title">{t('claimBox.trackTitle')}</h1>
            <p className="claim-body">{t('claimBox.trackBody')}</p>
            <button
              className="claim-btn"
              disabled={state === 'claiming'}
              onClick={handleClaim}
            >
              {state === 'claiming' ? t('claimBox.settingUp') : t('claimBox.addToInventory')}
            </button>
          </div>
        )}

        {state === 'already-claimed' && (
          <div className="claim-card">
            <div className="claim-icon">📦</div>
            <h1 className="claim-title">{boxId}</h1>
            <p className="claim-body">{t('claimBox.alreadyClaimed')}</p>
            <button className="claim-btn" onClick={() => navigate('/')}>
              {t('claimBox.goToInventory')}
            </button>
          </div>
        )}

        {state === 'done' && (
          <div className="claim-card">
            <div className="claim-icon">✓</div>
            <h1 className="claim-title">{t('claimBox.doneTitle')}</h1>
            <p className="claim-body">
              {t('claimBox.doneBody', { boxId })}
            </p>
            {partner && (
              <p className="claim-sponsor-tagline" style={{ marginBottom: 16 }}>
                {t('claimBox.courtesyOf', { name: partner.name })}
              </p>
            )}
            <button className="claim-btn" onClick={() => navigate(`/container/${containerId}`)}>
              {t('claimBox.startPhotos')}
            </button>
          </div>
        )}

        {state === 'error' && (
          <div className="claim-card">
            <div className="claim-icon claim-icon-error">✕</div>
            <h1 className="claim-title">{t('claimBox.errorTitle')}</h1>
            <p className="claim-body">{errorMsg}</p>
            <button className="claim-btn" onClick={() => navigate('/')}>{t('acceptInvite.goHome')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
