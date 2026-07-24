import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { getFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import {
  MoveCollaboratorPhotoFailure,
  moveCollaboratorPhotoTransaction,
  type MoveCollaboratorPhotoInput,
} from './moveCollaboratorPhoto';

import { GoogleGenerativeAI } from '@google/generative-ai';

initializeApp();

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const BOOTSTRAP_UID = process.env.BOOTSTRAP_ADMIN_UID?.trim() || '';
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ||
  'https://vowvy-staging.web.app,https://vowvy-staging.firebaseapp.com,http://localhost:5173,http://localhost:5174'
)
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

export const moveCollaboratorPhoto = onCall(async request => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in.');
  }
  const input = (request.data ?? {}) as MoveCollaboratorPhotoInput;
  try {
    await moveCollaboratorPhotoTransaction(
      getFirestore(),
      request.auth.uid,
      input,
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof MoveCollaboratorPhotoFailure) {
      const code =
        error.reason === 'invalid-input'
          ? 'invalid-argument'
          : error.reason === 'permission-denied' ||
              error.reason === 'private-container'
            ? 'permission-denied'
            : error.reason === 'container-not-found' ||
                error.reason === 'photo-not-found'
              ? 'not-found'
              : 'already-exists';
      throw new HttpsError(code, error.reason);
    }
    console.error('moveCollaboratorPhoto failed', error);
    throw new HttpsError('internal', 'Photo move failed.');
  }
});

// ---------------------------------------------------------------------------
// TEMPORARY — backfill isPrivate: false on containers missing the field.
// Remove this function after the backfill has been confirmed complete.
// ---------------------------------------------------------------------------
export const backfillIsPrivateOnce = onCall(
  { timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.');
    }
    if (request.auth.token?.isAdmin !== true) {
      throw new HttpsError('permission-denied', 'Admin access required.');
    }

    const { dryRun } = (request.data ?? {}) as { dryRun?: boolean };
    const isDryRun = dryRun !== false; // default to dry run for safety

    const db = getFirestore();
    const snap = await db.collectionGroup('containers').get();

    const missing = snap.docs.filter(d => d.data().isPrivate === undefined);

    console.log(`backfillIsPrivateOnce: scanned=${snap.size} missing=${missing.length} dryRun=${isDryRun}`);

    if (isDryRun || missing.length === 0) {
      return { scanned: snap.size, missing: missing.length, patched: 0, remainingMissing: missing.length, dryRun: isDryRun };
    }

    // Batch-write in chunks of 400 (Firestore max per commit is 500)
    const BATCH_SIZE = 400;
    let patched = 0;
    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const d of missing.slice(i, i + BATCH_SIZE)) {
        batch.update(d.ref, { isPrivate: false });
      }
      await batch.commit();
      patched += missing.slice(i, i + BATCH_SIZE).length;
      console.log(`backfillIsPrivateOnce: patched ${patched}/${missing.length}`);
    }

    // Verification pass
    const verify = await db.collectionGroup('containers').get();
    const remainingMissing = verify.docs.filter(d => d.data().isPrivate === undefined).length;

    console.log(`backfillIsPrivateOnce: complete patched=${patched} remainingMissing=${remainingMissing}`);
    return { scanned: snap.size, missing: missing.length, patched, remainingMissing, dryRun: false };
  }
);

// ---------------------------------------------------------------------------
// TEMPORARY — backfill visibility + effectiveIsPrivate on locations.
// Remove after backfill confirmed complete.
// ---------------------------------------------------------------------------
export const backfillLocationsVisibility = onCall(
  { timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
    if (request.auth.token?.isAdmin !== true) throw new HttpsError('permission-denied', 'Admin access required.');

    const { dryRun } = (request.data ?? {}) as { dryRun?: boolean };
    const isDryRun = dryRun !== false;

    const db = getFirestore();
    const snap = await db.collectionGroup('locations').get();
    const missing = snap.docs.filter(d => {
      const data = d.data();
      return data.visibility === undefined || data.effectiveIsPrivate === undefined;
    });

    console.log(`backfillLocationsVisibility: scanned=${snap.size} missing=${missing.length} dryRun=${isDryRun}`);

    if (isDryRun || missing.length === 0) {
      return { scanned: snap.size, missing: missing.length, patched: 0, remainingMissing: missing.length, dryRun: isDryRun };
    }

    const BATCH_SIZE = 400;
    let patched = 0;
    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const d of missing.slice(i, i + BATCH_SIZE)) {
        const data = d.data();
        const update: Record<string, unknown> = {};
        if (data.visibility === undefined) update.visibility = 'inherit';
        if (data.effectiveIsPrivate === undefined) update.effectiveIsPrivate = false;
        batch.update(d.ref, update);
      }
      await batch.commit();
      patched += missing.slice(i, i + BATCH_SIZE).length;
      console.log(`backfillLocationsVisibility: patched ${patched}/${missing.length}`);
    }

    const verify = await db.collectionGroup('locations').get();
    const remainingMissing = verify.docs.filter(d => {
      const data = d.data();
      return data.visibility === undefined || data.effectiveIsPrivate === undefined;
    }).length;

    console.log(`backfillLocationsVisibility: complete patched=${patched} remainingMissing=${remainingMissing}`);
    return { scanned: snap.size, missing: missing.length, patched, remainingMissing, dryRun: false };
  }
);

// ---------------------------------------------------------------------------
// TEMPORARY — backfill visibility + effectiveIsPrivate on containers.
// Remove after backfill confirmed complete.
// ---------------------------------------------------------------------------
export const backfillContainersVisibility = onCall(
  { timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
    if (request.auth.token?.isAdmin !== true) throw new HttpsError('permission-denied', 'Admin access required.');

    const { dryRun } = (request.data ?? {}) as { dryRun?: boolean };
    const isDryRun = dryRun !== false;

    const db = getFirestore();
    const snap = await db.collectionGroup('containers').get();
    const missing = snap.docs.filter(d => {
      const data = d.data();
      return data.visibility === undefined || data.effectiveIsPrivate === undefined;
    });

    console.log(`backfillContainersVisibility: scanned=${snap.size} missing=${missing.length} dryRun=${isDryRun}`);

    if (isDryRun || missing.length === 0) {
      return { scanned: snap.size, missing: missing.length, patched: 0, remainingMissing: missing.length, dryRun: isDryRun };
    }

    const BATCH_SIZE = 400;
    let patched = 0;
    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const d of missing.slice(i, i + BATCH_SIZE)) {
        const data = d.data();
        const update: Record<string, unknown> = {};
        if (data.visibility === undefined) {
          update.visibility = data.isPrivate === true ? 'private' : 'inherit';
        }
        if (data.effectiveIsPrivate === undefined) {
          update.effectiveIsPrivate = data.isPrivate === true;
        }
        batch.update(d.ref, update);
      }
      await batch.commit();
      patched += missing.slice(i, i + BATCH_SIZE).length;
      console.log(`backfillContainersVisibility: patched ${patched}/${missing.length}`);
    }

    const verify = await db.collectionGroup('containers').get();
    const remainingMissing = verify.docs.filter(d => {
      const data = d.data();
      return data.visibility === undefined || data.effectiveIsPrivate === undefined;
    }).length;

    console.log(`backfillContainersVisibility: complete patched=${patched} remainingMissing=${remainingMissing}`);
    return { scanned: snap.size, missing: missing.length, patched, remainingMissing, dryRun: false };
  }
);

// ---------------------------------------------------------------------------
// Dry-run content reset report.
// Admin-only. Reads only — no writes, no deletes.
// Reports every Auth user with their Firestore content counts, onboarding
// status, and Storage file count. Categorises KEEP (admin/master) vs UNKNOWN.
// ---------------------------------------------------------------------------
export const dryRunContentReset = onCall(
  { timeoutSeconds: 300, memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
    if (request.auth.token?.isAdmin !== true) throw new HttpsError('permission-denied', 'Admin access required.');

    const db      = getFirestore();
    const auth    = getAuth();
    const bucket  = getStorage().bucket();

    // --- Load all Auth users and Firestore collection-group data in parallel ---
    const [listResult, locSnap, containerSnap, collabSnap, inviteSnap] = await Promise.all([
      auth.listUsers(1000),
      db.collectionGroup('locations').get(),
      db.collectionGroup('containers').get(),
      db.collectionGroup('collaborators').get(),
      db.collection('invites').get(),
    ]);

    // Build per-uid count maps from collection-group snapshots
    const locationCountByUid: Record<string, number> = {};
    for (const d of locSnap.docs) {
      const uid = d.ref.path.split('/')[1];
      locationCountByUid[uid] = (locationCountByUid[uid] ?? 0) + 1;
    }

    const containerCountByUid: Record<string, number> = {};
    const photoRefCountByUid: Record<string, number> = {};
    for (const d of containerSnap.docs) {
      const uid = d.ref.path.split('/')[1];
      containerCountByUid[uid] = (containerCountByUid[uid] ?? 0) + 1; // includes soft-deleted
      const photos: unknown[] = d.data().photos ?? [];
      photoRefCountByUid[uid] = (photoRefCountByUid[uid] ?? 0) + photos.length;
    }

    const collabCountByUid: Record<string, number> = {};
    for (const d of collabSnap.docs) {
      if (d.data().status !== 'active') continue;
      const ownerUid = d.ref.path.split('/')[1];
      collabCountByUid[ownerUid] = (collabCountByUid[ownerUid] ?? 0) + 1;
    }

    const inviteCountByUid: Record<string, number> = {};
    for (const d of inviteSnap.docs) {
      const ownerUid = d.data().ownerUid as string | undefined;
      if (!ownerUid) continue;
      inviteCountByUid[ownerUid] = (inviteCountByUid[ownerUid] ?? 0) + 1;
    }

    // --- Per-user: read profile doc + Storage listing concurrently ---
    const users = await Promise.all(
      listResult.users.map(async (authUser) => {
        const uid = authUser.uid;

        // Profile doc (onboarding status from Part A)
        let onboardingCompleted = false;
        let onboardingSkipped = false;
        try {
          const profileDoc = await db.collection('users').doc(uid).get();
          const data = profileDoc.data();
          onboardingCompleted = data?.onboardingCompleted === true;
          onboardingSkipped   = data?.onboardingSkipped   === true;
        } catch { /* not present is fine */ }

        // Storage file count under users/{uid}/
        let storageFileCount: number | null = null;
        try {
          const [files] = await bucket.getFiles({ prefix: `users/${uid}/` });
          storageFileCount = files.length;
        } catch { /* storage listing unavailable */ }

        const isAdminUser =
          authUser.customClaims?.['isAdmin'] === true ||
          uid === BOOTSTRAP_UID;
        const category: 'KEEP' | 'UNKNOWN' = isAdminUser ? 'KEEP' : 'UNKNOWN';

        const locationCount         = locationCountByUid[uid]  ?? 0;
        const containerCount        = containerCountByUid[uid]  ?? 0;
        const photoReferenceCount   = photoRefCountByUid[uid]   ?? 0;
        const collaboratorRecordCount = collabCountByUid[uid]   ?? 0;
        const inviteCount           = inviteCountByUid[uid]     ?? 0;

        // Describe what a reset would clear for this account
        const wouldClear: string[] = [];
        if (locationCount > 0)            wouldClear.push(`locations (${locationCount})`);
        if (containerCount > 0)           wouldClear.push(`containers (${containerCount}, incl. soft-deleted)`);
        if (photoReferenceCount > 0)      wouldClear.push(`photo references (${photoReferenceCount})`);
        if (collaboratorRecordCount > 0)  wouldClear.push(`collaborator records (${collaboratorRecordCount})`);
        if (inviteCount > 0)              wouldClear.push(`invites (${inviteCount})`);
        if (onboardingCompleted)          wouldClear.push('onboardingCompleted flag');
        if (onboardingSkipped)            wouldClear.push('onboardingSkipped flag');
        if (storageFileCount !== null && storageFileCount > 0)
          wouldClear.push(`storage files (${storageFileCount})`);

        return {
          uid,
          email:                authUser.email ?? null,
          displayName:          authUser.displayName ?? null,
          createdAt:            authUser.metadata.creationTime ?? '',
          lastSignInAt:         authUser.metadata.lastSignInTime ?? '',
          isAdmin:              isAdminUser,
          onboardingCompleted,
          onboardingSkipped,
          locationCount,
          containerCount,
          photoReferenceCount,
          collaboratorRecordCount,
          inviteCount,
          storageFileCount,
          category,
          wouldClear,
        };
      })
    );

    const totals = {
      total:               users.length,
      keep:                users.filter(u => u.category === 'KEEP').length,
      unknown:             users.filter(u => u.category === 'UNKNOWN').length,
      locations:           users.reduce((s, u) => s + u.locationCount, 0),
      containers:          users.reduce((s, u) => s + u.containerCount, 0),
      photoReferences:     users.reduce((s, u) => s + u.photoReferenceCount, 0),
      storageFiles:        users.some(u => u.storageFileCount === null)
                             ? null
                             : users.reduce((s, u) => s + (u.storageFileCount ?? 0), 0),
      invites:             users.reduce((s, u) => s + u.inviteCount, 0),
      collaboratorRecords: users.reduce((s, u) => s + u.collaboratorRecordCount, 0),
    };

    console.log(`dryRunContentReset: total=${users.length} keep=${totals.keep} unknown=${totals.unknown}`);
    return { users, totals };
  }
);

export const proxyImage = onRequest(
  {
    cors: ALLOWED_ORIGINS,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    const path = req.query.path as string | undefined;
    if (!path) { res.status(400).send('Missing path'); return; }

    const authHeader = req.headers.authorization ?? '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) { res.status(401).send('Unauthorized'); return; }

    let uid: string;
    try {
      const decoded = await getAuth().verifyIdToken(idToken);
      uid = decoded.uid;
    } catch {
      res.status(401).send('Invalid token');
      return;
    }

    // Allow access if: user owns the path, OR user is an active collaborator of the path owner
    const pathOwnerMatch = path.match(/^users\/([^/]+)\//);
    const pathOwnerUid = pathOwnerMatch?.[1];

    if (pathOwnerUid !== uid) {
      if (!pathOwnerUid) {
        res.status(403).send('Forbidden');
        return;
      }
      const db = getFirestore();
      // Check if caller is an active collaborator of the path owner
      const collabDoc = await db
        .collection('users').doc(pathOwnerUid)
        .collection('collaborators').doc(uid)
        .get();
      if (!collabDoc.exists || collabDoc.data()?.status !== 'active') {
        res.status(403).send('Forbidden');
        return;
      }
      // Block collaborator access to photos inside private containers
      const containerIdMatch = path.match(/^users\/[^/]+\/containers\/([^/]+)\//);
      const containerId = containerIdMatch?.[1];
      if (containerId) {
        const containerDoc = await db
          .collection('users').doc(pathOwnerUid)
          .collection('containers').doc(containerId)
          .get();
        if (containerDoc.data()?.effectiveIsPrivate === true) {
          res.status(403).send('Forbidden');
          return;
        }
      }
    }

    try {
      const bucket = getStorage().bucket();
      const file = bucket.file(path);
      const [metadata] = await file.getMetadata();
      const [buffer] = await file.download();
      res.set('Content-Type', (metadata.contentType as string) ?? 'image/jpeg');
      res.set('Cache-Control', 'private, max-age=3600');
      res.send(buffer);
    } catch {
      res.status(404).send('Not found');
    }
  }
);

export const setAdminClaim = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in.');

  const isBootstrap = callerUid === BOOTSTRAP_UID;
  const isAdmin = request.auth?.token?.isAdmin === true;
  if (!isBootstrap && !isAdmin) {
    throw new HttpsError('permission-denied', 'Not authorised to grant admin claims.');
  }

  const { uid } = request.data as { uid: string };
  if (!uid || typeof uid !== 'string') {
    throw new HttpsError('invalid-argument', 'A valid uid is required.');
  }

  await getAuth().setCustomUserClaims(uid, { isAdmin: true });
  return { success: true };
});

export const getAdminUserData = onCall(
  { timeoutSeconds: 60, memory: '256MiB' },
  async (request) => {
    if (request.auth?.token?.isAdmin !== true) {
      throw new HttpsError('permission-denied', 'Admin access required.');
    }

    const db = getFirestore();
    const auth = getAuth();

    // All four reads in parallel
    const [listResult, containerSnap, locationSnap, collabSnap, inviteSnap] = await Promise.all([
      auth.listUsers(1000),
      db.collectionGroup('containers').get(),
      db.collectionGroup('locations').get(),
      db.collectionGroup('collaborators').get(),
      db.collection('invites').get(),
    ]);

    // Container counts per user (exclude soft-deleted)
    const containerCounts: Record<string, number> = {};
    for (const d of containerSnap.docs) {
      if (d.data().deletedAt) continue;
      const uid = d.ref.path.split('/')[1];
      containerCounts[uid] = (containerCounts[uid] ?? 0) + 1;
    }

    // Location counts per user
    const locationCounts: Record<string, number> = {};
    for (const d of locationSnap.docs) {
      const uid = d.ref.path.split('/')[1];
      locationCounts[uid] = (locationCounts[uid] ?? 0) + 1;
    }

    // Active collaborators per owner
    const collaboratorsByOwner: Record<string, { uid: string; email: string; displayName: string }[]> = {};
    for (const d of collabSnap.docs) {
      if (d.data().status !== 'active') continue;
      const ownerUid = d.ref.path.split('/')[1];
      const data = d.data();
      if (!collaboratorsByOwner[ownerUid]) collaboratorsByOwner[ownerUid] = [];
      collaboratorsByOwner[ownerUid].push({
        uid: d.id,
        email: data.email ?? '',
        displayName: data.displayName ?? '',
      });
    }

    // Invites per owner
    const invitesByOwner: Record<string, { token: string; status: string; acceptedByEmail?: string }[]> = {};
    for (const d of inviteSnap.docs) {
      const data = d.data();
      const ownerUid = data.ownerUid as string | undefined;
      if (!ownerUid) continue;
      if (!invitesByOwner[ownerUid]) invitesByOwner[ownerUid] = [];
      invitesByOwner[ownerUid].push({
        token: d.id,
        status: data.status,
        acceptedByEmail: data.acceptedByEmail,
      });
    }

    // Bidirectional connection map
    const connectedTo: Record<string, Set<string>> = {};
    for (const ownerUid of Object.keys(collaboratorsByOwner)) {
      if (!connectedTo[ownerUid]) connectedTo[ownerUid] = new Set();
      for (const collab of collaboratorsByOwner[ownerUid]) {
        connectedTo[ownerUid].add(collab.uid);
        if (!connectedTo[collab.uid]) connectedTo[collab.uid] = new Set();
        connectedTo[collab.uid].add(ownerUid);
      }
    }

    const users = listResult.users.map(u => ({
      uid: u.uid,
      email: u.email ?? null,
      displayName: u.displayName ?? null,
      createdAt: u.metadata.creationTime ?? '',
      lastSignInAt: u.metadata.lastSignInTime ?? '',
      containerCount: containerCounts[u.uid] ?? 0,
      locationCount: locationCounts[u.uid] ?? 0,
      collaborators: collaboratorsByOwner[u.uid] ?? [],
      invitesSent: invitesByOwner[u.uid] ?? [],
      connectedTo: Array.from(connectedTo[u.uid] ?? []),
    }));

    return { users };
  }
);

export const uploadCollaboratorPhoto = onCall(
  { timeoutSeconds: 60, memory: '256MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.');
    }
    const { ownerUid, containerId, imageBase64, contentType } = request.data as {
      ownerUid?: string;
      containerId?: string;
      imageBase64?: string;
      contentType?: string;
    };
    if (!ownerUid || typeof ownerUid !== 'string') {
      throw new HttpsError('invalid-argument', 'ownerUid is required.');
    }
    if (!containerId || typeof containerId !== 'string') {
      throw new HttpsError('invalid-argument', 'containerId is required.');
    }
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      throw new HttpsError('invalid-argument', 'imageBase64 is required.');
    }
    const resolvedContentType = typeof contentType === 'string' && contentType ? contentType : 'image/jpeg';

    const db = getFirestore();
    const collabDoc = await db
      .collection('users').doc(ownerUid)
      .collection('collaborators').doc(request.auth.uid)
      .get();
    if (!collabDoc.exists || collabDoc.data()?.status !== 'active') {
      throw new HttpsError('permission-denied', 'Not an active collaborator.');
    }

    // Block collaborator uploads to private containers
    const containerDoc = await db
      .collection('users').doc(ownerUid)
      .collection('containers').doc(containerId)
      .get();
    if (containerDoc.data()?.effectiveIsPrivate === true) {
      throw new HttpsError('permission-denied', 'Cannot upload to a private container.');
    }

    const imageBuffer = Buffer.from(imageBase64, 'base64');
    if (imageBuffer.byteLength > 5 * 1024 * 1024) {
      throw new HttpsError('invalid-argument', 'Image exceeds 5 MB limit.');
    }

    const bucket = getStorage().bucket();
    const storagePath = `users/${ownerUid}/containers/${containerId}/photos/${Date.now()}.jpg`;
    const file = bucket.file(storagePath);
    const downloadToken = randomUUID();

    await file.save(imageBuffer, {
      metadata: {
        contentType: resolvedContentType,
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
      resumable: false,
    });

    const downloadURL = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;
    return { downloadURL, storagePath };
  }
);

const PHOTO_ANALYSIS_PROMPT = `Analyze this image of a storage container and its contents.
Return a JSON object with exactly these four fields:
- "description": a short 1-2 sentence description of what is stored
- "tags": a flat array where specific item names come first, followed by broad categories. Specific items should be concrete and descriptive (e.g. "remote control", "singing bowl", "kalimba", "sunflower", "tablet"). Broad categories should be title-cased (e.g. "Electronics", "Music", "Home Decor", "Clothing", "Tools"). Aim for 3-6 specific items then 2-4 broad categories.
- "objects": an array of all specific visible items (can overlap with tags)
- "searchTerms": an array of additional search-friendly terms a person might use to find these items later. Include common synonyms (e.g. "cord" for "cable", "xmas" for "Christmas"), informal names, related concepts, and plurals. Think about what words someone would type when trying to find these items months later. Aim for 8-15 terms.
Return only valid JSON with no markdown formatting or code fences.`;

export const analyzeContainerPhoto = onDocumentWritten(
  {
    document: 'users/{uid}/containers/{containerId}',
    secrets: [GEMINI_API_KEY],
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();

    if (!after) return;

    const beforePhotos: any[] = before?.photos  ?? [];
    const afterPhotos:  any[] = after?.photos   ?? [];
    const beforeUrls: string[] = before?.photoUrls ?? [];
    const afterUrls:  string[] = after?.photoUrls  ?? [];

    const beforeCount = beforePhotos.length || beforeUrls.length;
    const afterCount  = afterPhotos.length  || afterUrls.length;

    if (afterCount <= beforeCount) return;

    const docRef = event.data!.after.ref;

    // Per-photo AI path: find the specific new photo and patch only its entry
    if (afterPhotos.length > 0) {
      const beforePhotoIds = new Set(beforePhotos.map((p: any) => p.id));
      const newPhoto = afterPhotos.find((p: any) => !beforePhotoIds.has(p.id) && !p.deletedAt);
      if (!newPhoto) return;

      // Mark only this photo as processing
      const processingPhotos = afterPhotos.map((p: any) =>
        p.id === newPhoto.id ? { ...p, aiStatus: 'processing' } : p
      );
      await docRef.update({ photos: processingPhotos, aiStatus: 'processing' });

      try {
        const fetchRes = await fetch(newPhoto.url);
        if (!fetchRes.ok) throw new Error(`Failed to fetch photo: ${fetchRes.status}`);
        const buffer = await fetchRes.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const result = await model.generateContent([
          PHOTO_ANALYSIS_PROMPT,
          { inlineData: { data: base64, mimeType: 'image/jpeg' } },
        ]);

        const text = result.response.text().trim();
        const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const parsed = JSON.parse(clean) as {
          description?: string;
          tags?: string[];
          objects?: string[];
          searchTerms?: string[];
        };

        const tags = Array.isArray(parsed.tags) ? parsed.tags : [];
        const objects = Array.isArray(parsed.objects) ? parsed.objects : [];

        // Re-read for freshness so concurrent photo additions are not overwritten
        const freshSnap = await docRef.get();
        const freshPhotos: any[] = freshSnap.data()?.photos ?? [];

        const updatedPhotos = freshPhotos.map((p: any) =>
          p.id === newPhoto.id
            ? { ...p, aiStatus: 'done', aiDescription: parsed.description ?? '', aiTags: tags, aiObjects: objects }
            : p
        );

        // Merge tags and objects from all non-deleted photos for container-level search
        const allTagsSet = new Set<string>();
        const allSearchSet = new Set<string>();
        updatedPhotos.filter((p: any) => !p.deletedAt).forEach((p: any) => {
          (p.aiTags ?? []).forEach((t: string) => { allTagsSet.add(t); allSearchSet.add(t); });
          (p.aiObjects ?? []).forEach((t: string) => allSearchSet.add(t));
        });

        console.log('analyzeContainerPhoto success, tags:', tags);
        await docRef.update({
          photos:        updatedPhotos,
          aiStatus:      'done',
          aiDescription: parsed.description ?? '',
          aiTags:        [...allTagsSet],
          aiObjects:     objects,
          aiSearchTerms: [...allSearchSet],
        });
      } catch (err) {
        console.error('analyzeContainerPhoto error:', err);
        const freshSnap = await docRef.get();
        const freshPhotos: any[] = freshSnap.data()?.photos ?? [];
        const errorPhotos = freshPhotos.map((p: any) =>
          p.id === newPhoto.id ? { ...p, aiStatus: 'error' } : p
        );
        await docRef.update({ photos: errorPhotos, aiStatus: 'error' });
      }
      return;
    }

    // Legacy photoUrls[] path — keep original container-root behavior
    const photoUrl = afterUrls[afterUrls.length - 1];
    await docRef.update({ aiStatus: 'processing' });
    try {
      const fetchRes = await fetch(photoUrl);
      if (!fetchRes.ok) throw new Error(`Failed to fetch photo: ${fetchRes.status}`);
      const buffer = await fetchRes.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');

      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

      const result = await model.generateContent([
        PHOTO_ANALYSIS_PROMPT,
        { inlineData: { data: base64, mimeType: 'image/jpeg' } },
      ]);

      const text = result.response.text().trim();
      const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(clean) as {
        description?: string;
        tags?: string[];
        objects?: string[];
        searchTerms?: string[];
      };

      const tags = Array.isArray(parsed.tags) ? parsed.tags : [];
      console.log('analyzeContainerPhoto success (legacy), tags:', tags);
      await docRef.update({
        aiStatus:      'done',
        aiDescription: parsed.description ?? '',
        aiTags:        tags,
        aiObjects:     Array.isArray(parsed.objects) ? parsed.objects : [],
        aiSearchTerms: Array.isArray(parsed.searchTerms) ? parsed.searchTerms : [],
      });
    } catch (err) {
      console.error('analyzeContainerPhoto error (legacy):', err);
      await docRef.update({ aiStatus: 'error' });
    }
  }
);
