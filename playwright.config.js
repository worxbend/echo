import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'site.spec.js',
  fullyParallel: true,
  globalSetup: './scripts/site-evidence-setup.mjs',
  globalTeardown: './scripts/site-evidence.mjs',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['html', { outputFolder: 'artifacts/site/playwright-report', open: 'never' }]],
  outputDir: 'artifacts/site/test-results',
  use: {
    baseURL: 'http://127.0.0.1:4173/echo/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/site-server.mjs',
    url: 'http://127.0.0.1:4173/echo/',
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
