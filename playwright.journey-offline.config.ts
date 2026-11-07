import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./e2e-journey-offline',timeout:45000,workers:1,retries:0,fullyParallel:false,
 outputDir:'test-results-journey-offline',
 reporter:[['list'],['json',{outputFile:'test-results-journey-offline/journey-offline-results.json'}]],
 use:{baseURL:'http://127.0.0.1:4178',channel:process.env.PW_CHANNEL||undefined,locale:'ar-SA',timezoneId:'Asia/Riyadh',viewport:{width:320,height:740},serviceWorkers:'allow',trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:{command:'node scripts/build-engineering06l3.mjs --serve --port 4178',url:'http://127.0.0.1:4178/engineering.html',reuseExistingServer:false,timeout:30000},
});
