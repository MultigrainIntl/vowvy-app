import { describe, expect, it } from 'vitest';
import { remapInventoryOwner } from '../../src/staging-inventory-copy';

describe('staging existing-account inventory import', () => {
  it('remaps only the authenticated inventory owner', () => {
    expect(remapInventoryOwner({
      createdBy: 'owner',
      locationId: 'location-1',
      notes: [{ addedBy: 'owner' }, { addedBy: 'collaborator' }],
    }, 'owner', 'staging-owner')).toEqual({
      createdBy: 'staging-owner',
      locationId: 'location-1',
      notes: [{ addedBy: 'staging-owner' }, { addedBy: 'collaborator' }],
    });
  });
  it('preserves Firestore timestamp-like objects', () => {
    class TimestampLike { constructor(readonly seconds: number) {} }
    const timestamp = new TimestampLike(123);
    expect((remapInventoryOwner({ createdAt: timestamp }, 'a', 'b') as {
      createdAt: TimestampLike;
    }).createdAt).toBe(timestamp);
  });
  it('preserves existing photo URLs', () => {
    const url = 'https://storage.example/photo?token=existing';
    expect(remapInventoryOwner({ photos: [{ url }] }, 'a', 'b')).toEqual({ photos: [{ url }] });
  });
});
