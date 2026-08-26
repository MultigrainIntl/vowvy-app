const useEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';

function required(name: string): string {
  const value = import.meta.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const firebaseConfig = useEmulators
  ? {
      apiKey: 'demo-api-key',
      authDomain: 'vowvy-emulator.local',
      projectId: 'vowvy-emulator',
      storageBucket: 'vowvy-emulator.firebasestorage.app',
      messagingSenderId: '000000000000',
      appId: '1:000000000000:web:0000000000000000000000',
    }
  : {
      apiKey: required('VITE_FIREBASE_API_KEY'),
      authDomain: required('VITE_FIREBASE_AUTH_DOMAIN'),
      projectId: required('VITE_FIREBASE_PROJECT_ID'),
      storageBucket: required('VITE_FIREBASE_STORAGE_BUCKET'),
      messagingSenderId: required('VITE_FIREBASE_MESSAGING_SENDER_ID'),
      appId: required('VITE_FIREBASE_APP_ID'),
    };

export const appBaseUrl = useEmulators
  ? 'http://127.0.0.1:5173'
  : required('VITE_APP_BASE_URL').replace(/\/+$/, '');

export const functionsRegion =
  import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION?.trim() || 'us-central1';

export const proxyBase =
  import.meta.env.VITE_PROXY_BASE_URL?.trim() ||
  `https://${functionsRegion}-${firebaseConfig.projectId}.cloudfunctions.net/proxyImage`;

export const appCheckSiteKey =
  import.meta.env.VITE_APPCHECK_SITE_KEY?.trim() || '';

export { useEmulators };
