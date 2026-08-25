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

export interface DefaultSharedInventorySelection {
  ownerUid: string | null;
  selected: boolean;
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
    const preservedOwnerName = (value as CollaboratorAccessRecord & {
      ownerDisplayName?: unknown;
    }).ownerDisplayName;
    return [{
      ownerUid: value.ownerUid,
      ownerLabel: typeof preservedOwnerName === 'string' && preservedOwnerName.trim()
        ? preservedOwnerName.trim()
        : ownerLabel(value.ownerUid),
      access: value,
      session: decision.session,
    }];
  });
}

export function selectDefaultSharedInventoryOwner(
  sessions: readonly SharedInventorySession[],
  collaboratorUid: string,
  nowMs: number,
): string | null {
  for (const shared of sessions) {
    const decision = evaluateCollaboratorAccess(
      shared.access,
      shared.ownerUid,
      collaboratorUid,
      nowMs,
    );
    if (decision.allowed && decision.session.capabilities.has('inventory.read')) {
      return decision.session.ownerUid;
    }
  }

  return null;
}

export function advanceDefaultSharedInventorySelection(
  sessions: readonly SharedInventorySession[],
  collaboratorUid: string,
  nowMs: number,
  alreadySelected: boolean,
  initialOwnerUid: string | null | undefined,
): DefaultSharedInventorySelection {
  if (alreadySelected || initialOwnerUid) {
    return { ownerUid: null, selected: alreadySelected };
  }

  const ownerUid = selectDefaultSharedInventoryOwner(
    sessions,
    collaboratorUid,
    nowMs,
  );

  return { ownerUid, selected: ownerUid !== null };
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
