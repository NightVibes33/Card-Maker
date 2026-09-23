import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const source = (await readFile(new URL('../app/lib/pixelAdjust.js', import.meta.url), 'utf8'))
  .replace('export function adjustedImage', 'window.adjustedImage = function adjustedImage');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto('about:blank');
  await page.addScriptTag({ content: source });
  const result = await page.evaluate(() => {
    const original = document.createElement('canvas');
    original.width = 32;
    original.height = 16;
    const ctx = original.getContext('2d');
    ctx.fillStyle = '#646464';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#a05028';
    ctx.fillRect(16, 0, 16, 16);
    const point = (canvas, x = 8) => Array.from(canvas.getContext('2d').getImageData(x, 8, 1, 1).data).slice(0, 3);
    const crop = { x: 0, y: 0, w: 32, h: 16 };
    const normal = window.adjustedImage(original, crop, {}, 32, 16);
    const normalPixel = point(normal);
    const bright = point(window.adjustedImage(original, crop, { brightness: 1.6 }, 32, 16));
    const contrasted = point(window.adjustedImage(original, crop, { contrast: 1.5 }, 32, 16));
    const dark = point(window.adjustedImage(original, crop, { exposure: -1 }, 32, 16));
    const gray = point(window.adjustedImage(original, crop, { saturation: 0 }, 32, 16), 24);
    const blurred = point(window.adjustedImage(original, crop, { blur: 1 }, 32, 16), 15);
    const sharp = point(window.adjustedImage(original, crop, { sharpness: 1 }, 32, 16), 15);
    const cropped = point(window.adjustedImage(original, { x: 16, y: 0, w: 16, h: 16 }, {}, 32, 16));
    return { normalPixel, bright, contrasted, dark, gray, blurred, sharp, cropped, sourceAfter: point(original) };
  });

  assert.deepEqual(result.normalPixel, [100, 100, 100]);
  assert.ok(result.bright[0] > 140, 'brightness changes actual card pixels');
  assert.ok(result.contrasted[0] < 95, 'contrast changes actual card pixels');
  assert.ok(result.dark[0] < 60, 'exposure changes actual card pixels');
  assert.ok(Math.max(...result.gray) - Math.min(...result.gray) < 2, 'saturation removes color');
  assert.ok(result.blurred[0] > 100, 'blur blends the hard image edge');
  assert.ok(result.sharp[0] < 100, 'sharpness accentuates the hard image edge');
  assert.deepEqual(result.cropped, [160, 80, 40]);
  assert.deepEqual(result.sourceAfter, [100, 100, 100], 'source pixels remain untouched');
  console.log('PASS pixel adjustments, true sharpening, blur, crop, original');
} finally {
  await browser.close();
}
