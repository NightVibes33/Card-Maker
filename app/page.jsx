'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  gradient: 0,
  fit: 'cover',
  zoom: 1,
  x: 0,
  y: 0,
  rotate: 0,
  brightness: 1,
  saturation: 1,
  contrast: 1,
  blur: 0,
  vignette: 0.24,
  grain: 0.035,
  gloss: 0.2,
  overlay: 0.1,
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
  number: false,
  numberText: '••••  ••••  ••••  4242',
  holder: false,
  holderText: 'CARD HOLDER',
  expiry: false,
  expiryText: '12/29',
  badge: false,
  badgeText: 'CARD',
  textColor: '#ffffff',
  shadow: true
};

const TAB_ITEMS = [
  ['browse', 'Browse'],
  ['edit', 'Edit'],
  ['layers', 'Layers'],
  ['export', 'Export']
];

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
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

  if (name === 'browse') {
    return <svg {...common}><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.3 15.3 4.7 4.7"/></svg>;
  }
  if (name === 'edit') {
    return <svg {...common}><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/><path d="M4 12h4M12 12h8"/><circle cx="10" cy="12" r="2"/></svg>;
  }
  if (name === 'layers') {
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

function drawContactless(ctx, d) {
  const x = d.contactlessX * OUT_W;
  const y = d.contactlessY * OUT_H;
  const scale = d.contactlessScale;
  ctx.save();
  ctx.translate(x, y);
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

function SliderRow({ label, value, min, max, step, onChange, suffix = '', disabled = false }) {
  const decimals = step >= 1 ? 0 : step < 0.01 ? 3 : 2;
  const emit = (event) => {
    const next = clamp(Number(event.currentTarget.value), Number(min), Number(max));
    if (Number.isFinite(next)) onChange(next);
  };

  return (
    <label className={'sliderRow ' + (disabled ? 'isDisabled' : '')}>
      <div className="rowHeader">
        <span>{label}</span>
        <span className="rowValue">{Number(value).toFixed(decimals)}{suffix}</span>
      </div>
      <input
        aria-label={label}
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onInput={emit}
        onChange={emit}
      />
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

function ArtworkRail({ title, items, onPick }) {
  if (!items.length) return null;
  return (
    <section className="browseSection">
      <div className="browseHeading">
        <h2>{title}</h2>
        <span>{items.length} card skins</span>
      </div>
      <div className="artRail cardSkinRail" role="list">
        {items.map((item) => (
          <article className="artSkinItem" role="listitem" key={item.id}>
            <button
              type="button"
              className="artSkinPreview"
              onClick={() => onPick(item)}
              aria-label={'Use premade card skin ' + item.title}
            >
              <CatalogArtwork item={item} alt={item.mediaAlt || item.title} />
            </button>
            <div className="artSkinMeta">
              <div>
                <strong>{item.title}</strong>
                <small>{item.source || item.subtitle}</small>
              </div>

            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function CatalogArtwork({ item, alt }) {
  const crop = item?.sourceCrop;

  if (crop && crop.w > 0 && crop.h > 0) {
    return (
      <img
        className="croppedCatalogImage"
        src={item.image}
        alt={alt}
        loading="lazy"
        style={{
          width: (100 / crop.w) + '%',
          height: (100 / crop.h) + '%',
          left: (-100 * crop.x / crop.w) + '%',
          top: (-100 * crop.y / crop.h) + '%'
        }}
      />
    );
  }

  return <img src={item.image} alt={alt} loading="lazy" />;
}

function StoreCatalog({
  storeName,
  categoryLabel,
  items,
  total,
  loading,
  hasMore,
  onPick,
  onLoadMore
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

      {items.length ? (
        <div className="storeCatalogGrid" role="list">
          {items.map((item) => (
            <article className="storeCatalogItem" role="listitem" key={item.id}>
              <button
                type="button"
                className="storeCatalogPreview"
                onClick={() => onPick(item)}
                aria-label={'Use ' + item.title}
              >
                <CatalogArtwork item={item} alt={item.mediaAlt || item.title} />
              </button>
              <div className="storeCatalogMeta">
                <strong>{item.title}</strong>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="catalogEmpty">
          {loading ? <span className="spinner" aria-hidden="true" /> : null}
          <span>{loading ? 'Loading card skins…' : 'No usable card skins loaded yet.'}</span>
        </div>
      )}

      {hasMore ? (
        <button
          type="button"
          className="secondaryAction catalogLoadMore"
          disabled={loading}
          onClick={onLoadMore}
        >
          {loading ? <span className="spinner" aria-hidden="true" /> : null}
          <span>{loading ? 'Loading' : 'Load More'}</span>
        </button>
      ) : null}
    </section>
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
  const candidates = [...new Set([item.image, ...(item.candidateImages || [])].filter(Boolean))].slice(0, 8);
  const preferDirectAsset =
    item.assetMode === 'direct-card-art' ||
    item.assetMode === 'resolved-product-art';
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

      // A strong full-bleed candidate is good enough; avoid downloading every
      // gallery image on mobile when the first useful one is already clean.
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

async function prepareSearchResults(items) {
  return (await prepareCleanResults(items, 18)).slice(0, 12);
}

function isPersistableBackground(src = '') {
  return (
    src.startsWith('/api/image?') ||
    src.startsWith('/api/blitz-image?')
  );
}

export default function Page() {
  const [tab, setTab] = useState('browse');
  const [design, setDesign] = useState(DEFAULTS);
  const [image, setImage] = useState(null);
  const [kind, setKind] = useState('cucu');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [recent, setRecent] = useState([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('Ready');
  const [source, setSource] = useState('');
  const [cucuCategory, setCucuCategory] = useState('all');
  const [cucuCategoryLabel, setCucuCategoryLabel] = useState('All Card Skins');
  const [cucuItems, setCucuItems] = useState([]);
  const [cucuPage, setCucuPage] = useState(0);
  const [cucuTotal, setCucuTotal] = useState(2225);
  const [cucuHasMore, setCucuHasMore] = useState(true);
  const [cucuLoading, setCucuLoading] = useState(false);
  const [blitzItems, setBlitzItems] = useState([]);
  const [blitzPage, setBlitzPage] = useState(0);
  const [blitzTotal, setBlitzTotal] = useState(0);
  const [blitzHasMore, setBlitzHasMore] = useState(true);
  const [blitzLoading, setBlitzLoading] = useState(false);
  const canvasRef = useRef(null);
  const uploadRef = useRef(null);
  const pointers = useRef(new Map());
  const lastPoint = useRef(null);
  const lastDistance = useRef(null);

  const gradient = useMemo(
    () => GRADIENTS.find((item) => item.id === design.gradient) || GRADIENTS[0],
    [design.gradient]
  );

  const patch = useCallback((next) => {
    setDesign((current) => {
      const delta = typeof next === 'function' ? next(current) : next;
      return { ...current, ...delta };
    });
  }, []);

  const rememberArtwork = useCallback((item) => {
    setRecent((current) => {
      const next = [item, ...current.filter((entry) => entry.id !== item.id)].slice(0, 10);
      try {
        localStorage.setItem('aircard-recent-artwork-v1', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('aircard-sticker-fvp-v3');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          parsed.background = parsed.background && isPersistableBackground(parsed.background) ? parsed.background : '';
          setDesign((current) => ({ ...current, ...parsed }));
        }
      }
      const storedRecent = JSON.parse(localStorage.getItem('aircard-recent-artwork-v1') || '[]');
      if (Array.isArray(storedRecent)) {
        // Drop old pre-filter entries so stale storefront mockups do not keep
        // reappearing in Recent after the cleaner search pipeline ships.
        setRecent(storedRecent.filter((item) => item?.visualQuality === 'client-checked').slice(0, 10));
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const copy = { ...design };
      if (copy.background && !isPersistableBackground(copy.background)) copy.background = '';
      localStorage.setItem('aircard-sticker-fvp-v3', JSON.stringify(copy));
    } catch {}
  }, [design]);

  useEffect(() => {
    if (!design.background) {
      setImage(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      setImage(img);
      setMessage('Artwork loaded');
    };
    img.onerror = () => {
      setImage(null);
      setMessage('Artwork could not load');
    };
    img.src = design.background;
  }, [design.background]);

  const renderCard = useCallback((ctx, width, height) => {
    if (!ctx) return;
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

      ctx.save();
      ctx.translate(x + iw / 2, y + ih / 2);
      ctx.rotate((design.rotate * Math.PI) / 180);
      ctx.filter =
        'brightness(' + design.brightness + ')' +
        ' saturate(' + design.saturation + ')' +
        ' contrast(' + design.contrast + ')' +
        ' blur(' + design.blur * 7 + 'px)';
      ctx.drawImage(image, sx, sy, sw, sh, -iw / 2, -ih / 2, iw, ih);
      ctx.restore();
      ctx.filter = 'none';
    }

    if (design.overlay > 0) {
      const overlay = ctx.createLinearGradient(0, 0, OUT_W, OUT_H);
      overlay.addColorStop(0, 'rgba(0,0,0,' + design.overlay * 0.55 + ')');
      overlay.addColorStop(0.55, 'rgba(0,0,0,0)');
      overlay.addColorStop(1, 'rgba(0,0,0,' + design.overlay + ')');
      ctx.fillStyle = overlay;
      ctx.fillRect(0, 0, OUT_W, OUT_H);
    }

    if (design.vignette > 0) {
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

    if (design.gloss > 0) {
      const gloss = ctx.createLinearGradient(0, 0, OUT_W, OUT_H);
      gloss.addColorStop(0, 'rgba(255,255,255,' + design.gloss * 0.42 + ')');
      gloss.addColorStop(0.22, 'rgba(255,255,255,' + design.gloss * 0.08 + ')');
      gloss.addColorStop(0.5, 'rgba(255,255,255,0)');
      ctx.fillStyle = gloss;
      ctx.fillRect(0, 0, OUT_W, OUT_H);
    }

    if (design.grain > 0) {
      ctx.globalAlpha = design.grain;
      for (let i = 0; i < 3600; i += 1) {
        ctx.fillStyle = i % 3 ? '#000' : '#fff';
        ctx.fillRect((i * 331) % OUT_W, (i * 197) % OUT_H, 2, 2);
      }
      ctx.globalAlpha = 1;
    }

    if (design.chip) drawChip(ctx, design);
    if (design.contactless) drawContactless(ctx, design);

    ctx.fillStyle = design.textColor;
    ctx.shadowColor = design.shadow ? 'rgba(0,0,0,.55)' : 'transparent';
    ctx.shadowBlur = design.shadow ? 16 : 0;

    if (design.badge) {
      ctx.textAlign = 'right';
      ctx.font = '800 66px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(design.badgeText || 'CARD', OUT_W - 105, 130);
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
  }, [design, gradient, image]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderCard(canvas.getContext('2d'), OUT_W, OUT_H);
  }, [renderCard]);

  const runSearch = useCallback(async (searchQuery, searchKind, autoPick = false) => {
    const clean = (searchQuery ?? query).trim();
    const activeKind = searchKind ?? kind;
    if (clean.length < 2 || searching) return;

    setSearching(true);
    setMessage('Searching…');
    setSource('');

    try {
      const response = await fetch(
        '/api/search?q=' + encodeURIComponent(clean) + '&kind=' + encodeURIComponent(activeKind),
        { cache: 'no-store' }
      );
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Search failed');

      const rawList = Array.isArray(json.results) ? json.results : [];
      setSource(json.source || '');

      if (!rawList.length) {
        setResults([]);
        setMessage('No premade card skins found');
        return;
      }

      setMessage('Checking flat artwork…');
      const list = await prepareSearchResults(rawList);
      setResults(list);
      setMessage(
        list.length
          ? list.length + ' clean card skins'
          : 'No clean flat artwork found for this search'
      );

      if (autoPick && list[0]) {
        const first = list[0];
        patch({
          background: first.image,
          backgroundLabel: first.title,
          sourceCrop: first.sourceCrop || null,
          // Slight overscan removes tiny storefront edge artifacts and makes
          // wide artwork sit naturally inside the AirCard aspect ratio.
          zoom: first.sourceCrop ? 1 : 1.06,
          x: 0,
          y: 0,
          rotate: 0,
          fit: 'cover'
        });
        rememberArtwork(first);
        setMessage(first.title + ' selected');
      }
    } catch (error) {
      setResults([]);
      setMessage(error?.message || 'Search failed');
    } finally {
      setSearching(false);
    }
  }, [kind, patch, query, rememberArtwork, searching]);

  const loadCucu = useCallback(async (nextPage = 1, replace = false, category = cucuCategory) => {
    if (cucuLoading) return;

    setCucuLoading(true);
    setMessage('Loading CUCU Covers…');

    try {
      const response = await fetch(
        '/api/cucu?category=' + encodeURIComponent(category) + '&page=' + encodeURIComponent(nextPage) + '&limit=24'
      );
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'CUCU catalog failed');

      const rawList = Array.isArray(json.results) ? json.results : [];
      setCucuTotal(Number(json.total) || 0);
      setCucuHasMore(Boolean(json.hasMore));
      setCucuCategoryLabel(json.categoryLabel || CUCU_CATEGORIES.find(([key]) => key === category)?.[1] || 'Card Skins');

      setMessage('Checking CUCU artwork…');
      const cleanList = await prepareCleanResults(rawList);

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
          ? cleanList.length + ' CUCU covers loaded'
          : 'This CUCU page had no clean flat previews'
      );
    } catch (error) {
      setMessage(error?.message || 'CUCU catalog failed');
    } finally {
      setCucuLoading(false);
    }
  }, [cucuCategory, cucuLoading]);

  const loadBlitz = useCallback(async (nextPage = 1, replace = false) => {
    if (blitzLoading) return;

    setBlitzLoading(true);
    setMessage('Loading Blitz Covers…');

    try {
      const response = await fetch(
        '/api/blitz?page=' + encodeURIComponent(nextPage) + '&limit=24'
      );
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Blitz catalog failed');

      const rawList = Array.isArray(json.results) ? json.results : [];
      setBlitzTotal(Number(json.total) || 0);
      setBlitzHasMore(Boolean(json.hasMore));

      setMessage('Extracting Blitz card artwork…');
      const cleanList = await prepareCleanResults(rawList);

      setBlitzItems((current) => {
        const base = replace ? [] : current;
        const merged = [...base, ...cleanList];
        const seen = new Set();
        return merged.filter((item) => {
          if (!item?.id || seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });
      });

      setBlitzPage(nextPage);
      setMessage(
        cleanList.length
          ? cleanList.length + ' Blitz card covers loaded'
          : 'This Blitz page had no usable card-art assets'
      );
    } catch (error) {
      setMessage(error?.message || 'Blitz catalog failed');
    } finally {
      setBlitzLoading(false);
    }
  }, [blitzLoading]);

  useEffect(() => {
    if (kind === 'cucu' && cucuPage === 0 && !cucuLoading) {
      loadCucu(1, true, cucuCategory);
    }
    if (kind === 'blitz' && blitzPage === 0 && !blitzLoading) {
      loadBlitz(1, true);
    }
  }, [kind, cucuCategory, cucuPage, cucuLoading, blitzPage, blitzLoading, loadCucu, loadBlitz]);

  function useArtwork(item) {
    patch({
      background: item.image,
      backgroundLabel: item.title,
      sourceCrop: item.sourceCrop || null,
      zoom: item.sourceCrop ? 1 : 1.06,
      x: 0,
      y: 0,
      rotate: 0,
      fit: 'cover'
    });
    rememberArtwork(item);
    setMessage(item.title + ' selected · auto-cropped');
  }

  async function useQuickPick(item) {
    setKind(item.kind);
    setQuery(item.query);
    await runSearch(item.query, item.kind, true);
  }

  function uploadImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    patch({
      background: objectUrl,
      backgroundLabel: file.name,
      sourceCrop: null,
      zoom: 1,
      x: 0,
      y: 0,
      rotate: 0
    });
    setMessage('Photo selected');
  }

  function pointerDown(event) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 1) {
      lastPoint.current = { x: event.clientX, y: event.clientY };
    }

    if (pointers.current.size === 2) {
      const p = Array.from(pointers.current.values());
      lastDistance.current = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    }
  }

  function pointerMove(event) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 1 && lastPoint.current) {
      const rect = event.currentTarget.getBoundingClientRect();
      const dx = event.clientX - lastPoint.current.x;
      const dy = event.clientY - lastPoint.current.y;
      patch((current) => ({
        x: clamp(current.x + dx / Math.max(1, rect.width), -1.5, 1.5),
        y: clamp(current.y + dy / Math.max(1, rect.height), -1.5, 1.5)
      }));
      lastPoint.current = { x: event.clientX, y: event.clientY };
    } else if (pointers.current.size === 2) {
      const p = Array.from(pointers.current.values());
      const distance = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      if (lastDistance.current && Number.isFinite(distance)) {
        const factor = distance / Math.max(1, lastDistance.current);
        patch((current) => ({
          zoom: clamp(current.zoom * factor, 0.5, 5)
        }));
      }
      lastDistance.current = distance;
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

    lastDistance.current = null;
  }

  function makeCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    renderCard(canvas.getContext('2d'), width, height);
    return canvas;
  }

  function download(width, height, name) {
    makeCanvas(width, height).toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1200);
      setMessage(name + ' saved');
    }, 'image/png');
  }

  async function share() {
    const blob = await new Promise((resolve) => makeCanvas(OUT_W, OUT_H).toBlob(resolve, 'image/png'));
    if (!blob) return;
    const file = new File([blob], 'cardBackgroundCombined@3x.png', { type: 'image/png' });

    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ files: [file], title: 'AirCard skin' });
        setMessage('Share sheet opened');
      } else {
        download(OUT_W, OUT_H, file.name);
      }
    } catch {}
  }

  function reset() {
    setDesign(DEFAULTS);
    setResults([]);
    setQuery('');
    setImage(null);
    setMessage('New card');
  }

  const preview = (
    <section className={'previewShell ' + (tab === 'browse' ? 'browsePreview' : 'editingPreview')}>
      <div className="cardFrame">
        <canvas
          ref={canvasRef}
          width={OUT_W}
          height={OUT_H}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
          aria-label="Card preview. Drag to reposition artwork and pinch to zoom."
        />
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
        <div>
          <span className="kicker">AirCard</span>
          <h1>Card Studio</h1>
        </div>
        <button type="button" className="navTextButton" onClick={reset}>New</button>
      </header>

      {preview}

      <div className="screenContent">
        {tab === 'browse' && (
          <div className="tabScreen">
            <section className="searchSection sourceSection" aria-label="Card skin source">
              <div className="sourceSegmented" role="tablist" aria-label="Card skin source">
                {[
                  ['cucu', 'CUCU'],
                  ['blitz', 'Blitz']
                ].map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    role="tab"
                    aria-selected={kind === value}
                    className={kind === value ? 'selected' : ''}
                    onClick={() => setKind(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="catalogCategoryIntro">
                <div>
                  <strong>{kind === 'cucu' ? 'CUCU Covers' : 'Blitz Covers'}</strong>
                  <span>
                    {kind === 'cucu'
                      ? (cucuTotal > 0 ? cucuTotal.toLocaleString() + ' in this collection' : 'Real storefront collections')
                      : (blitzTotal > 0 ? blitzTotal.toLocaleString() + ' indexed full-card skins' : 'Indexed full-card skins')}
                  </span>
                </div>
                <p>
                  Images are served through Card Studio’s cache. Selecting a design stays inside the app.
                </p>
              </div>
            </section>

            {kind === 'cucu' ? (
              <>
                <section className="browseSection realCategorySection" aria-label="CUCU card skin collections">
                  <div className="browseHeading">
                    <h2>Collections</h2>
                    <span>CUCU</span>
                  </div>
                  <div className="categoryScroller" role="tablist" aria-label="CUCU collection">
                    {CUCU_CATEGORIES.map(([value, label]) => (
                      <button
                        type="button"
                        role="tab"
                        key={value}
                        aria-selected={cucuCategory === value}
                        className={cucuCategory === value ? 'categoryChip selected' : 'categoryChip'}
                        onClick={() => {
                          if (value === cucuCategory) return;
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
                </section>

                <StoreCatalog
                  storeName="CUCU Covers"
                  categoryLabel={cucuCategoryLabel}
                  items={cucuItems}
                  total={cucuTotal}
                  loading={cucuLoading}
                  hasMore={cucuHasMore}
                  onPick={useArtwork}
                  onLoadMore={() => loadCucu(cucuPage + 1, false, cucuCategory)}
                />
              </>
            ) : (
              <StoreCatalog
                storeName="Blitz Covers"
                categoryLabel="Full Card Skins"
                items={blitzItems}
                total={blitzTotal}
                loading={blitzLoading}
                hasMore={blitzHasMore}
                onPick={useArtwork}
                onLoadMore={() => loadBlitz(blitzPage + 1)}
              />
            )}

            <ArtworkRail title="Recent" items={recent} onPick={useArtwork} />

            <section className="browseSection">
              <div className="browseHeading"><h2>Your Designs</h2><span>Local</span></div>
              <div className="gradientRail" role="list">
                {GRADIENTS.map((item) => (
                  <button
                    type="button"
                    role="listitem"
                    key={item.id}
                    className={design.gradient === item.id && !design.background ? 'gradientSwatch selected' : 'gradientSwatch'}
                    style={{ background: 'linear-gradient(135deg,' + item.a + ',' + item.b + ',' + item.c + ')' }}
                    onClick={() => patch({ gradient: item.id, background: '', backgroundLabel: item.name, sourceCrop: null })}
                    aria-label={'Use ' + item.name + ' background'}
                  >
                    <span>{item.name}</span>
                  </button>
                ))}
              </div>
            </section>

            <button type="button" className="secondaryAction uploadAction" onClick={() => uploadRef.current?.click()}>
              <IOSIcon name="photo" size={21} />
              <span>Choose Photo</span>
            </button>
            <input ref={uploadRef} type="file" accept="image/*" hidden onChange={uploadImage} />
          </div>
        )}

        {tab === 'edit' && (
          <div className="tabScreen">
            <p className="editStatus" aria-live="polite">
              {design.background ? 'Live preview · changes apply instantly' : 'Choose a card skin or photo first'}
            </p>
            <Group title="LAYOUT" footer="Drag directly on the card to move the artwork. Pinch the card with two fingers to zoom.">
              <div className="groupRow segmentedRow">
                <div className="segmentedControl compact" role="tablist" aria-label="Artwork fit mode">
                  <button type="button" role="tab" disabled={!design.background} aria-selected={design.fit === 'cover'} className={design.fit === 'cover' ? 'selected' : ''} onClick={() => patch({ fit: 'cover' })}>Fill</button>
                  <button type="button" role="tab" disabled={!design.background} aria-selected={design.fit === 'contain'} className={design.fit === 'contain' ? 'selected' : ''} onClick={() => patch({ fit: 'contain' })}>Fit</button>
                </div>
                <button type="button" className="iconTextButton" disabled={!design.background} onClick={() => patch({ fit: 'cover', zoom: 1, x: 0, y: 0, rotate: 0 })}>
                  <IOSIcon name="reset" size={18} />
                  <span>Reset</span>
                </button>
              </div>
              <SliderRow label="Zoom" value={design.zoom} min={0.5} max={5} step={0.01} disabled={!design.background} onChange={(value) => patch({ zoom: value })} />
              <SliderRow label="Horizontal" value={design.x} min={-1.5} max={1.5} step={0.01} disabled={!design.background} onChange={(value) => patch({ x: value })} />
              <SliderRow label="Vertical" value={design.y} min={-1.5} max={1.5} step={0.01} disabled={!design.background} onChange={(value) => patch({ y: value })} />
              <SliderRow label="Rotation" value={design.rotate} min={-25} max={25} step={1} suffix="°" disabled={!design.background} onChange={(value) => patch({ rotate: value })} />
            </Group>

            <Group title="IMAGE">
              <SliderRow label="Brightness" value={design.brightness} min={0.4} max={1.7} step={0.01} disabled={!design.background} onChange={(value) => patch({ brightness: value })} />
              <SliderRow label="Saturation" value={design.saturation} min={0} max={2.4} step={0.01} disabled={!design.background} onChange={(value) => patch({ saturation: value })} />
              <SliderRow label="Contrast" value={design.contrast} min={0.45} max={1.8} step={0.01} disabled={!design.background} onChange={(value) => patch({ contrast: value })} />
              <SliderRow label="Soft Blur" value={design.blur} min={0} max={1} step={0.01} disabled={!design.background} onChange={(value) => patch({ blur: value })} />
              <button
                type="button"
                className="settingsResetButton"
                disabled={!design.background}
                onClick={() => patch({ brightness: 1, saturation: 1, contrast: 1, blur: 0 })}
              >
                Reset Image Adjustments
              </button>
            </Group>

            <Group title="FINISH">
              <SliderRow label="Dark Overlay" value={design.overlay} min={0} max={0.75} step={0.01} onChange={(value) => patch({ overlay: value })} />
              <SliderRow label="Vignette" value={design.vignette} min={0} max={0.8} step={0.01} onChange={(value) => patch({ vignette: value })} />
              <SliderRow label="Gloss" value={design.gloss} min={0} max={0.8} step={0.01} onChange={(value) => patch({ gloss: value })} />
              <SliderRow label="Grain" value={design.grain} min={0} max={0.22} step={0.005} onChange={(value) => patch({ grain: value })} />
              <button
                type="button"
                className="settingsResetButton"
                onClick={() => patch({ overlay: 0.1, vignette: 0.24, gloss: 0.2, grain: 0.035 })}
              >
                Reset Finish
              </button>
            </Group>
          </div>
        )}

        {tab === 'layers' && (
          <div className="tabScreen">
            <Group title="CARD HARDWARE" footer="These elements are rendered into the final PNG.">
              <SwitchRow label="EMV Chip" detail="Credit-card chip layer" value={design.chip} onChange={(value) => patch({ chip: value })} />
              {design.chip ? (
                <div className="nestedControls">
                  <div className="tonePicker" role="radiogroup" aria-label="Chip finish">
                    {['gold', 'silver', 'black', 'rose'].map((tone) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={design.chipTone === tone}
                        key={tone}
                        className={design.chipTone === tone ? 'selected' : ''}
                        onClick={() => patch({ chipTone: tone })}
                      >
                        <i className={'chipTone ' + tone} aria-hidden="true" />
                        <span>{tone[0].toUpperCase() + tone.slice(1)}</span>
                      </button>
                    ))}
                  </div>
                  <SliderRow label="Chip Size" value={design.chipScale} min={0.6} max={1.6} step={0.01} onChange={(value) => patch({ chipScale: value })} />
                  <SliderRow label="Chip X" value={design.chipX} min={0} max={0.72} step={0.005} onChange={(value) => patch({ chipX: value })} />
                  <SliderRow label="Chip Y" value={design.chipY} min={0} max={0.72} step={0.005} onChange={(value) => patch({ chipY: value })} />
                  <SliderRow label="Chip Angle" value={design.chipRotation} min={-20} max={20} step={1} suffix="°" onChange={(value) => patch({ chipRotation: value })} />
                </div>
              ) : null}

              <SwitchRow label="Contactless" detail="Tap-to-pay symbol" value={design.contactless} onChange={(value) => patch({ contactless: value })} />
              {design.contactless ? (
                <div className="nestedControls">
                  <SliderRow label="Symbol Size" value={design.contactlessScale} min={0.55} max={1.6} step={0.01} onChange={(value) => patch({ contactlessScale: value })} />
                  <SliderRow label="Symbol X" value={design.contactlessX} min={0} max={0.9} step={0.005} onChange={(value) => patch({ contactlessX: value })} />
                  <SliderRow label="Symbol Y" value={design.contactlessY} min={0} max={0.9} step={0.005} onChange={(value) => patch({ contactlessY: value })} />
                </div>
              ) : null}
            </Group>

            <Group title="TEXT">
              <SwitchRow label="Masked Number" value={design.number} onChange={(value) => patch({ number: value })} />
              {design.number ? <input className="iosTextField" aria-label="Masked card number" value={design.numberText} onChange={(event) => patch({ numberText: event.target.value.slice(0, 32) })} /> : null}

              <SwitchRow label="Card Holder" value={design.holder} onChange={(value) => patch({ holder: value })} />
              {design.holder ? <input className="iosTextField" aria-label="Card holder" value={design.holderText} onChange={(event) => patch({ holderText: event.target.value.slice(0, 28) })} /> : null}

              <SwitchRow label="Expiry" value={design.expiry} onChange={(value) => patch({ expiry: value })} />
              {design.expiry ? <input className="iosTextField" aria-label="Expiry date" value={design.expiryText} onChange={(event) => patch({ expiryText: event.target.value.slice(0, 8) })} /> : null}

              <SwitchRow label="Top Badge" value={design.badge} onChange={(value) => patch({ badge: value })} />
              {design.badge ? <input className="iosTextField" aria-label="Top badge text" value={design.badgeText} onChange={(event) => patch({ badgeText: event.target.value.slice(0, 10).toUpperCase() })} /> : null}

              <label className="colorRow">
                <span>Text Color</span>
                <input aria-label="Text color" type="color" value={design.textColor} onChange={(event) => patch({ textColor: event.target.value })} />
              </label>
            </Group>
          </div>
        )}

        {tab === 'export' && (
          <div className="tabScreen exportScreen">
            <section className="exportCard" aria-label="AirCard export details">
              <div className="exportGlyph"><IOSIcon name="export" size={30} /></div>
              <h2>Ready for AirCard</h2>
              <p>The 3× export matches AirCard’s full-resolution card background size.</p>
              <div className="exportSpec">
                <span>1536 × 969</span>
                <code>cardBackgroundCombined@3x.png</code>
              </div>
            </section>

            <button type="button" className="primaryAction bigAction" onClick={share}>
              <IOSIcon name="export" size={21} />
              <span>Share 3× PNG</span>
            </button>

            <Group title="DOWNLOADS">
              <button type="button" className="actionRow" onClick={() => download(OUT_W, OUT_H, 'cardBackgroundCombined@3x.png')}>
                <span><strong>Save 3× PNG</strong><small>1536 × 969</small></span>
                <IOSIcon name="chevron" size={17} />
              </button>
              <button type="button" className="actionRow" onClick={() => download(1024, 646, 'cardBackgroundCombined@2x.png')}>
                <span><strong>Save 2× PNG</strong><small>1024 × 646</small></span>
                <IOSIcon name="chevron" size={17} />
              </button>
            </Group>

            <p className="legalNote">Artwork rights remain with their respective owners. Search results come from premade card-skin storefront listings and are visually screened in-app for obvious mockup backgrounds before use.</p>
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
    </main>
  );
}
