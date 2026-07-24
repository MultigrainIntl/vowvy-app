import {
  doc,
  getDoc,
  runTransaction,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import {
  acceptCollaboratorInvitation,
  isCollaboratorInvitation,
  issueCollaboratorInvitation,
  revokeAcceptedAccessLifecycle,
  revokeCollaboratorInvitation,
  type CollaboratorInvitation,
  type IssueInvitationInput,
} from './access-lifecycle';
import { isCollaboratorAccessRecord } from './access-model';

export interface LifecycleClock {
  nowMs(): number;
  newAccessId(): string;
}

export interface FirebaseLifecycleAdapter {
  issueInvitation(input: IssueInvitationInput): Promise<CollaboratorInvitation>;
  acceptInvitation(
    invitationId: string,
    collaboratorUid: string,
  ): Promise<{ ownerUid: string; accessId: string }>;
  revokeInvitation(invitationId: string, ownerUid: string): Promise<void>;
  revokeAccess(
    ownerUid: string,
    collaboratorUid: string,
  ): Promise<void>;
}

function invitationPath(invitationId: string) {
  return `invites/${invitationId}`;
}

function currentAccessPath(ownerUid: string, collaboratorUid: string) {
  return `users/${ownerUid}/collaboratorAccess/${collaboratorUid}`;
}

function accessHistoryPath(ownerUid: string, accessId: string) {
  return `users/${ownerUid}/collaboratorAccessHistory/${accessId}`;
}

function lifecycleError(reason: string): Error {
  return new Error(`collaboration-lifecycle:${reason}`);
}

export function createFirebaseLifecycleAdapter(
  firestore: Firestore,
  clock: LifecycleClock,
): FirebaseLifecycleAdapter {
  return {
    async issueInvitation(input) {
      const result = issueCollaboratorInvitation(input);
      if (!result.ok) throw lifecycleError(result.reason);
      await setDoc(
        doc(firestore, invitationPath(result.value.invitationId)),
        result.value,
      );
      return result.value;
    },

    async acceptInvitation(invitationId, collaboratorUid) {
      if (!invitationId.trim() || !collaboratorUid.trim()) {
        throw lifecycleError('invalid-input');
      }

      const invitationRef = doc(
        firestore,
        invitationPath(invitationId),
      );
      const accessId = clock.newAccessId();

      return runTransaction(firestore, async transaction => {
        const invitationSnapshot = await transaction.get(invitationRef);
        if (!invitationSnapshot.exists()) {
          throw lifecycleError('invitation-not-found');
        }

        const accepted = acceptCollaboratorInvitation({
          invitation: invitationSnapshot.data(),
          collaboratorUid,
          accessId,
          nowMs: clock.nowMs(),
        });
        if (!accepted.ok) throw lifecycleError(accepted.reason);

        const currentRef = doc(
          firestore,
          currentAccessPath(accepted.value.access.ownerUid, collaboratorUid),
        );
        const currentSnapshot = await transaction.get(currentRef);

        if (currentSnapshot.exists()) {
          const current = currentSnapshot.data();
          if (
            !isCollaboratorAccessRecord(current) ||
            (current.status !== 'revoked' && current.status !== 'expired') ||
            accepted.value.access.supersedesAccessId !== current.accessId
          ) {
            throw lifecycleError('active-access-exists');
          }
          transaction.set(
            doc(
              firestore,
              accessHistoryPath(current.ownerUid, current.accessId),
            ),
            current,
          );
        } else if (accepted.value.access.supersedesAccessId !== null) {
          throw lifecycleError('superseded-access-not-found');
        }

        transaction.set(invitationRef, accepted.value.invitation);
        transaction.set(currentRef, accepted.value.access);

        return {
          ownerUid: accepted.value.access.ownerUid,
          accessId: accepted.value.access.accessId,
        };
      });
    },

    async revokeInvitation(invitationId, ownerUid) {
      const invitationRef = doc(
        firestore,
        invitationPath(invitationId),
      );
      await runTransaction(firestore, async transaction => {
        const snapshot = await transaction.get(invitationRef);
        if (!snapshot.exists()) {
          throw lifecycleError('invitation-not-found');
        }
        const revoked = revokeCollaboratorInvitation(
          snapshot.data(),
          ownerUid,
          clock.nowMs(),
        );
        if (!revoked.ok) throw lifecycleError(revoked.reason);
        transaction.set(invitationRef, revoked.value);
      });
    },

    async revokeAccess(ownerUid, collaboratorUid) {
      const currentRef = doc(
        firestore,
        currentAccessPath(ownerUid, collaboratorUid),
      );
      await runTransaction(firestore, async transaction => {
        const currentSnapshot = await transaction.get(currentRef);
        if (!currentSnapshot.exists()) {
          throw lifecycleError('access-not-found');
        }
        const current = currentSnapshot.data();
        if (!isCollaboratorAccessRecord(current)) {
          throw lifecycleError('invalid-access');
        }

        const invitationRef = doc(
          firestore,
          invitationPath(current.invitationId),
        );
        const invitationSnapshot = await transaction.get(invitationRef);
        if (
          !invitationSnapshot.exists() ||
          !isCollaboratorInvitation(invitationSnapshot.data())
        ) {
          throw lifecycleError('invitation-not-found');
        }

        const revoked = revokeAcceptedAccessLifecycle(
          current,
          invitationSnapshot.data(),
          ownerUid,
          clock.nowMs(),
        );
        if (!revoked.ok) throw lifecycleError(revoked.reason);

        transaction.set(currentRef, revoked.value.access);
        transaction.set(invitationRef, revoked.value.invitation);
      });
    },
  };
}

export async function readInvitation(
  firestore: Firestore,
  invitationId: string,
): Promise<CollaboratorInvitation | null> {
  const snapshot = await getDoc(
    doc(firestore, invitationPath(invitationId)),
  );
  if (!snapshot.exists()) {
    return null;
  }
  const invitation = snapshot.data();
  return isCollaboratorInvitation(invitation) ? invitation : null;
}
