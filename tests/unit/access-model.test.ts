import { describe, expect, it } from 'vitest';
import {
  COLLABORATOR_ACCESS_SCHEMA_VERSION,
  COLLABORATOR_CAPABILITIES,
  evaluateCollaboratorAccess,
  hasCollaboratorCapability,
  isCollaboratorAccessRecord,
  type CollaboratorAccessRecord,
} from '../../src/collaboration/access-model';

const NOW = 1_800_000_000_000;

function validRecord(
  overrides: Partial<CollaboratorAccessRecord> = {},
): CollaboratorAccessRecord {
  return {
    schemaVersion: COLLABORATOR_ACCESS_SCHEMA_VERSION,
    accessId: 'access-1',
    invitationId: 'invite-1',
    ownerUid: 'owner-1',
    collaboratorUid: 'collaborator-1',
    status: 'active',
    capabilities: [...COLLABORATOR_CAPABILITIES],
    validFromMs: NOW - 1_000,
    expiresAtMs: NOW + 1_000,
    createdAtMs: NOW - 2_000,
    createdByUid: 'owner-1',
    revokedAtMs: null,
    revokedByUid: null,
    supersedesAccessId: null,
    ...overrides,
  };
}

describe('authoritative collaborator access model', () => {
  it('defines only the approved collaborator capabilities', () => {
    expect(COLLABORATOR_CAPABILITIES).toEqual([
      'inventory.read',
      'location.create',
      'container.create',
      'photo.create',
      'note.create',
      'note.edit',
      'item.move',
    ]);
  });

  it('creates a verified session for the expected owner and collaborator', () => {
    const decision = evaluateCollaboratorAccess(
      validRecord(),
      'owner-1',
      'collaborator-1',
      NOW,
    );

    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;

    expect(decision.session.ownerUid).toBe('owner-1');
    expect(
      hasCollaboratorCapability(decision.session, 'container.create'),
    ).toBe(true);
  });

  it('fails closed for an unknown capability', () => {
    const record = {
      ...validRecord(),
      capabilities: ['inventory.read', 'container.delete'],
    };

    expect(isCollaboratorAccessRecord(record)).toBe(false);
    expect(
      evaluateCollaboratorAccess(
        record,
        'owner-1',
        'collaborator-1',
        NOW,
      ),
    ).toEqual({ allowed: false, reason: 'invalid-record' });
  });

  it('rejects the wrong owner or collaborator identity', () => {
    expect(
      evaluateCollaboratorAccess(
        validRecord(),
        'different-owner',
        'collaborator-1',
        NOW,
      ),
    ).toEqual({ allowed: false, reason: 'identity-mismatch' });
  });

  it('rejects access before its start time', () => {
    expect(
      evaluateCollaboratorAccess(
        validRecord({ validFromMs: NOW + 1 }),
        'owner-1',
        'collaborator-1',
        NOW,
      ),
    ).toEqual({ allowed: false, reason: 'not-started' });
  });

  it('rejects access at the exact expiration time', () => {
    expect(
      evaluateCollaboratorAccess(
        validRecord({ expiresAtMs: NOW }),
        'owner-1',
        'collaborator-1',
        NOW,
      ),
    ).toEqual({ allowed: false, reason: 'expired' });
  });

  it('allows an active access record without an expiration', () => {
    expect(
      evaluateCollaboratorAccess(
        validRecord({ expiresAtMs: null }),
        'owner-1',
        'collaborator-1',
        NOW,
      ).allowed,
    ).toBe(true);
  });

  it('rejects expired and revoked statuses even if the dates appear valid', () => {
    expect(
      evaluateCollaboratorAccess(
        validRecord({ status: 'expired' }),
        'owner-1',
        'collaborator-1',
        NOW,
      ),
    ).toEqual({ allowed: false, reason: 'not-active' });

    expect(
      evaluateCollaboratorAccess(
        validRecord({
          status: 'revoked',
          revokedAtMs: NOW - 1,
          revokedByUid: 'owner-1',
        }),
        'owner-1',
        'collaborator-1',
        NOW,
      ),
    ).toEqual({ allowed: false, reason: 'not-active' });
  });

  it('rejects malformed revocation history', () => {
    expect(
      isCollaboratorAccessRecord(
        validRecord({
          status: 'revoked',
          revokedAtMs: null,
          revokedByUid: null,
        }),
      ),
    ).toBe(false);

    expect(
      isCollaboratorAccessRecord(
        validRecord({
          status: 'active',
          revokedAtMs: NOW - 1,
          revokedByUid: 'owner-1',
        }),
      ),
    ).toBe(false);
  });

  it('prevents owner and collaborator from being the same account', () => {
    expect(
      isCollaboratorAccessRecord(
        validRecord({ collaboratorUid: 'owner-1' }),
      ),
    ).toBe(false);
  });
});
