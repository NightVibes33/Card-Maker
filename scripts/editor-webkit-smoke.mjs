import assert from 'node:assert/strict';
import { webkit } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CARD_STUDIO_URL || 'http://127.0.0.1:3000';
const browser = await webkit.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'block',
  acceptDownloads: true
});
const page = await context.newPage();
const pageErrors = [];

page.on('pageerror', (error) => {
  pageErrors.push(String(error?.stack || error?.message || error));
});

await page.route('**/api/cucu**', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ results: [], total: 0, hasMore: false })
  });
});

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('main.studio').waitFor({ state: 'visible', timeout: 15000 });

  const installDialog = page.getByRole('dialog', { name: 'Install Card Studio' });
  if (await installDialog.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Close Install Card Studio' }).click();
    await installDialog.waitFor({ state: 'hidden', timeout: 5000 });
  }

  await page.getByRole('tab', { name: 'Studio', exact: true }).click();
  await page.getByRole('tab', { name: 'Card', exact: true }).click();

  const editorCanvas = page.locator('.cardFrame canvas').first();
  assert.equal(await editorCanvas.getAttribute('width'), '1024');
  assert.equal(await editorCanvas.getAttribute('height'), '646');

  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  const textEditor = page.getByLabel('Layer text');
  await textEditor.fill('AVATAR\nWA');
  assert.equal(await textEditor.inputValue(), 'AVATAR\nWA');

  await page.getByLabel('Text layer font').selectOption('serif');
  assert.equal(await page.getByLabel('Text layer font').inputValue(), 'serif');

  const rightAlign = page.getByRole('group', { name: 'Text alignment' }).getByRole('button', { name: 'Right' });
  await rightAlign.click();
  assert.equal(await rightAlign.getAttribute('aria-pressed'), 'true');

  const lockLayer = page.getByRole('switch', { name: 'Lock Layer' });
  await lockLayer.click();
  assert.equal(await lockLayer.getAttribute('aria-checked'), 'true');
  assert.equal(await textEditor.isDisabled(), true);

  const showLayer = page.getByRole('switch', { name: 'Show Layer' });
  await showLayer.click();
  assert.equal(await showLayer.getAttribute('aria-checked'), 'false');

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForFunction(() => {
    const control = [...document.querySelectorAll('[role="switch"]')]
      .find((node) => node.textContent?.includes('Show Layer'));
    return control?.getAttribute('aria-checked') === 'true';
  });
  assert.equal(await showLayer.getAttribute('aria-checked'), 'true');

  await lockLayer.click();
  assert.equal(await lockLayer.getAttribute('aria-checked'), 'false');
  assert.equal(await textEditor.isDisabled(), false);

  await page.getByRole('button', { name: '+ Shape', exact: true }).click();
  const shapeGroup = page.getByRole('group', { name: 'Shape type' });
  const ellipse = shapeGroup.getByRole('button', { name: 'Ellipse', exact: true });
  const rectangle = shapeGroup.getByRole('button', { name: 'Rectangle', exact: true });

  await ellipse.click();
  assert.equal(await ellipse.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByLabel('Corner Radius').count(), 0);

  await rectangle.click();
  assert.equal(await rectangle.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByLabel('Corner Radius').count(), 1);

  const customStackOrder = async () => page.locator('.layerRow').evaluateAll((nodes) =>
    nodes
      .map((node) => node.getAttribute('aria-label') || '')
      .filter((label) => /^(Text text|Shape shape) /i.test(label))
  );
  const initialStack = await customStackOrder();
  assert.ok(
    initialStack.findIndex((label) => /^Text text /i.test(label)) <
      initialStack.findIndex((label) => /^Shape shape /i.test(label)),
    'new shape should begin below the existing text layer'
  );

  await page.getByRole('button', { name: 'Bring Forward', exact: true }).click();
  const forwardedStack = await customStackOrder();
  assert.ok(
    forwardedStack.findIndex((label) => /^Shape shape /i.test(label)) <
      forwardedStack.findIndex((label) => /^Text text /i.test(label)),
    'Bring Forward must move the selected shape above the text layer'
  );

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const restoredStack = await customStackOrder();
  assert.ok(
    restoredStack.findIndex((label) => /^Text text /i.test(label)) <
      restoredStack.findIndex((label) => /^Shape shape /i.test(label)),
    'Undo must restore the previous layer order'
  );

  await page.getByRole('tab', { name: 'Position', exact: true }).click();
  const layerX = page.getByLabel('Layer horizontal position');
  assert.equal(Number(await layerX.inputValue()), 0.5);

  const canvasBox = await editorCanvas.boundingBox();
  assert.ok(canvasBox, 'editor canvas must have a layout box');
  await page.mouse.move(
    canvasBox.x + canvasBox.width / 2,
    canvasBox.y + canvasBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    canvasBox.x + canvasBox.width / 2 + 42,
    canvasBox.y + canvasBox.height / 2,
    { steps: 5 }
  );
  await page.mouse.up();

  const movedLayerX = Number(await layerX.inputValue());
  assert.ok(movedLayerX > 0.55, 'direct canvas drag must move the selected shape');

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="Layer horizontal position"]');
    return input && Math.abs(Number(input.value) - 0.5) < 0.001;
  });
  assert.ok(
    Math.abs(Number(await layerX.inputValue()) - 0.5) < 0.001,
    'Undo must restore the pre-drag shape position'
  );

  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="Layer horizontal position"]');
    return input && Number(input.value) > 0.55;
  });
  assert.ok(
    Number(await layerX.inputValue()) > 0.55,
    'Redo must restore the dragged shape position'
  );

  await page.getByRole('tab', { name: 'Card', exact: true }).click();
  const duplicateShape = page.getByRole('button', { name: 'Duplicate', exact: true });
  await duplicateShape.click();
  await page.waitForFunction(() => {
    return [...document.querySelectorAll('button')].filter(
      (node) => /^Shape shape /i.test(node.getAttribute('aria-label') || '')
    ).length >= 2;
  });

  const deleteShape = page.getByRole('button', { name: 'Delete', exact: true });
  await deleteShape.click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForFunction(() => {
    return [...document.querySelectorAll('button')].filter(
      (node) => /^Shape shape /i.test(node.getAttribute('aria-label') || '')
    ).length >= 2;
  });

  await page.getByRole('tab', { name: 'Card', exact: true }).click();
  const imageInputs = page.locator('input[type="file"][accept="image/*"]');
  assert.ok(await imageInputs.count() >= 2, 'background and image-layer file inputs must exist');

  const oversizedSvg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20000" height="20000"><rect width="100%" height="100%" fill="black"/></svg>'
  );
  await imageInputs.last().setInputFiles({
    name: 'oversized-safe.svg',
    mimeType: 'image/svg+xml',
    buffer: oversizedSvg
  });
  await page.getByText('Image resolution is too large for reliable iPhone editing.', { exact: true }).waitFor({
    state: 'visible',
    timeout: 10000
  });
  assert.equal(
    await page.getByLabel('Image Width').count(),
    0,
    'oversized vector art must be rejected before creating a layer'
  );

  const unsafeSvg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><image href="https://example.com/remote.png" width="120" height="80"/></svg>'
  );
  await imageInputs.last().setInputFiles({
    name: 'unsafe-remote.svg',
    mimeType: 'image/svg+xml',
    buffer: unsafeSvg
  });
  await page.getByText('SVG contains unsupported active or remote content.', { exact: true }).waitFor({
    state: 'visible',
    timeout: 10000
  });
  assert.equal(
    await page.getByLabel('Image Width').count(),
    0,
    'unsafe SVG must not create an image layer'
  );

  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAEYBxVSFUAAGMABf4C/WQAAAAASUVORK5CYII=',
    'base64'
  );
  await imageInputs.last().setInputFiles({
    name: 'webkit-smoke.png',
    mimeType: 'image/png',
    buffer: tinyPng
  });

  const imageWidth = page.getByLabel('Image Width').first();
  await imageWidth.waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(Number(await imageWidth.inputValue()), 640);

  await page.getByRole('tab', { name: 'Crop', exact: true }).click();
  const layerCropLeft = page.getByLabel('Layer Crop Left');
  await layerCropLeft.waitFor({ state: 'visible', timeout: 15000 });
  await layerCropLeft.evaluate((node) => {
    node.value = '0.1';
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="Layer Crop Left"]');
    return input && Math.abs(Number(input.value) - 0.1) < 0.001;
  });
  assert.ok(
    Math.abs(Number(await layerCropLeft.inputValue()) - 0.1) < 0.001,
    'imported image-layer crop controls must update in WebKit'
  );

  const previewStyle = page.getByRole('group', { name: 'Preview style' });
  await previewStyle.getByRole('button', { name: 'Physical', exact: true }).click();
  assert.equal(await editorCanvas.evaluate((node) => node.style.touchAction), 'pan-y');

  await previewStyle.getByRole('button', { name: 'Flat', exact: true }).click();
  assert.equal(await editorCanvas.evaluate((node) => node.style.touchAction), 'none');

  await page.getByRole('tab', { name: 'Crop', exact: true }).click();
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.getByRole('button', { name: /Replace Artwork/ }).click()
  ]);
  await fileChooser.setFiles({
    name: 'webkit-smoke.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4e0AAAAASUVORK5CYII=',
      'base64'
    )
  });
  await page.getByText('Imported image ready to crop', { exact: true }).waitFor({
    state: 'visible',
    timeout: 15000
  });

  // Let the 420ms autosave commit both the imported-image reference and
  // custom layer state, then verify hydration restores them after a reload.
  await page.waitForTimeout(900);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('main.studio').waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('tab', { name: 'Studio', exact: true }).click();
  await page.getByRole('tab', { name: 'Card', exact: true }).click();

  const restoredTextRow = page.getByRole('button', { name: /^Text text /i }).first();
  await restoredTextRow.waitFor({ state: 'visible', timeout: 10000 });
  await restoredTextRow.click();
  assert.equal(await page.getByLabel('Layer text').inputValue(), 'AVATAR\nWA');

  // Exercise the named-project Library independently of autosave. Save this
  // exact state, mutate the text, then reopen the project and confirm the
  // saved snapshot wins without losing imported-asset references.
  await page.getByRole('tab', { name: 'Library', exact: true }).click();
  await page.getByLabel('Project name').fill('WebKit Project');
  await page.getByRole('button', { name: 'Save Current Design', exact: true }).click();
  const savedProject = page.locator('article.projectCard').filter({ hasText: 'WebKit Project' }).first();
  await savedProject.waitFor({ state: 'visible', timeout: 15000 });

  await page.getByRole('tab', { name: 'Studio', exact: true }).click();
  await page.getByRole('tab', { name: 'Card', exact: true }).click();
  await page.getByRole('button', { name: /^Text text /i }).first().click();
  await page.getByLabel('Layer text').fill('MUTATED');
  assert.equal(await page.getByLabel('Layer text').inputValue(), 'MUTATED');

  await page.getByRole('tab', { name: 'Library', exact: true }).click();
  const savedProjectAgain = page.locator('article.projectCard').filter({ hasText: 'WebKit Project' }).first();
  await savedProjectAgain.getByRole('button', { name: 'Open', exact: true }).click();

  await page.getByRole('tab', { name: 'Card', exact: true }).click();
  await page.getByRole('button', { name: /^Text text /i }).first().click();
  assert.equal(
    await page.getByLabel('Layer text').inputValue(),
    'AVATAR\nWA',
    'opening a named project must restore its saved design snapshot'
  );

  // Round-trip the complete editable preset, including embedded imported
  // background/image assets, through the browser download + file import path.
  await page.getByRole('tab', { name: 'Library', exact: true }).click();
  const [presetDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.getByRole('button', { name: /Export Design JSON/ }).click()
  ]);
  assert.match(presetDownload.suggestedFilename(), /\.aircard\.json$/i);
  const presetPath = await presetDownload.path();
  assert.ok(presetPath, 'preset download must produce a local file for round-trip import');

  await page.getByRole('tab', { name: 'Studio', exact: true }).click();
  await page.getByRole('tab', { name: 'Card', exact: true }).click();
  await page.getByRole('button', { name: /^Text text /i }).first().click();
  await page.getByLabel('Layer text').fill('PRESET MUTATED');

  await page.getByRole('tab', { name: 'Library', exact: true }).click();
  const [presetChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.getByRole('button', { name: /Import Design JSON/ }).click()
  ]);
  await presetChooser.setFiles(presetPath);
  await page.getByText('Design preset imported', { exact: true }).waitFor({
    state: 'visible',
    timeout: 20000
  });

  await page.getByRole('tab', { name: 'Card', exact: true }).click();
  await page.getByRole('button', { name: /^Text text /i }).first().click();
  assert.equal(
    await page.getByLabel('Layer text').inputValue(),
    'AVATAR\nWA',
    'preset import must restore the exported text-layer state'
  );

  await page.getByRole('tab', { name: 'Export', exact: true }).click();
  const save2x = page.getByRole('button', { name: /Save 2× Image/ }).first();
  await save2x.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')]
      .find((node) => node.textContent?.includes('Save 2× Image'));
    return button && !button.disabled;
  }, null, { timeout: 15000 });
  assert.equal(await save2x.isDisabled(), false);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    save2x.click()
  ]);
  assert.equal(download.suggestedFilename(), 'cardBackgroundCombined@2x.png');

  const downloadPath = await download.path();
  assert.ok(downloadPath, 'exported PNG must have a local download path');
  const exportMeta = await sharp(downloadPath).metadata();
  assert.equal(exportMeta.format, 'png');
  assert.equal(exportMeta.width, 1024);
  assert.equal(exportMeta.height, 646);

  if (pageErrors.length) {
    throw new Error('Page errors:\n' + pageErrors.join('\n\n'));
  }

  console.log('PASS mobile WebKit editor smoke');
} finally {
  await context.close();
}

const offlineContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'allow'
});
const offlinePage = await offlineContext.newPage();

try {
  await offlinePage.route('**/api/cucu**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [], total: 0, hasMore: false })
    });
  });

  await offlinePage.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await offlinePage.locator('main.studio').waitFor({ state: 'visible', timeout: 15000 });
  await offlinePage.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('Service workers unavailable');
    await navigator.serviceWorker.ready;
  });
  await offlinePage.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, {
    timeout: 15000
  });

  await offlineContext.setOffline(true);
  await offlinePage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await offlinePage.locator('main.studio').waitFor({ state: 'visible', timeout: 15000 });
  assert.match(await offlinePage.locator('h1').first().innerText(), /Card Studio/i);

  console.log('PASS mobile WebKit offline shell smoke');
} finally {
  await offlineContext.setOffline(false).catch(() => {});
  await offlineContext.close();
  await browser.close();
}
