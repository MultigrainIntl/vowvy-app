import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { expect } from 'vitest';
import {
  createFirebaseLifecycleAdapter,
  type LifecycleClock,
} from '../../src/collaboration/firebase-lifecycle-adapter';
import { COLLABORATOR_CAPABILITIES } from '../../src/collaboration/access-model';

const projectId = 'vowvy-emulator';
let environment: RulesTestEnvironment;

const ownerUid = 'owner-1';
const collaboratorUid = 'collaborator-1';

function access(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    accessId: 'access-1',
    invitationId: 'invite-1',
    ownerUid,
    collaboratorUid,
    status: 'active',
    capabilities: [
      'inventory.read',
      'location.create',
      'container.create',
      'photo.create',
      'note.create',
      'note.edit',
      'item.move',
    ],
    validFromMs: 0,
    expiresAtMs: null,
    ...overrides,
  };
}

function location(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Kitchen',
    parentId: null,
    visibility: 'shared',
    effectiveIsPrivate: false,
    deletedAt: null,
    createdBy: ownerUid,
    ...overrides,
  };
}

function container(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Kitchen box',
    locationId: 'location-1',
    location: 'Kitchen',
    visibility: 'inherit',
    effectiveIsPrivate: false,
    deletedAt: null,
    createdBy: ownerUid,
    notes: [],
    photos: [],
    ...overrides,
  };
}

async function seed(dataOverrides: Record<string, unknown> = {}) {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(
      doc(db, `users/${ownerUid}/collaboratorAccess/${collaboratorUid}`),
      access(dataOverrides),
    );
    await setDoc(
      doc(db, `users/${ownerUid}/locations/location-1`),
      location(),
    );
    await setDoc(
      doc(db, `users/${ownerUid}/locations/private-location`),
      location({ visibility: 'private', effectiveIsPrivate: true }),
    );
    await setDoc(
      doc(db, `users/${ownerUid}/containers/container-1`),
      container(),
    );
    await setDoc(
      doc(db, `users/${ownerUid}/containers/private-container`),
      container({ effectiveIsPrivate: true }),
    );
  });
}

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
    storage: {
      rules: readFileSync('storage.rules', 'utf8'),
      host: '127.0.0.1',
      port: 9199,
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await seed();
});

afterAll(async () => {
  await environment.cleanup();
});

describe('collaborator Firebase enforcement', () => {
  it('allows shared reads and denies private reads', async () => {
    const db = environment.authenticatedContext(collaboratorUid).firestore();
    await assertSucceeds(
      getDoc(doc(db, `users/${ownerUid}/containers/container-1`)),
    );
    await assertFails(
      getDoc(doc(db, `users/${ownerUid}/containers/private-container`)),
    );
  });

  it('allows a collaborator to discover only their own access records', async () => {
    const db = environment.authenticatedContext(collaboratorUid).firestore();
    const result = await assertSucceeds(
      getDocs(
        query(
          collectionGroup(db, 'collaboratorAccess'),
          where('collaboratorUid', '==', collaboratorUid),
        ),
      ),
    );
    expect(result.docs).toHaveLength(1);

    const otherDb = environment.authenticatedContext('other-user').firestore();
    await assertFails(
      getDocs(
        query(
          collectionGroup(otherDb, 'collaboratorAccess'),
          where('collaboratorUid', '==', collaboratorUid),
        ),
      ),
    );
  });

  it('allows only a canonical shared-inventory query', async () => {
    await environment.clearFirestore();
    await seed({ expiresAtMs: Date.now() + 60_000 });
    const db = environment.authenticatedContext(collaboratorUid).firestore();
    await assertSucceeds(
      getDocs(
        query(
          collection(db, `users/${ownerUid}/containers`),
          where('effectiveIsPrivate', '==', false),
          where('visibility', 'in', ['shared', 'inherit']),
          where('deletedAt', '==', null),
        ),
      ),
    );
    await assertFails(
      getDocs(collection(db, `users/${ownerUid}/containers`)),
    );
  });

  it('denies access after expiration even when status remains active', async () => {
    await environment.clearFirestore();
    await seed({ expiresAtMs: 1 });
    const db = environment.authenticatedContext(collaboratorUid).firestore();
    await assertFails(
      getDoc(doc(db, `users/${ownerUid}/containers/container-1`)),
    );
  });

  it('denies access after manual revocation', async () => {
    await environment.clearFirestore();
    await seed({ status: 'revoked' });
    const db = environment.authenticatedContext(collaboratorUid).firestore();
    await assertFails(
      getDoc(doc(db, `users/${ownerUid}/containers/container-1`)),
    );
  });

  it('allows approved creation but rejects private creation', async () => {
    const db = environment.authenticatedContext(collaboratorUid).firestore();
    await assertSucceeds(
      setDoc(doc(db, `users/${ownerUid}/locations/new-location`), {
        ...location({ createdBy: collaboratorUid }),
      }),
    );
    await assertFails(
      setDoc(doc(db, `users/${ownerUid}/locations/bad-location`), {
        ...location({
          createdBy: collaboratorUid,
          visibility: 'private',
          effectiveIsPrivate: true,
        }),
      }),
    );
  });

  it('allows notes and moves but denies deletion and privacy changes', async () => {
    const db = environment.authenticatedContext(collaboratorUid).firestore();
    const target = doc(db, `users/${ownerUid}/containers/container-1`);
    await assertSucceeds(
      updateDoc(target, {
        notes: [
          {
            id: 'note-1',
            text: 'Added',
            addedBy: collaboratorUid,
            createdAt: 1,
          },
        ],
      }),
    );
    await assertSucceeds(
      updateDoc(target, { locationId: 'location-1', location: 'Kitchen' }),
    );
    await assertFails(updateDoc(target, { deletedAt: 1 }));
    await assertFails(
      updateDoc(target, {
        visibility: 'private',
        effectiveIsPrivate: true,
      }),
    );
  });

  it('denies browser-side photo moves so only the trusted function can move them', async () => {
    await environment.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(
        doc(db, `users/${ownerUid}/containers/container-1`),
        container({
          photos: [{
            id: 'photo-1',
            url: 'https://example.test/photo.jpg',
            storagePath: `users/${ownerUid}/containers/container-1/photo.jpg`,
            description: '',
            createdAt: 1,
            addedBy: ownerUid,
          }],
        }),
      );
      await setDoc(
        doc(db, `users/${ownerUid}/containers/container-2`),
        container({ name: 'Second box' }),
      );
    });
    const db = environment.authenticatedContext(collaboratorUid).firestore();
    await assertFails(
      updateDoc(
        doc(db, `users/${ownerUid}/containers/container-1`),
        { photos: [] },
      ),
    );
  });

  it('prevents collaborators from changing their access record', async () => {
    const db = environment.authenticatedContext(collaboratorUid).firestore();
    await assertFails(
      updateDoc(
        doc(db, `users/${ownerUid}/collaboratorAccess/${collaboratorUid}`),
        { status: 'active', expiresAtMs: null },
      ),
    );
  });

  it('allows image upload only under a verified shared container', async () => {
    const storage = environment.authenticatedContext(collaboratorUid).storage();
    const image = new Uint8Array([1, 2, 3]);
    await assertSucceeds(
      uploadBytes(
        ref(
          storage,
          `users/${ownerUid}/containers/container-1/photo.jpg`,
        ),
        image,
        { contentType: 'image/jpeg' },
      ),
    );
    await assertFails(
      uploadBytes(
        ref(
          storage,
          `users/${ownerUid}/containers/private-container/photo.jpg`,
        ),
        image,
        { contentType: 'image/jpeg' },
      ),
    );
  });

  it('denies storage reads after revocation', async () => {
    const ownerStorage = environment.authenticatedContext(ownerUid).storage();
    const path = `users/${ownerUid}/containers/container-1/photo.jpg`;
    await uploadBytes(ref(ownerStorage, path), new Uint8Array([1]), {
      contentType: 'image/jpeg',
    });
    await environment.withSecurityRulesDisabled(async context => {
      await updateDoc(
        doc(
          context.firestore(),
          `users/${ownerUid}/collaboratorAccess/${collaboratorUid}`,
        ),
        { status: 'revoked' },
      );
    });
    const collaboratorStorage =
      environment.authenticatedContext(collaboratorUid).storage();
    await assertFails(getBytes(ref(collaboratorStorage, path)));
  });
});

describe('trusted collaborator lifecycle transactions', () => {
  function clock(nowMs: number, accessIds: string[]): LifecycleClock {
    return {
      nowMs: () => nowMs,
      newAccessId: () => {
        const accessId = accessIds.shift();
        if (!accessId) throw new Error('missing-test-access-id');
        return accessId;
      },
    };
  }

  it('atomically accepts a valid invitation and creates access', async () => {
    await environment.clearFirestore();
    const now = Date.now();
    const ownerDb = environment.authenticatedContext(ownerUid).firestore();
    const collaboratorDb =
      environment.authenticatedContext(collaboratorUid).firestore();

    await createFirebaseLifecycleAdapter(
      ownerDb,
      clock(now, []),
    ).issueInvitation({
      invitationId: 'invite-accept',
      ownerUid,
      createdByUid: ownerUid,
      nowMs: now,
      expiresAtMs: now + 60_000,
    });

    await createFirebaseLifecycleAdapter(
      collaboratorDb,
      clock(now + 1, ['access-accept']),
    ).acceptInvitation('invite-accept', collaboratorUid);

    const accessSnapshot = await getDoc(
      doc(
        collaboratorDb,
        `users/${ownerUid}/collaboratorAccess/${collaboratorUid}`,
      ),
    );
    const invitationSnapshot = await getDoc(
      doc(collaboratorDb, 'invites/invite-accept'),
    );

    expect(accessSnapshot.data()).toMatchObject({
      invitationId: 'invite-accept',
      accessId: 'access-accept',
      ownerUid,
      collaboratorUid,
      status: 'active',
      capabilities: COLLABORATOR_CAPABILITIES,
    });
    expect(invitationSnapshot.data()).toMatchObject({
      status: 'accepted',
      acceptedByUid: collaboratorUid,
      accessId: 'access-accept',
    });
  });

  it('rejects manufactured access without a matching invitation transaction', async () => {
    await environment.clearFirestore();
    const collaboratorDb =
      environment.authenticatedContext(collaboratorUid).firestore();
    await assertFails(
      setDoc(
        doc(
          collaboratorDb,
          `users/${ownerUid}/collaboratorAccess/${collaboratorUid}`,
        ),
        access({ invitationId: 'missing-invite' }),
      ),
    );
  });

  it('rejects acceptance after the invitation deadline', async () => {
    await environment.clearFirestore();
    const now = Date.now();
    const ownerDb = environment.authenticatedContext(ownerUid).firestore();
    const collaboratorDb =
      environment.authenticatedContext(collaboratorUid).firestore();
    await createFirebaseLifecycleAdapter(ownerDb, clock(now - 2_000, []))
      .issueInvitation({
        invitationId: 'invite-expired',
        ownerUid,
        createdByUid: ownerUid,
        nowMs: now - 2_000,
        expiresAtMs: now - 1_000,
      });

    await expect(
      createFirebaseLifecycleAdapter(
        collaboratorDb,
        clock(now, ['access-expired']),
      ).acceptInvitation('invite-expired', collaboratorUid),
    ).rejects.toThrow('collaboration-lifecycle:expired');
  });

  it('atomically revokes an unaccepted invitation', async () => {
    await environment.clearFirestore();
    const now = Date.now();
    const ownerDb = environment.authenticatedContext(ownerUid).firestore();
    const adapter = createFirebaseLifecycleAdapter(
      ownerDb,
      clock(now + 1, []),
    );
    await createFirebaseLifecycleAdapter(ownerDb, clock(now, []))
      .issueInvitation({
        invitationId: 'invite-pending-revoke',
        ownerUid,
        createdByUid: ownerUid,
        nowMs: now,
        expiresAtMs: now + 60_000,
      });
    await adapter.revokeInvitation('invite-pending-revoke', ownerUid);

    const invitation = await getDoc(
      doc(ownerDb, 'invites/invite-pending-revoke'),
    );
    expect(invitation.data()).toMatchObject({
      status: 'revoked',
      revokedByUid: ownerUid,
    });
  });

  it('atomically revokes both accepted invitation and current access', async () => {
    await environment.clearFirestore();
    const now = Date.now();
    const ownerDb = environment.authenticatedContext(ownerUid).firestore();
    const collaboratorDb =
      environment.authenticatedContext(collaboratorUid).firestore();

    await createFirebaseLifecycleAdapter(ownerDb, clock(now, []))
      .issueInvitation({
        invitationId: 'invite-revoke',
        ownerUid,
        createdByUid: ownerUid,
        nowMs: now,
        expiresAtMs: now + 60_000,
      });
    await createFirebaseLifecycleAdapter(
      collaboratorDb,
      clock(now + 1, ['access-revoke']),
    ).acceptInvitation('invite-revoke', collaboratorUid);
    await createFirebaseLifecycleAdapter(
      ownerDb,
      clock(now + 2, []),
    ).revokeAccess(ownerUid, collaboratorUid);

    const accessSnapshot = await getDoc(
      doc(
        ownerDb,
        `users/${ownerUid}/collaboratorAccess/${collaboratorUid}`,
      ),
    );
    const invitationSnapshot = await getDoc(
      doc(ownerDb, 'invites/invite-revoke'),
    );
    expect(accessSnapshot.data()?.status).toBe('revoked');
    expect(invitationSnapshot.data()?.status).toBe('revoked');
  });

  it('re-invites with a new access record and preserves revoked history', async () => {
    await environment.clearFirestore();
    const now = Date.now();
    const ownerDb = environment.authenticatedContext(ownerUid).firestore();
    const collaboratorDb =
      environment.authenticatedContext(collaboratorUid).firestore();
    const ownerAdapter = createFirebaseLifecycleAdapter(
      ownerDb,
      clock(now + 2, []),
    );

    await createFirebaseLifecycleAdapter(ownerDb, clock(now, []))
      .issueInvitation({
        invitationId: 'invite-old',
        ownerUid,
        createdByUid: ownerUid,
        nowMs: now,
        expiresAtMs: now + 60_000,
      });
    await createFirebaseLifecycleAdapter(
      collaboratorDb,
      clock(now + 1, ['access-old']),
    ).acceptInvitation('invite-old', collaboratorUid);
    await ownerAdapter.revokeAccess(ownerUid, collaboratorUid);
    await ownerAdapter.issueInvitation({
      invitationId: 'invite-new',
      ownerUid,
      createdByUid: ownerUid,
      nowMs: now + 3,
      expiresAtMs: now + 60_000,
      supersedesAccessId: 'access-old',
    });
    await createFirebaseLifecycleAdapter(
      collaboratorDb,
      clock(now + 4, ['access-new']),
    ).acceptInvitation('invite-new', collaboratorUid);

    const current = await getDoc(
      doc(
        ownerDb,
        `users/${ownerUid}/collaboratorAccess/${collaboratorUid}`,
      ),
    );
    const history = await getDoc(
      doc(
        ownerDb,
        `users/${ownerUid}/collaboratorAccessHistory/access-old`,
      ),
    );
    expect(current.data()).toMatchObject({
      accessId: 'access-new',
      invitationId: 'invite-new',
      status: 'active',
      supersedesAccessId: 'access-old',
    });
    expect(history.data()).toMatchObject({
      accessId: 'access-old',
      status: 'revoked',
    });
  });
});
