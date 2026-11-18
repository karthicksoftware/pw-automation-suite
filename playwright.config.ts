import { defineConfig, devices } from '@playwright/test';
import { environment } from './src/config/environment.js';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: true,
  failOnFlakyTests: environment.isCI,
  retries: environment.isCI ? 1 : 0,
  workers: environment.workers,
  timeout: 90_000,
  globalTimeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  outputDir: 'test-results/artifacts',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
  ],
  use: {
    baseURL: environment.baseURL,
    serviceWorkers: 'block',
    testIdAttribute: 'data-qa',
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    headless: true,
  },
  projects: [
    { name: 'api', testMatch: '**/api/**/*.spec.ts', timeout: 60_000 },
    {
      name: 'ui',
      testMatch: '**/ui/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'], browserName: 'chromium' },
    },
    ...(process.env.AGENT_SEED === '1'
      ? [
          {
            name: 'agent-seed',
            testMatch: 'seed.spec.ts',
            use: { ...devices['Desktop Chrome'], browserName: 'chromium' as const },
          },
        ]
      : []),
  ],
});
