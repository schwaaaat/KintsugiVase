import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

function assertCameraClose(actual, expected, tolerance = 1e-9) {
  for (const key of ['camera', 'target']) {
    assert.equal(actual[key].length, expected[key].length);
    actual[key].forEach((value, index) => {
      assert(Math.abs(value - expected[key][index]) <= tolerance, `${key}[${index}] moved from ${expected[key][index]} to ${value}`);
    });
  }
}

const browser = await chromium.launch({headless: true, args: ['--enable-webgl', '--use-gl=swiftshader', '--allow-file-access-from-files']});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('kintsugi_disclaimer_accepted', 'true'));
  await page.goto(pathToFileURL(path.resolve('dist/index.dev.html')).href);
  await page.locator('#bedX').evaluate(el => { el.closest('details').open = true; });
  await page.locator('#bedX').fill('300');
  await page.locator('#bedX').press('Tab');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('kintsugi_typescript_settings_v2') || '{}').controls?.bedX === '300');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#resetSettingsBtn').click();
  await page.waitForFunction(() => document.querySelector('#bedX')?.value === '256');
  assert.deepEqual(await page.evaluate(() => ({
    settings: localStorage.getItem('kintsugi_typescript_settings_v2'),
    transitions: localStorage.getItem('kintsugi_transitions'),
    disclaimer: localStorage.getItem('kintsugi_disclaimer_accepted')
  })), {settings: null, transitions: null, disclaimer: 'true'});
  await page.locator('#guideBtn').click();
  await page.locator('#guideModal').waitFor({ state: 'visible' });
  assert.match(await page.locator('#helpTransitionEngine').textContent(), /Scarf Lap Joint/);
  assert.match(await page.locator('#guideModal').textContent(), /Per-junction editing and custom G-code/);
  await page.locator('#startWalkthroughBtn').click();
  await page.locator('#walkthroughOverlay').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#walkthroughProgress').textContent(), 'Step 1 of 9');
  const firstHighlight = await page.locator('#walkthroughHighlight').boundingBox();
  assert(firstHighlight && firstHighlight.width > 0 && firstHighlight.height > 0);
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#walkthroughProgress').textContent(), 'Step 2 of 9');
  await page.keyboard.press('Escape');
  await page.locator('#walkthroughOverlay').waitFor({ state: 'hidden' });
  await page.locator('#walkthroughBtn').click();
  for (let step = 1; step < 9; step++) await page.locator('#walkthroughNextBtn').click();
  assert.equal(await page.locator('#walkthroughNextBtn').textContent(), 'Finish');
  await page.locator('#walkthroughNextBtn').click();
  await page.locator('#walkthroughOverlay').waitFor({ state: 'hidden' });
  const gcode = ['M83', ...Array.from({length: 5}, (_, i) => {
    const z = (i + 1) * 0.2;
    return `; Z_HEIGHT: ${z.toFixed(2)}\nG1 Z${z}\nG1 X10 Y10 F1800\nG1 X20 Z${z} E1\nG1 Y20 E1\nG1 X10 E1\nG1 Y10 E1`;
  })].join('\n');
  await page.locator('#fileBase').setInputFiles({name:'base.gcode', mimeType:'text/plain', buffer:Buffer.from(gcode)});
  await page.waitForFunction(() => document.querySelector('#zSlider').max === '1');
  const input = page.locator('#transitionsList input').first();
  await input.fill('0.51');
  await input.press('Enter');
  assert.equal(await input.inputValue(), '0.6');
  await input.press('ArrowUp');
  assert.equal(await input.inputValue(), '0.8');
  await input.press('ArrowDown');
  assert.equal(await input.inputValue(), '0.6');
  assert.equal(await input.evaluate(el => document.activeElement === el), true);
  const vaseWithWidths = `${gcode}\n; outer_wall_line_width = 0.55\n; line_width = 0.99`;
  await page.locator('#fileVase').setInputFiles({name:'vase.gcode', mimeType:'text/plain', buffer:Buffer.from(vaseWithWidths)});
  await page.waitForFunction(() => document.querySelector('#toastMessage')?.textContent === 'Loaded vase.gcode');
  assert.equal(await page.locator('#slicedWidth').inputValue(), '0.55');
  // This compact UI fixture intentionally has no slicer feature comments, so it
  // cannot identify a base outer contour for the strict planar engine.
  await page.locator('#usePlanarTransition').evaluate(el => {
    el.checked = false;
    el.dispatchEvent(new Event('change', {bubbles:true}));
  });
  const firstSpliceCamera = await page.evaluate(() => {
    const viewport = window.__viewport;
    viewport.camera.position.set(27, 28, 29);
    viewport.controls.target.set(4, 5, 6);
    viewport.controls.update();
    return {camera: viewport.camera.position.toArray(), target: viewport.controls.target.toArray()};
  });
  await page.locator('#processBtn').click();
  await page.waitForFunction(() => window.__viewport?.currentData || document.querySelector('#statusArea')?.textContent?.includes('Error'));
  assert(await page.evaluate(() => !!window.__viewport?.currentData), await page.locator('#statusArea').textContent());
  assertCameraClose(await page.evaluate(() => ({
    camera: window.__viewport.camera.position.toArray(),
    target: window.__viewport.controls.target.toArray()
  })), firstSpliceCamera);
  assert.equal(await page.locator('#mainLogo').getAttribute('data-repair-state'), 'intact');
  assert.equal(await page.locator('#mainLogo .logo-kintsugi').evaluate(el => getComputedStyle(el).opacity), '0');
  await page.locator('#mainLogo').click();
  assert.equal(await page.locator('#mainLogo').getAttribute('data-repair-state'), 'broken');
  await page.waitForTimeout(750);
  assert.notEqual(await page.locator('#mainLogo .logo-top').evaluate(el => getComputedStyle(el).transform), 'none');
  await page.locator('#mainLogo').click();
  assert.equal(await page.locator('#mainLogo').getAttribute('data-repair-state'), 'repaired');
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('#mainLogo .logo-top').evaluate(el => getComputedStyle(el).transform), 'none');
  assert.equal(await page.locator('#mainLogo .logo-kintsugi').evaluate(el => getComputedStyle(el).opacity), '1');
  assert.equal(await page.locator('#mainLogo .logo-top path').evaluate(el => getComputedStyle(el).fill), 'rgb(249, 115, 22)');
  await page.locator('#mainLogo').click({ clickCount: 5, delay: 50 });
  await page.waitForFunction(() => !!window.__viewport?.easterEggMesh);
  const easterEgg = await page.evaluate(() => {
    const mesh = window.__viewport.easterEggMesh;
    return {
      opacity: mesh.material.opacity,
      position: mesh.position.toArray(),
      rotationX: mesh.rotation.x,
      size: mesh.geometry.parameters.width,
      hasTexture: !!mesh.material.map,
    };
  });
  assert.equal(easterEgg.opacity, 0.9);
  assert.deepEqual(easterEgg.position, [128, 0.5, -128]);
  assert.equal(easterEgg.rotationX, -Math.PI / 2);
  assert.equal(easterEgg.size, 204.8);
  assert(easterEgg.hasTexture);
  await page.locator('#mainLogo').click({ clickCount: 5, delay: 50 });
  await page.waitForFunction(() => !window.__viewport?.easterEggMesh);
  const result = await page.evaluate(() => {
    const v = window.__viewport;
    const geometry = v.currentGeometry;
    const camera = v.camera.position.toArray().join(',');
    const full = v.currentData.metrics.segmentCount * 2;
    const slider = document.querySelector('#layerPlaybackSlider');
    const counts = [];
    for (const value of ['0','50','100']) {
      slider.value = value;
      slider.dispatchEvent(new Event('input', {bubbles:true}));
      counts.push(geometry.drawRange.count);
    }
    return {counts, full, sameGeometry: geometry === v.currentGeometry, sameCamera: camera === v.camera.position.toArray().join(',')};
  });
  assert(result.counts[0] > 0 && result.counts[0] < result.counts[1]);
  assert(result.counts[1] < result.counts[2]);
  assert.equal(result.counts[2], result.full);
  assert(result.sameGeometry && result.sameCamera);

  await page.locator('#playbackTimeline').evaluate(el => {
    el.value = '500';
    el.dispatchEvent(new Event('input', {bubbles:true}));
  });
  const playbackUi = await page.evaluate(() => ({
    z: Number(document.querySelector('#zSlider').value),
    layer: Number(document.querySelector('#layerPlaybackSlider').value),
    time: document.querySelector('#playbackTimeLabel').textContent
  }));
  assert(playbackUi.z > 0 && playbackUi.z < 1);
  assert(playbackUi.layer >= 0 && playbackUi.layer < 100);
  assert.match(playbackUi.time, /\/\s*\d+:\d{2}$/);

  const beforeWheel = Number(await page.locator('#zSlider').inputValue());
  await page.locator('.vertical-slider-wrap').dispatchEvent('wheel', {deltaY: -100});
  const afterWheel = Number(await page.locator('#zSlider').inputValue());
  assert(afterWheel > beforeWheel);
  await page.locator('#colorModeSelect').selectOption('speed');
  assert.match(await page.locator('#currentMetricValue').textContent(), /Selected Layer: .*mm\/s/);
  await page.locator('#zSlider').focus();
  await page.locator('#zSlider').press('ArrowDown');
  assert(Number(await page.locator('#zSlider').inputValue()) < afterWheel);
  assert.equal(await page.locator('#layerPlaybackSlider').inputValue(), '100');
  await page.locator('#useFlowTaper').evaluate(el => { el.closest('details').open = true; });
  await page.locator('label[for="useFlowTaper"]').click();
  assert(await page.locator('#flowTaperControls').evaluate(el => el.classList.contains('pointer-events-none')));

  await page.locator('#junctionPanel').evaluate(el => { el.open = true; });
  await page.locator('[data-junction-setting="transTemp"]').fill('230');
  await page.locator('[data-junction-setting="transTemp"]').press('Tab');
  await page.locator('[data-junction-code="before"]').fill('; CUSTOM-BEFORE-TEST');
  await page.locator('[data-junction-code="after"]').fill('; CUSTOM-AFTER-TEST');
  const positionedCamera = await page.evaluate(() => {
    const viewport = window.__viewport;
    viewport.camera.position.set(7, 8, 9);
    viewport.controls.target.set(1, 2, 3);
    viewport.controls.update();
    window.__geometryBeforeResplice = viewport.currentGeometry;
    return {camera: viewport.camera.position.toArray(), target: viewport.controls.target.toArray()};
  });
  await page.locator('#processBtn').click();
  await page.waitForFunction(() => window.splicedGcodeText?.includes('CUSTOM-AFTER-TEST'));
  await page.waitForFunction(() => window.__viewport.currentGeometry !== window.__geometryBeforeResplice);
  assertCameraClose(await page.evaluate(() => ({
    camera: window.__viewport.camera.position.toArray(),
    target: window.__viewport.controls.target.toArray()
  })), positionedCamera);
  await page.locator('#homeViewBtn').click();
  assert.notDeepEqual(await page.evaluate(() => ({
    camera: window.__viewport.camera.position.toArray(),
    target: window.__viewport.controls.target.toArray()
  })), positionedCamera);
  assert.match(await page.locator('#junctionGenerated').inputValue(), /M104 S230/);
  await page.locator('#editGeneratedJunction').click();
  await page.locator('[data-junction-code="replacement"]').fill('M104 S232 ; CUSTOM-BODY-TEST');
  await page.locator('#processBtn').click();
  await page.waitForFunction(() => window.splicedGcodeText?.includes('CUSTOM-BODY-TEST'));
  const customCode = await page.evaluate(() => window.splicedGcodeText);
  assert(customCode.indexOf('CUSTOM-BEFORE-TEST') < customCode.indexOf('CUSTOM-BODY-TEST'));
  assert(customCode.indexOf('CUSTOM-BODY-TEST') < customCode.indexOf('CUSTOM-AFTER-TEST'));

  const baseZip = new JSZip();
  baseZip.file('Metadata/plate_1.gcode', gcode);
  baseZip.file('Metadata/plate_1.png', Buffer.from([137,80,78,71,1,2,3]));
  baseZip.file('Metadata/print_settings.config', 'preserve this metadata');
  const vaseZip = new JSZip(); vaseZip.file('Metadata/plate_2.gcode', gcode);
  const beforeNewModel = await page.evaluate(() => {
    const viewport = window.__viewport;
    viewport.camera.position.set(17, 18, 19);
    viewport.controls.target.set(4, 5, 6);
    viewport.controls.update();
    window.__geometryBeforeNewModel = viewport.currentGeometry;
    return {camera: viewport.camera.position.toArray(), target: viewport.controls.target.toArray()};
  });
  await page.locator('#fileBase').setInputFiles({name:'base.gcode.3mf', mimeType:'application/zip', buffer: await baseZip.generateAsync({type:'nodebuffer'})});
  await page.waitForFunction(() => document.querySelector('#toastMessage')?.textContent === 'Loaded base.gcode.3mf');
  await page.waitForFunction(() => window.__viewport.currentGeometry !== window.__geometryBeforeNewModel);
  assert.notDeepEqual(await page.evaluate(() => ({
    camera: window.__viewport.camera.position.toArray(),
    target: window.__viewport.controls.target.toArray()
  })), beforeNewModel);
  await page.locator('#fileVase').setInputFiles({name:'vase.gcode.3mf', mimeType:'application/zip', buffer: await vaseZip.generateAsync({type:'nodebuffer'})});
  await page.waitForFunction(() => document.querySelector('#toastMessage')?.textContent === 'Loaded vase.gcode.3mf');
  await page.locator('#processBtn').click();
  await page.locator('#download3mfBtn').waitFor({state:'visible'});
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download3mfBtn').click()]);
  const exported = await JSZip.loadAsync(await fs.readFile(await download.path()));
  assert.equal(await exported.file('Metadata/print_settings.config').async('string'), 'preserve this metadata');
  assert.deepEqual(await exported.file('Metadata/plate_1.png').async('nodebuffer'), Buffer.from([137,80,78,71,1,2,3]));
  const exportedGcode=await exported.file('Metadata/plate_1.gcode').async('nodebuffer');
  assert.match(exportedGcode.toString('utf8'), /CUSTOM-BODY-TEST/);
  assert.equal(await exported.file('Metadata/plate_1.gcode.md5').async('string'),createHash('md5').update(exportedGcode).digest('hex').toUpperCase());
  assert.equal(exported.file('Metadata/plate_2.gcode'), null);

  await page.locator('#flowMultiplier').fill('1.23');
  await page.locator('#flowMultiplier').press('Tab');
  await page.locator('#startModeVaseBtn').click();
  await page.locator('#playbackSpeedSelect').selectOption('10');
  await page.reload();
  assert.equal(await page.locator('#flowMultiplier').inputValue(), '1.23');
  assert.match(await page.locator('#transitionModeDesc').textContent(), /Vase → Base/);
  assert.equal(await page.locator('#transitionsList input').first().inputValue(), '0.6');
  await page.locator('#junctionPanel').evaluate(el => { el.open = true; });
  assert.equal(await page.locator('[data-junction-setting="transTemp"]').inputValue(), '230');
  assert.equal(await page.locator('[data-junction-code="before"]').inputValue(), '; CUSTOM-BEFORE-TEST');
  assert.deepEqual(errors, []);
  console.log('Browser UI parity, junction editors, and synthetic 3MF round trip passed:', JSON.stringify(result));
} finally {
  await browser.close();
}
process.exit(0);

