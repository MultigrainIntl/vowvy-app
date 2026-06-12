import { useState, useEffect } from 'react';
import { type User } from 'firebase/auth';
import { collection, doc, getDoc, query, orderBy, onSnapshot, updateDoc, deleteDoc } from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { auth, db, storage } from './firebase';
import { ThumbImage } from './shared';
import type { PhotoItem, ContainerNote } from './shared';
import { navigate } from './nav';
import logoMark from './assets/logo-mark.svg';
import './TrashScreen.css';

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
function isRecent(ts: number) { return Date.now() - ts < THIRTY_DAYS; }

interface TrashedContainer {
  id: string;
  name: string;
  location: string;
  deletedAt: number;
  photos: PhotoItem[];
  notes: ContainerNote[];
}

interface TrashedPhoto {
  containerId: string;
  containerName: string;
  photo: PhotoItem;
}

interface TrashedNote {
  containerId: string;
  containerName: string;
  note: ContainerNote;
}

type FeedbackLabel = 'Restored' | 'Deleted' | 'Error — try again';

interface Props { user: User }

export default function TrashScreen({ user }: Props) {
  const [trashedContainers, setTrashedContainers] = useState<TrashedContainer[]>([]);
  const [trashedPhotos,     setTrashedPhotos]     = useState<TrashedPhoto[]>([]);
  const [trashedNotes,      setTrashedNotes]       = useState<TrashedNote[]>([]);
  const [feedback,  setFeedback]  = useState<Record<string, FeedbackLabel>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const q = query(
      collection(db, `users/${user.uid}/containers`),
      orderBy('createdAt', 'desc'),
    );
    return onSnapshot(q, snap => {
      const containers: TrashedContainer[] = [];
      const photos:     TrashedPhoto[]     = [];
      const notes:      TrashedNote[]       = [];

      for (const d of snap.docs) {
        const data = d.data() as any;
        const rawPhotos: PhotoItem[]     = data.photos   ?? [];
        const rawNotes:  ContainerNote[] = Array.isArray(data.notes) ? data.notes : [];

        if (data.deletedAt && isRecent(data.deletedAt)) {
          containers.push({
            id: d.id,
            name: data.name ?? '',
            location: data.location ?? '',
            deletedAt: data.deletedAt,
            photos: rawPhotos,
            notes:  rawNotes,
          });
          continue;
        }

        for (const p of rawPhotos) {
          if (p.deletedAt && isRecent(p.deletedAt)) {
            photos.push({ containerId: d.id, containerName: data.name ?? '', photo: p });
          }
        }
        for (const n of rawNotes) {
          if (n.deletedAt && isRecent(n.deletedAt)) {
            notes.push({ containerId: d.id, containerName: data.name ?? '', note: n });
          }
        }
      }

      setTrashedContainers(containers);
      setTrashedPhotos(photos);
      setTrashedNotes(notes);
    });
  }, [user.uid]);

  // Immediately show feedback, fire write, dismiss after 1.5s on success or revert on failure.
  function act(key: string, label: FeedbackLabel, write: () => Promise<void>) {
    setFeedback(f => ({ ...f, [key]: label }));
    write().then(() => {
      setTimeout(() => setDismissed(d => new Set([...d, key])), 1500);
    }).catch(() => {
      setFeedback(f => ({ ...f, [key]: 'Error — try again' }));
      setTimeout(() => setFeedback(f => { const n = { ...f }; delete n[key]; return n; }), 3000);
    });
  }

  function restoreContainer(c: TrashedContainer) {
    act(c.id, 'Restored', async () => {
      if (!auth.currentUser) throw new Error('Not signed in');
      await auth.currentUser.getIdToken(true);
      await updateDoc(doc(db, `users/${user.uid}/containers/${c.id}`), { deletedAt: null });
    });
  }

  function deleteContainerForever(c: TrashedContainer) {
    if (!window.confirm(`Permanently delete "${c.name}" and all its photos? This cannot be undone.`)) return;
    act(c.id, 'Deleted', async () => {
      if (!auth.currentUser) throw new Error('Not signed in');
      await auth.currentUser.getIdToken(true);
      await Promise.all(c.photos.map(p => deleteObject(ref(storage, p.storagePath)).catch(() => {})));
      await deleteDoc(doc(db, `users/${user.uid}/containers/${c.id}`));
    });
  }

  function restorePhoto(tp: TrashedPhoto) {
    const key = tp.photo.storagePath;
    act(key, 'Restored', async () => {
      if (!auth.currentUser) throw new Error('Not signed in');
      await auth.currentUser.getIdToken(true);
      const containerDoc = await getDoc(doc(db, `users/${user.uid}/containers/${tp.containerId}`));
      const data = containerDoc.data() as any;
      const photos: PhotoItem[] = data?.photos ?? [];
      const updated = photos.map(p => {
        if (p.storagePath !== tp.photo.storagePath) return p;
        const { deletedAt: _removed, ...rest } = p;
        return rest as PhotoItem;
      });
      const updates: any = { photos: updated };
      if (data?.deletedAt) updates.deletedAt = null;
      await updateDoc(doc(db, `users/${user.uid}/containers/${tp.containerId}`), updates);
    });
  }

  function deletePhotoForever(tp: TrashedPhoto) {
    if (!window.confirm(`Permanently delete this photo from "${tp.containerName}"?`)) return;
    const key = tp.photo.storagePath;
    act(key, 'Deleted', async () => {
      if (!auth.currentUser) throw new Error('Not signed in');
      await auth.currentUser.getIdToken(true);
      const containerDoc = await getDoc(doc(db, `users/${user.uid}/containers/${tp.containerId}`));
      const data = containerDoc.data() as any;
      const photos: PhotoItem[] = (data?.photos ?? []).filter(
        (p: PhotoItem) => p.storagePath !== tp.photo.storagePath
      );
      await updateDoc(doc(db, `users/${user.uid}/containers/${tp.containerId}`), {
        photos,
        photoUrls: photos.filter(p => !p.deletedAt).map(p => p.url),
        photoStoragePaths: photos.filter(p => !p.deletedAt).map(p => p.storagePath),
      });
      await deleteObject(ref(storage, tp.photo.storagePath)).catch(() => {});
    });
  }

  function restoreNote(tn: TrashedNote) {
    act(tn.note.id, 'Restored', async () => {
      if (!auth.currentUser) throw new Error('Not signed in');
      await auth.currentUser.getIdToken(true);
      const containerDoc = await getDoc(doc(db, `users/${user.uid}/containers/${tn.containerId}`));
      const data = containerDoc.data() as any;
      const notes: ContainerNote[] = data?.notes ?? [];
      const updated = notes.map(n => {
        if (n.id !== tn.note.id) return n;
        const { deletedAt: _removed, ...rest } = n;
        return rest as ContainerNote;
      });
      await updateDoc(doc(db, `users/${user.uid}/containers/${tn.containerId}`), { notes: updated });
    });
  }

  function deleteNoteForever(tn: TrashedNote) {
    if (!window.confirm(`Permanently delete this note from "${tn.containerName}"?`)) return;
    act(tn.note.id, 'Deleted', async () => {
      if (!auth.currentUser) throw new Error('Not signed in');
      await auth.currentUser.getIdToken(true);
      const containerDoc = await getDoc(doc(db, `users/${user.uid}/containers/${tn.containerId}`));
      const data = containerDoc.data() as any;
      const notes: ContainerNote[] = (data?.notes ?? []).filter(
        (n: ContainerNote) => n.id !== tn.note.id
      );
      await updateDoc(doc(db, `users/${user.uid}/containers/${tn.containerId}`), { notes });
    });
  }

  function renderActions(key: string, onRestore: () => void, onDelete: () => void) {
    const fb = feedback[key];
    if (fb) {
      return (
        <span className={`trash-feedback ${fb === 'Restored' ? 'feedback-restored' : fb === 'Deleted' ? 'feedback-deleted' : 'feedback-error'}`}>
          {fb}
        </span>
      );
    }
    return (
      <>
        <button className="trash-restore-btn" onClick={onRestore}>Restore</button>
        <button className="trash-delete-btn" onClick={onDelete}>Delete Forever</button>
      </>
    );
  }

  const visibleContainers = trashedContainers.filter(c => !dismissed.has(c.id));
  const visiblePhotos     = trashedPhotos.filter(tp => !dismissed.has(tp.photo.storagePath));
  const visibleNotes      = trashedNotes.filter(tn => !dismissed.has(tn.note.id));
  const isEmpty = visibleContainers.length === 0 && visiblePhotos.length === 0 && visibleNotes.length === 0;

  return (
    <div className="trash-screen">
      <header className="trash-header">
        <button className="trash-back" onClick={() => navigate('/')}>← Back</button>
        <img src={logoMark} alt="Vowvy" className="trash-logo" />
      </header>

      <main className="trash-main">
        <h1 className="trash-title">Recently Deleted</h1>
        <p className="trash-subtitle">Items deleted within the last 30 days</p>

        {isEmpty && <p className="trash-empty">Nothing in Recently Deleted.</p>}

        {visibleContainers.length > 0 && (
          <section className="trash-section">
            <h2 className="trash-section-title">Containers</h2>
            {visibleContainers.map(c => (
              <div key={c.id} className="trash-item">
                <div className="trash-item-info">
                  <div className="trash-item-name">{c.name}</div>
                  <div className="trash-item-meta">
                    {c.location} · {c.photos.length} photo{c.photos.length !== 1 ? 's' : ''}
                  </div>
                </div>
                <div className="trash-item-actions">
                  {renderActions(c.id, () => restoreContainer(c), () => deleteContainerForever(c))}
                </div>
              </div>
            ))}
          </section>
        )}

        {visiblePhotos.length > 0 && (
          <section className="trash-section">
            <h2 className="trash-section-title">Photos</h2>
            {visiblePhotos.map(tp => (
              <div key={tp.photo.storagePath} className="trash-item">
                <div className="trash-thumb">
                  <ThumbImage storagePath={tp.photo.storagePath} alt={tp.photo.description || 'Photo'} />
                </div>
                <div className="trash-item-info">
                  <div className="trash-item-name">{tp.photo.description || 'Photo'}</div>
                  <div className="trash-item-meta">from {tp.containerName}</div>
                </div>
                <div className="trash-item-actions">
                  {renderActions(tp.photo.storagePath, () => restorePhoto(tp), () => deletePhotoForever(tp))}
                </div>
              </div>
            ))}
          </section>
        )}

        {visibleNotes.length > 0 && (
          <section className="trash-section">
            <h2 className="trash-section-title">Notes</h2>
            {visibleNotes.map(tn => (
              <div key={tn.note.id} className="trash-item">
                <div className="trash-item-info">
                  <div className="trash-item-name trash-item-note-text">{tn.note.text}</div>
                  <div className="trash-item-meta">from {tn.containerName}</div>
                </div>
                <div className="trash-item-actions">
                  {renderActions(tn.note.id, () => restoreNote(tn), () => deleteNoteForever(tn))}
                </div>
              </div>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
