const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const {
  MoveCollaboratorPhotoFailure,
  moveCollaboratorPhotoTransaction,
} = require('../lib/moveCollaboratorPhoto');

const app = initializeApp({ projectId: 'vowvy-1ba5f' }, 'move-photo-tests');
const db = getFirestore(app);
const ownerUid = 'owner-function-test';
const collaboratorUid = 'collaborator-function-test';

function access(overrides = {}) {
  return {
    schemaVersion: 1,
    accessId: 'access-1',
    invitationId: 'invite-1',
    ownerUid,
    collaboratorUid,
    status: 'active',
    capabilities: ['inventory.read', 'item.move'],
    validFromMs: 0,
    expiresAtMs: null,
    ...overrides,
  };
}

function container(overrides = {}) {
  return {
    name: 'Shared box',
    visibility: 'inherit',
    effectiveIsPrivate: false,
    deletedAt: null,
    photos: [],
    ...overrides,
  };
}

async function seed(accessOverrides = {}, containerOverrides = {}) {
  await db.recursiveDelete(db.doc(`users/${ownerUid}`));
  await Promise.all([
    db.doc(`users/${ownerUid}/collaboratorAccess/${collaboratorUid}`)
      .set(access(accessOverrides)),
    db.doc(`users/${ownerUid}/containers/source`)
      .set(container({
        photos: [{
          id: 'photo-1',
          url: 'https://example.test/photo.jpg',
          storagePath: `users/${ownerUid}/containers/source/photo.jpg`,
        }],
        ...containerOverrides.source,
      })),
    db.doc(`users/${ownerUid}/containers/destination`)
      .set(container(containerOverrides.destination)),
  ]);
}

const input = {
  ownerUid,
  sourceContainerId: 'source',
  destinationContainerId: 'destination',
  photoId: 'photo-1',
};

async function rejectsWith(reason, operation) {
  await assert.rejects(operation, error =>
    error instanceof MoveCollaboratorPhotoFailure && error.reason === reason,
  );
}

test('trusted transaction moves exactly one photo atomically', async () => {
  await seed();
  await moveCollaboratorPhotoTransaction(db, collaboratorUid, input, 100);
  const [source, destination] = await Promise.all([
    db.doc(`users/${ownerUid}/containers/source`).get(),
    db.doc(`users/${ownerUid}/containers/destination`).get(),
  ]);
  assert.equal(source.data().photos.length, 0);
  assert.equal(destination.data().photos.length, 1);
  assert.equal(destination.data().photos[0].id, 'photo-1');
  assert.equal(source.data().lastModifiedBy, collaboratorUid);
  assert.equal(destination.data().lastModifiedBy, collaboratorUid);
});

test('denies expired and revoked access without changing either container', async () => {
  for (const accessOverrides of [
    { expiresAtMs: 100 },
    { status: 'revoked' },
  ]) {
    await seed(accessOverrides);
    await rejectsWith(
      'permission-denied',
      () => moveCollaboratorPhotoTransaction(
        db,
        collaboratorUid,
        input,
        100,
      ),
    );
    const source = await db.doc(`users/${ownerUid}/containers/source`).get();
    const destination =
      await db.doc(`users/${ownerUid}/containers/destination`).get();
    assert.equal(source.data().photos.length, 1);
    assert.equal(destination.data().photos.length, 0);
  }
});

test('denies the wrong user, missing capability, and private destination', async () => {
  await seed();
  await rejectsWith(
    'permission-denied',
    () => moveCollaboratorPhotoTransaction(db, 'other-user', input, 100),
  );

  await seed({ capabilities: ['inventory.read'] });
  await rejectsWith(
    'permission-denied',
    () => moveCollaboratorPhotoTransaction(db, collaboratorUid, input, 100),
  );

  await seed({}, {
    destination: { visibility: 'private', effectiveIsPrivate: true },
  });
  await rejectsWith(
    'private-container',
    () => moveCollaboratorPhotoTransaction(db, collaboratorUid, input, 100),
  );
});

test('denies missing and duplicate photos', async () => {
  await seed();
  await rejectsWith(
    'photo-not-found',
    () => moveCollaboratorPhotoTransaction(
      db,
      collaboratorUid,
      { ...input, photoId: 'missing' },
      100,
    ),
  );

  await seed({}, {
    destination: { photos: [{ id: 'photo-1' }] },
  });
  await rejectsWith(
    'photo-already-exists',
    () => moveCollaboratorPhotoTransaction(db, collaboratorUid, input, 100),
  );
});

test.after(async () => {
  await db.recursiveDelete(db.doc(`users/${ownerUid}`));
  await deleteApp(app);
});
