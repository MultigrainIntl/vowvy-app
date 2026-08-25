import { describe, expect, it } from 'vitest';
import {
  activeLegacySharedInvitations,
  normalizeImportedSharedRecord,
} from '../../src/staging-shared-inventory';

describe('existing shared inventory restoration', () => {
  const active = {
    ownerUid: 'owner-a',
    ownerDisplayName: 'Alice',
    acceptedByUid: 'collaborator-a',
    status: 'active',
  };

  it('restores only accepted active invitations belonging to the signed-in collaborator', () => {
    expect(activeLegacySharedInvitations([
      active,
      { ...active, ownerUid: 'revoked-owner', status: 'revoked' },
      { ...active, ownerUid: 'someone-else', acceptedByUid: 'different-person' },
      { ...active },
    ], 'collaborator-a', 100)).toEqual([{ ...active, expiresAt: undefined }]);
  });

  it('retains accepted active access after the invitation link itself expires', () => {
    expect(activeLegacySharedInvitations([
      { ...active, expiresAt: { toMillis: () => 100 } },
    ], 'collaborator-a', 101)).toEqual([{
      ...active,
      expiresAt: expect.objectContaining({ toMillis: expect.any(Function) }),
    }]);
  });

  it('restores all three distinct active owners despite expired legacy invitation links', () => {
    const expired = { toMillis: () => 100 };

    expect(activeLegacySharedInvitations([
      { ...active, ownerDisplayName: 'hmckelligott', expiresAt: { toMillis: () => 300 } },
      {
        ...active,
        ownerUid: 'test-owner',
        ownerDisplayName: 'george+vowvytest',
        expiresAt: expired,
      },
      {
        ...active,
        ownerUid: 'joseph-owner',
        ownerDisplayName: 'josephjlibriz',
        expiresAt: expired,
      },
      { ...active, ownerUid: 'pending-owner', status: 'pending', expiresAt: expired },
      { ...active, ownerUid: 'revoked-owner', status: 'revoked', expiresAt: expired },
    ], 'collaborator-a', 200).map(invitation => invitation.ownerDisplayName)).toEqual([
      'hmckelligott',
      'george+vowvytest',
      'josephjlibriz',
    ]);
  });

  it('rejects invalid clock values while preserving valid accepted invitations', () => {
    expect(activeLegacySharedInvitations([active], 'collaborator-a', Number.NaN)).toEqual([]);
  });

  it('deduplicates repeated invitations without dropping genuinely different shared owners', () => {
    expect(activeLegacySharedInvitations([
      active,
      { ...active },
      { ...active },
      { ...active },
      { ...active },
      {
        ...active,
        ownerUid: 'owner-b',
        ownerDisplayName: 'Bob',
      },
    ], 'collaborator-a', 100)).toEqual([
      { ...active, expiresAt: undefined },
      {
        ...active,
        ownerUid: 'owner-b',
        ownerDisplayName: 'Bob',
        expiresAt: undefined,
      },
    ]);
  });

  it('preserves the owner name and restores legacy shareable records', () => {
    expect(normalizeImportedSharedRecord({
      name: 'Garage',
      createdBy: 'owner-a',
      effectiveIsPrivate: false,
      visibility: 'inherit',
    }, 'owner-a', 'staging-owner')).toEqual({
      name: 'Garage',
      createdBy: 'staging-owner',
      effectiveIsPrivate: false,
      visibility: 'inherit',
      deletedAt: null,
    });
  });

  it('restores explicitly nonprivate legacy containers without modern sharing fields', () => {
    expect(normalizeImportedSharedRecord({
      name: 'Red Bike bag',
      isPrivate: false,
      photos: [{ id: 'existing-photo' }],
    }, 'owner-a', 'staging-owner')).toEqual({
      name: 'Red Bike bag',
      isPrivate: false,
      photos: [{ id: 'existing-photo' }],
      createdBy: 'staging-owner',
      notes: [],
      effectiveIsPrivate: false,
      visibility: 'inherit',
      deletedAt: null,
    });
  });

  it('never copies private or deleted shared records', () => {
    expect(normalizeImportedSharedRecord({ effectiveIsPrivate: true }, 'a', 'b')).toBeNull();
    expect(normalizeImportedSharedRecord({ isPrivate: true }, 'a', 'b')).toBeNull();
    expect(normalizeImportedSharedRecord({ visibility: 'private' }, 'a', 'b')).toBeNull();
    expect(normalizeImportedSharedRecord({ deletedAt: 123 }, 'a', 'b')).toBeNull();
  });
});
