import {
  hasCollaboratorCapability,
  type CollaboratorCapability,
  type CollaboratorSession,
} from './access-model';

export interface CollaboratorLocation {
  id: string;
  name: string;
  parentId: string | null;
  visibility: 'inherit' | 'private' | 'shared';
  effectiveIsPrivate: boolean;
  deletedAt?: unknown;
}

export interface CollaboratorNote {
  id: string;
  text: string;
  createdAt: number;
  addedBy: string;
  deletedAt?: number;
}

export interface CollaboratorPhoto {
  id: string;
  url: string;
  storagePath: string;
  description: string;
  createdAt: number;
  addedBy: string;
  deletedAt?: number;
}

export interface CollaboratorContainer {
  id: string;
  name: string;
  locationId: string;
  location: string;
  visibility: 'inherit' | 'private' | 'shared';
  effectiveIsPrivate: boolean;
  notes: CollaboratorNote[];
  photos: CollaboratorPhoto[];
  deletedAt?: unknown;
}

export interface NewCollaboratorLocation {
  name: string;
  parentId: string | null;
  visibility: 'shared' | 'inherit';
  effectiveIsPrivate: false;
  createdBy: string;
}

export interface NewCollaboratorContainer {
  name: string;
  locationId: string;
  location: string;
  visibility: 'inherit';
  effectiveIsPrivate: false;
  createdBy: string;
  notes: [];
  photos: [];
}

export interface InventoryServiceAdapter {
  listLocations(ownerUid: string): Promise<CollaboratorLocation[]>;
  listContainers(ownerUid: string): Promise<CollaboratorContainer[]>;
  getLocation(
    ownerUid: string,
    locationId: string,
  ): Promise<CollaboratorLocation | null>;
  getContainer(
    ownerUid: string,
    containerId: string,
  ): Promise<CollaboratorContainer | null>;
  createLocation(
    ownerUid: string,
    location: NewCollaboratorLocation,
  ): Promise<string>;
  createContainer(
    ownerUid: string,
    container: NewCollaboratorContainer,
  ): Promise<string>;
  appendPhoto(
    ownerUid: string,
    containerId: string,
    photo: CollaboratorPhoto,
  ): Promise<void>;
  appendNote(
    ownerUid: string,
    containerId: string,
    note: CollaboratorNote,
  ): Promise<void>;
  replaceNote(
    ownerUid: string,
    containerId: string,
    note: CollaboratorNote,
  ): Promise<void>;
  moveContainer(
    ownerUid: string,
    containerId: string,
    locationId: string,
    location: string,
  ): Promise<void>;
  movePhoto(
    ownerUid: string,
    sourceContainerId: string,
    destinationContainerId: string,
    photoId: string,
    movedBy: string,
  ): Promise<void>;
}

export type InventoryServiceError =
  | 'forbidden'
  | 'invalid-input'
  | 'not-found'
  | 'private-record'
  | 'deleted-record';

export type InventoryServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: InventoryServiceError };

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function isShared(record: {
  effectiveIsPrivate: boolean;
  visibility: string;
}): boolean {
  return (
    record.effectiveIsPrivate === false &&
    (record.visibility === 'shared' || record.visibility === 'inherit')
  );
}

function isDeleted(record: { deletedAt?: unknown }): boolean {
  return record.deletedAt !== undefined && record.deletedAt !== null;
}

function requireCapability(
  session: CollaboratorSession,
  capability: CollaboratorCapability,
): InventoryServiceResult<undefined> {
  return hasCollaboratorCapability(session, capability)
    ? { ok: true, value: undefined }
    : { ok: false, reason: 'forbidden' };
}

export function createCollaboratorInventoryService(
  session: CollaboratorSession,
  adapter: InventoryServiceAdapter,
) {
  const verifyLocation = async (
    locationId: string,
  ): Promise<InventoryServiceResult<CollaboratorLocation>> => {
    if (!isNonEmpty(locationId)) return { ok: false, reason: 'invalid-input' };
    const location = await adapter.getLocation(session.ownerUid, locationId);
    if (!location) return { ok: false, reason: 'not-found' };
    if (isDeleted(location)) return { ok: false, reason: 'deleted-record' };
    if (!isShared(location)) return { ok: false, reason: 'private-record' };
    return { ok: true, value: location };
  };

  const verifyContainer = async (
    containerId: string,
  ): Promise<InventoryServiceResult<CollaboratorContainer>> => {
    if (!isNonEmpty(containerId)) return { ok: false, reason: 'invalid-input' };
    const container = await adapter.getContainer(session.ownerUid, containerId);
    if (!container) return { ok: false, reason: 'not-found' };
    if (isDeleted(container)) return { ok: false, reason: 'deleted-record' };
    if (!isShared(container)) return { ok: false, reason: 'private-record' };
    const location = await verifyLocation(container.locationId);
    if (!location.ok) return location;
    return { ok: true, value: container };
  };

  return {
    async readInventory(): Promise<
      InventoryServiceResult<{
        locations: CollaboratorLocation[];
        containers: CollaboratorContainer[];
      }>
    > {
      const allowed = requireCapability(session, 'inventory.read');
      if (!allowed.ok) return allowed;
      const [locations, containers] = await Promise.all([
        adapter.listLocations(session.ownerUid),
        adapter.listContainers(session.ownerUid),
      ]);
      const sharedLocations = locations.filter(
        location => !isDeleted(location) && isShared(location),
      );
      const sharedLocationIds = new Set(sharedLocations.map(({ id }) => id));
      return {
        ok: true,
        value: {
          locations: sharedLocations,
          containers: containers.filter(
            container =>
              !isDeleted(container) &&
              isShared(container) &&
              sharedLocationIds.has(container.locationId),
          ),
        },
      };
    },

    async createLocation(
      name: string,
      parentId: string | null,
    ): Promise<InventoryServiceResult<string>> {
      const allowed = requireCapability(session, 'location.create');
      if (!allowed.ok) return allowed;
      if (!isNonEmpty(name)) return { ok: false, reason: 'invalid-input' };
      if (parentId !== null) {
        const parent = await verifyLocation(parentId);
        if (!parent.ok) return parent;
      }
      const id = await adapter.createLocation(session.ownerUid, {
        name: name.trim(),
        parentId,
        visibility: parentId === null ? 'shared' : 'inherit',
        effectiveIsPrivate: false,
        createdBy: session.collaboratorUid,
      });
      return { ok: true, value: id };
    },

    async createContainer(
      name: string,
      locationId: string,
      locationPath: string,
    ): Promise<InventoryServiceResult<string>> {
      const allowed = requireCapability(session, 'container.create');
      if (!allowed.ok) return allowed;
      if (!isNonEmpty(name) || !isNonEmpty(locationPath)) {
        return { ok: false, reason: 'invalid-input' };
      }
      const location = await verifyLocation(locationId);
      if (!location.ok) return location;
      const id = await adapter.createContainer(session.ownerUid, {
        name: name.trim(),
        locationId,
        location: locationPath,
        visibility: 'inherit',
        effectiveIsPrivate: false,
        createdBy: session.collaboratorUid,
        notes: [],
        photos: [],
      });
      return { ok: true, value: id };
    },

    async addPhoto(
      containerId: string,
      photo: Omit<CollaboratorPhoto, 'addedBy'>,
    ): Promise<InventoryServiceResult<undefined>> {
      const allowed = requireCapability(session, 'photo.create');
      if (!allowed.ok) return allowed;
      const container = await verifyContainer(containerId);
      if (!container.ok) return container;
      if (!isNonEmpty(photo.id) || !isNonEmpty(photo.storagePath)) {
        return { ok: false, reason: 'invalid-input' };
      }
      await adapter.appendPhoto(session.ownerUid, containerId, {
        ...photo,
        addedBy: session.collaboratorUid,
      });
      return { ok: true, value: undefined };
    },

    async addNote(
      containerId: string,
      note: Omit<CollaboratorNote, 'addedBy'>,
    ): Promise<InventoryServiceResult<undefined>> {
      const allowed = requireCapability(session, 'note.create');
      if (!allowed.ok) return allowed;
      const container = await verifyContainer(containerId);
      if (!container.ok) return container;
      if (!isNonEmpty(note.id) || !isNonEmpty(note.text)) {
        return { ok: false, reason: 'invalid-input' };
      }
      await adapter.appendNote(session.ownerUid, containerId, {
        ...note,
        text: note.text.trim(),
        addedBy: session.collaboratorUid,
      });
      return { ok: true, value: undefined };
    },

    async editNote(
      containerId: string,
      noteId: string,
      text: string,
    ): Promise<InventoryServiceResult<undefined>> {
      const allowed = requireCapability(session, 'note.edit');
      if (!allowed.ok) return allowed;
      const container = await verifyContainer(containerId);
      if (!container.ok) return container;
      const note = container.value.notes.find(
        item => item.id === noteId && item.deletedAt === undefined,
      );
      if (!note) return { ok: false, reason: 'not-found' };
      if (!isNonEmpty(text)) return { ok: false, reason: 'invalid-input' };
      await adapter.replaceNote(session.ownerUid, containerId, {
        ...note,
        text: text.trim(),
      });
      return { ok: true, value: undefined };
    },

    async moveContainer(
      containerId: string,
      destinationLocationId: string,
      destinationPath: string,
    ): Promise<InventoryServiceResult<undefined>> {
      const allowed = requireCapability(session, 'item.move');
      if (!allowed.ok) return allowed;
      if (!isNonEmpty(destinationPath)) {
        return { ok: false, reason: 'invalid-input' };
      }
      const [container, destination] = await Promise.all([
        verifyContainer(containerId),
        verifyLocation(destinationLocationId),
      ]);
      if (!container.ok) return container;
      if (!destination.ok) return destination;
      await adapter.moveContainer(
        session.ownerUid,
        containerId,
        destinationLocationId,
        destinationPath,
      );
      return { ok: true, value: undefined };
    },

    async movePhoto(
      sourceContainerId: string,
      destinationContainerId: string,
      photoId: string,
    ): Promise<InventoryServiceResult<undefined>> {
      const allowed = requireCapability(session, 'item.move');
      if (!allowed.ok) return allowed;
      if (
        !isNonEmpty(photoId) ||
        !isNonEmpty(sourceContainerId) ||
        !isNonEmpty(destinationContainerId) ||
        sourceContainerId === destinationContainerId
      ) {
        return { ok: false, reason: 'invalid-input' };
      }
      const [source, destination] = await Promise.all([
        verifyContainer(sourceContainerId),
        verifyContainer(destinationContainerId),
      ]);
      if (!source.ok) return source;
      if (!destination.ok) return destination;
      if (!source.value.photos.some(photo => photo.id === photoId)) {
        return { ok: false, reason: 'not-found' };
      }
      if (destination.value.photos.some(photo => photo.id === photoId)) {
        return { ok: false, reason: 'invalid-input' };
      }
      await adapter.movePhoto(
        session.ownerUid,
        sourceContainerId,
        destinationContainerId,
        photoId,
        session.collaboratorUid,
      );
      return { ok: true, value: undefined };
    },
  };
}
