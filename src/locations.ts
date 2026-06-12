import {
  collection, addDoc, onSnapshot,
  query, orderBy, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';

export interface Location {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: Timestamp | null;
}

export function subscribeToLocations(
  userId: string,
  callback: (locations: Location[]) => void
): () => void {
  const q = query(
    collection(db, `users/${userId}/locations`),
    orderBy('createdAt', 'asc')
  );
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({
      id: d.id,
      name: d.data().name ?? '',
      parentId: d.data().parentId ?? null,
      createdAt: d.data().createdAt ?? null,
    })));
  });
}

export async function createLocation(
  userId: string,
  name: string,
  parentId: string | null = null
): Promise<string> {
  const ref = await addDoc(collection(db, `users/${userId}/locations`), {
    name: name.trim(),
    parentId,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

// Build a display path like "My House > Garage > Shelf B"
export function getLocationPath(locationId: string, allLocations: Location[]): string {
  const map = new Map(allLocations.map(l => [l.id, l]));
  const parts: string[] = [];
  let current = map.get(locationId);
  while (current) {
    parts.unshift(current.name);
    current = current.parentId ? map.get(current.parentId) : undefined;
  }
  return parts.join(' › ');
}

// Get direct children of a parent (null = top-level)
export function getLocationChildren(
  parentId: string | null,
  allLocations: Location[]
): Location[] {
  return allLocations.filter(l => l.parentId === parentId);
}
