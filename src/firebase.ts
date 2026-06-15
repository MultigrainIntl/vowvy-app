import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAuth } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

const firebaseConfig = {
  apiKey: "AIzaSyB1Dk5ahebGjTmdFgy2CG1QZlHE1_HJzgs",
  authDomain: "app.vowvy.com",
  projectId: "vowvy-1ba5f",
  storageBucket: "vowvy-1ba5f.firebasestorage.app",
  messagingSenderId: "469480656114",
  appId: "1:469480656114:web:b29772365774799ff3546b"
};

const app = initializeApp(firebaseConfig);

// App Check — monitoring mode only; enforcement is not enabled in Firebase Console.
// For local dev: add VITE_APPCHECK_DEBUG_TOKEN=<token> to .env.local (register the token
// in Firebase Console → App Check → Apps → Manage debug tokens). Do not commit .env.local.
// For production: VITE_APPCHECK_SITE_KEY overrides the default reCAPTCHA v3 site key.
if (import.meta.env.VITE_APPCHECK_DEBUG_TOKEN) {
  // @ts-ignore
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
}

initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider(
    import.meta.env.VITE_APPCHECK_SITE_KEY || '6LdbjREtAAAAAGxozqM7Nnbi7DmKUTzE6sDSH6vI'
  ),
  isTokenAutoRefreshEnabled: true,
});

export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
export const functions = getFunctions(app);
export default app;
