import { describe, expect, it } from 'vitest';
import {
  acceptCollaboratorInvitation,
  expireCollaboratorAccess,
  expirePendingInvitation,
  isCollaboratorInvitation,
  issueCollaboratorInvitation,
  revokeAcceptedAccessLifecycle,
  revokeCollaboratorAccess,
  revokeCollaboratorInvitation,
  type CollaboratorInvitation,
} from '../../src/collaboration/access-lifecycle';
import {
  COLLABORATOR_CAPABILITIES,
  evaluateCollaboratorAccess,
  type CollaboratorAccessRecord,
} from '../../src/collaboration/access-model';

const NOW = 1_800_000_000_000;

function pendingInvitation(
  overrides: Partial<CollaboratorInvitation> = {},
): CollaboratorInvitation {
  const result = issueCollaboratorInvitation({
    invitationId: 'invite-1',
    ownerUid: 'owner-1',
    createdByUid: 'owner-1',
    nowMs: NOW,
    expiresAtMs: NOW + 10_000,
  });

  if (!result.ok) throw new Error('Test invitation could not be issued');
  return { ...result.value, ...overrides };
}

function activeAccess(): CollaboratorAccessRecord {
  const result = acceptCollaboratorInvitation({
    invitation: pendingInvitation(),
    collaboratorUid: 'collaborator-1',
    accessId: 'access-1',
    nowMs: NOW + 1,
  });

  if (!result.ok) throw new Error('Test invitation could not be accepted');
  return result.value.access;
}

describe('collaborator access lifecycle', () => {
  it('allows only the owner to issue an invitation', () => {
    expect(
      issueCollaboratorInvitation({
        invitationId: 'invite-1',
        ownerUid: 'owner-1',
        createdByUid: 'someone-else',
        nowMs: NOW,
        expiresAtMs: NOW + 1_000,
      }),
    ).toEqual({ ok: false, reason: 'not-owner' });
  });

  it('issues a pending invitation with the approved capability set', () => {
    const result = issueCollaboratorInvitation({
      invitationId: 'invite-1',
      ownerUid: 'owner-1',
      createdByUid: 'owner-1',
      nowMs: NOW,
      expiresAtMs: NOW + 1_000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe('pending');
    expect(result.value.capabilities).toEqual(COLLABORATOR_CAPABILITIES);
    expect(isCollaboratorInvitation(result.value)).toBe(true);
  });

  it('rejects unknown capabilities and invalid expiration ranges', () => {
    expect(
      issueCollaboratorInvitation({
        invitationId: 'invite-1',
        ownerUid: 'owner-1',
        createdByUid: 'owner-1',
        nowMs: NOW,
        expiresAtMs: NOW,
      }),
    ).toEqual({ ok: false, reason: 'invalid-input' });

    expect(
      isCollaboratorInvitation({
        ...pendingInvitation(),
        capabilities: ['inventory.read', 'container.delete'],
      }),
    ).toBe(false);
  });

  it('accepts once and creates the authoritative access record', () => {
    const result = acceptCollaboratorInvitation({
      invitation: pendingInvitation(),
      collaboratorUid: 'collaborator-1',
      accessId: 'access-1',
      nowMs: NOW + 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.invitation.status).toBe('accepted');
    expect(result.value.invitation.accessId).toBe('access-1');
    expect(result.value.access.ownerUid).toBe('owner-1');
    expect(result.value.access.collaboratorUid).toBe('collaborator-1');
    expect(result.value.access.capabilities).toEqual(
      COLLABORATOR_CAPABILITIES,
    );
  });

  it('rejects acceptance before start, at expiration, and after acceptance', () => {
    expect(
      acceptCollaboratorInvitation({
        invitation: pendingInvitation({ validFromMs: NOW + 100 }),
        collaboratorUid: 'collaborator-1',
        accessId: 'access-1',
        nowMs: NOW + 1,
      }),
    ).toEqual({ ok: false, reason: 'not-started' });

    expect(
      acceptCollaboratorInvitation({
        invitation: pendingInvitation({ expiresAtMs: NOW + 1 }),
        collaboratorUid: 'collaborator-1',
        accessId: 'access-1',
        nowMs: NOW + 1,
      }),
    ).toEqual({ ok: false, reason: 'expired' });

    const accepted = acceptCollaboratorInvitation({
      invitation: pendingInvitation(),
      collaboratorUid: 'collaborator-1',
      accessId: 'access-1',
      nowMs: NOW + 1,
    });
    if (!accepted.ok) throw new Error('Test invitation was not accepted');

    expect(
      acceptCollaboratorInvitation({
        invitation: accepted.value.invitation,
        collaboratorUid: 'collaborator-1',
        accessId: 'access-2',
        nowMs: NOW + 2,
      }),
    ).toEqual({ ok: false, reason: 'not-pending' });
  });

  it('prevents the owner from accepting their own invitation', () => {
    expect(
      acceptCollaboratorInvitation({
        invitation: pendingInvitation(),
        collaboratorUid: 'owner-1',
        accessId: 'access-1',
        nowMs: NOW + 1,
      }),
    ).toEqual({ ok: false, reason: 'identity-mismatch' });
  });

  it('enforces expiration at the exact access deadline', () => {
    const access = activeAccess();
    const expired = expireCollaboratorAccess(access, access.expiresAtMs!);

    expect(expired.ok).toBe(true);
    if (!expired.ok) return;

    expect(expired.value.status).toBe('expired');
    expect(
      evaluateCollaboratorAccess(
        expired.value,
        'owner-1',
        'collaborator-1',
        access.expiresAtMs!,
      ),
    ).toEqual({ allowed: false, reason: 'not-active' });
  });

  it('expires an unaccepted invitation at its exact deadline', () => {
    const invitation = pendingInvitation();
    const result = expirePendingInvitation(
      invitation,
      invitation.expiresAtMs!,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('expired');
  });

  it('allows only the owner to revoke active access', () => {
    const access = activeAccess();

    expect(
      revokeCollaboratorAccess(access, 'someone-else', NOW + 2),
    ).toEqual({ ok: false, reason: 'not-owner' });

    const result = revokeCollaboratorAccess(access, 'owner-1', NOW + 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe('revoked');
    expect(result.value.revokedByUid).toBe('owner-1');
    expect(result.value.revokedAtMs).toBe(NOW + 2);
  });

  it('revokes pending or accepted invitations without deleting history', () => {
    const pending = revokeCollaboratorInvitation(
      pendingInvitation(),
      'owner-1',
      NOW + 1,
    );
    expect(pending.ok).toBe(true);
    if (pending.ok) {
      expect(pending.value.status).toBe('revoked');
      expect(pending.value.acceptedByUid).toBeNull();
    }

    const accepted = acceptCollaboratorInvitation({
      invitation: pendingInvitation(),
      collaboratorUid: 'collaborator-1',
      accessId: 'access-1',
      nowMs: NOW + 1,
    });
    if (!accepted.ok) throw new Error('Test invitation was not accepted');

    const revoked = revokeCollaboratorInvitation(
      accepted.value.invitation,
      'owner-1',
      NOW + 2,
    );
    expect(revoked.ok).toBe(true);
    if (revoked.ok) {
      expect(revoked.value.status).toBe('revoked');
      expect(revoked.value.acceptedByUid).toBe('collaborator-1');
      expect(revoked.value.accessId).toBe('access-1');
    }
  });

  it('produces one consistent atomic revocation transition', () => {
    const accepted = acceptCollaboratorInvitation({
      invitation: pendingInvitation(),
      collaboratorUid: 'collaborator-1',
      accessId: 'access-1',
      nowMs: NOW + 1,
    });
    if (!accepted.ok) throw new Error('Test invitation was not accepted');

    const result = revokeAcceptedAccessLifecycle(
      accepted.value.access,
      accepted.value.invitation,
      'owner-1',
      NOW + 2,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.access.status).toBe('revoked');
    expect(result.value.invitation.status).toBe('revoked');
    expect(result.value.access.revokedAtMs).toBe(NOW + 2);
    expect(result.value.invitation.revokedAtMs).toBe(NOW + 2);
  });

  it('rejects atomic revocation when invitation and access do not match', () => {
    const accepted = acceptCollaboratorInvitation({
      invitation: pendingInvitation(),
      collaboratorUid: 'collaborator-1',
      accessId: 'access-1',
      nowMs: NOW + 1,
    });
    if (!accepted.ok) throw new Error('Test invitation was not accepted');

    expect(
      revokeAcceptedAccessLifecycle(
        accepted.value.access,
        { ...accepted.value.invitation, accessId: 'different-access' },
        'owner-1',
        NOW + 2,
      ),
    ).toEqual({ ok: false, reason: 'identity-mismatch' });
  });

  it('re-invites with a new authorization that supersedes the old access', () => {
    const oldAccess = revokeCollaboratorAccess(
      activeAccess(),
      'owner-1',
      NOW + 2,
    );
    if (!oldAccess.ok) throw new Error('Test access was not revoked');

    const invitation = issueCollaboratorInvitation({
      invitationId: 'invite-2',
      ownerUid: 'owner-1',
      createdByUid: 'owner-1',
      nowMs: NOW + 3,
      expiresAtMs: NOW + 20_000,
      supersedesAccessId: oldAccess.value.accessId,
    });
    if (!invitation.ok) throw new Error('Re-invitation was not issued');

    const accepted = acceptCollaboratorInvitation({
      invitation: invitation.value,
      collaboratorUid: 'collaborator-1',
      accessId: 'access-2',
      nowMs: NOW + 4,
    });

    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;

    expect(accepted.value.access.accessId).toBe('access-2');
    expect(accepted.value.access.supersedesAccessId).toBe('access-1');
    expect(oldAccess.value.status).toBe('revoked');
  });

  it('does not mutate prior invitation or access records', () => {
    const invitation = pendingInvitation();
    const invitationSnapshot = structuredClone(invitation);
    acceptCollaboratorInvitation({
      invitation,
      collaboratorUid: 'collaborator-1',
      accessId: 'access-1',
      nowMs: NOW + 1,
    });
    expect(invitation).toEqual(invitationSnapshot);

    const access = activeAccess();
    const accessSnapshot = structuredClone(access);
    revokeCollaboratorAccess(access, 'owner-1', NOW + 2);
    expect(access).toEqual(accessSnapshot);
  });
});
