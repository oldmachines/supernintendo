/* ============================================================================
   The Super NES Game Pak — interactive layer
   Everything you see is simulated in your browser with the Canvas API and a
   little vanilla DOM. No game ROM ships with this page; the labs recreate the
   cartridge's *behaviour* (ROM addressing, chip-select decoding, battery SRAM,
   the cartridge bus, LoROM/HiROM mapping, the enhancement chips and a ROM
   header) so you can watch the concepts, not the games.
   ============================================================================ */
'use strict';

/* ------------------------------------------------------------- helpers */

const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* devicePixelRatio-aware canvas sizing. The CSS height is fixed in the
   stylesheet (see the .scope comment there); we only sync the bitmap. */
function labCanvas(canvas) {
  const c = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let onResize = null;
  function resize() {
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    if (onResize) onResize();
  }
  resize();
  window.addEventListener('resize', resize);
  return {
    c, dpr,
    get W() { return canvas.width; },
    get H() { return canvas.height; },
    set onresize(fn) { onResize = fn; },
  };
}

/* Pause off-screen animations: each lab's rAF loop checks vis.visible and
   skips its drawing work while the lab is scrolled out of view. */
function watchVisibility(el) {
  const state = { visible: true };
  if ('IntersectionObserver' in window) {
    state.visible = false;
    const io = new IntersectionObserver(
      entries => entries.forEach(e => { state.visible = e.isIntersecting; }),
      { rootMargin: '120px' }
    );
    io.observe(el);
  }
  return state;
}

/* pointer position in canvas (device-pixel) coordinates */
function canvasPos(canvas, e, dpr) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * dpr,
    y: (e.clientY - r.top) * dpr,
  };
}

/* tiny deterministic pseudo-random generator (the same trick mask-ROM test
   patterns and the "junk" in unused cartridge space were filled with) */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/* palette (mirrors the CSS custom properties) */
const PAL = {
  cyan: '#45e4d1', violet: '#a884ff', magenta: '#ff5f9e', amber: '#ffb14e',
  good: '#5fd18b', bad: '#ff6a6a', ink: '#ece8f6', ink2: '#b7afce',
  muted: '#877f9e', line: '#2c2542', line2: '#392f57',
  panel: '#16121f', panel2: '#1d1830', ground: '#0c0a13',
};

function grid(c, W, H, cols, rows) {
  c.strokeStyle = 'rgba(90,78,130,0.16)';
  c.lineWidth = 1;
  for (let i = 1; i < cols; i++) { const x = W * i / cols; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
  for (let i = 1; i < rows; i++) { const y = H * i / rows; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
}

const hex = (n, w) => n.toString(16).toUpperCase().padStart(w || 2, '0');

/* ==========================================================================
   Lab 01 — ROM-read visualizer: drive an address, watch a byte on the bus
   ========================================================================== */
function RomReadLab(root) {
  const canvas = root.querySelector('canvas');
  const { c, dpr } = labCanvas(canvas);
  const vis = watchVisibility(root);

  // a 256-byte mask ROM, bits frozen at the "fab"
  const rng = makeRng(0x53464321);              // "SFC!"
  const ROM = new Uint8Array(256);
  for (let i = 0; i < 256; i++) ROM[i] = Math.floor(rng() * 256);

  let addr = 0x42;
  const slider = root.querySelector('[data-rom-addr]');
  const aHex = root.querySelector('[data-rom-ahex]');
  const dHex = root.querySelector('[data-rom-dhex]');
  slider.value = addr;
  slider.addEventListener('input', () => { addr = parseInt(slider.value, 10) & 0xFF; });

  function bitCol(row, cols, i) { return row & (1 << (cols - 1 - i)) ? PAL.cyan : PAL.line2; }

  let raf;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!vis.visible) return;
    const W = canvas.width, H = canvas.height;
    const data = ROM[addr];
    c.clearRect(0, 0, W, H);
    grid(c, W, H, 12, 4);
    c.font = `600 ${10 * dpr}px ui-monospace, monospace`;

    // ---- address lines coming in (left column) ----------------------------
    const bx = 10 * dpr, bw = 18 * dpr, bh = 18 * dpr, gap = 4 * dpr;
    c.fillStyle = PAL.muted;
    c.fillText('address in', bx, 16 * dpr);
    for (let i = 0; i < 8; i++) {
      const y = 26 * dpr + i * (bh + gap);
      const on = (addr >> (7 - i)) & 1;
      c.fillStyle = on ? 'rgba(69,228,209,0.9)' : PAL.panel2;
      c.strokeStyle = on ? PAL.cyan : PAL.line2; c.lineWidth = 1 * dpr;
      c.beginPath(); c.roundRect(bx, y, bw, bh, 4 * dpr); c.fill(); c.stroke();
      c.fillStyle = on ? PAL.ground : PAL.muted;
      c.fillText(String(on), bx + 6 * dpr, y + 13 * dpr);
      c.fillStyle = PAL.muted;
      c.fillText('A' + (7 - i), bx + bw + 5 * dpr, y + 13 * dpr);
    }

    // ---- the ROM cell grid (16 x 16) --------------------------------------
    const gX = 88 * dpr, gY = 24 * dpr, gW = W - gX - 150 * dpr, gH = H - gY - 18 * dpr;
    const cw = gW / 16, ch = gH / 16;
    const selR = addr >> 4, selC = addr & 0x0F;
    for (let r = 0; r < 16; r++) for (let col = 0; col < 16; col++) {
      const x = gX + col * cw, y = gY + r * ch;
      const sel = (r === selR && col === selC);
      c.fillStyle = sel ? 'rgba(255,177,78,0.9)' : 'rgba(168,132,255,0.07)';
      c.strokeStyle = sel ? PAL.amber : PAL.line;
      c.lineWidth = sel ? 2 * dpr : 1 * dpr;
      c.beginPath(); c.roundRect(x + 1 * dpr, y + 1 * dpr, cw - 2 * dpr, ch - 2 * dpr, 2 * dpr);
      c.fill(); c.stroke();
    }
    c.fillStyle = PAL.muted;
    c.fillText('mask ROM — 256 cells, bits fixed at the fab', gX, 16 * dpr);

    // ---- data lines out (right column) ------------------------------------
    const dxr = W - 120 * dpr;
    c.fillStyle = PAL.muted;
    c.fillText('data out', dxr, 16 * dpr);
    for (let i = 0; i < 8; i++) {
      const y = 26 * dpr + i * (bh + gap);
      const on = (data >> (7 - i)) & 1;
      c.fillStyle = on ? 'rgba(255,95,158,0.9)' : PAL.panel2;
      c.strokeStyle = on ? PAL.magenta : PAL.line2; c.lineWidth = 1 * dpr;
      c.beginPath(); c.roundRect(dxr, y, bw, bh, 4 * dpr); c.fill(); c.stroke();
      c.fillStyle = on ? PAL.ground : PAL.muted;
      c.fillText(String(on), dxr + 6 * dpr, y + 13 * dpr);
      c.fillStyle = PAL.muted;
      c.fillText('D' + (7 - i), dxr + bw + 5 * dpr, y + 13 * dpr);
    }
    // connective glow from selected cell to the data column
    const scx = gX + (selC + 0.5) * cw, scy = gY + (selR + 0.5) * ch;
    c.strokeStyle = 'rgba(255,95,158,0.5)'; c.lineWidth = 1.5 * dpr;
    c.beginPath(); c.moveTo(scx, scy); c.lineTo(dxr - 4 * dpr, H * 0.5); c.stroke();

    aHex.textContent = '$' + hex(addr, 2);
    dHex.textContent = '$' + hex(data, 2) + '  (%' + data.toString(2).padStart(8, '0') + ')';
  }
  raf = requestAnimationFrame(frame);
}

/* ==========================================================================
   Lab 02 — address decoder: which chip-select fires for an address?
   ========================================================================== */
function DecodeLab(root) {
  const canvas = root.querySelector('canvas');
  const { c, dpr } = labCanvas(canvas);
  const vis = watchVisibility(root);

  // the "system" banks $00–$3F / $80–$BF — the canonical SNES decode
  const REGIONS = [
    { name: 'WRAM mirror', cs: '/WRAM', lo: 0x0000, hi: 0x1FFF, col: PAL.cyan },
    { name: 'I/O & PPU/APU regs', cs: '/IO', lo: 0x2000, hi: 0x5FFF, col: PAL.violet },
    { name: 'expansion / SRAM window (HiROM carts)', cs: '/SRAM', lo: 0x6000, hi: 0x7FFF, col: PAL.amber },
    { name: 'cartridge ROM', cs: '/CART', lo: 0x8000, hi: 0xFFFF, col: PAL.magenta },
  ];
  let off = 0x8100;
  const slider = root.querySelector('[data-dec-off]');
  const offEl = root.querySelector('[data-dec-addr]');
  const csEl = root.querySelector('[data-dec-cs]');
  const csChip = csEl.closest('.readout');
  slider.value = off;
  slider.addEventListener('input', () => { off = parseInt(slider.value, 10) & 0xFFFF; });

  function regOf(o) { return REGIONS.find(r => o >= r.lo && o <= r.hi); }

  let raf;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!vis.visible) return;
    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    grid(c, W, H, 12, 4);
    c.font = `600 ${11 * dpr}px ui-monospace, monospace`;
    const reg = regOf(off);

    // ---- the 64 KB bank bar ----------------------------------------------
    const pad = 24 * dpr, barY = H * 0.30, barH = H * 0.24, span = W - pad * 2;
    c.fillStyle = PAL.muted;
    c.fillText('one system bank — offset $0000 … $FFFF', pad, barY - 12 * dpr);
    REGIONS.forEach(r => {
      const x0 = pad + span * r.lo / 0x10000, x1 = pad + span * (r.hi + 1) / 0x10000;
      const active = r === reg;
      c.fillStyle = active ? r.col : r.col + '33';
      c.beginPath(); c.roundRect(x0 + 1 * dpr, barY, x1 - x0 - 2 * dpr, barH, 4 * dpr); c.fill();
      c.fillStyle = active ? PAL.ground : PAL.ink2;
      c.font = `700 ${9.5 * dpr}px ui-monospace, monospace`;
      const cx = (x0 + x1) / 2;
      c.textAlign = 'center';
      if (x1 - x0 > 60 * dpr) c.fillText(r.cs, cx, barY + barH / 2 + 3 * dpr);
      c.textAlign = 'left';
      c.font = `600 ${11 * dpr}px ui-monospace, monospace`;
    });
    // pointer
    const px = pad + span * off / 0x10000;
    c.strokeStyle = PAL.ink; c.lineWidth = 2 * dpr;
    c.beginPath(); c.moveTo(px, barY - 8 * dpr); c.lineTo(px, barY + barH + 8 * dpr); c.stroke();
    c.fillStyle = PAL.ink;
    c.beginPath(); c.moveTo(px, barY - 8 * dpr); c.lineTo(px - 5 * dpr, barY - 16 * dpr); c.lineTo(px + 5 * dpr, barY - 16 * dpr); c.closePath(); c.fill();

    // ---- the decoding bits (top 3 address lines pick the region) ----------
    c.fillStyle = PAL.muted;
    c.fillText('the decoder watches the top address lines:', pad, H * 0.70);
    const bits = ['A15', 'A14', 'A13'];
    for (let i = 0; i < 3; i++) {
      const on = (off >> (15 - i)) & 1;
      const x = pad + i * 64 * dpr, y = H * 0.74;
      c.fillStyle = on ? 'rgba(69,228,209,0.85)' : PAL.panel2;
      c.strokeStyle = on ? PAL.cyan : PAL.line2; c.lineWidth = 1 * dpr;
      c.beginPath(); c.roundRect(x, y, 56 * dpr, 26 * dpr, 5 * dpr); c.fill(); c.stroke();
      c.fillStyle = on ? PAL.ground : PAL.muted;
      c.font = `700 ${11 * dpr}px ui-monospace, monospace`;
      c.fillText(bits[i] + '=' + on, x + 8 * dpr, y + 17 * dpr);
      c.font = `600 ${11 * dpr}px ui-monospace, monospace`;
    }
    c.fillStyle = reg.col;
    c.font = `700 ${13 * dpr}px ui-monospace, monospace`;
    c.fillText('→ ' + reg.cs + ' active  (' + reg.name + ')', pad + 210 * dpr, H * 0.74 + 17 * dpr);

    offEl.textContent = '$' + hex(off, 4);
    csEl.textContent = reg.cs;
    csChip.classList.toggle('good', reg.cs === '/CART');
    csChip.classList.toggle('warn', reg.cs === '/SRAM');
  }
  raf = requestAnimationFrame(frame);
}

/* ==========================================================================
   Lab 03 — battery SRAM: a save survives power-off; work RAM does not
   ========================================================================== */
function SramLab(root) {
  const canvas = root.querySelector('canvas');
  const { c, dpr } = labCanvas(canvas);
  const vis = watchVisibility(root);

  const N = 16;                          // "save slot" nibbles
  const PATTERN = [1, 9, 8, 7, 0, 3, 6, 15, 4, 2, 11, 8, 5, 12, 9, 14];
  let sram = new Array(N).fill(0);       // battery-backed
  let wram = new Array(N).fill(0);       // volatile
  let saved = false;
  let powered = true;

  const stEl = root.querySelector('[data-sram-state]');
  root.querySelector('[data-sram-write]').addEventListener('click', () => {
    if (!powered) return;
    sram = PATTERN.slice(); wram = PATTERN.slice(); saved = true;
  });
  root.querySelector('[data-sram-power]').addEventListener('click', () => {
    powered = !powered;
    if (!powered) {
      // console off: WRAM forgets (fills with settling garbage), SRAM held by coin cell
      const r = makeRng(Date.now() & 0xffff);
      wram = wram.map(() => Math.floor(r() * 16));
    }
  });

  function drawSlot(x, y, w, h, arr, alive, label, sub, batt) {
    c.fillStyle = PAL.panel; c.strokeStyle = alive ? PAL.cyan : PAL.line2; c.lineWidth = 1.4 * dpr;
    c.beginPath(); c.roundRect(x, y, w, h, 8 * dpr); c.fill(); c.stroke();
    c.fillStyle = PAL.ink; c.font = `700 ${12 * dpr}px ui-monospace, monospace`;
    c.fillText(label, x + 12 * dpr, y + 20 * dpr);
    c.fillStyle = PAL.muted; c.font = `600 ${10 * dpr}px ui-monospace, monospace`;
    c.fillText(sub, x + 12 * dpr, y + 36 * dpr);
    // battery
    if (batt) {
      const bcx = x + w - 26 * dpr, bcy = y + 22 * dpr;
      c.fillStyle = alive || batt ? PAL.good : PAL.muted;
      c.beginPath(); c.arc(bcx, bcy, 11 * dpr, 0, 7); c.fill();
      c.fillStyle = PAL.ground; c.font = `700 ${9 * dpr}px ui-monospace, monospace`;
      c.textAlign = 'center'; c.fillText('3V', bcx, bcy + 3 * dpr); c.textAlign = 'left';
    }
    // nibble cells
    const cw = (w - 24 * dpr) / N, cy = y + 48 * dpr, chh = h - 60 * dpr;
    for (let i = 0; i < N; i++) {
      const cx = x + 12 * dpr + i * cw, v = arr[i];
      const lit = v > 0;
      c.fillStyle = lit ? (alive ? 'rgba(69,228,209,0.28)' : 'rgba(255,106,106,0.25)') : 'rgba(168,132,255,0.05)';
      c.strokeStyle = lit ? (alive ? PAL.cyan : PAL.bad) : PAL.line;
      c.lineWidth = 1 * dpr;
      c.beginPath(); c.roundRect(cx + 1 * dpr, cy, cw - 2 * dpr, chh, 3 * dpr); c.fill(); c.stroke();
      c.fillStyle = lit ? PAL.ink : PAL.muted;
      c.font = `700 ${11 * dpr}px ui-monospace, monospace`;
      c.textAlign = 'center';
      c.fillText(v.toString(16).toUpperCase(), cx + cw / 2, cy + chh / 2 + 4 * dpr);
      c.textAlign = 'left';
    }
  }

  let raf;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!vis.visible) return;
    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    grid(c, W, H, 12, 4);

    // power banner
    c.font = `700 ${12 * dpr}px ui-monospace, monospace`;
    c.fillStyle = powered ? PAL.good : PAL.bad;
    c.fillText(powered ? '● POWER ON' : '○ POWER OFF', 14 * dpr, 22 * dpr);

    const pad = 14 * dpr, gapY = 12 * dpr;
    const w = W - pad * 2, h = (H - 40 * dpr - gapY) / 2;
    drawSlot(pad, 34 * dpr, w, h,
      sram, true, 'Battery-backed SRAM', 'kept alive by the coin cell', true);
    drawSlot(pad, 34 * dpr + h + gapY, w, h,
      powered ? wram : wram, powered, 'Work RAM (volatile)',
      powered ? 'holds data only while powered' : 'contents lost — settled to garbage', false);

    stEl.textContent = !saved ? 'no save written yet'
      : powered ? 'save in SRAM + copy in WRAM'
        : 'SRAM retained · WRAM lost';
    stEl.closest('.readout').classList.toggle('good', saved && !powered);
    stEl.closest('.readout').classList.toggle('bad', !powered && saved);
  }
  raf = requestAnimationFrame(frame);
}

/* ==========================================================================
   Lab 04 — cartridge-bus pinout explorer (hover a pin)
   ========================================================================== */
function PinoutLab(root) {
  const canvas = root.querySelector('canvas');
  const { c, dpr } = labCanvas(canvas);
  const vis = watchVisibility(root);

  const G = { addr: PAL.cyan, data: PAL.magenta, ctrl: PAL.amber, clk: PAL.violet, pwr: PAL.muted, aud: PAL.good, exp: '#58b7f0' };
  // a representative slice of the ~62-pin edge connector, two rows
  const top = [
    ['GND', 'pwr', 'Ground.'],
    ['A0', 'addr', 'Address line 0 — least-significant address bit from the 65816.'],
    ['A1', 'addr', 'Address line 1.'], ['A4', 'addr', 'Address line 4.'],
    ['A8', 'addr', 'Address line 8 — start of the high byte.'],
    ['A12', 'addr', 'Address line 12.'],
    ['A15', 'addr', 'Address line 15 — top of the 16-bit offset within a bank.'],
    ['BA4', 'addr', 'Bank-address line 4 — one of the eight BA0–BA7 pins that carry the 8-bit bank byte (the top of the 24-bit address). There are no literal A16–A23 pins.'],
    ['BA7', 'addr', 'Bank-address line 7 — the most-significant bank bit; A0–A15 plus BA0–BA7 together reach 16 MB.'],
    ['/RD', 'ctrl', 'Read strobe — pulled low when the CPU wants to read the addressed byte.'],
    ['/WR', 'ctrl', 'Write strobe — pulled low when the CPU writes (used for SRAM & chip regs).'],
    ['/CART', 'ctrl', 'Cartridge select — the decoded chip-select telling the pak "this access is yours".'],
    ['φ2', 'clk', 'The CPU clock brought out to the cart, so on-cart chips stay in step.'],
    ['EXP', 'exp', 'Expansion pin — spare bus lines that let extra chips hang off the CPU.'],
  ];
  const bot = [
    ['VCC', 'pwr', '+5 V supply for the cartridge.'],
    ['D0', 'data', 'Data line 0 — one of the 8 bidirectional data bits.'],
    ['D1', 'data', 'Data line 1.'], ['D3', 'data', 'Data line 3.'],
    ['D5', 'data', 'Data line 5.'], ['D7', 'data', 'Data line 7 — the 8th data bit; the bus moves one byte at a time.'],
    ['/RESET', 'ctrl', 'Reset — held low at power-up and when the console is reset.'],
    ['/IRQ', 'ctrl', 'Interrupt request — a cart chip (e.g. an enhancement chip) can signal the CPU.'],
    ['/REFRESH', 'ctrl', 'DRAM refresh timing pulse shared with the cartridge.'],
    ['/PARD', 'ctrl', 'Address-Bus-B read strobe — pulses low when the CPU reads a peripheral ("B bus") address; on-cart hardware can watch these accesses.'],
    ['SYSCLK', 'clk', 'The master system clock reference.'],
    ['SOUND-L', 'aud', 'Audio into the cart — lets a pak mix or pass through the console’s sound.'],
    ['SOUND-R', 'aud', 'The right audio channel routed through the connector.'],
    ['EXP', 'exp', 'A second expansion pin — spare connectivity; the real enabler for add-on chips is the ordinary address/data bus on the other pins.'],
  ];

  const name = root.querySelector('[data-pin-name]');
  const desc = root.querySelector('[data-pin-desc]');
  const panel = root.querySelector('[data-pin-panel]');
  let hoverKey = null;
  const rects = [];       // {x,y,w,h,pin}

  function layout() {
    rects.length = 0;
    const W = canvas.width, H = canvas.height;
    const pad = 16 * dpr;
    const rowH = 30 * dpr, pinGap = 6 * dpr;
    const cols = Math.max(top.length, bot.length);
    const pinW = (W - pad * 2 - (cols - 1) * pinGap) / cols;
    const y1 = H * 0.30, y2 = H * 0.60;
    top.forEach((p, i) => rects.push({ x: pad + i * (pinW + pinGap), y: y1, w: pinW, h: rowH, pin: p }));
    bot.forEach((p, i) => rects.push({ x: pad + i * (pinW + pinGap), y: y2, w: pinW, h: rowH, pin: p }));
  }

  canvas.addEventListener('pointermove', e => {
    const p = canvasPos(canvas, e, dpr);
    const hit = rects.find(r => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
    hoverKey = hit ? hit.pin[0] + '@' + hit.y : null;
    if (hit) {
      name.innerHTML = hit.pin[0] + ' <span class="tag">' + hit.pin[1] + '</span>';
      desc.textContent = hit.pin[2];
      panel.classList.remove('idle');
    }
  });
  canvas.addEventListener('pointerleave', () => { hoverKey = null; });
  canvas.style.cursor = 'crosshair';

  let raf;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!vis.visible) return;
    const W = canvas.width, H = canvas.height;
    layout();
    c.clearRect(0, 0, W, H);
    grid(c, W, H, 12, 3);
    c.font = `600 ${9.5 * dpr}px ui-monospace, monospace`;
    // gold connector substrate
    c.fillStyle = 'rgba(255,177,78,0.06)';
    c.beginPath(); c.roundRect(10 * dpr, H * 0.24, W - 20 * dpr, H * 0.50, 10 * dpr); c.fill();
    c.fillStyle = PAL.muted;
    c.fillText('the Game Pak edge connector — the CPU bus, brought to the pins (hover)', 16 * dpr, H * 0.18);

    rects.forEach(r => {
      const key = r.pin[0] + '@' + r.y;
      const col = G[r.pin[1]];
      const on = key === hoverKey;
      c.fillStyle = on ? col : 'rgba(255,206,106,0.10)';
      c.strokeStyle = on ? col : 'rgba(255,177,78,0.35)';
      c.lineWidth = on ? 2 * dpr : 1 * dpr;
      c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, 3 * dpr); c.fill(); c.stroke();
      c.fillStyle = on ? PAL.ground : col;
      c.textAlign = 'center';
      c.fillText(r.pin[0], r.x + r.w / 2, r.y + r.h / 2 + 3.5 * dpr);
      c.textAlign = 'left';
    });
  }
  raf = requestAnimationFrame(frame);
}

/* ==========================================================================
   Lab 05 — board explorer: click the parts on a Game Pak PCB
   ========================================================================== */
function BoardLab(root) {
  const canvas = root.querySelector('canvas');
  const { c, dpr } = labCanvas(canvas);
  const vis = watchVisibility(root);

  const PARTS = [
    { id: 'rom', label: 'Mask ROM', tag: 'always present', col: PAL.cyan,
      desc: 'The game itself: 4–48 Mbit of read-only memory with its bits fixed at the factory. Its data lines feed straight onto the cartridge bus.' },
    { id: 'sram', label: 'Save SRAM', tag: 'optional', col: PAL.amber,
      desc: 'A small static RAM (16–256 Kbit) that stores saved games. Written through /WR when the game addresses its SRAM window.' },
    { id: 'batt', label: 'Coin cell', tag: 'with SRAM', col: PAL.good,
      desc: 'A 3 V lithium battery that trickles current into the SRAM so a save survives with the console off. When it dies, saves vanish.' },
    { id: 'chip', label: 'Enhancement chip', tag: 'optional', col: PAL.magenta,
      desc: 'A coprocessor — Super FX, SA-1, a DSP, a decompressor — living on the bus beside the ROM. Covered in Part II.' },
    { id: 'cic', label: 'CIC lockout', tag: 'region lock', col: PAL.violet,
      desc: 'A tiny 4-bit microcontroller in a 16/18-pin package (F411/F413 family) that runs in lockstep with a twin chip in the console, both generating the same seeded bit-stream continuously; any mismatch holds the console in reset. Its keys separate NTSC from PAL — US and Japanese machines share the same NTSC CIC.' },
    { id: 'edge', label: 'Edge connector', tag: 'the bus', col: '#58b7f0',
      desc: 'The gold fingers that carry A0–A23, D0–D7, the strobes and clocks — the doorway between everything on this board and the CPU.' },
  ];
  let sel = null;
  const name = root.querySelector('[data-board-name]');
  const desc = root.querySelector('[data-board-desc]');
  const panel = root.querySelector('[data-board-panel]');
  const rects = {};

  function layout() {
    const W = canvas.width, H = canvas.height;
    rects.rom = { x: W * 0.08, y: H * 0.16, w: W * 0.34, h: H * 0.34 };
    rects.chip = { x: W * 0.50, y: H * 0.16, w: W * 0.26, h: H * 0.34 };
    rects.cic = { x: W * 0.80, y: H * 0.16, w: W * 0.13, h: H * 0.22 };
    rects.sram = { x: W * 0.08, y: H * 0.56, w: W * 0.22, h: H * 0.22 };
    rects.batt = { x: W * 0.33, y: H * 0.56, w: W * 0.14, h: H * 0.22 };
    rects.edge = { x: W * 0.08, y: H * 0.86, w: W * 0.85, h: H * 0.10 };
  }
  canvas.addEventListener('pointerdown', e => {
    const p = canvasPos(canvas, e, dpr);
    for (const part of PARTS) {
      const r = rects[part.id];
      if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
        sel = part.id;
        name.innerHTML = part.label + ' <span class="tag">' + part.tag + '</span>';
        desc.textContent = part.desc;
        panel.classList.remove('idle');
        return;
      }
    }
  });
  canvas.style.cursor = 'pointer';

  let raf;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!vis.visible) return;
    const W = canvas.width, H = canvas.height;
    layout();
    c.clearRect(0, 0, W, H);
    // green PCB
    c.fillStyle = 'rgba(69,228,209,0.05)';
    c.beginPath(); c.roundRect(6 * dpr, 6 * dpr, W - 12 * dpr, H - 12 * dpr, 12 * dpr); c.fill();
    c.strokeStyle = PAL.line2; c.lineWidth = 1 * dpr; c.stroke();
    c.font = `700 ${11 * dpr}px ui-monospace, monospace`;
    PARTS.forEach(part => {
      const r = rects[part.id];
      const on = sel === part.id;
      c.fillStyle = on ? part.col + '2e' : 'rgba(168,132,255,0.05)';
      c.strokeStyle = on ? part.col : PAL.line2;
      c.lineWidth = on ? 2.4 * dpr : 1.2 * dpr;
      c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, 6 * dpr); c.fill(); c.stroke();
      c.fillStyle = on ? PAL.ink : part.col;
      c.textAlign = 'center';
      c.fillText(part.label, r.x + r.w / 2, r.y + r.h / 2 + 4 * dpr);
      c.textAlign = 'left';
    });
    c.fillStyle = PAL.muted; c.font = `600 ${9.5 * dpr}px ui-monospace, monospace`;
    c.fillText('click a component', 12 * dpr, 18 * dpr);
  }
  raf = requestAnimationFrame(frame);
}

/* ==========================================================================
   Lab 06 — LoROM / HiROM address translator (both directions)
   ========================================================================== */
function MapsLab(root) {
  let map = 'lorom';
  const offIn = root.querySelector('[data-xl-off]');
  const addrOut = root.querySelector('[data-xl-addr]');
  const addrIn = root.querySelector('[data-xl-addr-in]');
  const offOut = root.querySelector('[data-xl-off-out]');
  const note = root.querySelector('[data-xl-note]');

  root.querySelectorAll('[data-xl-map]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-xl-map]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    map = b.dataset.xlMap;
    recalc();
  }));

  function parseHex(s) { const n = parseInt((s || '').replace(/[^0-9a-fA-F]/g, ''), 16); return isNaN(n) ? 0 : n; }

  function offToAddr(off) {
    if (off >= 0x400000) return null;              // ≥ 4 MB: no simple LoROM/HiROM mapping — warn, don't wrap
    if (map === 'lorom') {
      let bank = (off >> 15) & 0x7F;
      // CPU banks $7E/$7F are the console's WRAM, never cartridge ROM —
      // these offsets appear at the $FE/$FF mirror instead (set bit 7)
      if (bank >= 0x7E) bank |= 0x80;
      const addr = 0x8000 | (off & 0x7FFF);
      return (bank << 16) | addr;
    } else {
      const bank = 0xC0 + ((off >> 16) & 0x3F);
      return (bank << 16) | (off & 0xFFFF);
    }
  }
  function addrToOff(a) {
    const bank = (a >> 16) & 0xFF, o = a & 0xFFFF;
    if (bank === 0x7E || bank === 0x7F) return 'wram';   // WRAM banks under both maps
    if (map === 'lorom') {
      if (o < 0x8000) return null;                 // lower half isn't ROM in LoROM
      return ((bank & 0x7F) << 15) | (o & 0x7FFF);
    } else {
      if ((bank & 0x7F) < 0x40 && o < 0x8000) return null;
      return ((bank & 0x3F) << 16) | o;
    }
  }

  function recalc() {
    const off = parseHex(offIn.value);
    const addr = offToAddr(off);
    addrOut.textContent = addr === null ? '⚠ ≥ 4 MB — no simple map' : '$' + hex(addr & 0xFFFFFF, 6);
    const a = parseHex(addrIn.value);
    const o = addrToOff(a);
    offOut.textContent = o === 'wram' ? 'not ROM here — WRAM'
      : o === null ? 'not ROM here'
        : '$' + hex(o, 6);
    note.textContent = map === 'lorom'
      ? 'LoROM: 32 KB of ROM at $8000–$FFFF of each bank; file offset = (bank·$8000)+(addr−$8000). Banks $7E/$7F are WRAM — those slabs surface at $FE/$FF instead. Offsets ≥ 4 MB need ExHiROM-style mapping.'
      : 'HiROM: full 64 KB banks at $C0–$FF (also visible at $40–$7D); file offset = (bank·$10000)+addr, bank counted from $C0. Banks $7E/$7F are WRAM. Offsets ≥ 4 MB need ExHiROM.';
  }

  offIn.addEventListener('input', recalc);
  addrIn.addEventListener('input', recalc);
  offIn.value = '018000'; addrIn.value = 'C08000';
  recalc();
}

/* ==========================================================================
   Lab 07 — SRAM map + real-time-clock explorer
   ========================================================================== */
function SaveLab(root) {
  const SIZES = [16, 64, 128, 256];    // Kbit options (real carts bottom out at 16 Kbit / 2 KB)
  let idx = 2, map = 'lorom', rtc = false;
  const winEl = root.querySelector('[data-save-window]');
  const bytesEl = root.querySelector('[data-save-bytes]');
  const sizeVal = root.querySelector('#save-size-val');
  const rtcEl = root.querySelector('[data-save-rtcval]');
  const rtcChip = rtcEl.closest('.readout');

  root.querySelector('[data-save-size]').addEventListener('input', e => { idx = parseInt(e.target.value, 10); render(); });
  root.querySelectorAll('[data-save-map]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-save-map]').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); map = b.dataset.saveMap; render();
  }));
  root.querySelectorAll('[data-save-rtc]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-save-rtc]').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); rtc = b.dataset.saveRtc === 'on'; render();
  }));

  function render() {
    const kbit = SIZES[idx], kbytes = kbit / 8;
    const sizeStr = kbytes >= 1 ? kbytes + ' KB' : Math.round(kbit / 8 * 1024) + ' B';
    bytesEl.textContent = kbit + ' Kbit  (' + sizeStr + ')';
    if (sizeVal) sizeVal.textContent = kbit + ' Kbit';
    winEl.textContent = map === 'lorom'
      ? 'banks $70–$7D · $0000–$7FFF'
      : 'banks $20–$3F / $A0–$BF · $6000–$7FFF';
    rtcChip.classList.toggle('good', rtc);
  }

  let raf;
  function tick() {
    if (rtc) {
      const d = new Date();
      rtcEl.textContent = d.toLocaleTimeString();
    } else {
      rtcEl.textContent = 'no clock on cart';
    }
    raf = requestAnimationFrame(tick);
  }
  render();
  tick();
}

/* ==========================================================================
   Lab 08 — enhancement-chip catalog (filter + sort)
   ========================================================================== */
function CatalogLab(root) {
  const CHIPS = [
    { chip: 'Super FX (GSU)', cat: 'accelerator', clock: 10.7, role: 'RISC coprocessor with pixel-plot hardware; renders polygons into cart RAM', games: 'Star Fox, Stunt Race FX' },
    { chip: 'Super FX 2 (GSU-2)', cat: 'accelerator', clock: 21.4, role: 'Faster GSU revision, more RAM addressing', games: "Yoshi's Island, Doom" },
    { chip: 'SA-1', cat: 'accelerator', clock: 10.7, role: 'A second 65816 with fast RAM — logic, AI, decompression', games: 'Super Mario RPG, Kirby Super Star' },
    { chip: 'DSP-1 (µPD77C25)', cat: 'math', clock: 8.0, role: 'Fixed-point matrix/vector/trig for Mode 7 & 3D projection', games: 'Pilotwings, Super Mario Kart' },
    { chip: 'DSP-2', cat: 'math', clock: 8.0, role: 'Bitmap conversion & scaling variant of the µPD77C25', games: 'Dungeon Master' },
    { chip: 'DSP-3', cat: 'math', clock: 8.0, role: 'Bitplane conversion & data-shuffling variant of the µPD77C25', games: 'SD Gundam GX' },
    { chip: 'DSP-4', cat: 'math', clock: 8.0, role: 'Road/track projection math variant', games: "Top Gear 3000" },
    { chip: 'S-DD1', cat: 'compression', clock: 21.4, role: 'Real-time graphics decompression on the fly', games: 'Star Ocean, SF Alpha 2' },
    { chip: 'SPC7110', cat: 'compression', clock: 21.4, role: 'Data decompression + real-time clock', games: 'Far East of Eden Zero' },
    { chip: 'CX4', cat: 'math', clock: 20.0, role: 'Capcom trig/wireframe math for effects', games: 'Mega Man X2, X3' },
    { chip: 'OBC1', cat: 'other', clock: 0, role: 'Sprite/OAM management helper — shipped in exactly one game', games: "Metal Combat: Falcon's Revenge" },
    { chip: 'S-RTC', cat: 'other', clock: 0, role: 'Stand-alone real-time clock chip', games: 'Daikaijuu Monogatari II' },
    { chip: 'ST010 (DSP)', cat: 'math', clock: 11.0, role: 'µPD96050 math coprocessor variant', games: 'F1 ROC II' },
    { chip: 'ST011 (DSP)', cat: 'math', clock: 15.0, role: 'µPD96050 variant crunching shogi-AI board math', games: 'Hayazashi Nidan Morita Shougi' },
    { chip: 'ST018', cat: 'accelerator', clock: 21.4, role: 'A 32-bit ARM CPU core on the cartridge running shogi AI', games: 'Hayazashi Nidan Morita Shougi 2' },
  ];
  const tbody = root.querySelector('[data-cat-body]');
  let filter = 'all', sortKey = 'chip', sortDir = 1;

  root.querySelectorAll('[data-cat-filter]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-cat-filter]').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); filter = b.dataset.catFilter; render();
  }));
  root.querySelectorAll('th.sortable').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (k === sortKey) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
    root.querySelectorAll('th.sortable .ar').forEach(a => a.textContent = '');
    th.querySelector('.ar').textContent = sortDir > 0 ? '▲' : '▼';
    render();
  }));

  function render() {
    let rows = CHIPS.filter(x => filter === 'all' || x.cat === filter);
    rows.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'string') return av.localeCompare(bv) * sortDir;
      return (av - bv) * sortDir;
    });
    tbody.innerHTML = rows.map(x => {
      const pill = { accelerator: 'axwii', math: 'ax', compression: 'zelda', other: 'util' }[x.cat];
      return '<tr><td><b>' + x.chip + '</b></td>'
        + '<td><span class="pill ' + pill + '">' + x.cat + '</span></td>'
        + '<td><span class="crc">' + (x.clock ? x.clock.toFixed(1) + ' MHz' : '—') + '</span></td>'
        + '<td>' + x.role + '</td>'
        + '<td>' + x.games + '</td></tr>';
    }).join('');
  }
  render();
}

/* ==========================================================================
   Lab 09 — Super FX pixel-plot: build a rotating wireframe into a framebuffer
   ========================================================================== */
function SuperFxLab(root) {
  const canvas = root.querySelector('canvas');
  const { c, dpr } = labCanvas(canvas);
  const vis = watchVisibility(root);

  const FW = 40, FH = 34;                         // framebuffer resolution
  const fb = new Int8Array(FW * FH);
  let plotList = [];                              // pixels to plot this frame
  let head = 0;                                   // GSU plot cursor
  let angle = 0;
  let speed = 90;                                 // plots per frame (Rev1)
  let phase = 'plot';                             // plot | show
  let showT = 0;
  let plottedTotal = 0;

  const plotEl = root.querySelector('[data-fx-plotted]');
  const rateEl = root.querySelector('[data-fx-rate]');
  root.querySelectorAll('[data-fx-rev]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-fx-rev]').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); speed = b.dataset.fxRev === '2' ? 190 : 90;
  }));

  // a wireframe pyramid (Star-Fox flavour)
  const V = [[0, -1, 0], [-1, 0.7, -1], [1, 0.7, -1], [1, 0.7, 1], [-1, 0.7, 1]];
  const E = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [2, 3], [3, 4], [4, 1]];

  function project(v, a) {
    const cy = Math.cos(a), sy = Math.sin(a), cx = Math.cos(0.5), sx = Math.sin(0.5);
    let [x, y, z] = v;
    let x1 = x * cy - z * sy, z1 = x * sy + z * cy;
    let y2 = y * cx - z1 * sx, z2 = y * sx + z1 * cx;
    const d = 3.2, f = d / (d + z2);
    return [FW / 2 + x1 * f * 15, FH / 2 + y2 * f * 15];
  }
  function buildFrame() {
    fb.fill(0);
    plotList = [];
    const P = V.map(v => project(v, angle));
    E.forEach(([a, b]) => {
      const [x0, y0] = P[a], [x1, y1] = P[b];
      const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
      for (let s = 0; s <= steps; s++) {
        const t = steps ? s / steps : 0;
        const px = Math.round(x0 + (x1 - x0) * t), py = Math.round(y0 + (y1 - y0) * t);
        if (px >= 0 && px < FW && py >= 0 && py < FH) plotList.push(py * FW + px);
      }
    });
    head = 0;
  }
  buildFrame();

  let raf;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!vis.visible) return;
    const W = canvas.width, H = canvas.height;

    if (phase === 'plot') {
      const n = REDUCE_MOTION ? plotList.length : speed;
      for (let i = 0; i < n && head < plotList.length; i++) { fb[plotList[head]] = 1; head++; plottedTotal++; }
      if (head >= plotList.length) { phase = 'show'; showT = 0; }
    } else {
      showT += 1;
      if (showT > 26 || REDUCE_MOTION) { angle += 0.22; phase = 'plot'; buildFrame(); }
    }

    c.clearRect(0, 0, W, H);
    grid(c, W, H, 10, 4);
    // framebuffer area
    const pad = 14 * dpr, fbW = W - pad * 2 - 150 * dpr, fbH = H - pad * 2 - 20 * dpr;
    const px = fbW / FW, py = fbH / FH, ox = pad, oy = pad + 16 * dpr;
    c.fillStyle = '#07060d';
    c.fillRect(ox, oy, fbW, fbH);
    for (let i = 0; i < fb.length; i++) {
      if (!fb[i]) continue;
      const x = i % FW, y = (i / FW) | 0;
      const justPlotted = phase === 'plot' && plotList.indexOf(i) >= head - speed && plotList.indexOf(i) < head;
      c.fillStyle = justPlotted ? PAL.amber : PAL.cyan;
      c.fillRect(ox + x * px, oy + y * py, px - 1, py - 1);
    }
    // plot cursor
    if (phase === 'plot' && head < plotList.length) {
      const i = plotList[head], x = i % FW, y = (i / FW) | 0;
      c.strokeStyle = PAL.amber; c.lineWidth = 1.5 * dpr;
      c.strokeRect(ox + x * px - 1, oy + y * py - 1, px + 1, py + 1);
    }
    c.fillStyle = PAL.muted; c.font = `600 ${9.5 * dpr}px ui-monospace, monospace`;
    c.fillText('GSU framebuffer in cart RAM (' + FW + '×' + FH + ')', ox, oy - 5 * dpr);

    // status column
    const sx = W - 140 * dpr;
    c.font = `700 ${12 * dpr}px ui-monospace, monospace`;
    c.fillStyle = phase === 'plot' ? PAL.amber : PAL.cyan;
    c.fillText(phase === 'plot' ? 'PLOTTING…' : 'CPU reads frame', sx, oy + 24 * dpr);
    c.fillStyle = PAL.ink2; c.font = `600 ${10.5 * dpr}px ui-monospace, monospace`;
    c.fillText('pixels this frame:', sx, oy + 48 * dpr);
    c.fillStyle = PAL.cyan; c.fillText(head + ' / ' + plotList.length, sx, oy + 64 * dpr);

    plotEl.textContent = plottedTotal.toLocaleString();
    rateEl.textContent = (speed * 60 / 1000).toFixed(0) + 'k px/s (sim)';
  }
  raf = requestAnimationFrame(frame);
}

/* ==========================================================================
   Lab 10 — SA-1 vs main CPU throughput race
   ========================================================================== */
function Sa1Lab(root) {
  const canvas = root.querySelector('canvas');
  const { c, dpr } = labCanvas(canvas);
  const vis = watchVisibility(root);

  const WORK = 100;                     // arbitrary work units
  const MAIN_MHZ = 3.58, SA1_MHZ = 10.74;
  let mainP = 0, sa1P = 0, running = false;
  const mainEl = root.querySelector('[data-sa1-main]');
  const sa1El = root.querySelector('[data-sa1-sa1]');
  const spdEl = root.querySelector('[data-sa1-speed]');
  root.querySelector('[data-sa1-run]').addEventListener('click', () => {
    mainP = 0; sa1P = 0; running = true;
    mainEl.textContent = '…'; sa1El.textContent = '…';
  });

  function bar(y, h, frac, col, label, done) {
    const W = canvas.width, pad = 16 * dpr, span = W - pad * 2 - 120 * dpr;
    c.fillStyle = PAL.ink; c.font = `700 ${12 * dpr}px ui-monospace, monospace`;
    c.fillText(label, pad, y - 6 * dpr);
    c.fillStyle = PAL.panel2; c.strokeStyle = PAL.line2; c.lineWidth = 1 * dpr;
    c.beginPath(); c.roundRect(pad, y, span, h, 6 * dpr); c.fill(); c.stroke();
    c.fillStyle = col;
    c.beginPath(); c.roundRect(pad, y, span * Math.min(1, frac), h, 6 * dpr); c.fill();
    c.fillStyle = done ? PAL.good : PAL.ink2; c.font = `700 ${12 * dpr}px ui-monospace, monospace`;
    c.fillText(done ? '✓ done' : Math.round(frac * 100) + '%', pad + span + 12 * dpr, y + h / 2 + 4 * dpr);
  }

  let raf, last = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!vis.visible) { last = ts; return; }
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016); last = ts;
    if (running && !REDUCE_MOTION) {
      mainP = Math.min(WORK, mainP + MAIN_MHZ * dt * 8);
      sa1P = Math.min(WORK, sa1P + SA1_MHZ * dt * 8);
      if (mainP >= WORK && sa1P >= WORK) running = false;
    } else if (running && REDUCE_MOTION) { mainP = WORK; sa1P = WORK; running = false; }

    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    grid(c, W, H, 10, 4);
    c.fillStyle = PAL.muted; c.font = `600 ${10 * dpr}px ui-monospace, monospace`;
    c.fillText('same workload, two clocks — press Run', 16 * dpr, 20 * dpr);
    bar(H * 0.34, 26 * dpr, mainP / WORK, PAL.violet, 'Main CPU (5A22 · ' + MAIN_MHZ + ' MHz)', mainP >= WORK);
    bar(H * 0.68, 26 * dpr, sa1P / WORK, PAL.cyan, 'SA-1 (' + SA1_MHZ + ' MHz)', sa1P >= WORK);

    mainEl.textContent = Math.round(mainP) + '%';
    sa1El.textContent = Math.round(sa1P) + '%';
    spdEl.textContent = (SA1_MHZ / MAIN_MHZ).toFixed(1) + '× faster';
  }
  raf = requestAnimationFrame(frame);
}

/* ==========================================================================
   Lab 11 — DSP-1 style: project a rotating 3D wireframe with a matrix
   ========================================================================== */
function DspLab(root) {
  const canvas = root.querySelector('canvas');
  const { c, dpr } = labCanvas(canvas);
  const vis = watchVisibility(root);

  let yaw = 0.6, pitch = 0.5, auto = true;
  const yawR = root.querySelector('[data-dsp-yaw]');
  const pitchR = root.querySelector('[data-dsp-pitch]');
  yawR.addEventListener('input', () => { yaw = parseFloat(yawR.value) / 100; auto = false; });
  pitchR.addEventListener('input', () => { pitch = parseFloat(pitchR.value) / 100; auto = false; });
  const mEl = root.querySelector('[data-dsp-matrix]');

  // a cube
  const V = [];
  for (let x = -1; x <= 1; x += 2) for (let y = -1; y <= 1; y += 2) for (let z = -1; z <= 1; z += 2) V.push([x, y, z]);
  const E = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];

  let raf;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!vis.visible) return;
    if (auto && !REDUCE_MOTION) { yaw += 0.008; }
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // combined rotation matrix (the fixed-point 3×3 the DSP-1 multiplied by)
    const M = [
      [cy, 0, -sy],
      [sp * sy, cp, sp * cy],
      [cp * sy, -sp, cp * cy],
    ];
    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    grid(c, W, H, 10, 4);

    const cx = W * 0.36, ccy = H * 0.52, scale = Math.min(W, H) * 0.20;
    const P = V.map(v => {
      const x = M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2];
      const y = M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2];
      const z = M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2];
      const d = 4, f = d / (d + z);
      return [cx + x * f * scale, ccy + y * f * scale];
    });
    c.strokeStyle = PAL.cyan; c.lineWidth = 1.8 * dpr;
    c.shadowColor = PAL.cyan; c.shadowBlur = 6 * dpr;
    E.forEach(([a, b]) => { c.beginPath(); c.moveTo(P[a][0], P[a][1]); c.lineTo(P[b][0], P[b][1]); c.stroke(); });
    c.shadowBlur = 0;
    c.fillStyle = PAL.violet;
    P.forEach(p => { c.beginPath(); c.arc(p[0], p[1], 2.5 * dpr, 0, 7); c.fill(); });
    c.fillStyle = PAL.muted; c.font = `600 ${10 * dpr}px ui-monospace, monospace`;
    c.fillText('3D points → 2D screen', cx - scale, H * 0.9);

    // matrix readout
    const mx = W * 0.66, my = H * 0.28;
    c.fillStyle = PAL.muted;
    c.fillText('rotation matrix (fixed-point):', mx, my - 12 * dpr);
    c.font = `700 ${11 * dpr}px ui-monospace, monospace`;
    for (let r = 0; r < 3; r++) {
      let line = M[r].map(v => (v >= 0 ? ' ' : '') + v.toFixed(3)).join('  ');
      c.fillStyle = PAL.cyan;
      c.fillText('[ ' + line + ' ]', mx, my + r * 20 * dpr);
    }
    if (mEl) mEl.textContent = 'yaw ' + (yaw % (2 * Math.PI)).toFixed(2) + ' · pitch ' + pitch.toFixed(2);
  }
  raf = requestAnimationFrame(frame);
}

/* ==========================================================================
   Lab 12 — on-cart decompression (RLE/LZ in spirit of the S-DD1)
   ========================================================================== */
function DecompLab(root) {
  const canvas = root.querySelector('canvas');
  const { c, dpr } = labCanvas(canvas);
  const vis = watchVisibility(root);

  const GW = 16, GH = 16;
  // build a target image (a little mushroom-ish icon), palette 0..3
  const IMG = [];
  (function () {
    const rows = [
      '0000111111110000',
      '0001222222221000',
      '0012211221122100',
      '0122111221112210',
      '0122111221112210',
      '1221112222111221',
      '1221122112211221',
      '1222221221222221',
      '1222221221222221',
      '0122222222222210',
      '0012222222222100',
      '0000133333331000',
      '0001333333333100',
      '0013300000033100',
      '0013000000003100',
      '0001111111111000',
    ];
    for (const r of rows) for (const ch of r) IMG.push(+ch);
  })();
  const COLORS = ['#07060d', PAL.magenta, PAL.amber, PAL.cyan];

  // encode as tokens: literal(v,count) or copy(back,len) — a toy LZ/RLE
  const tokens = [];
  (function encode() {
    let i = 0;
    while (i < IMG.length) {
      // try a back-reference to earlier output
      let best = 0, bestBack = 0;
      for (let back = 1; back <= i && back <= 64; back++) {
        let len = 0;
        while (i + len < IMG.length && len < 34 && IMG[i + len - back] === IMG[i + len]) len++;
        if (len >= 3 && len > best) { best = len; bestBack = back; }
      }
      if (best >= 3) { tokens.push(['copy', bestBack, best]); i += best; continue; }
      // else RLE literal run of equal values
      let run = 1; while (i + run < IMG.length && IMG[i + run] === IMG[i] && run < 34) run++;
      tokens.push(['lit', IMG[i], run]); i += run;
    }
  })();

  const out = [];
  let tk = 0, running = true, stepT = 0;
  const ratioEl = root.querySelector('[data-dec-ratio]');
  const outEl = root.querySelector('[data-dec-out]');
  root.querySelector('[data-dec-reset]').addEventListener('click', () => { out.length = 0; tk = 0; running = true; });

  function step() {
    if (tk >= tokens.length) { running = false; return; }
    const [op, a, b] = tokens[tk++];
    if (op === 'lit') { for (let k = 0; k < b; k++) out.push(a); }
    else { for (let k = 0; k < b; k++) out.push(out[out.length - a]); }
  }

  let raf;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!vis.visible) return;
    if (running) {
      stepT += 1;
      if (REDUCE_MOTION) { while (running) step(); }
      else if (stepT % 6 === 0) step();
    }
    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    grid(c, W, H, 10, 4);
    c.font = `600 ${9.5 * dpr}px ui-monospace, monospace`;

    // token stream (left)
    const lx = 14 * dpr, ly = 30 * dpr;
    c.fillStyle = PAL.muted;
    c.fillText('compressed token stream (on cart):', lx, 18 * dpr);
    const shown = tokens.slice(Math.max(0, tk - 8), tk + 4);
    shown.forEach((t, idx) => {
      const real = Math.max(0, tk - 8) + idx;
      const y = ly + idx * 20 * dpr;
      const cur = real === tk;
      c.fillStyle = real < tk ? PAL.muted : (cur ? PAL.amber : PAL.ink2);
      const label = t[0] === 'lit'
        ? 'LIT  v=' + t[1] + ' ×' + t[2]
        : 'COPY back=' + t[1] + ' len=' + t[2];
      c.fillText((cur ? '▶ ' : '  ') + label, lx, y);
    });

    // output grid (right)
    const gx = W * 0.46, gy = 28 * dpr, gW = Math.min(W * 0.5, H - 44 * dpr), cell = gW / GW;
    c.fillStyle = PAL.muted; c.fillText('decompressed graphics in RAM:', gx, 18 * dpr);
    c.fillStyle = '#07060d'; c.fillRect(gx, gy, GW * cell, GH * cell);
    for (let i = 0; i < out.length; i++) {
      const x = i % GW, y = (i / GW) | 0;
      c.fillStyle = COLORS[out[i]];
      c.fillRect(gx + x * cell, gy + y * cell, cell - 1, cell - 1);
    }
    // fill cursor
    if (running && out.length < IMG.length) {
      const x = out.length % GW, y = (out.length / GW) | 0;
      c.strokeStyle = PAL.amber; c.lineWidth = 1.5 * dpr;
      c.strokeRect(gx + x * cell - 1, gy + y * cell - 1, cell + 1, cell + 1);
    }

    const inBytes = tokens.length * 2, outBytes = IMG.length;
    ratioEl.textContent = (outBytes / inBytes).toFixed(2) + ' : 1';
    outEl.textContent = out.length + ' / ' + IMG.length + ' px';
  }
  raf = requestAnimationFrame(frame);
}

/* ==========================================================================
   Lab 13 — ROM-header parser
   ========================================================================== */
function HeaderLab(root) {
  // sample carts: [title, mapByte $FFD5, chipByte $FFD6, romSz $FFD7, ramSz $FFD8, country $FFD9]
  const SAMPLES = {
    smw: ['SUPER MARIOWORLD', 0x20, 0x02, 0x09, 0x01, 0x01],
    zelda: ['THE LEGEND OF ZELDA', 0x20, 0x02, 0x0A, 0x03, 0x01],
    starfox: ['STAR FOX', 0x20, 0x14, 0x0A, 0x05, 0x01],       // GSU + RAM, no battery
    mariorpg: ['Super Mario RPG', 0x23, 0x35, 0x0C, 0x05, 0x01], // SA-1 + RAM + battery, 32 KB
    pilotwings: ['PILOTWINGS', 0x20, 0x03, 0x09, 0x00, 0x01],
  };
  const MAPS = { 0x20: 'LoROM', 0x21: 'HiROM', 0x22: 'LoROM (S-DD1)', 0x23: 'SA-1 ROM', 0x25: 'ExHiROM', 0x30: 'LoROM+FastROM', 0x31: 'HiROM+FastROM' };
  const COPRO = { 0x0: 'DSP', 0x1: 'GSU (Super FX)', 0x2: 'OBC1', 0x3: 'SA-1', 0x4: 'S-DD1', 0x5: 'S-RTC', 0xE: 'Other (CX4/SPC7110)', 0xF: 'Custom' };
  const COUNTRY = { 0x00: 'Japan (NTSC)', 0x01: 'USA (NTSC)', 0x02: 'Europe (PAL)', 0x03: 'Sweden (PAL)', 0x06: 'France (PAL)' };

  const grid = root.querySelector('[data-hdr-grid]');
  const strip = root.querySelector('[data-hdr-strip]');
  let smc = false;

  root.querySelectorAll('[data-hdr-sample]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-hdr-sample]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    decode(SAMPLES[b.dataset.hdrSample]);
  }));
  root.querySelectorAll('[data-hdr-smc]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-hdr-smc]').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); smc = b.dataset.hdrSmc === 'on';
    if (current) decode(current);
  }));

  let current = null;
  function decode(s) {
    current = s;
    const [title, mapB, chipB, romB, ramB, ctryB] = s;
    // build the 32-byte internal header window $FFC0..$FFDF
    const H = new Uint8Array(32);
    const t = title.toUpperCase().padEnd(21, ' ').slice(0, 21);
    for (let i = 0; i < 21; i++) H[i] = t.charCodeAt(i);
    H[0x15] = mapB; H[0x16] = chipB; H[0x17] = romB; H[0x18] = ramB; H[0x19] = ctryB;
    H[0x1A] = 0x01;                  // maker
    // fake but self-consistent checksum pair
    const cksum = 0x8000 ^ ((mapB << 8) | chipB) ^ (romB * 0x101);
    const compl = cksum ^ 0xFFFF;
    H[0x1C] = compl & 0xFF; H[0x1D] = (compl >> 8) & 0xFF;
    H[0x1E] = cksum & 0xFF; H[0x1F] = (cksum >> 8) & 0xFF;

    const map = MAPS[mapB] || 'unknown ($' + hex(mapB) + ')';
    const fast = (mapB & 0x10) ? 'FastROM (120 ns)' : 'SlowROM (200 ns)';
    const low = chipB & 0x0F, high = (chipB >> 4) & 0x0F;
    const hasCo = low >= 0x3;
    const hasRam = low === 1 || low === 2 || low === 4 || low === 5;  // low nibble 6 = copro+battery, no RAM
    const hasBatt = low === 2 || low === 5 || low === 6;
    const copro = hasCo ? (COPRO[high] || 'unknown') : 'none';
    const romKB = 1 << romB;               // 2^romB KB
    const ramKB = ramB ? (1 << ramB) : 0;
    const ctry = COUNTRY[ctryB] || 'region $' + hex(ctryB);
    const region = (ctryB === 0x00 || ctryB === 0x01 || ctryB === 0x0D) ? 'NTSC' : 'PAL';
    const cksOK = (compl === (cksum ^ 0xFFFF));

    grid.innerHTML = [
      ['Internal title', title.trim(), false],
      ['Map mode', map + '  <small>$' + hex(mapB) + '</small>', false, 'hot'],
      ['Speed', fast, false],
      ['Chipset', '$' + hex(chipB), false, 'hot'],
      ['Coprocessor', copro, false],
      ['On-cart RAM', hasRam ? romOrRam(ramKB) : 'none', false],
      ['Battery', hasBatt ? 'yes (save persists)' : 'no', false],
      ['ROM size', romOrRam(romKB) + '  <small>$' + hex(romB) + '</small>', false, 'size'],
      ['Region', ctry + ' · ' + region, false],
      ['Checksum', '$' + hex(cksum, 4) + ' / ~$' + hex(compl, 4), cksOK],
      ['Copier header', smc ? '512-byte SMC header present' : 'none (bare ROM)', false],
    ].map(([k, v, ok, kind]) => {
      const cls = ok ? 'hdr-cell ok' : (kind === 'hot' ? 'hdr-cell hot' : 'hdr-cell');
      return '<div class="' + cls + '"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
    }).join('');

    // hex strip $FFC0..$FFDF, highlight the decoded bytes and label a few
    // inline so the strip is readable without the table above
    const LABELS = { 0x00: 'title→', 0x15: '←map', 0x16: '←chip', 0x17: '←ROM sz', 0x18: '←RAM sz', 0x1E: '←cksum' };
    let html = smc ? '<b>[+512 SMC]</b>  ' : '';
    html += '$FFC0: ';
    for (let i = 0; i < 32; i++) {
      const b = hex(H[i]);
      let cls = '';
      if (i === 0x15) cls = 'hl-map';
      else if (i === 0x16) cls = 'hl-chip';
      else if (i === 0x17 || i === 0x18) cls = 'hl-size';
      if (i === 0x00) html += '<span class="blab">' + LABELS[0x00] + '</span>';
      html += cls ? '<span class="' + cls + '">' + b + '</span> ' : b + ' ';
      if (LABELS[i] && i !== 0x00) html += '<span class="blab">' + LABELS[i] + '</span> ';
    }
    strip.innerHTML = html;
  }
  function romOrRam(kb) { return kb >= 1024 ? (kb / 1024) + ' MB' : kb + ' KB'; }

  decode(SAMPLES.smw);
}

/* ==========================================================================
   Hero ambient — address/data bus lanes streaming across the board
   ========================================================================== */
function heroAmbient(canvas) {
  const c = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let t = 0, raf;
  function size() { const r = canvas.getBoundingClientRect(); canvas.width = r.width * dpr; canvas.height = r.height * dpr; }
  size(); window.addEventListener('resize', size);

  const LANES = 14;
  function draw() {
    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    for (let i = 0; i < LANES; i++) {
      const y = H * (i + 0.5) / LANES;
      const addr = i % 2 === 0;                    // alternate address / data lanes
      c.strokeStyle = addr ? 'rgba(69,228,209,0.10)' : 'rgba(255,177,78,0.09)';
      c.lineWidth = 1 * dpr;
      c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
      // moving "bit" packets
      const dir = addr ? 1 : -1;
      const speed = 40 + (i % 5) * 14;
      for (let k = 0; k < 5; k++) {
        const phase = ((t * speed + k * 220 + i * 60) % (W + 200)) - 100;
        const x = dir > 0 ? phase : W - phase;
        const on = (i * 7 + k * 3 + Math.floor(t)) % 2 === 0;
        c.fillStyle = addr
          ? (on ? 'rgba(69,228,209,0.55)' : 'rgba(69,228,209,0.14)')
          : (on ? 'rgba(255,177,78,0.5)' : 'rgba(255,177,78,0.12)');
        c.fillRect(x, y - 3 * dpr, 22 * dpr, 6 * dpr);
      }
    }
    // gold edge-connector band at the bottom
    const cy = H * 0.9;
    c.fillStyle = 'rgba(255,206,106,0.06)';
    c.fillRect(W * 0.55, 0, W * 0.02, H);
    t += REDUCE_MOTION ? 0 : 0.016;
    raf = requestAnimationFrame(draw);
    if (REDUCE_MOTION) cancelAnimationFrame(raf);
  }
  draw();
}

/* ==========================================================================
   Wire-up
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  const heroCanvas = document.getElementById('hero-cart');
  if (heroCanvas) heroAmbient(heroCanvas);

  const labs = [
    ['lab-romread', RomReadLab], ['lab-decode', DecodeLab], ['lab-sram', SramLab],
    ['lab-pinout', PinoutLab], ['lab-board', BoardLab], ['lab-maps', MapsLab],
    ['lab-save', SaveLab], ['lab-catalog', CatalogLab], ['lab-superfx', SuperFxLab],
    ['lab-sa1', Sa1Lab], ['lab-dsp', DspLab], ['lab-decomp', DecompLab],
    ['lab-header', HeaderLab],
  ];
  labs.forEach(([id, fn]) => { const el = document.getElementById(id); if (el) fn(el); });

  initTooltips();
  scrollSpy();
  readingProgress();

  const mb = document.getElementById('menu-btn');
  const sb = document.getElementById('sidebar');
  const scrim = document.getElementById('scrim');
  const closeMenu = () => { sb.classList.remove('open'); scrim.classList.remove('show'); };
  mb.addEventListener('click', () => { sb.classList.toggle('open'); scrim.classList.toggle('show'); });
  scrim.addEventListener('click', closeMenu);
  sb.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
});

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
    const label = el.textContent.trim().replace(/\s+/g, ' ');
    tip.innerHTML = '<span class="tt">' + label.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch])) + '</span> — ' +
      el.getAttribute('data-tip').replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
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
