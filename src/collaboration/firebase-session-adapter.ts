import {
  collection,
  collectionGroup,
  doc,
  getDoc,
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
import { legacyAccessFromRecords, legacyCollaboratorIdentity } from './legacy-access';

export interface SharedInventorySession {
  ownerUid: string;
  ownerLabel: string;
  access: CollaboratorAccessRecord;
  session: CollaboratorSession;
  source: 'canonical' | 'legacy';
}

export interface OwnedCollaboratorAccess {
  collaboratorUid: string;
  access: CollaboratorAccessRecord;
  displayName: string;
  email: string;
  source: 'canonical' | 'legacy';
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
  source: 'canonical' | 'legacy' = 'canonical',
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
      source,
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

  let canonical: SharedInventorySession[] = [];
  let legacy: SharedInventorySession[] = [];
  let canonicalOwners = new Set<string>();
  let canonicalReady = false;
  let legacyReady = false;
  let closed = false;
  let legacyGeneration = 0;

  const publish = () => {
    if (!closed && (canonicalReady || legacyReady)) {
      onChange([
        ...canonical,
        ...legacy.filter(session => !canonicalOwners.has(session.ownerUid)),
      ]);
    }
  };

  const unsubscribeCanonical = onSnapshot(
    accessQuery,
    snapshot => {
      const values = snapshot.docs.map(item => item.data());
      canonicalOwners = new Set(values.flatMap(value =>
        typeof value.ownerUid === 'string' ? [value.ownerUid] : [],
      ));
      canonical = selectSharedInventorySessions(
        values,
        collaboratorUid,
        Date.now(),
      );
      canonicalReady = true;
      publish();
    },
    error => {
      canonicalReady = false;
      if (!legacyReady) onError(error);
    },
  );

  const invitationsQuery = query(
    collection(firestore, 'invites'),
    where('acceptedByUid', '==', collaboratorUid),
  );
  const unsubscribeLegacy = onSnapshot(
    invitationsQuery,
    async snapshot => {
      const generation = ++legacyGeneration;
      try {
        const records = await Promise.all(snapshot.docs.map(async item => {
          const invitation = item.data();
          if (invitation.status !== 'active' || typeof invitation.ownerUid !== 'string') {
            return null;
          }
          const previous = await getDoc(doc(
            firestore,
            `users/${invitation.ownerUid}/collaborators/${collaboratorUid}`,
          ));
          return previous.exists()
            ? legacyAccessFromRecords(invitation, previous.data(), collaboratorUid, item.id)
            : null;
        }));
        if (closed || generation !== legacyGeneration) return;
        legacy = selectSharedInventorySessions(
          records.filter(record => record !== null),
          collaboratorUid,
          Date.now(),
          'legacy',
        );
        legacyReady = true;
        publish();
      } catch (error) {
        if (!canonicalReady) {
          onError(error instanceof Error ? error : new Error('Legacy access unavailable.'));
        }
      }
    },
    error => {
      legacyReady = false;
      if (!canonicalReady) onError(error);
    },
  );

  return () => {
    closed = true;
    unsubscribeCanonical();
    unsubscribeLegacy();
  };
}

export function observeOwnedCollaboratorAccess(
  firestore: Firestore,
  ownerUid: string,
  onChange: (access: OwnedCollaboratorAccess[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  let canonical: OwnedCollaboratorAccess[] = [];
  let legacy: OwnedCollaboratorAccess[] = [];
  let closed = false;
  const publish = () => {
    if (closed) return;
    const canonicalIds = new Set(canonical.map(record => record.collaboratorUid));
    onChange([
      ...canonical,
      ...legacy.filter(record => !canonicalIds.has(record.collaboratorUid)),
    ]);
  };

  const unsubscribeCanonical = onSnapshot(
    collection(firestore, `users/${ownerUid}/collaboratorAccess`),
    snapshot => {
      canonical = snapshot.docs.flatMap(item => {
        const access = item.data();
        return isCollaboratorAccessRecord(access)
          ? [{
            collaboratorUid: item.id,
            access,
            displayName: access.collaboratorDisplayName ||
              access.collaboratorEmail || `Collaborator ${item.id.slice(0, 6)}`,
            email: access.collaboratorEmail || '',
            source: 'canonical' as const,
          }]
          : [];
      });
      publish();
    },
    error => onError(error),
  );

  const unsubscribeLegacy = onSnapshot(
    collection(firestore, `users/${ownerUid}/collaborators`),
    snapshot => {
      legacy = snapshot.docs.flatMap(item => {
        const identity = legacyCollaboratorIdentity(item.data(), item.id);
        if (!identity) return [];
        const access: CollaboratorAccessRecord = {
          schemaVersion: 1,
          accessId: `legacy:${ownerUid}:${item.id}`,
          invitationId: identity.invitationId,
          ownerUid,
          collaboratorUid: item.id,
          status: 'active',
          capabilities: ['inventory.read', 'location.create', 'container.create',
            'photo.create', 'note.create', 'note.edit', 'item.move'],
          validFromMs: identity.acceptedAtMs,
          expiresAtMs: null,
          createdAtMs: identity.acceptedAtMs,
          createdByUid: ownerUid,
          revokedAtMs: null,
          revokedByUid: null,
          supersedesAccessId: null,
          collaboratorDisplayName: identity.displayName,
          ...(identity.email ? { collaboratorEmail: identity.email } : {}),
        };
        return [{
          collaboratorUid: item.id,
          access,
          displayName: identity.displayName,
          email: identity.email,
          source: 'legacy' as const,
        }];
      });
      publish();
    },
    error => onError(error),
  );

  return () => {
    closed = true;
    unsubscribeCanonical();
    unsubscribeLegacy();
  };
}
