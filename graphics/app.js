/* ============================================================================
   Super NES Graphics & the PPU — interactive layer
   Everything you see is drawn live in your browser with the 2D canvas API.
   The labs are tiny software PPUs: they build tiles from bitplanes, look colours
   up in a 15-bit palette, scroll tilemaps, composite sprites, run the Mode 7
   affine transform, and blend a main + sub screen — the very algorithms the
   S-PPU1/S-PPU2 pair ran in silicon. No WebGL, no libraries, no game assets:
   every pixel is procedural.
   ============================================================================ */
'use strict';

/* ------------------------------------------------------------- helpers ---- */
const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/* Size a canvas's bitmap to its CSS box × devicePixelRatio (capped at 2 so
   phones don't burn battery on 3× pixels nobody can see). Returns the dpr. */
function fitCanvas(canvas, dprMax = 2) {
  const dpr = Math.min(window.devicePixelRatio || 1, dprMax);
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  return dpr;
}

/* Tell a lab when it scrolls into / out of view so animations can pause.
   cb(visible) fires on every transition; assume visible if IO is missing. */
function whenVisible(el, cb) {
  if (!('IntersectionObserver' in window)) { cb(true); return; }
  const obs = new IntersectionObserver(
    es => es.forEach(e => cb(e.isIntersecting)),
    { rootMargin: '100px' }
  );
  obs.observe(el);
}

/* segmented buttons: exclusive selection within one .seg-btns group.
   onPick(value) is called with the picked button's data-* value. */
function segGroup(group, attr, onPick) {
  group.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    group.querySelectorAll('button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    onPick(b.dataset[attr], b);
  }));
}

/* ---- SNES colour: 15-bit BGR, 5 bits per channel (0-31) → 8-bit RGB ------ */
function to8(c5) { return (c5 << 3) | (c5 >> 2); }           // 5-bit → 8-bit expand
function css5(r, g, b) { return 'rgb(' + to8(r) + ',' + to8(g) + ',' + to8(b) + ')'; }
function word15(r, g, b) { return (b << 10) | (g << 5) | r; } // 0bbbbbgggggrrrrr
function hex15(w) { return '$' + w.toString(16).toUpperCase().padStart(4, '0'); }

/* A general-purpose 16-entry sub-palette used across several labs, written as
   [r,g,b] each 0-31. Entry 0 is the transparent/backdrop slot by convention. */
const PAL16 = [
  [0, 0, 0],    [3, 3, 6],    [31, 31, 31], [21, 22, 27],
  [28, 6, 9],   [31, 18, 6],  [31, 29, 8],  [8, 24, 10],
  [4, 14, 28],  [12, 8, 28],  [26, 10, 22], [16, 12, 8],
  [10, 20, 26], [18, 28, 14], [30, 20, 12], [12, 12, 16],
];

/* ==========================================================================
   Module 01 — pixel-grid painter
   A small framebuffer you paint by hand. Pick a palette colour, drag across
   the grid, and read out how many pixels (and bytes) the picture costs. It
   starts pre-painted so there's something to look at.
   ========================================================================== */
function PixelLab(root) {
  const canvas = root.querySelector('.gfx');
  const ctx = canvas.getContext('2d');
  const sizeR = root.querySelector('[data-size]');
  const sizeV = root.querySelector('[data-size-val]');
  const info = root.querySelector('[data-pix-info]');
  const palEl = root.querySelector('[data-pix-pal]');
  const clearBtn = root.querySelector('[data-pix-clear]');
  /* an 8-colour painter palette */
  const PAL = [[3, 3, 6], [31, 31, 31], [28, 6, 9], [31, 18, 6], [31, 29, 8], [8, 22, 10], [6, 12, 28], [26, 10, 22]];
  let N = 16, cur = 2, dpr = 1, painting = false;
  let buf = new Uint8Array(N * N);

  /* seed a tiny mushroom so the grid isn't empty */
  function seed() {
    buf = new Uint8Array(N * N);
    const art = [
      '..2222..', '.233332.', '2will3l2', '.211112.', '..1441..', '.144441.', '.144441.', '..4444..',
    ];
    const map = { '.': 0, '2': 2, '3': 3, '1': 1, 'w': 1, 'i': 0, 'l': 4, '4': 5 };
    const o = Math.floor((N - 8) / 2);
    for (let y = 0; y < 8 && y + o < N; y++) for (let x = 0; x < 8 && x + o < N; x++) {
      const ch = art[y][x]; buf[(y + o) * N + (x + o)] = map[ch] || 0;
    }
  }

  function buildPalette() {
    palEl.innerHTML = '';
    PAL.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'pe' + (i === cur ? ' sel' : '');
      b.style.background = css5(c[0], c[1], c[2]);
      b.setAttribute('aria-label', 'Palette colour ' + i);
      b.addEventListener('click', () => {
        cur = i; palEl.querySelectorAll('.pe').forEach((x, xi) => x.classList.toggle('sel', xi === cur));
      });
      palEl.appendChild(b);
    });
  }

  function draw() {
    dpr = fitCanvas(canvas);
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const size = Math.min(W, H) - 16 * dpr;
    const cell = size / N, x0 = (W - size) / 2, y0 = (H - size) / 2;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const c = PAL[buf[y * N + x]] || PAL[0];
      ctx.fillStyle = css5(c[0], c[1], c[2]);
      ctx.fillRect(x0 + x * cell, y0 + y * cell, cell + 1, cell + 1);
    }
    if (N <= 32) {
      ctx.strokeStyle = 'rgba(12,10,19,0.5)'; ctx.lineWidth = 1;
      for (let i = 1; i < N; i++) {
        ctx.beginPath(); ctx.moveTo(x0 + i * cell, y0); ctx.lineTo(x0 + i * cell, y0 + size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x0, y0 + i * cell); ctx.lineTo(x0 + size, y0 + i * cell); ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(57,47,87,0.9)'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, size, size);
    canvas.__geo = { x0, y0, cell };
    const bytes = N * N * 2;                     // 15-bit colour ≈ 2 bytes/pixel
    info.innerHTML = '<b>' + N + ' × ' + N + '</b> = ' + (N * N) + ' pixels · at 2 bytes each that is <b>'
      + (bytes >= 1024 ? (bytes / 1024).toFixed(1) + ' KB' : bytes + ' B') + '</b> · pick a colour and drag to paint';
  }

  function paintAt(e) {
    const g = canvas.__geo; if (!g) return;
    const r = canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr;
    const cx = Math.floor((px - g.x0) / g.cell), cy = Math.floor((py - g.y0) / g.cell);
    if (cx < 0 || cy < 0 || cx >= N || cy >= N) return;
    buf[cy * N + cx] = cur; draw();
  }
  canvas.addEventListener('pointerdown', e => { painting = true; canvas.setPointerCapture(e.pointerId); paintAt(e); e.preventDefault(); });
  canvas.addEventListener('pointermove', e => { if (painting) paintAt(e); });
  canvas.addEventListener('pointerup', () => { painting = false; });
  canvas.addEventListener('pointerleave', () => { painting = false; });

  sizeR.addEventListener('input', () => {
    N = parseInt(sizeR.value, 10); sizeV.textContent = N + ' × ' + N; seed(); draw();
  });
  clearBtn.addEventListener('click', () => { buf = new Uint8Array(N * N); draw(); });
  window.addEventListener('resize', draw);
  buildPalette(); seed(); sizeV.textContent = N + ' × ' + N; draw();
}

/* ==========================================================================
   Module 02 — 15-bit BGR mixer + palette editor
   Three 0-31 sliders build one CGRAM colour; a 16-swatch sub-palette lets you
   store it. Read the 15-bit word live as $BGR hex.
   ========================================================================== */
function PaletteLab(root) {
  const rR = root.querySelector('[data-r]'), gR = root.querySelector('[data-g]'), bR = root.querySelector('[data-b]');
  const rV = root.querySelector('[data-r-val]'), gV = root.querySelector('[data-g-val]'), bV = root.querySelector('[data-b-val]');
  const sw = root.querySelector('[data-pal-sw]');
  const info = root.querySelector('[data-pal-info]');
  const grid = root.querySelector('[data-pal-grid]');
  const pal = PAL16.map(c => c.slice());
  let sel = 6;

  function buildGrid() {
    grid.innerHTML = '';
    pal.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'pe' + (i === sel ? ' sel' : '');
      b.style.background = css5(c[0], c[1], c[2]);
      b.setAttribute('aria-label', 'CGRAM entry ' + i);
      b.addEventListener('click', () => { sel = i; loadSel(); });
      grid.appendChild(b);
    });
  }
  function loadSel() {
    const c = pal[sel];
    rR.value = c[0]; gR.value = c[1]; bR.value = c[2];
    grid.querySelectorAll('.pe').forEach((x, i) => x.classList.toggle('sel', i === sel));
    update();
  }
  function update() {
    const r = +rR.value, g = +gR.value, b = +bR.value;
    pal[sel] = [r, g, b];
    rV.textContent = r; gV.textContent = g; bV.textContent = b;
    sw.style.background = css5(r, g, b);
    if (grid.children[sel]) grid.children[sel].style.background = css5(r, g, b);
    const w = word15(r, g, b);
    info.innerHTML = 'entry <b>' + sel + '</b> · 15-bit word <b>' + hex15(w) + '</b> = 0·B' + b.toString(2).padStart(5, '0')
      + '·G' + g.toString(2).padStart(5, '0') + '·R' + r.toString(2).padStart(5, '0')
      + ' · 8-bit RGB (' + to8(r) + ', ' + to8(g) + ', ' + to8(b) + ') · CGRAM holds <b>256</b> of these';
  }
  [rR, gR, bR].forEach(el => el.addEventListener('input', update));
  buildGrid(); loadSel();
}

/* ==========================================================================
   Module 03 — bitplane tile editor
   An 8×8 4bpp tile: four 1-bit planes stacked to make each pixel's 0-15 index.
   Toggle a plane off and every pixel loses that bit — watch the composite and
   the raw byte layout change.
   ========================================================================== */
function BitplaneLab(root) {
  const comp = root.querySelector('[data-bp-comp]');
  const planesEl = root.querySelector('[data-bp-planes]');
  const cctx = comp.getContext('2d');
  const pctx = planesEl.getContext('2d');
  const info = root.querySelector('[data-bp-info]');
  const brush = root.querySelector('[data-bp-brush]');
  const bval = root.querySelector('[data-bp-brush-val]');
  const toggles = root.querySelector('[data-bp-toggles]');
  const planeOn = [true, true, true, true];
  let cur = 6, dpr = 1;
  /* a little 8×8 face, palette indices 0-15 */
  const tile = [
    0, 0, 6, 6, 6, 6, 0, 0,
    0, 6, 5, 5, 5, 5, 6, 0,
    6, 5, 2, 5, 5, 2, 5, 6,
    6, 5, 5, 5, 5, 5, 5, 6,
    6, 5, 10, 5, 5, 10, 5, 6,
    6, 5, 5, 10, 10, 5, 5, 6,
    0, 6, 5, 5, 5, 5, 6, 0,
    0, 0, 6, 6, 6, 6, 0, 0,
  ];
  function eff(i) { let v = 0; for (let p = 0; p < 4; p++) if (planeOn[p] && (tile[i] >> p) & 1) v |= (1 << p); return v; }

  function draw() {
    /* composite */
    dpr = fitCanvas(comp);
    let W = comp.width, H = comp.height;
    cctx.clearRect(0, 0, W, H);
    let size = Math.min(W, H) - 12 * dpr, cell = size / 8, x0 = (W - size) / 2, y0 = (H - size) / 2;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const v = eff(y * 8 + x), c = PAL16[v];
      cctx.fillStyle = css5(c[0], c[1], c[2]);
      cctx.fillRect(x0 + x * cell, y0 + y * cell, cell + 1, cell + 1);
    }
    cctx.strokeStyle = 'rgba(44,37,66,0.9)'; cctx.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      cctx.beginPath(); cctx.moveTo(x0 + i * cell, y0); cctx.lineTo(x0 + i * cell, y0 + size); cctx.stroke();
      cctx.beginPath(); cctx.moveTo(x0, y0 + i * cell); cctx.lineTo(x0 + size, y0 + i * cell); cctx.stroke();
    }
    comp.__geo = { x0, y0, cell };

    /* four plane bitmaps in a row */
    const pdpr = fitCanvas(planesEl);
    W = planesEl.width; H = planesEl.height;
    pctx.clearRect(0, 0, W, H);
    const gap = 14 * pdpr, pane = Math.min((W - gap * 5) / 4, H - 26 * pdpr);
    const pc = pane / 8, top = 20 * pdpr;
    pctx.font = (10 * pdpr) + 'px ui-monospace, Menlo, monospace';
    for (let p = 0; p < 4; p++) {
      const px = gap + p * (pane + gap);
      pctx.fillStyle = planeOn[p] ? '#a884ff' : '#57506e';
      pctx.fillText('plane ' + p, px, top - 6 * pdpr);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const on = (tile[y * 8 + x] >> p) & 1;
        pctx.fillStyle = on ? (planeOn[p] ? '#45e4d1' : '#3a5a56') : '#14111d';
        pctx.fillRect(px + x * pc + 0.5, top + y * pc + 0.5, pc - 1, pc - 1);
      }
    }

    /* byte layout: 4bpp = planes 0/1 interleaved by row (16 B) then 2/3 (16 B) */
    const bytes = [];
    for (let pr = 0; pr < 2; pr++) for (let y = 0; y < 8; y++) for (let pl = 0; pl < 2; pl++) {
      let byte = 0; const plane = pr * 2 + pl;
      for (let x = 0; x < 8; x++) byte |= ((tile[y * 8 + x] >> plane) & 1) << (7 - x);
      bytes.push(byte.toString(16).toUpperCase().padStart(2, '0'));
    }
    info.innerHTML = 'one 8×8 4bpp tile = <b>32 bytes</b> · planes 0/1 row-interleaved, then 2/3 · '
      + 'planes on: <b>' + planeOn.filter(Boolean).length + '/4</b><br><span class="v" style="word-break:break-all">'
      + bytes.join(' ') + '</span>';
  }

  comp.addEventListener('pointerdown', e => {
    const g = comp.__geo; if (!g) return;
    const r = comp.getBoundingClientRect();
    const cx = Math.floor(((e.clientX - r.left) * dpr - g.x0) / g.cell);
    const cy = Math.floor(((e.clientY - r.top) * dpr - g.y0) / g.cell);
    if (cx < 0 || cy < 0 || cx >= 8 || cy >= 8) return;
    tile[cy * 8 + cx] = cur; draw();
  });
  brush.addEventListener('input', () => { cur = +brush.value; bval.textContent = cur; });
  toggles.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const p = +b.dataset.plane; planeOn[p] = !planeOn[p]; b.classList.toggle('on', planeOn[p]); draw();
  }));
  window.addEventListener('resize', draw);
  bval.textContent = cur; draw();
}

/* ==========================================================================
   Module 04 — scrolling tilemap
   Four procedural 8×8 tiles arranged in a 32×32 map, rendered through a
   scrolling window with wrap-around. BG H/V scroll registers as sliders, plus
   an auto-scroll.
   ========================================================================== */
function makeTiles() {
  /* returns array of 8×8 tiles, each an array of 64 palette indices into PAL16 */
  const T = [];
  // 0: sky (flat blue)
  T.push(new Array(64).fill(8));
  // 1: brick
  T.push(Array.from({ length: 64 }, (_, i) => {
    const x = i % 8, y = i >> 3;
    if (y % 4 === 3) return 11;
    const off = (y >> 2) % 2 ? 4 : 0;
    return ((x + off) % 8 === 0) ? 11 : 14;
  }));
  // 2: grass/ground
  T.push(Array.from({ length: 64 }, (_, i) => {
    const x = i % 8, y = i >> 3;
    if (y === 0) return 13; if (y === 1) return ((x * 3) % 5 === 0) ? 13 : 7;
    return 7;
  }));
  // 3: coin/question block
  T.push(Array.from({ length: 64 }, (_, i) => {
    const x = i % 8, y = i >> 3;
    if (x === 0 || y === 0 || x === 7 || y === 7) return 5;
    if ((x === 3 || x === 4) && y >= 2 && y <= 4) return 6;
    if ((x === 3 || x === 4) && y === 5) return 6;
    return 4;
  }));
  return T;
}
function TilemapLab(root) {
  const canvas = root.querySelector('.gfx');
  const ctx = canvas.getContext('2d');
  const hx = root.querySelector('[data-tm-x]'), vy = root.querySelector('[data-tm-y]');
  const hxV = root.querySelector('[data-tm-x-val]'), vyV = root.querySelector('[data-tm-y-val]');
  const playBtn = root.querySelector('[data-tm-play]');
  const info = root.querySelector('[data-tm-info]');
  const tiles = makeTiles();
  const MAP = 32, TS = 8;
  const map = new Array(MAP * MAP);
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
    let t = 0;
    if (y >= 26) t = 2; else if (y >= 22) t = 1;
    else if (((x * 7 + y * 3) % 17) === 0 && y > 4 && y < 20) t = 3;
    map[y * MAP + x] = t;
  }
  /* pre-render the whole map to an offscreen bitmap once */
  const off = document.createElement('canvas'); off.width = MAP * TS; off.height = MAP * TS;
  const octx = off.getContext('2d');
  const oimg = octx.createImageData(MAP * TS, MAP * TS);
  for (let my = 0; my < MAP; my++) for (let mx = 0; mx < MAP; mx++) {
    const tile = tiles[map[my * MAP + mx]];
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const c = PAL16[tile[y * TS + x]];
      const px = mx * TS + x, py = my * TS + y, i = (py * MAP * TS + px) * 4;
      oimg.data[i] = to8(c[0]); oimg.data[i + 1] = to8(c[1]); oimg.data[i + 2] = to8(c[2]); oimg.data[i + 3] = 255;
    }
  }
  octx.putImageData(oimg, 0, 0);
  let playing = !REDUCED, visible = false, raf = null, auto = 0, last = 0;

  function draw() {
    const dpr = fitCanvas(canvas);
    const W = canvas.width, H = canvas.height;
    const scale = Math.max(2, Math.floor(Math.min(W / 128, H / 112)));
    const vw = Math.floor(W / scale), vh = Math.floor(H / scale);
    const sx = (Math.floor(+hx.value + auto) % (MAP * TS) + MAP * TS) % (MAP * TS);
    const sy = (Math.floor(+vy.value) % (MAP * TS) + MAP * TS) % (MAP * TS);
    hxV.textContent = Math.floor(+hx.value); vyV.textContent = Math.floor(+vy.value);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);
    const dx = (W - vw * scale) / 2, dy = (H - vh * scale) / 2;
    /* draw with wrap by tiling up to 4 blits */
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      ctx.drawImage(off, 0, 0, off.width, off.height,
        dx - sx * scale + ox * off.width * scale, dy - sy * scale + oy * off.height * scale,
        off.width * scale, off.height * scale);
    }
    /* mask to viewport */
    ctx.strokeStyle = 'rgba(57,47,87,0.9)'; ctx.lineWidth = 2;
    ctx.strokeRect(dx, dy, vw * scale, vh * scale);
    info.innerHTML = 'BG scroll <b>BGHOFS=' + sx + '</b> · <b>BGVOFS=' + sy + '</b> · 32×32 map of 8×8 tiles, wraps every 256 px';
  }
  function frame(ts) {
    raf = null;
    if (!last) last = ts;
    auto += (ts - last) / 1000 * 24; last = ts;
    draw();
    if (playing && visible) raf = requestAnimationFrame(frame);
  }
  function kick() { if (playing && visible && !raf) { last = 0; raf = requestAnimationFrame(frame); } }
  function syncBtn() { playBtn.innerHTML = (playing ? ICON_STOP : ICON_PLAY) + (playing ? ' Pause scroll' : ' Auto-scroll'); }
  playBtn.addEventListener('click', () => { playing = !playing; syncBtn(); kick(); if (!playing) draw(); });
  [hx, vy].forEach(el => el.addEventListener('input', draw));
  whenVisible(root, v => { visible = v; kick(); });
  window.addEventListener('resize', draw);
  syncBtn(); draw();
}

/* ==========================================================================
   Module 05 — sprite (OBJ) compositor
   A background with several freely-positioned sprites bouncing across it. A
   priority toggle drops the OBJ layer behind the background. OAM-style readout.
   ========================================================================== */
function SpriteLab(root) {
  const canvas = root.querySelector('.gfx');
  const ctx = canvas.getContext('2d');
  const countR = root.querySelector('[data-sp-count]');
  const countV = root.querySelector('[data-sp-count-val]');
  const priBtns = root.querySelector('[data-sp-pri]');
  const info = root.querySelector('[data-sp-info]');
  const tiles = makeTiles();
  const VW = 256, VH = 224;
  /* background: sky + ground built from tiles into an offscreen */
  const bg = document.createElement('canvas'); bg.width = VW; bg.height = VH;
  {
    const g = bg.getContext('2d'); const im = g.createImageData(VW, VH);
    for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) {
      let t;
      if (y > 184) t = tiles[2]; else t = tiles[0];
      const c = PAL16[t[(y % 8) * 8 + (x % 8)]];
      const i = (y * VW + x) * 4;
      im.data[i] = to8(c[0]); im.data[i + 1] = to8(c[1]); im.data[i + 2] = to8(c[2]); im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }
  /* one 16×16 sprite: a little ship, indices into PAL16 (0 = transparent) */
  const SPR = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dx = x - 7.5, dy = y - 8;
    let v = 0;
    if (Math.abs(dx) < 7 - Math.abs(dy) * 0.4 && y > 3 && y < 14) v = 10;
    if (y >= 5 && y <= 8 && Math.abs(dx) < 3) v = 2;
    if (y === 13 && (x === 4 || x === 11)) v = 5;
    SPR.push(v);
  }
  let spr = [], behind = false, visible = false, raf = null, last = 0;
  function build(n) {
    spr = [];
    for (let i = 0; i < n; i++) {
      spr.push({ x: Math.random() * (VW - 16), y: 20 + Math.random() * 150, vx: (Math.random() * 2 - 1) * 40, vy: (Math.random() * 2 - 1) * 30 });
    }
  }
  function draw() {
    const dpr = fitCanvas(canvas);
    const W = canvas.width, H = canvas.height;
    const scale = Math.min(W / VW, H / VH);
    const dw = VW * scale, dh = VH * scale, ox = (W - dw) / 2, oy = (H - dh) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bg, ox, oy, dw, dh);
    const drawSpr = () => {
      spr.forEach(s => {
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const v = SPR[y * 16 + x]; if (!v) continue;
          const c = PAL16[v];
          ctx.fillStyle = css5(c[0], c[1], c[2]);
          ctx.fillRect(ox + (s.x + x) * scale, oy + (s.y + y) * scale, scale + 1, scale + 1);
        }
      });
    };
    if (!behind) drawSpr();
    else {
      // draw sprites first (behind) then re-blit ground band over them
      drawSpr();
      ctx.drawImage(bg, 0, 184, VW, VH - 184, ox, oy + 184 * scale, dw, (VH - 184) * scale);
    }
    ctx.strokeStyle = 'rgba(57,47,87,0.9)'; ctx.lineWidth = 1; ctx.strokeRect(ox, oy, dw, dh);
  }
  function frame(ts) {
    raf = null;
    if (!last) last = ts;
    const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
    if (!REDUCED) spr.forEach(s => {
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.x < 0 || s.x > VW - 16) s.vx *= -1;
      if (s.y < 12 || s.y > 190) s.vy *= -1;
      s.x = clamp(s.x, 0, VW - 16); s.y = clamp(s.y, 12, 190);
    });
    draw();
    info.innerHTML = '<b>' + spr.length + '</b> OBJ sprites · each 16×16 · OAM stores X, Y, tile#, palette, priority, H/V flip — up to <b>128</b> total';
    if (visible && !REDUCED) raf = requestAnimationFrame(frame);
  }
  function kick() { if (visible && !raf) { last = 0; raf = requestAnimationFrame(frame); } }
  countR.addEventListener('input', () => { countV.textContent = countR.value; build(+countR.value); if (REDUCED) draw(); });
  segGroup(priBtns, 'pri', p => { behind = p === 'back'; draw(); });
  whenVisible(root, v => { visible = v; kick(); if (REDUCED) draw(); });
  window.addEventListener('resize', draw);
  countV.textContent = countR.value; build(+countR.value); draw();
}

/* ==========================================================================
   Module 06 — layer & priority toggler
   Four independent layers (BG3 far, BG2 hills, BG1 ground, OBJ hero) composited
   back-to-front with colour 0 transparent. Toggle any layer on/off.
   ========================================================================== */
function LayerLab(root) {
  const canvas = root.querySelector('.gfx');
  const ctx = canvas.getContext('2d');
  const toggles = root.querySelector('[data-ly-toggles]');
  const info = root.querySelector('[data-ly-info]');
  const VW = 256, VH = 176;
  const on = { bg3: true, bg2: true, bg1: true, obj: true };
  /* build each layer as an ImageData with alpha (0 index = transparent) */
  function layerBG3() {
    const im = new ImageData(VW, VH);
    for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) {
      const i = (y * VW + x) * 4;
      const t = y / VH; const c = [to8(4 + (10 - 4) * t | 0), to8(6 + (12 - 6) * t | 0), to8(14 + (28 - 14) * t | 0)];
      im.data[i] = c[0]; im.data[i + 1] = c[1]; im.data[i + 2] = c[2]; im.data[i + 3] = 255;
      // a few clouds
      const cl = Math.sin(x * 0.05 + 1) * 6 + 40;
      if (y > cl && y < cl + 8 && (x % 90) < 40) { im.data[i] = 220; im.data[i + 1] = 220; im.data[i + 2] = 235; }
    }
    return im;
  }
  function layerBG2() {
    const im = new ImageData(VW, VH);
    for (let x = 0; x < VW; x++) {
      const h = 96 + Math.sin(x * 0.03) * 22 + Math.sin(x * 0.11) * 8;
      for (let y = Math.floor(h); y < VH; y++) {
        const i = (y * VW + x) * 4; const c = PAL16[12];
        im.data[i] = to8(c[0]); im.data[i + 1] = to8(c[1]); im.data[i + 2] = to8(c[2]); im.data[i + 3] = 255;
      }
    }
    return im;
  }
  function layerBG1() {
    const im = new ImageData(VW, VH);
    const t = makeTiles()[2];
    for (let y = 140; y < VH; y++) for (let x = 0; x < VW; x++) {
      const c = PAL16[t[((y) % 8) * 8 + (x % 8)]];
      const i = (y * VW + x) * 4;
      im.data[i] = to8(c[0]); im.data[i + 1] = to8(c[1]); im.data[i + 2] = to8(c[2]); im.data[i + 3] = 255;
    }
    return im;
  }
  function layerOBJ() {
    const im = new ImageData(VW, VH);
    const cx = 128, cy = 120;
    for (let y = -14; y <= 14; y++) for (let x = -10; x <= 10; x++) {
      let v = 0;
      if (Math.abs(x) < 8 - Math.abs(y) * 0.3 && y > -12 && y < 10) v = 5;
      if (y > -8 && y < -2 && Math.abs(x) < 4) v = 2;
      if (!v) continue;
      const c = PAL16[v], px = cx + x, py = cy + y, i = (py * VW + px) * 4;
      im.data[i] = to8(c[0]); im.data[i + 1] = to8(c[1]); im.data[i + 2] = to8(c[2]); im.data[i + 3] = 255;
    }
    return im;
  }
  const L = { bg3: layerBG3(), bg2: layerBG2(), bg1: layerBG1(), obj: layerOBJ() };
  const composite = document.createElement('canvas'); composite.width = VW; composite.height = VH;
  const cctx = composite.getContext('2d');
  function build() {
    const out = new ImageData(VW, VH);
    // fill black
    for (let i = 0; i < out.data.length; i += 4) { out.data[i + 3] = 255; out.data[i] = 6; out.data[i + 1] = 5; out.data[i + 2] = 12; }
    ['bg3', 'bg2', 'bg1', 'obj'].forEach(k => {
      if (!on[k]) return;
      const s = L[k].data;
      for (let i = 0; i < s.length; i += 4) if (s[i + 3]) { out.data[i] = s[i]; out.data[i + 1] = s[i + 1]; out.data[i + 2] = s[i + 2]; }
    });
    cctx.putImageData(out, 0, 0);
  }
  function draw() {
    build();
    const dpr = fitCanvas(canvas);
    const W = canvas.width, H = canvas.height;
    const scale = Math.min(W / VW, H / VH);
    ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, W, H);
    const dw = VW * scale, dh = VH * scale;
    ctx.drawImage(composite, (W - dw) / 2, (H - dh) / 2, dw, dh);
    const active = Object.keys(on).filter(k => on[k]);
    info.innerHTML = 'back → front: BG3, BG2, BG1, OBJ · showing <b>' + active.length + '</b> layers · colour index 0 in each layer is <b>transparent</b>';
  }
  toggles.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.layer; on[k] = !on[k]; b.classList.toggle('on', on[k]); draw();
  }));
  window.addEventListener('resize', draw);
  draw();
}

/* ==========================================================================
   Module 07 — beam / scanline visualizer
   The electron beam sweeps a 256×224 raster left→right, top→bottom, past the
   right margin (H-blank) and bottom (V-blank). Blanking = the safe window to
   touch VRAM. Play/pause + speed.
   ========================================================================== */
function BeamLab(root) {
  const canvas = root.querySelector('.gfx');
  const ctx = canvas.getContext('2d');
  const speedR = root.querySelector('[data-beam-speed]');
  const speedV = root.querySelector('[data-beam-speed-val]');
  const playBtn = root.querySelector('[data-beam-play]');
  const info = root.querySelector('[data-beam-info]');
  const VW = 256, VH = 224, TOTL = 262, TOTD = 340;    // NTSC: 262 lines, 340 dots
  let playing = !REDUCED, visible = false, raf = null, last = 0;
  let dot = 0, line = 0;
  /* a simple scene to reveal as the beam paints it */
  const scene = document.createElement('canvas'); scene.width = VW; scene.height = VH;
  {
    const g = scene.getContext('2d'); const im = g.createImageData(VW, VH);
    for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) {
      const i = (y * VW + x) * 4;
      let r = 20 + y * 0.5, gg = 16 + Math.sin(x * 0.05) * 20 + y * 0.2, b = 60 + y * 0.3;
      if (y > 150) { r = 40; gg = 120 - (y - 150); b = 60; }
      const sun = Math.hypot(x - 200, y - 50); if (sun < 22) { r = 255; gg = 210; b = 90; }
      im.data[i] = clamp(r, 0, 255); im.data[i + 1] = clamp(gg, 0, 255); im.data[i + 2] = clamp(b, 0, 255); im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }
  function draw() {
    const dpr = fitCanvas(canvas);
    const W = canvas.width, H = canvas.height;
    const scale = Math.min((W - 20 * dpr) / TOTD, (H - 20 * dpr) / TOTL);
    const dw = VW * scale, dh = VH * scale;
    const ox = (W - TOTD * scale) / 2, oy = (H - TOTL * scale) / 2;
    ctx.clearRect(0, 0, W, H);
    /* whole raster area incl. blanking */
    ctx.fillStyle = '#0a0812'; ctx.fillRect(ox, oy, TOTD * scale, TOTL * scale);
    /* H-blank + V-blank shading */
    ctx.fillStyle = 'rgba(168,132,255,0.10)';
    ctx.fillRect(ox + VW * scale, oy, (TOTD - VW) * scale, TOTL * scale);   // right margin
    ctx.fillRect(ox, oy + VH * scale, TOTD * scale, (TOTL - VH) * scale);   // bottom
    /* reveal scene up to the beam */
    ctx.imageSmoothingEnabled = false;
    const revealed = line;
    if (revealed > 0) ctx.drawImage(scene, 0, 0, VW, Math.min(VH, revealed), ox, oy, dw, Math.min(VH, revealed) * scale);
    if (line < VH) {
      const px = Math.min(dot, VW);
      ctx.drawImage(scene, 0, line, px, 1, ox, oy + line * scale, px * scale, scale + 0.5);
    }
    /* beam dot */
    const bx = ox + Math.min(dot, TOTD) * scale, by = oy + line * scale;
    ctx.fillStyle = '#fff'; ctx.shadowColor = '#45e4d1'; ctx.shadowBlur = 10 * dpr;
    ctx.fillRect(bx - 1.5 * dpr, by, 3 * dpr, Math.max(1, scale));
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(57,47,87,0.9)'; ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, VW * scale, VH * scale);
    const blanking = dot >= VW || line >= VH;
    info.innerHTML = 'scanline <b>' + line + '</b>/' + TOTL + ' · dot <b>' + Math.floor(dot) + '</b>/' + TOTD
      + ' · ' + (blanking ? '<span class="a">BLANKING — safe to write VRAM/CGRAM/OAM</span>' : '<span class="m">active display — VRAM writes forbidden</span>');
  }
  function step(dt) {
    dot += dt * 340 * (+speedR.value);
    while (dot >= TOTD) { dot -= TOTD; line++; if (line >= TOTL) line = 0; }
  }
  function frame(ts) {
    raf = null;
    if (!last) last = ts;
    step(Math.min(0.05, (ts - last) / 1000)); last = ts;
    draw();
    if (playing && visible) raf = requestAnimationFrame(frame);
  }
  function kick() { if (playing && visible && !raf) { last = 0; raf = requestAnimationFrame(frame); } }
  function syncBtn() { playBtn.innerHTML = (playing ? ICON_STOP : ICON_PLAY) + (playing ? ' Pause beam' : ' Run beam'); }
  playBtn.addEventListener('click', () => { playing = !playing; syncBtn(); kick(); if (!playing) draw(); });
  speedR.addEventListener('input', () => { speedV.textContent = (+speedR.value).toFixed(1) + '×'; });
  whenVisible(root, v => { visible = v; kick(); });
  window.addEventListener('resize', draw);
  speedV.textContent = (+speedR.value).toFixed(1) + '×'; syncBtn(); draw();
}

/* ==========================================================================
   Module 09 — background-mode explorer
   Pick a mode 0-6; the panel lists each BG layer that exists in that mode with
   its bit depth and colour count, drawn as coloured bars.
   ========================================================================== */
function ModeLab(root) {
  const seg = root.querySelector('[data-mode-pick]');
  const wrap = root.querySelector('[data-mode-layers]');
  const info = root.querySelector('[data-mode-info]');
  /* [name, bpp, colours, note] per BG; OBJ always 4bpp/16 */
  const MODES = {
    0: { layers: [['BG1', 2, 4], ['BG2', 2, 4], ['BG3', 2, 4], ['BG4', 2, 4]], note: 'Four 2bpp layers — the most layers, fewest colours each. Each BG uses its own palette block.' },
    1: { layers: [['BG1', 4, 16], ['BG2', 4, 16], ['BG3', 2, 4]], note: 'The workhorse: two rich 4bpp layers plus a 2bpp layer often used for the HUD. Most SNES games live here.' },
    2: { layers: [['BG1', 4, 16], ['BG2', 4, 16]], note: 'Like Mode 1 minus BG3, but adds offset-per-tile: BG3 supplies per-column scroll offsets for BG1/BG2.' },
    3: { layers: [['BG1', 8, 256], ['BG2', 4, 16]], note: 'BG1 becomes a full 256-colour layer — lush backdrops, at the cost of VRAM and layer count.' },
    4: { layers: [['BG1', 8, 256], ['BG2', 2, 4]], note: '256-colour BG1 with a cheap BG2, plus offset-per-tile like Mode 2.' },
    5: { layers: [['BG1', 4, 16], ['BG2', 2, 4]], note: 'Hi-res: 512 pixels across (pseudo-hi-res). Used for sharper interfaces and some effects.' },
    6: { layers: [['BG1', 4, 16]], note: 'Hi-res single layer with offset-per-tile. Rare, specialised.' },
  };
  const COL = { 4: '#45e4d1', 16: '#a884ff', 256: '#ff5f9e' };
  function render(m) {
    const md = MODES[m];
    wrap.innerHTML = '';
    md.layers.forEach(([nm, bpp, cols]) => {
      const row = document.createElement('div'); row.className = 'ml';
      const bw = cols === 4 ? 22 : cols === 16 ? 55 : 100;
      row.innerHTML = '<span class="lname">' + nm + '</span>'
        + '<span class="bar" style="width:' + bw + '%;background:' + (COL[cols] || '#a884ff') + '"></span>'
        + '<span class="cnt">' + bpp + 'bpp · ' + cols + ' col</span>';
      wrap.appendChild(row);
    });
    const obj = document.createElement('div'); obj.className = 'ml';
    obj.innerHTML = '<span class="lname">OBJ</span><span class="bar" style="width:55%;background:#ffb14e"></span><span class="cnt">4bpp · 16 col ×8</span>';
    wrap.appendChild(obj);
    info.innerHTML = 'Mode <b>' + m + '</b> · ' + md.note;
  }
  segGroup(seg, 'mode', render);
  render('1');
}

/* ==========================================================================
   Module 10 — Mode 7 matrix explorer
   A 128×128 procedural map, transformed per pixel by the 2×2 affine matrix
   A/B/C/D (1.7.8 fixed point) around a centre. Optional per-scanline
   perspective (an HDMA fake) tilts it into an F-Zero floor.
   ========================================================================== */
function Mode7Lab(root) {
  const canvas = root.querySelector('.gfx');
  const ctx = canvas.getContext('2d');
  const rot = root.querySelector('[data-m7-rot]'), sc = root.querySelector('[data-m7-scale]');
  const rotV = root.querySelector('[data-m7-rot-val]'), scV = root.querySelector('[data-m7-scale-val]');
  const perspBtns = root.querySelector('[data-m7-persp]');
  const info = root.querySelector('[data-m7-info]');
  let persp = false, visible = false, raf = null, spin = 0, last = 0;
  const TW = 128;
  /* build the 128×128 map: checkerboard + coloured "road" cross */
  const tex = new Uint8Array(TW * TW * 3);
  for (let y = 0; y < TW; y++) for (let x = 0; x < TW; x++) {
    const i = (y * TW + x) * 3;
    const ch = ((x >> 4) + (y >> 4)) & 1;
    let c = ch ? PAL16[13] : PAL16[8];
    if (Math.abs(x - 64) < 10) c = PAL16[2];
    if (Math.abs(y - 64) < 10) c = PAL16[5];
    if (x < 3 || y < 3 || x > TW - 4 || y > TW - 4) c = PAL16[10];
    tex[i] = to8(c[0]); tex[i + 1] = to8(c[1]); tex[i + 2] = to8(c[2]);
  }
  const OW = 224, OH = 176;
  const off = document.createElement('canvas'); off.width = OW; off.height = OH;
  const octx = off.getContext('2d');
  const out = octx.createImageData(OW, OH);

  function render() {
    const ang = (+rot.value + spin) * Math.PI / 180;
    const zoom = +sc.value / 100;
    const A = Math.cos(ang) / zoom, B = -Math.sin(ang) / zoom;
    const C = Math.sin(ang) / zoom, D = Math.cos(ang) / zoom;
    rotV.textContent = Math.round((+rot.value + spin) % 360) + '°';
    scV.textContent = zoom.toFixed(2) + '×';
    const X0 = 64, Y0 = 64;
    const d = out.data;
    for (let sy = 0; sy < OH; sy++) {
      let a = A, b = B, c = C, dd = D;
      if (persp) {
        // horizon near top; rows farther down sample "closer" → divide by depth
        const depth = (sy - OH * 0.28) / (OH * 0.72);
        const k = 1 / Math.max(0.12, depth);
        a *= k; b *= k; c *= k; dd *= k;
      }
      const scx = OW / 2, scy = persp ? OH * 0.28 : OH / 2;
      for (let sx = 0; sx < OW; sx++) {
        const dx = sx - scx, dy = sy - scy;
        let tx = a * dx + b * dy + X0;
        let ty = c * dx + dd * dy + Y0;
        const i = (sy * OW + sx) * 4;
        if (persp && sy < OH * 0.28) { d[i] = 12; d[i + 1] = 10; d[i + 2] = 26; d[i + 3] = 255; continue; }
        tx = ((tx % TW) + TW) % TW; ty = ((ty % TW) + TW) % TW;
        const ti = ((ty | 0) * TW + (tx | 0)) * 3;
        d[i] = tex[ti]; d[i + 1] = tex[ti + 1]; d[i + 2] = tex[ti + 2]; d[i + 3] = 255;
      }
    }
    octx.putImageData(out, 0, 0);
    const dpr = fitCanvas(canvas);
    const W = canvas.width, H = canvas.height;
    const scale = Math.min(W / OW, H / OH);
    ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, W, H);
    ctx.drawImage(off, (W - OW * scale) / 2, (H - OH * scale) / 2, OW * scale, OH * scale);
    const fx = v => { const s = v < 0 ? '-' : ''; return s + (Math.abs(v) * 256 | 0); };
    info.innerHTML = 'affine matrix (1.7.8 fixed-point) · A=<b>' + fx(A) + '</b> B=<b>' + fx(B)
      + '</b> C=<b>' + fx(C) + '</b> D=<b>' + fx(D) + '</b> at $211B–$211E' + (persp ? ' · <span class="a">per-scanline HDMA perspective ON</span>' : '');
  }
  function frame(ts) {
    raf = null;
    if (!last) last = ts; const dt = (ts - last) / 1000; last = ts;
    if (!REDUCED) spin += dt * 18;
    render();
    if (visible && !REDUCED) raf = requestAnimationFrame(frame);
  }
  function kick() { if (visible && !raf && !REDUCED) { last = 0; raf = requestAnimationFrame(frame); } }
  [rot, sc].forEach(el => el.addEventListener('input', () => { if (REDUCED) render(); }));
  segGroup(perspBtns, 'persp', p => { persp = p === 'on'; render(); });
  whenVisible(root, v => { visible = v; kick(); if (REDUCED) render(); });
  window.addEventListener('resize', render);
  render();
}

/* ==========================================================================
   Module 11 — OBJ per-scanline limit demo
   Pile on sprites; the PPU can only fetch 32 sprites and 34 8×8 tiles of them
   per scanline. Sprites past the limit on a line drop out (the classic flicker).
   ========================================================================== */
function ObjLab(root) {
  const canvas = root.querySelector('.gfx');
  const ctx = canvas.getContext('2d');
  const countR = root.querySelector('[data-obj-count]');
  const countV = root.querySelector('[data-obj-count-val]');
  const pileBtn = root.querySelector('[data-obj-pile]');
  const info = root.querySelector('[data-obj-info]');
  const VW = 256, VH = 160;
  let sprites = [], pile = false, visible = false, raf = null, last = 0, phase = 0;
  function build(n) {
    sprites = [];
    for (let i = 0; i < n; i++) {
      sprites.push({ x0: Math.random() * (VW - 16), y0: Math.random() * (VH - 16), ph: Math.random() * 6.28, hue: (i * 47) % 16 });
    }
  }
  function draw() {
    const dpr = fitCanvas(canvas);
    const W = canvas.width, H = canvas.height;
    const scale = Math.min(W / VW, H / VH);
    const ox = (W - VW * scale) / 2, oy = (H - VH * scale) / 2;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a0812'; ctx.fillRect(ox, oy, VW * scale, VH * scale);
    /* positions this frame */
    const pos = sprites.map((s, i) => {
      let x, y;
      if (pile) { x = 40 + (i % 12) * 14; y = VH / 2 - 8 + Math.sin(phase + i) * 3; }
      else { x = s.x0 + Math.sin(phase + s.ph) * 20; y = s.y0 + Math.cos(phase * 0.7 + s.ph) * 12; }
      return { x: clamp(x, 0, VW - 16), y: clamp(y, 0, VH - 16), hue: s.hue };
    });
    /* per-scanline 32-sprite / 34-tile limit: each 16×16 sprite = 2 tiles wide covers 2 tile-columns */
    let overLines = 0, maxOnLine = 0;
    const drawn = new Set();
    for (let ln = 0; ln < VH; ln++) {
      const onLine = [];
      pos.forEach((p, idx) => { if (ln >= p.y && ln < p.y + 16) onLine.push(idx); });
      if (onLine.length > 32) overLines++;
      maxOnLine = Math.max(maxOnLine, onLine.length);
      let tiles = 0, shown = 0;
      for (const idx of onLine) {
        if (shown >= 32 || tiles + 2 > 34) break;   // range-over / time-over
        shown++; tiles += 2; drawn.add(ln * 1000 + idx);
      }
    }
    pos.forEach((p, idx) => {
      for (let y = 0; y < 16; y++) {
        const ln = Math.floor(p.y) + y;
        const visLine = drawn.has(ln * 1000 + idx);
        const c = PAL16[2 + (p.hue % 14)];
        ctx.fillStyle = visLine ? css5(c[0], c[1], c[2]) : 'rgba(120,110,150,0.12)';
        ctx.fillRect(ox + p.x * scale, oy + ln * scale, 16 * scale, scale + 0.5);
      }
    });
    ctx.strokeStyle = 'rgba(57,47,87,0.9)'; ctx.lineWidth = 1; ctx.strokeRect(ox, oy, VW * scale, VH * scale);
    info.innerHTML = '<b>' + sprites.length + '</b> sprites · busiest scanline holds <b>' + maxOnLine + '</b> · '
      + (overLines ? '<span class="m">' + overLines + ' scanlines over the 32-sprite limit → dropouts (flicker)</span>' : '<span class="a">under the 32-sprite / 34-tile limit — all shown</span>');
  }
  function frame(ts) {
    raf = null; if (!last) last = ts; phase += (ts - last) / 1000 * 1.2; last = ts;
    draw();
    if (visible && !REDUCED) raf = requestAnimationFrame(frame);
  }
  function kick() { if (visible && !raf) { last = 0; if (REDUCED) draw(); else raf = requestAnimationFrame(frame); } }
  countR.addEventListener('input', () => { countV.textContent = countR.value; build(+countR.value); if (REDUCED) draw(); });
  pileBtn.addEventListener('click', () => { pile = !pile; pileBtn.classList.toggle('on', pile); pileBtn.textContent = pile ? 'Spread out' : 'Pile on one line'; if (REDUCED) draw(); });
  whenVisible(root, v => { visible = v; kick(); });
  window.addEventListener('resize', draw);
  countV.textContent = countR.value; build(+countR.value); draw();
}

/* ==========================================================================
   Module 12 — colour-math blender
   Main screen + sub screen → result under add / add-half / sub / sub-half.
   Two RGB (5-bit) colour sets and an operation, with a live result swatch and
   a mock "window over backdrop" preview.
   ========================================================================== */
function ColorMathLab(root) {
  const mr = root.querySelector('[data-cm-mr]'), mg = root.querySelector('[data-cm-mg]'), mb = root.querySelector('[data-cm-mb]');
  const sr = root.querySelector('[data-cm-sr]'), sg = root.querySelector('[data-cm-sg]'), sb = root.querySelector('[data-cm-sb]');
  const opBtns = root.querySelector('[data-cm-op]');
  const swMain = root.querySelector('[data-cm-main]'), swSub = root.querySelector('[data-cm-sub]'), swRes = root.querySelector('[data-cm-res]');
  const info = root.querySelector('[data-cm-info]');
  let op = 'add';
  function calc(m, s) {
    let v;
    if (op === 'add') v = m + s;
    else if (op === 'addh') v = (m + s) >> 1;
    else if (op === 'sub') v = m - s;
    else v = (m - s) >> 1;
    return clamp(v, 0, 31);
  }
  function update() {
    const M = [+mr.value, +mg.value, +mb.value], S = [+sr.value, +sg.value, +sb.value];
    const R = [calc(M[0], S[0]), calc(M[1], S[1]), calc(M[2], S[2])];
    swMain.style.background = css5(M[0], M[1], M[2]);
    swSub.style.background = css5(S[0], S[1], S[2]);
    swRes.style.background = css5(R[0], R[1], R[2]);
    const label = { add: 'main + sub (clamp 31)', addh: '(main + sub) ÷ 2', sub: 'main − sub (clamp 0)', subh: '(main − sub) ÷ 2' }[op];
    info.innerHTML = 'result = <b>' + label + '</b> · main ' + hex15(word15(M[0], M[1], M[2]))
      + ' · sub ' + hex15(word15(S[0], S[1], S[2])) + ' → <b>' + hex15(word15(R[0], R[1], R[2])) + '</b> · used for glass, fades, spotlights';
  }
  [mr, mg, mb, sr, sg, sb].forEach(el => el.addEventListener('input', update));
  segGroup(opBtns, 'op', o => { op = o; update(); });
  update();
}

/* ==========================================================================
   Module 13 — HDMA raster studio
   Per-scanline register writes: a gradient backdrop, a per-line scroll "water"
   wave, or a mosaic block-down — each drawn by changing a value every scanline.
   ========================================================================== */
function HdmaLab(root) {
  const canvas = root.querySelector('.gfx');
  const ctx = canvas.getContext('2d');
  const seg = root.querySelector('[data-hd-mode]');
  const playBtn = root.querySelector('[data-hd-play]');
  const info = root.querySelector('[data-hd-info]');
  const VW = 256, VH = 200;
  const off = document.createElement('canvas'); off.width = VW; off.height = VH;
  const octx = off.getContext('2d');
  const img = octx.createImageData(VW, VH);
  /* a base picture for the water/mosaic effects */
  const base = new Uint8Array(VW * VH * 3);
  for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) {
    const i = (y * VW + x) * 3;
    const ch = ((x >> 4) + (y >> 4)) & 1;
    let c = ch ? PAL16[8] : PAL16[12];
    if (y > 120) c = ((x >> 3) & 1) ? PAL16[4] : PAL16[6];
    base[i] = to8(c[0]); base[i + 1] = to8(c[1]); base[i + 2] = to8(c[2]);
  }
  let mode = 'gradient', playing = !REDUCED, visible = false, raf = null, t = 0, last = 0;
  function render() {
    const d = img.data;
    for (let y = 0; y < VH; y++) {
      if (mode === 'gradient') {
        const k = y / VH;
        const r = 10 + 245 * k * (0.5 + 0.5 * Math.sin(t * 0.5));
        const g = 20 + 120 * k, b = 90 - 60 * k + 60 * (0.5 + 0.5 * Math.sin(t * 0.5 + 2));
        for (let x = 0; x < VW; x++) { const i = (y * VW + x) * 4; d[i] = clamp(r, 0, 255); d[i + 1] = clamp(g, 0, 255); d[i + 2] = clamp(b, 0, 255); d[i + 3] = 255; }
      } else if (mode === 'water') {
        const shift = Math.round(Math.sin(y * 0.13 + t * 2) * (2 + y * 0.05));
        for (let x = 0; x < VW; x++) {
          const sxp = ((x + shift) % VW + VW) % VW; const si = (y * VW + sxp) * 3; const i = (y * VW + x) * 4;
          d[i] = base[si]; d[i + 1] = base[si + 1]; d[i + 2] = base[si + 2]; d[i + 3] = 255;
        }
      } else { /* mosaic grows with y */
        const size = 1 + Math.floor((y / VH) * 10 * (0.6 + 0.4 * Math.sin(t)));
        for (let x = 0; x < VW; x++) {
          const bx = x - (x % size), by = y - (y % size);
          const si = (by * VW + bx) * 3; const i = (y * VW + x) * 4;
          d[i] = base[si]; d[i + 1] = base[si + 1]; d[i + 2] = base[si + 2]; d[i + 3] = 255;
        }
      }
    }
    octx.putImageData(img, 0, 0);
    const dpr = fitCanvas(canvas);
    const W = canvas.width, H = canvas.height;
    const scale = Math.min(W / VW, H / VH);
    ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, W, H);
    ctx.drawImage(off, (W - VW * scale) / 2, (H - VH * scale) / 2, VW * scale, VH * scale);
    const msg = { gradient: 'a colour written to the backdrop register on every scanline → a smooth sky', water: 'BG scroll rewritten per line → a rippling surface', mosaic: 'the mosaic register stepped per line → progressive pixelation' }[mode];
    info.innerHTML = '<b>' + mode + '</b> · ' + msg + ' — one HDMA channel, ~200 tiny writes per frame';
  }
  function frame(ts) { raf = null; if (!last) last = ts; t += (ts - last) / 1000; last = ts; render(); if (playing && visible) raf = requestAnimationFrame(frame); }
  function kick() { if (playing && visible && !raf) { last = 0; raf = requestAnimationFrame(frame); } }
  function syncBtn() { playBtn.innerHTML = (playing ? ICON_STOP : ICON_PLAY) + (playing ? ' Pause' : ' Animate'); }
  playBtn.addEventListener('click', () => { playing = !playing; syncBtn(); kick(); if (!playing) render(); });
  segGroup(seg, 'mode', m => { mode = m; render(); });
  whenVisible(root, v => { visible = v; kick(); });
  window.addEventListener('resize', render);
  syncBtn(); render();
}

/* ==========================================================================
   Module 14 — VRAM-port write simulator
   Set the VRAM address ($2116/7) and increment, then stream bytes through the
   data port ($2118/9) and watch the address auto-step and VRAM fill.
   ========================================================================== */
function VramLab(root) {
  const canvas = root.querySelector('.gfx');
  const ctx = canvas.getContext('2d');
  const incSeg = root.querySelector('[data-vr-inc]');
  const addrR = root.querySelector('[data-vr-addr]');
  const writeBtn = root.querySelector('[data-vr-write]');
  const fillBtn = root.querySelector('[data-vr-fill]');
  const resetBtn = root.querySelector('[data-vr-reset]');
  const rAddr = root.querySelector('[data-vr-raddr]'), rInc = root.querySelector('[data-vr-rinc]'), rCount = root.querySelector('[data-vr-rcount]');
  const GRID = 32;                       // show first 32×32 = 1024 words of VRAM
  const vram = new Uint16Array(GRID * GRID);
  let addr = 0, inc = 1, written = 0, seed = 12345;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; }
  function draw() {
    const dpr = fitCanvas(canvas);
    const W = canvas.width, H = canvas.height;
    const size = Math.min(W, H) - 12 * dpr, cell = size / GRID, x0 = (W - size) / 2, y0 = (H - size) / 2;
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < GRID * GRID; i++) {
      const x = i % GRID, y = (i / GRID) | 0, v = vram[i];
      if (v) { ctx.fillStyle = css5(v & 31, (v >> 5) & 31, (v >> 10) & 31); }
      else { ctx.fillStyle = '#0d0b16'; }
      ctx.fillRect(x0 + x * cell, y0 + y * cell, cell - 0.5, cell - 0.5);
    }
    /* address pointer */
    const ai = addr % (GRID * GRID), ax = ai % GRID, ay = (ai / GRID) | 0;
    ctx.strokeStyle = '#45e4d1'; ctx.lineWidth = 2 * dpr;
    ctx.strokeRect(x0 + ax * cell, y0 + ay * cell, cell, cell);
    rAddr.textContent = '$' + (addr & 0x7fff).toString(16).toUpperCase().padStart(4, '0');
    rInc.textContent = '+' + inc;
    rCount.textContent = written;
  }
  function writeWord(v) { vram[addr % (GRID * GRID)] = v & 0x7fff; addr = (addr + inc) & 0x7fff; written++; }
  writeBtn.addEventListener('click', () => { writeWord(rnd() & 0x7fff); draw(); });
  fillBtn.addEventListener('click', () => { for (let k = 0; k < 64; k++) writeWord(rnd() & 0x7fff); draw(); });
  resetBtn.addEventListener('click', () => { vram.fill(0); addr = (+addrR.value) | 0; written = 0; draw(); });
  addrR.addEventListener('input', () => { addr = (+addrR.value) | 0; draw(); });
  segGroup(incSeg, 'inc', v => { inc = +v; draw(); });
  window.addEventListener('resize', draw);
  draw();
}

/* ==========================================================================
   Module 15 — per-dot vs per-scanline
   A raster effect whose split point moves within each scanline (an HDMA-driven
   mid-line register change). A per-dot renderer follows the curve; a
   per-scanline renderer can only latch one value per line and stair-steps it.
   ========================================================================== */
function EmulateLab(root) {
  const cA = root.querySelector('[data-em-dot]');
  const cB = root.querySelector('[data-em-line]');
  const ctxA = cA.getContext('2d'), ctxB = cB.getContext('2d');
  const info = root.querySelector('[data-em-info]');
  const VW = 200, VH = 150;
  let visible = false, raf = null, t = 0, last = 0;
  function split(y, time) {
    // the register value the game rewrites mid-scanline; here: a moving boundary
    return VW / 2 + Math.sin(y * 0.06 + time) * VW * 0.32;
  }
  function render(canvas, cctx, perDot) {
    const im = cctx.createImageData ? null : null;
    const off = canvas.__off || (canvas.__off = document.createElement('canvas'));
    off.width = VW; off.height = VH;
    const octx = off.getContext('2d');
    const data = octx.createImageData(VW, VH);
    const d = data.data;
    for (let y = 0; y < VH; y++) {
      const boundary = perDot ? split(y, t) : split(y - (y % 8) + 4, t); // per-scanline: one latch per (coarse) line group
      for (let x = 0; x < VW; x++) {
        const left = x < boundary;
        const i = (y * VW + x) * 4;
        const c = left ? PAL16[10] : PAL16[6];
        d[i] = to8(c[0]); d[i + 1] = to8(c[1]); d[i + 2] = to8(c[2]); d[i + 3] = 255;
      }
    }
    octx.putImageData(data, 0, 0);
    const dpr = fitCanvas(canvas);
    const W = canvas.width, H = canvas.height;
    const scale = Math.min(W / VW, H / VH);
    cctx.imageSmoothingEnabled = false; cctx.clearRect(0, 0, W, H);
    cctx.drawImage(off, (W - VW * scale) / 2, (H - VH * scale) / 2, VW * scale, VH * scale);
  }
  function frame(ts) {
    raf = null; if (!last) last = ts; t += (ts - last) / 1000 * 1.3; last = ts;
    render(cA, ctxA, true); render(cB, ctxB, false);
    info.innerHTML = 'both render the same mid-scanline register change · <b>per-dot</b> follows the boundary smoothly · <span class="m">per-scanline</span> latches one value per line group and stair-steps it';
    if (visible && !REDUCED) raf = requestAnimationFrame(frame);
  }
  function kick() { if (visible && !raf) { last = 0; if (REDUCED) { render(cA, ctxA, true); render(cB, ctxB, false); } else raf = requestAnimationFrame(frame); } }
  whenVisible(root, v => { visible = v; kick(); });
  window.addEventListener('resize', () => { render(cA, ctxA, true); render(cB, ctxB, false); });
  render(cA, ctxA, true); render(cB, ctxB, false);
}

/* ------------------------------------------------------- hero ambient ----- */
/* A raster/scanline ornament: a bright electron beam sweeps down over a faint
   phosphor grid, leaving chunky coloured "pixels" behind — the whole course
   (framebuffer → beam → picture) in one motif. Reduced-motion aware. */
function heroAmbient(canvas) {
  const c = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let t = 0, raf = null, visible = true;
  function size() { const r = canvas.getBoundingClientRect(); canvas.width = r.width * dpr; canvas.height = r.height * dpr; }
  size(); window.addEventListener('resize', size);
  const cols = ['rgba(168,132,255,0.85)', 'rgba(255,95,158,0.8)', 'rgba(69,228,209,0.75)', 'rgba(255,177,78,0.8)'];
  function draw() {
    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    const cell = 14 * dpr;
    // faint phosphor grid of coloured pixels, brightened near the beam
    const beamY = (t * 0.18 % 1) * H;
    for (let y = 0; y < H; y += cell) {
      for (let x = W * 0.42; x < W; x += cell) {
        const n = ((x * 13 + y * 7) | 0) % 4;
        const near = Math.max(0, 1 - Math.abs(y - beamY) / (60 * dpr));
        const a = 0.06 + near * 0.7;
        c.fillStyle = cols[n].replace(/0\.\d+\)/, a.toFixed(2) + ')');
        c.fillRect(x + 1, y + 1, cell - 3, cell - 3);
      }
    }
    // the beam scanline
    c.fillStyle = 'rgba(236,232,246,0.85)'; c.shadowColor = '#45e4d1'; c.shadowBlur = 14 * dpr;
    c.fillRect(W * 0.42, beamY, W, 2 * dpr);
    c.shadowBlur = 0;
    // scanline mask
    c.save(); c.globalCompositeOperation = 'destination-out'; c.fillStyle = 'rgba(0,0,0,0.5)';
    for (let y = 0; y < H; y += 5 * dpr) c.fillRect(0, y, W, 1.6 * dpr);
    c.restore();
    if (!REDUCED) { t += 0.016; if (visible) raf = requestAnimationFrame(draw); else raf = null; }
  }
  whenVisible(canvas, v => { visible = v; if (v && !raf && !REDUCED) raf = requestAnimationFrame(draw); });
  draw();
}

/* ------------------------------------------------------- glossary tooltips */
function initTooltips() {
  const terms = [...document.querySelectorAll('.term[data-tip]')];
  if (!terms.length) return;
  const tip = document.createElement('div');
  tip.className = 'tip-bubble';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  let current = null;
  function place(el) {
    current = el;
    const esc = s => s.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
    const label = el.textContent.trim().replace(/\s+/g, ' ');
    tip.innerHTML = '<span class="tt">' + esc(label) + '</span> — ' + esc(el.getAttribute('data-tip'));
    tip.classList.add('show');
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight, pad = 10;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - tw - pad));
    let top = r.top - th - 10, below = false;
    if (top < 8) { top = r.bottom + 10; below = true; }
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    tip.classList.toggle('below', below);
    tip.style.setProperty('--arrow-x', (r.left + r.width / 2 - left) + 'px');
  }
  function hide(el) { if (!el || current === el) { tip.classList.remove('show'); current = null; } }
  terms.forEach(el => {
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    el.addEventListener('mouseenter', () => place(el));
    el.addEventListener('mouseleave', () => hide(el));
    el.addEventListener('focus', () => place(el));
    el.addEventListener('blur', () => hide(el));
    el.addEventListener('click', e => { e.stopPropagation(); current === el ? hide(el) : place(el); });
  });
  window.addEventListener('scroll', () => hide(current), true);
  window.addEventListener('resize', () => hide(current));
  document.addEventListener('click', () => hide(current));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(current); });
}

/* ------------------------------------------------------- scroll-spy nav    */
function scrollSpy() {
  const links = [...document.querySelectorAll('.toc a')];
  const map = new Map();
  links.forEach(a => { const id = a.getAttribute('href').slice(1); const el = document.getElementById(id); if (el) map.set(el, a); });
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        links.forEach(l => l.classList.remove('active'));
        const a = map.get(e.target); if (a) a.classList.add('active');
      }
    });
  }, { rootMargin: '-20% 0px -72% 0px', threshold: 0 });
  map.forEach((_a, el) => obs.observe(el));
}

/* ------------------------------------------------------- reading progress  */
function readingProgress() {
  const fill = document.getElementById('progress-fill');
  const pct = document.getElementById('pct');
  const links = [...document.querySelectorAll('.toc a')];
  const modules = links.map(a => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
  let ticking = false;
  function update() {
    ticking = false;
    const doc = document.documentElement;
    const max = doc.scrollHeight - doc.clientHeight;
    const p = max > 0 ? Math.min(1, doc.scrollTop / max) : 0;
    if (fill) fill.style.width = (p * 100).toFixed(1) + '%';
    if (pct) pct.textContent = Math.round(p * 100) + '%';
    const mark = doc.clientHeight * 0.4;
    modules.forEach((el, i) => {
      const top = el.getBoundingClientRect().top;
      if (top < mark) links[i].classList.add('done');
      else links[i].classList.remove('done');
    });
  }
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  window.addEventListener('resize', update);
  update();
}

/* ==========================================================================
   Wire-up
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  const heroCanvas = document.getElementById('hero-raster');
  if (heroCanvas) heroAmbient(heroCanvas);

  const wire = (id, Ctor) => { const el = document.getElementById(id); if (el) Ctor(el); };
  wire('lab-pixels', PixelLab);
  wire('lab-palette', PaletteLab);
  wire('lab-tiles', BitplaneLab);
  wire('lab-tilemap', TilemapLab);
  wire('lab-sprites', SpriteLab);
  wire('lab-layers', LayerLab);
  wire('lab-beam', BeamLab);
  wire('lab-modes', ModeLab);
  wire('lab-mode7', Mode7Lab);
  wire('lab-obj', ObjLab);
  wire('lab-colormath', ColorMathLab);
  wire('lab-hdma', HdmaLab);
  wire('lab-vram', VramLab);
  wire('lab-emulate', EmulateLab);

  initTooltips();
  scrollSpy();
  readingProgress();

  /* mobile menu */
  const mb = document.getElementById('menu-btn');
  const sb = document.getElementById('sidebar');
  const scrim = document.getElementById('scrim');
  const closeMenu = () => { sb.classList.remove('open'); scrim.classList.remove('show'); };
  mb.addEventListener('click', () => { sb.classList.toggle('open'); scrim.classList.toggle('show'); });
  scrim.addEventListener('click', closeMenu);
  sb.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
});

const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" style="width:13px;height:13px"><path d="M8 5v14l11-7z"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 24 24" fill="currentColor" style="width:13px;height:13px"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
