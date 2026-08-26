import { initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import {
  appCheckSiteKey,
  firebaseConfig,
  functionsRegion,
  useEmulators,
} from './environment';

const app = initializeApp(firebaseConfig);

// App Check — monitoring mode only; enforcement is not enabled in Firebase Console.
// For local dev: add VITE_APPCHECK_DEBUG_TOKEN=<token> to .env.local (register the token
// in Firebase Console → App Check → Apps → Manage debug tokens). Do not commit .env.local.
// For production: VITE_APPCHECK_SITE_KEY overrides the default reCAPTCHA v3 site key.
if (!useEmulators && import.meta.env.VITE_APPCHECK_DEBUG_TOKEN) {
  // @ts-ignore
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
}

export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
export const functions = getFunctions(app, functionsRegion);

if (useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
} else if (appCheckSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export default app;
