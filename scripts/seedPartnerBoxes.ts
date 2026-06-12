import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp();
const db = getFirestore();

async function seed() {
  for (let i = 1; i <= 10; i++) {
    const boxId = `RMBC-${String(i).padStart(4, '0')}`;
    await db.collection('partnerBoxes').doc(boxId).set({
      partnerId: 'RMBC',
      partnerName: 'Rocky Mountain Box Co.',
      status: 'available',
      claimedByUid: null,
      claimedByEmail: null,
      claimedAt: null,
      returnedAt: null,
      createdAt: new Date(),
    });
    console.log(`Created ${boxId}`);
  }
  console.log('Done.');
}

seed().catch(console.error);
