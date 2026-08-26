import {
  COLLABORATOR_CAPABILITIES,
  type CollaboratorAccessRecord,
} from './access-model';

export interface LegacyCollaboratorIdentity {
  displayName: string;
  email: string;
  invitationId: string;
  acceptedAtMs: number;
}

function timestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (value && typeof value === 'object' && 'toMillis' in value) {
    const toMillis = (value as { toMillis?: unknown }).toMillis;
    if (typeof toMillis === 'function') {
      const result = toMillis.call(value);
      return typeof result === 'number' && Number.isFinite(result) && result >= 0
        ? result
        : null;
    }
  }
  return null;
}

export function legacyCollaboratorIdentity(
  value: unknown,
  collaboratorUid: string,
): LegacyCollaboratorIdentity | null {
  if (!value || typeof value !== 'object' || !collaboratorUid.trim()) return null;
  const record = value as Record<string, unknown>;
  if (record.status !== 'active') return null;
  const invitationId = typeof record.inviteToken === 'string'
    ? record.inviteToken.trim()
    : '';
  if (!invitationId) return null;
  const email = typeof record.email === 'string' ? record.email.trim() : '';
  const displayName = typeof record.displayName === 'string' && record.displayName.trim()
    ? record.displayName.trim()
    : email || `Collaborator ${collaboratorUid.slice(0, 6)}`;
  return {
    displayName,
    email,
    invitationId,
    acceptedAtMs: timestampMs(record.acceptedAt) ?? 0,
  };
}

export function legacyAccessFromRecords(
  invitation: unknown,
  collaborator: unknown,
  collaboratorUid: string,
  invitationId: string,
): CollaboratorAccessRecord | null {
  if (!invitation || typeof invitation !== 'object') return null;
  const record = invitation as Record<string, unknown>;
  const ownerUid = typeof record.ownerUid === 'string' ? record.ownerUid.trim() : '';
  const identity = legacyCollaboratorIdentity(collaborator, collaboratorUid);
  if (
    record.status !== 'active' ||
    record.acceptedByUid !== collaboratorUid ||
    !ownerUid ||
    ownerUid === collaboratorUid ||
    !identity ||
    identity.invitationId !== invitationId
  ) {
    return null;
  }

  const acceptedAtMs = identity.acceptedAtMs || timestampMs(record.acceptedAt) || 0;
  const ownerDisplayName = typeof record.ownerDisplayName === 'string'
    ? record.ownerDisplayName.trim()
    : '';
  return {
    schemaVersion: 1,
    accessId: `legacy:${ownerUid}:${collaboratorUid}`,
    invitationId,
    ownerUid,
    collaboratorUid,
    status: 'active',
    capabilities: [...COLLABORATOR_CAPABILITIES],
    validFromMs: acceptedAtMs,
    expiresAtMs: null,
    createdAtMs: acceptedAtMs,
    createdByUid: ownerUid,
    revokedAtMs: null,
    revokedByUid: null,
    supersedesAccessId: null,
    ...(ownerDisplayName ? { ownerDisplayName } : {}),
    collaboratorDisplayName: identity.displayName,
    ...(identity.email ? { collaboratorEmail: identity.email } : {}),
  };
}
