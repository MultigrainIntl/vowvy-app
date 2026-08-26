import { describe, expect, it } from 'vitest';
import { evaluateCollaboratorAccess } from '../../src/collaboration/access-model';
import {
  legacyAccessFromRecords,
  legacyCollaboratorIdentity,
} from '../../src/collaboration/legacy-access';

const invitation = {
  ownerUid: 'owner-1',
  ownerDisplayName: 'Joseph Librizzi',
  acceptedByUid: 'collaborator-1',
  status: 'active',
  expiresAt: { toMillis: () => 100 },
};
const collaborator = {
  status: 'active',
  inviteToken: 'invite-1',
  displayName: 'George',
  email: 'george@example.test',
  acceptedAt: { toMillis: () => 50 },
};

describe('existing production collaborator compatibility', () => {
  it('preserves an accepted collaborator after its invitation link has expired', () => {
    const result = legacyAccessFromRecords(
      invitation,
      collaborator,
      'collaborator-1',
      'invite-1',
    );
    expect(result).toMatchObject({
      ownerUid: 'owner-1',
      collaboratorUid: 'collaborator-1',
      expiresAtMs: null,
      ownerDisplayName: 'Joseph Librizzi',
      collaboratorDisplayName: 'George',
      collaboratorEmail: 'george@example.test',
    });
    expect(evaluateCollaboratorAccess(
      result,
      'owner-1',
      'collaborator-1',
      1_000,
    ).allowed).toBe(true);
  });

  it('rejects revoked records, unrelated users, and mismatched invitations', () => {
    expect(legacyAccessFromRecords(
      invitation,
      { ...collaborator, status: 'revoked' },
      'collaborator-1',
      'invite-1',
    )).toBeNull();
    expect(legacyAccessFromRecords(
      invitation,
      collaborator,
      'someone-else',
      'invite-1',
    )).toBeNull();
    expect(legacyAccessFromRecords(
      invitation,
      collaborator,
      'collaborator-1',
      'different-invite',
    )).toBeNull();
  });

  it('keeps the original collaborator name and email', () => {
    expect(legacyCollaboratorIdentity(collaborator, 'collaborator-1')).toMatchObject({
      displayName: 'George',
      email: 'george@example.test',
      invitationId: 'invite-1',
    });
  });
});
