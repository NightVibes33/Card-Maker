import assert from 'node:assert/strict';
import { extractMattePixels, fitCutoutDimensions, isAppleMobileBrowser } from '../app/lib/aiCutout.mjs';

assert.deepEqual(fitCutoutDimensions(4032, 3024), { width: 2048, height: 1536 });
assert.deepEqual(fitCutoutDimensions(1600, 900), { width: 1600, height: 900 });
assert.throws(() => fitCutoutDimensions(0, 100), /invalid dimensions/);
assert.equal(
  isAppleMobileBrowser({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    maxTouchPoints: 5
  }),
  true,
  'iPhone Safari selects the supported WASM execution path'
);
assert.equal(
  isAppleMobileBrowser({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/128.0', platform: 'Linux x86_64' }),
  false,
  'desktop browsers remain eligible for WebGPU'
);
assert.equal(
  isAppleMobileBrowser({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 }),
  true,
  'iPadOS desktop mode is treated as Apple mobile'
);

const input = {
  width: 2,
  height: 2,
  channels: 4,
  data: new Uint8ClampedArray([
    20, 30, 40, 0,
    50, 60, 70, 64,
    80, 90, 100, 192,
    110, 120, 130, 255
  ])
};

const matte = extractMattePixels(input);
assert.equal(matte.width, 2);
assert.equal(matte.height, 2);
assert.deepEqual([...matte.alpha], [0, 64, 192, 255]);
assert.deepEqual(
  [...input.data].filter((_, index) => index % 4 === 3),
  [0, 64, 192, 255]
);

assert.throws(
  () => extractMattePixels({
    width: 2,
    height: 2,
    channels: 4,
    data: new Uint8ClampedArray(16).fill(255)
  }),
  /clear foreground/
);
assert.throws(
  () => extractMattePixels({ width: 1, height: 1, channels: 3, data: new Uint8ClampedArray(3) }),
  /unsupported cutout mask/
);

console.log('AI cutout contract PASS: preserves soft alpha, bounds iPhone inputs, and rejects unusable masks');
