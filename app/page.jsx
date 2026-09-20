'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const OUT_W = 1536;
const OUT_H = 969;
const CARD_RATIO = OUT_W / OUT_H;

const FEATURED = [
  { title: 'Dragon Ball Z', kind: 'anime', query: 'Dragon Ball Z', tag: 'Anime', colors: ['#ff7a00','#ffcf33'] },
  { title: 'Naruto', kind: 'anime', query: 'Naruto', tag: 'Anime', colors: ['#ff7a18','#1a1d28'] },
  { title: 'Jujutsu Kaisen', kind: 'anime', query: 'Jujutsu Kaisen', tag: 'Anime', colors: ['#6f4bff','#111322'] },
  { title: 'Demon Slayer', kind: 'anime', query: 'Demon Slayer', tag: 'Anime', colors: ['#1b7b6a','#111318'] },
  { title: 'One Piece', kind: 'anime', query: 'One Piece', tag: 'Anime', colors: ['#df3030','#1c7bc2'] },
  { title: 'Tokyo Ghoul', kind: 'anime', query: 'Tokyo Ghoul', tag: 'Anime', colors: ['#c40f37','#0a0a0c'] },
  { title: 'Attack on Titan', kind: 'anime', query: 'Attack on Titan', tag: 'Anime', colors: ['#6b1515','#1a1512'] },
  { title: 'My Hero Academia', kind: 'anime', query: 'My Hero Academia', tag: 'Anime', colors: ['#20a778','#efcf40'] },
  { title: 'SpongeBob', kind: 'cartoon', query: 'SpongeBob SquarePants', tag: 'Cartoon', colors: ['#ffd92f','#22aee8'] },
  { title: 'Adventure Time', kind: 'cartoon', query: 'Adventure Time', tag: 'Cartoon', colors: ['#75d6ff','#f4dd45'] },
  { title: 'Regular Show', kind: 'cartoon', query: 'Regular Show', tag: 'Cartoon', colors: ['#77c4dc','#5f507e'] },
  { title: 'Rick and Morty', kind: 'cartoon', query: 'Rick and Morty', tag: 'Cartoon', colors: ['#62e66f','#232639'] },
  { title: 'Breaking Bad', kind: 'tv', query: 'Breaking Bad', tag: 'TV', colors: ['#285d3a','#101713'] },
  { title: 'Stranger Things', kind: 'tv', query: 'Stranger Things', tag: 'TV', colors: ['#d22a32','#09090b'] },
  { title: 'The Boys', kind: 'tv', query: 'The Boys', tag: 'TV', colors: ['#d51f2d','#101114'] },
  { title: 'Fallout', kind: 'tv', query: 'Fallout', tag: 'TV', colors: ['#eac64f','#294d78'] },
  { title: 'Wednesday', kind: 'tv', query: 'Wednesday', tag: 'TV', colors: ['#6f63a8','#17131f'] },
  { title: 'Game of Thrones', kind: 'tv', query: 'Game of Thrones', tag: 'TV', colors: ['#6e7a86','#111315'] }
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

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.closePath();
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

  [0.25, 0.75].forEach(function(q) {
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

  [28, 52, 78].forEach(function(radius) {
    ctx.beginPath();
    ctx.arc(0, 0, radius * scale, -0.72, 0.72);
    ctx.stroke();
  });
  ctx.restore();
}

function ControlSlider({ label, value, min, max, step, onChange, suffix }) {
  return (
    <label className="controlSlider">
      <div><span>{label}</span><b>{Number(value).toFixed(step >= 1 ? 0 : 2)}{suffix || ''}</b></div>
      <input type="range" value={value} min={min} max={max} step={step} onChange={function(e){ onChange(Number(e.target.value)); }} />
    </label>
  );
}

function Toggle({ label, description, value, onChange }) {
  return (
    <button type="button" className={'switchRow ' + (value ? 'enabled' : '')} onClick={function(){ onChange(!value); }}>
      <span><b>{label}</b>{description ? <small>{description}</small> : null}</span>
      <i><u /></i>
    </button>
  );
}

function Icon({ name }) {
  const icons = {
    discover: '⌕',
    design: '✦',
    layers: '◫',
    export: '⇩'
  };
  return <span className="navIcon">{icons[name] || '•'}</span>;
}

export default function Page() {
  const [tab, setTab] = useState('discover');
  const [design, setDesign] = useState(DEFAULTS);
  const [image, setImage] = useState(null);
  const [kind, setKind] = useState('anime');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('Ready');
  const [source, setSource] = useState('');
  const canvasRef = useRef(null);
  const uploadRef = useRef(null);
  const pointers = useRef(new Map());
  const lastPoint = useRef(null);
  const lastDistance = useRef(null);

  const gradient = useMemo(function() {
    return GRADIENTS.find(function(g){ return g.id === design.gradient; }) || GRADIENTS[0];
  }, [design.gradient]);

  const patch = useCallback(function(next) {
    setDesign(function(current) {
      return Object.assign({}, current, next);
    });
  }, []);

  useEffect(function() {
    try {
      const saved = localStorage.getItem('aircard-sticker-fvp-v2');
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') {
        parsed.background = parsed.background && parsed.background.indexOf('/api/image?') === 0 ? parsed.background : '';
        setDesign(function(current){ return Object.assign({}, current, parsed); });
      }
    } catch {}
  }, []);

  useEffect(function() {
    try {
      const copy = Object.assign({}, design);
      if (copy.background && copy.background.indexOf('/api/image?') !== 0) copy.background = '';
      localStorage.setItem('aircard-sticker-fvp-v2', JSON.stringify(copy));
    } catch {}
  }, [design]);

  useEffect(function() {
    if (!design.background) {
      setImage(null);
      return;
    }
    const img = new Image();
    img.onload = function() {
      setImage(img);
      setMessage('Artwork loaded');
    };
    img.onerror = function() {
      setImage(null);
      setMessage('Artwork could not load');
    };
    img.src = design.background;
  }, [design.background]);

  const renderCard = useCallback(function(ctx, width, height) {
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
      const ratio = image.width / image.height;
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
      ctx.filter = 'brightness(' + design.brightness + ') saturate(' + design.saturation + ') contrast(' + design.contrast + ') blur(' + (design.blur * 7) + 'px)';
      ctx.drawImage(image, -iw / 2, -ih / 2, iw, ih);
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
      const vignette = ctx.createRadialGradient(OUT_W / 2, OUT_H / 2, OUT_W * 0.16, OUT_W / 2, OUT_H / 2, OUT_W * 0.72);
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

  useEffect(function() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderCard(canvas.getContext('2d'), OUT_W, OUT_H);
  }, [renderCard]);

  const runSearch = useCallback(async function(q, searchKind, autoPick) {
    const clean = (q || query).trim();
    const useKind = searchKind || kind;
    if (clean.length < 2) return;
    setSearching(true);
    setMessage('Searching ' + useKind + '…');
    setSource('');
    try {
      const response = await fetch('/api/search?q=' + encodeURIComponent(clean) + '&kind=' + encodeURIComponent(useKind), { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Search failed');
      const list = Array.isArray(json.results) ? json.results : [];
      setResults(list);
      setSource(json.source || '');
      if (autoPick && list[0]) {
        const first = list[0];
        patch({
          background: first.image,
          backgroundLabel: first.title,
          zoom: 1,
          x: 0,
          y: 0,
          rotate: 0,
          fit: 'cover'
        });
        setMessage('Loaded ' + first.title);
      } else {
        setMessage(list.length ? list.length + ' results' : 'No results found');
      }
    } catch (error) {
      setResults([]);
      setMessage(error && error.message ? error.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  }, [kind, patch, query]);

  function useResult(item) {
    patch({
      background: item.image,
      backgroundLabel: item.title,
      zoom: 1,
      x: 0,
      y: 0,
      rotate: 0,
      fit: 'cover'
    });
    setMessage('Loaded ' + item.title);
  }

  async function loadFeatured(item) {
    setKind(item.kind);
    setQuery(item.query);
    setTab('discover');
    await runSearch(item.query, item.kind, true);
  }

  function uploadImage(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    patch({
      background: objectUrl,
      backgroundLabel: file.name,
      zoom: 1,
      x: 0,
      y: 0,
      rotate: 0
    });
    setMessage('Local photo loaded');
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
      patch({
        x: clamp(design.x + dx / rect.width, -1.5, 1.5),
        y: clamp(design.y + dy / rect.height, -1.5, 1.5)
      });
      lastPoint.current = { x: event.clientX, y: event.clientY };
    } else if (pointers.current.size === 2) {
      const p = Array.from(pointers.current.values());
      const distance = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      if (lastDistance.current) {
        patch({ zoom: clamp(design.zoom * (distance / lastDistance.current), 0.5, 5) });
      }
      lastDistance.current = distance;
    }
  }

  function pointerUp(event) {
    pointers.current.delete(event.pointerId);
    lastPoint.current = null;
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
    makeCanvas(width, height).toBlob(function(blob) {
      if (!blob) return;
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(function(){ URL.revokeObjectURL(url); }, 1200);
      setMessage(name + ' saved');
    }, 'image/png');
  }

  async function share() {
    const blob = await new Promise(function(resolve){
      makeCanvas(OUT_W, OUT_H).toBlob(resolve, 'image/png');
    });
    if (!blob) return;
    const file = new File([blob], 'cardBackgroundCombined@3x.png', { type: 'image/png' });
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ files: [file], title: 'AirCard skin' });
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

  return (
    <main className="studio">
      <header className="topbar">
        <div>
          <span className="eyebrow">AIRCARD</span>
          <h1>Card Skin Studio</h1>
        </div>
        <button type="button" className="ghostButton" onClick={reset}>New</button>
      </header>

      <section className="previewShell">
        <div className="cardStage">
          <div className="cardGlow" />
          <div className="cardFrame">
            <canvas
              ref={canvasRef}
              width={OUT_W}
              height={OUT_H}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={pointerUp}
            />
          </div>
          <div className="previewMeta">
            <span className="statusDot" />
            <span>{message}</span>
            <b>{design.backgroundLabel}</b>
          </div>
        </div>
      </section>

      <section className="workspace">
        {tab === 'discover' && (
          <div className="panel">
            <div className="sectionHeading">
              <div><span className="miniLabel">REAL ARTWORK SEARCH</span><h2>Find a design</h2></div>
              <button type="button" className="primarySmall" onClick={function(){ uploadRef.current && uploadRef.current.click(); }}>Upload</button>
              <input ref={uploadRef} type="file" accept="image/*" hidden onChange={uploadImage} />
            </div>

            <div className="sourceTabs">
              {[
                ['anime','Anime'],
                ['cartoon','Cartoons'],
                ['tv','TV Shows']
              ].map(function(item){
                return <button key={item[0]} className={kind === item[0] ? 'active' : ''} onClick={function(){ setKind(item[0]); }}>{item[1]}</button>;
              })}
            </div>

            <div className="searchBar">
              <span>⌕</span>
              <input
                value={query}
                placeholder={kind === 'anime' ? 'Search Naruto, Dragon Ball, Kaneki…' : 'Search any show…'}
                onChange={function(e){ setQuery(e.target.value); }}
                onKeyDown={function(e){ if (e.key === 'Enter') runSearch(); }}
              />
              <button type="button" onClick={function(){ runSearch(); }}>{searching ? '•••' : 'Search'}</button>
            </div>

            {source ? <div className="sourcePill">Source: {source}</div> : null}

            {results.length > 0 && (
              <>
                <div className="subHeading"><h3>Results</h3><span>{results.length}</span></div>
                <div className="artGrid">
                  {results.map(function(item){
                    return (
                      <button type="button" className="artTile" key={item.id} onClick={function(){ useResult(item); }}>
                        <img src={item.image} alt="" loading="lazy" />
                        <span><b>{item.title}</b><small>{item.subtitle || item.source}</small></span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <div className="subHeading"><h3>One-tap show templates</h3><span>live</span></div>
            <div className="featuredGrid">
              {FEATURED.map(function(item){
                return (
                  <button
                    type="button"
                    className="featuredCard"
                    key={item.title}
                    style={{ background: 'linear-gradient(145deg,' + item.colors[0] + ',' + item.colors[1] + ')' }}
                    onClick={function(){ loadFeatured(item); }}
                  >
                    <small>{item.tag}</small>
                    <b>{item.title}</b>
                    <span>Load artwork →</span>
                  </button>
                );
              })}
            </div>

            <div className="subHeading"><h3>Blank styles</h3><span>{GRADIENTS.length}</span></div>
            <div className="gradientGrid">
              {GRADIENTS.map(function(g){
                return (
                  <button
                    key={g.id}
                    className={design.gradient === g.id ? 'gradientTile selected' : 'gradientTile'}
                    style={{ background: 'linear-gradient(135deg,' + g.a + ',' + g.b + ',' + g.c + ')' }}
                    onClick={function(){ patch({ gradient: g.id, background: '', backgroundLabel: g.name }); }}
                  >
                    <b>{g.name}</b>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'design' && (
          <div className="panel">
            <div className="sectionHeading"><div><span className="miniLabel">BACKGROUND</span><h2>Position & finish</h2></div><button className="ghostButton" onClick={function(){ patch({ zoom: 1, x: 0, y: 0, rotate: 0 }); }}>Reset</button></div>
            <div className="sourceTabs two">
              <button className={design.fit === 'cover' ? 'active' : ''} onClick={function(){ patch({ fit: 'cover' }); }}>Fill card</button>
              <button className={design.fit === 'contain' ? 'active' : ''} onClick={function(){ patch({ fit: 'contain' }); }}>Fit image</button>
            </div>
            <p className="hint">Drag the card preview to move artwork. Pinch directly on the card to zoom.</p>
            <ControlSlider label="Zoom" value={design.zoom} min={0.5} max={5} step={0.01} onChange={function(v){ patch({ zoom: v }); }} />
            <ControlSlider label="Horizontal" value={design.x} min={-1.5} max={1.5} step={0.01} onChange={function(v){ patch({ x: v }); }} />
            <ControlSlider label="Vertical" value={design.y} min={-1.5} max={1.5} step={0.01} onChange={function(v){ patch({ y: v }); }} />
            <ControlSlider label="Rotate" value={design.rotate} min={-25} max={25} step={1} suffix="°" onChange={function(v){ patch({ rotate: v }); }} />
            <div className="divider" />
            <ControlSlider label="Brightness" value={design.brightness} min={0.4} max={1.7} step={0.01} onChange={function(v){ patch({ brightness: v }); }} />
            <ControlSlider label="Saturation" value={design.saturation} min={0} max={2.4} step={0.01} onChange={function(v){ patch({ saturation: v }); }} />
            <ControlSlider label="Contrast" value={design.contrast} min={0.45} max={1.8} step={0.01} onChange={function(v){ patch({ contrast: v }); }} />
            <ControlSlider label="Soft blur" value={design.blur} min={0} max={1} step={0.01} onChange={function(v){ patch({ blur: v }); }} />
            <ControlSlider label="Vignette" value={design.vignette} min={0} max={0.8} step={0.01} onChange={function(v){ patch({ vignette: v }); }} />
            <ControlSlider label="Gloss" value={design.gloss} min={0} max={0.8} step={0.01} onChange={function(v){ patch({ gloss: v }); }} />
            <ControlSlider label="Grain" value={design.grain} min={0} max={0.22} step={0.005} onChange={function(v){ patch({ grain: v }); }} />
          </div>
        )}

        {tab === 'layers' && (
          <div className="panel">
            <div className="sectionHeading"><div><span className="miniLabel">CARD HARDWARE</span><h2>Chip & layers</h2></div></div>
            <Toggle label="EMV chip" description="Rendered into the exported skin" value={design.chip} onChange={function(v){ patch({ chip: v }); }} />
            {design.chip && (
              <div className="layerCard">
                <div className="toneGrid">
                  {['gold','silver','black','rose'].map(function(tone){
                    return <button key={tone} className={design.chipTone === tone ? 'tone active' : 'tone'} onClick={function(){ patch({ chipTone: tone }); }}>{tone}</button>;
                  })}
                </div>
                <ControlSlider label="Chip size" value={design.chipScale} min={0.6} max={1.6} step={0.01} onChange={function(v){ patch({ chipScale: v }); }} />
                <ControlSlider label="Chip X" value={design.chipX} min={0} max={0.72} step={0.005} onChange={function(v){ patch({ chipX: v }); }} />
                <ControlSlider label="Chip Y" value={design.chipY} min={0} max={0.72} step={0.005} onChange={function(v){ patch({ chipY: v }); }} />
                <ControlSlider label="Chip angle" value={design.chipRotation} min={-20} max={20} step={1} suffix="°" onChange={function(v){ patch({ chipRotation: v }); }} />
              </div>
            )}

            <Toggle label="Contactless symbol" value={design.contactless} onChange={function(v){ patch({ contactless: v }); }} />
            {design.contactless && (
              <div className="layerCard">
                <ControlSlider label="Contactless X" value={design.contactlessX} min={0} max={0.9} step={0.005} onChange={function(v){ patch({ contactlessX: v }); }} />
                <ControlSlider label="Contactless Y" value={design.contactlessY} min={0} max={0.9} step={0.005} onChange={function(v){ patch({ contactlessY: v }); }} />
                <ControlSlider label="Symbol size" value={design.contactlessScale} min={0.55} max={1.6} step={0.01} onChange={function(v){ patch({ contactlessScale: v }); }} />
              </div>
            )}

            <div className="divider" />
            <div className="sectionHeading compact"><div><span className="miniLabel">OPTIONAL TEXT</span><h3>Card details</h3></div></div>
            <Toggle label="Masked card number" value={design.number} onChange={function(v){ patch({ number: v }); }} />
            {design.number ? <input className="textField" value={design.numberText} onChange={function(e){ patch({ numberText: e.target.value.slice(0, 32) }); }} /> : null}
            <Toggle label="Card holder" value={design.holder} onChange={function(v){ patch({ holder: v }); }} />
            {design.holder ? <input className="textField" value={design.holderText} onChange={function(e){ patch({ holderText: e.target.value.slice(0, 28) }); }} /> : null}
            <Toggle label="Expiry" value={design.expiry} onChange={function(v){ patch({ expiry: v }); }} />
            {design.expiry ? <input className="textField" value={design.expiryText} onChange={function(e){ patch({ expiryText: e.target.value.slice(0, 8) }); }} /> : null}
            <Toggle label="Top-right badge" value={design.badge} onChange={function(v){ patch({ badge: v }); }} />
            {design.badge ? <input className="textField" value={design.badgeText} onChange={function(e){ patch({ badgeText: e.target.value.slice(0, 10).toUpperCase() }); }} /> : null}

            <div className="colorRow">
              <span><b>Text color</b><small>Chip/contactless labels</small></span>
              <input type="color" value={design.textColor} onChange={function(e){ patch({ textColor: e.target.value }); }} />
            </div>
          </div>
        )}

        {tab === 'export' && (
          <div className="panel exportPanel">
            <div className="sectionHeading"><div><span className="miniLabel">AIRCARD OUTPUT</span><h2>Export</h2></div></div>
            <div className="exportHero">
              <div className="exportBadge">3×</div>
              <div>
                <b>AirCard Wallet skin</b>
                <strong>1536 × 969 PNG</strong>
                <code>cardBackgroundCombined@3x.png</code>
              </div>
            </div>
            <button type="button" className="shareButton" onClick={share}>Share 3× PNG on iPhone</button>
            <button type="button" className="exportButton primary" onClick={function(){ download(OUT_W, OUT_H, 'cardBackgroundCombined@3x.png'); }}>Save @3× PNG</button>
            <button type="button" className="exportButton" onClick={function(){ download(1024, 646, 'cardBackgroundCombined@2x.png'); }}>Save @2× PNG</button>

            <div className="exportInfo">
              <div><span>FORMAT</span><b>PNG</b></div>
              <div><span>COLOR</span><b>RGBA</b></div>
              <div><span>RATIO</span><b>1.585</b></div>
            </div>
            <p className="legal">Artwork search is provided as a design source. Rights to characters, shows and artwork remain with their respective owners. TV metadata/artwork is sourced through TVmaze; anime search uses Jikan with AniList fallback.</p>
          </div>
        )}
      </section>

      <nav className="bottomNav">
        {[
          ['discover','Discover'],
          ['design','Design'],
          ['layers','Layers'],
          ['export','Export']
        ].map(function(item){
          return (
            <button key={item[0]} className={tab === item[0] ? 'active' : ''} onClick={function(){ setTab(item[0]); }}>
              <Icon name={item[0]} />
              <span>{item[1]}</span>
            </button>
          );
        })}
      </nav>
    </main>
  );
}
