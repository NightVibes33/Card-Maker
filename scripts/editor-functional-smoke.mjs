import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import sharp from 'sharp';

const browser = await (process.env.CARD_STUDIO_BROWSER === 'chromium' ? chromium : webkit).launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'block'
});
await context.addInitScript(() => localStorage.setItem('aircard-install-dismissed-v2', '1'));
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

const pixel = () => page.locator('.cardFrame canvas').first().evaluate((canvas) => {
  const point = canvas.getContext('2d').getImageData(Math.round(canvas.width / 2), Math.round(canvas.height / 2), 1, 1).data;
  return Array.from(point);
});
const setBrightness = async () => {
  await page.getByRole('tab', { name: 'Adjust', exact: true }).click();
  await page.getByRole('button', { name: 'Brightness', exact: true }).click();
  const slider = page.getByRole('slider', { name: 'Brightness' });
  await slider.focus();
  await page.keyboard.press('End');
  await page.waitForFunction(() => Number(document.querySelector('input[aria-label="Brightness"]')?.value) > 1.6);
};

try {
  await page.goto(process.env.CARD_STUDIO_URL || 'http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Studio', exact: true }).click();

  await page.getByRole('button', { name: 'Close Edit panel', exact: true }).click();
  await page.locator('.studioPanelClosed').waitFor();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Close Edit panel', exact: true }).waitFor({ state: 'visible' });

  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.locator('.capcutLayerList').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Close Layers panel', exact: true }).click();

  await page.getByRole('tab', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: /Add Text/ }).click();
  await page.getByRole('textbox', { name: 'Layer text', exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('button', { name: 'Delete Text', exact: true }).isVisible(), true, 'Delete Text must be visible on the main Text panel');
  await page.getByRole('button', { name: 'Delete Text', exact: true }).click();
  await page.getByRole('button', { name: /Add Text/ }).waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('textbox', { name: 'Layer text', exact: true }).count(), 0, 'Delete Text removes the selected text layer');

  const artwork = await sharp({ create: { width: 640, height: 404, channels: 4, background: '#606060' } }).png().toBuffer();
  await page.locator('#panel-studio input[type="file"]').first().setInputFiles({ name: 'artwork.png', mimeType: 'image/png', buffer: artwork });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.cardFrame canvas');
    return canvas && Math.abs(canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[0] - 96) < 6;
  });
  const before = await pixel();
  await setBrightness();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.cardFrame canvas');
    return canvas && canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[0] > 145;
  });
  const after = await pixel();
  assert.ok(after[0] - before[0] > 45, 'Adjust must visibly change imported card artwork in WebKit');
  assert.match(await page.locator('.editingTargetBar').last().innerText(), /Editing Artwork/);

  await page.getByRole('tab', { name: 'Add', exact: true }).click();
  const layer = await sharp({ create: { width: 640, height: 404, channels: 4, background: '#405060' } }).png().toBuffer();
  await page.locator('#panel-studio input[type="file"]').last().setInputFiles({ name: 'layer.png', mimeType: 'image/png', buffer: layer });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.cardFrame canvas');
    return canvas && Math.abs(canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[0] - 64) < 6;
  });
  const layerBefore = await pixel();
  await setBrightness();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.cardFrame canvas');
    return canvas && canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[0] > 95;
  });
  const layerAfter = await pixel();
  assert.ok(layerAfter[0] - layerBefore[0] > 30, 'Adjust must visibly change a selected image layer in WebKit');
  assert.match(await page.locator('.editingTargetBar').last().innerText(), /Editing layer.png/);
  assert.deepEqual(errors, [], 'Editor must not throw while importing and adjusting artwork and layers');
  console.log('PASS mobile ' + (process.env.CARD_STUDIO_BROWSER || 'WebKit') + ' artwork and image layer adjustments');
} finally {
  await browser.close();
}
