import {defineConfig} from '@playwright/test';
import {chromiumLaunchOptions} from './scripts/playwright-browser.mjs';
export default defineConfig({
  testDir:'./e2e-mushaf',outputDir:'test-results-mushaf',timeout:45000,workers:1,retries:0,fullyParallel:false,
  reporter:[['list'],['json',{outputFile:'test-results-mushaf/mushaf-results.json'}]],
  use:{baseURL:'http://127.0.0.1:4179',launchOptions:chromiumLaunchOptions(),locale:'ar-SA',timezoneId:'Asia/Riyadh',viewport:{width:390,height:844},trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{command:'node node_modules/vite/bin/vite.js --config vite.engineering.config.ts --mode test --host 127.0.0.1 --port 4179 --strictPort',url:'http://127.0.0.1:4179/engineering.html',reuseExistingServer:false},
});
