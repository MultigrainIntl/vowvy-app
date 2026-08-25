export function remapInventoryOwner(value: unknown, sourceOwnerUid: string, stagingOwnerUid: string): unknown {
  if (typeof value === 'string') return value === sourceOwnerUid ? stagingOwnerUid : value;
  if (Array.isArray(value)) return value.map(item => remapInventoryOwner(item, sourceOwnerUid, stagingOwnerUid));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      remapInventoryOwner(item, sourceOwnerUid, stagingOwnerUid),
    ]));
  }
  return value;
}
