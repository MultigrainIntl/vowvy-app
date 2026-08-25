import { remapInventoryOwner } from './staging-inventory-copy';

export interface LegacySharedInvitation {
  ownerUid: string;
  ownerDisplayName: string;
  status: string;
  acceptedByUid: string;
  expiresAt?: { toMillis?: () => number; toDate?: () => Date } | Date | null;
}

export function activeLegacySharedInvitations(
  values: unknown[],
  collaboratorUid: string,
  nowMs: number,
): LegacySharedInvitation[] {
  const owners = new Set<string>();
  return values.flatMap(value => {
    if (!value || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    if (record.status !== 'active' || record.acceptedByUid !== collaboratorUid) return [];
    if (typeof record.ownerUid !== 'string' || !record.ownerUid || record.ownerUid === collaboratorUid) return [];
    if (owners.has(record.ownerUid)) return [];
    const expiresAt = record.expiresAt as LegacySharedInvitation['expiresAt'];
    const expiryMs = expiresAt instanceof Date
      ? expiresAt.getTime()
      : expiresAt?.toMillis?.() ?? expiresAt?.toDate?.().getTime() ?? null;
    if (expiryMs !== null && expiryMs <= nowMs) return [];
    owners.add(record.ownerUid);
    return [{
      ownerUid: record.ownerUid,
      ownerDisplayName: typeof record.ownerDisplayName === 'string' && record.ownerDisplayName.trim()
        ? record.ownerDisplayName.trim()
        : 'Shared inventory',
      status: record.status,
      acceptedByUid: collaboratorUid,
      expiresAt,
    }];
  });
}

export function normalizeImportedSharedRecord(
  value: Record<string, unknown>,
  sourceOwnerUid: string,
  stagingOwnerUid: string,
): Record<string, unknown> | null {
  if (
    value.effectiveIsPrivate === true ||
    value.isPrivate === true ||
    value.visibility === 'private' ||
    value.deletedAt != null
  ) {
    return null;
  }
  const remapped = remapInventoryOwner(value, sourceOwnerUid, stagingOwnerUid) as Record<string, unknown>;
  const isContainer = typeof remapped.locationId === 'string' ||
    Array.isArray(remapped.photos) ||
    Array.isArray(remapped.photoUrls);
  return {
    ...remapped,
    createdBy: typeof remapped.createdBy === 'string' ? remapped.createdBy : stagingOwnerUid,
    ...(isContainer ? {
      notes: Array.isArray(remapped.notes) ? remapped.notes : [],
      photos: Array.isArray(remapped.photos) ? remapped.photos : [],
    } : {}),
    visibility: remapped.visibility === 'shared' ? 'shared' : 'inherit',
    effectiveIsPrivate: false,
    deletedAt: null,
  };
}
