import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function requireMatch(source, pattern, label) {
  if (!pattern.test(source)) {
    throw new Error('Editor contract failed: ' + label);
  }
}

const page = read('app/page.jsx');
const css = read('app/globals.css');
const sw = read('public/sw.js');
const storage = read('app/lib/storage.js');
const imageRoute = read('app/api/image/route.js');
const inspectRoute = read('app/api/cucu/inspect/route.js');

const pageChecks = [
  [/function normalizeDesignState\(/, 'restored designs are normalized'],
  [/if \(!hydrated \|\| !autosaveReady\) return undefined;/, 'autosave waits for safe draft hydration'],
  [/draftReadFailed = true/, 'draft read failures are tracked separately from an empty draft'],
  [/setSaveStatus\('Autosave paused'\)/, 'unsafe draft hydration pauses autosave instead of overwriting storage'],
  [/function pointInRotatedBounds\(/, 'rotated geometry hit testing exists'],
  [/const localPadding = Number\(padding \|\| 0\) \/ safeScale;/, 'transformed hit padding remains scale-independent'],
  [/const hitPadding = Math\.max\(14, \(22 \* OUT_W\) \/ Math\.max\(1, rect\.width\)\);/, 'canvas hit padding tracks a true iPhone-sized touch target'],
  [/function pointInRotatedEllipse\(/, 'ellipse layers use true ellipse hit testing'],
  [/function pointInRotatedRoundedRect\(/, 'rounded shape hit testing follows rendered corners'],
  [/const CONTACTLESS_BOUNDS = \{/, 'contactless selection uses rendered symbol bounds'],
  [/function customLayerSelectionStyle\(/, 'selection outlines use object geometry'],
  [/loadedImageLayerSourceKey === imageLayerSourceKey/, 'image layers are source-key gated'],
  [/loadedBackgroundKey === renderDesign\.background/, 'background rendering is source-key gated'],
  [/label="Corner Radius"/, 'shape corner-radius control exists'],
  [/label="Show Layer"/, 'hidden layers remain recoverable'],
  [/label="Lock Layer"/, 'layer locking control exists'],
  [/Clean Unused Imports/, 'unused import cleanup exists'],
  [/renderAssetsReady/, 'exports are gated on decoded assets'],
  [/if \(!ctx\) \{[\s\S]{0,120}throw new Error\('Canvas rendering is unavailable'\)/, 'export canvas allocation fails closed'],
  [/historyGroupRef/, 'continuous edits use grouped undo history'],
  [/gestureStartDesign\.current = designRef\.current/, 'gestures snapshot authoritative state'],
  [/if \(pointers\.current\.size >= 2\) return;/, 'gesture tracking ignores accidental third touches'],
  [/function textLayerLines\(/, 'multiline text is modeled explicitly'],
  [/label="Line Height"/, 'multiline text has line-height controls'],
  [/<textarea[\s\S]*aria-label="Layer text"/, 'text layers use a multiline editor'],
  [/designRef\.current === startupDesign/, 'startup hydration does not overwrite newer edits'],
  [/for \(let attempt = 0; attempt < 3; attempt \+= 1\)/, 'service-worker reload retries until the latest draft is stable'],
  [/if \(designRef\.current !== snapshot\)/, 'service-worker reload refuses to discard edits made during persistence'],
  [/let hasServiceWorkerController = Boolean\(navigator\.serviceWorker\.controller\)/, 'service-worker distinguishes first claim from an update'],
  [/if \(!hasServiceWorkerController\)/, 'first service-worker claim does not force an app reload'],
  [/Layer limit reached\. Delete a layer before adding another\./, 'custom layer adds enforce the layer cap'],
  [/visibleImageIdsTopDown\.length > MAX_VISIBLE_IMAGE_LAYERS/, 'older designs normalize overflow image layers instead of failing hydration'],
  [/visibleImageIdsTopDown\.slice\(0, MAX_VISIBLE_IMAGE_LAYERS\)/, 'overflow normalization preserves topmost visible image layers'],
  [/setSelectedElement\('artwork'\);[\s\S]{0,220}setStudioTool\('crop'\)/, 'Library artwork selection targets the background before crop editing'],
  [/for \(const snapshot of undoRef\.current\) addDesignRefs\(snapshot\)/, 'import cleanup preserves undo history assets'],
  [/for \(const snapshot of redoRef\.current\) addDesignRefs\(snapshot\)/, 'import cleanup preserves redo history assets'],
  [/storedImports = await dbGetImportMetadata\(\)/, 'import cleanup verifies authoritative IndexedDB metadata'],
  [/for \(const layer of currentDesign\.customLayers \|\| \[\]\)/, 'project saving scans custom layers for remote artwork'],
  [/some remote art is not cached offline/, 'project saving reports incomplete offline artwork caching'],
  [/const referencedPresetAssetIds = new Set\(\)/, 'preset import tracks only referenced embedded assets'],
  [/Preset is missing a referenced image asset/, 'preset import rejects missing referenced image blobs'],
  [/Undo returns to your previous card/, 'opening a saved project remains reversible'],
  [/const MAX_VISIBLE_IMAGE_LAYERS = 12;/, 'visible image layers have an iPhone memory cap'],
  [/favoriteOpsRef\.current\.has\(itemId\)/, 'favorite writes are serialized per card'],
  [/projectSaveInFlightRef\.current/, 'project saves reject overlapping double taps'],
  [/presetTransferInFlightRef\.current/, 'preset import and export operations are serialized'],
  [/function fillGrain\(/, 'grain rendering uses a cached pattern instead of per-frame dot loops'],
  [/imageLayers\.length > MAX_VISIBLE_IMAGE_LAYERS/, 'image hydration refuses unsafe visible-image counts'],
  [/visibleImageLayers\(designRef\.current\)\.length >= MAX_VISIBLE_IMAGE_LAYERS/, 'image-layer creation enforces the visible-image cap'],
  [/draftSaveQueueRef\.current/, 'draft writes are serialized through one persistence queue'],
  [/aircard-sticker-fvp-v3-updated-at/, 'local draft fallback records a comparable timestamp'],
  [/localUpdatedAt > indexedUpdatedAt/, 'startup restores the newest durable draft copy'],
  [/const next = normalizeDesignState\(DEFAULTS\)/, 'New Card replaces state with a normalized clean design'],
  [/setMessage\(changed \? 'New card · Undo is available' : 'New card is already empty'\)/, 'New Card is undoable without creating fake no-op history']
];

for (const [pattern, label] of pageChecks) requireMatch(page, pattern, label);

requireMatch(page, /onChange=\{emit\}/, 'range sliders use React controlled onChange');
requireMatch(page, /type=\{Number\(min\) < 0 \? 'text' : 'number'\}/, 'signed Expert Mode fields remain typeable on iPhone');
if (/onInput=\{emit\}/.test(page)) {
  throw new Error('Editor contract failed: range sliders must not use raw onInput');
}
if (/for \(let i = 0; i < (?:3600|900); i \+= 1\)/.test(page)) {
  throw new Error('Editor contract failed: grain must not use per-frame thousands-of-rectangles loops');
}

const touchChecks = [
  [/\.studioToolBar button\{[^}]*min-height:44px/s, 'Studio tool buttons'],
  [/\.previewModeToggle button\{[^}]*min-height:44px/s, 'Preview mode buttons'],
  [/\.historyButtons button,.beforeAfterButton\{[^}]*min-height:44px/s, 'History and compare buttons'],
  [/\.layerAddRow button,.layerActionGrid button\{[^}]*min-height:44px/s, 'Layer action buttons'],
  [/\.textAlignRow button\{[^}]*min-height:44px/s, 'Text alignment buttons'],
  [/\.doneSelectionButton\{[^}]*min-height:44px/s, 'Done selection button'],
  [/\.sliderRow input\{[^}]*min-height:44px/s, 'Range slider touch surface']
];

for (const [pattern, label] of touchChecks) {
  requireMatch(css, pattern, label + ' keep a 44px minimum touch height');
}

requireMatch(sw, /\[ART_CACHE\]:\s*40/, 'full artwork cache is bounded');
requireMatch(sw, /\[THUMB_CACHE\]:\s*160/, 'thumbnail cache is bounded separately');
requireMatch(sw, /async function trimCache\(/, 'service-worker cache eviction exists');
requireMatch(sw, /const SHELL = \['\/', '\/manifest\.webmanifest'\];/, 'app root is precached for first offline launch');
requireMatch(sw, /const OWNED_CACHE_PREFIX = 'card-studio-';/, 'service-worker cleanup is scoped to Card Studio caches');
requireMatch(sw, /key\.startsWith\(OWNED_CACHE_PREFIX\)/, 'service-worker leaves unrelated origin caches untouched');
requireMatch(sw, /url\.pathname === '\/manifest\.webmanifest'/, 'PWA manifest is served from the shell cache while offline');
requireMatch(sw, /if \(response\.status >= 500\)/, 'navigation falls back to cached shell on transient server failures');
requireMatch(sw, /requestedWidth > 0 && requestedWidth <= 800/, 'thumbnail cache routing is width-bounded');
requireMatch(page, /proxyImageWidth\(item\.image, 3072\)/, 'editor artwork uses a bounded high-resolution working copy');

requireMatch(storage, /const DB_VERSION = 2;/, 'IndexedDB schema includes import metadata migration');
requireMatch(storage, /'importMeta'/, 'import metadata store exists');
requireMatch(storage, /export async function dbGetImportMetadata\(/, 'metadata-only import listing exists');
requireMatch(page, /dbGetImportMetadata\(\)/, 'Library hydrates import metadata instead of blobs');
requireMatch(page, /const MAX_STORED_IMAGE_PIXELS = 12_000_000;/, 'local image working-set pixels are bounded');
requireMatch(page, /const MAX_STORED_IMAGE_DIMENSION = 4096;/, 'local image working-set dimensions are bounded');
requireMatch(page, /const MAX_STORED_LAYER_IMAGE_PIXELS = 4_000_000;/, 'custom image-layer working-set pixels are bounded separately');
requireMatch(page, /const MAX_STORED_LAYER_IMAGE_DIMENSION = 2560;/, 'custom image-layer dimensions are bounded separately');
requireMatch(page, /const MAX_PRESET_ASSETS = MAX_CUSTOM_LAYERS \+ 1;/, 'preset asset capacity covers every custom layer plus the imported background');
requireMatch(page, /async function prepareLocalImageBlob\(/, 'oversized local images are downsampled before persistence');
requireMatch(page, /maxPixels: MAX_STORED_LAYER_IMAGE_PIXELS/, 'custom image-layer imports use the smaller working set');
requireMatch(page, /source\.startsWith\('\/api\/image\?'\) \|\| \^https:/, 'restored proxied artwork is normalized back to working resolution');
requireMatch(page, /parsed\.background = normalizePersistedArtworkSource\(parsed\.background, 3072\)/, 'legacy draft artwork is upgraded instead of cleared');
requireMatch(page, /imported\.background = normalizePersistedArtworkSource\(imported\.background, 3072\)/, 'legacy preset background artwork is upgraded instead of cleared');
requireMatch(page, /src: normalizePersistedArtworkSource\(src, MAX_STORED_LAYER_IMAGE_DIMENSION\)/, 'legacy preset image layers are upgraded instead of cleared');
requireMatch(page, /const decodedBySource = new Map\(\);/, 'duplicate image layers share decoded sources');
requireMatch(page, /const animatedOrVectorSource =/, 'animated and vector imports are normalized');
requireMatch(page, /gif\|apng\|svg\\\+xml/, 'APNG, GIF, and SVG imports use deterministic rasterization');
requireMatch(page, /const encodeCanvas = \(type, quality\)/, 'image optimization has an encoder fallback path');
requireMatch(page, /optimizedBlob\.size > MAX_IMAGE_IMPORT_BYTES/, 'optimized image blobs cannot exceed the import storage ceiling');
if (/dbGetAll\('imports'\)/.test(page)) {
  throw new Error('Editor contract failed: Library must not hydrate full import blobs into React state');
}

console.log('PASS editor regression contract');


requireMatch(imageRoute, /Math\.min\(3072, Math\.floor\(requestedWidth\)\)/, 'image proxy bounds working artwork width');

const proxySecurityChecks = [
  [imageRoute, /redirect:\s*'manual'/, 'image proxy validates redirects before following them'],
  [imageRoute, /SAFE_IMAGE_TYPES/, 'image proxy rejects unsafe image formats'],
  [imageRoute, /readLimitedBody\(/, 'image proxy stream-limits response bodies'],
  [imageRoute, /import sharp from 'sharp'/, 'image proxy can resize non-CDN artwork server-side'],
  [imageRoute, /limitInputPixels: MAX_DECODED_IMAGE_PIXELS/, 'proxy decoding has a pixel safety bound'],
  [imageRoute, /\.resize\(\{[\s\S]*width,[\s\S]*withoutEnlargement: true/s, 'proxy width requests are enforced server-side when needed'],
  [imageRoute, /responseType = 'image\/webp'/, 'normalized proxy images return a deterministic web format'],
  [inspectRoute, /redirect:\s*'manual'/, 'artwork inspector validates redirects before following them'],
  [inspectRoute, /SAFE_IMAGE_TYPES/, 'artwork inspector rejects unsafe image formats'],
  [inspectRoute, /readLimitedBody\(/, 'artwork inspector stream-limits response bodies']
];

for (const [source, pattern, label] of proxySecurityChecks) {
  requireMatch(source, pattern, label);
}
