import { defineConfig } from '@playwright/test';
import { chromiumLaunchOptions } from './scripts/playwright-browser.mjs';
export default defineConfig({
 testDir: './e2e-deployment', outputDir: 'test-results-deployment', workers: 1, retries: 0, timeout: 60_000,
 reporter: [['list'],['json',{outputFile:'test-results-deployment/deployment-results.json'}]],
 use: {launchOptions:chromiumLaunchOptions(),locale:'ar-SA',timezoneId:'Asia/Riyadh'},
});
