import { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { auth, db } from './firebase';
import logoMark from './assets/logo-mark.svg';

const CURRENT_POLICY_VERSION = '2026-06-13';

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
  const [policyChecked, setPolicyChecked] = useState(false);

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
      const result = await createUserWithEmailAndPassword(auth, email, password);
      // Set sessionStorage synchronously so onAuthStateChanged reads it before firing
      sessionStorage.setItem('vowvy_policy_version_accepted', CURRENT_POLICY_VERSION);
      // Write acceptance record to Firestore (async, non-blocking for UX)
      setDoc(doc(db, 'users', result.user.uid), {
        acceptedTermsVersion: CURRENT_POLICY_VERSION,
        acceptedPrivacyVersion: CURRENT_POLICY_VERSION,
        acceptedAupVersion: CURRENT_POLICY_VERSION,
        acceptedPoliciesAt: serverTimestamp(),
        acceptedPoliciesUserAgent: navigator.userAgent,
      }, { merge: true }).catch(() => {});
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
    const howSteps = [
      {
        num: '01', title: 'Take a photo', desc: 'Snap photos of items, boxes, rooms, offices, supplies, samples, or collections.',
        icon: (
          <svg width="44" height="44" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="11" width="32" height="22" rx="3" />
            <path d="M14 11V8h6l3 3" />
            <circle cx="20" cy="22" r="6" />
            <circle cx="20" cy="22" r="2.5" fill="currentColor" stroke="none" opacity="0.25" />
            <circle cx="31" cy="16" r="1.5" fill="currentColor" stroke="none" />
          </svg>
        ),
      },
      {
        num: '02', title: 'VOWVY helps label it', desc: 'AI descriptions and tags make things easier to find.',
        icon: (
          <svg width="44" height="44" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="4" width="30" height="22" rx="3" />
            <rect x="9" y="8" width="10" height="9" rx="1.5" fill="currentColor" stroke="none" opacity="0.12" />
            <rect x="21" y="9" width="10" height="1.5" rx="0.75" fill="currentColor" stroke="none" opacity="0.4" />
            <rect x="21" y="12.5" width="7" height="1.5" rx="0.75" fill="currentColor" stroke="none" opacity="0.4" />
            <rect x="5" y="30" width="13" height="7" rx="3.5" />
            <rect x="22" y="30" width="13" height="7" rx="3.5" />
            <rect x="8.5" y="33" width="6" height="1" rx="0.5" fill="currentColor" stroke="none" opacity="0.5" />
            <rect x="25.5" y="33" width="6" height="1" rx="0.5" fill="currentColor" stroke="none" opacity="0.5" />
          </svg>
        ),
      },
      {
        num: '03', title: 'Find or share it later', desc: 'Search by item, note, tag, room, box, or location — or share with a helper.',
        icon: (
          <svg width="44" height="44" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="17" cy="17" r="11" />
            <line x1="25.5" y1="25.5" x2="35" y2="35" strokeWidth="2" />
            <rect x="12" y="14" width="10" height="1.5" rx="0.75" fill="currentColor" stroke="none" opacity="0.4" />
            <rect x="12" y="17.5" width="7" height="1.5" rx="0.75" fill="currentColor" stroke="none" opacity="0.4" />
          </svg>
        ),
      },
      {
        num: '04', title: 'Use it when needed', desc: 'Prepare items to sell, share with helpers, support a move, or document belongings.',
        icon: (
          <svg width="44" height="44" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="3" width="28" height="35" rx="3" />
            <rect x="9" y="6" width="22" height="14" rx="1.5" fill="currentColor" stroke="none" opacity="0.1" />
            <rect x="9" y="24" width="18" height="1.5" rx="0.75" fill="currentColor" stroke="none" opacity="0.5" />
            <rect x="9" y="27.5" width="13" height="1.5" rx="0.75" fill="currentColor" stroke="none" opacity="0.35" />
            <rect x="9" y="31" width="16" height="1.5" rx="0.75" fill="currentColor" stroke="none" opacity="0.35" />
          </svg>
        ),
      },
    ];
    return (
      <div className="auth-landing">

        {/* Hero */}
        <div className="auth-card auth-landing-hero">
          <img src={logoMark} alt="" className="auth-logo-mark" />
          <h1 className="auth-logo">Vowvy</h1>
          <p className="landing-headline">Finally know what you have, where it is, and what you're ready to let go.</p>
          <p className="landing-subheadline">VOWVY gives you a searchable memory of your things — at home, at school, or at work. Organize what you have, find it later, share it with helpers, or prepare items to sell.</p>
          <div className="auth-buttons" style={{ marginTop: 8 }}>
            <button onClick={() => switchMode('signup')}>Create your free account</button>
            <button className="secondary" onClick={() => switchMode('signin')}>Sign in</button>
          </div>
        </div>

        {/* How VOWVY works */}
        <section className="landing-how">
          <h2 className="landing-section-heading">How VOWVY works</h2>
          <p className="landing-how-aha">Take a photo. VOWVY remembers.<br />Find it whenever you need it.</p>
          <ol className="landing-how-steps">
            {howSteps.map(({ num, title, desc, icon }, i) => (
              <li key={i} className="landing-how-step">
                <span className="landing-how-icon-wrap">{icon}</span>
                <div className="landing-how-step-content">
                  <span className="landing-how-step-num">Step {num}</span>
                  <strong className="landing-how-title">{title}</strong>
                  <p className="landing-how-desc">{desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* What VOWVY helps you do */}
        <section className="landing-benefits">
          <h2 className="landing-section-heading">What VOWVY helps you do</h2>
          <p className="landing-section-intro">
            VOWVY helps you photograph, organize, find, share, move, and sell the things you own — without trying to remember everything yourself.
          </p>
          <ul className="landing-benefits-list">
            {[
              "Remember what's in your boxes — take photos before storing things away.",
              'Find things later — search by item, description, note, tag, room, box, or location.',
              'Organize a move or cleanup — group items by room, container, collection, or storage area.',
              "Keep track of valuables and keepsakes — add photos, notes, and details you don't want to forget.",
              "Let AI do the labeling — VOWVY describes and tags photos so you don't have to type everything yourself.",
              'Work with helpers — let family, assistants, or collaborators help organize while controlling what they can see.',
              'Prepare items to sell — select photos, generate a title and description, and export everything for easier posting on marketplaces or similar sites.',
            ].map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        </section>

        {/* Useful at home, at school, and at work */}
        <section className="landing-audience">
          <h2 className="landing-section-heading">Useful at home, at school, and at work</h2>
          <p className="landing-section-intro">The same simple idea works across many real-life situations.</p>
          <ul className="landing-audience-list">
            {[
              { title: 'Home & storage', desc: "Remember what's in boxes, closets, garages, basements, and storage areas." },
              { title: 'Moving & dorms', desc: 'Track belongings before, during, and after a move.' },
              { title: 'Families & estates', desc: 'Organize keepsakes, valuables, donations, and items to sell.' },
              { title: 'Office & workspaces', desc: 'Keep track of supplies, equipment, samples, and shared storage.' },
              { title: 'Real estate & cleanouts', desc: 'Document rooms, contents, staging items, and cleanout projects.' },
              { title: 'Insurance documentation', desc: 'Create a photo-based record of belongings — useful when preparing documentation for insurance purposes.' },
            ].map(({ title, desc }, i) => (
              <li key={i}>
                <strong>{title}</strong>
                <span>{desc}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Closing CTA */}
        <section className="landing-cta">
          <h2 className="landing-cta-heading">Ready to stop guessing where things are?</h2>
          <div className="auth-buttons landing-cta-buttons">
            <button onClick={() => switchMode('signup')}>Get started</button>
            <button className="secondary" onClick={() => switchMode('signin')}>Sign in</button>
          </div>
        </section>

      </div>
    );
  }

  if (mode === 'signup') {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <img src={logoMark} alt="" className="auth-logo-mark" />
          <h1 className="auth-logo">Vowvy</h1>
          <p className="auth-mode-heading">Start remembering what you have</p>
          <p className="auth-mode-sub">Take photos, organize your things, and find them later.</p>

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

          <label className="auth-policy-check">
            <input
              type="checkbox"
              checked={policyChecked}
              disabled={busy}
              onChange={e => setPolicyChecked(e.target.checked)}
            />
            <span>
              I agree to Vowvy's{' '}
              <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Use</a>,{' '}
              <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>, and{' '}
              <a href="/acceptable-use" target="_blank" rel="noopener noreferrer">Acceptable Use Policy</a>.
            </span>
          </label>

          <div className="auth-buttons">
            <button onClick={handleSignUp} disabled={!canSubmit || !policyChecked}>
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
        <p className="auth-mode-sub">Find what you saved, continue organizing, or prepare items when you're ready.</p>

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
