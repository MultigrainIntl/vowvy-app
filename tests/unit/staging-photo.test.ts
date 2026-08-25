import { describe, expect, it } from 'vitest';
import { stagingDirectPhotoUrl } from '../../src/staging-photo';

describe('staging-only existing-photo display', () => {
  const photoUrl = 'https://firebasestorage.googleapis.com/v0/b/example/o/photo.jpg?alt=media&token=existing';
  it('uses an existing Firebase Storage download URL in staging', () => {
    expect(stagingDirectPhotoUrl('vowvy-staging', photoUrl)).toBe(photoUrl);
  });
  it('does not change photo loading outside staging', () => {
    expect(stagingDirectPhotoUrl('another-project', photoUrl)).toBeNull();
  });
  it('rejects untrusted, insecure, and invalid URLs', () => {
    expect(stagingDirectPhotoUrl('vowvy-staging', 'https://example.com/photo')).toBeNull();
    expect(stagingDirectPhotoUrl('vowvy-staging', 'http://firebasestorage.googleapis.com/photo')).toBeNull();
    expect(stagingDirectPhotoUrl('vowvy-staging', 'invalid')).toBeNull();
  });
});
