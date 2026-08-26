interface InventoryContainerPresentation {
  effectiveIsPrivate: boolean;
  photos: readonly unknown[];
}

export function isVisibleInventoryContainer(
  container: InventoryContainerPresentation,
  inventoryOwnerUid: string,
  viewerUid: string,
): boolean {
  return inventoryOwnerUid === viewerUid || !container.effectiveIsPrivate;
}
