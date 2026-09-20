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
  [/if \(!hydrated\) return undefined;/, 'autosave waits for hydration'],
  [/function pointInRotatedBounds\(/, 'rotated geometry hit testing exists'],
  [/function customLayerSelectionStyle\(/, 'selection outlines use object geometry'],
  [/loadedImageLayerSourceKey === imageLayerSourceKey/, 'image layers are source-key gated'],
  [/loadedBackgroundKey === renderDesign\.background/, 'background rendering is source-key gated'],
  [/label="Corner Radius"/, 'shape corner-radius control exists'],
  [/label="Show Layer"/, 'hidden layers remain recoverable'],
  [/label="Lock Layer"/, 'layer locking control exists'],
  [/Clean Unused Imports/, 'unused import cleanup exists'],
  [/renderAssetsReady/, 'exports are gated on decoded assets'],
  [/historyGroupRef/, 'continuous edits use grouped undo history'],
  [/gestureStartDesign\.current = designRef\.current/, 'gestures snapshot authoritative state'],
  [/function textLayerLines\(/, 'multiline text is modeled explicitly'],
  [/label="Line Height"/, 'multiline text has line-height controls'],
  [/<textarea[\s\S]*aria-label="Layer text"/, 'text layers use a multiline editor'],
  [/designRef\.current === startupDesign/, 'startup hydration does not overwrite newer edits'],
  [/Layer limit reached\. Delete a layer before adding another\./, 'custom layer adds enforce the layer cap'],
  [/setSelectedElement\('artwork'\);[\s\S]{0,220}setStudioTool\('crop'\)/, 'Library artwork selection targets the background before crop editing'],
  [/for \(const snapshot of undoRef\.current\) addDesignRefs\(snapshot\)/, 'import cleanup preserves undo history assets'],
  [/for \(const snapshot of redoRef\.current\) addDesignRefs\(snapshot\)/, 'import cleanup preserves redo history assets'],
  [/const MAX_VISIBLE_IMAGE_LAYERS = 12;/, 'visible image layers have an iPhone memory cap'],
  [/imageLayers\.length > MAX_VISIBLE_IMAGE_LAYERS/, 'image hydration refuses unsafe visible-image counts'],
  [/visibleImageLayers\(designRef\.current\)\.length >= MAX_VISIBLE_IMAGE_LAYERS/, 'image-layer creation enforces the visible-image cap'],
  [/draftSaveQueueRef\.current/, 'draft writes are serialized through one persistence queue'],
  [/aircard-sticker-fvp-v3-updated-at/, 'local draft fallback records a comparable timestamp'],
  [/localUpdatedAt > indexedUpdatedAt/, 'startup restores the newest durable draft copy']
];

for (const [pattern, label] of pageChecks) requireMatch(page, pattern, label);

requireMatch(page, /onChange=\{emit\}/, 'range sliders use React controlled onChange');
if (/onInput=\{emit\}/.test(page)) {
  throw new Error('Editor contract failed: range sliders must not use raw onInput');
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
requireMatch(sw, /const OWNED_CACHE_PREFIX = 'card-studio-';/, 'service-worker cleanup is scoped to Card Studio caches');
requireMatch(sw, /key\.startsWith\(OWNED_CACHE_PREFIX\)/, 'service-worker leaves unrelated origin caches untouched');
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
requireMatch(page, /async function prepareLocalImageBlob\(/, 'oversized local images are downsampled before persistence');
requireMatch(page, /maxPixels: MAX_STORED_LAYER_IMAGE_PIXELS/, 'custom image-layer imports use the smaller working set');
if (/dbGetAll\('imports'\)/.test(page)) {
  throw new Error('Editor contract failed: Library must not hydrate full import blobs into React state');
}

console.log('PASS editor regression contract');


requireMatch(imageRoute, /Math\.min\(3072, Math\.floor\(requestedWidth\)\)/, 'image proxy bounds working artwork width');

const proxySecurityChecks = [
  [imageRoute, /redirect:\s*'manual'/, 'image proxy validates redirects before following them'],
  [imageRoute, /SAFE_IMAGE_TYPES/, 'image proxy rejects unsafe image formats'],
  [imageRoute, /readLimitedBody\(/, 'image proxy stream-limits response bodies'],
  [inspectRoute, /redirect:\s*'manual'/, 'artwork inspector validates redirects before following them'],
  [inspectRoute, /SAFE_IMAGE_TYPES/, 'artwork inspector rejects unsafe image formats'],
  [inspectRoute, /readLimitedBody\(/, 'artwork inspector stream-limits response bodies']
];

for (const [source, pattern, label] of proxySecurityChecks) {
  requireMatch(source, pattern, label);
}
