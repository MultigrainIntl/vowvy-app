import { describe, expect, it } from 'vitest';
import { isVisibleInventoryContainer } from '../../src/collaboration/inventory-presentation';

describe('inventory container visibility', () => {
  it('shows a newly created empty shared container to collaborators', () => {
    expect(isVisibleInventoryContainer(
      { effectiveIsPrivate: false, photos: [] },
      'owner-1',
      'collaborator-1',
    )).toBe(true);
  });

  it('shows an empty container to its owner', () => {
    expect(isVisibleInventoryContainer(
      { effectiveIsPrivate: false, photos: [] },
      'owner-1',
      'owner-1',
    )).toBe(true);
  });

  it('keeps private containers hidden from collaborators', () => {
    expect(isVisibleInventoryContainer(
      { effectiveIsPrivate: true, photos: [{ id: 'photo-1' }] },
      'owner-1',
      'collaborator-1',
    )).toBe(false);
  });

  it('shows a private empty container to its owner', () => {
    expect(isVisibleInventoryContainer(
      { effectiveIsPrivate: true, photos: [] },
      'owner-1',
      'owner-1',
    )).toBe(true);
  });

  it('keeps a shared container visible after its photos are deleted', () => {
    expect(isVisibleInventoryContainer(
      { effectiveIsPrivate: false, photos: [{ deletedAt: 123 }] },
      'owner-1',
      'collaborator-1',
    )).toBe(true);
  });
});
