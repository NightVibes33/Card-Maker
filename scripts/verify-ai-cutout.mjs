import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractMattePixels, fitCutoutDimensions, isAppleMobileBrowser, refineMatteAlpha } from '../app/lib/aiCutout.mjs';

const cutoutSource = readFileSync(new URL('../app/lib/aiCutout.mjs', import.meta.url), 'utf8');
assert.match(
  cutoutSource,
  /const MODEL_REVISION = '034e2d884afbab897e10e78fc5bb566b29533fd6'/,
  'AI cutout pins the model revision that includes preprocessor_config.json'
);

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

const lowContrastMatte = new Uint8ClampedArray([
  ...Array(40).fill(90),
  ...Array(40).fill(190),
  ...Array(6).fill(110),
  ...Array(6).fill(120),
  ...Array(6).fill(130),
  ...Array(6).fill(140),
  ...Array(6).fill(150),
  ...Array(6).fill(160)
]);
const sharpenedMatte = refineMatteAlpha(lowContrastMatte);
assert.ok(sharpenedMatte[0] <= 8, 'low-confidence background pixels are made transparent');
assert.ok(sharpenedMatte[40] >= 247, 'confident subject pixels are made opaque');
const edgeIndex = lowContrastMatte.indexOf(150);
assert.ok(sharpenedMatte[edgeIndex] > 32 && sharpenedMatte[edgeIndex] < 224, 'edge pixels retain a smooth alpha transition');

const cleanMatte = new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 255]);
assert.deepEqual([...refineMatteAlpha(cleanMatte)], [...cleanMatte], 'already crisp mattes are left unchanged');

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
