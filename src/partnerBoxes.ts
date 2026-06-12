import {
  collection, doc, setDoc, getDocs,
  query, where, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';

export interface PartnerBox {
  id: string;
  partnerId: string;
  partnerName: string;
  partnerWebsite: string;
  status: 'available' | 'active' | 'returned';
  claimedByUid: string | null;
  claimedByEmail: string | null;
  claimedAt: Timestamp | null;
  returnedAt: Timestamp | null;
  createdAt: Timestamp | null;
}

export interface Partner {
  id: string;
  name: string;
  website: string;
  tagline: string;
  primaryColor: string;
}

// Hardcoded partners for now — generalize later
export const PARTNERS: Record<string, Partner> = {
  'RMBC': {
    id: 'RMBC',
    name: 'Rocky Mountain Box Co.',
    website: 'https://rockymountainboxco.com',
    tagline: 'Premium stackable moving boxes — delivered to your door.',
    primaryColor: '#2c5f8a',
  },
};

export function generateBoxId(partnerPrefix: string, sequence: number): string {
  return `${partnerPrefix}-${String(sequence).padStart(4, '0')}`;
}

export async function createPartnerBoxes(
  partnerId: string,
  count: number,
  startingSequence = 1
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const boxId = generateBoxId(partnerId, startingSequence + i);
    await setDoc(doc(db, 'partnerBoxes', boxId), {
      partnerId,
      partnerName: PARTNERS[partnerId]?.name ?? partnerId,
      status: 'available',
      claimedByUid: null,
      claimedByEmail: null,
      claimedAt: null,
      returnedAt: null,
      createdAt: serverTimestamp(),
    });
    ids.push(boxId);
  }
  return ids;
}

export async function getPartnerBoxes(partnerId: string): Promise<PartnerBox[]> {
  const q = query(
    collection(db, 'partnerBoxes'),
    where('partnerId', '==', partnerId)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({
    id: d.id,
    ...d.data(),
  } as PartnerBox));
}
