import { defineConfig } from '@playwright/test';
import { chromiumLaunchOptions } from './scripts/playwright-browser.mjs';

export default defineConfig({
  testDir: './e2e-v211-built',
  outputDir: 'test-results-v211-built',
  timeout: 45000,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results-v211-built/results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4182',
    launchOptions: chromiumLaunchOptions(),
    locale: 'ar-SA',
    timezoneId: 'Asia/Riyadh',
    viewport: {width: 1440, height: 1000},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/preview-v211.mjs --serve',
    url: 'http://127.0.0.1:4182/',
    reuseExistingServer: false,
  },
});
