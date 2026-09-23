'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  blobToDataUrl,
  cacheArtwork,
  dataUrlToBlob,
  dbDelete,
  dbGet,
  dbGetAll,
  dbGetImportMetadata,
  dbPut,
  dbPutIfBelowLimit,
  makeId
} from './lib/storage';
import { IMAGE_PROXY_VERSION, parseAllowedRemoteImageUrl } from './lib/imagePolicy';
import { adjustedImage } from './lib/pixelAdjust';

const OUT_W = 1536;
const OUT_H = 969;
const EDITOR_PREVIEW_W = 1024;
const EDITOR_PREVIEW_H = 646;
const CARD_RATIO = OUT_W / OUT_H;
const MAX_IMAGE_IMPORT_BYTES = 30 * 1024 * 1024;
const MAX_SVG_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_PROBE_BYTES = 1024 * 1024;
const MAX_UNPROBED_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PRESET_IMPORT_BYTES = 48 * 1024 * 1024;
const MAX_PRESET_EMBEDDED_BYTES = 30 * 1024 * 1024;
const MAX_CUSTOM_LAYERS = 200;
const MAX_SAVED_PROJECTS = 200;
const MAX_VISIBLE_IMAGE_LAYERS = 12;
const MAX_VISIBLE_IMAGE_DECODE_PIXELS = 24_000_000;
const MAX_PRESET_ASSETS = MAX_CUSTOM_LAYERS + 1;
const MAX_IMAGE_PIXELS = 52_000_000;
const MAX_IMAGE_DIMENSION = 10_000;
const MAX_STORED_IMAGE_PIXELS = 12_000_000;
const MAX_STORED_IMAGE_DIMENSION = 4096;
const MAX_STORED_LAYER_IMAGE_PIXELS = 4_000_000;
const MAX_STORED_LAYER_IMAGE_DIMENSION = 2560;

const DISCRETE_DESIGN_HISTORY_KEYS = new Set(['fit', 'gradient', 'chipTone']);
const CONTINUOUS_LAYER_HISTORY_KEYS = new Set([
  'text',
  'color',
  'x',
  'y',
  'scale',
  'rotation',
  'opacity',
  'width',
  'height',
  'radius',
  'fontSize',
  'weight',
  'letterSpacing',
  'lineHeight'
]);

const CUCU_CATEGORIES = [
  ['all', 'All Card Skins'],
  ['best', 'Best Sellers'],
  ['new', 'New Arrivals'],
  ['anime', 'Anime'],
  ['cars', 'Cars'],
  ['sports', 'Sports'],
  ['artistic', 'Artistic'],
  ['cute', 'Cute & Kawaii'],
  ['pets', 'Pets'],
  ['classic', 'Classic Art'],
  ['funny', 'Funny'],
  ['memes', 'Memes'],
  ['retro', 'Retro & Nostalgic'],
  ['animals', 'Animals'],
  ['crypto', 'Crypto']
];

function interleaveCatalogItems(groups, limit = Number.POSITIVE_INFINITY) {
  const lists = groups.filter(Array.isArray);
  const output = [];
  let index = 0;

  while (output.length < limit) {
    let added = false;

    for (const list of lists) {
      if (index >= list.length) continue;
      output.push(list[index]);
      added = true;
      if (output.length >= limit) break;
    }

    if (!added) break;
    index += 1;
  }

  return output;
}

const GRADIENTS = [
  ['Midnight', '#11131b', '#3b1e70', '#7b61ff'],
  ['Obsidian', '#080909', '#202326', '#6a6f74'],
  ['Crimson', '#13070a', '#68101f', '#e12642'],
  ['Ocean', '#06141f', '#075a8b', '#18c2e7'],
  ['Emerald', '#06130f', '#0b5e43', '#4ed39b'],
  ['Sunset', '#28112f', '#b13464', '#ff8f4d'],
  ['Gold', '#12100a', '#5a4214', '#d8b85f'],
  ['Candy', '#2b133d', '#a43f8f', '#ff89c9']
].map((x, i) => ({ id: i, name: x[0], a: x[1], b: x[2], c: x[3] }));

// Card Library previews intentionally overscan by 2.25% on every edge.
// Studio uses the mathematically equivalent 1.045x artwork scale so the
// selected card keeps the exact framing the user tapped in the Library.
const CATALOG_ARTWORK_OVERSCAN = 0.0225;
const CATALOG_ARTWORK_EDITOR_ZOOM = 1 + CATALOG_ARTWORK_OVERSCAN * 2;

const DEFAULTS = {
  background: '',
  backgroundLabel: 'Midnight',
  sourceCrop: null,
  originalSourceCrop: null,
  gradient: 0,
  backgroundColor: '',
  fit: 'cover',
  zoom: 1,
  x: 0,
  y: 0,
  rotate: 0,
  flipX: false,
  exposure: 0,
  brightness: 1,
  saturation: 1,
  contrast: 1,
  highlights: 0,
  shadows: 0,
  temperature: 0,
  tint: 0,
  sharpness: 0,
  blur: 0,
  vignette: 0,
  grain: 0,
  gloss: 0,
  overlay: 0,
  fade: 0,
  effectTint: '#7b61ff',
  effectTintStrength: 0,
  chip: true,
  chipTone: 'gold',
  chipX: 0.105,
  chipY: 0.35,
  chipScale: 1,
  chipRotation: 0,
  contactless: true,
  contactlessX: 0.285,
  contactlessY: 0.43,
  contactlessScale: 1,
  contactlessRotation: 0,
  contactlessColor: '#ffffff',
  contactlessOpacity: 0.9,
  contactlessLocked: false,
  visa: false,
  visaX: 0.84,
  visaY: 0.84,
  visaScale: 1,
  visaRotation: 0,
  visaOpacity: 1,
  visaFinish: 'silver',
  visaGloss: 0.48,
  visaReflection: 0.42,
  number: false,
  numberText: '••••  ••••  ••••  4242',
  holder: false,
  holderText: 'CARD HOLDER',
  expiry: false,
  expiryText: '12/29',
  badge: false,
  badgeText: 'CARD',
  textColor: '#ffffff',
  shadow: true,
  customLayers: [],
  layerOrder: ['builtin-chip', 'builtin-contactless', 'builtin-visa', 'builtin-text']
};

function createDefaultProjectDesign({
  background = DEFAULTS.background,
  backgroundLabel = DEFAULTS.backgroundLabel,
  sourceCrop = DEFAULTS.sourceCrop,
  originalSourceCrop = sourceCrop,
  zoom = DEFAULTS.zoom
} = {}) {
  return {
    ...DEFAULTS,
    background,
    backgroundLabel,
    sourceCrop,
    originalSourceCrop,
    zoom,
    customLayers: [],
    layerOrder: [...DEFAULTS.layerOrder]
  };
}

const TAB_ITEMS = [
  ['discover', 'Discover'],
  ['studio', 'Studio'],
  ['library', 'Library'],
  ['export', 'Export']
];

const STUDIO_TOOLS = [
  ['crop', 'Edit'],
  ['text', 'Text'],
  ['add', 'Add'],
  ['adjust', 'Adjust'],
  ['effects', 'Effects'],
  ['card', 'Card']
];

const IMAGE_LAYER_DEFAULTS = {
  exposure: 0,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  highlights: 0,
  shadows: 0,
  temperature: 0,
  tint: 0,
  sharpness: 0,
  blur: 0,
  vignette: 0,
  grain: 0,
  gloss: 0,
  overlay: 0,
  fade: 0,
  effectTint: '#7b61ff',
  effectTintStrength: 0
};

const ADJUSTMENT_PRESETS = {
  // Presets are full looks, not labels pasted over tiny slider changes.
  // Every preset owns the entire image-adjustment/effects surface so switching
  // between looks is deterministic and Original truly restores a clean image.
  Original: {
    ...IMAGE_LAYER_DEFAULTS
  },
  Vivid: {
    ...IMAGE_LAYER_DEFAULTS,
    exposure: 0.1,
    brightness: 1.07,
    contrast: 1.18,
    saturation: 1.38,
    highlights: 0.1,
    shadows: 0.08,
    temperature: 0.03,
    tint: 0.01,
    sharpness: 0.28,
    vignette: 0.06,
    grain: 0.015,
    gloss: 0.1
  },
  Dark: {
    ...IMAGE_LAYER_DEFAULTS,
    exposure: -0.42,
    brightness: 0.78,
    contrast: 1.28,
    saturation: 0.92,
    highlights: -0.36,
    shadows: -0.28,
    temperature: -0.04,
    sharpness: 0.12,
    vignette: 0.32,
    grain: 0.02,
    overlay: 0.2,
    effectTint: '#0b1020',
    effectTintStrength: 0.1
  },
  AMOLED: {
    ...IMAGE_LAYER_DEFAULTS,
    exposure: -0.25,
    brightness: 0.82,
    contrast: 1.62,
    saturation: 1.32,
    highlights: -0.18,
    shadows: -0.72,
    temperature: -0.03,
    tint: 0.03,
    sharpness: 0.25,
    vignette: 0.28,
    overlay: 0.24,
    effectTint: '#090014',
    effectTintStrength: 0.18
  },
  Warm: {
    ...IMAGE_LAYER_DEFAULTS,
    exposure: 0.04,
    brightness: 1.03,
    contrast: 1.07,
    saturation: 1.12,
    highlights: 0.08,
    shadows: 0.05,
    temperature: 0.34,
    tint: 0.05,
    sharpness: 0.08,
    gloss: 0.05,
    effectTint: '#ff8a3d',
    effectTintStrength: 0.08
  },
  Cold: {
    ...IMAGE_LAYER_DEFAULTS,
    exposure: 0.01,
    brightness: 1.01,
    contrast: 1.12,
    saturation: 1.02,
    highlights: 0.02,
    shadows: -0.06,
    temperature: -0.38,
    tint: -0.05,
    sharpness: 0.12,
    vignette: 0.08,
    effectTint: '#438cff',
    effectTintStrength: 0.1
  },
  Film: {
    ...IMAGE_LAYER_DEFAULTS,
    exposure: -0.05,
    brightness: 1.01,
    contrast: 0.9,
    saturation: 0.84,
    highlights: -0.16,
    shadows: 0.2,
    temperature: 0.14,
    tint: 0.05,
    sharpness: -0.08,
    blur: 0.025,
    vignette: 0.18,
    grain: 0.085,
    fade: 0.14,
    effectTint: '#d6a56f',
    effectTintStrength: 0.08
  },
  Neon: {
    ...IMAGE_LAYER_DEFAULTS,
    exposure: 0.02,
    brightness: 1.03,
    contrast: 1.55,
    saturation: 1.95,
    highlights: 0.22,
    shadows: -0.38,
    temperature: -0.12,
    tint: 0.28,
    sharpness: 0.35,
    vignette: 0.3,
    gloss: 0.12,
    overlay: 0.12,
    effectTint: '#8a16ff',
    effectTintStrength: 0.28
  },
  Vintage: {
    ...IMAGE_LAYER_DEFAULTS,
    exposure: -0.08,
    brightness: 1.01,
    contrast: 0.86,
    saturation: 0.68,
    highlights: -0.1,
    shadows: 0.22,
    temperature: 0.3,
    tint: 0.09,
    sharpness: -0.1,
    blur: 0.018,
    vignette: 0.2,
    grain: 0.065,
    fade: 0.17,
    effectTint: '#c68a54',
    effectTintStrength: 0.12
  },
  Monochrome: {
    ...IMAGE_LAYER_DEFAULTS,
    brightness: 1.01,
    contrast: 1.32,
    saturation: 0,
    highlights: 0.06,
    shadows: -0.14,
    sharpness: 0.2,
    vignette: 0.16,
    grain: 0.025
  }
};

const CARD_PRESETS = {
  'Classic Gold': { chip: true, chipTone: 'gold', contactless: true, textColor: '#ffffff', number: false, holder: false, expiry: false, badge: false },
  'Black Metal': { chip: true, chipTone: 'black', contactless: true, textColor: '#f7f7f7', shadow: true },
  Silver: { chip: true, chipTone: 'silver', contactless: true, textColor: '#ffffff', shadow: true },
  'Rose Gold': { chip: true, chipTone: 'rose', contactless: true, textColor: '#fff5f2', shadow: true },
  Minimal: { chip: true, chipTone: 'gold', contactless: false, number: false, holder: false, expiry: false, badge: false },
  'No Chip': { chip: false, contactless: true },
  'Full Art': { chip: false, contactless: false, number: false, holder: false, expiry: false, badge: false }
};

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function normalizeAngleDelta(degrees) {
  let value = Number(degrees || 0);
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

function normalizeFreeRotation(degrees) {
  let value = Number(degrees || 0);
  if (!Number.isFinite(value)) return 0;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

function snapValue(value, targets, threshold = 0.018) {
  let best = value;
  let distance = Infinity;
  for (const target of targets) {
    const delta = Math.abs(value - target);
    if (delta < distance) {
      distance = delta;
      best = target;
    }
  }
  return distance <= threshold ? { value: best, snapped: true } : { value, snapped: false };
}

const BUILTIN_LAYER_IDS = ['builtin-chip', 'builtin-contactless', 'builtin-visa', 'builtin-text'];

function normalizeLayerOrder(design) {
  const customIds = (design.customLayers || []).map((layer) => layer.id).filter(Boolean);
  const valid = new Set([...customIds, ...BUILTIN_LAYER_IDS]);
  const requested = Array.isArray(design.layerOrder) ? design.layerOrder : [];
  const seen = new Set();
  const ordered = [];

  for (const id of requested) {
    if (!valid.has(id) || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }

  // Existing projects created before unified stacking did not have layerOrder.
  // Keep their custom art below card hardware/text by default.
  for (const id of customIds) {
    if (!seen.has(id)) {
      const firstBuiltin = ordered.findIndex((entry) => BUILTIN_LAYER_IDS.includes(entry));
      if (firstBuiltin >= 0) ordered.splice(firstBuiltin, 0, id);
      else ordered.push(id);
      seen.add(id);
    }
  }

  for (const id of BUILTIN_LAYER_IDS) {
    if (!seen.has(id)) {
      ordered.push(id);
      seen.add(id);
    }
  }

  return ordered;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteClamp(value, fallback, min, max) {
  return clamp(finiteNumber(value, fallback), min, max);
}

function normalizeHexColor(value, fallback = '#ffffff') {
  const raw = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return '#' + raw.slice(1).split('').map((char) => char + char).join('').toLowerCase();
  }
  return fallback;
}

function normalizeCrop(crop, minSize = 0.1) {
  if (!crop || typeof crop !== 'object') return null;
  const width = finiteClamp(crop.w, 1, minSize, 1);
  const height = finiteClamp(crop.h, 1, minSize, 1);
  const normalized = {
    x: finiteClamp(crop.x, 0, 0, 1 - width),
    y: finiteClamp(crop.y, 0, 0, 1 - height),
    w: width,
    h: height
  };

  if (
    Math.abs(normalized.x) < 1e-9 &&
    Math.abs(normalized.y) < 1e-9 &&
    Math.abs(normalized.w - 1) < 1e-9 &&
    Math.abs(normalized.h - 1) < 1e-9
  ) {
    return null;
  }

  return normalized;
}

function cropsEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(Number(a.x) - Number(b.x)) < 1e-9 &&
    Math.abs(Number(a.y) - Number(b.y)) < 1e-9 &&
    Math.abs(Number(a.w) - Number(b.w)) < 1e-9 &&
    Math.abs(Number(a.h) - Number(b.h)) < 1e-9
  );
}

function normalizeImageAdjustments(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    exposure: finiteClamp(raw.exposure, IMAGE_LAYER_DEFAULTS.exposure, -1, 1),
    brightness: finiteClamp(raw.brightness, IMAGE_LAYER_DEFAULTS.brightness, 0.4, 1.7),
    contrast: finiteClamp(raw.contrast, IMAGE_LAYER_DEFAULTS.contrast, 0.45, 1.8),
    saturation: finiteClamp(raw.saturation, IMAGE_LAYER_DEFAULTS.saturation, 0, 2.4),
    highlights: finiteClamp(raw.highlights, IMAGE_LAYER_DEFAULTS.highlights, -1, 1),
    shadows: finiteClamp(raw.shadows, IMAGE_LAYER_DEFAULTS.shadows, -1, 1),
    temperature: finiteClamp(raw.temperature, IMAGE_LAYER_DEFAULTS.temperature, -1, 1),
    tint: finiteClamp(raw.tint, IMAGE_LAYER_DEFAULTS.tint, -1, 1),
    sharpness: finiteClamp(raw.sharpness, IMAGE_LAYER_DEFAULTS.sharpness, -1, 1),
    blur: finiteClamp(raw.blur, IMAGE_LAYER_DEFAULTS.blur, 0, 1),
    vignette: finiteClamp(raw.vignette, IMAGE_LAYER_DEFAULTS.vignette, 0, 0.8),
    grain: finiteClamp(raw.grain, IMAGE_LAYER_DEFAULTS.grain, 0, 0.22),
    gloss: finiteClamp(raw.gloss, IMAGE_LAYER_DEFAULTS.gloss, 0, 0.8),
    overlay: finiteClamp(raw.overlay, IMAGE_LAYER_DEFAULTS.overlay, 0, 0.75),
    fade: finiteClamp(raw.fade, IMAGE_LAYER_DEFAULTS.fade, 0, 1),
    effectTint: normalizeHexColor(raw.effectTint, IMAGE_LAYER_DEFAULTS.effectTint),
    effectTintStrength: finiteClamp(raw.effectTintStrength, IMAGE_LAYER_DEFAULTS.effectTintStrength, 0, 1)
  };
}

function normalizeCustomLayer(layer) {
  if (!layer || typeof layer !== 'object' || !layer.id) return null;
  const id = splitGraphemes(layer.id).slice(0, 120).join('');
  if (!id || BUILTIN_LAYER_IDS.includes(id)) return null;

  const type = ['text', 'shape', 'image', 'chip', 'contactless'].includes(layer.type)
    ? layer.type
    : null;
  if (!type) return null;

  const normalized = {
    id,
    type,
    name: splitGraphemes(layer.name || type).slice(0, 80).join(''),
    x: finiteClamp(layer.x, 0.5, 0, 1),
    y: finiteClamp(layer.y, 0.5, 0, 1),
    scale: finiteClamp(layer.scale, 1, 0.1, 6),
    rotation: finiteClamp(layer.rotation, 0, -180, 180),
    opacity: finiteClamp(layer.opacity, 1, 0, 1),
    locked: Boolean(layer.locked),
    hidden: Boolean(layer.hidden)
  };

  if (type === 'text') {
    normalized.text = splitGraphemes(layer.text ?? 'Text').slice(0, 500).join('');
    normalized.color = normalizeHexColor(layer.color, '#ffffff');
    normalized.fontSize = finiteClamp(layer.fontSize, 58, 10, 240);
    normalized.fontFamily = ['system', 'rounded', 'serif', 'mono'].includes(layer.fontFamily)
      ? layer.fontFamily
      : 'system';
    normalized.weight = Math.round(finiteClamp(layer.weight, 700, 100, 900) / 100) * 100;
    normalized.letterSpacing = finiteClamp(layer.letterSpacing, 0, -4, 30);
    normalized.lineHeight = finiteClamp(layer.lineHeight, 1.18, 0.8, 2);
    normalized.align = ['left', 'center', 'right'].includes(layer.align) ? layer.align : 'center';
    normalized.shadow = Boolean(layer.shadow);
  } else if (type === 'shape') {
    normalized.shape = layer.shape === 'ellipse' ? 'ellipse' : 'rectangle';
    normalized.width = finiteClamp(layer.width, 280, 20, 1200);
    normalized.height = finiteClamp(layer.height, 120, 20, 800);
    normalized.radius = finiteClamp(layer.radius, 28, 0, Math.min(normalized.width, normalized.height) / 2);
    normalized.color = normalizeHexColor(layer.color, '#ffffff');
  } else if (type === 'image') {
    normalized.src = normalizePersistedArtworkSource(
      layer.src,
      MAX_STORED_LAYER_IMAGE_DIMENSION
    );
    normalized.width = finiteClamp(layer.width, 640, 20, 1800);
    normalized.flipX = Boolean(layer.flipX);
    normalized.crop = normalizeCrop(layer.crop, 0.1);
    normalized.originalCrop = normalizeCrop(layer.originalCrop, 0.1);
    normalized.adjustments = normalizeImageAdjustments(layer.adjustments);
  } else if (type === 'chip') {
    normalized.tone = ['gold', 'silver', 'black', 'rose'].includes(layer.tone) ? layer.tone : 'gold';
  } else if (type === 'contactless') {
    normalized.color = normalizeHexColor(layer.color, '#ffffff');
  }

  return normalized;
}

function normalizeDesignState(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const next = { ...DEFAULTS };
  next.background = normalizePersistedArtworkSource(raw.background, 3072);
  next.backgroundLabel = splitGraphemes(raw.backgroundLabel || DEFAULTS.backgroundLabel).slice(0, 120).join('');
  next.sourceCrop = normalizeCrop(raw.sourceCrop, 0.1);
  next.originalSourceCrop = normalizeCrop(raw.originalSourceCrop, 0.1);
  next.gradient = Math.round(finiteClamp(raw.gradient, DEFAULTS.gradient, 0, GRADIENTS.length - 1));
  next.backgroundColor = raw.backgroundColor ? normalizeHexColor(raw.backgroundColor, DEFAULTS.backgroundColor) : '';
  next.fit = raw.fit === 'contain' ? 'contain' : 'cover';
  next.zoom = finiteClamp(raw.zoom, DEFAULTS.zoom, 0.5, 5);
  next.x = finiteClamp(raw.x, DEFAULTS.x, -1.5, 1.5);
  next.y = finiteClamp(raw.y, DEFAULTS.y, -1.5, 1.5);
  next.rotate = finiteClamp(raw.rotate, DEFAULTS.rotate, -180, 180);
  next.flipX = Boolean(raw.flipX);

  next.exposure = finiteClamp(raw.exposure, DEFAULTS.exposure, -1, 1);
  next.brightness = finiteClamp(raw.brightness, DEFAULTS.brightness, 0.4, 1.7);
  next.saturation = finiteClamp(raw.saturation, DEFAULTS.saturation, 0, 2.4);
  next.contrast = finiteClamp(raw.contrast, DEFAULTS.contrast, 0.45, 1.8);
  next.highlights = finiteClamp(raw.highlights, DEFAULTS.highlights, -1, 1);
  next.shadows = finiteClamp(raw.shadows, DEFAULTS.shadows, -1, 1);
  next.temperature = finiteClamp(raw.temperature, DEFAULTS.temperature, -1, 1);
  next.tint = finiteClamp(raw.tint, DEFAULTS.tint, -1, 1);
  next.sharpness = finiteClamp(raw.sharpness, DEFAULTS.sharpness, -1, 1);
  next.blur = finiteClamp(raw.blur, DEFAULTS.blur, 0, 1);
  next.vignette = finiteClamp(raw.vignette, DEFAULTS.vignette, 0, 0.8);
  next.grain = finiteClamp(raw.grain, DEFAULTS.grain, 0, 0.22);
  next.gloss = finiteClamp(raw.gloss, DEFAULTS.gloss, 0, 0.8);
  next.overlay = finiteClamp(raw.overlay, DEFAULTS.overlay, 0, 0.75);
  next.fade = finiteClamp(raw.fade, DEFAULTS.fade, 0, 1);
  next.effectTint = normalizeHexColor(raw.effectTint, DEFAULTS.effectTint);
  next.effectTintStrength = finiteClamp(raw.effectTintStrength, DEFAULTS.effectTintStrength, 0, 1);

  next.chip = raw.chip == null ? DEFAULTS.chip : Boolean(raw.chip);
  next.chipTone = ['gold', 'silver', 'black', 'rose'].includes(raw.chipTone) ? raw.chipTone : DEFAULTS.chipTone;
  next.chipX = finiteClamp(raw.chipX, DEFAULTS.chipX, 0, 0.82);
  next.chipY = finiteClamp(raw.chipY, DEFAULTS.chipY, 0, 0.8);
  next.chipScale = finiteClamp(raw.chipScale, DEFAULTS.chipScale, 0.5, 2);
  next.chipRotation = finiteClamp(raw.chipRotation, DEFAULTS.chipRotation, -45, 45);

  next.contactless = raw.contactless == null ? DEFAULTS.contactless : Boolean(raw.contactless);
  next.contactlessX = finiteClamp(raw.contactlessX, DEFAULTS.contactlessX, 0.03, 0.97);
  next.contactlessY = finiteClamp(raw.contactlessY, DEFAULTS.contactlessY, 0.03, 0.97);
  next.contactlessScale = finiteClamp(raw.contactlessScale, DEFAULTS.contactlessScale, 0.4, 2.2);
  next.contactlessRotation = finiteClamp(raw.contactlessRotation, DEFAULTS.contactlessRotation, -180, 180);
  next.contactlessColor = normalizeHexColor(raw.contactlessColor, raw.textColor || DEFAULTS.contactlessColor);
  next.contactlessOpacity = finiteClamp(raw.contactlessOpacity, DEFAULTS.contactlessOpacity, 0, 1);
  next.contactlessLocked = Boolean(raw.contactlessLocked);

  next.visa = raw.visa == null ? DEFAULTS.visa : Boolean(raw.visa);
  next.visaX = finiteClamp(raw.visaX, DEFAULTS.visaX, 0.1, 0.9);
  next.visaY = finiteClamp(raw.visaY, DEFAULTS.visaY, 0.08, 0.92);
  next.visaScale = finiteClamp(raw.visaScale, DEFAULTS.visaScale, 0.45, 2.2);
  next.visaRotation = finiteClamp(raw.visaRotation, DEFAULTS.visaRotation, -180, 180);
  next.visaOpacity = finiteClamp(raw.visaOpacity, DEFAULTS.visaOpacity, 0.1, 1);
  next.visaFinish = ['silver', 'white', 'black'].includes(raw.visaFinish) ? raw.visaFinish : DEFAULTS.visaFinish;
  next.visaGloss = finiteClamp(raw.visaGloss, DEFAULTS.visaGloss, 0, 1);
  next.visaReflection = finiteClamp(raw.visaReflection, DEFAULTS.visaReflection, 0, 1);

  next.number = Boolean(raw.number);
  next.numberText = singleLineCardText(raw.numberText ?? DEFAULTS.numberText, 32);
  next.holder = Boolean(raw.holder);
  next.holderText = singleLineCardText(raw.holderText ?? DEFAULTS.holderText, 28);
  next.expiry = Boolean(raw.expiry);
  next.expiryText = singleLineCardText(raw.expiryText ?? DEFAULTS.expiryText, 8);
  next.badge = Boolean(raw.badge);
  next.badgeText = singleLineCardText(raw.badgeText ?? DEFAULTS.badgeText, 18);
  next.textColor = normalizeHexColor(raw.textColor, DEFAULTS.textColor);
  next.shadow = raw.shadow == null ? DEFAULTS.shadow : Boolean(raw.shadow);

  const seen = new Set();
  next.customLayers = (Array.isArray(raw.customLayers) ? raw.customLayers : [])
    .map(normalizeCustomLayer)
    .filter((layer) => {
      if (!layer || seen.has(layer.id)) return false;
      seen.add(layer.id);
      return true;
    })
    .slice(0, MAX_CUSTOM_LAYERS);
  next.layerOrder = normalizeLayerOrder({
    ...next,
    layerOrder: Array.isArray(raw.layerOrder) ? raw.layerOrder : DEFAULTS.layerOrder
  });

  const layerById = new Map(next.customLayers.map((layer) => [layer.id, layer]));
  const visibleImageIdsTopDown = next.layerOrder
    .slice()
    .reverse()
    .filter((id) => {
      const layer = layerById.get(id);
      return Boolean(layer?.type === 'image' && layer.src && !layer.hidden);
    });

  if (visibleImageIdsTopDown.length > MAX_VISIBLE_IMAGE_LAYERS) {
    const keepVisible = new Set(visibleImageIdsTopDown.slice(0, MAX_VISIBLE_IMAGE_LAYERS));
    next.customLayers = next.customLayers.map((layer) =>
      layer.type === 'image' && layer.src && !layer.hidden && !keepVisible.has(layer.id)
        ? { ...layer, hidden: true }
        : layer
    );
  }

  return next;
}

function insertCustomLayerBelowHardware(design, id) {
  const order = normalizeLayerOrder(design).filter((entry) => entry !== id);

  // layerOrder is rendered bottom -> top. New custom art should begin behind
  // existing custom layers and built-in card hardware/text; users can then
  // explicitly Bring Forward when they want it above something.
  order.unshift(id);
  return order;
}

function isLayerStackEntryVisible(design, id) {
  if (id === 'builtin-chip') return Boolean(design.chip);
  if (id === 'builtin-contactless') return Boolean(design.contactless);
  if (id === 'builtin-visa') return Boolean(design.visa);
  if (id === 'builtin-text') return Boolean(design.badge || design.number || design.holder || design.expiry);
  const layer = (design.customLayers || []).find((entry) => entry.id === id);
  return Boolean(layer && !layer.hidden);
}

function isLayerStackEntryListed(design, id) {
  if (BUILTIN_LAYER_IDS.includes(id)) return true;
  return Boolean((design.customLayers || []).some((entry) => entry.id === id));
}

function hexToRgb(hex = '#000000') {
  const clean = String(hex).replace('#', '').trim();
  const normalized = clean.length === 3
    ? clean.split('').map((char) => char + char).join('')
    : clean.padEnd(6, '0').slice(0, 6);
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) return [0, 0, 0];
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

let textMeasureCanvas = null;
let grainTileCanvas = null;
let graphemeSegmenter = null;

function fillGrain(ctx, x, y, width, height, opacity) {
  const amount = clamp(Number(opacity || 0), 0, 1);
  if (!amount || typeof document === 'undefined') return;

  if (!grainTileCanvas) {
    grainTileCanvas = document.createElement('canvas');
    grainTileCanvas.width = 64;
    grainTileCanvas.height = 64;
    const grainCtx = grainTileCanvas.getContext('2d');
    if (!grainCtx) {
      grainTileCanvas = null;
      return;
    }

    const pixels = grainCtx.createImageData(64, 64);
    let seed = 0x6d2b79f5;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (Math.imul(seed ^ (seed >>> 15), 1 | seed) + 0x9e3779b9) >>> 0;
      const value = seed & 1 ? 255 : 0;
      pixels.data[i] = value;
      pixels.data[i + 1] = value;
      pixels.data[i + 2] = value;
      pixels.data[i + 3] = 255;
    }
    grainCtx.putImageData(pixels, 0, 0);
  }

  const pattern = ctx.createPattern(grainTileCanvas, 'repeat');
  if (!pattern) return;

  ctx.save();
  ctx.globalAlpha *= amount;
  ctx.fillStyle = pattern;
  ctx.fillRect(x, y, width, height);
  ctx.restore();
}

const CONTACTLESS_BOUNDS = {
  left: 14,
  top: -58,
  right: 84,
  bottom: 58
};

const VISA_BOUNDS = { left: -150, top: -52, right: 150, bottom: 52 };
const VISA_PATH = 'M9.112 8.262L5.97 15.758H3.92L2.374 9.775c-.094-.368-.175-.503-.461-.658C1.447 8.864.677 8.627 0 8.479l.046-.217h3.3a.904.904 0 01.894.764l.817 4.338 2.018-5.102zm8.033 5.049c.008-1.979-2.736-2.088-2.717-2.972.006-.269.262-.555.822-.628a3.66 3.66 0 011.913.336l.34-1.59a5.207 5.207 0 00-1.814-.333c-1.917 0-3.266 1.02-3.278 2.479-.012 1.079.963 1.68 1.698 2.04.756.367 1.01.603 1.006.931-.005.504-.602.725-1.16.734-.975.015-1.54-.263-1.992-.473l-.351 1.642c.453.208 1.289.39 2.156.398 2.037 0 3.37-1.006 3.377-2.564m5.061 2.447H24l-1.565-7.496h-1.656a.883.883 0 00-.826.55l-2.909 6.946h2.036l.405-1.12h2.488zm-2.163-2.656l1.02-2.815.588 2.815zm-8.16-4.84l-1.603 7.496H8.34l1.605-7.496z';

function splitGraphemes(value) {
  const text = String(value ?? '');
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    graphemeSegmenter ||= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(graphemeSegmenter.segment(text), (entry) => entry.segment);
  }
  return Array.from(text);
}

function singleLineCardText(value, maxLength) {
  const normalized = String(value ?? '')
    .replace(/[\r\n\t\f\v]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '');
  return splitGraphemes(normalized).slice(0, maxLength).join('');
}

function textLayerFontFamily(fontFamily) {
  return {
    system: '-apple-system, BlinkMacSystemFont, sans-serif',
    rounded: 'ui-rounded, -apple-system, BlinkMacSystemFont, sans-serif',
    serif: 'ui-serif, Georgia, serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, monospace'
  }[fontFamily] || '-apple-system, BlinkMacSystemFont, sans-serif';
}

function textLayerFontCss(layer) {
  const size = clamp(Number(layer?.fontSize ?? 58), 10, 240);
  const weight = clamp(Number(layer?.weight ?? 700), 100, 900);
  return weight + ' ' + size + 'px ' + textLayerFontFamily(layer?.fontFamily);
}

function textLayerLines(layer) {
  return String(layer?.text ?? 'Text').replace(/\r\n?/g, '\n').split('\n');
}

function textLayerLineAdvance(layer) {
  const size = clamp(Number(layer?.fontSize ?? 58), 10, 240);
  return size * clamp(Number(layer?.lineHeight ?? 1.18), 0.8, 2);
}

function measureTrackedText(ctx, text, tracking = 0) {
  const chars = splitGraphemes(text);
  if (!chars.length) return 0;

  const spacing = Number(tracking || 0);
  if (!spacing || chars.length < 2) {
    return ctx.measureText(chars.join('')).width;
  }

  return chars.reduce((width, char) => width + ctx.measureText(char).width, 0) +
    Math.max(0, chars.length - 1) * spacing;
}

function drawTrackedText(ctx, text, x, y, tracking = 0) {
  const chars = splitGraphemes(text);
  if (!tracking || chars.length < 2) {
    ctx.fillText(chars.join(''), x, y);
    return;
  }

  const originalAlign = ctx.textAlign || 'start';
  const totalWidth = measureTrackedText(ctx, chars.join(''), tracking);
  let cursor = x;
  if (originalAlign === 'center') cursor -= totalWidth / 2;
  else if (originalAlign === 'right' || originalAlign === 'end') cursor -= totalWidth;

  ctx.save();
  ctx.textAlign = 'left';
  for (const char of chars) {
    ctx.fillText(char, cursor, y);
    cursor += ctx.measureText(char).width + tracking;
  }
  ctx.restore();
}

function pointInBuiltinText(px, py, design, padding = 0) {
  if (typeof document === 'undefined') return false;

  textMeasureCanvas ||= document.createElement('canvas');
  const ctx = textMeasureCanvas.getContext('2d');
  if (!ctx) return false;

  const hit = (enabled, text, font, x, baseline, align = 'left') => {
    const value = String(text ?? '');
    if (!enabled || !value.trim()) return false;

    ctx.font = font;
    const metrics = ctx.measureText(value);
    const width = Math.max(1, Number(metrics.width || 0));
    const fontSize = Number(font.match(/(\d+(?:\.\d+)?)px/)?.[1] || 34);
    const ascent = Math.max(fontSize * 0.7, Number(metrics.actualBoundingBoxAscent || 0));
    const descent = Math.max(fontSize * 0.18, Number(metrics.actualBoundingBoxDescent || 0));

    let left = x;
    if (align === 'right') left -= width;
    else if (align === 'center') left -= width / 2;

    return (
      px >= left - padding &&
      px <= left + width + padding &&
      py >= baseline - ascent - padding &&
      py <= baseline + descent + padding
    );
  };

  return (
    hit(design.badge, design.badgeText ?? 'CARD', '800 66px -apple-system, BlinkMacSystemFont, sans-serif', OUT_W - 105, 130, 'right') ||
    hit(design.number, design.numberText, '600 64px ui-monospace, SFMono-Regular, Menlo, monospace', 120, 700, 'left') ||
    hit(design.holder, design.holderText, '650 34px -apple-system, BlinkMacSystemFont, sans-serif', 122, 815, 'left') ||
    hit(design.expiry, design.expiryText, '650 34px -apple-system, BlinkMacSystemFont, sans-serif', OUT_W - 122, 815, 'right')
  );
}

function customLayerBounds(layer, layerImage) {
  if (!layer) return { left: -40, top: -40, right: 40, bottom: 40 };

  if (layer.type === 'shape') {
    const w = clamp(Number(layer.width ?? 280), 20, 1200);
    const h = clamp(Number(layer.height ?? 120), 20, 800);
    return { left: -w / 2, top: -h / 2, right: w / 2, bottom: h / 2 };
  }

  if (layer.type === 'image') {
    const w = clamp(Number(layer.width ?? 640), 20, 1800);
    let ratio = 1.6;
    if (layerImage?.width && layerImage?.height) {
      const crop = layer.crop;
      const sw = crop ? clamp(crop.w, 0.01, 1) * layerImage.width : layerImage.width;
      const sh = crop ? clamp(crop.h, 0.01, 1) * layerImage.height : layerImage.height;
      ratio = sw / Math.max(1, sh);
    }
    const h = w / Math.max(0.1, ratio);
    return { left: -w / 2, top: -h / 2, right: w / 2, bottom: h / 2 };
  }

  if (layer.type === 'chip') return { left: -127.5, top: -94, right: 127.5, bottom: 94 };
  if (layer.type === 'contactless') return CONTACTLESS_BOUNDS;

  const size = clamp(Number(layer.fontSize ?? 58), 10, 240);
  const tracking = Number(layer.letterSpacing ?? 0);
  const lines = textLayerLines(layer);
  const lineAdvance = textLayerLineAdvance(layer);
  let measuredWidth = Math.max(
    size * 0.5,
    ...lines.map((line) => {
      const chars = splitGraphemes(line);
      return chars.reduce(
        (width, char) => width + size * (char === ' ' ? 0.34 : /[ilI1|]/.test(char) ? 0.3 : /[MW@#]/.test(char) ? 0.82 : 0.58),
        0
      ) + Math.max(0, chars.length - 1) * tracking;
    })
  );
  let ascent = size * 0.9;
  let descent = size * 0.28;

  if (typeof document !== 'undefined') {
    textMeasureCanvas ||= document.createElement('canvas');
    const measureCtx = textMeasureCanvas.getContext('2d');
    if (measureCtx) {
      measureCtx.font = textLayerFontCss(layer);
      measuredWidth = Math.max(
        size * 0.25,
        ...lines.map((line) => measureTrackedText(measureCtx, line, tracking))
      );
      const lineMetrics = lines.map((line) => measureCtx.measureText(line || 'M'));
      ascent = Math.max(
        size * 0.55,
        ...lineMetrics.map((metrics) => Number(metrics.actualBoundingBoxAscent || 0))
      );
      descent = Math.max(
        size * 0.15,
        ...lineMetrics.map((metrics) => Number(metrics.actualBoundingBoxDescent || 0))
      );
    }
  }

  const shadowPad = layer.shadow ? 16 : 0;
  const align = layer.align || 'center';
  const left = align === 'left' ? 0 : align === 'right' ? -measuredWidth : -measuredWidth / 2;
  const firstBaseline = -((lines.length - 1) * lineAdvance) / 2;
  const lastBaseline = firstBaseline + (lines.length - 1) * lineAdvance;
  return {
    left: left - shadowPad,
    top: firstBaseline - ascent - shadowPad,
    right: left + measuredWidth + shadowPad,
    bottom: lastBaseline + descent + shadowPad
  };
}

function pointToLocal(px, py, cx, cy, rotation, scale) {
  const radians = (Number(rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = px - cx;
  const dy = py - cy;
  const safeScale = Math.max(0.0001, Number(scale || 1));
  return {
    x: (dx * cos + dy * sin) / safeScale,
    y: (-dx * sin + dy * cos) / safeScale
  };
}

function clipTransformedRect(ctx, cx, cy, width, height, rotation = 0) {
  ctx.translate(cx, cy);
  ctx.rotate((Number(rotation || 0) * Math.PI) / 180);
  ctx.beginPath();
  ctx.rect(-width / 2, -height / 2, width, height);
  ctx.clip();
  ctx.rotate((-Number(rotation || 0) * Math.PI) / 180);
  ctx.translate(-cx, -cy);
}

function pointInRotatedBounds(px, py, cx, cy, rotation, scale, bounds, padding = 0) {
  const safeScale = Math.max(0.0001, Number(scale || 1));
  const localPadding = Number(padding || 0) / safeScale;
  const local = pointToLocal(px, py, cx, cy, rotation, safeScale);
  return (
    local.x >= bounds.left - localPadding &&
    local.x <= bounds.right + localPadding &&
    local.y >= bounds.top - localPadding &&
    local.y <= bounds.bottom + localPadding
  );
}

function pointInRotatedEllipse(px, py, cx, cy, rotation, scale, width, height, padding = 0) {
  const safeScale = Math.max(0.0001, Number(scale || 1));
  const localPadding = Number(padding || 0) / safeScale;
  const local = pointToLocal(px, py, cx, cy, rotation, safeScale);
  const rx = Math.max(1, Number(width || 0) / 2 + localPadding);
  const ry = Math.max(1, Number(height || 0) / 2 + localPadding);
  return (local.x * local.x) / (rx * rx) + (local.y * local.y) / (ry * ry) <= 1;
}

function pointInRotatedRoundedRect(
  px,
  py,
  cx,
  cy,
  rotation,
  scale,
  width,
  height,
  radius,
  padding = 0
) {
  const safeScale = Math.max(0.0001, Number(scale || 1));
  const localPadding = Number(padding || 0) / safeScale;
  const local = pointToLocal(px, py, cx, cy, rotation, safeScale);
  const halfW = Math.max(1, Number(width || 0) / 2 + localPadding);
  const halfH = Math.max(1, Number(height || 0) / 2 + localPadding);
  const corner = clamp(
    Number(radius || 0) + localPadding,
    0,
    Math.min(halfW, halfH)
  );
  const ax = Math.abs(local.x);
  const ay = Math.abs(local.y);

  if (ax > halfW || ay > halfH) return false;
  if (corner <= 0 || ax <= halfW - corner || ay <= halfH - corner) return true;

  const dx = ax - (halfW - corner);
  const dy = ay - (halfH - corner);
  return dx * dx + dy * dy <= corner * corner;
}

function selectionStyleForBounds(originX, originY, scale, rotation, bounds) {
  const safeScale = Math.max(0.0001, Number(scale || 1));
  const angle = Number(rotation || 0);
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const centerLocalX = ((bounds.left + bounds.right) / 2) * safeScale;
  const centerLocalY = ((bounds.top + bounds.bottom) / 2) * safeScale;
  const centerX = originX + centerLocalX * cos - centerLocalY * sin;
  const centerY = originY + centerLocalX * sin + centerLocalY * cos;
  const width = Math.max(18, (bounds.right - bounds.left) * safeScale);
  const height = Math.max(18, (bounds.bottom - bounds.top) * safeScale);

  return {
    left: (centerX / OUT_W) * 100 + '%',
    top: (centerY / OUT_H) * 100 + '%',
    width: (width / OUT_W) * 100 + '%',
    height: (height / OUT_H) * 100 + '%',
    transform: 'translate(-50%, -50%) rotate(' + angle + 'deg)'
  };
}

function customLayerSelectionStyle(layer, layerImage) {
  return selectionStyleForBounds(
    Number(layer?.x ?? 0.5) * OUT_W,
    Number(layer?.y ?? 0.5) * OUT_H,
    clamp(Number(layer?.scale ?? 1), 0.1, 6),
    Number(layer?.rotation ?? 0),
    customLayerBounds(layer, layerImage)
  );
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = clamp(Number(r || 0), 0, Math.min(Math.abs(w), Math.abs(h)) / 2);
  ctx.beginPath();

  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius);
    ctx.closePath();
    return;
  }

  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function IOSIcon({ name, size = 24 }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true
  };

  if (name === 'browse' || name === 'discover') {
    return <svg {...common}><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.3 15.3 4.7 4.7"/></svg>;
  }
  if (name === 'edit' || name === 'studio') {
    return <svg {...common}><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/><path d="M4 12h4M12 12h8"/><circle cx="10" cy="12" r="2"/></svg>;
  }
  if (name === 'layers' || name === 'library') {
    return <svg {...common}><rect x="4" y="4" width="12" height="12" rx="2.8"/><rect x="8" y="8" width="12" height="12" rx="2.8"/></svg>;
  }
  if (name === 'export') {
    return <svg {...common}><path d="M12 15V3M8.5 6.5 12 3l3.5 3.5"/><path d="M5 11v7a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-7"/></svg>;
  }
  if (name === 'photo') {
    return <svg {...common}><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.7"/><path d="m5.5 17 4.2-4.2 2.7 2.7 2.2-2.2 3.9 3.7"/></svg>;
  }
  if (name === 'reset') {
    return <svg {...common}><path d="M5.2 8.2A8 8 0 1 1 4 14"/><path d="M5.2 8.2V3.8M5.2 8.2h4.4"/></svg>;
  }
  if (name === 'undo') {
    return <svg {...common}><path d="M9 7 5 11l4 4"/><path d="M5 11h7.2a6 6 0 0 1 6 6"/></svg>;
  }
  if (name === 'redo') {
    return <svg {...common}><path d="m15 7 4 4-4 4"/><path d="M19 11h-7.2a6 6 0 0 0-6 6"/></svg>;
  }
  if (name === 'compare') {
    return <svg {...common}><path d="M4 6h16M4 18h16"/><path d="M9 4v16M15 4v16"/></svg>;
  }
  if (name === 'crop') {
    return <svg {...common}><path d="M7 3v14a2 2 0 0 0 2 2h12"/><path d="M3 7h14a2 2 0 0 1 2 2v12"/></svg>;
  }
  if (name === 'scissors') {
    return <svg {...common}><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="6.5" cy="6.5" r="2.5"/><path d="M8.5 8.5 19 19M8.5 15.5 19 5"/></svg>;
  }
  if (name === 'rotate') {
    return <svg {...common}><path d="M19 10a7 7 0 1 1-3-5.7"/><path d="M16 2v4h4"/></svg>;
  }
  if (name === 'flip') {
    return <svg {...common}><path d="M12 3v18M4 6l6 6-6 6V6ZM20 6l-6 6 6 6V6Z"/></svg>;
  }
  if (name === 'shape') {
    return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="3"/></svg>;
  }
  if (name === 'color') {
    return <svg {...common}><circle cx="12" cy="12" r="7"/></svg>;
  }
  if (name === 'gradient') {
    return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M5 19 19 5"/></svg>;
  }
  if (name === 'blur') {
    return <svg {...common}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/></svg>;
  }
  if (name === 'brightness') {
    return <svg {...common}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/></svg>;
  }
  if (name === 'contrast') {
    return <svg {...common}><circle cx="12" cy="12" r="8"/><path d="M12 4v16"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none"/></svg>;
  }
  if (name === 'saturation') {
    return <svg {...common}><path d="M12 3c-2.8 4.1-7 8.5-7 12a7 7 0 0 0 14 0c0-3.5-4.2-7.9-7-12Z"/></svg>;
  }
  if (name === 'temperature') {
    return <svg {...common}><path d="M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0Z"/><path d="M12 9v8"/></svg>;
  }
  if (name === 'sharpness') {
    return <svg {...common}><path d="m12 4 8 15H4L12 4Z"/></svg>;
  }
  if (name === 'chip') {
    return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 5v14M15 5v14M3 10h6M15 10h6M3 15h6M15 15h6"/></svg>;
  }
  if (name === 'contactless') {
    return <svg {...common}><path d="M5 9a5 5 0 0 1 0 6M9 6a9 9 0 0 1 0 12M13 3a13 13 0 0 1 0 18"/><circle cx="3" cy="12" r="1" fill="currentColor" stroke="none"/></svg>;
  }
  if (name === 'position') {
    return <svg {...common}><path d="M12 3v18M3 12h18"/><path d="m9 6 3-3 3 3M18 9l3 3-3 3M15 18l-3 3-3-3M6 15l-3-3 3-3"/></svg>;
  }
  if (name === 'adjust') {
    return <svg {...common}><path d="M4 7h8M16 7h4M4 17h3M11 17h9M4 12h3M11 12h9"/><circle cx="14" cy="7" r="2"/><circle cx="9" cy="17" r="2"/><circle cx="9" cy="12" r="2"/></svg>;
  }
  if (name === 'effects') {
    return <svg {...common}><path d="m12 3 1.5 4.2L18 9l-4.5 1.8L12 15l-1.5-4.2L6 9l4.5-1.8L12 3Z"/><path d="m18.5 15 .8 2.2L21.5 18l-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/></svg>;
  }
  if (name === 'card') {
    return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/></svg>;
  }
  if (name === 'text') {
    return <svg {...common}><path d="M5 5h14M12 5v14M8 19h8"/></svg>;
  }
  if (name === 'add') {
    return <svg {...common}><circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/></svg>;
  }
  if (name === 'background') {
    return <svg {...common}><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="m5.5 17 4.2-4.2 2.7 2.7 2.2-2.2 3.9 3.7"/></svg>;
  }
  if (name === 'search') {
    return <svg {...common}><circle cx="10.2" cy="10.2" r="5.8"/><path d="m14.5 14.5 4.8 4.8"/></svg>;
  }
  if (name === 'x') {
    return <svg {...common}><path d="m7 7 10 10M17 7 7 17"/></svg>;
  }
  if (name === 'chevron') {
    return <svg {...common}><path d="m9 6 6 6-6 6"/></svg>;
  }
  if (name === 'trash') {
    return <svg {...common}><path d="M4.5 7h15M9 7V4.8h6V7M7 7l.8 13h8.4L17 7M10 10.5v6M14 10.5v6"/></svg>;
  }
  return null;
}

function drawChip(ctx, d, pixelScale = 1) {
  const palettes = {
    gold: ['#fff0a0', '#d8b24a', '#9e7421'],
    silver: ['#f5f7f8', '#b8c0c6', '#6f777d'],
    black: ['#696b70', '#242528', '#08090b'],
    rose: ['#ffd0c5', '#d88978', '#8e4a40']
  };
  const p = palettes[d.chipTone] || palettes.gold;
  const w = 255 * d.chipScale;
  const h = 188 * d.chipScale;
  const x = d.chipX * OUT_W;
  const y = d.chipY * OUT_H;
  const r = 30 * d.chipScale;
  const inset = 9 * d.chipScale;

  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((d.chipRotation * Math.PI) / 180);
  ctx.translate(-(x + w / 2), -(y + h / 2));

  ctx.shadowColor = 'rgba(0,0,0,.4)';
  ctx.shadowBlur = 24 * pixelScale;
  ctx.shadowOffsetY = 10 * pixelScale;

  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, p[0]);
  g.addColorStop(0.45, p[1]);
  g.addColorStop(1, p[2]);

  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = g;
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 7 * d.chipScale;
  ctx.strokeStyle = 'rgba(60,45,10,.45)';
  ctx.stroke();

  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.strokeStyle = 'rgba(70,48,10,.52)';
  ctx.lineWidth = 6 * d.chipScale;
  ctx.beginPath();
  ctx.moveTo(cx, y + inset);
  ctx.lineTo(cx, y + h - inset);
  ctx.moveTo(x + inset, cy);
  ctx.lineTo(x + w - inset, cy);
  ctx.stroke();

  [0.25, 0.75].forEach((q) => {
    ctx.beginPath();
    ctx.moveTo(x + w * q, y + inset);
    ctx.lineTo(x + w * q, y + h * 0.3);
    ctx.quadraticCurveTo(cx, y + h * 0.36, cx, cy);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x + w * q, y + h - inset);
    ctx.lineTo(x + w * q, y + h * 0.7);
    ctx.quadraticCurveTo(cx, y + h * 0.64, cx, cy);
    ctx.stroke();
  });

  ctx.restore();
}

function drawChipLayerAtOrigin(ctx, tone = 'gold', pixelScale = 1) {
  const palettes = {
    gold: ['#fff0a0', '#d8b24a', '#9e7421'],
    silver: ['#f5f7f8', '#b8c0c6', '#6f777d'],
    black: ['#696b70', '#242528', '#08090b'],
    rose: ['#ffd0c5', '#d88978', '#8e4a40']
  };
  const p = palettes[tone] || palettes.gold;
  const w = 255;
  const h = 188;
  const x = -w / 2;
  const y = -h / 2;
  const r = 30;
  const inset = 9;

  ctx.shadowColor = 'rgba(0,0,0,.4)';
  ctx.shadowBlur = 24 * pixelScale;
  ctx.shadowOffsetY = 10 * pixelScale;

  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, p[0]);
  g.addColorStop(0.45, p[1]);
  g.addColorStop(1, p[2]);

  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = g;
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(60,45,10,.45)';
  ctx.stroke();

  ctx.strokeStyle = 'rgba(70,48,10,.52)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, y + 9);
  ctx.lineTo(0, y + h - 9);
  ctx.moveTo(x + 9, 0);
  ctx.lineTo(x + w - 9, 0);
  ctx.stroke();

  [0.25, 0.75].forEach((q) => {
    ctx.beginPath();
    ctx.moveTo(x + w * q, y + inset);
    ctx.lineTo(x + w * q, y + h * 0.3);
    ctx.quadraticCurveTo(0, y + h * 0.36, 0, 0);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x + w * q, y + h - inset);
    ctx.lineTo(x + w * q, y + h * 0.7);
    ctx.quadraticCurveTo(0, y + h * 0.64, 0, 0);
    ctx.stroke();
  });
}

function drawContactlessLayerAtOrigin(ctx, color = '#ffffff') {
  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.globalAlpha *= 0.9;
  [28, 52, 78].forEach((radius) => {
    ctx.beginPath();
    ctx.arc(0, 0, radius, -0.72, 0.72);
    ctx.stroke();
  });
}

function drawVisaLayerAtOrigin(ctx, d, pixelScale = 1) {
  if (typeof Path2D !== 'function') return;
  const path = new Path2D(VISA_PATH);
  const finish = d.visaFinish || 'silver';
  const gloss = clamp(Number(d.visaGloss ?? 0.48), 0, 1);
  const reflection = clamp(Number(d.visaReflection ?? 0.42), 0, 1);
  const palettes = {
    silver: ['#ffffff', '#aeb8c5', '#ffffff', '#7d8794', '#f8fbff'],
    white: ['#ffffff', '#dfe5eb', '#ffffff', '#c9d1da', '#ffffff'],
    black: ['#666b73', '#17191d', '#8b929c', '#08090b', '#4a4f57']
  };
  const stops = palettes[finish] || palettes.silver;
  ctx.save();
  ctx.globalAlpha *= clamp(Number(d.visaOpacity ?? 1), 0.1, 1);
  ctx.scale(12.5, 12.5);
  ctx.translate(-12, -12);
  const gradient = ctx.createLinearGradient(0, 7, 24, 17);
  gradient.addColorStop(0, stops[0]); gradient.addColorStop(0.28, stops[1]); gradient.addColorStop(0.48, stops[2]); gradient.addColorStop(0.72, stops[3]); gradient.addColorStop(1, stops[4]);
  ctx.fillStyle = gradient;
  ctx.shadowColor = 'rgba(0,0,0,.38)';
  ctx.shadowBlur = 1.15 * pixelScale;
  ctx.shadowOffsetY = 0.35 * pixelScale;
  ctx.fill(path);
  if (gloss > 0) {
    ctx.save(); ctx.clip(path);
    const shine = ctx.createLinearGradient(2, 7, 21, 16);
    shine.addColorStop(0, 'rgba(255,255,255,0)'); shine.addColorStop(0.38, 'rgba(255,255,255,' + (0.16 * gloss) + ')'); shine.addColorStop(0.5, 'rgba(255,255,255,' + (0.72 * gloss) + ')'); shine.addColorStop(0.62, 'rgba(255,255,255,' + (0.12 * gloss) + ')'); shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = shine; ctx.fillRect(0, 6, 24, 12); ctx.restore();
  }
  if (reflection > 0) {
    ctx.save(); ctx.clip(path); ctx.globalCompositeOperation = finish === 'black' ? 'screen' : 'multiply';
    const reflective = ctx.createLinearGradient(0, 16, 24, 8);
    reflective.addColorStop(0, 'rgba(90,105,122,' + (0.16 * reflection) + ')'); reflective.addColorStop(0.5, 'rgba(255,255,255,0)'); reflective.addColorStop(1, 'rgba(100,115,132,' + (0.22 * reflection) + ')');
    ctx.fillStyle = reflective; ctx.fillRect(0, 6, 24, 12); ctx.restore();
  }
  ctx.restore();
}

function drawVisa(ctx, d, pixelScale = 1) {
  ctx.save();
  ctx.translate(Number(d.visaX ?? 0.84) * OUT_W, Number(d.visaY ?? 0.84) * OUT_H);
  ctx.rotate((Number(d.visaRotation || 0) * Math.PI) / 180);
  const scale = clamp(Number(d.visaScale ?? 1), 0.45, 2.2);
  ctx.scale(scale, scale);
  drawVisaLayerAtOrigin(ctx, d, pixelScale);
  ctx.restore();
}

function drawContactless(ctx, d) {
  const x = d.contactlessX * OUT_W;
  const y = d.contactlessY * OUT_H;
  const scale = d.contactlessScale;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((Number(d.contactlessRotation || 0) * Math.PI) / 180);
  ctx.strokeStyle = d.contactlessColor || d.textColor;
  ctx.lineWidth = 10 * scale;
  ctx.lineCap = 'round';
  ctx.globalAlpha *= clamp(Number(d.contactlessOpacity ?? 0.9), 0, 1);
  [28, 52, 78].forEach((radius) => {
    ctx.beginPath();
    ctx.arc(0, 0, radius * scale, -0.72, 0.72);
    ctx.stroke();
  });
  ctx.restore();
}

function SliderRow({ label, value, min, max, step, onChange, suffix = '', disabled = false, formatValue }) {
  const decimals = step >= 1 ? 0 : step < 0.01 ? 3 : 2;
  const displayValue = formatValue
    ? formatValue(Number(value))
    : Number(value).toFixed(decimals) + suffix;
  const emit = (event) => {
    const next = clamp(Number(event.currentTarget.value), Number(min), Number(max));
    if (Number.isFinite(next)) onChange(next);
  };

  return (
    <label className={'sliderRow ' + (disabled ? 'isDisabled' : '')}>
      <div className="rowHeader">
        <span>{label}</span>
        <span className="rowValue">{displayValue}</span>
      </div>
      <input
        aria-label={label}
        aria-valuetext={displayValue}
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={emit}
      />
    </label>
  );
}

function NumericField({ label, value, min, max, step = 0.001, onChange, suffix = '' }) {
  const [draft, setDraft] = useState(String(Number(value)));
  const cancelCommitRef = useRef(false);

  useEffect(() => {
    setDraft(String(Number(value)));
  }, [value]);

  const commit = () => {
    if (cancelCommitRef.current) {
      cancelCommitRef.current = false;
      setDraft(String(Number(value)));
      return;
    }
    if (draft.trim() === '') {
      setDraft(String(Number(value)));
      return;
    }
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(Number(value)));
      return;
    }
    const next = clamp(parsed, Number(min), Number(max));
    setDraft(String(next));
    onChange(next);
  };

  return (
    <label className="numericRow">
      <span>{label}</span>
      <div className="numericInputWrap">
        <input
          type={Number(min) < 0 ? 'text' : 'number'}
          inputMode={Number(min) < 0 ? 'text' : 'decimal'}
          enterKeyHint="done"
          step={Number(min) < 0 ? undefined : step}
          min={Number(min) < 0 ? undefined : min}
          max={Number(min) < 0 ? undefined : max}
          value={draft}
          aria-label={label}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            else if (event.key === 'Escape') {
              cancelCommitRef.current = true;
              setDraft(String(Number(value)));
              event.currentTarget.blur();
            }
          }}
        />
        {suffix ? <small>{suffix}</small> : null}
      </div>
    </label>
  );
}

function SwitchRow({ label, detail, value, onChange }) {
  return (
    <button
      type="button"
      className="switchRow"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
    >
      <span className="switchCopy">
        <strong>{label}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
      <span className={'iosSwitch ' + (value ? 'isOn' : '')} aria-hidden="true"><i /></span>
    </button>
  );
}

function Group({ title, footer, children }) {
  return (
    <section className="settingsSection">
      {title ? <h3 className="sectionLabel">{title}</h3> : null}
      <div className="insetGroup">{children}</div>
      {footer ? <p className="sectionFooter">{footer}</p> : null}
    </section>
  );
}

function handleTabKeyDown(event, values, current, onSelect) {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (!keys.includes(event.key) || !values.length) return;

  event.preventDefault();
  const index = Math.max(0, values.indexOf(current));
  let nextIndex = index;

  if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = values.length - 1;
  else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    nextIndex = (index + 1) % values.length;
  } else {
    nextIndex = (index - 1 + values.length) % values.length;
  }

  onSelect(values[nextIndex]);

  const tabList = event.currentTarget.closest('[role="tablist"]');
  const tabs = tabList ? Array.from(tabList.querySelectorAll('[role="tab"]')) : [];
  window.requestAnimationFrame(() => tabs[nextIndex]?.focus());
}

function proxyImageWidth(src = '', width = 1600) {
  let source = String(src || '').trim();
  if (!source || source.length > 4096) return '';

  // Older builds could persist our proxy as an absolute URL. Normalize that
  // back to the local route before deciding whether the source itself is
  // third-party artwork.
  if (/^https:\/\//i.test(source)) {
    try {
      const absolute = new URL(source);
      if (absolute.pathname === '/api/image' && absolute.searchParams.has('url')) {
        source = '/api/image?' + absolute.searchParams.toString();
      }
    } catch {
      return '';
    }
  }

  // Older favorites/recent items may store the original HTTPS artwork URL.
  // Route those through the same-origin proxy so canvas export stays untainted.
  if (/^https:\/\//i.test(source)) {
    const remote = parseAllowedRemoteImageUrl(source);
    if (!remote || remote.toString().length > 2200) return '';
    source = '/api/image?url=' + encodeURIComponent(remote.toString());
  }

  if (!source.startsWith('/api/image?')) return '';

  const params = new URLSearchParams(source.slice('/api/image?'.length));
  const rawUrl = params.get('url');
  if (!rawUrl || rawUrl.length > 2200) return '';

  const remote = parseAllowedRemoteImageUrl(rawUrl);
  if (!remote) return '';

  const normalized = new URLSearchParams();
  normalized.set('url', remote.toString());
  normalized.set('w', String(Math.max(160, Math.min(3072, Math.round(width)))));
  normalized.set('v', IMAGE_PROXY_VERSION);
  return '/api/image?' + normalized.toString();
}

// Library/Home previews must use the same framing rule as Studio:
// source crop first, then a centered "cover" into the physical card ratio.
// The previous preview path stretched sourceCrop directly to the frame, which
// exposed AnimeDeskMat's white 1200x1200 product canvas even though Studio
// looked correct after opening the same card.
function catalogCoverCrop(item) {
  const crop = normalizeCrop(item?.sourceCrop, 0.01);
  if (!crop) return null;

  const cropRatio = Number(item?.mediaAspectRatio);
  if (!Number.isFinite(cropRatio) || cropRatio <= 0) return crop;

  if (cropRatio > CARD_RATIO + 1e-6) {
    const width = crop.w * (CARD_RATIO / cropRatio);
    return normalizeCrop({
      x: crop.x + (crop.w - width) / 2,
      y: crop.y,
      w: width,
      h: crop.h
    }, 0.01) || crop;
  }

  if (cropRatio < CARD_RATIO - 1e-6) {
    const height = crop.h * (cropRatio / CARD_RATIO);
    return normalizeCrop({
      x: crop.x,
      y: crop.y + (crop.h - height) / 2,
      w: crop.w,
      h: height
    }, 0.01) || crop;
  }

  return crop;
}

function CatalogArtwork({ item, alt, useThumbnail = true }) {
  const crop = catalogCoverCrop(item);
  const src = useThumbnail
    ? proxyImageWidth(item.thumbnail || item.image, 560)
    : proxyImageWidth(item.image, 1600);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <span
      className="catalogArtworkFrame"
      style={{ '--catalog-artwork-overscan': (CATALOG_ARTWORK_OVERSCAN * 100) + '%' }}
    >
      {failed || !src ? (
        <span className="catalogArtworkFallback" role="img" aria-label={alt || 'Artwork unavailable'}>
          <IOSIcon name="photo" size={24} />
        </span>
      ) : crop && crop.w > 0 && crop.h > 0 ? (
        <img
          className="croppedCatalogImage"
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          style={{
            // crop coordinates are in source-image space. The old math used
            // percentages relative to the already enlarged element, which
            // shifted/scaled product-sheet crops incorrectly in Home/Anime.
            width: (100 / crop.w) + '%',
            height: (100 / crop.h) + '%',
            left: (-100 * crop.x / crop.w) + '%',
            top: (-100 * crop.y / crop.h) + '%'
          }}
        />
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

function SkinActions({ item, isFavorite, onPick, onFavorite, onMenu }) {
  return (
    <div className="skinActions">
      <button
        type="button"
        className={'favoriteButton ' + (isFavorite ? 'isFavorite' : '')}
        aria-label={(isFavorite ? 'Remove ' : 'Add ') + item.title + (isFavorite ? ' from favorites' : ' to favorites')}
        aria-pressed={isFavorite}
        onClick={(event) => {
          event.stopPropagation();
          onFavorite(item);
        }}
      >
        {isFavorite ? '♥' : '♡'}
      </button>
      <button
        type="button"
        className="moreButton"
        aria-label={'More actions for ' + item.title}
        onClick={(event) => {
          event.stopPropagation();
          onMenu(item);
        }}
      >
        •••
      </button>
    </div>
  );
}

function ArtworkRail({ title, items, onPick, favoriteIds = new Set(), onFavorite = () => {}, onMenu = () => {} }) {
  if (!items.length) return null;
  return (
    <section className="browseSection">
      <div className="browseHeading">
        <h2>{title}</h2>
        <span>{items.length}</span>
      </div>
      <div className="artRail cardSkinRail" role="list">
        {items.map((item) => (
          <article className="artSkinItem" role="listitem" key={item.id}>
            <div className="skinCardMedia">
              <button
                type="button"
                className="artSkinPreview"
                onClick={() => onPick(item)}
                aria-label={'Use card skin ' + item.title}
              >
                <CatalogArtwork item={item} alt={item.mediaAlt || item.title} />
              </button>
              <SkinActions
                item={item}
                isFavorite={favoriteIds.has(String(item.id))}
                onPick={onPick}
                onFavorite={onFavorite}
                onMenu={onMenu}
              />
            </div>
            <div className="artSkinMeta">
              <strong>{item.title}</strong>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SkeletonGrid({ count = 8 }) {
  return (
    <div className="storeCatalogGrid skeletonGrid" aria-label="Loading card skins" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="skeletonCard" key={index}>
          <div className="skeletonMedia" />
          <div className="skeletonLine" />
        </div>
      ))}
    </div>
  );
}

function StoreCatalog({
  storeName,
  categoryLabel,
  items,
  total,
  loading,
  error,
  onRetry,
  onPick,
  favoriteIds,
  onFavorite,
  onMenu
}) {
  const countLabel = total > 0
    ? items.length.toLocaleString() + ' of ' + total.toLocaleString()
    : items.length.toLocaleString() + ' loaded';

  return (
    <section className="browseSection storeCatalogSection" aria-label={storeName + ' catalog'}>
      <div className="browseHeading">
        <div>
          <h2>{categoryLabel || storeName}</h2>
          <small className="catalogSourceName">{storeName}</small>
        </div>
        <span>{countLabel}</span>
      </div>

      {error && !items.length ? (
        <div className="stateCard" role="alert">
          <strong>Could not load card skins</strong>
          <span>{error}</span>
          <button type="button" className="secondaryAction" onClick={onRetry}>Retry</button>
        </div>
      ) : null}

      {loading && !items.length ? <SkeletonGrid /> : null}

      {items.length ? (
        <div className="storeCatalogGrid" role="list">
          {items.map((item) => (
            <article className="storeCatalogItem" role="listitem" key={item.id}>
              <div className="skinCardMedia">
                <button
                  type="button"
                  className="storeCatalogPreview"
                  onClick={() => onPick(item)}
                  aria-label={'Use ' + item.title}
                >
                  <CatalogArtwork item={item} alt={item.mediaAlt || item.title} />
                </button>
                <SkinActions
                  item={item}
                  isFavorite={favoriteIds.has(String(item.id))}
                  onPick={onPick}
                  onFavorite={onFavorite}
                  onMenu={onMenu}
                />
              </div>
              <div className="storeCatalogMeta">
                <strong>{item.title}</strong>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {loading && items.length ? (
        <div className="inlineLoading"><span className="spinner" aria-hidden="true" />Loading more…</div>
      ) : null}

      {!loading && !error && !items.length ? (
        <div className="stateCard">
          <strong>No card skins found</strong>
          <span>Try another collection or search term.</span>
        </div>
      ) : null}
    </section>
  );
}

function Modal({ title, children, onClose, className = '' }) {
  const sheetRef = useRef(null);
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    const frame = requestAnimationFrame(() => closeRef.current?.focus());

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        sheetRef.current?.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        ) || []
      ).filter((element) => !element.hasAttribute('hidden'));

      if (!focusable.length) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  return (
    <div className="modalBackdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={sheetRef} className={'modalSheet ' + className} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modalHeader">
          <h2>{title}</h2>
          <button ref={closeRef} type="button" className="modalClose" onClick={onClose} aria-label={'Close ' + title}>×</button>
        </div>
        {children}
      </section>
    </div>
  );
}

function loadSearchImage(src, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    let settled = false;

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      callback();
    };

    const timer = window.setTimeout(() => {
      img.src = '';
      finish(() => reject(new Error('Artwork image timed out')));
    }, timeoutMs);

    img.onload = () => finish(() => resolve(img));
    img.onerror = () => finish(() => reject(new Error('Artwork image failed')));
    img.src = src;
  });
}


function readAscii(bytes, offset, length) {
  let output = '';
  for (let i = 0; i < length && offset + i < bytes.length; i += 1) {
    output += String.fromCharCode(bytes[offset + i]);
  }
  return output;
}

function readUint24LE(bytes, offset) {
  return (
    Number(bytes[offset] || 0) |
    (Number(bytes[offset + 1] || 0) << 8) |
    (Number(bytes[offset + 2] || 0) << 16)
  ) >>> 0;
}

function plausibleImageDimensions(width, height) {
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0 &&
    width <= 1_000_000 &&
    height <= 1_000_000
  );
}

function svgNumericLength(tag, name) {
  const attributePattern =
    "\\b" + name + "\\s*=\\s*[\\\"']\\s*([^\\\"']+)\\s*[\\\"']";
  const attribute = tag.match(new RegExp(attributePattern, 'i'));
  if (!attribute) return 0;

  const value = String(attribute[1] || '').trim();
  const match = value.match(
    /^([-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?)\\s*(px|pt|pc|in|cm|mm|q)?$/i
  );
  if (!match) return Number.NaN;

  const number = Number(match[1]);
  if (!Number.isFinite(number)) return Number.NaN;

  const unit = String(match[2] || 'px').toLowerCase();
  const factor = {
    px: 1,
    pt: 96 / 72,
    pc: 16,
    in: 96,
    cm: 96 / 2.54,
    mm: 96 / 25.4,
    q: 96 / 101.6
  }[unit];

  return Number.isFinite(factor) ? number * factor : Number.NaN;
}

async function probeLocalImageDimensions(blob) {
  const sourceType = String(blob?.type || '').toLowerCase();
  const sourceName = String(blob?.name || '');
  const isSvg =
    sourceType === 'image/svg+xml' ||
    /\.svg$/i.test(sourceName);

  if (isSvg) {
    const markup = await blob.text();
    const root = markup.match(/<\s*svg\b[^>]*>/i)?.[0] || '';
    let width = svgNumericLength(root, 'width');
    let height = svgNumericLength(root, 'height');

    if (Number.isNaN(width) || Number.isNaN(height)) return null;

    if (!width || !height) {
      const viewBox = root.match(/\bviewBox\s*=\s*["']\s*[-+0-9.eE]+\s+[-+0-9.eE]+\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s*["']/i);
      if (viewBox) {
        width ||= Math.abs(Number(viewBox[1]));
        height ||= Math.abs(Number(viewBox[2]));
      }
    }

    return plausibleImageDimensions(width, height) ? { width, height } : null;
  }

  const probe = new Uint8Array(
    await blob.slice(0, Math.min(Number(blob.size || 0), MAX_IMAGE_PROBE_BYTES)).arrayBuffer()
  );
  if (probe.length < 10) return null;
  const view = new DataView(probe.buffer, probe.byteOffset, probe.byteLength);

  // PNG/APNG: signature + IHDR width/height. APNG normally uses the
  // standard image/png MIME type, so detect its acTL animation chunk here.
  if (
    probe.length >= 24 &&
    probe[0] === 0x89 &&
    readAscii(probe, 1, 3) === 'PNG' &&
    readAscii(probe, 12, 4) === 'IHDR'
  ) {
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    let animated = false;
    let chunkOffset = 8;

    while (chunkOffset + 12 <= probe.length) {
      const chunkLength = view.getUint32(chunkOffset, false);
      const chunkType = readAscii(probe, chunkOffset + 4, 4);
      if (chunkType === 'acTL') {
        animated = true;
        break;
      }
      if (chunkType === 'IDAT' || chunkType === 'IEND') break;

      const nextOffset = chunkOffset + 12 + chunkLength;
      if (nextOffset <= chunkOffset || nextOffset > probe.length) break;
      chunkOffset = nextOffset;
    }

    return plausibleImageDimensions(width, height)
      ? { width, height, animated }
      : null;
  }

  // GIF logical screen dimensions.
  if (readAscii(probe, 0, 3) === 'GIF') {
    const width = view.getUint16(6, true);
    const height = view.getUint16(8, true);
    return plausibleImageDimensions(width, height) ? { width, height } : null;
  }

  // JPEG SOF dimensions. Scanning only the bounded prefix avoids decoding pixels.
  if (probe[0] === 0xff && probe[1] === 0xd8) {
    const sofMarkers = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
      0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
    ]);
    let offset = 2;

    while (offset + 8 < probe.length) {
      if (probe[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (offset < probe.length && probe[offset] === 0xff) offset += 1;
      if (offset >= probe.length) break;

      const marker = probe[offset];
      offset += 1;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 1 >= probe.length) break;

      const length = view.getUint16(offset, false);
      if (length < 2 || offset + length > probe.length) break;

      if (sofMarkers.has(marker) && length >= 7) {
        const height = view.getUint16(offset + 3, false);
        const width = view.getUint16(offset + 5, false);
        return plausibleImageDimensions(width, height) ? { width, height } : null;
      }
      offset += length;
    }
  }

  // WebP VP8X / VP8 / VP8L dimensions.
  if (
    probe.length >= 30 &&
    readAscii(probe, 0, 4) === 'RIFF' &&
    readAscii(probe, 8, 4) === 'WEBP'
  ) {
    const chunk = readAscii(probe, 12, 4);
    if (chunk === 'VP8X') {
      const width = 1 + readUint24LE(probe, 24);
      const height = 1 + readUint24LE(probe, 27);
      return plausibleImageDimensions(width, height) ? { width, height } : null;
    }
    if (
      chunk === 'VP8 ' &&
      probe[23] === 0x9d &&
      probe[24] === 0x01 &&
      probe[25] === 0x2a
    ) {
      const width = view.getUint16(26, true) & 0x3fff;
      const height = view.getUint16(28, true) & 0x3fff;
      return plausibleImageDimensions(width, height) ? { width, height } : null;
    }
    if (chunk === 'VP8L' && probe[20] === 0x2f) {
      const width = 1 + (probe[21] | ((probe[22] & 0x3f) << 8));
      const height =
        1 +
        ((probe[22] >> 6) |
          (probe[23] << 2) |
          ((probe[24] & 0x0f) << 10));
      return plausibleImageDimensions(width, height) ? { width, height } : null;
    }
  }

  // AVIF/HEIF commonly expose an Image Spatial Extents ('ispe') box in the
  // metadata prefix. Use it only for ISO-BMFF image MIME/extensions.
  if (
    /image\/(?:avif|heic|heif)/.test(sourceType) ||
    /\.(?:avif|heic|heif)$/i.test(sourceName)
  ) {
    for (let i = 4; i + 16 <= probe.length; i += 1) {
      if (readAscii(probe, i, 4) !== 'ispe') continue;

      // 'ispe' is a FullBox: size + type + version/flags + width + height.
      // Validate the enclosing box before trusting dimension-looking bytes.
      const boxStart = i - 4;
      const boxSize = view.getUint32(boxStart, false);
      if (boxSize < 20 || boxStart + boxSize > probe.length) continue;

      const width = view.getUint32(i + 8, false);
      const height = view.getUint32(i + 12, false);
      if (plausibleImageDimensions(width, height)) return { width, height };
    }
  }

  return null;
}

function assertSafeSourceDimensions(dimensions) {
  if (!dimensions) return;
  const width = Number(dimensions.width || 0);
  const height = Number(dimensions.height || 0);
  if (
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new Error('Image dimensions are too large');
  }
}

function decodeLocalImageBlob(blob, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = 'async';
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      img.onload = null;
      img.onerror = null;
    };

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const timer = window.setTimeout(() => {
      img.src = '';
      finish(() => reject(new Error('Image decode timed out')));
    }, timeoutMs);

    img.onload = () => {
      const width = Number(img.naturalWidth || img.width || 0);
      const height = Number(img.naturalHeight || img.height || 0);
      finish(() => {
        if (!width || !height) {
          reject(new Error('Image dimensions could not be read'));
          return;
        }
        if (
          width > MAX_IMAGE_DIMENSION ||
          height > MAX_IMAGE_DIMENSION ||
          width * height > MAX_IMAGE_PIXELS
        ) {
          reject(new Error('Image dimensions are too large'));
          return;
        }
        resolve({ image: img, width, height });
      });
    };

    img.onerror = () => {
      finish(() => reject(new Error('Image could not be decoded')));
    };

    img.src = url;
  });
}

async function validateSafeSvgBlob(blob) {
  const sourceType = String(blob?.type || '').toLowerCase();
  const sourceName = String(blob?.name || '');
  const isSvg =
    sourceType === 'image/svg+xml' ||
    /\.svg$/i.test(sourceName);
  if (!isSvg) return;

  if (Number(blob?.size || 0) > MAX_SVG_IMPORT_BYTES) {
    throw new Error('SVG is too large. Choose a vector file under 2 MB.');
  }

  const markup = await blob.text();
  const unsafeMarkup = [
    /<\s*script\b/i,
    /<\s*foreignObject\b/i,
    /<!\s*(?:DOCTYPE|ENTITY)\b/i,
    /\bon[a-z][a-z0-9_-]*\s*=/i,
    /\b(?:href|xlink:href|src)\s*=\s*["']?\s*(?!#)/i,
    /@import\b/i,
    /url\(\s*["']?\s*(?!#)/i
  ];

  if (unsafeMarkup.some((pattern) => pattern.test(markup))) {
    throw new Error('SVG contains unsupported active or remote content.');
  }

  const normalizeCssEscapes = (value) =>
    String(value || '')
      .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex) => {
        const codePoint = Number.parseInt(hex, 16);
        return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : '';
      })
      .replace(/\\([^\r\n])/g, '$1');

  const hasUnsafeCssReference = (value) => {
    const css = normalizeCssEscapes(value);
    if (/@import\b|expression\s*\(|javascript\s*:/i.test(css)) return true;

    for (const match of css.matchAll(/url\(\s*([^)]*?)\s*\)/gi)) {
      const target = String(match[1] || '').trim().replace(/^["']|["']$/g, '').trim();
      if (target && !target.startsWith('#')) return true;
    }
    return false;
  };

  if (typeof DOMParser !== 'undefined') {
    const documentNode = new DOMParser().parseFromString(markup, 'image/svg+xml');
    if (documentNode.querySelector('parsererror')) {
      throw new Error('SVG could not be parsed safely.');
    }

    const forbiddenElements = new Set([
      'script',
      'foreignobject',
      'iframe',
      'object',
      'embed',
      'audio',
      'video',
      'animate',
      'animatetransform',
      'animatemotion',
      'set'
    ]);

    for (const element of documentNode.querySelectorAll('*')) {
      const tag = String(element.localName || element.tagName || '').toLowerCase();
      if (forbiddenElements.has(tag)) {
        throw new Error('SVG contains unsupported active or remote content.');
      }

      if (tag === 'style' && hasUnsafeCssReference(element.textContent || '')) {
        throw new Error('SVG contains unsupported active or remote content.');
      }

      for (const attribute of Array.from(element.attributes || [])) {
        const name = String(attribute.name || '').toLowerCase();
        const value = String(attribute.value || '').trim();

        if (name.startsWith('on') || name === 'xml:base') {
          throw new Error('SVG contains unsupported active or remote content.');
        }

        if (name === 'href' || name === 'xlink:href' || name === 'src') {
          if (value && !value.startsWith('#')) {
            throw new Error('SVG contains unsupported active or remote content.');
          }
        }

        if (hasUnsafeCssReference(value)) {
          throw new Error('SVG contains unsupported active or remote content.');
        }
      }
    }
  }
}

async function prepareLocalImageBlob(blob, limits = {}) {
  await validateSafeSvgBlob(blob);
  const probedDimensions = await probeLocalImageDimensions(blob);
  assertSafeSourceDimensions(probedDimensions);

  const sourceType = String(blob.type || '').toLowerCase();
  const sourceName = String(blob.name || '');
  const svgSource =
    sourceType === 'image/svg+xml' ||
    /\.svg$/i.test(sourceName);

  if (svgSource && !probedDimensions) {
    throw new Error('SVG dimensions could not be verified safely.');
  }

  if (!probedDimensions && Number(blob?.size || 0) > MAX_UNPROBED_IMAGE_BYTES) {
    throw new Error('Image dimensions could not be verified safely');
  }

  const decoded = await decodeLocalImageBlob(blob);
  const { image, width, height } = decoded;
  const maxPixels = Math.max(
    1,
    Number(limits.maxPixels || MAX_STORED_IMAGE_PIXELS)
  );
  const maxDimension = Math.max(
    1,
    Number(limits.maxDimension || MAX_STORED_IMAGE_DIMENSION)
  );
  const pixelScale = Math.sqrt(maxPixels / Math.max(1, width * height));
  const dimensionScale = maxDimension / Math.max(width, height);
  const scale = Math.min(1, pixelScale, dimensionScale);
  const animatedOrVectorSource =
    Boolean(probedDimensions?.animated) ||
    /^image\/(?:gif|apng|svg\+xml)$/.test(sourceType) ||
    /\.(?:gif|apng|svg)$/i.test(sourceName);
  const needsFormatNormalization =
    animatedOrVectorSource ||
    /^image\/(?:webp|avif|heic|heif)$/.test(sourceType) ||
    /\.(?:webp|avif|heic|heif)$/i.test(sourceName);

  if (scale >= 0.999 && !needsFormatNormalization) {
    // Detach File-backed imports from the picker before IndexedDB storage.
    // WebKit can reject structured-cloning a live File object even though an
    // equivalent plain Blob is fully supported.
    const storedBlob = blob.slice(0, blob.size, blob.type || 'application/octet-stream');
    image.src = '';
    return { blob: storedBlob, width, height, optimized: false };
  }

  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) {
    image.src = '';
    throw new Error('Image optimization is unavailable');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

  const outputType =
    /^image\/(?:jpe?g|heic|heif)$/.test(sourceType) || /\.(?:heic|heif)$/i.test(sourceName)
      ? 'image/jpeg'
      : animatedOrVectorSource || /^image\/(?:webp|avif)$/.test(sourceType)
        ? 'image/webp'
        : 'image/png';
  const outputQuality = outputType === 'image/jpeg'
    ? 0.94
    : outputType === 'image/webp'
      ? 0.92
      : undefined;
  const encodeCanvas = (type, quality) => new Promise((resolve) => {
    canvas.toBlob((result) => resolve(result || null), type, quality);
  });

  let optimizedBlob;
  try {
    optimizedBlob = await encodeCanvas(outputType, outputQuality);
    if (!optimizedBlob && outputType !== 'image/png') {
      optimizedBlob = await encodeCanvas('image/png');
    }
    if (!optimizedBlob) {
      throw new Error('Image optimization failed');
    }
    if (optimizedBlob.size > MAX_IMAGE_IMPORT_BYTES) {
      throw new Error('Image remains too large after optimization');
    }
  } finally {
    canvas.width = 1;
    canvas.height = 1;
    image.src = '';
  }

  return {
    blob: optimizedBlob,
    width: targetWidth,
    height: targetHeight,
    optimized: true
  };
}

function inspectSearchImage(img, preferDirectAsset = false) {
  const naturalRatio = img.naturalWidth / img.naturalHeight;
  const width = 128;
  const height = Math.max(48, Math.min(128, Math.round(width / Math.max(0.5, naturalRatio))));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { reject: false, score: 0, ratio: naturalRatio, sourceCrop: null };

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  let nearWhite = 0;
  let lightNeutral = 0;
  let transparent = 0;
  let colorful = 0;
  let edgePixels = 0;
  let edgeLightNeutral = 0;
  let edgeNearWhite = 0;
  let luminanceSum = 0;
  let luminanceSqSum = 0;
  let contentMinX = canvas.width;
  let contentMinY = canvas.height;
  let contentMaxX = -1;
  let contentMaxY = -1;
  const edgeBand = 4;

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const i = (y * canvas.width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a < 20) {
        transparent += 1;
        continue;
      }

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const spread = max - min;
      const lum = (r + g + b) / 3;
      const white = r > 242 && g > 242 && b > 242;
      const neutral = lum > 205 && spread < 32;
      const color = spread > 48 && lum > 35 && lum < 235;

      if (white) nearWhite += 1;
      if (neutral) lightNeutral += 1;
      if (color) colorful += 1;
      luminanceSum += lum;
      luminanceSqSum += lum * lum;

      // Direct Shopify card art often lives on a larger white/transparent PNG.
      // Detect the actual printed-card bounds so the editor can crop to it.
      if (!white || spread > 18 || lum < 235) {
        contentMinX = Math.min(contentMinX, x);
        contentMinY = Math.min(contentMinY, y);
        contentMaxX = Math.max(contentMaxX, x);
        contentMaxY = Math.max(contentMaxY, y);
      }

      const edge =
        x < edgeBand ||
        y < edgeBand ||
        x >= canvas.width - edgeBand ||
        y >= canvas.height - edgeBand;

      if (edge) {
        edgePixels += 1;
        if (neutral) edgeLightNeutral += 1;
        if (white) edgeNearWhite += 1;
      }
    }
  }

  const total = canvas.width * canvas.height;
  const opaque = Math.max(1, total - transparent);
  const whiteRatio = nearWhite / opaque;
  const lightNeutralRatio = lightNeutral / opaque;
  const transparentRatio = transparent / total;
  const edgeNeutralRatio = edgePixels ? edgeLightNeutral / edgePixels : 0;
  const edgeWhiteRatio = edgePixels ? edgeNearWhite / edgePixels : 0;
  const colorfulRatio = colorful / opaque;
  const mean = luminanceSum / opaque;
  const variance = Math.max(0, luminanceSqSum / opaque - mean * mean);
  const ratioPenalty = Math.abs(Math.log(Math.max(0.2, naturalRatio) / CARD_RATIO));

  let sourceCrop = null;
  if (contentMaxX >= contentMinX && contentMaxY >= contentMinY) {
    const pad = 1;
    const minX = Math.max(0, contentMinX - pad);
    const minY = Math.max(0, contentMinY - pad);
    const maxX = Math.min(canvas.width - 1, contentMaxX + pad);
    const maxY = Math.min(canvas.height - 1, contentMaxY + pad);
    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;
    const cropRatio = cropW / cropH;
    const cropCoverage = (cropW * cropH) / total;
    const hasOuterCanvas = whiteRatio > 0.16 || transparentRatio > 0.08;

    if (
      preferDirectAsset &&
      hasOuterCanvas &&
      cropCoverage > 0.16 &&
      cropCoverage < 0.9 &&
      cropRatio >= 1.28 &&
      cropRatio <= 2.05
    ) {
      sourceCrop = {
        x: minX / canvas.width,
        y: minY / canvas.height,
        w: cropW / canvas.width,
        h: cropH / canvas.height
      };
    }
  }

  const obviousMockup =
    (edgeNeutralRatio > 0.58 && lightNeutralRatio > 0.16) ||
    (edgeWhiteRatio > 0.5 && whiteRatio > 0.12) ||
    whiteRatio > 0.5;

  const nearlyBlank = variance < 180 && colorfulRatio < 0.025;
  const extremeShape = naturalRatio < 0.55 || naturalRatio > 3.2;
  const reject =
    nearlyBlank ||
    extremeShape ||
    (!preferDirectAsset && obviousMockup) ||
    (preferDirectAsset && obviousMockup && !sourceCrop);

  const score =
    colorfulRatio * 42 +
    Math.min(variance / 1800, 2) * 8 -
    whiteRatio * (sourceCrop ? 4 : 34) -
    edgeNeutralRatio * (sourceCrop ? 3 : 30) -
    ratioPenalty * (sourceCrop ? 1 : 8) +
    (sourceCrop ? 40 : 0) +
    (preferDirectAsset ? 5 : 0);

  return {
    reject,
    score,
    ratio: sourceCrop ? (sourceCrop.w * canvas.width) / (sourceCrop.h * canvas.height) : naturalRatio,
    whiteRatio,
    edgeNeutralRatio,
    sourceCrop
  };
}

async function chooseCleanProductMedia(item) {
  const inspectUrls = Array.isArray(item.inspectUrls) ? item.inspectUrls.slice(0, 3) : [];

  // CUCU products use server-side, edge-cached pixel analysis. This keeps
  // Discover thumbnail-only and makes crop/usability metadata reusable across users.
  for (const inspectUrl of inspectUrls) {
    try {
      const response = await fetch(inspectUrl);
      const meta = await response.json();
      if (!response.ok || !meta?.usable || !meta?.full || !meta?.thumbnail) continue;

      const inspectedCrop = normalizeCrop(meta.crop, 0.01);
      return {
        ...item,
        image: meta.full,
        thumbnail: meta.thumbnail,
        visualQuality: 'server-preprocessed',
        visualScore: Number(meta.quality?.variance || 0),
        // CUCU and AnimeDeskMat intentionally share one crop authority.
        sourceCrop: inspectedCrop || null,
        mediaAspectRatio: Number(meta.ratio) || null
      };
    } catch {}
  }

  // Compatibility fallback for any non-CUCU provider still used internally.
  const candidates = [...new Set([item.image, ...(item.candidateImages || [])].filter(Boolean))].slice(0, 8);
  const preferDirectAsset = item.assetMode === 'direct-card-art';
  let best = null;

  for (const src of candidates) {
    try {
      const img = await loadSearchImage(src);
      const quality = inspectSearchImage(img, preferDirectAsset);
      if (quality.reject) continue;
      if (!best || quality.score > best.quality.score) {
        best = { src, quality };
      }

      if (preferDirectAsset && quality.sourceCrop) break;
      if (quality.score > 17 && quality.edgeNeutralRatio < 0.16) break;
    } catch {}
  }

  if (!best) return null;

  return {
    ...item,
    image: best.src,
    visualQuality: 'client-checked',
    visualScore: Math.round(best.quality.score * 100) / 100,
    sourceCrop: best.quality.sourceCrop || null,
    mediaAspectRatio: best.quality.ratio || item.mediaAspectRatio || null
  };
}

async function prepareCleanResults(items, maxItems = items.length) {
  const queue = items.slice(0, maxItems);
  const resolved = new Array(queue.length);
  let cursor = 0;

  async function worker() {
    while (cursor < queue.length) {
      const index = cursor;
      cursor += 1;
      resolved[index] = await chooseCleanProductMedia(queue[index]);
    }
  }

  await Promise.all([worker(), worker(), worker(), worker()]);
  return resolved.filter(Boolean);
}

function normalizeImportArtworkSource(src = '') {
  const source = String(src || '').trim();
  const match = source.match(/^idb:\/\/imports\/([A-Za-z0-9._:-]{1,200})$/);
  return match ? 'idb://imports/' + match[1] : '';
}

function isPersistableBackground(src = '') {
  const source = String(src || '').trim();
  if (normalizeImportArtworkSource(source)) return true;
  return source.startsWith('/api/image?') && Boolean(proxyImageWidth(source, 3072));
}

function normalizePersistedArtworkSource(src = '', width = 3072) {
  const source = String(src || '').trim();
  if (!source) return '';

  const imported = normalizeImportArtworkSource(source);
  if (imported) return imported;

  if (source.startsWith('/api/image?') || /^https:\/\//i.test(source)) {
    const proxied = proxyImageWidth(source, width);
    return proxied.startsWith('/api/image?') ? proxied : '';
  }

  return '';
}

function estimateDataUrlBytes(value = '') {
  const text = String(value);
  const comma = text.indexOf(',');
  if (comma < 0 || !/;base64/i.test(text.slice(0, comma))) return Infinity;

  const payloadLength = text.length - comma - 1;
  let padding = 0;
  if (text.endsWith('==')) padding = 2;
  else if (text.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor((payloadLength * 3) / 4) - padding);
}

function safeDisplayText(value, fallback, maxLength = 120) {
  const raw =
    typeof value === 'string' || typeof value === 'number'
      ? String(value).trim()
      : '';
  return splitGraphemes(raw || fallback).slice(0, maxLength).join('');
}

function normalizeStoredArtworkItem(item) {
  if (!item || typeof item !== 'object' || !item.id) return null;
  const id = safeDisplayText(item.id, '', 160);
  const image = normalizePersistedArtworkSource(item.image, 3072);
  if (!id || !image || image.startsWith('idb://imports/')) return null;

  const thumbnailSource =
    typeof item.thumbnail === 'string' && item.thumbnail.trim()
      ? item.thumbnail
      : image;

  return {
    id,
    title: safeDisplayText(item.title, 'Card Skin', 160),
    image,
    thumbnail: proxyImageWidth(thumbnailSource, 560),
    sourceCrop: normalizeCrop(item.sourceCrop, 0.1),
    mediaAspectRatio:
      Number.isFinite(Number(item.mediaAspectRatio)) && Number(item.mediaAspectRatio) > 0
        ? Number(item.mediaAspectRatio)
        : null
  };
}

function importListItem(asset = {}) {
  return {
    id: safeDisplayText(asset.id, '', 160),
    name: safeDisplayText(asset.name, 'Imported image', 160),
    type: safeDisplayText(asset.type, 'image/*', 80),
    createdAt: finiteNumber(asset.createdAt, Date.now())
  };
}

function visibleImageLayers(value) {
  return (value?.customLayers || []).filter(
    (layer) => layer.type === 'image' && layer.src && !layer.hidden
  );
}

function imageLayerSourceKeyForDesign(value) {
  return JSON.stringify(
    visibleImageLayers(value).map((layer) => ({ id: layer.id, src: layer.src }))
  );
}

export default function Page() {
  const [tab, setTab] = useState('discover');
  const [studioTool, setStudioTool] = useState('crop');
  const [studioSubtool, setStudioSubtool] = useState('');
  const [studioMenuOpen, setStudioMenuOpen] = useState(false);

  // Each bottom-tab screen is a fresh navigation destination. Reset the
  // document and any app-level scroll container after the destination mounts.
  useEffect(() => {
    const resetScroll = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      const screen = document.querySelector('.tabScreen:not([hidden])');
      if (screen && 'scrollTop' in screen) screen.scrollTop = 0;
    };
    resetScroll();
    const frame = requestAnimationFrame(resetScroll);
    return () => cancelAnimationFrame(frame);
  }, [tab]);
  const [design, setDesign] = useState(DEFAULTS);
  const [image, setImage] = useState(null);
  const [loadedBackgroundKey, setLoadedBackgroundKey] = useState('');
  const [recent, setRecent] = useState([]);
  const [message, setMessage] = useState('Ready');
  const [saveStatus, setSaveStatus] = useState('Saved');
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [favorites, setFavorites] = useState([]);
  const [projects, setProjects] = useState([]);
  const [projectName, setProjectName] = useState('');
  const [projectBusyIds, setProjectBusyIds] = useState(new Set());
  const [projectSaveInProgress, setProjectSaveInProgress] = useState(false);
  const [imports, setImports] = useState([]);
  const [cleanupInProgress, setCleanupInProgress] = useState(false);
  const [presetTransferInProgress, setPresetTransferInProgress] = useState(false);
  const [exportInProgress, setExportInProgress] = useState(false);
  const [exportHistory, setExportHistory] = useState([]);
  const [expertMode, setExpertMode] = useState(false);
  const [guidesEnabled, setGuidesEnabled] = useState(false);
  const [activeGuides, setActiveGuides] = useState({ x: null, y: null });
  const [selectedElement, setSelectedElement] = useState('artwork');
  const [previewMode, setPreviewMode] = useState('flat');
  const [showOriginal, setShowOriginal] = useState(false);
  const [showExportPreview, setShowExportPreview] = useState(false);
  const [menuItem, setMenuItem] = useState(null);
  const [installHelp, setInstallHelp] = useState(false);
  const [online, setOnline] = useState(true);
  const [query, setQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [featured, setFeatured] = useState({});
  const [catalogError, setCatalogError] = useState('');
  const [cucuCategory, setCucuCategory] = useState('all');
  const [cucuCategoryLabel, setCucuCategoryLabel] = useState('All Card Skins');
  const [cucuItems, setCucuItems] = useState([]);
  const [cucuPage, setCucuPage] = useState(0);
  const [cucuTotal, setCucuTotal] = useState(2225);
  const [cucuHasMore, setCucuHasMore] = useState(true);
  const [cucuLoading, setCucuLoading] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [autosaveReady, setAutosaveReady] = useState(false);
  const [layerImages, setLayerImages] = useState({});
  const [loadedImageLayerSourceKey, setLoadedImageLayerSourceKey] = useState('[]');
  const [backgroundLoadError, setBackgroundLoadError] = useState('');
  const [layerLoadError, setLayerLoadError] = useState('');
  const [imageImportInProgress, setImageImportInProgress] = useState(false);
  const canvasRef = useRef(null);
  const fullPreviewCanvasRef = useRef(null);
  const uploadRef = useRef(null);
  const uploadIntentRef = useRef('replace-artwork');
  const layerUploadRef = useRef(null);
  const presetImportRef = useRef(null);
  const loadMoreRef = useRef(null);
  const pointers = useRef(new Map());
  const lastPoint = useRef(null);
  const lastDistance = useRef(null);
  const lastAngle = useRef(null);
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const designRef = useRef(DEFAULTS);
  const historyGroupRef = useRef({ key: '', at: 0 });
  const catalogLoadingRef = useRef(false);
  const catalogIntentRef = useRef('all\u0000');
  const gestureTarget = useRef('artwork');
  const gestureStartDesign = useRef(null);
  const gestureHistoryRecorded = useRef(false);
  const draftSaveQueueRef = useRef(Promise.resolve());
  const draftSaveVersionRef = useRef(0);
  const autosavePausedBaselineRef = useRef(null);
  const favoriteOpsRef = useRef(new Set());
  const projectSaveInFlightRef = useRef(false);
  const projectOpsRef = useRef(new Set());
  const presetTransferInFlightRef = useRef(false);
  const presetImportGenerationRef = useRef(0);
  const presetImportActiveRef = useRef(false);
  const cleanupInFlightRef = useRef(false);
  const exportInFlightRef = useRef(false);
  const imageImportInFlightRef = useRef(false);
  const imageImportGenerationRef = useRef(0);
  const pendingDesignFrameRef = useRef(0);
  const pendingVisualDesignRef = useRef(null);
  const gesturePreviewFrameRef = useRef(0);
  const finishActiveGestureRef = useRef(null);

  const gradient = useMemo(
    () => GRADIENTS.find((item) => item.id === design.gradient) || GRADIENTS[0],
    [design.gradient]
  );

  const imageLayerSourceKey = useMemo(
    () => imageLayerSourceKeyForDesign(design),
    [design]
  );

  const assetsReadyForDesign = useCallback((candidate) => {
    if (candidate.background && (!image || loadedBackgroundKey !== candidate.background)) return false;
    const candidateLayerKey = imageLayerSourceKeyForDesign(candidate);
    if (loadedImageLayerSourceKey !== candidateLayerKey) return false;
    return (candidate.customLayers || []).every(
      (layer) =>
        layer.hidden ||
        layer.type !== 'image' ||
        !layer.src ||
        Boolean(layerImages[layer.id])
    );
  }, [image, layerImages, loadedBackgroundKey, loadedImageLayerSourceKey]);

  const renderAssetsReady = useMemo(
    () => assetsReadyForDesign(design),
    [assetsReadyForDesign, design]
  );

  const replaceDesign = useCallback((nextDesign, shouldNormalize = true, deferVisual = false) => {
    const resolved = shouldNormalize ? normalizeDesignState(nextDesign) : nextDesign;
    designRef.current = resolved;

    if (deferVisual && typeof window !== 'undefined') {
      pendingVisualDesignRef.current = resolved;
      if (!pendingDesignFrameRef.current) {
        pendingDesignFrameRef.current = window.requestAnimationFrame(() => {
          pendingDesignFrameRef.current = 0;
          const pending = pendingVisualDesignRef.current;
          pendingVisualDesignRef.current = null;
          if (pending) setDesign(pending);
        });
      }
      return resolved;
    }

    if (pendingDesignFrameRef.current && typeof window !== 'undefined') {
      window.cancelAnimationFrame(pendingDesignFrameRef.current);
      pendingDesignFrameRef.current = 0;
    }
    pendingVisualDesignRef.current = null;
    setDesign(resolved);
    return resolved;
  }, []);

  const patch = useCallback((next, recordHistory = true, historyKey = '') => {
    if (
      recordHistory &&
      (pointers.current.size > 0 || gestureStartDesign.current) &&
      typeof finishActiveGestureRef.current === 'function'
    ) {
      finishActiveGestureRef.current();
    }

    if (cleanupInFlightRef.current) {
      setMessage('Finish cleaning imported images before editing.');
      return designRef.current;
    }

    if (presetImportActiveRef.current) {
      presetImportGenerationRef.current += 1;
    }

    const current = designRef.current;
    const delta = typeof next === 'function' ? next(current) : next;
    const deltaKeys = Object.keys(delta || {});
    if (!deltaKeys.length) return current;

    const updated = { ...current, ...delta };
    const changed = deltaKeys.some((key) => !Object.is(current[key], updated[key]));
    if (!changed) return current;

    let historyGroupKey = '';

    if (recordHistory) {
      const now = Date.now();
      const autoKey = deltaKeys.length === 1 ? deltaKeys[0] : '';
      const autoValue = autoKey ? delta[autoKey] : undefined;
      const canAutoGroup =
        !historyKey &&
        typeof next !== 'function' &&
        Boolean(autoKey) &&
        typeof autoValue !== 'boolean' &&
        !DISCRETE_DESIGN_HISTORY_KEYS.has(autoKey);
      historyGroupKey = historyKey || (canAutoGroup ? 'design:' + autoKey : '');
      const previousGroup = historyGroupRef.current;
      const coalesced = Boolean(
        historyGroupKey &&
        previousGroup.key === historyGroupKey &&
        now - previousGroup.at < 700
      );

      if (!coalesced) {
        undoRef.current = [...undoRef.current.slice(-49), current];
        setHistoryVersion((value) => value + 1);
      }

      redoRef.current = [];
      historyGroupRef.current = { key: historyGroupKey, at: now };
    }

    // Continuous controls already clamp/sanitize at their own input boundary.
    // Avoid remapping every layer and rebuilding z-order on each slider/text tick.
    const shouldNormalize = recordHistory && !historyGroupKey;
    const resolved = replaceDesign(updated, shouldNormalize, !recordHistory);
    return resolved;
  }, [replaceDesign]);

  useEffect(() => {
    return () => {
      if (pendingDesignFrameRef.current) {
        window.cancelAnimationFrame(pendingDesignFrameRef.current);
        pendingDesignFrameRef.current = 0;
      }
      if (gesturePreviewFrameRef.current) {
        window.cancelAnimationFrame(gesturePreviewFrameRef.current);
        gesturePreviewFrameRef.current = 0;
      }
      pendingVisualDesignRef.current = null;
    };
  }, []);

  const finishActiveGesture = useCallback(() => {
    const active =
      pointers.current.size > 0 ||
      Boolean(gestureStartDesign.current) ||
      gestureHistoryRecorded.current ||
      Boolean(gesturePreviewFrameRef.current);
    if (!active) return;

    if (gestureHistoryRecorded.current) {
      replaceDesign(designRef.current);
    }

    const canvas = canvasRef.current;
    if (canvas && typeof canvas.releasePointerCapture === 'function') {
      for (const pointerId of pointers.current.keys()) {
        try {
          if (!canvas.hasPointerCapture || canvas.hasPointerCapture(pointerId)) {
            canvas.releasePointerCapture(pointerId);
          }
        } catch {}
      }
    }

    pointers.current.clear();
    lastPoint.current = null;
    lastDistance.current = null;
    lastAngle.current = null;
    gestureTarget.current = 'artwork';
    gestureStartDesign.current = null;
    gestureHistoryRecorded.current = false;
    setActiveGuides({ x: null, y: null });

    if (gesturePreviewFrameRef.current) {
      window.cancelAnimationFrame(gesturePreviewFrameRef.current);
      gesturePreviewFrameRef.current = 0;
    }
  }, [replaceDesign]);

  finishActiveGestureRef.current = finishActiveGesture;

  useEffect(() => {
    if (tab === 'studio' && previewMode === 'flat') return;
    finishActiveGesture();
  }, [finishActiveGesture, previewMode, tab]);

  const undo = useCallback(() => {
    finishActiveGesture();
    if (cleanupInFlightRef.current) {
      setMessage('Finish cleaning imported images before using Undo.');
      return;
    }
    invalidatePendingImageImport();
    invalidatePendingPresetImport();
    historyGroupRef.current = { key: '', at: 0 };
    const previous = undoRef.current.pop();
    if (!previous) return;

    const current = designRef.current;
    redoRef.current = [...redoRef.current.slice(-49), current];
    replaceDesign(previous);
    setHistoryVersion((value) => value + 1);
    setMessage('Undid change');
  }, [finishActiveGesture, replaceDesign]);

  const redo = useCallback(() => {
    finishActiveGesture();
    if (cleanupInFlightRef.current) {
      setMessage('Finish cleaning imported images before using Redo.');
      return;
    }
    invalidatePendingImageImport();
    invalidatePendingPresetImport();
    historyGroupRef.current = { key: '', at: 0 };
    const next = redoRef.current.pop();
    if (!next) return;

    const current = designRef.current;
    undoRef.current = [...undoRef.current.slice(-49), current];
    replaceDesign(next);
    setHistoryVersion((value) => value + 1);
    setMessage('Redid change');
  }, [finishActiveGesture, replaceDesign]);

  const persistDraftSnapshot = useCallback((snapshot) => {
    const version = ++draftSaveVersionRef.current;
    const queuedAt = Date.now();
    const copy = JSON.parse(JSON.stringify(snapshot || designRef.current));
    if (copy.background && !isPersistableBackground(copy.background)) copy.background = '';

    const work = draftSaveQueueRef.current
      .catch(() => {})
      .then(async () => {
        let indexedDbSaved = false;
        let localSaved = false;
        const updatedAt = queuedAt;

        try {
          await dbPut('kv', {
            id: 'draft',
            design: copy,
            updatedAt
          });
          indexedDbSaved = true;
        } catch {}

        // A newer snapshot may have been queued while this IndexedDB write was
        // in flight. Never let an older job overwrite the synchronous fallback
        // copy that iOS backgrounding relies on.
        if (version === draftSaveVersionRef.current) {
          try {
            localStorage.setItem('aircard-sticker-fvp-v3', JSON.stringify(copy));
            localStorage.setItem('aircard-sticker-fvp-v3-updated-at', String(updatedAt));
            localSaved = true;
          } catch {}
        }

        return {
          success: indexedDbSaved || localSaved,
          indexedDbSaved,
          localSaved,
          updatedAt,
          version
        };
      });

    draftSaveQueueRef.current = work.then(() => undefined, () => undefined);
    return work;
  }, []);

  const rememberArtwork = useCallback((item) => {
    const normalized = normalizeStoredArtworkItem(item);
    if (!normalized) return;

    setRecent((current) => {
      const itemId = String(normalized.id);
      const next = [
        normalized,
        ...current.filter((entry) => String(entry.id) !== itemId)
      ].slice(0, 20);
      try {
        localStorage.setItem('aircard-recent-artwork-v1', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const startupDesign = designRef.current;
    let controllerChangeHandler = null;
    let controllerReloadInFlight = false;
    let reloadGuardTimer = 0;
    let serviceWorkerResumeHandler = null;

    async function hydrate() {
      let autosaveSafe = false;
      let draftReadFailed = false;

      try {
        const [draft, storedFavorites, storedProjects, storedImports, storedExports] = await Promise.all([
          dbGet('kv', 'draft').catch(() => {
            draftReadFailed = true;
            return null;
          }),
          dbGetAll('favorites').catch(() => []),
          dbGetAll('projects').catch(() => []),
          dbGetImportMetadata().catch(() => []),
          dbGetAll('exports').catch(() => [])
        ]);

        if (cancelled) return;

        let localDraft = null;
        let localUpdatedAt = 0;

        try {
          const legacy = localStorage.getItem('aircard-sticker-fvp-v3');
          localUpdatedAt = finiteNumber(
            localStorage.getItem('aircard-sticker-fvp-v3-updated-at'),
            0
          );
          if (legacy) {
            const parsed = JSON.parse(legacy);
            if (parsed && typeof parsed === 'object') localDraft = parsed;
          }
        } catch {
          try {
            localStorage.removeItem('aircard-sticker-fvp-v3');
            localStorage.removeItem('aircard-sticker-fvp-v3-updated-at');
          } catch {}
        }

        // If IndexedDB could not be read, a localStorage fallback can be
        // displayed for recovery, but it must not authorize new autosaves.
        // The unreadable IndexedDB record may be newer than the fallback.
        autosaveSafe = !draftReadFailed;

        if (designRef.current === startupDesign) {
          const indexedDraft =
            draft?.design && typeof draft.design === 'object'
              ? draft.design
              : null;
          const indexedUpdatedAt = finiteNumber(draft?.updatedAt, 0);
          const preferredDraft =
            localDraft && (!indexedDraft || localUpdatedAt >= indexedUpdatedAt)
              ? localDraft
              : indexedDraft;

          if (preferredDraft) {
            const parsed = { ...preferredDraft };
            parsed.background = normalizePersistedArtworkSource(parsed.background, 3072);
            replaceDesign({ ...startupDesign, ...parsed });
          }
        }

        const validFavorites = storedFavorites
          .map((entry) => ({
            ...entry,
            updatedAt: finiteNumber(entry?.updatedAt, 0),
            item: normalizeStoredArtworkItem(entry?.item)
          }))
          .filter((entry) => entry.item?.id)
          .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
        const hydratedFavoriteItems = validFavorites.map((entry) => entry.item);
        setFavorites((current) => {
          const mergedById = new Map(
            hydratedFavoriteItems.map((item) => [String(item.id), item])
          );
          for (const item of current) {
            if (item?.id) mergedById.set(String(item.id), item);
          }
          return [...mergedById.values()];
        });
        setFavoriteIds((current) => new Set([
          ...validFavorites.map((entry) => String(entry.item.id)),
          ...current
        ]));
        const hydratedProjects = storedProjects
          .filter((entry) => entry?.design && typeof entry.design === 'object')
          .map((entry) => ({
            ...entry,
            id: safeDisplayText(entry.id, '', 160),
            name: safeDisplayText(entry.name, 'Design', 160),
            design: normalizeDesignState(entry.design),
            preview:
              typeof entry.preview === 'string' &&
              entry.preview.length <= 2_000_000 &&
              /^data:image\/(?:jpeg|png|webp);base64,/i.test(entry.preview)
                ? entry.preview
                : '',
            createdAt: finiteNumber(entry.createdAt, 0),
            updatedAt: finiteNumber(entry.updatedAt, finiteNumber(entry.createdAt, 0))
          }))
          .filter((entry) => entry.id)
          .sort((a, b) => b.updatedAt - a.updatedAt);
        setProjects((current) => {
          const mergedById = new Map(
            hydratedProjects.map((entry) => [String(entry.id), entry])
          );
          for (const entry of current) {
            if (entry?.id) mergedById.set(String(entry.id), entry);
          }
          const merged = [...mergedById.values()].sort(
            (a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
          );
          return merged;
        });
        const hydratedImports = storedImports
          .map(importListItem)
          .filter((entry) => entry.id)
          .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
        setImports((current) => {
          const mergedById = new Map(
            hydratedImports.map((entry) => [String(entry.id), entry])
          );
          for (const entry of current) {
            if (entry?.id) mergedById.set(String(entry.id), entry);
          }
          return [...mergedById.values()].sort(
            (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)
          );
        });
        const hydratedExports = storedExports
          .map((entry) => ({
            ...entry,
            id: safeDisplayText(entry?.id, '', 160),
            name: safeDisplayText(entry.name, 'Export', 160),
            designName: safeDisplayText(entry.designName, 'Untitled Card', 160),
            action: safeDisplayText(entry.action, 'export', 80),
            width: Math.max(0, finiteNumber(entry.width, 0)),
            height: Math.max(0, finiteNumber(entry.height, 0)),
            createdAt: finiteNumber(entry.createdAt, 0)
          }))
          .filter((entry) => entry.id)
          .sort((a, b) => b.createdAt - a.createdAt);
        setExportHistory((current) => {
          const mergedById = new Map(
            hydratedExports.map((entry) => [String(entry.id), entry])
          );
          for (const entry of current) {
            if (entry?.id) mergedById.set(String(entry.id), entry);
          }
          return [...mergedById.values()]
            .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
            .slice(0, 40);
        });

        try {
          const storedRecent = JSON.parse(localStorage.getItem('aircard-recent-artwork-v1') || '[]');
          if (Array.isArray(storedRecent)) {
            const seenRecentIds = new Set();
            setRecent(
              storedRecent
                .map(normalizeStoredArtworkItem)
                .filter((item) => {
                  if (!item?.id || seenRecentIds.has(item.id)) return false;
                  seenRecentIds.add(item.id);
                  return true;
                })
                .slice(0, 20)
            );
          }
        } catch {
          try {
            localStorage.removeItem('aircard-recent-artwork-v1');
          } catch {}
        }

        try {
          setExpertMode(localStorage.getItem('aircard-expert-v2') === '1');
        } catch {
          setExpertMode(false);
        }

        if ('serviceWorker' in navigator) {
          let hasServiceWorkerController = Boolean(navigator.serviceWorker.controller);

          navigator.serviceWorker.register('/sw.js').then((registration) => {
            const refreshServiceWorker = () => {
              if (document.visibilityState === 'visible') {
                registration.update().catch(() => {});
              }
            };
            serviceWorkerResumeHandler = refreshServiceWorker;
            registration.update().catch(() => {});
            document.addEventListener('visibilitychange', refreshServiceWorker);
            window.addEventListener('pageshow', refreshServiceWorker);
          }).catch(() => {});

          const reloadKey = 'card-studio-sw-v4-reloaded';
          const clearReloadGuard = () => {
            try {
              sessionStorage.removeItem(reloadKey);
            } catch {}
          };
          reloadGuardTimer = window.setTimeout(clearReloadGuard, 8000);

          controllerChangeHandler = async () => {
            if (controllerReloadInFlight || cancelled) return;

            if (!autosaveSafe) {
              setMessage('Update ready, but draft storage could not be read safely. Reload manually after storage recovers.');
              return;
            }

            if (!hasServiceWorkerController) {
              hasServiceWorkerController = true;
              return;
            }

            if (
              imageImportInFlightRef.current ||
              presetTransferInFlightRef.current ||
              cleanupInFlightRef.current ||
              projectSaveInFlightRef.current ||
              exportInFlightRef.current
            ) {
              setMessage('Update ready. Finish the current save/import/export operation, then reload when it is safe.');
              return;
            }

            try {
              if (sessionStorage.getItem(reloadKey) === '1') return;
            } catch {}

            controllerReloadInFlight = true;
            let snapshot = designRef.current;
            let result = null;

            for (let attempt = 0; attempt < 3; attempt += 1) {
              result = await persistDraftSnapshot(snapshot);

              if (!result.success) {
                controllerReloadInFlight = false;
                setSaveStatus('Save failed');
                setMessage('Update ready, but the latest edit could not be saved. Reload manually when it is safe.');
                return;
              }

              if (cancelled) {
                controllerReloadInFlight = false;
                return;
              }

              if (designRef.current === snapshot) break;
              snapshot = designRef.current;
            }

            if (designRef.current !== snapshot) {
              controllerReloadInFlight = false;
              setSaveStatus('Editing…');
              setMessage('Update ready. Finish editing, then reload when it is safe.');
              return;
            }

            setSaveStatus('Saved');

            try {
              sessionStorage.setItem(reloadKey, '1');
            } catch {}

            window.location.reload();
          };
          navigator.serviceWorker.addEventListener('controllerchange', controllerChangeHandler);
        }

        const standalone =
          window.matchMedia('(display-mode: standalone)').matches ||
          Boolean(navigator.standalone);
        let dismissed = false;
        try {
          dismissed = localStorage.getItem('aircard-install-dismissed-v2') === '1';
        } catch {}
        if (!standalone && !dismissed) setInstallHelp(true);
      } catch {
        setMessage('Local library could not fully load');
      } finally {
        if (!cancelled) {
          setHydrated(true);
          setAutosaveReady(autosaveSafe);
          autosavePausedBaselineRef.current = autosaveSafe ? null : designRef.current;
          if (!autosaveSafe) {
            setSaveStatus('Autosave paused');
            setMessage('Draft storage could not be read safely. Autosave is paused to protect existing work.');
          }
        }
      }
    }

    hydrate();

    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);

    return () => {
      cancelled = true;
      if (reloadGuardTimer) window.clearTimeout(reloadGuardTimer);
      if (controllerChangeHandler && 'serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('controllerchange', controllerChangeHandler);
      }
      if (serviceWorkerResumeHandler) {
        document.removeEventListener('visibilitychange', serviceWorkerResumeHandler);
        window.removeEventListener('pageshow', serviceWorkerResumeHandler);
      }
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !autosaveReady) return undefined;

    setSaveStatus('Editing…');
    const timer = setTimeout(async () => {
      const result = await persistDraftSnapshot(designRef.current);
      if (result.version !== draftSaveVersionRef.current) return;
      setSaveStatus(result.success ? 'Saved' : 'Save failed');
    }, 420);

    return () => clearTimeout(timer);
  }, [autosaveReady, design, hydrated, persistDraftSnapshot]);

  useEffect(() => {
    if (!hydrated || autosaveReady) return undefined;
    if (autosavePausedBaselineRef.current === design) return undefined;

    const timer = window.setTimeout(() => {
      const snapshot = JSON.parse(JSON.stringify(design));
      if (snapshot.background && !isPersistableBackground(snapshot.background)) {
        snapshot.background = '';
      }

      try {
        const now = Date.now();
        localStorage.setItem('aircard-sticker-fvp-v3', JSON.stringify(snapshot));
        localStorage.setItem('aircard-sticker-fvp-v3-updated-at', String(now));
        if (designRef.current === design) {
          autosavePausedBaselineRef.current = design;
        }
      } catch {}
    }, 420);

    return () => window.clearTimeout(timer);
  }, [autosaveReady, design, hydrated]);

  useEffect(() => {
    if (!hydrated) return undefined;

    let lastFlushAt = 0;
    const flushDraftBeforeSuspend = () => {
      const now = Date.now();
      if (now - lastFlushAt < 200) return;
      lastFlushAt = now;

      const snapshot = JSON.parse(JSON.stringify(designRef.current));
      if (snapshot.background && !isPersistableBackground(snapshot.background)) {
        snapshot.background = '';
      }

      // localStorage is synchronous, so this survives iOS suspending the page
      // before an IndexedDB transaction or debounced autosave can finish.
      // When IndexedDB hydration was unsafe, only update this recovery copy
      // after the user has actually changed the hydrated design.
      if (!autosaveReady && autosavePausedBaselineRef.current === designRef.current) {
        return;
      }

      try {
        localStorage.setItem('aircard-sticker-fvp-v3', JSON.stringify(snapshot));
        localStorage.setItem('aircard-sticker-fvp-v3-updated-at', String(now));
        if (!autosaveReady) {
          autosavePausedBaselineRef.current = designRef.current;
        }
      } catch {}

      if (autosaveReady) {
        persistDraftSnapshot(snapshot).catch(() => {});
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushDraftBeforeSuspend();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flushDraftBeforeSuspend);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flushDraftBeforeSuspend);
    };
  }, [autosaveReady, hydrated, persistDraftSnapshot]);

  useEffect(() => {
    try {
      localStorage.setItem('aircard-expert-v2', expertMode ? '1' : '0');
    } catch {}
  }, [expertMode]);

  useEffect(() => {
    let objectUrl = '';
    let cancelled = false;
    const backgroundKey = design.background || '';

    async function loadBackground() {
      if (!backgroundKey) {
        setImage(null);
        setLoadedBackgroundKey('');
        setBackgroundLoadError('');
        return;
      }

      setImage(null);
      setLoadedBackgroundKey('');
      setBackgroundLoadError('');
      setMessage('Loading artwork…');

      let src = backgroundKey;

      try {
        if (src.startsWith('idb://imports/')) {
          const id = src.slice('idb://imports/'.length);
          const asset = await dbGet('imports', id);
          if (cancelled) return;
          if (!asset?.blob) {
            setImage(null);
            setLoadedBackgroundKey('');
            setBackgroundLoadError('Imported artwork is missing.');
            setMessage('Imported artwork is missing');
            return;
          }
          objectUrl = URL.createObjectURL(asset.blob);
          src = objectUrl;
        }

        const img = await loadSearchImage(src, 15000);
        if (cancelled) return;
        setImage(img);
        setLoadedBackgroundKey(backgroundKey);
        setBackgroundLoadError('');
        setMessage((current) =>
          current === 'Loading artwork…' ? 'Artwork loaded' : current
        );
      } catch {
        if (cancelled) return;
        setImage(null);
        setLoadedBackgroundKey('');
        setBackgroundLoadError('Artwork could not load.');
        setMessage('Artwork could not load');
      }
    }

    loadBackground();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [design.background]);

  useEffect(() => {
    let cancelled = false;
    const urls = [];

    async function hydrateLayers() {
      const next = {};
      let failed = false;
      const imageLayers = JSON.parse(imageLayerSourceKey || '[]');

      setLayerImages({});
      setLoadedImageLayerSourceKey('');
      setLayerLoadError('');

      if (imageLayers.length > MAX_VISIBLE_IMAGE_LAYERS) {
        const text =
          'Too many visible image layers. Hide or delete image layers until ' +
          MAX_VISIBLE_IMAGE_LAYERS +
          ' or fewer remain.';
        setLoadedImageLayerSourceKey(imageLayerSourceKey);
        setLayerLoadError(text);
        setMessage(text);
        return;
      }

      let cursor = 0;
      let decodedPixels = 0;
      let memoryLimited = false;
      const decodedBySource = new Map();
      const countedSources = new Set();

      async function decodeLayerSource(source) {
        if (decodedBySource.has(source)) {
          return decodedBySource.get(source);
        }

        const work = (async () => {
          let src = source;

          if (src.startsWith('idb://imports/')) {
            const id = src.slice('idb://imports/'.length);
            const asset = await dbGet('imports', id);
            if (cancelled) throw new Error('Layer hydration canceled');
            if (!asset?.blob) throw new Error('Imported layer image is missing');
            src = URL.createObjectURL(asset.blob);
            urls.push(src);
          }

          return loadSearchImage(src);
        })();

        decodedBySource.set(source, work);
        try {
          return await work;
        } catch (error) {
          decodedBySource.delete(source);
          throw error;
        }
      }

      async function hydrateOneLayer(layer) {
        try {
          const decoded = await decodeLayerSource(layer.src);
          if (cancelled) return;

          if (!countedSources.has(layer.src)) {
            const width = Number(decoded.naturalWidth || decoded.width || 0);
            const height = Number(decoded.naturalHeight || decoded.height || 0);
            const pixels = Math.max(0, width * height);

            if (decodedPixels + pixels > MAX_VISIBLE_IMAGE_DECODE_PIXELS) {
              memoryLimited = true;
              failed = true;
              return;
            }

            countedSources.add(layer.src);
            decodedPixels += pixels;
          }

          next[layer.id] = decoded;
        } catch {
          if (!cancelled) failed = true;
        }
      }

      async function worker() {
        while (!cancelled) {
          const index = cursor;
          cursor += 1;
          if (index >= imageLayers.length) return;
          await hydrateOneLayer(imageLayers[index]);
        }
      }

      const workerCount = Math.min(3, imageLayers.length);
      await Promise.all(
        Array.from({ length: workerCount }, () => worker())
      );

      if (!cancelled) {
        const errorText = memoryLimited
          ? 'Visible image layers exceed the safe iPhone memory budget. Hide or delete some image layers.'
          : failed
            ? 'One or more image layers could not load.'
            : '';
        setLayerImages(next);
        setLoadedImageLayerSourceKey(imageLayerSourceKey);
        setLayerLoadError(errorText);
        if (errorText) setMessage(errorText);
      }
    }

    hydrateLayers();

    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [imageLayerSourceKey]);

  const renderCard = useCallback((ctx, width, height, options = {}) => {
    if (!ctx) return;
    const renderDesign = options.design || design;
    const renderGradient = renderDesign.backgroundColor
      ? { a: renderDesign.backgroundColor, b: renderDesign.backgroundColor, c: renderDesign.backgroundColor }
      : (GRADIENTS.find((item) => item.id === renderDesign.gradient) || GRADIENTS[0]);
    const renderImageLayerSourceKey = imageLayerSourceKeyForDesign(renderDesign);
    const originalTarget = options.originalTarget || (options.original ? 'all' : null);
    const artworkOriginal = originalTarget === 'all' || originalTarget === 'artwork';
    const renderPixelScale = Math.max(
      0.01,
      Math.min(width / OUT_W, height / OUT_H)
    );
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    ctx.scale(width / OUT_W, height / OUT_H);

    const base = ctx.createLinearGradient(0, 0, OUT_W, OUT_H);
    base.addColorStop(0, renderGradient.a);
    base.addColorStop(0.5, renderGradient.b);
    base.addColorStop(1, renderGradient.c);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, OUT_W, OUT_H);

    let artworkEffectClip = null;

    if (image && loadedBackgroundKey === renderDesign.background) {
      const crop = renderDesign.sourceCrop;
      const sx = crop ? clamp(crop.x, 0, 1) * image.width : 0;
      const sy = crop ? clamp(crop.y, 0, 1) * image.height : 0;
      const sw = crop ? clamp(crop.w, 0.01, 1) * image.width : image.width;
      const sh = crop ? clamp(crop.h, 0.01, 1) * image.height : image.height;
      const ratio = sw / sh;
      let iw;
      let ih;

      if ((renderDesign.fit === 'cover' && ratio > CARD_RATIO) || (renderDesign.fit === 'contain' && ratio < CARD_RATIO)) {
        ih = OUT_H;
        iw = ih * ratio;
      } else {
        iw = OUT_W;
        ih = iw / ratio;
      }

      iw *= renderDesign.zoom;
      ih *= renderDesign.zoom;

      const x = (OUT_W - iw) / 2 + renderDesign.x * OUT_W;
      const y = (OUT_H - ih) / 2 + renderDesign.y * OUT_H;
      artworkEffectClip = {
        cx: x + iw / 2,
        cy: y + ih / 2,
        width: iw,
        height: ih,
        rotation: renderDesign.rotate
      };
      const artworkSource = artworkOriginal
        ? image
        : adjustedImage(image, { x: sx, y: sy, w: sw, h: sh }, renderDesign,
          Math.max(1, Math.abs(iw) * renderPixelScale), Math.max(1, Math.abs(ih) * renderPixelScale), renderPixelScale);

      ctx.save();
      ctx.translate(x + iw / 2, y + ih / 2);
      ctx.rotate((renderDesign.rotate * Math.PI) / 180);
      ctx.scale(renderDesign.flipX ? -1 : 1, 1);
      ctx.beginPath();
      ctx.rect(-iw / 2, -ih / 2, iw, ih);
      ctx.clip();
      if (artworkOriginal) ctx.drawImage(image, sx, sy, sw, sh, -iw / 2, -ih / 2, iw, ih);
      else ctx.drawImage(artworkSource, -iw / 2, -ih / 2, iw, ih);
      ctx.restore();

      if (!artworkOriginal) {
        const shadows = Number(renderDesign.shadows || 0);
        if (shadows !== 0) {
          ctx.save();
          clipTransformedRect(
            ctx,
            artworkEffectClip.cx,
            artworkEffectClip.cy,
            artworkEffectClip.width,
            artworkEffectClip.height,
            artworkEffectClip.rotation
          );
          ctx.globalCompositeOperation = shadows > 0 ? 'screen' : 'multiply';
          ctx.globalAlpha = Math.abs(shadows) * 0.22;
          ctx.fillStyle = shadows > 0 ? '#6f7890' : '#10141c';
          ctx.fillRect(0, 0, OUT_W, OUT_H);
          ctx.restore();
        }

        const highlights = Number(renderDesign.highlights || 0);
        if (highlights !== 0) {
          ctx.save();
          clipTransformedRect(
            ctx,
            artworkEffectClip.cx,
            artworkEffectClip.cy,
            artworkEffectClip.width,
            artworkEffectClip.height,
            artworkEffectClip.rotation
          );
          ctx.globalCompositeOperation = highlights > 0 ? 'screen' : 'multiply';
          ctx.globalAlpha = Math.abs(highlights) * 0.16;
          ctx.fillStyle = highlights > 0 ? '#fff7ec' : '#7d8794';
          ctx.fillRect(0, 0, OUT_W, OUT_H);
          ctx.restore();
        }

        const temperature = Number(renderDesign.temperature || 0);
        if (temperature !== 0) {
          ctx.save();
          clipTransformedRect(
            ctx,
            artworkEffectClip.cx,
            artworkEffectClip.cy,
            artworkEffectClip.width,
            artworkEffectClip.height,
            artworkEffectClip.rotation
          );
          ctx.globalCompositeOperation = 'soft-light';
          ctx.globalAlpha = Math.abs(temperature) * 0.24;
          ctx.fillStyle = temperature > 0 ? '#ff8a3d' : '#438cff';
          ctx.fillRect(0, 0, OUT_W, OUT_H);
          ctx.restore();
        }

        const tint = Number(renderDesign.tint || 0);
        if (tint !== 0) {
          ctx.save();
          clipTransformedRect(
            ctx,
            artworkEffectClip.cx,
            artworkEffectClip.cy,
            artworkEffectClip.width,
            artworkEffectClip.height,
            artworkEffectClip.rotation
          );
          ctx.globalCompositeOperation = 'soft-light';
          ctx.globalAlpha = Math.abs(tint) * 0.2;
          ctx.fillStyle = tint > 0 ? '#d34cff' : '#38d887';
          ctx.fillRect(0, 0, OUT_W, OUT_H);
          ctx.restore();
        }
      }
    }

    if (!artworkOriginal && artworkEffectClip && renderDesign.overlay > 0) {
      ctx.save();
      clipTransformedRect(
        ctx,
        artworkEffectClip.cx,
        artworkEffectClip.cy,
        artworkEffectClip.width,
        artworkEffectClip.height,
        artworkEffectClip.rotation
      );
      const overlay = ctx.createLinearGradient(0, 0, OUT_W, OUT_H);
      overlay.addColorStop(0, 'rgba(0,0,0,' + renderDesign.overlay * 0.55 + ')');
      overlay.addColorStop(0.55, 'rgba(0,0,0,0)');
      overlay.addColorStop(1, 'rgba(0,0,0,' + renderDesign.overlay + ')');
      ctx.fillStyle = overlay;
      ctx.fillRect(0, 0, OUT_W, OUT_H);
      ctx.restore();
    }

    if (!artworkOriginal && artworkEffectClip && renderDesign.vignette > 0) {
      ctx.save();
      clipTransformedRect(
        ctx,
        artworkEffectClip.cx,
        artworkEffectClip.cy,
        artworkEffectClip.width,
        artworkEffectClip.height,
        artworkEffectClip.rotation
      );
      const vignette = ctx.createRadialGradient(
        OUT_W / 2,
        OUT_H / 2,
        OUT_W * 0.16,
        OUT_W / 2,
        OUT_H / 2,
        OUT_W * 0.72
      );
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, 'rgba(0,0,0,' + renderDesign.vignette + ')');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, OUT_W, OUT_H);
      ctx.restore();
    }

    if (!artworkOriginal && artworkEffectClip && renderDesign.gloss > 0) {
      ctx.save();
      clipTransformedRect(
        ctx,
        artworkEffectClip.cx,
        artworkEffectClip.cy,
        artworkEffectClip.width,
        artworkEffectClip.height,
        artworkEffectClip.rotation
      );
      const gloss = ctx.createLinearGradient(0, 0, OUT_W, OUT_H);
      gloss.addColorStop(0, 'rgba(255,255,255,' + renderDesign.gloss * 0.42 + ')');
      gloss.addColorStop(0.22, 'rgba(255,255,255,' + renderDesign.gloss * 0.08 + ')');
      gloss.addColorStop(0.5, 'rgba(255,255,255,0)');
      ctx.fillStyle = gloss;
      ctx.fillRect(0, 0, OUT_W, OUT_H);
      ctx.restore();
    }

    if (!artworkOriginal && artworkEffectClip && renderDesign.grain > 0) {
      ctx.save();
      clipTransformedRect(
        ctx,
        artworkEffectClip.cx,
        artworkEffectClip.cy,
        artworkEffectClip.width,
        artworkEffectClip.height,
        artworkEffectClip.rotation
      );
      fillGrain(ctx, 0, 0, OUT_W, OUT_H, renderDesign.grain);
      ctx.restore();
    }

    if (!artworkOriginal && artworkEffectClip && renderDesign.fade > 0) {
      ctx.save();
      clipTransformedRect(
        ctx,
        artworkEffectClip.cx,
        artworkEffectClip.cy,
        artworkEffectClip.width,
        artworkEffectClip.height,
        artworkEffectClip.rotation
      );
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = clamp(renderDesign.fade, 0, 1) * 0.34;
      ctx.fillStyle = '#f6efe6';
      ctx.fillRect(0, 0, OUT_W, OUT_H);
      ctx.restore();
    }

    if (!artworkOriginal && artworkEffectClip && renderDesign.effectTintStrength > 0) {
      const [r, g, b] = hexToRgb(renderDesign.effectTint);
      ctx.save();
      clipTransformedRect(
        ctx,
        artworkEffectClip.cx,
        artworkEffectClip.cy,
        artworkEffectClip.width,
        artworkEffectClip.height,
        artworkEffectClip.rotation
      );
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = clamp(renderDesign.effectTintStrength, 0, 1) * 0.52;
      ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
      ctx.fillRect(0, 0, OUT_W, OUT_H);
      ctx.restore();
    }

    const customLayerMap = new Map((renderDesign.customLayers || []).map((layer) => [layer.id, layer]));
    const stackOrder = normalizeLayerOrder(renderDesign);

    const drawBuiltinText = () => {
      ctx.save();
      ctx.fillStyle = renderDesign.textColor;
      ctx.shadowColor = renderDesign.shadow ? 'rgba(0,0,0,.55)' : 'transparent';
      ctx.shadowBlur = renderDesign.shadow ? 16 * renderPixelScale : 0;

      if (renderDesign.badge) {
        ctx.textAlign = 'right';
        ctx.font = '800 66px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText(renderDesign.badgeText ?? 'CARD', OUT_W - 105, 130);
      }
      if (renderDesign.number) {
        ctx.textAlign = 'left';
        ctx.font = '600 64px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillText(renderDesign.numberText, 120, 700);
      }

      ctx.font = '650 34px -apple-system, BlinkMacSystemFont, sans-serif';
      if (renderDesign.holder) {
        ctx.textAlign = 'left';
        ctx.fillText(renderDesign.holderText, 122, 815);
      }
      if (renderDesign.expiry) {
        ctx.textAlign = 'right';
        ctx.fillText(renderDesign.expiryText, OUT_W - 122, 815);
      }
      ctx.restore();
    };

    for (const stackId of stackOrder) {
      if (stackId === 'builtin-chip') {
        if (renderDesign.chip) drawChip(ctx, renderDesign, renderPixelScale);
        continue;
      }

      if (stackId === 'builtin-contactless') {
        if (renderDesign.contactless) drawContactless(ctx, renderDesign);
        continue;
      }

      if (stackId === 'builtin-visa') {
        if (renderDesign.visa) drawVisa(ctx, renderDesign, renderPixelScale);
        continue;
      }

      if (stackId === 'builtin-text') {
        drawBuiltinText();
        continue;
      }

      const layer = customLayerMap.get(stackId);
      if (!layer || layer.hidden) continue;

      ctx.save();
      ctx.globalAlpha = clamp(Number(layer.opacity ?? 1), 0, 1);

      const lx = clamp(Number(layer.x ?? 0.5), -0.5, 1.5) * OUT_W;
      const ly = clamp(Number(layer.y ?? 0.5), -0.5, 1.5) * OUT_H;
      ctx.translate(lx, ly);
      ctx.rotate((Number(layer.rotation ?? 0) * Math.PI) / 180);
      const scale = clamp(Number(layer.scale ?? 1), 0.1, 6);
      ctx.scale(layer.type === 'image' && layer.flipX ? -scale : scale, scale);

      if (layer.type === 'text') {
        ctx.font = textLayerFontCss(layer);
        ctx.fillStyle = layer.color || '#ffffff';
        ctx.textAlign = layer.align || 'center';
        ctx.shadowColor = layer.shadow ? 'rgba(0,0,0,.5)' : 'transparent';
        ctx.shadowBlur = layer.shadow ? 12 * renderPixelScale : 0;
        const lines = textLayerLines(layer);
        const lineAdvance = textLayerLineAdvance(layer);
        const firstBaseline = -((lines.length - 1) * lineAdvance) / 2;
        lines.forEach((line, index) => {
          drawTrackedText(
            ctx,
            line,
            0,
            firstBaseline + index * lineAdvance,
            Number(layer.letterSpacing ?? 0)
          );
        });
      } else if (layer.type === 'shape') {
        const w = clamp(Number(layer.width ?? 280), 20, 1200);
        const h = clamp(Number(layer.height ?? 120), 20, 800);
        ctx.fillStyle = layer.color || '#ffffff';
        if (layer.shape === 'ellipse') {
          ctx.beginPath();
          ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          roundRect(ctx, -w / 2, -h / 2, w, h, clamp(Number(layer.radius ?? 28), 0, Math.min(w, h) / 2));
          ctx.fill();
        }
      } else if (layer.type === 'image') {
        const layerImage =
          loadedImageLayerSourceKey === renderImageLayerSourceKey
            ? layerImages[layer.id]
            : null;
        if (layerImage) {
          const layerOriginal = originalTarget === 'all' || originalTarget === layer.id;
          const settings = { ...IMAGE_LAYER_DEFAULTS, ...(layer.adjustments || {}) };
          const crop = layer.crop;
          const sx = crop ? clamp(crop.x, 0, 1) * layerImage.width : 0;
          const sy = crop ? clamp(crop.y, 0, 1) * layerImage.height : 0;
          const sw = crop ? clamp(crop.w, 0.01, 1) * layerImage.width : layerImage.width;
          const sh = crop ? clamp(crop.h, 0.01, 1) * layerImage.height : layerImage.height;
          const ratio = sw / Math.max(1, sh);
          const w = clamp(Number(layer.width ?? 640), 20, 1800);
          const h = w / Math.max(0.1, ratio);
          const adjustedLayerSource = layerOriginal
            ? layerImage
            : adjustedImage(layerImage, { x: sx, y: sy, w: sw, h: sh }, settings,
              Math.max(1, w * scale * renderPixelScale), Math.max(1, h * scale * renderPixelScale), renderPixelScale);

          ctx.save();
          ctx.beginPath();
          ctx.rect(-w / 2, -h / 2, w, h);
          ctx.clip();
          if (layerOriginal) ctx.drawImage(layerImage, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
          else ctx.drawImage(adjustedLayerSource, -w / 2, -h / 2, w, h);
          ctx.restore();

          if (!layerOriginal) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(-w / 2, -h / 2, w, h);
            ctx.clip();

            const shadows = Number(settings.shadows || 0);
            if (shadows !== 0) {
              ctx.save();
              ctx.globalCompositeOperation = shadows > 0 ? 'screen' : 'multiply';
              ctx.globalAlpha *= Math.abs(shadows) * 0.22;
              ctx.fillStyle = shadows > 0 ? '#6f7890' : '#10141c';
              ctx.fillRect(-w / 2, -h / 2, w, h);
              ctx.restore();
            }

            const highlights = Number(settings.highlights || 0);
            if (highlights !== 0) {
              ctx.save();
              ctx.globalCompositeOperation = highlights > 0 ? 'screen' : 'multiply';
              ctx.globalAlpha *= Math.abs(highlights) * 0.16;
              ctx.fillStyle = highlights > 0 ? '#fff7ec' : '#7d8794';
              ctx.fillRect(-w / 2, -h / 2, w, h);
              ctx.restore();
            }

            const temperature = Number(settings.temperature || 0);
            if (temperature !== 0) {
              ctx.save();
              ctx.globalCompositeOperation = 'soft-light';
              ctx.globalAlpha *= Math.abs(temperature) * 0.24;
              ctx.fillStyle = temperature > 0 ? '#ff8a3d' : '#438cff';
              ctx.fillRect(-w / 2, -h / 2, w, h);
              ctx.restore();
            }

            const layerTint = Number(settings.tint || 0);
            if (layerTint !== 0) {
              ctx.save();
              ctx.globalCompositeOperation = 'soft-light';
              ctx.globalAlpha *= Math.abs(layerTint) * 0.2;
              ctx.fillStyle = layerTint > 0 ? '#d34cff' : '#38d887';
              ctx.fillRect(-w / 2, -h / 2, w, h);
              ctx.restore();
            }

            if (Number(settings.overlay ?? 0) > 0) {
              const overlay = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
              overlay.addColorStop(0, 'rgba(0,0,0,' + Number(settings.overlay) * 0.55 + ')');
              overlay.addColorStop(0.55, 'rgba(0,0,0,0)');
              overlay.addColorStop(1, 'rgba(0,0,0,' + Number(settings.overlay) + ')');
              ctx.fillStyle = overlay;
              ctx.fillRect(-w / 2, -h / 2, w, h);
            }

            if (Number(settings.vignette ?? 0) > 0) {
              const vignette = ctx.createRadialGradient(0, 0, Math.min(w, h) * 0.14, 0, 0, Math.max(w, h) * 0.66);
              vignette.addColorStop(0, 'rgba(0,0,0,0)');
              vignette.addColorStop(1, 'rgba(0,0,0,' + Number(settings.vignette) + ')');
              ctx.fillStyle = vignette;
              ctx.fillRect(-w / 2, -h / 2, w, h);
            }

            if (Number(settings.gloss ?? 0) > 0) {
              const gloss = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
              gloss.addColorStop(0, 'rgba(255,255,255,' + Number(settings.gloss) * 0.42 + ')');
              gloss.addColorStop(0.22, 'rgba(255,255,255,' + Number(settings.gloss) * 0.08 + ')');
              gloss.addColorStop(0.5, 'rgba(255,255,255,0)');
              ctx.fillStyle = gloss;
              ctx.fillRect(-w / 2, -h / 2, w, h);
            }

            if (Number(settings.grain ?? 0) > 0) {
              fillGrain(ctx, -w / 2, -h / 2, w, h, settings.grain);
            }

            if (Number(settings.fade ?? 0) > 0) {
              ctx.save();
              ctx.globalCompositeOperation = 'screen';
              ctx.globalAlpha *= clamp(Number(settings.fade), 0, 1) * 0.34;
              ctx.fillStyle = '#f6efe6';
              ctx.fillRect(-w / 2, -h / 2, w, h);
              ctx.restore();
            }

            if (Number(settings.effectTintStrength || 0) > 0) {
              const [r, g, b] = hexToRgb(settings.effectTint || '#7b61ff');
              ctx.save();
              ctx.globalCompositeOperation = 'soft-light';
              ctx.globalAlpha *= clamp(Number(settings.effectTintStrength), 0, 1) * 0.52;
              ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
              ctx.fillRect(-w / 2, -h / 2, w, h);
              ctx.restore();
            }

            ctx.restore();
          }
        }
      } else if (layer.type === 'chip') {
        drawChipLayerAtOrigin(ctx, layer.tone || 'gold', renderPixelScale);
      } else if (layer.type === 'contactless') {
        drawContactlessLayerAtOrigin(ctx, layer.color || '#ffffff');
      }

      ctx.restore();
    }

    ctx.restore();
  }, [
    design,
    gradient,
    image,
    imageLayerSourceKey,
    layerImages,
    loadedBackgroundKey,
    loadedImageLayerSourceKey
  ]);

  const scheduleGesturePreview = useCallback(() => {
    if (gesturePreviewFrameRef.current) return;
    gesturePreviewFrameRef.current = window.requestAnimationFrame(() => {
      gesturePreviewFrameRef.current = 0;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      renderCard(ctx, EDITOR_PREVIEW_W, EDITOR_PREVIEW_H, {
        design: designRef.current
      });
    });
  }, [renderCard]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const originalTarget = showOriginal
        ? ((design.customLayers || []).some((layer) => layer.id === selectedElement && layer.type === 'image')
            ? selectedElement
            : 'artwork')
        : null;

      renderCard(canvas.getContext('2d'), EDITOR_PREVIEW_W, EDITOR_PREVIEW_H, { originalTarget });

      if (showExportPreview && fullPreviewCanvasRef.current) {
        renderCard(fullPreviewCanvasRef.current.getContext('2d'), OUT_W, OUT_H);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [design.customLayers, renderCard, selectedElement, showOriginal, showExportPreview]);

  const loadCucu = useCallback(async (
    nextPage = 1,
    replace = false,
    category = cucuCategory,
    search = query
  ) => {
    if (catalogLoadingRef.current) return;

    const requestIntent = category + '\u0000' + search.trim();
    catalogLoadingRef.current = true;
    setCucuLoading(true);
    setCatalogError('');
    setMessage(search ? 'Searching card library…' : 'Loading card skins…');

    const isCurrentIntent = () => catalogIntentRef.current === requestIntent;

    try {
      const params = new URLSearchParams({
        category,
        page: String(nextPage),
        limit: '24'
      });
      if (search.trim()) params.set('q', search.trim());

      const providerUrls = ['/api/cucu?' + params.toString()];
      if (category === 'anime') {
        providerUrls.push('/api/animedeskmat?' + params.toString());
      }

      const providerResults = await Promise.all(
        providerUrls.map(async (url) => {
          try {
            const response = await fetch(url);
            const json = await response.json();
            if (!response.ok) throw new Error(json.error || 'Card library failed');
            return { ok: true, json };
          } catch (error) {
            return { ok: false, error };
          }
        })
      );
      if (!isCurrentIntent()) return;

      const availableProviders = providerResults.filter((entry) => entry.ok);
      if (!availableProviders.length) {
        throw providerResults[0]?.error || new Error('Card library failed');
      }

      const rawList = interleaveCatalogItems(
        availableProviders.map((entry) =>
          Array.isArray(entry.json?.results) ? entry.json.results : []
        )
      );
      const cleanList = await prepareCleanResults(rawList);
      if (!isCurrentIntent()) return;

      // Prime the exact same persistent Cache Storage paths used by CUCU.
      // This makes browsed AnimeDeskMat thumbnails available offline and keeps
      // the full-resolution working asset cached once it is selected.
      for (const item of cleanList) {
        if (item?.thumbnail) cacheArtwork(proxyImageWidth(item.thumbnail, 560));
      }

      const knownTotals = availableProviders
        .map((entry) => Number(entry.json?.total) || 0)
        .filter((value) => value > 0);
      setCucuTotal(
        knownTotals.length === availableProviders.length
          ? knownTotals.reduce((sum, value) => sum + value, 0)
          : 0
      );
      setCucuHasMore(availableProviders.some((entry) => Boolean(entry.json?.hasMore)));
      const primaryJson = availableProviders[0]?.json || {};
      setCucuCategoryLabel(
        search.trim()
          ? 'Search Results'
          : primaryJson.categoryLabel || CUCU_CATEGORIES.find(([key]) => key === category)?.[1] || 'Card Skins'
      );

      setCucuItems((current) => {
        const base = replace ? [] : current;
        const merged = [...base, ...cleanList];
        const seen = new Set();
        return merged.filter((item) => {
          if (!item?.id || seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });
      });

      setCucuPage(nextPage);
      setMessage(
        cleanList.length
          ? cleanList.length + (search.trim() ? ' search results loaded' : ' card skins loaded')
          : 'No usable card skins on this page'
      );
    } catch (error) {
      if (isCurrentIntent()) {
        const text = error?.message || 'Card library failed';
        setCatalogError(text);
        setMessage(text);
      }
    } finally {
      catalogLoadingRef.current = false;
      setCucuLoading(false);
    }
  }, [cucuCategory, query]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchInput.trim();
      if (next === query) return;
      catalogIntentRef.current = cucuCategory + '\u0000' + next;
      setQuery(next);
      setCucuItems([]);
      setCucuPage(0);
      setCucuTotal(0);
      setCucuHasMore(true);
    }, 320);
    return () => clearTimeout(timer);
  }, [searchInput, query]);

  useEffect(() => {
    if (cucuPage === 0 && !cucuLoading) {
      loadCucu(1, true, cucuCategory, query);
    }
  }, [cucuCategory, cucuPage, cucuLoading, query, loadCucu]);

  useEffect(() => {
    let cancelled = false;

    async function loadFeatured() {
      const shelves = [
        ['new', 'Recently Added'],
        ['best', 'Best Sellers'],
        ['anime', 'Anime'],
        ['cars', 'Cars'],
        ['cute', 'Cute & Kawaii'],
        ['memes', 'Memes']
      ];

      const next = {};
      await Promise.all(shelves.map(async ([category, label]) => {
        try {
          const urls = [
            '/api/cucu?category=' + encodeURIComponent(category) + '&page=1&limit=8'
          ];
          if (category === 'anime') {
            urls.push('/api/animedeskmat?category=anime&page=1&limit=8');
          }

          const providerResults = await Promise.all(
            urls.map(async (url) => {
              try {
                const response = await fetch(url);
                const json = await response.json();
                return response.ok && Array.isArray(json.results) ? json.results : [];
              } catch {
                return [];
              }
            })
          );

          // Keep the existing CUCU shelf positions stable. AnimeDeskMat is
          // appended to Anime instead of alternating provider items, so an
          // AnimeDeskMat card loading/rejecting cannot leave a CUCU-sized hole
          // between neighboring cards.
          const items = category === 'anime'
            ? [...(providerResults[0] || []), ...(providerResults[1] || [])].slice(0, 8)
            : interleaveCatalogItems(providerResults, 8);
          next[label] = await prepareCleanResults(items, 8);
          for (const item of next[label]) {
            if (item?.thumbnail) cacheArtwork(proxyImageWidth(item.thumbnail, 560));
          }
        } catch {}
      }));

      if (!cancelled) setFeatured(next);
    }

    loadFeatured();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !cucuHasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !cucuLoading && cucuHasMore) {
          loadCucu(cucuPage + 1, false, cucuCategory, query);
        }
      },
      { rootMargin: '500px 0px' }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [cucuHasMore, cucuLoading, cucuPage, cucuCategory, query, loadCucu]);

  async function toggleFavorite(item) {
    if (item?.id == null || item.id === '') return;
    const itemId = String(item.id);
    if (favoriteOpsRef.current.has(itemId)) return;

    favoriteOpsRef.current.add(itemId);
    try {
      const already = favoriteIds.has(itemId);
      if (already) {
        try {
          await dbDelete('favorites', itemId);
        } catch {
          setMessage('Could not remove this favorite from local storage.');
          return;
        }
        setFavoriteIds((current) => {
          const next = new Set(current);
          next.delete(itemId);
          return next;
        });
        setFavorites((current) => current.filter((entry) => String(entry.id) !== itemId));
        setMessage('Removed from Favorites');
        return;
      }

      const stored = normalizeStoredArtworkItem({ ...item, id: itemId });
      if (!stored) {
        setMessage('This artwork could not be saved as a favorite.');
        return;
      }

      try {
        await dbPut('favorites', {
          id: itemId,
          item: stored,
          updatedAt: Date.now()
        });
      } catch {
        setMessage('Could not save this favorite. Device storage may be full.');
        return;
      }

      cacheArtwork(stored.image);
      if (stored.thumbnail) cacheArtwork(stored.thumbnail);

      setFavoriteIds((current) => new Set([...current, itemId]));
      setFavorites((current) => [stored, ...current.filter((entry) => String(entry.id) !== itemId)]);
      setMessage('Added to Favorites');
    } finally {
      favoriteOpsRef.current.delete(itemId);
    }
  }

  async function withImageImportLock(task) {
    if (imageImportInFlightRef.current) {
      setMessage('Another image import is still processing');
      return false;
    }
    if (presetTransferInFlightRef.current) {
      setMessage('Finish the preset operation before importing another image.');
      return false;
    }
    if (cleanupInFlightRef.current) {
      setMessage('Finish cleaning imported images before importing another image.');
      return false;
    }

    imageImportInFlightRef.current = true;
    const generation = ++imageImportGenerationRef.current;
    setImageImportInProgress(true);
    try {
      await task(() => imageImportGenerationRef.current === generation);
      return true;
    } finally {
      imageImportInFlightRef.current = false;
      setImageImportInProgress(false);
    }
  }

  function invalidatePendingImageImport() {
    if (imageImportInFlightRef.current) {
      imageImportGenerationRef.current += 1;
    }
  }

  function invalidatePendingPresetImport() {
    if (presetImportActiveRef.current) {
      presetImportGenerationRef.current += 1;
    }
  }

  function startFreshWorkingProject(nextDesign, {
    studioTool = 'crop',
    statusMessage = 'New card ready'
  } = {}) {
    finishActiveGesture();
    invalidatePendingImageImport();
    invalidatePendingPresetImport();

    const next = normalizeDesignState(nextDesign);
    const sameBackground =
      Boolean(next.background) &&
      next.background === designRef.current.background &&
      loadedBackgroundKey === next.background &&
      image;
    const decodedPreview = sameBackground ? image : null;

    historyGroupRef.current = { key: '', at: 0 };
    undoRef.current = [];
    redoRef.current = [];
    setHistoryVersion((value) => value + 1);

    // A fresh project never inherits unrelated decoded artwork or a catalog thumbnail.
    setImage(decodedPreview);
    setLoadedBackgroundKey(decodedPreview ? next.background : '');
    setBackgroundLoadError('');
    setLayerImages({});
    setLoadedImageLayerSourceKey('[]');
    setLayerLoadError('');

    replaceDesign(next, false);
    setSelectedElement('artwork');
    setPreviewMode('flat');
    setShowOriginal(false);
    setShowExportPreview(false);
    setGuidesEnabled(false);
    setActiveGuides({ x: null, y: null });
    setStudioTool(studioTool);
    setStudioSubtool('');
    setProjectName('');
    setSaveStatus(hydrated && autosaveReady ? 'Saving…' : 'Saved');
    setTab('studio');
    setMenuItem(null);
    setMessage(statusMessage);

    // A project boundary must also replace the synchronous recovery snapshot
    // immediately. Otherwise an iOS suspend/reload in the autosave debounce
    // window can resurrect the previous project's chip/position/effect state.
    try {
      const now = Date.now();
      localStorage.setItem('aircard-sticker-fvp-v3', JSON.stringify(next));
      localStorage.setItem('aircard-sticker-fvp-v3-updated-at', String(now));
      if (!autosaveReady) autosavePausedBaselineRef.current = next;
    } catch {}

    // Queue the IndexedDB replacement too. Saved named projects remain
    // untouched; only the current working draft is replaced.
    if (hydrated && autosaveReady) {
      setSaveStatus('Saving…');
      persistDraftSnapshot(next).then((result) => {
        if (designRef.current !== next || result.version !== draftSaveVersionRef.current) return;
        setSaveStatus(result.success ? 'Saved' : 'Save failed');
      });
    }

    return next;
  }

  function useArtwork(item) {
    if (cleanupInFlightRef.current) {
      setMessage('Finish cleaning imported images before changing artwork.');
      return false;
    }
    const workingImage = proxyImageWidth(item.image, 3072);
    if (!workingImage) {
      setMessage('This artwork source is unavailable or unsupported.');
      return false;
    }

    startFreshWorkingProject(createDefaultProjectDesign({
      background: workingImage,
      backgroundLabel: item.title,
      sourceCrop: item.sourceCrop || null,
      originalSourceCrop: item.sourceCrop || null,
      zoom: CATALOG_ARTWORK_EDITOR_ZOOM
    }), {
      studioTool: 'crop',
      statusMessage: 'New project created from ' + item.title
    });

    rememberArtwork(item);
    cacheArtwork(workingImage);
    return true;
  }

  function applyImportedArtwork(asset) {
    if (!asset?.id) return false;
    if (cleanupInFlightRef.current) {
      setMessage('Finish cleaning imported images before changing artwork.');
      return false;
    }

    const importedBackground = 'idb://imports/' + asset.id;
    startFreshWorkingProject(createDefaultProjectDesign({
      background: importedBackground,
      backgroundLabel: safeDisplayText(asset.name, 'Imported image', 160),
      sourceCrop: null,
      originalSourceCrop: null
    }), {
      studioTool: 'crop',
      statusMessage: (asset.name || 'Imported image') + ' opened as a new card'
    });
    return true;
  }

  function replaceWithImportedArtwork(asset) {
    if (!asset?.id) return false;
    if (cleanupInFlightRef.current) {
      setMessage('Finish cleaning imported images before changing artwork.');
      return false;
    }
    patch({
      background: 'idb://imports/' + asset.id,
      backgroundLabel: safeDisplayText(asset.name, 'Imported image', 160),
      backgroundColor: '',
      sourceCrop: null,
      originalSourceCrop: null,
      zoom: 1,
      x: 0,
      y: 0,
      rotate: 0,
      flipX: false
    });
    setSelectedElement('artwork');
    setStudioSubtool('');
    setMessage((asset.name || 'Imported image') + ' replaced card artwork');
    return true;
  }

  function replaceWithRecentArtwork(item) {
    if (cleanupInFlightRef.current) return false;
    const workingImage = proxyImageWidth(item?.image, 3072);
    if (!workingImage) {
      setMessage('This artwork source is unavailable or unsupported.');
      return false;
    }
    patch({
      background: workingImage,
      backgroundLabel: safeDisplayText(item.title, 'Card artwork', 120),
      backgroundColor: '',
      sourceCrop: item.sourceCrop || null,
      originalSourceCrop: item.sourceCrop || null,
      zoom: CATALOG_ARTWORK_EDITOR_ZOOM,
      x: 0,
      y: 0,
      rotate: 0,
      flipX: false
    });
    setSelectedElement('artwork');
    setStudioSubtool('');
    rememberArtwork(item);
    cacheArtwork(workingImage);
    setMessage('Card artwork replaced');
    return true;
  }

  async function uploadImage(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      // A canceled picker must not consume the action that opened it.
      input.value = '';
      return;
    }
    const uploadIntent = uploadIntentRef.current;
    uploadIntentRef.current = 'replace-artwork';
    try {
      await withImageImportLock(async (isCurrent) => {
    if (file.type && !file.type.startsWith('image/')) {
      setMessage('Choose an image file.');
      return;
    }
    if (file.size > MAX_IMAGE_IMPORT_BYTES) {
      setMessage('Image is too large. Choose a file under 30 MB.');
      return;
    }

    let preparedImage;
    try {
      preparedImage = await prepareLocalImageBlob(file);
    } catch (error) {
      setMessage(
        error?.message === 'Image dimensions are too large'
          ? 'Image resolution is too large for reliable iPhone editing.'
          : error?.message === 'Image dimensions could not be verified safely'
            ? 'This large image could not be verified safely before decoding.'
            : error?.message === 'Image remains too large after optimization'
              ? 'Image is still too large after optimization. Choose a smaller file.'
              : String(error?.message || '').startsWith('SVG')
                ? error.message
                : 'This image could not be decoded on this device.'
      );
      return;
    }

    if (!isCurrent()) return;

    const id = makeId('import');
    const asset = {
      id,
      name: safeDisplayText(file.name, 'Imported image', 160),
      type: safeDisplayText(preparedImage.blob.type || file.type, 'image/*', 80),
      blob: preparedImage.blob,
      createdAt: Date.now()
    };

    try {
      await dbPut('imports', asset);
    } catch {
      setMessage('Could not save the imported image. Free some device storage and try again.');
      return;
    }

    if (!isCurrent()) {
      await dbDelete('imports', id).catch(() => {});
      return;
    }

    setImports((current) => [importListItem(asset), ...current.filter((entry) => entry.id !== id)]);

    if (uploadIntent === 'new-project') {
      startFreshWorkingProject(createDefaultProjectDesign({
        background: 'idb://imports/' + id,
        backgroundLabel: asset.name,
        sourceCrop: null,
        originalSourceCrop: null
      }), {
        studioTool: 'crop',
        statusMessage: 'New project created from ' + asset.name
      });
    } else {
      patch({
        background: 'idb://imports/' + id,
        backgroundLabel: asset.name,
        sourceCrop: null,
        originalSourceCrop: null,
        zoom: 1,
        x: 0,
        y: 0,
        rotate: 0,
        flipX: false,
        fit: 'cover'
      });
      setSelectedElement('artwork');
      setShowOriginal(false);
      setStudioTool('crop');
      setStudioSubtool('');
      setTab('studio');
      setMessage('Artwork replaced · existing card settings kept');
    }
      });
    } finally {
      // Keep the selected File alive through async WebKit decode/IndexedDB
      // work. Clearing the input early can invalidate its backing data on
      // Safari/WebKit before the import transaction finishes.
      input.value = '';
    }
  }

  async function uploadLayerImage(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      input.value = '';
      return;
    }
    try {
      await withImageImportLock(async (isCurrent) => {
    if ((designRef.current.customLayers || []).length >= MAX_CUSTOM_LAYERS) {
      setMessage('Layer limit reached. Delete a layer before adding another.');
      return;
    }
    if (visibleImageLayers(designRef.current).length >= MAX_VISIBLE_IMAGE_LAYERS) {
      setMessage('Visible image layer limit reached. Hide or delete an image layer before adding another.');
      return;
    }
    if (file.type && !file.type.startsWith('image/')) {
      setMessage('Choose an image file.');
      return;
    }
    if (file.size > MAX_IMAGE_IMPORT_BYTES) {
      setMessage('Image is too large. Choose a file under 30 MB.');
      return;
    }

    let preparedImage;
    try {
      preparedImage = await prepareLocalImageBlob(file, {
        maxPixels: MAX_STORED_LAYER_IMAGE_PIXELS,
        maxDimension: MAX_STORED_LAYER_IMAGE_DIMENSION
      });
    } catch (error) {
      setMessage(
        error?.message === 'Image dimensions are too large'
          ? 'Image resolution is too large for reliable iPhone editing.'
          : error?.message === 'Image dimensions could not be verified safely'
            ? 'This large image could not be verified safely before decoding.'
            : error?.message === 'Image remains too large after optimization'
              ? 'Image is still too large after optimization. Choose a smaller file.'
              : String(error?.message || '').startsWith('SVG')
                ? error.message
                : 'This image could not be decoded on this device.'
      );
      return;
    }

    if (!isCurrent()) return;

    const assetId = makeId('import');
    const layerId = makeId('layer');
    const asset = {
      id: assetId,
      name: safeDisplayText(file.name, 'Image layer', 160),
      type: safeDisplayText(preparedImage.blob.type || file.type, 'image/*', 80),
      blob: preparedImage.blob,
      createdAt: Date.now()
    };

    try {
      await dbPut('imports', asset);
    } catch {
      setMessage('Could not save the image layer. Free some device storage and try again.');
      return;
    }

    if (!isCurrent()) {
      await dbDelete('imports', assetId).catch(() => {});
      return;
    }

    if (
      (designRef.current.customLayers || []).length >= MAX_CUSTOM_LAYERS ||
      visibleImageLayers(designRef.current).length >= MAX_VISIBLE_IMAGE_LAYERS
    ) {
      await dbDelete('imports', assetId).catch(() => {});
      setMessage('Layer capacity changed while the image was processing. Try again after freeing a layer slot.');
      return;
    }

    setImports((current) => [importListItem(asset), ...current.filter((entry) => entry.id !== assetId)]);
    patch((current) => ({
      layerOrder: insertCustomLayerBelowHardware(current, layerId),
      customLayers: [
        ...(current.customLayers || []),
        {
          id: layerId,
          type: 'image',
          name: asset.name,
          src: 'idb://imports/' + assetId,
          x: 0.5,
          y: 0.5,
          scale: 1,
          rotation: 0,
          opacity: 1,
          width: 640,
          flipX: false,
          crop: null,
          originalCrop: null,
          adjustments: { ...IMAGE_LAYER_DEFAULTS },
          locked: false
        }
      ]
    }));
    setSelectedElement(layerId);
    setStudioTool('crop');
    setStudioSubtool('transform');
    setMessage('Image layer added');
      });
    } finally {
      input.value = '';
    }
  }

  function updateCropEdge(edge, rawValue) {
    const value = clamp(Number(rawValue), 0, 0.9);
    patch((current) => {
      const crop = current.sourceCrop || { x: 0, y: 0, w: 1, h: 1 };
      let left = clamp(crop.x, 0, 0.9);
      let top = clamp(crop.y, 0, 0.9);
      let right = clamp(1 - crop.x - crop.w, 0, 0.9);
      let bottom = clamp(1 - crop.y - crop.h, 0, 0.9);

      if (edge === 'left') left = Math.min(value, 0.9 - right);
      if (edge === 'right') right = Math.min(value, 0.9 - left);
      if (edge === 'top') top = Math.min(value, 0.9 - bottom);
      if (edge === 'bottom') bottom = Math.min(value, 0.9 - top);

      const nextCrop = normalizeCrop({
        x: left,
        y: top,
        w: Math.max(0.1, 1 - left - right),
        h: Math.max(0.1, 1 - top - bottom)
      });
      return cropsEqual(normalizeCrop(crop), nextCrop) ? {} : { sourceCrop: nextCrop };
    }, true, 'crop:' + edge);
  }

  function updateLayerCropEdge(id, edge, rawValue) {
    const value = clamp(Number(rawValue), 0, 0.9);
    patch((current) => {
      const layers = current.customLayers || [];
      const index = layers.findIndex((layer) => layer.id === id);
      if (index < 0) return {};

      const layer = layers[index];
      if (layer.type !== 'image' || layer.locked) return {};

      const crop = layer.crop || { x: 0, y: 0, w: 1, h: 1 };
      let left = clamp(crop.x, 0, 0.9);
      let top = clamp(crop.y, 0, 0.9);
      let right = clamp(1 - crop.x - crop.w, 0, 0.9);
      let bottom = clamp(1 - crop.y - crop.h, 0, 0.9);

      if (edge === 'left') left = Math.min(value, 0.9 - right);
      if (edge === 'right') right = Math.min(value, 0.9 - left);
      if (edge === 'top') top = Math.min(value, 0.9 - bottom);
      if (edge === 'bottom') bottom = Math.min(value, 0.9 - top);

      const nextCrop = normalizeCrop({
        x: left,
        y: top,
        w: Math.max(0.1, 1 - left - right),
        h: Math.max(0.1, 1 - top - bottom)
      });
      if (cropsEqual(normalizeCrop(crop), nextCrop)) return {};

      const nextLayers = layers.slice();
      nextLayers[index] = { ...layer, crop: nextCrop };
      return { customLayers: nextLayers };
    }, true, 'layer-crop:' + id + ':' + edge);
  }

  function addTextLayer() {
    if ((designRef.current.customLayers || []).length >= MAX_CUSTOM_LAYERS) {
      setMessage('Layer limit reached. Delete a layer before adding another.');
      return;
    }
    const id = makeId('layer');
    patch((current) => ({
      layerOrder: insertCustomLayerBelowHardware(current, id),
      customLayers: [
        ...(current.customLayers || []),
        {
          id,
          type: 'text',
          name: 'Text',
          text: 'TEXT',
          x: 0.5,
          y: 0.5,
          scale: 1,
          rotation: 0,
          opacity: 1,
          color: '#ffffff',
          fontSize: 58,
          fontFamily: 'system',
          weight: 700,
          letterSpacing: 0,
          lineHeight: 1.18,
          align: 'center',
          shadow: true,
          locked: false
        }
      ]
    }));
    setSelectedElement(id);
    setStudioTool('text');
    setStudioSubtool('');
    setMessage('Text layer added');
  }

  function addShapeLayer() {
    if ((designRef.current.customLayers || []).length >= MAX_CUSTOM_LAYERS) {
      setMessage('Layer limit reached. Delete a layer before adding another.');
      return;
    }
    const id = makeId('layer');
    patch((current) => ({
      layerOrder: insertCustomLayerBelowHardware(current, id),
      customLayers: [
        ...(current.customLayers || []),
        {
          id,
          type: 'shape',
          name: 'Shape',
          shape: 'rectangle',
          x: 0.5,
          y: 0.5,
          scale: 1,
          rotation: 0,
          opacity: 0.8,
          color: '#ffffff',
          width: 280,
          height: 120,
          radius: 28,
          locked: false
        }
      ]
    }));
    setSelectedElement(id);
    setStudioTool('crop');
    setStudioSubtool('transform');
    setMessage('Shape layer added');
  }

  function addChipLayer() {
    if ((designRef.current.customLayers || []).length >= MAX_CUSTOM_LAYERS) {
      setMessage('Layer limit reached. Delete a layer before adding another.');
      return;
    }
    const id = makeId('layer');
    patch((current) => ({
      layerOrder: insertCustomLayerBelowHardware(current, id),
      customLayers: [
        ...(current.customLayers || []),
        {
          id,
          type: 'chip',
          name: 'EMV Chip',
          x: 0.19,
          y: 0.44,
          scale: 1,
          rotation: 0,
          opacity: 1,
          tone: 'gold',
          locked: false
        }
      ]
    }));
    setSelectedElement(id);
    setStudioTool('crop');
    setStudioSubtool('transform');
    setMessage('Chip layer added');
  }

  function mergeCustomContactlessLayer(id) {
    const extra = (designRef.current.customLayers || []).find((layer) => layer.id === id && layer.type === 'contactless');
    if (!extra) return;
    patch((current) => ({
      contactless: true,
      contactlessX: extra.x ?? current.contactlessX,
      contactlessY: extra.y ?? current.contactlessY,
      contactlessScale: extra.scale ?? current.contactlessScale,
      contactlessRotation: extra.rotation ?? current.contactlessRotation,
      contactlessColor: extra.color || current.contactlessColor,
      contactlessOpacity: clamp(Number(extra.opacity ?? 1) * 0.9, 0, 1),
      customLayers: (current.customLayers || []).filter((layer) => layer.id !== id),
      layerOrder: (current.layerOrder || []).filter((entry) => entry !== id)
    }));
    setSelectedElement('contactless');
    setMessage('Extra Contactless merged into Card · Undo to restore');
  }

  function updateLayer(id, delta) {
    const currentLayer = (designRef.current.customLayers || []).find((layer) => layer.id === id);
    if (
      currentLayer?.type === 'image' &&
      currentLayer.hidden &&
      delta?.hidden === false &&
      visibleImageLayers(designRef.current).length >= MAX_VISIBLE_IMAGE_LAYERS
    ) {
      setMessage('Visible image layer limit reached. Hide another image layer before showing this one.');
      return;
    }

    const deltaKeys = Object.keys(delta || {});
    const key =
      deltaKeys.length === 1 && CONTINUOUS_LAYER_HISTORY_KEYS.has(deltaKeys[0])
        ? 'layer:' + id + ':' + deltaKeys[0]
        : '';
    patch((current) => {
      const layers = current.customLayers || [];
      const index = layers.findIndex((layer) => layer.id === id);
      if (index < 0) return {};

      const layer = layers[index];
      const lockedSafeChange = deltaKeys.every(
        (keyName) => keyName === 'locked' || keyName === 'hidden'
      );
      if (layer.locked && !lockedSafeChange) return {};

      const updated = { ...layer, ...delta };
      if (updated.type === 'shape') {
        const width = clamp(Number(updated.width ?? 280), 20, 1200);
        const height = clamp(Number(updated.height ?? 120), 20, 800);
        updated.width = width;
        updated.height = height;
        updated.radius = clamp(
          Number(updated.radius ?? 28),
          0,
          Math.min(width, height) / 2
        );
      }

      const relevantKeys = new Set(deltaKeys);
      if (updated.type === 'shape') {
        relevantKeys.add('width');
        relevantKeys.add('height');
        relevantKeys.add('radius');
      }

      if ([...relevantKeys].every((keyName) => Object.is(layer[keyName], updated[keyName]))) {
        return {};
      }

      const nextLayers = layers.slice();
      nextLayers[index] = updated;
      return { customLayers: nextLayers };
    }, true, key);
  }

  function deleteLayer(id) {
    const layer = (designRef.current.customLayers || []).find((entry) => entry.id === id);
    if (layer?.locked) {
      setMessage('Unlock the layer before deleting it');
      return;
    }
    patch((current) => ({
      layerOrder: normalizeLayerOrder(current).filter((entry) => entry !== id),
      customLayers: (current.customLayers || []).filter((entry) => entry.id !== id)
    }));
    setSelectedElement('artwork');
  }

  function duplicateLayer(id) {
    if ((designRef.current.customLayers || []).length >= MAX_CUSTOM_LAYERS) {
      setMessage('Layer limit reached. Delete a layer before duplicating.');
      return;
    }

    const sourceLayer = (designRef.current.customLayers || []).find((layer) => layer.id === id);
    if (
      sourceLayer?.type === 'image' &&
      !sourceLayer.hidden &&
      visibleImageLayers(designRef.current).length >= MAX_VISIBLE_IMAGE_LAYERS
    ) {
      setMessage('Visible image layer limit reached. Hide or delete an image layer before duplicating.');
      return;
    }

    patch((current) => {
      const source = (current.customLayers || []).find((layer) => layer.id === id);
      if (!source) return {};
      const offsetDuplicateCoordinate = (rawValue) => {
        const value = clamp(Number(rawValue ?? 0.5), 0, 1);
        return clamp(value + (value > 0.94 ? -0.03 : 0.03), 0, 1);
      };
      const copy = {
        ...source,
        id: makeId('layer'),
        name: (source.name || source.type) + ' Copy',
        x: offsetDuplicateCoordinate(source.x),
        y: offsetDuplicateCoordinate(source.y)
      };
      const order = normalizeLayerOrder(current);
      const sourceIndex = order.indexOf(id);
      const nextOrder = [...order];
      nextOrder.splice(sourceIndex >= 0 ? sourceIndex + 1 : 0, 0, copy.id);
      setSelectedElement(copy.id);
      return {
        customLayers: [...(current.customLayers || []), copy],
        layerOrder: nextOrder
      };
    });
  }

  function moveLayer(id, direction) {
    const layer = (designRef.current.customLayers || []).find((entry) => entry.id === id);
    if (layer?.locked) {
      setMessage('Unlock the layer before reordering it');
      return;
    }
    patch((current) => {
      const order = normalizeLayerOrder(current);
      const index = order.indexOf(id);
      if (index < 0) return {};

      let target = index + direction;
      while (
        target >= 0 &&
        target < order.length &&
        !isLayerStackEntryListed(current, order[target])
      ) {
        target += direction;
      }

      if (target < 0 || target >= order.length || target === index) return {};

      const next = [...order];
      const [entry] = next.splice(index, 1);
      next.splice(target, 0, entry);
      return { layerOrder: next };
    });
  }

  function patchImageTarget(delta) {
    const deltaKeys = Object.keys(delta || {});
    const key =
      deltaKeys.length === 1
        ? 'image:' + selectedElement + ':' + deltaKeys[0]
        : '';
    patch((current) => {
      const layers = current.customLayers || [];
      const index = layers.findIndex((entry) => entry.id === selectedElement);
      const layer = index >= 0 ? layers[index] : null;
      if (layer?.type === 'image') {
        if (layer.locked) return {};
        const currentSettings = {
          ...IMAGE_LAYER_DEFAULTS,
          ...(layer.adjustments || {})
        };
        if (deltaKeys.every((keyName) => Object.is(currentSettings[keyName], delta[keyName]))) {
          return {};
        }

        const nextLayers = layers.slice();
        nextLayers[index] = {
          ...layer,
          adjustments: {
            ...currentSettings,
            ...delta
          }
        };
        return { customLayers: nextLayers };
      }
      return delta;
    }, true, key);
  }

  function applyAdjustmentPreset(name) {
    const preset = ADJUSTMENT_PRESETS[name];
    if (!preset) return;
    patchImageTarget(preset);
    setMessage(name + ' preset applied');
  }

  function applyCardPreset(name) {
    const preset = CARD_PRESETS[name];
    if (!preset) return;
    patch(preset);
    setMessage(name + ' card preset applied');
  }

  function surpriseMe() {
    const pool = [
      ...cucuItems,
      ...Object.values(featured).flat()
    ].filter((item, index, all) => item?.id && all.findIndex((other) => other.id === item.id) === index);

    if (!pool.length) {
      setMessage('Load some card skins first');
      return;
    }

    const item = pool[Math.floor(Math.random() * pool.length)];
    useArtwork(item);
  }

  async function saveProject(nameOverride = '') {
    if (!hydrated) {
      setMessage('Library is still loading. Try saving again once it is ready.');
      return null;
    }
    if (imageImportInFlightRef.current) {
      setMessage('Finish the image import before saving this design.');
      return null;
    }
    if (presetTransferInFlightRef.current || cleanupInFlightRef.current) {
      setMessage('Finish the current asset operation before saving this design.');
      return null;
    }
    if (projectSaveInFlightRef.current) {
      setMessage('A design save is already in progress');
      return null;
    }

    projectSaveInFlightRef.current = true;
    setProjectSaveInProgress(true);

    try {
      const currentDesign = designRef.current;
    const now = Date.now();
    const id = makeId('project');
    const name = nameOverride.trim() || currentDesign.backgroundLabel || 'Untitled Card';
    let preview = '';

    if (assetsReadyForDesign(currentDesign)) {
      try {
        preview = makeCanvas(384, 242).toDataURL('image/jpeg', 0.78);
      } catch {}
    }

    const project = {
      id,
      name,
      design: JSON.parse(JSON.stringify(currentDesign)),
      preview,
      createdAt: now,
      updatedAt: now
    };

    let projectInserted = false;
    try {
      projectInserted = await dbPutIfBelowLimit('projects', project, MAX_SAVED_PROJECTS);
    } catch {
      setMessage('Could not save this design. Device storage may be full.');
      return null;
    }
    if (!projectInserted) {
      setMessage('Project limit reached. Delete an older saved design before saving another.');
      return null;
    }
    setProjects((current) => [project, ...current]);

    const remoteArtwork = new Set();
    if (currentDesign.background.startsWith('/api/image?')) {
      remoteArtwork.add(currentDesign.background);
    }
    for (const layer of currentDesign.customLayers || []) {
      if (layer?.type === 'image' && String(layer.src || '').startsWith('/api/image?')) {
        remoteArtwork.add(layer.src);
      }
    }

    let offlineCacheComplete = true;
    if (remoteArtwork.size) {
      const queue = [...remoteArtwork];
      const cacheResults = new Array(queue.length).fill(false);
      let cursor = 0;

      const worker = async () => {
        while (cursor < queue.length) {
          const index = cursor;
          cursor += 1;
          cacheResults[index] = await cacheArtwork(queue[index]);
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(3, queue.length) }, () => worker())
      );
      offlineCacheComplete = cacheResults.every(Boolean);
    }

      setMessage(
        !preview
          ? 'Saved to Library · preview unavailable'
          : offlineCacheComplete
            ? 'Saved to Library'
            : 'Saved to Library · some remote art is not cached offline'
      );
      return project;
    } finally {
      projectSaveInFlightRef.current = false;
      setProjectSaveInProgress(false);
    }
  }

  async function withProjectOperation(projectId, task) {
    const id = String(projectId || '');
    if (!id || projectOpsRef.current.has(id)) return false;

    projectOpsRef.current.add(id);
    setProjectBusyIds((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });

    try {
      await task();
      return true;
    } finally {
      projectOpsRef.current.delete(id);
      setProjectBusyIds((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  function openProject(project) {
    finishActiveGesture();
    if (!project?.design) return;
    if (cleanupInFlightRef.current) {
      setMessage('Finish cleaning imported images before opening a design.');
      return;
    }
    if (projectOpsRef.current.has(String(project.id || ''))) {
      setMessage('That design is still being updated');
      return;
    }

    startFreshWorkingProject(
      { ...DEFAULTS, ...project.design },
      {
        studioTool: 'crop',
        statusMessage: (project.name || 'Design') + ' opened · previous unsaved work cleared'
      }
    );
  }

  async function duplicateProject(project) {
    await withProjectOperation(project?.id, async () => {
    const copy = {
      ...project,
      id: makeId('project'),
      name: safeDisplayText((project.name || 'Design') + ' Copy', 'Design Copy', 160),
      design: JSON.parse(JSON.stringify(project.design || DEFAULTS)),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    let copyInserted = false;
    try {
      copyInserted = await dbPutIfBelowLimit('projects', copy, MAX_SAVED_PROJECTS);
    } catch {
      setMessage('Could not duplicate this design. Device storage may be full.');
      return;
    }
    if (!copyInserted) {
      setMessage('Project limit reached. Delete an older saved design before duplicating.');
      return;
    }
    setProjects((current) => [copy, ...current]);
    setMessage('Design duplicated');
    });
  }

  async function removeProject(project) {
    const projectName = project?.name || 'this design';
    if (!window.confirm('Delete "' + projectName + '" permanently?')) return;

    await withProjectOperation(project?.id, async () => {

    try {
      await dbDelete('projects', project.id);
    } catch {
      setMessage('Could not delete this design.');
      return;
    }
    setProjects((current) => current.filter((entry) => entry.id !== project.id));
    setMessage('Design deleted');
    });
  }

  async function cleanupUnusedImports() {
    if (cleanupInFlightRef.current || cleanupInProgress) return;
    if (presetTransferInFlightRef.current) {
      setMessage('Finish the preset operation before cleaning imported images.');
      return;
    }
    if (imageImportInFlightRef.current) {
      setMessage('Finish the image import before cleaning imported images.');
      return;
    }
    if (projectSaveInFlightRef.current) {
      setMessage('Finish saving the design before cleaning imported images.');
      return;
    }
    if (projectOpsRef.current.size) {
      setMessage('Finish the current project operation before cleaning imported images.');
      return;
    }

    cleanupInFlightRef.current = true;
    setCleanupInProgress(true);

    try {
      const flushedDraft = await persistDraftSnapshot(designRef.current);
      if (!flushedDraft?.success) {
        setMessage('Could not flush the current draft safely, so no imported images were removed.');
        return;
      }
      await draftSaveQueueRef.current;

      const referenced = new Set();
  
      const addDesignRefs = (value) => {
        if (!value || typeof value !== 'object') return;

        const background = typeof value.background === 'string' ? value.background : '';
        if (background.startsWith('idb://imports/')) {
          referenced.add(background.slice('idb://imports/'.length));
        }

        const layers = Array.isArray(value.customLayers) ? value.customLayers : [];
        for (const layer of layers) {
          const src = typeof layer?.src === 'string' ? layer.src : '';
          if (src.startsWith('idb://imports/')) {
            referenced.add(src.slice('idb://imports/'.length));
          }
        }
      };
  
      addDesignRefs(designRef.current);
      for (const snapshot of undoRef.current) addDesignRefs(snapshot);
      for (const snapshot of redoRef.current) addDesignRefs(snapshot);

      let storedDraft;
      try {
        storedDraft = await dbGet('kv', 'draft');
      } catch {
        setMessage('Could not verify the autosaved draft, so no imported images were removed.');
        return;
      }
      addDesignRefs(storedDraft?.design);

      try {
        const fallbackDraft = localStorage.getItem('aircard-sticker-fvp-v3');
        if (fallbackDraft) {
          const parsedFallback = JSON.parse(fallbackDraft);
          addDesignRefs(parsedFallback);
        }
      } catch {
        setMessage('Could not verify the fallback draft, so no imported images were removed.');
        return;
      }
  
      let storedProjects;
      try {
        storedProjects = await dbGetAll('projects');
      } catch {
        setMessage('Could not verify saved designs, so no imported images were removed.');
        return;
      }
      for (const project of storedProjects) addDesignRefs(project?.design);

      let storedImports;
      try {
        storedImports = await dbGetImportMetadata();
      } catch {
        setMessage('Could not verify imported images, so nothing was removed.');
        return;
      }
  
      const unused = storedImports.filter((asset) => asset?.id && !referenced.has(asset.id));
      if (!unused.length) {
        setMessage('No unused imported images to clean up');
        return;
      }
  
      if (!window.confirm(
        'Permanently remove ' + unused.length + ' unused imported image' +
        (unused.length === 1 ? '' : 's') + '?'
      )) return;

      // Re-check every reference after the confirmation dialog. The user can
      // still Undo/Redo or switch designs while the dialog is open, and an
      // asset that was unused when cleanup started may now be live again.
      addDesignRefs(designRef.current);
      for (const snapshot of undoRef.current) addDesignRefs(snapshot);
      for (const snapshot of redoRef.current) addDesignRefs(snapshot);

      try {
        await draftSaveQueueRef.current;
        const latestDraft = await dbGet('kv', 'draft');
        addDesignRefs(latestDraft?.design);
      } catch {
        setMessage('Could not re-check the autosaved draft, so no imported images were removed.');
        return;
      }

      try {
        const latestFallbackDraft = localStorage.getItem('aircard-sticker-fvp-v3');
        if (latestFallbackDraft) addDesignRefs(JSON.parse(latestFallbackDraft));
      } catch {
        setMessage('Could not re-check the fallback draft, so no imported images were removed.');
        return;
      }

      try {
        const latestProjects = await dbGetAll('projects');
        for (const project of latestProjects) addDesignRefs(project?.design);
      } catch {
        setMessage('Could not re-check saved designs, so no imported images were removed.');
        return;
      }

      const deletable = unused.filter((asset) => asset?.id && !referenced.has(asset.id));
      if (!deletable.length) {
        setMessage('Nothing was removed because those imports became referenced again.');
        return;
      }

      const failed = [];
      let deleteCursor = 0;
      const deleteWorker = async () => {
        while (deleteCursor < deletable.length) {
          const index = deleteCursor;
          deleteCursor += 1;
          const asset = deletable[index];
          try {
            await dbDelete('imports', asset.id);
          } catch {
            failed.push(asset.id);
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(4, deletable.length) }, () => deleteWorker())
      );
  
      const removed = new Set(deletable.map((asset) => asset.id).filter((id) => !failed.includes(id)));
      setImports((current) => current.filter((asset) => !removed.has(asset.id)));
      setMessage(
        failed.length
          ? 'Removed ' + removed.size + ' unused imports; ' + failed.length + ' could not be removed'
          : 'Removed ' + removed.size + ' unused imported image' + (removed.size === 1 ? '' : 's')
      );
    } finally {
      cleanupInFlightRef.current = false;
      setCleanupInProgress(false);
    }
  }

  async function serializePreset() {
    const currentDesign = designRef.current;
    const payload = {
      version: 2,
      app: 'AirCard Card Studio',
      exportedAt: new Date().toISOString(),
      design: JSON.parse(JSON.stringify(currentDesign))
    };

    const refs = new Set();
    if (currentDesign.background?.startsWith('idb://imports/')) {
      refs.add(currentDesign.background.slice('idb://imports/'.length));
    }
    for (const layer of currentDesign.customLayers || []) {
      if (layer.src?.startsWith('idb://imports/')) {
        refs.add(layer.src.slice('idb://imports/'.length));
      }
    }

    if (refs.size > MAX_PRESET_ASSETS) {
      throw new Error('This design references too many imported image assets for a preset');
    }

    const assets = [];
    let embeddedBytes = 0;
    let estimatedEncodedBytes = 0;

    for (const id of refs) {
      const asset = await dbGet('imports', id);
      if (!asset?.blob) {
        throw new Error('A referenced imported image is missing');
      }

      const blobBytes = Number(asset.blob.size || 0);
      embeddedBytes += blobBytes;
      estimatedEncodedBytes += Math.ceil(blobBytes / 3) * 4;

      if (embeddedBytes > MAX_PRESET_EMBEDDED_BYTES) {
        throw new Error('This design has too much imported image data for a safe preset export');
      }
      if (estimatedEncodedBytes > MAX_PRESET_IMPORT_BYTES - 1024 * 1024) {
        throw new Error('This design would create a preset that is too large to export safely');
      }

      assets.push({
        id,
        name: safeDisplayText(asset.name, 'Preset asset', 160),
        type: safeDisplayText(asset.type, 'image/*', 80)
      });
    }

    return { payload, assets };
  }

  async function exportPresetJson() {
    if (imageImportInFlightRef.current) {
      setMessage('Finish the image import before exporting a preset.');
      return;
    }
    if (presetTransferInFlightRef.current) {
      setMessage('Another preset operation is already in progress');
      return;
    }
    if (cleanupInFlightRef.current) {
      setMessage('Finish cleaning imported images before exporting a preset.');
      return;
    }

    presetTransferInFlightRef.current = true;
    setPresetTransferInProgress(true);
    setMessage('Preparing design preset…');

    let url = '';
    let anchor = null;

    try {
      const { payload, assets } = await serializePreset();
      const parts = [
        '{"version":2,"app":',
        JSON.stringify(payload.app),
        ',"exportedAt":',
        JSON.stringify(payload.exportedAt),
        ',"design":',
        JSON.stringify(payload.design),
        ',"assets":{'
      ];

      let firstAsset = true;
      for (const asset of assets) {
        const stored = await dbGet('imports', asset.id);
        if (!stored?.blob) {
          throw new Error('A referenced imported image disappeared during preset export');
        }

        if (!firstAsset) parts.push(',');
        firstAsset = false;
        const dataUrl = await blobToDataUrl(stored.blob);
        parts.push(
          JSON.stringify(asset.id),
          ':{"name":',
          JSON.stringify(asset.name || ''),
          ',"type":',
          JSON.stringify(asset.type || 'image/*'),
          ',"data":',
          JSON.stringify(dataUrl),
          '}'
        );
      }
      parts.push('}}');

      const blob = new Blob(parts, { type: 'application/json' });
      parts.length = 0;
      if (blob.size > MAX_PRESET_IMPORT_BYTES) {
        throw new Error('The generated preset is too large to export safely');
      }

      url = URL.createObjectURL(blob);
      anchor = document.createElement('a');
      const presetFileBase =
        (payload.design.backgroundLabel || 'aircard-design')
          .replace(/[^a-z0-9_-]+/gi, '-')
          .replace(/^-+|-+$/g, '') ||
        'aircard-design';
      anchor.href = url;
      anchor.download = presetFileBase + '.aircard.json';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      setMessage('Design preset exported');
    } catch (error) {
      setMessage(error?.message || 'Design preset could not be exported');
    } finally {
      anchor?.remove();
      if (url) setTimeout(() => URL.revokeObjectURL(url), 10000);
      presetTransferInFlightRef.current = false;
      setPresetTransferInProgress(false);
    }
  }

  async function importPresetJson(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (presetTransferInFlightRef.current) {
      setMessage('Another preset operation is already in progress');
      return;
    }
    if (cleanupInFlightRef.current) {
      setMessage('Finish cleaning imported images before importing a preset.');
      return;
    }
    if (imageImportInFlightRef.current) {
      setMessage('Finish the image import before importing a preset.');
      return;
    }
    if (file.size > MAX_PRESET_IMPORT_BYTES) {
      setMessage('Design preset is too large to import safely.');
      return;
    }

    const createdImportIds = [];
    let presetApplied = false;
    let superseded = false;
    const generation = ++presetImportGenerationRef.current;
    presetImportActiveRef.current = true;
    presetTransferInFlightRef.current = true;
    setPresetTransferInProgress(true);
    setMessage('Importing design preset…');

    const ensureCurrentPresetImport = () => {
      if (presetImportGenerationRef.current !== generation) {
        superseded = true;
        throw new Error('Preset import superseded');
      }
    };

    try {
      const payload = JSON.parse(await file.text());
      ensureCurrentPresetImport();
      if (!payload?.design || Number(payload.version) !== 2) {
        throw new Error('Unsupported preset version');
      }

      if (
        Array.isArray(payload.design.customLayers) &&
        payload.design.customLayers.length > MAX_CUSTOM_LAYERS
      ) {
        throw new Error('Preset contains too many layers');
      }
      if (
        Array.isArray(payload.design.layerOrder) &&
        payload.design.layerOrder.length > MAX_CUSTOM_LAYERS + BUILTIN_LAYER_IDS.length
      ) {
        throw new Error('Preset contains an invalid layer order');
      }

      const idMap = Object.create(null);
      const presetAssets = Object.entries(payload.assets || {});
      if (presetAssets.length > MAX_PRESET_ASSETS) {
        throw new Error('Preset contains too many embedded assets');
      }
      const presetAssetMap = new Map(presetAssets);
      const normalizedIncomingDesign = normalizeDesignState(payload.design);
      const referencedPresetAssetIds = new Set();
      const rawBackground = String(normalizedIncomingDesign.background || '');
      if (rawBackground.startsWith('idb://imports/')) {
        referencedPresetAssetIds.add(rawBackground.slice('idb://imports/'.length));
      }
      for (const layer of normalizedIncomingDesign.customLayers || []) {
        const src = String(layer?.src || '');
        if (layer?.type === 'image' && src.startsWith('idb://imports/')) {
          referencedPresetAssetIds.add(src.slice('idb://imports/'.length));
        }
      }
      if (referencedPresetAssetIds.size > MAX_PRESET_ASSETS) {
        throw new Error('Preset references too many embedded assets');
      }
      if (
        Array.isArray(payload.design.customLayers) &&
        payload.design.customLayers.filter(
          (layer) => layer?.type === 'image' && layer.src && !layer.hidden
        ).length > MAX_VISIBLE_IMAGE_LAYERS
      ) {
        throw new Error('Preset contains too many visible image layers');
      }

      const presetBackgroundAssetId = rawBackground.startsWith('idb://imports/')
        ? rawBackground.slice('idb://imports/'.length)
        : '';

      // Drop embedded payloads the design never references before decoding
      // any images. Large base64 strings otherwise stay live for the whole
      // import and can cause avoidable memory pressure in mobile Safari.
      for (const [assetId, asset] of presetAssets) {
        if (referencedPresetAssetIds.has(assetId)) continue;
        if (asset && typeof asset === 'object') asset.data = '';
        presetAssetMap.delete(assetId);
      }

      let estimatedEmbeddedBytes = 0;

      for (const oldId of referencedPresetAssetIds) {
        const asset = presetAssetMap.get(oldId);
        if (!asset?.data) {
          throw new Error('Preset is missing a referenced image asset');
        }
        const assetType = String(asset.type || '');
        if ((assetType && !assetType.startsWith('image/')) || !String(asset.data).startsWith('data:image/')) {
          throw new Error('Preset contains a non-image asset');
        }

        const estimatedBytes = estimateDataUrlBytes(asset.data);
        if (!Number.isFinite(estimatedBytes) || estimatedBytes > MAX_IMAGE_IMPORT_BYTES) {
          throw new Error('Preset image asset is too large');
        }
        estimatedEmbeddedBytes += estimatedBytes;
        if (estimatedEmbeddedBytes > MAX_PRESET_EMBEDDED_BYTES) {
          throw new Error('Preset contains too much embedded image data');
        }

        const blob = dataUrlToBlob(asset.data);
        // The Blob owns the decoded bytes now; release the much larger base64
        // string before rasterization and IndexedDB work.
        asset.data = '';
        if (blob.size > MAX_IMAGE_IMPORT_BYTES) {
          throw new Error('Preset image asset is too large');
        }
        const preparedImage = await prepareLocalImageBlob(
          blob,
          oldId === presetBackgroundAssetId
            ? {}
            : {
                maxPixels: MAX_STORED_LAYER_IMAGE_PIXELS,
                maxDimension: MAX_STORED_LAYER_IMAGE_DIMENSION
              }
        );
        ensureCurrentPresetImport();

        const newId = makeId('import');
        idMap[oldId] = newId;
        await dbPut('imports', {
          id: newId,
          name: safeDisplayText(asset.name, 'Preset asset', 160),
          type: safeDisplayText(preparedImage.blob.type || asset.type, 'image/*', 80),
          blob: preparedImage.blob,
          createdAt: Date.now()
        });
        createdImportIds.push(newId);
        presetAssetMap.delete(oldId);
        ensureCurrentPresetImport();
      }

      const imported = JSON.parse(JSON.stringify(normalizedIncomingDesign));
      if (imported.background?.startsWith('idb://imports/')) {
        const oldId = imported.background.slice('idb://imports/'.length);
        imported.background = idMap[oldId] ? 'idb://imports/' + idMap[oldId] : '';
      } else {
        imported.background = normalizePersistedArtworkSource(imported.background, 3072);
      }

      imported.customLayers = (Array.isArray(imported.customLayers) ? imported.customLayers : []).map((layer) => {
        if (!layer || layer.type !== 'image') return layer;
        const src = String(layer.src || '');
        if (src.startsWith('idb://imports/')) {
          const oldId = src.slice('idb://imports/'.length);
          return { ...layer, src: idMap[oldId] ? 'idb://imports/' + idMap[oldId] : '' };
        }
        return {
          ...layer,
          src: normalizePersistedArtworkSource(src, MAX_STORED_LAYER_IMAGE_DIMENSION)
        };
      });

      const nextImports = await dbGetImportMetadata();
      ensureCurrentPresetImport();
      presetImportActiveRef.current = false;
      setImports(nextImports);
      startFreshWorkingProject(
        { ...DEFAULTS, ...imported },
        {
          studioTool: 'crop',
          statusMessage: 'Design preset imported'
        }
      );
      presetApplied = true;
    } catch {
      if (!presetApplied && createdImportIds.length) {
        await Promise.all(createdImportIds.map((id) => dbDelete('imports', id).catch(() => {})));
      }
      if (!superseded) {
        setMessage('Preset could not be imported');
      }
    } finally {
      presetImportActiveRef.current = false;
      presetTransferInFlightRef.current = false;
      setPresetTransferInProgress(false);
    }
  }

  function reset() {
    finishActiveGesture();
    if (cleanupInFlightRef.current) {
      setMessage('Finish cleaning imported images before starting a new card.');
      return;
    }

    startFreshWorkingProject(createDefaultProjectDesign(), {
      studioTool: 'crop',
      statusMessage: 'New card ready · unsaved work cleared'
    });
  }

  function hitTestElement(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / Math.max(1, rect.width)) * OUT_W;
    const py = ((event.clientY - rect.top) / Math.max(1, rect.height)) * OUT_H;
    const hitPadding = Math.max(14, (22 * OUT_W) / Math.max(1, rect.width));
    const currentDesign = designRef.current;
    const customLayerMap = new Map((currentDesign.customLayers || []).map((layer) => [layer.id, layer]));
    const stack = normalizeLayerOrder(currentDesign).slice().reverse();

    for (const stackId of stack) {
      if (stackId === 'builtin-contactless' && currentDesign.contactless) {
        if (
          pointInRotatedBounds(
            px,
            py,
            currentDesign.contactlessX * OUT_W,
            currentDesign.contactlessY * OUT_H,
            currentDesign.contactlessRotation,
            Number(currentDesign.contactlessScale || 1),
            CONTACTLESS_BOUNDS,
            hitPadding
          )
        ) {
          return 'contactless';
        }
        continue;
      }

      if (stackId === 'builtin-visa' && currentDesign.visa) {
        if (pointInRotatedBounds(px, py, currentDesign.visaX * OUT_W, currentDesign.visaY * OUT_H, currentDesign.visaRotation, Number(currentDesign.visaScale || 1), VISA_BOUNDS, hitPadding)) return 'visa';
        continue;
      }

      if (stackId === 'builtin-chip' && currentDesign.chip) {
        const chipW = 255 * Number(currentDesign.chipScale || 1);
        const chipH = 188 * Number(currentDesign.chipScale || 1);
        const cx = currentDesign.chipX * OUT_W + chipW / 2;
        const cy = currentDesign.chipY * OUT_H + chipH / 2;
        if (
          pointInRotatedBounds(
            px,
            py,
            cx,
            cy,
            currentDesign.chipRotation,
            1,
            { left: -chipW / 2, top: -chipH / 2, right: chipW / 2, bottom: chipH / 2 },
            hitPadding
          )
        ) {
          return 'chip';
        }
        continue;
      }

      if (stackId === 'builtin-text') {
        if (pointInBuiltinText(px, py, currentDesign, hitPadding)) {
          return 'card-text';
        }
        continue;
      }

      if (BUILTIN_LAYER_IDS.includes(stackId)) continue;

      const layer = customLayerMap.get(stackId);
      if (!layer || layer.hidden || Number(layer.opacity ?? 1) <= 0.01) continue;
      if (layer.type === 'text' && !String(layer.text ?? '').trim()) continue;

      const exactLayerImage =
        loadedImageLayerSourceKey === imageLayerSourceKey
          ? layerImages[layer.id]
          : null;
      if (layer.type === 'image' && !exactLayerImage) continue;

      const layerX = Number(layer.x ?? 0.5) * OUT_W;
      const layerY = Number(layer.y ?? 0.5) * OUT_H;
      const layerScale = clamp(Number(layer.scale ?? 1), 0.1, 6);

      if (layer.type === 'shape') {
        const shapeWidth = clamp(Number(layer.width ?? 280), 20, 1200);
        const shapeHeight = clamp(Number(layer.height ?? 120), 20, 800);

        if (layer.shape === 'ellipse') {
          if (
            pointInRotatedEllipse(
              px,
              py,
              layerX,
              layerY,
              layer.rotation,
              layerScale,
              shapeWidth,
              shapeHeight,
              hitPadding
            )
          ) {
            return layer.id;
          }
          continue;
        }

        if (
          pointInRotatedRoundedRect(
            px,
            py,
            layerX,
            layerY,
            layer.rotation,
            layerScale,
            shapeWidth,
            shapeHeight,
            clamp(Number(layer.radius ?? 28), 0, Math.min(shapeWidth, shapeHeight) / 2),
            hitPadding
          )
        ) {
          return layer.id;
        }
        continue;
      }

      const bounds = customLayerBounds(layer, exactLayerImage);
      if (
        pointInRotatedBounds(
          px,
          py,
          layerX,
          layerY,
          layer.rotation,
          layerScale,
          bounds,
          hitPadding
        )
      ) {
        return layer.id;
      }
    }

    return 'artwork';
  }

  function recordGestureHistory() {
    if (gestureHistoryRecorded.current || !gestureStartDesign.current) return;
    undoRef.current = [...undoRef.current.slice(-49), gestureStartDesign.current];
    redoRef.current = [];
    gestureHistoryRecorded.current = true;
    setHistoryVersion((value) => value + 1);
  }

  function pointerDown(event) {
    event.preventDefault();

    // The editor supports one-finger drag and two-finger transform. Ignore
    // additional touches so an accidental third finger cannot stale the
    // pinch baseline and cause a jump when it lifts.
    if (pointers.current.size >= 2) return;

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}

    if (pointers.current.size === 0) {
      historyGroupRef.current = { key: '', at: 0 };
      const target = hitTestElement(event);
      gestureTarget.current = target;
      gestureStartDesign.current = designRef.current;
      gestureHistoryRecorded.current = false;

      if (target === 'card-text') {
        setSelectedElement('card-text');
        setStudioTool('card');
        setStudioSubtool('number');
        setMessage('Card text controls ready');
      } else {
        setSelectedElement(target);
        if (target === 'chip' || target === 'contactless' || target === 'visa') {
          setStudioTool('card');
          setStudioSubtool(target);
        } else if (target === 'artwork') {
          setStudioTool('crop');
        } else {
          const tappedLayer = (designRef.current.customLayers || []).find((layer) => layer.id === target);
          if (tappedLayer?.type === 'text') { setStudioTool('text'); setStudioSubtool(''); }
          else if (tappedLayer?.type === 'image' || tappedLayer?.type === 'shape' || tappedLayer?.type === 'chip' || tappedLayer?.type === 'contactless') { setStudioTool('crop'); setStudioSubtool('transform'); }
        }
      }
    }

    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 1) {
      lastPoint.current = { x: event.clientX, y: event.clientY };
    }

    if (pointers.current.size === 2) {
      const p = Array.from(pointers.current.values());
      lastDistance.current = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      lastAngle.current = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
    }
  }

  function pointerMove(event) {
    if (!pointers.current.has(event.pointerId)) return;
    event.preventDefault();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const target = gestureTarget.current || selectedElement;

    if (pointers.current.size === 1 && lastPoint.current) {
      const rect = event.currentTarget.getBoundingClientRect();
      const dx = (event.clientX - lastPoint.current.x) / Math.max(1, rect.width);
      const dy = (event.clientY - lastPoint.current.y) / Math.max(1, rect.height);
      const moved = Math.abs(dx) + Math.abs(dy) > 0.00001;

      if (moved) {
        const currentDesign = designRef.current;

        if (target === 'chip') {
          const snapX = snapValue(
            clamp(currentDesign.chipX + dx, 0, 0.82),
            [0.04, 0.105, 1 / 3, 0.5, 2 / 3, 0.78]
          );
          const snapY = snapValue(
            clamp(currentDesign.chipY + dy, 0, 0.8),
            [0.04, 1 / 3, 0.35, 0.5, 2 / 3, 0.76]
          );
          setActiveGuides({
            x: snapX.snapped ? snapX.value : null,
            y: snapY.snapped ? snapY.value : null
          });

          if (
            !Object.is(currentDesign.chipX, snapX.value) ||
            !Object.is(currentDesign.chipY, snapY.value)
          ) {
            recordGestureHistory();
            patch({ chipX: snapX.value, chipY: snapY.value }, false);
          }
        } else if (target === 'contactless' && !currentDesign.contactlessLocked) {
          const snapX = snapValue(
            clamp(currentDesign.contactlessX + dx, 0.03, 0.97),
            [0.05, 0.285, 1 / 3, 0.5, 2 / 3, 0.95]
          );
          const snapY = snapValue(
            clamp(currentDesign.contactlessY + dy, 0.03, 0.97),
            [0.05, 1 / 3, 0.43, 0.5, 2 / 3, 0.95]
          );
          setActiveGuides({
            x: snapX.snapped ? snapX.value : null,
            y: snapY.snapped ? snapY.value : null
          });

          if (
            !Object.is(currentDesign.contactlessX, snapX.value) ||
            !Object.is(currentDesign.contactlessY, snapY.value)
          ) {
            recordGestureHistory();
            patch({ contactlessX: snapX.value, contactlessY: snapY.value }, false);
          }
        } else if (target === 'visa') {
          const snapX = snapValue(clamp(currentDesign.visaX + dx, 0.1, 0.9), [0.2, 1 / 3, 0.5, 2 / 3, 0.8, 0.84]);
          const snapY = snapValue(clamp(currentDesign.visaY + dy, 0.08, 0.92), [0.16, 1 / 3, 0.5, 2 / 3, 0.84]);
          setActiveGuides({ x: snapX.snapped ? snapX.value : null, y: snapY.snapped ? snapY.value : null });
          if (!Object.is(currentDesign.visaX, snapX.value) || !Object.is(currentDesign.visaY, snapY.value)) { recordGestureHistory(); patch({ visaX: snapX.value, visaY: snapY.value }, false); }
        } else if (target !== 'artwork') {
          const layer = (currentDesign.customLayers || []).find((entry) => entry.id === target);
          if (layer && !layer.locked) {
            const currentX = Number(layer.x ?? 0.5);
            const currentY = Number(layer.y ?? 0.5);
            const snapX = snapValue(
              clamp(currentX + dx, 0, 1),
              [0.05, 1 / 3, 0.5, 2 / 3, 0.95]
            );
            const snapY = snapValue(
              clamp(currentY + dy, 0, 1),
              [0.05, 1 / 3, 0.5, 2 / 3, 0.95]
            );
            setActiveGuides({
              x: snapX.snapped ? snapX.value : null,
              y: snapY.snapped ? snapY.value : null
            });

            if (!Object.is(currentX, snapX.value) || !Object.is(currentY, snapY.value)) {
              recordGestureHistory();
              patch((current) => {
                const layers = current.customLayers || [];
                const index = layers.findIndex((entry) => entry.id === target);
                if (index < 0) return {};

                const entry = layers[index];
                const entryX = Number(entry.x ?? 0.5);
                const entryY = Number(entry.y ?? 0.5);
                if (Object.is(entryX, snapX.value) && Object.is(entryY, snapY.value)) {
                  return {};
                }

                const nextLayers = layers.slice();
                nextLayers[index] = { ...entry, x: snapX.value, y: snapY.value };
                return { customLayers: nextLayers };
              }, false);
            }
          }
        } else if (currentDesign.background) {
          const rawX = clamp(currentDesign.x + dx, -1.5, 1.5);
          const rawY = clamp(currentDesign.y + dy, -1.5, 1.5);
          const snapX = snapValue(rawX, [-0.45, -1 / 6, 0, 1 / 6, 0.45]);
          const snapY = snapValue(rawY, [-0.45, -1 / 6, 0, 1 / 6, 0.45]);
          setActiveGuides({
            x: snapX.snapped ? clamp(0.5 + snapX.value, 0.05, 0.95) : null,
            y: snapY.snapped ? clamp(0.5 + snapY.value, 0.05, 0.95) : null
          });

          if (!Object.is(currentDesign.x, snapX.value) || !Object.is(currentDesign.y, snapY.value)) {
            recordGestureHistory();
            patch({ x: snapX.value, y: snapY.value }, false);
          }
        }
      }

      lastPoint.current = { x: event.clientX, y: event.clientY };
    } else if (pointers.current.size === 2) {
      const p = Array.from(pointers.current.values());
      const distance = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      const angle = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
      const factor = lastDistance.current ? distance / Math.max(1, lastDistance.current) : 1;
      const angleDelta = lastAngle.current == null
        ? 0
        : normalizeAngleDelta(((angle - lastAngle.current) * 180) / Math.PI);
      const transformed = Math.abs(factor - 1) > 0.0005 || Math.abs(angleDelta) > 0.02;
      const currentDesign = designRef.current;
      const gestureLayer = target !== 'artwork' && target !== 'chip' && target !== 'contactless' && target !== 'visa'
        ? (currentDesign.customLayers || []).find((layer) => layer.id === target)
        : null;
      const transformBlocked = Boolean(
        target === 'card-text' ||
        (target === 'contactless' && currentDesign.contactlessLocked) ||
        gestureLayer?.locked ||
        (target === 'artwork' && !currentDesign.background)
      );

      if (transformed && !transformBlocked) {
        if (target === 'chip') {
          const nextScale = clamp(currentDesign.chipScale * factor, 0.5, 2);
          const nextRotation = clamp(currentDesign.chipRotation + angleDelta, -45, 45);
          if (
            !Object.is(currentDesign.chipScale, nextScale) ||
            !Object.is(currentDesign.chipRotation, nextRotation)
          ) {
            recordGestureHistory();
            patch({ chipScale: nextScale, chipRotation: nextRotation }, false);
          }
        } else if (target === 'contactless') {
          const nextScale = clamp(currentDesign.contactlessScale * factor, 0.4, 2.2);
          const nextRotation = normalizeFreeRotation(
            Number(currentDesign.contactlessRotation || 0) + angleDelta
          );
          if (
            !Object.is(currentDesign.contactlessScale, nextScale) ||
            !Object.is(Number(currentDesign.contactlessRotation || 0), nextRotation)
          ) {
            recordGestureHistory();
            patch({ contactlessScale: nextScale, contactlessRotation: nextRotation }, false);
          }
        } else if (target === 'visa') {
          const nextScale = clamp(currentDesign.visaScale * factor, 0.45, 2.2);
          const nextRotation = normalizeFreeRotation(currentDesign.visaRotation + angleDelta);
          if (!Object.is(currentDesign.visaScale, nextScale) || !Object.is(currentDesign.visaRotation, nextRotation)) {
            recordGestureHistory();
            patch({ visaScale: nextScale, visaRotation: nextRotation }, false);
          }
        } else if (target !== 'artwork' && gestureLayer) {
          const currentScale = Number(gestureLayer.scale ?? 1);
          const currentRotation = Number(gestureLayer.rotation ?? 0);
          const nextScale = clamp(currentScale * factor, 0.1, 6);
          const nextRotation = normalizeFreeRotation(currentRotation + angleDelta);

          if (!Object.is(currentScale, nextScale) || !Object.is(currentRotation, nextRotation)) {
            recordGestureHistory();
            patch((current) => {
              const layers = current.customLayers || [];
              const index = layers.findIndex((layer) => layer.id === target);
              if (index < 0) return {};

              const layer = layers[index];
              const layerScale = Number(layer.scale ?? 1);
              const layerRotation = Number(layer.rotation ?? 0);
              if (
                Object.is(layerScale, nextScale) &&
                Object.is(layerRotation, nextRotation)
              ) {
                return {};
              }

              const nextLayers = layers.slice();
              nextLayers[index] = {
                ...layer,
                scale: nextScale,
                rotation: nextRotation
              };
              return { customLayers: nextLayers };
            }, false);
          }
        } else if (target === 'artwork') {
          const currentRotation = Number(currentDesign.rotate || 0);
          const nextZoom = clamp(currentDesign.zoom * factor, 0.5, 5);
          const nextRotation = normalizeFreeRotation(currentRotation + angleDelta);
          if (
            !Object.is(currentDesign.zoom, nextZoom) ||
            !Object.is(currentRotation, nextRotation)
          ) {
            recordGestureHistory();
            patch({ zoom: nextZoom, rotate: nextRotation }, false);
          }
        }
      }

      lastDistance.current = distance;
      lastAngle.current = angle;
    }

    if (gestureHistoryRecorded.current) scheduleGesturePreview();
  }

  function pointerUp(event) {
    pointers.current.delete(event.pointerId);

    if (pointers.current.size === 1) {
      const remaining = Array.from(pointers.current.values())[0];
      lastPoint.current = remaining ? { ...remaining } : null;
    } else {
      lastPoint.current = null;
    }

    if (pointers.current.size < 2) {
      lastDistance.current = null;
      lastAngle.current = null;
    }

    if (pointers.current.size === 0) {
      if (gestureHistoryRecorded.current) {
        replaceDesign(designRef.current);
      }
      setActiveGuides({ x: null, y: null });
      gestureStartDesign.current = null;
      gestureHistoryRecorded.current = false;
    }
  }

  function makeCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      canvas.width = 1;
      canvas.height = 1;
      throw new Error('Canvas rendering is unavailable');
    }
    renderCard(ctx, width, height, {
      original: false,
      design: designRef.current
    });
    return canvas;
  }

  async function recordExport(name, width, height, action) {
    const record = {
      id: makeId('export'),
      name,
      width,
      height,
      action,
      designName: designRef.current.backgroundLabel || 'Untitled Card',
      createdAt: Date.now()
    };

    try {
      await dbPut('exports', record);
    } catch {
      return false;
    }

    setExportHistory((current) => [record, ...current].slice(0, 40));

    dbGetAll('exports')
      .then((records) => records
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
        .slice(100)
      )
      .then((stale) => Promise.all(stale.map((entry) => dbDelete('exports', entry.id).catch(() => {}))))
      .catch(() => {});

    return true;
  }

  function makePngFile(width, height, name) {
    // Keep file creation synchronous so iOS retains the user-activation
    // required by navigator.share().
    const dataUrl = makeCanvas(width, height).toDataURL('image/png');
    const blob = dataUrlToBlob(dataUrl);
    return new File([blob], name, { type: 'image/png' });
  }

  async function download(width, height, name, existingFile = null) {
    let file = existingFile;
    if (!file) {
      try {
        file = makePngFile(width, height, name);
      } catch {
        setMessage('PNG export failed. Re-open the artwork or image layer and try again.');
        return false;
      }
    }

    let url = '';
    let anchor = null;

    try {
      url = URL.createObjectURL(file);
      anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      const historySaved = await recordExport(name, width, height, 'download');
      setMessage(
        historySaved
          ? name + ' saved to Files/downloads'
          : name + ' saved to Files/downloads · export history could not be stored'
      );
      return true;
    } catch {
      setMessage('Could not start the PNG download on this device.');
      return false;
    } finally {
      anchor?.remove();
      if (url) setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  }

  async function nativeExportPng(
    width = OUT_W,
    height = OUT_H,
    name = 'cardBackgroundCombined@3x.png'
  ) {
    if (imageImportInFlightRef.current) {
      setMessage('Finish the image import before exporting.');
      return;
    }
    if (presetTransferInFlightRef.current || cleanupInFlightRef.current) {
      setMessage('Finish the current asset operation before exporting.');
      return;
    }
    if (exportInFlightRef.current) {
      setMessage('An export is already in progress');
      return;
    }

    exportInFlightRef.current = true;
    setExportInProgress(true);

    try {
      if (!assetsReadyForDesign(designRef.current)) {
        setMessage(
          backgroundLoadError ||
          layerLoadError ||
          'Artwork is still loading. Export is available when every image is ready.'
        );
        return;
      }

      let file;
      try {
        file = makePngFile(width, height, name);
      } catch {
        setMessage('PNG export failed. Re-open the artwork or image layer and try again.');
        return;
      }

      let canShareFile = false;
      try {
        canShareFile = Boolean(
          navigator.share &&
          (!navigator.canShare || navigator.canShare({ files: [file] }))
        );
      } catch {
        canShareFile = false;
      }

      if (!canShareFile) {
        const downloaded = await download(width, height, name, file);
        if (downloaded) {
          setMessage('Native image sharing is unavailable, so the PNG download was started instead.');
        }
        return;
      }

      try {
        setMessage('Opening the native image sheet… Choose “Save Image” to save it to Photos.');
        await navigator.share({ files: [file] });
        const historySaved = await recordExport(name, width, height, 'native-image-sheet');
        setMessage(
          historySaved
            ? 'Image sheet closed'
            : 'Image shared successfully · export history could not be stored'
        );
      } catch (error) {
        if (error?.name === 'AbortError') {
          setMessage('Image sharing canceled');
        } else {
          const downloaded = await download(width, height, name, file);
          if (downloaded) {
            setMessage('Native image sharing failed, so the PNG download was started instead.');
          } else {
            setMessage('Could not share or download the PNG on this device.');
          }
        }
      }
    } finally {
      exportInFlightRef.current = false;
      setExportInProgress(false);
    }
  }

  async function share() {
    return nativeExportPng(OUT_W, OUT_H, 'cardBackgroundCombined@3x.png');
  }

  function dismissInstallHelp() {
    try {
      localStorage.setItem('aircard-install-dismissed-v2', '1');
    } catch {}
    setInstallHelp(false);
  }

  const selectedLayer = useMemo(
    () => (design.customLayers || []).find((layer) => layer.id === selectedElement) || null,
    [design.customLayers, selectedElement]
  );

  useEffect(() => {
    if (selectedElement === 'artwork') return;
    if (selectedElement === 'chip') {
      if (!design.chip) setSelectedElement('artwork');
      return;
    }
    if (selectedElement === 'contactless') {
      if (!design.contactless) setSelectedElement('artwork');
      return;
    }
    if (selectedElement === 'card-text') {
      if (!isLayerStackEntryVisible(design, 'builtin-text')) {
        setSelectedElement('artwork');
      }
      return;
    }
    if (!(design.customLayers || []).some((layer) => layer.id === selectedElement)) {
      setSelectedElement('artwork');
    }
  }, [
    design.badge,
    design.chip,
    design.contactless,
    design.customLayers,
    design.expiry,
    design.holder,
    design.number,
    selectedElement
  ]);

  const selectedImageLayer = selectedLayer?.type === 'image' ? selectedLayer : null;
  const activeImageSettings = selectedImageLayer
    ? { ...IMAGE_LAYER_DEFAULTS, ...(selectedImageLayer.adjustments || {}) }
    : design;
  const activeImageRenderable = selectedImageLayer
    ? Boolean(
        selectedImageLayer.src &&
        !selectedImageLayer.hidden &&
        loadedImageLayerSourceKey === imageLayerSourceKey &&
        layerImages[selectedImageLayer.id]
      )
    : Boolean(
        design.background &&
        image &&
        loadedBackgroundKey === design.background
      );
  const activeImageEditable =
    activeImageRenderable &&
    !Boolean(selectedImageLayer?.locked);
  const activeImageLabel = selectedImageLayer
    ? (selectedImageLayer.name || 'Image Layer')
    : 'Artwork';
  const activeEffectThumbnail = selectedImageLayer
    ? layerImages[selectedImageLayer.id]?.src
    : image?.src;

  const activateStudioTool = useCallback((value) => {
    setStudioTool(value);
    setStudioSubtool('');
    setStudioMenuOpen(false);
    if (value === 'text') {
      const textLayer = (designRef.current.customLayers || []).find((layer) => layer.type === 'text' && !layer.hidden);
      if (textLayer) setSelectedElement(textLayer.id);
    } else if (value === 'adjust' || value === 'effects') {
      const layers = designRef.current.customLayers || [];
      const selectedImage = layers.find((layer) => layer.id === selectedElement && layer.type === 'image' && !layer.hidden);
      const topImage = normalizeLayerOrder(designRef.current).slice().reverse()
        .map((id) => layers.find((layer) => layer.id === id))
        .find((layer) => layer?.type === 'image' && !layer.hidden && layer.src);
      setSelectedElement(selectedImage?.id || topImage?.id || 'artwork');
    } else if (value === 'layers') {
      setMessage('Layer stack');
    } else if (value === 'background') {
      setSelectedElement('artwork');
    } else if (selectedElement === 'card-text' && value !== 'card') {
      setSelectedElement('artwork');
    }
  }, [selectedElement]);

  const visualLayerStack = useMemo(() => {
    const custom = new Map((design.customLayers || []).map((layer) => [layer.id, layer]));
    return normalizeLayerOrder(design)
      .filter((id) => isLayerStackEntryListed(design, id))
      .slice()
      .reverse()
      .map((id) => {
        if (id === 'builtin-chip') {
          return { id, name: 'Chip', type: 'Built-in hardware', selection: 'chip', builtin: true, hidden: !design.chip };
        }
        if (id === 'builtin-contactless') {
          return { id, name: 'Contactless', type: 'Built-in hardware', selection: 'contactless', builtin: true, hidden: !design.contactless };
        }
        if (id === 'builtin-visa') {
          return { id, name: 'VISA', type: 'Built-in card mark', selection: 'visa', builtin: true, hidden: !design.visa };
        }
        if (id === 'builtin-text') {
          return {
            id,
            name: 'Card Text',
            type: 'Built-in text',
            selection: 'card-text',
            builtin: true,
            action: 'card-text',
            hidden: !(design.badge || design.number || design.holder || design.expiry)
          };
        }
        const layer = custom.get(id);
        return layer
          ? {
              id,
              name: layer.type === 'contactless' ? 'Custom Contactless' : (layer.name || layer.type),
              type: layer.type,
              selection: layer.id,
              builtin: false,
              locked: layer.locked,
              hidden: layer.hidden
            }
          : null;
      })
      .filter(Boolean);
  }, [design]);

  const toggleVisualLayerVisibility = useCallback((entry) => {
    if (!entry) return;
    if (!entry.builtin) {
      updateLayer(entry.id, { hidden: !entry.hidden });
      return;
    }
    if (entry.id === 'builtin-chip') patch({ chip: !designRef.current.chip });
    else if (entry.id === 'builtin-contactless') patch({ contactless: !designRef.current.contactless });
    else if (entry.id === 'builtin-visa') patch({ visa: !designRef.current.visa });
    else if (entry.id === 'builtin-text') {
      const current = designRef.current;
      const visible = Boolean(current.badge || current.number || current.holder || current.expiry);
      patch(visible ? { badge:false, number:false, holder:false, expiry:false } : { number:true });
    }
  }, [patch, updateLayer]);

  const preview = (
    <section className={'previewShell editingPreview ' + (tab === 'studio' ? 'studioPreview ' : 'exportPreview ') + (previewMode === 'physical' ? 'physicalPreview' : '')}>
      <div className="studioFloatingBar" aria-label="Studio history and comparison controls">
        {tab === 'studio' ? (
          <>
            <button type="button" className="studioEditorBack" onClick={() => setTab('discover')} aria-label="Back to Discover">
              <IOSIcon name="chevron" size={20} />
            </button>
            <strong className="studioEditorTitle">Studio</strong>
          </>
        ) : null}
        <div className="historyButtons">
          <button type="button" onClick={undo} disabled={!undoRef.current.length} aria-label="Undo"><IOSIcon name="undo" size={18} /></button>
          <button type="button" onClick={redo} disabled={!redoRef.current.length} aria-label="Redo"><IOSIcon name="redo" size={18} /></button>
        </div>
        <span className={'savePill ' + (saveStatus === 'Saved' ? 'isSaved' : '')}>{saveStatus}</span>
        {selectedElement !== 'artwork' ? (
          <button
            type="button"
            className="doneSelectionButton"
            onClick={() => {
              setSelectedElement('artwork');
              setMessage('Artwork selected');
            }}
          >
            Done
          </button>
        ) : null}
        {tab === 'studio' ? (
          <div className="studioOverflowWrap">
            <button type="button" className="beforeAfterButton studioOverflowButton" aria-label="More Studio actions" aria-expanded={studioMenuOpen} onClick={() => setStudioMenuOpen((open) => !open)}>•••</button>
            {studioMenuOpen ? <div className="studioOverflowMenu">
              <button type="button" onClick={() => { reset(); setStudioMenuOpen(false); }}>New Card</button>
              <button type="button" onClick={() => { setGuidesEnabled((value) => !value); setStudioMenuOpen(false); }}>{guidesEnabled ? 'Hide Guides' : 'Show Guides'}</button>
              <button type="button" onClick={() => { if (expertMode && studioTool === 'crop' && studioSubtool === 'precision') setStudioSubtool(''); setExpertMode((value) => !value); setStudioMenuOpen(false); }}>{expertMode ? 'Disable Precision' : 'Enable Precision'}</button>
              <button type="button" disabled={!activeImageRenderable || !renderAssetsReady} onPointerDown={() => setShowOriginal(true)} onPointerUp={() => setShowOriginal(false)} onPointerCancel={() => setShowOriginal(false)}>Hold for Before</button>
              <button type="button" onClick={() => { setSelectedElement('artwork'); setStudioTool('layers'); setStudioSubtool(''); setStudioMenuOpen(false); }}>Layers</button>
              <button type="button" onClick={() => { setSelectedElement('artwork'); setStudioTool('background'); setStudioSubtool(''); setStudioMenuOpen(false); }}>Background</button>
            </div> : null}
          </div>
        ) : (
          <button type="button" className="beforeAfterButton" disabled={!activeImageRenderable || !renderAssetsReady} onPointerDown={() => setShowOriginal(true)} onPointerUp={() => setShowOriginal(false)} onPointerCancel={() => setShowOriginal(false)} onPointerLeave={() => setShowOriginal(false)}><IOSIcon name="compare" size={16}/><span>{showOriginal ? 'After' : 'Before / After'}</span></button>
        )}
      </div>

      <div className={'cardFrame ' + (previewMode === 'physical' ? 'physicalCard' : '')}>
        <canvas
          ref={canvasRef}
          width={EDITOR_PREVIEW_W}
          height={EDITOR_PREVIEW_H}
          style={{ touchAction: previewMode === 'flat' ? 'none' : 'pan-y' }}
          onPointerDown={previewMode === 'flat' ? pointerDown : undefined}
          onPointerMove={previewMode === 'flat' ? pointerMove : undefined}
          onPointerUp={previewMode === 'flat' ? pointerUp : undefined}
          onPointerCancel={previewMode === 'flat' ? pointerUp : undefined}
          onLostPointerCapture={previewMode === 'flat' ? pointerUp : undefined}
          onClick={previewMode === 'physical' ? () => {
            setPreviewMode('flat');
            setMessage('Flat preview enabled for editing');
          } : undefined}
          aria-label={
            previewMode === 'flat'
              ? 'Editable card preview. Drag the selected element. Use two fingers to scale and rotate.'
              : 'Physical card preview. Tap to return to Flat editing mode.'
          }
        />

        {tab === 'studio' && previewMode === 'flat' && guidesEnabled ? (
          <div className="cardGuides" aria-hidden="true">
            <i className="guide bleedEdge" />
            <i className="guide cropBoundary" />
            <i className="guide safeEdge" />
            <i className="guide textSafe" />
            <i className="guide chipZone" />
            <i className="guide contactlessZone" />
            {activeGuides.x != null ? <i className="snapGuide vertical" style={{ left: (activeGuides.x * 100) + '%' }} /> : null}
            {activeGuides.y != null ? <i className="snapGuide horizontal" style={{ top: (activeGuides.y * 100) + '%' }} /> : null}
          </div>
        ) : null}

        {tab === 'studio' && previewMode === 'flat' && selectedElement === 'chip' && design.chip ? (
          <div
            className="selectionOutline chipSelection"
            aria-hidden="true"
            style={{
              left: (design.chipX * 100) + '%',
              top: (design.chipY * 100) + '%',
              width: ((255 * design.chipScale / OUT_W) * 100) + '%',
              height: ((188 * design.chipScale / OUT_H) * 100) + '%',
              transform: 'rotate(' + Number(design.chipRotation || 0) + 'deg)'
            }}
          />
        ) : null}

        {tab === 'studio' && previewMode === 'flat' && selectedElement === 'contactless' && design.contactless ? (
          <div
            className="selectionOutline contactlessSelection"
            aria-hidden="true"
            style={selectionStyleForBounds(
              design.contactlessX * OUT_W,
              design.contactlessY * OUT_H,
              Number(design.contactlessScale || 1),
              Number(design.contactlessRotation || 0),
              CONTACTLESS_BOUNDS
            )}
          />
        ) : null}

        {previewMode === 'physical' && design.chip ? (
          <i
            className="physicalChipReflection"
            aria-hidden="true"
            style={{
              left: (design.chipX * 100) + '%',
              top: (design.chipY * 100) + '%',
              width: ((255 * design.chipScale / OUT_W) * 100) + '%',
              height: ((188 * design.chipScale / OUT_H) * 100) + '%',
              '--chip-rotation': Number(design.chipRotation || 0) + 'deg'
            }}
          />
        ) : null}

        {tab === 'studio' &&
        previewMode === 'flat' &&
        selectedLayer &&
        !selectedLayer.hidden &&
        (selectedLayer.type !== 'image' ||
          (loadedImageLayerSourceKey === imageLayerSourceKey && Boolean(layerImages[selectedLayer.id]))) ? (
          <div
            className="selectionOutline layerSelection"
            aria-hidden="true"
            style={customLayerSelectionStyle(
              selectedLayer,
              selectedLayer.type === 'image' ? layerImages[selectedLayer.id] : null
            )}
          />
        ) : null}
      </div>

      <div className="previewCaption" aria-live="polite">
        <span>{design.backgroundLabel}</span>
        <span>{message}</span>
      </div>
    </section>
  );

  const blockingAssetOperation = cleanupInProgress || presetTransferInProgress;

  return (
    <>
      <main
        className={'studio ' + (tab === 'studio' ? 'isStudioEditor' : '')}
        inert={blockingAssetOperation || undefined}
        aria-busy={blockingAssetOperation || undefined}
      >
      <header className="largeTitleBar">
        <h1>Card Studio</h1>
      </header>

      {!online ? (
        <div className="offlineBanner" role="status">
          Offline · cached favorites, projects, and previously loaded card art remain available.
        </div>
      ) : null}

      {(tab === 'studio' || tab === 'export') ? preview : null}

      <div className="screenContent">
        {tab === 'discover' && (
          <div className="tabScreen discoverScreen" role="tabpanel" id="panel-discover" aria-labelledby="tab-discover">
            <section className="discoverHero">
              <div>
                <span className="eyebrow">Card Library</span>
                <h2>Discover a card skin</h2>
              </div>
              <button type="button" className="surpriseButton" onClick={surpriseMe}>Surprise Me</button>
            </section>

            <div className="searchField discoverSearch">
              <IOSIcon name="search" size={19} />
              <input
                value={searchInput}
                aria-label="Search all card skins"
                enterKeyHint="search"
                placeholder="Search 2,225+ card skins"
                onChange={(event) => setSearchInput(event.target.value)}
              />
              {searchInput ? (
                <button type="button" className="clearSearch" onClick={() => setSearchInput('')} aria-label="Clear search">
                  <IOSIcon name="x" size={16} />
                </button>
              ) : null}
            </div>

            <div className="categoryScroller discoverCategories" role="group" aria-label="Card skin collection">
              {CUCU_CATEGORIES.map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={!query && cucuCategory === value}
                  className={!query && cucuCategory === value ? 'categoryChip selected' : 'categoryChip'}
                  onClick={() => {
                    const clearingSearch = Boolean(query || searchInput.trim());
                    setSearchInput('');
                    setQuery('');
                    catalogIntentRef.current = value + '\u0000';
                    if (value === cucuCategory && cucuPage > 0 && !clearingSearch) return;
                    setCucuCategory(value);
                    setCucuCategoryLabel(label);
                    setCucuItems([]);
                    setCucuPage(0);
                    setCucuTotal(0);
                    setCucuHasMore(true);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {!query && cucuCategory === 'all' ? (
              <>
                {Object.entries(featured).map(([title, items]) => (
                  <ArtworkRail
                    key={title}
                    title={title}
                    items={items}
                    onPick={useArtwork}
                    favoriteIds={favoriteIds}
                    onFavorite={toggleFavorite}
                    onMenu={setMenuItem}
                  />
                ))}
                <ArtworkRail
                  title="Recently Used"
                  items={recent}
                  onPick={useArtwork}
                  favoriteIds={favoriteIds}
                  onFavorite={toggleFavorite}
                  onMenu={setMenuItem}
                />
              </>
            ) : null}

            {query || cucuCategory !== 'all' ? (
              <>
                <StoreCatalog
                  storeName="Card Library"
                  categoryLabel={cucuCategoryLabel}
                  items={cucuItems}
                  total={cucuTotal}
                  loading={cucuLoading}
                  error={catalogError}
                  onRetry={() => loadCucu(Math.max(1, cucuPage || 1), cucuPage === 0, cucuCategory, query)}
                  onPick={useArtwork}
                  favoriteIds={favoriteIds}
                  onFavorite={toggleFavorite}
                  onMenu={setMenuItem}
                />
                <div ref={loadMoreRef} className="infiniteSentinel" aria-hidden="true" />
              </>
            ) : null}

            <div className="discoverImportRow">
              <button
                type="button"
                className="secondaryAction uploadAction"
                disabled={imageImportInProgress || presetTransferInProgress || cleanupInProgress}
                onClick={() => {
                  uploadIntentRef.current = 'new-project';
                  uploadRef.current?.click();
                }}
              >
                <IOSIcon name="photo" size={21} />
                <span>Import Photo or File</span>
              </button>
              <input ref={uploadRef} type="file" accept="image/*" hidden onChange={uploadImage} />
            </div>
          </div>
        )}

        {tab === 'studio' && (
          <div className="tabScreen studioScreen" role="tabpanel" id="panel-studio" aria-labelledby="tab-studio">
            <input ref={uploadRef} type="file" accept="image/*" hidden onChange={uploadImage} />
            <input ref={layerUploadRef} type="file" accept="image/*" hidden onChange={uploadLayerImage} />
            <div className="studioModeRow">
              <div className="studioToolBar" role="tablist" aria-label="Studio tools">
                {STUDIO_TOOLS.map(([value, label]) => (
                  <button
                    type="button"
                    role="tab"
                    key={value}
                    aria-selected={studioTool === value}
                    tabIndex={studioTool === value ? 0 : -1}
                    className={studioTool === value ? 'active' : ''}
                    onKeyDown={(event) => handleTabKeyDown(
                      event,
                      STUDIO_TOOLS.map(([tool]) => tool),
                      studioTool,
                      activateStudioTool
                    )}
                    onClick={() => activateStudioTool(value)}
                  >
                    <span className="studioToolIcon"><IOSIcon name={value === 'crop' ? 'scissors' : value} size={22} /></span>
                    <span className="studioToolLabel">{label}</span>
                  </button>
                ))}
              </div>

              <div className="studioModeActions">
                <span className="studioModeLabel">Preview</span>
                <div className="previewModeToggle" role="group" aria-label="Preview style">
                  <button type="button" aria-pressed={previewMode === 'flat'} className={previewMode === 'flat' ? 'active' : ''} onClick={() => setPreviewMode('flat')}>Flat</button>
                  <button type="button" aria-pressed={previewMode === 'physical'} className={previewMode === 'physical' ? 'active' : ''} onClick={() => setPreviewMode('physical')}>Preview</button>
                </div>
              </div>
            </div>

            {studioTool === 'crop' && !studioSubtool ? (
              <section className="studioContextCard capcutContextPanel capcutRootPanel">
                <div className="contextPanelHeader"><strong>Edit</strong><span className="contextDone">✓</span></div>
                <div className="capcutSubtools">
                  <button type="button" className="active" onClick={() => setStudioSubtool('crop')}><IOSIcon name="crop" size={22}/><small>Crop</small></button>
                  <button type="button" onClick={() => setStudioSubtool('transform')}><IOSIcon name="position" size={22}/><small>Transform</small></button>
                  <button type="button" disabled={Boolean(selectedLayer?.locked)} onClick={() => selectedLayer ? updateLayer(selectedLayer.id,{rotation:normalizeFreeRotation(Number(selectedLayer.rotation||0)+90)}) : patch({ rotate: normalizeFreeRotation(Number(design.rotate || 0) + 90) })}><IOSIcon name="rotate" size={22}/><small>Rotate</small></button>
                  <button type="button" disabled={Boolean(selectedLayer?.locked)} onClick={() => selectedLayer ? updateLayer(selectedLayer.id,{flipX:!selectedLayer.flipX}) : patch({ flipX: !design.flipX })}><IOSIcon name="flip" size={22}/><small>Flip</small></button>
                  <button type="button" disabled={Boolean(selectedLayer?.locked)} onClick={() => selectedLayer ? updateLayer(selectedLayer.id,{x:0.5,y:0.5,scale:1,rotation:0,flipX:false}) : patch({ zoom:1,x:0,y:0,rotate:0,flipX:false,sourceCrop:design.originalSourceCrop||null })}><IOSIcon name="reset" size={22}/><small>Reset</small></button>
                  {expertMode ? <button type="button" onClick={() => setStudioSubtool('precision')}><span>123</span><small>Precision</small></button> : null}
                </div>
              </section>
            ) : null}

            {studioTool === 'crop' && studioSubtool === 'transform' ? (
              <section className="studioContextCard capcutContextPanel">
                <div className="contextPanelHeader"><button type="button" className="contextBack" onClick={() => setStudioSubtool('')}>‹</button><strong>Transform</strong><button type="button" onClick={() => setStudioSubtool('')}>✓</button></div>
                {selectedLayer ? <>
                  <fieldset disabled={Boolean(selectedLayer.locked)} style={{border:0,padding:0,margin:0,minWidth:0}}>
                  <SliderRow label="Scale" value={selectedLayer.scale || 1} min={0.2} max={4} step={0.01} disabled={Boolean(selectedLayer.locked)} onChange={(value) => updateLayer(selectedLayer.id,{scale:value})}/>
                  <SliderRow label="Horizontal" value={selectedLayer.x ?? 0.5} min={0} max={1} step={0.005} disabled={Boolean(selectedLayer.locked)} onChange={(value) => updateLayer(selectedLayer.id,{x:value})}/>
                  <SliderRow label="Vertical" value={selectedLayer.y ?? 0.5} min={0} max={1} step={0.005} disabled={Boolean(selectedLayer.locked)} onChange={(value) => updateLayer(selectedLayer.id,{y:value})}/>
                  <SliderRow label="Rotation" value={selectedLayer.rotation || 0} min={-180} max={180} step={1} suffix="°" disabled={Boolean(selectedLayer.locked)} onChange={(value) => updateLayer(selectedLayer.id,{rotation:value})}/>
                  {selectedLayer.type === 'image' ? <><SliderRow label="Image Width" value={selectedLayer.width ?? 640} min={20} max={1800} step={1} disabled={Boolean(selectedLayer.locked)} onChange={(value)=>updateLayer(selectedLayer.id,{width:value})}/><SwitchRow label="Flip Image" value={Boolean(selectedLayer.flipX)} onChange={(value)=>updateLayer(selectedLayer.id,{flipX:value})}/></> : null}
                  {selectedLayer.type === 'shape' ? <><div className="segmentedControl capcutSegmented"><button type="button" className={selectedLayer.shape!=='ellipse'?'selected':''} onClick={()=>updateLayer(selectedLayer.id,{shape:'rectangle'})}>Rectangle</button><button type="button" className={selectedLayer.shape==='ellipse'?'selected':''} onClick={()=>updateLayer(selectedLayer.id,{shape:'ellipse'})}>Ellipse</button></div><SliderRow label="Width" value={selectedLayer.width??280} min={20} max={1200} step={1} onChange={(value)=>updateLayer(selectedLayer.id,{width:value})}/><SliderRow label="Height" value={selectedLayer.height??120} min={20} max={800} step={1} onChange={(value)=>updateLayer(selectedLayer.id,{height:value})}/>{selectedLayer.shape!=='ellipse'?<SliderRow label="Corner Radius" value={selectedLayer.radius??28} min={0} max={Math.max(0,Math.floor(Math.min(Number(selectedLayer.width??280),Number(selectedLayer.height??120))/2))} step={1} onChange={(value)=>updateLayer(selectedLayer.id,{radius:value})}/>:null}<label className="colorRow"><span>Shape Color</span><input type="color" value={selectedLayer.color||'#ffffff'} onChange={(e)=>updateLayer(selectedLayer.id,{color:e.target.value})}/></label></> : null}
                  {selectedLayer.type === 'chip' ? <div className="tonePicker">{['gold','silver','black','rose'].map((tone)=><button type="button" key={tone} className={selectedLayer.tone===tone?'selected':''} onClick={()=>updateLayer(selectedLayer.id,{tone})}><i className={'chipTone '+tone}/><span>{tone}</span></button>)}</div> : null}
                  {selectedLayer.type === 'contactless' ? <label className="colorRow"><span>Contactless Color</span><input type="color" value={selectedLayer.color||'#ffffff'} onChange={(e)=>updateLayer(selectedLayer.id,{color:e.target.value})}/></label> : null}
                  <SliderRow label="Opacity" value={selectedLayer.opacity ?? 1} min={0} max={1} step={0.01} disabled={Boolean(selectedLayer.locked)} onChange={(value)=>updateLayer(selectedLayer.id,{opacity:value})}/>
                  </fieldset>
                  <SwitchRow label="Show Layer" value={!selectedLayer.hidden} onChange={(value)=>updateLayer(selectedLayer.id,{hidden:!value})}/>
                  <SwitchRow label="Lock Layer" value={Boolean(selectedLayer.locked)} onChange={(value)=>updateLayer(selectedLayer.id,{locked:value})}/>
                  <div className="layerActionGrid"><button type="button" onClick={()=>duplicateLayer(selectedLayer.id)}>Duplicate</button><button type="button" disabled={Boolean(selectedLayer.locked)} onClick={()=>deleteLayer(selectedLayer.id)}>Delete</button></div>
                </> : <>
                  <SliderRow label="Scale" value={design.zoom} min={0.5} max={3} step={0.01} onChange={(value) => patch({ zoom: value })}/>
                  <SliderRow label="Horizontal" value={design.x} min={-1} max={1} step={0.01} onChange={(value) => patch({ x: value })}/>
                  <SliderRow label="Vertical" value={design.y} min={-1} max={1} step={0.01} onChange={(value) => patch({ y: value })}/>
                  <SliderRow label="Rotation" value={design.rotate} min={-180} max={180} step={1} suffix="°" onChange={(value) => patch({ rotate: value })}/>
                </>}
              </section>
            ) : null}

            {studioTool === 'crop' && studioSubtool === 'precision' && expertMode ? (
              <section className="studioContextCard capcutContextPanel">
                <div className="contextPanelHeader"><button type="button" className="contextBack" onClick={() => setStudioSubtool('')}>‹</button><strong>Precision</strong><button type="button" onClick={() => setStudioSubtool('')}>✓</button></div>
                <Group title="Precision" footer="Exact numerical access to every global transform, adjustment, effect, and card-hardware parameter.">
                    <NumericField label="Zoom" value={design.zoom} min={0.5} max={5} onChange={(value) => patch({ zoom: value })} />
                    <NumericField label="Artwork X" value={design.x} min={-1.5} max={1.5} onChange={(value) => patch({ x: value })} />
                    <NumericField label="Artwork Y" value={design.y} min={-1.5} max={1.5} onChange={(value) => patch({ y: value })} />
                    <NumericField label="Artwork Rotation" value={design.rotate} min={-180} max={180} step={0.1} onChange={(value) => patch({ rotate: value })} suffix="°" />
                    <NumericField label="Crop Left" value={design.sourceCrop?.x || 0} min={0} max={0.9} onChange={(value) => updateCropEdge('left', value)} />
                    <NumericField label="Crop Right" value={design.sourceCrop ? Math.max(0, 1 - design.sourceCrop.x - design.sourceCrop.w) : 0} min={0} max={0.9} onChange={(value) => updateCropEdge('right', value)} />
                    <NumericField label="Crop Top" value={design.sourceCrop?.y || 0} min={0} max={0.9} onChange={(value) => updateCropEdge('top', value)} />
                    <NumericField label="Crop Bottom" value={design.sourceCrop ? Math.max(0, 1 - design.sourceCrop.y - design.sourceCrop.h) : 0} min={0} max={0.9} onChange={(value) => updateCropEdge('bottom', value)} />
                    <NumericField label="Exposure" value={design.exposure} min={-1} max={1} onChange={(value) => patch({ exposure: value })} />
                    <NumericField label="Brightness" value={design.brightness} min={0.4} max={1.7} onChange={(value) => patch({ brightness: value })} />
                    <NumericField label="Contrast" value={design.contrast} min={0.45} max={1.8} onChange={(value) => patch({ contrast: value })} />
                    <NumericField label="Saturation" value={design.saturation} min={0} max={2.4} onChange={(value) => patch({ saturation: value })} />
                    <NumericField label="Highlights" value={design.highlights} min={-1} max={1} onChange={(value) => patch({ highlights: value })} />
                    <NumericField label="Shadows" value={design.shadows} min={-1} max={1} onChange={(value) => patch({ shadows: value })} />
                    <NumericField label="Temperature" value={design.temperature} min={-1} max={1} onChange={(value) => patch({ temperature: value })} />
                    <NumericField label="Tint" value={design.tint} min={-1} max={1} onChange={(value) => patch({ tint: value })} />
                    <NumericField label="Sharpness" value={design.sharpness} min={-1} max={1} onChange={(value) => patch({ sharpness: value })} />
                    <NumericField label="Blur" value={design.blur} min={0} max={1} onChange={(value) => patch({ blur: value })} />
                    <NumericField label="Vignette" value={design.vignette} min={0} max={0.8} onChange={(value) => patch({ vignette: value })} />
                    <NumericField label="Grain" value={design.grain} min={0} max={0.22} onChange={(value) => patch({ grain: value })} />
                    <NumericField label="Gloss" value={design.gloss} min={0} max={0.8} onChange={(value) => patch({ gloss: value })} />
                    <NumericField label="Dark Overlay" value={design.overlay} min={0} max={0.75} onChange={(value) => patch({ overlay: value })} />
                    <NumericField label="Fade" value={design.fade} min={0} max={1} onChange={(value) => patch({ fade: value })} />
                    <NumericField label="Effect Tint Strength" value={design.effectTintStrength} min={0} max={1} onChange={(value) => patch({ effectTintStrength: value })} />
                    <NumericField label="Chip Scale" value={design.chipScale} min={0.5} max={2} onChange={(value) => patch({ chipScale: value })} />
                    <NumericField label="Chip X" value={design.chipX} min={0} max={0.82} onChange={(value) => patch({ chipX: value })} />
                    <NumericField label="Chip Y" value={design.chipY} min={0} max={0.8} onChange={(value) => patch({ chipY: value })} />
                    <NumericField label="Chip Rotation" value={design.chipRotation} min={-45} max={45} step={0.1} onChange={(value) => patch({ chipRotation: value })} suffix="°" />
                    <NumericField label="Contactless Scale" value={design.contactlessScale} min={0.4} max={2.2} onChange={(value) => patch({ contactlessScale: value })} />
                    <NumericField label="Contactless X" value={design.contactlessX} min={0.03} max={0.97} onChange={(value) => patch({ contactlessX: value })} />
                    <NumericField label="Contactless Y" value={design.contactlessY} min={0.03} max={0.97} onChange={(value) => patch({ contactlessY: value })} />
                    <NumericField label="Contactless Rotation" value={design.contactlessRotation || 0} min={-180} max={180} step={0.1} onChange={(value) => patch({ contactlessRotation: value })} suffix="°" />
                  </Group>
                {selectedLayer ? <Group title="Selected Layer Precision">
                  <NumericField label="Exact Layer X" value={selectedLayer.x??0.5} min={0} max={1} onChange={(value)=>updateLayer(selectedLayer.id,{x:value})}/>
                  <NumericField label="Exact Layer Y" value={selectedLayer.y??0.5} min={0} max={1} onChange={(value)=>updateLayer(selectedLayer.id,{y:value})}/>
                  <NumericField label="Exact Layer Scale" value={selectedLayer.scale??1} min={0.1} max={6} onChange={(value)=>updateLayer(selectedLayer.id,{scale:value})}/>
                  <NumericField label="Exact Layer Rotation" value={selectedLayer.rotation??0} min={-180} max={180} step={0.1} suffix="°" onChange={(value)=>updateLayer(selectedLayer.id,{rotation:value})}/>
                  <NumericField label="Exact Layer Opacity" value={selectedLayer.opacity??1} min={0} max={1} onChange={(value)=>updateLayer(selectedLayer.id,{opacity:value})}/>
                  {selectedLayer.type==='text'?<><NumericField label="Exact Font Size" value={selectedLayer.fontSize??58} min={10} max={240} onChange={(value)=>updateLayer(selectedLayer.id,{fontSize:value})}/><NumericField label="Exact Font Weight" value={selectedLayer.weight??700} min={100} max={900} step={100} onChange={(value)=>updateLayer(selectedLayer.id,{weight:value})}/><NumericField label="Exact Letter Spacing" value={selectedLayer.letterSpacing??0} min={-4} max={30} onChange={(value)=>updateLayer(selectedLayer.id,{letterSpacing:value})}/><NumericField label="Exact Line Height" value={selectedLayer.lineHeight??1.18} min={0.8} max={2} onChange={(value)=>updateLayer(selectedLayer.id,{lineHeight:value})}/></>:null}
                  {selectedLayer.type==='shape'?<><NumericField label="Exact Shape Width" value={selectedLayer.width??280} min={20} max={1200} onChange={(value)=>updateLayer(selectedLayer.id,{width:value})}/><NumericField label="Exact Shape Height" value={selectedLayer.height??120} min={20} max={800} onChange={(value)=>updateLayer(selectedLayer.id,{height:value})}/>{selectedLayer.shape!=='ellipse'?<NumericField label="Exact Corner Radius" value={selectedLayer.radius??28} min={0} max={Math.max(0,Math.floor(Math.min(Number(selectedLayer.width??280),Number(selectedLayer.height??120))/2))} onChange={(value)=>updateLayer(selectedLayer.id,{radius:value})}/>:null}</>:null}
                  {selectedLayer.type==='image'?<NumericField label="Exact Image Width" value={selectedLayer.width??640} min={20} max={1800} onChange={(value)=>updateLayer(selectedLayer.id,{width:value})}/>:null}
                </Group> : null}
              </section>
            ) : null}

            {studioTool === 'text' ? (
              <section className="studioContextCard capcutContextPanel">
                <div className="contextPanelHeader">{studioSubtool ? <button type="button" className="contextBack" onClick={()=>setStudioSubtool('')}>‹</button> : <span/>}<strong>{studioSubtool ? ({font:'Font',style:'Style',color:'Color',shadow:'Shadow',spacing:'Spacing',align:'Align',layer:'Layer'}[studioSubtool] || 'Text') : 'Text'}</strong><button type="button" onClick={()=>{setStudioSubtool('');setStudioTool('crop')}}>✓</button></div>
                {selectedLayer?.type === 'text' ? <>
                  {!studioSubtool ? <><textarea className="capcutTextInput iosTextArea" rows={3} disabled={Boolean(selectedLayer.locked)} value={selectedLayer.text||''} aria-label="Layer text" onChange={(e)=>updateLayer(selectedLayer.id,{text:splitGraphemes(e.target.value).slice(0,500).join('')})}/><div className="capcutSubtools">
                    {['font','style','color','shadow','spacing','align','layer'].map((key)=><button type="button" key={key} onClick={()=>setStudioSubtool(key)}><span className={key==='color'?'textColorToolIcon':''} style={key==='color'?{'--selected-text-color':selectedLayer.color||'#ffffff'}:undefined}>{{font:'Aa',style:'B',color:'',shadow:'◔',spacing:'≡',align:'☰',layer:'≡'}[key]}</span><small>{key[0].toUpperCase()+key.slice(1)}</small></button>)}
                  </div></> : null}
                  <fieldset disabled={Boolean(selectedLayer.locked)} style={{border:0,padding:0,margin:0,minWidth:0}}>
                  {studioSubtool==='font'?<><div className="segmentedControl capcutSegmented">{[['system','System'],['rounded','Rounded'],['serif','Serif'],['mono','Mono']].map(([v,l])=><button type="button" key={v} className={selectedLayer.fontFamily===v?'selected':''} onClick={()=>updateLayer(selectedLayer.id,{fontFamily:v})}>{l}</button>)}</div><SliderRow label="Size" value={selectedLayer.fontSize||58} min={10} max={240} step={1} onChange={(v)=>updateLayer(selectedLayer.id,{fontSize:v})}/></>:null}
                  {studioSubtool==='style'?<><div className="capcutSubtools"><button type="button" className={Number(selectedLayer.weight||700)>=700?'active':''} onClick={()=>updateLayer(selectedLayer.id,{weight:Number(selectedLayer.weight||700)>=700?400:800})}><span>B</span><small>Bold</small></button></div><SliderRow label="Weight" value={selectedLayer.weight||700} min={100} max={900} step={100} onChange={(v)=>updateLayer(selectedLayer.id,{weight:v})}/></>:null}
                  {studioSubtool==='color'?<><div className="backgroundSwatches">{['#ffffff','#000000','#ff375f','#ff9f0a','#ffd60a','#30d158','#64d2ff','#0a84ff','#5e5ce6','#bf5af2'].map((v)=><button type="button" key={v} aria-label={'Text color '+v} style={{background:v}} onClick={()=>updateLayer(selectedLayer.id,{color:v})}/>)}</div><label className="capcutColorPicker"><input aria-label="Custom text color" type="color" value={selectedLayer.color||'#ffffff'} onChange={(e)=>updateLayer(selectedLayer.id,{color:e.target.value})}/><span>Custom · {selectedLayer.color||'#ffffff'}</span></label></>:null}
                  {studioSubtool==='shadow'?<SwitchRow label="Shadow" value={Boolean(selectedLayer.shadow)} onChange={(v)=>updateLayer(selectedLayer.id,{shadow:v})}/>:null}
                  {studioSubtool==='spacing'?<><SliderRow label="Letter Spacing" value={selectedLayer.letterSpacing||0} min={-4} max={30} step={0.1} onChange={(v)=>updateLayer(selectedLayer.id,{letterSpacing:v})}/><SliderRow label="Line Height" value={selectedLayer.lineHeight||1.18} min={0.7} max={2.4} step={0.01} onChange={(v)=>updateLayer(selectedLayer.id,{lineHeight:v})}/></>:null}
                  {studioSubtool==='align'?<div className="segmentedControl capcutSegmented">{['left','center','right'].map(v=><button type="button" key={v} className={selectedLayer.align===v?'selected':''} onClick={()=>updateLayer(selectedLayer.id,{align:v})}>{v}</button>)}</div>:null}
                  </fieldset>
                  {studioSubtool==='layer'?<><SliderRow label="Opacity" value={selectedLayer.opacity??1} min={0} max={1} step={0.01} disabled={Boolean(selectedLayer.locked)} onChange={(v)=>updateLayer(selectedLayer.id,{opacity:v})}/><SwitchRow label="Show Layer" value={!selectedLayer.hidden} onChange={(v)=>updateLayer(selectedLayer.id,{hidden:!v})}/><SwitchRow label="Lock Layer" value={Boolean(selectedLayer.locked)} onChange={(v)=>updateLayer(selectedLayer.id,{locked:v})}/><div className="layerActionGrid"><button type="button" onClick={()=>duplicateLayer(selectedLayer.id)}>Duplicate</button><button type="button" disabled={Boolean(selectedLayer.locked)} onClick={()=>deleteLayer(selectedLayer.id)}>Delete</button></div></>:null}
                </> : <button type="button" className="capcutPrimaryTile" onClick={addTextLayer}>+ Add Text</button>}
              </section>
            ) : null}

            {studioTool === 'add' ? (
              <section className="studioContextCard capcutContextPanel">
                <div className="contextPanelHeader"><strong>Add</strong><button type="button" onClick={() => setStudioTool('crop')}>✓</button></div>
                <div className="capcutSubtools">
                  <button type="button" onClick={addTextLayer}><span>T</span><small>Text</small></button>
                  <button type="button" disabled={imageImportInProgress || presetTransferInProgress || cleanupInProgress} onClick={() => layerUploadRef.current?.click()}><IOSIcon name="photo" size={22}/><small>Image / Logo</small></button>
                  <button type="button" onClick={addShapeLayer}><IOSIcon name="shape" size={22}/><small>Shape</small></button>
                  <button type="button" onClick={addChipLayer}><IOSIcon name="chip" size={22}/><small>Chip Layer</small></button>
                </div>
              </section>
            ) : null}

            {studioTool === 'layers' ? (
              <section className="studioContextCard capcutContextPanel">
                <div className="contextPanelHeader"><strong>Layers</strong><button type="button" onClick={() => setStudioTool('crop')}>✓</button></div>
                <div className="capcutLayerList">
                  <button type="button" className={selectedElement === 'artwork' ? 'selected' : ''} onClick={() => { setSelectedElement('artwork'); setStudioTool('crop'); setStudioSubtool(''); }}><span>◉</span><strong>Artwork</strong><span>≡</span></button>
                  {visualLayerStack.map((entry) => (
                    <div className={'capcutLayerRow ' + (selectedElement === entry.selection ? 'selected' : '')} key={entry.id}>
                      <button type="button" className="layerVisibilityButton" aria-label={(entry.hidden ? 'Show ' : 'Hide ') + entry.name} onClick={() => toggleVisualLayerVisibility(entry)}>
                        <span>{entry.hidden ? '○' : '◉'}</span>
                      </button>
                      <button type="button" className="layerSelectButton" onClick={() => {
                        setSelectedElement(entry.selection);
                        if (entry.selection === 'visa' || entry.selection === 'chip' || entry.selection === 'contactless') { setStudioTool('card'); setStudioSubtool(entry.selection); }
                        else if (entry.selection === 'card-text') { setStudioTool('card'); setStudioSubtool('number'); }
                        else if (entry.type === 'text') { setStudioTool('text'); setStudioSubtool(''); }
                        else if (!entry.builtin) { setStudioTool('crop'); setStudioSubtool('transform'); }
                      }}><strong>{entry.name}</strong></button>
                      <span className="layerReorderButtons"><button type="button" aria-label={'Move '+entry.name+' up'} onClick={()=>moveLayer(entry.id,1)}>↑</button><button type="button" aria-label={'Move '+entry.name+' down'} onClick={()=>moveLayer(entry.id,-1)}>↓</button></span>
                    </div>
                  ))}
                  <div className="capcutLayerRow">
                    <span className="layerVisibilityButton">◉</span>
                    <button type="button" className="layerSelectButton" onClick={() => { setSelectedElement('artwork'); setStudioTool('background'); setStudioSubtool(''); }}><strong>Background</strong></button>
                    <span className="layerBuiltinMark">≡</span>
                  </div>
                </div>
              </section>
            ) : null}

            {studioTool === 'background' ? (
              <section className="studioContextCard capcutContextPanel">
                <div className="contextPanelHeader">{studioSubtool ? <button type="button" className="contextBack" onClick={()=>setStudioSubtool('')}>‹</button>:<span/>}<strong>{studioSubtool ? studioSubtool[0].toUpperCase()+studioSubtool.slice(1) : 'Background'}</strong><button type="button" onClick={()=>{setStudioSubtool('');setStudioTool('crop')}}>✓</button></div>
                {!studioSubtool ? <div className="capcutSubtools">
                  <button type="button" onClick={()=>setStudioSubtool('color')}><IOSIcon name="color" size={22}/><small>Color</small></button>
                  <button type="button" onClick={()=>setStudioSubtool('gradient')}><IOSIcon name="gradient" size={22}/><small>Gradient</small></button>
                  <button type="button" onClick={()=>setStudioSubtool('image')}><IOSIcon name="photo" size={22}/><small>Image</small></button>
                  <button type="button" onClick={()=>setStudioSubtool('blur')}><IOSIcon name="blur" size={22}/><small>Blur</small></button>
                </div>:null}
                {studioSubtool==='color'?<><div className="backgroundSwatches">{['#000000','#ffffff','#1c1c1e','#3a3a3c','#ff375f','#ff9f0a','#ffd60a','#30d158','#64d2ff','#0a84ff','#5e5ce6','#bf5af2'].map(v=><button type="button" key={v} aria-label={'Background '+v} style={{background:v}} onClick={()=>patch({background:'',backgroundColor:v,gradient:''})}/>)}</div><label className="capcutColorPicker"><input aria-label="Custom background color" type="color" value={design.backgroundColor||'#000000'} onChange={(e)=>patch({background:'',backgroundColor:e.target.value,gradient:''})}/><span>Custom · {design.backgroundColor||'#000000'}</span></label></>:null}
                {studioSubtool==='gradient'?<div className="presetScroller capcutPresetStrip">{GRADIENTS.map(g=><button type="button" key={g.id} onClick={()=>patch({background:'',backgroundColor:'',gradient:g.id})}>{g.name||g.id}</button>)}</div>:null}
                {studioSubtool==='image'?<><div className="backgroundImportActions"><button type="button" className="capcutPrimaryTile" disabled={imageImportInProgress || presetTransferInProgress || cleanupInProgress} onClick={()=>{uploadIntentRef.current='replace-artwork';uploadRef.current?.click()}}><IOSIcon name="photo" size={20}/> Replace Artwork</button><button type="button" className="capcutPrimaryTile" disabled={imageImportInProgress||presetTransferInProgress||cleanupInProgress} onClick={()=>layerUploadRef.current?.click()}><IOSIcon name="photo" size={20}/> Add Image / Logo</button></div>{imports.length ? <div className="studioImportedArtwork"><strong>My Imports</strong>{imports.slice(0,12).map(asset=><button type="button" key={asset.id} disabled={imageImportInProgress || presetTransferInProgress || cleanupInProgress} onClick={()=>replaceWithImportedArtwork(asset)}><IOSIcon name="photo" size={18}/><span>{asset.name}</span></button>)}</div> : null}<div className="backgroundRecentRail">{recent.slice(0,8).map((item,i)=><button type="button" key={item.id||item.image||i} onClick={()=>item.image&&replaceWithRecentArtwork(item)}>{item.image?<img src={item.image} alt=""/>:<span>Image</span>}</button>)}</div></>:null}
                {studioSubtool==='blur'?<SliderRow label="Blur" value={design.blur} min={0} max={1} step={0.01} onChange={(v)=>patch({blur:v})}/>:null}
              </section>
            ) : null}

            {studioTool === 'crop' && studioSubtool === 'crop' ? (
              <section className="studioContextCard capcutContextPanel">
                <div className="contextPanelHeader"><button type="button" className="contextBack" onClick={() => setStudioSubtool('')}>‹</button><strong>Crop</strong><button type="button" onClick={() => setStudioSubtool('')}>✓</button></div>
              <Group title="Crop">
                <div className="editingTargetBar">
                  <span>
                    <strong>Editing {activeImageLabel}</strong>
                    <small>{selectedImageLayer ? 'Imported image layer' : 'Card artwork'}</small>
                  </span>
                  {selectedImageLayer ? (
                    <button type="button" onClick={() => setSelectedElement('artwork')}>Back to Artwork</button>
                  ) : null}
                </div>

                {selectedImageLayer ? (
                  <>
                    <div className="cropControlBlock">
                      <SliderRow
                        label="Layer Crop Left"
                        disabled={!activeImageEditable}
                        value={selectedImageLayer.crop?.x || 0}
                        min={0}
                        max={0.9}
                        step={0.005}
                        formatValue={(value) => Math.round(value * 100) + '%'}
                        onChange={(value) => updateLayerCropEdge(selectedImageLayer.id, 'left', value)}
                      />
                      <SliderRow
                        label="Layer Crop Right"
                        disabled={!activeImageEditable}
                        value={selectedImageLayer.crop ? Math.max(0, 1 - selectedImageLayer.crop.x - selectedImageLayer.crop.w) : 0}
                        min={0}
                        max={0.9}
                        step={0.005}
                        formatValue={(value) => Math.round(value * 100) + '%'}
                        onChange={(value) => updateLayerCropEdge(selectedImageLayer.id, 'right', value)}
                      />
                      <SliderRow
                        label="Layer Crop Top"
                        disabled={!activeImageEditable}
                        value={selectedImageLayer.crop?.y || 0}
                        min={0}
                        max={0.9}
                        step={0.005}
                        formatValue={(value) => Math.round(value * 100) + '%'}
                        onChange={(value) => updateLayerCropEdge(selectedImageLayer.id, 'top', value)}
                      />
                      <SliderRow
                        label="Layer Crop Bottom"
                        disabled={!activeImageEditable}
                        value={selectedImageLayer.crop ? Math.max(0, 1 - selectedImageLayer.crop.y - selectedImageLayer.crop.h) : 0}
                        min={0}
                        max={0.9}
                        step={0.005}
                        formatValue={(value) => Math.round(value * 100) + '%'}
                        onChange={(value) => updateLayerCropEdge(selectedImageLayer.id, 'bottom', value)}
                      />
                    </div>
                    <button
                      type="button"
                      className="settingsResetButton"
                      disabled={!activeImageEditable}
                      onClick={() => updateLayer(selectedImageLayer.id, { crop: selectedImageLayer.originalCrop || null })}
                    >
                      Reset Layer Crop
                    </button>
                  </>
                ) : (
                  <>
                    <div className="groupRow segmentedRow">
                      <div className="segmentedControl compact" role="group" aria-label="Artwork fit">
                        <button type="button" disabled={!design.background} aria-pressed={design.fit === 'cover'} className={design.fit === 'cover' ? 'selected' : ''} onClick={() => patch({ fit: 'cover' })}>Fill</button>
                        <button type="button" disabled={!design.background} aria-pressed={design.fit === 'contain'} className={design.fit === 'contain' ? 'selected' : ''} onClick={() => patch({ fit: 'contain' })}>Fit</button>
                      </div>
                      <button type="button" className="iconTextButton" disabled={!design.background} aria-pressed={Boolean(design.flipX)} onClick={() => patch({ flipX: !design.flipX })}>
                        <span>{design.flipX ? 'Unflip' : 'Flip'}</span>
                      </button>
                    </div>
                    <button
                      type="button"
                      className="actionRow"
                      disabled={imageImportInProgress || presetTransferInProgress || cleanupInProgress}
                      onClick={() => {
                        uploadIntentRef.current = 'replace-artwork';
                        uploadRef.current?.click();
                      }}
                    >
                      <span><strong>Replace Artwork</strong><small>Photos or Files</small></span>
                      <IOSIcon name="photo" size={19} />
                    </button>
                    <input ref={uploadRef} type="file" accept="image/*" hidden onChange={uploadImage} />
                    <div className="cropControlBlock">
                      <SliderRow label="Crop Left" value={design.sourceCrop?.x || 0} min={0} max={0.9} step={0.005} disabled={!activeImageEditable} formatValue={(value) => Math.round(value * 100) + '%'} onChange={(value) => updateCropEdge('left', value)} />
                      <SliderRow label="Crop Right" value={design.sourceCrop ? Math.max(0, 1 - design.sourceCrop.x - design.sourceCrop.w) : 0} min={0} max={0.9} step={0.005} disabled={!activeImageEditable} formatValue={(value) => Math.round(value * 100) + '%'} onChange={(value) => updateCropEdge('right', value)} />
                      <SliderRow label="Crop Top" value={design.sourceCrop?.y || 0} min={0} max={0.9} step={0.005} disabled={!activeImageEditable} formatValue={(value) => Math.round(value * 100) + '%'} onChange={(value) => updateCropEdge('top', value)} />
                      <SliderRow label="Crop Bottom" value={design.sourceCrop ? Math.max(0, 1 - design.sourceCrop.y - design.sourceCrop.h) : 0} min={0} max={0.9} step={0.005} disabled={!activeImageEditable} formatValue={(value) => Math.round(value * 100) + '%'} onChange={(value) => updateCropEdge('bottom', value)} />
                    </div>
                    <button
                      type="button"
                      className="settingsResetButton"
                      disabled={!activeImageEditable}
                      onClick={() => patch({
                        sourceCrop: design.originalSourceCrop || null
                      })}
                    >
                      Reset Crop
                    </button>
                  </>
                )}
              </Group>
              </section>
            ) : null}

            {studioTool === 'position' ? (
              <>
                <Group title="Transform" footer="Tap an object on the card to select it. Drag to move. Two fingers scale and rotate.">
                  <div className="editingTargetBar">
                    <span>
                      <strong>{selectedLayer ? (selectedLayer.name || selectedLayer.type) : selectedElement === 'chip' ? 'EMV Chip' : selectedElement === 'contactless' ? 'Contactless' : 'Artwork'}</strong>
                      <small>Current transform target</small>
                    </span>
                    {selectedElement !== 'artwork' ? (
                      <button type="button" onClick={() => setSelectedElement('artwork')}>Back to Artwork</button>
                    ) : null}
                  </div>

                  {selectedElement === 'artwork' ? (
                    <>
                      <div className="groupRow segmentedRow">
                        <div className="segmentedControl compact" role="group" aria-label="Artwork fit in Position">
                          <button type="button" disabled={!design.background} aria-pressed={design.fit === 'cover'} className={design.fit === 'cover' ? 'selected' : ''} onClick={() => patch({ fit: 'cover' })}>Fill</button>
                          <button type="button" disabled={!design.background} aria-pressed={design.fit === 'contain'} className={design.fit === 'contain' ? 'selected' : ''} onClick={() => patch({ fit: 'contain' })}>Fit</button>
                        </div>
                        <button type="button" className="iconTextButton" disabled={!design.background} aria-pressed={Boolean(design.flipX)} onClick={() => patch({ flipX: !design.flipX })}>
                          <span>{design.flipX ? 'Unflip' : 'Flip Horizontal'}</span>
                        </button>
                      </div>
                      <SliderRow label="Artwork zoom" value={design.zoom} min={0.5} max={5} step={0.01} disabled={!design.background} formatValue={(value) => Math.round(value * 100) + '%'} onChange={(value) => patch({ zoom: value })} />
                      <SliderRow label="Artwork horizontal position" value={design.x} min={-1.5} max={1.5} step={0.01} disabled={!design.background} formatValue={(value) => Math.round(value * 100) + '%'} onChange={(value) => patch({ x: value })} />
                      <SliderRow label="Artwork vertical position" value={design.y} min={-1.5} max={1.5} step={0.01} disabled={!design.background} formatValue={(value) => Math.round(value * 100) + '%'} onChange={(value) => patch({ y: value })} />
                      <SliderRow label="Artwork rotation" value={design.rotate} min={-180} max={180} step={1} suffix="°" disabled={!design.background} onChange={(value) => patch({ rotate: value })} />
                      <button type="button" className="settingsResetButton" disabled={!design.background} onClick={() => patch({ fit: 'cover', zoom: 1, x: 0, y: 0, rotate: 0, flipX: false })}>Reset Position</button>
                    </>
                  ) : null}

                  {selectedElement === 'chip' && design.chip ? (
                    <>
                      <SliderRow label="Chip size" value={design.chipScale} min={0.5} max={2} step={0.01} onChange={(value) => patch({ chipScale: value })} />
                      <SliderRow label="Chip horizontal position" value={design.chipX} min={0} max={0.82} step={0.005} formatValue={(value) => Math.round(value * 100) + '%'} onChange={(value) => patch({ chipX: value })} />
                      <SliderRow label="Chip vertical position" value={design.chipY} min={0} max={0.8} step={0.005} formatValue={(value) => Math.round(value * 100) + '%'} onChange={(value) => patch({ chipY: value })} />
                      <SliderRow label="Chip rotation" value={design.chipRotation} min={-45} max={45} step={1} suffix="°" onChange={(value) => patch({ chipRotation: value })} />
                    </>
                  ) : null}

                  {selectedElement === 'contactless' && design.contactless ? (
                    <>
                      <SliderRow label="Contactless size" value={design.contactlessScale} min={0.4} max={2.2} step={0.01} onChange={(value) => patch({ contactlessScale: value })} />
                      <SliderRow label="Contactless horizontal position" value={design.contactlessX} min={0.03} max={0.97} step={0.005} formatValue={(value) => Math.round(value * 100) + '%'} onChange={(value) => patch({ contactlessX: value })} />
                      <SliderRow label="Contactless vertical position" value={design.contactlessY} min={0.03} max={0.97} step={0.005} formatValue={(value) => Math.round(value * 100) + '%'} onChange={(value) => patch({ contactlessY: value })} />
                      <SliderRow label="Contactless rotation" value={design.contactlessRotation || 0} min={-180} max={180} step={1} suffix="°" onChange={(value) => patch({ contactlessRotation: value })} />
                    </>
                  ) : null}

                  {selectedLayer ? (
                    <>
                      {selectedLayer.type === 'image' ? (
                        <>
                          <div className="groupRow">
                            <button type="button" className="iconTextButton" disabled={Boolean(selectedLayer.locked)} aria-pressed={Boolean(selectedLayer.flipX)} onClick={() => updateLayer(selectedLayer.id, { flipX: !selectedLayer.flipX })}>
                              <span>{selectedLayer.flipX ? 'Unflip Image' : 'Flip Image Horizontally'}</span>
                            </button>
                          </div>
                          <SliderRow label="Image Width" value={selectedLayer.width ?? 640} min={20} max={1800} step={1} disabled={Boolean(selectedLayer.locked)} onChange={(value) => updateLayer(selectedLayer.id, { width: value })} />
                        </>
                      ) : null}
                      <SliderRow label="Layer horizontal position" value={selectedLayer.x ?? 0.5} min={0} max={1} step={0.005} disabled={Boolean(selectedLayer.locked)} formatValue={(value) => Math.round(value * 100) + '%'} onChange={(value) => updateLayer(selectedLayer.id, { x: value })} />
                      <SliderRow label="Layer vertical position" value={selectedLayer.y ?? 0.5} min={0} max={1} step={0.005} disabled={Boolean(selectedLayer.locked)} formatValue={(value) => Math.round(value * 100) + '%'} onChange={(value) => updateLayer(selectedLayer.id, { y: value })} />
                      <SliderRow label="Layer scale" value={selectedLayer.scale ?? 1} min={0.1} max={6} step={0.01} disabled={Boolean(selectedLayer.locked)} formatValue={(value) => Math.round(value * 100) + '%'} onChange={(value) => updateLayer(selectedLayer.id, { scale: value })} />
                      <SliderRow label="Layer rotation" value={selectedLayer.rotation ?? 0} min={-180} max={180} step={1} suffix="°" disabled={Boolean(selectedLayer.locked)} onChange={(value) => updateLayer(selectedLayer.id, { rotation: value })} />
                      <button type="button" className="settingsResetButton" disabled={Boolean(selectedLayer.locked)} onClick={() => updateLayer(selectedLayer.id, { x: 0.5, y: 0.5, scale: 1, rotation: 0, flipX: false })}>Reset Layer Position</button>
                    </>
                  ) : null}

                  <SwitchRow label="Alignment Guides" detail="Bleed, rounded crop boundary, safe text, snap lines, chip/contactless zones" value={guidesEnabled} onChange={setGuidesEnabled} />
                </Group>

                {expertMode ? (
                  <Group title="Precision" footer="Exact numerical access to every global transform, adjustment, effect, and card-hardware parameter.">
                    <NumericField label="Zoom" value={design.zoom} min={0.5} max={5} onChange={(value) => patch({ zoom: value })} />
                    <NumericField label="Artwork X" value={design.x} min={-1.5} max={1.5} onChange={(value) => patch({ x: value })} />
                    <NumericField label="Artwork Y" value={design.y} min={-1.5} max={1.5} onChange={(value) => patch({ y: value })} />
                    <NumericField label="Artwork Rotation" value={design.rotate} min={-180} max={180} step={0.1} onChange={(value) => patch({ rotate: value })} suffix="°" />
                    <NumericField label="Crop Left" value={design.sourceCrop?.x || 0} min={0} max={0.9} onChange={(value) => updateCropEdge('left', value)} />
                    <NumericField label="Crop Right" value={design.sourceCrop ? Math.max(0, 1 - design.sourceCrop.x - design.sourceCrop.w) : 0} min={0} max={0.9} onChange={(value) => updateCropEdge('right', value)} />
                    <NumericField label="Crop Top" value={design.sourceCrop?.y || 0} min={0} max={0.9} onChange={(value) => updateCropEdge('top', value)} />
                    <NumericField label="Crop Bottom" value={design.sourceCrop ? Math.max(0, 1 - design.sourceCrop.y - design.sourceCrop.h) : 0} min={0} max={0.9} onChange={(value) => updateCropEdge('bottom', value)} />
                    <NumericField label="Exposure" value={design.exposure} min={-1} max={1} onChange={(value) => patch({ exposure: value })} />
                    <NumericField label="Brightness" value={design.brightness} min={0.4} max={1.7} onChange={(value) => patch({ brightness: value })} />
                    <NumericField label="Contrast" value={design.contrast} min={0.45} max={1.8} onChange={(value) => patch({ contrast: value })} />
                    <NumericField label="Saturation" value={design.saturation} min={0} max={2.4} onChange={(value) => patch({ saturation: value })} />
                    <NumericField label="Highlights" value={design.highlights} min={-1} max={1} onChange={(value) => patch({ highlights: value })} />
                    <NumericField label="Shadows" value={design.shadows} min={-1} max={1} onChange={(value) => patch({ shadows: value })} />
                    <NumericField label="Temperature" value={design.temperature} min={-1} max={1} onChange={(value) => patch({ temperature: value })} />
                    <NumericField label="Tint" value={design.tint} min={-1} max={1} onChange={(value) => patch({ tint: value })} />
                    <NumericField label="Sharpness" value={design.sharpness} min={-1} max={1} onChange={(value) => patch({ sharpness: value })} />
                    <NumericField label="Blur" value={design.blur} min={0} max={1} onChange={(value) => patch({ blur: value })} />
                    <NumericField label="Vignette" value={design.vignette} min={0} max={0.8} onChange={(value) => patch({ vignette: value })} />
                    <NumericField label="Grain" value={design.grain} min={0} max={0.22} onChange={(value) => patch({ grain: value })} />
                    <NumericField label="Gloss" value={design.gloss} min={0} max={0.8} onChange={(value) => patch({ gloss: value })} />
                    <NumericField label="Dark Overlay" value={design.overlay} min={0} max={0.75} onChange={(value) => patch({ overlay: value })} />
                    <NumericField label="Fade" value={design.fade} min={0} max={1} onChange={(value) => patch({ fade: value })} />
                    <NumericField label="Effect Tint Strength" value={design.effectTintStrength} min={0} max={1} onChange={(value) => patch({ effectTintStrength: value })} />
                    <NumericField label="Chip Scale" value={design.chipScale} min={0.5} max={2} onChange={(value) => patch({ chipScale: value })} />
                    <NumericField label="Chip X" value={design.chipX} min={0} max={0.82} onChange={(value) => patch({ chipX: value })} />
                    <NumericField label="Chip Y" value={design.chipY} min={0} max={0.8} onChange={(value) => patch({ chipY: value })} />
                    <NumericField label="Chip Rotation" value={design.chipRotation} min={-45} max={45} step={0.1} onChange={(value) => patch({ chipRotation: value })} suffix="°" />
                    <NumericField label="Contactless Scale" value={design.contactlessScale} min={0.4} max={2.2} onChange={(value) => patch({ contactlessScale: value })} />
                    <NumericField label="Contactless X" value={design.contactlessX} min={0.03} max={0.97} onChange={(value) => patch({ contactlessX: value })} />
                    <NumericField label="Contactless Y" value={design.contactlessY} min={0.03} max={0.97} onChange={(value) => patch({ contactlessY: value })} />
                    <NumericField label="Contactless Rotation" value={design.contactlessRotation || 0} min={-180} max={180} step={0.1} onChange={(value) => patch({ contactlessRotation: value })} suffix="°" />
                  </Group>
                ) : null}
              </>
            ) : null}

            {studioTool === 'adjust' ? (
              <section className="studioContextCard capcutContextPanel">
                <div className="contextPanelHeader">
                  {studioSubtool ? <button type="button" className="contextBack" onClick={() => setStudioSubtool('')}>‹</button> : <span/>}
                  <strong>Adjust</strong>
                  <button type="button" onClick={() => setStudioSubtool('')}>✓</button>
                </div>
                <div className="editingTargetBar"><span><strong>Editing {activeImageLabel}</strong><small>Adjustments affect this image only</small></span>{selectedImageLayer || (design.customLayers || []).some((layer) => layer.type === 'image' && !layer.hidden) ? <button type="button" onClick={() => setSelectedElement(selectedImageLayer ? 'artwork' : ((design.customLayers || []).find((layer) => layer.type === 'image' && !layer.hidden)?.id || 'artwork'))}>{selectedImageLayer ? 'Artwork' : 'Image Layer'}</button> : null}</div>
                <>
                    <div className="capcutSubtools">
                      {[
                        ['brightness','☀','Brightness'],['contrast','◐','Contrast'],['saturation','◉','Saturation'],
                        ['temperature','♨','Temperature'],['sharpness','△','Sharpness'],['exposure','◑','Exposure'],
                        ['highlights','◒','Highlights'],['shadows','◓','Shadows'],['tint','●','Tint'],['blur','✣','Blur']
                      ].map(([key,icon,label]) => <button type="button" className={studioSubtool===key?'active':''} key={key} onClick={() => setStudioSubtool(key)}>{['brightness','contrast','saturation','temperature','sharpness','blur'].includes(key) ? <IOSIcon name={key} size={22}/> : <span>{icon}</span>}<small>{label}</small></button>)}
                    </div>
                    {!studioSubtool ? <div className="presetScroller capcutPresetStrip">
                      {Object.keys(ADJUSTMENT_PRESETS).map((name) => <button type="button" key={name} disabled={!activeImageEditable} onClick={() => applyAdjustmentPreset(name)}>{name}</button>)}
                    </div> : null}
                  {studioSubtool ? <>
                    {studioSubtool === 'brightness' ? <SliderRow label="Brightness" value={activeImageSettings.brightness} min={0.4} max={1.7} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({brightness:value})}/> : null}
                    {studioSubtool === 'contrast' ? <SliderRow label="Contrast" value={activeImageSettings.contrast} min={0.45} max={1.8} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({contrast:value})}/> : null}
                    {studioSubtool === 'saturation' ? <SliderRow label="Saturation" value={activeImageSettings.saturation} min={0} max={2.4} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({saturation:value})}/> : null}
                    {studioSubtool === 'temperature' ? <SliderRow label="Temperature" value={activeImageSettings.temperature} min={-1} max={1} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({temperature:value})}/> : null}
                    {studioSubtool === 'sharpness' ? <SliderRow label="Sharpness" value={activeImageSettings.sharpness} min={-1} max={1} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({sharpness:value})}/> : null}
                    {studioSubtool === 'exposure' ? <SliderRow label="Exposure" value={activeImageSettings.exposure} min={-1} max={1} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({exposure:value})}/> : null}
                    {studioSubtool === 'highlights' ? <SliderRow label="Highlights" value={activeImageSettings.highlights} min={-1} max={1} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({highlights:value})}/> : null}
                    {studioSubtool === 'shadows' ? <SliderRow label="Shadows" value={activeImageSettings.shadows} min={-1} max={1} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({shadows:value})}/> : null}
                    {studioSubtool === 'tint' ? <SliderRow label="Tint" value={activeImageSettings.tint} min={-1} max={1} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({tint:value})}/> : null}
                    {studioSubtool === 'blur' ? <SliderRow label="Blur" value={activeImageSettings.blur} min={0} max={1} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({blur:value})}/> : null}
                    <button type="button" className="settingsResetButton" onClick={() => applyAdjustmentPreset('Original')}>Reset Adjustments</button>
                  </> : null}
                </>
              </section>
            ) : null}

            {studioTool === 'effects' ? (
              <section className="studioContextCard capcutContextPanel">
                <div className="contextPanelHeader">
                  {studioSubtool ? <button type="button" className="contextBack" onClick={() => setStudioSubtool('')}>‹</button> : <span/>}
                  <strong>Effects</strong>
                  <button type="button" onClick={() => setStudioSubtool('')}>✓</button>
                </div>
                <div className="editingTargetBar"><span><strong>Editing {activeImageLabel}</strong><small>Effects affect this image only</small></span>{selectedImageLayer || (design.customLayers || []).some((layer) => layer.type === 'image' && !layer.hidden) ? <button type="button" onClick={() => setSelectedElement(selectedImageLayer ? 'artwork' : ((design.customLayers || []).find((layer) => layer.type === 'image' && !layer.hidden)?.id || 'artwork'))}>{selectedImageLayer ? 'Artwork' : 'Image Layer'}</button> : null}</div>
                <div className="effectTileRail">
                    <button type="button" disabled={!activeImageEditable} onClick={() => patchImageTarget({vignette:0,grain:0,gloss:0,overlay:0,fade:0,effectTintStrength:0})}><i className="effectNone"/><small>None</small></button>
                    {[['gloss','Gloss'],['grain','Grain'],['vignette','Vignette'],['fade','Film'],['overlay','Dark'],['tintfx','Tint']].map(([key,label]) => <button type="button" key={key} className={studioSubtool===key?'active':''} onClick={() => setStudioSubtool(key)}><i className={'effectSwatch '+key}>{activeEffectThumbnail ? <img src={activeEffectThumbnail} alt=""/> : null}</i><small>{label}</small></button>)}
                </div>
                {studioSubtool ? <>
                    {studioSubtool === 'gloss' ? <SliderRow label="Gloss" value={activeImageSettings.gloss} min={0} max={0.8} step={0.01} disabled={!activeImageEditable} onChange={(value)=>patchImageTarget({gloss:value})}/> : null}
                    {studioSubtool === 'grain' ? <SliderRow label="Grain" value={activeImageSettings.grain} min={0} max={0.22} step={0.005} disabled={!activeImageEditable} onChange={(value)=>patchImageTarget({grain:value})}/> : null}
                    {studioSubtool === 'vignette' ? <SliderRow label="Vignette intensity" value={activeImageSettings.vignette} min={0} max={0.8} step={0.01} disabled={!activeImageEditable} onChange={(value)=>patchImageTarget({vignette:value})}/> : null}
                    {studioSubtool === 'fade' ? <SliderRow label="Fade" value={activeImageSettings.fade} min={0} max={1} step={0.01} disabled={!activeImageEditable} onChange={(value)=>patchImageTarget({fade:value})}/> : null}
                    {studioSubtool === 'overlay' ? <SliderRow label="Dark Overlay" value={activeImageSettings.overlay} min={0} max={0.75} step={0.01} disabled={!activeImageEditable} onChange={(value)=>patchImageTarget({overlay:value})}/> : null}
                    {studioSubtool === 'tintfx' ? <><label className="capcutColorPicker"><input aria-label="Effect tint color" type="color" disabled={!activeImageEditable} value={activeImageSettings.effectTint || '#7b61ff'} onChange={(event)=>patchImageTarget({effectTint:event.target.value})}/><span>Custom · {activeImageSettings.effectTint || '#7b61ff'}</span></label><div className="studioColorSwatches">{['#7b61ff','#ff2d55','#ff9500','#ffcc00','#34c759','#00c7be','#007aff','#ffffff','#000000'].map(v=><button type="button" key={v} disabled={!activeImageEditable} aria-label={'Effect tint '+v} style={{background:v}} onClick={()=>patchImageTarget({effectTint:v})}/>)}</div><SliderRow label="Tint Strength" value={activeImageSettings.effectTintStrength} min={0} max={1} step={0.01} disabled={!activeImageEditable} onChange={(value)=>patchImageTarget({effectTintStrength:value})}/></> : null}
                </> : null}
              </section>
            ) : null}

            {studioTool === 'card' ? (
              <section className="studioContextCard capcutContextPanel">
                <div className="contextPanelHeader">
                  {studioSubtool ? <button type="button" className="contextBack" onClick={() => setStudioSubtool('')}>‹</button> : <span/>}
                  <strong>{studioSubtool ? ({chip:'Chip',contactless:'Contactless',visa:'VISA',number:'Number',name:'Name',expiry:'Expiry',badge:'Badge',textstyle:'Text Style'}[studioSubtool] || 'Card') : 'Card'}</strong>
                  <button type="button" onClick={() => setStudioSubtool('')}>✓</button>
                </div>
                {!studioSubtool ? (
                  <>
                    <div className="capcutChipPresets" role="radiogroup" aria-label="Chip finish">
                      {['gold','silver','black','rose'].map(tone=><button type="button" role="radio" aria-label={tone+' chip'} aria-checked={design.chipTone===tone} className={design.chipTone===tone?'selected':''} key={tone} onClick={()=>patch({chip:true,chipTone:tone})}><i className={'chipTone '+tone}/></button>)}
                    </div>
                    <div className="capcutSubtools">
                      <button type="button" onClick={() => { setSelectedElement('chip'); setStudioSubtool('chip'); }}><IOSIcon name="chip" size={22}/><small>Chip</small></button>
                      <button type="button" onClick={() => { setSelectedElement('contactless'); setStudioSubtool('contactless'); }}><IOSIcon name="contactless" size={22}/><small>Contactless</small></button>
                      <button type="button" onClick={() => { setSelectedElement('visa'); setStudioSubtool('visa'); }}><span className="visaToolGlyph">VISA</span><small>VISA</small></button>
                      <button type="button" onClick={() => setStudioSubtool('number')}><span>123</span><small>Number</small></button>
                      <button type="button" onClick={() => setStudioSubtool('name')}><span>A</span><small>Name</small></button>
                      <button type="button" onClick={() => setStudioSubtool('expiry')}><span>▦</span><small>Expiry</small></button>
                      <button type="button" onClick={() => setStudioSubtool('badge')}><span>★</span><small>Badge</small></button>
                      <button type="button" onClick={() => setStudioSubtool('textstyle')}><span>Aa</span><small>Text Style</small></button>
                    </div>
                    <div className="presetScroller capcutPresetStrip">{Object.keys(CARD_PRESETS).map((name)=><button type="button" key={name} onClick={()=>applyCardPreset(name)}>{name}</button>)}</div>
                  </>
                ) : null}
                {studioSubtool === 'chip' ? (
                  <>
                    <SwitchRow label="EMV Chip" value={design.chip} onChange={(value)=>patch({chip:value})}/>
                    {design.chip ? <><div className="tonePicker">{['gold','silver','black','rose'].map((tone)=><button type="button" key={tone} className={design.chipTone===tone?'selected':''} onClick={()=>patch({chipTone:tone})}><i className={'chipTone '+tone}/><span>{tone[0].toUpperCase()+tone.slice(1)}</span></button>)}</div>
                    <SliderRow label="Chip Scale" value={design.chipScale} min={0.55} max={1.8} step={0.01} onChange={(value)=>patch({chipScale:value})}/>
                    <SliderRow label="Chip Horizontal Position" value={design.chipX} min={0} max={0.82} step={0.005} onChange={(value)=>patch({chipX:value})}/>
                    <SliderRow label="Chip Vertical Position" value={design.chipY} min={0} max={0.8} step={0.005} onChange={(value)=>patch({chipY:value})}/>
                    <SliderRow label="Chip Rotation" value={design.chipRotation} min={-180} max={180} step={1} suffix="°" onChange={(value)=>patch({chipRotation:value})}/></> : null}
                  </>
                ) : null}
                {studioSubtool === 'contactless' ? (
                  <>
                    <SwitchRow label="Contactless" value={design.contactless} onChange={(value)=>patch({contactless:value})}/>
                    <SwitchRow label="Lock Contactless Position" value={Boolean(design.contactlessLocked)} onChange={(value)=>patch({contactlessLocked:value})}/>
                    {design.contactless ? <>
                      <label className="capcutColorPicker"><input aria-label="Contactless color" type="color" value={design.contactlessColor||design.textColor} onChange={(event)=>patch({contactlessColor:event.target.value})}/><span>Color · {design.contactlessColor||design.textColor}</span></label>
                      <SliderRow label="Contactless Opacity" value={design.contactlessOpacity??0.9} min={0} max={1} step={0.01} onChange={(value)=>patch({contactlessOpacity:value})}/>
                      <SliderRow label="Contactless Scale" value={design.contactlessScale} min={0.4} max={2.2} step={0.01} disabled={design.contactlessLocked} onChange={(value)=>patch({contactlessScale:value})}/>
                      <SliderRow label="Contactless Horizontal Position" value={design.contactlessX} min={0.03} max={0.97} step={0.005} disabled={design.contactlessLocked} onChange={(value)=>patch({contactlessX:value})}/>
                      <SliderRow label="Contactless Vertical Position" value={design.contactlessY} min={0.03} max={0.97} step={0.005} disabled={design.contactlessLocked} onChange={(value)=>patch({contactlessY:value})}/>
                      <SliderRow label="Contactless Rotation" value={design.contactlessRotation} min={-180} max={180} step={1} suffix="°" disabled={design.contactlessLocked} onChange={(value)=>patch({contactlessRotation:value})}/>
                    </> : null}
                    {(design.customLayers||[]).filter((layer)=>layer.type==='contactless').map((layer)=><button type="button" className="settingsResetButton" key={layer.id} onClick={()=>mergeCustomContactlessLayer(layer.id)}>Merge extra Contactless into Card · Undo available</button>)}
                  </>
                ) : null}
                {studioSubtool === 'visa' ? (
                  <>
                    <SwitchRow label="VISA" value={design.visa} onChange={(value)=>patch({visa:value})}/>
                    {design.visa ? <><div className="tonePicker" role="radiogroup" aria-label="VISA finish">{['silver','white','black'].map((finish)=><button type="button" key={finish} role="radio" aria-checked={design.visaFinish===finish} className={design.visaFinish===finish?'selected':''} onClick={()=>patch({visaFinish:finish})}><span>{finish==='silver'?'White Gloss':finish[0].toUpperCase()+finish.slice(1)}</span></button>)}</div>
                    <SliderRow label="VISA Gloss" value={design.visaGloss} min={0} max={1} step={0.01} onChange={(value)=>patch({visaGloss:value})}/>
                    <SliderRow label="VISA Reflection" value={design.visaReflection} min={0} max={1} step={0.01} onChange={(value)=>patch({visaReflection:value})}/>
                    <SliderRow label="VISA Opacity" value={design.visaOpacity} min={0.1} max={1} step={0.01} onChange={(value)=>patch({visaOpacity:value})}/>
                    <SliderRow label="VISA Scale" value={design.visaScale} min={0.45} max={2.2} step={0.01} onChange={(value)=>patch({visaScale:value})}/>
                    <SliderRow label="VISA Rotation" value={design.visaRotation} min={-180} max={180} step={1} suffix="°" onChange={(value)=>patch({visaRotation:value})}/>
                    <button type="button" className="settingsResetButton" onClick={()=>patch({visaX:DEFAULTS.visaX,visaY:DEFAULTS.visaY,visaScale:DEFAULTS.visaScale,visaRotation:0,visaOpacity:1,visaFinish:'silver',visaGloss:DEFAULTS.visaGloss,visaReflection:DEFAULTS.visaReflection})}>Reset VISA</button></> : null}
                  </>
                ) : null}
                {studioSubtool === 'number' ? <><SwitchRow label="Masked Number" value={design.number} onChange={(value)=>patch({number:value})}/>{design.number?<input className="iosTextField capcutCardInput" aria-label="Masked card number" value={design.numberText} onChange={(e)=>patch({numberText:singleLineCardText(e.target.value,32)})}/>:null}</> : null}
                {studioSubtool === 'name' ? <><SwitchRow label="Card Holder" value={design.holder} onChange={(value)=>patch({holder:value})}/>{design.holder?<input className="iosTextField capcutCardInput" aria-label="Card holder" value={design.holderText} onChange={(e)=>patch({holderText:singleLineCardText(e.target.value,28)})}/>:null}</> : null}
                {studioSubtool === 'expiry' ? <><SwitchRow label="Expiry" value={design.expiry} onChange={(value)=>patch({expiry:value})}/>{design.expiry?<input className="iosTextField capcutCardInput" aria-label="Expiry date" value={design.expiryText} onChange={(e)=>patch({expiryText:singleLineCardText(e.target.value,8)})}/>:null}</> : null}
                {studioSubtool === 'badge' ? <><SwitchRow label="Top Badge" value={design.badge} onChange={(value)=>patch({badge:value})}/>{design.badge?<input className="iosTextField capcutCardInput" aria-label="Top badge text" value={design.badgeText} onChange={(e)=>patch({badgeText:singleLineCardText(e.target.value,18)})}/>:null}</> : null}
                {studioSubtool === 'textstyle' ? <><label className="colorRow"><span>Text Color</span><input aria-label="Text color" type="color" value={design.textColor} onChange={(e)=>patch({textColor:e.target.value})}/></label><SwitchRow label="Text Shadow" value={Boolean(design.shadow)} onChange={(value)=>patch({shadow:value})}/></> : null}
              </section>
            ) : null}
          </div>
        )}

        {tab === 'library' && (
          <div className="tabScreen libraryScreen" role="tabpanel" id="panel-library" aria-labelledby="tab-library">
            <section className="librarySummary">
              <div><strong>{favorites.length}</strong><span>Favorites</span></div>
              <div><strong>{projects.length}</strong><span>Projects</span></div>
              <div><strong>{imports.length}</strong><span>Imports</span></div>
            </section>

            <ArtworkRail
              title="Favorites"
              items={favorites}
              onPick={useArtwork}
              favoriteIds={favoriteIds}
              onFavorite={toggleFavorite}
              onMenu={setMenuItem}
            />

            <section className="browseSection">
              <div className="browseHeading"><h2>My Designs</h2><span>{projects.length}</span></div>
              <div className="projectSaveComposer">
                <input
                  className="iosTextField"
                  aria-label="Project name"
                  placeholder="Name this design"
                  value={projectName}
                  onChange={(event) => setProjectName(splitGraphemes(event.target.value).slice(0, 60).join(''))}
                />
                <button
                  type="button"
                  className="primaryAction librarySaveButton"
                  disabled={
                    !hydrated ||
                    projectSaveInProgress ||
                    imageImportInProgress ||
                    presetTransferInProgress ||
                    cleanupInProgress ||
                    projects.length >= MAX_SAVED_PROJECTS
                  }
                  onClick={async () => {
                    const saved = await saveProject(projectName);
                    if (saved) setProjectName('');
                  }}
                >
                  {projectSaveInProgress ? 'Saving…' : 'Save Current Design'}
                </button>
              </div>
              {projects.length ? (
                <div className="projectGrid">
                  {projects.map((project) => (
                    <article className="projectCard" key={project.id}>
                      {project.preview ? <img src={project.preview} alt="" loading="lazy" decoding="async" /> : <div className="projectPlaceholder" />}
                      <strong>{project.name}</strong>
                      <small>{new Date(project.updatedAt || project.createdAt).toLocaleDateString()}</small>
                      <div className="projectActions">
                        <button type="button" disabled={projectBusyIds.has(project.id)} onClick={() => openProject(project)}>Open</button>
                        <button
                          type="button"
                          disabled={projectBusyIds.has(project.id) || projects.length >= MAX_SAVED_PROJECTS}
                          onClick={() => duplicateProject(project)}
                        >
                          Duplicate
                        </button>
                        <button type="button" disabled={projectBusyIds.has(project.id)} className="destructive" onClick={() => removeProject(project)}>Delete</button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : <div className="stateCard"><strong>No saved designs yet</strong><span>Your autosaved draft is safe. Save named versions here when you want to keep them.</span></div>}
            </section>

            <ArtworkRail
              title="Recent"
              items={recent}
              onPick={useArtwork}
              favoriteIds={favoriteIds}
              onFavorite={toggleFavorite}
              onMenu={setMenuItem}
            />

            <section className="browseSection">
              <div className="browseHeading"><h2>Imports</h2><span>{imports.length}</span></div>
              {imports.length ? (
                <div className="importList">
                  {imports.map((asset) => (
                    <button
                      type="button"
                      className="actionRow"
                      key={asset.id}
                      disabled={cleanupInProgress || presetTransferInProgress || imageImportInProgress}
                      onClick={() => applyImportedArtwork(asset)}
                    >
                      <span><strong>{asset.name}</strong><small>{asset.type || 'image'}</small></span>
                      <IOSIcon name="chevron" size={17} />
                    </button>
                  ))}
                </div>
              ) : <div className="stateCard"><span>Photos and image files you import will appear here.</span></div>}
            </section>

            <Group title="Presets">
              <button
                type="button"
                className="actionRow"
                disabled={presetTransferInProgress || cleanupInProgress || imageImportInProgress}
                onClick={exportPresetJson}
              >
                <span><strong>{presetTransferInProgress ? 'Preset Operation…' : 'Export Design JSON'}</strong><small>Share the full editable design state</small></span>
                <IOSIcon name="export" size={18} />
              </button>
              <button
                type="button"
                className="actionRow"
                disabled={presetTransferInProgress || cleanupInProgress || imageImportInProgress}
                onClick={() => presetImportRef.current?.click()}
              >
                <span><strong>{presetTransferInProgress ? 'Preset Operation…' : 'Import Design JSON'}</strong><small>Restore a shared AirCard preset</small></span>
                <IOSIcon name="chevron" size={17} />
              </button>
              <input ref={presetImportRef} type="file" accept=".json,application/json" hidden onChange={importPresetJson} />
            </Group>

            <Group title="Advanced">
              <button
                type="button"
                className="actionRow"
                disabled={cleanupInProgress || presetTransferInProgress || imageImportInProgress}
                onClick={reset}
              >
                <span><strong>New Card</strong><small>Start with a clean card. Unsaved work is discarded; saved projects stay in Library.</small></span>
                <IOSIcon name="reset" size={18} />
              </button>
              <SwitchRow label="Expert Mode" detail="Show precise numeric editing controls" value={expertMode} onChange={(value) => { if (!value && studioTool === 'crop' && studioSubtool === 'precision') setStudioSubtool(''); setExpertMode(value); }} />
              <button type="button" className="actionRow" onClick={() => setInstallHelp(true)}>
                <span><strong>Install Card Studio</strong><small>Add the PWA to your iPhone Home Screen</small></span>
                <IOSIcon name="chevron" size={17} />
              </button>
              <button
                type="button"
                className="actionRow"
                disabled={cleanupInProgress || presetTransferInProgress || imageImportInProgress}
                onClick={cleanupUnusedImports}
              >
                <span><strong>{cleanupInProgress ? 'Cleaning Imports…' : 'Clean Unused Imports'}</strong><small>Remove imported image blobs not used by this card or saved projects</small></span>
                <IOSIcon name="trash" size={17} />
              </button>
            </Group>

            <section className="browseSection">
              <div className="browseHeading"><h2>Export History</h2><span>{exportHistory.length}</span></div>
              {exportHistory.length ? (
                <div className="historyList">
                  {exportHistory.map((entry) => (
                    <div className="historyRow" key={entry.id}>
                      <span><strong>{entry.designName}</strong><small>{entry.width} × {entry.height} · {entry.action}</small></span>
                      <time>{new Date(entry.createdAt).toLocaleDateString()}</time>
                    </div>
                  ))}
                </div>
              ) : <div className="stateCard"><span>Your saved/shared exports will be recorded here.</span></div>}
            </section>
          </div>
        )}

        {tab === 'export' && (
          <div className="tabScreen exportScreen" role="tabpanel" id="panel-export" aria-labelledby="tab-export">
            <section className="exportCard" aria-label="Card export details">
              <div className="exportGlyph"><IOSIcon name="export" size={30} /></div>
              <h2>Ready to Export</h2>
              <p>Preview the finished card, then open the native image sheet for either output size.</p>
              <div className="exportSpec">
                <span>1536 × 969</span>
                <code>cardBackgroundCombined@3x.png</code>
              </div>
            </section>

            <button type="button" className="secondaryAction bigAction" disabled={!renderAssetsReady || exportInProgress} onClick={() => setShowExportPreview(true)}>
              <span>Full-Screen Preview</span>
            </button>

            <button
              type="button"
              className="primaryAction bigAction"
              disabled={!renderAssetsReady || exportInProgress}
              onClick={() => nativeExportPng(OUT_W, OUT_H, 'cardBackgroundCombined@3x.png')}
            >
              <IOSIcon name="photo" size={21} />
              <span>Save 3× Image</span>
            </button>

            <Group
              title="IMAGE EXPORTS"
              footer="On iPhone/iPad, each button opens the native image sheet. Choose “Save Image” to place the PNG in Photos."
            >
              <button
                type="button"
                className="actionRow"
                disabled={!renderAssetsReady || exportInProgress}
                onClick={() => nativeExportPng(OUT_W, OUT_H, 'cardBackgroundCombined@3x.png')}
              >
                <span><strong>Save 3× Image</strong><small>1536 × 969 · highest quality</small></span>
                <IOSIcon name="photo" size={19} />
              </button>
              <button
                type="button"
                className="actionRow"
                disabled={!renderAssetsReady || exportInProgress}
                onClick={() => nativeExportPng(1024, 646, 'cardBackgroundCombined@2x.png')}
              >
                <span><strong>Save 2× Image</strong><small>1024 × 646</small></span>
                <IOSIcon name="photo" size={19} />
              </button>
              <button
                type="button"
                className="actionRow"
                disabled={!renderAssetsReady || exportInProgress}
                onClick={() => nativeExportPng(OUT_W, OUT_H, 'cardBackgroundCombined@3x.png')}
              >
                <span><strong>Share 3× PNG</strong><small>Photos, AirDrop, Messages, apps, and more</small></span>
                <IOSIcon name="export" size={18} />
              </button>
            </Group>

            <button type="button" className="secondaryAction bigAction" disabled={!hydrated || projectSaveInProgress || imageImportInProgress || presetTransferInProgress || cleanupInProgress} onClick={() => saveProject()}>
              {projectSaveInProgress ? 'Saving Design…' : 'Save Design to Library'}
            </button>

            <p className="legalNote">Artwork rights remain with their respective owners. Card-skin media is screened in-app for usable card artwork before export.</p>
          </div>
        )}
      </div>

      <nav className="tabBar" role="tablist" aria-label="Card Studio sections">
        {TAB_ITEMS.map(([value, label]) => (
          <button
            type="button"
            key={value}
            id={'tab-' + value}
            role="tab"
            aria-selected={tab === value}
            aria-controls={'panel-' + value}
            tabIndex={tab === value ? 0 : -1}
            className={tab === value ? 'active' : ''}
            onKeyDown={(event) => handleTabKeyDown(
              event,
              TAB_ITEMS.map(([item]) => item),
              tab,
              setTab
            )}
            onClick={() => setTab(value)}
          >
            <IOSIcon name={value} size={24} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {menuItem ? (
        <Modal title={menuItem.title} onClose={() => setMenuItem(null)} className="skinMenuSheet">
          <div className="menuPreview"><CatalogArtwork item={menuItem} alt={menuItem.title} useThumbnail={false} /></div>
          <button
            type="button"
            className="secondaryAction"
            onClick={() => {
              if (useArtwork(menuItem)) {
                setShowExportPreview(true);
              }
            }}
          >
            Preview
          </button>
          <button type="button" className="primaryAction" onClick={() => useArtwork(menuItem)}>Use Skin</button>
          <button type="button" className="secondaryAction" onClick={() => toggleFavorite(menuItem)}>
            {favoriteIds.has(String(menuItem.id)) ? 'Remove Favorite' : 'Add to Favorites'}
          </button>
        </Modal>
      ) : null}

      {showExportPreview ? (
        <Modal title="Final Card Preview" onClose={() => setShowExportPreview(false)} className="previewModal">
          <div className="fullPreviewFrame">
            <canvas ref={fullPreviewCanvasRef} width={OUT_W} height={OUT_H} aria-label="Full-screen final card preview" />
          </div>
          <button
            type="button"
            className="primaryAction"
            disabled={!renderAssetsReady || exportInProgress}
            onClick={() => nativeExportPng(OUT_W, OUT_H, 'cardBackgroundCombined@3x.png')}
          >
            {exportInProgress ? 'Exporting…' : 'Save / Share 3× Image'}
          </button>
        </Modal>
      ) : null}

      {installHelp ? (
        <Modal title="Install Card Studio" onClose={dismissInstallHelp} className="installModal">
          <div className="installSteps">
            <span>1</span><p>Open Card Studio in Safari.</p>
            <span>2</span><p>Tap the Share button.</p>
            <span>3</span><p>Choose <strong>Add to Home Screen</strong>.</p>
            <span>4</span><p>Launch Card Studio from its Home Screen icon for the full-screen PWA experience.</p>
          </div>
          <button type="button" className="primaryAction" onClick={dismissInstallHelp}>Got It</button>
        </Modal>
      ) : null}
      </main>

      {blockingAssetOperation ? (
        <div className="cleanupShield" role="status" aria-live="assertive" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <strong>
            {cleanupInProgress ? 'Cleaning unused imports…' : 'Working with design preset…'}
          </strong>
        </div>
      ) : null}
    </>
  );
}
