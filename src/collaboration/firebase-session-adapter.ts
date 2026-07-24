import {
  collection,
  collectionGroup,
  onSnapshot,
  query,
  where,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  evaluateCollaboratorAccess,
  isCollaboratorAccessRecord,
  type CollaboratorAccessRecord,
  type CollaboratorSession,
} from './access-model';

export interface SharedInventorySession {
  ownerUid: string;
  ownerLabel: string;
  access: CollaboratorAccessRecord;
  session: CollaboratorSession;
}

export interface OwnedCollaboratorAccess {
  collaboratorUid: string;
  access: CollaboratorAccessRecord;
}

function ownerLabel(ownerUid: string): string {
  return `Shared inventory ${ownerUid.slice(0, 6)}`;
}

export function selectSharedInventorySessions(
  values: unknown[],
  collaboratorUid: string,
  nowMs: number,
): SharedInventorySession[] {
  return values.flatMap(value => {
    if (!isCollaboratorAccessRecord(value)) return [];
    const decision = evaluateCollaboratorAccess(
      value,
      value.ownerUid,
      collaboratorUid,
      nowMs,
    );
    if (!decision.allowed) return [];
    return [{
      ownerUid: value.ownerUid,
      ownerLabel: ownerLabel(value.ownerUid),
      access: value,
      session: decision.session,
    }];
  });
}

export function observeSharedInventorySessions(
  firestore: Firestore,
  collaboratorUid: string,
  onChange: (sessions: SharedInventorySession[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const accessQuery = query(
    collectionGroup(firestore, 'collaboratorAccess'),
    where('collaboratorUid', '==', collaboratorUid),
  );

  return onSnapshot(
    accessQuery,
    snapshot => {
      onChange(selectSharedInventorySessions(
        snapshot.docs.map(item => item.data()),
        collaboratorUid,
        Date.now(),
      ));
    },
    error => onError(error),
  );
}

export function observeOwnedCollaboratorAccess(
  firestore: Firestore,
  ownerUid: string,
  onChange: (access: OwnedCollaboratorAccess[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(firestore, `users/${ownerUid}/collaboratorAccess`),
    snapshot => {
      onChange(snapshot.docs.flatMap(item => {
        const access = item.data();
        return isCollaboratorAccessRecord(access)
          ? [{ collaboratorUid: item.id, access }]
          : [];
      }));
    },
    error => onError(error),
  );
}
