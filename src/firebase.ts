import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAuth, setPersistence, browserSessionPersistence } from 'firebase/auth';
// import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

const firebaseConfig = {
  apiKey: "AIzaSyB1Dk5ahebGjTmdFgy2CG1QZlHE1_HJzgs",
  authDomain: "vowvy-1ba5f.firebaseapp.com",
  projectId: "vowvy-1ba5f",
  storageBucket: "vowvy-1ba5f.firebasestorage.app",
  messagingSenderId: "469480656114",
  appId: "1:469480656114:web:b29772365774799ff3546b"
};

const app = initializeApp(firebaseConfig);

// App Check temporarily disabled — re-enable once reCAPTCHA secret is registered in Firebase Console
// if (import.meta.env.DEV) {
//   // @ts-ignore
//   self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
// }
// initializeAppCheck(app, {
//   provider: new ReCaptchaV3Provider('6LdbjREtAAAAAGxozqM7Nnbi7DmKUTzE6sDSH6vI'),
//   isTokenAutoRefreshEnabled: true,
// });

export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
// Safari ITP blocks cross-origin IndexedDB (firebaseapp.com treated as tracker).
// browserSessionPersistence uses sessionStorage which Safari allows.
// TODO: once app.vowvy.com custom domain is verified in Firebase Hosting,
// set authDomain to "app.vowvy.com" and remove this — same-origin auth
// doesn't need the sessionStorage workaround.
setPersistence(auth, browserSessionPersistence);
export default app;
