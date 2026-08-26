import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const runtimeFiles = [
  '.firebaserc',
  'src/firebase.ts',
  'src/environment.ts',
  'src/shared.tsx',
  'src/AdminScreen.tsx',
  'src/ManageScreen.tsx',
  'src/MainScreen.tsx',
  'functions/src/index.ts',
];

describe('staging environment separation', () => {
  it('does not embed production identifiers in runtime files', () => {
    for (const file of runtimeFiles) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toContain('vowvy-1ba5f');
      expect(source, file).not.toContain('app.vowvy.com');
      expect(source, file).not.toContain('469480656114');
      expect(source, file).not.toContain('tn4kJIuUuQPjGZaufTMb65O5Gin2');
    }
  });

  it('targets only the staging Firebase project by default', () => {
    const firebaseRc = JSON.parse(readFileSync('.firebaserc', 'utf8'));
    expect(firebaseRc.projects).toEqual({ default: 'vowvy-staging' });
  });

  it('keeps App Check opt-in', () => {
    const source = readFileSync('src/firebase.ts', 'utf8');
    expect(source).toContain('else if (appCheckSiteKey)');
    expect(source).toContain('new ReCaptchaV3Provider(appCheckSiteKey)');
  });
});
