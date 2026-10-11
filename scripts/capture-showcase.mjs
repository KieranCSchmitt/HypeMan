/** Capture real public webpages and genuine HypeMan interactions in a fresh profile.
 * npm run build && SHOWCASE_RECORD=1 node scripts/capture-showcase.mjs
 * Uses the normal live gateway and the existing HypeMan ChatGPT connection if available.
 * Never supplies AI replies, page fixtures, account data, or an existing browser profile.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { tsImport } from 'tsx/esm/api';
import { normalizeShowcaseVideo } from './normalize-showcase-video.mjs';
const { createGateway } = await tsImport('../apps/gateway/src/index.ts', import.meta.url);
const { loadConfig } = await tsImport('../apps/gateway/src/config.ts', import.meta.url);
const { ChatGPTAuth } = await tsImport('../apps/gateway/src/chatgpt-auth.ts', import.meta.url);
const output=resolve('docs/media'), raw=resolve(process.env.SHOWCASE_LOCAL_ONLY?'test-results/showcase/real-local':'test-results/showcase/real');
const viewport={width:1600,height:1000}, recording=!!process.env.SHOWCASE_RECORD, stills=!!process.env.SHOWCASE_STILLS, localOnly=!!process.env.SHOWCASE_LOCAL_ONLY, askOnly=!!process.env.SHOWCASE_ASK_ONLY;
const token=randomBytes(32).toString('hex');
const gatewayConfig=loadConfig({...process.env,PORT:process.env.SHOWCASE_PORT||'8821'});
assert.equal(gatewayConfig.demo,false,'Showcase capture requires the normal live gateway configuration.');
const gateway=createGateway(gatewayConfig,{token,chatgpt:new ChatGPTAuth()});
const profile=await mkdtemp(join(tmpdir(),'hypeman-real-showcase-'));
await mkdir(output,{recursive:true}); await mkdir(raw,{recursive:true});
const scenes={}, screenshots=[], actions=[], pages=new Map(), pageTimes=new Map();
const sourceUrl='https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/What_is_JavaScript';
let context, liveResult={available:false,attempted:false};
const pause=(ms=600)=>new Promise(r=>setTimeout(r,ms));
const elapsed=page=>(Date.now()-pageTimes.get(page))/1000;
async function waitFor(fn,label,timeout=30000){const limit=Date.now()+timeout;while(Date.now()<limit){if(await fn())return;await pause(150);}throw new Error(`Timed out: ${label}`);}
async function rpc(page,message){return page.evaluate(async(message)=>{const r=await chrome.runtime.sendMessage({...message,requestId:crypto.randomUUID()});if(!r?.ok)throw Error(r?.error||'No reply');return r.data;},message);}
async function ready(page){await page.bringToFront();const cdp=await context.newCDPSession(page);const current=await cdp.send('Browser.getWindowForTarget');await cdp.send('Browser.setWindowBounds',{windowId:current.windowId,bounds:{width:1680,height:1200}});await cdp.detach();await page.evaluate(()=>document.fonts.ready);await pause(800);}
async function send(page,text,delay=28){const field=page.getByRole('textbox',{name:'What do you need?',exact:true});if(!await field.isVisible())await page.getByRole('button',{name:/Open HypeMan/}).first().click();await waitFor(async()=>!await field.isDisabled(),'composer');await field.click();await field.pressSequentially(text,{delay});actions.push({page:pages.get(page),at:elapsed(page),type:'message',text});await field.press('Enter');await waitFor(async()=>await field.inputValue()==='','message accepted');}
async function move(page,selector,x,y,w,h){const shell=page.locator(selector);const b=await shell.locator('.pixel-workspace-bar').boundingBox();assert.ok(b,selector);await page.mouse.move(b.x+145,b.y+15);await page.mouse.down();await page.mouse.move(x+145,y+15,{steps:14});await page.mouse.up();await pause(250);if(w&&h){const bounds=await shell.boundingBox(),g=await shell.locator('.pixel-window-resize').boundingBox();await page.mouse.move(g.x+g.width/2,g.y+g.height/2);await page.mouse.down();await page.mouse.move(g.x+g.width/2+w-bounds.width,g.y+g.height/2+h-bounds.height,{steps:14});await page.mouse.up();await pause(250);}}
async function shot(page,file,description){if(localOnly&&file==='showcase-real-page.png')return;await ready(page);await page.mouse.move(20,980);await page.screenshot({path:join(output,file)});screenshots.push({file,description,...viewport,source:page.url()});console.log(`Captured ${file}`);}
async function scene(page,name,seconds,action){await ready(page);const start=elapsed(page);if(action)await action();await pause(stills || (localOnly&&['page','selection','note-edit'].includes(name)) ? 150 : Math.max(0,seconds-(elapsed(page)-start))*1000);scenes[name]={file:pages.get(page),start,end:elapsed(page),geometry:viewport,targets:await page.locator('.pixel-workspace').evaluateAll(els=>els.filter(el=>!el.hidden).map(el=>{const r=el.getBoundingClientRect();return {tool:el.dataset.windowTool||el.getAttribute('aria-label'),x:r.x,y:r.y,width:r.width,height:r.height};}))};console.log(`Recorded ${name} ${start.toFixed(2)}–${elapsed(page).toFixed(2)}`);}
async function newPage(name,url){const page=await context.newPage();pages.set(page,name);await page.goto(url,{waitUntil:'domcontentloaded'});await page.bringToFront();return page;}
try{
 const base=`http://127.0.0.1:${await gateway.listen()}`;
 const agent=(await gateway.health()).capabilities.agent; liveResult={available:agent.available,attempted:false}; console.log('Live connection:',agent.mode);
 const extension=resolve('apps/extension/dist');
 context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport,colorScheme:'light',...(recording?{recordVideo:{dir:raw,size:viewport}}:{}),args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--enable-unsafe-extension-debugging','--window-size=1680,1200','--force-device-scale-factor=1']});
 context.on('page',page=>pageTimes.set(page,Date.now()));
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
 const home=await newPage('real-rooftop.webm',`chrome-extension://${id}/newtab.html`);
 await rpc(home,{type:'settings.patch',patch:{serverUrl:base,serverToken:token,onboarded:true,proactiveEnabled:false,learningEnabled:false,reducedMotion:'off'}});
 for(const p of context.pages())if(p!==home)await p.close();await home.reload();await home.getByRole('button',{name:'Open HypeMan',exact:true}).waitFor();
 if(askOnly){
   assert.ok(agent.available,'A connected live model is required for the clean ask capture.');
   pages.delete(home);await home.close();
   const web=await newPage('real-ask-clean.webm',sourceUrl);
   await web.getByRole('heading',{name:'What is JavaScript?',exact:true}).waitFor();
   await web.getByRole('button',{name:/Open HypeMan/}).first().click();
   await move(web,'.workspace-chat',970,270,580,620);
   await web.mouse.move(780,590);await web.mouse.wheel(0,490);await pause(1800);
   await scene(web,'page',4);
   const prompt='In three short plain-text lines, explain how HTML, CSS, and JavaScript work together using one simple example. No Markdown.';
   const typedStart=elapsed(web);await send(web,prompt,28);
   scenes.typing={file:pages.get(web),start:typedStart,end:elapsed(web)+2,geometry:viewport};
   liveResult.attempted=true;
   await waitFor(async()=>{const err=web.locator('.conversation-pane .notice.error');if(await err.isVisible())throw Error((await err.innerText()).slice(0,400));return await web.locator('.chat-message.assistant').count()>0 && !await web.locator('.conversation-working').isVisible();},'genuine clean live reply',110000);
   liveResult.success=true;liveResult.response=await web.locator('.chat-message.assistant').last().innerText();
   assert.ok(!liveResult.response.includes('**'),'The live response did not follow the plain-text formatting request.');
   await scene(web,'live-reply',8);
   await shot(web,'showcase-real-page.png','Actual MDN page and an untouched live ChatGPT response in a fresh conversation.');
   const publicPath=join(output,'showcase-manifest.json');
   const publicManifest=JSON.parse(await readFile(publicPath,'utf8'));publicManifest.liveResult=liveResult;
   publicManifest.scenes=publicManifest.scenes.filter(s=>s.file!=='showcase-real-page.png').concat(screenshots);
   await writeFile(publicPath,JSON.stringify(publicManifest,null,2)+'\n');
   if(recording){
     await web.close();await web.video().saveAs(join(raw,'real-ask-clean.webm'));
     const normalized=await normalizeShowcaseVideo({file:join(raw,'real-ask-clean.webm'),sampleSeconds:scenes.page.start+1,referenceWindow:scenes.page.targets.find(t=>t.tool==='chat'),...viewport});
     const manifestPath=join(raw,'capture.json');const existing=JSON.parse(await readFile(manifestPath,'utf8'));
     Object.assign(existing.scenes,scenes);existing.actions.push(...actions);existing.liveResult=liveResult;
     existing.normalization['real-ask-clean.webm']=normalized;
     await writeFile(manifestPath,JSON.stringify(existing,null,2)+'\n');
     console.log('Merged clean ask capture:',manifestPath);
   }
   console.log('Untouched live response:',JSON.stringify(liveResult.response));
 }else{
 await shot(home,'showcase-rooftop.png','Actual extension new-tab rooftop at the capture time.');await scene(home,'rooftop',7);
 const web=await newPage('real-mdn.webm',sourceUrl);await web.getByRole('heading',{name:'What is JavaScript?',exact:true}).waitFor();
 await web.getByRole('button',{name:/Open HypeMan/}).first().click();await move(web,'.workspace-chat',1020,210,530,610);
 await shot(web,'showcase-real-page.png','Actual MDN JavaScript article with the HypeMan companion.');
 await scene(web,'page',6,async()=>{await web.mouse.move(780,590);await web.mouse.wheel(0,490);await pause(1800);});
 const paragraph=web.locator('p').filter({hasText:'JavaScript is a scripting or programming language that allows you to implement complex features on web pages'}).first();
 await paragraph.scrollIntoViewIfNeeded();await paragraph.selectText();await pause(1000);
 await scene(web,'selection',7,async()=>{await send(web,'save this',85);await web.locator('.workspace-notes .direct-note-editor').first().waitFor();});
 await move(web,'.workspace-notes',440,125,500,440);await move(web,'.workspace-chat',970,270,580,620);
 const note=web.locator('.workspace-notes .direct-note-editor').first();
 await scene(web,'note-edit',9,async()=>{await note.fill('');for(const [i,line] of ['HTML → structure','CSS → style','JavaScript → behavior'].entries()){if(i)await note.press('Enter');await note.pressSequentially(line,{delay:32});}await note.press('Tab');await pause(1200);});
 await shot(web,'showcase-saved-notes.png','A real selected MDN passage saved with its source URL and edited directly.');
 if(agent.available&&!localOnly){
   await send(web,'close notes',20);await send(web,'new chat',20);await move(web,'.workspace-chat',970,270,580,620);
   liveResult.attempted=true;const count=await web.locator('.chat-message.assistant').count();
   const typedStart=elapsed(web);await send(web,'In three short plain-text lines, explain how HTML, CSS, and JavaScript work together using one simple example. No Markdown.',28);
   scenes.typing={file:pages.get(web),start:typedStart,end:elapsed(web)+2,geometry:viewport};
   await pause(2000);
   try{await waitFor(async()=>{const err=web.locator('.conversation-pane .notice.error');if(await err.isVisible())throw Error((await err.innerText()).slice(0,400));return await web.locator('.chat-message.assistant').count()>count && !await web.locator('.conversation-working').isVisible();},'genuine live reply',110000);liveResult.success=true;liveResult.response=await web.locator('.chat-message.assistant').last().innerText();await scene(web,'live-reply',8);await shot(web,'showcase-real-page.png','Actual MDN page with the genuine live ChatGPT response to the typed question.');}
   catch(error){liveResult.success=false;liveResult.reason=String(error.message);console.log('Live request unavailable:',liveResult.reason);}
 }
 // Local commands and direct editing below are native app features, not model output.
 await send(home,'open whiteboard',40);await home.locator('.shared-board').waitFor();await move(home,'.workspace-board',75,140,930,680);await move(home,'.workspace-chat',1090,290,450,585);
 await home.getByRole('button',{name:'Add text',exact:true}).click();const editor=home.getByRole('textbox',{name:'Edit selected board text or equation',exact:true});
 await scene(home,'board-type',8,async()=>{await editor.fill('');for(const [i,line] of ['How a webpage comes together','','HTML  →  structure','CSS  →  style','JavaScript  →  behavior'].entries()){if(i)await editor.press('Enter');await editor.pressSequentially(line,{delay:42});}actions.push({page:pages.get(home),at:elapsed(home),type:'board-typing-complete'});await editor.press('Control+Enter');});
 await home.getByRole('button',{name:'Draw',exact:true}).click();const b=await home.locator('.board-viewport').boundingBox();
 await scene(home,'board',8,async()=>{await home.mouse.move(b.x+425,b.y+155);await home.mouse.down();await home.mouse.move(b.x+449,b.y+178,{steps:8});await home.mouse.move(b.x+502,b.y+119,{steps:14});await home.mouse.up();await pause(800);await home.getByRole('button',{name:'Select and move',exact:true}).click();});
 await shot(home,'showcase-whiteboard.png','User-authored study notes and directly drawn ink on the real shared whiteboard.');
 await send(home,'close whiteboard',20);await send(home,'open notes',30);await move(home,'.workspace-notes',85,135,700,580);await send(home,'open saved work',32);await move(home,'.workspace-chat',850,160,650,680);
 await scene(home,'saved',8,async()=>{await home.getByRole('searchbox',{name:'Find a note',exact:true}).pressSequentially('JavaScript',{delay:90});actions.push({page:pages.get(home),at:elapsed(home),type:'saved-search-typing-complete'});await pause(1200);});
 await shot(home,'showcase-project-notes.png','Real saved source note and actual saved conversations; no fictional project.');
 const workspace=await rpc(home,{type:'workspace.get'});
 const taskStates=workspace.tasks.map(t=>({id:t.id,status:t.status,steps:t.steps.map(s=>({title:s.title,status:s.status}))}));
 const previousPublic=localOnly?JSON.parse(await readFile(join(output,'showcase-manifest.json'),'utf8')):null;
 if(previousPublic)liveResult=previousPublic.liveResult;
 const finalScreenshots=[...new Map((previousPublic?[...previousPublic.scenes.filter(s=>!screenshots.some(n=>n.file===s.file)),...screenshots]:screenshots).map(s=>[s.file,s])).values()];
 const publicManifest={capturedWith:'Playwright Chromium, shipped extension, isolated new profile',mode:'Real public website and genuine app interactions; no supplied AI replies',...viewport,sourceUrls:[sourceUrl],liveResult,scenes:finalScreenshots,taskStates,limitations:liveResult.success?[]:['Live AI was attempted only when connected; see liveResult. Local saving, editing, ink and saved-work actions are genuine app features.']};
 await writeFile(join(output,'showcase-manifest.json'),JSON.stringify(publicManifest,null,2)+'\n');
 if(recording){for(const [p,file]of pages){await p.close();await p.video()?.saveAs(join(raw,file));}const normalization={};for(const [name,file]of pages){const sample=Object.values(scenes).find(s=>s.file===file);if(sample)normalization[file]=await normalizeShowcaseVideo({file:join(raw,file),sampleSeconds:sample.start+1,referenceWindow:sample.targets?.find(t=>t.tool==='chat'),...viewport});}const finalScenes=localOnly?JSON.parse(await readFile(resolve('test-results/showcase/real/capture.json'),'utf8')).scenes:{};if(localOnly){for(const s of Object.values(finalScenes))s.file='../real/'+s.file;for(const name of ['rooftop','board-type','board','saved'])finalScenes[name]=scenes[name];}else Object.assign(finalScenes,scenes);await writeFile(join(raw,'capture.json'),JSON.stringify({viewport,sourceUrls:[sourceUrl],liveResult,taskStates,actions,normalization,scenes:finalScenes},null,2)+'\n');console.log('Capture manifest:',join(raw,'capture.json'));}
 console.log('Live result:',JSON.stringify(liveResult));
 }
}catch(error){for(const[p,file]of pages)if(!p.isClosed())await p.screenshot({path:join(raw,`debug-${file}.png`)}).catch(()=>{});throw error;}
finally{await context?.close();await gateway.close();await rm(profile,{recursive:true,force:true});}
