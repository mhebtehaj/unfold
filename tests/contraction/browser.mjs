import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.CONTRACTION_URL||'http://127.0.0.1:8766/';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'contraction-explorer.html');
  for(const [step,vertices,triangles] of [[0,6,8],[1,6,8],[2,5,6],[3,4,4]]){
    await page.locator(`[data-step="${step}"]`).click();
    assert.equal(await page.locator('#x-count').textContent(),`${vertices} vertices · ${vertices} edges`);
    assert.equal(await page.locator('#solid polygon').count(),triangles);
    assert.equal(await page.locator(`[data-step="${step}"]`).getAttribute('aria-pressed'),'true');
  }
  for(const [value,count] of [['zero',2],['one',2],['seam',0],['both',4]]){
    await page.selectOption('#regions',value);assert.equal(await page.locator('#solid polygon').count(),count);
  }
  const before=await page.locator('#solid').innerHTML();await page.locator('#turn-right').click();assert.notEqual(await page.locator('#solid').innerHTML(),before);
  await page.locator('#progress').fill('1.5');assert.match(await page.locator('#stage-note').textContent(),/Contracting 1−/);
  await page.locator('#play').click();await page.waitForFunction(()=>Number(document.querySelector('#progress').value)>1.6);await page.locator('#play').click();assert.equal(await page.locator('#play').textContent(),'▶ Play');
  await page.locator('#progress').fill('2.995');await page.locator('#play').click();await page.waitForFunction(()=>document.querySelector('#progress').value==='3');
  await page.getByRole('link',{name:'Original ambiguity explorer'}).click();await page.getByRole('link',{name:'Contract an edge'}).click();await page.locator('#x-count').filter({hasText:'6 vertices'}).waitFor();
  await page.setViewportSize({width:375,height:812});await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
  await page.locator('[data-step="2"]').click();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile overflow');
  assert(!/NaN|Infinity/.test(await page.locator('.views').innerHTML()),'Invalid drawing coordinates');
  await page.screenshot({path:'/private/tmp/unfold-contraction-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('Passed: stage buttons, region filters, rotation, slider, play/pause/end, existing navigation, mobile dark layout; no page errors.');
} finally {await browser.close();}
