import { useState, useEffect, useRef } from 'react';
import { type User } from 'firebase/auth';
import { doc, onSnapshot, updateDoc, arrayUnion, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import imageCompression from 'browser-image-compression';
import { auth, db, storage } from './firebase';
import { ThumbImage, ContainerNotes } from './shared';
import type { ContainerNote, PhotoItem } from './shared';
import { navigate } from './nav';
import logoMark from './assets/logo-mark.svg';
import './ContainerScreen.css';

interface Container {
  id: string;
  location: string;
  name: string;
  photos: PhotoItem[];
  createdAt: Timestamp | null;
  aiStatus: 'processing' | 'done' | 'error' | null;
  aiTags: string[];
  aiDescription: string;
  aiSearchTerms: string[];
  notes: ContainerNote[];
  deletedAt: number | null;
  isPrivate: boolean;
  lastModifiedAt: Timestamp | null;
  lastModifiedBy: string | null;
  lastModifiedByName: string | null;
}

interface Props {
  user: User;
  containerId: string;
}

function mapContainer(snap: any): Container {
  const data = snap.data();
  const rawPhotos: PhotoItem[] = data.photos ?? [];
  const photoUrls: string[] = data.photoUrls ?? (data.photoUrl ? [data.photoUrl] : []);
  const photoStoragePaths: string[] = data.photoStoragePaths ?? (data.photoStoragePath ? [data.photoStoragePath] : []);
  const photoUrlSet = new Set(rawPhotos.map((p: PhotoItem) => p.url));
  const merged: PhotoItem[] = [...rawPhotos];
  photoUrls.forEach((url: string, i: number) => {
    if (!photoUrlSet.has(url)) {
      merged.push({ id: `legacy-${i}`, url, storagePath: photoStoragePaths[i] ?? '', description: '', createdAt: 0 });
    }
  });
  const photos: PhotoItem[] = merged;
  return {
    id: snap.id,
    location: data.location ?? '',
    name: data.name ?? '',
    photos,
    createdAt: data.createdAt ?? null,
    aiStatus: data.aiStatus ?? null,
    aiTags: data.aiTags ?? [],
    aiDescription: data.aiDescription ?? '',
    aiSearchTerms: data.aiSearchTerms ?? [],
    notes: Array.isArray(data.notes)
      ? data.notes
      : typeof data.notes === 'string' && data.notes.trim()
        ? [{ id: 'legacy', text: data.notes.trim(), createdAt: 0 }]
        : [],
    deletedAt: data.deletedAt ?? null,
    isPrivate: data.isPrivate ?? false,
    lastModifiedAt: data.lastModifiedAt ?? null,
    lastModifiedBy: data.lastModifiedBy ?? null,
    lastModifiedByName: data.lastModifiedByName ?? null,
  };
}

export default function ContainerScreen({ user, containerId }: Props) {
  const [container, setContainer] = useState<Container | null>(null);
  const [notFound, setNotFound]   = useState(false);
  const [lbIndex, setLbIndex]     = useState(0);
  const [lbOpen, setLbOpen]       = useState(false);
  const [adding, setAdding]       = useState(false);
  const updatePhotoInputRef       = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return onSnapshot(
      doc(db, `users/${user.uid}/containers/${containerId}`),
      (snap) => {
        if (!snap.exists()) { setNotFound(true); return; }
        setContainer(mapContainer(snap));
      }
    );
  }, [user.uid, containerId]);

  async function handleDeletePhoto() {
    if (!container || !auth.currentUser) return;
    await auth.currentUser.getIdToken(true);
    const activePhotos = container.photos.filter(p => !p.deletedAt);
    const photo = activePhotos[lbIndex];
    if (!photo) return;
    const updatedPhotos = container.photos.map(p =>
      p.storagePath === photo.storagePath ? { ...p, deletedAt: Date.now() } : p
    );
    try {
      await updateDoc(doc(db, `users/${user.uid}/containers/${containerId}`), {
        photos: updatedPhotos,
      });
    } catch { return; }
    const remaining = activePhotos.length - 1;
    if (remaining <= 0) setLbOpen(false);
    else setLbIndex(i => Math.min(i, remaining - 1));
  }

  async function handleAddNote(cId: string, text: string) {
    if (!auth.currentUser) return;
    await auth.currentUser.getIdToken(true);
    const note: ContainerNote = { id: crypto.randomUUID(), text, createdAt: Date.now() };
    await updateDoc(doc(db, `users/${user.uid}/containers/${cId}`), { notes: arrayUnion(note) });
  }

  async function handleDeleteNote(cId: string, noteId: string) {
    if (!container || !auth.currentUser) return;
    await auth.currentUser.getIdToken(true);
    const updated = container.notes.map(n => n.id === noteId ? { ...n, deletedAt: Date.now() } : n);
    await updateDoc(doc(db, `users/${user.uid}/containers/${cId}`), { notes: updated });
  }

  async function handleAddPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!file || !auth.currentUser) return;
    setAdding(true);
    try {
      await auth.currentUser.getIdToken(true);
      const compressed = await imageCompression(file, {
        maxWidthOrHeight: 1600, initialQuality: 0.85, useWebWorker: false, maxSizeMB: 0.5,
      });
      const storagePath = `users/${user.uid}/containers/${containerId}/photos/${Date.now()}.jpg`;
      await uploadBytes(ref(storage, storagePath), compressed);
      const photoUrl  = await getDownloadURL(ref(storage, storagePath));
      const photoItem: PhotoItem = { id: crypto.randomUUID(), url: photoUrl, storagePath, description: '', createdAt: Date.now(), moderationStatus: 'pending', moderationCheckedAt: null, moderationProvider: null, moderationReason: null };
      const updatedPhotos = [...(container?.photos ?? []), photoItem];
      await updateDoc(doc(db, `users/${user.uid}/containers/${containerId}`), {
        photos: updatedPhotos,
        photoUrls: arrayUnion(photoUrl),
        photoStoragePaths: arrayUnion(storagePath),
      });
    } catch (e: any) {
      console.error('Add photo failed:', e?.message ?? e);
    } finally {
      setAdding(false);
    }
  }

  const header = (
    <header className="cs-header">
      <button className="cs-back" onClick={() => navigate('/')}>← Back</button>
      <img src={logoMark} alt="Vowvy" className="cs-logo" />
    </header>
  );

  if (notFound) return (
    <div className="container-screen">{header}<p className="cs-empty">Container not found.</p></div>
  );
  if (!container) return (
    <div className="container-screen">{header}<p className="cs-empty">Loading…</p></div>
  );

  const activePhotos = container.photos.filter(p => !p.deletedAt);

  return (
    <div className="container-screen">
      {header}
      <main className="cs-main">
        <h1 className="cs-name">{container.name}</h1>
        <p className="cs-location">{container.location}</p>

        {activePhotos.length > 0 && (
          <div className="cs-photos">
            {activePhotos.map((photo, i) => (
              <div key={photo.id} className="cs-photo-wrap" onClick={() => { setLbIndex(i); setLbOpen(true); }}>
                <ThumbImage storagePath={photo.storagePath} alt={`Photo ${i + 1}`} />
              </div>
            ))}
          </div>
        )}

        <div className="cs-add-photo-row">
          <button
            className="cs-add-photo-btn"
            disabled={adding}
            onClick={() => updatePhotoInputRef.current?.click()}
          >
            {adding ? 'Adding…' : 'Add Photo'}
          </button>
          <input type="file" ref={updatePhotoInputRef} className="photo-input-hidden" onChange={handleAddPhoto} />
        </div>

        {container.aiStatus === 'processing' && (
          <p className="cs-ai-processing">Analyzing contents…</p>
        )}
        {container.aiDescription && (
          <p className="cs-ai-desc">{container.aiDescription}</p>
        )}
        {container.aiTags.length > 0 && (
          <div className="cs-ai-tags">
            {container.aiTags.map(tag => (
              <span key={tag} className="ai-tag">{tag}</span>
            ))}
          </div>
        )}

        <ContainerNotes
          containerId={container.id}
          notes={container.notes.filter(n => !n.deletedAt)}
          onAdd={handleAddNote}
          onDelete={handleDeleteNote}
        />
      </main>

      {lbOpen && activePhotos.length > 0 && (
        <div className="cs-lb-backdrop" onClick={() => setLbOpen(false)}>
          <div className="cs-lb-toolbar" onClick={e => e.stopPropagation()}>
            <button className="cs-lb-delete" onClick={handleDeletePhoto}>Delete</button>
            <button className="cs-lb-close" onClick={() => setLbOpen(false)}>✕</button>
          </div>
          <div className="cs-lb-img" onClick={e => e.stopPropagation()}>
            <ThumbImage storagePath={activePhotos[lbIndex].storagePath} alt={`Photo ${lbIndex + 1}`} />
          </div>
          {activePhotos.length > 1 && (
            <div className="cs-lb-nav" onClick={e => e.stopPropagation()}>
              <button
                className="cs-lb-prev"
                onClick={() => setLbIndex(i => Math.max(0, i - 1))}
                disabled={lbIndex === 0}
              >‹</button>
              <span className="cs-lb-counter">{lbIndex + 1} / {activePhotos.length}</span>
              <button
                className="cs-lb-next"
                onClick={() => setLbIndex(i => Math.min(activePhotos.length - 1, i + 1))}
                disabled={lbIndex === activePhotos.length - 1}
              >›</button>
            </div>
          )}
          {(() => {
            const photo = activePhotos[lbIndex];
            if (photo.aiStatus === 'processing') {
              return (
                <div className="cs-lb-ai" onClick={e => e.stopPropagation()}>
                  <span className="cs-lb-ai-analyzing">Analyzing…</span>
                </div>
              );
            }
            if (!photo.aiDescription && (!photo.aiTags || photo.aiTags.length === 0)) return null;
            return (
              <div className="cs-lb-ai" onClick={e => e.stopPropagation()}>
                {photo.aiDescription && <p className="cs-lb-ai-desc">{photo.aiDescription}</p>}
                {photo.aiTags && photo.aiTags.length > 0 && (
                  <div className="cs-lb-ai-tags">
                    {photo.aiTags.map((tag, i) => <span key={i} className="cs-lb-ai-tag">{tag}</span>)}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
