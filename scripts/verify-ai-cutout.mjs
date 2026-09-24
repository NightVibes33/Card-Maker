import assert from 'node:assert/strict';
import { extractMattePixels } from '../app/lib/aiCutout.mjs';

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

console.log('AI cutout contract PASS: preserves soft alpha edges and rejects unusable masks');
