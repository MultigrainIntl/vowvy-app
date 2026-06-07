import { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { auth } from './firebase';
import logoMark from './assets/logo-mark.svg';

function friendlyError(code: string): string {
  switch (code) {
    case 'auth/invalid-email':        return 'Invalid email address.';
    case 'auth/user-not-found':       return 'No account found — try signing up.';
    case 'auth/wrong-password':       return 'Wrong password.';
    case 'auth/invalid-credential':   return 'Wrong email or password.';
    case 'auth/email-already-in-use': return 'Email already in use — try signing in.';
    case 'auth/weak-password':        return 'Password must be at least 6 characters.';
    default:                          return 'Something went wrong. Please try again.';
  }
}

export default function AuthScreen() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [busy, setBusy]         = useState(false);

  const canSubmit = Boolean(email && password) && !busy;

  async function handleSignIn() {
    setError('');
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e: any) {
      setError(friendlyError(e.code));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignUp() {
    setError('');
    setBusy(true);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (e: any) {
      setError(friendlyError(e.code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <img src={logoMark} alt="" className="auth-logo-mark" />
        <h1 className="auth-logo">Vowvy</h1>
        <p className="auth-tagline">Capture first. Organize later.</p>

        <div className="auth-fields">
          <input
            type="email"
            placeholder="Email"
            value={email}
            autoComplete="email"
            disabled={busy}
            onChange={e => { setEmail(e.target.value); setError(''); }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            autoComplete="current-password"
            disabled={busy}
            onChange={e => { setPassword(e.target.value); setError(''); }}
            onKeyDown={e => e.key === 'Enter' && canSubmit && handleSignIn()}
          />
        </div>

        {error && <p className="auth-error">{error}</p>}

        <div className="auth-buttons">
          <button onClick={handleSignIn} disabled={!canSubmit}>
            Sign In
          </button>
          <button className="secondary" onClick={handleSignUp} disabled={!canSubmit}>
            Sign Up
          </button>
        </div>
      </div>
    </div>
  );
}
