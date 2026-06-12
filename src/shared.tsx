import { useState, useEffect } from 'react';
import { auth } from './firebase';

export const PROXY_BASE = 'https://us-central1-vowvy-1ba5f.cloudfunctions.net/proxyImage';

export interface PhotoItem {
  id: string;
  url: string;
  storagePath: string;
  description: string;
  createdAt: number;
  deletedAt?: number;
  addedBy?: string;
  addedByName?: string;
}

export interface ContainerNote {
  id: string;
  text: string;
  createdAt: number;
  deletedAt?: number;
}

export function ThumbImage({ storagePath, alt }: { storagePath: string; alt: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed]   = useState(false);
  const [err, setErr]         = useState('');

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    const proxyUrl = `${PROXY_BASE}?path=${encodeURIComponent(storagePath)}`;
    auth.currentUser?.getIdToken()
      .then(token => {
        if (cancelled) return Promise.reject(new Error('cancelled'));
        return fetch(proxyUrl, { headers: { Authorization: `Bearer ${token}` } });
      })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then(blob => {
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) { URL.revokeObjectURL(objectUrl); return; }
        setBlobUrl(objectUrl);
      })
      .catch(e => {
        if (cancelled || e.message === 'cancelled') return;
        setErr(e.message ?? 'fetch error');
        setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [storagePath]);

  if (failed) {
    return (
      <div className="container-thumb" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 4, background: '#fee' }}>
        <span style={{ color: 'red', fontSize: 9, fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.3 }}>
          ERR [{err}] {storagePath.slice(0, 100)}
        </span>
      </div>
    );
  }
  if (!blobUrl) return <div className="container-thumb" style={{ background: '#f0ece8' }} />;
  return <img src={blobUrl} alt={alt} className="container-thumb" />;
}

export function formatNoteDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}

// Pure presentational component — parent is responsible for filtering deleted notes
// and for all Firestore writes (enables soft delete in callers).
export function ContainerNotes({ containerId, notes, onAdd, onDelete }: {
  containerId: string;
  notes: ContainerNote[];
  onAdd: (containerId: string, text: string) => Promise<void>;
  onDelete: (containerId: string, noteId: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const canSave = draft.trim().length > 0;

  async function handleSave() {
    if (!canSave) return;
    await onAdd(containerId, draft.trim());
    setDraft('');
  }

  return (
    <div className="notes-wrap">
      {notes.map(note => (
        <div key={note.id} className="note-item">
          <span className="note-text">
            {note.createdAt > 0 && <span className="note-date">{formatNoteDate(note.createdAt)} — </span>}
            {note.text}
          </span>
          <button className="note-delete-btn" onClick={() => onDelete(containerId, note.id)}>✕</button>
        </div>
      ))}
      <div className="notes-input-row">
        <input
          type="text"
          className="notes-input"
          value={draft}
          placeholder="Add a note…"
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && canSave && handleSave()}
        />
        {canSave && <button className="notes-save-btn" onClick={handleSave}>Save</button>}
      </div>
    </div>
  );
}
