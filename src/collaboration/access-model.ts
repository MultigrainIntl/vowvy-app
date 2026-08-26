export const COLLABORATOR_ACCESS_SCHEMA_VERSION = 1 as const;

export const COLLABORATOR_CAPABILITIES = [
  'inventory.read',
  'location.create',
  'container.create',
  'photo.create',
  'note.create',
  'note.edit',
  'item.move',
] as const;

export type CollaboratorCapability = (typeof COLLABORATOR_CAPABILITIES)[number];

export type CollaboratorAccessStatus = 'active' | 'expired' | 'revoked';

export interface CollaboratorAccessRecord {
  schemaVersion: typeof COLLABORATOR_ACCESS_SCHEMA_VERSION;
  accessId: string;
  invitationId: string;
  ownerUid: string;
  collaboratorUid: string;
  status: CollaboratorAccessStatus;
  capabilities: CollaboratorCapability[];
  validFromMs: number;
  expiresAtMs: number | null;
  createdAtMs: number;
  createdByUid: string;
  revokedAtMs: number | null;
  revokedByUid: string | null;
  supersedesAccessId: string | null;
  ownerDisplayName?: string;
  collaboratorDisplayName?: string;
  collaboratorEmail?: string;
}

export interface CollaboratorSession {
  accessId: string;
  ownerUid: string;
  collaboratorUid: string;
  capabilities: ReadonlySet<CollaboratorCapability>;
  expiresAtMs: number | null;
}

export type AccessRecordDecision =
  | { allowed: true; session: CollaboratorSession }
  | {
      allowed: false;
      reason:
        | 'invalid-record'
        | 'not-active'
        | 'not-started'
        | 'expired'
        | 'identity-mismatch';
    };

const CAPABILITY_SET = new Set<string>(COLLABORATOR_CAPABILITIES);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function isCollaboratorCapability(
  value: unknown,
): value is CollaboratorCapability {
  return typeof value === 'string' && CAPABILITY_SET.has(value);
}

export function isCollaboratorAccessRecord(
  value: unknown,
): value is CollaboratorAccessRecord {
  if (!value || typeof value !== 'object') return false;

  const record = value as Record<string, unknown>;
  const capabilities = record.capabilities;

  return (
    record.schemaVersion === COLLABORATOR_ACCESS_SCHEMA_VERSION &&
    isNonEmptyString(record.accessId) &&
    isNonEmptyString(record.invitationId) &&
    isNonEmptyString(record.ownerUid) &&
    isNonEmptyString(record.collaboratorUid) &&
    record.ownerUid !== record.collaboratorUid &&
    (record.status === 'active' ||
      record.status === 'expired' ||
      record.status === 'revoked') &&
    Array.isArray(capabilities) &&
    capabilities.length > 0 &&
    new Set(capabilities).size === capabilities.length &&
    capabilities.every(isCollaboratorCapability) &&
    isFiniteTimestamp(record.validFromMs) &&
    (record.expiresAtMs === null ||
      (isFiniteTimestamp(record.expiresAtMs) &&
        record.expiresAtMs > record.validFromMs)) &&
    isFiniteTimestamp(record.createdAtMs) &&
    isNonEmptyString(record.createdByUid) &&
    (record.revokedAtMs === null || isFiniteTimestamp(record.revokedAtMs)) &&
    (record.revokedByUid === null || isNonEmptyString(record.revokedByUid)) &&
    (record.supersedesAccessId === null ||
      isNonEmptyString(record.supersedesAccessId)) &&
    (record.status === 'revoked'
      ? record.revokedAtMs !== null && record.revokedByUid !== null
      : record.revokedAtMs === null && record.revokedByUid === null)
  );
}

export function evaluateCollaboratorAccess(
  value: unknown,
  expectedOwnerUid: string,
  expectedCollaboratorUid: string,
  nowMs: number,
): AccessRecordDecision {
  if (!isCollaboratorAccessRecord(value) || !isFiniteTimestamp(nowMs)) {
    return { allowed: false, reason: 'invalid-record' };
  }

  if (
    value.ownerUid !== expectedOwnerUid ||
    value.collaboratorUid !== expectedCollaboratorUid
  ) {
    return { allowed: false, reason: 'identity-mismatch' };
  }

  if (value.status !== 'active') {
    return { allowed: false, reason: 'not-active' };
  }

  if (nowMs < value.validFromMs) {
    return { allowed: false, reason: 'not-started' };
  }

  if (value.expiresAtMs !== null && nowMs >= value.expiresAtMs) {
    return { allowed: false, reason: 'expired' };
  }

  return {
    allowed: true,
    session: {
      accessId: value.accessId,
      ownerUid: value.ownerUid,
      collaboratorUid: value.collaboratorUid,
      capabilities: new Set(value.capabilities),
      expiresAtMs: value.expiresAtMs,
    },
  };
}

export function hasCollaboratorCapability(
  session: CollaboratorSession,
  capability: CollaboratorCapability,
): boolean {
  return session.capabilities.has(capability);
}
