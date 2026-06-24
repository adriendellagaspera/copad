import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'npm run preview',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env['CI'],
      timeout: 30_000,
    },
    {
      command: 'npm run signaling',
      port: 4444,
      reuseExistingServer: !process.env['CI'],
      timeout: 15_000,
    },
  ],
});
