import { useState, useEffect, useRef } from 'react';
import { signOut, type User } from 'firebase/auth';
import {
  collection, doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, onSnapshot,
  query, orderBy, where, arrayUnion, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import imageCompression from 'browser-image-compression';
import QRCode from 'qrcode';
import { auth, db, storage, functions } from './firebase';
import { ThumbImage, ContainerNotes } from './shared';
import type { ContainerNote, PhotoItem } from './shared';
import { navigate } from './nav';
import logoMark from './assets/logo-mark.svg';
import './MainScreen.css';
import { subscribeToLocations, createLocation, getLocationPath, type Location } from './locations';

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
function isRecent(ts: number) { return Date.now() - ts < THIRTY_DAYS; }

interface Container {
  id: string;
  location: string;
  locationId: string | null;
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

function QRPrintModal({ container, onClose }: { container: Container; onClose: () => void }) {
  const [tagline, setTagline] = useState("What's in your box?");
  const [svgString, setSvgString] = useState('');

  useEffect(() => {
    const url = `https://app.vowvy.com/container/${container.id}`;
    QRCode.toString(url, { type: 'svg', width: 200, margin: 1 })
      .then(setSvgString)
      .catch(() => {});
  }, [container.id]);

  return (
    <div className="qr-print-overlay">
      <div className="qr-print-controls">
        <button className="qr-btn-print" onClick={() => window.print()}>Print</button>
        <button className="qr-btn-close" onClick={onClose}>Close</button>
      </div>
      <div className="qr-print-card">
        <img src={logoMark} alt="Vowvy" className="qr-logo" />
        {svgString && (
          <div className="qr-code" dangerouslySetInnerHTML={{ __html: svgString }} />
        )}
        <div className="qr-container-name">{container.name}</div>
        <div className="qr-location">{container.location}</div>
        <input
          className="qr-tagline-input"
          value={tagline}
          onChange={e => setTagline(e.target.value)}
        />
        <div className="qr-url">app.vowvy.com/container/{container.id}</div>
      </div>
    </div>
  );
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

function mapContainer(d: any): Container {
  const data = d.data ? d.data() : d;
  const rawPhotos: any[] = data.photos ?? [];
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
    id: d.id,
    location: data.location ?? '',
    locationId: data.locationId ?? null,
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

interface Props { user: User; initialOwnerUid?: string | null }

export default function MainScreen({ user, initialOwnerUid }: Props) {
  const [selectedLocationId, setSelectedLocationId]   = useState('');
  const [selectedParentId, setSelectedParentId]       = useState<string | null>(null);
  const [newLocationName, setNewLocationName]         = useState('');
  const [selectedContainerId, setSelectedContainerId] = useState('');
  const [newContainerName, setNewContainerName]       = useState('');
  const [photo, setPhoto]                             = useState<File | null>(null);
  const [extraPhotos, setExtraPhotos]                 = useState<File[]>([]);
  const [preview, setPreview]                         = useState<string | null>(null);
  const [saving, setSaving]                           = useState(false);
  const [saved, setSaved]                             = useState(false);
  const [saveError, setSaveError]                     = useState('');
  const [containers, setContainers]                   = useState<Container[]>([]);
  const [showIOSModal, setShowIOSModal]               = useState(false);
  const [copied, setCopied]                           = useState(false);
  const [lightboxItems, setLightboxItems]             = useState<PhotoItem[] | null>(null);
  const [lightboxContainerId, setLightboxContainerId] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex]             = useState(0);
  const [lightboxDescDraft, setLightboxDescDraft]     = useState('');
  const [updatingContainerId, setUpdatingContainerId] = useState<string | null>(null);
  const [continuousCapture, setContinuousCapture] = useState(false);
  const [captureContainerId, setCaptureContainerId] = useState<string | null>(null);
  const [captureQueue, setCaptureQueue] = useState<File[]>([]);
  const [searchQuery, setSearchQuery]                 = useState('');
  const [printContainer, setPrintContainer]           = useState<Container | null>(null);
  const [moveSource, setMoveSource] = useState<{ containerId: string; mode: 'container' | 'photo'; photoId?: string } | null>(null);
  const [viewingOwnerUid, setViewingOwnerUid]         = useState(initialOwnerUid ?? user.uid);
  const [sharedInventories, setSharedInventories]     = useState<{ ownerUid: string; ownerName: string }[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationsLoaded, setLocationsLoaded]   = useState(false);
  const [containersLoaded, setContainersLoaded] = useState(false);
  const [showFirstLocationInput, setShowFirstLocationInput] = useState(false);
  const [firstLocationName, setFirstLocationName]           = useState('');
  const [creatingFirstLocation, setCreatingFirstLocation]   = useState(false);
  const [showHowItWorks, setShowHowItWorks]                 = useState(false);
  const [collaborators, setCollaborators]     = useState<{ uid: string; displayName: string; email: string; inviteToken: string }[]>([]);
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [inviteLink, setInviteLink]           = useState<string | null>(null);
  const [inviteCopied, setInviteCopied]       = useState(false);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [inviteExpiry, setInviteExpiry] = useState<number | null>(7); // days, null = no expiry
  const updatePhotoInputRef = useRef<HTMLInputElement>(null);
  const scrollRef           = useRef<HTMLDivElement>(null);

  // Sync description draft when lightbox photo changes
  useEffect(() => {
    if (lightboxItems && lightboxItems[lightboxIndex]) {
      setLightboxDescDraft(lightboxItems[lightboxIndex].description ?? '');
    }
  }, [lightboxIndex, lightboxItems]);

  // Listen for shared inventories (invites accepted by this user)
  useEffect(() => {
    const q = query(collection(db, 'invites'), where('acceptedByUid', '==', user.uid));
    return onSnapshot(q, snap => {
      setSharedInventories(
        snap.docs
          .filter(d => d.data().status === 'active')
          .map(d => ({ ownerUid: d.data().ownerUid, ownerName: d.data().ownerDisplayName }))
      );
    });
  }, [user.uid]);

  // Listen for locations — use viewingOwnerUid so collaborators see the owner's locations
  useEffect(() => {
    setLocationsLoaded(false);
    return subscribeToLocations(viewingOwnerUid, locs => {
      setLocations(locs);
      setLocationsLoaded(true);
    });
  }, [viewingOwnerUid]);

  // Listen for people who have access to this user's inventory
  useEffect(() => {
    return onSnapshot(collection(db, `users/${user.uid}/collaborators`), snap => {
      setCollaborators(
        snap.docs
          .filter(d => d.data().status === 'active')
          .map(d => ({
            uid: d.id,
            displayName: d.data().displayName ?? d.data().email ?? 'Collaborator',
            email: d.data().email ?? '',
            inviteToken: d.data().inviteToken ?? '',
          }))
      );
    });
  }, [user.uid]);

  // Fall back to own inventory if a shared one was revoked
  useEffect(() => {
    if (viewingOwnerUid !== user.uid && sharedInventories.length > 0) {
      if (!sharedInventories.some(s => s.ownerUid === viewingOwnerUid)) {
        setViewingOwnerUid(user.uid);
      }
    }
  }, [sharedInventories, viewingOwnerUid, user.uid]);

  // Container snapshot
  useEffect(() => {
    const q = query(
      collection(db, `users/${viewingOwnerUid}/containers`),
      orderBy('createdAt', 'desc'),
    );
    return onSnapshot(q, snap => {
      setContainers(snap.docs.map(mapContainer));
      setContainersLoaded(true);
    });
  }, [viewingOwnerUid]);

  // Derived state
  const activeContainers = containers.filter(c => !c.deletedAt);

  // Current display path for a container: derive from locationId so renames in the
  // locations collection show immediately; fall back to the stored legacy text for
  // containers without a locationId (or whose location was deleted).
  const displayLocation = (c: Container) =>
    c.locationId ? (getLocationPath(c.locationId, locations) || c.location) : c.location;

  // Brand-new user: own inventory, both snapshots loaded, and nothing exists yet
  // (containers.length includes trash on purpose — someone with trashed data is not new).
  const isBrandNewUser =
    viewingOwnerUid === user.uid &&
    locationsLoaded && containersLoaded &&
    locations.length === 0 && containers.length === 0;

  // Just created their first location, but no box/container yet: nudge the next step.
  const showFirstBoxHint =
    viewingOwnerUid === user.uid &&
    locationsLoaded && containersLoaded &&
    locations.length > 0 && containers.length === 0;

  const trashedContainers = containers.filter(c => c.deletedAt && isRecent(c.deletedAt));
  const trashedPhotos     = containers.filter(c => !c.deletedAt)
    .flatMap(c => c.photos.filter(p => p.deletedAt && isRecent(p.deletedAt)));
  const trashedNotes      = containers.filter(c => !c.deletedAt)
    .flatMap(c => c.notes.filter(n => n.deletedAt && isRecent(n.deletedAt)));
  const trashCount = trashedContainers.length + trashedPhotos.length + trashedNotes.length;

  const containersAtLocation = activeContainers.filter(
    c => c.locationId === selectedLocationId || c.location === getLocationPath(selectedLocationId, locations)
  );
  const containerValid =
    selectedContainerId !== '' &&
    (selectedContainerId !== 'new' || newContainerName.trim() !== '');
  const canSave = Boolean(selectedLocationId && containerValid && photo) && !saving;

  async function handleCreateFirstLocation() {
    const name = firstLocationName.trim();
    if (!name || creatingFirstLocation) return;
    setCreatingFirstLocation(true);
    setSaveError('');
    try {
      const id = await createLocation(user.uid, name, null);
      // Pre-select the new location and open the "new box/container" input so the
      // next step (name a box, take a photo) is already teed up on the capture card.
      setSelectedLocationId(id);
      setSelectedContainerId('new');
      setFirstLocationName('');
      setShowFirstLocationInput(false);
    } catch {
      setSaveError('Could not create the location. Please try again.');
    } finally {
      setCreatingFirstLocation(false);
    }
  }

  async function handleCreateContainer() {
    if (!selectedLocationId || !newContainerName.trim()) return;
    setSaving(true);
    setSaveError('');
    try {
      let resolvedLocationId = selectedLocationId;
      let resolvedLocationName = '';
      if (selectedLocationId === 'new') {
        if (!newLocationName.trim()) { setSaveError('Please enter a location name.'); setSaving(false); return; }
        resolvedLocationId = await createLocation(user.uid, newLocationName.trim(), selectedParentId);
        resolvedLocationName = newLocationName.trim();
      } else {
        resolvedLocationName = getLocationPath(selectedLocationId, locations);
      }
      const containerRef = doc(collection(db, `users/${viewingOwnerUid}/containers`));
      await setDoc(containerRef, {
        location: resolvedLocationName,
        locationId: resolvedLocationId,
        name: newContainerName.trim(),
        photos: [],
        photoUrls: [],
        photoStoragePaths: [],
        createdAt: serverTimestamp(),
        deletedAt: null,
      });
      setSelectedLocationId(''); setNewLocationName(''); setSelectedContainerId('');
      setNewContainerName(''); setPhoto(null); setExtraPhotos([]); setPreview(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setSaveError('Failed to create container. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!photo) return;
    setSaving(true);
    setSaveError('');
    // Resolve location — create new one if needed
    let resolvedLocationId = selectedLocationId;
    let resolvedLocationName = '';
    if (selectedLocationId === 'new') {
      if (!newLocationName.trim()) { setSaveError('Please enter a location name.'); setSaving(false); return; }
      resolvedLocationId = await createLocation(user.uid, newLocationName.trim(), selectedParentId);
      resolvedLocationName = newLocationName.trim();
    } else {
      resolvedLocationName = getLocationPath(selectedLocationId, locations);
    }
    try {
      if (!auth.currentUser) { setSaveError('Session expired. Please sign in again.'); setSaving(false); return; }
      await auth.currentUser.getIdToken(true);

      const compressOpts = { maxWidthOrHeight: 1600, initialQuality: 0.85, useWebWorker: true, maxSizeMB: 0.5 };
      const allFiles = [await imageCompression(photo, compressOpts), ...await Promise.all(extraPhotos.map(f => imageCompression(f, compressOpts)))];

      const uploadPhoto = async (containerId: string, file: File): Promise<{ url: string; storagePath: string }> => {
        if (viewingOwnerUid !== user.uid) {
          const ab = await file.arrayBuffer();
          const b64 = btoa(new Uint8Array(ab).reduce((s, b) => s + String.fromCharCode(b), ''));
          const fn = httpsCallable<{ ownerUid: string; containerId: string; imageBase64: string; contentType: string }, { downloadURL: string; storagePath: string }>(functions, 'uploadCollaboratorPhoto');
          const r = await fn({ ownerUid: viewingOwnerUid, containerId, imageBase64: b64, contentType: 'image/jpeg' });
          return { url: r.data.downloadURL, storagePath: r.data.storagePath };
        }
        const storagePath = `users/${viewingOwnerUid}/containers/${containerId}/photos/${Date.now()}.jpg`;
        await uploadBytes(ref(storage, storagePath), file);
        return { url: await getDownloadURL(ref(storage, storagePath)), storagePath };
      };

      if (selectedContainerId === 'new') {
        const containerRef = doc(collection(db, `users/${viewingOwnerUid}/containers`));
        const { url: photoUrl, storagePath } = await uploadPhoto(containerRef.id, allFiles[0]);
        const photoItem: PhotoItem = { id: crypto.randomUUID(), url: photoUrl, storagePath, description: '', createdAt: Date.now(), addedBy: user.uid, addedByName: user.displayName ?? user.email?.split('@')[0] ?? 'Someone' };
        await setDoc(containerRef, {
          location: resolvedLocationName,
          locationId: resolvedLocationId,
          name: newContainerName.trim(),
          photos: [photoItem],
          photoUrls: [photoUrl],
          photoStoragePaths: [storagePath],
          createdAt: serverTimestamp(),
          deletedAt: null,
          lastModifiedAt: serverTimestamp(),
          lastModifiedBy: user.uid,
          lastModifiedByName: user.displayName ?? user.email?.split('@')[0] ?? 'Someone',
        });
      } else {
        const { url: photoUrl, storagePath } = await uploadPhoto(selectedContainerId, allFiles[0]);
        const photoItem: PhotoItem = { id: crypto.randomUUID(), url: photoUrl, storagePath, description: '', createdAt: Date.now(), addedBy: user.uid, addedByName: user.displayName ?? user.email?.split('@')[0] ?? 'Someone' };
        const existing = containers.find(c => c.id === selectedContainerId);
        const updatedPhotos = [...(existing?.photos ?? []), photoItem];
        await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${selectedContainerId}`), {
          photos: updatedPhotos,
          photoUrls: arrayUnion(photoUrl),
          photoStoragePaths: arrayUnion(storagePath),
          lastModifiedAt: serverTimestamp(),
          lastModifiedBy: user.uid,
          lastModifiedByName: user.displayName ?? user.email?.split('@')[0] ?? 'Someone',
        });
      }

      if (preview) URL.revokeObjectURL(preview);
      setPhoto(null); setExtraPhotos([]); setPreview(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      console.error('[handleSave] code:', err?.code, '| message:', err?.message, '| full:', err);
      setSaveError('Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdatePhoto(e: React.ChangeEvent<HTMLInputElement>, overrideContainerId?: string) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = '';
    const id = overrideContainerId ?? updatingContainerId;
    if (!file || !id) return;
    setUpdatingContainerId(null);
    setSaving(true);
    setSaveError('');
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 15000));
    try {
      await Promise.race([
        (async () => {
          if (!auth.currentUser) { setSaveError('Session expired. Please sign in again.'); return; }
          await auth.currentUser.getIdToken(true);
          console.log('Starting compression');
          const compressed = await imageCompression(file, {
            maxWidthOrHeight: 1600, initialQuality: 0.85, useWebWorker: false, maxSizeMB: 0.5,
          });
          console.log('Compression done');
          let photoUrl: string;
          let storagePath: string;
          if (viewingOwnerUid !== user.uid) {
            console.log('Starting collaborator upload');
            const ab = await compressed.arrayBuffer();
            const b64 = btoa(new Uint8Array(ab).reduce((s, b) => s + String.fromCharCode(b), ''));
            const fn = httpsCallable<{ ownerUid: string; containerId: string; imageBase64: string; contentType: string }, { downloadURL: string; storagePath: string }>(functions, 'uploadCollaboratorPhoto');
            const r = await fn({ ownerUid: viewingOwnerUid, containerId: id, imageBase64: b64, contentType: 'image/jpeg' });
            photoUrl = r.data.downloadURL;
            storagePath = r.data.storagePath;
          } else {
            storagePath = `users/${viewingOwnerUid}/containers/${id}/photos/${Date.now()}.jpg`;
            console.log('Starting upload');
            await uploadBytes(ref(storage, storagePath), compressed);
            console.log('Upload done');
            photoUrl = await getDownloadURL(ref(storage, storagePath));
          }
          const photoItem: PhotoItem = { id: crypto.randomUUID(), url: photoUrl, storagePath, description: '', createdAt: Date.now(), addedBy: user.uid, addedByName: user.displayName ?? user.email?.split('@')[0] ?? 'Someone' };
          const existing = containers.find(c => c.id === id);
          const updatedPhotos = [...(existing?.photos ?? []), photoItem];
          await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${id}`), {
            photos: updatedPhotos,
            photoUrls: arrayUnion(photoUrl),
            photoStoragePaths: arrayUnion(storagePath),
            lastModifiedAt: serverTimestamp(),
            lastModifiedBy: user.uid,
            lastModifiedByName: user.displayName ?? user.email?.split('@')[0] ?? 'Someone',
          });
          // Re-trigger camera if in continuous capture mode
          if (continuousCapture) {
            setUpdatingContainerId(id);
            setTimeout(() => updatePhotoInputRef.current?.click(), 300);
          }
        })(),
        timeout,
      ]);
    } catch (e: any) {
      const msg = e?.message ?? e?.code ?? 'unknown error';
      setSaveError(msg === 'TIMEOUT' ? 'Save timed out. Please try again.' : `Add photo failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePhoto() {
    if (!lightboxContainerId || !lightboxItems) return;
    const photo = lightboxItems[lightboxIndex];
    const container = containers.find(c => c.id === lightboxContainerId);
    if (!container || !auth.currentUser) return;
    await auth.currentUser.getIdToken(true);

    const updatedPhotos = container.photos.map(p =>
      p.storagePath === photo.storagePath ? { ...p, deletedAt: Date.now() } : p
    );
    try {
      await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${lightboxContainerId}`), {
        photos: updatedPhotos,
      });
    } catch { return; }

    const remaining = lightboxItems.filter((_, i) => i !== lightboxIndex);
    if (remaining.length === 0) {
      setLightboxItems(null);
      setLightboxContainerId(null);
    } else {
      const newIndex = Math.min(lightboxIndex, remaining.length - 1);
      setLightboxItems(remaining);
      setLightboxIndex(newIndex);
      setTimeout(() => {
        if (scrollRef.current) scrollRef.current.scrollLeft = newIndex * scrollRef.current.offsetWidth;
      }, 0);
    }
  }

  async function handleSavePhotoDescription() {
    if (!lightboxContainerId || !lightboxItems) return;
    const photo = lightboxItems[lightboxIndex];
    const container = containers.find(c => c.id === lightboxContainerId);
    if (!container || !auth.currentUser) return;
    await auth.currentUser.getIdToken(true);
    const updatedPhotos = container.photos.map(p =>
      p.storagePath === photo.storagePath ? { ...p, description: lightboxDescDraft } : p
    );
    await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${lightboxContainerId}`), {
      photos: updatedPhotos,
    });
    setLightboxItems(prev => prev?.map((p, i) =>
      i === lightboxIndex ? { ...p, description: lightboxDescDraft } : p
    ) ?? prev);
  }

  async function handleDeleteContainer(c: Container) {
    if (!window.confirm(`Delete "${c.name}"? It will go to Recently Deleted.`)) return;
    if (!auth.currentUser) return;
    await auth.currentUser.getIdToken(true);
    await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${c.id}`), { deletedAt: Date.now() });
  }

  async function handleDeleteLocation(loc: string) {
    if (!window.confirm(`Delete "${loc}"? All containers will go to Recently Deleted.`)) return;
    if (!auth.currentUser) return;
    await auth.currentUser.getIdToken(true);
    const toDelete = activeContainers.filter(c => displayLocation(c) === loc);
    await Promise.all(toDelete.map(c =>
      updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${c.id}`), { deletedAt: Date.now() })
    ));
  }

  async function handleAddNote(containerId: string, text: string) {
    if (!auth.currentUser) return;
    await auth.currentUser.getIdToken(true);
    const note: ContainerNote = { id: crypto.randomUUID(), text, createdAt: Date.now() };
    await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${containerId}`), { notes: arrayUnion(note) });
  }

  async function handleDeleteNote(containerId: string, noteId: string) {
    if (!auth.currentUser) return;
    await auth.currentUser.getIdToken(true);
    const container = containers.find(c => c.id === containerId);
    if (!container) return;
    const updated = container.notes.map(n => n.id === noteId ? { ...n, deletedAt: Date.now() } : n);
    await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${containerId}`), { notes: updated });
  }

  async function handleDeleteTag(containerId: string, tag: string) {
    if (!auth.currentUser) return;
    await auth.currentUser.getIdToken(true);
    const container = containers.find(c => c.id === containerId);
    if (!container) return;
    await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${containerId}`), {
      aiTags: container.aiTags.filter(t => t !== tag),
    });
  }

  async function handleCopyLink() {
    await navigator.clipboard.writeText('https://vowvy-1ba5f.web.app');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const filteredContainers = (trimmedQuery
    ? activeContainers.filter(c =>
        displayLocation(c).toLowerCase().includes(trimmedQuery) ||
        c.name.toLowerCase().includes(trimmedQuery) ||
        c.aiTags.some(t => t.toLowerCase().includes(trimmedQuery)) ||
        c.aiDescription.toLowerCase().includes(trimmedQuery) ||
        c.aiSearchTerms.join(' ').toLowerCase().includes(trimmedQuery) ||
        c.notes.filter(n => !n.deletedAt).some(n => n.text.toLowerCase().includes(trimmedQuery)) ||
        c.photos.filter(p => !p.deletedAt).some(p => p.description.toLowerCase().includes(trimmedQuery))
      )
    : activeContainers
  ).filter(c => {
    // Hide private containers from collaborators
    if (viewingOwnerUid !== user.uid && c.isPrivate) return false;
    return true;
  });

  const grouped = filteredContainers.reduce<Record<string, Container[]>>((acc, c) => {
    const locKey = displayLocation(c);
    if (!acc[locKey]) acc[locKey] = [];
    acc[locKey].push(c);
    return acc;
  }, {});
  const locationKeys = Object.keys(grouped);

  function openLightbox(c: Container) {
    const activePhotos = c.photos.filter(p => !p.deletedAt).reverse();
    if (activePhotos.length === 0) return;
    setLightboxItems(activePhotos);
    setLightboxContainerId(c.id);
    setLightboxIndex(0);
    setLightboxDescDraft(activePhotos[0].description ?? '');
  }

  function renderContainerRow(c: Container, showLocation = false) {
    const activePhotos = c.photos.filter(p => !p.deletedAt);
    const lastPhoto    = activePhotos[activePhotos.length - 1];
    return (
      <div key={c.id} className="container-row">
        <button className="delete-container-btn" onClick={() => handleDeleteContainer(c)}>✕</button>
        <div className="thumb-wrap" onClick={() => openLightbox(c)}>
          {lastPhoto && <ThumbImage storagePath={lastPhoto.storagePath} alt={c.name} />}
          {activePhotos.length > 1 && <span className="photo-count">{activePhotos.length}</span>}
        </div>
        <div className="container-meta">
          <div className="container-name">
            {c.name}
            {viewingOwnerUid === user.uid && (
              <button
                onClick={async () => {
                  await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${c.id}`), {
                    isPrivate: !c.isPrivate,
                  });
                }}
                title={c.isPrivate ? 'Private — tap to make visible to collaborators' : 'Visible to collaborators — tap to make private'}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 15, padding: '0 4px', opacity: c.isPrivate ? 1 : 0.3,
                }}
              >
                🔒
              </button>
            )}
          </div>
          {showLocation && <div className="container-location">{displayLocation(c)}</div>}
          <div className="container-time">{relativeTime(c.createdAt)}</div>
          {c.aiStatus === 'processing' && <div className="ai-processing">Analyzing…</div>}
          {c.aiStatus === 'done' && c.aiTags.length > 0 && (
            <div className="ai-tags">
              {c.aiTags.map(tag => (
                <span key={tag} className="ai-tag">
                  {tag}
                  <button className="tag-delete-btn" onClick={e => { e.stopPropagation(); handleDeleteTag(c.id, tag); }}>✕</button>
                </span>
              ))}
            </div>
          )}
          <ContainerNotes
            containerId={c.id}
            notes={c.notes.filter(n => !n.deletedAt)}
            onAdd={handleAddNote}
            onDelete={handleDeleteNote}
          />
          <div className="container-actions">
            <button
              className="add-photo-btn"
              onClick={() => {
                setContinuousCapture(false);
                setCaptureContainerId(null);
                if (/CriOS/.test(navigator.userAgent)) { setShowIOSModal(true); return; }
                setUpdatingContainerId(c.id);
                updatePhotoInputRef.current?.click();
              }}
            >
              Add Photo
            </button>
            {viewingOwnerUid === user.uid && (
              <>
                <button
                  className="add-photo-btn"
                  style={{ background: captureContainerId === c.id ? '#7a3b2e' : undefined, color: captureContainerId === c.id ? '#fff' : undefined }}
                  onClick={() => {
                    if (captureContainerId === c.id) {
                      setCaptureContainerId(null);
                      setContinuousCapture(false);
                    } else {
                      setCaptureContainerId(c.id);
                      setContinuousCapture(true);
                    }
                  }}
                >
                  {captureContainerId === c.id ? 'Done' : 'Take Photos'}
                </button>
                <button className="add-photo-btn" onClick={() => setPrintContainer(c)}>
                  Print QR
                </button>
              </>
            )}
            <button
              className="add-photo-btn"
              onClick={() => setMoveSource({ containerId: c.id, mode: 'container' })}
            >
              Move
            </button>
          </div>
        </div>
      </div>
    );
  }

  async function generateInviteLink() {
    setGeneratingInvite(true);
    try {
      const token = crypto.randomUUID();
      const expiresAt = inviteExpiry
        ? new Date(Date.now() + inviteExpiry * 24 * 60 * 60 * 1000)
        : null;
      await setDoc(doc(db, 'invites', token), {
        ownerUid: user.uid,
        ownerDisplayName: user.displayName ?? user.email?.split('@')[0] ?? 'Your host',
        status: 'pending',
        token,
        createdAt: serverTimestamp(),
        ...(expiresAt && { expiresAt }),
      });
      setInviteLink(`${window.location.origin}/invite/${token}`);
    } catch (e) {
      console.error('Failed to generate invite link', e);
    } finally {
      setGeneratingInvite(false);
    }
  }

  async function revokeCollaborator(collaboratorUid: string, inviteToken: string) {
    if (!window.confirm('Remove this person\'s access?')) return;
    try {
      await deleteDoc(doc(db, `users/${user.uid}/collaborators/${collaboratorUid}`));
      if (inviteToken) {
        await updateDoc(doc(db, 'invites', inviteToken), { status: 'revoked' });
      }
    } catch (e) {
      console.error('Failed to revoke collaborator', e);
    }
  }

  return (
    <div className="main-screen">
      <header className="app-header">
        <div className="header-brand">
          <img src={logoMark} alt="" className="header-logo-mark" />
          <span className="app-wordmark">Vowvy</span>
        </div>
        <div className="header-actions">
          {sharedInventories.length > 0 && (
            <select
              value={viewingOwnerUid}
              onChange={e => setViewingOwnerUid(e.target.value)}
              style={{
                padding: '6px 10px', borderRadius: 20, border: '1px solid #ddd',
                background: '#faf8f6', fontSize: 13, color: '#333', cursor: 'pointer',
              }}
            >
              <option value={user.uid}>My inventory</option>
              {sharedInventories.map(s => (
                <option key={s.ownerUid} value={s.ownerUid}>{s.ownerName}'s inventory</option>
              ))}
            </select>
          )}
          {viewingOwnerUid === user.uid && (
            <button
              onClick={() => navigate('/manage')}
              style={{
                padding: '6px 14px', borderRadius: 20, border: '1px solid #ddd',
                background: '#fff', color: '#555', fontSize: 13, cursor: 'pointer',
              }}
            >
              Manage
            </button>
          )}
          {viewingOwnerUid === user.uid && (
            <button
              onClick={() => navigate('/collaborators')}
              style={{
                padding: '6px 14px', borderRadius: 20, border: '1px solid #ddd',
                background: '#fff', color: '#555', fontSize: 13, cursor: 'pointer',
              }}
            >
              Collaborators
            </button>
          )}
          {viewingOwnerUid === user.uid && (
            <button
              onClick={() => setShowInvitePanel(true)}
              style={{
                padding: '6px 14px', borderRadius: 20, border: '1px solid #c8a090',
                background: '#fff', color: '#7a3b2e', fontSize: 13, cursor: 'pointer',
              }}
            >
              Share
            </button>
          )}
          {trashCount > 0 && (
            <button className="trash-link" onClick={() => navigate('/trash')}>
              Recently Deleted ({trashCount})
            </button>
          )}
          <button
            onClick={() => navigate('/profile')}
            style={{
              padding: '6px 14px', borderRadius: 20, border: '1px solid #ddd',
              background: '#fff', color: '#555', fontSize: 13, cursor: 'pointer',
            }}
          >
            Profile
          </button>
          <button className="sign-out-btn" onClick={() => signOut(auth)}>Sign out</button>
        </div>
      </header>

      <main className="main-content">
        {isBrandNewUser ? (
        <section className="onboard-card">
          <img src={logoMark} alt="" className="onboard-logo" />
          <h1 className="onboard-title">Welcome to Vowvy</h1>
          <p className="onboard-tagline">
            Take photos of your boxes, let AI identify and catalog what&rsquo;s inside,
            organize everything by location and box or container, and share access
            with people you trust when you need to.
          </p>

          {!showFirstLocationInput ? (
            <button className="onboard-primary-btn" onClick={() => setShowFirstLocationInput(true)}>
              Create your first location
            </button>
          ) : (
            <div className="onboard-input-block">
              <p className="onboard-input-label">
                A location is where things live — a home, a garage, a storage unit.
              </p>
              <div className="onboard-input-row">
                <input
                  type="text"
                  className="onboard-input"
                  placeholder="e.g. My House, Storage Unit 3"
                  value={firstLocationName}
                  autoFocus
                  disabled={creatingFirstLocation}
                  onChange={e => setFirstLocationName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateFirstLocation()}
                />
                <button
                  className="onboard-create-btn"
                  disabled={!firstLocationName.trim() || creatingFirstLocation}
                  onClick={handleCreateFirstLocation}
                >
                  {creatingFirstLocation ? 'Creating…' : 'Create'}
                </button>
              </div>
            </div>
          )}
          {saveError && <p className="save-error">{saveError}</p>}

          <button className="onboard-secondary-btn" onClick={() => setShowHowItWorks(v => !v)}>
            {showHowItWorks ? 'Hide how Vowvy works' : 'See how Vowvy works'}
          </button>

          {showHowItWorks && (
            <ol className="onboard-steps">
              <li>
                <span className="onboard-step-icon">📍</span>
                <span><strong>Location</strong> — where things live: a home, garage, or storage unit.</span>
              </li>
              <li>
                <span className="onboard-step-icon">📦</span>
                <span><strong>Box or container</strong> — name it, like &ldquo;Box 12&rdquo; or &ldquo;Blue bin&rdquo;.</span>
              </li>
              <li>
                <span className="onboard-step-icon">📷</span>
                <span><strong>Photos</strong> — snap what&rsquo;s inside. No typing needed.</span>
              </li>
              <li>
                <span className="onboard-step-icon">✨</span>
                <span><strong>AI catalog</strong> — Vowvy identifies and tags your items so search can find them later.</span>
              </li>
              <li>
                <span className="onboard-step-icon">🔗</span>
                <span><strong>QR &amp; share</strong> — print a QR label for any box, or share access with people you trust.</span>
              </li>
            </ol>
          )}
        </section>
        ) : (
        <>
        <section className="capture-card">
          {showFirstBoxHint && (
            <div className="onboard-hint">
              <strong>Location saved!</strong> Now add your first box or container below —
              give it a name and snap a photo of what&rsquo;s inside.
            </div>
          )}
          <div className="form-fields">
            <select
              className="container-select"
              value={selectedLocationId}
              disabled={saving}
              onChange={e => {
                setSelectedLocationId(e.target.value);
                setNewLocationName('');
                setSelectedParentId(null);
                setSelectedContainerId('');
                setNewContainerName('');
              }}
            >
              <option value="">— Select location —</option>
              {locations.map(loc => (
                <option key={loc.id} value={loc.id}>
                  {getLocationPath(loc.id, locations)}
                </option>
              ))}
              <option value="new">＋ Add new location</option>
            </select>

            {selectedLocationId === 'new' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    className="container-input"
                    placeholder="e.g. My House, Storage Unit 3, Mom's Garage"
                    value={newLocationName}
                    disabled={saving}
                    style={{ flex: 1 }}
                    onChange={e => setNewLocationName(e.target.value)}
                  />
                  <button
                    disabled={!newLocationName.trim() || saving}
                    onClick={async () => {
                      const id = await createLocation(user.uid, newLocationName.trim(), selectedParentId);
                      setSelectedLocationId(id);
                      setNewLocationName('');
                      setSelectedParentId(null);
                    }}
                    style={{
                      padding: '0 16px', borderRadius: 8, border: 'none',
                      background: newLocationName.trim() ? '#7a3b2e' : '#ccc',
                      color: '#fff', fontSize: 13, cursor: newLocationName.trim() ? 'pointer' : 'not-allowed',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Add
                  </button>
                </div>
                {locations.length > 0 && (
                  <select
                    className="container-select"
                    value={selectedParentId ?? ''}
                    disabled={saving}
                    onChange={e => setSelectedParentId(e.target.value || null)}
                  >
                    <option value="">Top level — e.g. a Property or building</option>
                    {locations.map(loc => (
                      <option key={loc.id} value={loc.id}>
                        Inside: {getLocationPath(loc.id, locations)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <select
              className="container-select"
              value={selectedContainerId}
              disabled={saving}
              onChange={e => { setSelectedContainerId(e.target.value); setNewContainerName(''); }}
            >
              <option value="">— Select box or container —</option>
              {containersAtLocation.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              <option value="new">＋ Create new box or container</option>
            </select>

            {selectedContainerId && selectedContainerId !== 'new' && (
              <p className="container-confirm">
                Adding to: <strong>{activeContainers.find(c => c.id === selectedContainerId)?.name}</strong>
              </p>
            )}

            {selectedContainerId === 'new' && (
              <input
                type="text"
                placeholder="Box or container name — e.g. Box 12, Blue bin"
                value={newContainerName}
                disabled={saving}
                onChange={e => setNewContainerName(e.target.value)}
              />
            )}

            <label
              className="photo-input-label"
              style={{ position: 'relative' }}
              onClick={e => { if (/CriOS/.test(navigator.userAgent)) { e.preventDefault(); setShowIOSModal(true); } }}
            >
              <input type="file" multiple disabled={saving} onChange={e => {
                const files = Array.from(e.target.files ?? []);
                if (files.length === 0) return;
                if (preview) URL.revokeObjectURL(preview);
                setPhoto(files[0]);
                setExtraPhotos(files.slice(1));
                setPreview(URL.createObjectURL(files[0]));
              }} className="photo-input-hidden" />
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
                  <span>Take photo or choose files</span>
                  <span style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>Tap to select one or more photos</span>
                </div>
              )}
              {extraPhotos.length > 0 && (
                <div style={{
                  position: 'absolute', bottom: 8, right: 8,
                  background: '#7a3b2e', color: '#fff', borderRadius: 12,
                  padding: '3px 10px', fontSize: 13, fontWeight: 600,
                }}>
                  {extraPhotos.length + 1} photos selected
                </div>
              )}
            </label>
          </div>

          {saveError && <p className="save-error">{saveError}</p>}
          <button className={`save-btn${saved ? ' saved' : ''}`} onClick={handleSave} disabled={!canSave}>
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
          </button>
          {selectedContainerId === 'new' && newContainerName.trim() !== '' && selectedLocationId && !photo && (
            <button
              onClick={handleCreateContainer}
              disabled={saving}
              style={{
                width: '100%', padding: '12px 0', borderRadius: 10, border: '1px solid #c8a090',
                background: '#fff', color: '#7a3b2e', fontSize: 15, cursor: 'pointer', marginTop: 4,
              }}
            >
              {saving ? 'Creating…' : 'Create box or container (no photo)'}
            </button>
          )}
        </section>

        <div className="search-wrap">
          <input
            type="text"
            className="search-input"
            placeholder="Search containers…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && <button className="search-clear" onClick={() => setSearchQuery('')}>✕</button>}
        </div>

        <section className="container-list">
          {activeContainers.length === 0 ? (
            <p className="list-empty">No boxes or containers yet. Add your first one above.</p>
          ) : filteredContainers.length === 0 ? (
            <p className="list-empty">No containers match "{searchQuery}".</p>
          ) : trimmedQuery ? (
            filteredContainers.map(c => renderContainerRow(c, true))
          ) : (
            locationKeys.map(loc => (
              <div key={loc} className="location-group">
                <div className="location-heading-row">
                  <h2 className="location-heading">{loc}</h2>
                  <button className="delete-location-btn" onClick={() => handleDeleteLocation(loc)}>✕</button>
                </div>
                {grouped[loc].map(c => renderContainerRow(c))}
              </div>
            ))
          )}
        </section>
        </>
        )}
      </main>

      <input type="file" ref={updatePhotoInputRef} className="photo-input-hidden" onChange={handleUpdatePhoto} />

      {lightboxItems && (
        <div className="lightbox-backdrop" onClick={() => setLightboxItems(null)}>
          <div className="lightbox-toolbar" onClick={e => e.stopPropagation()}>
            <button className="lightbox-delete" onClick={handleDeletePhoto}>Delete</button>
            <button className="lightbox-delete" onClick={() => {
              if (!lightboxContainerId || !lightboxItems) return;
              setMoveSource({
                containerId: lightboxContainerId,
                mode: 'photo',
                photoId: lightboxItems[lightboxIndex].id,
              });
            }}>Move</button>
            <label className="lightbox-delete" style={{ cursor: 'pointer' }}>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="photo-input-hidden"
                onChange={async e => {
                  const file = e.target.files?.[0] ?? null;
                  e.target.value = '';
                  if (!file || !lightboxContainerId) return;
                  setSaving(true);
                  try {
                    if (!auth.currentUser) return;
                    await auth.currentUser.getIdToken(true);
                    const compressed = await imageCompression(file, {
                      maxWidthOrHeight: 1600, initialQuality: 0.85, useWebWorker: false, maxSizeMB: 0.5,
                    });
                    let photoUrl: string;
                    let storagePath: string;
                    if (viewingOwnerUid !== user.uid) {
                      const ab = await compressed.arrayBuffer();
                      const b64 = btoa(new Uint8Array(ab).reduce((s, b) => s + String.fromCharCode(b), ''));
                      const fn = httpsCallable<{ ownerUid: string; containerId: string; imageBase64: string; contentType: string }, { downloadURL: string; storagePath: string }>(functions, 'uploadCollaboratorPhoto');
                      const r = await fn({ ownerUid: viewingOwnerUid, containerId: lightboxContainerId, imageBase64: b64, contentType: 'image/jpeg' });
                      photoUrl = r.data.downloadURL;
                      storagePath = r.data.storagePath;
                    } else {
                      storagePath = `users/${viewingOwnerUid}/containers/${lightboxContainerId}/photos/${Date.now()}.jpg`;
                      await uploadBytes(ref(storage, storagePath), compressed);
                      photoUrl = await getDownloadURL(ref(storage, storagePath));
                    }
                    const photoItem: PhotoItem = { id: crypto.randomUUID(), url: photoUrl, storagePath, description: '', createdAt: Date.now(), addedBy: user.uid, addedByName: user.displayName ?? user.email?.split('@')[0] ?? 'Someone' };
                    const existing = containers.find(c => c.id === lightboxContainerId);
                    await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${lightboxContainerId}`), {
                      photos: [...(existing?.photos ?? []), photoItem],
                      photoUrls: arrayUnion(photoUrl),
                      photoStoragePaths: arrayUnion(storagePath),
                      lastModifiedAt: serverTimestamp(),
                      lastModifiedBy: user.uid,
                      lastModifiedByName: user.displayName ?? user.email?.split('@')[0] ?? 'Someone',
                    });
                  } catch {
                    setSaveError('Photo failed to save.');
                  } finally {
                    setSaving(false);
                  }
                }}
              />
              📷
            </label>
            {viewingOwnerUid === user.uid && lightboxContainerId && (
              <button
                className="lightbox-delete"
                onClick={() => setMoveSource({ containerId: lightboxContainerId, mode: 'container' })}
              >
                Move container
              </button>
            )}
            <button className="lightbox-close" onClick={() => setLightboxItems(null)} aria-label="Close">✕</button>
          </div>

          <div
            className="lightbox-scroll"
            ref={scrollRef}
            onClick={e => e.stopPropagation()}
            onScroll={e => {
              const el  = e.currentTarget;
              const idx = Math.round(el.scrollLeft / el.offsetWidth);
              setLightboxIndex(idx);
            }}
          >
            {lightboxItems.map((item, i) => (
              <div key={item.id} className="lightbox-slide">
                <img src={item.url} alt={`Photo ${i + 1}`} className="lightbox-img" />
              </div>
            ))}
          </div>

          {lightboxItems.length > 1 && (
            <div className="lightbox-counter" onClick={e => e.stopPropagation()}>
              {lightboxIndex + 1} / {lightboxItems.length}
            </div>
          )}

          <div className="lightbox-desc" onClick={e => e.stopPropagation()}>
            <input
              type="text"
              className="lightbox-desc-input"
              value={lightboxDescDraft}
              placeholder="Add a description…"
              onChange={e => setLightboxDescDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && lightboxDescDraft !== (lightboxItems[lightboxIndex]?.description ?? '')) {
                  handleSavePhotoDescription();
                }
              }}
            />
            {lightboxDescDraft !== (lightboxItems[lightboxIndex]?.description ?? '') && (
              <button className="lightbox-desc-save" onClick={handleSavePhotoDescription}>Save</button>
            )}
          </div>
        </div>
      )}

      {printContainer && (
        <QRPrintModal container={printContainer} onClose={() => setPrintContainer(null)} />
      )}

      {showIOSModal && (
        <div className="ios-modal-backdrop" onClick={() => setShowIOSModal(false)}>
          <div className="ios-modal" onClick={e => e.stopPropagation()}>
            <p className="ios-modal-message">
              Camera access requires Safari on iPhone. Tap below to open Vowvy in Safari.
            </p>
            <p className="ios-modal-instruction">Paste this link into Safari for camera access.</p>
            <button className="ios-modal-btn" onClick={handleCopyLink}>
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
            <button className="ios-modal-dismiss" onClick={() => setShowIOSModal(false)}>Dismiss</button>
          </div>
        </div>
      )}

      {captureContainerId && (
        <div style={{
          position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)',
          zIndex: 999, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        }}>
          <label style={{
            position: 'relative', width: 72, height: 72, borderRadius: '50%',
            background: '#7a3b2e', display: 'flex', alignItems: 'center',
            justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          }}>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="photo-input-hidden"
              onChange={async e => {
                const file = e.target.files?.[0] ?? null;
                e.target.value = '';
                if (!file) return;
                setCaptureQueue(prev => [...prev, file]);
              }}
            />
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.776 48.776 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
            </svg>
            {captureQueue.length > 0 && (
              <div style={{
                position: 'absolute', top: -8, right: -8, background: '#c0392b',
                color: '#fff', borderRadius: '50%', width: 24, height: 24,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
              }}>
                {captureQueue.length}
              </div>
            )}
          </label>
          <button
            onClick={async () => {
              if (captureQueue.length > 0 && captureContainerId) {
                setSaving(true);
                try {
                  if (!auth.currentUser) return;
                  await auth.currentUser.getIdToken(true);
                  const existing = containers.find(c => c.id === captureContainerId);
                  const newPhotos: PhotoItem[] = [];
                  for (const file of captureQueue) {
                    const compressed = await imageCompression(file, {
                      maxWidthOrHeight: 1600, initialQuality: 0.85, useWebWorker: false, maxSizeMB: 0.5,
                    });
                    const storagePath = `users/${viewingOwnerUid}/containers/${captureContainerId}/photos/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
                    await uploadBytes(ref(storage, storagePath), compressed);
                    const photoUrl = await getDownloadURL(ref(storage, storagePath));
                    newPhotos.push({ id: crypto.randomUUID(), url: photoUrl, storagePath, description: '', createdAt: Date.now(), addedBy: user.uid, addedByName: user.displayName ?? user.email?.split('@')[0] ?? 'Someone' });
                  }
                  await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${captureContainerId}`), {
                    photos: [...(existing?.photos ?? []), ...newPhotos],
                    photoUrls: arrayUnion(...newPhotos.map(p => p.url)),
                    photoStoragePaths: arrayUnion(...newPhotos.map(p => p.storagePath)),
                    lastModifiedAt: serverTimestamp(),
                    lastModifiedBy: user.uid,
                    lastModifiedByName: user.displayName ?? user.email?.split('@')[0] ?? 'Someone',
                  });
                } catch {
                  setSaveError('Some photos failed to save. Please try again.');
                } finally {
                  setSaving(false);
                }
              }
              setCaptureContainerId(null);
              setContinuousCapture(false);
              setCaptureQueue([]);
            }}
            style={{
              padding: '8px 24px', borderRadius: 20, border: 'none',
              background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 14, cursor: 'pointer',
            }}
          >
            {captureQueue.length > 0 ? `Save ${captureQueue.length} photo${captureQueue.length > 1 ? 's' : ''}` : 'Done'}
          </button>
        </div>
      )}

      {/* Move container/photo modal */}
      {moveSource && (
        <div
          onClick={() => setMoveSource(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 16, padding: '32px 28px',
              width: '100%', maxWidth: 440, boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
              display: 'flex', flexDirection: 'column', gap: 16,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 20, fontFamily: 'Cormorant Garamond, serif', color: '#7a3b2e' }}>
              {moveSource.mode === 'container' ? 'Move to a different location' : 'Move to another container'}
            </h2>
            <p style={{ margin: 0, fontSize: 14, color: '#555' }}>
              {moveSource.mode === 'container' ? 'Select a destination location.' : 'Select a destination container.'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
              {moveSource.mode === 'container' ? (
                locations.length === 0 ? (
                  <p style={{ color: '#888', fontSize: 14, textAlign: 'center', padding: '20px 0' }}>
                    No locations available. Create one in Manage first.
                  </p>
                ) : (
                  locations.map(loc => (
                    <button
                      key={loc.id}
                      onClick={async () => {
                        const src = containers.find(c => c.id === moveSource.containerId);
                        if (!src) return;
                        await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${src.id}`), {
                          locationId: loc.id,
                          location: getLocationPath(loc.id, locations),
                        });
                        setMoveSource(null);
                      }}
                      style={{
                        textAlign: 'left', padding: '12px 16px', borderRadius: 10,
                        border: '1px solid #eee', background: '#faf8f6',
                        cursor: 'pointer', fontSize: 14, color: '#333',
                      }}
                    >
                      {getLocationPath(loc.id, locations)}
                    </button>
                  ))
                )
              ) : (
                containers.filter(c => !c.deletedAt && c.id !== moveSource.containerId).length === 0 && locations.length === 0 ? (
                  <p style={{ color: '#888', fontSize: 14, textAlign: 'center', padding: '20px 0' }}>
                    No destinations available. Create a container or location first.
                  </p>
                ) : (
                  <>
                    {locations.length > 0 && (
                      <>
                        <p style={{ margin: '4px 0', fontSize: 12, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Locations</p>
                        {locations.map(loc => (
                          <button
                            key={loc.id}
                            onClick={async () => {
                              const src = containers.find(c => c.id === moveSource.containerId);
                              if (!src || !moveSource.photoId) return;
                              const photo = src.photos.find(p => p.id === moveSource.photoId);
                              if (!photo) return;

                              // Check if an Unsorted container already exists at this location
                              let targetContainerId: string;
                              const existing = containers.find(c =>
                                c.locationId === loc.id && c.name === 'Unsorted' && !c.deletedAt
                              );

                              if (existing) {
                                await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${existing.id}`), {
                                  photos: [...existing.photos, photo],
                                  photoUrls: arrayUnion(photo.url),
                                  photoStoragePaths: arrayUnion(photo.storagePath),
                                });
                                targetContainerId = existing.id;
                              } else {
                                const containerRef = doc(collection(db, `users/${viewingOwnerUid}/containers`));
                                await setDoc(containerRef, {
                                  name: 'Unsorted',
                                  locationId: loc.id,
                                  location: getLocationPath(loc.id, locations),
                                  photos: [photo],
                                  photoUrls: [photo.url],
                                  photoStoragePaths: [photo.storagePath],
                                  createdAt: serverTimestamp(),
                                  deletedAt: null,
                                  isPrivate: false,
                                });
                                targetContainerId = containerRef.id;
                              }

                              // Remove photo from source and clear AI fields
                              await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${src.id}`), {
                                photos: src.photos.filter(p => p.id !== moveSource.photoId),
                                photoUrls: src.photos.filter(p => p.id !== moveSource.photoId).map(p => p.url),
                                photoStoragePaths: src.photos.filter(p => p.id !== moveSource.photoId).map(p => p.storagePath),
                                aiDescription: '',
                                aiTags: [],
                                aiObjects: [],
                                aiStatus: null,
                              });
                              void targetContainerId;
                              setLightboxItems(null);
                              setMoveSource(null);
                            }}
                            style={{
                              textAlign: 'left', padding: '12px 16px', borderRadius: 10,
                              border: '1px solid #eee', background: '#faf8f6',
                              cursor: 'pointer', fontSize: 14, color: '#333',
                            }}
                          >
                            📍 {getLocationPath(loc.id, locations)}
                          </button>
                        ))}
                      </>
                    )}
                    {containers.filter(c => !c.deletedAt && c.id !== moveSource.containerId).length > 0 && (
                      <>
                        <p style={{ margin: '8px 0 4px', fontSize: 12, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Containers</p>
                        {containers
                          .filter(c => !c.deletedAt && c.id !== moveSource.containerId)
                          .map(dest => (
                            <button
                              key={dest.id}
                              onClick={async () => {
                                const src = containers.find(c => c.id === moveSource.containerId);
                                if (!src) return;
                                const srcRef  = doc(db, `users/${viewingOwnerUid}/containers/${src.id}`);
                                const destRef = doc(db, `users/${viewingOwnerUid}/containers/${dest.id}`);
                                const destSnap = await getDoc(destRef);
                                const destPhotos: PhotoItem[] = destSnap.data()?.photos ?? [];
                                const batch = writeBatch(db);
                                if (moveSource.mode === 'photo' && moveSource.photoId) {
                                  const photo = src.photos.find(p => p.id === moveSource.photoId);
                                  if (!photo) return;
                                  const newDestPhotos = [...destPhotos, photo];
                                  batch.update(destRef, {
                                    photos: newDestPhotos,
                                    photoUrls: newDestPhotos.map(p => p.url),
                                    photoStoragePaths: newDestPhotos.map(p => p.storagePath),
                                  });
                                  const newSrcPhotos = src.photos.filter(p => p.id !== moveSource.photoId);
                                  batch.update(srcRef, {
                                    photos: newSrcPhotos,
                                    photoUrls: newSrcPhotos.map(p => p.url),
                                    photoStoragePaths: newSrcPhotos.map(p => p.storagePath),
                                  });
                                } else {
                                  const newDestPhotos = [...destPhotos, ...src.photos];
                                  batch.update(destRef, {
                                    photos: newDestPhotos,
                                    photoUrls: newDestPhotos.map(p => p.url),
                                    photoStoragePaths: newDestPhotos.map(p => p.storagePath),
                                  });
                                  batch.update(srcRef, {
                                    photos: [], photoUrls: [], photoStoragePaths: [], photoUrl: null, photoStoragePath: null,
                                  });
                                }
                                await batch.commit();
                                await updateDoc(srcRef, { aiDescription: '', aiTags: [], aiObjects: [], aiStatus: null });
                                setLightboxItems(null);
                                setMoveSource(null);
                              }}
                              style={{
                                textAlign: 'left', padding: '12px 16px', borderRadius: 10,
                                border: '1px solid #eee', background: '#faf8f6',
                                cursor: 'pointer', fontSize: 14, color: '#333',
                              }}
                            >
                              <strong>{dest.name}</strong>
                              {dest.location && <span style={{ color: '#888', marginLeft: 8, fontSize: 13 }}>{dest.location}</span>}
                            </button>
                          ))}
                      </>
                    )}
                  </>
                )
              )}
            </div>
            <button
              onClick={() => setMoveSource(null)}
              style={{
                padding: '10px 0', borderRadius: 8, border: '1px solid #ddd',
                background: '#fff', fontSize: 14, cursor: 'pointer', color: '#555',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Invite panel */}
      {showInvitePanel && (
        <div
          onClick={() => { setShowInvitePanel(false); setInviteLink(null); setInviteCopied(false); }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 16, padding: '32px 28px',
              width: '100%', maxWidth: 440, boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
              display: 'flex', flexDirection: 'column', gap: 20,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 20, fontFamily: 'Cormorant Garamond, serif', color: '#7a3b2e' }}>
              Share your inventory
            </h2>
            <p style={{ margin: 0, fontSize: 14, color: '#555' }}>
              Generate a link and send it to a collaborator. They can add photos and edit containers in your inventory.
            </p>

            {inviteLink ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input
                  readOnly
                  value={inviteLink}
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 8,
                    border: '1px solid #ddd', fontSize: 13, color: '#333',
                    background: '#faf8f6', boxSizing: 'border-box',
                  }}
                  onFocus={e => e.target.select()}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => { navigator.clipboard.writeText(inviteLink); setInviteCopied(true); }}
                    style={{
                      flex: 1, padding: '10px 0', borderRadius: 8, border: 'none',
                      background: '#7a3b2e', color: '#fff', fontSize: 14, cursor: 'pointer',
                    }}
                  >
                    {inviteCopied ? '✓ Copied!' : 'Copy link'}
                  </button>
                  <button
                    onClick={() => { setInviteLink(null); setInviteCopied(false); }}
                    style={{
                      padding: '10px 16px', borderRadius: 8, border: '1px solid #ddd',
                      background: '#fff', fontSize: 14, cursor: 'pointer', color: '#555',
                    }}
                  >
                    New link
                  </button>
                </div>
              </div>
            ) : (
              <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 13, color: '#555' }}>Link expires after</label>
                <select
                  value={inviteExpiry ?? 'never'}
                  onChange={e => setInviteExpiry(e.target.value === 'never' ? null : Number(e.target.value))}
                  style={{
                    padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd',
                    background: '#faf8f6', fontSize: 14, color: '#333',
                  }}
                >
                  <option value={1}>24 hours</option>
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value="never">No expiry</option>
                </select>
              </div>
              <button
                onClick={generateInviteLink}
                disabled={generatingInvite}
                style={{
                  padding: '12px 0', borderRadius: 8, border: 'none',
                  background: generatingInvite ? '#ccc' : '#7a3b2e',
                  color: '#fff', fontSize: 14, cursor: generatingInvite ? 'not-allowed' : 'pointer',
                }}
              >
                {generatingInvite ? 'Generating…' : 'Generate invite link'}
              </button>
              </>
            )}

            {collaborators.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#333' }}>People with access</p>
                {collaborators.map(c => (
                  <div key={c.uid} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', borderRadius: 8, background: '#faf8f6', border: '1px solid #eee',
                  }}>
                    <span style={{ fontSize: 14, color: '#333' }}>{c.displayName}</span>
                    <button
                      onClick={() => revokeCollaborator(c.uid, c.inviteToken)}
                      style={{
                        padding: '4px 12px', borderRadius: 6, border: '1px solid #e0b0a0',
                        background: '#fff', color: '#a04030', fontSize: 12, cursor: 'pointer',
                      }}
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => { setShowInvitePanel(false); setInviteLink(null); setInviteCopied(false); }}
              style={{
                padding: '10px 0', borderRadius: 8, border: '1px solid #ddd',
                background: '#fff', fontSize: 14, cursor: 'pointer', color: '#555',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
