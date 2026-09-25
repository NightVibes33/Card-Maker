const MODEL_ID = 'onnx-community/ormbg-ONNX';
// Pin to a repository revision containing the processor configs as well as the
// ONNX weights. c491647 was only the weight-upload commit and 404s on
// preprocessor_config.json when Transformers.js initializes the pipeline.
const MODEL_REVISION = '034e2d884afbab897e10e78fc5bb566b29533fd6';
const MAX_CUTOUT_EDGE = 2048;

let pipelineLoader = null;
let pipelineDevice = '';

function ensureCanvasCompatibility() {
  if (typeof document === 'undefined' || typeof globalThis.OffscreenCanvas !== 'undefined') return;

  // Transformers.js uses OffscreenCanvas for image resizing. Safari versions
  // without it can still process a regular canvas, so provide that same small
  // canvas surface before loading the library.
  globalThis.OffscreenCanvas = class CanvasBackedOffscreenCanvas {
    constructor(width, height) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
  };
}

export function isAppleMobileBrowser(navigatorLike = globalThis.navigator) {
  const userAgent = String(navigatorLike?.userAgent || '');
  const platform = String(navigatorLike?.platform || '');
  const touchPoints = Number(navigatorLike?.maxTouchPoints || 0);
  return /iPhone|iPad|iPod/i.test(userAgent) || (/MacIntel/i.test(platform) && touchPoints > 1);
}

async function prepareModelInput(blob) {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('This image format could not be opened for AI Cutout on this browser.'));
      image.src = url;
    });

    const naturalWidth = Number(image.naturalWidth || image.width || 0);
    const naturalHeight = Number(image.naturalHeight || image.height || 0);
    if (!naturalWidth || !naturalHeight) {
      throw new Error('This image has no readable pixels for AI Cutout.');
    }

    const { width, height } = fitCutoutDimensions(naturalWidth, naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas is unavailable for AI Cutout on this browser.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function fitCutoutDimensions(width, height, maxEdge = MAX_CUTOUT_EDGE) {
  const sourceWidth = Number(width);
  const sourceHeight = Number(height);
  const edgeLimit = Number(maxEdge);
  if (
    !Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) ||
    !Number.isFinite(edgeLimit) || sourceWidth < 1 || sourceHeight < 1 || edgeLimit < 1
  ) {
    throw new Error('The selected image has invalid dimensions for AI Cutout.');
  }
  const scale = Math.min(1, edgeLimit / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale))
  };
}

function otsuThreshold(alpha) {
  const histogram = new Uint32Array(256);
  let totalSum = 0;
  for (const value of alpha) {
    histogram[value] += 1;
    totalSum += value;
  }

  const total = alpha.length;
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 0;
  for (let value = 0; value < 255; value += 1) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (totalSum - backgroundSum) / foregroundWeight;
    const weight = backgroundWeight / total;
    const variance = weight * (1 - weight) * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = value;
    }
  }
  return threshold;
}

export function refineMatteAlpha(alpha) {
  if (!(alpha instanceof Uint8Array || alpha instanceof Uint8ClampedArray) || !alpha.length) {
    throw new Error('The AI model returned an invalid cutout mask.');
  }

  const threshold = otsuThreshold(alpha);
  // A threshold near either extreme means the model already returned a clean,
  // high-contrast cutout. Leave its antialiased edge pixels untouched.
  if (threshold <= 12 || threshold >= 243) return new Uint8ClampedArray(alpha);

  // ORMBG can return a very low-contrast matte on artwork. Push uncertain
  // background pixels toward transparent and confident subject pixels toward
  // opaque, while retaining a narrow smooth transition for hair and edges.
  const low = Math.max(0, threshold - 8);
  const high = Math.min(255, threshold + 48);
  const span = Math.max(1, high - low);
  const refined = new Uint8ClampedArray(alpha.length);
  for (let index = 0; index < alpha.length; index += 1) {
    const value = Math.max(0, Math.min(1, (alpha[index] - low) / span));
    refined[index] = Math.round(value * value * (3 - 2 * value) * 255);
  }
  return refined;
}

export function extractMattePixels(output) {
  const width = Number(output?.width || 0);
  const height = Number(output?.height || 0);
  const channels = Number(output?.channels || 0);
  const source = output?.data;
  if (
    !Number.isInteger(width) || !Number.isInteger(height) ||
    width < 1 || height < 1 || width * height > 12_000_000 ||
    channels !== 4 || !source || source.length !== width * height * 4
  ) {
    throw new Error('The AI model returned an unsupported cutout mask.');
  }

  const alpha = new Uint8ClampedArray(width * height);
  let minimum = 255;
  let maximum = 0;
  let visible = 0;
  for (let index = 0; index < width * height; index += 1) {
    const value = source[index * 4 + 3];
    alpha[index] = value;
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
    if (value > 127) visible += 1;
  }

  if (maximum - minimum < 8 || visible === 0 || visible === width * height) {
    throw new Error('The AI could not find a clear foreground in this image.');
  }
  return { width, height, alpha };
}

async function getPipeline(device, progressCallback) {
  if (pipelineLoader && pipelineDevice === device) return pipelineLoader;

  pipelineDevice = device;
  pipelineLoader = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    if (device === 'wasm' && isAppleMobileBrowser()) {
      // iOS browsers use WebKit and ONNX Runtime's WebGPU execution provider
      // is not supported there. Keep inference on the supported single-thread
      // WASM path, even if Safari exposes navigator.gpu.
      env.backends.onnx.wasm.numThreads = 1;
    }
    return pipeline('background-removal', MODEL_ID, {
      revision: MODEL_REVISION,
      device,
      dtype: device === 'webgpu' ? 'fp16' : 'q8',
      progress_callback: progressCallback
    });
  })();

  try {
    return await pipelineLoader;
  } catch (error) {
    pipelineLoader = null;
    pipelineDevice = '';
    throw error;
  }
}

function readSourceAlpha(canvas, width, height) {
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is unavailable for reading the selected image alpha.');
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const alpha = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(canvas.height - 1, Math.floor((y + 0.5) * canvas.height / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(canvas.width - 1, Math.floor((x + 0.5) * canvas.width / width));
      alpha[y * width + x] = data[(sourceY * canvas.width + sourceX) * 4 + 3];
    }
  }
  return { width, height, alpha };
}

async function matteBlob(output, sourceCanvas) {
  const matte = extractMattePixels(output);
  const refinedAlpha = refineMatteAlpha(matte.alpha);
  const scale = Math.min(1, 2048 / Math.max(matte.width, matte.height));
  const width = Math.max(1, Math.round(matte.width * scale));
  const height = Math.max(1, Math.round(matte.height * scale));
  const sourceAlpha = readSourceAlpha(sourceCanvas, matte.width, matte.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: false });
  if (!context) throw new Error('Canvas is unavailable for saving the AI mask.');
  const imageData = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.max(0, Math.min(matte.height - 1, (y + 0.5) * matte.height / height - 0.5));
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(matte.height - 1, y0 + 1);
    const fy = sourceY - y0;
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.max(0, Math.min(matte.width - 1, (x + 0.5) * matte.width / width - 0.5));
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(matte.width - 1, x0 + 1);
      const fx = sourceX - x0;
      const top = refinedAlpha[y0 * matte.width + x0] * (1 - fx) + refinedAlpha[y0 * matte.width + x1] * fx;
      const bottom = refinedAlpha[y1 * matte.width + x0] * (1 - fx) + refinedAlpha[y1 * matte.width + x1] * fx;
      const offset = (y * width + x) * 4;
      imageData.data[offset] = 255;
      imageData.data[offset + 1] = 255;
      imageData.data[offset + 2] = 255;
      const modelAlpha = top * (1 - fy) + bottom * fy;
      const sourceAlphaValue = sourceAlpha
        ? sourceAlpha.alpha[y * sourceAlpha.width + x] / 255
        : 1;
      imageData.data[offset + 3] = modelAlpha * sourceAlphaValue;
    }
  }
  context.putImageData(imageData, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      canvas.width = 1;
      canvas.height = 1;
      if (!blob) reject(new Error('Could not save the AI cutout mask.'));
      else resolve(blob);
    }, 'image/png');
  });
}

export async function createAICutoutMask(blob, onProgress = () => {}) {
  if (!(blob instanceof Blob) || !blob.type.startsWith('image/')) {
    throw new Error('Choose an image before using AI Cutout.');
  }

  ensureCanvasCompatibility();
  const modelInput = await prepareModelInput(blob);
  let canUseWebGPU = false;
  const currentNavigator = typeof navigator !== 'undefined' ? navigator : null;
  if (!isAppleMobileBrowser(currentNavigator)) {
    try {
      const adapter = currentNavigator?.gpu
        ? await currentNavigator.gpu.requestAdapter()
        : null;
      canUseWebGPU = Boolean(adapter?.features?.has('shader-f16'));
    } catch {
      canUseWebGPU = false;
    }
  }
  const devices = canUseWebGPU ? ['webgpu', 'wasm'] : ['wasm'];
  let lastError = null;

  try {
    for (const device of devices) {
      try {
        onProgress({ status: 'loading', progress: 0, device });
        const segmenter = await getPipeline(device, onProgress);
        onProgress({ status: 'segmenting', progress: 100, device });
        const output = await segmenter(modelInput);
        if (!Array.isArray(output) || !output[0]) {
          throw new Error('The AI model did not return a cutout.');
        }
        const mask = await matteBlob(output[0], modelInput);
        onProgress({ status: 'ready', progress: 100, device });
        return mask;
      } catch (error) {
        lastError = error;
        if (device === 'wasm') break;
        // Some browsers expose WebGPU but cannot allocate this model there.
        // Recreate the same quantized model on WASM as a safe fallback.
        pipelineLoader = null;
        pipelineDevice = '';
      }
    }
  } finally {
    modelInput.width = 1;
    modelInput.height = 1;
  }

  throw lastError || new Error('AI Cutout is unavailable on this device.');
}
