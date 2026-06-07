import { useState } from 'react';
import { signOut, User } from 'firebase/auth';
import { auth } from './firebase';
import './MainScreen.css';

interface Props {
  user: User;
}

export default function MainScreen({ user }: Props) {
  const [location, setLocation] = useState('');
  const [name, setName]         = useState('');
  const [photo, setPhoto]       = useState<File | null>(null);
  const [preview, setPreview]   = useState<string | null>(null);

  const canSave = Boolean(location.trim() && name.trim() && photo);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (preview) URL.revokeObjectURL(preview);
    setPhoto(file);
    setPreview(file ? URL.createObjectURL(file) : null);
  }

  function handleSave() {
    // Checkpoint 4: compress → upload → Firestore write
  }

  return (
    <div className="main-screen">
      <header className="app-header">
        <span className="app-wordmark">Vowvy</span>
        <button className="sign-out-btn" onClick={() => signOut(auth)}>
          Sign out
        </button>
      </header>

      <main className="main-content">
        <section className="capture-card">
          <div className="form-fields">
            <input
              type="text"
              placeholder="Location — e.g. Garage, Storage unit 3"
              value={location}
              onChange={e => setLocation(e.target.value)}
            />
            <input
              type="text"
              placeholder="Container — e.g. Box 12, Blue bin"
              value={name}
              onChange={e => setName(e.target.value)}
            />

            <label className="photo-input-label">
              <input
                type="file"
                accept="image/*"
                capture="environment"
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

          <button className="save-btn" onClick={handleSave} disabled={!canSave}>
            Save Container
          </button>
        </section>

        <section className="container-list">
          <p className="list-empty">No containers yet. Add your first one above.</p>
        </section>
      </main>
    </div>
  );
}
