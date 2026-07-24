import {
  COLLABORATOR_ACCESS_SCHEMA_VERSION,
  COLLABORATOR_CAPABILITIES,
  isCollaboratorAccessRecord,
  type CollaboratorAccessRecord,
  type CollaboratorCapability,
} from './access-model';

export const COLLABORATOR_INVITATION_SCHEMA_VERSION = 1 as const;

export type CollaboratorInvitationStatus =
  | 'pending'
  | 'accepted'
  | 'expired'
  | 'revoked';

export interface CollaboratorInvitation {
  schemaVersion: typeof COLLABORATOR_INVITATION_SCHEMA_VERSION;
  invitationId: string;
  ownerUid: string;
  status: CollaboratorInvitationStatus;
  capabilities: CollaboratorCapability[];
  validFromMs: number;
  expiresAtMs: number | null;
  createdAtMs: number;
  createdByUid: string;
  acceptedAtMs: number | null;
  acceptedByUid: string | null;
  accessId: string | null;
  revokedAtMs: number | null;
  revokedByUid: string | null;
  supersedesAccessId: string | null;
}

export type LifecycleResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason:
        | 'invalid-input'
        | 'not-pending'
        | 'not-active'
        | 'not-owner'
        | 'not-started'
        | 'expired'
        | 'identity-mismatch';
    };

export interface IssueInvitationInput {
  invitationId: string;
  ownerUid: string;
  createdByUid: string;
  nowMs: number;
  validFromMs?: number;
  expiresAtMs: number | null;
  capabilities?: CollaboratorCapability[];
  supersedesAccessId?: string | null;
}

export interface AcceptInvitationInput {
  invitation: unknown;
  collaboratorUid: string;
  accessId: string;
  nowMs: number;
}

export interface AcceptedInvitation {
  invitation: CollaboratorInvitation;
  access: CollaboratorAccessRecord;
}

export interface RevokedAccessLifecycle {
  invitation: CollaboratorInvitation;
  access: CollaboratorAccessRecord;
}

const CAPABILITY_SET = new Set<string>(COLLABORATOR_CAPABILITIES);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function hasValidCapabilities(
  value: unknown,
): value is CollaboratorCapability[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      capability =>
        typeof capability === 'string' && CAPABILITY_SET.has(capability),
    ) &&
    new Set(value).size === value.length
  );
}

export function isCollaboratorInvitation(
  value: unknown,
): value is CollaboratorInvitation {
  if (!value || typeof value !== 'object') return false;

  const invitation = value as Record<string, unknown>;
  const status = invitation.status;

  if (
    invitation.schemaVersion !== COLLABORATOR_INVITATION_SCHEMA_VERSION ||
    !isNonEmptyString(invitation.invitationId) ||
    !isNonEmptyString(invitation.ownerUid) ||
    (status !== 'pending' &&
      status !== 'accepted' &&
      status !== 'expired' &&
      status !== 'revoked') ||
    !hasValidCapabilities(invitation.capabilities) ||
    !isFiniteTimestamp(invitation.validFromMs) ||
    (invitation.expiresAtMs !== null &&
      (!isFiniteTimestamp(invitation.expiresAtMs) ||
        invitation.expiresAtMs <= invitation.validFromMs)) ||
    !isFiniteTimestamp(invitation.createdAtMs) ||
    !isNonEmptyString(invitation.createdByUid) ||
    (invitation.acceptedAtMs !== null &&
      !isFiniteTimestamp(invitation.acceptedAtMs)) ||
    (invitation.acceptedByUid !== null &&
      !isNonEmptyString(invitation.acceptedByUid)) ||
    (invitation.accessId !== null &&
      !isNonEmptyString(invitation.accessId)) ||
    (invitation.revokedAtMs !== null &&
      !isFiniteTimestamp(invitation.revokedAtMs)) ||
    (invitation.revokedByUid !== null &&
      !isNonEmptyString(invitation.revokedByUid)) ||
    (invitation.supersedesAccessId !== null &&
      !isNonEmptyString(invitation.supersedesAccessId))
  ) {
    return false;
  }

  if (status === 'pending' || status === 'expired') {
    return (
      invitation.acceptedAtMs === null &&
      invitation.acceptedByUid === null &&
      invitation.accessId === null &&
      invitation.revokedAtMs === null &&
      invitation.revokedByUid === null
    );
  }

  if (status === 'accepted') {
    return (
      invitation.acceptedAtMs !== null &&
      invitation.acceptedByUid !== null &&
      invitation.accessId !== null &&
      invitation.revokedAtMs === null &&
      invitation.revokedByUid === null
    );
  }

  return (
    invitation.revokedAtMs !== null &&
    invitation.revokedByUid !== null
  );
}

export function issueCollaboratorInvitation(
  input: IssueInvitationInput,
): LifecycleResult<CollaboratorInvitation> {
  const validFromMs = input.validFromMs ?? input.nowMs;
  const capabilities = input.capabilities ?? [...COLLABORATOR_CAPABILITIES];

  const invitation: CollaboratorInvitation = {
    schemaVersion: COLLABORATOR_INVITATION_SCHEMA_VERSION,
    invitationId: input.invitationId,
    ownerUid: input.ownerUid,
    status: 'pending',
    capabilities: [...capabilities],
    validFromMs,
    expiresAtMs: input.expiresAtMs,
    createdAtMs: input.nowMs,
    createdByUid: input.createdByUid,
    acceptedAtMs: null,
    acceptedByUid: null,
    accessId: null,
    revokedAtMs: null,
    revokedByUid: null,
    supersedesAccessId: input.supersedesAccessId ?? null,
  };

  if (
    input.ownerUid !== input.createdByUid ||
    !isCollaboratorInvitation(invitation)
  ) {
    return {
      ok: false,
      reason:
        input.ownerUid !== input.createdByUid
          ? 'not-owner'
          : 'invalid-input',
    };
  }

  return { ok: true, value: invitation };
}

export function acceptCollaboratorInvitation(
  input: AcceptInvitationInput,
): LifecycleResult<AcceptedInvitation> {
  if (
    !isCollaboratorInvitation(input.invitation) ||
    !isNonEmptyString(input.collaboratorUid) ||
    !isNonEmptyString(input.accessId) ||
    !isFiniteTimestamp(input.nowMs)
  ) {
    return { ok: false, reason: 'invalid-input' };
  }

  const invitation = input.invitation;

  if (invitation.status !== 'pending') {
    return { ok: false, reason: 'not-pending' };
  }

  if (input.collaboratorUid === invitation.ownerUid) {
    return { ok: false, reason: 'identity-mismatch' };
  }

  if (input.nowMs < invitation.validFromMs) {
    return { ok: false, reason: 'not-started' };
  }

  if (
    invitation.expiresAtMs !== null &&
    input.nowMs >= invitation.expiresAtMs
  ) {
    return { ok: false, reason: 'expired' };
  }

  const access: CollaboratorAccessRecord = {
    schemaVersion: COLLABORATOR_ACCESS_SCHEMA_VERSION,
    accessId: input.accessId,
    invitationId: invitation.invitationId,
    ownerUid: invitation.ownerUid,
    collaboratorUid: input.collaboratorUid,
    status: 'active',
    capabilities: [...invitation.capabilities],
    validFromMs: input.nowMs,
    expiresAtMs: invitation.expiresAtMs,
    createdAtMs: input.nowMs,
    createdByUid: invitation.ownerUid,
    revokedAtMs: null,
    revokedByUid: null,
    supersedesAccessId: invitation.supersedesAccessId,
  };

  const acceptedInvitation: CollaboratorInvitation = {
    ...invitation,
    status: 'accepted',
    acceptedAtMs: input.nowMs,
    acceptedByUid: input.collaboratorUid,
    accessId: input.accessId,
  };

  if (
    !isCollaboratorAccessRecord(access) ||
    !isCollaboratorInvitation(acceptedInvitation)
  ) {
    return { ok: false, reason: 'invalid-input' };
  }

  return {
    ok: true,
    value: { invitation: acceptedInvitation, access },
  };
}

export function expireCollaboratorAccess(
  value: unknown,
  nowMs: number,
): LifecycleResult<CollaboratorAccessRecord> {
  if (!isCollaboratorAccessRecord(value) || !isFiniteTimestamp(nowMs)) {
    return { ok: false, reason: 'invalid-input' };
  }

  if (value.status !== 'active') {
    return { ok: false, reason: 'not-active' };
  }

  if (value.expiresAtMs === null || nowMs < value.expiresAtMs) {
    return { ok: false, reason: 'not-active' };
  }

  return { ok: true, value: { ...value, status: 'expired' } };
}

export function revokeCollaboratorAccess(
  value: unknown,
  ownerUid: string,
  nowMs: number,
): LifecycleResult<CollaboratorAccessRecord> {
  if (
    !isCollaboratorAccessRecord(value) ||
    !isNonEmptyString(ownerUid) ||
    !isFiniteTimestamp(nowMs)
  ) {
    return { ok: false, reason: 'invalid-input' };
  }

  if (value.ownerUid !== ownerUid) {
    return { ok: false, reason: 'not-owner' };
  }

  if (value.status !== 'active') {
    return { ok: false, reason: 'not-active' };
  }

  const revoked: CollaboratorAccessRecord = {
    ...value,
    status: 'revoked',
    revokedAtMs: nowMs,
    revokedByUid: ownerUid,
  };

  return isCollaboratorAccessRecord(revoked)
    ? { ok: true, value: revoked }
    : { ok: false, reason: 'invalid-input' };
}

export function revokeCollaboratorInvitation(
  value: unknown,
  ownerUid: string,
  nowMs: number,
): LifecycleResult<CollaboratorInvitation> {
  if (
    !isCollaboratorInvitation(value) ||
    !isNonEmptyString(ownerUid) ||
    !isFiniteTimestamp(nowMs)
  ) {
    return { ok: false, reason: 'invalid-input' };
  }

  if (value.ownerUid !== ownerUid) {
    return { ok: false, reason: 'not-owner' };
  }

  if (value.status === 'revoked' || value.status === 'expired') {
    return { ok: false, reason: 'not-active' };
  }

  const revoked: CollaboratorInvitation = {
    ...value,
    status: 'revoked',
    revokedAtMs: nowMs,
    revokedByUid: ownerUid,
  };

  return isCollaboratorInvitation(revoked)
    ? { ok: true, value: revoked }
    : { ok: false, reason: 'invalid-input' };
}

export function revokeAcceptedAccessLifecycle(
  accessValue: unknown,
  invitationValue: unknown,
  ownerUid: string,
  nowMs: number,
): LifecycleResult<RevokedAccessLifecycle> {
  if (
    !isCollaboratorAccessRecord(accessValue) ||
    !isCollaboratorInvitation(invitationValue)
  ) {
    return { ok: false, reason: 'invalid-input' };
  }

  if (
    accessValue.ownerUid !== ownerUid ||
    invitationValue.ownerUid !== ownerUid
  ) {
    return { ok: false, reason: 'not-owner' };
  }

  if (
    invitationValue.status !== 'accepted' ||
    invitationValue.accessId !== accessValue.accessId ||
    invitationValue.acceptedByUid !== accessValue.collaboratorUid
  ) {
    return { ok: false, reason: 'identity-mismatch' };
  }

  const accessResult = revokeCollaboratorAccess(
    accessValue,
    ownerUid,
    nowMs,
  );
  const invitationResult = revokeCollaboratorInvitation(
    invitationValue,
    ownerUid,
    nowMs,
  );

  if (!accessResult.ok || !invitationResult.ok) {
    return {
      ok: false,
      reason: !accessResult.ok
        ? accessResult.reason
        : invitationResult.ok
          ? 'invalid-input'
          : invitationResult.reason,
    };
  }

  return {
    ok: true,
    value: {
      access: accessResult.value,
      invitation: invitationResult.value,
    },
  };
}

export function expirePendingInvitation(
  value: unknown,
  nowMs: number,
): LifecycleResult<CollaboratorInvitation> {
  if (!isCollaboratorInvitation(value) || !isFiniteTimestamp(nowMs)) {
    return { ok: false, reason: 'invalid-input' };
  }

  if (
    value.status !== 'pending' ||
    value.expiresAtMs === null ||
    nowMs < value.expiresAtMs
  ) {
    return { ok: false, reason: 'not-pending' };
  }

  return { ok: true, value: { ...value, status: 'expired' } };
}
