import { FirebaseError, getApps, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';
import { firebaseConfig } from './environment';
import { auth, db } from './firebase';
import {
  acceptCollaboratorInvitation,
  issueCollaboratorInvitation,
} from './collaboration/access-lifecycle';
import { remapInventoryOwner } from './staging-inventory-copy';
import {
  activeLegacySharedInvitations,
  normalizeImportedSharedRecord,
} from './staging-shared-inventory';

const sourceConfig = {
  apiKey: import.meta.env.VITE_STAGING_SOURCE_API_KEY?.trim(),
  authDomain: import.meta.env.VITE_STAGING_SOURCE_AUTH_DOMAIN?.trim(),
  projectId: import.meta.env.VITE_STAGING_SOURCE_PROJECT_ID?.trim(),
};
const permittedOwner = import.meta.env.VITE_STAGING_IMPORT_OWNER_EMAIL?.trim().toLowerCase();

interface CopiedDocument {
  path: string[];
  data: DocumentData;
}

export function hasExistingInventoryImport(): boolean {
  return firebaseConfig.projectId === 'vowvy-staging'
    && Boolean(sourceConfig.apiKey)
    && Boolean(sourceConfig.authDomain)
    && Boolean(sourceConfig.projectId)
    && sourceConfig.projectId !== firebaseConfig.projectId
    && Boolean(permittedOwner);
}

export function canImportExistingInventory(email: string): boolean {
  return hasExistingInventoryImport() && email.trim().toLowerCase() === permittedOwner;
}

function isMissingStagingAccount(error: unknown): boolean {
  return error instanceof FirebaseError
    && ['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password'].includes(error.code);
}

async function writeCopiedDocuments(firestore: Firestore, documents: CopiedDocument[]) {
  for (let offset = 0; offset < documents.length; offset += 400) {
    const batch = writeBatch(firestore);
    for (const item of documents.slice(offset, offset + 400)) {
      batch.set(doc(firestore, item.path.join('/')), item.data, { merge: true });
    }
    await batch.commit();
  }
}

async function restoreSharedInventories(
  productionDb: Firestore,
  productionUser: User,
  stagingUser: User,
  stagingOwnerAuth: Auth,
  stagingOwnerDb: Firestore,
) {
  const [productionInvites, stagingProfile] = await Promise.all([
    getDocs(query(
      collection(productionDb, 'invites'),
      where('acceptedByUid', '==', productionUser.uid),
    )),
    getDoc(doc(db, 'users', stagingUser.uid)),
  ]);
  const alreadyImported = (stagingProfile.data()?.stagingImportedSharedOwners ?? {}) as Record<string, string>;
  const invitations = activeLegacySharedInvitations(
    productionInvites.docs.map(item => item.data()),
    productionUser.uid,
    Date.now(),
  );

  for (const invitation of invitations) {
    const previousStagingOwner = alreadyImported[invitation.ownerUid];
    if (typeof previousStagingOwner === 'string' && previousStagingOwner) {
      const access = await getDoc(doc(
        db,
        'users',
        previousStagingOwner,
        'collaboratorAccess',
        stagingUser.uid,
      ));
      if (access.exists() && access.data().status === 'active') continue;
    }

    const currentProductionAccess = await getDoc(doc(
      productionDb,
      'users',
      invitation.ownerUid,
      'collaborators',
      productionUser.uid,
    ));
    if (!currentProductionAccess.exists() || currentProductionAccess.data().status !== 'active') continue;

    const [locations, containers] = await Promise.all([
      getDocs(query(
        collection(productionDb, 'users', invitation.ownerUid, 'locations'),
        where('effectiveIsPrivate', '==', false),
      )),
      getDocs(query(
        collection(productionDb, 'users', invitation.ownerUid, 'containers'),
        where('effectiveIsPrivate', '==', false),
      )),
    ]);

    const isolatedOwner = await createUserWithEmailAndPassword(
      stagingOwnerAuth,
      `owner-${crypto.randomUUID()}@vowvy-staging.invalid`,
      `${crypto.randomUUID()}-${crypto.randomUUID()}`,
    );
    const stagingOwnerUid = isolatedOwner.user.uid;
    const copies: CopiedDocument[] = [{
      path: ['users', stagingOwnerUid],
      data: { displayName: invitation.ownerDisplayName },
    }];
    for (const [collectionName, snapshots] of [
      ['locations', locations],
      ['containers', containers],
    ] as const) {
      for (const snapshot of snapshots.docs) {
        const data = normalizeImportedSharedRecord(
          snapshot.data(),
          invitation.ownerUid,
          stagingOwnerUid,
        );
        if (data) {
          copies.push({ path: ['users', stagingOwnerUid, collectionName, snapshot.id], data });
        }
      }
    }
    await writeCopiedDocuments(stagingOwnerDb, copies);

    const nowMs = Date.now();
    const invitationId = crypto.randomUUID();
    const issued = issueCollaboratorInvitation({
      invitationId,
      ownerUid: stagingOwnerUid,
      createdByUid: stagingOwnerUid,
      nowMs,
      expiresAtMs: null,
    });
    if (!issued.ok) throw new Error(`shared-inventory-invitation:${issued.reason}`);
    const pendingInvitation = { ...issued.value, ownerDisplayName: invitation.ownerDisplayName };
    await setDoc(doc(stagingOwnerDb, 'invites', invitationId), pendingInvitation);

    const accepted = acceptCollaboratorInvitation({
      invitation: pendingInvitation,
      collaboratorUid: stagingUser.uid,
      accessId: crypto.randomUUID(),
      nowMs: Date.now(),
    });
    if (!accepted.ok) throw new Error(`shared-inventory-access:${accepted.reason}`);
    const accessBatch = writeBatch(db);
    accessBatch.set(doc(db, 'invites', invitationId), accepted.value.invitation);
    accessBatch.set(
      doc(db, 'users', stagingOwnerUid, 'collaboratorAccess', stagingUser.uid),
      { ...accepted.value.access, ownerDisplayName: invitation.ownerDisplayName },
    );
    await accessBatch.commit();
    await setDoc(
      doc(db, 'users', stagingUser.uid),
      { stagingImportedSharedOwners: { [invitation.ownerUid]: stagingOwnerUid } },
      { merge: true },
    );
    await signOut(stagingOwnerAuth);
  }
}

export async function signInWithExistingInventory(email: string, password: string): Promise<void> {
  if (!canImportExistingInventory(email)) {
    await signInWithEmailAndPassword(auth, email, password);
    return;
  }

  let existingStagingUser: User | null = null;
  try {
    existingStagingUser = (await signInWithEmailAndPassword(auth, email, password)).user;
  } catch (error) {
    if (!isMissingStagingAccount(error)) throw error;
  }

  const productionApp = getApps().find(app => app.name === 'vowvy-existing-account-source')
    ?? initializeApp(sourceConfig, 'vowvy-existing-account-source');
  const stagingImportApp = getApps().find(app => app.name === 'vowvy-existing-account-staging')
    ?? initializeApp(firebaseConfig, 'vowvy-existing-account-staging');
  const stagingSharedOwnerApp = getApps().find(app => app.name === 'vowvy-existing-shared-owner')
    ?? initializeApp(firebaseConfig, 'vowvy-existing-shared-owner');
  const productionAuth = getAuth(productionApp);
  const stagingImportAuth = getAuth(stagingImportApp);
  const stagingSharedOwnerAuth = getAuth(stagingSharedOwnerApp);

  try {
    const productionUser = (await signInWithEmailAndPassword(productionAuth, email, password)).user;
    const productionDb = getFirestore(productionApp);
    let stagingUser = existingStagingUser;

    if (!stagingUser) {
      const [profile, locations, containers] = await Promise.all([
        getDoc(doc(productionDb, 'users', productionUser.uid)),
        getDocs(collection(productionDb, 'users', productionUser.uid, 'locations')),
        getDocs(collection(productionDb, 'users', productionUser.uid, 'containers')),
      ]);
      const staged = await createUserWithEmailAndPassword(stagingImportAuth, email, password);
      const stagingOwnerUid = staged.user.uid;
      const copies: CopiedDocument[] = [
        {
          path: ['users', stagingOwnerUid],
          data: remapInventoryOwner(profile.data() ?? {}, productionUser.uid, stagingOwnerUid) as DocumentData,
        },
        ...locations.docs.map(snapshot => ({
          path: ['users', stagingOwnerUid, 'locations', snapshot.id],
          data: remapInventoryOwner(snapshot.data(), productionUser.uid, stagingOwnerUid) as DocumentData,
        })),
        ...containers.docs.map(snapshot => ({
          path: ['users', stagingOwnerUid, 'containers', snapshot.id],
          data: remapInventoryOwner(snapshot.data(), productionUser.uid, stagingOwnerUid) as DocumentData,
        })),
      ];
      await writeCopiedDocuments(getFirestore(stagingImportApp), copies);
      stagingUser = (await signInWithEmailAndPassword(auth, email, password)).user;
    }

    await restoreSharedInventories(
      productionDb,
      productionUser,
      stagingUser,
      stagingSharedOwnerAuth,
      getFirestore(stagingSharedOwnerApp),
    );
  } finally {
    await Promise.allSettled([
      signOut(productionAuth),
      signOut(stagingImportAuth),
      signOut(stagingSharedOwnerAuth),
    ]);
  }
}
