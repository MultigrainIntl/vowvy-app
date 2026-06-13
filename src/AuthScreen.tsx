import { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { useTranslation } from 'react-i18next';
import { auth } from './firebase';
import logoMark from './assets/logo-mark.svg';

type AuthMode = 'welcome' | 'signin' | 'signup';

function friendlyError(code: string, t: (key: string) => string): string {
  switch (code) {
    case 'auth/invalid-email':        return t('auth.errors.invalidEmail');
    case 'auth/user-not-found':       return t('auth.errors.noAccount');
    case 'auth/wrong-password':       return t('auth.errors.wrongPassword');
    case 'auth/invalid-credential':   return t('auth.errors.wrongCredential');
    case 'auth/email-already-in-use': return t('auth.errors.emailInUse');
    case 'auth/weak-password':        return t('auth.errors.weakPassword');
    default:                          return t('auth.errors.generic');
  }
}

export default function AuthScreen() {
  const { t } = useTranslation();
  const [mode, setMode]           = useState<AuthMode>('welcome');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [error, setError]         = useState('');
  const [busy, setBusy]           = useState(false);
  const [resetMsg, setResetMsg]   = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const canSubmit = Boolean(email && password) && !busy;

  function switchMode(next: AuthMode) {
    setMode(next);
    setError('');
    setResetMsg('');
  }

  async function handleSignIn() {
    setError('');
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e: any) {
      setError(friendlyError(e.code, t));
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
      setError(friendlyError(e.code, t));
    } finally {
      setBusy(false);
    }
  }

  async function handleResetPassword() {
    setError('');
    setResetMsg('');
    if (!email.trim()) {
      setResetMsg(t('auth.reset.enterEmail'));
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setResetMsg(t('auth.reset.sent'));
    } catch {
      setResetMsg(t('auth.reset.sent'));
    }
  }

  if (mode === 'welcome') {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <img src={logoMark} alt="" className="auth-logo-mark" />
          <h1 className="auth-logo">Vowvy</h1>
          <p className="auth-tagline">{t('auth.tagline')}</p>
          <div className="auth-buttons" style={{ marginTop: 8 }}>
            <button onClick={() => switchMode('signup')}>Create your free account</button>
            <button className="secondary" onClick={() => switchMode('signin')}>Sign in</button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'signup') {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <img src={logoMark} alt="" className="auth-logo-mark" />
          <h1 className="auth-logo">Vowvy</h1>
          <p className="auth-mode-heading">Create your account</p>

          <div className="auth-fields">
            <input
              type="email"
              placeholder={t('auth.emailPlaceholder')}
              value={email}
              autoComplete="email"
              disabled={busy}
              onChange={e => { setEmail(e.target.value); setError(''); }}
            />
            <div className="auth-password-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder={t('auth.passwordPlaceholder')}
                value={password}
                autoComplete="new-password"
                disabled={busy}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && canSubmit && handleSignUp()}
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword(v => !v)}
                disabled={busy}
                aria-label={showPassword ? t('auth.hidePasswordAriaLabel') : t('auth.showPasswordAriaLabel')}
              >
                {showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              </button>
            </div>
          </div>

          {error && <p className="auth-error">{error}</p>}

          <div className="auth-buttons">
            <button onClick={handleSignUp} disabled={!canSubmit}>
              {busy ? 'Creating account…' : 'Create Account'}
            </button>
          </div>

          <button className="auth-mode-link" onClick={() => switchMode('signin')}>
            Already have an account? Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <img src={logoMark} alt="" className="auth-logo-mark" />
        <h1 className="auth-logo">Vowvy</h1>
        <p className="auth-mode-heading">Welcome back</p>

        <div className="auth-fields">
          <input
            type="email"
            placeholder={t('auth.emailPlaceholder')}
            value={email}
            autoComplete="email"
            disabled={busy}
            onChange={e => { setEmail(e.target.value); setError(''); }}
          />
          <div className="auth-password-wrap">
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder={t('auth.passwordPlaceholder')}
              value={password}
              autoComplete="current-password"
              disabled={busy}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && canSubmit && handleSignIn()}
            />
            <button
              type="button"
              className="auth-password-toggle"
              onClick={() => setShowPassword(v => !v)}
              disabled={busy}
              aria-label={showPassword ? t('auth.hidePasswordAriaLabel') : t('auth.showPasswordAriaLabel')}
            >
              {showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
            </button>
          </div>
        </div>

        {error && <p className="auth-error">{error}</p>}

        <div className="auth-buttons">
          <button onClick={handleSignIn} disabled={!canSubmit}>
            {t('auth.signIn')}
          </button>
        </div>

        <button className="auth-forgot" onClick={handleResetPassword} disabled={busy}>
          {t('auth.forgotPassword')}
        </button>
        {resetMsg && <p className="auth-reset-msg">{resetMsg}</p>}

        <button className="auth-mode-link" onClick={() => switchMode('signup')}>
          New to Vowvy? Create a free account
        </button>
      </div>
    </div>
  );
}
