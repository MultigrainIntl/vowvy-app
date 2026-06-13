import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { getFirestore } from 'firebase-admin/firestore';

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
