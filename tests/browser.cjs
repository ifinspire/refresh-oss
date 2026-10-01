const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const root = process.env.APP_URL;
  const existing = await (await context.request.get(`${root}/api/photos`)).json();
  for (const photo of existing) await context.request.delete(`${root}/api/photos/${photo.id}`, {headers:{'X-Refresh-Request':'1'}});
  await page.goto(root);
  await page.getByRole('heading', {name:'Your photos',exact:true}).waitFor();
  assert.equal(await page.locator('.screen:visible').count(),1);
  assert.equal(await page.locator('#settings-screen').isVisible(),false);
  await page.screenshot({path:'/results/gallery-empty.png',fullPage:true});

  // Examples are a picker, and selecting one opens that photo's workspace.
  await page.getByRole('button',{name:'Try an example',exact:true}).click();
  await page.getByRole('button',{name:'Use Studio portrait',exact:true}).click();
  await page.getByRole('heading',{name:'Demo — man',exact:true}).waitFor();
  const photoHash = new URL(page.url()).hash;
  assert.match(photoHash, /#\/photo\/[a-f0-9]{32}/);
  assert.equal(await page.locator('.screen:visible').count(),1);
  await page.getByRole('button',{name:'View model instructions'}).click();
  await page.locator('#details-dialog[open] pre').first().waitFor();
  assert.match(await page.locator('#details-content').textContent(),/Prefer residual blur/);
  await page.getByRole('button',{name:'Close details'}).click();
  await page.locator('#reference-options > summary').click();
  const referenceBytes = await (await context.request.get(`${root}/examples/man-before.webp`)).body();
  await page.locator('#reference-file').setInputFiles({name:'Reference portrait.webp',mimeType:'image/webp',buffer:referenceBytes});
  await page.getByText('1 selected',{exact:true}).waitFor();
  assert.equal(await page.locator('#references input:checked').count(),1);
  assert.equal(new URL(page.url()).hash,photoHash);
  await page.locator('#reference-options > summary').click();

  // Exact crop inputs also make framing available without a mouse.
  await page.locator('#photo-options > summary').click();
  await page.getByRole('button',{name:'Adjust crop'}).click();
  await page.getByText('Set an exact area').click();
  await page.getByLabel('Left',{exact:true}).fill('50');
  await page.getByLabel('Top',{exact:true}).fill('50');
  await page.getByLabel('Width',{exact:true}).fill('900');
  await page.getByLabel('Height',{exact:true}).fill('900');
  await page.getByRole('button',{name:'Apply crop'}).click();
  await page.getByText('Cropped photo',{exact:true}).waitFor();

  await page.getByRole('link',{name:'Settings',exact:true}).click();
  await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();
  await page.getByLabel('Server address').fill('http://unavailable.invalid/v1');
  await page.getByLabel('Model name',{exact:true}).fill('test-model');
  await page.getByRole('button',{name:'Save & check'}).click();
  await page.getByRole('heading',{name:'Could not connect'}).waitFor();
  await page.getByLabel('Server address').fill('http://test-image-server:8000/v1');
  await page.getByRole('button',{name:'Save & check'}).click();
  await page.getByRole('heading',{name:'Connected',exact:true}).waitFor();
  await page.getByRole('button',{name:'Try a test image'}).click();
  await page.getByText('Test image created. You’re ready to go.').waitFor();
  await page.screenshot({path:'/results/settings.png',fullPage:true});

  // Test photos remain in Settings; the gallery only shows the chosen photo.
  await page.getByRole('link',{name:'Gallery',exact:true}).click();
  await page.locator('#gallery-screen:visible').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.photo-card').length === 2);
  assert.equal(await page.locator('.photo-card').count(),2);
  await page.getByRole('link',{name:'Reconstruction',exact:true}).click();
  await page.getByRole('heading',{name:'Demo — man',exact:true}).waitFor();
  await page.getByText('Cropped photo',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Make three versions',exact:true}).click();
  await page.locator('#result-actions:visible').waitFor();
  await page.waitForFunction(() => document.querySelector('#generate').textContent === 'Make three new versions' && !document.querySelector('#generate').disabled);
  assert.equal(await page.locator('#mode-tabs button:enabled').count(),4);
  assert.equal(await page.getByRole('button',{name:'Balanced',exact:true}).getAttribute('aria-pressed'),'true');
  await page.waitForFunction(() => document.querySelector('#comparison').width > 1);
  await page.getByRole('button',{name:'Reimagined',exact:true}).click();
  await page.getByText('More creative detail. May change the person’s likeness.').waitFor();
  await page.getByRole('button',{name:'Natural',exact:true}).click();
  const download = page.waitForEvent('download');
  await page.getByRole('link',{name:'Download image',exact:true}).click();
  assert.equal((await download).suggestedFilename(),'refresh-natural.png');
  await page.getByRole('button',{name:'View details',exact:true}).click();
  await page.getByText('Full work record',{exact:true}).click();
  assert.match(await page.locator('#details-content').textContent(),/"crop": \[\s*50,\s*50,\s*900,\s*900/);
  await page.getByRole('button',{name:'Close details'}).click();
  await page.locator('#photo-options > summary').click();
  await page.waitForFunction(() => document.querySelector('#comparison').width > 1);
  await page.screenshot({path:'/results/reconstruction.png',fullPage:true});

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button',{name:'Refine this version',exact:true}).click();
  await page.waitForFunction(() => document.querySelectorAll('#history .history-item').length === 2 && !document.querySelector('#generate').disabled);
  await page.locator('#result-actions:visible').waitFor();
  await page.locator('#history .history-item').last().click();
  assert.equal(await page.getByRole('button',{name:'Balanced',exact:true}).getAttribute('aria-pressed'),'true');

  // Direct links survive refresh, and browser back returns to the gallery.
  await page.reload();
  await page.locator('#result-actions:visible').waitFor();
  await page.getByRole('link',{name:'Gallery',exact:true}).click();
  await page.getByRole('button',{name:'Open Demo — man',exact:true}).click();
  await page.locator('#reconstruction-screen:visible').waitFor();
  await page.goBack();
  await page.getByRole('heading',{name:'Your photos',exact:true}).waitFor();
  await page.screenshot({path:'/results/gallery.png',fullPage:true});

  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/results/gallery-mobile.png',fullPage:true});
  await page.goto(root + photoHash);
  await page.locator('#result-actions:visible').waitFor();
  await page.screenshot({path:'/results/reconstruction-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,'mobile horizontal overflow');
  await page.getByRole('link',{name:'Settings',exact:true}).click();
  await page.getByLabel('Server address').waitFor();
  await page.screenshot({path:'/results/settings-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,'settings mobile horizontal overflow');

  // Restore only this isolated test instance and check deletion from the gallery.
  await page.getByRole('button',{name:'Use local server'}).click();
  await page.getByRole('button',{name:'Save & check'}).click();
  await page.getByRole('heading',{name:'Could not connect'}).waitFor();
  await page.getByRole('button',{name:'Remove test image'}).click();
  await page.getByRole('link',{name:'Gallery',exact:true}).click();
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button',{name:'Delete Demo — man',exact:true}).click();
  await page.getByRole('button',{name:'Delete Reference portrait.webp',exact:true}).click();
  await page.getByRole('heading',{name:'Start with a photo',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  await browser.close();
  console.log('Browser checks passed: three-screen navigation, examples, prompts, accessible cropping, settings and image test, gallery isolation, three versions, comparison, PNG download, history, deep links, mobile layouts and deletion.');
})().catch(error => { console.error(error); process.exit(1); });
