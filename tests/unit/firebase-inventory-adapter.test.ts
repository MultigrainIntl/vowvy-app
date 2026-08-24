import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';

const firestoreMocks = vi.hoisted(() => ({
  collection: vi.fn((_db: unknown, path: string) => ({ path })),
  addDoc: vi.fn(async () => ({ id: 'created-record' })),
  serverTimestamp: vi.fn(() => 'server-timestamp'),
}));

vi.mock('firebase/firestore', () => ({
  addDoc: firestoreMocks.addDoc,
  arrayUnion: vi.fn(),
  collection: firestoreMocks.collection,
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: firestoreMocks.serverTimestamp,
  updateDoc: vi.fn(),
  where: vi.fn(),
}));

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));

import { createFirebaseInventoryAdapter } from
  '../../src/collaboration/firebase-inventory-adapter';

describe('collaborator-created inventory compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a space that both owner snapshots and collaborator queries can see', async () => {
    const adapter = createFirebaseInventoryAdapter({} as Firestore);

    expect(await adapter.createLocation('owner-1', {
      name: 'Garage',
      parentId: null,
      visibility: 'shared',
      effectiveIsPrivate: false,
      createdBy: 'collaborator-1',
    })).toBe('created-record');

    expect(firestoreMocks.addDoc).toHaveBeenCalledWith(
      { path: 'users/owner-1/locations' },
      {
        name: 'Garage',
        parentId: null,
        visibility: 'shared',
        effectiveIsPrivate: false,
        createdBy: 'collaborator-1',
        createdAt: 'server-timestamp',
        deletedAt: null,
      },
    );
  });

  it('creates a container that both owner snapshots and collaborator queries can see', async () => {
    const adapter = createFirebaseInventoryAdapter({} as Firestore);

    expect(await adapter.createContainer('owner-1', {
      name: 'Toolbox',
      locationId: 'garage',
      location: 'Garage',
      visibility: 'inherit',
      effectiveIsPrivate: false,
      createdBy: 'collaborator-1',
      notes: [],
      photos: [],
    })).toBe('created-record');

    expect(firestoreMocks.addDoc).toHaveBeenCalledWith(
      { path: 'users/owner-1/containers' },
      {
        name: 'Toolbox',
        locationId: 'garage',
        location: 'Garage',
        visibility: 'inherit',
        effectiveIsPrivate: false,
        createdBy: 'collaborator-1',
        notes: [],
        photos: [],
        createdAt: 'server-timestamp',
        deletedAt: null,
      },
    );
  });
});
