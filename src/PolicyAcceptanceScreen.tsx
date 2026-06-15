import { useState } from 'react';
import { signOut } from 'firebase/auth';
import { type User } from 'firebase/auth';
import { useTranslation } from 'react-i18next';
import { auth } from './firebase';
import logoMark from './assets/logo-mark.svg';
import './PolicyAcceptanceScreen.css';

interface Props {
  user: User;
  onAccept: () => Promise<void>;
}

export default function PolicyAcceptanceScreen({ onAccept }: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  async function handleAccept() {
    setBusy(true);
    await onAccept();
  }

  async function handleSignOut() {
    await signOut(auth);
  }

  return (
    <div className="pol-screen">
      <div className="pol-card">
        <img src={logoMark} alt="" className="pol-logo-mark" />
        <h1 className="pol-wordmark">Vowvy</h1>

        <p className="pol-intro">{t('policy.intro')}</p>

        <div className="pol-links">
          <a href="/terms" target="_blank" rel="noopener noreferrer" className="pol-policy-link">
            {t('policy.termsLink')} ↗
          </a>
          <a href="/privacy" target="_blank" rel="noopener noreferrer" className="pol-policy-link">
            {t('policy.privacyLink')} ↗
          </a>
          <a href="/acceptable-use" target="_blank" rel="noopener noreferrer" className="pol-policy-link">
            {t('policy.aupLink')} ↗
          </a>
        </div>

        <button
          className="pol-accept-btn"
          onClick={handleAccept}
          disabled={busy}
        >
          {busy ? t('policy.saving') : t('policy.agree')}
        </button>

        <button className="pol-signout-link" onClick={handleSignOut} disabled={busy}>
          {t('policy.signOut')}
        </button>
      </div>
    </div>
  );
}
