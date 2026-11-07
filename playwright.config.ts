import { defineConfig, devices } from '@playwright/test';

const chrome = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: { executablePath: chrome },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: 'tablet', use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: true } },
  ],
});
