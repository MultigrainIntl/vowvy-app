import { describe, expect, it, vi } from 'vitest';
import {
  createCollaboratorInventoryService,
  type CollaboratorContainer,
  type CollaboratorLocation,
  type InventoryServiceAdapter,
} from '../../src/collaboration/inventory-service';
import type { CollaboratorSession } from '../../src/collaboration/access-model';

const session: CollaboratorSession = {
  accessId: 'access-1',
  ownerUid: 'owner-1',
  collaboratorUid: 'collaborator-1',
  capabilities: new Set([
    'inventory.read',
    'location.create',
    'container.create',
    'photo.create',
    'note.create',
    'note.edit',
    'item.move',
  ]),
  expiresAtMs: null,
};

const sharedLocation: CollaboratorLocation = {
  id: 'location-1',
  name: 'Kitchen',
  parentId: null,
  visibility: 'shared',
  effectiveIsPrivate: false,
};

const sharedContainer: CollaboratorContainer = {
  id: 'container-1',
  name: 'Kitchen Box',
  locationId: 'location-1',
  location: 'Kitchen',
  visibility: 'inherit',
  effectiveIsPrivate: false,
  photos: [],
  notes: [
    {
      id: 'note-1',
      text: 'Old note',
      createdAt: 100,
      addedBy: 'owner-1',
    },
  ],
};

function makeAdapter(
  overrides: Partial<InventoryServiceAdapter> = {},
): InventoryServiceAdapter {
  return {
    listLocations: vi.fn().mockResolvedValue([sharedLocation]),
    listContainers: vi.fn().mockResolvedValue([sharedContainer]),
    getLocation: vi.fn().mockResolvedValue(sharedLocation),
    getContainer: vi.fn().mockResolvedValue(sharedContainer),
    createLocation: vi.fn().mockResolvedValue('new-location'),
    createContainer: vi.fn().mockResolvedValue('new-container'),
    appendPhoto: vi.fn().mockResolvedValue(undefined),
    appendNote: vi.fn().mockResolvedValue(undefined),
    replaceNote: vi.fn().mockResolvedValue(undefined),
    moveContainer: vi.fn().mockResolvedValue(undefined),
    movePhoto: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('owner-aware collaborator inventory service', () => {
  it('reads only canonical shared records under the authorized owner', async () => {
    const adapter = makeAdapter({
      listLocations: vi.fn().mockResolvedValue([
        sharedLocation,
        { ...sharedLocation, id: 'private-location', effectiveIsPrivate: true },
      ]),
      listContainers: vi.fn().mockResolvedValue([
        sharedContainer,
        { ...sharedContainer, id: 'private-container', effectiveIsPrivate: true },
        { ...sharedContainer, id: 'orphan', locationId: 'not-shared' },
      ]),
    });
    const service = createCollaboratorInventoryService(session, adapter);

    const result = await service.readInventory();

    expect(result.ok && result.value.locations.map(item => item.id)).toEqual([
      'location-1',
    ]);
    expect(result.ok && result.value.containers.map(item => item.id)).toEqual([
      'container-1',
    ]);
    expect(adapter.listLocations).toHaveBeenCalledWith('owner-1');
    expect(adapter.listContainers).toHaveBeenCalledWith('owner-1');
  });

  it('creates shared owner locations attributed to the collaborator', async () => {
    const adapter = makeAdapter();
    const service = createCollaboratorInventoryService(session, adapter);

    expect(await service.createLocation(' Pantry ', null)).toEqual({
      ok: true,
      value: 'new-location',
    });
    expect(adapter.createLocation).toHaveBeenCalledWith('owner-1', {
      name: 'Pantry',
      parentId: null,
      visibility: 'shared',
      effectiveIsPrivate: false,
      createdBy: 'collaborator-1',
    });
  });

  it('refuses to create beneath a private location', async () => {
    const adapter = makeAdapter({
      getLocation: vi
        .fn()
        .mockResolvedValue({ ...sharedLocation, effectiveIsPrivate: true }),
    });
    const service = createCollaboratorInventoryService(session, adapter);

    expect(await service.createLocation('Shelf', 'location-1')).toEqual({
      ok: false,
      reason: 'private-record',
    });
    expect(adapter.createLocation).not.toHaveBeenCalled();
  });

  it('creates an empty container before any photo is appended', async () => {
    const adapter = makeAdapter();
    const service = createCollaboratorInventoryService(session, adapter);

    expect(
      await service.createContainer(' Box ', 'location-1', 'Kitchen'),
    ).toEqual({ ok: true, value: 'new-container' });
    expect(adapter.createContainer).toHaveBeenCalledWith(
      'owner-1',
      expect.objectContaining({
        name: 'Box',
        createdBy: 'collaborator-1',
        photos: [],
        notes: [],
      }),
    );
  });

  it('adds photos only after verifying the shared parent container', async () => {
    const adapter = makeAdapter();
    const service = createCollaboratorInventoryService(session, adapter);
    const photo = {
      id: 'photo-1',
      url: 'https://example.test/photo',
      storagePath: 'users/owner-1/containers/container-1/photo.jpg',
      description: '',
      createdAt: 200,
    };

    expect(await service.addPhoto('container-1', photo)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(adapter.appendPhoto).toHaveBeenCalledWith('owner-1', 'container-1', {
      ...photo,
      addedBy: 'collaborator-1',
    });
  });

  it('adds and edits notes without granting deletion', async () => {
    const adapter = makeAdapter();
    const service = createCollaboratorInventoryService(session, adapter);

    await service.addNote('container-1', {
      id: 'note-2',
      text: ' New note ',
      createdAt: 200,
    });
    await service.editNote('container-1', 'note-1', ' Updated ');

    expect(adapter.appendNote).toHaveBeenCalledWith(
      'owner-1',
      'container-1',
      expect.objectContaining({
        text: 'New note',
        addedBy: 'collaborator-1',
      }),
    );
    expect(adapter.replaceNote).toHaveBeenCalledWith(
      'owner-1',
      'container-1',
      expect.objectContaining({ id: 'note-1', text: 'Updated' }),
    );
    expect('deleteNote' in service).toBe(false);
  });

  it('moves only between verified shared owner locations', async () => {
    const adapter = makeAdapter();
    const service = createCollaboratorInventoryService(session, adapter);

    expect(
      await service.moveContainer('container-1', 'location-2', 'Garage'),
    ).toEqual({ ok: true, value: undefined });
    expect(adapter.moveContainer).toHaveBeenCalledWith(
      'owner-1',
      'container-1',
      'location-2',
      'Garage',
    );
  });

  it('moves one existing photo atomically between verified shared containers', async () => {
    const photo = {
      id: 'photo-1',
      url: 'https://example.test/photo',
      storagePath: 'users/owner-1/containers/container-1/photo.jpg',
      description: '',
      createdAt: 200,
      addedBy: 'owner-1',
    };
    const adapter = makeAdapter({
      getContainer: vi.fn(async (_ownerUid, containerId) =>
        containerId === 'container-1'
          ? { ...sharedContainer, photos: [photo] }
          : { ...sharedContainer, id: containerId, photos: [] }),
    });
    const service = createCollaboratorInventoryService(session, adapter);

    expect(
      await service.movePhoto('container-1', 'container-2', 'photo-1'),
    ).toEqual({ ok: true, value: undefined });
    expect(adapter.movePhoto).toHaveBeenCalledWith(
      'owner-1',
      'container-1',
      'container-2',
      'photo-1',
      'collaborator-1',
    );
  });

  it('refuses photo moves into private or identical containers', async () => {
    const adapter = makeAdapter({
      getContainer: vi.fn(async (_ownerUid, containerId) => ({
        ...sharedContainer,
        id: containerId,
        photos: containerId === 'container-1'
          ? [{
              id: 'photo-1',
              url: 'https://example.test/photo',
              storagePath: 'photo.jpg',
              description: '',
              createdAt: 1,
              addedBy: 'owner-1',
            }]
          : [],
        effectiveIsPrivate: containerId === 'private-container',
      })),
    });
    const service = createCollaboratorInventoryService(session, adapter);

    expect(
      await service.movePhoto('container-1', 'container-1', 'photo-1'),
    ).toEqual({ ok: false, reason: 'invalid-input' });
    expect(
      await service.movePhoto('container-1', 'private-container', 'photo-1'),
    ).toEqual({ ok: false, reason: 'private-record' });
    expect(adapter.movePhoto).not.toHaveBeenCalled();
  });

  it('never accepts a caller-supplied owner uid', () => {
    const service = createCollaboratorInventoryService(session, makeAdapter());

    expect(Object.keys(service)).toEqual([
      'readInventory',
      'createLocation',
      'createContainer',
      'addPhoto',
      'addNote',
      'editNote',
      'moveContainer',
      'movePhoto',
    ]);
  });

  it('fails closed when a required capability is absent', async () => {
    const adapter = makeAdapter();
    const restricted = {
      ...session,
      capabilities: new Set(['inventory.read'] as const),
    };
    const service = createCollaboratorInventoryService(restricted, adapter);

    expect(await service.createLocation('Pantry', null)).toEqual({
      ok: false,
      reason: 'forbidden',
    });
    expect(adapter.createLocation).not.toHaveBeenCalled();
  });

  it('rejects deleted containers before writes', async () => {
    const adapter = makeAdapter({
      getContainer: vi
        .fn()
        .mockResolvedValue({ ...sharedContainer, deletedAt: 123 }),
    });
    const service = createCollaboratorInventoryService(session, adapter);

    expect(
      await service.addNote('container-1', {
        id: 'note-2',
        text: 'No',
        createdAt: 200,
      }),
    ).toEqual({ ok: false, reason: 'deleted-record' });
    expect(adapter.appendNote).not.toHaveBeenCalled();
  });
});
