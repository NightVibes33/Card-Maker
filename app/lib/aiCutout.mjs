const MODEL_ID = 'onnx-community/ormbg-ONNX';
const MODEL_REVISION = 'c491647edeccbd2729873e962c5af52aadeb8ffc';

let pipelineLoader = null;
let pipelineDevice = '';

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
    const { pipeline } = await import('@huggingface/transformers');
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

async function readSourceAlpha(blob, width, height) {
  if (/^image\/(jpeg|jpg)$/i.test(blob.type)) return null;
  const scale = Math.min(1, 2048 / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Could not read the selected image alpha.'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas is unavailable for reading the selected image.');
    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    const data = context.getImageData(0, 0, targetWidth, targetHeight).data;
    const alpha = new Uint8ClampedArray(targetWidth * targetHeight);
    for (let index = 0; index < alpha.length; index += 1) {
      alpha[index] = data[index * 4 + 3];
    }
    canvas.width = 1;
    canvas.height = 1;
    return { width: targetWidth, height: targetHeight, alpha };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function matteBlob(output, sourceBlob) {
  const matte = extractMattePixels(output);
  const scale = Math.min(1, 2048 / Math.max(matte.width, matte.height));
  const width = Math.max(1, Math.round(matte.width * scale));
  const height = Math.max(1, Math.round(matte.height * scale));
  const sourceAlpha = await readSourceAlpha(sourceBlob, matte.width, matte.height);
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
      const top = matte.alpha[y0 * matte.width + x0] * (1 - fx) + matte.alpha[y0 * matte.width + x1] * fx;
      const bottom = matte.alpha[y1 * matte.width + x0] * (1 - fx) + matte.alpha[y1 * matte.width + x1] * fx;
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

  const canUseWebGPU = typeof navigator !== 'undefined' && Boolean(navigator.gpu);
  const devices = canUseWebGPU ? ['webgpu', 'wasm'] : ['wasm'];
  let lastError = null;

  for (const device of devices) {
    try {
      onProgress({ status: 'loading', progress: 0, device });
      const segmenter = await getPipeline(device, onProgress);
      onProgress({ status: 'segmenting', progress: 100, device });
      const output = await segmenter(blob);
      if (!Array.isArray(output) || !output[0]) {
        throw new Error('The AI model did not return a cutout.');
      }
      const mask = await matteBlob(output[0], blob);
      onProgress({ status: 'ready', progress: 100, device });
      return mask;
    } catch (error) {
      lastError = error;
      if (device === 'wasm') break;
      // Some browsers expose WebGPU but cannot allocate this model there.
      // Recreate the same small quantized model on WASM as a safe fallback.
      pipelineLoader = null;
      pipelineDevice = '';
    }
  }

  throw lastError || new Error('AI Cutout is unavailable on this device.');
}
