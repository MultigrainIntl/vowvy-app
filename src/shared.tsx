import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { auth } from './firebase';
import { firebaseConfig, proxyBase } from './environment';
import { stagingDirectPhotoUrl } from './staging-photo';

export const PROXY_BASE = proxyBase;

export interface PhotoItem {
  id: string;
  url: string;
  storagePath: string;
  description: string;
  createdAt: number;
  deletedAt?: number;
  addedBy?: string;
  addedByName?: string;
  moderationStatus?: 'pending' | 'approved' | 'flagged' | 'blocked';
  moderationCheckedAt?: number | null;
  moderationProvider?: string | null;
  moderationReason?: string | null;
  aiDescription?: string;
  aiTags?: string[];
  aiObjects?: string[];
  aiStatus?: 'processing' | 'done' | 'error';
  aiError?: string | null;
  aiRetryRequestedAt?: number;}

export interface ContainerNote {
  id: string;
  text: string;
  createdAt: number;
  deletedAt?: number;
}

export function ThumbImage({ storagePath, url, alt }: { storagePath: string; url?: string; alt: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed]   = useState(false);
  const [err, setErr]         = useState('');
  const directUrl = stagingDirectPhotoUrl(firebaseConfig.projectId, url);

  useEffect(() => {
    if (directUrl) {
      setBlobUrl(directUrl);
      setFailed(false);
      return;
    }
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
  }, [storagePath, directUrl]);

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

export function LightboxImage({ storagePath, url, alt }: { storagePath: string; url?: string; alt: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed]   = useState(false);
  const directUrl = stagingDirectPhotoUrl(firebaseConfig.projectId, url);

  useEffect(() => {
    if (directUrl) {
      setBlobUrl(directUrl);
      setFailed(false);
      return;
    }
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
        setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [storagePath, directUrl]);

  if (failed) return <div className="lightbox-img" style={{ background: '#fee', display: 'flex', alignItems: 'center', justifyContent: 'center' }} />;
  if (!blobUrl) return <div className="lightbox-img" style={{ background: '#f0ece8' }} />;
  return <img src={blobUrl} alt={alt} className="lightbox-img" />;
}

export function formatNoteDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(i18next.language || 'en', opts);
}

// Pure presentational component — parent is responsible for filtering deleted notes
// and for all Firestore writes (enables soft delete in callers).
export function ContainerNotes({ containerId, notes, onAdd, onEdit, onDelete, canDelete = true, canEdit = false }: {
  containerId: string;
  notes: ContainerNote[];
  onAdd: (containerId: string, text: string) => Promise<void>;
  onEdit?: (containerId: string, noteId: string, text: string) => Promise<void>;
  onDelete: (containerId: string, noteId: string) => Promise<void>;
  canDelete?: boolean;
  canEdit?: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
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
          {editingId === note.id ? (
            <input
              className="notes-input"
              value={editDraft}
              autoFocus
              onChange={event => setEditDraft(event.target.value)}
              onKeyDown={async event => {
                if (event.key === 'Escape') setEditingId(null);
                if (
                  event.key === 'Enter' &&
                  editDraft.trim() &&
                  onEdit
                ) {
                  await onEdit(containerId, note.id, editDraft.trim());
                  setEditingId(null);
                }
              }}
            />
          ) : (
            <span className="note-text">
              {note.createdAt > 0 && <span className="note-date">{formatNoteDate(note.createdAt)} — </span>}
              {note.text}
            </span>
          )}
          {editingId === note.id && onEdit && (
            <button
              className="notes-save-btn"
              disabled={!editDraft.trim()}
              onClick={async () => {
                await onEdit(containerId, note.id, editDraft.trim());
                setEditingId(null);
              }}
            >
              {t('shared.save')}
            </button>
          )}
          {canEdit && editingId !== note.id && (
            <button
              className="note-delete-btn"
              onClick={() => {
                setEditingId(note.id);
                setEditDraft(note.text);
              }}
            >
              Edit
            </button>
          )}
          {canDelete && (
            <button className="note-delete-btn" onClick={() => onDelete(containerId, note.id)}>✕</button>
          )}
        </div>
      ))}
      <div className="notes-input-row">
        <input
          type="text"
          className="notes-input"
          value={draft}
          placeholder={t('shared.addNote')}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && canSave && handleSave()}
        />
        {canSave && <button className="notes-save-btn" onClick={handleSave}>{t('shared.save')}</button>}
      </div>
    </div>
  );
}
