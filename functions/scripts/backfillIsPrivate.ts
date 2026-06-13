/**
 * Backfill isPrivate: false on all container documents that are missing the field.
 *
 * Usage (dry run):    npx ts-node scripts/backfillIsPrivate.ts
 * Usage (live write): npx ts-node scripts/backfillIsPrivate.ts --write
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service account key,
 * or run inside the Firebase project environment.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DRY_RUN = !process.argv.includes('--write');

async function main() {
  if (!getApps().length) {
    initializeApp(
      process.env.GOOGLE_APPLICATION_CREDENTIALS
        ? { credential: cert(process.env.GOOGLE_APPLICATION_CREDENTIALS) }
        : undefined // uses Application Default Credentials in Cloud Shell / CI
    );
  }

  const db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });

  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (pass --write to apply)' : 'LIVE WRITE'}`);

  // --- Pass 1: find all container docs missing isPrivate ---
  const allContainers = await db.collectionGroup('containers').get();
  const missing = allContainers.docs.filter(d => d.data().isPrivate === undefined);

  console.log(`Total container documents:         ${allContainers.size}`);
  console.log(`Missing isPrivate (need backfill): ${missing.length}`);

  if (missing.length === 0) {
    console.log('Nothing to patch. Exiting.');
    return;
  }

  if (DRY_RUN) {
    console.log('\nSample paths that would be patched (first 10):');
    missing.slice(0, 10).forEach(d => console.log(' ', d.ref.path));
    console.log('\nRun with --write to apply patches.');
    return;
  }

  // --- Pass 2: batch-write isPrivate: false ---
  const BATCH_SIZE = 400; // Firestore max is 500; stay under
  let patched = 0;

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = missing.slice(i, i + BATCH_SIZE);
    for (const d of chunk) {
      batch.update(d.ref, { isPrivate: false });
    }
    await batch.commit();
    patched += chunk.length;
    console.log(`Patched ${patched} / ${missing.length}…`);
  }

  console.log(`\nWrite complete. Patched ${patched} documents.`);

  // --- Pass 3: verification pass ---
  console.log('\nVerification pass…');
  const verifySnap = await db.collectionGroup('containers').get();
  const stillMissing = verifySnap.docs.filter(d => d.data().isPrivate === undefined);

  console.log(`Total container documents (re-read): ${verifySnap.size}`);
  console.log(`Still missing isPrivate:             ${stillMissing.length}`);

  if (stillMissing.length === 0) {
    console.log('All documents now have isPrivate. Backfill successful.');
  } else {
    console.warn('WARNING: some documents still missing isPrivate:');
    stillMissing.forEach(d => console.warn(' ', d.ref.path));
  }
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
