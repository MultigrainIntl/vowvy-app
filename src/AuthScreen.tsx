import { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useTranslation, Trans } from 'react-i18next';
import { auth, db } from './firebase';
import { hasExistingInventoryImport, signInWithExistingInventory } from './staging-existing-account';
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
  const { t, i18n } = useTranslation();
  const [mode, setMode]           = useState<AuthMode>(hasExistingInventoryImport() ? 'signin' : 'welcome');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [error, setError]         = useState('');
  const [busy, setBusy]           = useState(false);
  const [resetMsg, setResetMsg]   = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [policyChecked, setPolicyChecked] = useState(false);

  const canSubmit = Boolean(email && password) && !busy;

  const currentLang = (() => {
    const r = i18n.resolvedLanguage ?? i18n.language;
    if (r.startsWith('pt')) return 'pt-BR';
    if (r.startsWith('es')) return 'es';
    return 'en';
  })();

  function LangSelect() {
    return (
      <select
        className="auth-lang-select"
        value={currentLang}
        onChange={e => i18n.changeLanguage(e.target.value)}
        aria-label={t('language.label')}
      >
        <option value="en">{t('language.en')}</option>
        <option value="es">{t('language.es')}</option>
        <option value="pt-BR">{t('language.ptBR')}</option>
      </select>
    );
  }

  function switchMode(next: AuthMode) {
    setMode(next);
    setError('');
    setResetMsg('');
  }

  async function handleSignIn() {
    setError('');
    setBusy(true);
    try {
      await signInWithExistingInventory(email, password);
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
        num: '01',
        title: t('auth.landing.step1.title'),
        desc: t('auth.landing.step1.desc'),
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
        num: '02',
        title: t('auth.landing.step2.title'),
        desc: t('auth.landing.step2.desc'),
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
        num: '03',
        title: t('auth.landing.step3.title'),
        desc: t('auth.landing.step3.desc'),
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
        num: '04',
        title: t('auth.landing.step4.title'),
        desc: t('auth.landing.step4.desc'),
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
    const audienceRows = [
      {
        title: t('auth.landing.audience1.title'),
        desc: t('auth.landing.audience1.desc'),
        icon: (
          <svg width="26" height="26" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 13L14 3l11 10" />
            <path d="M6 11v14h16V11" />
            <rect x="11" y="17" width="6" height="8" />
          </svg>
        ),
      },
      {
        title: t('auth.landing.audience2.title'),
        desc: t('auth.landing.audience2.desc'),
        icon: (
          <svg width="26" height="26" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="11" width="20" height="13" rx="2" />
            <path d="M4 11l3-6h14l3 6" />
            <line x1="11" y1="15" x2="17" y2="15" />
          </svg>
        ),
      },
      {
        title: t('auth.landing.audience3.title'),
        desc: t('auth.landing.audience3.desc'),
        icon: (
          <svg width="26" height="26" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="22" height="20" rx="2" />
            <path d="M3 18l7-7 4 4 3-3 8 7" />
            <circle cx="9" cy="10" r="2" />
          </svg>
        ),
      },
      {
        title: t('auth.landing.audience4.title'),
        desc: t('auth.landing.audience4.desc'),
        icon: (
          <svg width="26" height="26" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="10" width="22" height="14" rx="2" />
            <path d="M10 10V8a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="3" y1="17" x2="25" y2="17" />
            <line x1="14" y1="13" x2="14" y2="21" />
          </svg>
        ),
      },
      {
        title: t('auth.landing.audience5.title'),
        desc: t('auth.landing.audience5.desc'),
        icon: (
          <svg width="26" height="26" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="20" height="21" rx="2" />
            <line x1="4" y1="11" x2="24" y2="11" />
            <rect x="11" y="17" width="6" height="8" />
            <rect x="8" y="7" width="3" height="2" rx="0.5" fill="currentColor" stroke="none" opacity="0.4" />
            <rect x="17" y="7" width="3" height="2" rx="0.5" fill="currentColor" stroke="none" opacity="0.4" />
            <rect x="8" y="14" width="3" height="2" rx="0.5" fill="currentColor" stroke="none" opacity="0.4" />
            <rect x="17" y="14" width="3" height="2" rx="0.5" fill="currentColor" stroke="none" opacity="0.4" />
          </svg>
        ),
      },
      {
        title: t('auth.landing.audience6.title'),
        desc: t('auth.landing.audience6.desc'),
        icon: (
          <svg width="26" height="26" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 3h10l6 7v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
            <polyline points="16 3 16 10 22 10" />
            <path d="M9 17l2.5 2.5 5-5" />
          </svg>
        ),
      },
    ];
    const benefits = [
      t('auth.landing.benefit1'),
      t('auth.landing.benefit2'),
      t('auth.landing.benefit3'),
      t('auth.landing.benefit4'),
      t('auth.landing.benefit5'),
      t('auth.landing.benefit6'),
      t('auth.landing.benefit7'),
    ];
    return (
      <div className="auth-landing">
        <div className="auth-lang-bar">
          <LangSelect />
        </div>

        {/* Hero */}
        <div className="auth-card auth-landing-hero">
          <img src={logoMark} alt="" className="auth-logo-mark" />
          <h1 className="auth-logo">Vowvy</h1>
          <p className="landing-headline">{t('auth.landing.headline')}</p>
          <p className="landing-subheadline">{t('auth.landing.subheadline')}</p>
          <div className="auth-buttons" style={{ marginTop: 8 }}>
            <button onClick={() => switchMode('signup')}>{t('auth.landing.createAccount')}</button>
            <button className="secondary" onClick={() => switchMode('signin')}>{t('auth.signIn')}</button>
          </div>
        </div>

        {/* How VOWVY works */}
        <section className="landing-how">
          <h2 className="landing-section-heading">{t('auth.landing.howTitle')}</h2>
          <p className="landing-how-aha">{t('auth.landing.howAha')}</p>
          <ol className="landing-how-steps">
            {howSteps.map(({ num, title, desc, icon }, i) => (
              <li key={i} className="landing-how-step">
                <span className="landing-how-icon-wrap">{icon}</span>
                <div className="landing-how-step-content">
                  <span className="landing-how-step-num">{t('auth.landing.stepNum', { num })}</span>
                  <strong className="landing-how-title">{title}</strong>
                  <p className="landing-how-desc">{desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* What VOWVY helps you do */}
        <section className="landing-benefits">
          <h2 className="landing-section-heading">{t('auth.landing.benefitsTitle')}</h2>
          <p className="landing-section-intro">{t('auth.landing.benefitsIntro')}</p>
          <ul className="landing-benefits-list">
            {benefits.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        </section>

        {/* Useful at home, at school, and at work */}
        <section className="landing-audience">
          <h2 className="landing-section-heading">{t('auth.landing.audienceTitle')}</h2>
          <p className="landing-section-intro">{t('auth.landing.audienceIntro')}</p>
          <ul className="landing-audience-list">
            {audienceRows.map(({ title, desc, icon }, i) => (
              <li key={i}>
                <span className="landing-audience-icon" aria-hidden="true">{icon}</span>
                <div className="landing-audience-text">
                  <strong>{title}</strong>
                  <span>{desc}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Closing CTA */}
        <section className="landing-cta">
          <h2 className="landing-cta-heading">{t('auth.landing.ctaHeading')}</h2>
          <div className="auth-buttons landing-cta-buttons">
            <button onClick={() => switchMode('signup')}>{t('auth.landing.getStarted')}</button>
            <button className="secondary" onClick={() => switchMode('signin')}>{t('auth.signIn')}</button>
          </div>
        </section>

      </div>
    );
  }

  if (mode === 'signup') {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-lang-row">
            <LangSelect />
          </div>
          <img src={logoMark} alt="" className="auth-logo-mark" />
          <h1 className="auth-logo">Vowvy</h1>
          <p className="auth-mode-heading">{t('auth.signup.heading')}</p>
          <p className="auth-mode-sub">{t('auth.signup.sub')}</p>

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
              <Trans
                i18nKey="auth.signup.policyAgreement"
                components={{
                  termsLink: <a href="/terms" target="_blank" rel="noopener noreferrer" />,
                  privacyLink: <a href="/privacy" target="_blank" rel="noopener noreferrer" />,
                  aupLink: <a href="/acceptable-use" target="_blank" rel="noopener noreferrer" />,
                }}
              />
            </span>
          </label>

          <div className="auth-buttons">
            <button onClick={handleSignUp} disabled={!canSubmit || !policyChecked}>
              {busy ? t('auth.signup.creating') : t('auth.signup.createAccount')}
            </button>
          </div>

          <button className="auth-mode-link" onClick={() => switchMode('signin')}>
            {t('auth.signup.haveAccount')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-lang-row">
          <LangSelect />
        </div>
        <img src={logoMark} alt="" className="auth-logo-mark" />
        <h1 className="auth-logo">Vowvy</h1>
        <p className="auth-mode-heading">{t('auth.signin.heading')}</p>
        <p className="auth-mode-sub">{t('auth.signin.sub')}</p>

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
          {t('auth.signin.newToVowvy')}
        </button>
      </div>
    </div>
  );
}
