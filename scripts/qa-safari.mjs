// Run only on an available Apple host, or against an explicitly provided safaridriver endpoint.
// Uses Safari's native W3C driver. No browser emulation and no production account data.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const driver=process.env.SAFARI_WEBDRIVER_URL??'http://127.0.0.1:4444';
if(process.platform!=='darwin'&&!process.env.SAFARI_WEBDRIVER_URL)throw new Error('Safari requires an Apple host or an explicitly configured Safari WebDriver endpoint.');
const target=process.env.SAFARI_TARGET??'macos',origin=process.env.SAFARI_TEST_ORIGIN??'http://127.0.0.1:3000';
assert.ok(['macos','ios'].includes(target));new URL(origin);
const output=process.env.SAFARI_QA_OUTPUT??'qa-output';await mkdir(output,{recursive:true});
let session;const results=[];const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function call(path,body,method=body===undefined?'GET':'POST'){
 const response=await fetch(driver+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});const json=await response.json();if(!response.ok||json.value?.error)throw new Error(json.value?.message??'WebDriver failed');return json.value;
}
const run=(path,body,method)=>call('/session/'+session+path,body,method);
const script=(source,args=[])=>run('/execute/sync',{script:source,args});
async function until(check){const end=Date.now()+12000;do{const value=await check();if(value)return value;await pause(150);}while(Date.now()<end);throw new Error('Timed out waiting for the interface');}
async function element(selector){return (await run('/element',{using:'css selector',value:selector}))['element-6066-11e4-a52e-4f735466cecf'];}
const click=async selector=>run('/element/'+await element(selector)+'/click',{});
async function page(view){await run('/url',{url:origin+'/app?view='+view});await until(()=>script("return document.readyState==='complete'&&!!document.querySelector('.workspace #main')"));await until(()=>script("return !!document.querySelector('.side-nav button[aria-current=page]')"));}
const report={status:'running',target:target==='ios'?'physical-ios-requested':'macos-safari',started_at:new Date().toISOString(),browser:{},results};
try{
 const capabilities={browserName:'Safari',platformName:target==='ios'?'ios':'macOS',...(target==='ios'?{'safari:useSimulator':false,...(process.env.SAFARI_DEVICE_UDID?{'safari:deviceUDID':process.env.SAFARI_DEVICE_UDID}:{})}:{})};
 const created=await call('/session',{capabilities:{alwaysMatch:capabilities}});session=created.sessionId;
 report.browser={name:created.capabilities.browserName,version:created.capabilities.browserVersion,platform:created.capabilities.platformName};
 assert.match(String(report.browser.name),/safari/i);if(target==='ios')assert.match(String(report.browser.platform),/ios/i);
 const signedIn=Boolean(process.env.SAFARI_USERNAME&&process.env.SAFARI_PASSWORD);
 report.coverage=signedIn?'authenticated-staging':'public-login-only';
 if(signedIn){
  if(process.env.SAFARI_ALLOW_AUTH_TEST!=='yes')throw new Error('Confirm a staging account with SAFARI_ALLOW_AUTH_TEST=yes');
  await run('/url',{url:origin});await until(()=>script("return !!document.querySelector('input[name=username]')"));
  await run('/element/'+await element('input[name=username]')+'/value',{text:process.env.SAFARI_USERNAME});await run('/element/'+await element('input[name=password]')+'/value',{text:process.env.SAFARI_PASSWORD});await click('.auth-submit');await until(()=>script("return !!document.querySelector('.workspace #main')"));
 }
 const sizes=target==='ios'?[null]:[{width:1440,height:1000},{width:834,height:1112},{width:390,height:844},{width:320,height:740}];
 for(const size of sizes){if(size)await run('/window/rect',{x:0,y:0,...size});
  for(const view of signedIn?['personal','helpers','moderators','requests','profile','notifications','history']:['login']){
   if(signedIn)await page(view);else{await run('/url',{url:origin});await until(()=>script("return document.readyState==='complete'&&!!document.querySelector('input[name=username]')"));}
   await until(()=>script('return Array.from(document.images).every(i=>i.complete)'));
   const state=await script(`return {width:document.documentElement.clientWidth,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,rtl:document.documentElement.dir,images:Array.from(document.images).filter(i=>i.getBoundingClientRect().width>0).every(i=>i.naturalWidth>0),supports:{dialog:typeof HTMLDialogElement!=='undefined',grid:CSS.supports('display','grid'),smallViewport:CSS.supports('height','100svh')}}`);
   assert.ok(state.overflow<=2,JSON.stringify({view,...state}));assert.equal(state.rtl,'rtl');assert.ok(state.images);assert.ok(state.supports.dialog&&state.supports.grid);results.push({view,...state});
  }
 }
 if(signedIn){await page('profile');await click('.profile-setting-row button');await until(()=>script("return !!document.querySelector('dialog[open] input[name=username]')"));await click('dialog .dialog-header button');await until(()=>script("return !document.querySelector('dialog[open]')"));results.push({interaction:'profile dialog opens and closes',passed:true});const mobile=await script("return getComputedStyle(document.querySelector('.menu-button')).display!=='none'");if(mobile){await click('.menu-button');await until(()=>script("return document.querySelector('#sidebar').classList.contains('open')"));await click('#sidebar .sidebar-close');await until(()=>script("return !document.querySelector('#sidebar').classList.contains('open')"));results.push({interaction:'mobile drawer opens and closes',passed:true});}}
 report.status='passed';
}catch(error){report.status='failed';report.error=error.message;process.exitCode=1;}
finally{if(session)try{await run('',undefined,'DELETE');}catch{}report.finished_at=new Date().toISOString();await writeFile(output+'/safari-result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,target:report.target,checks:results.length,report:output+'/safari-result.json'}));}
