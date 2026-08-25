import { describe, expect, it } from 'vitest';
import {
  allowsSharedPhotoAccess,
  resolveAllowedOrigins,
} from '../../functions/src/collaboratorAccess';

const canonical = {
  schemaVersion: 1,
  ownerUid: 'owner-1',
  collaboratorUid: 'collaborator-1',
  status: 'active',
  capabilities: ['inventory.read', 'item.move'],
  validFromMs: 0,
  expiresAtMs: null,
};

describe('production photo authorization compatibility', () => {
  it('authorizes both canonical and existing production collaborators', () => {
    expect(allowsSharedPhotoAccess(
      canonical, null, 'owner-1', 'collaborator-1', 'inventory.read', 100,
    )).toBe(true);
    expect(allowsSharedPhotoAccess(
      null, { status: 'active' }, 'owner-1', 'collaborator-1', 'inventory.read', 100,
    )).toBe(true);
  });

  it('never restores legacy access after canonical revocation or expiration', () => {
    expect(allowsSharedPhotoAccess(
      { ...canonical, status: 'revoked' },
      { status: 'active' },
      'owner-1',
      'collaborator-1',
      'inventory.read',
      100,
    )).toBe(false);
    expect(allowsSharedPhotoAccess(
      { ...canonical, expiresAtMs: 100 },
      { status: 'active' },
      'owner-1',
      'collaborator-1',
      'inventory.read',
      100,
    )).toBe(false);
  });

  it('uses an explicit production allowlist while preserving staging defaults', () => {
    expect(() => resolveAllowedOrigins('production-project', undefined))
      .toThrow('ALLOWED_ORIGINS must explicitly include');
    expect(resolveAllowedOrigins(
      'production-project',
      'https://inventory.example.test, https://example.test',
    )).toEqual(['https://inventory.example.test', 'https://example.test']);
    expect(resolveAllowedOrigins('vowvy-staging', undefined))
      .toContain('https://vowvy-staging.web.app');
    expect(resolveAllowedOrigins('vowvy-1ba5f', undefined)).toEqual([
      'https://app.vowvy.com',
      'https://vowvy.com',
      'https://www.vowvy.com',
      'https://vowvy-1ba5f.web.app',
      'https://vowvy-1ba5f.firebaseapp.com',
    ]);
  });
});
