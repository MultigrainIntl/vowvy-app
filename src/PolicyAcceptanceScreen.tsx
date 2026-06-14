import { useState } from 'react';
import { signOut } from 'firebase/auth';
import { type User } from 'firebase/auth';
import { auth } from './firebase';
import logoMark from './assets/logo-mark.svg';
import './PolicyAcceptanceScreen.css';

interface Props {
  user: User;
  onAccept: () => Promise<void>;
}

export default function PolicyAcceptanceScreen({ onAccept }: Props) {
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

        <p className="pol-intro">
          Before continuing, please review and accept Vowvy's updated policies.
        </p>

        <div className="pol-links">
          <a href="/terms" target="_blank" rel="noopener noreferrer" className="pol-policy-link">
            Terms of Use ↗
          </a>
          <a href="/privacy" target="_blank" rel="noopener noreferrer" className="pol-policy-link">
            Privacy Policy ↗
          </a>
          <a href="/acceptable-use" target="_blank" rel="noopener noreferrer" className="pol-policy-link">
            Acceptable Use Policy ↗
          </a>
        </div>

        <button
          className="pol-accept-btn"
          onClick={handleAccept}
          disabled={busy}
        >
          {busy ? 'Saving…' : 'I agree and continue'}
        </button>

        <button className="pol-signout-link" onClick={handleSignOut} disabled={busy}>
          Sign out
        </button>
      </div>
    </div>
  );
}
