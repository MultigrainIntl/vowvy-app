/**
 * One-time script: delete all containers, locations, and owned invites for a user.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=path/to/serviceAccount.json \
 *   npx ts-node --project tsconfig.json scripts/clearTestData.ts <userId>
 *
 * Or with application default credentials (after `gcloud auth application-default login`):
 *   npx ts-node --project tsconfig.json scripts/clearTestData.ts <userId>
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const userId = process.argv[2];
const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
if (!userId) {
  console.error('Usage: ts-node scripts/clearTestData.ts <userId>');
  process.exit(1);
}
if (!projectId) {
  console.error('FIREBASE_PROJECT_ID must be set explicitly.');
  process.exit(1);
}

initializeApp({ projectId });
const db = getFirestore();

async function deleteCollection(path: string): Promise<number> {
  const snap = await db.collection(path).get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

async function main() {
  console.log(`Clearing test data for user: ${userId}`);

  const containers = await deleteCollection(`users/${userId}/containers`);
  console.log(`  Deleted ${containers} container(s)`);

  const locations = await deleteCollection(`users/${userId}/locations`);
  console.log(`  Deleted ${locations} location(s)`);

  const invitesSnap = await db.collection('invites')
    .where('ownerUid', '==', userId)
    .get();
  if (!invitesSnap.empty) {
    const batch = db.batch();
    invitesSnap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  console.log(`  Deleted ${invitesSnap.size} invite(s)`);

  console.log('Done.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
