import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import { httpsCallable, type Functions } from 'firebase/functions';
import type {
  CollaboratorContainer,
  CollaboratorLocation,
  CollaboratorNote,
  CollaboratorPhoto,
  InventoryServiceAdapter,
  NewCollaboratorContainer,
  NewCollaboratorLocation,
} from './inventory-service';

function locationsPath(ownerUid: string) {
  return `users/${ownerUid}/locations`;
}

function containersPath(ownerUid: string) {
  return `users/${ownerUid}/containers`;
}

export function createFirebaseInventoryAdapter(
  firestore: Firestore,
  functions?: Functions,
  options: { legacyCompatible?: boolean } = {},
): InventoryServiceAdapter {
  return {
    async listLocations(ownerUid) {
      if (options.legacyCompatible) {
        const snapshots = await getDocs(query(
          collection(firestore, locationsPath(ownerUid)),
          where('effectiveIsPrivate', '==', false),
        ));
        return snapshots.docs.flatMap(item => {
          const value = item.data();
          if (value.visibility === 'private' || value.deletedAt != null) return [];
          return [{
            id: item.id,
            ...value,
            visibility: value.visibility ?? 'inherit',
            deletedAt: value.deletedAt ?? null,
          } as CollaboratorLocation];
        });
      }
      const snapshots = await Promise.all(
        (['shared', 'inherit'] as const).map(visibility =>
          getDocs(
            query(
              collection(firestore, locationsPath(ownerUid)),
              where('effectiveIsPrivate', '==', false),
              where('visibility', '==', visibility),
              where('deletedAt', '==', null),
            ),
          ),
        ),
      );
      return snapshots.flatMap(snapshot =>
        snapshot.docs.map(item => ({
          id: item.id,
          ...item.data(),
        })),
      ) as CollaboratorLocation[];
    },

    async listContainers(ownerUid) {
      if (options.legacyCompatible) {
        const snapshots = await getDocs(query(
          collection(firestore, containersPath(ownerUid)),
          where('effectiveIsPrivate', '==', false),
        ));
        return snapshots.docs.flatMap(item => {
          const value = item.data();
          if (value.visibility === 'private' || value.deletedAt != null) return [];
          return [{
            id: item.id,
            ...value,
            visibility: value.visibility ?? 'inherit',
            deletedAt: value.deletedAt ?? null,
            notes: value.notes ?? [],
            photos: value.photos ?? [],
          } as CollaboratorContainer];
        });
      }
      const snapshot = await getDocs(
        query(
          collection(firestore, containersPath(ownerUid)),
          where('effectiveIsPrivate', '==', false),
          where('visibility', 'in', ['shared', 'inherit']),
          where('deletedAt', '==', null),
        ),
      );
      return snapshot.docs.map(item => ({
        id: item.id,
        ...item.data(),
      })) as CollaboratorContainer[];
    },

    async getLocation(ownerUid, locationId) {
      const snapshot = await getDoc(
        doc(firestore, locationsPath(ownerUid), locationId),
      );
      return snapshot.exists()
        ? ({ id: snapshot.id, ...snapshot.data() } as CollaboratorLocation)
        : null;
    },

    async getContainer(ownerUid, containerId) {
      const snapshot = await getDoc(
        doc(firestore, containersPath(ownerUid), containerId),
      );
      return snapshot.exists()
        ? ({ id: snapshot.id, ...snapshot.data() } as CollaboratorContainer)
        : null;
    },

    async createLocation(ownerUid, location: NewCollaboratorLocation) {
      const created = await addDoc(
        collection(firestore, locationsPath(ownerUid)),
        { ...location, createdAt: serverTimestamp(), deletedAt: null },
      );
      return created.id;
    },

    async createContainer(ownerUid, container: NewCollaboratorContainer) {
      const created = await addDoc(
        collection(firestore, containersPath(ownerUid)),
        { ...container, createdAt: serverTimestamp(), deletedAt: null },
      );
      return created.id;
    },

    async appendPhoto(ownerUid, containerId, photo: CollaboratorPhoto) {
      await updateDoc(
        doc(firestore, containersPath(ownerUid), containerId),
        { photos: arrayUnion(photo) },
      );
    },

    async appendNote(ownerUid, containerId, note: CollaboratorNote) {
      await updateDoc(
        doc(firestore, containersPath(ownerUid), containerId),
        { notes: arrayUnion(note) },
      );
    },

    async replaceNote(ownerUid, containerId, note: CollaboratorNote) {
      const containerRef = doc(
        firestore,
        containersPath(ownerUid),
        containerId,
      );
      await runTransaction(firestore, async transaction => {
        const snapshot = await transaction.get(containerRef);
        if (!snapshot.exists()) throw new Error('container-not-found');
        const notes = (snapshot.data().notes ?? []) as CollaboratorNote[];
        const index = notes.findIndex(item => item.id === note.id);
        if (index < 0) throw new Error('note-not-found');
        const next = [...notes];
        next[index] = note;
        transaction.update(containerRef, { notes: next });
      });
    },

    async moveContainer(
      ownerUid,
      containerId,
      locationId,
      location,
    ) {
      await updateDoc(
        doc(firestore, containersPath(ownerUid), containerId),
        { locationId, location },
      );
    },

    async movePhoto(
      ownerUid,
      sourceContainerId,
      destinationContainerId,
      photoId,
    ) {
      if (!functions) throw new Error('functions-unavailable');
      const move = httpsCallable<
        {
          ownerUid: string;
          sourceContainerId: string;
          destinationContainerId: string;
          photoId: string;
        },
        { ok: true }
      >(functions, 'moveCollaboratorPhoto');
      await move({
        ownerUid,
        sourceContainerId,
        destinationContainerId,
        photoId,
      });
    },
  };
}
