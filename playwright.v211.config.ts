import { defineConfig } from '@playwright/test';
import { chromiumLaunchOptions } from './scripts/playwright-browser.mjs';

export default defineConfig({
  testDir: './e2e-v211',
  outputDir: 'test-results-v211',
  timeout: 45000,
  workers: 1,
  retries: 0,
  fullyParallel: false,
  reporter: [['list'], ['json', { outputFile: 'test-results-v211/results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4181',
    launchOptions: chromiumLaunchOptions(),
    locale: 'ar-SA',
    timezoneId: 'Asia/Riyadh',
    viewport: { width: 320, height: 740 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --config vite.v211.config.ts --mode test --host 127.0.0.1 --port 4181 --strictPort',
    url: 'http://127.0.0.1:4181/v211.html',
    reuseExistingServer: false,
  },
});
