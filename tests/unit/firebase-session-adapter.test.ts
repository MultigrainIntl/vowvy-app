import { describe, expect, it } from 'vitest';
import { COLLABORATOR_CAPABILITIES } from '../../src/collaboration/access-model';
import {
  advanceDefaultSharedInventorySelection,
  selectDefaultSharedInventoryOwner,
  selectSharedInventorySessions,
} from '../../src/collaboration/firebase-session-adapter';

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

  it('preserves owner identity and identifies existing-access sessions', () => {
    const sessions = selectSharedInventorySessions(
      [access({ ownerDisplayName: 'Joseph Librizzi', expiresAtMs: null })],
      'collaborator-1',
      5_000,
      'legacy',
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].ownerLabel).toBe('Joseph Librizzi');
    expect(sessions[0].source).toBe('legacy');
  });
});

describe('default shared inventory selection', () => {
  it('opens the first verified owner inventory for a returning collaborator', () => {
    const sessions = selectSharedInventorySessions(
      [
        access(),
        access({ accessId: 'access-2', ownerUid: 'second-owner', createdByUid: 'second-owner' }),
      ],
      'collaborator-1',
      500,
    );

    expect(
      selectDefaultSharedInventoryOwner(sessions, 'collaborator-1', 500),
    ).toBe('owner-123456');
  });

  it('does not select an owner when no verified inventory is available', () => {
    expect(
      selectDefaultSharedInventoryOwner([], 'collaborator-1', 500),
    ).toBeNull();
  });

  it('rejects a session belonging to another signed-in user', () => {
    const sessions = selectSharedInventorySessions(
      [access()],
      'collaborator-1',
      500,
    );

    expect(
      selectDefaultSharedInventoryOwner(sessions, 'someone-else', 500),
    ).toBeNull();
  });

  it('rejects access that expired after the session list was loaded', () => {
    const sessions = selectSharedInventorySessions(
      [access()],
      'collaborator-1',
      500,
    );

    expect(
      selectDefaultSharedInventoryOwner(sessions, 'collaborator-1', 1_000),
    ).toBeNull();
  });

  it('does not select access that lacks inventory-read permission', () => {
    const sessions = selectSharedInventorySessions(
      [access({ capabilities: ['location.create'] })],
      'collaborator-1',
      500,
    );

    expect(
      selectDefaultSharedInventoryOwner(sessions, 'collaborator-1', 500),
    ).toBeNull();
  });

  it('skips invalid access and selects the next verified owner', () => {
    const sessions = selectSharedInventorySessions(
      [
        access({ capabilities: ['location.create'] }),
        access({ accessId: 'access-2', ownerUid: 'second-owner', createdByUid: 'second-owner' }),
      ],
      'collaborator-1',
      500,
    );

    expect(
      selectDefaultSharedInventoryOwner(sessions, 'collaborator-1', 500),
    ).toBe('second-owner');
  });

  it('waits through an empty snapshot and selects a later verified owner', () => {
    const firstSelection = advanceDefaultSharedInventorySelection(
      [],
      'collaborator-1',
      500,
      false,
      null,
    );
    expect(firstSelection).toEqual({ ownerUid: null, selected: false });

    const sessions = selectSharedInventorySessions(
      [access()],
      'collaborator-1',
      500,
    );
    expect(advanceDefaultSharedInventorySelection(
      sessions,
      'collaborator-1',
      500,
      firstSelection.selected,
      null,
    )).toEqual({ ownerUid: 'owner-123456', selected: true });
  });

  it('does not override an explicit invitation owner', () => {
    const sessions = selectSharedInventorySessions(
      [access()],
      'collaborator-1',
      500,
    );

    expect(advanceDefaultSharedInventorySelection(
      sessions,
      'collaborator-1',
      500,
      false,
      'invited-owner',
    )).toEqual({ ownerUid: null, selected: false });
  });

  it('does not auto-select again after the first verified selection', () => {
    const sessions = selectSharedInventorySessions(
      [access()],
      'collaborator-1',
      500,
    );

    expect(advanceDefaultSharedInventorySelection(
      sessions,
      'collaborator-1',
      500,
      true,
      null,
    )).toEqual({ ownerUid: null, selected: true });
  });
});
