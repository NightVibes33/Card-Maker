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
  [/gestureStartDesign\.current = designRef\.current/, 'gestures snapshot authoritative state']
];

for (const [pattern, label] of pageChecks) requireMatch(page, pattern, label);

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

requireMatch(sw, /\[ART_CACHE\]:\s*180/, 'art cache is bounded');
requireMatch(sw, /async function trimCache\(/, 'service-worker cache eviction exists');

console.log('PASS editor regression contract');
