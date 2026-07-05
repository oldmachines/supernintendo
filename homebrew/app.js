/* ============================================================================
   Super NES Homebrew — interactive layer
   Every lab on this page is a from-scratch teaching simulation: the playable
   Bounce capstone, a build-pipeline explorer, a steppable 65816 playground, a
   Mesen2-style event-viewer mock, an init-sequence simulator, a ROM-header
   builder, a pixel-to-planar editor, a PPU upload sequencer, a joypad register
   lab, a shadow-OAM visualiser, a frame-budget meter, a driver-command
   sequencer (with a Web-Audio stand-in for the S-DSP), a spot-the-bug gallery
   and a release checklist. No game code from any commercial ROM runs here;
   the demos recreate the *behaviour* a homebrewer programs against.
   ============================================================================ */
'use strict';

/* -------------------------------------------------------------- utilities */
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* Resize a canvas's bitmap to its CSS box × devicePixelRatio (capped at 2 —
   beyond that the glow blurs cost more than they show). Returns the 2d ctx. */
function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  return { ctx: canvas.getContext('2d'), W: canvas.width, H: canvas.height, dpr };
}

/* Run `onShow`/`onHide` as an element enters/leaves the viewport, so offscreen
   labs stop burning frames. Falls back to always-on if IO is unavailable. */
function whenVisible(el, onShow, onHide) {
  if (!('IntersectionObserver' in window)) { onShow(); return; }
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { e.isIntersecting ? onShow() : onHide(); });
  }, { rootMargin: '80px 0px' });
  obs.observe(el);
}

/* hex helpers — SNES assembly writes hex with a leading $ */
const hx = (v, n) => (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
const h2 = v => '$' + hx(v & 0xff, 2);
const h4 = v => '$' + hx(v & 0xffff, 4);
const h6 = v => '$' + hx(v & 0xffffff, 6);

/* deterministic PRNG so "garbage" renders identically every time */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------- tiny 3×5 pixel font
   Used by every simulated-TV renderer so text on the "console" screens is
   drawn as chunky pixels, never as browser type. Rows are 3-bit numbers. */
const PXFONT = {
  '0': [7, 5, 5, 5, 7], '1': [2, 6, 2, 2, 7], '2': [7, 1, 7, 4, 7], '3': [7, 1, 3, 1, 7],
  '4': [5, 5, 7, 1, 1], '5': [7, 4, 7, 1, 7], '6': [7, 4, 7, 5, 7], '7': [7, 1, 2, 2, 2],
  '8': [7, 5, 7, 5, 7], '9': [7, 5, 7, 1, 7],
  A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6],
  E: [7, 4, 6, 4, 7], G: [7, 4, 5, 5, 7], H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7],
  L: [4, 4, 4, 4, 7], M: [5, 7, 7, 5, 5], N: [5, 7, 7, 7, 5], O: [7, 5, 5, 5, 7],
  P: [7, 5, 7, 4, 4], R: [7, 5, 6, 5, 5], S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2],
  U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5], Y: [5, 5, 2, 2, 2],
  ' ': [0, 0, 0, 0, 0],
};

/* draw a string in the 3×5 font at pixel scale `s` */
function pxText(ctx, str, x, y, s, color) {
  ctx.fillStyle = color;
  for (let i = 0; i < str.length; i++) {
    const g = PXFONT[str[i].toUpperCase()] || PXFONT[' '];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) {
        if ((g[r] >> (2 - c)) & 1) ctx.fillRect(x + i * 4 * s + c * s, y + r * s, s, s);
      }
    }
  }
}

/* ------------------------------------------------- simulated-TV renderer
   Draws Bounce's court (or a broken version of it) onto a 256×224-ish canvas.
   Shared by the init, upload and spot-the-bug labs. All colours are quantised
   to 8-per-channel steps like the SNES's 15-bit palette would force. */
const TVCOL = {
  bg: '#100820', wall: '#5848c0', wallHi: '#8078e0', paddle: '#40d8c8',
  ball: '#f8f8f8', text: '#f8f8a0', dim: '#282048',
};
function drawScene(ctx, W, H, o) {
  o = o || {};
  const rnd = mulberry32(o.seed || 7);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (o.black) {
    if (o.blackLabel) pxText(ctx, o.blackLabel, 8, H - 14, 1, '#403860');
    return;
  }
  // backdrop + palette handling
  const pal = o.wrongColors
    ? { bg: '#a01050', wall: '#f8e000', wallHi: '#00e078', paddle: '#f80000', ball: '#3800f8', text: '#00f8f8' }
    : TVCOL;
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);

  if (o.garbageTiles) {
    // uncleared VRAM: pseudo-random tile junk everywhere
    for (let ty = 0; ty < H; ty += 8) {
      for (let tx = 0; tx < W; tx += 8) {
        if (rnd() < 0.6) {
          ctx.fillStyle = ['#583098', '#207068', '#804040', '#404040'][(rnd() * 4) | 0];
          ctx.fillRect(tx, ty, 8, 8);
          if (rnd() < 0.5) { ctx.fillStyle = '#181020'; ctx.fillRect(tx + 2, ty + 2, 4, 4); }
        }
      }
    }
  }

  if (!o.noWalls) {
    // court walls: top + sides, drawn as 8px tile strips
    ctx.fillStyle = pal.wall;
    ctx.fillRect(0, 16, W, 8);
    ctx.fillRect(0, 16, 8, H - 16);
    ctx.fillRect(W - 8, 16, 8, H - 16);
    ctx.fillStyle = pal.wallHi;
    for (let x = 0; x < W; x += 16) ctx.fillRect(x, 16, 8, 2);
    for (let y = 16; y < H; y += 16) { ctx.fillRect(0, y, 2, 8); ctx.fillRect(W - 2, y, 2, 8); }
  }

  // score line
  pxText(ctx, o.title || 'BOUNCE', 12, 4, 2, pal.text);
  pxText(ctx, o.score != null ? String(o.score).padStart(4, '0') : '0000', W - 60, 4, 2, pal.ball);

  // paddle + ball (skip if asked)
  if (!o.noSprites) {
    const px = o.paddleX != null ? o.paddleX : (W - 32) / 2;
    ctx.fillStyle = pal.paddle;
    ctx.fillRect(px, H - 18, 32, 6);
    const bx = o.ballX != null ? o.ballX : W / 2, by = o.ballY != null ? o.ballY : H / 2;
    ctx.fillStyle = pal.ball;
    ctx.fillRect(bx, by, 6, 6);
    if (o.ghostPaddle) {
      ctx.globalAlpha = 0.4; ctx.fillStyle = pal.paddle;
      ctx.fillRect(px - 26, H - 18, 32, 6);
      ctx.globalAlpha = 0.22;
      ctx.fillRect(px + 30, H - 18, 32, 6);
      ctx.globalAlpha = 1;
    }
    if (o.ballGhosts) {
      ctx.globalAlpha = 0.55;
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = pal.ball;
        ctx.fillRect(16 + rnd() * (W - 40), 30 + rnd() * (H - 70), 6, 6);
        ctx.globalAlpha *= 0.6;
      }
      ctx.globalAlpha = 1;
    }
  }

  if (o.straySprites) {
    // uncleared OAM: junk sprites crowding the picture
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = ['#f85898', '#f8b040', '#58f8a0', '#8080f8'][(rnd() * 4) | 0];
      ctx.fillRect((rnd() * (W - 8)) | 0, (rnd() * (H - 8)) | 0, 8, 8);
    }
  }

  if (o.tearing) {
    // writes outside vblank: torn/shifted bands
    for (let i = 0; i < 7; i++) {
      const y = (rnd() * (H - 12)) | 0, h = 3 + (rnd() * 7) | 0;
      const img = ctx.getImageData(0, y, W, h);
      ctx.putImageData(img, ((rnd() * 30) | 0) - 15, y);
      if (rnd() < 0.6) { ctx.fillStyle = '#000'; ctx.fillRect(0, y + h, W, 2); }
    }
  }

  if (o.halfDead) {
    ctx.fillStyle = '#000';
    ctx.fillRect(W / 2, 0, W / 2, H);
    pxText(ctx, 'EMULATOR', 20, H - 14, 1, '#405858');
    pxText(ctx, 'HARDWARE', W / 2 + 20, H - 14, 1, '#403860');
  }
}

/* ==========================================================================
   Modules 01 & 14 — Bounce, the capstone
   A complete paddle-and-ball game at the console's 256×224, with SNES-style
   quantised colours, 8.8 fixed-point physics (the same math Module 11
   teaches) and a pixel font — simulated in canvas, no ROM involved. The
   Module 14 instance adds an annotation overlay mapping each screen element
   to the module that builds it.
   ========================================================================== */
function BounceLab(root, opts) {
  opts = opts || {};
  const canvas = root.querySelector('[data-bounce-canvas]');
  const scoreEl = root.querySelector('[data-bounce-score]');
  const bestEl = root.querySelector('[data-bounce-best]');
  const livesEl = root.querySelector('[data-bounce-lives]');
  const msgEl = root.querySelector('[data-bounce-msg]');
  const annoBox = root.querySelector('[data-bounce-anno]');
  canvas.width = 256; canvas.height = 224;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const W = 256, H = 224;
  /* all positions/velocities in 8.8 fixed point — Module 11 for real */
  let mode = 'attract';                       // attract | play | over
  let padX, ballX, ballY, velX, velY, score, best = 0, lives, rally, blink = 0;
  let keyL = false, keyR = false, running = false, raf = null, acc = 0, last = 0;
  let flash = 0;                              // paddle-hit flash (the "blip")

  const FX = v => v << 8;                     // pixels → 8.8
  const PX = v => v >> 8;                     // 8.8 → pixels

  function resetBall(server) {
    ballX = FX(124); ballY = FX(100);
    velX = (Math.random() < 0.5 ? -1 : 1) * (FX(1) + 0x40);   // ±1.25 px/f
    velY = FX(1) + 0x80;                                       // 1.5 px/f
    if (server) rally = 0;
  }
  function resetGame() {
    padX = FX(112); score = 0; lives = 3; rally = 0;
    resetBall(true);
  }
  resetGame();

  function say(html) { if (msgEl) msgEl.innerHTML = html; }

  function stepGame() {
    blink++;
    if (flash > 0) flash--;
    if (mode !== 'play') return;

    // paddle: held direction moves 2.5 px/frame (8.8 again)
    if (keyL) padX -= FX(2) + 0x80;
    if (keyR) padX += FX(2) + 0x80;
    padX = clamp(padX, FX(8), FX(W - 8 - 32));

    // ball
    ballX += velX; ballY += velY;
    if (PX(ballX) <= 8) { ballX = FX(8); velX = Math.abs(velX); }
    if (PX(ballX) >= W - 8 - 6) { ballX = FX(W - 8 - 6); velX = -Math.abs(velX); }
    if (PX(ballY) <= 24) { ballY = FX(24); velY = Math.abs(velY); }

    // paddle collision (paddle at y = 206..211)
    const by = PX(ballY), bx = PX(ballX), pxl = PX(padX);
    if (velY > 0 && by + 6 >= 206 && by + 6 <= 214 && bx + 6 >= pxl && bx <= pxl + 32) {
      velY = -(Math.abs(velY) + 0x0C);                       // speed up each hit
      if (velY < -FX(4)) velY = -FX(4);
      const off = (bx + 3) - (pxl + 16);                     // english from hit point
      velX = clamp(velX + off * 12, -FX(3), FX(3));
      ballY = FX(200);
      rally++; score += 10;
      if (rally > best) best = rally;
      flash = 6;
      say('Rally <b>' + rally + '</b> — the ball is at ' +
        h4(ballX & 0xffff) + ' (8.8 fixed point: pixel ' + bx + ' + ' + (ballX & 0xff) + '/256).');
    }

    // miss
    if (by > H) {
      lives--;
      if (lives <= 0) {
        mode = 'over';
        say('<b>Game over.</b> Final score ' + score + '. Press <b>Start</b> to run it back.');
      } else {
        say('Missed — <b>' + lives + '</b> ball' + (lives === 1 ? '' : 's') + ' left. The serve resets the 8.8 velocity.');
        resetBall(true);
      }
    }
    render();
    if (scoreEl) scoreEl.textContent = score;
    if (bestEl) bestEl.textContent = best;
    if (livesEl) livesEl.textContent = lives;
  }

  function render() {
    ctx.fillStyle = TVCOL.bg;
    ctx.fillRect(0, 0, W, H);
    // walls
    ctx.fillStyle = flash > 0 ? TVCOL.wallHi : TVCOL.wall;
    ctx.fillRect(0, 16, W, 8);
    ctx.fillRect(0, 16, 8, H - 16);
    ctx.fillRect(W - 8, 16, 8, H - 16);
    ctx.fillStyle = TVCOL.wallHi;
    for (let x = 0; x < W; x += 16) ctx.fillRect(x, 16, 8, 2);
    // score row
    pxText(ctx, 'BOUNCE', 12, 4, 2, TVCOL.text);
    pxText(ctx, String(score).padStart(4, '0'), W - 60, 4, 2, TVCOL.ball);
    // sprites
    ctx.fillStyle = TVCOL.paddle;
    ctx.fillRect(PX(padX), 206, 32, 6);
    ctx.fillStyle = TVCOL.ball;
    ctx.fillRect(PX(ballX), PX(ballY), 6, 6);

    if (mode === 'attract' && (REDUCED || blink % 60 < 36)) {
      pxText(ctx, 'PRESS START', 106 - 22, 120, 2, TVCOL.text);
    }
    if (mode === 'over') {
      pxText(ctx, 'GAME OVER', 106 - 14, 120, 2, '#f85898');
    }

    if (opts.annotate && (!annoBox || annoBox.checked)) drawAnnotations();
  }

  function drawAnnotations() {
    ctx.save();
    ctx.font = '600 8px ui-monospace, monospace';
    ctx.textBaseline = 'top';
    const note = (x, y, w, h, label, color, tx, ty) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(x + .5, y + .5, w, h);
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.fillText(label, tx, ty);
    };
    note(0, 0, W - 1, 15, 'M07 tiles + M03 math: score', '#f8f8a0', 70, 17);
    note(0, 16, W - 1, 8, 'M07/08 tilemap via DMA', '#8078e0', 70, 26);
    note(PX(padX) - 2, 204, 36, 9, 'M10 OAM x2 + M09 input', '#40d8c8', clamp(PX(padX) - 40, 4, 130), 194);
    note(PX(ballX) - 2, PX(ballY) - 2, 9, 9, 'M11 8.8 motion', '#f8f8f8',
      clamp(PX(ballX) - 20, 4, 190), clamp(PX(ballY) - 12, 30, 200));
    ctx.fillStyle = '#5fd18b';
    ctx.fillText('M05 init + M06 header made this frame possible', 12, H - 10);
    if (flash > 0) { ctx.fillStyle = '#f85898'; ctx.fillText('M12: blip!', PX(padX), 180); }
    ctx.restore();
  }

  /* fixed-timestep loop: 60 logic steps/sec regardless of display rate */
  function loop(now) {
    if (!running) return;
    if (!last) last = now;
    acc += now - last; last = now;
    let guard = 0;
    while (acc >= 1000 / 60 && guard++ < 4) { stepGame(); acc -= 1000 / 60; }
    if (mode !== 'play') render();
    raf = requestAnimationFrame(loop);
  }
  function start() {
    if (running) return;
    running = true; last = 0; acc = 0;
    if (REDUCED && mode !== 'play') { render(); running = false; return; }
    raf = requestAnimationFrame(loop);
  }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = null; }

  /* ---- input: keyboard on the focused canvas, buttons, pointer drag ---- */
  canvas.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { keyL = true; e.preventDefault(); }
    if (e.key === 'ArrowRight') { keyR = true; e.preventDefault(); }
  });
  canvas.addEventListener('keyup', e => {
    if (e.key === 'ArrowLeft') keyL = false;
    if (e.key === 'ArrowRight') keyR = false;
  });
  canvas.addEventListener('pointerdown', e => {
    canvas.focus();
    dragTo(e);
  });
  canvas.addEventListener('pointermove', e => { if (e.buttons) dragTo(e); });
  function dragTo(e) {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * W;
    padX = clamp(FX(Math.round(x - 16)), FX(8), FX(W - 8 - 32));
    if (mode !== 'play' || REDUCED) { stepGame(); render(); }
  }
  function holdBtn(el, set) {
    if (!el) return;
    const on = e => { e.preventDefault(); set(true); el.classList.add('on'); };
    const off = () => { set(false); el.classList.remove('on'); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('pointercancel', off);
  }
  holdBtn(root.querySelector('[data-bounce-left]'), v => { keyL = v; });
  holdBtn(root.querySelector('[data-bounce-right]'), v => { keyR = v; });

  root.querySelector('[data-bounce-start]').addEventListener('click', () => {
    if (mode === 'over' || mode === 'attract') {
      if (mode === 'over') resetGame();
      mode = 'play';
      say('Ball served at 1.5 px/frame — <b>$0180</b> in 8.8. Every paddle hit adds a little to the velocity word.');
    }
    running = false; start();
    if (REDUCED) { running = true; raf = requestAnimationFrame(loop); }  // user asked to play
    canvas.focus();
  });
  root.querySelector('[data-bounce-reset]').addEventListener('click', () => {
    mode = 'attract'; resetGame(); render();
    if (scoreEl) scoreEl.textContent = 0;
    if (livesEl) livesEl.textContent = 3;
    say('Reset. The init ritual of Module 05 just ran, conceptually.');
  });
  if (annoBox) annoBox.addEventListener('change', render);

  whenVisible(root, start, stop);
  render();
}

/* ==========================================================================
   Module 02 — build-pipeline explorer
   Five stages from source to a running ROM. Click one to see its inputs,
   outputs and what its characteristic failure looks like.
   ========================================================================== */
function PipelineLab(root) {
  const rowEl = root.querySelector('[data-pl-row]');
  const detEl = root.querySelector('[data-pl-detail]');

  const STAGES = [
    {
      t: '1 · Edit', f: 'bounce.s · court.png',
      body: '<b>In:</b> your brain. <b>Out:</b> ca65 source files, plus art and sound assets waiting for conversion (Modules 07 and 12). ' +
        'This is the only stage with no machine to argue with — the arguments are all queued up downstream.',
      err: null,
    },
    {
      t: '2 · Assemble', f: 'ca65 → bounce.o',
      body: '<b>In:</b> one <code>.s</code> file. <b>Out:</b> an object file — assembled bytes plus the names it defines and the names it still needs. ' +
        '<b>Command:</b> <code>ca65 --cpu 65816 bounce.s -o bounce.o</code>. Errors here are <em>syntax and size</em>: a typo\'d mnemonic, ' +
        'a byte value over 255, a width-hint mismatch (Module 03).',
      err: 'bounce.s(87): Error: Range error (constant $180 too large for a byte)\nbounce.s(102): Error: Unknown identifier: ball_vx',
    },
    {
      t: '3 · Link', f: 'ld65 + bounce.cfg → image',
      body: '<b>In:</b> all object files and the linker config from Module 06. <b>Out:</b> a raw ROM image with every segment at its final address ' +
        '(code at $8000, header at $FFC0). Errors here are <em>placement</em>: a name no file defines, or a segment that simply does not fit.',
      err: 'ld65: Error: Unresolved external "move_ball" referenced in bounce.o\nld65: Error: Memory area "ROM" overflowed by 129 bytes',
    },
    {
      t: '4 · Pad + checksum', f: 'fix $FFDC–$FFDF → bounce.sfc',
      body: '<b>In:</b> the linked image. <b>Out:</b> a valid <code>.sfc</code>: padded to a clean power-of-two size, with the checksum/complement ' +
        'pair at $FFDC–$FFDF recomputed (Module 06). Skipping this doesn\'t stop the game running — it just makes every emulator nag and some ' +
        'flash-cart menus flag the ROM red.',
      err: '[Mesen2] Warning: invalid checksum ($1D3A, header says $FFFF)',
    },
    {
      t: '5 · Run', f: 'Mesen2 · bsnes',
      body: '<b>In:</b> bounce.sfc. <b>Out:</b> knowledge. Develop in <b>Mesen2</b> — breakpoints, memory viewer, the event viewer (Module 04) — ' +
        'and verify in <b>bsnes</b> for accuracy. Errors here are the interesting kind: the ROM is valid, the code assembled, and the screen is ' +
        'black anyway. That\'s what the WRAM debug byte is for.',
      err: '(black screen) → memory viewer: debug byte $7E00FF = $01\n→ init finished, upload never ran. Breakpoint on $2100 writes…',
    },
  ];

  let sel = 0;
  STAGES.forEach((s, i) => {
    if (i) {
      const a = document.createElement('span');
      a.className = 'pl-arrow'; a.textContent = '→'; a.setAttribute('aria-hidden', 'true');
      rowEl.appendChild(a);
    }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pl-stage';
    b.innerHTML = '<div class="t">' + s.t + '</div><div class="f">' + s.f + '</div>';
    b.addEventListener('click', () => { sel = i; render(); });
    rowEl.appendChild(b);
  });

  function render() {
    [...rowEl.querySelectorAll('.pl-stage')].forEach((b, i) => b.classList.toggle('on', i === sel));
    const s = STAGES[sel];
    detEl.innerHTML = s.body + (s.err
      ? '<div class="pl-err">' + s.err.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</div>'
      : '');
  }
  render();
}

/* ==========================================================================
   Module 03 — 65816 playground
   A fixed, real ca65 fragment simulated instruction by instruction: clear a
   16-byte buffer with an 8-bit count-down loop, then switch A to 16-bit and
   sum three score words. Registers, P flags (including M/X width), and the
   touched memory bytes are all live.
   ========================================================================== */
function AsmLab(root) {
  const listEl = root.querySelector('[data-asm-list]');
  const regEl = root.querySelector('[data-asm-regs]');
  const flagEl = root.querySelector('[data-asm-flags]');
  const memEl = root.querySelector('[data-asm-mem]');
  const narEl = root.querySelector('[data-asm-narrate]');
  const runBtn = root.querySelector('[data-asm-run]');

  /* the program: display lines; executable ones carry an op id */
  const LINES = [
    { txt: '  sep #$30      ; A,X → 8-bit', op: 'sep30' },
    { txt: '.a8', hint: true },
    { txt: '.i8', hint: true },
    { txt: '  ldx #$0F      ; count 15…0', op: 'ldx' },
    { txt: 'clear:', label: true },
    { txt: '  stz $0200,x   ; zero a byte', op: 'stz' },
    { txt: '  dex', op: 'dex' },
    { txt: '  bpl clear     ; while X ≥ 0', op: 'bpl' },
    { txt: '  rep #$20      ; A → 16-bit', op: 'rep20' },
    { txt: '.a16', hint: true },
    { txt: '  lda $0210     ; round 1 score', op: 'lda0' },
    { txt: '  clc', op: 'clc' },
    { txt: '  adc $0212     ; + round 2', op: 'adc1' },
    { txt: '  adc $0214     ; + round 3', op: 'adc2' },
    { txt: '  sta $0216     ; total', op: 'sta' },
    { txt: '  stp           ; halt (demo)', op: 'stp' },
  ];
  const CLEAR_IDX = LINES.findIndex(l => l.op === 'stz');

  let A, X, P, ip, halted, timer = null, mem;
  // P bits we track: N=0x80 V=0x40 M=0x20 X=0x10 Z=0x02 C=0x01
  const FLAGS = [['N', 0x80], ['V', 0x40], ['M', 0x20], ['X', 0x10], ['D', 0x08], ['I', 0x04], ['Z', 0x02], ['C', 0x01]];

  const lineEls = LINES.map(l => {
    const d = document.createElement('div');
    d.className = 'asm-line' + (l.hint ? ' hint' : '') + (l.label ? ' lbl' : '');
    d.innerHTML = '<span class="no"></span><span>' + l.txt.replace(/</g, '&lt;') + '</span>';
    listEl.appendChild(d);
    return d;
  });
  const regs = {};
  [['a', 'A'], ['x', 'X'], ['pc', 'next']].forEach(([k, label]) => {
    const r = document.createElement('div');
    r.className = 'tc-reg';
    r.innerHTML = '<div class="k">' + label + '</div><div class="v"></div>';
    regEl.appendChild(r);
    regs[k] = r;
  });
  const flagCells = FLAGS.map(([n]) => {
    const c = document.createElement('div');
    c.className = 'flag-cell'; c.textContent = n;
    flagEl.appendChild(c);
    return c;
  });
  // memory rows: $0200-0F buffer, $0210-17 scores/total
  const rows = [
    { base: 0x0200, n: 8 }, { base: 0x0208, n: 8 }, { base: 0x0210, n: 8 },
  ];
  const memCells = {};
  rows.forEach(r => {
    const d = document.createElement('div');
    d.className = 'mem-row';
    d.innerHTML = '<span class="a">' + h4(r.base) + '</span>';
    const bs = document.createElement('div');
    bs.className = 'bs';
    for (let i = 0; i < r.n; i++) {
      const b = document.createElement('span');
      b.className = 'mem-b';
      bs.appendChild(b);
      memCells[r.base + i] = b;
    }
    d.appendChild(bs);
    memEl.appendChild(d);
  });

  const JUNK = [0xAA, 0x3C, 0x7F, 0x01, 0xE2, 0x90, 0x55, 0x0B, 0xC4, 0x68, 0x12, 0xFE, 0x39, 0x81, 0xD7, 0x26];

  function reset() {
    mem = {};
    JUNK.forEach((b, i) => { mem[0x0200 + i] = b; });     // uncleared "hardware" junk
    // three 16-bit round scores, little-endian: 1234, 2345, 345
    const put16 = (a, v) => { mem[a] = v & 0xff; mem[a + 1] = (v >> 8) & 0xff; };
    put16(0x0210, 1234); put16(0x0212, 2345); put16(0x0214, 345); put16(0x0216, 0);
    A = 0; X = 0; P = 0x30; ip = 0; halted = false;
    narrate('Press <b>Step</b> to run one instruction, or <b>Run</b> to let it fly. The buffer starts full of power-on junk — on purpose.');
    render({});
  }
  function narrate(html) { narEl.innerHTML = html; }
  function setNZ8(v) { P = (P & ~0x82) | (v & 0x80) | (v === 0 ? 2 : 0); }
  function setNZ16(v) { P = (P & ~0x82) | ((v & 0x8000) ? 0x80 : 0) | (v === 0 ? 2 : 0); }

  function nextExec(from) {
    let i = from;
    while (i < LINES.length && !LINES[i].op) i++;
    return i;
  }

  function render(marks) {
    lineEls.forEach((el, i) => el.classList.toggle('cur', i === ip && !halted));
    const m8 = P & 0x20;
    regs.a.querySelector('.v').textContent = m8 ? h2(A) : h4(A);
    regs.a.classList.toggle('hot', marks.reg === 'a');
    regs.x.querySelector('.v').textContent = h2(X);
    regs.x.classList.toggle('hot', marks.reg === 'x');
    regs.pc.querySelector('.v').textContent = halted ? '—' : (LINES[ip].txt.trim().split(/\s+/)[0]);
    FLAGS.forEach(([, bit], i) => flagCells[i].classList.toggle('on', !!(P & bit)));
    Object.entries(memCells).forEach(([addr, el]) => {
      addr = +addr;
      el.textContent = hx(mem[addr] || 0, 2);
      el.classList.toggle('is-read', marks.read != null && addr >= marks.read && addr < marks.read + (marks.rn || 1));
      el.classList.toggle('is-write', marks.write != null && addr >= marks.write && addr < marks.write + (marks.wn || 1));
    });
  }

  function step() {
    if (halted) { narrate('<b>stp.</b> The demo CPU is halted — press <b>Reset</b> to run it again.'); return; }
    ip = nextExec(ip);
    const L = LINES[ip];
    let marks = {}, jump = null;
    const rd16 = a => (mem[a] || 0) | ((mem[a + 1] || 0) << 8);
    switch (L.op) {
      case 'sep30':
        P |= 0x30;
        narrate('<b>sep #$30</b> sets the M and X flags: A and the index registers are now <b>8-bit</b>. The <code>.a8/.i8</code> hints keep ca65 honest about it.');
        break;
      case 'ldx':
        X = 0x0F; setNZ8(X);
        narrate('<b>ldx #$0F</b> — the <code>#</code> means the <em>value</em> 15, not an address. X is our count-down loop counter.');
        marks = { reg: 'x' };
        break;
      case 'stz': {
        const a = 0x0200 + X;
        mem[a] = 0;
        narrate('<b>stz $0200,x</b> — store zero at $0200 + X = <b>' + h4(a) + '</b>. Indexed addressing walks the buffer one byte per lap.');
        marks = { write: a, reg: 'x' };
        break;
      }
      case 'dex':
        X = (X - 1) & 0xff; setNZ8(X);
        narrate('<b>dex</b> — X drops to <b>' + h2(X) + '</b>' + ((X & 0x80) ? ', wrapping to $FF: the N flag lights, which is exactly what bpl watches.' : ', and the flags update for free — no compare needed.'));
        marks = { reg: 'x' };
        break;
      case 'bpl':
        if (!(P & 0x80)) {
          jump = CLEAR_IDX;
          narrate('<b>bpl clear</b> — N is clear (X is still ≥ 0), so branch back. ' + (X + 1) + ' byte' + (X ? 's' : '') + ' still to clear.');
        } else {
          narrate('<b>bpl clear</b> — N is set: X wrapped past zero, all 16 bytes are cleared. The loop falls through. This dex/bpl shape is <em>the</em> 65xx loop.');
        }
        break;
      case 'rep20':
        P &= ~0x20;
        narrate('<b>rep #$20</b> clears M: the accumulator is now <b>16-bit</b> — watch its display widen. Scores are words, so we want word math.');
        marks = { reg: 'a' };
        break;
      case 'lda0':
        A = rd16(0x0210); setNZ16(A);
        narrate('<b>lda $0210</b> — a 16-bit load: bytes ' + h2(mem[0x0210]) + ' ' + h2(mem[0x0211]) + ' little-endian → A = <b>' + h4(A) + '</b> (' + A + ').');
        marks = { read: 0x0210, rn: 2, reg: 'a' };
        break;
      case 'clc':
        P &= ~1;
        narrate('<b>clc</b> — clear carry before the first add. adc always adds the carry bit in; starting a sum means starting it at zero.');
        break;
      case 'adc1': {
        const v = rd16(0x0212), r = A + v + (P & 1);
        P = (P & ~1) | (r > 0xffff ? 1 : 0); A = r & 0xffff; setNZ16(A);
        narrate('<b>adc $0212</b> — A + ' + v + ' = <b>' + A + '</b> (' + h4(A) + '). A CISC add: the operand came straight from memory.');
        marks = { read: 0x0212, rn: 2, reg: 'a' };
        break;
      }
      case 'adc2': {
        const v = rd16(0x0214), r = A + v + (P & 1);
        P = (P & ~1) | (r > 0xffff ? 1 : 0); A = r & 0xffff; setNZ16(A);
        narrate('<b>adc $0214</b> — A + ' + v + ' = <b>' + A + '</b>. Total of all three rounds, in one register.');
        marks = { read: 0x0214, rn: 2, reg: 'a' };
        break;
      }
      case 'sta':
        mem[0x0216] = A & 0xff; mem[0x0217] = (A >> 8) & 0xff;
        narrate('<b>sta $0216</b> — the 16-bit total <b>' + A + '</b> lands in memory, low byte first (little-endian): ' + h2(A & 0xff) + ' then ' + h2(A >> 8) + '.');
        marks = { write: 0x0216, wn: 2, reg: 'a' };
        break;
      case 'stp':
        halted = true;
        narrate('<b>stp</b> halts the demo. Buffer cleared, scores summed: <b>' + A + '</b>. In Bounce this shape runs sixty times a second instead of stopping.');
        setRunning(false);
        break;
    }
    ip = jump != null ? jump : nextExec(ip + 1);
    render(marks);
  }

  function setRunning(on) {
    if (on && !timer) { timer = setInterval(step, REDUCED ? 1100 : 550); runBtn.textContent = 'Pause'; }
    else if (!on && timer) { clearInterval(timer); timer = null; runBtn.textContent = 'Run'; }
  }
  root.querySelector('[data-asm-step]').addEventListener('click', () => { setRunning(false); step(); });
  runBtn.addEventListener('click', () => setRunning(!timer));
  root.querySelector('[data-asm-reset]').addEventListener('click', () => { setRunning(false); reset(); });
  whenVisible(root, () => {}, () => setRunning(false));
  reset();
}

/* ==========================================================================
   Module 04 — event-viewer mock
   One NTSC frame as Mesen2's event viewer draws it: 341 dots × 262 lines,
   with register accesses plotted at the beam position where they happened.
   Categories toggle; a "mistimed write" toggle plants the classic bug.
   ========================================================================== */
function EventLab(root) {
  const canvas = root.querySelector('[data-ev-canvas]');
  const legEl = root.querySelector('[data-ev-legend]');
  const narEl = root.querySelector('[data-ev-narrate]');

  const DOTS = 341, LINES = 262, VIS_W = 256, VIS_H = 225;   // picture: lines 0–224
  const rnd = mulberry32(99);

  function cluster(n, d0, d1, l0, l1) {
    const out = [];
    for (let i = 0; i < n; i++) out.push([d0 + rnd() * (d1 - d0), l0 + rnd() * (l1 - l0)]);
    return out;
  }
  const CATS = [
    { key: 'nmi', name: 'NMI fires', col: '#ffb14e', on: true, pts: [[12, 225]] },
    { key: 'oam', name: 'OAM DMA (544 B)', col: '#ff5f9e', on: true, pts: cluster(24, 30, 90, 225.3, 226.4) },
    { key: 'vram', name: 'VRAM writes (score tiles)', col: '#45e4d1', on: true, pts: cluster(14, 95, 200, 226.6, 227.8) },
    { key: 'cgram', name: 'CGRAM writes (flash colour)', col: '#a884ff', on: true, pts: cluster(4, 205, 240, 228, 228.9) },
    { key: 'joy', name: 'Joypad reads ($4218/9)', col: '#5fd18b', on: true, pts: cluster(4, 250, 290, 229, 230) },
    { key: 'bad', name: 'Mistimed VRAM write (bug!)', col: '#ff6a6a', on: false, pts: cluster(8, 40, 210, 60, 180) },
  ];

  CATS.forEach(c => {
    const l = document.createElement('label');
    l.className = 'ev-key';
    l.innerHTML = '<input type="checkbox" ' + (c.on ? 'checked' : '') + '><span class="sw" style="background:' + c.col + '"></span>' +
      c.name + ' · ' + c.pts.length;
    l.querySelector('input').addEventListener('change', e => { c.on = e.target.checked; draw(); narrate(); });
    legEl.appendChild(l);
  });

  function narrate() {
    const bad = CATS[5].on;
    narEl.innerHTML = bad
      ? 'Those <b style="color:#ff6a6a">red dots</b> are VRAM writes landing while the beam is mid-picture — the PPU is reading its memory at that moment, so the write is lost or misplaced. On screen: Module 13\'s torn-tiles card. In the event viewer: instantly obvious.'
      : 'A <b>healthy</b> Bounce frame: the NMI fires at line 225, then OAM DMA, score tiles, a palette poke and the joypad read all pack into the violet vblank band. The picture area stays untouched while the beam owns it.';
  }

  function draw() {
    const { ctx, W, H, dpr } = fitCanvas(canvas);
    ctx.clearRect(0, 0, W, H);
    const padL = 40 * dpr, padT = 18 * dpr, padR = 12 * dpr, padB = 14 * dpr;
    const sx = (W - padL - padR) / DOTS, sy = (H - padT - padB) / LINES;
    const X = d => padL + d * sx, Y = l => padT + l * sy;

    // picture area
    ctx.fillStyle = 'rgba(69,228,209,0.07)';
    ctx.fillRect(X(0), Y(0), VIS_W * sx, VIS_H * sy);
    // hblank strip (right of picture)
    ctx.fillStyle = 'rgba(135,127,158,0.06)';
    ctx.fillRect(X(VIS_W), Y(0), (DOTS - VIS_W) * sx, VIS_H * sy);
    // vblank band
    ctx.fillStyle = 'rgba(168,132,255,0.14)';
    ctx.fillRect(X(0), Y(VIS_H), DOTS * sx, (LINES - VIS_H) * sy);

    ctx.font = '600 ' + (10 * dpr) + 'px ui-monospace, monospace';
    ctx.fillStyle = '#45e4d1';
    ctx.fillText('picture · lines 0–224', X(6), Y(14));
    ctx.fillStyle = '#a884ff';
    ctx.fillText('vblank · lines 225–261', X(6), Y(250));
    ctx.fillStyle = '#877f9e';
    ctx.fillText('hblank', X(VIS_W + 12), Y(110));
    ctx.fillText('341 dots →', W - 78 * dpr, padT - 6 * dpr);
    [0, 112, 224, 261].forEach(l => {
      ctx.fillText(String(l), 6 * dpr, Y(l) + 3 * dpr);
    });
    // frame border + vblank line
    ctx.strokeStyle = '#2c2542'; ctx.lineWidth = dpr;
    ctx.strokeRect(X(0), Y(0), DOTS * sx, LINES * sy);
    ctx.strokeStyle = 'rgba(255,177,78,0.7)';
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.beginPath(); ctx.moveTo(X(0), Y(VIS_H)); ctx.lineTo(X(DOTS), Y(VIS_H)); ctx.stroke();
    ctx.setLineDash([]);

    // events
    CATS.forEach(c => {
      if (!c.on) return;
      ctx.fillStyle = c.col;
      c.pts.forEach(([d, l]) => {
        ctx.beginPath();
        ctx.arc(X(d), Y(l), (c.key === 'nmi' ? 3.4 : 2.2) * dpr, 0, 7);
        ctx.fill();
      });
    });
  }

  window.addEventListener('resize', draw);
  whenVisible(root, draw, () => {});
  draw(); narrate();
}

/* ==========================================================================
   Module 05 — init-sequence simulator
   The canonical boot checklist as toggles. The TV renders exactly what each
   omission produces; the WRAM step shows the one failure a TV can't show.
   ========================================================================== */
function InitLab(root) {
  const listEl = root.querySelector('[data-init-list]');
  const tv = root.querySelector('[data-init-tv]');
  const notesEl = root.querySelector('[data-init-notes]');
  tv.width = 256; tv.height = 224;
  const ctx = tv.getContext('2d');

  const STEPS = [
    { key: 'native', s: 'sei · clc · xce · rep/sep', d: 'interrupts off, native mode, register widths set' },
    { key: 'stack', s: 'ldx #$1FFF · txs', d: 'stack pointer parked at the top of low WRAM' },
    { key: 'fblank', s: '$2100 ← $8F', d: 'forced blank ON while we work on the PPU' },
    { key: 'vram', s: 'clear VRAM (64 KB)', d: 'DMA a zero into every word — no leftover tiles' },
    { key: 'cgram', s: 'clear CGRAM (512 B)', d: 'every palette entry black' },
    { key: 'oam', s: 'clear OAM (544 B)', d: 'all 128 sprites parked off-screen' },
    { key: 'wram', s: 'clear WRAM (128 KB)', d: 'every variable starts at a known zero' },
    { key: 'screen', s: 'upload art, then $2100 ← $0F', d: 'the curtain up — only at the very end' },
  ];
  const on = {};
  STEPS.forEach(st => { on[st.key] = true; });

  STEPS.forEach(st => {
    const l = document.createElement('label');
    l.className = 'init-item';
    l.innerHTML = '<input type="checkbox" checked><span><span class="s">' + st.s + '</span><span class="d">' + st.d + '</span></span>';
    l.querySelector('input').addEventListener('change', e => {
      on[st.key] = e.target.checked;
      l.classList.toggle('off', !e.target.checked);
      render();
    });
    listEl.appendChild(l);
  });

  function note(html, cls) {
    const d = document.createElement('div');
    d.className = 'tv-note' + (cls ? ' ' + cls : '');
    d.innerHTML = html;
    notesEl.appendChild(d);
  }

  function render() {
    notesEl.innerHTML = '';
    if (!on.native) {
      drawScene(ctx, 256, 224, { black: true, blackLabel: 'NO SIGNAL' });
      note('<b>Crash before the first frame.</b> Still in emulation mode, half the instruction set misbehaves and the widths are wrong — the code walks off a cliff within a few instructions.', 'bad');
      return;
    }
    if (!on.stack) {
      drawScene(ctx, 256, 224, { black: true, blackLabel: 'NO SIGNAL' });
      note('<b>Crash at the first jsr.</b> The return address is pushed to wherever S woke up pointing — possibly over your own variables — and rts returns into noise.', 'bad');
      return;
    }
    if (!on.screen) {
      drawScene(ctx, 256, 224, { black: true, blackLabel: 'FORCED BLANK' });
      note('<b>Black screen, healthy console.</b> Everything is initialised and uploaded — but forced blank was never released. The single most common first-ROM ending: add <code>$2100 ← $0F</code>.', '');
      if (!on.wram) wramNote();
      return;
    }
    drawScene(ctx, 256, 224, {
      seed: 11,
      garbageTiles: !on.vram,
      wrongColors: !on.cgram,
      straySprites: !on.oam,
      tearing: !on.fblank,
      score: 0,
    });
    if (on.vram && on.cgram && on.oam && on.fblank && on.wram) {
      note('<b>A stable frame.</b> Every step ran, in order. This picture is now boring — which is the entire goal of init code.', 'ok');
    }
    if (!on.fblank) note('<b>Uploading with the screen live:</b> the DMA raced the beam, so tiles landed shredded and torn. Forced blank exists so this can\'t happen.', 'bad');
    if (!on.vram) note('<b>Uncleared VRAM:</b> the PPU happily draws whatever the silicon woke up holding — a screenful of garbage tiles behind your court.', 'bad');
    if (!on.cgram) note('<b>Uncleared CGRAM:</b> right shapes, fever-dream colours. Palette entries are noise until you set them.', 'bad');
    if (!on.oam) note('<b>Uncleared OAM:</b> up to 128 junk sprites at random positions. Park every sprite off-screen (Y = $F0) at boot.', 'bad');
    if (!on.wram) wramNote();
  }
  function wramNote() {
    note('<b>The invisible one — uncleared WRAM.</b> This TV looks fine… <em>in an emulator that zeroes RAM</em>. Real silicon wakes with noise in every variable: flags "already set", pointers "already valid". Works in the emulator, dies on hardware — Module 13\'s heartbreaker.', '');
  }
  render();
}

/* ==========================================================================
   Module 06 — header & vector builder
   Fill the fields; the 64 bytes at $FFC0–$FFFF assemble live. The checksum
   is computed the way real tools do it: seed the four checksum bytes as
   $FF $FF $00 $00 (their byte-sum, $1FE, equals the byte-sum of any final
   complement/checksum pair), sum the whole ROM, write pair.
   ========================================================================== */
function HeaderLab(root) {
  const titleIn = root.querySelector('[data-hdr-title]');
  const mapSel = root.querySelector('[data-hdr-map]');
  const chipSel = root.querySelector('[data-hdr-chip]');
  const romSel = root.querySelector('[data-hdr-rom]');
  const regSel = root.querySelector('[data-hdr-region]');
  const dumpEl = root.querySelector('[data-hdr-dump]');
  const sumEl = root.querySelector('[data-hdr-sum]');
  const cplEl = root.querySelector('[data-hdr-cpl]');

  // handler addresses in our imaginary bank: reset $8000, nmi $80A0, irq stub $80A8
  const VEC = { nmiN: 0x80A0, irqN: 0x80A8, resetE: 0x8000, irqE: 0x80A8 };

  function bytes() {
    const b = new Array(64).fill(0);
    let t = (titleIn.value || '').toUpperCase();
    for (let i = 0; i < 21; i++) {
      const c = i < t.length ? t.charCodeAt(i) : 32;
      b[i] = (c >= 32 && c < 127) ? c : 32;
    }
    b[0x15] = +mapSel.value;       // $FFD5 map mode
    b[0x16] = +chipSel.value;      // $FFD6 chipset
    b[0x17] = +romSel.value;       // $FFD7 ROM size (log2 of KB)
    b[0x18] = 0x00;                // $FFD8 RAM size — Bounce saves nothing
    b[0x19] = +regSel.value;       // $FFD9 region
    b[0x1A] = 0x00;                // $FFDA developer id
    b[0x1B] = 0x00;                // $FFDB version
    // checksum seed: complement $FFFF, checksum $0000
    b[0x1C] = 0xFF; b[0x1D] = 0xFF; b[0x1E] = 0x00; b[0x1F] = 0x00;
    // vectors $FFE0–$FFFF (offsets $20–$3F): little-endian words
    const put = (off, v) => { b[off] = v & 0xff; b[off + 1] = (v >> 8) & 0xff; };
    put(0x2A, VEC.nmiN);           // $FFEA native NMI
    put(0x2E, VEC.irqN);           // $FFEE native IRQ
    put(0x3C, VEC.resetE);         // $FFFC emulation RESET — the power-on entry
    put(0x3E, VEC.irqE);           // $FFFE emulation IRQ/BRK
    return b;
  }

  function render() {
    const b = bytes();
    // checksum over a pretend 256 KB ROM: header + vectors + zero padding
    let sum = 0;
    b.forEach(v => { sum += v; });
    sum &= 0xffff;
    const cpl = sum ^ 0xffff;
    b[0x1C] = cpl & 0xff; b[0x1D] = cpl >> 8;
    b[0x1E] = sum & 0xff; b[0x1F] = sum >> 8;
    sumEl.textContent = h4(sum);
    cplEl.textContent = h4(cpl);

    const cls = i => {
      if (i < 21) return ' f-title';
      if (i >= 0x15 && i <= 0x19) return ' f-mode';
      if (i >= 0x1C && i <= 0x1F) return ' f-sum';
      if (i === 0x2A || i === 0x2B || i === 0x2E || i === 0x2F ||
          i === 0x3C || i === 0x3D || i === 0x3E || i === 0x3F) return ' f-vec';
      return '';
    };
    let html = '';
    for (let row = 0; row < 8; row++) {
      html += '<div class="hex-line"><span class="hex-a">' + h4(0xFFC0 + row * 8) + '</span>';
      for (let i = 0; i < 8; i++) {
        const off = row * 8 + i;
        html += '<span class="hex-b' + cls(off) + '" title="' + h4(0xFFC0 + off) + '">' + hx(b[off], 2) + '</span>';
      }
      html += '</div>';
    }
    dumpEl.innerHTML = html;
  }

  [titleIn, mapSel, chipSel, romSel, regSel].forEach(el =>
    el.addEventListener('input', render));
  render();
}

/* ==========================================================================
   Module 07 — pixel-to-planar editor
   A 16×16, 4-colour sprite editor that live-generates the exact 4bpp planar
   bytes (as four 8×8 tiles) and the BGR15 palette words, downloadable as a
   ca65 source file. Everything is computed client-side.
   ========================================================================== */
function PixelLab(root) {
  const canvas = root.querySelector('[data-px-canvas]');
  const palEl = root.querySelector('[data-px-pal]');
  const prev = root.querySelector('[data-px-preview]');
  const readEl = root.querySelector('[data-px-read]');
  const bytesEl = root.querySelector('[data-px-bytes]');
  const ctx = canvas.getContext('2d');
  const pctx = prev.getContext('2d');
  const CELL = canvas.width / 16;

  const PAL = [
    { rgb: [16, 8, 32], name: 'index 0 · backdrop' },
    { rgb: [248, 248, 248], name: 'index 1' },
    { rgb: [64, 216, 200], name: 'index 2' },
    { rgb: [248, 88, 152], name: 'index 3' },
  ];
  const css = c => 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
  const bgr15 = c => ((c[2] >> 3) << 10) | ((c[1] >> 3) << 5) | (c[0] >> 3);

  let grid = new Array(256).fill(0);
  let brush = 1;

  const swatches = PAL.map((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'px-swatch' + (i === brush ? ' on' : '');
    b.style.background = css(p.rgb);
    b.setAttribute('aria-label', 'paint with colour ' + i);
    b.addEventListener('click', () => {
      brush = i;
      swatches.forEach((s, j) => s.classList.toggle('on', j === i));
    });
    palEl.appendChild(b);
    return b;
  });

  const PRESETS = {
    clear: () => new Array(256).fill(0),
    ball: () => {
      const g = new Array(256).fill(0);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const dx = x - 7.5, dy = y - 7.5, d = Math.sqrt(dx * dx + dy * dy);
        if (d < 7.2) g[y * 16 + x] = d < 5.6 ? 1 : 2;
        if (d < 3 && dx < 0 && dy < 0) g[y * 16 + x] = 3;
      }
      return g;
    },
    brick: () => {
      const g = new Array(256).fill(2);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const row = (y >> 2), shift = (row & 1) ? 4 : 0;
        if (y % 4 === 3 || (x + shift) % 8 === 7) g[y * 16 + x] = 1;
        else if (y % 4 === 0 && (x + shift) % 8 === 0) g[y * 16 + x] = 3;
      }
      return g;
    },
  };
  grid = PRESETS.ball();

  function draw() {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      ctx.fillStyle = css(PAL[grid[y * 16 + x]].rgb);
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 16; i++) {
      ctx.beginPath(); ctx.moveTo(i * CELL + .5, 0); ctx.lineTo(i * CELL + .5, canvas.height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * CELL + .5); ctx.lineTo(canvas.width, i * CELL + .5); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.strokeRect(0, canvas.height / 2 + .5, canvas.width, 0);
    ctx.strokeRect(canvas.width / 2 + .5, 0, 0, canvas.height);

    // preview on a mini court
    pctx.fillStyle = TVCOL.bg; pctx.fillRect(0, 0, 48, 48);
    pctx.fillStyle = TVCOL.wall; pctx.fillRect(0, 0, 48, 4);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const v = grid[y * 16 + x];
      if (v) { pctx.fillStyle = css(PAL[v].rgb); pctx.fillRect(16 + x, 16 + y, 1, 1); }
    }
    emit();
  }

  /* one 8×8 tile → 32 bytes of 4bpp planar (rows of bp0/bp1, then bp2/bp3) */
  function tileBytes(tx, ty) {
    const out = [];
    for (let plane = 0; plane < 4; plane += 2) {
      for (let r = 0; r < 8; r++) {
        let b0 = 0, b1 = 0;
        for (let c = 0; c < 8; c++) {
          const v = grid[(ty * 8 + r) * 16 + tx * 8 + c];
          b0 |= ((v >> plane) & 1) << (7 - c);
          b1 |= ((v >> (plane + 1)) & 1) << (7 - c);
        }
        out.push(b0, b1);
      }
    }
    return out;
  }

  function emit() {
    const tiles = [[0, 0, 'top-left'], [1, 0, 'top-right'], [0, 1, 'bottom-left'], [1, 1, 'bottom-right']];
    let txt = '; generated by the Bounce pixel lab — 16×16 sprite as four 8×8 4bpp tiles\n' +
      '; each tile: 16 bytes of planes 0/1 (interleaved by row), then 16 of planes 2/3\n' +
      'sprite_chr:\n';
    tiles.forEach(([tx, ty, name]) => {
      txt += '; ' + name + '\n';
      const bts = tileBytes(tx, ty);
      for (let i = 0; i < 32; i += 8) {
        txt += '.byte ' + bts.slice(i, i + 8).map(b => '$' + hx(b, 2)).join(',') + '\n';
      }
    });
    txt += '\nsprite_pal:\n.word ' + PAL.map(p => '$' + hx(bgr15(p.rgb), 4)).join(',') +
      '   ; BGR15: %0BBBBBGGGGGRRRRR\n';
    bytesEl.textContent = txt;

    readEl.innerHTML = PAL.map((p, i) => {
      const w = bgr15(p.rgb);
      return '<div class="fr"><span class="k">' + p.name + '</span><span class="v">' +
        'RGB(' + p.rgb.join(',') + ') → <em style="color:' + css(p.rgb) + '">■</em> ' +
        '.word $' + hx(w, 4) + '</span></div>';
    }).join('');
  }

  function paint(e) {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * 16);
    const y = Math.floor((e.clientY - r.top) / r.height * 16);
    if (x < 0 || y < 0 || x > 15 || y > 15) return;
    grid[y * 16 + x] = brush;
    draw();
  }
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); paint(e); });
  canvas.addEventListener('pointermove', e => { if (e.buttons) paint(e); });

  root.querySelectorAll('[data-px-preset]').forEach(b => b.addEventListener('click', () => {
    grid = PRESETS[b.dataset.pxPreset]();
    draw();
  }));
  root.querySelector('[data-px-dl]').addEventListener('click', () => {
    const blob = new Blob([bytesEl.textContent], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bounce_gfx.s';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  draw();
}

/* ==========================================================================
   Module 08 — upload sequencer
   Fire the real register writes in any order. The simulated console starts
   the way careless code finds it — display live — so skipping forced blank
   visibly corrupts the upload, exactly as on hardware.
   ========================================================================== */
function UploadLab(root) {
  const stepsEl = root.querySelector('[data-up-steps]');
  const tv = root.querySelector('[data-up-tv]');
  const narEl = root.querySelector('[data-up-narrate]');
  const cgBar = root.querySelector('[data-up-cgbar]');
  const vrBar = root.querySelector('[data-up-vrbar]');
  const cgPct = root.querySelector('[data-up-cgpct]');
  const vrPct = root.querySelector('[data-up-vrpct]');
  tv.width = 256; tv.height = 224;
  const ctx = tv.getContext('2d');

  const STEPS = [
    { key: 'fblank', n: '1', txt: '<b>$2100 ← $8F</b> — forced blank on: PPU memories released' },
    { key: 'pal', n: '2', txt: '<b>$2121 ← 0</b>, DMA ch0 mode 0 → <b>$2122</b> — 32 bytes of palette into CGRAM' },
    { key: 'tiles', n: '3', txt: '<b>$2116 ← $0000</b>, DMA ch0 mode 1 → <b>$2118/9</b> — 2 KB of tiles into VRAM' },
    { key: 'map', n: '4', txt: '<b>$2116 ← $0400</b>, DMA → <b>$2118/9</b> — 2 KB tilemap: the court' },
    { key: 'regs', n: '5', txt: '<b>$2105 ← $01 · $2107 · $210B · $210D/E · $212C ← $11</b> — mode 1, bases, scroll, BG1+OBJ on' },
    { key: 'on', n: '6', txt: '<b>$2100 ← $0F</b> — forced blank off, brightness 15: curtain up' },
  ];
  let st;

  function reset() {
    st = { fblank: false, pal: false, tiles: false, map: false, regs: false, on: false, corrupt: false, screenLive: true };
    narEl.innerHTML = 'Power-cycled. Careless code finds the display <b>live</b> — the init code that should have blanked it was &ldquo;forgotten&rdquo;. Step 1 exists for a reason; see what happens if you skip straight to the DMAs.';
    render();
  }

  const btns = STEPS.map(s => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'up-step';
    b.innerHTML = '<span class="n">' + s.n + '</span><span>' + s.txt + '</span>';
    b.addEventListener('click', () => fire(s.key));
    stepsEl.appendChild(b);
    return b;
  });

  function fire(key) {
    const unsafe = !st.fblank && st.screenLive;
    switch (key) {
      case 'fblank':
        st.fblank = true; st.screenLive = false;
        narEl.innerHTML = '<b>INIDISP = $8F.</b> Bit 7 set: the PPU stops displaying and releases VRAM, CGRAM and OAM. Everything is now safe, at any beam position.';
        break;
      case 'pal':
        st.pal = true;
        if (unsafe) { st.corrupt = true; narEl.innerHTML = '<b>CGRAM DMA with the display live!</b> The PPU was reading palettes mid-scanline; your writes fought its address counter. Colours land — some of them in the wrong entries.'; }
        else narEl.innerHTML = '<b>32 bytes → CGRAM.</b> $4300=$00 (mode 0), $4301=$22, source, size, $420B=$01 — and the palette is in. DMA moved it in ~256 master cycles.';
        break;
      case 'tiles':
        st.tiles = true;
        if (unsafe) { st.corrupt = true; narEl.innerHTML = '<b>VRAM DMA with the display live!</b> Writes to $2118/9 while the PPU owns VRAM get lost or land at its address, not yours. The tile data is shredded.'; }
        else narEl.innerHTML = '<b>2 KB of tiles → VRAM at word $0000.</b> DMA mode 1 alternates $2118/$2119 — low byte, high byte — filling word after word.';
        break;
      case 'map':
        st.map = true;
        if (unsafe) { st.corrupt = true; narEl.innerHTML = '<b>Tilemap DMA with the display live!</b> Same crime, different victim: the court\'s map entries are torn.'; }
        else narEl.innerHTML = '<b>2 KB tilemap → VRAM at word $0400.</b> 32×32 entries: tile number + palette + flips. One wall tile, repeated and flipped, draws the whole court.';
        break;
      case 'regs':
        st.regs = true;
        narEl.innerHTML = '<b>The look of the screen, five writes:</b> BGMODE=1, BG1 map base $0400, BG1 tiles $1000 via $210B, scroll zeroed (two writes each — 8 bits at a time), TM=$11: BG1 + sprites on the main screen.';
        break;
      case 'on':
        st.on = true; st.screenLive = true;
        if (!st.tiles || !st.map || !st.pal || !st.regs) narEl.innerHTML = '<b>Curtain up… on an unfinished stage.</b> INIDISP=$0F shows whatever made it into the PPU so far. Compare the bars with the picture.';
        else if (st.corrupt) narEl.innerHTML = '<b>Curtain up.</b> The uploads that ran unblanked left their scars. Power-cycle and do step 1 first.';
        else narEl.innerHTML = '<b>Curtain up — and there\'s the court.</b> This exact sequence, behind forced blank, is Bounce\'s boot. After this, all writes move into vblank (Module 11).';
        break;
    }
    render();
  }

  function render() {
    btns.forEach((b, i) => b.classList.toggle('done', !!st[STEPS[i].key]));
    const cg = st.pal ? 32 / 512 : 0;
    const vr = (st.tiles ? 2048 : 0) + (st.map ? 2048 : 0);
    cgBar.style.width = (cg * 100) + '%';
    cgPct.textContent = st.pal ? '32 B · ' + Math.round(cg * 100) + '%' : '0%';
    vrBar.style.width = Math.max(vr / 65536 * 100, vr ? 4 : 0) + '%';
    vrPct.textContent = vr ? (vr / 1024) + ' KB · ' + (vr / 65536 * 100).toFixed(1) + '%' : '0%';

    if (!st.on) {
      if (st.fblank) drawScene(ctx, 256, 224, { black: true, blackLabel: 'FORCED BLANK' });
      else drawScene(ctx, 256, 224, { seed: 3, noWalls: true, noSprites: true, garbageTiles: true, wrongColors: true, title: '', score: null });
      return;
    }
    drawScene(ctx, 256, 224, {
      seed: 5,
      garbageTiles: !st.tiles,
      noWalls: !st.map,
      wrongColors: !st.pal,
      tearing: st.corrupt,
      noSprites: !st.regs,
      score: 0,
    });
  }

  root.querySelector('[data-up-reset]').addEventListener('click', reset);
  reset();
}

/* ==========================================================================
   Module 09 — joypad register lab
   Keyboard (or the on-screen pad) drives a simulated auto-joypad read:
   $4218/9 bits light while held, and the now-EOR-last idiom derives
   pressed/held/released live. The strip canvas proves the point — "held"
   is what moves a paddle, "pressed" is what fires once.
   ========================================================================== */
function JoypadLab(root) {
  const focusEl = root.querySelector('[data-joy-focus]');
  const btnsEl = root.querySelector('[data-joy-btns]');
  const bitsEl = root.querySelector('[data-joy-bits]');
  const hEl = root.querySelector('[data-joy-h]');
  const lEl = root.querySelector('[data-joy-l]');
  const prEl = root.querySelector('[data-joy-pr]');
  const hdEl = root.querySelector('[data-joy-hd]');
  const rlEl = root.querySelector('[data-joy-rl]');
  const strip = root.querySelector('[data-joy-strip]');

  /* word layout, bit 15 → 0: B Y Sel Sta ↑ ↓ ← → A X L R + signature 0000 */
  const BTNS = [
    { n: 'B', bit: 15 }, { n: 'Y', bit: 14 }, { n: 'Sel', bit: 13 }, { n: 'Sta', bit: 12 },
    { n: '↑', bit: 11 }, { n: '↓', bit: 10 }, { n: '←', bit: 9 }, { n: '→', bit: 8 },
    { n: 'A', bit: 7 }, { n: 'X', bit: 6 }, { n: 'L', bit: 5 }, { n: 'R', bit: 4 },
  ];
  const KEYMAP = {
    z: 15, Z: 15, Enter: 12, ArrowUp: 11, ArrowDown: 10,
    ArrowLeft: 9, ArrowRight: 8, x: 7, X: 7,
  };

  let now16 = 0, last16 = 0;
  const prT = new Array(16).fill(0), rlT = new Array(16).fill(0);
  let prHold = 0, rlHold = 0;

  /* bit cells — 12 buttons plus the 4-bit controller signature (always 0) */
  const cells = BTNS.map(b => {
    const d = document.createElement('div');
    d.className = 'joy-bit';
    d.innerHTML = '<span class="b">' + b.n + '</span><span>' + b.bit + '</span>';
    bitsEl.appendChild(d);
    return d;
  });
  for (let i = 3; i >= 0; i--) {
    const d = document.createElement('div');
    d.className = 'joy-bit';
    d.style.opacity = '.45';
    d.innerHTML = '<span class="b">0</span><span>' + i + '</span>';
    bitsEl.appendChild(d);
  }

  function setBit(bit, on) {
    if (on) now16 |= (1 << bit); else now16 &= ~(1 << bit);
  }

  /* on-screen pad: hold to set the bit, exactly like a real button */
  BTNS.forEach(b => {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'joy-btn';
    el.textContent = b.n === 'Sel' ? 'Select' : b.n === 'Sta' ? 'Start' : b.n;
    el.setAttribute('aria-label', 'hold button ' + el.textContent);
    const on = e => { e.preventDefault(); setBit(b.bit, true); el.classList.add('on'); };
    const off = () => { setBit(b.bit, false); el.classList.remove('on'); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('pointercancel', off);
    btnsEl.appendChild(el);
  });

  /* keyboard — only while the focus strip has focus, so the page scrolls fine */
  focusEl.addEventListener('keydown', e => {
    const bit = KEYMAP[e.key];
    if (bit == null) return;
    e.preventDefault();
    setBit(bit, true);
  });
  focusEl.addEventListener('keyup', e => {
    const bit = KEYMAP[e.key];
    if (bit == null) return;
    setBit(bit, false);
  });
  focusEl.addEventListener('focus', () => focusEl.classList.add('armed'));
  focusEl.addEventListener('blur', () => { focusEl.classList.remove('armed'); now16 = 0; });
  focusEl.addEventListener('click', () => focusEl.focus());

  function names(word) {
    const out = [];
    BTNS.forEach(b => { if (word & (1 << b.bit)) out.push(b.n); });
    return out.join(' ');
  }

  /* the little court: held ←/→ moves the paddle, a pressed B blips */
  let sctx = null, SW = 0, SH = 0, sdpr = 1, padF = 0.5, blip = 0;
  function sizeStrip() {
    const f = fitCanvas(strip);
    sctx = f.ctx; SW = f.W; SH = f.H; sdpr = f.dpr;
  }
  function drawStrip() {
    if (!sctx) sizeStrip();
    sctx.fillStyle = '#07060d';
    sctx.fillRect(0, 0, SW, SH);
    sctx.fillStyle = '#1c1730';
    sctx.fillRect(0, SH - 7 * sdpr, SW, 2 * sdpr);
    pxText(sctx, 'HOLD ARROWS  B BLIPS', 8 * sdpr, 6 * sdpr, sdpr, '#403860');
    const px = 8 * sdpr + padF * (SW - 46 * sdpr);
    sctx.fillStyle = blip > 0 ? TVCOL.wallHi : TVCOL.paddle;
    sctx.fillRect(px, SH - 17 * sdpr, 30 * sdpr, 7 * sdpr);
    if (blip > 0) pxText(sctx, 'BLIP', px + 4 * sdpr, SH - 32 * sdpr, sdpr, '#f85898');
  }

  /* one simulated frame: latch, derive, display — the Module 09 idiom */
  function frame() {
    const chg = now16 ^ last16;
    const pressed = chg & now16, released = chg & last16;
    for (let i = 0; i < 16; i++) {
      if (pressed & (1 << i)) prT[i] = 9;
      else if (prT[i]) prT[i]--;
      if (released & (1 << i)) rlT[i] = 9;
      else if (rlT[i]) rlT[i]--;
    }
    if (pressed) { prEl.textContent = names(pressed); prHold = 40; }
    else if (prHold && !--prHold) prEl.textContent = '—';
    if (released) { rlEl.textContent = names(released); rlHold = 40; }
    else if (rlHold && !--rlHold) rlEl.textContent = '—';
    hdEl.textContent = now16 ? names(now16) : '—';
    hEl.textContent = h2(now16 >> 8);
    lEl.textContent = h2(now16 & 0xff);
    BTNS.forEach((b, i) => {
      const m = 1 << b.bit;
      cells[i].classList.toggle('on', !!(now16 & m));
      cells[i].classList.toggle('pr', prT[b.bit] > 0);
      cells[i].classList.toggle('rl', rlT[b.bit] > 0);
    });
    if (now16 & 0x200) padF = Math.max(0, padF - 0.012);      // ← held
    if (now16 & 0x100) padF = Math.min(1, padF + 0.012);      // → held
    if (pressed & 0x8000) blip = 14;                          // B pressed
    else if (blip) blip--;
    drawStrip();
    last16 = now16;
  }

  let raf = null, timer = null, running = false;
  function loop() {
    if (!running) return;
    frame();
    raf = requestAnimationFrame(loop);
  }
  function start() {
    if (running) return;
    running = true;
    sizeStrip();
    if (REDUCED) timer = setInterval(frame, 1000 / 30);
    else raf = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf); raf = null;
    if (timer) clearInterval(timer); timer = null;
  }
  window.addEventListener('resize', () => { if (running) sizeStrip(); });
  whenVisible(root, start, stop);
  frame();
}

/* ==========================================================================
   Module 10 — shadow-OAM visualiser
   Game logic writes a WRAM shadow instantly; the screen renders only from
   the PPU's copy, refreshed by a (deliberately slowed) vblank DMA tick.
   Drive the paddle past the left edge to watch the high-table ninth X bit
   earn its keep.
   ========================================================================== */
function OamLab(root) {
  const canvas = root.querySelector('[data-oam-canvas]');
  const tickEl = root.querySelector('[data-oam-tick]');
  const cdEl = root.querySelector('[data-oam-cd]');
  const tblEl = root.querySelector('[data-oam-tbl]');
  const narEl = root.querySelector('[data-oam-narrate]');
  canvas.width = 256; canvas.height = 120;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const PADY = 96, DMA_EVERY = 90;                  // sim vblank: 1.5 s per tick
  let padX = 96, ballX = 60, ballY = 40, vx = 1.1, vy = 0.8;
  let holdL = false, holdR = false;
  let dmaIn = DMA_EVERY, hot = 0, toldHi = false, msgLock = 0;

  function sprBytes() {
    const bx = Math.round(ballX), by = Math.round(ballY);
    return [
      [bx & 0xff, by & 0xff, 0x04, 0x30],           // spr0 · ball, 8×8
      [padX & 0xff, PADY, 0x00, 0x32],              // spr1 · paddle left, 16×16
      [(padX + 16) & 0xff, PADY, 0x02, 0x32],       // spr2 · paddle right
    ];
  }
  function hiByte() {
    let b = 0x28;                                   // size bits: spr1 + spr2 large
    if (Math.round(ballX) & 0x100) b |= 0x01;
    if (padX & 0x100) b |= 0x04;
    if ((padX + 16) & 0x100) b |= 0x10;
    return b;
  }
  let ppu = { spr: sprBytes(), hi: hiByte() };

  /* table rows: per sprite a WRAM row and a PPU row, then the high byte */
  function makeRow(nm) {
    const d = document.createElement('div');
    d.className = 'oam-row';
    d.innerHTML = '<span class="nm">' + nm + '</span>';
    const out = [];
    for (let i = 0; i < 4; i++) {
      const s = document.createElement('span');
      s.className = 'ob';
      d.appendChild(s);
      out.push(s);
    }
    tblEl.appendChild(d);
    return out;
  }
  const wCells = [], oCells = [];
  ['spr0 · ball', 'spr1 · pad L', 'spr2 · pad R'].forEach(nm => {
    wCells.push(makeRow(nm + ' · WRAM'));
    oCells.push(makeRow('↳ PPU OAM'));
  });
  const hiW = makeRow('high tbl · WRAM');
  const hiO = makeRow('↳ PPU OAM');

  function setCell(el, label, txt, mark) {
    const html = '<span class="t">' + label + '</span>' + txt;
    if (el._h !== html) { el.innerHTML = html; el._h = html; }
    el.classList.toggle('fresh', mark === 'fresh');
    el.classList.toggle('hi', mark === 'hi');
  }
  const LBL = ['X', 'Y', 'TILE', 'ATTR'];
  function updateTable() {
    const sh = sprBytes(), hb = hiByte();
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 4; j++) {
        setCell(wCells[i][j], LBL[j], h2(sh[i][j]), sh[i][j] !== ppu.spr[i][j] ? 'fresh' : '');
        setCell(oCells[i][j], LBL[j], h2(ppu.spr[i][j]), '');
      }
    }
    setCell(hiW[0], 'BYTE', h2(hb), hb !== ppu.hi ? 'fresh' : '');
    setCell(hiO[0], 'BYTE', h2(ppu.hi), '');
    const HN = ['BALL X8', 'PADL X8', 'PADR X8'];
    [0x01, 0x04, 0x10].forEach((m, k) => {
      setCell(hiW[k + 1], HN[k], (hb & m) ? '1' : '0', (hb & m) ? 'hi' : '');
      setCell(hiO[k + 1], HN[k], (ppu.hi & m) ? '1' : '0', (ppu.hi & m) ? 'hi' : '');
    });
  }

  /* the screen draws ONLY from the PPU copy — that is the whole lesson */
  function sgn(low, x8) { return x8 ? low - 256 : low; }
  function render() {
    ctx.fillStyle = TVCOL.bg;
    ctx.fillRect(0, 0, 256, 120);
    ctx.fillStyle = TVCOL.wall;
    ctx.fillRect(0, 0, 256, 6);
    const s = ppu.spr, hb = ppu.hi;
    ctx.fillStyle = TVCOL.ball;
    ctx.fillRect(sgn(s[0][0], hb & 0x01), s[0][1], 6, 6);
    ctx.fillStyle = TVCOL.paddle;
    ctx.fillRect(sgn(s[1][0], hb & 0x04), s[1][1], 16, 8);
    ctx.fillRect(sgn(s[2][0], hb & 0x10), s[2][1], 16, 8);
    pxText(ctx, 'OAM COPY', 178, 110, 1, '#403860');
  }

  function frame() {
    if (holdL) padX = Math.max(-24, padX - 2);
    if (holdR) padX = Math.min(224, padX + 2);
    if (!REDUCED) {
      ballX += vx; ballY += vy;
      if (ballX < 4 || ballX > 246) vx = -vx;
      if (ballY < 12 || ballY > PADY - 10) vy = -vy;
      ballX = clamp(ballX, 4, 246); ballY = clamp(ballY, 12, PADY - 10);
    }
    if (msgLock) msgLock--;
    if (!toldHi && padX < 0) {
      toldHi = true; msgLock = 300;
      narEl.innerHTML = '<b>Past the left edge.</b> pad L\'s X is negative now — the main-table byte ' +
        'reads <b>' + h2(padX & 0xff) + '</b> and the truth lives in the amber high-table X8 bit. ' +
        'Forget that bit and this sprite teleports to X = ' + (padX & 0xff) + ', hard right.';
    }
    dmaIn--;
    if (dmaIn <= 0) {
      dmaIn = DMA_EVERY;
      const sh = sprBytes(), hb = hiByte();
      let changed = 0;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) if (sh[i][j] !== ppu.spr[i][j]) changed++;
      if (hb !== ppu.hi) changed++;
      ppu = { spr: sh, hi: hb };
      hot = 14;
      if (changed && !msgLock) {
        msgLock = 60;
        narEl.innerHTML = '<b>DMA tick.</b> All 544 bytes copied shadow → OAM inside the (slowed-down) ' +
          'vblank — ' + changed + ' byte' + (changed === 1 ? '' : 's') + ' differed, and the PPU column ' +
          'and the screen just caught up. On hardware this happens 60 times a second.';
      }
    }
    if (hot) hot--;
    tickEl.classList.toggle('hot', hot > 0);
    cdEl.textContent = (dmaIn / 60).toFixed(1) + ' s';
    updateTable();
    render();
  }

  function holdBtn(el, set) {
    if (!el) return;
    const on = e => { e.preventDefault(); set(true); el.classList.add('on'); };
    const off = () => { set(false); el.classList.remove('on'); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('pointercancel', off);
  }
  holdBtn(root.querySelector('[data-oam-left]'), v => { holdL = v; });
  holdBtn(root.querySelector('[data-oam-right]'), v => { holdR = v; });

  let raf = null, timer = null, running = false;
  function loop() {
    if (!running) return;
    frame();
    raf = requestAnimationFrame(loop);
  }
  function start() {
    if (running) return;
    running = true;
    if (REDUCED) timer = setInterval(frame, 1000 / 30);
    else raf = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf); raf = null;
    if (timer) clearInterval(timer); timer = null;
  }
  whenVisible(root, start, stop);
  frame();
}

/* ==========================================================================
   Module 11 — frame-budget visualiser
   Two sliders, two budgets: game-logic time against the frame, upload bytes
   against the ~6 KB a vblank can move by DMA. Three consecutive frames are
   drawn as a beam timeline; overspend either budget and NMIs start being
   missed — dropped frames, made visible.
   ========================================================================== */
function BudgetLab(root) {
  const canvas = root.querySelector('[data-bud-canvas]');
  const logicR = root.querySelector('[data-bud-logic]');
  const bytesR = root.querySelector('[data-bud-bytes]');
  const logicVal = root.querySelector('[data-bud-logic-val]');
  const bytesVal = root.querySelector('[data-bud-bytes-val]');
  const fpsEl = root.querySelector('[data-bud-fps]');
  const usedEl = root.querySelector('[data-bud-used]');
  const warnEl = root.querySelector('[data-bud-warn]');
  const warnB = warnEl.querySelector('b');
  const narEl = root.querySelector('[data-bud-narrate]');

  const BUDGET = 6000;                              // ≈ bytes one vblank can DMA

  function draw() {
    const { ctx, W, H, dpr } = fitCanvas(canvas);
    const logic = +logicR.value, bytes = +bytesR.value;
    const nl = Math.ceil(logic / 100);              // frames the logic needs
    const nu = Math.max(1, Math.ceil(bytes / BUDGET)); // vblanks the upload needs
    const n = Math.max(nl, nu);                     // frames per finished update
    const fps = Math.round(60 / n);

    const FR = 3;
    const padL = 74 * dpr, padR = 14 * dpr;
    const fw = (W - padL - padR) / FR;
    const vbw = fw * (37 / 262), pw = fw - vbw;     // picture + vblank widths
    const yBeam = 30 * dpr, yLogic = 92 * dpr, yUp = 156 * dpr, bh = 22 * dpr;
    const X = f => padL + f * fw;

    ctx.clearRect(0, 0, W, H);
    ctx.font = '600 ' + (10 * dpr) + 'px ui-monospace, monospace';

    ctx.fillStyle = '#877f9e';
    ctx.fillText('the beam', 8 * dpr, yBeam + bh / 2 + 3 * dpr);
    ctx.fillText('logic', 8 * dpr, yLogic + bh / 2 + 3 * dpr);
    ctx.fillText('uploads', 8 * dpr, yUp + bh / 2 + 3 * dpr);

    // beam row: picture area then vblank, three frames across
    for (let f = 0; f < FR; f++) {
      ctx.fillStyle = 'rgba(69,228,209,0.08)';
      ctx.fillRect(X(f), yBeam, pw, bh);
      ctx.fillStyle = 'rgba(168,132,255,0.2)';
      ctx.fillRect(X(f) + pw, yBeam, vbw, bh);
      ctx.strokeStyle = '#2c2542'; ctx.lineWidth = dpr;
      ctx.strokeRect(X(f), yBeam, fw, bh);
      ctx.fillStyle = '#877f9e';
      ctx.fillText('frame ' + f, X(f) + 4 * dpr, yBeam - 7 * dpr);
    }

    // logic bars: one update starts every n frames; overrun drawn red
    for (let f = 0; f < FR; f += n) {
      const len = logic / 100 * fw;
      ctx.fillStyle = 'rgba(95,209,139,0.5)';
      ctx.fillRect(X(f), yLogic, Math.min(len, fw), bh);
      if (len > fw) {
        ctx.fillStyle = 'rgba(255,106,106,0.65)';
        ctx.fillRect(X(f) + fw, yLogic, Math.min(len - fw, Math.max(0, W - padR - X(f) - fw)), bh);
      }
      ctx.fillStyle = '#0a1a12';
      if (logic >= 30) ctx.fillText(logic + '%', X(f) + 5 * dpr, yLogic + bh / 2 + 3.5 * dpr);
    }

    // upload bars: drawn in every serviced vblank; spill drawn red past it
    for (let f = 0; f < FR; f++) {
      const ux = X(f) + pw;
      ctx.strokeStyle = 'rgba(168,132,255,0.45)';
      ctx.lineWidth = dpr;
      ctx.strokeRect(ux, yUp, vbw, bh);
      if ((f + 1) % n !== 0) continue;
      ctx.fillStyle = 'rgba(255,177,78,0.75)';
      ctx.fillRect(ux, yUp, Math.min(bytes, BUDGET) / BUDGET * vbw, bh);
      if (bytes > BUDGET) {
        ctx.fillStyle = 'rgba(255,106,106,0.7)';
        ctx.fillRect(ux + vbw, yUp, Math.min((bytes - BUDGET) / BUDGET * vbw, Math.max(0, W - padR - ux - vbw)), bh);
        ctx.fillStyle = '#ff6a6a';
        ctx.fillText('spills past vblank!', Math.min(ux + vbw + 4 * dpr, W - 120 * dpr), yUp - 5 * dpr);
      }
    }

    // NMI markers: amber when serviced, red when it arrives mid-work
    for (let f = 0; f < FR; f++) {
      const mx = X(f) + pw;
      const ok = (f + 1) % n === 0;
      ctx.strokeStyle = ok ? 'rgba(255,177,78,0.8)' : 'rgba(255,106,106,0.9)';
      ctx.lineWidth = dpr;
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.beginPath(); ctx.moveTo(mx, yBeam - 4 * dpr); ctx.lineTo(mx, yUp + bh + 8 * dpr); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ok ? '#ffb14e' : '#ff6a6a';
      ctx.fillText(ok ? 'NMI' : 'NMI ✕ dropped', mx + 3 * dpr, yUp + bh + 18 * dpr);
    }

    ctx.fillStyle = '#877f9e';
    ctx.fillText('≈6 KB fits through one vblank at DMA speed', padL, H - 6 * dpr);

    // readouts
    logicVal.textContent = logic + '% of a frame';
    bytesVal.textContent = bytes.toLocaleString('en-US') + ' bytes';
    fpsEl.textContent = fps + ' fps';
    usedEl.textContent = Math.round(bytes / BUDGET * 100) + '%';
    if (n > 1) {
      warnEl.style.display = '';
      warnB.textContent = 'dropping frames';
    } else {
      warnEl.style.display = 'none';
    }

    if (nl > 1 && nu > 1) {
      narEl.innerHTML = '<b>Both budgets blown.</b> Logic needs ' + nl + ' frames and ' +
        bytes.toLocaleString('en-US') + ' bytes need ' + nu + ' vblanks — a finished update lands every ' +
        n + ' frames. Motion hitches along at <b>' + fps + ' fps</b>.';
    } else if (nl > 1) {
      narEl.innerHTML = '<b>Logic overran the frame.</b> At ' + logic + '% of a frame, the NMI arrives ' +
        'while main is still computing — the new picture isn\'t ready, that frame repeats, and the game ' +
        'runs at <b>' + fps + ' fps</b>. Trim the logic or spread it across frames.';
    } else if (nu > 1) {
      narEl.innerHTML = '<b>Uploads outgrew vblank.</b> ' + bytes.toLocaleString('en-US') + ' bytes ' +
        'can\'t squeeze through a ~6 KB blank window: either the writes spill into the picture (torn ' +
        'tiles — Module 13) or the copy waits a frame. Done safely: <b>' + fps + ' fps</b>.';
    } else if (logic > 85 || bytes > BUDGET * 0.85) {
      narEl.innerHTML = '<b>Fits — barely.</b> One slow enemy or a few more tiles and a budget bursts. ' +
        'Shipping games leave headroom; so should Bounce.';
    } else {
      narEl.innerHTML = 'Both budgets healthy: logic fits inside one frame, uploads fit inside vblank. ' +
        'This is a locked 60 fps.';
    }
  }

  logicR.addEventListener('input', draw);
  bytesR.addEventListener('input', draw);
  window.addEventListener('resize', draw);
  whenVisible(root, draw, () => {});
  draw();
}

/* ------------------------------------------------- shared Web-Audio context
   One lazily-created AudioContext for the whole page, first touched inside a
   user gesture (the Play button) as autoplay policy demands. */
let sharedAC = null;
function audioCtx() {
  if (!sharedAC) sharedAC = new (window.AudioContext || window.webkitAudioContext)();
  if (sharedAC.state === 'suspended') sharedAC.resume();
  return sharedAC;
}

/* ==========================================================================
   Module 12 — driver-command sequencer
   A 16-step grid where every lit cell is a mailbox write: command byte to
   $2140, parameter to $2141, fire-and-forget. A Web-Audio square and
   triangle stand in for the S-DSP — clearly labelled as stand-ins; the
   byte pairs in the log are the real interface.
   ========================================================================== */
function SfxLab(root) {
  const gridEl = root.querySelector('[data-seq-grid]');
  const playBtn = root.querySelector('[data-seq-play]');
  const bpmR = root.querySelector('[data-seq-bpm]');
  const bpmVal = root.querySelector('[data-seq-bpm-val]');
  const logEl = root.querySelector('[data-seq-log]');

  const ROWS = [
    {
      lbl: 'blip · $01', cls: '', cmd: 0x01, wave: 'square', vol: 0.05, dur: 0.16,
      param: st => 0x40 + st, freq: st => 587 * Math.pow(2, st / 19),
      note: 'blip — pitch byte rises like a growing rally',
    },
    {
      lbl: 'loop · $02', cls: ' r2', cmd: 0x02, wave: 'triangle', vol: 0.16, dur: 0.26,
      param: st => [0x18, 0x1C, 0x1F, 0x1C][(st >> 2) & 3],
      freq: st => [131, 165, 196, 165][(st >> 2) & 3],
      note: 'music-loop voice — the driver keeps time itself',
    },
  ];
  const pat = [
    [0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0],
    [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
  ];

  const cells = ROWS.map((r, ri) => {
    const row = document.createElement('div');
    row.className = 'seq-row' + r.cls;
    const lb = document.createElement('span');
    lb.className = 'seq-lbl';
    lb.textContent = r.lbl;
    row.appendChild(lb);
    const cs = [];
    for (let i = 0; i < 16; i++) {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'seq-cell' + (pat[ri][i] ? ' on' : '');
      c.setAttribute('aria-label', r.lbl + ' · step ' + (i + 1));
      c.addEventListener('click', () => {
        pat[ri][i] ^= 1;
        c.classList.toggle('on', !!pat[ri][i]);
      });
      row.appendChild(c);
      cs.push(c);
    }
    gridEl.appendChild(row);
    return cs;
  });

  let timer = null, st = 0;
  const lines = [];

  function tick() {
    cells.forEach(cs => cs.forEach((c, i) => c.classList.toggle('play', i === st)));
    const ac = audioCtx(), t = ac.currentTime;
    ROWS.forEach((r, ri) => {
      if (!pat[ri][st]) return;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = r.wave;
      o.frequency.value = r.freq(st);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(r.vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + r.dur);
      o.connect(g);
      g.connect(ac.destination);
      o.start(t);
      o.stop(t + r.dur + 0.05);
      lines.unshift('step ' + String(st).padStart(2, '0') + ' · <b>$2140 ← ' + h2(r.cmd) +
        '</b>  <b>$2141 ← ' + h2(r.param(st)) + '</b>   ; ' + r.note);
    });
    if (lines.length > 4) lines.length = 4;
    if (lines.length) logEl.innerHTML = lines.join('\n');
    st = (st + 1) % 16;
  }

  function stepMs() { return 60000 / (+bpmR.value) / 4; }
  function start() {
    if (timer) return;
    audioCtx();                                     // unlock inside the gesture
    st = 0;
    timer = setInterval(tick, stepMs());
    playBtn.textContent = 'Stop';
    tick();
  }
  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    playBtn.textContent = 'Play';
    cells.forEach(cs => cs.forEach(c => c.classList.remove('play')));
  }

  playBtn.addEventListener('click', () => { timer ? stop() : start(); });
  bpmR.addEventListener('input', () => {
    bpmVal.textContent = bpmR.value + ' bpm';
    if (timer) { clearInterval(timer); timer = setInterval(tick, stepMs()); }
  });
  whenVisible(root, () => {}, stop);
}

/* ==========================================================================
   Module 13 — spot-the-bug gallery
   Five broken TVs, five causes. Each card renders its symptom with the
   shared drawScene renderer; pick the diagnosis, get the explanation.
   ========================================================================== */
function BugsLab(root) {
  const scoreEl = root.querySelector('[data-bug-score]');
  const cardsEl = root.querySelector('[data-bug-cards]');

  const CARDS = [
    {
      scene: { seed: 21, tearing: true, score: 120 },
      q: 'Mid-game, tiles flicker and whole bands shear sideways.',
      opts: [
        { t: 'The ROM checksum is wrong' },
        { t: 'PPU writes are landing outside vblank', ok: true },
        { t: 'The controller cable is loose' },
      ],
      why: 'Torn bands are the signature of <b>$21xx writes racing the beam</b> — the Module 11 contract, ' +
        'broken. Move every PPU write and DMA into the NMI handler; the Module 04 event viewer makes the ' +
        'stray writes instantly visible as dots in the picture area.',
    },
    {
      scene: { seed: 9, garbageTiles: true, straySprites: true, wrongColors: true, score: 0 },
      q: 'From power-on: a screenful of random tiles, junk sprites, noise colours.',
      opts: [
        { t: 'The tilemap DMA copied from the wrong bank' },
        { t: 'The cartridge header title is empty' },
        { t: 'Init skipped the VRAM/CGRAM/OAM clears', ok: true },
      ],
      why: 'The PPU happily draws whatever its memories woke up holding. Garbage <em>everywhere from the ' +
        'first frame</em> means the Module 05 checklist didn\'t run: forced blank on, clear VRAM, CGRAM ' +
        'and OAM, then upload — in order, every boot.',
    },
    {
      scene: { seed: 5, wrongColors: true, score: 300 },
      q: 'Every shape is right. Every colour is a fever dream.',
      opts: [
        { t: 'CGRAM holds noise — the palette was never uploaded', ok: true },
        { t: 'The tile data is 2bpp instead of 4bpp' },
        { t: 'The console is a PAL unit' },
      ],
      why: 'Right shapes prove VRAM and the tilemap are fine; wrong colours point one place: <b>CGRAM</b>. ' +
        'Palette entries are noise until you set them — clear CGRAM at init and check the $2121/$2122 ' +
        'upload actually ran (bars in the Module 08 lab).',
    },
    {
      scene: { seed: 2, halfDead: true, score: 500 },
      q: 'Months of perfect runs in the emulator. On the console: nothing.',
      opts: [
        { t: 'Flash carts can\'t run LoROM games' },
        { t: 'Uninitialised WRAM — the emulator zeroed what silicon leaves as noise', ok: true },
        { t: 'The TV doesn\'t support 256×224' },
      ],
      why: 'The heartbreaker. An emulator that zeroes RAM silently forgives every read-before-write bug; ' +
        'real silicon wakes with noise in every byte. Clear WRAM at boot, and develop with Mesen2\'s ' +
        '<b>break on uninitialised read</b> plus randomised power-on RAM.',
    },
    {
      scene: { seed: 13, ghostPaddle: true, score: 80 },
      q: 'Inputs ghost and stick — the paddle stutters and fires on its own.',
      opts: [
        { t: 'The controller is broken' },
        { t: 'The NMI was never enabled in $4200' },
        { t: 'Reading $4218/9 while $4212 bit 0 says the auto-read is busy', ok: true },
      ],
      why: 'The auto-joypad read takes the first few scanlines of vblank; read <b>$4218/9</b> while ' +
        '$4212 bit 0 is set and you get a half-shifted word — phantom presses included. The fix is ' +
        'three instructions: loop until the busy bit clears, then read (Module 11\'s handler).',
    },
  ];

  let solved = 0;
  CARDS.forEach(cd => {
    const card = document.createElement('div');
    card.className = 'bug-card';
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 120;
    cv.setAttribute('aria-label', 'simulated broken TV output');
    card.appendChild(cv);
    drawScene(cv.getContext('2d'), 256, 120, cd.scene);

    const q = document.createElement('div');
    q.className = 'bug-q';
    q.textContent = cd.q;
    card.appendChild(q);

    const opts = document.createElement('div');
    opts.className = 'bug-opts';
    const why = document.createElement('div');
    why.className = 'bug-why';
    why.innerHTML = cd.why;

    let done = false;
    cd.opts.forEach(o => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bug-opt';
      b.textContent = o.t;
      b.addEventListener('click', () => {
        if (done) return;
        if (o.ok) {
          done = true;
          b.classList.add('right');
          why.classList.add('show');
          solved++;
          scoreEl.textContent = solved + ' / 5';
        } else {
          b.classList.add('wrong');
        }
      });
      opts.appendChild(b);
    });
    card.appendChild(opts);
    card.appendChild(why);
    cardsEl.appendChild(card);
  });
}

/* ==========================================================================
   Module 14 — release checklist
   Expand each rite for the detail, tick it off, watch the cartridge earn
   its stamp. All eight checked → SHIPPED.
   ========================================================================== */
function ShipLab(root) {
  const listEl = root.querySelector('[data-ship-list]');
  const cart = root.querySelector('[data-ship-cart]');
  const stamp = root.querySelector('[data-ship-stamp]');

  const ITEMS = [
    {
      s: 'Checksum pair recomputed',
      d: 'The build script\'s last step: byte-sum the final padded ROM, write complement + checksum at ' +
        '$FFDC–$FFDF (Module 06). Emulators nag and flash-cart menus flag red without it.',
    },
    {
      s: 'ROM padded to a power of two',
      d: 'Pad the image to a clean 256 KB / 512 KB / 1 MB so mirroring behaves and every loader is happy.',
    },
    {
      s: 'No 512-byte copier header',
      d: 'Ship a bare .sfc. The old copier block is 1990s disk-copier baggage — modern tools read it ' +
        'as corruption.',
    },
    {
      s: 'Mesen2 clean with randomised RAM',
      d: 'Power-on RAM randomised, break-on-uninitialised-read armed, a full playthrough without a stop. ' +
        'No more lucky zeroes.',
    },
    {
      s: 'bsnes clean — the accuracy pass',
      d: 'The timing reference. Vblank-budget sins and beam races fail here the way they\'d fail on the ' +
        'console.',
    },
    {
      s: 'Runs from a flash cart on real hardware',
      d: 'FXPak Pro or Super EverDrive, a real console, a real TV — ideally a CRT and a modern panel both.',
    },
    {
      s: 'Everything in the file is yours',
      d: 'Your code, your art, your sound, your title — and nobody\'s trademarks. The Module 01 recap, ' +
        'one line long.',
    },
    {
      s: 'Release posts ready',
      d: 'An itch.io page, a SNESdev forum thread, and the annual compo if the calendar lines up.',
    },
  ];

  let done = 0;
  ITEMS.forEach(it => {
    const d = document.createElement('div');
    d.className = 'ship-item';
    d.innerHTML = '<div class="head"><input type="checkbox" aria-label="mark done: ' + it.s +
      '"><span class="s">' + it.s + '</span><span class="chev">▸</span></div>' +
      '<div class="body">' + it.d + '</div>';
    const cb = d.querySelector('input');
    d.querySelector('.head').addEventListener('click', e => {
      if (e.target === cb) return;
      d.classList.toggle('open');
    });
    cb.addEventListener('change', () => {
      d.classList.toggle('done', cb.checked);
      done += cb.checked ? 1 : -1;
      draw();
    });
    listEl.appendChild(d);
  });

  function draw() {
    const { ctx, W, H, dpr } = fitCanvas(cart);
    ctx.clearRect(0, 0, W, H);
    const all = done === ITEMS.length;
    const s = Math.min(W / 140, H / 100);
    const ox = (W - 130 * s) / 2, oy = (H - 92 * s) / 2;
    const R = (x, y, w, h, col) => {
      ctx.fillStyle = col;
      ctx.fillRect(ox + x * s, oy + y * s, w * s, h * s);
    };
    // the classic SNES loaf: shoulders, body, base, edge connector
    R(5, 8, 120, 58, all ? '#4a4266' : '#3a3357');
    R(0, 16, 130, 42, all ? '#4a4266' : '#3a3357');
    R(14, 66, 102, 16, all ? '#3f3859' : '#312b49');
    R(24, 82, 82, 6, '#232038');
    for (let i = 0; i < 6; i++) R(14 + i * 19, 10, 9, 3, '#232038');
    // label
    R(20, 22, 90, 32, all ? '#12203a' : '#171326');
    const u = Math.max(1, Math.round(2.6 * s));
    pxText(ctx, 'BOUNCE', ox + 65 * s - 3 * 4 * u + u, oy + 26 * s, u, all ? '#45e4d1' : '#5a4e82');
    pxText(ctx, 'SNES HOMEBREW', ox + 65 * s - 6.5 * 4 * Math.max(1, Math.round(s)),
      oy + 26 * s + 7 * u, Math.max(1, Math.round(s)), all ? '#5fd18b' : '#403860');
    // one pip per checklist rite
    ITEMS.forEach((_, i) => {
      R(23 + i * 11, 59, 8, 4, i < done ? '#5fd18b' : '#232038');
    });
    if (all) {
      ctx.strokeStyle = 'rgba(95,209,139,0.7)';
      ctx.lineWidth = 2 * dpr;
      ctx.strokeRect(ox - 4 * dpr, oy + 4 * s, 130 * s + 8 * dpr, 84 * s);
    }
    stamp.classList.toggle('on', all);
  }

  window.addEventListener('resize', draw);
  whenVisible(root, draw, () => {});
  draw();
}

/* ------------------------------------------------------- hero ambient canvas
   Source fragments drift rightwards and snap into a tile grid — a build
   forever assembling a cartridge's worth of tiles, then shipping it and
   starting over. Low-opacity; a static single frame under reduced motion. */
function heroAmbient(canvas) {
  const c = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1, raf = null, running = false;
  function size() { const f = fitCanvas(canvas); W = f.W; H = f.H; dpr = f.dpr; }
  size();
  window.addEventListener('resize', () => { size(); if (!running) draw(); });

  const COLS = ['rgba(69,228,209,', 'rgba(168,132,255,', 'rgba(255,95,158,', 'rgba(255,177,78,', 'rgba(95,209,139,'];
  const GRID = 5;
  let slots, frags, fade;
  function reset(prefill) {
    slots = new Array(GRID * GRID).fill(0);
    frags = [];
    fade = 0;
    if (prefill) for (let i = 0; i < slots.length; i++) if (Math.random() < 0.55) slots[i] = 1;
  }
  reset(REDUCED);

  function geom() {
    const cell = 13 * dpr;
    return { cell, gx: W * 0.74, gy: H / 2 - GRID * cell / 2 };
  }
  function spawn() {
    const free = [];
    slots.forEach((v, i) => { if (!v && !frags.some(f => f.slot === i)) free.push(i); });
    if (!free.length) return;
    frags.push({
      slot: free[(Math.random() * free.length) | 0],
      x: -0.05, y: 0.12 + Math.random() * 0.76,
      v: 0.0028 + Math.random() * 0.0035,
      col: COLS[(Math.random() * COLS.length) | 0],
    });
  }

  function draw() {
    c.clearRect(0, 0, W, H);
    const { cell, gx, gy } = geom();
    c.fillStyle = 'rgba(90,78,130,0.05)';
    for (let y = 0; y < H; y += 6 * dpr) c.fillRect(0, y, W, dpr);
    c.strokeStyle = 'rgba(90,78,130,0.25)';
    c.lineWidth = dpr;
    c.strokeRect(gx - 4 * dpr, gy - 4 * dpr, GRID * cell + 8 * dpr, GRID * cell + 8 * dpr);
    const a = Math.max(0, 1 - fade);
    for (let i = 0; i < slots.length; i++) {
      if (!slots[i]) continue;
      c.fillStyle = COLS[i % COLS.length] + (0.34 * a) + ')';
      c.fillRect(gx + (i % GRID) * cell + dpr, gy + ((i / GRID) | 0) * cell + dpr, cell - 2 * dpr, cell - 2 * dpr);
    }
    frags.forEach(f => {
      c.fillStyle = f.col + '0.4)';
      c.fillRect(f.x * W, f.y * H, 7 * dpr, 7 * dpr);
    });
  }

  function step() {
    const { cell, gx, gy } = geom();
    if (Math.random() < 0.05 && frags.length < 10) spawn();
    for (let i = frags.length - 1; i >= 0; i--) {
      const f = frags[i];
      const tx = (gx + (f.slot % GRID) * cell + dpr) / W;
      const ty = (gy + ((f.slot / GRID) | 0) * cell + dpr) / H;
      f.x += f.v;
      if (f.x > 0.45) {                    // final approach: ease into the slot
        f.x += (tx - f.x) * 0.06;
        f.y += (ty - f.y) * 0.06;
      }
      if (Math.abs(f.x - tx) < 0.004 && Math.abs(f.y - ty) < 0.004) {
        slots[f.slot] = 1;
        frags.splice(i, 1);
      }
    }
    if (!frags.length && slots.every(v => v)) {
      fade += 0.02;                        // shipped — fade out, build again
      if (fade >= 1) reset(false);
    }
  }

  function loop() {
    if (!running) return;
    step();
    draw();
    raf = requestAnimationFrame(loop);
  }
  function start() {
    if (running) return;
    running = true;
    if (REDUCED) { draw(); running = false; return; }
    raf = requestAnimationFrame(loop);
  }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = null; }
  whenVisible(canvas, start, stop);
  if (REDUCED) draw();
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
    const label = el.textContent.trim().replace(/\s+/g, ' ');
    tip.innerHTML = '<span class="tt">' + label.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</span> — ' +
      el.getAttribute('data-tip').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
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
  /* hero ambient build lanes */
  const heroCanvas = document.getElementById('hero-build');
  if (heroCanvas) heroAmbient(heroCanvas);

  /* labs */
  const bl = document.getElementById('lab-bounce');    if (bl) BounceLab(bl);
  const pl = document.getElementById('lab-pipeline');  if (pl) PipelineLab(pl);
  const al = document.getElementById('lab-asm');       if (al) AsmLab(al);
  const el = document.getElementById('lab-events');    if (el) EventLab(el);
  const nl = document.getElementById('lab-init');      if (nl) InitLab(nl);
  const hl = document.getElementById('lab-header');    if (hl) HeaderLab(hl);
  const xl = document.getElementById('lab-pixels');    if (xl) PixelLab(xl);
  const ul = document.getElementById('lab-upload');    if (ul) UploadLab(ul);
  const jl = document.getElementById('lab-joypad');    if (jl) JoypadLab(jl);
  const ol = document.getElementById('lab-oam');       if (ol) OamLab(ol);
  const gl = document.getElementById('lab-budget');    if (gl) BudgetLab(gl);
  const sl = document.getElementById('lab-sfx');       if (sl) SfxLab(sl);
  const dl = document.getElementById('lab-bugs');      if (dl) BugsLab(dl);
  const rl = document.getElementById('lab-ship');      if (rl) ShipLab(rl);
  const sg = document.getElementById('lab-ship-game'); if (sg) BounceLab(sg, { annotate: true });

  /* glossary tooltips */
  initTooltips();

  /* scroll-spy nav + reading progress */
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
