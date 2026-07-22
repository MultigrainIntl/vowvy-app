import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

describe('collaborator Firestore contract', () => {
  it('permits active collaborators to create only non-private containers', () => {
    expect(rules).toContain('allow create: if request.auth != null');
    expect(rules).toContain('request.resource.data.effectiveIsPrivate == false;');
    expect(rules).toContain('isSharedLocation(userId, request.resource.data.locationId);');
  });

  it('keeps shared locations read-only for collaborators', () => {
    const locationBlock = rules.match(/match \/users\/\{userId\}\/locations\/\{locationId\} \{([\s\S]*?)\n    \}/)?.[1] ?? '';
    expect(locationBlock).toContain('allow read:');
    expect(locationBlock).not.toContain('allow create:');
    expect(locationBlock).not.toContain('allow write:');
  });
});
