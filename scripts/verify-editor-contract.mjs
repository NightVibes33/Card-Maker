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
  [/loadedBackgroundKey === design\.background/, 'background rendering is source-key gated'],
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
  [/for \(const snapshot of redoRef\.current\) addDesignRefs\(snapshot\)/, 'import cleanup preserves redo history assets']
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
requireMatch(storage, /const DB_VERSION = 2;/, 'IndexedDB schema includes import metadata migration');
requireMatch(storage, /'importMeta'/, 'import metadata store exists');
requireMatch(storage, /export async function dbGetImportMetadata\(/, 'metadata-only import listing exists');
requireMatch(page, /dbGetImportMetadata\(\)/, 'Library hydrates import metadata instead of blobs');
requireMatch(page, /const MAX_STORED_IMAGE_PIXELS = 12_000_000;/, 'local image working-set pixels are bounded');
requireMatch(page, /const MAX_STORED_IMAGE_DIMENSION = 4096;/, 'local image working-set dimensions are bounded');
requireMatch(page, /async function prepareLocalImageBlob\(/, 'oversized local images are downsampled before persistence');
if (/dbGetAll\('imports'\)/.test(page)) {
  throw new Error('Editor contract failed: Library must not hydrate full import blobs into React state');
}

console.log('PASS editor regression contract');


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
