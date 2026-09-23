// Canvas 2D filters are disabled by default in Safari. Process the image
// pixels once per source/crop/settings combination before drawing the card.
const processedCache = [];

const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));

function boxBlur(pixels, width, height, radius) {
  if (radius < 1) return pixels;
  const horizontal = new Uint8ClampedArray(pixels.length);
  const result = new Uint8ClampedArray(pixels.length);
  const windowSize = radius * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    const sums = [0, 0, 0, 0];
    for (let offset = -radius; offset <= radius; offset += 1) {
      const index = (y * width + Math.max(0, Math.min(width - 1, offset))) * 4;
      for (let c = 0; c < 4; c += 1) sums[c] += pixels[index + c];
    }
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      for (let c = 0; c < 4; c += 1) horizontal[index + c] = sums[c] / windowSize;
      const remove = (y * width + Math.max(0, x - radius)) * 4;
      const add = (y * width + Math.min(width - 1, x + radius + 1)) * 4;
      for (let c = 0; c < 4; c += 1) sums[c] += pixels[add + c] - pixels[remove + c];
    }
  }

  for (let x = 0; x < width; x += 1) {
    const sums = [0, 0, 0, 0];
    for (let offset = -radius; offset <= radius; offset += 1) {
      const index = (Math.max(0, Math.min(height - 1, offset)) * width + x) * 4;
      for (let c = 0; c < 4; c += 1) sums[c] += horizontal[index + c];
    }
    for (let y = 0; y < height; y += 1) {
      const index = (y * width + x) * 4;
      for (let c = 0; c < 4; c += 1) result[index + c] = sums[c] / windowSize;
      const remove = (Math.max(0, y - radius) * width + x) * 4;
      const add = (Math.min(height - 1, y + radius + 1) * width + x) * 4;
      for (let c = 0; c < 4; c += 1) sums[c] += horizontal[add + c] - horizontal[remove + c];
    }
  }
  return result;
}

export function adjustedImage(source, crop, settings, desiredWidth, desiredHeight, blurScale = 1) {
  const sx = crop?.x || 0;
  const sy = crop?.y || 0;
  const sw = crop?.w || source.width;
  const sh = crop?.h || source.height;
  const width = Math.max(1, Math.min(2048, Math.round(desiredWidth)));
  const height = Math.max(1, Math.min(2048, Math.round(desiredHeight)));
  const brightness = Number(settings.brightness ?? 1) * Math.pow(2, Number(settings.exposure ?? 0));
  const contrast = Number(settings.contrast ?? 1);
  const saturation = Number(settings.saturation ?? 1);
  const sharpness = Number(settings.sharpness ?? 0);
  const blur = Number(settings.blur ?? 0);
  const key = JSON.stringify([sx, sy, sw, sh, width, height, brightness, contrast, saturation, sharpness, blur, blurScale]);
  const cachedIndex = processedCache.findIndex((entry) => entry.source === source && entry.key === key);
  if (cachedIndex >= 0) {
    const [entry] = processedCache.splice(cachedIndex, 1);
    processedCache.push(entry);
    return entry.canvas;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Image adjustments are unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);

  if (brightness !== 1 || contrast !== 1 || saturation !== 1 || sharpness !== 0 || blur !== 0) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const pixels = imageData.data;
    if (brightness !== 1 || contrast !== 1 || saturation !== 1) {
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i] * brightness;
        const g = pixels[i + 1] * brightness;
        const b = pixels[i + 2] * brightness;
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        pixels[i] = clampByte((luminance + (r - luminance) * saturation - 127.5) * contrast + 127.5);
        pixels[i + 1] = clampByte((luminance + (g - luminance) * saturation - 127.5) * contrast + 127.5);
        pixels[i + 2] = clampByte((luminance + (b - luminance) * saturation - 127.5) * contrast + 127.5);
      }
    }

    const radius = Math.min(20, Math.round((blur + Math.max(0, -sharpness) * 0.09) * 7 * blurScale));
    const softened = boxBlur(pixels, width, height, radius);
    if (sharpness > 0) {
      const blurred = boxBlur(softened, width, height, 1);
      for (let i = 0; i < pixels.length; i += 4) {
        for (let c = 0; c < 3; c += 1) {
          pixels[i + c] = clampByte(softened[i + c] + (softened[i + c] - blurred[i + c]) * sharpness * 2);
        }
      }
    } else if (softened !== pixels) pixels.set(softened);
    ctx.putImageData(imageData, 0, 0);
  }

  processedCache.push({ source, key, canvas });
  if (processedCache.length > 3) processedCache.shift();
  return canvas;
}
