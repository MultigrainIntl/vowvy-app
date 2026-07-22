import { describe, expect, it } from 'vitest';
import { buildEmptyContainerData, getInventoryAccessContext } from '../../src/collaboration';

describe('inventory collaboration context', () => {
  it('keeps an owner in their own data context', () => {
    expect(getInventoryAccessContext('owner-1', 'owner-1')).toEqual({
      ownerUid: 'owner-1',
      isSharedView: false,
      canCreateContainer: true,
      canCreateLocation: true,
    });
  });

  it('uses only the shared owner context for a collaborator', () => {
    expect(getInventoryAccessContext('helper-1', 'owner-1')).toEqual({
      ownerUid: 'owner-1',
      isSharedView: true,
      canCreateContainer: true,
      canCreateLocation: false,
    });
  });

  it('creates containers with an explicit sharing state on every UI path', () => {
    expect(buildEmptyContainerData(' Test Box ', 'kitchen', 'Home › Kitchen', false, 'now')).toEqual({
      name: 'Test Box',
      locationId: 'kitchen',
      location: 'Home › Kitchen',
      photos: [],
      photoUrls: [],
      photoStoragePaths: [],
      createdAt: 'now',
      deletedAt: null,
      isPrivate: false,
      visibility: 'inherit',
      effectiveIsPrivate: false,
    });
  });
});
