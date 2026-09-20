import assert from 'node:assert/strict';
import { webkit } from 'playwright';

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

  const previewStyle = page.getByRole('group', { name: 'Preview style' });
  await previewStyle.getByRole('button', { name: 'Physical', exact: true }).click();
  assert.equal(await editorCanvas.evaluate((node) => node.style.touchAction), 'pan-y');

  await previewStyle.getByRole('button', { name: 'Flat', exact: true }).click();
  assert.equal(await editorCanvas.evaluate((node) => node.style.touchAction), 'none');

  await page.getByRole('tab', { name: 'Export', exact: true }).click();
  const save2x = page.getByRole('button', { name: /Save 2× Image/ }).first();
  await save2x.waitFor({ state: 'visible' });
  assert.equal(await save2x.isDisabled(), false);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    save2x.click()
  ]);
  assert.equal(download.suggestedFilename(), 'cardBackgroundCombined@2x.png');

  if (pageErrors.length) {
    throw new Error('Page errors:\n' + pageErrors.join('\n\n'));
  }

  console.log('PASS mobile WebKit editor smoke');
} finally {
  await context.close();
  await browser.close();
}
