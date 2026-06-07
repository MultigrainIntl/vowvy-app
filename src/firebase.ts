import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyB1Dk5ahebGjTmdFgy2CG1QZ1HE1_HJzgs",
  authDomain: "vowvy-1ba5f.firebaseapp.com",
  projectId: "vowvy-1ba5f",
  storageBucket: "vowvy-1ba5f.firebasestorage.app",
  messagingSenderId: "469480656114",
  appId: "1:469480656114:web:b29772365774799ff3546b"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
export default app;
