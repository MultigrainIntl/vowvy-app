import { useState, useEffect } from 'react';
import { signOut, type User } from 'firebase/auth';
import {
  collection, doc, setDoc, onSnapshot,
  query, orderBy, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import imageCompression from 'browser-image-compression';
import { auth, db, storage } from './firebase';
import logoMark from './assets/logo-mark.svg';
import './MainScreen.css';

interface Container {
  id: string;
  location: string;
  name: string;
  photoUrl: string;
  photoStoragePath: string;
  createdAt: Timestamp | null;
}

function relativeTime(ts: Timestamp | null): string {
  if (!ts) return 'just now';
  const seconds = Math.floor((Date.now() - ts.toMillis()) / 1000);
  if (seconds < 60)        return 'just now';
  if (seconds < 3600)      return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400)     return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d ago`;
  return ts.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface Props {
  user: User;
}

export default function MainScreen({ user }: Props) {
  const [location, setLocation]     = useState('');
  const [name, setName]             = useState('');
  const [photo, setPhoto]           = useState<File | null>(null);
  const [preview, setPreview]       = useState<string | null>(null);
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);
  const [saveError, setSaveError]   = useState('');
  const [containers, setContainers] = useState<Container[]>([]);

  const isChromeIOS = /CriOS/.test(navigator.userAgent);
  const canSave = Boolean(location.trim() && name.trim() && photo) && !saving;

  useEffect(() => {
    const q = query(
      collection(db, `users/${user.uid}/containers`),
      orderBy('createdAt', 'desc'),
    );
    return onSnapshot(q, (snap) => {
      setContainers(
        snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Container, 'id'>) }))
      );
    });
  }, [user.uid]);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (preview) URL.revokeObjectURL(preview);
    setPhoto(file);
    setPreview(file ? URL.createObjectURL(file) : null);
  }

  async function handleSave() {
    if (!photo) return;
    setSaving(true);
    setSaveError('');
    try {
      const compressed = await imageCompression(photo, {
        maxWidthOrHeight: 1600,
        initialQuality: 0.85,
        useWebWorker: true,
        maxSizeMB: 0.5,
      });

      const containerRef  = doc(collection(db, `users/${user.uid}/containers`));
      const containerId   = containerRef.id;
      const storagePath   = `users/${user.uid}/containers/${containerId}/photo.jpg`;

      await uploadBytes(ref(storage, storagePath), compressed);
      const photoUrl = await getDownloadURL(ref(storage, storagePath));

      await setDoc(containerRef, {
        location: location.trim(),
        name: name.trim(),
        photoUrl,
        photoStoragePath: storagePath,
        createdAt: serverTimestamp(),
      });

      if (preview) URL.revokeObjectURL(preview);
      setLocation('');
      setName('');
      setPhoto(null);
      setPreview(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setSaveError('Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const grouped = containers.reduce<Record<string, Container[]>>((acc, c) => {
    if (!acc[c.location]) acc[c.location] = [];
    acc[c.location].push(c);
    return acc;
  }, {});
  const locationKeys = Object.keys(grouped);

  return (
    <div className="main-screen">
      <header className="app-header">
        <div className="header-brand">
          <img src={logoMark} alt="" className="header-logo-mark" />
          <span className="app-wordmark">Vowvy</span>
        </div>
        <button className="sign-out-btn" onClick={() => signOut(auth)}>
          Sign out
        </button>
      </header>

      {isChromeIOS && (
        <div className="ios-banner">
          <span>For camera access on iPhone, open in Safari.</span>
          <a href="https://vowvy-1ba5f.web.app">Open in Safari</a>
        </div>
      )}

      <main className="main-content">
        <section className="capture-card">
          <div className="form-fields">
            <input
              type="text"
              list="locations-list"
              placeholder="Location — e.g. Garage, Storage unit 3"
              value={location}
              disabled={saving}
              onChange={e => setLocation(e.target.value)}
            />
            <datalist id="locations-list">
              {[...new Set(containers.map(c => c.location))].sort().map(loc => (
                <option key={loc} value={loc} />
              ))}
            </datalist>
            <input
              type="text"
              placeholder="Container — e.g. Box 12, Blue bin"
              value={name}
              disabled={saving}
              onChange={e => setName(e.target.value)}
            />

            <label className="photo-input-label">
              <input
                type="file"
                disabled={saving}
                onChange={handlePhotoChange}
                className="photo-input-hidden"
              />
              {preview ? (
                <img src={preview} alt="Selected photo" className="photo-preview" />
              ) : (
                <div className="photo-placeholder">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.776 48.776 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
                  </svg>
                  <span>Take photo or choose file</span>
                </div>
              )}
            </label>
          </div>

          {saveError && <p className="save-error">{saveError}</p>}

          <button
            className={`save-btn${saved ? ' saved' : ''}`}
            onClick={handleSave}
            disabled={!canSave}
          >
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Container'}
          </button>
        </section>

        <section className="container-list">
          {locationKeys.length === 0 ? (
            <p className="list-empty">No containers yet. Add your first one above.</p>
          ) : (
            locationKeys.map(loc => (
              <div key={loc} className="location-group">
                <h2 className="location-heading">{loc}</h2>
                {grouped[loc].map(c => (
                  <div key={c.id} className="container-row">
                    <img src={c.photoUrl} alt={c.name} className="container-thumb" />
                    <div className="container-meta">
                      <div className="container-name">{c.name}</div>
                      <div className="container-time">{relativeTime(c.createdAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
