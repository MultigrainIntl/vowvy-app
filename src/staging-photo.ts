const ALLOWED_STORAGE_HOSTS = new Set(['firebasestorage.googleapis.com', 'storage.googleapis.com']);

export function stagingDirectPhotoUrl(projectId: string, photoUrl?: string): string | null {
  if (projectId !== 'vowvy-staging' || !photoUrl) return null;
  try {
    const parsed = new URL(photoUrl);
    return parsed.protocol === 'https:' && ALLOWED_STORAGE_HOSTS.has(parsed.hostname) ? photoUrl : null;
  } catch {
    return null;
  }
}
