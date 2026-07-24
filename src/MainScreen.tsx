import { useState, useEffect, useRef, type ReactElement } from 'react';
import { signOut, type User } from 'firebase/auth';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import {
  collection, doc, setDoc, getDoc, updateDoc, onSnapshot,
  query, orderBy, arrayUnion, serverTimestamp, Timestamp, runTransaction,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import imageCompression from 'browser-image-compression';
import QRCode from 'qrcode';
import { auth, db, storage, functions } from './firebase';
import { ThumbImage, LightboxImage, ContainerNotes } from './shared';
import type { ContainerNote, PhotoItem } from './shared';
import { navigate } from './nav';
import logoMark from './assets/logo-mark.svg';
import './MainScreen.css';
import { subscribeToLocations, createLocation, getLocationPath, type Location } from './locations';
import SellThisFlow from './SellThisFlow';
import type { ContainerForListing } from './SellThisFlow';
import {
  observeSharedInventorySessions,
  observeOwnedCollaboratorAccess,
  type SharedInventorySession,
} from './collaboration/firebase-session-adapter';
import { createFirebaseInventoryAdapter } from './collaboration/firebase-inventory-adapter';
import { createCollaboratorInventoryService } from './collaboration/inventory-service';
import { createFirebaseLifecycleAdapter } from './collaboration/firebase-lifecycle-adapter';

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

const GENERIC_DISPLAY_TAGS = new Set([
  'art', 'graphics', 'decorations', 'food', 'packaging', 'logistics',
  'sports', 'apparel', 'warehouse supplies', 'spirituality', 'religious decor',
]);

function filterDisplayTags(tags: string[], max: number): string[] {
  const specific = tags.filter(t => !GENERIC_DISPLAY_TAGS.has(t.toLowerCase()));
  return (specific.length > 0 ? specific : tags).slice(0, max);
}
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
  aiError?: string | null;
  aiRetryRequestedAt?: number;
  aiSearchTerms: string[];
  notes: ContainerNote[];
  deletedAt: number | null;
  isPrivate: boolean;
  effectiveIsPrivate: boolean;
  visibility: 'inherit' | 'private' | 'shared';
  lastModifiedAt: Timestamp | null;
  lastModifiedBy: string | null;
  lastModifiedByName: string | null;
}

interface TrayPhoto {
  photo: PhotoItem;
  containerId: string;
  containerName: string;
}

function clearQrPrintState() {
  document.body.classList.remove('vowvy-printing-qr');
  document.body.classList.remove('vowvy-printing-qr-main');
  document.body.classList.remove('vowvy-printing-qr-manage');
  document.body.classList.remove('vowvy-qr-print-active');

  const existingPrintRoot = document.getElementById('vowvy-qr-print-root');
  existingPrintRoot?.remove();

  window.removeEventListener('afterprint', clearQrPrintState);
}

function requestQrPrint(scopeClass: 'vowvy-printing-qr-main' | 'vowvy-printing-qr-manage') {
  const card = document.querySelector('.qr-print-overlay .qr-print-card');

  if (!card) {
    window.print();
    return;
  }

  const existingPrintRoot = document.getElementById('vowvy-qr-print-root');
  existingPrintRoot?.remove();

  const printRoot = document.createElement('div');
  printRoot.id = 'vowvy-qr-print-root';
  printRoot.appendChild(card.cloneNode(true));
  document.body.appendChild(printRoot);

  document.body.classList.add('vowvy-printing-qr');
  document.body.classList.add(scopeClass);
  document.body.classList.add('vowvy-qr-print-active');

  window.removeEventListener('afterprint', clearQrPrintState);
  window.addEventListener('afterprint', clearQrPrintState);

  window.print();
}

function QRPrintModal({ container, onClose }: { container: Container; onClose: () => void }) {
  const { t } = useTranslation();
  const [tagline, setTagline] = useState(() => t('main.qr.defaultTagline'));
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    const url = `https://app.vowvy.com/container/${container.id}`;
    QRCode.toDataURL(url, { width: 240, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [container.id]);

  const closeQr = () => {
    clearQrPrintState();
    onClose();
  };

  return (
    <div className="qr-print-overlay">
      <div className="qr-print-controls">
        <button className="qr-btn-print" disabled={!qrDataUrl} onClick={() => requestQrPrint('vowvy-printing-qr-main')}>
          {t('main.qr.print')}
        </button>
        <button className="qr-btn-close" onClick={closeQr}>{t('main.qr.close')}</button>
      </div>

      <div className="qr-print-card">
        <img src={logoMark} alt="Vowvy" className="qr-logo" />
        <div className="qr-code">
          {qrDataUrl && <img src={qrDataUrl} alt={`QR code for ${container.name}`} className="qr-code-img" />}
        </div>
        <div className="qr-container-name">{container.name}</div>
        <div className="qr-location">{container.location}</div>
        <input
          className="qr-tagline-input"
          value={tagline}
          onChange={e => setTagline(e.target.value)}
        />
      </div>
    </div>
  );
}


function relativeTime(ts: Timestamp | null): string {
  const t = i18next.t.bind(i18next);
  if (!ts) return t('main.time.justNow');
  const seconds = Math.floor((Date.now() - ts.toMillis()) / 1000);
  if (seconds < 60)        return t('main.time.justNow');
  if (seconds < 3600)      return t('main.time.minutesAgo', { count: Math.floor(seconds / 60) });
  if (seconds < 86400)     return t('main.time.hoursAgo',  { count: Math.floor(seconds / 3600) });
  if (seconds < 7 * 86400) return t('main.time.daysAgo',   { count: Math.floor(seconds / 86400) });
  return ts.toDate().toLocaleDateString(i18next.language || 'en', { month: 'short', day: 'numeric' });
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
    effectiveIsPrivate: data.effectiveIsPrivate ?? data.isPrivate ?? false,
    visibility: (data.visibility ?? 'inherit') as 'inherit' | 'private' | 'shared',
    lastModifiedAt: data.lastModifiedAt ?? null,
    lastModifiedBy: data.lastModifiedBy ?? null,
    lastModifiedByName: data.lastModifiedByName ?? null,
  };
}

interface Props { user: User; initialOwnerUid?: string | null }


export default function MainScreen({ user, initialOwnerUid }: Props) {
  const { t, i18n } = useTranslation();
  const [selectedLocationId, setSelectedLocationId]   = useState(() => new URLSearchParams(window.location.search).get('location') ?? '');
  const [selectedParentId, setSelectedParentId]       = useState<string | null>(null);
  const [newLocationName, setNewLocationName]         = useState('');
  const [selectedContainerId, setSelectedContainerId] = useState('');
  const [newContainerName, setNewContainerName]       = useState('');
  const [photo, setPhoto]                             = useState<File | null>(null);
  const [extraPhotos, setExtraPhotos]                 = useState<File[]>([]);
  const [preview, setPreview]                         = useState<string | null>(null);
  const [saving, setSaving]                           = useState(false);
  const [saveProgressText, setSaveProgressText]       = useState('');
  const [saved, setSaved]                             = useState(false);
  const [saveError, setSaveError]                     = useState('');
  const [containers, setContainers]                   = useState<Container[]>([]);
  const [showIOSModal, setShowIOSModal]               = useState(false);
  const [copied, setCopied]                           = useState(false);
  const [lightboxItems, setLightboxItems]             = useState<PhotoItem[] | null>(null);
  const [lightboxContainerId, setLightboxContainerId] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex]             = useState(0);
  const [lightboxDescDraft, setLightboxDescDraft]     = useState('');
  const [editingAiDesc, setEditingAiDesc] = useState(false);
  const [aiDescDraft, setAiDescDraft] = useState('');
  const [editingAiTags, setEditingAiTags] = useState(false);
  const [aiTagsDraft, setAiTagsDraft] = useState('');
  const [retryingAiPhotoIds, setRetryingAiPhotoIds] = useState<Set<string>>(() => new Set());
  const [lightboxAllPhotos, setLightboxAllPhotos]     = useState<PhotoItem[] | null>(null);
  const [lightboxFilterQuery, setLightboxFilterQuery] = useState('');
  const [updatingContainerId, setUpdatingContainerId] = useState<string | null>(null);
  const [, setContinuousCapture] = useState(false);
  const [captureContainerId, setCaptureContainerId] = useState<string | null>(null);
  const [captureQueue, setCaptureQueue] = useState<File[]>([]);
  const [searchQuery, setSearchQuery]                 = useState('');
  const [printContainer, setPrintContainer]           = useState<Container | null>(null);
  const [moveSource, setMoveSource] = useState<{ containerId: string; mode: 'container' | 'photo'; photoId?: string } | null>(null);
  const [expandedMoveLocs, setExpandedMoveLocs] = useState<Set<string>>(new Set());
  const [sellContainer, setSellContainer] = useState<ContainerForListing | null>(null);
  const [sellSourcePhotos, setSellSourcePhotos] = useState<PhotoItem[] | null>(null);
  const [sellSourceContainerIds, setSellSourceContainerIds] = useState<string[] | null>(null);
  const [renamingContId, setRenamingContId] = useState<string | null>(null);
  const [renamingDraft, setRenamingDraft]   = useState('');
  const [sellIsFromTray, setSellIsFromTray] = useState(false);
  const [trayPhotos, setTrayPhotos] = useState<TrayPhoto[]>([]);
  const [showTray, setShowTray] = useState(false);
  const [viewingOwnerUid, setViewingOwnerUid]         = useState(initialOwnerUid ?? user.uid);
  const [sharedInventories, setSharedInventories]     = useState<SharedInventorySession[]>([]);
  const [sharedSessionsLoaded, setSharedSessionsLoaded] = useState(false);
  const [collaborationError, setCollaborationError]   = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationsLoaded, setLocationsLoaded]   = useState(false);
  const [containersLoaded, setContainersLoaded] = useState(false);
  const [showFirstLocationInput, setShowFirstLocationInput] = useState(false);
  const [firstLocationName, setFirstLocationName]           = useState('');
  const [creatingFirstLocation, setCreatingFirstLocation]   = useState(false);
  const [showHowItWorks, setShowHowItWorks]                 = useState(false);
  const [collaborators, setCollaborators]     = useState<{ uid: string; displayName: string }[]>([]);
  const [showMobileMenu, setShowMobileMenu]   = useState(false);
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [inviteLink, setInviteLink]           = useState<string | null>(null);
  const [inviteCopied, setInviteCopied]       = useState(false);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [inviteExpiry, setInviteExpiry] = useState<number | null>(7); // days, null = no expiry
  const [cardMoreOpenId, setCardMoreOpenId] = useState<string | null>(null);
  const updatePhotoInputRef = useRef<HTMLInputElement>(null);
  const scrollRef           = useRef<HTMLDivElement>(null);

  // Sync description draft when lightbox photo changes
  useEffect(() => {
    if (lightboxItems && lightboxItems[lightboxIndex]) {
      setLightboxDescDraft(lightboxItems[lightboxIndex].description ?? '');
    }
  }, [lightboxIndex, lightboxItems]);

  // Only verified, active and unexpired access records may select shared inventory.
  useEffect(() => {
    return observeSharedInventorySessions(
      db,
      user.uid,
      sessions => {
        setSharedInventories(sessions);
        setSharedSessionsLoaded(true);
        setCollaborationError('');
      },
      error => {
        setSharedInventories([]);
        setSharedSessionsLoaded(true);
        setCollaborationError(error.message);
      },
    );
  }, [user.uid]);

  // Owners retain the established real-time path. Collaborators load through the
  // verified owner-aware inventory service; no URL or selector value grants access.
  useEffect(() => {
    setLocationsLoaded(false);
    if (viewingOwnerUid !== user.uid) {
      const shared = sharedInventories.find(
        item => item.ownerUid === viewingOwnerUid,
      );
      if (!shared) {
        setLocations([]);
        setLocationsLoaded(true);
        return;
      }
      let cancelled = false;
      const service = createCollaboratorInventoryService(
        shared.session,
        createFirebaseInventoryAdapter(db, functions),
      );
      service.readInventory()
        .then(result => {
          if (cancelled) return;
          if (!result.ok) {
            setCollaborationError(`Shared inventory unavailable: ${result.reason}`);
            setViewingOwnerUid(user.uid);
            return;
          }
          setLocations(result.value.locations.map(location => ({
            ...location,
            createdAt: null,
          })));
          setContainers(result.value.containers.map(mapContainer));
          setLocationsLoaded(true);
          setContainersLoaded(true);
        })
        .catch(error => {
          if (cancelled) return;
          setCollaborationError(
            error instanceof Error ? error.message : 'Shared inventory unavailable.',
          );
          setViewingOwnerUid(user.uid);
        });
      return () => {
        cancelled = true;
      };
    }
    return subscribeToLocations(viewingOwnerUid, locs => {
      setLocations(locs);
      setLocationsLoaded(true);
    });
  }, [viewingOwnerUid, user.uid, sharedInventories]);

  // Owner view of current access uses the same authoritative records as rules.
  useEffect(() => {
    return observeOwnedCollaboratorAccess(
      db,
      user.uid,
      records => setCollaborators(
        records
          .filter(({ access }) =>
            access.status === 'active' &&
            (access.expiresAtMs === null || Date.now() < access.expiresAtMs))
          .map(({ collaboratorUid }) => ({
            uid: collaboratorUid,
            displayName: `Collaborator ${collaboratorUid.slice(0, 6)}`,
          })),
      ),
      error => setCollaborationError(error.message),
    );
  }, [user.uid]);

  // Revocation, expiration, invalid access, or an unauthorized owner URL always
  // returns the user to their own inventory—even when the valid list is empty.
  useEffect(() => {
    if (
      viewingOwnerUid !== user.uid &&
      sharedSessionsLoaded &&
      !sharedInventories.some(s => s.ownerUid === viewingOwnerUid)
    ) {
      setViewingOwnerUid(user.uid);
      window.history.replaceState({}, '', '/');
    }
  }, [sharedInventories, sharedSessionsLoaded, viewingOwnerUid, user.uid]);

  // Owner container snapshot. Collaborator containers are loaded by the verified
  // inventory service in the effect above.
  useEffect(() => {
    if (viewingOwnerUid !== user.uid) return;
    setContainersLoaded(false);
    const col = collection(db, `users/${viewingOwnerUid}/containers`);
    const q = query(col, orderBy('createdAt', 'desc'));
    return onSnapshot(q, snap => {
      setContainers(snap.docs.map(mapContainer));
      setContainersLoaded(true);
    });
  }, [viewingOwnerUid, user.uid]);

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

  const trashedContainers = containers.filter(c => c.deletedAt);
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

  const activeSharedInventory = viewingOwnerUid === user.uid
    ? null
    : sharedInventories.find(item => item.ownerUid === viewingOwnerUid) ?? null;

  function collaboratorInventoryService() {
    return activeSharedInventory
      ? createCollaboratorInventoryService(
          activeSharedInventory.session,
          createFirebaseInventoryAdapter(db, functions),
        )
      : null;
  }

  async function createLocationForActiveInventory(
    name: string,
    parentId: string | null,
  ): Promise<string> {
    if (viewingOwnerUid === user.uid) {
      return createLocation(user.uid, name, parentId);
    }
    const service = collaboratorInventoryService();
    if (!service) throw new Error('collaboration-session-unavailable');
    const result = await service.createLocation(name, parentId);
    if (!result.ok) throw new Error(`collaboration-location:${result.reason}`);
    return result.value;
  }

  function clearCaptureSelection() {
    if (saving) return;
    if (preview) URL.revokeObjectURL(preview);
    setPhoto(null);
    setExtraPhotos([]);
    setPreview(null);
    setSaveError('');
    setSaved(false);
    setSaveProgressText('');
  }


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
        if (!newLocationName.trim()) { setSaveError(t('main.errors.locationRequired')); setSaving(false); return; }
        resolvedLocationId = await createLocationForActiveInventory(newLocationName.trim(), selectedParentId);
        resolvedLocationName = newLocationName.trim();
      } else {
        resolvedLocationName = getLocationPath(selectedLocationId, locations);
      }
      const service = collaboratorInventoryService();
      if (service) {
        const result = await service.createContainer(
          newContainerName.trim(),
          resolvedLocationId,
          resolvedLocationName,
        );
        if (!result.ok) throw new Error(`collaboration-container:${result.reason}`);
        setSelectedLocationId(''); setNewLocationName(''); setSelectedContainerId('');
        setNewContainerName(''); setPhoto(null); setExtraPhotos([]); setPreview(null);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        return;
      }
      const containerRef = doc(collection(db, `users/${viewingOwnerUid}/containers`));
      const locEffective0 = resolvedLocationId
        ? (locations.find(l => l.id === resolvedLocationId)?.effectiveIsPrivate ?? false)
        : false;
      await setDoc(containerRef, {
        location: resolvedLocationName,
        locationId: resolvedLocationId,
        name: newContainerName.trim(),
        photos: [],
        photoUrls: [],
        photoStoragePaths: [],
        createdAt: serverTimestamp(),
        deletedAt: null,
        isPrivate: locEffective0,
        visibility: 'inherit',
        effectiveIsPrivate: locEffective0,
      });
      setSelectedLocationId(''); setNewLocationName(''); setSelectedContainerId('');
      setNewContainerName(''); setPhoto(null); setExtraPhotos([]); setPreview(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setSaveError(t('main.errors.createFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!photo || saving || !selectedLocationId || !containerValid) return;

    setSaving(true);
    setSaveError('');
    setSaved(false);
    setSaveProgressText('');

    const selectedFiles = [photo, ...extraPhotos];

    try {
      // Resolve location — create new one if needed
      let resolvedLocationId = selectedLocationId;
      let resolvedLocationName = '';

      if (selectedLocationId === 'new') {
        if (!newLocationName.trim()) {
          setSaveError(t('main.errors.locationRequired'));
          return;
        }
        resolvedLocationId = await createLocationForActiveInventory(newLocationName.trim(), selectedParentId);
        resolvedLocationName = newLocationName.trim();
      } else {
        resolvedLocationName = getLocationPath(selectedLocationId, locations);
      }

      if (!auth.currentUser) {
        setSaveError(t('main.errors.sessionExpired'));
        return;
      }

      await auth.currentUser.getIdToken(true);

      const compressOpts = {
        maxWidthOrHeight: 1600,
        initialQuality: 0.85,
        useWebWorker: true,
        maxSizeMB: 0.5,
      };

      const makePhotoItem = (url: string, storagePath: string): PhotoItem => ({
        id: crypto.randomUUID(),
        url,
        storagePath,
        description: '',
        createdAt: Date.now(),
        addedBy: user.uid,
        addedByName: user.displayName ?? user.email?.split('@')[0] ?? 'Someone',
        moderationStatus: 'pending',
        moderationCheckedAt: null,
        moderationProvider: null,
        moderationReason: null,
      });

      const uploadPhoto = async (containerId: string, file: File, index: number): Promise<{ url: string; storagePath: string }> => {
        setSaveProgressText(`Saving ${index + 1} of ${selectedFiles.length} photo${selectedFiles.length === 1 ? '' : 's'}…`);

        const compressed = await imageCompression(file, compressOpts);

        const storagePath = `users/${viewingOwnerUid}/containers/${containerId}/photos/${Date.now()}-${index}-${Math.random().toString(36).slice(2)}.jpg`;
        await uploadBytes(ref(storage, storagePath), compressed);
        return { url: await getDownloadURL(ref(storage, storagePath)), storagePath };
      };

      const appendPhotoToExistingContainer = async (
        containerId: string,
        currentPhotos: PhotoItem[],
        file: File,
        index: number
      ): Promise<PhotoItem[]> => {
        const { url: photoUrl, storagePath } = await uploadPhoto(containerId, file, index);
        const photoItem = makePhotoItem(photoUrl, storagePath);
        const nextPhotos = [...currentPhotos, photoItem];

        const service = collaboratorInventoryService();
        if (service) {
          const result = await service.addPhoto(containerId, photoItem);
          if (!result.ok) throw new Error(`collaboration-photo:${result.reason}`);
        } else {
          await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${containerId}`), {
            photos: nextPhotos,
            photoUrls: arrayUnion(photoUrl),
            photoStoragePaths: arrayUnion(storagePath),
            lastModifiedAt: serverTimestamp(),
            lastModifiedBy: user.uid,
            lastModifiedByName: user.displayName ?? user.email?.split('@')[0] ?? 'Someone',
          });
        }

        return nextPhotos;
      };

      if (selectedContainerId === 'new') {
        const service = collaboratorInventoryService();
        if (service) {
          const created = await service.createContainer(
            newContainerName.trim(),
            resolvedLocationId,
            resolvedLocationName,
          );
          if (!created.ok) throw new Error(`collaboration-container:${created.reason}`);
          let currentPhotos: PhotoItem[] = [];
          for (let i = 0; i < selectedFiles.length; i += 1) {
            currentPhotos = await appendPhotoToExistingContainer(
              created.value,
              currentPhotos,
              selectedFiles[i],
              i,
            );
          }
        } else {
        const containerRef = doc(collection(db, `users/${viewingOwnerUid}/containers`));
        const locEffective1 = resolvedLocationId
          ? (locations.find(l => l.id === resolvedLocationId)?.effectiveIsPrivate ?? false)
          : false;

        const { url: photoUrl, storagePath } = await uploadPhoto(containerRef.id, selectedFiles[0], 0);
        const firstPhotoItem = makePhotoItem(photoUrl, storagePath);
        let currentPhotos = [firstPhotoItem];

        await setDoc(containerRef, {
          location: resolvedLocationName,
          locationId: resolvedLocationId,
          name: newContainerName.trim(),
          photos: currentPhotos,
          photoUrls: [photoUrl],
          photoStoragePaths: [storagePath],
          createdAt: serverTimestamp(),
          deletedAt: null,
          isPrivate: locEffective1,
          visibility: 'inherit',
          effectiveIsPrivate: locEffective1,
          lastModifiedAt: serverTimestamp(),
          lastModifiedBy: user.uid,
          lastModifiedByName: user.displayName ?? user.email?.split('@')[0] ?? 'Someone',
        });

        for (let i = 1; i < selectedFiles.length; i += 1) {
          currentPhotos = await appendPhotoToExistingContainer(containerRef.id, currentPhotos, selectedFiles[i], i);
        }
        }
      } else if (selectedContainerId === '__loose__') {
        const looseExisting = containers.find(c =>
          c.locationId === resolvedLocationId && c.name === 'Loose items' && !c.deletedAt
        );

        if (looseExisting) {
          let currentPhotos = [...looseExisting.photos];
          for (let i = 0; i < selectedFiles.length; i += 1) {
            currentPhotos = await appendPhotoToExistingContainer(looseExisting.id, currentPhotos, selectedFiles[i], i);
          }
        } else {
          const service = collaboratorInventoryService();
          if (service) {
            const created = await service.createContainer(
              'Loose items',
              resolvedLocationId,
              resolvedLocationName,
            );
            if (!created.ok) throw new Error(`collaboration-container:${created.reason}`);
            let currentPhotos: PhotoItem[] = [];
            for (let i = 0; i < selectedFiles.length; i += 1) {
              currentPhotos = await appendPhotoToExistingContainer(
                created.value,
                currentPhotos,
                selectedFiles[i],
                i,
              );
            }
          } else {
          const containerRef = doc(collection(db, `users/${viewingOwnerUid}/containers`));
          const locEffectiveLoose = resolvedLocationId
            ? (locations.find(l => l.id === resolvedLocationId)?.effectiveIsPrivate ?? false)
            : false;

          const { url: photoUrl, storagePath } = await uploadPhoto(containerRef.id, selectedFiles[0], 0);
          const firstPhotoItem = makePhotoItem(photoUrl, storagePath);
          let currentPhotos = [firstPhotoItem];

          await setDoc(containerRef, {
            location: resolvedLocationName,
            locationId: resolvedLocationId,
            name: 'Loose items',
            photos: currentPhotos,
            photoUrls: [photoUrl],
            photoStoragePaths: [storagePath],
            createdAt: serverTimestamp(),
            deletedAt: null,
            isPrivate: locEffectiveLoose,
            visibility: 'inherit',
            effectiveIsPrivate: locEffectiveLoose,
            lastModifiedAt: serverTimestamp(),
            lastModifiedBy: user.uid,
            lastModifiedByName: user.displayName ?? user.email?.split('@')[0] ?? 'Someone',
          });

          for (let i = 1; i < selectedFiles.length; i += 1) {
            currentPhotos = await appendPhotoToExistingContainer(containerRef.id, currentPhotos, selectedFiles[i], i);
          }
          }
        }
      } else {
        const existing = containers.find(c => c.id === selectedContainerId);
        let currentPhotos = [...(existing?.photos ?? [])];

        for (let i = 0; i < selectedFiles.length; i += 1) {
          currentPhotos = await appendPhotoToExistingContainer(selectedContainerId, currentPhotos, selectedFiles[i], i);
        }
      }

      if (preview) URL.revokeObjectURL(preview);
      setPhoto(null);
      setExtraPhotos([]);
      setPreview(null);
      setSelectedLocationId('');
      setNewLocationName('');
      setSelectedParentId(null);
      setSelectedContainerId('');
      setNewContainerName('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      console.error('[handleSave] code:', err?.code, '| message:', err?.message, '| full:', err);
      setSaveError(t('main.errors.saveFailed'));
    } finally {
      setSaving(false);
      setSaveProgressText('');
    }
  }


  async function handleUpdatePhoto(e: any) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = '';

    if (!file || !updatingContainerId || saving) return;

    setSaving(true);
    setSaveError('');

    try {
      if (!auth.currentUser) {
        setSaveError(t('main.errors.sessionExpired'));
        return;
      }

      await auth.currentUser.getIdToken(true);

      const compressed = await imageCompression(file, {
        maxWidthOrHeight: 1600,
        initialQuality: 0.85,
        useWebWorker: true,
        maxSizeMB: 0.5,
      });

      const containerId = updatingContainerId;
      const existing = containers.find(c => c.id === containerId);

      let photoUrl: string;
      let storagePath: string;

      storagePath = `users/${viewingOwnerUid}/containers/${containerId}/photos/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
      await uploadBytes(ref(storage, storagePath), compressed);
      photoUrl = await getDownloadURL(ref(storage, storagePath));

      const photoItem: PhotoItem = {
        id: crypto.randomUUID(),
        url: photoUrl,
        storagePath,
        description: '',
        createdAt: Date.now(),
        addedBy: user.uid,
        addedByName: user.displayName ?? user.email?.split('@')[0] ?? 'Someone',
        moderationStatus: 'pending',
        moderationCheckedAt: null,
        moderationProvider: null,
        moderationReason: null,
      };

      const updatedPhotos = [...(existing?.photos ?? []), photoItem];

      const service = collaboratorInventoryService();
      if (service) {
        const result = await service.addPhoto(containerId, photoItem);
        if (!result.ok) throw new Error(`collaboration-photo:${result.reason}`);
      } else {
        await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${containerId}`), {
          photos: updatedPhotos,
          photoUrls: arrayUnion(photoUrl),
          photoStoragePaths: arrayUnion(storagePath),
          lastModifiedAt: serverTimestamp(),
          lastModifiedBy: user.uid,
          lastModifiedByName: user.displayName ?? user.email?.split('@')[0] ?? 'Someone',
        });
      }
    } catch (err: any) {
      console.error('[handleUpdatePhoto] code:', err?.code, '| message:', err?.message, '| full:', err);
      setSaveError(t('main.errors.saveFailed'));
    } finally {
      setSaving(false);
      setUpdatingContainerId(null);
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
      closeLightbox();
    } else {
      const newIndex = Math.min(lightboxIndex, remaining.length - 1);
      setLightboxItems(remaining);
      setLightboxIndex(newIndex);
      setTimeout(() => {
        if (scrollRef.current) scrollRef.current.scrollLeft = newIndex * scrollRef.current.offsetWidth;
      }, 0);
    }
  }


    async function handleSaveAiDescription(photoId: string, newDesc: string) {
      if (!auth.currentUser || !lightboxContainerId) return;
      await auth.currentUser.getIdToken(true);
      const _cnt = containers.find(cc => cc.id === lightboxContainerId);
      if (!_cnt) return;
      const _up = (_cnt.photos ?? []).map((p: any) => p.id === photoId ? { ...p, aiDescription: newDesc } : p);
      await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${lightboxContainerId}`), { photos: _up });
      setLightboxItems(prev => prev ? prev.map(p => p.id === photoId ? { ...p, aiDescription: newDesc } : p) : prev);
    }

    async function handleSaveAiTags(photoId: string, tagsStr: string) {
      if (!auth.currentUser || !lightboxContainerId) return;
      await auth.currentUser.getIdToken(true);
      const newTags = tagsStr.split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0);
      const _cnt = containers.find(cc => cc.id === lightboxContainerId);
      if (!_cnt) return;
      const _up = (_cnt.photos ?? []).map((p: any) => p.id === photoId ? { ...p, aiTags: newTags } : p);
      await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${lightboxContainerId}`), { photos: _up });
      setLightboxItems(prev => prev ? prev.map(p => p.id === photoId ? { ...p, aiTags: newTags } : p) : prev);
    }

    async function handleRetryPhotoAi(photoId: string) {
      if (!auth.currentUser || !lightboxContainerId) return;

      setRetryingAiPhotoIds(prev => {
        const next = new Set(prev);
        next.add(photoId);
        return next;
      });

      setLightboxItems(prev =>
        prev
          ? prev.map((p: any) =>
              p.id === photoId
                ? {
                    ...p,
                    aiStatus: 'processing',
                    aiDescription: '',
                    aiTags: [],
                    aiObjects: [],
                  }
                : p
            )
          : prev
      );

      try {
        await auth.currentUser.getIdToken(true);

        const ownerUid = viewingOwnerUid || auth.currentUser.uid;
        const _cntRef = doc(db, `users/${ownerUid}/containers/${lightboxContainerId}`);
        await runTransaction(db, async (tx) => {
          const _snap = await tx.get(_cntRef);
          const _freshPhotos: any[] = _snap.data()?.photos ?? [];
          const _up = _freshPhotos.map((p: any) =>
            p.id === photoId
              ? {
                  ...p,
                  aiStatus: 'retry' as const,
                  aiError: null,
                  aiRetryRequestedAt: Date.now(),
                }
              : p
          );
          tx.update(_cntRef, { photos: _up });
        });

      } catch (err) {
        console.error('Failed to retry AI analysis', err);

        setRetryingAiPhotoIds(prev => {
          const next = new Set(prev);
          next.delete(photoId);
          return next;
        });

        setLightboxItems(prev =>
          prev
            ? prev.map((p: any) =>
                p.id === photoId
                  ? { ...p, aiStatus: 'error' }
                  : p
              )
            : prev
        );
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
    const service = collaboratorInventoryService();
    if (service) {
      const result = await service.addNote(containerId, note);
      if (!result.ok) throw new Error(`collaboration-note:${result.reason}`);
      return;
    }
    await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${containerId}`), { notes: arrayUnion(note) });
  }

  async function handleEditNote(containerId: string, noteId: string, text: string) {
    if (!auth.currentUser) return;
    await auth.currentUser.getIdToken(true);
    const service = collaboratorInventoryService();
    if (service) {
      const result = await service.editNote(containerId, noteId, text);
      if (!result.ok) throw new Error(`collaboration-note-edit:${result.reason}`);
      return;
    }
    const container = containers.find(c => c.id === containerId);
    if (!container) return;
    const notes = container.notes.map(note =>
      note.id === noteId ? { ...note, text: text.trim() } : note
    );
    await updateDoc(
      doc(db, `users/${viewingOwnerUid}/containers/${containerId}`),
      { notes },
    );
  }

  async function handleDeleteNote(containerId: string, noteId: string) {
    if (!auth.currentUser) return;
    await auth.currentUser.getIdToken(true);
    const container = containers.find(c => c.id === containerId);
    if (!container) return;
    const updated = container.notes.map(n => n.id === noteId ? { ...n, deletedAt: Date.now() } : n);
    await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${containerId}`), { notes: updated });
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
        (c.aiSearchTerms ?? []).join(' ').toLowerCase().includes(trimmedQuery) ||
        c.notes.filter(n => !n.deletedAt).some(n => n.text.toLowerCase().includes(trimmedQuery)) ||
        c.photos.filter(p => !p.deletedAt).some(p =>
          p.description.toLowerCase().includes(trimmedQuery) ||
          (p.aiDescription?.toLowerCase().includes(trimmedQuery) ?? false) ||
          (p.aiTags?.some(t => t.toLowerCase().includes(trimmedQuery)) ?? false) ||
          (p.aiObjects?.some(o => o.toLowerCase().includes(trimmedQuery)) ?? false)
        )
      )
    : activeContainers
  ).filter(c => {
    if (c.photos.filter(p => !p.deletedAt).length === 0) return false;
    // Hide private containers from collaborators
    if (viewingOwnerUid !== user.uid && c.effectiveIsPrivate) return false;
    return true;
  });

  const photoMatchMap = new Map<string, PhotoItem[]>();
  if (trimmedQuery) {
    filteredContainers.forEach(c => {
      const matches = c.photos.filter(p => !p.deletedAt && (
        p.description.toLowerCase().includes(trimmedQuery) ||
        (p.aiDescription?.toLowerCase().includes(trimmedQuery) ?? false) ||
        (p.aiTags?.some(t => t.toLowerCase().includes(trimmedQuery)) ?? false) ||
        (p.aiObjects?.some(o => o.toLowerCase().includes(trimmedQuery)) ?? false)
      ));
      if (matches.length > 0) photoMatchMap.set(c.id, matches);
    });
  }

  const grouped = filteredContainers.reduce<Record<string, Container[]>>((acc, c) => {
    const locKey = displayLocation(c);
    if (!acc[locKey]) acc[locKey] = [];
    acc[locKey].push(c);
    return acc;
  }, {});
  const locationKeys = Object.keys(grouped);

  const isAutomobileLocationName = (name: string) =>
    /\b(auto|autos|automobile|automobiles|vehicle|vehicles|car|cars|truck|trucks|van|vans|suv|jeep|bronco)\b/i.test(name);

  const getSortedLocationChildren = (parentId: string | null = null): Location[] =>
    locations
      .filter(l => (l.parentId ?? null) === parentId)
      .sort((a, b) => {
        if (parentId === null) {
          const autoA = isAutomobileLocationName(a.name) ? 1 : 0;
          const autoB = isAutomobileLocationName(b.name) ? 1 : 0;
          if (autoA !== autoB) return autoA - autoB;
        }
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });

  const buildLocationOptions: (parentId?: string | null) => Location[] = (parentId = null) =>
    getSortedLocationChildren(parentId)
      .flatMap(loc => [loc, ...buildLocationOptions(loc.id)]);

  const formatLocationOptionLabel = (loc: Location): string => {
    const ancestors: Location[] = [];
    let current = loc;

    while (current.parentId) {
      const parent = locations.find(l => l.id === current.parentId);
      if (!parent) break;
      ancestors.unshift(parent);
      current = parent;
    }

    if (ancestors.length === 0) return loc.name;

    const gap = '\u00A0\u00A0';
    const prefix = ancestors.map(() => `${gap}${gap}`).join('');

    const siblings = getSortedLocationChildren(loc.parentId ?? null);
    const isLast = siblings[siblings.length - 1]?.id === loc.id;
    return `${prefix}${isLast ? '└─' : '├─'} ${loc.name}`;
  };

  const locationOptions = buildLocationOptions();


  function openLightbox(c: Container) {
    const activePhotos = c.photos.filter(p => !p.deletedAt).reverse();
    if (activePhotos.length === 0) return;
    // Reverse filtered photos to newest-first, matching activePhotos ordering
    const filtered = photoMatchMap.get(c.id);
    const filteredSorted = filtered ? [...filtered].reverse() : null;
    const photosToShow = filteredSorted ?? activePhotos;
    setLightboxItems(photosToShow);
    setLightboxContainerId(c.id);
    setLightboxIndex(0);
    setLightboxDescDraft(photosToShow[0].description ?? '');
    setLightboxAllPhotos(filteredSorted ? activePhotos : null);
    setLightboxFilterQuery(filteredSorted ? trimmedQuery : '');
    // Reset scroll so the lightbox always opens on photo 0
    setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollLeft = 0; }, 0);
  }

  function closeLightbox() {
    setLightboxItems(null);
    setLightboxContainerId(null);
    setLightboxAllPhotos(null);
    setLightboxFilterQuery('');
  }

  async function handleRenameContainer() {
    if (!renamingContId || !renamingDraft.trim()) return;
    await updateDoc(doc(db, `users/${user.uid}/containers/${renamingContId}`), { name: renamingDraft.trim() });
    setRenamingContId(null);
  }

  function renderContainerRow(c: Container, showLocation = false) {
    const activePhotos = c.photos.filter(p => !p.deletedAt);
    const lastPhoto    = activePhotos[activePhotos.length - 1];
    const matchedPhotos = photoMatchMap.get(c.id);
    // When search is active, show the newest matching photo (array is oldest-first)
    const thumbPhoto = matchedPhotos ? matchedPhotos[matchedPhotos.length - 1] : lastPhoto;
    return (
      <div key={c.id} className="container-row">
        {viewingOwnerUid === user.uid && (
          <button className="delete-container-btn" onClick={() => handleDeleteContainer(c)}>✕</button>
        )}
        <div className="thumb-wrap" onClick={() => openLightbox(c)}>
          {thumbPhoto && <ThumbImage storagePath={thumbPhoto.storagePath} alt={c.name} />}
          {matchedPhotos ? (
            <span className="photo-count photo-count--match">
              {matchedPhotos.length === 1 ? '1 match' : `${matchedPhotos.length} matches`}
            </span>
          ) : activePhotos.length > 1 ? (
            <span className="photo-count">{activePhotos.length}</span>
          ) : null}
        </div>
        <div className="container-meta">
          <div className={`container-name${c.name === 'Loose items' ? ' container-name--loose' : ''}`}>
            {c.name}
            {viewingOwnerUid === user.uid && (
              <button
                onClick={async () => {
                  if (c.effectiveIsPrivate) {
                    await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${c.id}`), {
                      visibility: 'shared', effectiveIsPrivate: false, isPrivate: false,
                    });
                  } else {
                    await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${c.id}`), {
                      visibility: 'private', effectiveIsPrivate: true, isPrivate: true,
                    });
                  }
                }}
                className="container-lock-btn"
                aria-label={c.effectiveIsPrivate ? t('main.card.privateLabel') : t('main.card.visibleLabel')}
                title={c.effectiveIsPrivate ? t('main.card.privateLabel') : t('main.card.visibleLabel')}
                data-locked={c.effectiveIsPrivate ? 'true' : 'false'}
              >
                {c.effectiveIsPrivate ? '🔒' : '🔓'}
              </button>
            )}
          </div>
          {showLocation && <div className="container-location">{displayLocation(c)}</div>}
          <div className="container-time">{relativeTime(c.createdAt)}</div>
          {c.aiStatus === 'processing' && <div className="ai-processing">{t('main.card.aiProcessing')}</div>}
          <ContainerNotes
            containerId={c.id}
            notes={c.notes.filter(n => !n.deletedAt)}
            onAdd={handleAddNote}
            onEdit={handleEditNote}
            onDelete={handleDeleteNote}
            canDelete={viewingOwnerUid === user.uid}
            canEdit
          />
          <div className="container-actions">
                                                <button
                          className="card-action-btn"
                          onClick={() => {
                            if (/CriOS/.test(navigator.userAgent)) { setShowIOSModal(true); return; }
                            setUpdatingContainerId(null);
                            setContinuousCapture(true);
                            setCaptureQueue([]);
                            setCaptureContainerId(c.id);
                            setCardMoreOpenId(null);
                          }}
                          >
                            {t('main.card.addItems')}
                        </button>
<button
              className="card-action-btn card-action-btn--desktop-only"
              onClick={() => { setPrintContainer(c); setCardMoreOpenId(null); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 3h8v8H3V3zm1.5 1.5v5h5v-5h-5z"/><rect x="6" y="6" width="2" height="2"/><path d="M13 3h8v8h-8V3zm1.5 1.5v5h5v-5h-5z"/><rect x="16" y="6" width="2" height="2"/><path d="M3 13h8v8H3v-8zm1.5 1.5v5h5v-5h-5z"/><rect x="6" y="16" width="2" height="2"/><rect x="13" y="13" width="2" height="2"/><rect x="16" y="13" width="2" height="2"/><rect x="19" y="13" width="2" height="2"/><rect x="13" y="16" width="2" height="2"/><rect x="19" y="16" width="2" height="2"/><rect x="13" y="19" width="2" height="2"/><rect x="16" y="19" width="2" height="2"/><rect x="19" y="19" width="2" height="2"/></svg>
              {t('main.card.printQR')}
            </button>
            <button
              className="card-action-btn card-action-btn--desktop-only"
              onClick={() => setMoveSource({ containerId: c.id, mode: 'container' })}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>
              {t('main.card.moveBox')}
            </button>
            {viewingOwnerUid === user.uid && (
              <div className="card-more-wrap">
                <button
                  className="card-action-btn"
                  onClick={e => { e.stopPropagation(); setCardMoreOpenId(cardMoreOpenId === c.id ? null : c.id); }}
                  aria-label="More actions"
                >
                  ⋯
                </button>
                {cardMoreOpenId === c.id && (
                                    <div className="card-more-dropdown">
                    <button className="card-more-item card-more-item--mobile-only" onClick={() => { setMoveSource({ containerId: c.id, mode: 'container' }); setCardMoreOpenId(null); }}>{t('main.card.moveBox')}</button>
                    <button className="card-more-item" onClick={() => { setSellContainer(c); setSellSourcePhotos(photoMatchMap.get(c.id) ?? null); setSellSourceContainerIds(null); setSellIsFromTray(false); setCardMoreOpenId(null); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" /></svg>
                      {t('sell.heading')}
                    </button>
                    <button className="card-more-item" onClick={() => { setRenamingContId(c.id); setRenamingDraft(c.name); setCardMoreOpenId(null); }}>{ t('manage.rename') }</button>
                    <button className="card-more-item card-more-item--mobile-only" onClick={() => { setPrintContainer(c); setCardMoreOpenId(null); }}>{t('main.card.printQR')}</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  async function generateInviteLink() {
    setGeneratingInvite(true);
    try {
      const token = crypto.randomUUID();
      const nowMs = Date.now();
      const expiresAtMs = inviteExpiry
        ? nowMs + inviteExpiry * 24 * 60 * 60 * 1000
        : null;
      const lifecycle = createFirebaseLifecycleAdapter(db, {
        nowMs: () => Date.now(),
        newAccessId: () => crypto.randomUUID(),
      });
      await lifecycle.issueInvitation({
        invitationId: token,
        ownerUid: user.uid,
        createdByUid: user.uid,
        nowMs,
        expiresAtMs,
      });
      setInviteLink(`${window.location.origin}/invite/${token}`);
    } catch (e) {
      console.error('Failed to generate invite link', e);
    } finally {
      setGeneratingInvite(false);
    }
  }

  async function revokeCollaborator(collaboratorUid: string) {
    if (!window.confirm('Remove this person\'s access?')) return;
    try {
      const lifecycle = createFirebaseLifecycleAdapter(db, {
        nowMs: () => Date.now(),
        newAccessId: () => crypto.randomUUID(),
      });
      await lifecycle.revokeAccess(user.uid, collaboratorUid);
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
        {/* Hamburger — mobile only, hidden on desktop via CSS */}
        <button
          className="mobile-menu-btn"
          aria-label="Open menu"
          onClick={() => setShowMobileMenu(v => !v)}
        >
          <span /><span /><span />
        </button>

        <div className="header-actions">
          {viewingOwnerUid === user.uid && trayPhotos.length > 0 && (
            <button className="tray-indicator-btn" onClick={() => setShowTray(true)}>
              {t('main.tray.sellHeading')} ({trayPhotos.length})
            </button>
          )}
          {sharedInventories.length > 0 && (
            <select
              value={viewingOwnerUid}
              onChange={e => setViewingOwnerUid(e.target.value)}
              style={{
                padding: '6px 10px', borderRadius: 20, border: '1px solid #ddd',
                background: '#faf8f6', fontSize: 13, color: '#333', cursor: 'pointer',
              }}
            >
              <option value={user.uid}>{t('main.header.myInventory')}</option>
              {sharedInventories.map(s => (
                <option key={s.ownerUid} value={s.ownerUid}>{t('main.header.othersInventory', { name: s.ownerLabel })}</option>
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
              {t('main.header.manage')}
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
              {t('main.header.collaborators')}
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
              {t('main.header.share')}
            </button>
          )}
          {trashCount > 0 && (
            <button className="trash-link" onClick={() => navigate('/trash')}>
              {t('main.header.recentlyDeleted', { count: trashCount })}
            </button>
          )}
          <select
            value={(() => {
              const r = i18n.resolvedLanguage ?? i18n.language;
              if (r.startsWith('pt')) return 'pt-BR';
              if (r.startsWith('es')) return 'es';
              return 'en';
            })()}
            onChange={e => i18n.changeLanguage(e.target.value)}
            style={{
              padding: '6px 10px', borderRadius: 20, border: '1px solid #ddd',
              background: '#faf8f6', fontSize: 13, color: '#333', cursor: 'pointer',
            }}
          >
            <option value="en">{t('language.en')}</option>
            <option value="es">{t('language.es')}</option>
            <option value="pt-BR">{t('language.ptBR')}</option>
          </select>
          <button
            onClick={() => navigate('/profile')}
            style={{
              padding: '6px 14px', borderRadius: 20, border: '1px solid #ddd',
              background: '#fff', color: '#555', fontSize: 13, cursor: 'pointer',
            }}
          >
            {t('main.header.profile')}
          </button>
          <button className="sign-out-btn" onClick={() => signOut(auth)}>{t('main.header.signOut')}</button>
        </div>
      </header>

      {/* Mobile slide-down menu */}
      {showMobileMenu && (
        <div className="mobile-menu-backdrop" onClick={() => setShowMobileMenu(false)}>
          <div className="mobile-menu-panel" onClick={e => e.stopPropagation()}>
            {sharedInventories.length > 0 && (
              <div className="mobile-menu-section">
                <span className="mobile-menu-label">{t('main.menu.inventoryLabel')}</span>
                <select
                  value={viewingOwnerUid}
                  onChange={e => { setViewingOwnerUid(e.target.value); setShowMobileMenu(false); }}
                  className="mobile-menu-select"
                >
                  <option value={user.uid}>{t('main.header.myInventory')}</option>
                  {sharedInventories.map(s => (
                    <option key={s.ownerUid} value={s.ownerUid}>{t('main.header.othersInventory', { name: s.ownerLabel })}</option>
                  ))}
                </select>
              </div>
            )}
            {viewingOwnerUid === user.uid && (
              <button className="mobile-menu-item" onClick={() => { navigate('/manage'); setShowMobileMenu(false); }}>{t('main.header.manage')}</button>
            )}
            {viewingOwnerUid === user.uid && (
              <button className="mobile-menu-item" onClick={() => { navigate('/collaborators'); setShowMobileMenu(false); }}>{t('main.header.collaborators')}</button>
            )}
            {viewingOwnerUid === user.uid && (
              <button className="mobile-menu-item" onClick={() => { setShowInvitePanel(true); setShowMobileMenu(false); }}>{t('main.header.share')}</button>
            )}
            {trashCount > 0 && (
              <button className="mobile-menu-item" onClick={() => { navigate('/trash'); setShowMobileMenu(false); }}>
                {t('main.header.recentlyDeleted', { count: trashCount })}
              </button>
            )}
            <button className="mobile-menu-item" onClick={() => { navigate('/profile'); setShowMobileMenu(false); }}>{t('main.header.profile')}</button>
            <div className="mobile-menu-section">
              <span className="mobile-menu-label">{t('language.label')}</span>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                {(['en', 'es', 'pt-BR'] as const).map(lang => {
                  const resolved = i18n.resolvedLanguage ?? i18n.language;
                  const isActive = lang === 'pt-BR' ? resolved.startsWith('pt') : resolved.startsWith(lang);
                  const label = lang === 'en' ? t('language.en') : lang === 'es' ? t('language.es') : t('language.ptBR');
                  return (
                    <button key={lang} onClick={() => i18n.changeLanguage(lang)}
                      style={{ padding: '6px 12px', borderRadius: 20,
                        border: `1px solid ${isActive ? 'var(--terracotta)' : 'var(--warm-gray)'}`,
                        background: isActive ? 'var(--terracotta)' : 'none',
                        color: isActive ? 'white' : 'var(--charcoal)',
                        fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <button className="mobile-menu-item mobile-menu-signout" onClick={() => signOut(auth)}>{t('main.header.signOut')}</button>
          </div>
        </div>
      )}

      {/* Collaborator mode banner */}
      {viewingOwnerUid !== user.uid && (
        <div className="collab-banner">
          {t('main.collab.banner', { name: sharedInventories.find(s => s.ownerUid === viewingOwnerUid)?.ownerLabel ?? 'authorized shared inventory' })}
        </div>
      )}
      {collaborationError && (
        <div className="collab-banner" role="alert">{collaborationError}</div>
      )}

      <main className="main-content">
        {isBrandNewUser ? (
        <section className="onboard-card">
          <img src={logoMark} alt="" className="onboard-logo" />
          <h1 className="onboard-title">{t('main.onboarding.title')}</h1>
          <p className="onboard-tagline">{t('main.onboarding.tagline')}</p>

          {!showFirstLocationInput ? (
            <button className="onboard-primary-btn" onClick={() => setShowFirstLocationInput(true)}>
              {t('main.onboarding.createFirstLocation')}
            </button>
          ) : (
            <div className="onboard-input-block">
              <p className="onboard-input-label">
                {t('main.onboarding.locationInputLabel')}
              </p>
              <div className="onboard-input-row">
                <input
                  type="text"
                  className="onboard-input"
                  placeholder={t('main.onboarding.locationPlaceholder')}
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
                  {creatingFirstLocation ? t('main.onboarding.creating') : t('main.onboarding.create')}
                </button>
              </div>
            </div>
          )}
          {saveError && <p className="save-error">{saveError}</p>}

          <button className="onboard-secondary-btn" onClick={() => setShowHowItWorks(v => !v)}>
            {showHowItWorks ? t('main.onboarding.hideHowItWorks') : t('main.onboarding.seeHowItWorks')}
          </button>

          {showHowItWorks && (
            <ol className="onboard-steps">
              <li>
                <span className="onboard-step-icon">📍</span>
                <span><strong>{t('main.onboarding.steps.locationTitle')}</strong> — {t('main.onboarding.steps.locationBody')}</span>
              </li>
              <li>
                <span className="onboard-step-icon">📦</span>
                <span><strong>{t('main.onboarding.steps.containerTitle')}</strong> — {t('main.onboarding.steps.containerBody')}</span>
              </li>
              <li>
                <span className="onboard-step-icon">📷</span>
                <span><strong>{t('main.onboarding.steps.photosTitle')}</strong> — {t('main.onboarding.steps.photosBody')}</span>
              </li>
              <li>
                <span className="onboard-step-icon">✨</span>
                <span><strong>{t('main.onboarding.steps.aiTitle')}</strong> — {t('main.onboarding.steps.aiBody')}</span>
              </li>
              <li>
                <span className="onboard-step-icon">🔗</span>
                <span><strong>{t('main.onboarding.steps.qrTitle')}</strong> — {t('main.onboarding.steps.qrBody')}</span>
              </li>
            </ol>
          )}
        </section>
        ) : (
        <>
        <section className="capture-card">
          {showFirstBoxHint && (
            <div className="onboard-hint">{t('main.firstBoxHint')}</div>
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
              <option value="">{t('main.capture.selectLocation')}</option>
              {locationOptions.map(loc => (
                <option key={loc.id} value={loc.id}>
                  {formatLocationOptionLabel(loc)}
                </option>
              ))}
              <option value="new">{t('main.capture.addNewLocation')}</option>
            </select>

            {selectedLocationId === 'new' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    className="container-input"
                    placeholder={t('main.capture.locationNamePlaceholder')}
                    value={newLocationName}
                    disabled={saving}
                    style={{ flex: 1 }}
                    onChange={e => setNewLocationName(e.target.value)}
                  />
                  <button
                    disabled={!newLocationName.trim() || saving}
                    onClick={async () => {
                      const id = await createLocationForActiveInventory(newLocationName.trim(), selectedParentId);
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
                    {t('main.capture.add')}
                  </button>
                </div>
                {locations.length > 0 && (
                  <select
                    className="container-select"
                    value={selectedParentId ?? ''}
                    disabled={saving}
                    onChange={e => setSelectedParentId(e.target.value || null)}
                  >
                    <option value="">{t('main.capture.topLevel')}</option>
                    {locationOptions.map(loc => (
                      <option key={loc.id} value={loc.id}>
                        {t('main.capture.insideLocation', { name: formatLocationOptionLabel(loc) })}
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
              <option value="">{t('main.capture.selectContainer')}</option>
              {selectedLocationId && selectedLocationId !== 'new' && (
                <option value="__loose__">Add directly to this space</option>
              )}
            {[...containersAtLocation.filter(c => c.name !== 'Loose items')]
              .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
              .map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
              <option value="new">Add a container (box, bin, drawer…)</option>
            </select>

            {selectedContainerId && selectedContainerId !== 'new' && (
              <p className="container-confirm">
                {selectedContainerId === '__loose__'
                  ? 'Adding directly to this space'
                  : t('main.capture.addingTo', { name: activeContainers.find(c => c.id === selectedContainerId)?.name })}
              </p>
            )}

            {selectedContainerId === 'new' && (
              <input
                type="text"
                placeholder={t('main.capture.containerNamePlaceholder')}
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
              <input type="file" accept="image/*" multiple disabled={saving} onChange={e => {
                const files = Array.from(e.target.files ?? []);
                if (files.length === 0) return;
                if (preview) URL.revokeObjectURL(preview);
                setSaveError('');
                setSaved(false);
                setSaveProgressText('');
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
                  <span>{t('main.capture.photoPlaceholder')}</span>
                  <span style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>{t('main.capture.photoHint')}</span>
                </div>
              )}
              {extraPhotos.length > 0 && (
                <div style={{
                  position: 'absolute', bottom: 8, right: 8,
                  background: '#7a3b2e', color: '#fff', borderRadius: 12,
                  padding: '3px 10px', fontSize: 13, fontWeight: 600,
                }}>
                  {t('main.capture.photosSelected', { count: extraPhotos.length + 1 })}
                </div>
              )}
            </label>

            {photo && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                fontSize: 13,
                color: '#7a3b2e',
              }}>
                <span>
                  {extraPhotos.length + 1} photo{extraPhotos.length === 0 ? '' : 's'} selected
                </span>
                <button
                  type="button"
                  onClick={clearCaptureSelection}
                  disabled={saving}
                  style={{
                    border: '1px solid #c8a090',
                    background: '#fff',
                    color: '#7a3b2e',
                    borderRadius: 8,
                    padding: '6px 10px',
                    fontSize: 13,
                    cursor: saving ? 'not-allowed' : 'pointer',
                  }}
                >
                  Clear selection
                </button>
              </div>
            )}

            {saving && saveProgressText && (
              <p className="container-confirm" style={{ marginTop: 0 }}>
                ⏳ {saveProgressText}
              </p>
            )}
          </div>

          {saveError && <p className="save-error">{saveError}</p>}
          <button className={`save-btn${saved ? ' saved' : ''}`} onClick={handleSave} disabled={!canSave}>
            {saving ? (saveProgressText || t('main.capture.saving')) : saved ? t('main.capture.saved') : t('main.capture.save')}
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
              {saving ? t('main.capture.creating') : t('main.capture.createNoPhoto')}
            </button>
          )}
        </section>

        <div className="search-sell-row">
          <div className="search-wrap">
            <input
              type="text"
              className="search-input"
              placeholder={t('main.search.placeholder')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && <button className="search-clear" onClick={() => setSearchQuery('')}>✕</button>}
          </div>
          {viewingOwnerUid === user.uid && (
            <button className="sell-from-search-btn" onClick={() => setShowTray(true)}>
              {trayPhotos.length > 0 ? `${t('main.tray.sell')} (${trayPhotos.length})` : t('main.tray.sell')}
            </button>
          )}
        </div>

        <section className="container-list">
          {activeContainers.length === 0 ? (
            <p className="list-empty">{t('main.search.empty')}</p>
          ) : filteredContainers.length === 0 ? (
            <p className="list-empty">{t('main.search.noResults', { query: searchQuery })}</p>
          ) : trimmedQuery ? (
            filteredContainers.map(c => renderContainerRow(c, true))
          ) : (
            locationKeys.map(loc => (
              <div key={loc} className="location-group">
                <div className="location-heading-row">
                  <h2 className="location-heading">{loc}</h2>
                  {viewingOwnerUid === user.uid && (
                    <button className="delete-location-btn" onClick={() => handleDeleteLocation(loc)}>✕</button>
                  )}
                </div>
                {[...grouped[loc]].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'})).map(c=>renderContainerRow(c))}
              </div>
            ))
          )}
        </section>
        </>
        )}
      </main>

      <input type="file" ref={updatePhotoInputRef} className="photo-input-hidden" onChange={handleUpdatePhoto} />

      {lightboxItems && (
        <div className="lightbox-backdrop" onClick={closeLightbox}>
          <div className="lightbox-toolbar" onClick={e => e.stopPropagation()}>
            {viewingOwnerUid === user.uid && (
              <button className="lightbox-delete" onClick={handleDeletePhoto}>{t('main.lightbox.delete')}</button>
            )}
            <button className="lightbox-action" onClick={() => {
              if (!lightboxContainerId || !lightboxItems) return;
              setMoveSource({
                containerId: lightboxContainerId,
                mode: 'photo',
                photoId: lightboxItems[lightboxIndex].id,
              });
            }}>{t('main.lightbox.movePhoto')}</button>
            <label className="lightbox-action lightbox-camera-label">
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
                    const photoItem: PhotoItem = { id: crypto.randomUUID(), url: photoUrl, storagePath, description: '', createdAt: Date.now(), addedBy: user.uid, addedByName: user.displayName ?? user.email?.split('@')[0] ?? 'Someone', moderationStatus: 'pending', moderationCheckedAt: null, moderationProvider: null, moderationReason: null };
                    await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${lightboxContainerId}`), {
                      photos: arrayUnion(photoItem),
                      photoUrls: arrayUnion(photoUrl),
                      photoStoragePaths: arrayUnion(storagePath),
                      lastModifiedAt: serverTimestamp(),
                      lastModifiedBy: user.uid,
                      lastModifiedByName: user.displayName ?? user.email?.split('@')[0] ?? 'Someone',
                    });
                    // Update lightboxItems immediately so the new photo appears without
                    // closing and reopening the lightbox. Prepend because the array is
                    // newest-first (matches the .reverse() in openLightbox).
                    setLightboxItems(prev => prev ? [photoItem, ...prev] : [photoItem]);
                    setLightboxIndex(0);
                    setTimeout(() => {
                      if (scrollRef.current) scrollRef.current.scrollLeft = 0;
                    }, 0);
                  } catch {
                    setSaveError(t('main.lightbox.photoFailed'));
                  } finally {
                    setSaving(false);
                  }
                }}
              />
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.776 48.776 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" /></svg>
              {t('main.lightbox.addPhoto')}
            </label>
            {viewingOwnerUid === user.uid && lightboxContainerId && (
              <button
                className="lightbox-action"
                onClick={() => setMoveSource({ containerId: lightboxContainerId, mode: 'container' })}
              >
                {t('main.lightbox.moveBox')}
              </button>
            )}
            <button className="lightbox-close" onClick={closeLightbox} aria-label="Close">✕</button>
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
                <LightboxImage storagePath={item.storagePath} alt={`Photo ${i + 1}`} />
              </div>
            ))}
          </div>

          {lightboxItems.length > 1 && (
            <div className="lightbox-counter" onClick={e => e.stopPropagation()}>
              {lightboxIndex + 1} / {lightboxItems.length}
            </div>
          )}

          {lightboxAllPhotos && (
            <div className="lightbox-filter-banner" onClick={e => e.stopPropagation()}>
              <span className="lightbox-filter-label">
                {lightboxItems.length === 1 ? '1 matching photo' : `${lightboxItems.length} matching photos`}
                {' · '}Showing photos matching '{lightboxFilterQuery}'
              </span>
              <button
                className="lightbox-show-all-btn"
                onClick={() => {
                  setLightboxItems(lightboxAllPhotos);
                  setLightboxAllPhotos(null);
                  setLightboxFilterQuery('');
                  setLightboxIndex(0);
                  setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollLeft = 0; }, 0);
                }}
              >
                Show all photos
              </button>
            </div>
          )}

          {(() => {
            const photo = lightboxItems[lightboxIndex];
            if (!photo) return null;
            const isRetryingAi = retryingAiPhotoIds.has(photo.id) && photo.aiStatus === 'processing';
            const hasAiContent = !!(photo.aiDescription || (photo.aiTags && photo.aiTags.length > 0));
            const aiActionLabel = isRetryingAi
              ? t('main.lightbox.retryingAi')
              : hasAiContent
                ? t('main.lightbox.redoAi')
                : t('main.lightbox.runAi');
          
            // --- Processing state ---
            if (photo.aiStatus === 'processing') {
              return (
                <div className="lightbox-ai" onClick={e => e.stopPropagation()}>
                  <p className="lightbox-ai-processing">
                    {isRetryingAi ? t('main.lightbox.retryingAi') : t('main.lightbox.aiProcessing')}
                  </p>
                  <p className="lightbox-ai-processing-detail">
                    {isRetryingAi
                      ? 'This can take up to 1â2 minutes. You can keep using VOWVY while it finishes.'
                      : t('main.lightbox.aiProcessingDetail')}
                  </p>
                </div>
              );
            }
          
            // --- Unified return: description + tags + always-visible AI action button ---
            return (
              <div className="lightbox-ai" onClick={e => e.stopPropagation()}>
                {photo.aiDescription !== undefined && (
                  <div className="lightbox-ai-desc-wrap" onClick={e => e.stopPropagation()}>
                    {editingAiDesc ? (
                      <>
                        <textarea className="lightbox-ai-desc-input" value={aiDescDraft} onChange={e =>
                          setAiDescDraft(e.target.value)} rows={3} autoFocus />
                        <div className="lightbox-ai-edit-btns">
                          <button className="lightbox-ai-save-btn" onClick={() => { handleSaveAiDescription(photo.id, aiDescDraft); setEditingAiDesc(false); }}>Save</button>
                          <button className="lightbox-ai-cancel-btn" onClick={() => setEditingAiDesc(false)}>Cancel</button>
                        </div>
                      </>
                    ) : (
                      <p className="lightbox-ai-desc" onClick={() => { setEditingAiDesc(true); setAiDescDraft(photo.aiDescription ?? ''); }}>{photo.aiDescription}</p>
                    )}
                  </div>
                )}
                {photo.aiTags && photo.aiTags.length > 0 && (
                  <div className="lightbox-ai-tags-wrap" onClick={e => e.stopPropagation()}>
                    {editingAiTags ? (
                      <>
                        <input className="lightbox-ai-tags-input" value={aiTagsDraft} onChange={e => setAiTagsDraft(e.target.value)} placeholder="tag1, tag2, tag3" autoFocus />
                        <div className="lightbox-ai-edit-btns">
                          <button className="lightbox-ai-save-btn" onClick={() => { handleSaveAiTags(photo.id, aiTagsDraft); setEditingAiTags(false); }}>Save</button>
                          <button className="lightbox-ai-cancel-btn" onClick={() => setEditingAiTags(false)}>Cancel</button>
                        </div>
                      </>
                    ) : (
                      <div className="lightbox-ai-tags" onClick={() => { setEditingAiTags(true); setAiTagsDraft((photo.aiTags ?? []).join(', ')); }}>
                        {filterDisplayTags(photo.aiTags, 6).map((tag, i) => <span key={i} className="lightbox-ai-tag">{tag}</span>)}
                      </div>
                    )}
                  </div>
                )}
                {photo.aiStatus === 'error' && (
                  <p className="lightbox-ai-processing" style={{ color: '#c00' }}>
                    {photo.aiError ?? 'AI analysis failed for this photo.'}
                  </p>
                )}
                <div className="lightbox-ai-action" onClick={e => e.stopPropagation()}>
                  <button
                    type="button"
                    className="lightbox-ai-save-btn"
                    disabled={retryingAiPhotoIds.has(photo.id)}
                    onClick={() => handleRetryPhotoAi(photo.id)}
                  >
                    {aiActionLabel}
                  </button>
                </div>
              </div>
            );
          })()}

          {viewingOwnerUid === user.uid && lightboxContainerId && (() => {
            const photo = lightboxItems?.[lightboxIndex];
            const lbContainer = containers.find(c => c.id === lightboxContainerId);
            const alreadyAdded = photo ? trayPhotos.some(t => t.photo.id === photo.id) : false;
            return (
              <div className="lightbox-sell" onClick={e => e.stopPropagation()}>
                <button
                  className={`lightbox-add-tray-btn${alreadyAdded ? ' lightbox-add-tray-btn--added' : ''}`}
                  onClick={() => {
                    if (!photo || !lbContainer || alreadyAdded) return;
                    setTrayPhotos(prev => [...prev, { photo, containerId: lbContainer.id, containerName: lbContainer.name }]);
                  }}
                >
                  {alreadyAdded ? t('main.lightbox.addedToSell') : t('main.lightbox.addToSell')}
                </button>
              </div>
            );
          })()}

          <div className="lightbox-desc" onClick={e => e.stopPropagation()}>
            <input
              type="text"
              className="lightbox-desc-input"
              value={lightboxDescDraft}
              placeholder={t('main.lightbox.descriptionPlaceholder')}
              onChange={e => setLightboxDescDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && lightboxDescDraft !== (lightboxItems[lightboxIndex]?.description ?? '')) {
                  handleSavePhotoDescription();
                }
              }}
            />
            {lightboxDescDraft !== (lightboxItems[lightboxIndex]?.description ?? '') && (
              <button className="lightbox-desc-save" onClick={handleSavePhotoDescription}>{t('main.lightbox.save')}</button>
            )}
          </div>

          {viewingOwnerUid === user.uid && lightboxContainerId && (() => {
            const lbContainer = containers.find(c => c.id === lightboxContainerId);
            if (!lbContainer) return null;
            const locEffective = lbContainer.locationId
              ? (locations.find(l => l.id === lbContainer.locationId)?.effectiveIsPrivate ?? false)
              : false;
            return (
              <div className="lightbox-privacy" onClick={e => e.stopPropagation()}>
                <span className="lightbox-privacy-icon" aria-hidden="true">
                  {lbContainer.effectiveIsPrivate ? '🔒' : '🔓'}
                </span>
                <span className="lightbox-privacy-label">{t('main.lightbox.containerPrivacy')}</span>
                <select
                  className="lightbox-privacy-select"
                  value={lbContainer.visibility}
                  onChange={async e => {
                    const newVis = e.target.value as 'inherit' | 'private' | 'shared';
                    const newEffective = newVis === 'private' ? true : newVis === 'shared' ? false : locEffective;
                    await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${lightboxContainerId}`), {
                      visibility: newVis,
                      effectiveIsPrivate: newEffective,
                      isPrivate: newEffective,
                    });
                  }}
                >
                  <option value="inherit">{t('manage.followParent')}</option>
                  <option value="private">{t('manage.hideFromHelpers')}</option>
                  <option value="shared">{t('manage.showToHelpers')}</option>
                </select>
                <span className="lightbox-privacy-status">
                  {lbContainer.visibility === 'inherit'
                    ? lbContainer.effectiveIsPrivate
                      ? t('main.lightbox.followParentHidden')
                      : t('main.lightbox.followParentVisible')
                    : lbContainer.visibility === 'private'
                      ? t('main.lightbox.helpersCannotSee')
                      : t('main.lightbox.helpersCanSee')}
                </span>
              </div>
            );
          })()}
        </div>
      )}

      {cardMoreOpenId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setCardMoreOpenId(null)} />
      )}

      {renamingContId && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={() => setRenamingContId(null)}>
          <div style={{background:'var(--color-bg,#fff)',padding:'1.5rem',borderRadius:'8px',minWidth:'16rem'}} onClick={e=>e.stopPropagation()}>
            <input style={{width:'100%',padding:'.5rem',marginBottom:'.75rem',border:'1px solid #ccc',borderRadius:'4px',boxSizing:'border-box'}} value={renamingDraft} autoFocus onChange={e=>setRenamingDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')handleRenameContainer();if(e.key==='Escape')setRenamingContId(null);}} />
            <div style={{display:'flex',gap:'.5rem',justifyContent:'flex-end'}}>
              <button onClick={()=>setRenamingContId(null)}>Cancel</button>
              <button onClick={handleRenameContainer}>Save</button>
            </div>
          </div>
        </div>
      )}
      {printContainer && (
        <QRPrintModal container={printContainer} onClose={() => setPrintContainer(null)} />
      )}

      {showIOSModal && (
        <div className="ios-modal-backdrop" onClick={() => setShowIOSModal(false)}>
          <div className="ios-modal" onClick={e => e.stopPropagation()}>
            <p className="ios-modal-message">{t('main.ios.message')}</p>
            <p className="ios-modal-instruction">{t('main.ios.instruction')}</p>
            <button className="ios-modal-btn" onClick={handleCopyLink}>
              {copied ? t('main.ios.copied') : t('main.ios.copyLink')}
            </button>
            <button className="ios-modal-dismiss" onClick={() => setShowIOSModal(false)}>{t('main.ios.dismiss')}</button>
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
              disabled={saving}
              onChange={async e => {
                const file = e.target.files?.[0] ?? null;
                e.target.value = '';
                if (!file || saving) return;
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
          {saving && saveProgressText && (
            <div style={{
              background: 'rgba(122, 59, 46, 0.95)',
              color: '#fff',
              borderRadius: 999,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 700,
              boxShadow: '0 4px 18px rgba(0,0,0,0.24)',
            }}>
              ⏳ {saveProgressText}
            </div>
          )}
          <button
            onClick={async () => {
              if (saving) return;

              if (captureQueue.length === 0) {
                setCaptureQueue([]);
                setCaptureContainerId(null);
                setContinuousCapture(false);
                setSaveProgressText('');
                return;
              }

              if (!captureContainerId) return;

              setSaving(true);
              setSaveError('');
              setSaveProgressText(`Saving 1 of ${captureQueue.length} photo${captureQueue.length === 1 ? '' : 's'}…`);

              try {
                if (!auth.currentUser) {
                  setSaveError(t('main.errors.sessionExpired'));
                  return;
                }

                await auth.currentUser.getIdToken(true);

                const existing = containers.find(c => c.id === captureContainerId);
                let currentPhotos: PhotoItem[] = [...(existing?.photos ?? [])];

                for (let i = 0; i < captureQueue.length; i += 1) {
                  const file = captureQueue[i];
                  setSaveProgressText(`Saving ${i + 1} of ${captureQueue.length} photo${captureQueue.length === 1 ? '' : 's'}…`);

                  const compressed = await imageCompression(file, {
                    maxWidthOrHeight: 1600,
                    initialQuality: 0.85,
                    useWebWorker: false,
                    maxSizeMB: 0.5,
                  });

                  let photoUrl: string;
                  let storagePath: string;

                  if (viewingOwnerUid !== user.uid) {
                    const ab = await compressed.arrayBuffer();
                    const b64 = btoa(new Uint8Array(ab).reduce((s, b) => s + String.fromCharCode(b), ''));
                    const fn = httpsCallable<
                      { ownerUid: string; containerId: string; imageBase64: string; contentType: string },
                      { downloadURL: string; storagePath: string }
                    >(functions, 'uploadCollaboratorPhoto');
                    const r = await fn({
                      ownerUid: viewingOwnerUid,
                      containerId: captureContainerId,
                      imageBase64: b64,
                      contentType: compressed.type || 'image/jpeg',
                    });
                    photoUrl = r.data.downloadURL;
                    storagePath = r.data.storagePath;
                  } else {
                    storagePath = `users/${viewingOwnerUid}/containers/${captureContainerId}/photos/${Date.now()}-${i}-${Math.random().toString(36).slice(2)}.jpg`;
                    await uploadBytes(ref(storage, storagePath), compressed);
                    photoUrl = await getDownloadURL(ref(storage, storagePath));
                  }

                  const photoItem: PhotoItem = {
                    id: crypto.randomUUID(),
                    url: photoUrl,
                    storagePath,
                    description: '',
                    createdAt: Date.now(),
                    addedBy: user.uid,
                    addedByName: user.displayName ?? user.email?.split('@')[0] ?? 'Someone',
                    moderationStatus: 'pending',
                    moderationCheckedAt: null,
                    moderationProvider: null,
                    moderationReason: null,
                  };

                  currentPhotos = [...currentPhotos, photoItem];

                  await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${captureContainerId}`), {
                    photos: currentPhotos,
                    photoUrls: arrayUnion(photoUrl),
                    photoStoragePaths: arrayUnion(storagePath),
                    lastModifiedAt: serverTimestamp(),
                    lastModifiedBy: user.uid,
                    lastModifiedByName: user.displayName ?? user.email?.split('@')[0] ?? 'Someone',
                  });
                }

                setCaptureQueue([]);
                setCaptureContainerId(null);
                setContinuousCapture(false);
                setSaveProgressText('');
              } catch (err: any) {
                console.error('[continuousCapture] code:', err?.code, '| message:', err?.message, '| full:', err);
                setSaveError(t('main.errors.somePhotosFailed'));
              } finally {
                setSaving(false);
              }
            }}
            style={{
              padding: '8px 24px', borderRadius: 20, border: 'none',
              background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 14, cursor: 'pointer',
            }}
            disabled={saving}
          >
            {captureQueue.length > 0 ? t('main.captureMode.save', { count: captureQueue.length }) : t('main.captureMode.done')}
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
              {moveSource.mode === 'container' ? t('main.move.containerTitle') : t('main.move.photoTitle')}
            </h2>
            <p style={{ margin: 0, fontSize: 14, color: '#555' }}>
              {moveSource.mode === 'container' ? t('main.move.containerSubtitle') : t('main.move.photoSubtitle')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
              {moveSource.mode === 'container' ? (
                locations.length === 0 ? (
                  <p style={{ color: '#888', fontSize: 14, textAlign: 'center', padding: '20px 0' }}>
                    {t('main.move.noLocations')}
                  </p>
                ) : (
                  (() => {
                    const rootIds = locations.filter(l => !l.parentId).map(l => l.id);
                    return rootIds.map(rootId => {
                      const root = locations.find(l => l.id === rootId)!;
                      const children = locations.filter(l => {
                        let curr: any = l;
                        while (curr && curr.parentId) {
                          if (curr.parentId === rootId) return true;
                          curr = locations.find(loc => loc.id === curr.parentId);
                        }
                        return false;
                      });
                      return (
                        <div key={root.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                          <p style={{ margin: '4px 0', fontSize: 11, color: '#888', fontWeight: 700, textTransform: 'uppercase' }}>{root.name}</p>
                          <button
                            onClick={async () => {
                              const src = containers.find(c => c.id === moveSource.containerId);
                              if (!src) return;
                              await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${src.id}`), {
                                locationId: root.id,
                                location: root.name,
                              });
                              setMoveSource(null);
                            }}
                            style={{
                              textAlign: 'left', padding: '10px 14px', borderRadius: 8,
                              border: '1px solid #eee', background: '#faf8f6',
                              cursor: 'pointer', fontSize: 13, color: '#333',
                            }}
                          >
                            {root.name}
                          </button>
                          {children.map(child => (
                            <button
                              key={child.id}
                              onClick={async () => {
                                const src = containers.find(c => c.id === moveSource.containerId);
                                if (!src) return;
                                await updateDoc(doc(db, `users/${viewingOwnerUid}/containers/${src.id}`), {
                                  locationId: child.id,
                                  location: getLocationPath(child.id, locations),
                                });
                                setMoveSource(null);
                              }}
                              style={{
                                textAlign: 'left', padding: '10px 14px', borderRadius: 8,
                                border: '1px solid #eee', background: '#fff',
                                cursor: 'pointer', fontSize: 13, color: '#555',
                                marginLeft: 12,
                              }}
                            >
                              {getLocationPath(child.id, locations).split(' › ').slice(1).join(' › ')}
                            </button>
                          ))}
                        </div>
                      );
                    });
                  })()
                )
              ) : (
                containers.filter(c => !c.deletedAt && c.id !== moveSource.containerId).length === 0 && locations.length === 0 ? (
                  <p style={{ color: '#888', fontSize: 14, textAlign: 'center', padding: '20px 0' }}>
                    {t('main.move.noDestinations')}
                  </p>
                ) : (
                  <>
                    {(() => {
                      if (!moveSource) return null;
                      const ns = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
                      const rootLocs = [...locations].filter(l => !l.parentId).sort((a, b) => ns(a.name, b.name));
                      const containersAtLoc = (locId: string) =>
                        containers
                          .filter(c => !c.deletedAt && c.id !== moveSource.containerId && c.locationId === locId)
                          .sort((a, b) => ns(a.name, b.name));
                      const unassigned = containers
                        .filter(c => !c.deletedAt && c.id !== moveSource.containerId && !c.locationId)
                        .sort((a, b) => ns(a.name, b.name));
                      const renderDestBtn = (dest: Container) => (
                        <button
                          key={dest.id}
                          onClick={async () => {
                            const src = containers.find(c => c.id === moveSource.containerId);
                            if (!src) return;
                            if (viewingOwnerUid !== user.uid) {
                              if (moveSource.mode !== 'photo' || !moveSource.photoId) {
                                setCollaborationError('Only individual photo moves are available in shared inventory.');
                                return;
                              }
                              const service = collaboratorInventoryService();
                              if (!service) {
                                setCollaborationError('Collaboration session unavailable.');
                                return;
                              }
                              const result = await service.movePhoto(
                                src.id,
                                dest.id,
                                moveSource.photoId,
                              );
                              if (!result.ok) {
                                setCollaborationError(`Photo move failed: ${result.reason}`);
                                return;
                              }
                              closeLightbox();
                              setMoveSource(null);
                              return;
                            }
                            const srcRef  = doc(db, `users/${viewingOwnerUid}/containers/${src.id}`);
                            const destRef = doc(db, `users/${viewingOwnerUid}/containers/${dest.id}`);
                            await runTransaction(db, async (tx) => {
                              const [txDestSnap, txSrcSnap] = await Promise.all([tx.get(destRef), tx.get(srcRef)]);
                              const txDestPhotos: PhotoItem[] = (txDestSnap.data() as any)?.photos ?? [];
                              const txSrcPhotos: PhotoItem[] = (txSrcSnap.data() as any)?.photos ?? [];
                              if (moveSource.mode === 'photo' && moveSource.photoId) {
                                const txPhoto = txSrcPhotos.find((p: PhotoItem) => p.id === moveSource.photoId);
                                if (!txPhoto) return;
                                const alreadyInDest = txDestPhotos.some((p: PhotoItem) => p.id === txPhoto.id);
                                const newDestPhotos = alreadyInDest ? txDestPhotos : [...txDestPhotos, txPhoto];
                                const newSrcPhotos = txSrcPhotos.filter((p: PhotoItem) => p.id !== moveSource.photoId);
                                tx.update(destRef, { photos: newDestPhotos, photoUrls: newDestPhotos.map((p: PhotoItem) => p.url), photoStoragePaths: newDestPhotos.map((p: PhotoItem) => p.storagePath) });
                                const srcUpdate: any = { photos: newSrcPhotos, photoUrls: newSrcPhotos.map((p: PhotoItem) => p.url), photoStoragePaths: newSrcPhotos.map((p: PhotoItem) => p.storagePath) };
                                if (newSrcPhotos.length === 0) { srcUpdate.aiDescription = ''; srcUpdate.aiTags = []; srcUpdate.aiObjects = []; srcUpdate.aiStatus = null; }
                                tx.update(srcRef, srcUpdate);
                              } else {
                                const newDestPhotos = [...txDestPhotos, ...txSrcPhotos];
                                tx.update(destRef, { photos: newDestPhotos, photoUrls: newDestPhotos.map((p: PhotoItem) => p.url), photoStoragePaths: newDestPhotos.map((p: PhotoItem) => p.storagePath) });
                                tx.update(srcRef, { photos: [], photoUrls: [], photoStoragePaths: [], photoUrl: null, photoStoragePath: null });
                              }
                            });
                            closeLightbox();
                            setMoveSource(null);
                          }}
                          style={{ textAlign: 'left', padding: '9px 14px', borderRadius: 8, border: '1px solid #eee', background: '#faf8f6', cursor: 'pointer', fontSize: 14, color: '#333', width: '100%' }}
                        >
                          <strong>{dest.name}</strong>
                          {dest.location && <span style={{ color: '#888', marginLeft: 8, fontSize: 13 }}>{dest.location}</span>}
                        </button>
                      );
                      const renderLooseBtn = (loc: typeof locations[0]) => (
                        <button
                          key={`loose-${loc.id}`}
                          onClick={async () => {
                            const src = containers.find(c => c.id === moveSource.containerId);
                            if (!src || !moveSource.photoId) return;
                            if (viewingOwnerUid !== user.uid) {
                              const service = collaboratorInventoryService();
                              if (!service) {
                                setCollaborationError('Collaboration session unavailable.');
                                return;
                              }
                              const existingLoose = containers.find(
                                c => c.locationId === loc.id &&
                                  c.name === 'Loose items' &&
                                  !c.deletedAt,
                              );
                              let destinationId = existingLoose?.id;
                              if (!destinationId) {
                                const created = await service.createContainer(
                                  'Loose items',
                                  loc.id,
                                  getLocationPath(loc.id, locations),
                                );
                                if (!created.ok) {
                                  setCollaborationError(
                                    `Loose-items container failed: ${created.reason}`,
                                  );
                                  return;
                                }
                                destinationId = created.value;
                              }
                              const moved = await service.movePhoto(
                                src.id,
                                destinationId,
                                moveSource.photoId,
                              );
                              if (!moved.ok) {
                                setCollaborationError(`Photo move failed: ${moved.reason}`);
                                return;
                              }
                              closeLightbox();
                              setMoveSource(null);
                              return;
                            }
                            const srcRef1 = doc(db, `users/${viewingOwnerUid}/containers/${src.id}`);
                            const srcSnap1 = await getDoc(srcRef1);
                            const srcPhotos1: PhotoItem[] = srcSnap1.data()?.photos ?? [];
                            const photo = srcPhotos1.find((p: PhotoItem) => p.id === moveSource.photoId);
                            if (!photo) return;
                            let targetContainerId: string;
                            const existingLoose = containers.find(c => c.locationId === loc.id && c.name === 'Loose items' && !c.deletedAt);
                            if (existingLoose) {
                              const existingRef = doc(db, `users/${viewingOwnerUid}/containers/${existingLoose.id}`);
                              await runTransaction(db, async (tx) => {
                                const txSrcSnap = await tx.get(srcRef1);
                                const txDestSnap = await tx.get(existingRef);
                                const txSrcPhotos: PhotoItem[] = (txSrcSnap.data() as any)?.photos ?? [];
                                const txDestPhotos: PhotoItem[] = (txDestSnap.data() as any)?.photos ?? [];
                                const txPhoto = txSrcPhotos.find((p: PhotoItem) => p.id === moveSource.photoId);
                                if (!txPhoto) return;
                                const alreadyInDest = txDestPhotos.some((p: PhotoItem) => p.id === txPhoto.id);
                                const newDest = alreadyInDest ? txDestPhotos : [...txDestPhotos, txPhoto];
                                const newSrc = txSrcPhotos.filter((p: PhotoItem) => p.id !== moveSource.photoId);
                                tx.update(existingRef, { photos: newDest, photoUrls: newDest.map((p: PhotoItem) => p.url), photoStoragePaths: newDest.map((p: PhotoItem) => p.storagePath) });
                                tx.update(srcRef1, { photos: newSrc, photoUrls: newSrc.map((p: PhotoItem) => p.url), photoStoragePaths: newSrc.map((p: PhotoItem) => p.storagePath) });
                              });
                              targetContainerId = existingLoose.id;
                            } else {
                              const containerRef = doc(collection(db, `users/${viewingOwnerUid}/containers`));
                              await setDoc(containerRef, { name: 'Loose items', locationId: loc.id, location: getLocationPath(loc.id, locations), photos: [photo], photoUrls: [photo.url], photoStoragePaths: [photo.storagePath], createdAt: serverTimestamp(), deletedAt: null, isPrivate: loc.effectiveIsPrivate, visibility: 'inherit', effectiveIsPrivate: loc.effectiveIsPrivate });
                              targetContainerId = containerRef.id;
                            }
                            await runTransaction(db, async (tx) => {
                              const freshSrcSnap = await tx.get(srcRef1);
                              const freshSrcPhotos: PhotoItem[] = (freshSrcSnap.data() as any)?.photos ?? [];
                              const newSrcPhotos = freshSrcPhotos.filter((p: PhotoItem) => p.id !== moveSource.photoId);
                              const srcUpdate: any = { photos: newSrcPhotos, photoUrls: newSrcPhotos.map((p: PhotoItem) => p.url), photoStoragePaths: newSrcPhotos.map((p: PhotoItem) => p.storagePath) };
                              if (newSrcPhotos.length === 0) { srcUpdate.aiDescription = ''; srcUpdate.aiTags = []; srcUpdate.aiObjects = []; srcUpdate.aiStatus = null; }
                              tx.update(srcRef1, srcUpdate);
                            });
                            void targetContainerId;
                            closeLightbox();
                            setMoveSource(null);
                          }}
                          style={{ textAlign: 'left', padding: '9px 14px', borderRadius: 8, border: '1px dashed #bbb', background: '#f9f9f9', cursor: 'pointer', fontSize: 13, color: '#666', width: '100%' }}
                        >
                          + Move to Loose items here
                        </button>
                      );
                      const childLocs = (parentId: string) =>
                        [...locations].filter(l => l.parentId === parentId).sort((a, b) => ns(a.name, b.name));
                      function renderLocNode(loc: typeof locations[0], depth: number): ReactElement {
                        const isExp = expandedMoveLocs.has(loc.id);
                        const lc = containersAtLoc(loc.id);
                        const kids = childLocs(loc.id);
                        return (
                          <div key={loc.id} style={{ marginBottom: 4 }}>
                            <button
                              onClick={() => setExpandedMoveLocs(prev => { const n = new Set(prev); n.has(loc.id) ? n.delete(loc.id) : n.add(loc.id); return n; })}
                              style={{ width: '100%', textAlign: 'left', paddingTop: '10px', paddingBottom: '10px', paddingRight: '14px', paddingLeft: `${14 + depth * 16}px`, borderRadius: 8, border: '1px solid #dde', background: isExp ? '#eeeef8' : '#f5f5fb', cursor: 'pointer', fontSize: 14, color: '#333', display: 'flex', alignItems: 'center', gap: 8 }}
                            >
                              <span style={{ fontSize: 11, color: '#888' }}>{isExp ? '▼' : '▶'}</span>
                              <span>📍 {loc.name}</span>
                              <span style={{ fontSize: 12, color: '#aaa', marginLeft: 'auto' }}>{lc.length > 0 ? `${lc.length} box${lc.length !== 1 ? 'es' : ''}` : 'no boxes'}{kids.length > 0 ? ` · ${kids.length}↓` : ''}</span>
                            </button>
                            {isExp && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 3, marginLeft: 16 }}>
                                {lc.length > 0 ? lc.map(dest => renderDestBtn(dest)) : renderLooseBtn(loc)}
                                {kids.map(kid => renderLocNode(kid, depth + 1))}
                              </div>
                            )}
                          </div>
                        );
                      }
                      return (
                        <>
                          {rootLocs.map(loc => renderLocNode(loc, 0))}
                          {unassigned.length > 0 && (
                            <>
                              <p style={{ margin: '8px 0 4px', fontSize: 12, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>No location</p>
                              {unassigned.map(dest => renderDestBtn(dest))}
                            </>
                          )}
                        </>
                      );
                    })()}
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
              {t('main.move.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Sell this flow */}
      {sellContainer && (
        <SellThisFlow
          user={user}
          container={sellContainer}
          sourcePhotos={sellSourcePhotos ?? undefined}
          sourceContainerIds={sellSourceContainerIds ?? undefined}
          isFromTray={sellIsFromTray}
          onClose={() => {
            setSellContainer(null);
            setSellSourcePhotos(null);
            setSellSourceContainerIds(null);
            setSellIsFromTray(false);
          }}
        />
      )}

      {/* Items to sell tray */}
      {showTray && (
        <div className="tray-overlay" onClick={() => setShowTray(false)}>
          <div className="tray-sheet" onClick={e => e.stopPropagation()}>
            <div className="tray-header">
              <span className="tray-title">
                {trayPhotos.length > 0 ? `${t('main.tray.sellHeading')} (${trayPhotos.length})` : t('main.tray.sellHeading')}
              </span>
              <button className="tray-close-btn" onClick={() => setShowTray(false)} aria-label="Close">✕</button>
            </div>

            {trayPhotos.length === 0 ? (
              <p className="tray-empty">
                Add photos to your selection using the 'Add to Items to sell' button in any photo.
              </p>
            ) : (
              <>
                <div className="tray-list">
                  {trayPhotos.map((tp, i) => (
                    <div key={`${tp.photo.id}-${i}`} className="tray-item">
                      <div className="tray-item-thumb">
                        <ThumbImage storagePath={tp.photo.storagePath} alt={tp.containerName} />
                      </div>
                      <div className="tray-item-meta">
                        <span className="tray-item-container">{tp.containerName}</span>
                        {tp.photo.aiDescription && (
                          <span className="tray-item-desc">{tp.photo.aiDescription}</span>
                        )}
                      </div>
                      <button
                        className="tray-item-remove"
                        onClick={() => setTrayPhotos(prev => prev.filter((_, j) => j !== i))}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                <div className="tray-actions">
                  <button
                    className="tray-clear-btn"
                    onClick={() => setTrayPhotos([])}
                  >
                    Clear all
                  </button>
                  <button
                    className="tray-create-btn"
                    onClick={() => {
                      const uniqueContainerIds = [...new Set(trayPhotos.map(tp => tp.containerId))];
                      const photos = trayPhotos.map(tp => tp.photo);
                      if (uniqueContainerIds.length === 1) {
                        const c = containers.find(ct => ct.id === uniqueContainerIds[0]);
                        if (!c) return;
                        setSellContainer(c);
                        setSellSourcePhotos(photos);
                        setSellSourceContainerIds(null);
                      } else {
                        const syntheticContainer: ContainerForListing = {
                          id: '',
                          name: 'Selected items',
                          location: '',
                          photos,
                          aiDescription: '',
                          aiTags: [],
                        };
                        setSellContainer(syntheticContainer);
                        setSellSourcePhotos(photos);
                        setSellSourceContainerIds(uniqueContainerIds);
                      }
                      setSellIsFromTray(true);
                      setShowTray(false);
                    }}
                  >
                    Create listing draft
                  </button>
                </div>
              </>
            )}
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
              {t('main.invite.title')}
            </h2>
            <p style={{ margin: 0, fontSize: 14, color: '#555' }}>
              {t('main.invite.description')}
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
                    {inviteCopied ? t('main.invite.copied') : t('main.invite.copyLink')}
                  </button>
                  <button
                    onClick={() => { setInviteLink(null); setInviteCopied(false); }}
                    style={{
                      padding: '10px 16px', borderRadius: 8, border: '1px solid #ddd',
                      background: '#fff', fontSize: 14, cursor: 'pointer', color: '#555',
                    }}
                  >
                    {t('main.invite.newLink')}
                  </button>
                </div>
              </div>
            ) : (
              <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 13, color: '#555' }}>{t('main.invite.expiryLabel')}</label>
                <select
                  value={inviteExpiry ?? 'never'}
                  onChange={e => setInviteExpiry(e.target.value === 'never' ? null : Number(e.target.value))}
                  style={{
                    padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd',
                    background: '#faf8f6', fontSize: 14, color: '#333',
                  }}
                >
                  <option value={1}>{t('main.invite.expiry24h')}</option>
                  <option value={7}>{t('main.invite.expiry7d')}</option>
                  <option value={30}>{t('main.invite.expiry30d')}</option>
                  <option value="never">{t('main.invite.expiryNever')}</option>
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
                {generatingInvite ? t('main.invite.generating') : t('main.invite.generate')}
              </button>
              </>
            )}

            {collaborators.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#333' }}>{t('main.invite.peopleWithAccess')}</p>
                {collaborators.map(c => (
                  <div key={c.uid} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', borderRadius: 8, background: '#faf8f6', border: '1px solid #eee',
                  }}>
                    <span style={{ fontSize: 14, color: '#333' }}>{c.displayName}</span>
                    <button
                      onClick={() => revokeCollaborator(c.uid)}
                      style={{
                        padding: '4px 12px', borderRadius: 6, border: '1px solid #e0b0a0',
                        background: '#fff', color: '#a04030', fontSize: 12, cursor: 'pointer',
                      }}
                    >
                      {t('main.invite.revoke')}
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
              {t('main.invite.close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
