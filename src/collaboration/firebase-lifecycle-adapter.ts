import {
  doc,
  getDoc,
  runTransaction,
  setDoc,
  Timestamp,
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
    identity?: { displayName?: string; email?: string },
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

    async acceptInvitation(invitationId, collaboratorUid, identity = {}) {
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

        const invitationData = invitationSnapshot.data();
        if (!isCollaboratorInvitation(invitationData)) {
          const legacy = normalizeLegacyInvitation(invitationData, invitationId);
          if (!legacy) throw lifecycleError('invalid-invitation');
          if (legacy.ownerUid === collaboratorUid) throw lifecycleError('identity-mismatch');
          if (legacy.expiresAtMs !== null && clock.nowMs() >= legacy.expiresAtMs) {
            throw lifecycleError('expired');
          }
          const previousRef = doc(
            firestore,
            `users/${legacy.ownerUid}/collaborators/${collaboratorUid}`,
          );
          const previousSnapshot = await transaction.get(previousRef);
          if (previousSnapshot.exists() && previousSnapshot.data().status === 'active') {
            throw lifecycleError('active-access-exists');
          }
          const acceptedAt = Timestamp.fromMillis(clock.nowMs());
          transaction.set(previousRef, {
            displayName: identity.displayName?.trim() ||
              identity.email?.trim() || `Collaborator ${collaboratorUid.slice(0, 6)}`,
            email: identity.email?.trim() || '',
            status: 'active',
            inviteToken: invitationId,
            acceptedAt,
          });
          transaction.update(invitationRef, {
            status: 'active',
            acceptedByUid: collaboratorUid,
            acceptedByEmail: identity.email?.trim() || '',
            acceptedAt,
          });
          return { ownerUid: legacy.ownerUid, accessId: `legacy:${legacy.ownerUid}:${collaboratorUid}` };
        }

        const accepted = acceptCollaboratorInvitation({
          invitation: invitationData,
          collaboratorUid,
          accessId,
          nowMs: clock.nowMs(),
          collaboratorDisplayName: identity.displayName,
          collaboratorEmail: identity.email,
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
          const previousRef = doc(
            firestore,
            `users/${ownerUid}/collaborators/${collaboratorUid}`,
          );
          const previousSnapshot = await transaction.get(previousRef);
          const previous = previousSnapshot.data();
          if (!previousSnapshot.exists() || previous?.status !== 'active' ||
            typeof previous.inviteToken !== 'string') {
            throw lifecycleError('access-not-found');
          }
          const previousInvitationRef = doc(
            firestore,
            invitationPath(previous.inviteToken),
          );
          const previousInvitation = await transaction.get(previousInvitationRef);
          if (!previousInvitation.exists() || previousInvitation.data().status !== 'active') {
            throw lifecycleError('invitation-not-found');
          }
          transaction.update(previousRef, { status: 'revoked' });
          transaction.update(previousInvitationRef, {
            status: 'revoked',
            revokedAtMs: clock.nowMs(),
            revokedByUid: ownerUid,
          });
          return;
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
  return isCollaboratorInvitation(invitation)
    ? invitation
    : normalizeLegacyInvitation(invitation, invitationId);
}

export function normalizeLegacyInvitation(
  value: unknown,
  invitationId: string,
): CollaboratorInvitation | null {
  if (!value || typeof value !== 'object' || !invitationId.trim()) return null;
  const invitation = value as Record<string, unknown>;
  if (invitation.status !== 'pending' ||
    typeof invitation.ownerUid !== 'string' || !invitation.ownerUid.trim()) {
    return null;
  }
  const expiry = invitation.expiresAt;
  let expiresAtMs: number | null = null;
  if (expiry !== undefined && expiry !== null) {
    if (expiry instanceof Date) expiresAtMs = expiry.getTime();
    else if (typeof expiry === 'object' && 'toMillis' in expiry &&
      typeof (expiry as { toMillis?: unknown }).toMillis === 'function') {
      expiresAtMs = (expiry as { toMillis: () => number }).toMillis();
    } else return null;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) return null;
  }
  const created = invitation.createdAt;
  const createdAtMs = created && typeof created === 'object' && 'toMillis' in created &&
    typeof (created as { toMillis?: unknown }).toMillis === 'function'
    ? (created as { toMillis: () => number }).toMillis()
    : 0;
  const issued = issueCollaboratorInvitation({
    invitationId,
    ownerUid: invitation.ownerUid,
    createdByUid: invitation.ownerUid,
    nowMs: createdAtMs,
    expiresAtMs,
    ...(typeof invitation.ownerDisplayName === 'string'
      ? { ownerDisplayName: invitation.ownerDisplayName }
      : {}),
  });
  return issued.ok ? issued.value : null;
}
