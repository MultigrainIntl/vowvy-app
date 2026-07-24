import { describe, expect, it } from 'vitest';
import { COLLABORATOR_CAPABILITIES } from '../../src/collaboration/access-model';
import { selectSharedInventorySessions } from '../../src/collaboration/firebase-session-adapter';

function access(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    accessId: 'access-1',
    invitationId: 'invite-1',
    ownerUid: 'owner-123456',
    collaboratorUid: 'collaborator-1',
    status: 'active',
    capabilities: [...COLLABORATOR_CAPABILITIES],
    validFromMs: 100,
    expiresAtMs: 1_000,
    createdAtMs: 100,
    createdByUid: 'owner-123456',
    revokedAtMs: null,
    revokedByUid: null,
    supersedesAccessId: null,
    ...overrides,
  };
}

describe('shared inventory session selection', () => {
  it('returns only verified active access for the signed-in collaborator', () => {
    const sessions = selectSharedInventorySessions(
      [
        access(),
        access({ accessId: 'wrong-user', collaboratorUid: 'someone-else' }),
        access({ accessId: 'revoked', status: 'revoked', revokedAtMs: 200, revokedByUid: 'owner-123456' }),
        { ownerUid: 'malformed' },
      ],
      'collaborator-1',
      500,
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0].ownerUid).toBe('owner-123456');
    expect(sessions[0].ownerLabel).toBe('Shared inventory owner-');
  });

  it('removes access at the exact expiration time', () => {
    expect(
      selectSharedInventorySessions([access()], 'collaborator-1', 1_000),
    ).toEqual([]);
  });
});
