import type { Firestore } from 'firebase-admin/firestore';

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

function requiredId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
}

function isSharedContainer(data: FirebaseFirestore.DocumentData): boolean {
  return data.deletedAt == null &&
    data.effectiveIsPrivate === false &&
    (data.visibility === 'shared' || data.visibility === 'inherit') &&
    Array.isArray(data.photos);
}

function activeAccess(
  data: FirebaseFirestore.DocumentData,
  ownerUid: string,
  collaboratorUid: string,
  nowMs: number,
): boolean {
  return data.schemaVersion === 1 &&
    data.ownerUid === ownerUid &&
    data.collaboratorUid === collaboratorUid &&
    data.status === 'active' &&
    Array.isArray(data.capabilities) &&
    data.capabilities.includes('item.move') &&
    typeof data.validFromMs === 'number' &&
    data.validFromMs <= nowMs &&
    (data.expiresAtMs === null ||
      (typeof data.expiresAtMs === 'number' && nowMs < data.expiresAtMs));
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

  await db.runTransaction(async transaction => {
    const [accessSnapshot, sourceSnapshot, destinationSnapshot] =
      await transaction.getAll(accessRef, sourceRef, destinationRef);

    if (
      !accessSnapshot.exists ||
      !activeAccess(
        accessSnapshot.data() ?? {},
        input.ownerUid,
        collaboratorUid,
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
      photoUrls: nextSourcePhotos.flatMap(item =>
        typeof item.url === 'string' ? [item.url] : []),
      photoStoragePaths: nextSourcePhotos.flatMap(item =>
        typeof item.storagePath === 'string' ? [item.storagePath] : []),
      lastModifiedAt: nowMs,
      lastModifiedBy: collaboratorUid,
    });
    transaction.update(destinationRef, {
      photos: nextDestinationPhotos,
      photoUrls: nextDestinationPhotos.flatMap(item =>
        typeof item.url === 'string' ? [item.url] : []),
      photoStoragePaths: nextDestinationPhotos.flatMap(item =>
        typeof item.storagePath === 'string' ? [item.storagePath] : []),
      lastModifiedAt: nowMs,
      lastModifiedBy: collaboratorUid,
    });
  });
}
