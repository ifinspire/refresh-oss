const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({headless: true});
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Only this Compose test instance uses this folder; clear leftovers from a failed run.
  const existing = await (await context.request.get(`${process.env.APP_URL}/api/photos`)).json();
  for (const photo of existing) await context.request.delete(`${process.env.APP_URL}/api/photos/${photo.id}`, {headers:{'X-Refresh-Request':'1'}});
  await page.goto(process.env.APP_URL);
  await page.getByRole('heading', {name: 'Your photo library'}).waitFor();
  await page.getByRole('button', {name: 'Try with this photo'}).first().click();
  await page.getByRole('heading', {name: 'Demo — man', exact: true}).waitFor();
  await page.getByText('Read the exact instructions sent to the model').click();
  await page.locator('#prompts pre').first().waitFor();
  assert.match(await page.locator('#prompts').textContent(), /Prefer residual blur/);
  await page.getByRole('button', {name: 'Image server settings'}).click();
  await page.getByLabel('Server address').fill('http://unavailable.invalid/v1');
  await page.getByLabel('Model name', {exact: true}).fill('test-model');
  await page.getByRole('button', {name: 'Save settings', exact: true}).click();
  await page.getByText('Settings saved. Check the connection, then try a test image.').waitFor();
  await page.getByRole('button', {name: 'Check connection'}).click();
  await page.waitForFunction(() => /Cannot connect|HTTP/.test(document.querySelector('#connection').textContent));
  // Exercise the real app over HTTP with a test-only provider that echoes inputs.
  await page.getByLabel('Server address').fill('http://test-image-server:8000/v1');
  await page.getByRole('button', {name: 'Save settings', exact: true}).click();
  await page.getByText('Settings saved. Check the connection, then try a test image.').waitFor();
  await page.getByRole('button', {name: 'Check connection'}).click();
  await page.getByText('Model is listed; run the image test to verify editing.').waitFor();
  await page.getByRole('button', {name: 'Try a test image'}).click();
  await page.locator('#jobs .job').filter({hasText:'Image server test'}).getByText('Ready', {exact:true}).waitFor();
  await page.getByRole('button', {name: 'Make three versions'}).click();
  await page.waitForFunction(() => document.querySelectorAll('#jobs .job').length === 2);
  await page.locator('#jobs .job').first().getByText('Ready', {exact:true}).waitFor();
  assert.equal(await page.locator('#jobs .job').first().locator('.result').count(), 3);
  const download = page.waitForEvent('download');
  await page.locator('#jobs .job').first().getByRole('link', {name:'Download PNG'}).first().click();
  assert.equal((await download).suggestedFilename(), 'refresh-natural.png');
  // Restore defaults; no real GPU request or paid generation in this test.
  await page.getByLabel('Server address').fill('http://omni:8000/v1');
  await page.getByLabel('Model name', {exact: true}).fill('black-forest-labs/FLUX.2-klein-4B');
  await page.getByRole('button', {name: 'Save settings', exact: true}).click();
  await page.getByText('Settings saved. Check the connection, then try a test image.').waitFor();
  await page.locator('#settings-close').click();
  await page.screenshot({path:'/results/desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/results/mobile.png',fullPage:true});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'mobile horizontal overflow');
  page.on('dialog', dialog => dialog.accept());
  while (await page.locator('.photo-card').count()) {
    const count = await page.locator('.photo-card').count();
    await page.locator('.photo-card').first().getByRole('button',{name:'Delete',exact:true}).click();
    await page.waitForFunction(n => document.querySelectorAll('.photo-card').length < n, count);
  }
  await page.getByText('Add your own photo, or try an example below.').waitFor();
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('Browser checks passed: examples, prompts, settings, unavailable server, real HTTP edit flow with test provider, three versions, PNG download, mobile layout, deletion.');
})().catch(error => {console.error(error); process.exit(1);});
