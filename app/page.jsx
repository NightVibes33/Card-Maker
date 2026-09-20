'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  blobToDataUrl,
  cacheArtwork,
  dataUrlToBlob,
  dbDelete,
  dbGet,
  dbGetAll,
  dbPut,
  makeId
} from './lib/storage';

const OUT_W = 1536;
const OUT_H = 969;
const CARD_RATIO = OUT_W / OUT_H;

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

const DEFAULTS = {
  background: '',
  backgroundLabel: 'Midnight',
  sourceCrop: null,
  originalSourceCrop: null,
  gradient: 0,
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
  layerOrder: ['builtin-chip', 'builtin-contactless', 'builtin-text']
};

const TAB_ITEMS = [
  ['discover', 'Discover'],
  ['studio', 'Studio'],
  ['library', 'Library'],
  ['export', 'Export']
];

const STUDIO_TOOLS = [
  ['crop', 'Crop'],
  ['position', 'Position'],
  ['adjust', 'Adjust'],
  ['effects', 'Effects'],
  ['card', 'Card']
];

const ADJUSTMENT_PRESETS = {
  Original: { exposure: 0, brightness: 1, contrast: 1, saturation: 1, highlights: 0, shadows: 0, temperature: 0, tint: 0, sharpness: 0, blur: 0 },
  Vivid: { exposure: 0.08, brightness: 1.05, contrast: 1.13, saturation: 1.28, highlights: 0.08, shadows: 0.06, temperature: 0.03, tint: 0, sharpness: 0.18, blur: 0 },
  Dark: { exposure: -0.22, brightness: 0.86, contrast: 1.2, saturation: 1.02, highlights: -0.18, shadows: -0.08, temperature: -0.02, tint: 0, sharpness: 0.08, blur: 0 },
  AMOLED: { exposure: -0.12, brightness: 0.91, contrast: 1.34, saturation: 1.18, highlights: -0.22, shadows: -0.18, temperature: -0.03, tint: 0.02, sharpness: 0.15, blur: 0 },
  Warm: { exposure: 0.04, brightness: 1.02, contrast: 1.04, saturation: 1.1, highlights: 0.06, shadows: 0.05, temperature: 0.28, tint: 0.04, sharpness: 0.05, blur: 0 },
  Cold: { exposure: 0.02, brightness: 1.02, contrast: 1.08, saturation: 0.98, highlights: 0.03, shadows: 0.02, temperature: -0.3, tint: -0.03, sharpness: 0.08, blur: 0 },
  Film: { exposure: -0.03, brightness: 1.01, contrast: 0.92, saturation: 0.87, highlights: -0.12, shadows: 0.16, temperature: 0.12, tint: 0.05, sharpness: -0.08, blur: 0.03 },
  Neon: { exposure: 0.04, brightness: 1.02, contrast: 1.27, saturation: 1.55, highlights: 0.12, shadows: -0.08, temperature: -0.06, tint: 0.16, sharpness: 0.22, blur: 0 },
  Vintage: { exposure: -0.05, brightness: 1.02, contrast: 0.88, saturation: 0.72, highlights: -0.08, shadows: 0.18, temperature: 0.24, tint: 0.08, sharpness: -0.12, blur: 0.02 },
  Monochrome: { exposure: 0, brightness: 1.02, contrast: 1.12, saturation: 0, highlights: 0.02, shadows: 0.02, temperature: 0, tint: 0, sharpness: 0.08, blur: 0 }
};

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

const BUILTIN_LAYER_IDS = ['builtin-chip', 'builtin-contactless', 'builtin-text'];

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

function insertCustomLayerBelowHardware(design, id) {
  const order = normalizeLayerOrder(design).filter((entry) => entry !== id);
  const firstBuiltin = order.findIndex((entry) => BUILTIN_LAYER_IDS.includes(entry));
  if (firstBuiltin >= 0) order.splice(firstBuiltin, 0, id);
  else order.push(id);
  return order;
}

function isLayerStackEntryVisible(design, id) {
  if (id === 'builtin-chip') return Boolean(design.chip);
  if (id === 'builtin-contactless') return Boolean(design.contactless);
  if (id === 'builtin-text') return Boolean(design.badge || design.number || design.holder || design.expiry);
  const layer = (design.customLayers || []).find((entry) => entry.id === id);
  return Boolean(layer && !layer.hidden);
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

function measureTrackedText(ctx, text, tracking = 0) {
  const chars = Array.from(String(text || ''));
  if (!chars.length) return 0;
  return chars.reduce((width, char) => width + ctx.measureText(char).width, 0) +
    Math.max(0, chars.length - 1) * Number(tracking || 0);
}

function drawTrackedText(ctx, text, x, y, tracking = 0) {
  const chars = Array.from(String(text || ''));
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
  if (layer.type === 'contactless') return { left: -92, top: -92, right: 92, bottom: 92 };

  const size = clamp(Number(layer.fontSize ?? 58), 10, 240);
  const tracking = Number(layer.letterSpacing ?? 0);
  const chars = Array.from(String(layer.text ?? 'Text'));
  const estimatedWidth = Math.max(
    size * 0.5,
    chars.reduce(
      (width, char) => width + size * (char === ' ' ? 0.34 : /[ilI1|]/.test(char) ? 0.3 : /[MW@#]/.test(char) ? 0.82 : 0.58),
      0
    ) + Math.max(0, chars.length - 1) * tracking
  );
  const align = layer.align || 'center';
  const left = align === 'left' ? 0 : align === 'right' ? -estimatedWidth : -estimatedWidth / 2;
  return { left, top: -size * 0.9, right: left + estimatedWidth, bottom: size * 0.28 };
}

function pointInRotatedBounds(px, py, cx, cy, rotation, scale, bounds, padding = 0) {
  const radians = (Number(rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = px - cx;
  const dy = py - cy;
  const safeScale = Math.max(0.0001, Number(scale || 1));
  const localX = (dx * cos + dy * sin) / safeScale;
  const localY = (-dx * sin + dy * cos) / safeScale;
  return (
    localX >= bounds.left - padding &&
    localX <= bounds.right + padding &&
    localY >= bounds.top - padding &&
    localY <= bounds.bottom + padding
  );
}

function customLayerSelectionStyle(layer, layerImage) {
  const bounds = customLayerBounds(layer, layerImage);
  const scale = clamp(Number(layer?.scale ?? 1), 0.1, 6);
  const rotation = Number(layer?.rotation || 0);
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const centerLocalX = ((bounds.left + bounds.right) / 2) * scale;
  const centerLocalY = ((bounds.top + bounds.bottom) / 2) * scale;
  const originX = Number(layer?.x ?? 0.5) * OUT_W;
  const originY = Number(layer?.y ?? 0.5) * OUT_H;
  const centerX = originX + centerLocalX * cos - centerLocalY * sin;
  const centerY = originY + centerLocalX * sin + centerLocalY * cos;
  const width = Math.max(18, (bounds.right - bounds.left) * scale);
  const height = Math.max(18, (bounds.bottom - bounds.top) * scale);
  return {
    left: (centerX / OUT_W) * 100 + '%',
    top: (centerY / OUT_H) * 100 + '%',
    width: (width / OUT_W) * 100 + '%',
    height: (height / OUT_H) * 100 + '%',
    transform: 'translate(-50%, -50%) rotate(' + rotation + 'deg)'
  };
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
  if (name === 'search') {
    return <svg {...common}><circle cx="10.2" cy="10.2" r="5.8"/><path d="m14.5 14.5 4.8 4.8"/></svg>;
  }
  if (name === 'x') {
    return <svg {...common}><path d="m7 7 10 10M17 7 7 17"/></svg>;
  }
  if (name === 'chevron') {
    return <svg {...common}><path d="m9 6 6 6-6 6"/></svg>;
  }
  return null;
}

function drawChip(ctx, d) {
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

  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((d.chipRotation * Math.PI) / 180);
  ctx.translate(-(x + w / 2), -(y + h / 2));

  ctx.shadowColor = 'rgba(0,0,0,.4)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;

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
  ctx.moveTo(cx, y + 9);
  ctx.lineTo(cx, y + h - 9);
  ctx.moveTo(x + 9, cy);
  ctx.lineTo(x + w - 9, cy);
  ctx.stroke();

  [0.25, 0.75].forEach((q) => {
    ctx.beginPath();
    ctx.moveTo(x + w * q, y + 9);
    ctx.lineTo(x + w * q, y + h * 0.3);
    ctx.quadraticCurveTo(cx, y + h * 0.36, cx, cy);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x + w * q, y + h - 9);
    ctx.lineTo(x + w * q, y + h * 0.7);
    ctx.quadraticCurveTo(cx, y + h * 0.64, cx, cy);
    ctx.stroke();
  });

  ctx.restore();
}

function drawChipLayerAtOrigin(ctx, tone = 'gold') {
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

  ctx.shadowColor = 'rgba(0,0,0,.4)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;

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
    ctx.moveTo(x + w * q, y + 9);
    ctx.lineTo(x + w * q, y + h * 0.3);
    ctx.quadraticCurveTo(0, y + h * 0.36, 0, 0);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x + w * q, y + h - 9);
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

function drawContactless(ctx, d) {
  const x = d.contactlessX * OUT_W;
  const y = d.contactlessY * OUT_H;
  const scale = d.contactlessScale;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((Number(d.contactlessRotation || 0) * Math.PI) / 180);
  ctx.strokeStyle = d.textColor;
  ctx.lineWidth = 10 * scale;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.9;
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
        onInput={emit}
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
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          max={max}
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

function CatalogArtwork({ item, alt, useThumbnail = true }) {
  const crop = item?.sourceCrop;
  const src = useThumbnail ? (item.thumbnail || item.image) : item.image;

  return (
    <span className="catalogArtworkFrame">
      {crop && crop.w > 0 && crop.h > 0 ? (
        <img
          className="croppedCatalogImage"
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          style={{
            width: (100 / crop.w) + '%',
            height: (100 / crop.h) + '%',
            left: (-100 * crop.x / crop.w) + '%',
            top: (-100 * crop.y / crop.h) + '%'
          }}
        />
      ) : (
        <img src={src} alt={alt} loading="lazy" decoding="async" />
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
                isFavorite={favoriteIds.has(item.id)}
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
                  isFavorite={favoriteIds.has(item.id)}
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
  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className={'modalSheet ' + className} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modalHeader">
          <h2>{title}</h2>
          <button type="button" className="modalClose" onClick={onClose} aria-label={'Close ' + title}>×</button>
        </div>
        {children}
      </section>
    </div>
  );
}

function loadSearchImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Artwork image failed'));
    img.src = src;
  });
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

      return {
        ...item,
        image: meta.full,
        thumbnail: meta.thumbnail,
        visualQuality: 'server-preprocessed',
        visualScore: Number(meta.quality?.variance || 0),
        sourceCrop: meta.crop || null,
        mediaAspectRatio: meta.ratio || item.mediaAspectRatio || null
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

function isPersistableBackground(src = '') {
  return src.startsWith('/api/image?') || src.startsWith('idb://imports/');
}

export default function Page() {
  const [tab, setTab] = useState('discover');
  const [studioTool, setStudioTool] = useState('position');
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
  const [imports, setImports] = useState([]);
  const [exportHistory, setExportHistory] = useState([]);
  const [expertMode, setExpertMode] = useState(false);
  const [guidesEnabled, setGuidesEnabled] = useState(true);
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
  const [layerImages, setLayerImages] = useState({});
  const [loadedImageLayerSourceKey, setLoadedImageLayerSourceKey] = useState('[]');
  const canvasRef = useRef(null);
  const fullPreviewCanvasRef = useRef(null);
  const uploadRef = useRef(null);
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

  const gradient = useMemo(
    () => GRADIENTS.find((item) => item.id === design.gradient) || GRADIENTS[0],
    [design.gradient]
  );

  const imageLayerSourceKey = useMemo(
    () => JSON.stringify(
      (design.customLayers || [])
        .filter((layer) => layer.type === 'image' && layer.src)
        .map((layer) => ({ id: layer.id, src: layer.src }))
    ),
    [design.customLayers]
  );

  const renderAssetsReady = useMemo(() => {
    if (design.background && (!image || loadedBackgroundKey !== design.background)) return false;
    if (loadedImageLayerSourceKey !== imageLayerSourceKey) return false;
    return (design.customLayers || []).every(
      (layer) => layer.type !== 'image' || !layer.src || Boolean(layerImages[layer.id])
    );
  }, [
    design.background,
    design.customLayers,
    image,
    imageLayerSourceKey,
    layerImages,
    loadedBackgroundKey,
    loadedImageLayerSourceKey
  ]);

  const replaceDesign = useCallback((nextDesign) => {
    designRef.current = nextDesign;
    setDesign(nextDesign);
  }, []);

  const patch = useCallback((next, recordHistory = true, historyKey = '') => {
    const current = designRef.current;
    const delta = typeof next === 'function' ? next(current) : next;
    const updated = { ...current, ...delta };
    if (JSON.stringify(updated) === JSON.stringify(current)) return current;

    if (recordHistory) {
      const now = Date.now();
      const automaticKey = historyKey || (
        typeof next === 'function'
          ? ''
          : Object.keys(delta || {}).sort().join('|')
      );
      const previousGroup = historyGroupRef.current;
      const coalesced = Boolean(
        automaticKey &&
        previousGroup.key === automaticKey &&
        now - previousGroup.at < 700
      );

      if (!coalesced) {
        undoRef.current = [...undoRef.current.slice(-49), current];
        setHistoryVersion((value) => value + 1);
      }

      redoRef.current = [];
      historyGroupRef.current = { key: automaticKey, at: now };
    }

    replaceDesign(updated);
    return updated;
  }, [replaceDesign]);

  const undo = useCallback(() => {
    historyGroupRef.current = { key: '', at: 0 };
    const previous = undoRef.current.pop();
    if (!previous) return;

    const current = designRef.current;
    redoRef.current = [...redoRef.current.slice(-49), current];
    replaceDesign(previous);
    setHistoryVersion((value) => value + 1);
    setMessage('Undid change');
  }, [replaceDesign]);

  const redo = useCallback(() => {
    historyGroupRef.current = { key: '', at: 0 };
    const next = redoRef.current.pop();
    if (!next) return;

    const current = designRef.current;
    undoRef.current = [...undoRef.current.slice(-49), current];
    replaceDesign(next);
    setHistoryVersion((value) => value + 1);
    setMessage('Redid change');
  }, [replaceDesign]);

  const rememberArtwork = useCallback((item) => {
    setRecent((current) => {
      const next = [item, ...current.filter((entry) => entry.id !== item.id)].slice(0, 20);
      try {
        localStorage.setItem('aircard-recent-artwork-v1', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const [draft, storedFavorites, storedProjects, storedImports, storedExports] = await Promise.all([
          dbGet('kv', 'draft'),
          dbGetAll('favorites'),
          dbGetAll('projects'),
          dbGetAll('imports'),
          dbGetAll('exports')
        ]);

        if (cancelled) return;

        if (draft?.design && typeof draft.design === 'object') {
          const parsed = { ...draft.design };
          parsed.background = parsed.background && isPersistableBackground(parsed.background)
            ? parsed.background
            : '';
          replaceDesign({ ...designRef.current, ...parsed });
        } else {
          const legacy = localStorage.getItem('aircard-sticker-fvp-v3');
          if (legacy) {
            const parsed = JSON.parse(legacy);
            if (parsed && typeof parsed === 'object') {
              parsed.background = parsed.background && isPersistableBackground(parsed.background)
                ? parsed.background
                : '';
              replaceDesign({ ...designRef.current, ...parsed });
            }
          }
        }

        const validFavorites = storedFavorites
          .filter((entry) => entry?.item?.id)
          .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
        setFavorites(validFavorites.map((entry) => entry.item));
        setFavoriteIds(new Set(validFavorites.map((entry) => entry.item.id)));
        setProjects(storedProjects.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)));
        setImports(storedImports.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)));
        setExportHistory(storedExports.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, 40));

        const storedRecent = JSON.parse(localStorage.getItem('aircard-recent-artwork-v1') || '[]');
        if (Array.isArray(storedRecent)) {
          setRecent(storedRecent.filter((item) => item?.id).slice(0, 20));
        }

        setExpertMode(localStorage.getItem('aircard-expert-v2') === '1');

        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.register('/sw.js').then((registration) => {
            registration.update().catch(() => {});
          }).catch(() => {});

          const reloadKey = 'card-studio-sw-v3-reloaded';
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (sessionStorage.getItem(reloadKey) === '1') return;
            sessionStorage.setItem(reloadKey, '1');
            window.location.reload();
          });
        }

        const standalone =
          window.matchMedia('(display-mode: standalone)').matches ||
          Boolean(navigator.standalone);
        const dismissed = localStorage.getItem('aircard-install-dismissed-v2') === '1';
        if (!standalone && !dismissed) setInstallHelp(true);
      } catch {
        setMessage('Local library could not fully load');
      }
    }

    hydrate();

    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);

    return () => {
      cancelled = true;
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  useEffect(() => {
    setSaveStatus('Editing…');
    const timer = setTimeout(async () => {
      try {
        const copy = { ...design };
        if (copy.background && !isPersistableBackground(copy.background)) copy.background = '';
        await dbPut('kv', {
          id: 'draft',
          design: copy,
          updatedAt: Date.now()
        });
        localStorage.setItem('aircard-sticker-fvp-v3', JSON.stringify(copy));
        setSaveStatus('Saved');
      } catch {
        setSaveStatus('Save failed');
      }
    }, 420);

    return () => clearTimeout(timer);
  }, [design]);

  useEffect(() => {
    localStorage.setItem('aircard-expert-v2', expertMode ? '1' : '0');
  }, [expertMode]);

  useEffect(() => {
    let objectUrl = '';
    let cancelled = false;
    const backgroundKey = design.background || '';

    async function loadBackground() {
      if (!backgroundKey) {
        setImage(null);
        setLoadedBackgroundKey('');
        return;
      }

      setImage(null);
      setLoadedBackgroundKey('');
      setMessage('Loading artwork…');
      let src = backgroundKey;

      if (src.startsWith('idb://imports/')) {
        const id = src.slice('idb://imports/'.length);
        const asset = await dbGet('imports', id);
        if (cancelled) return;
        if (!asset?.blob) {
          setImage(null);
          setLoadedBackgroundKey('');
          setMessage('Imported artwork is missing');
          return;
        }
        objectUrl = URL.createObjectURL(asset.blob);
        src = objectUrl;
      }

      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (cancelled) return;
        setImage(img);
        setLoadedBackgroundKey(backgroundKey);
        setMessage('Artwork loaded');
      };
      img.onerror = () => {
        if (cancelled) return;
        setImage(null);
        setLoadedBackgroundKey('');
        setMessage('Artwork could not load');
      };
      img.src = src;
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

      for (const layer of imageLayers) {
        let src = layer.src;
        if (src.startsWith('idb://imports/')) {
          const id = src.slice('idb://imports/'.length);
          const asset = await dbGet('imports', id);
          if (!asset?.blob) {
            failed = true;
            continue;
          }
          src = URL.createObjectURL(asset.blob);
          urls.push(src);
        }

        try {
          next[layer.id] = await loadSearchImage(src);
        } catch {
          failed = true;
        }
      }

      if (!cancelled) {
        setLayerImages(next);
        setLoadedImageLayerSourceKey(imageLayerSourceKey);
        if (failed) setMessage('Some image layers could not load');
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
    const originalTarget = options.originalTarget || (options.original ? 'all' : null);
    const artworkOriginal = originalTarget === 'all' || originalTarget === 'artwork';
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.scale(width / OUT_W, height / OUT_H);

    const base = ctx.createLinearGradient(0, 0, OUT_W, OUT_H);
    base.addColorStop(0, gradient.a);
    base.addColorStop(0.5, gradient.b);
    base.addColorStop(1, gradient.c);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, OUT_W, OUT_H);

    if (image) {
      const crop = design.sourceCrop;
      const sx = crop ? clamp(crop.x, 0, 1) * image.width : 0;
      const sy = crop ? clamp(crop.y, 0, 1) * image.height : 0;
      const sw = crop ? clamp(crop.w, 0.01, 1) * image.width : image.width;
      const sh = crop ? clamp(crop.h, 0.01, 1) * image.height : image.height;
      const ratio = sw / sh;
      let iw;
      let ih;

      if ((design.fit === 'cover' && ratio > CARD_RATIO) || (design.fit === 'contain' && ratio < CARD_RATIO)) {
        ih = OUT_H;
        iw = ih * ratio;
      } else {
        iw = OUT_W;
        ih = iw / ratio;
      }

      iw *= design.zoom;
      ih *= design.zoom;

      const x = (OUT_W - iw) / 2 + design.x * OUT_W;
      const y = (OUT_H - ih) / 2 + design.y * OUT_H;
      const exposureFactor = artworkOriginal ? 1 : Math.pow(2, Number(design.exposure || 0));
      const brightness = artworkOriginal ? 1 : clamp(design.brightness * exposureFactor, 0.2, 3);
      const saturation = artworkOriginal ? 1 : clamp(design.saturation, 0, 3);
      const sharpBoost = artworkOriginal ? 0 : Math.max(0, Number(design.sharpness || 0));
      const contrast = artworkOriginal
        ? 1
        : clamp(design.contrast + sharpBoost * 0.22, 0.3, 2.5);
      const blur = artworkOriginal
        ? 0
        : Math.max(0, design.blur + Math.max(0, -Number(design.sharpness || 0)) * 0.09);

      ctx.save();
      ctx.translate(x + iw / 2, y + ih / 2);
      ctx.rotate((design.rotate * Math.PI) / 180);
      ctx.scale(design.flipX ? -1 : 1, 1);
      ctx.filter =
        'brightness(' + brightness + ')' +
        ' saturate(' + saturation + ')' +
        ' contrast(' + contrast + ')' +
        ' blur(' + blur * 7 + 'px)';
      ctx.drawImage(image, sx, sy, sw, sh, -iw / 2, -ih / 2, iw, ih);
      ctx.restore();
      ctx.filter = 'none';

      if (!artworkOriginal) {
        const shadows = Number(design.shadows || 0);
        if (shadows !== 0) {
          ctx.save();
          ctx.globalCompositeOperation = shadows > 0 ? 'screen' : 'multiply';
          ctx.globalAlpha = Math.abs(shadows) * 0.22;
          ctx.fillStyle = shadows > 0 ? '#6f7890' : '#10141c';
          ctx.fillRect(0, 0, OUT_W, OUT_H);
          ctx.restore();
        }

        const highlights = Number(design.highlights || 0);
        if (highlights !== 0) {
          ctx.save();
          ctx.globalCompositeOperation = highlights > 0 ? 'screen' : 'multiply';
          ctx.globalAlpha = Math.abs(highlights) * 0.16;
          ctx.fillStyle = highlights > 0 ? '#fff7ec' : '#7d8794';
          ctx.fillRect(0, 0, OUT_W, OUT_H);
          ctx.restore();
        }

        const temperature = Number(design.temperature || 0);
        if (temperature !== 0) {
          ctx.save();
          ctx.globalCompositeOperation = 'soft-light';
          ctx.globalAlpha = Math.abs(temperature) * 0.24;
          ctx.fillStyle = temperature > 0 ? '#ff8a3d' : '#438cff';
          ctx.fillRect(0, 0, OUT_W, OUT_H);
          ctx.restore();
        }

        const tint = Number(design.tint || 0);
        if (tint !== 0) {
          ctx.save();
          ctx.globalCompositeOperation = 'soft-light';
          ctx.globalAlpha = Math.abs(tint) * 0.2;
          ctx.fillStyle = tint > 0 ? '#d34cff' : '#38d887';
          ctx.fillRect(0, 0, OUT_W, OUT_H);
          ctx.restore();
        }
      }
    }

    if (!artworkOriginal && design.overlay > 0) {
      const overlay = ctx.createLinearGradient(0, 0, OUT_W, OUT_H);
      overlay.addColorStop(0, 'rgba(0,0,0,' + design.overlay * 0.55 + ')');
      overlay.addColorStop(0.55, 'rgba(0,0,0,0)');
      overlay.addColorStop(1, 'rgba(0,0,0,' + design.overlay + ')');
      ctx.fillStyle = overlay;
      ctx.fillRect(0, 0, OUT_W, OUT_H);
    }

    if (!artworkOriginal && design.vignette > 0) {
      const vignette = ctx.createRadialGradient(
        OUT_W / 2,
        OUT_H / 2,
        OUT_W * 0.16,
        OUT_W / 2,
        OUT_H / 2,
        OUT_W * 0.72
      );
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, 'rgba(0,0,0,' + design.vignette + ')');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, OUT_W, OUT_H);
    }

    if (!artworkOriginal && design.gloss > 0) {
      const gloss = ctx.createLinearGradient(0, 0, OUT_W, OUT_H);
      gloss.addColorStop(0, 'rgba(255,255,255,' + design.gloss * 0.42 + ')');
      gloss.addColorStop(0.22, 'rgba(255,255,255,' + design.gloss * 0.08 + ')');
      gloss.addColorStop(0.5, 'rgba(255,255,255,0)');
      ctx.fillStyle = gloss;
      ctx.fillRect(0, 0, OUT_W, OUT_H);
    }

    if (!artworkOriginal && design.grain > 0) {
      ctx.globalAlpha = design.grain;
      for (let i = 0; i < 3600; i += 1) {
        ctx.fillStyle = i % 3 ? '#000' : '#fff';
        ctx.fillRect((i * 331) % OUT_W, (i * 197) % OUT_H, 2, 2);
      }
      ctx.globalAlpha = 1;
    }

    if (!artworkOriginal && design.fade > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = clamp(design.fade, 0, 1) * 0.34;
      ctx.fillStyle = '#f6efe6';
      ctx.fillRect(0, 0, OUT_W, OUT_H);
      ctx.restore();
    }

    if (!artworkOriginal && design.effectTintStrength > 0) {
      const [r, g, b] = hexToRgb(design.effectTint);
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = clamp(design.effectTintStrength, 0, 1) * 0.52;
      ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
      ctx.fillRect(0, 0, OUT_W, OUT_H);
      ctx.restore();
    }

    const customLayerMap = new Map((design.customLayers || []).map((layer) => [layer.id, layer]));
    const stackOrder = normalizeLayerOrder(design);

    const drawBuiltinText = () => {
      ctx.save();
      ctx.fillStyle = design.textColor;
      ctx.shadowColor = design.shadow ? 'rgba(0,0,0,.55)' : 'transparent';
      ctx.shadowBlur = design.shadow ? 16 : 0;

      if (design.badge) {
        ctx.textAlign = 'right';
        ctx.font = '800 66px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText(design.badgeText ?? 'CARD', OUT_W - 105, 130);
      }
      if (design.number) {
        ctx.textAlign = 'left';
        ctx.font = '600 64px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillText(design.numberText, 120, 700);
      }

      ctx.font = '650 34px -apple-system, BlinkMacSystemFont, sans-serif';
      if (design.holder) {
        ctx.textAlign = 'left';
        ctx.fillText(design.holderText, 122, 815);
      }
      if (design.expiry) {
        ctx.textAlign = 'right';
        ctx.fillText(design.expiryText, OUT_W - 122, 815);
      }
      ctx.restore();
    };

    for (const stackId of stackOrder) {
      if (stackId === 'builtin-chip') {
        if (design.chip) drawChip(ctx, design);
        continue;
      }

      if (stackId === 'builtin-contactless') {
        if (design.contactless) drawContactless(ctx, design);
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
      ctx.rotate((Number(layer.rotation || 0) * Math.PI) / 180);
      const scale = clamp(Number(layer.scale || 1), 0.1, 6);
      ctx.scale(layer.type === 'image' && layer.flipX ? -scale : scale, scale);

      if (layer.type === 'text') {
        const size = clamp(Number(layer.fontSize || 54), 10, 240);
        const weight = clamp(Number(layer.weight || 700), 100, 900);
        const fontFamily = {
          system: '-apple-system, BlinkMacSystemFont, sans-serif',
          rounded: 'ui-rounded, -apple-system, BlinkMacSystemFont, sans-serif',
          serif: 'ui-serif, Georgia, serif',
          mono: 'ui-monospace, SFMono-Regular, Menlo, monospace'
        }[layer.fontFamily] || '-apple-system, BlinkMacSystemFont, sans-serif';
        ctx.font = weight + ' ' + size + 'px ' + fontFamily;
        ctx.fillStyle = layer.color || '#ffffff';
        ctx.textAlign = layer.align || 'center';
        ctx.shadowColor = layer.shadow ? 'rgba(0,0,0,.5)' : 'transparent';
        ctx.shadowBlur = layer.shadow ? 12 : 0;
        drawTrackedText(ctx, layer.text ?? 'Text', 0, 0, Number(layer.letterSpacing || 0));
      } else if (layer.type === 'shape') {
        const w = clamp(Number(layer.width || 260), 20, 1200);
        const h = clamp(Number(layer.height || 120), 20, 800);
        ctx.fillStyle = layer.color || '#ffffff';
        if (layer.shape === 'ellipse') {
          ctx.beginPath();
          ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          roundRect(ctx, -w / 2, -h / 2, w, h, clamp(Number(layer.radius ?? 26), 0, Math.min(w, h) / 2));
          ctx.fill();
        }
      } else if (layer.type === 'image') {
        const layerImage = layerImages[layer.id];
        if (layerImage) {
          const layerOriginal = originalTarget === 'all' || originalTarget === layer.id;
          const settings = { ...IMAGE_LAYER_DEFAULTS, ...(layer.adjustments || {}) };
          const crop = layer.crop;
          const sx = crop ? clamp(crop.x, 0, 1) * layerImage.width : 0;
          const sy = crop ? clamp(crop.y, 0, 1) * layerImage.height : 0;
          const sw = crop ? clamp(crop.w, 0.01, 1) * layerImage.width : layerImage.width;
          const sh = crop ? clamp(crop.h, 0.01, 1) * layerImage.height : layerImage.height;
          const ratio = sw / Math.max(1, sh);
          const w = clamp(Number(layer.width || 640), 20, 1800);
          const h = w / Math.max(0.1, ratio);
          const exposureFactor = layerOriginal ? 1 : Math.pow(2, Number(settings.exposure || 0));
          const brightness = layerOriginal ? 1 : clamp(Number(settings.brightness || 1) * exposureFactor, 0.2, 3);
          const saturation = layerOriginal ? 1 : clamp(Number(settings.saturation ?? 1), 0, 3);
          const sharpBoost = layerOriginal ? 0 : Math.max(0, Number(settings.sharpness || 0));
          const contrast = layerOriginal
            ? 1
            : clamp(Number(settings.contrast || 1) + sharpBoost * 0.22, 0.3, 2.5);
          const blur = layerOriginal
            ? 0
            : Math.max(0, Number(settings.blur || 0) + Math.max(0, -Number(settings.sharpness || 0)) * 0.09);

          ctx.filter =
            'brightness(' + brightness + ')' +
            ' saturate(' + saturation + ')' +
            ' contrast(' + contrast + ')' +
            ' blur(' + blur * 7 + 'px)';
          ctx.drawImage(layerImage, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
          ctx.filter = 'none';

          if (!layerOriginal) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(-w / 2, -h / 2, w, h);
            ctx.clip();

            const shadows = Number(settings.shadows || 0);
            if (shadows !== 0) {
              ctx.save();
              ctx.globalCompositeOperation = shadows > 0 ? 'screen' : 'multiply';
              ctx.globalAlpha = Math.abs(shadows) * 0.22;
              ctx.fillStyle = shadows > 0 ? '#6f7890' : '#10141c';
              ctx.fillRect(-w / 2, -h / 2, w, h);
              ctx.restore();
            }

            const highlights = Number(settings.highlights || 0);
            if (highlights !== 0) {
              ctx.save();
              ctx.globalCompositeOperation = highlights > 0 ? 'screen' : 'multiply';
              ctx.globalAlpha = Math.abs(highlights) * 0.16;
              ctx.fillStyle = highlights > 0 ? '#fff7ec' : '#7d8794';
              ctx.fillRect(-w / 2, -h / 2, w, h);
              ctx.restore();
            }

            const temperature = Number(settings.temperature || 0);
            if (temperature !== 0) {
              ctx.save();
              ctx.globalCompositeOperation = 'soft-light';
              ctx.globalAlpha = Math.abs(temperature) * 0.24;
              ctx.fillStyle = temperature > 0 ? '#ff8a3d' : '#438cff';
              ctx.fillRect(-w / 2, -h / 2, w, h);
              ctx.restore();
            }

            const layerTint = Number(settings.tint || 0);
            if (layerTint !== 0) {
              ctx.save();
              ctx.globalCompositeOperation = 'soft-light';
              ctx.globalAlpha = Math.abs(layerTint) * 0.2;
              ctx.fillStyle = layerTint > 0 ? '#d34cff' : '#38d887';
              ctx.fillRect(-w / 2, -h / 2, w, h);
              ctx.restore();
            }

            if (Number(settings.overlay || 0) > 0) {
              const overlay = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
              overlay.addColorStop(0, 'rgba(0,0,0,' + Number(settings.overlay) * 0.55 + ')');
              overlay.addColorStop(0.55, 'rgba(0,0,0,0)');
              overlay.addColorStop(1, 'rgba(0,0,0,' + Number(settings.overlay) + ')');
              ctx.fillStyle = overlay;
              ctx.fillRect(-w / 2, -h / 2, w, h);
            }

            if (Number(settings.vignette || 0) > 0) {
              const vignette = ctx.createRadialGradient(0, 0, Math.min(w, h) * 0.14, 0, 0, Math.max(w, h) * 0.66);
              vignette.addColorStop(0, 'rgba(0,0,0,0)');
              vignette.addColorStop(1, 'rgba(0,0,0,' + Number(settings.vignette) + ')');
              ctx.fillStyle = vignette;
              ctx.fillRect(-w / 2, -h / 2, w, h);
            }

            if (Number(settings.gloss || 0) > 0) {
              const gloss = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
              gloss.addColorStop(0, 'rgba(255,255,255,' + Number(settings.gloss) * 0.42 + ')');
              gloss.addColorStop(0.22, 'rgba(255,255,255,' + Number(settings.gloss) * 0.08 + ')');
              gloss.addColorStop(0.5, 'rgba(255,255,255,0)');
              ctx.fillStyle = gloss;
              ctx.fillRect(-w / 2, -h / 2, w, h);
            }

            if (Number(settings.grain || 0) > 0) {
              ctx.save();
              ctx.globalAlpha = Number(settings.grain);
              for (let i = 0; i < 900; i += 1) {
                ctx.fillStyle = i % 3 ? '#000' : '#fff';
                const gx = -w / 2 + ((i * 331) % Math.max(1, Math.floor(w)));
                const gy = -h / 2 + ((i * 197) % Math.max(1, Math.floor(h)));
                ctx.fillRect(gx, gy, 1.5, 1.5);
              }
              ctx.restore();
            }

            if (Number(settings.fade || 0) > 0) {
              ctx.save();
              ctx.globalCompositeOperation = 'screen';
              ctx.globalAlpha = clamp(Number(settings.fade), 0, 1) * 0.34;
              ctx.fillStyle = '#f6efe6';
              ctx.fillRect(-w / 2, -h / 2, w, h);
              ctx.restore();
            }

            if (Number(settings.effectTintStrength || 0) > 0) {
              const [r, g, b] = hexToRgb(settings.effectTint || '#7b61ff');
              ctx.save();
              ctx.globalCompositeOperation = 'soft-light';
              ctx.globalAlpha = clamp(Number(settings.effectTintStrength), 0, 1) * 0.52;
              ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
              ctx.fillRect(-w / 2, -h / 2, w, h);
              ctx.restore();
            }

            ctx.restore();
          }
        }
      } else if (layer.type === 'chip') {
        drawChipLayerAtOrigin(ctx, layer.tone || 'gold');
      } else if (layer.type === 'contactless') {
        drawContactlessLayerAtOrigin(ctx, layer.color || '#ffffff');
      }

      ctx.restore();
    }

    ctx.restore();
  }, [design, gradient, image, layerImages]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const originalTarget = showOriginal
      ? ((design.customLayers || []).some((layer) => layer.id === selectedElement && layer.type === 'image')
          ? selectedElement
          : 'artwork')
      : null;
    renderCard(canvas.getContext('2d'), OUT_W, OUT_H, { originalTarget });
    if (showExportPreview && fullPreviewCanvasRef.current) {
      renderCard(fullPreviewCanvasRef.current.getContext('2d'), OUT_W, OUT_H);
    }
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

      const response = await fetch('/api/cucu?' + params.toString());
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Card library failed');
      if (!isCurrentIntent()) return;

      const rawList = Array.isArray(json.results) ? json.results : [];
      const cleanList = await prepareCleanResults(rawList);
      if (!isCurrentIntent()) return;

      setCucuTotal(Number(json.total) || 0);
      setCucuHasMore(Boolean(json.hasMore));
      setCucuCategoryLabel(
        search.trim()
          ? 'Search Results'
          : json.categoryLabel || CUCU_CATEGORIES.find(([key]) => key === category)?.[1] || 'Card Skins'
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
          const response = await fetch('/api/cucu?category=' + encodeURIComponent(category) + '&page=1&limit=8');
          const json = await response.json();
          if (!response.ok) return;
          const items = Array.isArray(json.results) ? json.results.slice(0, 8) : [];
          next[label] = await prepareCleanResults(items, 8);
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
    if (!item?.id) return;

    const already = favoriteIds.has(item.id);
    if (already) {
      await dbDelete('favorites', item.id).catch(() => {});
      setFavoriteIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      setFavorites((current) => current.filter((entry) => entry.id !== item.id));
      setMessage('Removed from Favorites');
      return;
    }

    const stored = { ...item };
    await dbPut('favorites', {
      id: item.id,
      item: stored,
      updatedAt: Date.now()
    }).catch(() => {});

    cacheArtwork(item.image);
    if (item.thumbnail) cacheArtwork(item.thumbnail);

    setFavoriteIds((current) => new Set([...current, item.id]));
    setFavorites((current) => [stored, ...current.filter((entry) => entry.id !== item.id)]);
    setMessage('Added to Favorites');
  }

  function useArtwork(item) {
    patch({
      background: item.image,
      backgroundLabel: item.title,
      sourceCrop: item.sourceCrop || null,
      originalSourceCrop: item.sourceCrop || null,
      zoom: item.sourceCrop ? 1 : 1.06,
      x: 0,
      y: 0,
      rotate: 0,
      flipX: false,
      fit: 'cover'
    });
    rememberArtwork(item);
    cacheArtwork(item.image);
    setSelectedElement('artwork');
    setStudioTool('position');
    setTab('studio');
    setMenuItem(null);
    setMessage(item.title + ' selected');
  }

  async function uploadImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const id = makeId('import');
    const asset = {
      id,
      name: file.name || 'Imported image',
      type: file.type || 'image/*',
      blob: file,
      createdAt: Date.now()
    };

    await dbPut('imports', asset);
    setImports((current) => [asset, ...current.filter((entry) => entry.id !== id)]);

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
    setStudioTool('crop');
    setTab('studio');
    setMessage('Imported image ready to crop');
  }

  async function uploadLayerImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const assetId = makeId('import');
    const layerId = makeId('layer');
    const asset = {
      id: assetId,
      name: file.name || 'Image layer',
      type: file.type || 'image/*',
      blob: file,
      createdAt: Date.now()
    };

    await dbPut('imports', asset);
    setImports((current) => [asset, ...current.filter((entry) => entry.id !== assetId)]);
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
    setMessage('Image layer added');
  }

  function updateCropEdge(edge, rawValue) {
    const value = clamp(Number(rawValue), 0, 0.48);
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

      return {
        sourceCrop: {
          x: left,
          y: top,
          w: Math.max(0.1, 1 - left - right),
          h: Math.max(0.1, 1 - top - bottom)
        }
      };
    }, true, 'crop:' + edge);
  }

  function updateLayerCropEdge(id, edge, rawValue) {
    const value = clamp(Number(rawValue), 0, 0.48);
    patch((current) => ({
      customLayers: (current.customLayers || []).map((layer) => {
        if (layer.id !== id || layer.type !== 'image' || layer.locked) return layer;
        const crop = layer.crop || { x: 0, y: 0, w: 1, h: 1 };
        let left = clamp(crop.x, 0, 0.9);
        let top = clamp(crop.y, 0, 0.9);
        let right = clamp(1 - crop.x - crop.w, 0, 0.9);
        let bottom = clamp(1 - crop.y - crop.h, 0, 0.9);

        if (edge === 'left') left = Math.min(value, 0.9 - right);
        if (edge === 'right') right = Math.min(value, 0.9 - left);
        if (edge === 'top') top = Math.min(value, 0.9 - bottom);
        if (edge === 'bottom') bottom = Math.min(value, 0.9 - top);

        return {
          ...layer,
          crop: {
            x: left,
            y: top,
            w: Math.max(0.1, 1 - left - right),
            h: Math.max(0.1, 1 - top - bottom)
          }
        };
      })
    }), true, 'layer-crop:' + id + ':' + edge);
  }

  function addTextLayer() {
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
          align: 'center',
          shadow: true,
          locked: false
        }
      ]
    }));
    setSelectedElement(id);
    setMessage('Text layer added');
  }

  function addShapeLayer() {
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
    setMessage('Shape layer added');
  }

  function addChipLayer() {
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
    setMessage('Chip layer added');
  }

  function addContactlessLayer() {
    const id = makeId('layer');
    patch((current) => ({
      layerOrder: insertCustomLayerBelowHardware(current, id),
      customLayers: [
        ...(current.customLayers || []),
        {
          id,
          type: 'contactless',
          name: 'Contactless',
          x: 0.33,
          y: 0.46,
          scale: 1,
          rotation: 0,
          opacity: 1,
          color: '#ffffff',
          locked: false
        }
      ]
    }));
    setSelectedElement(id);
    setMessage('Contactless layer added');
  }

  function updateLayer(id, delta) {
    const key = 'layer:' + id + ':' + Object.keys(delta || {}).sort().join('|');
    patch((current) => ({
      customLayers: (current.customLayers || []).map((layer) => {
        if (layer.id !== id) return layer;
        if (layer.locked && !Object.prototype.hasOwnProperty.call(delta || {}, 'locked')) return layer;
        const updated = { ...layer, ...delta };

        if (updated.type === 'shape') {
          const width = clamp(Number(updated.width ?? 280), 20, 1200);
          const height = clamp(Number(updated.height ?? 120), 20, 800);
          updated.width = width;
          updated.height = height;
          updated.radius = clamp(Number(updated.radius ?? 28), 0, Math.min(width, height) / 2);
        }

        return updated;
      })
    }), true, key);
  }

  function deleteLayer(id) {
    patch((current) => ({
      layerOrder: normalizeLayerOrder(current).filter((entry) => entry !== id),
      customLayers: (current.customLayers || []).filter((layer) => layer.id !== id)
    }));
    setSelectedElement('artwork');
  }

  function duplicateLayer(id) {
    patch((current) => {
      const source = (current.customLayers || []).find((layer) => layer.id === id);
      if (!source) return {};
      const copy = {
        ...source,
        id: makeId('layer'),
        name: (source.name || source.type) + ' Copy',
        x: clamp(Number(source.x ?? 0.5) + 0.03, 0, 1),
        y: clamp(Number(source.y ?? 0.5) + 0.03, 0, 1)
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
    patch((current) => {
      const order = normalizeLayerOrder(current);
      const index = order.indexOf(id);
      if (index < 0) return {};

      let target = index + direction;
      while (
        target >= 0 &&
        target < order.length &&
        !isLayerStackEntryVisible(current, order[target])
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
    const key = 'image:' + selectedElement + ':' + Object.keys(delta || {}).sort().join('|');
    patch((current) => {
      const layer = (current.customLayers || []).find((entry) => entry.id === selectedElement);
      if (layer?.type === 'image') {
        if (layer.locked) return {};
        return {
          customLayers: (current.customLayers || []).map((entry) =>
            entry.id === layer.id
              ? {
                  ...entry,
                  adjustments: {
                    ...IMAGE_LAYER_DEFAULTS,
                    ...(entry.adjustments || {}),
                    ...delta
                  }
                }
              : entry
          )
        };
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
    const now = Date.now();
    const id = makeId('project');
    const name = nameOverride.trim() || design.backgroundLabel || 'Untitled Card';
    const preview = renderAssetsReady ? makeCanvas(384, 242).toDataURL('image/jpeg', 0.78) : '';
    const project = {
      id,
      name,
      design: { ...design },
      preview,
      createdAt: now,
      updatedAt: now
    };

    await dbPut('projects', project);
    setProjects((current) => [project, ...current]);
    if (design.background.startsWith('/api/image?')) cacheArtwork(design.background);
    setMessage('Saved to Library');
    return project;
  }

  function openProject(project) {
    if (!project?.design) return;
    undoRef.current = [];
    redoRef.current = [];
    historyGroupRef.current = { key: '', at: 0 };
    setHistoryVersion((value) => value + 1);
    replaceDesign({ ...DEFAULTS, ...project.design });
    setTab('studio');
    setMessage(project.name + ' opened');
  }

  async function duplicateProject(project) {
    const copy = {
      ...project,
      id: makeId('project'),
      name: (project.name || 'Design') + ' Copy',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await dbPut('projects', copy);
    setProjects((current) => [copy, ...current]);
    setMessage('Design duplicated');
  }

  async function removeProject(project) {
    await dbDelete('projects', project.id);
    setProjects((current) => current.filter((entry) => entry.id !== project.id));
    setMessage('Design deleted');
  }

  async function serializePreset() {
    const payload = {
      version: 2,
      app: 'AirCard Card Studio',
      exportedAt: new Date().toISOString(),
      design: JSON.parse(JSON.stringify(design)),
      assets: {}
    };

    const refs = new Set();
    if (design.background?.startsWith('idb://imports/')) {
      refs.add(design.background.slice('idb://imports/'.length));
    }
    for (const layer of design.customLayers || []) {
      if (layer.src?.startsWith('idb://imports/')) {
        refs.add(layer.src.slice('idb://imports/'.length));
      }
    }

    for (const id of refs) {
      const asset = await dbGet('imports', id);
      if (asset?.blob) {
        payload.assets[id] = {
          name: asset.name,
          type: asset.type,
          data: await blobToDataUrl(asset.blob)
        };
      }
    }

    return payload;
  }

  async function exportPresetJson() {
    const payload = await serializePreset();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = (design.backgroundLabel || 'aircard-design').replace(/[^a-z0-9_-]+/gi, '-') + '.aircard.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
    setMessage('Design preset exported');
  }

  async function importPresetJson(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const payload = JSON.parse(await file.text());
      if (!payload?.design || Number(payload.version) < 2) throw new Error('Unsupported preset');

      const idMap = {};
      for (const [oldId, asset] of Object.entries(payload.assets || {})) {
        if (!asset?.data) continue;
        const newId = makeId('import');
        idMap[oldId] = newId;
        await dbPut('imports', {
          id: newId,
          name: asset.name || 'Preset asset',
          type: asset.type || 'image/*',
          blob: dataUrlToBlob(asset.data),
          createdAt: Date.now()
        });
      }

      const imported = JSON.parse(JSON.stringify(payload.design));
      if (imported.background?.startsWith('idb://imports/')) {
        const oldId = imported.background.slice('idb://imports/'.length);
        if (idMap[oldId]) imported.background = 'idb://imports/' + idMap[oldId];
      }
      imported.customLayers = (imported.customLayers || []).map((layer) => {
        if (!layer.src?.startsWith('idb://imports/')) return layer;
        const oldId = layer.src.slice('idb://imports/'.length);
        return idMap[oldId] ? { ...layer, src: 'idb://imports/' + idMap[oldId] } : layer;
      });

      patch({ ...DEFAULTS, ...imported });
      setImports(await dbGetAll('imports'));
      setTab('studio');
      setMessage('Design preset imported');
    } catch {
      setMessage('Preset could not be imported');
    }
  }

  function reset() {
    undoRef.current = [];
    redoRef.current = [];
    historyGroupRef.current = { key: '', at: 0 };
    setHistoryVersion((value) => value + 1);
    replaceDesign(DEFAULTS);
    setImage(null);
    setLoadedBackgroundKey('');
    setLayerImages({});
    setLoadedImageLayerSourceKey('[]');
    setSelectedElement('artwork');
    setMessage('New card');
  }

  function hitTestElement(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / Math.max(1, rect.width)) * OUT_W;
    const py = ((event.clientY - rect.top) / Math.max(1, rect.height)) * OUT_H;
    const customLayerMap = new Map((design.customLayers || []).map((layer) => [layer.id, layer]));
    const stack = normalizeLayerOrder(design).slice().reverse();

    for (const stackId of stack) {
      if (stackId === 'builtin-contactless' && design.contactless) {
        const radius = 96 * Number(design.contactlessScale || 1);
        if (Math.hypot(px - design.contactlessX * OUT_W, py - design.contactlessY * OUT_H) <= radius) {
          return 'contactless';
        }
        continue;
      }

      if (stackId === 'builtin-chip' && design.chip) {
        const chipW = 255 * Number(design.chipScale || 1);
        const chipH = 188 * Number(design.chipScale || 1);
        const cx = design.chipX * OUT_W + chipW / 2;
        const cy = design.chipY * OUT_H + chipH / 2;
        if (
          pointInRotatedBounds(
            px,
            py,
            cx,
            cy,
            design.chipRotation,
            1,
            { left: -chipW / 2, top: -chipH / 2, right: chipW / 2, bottom: chipH / 2 },
            10
          )
        ) {
          return 'chip';
        }
        continue;
      }

      if (BUILTIN_LAYER_IDS.includes(stackId)) continue;

      const layer = customLayerMap.get(stackId);
      if (!layer || layer.hidden) continue;
      const bounds = customLayerBounds(layer, layerImages[layer.id]);
      if (
        pointInRotatedBounds(
          px,
          py,
          Number(layer.x ?? 0.5) * OUT_W,
          Number(layer.y ?? 0.5) * OUT_H,
          layer.rotation,
          clamp(Number(layer.scale ?? 1), 0.1, 6),
          bounds,
          14
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
    event.currentTarget.setPointerCapture(event.pointerId);

    if (pointers.current.size === 0) {
      const target = hitTestElement(event);
      gestureTarget.current = target;
      gestureStartDesign.current = design;
      gestureHistoryRecorded.current = false;
      setSelectedElement(target);
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

      if (target === 'chip') {
        if (moved) recordGestureHistory();
        patch((current) => {
          const snapX = snapValue(clamp(current.chipX + dx, 0, 0.82), [0.04, 0.105, 1 / 3, 0.5, 2 / 3, 0.78]);
          const snapY = snapValue(clamp(current.chipY + dy, 0, 0.8), [0.04, 1 / 3, 0.35, 0.5, 2 / 3, 0.76]);
          setActiveGuides({
            x: snapX.snapped ? snapX.value : null,
            y: snapY.snapped ? snapY.value : null
          });
          return { chipX: snapX.value, chipY: snapY.value };
        }, false);
      } else if (target === 'contactless') {
        if (moved) recordGestureHistory();
        patch((current) => {
          const snapX = snapValue(clamp(current.contactlessX + dx, 0.03, 0.97), [0.05, 0.285, 1 / 3, 0.5, 2 / 3, 0.95]);
          const snapY = snapValue(clamp(current.contactlessY + dy, 0.03, 0.97), [0.05, 1 / 3, 0.43, 0.5, 2 / 3, 0.95]);
          setActiveGuides({
            x: snapX.snapped ? snapX.value : null,
            y: snapY.snapped ? snapY.value : null
          });
          return { contactlessX: snapX.value, contactlessY: snapY.value };
        }, false);
      } else if (target !== 'artwork') {
        const layer = (design.customLayers || []).find((entry) => entry.id === target);
        if (layer && !layer.locked) {
          if (moved) recordGestureHistory();
          patch((current) => ({
            customLayers: (current.customLayers || []).map((entry) => {
              if (entry.id !== target) return entry;
              const snapX = snapValue(clamp(Number(entry.x ?? 0.5) + dx, 0, 1), [0.05, 1 / 3, 0.5, 2 / 3, 0.95]);
              const snapY = snapValue(clamp(Number(entry.y ?? 0.5) + dy, 0, 1), [0.05, 1 / 3, 0.5, 2 / 3, 0.95]);
              setActiveGuides({
                x: snapX.snapped ? snapX.value : null,
                y: snapY.snapped ? snapY.value : null
              });
              return { ...entry, x: snapX.value, y: snapY.value };
            })
          }), false);
        }
      } else {
        if (moved) recordGestureHistory();
        patch((current) => {
          const rawX = clamp(current.x + dx, -1.5, 1.5);
          const rawY = clamp(current.y + dy, -1.5, 1.5);
          const snapX = snapValue(rawX, [-0.45, -1 / 6, 0, 1 / 6, 0.45]);
          const snapY = snapValue(rawY, [-0.45, -1 / 6, 0, 1 / 6, 0.45]);
          setActiveGuides({
            x: snapX.snapped ? clamp(0.5 + snapX.value, 0.05, 0.95) : null,
            y: snapY.snapped ? clamp(0.5 + snapY.value, 0.05, 0.95) : null
          });
          return { x: snapX.value, y: snapY.value };
        }, false);
      }

      lastPoint.current = { x: event.clientX, y: event.clientY };
    } else if (pointers.current.size === 2) {
      const p = Array.from(pointers.current.values());
      const distance = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      const angle = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
      const factor = lastDistance.current ? distance / Math.max(1, lastDistance.current) : 1;
      const angleDelta = lastAngle.current == null ? 0 : ((angle - lastAngle.current) * 180) / Math.PI;
      const transformed = Math.abs(factor - 1) > 0.0005 || Math.abs(angleDelta) > 0.02;
      if (transformed) recordGestureHistory();

      if (target === 'chip') {
        patch((current) => ({
          chipScale: clamp(current.chipScale * factor, 0.5, 2),
          chipRotation: clamp(current.chipRotation + angleDelta, -45, 45)
        }), false);
      } else if (target === 'contactless') {
        patch((current) => ({
          contactlessScale: clamp(current.contactlessScale * factor, 0.4, 2.2),
          contactlessRotation: clamp(Number(current.contactlessRotation || 0) + angleDelta, -180, 180)
        }), false);
      } else if (target !== 'artwork') {
        patch((current) => ({
          customLayers: (current.customLayers || []).map((layer) =>
            layer.id === target && !layer.locked
              ? {
                  ...layer,
                  scale: clamp(Number(layer.scale ?? 1) * factor, 0.1, 6),
                  rotation: clamp(Number(layer.rotation || 0) + angleDelta, -180, 180)
                }
              : layer
          )
        }), false);
      } else {
        patch((current) => ({
          zoom: clamp(current.zoom * factor, 0.5, 5),
          rotate: clamp(current.rotate + angleDelta, -180, 180)
        }), false);
      }

      lastDistance.current = distance;
      lastAngle.current = angle;
    }
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
      setActiveGuides({ x: null, y: null });
      gestureStartDesign.current = null;
      gestureHistoryRecorded.current = false;
    }
  }

  function makeCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    renderCard(canvas.getContext('2d'), width, height, { original: false });
    return canvas;
  }

  async function recordExport(name, width, height, action) {
    const record = {
      id: makeId('export'),
      name,
      width,
      height,
      action,
      designName: design.backgroundLabel || 'Untitled Card',
      createdAt: Date.now()
    };
    await dbPut('exports', record).catch(() => {});
    setExportHistory((current) => [record, ...current].slice(0, 40));
  }

  function makePngFile(width, height, name) {
    // Keep file creation synchronous so iOS retains the user-activation
    // required by navigator.share().
    const dataUrl = makeCanvas(width, height).toDataURL('image/png');
    const blob = dataUrlToBlob(dataUrl);
    return new File([blob], name, { type: 'image/png' });
  }

  async function download(width, height, name) {
    const file = makePngFile(width, height, name);
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
    await recordExport(name, width, height, 'download');
    setMessage(name + ' saved to Files/downloads');
  }

  async function nativeExportPng(
    width = OUT_W,
    height = OUT_H,
    name = 'cardBackgroundCombined@3x.png'
  ) {
    if (!renderAssetsReady) {
      setMessage('Artwork is still loading. Export is available when every image is ready.');
      return;
    }

    const file = makePngFile(width, height, name);
    const canShareFile = Boolean(
      navigator.share &&
      (!navigator.canShare || navigator.canShare({ files: [file] }))
    );

    if (!canShareFile) {
      await download(width, height, name);
      setMessage('Native image sharing is unavailable, so the PNG was downloaded instead.');
      return;
    }

    try {
      setMessage('Opening the native image sheet… Choose “Save Image” to save it to Photos.');
      await navigator.share({ files: [file] });
      await recordExport(name, width, height, 'native-image-sheet');
      setMessage('Image sheet closed');
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setMessage('Could not open the native image sheet.');
      }
    }
  }

  async function share() {
    return nativeExportPng(OUT_W, OUT_H, 'cardBackgroundCombined@3x.png');
  }

  function dismissInstallHelp() {
    localStorage.setItem('aircard-install-dismissed-v2', '1');
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
    if (!(design.customLayers || []).some((layer) => layer.id === selectedElement)) {
      setSelectedElement('artwork');
    }
  }, [design.chip, design.contactless, design.customLayers, selectedElement]);

  const selectedImageLayer = selectedLayer?.type === 'image' ? selectedLayer : null;
  const activeImageSettings = selectedImageLayer
    ? { ...IMAGE_LAYER_DEFAULTS, ...(selectedImageLayer.adjustments || {}) }
    : design;
  const activeImageAvailable = selectedImageLayer
    ? Boolean(selectedImageLayer.src)
    : Boolean(design.background);
  const activeImageEditable = activeImageAvailable && !Boolean(selectedImageLayer?.locked);
  const activeImageLabel = selectedImageLayer
    ? (selectedImageLayer.name || 'Image Layer')
    : 'Artwork';

  const visualLayerStack = useMemo(() => {
    const custom = new Map((design.customLayers || []).map((layer) => [layer.id, layer]));
    return normalizeLayerOrder(design)
      .filter((id) => isLayerStackEntryVisible(design, id))
      .slice()
      .reverse()
      .map((id) => {
        if (id === 'builtin-chip') {
          return { id, name: 'EMV Chip', type: 'Built-in hardware', selection: 'chip', builtin: true };
        }
        if (id === 'builtin-contactless') {
          return { id, name: 'Contactless', type: 'Built-in hardware', selection: 'contactless', builtin: true };
        }
        if (id === 'builtin-text') {
          return { id, name: 'Card Text', type: 'Built-in text', selection: 'artwork', builtin: true };
        }
        const layer = custom.get(id);
        return layer
          ? { id, name: layer.name || layer.type, type: layer.type, selection: layer.id, builtin: false, locked: layer.locked }
          : null;
      })
      .filter(Boolean);
  }, [design]);

  const preview = (
    <section className={'previewShell editingPreview ' + (previewMode === 'physical' ? 'physicalPreview' : '')}>
      <div className="studioFloatingBar" aria-label="Studio history and comparison controls">
        <div className="historyButtons">
          <button type="button" onClick={undo} disabled={!undoRef.current.length} aria-label="Undo">↶</button>
          <button type="button" onClick={redo} disabled={!redoRef.current.length} aria-label="Redo">↷</button>
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
        <button
          type="button"
          className="beforeAfterButton"
          disabled={!activeImageAvailable || !renderAssetsReady}
          onPointerDown={() => setShowOriginal(true)}
          onPointerUp={() => setShowOriginal(false)}
          onPointerCancel={() => setShowOriginal(false)}
          onPointerLeave={() => setShowOriginal(false)}
        >
          {showOriginal ? 'After' : 'Before / After'}
        </button>
      </div>

      <div className={'cardFrame ' + (previewMode === 'physical' ? 'physicalCard' : '')}>
        <canvas
          ref={canvasRef}
          width={OUT_W}
          height={OUT_H}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
          aria-label="Editable card preview. Drag the selected element. Use two fingers to scale and rotate."
        />

        {tab === 'studio' && guidesEnabled ? (
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

        {tab === 'studio' && selectedElement === 'chip' && design.chip ? (
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

        {tab === 'studio' && selectedElement === 'contactless' && design.contactless ? (
          <div
            className="selectionOutline contactlessSelection"
            aria-hidden="true"
            style={{
              left: (design.contactlessX * 100) + '%',
              top: (design.contactlessY * 100) + '%',
              width: ((184 * Number(design.contactlessScale || 1) / OUT_W) * 100) + '%',
              height: ((184 * Number(design.contactlessScale || 1) / OUT_H) * 100) + '%',
              transform: 'translate(-50%, -50%) rotate(' + Number(design.contactlessRotation || 0) + 'deg)'
            }}
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
              height: ((188 * design.chipScale / OUT_H) * 100) + '%'
            }}
          />
        ) : null}

        {tab === 'studio' && selectedLayer ? (
          <div
            className="selectionOutline layerSelection"
            aria-hidden="true"
            style={customLayerSelectionStyle(selectedLayer, layerImages[selectedLayer.id])}
          />
        ) : null}
      </div>

      <div className="previewCaption" aria-live="polite">
        <span>{design.backgroundLabel}</span>
        <span>{message}</span>
      </div>
    </section>
  );

  return (
    <main className="studio">
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
          <div className="tabScreen discoverScreen">
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

            <div className="categoryScroller discoverCategories" role="tablist" aria-label="Card skin collection">
              {CUCU_CATEGORIES.map(([value, label]) => (
                <button
                  type="button"
                  role="tab"
                  key={value}
                  aria-selected={!query && cucuCategory === value}
                  className={!query && cucuCategory === value ? 'categoryChip selected' : 'categoryChip'}
                  onClick={() => {
                    setSearchInput('');
                    setQuery('');
                    if (value === cucuCategory && cucuPage > 0) return;
                    catalogIntentRef.current = value + '\u0000';
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

            <div className="discoverImportRow">
              <button type="button" className="secondaryAction uploadAction" onClick={() => uploadRef.current?.click()}>
                <IOSIcon name="photo" size={21} />
                <span>Import Photo or File</span>
              </button>
              <input ref={uploadRef} type="file" accept="image/*" hidden onChange={uploadImage} />
            </div>
          </div>
        )}

        {tab === 'studio' && (
          <div className="tabScreen studioScreen">
            <div className="studioModeRow">
              <div className="studioToolBar" role="tablist" aria-label="Studio tools">
                {STUDIO_TOOLS.map(([value, label]) => (
                  <button
                    type="button"
                    role="tab"
                    key={value}
                    aria-selected={studioTool === value}
                    className={studioTool === value ? 'active' : ''}
                    onClick={() => setStudioTool(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="previewModeToggle" role="group" aria-label="Preview style">
                <button type="button" className={previewMode === 'flat' ? 'active' : ''} onClick={() => setPreviewMode('flat')}>Flat</button>
                <button type="button" className={previewMode === 'physical' ? 'active' : ''} onClick={() => setPreviewMode('physical')}>Physical</button>
              </div>
            </div>

            {studioTool === 'crop' ? (
              <Group title={'CROP · ' + activeImageLabel}>
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
                        disabled={Boolean(selectedImageLayer.locked)}
                        value={selectedImageLayer.crop?.x || 0}
                        min={0}
                        max={0.48}
                        step={0.005}
                        formatValue={(value) => Math.round(value * 100) + '%'}
                        onChange={(value) => updateLayerCropEdge(selectedImageLayer.id, 'left', value)}
                      />
                      <SliderRow
                        label="Layer Crop Right"
                        disabled={Boolean(selectedImageLayer.locked)}
                        value={selectedImageLayer.crop ? Math.max(0, 1 - selectedImageLayer.crop.x - selectedImageLayer.crop.w) : 0}
                        min={0}
                        max={0.48}
                        step={0.005}
                        formatValue={(value) => Math.round(value * 100) + '%'}
                        onChange={(value) => updateLayerCropEdge(selectedImageLayer.id, 'right', value)}
                      />
                      <SliderRow
                        label="Layer Crop Top"
                        disabled={Boolean(selectedImageLayer.locked)}
                        value={selectedImageLayer.crop?.y || 0}
                        min={0}
                        max={0.48}
                        step={0.005}
                        formatValue={(value) => Math.round(value * 100) + '%'}
                        onChange={(value) => updateLayerCropEdge(selectedImageLayer.id, 'top', value)}
                      />
                      <SliderRow
                        label="Layer Crop Bottom"
                        disabled={Boolean(selectedImageLayer.locked)}
                        value={selectedImageLayer.crop ? Math.max(0, 1 - selectedImageLayer.crop.y - selectedImageLayer.crop.h) : 0}
                        min={0}
                        max={0.48}
                        step={0.005}
                        formatValue={(value) => Math.round(value * 100) + '%'}
                        onChange={(value) => updateLayerCropEdge(selectedImageLayer.id, 'bottom', value)}
                      />
                    </div>
                    <button
                      type="button"
                      className="settingsResetButton"
                      disabled={Boolean(selectedImageLayer.locked)}
                      onClick={() => updateLayer(selectedImageLayer.id, { crop: selectedImageLayer.originalCrop || null })}
                    >
                      Reset Layer Crop
                    </button>
                  </>
                ) : (
                  <>
                    <div className="groupRow segmentedRow">
                      <div className="segmentedControl compact" role="tablist" aria-label="Artwork fit">
                        <button type="button" role="tab" disabled={!design.background} aria-selected={design.fit === 'cover'} className={design.fit === 'cover' ? 'selected' : ''} onClick={() => patch({ fit: 'cover' })}>Fill</button>
                        <button type="button" role="tab" disabled={!design.background} aria-selected={design.fit === 'contain'} className={design.fit === 'contain' ? 'selected' : ''} onClick={() => patch({ fit: 'contain' })}>Fit</button>
                      </div>
                      <button type="button" className="iconTextButton" disabled={!design.background} onClick={() => patch({ flipX: !design.flipX })}>
                        <span>{design.flipX ? 'Unflip' : 'Flip'}</span>
                      </button>
                    </div>
                    <button type="button" className="actionRow" onClick={() => uploadRef.current?.click()}>
                      <span><strong>Replace Artwork</strong><small>Photos or Files</small></span>
                      <IOSIcon name="photo" size={19} />
                    </button>
                    <div className="cropControlBlock">
                      <SliderRow label="Crop Left" value={design.sourceCrop?.x || 0} min={0} max={0.48} step={0.005} disabled={!design.background} formatValue={(value) => Math.round(value * 100) + '%'} onChange={(value) => updateCropEdge('left', value)} />
                      <SliderRow label="Crop Right" value={design.sourceCrop ? Math.max(0, 1 - design.sourceCrop.x - design.sourceCrop.w) : 0} min={0} max={0.48} step={0.005} disabled={!design.background} formatValue={(value) => Math.round(value * 100) + '%'} onChange={(value) => updateCropEdge('right', value)} />
                      <SliderRow label="Crop Top" value={design.sourceCrop?.y || 0} min={0} max={0.48} step={0.005} disabled={!design.background} formatValue={(value) => Math.round(value * 100) + '%'} onChange={(value) => updateCropEdge('top', value)} />
                      <SliderRow label="Crop Bottom" value={design.sourceCrop ? Math.max(0, 1 - design.sourceCrop.y - design.sourceCrop.h) : 0} min={0} max={0.48} step={0.005} disabled={!design.background} formatValue={(value) => Math.round(value * 100) + '%'} onChange={(value) => updateCropEdge('bottom', value)} />
                    </div>
                    <button
                      type="button"
                      className="settingsResetButton"
                      disabled={!design.background}
                      onClick={() => patch({
                        sourceCrop: design.originalSourceCrop || null,
                        fit: 'cover',
                        zoom: design.originalSourceCrop ? 1 : 1.06,
                        x: 0,
                        y: 0,
                        rotate: 0,
                        flipX: false
                      })}
                    >
                      Reset Crop
                    </button>
                  </>
                )}
              </Group>
            ) : null}

            {studioTool === 'position' ? (
              <>
                <Group title={'POSITION · ' + (selectedLayer ? (selectedLayer.name || selectedLayer.type) : selectedElement === 'chip' ? 'EMV Chip' : selectedElement === 'contactless' ? 'Contactless' : 'Artwork')} footer="Tap an object on the card to select it. Drag to move. Two fingers scale and rotate.">
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
                        <div className="segmentedControl compact" role="tablist" aria-label="Artwork fit in Position">
                          <button type="button" role="tab" disabled={!design.background} aria-selected={design.fit === 'cover'} className={design.fit === 'cover' ? 'selected' : ''} onClick={() => patch({ fit: 'cover' })}>Fill</button>
                          <button type="button" role="tab" disabled={!design.background} aria-selected={design.fit === 'contain'} className={design.fit === 'contain' ? 'selected' : ''} onClick={() => patch({ fit: 'contain' })}>Fit</button>
                        </div>
                        <button type="button" className="iconTextButton" disabled={!design.background} onClick={() => patch({ flipX: !design.flipX })}>
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
                            <button type="button" className="iconTextButton" disabled={Boolean(selectedLayer.locked)} onClick={() => updateLayer(selectedLayer.id, { flipX: !selectedLayer.flipX })}>
                              <span>{selectedLayer.flipX ? 'Unflip Image' : 'Flip Image Horizontally'}</span>
                            </button>
                          </div>
                          <SliderRow label="Image Width" value={selectedLayer.width || 640} min={20} max={1800} step={1} disabled={Boolean(selectedLayer.locked)} onChange={(value) => updateLayer(selectedLayer.id, { width: value })} />
                        </>
                      ) : null}
                      <SliderRow label="Layer horizontal position" value={selectedLayer.x ?? 0.5} min={0} max={1} step={0.005} disabled={Boolean(selectedLayer.locked)} formatValue={(value) => Math.round(value * 100) + '%'} onChange={(value) => updateLayer(selectedLayer.id, { x: value })} />
                      <SliderRow label="Layer vertical position" value={selectedLayer.y ?? 0.5} min={0} max={1} step={0.005} disabled={Boolean(selectedLayer.locked)} formatValue={(value) => Math.round(value * 100) + '%'} onChange={(value) => updateLayer(selectedLayer.id, { y: value })} />
                      <SliderRow label="Layer scale" value={selectedLayer.scale || 1} min={0.1} max={6} step={0.01} disabled={Boolean(selectedLayer.locked)} formatValue={(value) => Math.round(value * 100) + '%'} onChange={(value) => updateLayer(selectedLayer.id, { scale: value })} />
                      <SliderRow label="Layer rotation" value={selectedLayer.rotation || 0} min={-180} max={180} step={1} suffix="°" disabled={Boolean(selectedLayer.locked)} onChange={(value) => updateLayer(selectedLayer.id, { rotation: value })} />
                      <button type="button" className="settingsResetButton" disabled={Boolean(selectedLayer.locked)} onClick={() => updateLayer(selectedLayer.id, { x: 0.5, y: 0.5, scale: 1, rotation: 0, flipX: false })}>Reset Layer Position</button>
                    </>
                  ) : null}

                  <SwitchRow label="Alignment Guides" detail="Bleed, rounded crop boundary, safe text, snap lines, chip/contactless zones" value={guidesEnabled} onChange={setGuidesEnabled} />
                </Group>

                {expertMode ? (
                  <Group title="EXPERT VALUES" footer="Exact numerical access to every global transform, adjustment, effect, and card-hardware parameter.">
                    <NumericField label="Zoom" value={design.zoom} min={0.5} max={5} onChange={(value) => patch({ zoom: value })} />
                    <NumericField label="Artwork X" value={design.x} min={-1.5} max={1.5} onChange={(value) => patch({ x: value })} />
                    <NumericField label="Artwork Y" value={design.y} min={-1.5} max={1.5} onChange={(value) => patch({ y: value })} />
                    <NumericField label="Artwork Rotation" value={design.rotate} min={-180} max={180} step={0.1} onChange={(value) => patch({ rotate: value })} suffix="°" />
                    <NumericField label="Crop Left" value={design.sourceCrop?.x || 0} min={0} max={0.48} onChange={(value) => updateCropEdge('left', value)} />
                    <NumericField label="Crop Right" value={design.sourceCrop ? Math.max(0, 1 - design.sourceCrop.x - design.sourceCrop.w) : 0} min={0} max={0.48} onChange={(value) => updateCropEdge('right', value)} />
                    <NumericField label="Crop Top" value={design.sourceCrop?.y || 0} min={0} max={0.48} onChange={(value) => updateCropEdge('top', value)} />
                    <NumericField label="Crop Bottom" value={design.sourceCrop ? Math.max(0, 1 - design.sourceCrop.y - design.sourceCrop.h) : 0} min={0} max={0.48} onChange={(value) => updateCropEdge('bottom', value)} />
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
              <>
                <div className="editingTargetBar">
                  <span>
                    <strong>Editing {activeImageLabel}</strong>
                    <small>{selectedImageLayer ? 'Imported image layer' : 'Card artwork'}</small>
                  </span>
                  {selectedImageLayer ? (
                    <button type="button" onClick={() => setSelectedElement('artwork')}>Back to Artwork</button>
                  ) : null}
                </div>

                <section className="presetSection">
                  <h3 className="sectionLabel">PRESETS</h3>
                  <div className="presetScroller">
                    {Object.keys(ADJUSTMENT_PRESETS).map((name) => (
                      <button type="button" key={name} disabled={!activeImageEditable} onClick={() => applyAdjustmentPreset(name)}>{name}</button>
                    ))}
                  </div>
                </section>

                <Group title={'IMAGE · ' + activeImageLabel}>
                  <SliderRow label="Exposure" value={activeImageSettings.exposure} min={-1} max={1} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({ exposure: value })} />
                  <SliderRow label="Brightness" value={activeImageSettings.brightness} min={0.4} max={1.7} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({ brightness: value })} />
                  <SliderRow label="Contrast" value={activeImageSettings.contrast} min={0.45} max={1.8} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({ contrast: value })} />
                  <SliderRow label="Saturation" value={activeImageSettings.saturation} min={0} max={2.4} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({ saturation: value })} />
                  <SliderRow label="Highlights" value={activeImageSettings.highlights} min={-1} max={1} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({ highlights: value })} />
                  <SliderRow label="Shadows" value={activeImageSettings.shadows} min={-1} max={1} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({ shadows: value })} />
                  <SliderRow label="Temperature" value={activeImageSettings.temperature} min={-1} max={1} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({ temperature: value })} />
                  <SliderRow label="Tint" value={activeImageSettings.tint} min={-1} max={1} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({ tint: value })} />
                  <SliderRow label="Sharpness" value={activeImageSettings.sharpness} min={-1} max={1} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({ sharpness: value })} />
                  <SliderRow label="Blur" value={activeImageSettings.blur} min={0} max={1} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({ blur: value })} />
                  <button type="button" className="settingsResetButton" disabled={!activeImageEditable} onClick={() => applyAdjustmentPreset('Original')}>Reset Adjustments</button>
                </Group>
              </>
            ) : null}

            {studioTool === 'effects' ? (
              <>
                <div className="editingTargetBar">
                  <span>
                    <strong>Editing {activeImageLabel}</strong>
                    <small>{selectedImageLayer ? 'Effects apply only to this imported layer' : 'Effects apply to card artwork'}</small>
                  </span>
                  {selectedImageLayer ? (
                    <button type="button" onClick={() => setSelectedElement('artwork')}>Back to Artwork</button>
                  ) : null}
                </div>

                <Group title={'EFFECTS · ' + activeImageLabel}>
                  <SliderRow label="Vignette intensity" value={activeImageSettings.vignette} min={0} max={0.8} step={0.01} disabled={!activeImageEditable} formatValue={(value) => Math.round(value * 100) + '%'} onChange={(value) => patchImageTarget({ vignette: value })} />
                  <SliderRow label="Grain" value={activeImageSettings.grain} min={0} max={0.22} step={0.005} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({ grain: value })} />
                  <SliderRow label="Gloss" value={activeImageSettings.gloss} min={0} max={0.8} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({ gloss: value })} />
                  <SliderRow label="Dark Overlay" value={activeImageSettings.overlay} min={0} max={0.75} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({ overlay: value })} />
                  <SliderRow label="Fade" value={activeImageSettings.fade} min={0} max={1} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({ fade: value })} />
                  <label className={'colorRow ' + (!activeImageEditable ? 'disabledRow' : '')}>
                    <span>Color Tint</span>
                    <input aria-label="Effect tint color" type="color" disabled={!activeImageEditable} value={activeImageSettings.effectTint || '#7b61ff'} onChange={(event) => patchImageTarget({ effectTint: event.target.value })} />
                  </label>
                  <SliderRow label="Tint Strength" value={activeImageSettings.effectTintStrength} min={0} max={1} step={0.01} disabled={!activeImageEditable} onChange={(value) => patchImageTarget({ effectTintStrength: value })} />
                  <button
                    type="button"
                    className="settingsResetButton"
                    disabled={!activeImageEditable}
                    onClick={() => patchImageTarget(
                      selectedImageLayer
                        ? { vignette: 0, grain: 0, gloss: 0, overlay: 0, fade: 0, effectTintStrength: 0 }
                        : { overlay: 0, vignette: 0, gloss: 0, grain: 0, fade: 0, effectTintStrength: 0 }
                    )}
                  >
                    Reset Effects
                  </button>
                </Group>
              </>
            ) : null}

            {studioTool === 'card' ? (
              <>
                <section className="presetSection">
                  <h3 className="sectionLabel">CARD PRESETS</h3>
                  <div className="presetScroller">
                    {Object.keys(CARD_PRESETS).map((name) => (
                      <button type="button" key={name} onClick={() => applyCardPreset(name)}>{name}</button>
                    ))}
                  </div>
                </section>

                <Group title="CARD HARDWARE">
                  <SwitchRow label="EMV Chip" detail="Tap the chip on the card to position it directly" value={design.chip} onChange={(value) => patch({ chip: value })} />
                  {design.chip ? (
                    <div className="nestedControls">
                      <div className="tonePicker" role="radiogroup" aria-label="Chip finish">
                        {['gold', 'silver', 'black', 'rose'].map((tone) => (
                          <button type="button" role="radio" aria-checked={design.chipTone === tone} key={tone} className={design.chipTone === tone ? 'selected' : ''} onClick={() => patch({ chipTone: tone })}>
                            <i className={'chipTone ' + tone} aria-hidden="true" />
                            <span>{tone[0].toUpperCase() + tone.slice(1)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <SwitchRow label="Contactless" detail="Tap the symbol on the card to position it directly" value={design.contactless} onChange={(value) => patch({ contactless: value })} />
                </Group>

                <Group title="CARD TEXT">
                  <SwitchRow label="Masked Number" value={design.number} onChange={(value) => patch({ number: value })} />
                  {design.number ? <input className="iosTextField" aria-label="Masked card number" value={design.numberText} onChange={(event) => patch({ numberText: event.target.value.slice(0, 32) })} /> : null}
                  <SwitchRow label="Card Holder" value={design.holder} onChange={(value) => patch({ holder: value })} />
                  {design.holder ? <input className="iosTextField" aria-label="Card holder" value={design.holderText} onChange={(event) => patch({ holderText: event.target.value.slice(0, 28) })} /> : null}
                  <SwitchRow label="Expiry" value={design.expiry} onChange={(value) => patch({ expiry: value })} />
                  {design.expiry ? <input className="iosTextField" aria-label="Expiry date" value={design.expiryText} onChange={(event) => patch({ expiryText: event.target.value.slice(0, 8) })} /> : null}
                  <SwitchRow label="Top Badge" value={design.badge} onChange={(value) => patch({ badge: value })} />
                  {design.badge ? <input className="iosTextField" aria-label="Top badge text" value={design.badgeText} onChange={(event) => patch({ badgeText: event.target.value.slice(0, 18) })} /> : null}
                  <label className="colorRow">
                    <span>Text Color</span>
                    <input aria-label="Text color" type="color" value={design.textColor} onChange={(event) => patch({ textColor: event.target.value })} />
                  </label>
                </Group>

<Group title="CUSTOM LAYERS" footer="Image, text, and shape layers are embedded into the final AirCard PNG.">
                  <div className="layerAddRow">
                    <button type="button" onClick={addTextLayer}>+ Text</button>
                    <button type="button" onClick={() => layerUploadRef.current?.click()}>+ Image / Logo</button>
                    <button type="button" onClick={addShapeLayer}>+ Shape</button>
                    <button type="button" onClick={addChipLayer}>+ Chip</button>
                    <button type="button" onClick={addContactlessLayer}>+ Contactless</button>
                  </div>
                  <input ref={layerUploadRef} type="file" accept="image/*" hidden onChange={uploadLayerImage} />

                  <button
                    type="button"
                    className={'layerRow artworkLayerRow ' + (selectedElement === 'artwork' ? 'selected' : '')}
                    onClick={() => {
                      setSelectedElement('artwork');
                      setMessage('Artwork selected');
                    }}
                  >
                    <span><strong>Artwork</strong><small>background · bottom</small></span>
                    <span>{selectedElement === 'artwork' ? 'Selected' : 'Edit'}</span>
                  </button>

                  <div className="layerStackHeader">
                    <span>Layer Stack</span>
                    <small>Top → Bottom</small>
                  </div>

                  {visualLayerStack.map((entry, index) => (
                    <button
                      type="button"
                      key={entry.id}
                      className={'layerRow ' + (selectedElement === entry.selection ? 'selected' : '')}
                      onClick={() => {
                        if (!entry.builtin && selectedElement === entry.selection) {
                          setSelectedElement('artwork');
                          setMessage('Artwork selected');
                          return;
                        }
                        setSelectedElement(entry.selection);
                        setMessage(entry.name + ' selected');
                      }}
                    >
                      <span>
                        <strong>{entry.name}</strong>
                        <small>{entry.type}{index === 0 ? ' · top' : ''}</small>
                      </span>
                      <span>
                        {entry.locked ? 'Locked' : selectedElement === entry.selection ? 'Selected' : entry.builtin ? 'Built-in' : 'Edit'}
                      </span>
                    </button>
                  ))}
                </Group>

                {selectedLayer ? (
                  <Group title="SELECTED LAYER">
                    <button
                      type="button"
                      className="doneLayerButton"
                      onClick={() => {
                        setSelectedElement('artwork');
                        setMessage('Artwork selected');
                      }}
                    >
                      Done Editing Layer
                    </button>
                    {selectedLayer.locked ? (
                      <div className="lockedLayerNotice" role="status">Locked · unlock this layer to edit its content or transform.</div>
                    ) : null}
                    <fieldset className="layerEditorFieldset" disabled={Boolean(selectedLayer.locked)}>
                    {selectedLayer.type === 'text' ? (
                      <>
                        <input className="iosTextField" aria-label="Layer text" value={selectedLayer.text ?? ''} onChange={(event) => updateLayer(selectedLayer.id, { text: event.target.value })} />
                        <label className="selectRow">
                          <span>Font</span>
                          <select aria-label="Text layer font" value={selectedLayer.fontFamily || 'system'} onChange={(event) => updateLayer(selectedLayer.id, { fontFamily: event.target.value })}>
                            <option value="system">System</option>
                            <option value="rounded">Rounded</option>
                            <option value="serif">Serif</option>
                            <option value="mono">Monospace</option>
                          </select>
                        </label>
                        <div className="textAlignRow" role="group" aria-label="Text alignment">
                          {['left', 'center', 'right'].map((align) => (
                            <button type="button" key={align} className={(selectedLayer.align || 'center') === align ? 'selected' : ''} onClick={() => updateLayer(selectedLayer.id, { align })}>
                              {align[0].toUpperCase() + align.slice(1)}
                            </button>
                          ))}
                        </div>
                        <SliderRow label="Font Size" value={selectedLayer.fontSize || 58} min={10} max={240} step={1} onChange={(value) => updateLayer(selectedLayer.id, { fontSize: value })} />
                        <SliderRow label="Weight" value={selectedLayer.weight || 700} min={100} max={900} step={100} onChange={(value) => updateLayer(selectedLayer.id, { weight: value })} />
                        <SliderRow label="Letter Spacing" value={selectedLayer.letterSpacing || 0} min={-4} max={30} step={1} onChange={(value) => updateLayer(selectedLayer.id, { letterSpacing: value })} />
                        <label className="colorRow"><span>Color</span><input type="color" value={selectedLayer.color || '#ffffff'} onChange={(event) => updateLayer(selectedLayer.id, { color: event.target.value })} /></label>
                        <SwitchRow label="Text Shadow" value={Boolean(selectedLayer.shadow)} onChange={(value) => updateLayer(selectedLayer.id, { shadow: value })} />
                      </>
                    ) : null}
                    {selectedLayer.type === 'shape' ? (
                      <>
                        <div className="segmentedControl compact">
                          <button type="button" className={selectedLayer.shape !== 'ellipse' ? 'selected' : ''} onClick={() => updateLayer(selectedLayer.id, { shape: 'rectangle' })}>Rectangle</button>
                          <button type="button" className={selectedLayer.shape === 'ellipse' ? 'selected' : ''} onClick={() => updateLayer(selectedLayer.id, { shape: 'ellipse' })}>Ellipse</button>
                        </div>
                        <SliderRow label="Width" value={selectedLayer.width || 280} min={20} max={1200} step={1} onChange={(value) => updateLayer(selectedLayer.id, { width: value })} />
                        <SliderRow label="Height" value={selectedLayer.height || 120} min={20} max={800} step={1} onChange={(value) => updateLayer(selectedLayer.id, { height: value })} />
                        {selectedLayer.shape !== 'ellipse' ? (
                          <SliderRow
                            label="Corner Radius"
                            value={selectedLayer.radius ?? 28}
                            min={0}
                            max={Math.max(0, Math.floor(Math.min(Number(selectedLayer.width || 280), Number(selectedLayer.height || 120)) / 2))}
                            step={1}
                            onChange={(value) => updateLayer(selectedLayer.id, { radius: value })}
                          />
                        ) : null}
                        <label className="colorRow"><span>Color</span><input type="color" value={selectedLayer.color || '#ffffff'} onChange={(event) => updateLayer(selectedLayer.id, { color: event.target.value })} /></label>
                      </>
                    ) : null}
                    {selectedLayer.type === 'image' ? (
                      <SliderRow label="Image Width" value={selectedLayer.width || 640} min={20} max={1800} step={1} onChange={(value) => updateLayer(selectedLayer.id, { width: value })} />
                    ) : null}
                    {selectedLayer.type === 'chip' ? (
                      <div className="tonePicker" role="radiogroup" aria-label="Custom chip finish">
                        {['gold', 'silver', 'black', 'rose'].map((tone) => (
                          <button type="button" role="radio" aria-checked={(selectedLayer.tone || 'gold') === tone} key={tone} className={(selectedLayer.tone || 'gold') === tone ? 'selected' : ''} onClick={() => updateLayer(selectedLayer.id, { tone })}>
                            <i className={'chipTone ' + tone} aria-hidden="true" />
                            <span>{tone[0].toUpperCase() + tone.slice(1)}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {selectedLayer.type === 'contactless' ? (
                      <label className="colorRow"><span>Contactless Color</span><input type="color" value={selectedLayer.color || '#ffffff'} onChange={(event) => updateLayer(selectedLayer.id, { color: event.target.value })} /></label>
                    ) : null}
                    <SliderRow label="Layer X" value={selectedLayer.x ?? 0.5} min={0} max={1} step={0.005} onChange={(value) => updateLayer(selectedLayer.id, { x: value })} />
                    <SliderRow label="Layer Y" value={selectedLayer.y ?? 0.5} min={0} max={1} step={0.005} onChange={(value) => updateLayer(selectedLayer.id, { y: value })} />
                    <SliderRow label="Layer Scale" value={selectedLayer.scale || 1} min={0.1} max={6} step={0.01} onChange={(value) => updateLayer(selectedLayer.id, { scale: value })} />
                    <SliderRow label="Layer Rotation" value={selectedLayer.rotation || 0} min={-180} max={180} step={1} suffix="°" onChange={(value) => updateLayer(selectedLayer.id, { rotation: value })} />
                    <SliderRow label="Opacity" value={selectedLayer.opacity ?? 1} min={0} max={1} step={0.01} onChange={(value) => updateLayer(selectedLayer.id, { opacity: value })} />
                    {expertMode ? (
                      <div className="layerExpertValues">
                        <NumericField label="Exact Layer X" value={selectedLayer.x ?? 0.5} min={0} max={1} onChange={(value) => updateLayer(selectedLayer.id, { x: value })} />
                        <NumericField label="Exact Layer Y" value={selectedLayer.y ?? 0.5} min={0} max={1} onChange={(value) => updateLayer(selectedLayer.id, { y: value })} />
                        <NumericField label="Exact Layer Scale" value={selectedLayer.scale || 1} min={0.1} max={6} onChange={(value) => updateLayer(selectedLayer.id, { scale: value })} />
                        <NumericField label="Exact Layer Rotation" value={selectedLayer.rotation || 0} min={-180} max={180} step={0.1} onChange={(value) => updateLayer(selectedLayer.id, { rotation: value })} suffix="°" />
                        <NumericField label="Exact Layer Opacity" value={selectedLayer.opacity ?? 1} min={0} max={1} onChange={(value) => updateLayer(selectedLayer.id, { opacity: value })} />
                        {selectedLayer.type === 'text' ? (
                          <>
                            <NumericField label="Exact Font Size" value={selectedLayer.fontSize || 58} min={10} max={240} step={1} onChange={(value) => updateLayer(selectedLayer.id, { fontSize: value })} />
                            <NumericField label="Exact Font Weight" value={selectedLayer.weight || 700} min={100} max={900} step={100} onChange={(value) => updateLayer(selectedLayer.id, { weight: value })} />
                            <NumericField label="Exact Letter Spacing" value={selectedLayer.letterSpacing || 0} min={-4} max={30} step={0.1} onChange={(value) => updateLayer(selectedLayer.id, { letterSpacing: value })} />
                          </>
                        ) : null}
                        {selectedLayer.type === 'shape' ? (
                          <>
                            <NumericField label="Exact Shape Width" value={selectedLayer.width || 280} min={20} max={1200} step={1} onChange={(value) => updateLayer(selectedLayer.id, { width: value })} />
                            <NumericField label="Exact Shape Height" value={selectedLayer.height || 120} min={20} max={800} step={1} onChange={(value) => updateLayer(selectedLayer.id, { height: value })} />
                            {selectedLayer.shape !== 'ellipse' ? (
                              <NumericField
                                label="Exact Corner Radius"
                                value={selectedLayer.radius ?? 28}
                                min={0}
                                max={Math.max(0, Math.min(Number(selectedLayer.width || 280), Number(selectedLayer.height || 120)) / 2)}
                                step={1}
                                onChange={(value) => updateLayer(selectedLayer.id, { radius: value })}
                              />
                            ) : null}
                          </>
                        ) : null}
                        {selectedLayer.type === 'image' ? (
                          <NumericField label="Exact Image Width" value={selectedLayer.width || 640} min={20} max={1800} step={1} onChange={(value) => updateLayer(selectedLayer.id, { width: value })} />
                        ) : null}
                      </div>
                    ) : null}
                    </fieldset>
                    <SwitchRow label="Lock Layer" value={Boolean(selectedLayer.locked)} onChange={(value) => updateLayer(selectedLayer.id, { locked: value })} />
                    <div className="layerActionGrid">
                      <button type="button" onClick={() => moveLayer(selectedLayer.id, 1)}>Bring Forward</button>
                      <button type="button" onClick={() => moveLayer(selectedLayer.id, -1)}>Send Back</button>
                      <button type="button" onClick={() => duplicateLayer(selectedLayer.id)}>Duplicate</button>
                      <button type="button" className="destructive" onClick={() => deleteLayer(selectedLayer.id)}>Delete</button>
                    </div>
                  </Group>
                ) : null}
              </>
            ) : null}
          </div>
        )}

        {tab === 'library' && (
          <div className="tabScreen libraryScreen">
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
                  onChange={(event) => setProjectName(event.target.value.slice(0, 60))}
                />
                <button
                  type="button"
                  className="primaryAction librarySaveButton"
                  onClick={async () => {
                    await saveProject(projectName);
                    setProjectName('');
                  }}
                >
                  Save Current Design
                </button>
              </div>
              {projects.length ? (
                <div className="projectGrid">
                  {projects.map((project) => (
                    <article className="projectCard" key={project.id}>
                      {project.preview ? <img src={project.preview} alt="" /> : <div className="projectPlaceholder" />}
                      <strong>{project.name}</strong>
                      <small>{new Date(project.updatedAt || project.createdAt).toLocaleDateString()}</small>
                      <div className="projectActions">
                        <button type="button" onClick={() => openProject(project)}>Open</button>
                        <button type="button" onClick={() => duplicateProject(project)}>Duplicate</button>
                        <button type="button" className="destructive" onClick={() => removeProject(project)}>Delete</button>
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
                      onClick={() => {
                        patch({ background: 'idb://imports/' + asset.id, backgroundLabel: asset.name, sourceCrop: null, originalSourceCrop: null, zoom: 1, x: 0, y: 0, rotate: 0 });
                        setTab('studio');
                        setStudioTool('crop');
                      }}
                    >
                      <span><strong>{asset.name}</strong><small>{asset.type || 'image'}</small></span>
                      <IOSIcon name="chevron" size={17} />
                    </button>
                  ))}
                </div>
              ) : <div className="stateCard"><span>Photos and image files you import will appear here.</span></div>}
            </section>

            <Group title="DESIGN PRESETS">
              <button type="button" className="actionRow" onClick={exportPresetJson}>
                <span><strong>Export Design JSON</strong><small>Share the full editable design state</small></span>
                <IOSIcon name="export" size={18} />
              </button>
              <button type="button" className="actionRow" onClick={() => presetImportRef.current?.click()}>
                <span><strong>Import Design JSON</strong><small>Restore a shared AirCard preset</small></span>
                <IOSIcon name="chevron" size={17} />
              </button>
              <input ref={presetImportRef} type="file" accept=".json,application/json" hidden onChange={importPresetJson} />
            </Group>

            <Group title="ADVANCED">
              <SwitchRow label="Expert Mode" detail="Show precise numeric editing controls" value={expertMode} onChange={setExpertMode} />
              <button type="button" className="actionRow" onClick={() => setInstallHelp(true)}>
                <span><strong>Install Card Studio</strong><small>Add the PWA to your iPhone Home Screen</small></span>
                <IOSIcon name="chevron" size={17} />
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
          <div className="tabScreen exportScreen">
            <section className="exportCard" aria-label="Card export details">
              <div className="exportGlyph"><IOSIcon name="export" size={30} /></div>
              <h2>Ready to Export</h2>
              <p>Preview the finished card, then open the native image sheet for either output size.</p>
              <div className="exportSpec">
                <span>1536 × 969</span>
                <code>cardBackgroundCombined@3x.png</code>
              </div>
            </section>

            <button type="button" className="secondaryAction bigAction" disabled={!renderAssetsReady} onClick={() => setShowExportPreview(true)}>
              <span>Full-Screen Preview</span>
            </button>

            <button
              type="button"
              className="primaryAction bigAction"
              disabled={!renderAssetsReady}
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
                disabled={!renderAssetsReady}
                onClick={() => nativeExportPng(OUT_W, OUT_H, 'cardBackgroundCombined@3x.png')}
              >
                <span><strong>Save 3× Image</strong><small>1536 × 969 · highest quality</small></span>
                <IOSIcon name="photo" size={19} />
              </button>
              <button
                type="button"
                className="actionRow"
                disabled={!renderAssetsReady}
                onClick={() => nativeExportPng(1024, 646, 'cardBackgroundCombined@2x.png')}
              >
                <span><strong>Save 2× Image</strong><small>1024 × 646</small></span>
                <IOSIcon name="photo" size={19} />
              </button>
              <button
                type="button"
                className="actionRow"
                disabled={!renderAssetsReady}
                onClick={() => nativeExportPng(OUT_W, OUT_H, 'cardBackgroundCombined@3x.png')}
              >
                <span><strong>Share 3× PNG</strong><small>Photos, AirDrop, Messages, apps, and more</small></span>
                <IOSIcon name="export" size={18} />
              </button>
            </Group>

            <button type="button" className="secondaryAction bigAction" onClick={() => saveProject()}>Save Design to Library</button>

            <p className="legalNote">Artwork rights remain with their respective owners. Card-skin media is screened in-app for usable card artwork before export.</p>
          </div>
        )}
      </div>

      <nav className="tabBar" role="tablist" aria-label="Card Studio sections">
        {TAB_ITEMS.map(([value, label]) => (
          <button
            type="button"
            key={value}
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? 'active' : ''}
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
              useArtwork(menuItem);
              setShowExportPreview(true);
            }}
          >
            Preview
          </button>
          <button type="button" className="primaryAction" onClick={() => useArtwork(menuItem)}>Use Skin</button>
          <button type="button" className="secondaryAction" onClick={() => toggleFavorite(menuItem)}>
            {favoriteIds.has(menuItem.id) ? 'Remove Favorite' : 'Add to Favorites'}
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
            onClick={() => nativeExportPng(OUT_W, OUT_H, 'cardBackgroundCombined@3x.png')}
          >
            Save / Share 3× Image
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
  );
}
