import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { getFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';

import { GoogleGenerativeAI } from '@google/generative-ai';

initializeApp();

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

export const proxyImage = onRequest(
  {
    cors: ['https://vowvy-1ba5f.web.app', 'https://app.vowvy.com'],
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
      // Check if caller is an active collaborator of the path owner
      const db = getFirestore();
      const collabDoc = await db
        .collection('users').doc(pathOwnerUid)
        .collection('collaborators').doc(uid)
        .get();
      if (!collabDoc.exists || collabDoc.data()?.status !== 'active') {
        res.status(403).send('Forbidden');
        return;
      }
    }

    try {
      const bucket = getStorage().bucket('vowvy-1ba5f.firebasestorage.app');
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

const BOOTSTRAP_UID = 'tn4kJIuUuQPjGZaufTMb65O5Gin2';

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

    const imageBuffer = Buffer.from(imageBase64, 'base64');
    if (imageBuffer.byteLength > 5 * 1024 * 1024) {
      throw new HttpsError('invalid-argument', 'Image exceeds 5 MB limit.');
    }

    const bucket = getStorage().bucket('vowvy-1ba5f.firebasestorage.app');
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

    if (!after) return; // document deleted

    // Support both new photos[] array and legacy photoUrls[]
    const beforePhotos: any[] = before?.photos  ?? [];
    const afterPhotos:  any[] = after?.photos   ?? [];
    const beforeUrls: string[] = before?.photoUrls ?? [];
    const afterUrls:  string[] = after?.photoUrls  ?? [];

    const beforeCount = beforePhotos.length || beforeUrls.length;
    const afterCount  = afterPhotos.length  || afterUrls.length;

    // Fire whenever a new photo is added (count increased)
    if (afterCount <= beforeCount) return;

    // Get the newest non-deleted photo URL
    let photoUrl: string;
    if (afterPhotos.length > 0) {
      const active = afterPhotos.filter((p: any) => !p.deletedAt);
      if (active.length === 0) return;
      photoUrl = active[active.length - 1].url;
    } else {
      photoUrl = afterUrls[afterUrls.length - 1];
    }

    const docRef = event.data!.after.ref;

    await docRef.update({ aiStatus: 'processing' });

    try {
      const fetchRes = await fetch(photoUrl);
      if (!fetchRes.ok) throw new Error(`Failed to fetch photo: ${fetchRes.status}`);
      const buffer = await fetchRes.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');

      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

      const prompt = `Analyze this image of a storage container and its contents.
Return a JSON object with exactly these four fields:
- "description": a short 1-2 sentence description of what is stored
- "tags": a flat array where specific item names come first, followed by broad categories. Specific items should be concrete and descriptive (e.g. "remote control", "singing bowl", "kalimba", "sunflower", "tablet"). Broad categories should be title-cased (e.g. "Electronics", "Music", "Home Decor", "Clothing", "Tools"). Aim for 3-6 specific items then 2-4 broad categories.
- "objects": an array of all specific visible items (can overlap with tags)
- "searchTerms": an array of additional search-friendly terms a person might use to find these items later. Include common synonyms (e.g. "cord" for "cable", "xmas" for "Christmas"), informal names, related concepts, and plurals. Think about what words someone would type when trying to find these items months later. Aim for 8-15 terms.
Return only valid JSON with no markdown formatting or code fences.`;

      const result = await model.generateContent([
        prompt,
        { inlineData: { data: base64, mimeType: 'image/jpeg' } },
      ]);

      const text = result.response.text().trim();
      // Strip any accidental markdown fences
      const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(clean) as {
        description?: string;
        tags?: string[];
        objects?: string[];
        searchTerms?: string[];
      };

      const tags = Array.isArray(parsed.tags) ? parsed.tags : [];
      console.log('analyzeContainerPhoto success, tags:', tags);
      await docRef.update({
        aiStatus:       'done',
        aiDescription:  parsed.description ?? '',
        aiTags:         tags,
        aiObjects:      Array.isArray(parsed.objects) ? parsed.objects : [],
        aiSearchTerms:  Array.isArray(parsed.searchTerms) ? parsed.searchTerms : [],
      });
    } catch (err) {
      console.error('analyzeContainerPhoto error:', err);
      await docRef.update({ aiStatus: 'error' });
    }
  }
);
