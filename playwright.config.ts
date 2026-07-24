import { defineConfig, devices } from '@playwright/test';
import chromium from '@sparticuz/chromium';
import { inflate } from '@sparticuz/chromium';
import { join } from 'node:path';

const localChromiumPath = process.env.FIRESTORE_EMULATOR_HOST && !process.env.CI
  ? await inflate(join(
      process.cwd(),
      'node_modules/@sparticuz/chromium/bin/chromium.br',
    ))
  : undefined;

chromium.setGraphicsMode = false;

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    launchOptions: localChromiumPath
      ? { executablePath: localChromiumPath, args: chromium.args }
      : undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: process.env.FIRESTORE_EMULATOR_HOST
      ? 'VITE_USE_FIREBASE_EMULATORS=true npm run dev -- --host 127.0.0.1 --port 4173'
      : 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
});
