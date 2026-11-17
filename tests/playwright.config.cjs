const {defineConfig,devices}=require('@playwright/test');
module.exports=defineConfig({
 testDir:__dirname,
 testMatch:'browser-p9.spec.cjs',
 fullyParallel:false,
 timeout:110000,
 expect:{timeout:20000},
 reporter:[['line'],['html',{outputFolder:'playwright-report',open:'never'}]],
 use:{baseURL:'http://127.0.0.1:8765',trace:'retain-on-failure',
      screenshot:'only-on-failure'},
 projects:[
   {name:'desktop-chromium',use:{...devices['Desktop Chrome'],viewport:{width:1366,height:768}}},
   {name:'android-emulated-390',use:{...devices['Pixel 7'],browserName:'chromium'}},
   {name:'android-emulated-360',use:{...devices['Pixel 5'],browserName:'chromium',
      viewport:{width:360,height:800}}}
 ],
 outputDir:'test-results'
});
