import {defineConfig} from '@playwright/test';
import {chromiumLaunchOptions} from './scripts/playwright-browser.mjs';

export default defineConfig({
  testDir:'./e2e-reader-preview', outputDir:'test-results-reader-preview',
  timeout:45000, workers:1, retries:0, fullyParallel:false,
  reporter:[['list'],['json',{outputFile:'test-results-reader-preview/reader-preview-results.json'}]],
  use:{
    baseURL:'http://127.0.0.1:4181', launchOptions:chromiumLaunchOptions(),
    locale:'ar-SA', timezoneId:'Asia/Riyadh', viewport:{width:390,height:844},
    trace:'retain-on-failure', screenshot:'only-on-failure',
  },
  webServer:{
    command:'node node_modules/vite/bin/vite.js --config vite.reader-preview.config.ts --mode test --host 127.0.0.1 --port 4181 --strictPort',
    url:'http://127.0.0.1:4181/reader-preview.html', reuseExistingServer:false,
  },
});
