type AccessDocument = Record<string, unknown> | null | undefined;

export function allowsSharedPhotoAccess(
  canonical: AccessDocument,
  legacy: AccessDocument,
  ownerUid: string,
  collaboratorUid: string,
  capability: 'inventory.read' | 'item.move',
  nowMs = Date.now(),
): boolean {
  if (!ownerUid || !collaboratorUid || ownerUid === collaboratorUid) return false;

  if (canonical) {
    return canonical.schemaVersion === 1 &&
      canonical.ownerUid === ownerUid &&
      canonical.collaboratorUid === collaboratorUid &&
      canonical.status === 'active' &&
      Array.isArray(canonical.capabilities) &&
      canonical.capabilities.includes(capability) &&
      typeof canonical.validFromMs === 'number' &&
      canonical.validFromMs <= nowMs &&
      (canonical.expiresAtMs === null ||
        (typeof canonical.expiresAtMs === 'number' && nowMs < canonical.expiresAtMs));
  }

  return legacy?.status === 'active';
}

export function resolveAllowedOrigins(
  projectId: string | undefined,
  configuredOrigins: string | undefined,
): string[] {
  const configured = (configuredOrigins ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;

  const local = ['http://localhost:5173', 'http://localhost:5174'];
  if (projectId === 'vowvy-staging') {
    return [
      'https://vowvy-staging.web.app',
      'https://vowvy-staging.firebaseapp.com',
      ...local,
    ];
  }
  if (projectId === 'vowvy-1ba5f') {
    return [
      'https://app.vowvy.com',
      'https://vowvy.com',
      'https://www.vowvy.com',
      'https://vowvy-1ba5f.web.app',
      'https://vowvy-1ba5f.firebaseapp.com',
    ];
  }
  if (!projectId || projectId === 'vowvy-emulator') return local;

  throw new Error('ALLOWED_ORIGINS must explicitly include the production application domains.');
}
