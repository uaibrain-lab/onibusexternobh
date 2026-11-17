/* P19 is EXPLICIT only. It is intentionally excluded from the normal
 * Playwright and GitHub Actions runs because it queries the public
 * Cloudflare Worker/SUMOB source once per browser. Free-quota friendly.
 */
const {defineConfig,devices}=require('@playwright/test');
module.exports=defineConfig({
  testDir:__dirname,
  testMatch:'live-p19-stage.cjs',
  timeout:110000,
  expect:{timeout:25000},
  retries:0,
  workers:1,
  fullyParallel:false,
  reporter:[['line'],['html',{outputFolder:'playwright-report-p19',open:'never'}]],
  use:{trace:'retain-on-failure',screenshot:'only-on-failure'},
  projects:[
    {name:'android-390-emulado',use:{...devices['Pixel 7'],browserName:'chromium'}},
    {name:'android-360-emulado',use:{...devices['Pixel 5'],browserName:'chromium',viewport:{width:360,height:800}}},
    {name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1366,height:768}}}
  ],
  outputDir:'test-results-p19'
});
