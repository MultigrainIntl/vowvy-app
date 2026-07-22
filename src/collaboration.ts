export interface InventoryAccessContext {
  ownerUid: string;
  isSharedView: boolean;
  canCreateContainer: boolean;
  canCreateLocation: boolean;
}

export function getInventoryAccessContext(
  authenticatedUid: string,
  viewingOwnerUid: string,
): InventoryAccessContext {
  const isSharedView = authenticatedUid !== viewingOwnerUid;

  return {
    ownerUid: viewingOwnerUid,
    isSharedView,
    canCreateContainer: true,
    canCreateLocation: !isSharedView,
  };
}

export function buildEmptyContainerData(
  name: string,
  locationId: string,
  location: string,
  effectiveIsPrivate: boolean,
  createdAt: unknown,
) {
  return {
    name: name.trim(),
    locationId,
    location,
    photos: [],
    photoUrls: [],
    photoStoragePaths: [],
    createdAt,
    deletedAt: null,
    isPrivate: effectiveIsPrivate,
    visibility: 'inherit' as const,
    effectiveIsPrivate,
  };
}
