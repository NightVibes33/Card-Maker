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
const imagePolicy = read('app/lib/imagePolicy.js');

const pageChecks = [
  [/function normalizeDesignState\(/, 'restored designs are normalized'],
  [/function normalizeImportArtworkSource\(/, 'persisted import artwork IDs are validated canonically'],
  [/rawUrl\.length > 2200/, 'persisted proxy targets are length bounded'],
  [/const normalized = new URLSearchParams\(\)/, 'persisted proxy URLs are rebuilt from supported parameters only'],
  [/if \(!source\.startsWith\('\/api\/image\?'\)\) return '';/, 'unknown artwork schemes and paths fail closed'],
  [/This artwork source is unavailable or unsupported\./, 'invalid catalog artwork never enters editor state'],
  [/if \(!hydrated \|\| !autosaveReady\) return undefined;/, 'autosave waits for safe draft hydration'],
  [/draftReadFailed = true/, 'draft read failures are tracked separately from an empty draft'],
  [/autosaveSafe = !draftReadFailed;/, 'draft read failures keep autosave paused even when a fallback exists'],
  [/setSaveStatus\('Autosave paused'\)/, 'unsafe draft hydration pauses IndexedDB autosave instead of overwriting storage'],
  [/const autosavePausedBaselineRef = useRef\(null\)/, 'paused autosave tracks the exact hydrated baseline'],
  [/if \(!hydrated \|\| autosaveReady\) return undefined;/, 'paused autosave has a local-recovery-only path'],
  [/if \(!autosaveReady && autosavePausedBaselineRef\.current === designRef\.current\)/, 'paused pagehide flush never overwrites recovery storage before a real edit'],
  [/function pointInRotatedBounds\(/, 'rotated geometry hit testing exists'],
  [/Math\.abs\(normalized\.w - 1\) < 1e-9[\s\S]{0,120}return null;/, 'full-frame crops normalize back to no-op state'],
  [/try \{[\s\S]{0,100}setPointerCapture\(event\.pointerId\);[\s\S]{0,50}\} catch \{\}/, 'mobile pointer capture failures are non-fatal'],
  [/function normalizeFreeRotation\(/, 'free rotations wrap smoothly through the ±180° boundary'],
  [/const nextRotation = normalizeFreeRotation\([\s\S]{0,420}contactlessRotation: nextRotation/, 'contactless gesture rotation wraps instead of sticking at 180°'],
  [/const nextRotation = normalizeFreeRotation\(currentRotation \+ angleDelta\)[\s\S]{0,1800}rotation: nextRotation/, 'custom layer gesture rotation wraps instead of sticking at 180°'],
  [/target === 'artwork'[\s\S]{0,420}const nextRotation = normalizeFreeRotation\(currentRotation \+ angleDelta\)[\s\S]{0,420}patch\(\{ zoom: nextZoom, rotate: nextRotation \}, false\)/, 'artwork gesture rotation wraps instead of sticking at 180°'],
  [/const localPadding = Number\(padding \|\| 0\) \/ safeScale;/, 'transformed hit padding remains scale-independent'],
  [/const hitPadding = Math\.max\(14, \(22 \* OUT_W\) \/ Math\.max\(1, rect\.width\)\);/, 'canvas hit padding tracks a true iPhone-sized touch target'],
  [/function pointInRotatedEllipse\(/, 'ellipse layers use true ellipse hit testing'],
  [/function pointInRotatedRoundedRect\(/, 'rounded shape hit testing follows rendered corners'],
  [/const CONTACTLESS_BOUNDS = \{/, 'contactless selection uses rendered symbol bounds'],
  [/function customLayerSelectionStyle\(/, 'selection outlines use object geometry'],
  [/const renderPixelScale = Math\.max\(/, 'preview render tracks output pixel scale'],
  [/blur \* 7 \* renderPixelScale/, 'image blur scales consistently between preview and export'],
  [/shadowBlur = renderDesign\.shadow \? 16 \* renderPixelScale : 0/, 'built-in text shadows scale consistently between preview and export'],
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
  [/pointers\.current\.clear\(\)/, 'leaving the editable canvas clears stale pointer state'],
  [/gestureTarget\.current = 'artwork'/, 'leaving the editable canvas resets the gesture target'],
  [/const finishActiveGesture = useCallback\(/, 'discrete actions can terminate active canvas gestures'],
  [/finishActiveGestureRef\.current = finishActiveGesture/, 'central editor patching can finalize active gestures'],
  [/recordHistory[\s\S]{0,180}finishActiveGestureRef\.current\(\)/, 'normal Studio edits terminate a live canvas gesture before mutation'],
  [/Object\.is\(currentDesign\.chipX, snapX\.value\)/, 'snapped chip drags do not create no-op gesture history'],
  [/Object\.is\(currentDesign\.zoom, nextZoom\)/, 'bounded artwork pinch gestures do not create no-op history'],
  [/return true;\s*\n\s*}\s*\n\s*\n\s*async function uploadImage/, 'artwork selection reports successful application'],
  [/if \(useArtwork\(menuItem\)\) \{\s*setShowExportPreview\(true\)/, 'final preview opens only after artwork selection succeeds'],
  [/const workingImage = proxyImageWidth\(item\.image, 3072\);[\s\S]{0,180}if \(!workingImage\)[\s\S]{0,520}startFreshWorkingProject\(/, 'invalid artwork sources are rejected before starting a fresh project'],
  [/finishActiveGesture\(\);[\s\S]{0,120}if \(cleanupInFlightRef\.current\)/, 'Undo and other guarded actions finalize active gestures first'],
  [/inert=\{blockingAssetOperation \|\| undefined\}/, 'blocking editor operations use a boolean inert attribute'],
  [/setSelectedElement\('card-text'\)/, 'built-in card text keeps an independent selection state'],
  [/selection: 'card-text'/, 'layer stack identifies built-in card text independently'],
  [/if \(pointers\.current\.size >= 2\) return;/, 'gesture tracking ignores accidental third touches'],
  [/function textLayerLines\(/, 'multiline text is modeled explicitly'],
  [/function singleLineCardText\(/, 'built-in card text normalizes restored control characters'],
  [/const blockingAssetOperation = cleanupInProgress \|\| presetTransferInProgress;/, 'destructive asset transactions expose one editor-wide interaction lock'],
  [/inert=\{blockingAssetOperation \|\| undefined\}/, 'preset and cleanup transactions make the editor inert'],
  [/next\.numberText = singleLineCardText\(/, 'masked card number hydration uses single-line normalization'],
  [/next\.holderText = singleLineCardText\(/, 'card-holder hydration uses single-line normalization'],
  [/className="catalogArtworkFallback"/, 'failed catalog artwork has an in-app visual fallback'],
  [/onError=\{\(\) => setFailed\(true\)\}/, 'catalog artwork decode failures switch to the fallback'],
  [/function pointInBuiltinText\(/, 'built-in card text is directly tappable'],
  [/return 'card-text';/, 'built-in text hit testing routes to card controls'],
  [/setStudioTool\('card'\)/, 'tapping built-in text opens the Card tool'],
  [/label="Line Height"/, 'multiline text has line-height controls'],
  [/<textarea[\s\S]*aria-label="Layer text"/, 'text layers use a multiline editor'],
  [/designRef\.current === startupDesign/, 'startup hydration does not overwrite newer edits'],
  [/async function saveProject\([\s\S]*?if \(!hydrated\)/, 'named project saves wait for Library hydration before enforcing project limits'],
  [/setFavorites\(\(current\) => \{[\s\S]*?mergedById/, 'startup favorite hydration merges early user actions'],
  [/setProjects\(\(current\) => \{[\s\S]{0,700}const merged = \[\.\.\.mergedById\.values\(\)\][\s\S]{0,240}return merged;/, 'startup project hydration merges early user actions'],
  [/setImports\(\(current\) => \{[\s\S]*?mergedById/, 'startup import hydration merges early user actions'],
  [/setExportHistory\(\(current\) => \{[\s\S]*?mergedById/, 'startup export hydration merges early user actions'],
  [/for \(let attempt = 0; attempt < 3; attempt \+= 1\)/, 'service-worker reload retries until the latest draft is stable'],
  [/if \(designRef\.current !== snapshot\)/, 'service-worker reload refuses to discard edits made during persistence'],
  [/let hasServiceWorkerController = Boolean\(navigator\.serviceWorker\.controller\)/, 'service-worker distinguishes first claim from an update'],
  [/if \(!hasServiceWorkerController\)/, 'first service-worker claim does not force an app reload'],
  [/imageImportInFlightRef\.current \|\|[\s\S]{0,220}exportInFlightRef\.current/, 'service-worker updates never reload through active editor transactions'],
  [/Layer limit reached\. Delete a layer before adding another\./, 'custom layer adds enforce the layer cap'],
  [/order\.unshift\(id\);/, 'new custom layers start at the bottom of the unified stack'],
  [/visibleImageIdsTopDown\.length > MAX_VISIBLE_IMAGE_LAYERS/, 'older designs normalize overflow image layers instead of failing hydration'],
  [/visibleImageIdsTopDown\.slice\(0, MAX_VISIBLE_IMAGE_LAYERS\)/, 'overflow normalization preserves topmost visible image layers'],
  [/setSelectedElement\('artwork'\);[\s\S]{0,220}setStudioTool\('crop'\)/, 'Library artwork selection targets the background before crop editing'],
  [/for \(const snapshot of undoRef\.current\) addDesignRefs\(snapshot\)/, 'import cleanup preserves undo history assets'],
  [/for \(const snapshot of redoRef\.current\) addDesignRefs\(snapshot\)/, 'import cleanup preserves redo history assets'],
  [/function startFreshWorkingProject\(/, 'fresh project transitions centralize state replacement'],
  [/function applyImportedArtwork\([\s\S]{0,700}startFreshWorkingProject\(/, 'Library imports start a fresh working project'],
  [/onClick=\{\(\) => applyImportedArtwork\(asset\)\}/, 'Library import rows cannot bypass artwork replacement safety'],
  [/className="studioFloatingBar"[\s\S]{0,420}aria-label="New project"/, 'Studio exposes New in the always-visible editor toolbar'],
  [/dbPutIfBelowLimit\('projects', project, MAX_SAVED_PROJECTS\)/, 'named project saves enforce capacity inside IndexedDB'],
  [/dbPutIfBelowLimit\('projects', copy, MAX_SAVED_PROJECTS\)/, 'project duplicates share the atomic IndexedDB capacity limit'],
  [/copyInserted = await dbPutIfBelowLimit\('projects', copy, MAX_SAVED_PROJECTS\)/, 'project duplication enforces the project cap atomically'],
  [/if \(projectOpsRef\.current\.size\) \{[\s\S]{0,180}before cleaning imported images/, 'import cleanup waits for active project transactions'],
  [/const imageImportGenerationRef = useRef\(0\)/, 'image imports use a generation token'],
  [/function invalidatePendingImageImport\(\)/, 'newer card actions can invalidate stale image imports'],
  [/await dbDelete\('imports', id\)\.catch/, 'stale background imports remove orphaned blobs'],
  [/await dbDelete\('imports', assetId\)\.catch/, 'stale layer imports remove orphaned blobs'],
  [/Finish the image import before saving this design/, 'project saves do not race image imports'],
  [/Finish the image import before exporting\./, 'PNG exports do not race image imports'],
  [/const presetImportGenerationRef = useRef\(0\)/, 'preset imports use a generation token'],
  [/function invalidatePendingPresetImport\(\)/, 'newer card actions can invalidate stale preset imports'],
  [/Finish cleaning imported images before editing\./, 'editor mutations are blocked during destructive import cleanup'],
  [/Finish saving the design before cleaning imported images\./, 'import cleanup cannot race an in-flight project save'],
  [/className="cleanupShield"/, 'cleanup presents an interaction shield while deleting blobs'],
  [/if \(presetImportActiveRef\.current\) \{[\s\S]{0,120}presetImportGenerationRef\.current \+= 1;/, 'editor edits invalidate pending preset imports'],
  [/ensureCurrentPresetImport\(\);[\s\S]{0,120}presetImportActiveRef\.current = false;[\s\S]{0,220}startFreshWorkingProject\([\s\S]{0,120}\.\.\.DEFAULTS, \.\.\.imported/, 'preset final apply starts a fresh project without self-canceling'],
  [/const flushedDraft = await persistDraftSnapshot\(designRef\.current\)/, 'cleanup flushes the authoritative current draft before deleting blobs'],
  [/await draftSaveQueueRef\.current;[\s\S]{0,120}const latestDraft = await dbGet\('kv', 'draft'\)/, 'cleanup drains queued autosaves before its final reference check'],
  [/storedDraft = await dbGet\('kv', 'draft'\)/, 'cleanup protects IndexedDB autosave assets'],
  [/const fallbackDraft = localStorage\.getItem\('aircard-sticker-fvp-v3'\)/, 'cleanup protects local fallback draft assets'],
  [/storedImports = await dbGetImportMetadata\(\)/, 'import cleanup verifies authoritative IndexedDB metadata'],
  [/Could not verify the fallback draft, so no imported images were removed\./, 'import cleanup fails closed if fallback draft verification fails'],
  [/const layers = Array\.isArray\(value\.customLayers\) \? value\.customLayers : \[\];/, 'import cleanup tolerates malformed legacy customLayers'],
  [/for \(const layer of currentDesign\.customLayers \|\| \[\]\)/, 'project saving scans custom layers for remote artwork'],
  [/some remote art is not cached offline/, 'project saving reports incomplete offline artwork caching'],
  [/const referencedPresetAssetIds = new Set\(\)/, 'preset import tracks only referenced embedded assets'],
  [/const stored = await dbGet\('imports', asset\.id\)/, 'preset export re-reads one image blob at a time instead of retaining all blobs'],
  [/Preset is missing a referenced image asset/, 'preset import rejects missing referenced image blobs'],
  [/previous unsaved work cleared/, 'opening a saved project discards the previous unsaved working draft'],
  [/const undo = useCallback\(\(\) => \{[\s\S]{0,260}invalidatePendingImageImport\(\);[\s\S]{0,120}invalidatePendingPresetImport\(\);/, 'Undo cancels in-flight image and preset imports'],
  [/const redo = useCallback\(\(\) => \{[\s\S]{0,260}invalidatePendingImageImport\(\);[\s\S]{0,120}invalidatePendingPresetImport\(\);/, 'Redo cancels in-flight image and preset imports'],
  [/const MAX_VISIBLE_IMAGE_LAYERS = 12;/, 'visible image layers have an iPhone memory cap'],
  [/name: safeDisplayText\(file\.name, 'Imported image', 160\)/, 'background import metadata is bounded before persistence'],
  [/name: safeDisplayText\(file\.name, 'Image layer', 160\)/, 'image-layer import metadata is bounded before persistence'],
  [/name: safeDisplayText\(asset\.name, 'Preset asset', 160\)/, 'preset image metadata is bounded before persistence'],
  [/async function withImageImportLock\(/, 'image imports are serialized'],
  [/const imageImportInFlightRef = useRef\(false\)/, 'image import concurrency has an authoritative lock'],
  [/disabled=\{imageImportInProgress \|\| presetTransferInProgress \|\| cleanupInProgress\} onClick=\{\(\) => layerUploadRef\.current\?\.click\(\)\}/, 'image-layer import entry point is disabled during conflicting asset operations'],
  [/favoriteOpsRef\.current\.has\(itemId\)/, 'favorite writes are serialized per card'],
  [/projectSaveInFlightRef\.current/, 'project saves reject overlapping double taps'],
  [/const historySaved = await recordExport/, 'export history status reflects durable storage writes'],
  [/export history could not be stored/, 'successful exports report history persistence failure separately'],
  [/presetTransferInFlightRef\.current/, 'preset import and export operations are serialized'],
  [/const imageImportInFlightRef = useRef\(false\)/, 'image imports use a synchronous concurrency guard'],
  [/Finish the image import before cleaning imported images\./, 'cleanup cannot overlap an in-flight image import'],
  [/Finish the image import before importing a preset\./, 'preset import cannot overlap a normal image import'],
  [/const cleanupInFlightRef = useRef\(false\)/, 'import cleanup has a synchronous concurrency guard'],
  [/Finish the preset operation before cleaning imported images\./, 'import cleanup cannot overlap preset transfers'],
  [/function fillGrain\(/, 'grain rendering uses a cached pattern instead of per-frame dot loops'],
  [/imageLayers\.length > MAX_VISIBLE_IMAGE_LAYERS/, 'image hydration refuses unsafe visible-image counts'],
  [/visibleImageLayers\(designRef\.current\)\.length >= MAX_VISIBLE_IMAGE_LAYERS/, 'image-layer creation enforces the visible-image cap'],
  [/draftSaveQueueRef\.current/, 'draft writes are serialized through one persistence queue'],
  [/const projectOpsRef = useRef\(new Set\(\)\)/, 'project actions use an authoritative same-frame lock'],
  [/async function withProjectOperation\(/, 'project duplicate and delete actions are serialized'],
  [/projectOpsRef\.current\.has\(id\)/, 'rapid duplicate and delete taps are rejected immediately'],
  [/const queuedAt = Date\.now\(\);/, 'draft timestamps are assigned when snapshots are queued'],
  [/version === draftSaveVersionRef\.current/, 'stale queued drafts cannot overwrite the latest local fallback'],
  [/const flushDraftBeforeSuspend = \(\) =>/, 'draft flushes before iOS suspension'],
  [/document\.addEventListener\('visibilitychange', onVisibilityChange\)/, 'backgrounding triggers a draft flush'],
  [/window\.addEventListener\('pagehide', flushDraftBeforeSuspend\)/, 'pagehide triggers a draft flush'],
  [/aircard-sticker-fvp-v3-updated-at/, 'local draft fallback records a comparable timestamp'],
  [/localUpdatedAt >= indexedUpdatedAt/, 'startup prefers the synchronous fallback when draft timestamps tie'],
  [/startFreshWorkingProject\(createDefaultProjectDesign\(\),[\s\S]{0,180}New card ready · unsaved work cleared/, 'New Card starts a clean working project'],
  [/undoRef\.current = \[\];[\s\S]{0,80}redoRef\.current = \[\];/, 'fresh project transitions clear undo and redo history'],
  [/setGuidesEnabled\(true\)/, 'fresh project transitions restore default alignment guides'],
  [/localStorage\.setItem\('aircard-sticker-fvp-v3', JSON\.stringify\(next\)\)/, 'fresh project transitions synchronously replace the recovery draft'],
  [/function createDefaultProjectDesign\([\s\S]{0,500}customLayers: \[\],[\s\S]{0,120}layerOrder: \[\.\.\.DEFAULTS\.layerOrder\]/, 'new projects clone pristine default layer state'],
  [/function useArtwork\([\s\S]{0,1000}startFreshWorkingProject\(createDefaultProjectDesign\(\{[\s\S]{0,260}background: workingImage/, 'main Card Library artwork selection starts from a pristine default project'],
  [/function openProject\([\s\S]{0,700}startFreshWorkingProject\(/, 'opening a saved project starts a new working session rather than preserving unsaved undo history']
];

for (const [pattern, label] of pageChecks) requireMatch(page, pattern, label);

requireMatch(imagePolicy, /url\.protocol !== 'https:'/, 'persisted proxy targets require HTTPS');
requireMatch(
  imagePolicy,
  /url\.username \|\|[\s\S]{0,80}url\.password/,
  'persisted proxy targets reject embedded credentials'
);

requireMatch(page, /onChange=\{emit\}/, 'range sliders use React controlled onChange');
requireMatch(page, /type=\{Number\(min\) < 0 \? 'text' : 'number'\}/, 'signed Expert Mode fields remain typeable on iPhone');
if (/onInput=\{emit\}/.test(page)) {
  throw new Error('Editor contract failed: range sliders must not use raw onInput');
}
if (/for \(let i = 0; i < (?:3600|900); i \+= 1\)/.test(page)) {
  throw new Error('Editor contract failed: grain must not use per-frame thousands-of-rectangles loops');
}

requireMatch(css, /scroll-padding-bottom:calc\(88px \+ var\(--safe-bottom\)\)/, 'focused controls stay clear of the fixed bottom tab bar');
requireMatch(css, /#panel-studio input,[\s\S]{0,160}scroll-margin-top:calc\(var\(--safe-top\) \+ 170px \+ min\(63vw,315px\)\)/, 'Studio controls stay clear of the sticky editor preview');

const touchChecks = [
  [/\.studioToolBar button\{[^}]*min-height:44px/s, 'Studio tool buttons'],
  [/\.previewModeToggle button\{[^}]*min-height:44px/s, 'Preview mode buttons'],
  [/\.historyButtons button,.beforeAfterButton\{[^}]*min-height:44px/s, 'History and compare buttons'],
  [/\.layerAddRow button,.layerActionGrid button\{[^}]*min-height:44px/s, 'Layer action buttons'],
  [/\.textAlignRow button\{[^}]*min-height:44px/s, 'Text alignment buttons'],
  [/\.doneSelectionButton\{[^}]*min-height:44px/s, 'Done selection button'],
  [/\.studioNewCardButton\{[^}]*min-height:44px/s, 'Studio New Card button'],
  [/\.sliderRow input\{[^}]*min-height:44px/s, 'Range slider touch surface']
];

for (const [pattern, label] of touchChecks) {
  requireMatch(css, pattern, label + ' keep a 44px minimum touch height');
}
requireMatch(
  css,
  /\.physicalChipReflection\{[^}]*transform:rotate\(var\(--chip-rotation,0deg\)\)/s,
  'physical chip reflection keeps its rotation when motion animation is disabled'
);
requireMatch(
  css,
  /\.cleanupShield\{[^}]*position:fixed;[^}]*z-index:260;[^}]*inset:0;/s,
  'cleanup shield covers and blocks the editor during destructive maintenance'
);

requireMatch(sw, /\[ART_CACHE\]:\s*40/, 'full artwork cache is bounded');
requireMatch(sw, /\[THUMB_CACHE\]:\s*160/, 'thumbnail cache is bounded separately');
requireMatch(sw, /async function trimCache\(/, 'service-worker cache eviction exists');
requireMatch(sw, /const SHELL = \['\/', '\/manifest\.webmanifest'\];/, 'app root is precached for first offline launch');
requireMatch(sw, /async function precacheAppShell\(/, 'service worker has an install-time app-shell preloader');
requireMatch(sw, /url\.pathname\.startsWith\('\/_next\/static\/'\)/, 'install-time app-shell preload discovers hashed Next.js chunks');
requireMatch(sw, /await staticCache\.put\(request, response\)/, 'discovered Next.js chunks are stored for first offline launch');
requireMatch(sw, /const OWNED_CACHE_PREFIX = 'card-studio-';/, 'service-worker cleanup is scoped to Card Studio caches');
requireMatch(sw, /key\.startsWith\(OWNED_CACHE_PREFIX\)/, 'service-worker leaves unrelated origin caches untouched');
requireMatch(sw, /url\.pathname === '\/manifest\.webmanifest'[\s\S]{0,140}staleWhileRevalidate\(event\.request, SHELL_CACHE\)/, 'PWA manifest refreshes online while remaining available from the shell cache offline');
requireMatch(sw, /if \(response\.status >= 500\)/, 'navigation falls back to cached shell on transient server failures');
requireMatch(sw, /requestedWidth > 0 && requestedWidth <= 800/, 'thumbnail cache routing is width-bounded');
requireMatch(page, /proxyImageWidth\(item\.image, 3072\)/, 'editor artwork uses a bounded high-resolution working copy');

requireMatch(storage, /const DB_VERSION = 2;/, 'IndexedDB schema includes import metadata migration');
requireMatch(storage, /'importMeta'/, 'import metadata store exists');
requireMatch(storage, /export async function dbGetImportMetadata\(/, 'metadata-only import listing exists');
requireMatch(storage, /export async function dbPutIfBelowLimit\(/, 'IndexedDB supports atomic capacity-limited writes');
requireMatch(storage, /db\.transaction\(store, 'readwrite'\)/, 'capacity checks and writes share one readwrite transaction');
requireMatch(storage, /objectStore\.count\(\)/, 'atomic capacity writes count the durable store before inserting');
requireMatch(storage, /async function withDbRetry\(/, 'transient IndexedDB operations retry through a fresh connection');
requireMatch(storage, /db\.onclose = \(\) => \{[\s\S]{0,100}dbPromise = null;/, 'unexpected IndexedDB closure invalidates the cached connection');
requireMatch(storage, /const snapshot = await withDbRetry\(/, 'import metadata hydration uses the transient IndexedDB retry path');
requireMatch(storage, /parsed\.pathname !== '\/api\/image'/, 'offline artwork cache only accepts the local image proxy');
requireMatch(storage, /parseAllowedRemoteImageUrl\(upstream\)/, 'offline artwork cache validates the upstream image host');
requireMatch(imagePolicy, /export const IMAGE_PROXY_VERSION = '2';/, 'image proxy URLs have an explicit cache generation');
requireMatch(page, /normalized\.set\('v', IMAGE_PROXY_VERSION\)/, 'client proxy URLs use the current cache generation');
requireMatch(inspectRoute, /IMAGE_PROXY_VERSION/, 'inspected artwork URLs use the current cache generation');
requireMatch(storage, /await cache\.delete\(url\);[\s\S]{0,120}await cache\.put\(url, existing\.clone\(\)\)/, 'explicit offline saves refresh cache eviction priority');
requireMatch(storage, /if \(!db\) throw new Error\('IndexedDB unavailable'\);/, 'durable IndexedDB writes fail instead of reporting fake success');
requireMatch(storage, /if \(settled\) \{[\s\S]{0,80}db\.close\(\);/, 'late IndexedDB upgrade success closes orphaned connections');
requireMatch(storage, /db\.onclose = \(\) => \{[\s\S]{0,80}dbPromise = null;/, 'unexpected IndexedDB closure resets the cached connection');
requireMatch(storage, /const CACHE_ARTWORK_TIMEOUT_MS = 12000;/, 'offline artwork caching has a mobile-network timeout');
requireMatch(storage, /signal: controller\.signal/, 'offline artwork cache fetches are abortable');
requireMatch(page, /dbGetImportMetadata\(\)/, 'Library hydrates import metadata instead of blobs');
requireMatch(page, /const MAX_SVG_IMPORT_BYTES = 2 \* 1024 \* 1024;/, 'SVG imports have a strict source-size ceiling');
requireMatch(page, /const MAX_IMAGE_PIXELS = 52_000_000;/, 'source image pixels are bounded for iPhone decode safety');
requireMatch(page, /const MAX_IMAGE_DIMENSION = 10_000;/, 'source image dimensions are bounded for iPhone decode safety');
requireMatch(page, /async function probeLocalImageDimensions\(/, 'common image dimensions are probed before full decode');
requireMatch(
  page,
  /async function prepareLocalImageBlob\([\s\S]*?probeLocalImageDimensions\(blob\)[\s\S]*?assertSafeSourceDimensions\(probedDimensions\)[\s\S]*?decodeLocalImageBlob\(blob\)/,
  'dimension preflight runs before image decoding'
);
requireMatch(page, /async function validateSafeSvgBlob\(/, 'SVG imports are inspected before rasterization');
requireMatch(page, /px\|pt\|pc\|in\|cm\|mm\|q/, 'SVG absolute units are normalized before dimension safety checks');
requireMatch(page, /if \(Number\.isNaN\(width\) \|\| Number\.isNaN\(height\)\) return null;/, 'unsupported SVG dimensions fail verification');
requireMatch(page, /if \(svgSource && !probedDimensions\)/, 'unverifiable SVG dimensions fail closed before raster decode');
requireMatch(page, /<\\s\*script\\b/, 'SVG active script content is rejected');
requireMatch(page, /<\\s\*foreignObject\\b/, 'SVG foreignObject content is rejected');
requireMatch(page, /unsupported active or remote content/, 'SVG remote or active content fails closed');
requireMatch(page, /const MAX_STORED_IMAGE_PIXELS = 12_000_000;/, 'local image working-set pixels are bounded');
requireMatch(page, /const MAX_STORED_IMAGE_DIMENSION = 4096;/, 'local image working-set dimensions are bounded');
requireMatch(page, /const MAX_UNPROBED_IMAGE_BYTES = 8 \* 1024 \* 1024;/, 'large images require pre-decode dimension verification');
requireMatch(page, /Image dimensions could not be verified safely/, 'large unverified images fail closed before decode');
requireMatch(page, /const MAX_STORED_LAYER_IMAGE_PIXELS = 4_000_000;/, 'custom image-layer working-set pixels are bounded separately');
requireMatch(page, /const MAX_STORED_LAYER_IMAGE_DIMENSION = 2560;/, 'custom image-layer dimensions are bounded separately');
requireMatch(page, /const MAX_VISIBLE_IMAGE_DECODE_PIXELS = 24_000_000;/, 'visible image-layer decoded pixels have a total iPhone memory budget');
requireMatch(page, /decodedPixels \+ pixels > MAX_VISIBLE_IMAGE_DECODE_PIXELS/, 'image-layer hydration enforces the decoded-pixel budget');
requireMatch(page, /Visible image layers exceed the safe iPhone memory budget/, 'image-layer memory pressure fails with a recoverable editor message');
requireMatch(page, /const MAX_PRESET_ASSETS = MAX_CUSTOM_LAYERS \+ 1;/, 'preset asset cap includes the background plus every custom layer');
requireMatch(page, /refs\.size > MAX_PRESET_ASSETS/, 'preset export guards asset-count round-trip compatibility');
requireMatch(
  page,
  /for \(const \[assetId, asset\] of presetAssets\)[\s\S]*?referencedPresetAssetIds\.has\(assetId\)[\s\S]*?asset\.data = ''[\s\S]*?presetAssetMap\.delete\(assetId\)/,
  'preset import releases unreferenced embedded payloads'
);
requireMatch(
  page,
  /const blob = dataUrlToBlob\(asset\.data\);[\s\S]*?asset\.data = ''[\s\S]*?prepareLocalImageBlob\(/,
  'preset import releases base64 strings after Blob conversion'
);
requireMatch(page, /const EDITOR_PREVIEW_W = 1024;/, 'interactive editor canvas uses a reduced backing width');
requireMatch(page, /const EDITOR_PREVIEW_H = 646;/, 'interactive editor canvas preserves the exact card ratio');
requireMatch(page, /width=\{EDITOR_PREVIEW_W\}/, 'interactive canvas uses the reduced backing width');
requireMatch(page, /height=\{EDITOR_PREVIEW_H\}/, 'interactive canvas uses the reduced backing height');
requireMatch(page, /const MAX_PRESET_ASSETS = MAX_CUSTOM_LAYERS \+ 1;/, 'preset asset capacity covers every custom layer plus the imported background');
requireMatch(page, /const MAX_PRESET_IMPORT_BYTES = 48 \* 1024 \* 1024;/, 'preset transfer size is bounded for iPhone memory safety');
requireMatch(page, /async function prepareLocalImageBlob\(/, 'oversized local images are downsampled before persistence');
requireMatch(page, /webp\|avif\|heic\|heif/, 'WebP, AVIF, HEIC, and HEIF imports are raster-normalized for deterministic export');
requireMatch(page, /maxPixels: MAX_STORED_LAYER_IMAGE_PIXELS/, 'custom image-layer imports use the smaller working set');
requireMatch(
  page,
  /function normalizePersistedArtworkSource\([\s\S]*?proxyImageWidth\([\s\S]*?width\)/,
  'restored proxied artwork is normalized back to working resolution'
);
requireMatch(page, /parsed\.background = normalizePersistedArtworkSource\(parsed\.background, 3072\)/, 'legacy draft artwork is upgraded instead of cleared');
requireMatch(page, /imported\.background = normalizePersistedArtworkSource\(imported\.background, 3072\)/, 'legacy preset background artwork is upgraded instead of cleared');
requireMatch(page, /src: normalizePersistedArtworkSource\(src, MAX_STORED_LAYER_IMAGE_DIMENSION\)/, 'legacy preset image layers are upgraded instead of cleared');
requireMatch(page, /const decodedBySource = new Map\(\);/, 'duplicate image layers share decoded sources');
requireMatch(page, /const animatedOrVectorSource =/, 'animated and vector imports are normalized');
requireMatch(page, /chunkType === 'acTL'/, 'APNG animation is detected from the PNG animation-control chunk');
requireMatch(page, /Boolean\(probedDimensions\?\.animated\)/, 'ordinary image\/png APNG files are raster-normalized deterministically');
requireMatch(page, /gif\|apng\|svg\\\+xml/, 'APNG, GIF, and SVG imports use deterministic rasterization');
requireMatch(page, /const encodeCanvas = \(type, quality\)/, 'image optimization has an encoder fallback path');
requireMatch(page, /optimizedBlob\.size > MAX_IMAGE_IMPORT_BYTES/, 'optimized image blobs cannot exceed the import storage ceiling');
if (/dbGetAll\('imports'\)/.test(page)) {
  throw new Error('Editor contract failed: Library must not hydrate full import blobs into React state');
}

console.log('PASS editor regression contract');


requireMatch(imageRoute, /Math\.min\(3072, Math\.floor\(requestedWidth\)\)/, 'image proxy bounds working artwork width');

const proxySecurityChecks = [
  [imageRoute, /parseAllowedRemoteImageUrl/, 'image proxy shares the canonical remote-host policy'],
  [imageRoute, /redirect:\s*'manual'/, 'image proxy validates redirects before following them'],
  [imageRoute, /SAFE_IMAGE_TYPES/, 'image proxy rejects unsafe image formats'],
  [imageRoute, /readLimitedBody\(/, 'image proxy stream-limits response bodies'],
  [imageRoute, /const MAX_PROXY_OUTPUT_BYTES = 15 \* 1024 \* 1024;/, 'image proxy bounds normalized output size'],
  [imageRoute, /Processed image too large/, 'oversized normalized proxy output fails closed'],
  [imageRoute, /import sharp from 'sharp'/, 'image proxy can resize non-CDN artwork server-side'],
  [imageRoute, /limitInputPixels: MAX_DECODED_IMAGE_PIXELS/, 'proxy decoding has a pixel safety bound'],
  [imageRoute, /const shouldNormalize = width >= 160;/, 'every requested proxy width is enforced server-side'],
  [imageRoute, /\.resize\(\{[\s\S]*width,[\s\S]*withoutEnlargement: true/s, 'proxy width requests are enforced server-side'],
  [imageRoute, /responseType = 'image\/webp'/, 'normalized proxy images return a deterministic web format'],
  [inspectRoute, /redirect:\s*'manual'/, 'artwork inspector validates redirects before following them'],
  [inspectRoute, /SAFE_IMAGE_TYPES/, 'artwork inspector rejects unsafe image formats'],
  [inspectRoute, /const MAX_ANALYSIS_PIXELS = 40_000_000;/, 'artwork inspector bounds decoded pixels'],
  [inspectRoute, /limitInputPixels: MAX_ANALYSIS_PIXELS/, 'artwork inspector enforces the decoded-pixel bound'],
  [inspectRoute, /\.rotate\(\)/, 'artwork inspector honors EXIF orientation before pixel analysis'],
  [inspectRoute, /readLimitedBody\(/, 'artwork inspector stream-limits response bodies']
];

for (const [source, pattern, label] of proxySecurityChecks) {
  requireMatch(source, pattern, label);
}
