import {defineConfig} from '@playwright/test';
import {chromiumLaunchOptions} from './scripts/playwright-browser.mjs';
export default defineConfig({
 testDir:'./e2e-offline',outputDir:'test-results-offline',workers:1,retries:0,
 reporter:[['list'],['json',{outputFile:'test-results-offline/offline-results.json'}]],
 use:{baseURL:'http://127.0.0.1:4174',locale:'ar-SA',timezoneId:'Asia/Riyadh',launchOptions:chromiumLaunchOptions()},
 webServer:{command:'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4174 --strictPort',url:'http://127.0.0.1:4174',reuseExistingServer:false},
});
