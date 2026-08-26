import type { Firestore } from 'firebase-admin/firestore';
import { allowsSharedPhotoAccess } from './collaboratorAccess';

export interface MoveCollaboratorPhotoInput {
  ownerUid: string;
  sourceContainerId: string;
  destinationContainerId: string;
  photoId: string;
}

type PhotoRecord = {
  id?: unknown;
  url?: unknown;
  storagePath?: unknown;
};

function photoFieldValues(
  photos: PhotoRecord[],
  field: 'url' | 'storagePath',
): string[] {
  const values: string[] = [];
  for (const photo of photos) {
    const value = photo[field];
    if (typeof value === 'string') values.push(value);
  }
  return values;
}

function requiredId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
}

function isSharedContainer(data: FirebaseFirestore.DocumentData): boolean {
  return data.deletedAt == null &&
    data.effectiveIsPrivate === false &&
    (data.visibility === 'shared' || data.visibility === 'inherit') &&
    Array.isArray(data.photos);
}

export type MoveCollaboratorPhotoError =
  | 'invalid-input'
  | 'permission-denied'
  | 'container-not-found'
  | 'private-container'
  | 'photo-not-found'
  | 'photo-already-exists';

export class MoveCollaboratorPhotoFailure extends Error {
  constructor(readonly reason: MoveCollaboratorPhotoError) {
    super(reason);
  }
}

export async function moveCollaboratorPhotoTransaction(
  db: Firestore,
  collaboratorUid: string,
  input: MoveCollaboratorPhotoInput,
  nowMs = Date.now(),
): Promise<void> {
  if (
    !requiredId(collaboratorUid) ||
    !requiredId(input.ownerUid) ||
    !requiredId(input.sourceContainerId) ||
    !requiredId(input.destinationContainerId) ||
    !requiredId(input.photoId) ||
    collaboratorUid === input.ownerUid ||
    input.sourceContainerId === input.destinationContainerId
  ) {
    throw new MoveCollaboratorPhotoFailure('invalid-input');
  }

  const accessRef = db.doc(
    `users/${input.ownerUid}/collaboratorAccess/${collaboratorUid}`,
  );
  const sourceRef = db.doc(
    `users/${input.ownerUid}/containers/${input.sourceContainerId}`,
  );
  const destinationRef = db.doc(
    `users/${input.ownerUid}/containers/${input.destinationContainerId}`,
  );
  const legacyRef = db.doc(
    `users/${input.ownerUid}/collaborators/${collaboratorUid}`,
  );

  await db.runTransaction(async transaction => {
    const [accessSnapshot, legacySnapshot, sourceSnapshot, destinationSnapshot] =
      await transaction.getAll(accessRef, legacyRef, sourceRef, destinationRef);

    if (
      !allowsSharedPhotoAccess(
        accessSnapshot.exists ? accessSnapshot.data() : null,
        legacySnapshot.exists ? legacySnapshot.data() : null,
        input.ownerUid,
        collaboratorUid,
        'item.move',
        nowMs,
      )
    ) {
      throw new MoveCollaboratorPhotoFailure('permission-denied');
    }
    if (!sourceSnapshot.exists || !destinationSnapshot.exists) {
      throw new MoveCollaboratorPhotoFailure('container-not-found');
    }

    const source = sourceSnapshot.data() ?? {};
    const destination = destinationSnapshot.data() ?? {};
    if (!isSharedContainer(source) || !isSharedContainer(destination)) {
      throw new MoveCollaboratorPhotoFailure('private-container');
    }

    const sourcePhotos = source.photos as PhotoRecord[];
    const destinationPhotos = destination.photos as PhotoRecord[];
    const photo = sourcePhotos.find(item => item.id === input.photoId);
    if (!photo) throw new MoveCollaboratorPhotoFailure('photo-not-found');
    if (destinationPhotos.some(item => item.id === input.photoId)) {
      throw new MoveCollaboratorPhotoFailure('photo-already-exists');
    }

    const nextSourcePhotos = sourcePhotos.filter(
      item => item.id !== input.photoId,
    );
    const nextDestinationPhotos = [...destinationPhotos, photo];
    transaction.update(sourceRef, {
      photos: nextSourcePhotos,
      photoUrls: photoFieldValues(nextSourcePhotos, 'url'),
      photoStoragePaths: photoFieldValues(nextSourcePhotos, 'storagePath'),
      lastModifiedAt: nowMs,
      lastModifiedBy: collaboratorUid,
    });
    transaction.update(destinationRef, {
      photos: nextDestinationPhotos,
      photoUrls: photoFieldValues(nextDestinationPhotos, 'url'),
      photoStoragePaths: photoFieldValues(nextDestinationPhotos, 'storagePath'),
      lastModifiedAt: nowMs,
      lastModifiedBy: collaboratorUid,
    });
  });
}
